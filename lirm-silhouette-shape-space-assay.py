#!/usr/bin/env python3

import argparse
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np


SCHEMA = "kaminos.lirm-silhouette-shape-space-assay.v0"
REQUESTED_ROUTE = "kaminos/lirm-speciation-armature/silhouette-shape-space-v0"
EFFECTIVE_ROUTE = "numpy-svd-sdf-pca-v0"


def read_pgm(path: Path) -> np.ndarray:
    with path.open("rb") as handle:
        if handle.readline().strip() != b"P5":
            raise ValueError(f"{path} is not a P5 PGM")
        dimensions = handle.readline().strip().split()
        while dimensions and dimensions[0].startswith(b"#"):
            dimensions = handle.readline().strip().split()
        width, height = map(int, dimensions)
        if int(handle.readline().strip()) != 255:
            raise ValueError(f"{path} does not use max value 255")
        pixels = np.frombuffer(handle.read(), dtype=np.uint8)
    if pixels.size != width * height:
        raise ValueError(f"{path} contains {pixels.size} of {width * height} pixels")
    return (pixels.reshape((height, width)) >= 128).astype(np.uint8)


def read_sdf(path: Path, width: int, height: int) -> np.ndarray:
    values = np.fromfile(path, dtype="<f4")
    if values.size != width * height:
        raise ValueError(f"{path} contains {values.size} of {width * height} float32 values")
    return values.reshape((height, width)).astype(np.float64)


def write_pgm(path: Path, mask: np.ndarray) -> None:
    height, width = mask.shape
    with path.open("wb") as handle:
        handle.write(f"P5\n{width} {height}\n255\n".encode("ascii"))
        handle.write((mask.astype(np.uint8) * 255).tobytes())


def write_sdf(path: Path, sdf: np.ndarray) -> None:
    sdf.astype("<f4").tofile(path)


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.logical_or(a, b).sum()
    return 1.0 if union == 0 else float(np.logical_and(a, b).sum() / union)


def novelty_assay(mask: np.ndarray, training_masks: np.ndarray, threshold: float) -> dict:
    nearest = {"index": -1, "similarity": 0.0, "transform": "direct"}
    for index, training in enumerate(training_masks):
        for transform, candidate in (("direct", training), ("mirror_x", np.fliplr(training))):
            similarity = mask_iou(mask, candidate)
            if similarity > nearest["similarity"]:
                nearest = {"index": index, "similarity": round(similarity, 6), "transform": transform}
    return {
        "schema": "kaminos.lirm-silhouette-novelty-assay.v0",
        "metric": "canonical-mask-iou",
        "copyThreshold": threshold,
        "includeMirror": True,
        "copied": nearest["similarity"] >= threshold,
        "nearest": nearest,
    }


def mask_hash(mask: np.ndarray) -> str:
    digest = hashlib.sha256()
    digest.update(f"{mask.shape[1]}x{mask.shape[0]}:".encode("ascii"))
    digest.update(mask.astype(np.uint8).tobytes())
    return f"sha256:{digest.hexdigest()}"


def mask_path(mask: np.ndarray) -> str:
    commands = []
    height, width = mask.shape
    for y in range(height):
        x = 0
        while x < width:
            while x < width and not mask[y, x]:
                x += 1
            if x >= width:
                break
            start = x
            while x < width and mask[y, x]:
                x += 1
            commands.append(f"M{start} {y}h{x - start}v1h-{x - start}z")
    return "".join(commands)


def render_contact_sheet(generations: list[dict], masks: list[np.ndarray], columns: int = 4) -> str:
    cell_width = 220
    cell_height = 238
    rows = max(1, math.ceil(len(generations) / columns))
    cells = []
    for index, (generation, mask) in enumerate(zip(generations, masks)):
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        scale = min(180 / mask.shape[1], 180 / mask.shape[0])
        nearest = generation["noveltyAssay"]["nearest"]
        replay = "COPY" if generation["noveltyAssay"]["copied"] else "novel"
        cells.append(f'''<g transform="translate({x} {y})" data-generation-id="{generation['generationId']}">
  <rect width="{cell_width - 2}" height="{cell_height - 2}" fill="#0a0c0b" stroke="#343a35"/>
  <g transform="translate(20 10) scale({scale})"><path d="{mask_path(mask)}" fill="#e8efdd"/></g>
  <text x="10" y="202" fill="#f0cf69" font-family="Menlo, monospace" font-size="11">{generation['generationId']} · {generation['mode']}</text>
  <text x="10" y="219" fill="#8f9b92" font-family="Menlo, monospace" font-size="9">nearest {nearest['similarity']:.3f} {nearest['transform']} · {replay}</text>
</g>''')
    width = columns * cell_width
    height = rows * cell_height
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" data-route="{REQUESTED_ROUTE}" data-effective-route="{EFFECTIVE_ROUTE}">
<rect width="100%" height="100%" fill="#050706"/>
{''.join(cells)}
</svg>'''


def load_corpus(corpus_dir: Path) -> tuple[list[dict], np.ndarray, np.ndarray]:
    receipt = json.loads((corpus_dir / "receipt.json").read_text())
    if receipt.get("routeIdentity", {}).get("effectiveRoute") != "kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0":
        raise ValueError("corpus receipt does not identify the effective silhouette-archetype route")
    rows = [json.loads(line) for line in (corpus_dir / "training-index.jsonl").read_text().splitlines() if line.strip()]
    if len(rows) < 3:
        raise ValueError("shape-space assay requires at least three accepted silhouettes")
    masks = []
    sdfs = []
    for row in rows:
        mask = read_pgm(corpus_dir / row["mask"]["path"])
        sdf = read_sdf(corpus_dir / row["signedDistance"]["path"], mask.shape[1], mask.shape[0])
        masks.append(mask)
        sdfs.append(sdf)
    dimensions = {mask.shape for mask in masks}
    if len(dimensions) != 1:
        raise ValueError(f"training masks have mixed dimensions: {sorted(dimensions)}")
    return rows, np.stack(masks), np.stack(sdfs)


def fit_and_generate(rows: list[dict], masks: np.ndarray, sdfs: np.ndarray, components: int, samples: int, seed: int, copy_threshold: float) -> tuple[dict, list[np.ndarray], list[np.ndarray]]:
    flattened = sdfs.reshape((sdfs.shape[0], -1))
    mean = flattened.mean(axis=0)
    centered = flattened - mean
    _u, singular, vt = np.linalg.svd(centered, full_matrices=False)
    effective_components = min(max(1, components), flattened.shape[0] - 1, vt.shape[0])
    basis = vt[:effective_components]
    scores = centered @ basis.T
    variances = (singular ** 2) / max(1, flattened.shape[0] - 1)
    total_variance = float(variances.sum())
    explained = variances[:effective_components] / total_variance if total_variance > 0 else np.zeros(effective_components)
    score_std = scores.std(axis=0)
    rng = np.random.default_rng(seed)
    generations = []
    generated_masks = []
    generated_sdfs = []
    height, width = masks.shape[1:]

    for index in range(samples):
        mode_index = index % 3
        if mode_index == 0:
            parents = rng.choice(len(rows), size=2, replace=False)
            amount = float(rng.uniform(0.28, 0.72))
            latent = scores[parents[0]] * (1 - amount) + scores[parents[1]] * amount
            mode = "latent-interpolation"
            parameters = {"amount": round(amount, 6)}
        elif mode_index == 1:
            parent = int(rng.integers(0, len(rows)))
            component = int(rng.integers(0, effective_components))
            direction = -1.0 if rng.random() < 0.5 else 1.0
            strength = float(rng.uniform(0.45, 1.1))
            latent = scores[parent].copy()
            latent[component] += direction * strength * max(score_std[component], 1e-6)
            parents = np.array([parent])
            mode = "component-push"
            parameters = {"component": component, "direction": direction, "strength": round(strength, 6)}
        else:
            parents = rng.choice(len(rows), size=3, replace=False)
            weights = rng.dirichlet(np.ones(3))
            latent = (scores[parents] * weights[:, None]).sum(axis=0)
            jitter = rng.normal(0, 0.16, size=effective_components) * np.maximum(score_std, 1e-6)
            latent += jitter
            mode = "centroid-mutation"
            parameters = {"weights": [round(float(value), 6) for value in weights]}

        decoded = (mean + latent @ basis).reshape((height, width))
        generated_mask = (decoded >= 0).astype(np.uint8)
        threshold_adjustment = 0.0
        occupancy = float(generated_mask.mean())
        if occupancy <= 0.001 or occupancy >= 0.98:
            parent_occupancy = float(masks[parents].mean(axis=(1, 2)).mean())
            threshold_adjustment = float(np.quantile(decoded, 1.0 - parent_occupancy))
            generated_mask = (decoded >= threshold_adjustment).astype(np.uint8)
            occupancy = float(generated_mask.mean())

        novelty = novelty_assay(generated_mask, masks, copy_threshold)
        generation_id = f"shape-{index:03d}"
        generations.append({
            "generationId": generation_id,
            "mode": mode,
            "parameters": parameters,
            "parentShapeIds": [rows[int(parent)]["shapeId"] for parent in parents],
            "maskHash": mask_hash(generated_mask),
            "foregroundOccupancy": round(occupancy, 6),
            "decodeThreshold": round(threshold_adjustment, 6),
            "noveltyAssay": novelty,
            "maskPath": f"generated/{generation_id}.pgm",
            "signedDistancePath": f"generated/{generation_id}.f32",
        })
        generated_masks.append(generated_mask)
        generated_sdfs.append(decoded)

    fit = {
        "trainingSampleCount": len(rows),
        "requestedComponentCount": components,
        "effectiveComponentCount": effective_components,
        "explainedVarianceRatio": [round(float(value), 8) for value in explained],
        "explainedVarianceTotal": round(float(explained.sum()), 8),
        "singularValues": [round(float(value), 6) for value in singular[:effective_components]],
    }
    return fit, generations, generated_masks, generated_sdfs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fit a deterministic PCA manifold to canonical silhouette SDFs.")
    parser.add_argument("--corpus-dir", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--components", type=int, default=12)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--seed", type=int, default=713)
    parser.add_argument("--copy-threshold", type=float, default=0.96)
    parser.add_argument("--columns", type=int, default=4)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    initialized = {
        "schema": SCHEMA,
        "status": "running",
        "phase": "writer_initialized",
        "lastTrustworthyEvidence": "writer_initialized",
        "routeIdentity": {"requestedRoute": REQUESTED_ROUTE, "effectiveRoute": EFFECTIVE_ROUTE},
    }
    receipt_path = args.out_dir / "receipt.json"
    receipt_path.write_text(json.dumps(initialized, indent=2) + "\n")
    try:
        rows, masks, sdfs = load_corpus(args.corpus_dir)
        fit, generations, generated_masks, generated_sdfs = fit_and_generate(
            rows, masks, sdfs, args.components, args.samples, args.seed, args.copy_threshold
        )
        generated_dir = args.out_dir / "generated"
        generated_dir.mkdir(exist_ok=True)
        for generation, mask, sdf in zip(generations, generated_masks, generated_sdfs):
            write_pgm(args.out_dir / generation["maskPath"], mask)
            write_sdf(args.out_dir / generation["signedDistancePath"], sdf)
        contact_svg = render_contact_sheet(generations, generated_masks, args.columns)
        (args.out_dir / "contact-sheet.svg").write_text(contact_svg)
        raster = subprocess.run(
            ["sips", "-s", "format", "png", str(args.out_dir / "contact-sheet.svg"), "--out", str(args.out_dir / "contact-sheet.png")],
            capture_output=True,
            text=True,
        )
        if raster.returncode != 0:
            raise RuntimeError(f"sips contact-sheet rasterization failed: {raster.stderr or raster.stdout}")
        receipt = {
            "schema": SCHEMA,
            "status": "complete",
            "phase": "witness_written",
            "routeIdentity": {"requestedRoute": REQUESTED_ROUTE, "effectiveRoute": EFFECTIVE_ROUTE},
            "sourceCorpus": {
                "path": str(args.corpus_dir),
                "receipt": str(args.corpus_dir / "receipt.json"),
                "trainingIndex": str(args.corpus_dir / "training-index.jsonl"),
            },
            "seed": args.seed,
            "trainingSampleCount": fit["trainingSampleCount"],
            "requestedComponentCount": fit["requestedComponentCount"],
            "effectiveComponentCount": fit["effectiveComponentCount"],
            "explainedVarianceRatio": fit["explainedVarianceRatio"],
            "explainedVarianceTotal": fit["explainedVarianceTotal"],
            "singularValues": fit["singularValues"],
            "requestedSampleCount": args.samples,
            "generatedSampleCount": len(generations),
            "copyThreshold": args.copy_threshold,
            "generations": generations,
            "falseClosureGuards": {
                "identityUsedAsModelInput": "false",
                "sourceAppearanceUsedAsModelInput": "false",
                "unassayedGenerationCount": sum(1 for generation in generations if not generation.get("noveltyAssay")),
                "copiedGenerationCount": sum(1 for generation in generations if generation["noveltyAssay"]["copied"]),
                "finishedGeneratorClaim": "pca_shape_space_assay_only",
            },
            "outputInventory": {
                "receipt": "receipt.json",
                "contactSheet": "contact-sheet.svg",
                "contactSheetRaster": "contact-sheet.png",
                "generatedMasks": [generation["maskPath"] for generation in generations],
                "generatedDistanceFields": [generation["signedDistancePath"] for generation in generations],
            },
        }
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))
        return 0
    except Exception as error:
        failed = {
            **initialized,
            "status": "failed",
            "failurePhase": "fit_or_render_shape_space",
            "error": str(error),
        }
        receipt_path.write_text(json.dumps(failed, indent=2) + "\n")
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

