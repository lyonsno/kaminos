#!/usr/bin/env python3
"""Run an uncapped paired ridge assay over a Non-Ridge source-basis corpus."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Iterable

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


@dataclass
class VerifiedArtifact:
    path: Path
    handle: BinaryIO
    array: np.memmap
    expected_sha256: str
    initial_stat: os.stat_result
    semantic_role: str | None

    def close(self) -> None:
        mmap = getattr(self.array, "_mmap", None)
        if mmap is not None:
            mmap.close()
        self.handle.close()


@dataclass
class OpenedSetting:
    manifest: dict[str, Any]
    current: VerifiedArtifact
    source_complete: VerifiedArtifact
    targets: VerifiedArtifact

    @property
    def count(self) -> int:
        return int(self.manifest["rows"]["count"])

    def close(self) -> None:
        self.current.close()
        self.source_complete.close()
        self.targets.close()


@dataclass
class RegressionAccumulator:
    targets: int
    count: int = 0

    def __post_init__(self) -> None:
        self.sum_squared_error = np.zeros(self.targets, dtype=np.float64)
        self.sum_absolute_error = np.zeros(self.targets, dtype=np.float64)
        self.sum_y = np.zeros(self.targets, dtype=np.float64)
        self.sum_y2 = np.zeros(self.targets, dtype=np.float64)

    def add(self, target: np.ndarray, prediction: np.ndarray) -> None:
        target64 = np.asarray(target, dtype=np.float64)
        prediction64 = np.asarray(prediction, dtype=np.float64)
        if target64.ndim == 1:
            target64 = target64[:, None]
        if prediction64.ndim == 1:
            prediction64 = prediction64[:, None]
        if target64.shape != prediction64.shape:
            raise AssayError("metric-shape", "target and prediction shapes differ", {
                "targetShape": list(target64.shape), "predictionShape": list(prediction64.shape),
            })
        if target64.shape[0] == 0:
            return
        error = prediction64 - target64
        self.count += int(target64.shape[0])
        self.sum_squared_error += np.sum(error * error, axis=0)
        self.sum_absolute_error += np.sum(np.abs(error), axis=0)
        self.sum_y += np.sum(target64, axis=0)
        self.sum_y2 += np.sum(target64 * target64, axis=0)

    def metrics(self, phase: str) -> dict[str, Any]:
        if self.count == 0:
            raise AssayError(phase, "metric cohort contains zero rows")
        rmse = np.sqrt(self.sum_squared_error / self.count)
        mae = self.sum_absolute_error / self.count
        denominator = self.sum_y2 - self.sum_y * self.sum_y / self.count
        r2 = [
            None if value <= 1.0e-20 else float(1.0 - self.sum_squared_error[index] / value)
            for index, value in enumerate(denominator)
        ]
        return {
            "rmse": float(rmse[0]) if rmse.size == 1 else [float(value) for value in rmse],
            "rmseMean": float(np.mean(rmse)),
            "mae": float(mae[0]) if mae.size == 1 else [float(value) for value in mae],
            "maeMean": float(np.mean(mae)),
            "r2": r2[0] if len(r2) == 1 else r2,
            "r2Mean": None if all(value is None for value in r2) else float(np.mean([value for value in r2 if value is not None])),
            "rows": self.count,
        }


@dataclass
class ClassificationAccumulator:
    threshold: float
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0

    def add(self, truth: np.ndarray, prediction: np.ndarray) -> None:
        truth_bool = np.asarray(truth, dtype=bool)
        predicted = np.asarray(prediction >= self.threshold, dtype=bool)
        self.tp += int(np.count_nonzero(truth_bool & predicted))
        self.fp += int(np.count_nonzero(~truth_bool & predicted))
        self.fn += int(np.count_nonzero(truth_bool & ~predicted))
        self.tn += int(np.count_nonzero(~truth_bool & ~predicted))

    def metrics(self) -> dict[str, Any]:
        precision = self.tp / max(1, self.tp + self.fp)
        recall = self.tp / max(1, self.tp + self.fn)
        f1 = 2 * precision * recall / max(1.0e-20, precision + recall)
        return {
            "threshold": float(self.threshold), "tp": self.tp, "fp": self.fp, "fn": self.fn, "tn": self.tn,
            "precision": float(precision), "recall": float(recall), "f1": float(f1),
            "iou": float(self.tp / max(1, self.tp + self.fp + self.fn)),
            "rows": self.tp + self.fp + self.fn + self.tn,
        }


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


def descriptor_path(descriptor: dict[str, Any], expected_columns: int, phase: str) -> tuple[Path, int, int, str]:
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
    expected_sha = str(descriptor.get("sha256") or "")
    if len(expected_sha) != 64:
        raise AssayError(phase, "artifact descriptor lacks a SHA-256", {"path": str(path)})
    return path, int(shape[0]), expected_bytes, expected_sha


def sha256_handle(handle: BinaryIO) -> str:
    offset = handle.tell()
    handle.seek(0)
    digest = hashlib.sha256()
    for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
        digest.update(chunk)
    handle.seek(offset)
    return digest.hexdigest()


def open_verified_artifact(
    descriptor: dict[str, Any],
    expected_columns: int,
    phase: str,
) -> VerifiedArtifact:
    path, rows, expected_bytes, expected_sha = descriptor_path(descriptor, expected_columns, phase)
    try:
        handle = path.open("rb", buffering=0)
    except OSError as error:
        raise AssayError(phase, f"cannot open artifact {path}: {error}", {"path": str(path)}) from error
    try:
        initial_stat = os.fstat(handle.fileno())
        if initial_stat.st_size != expected_bytes:
            raise AssayError(phase, "opened artifact byte count does not match descriptor", {
                "path": str(path), "actualBytes": initial_stat.st_size, "expectedBytes": expected_bytes,
            })
        actual_sha = sha256_handle(handle)
        if actual_sha != expected_sha:
            raise AssayError(phase, "opened artifact SHA-256 mismatch", {
                "path": str(path), "expectedSha256": expected_sha, "actualSha256": actual_sha,
            })
        array = np.memmap(handle, dtype="<f4", mode="r", shape=(rows, expected_columns))
        return VerifiedArtifact(
            path=path,
            handle=handle,
            array=array,
            expected_sha256=expected_sha,
            initial_stat=initial_stat,
            semantic_role=descriptor.get("semanticRole"),
        )
    except Exception:
        handle.close()
        raise


def validate_manifest(corpus: dict[str, Any], calibration_assertion: str) -> tuple[list[dict[str, Any]], list[str], list[str], str]:
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
    if not settings or any(not setting_id for setting_id in setting_ids) or len(setting_ids) != len(set(setting_ids)):
        raise AssayError("split-contract", "setting IDs must be unique")
    effective_identities = [str(setting.get("effectiveControlIdentity") or "") for setting in settings]
    if any(not value for value in effective_identities) or len(effective_identities) != len(set(effective_identities)):
        raise AssayError("split-contract", "effective-control identities must be nonempty and globally unique", {
            "effectiveControlIdentities": effective_identities,
        })
    rows_by_id = {str(setting["id"]): int((setting.get("rows") or {}).get("count", -1)) for setting in settings}
    cohort = corpus.get("cohort") or {}
    if int(cohort.get("retainedSettingCount", -1)) != len(settings) or int(cohort.get("totalRows", -1)) != sum(rows_by_id.values()):
        raise AssayError("corpus-retention", "cohort setting or row totals do not match retained settings", {
            "declaredSettingCount": cohort.get("retainedSettingCount"),
            "actualSettingCount": len(settings),
            "declaredTotalRows": cohort.get("totalRows"),
            "actualTotalRows": sum(rows_by_id.values()),
        })
    splits = corpus.get("splits") or {}
    train_ids = list((splits.get("train") or {}).get("settingIds") or [])
    held_ids = list((splits.get("heldOut") or {}).get("settingIds") or [])
    if splits.get("identity") != "whole-effective-control-setting-holdout-v0" or not train_ids or not held_ids:
        raise AssayError("split-contract", "whole-setting train and held-out splits are required")
    if len(train_ids) != len(set(train_ids)) or len(held_ids) != len(set(held_ids)):
        raise AssayError("split-contract", "split setting lists must not contain duplicates")
    if set(train_ids) & set(held_ids) or set(train_ids + held_ids) != set(setting_ids):
        raise AssayError("split-contract", "manifest splits must partition every setting exactly once")
    effective_by_id = {str(setting["id"]): str(setting["effectiveControlIdentity"]) for setting in settings}
    for role, role_ids in (("train", train_ids), ("heldOut", held_ids)):
        declared_effective = list((splits.get(role) or {}).get("effectiveControlIdentities") or [])
        expected_effective = [effective_by_id[value] for value in role_ids]
        if declared_effective and (
            len(declared_effective) != len(set(declared_effective))
            or set(declared_effective) != set(expected_effective)
        ):
            raise AssayError("split-contract", "split effective-control identities do not match the setting cohort", {
                "role": role, "declared": declared_effective,
                "expected": expected_effective,
            })
    by_id = {str(setting["id"]): setting for setting in settings}
    eligible_calibration = sorted(
        setting_id for setting_id in train_ids
        if not bool((by_id[setting_id].get("targetSummary") or {}).get("allTargetsZero"))
    )
    if not eligible_calibration:
        raise AssayError("calibration-selection", "train split has no nonblack calibration setting")
    calibration_id = eligible_calibration[-1]
    if calibration_assertion != calibration_id:
        raise AssayError("calibration-selection", "caller calibration assertion does not match deterministic corpus rule", {
            "assertedCalibrationSetting": calibration_assertion,
            "selectedCalibrationSetting": calibration_id,
            "selection": "lexical-last-nonblack-train-setting-v0",
        })
    fit_ids = [setting_id for setting_id in train_ids if setting_id != calibration_id]
    if not fit_ids:
        raise AssayError("split-contract", "at least one fit setting must remain after calibration split")
    return settings, fit_ids, held_ids, calibration_id


def open_and_verify_artifacts(
    settings: list[dict[str, Any]],
    current_dim: int,
    complete_dim: int,
    chunk_rows: int,
) -> tuple[dict[str, OpenedSetting], dict[str, Any]]:
    checked = []
    opened: dict[str, OpenedSetting] = {}
    try:
        for setting in settings:
            setting_id = str(setting["id"])
            rows = setting.get("rows") or {}
            setting_artifacts: list[VerifiedArtifact] = []
            try:
                current = open_verified_artifact(rows.get("current16") or {}, current_dim, "artifact-verification")
                setting_artifacts.append(current)
                complete = open_verified_artifact(rows.get("sourceComplete") or {}, complete_dim, "artifact-verification")
                setting_artifacts.append(complete)
                targets = open_verified_artifact(rows.get("targets") or {}, len(TARGET_ORDER), "artifact-verification")
                setting_artifacts.append(targets)
            except Exception:
                for artifact in setting_artifacts:
                    artifact.close()
                raise
            opened_setting = OpenedSetting(setting, current, complete, targets)
            opened[setting_id] = opened_setting
            if current.array.shape[0] != complete.array.shape[0] or current.array.shape[0] != targets.array.shape[0] or current.array.shape[0] != opened_setting.count:
                raise AssayError("artifact-verification", "feature and target row counts differ", {
                    "settingId": setting_id, "currentRows": current.array.shape[0],
                    "completeRows": complete.array.shape[0], "targetRows": targets.array.shape[0],
                    "declaredRows": opened_setting.count,
                })
            for start, stop in chunks(opened_setting.count, chunk_rows):
                current_chunk = np.asarray(current.array[start:stop]).view(np.uint8).reshape(stop - start, current_dim * 4)
                complete_prefix = np.asarray(complete.array[start:stop, :current_dim]).view(np.uint8).reshape(stop - start, current_dim * 4)
                if not np.array_equal(current_chunk, complete_prefix):
                    raise AssayError("artifact-verification", "Current-16 bytes differ from source-complete prefix", {
                        "settingId": setting_id, "rowStart": start, "rowStop": stop,
                    })
                for role, artifact in (("current16", current), ("sourceComplete", complete), ("targets", targets)):
                    values = np.asarray(artifact.array[start:stop])
                    if not np.all(np.isfinite(values)):
                        bad = np.argwhere(~np.isfinite(values))[0]
                        raise AssayError("artifact-finite", "artifact contains a nonfinite float32 value", {
                            "settingId": setting_id, "artifactRole": role,
                            "row": start + int(bad[0]), "column": int(bad[1]),
                        })
            artifacts = [
                {"semanticRole": artifact.semantic_role, "sha256": artifact.expected_sha256, "bytes": artifact.initial_stat.st_size}
                for artifact in (current, complete, targets)
            ]
            checked.append({"settingId": setting_id, "rows": opened_setting.count, "artifacts": artifacts, "currentPrefixExactBytes": True})
        return opened, {
            "settings": checked,
            "settingCount": len(checked),
            "currentPrefixExactBytes": True,
            "artifactsPostConsumptionVerified": False,
        }
    except Exception:
        for value in opened.values():
            value.close()
        raise


def verify_artifacts_post_consumption(opened: dict[str, OpenedSetting]) -> None:
    for setting_id, setting in opened.items():
        for role, artifact in (("current16", setting.current), ("sourceComplete", setting.source_complete), ("targets", setting.targets)):
            final_stat = os.fstat(artifact.handle.fileno())
            final_sha = sha256_handle(artifact.handle)
            if final_stat.st_size != artifact.initial_stat.st_size or final_sha != artifact.expected_sha256:
                raise AssayError("artifact-post-consumption", "artifact changed after initial verification", {
                    "settingId": setting_id, "artifactRole": role, "path": str(artifact.path),
                    "expectedBytes": artifact.initial_stat.st_size, "actualBytes": final_stat.st_size,
                    "expectedSha256": artifact.expected_sha256, "actualSha256": final_sha,
                })


def chunks(array_rows: int, chunk_rows: int) -> Iterable[tuple[int, int]]:
    for start in range(0, array_rows, chunk_rows):
        yield start, min(array_rows, start + chunk_rows)


def collect_stats(
    by_id: dict[str, OpenedSetting],
    fit_ids: list[str],
    complete_dim: int,
    chunk_rows: int,
) -> tuple[SufficientStats, SufficientStats]:
    membership = SufficientStats(complete_dim, 1)
    optical = SufficientStats(complete_dim, 4)
    for setting_id in fit_ids:
        x = by_id[setting_id].source_complete.array
        targets = by_id[setting_id].targets.array
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


def iter_role_chunks(
    by_id: dict[str, OpenedSetting],
    setting_ids: list[str],
    chunk_rows: int,
) -> Iterable[tuple[str, np.ndarray, np.ndarray]]:
    for setting_id in setting_ids:
        setting = by_id[setting_id]
        for start, stop in chunks(setting.count, chunk_rows):
            yield setting_id, setting.source_complete.array[start:stop], setting.targets.array[start:stop]


def threshold_metrics(
    candidates: np.ndarray,
    by_id: dict[str, OpenedSetting],
    setting_ids: list[str],
    chunk_rows: int,
    indices: np.ndarray,
    mean: np.ndarray,
    std: np.ndarray,
    weights: np.ndarray,
    truth_cut: float,
) -> tuple[float, dict[str, Any]]:
    tp = np.zeros(candidates.size, dtype=np.int64)
    fp = np.zeros(candidates.size, dtype=np.int64)
    fn = np.zeros(candidates.size, dtype=np.int64)
    tn = np.zeros(candidates.size, dtype=np.int64)
    for _, x, targets in iter_role_chunks(by_id, setting_ids, chunk_rows):
        prediction = predict(x, indices, mean, std, weights)[:, 0]
        truth = np.asarray(targets[:, 0] >= truth_cut)
        all_sorted = np.sort(prediction)
        positive_sorted = np.sort(prediction[truth])
        predicted_count = prediction.size - np.searchsorted(all_sorted, candidates, side="left")
        true_positive = positive_sorted.size - np.searchsorted(positive_sorted, candidates, side="left")
        false_positive = predicted_count - true_positive
        false_negative = positive_sorted.size - true_positive
        true_negative = prediction.size - positive_sorted.size - false_positive
        tp += true_positive
        fp += false_positive
        fn += false_negative
        tn += true_negative
    precision = tp / np.maximum(1, tp + fp)
    recall = tp / np.maximum(1, tp + fn)
    f1 = 2 * precision * recall / np.maximum(1.0e-20, precision + recall)
    iou = tp / np.maximum(1, tp + fp + fn)
    keys = [(float(f1[index]), float(iou[index]), -abs(float(candidate) - 0.5), -index) for index, candidate in enumerate(candidates)]
    best_index = max(range(candidates.size), key=lambda index: keys[index])
    return float(candidates[best_index]), {
        "threshold": float(candidates[best_index]),
        "tp": int(tp[best_index]), "fp": int(fp[best_index]),
        "fn": int(fn[best_index]), "tn": int(tn[best_index]),
        "precision": float(precision[best_index]), "recall": float(recall[best_index]),
        "f1": float(f1[best_index]), "iou": float(iou[best_index]),
        "rows": int(tp[best_index] + fp[best_index] + fn[best_index] + tn[best_index]),
        "candidateCount": int(candidates.size),
    }


def view_fit(
    view_name: str,
    indices: np.ndarray,
    membership_stats: SufficientStats,
    optical_stats: SufficientStats,
    mean: np.ndarray,
    std: np.ndarray,
    by_id: dict[str, OpenedSetting],
    calibration_ids: list[str],
    chunk_rows: int,
    alphas: list[float],
) -> dict[str, Any]:
    membership_system, membership_rhs = normalized_system(membership_stats, indices, mean, std)
    optical_system, optical_rhs = normalized_system(optical_stats, indices, mean, std)
    membership_candidates = []
    optical_candidates = []
    for alpha in alphas:
        membership_weights = solve_ridge(membership_system, membership_rhs, membership_stats.count, alpha)
        optical_weights = solve_ridge(optical_system, optical_rhs, optical_stats.count, alpha)
        membership_candidates.append({
            "alpha": alpha, "weights": membership_weights, "metrics": RegressionAccumulator(1),
            "minimum": math.inf, "maximum": -math.inf,
        })
        optical_candidates.append({"alpha": alpha, "weights": optical_weights, "metrics": RegressionAccumulator(4)})
    balance = {"rows": 0, "anyPositive": 0, "strongPositive": 0, "positiveOptical": 0}
    for _, x, targets in iter_role_chunks(by_id, calibration_ids, chunk_rows):
        membership_target = targets[:, 0]
        positive = np.asarray(membership_target > 0.0)
        strong = np.asarray(membership_target >= 0.5)
        balance["rows"] += int(targets.shape[0])
        balance["anyPositive"] += int(np.count_nonzero(positive))
        balance["strongPositive"] += int(np.count_nonzero(strong))
        balance["positiveOptical"] += int(np.count_nonzero(positive))
        for candidate in membership_candidates:
            prediction = predict(x, indices, mean, std, candidate["weights"])[:, 0]
            candidate["metrics"].add(membership_target, prediction)
            candidate["minimum"] = min(candidate["minimum"], float(np.min(prediction)))
            candidate["maximum"] = max(candidate["maximum"], float(np.max(prediction)))
        for candidate in optical_candidates:
            prediction = np.maximum(predict(x, indices, mean, std, candidate["weights"]), 0.0)
            candidate["metrics"].add(targets[positive, 1:5], prediction[positive])
    if (
        balance["anyPositive"] == 0 or balance["anyPositive"] == balance["rows"]
        or balance["strongPositive"] == 0 or balance["strongPositive"] == balance["rows"]
        or balance["positiveOptical"] == 0
    ):
        raise AssayError("calibration-support", "calibration setting must contain both support classes and positive optical rows", balance)
    for candidate in membership_candidates:
        candidate["publicMetrics"] = candidate["metrics"].metrics("calibration-support")
    for candidate in optical_candidates:
        candidate["publicMetrics"] = candidate["metrics"].metrics("calibration-support")
    membership_candidates.sort(key=lambda item: (item["publicMetrics"]["rmseMean"], item["alpha"]))
    optical_candidates.sort(key=lambda item: (item["publicMetrics"]["rmseMean"], item["alpha"]))
    selected_membership = membership_candidates[0]
    selected_optical = optical_candidates[0]
    threshold_candidates = np.linspace(selected_membership["minimum"], selected_membership["maximum"], 513, dtype=np.float64)
    any_threshold, any_calibration = threshold_metrics(
        threshold_candidates, by_id, calibration_ids, chunk_rows, indices, mean, std,
        selected_membership["weights"], np.nextafter(0.0, 1.0),
    )
    strong_threshold, strong_calibration = threshold_metrics(
        threshold_candidates, by_id, calibration_ids, chunk_rows, indices, mean, std,
        selected_membership["weights"], 0.5,
    )
    return {
        "view": view_name,
        "indices": indices,
        "membershipAlpha": selected_membership["alpha"],
        "opticalAlpha": selected_optical["alpha"],
        "membershipWeights": selected_membership["weights"],
        "opticalWeights": selected_optical["weights"],
        "thresholds": {"anySupport": any_threshold, "strongSupport": strong_threshold},
        "calibration": {
            "membership": {"soft": selected_membership["publicMetrics"], "anySupport": any_calibration, "strongSupport": strong_calibration},
            "optical": {"positiveSupport": selected_optical["publicMetrics"]},
            "supportBalance": balance,
        },
        "alphaGrid": {
            "membership": [{"alpha": float(item["alpha"]), "softRmse": float(item["publicMetrics"]["rmseMean"])} for item in membership_candidates],
            "optical": [{"alpha": float(item["alpha"]), "positiveSupportRmseMean": float(item["publicMetrics"]["rmseMean"])} for item in optical_candidates],
        },
    }


def evaluate_view(
    fitted: dict[str, Any],
    by_id: dict[str, OpenedSetting],
    setting_ids: list[str],
    chunk_rows: int,
    mean: np.ndarray,
    std: np.ndarray,
) -> dict[str, Any]:
    membership_soft = RegressionAccumulator(1)
    optical_all = RegressionAccumulator(4)
    optical_positive = RegressionAccumulator(4)
    optical_gated = RegressionAccumulator(4)
    any_metrics = ClassificationAccumulator(fitted["thresholds"]["anySupport"])
    strong_metrics = ClassificationAccumulator(fitted["thresholds"]["strongSupport"])
    rows = 0
    positive_rows = 0
    for _, x, targets in iter_role_chunks(by_id, setting_ids, chunk_rows):
        membership_prediction = predict(x, fitted["indices"], mean, std, fitted["membershipWeights"])[:, 0]
        optical_prediction = np.maximum(predict(x, fitted["indices"], mean, std, fitted["opticalWeights"]), 0.0)
        positive = np.asarray(targets[:, 0] > 0.0)
        predicted_any = np.asarray(membership_prediction >= fitted["thresholds"]["anySupport"])
        membership_soft.add(targets[:, 0], membership_prediction)
        any_metrics.add(positive, membership_prediction)
        strong_metrics.add(targets[:, 0] >= 0.5, membership_prediction)
        optical_all.add(targets[:, 1:5], optical_prediction)
        optical_positive.add(targets[positive, 1:5], optical_prediction[positive])
        optical_gated.add(targets[:, 1:5], optical_prediction * predicted_any[:, None])
        rows += int(targets.shape[0])
        positive_rows += int(np.count_nonzero(positive))
    if rows == 0:
        raise AssayError("heldout-support", "held-out role has zero rows")
    if positive_rows == 0:
        raise AssayError("heldout-support", "held-out role has zero positive membership rows", {"settingIds": setting_ids, "rows": rows})
    return {
        "membership": {
            "soft": membership_soft.metrics("heldout-support"),
            "anySupport": any_metrics.metrics(),
            "strongSupport": strong_metrics.metrics(),
        },
        "optical": {
            "allRows": optical_all.metrics("heldout-support"),
            "positiveSupport": optical_positive.metrics("heldout-support"),
            "predictedAnySupportGated": optical_gated.metrics("heldout-support"),
        },
        "rows": rows,
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


def implementation_provenance() -> dict[str, Any]:
    script_path = Path(__file__).resolve()
    try:
        git_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=script_path.parent, check=True,
            capture_output=True, text=True,
        ).stdout.strip()
        git_status = subprocess.run(
            ["git", "status", "--porcelain", "--", str(script_path)], cwd=script_path.parent,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise AssayError("implementation-provenance", f"cannot resolve git implementation provenance: {error}") from error
    if len(git_commit) != 40:
        raise AssayError("implementation-provenance", "git commit is not a full 40-character identity", {"gitCommit": git_commit})
    return {
        "script": str(script_path),
        "scriptSha256": sha256_file(script_path),
        "gitCommit": git_commit,
        "scriptDirty": bool(git_status),
        "pythonVersion": platform.python_version(),
        "numpyVersion": np.__version__,
        "platform": {
            "system": platform.system(), "release": platform.release(),
            "machine": platform.machine(), "node": platform.node(),
        },
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    corpus_path = Path(args.corpus_manifest).resolve()
    prepare_output(out_dir)
    started = time.perf_counter()
    opened: dict[str, OpenedSetting] = {}
    try:
        if args.chunk_rows <= 0:
            raise AssayError("arguments", "chunk rows must be positive")
        alphas = parse_alphas(args.ridge_alphas)
        expected_manifest_sha = args.corpus_manifest_sha256.lower()
        try:
            manifest_bytes = corpus_path.read_bytes()
        except OSError as error:
            raise AssayError("corpus-manifest-read", f"cannot read corpus manifest: {error}", {"path": str(corpus_path)}) from error
        actual_manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
        if actual_manifest_sha != expected_manifest_sha:
            raise AssayError("corpus-manifest-checksum", "corpus manifest SHA-256 mismatch", {
                "expectedSha256": expected_manifest_sha,
                "actualSha256": actual_manifest_sha,
            })
        try:
            corpus = json.loads(manifest_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise AssayError("corpus-manifest-parse", f"cannot parse corpus manifest snapshot: {error}") from error
        settings, fit_ids, held_ids, calibration_id = validate_manifest(corpus, args.calibration_setting)
        current_order = list(corpus["featureViews"]["current16"]["order"])
        complete_order = list(corpus["featureViews"]["sourceComplete"]["order"])
        current_dim = len(current_order)
        complete_dim = len(complete_order)
        opened, verification = open_and_verify_artifacts(settings, current_dim, complete_dim, args.chunk_rows)
        membership_stats, optical_stats = collect_stats(opened, fit_ids, complete_dim, args.chunk_rows)
        mean, std, constant_features = feature_scale(membership_stats)
        current_indices = np.arange(current_dim, dtype=np.int64)
        complete_indices = np.arange(complete_dim, dtype=np.int64)
        current_fit = view_fit(
            "current16", current_indices, membership_stats, optical_stats, mean, std,
            opened, [calibration_id], args.chunk_rows, alphas,
        )
        complete_fit = view_fit(
            "sourceComplete", complete_indices, membership_stats, optical_stats, mean, std,
            opened, [calibration_id], args.chunk_rows, alphas,
        )
        current_metrics = evaluate_view(current_fit, opened, held_ids, args.chunk_rows, mean, std)
        complete_metrics = evaluate_view(complete_fit, opened, held_ids, args.chunk_rows, mean, std)
        ablations = []
        for ablation in corpus.get("ablations") or []:
            index = int(ablation.get("sourceCompleteIndex", -1))
            channel = str(ablation.get("channel") or "")
            if index < current_dim or index >= complete_dim or complete_order[index] != channel:
                raise AssayError("ablation-contract", "drop-one ablation index/channel mismatch", {"ablation": ablation})
            indices = np.asarray([value for value in range(complete_dim) if value != index], dtype=np.int64)
            fitted = view_fit(
                f"sourceComplete-minus-{channel}", indices, membership_stats, optical_stats, mean, std,
                opened, [calibration_id], args.chunk_rows, alphas,
            )
            metrics = evaluate_view(fitted, opened, held_ids, args.chunk_rows, mean, std)
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
        verify_artifacts_post_consumption(opened)
        verification["artifactsPostConsumptionVerified"] = True
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
        rows_by_id = {setting_id: setting.count for setting_id, setting in opened.items()}
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
                "corpusManifestRead": "single-byte-snapshot-v0",
                "corpusIdentity": corpus["identity"],
                "corpusAuthority": corpus.get("authority"),
                "implementation": implementation_provenance(),
            },
            "rows": {
                "policy": "all-rows-streamed-uncapped-v0",
                "evaluationMode": "chunk-streamed-no-full-role-materialization-v0",
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
                "calibrationSelection": "lexical-last-nonblack-train-setting-v0",
            },
            "views": {
                "current16": public_view(current_fit, current_metrics, current_metrics["rows"]),
                "sourceComplete": public_view(complete_fit, complete_metrics, complete_metrics["rows"]),
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
    finally:
        for setting in opened.values():
            setting.close()


if __name__ == "__main__":
    raise SystemExit(main())
