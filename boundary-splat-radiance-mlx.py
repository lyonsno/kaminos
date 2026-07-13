#!/usr/bin/env python3
import argparse
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np
from PIL import Image


SCHEMA = "kaminos.boundary-splat-radiance-training.v0"
CORPUS_SCHEMA = "kaminos-boundary-splat-supervision-corpus-v0"
CORPUS_AUTHORITY = "live-simulator-frozen-state-candidate-raymarch-v0"
TARGET_DECOMPOSITION = "candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0"
MODEL_SCHEMA = "kaminos-boundary-splat-attribute-mlp-v0"
SPATIAL_MODEL_SCHEMA = "kaminos-boundary-splat-spatial-attribute-mlp-v0"
GRID_MESSAGE_MODEL_SCHEMA = "kaminos-boundary-splat-grid-message-attribute-mlp-v0"
BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER = [
    "position.x", "position.y", "position.z",
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.density", "material.heat", "material.fuel", "material.detail",
    "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
    "micro.x", "micro.y", "micro.z", "micro.w",
]
FEATURES = BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER[3:]
OUTPUTS = ["color.r", "color.g", "color.b", "opacity", "radius.x", "radius.y"]
GRID_PYRAMID_RADII = (1, 2, 4, 8)
DEFAULT_WARM_START_RELATIVE = "models/boundary-splat-attribute/live-support-h64-v0/model-artifact.json"
DEFAULT_WARM_START = Path(__file__).parent / DEFAULT_WARM_START_RELATIVE


def write_json(path, payload):
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def resolve_artifact(manifest_path, artifact):
    value = Path(artifact["path"])
    return value if value.is_absolute() else manifest_path.parent / value


def read_verified_artifact(manifest_path, artifact, label):
    path = resolve_artifact(manifest_path, artifact).resolve()
    data = path.read_bytes()
    if not data:
        raise ValueError(f"{label} artifact is blank")
    if artifact.get("bytes") != len(data):
        raise ValueError(f"{label} byte length mismatch: declared {artifact.get('bytes')}, actual {len(data)}")
    digest = sha256_bytes(data)
    if artifact.get("sha256") != digest:
        raise ValueError(f"{label} sha256 mismatch: declared {artifact.get('sha256')}, actual {digest}")
    return path, data


def finite_vector(value, length, label):
    array = np.asarray(value, dtype=np.float32)
    if array.shape != (length,) or not np.all(np.isfinite(array)):
        raise ValueError(f"{label} must contain {length} finite values")
    return array


def parse_frame_indices(value, frame_count, label):
    parts = [part.strip() for part in value.split(",")]
    if not parts or any(not part for part in parts):
        raise ValueError(f"{label} must be a comma-separated list of frame indices")
    try:
        indices = [int(part) for part in parts]
    except ValueError as error:
        raise ValueError(f"{label} must contain only integer frame indices") from error
    if len(indices) != len(set(indices)):
        raise ValueError(f"{label} contains a duplicate frame index")
    if any(index < 0 or index >= frame_count for index in indices):
        raise ValueError(f"{label} contains an out of range frame index for {frame_count} corpus frames")
    return indices


def resolve_frame_splits(frame_ids, train_value, evaluation_value):
    frame_count = len(frame_ids)
    if frame_count <= 0:
        raise ValueError("frame split requires at least one corpus frame")
    if (train_value is None and evaluation_value is None) or (train_value == "all" and evaluation_value == "all"):
        indices = list(range(frame_count))
        return {
            "authority": "all-frames-train-and-evaluate-v0",
            "trainIndices": indices,
            "evaluationIndices": indices,
            "trainFrameIds": list(frame_ids),
            "evaluationFrameIds": list(frame_ids),
        }
    if train_value is None or evaluation_value is None:
        raise ValueError("explicit frame custody requires both train-frame-indices and eval-frame-indices")
    train_indices = parse_frame_indices(train_value, frame_count, "train-frame-indices")
    evaluation_indices = parse_frame_indices(evaluation_value, frame_count, "eval-frame-indices")
    if not train_indices or not evaluation_indices:
        raise ValueError("explicit training and evaluation frame sets must both be nonempty")
    overlap = sorted(set(train_indices).intersection(evaluation_indices))
    if overlap:
        raise ValueError(f"training and evaluation frame indices must not overlap: {overlap}")
    return {
        "authority": "explicit-disjoint-frame-holdout-v0",
        "trainIndices": train_indices,
        "evaluationIndices": evaluation_indices,
        "trainFrameIds": [frame_ids[index] for index in train_indices],
        "evaluationFrameIds": [frame_ids[index] for index in evaluation_indices],
    }


def load_corpus(manifest_value):
    manifest_path = Path(manifest_value).resolve()
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema") != CORPUS_SCHEMA:
        raise ValueError(f"corpus schema must be {CORPUS_SCHEMA}")
    if manifest.get("authority") != CORPUS_AUTHORITY:
        raise ValueError(f"corpus authority must be {CORPUS_AUTHORITY}")
    if manifest.get("candidateOrder") != BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER:
        raise ValueError("candidate order does not match BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER")
    if manifest.get("featureOrder") != FEATURES:
        raise ValueError("feature order does not match the browser attribute model")
    frames = []
    for index, frame in enumerate(manifest.get("frames") or []):
        label = f"frame {index}"
        candidate_path, candidate_bytes = read_verified_artifact(manifest_path, frame["candidates"], f"{label} candidates")
        candidate_count = frame["candidates"].get("count")
        stride_floats = frame["candidates"].get("strideFloats")
        if not isinstance(candidate_count, int) or candidate_count <= 0 or stride_floats != len(BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER):
            raise ValueError(f"{label} candidateCount and strideFloats do not describe the exact uncapped payload")
        if len(candidate_bytes) != candidate_count * stride_floats * 4:
            raise ValueError(f"{label} candidateCount * strideFloats does not equal candidate bytes")
        candidates = np.frombuffer(candidate_bytes, dtype="<f4").reshape(candidate_count, stride_floats).copy()
        if not np.all(np.isfinite(candidates)):
            raise ValueError(f"{label} candidates contain non-finite values")
        target_path, _ = read_verified_artifact(manifest_path, frame["target"], f"{label} target")
        if frame["target"].get("decomposition") != TARGET_DECOMPOSITION:
            raise ValueError(f"{label} target decomposition must be {TARGET_DECOMPOSITION}")
        camera = frame.get("camera") or {}
        view_projection = finite_vector(camera.get("viewProjection"), 16, f"{label} viewProjection")
        camera_right = finite_vector(camera.get("cameraRight"), 3, f"{label} cameraRight")
        camera_up = finite_vector(camera.get("cameraUp"), 3, f"{label} cameraUp")
        viewport = finite_vector(camera.get("viewport"), 2, f"{label} viewport")
        splat_controls = frame.get("splatControls") or {}
        radius = float(splat_controls.get("radius", 0))
        sharpness = float(splat_controls.get("sharpness", 0))
        if not np.isfinite(radius) or radius <= 0 or not np.isfinite(sharpness) or sharpness <= 0:
            raise ValueError(f"{label} splat controls must be positive and finite")
        frames.append({
            "id": frame["id"],
            "sameStateCaptureId": frame["sameStateCaptureId"],
            "grid": int(frame["grid"]),
            "candidates": candidates,
            "candidatePath": str(candidate_path),
            "targetPath": str(target_path),
            "viewProjection": view_projection,
            "cameraRight": camera_right,
            "cameraUp": camera_up,
            "viewport": viewport,
            "radius": radius,
            "sharpness": sharpness,
        })
    if not frames:
        raise ValueError("corpus must contain at least one frame")
    return {
        "path": str(manifest_path),
        "identity": f"sha256:{sha256_bytes(manifest_bytes)}",
        "frames": frames,
        "candidateCount": sum(frame["candidates"].shape[0] for frame in frames),
    }


class AttributeMlp(nn.Module):
    def __init__(self, hidden_size, input_size=len(FEATURES)):
        super().__init__()
        self.hidden = nn.Linear(input_size, hidden_size)
        self.output = nn.Linear(hidden_size, len(OUTPUTS))

    def __call__(self, inputs):
        return mx.sigmoid(self.output(nn.relu(self.hidden(inputs))))


class GridMessageAttributeMlp(nn.Module):
    def __init__(self, input_size, hidden_size, message_size):
        super().__init__()
        self.hidden = nn.Linear(input_size, hidden_size)
        self.output = nn.Linear(hidden_size, len(OUTPUTS))
        self.message_hidden = nn.Linear(hidden_size * 7, message_size)
        self.message_output = nn.Linear(message_size, len(OUTPUTS))

    @classmethod
    def from_base(cls, base_model, message_size):
        hidden_size = int(base_model.hidden.weight.shape[0])
        input_size = int(base_model.hidden.weight.shape[1])
        if message_size <= 0:
            raise ValueError("message size must be positive")
        model = cls(input_size, hidden_size, message_size)
        random = np.random.default_rng(1)
        message_weight = random.normal(
            0.0,
            np.sqrt(2.0 / (hidden_size * 7)) * 0.1,
            size=(message_size, hidden_size * 7),
        ).astype(np.float32)
        model.load_weights([
            ("hidden.weight", base_model.hidden.weight),
            ("hidden.bias", base_model.hidden.bias),
            ("output.weight", base_model.output.weight),
            ("output.bias", base_model.output.bias),
            ("message_hidden.weight", mx.array(message_weight)),
            ("message_hidden.bias", mx.array(np.full(message_size, 0.01, dtype=np.float32))),
            ("message_output.weight", mx.zeros((len(OUTPUTS), message_size), dtype=mx.float32)),
            ("message_output.bias", mx.zeros((len(OUTPUTS),), dtype=mx.float32)),
        ])
        mx.eval(model.parameters())
        return model

    def __call__(self, inputs, neighbor_rows):
        hidden = nn.relu(self.hidden(inputs))
        safe_rows = mx.maximum(neighbor_rows, mx.array(0, dtype=neighbor_rows.dtype))
        neighbor_hidden = hidden[safe_rows]
        neighbor_hidden = neighbor_hidden * (neighbor_rows >= 0)[:, :, None]
        message_inputs = mx.concatenate([hidden, neighbor_hidden.reshape(hidden.shape[0], -1)], axis=1)
        message_logits = self.message_output(nn.relu(self.message_hidden(message_inputs)))
        return mx.sigmoid(self.output(hidden) + message_logits)


def freeze_grid_message_base(model):
    if not isinstance(model, GridMessageAttributeMlp):
        raise ValueError("base-path freezing requires a grid-message model")
    model.hidden.freeze()
    model.output.freeze()
    return model


class CandidateAttributeTable(nn.Module):
    def __init__(self, normalized_attributes):
        super().__init__()
        probabilities = np.clip(normalized_attributes, 1e-5, 1.0 - 1e-5)
        self.logits = mx.array(np.log(probabilities / (1.0 - probabilities)).astype(np.float32))

    def __call__(self, inputs):
        del inputs
        return mx.sigmoid(self.logits)


def infer_fourier_frequencies(feature_names):
    components_by_frequency = {}
    frequency_order = []
    for name in feature_names:
        if not name.startswith(("position.sin.", "position.cos.")):
            continue
        parts = name.split(".")
        if len(parts) != 4 or parts[1] not in ("sin", "cos") or parts[2] not in "xyz":
            raise ValueError("legacy Fourier features must use position.<sin|cos>.<axis>.<frequency>")
        frequency = float(parts[3])
        if not np.isfinite(frequency) or frequency <= 0:
            raise ValueError("legacy Fourier feature frequencies must be positive and finite")
        if frequency not in components_by_frequency:
            components_by_frequency[frequency] = set()
            frequency_order.append(frequency)
        components_by_frequency[frequency].add((parts[1], parts[2]))
    expected_components = {(trig, axis) for trig in ("sin", "cos") for axis in "xyz"}
    if any(components != expected_components for components in components_by_frequency.values()):
        raise ValueError("legacy Fourier features must contain complete sine/cosine axis groups")
    return frequency_order


def load_warm_start(path_value, requested_context_mode, requested_frequencies, requested_spatial_mixing="none"):
    path = Path(path_value).resolve()
    artifact_bytes = path.read_bytes()
    artifact = json.loads(artifact_bytes)
    schema = artifact.get("schema")
    recovered_frequencies = []
    if schema == MODEL_SCHEMA:
        if artifact.get("architecture") != "dense-relu-dense":
            raise ValueError("warm start architecture must be dense-relu-dense")
        warm_context_mode = "none"
        warm_frequencies = []
        warm_spatial_mixing = "none"
        expected_features = FEATURES
    elif artifact.get("schema") == SPATIAL_MODEL_SCHEMA:
        if artifact.get("architecture") != "dense-relu-dense":
            raise ValueError("warm start architecture must be dense-relu-dense")
        warm_context_mode = artifact.get("contextMode")
        warm_frequencies = [float(value) for value in artifact.get("fourierFrequencies", [])]
        warm_spatial_mixing = "none"
        if warm_context_mode in ("world-fourier", "world-grid-neighborhood", "world-grid-pyramid") and not warm_frequencies:
            recovered_frequencies = infer_fourier_frequencies(artifact.get("features") or [])
            warm_frequencies = recovered_frequencies
        context_expansion = warm_context_mode == "world-fourier" and requested_context_mode == "world-grid-neighborhood"
        if warm_context_mode != requested_context_mode and not context_expansion:
            raise ValueError(
                f"warm start context mode {warm_context_mode!r} does not match requested context mode {requested_context_mode!r}"
            )
        if warm_context_mode in ("world-fourier", "world-grid-neighborhood", "world-grid-pyramid") and warm_frequencies != requested_frequencies:
            raise ValueError(
                f"warm start Fourier frequencies {warm_frequencies!r} do not match requested Fourier frequencies {requested_frequencies!r}"
            )
        expected_features = context_feature_names(warm_context_mode, warm_frequencies)
    elif artifact.get("schema") == GRID_MESSAGE_MODEL_SCHEMA:
        if artifact.get("architecture") != "dense-relu-dense-plus-six-neighbor-residual":
            raise ValueError("grid-message warm start architecture is not recognized")
        warm_context_mode = artifact.get("contextMode")
        warm_frequencies = [float(value) for value in artifact.get("fourierFrequencies", [])]
        warm_spatial_mixing = "six-neighbor-hidden-residual"
        if warm_context_mode != "world-grid-neighborhood":
            raise ValueError("grid-message warm start requires world-grid-neighborhood context")
        if not warm_frequencies:
            recovered_frequencies = infer_fourier_frequencies(artifact.get("features") or [])
            warm_frequencies = recovered_frequencies
        expected_features = context_feature_names(warm_context_mode, warm_frequencies)
    else:
        raise ValueError("warm start is not a recognized boundary splat attribute MLP")
    context_expansion = (
        warm_context_mode == "none" and requested_context_mode != "none"
    ) or (
        warm_context_mode == "world-fourier" and requested_context_mode == "world-grid-neighborhood"
    )
    if warm_context_mode != requested_context_mode and not context_expansion:
        raise ValueError(
            f"warm start context mode {warm_context_mode!r} does not match requested context mode {requested_context_mode!r}"
        )
    if warm_context_mode in ("world-fourier", "world-grid-neighborhood", "world-grid-pyramid") and warm_frequencies != requested_frequencies:
        raise ValueError(
            f"warm start Fourier frequencies {warm_frequencies!r} do not match requested Fourier frequencies {requested_frequencies!r}"
        )
    mixing_expansion = warm_spatial_mixing == "none" and requested_spatial_mixing == "six-neighbor-hidden-residual"
    if warm_spatial_mixing != requested_spatial_mixing and not mixing_expansion:
        raise ValueError(
            f"warm start spatial mixing {warm_spatial_mixing!r} does not match requested spatial mixing {requested_spatial_mixing!r}"
        )
    if artifact.get("features") != expected_features or artifact.get("outputs") != OUTPUTS:
        raise ValueError("warm start feature/output order does not match its declared context contract")
    hidden_size = int(artifact["hiddenSize"])
    base_model = AttributeMlp(hidden_size, len(expected_features))
    layers = artifact.get("layers") or []
    if len(layers) != 2:
        raise ValueError("warm start must contain exactly two dense layers")
    weights = []
    for name, layer in zip(("hidden", "output"), layers):
        matrix = mx.array(layer["weights"]).reshape(layer["outputSize"], layer["inputSize"])
        bias = mx.array(layer["bias"])
        weights.extend([(f"{name}.weight", matrix), (f"{name}.bias", bias)])
    base_model.load_weights(weights)
    model = base_model
    if warm_spatial_mixing == "six-neighbor-hidden-residual":
        message_size = int(artifact.get("messageSize", 0))
        if message_size <= 0:
            raise ValueError("grid-message warm start must declare a positive message size")
        model = GridMessageAttributeMlp.from_base(base_model, message_size)
        message_layers = artifact.get("messageLayers") or []
        if len(message_layers) != 2:
            raise ValueError("grid-message warm start must contain exactly two message layers")
        message_weights = []
        for name, layer in zip(("message_hidden", "message_output"), message_layers):
            matrix = mx.array(layer["weights"]).reshape(layer["outputSize"], layer["inputSize"])
            bias = mx.array(layer["bias"])
            message_weights.extend([(f"{name}.weight", matrix), (f"{name}.bias", bias)])
        model.load_weights(message_weights, strict=False)
    mx.eval(model.parameters())
    output_ranges = np.asarray(artifact["outputRanges"], dtype=np.float32)
    if output_ranges.shape != (len(OUTPUTS), 2) or not np.all(np.isfinite(output_ranges)) or np.any(output_ranges[:, 1] <= output_ranges[:, 0]):
        raise ValueError("warm start output ranges must contain one finite increasing range per output")
    return model, artifact, output_ranges, {
        "path": str(path),
        "bytes": len(artifact_bytes),
        "sha256": sha256_bytes(artifact_bytes),
        "schema": schema,
        "contextMode": warm_context_mode,
        "fourierFrequencies": warm_frequencies,
        "continuation": schema in (SPATIAL_MODEL_SCHEMA, GRID_MESSAGE_MODEL_SCHEMA),
        "spatialMixing": warm_spatial_mixing,
        "legacyFrequencyRecoveryAuthority": "exact-complete-feature-name-groups-v0" if recovered_frequencies else None,
        "contextExpansionAuthority": "zero-delta-local-grid-context-expansion-v0" if warm_context_mode == "world-fourier" and requested_context_mode == "world-grid-neighborhood" else None,
        "spatialMixingExpansionAuthority": "zero-delta-active-six-neighbor-hidden-residual-v0" if mixing_expansion else None,
    }, schema, warm_context_mode, warm_frequencies, warm_spatial_mixing


def parse_fourier_frequencies(value):
    frequencies = [float(item.strip()) for item in value.split(",") if item.strip()]
    if not frequencies or not all(np.isfinite(item) and item > 0 for item in frequencies):
        raise ValueError("fourier frequencies must contain positive finite values")
    return frequencies


def context_feature_names(context_mode, frequencies):
    names = list(FEATURES)
    if context_mode in ("world-xyz", "world-fourier", "world-grid-neighborhood", "world-grid-pyramid"):
        names.extend(["position.x", "position.y", "position.z"])
    if context_mode in ("world-fourier", "world-grid-neighborhood", "world-grid-pyramid"):
        for frequency in frequencies:
            label = format(frequency, "g")
            names.extend([f"position.sin.{axis}.{label}" for axis in "xyz"])
            names.extend([f"position.cos.{axis}.{label}" for axis in "xyz"])
    if context_mode == "world-grid-neighborhood":
        names.extend(grid_neighborhood_feature_names("neighbor"))
    if context_mode == "world-grid-pyramid":
        for radius in GRID_PYRAMID_RADII:
            names.extend(grid_neighborhood_feature_names(f"neighbor.r{radius}"))
    return names


def grid_neighborhood_feature_names(prefix):
    names = [
        f"{prefix}.occupancy.x-", f"{prefix}.occupancy.x+",
        f"{prefix}.occupancy.y-", f"{prefix}.occupancy.y+",
        f"{prefix}.occupancy.z-", f"{prefix}.occupancy.z+",
    ]
    for statistic in ("mean", "max", "laplacian", "gradient.x", "gradient.y", "gradient.z"):
        names.extend([f"{prefix}.{statistic}.{feature}" for feature in FEATURES])
    return names


def local_grid_neighbor_rows(candidates, grid, radius=1):
    if not isinstance(grid, int) or grid <= 0:
        raise ValueError("local-grid context requires a positive integer source grid")
    if not isinstance(radius, int) or radius <= 0:
        raise ValueError("local-grid context radius must be a positive integer")
    positions = candidates[:, :3].astype(np.float32)
    indices = np.rint((positions + 1.0) * 0.5 * grid - 0.5).astype(np.int32)
    if np.any(indices < 0) or np.any(indices >= grid):
        raise ValueError("candidate position falls outside the declared source grid")
    reconstructed = (indices.astype(np.float32) + 0.5) * (2.0 / grid) - 1.0
    if np.max(np.abs(reconstructed - positions)) > 1e-5:
        raise ValueError("candidate positions are not exact source-grid cell centers")
    linear = indices[:, 0] + grid * (indices[:, 1] + grid * indices[:, 2])
    if np.unique(linear).size != linear.size:
        raise ValueError("candidate positions contain duplicate source-grid cells")
    lookup = np.full(grid ** 3, -1, dtype=np.int32)
    lookup[linear] = np.arange(linear.size, dtype=np.int32)
    offsets = radius * np.asarray([
        [-1, 0, 0], [1, 0, 0],
        [0, -1, 0], [0, 1, 0],
        [0, 0, -1], [0, 0, 1],
    ], dtype=np.int32)
    neighbor_rows = np.full((len(candidates), len(offsets)), -1, dtype=np.int32)
    for neighbor_index, offset in enumerate(offsets):
        neighbor_cells = indices + offset
        in_bounds = np.all((neighbor_cells >= 0) & (neighbor_cells < grid), axis=1)
        neighbor_linear = neighbor_cells[:, 0] + grid * (neighbor_cells[:, 1] + grid * neighbor_cells[:, 2])
        neighbor_rows[in_bounds, neighbor_index] = lookup[neighbor_linear[in_bounds]]
    return neighbor_rows


def local_grid_neighborhood_channels(candidates, grid, radius=1):
    neighbor_rows = local_grid_neighbor_rows(candidates, grid, radius)
    features = candidates[:, 3:].astype(np.float32)
    neighbor_values = np.zeros((len(candidates), 6, len(FEATURES)), dtype=np.float32)
    occupancy = (neighbor_rows >= 0).astype(np.float32)
    present_rows, present_directions = np.nonzero(neighbor_rows >= 0)
    neighbor_values[present_rows, present_directions] = features[neighbor_rows[present_rows, present_directions]]
    neighbor_mean = np.mean(neighbor_values, axis=1)
    neighbor_max = np.max(neighbor_values, axis=1)
    laplacian = neighbor_mean - features
    gradients = [
        (neighbor_values[:, 1] - neighbor_values[:, 0]) * 0.5,
        (neighbor_values[:, 3] - neighbor_values[:, 2]) * 0.5,
        (neighbor_values[:, 5] - neighbor_values[:, 4]) * 0.5,
    ]
    return np.concatenate([occupancy, neighbor_mean, neighbor_max, laplacian, *gradients], axis=1)


def local_grid_pyramid_channels(candidates, grid):
    return np.concatenate([
        local_grid_neighborhood_channels(candidates, grid, radius)
        for radius in GRID_PYRAMID_RADII
    ], axis=1)


def encode_candidate_inputs(candidates, context_mode, frequencies, grid=None):
    features = mx.array(candidates[:, 3:].astype(np.float32))
    if context_mode == "none":
        return features
    positions = mx.array(candidates[:, :3].astype(np.float32))
    channels = [features, positions]
    if context_mode in ("world-fourier", "world-grid-neighborhood", "world-grid-pyramid"):
        for frequency in frequencies:
            channels.append(mx.sin(positions * frequency * 2.0 * np.pi))
            channels.append(mx.cos(positions * frequency * 2.0 * np.pi))
    if context_mode == "world-grid-neighborhood":
        channels.append(mx.array(local_grid_neighborhood_channels(candidates, grid)))
    if context_mode == "world-grid-pyramid":
        channels.append(mx.array(local_grid_pyramid_channels(candidates, grid)))
    return mx.concatenate(channels, axis=1)


def expand_warm_start_with_context(base_model, input_size):
    hidden_size = int(base_model.hidden.weight.shape[0])
    base_input_size = int(base_model.hidden.weight.shape[1])
    if input_size <= base_input_size:
        raise ValueError("context expansion must add at least one new model input")
    model = AttributeMlp(hidden_size, input_size)
    expanded_weight = np.zeros((hidden_size, input_size), dtype=np.float32)
    expanded_weight[:, :base_input_size] = np.asarray(base_model.hidden.weight)
    expanded_weight[:, base_input_size:] = 0.0
    model.load_weights([
        ("hidden.weight", mx.array(expanded_weight)),
        ("hidden.bias", mx.array(np.asarray(base_model.hidden.bias))),
        ("output.weight", mx.array(np.asarray(base_model.output.weight))),
        ("output.bias", mx.array(np.asarray(base_model.output.bias))),
    ])
    mx.eval(model.parameters())
    return model


def expand_hidden_size(base_model, hidden_size):
    base_hidden_size = int(base_model.hidden.weight.shape[0])
    input_size = int(base_model.hidden.weight.shape[1])
    if hidden_size <= base_hidden_size:
        raise ValueError("hidden-size expansion must add at least one hidden unit")
    model = AttributeMlp(hidden_size, input_size)
    hidden_weight = np.zeros((hidden_size, input_size), dtype=np.float32)
    hidden_weight[:base_hidden_size] = np.asarray(base_model.hidden.weight)
    random = np.random.default_rng(0)
    hidden_weight[base_hidden_size:] = random.normal(
        0.0,
        np.sqrt(2.0 / input_size) * 0.1,
        size=(hidden_size - base_hidden_size, input_size),
    ).astype(np.float32)
    hidden_bias = np.zeros(hidden_size, dtype=np.float32)
    hidden_bias[:base_hidden_size] = np.asarray(base_model.hidden.bias)
    hidden_bias[base_hidden_size:] = 0.01
    output_weight = np.zeros((len(OUTPUTS), hidden_size), dtype=np.float32)
    output_weight[:, :base_hidden_size] = np.asarray(base_model.output.weight)
    model.load_weights([
        ("hidden.weight", mx.array(hidden_weight)),
        ("hidden.bias", mx.array(hidden_bias)),
        ("output.weight", mx.array(output_weight)),
        ("output.bias", base_model.output.bias),
    ])
    mx.eval(model.parameters())
    return model


def model_attributes(model, inputs, neighbor_rows=None):
    if isinstance(model, GridMessageAttributeMlp):
        if neighbor_rows is None:
            raise ValueError("grid-message model requires exact six-neighbor row indices")
        return model(inputs, neighbor_rows)
    return model(inputs)


def predict_numpy(model, features, output_ranges, neighbor_rows=None):
    normalized = np.asarray(model_attributes(
        model,
        mx.array(features.astype(np.float32)),
        None if neighbor_rows is None else mx.array(neighbor_rows),
    ))
    return output_ranges[:, 0] + normalized * (output_ranges[:, 1] - output_ranges[:, 0])


def project_points(points, view_projection, width, height):
    matrix = np.asarray(view_projection, dtype=np.float64).reshape(4, 4, order="F")
    homogeneous = np.concatenate([points.astype(np.float64), np.ones((points.shape[0], 1))], axis=1)
    clip = homogeneous @ matrix.T
    valid = np.abs(clip[:, 3]) > 1e-8
    ndc = np.zeros((points.shape[0], 2), dtype=np.float64)
    ndc[valid] = clip[valid, :2] / clip[valid, 3:4]
    screen = np.stack([(ndc[:, 0] * 0.5 + 0.5) * width, (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height], axis=1)
    valid &= clip[:, 3] > 0
    return screen.astype(np.float32), valid, clip[:, 3].astype(np.float32)


def build_sparse_geometry(frame, render_width, depth_bins, max_radius, context_mode, frequencies):
    source_width, source_height = frame["viewport"]
    render_height = max(1, round(render_width * source_height / source_width))
    positions = frame["candidates"][:, :3]
    features = frame["candidates"][:, 3:]
    base_radius = (2.0 / frame["grid"]) * (0.60 + features[:, 3] * 2.65 + features[:, 2] * 0.48)
    shape = base_radius * frame["radius"]
    center, valid, view_depth = project_points(positions, frame["viewProjection"], render_width, render_height)
    right_points = positions + frame["cameraRight"][None, :] * shape[:, None]
    up_points = positions + frame["cameraUp"][None, :] * shape[:, None]
    right_screen, right_valid, _ = project_points(right_points, frame["viewProjection"], render_width, render_height)
    up_screen, up_valid, _ = project_points(up_points, frame["viewProjection"], render_width, render_height)
    axis_x = right_screen - center
    axis_y = up_screen - center
    valid &= right_valid & up_valid
    energy_ratio = (np.clip(frame["sharpness"], 1.0, 12.0) / 3.4) / max(np.clip(frame["radius"], 0.35, 1.5) ** 2, 0.1225)
    energy_compensation = float(np.clip(np.sqrt(energy_ratio), 0.5, 2.5))
    pixel_parts = []
    splat_parts = []
    fragment_local_parts = []
    depth_bin_parts = []
    valid_depth = view_depth[valid]
    depth_min = float(np.min(valid_depth))
    depth_span = max(float(np.max(valid_depth)) - depth_min, 1e-6)
    splat_depth_bins = np.clip(
        np.floor((view_depth - depth_min) / depth_span * depth_bins),
        0,
        depth_bins - 1,
    ).astype(np.int32)
    for splat_index in np.flatnonzero(valid):
        basis = np.stack([axis_x[splat_index], axis_y[splat_index]], axis=1).astype(np.float64)
        determinant = np.linalg.det(basis)
        if abs(determinant) < 1e-5:
            continue
        extent = (
            np.abs(axis_x[splat_index]) * max_radius[0]
            + np.abs(axis_y[splat_index]) * max_radius[1]
        )
        lower = np.floor(center[splat_index] - extent).astype(int)
        upper = np.ceil(center[splat_index] + extent).astype(int)
        x0, y0 = max(0, lower[0]), max(0, lower[1])
        x1, y1 = min(render_width - 1, upper[0]), min(render_height - 1, upper[1])
        if x1 < x0 or y1 < y0:
            continue
        xs = np.arange(x0, x1 + 1, dtype=np.float32) + 0.5
        ys = np.arange(y0, y1 + 1, dtype=np.float32) + 0.5
        grid_x, grid_y = np.meshgrid(xs, ys)
        offsets = np.stack([grid_x.reshape(-1) - center[splat_index, 0], grid_y.reshape(-1) - center[splat_index, 1]], axis=0)
        local = np.linalg.inv(basis) @ offsets
        radius2 = np.sum(np.square(local / max_radius[:, None]), axis=0)
        inside = radius2 <= 1.0
        if not np.any(inside):
            continue
        pixel = (grid_y.reshape(-1)[inside].astype(np.int64) * render_width + grid_x.reshape(-1)[inside].astype(np.int64))
        pixel_parts.append(pixel)
        splat_parts.append(np.full(pixel.shape, splat_index, dtype=np.int32))
        fragment_local_parts.append(local[:, inside].T.astype(np.float32))
        depth_bin_parts.append(np.full(pixel.shape, splat_depth_bins[splat_index], dtype=np.int32))
    if not pixel_parts:
        raise ValueError(f"frame {frame['id']} produced no projected splat fragments")
    target = Image.open(frame["targetPath"]).convert("RGB").resize((render_width, render_height), Image.Resampling.LANCZOS)
    target_array = np.asarray(target, dtype=np.float32) / 255.0
    return {
        "width": render_width,
        "height": render_height,
        "features": mx.array(features.astype(np.float32)),
        "inputs": encode_candidate_inputs(frame["candidates"], context_mode, frequencies, frame["grid"]),
        "neighborRows": (
            mx.array(local_grid_neighbor_rows(frame["candidates"], frame["grid"]))
            if context_mode == "world-grid-neighborhood"
            else None
        ),
        "pixelIndices": mx.array(np.concatenate(pixel_parts)),
        "splatIndices": mx.array(np.concatenate(splat_parts)),
        "depthBinIndices": mx.array(np.concatenate(depth_bin_parts)),
        "fragmentLocal": mx.array(np.concatenate(fragment_local_parts)),
        "sharpness": float(np.clip(frame["sharpness"], 1.0, 12.0)),
        "energyCompensation": energy_compensation,
        "target": mx.array(target_array),
        "targetNumpy": target_array,
        "fragmentCount": int(sum(part.size for part in pixel_parts)),
    }


def render_frame(model, geometry, lower, span, depth_bins):
    normalized = model_attributes(model, geometry["inputs"], geometry["neighborRows"])
    attributes = lower + normalized * span
    splat_indices = geometry["splatIndices"]
    pixel_indices = geometry["pixelIndices"]
    fragment_local = geometry["fragmentLocal"]
    radius = attributes[splat_indices, 4:6]
    radius2 = mx.sum(mx.square(fragment_local / radius), axis=1)
    kernels = mx.exp(-radius2 * geometry["sharpness"]) * geometry["energyCompensation"]
    kernels = kernels * (radius2 <= 1.0)
    alpha = attributes[splat_indices, 3:4] * kernels[:, None]
    contributions = attributes[splat_indices, :3] * alpha
    if depth_bins > 1:
        pixel_count = geometry["width"] * geometry["height"]
        optical_indices = geometry["depthBinIndices"] * pixel_count + pixel_indices
        optical_depth = mx.zeros((depth_bins * pixel_count, 1), dtype=mx.float32).at[optical_indices].add(alpha)
        emission = mx.zeros((depth_bins * pixel_count, 3), dtype=mx.float32).at[optical_indices].add(contributions)
        optical_depth = optical_depth.reshape(depth_bins, pixel_count, 1)
        emission = emission.reshape(depth_bins, pixel_count, 3)
        bin_color = emission / mx.maximum(optical_depth, 1e-6)
        bin_alpha = 1.0 - mx.exp(-optical_depth)
        flat = mx.zeros((pixel_count, 3), dtype=mx.float32)
        for bin_index in reversed(range(depth_bins)):
            flat = bin_color[bin_index] * bin_alpha[bin_index] + flat * (1.0 - bin_alpha[bin_index])
        return mx.clip(flat.reshape(geometry["height"], geometry["width"], 3), 0.0, 1.0), attributes
    flat = mx.zeros((geometry["width"] * geometry["height"], 3), dtype=mx.float32).at[pixel_indices].add(contributions)
    return mx.clip(flat.reshape(geometry["height"], geometry["width"], 3), 0.0, 1.0), attributes


def pixel_loss(prediction, target):
    target_luma = target[:, :, 0] * 0.2126 + target[:, :, 1] * 0.7152 + target[:, :, 2] * 0.0722
    weights = 1.0 + target_luma[:, :, None] * 5.0
    return mx.mean(mx.square(prediction - target) * weights) + mx.mean(mx.abs(prediction - target)) * 0.08


def edge_loss(prediction, target):
    prediction_dx = prediction[:, 1:, :] - prediction[:, :-1, :]
    prediction_dy = prediction[1:, :, :] - prediction[:-1, :, :]
    target_dx = target[:, 1:, :] - target[:, :-1, :]
    target_dy = target[1:, :, :] - target[:-1, :, :]
    return mx.mean(mx.abs(prediction_dx - target_dx)) + mx.mean(mx.abs(prediction_dy - target_dy))


def image_loss(prediction, target, edge_weight):
    return pixel_loss(prediction, target) + edge_loss(prediction, target) * edge_weight


def save_preview(path, image):
    pixels = np.clip(np.asarray(image) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(pixels, mode="RGB").save(path)


def evaluate_frame_set(model, geometries, frames, indices, lower, span, depth_bins, edge_weight, output_dir, stage):
    rows = []
    for frame_index in indices:
        geometry = geometries[frame_index]
        prediction, _ = render_frame(model, geometry, lower, span, depth_bins)
        mx.eval(prediction)
        preview_path = output_dir / f"preview-{stage}-frame-{frame_index:03d}.png"
        target_path = output_dir / f"preview-target-frame-{frame_index:03d}.png"
        save_preview(preview_path, prediction)
        if not target_path.exists():
            save_preview(target_path, geometry["target"])
        pixel_value = float(pixel_loss(prediction, geometry["target"]).item())
        edge_value = float(edge_loss(prediction, geometry["target"]).item())
        rows.append({
            "frameIndex": frame_index,
            "frameId": frames[frame_index]["id"],
            "sameStateCaptureId": frames[frame_index]["sameStateCaptureId"],
            "preview": str(preview_path),
            "targetPreview": str(target_path),
            "pixelLoss": pixel_value,
            "edgeLoss": edge_value,
            "loss": pixel_value + edge_value * edge_weight,
        })
    return rows


def mean_metric(rows, key):
    return sum(row[key] for row in rows) / len(rows)


def serialize_model(model, artifact_template, output_path):
    payload = {
        "schema": MODEL_SCHEMA,
        "architecture": "dense-relu-dense",
        "features": FEATURES,
        "outputs": OUTPUTS,
        "hiddenSize": artifact_template["hiddenSize"],
        "outputRanges": artifact_template["outputRanges"],
        "layers": [],
    }
    for name, template in zip(("hidden", "output"), artifact_template["layers"]):
        layer = getattr(model, name)
        payload["layers"].append({
            "inputSize": template["inputSize"],
            "outputSize": template["outputSize"],
            "activation": template["activation"],
            "weights": np.asarray(layer.weight).reshape(-1).astype(float).tolist(),
            "bias": np.asarray(layer.bias).reshape(-1).astype(float).tolist(),
        })
    write_json(output_path, payload)
    return payload


def serialize_spatial_model(model, output_ranges, feature_names, context_mode, frequencies, output_path):
    payload = {
        "schema": SPATIAL_MODEL_SCHEMA,
        "architecture": "dense-relu-dense",
        "features": feature_names,
        "outputs": OUTPUTS,
        "hiddenSize": int(model.hidden.weight.shape[0]),
        "outputRanges": output_ranges.astype(float).tolist(),
        "contextMode": context_mode,
        "fourierFrequencies": frequencies if context_mode in ("world-fourier", "world-grid-neighborhood", "world-grid-pyramid") else [],
        "deployable": False,
        "layers": [
            {
                "inputSize": int(model.hidden.weight.shape[1]),
                "outputSize": int(model.hidden.weight.shape[0]),
                "activation": "relu",
                "weights": np.asarray(model.hidden.weight).reshape(-1).astype(float).tolist(),
                "bias": np.asarray(model.hidden.bias).reshape(-1).astype(float).tolist(),
            },
            {
                "inputSize": int(model.output.weight.shape[1]),
                "outputSize": int(model.output.weight.shape[0]),
                "activation": "sigmoid",
                "weights": np.asarray(model.output.weight).reshape(-1).astype(float).tolist(),
                "bias": np.asarray(model.output.bias).reshape(-1).astype(float).tolist(),
            },
        ],
    }
    write_json(output_path, payload)
    return payload


def serialize_grid_message_model(model, output_ranges, feature_names, frequencies, output_path):
    payload = {
        "schema": GRID_MESSAGE_MODEL_SCHEMA,
        "architecture": "dense-relu-dense-plus-six-neighbor-residual",
        "features": feature_names,
        "outputs": OUTPUTS,
        "hiddenSize": int(model.hidden.weight.shape[0]),
        "messageSize": int(model.message_hidden.weight.shape[0]),
        "outputRanges": output_ranges.astype(float).tolist(),
        "contextMode": "world-grid-neighborhood",
        "fourierFrequencies": frequencies,
        "spatialMixing": "six-neighbor-hidden-residual",
        "messageAuthority": "zero-delta-active-six-neighbor-hidden-residual-v0",
        "deployable": False,
        "layers": [],
        "messageLayers": [],
    }
    for name, activation in (("hidden", "relu"), ("output", "sigmoid")):
        layer = getattr(model, name)
        payload["layers"].append({
            "inputSize": int(layer.weight.shape[1]),
            "outputSize": int(layer.weight.shape[0]),
            "activation": activation,
            "weights": np.asarray(layer.weight).reshape(-1).astype(float).tolist(),
            "bias": np.asarray(layer.bias).reshape(-1).astype(float).tolist(),
        })
    for name, activation in (("message_hidden", "relu"), ("message_output", "linear-residual-logit")):
        layer = getattr(model, name)
        payload["messageLayers"].append({
            "inputSize": int(layer.weight.shape[1]),
            "outputSize": int(layer.weight.shape[0]),
            "activation": activation,
            "weights": np.asarray(layer.weight).reshape(-1).astype(float).tolist(),
            "bias": np.asarray(layer.bias).reshape(-1).astype(float).tolist(),
        })
    write_json(output_path, payload)
    return payload


def compile_model(output_dir, model_path, model, frame, lower, span):
    parity_features = frame["candidates"][:64, 3:].astype(np.float32)
    parity_outputs = lower + np.asarray(model(mx.array(parity_features))) * span
    parity_path = output_dir / "parity-samples.json"
    write_json(parity_path, {
        "schema": "kaminos-boundary-splat-attribute-parity-v0",
        "features": parity_features.astype(float).tolist(),
        "outputs": parity_outputs.astype(float).tolist(),
        "authority": "mlx-radiance-trained-prediction-before-json-export-v0",
    })
    compiler = Path(__file__).with_name("compile-boundary-splat-attribute-model.mjs")
    compiled_dir = output_dir / "compiled"
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node executable not found")
    result = subprocess.run([node, str(compiler), "--input", str(model_path), "--out-dir", str(compiled_dir), "--parity-samples", str(parity_path)], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "attribute compiler failed").strip())
    return json.loads((compiled_dir / "compiled-model.json").read_text(encoding="utf-8"))


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--warm-start", default=str(DEFAULT_WARM_START))
    parser.add_argument("--steps", type=int, default=160)
    parser.add_argument("--learning-rate", type=float, default=0.00035)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--radius-preservation", type=float, default=0.18)
    parser.add_argument("--depth-bins", type=int, default=1)
    parser.add_argument("--edge-weight", type=float, default=0.0)
    parser.add_argument("--context-mode", choices=["none", "world-xyz", "world-fourier", "world-grid-neighborhood", "world-grid-pyramid"], default="none")
    parser.add_argument("--fourier-frequencies", default="1,2,4,8")
    parser.add_argument("--hidden-size", type=int, default=0)
    parser.add_argument("--spatial-mixing", choices=["none", "six-neighbor-hidden-residual"], default="none")
    parser.add_argument("--message-size", type=int, default=0)
    parser.add_argument("--freeze-base", type=int, choices=[0, 1], default=0)
    parser.add_argument("--train-frame-indices")
    parser.add_argument("--eval-frame-indices")
    parser.add_argument("--candidate-table-oracle", action="store_true")
    parser.add_argument("--probe-only", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    output_dir = Path(args.out_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "training-report.json"
    started_at = time.time()
    report = {"schema": SCHEMA, "status": "running", "failurePhase": None, "startedAt": started_at}
    phase = "arguments"
    try:
        if args.steps < 0 or args.hidden_size < 0 or args.message_size < 0 or args.render_width <= 0 or args.learning_rate <= 0 or args.depth_bins <= 0 or args.edge_weight < 0:
            raise ValueError("steps, hidden-size, message-size, and edge-weight must be non-negative; render-width, learning-rate, and depth-bins must be positive")
        frequencies = parse_fourier_frequencies(args.fourier_frequencies)
        if args.candidate_table_oracle and args.context_mode != "none":
            raise ValueError("candidate table oracle cannot be combined with spatial conditioning")
        if args.spatial_mixing != "none" and args.context_mode != "world-grid-neighborhood":
            raise ValueError("learned spatial mixing requires world-grid-neighborhood context")
        if args.freeze_base and args.spatial_mixing != "six-neighbor-hidden-residual":
            raise ValueError("base-path freezing requires six-neighbor-hidden-residual mixing")
        feature_names = context_feature_names(args.context_mode, frequencies)
        phase = "corpus"
        corpus = load_corpus(args.corpus)
        frame_split = resolve_frame_splits(
            [frame["id"] for frame in corpus["frames"]],
            args.train_frame_indices,
            args.eval_frame_indices,
        )
        phase = "warm-start"
        base_model, warm_artifact, output_ranges, warm_receipt, warm_schema, warm_context_mode, warm_frequencies, warm_spatial_mixing = load_warm_start(
            args.warm_start,
            args.context_mode,
            frequencies,
            args.spatial_mixing,
        )
        lower_np = output_ranges[:, 0]
        span_np = output_ranges[:, 1] - output_ranges[:, 0]
        lower = mx.array(lower_np)
        span = mx.array(span_np)
        initial_attributes = [
            predict_numpy(
                base_model,
                np.asarray(encode_candidate_inputs(frame["candidates"], warm_context_mode, warm_frequencies, frame["grid"])),
                output_ranges,
                local_grid_neighbor_rows(frame["candidates"], frame["grid"])
                if warm_spatial_mixing == "six-neighbor-hidden-residual"
                else None,
            )
            for frame in corpus["frames"]
        ]
        exact_context_continuation = warm_schema in (SPATIAL_MODEL_SCHEMA, GRID_MESSAGE_MODEL_SCHEMA) and warm_context_mode == args.context_mode
        model = base_model if exact_context_continuation or args.context_mode == "none" else expand_warm_start_with_context(base_model, len(feature_names))
        warm_hidden_size = int(model.hidden.weight.shape[0])
        requested_hidden_size = args.hidden_size or warm_hidden_size
        if requested_hidden_size < warm_hidden_size:
            raise ValueError(f"requested hidden size {requested_hidden_size} cannot shrink warm hidden size {warm_hidden_size}")
        hidden_width_expansion = requested_hidden_size > warm_hidden_size
        if hidden_width_expansion:
            if isinstance(model, GridMessageAttributeMlp):
                raise ValueError("hidden-size expansion of an existing grid-message model is not supported")
            model = expand_hidden_size(model, requested_hidden_size)
        message_size = int(model.message_hidden.weight.shape[0]) if isinstance(model, GridMessageAttributeMlp) else 0
        if args.spatial_mixing == "six-neighbor-hidden-residual" and not isinstance(model, GridMessageAttributeMlp):
            message_size = args.message_size or requested_hidden_size
            model = GridMessageAttributeMlp.from_base(model, message_size)
        elif isinstance(model, GridMessageAttributeMlp) and args.message_size not in (0, message_size):
            raise ValueError(f"requested message size {args.message_size} does not match warm message size {message_size}")
        if args.freeze_base:
            freeze_grid_message_base(model)
        if args.candidate_table_oracle:
            if len(corpus["frames"]) != 1:
                raise ValueError("candidate oracle requires exactly one corpus frame")
            normalized_attributes = (initial_attributes[0] - lower_np) / span_np
            model = CandidateAttributeTable(normalized_attributes)
        phase = "geometry"
        geometries = [
            build_sparse_geometry(frame, args.render_width, args.depth_bins, output_ranges[4:6, 1], args.context_mode, frequencies)
            for frame in corpus["frames"]
        ]
        initial_radius = [mx.array(attributes[:, 4:6]) for attributes in initial_attributes]
        training_geometries = [geometries[index] for index in frame_split["trainIndices"]]
        training_initial_radius = [initial_radius[index] for index in frame_split["trainIndices"]]
        phase = "initial-preview"
        initial_evaluation_rows = evaluate_frame_set(
            model,
            geometries,
            corpus["frames"],
            frame_split["evaluationIndices"],
            lower,
            span,
            args.depth_bins,
            args.edge_weight,
            output_dir,
            "initial",
        )
        initial_preview_path = output_dir / "preview-initial.png"
        target_preview_path = output_dir / "preview-target.png"
        shutil.copyfile(initial_evaluation_rows[0]["preview"], initial_preview_path)
        shutil.copyfile(initial_evaluation_rows[0]["targetPreview"], target_preview_path)
        initial_pixel_loss = mean_metric(initial_evaluation_rows, "pixelLoss")
        initial_edge_loss = mean_metric(initial_evaluation_rows, "edgeLoss")
        initial_loss = mean_metric(initial_evaluation_rows, "loss")

        def loss_fn(active_model):
            total = mx.array(0.0)
            for geometry, initial_radius_values in zip(training_geometries, training_initial_radius):
                prediction, attributes = render_frame(active_model, geometry, lower, span, args.depth_bins)
                total = total + image_loss(prediction, geometry["target"], args.edge_weight)
                total = total + mx.mean(mx.square(attributes[:, 4:6] - initial_radius_values)) * args.radius_preservation
            return total / len(training_geometries)

        initial_training_loss_value = loss_fn(model)
        mx.eval(initial_training_loss_value)
        training_losses = [{"step": 0, "loss": float(initial_training_loss_value.item())}]
        if not args.probe_only and args.steps > 0:
            phase = "training"
            optimizer = optim.Adam(learning_rate=args.learning_rate)

            loss_and_grad = nn.value_and_grad(model, loss_fn)
            for step in range(args.steps):
                loss, gradients = loss_and_grad(model)
                optimizer.update(model, gradients)
                mx.eval(model.parameters(), optimizer.state, loss)
                if step == 0 or (step + 1) % 20 == 0 or step + 1 == args.steps:
                    training_losses.append({"step": step + 1, "loss": float(loss.item())})
        phase = "trained-preview"
        trained_evaluation_rows = evaluate_frame_set(
            model,
            geometries,
            corpus["frames"],
            frame_split["evaluationIndices"],
            lower,
            span,
            args.depth_bins,
            args.edge_weight,
            output_dir,
            "trained",
        )
        trained_preview_path = output_dir / "preview-trained.png"
        shutil.copyfile(trained_evaluation_rows[0]["preview"], trained_preview_path)
        trained_pixel_loss = mean_metric(trained_evaluation_rows, "pixelLoss")
        trained_edge_loss = mean_metric(trained_evaluation_rows, "edgeLoss")
        trained_loss = mean_metric(trained_evaluation_rows, "loss")
        evaluation_frames = []
        for initial_row, trained_row in zip(initial_evaluation_rows, trained_evaluation_rows):
            evaluation_frames.append({
                "frameIndex": initial_row["frameIndex"],
                "frameId": initial_row["frameId"],
                "sameStateCaptureId": initial_row["sameStateCaptureId"],
                "targetPreview": initial_row["targetPreview"],
                "initialPreview": initial_row["preview"],
                "trainedPreview": trained_row["preview"],
                "initialLoss": initial_row["loss"],
                "trainedLoss": trained_row["loss"],
                "initialPixelLoss": initial_row["pixelLoss"],
                "trainedPixelLoss": trained_row["pixelLoss"],
                "initialEdgeLoss": initial_row["edgeLoss"],
                "trainedEdgeLoss": trained_row["edgeLoss"],
            })
        phase = "model-artifact"
        if args.candidate_table_oracle:
            model_path = output_dir / "candidate-attributes.f32"
            candidate_attributes = np.asarray(lower + model_attributes(model, geometries[0]["inputs"], geometries[0]["neighborRows"]) * span).astype("<f4")
            model_bytes = candidate_attributes.tobytes()
            model_path.write_bytes(model_bytes)
            model_receipt = {
                "path": str(model_path),
                "schema": "kaminos-boundary-splat-candidate-attribute-table-v0",
                "identity": f"sha256:{sha256_bytes(model_bytes)}",
                "bytes": len(model_bytes),
                "candidateCount": candidate_attributes.shape[0],
                "authority": "per-candidate-free-attribute-oracle-v0",
                "deployable": False,
            }
        elif args.context_mode == "none":
            model_path = output_dir / "model-artifact.json"
            serialize_model(model, warm_artifact, model_path)
            phase = "compile"
            compiled_receipt = compile_model(output_dir, model_path, model, corpus["frames"][frame_split["trainIndices"][0]], lower_np, span_np)
            model_receipt = {
                "path": str(model_path),
                "schema": MODEL_SCHEMA,
                "compiledReceipt": str(output_dir / "compiled" / "compiled-model.json"),
                "identity": compiled_receipt["identity"],
                "authority": "shared-pointwise-feature-mlp-v0",
                "deployable": True,
            }
        elif args.spatial_mixing == "none":
            model_path = output_dir / "spatial-model-artifact.json"
            serialize_spatial_model(model, output_ranges, feature_names, args.context_mode, frequencies, model_path)
            model_bytes = model_path.read_bytes()
            model_receipt = {
                "path": str(model_path),
                "schema": SPATIAL_MODEL_SCHEMA,
                "identity": f"sha256:{sha256_bytes(model_bytes)}",
                "authority": (
                    "shared-local-grid-conditioned-feature-mlp-v0"
                    if args.context_mode == "world-grid-neighborhood"
                    else (
                        "shared-multi-radius-grid-conditioned-feature-mlp-v0"
                        if args.context_mode == "world-grid-pyramid"
                        else "shared-position-conditioned-feature-mlp-v0"
                    )
                ),
                "deployable": False,
            }
        else:
            model_path = output_dir / "grid-message-model-artifact.json"
            serialize_grid_message_model(model, output_ranges, feature_names, frequencies, model_path)
            model_bytes = model_path.read_bytes()
            model_receipt = {
                "path": str(model_path),
                "schema": GRID_MESSAGE_MODEL_SCHEMA,
                "identity": f"sha256:{sha256_bytes(model_bytes)}",
                "authority": "shared-six-neighbor-hidden-residual-attribute-mlp-v0",
                "deployable": False,
            }
        report.update({
            "status": "probe-only" if args.probe_only else "trained",
            "failurePhase": None,
            "backend": "mlx",
            "device": str(mx.default_device()),
            "corpus": {"path": corpus["path"], "identity": corpus["identity"], "frameCount": len(corpus["frames"]), "candidateCount": corpus["candidateCount"]},
            "warmStart": warm_receipt,
            "render": {
                "width": geometries[0]["width"],
                "height": geometries[0]["height"],
                "fragmentCount": sum(item["fragmentCount"] for item in geometries),
                "depthBins": args.depth_bins,
                "blend": "depth-binned-alpha-over-v0" if args.depth_bins > 1 else "src-alpha-plus-destination-additive-v0",
            },
            "training": {
                "requestedSteps": args.steps,
                "steps": 0 if args.probe_only else args.steps,
                "learningRate": args.learning_rate,
                "edgeWeight": args.edge_weight,
                "modelAuthority": model_receipt["authority"],
                "contextMode": args.context_mode,
                "spatialMixing": args.spatial_mixing,
                "messageSize": message_size,
                "basePathFrozen": bool(args.freeze_base),
                "frameSplitAuthority": frame_split["authority"],
                "evaluationLossAuthority": "held-out-frame-mean-v0" if frame_split["authority"] == "explicit-disjoint-frame-holdout-v0" else "train-frame-mean-v0",
                "trainFrameIndices": frame_split["trainIndices"],
                "trainFrameIds": frame_split["trainFrameIds"],
                "evaluationFrameIndices": frame_split["evaluationIndices"],
                "evaluationFrameIds": frame_split["evaluationFrameIds"],
                "spatialMixingExpansionAuthority": "zero-delta-active-six-neighbor-hidden-residual-v0" if warm_spatial_mixing == "none" and args.spatial_mixing == "six-neighbor-hidden-residual" else None,
                "fourierFrequencies": frequencies if args.context_mode in ("world-fourier", "world-grid-neighborhood", "world-grid-pyramid") else [],
                "gridContextAuthority": "multi-radius-axial-grid-context-v0" if args.context_mode == "world-grid-pyramid" else None,
                "inputChannels": len(feature_names),
                "warmHiddenSize": warm_hidden_size,
                "hiddenSize": requested_hidden_size,
                "hiddenWidthExpansionAuthority": "zero-delta-active-hidden-width-expansion-v0" if hidden_width_expansion else None,
                "initialLoss": initial_loss,
                "trainedLoss": trained_loss,
                "initialPixelLoss": initial_pixel_loss,
                "trainedPixelLoss": trained_pixel_loss,
                "initialEdgeLoss": initial_edge_loss,
                "trainedEdgeLoss": trained_edge_loss,
                "trainingInitialLoss": training_losses[0]["loss"],
                "trainingTrainedLoss": training_losses[-1]["loss"],
                "trainingLossTrace": training_losses,
                "lossTrace": training_losses,
            },
            "evaluationFrames": evaluation_frames,
            "previews": {
                "initial": str(initial_preview_path),
                "target": str(target_preview_path),
                "trained": str(trained_preview_path),
                "frames": evaluation_frames,
            },
            "modelArtifact": model_receipt,
        })
    except BaseException as error:
        report.update({
            "status": "failed",
            "failurePhase": phase,
            "error": str(error),
            "errorType": type(error).__name__,
            "backend": "mlx",
            "device": str(mx.default_device()),
        })
        raise
    finally:
        report["finishedAt"] = time.time()
        report["elapsedSeconds"] = report["finishedAt"] - started_at
        write_json(report_path, report)
    print(json.dumps({"status": report["status"], "initialLoss": report["training"]["initialLoss"], "trainedLoss": report["training"]["trainedLoss"], "elapsedSeconds": report["elapsedSeconds"]}))


if __name__ == "__main__":
    main()
