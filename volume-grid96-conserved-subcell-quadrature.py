#!/usr/bin/env python3
"""Conserved camera-independent subcell quadrature for exact Grid96 support.

This is a CPU evidence harness. It keeps the r7 analytical support and exact
local optical coefficients fixed, replaces the incumbent projected five-tap
footprint with world-space child centers, and renders the same frozen 21-camera
cohort. It is not a shipping Gaussian implementation or deposition verdict.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.grid96-conserved-subcell-quadrature.v0"
BASELINE_SCHEMA = "kaminos.volume.layer-coefficient-render-oracle.v0"
PLAN_IDENTITY = "camera-independent-world-subcell-flow-lineage-v0"
IMPORTANCE_IDENTITY = "exact-optical-plus-flow-descriptor-rank-v0"
RASTER_IDENTITY = "independent-world-child-projection-and-depth-bin-v0"
ARMS = {
    "world5": {"label": "World-space 5, equal budget", "count": 5, "adaptive": False},
    "sheet5": {"label": "World sheet-cross 5, equal budget", "count": 5, "adaptive": False, "geometry": "sheet-cross"},
    "adaptive357": {"label": "World-space 3/5/7, equal budget", "count": None, "adaptive": True},
    "world7": {"label": "World-space 7, +40% child budget", "count": 7, "adaptive": False},
}
PATTERNS = {
    3: {
        "offsets": np.asarray((-1.0, 0.0, 1.0), dtype=np.float32),
        "weights": np.asarray((0.25, 0.5, 0.25), dtype=np.float32),
    },
    5: {
        "offsets": np.asarray((-1.0, -0.5, 0.0, 0.5, 1.0), dtype=np.float32),
        "weights": np.asarray((0.075, 0.225, 0.4, 0.225, 0.075), dtype=np.float32),
    },
    7: {
        "offsets": np.asarray((-1.0, -2 / 3, -1 / 3, 0.0, 1 / 3, 2 / 3, 1.0), dtype=np.float32),
        "weights": np.asarray((0.025, 0.1, 0.225, 0.3, 0.225, 0.1, 0.025), dtype=np.float32),
    },
}


def load_oracle() -> Any:
    path = Path(__file__).with_name("volume-layer-coefficient-render-oracle.py")
    spec = importlib.util.spec_from_file_location("kaminos_grid96_bound_render_oracle", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load rendering oracle: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ORACLE = load_oracle()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_arrays(*arrays: np.ndarray) -> str:
    digest = hashlib.sha256()
    for array in arrays:
        contiguous = np.ascontiguousarray(array)
        digest.update(str(contiguous.dtype).encode("ascii"))
        digest.update(np.asarray(contiguous.shape, dtype="<u8").tobytes())
        digest.update(contiguous.tobytes())
    return digest.hexdigest()


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except Exception as exc:
        raise ValueError(f"{label} JSON could not be read: {exc}") from exc
    require(isinstance(value, dict), f"{label} must be a JSON object")
    return value


def rank01(values: np.ndarray, native_ids: np.ndarray) -> np.ndarray:
    source = np.asarray(values, dtype=np.float64)
    ids = np.asarray(native_ids, dtype=np.uint32)
    require(source.ndim == 1 and source.size == ids.size, "rank source must match native identities")
    require(np.all(np.isfinite(source)), "rank source contains nonfinite values")
    order = np.lexsort((ids.astype(np.uint64), source))
    ranks = np.empty(source.size, dtype=np.float32)
    if source.size <= 1:
        ranks.fill(0.5)
    else:
        ranks[order] = np.linspace(0.0, 1.0, source.size, dtype=np.float32)
    return ranks


def camera_independent_importance(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    descriptors: np.ndarray,
) -> tuple[np.ndarray, dict[str, Any]]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    coeff = np.asarray(coefficients, dtype=np.float32)
    desc = np.asarray(descriptors, dtype=np.float32)
    require(coeff.shape == (ids.size, 8), "coefficient rows must have eight channels")
    require(desc.ndim == 2 and desc.shape[0] == ids.size and desc.shape[1] >= 36, "descriptor rows are incomplete")
    require(np.all(np.isfinite(coeff)) and np.all(coeff >= 0.0), "coefficients must be finite and nonnegative")
    require(np.all(np.isfinite(desc[:, [23, 29, 35]])), "importance descriptors contain nonfinite values")
    luma = np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float32)
    optical = coeff[:, 0:3] @ luma + coeff[:, 4:7] @ luma + 0.5 * (coeff[:, 3] + coeff[:, 7])
    components = {
        "optical": rank01(optical, ids),
        "majorantImportance": rank01(np.maximum(desc[:, 35], 0.0), ids),
        "curlActivity": rank01(np.maximum(desc[:, 29], 0.0), ids),
        "flowCoherence": rank01(np.clip(desc[:, 23], 0.0, 1.0), ids),
    }
    score = (
        0.60 * components["optical"]
        + 0.15 * components["majorantImportance"]
        + 0.15 * components["curlActivity"]
        + 0.10 * components["flowCoherence"]
    ).astype(np.float32)
    return score, {
        "identity": IMPORTANCE_IDENTITY,
        "cameraIndependent": True,
        "targetImageUsed": False,
        "weights": {"optical": 0.60, "majorantImportance": 0.15, "curlActivity": 0.15, "flowCoherence": 0.10},
        "score": {"min": float(score.min()), "max": float(score.max()), "mean": float(score.mean())},
        "scoreSha256": sha256_arrays(ids, score),
    }


def balanced_adaptive_counts(
    native_ids: np.ndarray,
    importance: np.ndarray,
    adaptive_fraction: float = 0.25,
) -> np.ndarray:
    ids = np.asarray(native_ids, dtype=np.uint32)
    score = np.asarray(importance, dtype=np.float64)
    require(ids.ndim == score.ndim == 1 and ids.size == score.size and ids.size > 0, "adaptive inputs must be paired rows")
    require(np.unique(ids).size == ids.size, "adaptive identities must be unique")
    require(np.all(np.isfinite(score)), "adaptive importance contains nonfinite values")
    require(0.0 <= adaptive_fraction <= 0.5, "adaptive fraction must be in [0,0.5]")
    exchange = min(int(math.floor(ids.size * adaptive_fraction)), ids.size // 2)
    counts = np.full(ids.size, 5, dtype=np.int16)
    if exchange:
        order = np.lexsort((ids.astype(np.uint64), score))
        counts[order[:exchange]] = 3
        counts[order[-exchange:]] = 7
    require(int(np.sum(counts, dtype=np.int64)) == ids.size * 5, "adaptive counts changed equal budget")
    return counts


def deterministic_axis(native_id: int, normal: np.ndarray | None) -> np.ndarray:
    axes = np.eye(3, dtype=np.float32)
    start = int(native_id) % 3
    candidates = np.roll(axes, -start, axis=0)
    if normal is None:
        return candidates[0]
    lengths = np.linalg.norm(candidates - (candidates @ normal)[:, None] * normal[None, :], axis=1)
    return candidates[int(np.argmax(lengths))]


def structure_tangent_directions(
    native_ids: np.ndarray,
    tangents: np.ndarray,
    normals: np.ndarray,
    normal_valid: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    source_tangent = np.asarray(tangents, dtype=np.float32)
    source_normal = np.asarray(normals, dtype=np.float32)
    valid_normal = np.asarray(normal_valid, dtype=bool)
    require(source_tangent.shape == source_normal.shape == (ids.size, 3), "direction rows must be three-vectors")
    require(valid_normal.shape == (ids.size,), "normal validity must match rows")
    require(np.all(np.isfinite(source_tangent)) and np.all(np.isfinite(source_normal)), "direction inputs contain nonfinite values")
    directions = source_tangent.astype(np.float64)
    fallback = np.zeros(ids.size, dtype=bool)
    normal_lengths = np.linalg.norm(source_normal.astype(np.float64), axis=1)
    usable_normal = valid_normal & np.isfinite(normal_lengths) & (normal_lengths > 1e-8)
    unit_normals = np.zeros_like(directions)
    unit_normals[usable_normal] = source_normal[usable_normal] / normal_lengths[usable_normal, None]
    normal_projection = np.sum(directions * unit_normals, axis=1)
    directions[usable_normal] -= normal_projection[usable_normal, None] * unit_normals[usable_normal]
    lengths = np.linalg.norm(directions, axis=1)
    fallback_rows = np.flatnonzero(~np.isfinite(lengths) | (lengths <= 1e-8))
    for row in fallback_rows:
        fallback[row] = True
        normal = unit_normals[row] if usable_normal[row] else None
        tangent = deterministic_axis(int(ids[row]), normal).astype(np.float64)
        if normal is not None:
            tangent -= float(np.dot(tangent, normal)) * normal
        directions[row] = tangent
    lengths = np.linalg.norm(directions, axis=1)
    require(np.all(np.isfinite(lengths)) and np.all(lengths > 1e-8), "one or more native cells have no deterministic tangent")
    directions /= lengths[:, None]
    return directions.astype(np.float32), fallback


def sheet_binormal_directions(
    native_ids: np.ndarray,
    sheet_tangents: np.ndarray,
    normals: np.ndarray,
    normal_valid: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    tangents = np.asarray(sheet_tangents, dtype=np.float64)
    source_normals = np.asarray(normals, dtype=np.float64)
    valid = np.asarray(normal_valid, dtype=bool)
    require(tangents.shape == source_normals.shape == (ids.size, 3), "sheet basis rows must be three-vectors")
    normal_lengths = np.linalg.norm(source_normals, axis=1)
    usable = valid & np.isfinite(normal_lengths) & (normal_lengths > 1e-8)
    unit_normals = np.zeros_like(source_normals)
    unit_normals[usable] = source_normals[usable] / normal_lengths[usable, None]
    binormals = np.cross(unit_normals, tangents)
    lengths = np.linalg.norm(binormals, axis=1)
    fallback = ~usable | ~np.isfinite(lengths) | (lengths <= 1e-8)
    for row in np.flatnonzero(fallback):
        axis = deterministic_axis(int(ids[row]) + 1, tangents[row]).astype(np.float64)
        candidate = axis - float(np.dot(axis, tangents[row])) * tangents[row]
        length = float(np.linalg.norm(candidate))
        if length <= 1e-8:
            axis = deterministic_axis(int(ids[row]) + 2, tangents[row]).astype(np.float64)
            candidate = axis - float(np.dot(axis, tangents[row])) * tangents[row]
        binormals[row] = candidate
    lengths = np.linalg.norm(binormals, axis=1)
    require(np.all(np.isfinite(lengths)) and np.all(lengths > 1e-8), "one or more native cells have no deterministic sheet binormal")
    binormals /= lengths[:, None]
    require(np.all(np.abs(np.sum(binormals * tangents, axis=1)) <= 1e-6), "sheet binormal is not orthogonal to tangent")
    return binormals.astype(np.float32), fallback


def world_child_plan(
    *,
    native_ids: np.ndarray,
    positions: np.ndarray,
    tangents: np.ndarray,
    normals: np.ndarray,
    normal_valid: np.ndarray,
    radii: np.ndarray,
    coefficients: np.ndarray,
    counts: np.ndarray,
    geometry: str = "flow-line",
) -> dict[str, Any]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    centers = np.asarray(positions, dtype=np.float64)
    radius = np.asarray(radii, dtype=np.float32)
    coeff = np.asarray(coefficients, dtype=np.float32)
    child_counts = np.asarray(counts, dtype=np.int16)
    require(
        centers.shape == (ids.size, 3) and np.all(np.isfinite(centers)),
        "parent positions must be finite three-vectors matching native identities",
    )
    require(radius.shape == (ids.size,) and np.all(np.isfinite(radius)) and np.all(radius > 0.0), "world radii must be positive finite rows")
    require(coeff.shape == (ids.size, 8), "parent coefficients must have eight channels")
    require(np.all(np.isfinite(coeff)) and np.all(coeff >= 0.0), "parent coefficients must be finite and nonnegative")
    require(child_counts.shape == (ids.size,) and np.all(np.isin(child_counts, tuple(PATTERNS))), "child counts must use reviewed 3/5/7 patterns")
    require(geometry in {"flow-line", "sheet-cross"}, "world child geometry must be flow-line or sheet-cross")
    require(geometry != "sheet-cross" or np.all(child_counts == 5), "sheet-cross currently requires exactly five children per parent")
    directions, fallback = structure_tangent_directions(ids, tangents, normals, normal_valid)
    parent_rows = np.repeat(np.arange(ids.size, dtype=np.int32), child_counts)
    # Position arithmetic stays float64 so a child at exactly one declared
    # radius cannot round outside that radius before projection.
    slots = np.arange(7, dtype=np.int16)[None, :]
    active_slots = slots < child_counts[:, None]
    weight_slots = np.zeros((ids.size, 7), dtype=np.float32)
    binormal_fallback = np.zeros(ids.size, dtype=bool)
    if geometry == "flow-line":
        offset_slots = np.zeros((ids.size, 7), dtype=np.float32)
        for count in (3, 5, 7):
            rows = np.flatnonzero(child_counts == count)
            if rows.size == 0:
                continue
            pattern = PATTERNS[count]
            offset_slots[rows, :count] = pattern["offsets"][None, :]
            weight_slots[rows, :count] = pattern["weights"][None, :]
        child_offsets = offset_slots[active_slots]
        child_positions = (
            centers[parent_rows]
            + child_offsets[:, None].astype(np.float64)
            * radius[parent_rows, None].astype(np.float64)
            * directions[parent_rows].astype(np.float64)
        )
    else:
        binormals, binormal_fallback = sheet_binormal_directions(ids, directions, normals, normal_valid)
        vector_slots = np.zeros((ids.size, 7, 3), dtype=np.float64)
        vector_slots[:, 1, :] = directions
        vector_slots[:, 2, :] = -directions
        vector_slots[:, 3, :] = binormals
        vector_slots[:, 4, :] = -binormals
        weight_slots[:, :5] = np.asarray((0.4, 0.15, 0.15, 0.15, 0.15), dtype=np.float32)
        child_positions = centers[parent_rows] + vector_slots[active_slots] * radius[parent_rows, None]
    # Boolean flattening is row-major, so this exactly matches np.repeat's
    # contiguous parent lineage without camera-dependent regrouping.
    child_weights = weight_slots[active_slots]
    child_coefficients = coeff[parent_rows] * child_weights[:, None]
    require(np.all(np.isfinite(child_positions)), "child positions contain nonfinite values")
    require(np.all(np.isfinite(child_coefficients)) and np.all(child_coefficients >= 0.0), "child coefficients are invalid")
    sums = np.zeros_like(coeff, dtype=np.float64)
    np.add.at(sums, parent_rows, child_coefficients.astype(np.float64))
    conservation = np.abs(sums - coeff.astype(np.float64))
    max_error = float(np.max(conservation, initial=0.0))
    require(max_error <= 1e-6, f"per-parent coefficient conservation error {max_error} exceeds tolerance")
    offsets = child_positions - centers[parent_rows]
    require(np.all(np.linalg.norm(offsets, axis=1) <= radius[parent_rows] + 1e-7), "world child escaped parent radius")
    return {
        "parentRows": parent_rows,
        "childNativeIds": ids[parent_rows],
        "childPositions": child_positions,
        "childWeights": child_weights,
        "childCoefficients": child_coefficients,
        "receipt": {
            "identity": PLAN_IDENTITY,
            "geometry": geometry,
            "cameraIndependent": True,
            "parentCount": int(ids.size),
            "childCount": int(parent_rows.size),
            "countHistogram": {str(count): int(np.count_nonzero(child_counts == count)) for count in (3, 5, 7)},
            "nominalFiveChildBudget": int(ids.size * 5),
            "childBudgetRatioToFive": float(parent_rows.size / (ids.size * 5)),
            "droppedParentCount": 0,
            "fallbackDirectionCount": int(np.count_nonzero(fallback)),
            "fallbackBinormalCount": int(np.count_nonzero(binormal_fallback)),
            "maxPerParentCoefficientConservationError": max_error,
            "globalCoefficientSumBefore": np.sum(coeff, axis=0, dtype=np.float64).tolist(),
            "globalCoefficientSumAfter": np.sum(child_coefficients, axis=0, dtype=np.float64).tolist(),
            "maxWorldOffset": float(np.max(np.linalg.norm(offsets, axis=1), initial=0.0)),
            "planSha256": sha256_arrays(ids, child_counts, parent_rows, child_positions, child_weights),
        },
    }


def rasterize_world_children(
    plan: dict[str, Any],
    camera: dict[str, Any],
    depth_bins: int,
    footprint_mode: str,
) -> tuple[np.ndarray, dict[str, Any]]:
    require(footprint_mode in {"nearest", "bilinear"}, "footprint mode must be nearest or bilinear")
    positions = np.asarray(plan["childPositions"], dtype=np.float32)
    coefficients = np.asarray(plan["childCoefficients"], dtype=np.float32)
    width, height = int(camera["width"]), int(camera["height"])
    pose = camera["cameraPose"]
    ndc, depth, project_valid = ORACLE.project(positions, pose["matrixWorldInverse"], pose["projectionMatrix"])
    pixel_x = (ndc[:, 0] * 0.5 + 0.5) * width
    pixel_y = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height
    finite_depth = np.isfinite(depth)
    if footprint_mode == "nearest":
        samples = [(np.floor(pixel_x).astype(np.int32), np.floor(pixel_y).astype(np.int32), np.ones(positions.shape[0], dtype=np.float32))]
    else:
        samples = ORACLE.bilinear_pixel_samples(pixel_x, pixel_y)
    eligible = project_valid & finite_depth
    visible = np.zeros(positions.shape[0], dtype=bool)
    for sample_x, sample_y, sample_weight in samples:
        in_bounds = (sample_x >= 0) & (sample_x < width) & (sample_y >= 0) & (sample_y < height)
        visible |= eligible & (sample_weight > 0.0) & in_bounds
    depth_rows = np.flatnonzero(visible)
    require(depth_rows.size > 0, f"camera {camera['cameraIndex']} projected zero in-frame world children")
    near = float(np.percentile(depth[depth_rows], 0.01))
    far = float(np.percentile(depth[depth_rows], 99.99))
    depth_index = np.clip(((depth - near) / max(far - near, 1e-6) * (depth_bins - 1)).astype(np.int32), 0, depth_bins - 1)
    raster_size = depth_bins * height * width
    planes = np.zeros((depth_bins, height, width, 8), dtype=np.float32)
    in_bounds_deposits = 0
    out_of_frame_deposits = 0
    total_charge = np.sum(coefficients, axis=0, dtype=np.float64)
    retained_charge = np.zeros(8, dtype=np.float64)
    out_of_frame_charge = np.zeros(8, dtype=np.float64)
    invalid_projection_charge = np.sum(coefficients[~eligible], axis=0, dtype=np.float64)
    for sample_x, sample_y, sample_weight in samples:
        sample_eligible = eligible & (sample_weight > 0.0)
        in_bounds = (sample_x >= 0) & (sample_x < width) & (sample_y >= 0) & (sample_y < height)
        selected = sample_eligible & in_bounds
        rows = np.flatnonzero(selected)
        in_bounds_deposits += int(rows.size)
        clipped_rows = np.flatnonzero(sample_eligible & ~in_bounds)
        out_of_frame_deposits += int(clipped_rows.size)
        flat = ((depth_index[rows] * height + sample_y[rows]) * width + sample_x[rows]).astype(np.int64)
        weights = sample_weight[rows]
        retained_charge += np.sum(coefficients[rows] * weights[:, None], axis=0, dtype=np.float64)
        out_of_frame_charge += np.sum(
            coefficients[clipped_rows] * sample_weight[clipped_rows, None], axis=0, dtype=np.float64
        )
        for channel in range(8):
            planes[..., channel] += ORACLE.scatter_channel(
                flat, coefficients[rows, channel] * weights, raster_size
            ).reshape(depth_bins, height, width)
    accounted_charge = retained_charge + out_of_frame_charge + invalid_projection_charge
    closure_error = np.abs(accounted_charge - total_charge)
    total_scalar_charge = float(np.sum(total_charge))
    per_channel_fraction = np.divide(
        retained_charge,
        total_charge,
        out=np.ones_like(retained_charge),
        where=total_charge > 0.0,
    )
    return planes, {
        "identity": RASTER_IDENTITY,
        "cameraIndex": int(camera["cameraIndex"]),
        "childCount": int(positions.shape[0]),
        "independentChildDepth": True,
        "nearDepth": near,
        "farDepth": far,
        "depthBins": int(depth_bins),
        "footprintMode": footprint_mode,
        "nominalDepositEvaluations": int(positions.shape[0] * (1 if footprint_mode == "nearest" else 4)),
        "inBoundsDepositEvaluations": in_bounds_deposits,
        "outOfFrameDepositEvaluations": out_of_frame_deposits,
        "depthCalibrationChildCount": int(depth_rows.size),
        "depthCalibrationAuthority": "in-frame-positive-footprint-children-only-v0",
        "totalCoefficientCharge": total_charge.tolist(),
        "retainedCoefficientCharge": retained_charge.tolist(),
        "depositedCoefficientCharge": retained_charge.tolist(),
        "outOfFrameCoefficientCharge": out_of_frame_charge.tolist(),
        "invalidProjectionCoefficientCharge": invalid_projection_charge.tolist(),
        "retainedCoefficientChargeFraction": (
            float(np.sum(retained_charge) / total_scalar_charge) if total_scalar_charge > 0.0 else 1.0
        ),
        "retainedCoefficientChargeFractionByChannel": per_channel_fraction.tolist(),
        "coefficientChargeClosureMaxAbsError": float(np.max(closure_error, initial=0.0)),
    }


def persist_source(source: Path, destination: Path) -> np.ndarray:
    pixels = ORACLE.image_rgb(source)
    ORACLE.write_png(destination, pixels)
    return pixels


def validate_descriptor_binding(
    descriptor_receipt: dict[str, Any],
    state_replay: dict[str, Any],
    baseline_binding: dict[str, Any],
    baseline_descriptor_receipt: dict[str, Any],
) -> dict[str, Any]:
    source_hashes = descriptor_receipt.get("sourceHashes") or {}
    baseline_source_hashes = baseline_descriptor_receipt.get("sourceHashes") or {}
    require(source_hashes and source_hashes == baseline_source_hashes, "descriptor source hash set differs from baseline")
    require(
        source_hashes.get("fluidSha256")
        == state_replay.get("fluidSha256")
        == baseline_binding.get("fluidSha256"),
        "descriptor fluid hash differs from frozen source",
    )
    require(
        source_hashes.get("frontSha256")
        == state_replay.get("frontSha256")
        == baseline_binding.get("frontSha256"),
        "descriptor front hash differs from frozen source",
    )
    source_manifest_sha256 = descriptor_receipt.get("sourceManifestSha256")
    require(
        source_manifest_sha256
        and source_manifest_sha256 == baseline_descriptor_receipt.get("sourceManifestSha256"),
        "descriptor source manifest differs from baseline",
    )
    return {
        "identity": "descriptor-source-equals-baseline-frozen-source-v0",
        "sourceHashes": source_hashes,
        "sourceManifestSha256": source_manifest_sha256,
        "hashMatch": True,
    }


def gallery_html(camera_rows: list[dict[str, Any]], report_name: str) -> str:
    data = canonical_json(camera_rows)
    labels = {"target": "Exact Grid96 target", "baseline": "Projected five-tap control"}
    labels.update({key: value["label"] for key, value in ARMS.items()})
    labels.update({f"{key}Residual": f"{value['label']} residual" for key, value in ARMS.items()})
    options = "".join(f'<option value="{key}">{label}</option>' for key, label in labels.items())
    return f"""<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Grid96 conserved subcell quadrature</title><style>
:root{{--bg:#0b0d0e;--panel:#151819;--line:#353b3d;--text:#f3f1eb;--muted:#aeb6b8;--accent:#ffbc62}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.4 system-ui,sans-serif}}header{{position:sticky;top:0;z-index:2;background:var(--panel);border-bottom:1px solid var(--line);padding:10px 14px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}}h1{{font-size:15px;margin:0}}label{{display:flex;gap:6px;align-items:center;color:var(--muted)}}select,input,button{{background:#202426;color:var(--text);border:1px solid var(--line);min-height:30px}}button{{width:34px;font-size:18px}}main{{padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px}}figure{{margin:0;min-width:0}}img{{display:block;width:100%;aspect-ratio:314/242;object-fit:contain;background:#030404;border:1px solid var(--line);image-rendering:auto}}figcaption{{padding:7px 2px;color:var(--accent);font-weight:650}}aside{{grid-column:1/-1;border-top:1px solid var(--line);padding-top:10px;color:var(--muted)}}a{{color:var(--accent)}}@media(max-width:760px){{main{{grid-template-columns:1fr}}header{{position:static}}}}
</style></head><body><header><h1>Grid96 conserved world-space quadrature</h1><button id=\"prev\" title=\"Previous camera\">&#8592;</button><label>Camera <input id=\"camera\" type=\"range\" min=\"0\" max=\"20\" value=\"10\"></label><span id=\"cameraLabel\"></span><button id=\"next\" title=\"Next camera\">&#8594;</button><label>Left <select id=\"left\">{options}</select></label><label>Right <select id=\"right\">{options}</select></label></header><main><figure><img id=\"leftImage\"><figcaption id=\"leftLabel\"></figcaption></figure><figure><img id=\"rightImage\"><figcaption id=\"rightLabel\"></figcaption></figure><aside>Frozen exact r7 support and coefficients. Camera 10 path scale is reused without treatment refit. Child plans are camera-independent and coefficient-conserving. <a href=\"{report_name}\">Evidence report</a>.</aside></main><script>
const rows={data};const labels={canonical_json(labels)};const $=id=>document.getElementById(id);$('left').value='target';$('right').value='adaptive357';function render(){{const row=rows[+$('camera').value],left=$('left').value,right=$('right').value;$('cameraLabel').textContent=`${{row.cameraIndex}} / ${{row.cameraAngle.toFixed(3)}} rad`;$('leftImage').src=row.images[left];$('rightImage').src=row.images[right];$('leftLabel').textContent=labels[left];$('rightLabel').textContent=labels[right]}}for(const id of ['camera','left','right'])$(id).addEventListener('input',render);$('prev').onclick=()=>{{$('camera').value=Math.max(0,+$('camera').value-1);render()}};$('next').onclick=()=>{{$('camera').value=Math.min(20,+$('camera').value+1);render()}};render();
</script></body></html>"""


def validate_baseline(
    baseline: dict[str, Any],
    baseline_path: Path,
    manifest_path: Path,
    capture_path: Path,
    state: dict[str, Any],
    depth_bins: int = 96,
) -> tuple[Path, float]:
    require(baseline.get("schema") == BASELINE_SCHEMA and baseline.get("status") == "complete", "baseline oracle is not complete")
    requested = baseline.get("requested") or {}
    effective = baseline.get("effective") or {}
    require(Path(requested.get("manifest", "")).resolve() == manifest_path, "baseline manifest identity differs")
    require(Path(requested.get("captureReport", "")).resolve() == capture_path, "baseline capture identity differs")
    require(effective.get("stateId") == state.get("id"), "baseline state identity differs")
    require(effective.get("rowCount") == int((state.get("rows") or {}).get("count")), "baseline row count differs")
    require(effective.get("sampleCap") is None and effective.get("droppedRowCount") == 0, "baseline was capped or dropped rows")
    require(effective.get("footprintMode") == "flow-tangent-five-tap-nearest-v0", "baseline is not the projected-five nearest control")
    require(requested.get("depthBins") == depth_bins and effective.get("depthBins") == depth_bins, "baseline depth-bin identity differs")
    require(
        effective.get("orderApproximation") == f"camera-depth-{depth_bins}-bin-one-running-transmittance-v0",
        "baseline order approximation differs",
    )
    binding = baseline.get("frozenStateBinding") or {}
    replay = state.get("replay") or {}
    capture = load_json(capture_path, "capture report")
    capture_frozen = capture.get("frozenState") or {}
    capture_warmup = ((capture.get("replayAuthority") or {}).get("warmupReceipt") or {})
    require(binding.get("hashMatch") is True, "baseline frozen source binding is not authoritative")
    require(binding.get("sameStateCaptureId") == capture_frozen.get("sameStateCaptureId"), "baseline same-state capture identity differs")
    require(binding.get("controlsHash") == capture_frozen.get("controlsHash"), "baseline controls hash differs")
    require(binding.get("fluidSha256") == replay.get("fluidSha256") == capture_warmup.get("fluidSha256"), "baseline fluid hash differs")
    require(binding.get("frontSha256") == replay.get("frontSha256") == capture_warmup.get("frontSha256"), "baseline front hash differs")
    calibration = baseline.get("calibration") or {}
    require(calibration.get("cameraIndex") == 10 and float(calibration.get("pathScale", 0.0)) > 0.0, "baseline calibration is invalid")
    gallery = Path((baseline.get("artifacts") or {}).get("gallery", "")).resolve()
    require(gallery.is_file(), "baseline gallery is missing")
    return gallery.parent, float(calibration["pathScale"])


def run(args: argparse.Namespace, progress: dict[str, str]) -> dict[str, Any]:
    progress["phase"] = "source-validation"
    manifest_path = Path(args.manifest).resolve()
    capture_path = Path(args.capture_report).resolve()
    baseline_path = Path(args.baseline_report).resolve()
    manifest = load_json(manifest_path, "training manifest")
    state, paths, descriptor_receipt = ORACLE.validate_manifest(manifest, manifest_path, args.state_step, True)
    require(int((state.get("replay") or {}).get("grid", 0)) == 96, "source state is not exact Grid96")
    capture = load_json(capture_path, "capture report")
    cameras = ORACLE.validate_capture_report(capture, args.state_step)
    baseline = load_json(baseline_path, "baseline oracle report")
    descriptor_binding = validate_descriptor_binding(
        descriptor_receipt,
        state.get("replay") or {},
        baseline.get("frozenStateBinding") or {},
        baseline.get("descriptorReceipt") or {},
    )
    baseline_dir, path_scale = validate_baseline(
        baseline, baseline_path, manifest_path, capture_path, state, args.depth_bins
    )
    count = int((state.get("rows") or {}).get("count"))
    required = {"features", "coefficients", "kernelDescriptors", "nativeCellIndices"}
    require(required.issubset(paths), f"source rows are incomplete: {sorted(required - set(paths))}")
    features = np.memmap(paths["features"], dtype="<f4", mode="r", shape=(count, 24))
    coefficients = np.memmap(paths["coefficients"], dtype="<f4", mode="r", shape=(count, 8))
    descriptors = np.memmap(paths["kernelDescriptors"], dtype="<f4", mode="r", shape=(count, 100))
    native_ids = np.memmap(paths["nativeCellIndices"], dtype="<u4", mode="r", shape=(count,))
    require(np.array_equal(np.rint(descriptors[:, 3]).astype(np.uint32), native_ids), "descriptor/native identity order differs")
    normal_valid = descriptors[:, 19] > 0.5
    radii = np.asarray(descriptors[:, 14], dtype=np.float32)
    progress["phase"] = "plan-construction"
    importance, importance_receipt = camera_independent_importance(native_ids, coefficients, descriptors)
    arm_plans: dict[str, dict[str, Any]] = {}
    for key, config in ARMS.items():
        counts = (
            balanced_adaptive_counts(native_ids, importance, args.adaptive_fraction)
            if config["adaptive"]
            else np.full(count, int(config["count"]), dtype=np.int16)
        )
        arm_plans[key] = world_child_plan(
            native_ids=native_ids,
            positions=descriptors[:, 0:3],
            tangents=descriptors[:, 20:23],
            normals=descriptors[:, 16:19],
            normal_valid=normal_valid,
            radii=radii,
            coefficients=coefficients,
            counts=counts,
            geometry=config.get("geometry", "flow-line"),
        )

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    metrics = []
    progress["phase"] = "camera-rasterization"
    for camera in cameras:
        camera_index = int(camera["cameraIndex"])
        prefix = f"camera-{camera_index:02d}"
        target_capture = ORACLE.find_capture(capture, camera_index, "sharedTransmittanceContributionSum", 160)
        target_name = f"{prefix}-target.png"
        baseline_name = f"{prefix}-projected-five-control.png"
        target = persist_source(Path(target_capture["imagePath"]), out_dir / target_name)
        baseline_source = baseline_dir / f"{prefix}-expanded-shared-transport.png"
        require(baseline_source.is_file(), f"baseline camera {camera_index} image is missing")
        baseline_pixels = persist_source(baseline_source, out_dir / baseline_name)
        images = {"target": target_name, "baseline": baseline_name}
        camera_metrics: dict[str, Any] = {"baseline": ORACLE.image_metrics(baseline_pixels, target)}
        for arm_key, plan in arm_plans.items():
            planes, raster_receipt = rasterize_world_children(plan, camera, args.depth_bins, args.footprint_mode)
            linear, _, _, transmittance = ORACLE.compose_planes(planes, path_scale, "total")
            rendered = ORACLE.tone_map(linear)
            image_name = f"{prefix}-{arm_key}.png"
            residual_name = f"{prefix}-{arm_key}-residual.png"
            ORACLE.write_png(out_dir / image_name, rendered)
            ORACLE.write_png(out_dir / residual_name, ORACLE.residual_heatmap(rendered, target))
            images[arm_key] = image_name
            images[f"{arm_key}Residual"] = residual_name
            camera_metrics[arm_key] = {
                **ORACLE.image_metrics(rendered, target),
                "raster": raster_receipt,
                "meanFinalTransmittance": float(np.mean(transmittance)),
            }
            del planes, linear, rendered, transmittance
        rows.append({
            "cameraIndex": camera_index,
            "cameraAngle": float(camera["cameraAngle"]),
            "split": "calibration" if camera_index == 10 else "heldOut",
            "images": images,
        })
        metrics.append({"cameraIndex": camera_index, "cameraAngle": float(camera["cameraAngle"]), **camera_metrics})
        print(json.dumps({"camera": camera_index, "status": "rendered"}), flush=True)
    held = [row for row in metrics if row["cameraIndex"] != 10]
    held_means = {
        key: {
            "mae": float(np.mean([row[key]["mae"] for row in held])),
            "mse": float(np.mean([row[key]["mse"] for row in held])),
            "lumaMae": float(np.mean([row[key]["lumaMae"] for row in held])),
        }
        for key in ("baseline", *ARMS.keys())
    }
    report = {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "source": {
            "manifestPath": str(manifest_path),
            "manifestSha256": sha256_file(manifest_path),
            "manifestIdentity": manifest.get("identity"),
            "captureReportPath": str(capture_path),
            "captureReportSha256": sha256_file(capture_path),
            "baselineReportPath": str(baseline_path),
            "baselineReportSha256": sha256_file(baseline_path),
            "stateId": state.get("id"),
            "grid": 96,
            "stateStep": args.state_step,
            "rowCount": count,
            "descriptorReceipt": descriptor_receipt,
            "descriptorBinding": descriptor_binding,
            "baselineFrozenStateBinding": baseline.get("frozenStateBinding"),
        },
        "execution": {
            "sampleCap": None,
            "droppedParentCount": 0,
            "cameraCount": len(cameras),
            "cameraIndices": [int(camera["cameraIndex"]) for camera in cameras],
            "depthBins": args.depth_bins,
            "orderApproximation": f"camera-depth-{args.depth_bins}-bin-one-running-transmittance-v0",
            "footprintMode": args.footprint_mode,
            "pathScale": path_scale,
            "pathScaleRefitPerArm": False,
            "adaptiveFraction": args.adaptive_fraction,
        },
        "importance": importance_receipt,
        "plans": {key: plan["receipt"] for key, plan in arm_plans.items()},
        "metrics": {"cameras": metrics, "heldOutMean": held_means},
        "artifacts": {"gallery": str(out_dir / "index.html"), "cameraCount": len(rows)},
        "claimBoundary": {
            "causalQuestion": "lattice-or-subcell-deposition-artifact-versus-support-omission-v0",
            "notCheaperDemoClaim": True,
            "notShippingGaussianImplementation": True,
            "notDepositionAdjudication": True,
            "supportRedefined": False,
            "coefficientsLearned": False,
            "cameraIndependentPlans": True,
        },
    }
    progress["phase"] = "gallery-write"
    (out_dir / "index.html").write_text(gallery_html(rows, Path(args.report).name))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--capture-report", required=True)
    parser.add_argument("--baseline-report", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--state-step", type=int, default=120)
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--footprint-mode", choices=("nearest", "bilinear"), default="nearest")
    parser.add_argument("--adaptive-fraction", type=float, default=0.25)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report_path = Path(args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    out_dir = Path(args.out_dir).resolve()
    stale_gallery = out_dir / "index.html"
    if stale_gallery.exists():
        stale_gallery.unlink()
    progress = {"phase": "source-validation"}
    started = time.time()
    try:
        result = run(args, progress)
        progress["phase"] = "report-write"
        report = {"startedAtUnix": started, "finishedAtUnix": time.time(), **result}
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"status": "complete", "report": str(report_path), "gallery": report["artifacts"]["gallery"]}, indent=2))
        return 0
    except Exception as exc:
        failure = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": progress["phase"],
            "error": str(exc),
            "startedAtUnix": started,
            "finishedAtUnix": time.time(),
            "traceback": traceback.format_exc(),
        }
        report_path.write_text(json.dumps(failure, indent=2) + "\n")
        print(f"Grid96 conserved subcell assay failed during {progress['phase']}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
