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


SCHEMA = "kaminos.lirm-silhouette-morphology-basin-atlas.v0"
REQUESTED_ROUTE = "kaminos/lirm-speciation-armature/morphology-basin-atlas-v0"
EFFECTIVE_ROUTE = "numpy-mirror-invariant-morphology-maximin-v0"
RADIAL_BINS = 24
PROFILE_BINS = 16
SCALAR_NAMES = [
    "occupancy",
    "bboxAspectLog",
    "principalAspectLog",
    "elongationLog",
    "compactness",
    "centroidY",
    "symmetryXorX",
    "symmetryXorY",
    "topMassFraction",
    "bottomMassFraction",
    "supportWidthFraction",
    "radialVariation",
    "radialPeakFraction",
    "foregroundComponentsLog",
    "holesLog",
]
DESCRIPTOR_NAMES = (
    SCALAR_NAMES
    + [f"rowProfile{index:02d}" for index in range(PROFILE_BINS)]
    + [f"columnProfile{index:02d}" for index in range(PROFILE_BINS)]
    + [f"radialProfile{index:02d}" for index in range(RADIAL_BINS)]
)


def parse_args():
    parser = argparse.ArgumentParser(description="Build an inspectable morphology-basin atlas from silhouette corpora.")
    parser.add_argument("--corpus-dir", action="append", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--basins", type=int, default=24)
    parser.add_argument("--columns", type=int, default=6)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def write_json(path: Path, value) -> None:
    path.write_text(f"{json.dumps(value, indent=2)}\n")


def write_jsonl(path: Path, values) -> None:
    path.write_text("".join(f"{json.dumps(value)}\n" for value in values))


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


def canonical_mirror(mask: np.ndarray) -> np.ndarray:
    direct = np.ascontiguousarray(mask, dtype=np.uint8)
    mirrored = np.ascontiguousarray(np.fliplr(direct), dtype=np.uint8)
    return direct if direct.tobytes() <= mirrored.tobytes() else mirrored


def connected_regions(mask: np.ndarray, target: int) -> list[dict]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=np.uint8)
    regions = []
    for start_y in range(height):
        for start_x in range(width):
            if visited[start_y, start_x] or int(mask[start_y, start_x]) != target:
                continue
            queue = deque([(start_x, start_y)])
            visited[start_y, start_x] = 1
            border = False
            size = 0
            while queue:
                x, y = queue.popleft()
                size += 1
                border = border or x == 0 or y == 0 or x == width - 1 or y == height - 1
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and not visited[ny, nx] and int(mask[ny, nx]) == target:
                        visited[ny, nx] = 1
                        queue.append((nx, ny))
            regions.append({"touchesBorder": border, "size": size})
    return regions


def measure_topology(mask: np.ndarray) -> dict:
    foreground = connected_regions(mask, 1)
    background = connected_regions(mask, 0)
    foreground_area = max(1, int(mask.sum()))
    return {
        "foregroundComponents": len(foreground),
        "largestComponentFraction": max((region["size"] for region in foreground), default=0) / foreground_area,
        "holes": sum(1 for region in background if not region["touchesBorder"]),
    }


def assay_atlas_eligibility(mask: np.ndarray) -> dict:
    binary = np.asarray(mask, dtype=np.uint8)
    ys, xs = np.nonzero(binary)
    if len(xs) == 0:
        return {
            "eligible": False,
            "reasons": ["blank_silhouette"],
            "bboxFillFraction": 0.0,
            "largestComponentFraction": 0.0,
        }
    crop = binary[int(ys.min()):int(ys.max()) + 1, int(xs.min()):int(xs.max()) + 1]
    topology = measure_topology(binary)
    bbox_fill = float(crop.mean())
    largest_component = float(topology["largestComponentFraction"])
    reasons = []
    if bbox_fill >= 0.995:
        reasons.append("filled_bounding_box")
    if topology["foregroundComponents"] > 1 and largest_component < 0.75:
        reasons.append("fragmented_foreground")
    return {
        "eligible": not reasons,
        "reasons": reasons,
        "bboxFillFraction": bbox_fill,
        "largestComponentFraction": largest_component,
    }


def perimeter(mask: np.ndarray) -> int:
    padded = np.pad(mask.astype(bool), 1)
    center = padded[1:-1, 1:-1]
    return int(
        np.logical_and(center, ~padded[:-2, 1:-1]).sum()
        + np.logical_and(center, ~padded[2:, 1:-1]).sum()
        + np.logical_and(center, ~padded[1:-1, :-2]).sum()
        + np.logical_and(center, ~padded[1:-1, 2:]).sum()
    )


def sampled_profile(values: np.ndarray, bins: int) -> np.ndarray:
    positions = np.linspace(0, 1, bins)
    return np.interp(positions, np.linspace(0, 1, len(values)), values)


def fill_circular_gaps(values: np.ndarray) -> np.ndarray:
    result = values.copy()
    valid = np.flatnonzero(result > 0)
    if len(valid) == 0:
        return result
    for index in np.flatnonzero(result <= 0):
        offsets = np.minimum((valid - index) % len(result), (index - valid) % len(result))
        result[index] = result[valid[np.argmin(offsets)]]
    return result


def radial_profile(mask: np.ndarray, bins: int = RADIAL_BINS) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    cx, cy = xs.mean(), ys.mean()
    dx, dy = xs - cx, ys - cy
    radii = np.hypot(dx, dy)
    angles = (np.arctan2(dy, dx) + 2 * np.pi) % (2 * np.pi)
    indexes = np.floor(angles * bins / (2 * np.pi)).astype(int) % bins
    profile = np.zeros(bins, dtype=np.float64)
    np.maximum.at(profile, indexes, radii)
    profile = fill_circular_gaps(profile)
    maximum = float(profile.max())
    return profile / maximum if maximum > 0 else profile


def radial_peak_count(profile: np.ndarray) -> int:
    smoothed = (np.roll(profile, 1) + 2 * profile + np.roll(profile, -1)) / 4
    count = 0
    for index, value in enumerate(smoothed):
        previous = smoothed[(index - 1) % len(smoothed)]
        following = smoothed[(index + 1) % len(smoothed)]
        shoulder = min(previous, following)
        if value > previous and value >= following and value - shoulder >= 0.035:
            count += 1
    return count


def describe_silhouette(mask: np.ndarray) -> dict:
    canonical = canonical_mirror(np.asarray(mask, dtype=np.uint8))
    ys, xs = np.nonzero(canonical)
    if len(xs) == 0:
        raise ValueError("cannot describe blank silhouette")
    height, width = canonical.shape
    min_x, max_x = int(xs.min()), int(xs.max())
    min_y, max_y = int(ys.min()), int(ys.max())
    bbox_width = max_x - min_x + 1
    bbox_height = max_y - min_y + 1
    normalized_x = xs / max(1, width - 1)
    normalized_y = ys / max(1, height - 1)
    centered = np.stack((normalized_x - normalized_x.mean(), normalized_y - normalized_y.mean()), axis=1)
    covariance = np.cov(centered, rowvar=False) if len(centered) > 1 else np.eye(2) * 1e-9
    eigenvalues = np.sort(np.maximum(np.linalg.eigvalsh(covariance), 1e-12))[::-1]
    var_x = max(float(covariance[0, 0]), 1e-12)
    var_y = max(float(covariance[1, 1]), 1e-12)
    area = float(canonical.sum())
    boundary = float(perimeter(canonical))
    compactness = 4 * math.pi * area / max(1.0, boundary * boundary)
    symmetry_x = float(np.logical_xor(canonical, np.fliplr(canonical)).mean())
    symmetry_y = float(np.logical_xor(canonical, np.flipud(canonical)).mean())
    row_profile = canonical.mean(axis=1)
    column_profile = canonical.mean(axis=0)
    top_cut = min_y + max(1, math.ceil(bbox_height * 0.25))
    bottom_cut = max_y - max(1, math.ceil(bbox_height * 0.25)) + 1
    top_mass = float(canonical[min_y:top_cut].sum() / area)
    bottom_mass = float(canonical[bottom_cut:max_y + 1].sum() / area)
    support_rows = canonical[max(min_y, max_y - max(1, math.ceil(bbox_height * 0.12)) + 1):max_y + 1]
    support_x = np.flatnonzero(support_rows.any(axis=0))
    support_width = 0.0 if len(support_x) == 0 else float((support_x.max() - support_x.min() + 1) / bbox_width)
    radial = radial_profile(canonical)
    peaks = radial_peak_count(radial)
    topology = measure_topology(canonical)
    eligibility = assay_atlas_eligibility(canonical)
    principal_aspect = math.sqrt(var_y / var_x)
    metrics = {
        "occupancy": area / canonical.size,
        "bboxAspect": bbox_height / bbox_width,
        "principalAspect": principal_aspect,
        "elongation": math.sqrt(eigenvalues[0] / eigenvalues[1]),
        "compactness": compactness,
        "centroidY": float(normalized_y.mean()),
        "symmetryXorX": symmetry_x,
        "symmetryXorY": symmetry_y,
        "topMassFraction": top_mass,
        "bottomMassFraction": bottom_mass,
        "supportWidthFraction": support_width,
        "radialVariation": float(radial.std()),
        "radialPeakCount": peaks,
        "bboxFillFraction": eligibility["bboxFillFraction"],
        "largestComponentFraction": eligibility["largestComponentFraction"],
    }
    scalars = np.array([
        metrics["occupancy"],
        math.log(max(metrics["bboxAspect"], 1e-6)),
        math.log(max(metrics["principalAspect"], 1e-6)),
        math.log(max(metrics["elongation"], 1e-6)),
        metrics["compactness"],
        metrics["centroidY"],
        metrics["symmetryXorX"],
        metrics["symmetryXorY"],
        metrics["topMassFraction"],
        metrics["bottomMassFraction"],
        metrics["supportWidthFraction"],
        metrics["radialVariation"],
        peaks / max(1, RADIAL_BINS),
        math.log1p(topology["foregroundComponents"]),
        math.log1p(topology["holes"]),
    ])
    vector = np.concatenate((
        scalars,
        sampled_profile(row_profile, PROFILE_BINS),
        sampled_profile(column_profile, PROFILE_BINS),
        radial,
    ))
    return {
        "vector": vector,
        "metrics": metrics,
        "topology": topology,
        "atlasEligibility": eligibility,
        "canonicalMask": canonical,
    }


def descriptor_distance(a: dict, b: dict) -> float:
    delta = np.asarray(a["vector"], dtype=np.float64) - np.asarray(b["vector"], dtype=np.float64)
    return float(np.linalg.norm(delta) / math.sqrt(len(delta)))


def standardized_vectors(descriptors: list[dict], reference_descriptors: list[dict] | None = None) -> np.ndarray:
    values = np.stack([descriptor["vector"] for descriptor in descriptors]).astype(np.float64)
    reference_values = values if reference_descriptors is None else np.stack(
        [descriptor["vector"] for descriptor in reference_descriptors]
    ).astype(np.float64)
    scale = reference_values.std(axis=0)
    scale[scale < 1e-8] = 1.0
    return (values - reference_values.mean(axis=0)) / scale


def distance_matrix(vectors: np.ndarray) -> np.ndarray:
    norms = np.einsum("ij,ij->i", vectors, vectors)
    squared = np.maximum(norms[:, None] + norms[None, :] - 2 * vectors @ vectors.T, 0)
    result = np.sqrt(squared / max(1, vectors.shape[1]))
    np.fill_diagonal(result, 0)
    return result


def standardized_distance_matrix(descriptors: list[dict]) -> np.ndarray:
    return distance_matrix(standardized_vectors(descriptors))


def maximin_indexes(distances: np.ndarray, count: int) -> list[int]:
    if distances.ndim != 2 or distances.shape[0] != distances.shape[1]:
        raise ValueError("distance matrix must be square")
    size = distances.shape[0]
    count = min(max(1, int(count)), size)
    selected = [int(np.argmax(distances.mean(axis=1)))]
    nearest = distances[:, selected[0]].copy()
    nearest[selected[0]] = -1
    while len(selected) < count:
        candidate = int(np.argmax(nearest))
        selected.append(candidate)
        nearest = np.minimum(nearest, distances[:, candidate])
        nearest[selected] = -1
    return selected


def mask_svg_path(mask: np.ndarray, x_offset: int, y_offset: int, scale: float) -> str:
    commands = []
    for y, row in enumerate(mask):
        x = 0
        while x < len(row):
            while x < len(row) and not row[x]:
                x += 1
            if x >= len(row):
                break
            start = x
            while x < len(row) and row[x]:
                x += 1
            commands.append(
                f"M{x_offset + start * scale:.2f} {y_offset + y * scale:.2f}"
                f"h{(x - start) * scale:.2f}v{scale:.2f}h-{(x - start) * scale:.2f}z"
            )
    return "".join(commands)


def render_contact_sheet(records: list[dict], selected: list[int], assignments: np.ndarray, columns: int) -> str:
    cell_width, cell_height = 250, 260
    rows = math.ceil(len(selected) / columns)
    cells = []
    for basin_index, sample_index in enumerate(selected):
        record = records[sample_index]
        x = (basin_index % columns) * cell_width
        y = (basin_index // columns) * cell_height
        mask = record["descriptor"]["canonicalMask"]
        scale = min(180 / mask.shape[1], 180 / mask.shape[0])
        path = mask_svg_path(mask, x + 35, y + 24, scale)
        metrics = record["descriptor"]["metrics"]
        cluster_size = int((assignments == basin_index).sum())
        cells.append(f'''<g data-basin="{basin_index}" data-shape="{record['shapeId']}">
          <rect x="{x + 6}" y="{y + 6}" width="238" height="248" rx="4" fill="#111714" stroke="#405247"/>
          <path d="{path}" fill="#d8edb0"/>
          <text x="{x + 12}" y="{y + 216}" fill="#f4c75b" font-family="Menlo, monospace" font-size="12">B{basin_index:02d} · n={cluster_size}</text>
          <text x="{x + 12}" y="{y + 234}" fill="#9fb0a4" font-family="Menlo, monospace" font-size="9">asp {metrics['principalAspect']:.2f} · peaks {metrics['radialPeakCount']} · holes {record['descriptor']['topology']['holes']}</text>
          <text x="{x + 12}" y="{y + 248}" fill="#718177" font-family="Menlo, monospace" font-size="8">{record['corpusLabel']} · {record['shapeId'][7:19]}</text>
        </g>''')
    width = columns * cell_width
    height = rows * cell_height
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" data-route="{EFFECTIVE_ROUTE}">
      <rect width="100%" height="100%" fill="#07100c"/>
      {''.join(cells)}
    </svg>'''


def rasterize_svg(svg_path: Path, png_path: Path) -> None:
    result = subprocess.run(["sips", "-s", "format", "png", str(svg_path), "--out", str(png_path)], capture_output=True, text=True)
    if result.returncode != 0 or not png_path.is_file() or png_path.stat().st_size == 0:
        detail = (result.stderr or result.stdout or "sips produced no PNG").strip()
        raise RuntimeError(f"atlas rasterization failed: {detail}")


def load_corpora(corpus_dirs: list[Path]) -> tuple[list[dict], list[dict]]:
    records = []
    corpora = []
    seen_shapes = set()
    for corpus_index, corpus_dir in enumerate(corpus_dirs):
        receipt_path = corpus_dir / "receipt.json"
        index_path = corpus_dir / "training-index.jsonl"
        receipt = json.loads(receipt_path.read_text())
        if receipt.get("status") not in ("complete", "partial"):
            raise ValueError(f"{receipt_path} has unusable status {receipt.get('status')!r}")
        if receipt.get("routeIdentity", {}).get("effectiveRoute") != "kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0":
            raise ValueError(f"{receipt_path} has an unexpected effective route")
        rows = [json.loads(line) for line in index_path.read_text().splitlines() if line.strip()]
        if int(receipt.get("acceptedSourceCount", -1)) != len(rows):
            raise ValueError(f"{receipt_path} accepted count does not match training index")
        label = corpus_dir.name
        corpora.append({
            "corpusIndex": corpus_index,
            "label": label,
            "path": str(corpus_dir.resolve()),
            "receiptHash": sha256_bytes(receipt_path.read_bytes()),
            "trainingIndexHash": sha256_bytes(index_path.read_bytes()),
            "acceptedSourceCount": len(rows),
            "failedSourceCount": int(receipt.get("failedSourceCount", 0)),
            "effectiveRoute": receipt["routeIdentity"]["effectiveRoute"],
        })
        for row_index, row in enumerate(rows):
            shape_id = str(row.get("shapeId", ""))
            if shape_id in seen_shapes:
                continue
            mask_path = corpus_dir / str(row.get("mask", {}).get("path", ""))
            if not mask_path.is_file():
                raise FileNotFoundError(f"missing mask {mask_path}")
            mask = read_pgm(mask_path)
            descriptor = describe_silhouette(mask)
            seen_shapes.add(shape_id)
            records.append({
                "corpusIndex": corpus_index,
                "corpusLabel": label,
                "rowIndex": row_index,
                "shapeId": shape_id,
                "maskPath": str(mask_path),
                "maskHash": sha256_bytes(mask.astype(np.uint8).tobytes()),
                "descriptor": descriptor,
            })
    if len(records) < 4:
        raise ValueError("morphology basin atlas requires at least four unique silhouettes")
    return records, corpora


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    receipt_path = out_dir / "receipt.json"
    receipt = {
        "schema": SCHEMA,
        "status": "running",
        "phase": "initializing",
        "lastTrustworthyEvidence": "receipt_initialized",
        "routeIdentity": {"requestedRoute": REQUESTED_ROUTE, "effectiveRoute": EFFECTIVE_ROUTE},
        "requestedConfig": {"corpusDirs": args.corpus_dir, "basins": args.basins, "columns": args.columns},
        "falseClosureGuards": {
            "sourceIdentityUsedInDescriptor": False,
            "sourceAppearanceUsedInDescriptor": False,
            "allTrainingIndexesConsumed": False,
            "descriptorValuesFinite": False,
            "uniqueShapeIds": False,
            "atlasEligibilityAssayed": False,
            "medoidsAllEligible": False,
            "contactSheetRasterWritten": False,
        },
    }
    write_json(receipt_path, receipt)
    try:
        receipt["phase"] = "loading_corpora"
        write_json(receipt_path, receipt)
        records, corpora = load_corpora([Path(value).resolve() for value in args.corpus_dir])
        receipt["lastTrustworthyEvidence"] = "corpus_receipts_and_training_indexes_validated"
        write_json(receipt_path, receipt)
        descriptors = [record["descriptor"] for record in records]
        eligible_indexes = np.array([
            index for index, descriptor in enumerate(descriptors)
            if descriptor["atlasEligibility"]["eligible"]
        ], dtype=np.int64)
        if len(eligible_indexes) < 4:
            raise ValueError(f"morphology basin atlas found only {len(eligible_indexes)} eligible silhouettes")
        eligible_descriptors = [descriptors[int(index)] for index in eligible_indexes]
        vectors = standardized_vectors(descriptors, eligible_descriptors)
        if not np.isfinite(vectors).all():
            raise ValueError("descriptor matrix contains non-finite values")
        receipt["lastTrustworthyEvidence"] = "eligible_descriptor_matrix_finite"
        write_json(receipt_path, receipt)
        distances = distance_matrix(vectors)
        eligible_distances = distances[np.ix_(eligible_indexes, eligible_indexes)]
        selected = [
            int(eligible_indexes[index])
            for index in maximin_indexes(eligible_distances, args.basins)
        ]
        receipt["lastTrustworthyEvidence"] = "eligible_medoids_selected"
        write_json(receipt_path, receipt)
        medoid_distances = distances[:, selected]
        assignments = np.argmin(medoid_distances, axis=1)
        assignment_distances = medoid_distances[np.arange(len(records)), assignments]
        basin_rows = []
        for basin_index, sample_index in enumerate(selected):
            members = np.flatnonzero(assignments == basin_index)
            provider_counts = {}
            for member in members:
                label = records[int(member)]["corpusLabel"]
                provider_counts[label] = provider_counts.get(label, 0) + 1
            descriptor = records[sample_index]["descriptor"]
            basin_rows.append({
                "basinIndex": basin_index,
                "medoidShapeId": records[sample_index]["shapeId"],
                "medoidMaskHash": records[sample_index]["maskHash"],
                "medoidCorpus": records[sample_index]["corpusLabel"],
                "clusterSize": int(len(members)),
                "providerCounts": provider_counts,
                "maximumMemberDistance": round(float(assignment_distances[members].max()), 6),
                "meanMemberDistance": round(float(assignment_distances[members].mean()), 6),
                "metrics": {key: round(float(value), 6) for key, value in descriptor["metrics"].items()},
                "topology": descriptor["topology"],
                "atlasEligibility": descriptor["atlasEligibility"],
            })
        assignment_rows = []
        for index, record in enumerate(records):
            assignment_rows.append({
                "shapeId": record["shapeId"],
                "maskHash": record["maskHash"],
                "corpusIndex": record["corpusIndex"],
                "basinIndex": int(assignments[index]),
                "distanceToMedoid": round(float(assignment_distances[index]), 6),
                "metrics": {key: round(float(value), 6) for key, value in record["descriptor"]["metrics"].items()},
                "topology": record["descriptor"]["topology"],
                "atlasEligibility": record["descriptor"]["atlasEligibility"],
            })
        write_json(out_dir / "basins.json", {"schema": f"{SCHEMA}.basins", "basins": basin_rows})
        write_jsonl(out_dir / "assignments.jsonl", assignment_rows)
        svg_path = out_dir / "contact-sheet.svg"
        png_path = out_dir / "contact-sheet.png"
        svg_path.write_text(render_contact_sheet(records, selected, assignments, args.columns))
        rasterize_svg(svg_path, png_path)
        receipt["lastTrustworthyEvidence"] = "contact_sheet_raster_written"
        receipt.update({
            "status": "complete",
            "phase": "witness_written",
            "effectiveConfig": {"basins": len(selected), "columns": args.columns, "descriptorCount": len(DESCRIPTOR_NAMES), "descriptorNames": DESCRIPTOR_NAMES},
            "sourceCorpora": corpora,
            "uniqueShapeCount": len(records),
            "deduplicatedShapeCount": sum(corpus["acceptedSourceCount"] for corpus in corpora) - len(records),
            "eligibleMedoidCandidateCount": int(len(eligible_indexes)),
            "excludedMedoidCandidateCount": int(len(records) - len(eligible_indexes)),
            "exclusionReasonCounts": {
                reason: sum(
                    reason in descriptor["atlasEligibility"]["reasons"]
                    for descriptor in descriptors
                )
                for reason in sorted({
                    reason
                    for descriptor in descriptors
                    for reason in descriptor["atlasEligibility"]["reasons"]
                })
            },
            "basinCount": len(selected),
            "coverage": {
                "meanDistanceToMedoid": round(float(assignment_distances.mean()), 6),
                "medianDistanceToMedoid": round(float(np.median(assignment_distances)), 6),
                "maximumDistanceToMedoid": round(float(assignment_distances.max()), 6),
                "eligibleMeanDistanceToMedoid": round(float(assignment_distances[eligible_indexes].mean()), 6),
                "eligibleMedianDistanceToMedoid": round(float(np.median(assignment_distances[eligible_indexes])), 6),
                "eligibleMaximumDistanceToMedoid": round(float(assignment_distances[eligible_indexes].max()), 6),
                "minimumIntermedoidDistance": round(float(distances[np.ix_(selected, selected)][np.triu_indices(len(selected), 1)].min()), 6) if len(selected) > 1 else 0.0,
            },
            "artifacts": {
                "basins": {"path": "basins.json", "sha256": sha256_bytes((out_dir / "basins.json").read_bytes())},
                "assignments": {"path": "assignments.jsonl", "sha256": sha256_bytes((out_dir / "assignments.jsonl").read_bytes())},
                "contactSheet": {"path": "contact-sheet.png", "sha256": sha256_bytes(png_path.read_bytes()), "bytes": png_path.stat().st_size},
            },
        })
        receipt["falseClosureGuards"].update({
            "allTrainingIndexesConsumed": True,
            "descriptorValuesFinite": True,
            "uniqueShapeIds": len({record["shapeId"] for record in records}) == len(records),
            "atlasEligibilityAssayed": all("atlasEligibility" in descriptor for descriptor in descriptors),
            "medoidsAllEligible": all(descriptors[index]["atlasEligibility"]["eligible"] for index in selected),
            "contactSheetRasterWritten": True,
        })
        write_json(receipt_path, receipt)
        return 0
    except Exception as error:
        receipt.update({"status": "failed", "failurePhase": receipt.get("phase"), "error": str(error)})
        write_json(receipt_path, receipt)
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
