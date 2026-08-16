#!/usr/bin/env python3
"""Run raw VLM-proposed text/box prompts through SAM3 with durable receipts."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np


OBSERVATION_SCHEMA = "kaminos.procedural-groom-observation.v0"
SEAL_SCHEMA = "kaminos.procedural-groom-raw-proposal-seal.v0"
REPORT_SCHEMA = "kaminos.procedural-groom-sam3-report.v0"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def pixel_box(box: dict[str, Any], width: int, height: int) -> list[float]:
    values = []
    for field in ("x_min", "y_min", "x_max", "y_max"):
        value = box.get(field)
        if not isinstance(value, (int, float)) or not np.isfinite(value):
            raise ValueError(f"box {field} must be finite")
        values.append(float(np.clip(value, 0.0, 1.0)))
    x_min, y_min, x_max, y_max = values
    if x_max <= x_min or y_max <= y_min:
        raise ValueError("box must have positive area")
    return [x_min * width, y_min * height, x_max * width, y_max * height]


def union_masks(masks: np.ndarray, height: int, width: int) -> np.ndarray:
    masks = np.asarray(masks)
    if masks.size == 0:
        return np.zeros((height, width), dtype=np.uint8)
    if masks.ndim != 3 or masks.shape[1:] != (height, width):
        raise ValueError(f"mask shape {masks.shape} does not match image {(height, width)}")
    return (np.any(masks > 0, axis=0).astype(np.uint8) * 255)


def bound_file(root: Path, record: dict[str, Any], label: str) -> Path:
    path = (root / record["path"]).resolve()
    if not path.is_file() or path.stat().st_size <= 0:
        raise ValueError(f"{label}: missing or blank file")
    if record.get("byteLength") is not None and path.stat().st_size != record["byteLength"]:
        raise ValueError(f"{label}: byte length mismatch")
    if record.get("sha256") and sha256(path) != record["sha256"]:
        raise ValueError(f"{label}: sha256 mismatch")
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observation", required=True)
    parser.add_argument("--inventory", required=True)
    parser.add_argument("--proposal-seal", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--threshold", type=float, default=0.10)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    phase = "input-validation"
    last_trustworthy = None
    base_report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "requestedRoute": f"mlx-vlm:sam3:{args.model}",
        "effectiveRoute": None,
        "requestedModel": args.model,
        "effectiveModel": None,
        "requestedBackend": "mlx-metal",
        "effectiveBackend": None,
        "threshold": args.threshold,
        "visualAdmission": False,
        "scientificAdmission": False,
    }

    try:
        if not 0.0 < args.threshold < 1.0:
            raise ValueError("threshold must be in (0, 1)")
        observation_path = Path(args.observation).resolve()
        inventory_path = Path(args.inventory).resolve()
        seal_path = Path(args.proposal_seal).resolve()
        observation = json.loads(observation_path.read_text())
        inventory = json.loads(inventory_path.read_text())
        seal = json.loads(seal_path.read_text())
        if observation.get("schema") != OBSERVATION_SCHEMA or observation.get("truthExposure") != "withheld":
            raise ValueError("observation must be truth-withheld procedural groom input")
        if seal.get("schema") != SEAL_SCHEMA or seal.get("sealed") is not True:
            raise ValueError("raw VLM proposal must be sealed before segmentation")
        if seal.get("truthExposure") != "withheld":
            raise ValueError("proposal seal is contaminated by truth exposure")
        if seal.get("inventorySha256") != sha256(inventory_path):
            raise ValueError("inventory digest does not match proposal seal")
        if seal.get("observationDigest") != observation.get("digest"):
            raise ValueError("proposal seal observation identity mismatch")
        systems = inventory.get("systems")
        if not isinstance(systems, list) or not systems:
            raise ValueError("inventory has no proposed systems")
        if [system.get("id") for system in systems] != seal.get("inventorySystems"):
            raise ValueError("proposal seal system ordering mismatch")

        views = observation.get("views") or []
        images = []
        for view in views:
            if any(view.get(field) is not False for field in (
                "membershipColorsVisible", "labelsVisible", "gizmoVisible"
            )):
                raise ValueError(f"{view.get('id')}: contaminated observation")
            images.append((view, bound_file(observation_path.parent, view, view.get("id", "view"))))
        for system in systems:
            if not system.get("segmenter_phrase"):
                raise ValueError(f"{system.get('id')}: missing segmenter phrase")
            if len(system.get("bounding_boxes") or []) != len(images):
                raise ValueError(f"{system.get('id')}: bounding-box/view count mismatch")
        last_trustworthy = "digest-bound-sealed-vlm-proposal"

        write_json(output_dir / "start.json", {
            **base_report,
            "state": "started",
            "phase": "model-load",
            "observationDigest": observation["digest"],
            "inventorySha256": sha256(inventory_path),
            "proposalSealSha256": sha256(seal_path),
            "imageSha256": [sha256(path) for _, path in images],
            "lastTrustworthyEvidence": last_trustworthy,
        })

        phase = "model-load"
        import mlx.core as mx
        from PIL import Image
        from mlx_vlm.models.sam3.generate import Sam3Predictor
        from mlx_vlm.models.sam3.processing_sam3 import Sam3Processor
        from mlx_vlm.utils import get_model_path, load_model

        effective_device = str(mx.default_device())
        if "gpu" not in effective_device.lower():
            raise RuntimeError(f"mlx default device is not GPU: {effective_device}")
        model_path = Path(get_model_path(args.model)).resolve()
        config_path = model_path / "config.json"
        if not config_path.is_file():
            raise RuntimeError("resolved SAM3 model has no config.json")
        model = load_model(model_path)
        processor = Sam3Processor.from_pretrained(str(model_path))
        predictor = Sam3Predictor(model, processor, score_threshold=args.threshold)
        base_report.update({
            "effectiveRoute": f"mlx-vlm:sam3:{args.model}",
            "effectiveModel": args.model,
            "effectiveModelPath": str(model_path),
            "effectiveModelConfigSha256": sha256(config_path),
            "effectiveBackend": "mlx-metal",
            "effectiveDevice": effective_device,
        })

        phase = "segmentation"
        masks = []
        for view_index, (view, image_path) in enumerate(images):
            image = Image.open(image_path).convert("RGB")
            width, height = image.size
            for system_index, system in enumerate(systems):
                requested_box = pixel_box(system["bounding_boxes"][view_index], width, height)
                result = predictor.predict(
                    image,
                    text_prompt=system["segmenter_phrase"],
                    boxes=np.array([requested_box], dtype=np.float32),
                    score_threshold=args.threshold,
                )
                combined = union_masks(result.masks, height, width)
                relative_path = Path("masks") / view["id"] / f"{system['id']}.png"
                mask_path = output_dir / relative_path
                mask_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(combined, mode="L").save(mask_path)

                overlay = np.array(image).copy()
                selected = combined > 0
                color = np.array([
                    45 + (system_index * 67) % 180,
                    80 + (system_index * 43) % 150,
                    235 - (system_index * 37) % 160,
                ], dtype=np.uint8)
                overlay[selected] = (overlay[selected] * 0.42 + color * 0.58).astype(np.uint8)
                overlay_path = output_dir / "overlays" / view["id"] / f"{system['id']}.png"
                overlay_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(overlay).save(overlay_path)

                positive_pixels = int(selected.sum())
                masks.append({
                    "viewId": view["id"],
                    "proposalSystemId": system["id"],
                    "segmenterPhrase": system["segmenter_phrase"],
                    "requestedBoxPixels": requested_box,
                    "detectionCount": int(len(result.scores)),
                    "scores": [float(value) for value in result.scores],
                    "boxes": [[float(value) for value in box] for box in result.boxes],
                    "state": "mask_captured" if positive_pixels > 0 else "no_detection",
                    "positivePixels": positive_pixels,
                    "mask": {
                        "path": str(relative_path),
                        "sha256": sha256(mask_path),
                        "byteLength": mask_path.stat().st_size,
                    },
                    "overlay": {
                        "path": str(overlay_path.relative_to(output_dir)),
                        "sha256": sha256(overlay_path),
                        "byteLength": overlay_path.stat().st_size,
                    },
                })

        last_trustworthy = "raw-sam3-masks-with-no-admission"
        write_json(report_path, {
            **base_report,
            "state": "segmentation_captured",
            "phase": "complete",
            "observationDigest": observation["digest"],
            "inventorySha256": sha256(inventory_path),
            "proposalSealSha256": sha256(seal_path),
            "masks": masks,
            "lastTrustworthyEvidence": last_trustworthy,
        })
        return 0
    except Exception as error:
        write_json(report_path, {
            **base_report,
            "state": "failed",
            "phase": phase,
            "error": str(error),
            "traceback": traceback.format_exc(),
            "lastTrustworthyEvidence": last_trustworthy,
        })
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
