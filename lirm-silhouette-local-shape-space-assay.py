#!/usr/bin/env python3

import argparse
import hashlib
import json
import math
import subprocess
import sys
from collections import deque
from pathlib import Path

import numpy as np


SCHEMA = "kaminos.lirm-silhouette-local-shape-space-assay.v0"
REQUESTED_ROUTE = "kaminos/lirm-speciation-armature/silhouette-local-shape-space-v0"
EFFECTIVE_ROUTE = "numpy-local-sdf-pca-topology-neighborhood-v0"


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


def connected_regions(mask: np.ndarray, target: int) -> list[bool]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=np.uint8)
    touches = []
    for y0 in range(height):
        for x0 in range(width):
            if visited[y0, x0] or int(mask[y0, x0]) != target:
                continue
            queue = deque([(x0, y0)])
            visited[y0, x0] = 1
            border = False
            while queue:
                x, y = queue.popleft()
                if x == 0 or y == 0 or x == width - 1 or y == height - 1:
                    border = True
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nx, ny = x + dx, y + dy
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    if not visited[ny, nx] and int(mask[ny, nx]) == target:
                        visited[ny, nx] = 1
                        queue.append((nx, ny))
            touches.append(border)
    return touches


def topology(mask: np.ndarray) -> dict:
    foreground = connected_regions(mask, 1)
    background = connected_regions(mask, 0)
    return {
        "foregroundComponents": len(foreground),
        "holes": sum(1 for touches_border in background if not touches_border),
    }


def topology_class(value: dict) -> str:
    return f"components:{value['foregroundComponents']};holes:{value['holes']}"


def silhouette_descriptor(mask: np.ndarray, bins: int = 12) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        raise ValueError("cannot describe blank silhouette")
    height, width = mask.shape
    x = xs / max(1, width - 1)
    y = ys / max(1, height - 1)
    centered = np.stack((x - x.mean(), y - y.mean()), axis=1)
    covariance = np.cov(centered, rowvar=False) if len(centered) > 1 else np.zeros((2, 2))
    eigenvalues = np.sort(np.linalg.eigvalsh(covariance))[::-1]
    perimeter = 0
    for yy, xx in zip(ys, xs):
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = xx + dx, yy + dy
            if nx < 0 or ny < 0 or nx >= width or ny >= height or mask[ny, nx] == 0:
                perimeter += 1
    area = float(mask.sum())
    symmetry_x = float(np.logical_xor(mask, np.fliplr(mask)).mean())
    symmetry_y = float(np.logical_xor(mask, np.flipud(mask)).mean())
    row_profile = mask.mean(axis=1)
    column_profile = mask.mean(axis=0)
    sample_positions = np.linspace(0, 1, bins)
    row_sample = np.interp(sample_positions, np.linspace(0, 1, len(row_profile)), row_profile)
    column_sample = np.interp(sample_positions, np.linspace(0, 1, len(column_profile)), column_profile)
    return np.concatenate((
        np.array([
            area / mask.size,
            x.mean(),
            y.mean(),
            eigenvalues[0],
            eigenvalues[1],
            perimeter / max(1.0, math.sqrt(area)),
            symmetry_x,
            symmetry_y,
        ]),
        row_sample,
        column_sample,
    ))


def standardize_descriptors(descriptors: np.ndarray) -> np.ndarray:
    scale = descriptors.std(axis=0)
    scale[scale < 1e-8] = 1.0
    return (descriptors - descriptors.mean(axis=0)) / scale


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


def render_contact_sheet(generations: list[dict], masks: list[np.ndarray], columns: int) -> str:
    cell_width = 220
    cell_height = 250
    rows = max(1, math.ceil(len(generations) / columns))
    cells = []
    for index, (generation, mask) in enumerate(zip(generations, masks)):
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        scale = min(180 / mask.shape[1], 180 / mask.shape[0])
        nearest = generation["noveltyAssay"]["nearest"]
        relation = generation["topologyRelation"]
        cells.append(f'''<g transform="translate({x} {y})" data-generation-id="{generation['generationId']}">
  <rect width="{cell_width - 2}" height="{cell_height - 2}" fill="#0a0c0b" stroke="#343a35"/>
  <g transform="translate(20 10) scale({scale})"><path d="{mask_path(mask)}" fill="#e8efdd"/></g>
  <text x="10" y="202" fill="#f0cf69" font-family="Menlo, monospace" font-size="11">{generation['generationId']} · {generation['mode']}</text>
  <text x="10" y="219" fill="#8f9b92" font-family="Menlo, monospace" font-size="9">nearest {nearest['similarity']:.3f} {nearest['transform']}</text>
  <text x="10" y="235" fill="#8f9b92" font-family="Menlo, monospace" font-size="9">{relation['parentClass']} → {relation['generatedClass']}</text>
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
        raise ValueError("local shape-space assay requires at least three accepted silhouettes")
    masks = []
    sdfs = []
    for row in rows:
        mask = read_pgm(corpus_dir / row["mask"]["path"])
        sdf = read_sdf(corpus_dir / row["signedDistance"]["path"], mask.shape[1], mask.shape[0])
        masks.append(mask)
        sdfs.append(sdf)
    if len({mask.shape for mask in masks}) != 1:
        raise ValueError("training masks have mixed dimensions")
    return rows, np.stack(masks), np.stack(sdfs)


def neighborhood_indexes(anchor: int, descriptors: np.ndarray, topologies: list[dict], size: int) -> list[int]:
    key = topology_class(topologies[anchor])
    compatible = [index for index, value in enumerate(topologies) if topology_class(value) == key]
    distances = np.linalg.norm(descriptors[compatible] - descriptors[anchor], axis=1)
    order = np.argsort(distances, kind="stable")
    return [compatible[int(position)] for position in order[:size]]


def decode_mask(decoded: np.ndarray, parent_masks: np.ndarray) -> tuple[np.ndarray, float]:
    threshold = 0.0
    mask = (decoded >= threshold).astype(np.uint8)
    occupancy = float(mask.mean())
    if occupancy <= 0.001 or occupancy >= 0.98:
        parent_occupancy = float(parent_masks.mean(axis=(1, 2)).mean())
        threshold = float(np.quantile(decoded, 1.0 - parent_occupancy))
        mask = (decoded >= threshold).astype(np.uint8)
    return mask, threshold


def fit_and_generate(rows, masks, sdfs, components, samples, seed, neighborhood_size, copy_threshold):
    topologies = [topology(mask) for mask in masks]
    descriptors = standardize_descriptors(np.stack([silhouette_descriptor(mask) for mask in masks]))
    groups = {}
    for index, value in enumerate(topologies):
        groups.setdefault(topology_class(value), []).append(index)
    eligible = [index for indexes in groups.values() if len(indexes) >= 3 for index in indexes]
    if not eligible:
        raise ValueError("no topology class contains at least three silhouettes")
    rng = np.random.default_rng(seed)
    generations = []
    generated_masks = []
    generated_sdfs = []
    height, width = masks.shape[1:]

    for index in range(samples):
        anchor = int(rng.choice(eligible))
        local_indexes = neighborhood_indexes(anchor, descriptors, topologies, min(neighborhood_size, len(groups[topology_class(topologies[anchor])])))
        local_sdfs = sdfs[local_indexes].reshape((len(local_indexes), -1))
        mean = local_sdfs.mean(axis=0)
        centered = local_sdfs - mean
        _u, singular, vt = np.linalg.svd(centered, full_matrices=False)
        effective_components = min(max(1, components), len(local_indexes) - 1, vt.shape[0])
        basis = vt[:effective_components]
        scores = centered @ basis.T
        anchor_local = local_indexes.index(anchor)
        score_std = scores.std(axis=0)
        mode_index = index % 3

        if mode_index == 0:
            other_local = int(rng.integers(1, len(local_indexes)))
            amount = float(rng.uniform(0.22, 0.52))
            latent = scores[anchor_local] * (1 - amount) + scores[other_local] * amount
            parent_indexes = [anchor, local_indexes[other_local]]
            mode = "local-neighbor-interpolation"
            parameters = {"amount": round(amount, 6)}
        elif mode_index == 1:
            component = int(rng.integers(0, effective_components))
            direction = -1.0 if rng.random() < 0.5 else 1.0
            strength = float(rng.uniform(0.28, 0.72))
            latent = scores[anchor_local].copy()
            latent[component] += direction * strength * max(score_std[component], 1e-6)
            parent_indexes = [anchor]
            mode = "local-component-push"
            parameters = {"component": component, "direction": direction, "strength": round(strength, 6)}
        else:
            other_positions = rng.choice(np.arange(1, len(local_indexes)), size=min(2, len(local_indexes) - 1), replace=False)
            anchor_weight = float(rng.uniform(0.52, 0.72))
            remainder = 1.0 - anchor_weight
            other_weights = rng.dirichlet(np.ones(len(other_positions))) * remainder
            latent = scores[anchor_local] * anchor_weight
            for position, weight in zip(other_positions, other_weights):
                latent += scores[int(position)] * weight
            jitter = rng.normal(0, 0.07, size=effective_components) * np.maximum(score_std, 1e-6)
            latent += jitter
            parent_indexes = [anchor] + [local_indexes[int(position)] for position in other_positions]
            mode = "local-centroid-mutation"
            parameters = {"anchorWeight": round(anchor_weight, 6), "otherWeights": [round(float(value), 6) for value in other_weights]}

        decoded = (mean + latent @ basis).reshape((height, width))
        generated_mask, threshold = decode_mask(decoded, masks[parent_indexes])
        generated_topology = topology(generated_mask)
        parent_class = topology_class(topologies[anchor])
        generated_class = topology_class(generated_topology)
        generation_id = f"local-shape-{index:03d}"
        novelty = novelty_assay(generated_mask, masks, copy_threshold)
        generations.append({
            "generationId": generation_id,
            "mode": mode,
            "parameters": parameters,
            "parentShapeIds": [rows[parent]["shapeId"] for parent in parent_indexes],
            "neighborhood": {
                "anchorShapeId": rows[anchor]["shapeId"],
                "shapeIds": [rows[position]["shapeId"] for position in local_indexes],
                "parentTopologyCompatible": all(topology_class(topologies[parent]) == parent_class for parent in parent_indexes),
                "effectiveComponentCount": effective_components,
                "singularValues": [round(float(value), 6) for value in singular[:effective_components]],
            },
            "generatedTopology": generated_topology,
            "topologyRelation": {
                "parentClass": parent_class,
                "generatedClass": generated_class,
                "preserved": parent_class == generated_class,
            },
            "maskHash": mask_hash(generated_mask),
            "foregroundOccupancy": round(float(generated_mask.mean()), 6),
            "decodeThreshold": round(threshold, 6),
            "noveltyAssay": novelty,
            "acceptedForDownstream": not novelty["copied"],
            "maskPath": f"generated/{generation_id}.pgm",
            "signedDistancePath": f"generated/{generation_id}.f32",
        })
        generated_masks.append(generated_mask)
        generated_sdfs.append(decoded)
    return generations, generated_masks, generated_sdfs, groups


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate silhouette mutations from topology-compatible local SDF neighborhoods.")
    parser.add_argument("--corpus-dir", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--components", type=int, default=8)
    parser.add_argument("--samples", type=int, default=36)
    parser.add_argument("--seed", type=int, default=713)
    parser.add_argument("--neighborhood-size", type=int, default=12)
    parser.add_argument("--copy-threshold", type=float, default=0.94)
    parser.add_argument("--columns", type=int, default=6)
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
        generations, generated_masks, generated_sdfs, groups = fit_and_generate(
            rows, masks, sdfs, args.components, args.samples, args.seed, args.neighborhood_size, args.copy_threshold
        )
        generated_dir = args.out_dir / "generated"
        generated_dir.mkdir(exist_ok=True)
        for generation, mask, sdf in zip(generations, generated_masks, generated_sdfs):
            write_pgm(args.out_dir / generation["maskPath"], mask)
            write_sdf(args.out_dir / generation["signedDistancePath"], sdf)
        accepted_rows = [{
            "schema": "kaminos.lirm-silhouette-local-generation.v0",
            "generationId": generation["generationId"],
            "mode": generation["mode"],
            "parentShapeIds": generation["parentShapeIds"],
            "generatedTopology": generation["generatedTopology"],
            "topologyRelation": generation["topologyRelation"],
            "noveltyAssay": generation["noveltyAssay"],
            "maskPath": generation["maskPath"],
            "signedDistancePath": generation["signedDistancePath"],
        } for generation in generations if generation["acceptedForDownstream"]]
        (args.out_dir / "accepted-generation-index.jsonl").write_text(
            "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in accepted_rows)
        )
        (args.out_dir / "contact-sheet.svg").write_text(render_contact_sheet(generations, generated_masks, args.columns))
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
            "trainingSampleCount": len(rows),
            "requestedComponentCount": args.components,
            "requestedNeighborhoodSize": args.neighborhood_size,
            "topologyClasses": {key: len(indexes) for key, indexes in sorted(groups.items())},
            "requestedSampleCount": args.samples,
            "generatedSampleCount": len(generations),
            "copyThreshold": args.copy_threshold,
            "generations": generations,
            "falseClosureGuards": {
                "identityUsedAsModelInput": "false",
                "sourceAppearanceUsedAsModelInput": "false",
                "crossTopologyParentCount": sum(1 for generation in generations if not generation["neighborhood"]["parentTopologyCompatible"]),
                "changedGeneratedTopologyCount": sum(1 for generation in generations if not generation["topologyRelation"]["preserved"]),
                "unassayedGenerationCount": sum(1 for generation in generations if not generation.get("noveltyAssay")),
                "copiedGenerationCount": sum(1 for generation in generations if generation["noveltyAssay"]["copied"]),
                "acceptedCopiedGenerationCount": sum(
                    1 for generation in generations
                    if generation["acceptedForDownstream"] and generation["noveltyAssay"]["copied"]
                ),
                "finishedGeneratorClaim": "local_pca_shape_space_assay_only",
            },
            "outputInventory": {
                "receipt": "receipt.json",
                "contactSheet": "contact-sheet.svg",
                "contactSheetRaster": "contact-sheet.png",
                "acceptedGenerationIndex": "accepted-generation-index.jsonl",
                "acceptedGenerationCount": len(accepted_rows),
                "generatedMasks": [generation["maskPath"] for generation in generations],
                "generatedDistanceFields": [generation["signedDistancePath"] for generation in generations],
            },
        }
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps({"status": "complete", "generatedSampleCount": len(generations), "output": str(args.out_dir)}))
        return 0
    except Exception as error:
        failed = {
            **initialized,
            "status": "failed",
            "failurePhase": "fit_or_render_local_shape_space",
            "error": str(error),
        }
        receipt_path.write_text(json.dumps(failed, indent=2) + "\n")
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
