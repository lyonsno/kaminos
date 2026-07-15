#!/usr/bin/env python3
"""Learn a bounded one-cell correction for learned boundary-splat positions."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.boundary-splat-displacement-probe.v0"
IDENTITY = "one-cell-27-class-offset-v0"
FEATURE_AUTHORITY = "candidate-feature-row-reconstructed-from-exported-field-v0"
SPLIT_IDENTITY = "spatial-block-hash-holdout-v0"
SPLIT_GUARD_IDENTITY = "one-cell-chebyshev-cross-role-exclusion-v0"
CENTER_CONTROL = "always-center-offset-control-v0"
FREQUENCY_CONTROL = "train-class-frequency-offset-control-v0"
RIDGE_IDENTITY = "multiclass-ridge-offset-control-v0"
MLP_IDENTITY = "tiny-softmax-mlp-offset-v0"
MOVE_GATE_IDENTITY = "validation-selected-collision-aware-move-gate-v0"
VACANCY_POLICY = "vacant-in-original-candidate-set-v0"
GATED_MLP_IDENTITY = "tiny-softmax-mlp-vacancy-gated-offset-v0"
DISPLACEMENT_GRID_AUTHORITY = "validation-selected-vacancy-gated-offset-class-grid-v0"
DISPLACEMENT_GRID_CHANNEL = "boundarySplatOffsetClassNormalized"
GLOBAL_GATE_EVALUATION_AUTHORITY = "global-vacancy-election-then-role-slice-v0"
THRESHOLD_SWEEP_IDENTITY = "uncapped-validation-vacancy-threshold-sweep-v0"
MAXIMUM_UNIQUE_OVERLAP_SELECTION = "maximum-unique-overlap"
MAXIMUM_COVERAGE_POSITIVE_NET_SELECTION = "maximum-coverage-positive-net"
FEATURE_ORDER = [
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.smokeDensity", "material.heat", "material.fuel", "material.detail",
    "fire.flame", "fire.ember", "fire.visibleFireCarrier", "fire.combustionFront",
    "micro.microdetail", "micro.interfaceShred", "micro.fireLick", "micro.emberFleck",
]
OFFSETS = np.asarray([
    (dx, dy, dz)
    for dz in (-1, 0, 1)
    for dy in (-1, 0, 1)
    for dx in (-1, 0, 1)
], dtype=np.int8)
CENTER_CLASS = 13


class ProbeFailure(RuntimeError):
    def __init__(self, phase: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.details = details or {}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def descriptor_path(descriptor: dict[str, Any], manifest_path: Path) -> Path:
    raw = descriptor.get("path")
    if not isinstance(raw, str) or not raw:
        raise ProbeFailure("input-validation", "artifact descriptor is missing a path")
    path = Path(raw)
    return path if path.is_absolute() else (manifest_path.parent / path).resolve()


def load_f32(descriptor: dict[str, Any], manifest_path: Path, expected_floats: int, label: str) -> tuple[np.ndarray, dict[str, Any]]:
    path = descriptor_path(descriptor, manifest_path)
    if not path.is_file():
        raise ProbeFailure("input-validation", f"{label} artifact does not exist", {"path": str(path)})
    data = path.read_bytes()
    expected_sha = descriptor.get("sha256")
    actual_sha = sha256_bytes(data)
    if expected_sha != actual_sha:
        raise ProbeFailure("input-validation", f"{label} checksum mismatch", {
            "path": str(path), "expectedSha256": expected_sha, "actualSha256": actual_sha,
        })
    if descriptor.get("byteLength") != len(data):
        raise ProbeFailure("input-validation", f"{label} byte length mismatch", {
            "expected": descriptor.get("byteLength"), "actual": len(data),
        })
    if len(data) != expected_floats * 4:
        raise ProbeFailure("input-validation", f"{label} float count mismatch", {
            "expectedFloats": expected_floats, "actualFloats": len(data) // 4,
        })
    values = np.frombuffer(data, dtype="<f4").copy()
    if not np.all(np.isfinite(values)):
        raise ProbeFailure("input-validation", f"{label} contains non-finite values")
    return values, {
        "path": str(path), "sha256": actual_sha, "byteLength": len(data), "floatCount": int(values.size),
    }


def load_export(path: Path, require_fields: bool) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ProbeFailure("input-validation", f"cannot read manifest: {error}") from error
    if manifest.get("schema") != "kaminos.volume.full-grid-field-export.v0":
        raise ProbeFailure("input-validation", f"unsupported manifest schema: {manifest.get('schema')}")
    if manifest.get("status") != "captured" or manifest.get("failurePhase") is not None:
        raise ProbeFailure("input-validation", "manifest is not a captured failure-free export")
    if manifest.get("completeFieldCoverage") is not True:
        raise ProbeFailure("input-validation", "manifest does not carry complete field coverage")
    grid = int(manifest.get("grid") or 0)
    if grid <= 1 or manifest.get("cellCount") != grid ** 3:
        raise ProbeFailure("input-validation", "manifest grid/cell count is incoherent")
    splat = manifest.get("boundarySplats") or {}
    draw = splat.get("draw") or {}
    rows = int(draw.get("instanceCount") or 0)
    if rows <= 0 or draw.get("candidateCount") != rows or draw.get("overflowCount") != 0:
        raise ProbeFailure("input-validation", "boundary splat output is blank, truncated, or count-incoherent", {"draw": draw})
    splat_desc = ((splat.get("sidecars") or {}).get("boundarySplats") or {})
    splats, splat_artifact = load_f32(splat_desc, path, rows * 12, "boundary splats")
    result = {
        "path": str(path.resolve()),
        "sha256": sha256_file(path),
        "manifest": manifest,
        "grid": grid,
        "rows": rows,
        "splats": splats.reshape(rows, 12),
        "splatArtifact": splat_artifact,
    }
    if require_fields:
        fluid_desc = ((manifest.get("sidecars") or {}).get("fluid") or {})
        boundary_desc = ((((manifest.get("boundarySidecar") or {}).get("sidecars") or {}).get("boundary")) or {})
        fluid, fluid_artifact = load_f32(fluid_desc, path, grid ** 3 * 16, "low fluid")
        boundary, boundary_artifact = load_f32(boundary_desc, path, grid ** 3 * 4, "low boundary sidecar")
        result.update({
            "fluid": fluid.reshape(grid ** 3, 16),
            "boundary": boundary.reshape(grid ** 3, 4),
            "fluidArtifact": fluid_artifact,
            "boundaryArtifact": boundary_artifact,
        })
    return result


def decode_cells(splats: np.ndarray, grid: int) -> tuple[np.ndarray, np.ndarray]:
    coords = np.floor((splats[:, :3].astype(np.float64) + 1.0) * 0.5 * grid).astype(np.int64)
    valid = np.all((coords >= 0) & (coords < grid), axis=1)
    if not np.all(valid):
        raise ProbeFailure("dataset-construction", "decoded splat positions leave the receiver grid", {
            "invalidRows": int(np.count_nonzero(~valid)),
        })
    indexes = coords[:, 0] + coords[:, 1] * grid + coords[:, 2] * grid * grid
    if np.unique(indexes).size != indexes.size:
        raise ProbeFailure("dataset-construction", "candidate positions contain duplicate decoded cells", {
            "rowCount": int(indexes.size), "uniqueCount": int(np.unique(indexes).size),
        })
    return indexes.astype(np.int64), coords.astype(np.int64)


def spatial_roles(coords: np.ndarray, block_size: int, seed: int) -> np.ndarray:
    block = coords // max(1, int(block_size))
    hashes = (
        (block[:, 0] * np.int64(73856093))
        ^ (block[:, 1] * np.int64(19349663))
        ^ (block[:, 2] * np.int64(83492791))
        ^ np.int64(seed)
    )
    bins = np.mod(hashes, 10).astype(np.int8)
    roles = np.full(coords.shape[0], 2, dtype=np.int8)
    roles[bins < 2] = 0
    roles[(bins >= 2) & (bins < 4)] = 1
    return roles


def spatial_split(coords: np.ndarray, block_size: int, seed: int, grid: int) -> tuple[np.ndarray, dict[str, Any]]:
    roles = spatial_roles(coords, block_size, seed)
    raw_roles = roles.copy()
    guard = np.zeros(coords.shape[0], dtype=np.bool_)
    for dx, dy, dz in OFFSETS.tolist():
        if dx == 0 and dy == 0 and dz == 0:
            continue
        neighbors = coords + np.asarray([dx, dy, dz], dtype=np.int64)
        valid = np.all((neighbors >= 0) & (neighbors < grid), axis=1)
        neighbor_roles = spatial_roles(neighbors, block_size, seed)
        guard |= valid & (neighbor_roles != raw_roles)
    roles[guard] = -1

    cross_role_after_guard = np.zeros(coords.shape[0], dtype=np.bool_)
    for dx, dy, dz in OFFSETS.tolist():
        if dx == 0 and dy == 0 and dz == 0:
            continue
        neighbors = coords + np.asarray([dx, dy, dz], dtype=np.int64)
        valid = np.all((neighbors >= 0) & (neighbors < grid), axis=1)
        neighbor_roles = spatial_roles(neighbors, block_size, seed)
        cross_role_after_guard |= (roles >= 0) & valid & (neighbor_roles != roles)
    receipt = {
        "identity": SPLIT_IDENTITY,
        "guardBandIdentity": SPLIT_GUARD_IDENTITY,
        "spatialBlockSize": max(1, int(block_size)),
        "hashConstants": [73856093, 19349663, 83492791],
        "hashSeed": int(seed),
        "roleBins": {"test": [0, 1], "validation": [2, 3], "train": [4, 5, 6, 7, 8, 9]},
        "roleAuthority": "whole spatial blocks with one-cell Chebyshev exclusion around cross-role boundaries",
        "rawRoleRows": {
            "test": int(np.count_nonzero(raw_roles == 0)),
            "validation": int(np.count_nonzero(raw_roles == 1)),
            "train": int(np.count_nonzero(raw_roles == 2)),
        },
        "guardBandRows": int(np.count_nonzero(guard)),
        "activeRows": int(np.count_nonzero(roles >= 0)),
        "crossRoleRadiusOneRowsAfterGuard": int(np.count_nonzero(cross_role_after_guard)),
        "testRows": int(np.count_nonzero(roles == 0)),
        "validationRows": int(np.count_nonzero(roles == 1)),
        "trainRows": int(np.count_nonzero(roles == 2)),
    }
    if min(receipt["testRows"], receipt["validationRows"], receipt["trainRows"]) <= 0:
        raise ProbeFailure("dataset-split", "spatial split produced an empty role", receipt)
    return roles, receipt


def matched_source_capture(low: dict[str, Any], high: dict[str, Any]) -> dict[str, Any]:
    low_capture = low["manifest"].get("sourceCapture") or {}
    high_capture = high["manifest"].get("sourceCapture") or {}
    if low_capture.get("hashMatches") is not True or high_capture.get("hashMatches") is not True:
        raise ProbeFailure("input-validation", "low/high source capture does not carry verified hash matches")
    low_payload = low_capture.get("payloadSha256")
    high_payload = high_capture.get("payloadSha256")
    if not isinstance(low_payload, str) or len(low_payload) != 64 or low_payload != high_payload:
        raise ProbeFailure("input-validation", "low/high source state payload identity differs", {
            "lowPayloadSha256": low_payload,
            "highPayloadSha256": high_payload,
        })
    return {
        "authority": "matched-verified-source-capture-payload-v0",
        "payloadSha256": low_payload,
        "lowHashMatches": True,
        "highHashMatches": True,
    }


def build_offset_labels(low_indexes: np.ndarray, coords: np.ndarray, high_indexes: np.ndarray, grid: int) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    high_set = set(int(value) for value in high_indexes.tolist())
    labels = np.full(low_indexes.size, CENTER_CLASS, dtype=np.int64)
    correctable = np.zeros(low_indexes.size, dtype=np.bool_)
    search = sorted(
        ((dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)),
        key=lambda value: (value[0] ** 2 + value[1] ** 2 + value[2] ** 2, value[2], value[1], value[0]),
    )
    offset_to_class = {tuple(int(v) for v in offset): index for index, offset in enumerate(OFFSETS.tolist())}
    histogram: dict[str, int] = {}
    for row, (cell, coord) in enumerate(zip(low_indexes.tolist(), coords.tolist())):
        if int(cell) in high_set:
            selected = (0, 0, 0)
            correctable[row] = True
        else:
            selected = (0, 0, 0)
            for dx, dy, dz in search[1:]:
                x, y, z = coord[0] + dx, coord[1] + dy, coord[2] + dz
                if x < 0 or x >= grid or y < 0 or y >= grid or z < 0 or z >= grid:
                    continue
                destination = x + y * grid + z * grid * grid
                if destination in high_set:
                    selected = (dx, dy, dz)
                    correctable[row] = True
                    break
        labels[row] = offset_to_class[selected]
        key = f"{selected[0]},{selected[1]},{selected[2]}"
        histogram[key] = histogram.get(key, 0) + 1
    return labels, correctable, dict(sorted(histogram.items()))


def position_features(coords: np.ndarray, grid: int) -> np.ndarray:
    normalized = coords.astype(np.float32) / max(1, grid - 1) * 2.0 - 1.0
    x, y, z = normalized[:, 0], normalized[:, 1], normalized[:, 2]
    radial = np.sqrt(x * x + z * z)
    base = [x, y, z, radial, y * radial]
    for frequency in (1.0, 2.0, 4.0):
        for axis in (x, y, z):
            phase = np.pi * frequency * axis
            base.extend([np.sin(phase), np.cos(phase)])
    return np.stack(base, axis=1).astype(np.float32, copy=False)


def build_features(low: dict[str, Any], indexes: np.ndarray, coords: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    candidate_rows = np.concatenate([
        low["boundary"][indexes],
        low["fluid"][indexes, 4:16],
    ], axis=1).astype(np.float32, copy=False)
    if candidate_rows.shape[1] != 16:
        raise ProbeFailure("dataset-construction", "reconstructed candidate feature width is not 16")
    transformed = np.concatenate([
        candidate_rows,
        candidate_rows * candidate_rows,
        position_features(coords, low["grid"]),
    ], axis=1).astype(np.float32, copy=False)
    return transformed, {
        "identity": FEATURE_AUTHORITY,
        "baseFeatureOrder": FEATURE_ORDER,
        "baseFeatureCount": 16,
        "modelFeatureCount": int(transformed.shape[1]),
        "transforms": ["identity", "squared", "normalized-position-plus-fourier-1-2-4"],
        "rowAuthority": "decoded-candidate-cell-index into checksum-bound low boundary and fluid exports",
    }


def standardize(train: np.ndarray, *others: np.ndarray) -> tuple[np.ndarray, list[np.ndarray], dict[str, np.ndarray]]:
    mean = np.mean(train, axis=0, dtype=np.float64).astype(np.float32)
    std = np.std(train, axis=0, dtype=np.float64).astype(np.float32)
    std = np.where(std < np.float32(1.0e-6), np.float32(1.0), std)
    return (
        ((train - mean) / std).astype(np.float32),
        [((value - mean) / std).astype(np.float32) for value in others],
        {"mean": mean, "std": std},
    )


def class_weights(labels: np.ndarray) -> np.ndarray:
    counts = np.bincount(labels, minlength=27).astype(np.float64)
    nonzero = counts > 0
    weights = np.ones(27, dtype=np.float64)
    weights[nonzero] = np.sqrt(labels.size / (np.count_nonzero(nonzero) * counts[nonzero]))
    sample_mean = float(np.mean(weights[labels]))
    weights /= max(1.0e-12, sample_mean)
    return np.clip(weights, 0.25, 6.0).astype(np.float32)


def train_ridge(x: np.ndarray, labels: np.ndarray, alpha: float) -> dict[str, Any]:
    weights_per_class = class_weights(labels)
    sample_weight = weights_per_class[labels]
    design = np.concatenate([x, np.ones((x.shape[0], 1), dtype=np.float32)], axis=1)
    target = np.eye(27, dtype=np.float32)[labels]
    scale = np.sqrt(sample_weight).reshape(-1, 1)
    weighted_design = design * scale
    weighted_target = target * scale
    gram = np.asarray(weighted_design.T @ weighted_design, dtype=np.float64)
    regularization = max(1.0, float(x.shape[0])) * float(alpha)
    gram.flat[::gram.shape[0] + 1] += regularization
    rhs = np.asarray(weighted_design.T @ weighted_target, dtype=np.float64)
    solution = np.linalg.solve(gram, rhs).astype(np.float32)
    return {
        "identity": RIDGE_IDENTITY,
        "weights": solution[:-1],
        "bias": solution[-1],
        "alpha": float(alpha),
        "classWeights": weights_per_class,
    }


def predict_ridge(x: np.ndarray, state: dict[str, Any]) -> np.ndarray:
    return np.argmax(x @ state["weights"] + state["bias"], axis=1).astype(np.int64)


def train_mlp(x: np.ndarray, labels: np.ndarray, args: argparse.Namespace, rng: np.random.Generator) -> tuple[dict[str, Any], dict[str, Any]]:
    hidden = max(4, int(args.hidden_width))
    w1 = rng.normal(0.0, math.sqrt(2.0 / x.shape[1]), size=(x.shape[1], hidden)).astype(np.float32)
    b1 = np.zeros((1, hidden), dtype=np.float32)
    w2 = rng.normal(0.0, math.sqrt(2.0 / hidden), size=(hidden, 27)).astype(np.float32)
    b2 = np.zeros((1, 27), dtype=np.float32)
    params = [w1, b1, w2, b2]
    moments = [np.zeros_like(value) for value in params]
    variances = [np.zeros_like(value) for value in params]
    beta1, beta2 = np.float32(0.9), np.float32(0.999)
    learning_rate = np.float32(max(1.0e-6, float(args.learning_rate)))
    weight_decay = np.float32(max(0.0, float(args.weight_decay)))
    batch_size = max(16, int(args.batch_size))
    weights_per_class = class_weights(labels)
    step = 0
    final_loss = 0.0
    for _epoch in range(max(1, int(args.epochs))):
        order = rng.permutation(x.shape[0])
        total_loss = 0.0
        total_rows = 0
        for start in range(0, order.size, batch_size):
            rows = order[start:start + batch_size]
            xb = x[rows]
            yb = labels[rows]
            hidden_value = np.tanh(xb @ w1 + b1)
            logits = hidden_value @ w2 + b2
            logits -= np.max(logits, axis=1, keepdims=True)
            probabilities = np.exp(np.clip(logits, -30.0, 30.0))
            probabilities /= np.sum(probabilities, axis=1, keepdims=True)
            sample_weight = weights_per_class[yb]
            normalization = max(1.0e-12, float(np.sum(sample_weight)))
            loss = -float(np.sum(sample_weight * np.log(probabilities[np.arange(yb.size), yb] + 1.0e-8)) / normalization)
            grad_logits = probabilities
            grad_logits[np.arange(yb.size), yb] -= 1.0
            grad_logits *= (sample_weight / normalization).reshape(-1, 1)
            grad_w2 = hidden_value.T @ grad_logits + weight_decay * w2
            grad_b2 = np.sum(grad_logits, axis=0, keepdims=True)
            grad_hidden = grad_logits @ w2.T
            grad_z1 = grad_hidden * (1.0 - hidden_value * hidden_value)
            grad_w1 = xb.T @ grad_z1 + weight_decay * w1
            grad_b1 = np.sum(grad_z1, axis=0, keepdims=True)
            step += 1
            for index, (param, grad) in enumerate(zip(params, [grad_w1, grad_b1, grad_w2, grad_b2])):
                grad = grad.astype(np.float32, copy=False)
                moments[index] = beta1 * moments[index] + (1.0 - beta1) * grad
                variances[index] = beta2 * variances[index] + (1.0 - beta2) * (grad * grad)
                moment_hat = moments[index] / (1.0 - float(beta1) ** step)
                variance_hat = variances[index] / (1.0 - float(beta2) ** step)
                param -= learning_rate * moment_hat / (np.sqrt(variance_hat) + np.float32(1.0e-8))
            total_loss += loss * rows.size
            total_rows += rows.size
        final_loss = total_loss / max(1, total_rows)
    return {
        "identity": MLP_IDENTITY,
        "w1": w1, "b1": b1, "w2": w2, "b2": b2,
        "classWeights": weights_per_class,
    }, {
        "hiddenWidth": hidden,
        "epochs": max(1, int(args.epochs)),
        "batchSize": batch_size,
        "learningRate": float(learning_rate),
        "weightDecay": float(weight_decay),
        "finalTrainLoss": float(final_loss),
        "loss": "class-weighted-softmax-cross-entropy",
    }


def mlp_probabilities(x: np.ndarray, state: dict[str, Any]) -> np.ndarray:
    hidden = np.tanh(x @ state["w1"] + state["b1"])
    logits = hidden @ state["w2"] + state["b2"]
    logits -= np.max(logits, axis=1, keepdims=True)
    probabilities = np.exp(np.clip(logits, -30.0, 30.0))
    probabilities /= np.sum(probabilities, axis=1, keepdims=True)
    return probabilities.astype(np.float32, copy=False)


def predict_mlp(x: np.ndarray, state: dict[str, Any]) -> np.ndarray:
    return np.argmax(mlp_probabilities(x, state), axis=1).astype(np.int64)


def vacancy_winners(
    source_indexes: np.ndarray,
    coords: np.ndarray,
    raw_classes: np.ndarray,
    probabilities: np.ndarray,
    original_occupied: set[int],
    grid: int,
) -> list[tuple[float, int, int, int]]:
    offsets = OFFSETS[raw_classes].astype(np.int64)
    destinations = coords + offsets
    valid = np.all((destinations >= 0) & (destinations < grid), axis=1)
    destination_indexes = (
        destinations[:, 0]
        + destinations[:, 1] * grid
        + destinations[:, 2] * grid * grid
    ).astype(np.int64)
    selected_probability = probabilities[np.arange(raw_classes.size), raw_classes]
    center_probability = probabilities[:, CENTER_CLASS]
    margins = selected_probability - center_probability
    winners: dict[int, tuple[float, int, int]] = {}
    for row in np.flatnonzero(valid & (raw_classes != CENTER_CLASS)).tolist():
        destination = int(destination_indexes[row])
        if destination in original_occupied:
            continue
        proposal = (float(margins[row]), int(source_indexes[row]), int(row))
        prior = winners.get(destination)
        if prior is None or proposal[0] > prior[0] or (proposal[0] == prior[0] and proposal[1] < prior[1]):
            winners[destination] = proposal
    return [(*proposal, destination) for destination, proposal in sorted(winners.items())]


def calibrate_vacancy_threshold(
    source_indexes: np.ndarray,
    coords: np.ndarray,
    raw_classes: np.ndarray,
    probabilities: np.ndarray,
    original_occupied: set[int],
    high_set: set[int],
    grid: int,
    selection_mask: np.ndarray,
    selection_policy: str,
) -> dict[str, Any]:
    winners = vacancy_winners(source_indexes, coords, raw_classes, probabilities, original_occupied, grid)
    selected_winners = [winner for winner in winners if bool(selection_mask[winner[2]])]
    grouped: dict[float, list[tuple[float, int, int, int]]] = {}
    for winner in selected_winners:
        grouped.setdefault(winner[0], []).append(winner)
    cumulative_delta = 0
    cumulative_moves = 0
    cumulative_corrected = 0
    cumulative_corrupted = 0
    cumulative_neutral = 0
    best_delta = 0
    best_moves = 0
    best_threshold = 2.0
    sweep_points: list[dict[str, Any]] = [{
        "threshold": 2.0,
        "acceptedMoveCount": 0,
        "correctedLowOnlyCount": 0,
        "corruptedOverlapCount": 0,
        "neutralMoveCount": 0,
        "uniqueOverlapDelta": 0,
    }]
    for score in sorted(grouped, reverse=True):
        proposals = grouped[score]
        cumulative_moves += len(proposals)
        for _margin, source, _row, destination in proposals:
            source_matches = source in high_set
            destination_matches = destination in high_set
            if not source_matches and destination_matches:
                cumulative_corrected += 1
            elif source_matches and not destination_matches:
                cumulative_corrupted += 1
            else:
                cumulative_neutral += 1
        cumulative_delta = cumulative_corrected - cumulative_corrupted
        sweep_points.append({
            "threshold": float(score),
            "acceptedMoveCount": cumulative_moves,
            "correctedLowOnlyCount": cumulative_corrected,
            "corruptedOverlapCount": cumulative_corrupted,
            "neutralMoveCount": cumulative_neutral,
            "uniqueOverlapDelta": cumulative_delta,
        })
        if cumulative_delta > best_delta or (cumulative_delta == best_delta and cumulative_moves < best_moves):
            best_delta = cumulative_delta
            best_moves = cumulative_moves
            best_threshold = float(score)

    pareto_reversed: list[dict[str, Any]] = []
    best_later_delta = -math.inf
    for point in reversed(sweep_points):
        if point["uniqueOverlapDelta"] > best_later_delta:
            pareto_reversed.append(point)
            best_later_delta = point["uniqueOverlapDelta"]
    pareto_frontier = list(reversed(pareto_reversed))
    positive_net_points = [point for point in sweep_points if point["uniqueOverlapDelta"] > 0]
    maximum_coverage_positive_net = positive_net_points[-1] if positive_net_points else sweep_points[0]
    maximum_unique_overlap = next(
        point for point in sweep_points
        if point["threshold"] == best_threshold
        and point["acceptedMoveCount"] == best_moves
        and point["uniqueOverlapDelta"] == best_delta
    )
    threshold_sweep = {
        "identity": THRESHOLD_SWEEP_IDENTITY,
        "selectedOn": "validation",
        "testDataUsedForSelection": False,
        "arbitrationAuthority": GLOBAL_GATE_EVALUATION_AUTHORITY,
        "capped": False,
        "pointAuthority": "one point per distinct validation-winner confidence margin plus the no-move control",
        "pointCount": len(sweep_points),
        "points": sweep_points,
        "paretoAxes": ["acceptedMoveCount", "uniqueOverlapDelta"],
        "paretoPointCount": len(pareto_frontier),
        "paretoFrontier": pareto_frontier,
        "maximumUniqueOverlap": maximum_unique_overlap,
        "maximumCoveragePositiveNet": maximum_coverage_positive_net,
    }
    if selection_policy == MAXIMUM_UNIQUE_OVERLAP_SELECTION:
        selected_point = maximum_unique_overlap
        selection_metric = "postOffsetUniqueOverlap"
    elif selection_policy == MAXIMUM_COVERAGE_POSITIVE_NET_SELECTION:
        selected_point = maximum_coverage_positive_net
        selection_metric = "acceptedMoveCount subject to positive postOffsetUniqueOverlap delta"
    else:
        raise ProbeFailure("calibration", "unsupported move-gate selection policy", {
            "selectionPolicy": selection_policy,
        })
    return {
        "identity": MOVE_GATE_IDENTITY,
        "vacancyPolicy": VACANCY_POLICY,
        "selectedOn": "validation",
        "selectionPolicy": selection_policy,
        "selectionMetric": selection_metric,
        "confidence": "predicted-class probability minus center-class probability",
        "threshold": selected_point["threshold"],
        "arbitrationAuthority": GLOBAL_GATE_EVALUATION_AUTHORITY,
        "globalWinnerCount": len(winners),
        "validationWinnerCount": len(selected_winners),
        "validationSelectedMoveCount": selected_point["acceptedMoveCount"],
        "validationUniqueOverlapDelta": selected_point["uniqueOverlapDelta"],
        "thresholdSweep": threshold_sweep,
        "noPositiveValidationPolicy": "threshold 2.0 disables all moves",
        "testDataUsedForSelection": False,
        "targetDataUsedForCalibration": True,
    }


def apply_vacancy_gate(
    source_indexes: np.ndarray,
    coords: np.ndarray,
    raw_classes: np.ndarray,
    probabilities: np.ndarray,
    original_occupied: set[int],
    threshold: float,
    grid: int,
) -> tuple[np.ndarray, dict[str, Any]]:
    winners = vacancy_winners(source_indexes, coords, raw_classes, probabilities, original_occupied, grid)
    gated = np.full(raw_classes.size, CENTER_CLASS, dtype=np.int64)
    accepted = 0
    for margin, _source, row, _destination in winners:
        if margin >= threshold:
            gated[row] = raw_classes[row]
            accepted += 1
    destinations, _ = apply_offsets(source_indexes, coords, gated, grid)
    duplicate_count = int(destinations.size - np.unique(destinations).size)
    if duplicate_count != 0:
        raise ProbeFailure("collision-aware-gating", "vacancy gate produced duplicate destinations", {
            "rowCount": int(destinations.size), "duplicateDestinationCount": duplicate_count,
        })
    return gated, {
        "identity": MOVE_GATE_IDENTITY,
        "vacancyPolicy": VACANCY_POLICY,
        "winnerCount": len(winners),
        "acceptedMoveCount": accepted,
        "rejectedProposalCount": int(np.count_nonzero(raw_classes != CENTER_CLASS) - accepted),
        "duplicateDestinationCount": duplicate_count,
    }


def apply_offsets(indexes: np.ndarray, coords: np.ndarray, classes: np.ndarray, grid: int) -> tuple[np.ndarray, int]:
    offsets = OFFSETS[classes].astype(np.int64)
    destinations = coords + offsets
    valid = np.all((destinations >= 0) & (destinations < grid), axis=1)
    boundary_fallbacks = int(np.count_nonzero(~valid))
    destinations[~valid] = coords[~valid]
    result = destinations[:, 0] + destinations[:, 1] * grid + destinations[:, 2] * grid * grid
    return result.astype(np.int64), boundary_fallbacks


def displacement_metrics(
    source_indexes: np.ndarray,
    coords: np.ndarray,
    labels: np.ndarray,
    predicted: np.ndarray,
    correctable: np.ndarray,
    high_set: set[int],
    grid: int,
) -> dict[str, Any]:
    destinations, boundary_fallbacks = apply_offsets(source_indexes, coords, predicted, grid)
    source_membership = np.fromiter((int(value) in high_set for value in source_indexes), dtype=np.bool_, count=source_indexes.size)
    destination_membership = np.fromiter((int(value) in high_set for value in destinations), dtype=np.bool_, count=destinations.size)
    moved_labels = labels != CENTER_CLASS
    unique_destinations = np.unique(destinations)
    baseline_unique = np.unique(source_indexes)
    post_overlap = int(sum(int(value) in high_set for value in unique_destinations.tolist()))
    baseline_overlap = int(sum(int(value) in high_set for value in baseline_unique.tolist()))
    return {
        "rowCount": int(labels.size),
        "classAccuracy": float(np.mean(predicted == labels)),
        "movedRowClassAccuracy": float(np.mean(predicted[moved_labels] == labels[moved_labels])) if np.any(moved_labels) else 1.0,
        "correctableRowClassAccuracy": float(np.mean(predicted[correctable] == labels[correctable])) if np.any(correctable) else 1.0,
        "destinationMembershipAccuracy": float(np.mean(destination_membership)),
        "baselineDestinationMembershipAccuracy": float(np.mean(source_membership)),
        "destinationMembershipDelta": float(np.mean(destination_membership) - np.mean(source_membership)),
        "correctedLowOnlyCount": int(np.count_nonzero(~source_membership & destination_membership)),
        "corruptedOverlapCount": int(np.count_nonzero(source_membership & ~destination_membership)),
        "postOffsetUniqueOverlap": post_overlap,
        "baselineUniqueOverlap": baseline_overlap,
        "uniqueOverlapDelta": post_overlap - baseline_overlap,
        "uniqueDestinationCount": int(unique_destinations.size),
        "duplicateDestinationCount": int(destinations.size - unique_destinations.size),
        "boundaryFallbackCount": boundary_fallbacks,
        "predictedMovedRowCount": int(np.count_nonzero(predicted != CENTER_CLASS)),
    }


def model_receipt(
    identity: str,
    predictions: dict[str, np.ndarray],
    roles: np.ndarray,
    indexes: np.ndarray,
    coords: np.ndarray,
    labels: np.ndarray,
    correctable: np.ndarray,
    high_set: set[int],
    grid: int,
    training: dict[str, Any] | None = None,
) -> dict[str, Any]:
    masks = {"test": roles == 0, "validation": roles == 1, "train": roles == 2, "all": np.ones(roles.size, dtype=np.bool_)}
    receipt: dict[str, Any] = {"identity": identity}
    if training is not None:
        receipt["training"] = training
    for role, mask in masks.items():
        receipt[role] = displacement_metrics(
            indexes[mask], coords[mask], labels[mask], predictions[role], correctable[mask], high_set, grid,
        )
    return receipt


def gate_role_receipts(
    roles: np.ndarray,
    raw_classes: np.ndarray,
    global_gated: np.ndarray,
    global_winners: list[tuple[float, int, int, int]],
    threshold: float,
) -> dict[str, Any]:
    masks = {
        "test": roles == 0,
        "validation": roles == 1,
        "train": roles == 2,
        "all": np.ones(roles.size, dtype=np.bool_),
    }
    receipts: dict[str, Any] = {}
    winner_rows = np.asarray([winner[2] for winner in global_winners], dtype=np.int64)
    for role, mask in masks.items():
        winner_count = int(np.count_nonzero(mask[winner_rows])) if winner_rows.size else 0
        accepted = int(np.count_nonzero(global_gated[mask] != CENTER_CLASS))
        receipts[role] = {
            "identity": MOVE_GATE_IDENTITY,
            "evaluationAuthority": GLOBAL_GATE_EVALUATION_AUTHORITY,
            "vacancyPolicy": VACANCY_POLICY,
            "threshold": float(threshold),
            "winnerCount": winner_count,
            "acceptedMoveCount": accepted,
            "rejectedProposalCount": int(np.count_nonzero(raw_classes[mask] != CENTER_CLASS) - accepted),
            "duplicateDestinationCount": 0,
        }
    return receipts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--low-manifest", required=True)
    parser.add_argument("--high-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--spatial-block-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=9413)
    parser.add_argument("--ridge-alpha", type=float, default=1.0e-3)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=16)
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument(
        "--move-gate-selection",
        choices=[MAXIMUM_UNIQUE_OVERLAP_SELECTION, MAXIMUM_COVERAGE_POSITIVE_NET_SELECTION],
        default=MAXIMUM_UNIQUE_OVERLAP_SELECTION,
    )
    args = parser.parse_args()
    out_dir = Path(args.out_dir).resolve()
    manifest_path = out_dir / "manifest.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    phase = "input-validation"
    try:
        low_path = Path(args.low_manifest).resolve()
        high_path = Path(args.high_manifest).resolve()
        low = load_export(low_path, require_fields=True)
        high = load_export(high_path, require_fields=False)
        if low["grid"] != high["grid"]:
            raise ProbeFailure("input-validation", "low/high candidate grids differ")
        if low["manifest"].get("effectiveRoute") != high["manifest"].get("effectiveRoute"):
            raise ProbeFailure("input-validation", "low/high effective routes differ")
        source_pair = matched_source_capture(low, high)
        grid = low["grid"]

        phase = "dataset-construction"
        low_indexes, low_coords = decode_cells(low["splats"], grid)
        high_indexes, _ = decode_cells(high["splats"], grid)
        labels, correctable, offset_histogram = build_offset_labels(low_indexes, low_coords, high_indexes, grid)
        features, feature_receipt = build_features(low, low_indexes, low_coords)
        roles, split_receipt = spatial_split(low_coords, args.spatial_block_size, args.seed, grid)
        train_mask, validation_mask, test_mask = roles == 2, roles == 1, roles == 0
        train_features, normalized, normalization = standardize(
            features[train_mask], features[validation_mask], features[test_mask], features,
        )
        validation_features, test_features, all_features = normalized
        role_features = {
            "train": train_features,
            "validation": validation_features,
            "test": test_features,
            "all": all_features,
        }
        role_masks = {
            "train": train_mask,
            "validation": validation_mask,
            "test": test_mask,
            "all": np.ones(roles.size, dtype=np.bool_),
        }

        phase = "ridge-training"
        ridge_state = train_ridge(train_features, labels[train_mask], args.ridge_alpha)
        ridge_predictions = {role: predict_ridge(role_features[role], ridge_state) for role in role_features}

        phase = "mlp-training"
        rng = np.random.default_rng(args.seed)
        mlp_state, mlp_training = train_mlp(train_features, labels[train_mask], args, rng)
        mlp_probability_rows = {role: mlp_probabilities(role_features[role], mlp_state) for role in role_features}
        mlp_predictions = {role: np.argmax(values, axis=1).astype(np.int64) for role, values in mlp_probability_rows.items()}

        phase = "evaluation"
        high_set = set(int(value) for value in high_indexes.tolist())
        low_set = set(int(value) for value in low_indexes.tolist())
        calibration = calibrate_vacancy_threshold(
            low_indexes, low_coords, mlp_predictions["all"],
            mlp_probability_rows["all"], low_set, high_set, grid, validation_mask,
            args.move_gate_selection,
        )
        global_gated, global_gate = apply_vacancy_gate(
            low_indexes, low_coords, mlp_predictions["all"], mlp_probability_rows["all"],
            low_set, calibration["threshold"], grid,
        )
        global_winners = vacancy_winners(
            low_indexes, low_coords, mlp_predictions["all"], mlp_probability_rows["all"], low_set, grid,
        )
        gated_predictions = {role: global_gated[mask] for role, mask in role_masks.items()}
        gate_roles = gate_role_receipts(
            roles, mlp_predictions["all"], global_gated, global_winners, calibration["threshold"],
        )
        gate_roles["all"].update(global_gate)
        center_predictions = {role: np.full(np.count_nonzero(mask), CENTER_CLASS, dtype=np.int64) for role, mask in role_masks.items()}
        counts = np.bincount(labels[train_mask], minlength=27)
        frequency_class = int(np.argmax(counts))
        frequency_predictions = {role: np.full(np.count_nonzero(mask), frequency_class, dtype=np.int64) for role, mask in role_masks.items()}
        models = {
            "alwaysCenter": model_receipt(CENTER_CONTROL, center_predictions, roles, low_indexes, low_coords, labels, correctable, high_set, grid),
            "classFrequency": model_receipt(FREQUENCY_CONTROL, frequency_predictions, roles, low_indexes, low_coords, labels, correctable, high_set, grid, {
                "selectedClass": frequency_class, "selectedOffset": OFFSETS[frequency_class].astype(int).tolist(),
            }),
            "ridge": model_receipt(RIDGE_IDENTITY, ridge_predictions, roles, low_indexes, low_coords, labels, correctable, high_set, grid, {
                "alpha": float(args.ridge_alpha), "classWeights": ridge_state["classWeights"].astype(float).tolist(),
            }),
            "mlp": model_receipt(MLP_IDENTITY, mlp_predictions, roles, low_indexes, low_coords, labels, correctable, high_set, grid, mlp_training),
        }
        gated_receipt = model_receipt(
            GATED_MLP_IDENTITY, gated_predictions, roles, low_indexes, low_coords, labels,
            correctable, high_set, grid, mlp_training,
        )
        gated_receipt["calibration"] = calibration
        gated_receipt["gateRoles"] = gate_roles
        gated_receipt["evaluationAuthority"] = GLOBAL_GATE_EVALUATION_AUTHORITY
        models["mlpVacancyGated"] = gated_receipt

        phase = "checkpoint-write"
        checkpoint_path = out_dir / "displacement-model.npz"
        np.savez_compressed(
            checkpoint_path,
            schema=np.asarray([SCHEMA]),
            identity=np.asarray([IDENTITY]),
            offsets=OFFSETS,
            normalizationMean=normalization["mean"],
            normalizationStd=normalization["std"],
            ridgeWeights=ridge_state["weights"],
            ridgeBias=ridge_state["bias"],
            ridgeAlpha=np.asarray([ridge_state["alpha"]], dtype=np.float32),
            mlpW1=mlp_state["w1"], mlpB1=mlp_state["b1"],
            mlpW2=mlp_state["w2"], mlpB2=mlp_state["b2"],
            moveGateIdentity=np.asarray([MOVE_GATE_IDENTITY]),
            moveGateSelectionPolicy=np.asarray([args.move_gate_selection]),
            moveGateThreshold=np.asarray([calibration["threshold"]], dtype=np.float32),
        )
        phase = "checkpoint-replay"
        with np.load(checkpoint_path, allow_pickle=False) as replay:
            replay_mean = replay["normalizationMean"].astype(np.float32)
            replay_std = replay["normalizationStd"].astype(np.float32)
            replay_features = ((features - replay_mean) / replay_std).astype(np.float32)
            replay_state = {
                "w1": replay["mlpW1"].astype(np.float32),
                "b1": replay["mlpB1"].astype(np.float32),
                "w2": replay["mlpW2"].astype(np.float32),
                "b2": replay["mlpB2"].astype(np.float32),
            }
            replay_probabilities = mlp_probabilities(replay_features, replay_state)
            replay_raw = np.argmax(replay_probabilities, axis=1).astype(np.int64)
            replay_threshold = float(replay["moveGateThreshold"][0])
        replay_gated, replay_gate = apply_vacancy_gate(
            low_indexes, low_coords, replay_raw, replay_probabilities, low_set, replay_threshold, grid,
        )
        class_parity = bool(np.array_equal(replay_gated, global_gated))
        if not class_parity:
            raise ProbeFailure("checkpoint-replay", "serialized checkpoint does not reproduce global gated classes", {
                "mismatchCount": int(np.count_nonzero(replay_gated != global_gated)),
            })

        phase = "dense-output-write"
        displacement_values = np.full(grid ** 3, np.float32(CENTER_CLASS / 26.0), dtype="<f4")
        displacement_values[low_indexes] = (
            replay_gated.astype(np.float32) / np.float32(26.0)
        ).astype("<f4", copy=False)
        displacement_path = out_dir / "boundary-splat-offset-class-normalized.f32"
        displacement_bytes = displacement_values.tobytes(order="C")
        displacement_path.write_bytes(displacement_bytes)
        displacement_artifact = {
            "path": str(displacement_path),
            "sha256": sha256_bytes(displacement_bytes),
            "byteLength": len(displacement_bytes),
            "shape": [grid, grid, grid, 1],
            "channelOrder": [DISPLACEMENT_GRID_CHANNEL],
            "authority": DISPLACEMENT_GRID_AUTHORITY,
            "applicationIdentity": MOVE_GATE_IDENTITY,
            "encoding": "offset class index divided by 26; decode round(value * 26)",
            "centerClass": CENTER_CLASS,
            "centerEncodedValue": float(CENTER_CLASS / 26.0),
            "acceptedMovedCandidateCount": replay_gate["acceptedMoveCount"],
            "candidateCount": int(low_indexes.size),
            "nonCandidatePolicy": "center class",
        }
        checkpoint = {
            "path": str(checkpoint_path),
            "sha256": sha256_file(checkpoint_path),
            "byteLength": checkpoint_path.stat().st_size,
            "targetDataUsedForTraining": True,
            "targetDataUsedForCalibration": True,
            "targetLabelsUsedForModelSelection": True,
            "targetSplitAuthority": "guarded train-role exact-high offsets enter fitting; guarded validation exact-high support selects only the threshold after global arbitration; guarded test remains audit-only",
            "replay": {
                "status": "verified",
                "classParity": class_parity,
                "globalGateDuplicateDestinationCount": replay_gate["duplicateDestinationCount"],
                "outputSha256": displacement_artifact["sha256"],
            },
        }

        overlap = len(low_set & high_set)
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "source": {
                "lowManifest": {"path": str(low_path), "sha256": low["sha256"]},
                "highManifest": {"path": str(high_path), "sha256": high["sha256"]},
                "sourcePair": source_pair,
                "grid": grid,
                "effectiveRoute": low["manifest"].get("effectiveRoute"),
                "lowBackend": low["manifest"].get("backend"),
                "highBackend": high["manifest"].get("backend"),
                "lowArtifacts": {
                    "fluid": low["fluidArtifact"], "boundary": low["boundaryArtifact"], "splats": low["splatArtifact"],
                },
                "highArtifacts": {"splats": high["splatArtifact"]},
            },
            "dataset": {
                "identity": IDENTITY,
                "featureAuthority": feature_receipt,
                "lowCandidateCount": int(low_indexes.size),
                "highCandidateCount": int(high_indexes.size),
                "exactOverlapCount": overlap,
                "lowOnlyCount": int(low_indexes.size - overlap),
                "highOnlyCount": int(high_indexes.size - overlap),
                "correctableWithinRadiusOneCount": int(np.count_nonzero(correctable)),
                "uncorrectableWithinRadiusOneCount": int(np.count_nonzero(~correctable)),
                "offsetClassCount": 27,
                "centerClass": CENTER_CLASS,
                "offsetHistogram": offset_histogram,
                "labelTieBreak": "minimum squared offset distance, then z/y/x ascending",
                "uncorrectablePolicy": "retain center class and report separately",
            },
            "split": split_receipt,
            "models": models,
            "denseOutputs": {
                "boundarySplatOffsetClass": displacement_artifact,
            },
            "checkpoint": checkpoint,
            "producer": {
                "script": {"path": str(Path(__file__).resolve()), "sha256": sha256_file(Path(__file__).resolve())},
                "arguments": vars(args),
            },
            "limitations": [
                "same-state exact-high support labels enter train-role fitting",
                "candidate displacement does not add missing candidates or alter learned attributes",
                "one-cell labels are deterministic nearest-support targets, not physical velocity truth",
                "validation exact-high support selects the vacancy-gate confidence threshold",
                "test destination membership and unique overlap, not class accuracy alone, decide usefulness",
            ],
        }
        write_json(manifest_path, report)
        print(json.dumps({"ok": True, "manifest": str(manifest_path), "checkpoint": checkpoint}, indent=2))
        return 0
    except ProbeFailure as error:
        write_json(manifest_path, {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": error.phase,
            "error": {"name": type(error).__name__, "message": str(error), "details": error.details},
            "arguments": vars(args),
        })
        print(f"{error.phase}: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        write_json(manifest_path, {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "error": {"name": type(error).__name__, "message": str(error)},
            "arguments": vars(args),
        })
        raise


if __name__ == "__main__":
    raise SystemExit(main())
