#!/usr/bin/env python3
"""Run literal SAM3 prompts while preserving raw candidates and normal-helper views."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import traceback
from pathlib import Path
from typing import Any

import numpy as np


REQUEST_SCHEMA = "kaminos.procedural-groom-sam3-sanity-request.v0"
REPORT_SCHEMA = "kaminos.procedural-groom-sam3-sanity-report.v0"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def safe_id(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not result:
        raise ValueError("prompt id must contain an alphanumeric character")
    return result


def repo_path(repo_root: Path, value: str, label: str) -> Path:
    path = (repo_root / value).resolve()
    try:
        path.relative_to(repo_root.resolve())
    except ValueError as error:
        raise ValueError(f"{label} escapes repo root") from error
    return path


def load_request(request_path: Path, repo_root: Path) -> dict[str, Any]:
    request_path = request_path.resolve()
    repo_root = repo_root.resolve()
    request = json.loads(request_path.read_text())
    if request.get("schema") != REQUEST_SCHEMA:
        raise ValueError(f"expected request schema {REQUEST_SCHEMA}")
    source = request.get("source") or {}
    if not isinstance(source.get("path"), str) or not source["path"]:
        raise ValueError("request requires source.path")
    source_path = repo_path(repo_root, source["path"], "source image")
    if not source_path.is_file() or source_path.stat().st_size <= 0:
        raise ValueError("source image is missing or blank")
    if source.get("sha256") != sha256(source_path):
        raise ValueError("source image digest mismatch")
    for field in ("model", "backend", "claimCeiling"):
        if not isinstance(request.get(field), str) or not request[field].strip():
            raise ValueError(f"request requires nonblank {field}")
    raw_threshold = request.get("rawThreshold")
    if not isinstance(raw_threshold, (int, float)) or not 0 < raw_threshold < 1:
        raise ValueError("rawThreshold must be in (0, 1)")
    report_thresholds = request.get("reportThresholds")
    if (
        not isinstance(report_thresholds, list)
        or not report_thresholds
        or any(not isinstance(value, (int, float)) or not 0 < value < 1 for value in report_thresholds)
    ):
        raise ValueError("reportThresholds must be a nonempty list in (0, 1)")
    if min(report_thresholds) < raw_threshold:
        raise ValueError("rawThreshold must not exceed the lowest report threshold")
    nms_iou = request.get("nmsIouThreshold")
    if not isinstance(nms_iou, (int, float)) or not 0 < nms_iou < 1:
        raise ValueError("nmsIouThreshold must be in (0, 1)")
    prompts = request.get("prompts")
    if not isinstance(prompts, list) or not prompts:
        raise ValueError("request requires literal prompts")
    seen = set()
    for prompt in prompts:
        if not isinstance(prompt, dict):
            raise ValueError("every prompt must be an object")
        prompt_id = safe_id(str(prompt.get("id", "")))
        if prompt_id in seen:
            raise ValueError(f"duplicate prompt id {prompt_id}")
        seen.add(prompt_id)
        if not isinstance(prompt.get("text"), str) or not prompt["text"].strip():
            raise ValueError(f"{prompt_id}: prompt text is blank")
        mode = prompt.get("mode")
        if mode not in {"text-only", "box-guided"}:
            raise ValueError(f"{prompt_id}: unsupported mode {mode}")
        if mode == "box-guided":
            box = prompt.get("boxNormalized")
            if (
                not isinstance(box, list)
                or len(box) != 4
                or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in box)
                or not 0 <= box[0] < box[2] <= 1
                or not 0 <= box[1] < box[3] <= 1
            ):
                raise ValueError(f"{prompt_id}: boxNormalized must be valid xyxy in [0, 1]")
    return {**request, "sourcePath": source_path, "requestPath": request_path}


def box_iou(left: np.ndarray, right: np.ndarray) -> float:
    x1 = max(float(left[0]), float(right[0]))
    y1 = max(float(left[1]), float(right[1]))
    x2 = min(float(left[2]), float(right[2]))
    y2 = min(float(left[3]), float(right[3]))
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, float(left[2] - left[0])) * max(0.0, float(left[3] - left[1]))
    right_area = max(0.0, float(right[2] - right[0])) * max(0.0, float(right[3] - right[1]))
    return intersection / max(left_area + right_area - intersection, 1e-9)


def nms_indices(indices: list[int], scores: np.ndarray, boxes: np.ndarray, iou_threshold: float) -> list[int]:
    ordered = sorted(indices, key=lambda index: (-float(scores[index]), index))
    kept: list[int] = []
    for index in ordered:
        if all(box_iou(boxes[index], boxes[other]) <= iou_threshold for other in kept):
            kept.append(index)
    return kept


def threshold_label(value: float) -> str:
    return f"{value:g}".replace(".", "p")


def selection_views(
    scores: np.ndarray,
    boxes: np.ndarray,
    report_thresholds: list[float],
    nms_iou_threshold: float,
) -> dict[str, list[int]]:
    scores = np.asarray(scores, dtype=np.float32)
    boxes = np.asarray(boxes, dtype=np.float32)
    views: dict[str, list[int]] = {}
    for threshold in report_thresholds:
        views[f"raw-{threshold_label(float(threshold))}"] = [
            index for index, score in enumerate(scores) if float(score) > float(threshold)
        ]
    default_threshold = 0.3 if any(math.isclose(float(value), 0.3) for value in report_thresholds) else float(report_thresholds[0])
    default_indices = [
        index for index, score in enumerate(scores) if float(score) > default_threshold
    ]
    views[
        f"default-{threshold_label(default_threshold)}-nms-{threshold_label(nms_iou_threshold)}"
    ] = nms_indices(default_indices, scores, boxes, nms_iou_threshold)
    views["top-1"] = [int(np.argmax(scores))] if scores.size else []
    return views


def report_contract(
    *,
    request_digest: str,
    source_digest: str,
    model: str,
    backend: str,
    raw_threshold: float,
    report_thresholds: list[float],
    nms_iou_threshold: float,
) -> dict[str, Any]:
    return {
        "schema": REPORT_SCHEMA,
        "requestedModel": model,
        "effectiveModel": None,
        "requestedBackend": backend,
        "effectiveBackend": None,
        "requestSha256": request_digest,
        "sourceSha256": source_digest,
        "rawThreshold": raw_threshold,
        "reportThresholds": report_thresholds,
        "nmsIouThreshold": nms_iou_threshold,
        "candidateCustody": "individual-raw-candidates-preserved",
        "visualAdmission": False,
        "scientificAdmission": False,
    }


def compose_mask(masks: np.ndarray, indices: list[int], height: int, width: int) -> np.ndarray:
    if not indices:
        return np.zeros((height, width), dtype=np.uint8)
    return np.any(np.asarray(masks)[indices] > 0, axis=0).astype(np.uint8) * 255


def overlay_mask(image: np.ndarray, mask: np.ndarray, color: np.ndarray) -> np.ndarray:
    overlay = image.copy()
    selected = mask > 0
    overlay[selected] = (overlay[selected] * 0.42 + color * 0.58).astype(np.uint8)
    return overlay


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    phase = "request-validation"
    last_trustworthy = None
    base_report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "state": "failed",
        "phase": phase,
        "candidateCustody": "individual-raw-candidates-preserved",
        "visualAdmission": False,
        "scientificAdmission": False,
    }
    try:
        request = load_request(args.request, args.repo_root)
        source_path = request["sourcePath"]
        base_report = report_contract(
            request_digest=sha256(request["requestPath"]),
            source_digest=sha256(source_path),
            model=request["model"],
            backend=request["backend"],
            raw_threshold=float(request["rawThreshold"]),
            report_thresholds=[float(value) for value in request["reportThresholds"]],
            nms_iou_threshold=float(request["nmsIouThreshold"]),
        )
        last_trustworthy = "digest-bound-literal-prompt-request"
        write_json(output_dir / "start.json", {
            **base_report,
            "state": "started",
            "phase": "model-load",
            "promptCount": len(request["prompts"]),
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
        model_path = Path(get_model_path(request["model"])).resolve()
        config_path = model_path / "config.json"
        if not config_path.is_file():
            raise RuntimeError("resolved SAM3 model has no config.json")
        model = load_model(model_path)
        processor = Sam3Processor.from_pretrained(str(model_path))
        predictor = Sam3Predictor(model, processor, score_threshold=float(request["rawThreshold"]))
        image = Image.open(source_path).convert("RGB")
        image_array = np.asarray(image)
        width, height = image.size
        base_report.update({
            "effectiveModel": request["model"],
            "effectiveModelPath": str(model_path),
            "effectiveModelConfigSha256": sha256(config_path),
            "effectiveBackend": "mlx-metal",
            "effectiveDevice": effective_device,
        })

        phase = "segmentation"
        prompt_reports = []
        for prompt_index, prompt in enumerate(request["prompts"]):
            prompt_id = safe_id(prompt["id"])
            boxes_input = None
            if prompt["mode"] == "box-guided":
                x1, y1, x2, y2 = [float(value) for value in prompt["boxNormalized"]]
                boxes_input = np.asarray([[x1 * width, y1 * height, x2 * width, y2 * height]], dtype=np.float32)
            result = predictor.predict(
                image,
                text_prompt=prompt["text"],
                boxes=boxes_input,
                score_threshold=float(request["rawThreshold"]),
            )
            scores = np.asarray(result.scores, dtype=np.float32)
            boxes = np.asarray(result.boxes, dtype=np.float32).reshape(-1, 4)
            masks = np.asarray(result.masks, dtype=np.uint8)
            if masks.shape != (len(scores), height, width):
                raise ValueError(f"{prompt_id}: mask shape {masks.shape} does not match {(len(scores), height, width)}")

            candidates = []
            color = np.array([
                45 + (prompt_index * 67) % 180,
                80 + (prompt_index * 43) % 150,
                235 - (prompt_index * 37) % 160,
            ], dtype=np.uint8)
            for candidate_index, (score, box, mask) in enumerate(zip(scores, boxes, masks)):
                mask_image = mask.astype(np.uint8) * 255
                candidate_root = Path("candidates") / prompt_id
                mask_relative = candidate_root / f"candidate-{candidate_index:03d}-mask.png"
                overlay_relative = candidate_root / f"candidate-{candidate_index:03d}-overlay.png"
                mask_path = output_dir / mask_relative
                overlay_path = output_dir / overlay_relative
                mask_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(mask_image, mode="L").save(mask_path)
                Image.fromarray(overlay_mask(image_array, mask_image, color)).save(overlay_path)
                candidates.append({
                    "index": candidate_index,
                    "score": float(score),
                    "boxPixels": [float(value) for value in box],
                    "positivePixels": int((mask_image > 0).sum()),
                    "mask": {"path": str(mask_relative), "sha256": sha256(mask_path), "byteLength": mask_path.stat().st_size},
                    "overlay": {"path": str(overlay_relative), "sha256": sha256(overlay_path), "byteLength": overlay_path.stat().st_size},
                })

            views = selection_views(
                scores,
                boxes,
                [float(value) for value in request["reportThresholds"]],
                float(request["nmsIouThreshold"]),
            )
            view_reports = []
            for view_name, indices in views.items():
                combined = compose_mask(masks, indices, height, width)
                view_root = Path("selection-views") / prompt_id
                mask_relative = view_root / f"{view_name}-mask.png"
                overlay_relative = view_root / f"{view_name}-overlay.png"
                mask_path = output_dir / mask_relative
                overlay_path = output_dir / overlay_relative
                mask_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(combined, mode="L").save(mask_path)
                Image.fromarray(overlay_mask(image_array, combined, color)).save(overlay_path)
                view_reports.append({
                    "id": view_name,
                    "candidateIndices": indices,
                    "candidateCount": len(indices),
                    "positivePixels": int((combined > 0).sum()),
                    "mask": {"path": str(mask_relative), "sha256": sha256(mask_path), "byteLength": mask_path.stat().st_size},
                    "overlay": {"path": str(overlay_relative), "sha256": sha256(overlay_path), "byteLength": overlay_path.stat().st_size},
                })
            prompt_reports.append({
                "id": prompt_id,
                "text": prompt["text"],
                "mode": prompt["mode"],
                "boxNormalized": prompt.get("boxNormalized"),
                "rawCandidateCount": len(candidates),
                "candidates": candidates,
                "selectionViews": view_reports,
            })

        last_trustworthy = "individual-raw-sam3-candidates-and-derived-selection-views"
        write_json(report_path, {
            **base_report,
            "state": "sanity_matrix_captured",
            "phase": "complete",
            "source": request["source"],
            "prompts": prompt_reports,
            "claimCeiling": request["claimCeiling"],
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
