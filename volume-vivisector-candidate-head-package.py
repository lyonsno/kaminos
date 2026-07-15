#!/usr/bin/env python3
"""Train the native-128 to 160 shared coarse/candidate package consumed by Forgemaster."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


PACKAGE_SCHEMA = "kaminos.native-low.vivisector-candidate-head-width32-package.v0"
MANIFEST_SCHEMA = "kaminos.volume.vivisector-candidate-head-training.v0"
IDENTITY = "native128-matched160-shared-coarse-candidate-head-v0"
FEATURE_ORDER = [
    "currentSource[0..16]",
    "sourceDelta[0..16]",
    "normalizedPosition[xyz]",
    "subcell[xyz]",
    "coarseLatent[0..7]",
]
OUTPUT_ORDER = [
    "fineSupport",
    "frontTopologyResidual",
    "temporalFrontDetail",
    "ridgeResidual",
    "fuelResidual",
    "visibleFireCarrierResidual",
    "fireLickResidual",
    "detailResidual",
]
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
SOURCE_CHANNELS = [*FLUID_CHANNELS, "frontTopology"]
ADMISSION_AUTHORITY = "source-manifests-only-fixed-threshold-v0"
ADMISSION_IDENTITY = "fixed-full-source-delta-envelope-trilinear-v2-native128"
FEATURE_IDENTITY = "current-delta-position-subcell-coarse-latent48-v0"
COARSE_LATENT_AUTHORITY = "trained-native128-coarse40-shared-trunk-latent-v0"
PACKAGE_FEATURE_COUNT = 48
HIDDEN_WIDTH = 32
OUTPUT_COUNT = 8
SOURCE_GRID = 128
TARGET_GRID = 160
SCAFFOLD_GRID = 40


class PackageFailure(RuntimeError):
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


def sigmoid(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, -30.0, 30.0)
    return (1.0 / (1.0 + np.exp(-clipped))).astype(np.float32)


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


def trilinear_resize(values: np.ndarray, target: int) -> np.ndarray:
    return resize_axis(resize_axis(resize_axis(values, target, 2), target, 1), target, 0).astype(np.float32)


def block_reduce(values: np.ndarray, target: int, mode: str) -> np.ndarray:
    source = values.shape[0]
    if values.shape != (source, source, source) or source % target != 0:
        raise PackageFailure("dataset-construction", "block reduction requires a divisible cubic field")
    factor = source // target
    shaped = values.reshape(target, factor, target, factor, target, factor)
    axes = (1, 3, 5)
    if mode == "mean":
        return np.mean(shaped, axis=axes, dtype=np.float32)
    if mode == "max":
        return np.max(shaped, axis=axes)
    raise PackageFailure("dataset-construction", f"unsupported block reduction: {mode}")


def artifact(
    descriptor: dict[str, Any], manifest_path: Path, shape: list[int], channels: list[str], label: str,
) -> Path:
    path = Path(str(descriptor.get("path") or ""))
    path = path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()
    if descriptor.get("shape") != shape or descriptor.get("channelOrder") != channels:
        raise PackageFailure("input-validation", f"{label} shape/channel contract differs", {
            "expectedShape": shape, "actualShape": descriptor.get("shape"),
            "expectedChannels": channels, "actualChannels": descriptor.get("channelOrder"),
        })
    if not path.exists() or path.stat().st_size != int(descriptor.get("byteLength") or -1):
        raise PackageFailure("input-validation", f"{label} is missing or has the wrong byte length", {"path": str(path)})
    actual = sha256_file(path)
    if actual != descriptor.get("sha256"):
        raise PackageFailure("input-validation", f"{label} SHA-256 differs", {"expected": descriptor.get("sha256"), "actual": actual})
    return path


def normalized_controls(signature: str, grid: int) -> str:
    parts = signature.split("|")
    token = f"{grid:.4f}"
    indexes = [index for index, value in enumerate(parts) if value == token]
    if len(indexes) != 1:
        raise PackageFailure("input-validation", "controls signature does not contain exactly one grid token", {
            "grid": grid, "matches": indexes,
        })
    parts[indexes[0]] = "<GRID>"
    return "|".join(parts)


def load_export(path: Path, expected_grid: int, step: int) -> dict[str, Any]:
    if not path.exists():
        raise PackageFailure("input-validation", "field manifest is missing", {"path": str(path)})
    manifest_sha = sha256_file(path)
    manifest = json.loads(path.read_text())
    if manifest.get("schema") != "kaminos.volume.full-grid-field-export.v0" or manifest.get("status") != "captured":
        raise PackageFailure("input-validation", "field manifest is not a captured full-grid export", {"path": str(path)})
    if manifest.get("failurePhase") is not None or manifest.get("completeFieldCoverage") is not True:
        raise PackageFailure("input-validation", "field export is partial or failed", {"path": str(path)})
    replay = manifest.get("deterministicReplay") or {}
    if int(manifest.get("grid") or 0) != expected_grid or int(replay.get("completedSteps") or -1) != step:
        raise PackageFailure("input-validation", "field grid or deterministic step differs", {
            "path": str(path), "expectedGrid": expected_grid, "actualGrid": manifest.get("grid"),
            "expectedStep": step, "actualStep": replay.get("completedSteps"),
        })
    route = manifest.get("effectiveRoute") or replay.get("effectiveRoute")
    backend = manifest.get("backend") or replay.get("backend")
    if route != "native-3d-compute-fluid-raymarch-v0" or backend != "WebGPU:apple":
        raise PackageFailure("input-validation", "field route/backend differs", {"route": route, "backend": backend})
    sidecars = manifest.get("sidecars") or {}
    boundary = ((manifest.get("boundarySidecar") or {}).get("sidecars") or {}).get("boundary") or {}
    fluid_desc = sidecars.get("fluid") or {}
    front_desc = sidecars.get("front") or {}
    fluid_path = artifact(fluid_desc, path, [expected_grid, expected_grid, expected_grid, 16], FLUID_CHANNELS, "fluid")
    front_path = artifact(front_desc, path, [expected_grid, expected_grid, expected_grid, 1], ["frontTopology"], "front")
    boundary_path = artifact(
        boundary, path, [expected_grid, expected_grid, expected_grid, 4],
        ["support", "coverage", "ridge", "footprint"], "boundary sidecar",
    )
    cell_count = expected_grid ** 3
    return {
        "step": step,
        "grid": expected_grid,
        "manifestPath": str(path),
        "manifestSha256": manifest_sha,
        "route": route,
        "backend": backend,
        "controlsSignature": replay.get("controlsSignature"),
        "controlsNormalized": normalized_controls(str(replay.get("controlsSignature") or ""), expected_grid),
        "fluid": np.memmap(fluid_path, dtype="<f4", mode="r", shape=(cell_count, 16)),
        "front": np.memmap(front_path, dtype="<f4", mode="r", shape=(cell_count,)),
        "boundary": np.memmap(boundary_path, dtype="<f4", mode="r", shape=(cell_count, 4)),
        "hashes": {
            "fluid": fluid_desc["sha256"], "front": front_desc["sha256"], "boundary": boundary["sha256"],
        },
    }


def load_corpus(root: Path, steps: list[int]) -> dict[int, dict[str, Any]]:
    frames: dict[int, dict[str, Any]] = {}
    for step in steps:
        low = load_export(root / f"native128-step{step}" / "manifest.json", SOURCE_GRID, step)
        high = load_export(root / f"teacher160-step{step}" / "manifest.json", TARGET_GRID, step)
        if low["controlsNormalized"] != high["controlsNormalized"]:
            raise PackageFailure("input-validation", "native and teacher controls differ beyond grid resolution", {"step": step})
        frames[step] = {"low": low, "high": high}
    controls = {frame["low"]["controlsNormalized"] for frame in frames.values()}
    routes = {(frame["low"]["route"], frame["low"]["backend"], frame["high"]["route"], frame["high"]["backend"]) for frame in frames.values()}
    if len(controls) != 1 or len(routes) != 1:
        raise PackageFailure("input-validation", "cross-step controls or route/backend identity differs")
    for role in ("low", "high"):
        hashes = [(frame[role]["hashes"]["fluid"], frame[role]["hashes"]["front"]) for frame in frames.values()]
        if len(set(hashes)) != len(hashes):
            raise PackageFailure("split-validation", f"duplicate {role} field hashes across deterministic steps")
    return frames


def source_channel(frame: dict[str, Any], channel: int) -> np.ndarray:
    low = frame["low"]
    grid = int(low["grid"])
    if channel < 16:
        return np.asarray(low["fluid"][:, channel], dtype=np.float32).reshape(grid, grid, grid)
    return np.asarray(low["front"], dtype=np.float32).reshape(grid, grid, grid)


def high_channel(frame: dict[str, Any], channel: int) -> np.ndarray:
    high = frame["high"]
    grid = int(high["grid"])
    if channel < 16:
        return np.asarray(high["fluid"][:, channel], dtype=np.float32).reshape(grid, grid, grid)
    return np.asarray(high["front"], dtype=np.float32).reshape(grid, grid, grid)


def boundary_channel(frame: dict[str, Any], role: str, channel: int) -> np.ndarray:
    side = frame[role]
    grid = int(side["grid"])
    return np.asarray(side["boundary"][:, channel], dtype=np.float32).reshape(grid, grid, grid)


def source_to_scaffold(frame: dict[str, Any]) -> np.ndarray:
    mapping = np.minimum(SOURCE_GRID - 1, np.floor(np.arange(TARGET_GRID) * SOURCE_GRID / TARGET_GRID).astype(np.intp))
    columns = []
    for channel in range(17):
        low = source_channel(frame, channel)
        mapped = low[np.ix_(mapping, mapping, mapping)]
        columns.append(block_reduce(mapped, SCAFFOLD_GRID, "mean").reshape(-1))
    return np.stack(columns, axis=1).astype(np.float32)


def spatial_features(grid: int) -> tuple[np.ndarray, np.ndarray]:
    z, y, x = np.indices((grid, grid, grid), dtype=np.int32)
    normalized = np.stack([x.reshape(-1), y.reshape(-1), z.reshape(-1)], axis=1).astype(np.float32)
    normalized = normalized / np.float32(max(1, grid - 1)) * 2.0 - 1.0
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
    return position.astype(np.float32), np.concatenate((np.stack(fourier, axis=1), np.stack(rbf, axis=1)), axis=1).astype(np.float32)


def coarse_dataset(frame: dict[str, Any]) -> dict[str, np.ndarray]:
    low = source_to_scaffold(frame)
    position, basis = spatial_features(SCAFFOLD_GRID)
    features = np.concatenate((low, low * low, position, basis), axis=1).astype(np.float32)
    if features.shape[1] != 185:
        raise PackageFailure("dataset-construction", "coarse feature count differs from 185", {"shape": list(features.shape)})
    high_support = boundary_channel(frame, "high", 0)
    support = (block_reduce(high_support, SCAFFOLD_GRID, "max") >= np.float32(0.5)).reshape(-1)
    low_front = trilinear_resize(source_channel(frame, 16), TARGET_GRID)
    front_residual = high_channel(frame, 16) - low_front
    front = block_reduce(front_residual, SCAFFOLD_GRID, "mean").reshape(-1).astype(np.float32)
    return {"features": features, "support": support, "front": front}


def adam_update(state: dict[str, np.ndarray], gradients: dict[str, np.ndarray], moments: dict[str, dict[str, np.ndarray]], update: int, learning_rate: float) -> None:
    for name, gradient in gradients.items():
        gradient = np.asarray(gradient, dtype=np.float32)
        moments["first"][name] = 0.9 * moments["first"][name] + 0.1 * gradient
        moments["second"][name] = 0.999 * moments["second"][name] + 0.001 * gradient * gradient
        first = moments["first"][name] / (1.0 - 0.9 ** update)
        second = moments["second"][name] / (1.0 - 0.999 ** update)
        state[name] = np.asarray(state[name] - np.float32(learning_rate) * first / (np.sqrt(second) + 1.0e-8), dtype=np.float32)


def train_coarse(datasets: list[dict[str, np.ndarray]], args: argparse.Namespace) -> tuple[dict[str, Any], list[dict[str, float]]]:
    features = np.concatenate([value["features"] for value in datasets], axis=0)
    support = np.concatenate([value["support"] for value in datasets]).astype(np.float32)
    front = np.concatenate([value["front"] for value in datasets]).astype(np.float32)
    mean = np.mean(features, axis=0, dtype=np.float64).astype(np.float32)
    std = np.std(features, axis=0, dtype=np.float64).astype(np.float32)
    std[std < 1.0e-6] = 1.0
    features = ((features - mean) / std).astype(np.float32)
    rng = np.random.default_rng(args.seed)
    state: dict[str, Any] = {
        "featureMean": mean, "featureStd": std,
        "w1": rng.normal(0.0, math.sqrt(2.0 / 185), (185, HIDDEN_WIDTH)).astype(np.float32),
        "b1": np.zeros(HIDDEN_WIDTH, np.float32),
        "supportW": rng.normal(0.0, math.sqrt(1.0 / HIDDEN_WIDTH), HIDDEN_WIDTH).astype(np.float32),
        "supportB": np.zeros((), np.float32),
        "frontW": rng.normal(0.0, math.sqrt(1.0 / HIDDEN_WIDTH), HIDDEN_WIDTH).astype(np.float32),
        "frontB": np.zeros((), np.float32),
        "frontMean": np.float32(np.mean(front)),
        "frontStd": np.float32(max(float(np.std(front)), 1.0e-6)),
    }
    front_target = ((front - state["frontMean"]) / state["frontStd"]).astype(np.float32)
    positive = int(np.count_nonzero(support))
    positive_weight = np.float32((support.size - positive) / max(1, positive))
    names = ("w1", "b1", "supportW", "supportB", "frontW", "frontB")
    moments = {kind: {name: np.zeros_like(state[name], np.float32) for name in names} for kind in ("first", "second")}
    losses = []
    update = 0
    for epoch in range(args.coarse_epochs):
        order = rng.permutation(features.shape[0])
        epoch_support = epoch_front = 0.0
        batches = 0
        for start in range(0, order.size, args.batch_size):
            batch = order[start:start + args.batch_size]
            x = features[batch]
            ys = support[batch]
            yf = front_target[batch]
            hidden = np.tanh(x @ state["w1"] + state["b1"])
            probability = sigmoid(hidden @ state["supportW"] + state["supportB"])
            front_prediction = hidden @ state["frontW"] + state["frontB"]
            weights = np.where(ys > 0.5, positive_weight, np.float32(1.0))
            ds = (probability - ys) * weights / max(float(np.sum(weights)), 1.0)
            df = np.float32(2.0 / max(1, batch.size)) * (front_prediction - yf)
            gradients = {
                "supportW": hidden.T @ ds + args.weight_decay * state["supportW"],
                "supportB": np.asarray(np.sum(ds), np.float32),
                "frontW": hidden.T @ df + args.weight_decay * state["frontW"],
                "frontB": np.asarray(np.sum(df), np.float32),
            }
            dh = ds[:, None] * state["supportW"][None, :] + df[:, None] * state["frontW"][None, :]
            dz = dh * (1.0 - hidden * hidden)
            gradients["w1"] = x.T @ dz + args.weight_decay * state["w1"]
            gradients["b1"] = np.sum(dz, axis=0)
            update += 1
            adam_update(state, gradients, moments, update, args.learning_rate)
            epoch_support += float(np.mean(-weights * (ys * np.log(np.maximum(probability, 1e-7)) + (1 - ys) * np.log(np.maximum(1 - probability, 1e-7)))))
            epoch_front += float(np.mean((front_prediction - yf) ** 2))
            batches += 1
        losses.append({"epoch": epoch + 1, "supportWeightedBce": epoch_support / batches, "frontNormalizedMse": epoch_front / batches})
    return state, losses


def coarse_predict(dataset: dict[str, np.ndarray], state: dict[str, Any]) -> dict[str, np.ndarray]:
    normalized = ((dataset["features"] - state["featureMean"]) / state["featureStd"]).astype(np.float32)
    hidden = np.tanh(normalized @ state["w1"] + state["b1"]).astype(np.float32)
    support = sigmoid(hidden @ state["supportW"] + state["supportB"])
    front = ((hidden @ state["frontW"] + state["frontB"]) * state["frontStd"] + state["frontMean"]).astype(np.float32)
    return {"hidden": hidden, "support": support, "front": front}


def calibrate_gate(previous: dict[str, Any], current: dict[str, Any], scale_quantile: float, coverage_quantile: float) -> dict[str, Any]:
    scales = []
    score_source = np.zeros((SOURCE_GRID, SOURCE_GRID, SOURCE_GRID), np.float32)
    for channel in range(17):
        delta = np.abs(source_channel(current, channel) - source_channel(previous, channel))
        scale = np.float32(max(float(np.quantile(delta.astype(np.float64), scale_quantile, method="linear")), 1.0e-8))
        scales.append(scale)
        score_source = np.maximum(score_source, np.clip(delta / scale, 0.0, 1.0))
    score = trilinear_resize(score_source, TARGET_GRID)
    threshold = float(np.quantile(score.astype(np.float64), coverage_quantile, method="linear"))
    return {"scales": np.asarray(scales, np.float32), "threshold": threshold, "score": score}


def source_gate(previous: dict[str, Any], current: dict[str, Any], calibration: dict[str, Any]) -> dict[str, Any]:
    score_source = np.zeros((SOURCE_GRID, SOURCE_GRID, SOURCE_GRID), np.float32)
    for channel in range(17):
        delta = np.abs(source_channel(current, channel) - source_channel(previous, channel))
        score_source = np.maximum(score_source, np.clip(delta / calibration["scales"][channel], 0.0, 1.0))
    score = trilinear_resize(score_source, TARGET_GRID)
    mask = score >= np.float32(calibration["threshold"])
    indexes = np.flatnonzero(mask.reshape(-1))
    return {"score": score, "mask": mask, "indexes": indexes, "candidateCount": int(indexes.size), "coverage": float(np.mean(mask))}


def position_subcell(indexes: np.ndarray) -> tuple[list[np.ndarray], list[np.ndarray]]:
    x = indexes % TARGET_GRID
    y = (indexes // TARGET_GRID) % TARGET_GRID
    z = indexes // (TARGET_GRID * TARGET_GRID)
    denominator = np.float32(TARGET_GRID - 1)
    normalized = [axis.astype(np.float32) / denominator * 2.0 - 1.0 for axis in (x, y, z)]
    subcell = []
    for axis in (x, y, z):
        coordinate = (axis.astype(np.float32) + 0.5) * (SOURCE_GRID / TARGET_GRID) - 0.5
        subcell.append((coordinate - np.floor(coordinate)) * 2.0 - 1.0)
    return normalized, subcell


def candidate_feature_matrix(
    previous: dict[str, Any], current: dict[str, Any], coarse_hidden: np.ndarray, indexes: np.ndarray,
) -> np.ndarray:
    columns = []
    for channel in range(17):
        current_field = source_channel(current, channel)
        previous_field = source_channel(previous, channel)
        columns.append(trilinear_resize(current_field, TARGET_GRID).reshape(-1)[indexes])
        # Deltas are appended after all current channels to preserve receiver order.
    for channel in range(17):
        delta = source_channel(current, channel) - source_channel(previous, channel)
        columns.append(trilinear_resize(delta, TARGET_GRID).reshape(-1)[indexes])
    normalized, subcell = position_subcell(indexes)
    columns.extend(normalized)
    columns.extend(subcell)
    latent = coarse_hidden[:, :8].reshape(SCAFFOLD_GRID, SCAFFOLD_GRID, SCAFFOLD_GRID, 8)
    for channel in range(8):
        columns.append(trilinear_resize(latent[..., channel], TARGET_GRID).reshape(-1)[indexes])
    features = np.stack(columns, axis=1).astype(np.float32)
    if features.shape[1] != PACKAGE_FEATURE_COUNT or not np.all(np.isfinite(features)):
        raise PackageFailure("feature-construction", "candidate feature matrix differs from 48 finite columns", {"shape": list(features.shape)})
    return features


def residual_field(frame: dict[str, Any], channel: int) -> np.ndarray:
    return high_channel(frame, channel) - trilinear_resize(source_channel(frame, channel), TARGET_GRID)


def candidate_targets(previous: dict[str, Any], current: dict[str, Any], indexes: np.ndarray) -> np.ndarray:
    support = boundary_channel(current, "high", 0).reshape(-1)[indexes]
    front = residual_field(current, 16)
    previous_front = residual_field(previous, 16)
    temporal = front - previous_front
    ridge = boundary_channel(current, "high", 2) - trilinear_resize(boundary_channel(current, "low", 2), TARGET_GRID)
    fields = [
        support,
        front.reshape(-1)[indexes],
        temporal.reshape(-1)[indexes],
        ridge.reshape(-1)[indexes],
        residual_field(current, 6).reshape(-1)[indexes],
        residual_field(current, 10).reshape(-1)[indexes],
        residual_field(current, 14).reshape(-1)[indexes],
        residual_field(current, 7).reshape(-1)[indexes],
    ]
    targets = np.stack(fields, axis=1).astype(np.float32)
    if targets.shape[1] != OUTPUT_COUNT or not np.all(np.isfinite(targets)):
        raise PackageFailure("dataset-construction", "candidate target matrix differs from eight finite outputs")
    return targets


def train_candidate(feature_sets: list[np.ndarray], target_sets: list[np.ndarray], args: argparse.Namespace) -> tuple[dict[str, Any], list[dict[str, float]]]:
    features = np.concatenate(feature_sets, axis=0)
    targets = np.concatenate(target_sets, axis=0)
    feature_mean = np.mean(features, axis=0, dtype=np.float64).astype(np.float32)
    feature_std = np.std(features, axis=0, dtype=np.float64).astype(np.float32)
    feature_std[feature_std < 1.0e-6] = 1.0
    regression_mean = np.mean(targets[:, 1:], axis=0, dtype=np.float64).astype(np.float32)
    regression_std = np.std(targets[:, 1:], axis=0, dtype=np.float64).astype(np.float32)
    regression_std[regression_std < 1.0e-6] = 1.0
    features = ((features - feature_mean) / feature_std).astype(np.float32)
    regression = ((targets[:, 1:] - regression_mean) / regression_std).astype(np.float32)
    support = np.clip(targets[:, 0], 0.0, 1.0).astype(np.float32)
    rng = np.random.default_rng(args.seed + 1)
    state: dict[str, Any] = {
        "featureMean": feature_mean, "featureStd": feature_std,
        "targetMean": regression_mean, "targetStd": regression_std,
        "w1": rng.normal(0.0, math.sqrt(2.0 / PACKAGE_FEATURE_COUNT), (PACKAGE_FEATURE_COUNT, HIDDEN_WIDTH)).astype(np.float32),
        "b1": np.zeros(HIDDEN_WIDTH, np.float32),
        "w2": rng.normal(0.0, math.sqrt(1.0 / HIDDEN_WIDTH), (HIDDEN_WIDTH, OUTPUT_COUNT)).astype(np.float32),
        "b2": np.zeros(OUTPUT_COUNT, np.float32),
    }
    names = ("w1", "b1", "w2", "b2")
    moments = {kind: {name: np.zeros_like(state[name], np.float32) for name in names} for kind in ("first", "second")}
    losses = []
    update = 0
    for epoch in range(args.candidate_epochs):
        order = rng.permutation(features.shape[0])
        support_loss = regression_loss = 0.0
        batches = 0
        for start in range(0, order.size, args.batch_size):
            batch = order[start:start + args.batch_size]
            x = features[batch]
            ys = support[batch]
            yr = regression[batch]
            hidden = np.tanh(x @ state["w1"] + state["b1"])
            raw = hidden @ state["w2"] + state["b2"]
            probability = sigmoid(raw[:, 0])
            regression_prediction = raw[:, 1:]
            d_raw = np.zeros_like(raw, np.float32)
            d_raw[:, 0] = (probability - ys) / max(1, batch.size)
            d_raw[:, 1:] = np.float32(2.0 / max(1, batch.size * 7)) * (regression_prediction - yr)
            gradients = {
                "w2": hidden.T @ d_raw + args.weight_decay * state["w2"],
                "b2": np.sum(d_raw, axis=0),
            }
            dh = d_raw @ state["w2"].T
            dz = dh * (1.0 - hidden * hidden)
            gradients["w1"] = x.T @ dz + args.weight_decay * state["w1"]
            gradients["b1"] = np.sum(dz, axis=0)
            update += 1
            adam_update(state, gradients, moments, update, args.learning_rate)
            support_loss += float(np.mean(-(ys * np.log(np.maximum(probability, 1e-7)) + (1 - ys) * np.log(np.maximum(1 - probability, 1e-7)))))
            regression_loss += float(np.mean((regression_prediction - yr) ** 2))
            batches += 1
        losses.append({"epoch": epoch + 1, "supportBce": support_loss / batches, "normalizedRegressionMse": regression_loss / batches})
    return state, losses


def candidate_predict(features: np.ndarray, state: dict[str, Any]) -> np.ndarray:
    normalized = ((features - state["featureMean"]) / state["featureStd"]).astype(np.float32)
    hidden = np.tanh(normalized @ state["w1"] + state["b1"])
    raw = hidden @ state["w2"] + state["b2"]
    output = np.empty_like(raw, np.float32)
    output[:, 0] = sigmoid(raw[:, 0])
    output[:, 1:] = raw[:, 1:] * state["targetStd"] + state["targetMean"]
    return output


def regression_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    error = prediction.astype(np.float64) - truth.astype(np.float64)
    baseline = truth.astype(np.float64)
    baseline_sse = float(np.sum(baseline * baseline))
    error_sse = float(np.sum(error * error))
    correlation = 0.0 if np.std(prediction) < 1e-12 or np.std(truth) < 1e-12 else float(np.corrcoef(prediction, truth)[0, 1])
    return {
        "rmse": float(np.sqrt(np.mean(error * error))),
        "mae": float(np.mean(np.abs(error))),
        "correlation": correlation,
        "errorReductionVsZeroResidual": float(1.0 - error_sse / max(baseline_sse, 1e-20)),
        "truthEnergy": baseline_sse,
        "predictionEnergy": float(np.sum(prediction.astype(np.float64) ** 2)),
    }


def support_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, float | int]:
    predicted = prediction >= 0.5
    actual = truth >= 0.5
    tp = int(np.count_nonzero(predicted & actual))
    fp = int(np.count_nonzero(predicted & ~actual))
    fn = int(np.count_nonzero(~predicted & actual))
    return {
        "rowCount": int(truth.size), "positiveCount": int(np.count_nonzero(actual)),
        "predictedPositiveCount": int(np.count_nonzero(predicted)),
        "precision": float(tp / max(1, tp + fp)), "recall": float(tp / max(1, tp + fn)),
        "jaccard": float(tp / max(1, tp + fp + fn)), "threshold": 0.5,
    }


def parse_steps(raw: str) -> list[int]:
    values = [int(value) for value in raw.split(",") if value.strip()]
    if not values or values != sorted(set(values)):
        raise PackageFailure("arguments", "steps must be a nonempty sorted unique comma list")
    return values


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-self-test", action="store_true")
    parser.add_argument("--corpus-root")
    parser.add_argument("--out-dir")
    parser.add_argument("--steps", default="96,97,98,99,100,101,102,103,104")
    parser.add_argument("--train-current-steps", default="97,98,99")
    parser.add_argument("--validation-current-step", type=int, default=100)
    parser.add_argument("--held-current-steps", default="101,102,103,104")
    parser.add_argument("--scale-quantile", type=float, default=0.995)
    parser.add_argument("--coverage-quantile", type=float, default=0.9)
    parser.add_argument("--coarse-epochs", type=int, default=10)
    parser.add_argument("--candidate-epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--seed", type=int, default=71532)
    return parser.parse_args()


def contract_self_test() -> dict[str, Any]:
    return {
        "ok": True, "featureCount": PACKAGE_FEATURE_COUNT, "hiddenWidth": HIDDEN_WIDTH,
        "outputCount": OUTPUT_COUNT, "featureOrder": FEATURE_ORDER, "outputOrder": OUTPUT_ORDER,
        "sourceOnlyAdmission": True, "runtimeTopK": False, "hiddenCandidateCap": False,
        "targetErrorRankingUsed": False,
    }


def producer_receipt(args: argparse.Namespace) -> dict[str, Any]:
    path = Path(__file__).resolve()
    return {
        "identity": path.name, "scriptPath": str(path), "scriptSha256": sha256_file(path),
        "invocation": {
            "coarseEpochs": args.coarse_epochs, "candidateEpochs": args.candidate_epochs,
            "batchSize": args.batch_size, "learningRate": args.learning_rate,
            "weightDecay": args.weight_decay, "seed": args.seed,
        },
    }


def main() -> int:
    args = parse_args()
    if args.contract_self_test:
        print(json.dumps(contract_self_test()))
        return 0
    out_dir = Path(args.out_dir or "/tmp/kaminos-vivisector-candidate-head-package-failed").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    phase = "arguments"
    evidence: dict[str, Any] = {}
    try:
        if not args.corpus_root or not args.out_dir:
            raise PackageFailure(phase, "--corpus-root and --out-dir are required")
        steps = parse_steps(args.steps)
        train_steps = parse_steps(args.train_current_steps)
        held_steps = parse_steps(args.held_current_steps)
        validation_step = int(args.validation_current_step)
        required = set(train_steps + held_steps + [validation_step] + [step - 1 for step in train_steps + held_steps + [validation_step]])
        if not required.issubset(set(steps)):
            raise PackageFailure(phase, "transition steps are not covered by --steps", {"missing": sorted(required - set(steps))})
        if set(train_steps) & (set(held_steps) | {validation_step}) or set(held_steps) & {validation_step}:
            raise PackageFailure(phase, "train, validation, and held current-step sets overlap")
        if HIDDEN_WIDTH != 32 or PACKAGE_FEATURE_COUNT != 48 or OUTPUT_COUNT != 8:
            raise PackageFailure(phase, "fixed receiver model dimensions differ")

        phase = "input-validation"
        corpus_root = Path(args.corpus_root).resolve()
        frames = load_corpus(corpus_root, steps)
        evidence["corpus"] = {
            str(step): {
                "nativeManifestPath": frames[step]["low"]["manifestPath"],
                "nativeManifestSha256": frames[step]["low"]["manifestSha256"],
                "teacherManifestPath": frames[step]["high"]["manifestPath"],
                "teacherManifestSha256": frames[step]["high"]["manifestSha256"],
            } for step in steps
        }

        phase = "coarse-dataset"
        coarse_data = {step: coarse_dataset(frames[step]) for step in sorted(set(train_steps + [validation_step] + held_steps))}
        coarse_state, coarse_losses = train_coarse([coarse_data[step] for step in train_steps], args)
        coarse_predictions = {step: coarse_predict(dataset, coarse_state) for step, dataset in coarse_data.items()}

        phase = "source-gate-calibration"
        calibration = calibrate_gate(frames[train_steps[0] - 1], frames[train_steps[0]], args.scale_quantile, args.coverage_quantile)
        admission = {
            "identity": ADMISSION_IDENTITY,
            "authority": ADMISSION_AUTHORITY,
            "sourceOnlyThresholdRule": "first-train-transition-channel-qscale-max-envelope-dense-quantile-v0",
            "scaleQuantile": args.scale_quantile,
            "coverageCalibrationQuantile": args.coverage_quantile,
            "channelScales": calibration["scales"].tolist(),
            "threshold": calibration["threshold"],
            "runtimeTruthUsed": False,
            "targetArtifactsReadForAdmission": False,
            "targetErrorRankingUsed": False,
            "runtimeTopK": False,
            "dynamicPercentile": False,
            "hiddenCandidateCap": False,
            "candidateListSource": "real-uncapped-fixed-gate-sourceHistoryCandidates-v0",
            "pairs": {},
        }

        phase = "candidate-dataset"
        transition_cache: dict[int, dict[str, Any]] = {}
        for current_step in train_steps + [validation_step] + held_steps:
            previous_step = current_step - 1
            gate = source_gate(frames[previous_step], frames[current_step], calibration)
            features = candidate_feature_matrix(
                frames[previous_step], frames[current_step], coarse_predictions[current_step]["hidden"], gate["indexes"],
            )
            targets = candidate_targets(frames[previous_step], frames[current_step], gate["indexes"])
            transition_cache[current_step] = {"gate": gate, "features": features, "targets": targets}
            admission["pairs"][f"{previous_step}-{current_step}"] = {
                "candidateCount": gate["candidateCount"], "coverage": gate["coverage"],
                "candidateIndexesSha256": sha256_bytes(gate["indexes"].astype("<u4", copy=False).tobytes()),
            }

        phase = "candidate-fit"
        candidate_state, candidate_losses = train_candidate(
            [transition_cache[step]["features"] for step in train_steps],
            [transition_cache[step]["targets"] for step in train_steps],
            args,
        )

        phase = "held-evaluation"
        metrics: dict[str, Any] = {}
        cue_pack = []
        for current_step in [validation_step] + held_steps:
            transition = transition_cache[current_step]
            prediction = candidate_predict(transition["features"], candidate_state)
            truth = transition["targets"]
            coarse_prediction = coarse_predictions[current_step]
            coarse_truth = coarse_data[current_step]
            coarse_outputs = {
                "support": support_metrics(coarse_prediction["support"], coarse_truth["support"]),
                "frontTopologyResidual": regression_metrics(coarse_prediction["front"], coarse_truth["front"]),
            }
            per_output: dict[str, Any] = {"fineSupport": support_metrics(prediction[:, 0], truth[:, 0])}
            for index, name in enumerate(OUTPUT_ORDER[1:], start=1):
                per_output[name] = regression_metrics(prediction[:, index], truth[:, index])
            metrics[str(current_step)] = {
                "role": "validation" if current_step == validation_step else "held",
                "previousStep": current_step - 1,
                "candidateCount": transition["gate"]["candidateCount"],
                "coverage": transition["gate"]["coverage"],
                "coarseOutputs": coarse_outputs,
                "outputs": per_output,
            }
            if current_step in held_steps:
                dense = np.zeros((TARGET_GRID ** 3, OUTPUT_COUNT), np.float32)
                dense[transition["gate"]["indexes"]] = prediction
                cue_path = out_dir / f"held-step{current_step}-compact-cues.f32"
                cue_path.write_bytes(dense.astype("<f4", copy=False).tobytes())
                mask_path = out_dir / f"held-step{current_step}-source-gate.u8"
                mask_path.write_bytes(transition["gate"]["mask"].astype(np.uint8, copy=False).tobytes())
                cue_pack.append({
                    "step": current_step,
                    "previousStep": current_step - 1,
                    "cue": {
                        "path": str(cue_path), "sha256": sha256_file(cue_path), "byteLength": cue_path.stat().st_size,
                        "dtype": "float32-le", "shape": [TARGET_GRID, TARGET_GRID, TARGET_GRID, OUTPUT_COUNT],
                        "channelOrder": OUTPUT_ORDER,
                    },
                    "admissionMask": {
                        "path": str(mask_path), "sha256": sha256_file(mask_path), "byteLength": mask_path.stat().st_size,
                        "dtype": "uint8", "shape": [TARGET_GRID, TARGET_GRID, TARGET_GRID, 1],
                        "channelOrder": ["sourceHistoryCandidate"],
                    },
                })

        phase = "checkpoint-write"
        bindings = {
            "corpus": evidence["corpus"], "admission": admission,
            "trainCurrentSteps": train_steps, "validationCurrentStep": validation_step, "heldCurrentSteps": held_steps,
        }
        weights_path = out_dir / "vivisector-candidate-head-width32-weights.npz"
        np.savez_compressed(
            weights_path,
            schema=np.asarray([PACKAGE_SCHEMA]), identity=np.asarray([IDENTITY]),
            featureOrder=np.asarray(FEATURE_ORDER), outputOrder=np.asarray(OUTPUT_ORDER),
            coarseFeatureMean=coarse_state["featureMean"], coarseFeatureStd=coarse_state["featureStd"],
            coarseW1=coarse_state["w1"], coarseB1=coarse_state["b1"],
            coarseSupportW=coarse_state["supportW"], coarseSupportB=np.asarray([coarse_state["supportB"]], np.float32),
            coarseFrontW=coarse_state["frontW"], coarseFrontB=np.asarray([coarse_state["frontB"]], np.float32),
            coarseFrontMean=np.asarray([coarse_state["frontMean"]], np.float32),
            coarseFrontStd=np.asarray([coarse_state["frontStd"]], np.float32),
            candidateFeatureMean=candidate_state["featureMean"], candidateFeatureStd=candidate_state["featureStd"],
            candidateTargetMean=candidate_state["targetMean"], candidateTargetStd=candidate_state["targetStd"],
            candidateW1=candidate_state["w1"], candidateB1=candidate_state["b1"],
            candidateW2=candidate_state["w2"], candidateB2=candidate_state["b2"],
            admissionScales=calibration["scales"], admissionThreshold=np.asarray([calibration["threshold"]], np.float32),
            bindingsJson=np.asarray([json.dumps(bindings, sort_keys=True)]),
        )
        weights_sha = sha256_file(weights_path)

        phase = "checkpoint-replay"
        with np.load(weights_path, allow_pickle=False) as replay:
            if str(replay["schema"][0]) != PACKAGE_SCHEMA or str(replay["identity"][0]) != IDENTITY:
                raise PackageFailure(phase, "checkpoint schema/identity replay differs")
            if replay["featureOrder"].tolist() != FEATURE_ORDER or replay["outputOrder"].tolist() != OUTPUT_ORDER:
                raise PackageFailure(phase, "checkpoint feature/output order replay differs")
            if json.loads(str(replay["bindingsJson"][0])) != bindings:
                raise PackageFailure(phase, "checkpoint source bindings replay differs")
            replay_state = {
                "featureMean": replay["candidateFeatureMean"].astype(np.float32),
                "featureStd": replay["candidateFeatureStd"].astype(np.float32),
                "targetMean": replay["candidateTargetMean"].astype(np.float32),
                "targetStd": replay["candidateTargetStd"].astype(np.float32),
                "w1": replay["candidateW1"].astype(np.float32), "b1": replay["candidateB1"].astype(np.float32),
                "w2": replay["candidateW2"].astype(np.float32), "b2": replay["candidateB2"].astype(np.float32),
            }
        replay_step = held_steps[-1]
        direct = candidate_predict(transition_cache[replay_step]["features"], candidate_state)
        replayed = candidate_predict(transition_cache[replay_step]["features"], replay_state)
        if not np.array_equal(direct, replayed):
            raise PackageFailure(phase, "serialized candidate output differs from in-memory output")

        coarse_macs = SCAFFOLD_GRID ** 3 * (185 * HIDDEN_WIDTH + HIDDEN_WIDTH * 2)
        held_counts = [transition_cache[step]["gate"]["candidateCount"] for step in held_steps]
        candidate_count = int(round(float(np.mean(held_counts))))
        candidate_macs = candidate_count * (PACKAGE_FEATURE_COUNT * HIDDEN_WIDTH + HIDDEN_WIDTH * OUTPUT_COUNT)
        total_macs = coarse_macs + candidate_macs
        throughput_low = 118.0e9
        throughput_high = 216.0e9
        projection = {
            "identity": "arithmetic-mac-throughput-envelope-not-measured-runtime-v0",
            "measured": False,
            "omits": ["feature construction", "source admission", "memory traffic", "dispatch overhead", "coarse latent interpolation"],
            "coarseMacs": int(coarse_macs), "candidateMacsAtMeanHeldCount": int(candidate_macs),
            "combinedMacs": int(total_macs), "meanHeldCandidateCount": candidate_count,
            "throughputEnvelopeMacPerSecond": [throughput_low, throughput_high],
            "projectedMilliseconds": [float(total_macs / throughput_high * 1000.0), float(total_macs / throughput_low * 1000.0)],
        }

        phase = "package-write"
        package_path = out_dir / "vivisector-candidate-head-package.json"
        package = {
            "schema": PACKAGE_SCHEMA,
            "identity": IDENTITY,
            "authority": "matched-native128-source-to-current160-teacher-trained-weights-v0",
            "syntheticBenchmarkWeights": False,
            "trainedWeights": True,
            "vivisectorTrainedWeights": True,
            "learnedWeightsUsed": True,
            "fidelityClaim": False,
            "visualClaim": False,
            "grid": {
                "sourceLowGrid": SOURCE_GRID, "receiverHighGrid": TARGET_GRID, "candidateGrid": TARGET_GRID,
                "sourceChannels": 17, "sourceDeltaChannels": 17,
            },
            "runtimeShape": {
                "candidateHeadWidth": HIDDEN_WIDTH, "workgroupSize": 64, "inputCount": PACKAGE_FEATURE_COUNT,
                "candidateListSource": "real-uncapped-fixed-gate-sourceHistoryCandidates-v0",
                "dispatchMode": "dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0",
            },
            "inputSchema": {
                "identity": FEATURE_IDENTITY,
                "currentSourceChannels": 17, "sourceDeltaChannels": 17,
                "normalizedPositionAndSubcell": True, "coarseLatentChannels": 8,
                "coarseLatentAuthority": COARSE_LATENT_AUTHORITY,
                "featureOrder": FEATURE_ORDER,
            },
            "outputSchema": {
                "identity": "compact-renderer-facing-cue-record-v0",
                "cueRecordStrideBytes": 32, "outputChannels": OUTPUT_COUNT, "cueRecordVec4Count": 2,
                "channelOrder": OUTPUT_ORDER,
            },
            "model": {
                "identity": IDENTITY, "sourceDiaulos": "pyro-field-residual-vivisector", "sha256": weights_sha,
                "weightsPath": str(weights_path),
                "coarse": {"grid": SCAFFOLD_GRID, "inputCount": 185, "hiddenWidth": HIDDEN_WIDTH, "latentChannels": 8},
                "candidate": {"inputCount": PACKAGE_FEATURE_COUNT, "hiddenWidth": HIDDEN_WIDTH, "outputCount": OUTPUT_COUNT},
            },
            "checksums": {"weightsSha256": weights_sha},
            "admission": admission,
            "splits": {"trainCurrentSteps": train_steps, "validationCurrentStep": validation_step, "heldCurrentSteps": held_steps},
            "metrics": metrics,
            "crossStepFieldPack": cue_pack,
            "training": {"coarseLosses": coarse_losses, "candidateLosses": candidate_losses},
            "runtimeProjection": projection,
            "producer": producer_receipt(args),
            "failurePhase": None,
        }
        write_json(package_path, package)
        manifest = {
            "schema": MANIFEST_SCHEMA, "identity": IDENTITY, "status": "captured", "failurePhase": None,
            "package": {"path": str(package_path), "sha256": sha256_file(package_path)},
            "weights": {"path": str(weights_path), "sha256": weights_sha, "byteLength": weights_path.stat().st_size},
            "route": "native-3d-compute-fluid-raymarch-v0", "backend": "WebGPU:apple",
            "sourceGrid": SOURCE_GRID, "targetGrid": TARGET_GRID,
            "sourceBindings": evidence["corpus"], "admission": admission,
            "heldMetrics": {step: metrics[str(step)] for step in held_steps},
            "runtimeProjection": projection, "producer": producer_receipt(args),
            "nonClaims": ["no visual benefit claim", "no fidelity claim", "runtime projection is not a measured GPU witness"],
        }
        write_json(manifest_path, manifest)
        print(json.dumps({
            "ok": True, "manifest": str(manifest_path), "package": str(package_path), "weightsSha256": weights_sha,
            "heldCandidateCounts": held_counts, "projectedMilliseconds": projection["projectedMilliseconds"],
        }, indent=2))
        return 0
    except Exception as error:
        failure_phase = error.phase if isinstance(error, PackageFailure) else phase
        failure_evidence = error.evidence if isinstance(error, PackageFailure) else {}
        write_json(manifest_path, {
            "schema": MANIFEST_SCHEMA, "identity": IDENTITY, "status": "failed", "failurePhase": failure_phase,
            "error": str(error), "lastTrustworthyEvidence": {**evidence, **failure_evidence},
            "runtimeTruthUsedForAdmission": False, "targetErrorRankingUsed": False,
            "hiddenCandidateCap": False, "producer": producer_receipt(args),
        })
        print(json.dumps({"ok": False, "manifest": str(manifest_path), "failurePhase": failure_phase, "error": str(error)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
