#!/usr/bin/env python3
"""Train an exact-basin accepted-splat support head and assay gated carrier residuals."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.exact-basin-support-probe.v0"
PROBE_IDENTITY = "exact-basin-accepted-splat-support-head-v0"
LABEL_AUTHORITY = "effective-splat-position-and-shader-formula-agreement-v0"
SPLIT_IDENTITY = "spatial-block-hash-holdout-v0"
THRESHOLD_IDENTITY = "validation-selected-f1-threshold-v0"
CLASSIFIER_IDENTITY = "full-low-state-spatial-mlp-support-classifier-v0"
CHANNEL_HEAD_IDENTITY = "support-gated-single-channel-residual-mlp-v0"
FEATURE_IDENTITY = "full-low-field-plus-spatial-rbf-features-v0"
PREVIEW_IDENTITY = "labeled-support-gate-channel-preview-v0"
PAIR_AUTHORITY = "downsampled-same-high-history-input-to-exact-high-target"
TRAINING_INPUT_AUTHORITY = "phase-aligned-high-filtered-to-low-grid-v0"
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
ALL_CHANNELS = [*FLUID_CHANNELS, "frontTopology"]
DEFAULT_CHANNELS = ["fuel", "fireLick", "visibleFireCarrier", "flame", "frontTopology"]


class ProbeFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True)
    parser.add_argument("--full-grid-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--channels", default=",".join(DEFAULT_CHANNELS))
    parser.add_argument("--train-samples", type=int, default=90_000)
    parser.add_argument("--validation-samples", type=int, default=60_000)
    parser.add_argument("--test-samples", type=int, default=80_000)
    parser.add_argument("--train-positive-fraction", type=float, default=0.5)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--learning-rate", type=float, default=0.002)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--spatial-block-size", type=int, default=8)
    parser.add_argument("--preview-slice-y", type=int)
    parser.add_argument("--seed", type=int, default=9413)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail_report(out_dir: Path, error: Exception, phase: str = "unknown") -> None:
    if isinstance(error, ProbeFailure):
        phase = error.phase
        evidence = error.evidence
    else:
        evidence = {}
    write_json(out_dir / "manifest.json", {
        "schema": REPORT_SCHEMA,
        "identity": PROBE_IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence,
    })


def verify_descriptor(descriptor: dict[str, Any], phase: str) -> Path:
    path = Path(str(descriptor.get("path") or ""))
    if not path.exists():
        raise ProbeFailure(phase, f"missing sidecar {path}", {"descriptor": descriptor})
    expected_bytes = int(descriptor.get("byteLength") or 0)
    if path.stat().st_size != expected_bytes:
        raise ProbeFailure(phase, f"sidecar byte mismatch for {path}", {
            "expectedBytes": expected_bytes,
            "actualBytes": path.stat().st_size,
        })
    expected_sha = str(descriptor.get("sha256") or "")
    actual_sha = sha256_file(path)
    if not expected_sha or actual_sha != expected_sha:
        raise ProbeFailure(phase, f"sidecar checksum mismatch for {path}", {
            "expectedSha256": expected_sha,
            "actualSha256": actual_sha,
        })
    return path


def parse_channels(raw: str) -> list[str]:
    channels = [value.strip() for value in raw.split(",") if value.strip()]
    if not channels:
        raise ProbeFailure("args", "no gated channels requested")
    unknown = [channel for channel in channels if channel not in ALL_CHANNELS]
    if unknown:
        raise ProbeFailure("args", f"unknown gated channels: {unknown}", {"availableChannels": ALL_CHANNELS})
    return channels


def smoothstep(edge0: float, edge1: float, values: np.ndarray) -> np.ndarray:
    t = np.clip((values - np.float32(edge0)) / np.float32(edge1 - edge0), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32, copy=False)


def derive_and_validate_labels(
    fluid: np.ndarray,
    boundary: np.ndarray,
    splats: np.ndarray,
    grid: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    fire_signal = (
        fluid[:, 8] * np.float32(1.25)
        + fluid[:, 10] * np.float32(0.52)
        + fluid[:, 11] * np.float32(0.86)
        + fluid[:, 14] * np.float32(0.72)
        + fluid[:, 5] * np.float32(0.24)
    )
    structural_signal = (
        boundary[:, 2]
        * smoothstep(0.055, 0.32, boundary[:, 1])
        * smoothstep(0.018, 0.16, fire_signal)
    ).astype(np.float32, copy=False)
    formula_indexes = np.flatnonzero(structural_signal >= np.float32(0.11)).astype(np.int64)
    decoded_xyz = np.rint(((np.asarray(splats[:, :3], dtype=np.float64) + 1.0) * 0.5 * grid) - 0.5).astype(np.int64)
    valid = np.all((decoded_xyz >= 0) & (decoded_xyz < grid), axis=1)
    decoded_indexes = (
        decoded_xyz[:, 0]
        + decoded_xyz[:, 1] * grid
        + decoded_xyz[:, 2] * grid * grid
    ).astype(np.int64)
    unique_decoded = np.unique(decoded_indexes)
    formula_only = np.setdiff1d(formula_indexes, unique_decoded, assume_unique=True)
    decoded_only = np.setdiff1d(unique_decoded, formula_indexes, assume_unique=True)
    agreement = {
        "identity": LABEL_AUTHORITY,
        "shaderFormula": "ridge * smoothstep(0.055,0.32,coverage) * smoothstep(0.018,0.16,fireSignal) >= 0.11",
        "formulaPositiveCount": int(formula_indexes.size),
        "effectiveSplatRowCount": int(splats.shape[0]),
        "validDecodedPositionCount": int(np.count_nonzero(valid)),
        "uniqueDecodedCellCount": int(unique_decoded.size),
        "formulaOnlyCount": int(formula_only.size),
        "decodedOnlyCount": int(decoded_only.size),
        "duplicateDecodedCount": int(decoded_indexes.size - unique_decoded.size),
        "exactAgreement": bool(
            np.all(valid)
            and decoded_indexes.size == unique_decoded.size
            and formula_only.size == 0
            and decoded_only.size == 0
        ),
        "prevalence": float(formula_indexes.size / max(1, fluid.shape[0])),
    }
    if not agreement["exactAgreement"]:
        raise ProbeFailure("label-validation", "accepted label disagreement between shader formula and effective splat positions", agreement)
    labels = np.zeros(fluid.shape[0], dtype=np.bool_)
    labels[formula_indexes] = True
    return labels, structural_signal, agreement


def spatial_split(grid: int, block_size: int, seed: int) -> tuple[np.ndarray, dict[str, Any]]:
    indexes = np.arange(grid ** 3, dtype=np.int64)
    x = indexes % grid
    y = (indexes // grid) % grid
    z = indexes // (grid * grid)
    block_size = max(1, int(block_size))
    bx = x // block_size
    by = y // block_size
    bz = z // block_size
    hashes = (
        (bx * np.int64(73856093))
        ^ (by * np.int64(19349663))
        ^ (bz * np.int64(83492791))
        ^ np.int64(seed)
    )
    bins = np.mod(hashes, 10).astype(np.int8)
    roles = np.full(indexes.shape[0], 2, dtype=np.int8)
    roles[bins < 2] = 0
    roles[(bins >= 2) & (bins < 4)] = 1
    return roles, {
        "identity": SPLIT_IDENTITY,
        "spatialBlockSize": block_size,
        "hashConstants": [73856093, 19349663, 83492791],
        "hashSeed": int(seed),
        "roleBins": {"test": [0, 1], "validation": [2, 3], "train": [4, 5, 6, 7, 8, 9]},
        "roleAuthority": "whole spatial blocks; no random-cell cross-role assignment",
    }


def sample_uniform(pool: np.ndarray, count: int, rng: np.random.Generator) -> np.ndarray:
    count = min(max(1, int(count)), pool.size)
    return np.sort(rng.choice(pool, size=count, replace=False).astype(np.int64))


def sample_balanced(
    pool: np.ndarray,
    labels: np.ndarray,
    count: int,
    positive_fraction: float,
    rng: np.random.Generator,
) -> np.ndarray:
    positives = pool[labels[pool]]
    negatives = pool[~labels[pool]]
    desired_positive = min(positives.size, max(1, int(count * np.clip(positive_fraction, 0.01, 0.99))))
    desired_negative = min(negatives.size, max(1, int(count) - desired_positive))
    selected = np.concatenate([
        rng.choice(positives, size=desired_positive, replace=False),
        rng.choice(negatives, size=desired_negative, replace=False),
    ]).astype(np.int64)
    if selected.size < min(count, pool.size):
        remainder = np.setdiff1d(pool, selected, assume_unique=False)
        fill_count = min(remainder.size, min(count, pool.size) - selected.size)
        selected = np.concatenate([selected, rng.choice(remainder, size=fill_count, replace=False)])
    rng.shuffle(selected)
    return selected


def normalized_position_features(x: np.ndarray, y: np.ndarray, z: np.ndarray, grid: int) -> np.ndarray:
    nx = x.astype(np.float32) / max(1, grid - 1) * 2 - 1
    ny = y.astype(np.float32) / max(1, grid - 1) * 2 - 1
    nz = z.astype(np.float32) / max(1, grid - 1) * 2 - 1
    radial = np.sqrt(nx * nx + nz * nz)
    return np.stack([nx, ny, nz, radial, ny * radial], axis=1).astype(np.float32, copy=False)


def spatial_basis_features(x: np.ndarray, y: np.ndarray, z: np.ndarray, grid: int) -> np.ndarray:
    nx = x.astype(np.float32) / max(1, grid - 1) * 2 - 1
    ny = y.astype(np.float32) / max(1, grid - 1) * 2 - 1
    nz = z.astype(np.float32) / max(1, grid - 1) * 2 - 1
    fourier = []
    for frequency in (1.0, 2.0, 4.0):
        for axis in (nx, ny, nz):
            phase = np.pi * frequency * axis
            fourier.extend([np.sin(phase), np.cos(phase)])
    centers_x = np.linspace(-0.75, 0.75, 4, dtype=np.float32)
    centers_y = np.linspace(-0.95, 0.85, 8, dtype=np.float32)
    centers_z = np.linspace(-0.75, 0.75, 4, dtype=np.float32)
    sigma2 = np.float32(0.30 * 0.30)
    rbf = []
    for cy in centers_y:
        for cz in centers_z:
            for cx in centers_x:
                dist2 = (nx - cx) ** 2 + (ny - cy) ** 2 + (nz - cz) ** 2
                rbf.append(np.exp(-dist2 / (2 * sigma2)))
    return np.stack([*fourier, *rbf], axis=1).astype(np.float32, copy=False)


def low_values_for_high_cells(
    low_fluid: np.ndarray,
    low_front: np.ndarray,
    indexes: np.ndarray,
    low_grid: int,
    high_grid: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x = indexes % high_grid
    y = (indexes // high_grid) % high_grid
    z = indexes // (high_grid * high_grid)
    ratio = high_grid / low_grid
    lx = np.minimum(low_grid - 1, np.floor(x / ratio).astype(np.int64))
    ly = np.minimum(low_grid - 1, np.floor(y / ratio).astype(np.int64))
    lz = np.minimum(low_grid - 1, np.floor(z / ratio).astype(np.int64))
    low_indexes = lx + ly * low_grid + lz * low_grid * low_grid
    low_values = np.concatenate([low_fluid[low_indexes], low_front[low_indexes, None]], axis=1)
    return low_values.astype(np.float32, copy=False), x, y, z


def build_features(low_values: np.ndarray, x: np.ndarray, y: np.ndarray, z: np.ndarray, grid: int) -> np.ndarray:
    low = low_values.astype(np.float32, copy=False)
    return np.concatenate([
        low,
        low * low,
        normalized_position_features(x, y, z, grid),
        spatial_basis_features(x, y, z, grid),
    ], axis=1).astype(np.float32, copy=False)


def standardize(train: np.ndarray, *others: np.ndarray) -> tuple[np.ndarray, list[np.ndarray], dict[str, np.ndarray]]:
    mean = np.mean(train, axis=0, dtype=np.float64).astype(np.float32)
    std = np.std(train, axis=0, dtype=np.float64).astype(np.float32)
    std = np.where(std < np.float32(1.0e-6), np.float32(1.0), std)
    normalized_train = ((train - mean) / std).astype(np.float32)
    normalized_others = [((value - mean) / std).astype(np.float32) for value in others]
    return normalized_train, normalized_others, {"mean": mean, "std": std}


def train_mlp(
    x: np.ndarray,
    y: np.ndarray,
    args: argparse.Namespace,
    rng: np.random.Generator,
    binary: bool,
) -> tuple[dict[str, np.ndarray | float], dict[str, Any]]:
    feature_count = x.shape[1]
    hidden = max(1, int(args.hidden_width))
    w1 = rng.normal(0.0, math.sqrt(2.0 / feature_count), size=(feature_count, hidden)).astype(np.float32)
    b1 = np.zeros((1, hidden), dtype=np.float32)
    w2 = rng.normal(0.0, math.sqrt(2.0 / hidden), size=(hidden, 1)).astype(np.float32)
    b2 = np.zeros((1, 1), dtype=np.float32)
    target_mean = 0.0
    target_std = 1.0
    target = y.astype(np.float32).reshape(-1, 1)
    if not binary:
        target_mean = float(np.mean(target))
        target_std = max(1.0e-7, float(np.std(target)))
        target = (target - np.float32(target_mean)) / np.float32(target_std)
    params = [w1, b1, w2, b2]
    moments = [np.zeros_like(param) for param in params]
    variances = [np.zeros_like(param) for param in params]
    beta1 = np.float32(0.9)
    beta2 = np.float32(0.999)
    learning_rate = np.float32(max(1.0e-6, args.learning_rate))
    batch_size = max(16, int(args.batch_size))
    step = 0
    final_loss = 0.0
    for _epoch in range(max(1, int(args.epochs))):
        order = rng.permutation(x.shape[0])
        total_loss = 0.0
        total_rows = 0
        for start in range(0, order.size, batch_size):
            batch = order[start:start + batch_size]
            xb = x[batch]
            yb = target[batch]
            hidden_value = np.tanh(xb @ w1 + b1)
            logits = hidden_value @ w2 + b2
            if binary:
                prediction = 1.0 / (1.0 + np.exp(-np.clip(logits, -30.0, 30.0)))
                loss = float(np.mean(-(yb * np.log(prediction + 1.0e-7) + (1.0 - yb) * np.log(1.0 - prediction + 1.0e-7))))
                grad_output = (prediction - yb) / max(1, xb.shape[0])
            else:
                error = logits - yb
                loss = float(np.mean(error * error))
                grad_output = (2.0 / max(1, xb.shape[0])) * error
            grad_w2 = hidden_value.T @ grad_output + np.float32(args.weight_decay) * w2
            grad_b2 = np.sum(grad_output, axis=0, keepdims=True)
            grad_hidden = grad_output @ w2.T
            grad_z1 = grad_hidden * (1.0 - hidden_value * hidden_value)
            grad_w1 = xb.T @ grad_z1 + np.float32(args.weight_decay) * w1
            grad_b1 = np.sum(grad_z1, axis=0, keepdims=True)
            step += 1
            for index, (param, grad) in enumerate(zip(params, [grad_w1, grad_b1, grad_w2, grad_b2])):
                grad = grad.astype(np.float32)
                moments[index] = beta1 * moments[index] + (1.0 - beta1) * grad
                variances[index] = beta2 * variances[index] + (1.0 - beta2) * (grad * grad)
                moment_hat = moments[index] / (1.0 - float(beta1) ** step)
                variance_hat = variances[index] / (1.0 - float(beta2) ** step)
                param -= learning_rate * moment_hat / (np.sqrt(variance_hat) + np.float32(1.0e-8))
            total_loss += loss * xb.shape[0]
            total_rows += xb.shape[0]
        final_loss = total_loss / max(1, total_rows)
    state: dict[str, np.ndarray | float] = {
        "w1": w1, "b1": b1, "w2": w2, "b2": b2,
        "targetMean": target_mean, "targetStd": target_std,
    }
    return state, {
        "hiddenWidth": hidden,
        "epochs": int(args.epochs),
        "batchSize": batch_size,
        "learningRate": float(args.learning_rate),
        "weightDecay": float(args.weight_decay),
        "finalTrainLoss": final_loss,
        "loss": "binary-cross-entropy" if binary else "standardized-residual-mse",
    }


def predict_mlp(features: np.ndarray, state: dict[str, np.ndarray | float], binary: bool) -> np.ndarray:
    logits = np.tanh(features @ state["w1"] + state["b1"]) @ state["w2"] + state["b2"]
    if binary:
        return (1.0 / (1.0 + np.exp(-np.clip(logits.reshape(-1), -30.0, 30.0)))).astype(np.float32)
    return (
        logits.reshape(-1) * np.float32(state["targetStd"])
        + np.float32(state["targetMean"])
    ).astype(np.float32)


def classification_metrics(probability: np.ndarray, labels: np.ndarray, threshold: float) -> dict[str, Any]:
    truth = labels.astype(np.bool_)
    predicted = probability >= np.float32(threshold)
    true_positive = int(np.count_nonzero(predicted & truth))
    false_positive = int(np.count_nonzero(predicted & ~truth))
    false_negative = int(np.count_nonzero(~predicted & truth))
    true_negative = int(np.count_nonzero(~predicted & ~truth))
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    f1 = 2 * precision * recall / max(1.0e-12, precision + recall)
    order = np.argsort(-probability.astype(np.float64))
    sorted_truth = truth[order].astype(np.float64)
    cumulative_positive = np.cumsum(sorted_truth)
    ranks = np.arange(1, sorted_truth.size + 1, dtype=np.float64)
    precision_curve = cumulative_positive / ranks
    positive_count = float(np.sum(sorted_truth))
    average_precision = float(np.sum(precision_curve * sorted_truth) / max(1.0, positive_count))
    return {
        "threshold": float(threshold),
        "count": int(labels.size),
        "prevalence": float(np.mean(truth)),
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "trueNegative": true_negative,
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "prAuc": average_precision,
        "prAucIdentity": "average-precision-step-pr-v0",
    }


def select_threshold(probability: np.ndarray, labels: np.ndarray) -> tuple[float, dict[str, Any]]:
    candidates = np.unique(np.concatenate([
        np.quantile(probability.astype(np.float64), np.linspace(0.01, 0.99, 199)),
        np.array([0.5], dtype=np.float64),
    ]))
    best_threshold = 0.5
    best_metrics = classification_metrics(probability, labels, best_threshold)
    for candidate in candidates:
        metrics = classification_metrics(probability, labels, float(candidate))
        score = (metrics["f1"], metrics["precision"], metrics["recall"], float(candidate))
        best_score = (best_metrics["f1"], best_metrics["precision"], best_metrics["recall"], best_threshold)
        if score > best_score:
            best_threshold = float(candidate)
            best_metrics = metrics
    return best_threshold, {
        "identity": THRESHOLD_IDENTITY,
        "selectedOn": "validation",
        "candidateCount": int(candidates.size),
        "threshold": best_threshold,
        "validationMetrics": best_metrics,
        "testDataUsedForSelection": False,
    }


def scalar_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    error = prediction.astype(np.float64) - truth.astype(np.float64)
    return {
        "rmse": float(np.sqrt(np.mean(error * error))) if error.size else 0.0,
        "mae": float(np.mean(np.abs(error))) if error.size else 0.0,
        "maxAbs": float(np.max(np.abs(error))) if error.size else 0.0,
    }


def region_metrics(prediction: np.ndarray, truth: np.ndarray, low: np.ndarray, mask: np.ndarray) -> dict[str, Any]:
    if not np.any(mask):
        return {"count": 0, "metrics": None, "residualEnergy": None}
    return {
        "count": int(np.count_nonzero(mask)),
        "metrics": scalar_metrics(prediction[mask], truth[mask]),
        "mae": scalar_metrics(prediction[mask], truth[mask])["mae"],
        "residualEnergy": {
            "meanAbsPredictionMinusLow": float(np.mean(np.abs(prediction[mask].astype(np.float64) - low[mask].astype(np.float64)))),
            "sumAbsPredictionMinusLow": float(np.sum(np.abs(prediction[mask].astype(np.float64) - low[mask].astype(np.float64)))),
        },
    }


def improvement(base: dict[str, float], candidate: dict[str, float]) -> dict[str, float]:
    return {
        "rmseReductionFraction": float((base["rmse"] - candidate["rmse"]) / max(base["rmse"], 1.0e-12)),
        "maeReductionFraction": float((base["mae"] - candidate["mae"]) / max(base["mae"], 1.0e-12)),
    }


def channel_values(fluid: np.ndarray, front: np.ndarray, indexes: np.ndarray, channel: str) -> np.ndarray:
    if channel == "frontTopology":
        return np.asarray(front[indexes], dtype=np.float32)
    return np.asarray(fluid[indexes, FLUID_CHANNELS.index(channel)], dtype=np.float32)


def write_png_rgb(path: Path, rgb: np.ndarray) -> None:
    height, width, channels = rgb.shape
    if rgb.dtype != np.uint8 or channels != 3:
        raise ProbeFailure("preview-write", "PNG payload must be uint8 RGB", {"shape": list(rgb.shape)})
    rows = b"".join(b"\x00" + rgb[row].tobytes() for row in range(height))

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"".join([
        b"\x89PNG\r\n\x1a\n",
        chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
        chunk(b"IDAT", zlib.compress(rows, level=6)),
        chunk(b"IEND", b""),
    ]))


FONT = {
    "A": ["010", "101", "111", "101", "101"], "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"], "G": ["011", "100", "101", "101", "011"],
    "H": ["101", "101", "111", "101", "101"], "K": ["101", "110", "100", "110", "101"],
    "L": ["100", "100", "100", "100", "111"], "M": ["101", "111", "111", "101", "101"],
    "N": ["101", "111", "111", "111", "101"], "O": ["010", "101", "101", "101", "010"],
    "P": ["110", "101", "110", "100", "100"], "R": ["110", "101", "110", "101", "101"],
    "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"], "W": ["101", "101", "111", "111", "101"],
    " ": ["000", "000", "000", "000", "000"],
}


def draw_label(canvas: np.ndarray, text: str, x0: int, y0: int, width: int, scale: int = 2) -> None:
    text = text.upper()
    glyph_width = 3 * scale
    spacing = scale
    total = len(text) * glyph_width + max(0, len(text) - 1) * spacing
    x = x0 + max(0, (width - total) // 2)
    for character in text:
        glyph = FONT.get(character, FONT[" "])
        for row, bits in enumerate(glyph):
            for column, bit in enumerate(bits):
                if bit == "1":
                    canvas[y0 + row * scale:y0 + (row + 1) * scale, x + column * scale:x + (column + 1) * scale] = 225
        x += glyph_width + spacing


def heat_rgb(values: np.ndarray, scale: float) -> np.ndarray:
    normalized = np.clip(values.astype(np.float64) / max(scale, 1.0e-12), 0.0, 1.0)
    red = np.clip(3.0 * normalized, 0.0, 1.0)
    green = np.clip(3.0 * normalized - 0.85, 0.0, 1.0)
    blue = np.clip(3.0 * normalized - 2.0, 0.0, 1.0) * 0.75
    return np.asarray(np.round(np.stack([red, green, blue], axis=-1) * 255), dtype=np.uint8)


def signed_rgb(values: np.ndarray, scale: float) -> np.ndarray:
    normalized = np.clip(values.astype(np.float64) / max(scale, 1.0e-12), -1.0, 1.0)
    red = np.clip(normalized, 0.0, 1.0)
    blue = np.clip(-normalized, 0.0, 1.0)
    green = (1.0 - np.abs(normalized)) * 0.15
    return np.asarray(np.round(np.stack([red, green, blue], axis=-1) * 255), dtype=np.uint8)


def mask_rgb(mask: np.ndarray, predicted: bool) -> np.ndarray:
    values = mask.astype(np.uint8) * 255
    zeros = np.zeros_like(values)
    return np.stack([zeros if predicted else values, values, values if predicted else zeros], axis=-1)


def write_preview(
    out_dir: Path,
    channel: str,
    grid: int,
    slice_y: int,
    truth: np.ndarray,
    low: np.ndarray,
    ungated: np.ndarray,
    gated: np.ndarray,
    truth_support: np.ndarray,
    predicted_support: np.ndarray,
) -> dict[str, Any]:
    shape = (grid, grid)
    fields = [value.reshape(shape) for value in [truth, low, ungated, gated]]
    shared_scale = max(1.0e-8, float(max(np.max(np.abs(value)) for value in fields)))
    error = (gated - truth).reshape(shape)
    error_scale = max(1.0e-8, float(np.max(np.abs(error))))
    panels = [
        heat_rgb(fields[0], shared_scale), heat_rgb(fields[1], shared_scale),
        heat_rgb(fields[2], shared_scale), heat_rgb(fields[3], shared_scale),
        mask_rgb(truth_support.reshape(shape), False), mask_rgb(predicted_support.reshape(shape), True),
        signed_rgb(error, error_scale),
    ]
    labels = ["TRUTH", "LOW", "UNGATED", "GATED", "TRUE MASK", "PRED MASK", "ERROR"]
    gap = 4
    label_height = 16
    canvas = np.zeros((grid + label_height, grid * len(panels) + gap * (len(panels) - 1), 3), dtype=np.uint8)
    for index, (panel, label) in enumerate(zip(panels, labels)):
        x = index * (grid + gap)
        canvas[:grid, x:x + grid] = panel
        draw_label(canvas, label, x, grid + 3, grid)
    previews = out_dir / "previews"
    png_path = previews / f"{channel}.support-gate-preview.png"
    json_path = previews / f"{channel}.support-gate-preview.json"
    write_png_rgb(png_path, canvas)
    receipt = {
        "schema": REPORT_SCHEMA,
        "identity": PREVIEW_IDENTITY,
        "status": "written",
        "channel": channel,
        "slice": {"axis": "y", "index": slice_y},
        "rowOrder": ["truthHigh", "lowUpsampled", "ungatedPrediction", "gatedPrediction", "truthSupport", "predictedSupport", "gatedSignedError"],
        "labelPlacement": "under-each-panel",
        "sharedAbsFieldMax": shared_scale,
        "gatedSignedErrorAbsMax": error_scale,
        "authority": "offline-labeled-channel-slice-not-renderer-state",
        "png": {"path": str(png_path), "sha256": sha256_file(png_path)},
    }
    write_json(json_path, receipt)
    return receipt


def save_model(path: Path, state: dict[str, np.ndarray | float], standardization: dict[str, np.ndarray], threshold: float | None = None) -> dict[str, Any]:
    payload = {
        "w1": state["w1"], "b1": state["b1"], "w2": state["w2"], "b2": state["b2"],
        "targetMean": np.asarray([state["targetMean"]], dtype=np.float32),
        "targetStd": np.asarray([state["targetStd"]], dtype=np.float32),
        "featureMean": standardization["mean"], "featureStd": standardization["std"],
    }
    if threshold is not None:
        payload["threshold"] = np.asarray([threshold], dtype=np.float32)
    np.savez(path, **payload)
    return {"path": str(path), "sha256": sha256_file(path), "byteLength": path.stat().st_size}


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        phase = "manifest-validation"
        pair_path = Path(args.pair_manifest).resolve()
        full_path = Path(args.full_grid_manifest).resolve()
        pair = read_json(pair_path)
        full = read_json(full_path)
        if pair.get("schema") != "kaminos.volume.full-grid-field-pair.v0" or pair.get("status") != "captured":
            raise ProbeFailure(phase, "pair manifest is not a captured full-grid field pair", {"path": str(pair_path)})
        if pair.get("authority") != PAIR_AUTHORITY:
            raise ProbeFailure(phase, "pair authority mismatch", {
                "expectedAuthority": PAIR_AUTHORITY,
                "actualAuthority": pair.get("authority"),
            })
        if full.get("schema") != "kaminos.volume.full-grid-field-export.v0" or full.get("status") != "captured":
            raise ProbeFailure(phase, "full-grid manifest is not a captured export", {"path": str(full_path)})
        if full.get("failurePhase") is not None or full.get("completeFieldCoverage") is not True:
            raise ProbeFailure(phase, "full-grid export is incomplete", {"failurePhase": full.get("failurePhase")})
        if (
            full.get("identity") == "full-grid-fluid-front-only-v0"
            or full.get("exportScope") == "fluid-front-only-v0"
            or full.get("derivedBoundaryCoverage") == "omitted-by-caller-v0"
        ):
            raise ProbeFailure(phase, "support probe requires included derived boundary coverage", {
                "identity": full.get("identity"),
                "exportScope": full.get("exportScope"),
                "derivedBoundaryCoverage": full.get("derivedBoundaryCoverage"),
            })
        low_grid = int(pair["lowGrid"])
        high_grid = int(pair["highGrid"])
        if int(full.get("grid") or 0) != high_grid:
            raise ProbeFailure(phase, "pair/full-grid high grid mismatch", {"pairHighGrid": high_grid, "fullGrid": full.get("grid")})
        exact_sha = pair.get("source", {}).get("exactBasinSourceCaptureSha256")
        if exact_sha != full.get("sourceCapture", {}).get("payloadSha256"):
            raise ProbeFailure(phase, "pair/full-grid exact basin SHA mismatch", {"pair": exact_sha, "fullGrid": full.get("sourceCapture")})
        if full.get("boundarySplats", {}).get("draw", {}).get("overflowCount") != 0:
            raise ProbeFailure(phase, "full-grid learned splats overflowed", {"draw": full.get("boundarySplats", {}).get("draw")})
        channels = parse_channels(args.channels)
        low_fluid_path = verify_descriptor(pair["low"]["fluid"], phase)
        low_front_path = verify_descriptor(pair["low"]["front"], phase)
        high_fluid_path = verify_descriptor(pair["high"]["fluid"], phase)
        high_front_path = verify_descriptor(pair["high"]["front"], phase)
        boundary_descriptor = full["boundarySidecar"]["sidecars"]["boundary"]
        boundary_path = verify_descriptor(boundary_descriptor, phase)
        splat_descriptor = full["boundarySplats"]["sidecars"]["boundarySplats"]
        splat_path = verify_descriptor(splat_descriptor, phase)
        if pair["high"]["fluid"]["sha256"] != full["sidecars"]["fluid"]["sha256"] or pair["high"]["front"]["sha256"] != full["sidecars"]["front"]["sha256"]:
            raise ProbeFailure(phase, "pair high field does not match full-grid high field", {
                "pairFluid": pair["high"]["fluid"]["sha256"], "fullFluid": full["sidecars"]["fluid"]["sha256"],
                "pairFront": pair["high"]["front"]["sha256"], "fullFront": full["sidecars"]["front"]["sha256"],
            })

        low_cells = low_grid ** 3
        high_cells = high_grid ** 3
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, 16))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_cells, 16))
        high_front = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_cells,))
        high_boundary = np.memmap(boundary_path, dtype="<f4", mode="r", shape=(high_cells, 4))
        splat_shape = tuple(int(value) for value in splat_descriptor["shape"])
        splats = np.memmap(splat_path, dtype="<f4", mode="r", shape=splat_shape)

        phase = "label-validation"
        labels, structural_signal, label_authority = derive_and_validate_labels(high_fluid, high_boundary, splats, high_grid)
        if int(full["boundarySplats"]["draw"]["candidateCount"]) != label_authority["formulaPositiveCount"]:
            raise ProbeFailure(phase, "accepted label count disagrees with draw receipt", {
                "labelAuthority": label_authority, "draw": full["boundarySplats"]["draw"],
            })

        phase = "split"
        roles, split_receipt = spatial_split(high_grid, args.spatial_block_size, args.seed)
        pools = {"test": np.flatnonzero(roles == 0), "validation": np.flatnonzero(roles == 1), "train": np.flatnonzero(roles == 2)}
        for role, pool in pools.items():
            positive_count = int(np.count_nonzero(labels[pool]))
            if positive_count == 0 or positive_count == pool.size:
                raise ProbeFailure(phase, f"spatial {role} split lacks both classes", {
                    "role": role, "count": int(pool.size), "positiveCount": positive_count,
                })
        rng = np.random.default_rng(args.seed)
        train_indexes = sample_balanced(pools["train"], labels, args.train_samples, args.train_positive_fraction, rng)
        validation_indexes = sample_uniform(pools["validation"], args.validation_samples, rng)
        test_indexes = sample_uniform(pools["test"], args.test_samples, rng)
        split_receipt["roles"] = {
            role: {
                "poolCount": int(pool.size),
                "poolPositiveCount": int(np.count_nonzero(labels[pool])),
                "sampleCount": int({"train": train_indexes, "validation": validation_indexes, "test": test_indexes}[role].size),
                "samplePositiveCount": int(np.count_nonzero(labels[{"train": train_indexes, "validation": validation_indexes, "test": test_indexes}[role]])),
            }
            for role, pool in pools.items()
        }

        phase = "feature-build"
        low_train, x_train, y_train, z_train = low_values_for_high_cells(low_fluid, low_front, train_indexes, low_grid, high_grid)
        low_validation, x_validation, y_validation, z_validation = low_values_for_high_cells(low_fluid, low_front, validation_indexes, low_grid, high_grid)
        low_test, x_test, y_test, z_test = low_values_for_high_cells(low_fluid, low_front, test_indexes, low_grid, high_grid)
        train_features = build_features(low_train, x_train, y_train, z_train, high_grid)
        validation_features = build_features(low_validation, x_validation, y_validation, z_validation, high_grid)
        test_features = build_features(low_test, x_test, y_test, z_test, high_grid)
        train_features, [validation_features, test_features], standardization = standardize(train_features, validation_features, test_features)

        phase = "classifier-train"
        classifier_state, classifier_training = train_mlp(train_features, labels[train_indexes].astype(np.float32), args, rng, binary=True)
        validation_probability = predict_mlp(validation_features, classifier_state, binary=True)
        test_probability = predict_mlp(test_features, classifier_state, binary=True)
        threshold, threshold_receipt = select_threshold(validation_probability, labels[validation_indexes])
        test_classification = classification_metrics(test_probability, labels[test_indexes], threshold)
        classifier_path = out_dir / "support-classifier.npz"
        classifier_artifact = save_model(classifier_path, classifier_state, standardization, threshold)

        phase = "channel-assay"
        gated_channels = []
        channel_states: dict[str, dict[str, np.ndarray | float]] = {}
        predicted_support_test = test_probability >= np.float32(threshold)
        for channel in channels:
            low_train_channel = low_train[:, ALL_CHANNELS.index(channel)]
            low_test_channel = low_test[:, ALL_CHANNELS.index(channel)]
            high_train_channel = channel_values(high_fluid, high_front, train_indexes, channel)
            high_test_channel = channel_values(high_fluid, high_front, test_indexes, channel)
            residual_train = high_train_channel - low_train_channel
            state, training = train_mlp(train_features, residual_train, args, rng, binary=False)
            residual_test = predict_mlp(test_features, state, binary=False)
            ungated = low_test_channel + residual_test
            gated = low_test_channel + residual_test * predicted_support_test.astype(np.float32)
            truth_support = labels[test_indexes]
            low_metrics = scalar_metrics(low_test_channel, high_test_channel)
            ungated_metrics = scalar_metrics(ungated, high_test_channel)
            gated_metrics = scalar_metrics(gated, high_test_channel)
            gated_channels.append({
                "channel": channel,
                "channelIndex": ALL_CHANNELS.index(channel),
                "model": {"identity": CHANNEL_HEAD_IDENTITY, **training},
                "lowUpsampled": low_metrics,
                "ungated": {"metrics": ungated_metrics, "improvementVsLow": improvement(low_metrics, ungated_metrics)},
                "gated": {"metrics": gated_metrics, "improvementVsLow": improvement(low_metrics, gated_metrics)},
                "onSupport": {
                    "low": region_metrics(low_test_channel, high_test_channel, low_test_channel, truth_support),
                    "ungated": region_metrics(ungated, high_test_channel, low_test_channel, truth_support),
                    "gated": region_metrics(gated, high_test_channel, low_test_channel, truth_support),
                },
                "offSupport": {
                    "low": region_metrics(low_test_channel, high_test_channel, low_test_channel, ~truth_support),
                    "ungated": region_metrics(ungated, high_test_channel, low_test_channel, ~truth_support),
                    "gated": region_metrics(gated, high_test_channel, low_test_channel, ~truth_support),
                },
            })
            channel_states[channel] = state

        phase = "preview-write"
        slice_y = int(args.preview_slice_y if args.preview_slice_y is not None else high_grid // 2)
        if slice_y < 0 or slice_y >= high_grid:
            raise ProbeFailure(phase, "preview slice is outside the high grid", {"sliceY": slice_y, "highGrid": high_grid})
        slice_indexes = np.array([
            x + slice_y * high_grid + z * high_grid * high_grid
            for z in range(high_grid)
            for x in range(high_grid)
        ], dtype=np.int64)
        low_slice, sx, sy, sz = low_values_for_high_cells(low_fluid, low_front, slice_indexes, low_grid, high_grid)
        slice_features = build_features(low_slice, sx, sy, sz, high_grid)
        slice_features = ((slice_features - standardization["mean"]) / standardization["std"]).astype(np.float32)
        slice_probability = predict_mlp(slice_features, classifier_state, binary=True)
        predicted_support_slice = slice_probability >= np.float32(threshold)
        preview_receipts = []
        for channel in channels:
            low_channel = low_slice[:, ALL_CHANNELS.index(channel)]
            truth_channel = channel_values(high_fluid, high_front, slice_indexes, channel)
            residual = predict_mlp(slice_features, channel_states[channel], binary=False)
            ungated = low_channel + residual
            gated = low_channel + residual * predicted_support_slice.astype(np.float32)
            preview_receipts.append(write_preview(
                out_dir, channel, high_grid, slice_y,
                truth_channel, low_channel, ungated, gated,
                labels[slice_indexes], predicted_support_slice,
            ))

        phase = "report-write"
        model_path = out_dir / "gated-channel-heads.npz"
        model_payload: dict[str, np.ndarray] = {}
        for channel, state in channel_states.items():
            for key in ["w1", "b1", "w2", "b2"]:
                model_payload[f"{channel}.{key}"] = np.asarray(state[key])
            model_payload[f"{channel}.targetMean"] = np.asarray([state["targetMean"]], dtype=np.float32)
            model_payload[f"{channel}.targetStd"] = np.asarray([state["targetStd"]], dtype=np.float32)
        np.savez(model_path, **model_payload)
        report = {
            "schema": REPORT_SCHEMA,
            "identity": PROBE_IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "authority": "fit-on-one-phase-aligned-exact-basin-diagnostic-not-native-low-transfer",
            "route": {
                "effectiveRoute": full.get("effectiveRoute"), "backend": full.get("backend"),
                "exactBasinSourceCaptureSha256": exact_sha,
                "deterministicReplay": full.get("deterministicReplay"),
            },
            "inputs": {
                "pairManifest": {"path": str(pair_path), "sha256": sha256_file(pair_path)},
                "fullGridManifest": {"path": str(full_path), "sha256": sha256_file(full_path)},
                "lowGrid": low_grid, "highGrid": high_grid,
                "pairAuthority": pair.get("authority"),
                "trainingInputAuthority": TRAINING_INPUT_AUTHORITY,
                "trainingInputSyntheticDownsample": True,
                "nativeDeploymentInputSeenDuringTraining": False,
                "fluidChannelOrder": FLUID_CHANNELS,
                "boundaryChannelOrder": boundary_descriptor.get("channelOrder"),
                "effectiveSplatShape": splat_descriptor.get("shape"),
                "effectiveSplatSha256": splat_descriptor.get("sha256"),
            },
            "labelAuthority": label_authority,
            "split": split_receipt,
            "features": {"identity": FEATURE_IDENTITY, "featureCount": int(train_features.shape[1]), "source": "current phase-aligned low field only"},
            "classifier": {
                "identity": CLASSIFIER_IDENTITY,
                "training": classifier_training,
                "thresholdSelection": threshold_receipt,
                "test": {"metrics": test_classification},
                "artifact": classifier_artifact,
            },
            "gatedChannels": gated_channels,
            "channelHeadArtifact": {"path": str(model_path), "sha256": sha256_file(model_path), "byteLength": model_path.stat().st_size},
            "visualPreviews": preview_receipts,
            "limitations": [
                "Single exact basin and one phase-aligned high-history pair; native low deployment transfer is not tested.",
                "Spatial-block held-out cells reduce local leakage but do not constitute a second deterministic replay holdout.",
                "Offline channel slices are not renderer output; renderer-coupled remarch remains the promotion gate.",
            ],
            "structuralSignal": {
                "acceptedMin": float(np.min(structural_signal[labels])),
                "acceptedMedian": float(np.median(structural_signal[labels])),
                "acceptedMax": float(np.max(structural_signal[labels])),
            },
        }
        write_json(out_dir / "manifest.json", report)
        print(json.dumps({
            "status": "captured", "manifest": str(out_dir / "manifest.json"),
            "testClassifier": test_classification,
            "gatedChannels": [
                {
                    "channel": item["channel"],
                    "ungatedRmseReduction": item["ungated"]["improvementVsLow"]["rmseReductionFraction"],
                    "gatedRmseReduction": item["gated"]["improvementVsLow"]["rmseReductionFraction"],
                    "offSupportUngatedMae": item["offSupport"]["ungated"]["mae"],
                    "offSupportGatedMae": item["offSupport"]["gated"]["mae"],
                }
                for item in gated_channels
            ],
        }, indent=2))
        return 0
    except Exception as error:
        fail_report(out_dir, error, locals().get("phase", "unknown"))
        print(f"support probe failed at {getattr(error, 'phase', locals().get('phase', 'unknown'))}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
