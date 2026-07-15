#!/usr/bin/env python3
"""Distill dense teacher support and front residuals onto a coarse shared scaffold."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.coarse-support-front-scaffold.v0"
IDENTITY = "full-input-coarse-support-front-student-v0"
ARCHITECTURE = "shared-tanh-trunk-two-scalar-heads-v0"
FEATURE_IDENTITY = "full-low-field-plus-spatial-rbf-features-v0"
SUPPORT_LABEL_IDENTITY = "teacher-block-max-hard-occupancy-v0"
FRONT_LABEL_IDENTITY = "teacher-minus-native-low-block-mean-residual-v0"
REPLAY_STATUS = "source-teacher-bound-verified"
TEACHER_MODEL = "exact-basin-selective-carrier-heads-160-to-128-v0"
TEACHER_MODEL_SHA = "dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9"
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
ALL_CHANNELS = [*FLUID_CHANNELS, "frontTopology"]


class ScaffoldFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(
        payload,
        indent=2,
        default=lambda value: value.item() if isinstance(value, np.generic) else str(value),
    ) + "\n")


def resolve_path(raw: str, manifest_path: Path) -> Path:
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def artifact_path(
    descriptor: dict[str, Any], manifest_path: Path, expected_shape: list[int], expected_channels: list[str], label: str,
) -> Path:
    path = resolve_path(str(descriptor.get("path") or ""), manifest_path)
    if not path.exists():
        raise ScaffoldFailure("input-validation", f"missing {label}: {path}")
    if descriptor.get("shape") != expected_shape:
        raise ScaffoldFailure("input-validation", f"{label} shape mismatch", {
            "expected": expected_shape, "actual": descriptor.get("shape"),
        })
    if descriptor.get("channelOrder") != expected_channels:
        raise ScaffoldFailure("input-validation", f"{label} channel order mismatch", {
            "expected": expected_channels, "actual": descriptor.get("channelOrder"),
        })
    expected_bytes = int(descriptor.get("byteLength") or 0)
    if path.stat().st_size != expected_bytes:
        raise ScaffoldFailure("input-validation", f"{label} byte length mismatch")
    actual_sha = sha256_file(path)
    if not descriptor.get("sha256") or descriptor["sha256"] != actual_sha:
        raise ScaffoldFailure("input-validation", f"{label} SHA-256 mismatch", {
            "expected": descriptor.get("sha256"), "actual": actual_sha,
        })
    return path


def parse_frame(raw: str) -> tuple[Path, Path]:
    parts = raw.split(":", 1)
    if len(parts) != 2 or not all(parts):
        raise ScaffoldFailure("arguments", "frame arguments must be SOURCE_MANIFEST:TEACHER_MANIFEST")
    return Path(parts[0]).resolve(), Path(parts[1]).resolve()


def select_source_descriptors(manifest: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    collection = manifest.get("sidecars") or manifest.get("artifacts") or {}
    return collection.get("fluid") or {}, collection.get("front") or {}


def select_teacher_descriptors(manifest: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    outputs = manifest.get("outputs") or {}
    support = manifest.get("support", {}).get("probability") or outputs.get("supportProbability") or {}
    front = manifest.get("receiver", {}).get("front") or outputs.get("front") or {}
    return support, front


def frame_step(source: dict[str, Any], teacher: dict[str, Any]) -> int:
    source_step = source.get("deterministicReplay", {}).get("completedSteps")
    if source_step is None:
        source_step = source.get("simStepCount")
    teacher_step = teacher.get("source", {}).get("nativeSimStepCount")
    if teacher_step is None:
        teacher_step = source_step
    if source_step is None or int(source_step) != int(teacher_step):
        raise ScaffoldFailure("input-validation", "source and teacher simulation steps differ", {
            "sourceStep": source_step, "teacherStep": teacher_step,
        })
    return int(source_step)


def load_frame(source_path: Path, teacher_path: Path) -> dict[str, Any]:
    if not source_path.exists() or not teacher_path.exists():
        raise ScaffoldFailure("input-validation", "source or teacher manifest is missing", {
            "source": str(source_path), "teacher": str(teacher_path),
        })
    source_sha = sha256_file(source_path)
    teacher_sha = sha256_file(teacher_path)
    source = json.loads(source_path.read_text())
    teacher = json.loads(teacher_path.read_text())
    if source.get("schema") != "kaminos.volume.full-grid-field-export.v0" or source.get("status") != "captured":
        raise ScaffoldFailure("input-validation", "source is not a captured full-grid field export")
    if source.get("failurePhase") is not None or not source.get("completeFieldCoverage"):
        raise ScaffoldFailure("input-validation", "source field export is incomplete")
    if teacher.get("schema") != "kaminos.volume.native-low-selective-composition.v0" or teacher.get("status") != "captured":
        raise ScaffoldFailure("input-validation", "teacher is not a captured native-low selective composition")
    if teacher.get("failurePhase") is not None or teacher.get("runtimeTruthAvailable") is not False:
        raise ScaffoldFailure("input-validation", "teacher authority is incoherent")
    teacher_source_sha = str(teacher.get("source", {}).get("nativeManifestSha256") or "")
    if teacher_source_sha != source_sha:
        raise ScaffoldFailure("input-validation", "teacher native manifest SHA does not bind the nominated source", {
            "expected": source_sha, "actual": teacher_source_sha,
        })
    model = teacher.get("model") or {}
    if model.get("identity") != TEACHER_MODEL or model.get("modelSha256") != TEACHER_MODEL_SHA:
        raise ScaffoldFailure("input-validation", "teacher model identity or checksum differs", {"model": model})
    source_grid = int(source.get("grid") or teacher.get("source", {}).get("nativeGrid") or 0)
    teacher_grid = int(teacher.get("relationship", {}).get("outputGrid") or teacher.get("receiver", {}).get("grid") or 0)
    source_fluid_desc, source_front_desc = select_source_descriptors(source)
    teacher_support_desc, teacher_front_desc = select_teacher_descriptors(teacher)
    if teacher_grid <= 0:
        shape = teacher_support_desc.get("shape") or []
        teacher_grid = int(shape[0]) if len(shape) == 4 else 0
    if source_grid <= 0 or teacher_grid <= 0:
        raise ScaffoldFailure("input-validation", "source or teacher grid is missing")
    source_fluid_path = artifact_path(
        source_fluid_desc, source_path, [source_grid, source_grid, source_grid, 16], FLUID_CHANNELS, "source fluid",
    )
    source_front_path = artifact_path(
        source_front_desc, source_path, [source_grid, source_grid, source_grid, 1], ["frontTopology"], "source front",
    )
    support_channels = teacher_support_desc.get("channelOrder")
    if support_channels not in (["supportProbability"], ["acceptedSplatProbability"]):
        raise ScaffoldFailure("input-validation", "teacher support probability channel order mismatch", {
            "accepted": [["supportProbability"], ["acceptedSplatProbability"]], "actual": support_channels,
        })
    teacher_support_path = artifact_path(
        teacher_support_desc, teacher_path, [teacher_grid, teacher_grid, teacher_grid, 1], support_channels,
        "teacher support probability",
    )
    teacher_front_path = artifact_path(
        teacher_front_desc, teacher_path, [teacher_grid, teacher_grid, teacher_grid, 1], ["frontTopology"],
        "teacher front",
    )
    route = source.get("effectiveRoute") or source.get("deterministicReplay", {}).get("effectiveRoute")
    backend = source.get("backend") or source.get("deterministicReplay", {}).get("backend")
    teacher_source = teacher.get("source") or {}
    if route != teacher_source.get("effectiveRoute") or backend != teacher_source.get("backend"):
        raise ScaffoldFailure("input-validation", "source and teacher route/backend differ")
    step = frame_step(source, teacher)
    source_cells = source_grid ** 3
    teacher_cells = teacher_grid ** 3
    fluid = np.memmap(source_fluid_path, dtype="<f4", mode="r", shape=(source_cells, 16))
    front = np.memmap(source_front_path, dtype="<f4", mode="r", shape=(source_cells,))
    support = np.memmap(teacher_support_path, dtype="<f4", mode="r", shape=(teacher_cells,))
    teacher_front = np.memmap(teacher_front_path, dtype="<f4", mode="r", shape=(teacher_cells,))
    for label, values in (("source fluid", fluid), ("source front", front), ("teacher support", support), ("teacher front", teacher_front)):
        if not np.all(np.isfinite(values)):
            raise ScaffoldFailure("input-validation", f"{label} contains non-finite values")
    return {
        "step": step,
        "sourcePath": source_path,
        "sourceSha256": source_sha,
        "teacherPath": teacher_path,
        "teacherSha256": teacher_sha,
        "sourceGrid": source_grid,
        "teacherGrid": teacher_grid,
        "route": route,
        "backend": backend,
        "fluid": fluid,
        "front": front,
        "support": support,
        "teacherFront": teacher_front,
        "artifactHashes": {
            "sourceFluid": source_fluid_desc["sha256"],
            "sourceFront": source_front_desc["sha256"],
            "teacherSupport": teacher_support_desc["sha256"],
            "teacherFront": teacher_front_desc["sha256"],
        },
    }


def feature_positions(grid: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    z, y, x = np.indices((grid, grid, grid), dtype=np.int32)
    return x.reshape(-1), y.reshape(-1), z.reshape(-1)


def sample_source(frame: dict[str, Any], scaffold_grid: int) -> np.ndarray:
    source_grid = frame["sourceGrid"]
    teacher_grid = frame["teacherGrid"]
    if teacher_grid % scaffold_grid != 0:
        raise ScaffoldFailure("feature-construction", "teacher grid must divide into source sampling blocks")
    mapping = np.minimum(
        source_grid - 1,
        np.floor(np.arange(teacher_grid, dtype=np.float64) * source_grid / teacher_grid).astype(np.int64),
    )
    fields = []
    fluid = np.asarray(frame["fluid"]).reshape(source_grid, source_grid, source_grid, 16)
    for channel in range(16):
        mapped = fluid[:, :, :, channel][np.ix_(mapping, mapping, mapping)]
        fields.append(block_reduce(mapped, teacher_grid, scaffold_grid, "mean"))
    front = np.asarray(frame["front"]).reshape(source_grid, source_grid, source_grid)
    mapped_front = front[np.ix_(mapping, mapping, mapping)]
    fields.append(block_reduce(mapped_front, teacher_grid, scaffold_grid, "mean"))
    return np.stack(fields, axis=1).astype(np.float32)


def build_features(low_values: np.ndarray, grid: int) -> np.ndarray:
    x, y, z = feature_positions(grid)
    normalizer = max(1, grid - 1)
    normalized = np.stack([x, y, z], axis=1).astype(np.float32) / np.float32(normalizer) * 2.0 - 1.0
    radial = np.linalg.norm(normalized[:, [0, 2]], axis=1)
    position = np.stack([normalized[:, 0], normalized[:, 1], normalized[:, 2], radial, normalized[:, 1] * radial], axis=1)
    fourier = []
    for frequency in (1.0, 2.0, 4.0):
        for axis in range(3):
            phase = np.pi * frequency * normalized[:, axis]
            fourier.extend([np.sin(phase), np.cos(phase)])
    rbf = []
    for cy in np.linspace(-0.95, 0.85, 8):
        for cz in np.linspace(-0.75, 0.75, 4):
            for cx in np.linspace(-0.75, 0.75, 4):
                delta = normalized - np.asarray([cx, cy, cz], dtype=np.float32)
                rbf.append(np.exp(-np.sum(delta * delta, axis=1) / (2.0 * 0.30 * 0.30)))
    features = np.concatenate([
        low_values,
        low_values * low_values,
        position.astype(np.float32),
        np.stack(fourier, axis=1).astype(np.float32),
        np.stack(rbf, axis=1).astype(np.float32),
    ], axis=1).astype(np.float32)
    if features.shape[1] != 185:
        raise ScaffoldFailure("feature-construction", "feature count differs from 185", {"shape": list(features.shape)})
    return features


def teacher_baseline_front(frame: dict[str, Any]) -> np.ndarray:
    source_grid = frame["sourceGrid"]
    teacher_grid = frame["teacherGrid"]
    x, y, z = feature_positions(teacher_grid)
    sx = np.minimum(source_grid - 1, np.floor(x * source_grid / teacher_grid).astype(np.int64))
    sy = np.minimum(source_grid - 1, np.floor(y * source_grid / teacher_grid).astype(np.int64))
    sz = np.minimum(source_grid - 1, np.floor(z * source_grid / teacher_grid).astype(np.int64))
    indexes = sx + sy * source_grid + sz * source_grid * source_grid
    return np.asarray(frame["front"][indexes], dtype=np.float32)


def block_reduce(values: np.ndarray, source_grid: int, target_grid: int, mode: str) -> np.ndarray:
    if source_grid % target_grid != 0:
        raise ScaffoldFailure("label-construction", "teacher grid is not divisible by scaffold grid", {
            "teacherGrid": source_grid, "scaffoldGrid": target_grid,
        })
    factor = source_grid // target_grid
    shaped = np.asarray(values).reshape(source_grid, source_grid, source_grid)
    blocked = shaped.reshape(target_grid, factor, target_grid, factor, target_grid, factor)
    if mode == "max":
        reduced = blocked.max(axis=(1, 3, 5))
    elif mode == "mean":
        reduced = blocked.mean(axis=(1, 3, 5), dtype=np.float64)
    else:
        raise ScaffoldFailure("label-construction", f"unsupported block reduction: {mode}")
    return np.asarray(reduced, dtype=np.float32).reshape(-1)


def resize_axis(values: np.ndarray, target: int, axis: int) -> np.ndarray:
    source = values.shape[axis]
    coordinate = (np.arange(target, dtype=np.float32) + 0.5) * (source / target) - 0.5
    lower = np.floor(coordinate).astype(np.intp)
    upper = lower + 1
    fraction = coordinate - lower
    lower = np.clip(lower, 0, source - 1)
    upper = np.clip(upper, 0, source - 1)
    shape = [1] * values.ndim
    shape[axis] = target
    fraction = fraction.reshape(shape)
    return np.take(values, lower, axis=axis) * (1.0 - fraction) + np.take(values, upper, axis=axis) * fraction


def reconstruct_coarse_field(values: np.ndarray, coarse_grid: int, teacher_grid: int) -> np.ndarray:
    field = np.asarray(values, dtype=np.float32).reshape(coarse_grid, coarse_grid, coarse_grid)
    field = resize_axis(resize_axis(resize_axis(field, teacher_grid, 2), teacher_grid, 1), teacher_grid, 0)
    return np.asarray(field, dtype=np.float32).reshape(-1)


def frame_dataset(frame: dict[str, Any], scaffold_grid: int, support_threshold: float) -> dict[str, np.ndarray]:
    low_values = sample_source(frame, scaffold_grid)
    features = build_features(low_values, scaffold_grid)
    teacher_grid = frame["teacherGrid"]
    support_max = block_reduce(frame["support"], teacher_grid, scaffold_grid, "max")
    support_labels = support_max >= np.float32(support_threshold)
    teacher_residual = np.asarray(frame["teacherFront"], dtype=np.float32) - teacher_baseline_front(frame)
    front_labels = block_reduce(teacher_residual, teacher_grid, scaffold_grid, "mean")
    return {
        "features": features,
        "supportLabels": support_labels,
        "supportBlockMax": support_max,
        "frontLabels": front_labels,
    }


def sigmoid(value: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(value, -30.0, 30.0)))


def predict(features: np.ndarray, state: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    hidden = np.tanh(features @ state["w1"] + state["b1"])
    support = sigmoid(hidden @ state["supportW"] + state["supportB"])
    front_norm = hidden @ state["frontW"] + state["frontB"]
    front = front_norm * state["frontStd"] + state["frontMean"]
    return support.astype(np.float32), front.astype(np.float32)


def train_student(
    train_x: np.ndarray, train_support: np.ndarray, train_front: np.ndarray, args: argparse.Namespace,
) -> tuple[dict[str, Any], dict[str, Any]]:
    rng = np.random.default_rng(args.seed)
    input_width = train_x.shape[1]
    hidden_width = int(args.hidden_width)
    state: dict[str, Any] = {
        "w1": rng.normal(0.0, math.sqrt(2.0 / input_width), (input_width, hidden_width)).astype(np.float32),
        "b1": np.zeros(hidden_width, dtype=np.float32),
        "supportW": rng.normal(0.0, math.sqrt(1.0 / hidden_width), hidden_width).astype(np.float32),
        "supportB": np.float32(0.0),
        "frontW": rng.normal(0.0, math.sqrt(1.0 / hidden_width), hidden_width).astype(np.float32),
        "frontB": np.float32(0.0),
        "frontMean": np.float32(np.mean(train_front)),
        "frontStd": np.float32(max(float(np.std(train_front)), 1.0e-6)),
    }
    front_target = ((train_front - state["frontMean"]) / state["frontStd"]).astype(np.float32)
    positive = int(np.count_nonzero(train_support))
    negative = int(train_support.size - positive)
    if positive == 0 or negative == 0:
        raise ScaffoldFailure("model-fit", "training support labels require both classes")
    positive_weight = np.float32(negative / positive)
    names = ["w1", "b1", "supportW", "supportB", "frontW", "frontB"]
    first = {name: np.zeros_like(state[name], dtype=np.float32) for name in names}
    second = {name: np.zeros_like(state[name], dtype=np.float32) for name in names}
    beta1, beta2, epsilon = 0.9, 0.999, 1.0e-8
    update = 0
    epoch_losses = []
    for epoch in range(int(args.epochs)):
        order = rng.permutation(train_x.shape[0])
        epoch_support = 0.0
        epoch_front = 0.0
        batches = 0
        for start in range(0, order.size, int(args.batch_size)):
            batch = order[start:start + int(args.batch_size)]
            x = train_x[batch]
            y_support = train_support[batch].astype(np.float32)
            y_front = front_target[batch]
            hidden = np.tanh(x @ state["w1"] + state["b1"])
            logits = hidden @ state["supportW"] + state["supportB"]
            probability = sigmoid(logits).astype(np.float32)
            front_pred = hidden @ state["frontW"] + state["frontB"]
            weights = np.where(y_support > 0.5, positive_weight, np.float32(1.0))
            weight_sum = np.float32(np.sum(weights))
            d_support = (probability - y_support) * weights / max(float(weight_sum), 1.0)
            d_front = np.float32(2.0 / max(1, batch.size)) * (front_pred - y_front) * np.float32(args.front_loss_weight)
            gradients = {
                "supportW": hidden.T @ d_support,
                "supportB": np.asarray(np.sum(d_support), dtype=np.float32),
                "frontW": hidden.T @ d_front,
                "frontB": np.asarray(np.sum(d_front), dtype=np.float32),
            }
            d_hidden = d_support[:, None] * state["supportW"][None, :] + d_front[:, None] * state["frontW"][None, :]
            d_pre = d_hidden * (1.0 - hidden * hidden)
            gradients["w1"] = x.T @ d_pre + np.float32(args.weight_decay) * state["w1"]
            gradients["b1"] = np.sum(d_pre, axis=0)
            for head in ("supportW", "frontW"):
                gradients[head] = gradients[head] + np.float32(args.weight_decay) * state[head]
            update += 1
            for name in names:
                gradient = np.asarray(gradients[name], dtype=np.float32)
                first[name] = beta1 * first[name] + (1.0 - beta1) * gradient
                second[name] = beta2 * second[name] + (1.0 - beta2) * gradient * gradient
                first_hat = first[name] / (1.0 - beta1 ** update)
                second_hat = second[name] / (1.0 - beta2 ** update)
                state[name] = np.asarray(
                    state[name] - np.float32(args.learning_rate) * first_hat / (np.sqrt(second_hat) + epsilon),
                    dtype=np.float32,
                )
            support_loss = -np.mean(weights * (
                y_support * np.log(np.maximum(probability, 1.0e-7))
                + (1.0 - y_support) * np.log(np.maximum(1.0 - probability, 1.0e-7))
            ))
            epoch_support += float(support_loss)
            epoch_front += float(np.mean((front_pred - y_front) ** 2))
            batches += 1
        epoch_losses.append({
            "epoch": epoch + 1,
            "supportWeightedBce": epoch_support / max(1, batches),
            "frontNormalizedMse": epoch_front / max(1, batches),
        })
    return state, {
        "epochs": int(args.epochs),
        "batchSize": int(args.batch_size),
        "learningRate": float(args.learning_rate),
        "weightDecay": float(args.weight_decay),
        "frontLossWeight": float(args.front_loss_weight),
        "positiveWeight": float(positive_weight),
        "uncappedTrainingRows": int(train_x.shape[0]),
        "epochLosses": epoch_losses,
    }


def support_metrics(probability: np.ndarray, truth: np.ndarray, threshold: float) -> dict[str, Any]:
    prediction = probability >= np.float32(threshold)
    truth = truth.astype(np.bool_)
    tp = int(np.count_nonzero(prediction & truth))
    fp = int(np.count_nonzero(prediction & ~truth))
    fn = int(np.count_nonzero(~prediction & truth))
    tn = int(np.count_nonzero(~prediction & ~truth))
    return {
        "rowCount": int(truth.size),
        "positiveCount": int(np.count_nonzero(truth)),
        "predictedPositiveCount": int(np.count_nonzero(prediction)),
        "truePositive": tp,
        "falsePositive": fp,
        "falseNegative": fn,
        "trueNegative": tn,
        "precision": float(tp / max(1, tp + fp)),
        "recall": float(tp / max(1, tp + fn)),
        "jaccard": float(tp / max(1, tp + fp + fn)),
        "threshold": float(threshold),
    }


def select_threshold(probability: np.ndarray, truth: np.ndarray, minimum_recall: float) -> dict[str, Any]:
    probability = np.asarray(probability, dtype=np.float32)
    truth = np.asarray(truth, dtype=np.bool_)
    order = np.argsort(-probability, kind="stable")
    sorted_probability = probability[order]
    sorted_truth = truth[order]
    cumulative_tp = np.cumsum(sorted_truth, dtype=np.int64)
    total_positive = int(cumulative_tp[-1]) if cumulative_tp.size else 0
    if total_positive == 0:
        raise ScaffoldFailure("threshold-selection", "validation support labels contain no positives")
    boundaries = np.flatnonzero(np.r_[sorted_probability[1:] != sorted_probability[:-1], True])
    points = []
    eligible = []
    for boundary in boundaries.tolist():
        kept = boundary + 1
        tp = int(cumulative_tp[boundary])
        fp = kept - tp
        fn = total_positive - tp
        point = {
            "threshold": float(sorted_probability[boundary]),
            "kept": kept,
            "precision": float(tp / max(1, tp + fp)),
            "recall": float(tp / max(1, tp + fn)),
            "jaccard": float(tp / max(1, tp + fp + fn)),
        }
        points.append(point)
        if point["recall"] + 1.0e-12 >= minimum_recall:
            eligible.append(point)
    if not eligible:
        raise ScaffoldFailure("threshold-selection", "no validation threshold meets support recall floor", {
            "minimumRecall": minimum_recall,
        })
    selected = max(eligible, key=lambda point: (point["jaccard"], point["precision"], -point["kept"]))
    return {
        "identity": "uncapped-validation-support-jaccard-threshold-v0",
        "selectedOn": "validation",
        "testDataUsedForSelection": False,
        "minimumRecall": float(minimum_recall),
        "capped": False,
        "pointCount": len(points),
        "points": points,
        "selected": selected,
        "threshold": selected["threshold"],
    }


def front_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, Any]:
    prediction64 = prediction.astype(np.float64)
    truth64 = truth.astype(np.float64)
    error = prediction64 - truth64
    truth_energy = float(np.sum(truth64 * truth64))
    prediction_energy = float(np.sum(prediction64 * prediction64))
    if np.std(prediction64) <= 1.0e-12 or np.std(truth64) <= 1.0e-12:
        correlation = 0.0
    else:
        correlation = float(np.corrcoef(prediction64, truth64)[0, 1])
    return {
        "rowCount": int(truth.size),
        "rmse": float(np.sqrt(np.mean(error * error))),
        "mae": float(np.mean(np.abs(error))),
        "correlation": correlation,
        "energyRetention": float(prediction_energy / max(truth_energy, 1.0e-20)),
        "explainedEnergy": float(1.0 - np.sum(error * error) / max(truth_energy, 1.0e-20)),
        "truthEnergy": truth_energy,
        "predictionEnergy": prediction_energy,
    }


def descriptor(path: Path, grid: int, channel: str, authority: str) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "byteLength": path.stat().st_size,
        "dtype": "float32-le",
        "shape": [grid, grid, grid, 1],
        "channelOrder": [channel],
        "authority": authority,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-frame", required=True)
    parser.add_argument("--validation-frame", required=True)
    parser.add_argument("--test-frame", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--scaffold-grid", type=int, default=40)
    parser.add_argument("--hidden-width", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=24)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--front-loss-weight", type=float, default=1.0)
    parser.add_argument("--support-teacher-threshold", type=float, default=0.98)
    parser.add_argument("--minimum-support-recall", type=float, default=0.999)
    parser.add_argument("--seed", type=int, default=9413)
    return parser.parse_args()


def producer_receipt(args: argparse.Namespace) -> dict[str, Any]:
    script_path = Path(__file__).resolve()
    return {
        "identity": script_path.name,
        "scriptPath": str(script_path),
        "scriptSha256": sha256_file(script_path),
        "invocation": {
            "scaffoldGrid": int(args.scaffold_grid),
            "hiddenWidth": int(args.hidden_width),
            "epochs": int(args.epochs),
            "batchSize": int(args.batch_size),
            "learningRate": float(args.learning_rate),
            "weightDecay": float(args.weight_decay),
            "frontLossWeight": float(args.front_loss_weight),
            "supportTeacherThreshold": float(args.support_teacher_threshold),
            "minimumSupportRecall": float(args.minimum_support_recall),
            "seed": int(args.seed),
        },
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    phase = "arguments"
    evidence: dict[str, Any] = {}
    try:
        if args.scaffold_grid <= 0 or args.hidden_width <= 0 or args.epochs <= 0 or args.batch_size <= 0:
            raise ScaffoldFailure("arguments", "grid, hidden width, epochs, and batch size must be positive")
        roles = {
            "train": parse_frame(args.train_frame),
            "validation": parse_frame(args.validation_frame),
            "test": parse_frame(args.test_frame),
        }
        phase = "input-validation"
        frames = {role: load_frame(*paths) for role, paths in roles.items()}
        steps = [frames[role]["step"] for role in ("train", "validation", "test")]
        if len(set(steps)) != 3:
            raise ScaffoldFailure(phase, "train, validation, and test frames must be distinct")
        source_grids = {frame["sourceGrid"] for frame in frames.values()}
        teacher_grids = {frame["teacherGrid"] for frame in frames.values()}
        routes = {(frame["route"], frame["backend"]) for frame in frames.values()}
        if len(source_grids) != 1 or len(teacher_grids) != 1 or len(routes) != 1:
            raise ScaffoldFailure(phase, "frame grids or route/backend identities differ")
        phase = "split-validation"
        for label, keys in {
            "source field artifacts": ("sourceFluid", "sourceFront"),
            "teacher output artifacts": ("teacherSupport", "teacherFront"),
        }.items():
            identities = [tuple(frame["artifactHashes"][key] for key in keys) for frame in frames.values()]
            if len(set(identities)) != len(identities):
                raise ScaffoldFailure(phase, f"duplicate {label} across train/validation/test", {
                    "steps": steps, "identities": identities,
                })
        teacher_grid = next(iter(teacher_grids))
        if teacher_grid % args.scaffold_grid != 0:
            raise ScaffoldFailure(phase, "teacher grid must divide exactly into scaffold blocks")
        evidence = {
            role: {
                "step": frame["step"],
                "sourceManifestSha256": frame["sourceSha256"],
                "teacherManifestSha256": frame["teacherSha256"],
            }
            for role, frame in frames.items()
        }

        phase = "dataset-construction"
        datasets = {
            role: frame_dataset(frame, args.scaffold_grid, args.support_teacher_threshold)
            for role, frame in frames.items()
        }
        phase = "split-validation"
        derived_identities = []
        for dataset in datasets.values():
            derived_identities.append((
                sha256_bytes(dataset["features"].astype("<f4", copy=False).tobytes()),
                sha256_bytes(dataset["supportLabels"].astype(np.uint8, copy=False).tobytes()),
                sha256_bytes(dataset["frontLabels"].astype("<f4", copy=False).tobytes()),
            ))
        if len(set(derived_identities)) != len(derived_identities):
            raise ScaffoldFailure(phase, "duplicate derived feature/label bundle across train/validation/test", {
                "steps": steps, "identities": derived_identities,
            })
        train_features = datasets["train"]["features"]
        feature_mean = np.mean(train_features, axis=0, dtype=np.float64).astype(np.float32)
        feature_std = np.std(train_features, axis=0, dtype=np.float64).astype(np.float32)
        feature_std[feature_std < 1.0e-6] = 1.0
        normalized = {
            role: ((dataset["features"] - feature_mean) / feature_std).astype(np.float32)
            for role, dataset in datasets.items()
        }

        phase = "model-fit"
        state, training = train_student(
            normalized["train"], datasets["train"]["supportLabels"], datasets["train"]["frontLabels"], args,
        )
        raw_predictions = {role: predict(normalized[role], state) for role in datasets}

        phase = "threshold-selection"
        threshold_selection = select_threshold(
            raw_predictions["validation"][0], datasets["validation"]["supportLabels"], args.minimum_support_recall,
        )
        threshold = float(threshold_selection["threshold"])
        support_results = {
            role: support_metrics(raw_predictions[role][0], datasets[role]["supportLabels"], threshold)
            for role in datasets
        }
        front_results = {
            role: front_metrics(raw_predictions[role][1], datasets[role]["frontLabels"])
            for role in datasets
        }
        dense_front_results = {}
        dense_truth_by_role = {}
        for role, frame in frames.items():
            dense_prediction = reconstruct_coarse_field(
                raw_predictions[role][1], args.scaffold_grid, teacher_grid,
            )
            dense_truth = np.asarray(frame["teacherFront"], dtype=np.float32) - teacher_baseline_front(frame)
            dense_truth_by_role[role] = dense_truth
            dense_front_results[role] = front_metrics(dense_prediction, dense_truth)
        validation_prediction_energy = dense_front_results["validation"]["predictionEnergy"]
        validation_truth_energy = dense_front_results["validation"]["truthEnergy"]
        front_gain = np.float32(math.sqrt(validation_truth_energy / max(validation_prediction_energy, 1.0e-20)))
        predictions = {
            role: (support, (front * front_gain).astype(np.float32))
            for role, (support, front) in raw_predictions.items()
        }
        calibrated_dense_front_results = {
            role: front_metrics(
                reconstruct_coarse_field(predictions[role][1], args.scaffold_grid, teacher_grid),
                dense_truth_by_role[role],
            )
            for role in datasets
        }

        phase = "checkpoint-write"
        bindings = {
            role: {
                "step": frames[role]["step"],
                "sourceManifestSha256": frames[role]["sourceSha256"],
                "teacherManifestSha256": frames[role]["teacherSha256"],
                **frames[role]["artifactHashes"],
                "featureSha256": sha256_bytes(datasets[role]["features"].astype("<f4", copy=False).tobytes()),
                "supportLabelSha256": sha256_bytes(datasets[role]["supportLabels"].astype(np.uint8).tobytes()),
                "frontLabelSha256": sha256_bytes(datasets[role]["frontLabels"].astype("<f4", copy=False).tobytes()),
            }
            for role in datasets
        }
        checkpoint_path = out_dir / "coarse-support-front-student.npz"
        np.savez_compressed(
            checkpoint_path,
            schema=np.asarray([SCHEMA]),
            identity=np.asarray([IDENTITY]),
            architecture=np.asarray([ARCHITECTURE]),
            featureMean=feature_mean,
            featureStd=feature_std,
            w1=state["w1"],
            b1=state["b1"],
            supportW=state["supportW"],
            supportB=np.asarray([state["supportB"]], dtype=np.float32),
            frontW=state["frontW"],
            frontB=np.asarray([state["frontB"]], dtype=np.float32),
            frontMean=np.asarray([state["frontMean"]], dtype=np.float32),
            frontStd=np.asarray([state["frontStd"]], dtype=np.float32),
            frontGain=np.asarray([front_gain], dtype=np.float32),
            supportThreshold=np.asarray([threshold], dtype=np.float32),
            scaffoldGrid=np.asarray([args.scaffold_grid], dtype=np.int32),
            bindingsJson=np.asarray([json.dumps(bindings, sort_keys=True)]),
        )

        phase = "checkpoint-replay"
        with np.load(checkpoint_path, allow_pickle=False) as replay:
            replay_state = {
                "w1": replay["w1"].astype(np.float32),
                "b1": replay["b1"].astype(np.float32),
                "supportW": replay["supportW"].astype(np.float32),
                "supportB": np.float32(replay["supportB"][0]),
                "frontW": replay["frontW"].astype(np.float32),
                "frontB": np.float32(replay["frontB"][0]),
                "frontMean": np.float32(replay["frontMean"][0]),
                "frontStd": np.float32(replay["frontStd"][0]),
            }
            replay_mean = replay["featureMean"].astype(np.float32)
            replay_std = replay["featureStd"].astype(np.float32)
            replay_bindings = json.loads(str(replay["bindingsJson"][0]))
            replay_predictions = {
                role: predict(((datasets[role]["features"] - replay_mean) / replay_std).astype(np.float32), replay_state)
                for role in datasets
            }
            replay_gain = np.float32(replay["frontGain"][0])
            replay_predictions = {
                role: (support, (front * replay_gain).astype(np.float32))
                for role, (support, front) in replay_predictions.items()
            }
            replay_threshold = float(replay["supportThreshold"][0])
        binding_parity = replay_bindings == bindings
        output_parity = all(
            np.array_equal(replay_predictions[role][head], predictions[role][head])
            for role in datasets for head in (0, 1)
        ) and np.float32(replay_threshold) == np.float32(threshold)
        if not binding_parity or not output_parity:
            raise ScaffoldFailure(phase, "serialized checkpoint replay differs", {
                "sourceBindingParity": binding_parity, "outputParity": output_parity,
            })

        phase = "output-write"
        test_support_path = out_dir / "held-support-probability.f32"
        test_front_path = out_dir / "held-front-residual.f32"
        test_mask_path = out_dir / "held-support-mask.f32"
        test_support_path.write_bytes(replay_predictions["test"][0].astype("<f4", copy=False).tobytes())
        test_front_path.write_bytes(replay_predictions["test"][1].astype("<f4", copy=False).tobytes())
        test_mask_path.write_bytes(
            (replay_predictions["test"][0] >= np.float32(threshold)).astype("<f4").tobytes()
        )
        scaffold_cells = args.scaffold_grid ** 3
        per_cell_macs = 185 * args.hidden_width + args.hidden_width * 2
        total_macs = scaffold_cells * per_cell_macs
        dense_teacher_two_head_macs = (160 ** 3) * 2 * 8928
        projection_ratio = total_macs / dense_teacher_two_head_macs
        projected_range = [338.48 * projection_ratio, 529.86 * projection_ratio]
        promotion = {
            "heldSupportRecallAtLeast999": bool(support_results["test"]["recall"] >= 0.999),
            "heldRawDenseFrontCorrelationAtLeast093": bool(dense_front_results["test"]["correlation"] >= 0.93),
            "heldCalibratedDenseFrontEnergyRetentionBetween090And110": bool(
                0.90 <= calibrated_dense_front_results["test"]["energyRetention"] <= 1.10
            ),
            "heldCalibratedDenseFrontExplainedEnergyPositive": bool(
                calibrated_dense_front_results["test"]["explainedEnergy"] > 0.0
            ),
            "metricAuthority": "held-raw-structure-validation-calibrated-amplitude-v0",
            "runtimePromotionNotEvaluated": True,
        }
        promotion["allNominatedHeldFieldGatesPass"] = all(
            value for key, value in promotion.items() if key.startswith("held")
        )
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "producer": producer_receipt(args),
            "authority": "diagnostic-teacher-distillation-no-runtime-truth-v0",
            "runtimeTruthAvailable": False,
            "frameRoles": {
                "train": [frames["train"]["step"]],
                "validation": [frames["validation"]["step"]],
                "test": [frames["test"]["step"]],
            },
            "inputs": {
                "sourceGrid": next(iter(source_grids)),
                "teacherGrid": teacher_grid,
                "scaffoldGrid": args.scaffold_grid,
                "teacherModelIdentity": TEACHER_MODEL,
                "teacherModelSha256": TEACHER_MODEL_SHA,
                "route": next(iter(routes))[0],
                "backend": next(iter(routes))[1],
                "bindings": bindings,
            },
            "features": {
                "identity": FEATURE_IDENTITY,
                "featureCount": 185,
                "sourceSamplingIdentity": "teacher-block-aligned-native-field-mean-v0",
                "lowFieldCount": 17,
                "squaredLowFieldCount": 17,
                "positionCount": 5,
                "fourierCount": 18,
                "rbfCount": 128,
                "lowFieldChannelOrder": ALL_CHANNELS,
                "allLowFieldsPreserved": True,
            },
            "labels": {
                "support": {
                    "identity": SUPPORT_LABEL_IDENTITY,
                    "teacherThreshold": float(args.support_teacher_threshold),
                    "blockReduction": "max-over-exact-teacher-block-v0",
                    "shapePerFrame": [args.scaffold_grid, args.scaffold_grid, args.scaffold_grid, 1],
                    "runtimeTruthUse": False,
                },
                "front": {
                    "identity": FRONT_LABEL_IDENTITY,
                    "blockReduction": "mean-over-exact-teacher-residual-block-v0",
                    "shapePerFrame": [args.scaffold_grid, args.scaffold_grid, args.scaffold_grid, 1],
                    "runtimeTruthUse": False,
                },
            },
            "student": {
                "architecture": ARCHITECTURE,
                "inputWidth": 185,
                "hiddenWidth": int(args.hidden_width),
                "outputHeads": ["supportLogit", "frontResidual"],
                "training": training,
            },
            "support": {
                "thresholdSelection": threshold_selection,
                "train": support_results["train"],
                "validation": support_results["validation"],
                "test": support_results["test"],
            },
            "front": {
                "coarseLabelMetricAuthority": "coarse-block-label-fit-only-v0",
                "train": front_results["train"],
                "validation": front_results["validation"],
                "test": front_results["test"],
                "denseTrain": {
                    "interpolationIdentity": "cell-centered-trilinear-coarse-to-teacher-grid-v0",
                    **dense_front_results["train"],
                },
                "denseValidation": {
                    "interpolationIdentity": "cell-centered-trilinear-coarse-to-teacher-grid-v0",
                    **dense_front_results["validation"],
                },
                "denseHeld": {
                    "interpolationIdentity": "cell-centered-trilinear-coarse-to-teacher-grid-v0",
                    **dense_front_results["test"],
                },
                "calibration": {
                    "identity": "validation-dense-energy-gain-v0",
                    "selectedOn": "validation",
                    "testDataUsedForSelection": False,
                    "gain": float(front_gain),
                    "objective": "match validation reconstructed-field energy without changing structural correlation",
                },
                "calibratedDenseTrain": {
                    "interpolationIdentity": "cell-centered-trilinear-coarse-to-teacher-grid-v0",
                    **calibrated_dense_front_results["train"],
                },
                "calibratedDenseValidation": {
                    "interpolationIdentity": "cell-centered-trilinear-coarse-to-teacher-grid-v0",
                    **calibrated_dense_front_results["validation"],
                },
                "calibratedDenseHeld": {
                    "interpolationIdentity": "cell-centered-trilinear-coarse-to-teacher-grid-v0",
                    **calibrated_dense_front_results["test"],
                },
            },
            "checkpoint": {
                "path": str(checkpoint_path),
                "sha256": sha256_file(checkpoint_path),
                "byteLength": checkpoint_path.stat().st_size,
                "replay": {
                    "status": REPLAY_STATUS,
                    "sourceBindingParity": binding_parity,
                    "outputParity": output_parity,
                    "thresholdParity": bool(np.float32(replay_threshold) == np.float32(threshold)),
                },
            },
            "heldOutputs": {
                "supportProbability": descriptor(test_support_path, args.scaffold_grid, "supportProbability", "held-student-prediction-v0"),
                "supportMask": descriptor(test_mask_path, args.scaffold_grid, "supportOccupancy", "validation-threshold-held-student-mask-v0"),
                "frontResidual": descriptor(test_front_path, args.scaffold_grid, "frontTopologyResidual", "held-student-prediction-v0"),
            },
            "runtimeProjection": {
                "identity": "arithmetic-only-shared-coarse-student-projection-v0",
                "scaffoldCellCount": scaffold_cells,
                "inputFeatureCount": 185,
                "hiddenWidth": int(args.hidden_width),
                "multiplyAccumulatesPerCell": per_cell_macs,
                "multiplyAccumulatesPerFrame": total_macs,
                "ratioVsMeasuredDenseTeacherTwoHeadArithmetic": projection_ratio,
                "projectedMillisecondsFromMeasuredDenseTeacherRange": projected_range,
                "measuredGpuRuntime": None,
                "capped": False,
                "disclaimer": "Cell-count and MAC scaling only; feature construction, memory traffic, dispatch, interpolation, compaction, and synchronization are not measured here.",
                "decisionBoundariesMs": {"continueBelow": 24, "credibleBelow": 15, "materiallyProfitableBelow": 10},
            },
            "promotion": promotion,
            "limitations": [
                "Three complete teacher front frames provide one train, one validation, and one held test frame only.",
                "Arithmetic projection is not a GPU runtime witness.",
                "No sparse fine-detail head, renderer integration, motion witness, or abrupt-emitter holdout is included.",
            ],
        }
        write_json(manifest_path, report)
        return 0
    except Exception as error:
        if isinstance(error, ScaffoldFailure):
            phase = error.phase
            evidence = error.evidence or evidence
        write_json(manifest_path, {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "producer": producer_receipt(args),
            "error": str(error),
            "lastTrustworthyEvidence": evidence,
        })
        print(f"coarse support/front scaffold failed during {phase}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
