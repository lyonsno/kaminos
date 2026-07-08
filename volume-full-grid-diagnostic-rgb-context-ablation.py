#!/usr/bin/env python3
"""Ablate broader input context for derived diagnostic RGB residual heads."""

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


SCHEMA = "kaminos.volume.diagnostic-rgb-context-ablation.v0"
EVIDENCE_IDENTITY = "derived-flow-diagnostic-rgb-context-conditioning-ablation-v0"
DIAGNOSTIC_RGB_TARGET_IDENTITY = "derived-flow-debug-diagnostic-rgb-v0"
DIAGNOSTIC_RGB_TARGET_AUTHORITY = "shader-flow-debug-diagnostic-color-component-not-full-raymarch"
SAME_CELL_IDENTITY = "sameCellCurrentFeatureSet"
LOCAL_GEOMETRY_IDENTITY = "localGeometrySixNeighbor"
GLOBAL_SUMMARY_IDENTITY = "globalBasinSummary"
SAME_CELL_FEATURE_IDENTITY = "sameCellCurrentFeatureSet-full-low-channels-position-basis-v0"
LOCAL_GEOMETRY_FEATURE_IDENTITY = "localGeometrySixNeighbor-low-grid-delta-context-v0"
GLOBAL_SUMMARY_FEATURE_IDENTITY = "globalBasinSummary-low-grid-channel-statistics-v0"
TARGET_CHANNELS = ["red", "green", "blue"]
DISPLAY_LABELS = {
    "truthHigh": "truthHigh",
    "lowUpsampled": "lowUpsampled",
    SAME_CELL_IDENTITY: "sameCell",
    LOCAL_GEOMETRY_IDENTITY: "localGeom",
    GLOBAL_SUMMARY_IDENTITY: "globalSum",
}

_APPLY_PATH = Path(__file__).with_name("volume-full-grid-field-residual-apply.py")
_APPLY_SPEC = importlib.util.spec_from_file_location("volume_full_grid_field_residual_apply", _APPLY_PATH)
if _APPLY_SPEC is None or _APPLY_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_APPLY_PATH}")
_APPLY = importlib.util.module_from_spec(_APPLY_SPEC)
_APPLY_SPEC.loader.exec_module(_APPLY)

_CHANNEL_PATH = Path(__file__).with_name("volume-full-grid-field-per-channel-probe.py")
_CHANNEL_SPEC = importlib.util.spec_from_file_location("volume_full_grid_field_per_channel_probe", _CHANNEL_PATH)
if _CHANNEL_SPEC is None or _CHANNEL_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_CHANNEL_PATH}")
_CHANNEL = importlib.util.module_from_spec(_CHANNEL_SPEC)
_CHANNEL_SPEC.loader.exec_module(_CHANNEL)

FLUID_CHANNELS = list(_APPLY.FLUID_CHANNELS)
FRONT_CHANNELS = list(_APPLY.FRONT_CHANNELS)
ALL_CHANNELS = [*FLUID_CHANNELS, *FRONT_CHANNELS]


class ContextAblationFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True, help="Full-grid low/high field-pair manifest.")
    parser.add_argument("--out-dir", required=True, help="Output directory for manifest and preview images.")
    parser.add_argument("--train-samples", type=int, default=60_000, help="Training cell count for each feature regime.")
    parser.add_argument("--test-samples", type=int, default=35_000, help="Held-out same-pair diagnostic cell count.")
    parser.add_argument("--support-sample-fraction", type=float, default=0.55, help="Fraction of train/test samples drawn from truth diagnostic support.")
    parser.add_argument("--support-scan-samples", type=int, default=120_000, help="Random cells scanned to derive truth support sampling pressure.")
    parser.add_argument("--hidden-width", type=int, default=48, help="Hidden width for each RGB component MLP.")
    parser.add_argument("--epochs", type=int, default=55, help="Epoch count for each RGB component MLP.")
    parser.add_argument("--learning-rate", type=float, default=2.0e-3, help="Adam learning rate.")
    parser.add_argument("--batch-size", type=int, default=1024, help="MLP minibatch size.")
    parser.add_argument("--weight-decay", type=float, default=1.0e-5, help="MLP L2 weight decay.")
    parser.add_argument("--preview-slice-y", type=int, help="High-grid y slice for the preview sheet; defaults to highGrid//2.")
    parser.add_argument("--seed", type=int, default=9719, help="Deterministic sample/model seed.")
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
        "schema": SCHEMA,
        "status": "failed",
        "identity": EVIDENCE_IDENTITY,
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    }
    if isinstance(error, ContextAblationFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.evidence
    write_json(path, payload)


def verify_sidecar_descriptor(descriptor: dict[str, Any]) -> Path:
    path = Path(str(descriptor.get("path") or ""))
    if not path.exists():
        raise ContextAblationFailure("sidecar-read", f"Missing sidecar {path}", {"descriptor": descriptor})
    expected_bytes = int(descriptor.get("byteLength") or 0)
    actual_bytes = path.stat().st_size
    if expected_bytes and expected_bytes != actual_bytes:
        raise ContextAblationFailure("sidecar-read", f"Sidecar byte length mismatch for {path}", {
            "expectedBytes": expected_bytes,
            "actualBytes": actual_bytes,
        })
    expected_sha = descriptor.get("sha256")
    actual_sha = sha256_file(path)
    if expected_sha and expected_sha != actual_sha:
        raise ContextAblationFailure("sidecar-read", f"Sidecar checksum mismatch for {path}", {
            "expectedSha256": expected_sha,
            "actualSha256": actual_sha,
        })
    return path


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x.astype(np.float32) - np.float32(edge0)) / np.float32(edge1 - edge0), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def gather_velocity(fluid: np.ndarray, x: np.ndarray, y: np.ndarray, z: np.ndarray, grid: int) -> np.ndarray:
    cx = np.clip(x, 0, grid - 1).astype(np.int64, copy=False)
    cy = np.clip(y, 0, grid - 1).astype(np.int64, copy=False)
    cz = np.clip(z, 0, grid - 1).astype(np.int64, copy=False)
    indexes = cx + cy * grid + cz * grid * grid
    return np.asarray(fluid[indexes, 0:3], dtype=np.float32)


def derived_flow_debug_rgb(fluid: np.ndarray, indexes: np.ndarray, grid: int) -> tuple[np.ndarray, dict[str, float]]:
    x = (indexes % grid).astype(np.int64, copy=False)
    y = ((indexes // grid) % grid).astype(np.int64, copy=False)
    z = (indexes // (grid * grid)).astype(np.int64, copy=False)
    vx0 = gather_velocity(fluid, x - 1, y, z, grid)
    vx1 = gather_velocity(fluid, x + 1, y, z, grid)
    vy0 = gather_velocity(fluid, x, y - 1, z, grid)
    vy1 = gather_velocity(fluid, x, y + 1, z, grid)
    vz0 = gather_velocity(fluid, x, y, z - 1, grid)
    vz1 = gather_velocity(fluid, x, y, z + 1, grid)
    curl_x = ((vy1[:, 2] - vy0[:, 2]) - (vz1[:, 1] - vz0[:, 1])) * np.float32(0.5)
    curl_y = ((vz1[:, 0] - vz0[:, 0]) - (vx1[:, 2] - vx0[:, 2])) * np.float32(0.5)
    curl_z = ((vx1[:, 1] - vx0[:, 1]) - (vy1[:, 0] - vy0[:, 0])) * np.float32(0.5)
    curl_mag = np.sqrt(curl_x * curl_x + curl_y * curl_y + curl_z * curl_z).astype(np.float32)
    div_abs = np.abs(((vx1[:, 0] - vx0[:, 0]) + (vy1[:, 1] - vy0[:, 1]) + (vz1[:, 2] - vz0[:, 2])) * np.float32(0.5)).astype(np.float32)
    overlay_alpha = smoothstep(0.015, 0.12, curl_mag + div_abs)
    diagnostic_mix = smoothstep(0.010, 0.085, div_abs).reshape(-1, 1)
    cyan = np.array([0.08, 0.72, 0.95], dtype=np.float32).reshape(1, 3)
    red = np.array([1.0, 0.18, 0.08], dtype=np.float32).reshape(1, 3)
    diagnostic_color = (cyan * (1.0 - diagnostic_mix) + red * diagnostic_mix).astype(np.float32)
    diagnostic_color *= (np.float32(0.35) + smoothstep(0.012, 0.18, curl_mag)).reshape(-1, 1)
    rgb = (diagnostic_color * overlay_alpha.reshape(-1, 1)).astype(np.float32)
    return rgb, {
        "curlMagnitudeMean": float(np.mean(curl_mag)),
        "curlMagnitudeP95": float(np.quantile(curl_mag.astype(np.float64), 0.95)),
        "divergenceAbsMean": float(np.mean(div_abs)),
        "divergenceAbsP95": float(np.quantile(div_abs.astype(np.float64), 0.95)),
        "overlayAlphaMean": float(np.mean(overlay_alpha)),
        "overlayAlphaP95": float(np.quantile(overlay_alpha.astype(np.float64), 0.95)),
    }


def low_cell_indexes_for_high(high_indexes: np.ndarray, low_grid: int, high_grid: int) -> np.ndarray:
    x = high_indexes % high_grid
    y = (high_indexes // high_grid) % high_grid
    z = high_indexes // (high_grid * high_grid)
    ratio = high_grid / low_grid
    lx = np.minimum(low_grid - 1, np.floor(x / ratio).astype(np.int64))
    ly = np.minimum(low_grid - 1, np.floor(y / ratio).astype(np.int64))
    lz = np.minimum(low_grid - 1, np.floor(z / ratio).astype(np.int64))
    return lx + ly * low_grid + lz * low_grid * low_grid


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
    chosen: list[int] = []
    if support_target > 0:
        chosen.extend(rng.choice(support, size=support_target, replace=False).astype(np.int64).tolist())
    needed = sample_count - len(chosen)
    chosen_set = set(chosen) | exclude_set
    while needed > 0:
        randoms = rng.integers(0, high_cells, size=max(needed * 2, needed + 64), dtype=np.int64)
        for value in randoms.tolist():
            if value in chosen_set:
                continue
            chosen.append(int(value))
            chosen_set.add(int(value))
            needed -= 1
            if needed == 0:
                break
    return np.array(chosen, dtype=np.int64)


def global_basin_summary_features(low_fluid: np.ndarray, low_front: np.ndarray, low_grid: int, coarse_grid: int = 8) -> tuple[dict[str, Any], dict[str, Any]]:
    full = np.concatenate([np.asarray(low_fluid, dtype=np.float32), np.asarray(low_front, dtype=np.float32).reshape(-1, 1)], axis=1)
    mean = np.mean(full, axis=0, dtype=np.float64).astype(np.float32)
    std = np.std(full, axis=0, dtype=np.float64).astype(np.float32)
    max_value = np.max(full, axis=0).astype(np.float32)
    support_fraction = np.mean(full > np.maximum(mean.reshape(1, -1) + std.reshape(1, -1), np.float32(1.0e-5)), axis=0, dtype=np.float64).astype(np.float32)
    summary = np.concatenate([mean, std, max_value, support_fraction]).astype(np.float32, copy=False)

    low_indexes = np.arange(low_grid ** 3, dtype=np.int64)
    lx = low_indexes % low_grid
    ly = (low_indexes // low_grid) % low_grid
    lz = low_indexes // (low_grid * low_grid)
    bin_x = np.minimum(coarse_grid - 1, np.floor(lx * coarse_grid / low_grid).astype(np.int64))
    bin_y = np.minimum(coarse_grid - 1, np.floor(ly * coarse_grid / low_grid).astype(np.int64))
    bin_z = np.minimum(coarse_grid - 1, np.floor(lz * coarse_grid / low_grid).astype(np.int64))
    bin_indexes = bin_x + bin_y * coarse_grid + bin_z * coarse_grid * coarse_grid
    bin_count = coarse_grid ** 3
    flame_support = _APPLY.flame_carrier_score(low_fluid)
    low_rgb, _ = derived_flow_debug_rgb(low_fluid, low_indexes, low_grid)
    diagnostic_norm = np.linalg.norm(low_rgb.astype(np.float32), axis=1)
    carriers = np.stack([
        flame_support,
        diagnostic_norm,
        np.asarray(low_fluid[:, 5], dtype=np.float32),
        np.asarray(low_fluid[:, 4], dtype=np.float32),
    ], axis=1)
    coarse_sum = np.zeros((bin_count, carriers.shape[1]), dtype=np.float64)
    coarse_max = np.zeros((bin_count, carriers.shape[1]), dtype=np.float32)
    coarse_counts = np.zeros(bin_count, dtype=np.float64)
    np.add.at(coarse_sum, bin_indexes, carriers)
    np.add.at(coarse_counts, bin_indexes, 1.0)
    for channel in range(carriers.shape[1]):
        np.maximum.at(coarse_max[:, channel], bin_indexes, carriers[:, channel])
    coarse_mean = (coarse_sum / np.maximum(coarse_counts.reshape(-1, 1), 1.0)).astype(np.float32)
    coarse_map = np.concatenate([coarse_mean, coarse_max], axis=1).astype(np.float32, copy=False)
    return {"summary": summary, "coarseMap": coarse_map, "coarseGrid": coarse_grid}, {
        "identity": GLOBAL_SUMMARY_FEATURE_IDENTITY,
        "globalBasinSummary": {
            "featureOrder": [
                "constantMeanByChannel",
                "constantStdByChannel",
                "constantMaxByChannel",
                "constantSupportFractionAboveMeanPlusStdByChannel",
                "coarseBasinMeanAndMaxAtCellPosition",
            ],
            "channelOrder": ALL_CHANNELS,
            "coarseGrid": int(coarse_grid),
            "coarseFeatureOrder": [
                "meanFlameSupport",
                "meanDerivedDiagnosticNorm",
                "meanHeat",
                "meanSmokeDensity",
                "maxFlameSupport",
                "maxDerivedDiagnosticNorm",
                "maxHeat",
                "maxSmokeDensity",
            ],
            "constantFeatureCount": int(summary.shape[0]),
            "coarseFeatureCount": int(coarse_map.shape[1]),
            "featureCount": int(summary.shape[0] + coarse_map.shape[1]),
            "constantSummaryNote": "Constant pair summaries are recorded for identity but only the coarse per-cell basin map can vary inside a same-pair ablation after feature standardization.",
        },
    }


def global_basin_features_for_high(indexes: np.ndarray, low_grid: int, high_grid: int, global_context: dict[str, Any]) -> np.ndarray:
    coarse_grid = int(global_context["coarseGrid"])
    low_indexes = low_cell_indexes_for_high(indexes, low_grid, high_grid)
    lx = low_indexes % low_grid
    ly = (low_indexes // low_grid) % low_grid
    lz = low_indexes // (low_grid * low_grid)
    bin_x = np.minimum(coarse_grid - 1, np.floor(lx * coarse_grid / low_grid).astype(np.int64))
    bin_y = np.minimum(coarse_grid - 1, np.floor(ly * coarse_grid / low_grid).astype(np.int64))
    bin_z = np.minimum(coarse_grid - 1, np.floor(lz * coarse_grid / low_grid).astype(np.int64))
    bin_indexes = bin_x + bin_y * coarse_grid + bin_z * coarse_grid * coarse_grid
    coarse = np.asarray(global_context["coarseMap"][bin_indexes], dtype=np.float32)
    constant = np.repeat(np.asarray(global_context["summary"], dtype=np.float32).reshape(1, -1), indexes.shape[0], axis=0)
    return np.concatenate([constant, coarse], axis=1).astype(np.float32, copy=False)


def build_regime_features(
    regime: str,
    base_features: np.ndarray,
    low_fluid: np.ndarray,
    low_front: np.ndarray,
    indexes: np.ndarray,
    low_grid: int,
    high_grid: int,
    global_context: dict[str, Any],
) -> np.ndarray:
    parts = [base_features.astype(np.float32, copy=False)]
    if regime in (LOCAL_GEOMETRY_IDENTITY, GLOBAL_SUMMARY_IDENTITY):
        parts.append(_CHANNEL.low_neighbor_context_features(low_fluid, low_front, indexes, low_grid, high_grid))
    if regime == GLOBAL_SUMMARY_IDENTITY:
        parts.append(global_basin_features_for_high(indexes, low_grid, high_grid, global_context))
    return np.concatenate(parts, axis=1).astype(np.float32, copy=False)


def vector_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    err = prediction.astype(np.float64) - truth.astype(np.float64)
    abs_err = np.abs(err)
    return {
        "mse": float(np.mean(err * err)),
        "rmse": float(math.sqrt(float(np.mean(err * err)))),
        "mae": float(np.mean(abs_err)),
        "maxAbs": float(np.max(abs_err)) if abs_err.size else 0.0,
    }


def support_diagnostics(low: np.ndarray, truth: np.ndarray, prediction: np.ndarray) -> dict[str, Any]:
    truth_norm = np.linalg.norm(truth.astype(np.float64), axis=1)
    pred_norm = np.linalg.norm(prediction.astype(np.float64), axis=1)
    low_norm = np.linalg.norm(low.astype(np.float64), axis=1)
    residual_norm = np.linalg.norm((truth - low).astype(np.float64), axis=1)
    truth_threshold = max(1.0e-5, float(np.quantile(truth_norm, 0.90)) * 0.35, float(np.quantile(residual_norm, 0.95)) * 0.25)
    pred_threshold = max(1.0e-5, float(np.quantile(pred_norm, 0.90)) * 0.35)
    truth_mask = (truth_norm > truth_threshold) | (residual_norm > truth_threshold)
    pred_mask = pred_norm > pred_threshold
    intersection = int(np.count_nonzero(truth_mask & pred_mask))
    pred_count = int(np.count_nonzero(pred_mask))
    truth_count = int(np.count_nonzero(truth_mask))
    union = int(np.count_nonzero(truth_mask | pred_mask))
    outside = ~truth_mask
    in_support_metrics = vector_metrics(prediction[truth_mask], truth[truth_mask]) if truth_count else None
    return {
        "identity": "diagnostic-rgb-support-metrics-v0",
        "truthSupportThreshold": truth_threshold,
        "predictedSupportThreshold": pred_threshold,
        "truthSupportCount": truth_count,
        "predictedSupportCount": pred_count,
        "supportPrecision": float(intersection / max(1, pred_count)),
        "supportRecall": float(intersection / max(1, truth_count)),
        "supportJaccard": float(intersection / max(1, union)),
        "outsideWeakSupportMass": float(np.sum(pred_norm[outside])),
        "outsideWeakSupportMassVsLow": float(np.sum(pred_norm[outside]) / max(float(np.sum(low_norm[outside])), 1.0e-12)),
        "inSupportRmse": None if in_support_metrics is None else in_support_metrics["rmse"],
        "inSupportMae": None if in_support_metrics is None else in_support_metrics["mae"],
        "inSupportMetrics": in_support_metrics,
    }


def train_regime(
    regime: str,
    args: argparse.Namespace,
    train_features: np.ndarray,
    test_features: np.ndarray,
    train_low_rgb: np.ndarray,
    test_low_rgb: np.ndarray,
    train_truth_rgb: np.ndarray,
    test_truth_rgb: np.ndarray,
) -> tuple[np.ndarray, dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    feature_mean = np.mean(train_features, axis=0, dtype=np.float64).astype(np.float32)
    feature_std = np.std(train_features, axis=0, dtype=np.float64).astype(np.float32)
    feature_std = np.where(feature_std < np.float32(1.0e-6), np.float32(1.0), feature_std)
    train_std = ((train_features - feature_mean.reshape(1, -1)) / feature_std.reshape(1, -1)).astype(np.float32)
    test_std = ((test_features - feature_mean.reshape(1, -1)) / feature_std.reshape(1, -1)).astype(np.float32)
    standardization = {
        "identity": "train-feature-standardization-v0",
        "featureCount": int(train_features.shape[1]),
        "zeroStdFeatureCount": int(np.count_nonzero(feature_std == 1.0)),
        "mean": feature_mean,
        "std": feature_std,
    }
    train_residual = train_truth_rgb - train_low_rgb
    predictions = []
    states: dict[str, Any] = {}
    component_reports = []
    train_args = argparse.Namespace(
        hidden_width=int(args.hidden_width),
        epochs=int(args.epochs),
        learning_rate=float(args.learning_rate),
        batch_size=int(args.batch_size),
        weight_decay=float(args.weight_decay),
    )
    for component_index, component_name in enumerate(TARGET_CHANNELS):
        rng = np.random.default_rng(int(args.seed) + 101 * (component_index + 1) + 7919 * (1 + [SAME_CELL_IDENTITY, LOCAL_GEOMETRY_IDENTITY, GLOBAL_SUMMARY_IDENTITY].index(regime)))
        residual, report, state = _CHANNEL.train_scalar_mlp(
            train_std,
            train_residual[:, component_index],
            test_std,
            train_args,
            rng,
            training_objective={
                "identity": "diagnostic-rgb-context-ablation-standard-mse-v0",
                "diagnosticRgbTargetIdentity": DIAGNOSTIC_RGB_TARGET_IDENTITY,
                "featureRegime": regime,
                "component": component_name,
            },
        )
        prediction = test_low_rgb[:, component_index] + residual
        predictions.append(prediction.astype(np.float32, copy=False))
        states[component_name] = state
        low_metrics = _CHANNEL.scalar_metrics(test_low_rgb[:, component_index], test_truth_rgb[:, component_index])
        pred_metrics = _CHANNEL.scalar_metrics(prediction, test_truth_rgb[:, component_index])
        component_reports.append({
            "component": component_name,
            "metrics": pred_metrics,
            "lowUpsampledMetrics": low_metrics,
            "improvementVsLowUpsampled": _CHANNEL.improvement_vs(low_metrics, pred_metrics),
            "trainReport": report,
        })
    prediction_rgb = np.clip(np.stack(predictions, axis=1), 0.0, 1.0).astype(np.float32)
    report_standardization = {
        "identity": standardization["identity"],
        "featureCount": standardization["featureCount"],
        "zeroStdFeatureCount": standardization["zeroStdFeatureCount"],
    }
    return prediction_rgb, states, standardization | {"report": report_standardization}, component_reports


def predict_regime(features: np.ndarray, low_rgb: np.ndarray, states: dict[str, Any], standardization: dict[str, Any]) -> np.ndarray:
    feature_mean = standardization["mean"].reshape(1, -1)
    feature_std = standardization["std"].reshape(1, -1)
    features_std = ((features - feature_mean) / feature_std).astype(np.float32)
    residuals = [_CHANNEL.predict_scalar_mlp(features_std, states[name]) for name in TARGET_CHANNELS]
    return np.clip(low_rgb + np.stack(residuals, axis=1).astype(np.float32), 0.0, 1.0)


def write_png_rgb(path: Path, rgb: np.ndarray) -> None:
    if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError(f"Expected uint8 RGB, got {rgb.dtype} {rgb.shape}")
    height, width, _ = rgb.shape
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


FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
    ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}


def draw_label(image: np.ndarray, text: str, x: int, y: int, scale: int = 2) -> dict[str, Any]:
    label = text.upper()
    cursor = int(x)
    for char in label:
        glyph = FONT.get(char, FONT[" "])
        for gy, row in enumerate(glyph):
            for gx, value in enumerate(row):
                if value != "1":
                    continue
                x0 = cursor + gx * scale
                y0 = y + gy * scale
                x1 = min(image.shape[1], x0 + scale)
                y1 = min(image.shape[0], y0 + scale)
                if x0 < image.shape[1] and y0 < image.shape[0]:
                    image[y0:y1, x0:x1, :] = 255
        cursor += 6 * scale
    return {"text": text, "x": int(x), "y": int(y), "scale": int(scale)}


def rgb_slice_image(values: np.ndarray, grid: int, gain: float = 1.0) -> np.ndarray:
    rgb = np.clip(values.reshape(grid, grid, 3) * np.float32(gain), 0.0, 1.0)
    return np.asarray(np.round(rgb[::-1, :, :] * 255.0), dtype=np.uint8)


def write_contact_sheet(
    out_dir: Path,
    high_grid: int,
    slice_y: int,
    rows: list[tuple[str, np.ndarray]],
) -> dict[str, Any]:
    row_height = high_grid
    label_height = 28
    gap = 6
    width = high_grid
    height = label_height + len(rows) * row_height + max(0, len(rows) - 1) * gap
    sheet = np.zeros((height, width, 3), dtype=np.uint8)
    labels = [draw_label(sheet, f"y={slice_y}", 8, 8, scale=2)]
    offset_y = label_height
    for label, values in rows:
        image = rgb_slice_image(values, high_grid)
        sheet[offset_y:offset_y + row_height, :, :] = image
        labels.append(draw_label(sheet, label, 8, offset_y + 8, scale=2))
        offset_y += row_height + gap
    path = out_dir / "diagnostic-rgb-context-ablation-slice.png"
    write_png_rgb(path, sheet)
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "sliceY": int(slice_y),
        "visibleRasterLabels": {
            "identity": "burned-contact-sheet-labels-v0",
            "labels": labels,
        },
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    evidence: dict[str, Any] = {"args": vars(args)}
    try:
        pair_path = Path(args.pair_manifest).resolve()
        pair = read_json(pair_path)
        low_grid = int(pair["lowGrid"])
        high_grid = int(pair["highGrid"])
        low_cells = low_grid ** 3
        high_cells = high_grid ** 3
        if set(pair["low"]["fluid"].get("channelOrder", [])) != set(FLUID_CHANNELS):
            raise ContextAblationFailure("manifest-read", "Low fluid channel set does not match expected full channel list.", {
                "expected": FLUID_CHANNELS,
                "actual": pair["low"]["fluid"].get("channelOrder"),
            })
        low_fluid_path = verify_sidecar_descriptor(pair["low"]["fluid"])
        low_front_path = verify_sidecar_descriptor(pair["low"]["front"])
        high_fluid_path = verify_sidecar_descriptor(pair["high"]["fluid"])
        high_front_path = verify_sidecar_descriptor(pair["high"]["front"])
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, len(FLUID_CHANNELS)))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_cells, len(FLUID_CHANNELS)))
        _high_front = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_cells,))
        evidence.update({
            "pairManifest": str(pair_path),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "routeIdentity": pair.get("routeIdentity"),
            "effectiveRoute": pair.get("effectiveRoute"),
        })

        rng = np.random.default_rng(int(args.seed))
        support_scan = mixed_sample_indexes(high_cells, min(high_cells, max(int(args.support_scan_samples), int(args.train_samples))), np.array([], dtype=np.int64), 0.0, rng)
        support_truth, support_target_diagnostics = derived_flow_debug_rgb(high_fluid, support_scan, high_grid)
        support_norm = np.linalg.norm(support_truth.astype(np.float64), axis=1)
        support_threshold = max(1.0e-5, float(np.quantile(support_norm, 0.90)) * 0.35)
        support = support_scan[np.flatnonzero(support_norm > support_threshold)]
        train_indexes = mixed_sample_indexes(high_cells, int(args.train_samples), support, float(args.support_sample_fraction), rng)
        test_indexes = mixed_sample_indexes(high_cells, int(args.test_samples), support, float(args.support_sample_fraction), rng, train_indexes)
        low_train_cells = low_cell_indexes_for_high(train_indexes, low_grid, high_grid)
        low_test_cells = low_cell_indexes_for_high(test_indexes, low_grid, high_grid)
        train_truth_rgb, train_target_diagnostics = derived_flow_debug_rgb(high_fluid, train_indexes, high_grid)
        test_truth_rgb, test_target_diagnostics = derived_flow_debug_rgb(high_fluid, test_indexes, high_grid)
        train_low_rgb, _ = derived_flow_debug_rgb(low_fluid, low_train_cells, low_grid)
        test_low_rgb, _ = derived_flow_debug_rgb(low_fluid, low_test_cells, low_grid)
        low_train_values, x_train, y_train, z_train = _APPLY.low_values_for_high_cells(low_fluid, low_front, train_indexes, low_grid, high_grid)
        low_test_values, x_test, y_test, z_test = _APPLY.low_values_for_high_cells(low_fluid, low_front, test_indexes, low_grid, high_grid)
        train_base = _APPLY.build_features(low_train_values, x_train, y_train, z_train, high_grid)
        test_base = _APPLY.build_features(low_test_values, x_test, y_test, z_test, high_grid)
        global_context, global_summary_manifest = global_basin_summary_features(low_fluid, low_front, low_grid)

        feature_regime_identities = {
            SAME_CELL_IDENTITY: {
                "identity": SAME_CELL_FEATURE_IDENTITY,
                "sameCellCurrentFeatureSet": "full low-grid channel vector, squared channels, normalized position, Fourier basis, RBF position basis",
                "featureCount": int(train_base.shape[1]),
                "channelOrder": ALL_CHANNELS,
            },
            LOCAL_GEOMETRY_IDENTITY: {
                "identity": LOCAL_GEOMETRY_FEATURE_IDENTITY,
                "localGeometrySixNeighbor": "append six-neighbor low-grid mean/max absolute deltas by channel",
                "baseIdentity": SAME_CELL_FEATURE_IDENTITY,
                "featureCount": int(train_base.shape[1] + 2 * len(ALL_CHANNELS)),
                "channelOrder": ALL_CHANNELS,
            },
            GLOBAL_SUMMARY_IDENTITY: {
                "identity": GLOBAL_SUMMARY_FEATURE_IDENTITY,
                "globalBasinSummary": "append six-neighbor local geometry plus per-cell coarse low-grid basin map features and recorded constant global statistics",
                "baseIdentity": LOCAL_GEOMETRY_FEATURE_IDENTITY,
                "featureCount": int(train_base.shape[1] + 2 * len(ALL_CHANNELS) + global_summary_manifest["globalBasinSummary"]["featureCount"]),
                "channelOrder": ALL_CHANNELS,
                "summary": global_summary_manifest["globalBasinSummary"],
            },
        }

        low_metrics = vector_metrics(test_low_rgb, test_truth_rgb)
        regimes: dict[str, Any] = {}
        preview_rows: list[tuple[str, np.ndarray]] = []
        slice_y = high_grid // 2 if args.preview_slice_y is None else max(0, min(high_grid - 1, int(args.preview_slice_y)))
        slice_indexes = (np.arange(high_grid, dtype=np.int64).reshape(1, high_grid)
                         + np.full((high_grid, 1), slice_y, dtype=np.int64) * high_grid
                         + np.arange(high_grid, dtype=np.int64).reshape(high_grid, 1) * high_grid * high_grid).reshape(-1)
        slice_low_cells = low_cell_indexes_for_high(slice_indexes, low_grid, high_grid)
        slice_truth_rgb, _ = derived_flow_debug_rgb(high_fluid, slice_indexes, high_grid)
        slice_low_rgb, _ = derived_flow_debug_rgb(low_fluid, slice_low_cells, low_grid)
        preview_rows.extend([(DISPLAY_LABELS["truthHigh"], slice_truth_rgb), (DISPLAY_LABELS["lowUpsampled"], slice_low_rgb)])

        for regime in (SAME_CELL_IDENTITY, LOCAL_GEOMETRY_IDENTITY, GLOBAL_SUMMARY_IDENTITY):
            train_features = build_regime_features(regime, train_base, low_fluid, low_front, train_indexes, low_grid, high_grid, global_context)
            test_features = build_regime_features(regime, test_base, low_fluid, low_front, test_indexes, low_grid, high_grid, global_context)
            prediction, states, standardization, component_reports = train_regime(
                regime,
                args,
                train_features,
                test_features,
                train_low_rgb,
                test_low_rgb,
                train_truth_rgb,
                test_truth_rgb,
            )
            regime_metrics = vector_metrics(prediction, test_truth_rgb)
            regimes[regime] = {
                "identity": regime,
                "featureIdentity": feature_regime_identities[regime],
                "featureStandardization": standardization["report"],
                "componentReports": component_reports,
                "renderComparisonMetrics": {
                    "lowUpsampled": low_metrics,
                    "predicted": regime_metrics,
                    "improvementVsLowUpsampled": _CHANNEL.improvement_vs(low_metrics, regime_metrics),
                },
                "supportDiagnostics": support_diagnostics(test_low_rgb, test_truth_rgb, prediction),
            }

            slice_low_values, sx, sy, sz = _APPLY.low_values_for_high_cells(low_fluid, low_front, slice_indexes, low_grid, high_grid)
            slice_base = _APPLY.build_features(slice_low_values, sx, sy, sz, high_grid)
            slice_features = build_regime_features(regime, slice_base, low_fluid, low_front, slice_indexes, low_grid, high_grid, global_context)
            preview_prediction = predict_regime(slice_features, slice_low_rgb, states, standardization)
            preview_rows.append((DISPLAY_LABELS[regime], preview_prediction))

        contact = write_contact_sheet(out_dir, high_grid, slice_y, preview_rows)
        manifest = {
            "schema": SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": EVIDENCE_IDENTITY,
            "authority": "same-pair-sampled-derived-diagnostic-rgb-feature-context-ablation-not-product-application",
            "pairManifest": str(pair_path),
            "pairManifestSha256": sha256_file(pair_path),
            "routeIdentity": pair.get("routeIdentity"),
            "effectiveRoute": pair.get("effectiveRoute"),
            "backend": pair.get("backend"),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "supportThresholdGateIdentity": "truth-derived-rgb-support-diagnostics-only-v0",
            "diagnosticRgbTargetIdentity": DIAGNOSTIC_RGB_TARGET_IDENTITY,
            "derivedTarget": {
                "identity": DIAGNOSTIC_RGB_TARGET_IDENTITY,
                "authority": DIAGNOSTIC_RGB_TARGET_AUTHORITY,
                "targetChannelOrder": TARGET_CHANNELS,
                "targetDiagnostics": {
                    "supportScan": support_target_diagnostics,
                    "train": train_target_diagnostics,
                    "test": test_target_diagnostics,
                },
            },
            "inputFeatureContract": {
                "fullLowGridInputFeatureSetPreserved": True,
                "ALL_CHANNELS": ALL_CHANNELS,
                "sameCellBaseSource": "volume-full-grid-field-residual-apply.py build_features",
                "featureRegimeIdentities": feature_regime_identities,
            },
            "training": {
                "modelIdentity": "diagnostic-rgb-context-ablation-component-mlp-residual-v0",
                "trainSamples": int(train_indexes.shape[0]),
                "testSamples": int(test_indexes.shape[0]),
                "supportScanSamples": int(support_scan.shape[0]),
                "supportSampleFraction": float(args.support_sample_fraction),
                "hiddenWidth": int(args.hidden_width),
                "epochs": int(args.epochs),
                "learningRate": float(args.learning_rate),
                "batchSize": int(args.batch_size),
                "seed": int(args.seed),
                "limitation": "Same-pair sampled diagnostic; not held-out route proof and not a full-grid product application.",
            },
            "modelVariants": regimes,
            "contactSheet": contact,
            "visibleRasterLabels": contact["visibleRasterLabels"],
            "displayLabels": DISPLAY_LABELS,
            "sidecarChecksums": {
                "lowFluid": {"path": str(low_fluid_path), "sha256": sha256_file(low_fluid_path)},
                "lowFront": {"path": str(low_front_path), "sha256": sha256_file(low_front_path)},
                "highFluid": {"path": str(high_fluid_path), "sha256": sha256_file(high_fluid_path)},
                "highFront": {"path": str(high_front_path), "sha256": sha256_file(high_front_path)},
            },
            "limitations": [
                "Truth support is used for training sample pressure and diagnostics only.",
                "Feature regimes preserve all low-grid channels; local/global context appends features instead of narrowing inputs.",
                "Preview sheet is a center Y-slice visual direction check, not browser raymarch evidence.",
            ],
        }
        write_json(manifest_path, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(manifest_path),
            "contactSheet": contact["path"],
            "modelVariants": {
                key: value["renderComparisonMetrics"]["improvementVsLowUpsampled"]
                for key, value in regimes.items()
            },
        }, indent=2))
        return 0
    except Exception as error:
        write_failure(manifest_path, "unknown", error, evidence)
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
