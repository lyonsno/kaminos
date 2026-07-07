#!/usr/bin/env python3
"""Full-input, single-output channel learnability probe for Kaminos full-grid fields."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.full-grid-field-per-channel-probe.v0"
PROBE_IDENTITY = "full-input-single-output-channel-probe-v0"
RIDGE_IDENTITY = "single-channel-ridge-residual-v0"
MLP_IDENTITY = "single-channel-mlp-residual-v0"
ASSEMBLED_APPLICATION_IDENTITY = "scalar-head-assembled-full-grid-application-v0"
VISUAL_PREVIEW_IDENTITY = "full-grid-per-channel-visual-preview-v0"
VISUAL_PREVIEW_AUTHORITY = "offline-channel-preview-not-renderer-state"
FIELD_AUTHORITY = "complete-webgpu-fluid-front-buffer-readback-sidecars"
APPLICATION_SCHEMA = "kaminos.volume.full-grid-field-residual-application.v0"

_APPLY_PATH = Path(__file__).with_name("volume-full-grid-field-residual-apply.py")
_SPEC = importlib.util.spec_from_file_location("volume_full_grid_field_residual_apply", _APPLY_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_APPLY_PATH}")
_APPLY = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_APPLY)

FLUID_CHANNELS = list(_APPLY.FLUID_CHANNELS)
FRONT_CHANNELS = list(_APPLY.FRONT_CHANNELS)
ALL_CHANNELS = [*FLUID_CHANNELS, *FRONT_CHANNELS]
DEFAULT_CARRIER_CHANNELS = [
    "densityCarrier",
    "smokeDensity",
    "heat",
    "fuel",
    "flame",
    "ember",
    "visibleFireCarrier",
    "combustionFront",
    "microdetail",
    "interfaceShred",
    "fireLick",
    "emberFleck",
    "frontTopology",
]


class ProbeFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True, help="Full-grid low/high field-pair manifest.")
    parser.add_argument("--out", required=True, help="Report JSON path.")
    parser.add_argument(
        "--target-channel-list",
        default=",".join(DEFAULT_CARRIER_CHANNELS),
        help="Comma-separated target channels. Use 'all' for every fluid/front channel.",
    )
    parser.add_argument(
        "--model",
        choices=["ridge", "mlp", "both"],
        default="both",
        help="Per-channel model family. Ridge is a baseline; scalar MLP tests output-capacity interference.",
    )
    parser.add_argument("--comparison-application-manifest", help="Optional existing full-grid residual application manifest for all-channel comparison.")
    parser.add_argument("--train-samples", type=int, default=90_000, help="Training cell count shared across channel probes.")
    parser.add_argument("--test-samples", type=int, default=50_000, help="Held-out cell count for report-only same-pair diagnostics.")
    parser.add_argument("--support-sample-fraction", type=float, default=0.55, help="Fraction of train/test samples drawn from truth flame support when available.")
    parser.add_argument("--ridge", type=float, default=1.0e-3, help="Ridge regularization for linear baseline.")
    parser.add_argument("--hidden-width", type=int, default=48, help="Hidden width for single-channel-mlp-residual-v0.")
    parser.add_argument("--epochs", type=int, default=70, help="Epochs for single-channel-mlp-residual-v0.")
    parser.add_argument("--learning-rate", type=float, default=2.0e-3, help="Adam learning rate for single-channel-mlp-residual-v0.")
    parser.add_argument("--batch-size", type=int, default=1024, help="MLP minibatch size.")
    parser.add_argument("--weight-decay", type=float, default=1.0e-5, help="MLP L2 weight decay.")
    parser.add_argument("--gradient-pairs", type=int, default=30_000, help="Maximum adjacent x-neighbor pairs for gradient energy metrics.")
    parser.add_argument("--application-out-dir", help="Optional output directory for complete scalar-head assembled full-grid application sidecars.")
    parser.add_argument(
        "--scalar-head-assembly-base",
        choices=["lowUpsampled", "comparisonApplication"],
        default="lowUpsampled",
        help="Complete field used as the base before replacing selected target channels with scalar-head predictions.",
    )
    parser.add_argument("--assembly-chunk-z", type=int, default=4, help="High-grid z slices per scalar-head assembly chunk.")
    parser.add_argument("--visual-preview-dir", help="Optional directory for offline per-channel truth/low/pred/error decomposition PNGs.")
    parser.add_argument("--visual-preview-slice-y", type=int, help="Optional y slice for per-channel previews; defaults to highGrid//2.")
    parser.add_argument("--seed", type=int, default=7331, help="Deterministic sample/model seed.")
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


def write_failure(path: Path, phase: str, error: Exception, evidence: dict[str, Any] | None = None) -> None:
    payload = {
        "schema": REPORT_SCHEMA,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    }
    if isinstance(error, ProbeFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.evidence
    write_json(path, payload)


def parse_target_channels(value: str) -> list[int]:
    if value.strip().lower() == "all":
        return list(range(len(ALL_CHANNELS)))
    indexes = []
    for raw in value.split(","):
        name = raw.strip()
        if not name:
            continue
        if name not in ALL_CHANNELS:
            raise ProbeFailure("args", f"Unknown target channel {name}", {"availableChannels": ALL_CHANNELS})
        indexes.append(ALL_CHANNELS.index(name))
    if not indexes:
        raise ProbeFailure("args", "No target channels selected.", {"targetChannelList": value})
    return indexes


def channel_values(fluid: np.ndarray, front: np.ndarray, indexes: np.ndarray, channel_index: int) -> np.ndarray:
    if channel_index < len(FLUID_CHANNELS):
        return np.asarray(fluid[indexes, channel_index], dtype=np.float32)
    return np.asarray(front[indexes], dtype=np.float32)


def verify_application_sidecars(manifest_path: Path, high_grid: int) -> tuple[np.memmap, np.memmap, dict[str, Any]]:
    manifest = read_json(manifest_path)
    if manifest.get("schema") != APPLICATION_SCHEMA:
        raise ProbeFailure("comparison-application", "Comparison manifest schema mismatch.", {
            "schema": manifest.get("schema"),
            "path": str(manifest_path),
        })
    role = manifest.get("roles", {}).get("predictedHigh")
    if not role:
        raise ProbeFailure("comparison-application", "Comparison manifest is missing predictedHigh role.", {"path": str(manifest_path)})
    fluid_desc = role["fluid"]
    front_desc = role["front"]
    fluid_path = Path(fluid_desc["path"])
    front_path = Path(front_desc["path"])
    for descriptor, path in [(fluid_desc, fluid_path), (front_desc, front_path)]:
        if not path.exists():
            raise ProbeFailure("comparison-application", f"Missing comparison sidecar {path}", {"path": str(path)})
        if path.stat().st_size != int(descriptor.get("byteLength") or 0):
            raise ProbeFailure("comparison-application", f"Comparison sidecar byte mismatch {path}", {
                "expectedBytes": descriptor.get("byteLength"),
                "actualBytes": path.stat().st_size,
            })
    cells = high_grid ** 3
    fluid = np.memmap(fluid_path, dtype="<f4", mode="r", shape=(cells, len(FLUID_CHANNELS)))
    front = np.memmap(front_path, dtype="<f4", mode="r", shape=(cells,))
    return fluid, front, {
        "path": str(manifest_path),
        "sha256": sha256_file(manifest_path),
        "model": manifest.get("model"),
        "role": "predictedHigh",
    }


def mixed_sample_indexes(
    high_cells: int,
    sample_count: int,
    support: np.ndarray,
    support_fraction: float,
    rng: np.random.Generator,
    exclude: np.ndarray | None = None,
) -> np.ndarray:
    sample_count = min(max(1, int(sample_count)), high_cells)
    exclude_set = set(int(x) for x in exclude.tolist()) if exclude is not None and exclude.size else set()
    support = support.astype(np.int64, copy=False)
    if exclude_set:
        support = np.array([int(x) for x in support.tolist() if int(x) not in exclude_set], dtype=np.int64)
    support_target = min(support.shape[0], int(sample_count * max(0.0, min(1.0, float(support_fraction)))))
    chosen = []
    if support_target > 0:
        chosen.extend(rng.choice(support, size=support_target, replace=False).astype(np.int64).tolist())
    needed = sample_count - len(chosen)
    chosen_set = set(chosen) | exclude_set
    while needed > 0:
        oversample = max(needed * 2, needed + 64)
        randoms = rng.integers(0, high_cells, size=oversample, dtype=np.int64)
        for value in randoms.tolist():
            if value in chosen_set:
                continue
            chosen.append(int(value))
            chosen_set.add(int(value))
            needed -= 1
            if needed == 0:
                break
    return np.array(chosen, dtype=np.int64)


def standardize_features(train_features: np.ndarray, test_features: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    mean = np.mean(train_features, axis=0, dtype=np.float64).astype(np.float32)
    std = np.std(train_features, axis=0, dtype=np.float64).astype(np.float32)
    std = np.where(std < np.float32(1.0e-6), np.float32(1.0), std)
    train = ((train_features - mean.reshape(1, -1)) / std.reshape(1, -1)).astype(np.float32)
    test = ((test_features - mean.reshape(1, -1)) / std.reshape(1, -1)).astype(np.float32)
    return train, test, {
        "identity": "train-feature-standardization-v0",
        "featureCount": int(train_features.shape[1]),
        "zeroStdFeatureCount": int(np.count_nonzero(std == 1.0)),
    }


def fit_ridge_scalar(train_features: np.ndarray, train_residual: np.ndarray, test_features: np.ndarray, ridge: float) -> tuple[np.ndarray, dict[str, Any]]:
    weights = _APPLY.fit_ridge(train_features, train_residual.reshape(-1, 1), ridge)
    prediction = _APPLY.predict_residual(test_features, weights).reshape(-1)
    return prediction, {
        "identity": RIDGE_IDENTITY,
        "ridge": float(ridge),
        "interferenceNote": "Linear ridge solves independent target columns under a shared design matrix; use this as a baseline, not strong evidence about nonlinear multi-output capacity sharing.",
    }


def train_scalar_mlp(
    train_features: np.ndarray,
    train_residual: np.ndarray,
    test_features: np.ndarray,
    args: argparse.Namespace,
    rng: np.random.Generator,
) -> tuple[np.ndarray, dict[str, Any], dict[str, Any]]:
    feature_count = train_features.shape[1]
    hidden_width = max(1, int(args.hidden_width))
    target_mean = float(np.mean(train_residual))
    target_std = float(np.std(train_residual))
    if target_std < 1.0e-7:
        target_std = 1.0
    y = ((train_residual.astype(np.float32) - np.float32(target_mean)) / np.float32(target_std)).reshape(-1, 1)
    w1 = (rng.normal(0.0, math.sqrt(2.0 / max(1, feature_count)), size=(feature_count, hidden_width))).astype(np.float32)
    b1 = np.zeros((1, hidden_width), dtype=np.float32)
    w2 = (rng.normal(0.0, math.sqrt(2.0 / max(1, hidden_width)), size=(hidden_width, 1))).astype(np.float32)
    b2 = np.zeros((1, 1), dtype=np.float32)
    params = [w1, b1, w2, b2]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    lr = np.float32(max(1.0e-6, float(args.learning_rate)))
    beta1 = np.float32(0.9)
    beta2 = np.float32(0.999)
    eps = np.float32(1.0e-8)
    batch_size = max(16, int(args.batch_size))
    epochs = max(1, int(args.epochs))
    step = 0
    final_loss = 0.0
    n = train_features.shape[0]
    for _epoch in range(epochs):
        order = rng.permutation(n)
        total_loss = 0.0
        total_rows = 0
        for start in range(0, n, batch_size):
            batch = order[start:start + batch_size]
            xb = train_features[batch]
            yb = y[batch]
            z1 = xb @ w1 + b1
            h1 = np.tanh(z1)
            out = h1 @ w2 + b2
            err = out - yb
            rows = max(1, xb.shape[0])
            loss = float(np.mean(err * err))
            total_loss += loss * rows
            total_rows += rows
            grad_out = (2.0 / rows) * err
            grad_w2 = h1.T @ grad_out + np.float32(args.weight_decay) * w2
            grad_b2 = np.sum(grad_out, axis=0, keepdims=True)
            grad_h1 = grad_out @ w2.T
            grad_z1 = grad_h1 * (1.0 - h1 * h1)
            grad_w1 = xb.T @ grad_z1 + np.float32(args.weight_decay) * w1
            grad_b1 = np.sum(grad_z1, axis=0, keepdims=True)
            grads = [grad_w1.astype(np.float32), grad_b1.astype(np.float32), grad_w2.astype(np.float32), grad_b2.astype(np.float32)]
            step += 1
            for i, (param, grad) in enumerate(zip(params, grads)):
                m[i] = beta1 * m[i] + (1.0 - beta1) * grad
                v[i] = beta2 * v[i] + (1.0 - beta2) * (grad * grad)
                m_hat = m[i] / (1.0 - float(beta1) ** step)
                v_hat = v[i] / (1.0 - float(beta2) ** step)
                param -= lr * m_hat / (np.sqrt(v_hat) + eps)
        final_loss = total_loss / max(1, total_rows)
    test_output = np.tanh(test_features @ w1 + b1) @ w2 + b2
    test_residual = (test_output.reshape(-1) * np.float32(target_std) + np.float32(target_mean)).astype(np.float32)
    report = {
        "identity": MLP_IDENTITY,
        "hiddenWidth": hidden_width,
        "epochs": epochs,
        "learningRate": float(args.learning_rate),
        "batchSize": batch_size,
        "weightDecay": float(args.weight_decay),
        "targetResidualMean": target_mean,
        "targetResidualStd": target_std,
        "finalTrainStandardizedMse": final_loss,
    }
    state = {
        "w1": w1,
        "b1": b1,
        "w2": w2,
        "b2": b2,
        "targetMean": np.float32(target_mean),
        "targetStd": np.float32(target_std),
    }
    return test_residual, report, state


def predict_scalar_mlp(features: np.ndarray, state: dict[str, Any]) -> np.ndarray:
    output = np.tanh(features @ state["w1"] + state["b1"]) @ state["w2"] + state["b2"]
    return (output.reshape(-1) * state["targetStd"] + state["targetMean"]).astype(np.float32)


def scalar_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    err = prediction.astype(np.float64) - truth.astype(np.float64)
    return {
        "mse": float(np.mean(err * err)),
        "rmse": float(math.sqrt(float(np.mean(err * err)))),
        "mae": float(np.mean(np.abs(err))),
        "maxAbs": float(np.max(np.abs(err))) if err.size else 0.0,
    }


def support_localized_metrics(low: np.ndarray, truth: np.ndarray, prediction: np.ndarray) -> dict[str, Any]:
    truth_abs = np.abs(truth.astype(np.float64))
    residual_abs = np.abs(truth.astype(np.float64) - low.astype(np.float64))
    threshold = max(1.0e-5, float(np.quantile(truth_abs, 0.95)) * 0.25, float(np.quantile(residual_abs, 0.95)) * 0.25)
    mask = (truth_abs > threshold) | (residual_abs > threshold)
    support_count = int(np.count_nonzero(mask))
    if support_count == 0:
        return {
            "identity": "supportLocalized-channel-error-v0",
            "supportThreshold": threshold,
            "supportCount": 0,
            "supportFraction": 0.0,
            "metrics": None,
        }
    return {
        "identity": "supportLocalized-channel-error-v0",
        "supportThreshold": threshold,
        "supportCount": support_count,
        "supportFraction": float(support_count / max(1, truth.shape[0])),
        "metrics": scalar_metrics(prediction[mask], truth[mask]),
    }


def gradient_energy_from_values(low: np.ndarray, truth: np.ndarray, pred: np.ndarray) -> dict[str, Any]:
    # Fallback one-dimensional adjacent-order diagnostic for MLP channels.
    if truth.shape[0] < 2:
        return {"identity": "gradientEnergyRecovery-sampled-order-v0", "pairCount": 0}
    truth_energy = float(np.mean(np.abs(np.diff(truth.astype(np.float64)))))
    low_energy = float(np.mean(np.abs(np.diff(low.astype(np.float64)))))
    pred_energy = float(np.mean(np.abs(np.diff(pred.astype(np.float64)))))
    return {
        "identity": "gradientEnergyRecovery-sampled-order-v0",
        "limitation": "Sample-order gradient energy is a cheap report-only proxy; render/debug-view metrics remain the visual authority.",
        "pairCount": int(truth.shape[0] - 1),
        "truthGradientEnergy": truth_energy,
        "lowUpsampledGradientEnergy": low_energy,
        "lowUpsampledRecovery": float(low_energy / max(truth_energy, 1.0e-12)),
        "modelGradientEnergy": pred_energy,
        "gradientEnergyRecovery": float(pred_energy / max(truth_energy, 1.0e-12)),
    }


def improvement_vs(base: dict[str, float], model: dict[str, float]) -> dict[str, float]:
    return {
        "rmseReductionFraction": float((base["rmse"] - model["rmse"]) / max(base["rmse"], 1.0e-12)),
        "maeReductionFraction": float((base["mae"] - model["mae"]) / max(base["mae"], 1.0e-12)),
    }


def write_png_rgb(path: Path, rgb: np.ndarray) -> None:
    if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ProbeFailure("visual-preview-write", "PNG payload must be uint8 RGB.", {"shape": list(rgb.shape), "dtype": str(rgb.dtype)})
    height, width, _channels = rgb.shape
    rows = b"".join(b"\x00" + rgb[y].tobytes() for y in range(height))

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"".join([
        b"\x89PNG\r\n\x1a\n",
        chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
        chunk(b"IDAT", zlib.compress(rows, level=6)),
        chunk(b"IEND", b""),
    ]))


def heat_rgb(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values.astype(np.float64), 0.0, 1.0)
    red = np.clip(3.0 * clipped, 0.0, 1.0)
    green = np.clip(3.0 * clipped - 0.85, 0.0, 1.0)
    blue = np.clip(3.0 * clipped - 2.0, 0.0, 1.0) * 0.75
    floor = 0.03 + 0.05 * clipped
    return np.asarray(np.round(np.stack([
        np.maximum(red, floor),
        np.maximum(green, floor),
        np.maximum(blue, floor),
    ], axis=-1) * 255.0), dtype=np.uint8)


def signed_error_rgb(error: np.ndarray, scale: float) -> np.ndarray:
    if scale <= 0:
        return np.zeros((*error.shape, 3), dtype=np.uint8)
    normalized = np.clip(error.astype(np.float64) / scale, -1.0, 1.0)
    red = np.clip(normalized, 0.0, 1.0)
    blue = np.clip(-normalized, 0.0, 1.0)
    green = np.clip(1.0 - np.abs(normalized), 0.0, 1.0) * 0.35
    floor = np.full_like(red, 0.03)
    return np.asarray(np.round(np.stack([
        np.maximum(red, floor),
        np.maximum(green, floor),
        np.maximum(blue, floor),
    ], axis=-1) * 255.0), dtype=np.uint8)


def normalize_abs(values: np.ndarray, scale: float) -> np.ndarray:
    if scale <= 0:
        return np.zeros_like(values, dtype=np.float64)
    return np.clip(np.abs(values.astype(np.float64)) / scale, 0.0, 1.0)


def sidecar_descriptor(path: Path, shape: list[int], channel_order: list[str]) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "dtype": "float32",
        "byteOrder": "little-endian",
        "floatCount": int(math.prod(shape)),
        "byteLength": path.stat().st_size,
        "shape": shape,
        "channelOrder": channel_order,
    }


def clamp_channel_values(values: np.ndarray, channel_index: int, channel_max: np.ndarray) -> np.ndarray:
    if channel_index >= 3:
        return np.minimum(np.maximum(values, 0), np.float32(channel_max[channel_index] * 1.05))
    return values


def write_scalar_head_application(
    args: argparse.Namespace,
    pair: dict[str, Any],
    pair_path: Path,
    low_fluid: np.ndarray,
    low_front: np.ndarray,
    high_fluid: np.ndarray,
    high_front: np.ndarray,
    comparison_fluid: np.ndarray | None,
    comparison_front: np.ndarray | None,
    channel_states: dict[int, dict[str, Any]],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    channel_reports: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not args.application_out_dir:
        return None
    if not channel_states:
        raise ProbeFailure("application-write", "--application-out-dir requires scalar MLP heads; rerun with --model mlp or --model both.")
    if args.scalar_head_assembly_base == "comparisonApplication" and (comparison_fluid is None or comparison_front is None):
        raise ProbeFailure("application-write", "comparisonApplication assembly base requires --comparison-application-manifest.")
    out_dir = Path(args.application_out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_out = out_dir / "manifest.json"
    low_grid = int(pair["lowGrid"])
    high_grid = int(pair["highGrid"])
    high_cells = high_grid ** 3
    target_indexes = sorted(channel_states.keys())
    channel_max = np.concatenate([
        np.max(high_fluid, axis=0),
        np.array([float(np.max(high_front))], dtype=np.float32),
    ]).astype(np.float32, copy=False)

    low_up_fluid_path = out_dir / "lowUpsampled-fluid.f32"
    low_up_front_path = out_dir / "lowUpsampled-front.f32"
    predicted_fluid_path = out_dir / "predictedHigh-fluid.f32"
    predicted_front_path = out_dir / "predictedHigh-front.f32"
    for path in [low_up_fluid_path, low_up_front_path, predicted_fluid_path, predicted_front_path]:
        path.write_bytes(b"")

    chunk_z = max(1, min(high_grid, int(args.assembly_chunk_z)))
    chunks = []
    replacement_stats = {ALL_CHANNELS[index]: {"sum": 0.0, "sumAbsResidual": 0.0, "count": 0} for index in target_indexes}
    for z0 in range(0, high_grid, chunk_z):
        z1 = min(high_grid, z0 + chunk_z)
        indexes = np.arange(z0 * high_grid * high_grid, z1 * high_grid * high_grid, dtype=np.int64)
        low_chunk, x, y, z = _APPLY.low_values_for_high_cells(low_fluid, low_front, indexes, low_grid, high_grid)
        features = _APPLY.build_features(low_chunk, x, y, z, high_grid)
        features_std = ((features - feature_mean.reshape(1, -1)) / feature_std.reshape(1, -1)).astype(np.float32)
        if args.scalar_head_assembly_base == "comparisonApplication":
            assert comparison_fluid is not None and comparison_front is not None
            predicted = np.concatenate([
                np.asarray(comparison_fluid[indexes], dtype=np.float32),
                np.asarray(comparison_front[indexes], dtype=np.float32).reshape(-1, 1),
            ], axis=1)
        else:
            predicted = np.array(low_chunk, dtype=np.float32, copy=True)
        for channel_index, state in channel_states.items():
            residual = predict_scalar_mlp(features_std, state)
            values = clamp_channel_values(low_chunk[:, channel_index] + residual, channel_index, channel_max)
            predicted[:, channel_index] = values
            stats = replacement_stats[ALL_CHANNELS[channel_index]]
            stats["sum"] += float(np.sum(values))
            stats["sumAbsResidual"] += float(np.sum(np.abs(values - low_chunk[:, channel_index])))
            stats["count"] += int(values.shape[0])
        with low_up_fluid_path.open("ab") as handle:
            low_chunk[:, :len(FLUID_CHANNELS)].astype("<f4", copy=False).tofile(handle)
        with low_up_front_path.open("ab") as handle:
            low_chunk[:, len(FLUID_CHANNELS)].astype("<f4", copy=False).tofile(handle)
        with predicted_fluid_path.open("ab") as handle:
            predicted[:, :len(FLUID_CHANNELS)].astype("<f4", copy=False).tofile(handle)
        with predicted_front_path.open("ab") as handle:
            predicted[:, len(FLUID_CHANNELS)].astype("<f4", copy=False).tofile(handle)
        chunks.append({"zStart": z0, "zEnd": z1, "cellCount": int(indexes.shape[0])})

    expected_fluid_bytes = high_cells * len(FLUID_CHANNELS) * 4
    expected_front_bytes = high_cells * 4
    for path, expected in [
        (low_up_fluid_path, expected_fluid_bytes),
        (predicted_fluid_path, expected_fluid_bytes),
        (low_up_front_path, expected_front_bytes),
        (predicted_front_path, expected_front_bytes),
    ]:
        if path.stat().st_size != expected:
            raise ProbeFailure("application-write", "assembled sidecar byte length mismatch", {
                "path": str(path),
                "actualBytes": path.stat().st_size,
                "expectedBytes": expected,
            })
    high_shape_fluid = [high_grid, high_grid, high_grid, len(FLUID_CHANNELS)]
    high_shape_front = [high_grid, high_grid, high_grid, 1]
    replacement_report = []
    for channel, stats in replacement_stats.items():
        count = max(1, int(stats["count"]))
        replacement_report.append({
            "channel": channel,
            "mean": float(stats["sum"] / count),
            "meanAbsResidualFromLow": float(stats["sumAbsResidual"] / count),
        })
    manifest = {
        "schema": APPLICATION_SCHEMA,
        "status": "captured",
        "failurePhase": None,
        "identity": ASSEMBLED_APPLICATION_IDENTITY,
        "applicationAuthority": "same-pair-scalar-head-assembled-field-diagnostic",
        "fieldAuthority": FIELD_AUTHORITY,
        "completeFieldCoverage": True,
        "fitOnSamePairVisualDiagnostic": True,
        "pairManifest": str(pair_path),
        "pairManifestSha256": sha256_file(pair_path),
        "routeIdentity": pair.get("routeIdentity"),
        "effectiveRoute": pair.get("effectiveRoute"),
        "prototypeIdentity": pair.get("prototypeIdentity"),
        "backend": pair.get("backend"),
        "deterministicReplay": pair.get("deterministicReplay"),
        "lowGrid": low_grid,
        "highGrid": high_grid,
        "gridScaleRatio": pair.get("gridScaleRatio"),
        "model": {
            "identity": ASSEMBLED_APPLICATION_IDENTITY,
            "sourceProbeIdentity": PROBE_IDENTITY,
            "scalarHeadAssemblyBase": args.scalar_head_assembly_base,
            "scalarHeadChannels": [ALL_CHANNELS[index] for index in target_indexes],
            "scalarHeadModelIdentity": MLP_IDENTITY,
            "postprocess": {
                "nonnegativeClampForChannelIndexAtLeast": 3,
                "channelMaxClampMultiplier": 1.05,
                "replacementStats": replacement_report,
            },
            "channelReports": [
                {
                    "channel": report["channel"],
                    "bestProbeModel": report["bestProbeModel"],
                    "mlpMetrics": report["models"].get("mlp", {}).get("metrics"),
                    "supportLocalized": report["models"].get("mlp", {}).get("supportLocalized"),
                }
                for report in channel_reports
                if report["channelIndex"] in target_indexes
            ],
            "limitation": "Naive independent scalar-head assembly from same-pair fitted channel heads; incoherent render output is route-local evidence, not a field-residual-program disproof.",
        },
        "roles": {
            "lowUpsampled": {
                "role": "lowUpsampled",
                "fluid": sidecar_descriptor(low_up_fluid_path, high_shape_fluid, FLUID_CHANNELS),
                "front": sidecar_descriptor(low_up_front_path, high_shape_front, FRONT_CHANNELS),
            },
            "predictedHigh": {
                "role": "predictedHigh",
                "fluid": sidecar_descriptor(predicted_fluid_path, high_shape_fluid, FLUID_CHANNELS),
                "front": sidecar_descriptor(predicted_front_path, high_shape_front, FRONT_CHANNELS),
            },
            "truthHigh": {
                "role": "truthHigh",
                "fluid": pair["high"]["fluid"],
                "front": pair["high"]["front"],
            },
        },
        "applicationChunks": {
            "chunkZ": chunk_z,
            "chunks": chunks,
        },
        "limitations": [
            "Same-pair fitted scalar-head assembly, not held-out learning proof.",
            "Low/high source pair is separate deterministic replay, not literal cross-grid state transfer.",
            "Independent scalar heads may violate cross-channel consistency; render output must be judged as route-local.",
        ],
    }
    write_json(manifest_out, manifest)
    return {
        "identity": ASSEMBLED_APPLICATION_IDENTITY,
        "manifest": str(manifest_out),
        "manifestSha256": sha256_file(manifest_out),
        "scalarHeadAssemblyBase": args.scalar_head_assembly_base,
        "targetChannels": [ALL_CHANNELS[index] for index in target_indexes],
        "roles": {
            "lowUpsampled": manifest["roles"]["lowUpsampled"],
            "predictedHigh": manifest["roles"]["predictedHigh"],
            "truthHigh": manifest["roles"]["truthHigh"],
        },
    }


def write_channel_previews(
    args: argparse.Namespace,
    high_grid: int,
    low_fluid: np.ndarray,
    low_front: np.ndarray,
    high_fluid: np.ndarray,
    high_front: np.ndarray,
    channel_states: dict[int, dict[str, Any]],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    low_grid: int,
) -> list[dict[str, Any]]:
    if not args.visual_preview_dir:
        return []
    if not channel_states:
        raise ProbeFailure("visual-preview-write", "--visual-preview-dir requires scalar MLP heads; rerun with --model mlp or --model both.")
    preview_dir = Path(args.visual_preview_dir).resolve()
    preview_dir.mkdir(parents=True, exist_ok=True)
    y = int(args.visual_preview_slice_y) if args.visual_preview_slice_y is not None else high_grid // 2
    y = max(0, min(high_grid - 1, y))
    x = np.tile(np.arange(high_grid, dtype=np.int64), high_grid)
    z = np.repeat(np.arange(high_grid, dtype=np.int64), high_grid)
    indexes = x + y * high_grid + z * high_grid * high_grid
    low_values, fx, fy, fz = _APPLY.low_values_for_high_cells(low_fluid, low_front, indexes, low_grid, high_grid)
    features = _APPLY.build_features(low_values, fx, fy, fz, high_grid)
    features_std = ((features - feature_mean.reshape(1, -1)) / feature_std.reshape(1, -1)).astype(np.float32)
    previews = []
    for channel_index, state in channel_states.items():
        channel = ALL_CHANNELS[channel_index]
        truth = channel_values(high_fluid, high_front, indexes, channel_index).reshape(high_grid, high_grid)
        low = low_values[:, channel_index].reshape(high_grid, high_grid)
        pred = (low_values[:, channel_index] + predict_scalar_mlp(features_std, state)).reshape(high_grid, high_grid)
        error = pred - truth
        field_scale = max(float(np.max(np.abs(truth))), float(np.max(np.abs(low))), float(np.max(np.abs(pred))), 1.0e-9)
        error_scale = max(float(np.max(np.abs(error))), 1.0e-9)
        row_gap = np.full((3, high_grid, 3), 48, dtype=np.uint8)
        sheet = np.concatenate([
            heat_rgb(normalize_abs(truth, field_scale)),
            row_gap,
            heat_rgb(normalize_abs(low, field_scale)),
            row_gap,
            heat_rgb(normalize_abs(pred, field_scale)),
            row_gap,
            signed_error_rgb(error, error_scale),
        ], axis=0)
        png_path = preview_dir / f"{channel}.channel-preview.png"
        sidecar_path = preview_dir / f"{channel}.channel-preview.json"
        write_png_rgb(png_path, sheet)
        sidecar = {
            "schema": REPORT_SCHEMA,
            "identity": VISUAL_PREVIEW_IDENTITY,
            "status": "written",
            "visualPreviewAuthority": VISUAL_PREVIEW_AUTHORITY,
            "channel": channel,
            "channelIndex": int(channel_index),
            "slice": {"axis": "y", "index": y},
            "rowOrder": ["truthHigh", "lowUpsampled", "scalarHeadPredicted", "signedErrorPredMinusTruth"],
            "normalization": {
                "sharedAbsFieldMax": field_scale,
                "signedErrorAbsMax": error_scale,
            },
            "limitation": "Offline per-channel slice preview; not raymarched renderer evidence and not a standalone physical-channel render.",
            "png": {
                "path": str(png_path),
                "sha256": sha256_file(png_path),
            },
        }
        write_json(sidecar_path, sidecar)
        previews.append({
            "channel": channel,
            "path": str(png_path),
            "sha256": sha256_file(png_path),
            "sidecar": str(sidecar_path),
            "authority": VISUAL_PREVIEW_AUTHORITY,
            "rowOrder": sidecar["rowOrder"],
        })
    index_path = preview_dir / "manifest.json"
    write_json(index_path, {
        "schema": REPORT_SCHEMA,
        "identity": VISUAL_PREVIEW_IDENTITY,
        "status": "written",
        "visualPreviewAuthority": VISUAL_PREVIEW_AUTHORITY,
        "slice": {"axis": "y", "index": y},
        "channels": previews,
        "limitation": "Offline channel decomposition previews only; compare structure, not physical renderer output.",
    })
    return previews


def main() -> int:
    args = parse_args()
    out_path = Path(args.out).resolve()
    phase = "args"
    evidence: dict[str, Any] = {}
    try:
        target_indexes = parse_target_channels(args.target_channel_list)
        phase = "manifest-read"
        pair_path = Path(args.pair_manifest).resolve()
        pair = read_json(pair_path)
        if pair.get("schema") != "kaminos.volume.full-grid-field-pair.v0":
            raise ProbeFailure("manifest-read", f"Pair schema mismatch: {pair.get('schema')}")
        low_grid = int(pair["lowGrid"])
        high_grid = int(pair["highGrid"])
        high_cells = high_grid ** 3
        low_cells = low_grid ** 3
        evidence = {
            "pairManifest": str(pair_path),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "targetChannels": [ALL_CHANNELS[i] for i in target_indexes],
        }
        phase = "sidecar-read"
        low_fluid_path = _APPLY.verify_sidecar(pair["low"]["fluid"])
        low_front_path = _APPLY.verify_sidecar(pair["low"]["front"])
        high_fluid_path = _APPLY.verify_sidecar(pair["high"]["fluid"])
        high_front_path = _APPLY.verify_sidecar(pair["high"]["front"])
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, len(FLUID_CHANNELS)))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_cells, len(FLUID_CHANNELS)))
        high_front = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_cells,))
        comparison_fluid = None
        comparison_front = None
        comparison_report = None
        if args.comparison_application_manifest:
            comparison_fluid, comparison_front, comparison_report = verify_application_sidecars(Path(args.comparison_application_manifest).resolve(), high_grid)

        phase = "sample"
        rng = np.random.default_rng(int(args.seed))
        support_score = _APPLY.flame_carrier_score(high_fluid)
        support_threshold = max(0.00005, float(np.quantile(support_score, 0.985)) * 0.25)
        support = np.flatnonzero(support_score > support_threshold)
        train_indexes = mixed_sample_indexes(high_cells, int(args.train_samples), support, float(args.support_sample_fraction), rng)
        test_indexes = mixed_sample_indexes(high_cells, int(args.test_samples), support, float(args.support_sample_fraction), rng, train_indexes)
        low_train, x_train, y_train, z_train = _APPLY.low_values_for_high_cells(low_fluid, low_front, train_indexes, low_grid, high_grid)
        low_test, x_test, y_test, z_test = _APPLY.low_values_for_high_cells(low_fluid, low_front, test_indexes, low_grid, high_grid)
        train_features = _APPLY.build_features(low_train, x_train, y_train, z_train, high_grid)
        test_features = _APPLY.build_features(low_test, x_test, y_test, z_test, high_grid)
        train_features_std, test_features_std, feature_standardization = standardize_features(train_features, test_features)

        phase = "channel-train"
        channel_reports = []
        scalar_head_states: dict[int, dict[str, Any]] = {}
        for channel_index in target_indexes:
            channel_name = ALL_CHANNELS[channel_index]
            train_truth = channel_values(high_fluid, high_front, train_indexes, channel_index)
            test_truth = channel_values(high_fluid, high_front, test_indexes, channel_index)
            train_low = low_train[:, channel_index]
            test_low = low_test[:, channel_index]
            train_residual = train_truth - train_low
            low_metrics = scalar_metrics(test_low, test_truth)
            mean_residual = np.float32(np.mean(train_residual))
            mean_prediction = test_low + mean_residual
            mean_metrics = scalar_metrics(mean_prediction, test_truth)
            models: dict[str, Any] = {}
            if args.model in ("ridge", "both"):
                ridge_residual, ridge_report = fit_ridge_scalar(train_features, train_residual, test_features, float(args.ridge))
                ridge_prediction = test_low + ridge_residual
                ridge_metrics = scalar_metrics(ridge_prediction, test_truth)
                models["ridge"] = {
                    **ridge_report,
                    "metrics": ridge_metrics,
                    "improvementVsLowUpsampled": improvement_vs(low_metrics, ridge_metrics),
                    "supportLocalized": support_localized_metrics(test_low, test_truth, ridge_prediction),
                    "gradientEnergyRecovery": gradient_energy_from_values(test_low, test_truth, ridge_prediction),
                }
            if args.model in ("mlp", "both"):
                model_rng = np.random.default_rng(int(args.seed) + channel_index * 104729 + 17)
                mlp_residual, mlp_report, mlp_state = train_scalar_mlp(train_features_std, train_residual, test_features_std, args, model_rng)
                scalar_head_states[channel_index] = mlp_state
                mlp_prediction = test_low + mlp_residual
                mlp_metrics = scalar_metrics(mlp_prediction, test_truth)
                models["mlp"] = {
                    **mlp_report,
                    "metrics": mlp_metrics,
                    "improvementVsLowUpsampled": improvement_vs(low_metrics, mlp_metrics),
                    "supportLocalized": support_localized_metrics(test_low, test_truth, mlp_prediction),
                    "gradientEnergyRecovery": gradient_energy_from_values(test_low, test_truth, mlp_prediction),
                }
            comparison_metrics = None
            if comparison_fluid is not None and comparison_front is not None:
                comparison_values = channel_values(comparison_fluid, comparison_front, test_indexes, channel_index)
                comparison_metrics = {
                    "identity": "comparisonApplicationManifest-predictedHigh-channel-metrics-v0",
                    "metrics": scalar_metrics(comparison_values, test_truth),
                    "improvementVsLowUpsampled": improvement_vs(low_metrics, scalar_metrics(comparison_values, test_truth)),
                    "supportLocalized": support_localized_metrics(test_low, test_truth, comparison_values),
                    "gradientEnergyRecovery": gradient_energy_from_values(test_low, test_truth, comparison_values),
                }
            best_model = None
            best_rmse = float("inf")
            for model_name, model_report in models.items():
                rmse = float(model_report["metrics"]["rmse"])
                if rmse < best_rmse:
                    best_rmse = rmse
                    best_model = model_name
            channel_reports.append({
                "channel": channel_name,
                "channelIndex": int(channel_index),
                "targetKind": "fluid" if channel_index < len(FLUID_CHANNELS) else "front",
                "trainResidual": {
                    "mean": float(np.mean(train_residual)),
                    "std": float(np.std(train_residual)),
                    "rms": float(math.sqrt(float(np.mean(train_residual.astype(np.float64) ** 2)))),
                    "nonzeroFraction": float(np.count_nonzero(np.abs(train_residual) > 1.0e-6) / max(1, train_residual.shape[0])),
                },
                "lowUpsampled": low_metrics,
                "meanResidualBaseline": mean_metrics,
                "models": models,
                "comparisonApplicationManifest": comparison_metrics,
                "bestProbeModel": best_model,
            })

        phase = "rank"
        def rank_value(report: dict[str, Any]) -> float:
            candidates = []
            for model_report in report["models"].values():
                candidates.append(float(model_report["improvementVsLowUpsampled"]["rmseReductionFraction"]))
            return max(candidates) if candidates else -999.0

        ranking = sorted(
            [
                {
                    "channel": report["channel"],
                    "bestProbeModel": report["bestProbeModel"],
                    "bestRmseReductionVsLow": rank_value(report),
                    "lowRmse": report["lowUpsampled"]["rmse"],
                    "bestRmse": min((model["metrics"]["rmse"] for model in report["models"].values()), default=None),
                }
                for report in channel_reports
            ],
            key=lambda item: item["bestRmseReductionVsLow"],
            reverse=True,
        )
        feature_mean = np.mean(train_features, axis=0, dtype=np.float64).astype(np.float32)
        feature_std = np.std(train_features, axis=0, dtype=np.float64).astype(np.float32)
        feature_std = np.where(feature_std < np.float32(1.0e-6), np.float32(1.0), feature_std)
        phase = "application-write"
        assembled_application = write_scalar_head_application(
            args,
            pair,
            pair_path,
            low_fluid,
            low_front,
            high_fluid,
            high_front,
            comparison_fluid,
            comparison_front,
            scalar_head_states,
            feature_mean,
            feature_std,
            channel_reports,
        )
        phase = "visual-preview-write"
        visual_previews = write_channel_previews(
            args,
            high_grid,
            low_fluid,
            low_front,
            high_fluid,
            high_front,
            scalar_head_states,
            feature_mean,
            feature_std,
            low_grid,
        )
        phase = "report-write"
        payload = {
            "schema": REPORT_SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": PROBE_IDENTITY,
            "authority": "offline-same-pair-full-input-single-output-channel-learnability-diagnostic",
            "fieldAuthority": FIELD_AUTHORITY,
            "pairManifest": str(pair_path),
            "pairManifestSha256": sha256_file(pair_path),
            "routeIdentity": pair.get("routeIdentity"),
            "effectiveRoute": pair.get("effectiveRoute"),
            "prototypeIdentity": pair.get("prototypeIdentity"),
            "backend": pair.get("backend"),
            "deterministicReplay": pair.get("deterministicReplay"),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "gridScaleRatio": pair.get("gridScaleRatio"),
            "completeFieldCoverage": True,
            "fitOnSamePairVisualDiagnostic": True,
            "fullInputChannels": ALL_CHANNELS,
            "targetChannelIndexes": target_indexes,
            "targetChannels": [ALL_CHANNELS[i] for i in target_indexes],
            "modelRequest": {
                "model": args.model,
                "ridgeIdentity": RIDGE_IDENTITY,
                "mlpIdentity": MLP_IDENTITY,
                "linearRidgeInterferenceNote": "Ridge output columns are already independent for a fixed design matrix; scalar ridge is included as a baseline, while scalar MLP heads are the nonlinear output-capacity discriminator.",
                "hiddenWidth": int(args.hidden_width),
                "epochs": int(args.epochs),
                "learningRate": float(args.learning_rate),
            },
            "sampling": {
                "identity": "full-grid-mixed-random-plus-flame-support-sampling-v0",
                "seed": int(args.seed),
                "trainSampleCount": int(train_indexes.shape[0]),
                "testSampleCount": int(test_indexes.shape[0]),
                "truthFlameSupportThreshold": support_threshold,
                "truthFlameSupportCount": int(support.shape[0]),
                "truthFlameSupportFraction": float(support.shape[0] / max(1, high_cells)),
                "supportSampleFraction": float(args.support_sample_fraction),
            },
            "featureModel": {
                "identity": "full-low-field-plus-spatial-rbf-features-v0",
                "source": "volume-full-grid-field-residual-apply.py build_features",
                "featureCount": int(train_features.shape[1]),
                "featureStandardization": feature_standardization,
            },
            "comparisonApplicationManifest": comparison_report,
            "scalarHeadApplication": assembled_application,
            "visualPreviews": visual_previews,
            "channelLearnability": {
                "identity": "channelLearnability-ranking-v0",
                "rankedBy": "best per-channel probe RMSE reduction vs lowUpsampled",
                "ranking": ranking,
            },
            "channels": channel_reports,
            "limitations": [
                "Same-pair fitted offline diagnostic, not held-out generalization proof.",
                "Inputs remain the complete low field state; this probe narrows only the output objective.",
                "Ridge scalar heads are baseline sanity only because fixed-design ridge has no nonlinear shared-output capacity bottleneck.",
                "Gradient energy recovery here is sampled-field diagnostic evidence; flow-debug rendered strips remain visual authority.",
            ],
        }
        write_json(out_path, payload)
        print(json.dumps({
            "ok": True,
            "report": str(out_path),
            "channels": [report["channel"] for report in channel_reports],
            "topRanked": ranking[:5],
        }, indent=2))
        return 0
    except Exception as error:
        write_failure(out_path, phase, error, evidence)
        print(f"full-grid per-channel probe failed at {phase}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
