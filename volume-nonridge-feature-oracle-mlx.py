#!/usr/bin/env python3
"""Compare Current-16 with source-complete Non-Ridge evidence under one MLX oracle."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
import struct
import sys
import time
import zlib
from pathlib import Path
from typing import Any, Iterator

import numpy as np


INPUT_SCHEMA = "kaminos.volume.nonridge-source-basis-corpus.v0"
RESULT_SCHEMA = "kaminos.volume.nonridge-feature-oracle.v0"
FAILURE_SCHEMA = "kaminos.volume.nonridge-feature-oracle-failure.v0"
VISUAL_SCHEMA = "kaminos.volume.nonridge-feature-oracle-visuals.v0"
GRID_AXIS_IDENTITY = "x-fastest-y-then-z-v0"
CURRENT16_IDENTITY = "live-boundary-candidate-current16-v0"
SOURCE_COMPLETE_IDENTITY = "current16-plus-independent-source-evidence-v0"
SPLIT_IDENTITY = "whole-effective-control-setting-holdout-v0"
MEMORIZATION_IDENTITY = "same-state-memorization-v0"
CURRENT16 = [
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.density", "material.heat", "material.fuel", "material.detail",
    "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
    "micro.x", "micro.y", "micro.z", "micro.w",
]
SOURCE_COMPLETE_ADDITIONS = [
    "front.topology", "velocity.x", "velocity.y", "velocity.z",
    "support.reaction", "support.interface", "flow.curlMagnitude", "flow.divergence",
]
TARGETS = [
    "candidate.nonRidgeMembership",
    "nonRidge.emission.r",
    "nonRidge.emission.g",
    "nonRidge.emission.b",
    "nonRidge.extinction",
]
ARTIFACT_ROLES = {
    "current16": "candidate-features-current16",
    "sourceComplete": "candidate-features-source-complete",
    "targets": "supervision-targets-positive-nonridge",
}


class OracleError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise OracleError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def write_rgb_png(path: Path, pixels: np.ndarray) -> dict[str, Any]:
    require(pixels.ndim == 3 and pixels.shape[2] == 3, "PNG pixels must have HxWx3 shape")
    require(pixels.dtype == np.uint8, "PNG pixels must be uint8")
    height, width, _ = pixels.shape
    require(width > 0 and height > 0, "PNG dimensions must be positive")
    raw = b"".join(b"\x00" + pixels[row].tobytes(order="C") for row in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    encoded = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", zlib.compress(raw, level=9)) + png_chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(encoded)
    os.replace(temporary, path)
    return {"path": str(path), "bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest(), "width": width, "height": height}


def artifact_path(manifest_dir: Path, artifact: dict[str, Any]) -> Path:
    raw_path = artifact.get("path")
    require(isinstance(raw_path, str) and raw_path, "artifact path must be a non-empty string")
    path = Path(raw_path)
    return path.resolve() if path.is_absolute() else (manifest_dir / path).resolve()


def validate_artifact(
    manifest_dir: Path,
    artifact_value: Any,
    expected_shape: list[int],
    expected_role: str,
    label: str,
) -> dict[str, Any]:
    require(isinstance(artifact_value, dict), f"{label} must be an object")
    artifact = artifact_value
    require(artifact.get("dtype") == "float32-le", f"{label}.dtype must be float32-le")
    require(artifact.get("semanticRole") == expected_role, f"{label}.semanticRole must be {expected_role}")
    require(artifact.get("shape") == expected_shape, f"{label}.shape must equal {expected_shape}")
    expected_bytes = math.prod(expected_shape) * 4
    require(artifact.get("bytes") == expected_bytes, f"{label}.bytes must equal {expected_bytes}")
    declared_sha = artifact.get("sha256")
    require(isinstance(declared_sha, str) and len(declared_sha) == 64, f"{label}.sha256 must be SHA-256")
    path = artifact_path(manifest_dir, artifact)
    require(path.is_file(), f"{label} is missing: {path}")
    require(path.stat().st_size == expected_bytes, f"{label} byte count differs from its shape")
    observed_sha = sha256_file(path)
    require(observed_sha == declared_sha, f"{label} sha256 mismatch: declared {declared_sha}, actual {observed_sha}")
    values = np.memmap(path, dtype="<f4", mode="r", shape=tuple(expected_shape))
    chunk_rows = max(1, min(expected_shape[0], 262144))
    for start in range(0, expected_shape[0], chunk_rows):
        require(np.isfinite(values[start:start + chunk_rows]).all(), f"{label} contains non-finite values")
    return {
        "path": str(path),
        "bytes": expected_bytes,
        "sha256": declared_sha,
        "dtype": "float32-le",
        "shape": expected_shape,
        "semanticRole": expected_role,
    }


def validate_manifest(manifest: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    require(manifest.get("schema") == INPUT_SCHEMA, f"input schema must be {INPUT_SCHEMA}")
    require(manifest.get("status") == "complete", "input corpus status must be complete")
    require(manifest.get("authority") == "checksum-bound-randomized-nonridge-source-basis-v0", "input authority mismatch")
    cohort = manifest.get("cohort")
    require(isinstance(cohort, dict), "cohort must be an object")
    require(cohort.get("identity") == "full-grid", "cohort must retain the full grid")
    require(cohort.get("sampleCap") is None, "cohort sampleCap must remain null")
    require(cohort.get("droppedRowCount") == 0, "cohort must not drop rows")
    views = manifest.get("featureViews")
    require(isinstance(views, dict), "featureViews must be an object")
    current = views.get("current16")
    source_complete = views.get("sourceComplete")
    require(isinstance(current, dict) and current.get("identity") == CURRENT16_IDENTITY, "Current-16 identity mismatch")
    require(current.get("order") == CURRENT16, "Current-16 channel order mismatch")
    require(isinstance(source_complete, dict) and source_complete.get("identity") == SOURCE_COMPLETE_IDENTITY, "source-complete identity mismatch")
    require(source_complete.get("order") == [*CURRENT16, *SOURCE_COMPLETE_ADDITIONS], "source-complete channel order mismatch")
    target_contract = manifest.get("targets")
    require(isinstance(target_contract, dict) and target_contract.get("order") == TARGETS, "target order mismatch")
    controls = manifest.get("controls")
    require(isinstance(controls, dict) and controls.get("conditionedArm") is None, "first assay must not condition on controls")
    frozen_authority = manifest.get("frozenAuthority")
    require(isinstance(frozen_authority, dict), "frozenAuthority must be an object")
    grid_shape = frozen_authority.get("gridShape")
    require(
        isinstance(grid_shape, list)
        and len(grid_shape) == 3
        and all(isinstance(dimension, int) and dimension > 0 for dimension in grid_shape),
        "frozenAuthority.gridShape must contain three positive integers",
    )
    require(frozen_authority.get("gridAxisOrder") == GRID_AXIS_IDENTITY, f"frozenAuthority.gridAxisOrder must be {GRID_AXIS_IDENTITY}")
    grid_row_count = math.prod(grid_shape)
    split_contract = manifest.get("splits")
    require(isinstance(split_contract, dict) and split_contract.get("identity") == SPLIT_IDENTITY, "split identity mismatch")
    train_ids = sorted((split_contract.get("train") or {}).get("settingIds") or [])
    held_ids = sorted((split_contract.get("heldOut") or {}).get("settingIds") or [])
    require(train_ids and held_ids, "train and held-out setting cohorts must both be non-empty")
    require(not set(train_ids) & set(held_ids), "train and held-out setting ids overlap")
    settings_value = manifest.get("settings")
    require(isinstance(settings_value, list) and settings_value, "settings must be a non-empty list")
    require(cohort.get("retainedSettingCount") == len(settings_value), "retainedSettingCount differs from settings")
    manifest_dir = manifest_path.parent
    settings = []
    validated_artifact_count = 0
    total_rows = 0
    seen_ids: set[str] = set()
    for index, setting_value in enumerate(settings_value):
        require(isinstance(setting_value, dict), f"settings[{index}] must be an object")
        setting_id = setting_value.get("id")
        require(isinstance(setting_id, str) and setting_id, f"settings[{index}].id must be non-empty")
        require(setting_id not in seen_ids, f"duplicate setting id {setting_id}")
        seen_ids.add(setting_id)
        split_role = setting_value.get("splitRole")
        expected_role = "train" if setting_id in train_ids else "heldOut" if setting_id in held_ids else None
        require(expected_role is not None, f"setting {setting_id} is absent from the whole-setting split")
        require(split_role == expected_role, f"setting {setting_id} splitRole mismatch")
        rows = setting_value.get("rows")
        require(isinstance(rows, dict), f"setting {setting_id}.rows must be an object")
        row_count = rows.get("count")
        require(isinstance(row_count, int) and row_count > 0, f"setting {setting_id}.rows.count must be positive")
        require(row_count == grid_row_count, f"setting {setting_id}.rows.count must equal gridShape product {grid_row_count}")
        negative_control = setting_value.get("negativeControl")
        require(isinstance(negative_control, bool), f"setting {setting_id}.negativeControl must be boolean")
        normalized_rows = {}
        for role, channel_count in (("current16", len(CURRENT16)), ("sourceComplete", len(CURRENT16) + len(SOURCE_COMPLETE_ADDITIONS)), ("targets", len(TARGETS))):
            normalized_rows[role] = validate_artifact(
                manifest_dir,
                rows.get(role),
                [row_count, channel_count],
                ARTIFACT_ROLES[role],
                f"settings[{index}].rows.{role}",
            )
            validated_artifact_count += 1
        current_values = np.memmap(normalized_rows["current16"]["path"], dtype="<f4", mode="r", shape=(row_count, len(CURRENT16)))
        source_values = np.memmap(normalized_rows["sourceComplete"]["path"], dtype="<f4", mode="r", shape=(row_count, len(CURRENT16) + len(SOURCE_COMPLETE_ADDITIONS)))
        target_values = np.memmap(normalized_rows["targets"]["path"], dtype="<f4", mode="r", shape=(row_count, len(TARGETS)))
        positive_membership_rows = 0
        negative_membership_rows = 0
        positive_optical_rows = 0
        all_targets_zero = True
        for start in range(0, row_count, 262144):
            stop = min(row_count, start + 262144)
            require(np.array_equal(current_values[start:stop], source_values[start:stop, :len(CURRENT16)]), f"setting {setting_id} source-complete prefix differs from Current-16")
            target_chunk = target_values[start:stop]
            membership = target_chunk[:, 0]
            optical = target_chunk[:, 1:]
            require(np.all((membership >= 0.0) & (membership <= 1.0)), f"setting {setting_id} membership targets must be within [0, 1]")
            require(np.all(optical >= 0.0), f"setting {setting_id} optical targets must be nonnegative")
            positive_membership_rows += int(np.count_nonzero(membership > 0.0))
            negative_membership_rows += int(np.count_nonzero(membership == 0.0))
            positive_optical_rows += int(np.count_nonzero(np.any(optical > 0.0, axis=1)))
            all_targets_zero = all_targets_zero and bool(np.all(target_chunk == 0.0))
        if negative_control:
            require(all_targets_zero, f"negative-control setting {setting_id} contains positive target evidence")
        else:
            require(positive_membership_rows > 0 and positive_optical_rows > 0, f"positive setting {setting_id} lacks membership or optical evidence")
        target_summary = {
            "positiveMembershipRows": positive_membership_rows,
            "negativeMembershipRows": negative_membership_rows,
            "positiveOpticalRows": positive_optical_rows,
            "allTargetsZero": all_targets_zero,
        }
        settings.append({
            "id": setting_id,
            "splitRole": split_role,
            "negativeControl": negative_control,
            "rows": {"count": row_count, **normalized_rows},
            "targetSummary": target_summary,
        })
        total_rows += row_count
    require(seen_ids == set(train_ids) | set(held_ids), "split ledgers and settings differ")
    require(cohort.get("totalRows") == total_rows, "cohort totalRows differs from retained settings")
    split_coverage = {}
    for split_role in ("train", "heldOut"):
        split_settings = [setting for setting in settings if setting["splitRole"] == split_role]
        summary = {
            key: sum(setting["targetSummary"][key] for setting in split_settings)
            for key in ("positiveMembershipRows", "negativeMembershipRows", "positiveOpticalRows")
        }
        require(all(value > 0 for value in summary.values()), f"{split_role} split lacks positive/negative membership or positive optical evidence: {summary}")
        split_coverage[split_role] = summary
    return {
        "identity": manifest.get("identity"),
        "cohort": {
            "identity": "full-grid",
            "retainedSettingCount": len(settings),
            "totalRows": total_rows,
            "droppedRowCount": 0,
            "sampleCap": None,
        },
        "featureViews": {
            "current16": {"identity": CURRENT16_IDENTITY, "order": CURRENT16, "channelCount": len(CURRENT16)},
            "sourceComplete": {"identity": SOURCE_COMPLETE_IDENTITY, "order": [*CURRENT16, *SOURCE_COMPLETE_ADDITIONS], "channelCount": len(CURRENT16) + len(SOURCE_COMPLETE_ADDITIONS)},
        },
        "targets": {"order": TARGETS, "channelCount": len(TARGETS)},
        "gridShape": grid_shape,
        "gridAxisOrder": GRID_AXIS_IDENTITY,
        "splits": {
            "identity": SPLIT_IDENTITY,
            "targetCoverage": split_coverage,
            "train": {"settingIds": train_ids},
            "heldOut": {"settingIds": held_ids},
        },
        "settings": settings,
        "validatedArtifactCount": validated_artifact_count,
    }


def map_array(setting: dict[str, Any], role: str, channel_count: int) -> np.memmap:
    rows = setting["rows"]
    return np.memmap(rows[role]["path"], dtype="<f4", mode="r", shape=(rows["count"], channel_count))


def setting_batches(
    settings: list[dict[str, Any]],
    feature_role: str,
    feature_count: int,
    batch_size: int,
    rng: np.random.Generator | None,
) -> Iterator[tuple[np.ndarray, np.ndarray]]:
    order = np.arange(len(settings))
    if rng is not None:
        rng.shuffle(order)
    for setting_index in order:
        setting = settings[int(setting_index)]
        features = map_array(setting, feature_role, feature_count)
        targets = map_array(setting, "targets", len(TARGETS))
        row_order = np.arange(setting["rows"]["count"])
        if rng is not None:
            rng.shuffle(row_order)
        for start in range(0, row_order.size, batch_size):
            indices = row_order[start:start + batch_size]
            yield np.asarray(features[indices], dtype=np.float32), np.asarray(targets[indices], dtype=np.float32)


def streaming_normalization(
    settings: list[dict[str, Any]],
    feature_role: str,
    feature_count: int,
    batch_size: int,
) -> dict[str, np.ndarray | float | int]:
    feature_sum = np.zeros(feature_count, dtype=np.float64)
    feature_square_sum = np.zeros(feature_count, dtype=np.float64)
    optical_max = np.zeros(len(TARGETS) - 1, dtype=np.float64)
    target_sum = np.zeros(len(TARGETS), dtype=np.float64)
    row_count = 0
    positive_count = 0
    for features, targets in setting_batches(settings, feature_role, feature_count, batch_size, None):
        feature_sum += features.sum(axis=0, dtype=np.float64)
        feature_square_sum += np.square(features, dtype=np.float64).sum(axis=0, dtype=np.float64)
        optical_max = np.maximum(optical_max, targets[:, 1:].max(axis=0))
        target_sum += targets.sum(axis=0, dtype=np.float64)
        row_count += features.shape[0]
        positive_count += int(np.count_nonzero(targets[:, 0] > 0.0))
    require(row_count > 0, "training split has no rows")
    feature_mean = feature_sum / row_count
    feature_variance = np.maximum(feature_square_sum / row_count - feature_mean * feature_mean, 1e-12)
    feature_std = np.sqrt(feature_variance)
    optical_scale = np.maximum(optical_max, 1e-6)
    positive_fraction = positive_count / row_count
    require(positive_count > 0 and positive_count < row_count, "training rows need both positive and negative membership")
    return {
        "featureMean": feature_mean.astype(np.float32),
        "featureStd": feature_std.astype(np.float32),
        "opticalScale": optical_scale.astype(np.float32),
        "targetMean": (target_sum / row_count).astype(np.float32),
        "rowCount": row_count,
        "positiveCount": positive_count,
        "positiveFraction": positive_fraction,
        "positiveWeight": min((row_count - positive_count) / positive_count, 256.0),
    }


def normalized_batch(features: np.ndarray, targets: np.ndarray, normalization: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    normalized_features = (features - normalization["featureMean"]) / normalization["featureStd"]
    normalized_targets = targets.copy()
    normalized_targets[:, 1:] /= normalization["opticalScale"]
    return normalized_features.astype(np.float32), normalized_targets.astype(np.float32)


def train_model(
    settings: list[dict[str, Any]],
    feature_role: str,
    feature_count: int,
    hidden_size: int,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    seed: int,
    output_path: Path,
) -> tuple[Any, dict[str, Any], list[dict[str, float | int]]]:
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    from mlx.utils import tree_flatten

    class FeatureOracle(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.layers = [
                nn.Linear(feature_count, hidden_size),
                nn.Linear(hidden_size, hidden_size),
                nn.Linear(hidden_size, len(TARGETS)),
            ]

        def __call__(self, values: Any) -> Any:
            values = nn.silu(self.layers[0](values))
            values = nn.silu(self.layers[1](values))
            return self.layers[2](values)

    mx.random.seed(seed)
    rng = np.random.default_rng(seed)
    normalization = streaming_normalization(settings, feature_role, feature_count, batch_size)
    model = FeatureOracle()
    mx.eval(model.parameters())
    optimizer = optim.AdamW(learning_rate=learning_rate, weight_decay=1e-5)
    positive_weight = float(normalization["positiveWeight"])

    def loss_fn(active_model: Any, batch_features: Any, batch_targets: Any) -> Any:
        logits = active_model(batch_features)
        membership = mx.sigmoid(logits[:, 0])
        optical = mx.sigmoid(logits[:, 1:])
        truth_membership = batch_targets[:, 0]
        truth_optical = batch_targets[:, 1:]
        epsilon = 1e-6
        membership_loss = -mx.mean(
            positive_weight * truth_membership * mx.log(membership + epsilon)
            + (1.0 - truth_membership) * mx.log(1.0 - membership + epsilon)
        )
        optical_weight = 1.0 + truth_membership[:, None] * positive_weight
        optical_loss = mx.mean(optical_weight * mx.square(optical - truth_optical))
        return membership_loss + optical_loss

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    trace = []
    batches_seen = 0
    rows_seen = 0
    for epoch in range(epochs):
        loss_sum = 0.0
        epoch_batches = 0
        epoch_rows = 0
        for features, targets in setting_batches(settings, feature_role, feature_count, batch_size, rng):
            features, targets = normalized_batch(features, targets, normalization)
            loss, gradients = loss_and_grad(model, mx.array(features), mx.array(targets))
            optimizer.update(model, gradients)
            mx.eval(model.parameters(), optimizer.state, loss)
            loss_sum += float(loss.item())
            epoch_batches += 1
            epoch_rows += features.shape[0]
        require(epoch_rows == normalization["rowCount"], "training epoch did not consume every retained train row")
        batches_seen += epoch_batches
        rows_seen += epoch_rows
        trace.append({"epoch": epoch + 1, "meanLoss": loss_sum / max(epoch_batches, 1), "batches": epoch_batches, "rows": epoch_rows})
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mx.save_safetensors(str(output_path), dict(tree_flatten(model.parameters())))
    normalization_receipt = {
        "featureMean": normalization["featureMean"].tolist(),
        "featureStd": normalization["featureStd"].tolist(),
        "opticalScale": normalization["opticalScale"].tolist(),
        "targetMean": normalization["targetMean"].tolist(),
        "rowCount": normalization["rowCount"],
        "positiveCount": normalization["positiveCount"],
        "positiveFraction": normalization["positiveFraction"],
        "positiveWeight": normalization["positiveWeight"],
        "epochs": epochs,
        "rowsSeen": rows_seen,
        "batchesSeen": batches_seen,
    }
    return model, {"arrays": normalization, "receipt": normalization_receipt}, trace


def evaluate_model(
    model: Any,
    normalization: dict[str, Any],
    settings: list[dict[str, Any]],
    feature_role: str,
    feature_count: int,
    batch_size: int,
) -> dict[str, Any]:
    import mlx.core as mx

    squared = np.zeros(len(TARGETS), dtype=np.float64)
    absolute = np.zeros(len(TARGETS), dtype=np.float64)
    true_sum = np.zeros(len(TARGETS), dtype=np.float64)
    predicted_sum = np.zeros(len(TARGETS), dtype=np.float64)
    row_count = 0
    true_positive = 0
    false_positive = 0
    false_negative = 0
    positive_rows = 0
    positive_membership_sum = 0.0
    for features, targets in setting_batches(settings, feature_role, feature_count, batch_size, None):
        normalized_features, _ = normalized_batch(features, targets, normalization)
        logits = model(mx.array(normalized_features))
        predictions = np.asarray(mx.concatenate([mx.sigmoid(logits[:, :1]), mx.sigmoid(logits[:, 1:])], axis=1))
        predictions[:, 1:] *= normalization["opticalScale"]
        delta = predictions - targets
        squared += np.square(delta, dtype=np.float64).sum(axis=0)
        absolute += np.abs(delta, dtype=np.float64).sum(axis=0)
        true_sum += targets.sum(axis=0, dtype=np.float64)
        predicted_sum += predictions.sum(axis=0, dtype=np.float64)
        truth_positive = targets[:, 0] > 0.0
        predicted_positive = predictions[:, 0] >= 0.5
        true_positive += int(np.count_nonzero(truth_positive & predicted_positive))
        false_positive += int(np.count_nonzero(~truth_positive & predicted_positive))
        false_negative += int(np.count_nonzero(truth_positive & ~predicted_positive))
        positive_rows += int(np.count_nonzero(truth_positive))
        positive_membership_sum += float(predictions[truth_positive, 0].sum())
        row_count += targets.shape[0]
    require(row_count > 0, "evaluation split has no rows")
    precision = true_positive / max(true_positive + false_positive, 1)
    recall = true_positive / max(true_positive + false_negative, 1)
    per_target = {}
    for index, name in enumerate(TARGETS):
        per_target[name] = {
            "mse": float(squared[index] / row_count),
            "mae": float(absolute[index] / row_count),
            "truthSum": float(true_sum[index]),
            "predictionSum": float(predicted_sum[index]),
            "energyRecoveryFraction": float(predicted_sum[index] / true_sum[index]) if true_sum[index] > 0 else None,
        }
    return {
        "rowCount": row_count,
        "settingIds": sorted(setting["id"] for setting in settings),
        "perTarget": per_target,
        "membership": {
            "truePositive": true_positive,
            "falsePositive": false_positive,
            "falseNegative": false_negative,
            "precision": precision,
            "recall": recall,
            "f1": 2 * precision * recall / max(precision + recall, 1e-12),
            "positiveRowCount": positive_rows,
            "meanPredictedMembershipOnPositiveRows": positive_membership_sum / max(positive_rows, 1),
        },
        "opticalMeanMse": float(np.mean(squared[1:] / row_count)),
        "opticalMeanMae": float(np.mean(absolute[1:] / row_count)),
    }


def predict_setting(
    model: Any,
    normalization: dict[str, Any],
    setting: dict[str, Any],
    feature_role: str,
    feature_count: int,
    batch_size: int,
) -> np.ndarray:
    import mlx.core as mx

    features = map_array(setting, feature_role, feature_count)
    predictions = np.empty((setting["rows"]["count"], len(TARGETS)), dtype=np.float32)
    for start in range(0, predictions.shape[0], batch_size):
        stop = min(predictions.shape[0], start + batch_size)
        batch = (np.asarray(features[start:stop], dtype=np.float32) - normalization["featureMean"]) / normalization["featureStd"]
        logits = model(mx.array(batch.astype(np.float32)))
        output = np.asarray(mx.sigmoid(logits), dtype=np.float32)
        output[:, 1:] *= normalization["opticalScale"]
        predictions[start:stop] = output
    return predictions


def grid_volume(values: np.ndarray, grid_shape: list[int]) -> np.ndarray:
    grid_x, grid_y, grid_z = grid_shape
    require(values.shape == (grid_x * grid_y * grid_z, len(TARGETS)), "visual values do not match the validated grid")
    return values.reshape((grid_z, grid_y, grid_x, len(TARGETS)))


def projection_axis(axis: str) -> int:
    return {"x": 2, "y": 1, "z": 0}[axis]


def target_projection_scale(truth_volume: np.ndarray, modality: str, axis: str) -> float:
    spatial_axis = projection_axis(axis)
    if modality == "membership":
        return 1.0
    if modality == "emission":
        projected = np.max(truth_volume[..., 1:4], axis=spatial_axis)
    else:
        projected = np.sum(truth_volume[..., 4], axis=spatial_axis)
    positive = projected[projected > 0.0]
    if positive.size == 0:
        return 1.0
    reference = float(np.quantile(positive, 0.995))
    return -math.log(0.1) / max(reference, 1e-8)


def projected_rgb(volume: np.ndarray, modality: str, axis: str, display_scale: float) -> np.ndarray:
    spatial_axis = projection_axis(axis)
    if modality == "membership":
        projected = np.max(volume[..., 0], axis=spatial_axis)
        rgb = np.repeat(np.clip(projected, 0.0, 1.0)[..., None], 3, axis=2)
    elif modality == "emission":
        projected = np.max(volume[..., 1:4], axis=spatial_axis)
        rgb = 1.0 - np.exp(-np.maximum(projected, 0.0) * display_scale)
    elif modality == "extinction":
        projected = np.sum(np.maximum(volume[..., 4], 0.0), axis=spatial_axis)
        grayscale = 1.0 - np.exp(-projected * display_scale)
        rgb = np.repeat(grayscale[..., None], 3, axis=2)
    else:
        raise OracleError(f"unknown visual modality {modality}")
    return np.rint(np.clip(rgb, 0.0, 1.0) * 255.0).astype(np.uint8)


def render_visual_role(
    out_dir: Path,
    setting: dict[str, Any],
    role: str,
    values: np.ndarray,
    truth_values: np.ndarray,
    grid_shape: list[int],
) -> list[dict[str, Any]]:
    volume = grid_volume(values, grid_shape)
    truth_volume = grid_volume(truth_values, grid_shape)
    safe_setting_id = "".join(character if character.isalnum() or character in "-_" else "_" for character in setting["id"])
    records = []
    for modality in ("membership", "emission", "extinction"):
        for axis in ("x", "y", "z"):
            display_scale = target_projection_scale(truth_volume, modality, axis)
            pixels = projected_rgb(volume, modality, axis, display_scale)
            image_path = out_dir / "visuals" / safe_setting_id / f"{role}-{modality}-{axis}.png"
            artifact = write_rgb_png(image_path, pixels)
            records.append({
                "settingId": setting["id"],
                "role": role,
                "modality": modality,
                "axis": axis,
                "displayScale": display_scale,
                "displayScaleAuthority": "truth-derived-shared-across-roles-v0",
                **artifact,
            })
    return records


def write_visual_html(path: Path, images: list[dict[str, Any]], setting_ids: list[str], required_roles: list[str]) -> dict[str, Any]:
    image_lookup = {(image["settingId"], image["role"], image["modality"], image["axis"]): image for image in images}
    cards = []
    for setting_id in setting_ids:
        for modality in ("membership", "emission", "extinction"):
            for axis in ("x", "y", "z"):
                role_images = []
                for role in required_roles:
                    image = image_lookup[(setting_id, role, modality, axis)]
                    relative_path = os.path.relpath(image["path"], path.parent)
                    role_images.append(
                        f'<figure data-role="{html.escape(role)}"><img src="{html.escape(relative_path)}" alt="{html.escape(role)} {html.escape(modality)} {axis}"><figcaption>{html.escape(role)}</figcaption></figure>'
                    )
                cards.append(
                    f'<section><h2>{html.escape(setting_id)} · {html.escape(modality)} · {axis}</h2><div class="roles">{"".join(role_images)}</div></section>'
                )
    role_buttons = "".join(f'<button data-role-button="{html.escape(role)}">{html.escape(role)}</button>' for role in required_roles)
    document = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Non-Ridge feature oracle native-grid witness</title>
<style>
body{{background:#0b0d10;color:#f2f4f8;font-family:system-ui;margin:24px}}button{{margin:0 8px 16px 0;padding:8px 12px}}section{{border-top:1px solid #39404a;padding:16px 0}}.roles{{display:flex;gap:16px;flex-wrap:wrap}}figure{{margin:0}}img{{image-rendering:pixelated;min-width:240px;max-width:40vw;background:#000}}figcaption{{text-align:center;margin-top:4px}}.native img{{min-width:0;max-width:none}}
</style></head><body><h1>Native-grid Non-Ridge oracle witness</h1>
<p>Checksum-bound grid projections only; not a screen-space raymarch or product-beauty claim.</p>
<div>{role_buttons}<button id="scale">toggle native / enlarged</button></div>{''.join(cards)}
<script>
for(const button of document.querySelectorAll('[data-role-button]')){{button.onclick=()=>{{const role=button.dataset.roleButton;for(const figure of document.querySelectorAll('[data-role]')){{figure.hidden=figure.dataset.role!==role}}}}}}
document.querySelector('#scale').onclick=()=>document.body.classList.toggle('native');
</script></body></html>"""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(document, encoding="utf-8")
    os.replace(temporary, path)
    return {"htmlPath": str(path), "htmlSha256": sha256_file(path)}


def visual_receipt(
    out_dir: Path,
    validated: dict[str, Any],
    setting_ids: list[str],
    required_roles: list[str],
    images: list[dict[str, Any]],
) -> dict[str, Any]:
    expected_count = len(setting_ids) * len(required_roles) * 3 * 3
    require(len(images) == expected_count, f"visual witness is partial: expected {expected_count} images, found {len(images)}")
    for image in images:
        path = Path(image["path"])
        require(path.is_file(), f"visual witness image is missing: {path}")
        require(path.stat().st_size == image["bytes"], f"visual witness image byte count changed: {path}")
        require(sha256_file(path) == image["sha256"], f"visual witness image checksum changed: {path}")
    html_receipt = write_visual_html(out_dir / "visuals" / "index.html", images, setting_ids, required_roles)
    return {
        "schema": VISUAL_SCHEMA,
        "authority": "checksum-bound-native-grid-projection-diagnostic-v0",
        "scopeDisclaimer": "Grid projections diagnose retained source structure; they are not screen-space raymarch or product-beauty evidence.",
        "gridShape": validated["gridShape"],
        "gridAxisOrder": validated["gridAxisOrder"],
        "settingIds": setting_ids,
        "requiredRoles": required_roles,
        "images": images,
        **html_receipt,
    }


def comparison(current: dict[str, Any], source_complete: dict[str, Any]) -> dict[str, Any]:
    current_optical = current["opticalMeanMse"]
    augmented_optical = source_complete["opticalMeanMse"]
    return {
        "opticalMseReductionFraction": (current_optical - augmented_optical) / current_optical if current_optical > 0 else 0.0,
        "membershipRecallDelta": source_complete["membership"]["recall"] - current["membership"]["recall"],
        "membershipF1Delta": source_complete["membership"]["f1"] - current["membership"]["f1"],
        "partialVisibleRecovery": {
            name: {
                "current16EnergyRecoveryFraction": current["perTarget"][name]["energyRecoveryFraction"],
                "sourceCompleteEnergyRecoveryFraction": source_complete["perTarget"][name]["energyRecoveryFraction"],
                "mseReductionFraction": (
                    (current["perTarget"][name]["mse"] - source_complete["perTarget"][name]["mse"])
                    / current["perTarget"][name]["mse"]
                    if current["perTarget"][name]["mse"] > 0 else 0.0
                ),
            }
            for name in TARGETS[1:]
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--probe-only", action="store_true")
    parser.add_argument("--truth-only", action="store_true")
    parser.add_argument("--visual-setting", action="append", default=[])
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--hidden-size", type=int, default=96)
    parser.add_argument("--learning-rate", type=float, default=2e-3)
    parser.add_argument("--seed", type=int, default=7162026)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started_at = time.time()
    input_path = args.input.expanduser().resolve()
    out_dir = args.out_dir.expanduser().resolve()
    report_path = args.report.expanduser().resolve() if args.report else out_dir / "oracle-report.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    phase = "input-manifest-read"
    last_trustworthy: dict[str, Any] = {}
    try:
        require(args.epochs > 0, "epochs must be positive")
        require(args.batch_size > 0, "batch-size must be positive")
        require(args.hidden_size > 0, "hidden-size must be positive")
        require(args.learning_rate > 0, "learning-rate must be positive")
        require(not (args.probe_only and args.truth_only), "probe-only and truth-only are mutually exclusive")
        require(not args.truth_only or args.visual_setting, "truth-only requires at least one --visual-setting")
        input_bytes = input_path.read_bytes()
        input_sha = hashlib.sha256(input_bytes).hexdigest()
        last_trustworthy["inputManifestSha256"] = input_sha
        manifest = json.loads(input_bytes)
        phase = "artifact-validation"
        validated = validate_manifest(manifest, input_path)
        last_trustworthy.update({
            "validatedArtifactCount": validated["validatedArtifactCount"],
            "validatedSettingCount": validated["cohort"]["retainedSettingCount"],
            "validatedRowCount": validated["cohort"]["totalRows"],
        })
        requested_visual_ids = sorted(set(args.visual_setting))
        require(len(requested_visual_ids) == len(args.visual_setting), "visual-setting ids must not repeat")
        setting_by_id = {setting["id"]: setting for setting in validated["settings"]}
        missing_visual_ids = sorted(set(requested_visual_ids) - set(setting_by_id))
        require(not missing_visual_ids, f"visual-setting ids are absent from the corpus: {missing_visual_ids}")
        visual_settings = [setting_by_id[setting_id] for setting_id in requested_visual_ids]
        report: dict[str, Any] = {
            "schema": RESULT_SCHEMA,
            "status": "validated" if args.probe_only else "visualizing-truth" if args.truth_only else "training",
            "failurePhase": None,
            "source": {"manifestPath": str(input_path), "manifestSha256": input_sha, "manifestIdentity": validated["identity"]},
            "backend": "not-loaded-probe-only" if args.probe_only else "not-loaded-truth-only" if args.truth_only else "mlx",
            "controlsUsedAsFeatures": False,
            "cohort": validated["cohort"],
            "featureViews": validated["featureViews"],
            "targets": validated["targets"],
            "splits": validated["splits"],
            "assays": {
                "sameState": {"identity": MEMORIZATION_IDENTITY, "evaluationSettingIds": validated["splits"]["train"]["settingIds"], "generalizationAuthority": False},
                "heldSetting": {"identity": SPLIT_IDENTITY, "evaluationSettingIds": validated["splits"]["heldOut"]["settingIds"], "generalizationAuthority": "held-control-setting-only"},
            },
            "architecture": {"identity": "matched-two-hidden-layer-silu-mlp-v0", "hiddenSize": args.hidden_size, "outputChannels": len(TARGETS)},
            "training": {"epochs": args.epochs, "batchSize": args.batch_size, "learningRate": args.learning_rate, "seed": args.seed, "rowPolicy": "all-retained-train-rows-once-per-epoch-v0"},
            "lastTrustworthyEvidence": last_trustworthy,
            "startedAt": started_at,
        }
        if args.probe_only:
            report["finishedAt"] = time.time()
            report["elapsedSeconds"] = report["finishedAt"] - started_at
            atomic_json(report_path, report)
            print(json.dumps({"status": report["status"], "report": str(report_path), "rows": validated["cohort"]["totalRows"]}))
            return 0
        visual_images: list[dict[str, Any]] = []
        for setting in visual_settings:
            truth_values = np.asarray(map_array(setting, "targets", len(TARGETS)), dtype=np.float32)
            visual_images.extend(render_visual_role(out_dir, setting, "truth", truth_values, truth_values, validated["gridShape"]))
        if args.truth_only:
            phase = "source-revalidation"
            require(hashlib.sha256(input_path.read_bytes()).hexdigest() == input_sha, "input manifest changed after initial validation")
            validate_manifest(json.loads(input_path.read_bytes()), input_path)
            last_trustworthy["sourceRevalidatedAtCompletion"] = True
            phase = "visual-witness-finalization"
            report["status"] = "visualized-truth-only"
            report["visualizations"] = visual_receipt(out_dir, validated, requested_visual_ids, ["truth"], visual_images)
            report["finishedAt"] = time.time()
            report["elapsedSeconds"] = report["finishedAt"] - started_at
            atomic_json(report_path, report)
            print(json.dumps({"status": report["status"], "report": str(report_path), "images": len(visual_images)}))
            return 0
        train_settings = [setting for setting in validated["settings"] if setting["splitRole"] == "train"]
        held_settings = [setting for setting in validated["settings"] if setting["splitRole"] == "heldOut"]
        results = {}
        for view_index, (view_name, feature_role) in enumerate((("current16", "current16"), ("sourceComplete", "sourceComplete"))):
            phase = f"{view_name}-training"
            feature_count = validated["featureViews"][view_name]["channelCount"]
            model_path = out_dir / f"{view_name}-oracle.safetensors"
            model, normalization, trace = train_model(
                train_settings,
                feature_role,
                feature_count,
                args.hidden_size,
                args.epochs,
                args.batch_size,
                args.learning_rate,
                args.seed,
                model_path,
            )
            phase = f"{view_name}-evaluation"
            same_state = evaluate_model(model, normalization["arrays"], train_settings, feature_role, feature_count, args.batch_size)
            held_setting = evaluate_model(model, normalization["arrays"], held_settings, feature_role, feature_count, args.batch_size)
            phase = f"{view_name}-visualization"
            for setting in visual_settings:
                truth_values = np.asarray(map_array(setting, "targets", len(TARGETS)), dtype=np.float32)
                predicted_values = predict_setting(model, normalization["arrays"], setting, feature_role, feature_count, args.batch_size)
                visual_images.extend(render_visual_role(out_dir, setting, view_name, predicted_values, truth_values, validated["gridShape"]))
            results[view_name] = {
                "featureIdentity": validated["featureViews"][view_name]["identity"],
                "featureChannelCount": feature_count,
                "seed": args.seed,
                "architectureIdentity": report["architecture"]["identity"],
                "normalization": normalization["receipt"],
                "lossTrace": trace,
                "modelArtifact": {"path": str(model_path), "bytes": model_path.stat().st_size, "sha256": sha256_file(model_path)},
                "sameState": same_state,
                "heldSetting": held_setting,
            }
            del model
        phase = "source-revalidation"
        final_input_bytes = input_path.read_bytes()
        require(hashlib.sha256(final_input_bytes).hexdigest() == input_sha, "input manifest changed after initial validation")
        validate_manifest(json.loads(final_input_bytes), input_path)
        last_trustworthy["sourceRevalidatedAtCompletion"] = True
        phase = "visual-witness-finalization"
        report["views"] = results
        report["comparisons"] = {
            "sameState": comparison(results["current16"]["sameState"], results["sourceComplete"]["sameState"]),
            "heldSetting": comparison(results["current16"]["heldSetting"], results["sourceComplete"]["heldSetting"]),
        }
        if requested_visual_ids:
            report["visualizations"] = visual_receipt(
                out_dir,
                validated,
                requested_visual_ids,
                ["truth", "current16", "sourceComplete"],
                visual_images,
            )
        report["status"] = "complete"
        report["finishedAt"] = time.time()
        report["elapsedSeconds"] = report["finishedAt"] - started_at
        atomic_json(report_path, report)
        print(json.dumps({"status": report["status"], "report": str(report_path), "comparisons": report["comparisons"]}))
        return 0
    except Exception as error:
        failure = {
            "schema": FAILURE_SCHEMA,
            "status": "failed",
            "failurePhase": phase,
            "reason": str(error),
            "lastTrustworthyEvidence": last_trustworthy,
            "startedAt": started_at,
            "finishedAt": time.time(),
        }
        failure["elapsedSeconds"] = failure["finishedAt"] - started_at
        atomic_json(report_path, failure)
        print(json.dumps({"status": "failed", "report": str(report_path), "failurePhase": phase, "reason": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
