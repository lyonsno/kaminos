#!/usr/bin/env python3
"""Run an uncapped paired ridge assay over a Non-Ridge source-basis corpus."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np


SCHEMA = "kaminos.volume.nonridge-source-basis-ridge-assay.v0"
IDENTITY = "paired-streaming-current16-source-complete-ridge-assay-v0"
CORPUS_SCHEMA = "kaminos.volume.nonridge-source-basis-corpus.v0"
TARGET_ORDER = [
    "candidate.nonRidgeMembership",
    "nonRidge.emission.r",
    "nonRidge.emission.g",
    "nonRidge.emission.b",
    "nonRidge.extinction",
]


class AssayError(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


@dataclass
class SufficientStats:
    dimension: int
    targets: int
    count: int = 0

    def __post_init__(self) -> None:
        self.sum_x = np.zeros(self.dimension, dtype=np.float64)
        self.sum_xx = np.zeros((self.dimension, self.dimension), dtype=np.float64)
        self.sum_y = np.zeros(self.targets, dtype=np.float64)
        self.sum_xy = np.zeros((self.dimension, self.targets), dtype=np.float64)
        self.sum_y2 = np.zeros(self.targets, dtype=np.float64)

    def add(self, x: np.ndarray, y: np.ndarray) -> None:
        if x.shape[0] == 0:
            return
        x64 = np.asarray(x, dtype=np.float64)
        y64 = np.asarray(y, dtype=np.float64)
        if y64.ndim == 1:
            y64 = y64[:, None]
        self.count += int(x64.shape[0])
        self.sum_x += np.sum(x64, axis=0)
        self.sum_xx += x64.T @ x64
        self.sum_y += np.sum(y64, axis=0)
        self.sum_xy += x64.T @ y64
        self.sum_y2 += np.sum(y64 * y64, axis=0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-manifest", required=True)
    parser.add_argument("--corpus-manifest-sha256", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--calibration-setting", required=True)
    parser.add_argument("--chunk-rows", type=int, default=131_072)
    parser.add_argument("--ridge-alphas", default="1e-8,1e-6,1e-4,1e-2,1")
    return parser.parse_args()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def prepare_output(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in ("assay-manifest.json", "failure-report.json", "weights.npz"):
        target = out_dir / name
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()


def fail(out_dir: Path, error: Exception, corpus_path: Path | None = None) -> None:
    phase = error.phase if isinstance(error, AssayError) else "unknown"
    evidence = error.evidence if isinstance(error, AssayError) else {}
    payload = {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "source": {"corpusManifest": str(corpus_path) if corpus_path else None},
        "lastTrustworthyEvidence": evidence,
    }
    write_json(out_dir / "failure-report.json", payload)


def parse_alphas(raw: str) -> list[float]:
    try:
        values = sorted(set(float(value.strip()) for value in raw.split(",") if value.strip()))
    except ValueError as error:
        raise AssayError("arguments", f"invalid ridge alpha: {error}") from error
    if not values or any(not math.isfinite(value) or value < 0 for value in values):
        raise AssayError("arguments", "ridge alphas must be finite nonnegative values")
    return values


def descriptor_path(descriptor: dict[str, Any], expected_columns: int, phase: str) -> tuple[Path, int]:
    shape = descriptor.get("shape")
    if not isinstance(shape, list) or len(shape) != 2 or int(shape[1]) != expected_columns:
        raise AssayError(phase, f"unexpected descriptor shape {shape}", {"descriptor": descriptor})
    if descriptor.get("dtype") != "float32-le":
        raise AssayError(phase, "descriptor dtype must be float32-le", {"descriptor": descriptor})
    path = Path(str(descriptor.get("path") or ""))
    expected_bytes = int(shape[0]) * int(shape[1]) * 4
    declared_bytes = int(descriptor.get("bytes", descriptor.get("byteLength", -1)))
    if declared_bytes != expected_bytes:
        raise AssayError(phase, "descriptor declared byte count does not match shape", {
            "path": str(path), "declaredBytes": declared_bytes, "expectedBytes": expected_bytes,
        })
    if not path.is_file():
        raise AssayError(phase, f"missing artifact {path}", {"path": str(path)})
    if path.stat().st_size != expected_bytes:
        raise AssayError(phase, "artifact byte count does not match descriptor", {
            "path": str(path), "actualBytes": path.stat().st_size, "expectedBytes": expected_bytes,
        })
    expected_sha = str(descriptor.get("sha256") or "")
    if len(expected_sha) != 64:
        raise AssayError(phase, "artifact descriptor lacks a SHA-256", {"path": str(path)})
    return path, int(shape[0])


def validate_manifest(corpus: dict[str, Any], calibration_id: str) -> tuple[list[dict[str, Any]], list[str], list[str], str]:
    if corpus.get("schema") != CORPUS_SCHEMA:
        raise AssayError("corpus-schema", f"unsupported corpus schema {corpus.get('schema')}")
    if corpus.get("status") != "complete" or corpus.get("failurePhase") is not None:
        raise AssayError("corpus-status", "corpus is not a completed failure-free artifact", {
            "status": corpus.get("status"), "failurePhase": corpus.get("failurePhase"),
        })
    cohort = corpus.get("cohort") or {}
    if (
        cohort.get("retentionPolicy") != "retain-all-admitted-settings-and-rows-uncapped-v0"
        or cohort.get("sampleCap") is not None
        or int(cohort.get("droppedRowCount", -1)) != 0
    ):
        raise AssayError("corpus-retention", "corpus is not uncapped with zero dropped rows", {"cohort": cohort})
    current_order = list((corpus.get("featureViews") or {}).get("current16", {}).get("order") or [])
    complete_order = list((corpus.get("featureViews") or {}).get("sourceComplete", {}).get("order") or [])
    if not current_order or complete_order[: len(current_order)] != current_order or len(complete_order) <= len(current_order):
        raise AssayError("feature-view-contract", "source-complete must preserve Current-16 as an exact prefix", {
            "currentOrder": current_order, "sourceCompleteOrder": complete_order,
        })
    if list((corpus.get("targets") or {}).get("order") or []) != TARGET_ORDER:
        raise AssayError("target-contract", "target order must preserve membership, RGB emission, and extinction")
    if (corpus.get("targets") or {}).get("membershipTeacherLeakageIntoFeatures") is not False:
        raise AssayError("target-contract", "membership teacher leakage must be false")
    settings = list(corpus.get("settings") or [])
    setting_ids = [str(setting.get("id")) for setting in settings]
    if len(setting_ids) != len(set(setting_ids)):
        raise AssayError("split-contract", "setting IDs must be unique")
    splits = corpus.get("splits") or {}
    train_ids = list((splits.get("train") or {}).get("settingIds") or [])
    held_ids = list((splits.get("heldOut") or {}).get("settingIds") or [])
    if splits.get("identity") != "whole-effective-control-setting-holdout-v0" or not train_ids or not held_ids:
        raise AssayError("split-contract", "whole-setting train and held-out splits are required")
    if set(train_ids) & set(held_ids) or set(train_ids + held_ids) != set(setting_ids):
        raise AssayError("split-contract", "manifest splits must partition every setting exactly once")
    if calibration_id not in train_ids:
        raise AssayError("split-contract", "calibration setting must belong to the declared train split", {
            "calibrationSetting": calibration_id, "trainSettingIds": train_ids,
        })
    fit_ids = [setting_id for setting_id in train_ids if setting_id != calibration_id]
    if not fit_ids:
        raise AssayError("split-contract", "at least one fit setting must remain after calibration split")
    return settings, fit_ids, held_ids, calibration_id


def verify_artifacts(
    settings: list[dict[str, Any]],
    current_dim: int,
    complete_dim: int,
    chunk_rows: int,
) -> dict[str, Any]:
    checked = []
    for setting in settings:
        setting_id = str(setting["id"])
        rows = setting.get("rows") or {}
        current_desc = rows.get("current16") or {}
        complete_desc = rows.get("sourceComplete") or {}
        targets_desc = rows.get("targets") or {}
        current_path, current_rows = descriptor_path(current_desc, current_dim, "artifact-verification")
        complete_path, complete_rows = descriptor_path(complete_desc, complete_dim, "artifact-verification")
        targets_path, target_rows = descriptor_path(targets_desc, len(TARGET_ORDER), "artifact-verification")
        declared_rows = int(rows.get("count", -1))
        if current_rows != complete_rows or current_rows != target_rows or current_rows != declared_rows:
            raise AssayError("artifact-verification", "feature and target row counts differ", {
                "settingId": setting_id,
                "currentRows": current_rows,
                "completeRows": complete_rows,
                "targetRows": target_rows,
                "declaredRows": declared_rows,
            })
        current = np.memmap(current_path, dtype="<f4", mode="r", shape=(current_rows, current_dim))
        complete = np.memmap(complete_path, dtype="<f4", mode="r", shape=(complete_rows, complete_dim))
        for start in range(0, current_rows, chunk_rows):
            stop = min(current_rows, start + chunk_rows)
            if not np.array_equal(current[start:stop], complete[start:stop, :current_dim]):
                raise AssayError("artifact-verification", "Current-16 bytes differ from source-complete prefix", {
                    "settingId": setting_id, "rowStart": start, "rowStop": stop,
                })
        artifacts = []
        for descriptor, artifact_path in (
            (current_desc, current_path), (complete_desc, complete_path), (targets_desc, targets_path),
        ):
            actual_sha = sha256_file(artifact_path)
            if actual_sha != descriptor["sha256"]:
                raise AssayError("artifact-verification", "artifact SHA-256 mismatch", {
                    "settingId": setting_id,
                    "path": str(artifact_path),
                    "expectedSha256": descriptor["sha256"],
                    "actualSha256": actual_sha,
                })
            artifacts.append({"semanticRole": descriptor.get("semanticRole"), "sha256": actual_sha, "bytes": artifact_path.stat().st_size})
        checked.append({"settingId": setting_id, "rows": current_rows, "artifacts": artifacts, "currentPrefixExact": True})
    return {"settings": checked, "settingCount": len(checked), "currentPrefixExact": True}


def setting_arrays(setting: dict[str, Any], complete_dim: int) -> tuple[np.memmap, np.memmap]:
    rows = setting["rows"]
    count = int(rows["count"])
    complete = np.memmap(rows["sourceComplete"]["path"], dtype="<f4", mode="r", shape=(count, complete_dim))
    targets = np.memmap(rows["targets"]["path"], dtype="<f4", mode="r", shape=(count, len(TARGET_ORDER)))
    return complete, targets


def chunks(array_rows: int, chunk_rows: int) -> Iterable[tuple[int, int]]:
    for start in range(0, array_rows, chunk_rows):
        yield start, min(array_rows, start + chunk_rows)


def collect_stats(
    by_id: dict[str, dict[str, Any]],
    fit_ids: list[str],
    complete_dim: int,
    chunk_rows: int,
) -> tuple[SufficientStats, SufficientStats]:
    membership = SufficientStats(complete_dim, 1)
    optical = SufficientStats(complete_dim, 4)
    for setting_id in fit_ids:
        x, targets = setting_arrays(by_id[setting_id], complete_dim)
        for start, stop in chunks(x.shape[0], chunk_rows):
            x_chunk = x[start:stop]
            target_chunk = targets[start:stop]
            membership.add(x_chunk, target_chunk[:, 0])
            positive = np.asarray(target_chunk[:, 0] > 0.0)
            optical.add(x_chunk[positive], target_chunk[positive, 1:5])
    if membership.count == 0 or optical.count == 0:
        raise AssayError("sufficient-statistics", "fit split lacks membership or positive optical rows", {
            "membershipRows": membership.count, "positiveOpticalRows": optical.count,
        })
    return membership, optical


def feature_scale(stats: SufficientStats) -> tuple[np.ndarray, np.ndarray, list[int]]:
    mean = stats.sum_x / stats.count
    variance = np.maximum(stats.sum_xx.diagonal() / stats.count - mean * mean, 0.0)
    std = np.sqrt(variance)
    constant = np.flatnonzero(std < 1.0e-12).astype(int).tolist()
    std[std < 1.0e-12] = 1.0
    return mean, std, constant


def normalized_system(
    stats: SufficientStats,
    indices: np.ndarray,
    mean: np.ndarray,
    std: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    sx = stats.sum_x[indices]
    sxx = stats.sum_xx[np.ix_(indices, indices)]
    selected_mean = mean[indices]
    selected_std = std[indices]
    centered_xx = (
        sxx
        - np.outer(selected_mean, sx)
        - np.outer(sx, selected_mean)
        + stats.count * np.outer(selected_mean, selected_mean)
    ) / np.outer(selected_std, selected_std)
    centered_sum = (sx - stats.count * selected_mean) / selected_std
    centered_xy = (stats.sum_xy[indices] - np.outer(selected_mean, stats.sum_y)) / selected_std[:, None]
    dimension = len(indices)
    system = np.zeros((dimension + 1, dimension + 1), dtype=np.float64)
    rhs = np.zeros((dimension + 1, stats.targets), dtype=np.float64)
    system[:dimension, :dimension] = centered_xx
    system[:dimension, dimension] = centered_sum
    system[dimension, :dimension] = centered_sum
    system[dimension, dimension] = stats.count
    rhs[:dimension] = centered_xy
    rhs[dimension] = stats.sum_y
    return system, rhs


def solve_ridge(system: np.ndarray, rhs: np.ndarray, count: int, alpha: float) -> np.ndarray:
    normalized = system / count
    target = rhs / count
    regularizer = np.eye(system.shape[0], dtype=np.float64) * alpha
    regularizer[-1, -1] = 0.0
    try:
        return np.linalg.solve(normalized + regularizer, target)
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(normalized + regularizer, target, rcond=None)[0]


def predict(x: np.ndarray, indices: np.ndarray, mean: np.ndarray, std: np.ndarray, weights: np.ndarray) -> np.ndarray:
    normalized = (np.asarray(x[:, indices], dtype=np.float64) - mean[indices]) / std[indices]
    return normalized @ weights[:-1] + weights[-1]


def load_role(
    by_id: dict[str, dict[str, Any]],
    setting_ids: list[str],
    complete_dim: int,
) -> tuple[np.ndarray, np.ndarray]:
    feature_parts = []
    target_parts = []
    for setting_id in setting_ids:
        x, targets = setting_arrays(by_id[setting_id], complete_dim)
        feature_parts.append(np.asarray(x, dtype=np.float32))
        target_parts.append(np.asarray(targets, dtype=np.float32))
    return np.concatenate(feature_parts, axis=0), np.concatenate(target_parts, axis=0)


def regression_metrics(target: np.ndarray, prediction: np.ndarray) -> dict[str, Any]:
    target64 = np.asarray(target, dtype=np.float64)
    prediction64 = np.asarray(prediction, dtype=np.float64)
    if target64.ndim == 1:
        target64 = target64[:, None]
    if prediction64.ndim == 1:
        prediction64 = prediction64[:, None]
    error = prediction64 - target64
    rmse = np.sqrt(np.mean(error * error, axis=0))
    mae = np.mean(np.abs(error), axis=0)
    centered = target64 - np.mean(target64, axis=0)
    denominator = np.sum(centered * centered, axis=0)
    numerator = np.sum(error * error, axis=0)
    r2 = [None if value <= 1.0e-20 else float(1.0 - numerator[index] / value) for index, value in enumerate(denominator)]
    return {
        "rmse": float(np.mean(rmse)) if rmse.size == 1 else [float(value) for value in rmse],
        "rmseMean": float(np.mean(rmse)),
        "mae": float(np.mean(mae)) if mae.size == 1 else [float(value) for value in mae],
        "maeMean": float(np.mean(mae)),
        "r2": r2[0] if len(r2) == 1 else r2,
        "r2Mean": None if all(value is None for value in r2) else float(np.mean([value for value in r2 if value is not None])),
        "rows": int(target64.shape[0]),
    }


def classification_metrics(target: np.ndarray, prediction: np.ndarray, threshold: float) -> dict[str, Any]:
    truth = np.asarray(target, dtype=bool)
    predicted = np.asarray(prediction >= threshold, dtype=bool)
    tp = int(np.count_nonzero(truth & predicted))
    fp = int(np.count_nonzero(~truth & predicted))
    fn = int(np.count_nonzero(truth & ~predicted))
    tn = int(np.count_nonzero(~truth & ~predicted))
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = 2 * precision * recall / max(1.0e-20, precision + recall)
    return {
        "threshold": float(threshold), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": float(precision), "recall": float(recall), "f1": float(f1),
        "iou": float(tp / max(1, tp + fp + fn)), "rows": int(truth.size),
    }


def choose_threshold(target: np.ndarray, prediction: np.ndarray) -> tuple[float, dict[str, Any]]:
    minimum = float(np.min(prediction))
    maximum = float(np.max(prediction))
    candidates = np.linspace(minimum, maximum, 513, dtype=np.float64)
    best_threshold = float(candidates[0])
    best_metrics = classification_metrics(target, prediction, best_threshold)
    for candidate in candidates[1:]:
        metrics = classification_metrics(target, prediction, float(candidate))
        key = (metrics["f1"], metrics["iou"], -abs(float(candidate) - 0.5))
        best_key = (best_metrics["f1"], best_metrics["iou"], -abs(best_threshold - 0.5))
        if key > best_key:
            best_threshold = float(candidate)
            best_metrics = metrics
    return best_threshold, best_metrics


def view_fit(
    view_name: str,
    indices: np.ndarray,
    membership_stats: SufficientStats,
    optical_stats: SufficientStats,
    mean: np.ndarray,
    std: np.ndarray,
    calibration_x: np.ndarray,
    calibration_targets: np.ndarray,
    alphas: list[float],
) -> dict[str, Any]:
    membership_system, membership_rhs = normalized_system(membership_stats, indices, mean, std)
    optical_system, optical_rhs = normalized_system(optical_stats, indices, mean, std)
    membership_candidates = []
    optical_candidates = []
    positive = calibration_targets[:, 0] > 0.0
    for alpha in alphas:
        membership_weights = solve_ridge(membership_system, membership_rhs, membership_stats.count, alpha)
        membership_prediction = predict(calibration_x, indices, mean, std, membership_weights)[:, 0]
        soft = regression_metrics(calibration_targets[:, 0], membership_prediction)
        membership_candidates.append((soft["rmseMean"], alpha, membership_weights, membership_prediction, soft))
        optical_weights = solve_ridge(optical_system, optical_rhs, optical_stats.count, alpha)
        optical_prediction = np.maximum(predict(calibration_x, indices, mean, std, optical_weights), 0.0)
        optical_metrics = regression_metrics(calibration_targets[positive, 1:5], optical_prediction[positive])
        optical_candidates.append((optical_metrics["rmseMean"], alpha, optical_weights, optical_prediction, optical_metrics))
    membership_candidates.sort(key=lambda item: (item[0], item[1]))
    optical_candidates.sort(key=lambda item: (item[0], item[1]))
    _, membership_alpha, membership_weights, membership_prediction, membership_soft = membership_candidates[0]
    _, optical_alpha, optical_weights, _, optical_positive = optical_candidates[0]
    any_threshold, any_calibration = choose_threshold(calibration_targets[:, 0] > 0.0, membership_prediction)
    strong_threshold, strong_calibration = choose_threshold(calibration_targets[:, 0] >= 0.5, membership_prediction)
    return {
        "view": view_name,
        "indices": indices,
        "membershipAlpha": membership_alpha,
        "opticalAlpha": optical_alpha,
        "membershipWeights": membership_weights,
        "opticalWeights": optical_weights,
        "thresholds": {"anySupport": any_threshold, "strongSupport": strong_threshold},
        "calibration": {
            "membership": {"soft": membership_soft, "anySupport": any_calibration, "strongSupport": strong_calibration},
            "optical": {"positiveSupport": optical_positive},
        },
        "alphaGrid": {
            "membership": [{"alpha": float(item[1]), "softRmse": float(item[0])} for item in membership_candidates],
            "optical": [{"alpha": float(item[1]), "positiveSupportRmseMean": float(item[0])} for item in optical_candidates],
        },
    }


def evaluate_view(
    fitted: dict[str, Any],
    x: np.ndarray,
    targets: np.ndarray,
    mean: np.ndarray,
    std: np.ndarray,
) -> dict[str, Any]:
    membership_prediction = predict(x, fitted["indices"], mean, std, fitted["membershipWeights"])[:, 0]
    optical_prediction = np.maximum(predict(x, fitted["indices"], mean, std, fitted["opticalWeights"]), 0.0)
    positive = targets[:, 0] > 0.0
    any_metrics = classification_metrics(targets[:, 0] > 0.0, membership_prediction, fitted["thresholds"]["anySupport"])
    strong_metrics = classification_metrics(targets[:, 0] >= 0.5, membership_prediction, fitted["thresholds"]["strongSupport"])
    return {
        "membership": {
            "soft": regression_metrics(targets[:, 0], membership_prediction),
            "anySupport": any_metrics,
            "strongSupport": strong_metrics,
        },
        "optical": {
            "allRows": regression_metrics(targets[:, 1:5], optical_prediction),
            "positiveSupport": regression_metrics(targets[positive, 1:5], optical_prediction[positive]),
        },
    }


def public_view(fitted: dict[str, Any], metrics: dict[str, Any], rows: int) -> dict[str, Any]:
    return {
        "identity": fitted["view"],
        "featureCount": int(len(fitted["indices"])),
        "rowsEvaluated": int(rows),
        "selectedHyperparameters": {
            "membershipRidgeAlpha": float(fitted["membershipAlpha"]),
            "opticalRidgeAlpha": float(fitted["opticalAlpha"]),
            "membershipThresholds": {key: float(value) for key, value in fitted["thresholds"].items()},
        },
        "calibration": fitted["calibration"],
        "alphaGrid": fitted["alphaGrid"],
        "metrics": metrics,
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    corpus_path = Path(args.corpus_manifest).resolve()
    prepare_output(out_dir)
    started = time.perf_counter()
    try:
        if args.chunk_rows <= 0:
            raise AssayError("arguments", "chunk rows must be positive")
        alphas = parse_alphas(args.ridge_alphas)
        expected_manifest_sha = args.corpus_manifest_sha256.lower()
        actual_manifest_sha = sha256_file(corpus_path)
        if actual_manifest_sha != expected_manifest_sha:
            raise AssayError("corpus-manifest-checksum", "corpus manifest SHA-256 mismatch", {
                "expectedSha256": expected_manifest_sha,
                "actualSha256": actual_manifest_sha,
            })
        corpus = json.loads(corpus_path.read_text())
        settings, fit_ids, held_ids, calibration_id = validate_manifest(corpus, args.calibration_setting)
        by_id = {str(setting["id"]): setting for setting in settings}
        current_order = list(corpus["featureViews"]["current16"]["order"])
        complete_order = list(corpus["featureViews"]["sourceComplete"]["order"])
        current_dim = len(current_order)
        complete_dim = len(complete_order)
        verification = verify_artifacts(settings, current_dim, complete_dim, args.chunk_rows)
        membership_stats, optical_stats = collect_stats(by_id, fit_ids, complete_dim, args.chunk_rows)
        mean, std, constant_features = feature_scale(membership_stats)
        calibration_x, calibration_targets = load_role(by_id, [calibration_id], complete_dim)
        calibration_any = np.asarray(calibration_targets[:, 0] > 0.0)
        calibration_strong = np.asarray(calibration_targets[:, 0] >= 0.5)
        calibration_balance = {
            "settingId": calibration_id,
            "rows": int(calibration_targets.shape[0]),
            "anySupportPositiveRows": int(np.count_nonzero(calibration_any)),
            "anySupportNegativeRows": int(np.count_nonzero(~calibration_any)),
            "strongSupportPositiveRows": int(np.count_nonzero(calibration_strong)),
            "strongSupportNegativeRows": int(np.count_nonzero(~calibration_strong)),
        }
        if any(value == 0 for key, value in calibration_balance.items() if key.endswith("Rows") and key != "rows"):
            raise AssayError(
                "calibration-support",
                "calibration setting must contain both classes for any-support and strong-support thresholds",
                calibration_balance,
            )
        held_x, held_targets = load_role(by_id, held_ids, complete_dim)
        current_indices = np.arange(current_dim, dtype=np.int64)
        complete_indices = np.arange(complete_dim, dtype=np.int64)
        current_fit = view_fit(
            "current16", current_indices, membership_stats, optical_stats, mean, std,
            calibration_x, calibration_targets, alphas,
        )
        complete_fit = view_fit(
            "sourceComplete", complete_indices, membership_stats, optical_stats, mean, std,
            calibration_x, calibration_targets, alphas,
        )
        current_metrics = evaluate_view(current_fit, held_x, held_targets, mean, std)
        complete_metrics = evaluate_view(complete_fit, held_x, held_targets, mean, std)
        ablations = []
        for ablation in corpus.get("ablations") or []:
            index = int(ablation.get("sourceCompleteIndex", -1))
            channel = str(ablation.get("channel") or "")
            if index < current_dim or index >= complete_dim or complete_order[index] != channel:
                raise AssayError("ablation-contract", "drop-one ablation index/channel mismatch", {"ablation": ablation})
            indices = np.asarray([value for value in range(complete_dim) if value != index], dtype=np.int64)
            fitted = view_fit(
                f"sourceComplete-minus-{channel}", indices, membership_stats, optical_stats, mean, std,
                calibration_x, calibration_targets, alphas,
            )
            metrics = evaluate_view(fitted, held_x, held_targets, mean, std)
            ablations.append({
                "identity": "source-complete-drop-one-channel-ridge-v0",
                "droppedChannel": channel,
                "sourceCompleteIndex": index,
                "selectedHyperparameters": {
                    "membershipRidgeAlpha": float(fitted["membershipAlpha"]),
                    "opticalRidgeAlpha": float(fitted["opticalAlpha"]),
                    "membershipThresholds": fitted["thresholds"],
                },
                "metrics": metrics,
            })
        weights_path = out_dir / "weights.npz"
        np.savez_compressed(
            weights_path,
            feature_mean=mean,
            feature_std=std,
            current16_membership=current_fit["membershipWeights"],
            current16_optical=current_fit["opticalWeights"],
            source_complete_membership=complete_fit["membershipWeights"],
            source_complete_optical=complete_fit["opticalWeights"],
        )
        weights_sha = sha256_file(weights_path)
        rows_by_id = {setting_id: int(by_id[setting_id]["rows"]["count"]) for setting_id in by_id}
        semantic_result = {
            "assay": IDENTITY,
            "corpusIdentity": corpus["identity"],
            "corpusManifestSha256": actual_manifest_sha,
            "fitSettingIds": fit_ids,
            "calibrationSettingId": calibration_id,
            "heldOutSettingIds": held_ids,
            "ridgeAlphas": alphas,
            "views": {"current16": current_metrics, "sourceComplete": complete_metrics},
            "ablations": ablations,
            "weightsSha256": weights_sha,
        }
        result_identity = f"sha256:{hashlib.sha256(canonical_bytes(semantic_result)).hexdigest()}"
        report = {
            "schema": SCHEMA,
            "identity": result_identity,
            "assayIdentity": IDENTITY,
            "status": "complete",
            "failurePhase": None,
            "source": {
                "corpusManifest": str(corpus_path),
                "corpusManifestSha256": actual_manifest_sha,
                "corpusIdentity": corpus["identity"],
                "corpusAuthority": corpus.get("authority"),
            },
            "rows": {
                "policy": "all-rows-streamed-uncapped-v0",
                "chunkRows": int(args.chunk_rows),
                "fit": {"settingIds": fit_ids, "count": sum(rows_by_id[value] for value in fit_ids)},
                "calibration": {"settingIds": [calibration_id], "count": rows_by_id[calibration_id]},
                "heldOut": {"settingIds": held_ids, "count": sum(rows_by_id[value] for value in held_ids)},
            },
            "featureViews": {
                "current16": {"order": current_order, "identity": corpus["featureViews"]["current16"].get("identity")},
                "sourceComplete": {"order": complete_order, "identity": corpus["featureViews"]["sourceComplete"].get("identity")},
                "constantFeatureIndexes": constant_features,
            },
            "targets": corpus["targets"],
            "training": {
                "model": "closed-form-ridge-with-unregularized-intercept-v0",
                "standardization": "fit-settings-population-mean-std-v0",
                "ridgeAlphas": alphas,
                "membershipObjective": "soft-membership-rmse-v0",
                "opticalObjective": "positive-membership-clipped-nonnegative-rgb-extinction-rmse-v0",
                "thresholdCalibration": "whole-setting-513-point-max-f1-v0",
            },
            "views": {
                "current16": public_view(current_fit, current_metrics, held_targets.shape[0]),
                "sourceComplete": public_view(complete_fit, complete_metrics, held_targets.shape[0]),
            },
            "ablations": ablations,
            "artifacts": {
                "weights": {"path": str(weights_path), "sha256": weights_sha, "bytes": weights_path.stat().st_size},
            },
            "verification": verification,
            "runtime": {"wallSeconds": float(time.perf_counter() - started)},
            "verdictAuthority": "linear-source-information-discriminant-only-v0",
        }
        write_json(out_dir / "assay-manifest.json", report)
        print(json.dumps({
            "status": "complete",
            "identity": result_identity,
            "manifest": str(out_dir / "assay-manifest.json"),
            "current16SoftMembershipRmse": current_metrics["membership"]["soft"]["rmse"],
            "sourceCompleteSoftMembershipRmse": complete_metrics["membership"]["soft"]["rmse"],
        }))
        return 0
    except Exception as error:
        fail(out_dir, error, corpus_path)
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
