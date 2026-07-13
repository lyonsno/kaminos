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
BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER = [
    "position.x", "position.y", "position.z",
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.density", "material.heat", "material.fuel", "material.detail",
    "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
    "micro.x", "micro.y", "micro.z", "micro.w",
]
FEATURES = BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER[3:]
OUTPUTS = ["color.r", "color.g", "color.b", "opacity", "radius.x", "radius.y"]
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


def load_warm_start(path_value, requested_context_mode, requested_frequencies):
    path = Path(path_value).resolve()
    artifact_bytes = path.read_bytes()
    artifact = json.loads(artifact_bytes)
    schema = artifact.get("schema")
    recovered_frequencies = []
    if artifact.get("architecture") != "dense-relu-dense":
        raise ValueError("warm start architecture must be dense-relu-dense")
    if schema == MODEL_SCHEMA:
        warm_context_mode = "none"
        warm_frequencies = []
        expected_features = FEATURES
    elif artifact.get("schema") == SPATIAL_MODEL_SCHEMA:
        warm_context_mode = artifact.get("contextMode")
        warm_frequencies = [float(value) for value in artifact.get("fourierFrequencies", [])]
        if warm_context_mode in ("world-fourier", "world-grid-neighborhood") and not warm_frequencies:
            recovered_frequencies = infer_fourier_frequencies(artifact.get("features") or [])
            warm_frequencies = recovered_frequencies
        context_expansion = warm_context_mode == "world-fourier" and requested_context_mode == "world-grid-neighborhood"
        if warm_context_mode != requested_context_mode and not context_expansion:
            raise ValueError(
                f"warm start context mode {warm_context_mode!r} does not match requested context mode {requested_context_mode!r}"
            )
        if warm_context_mode in ("world-fourier", "world-grid-neighborhood") and warm_frequencies != requested_frequencies:
            raise ValueError(
                f"warm start Fourier frequencies {warm_frequencies!r} do not match requested Fourier frequencies {requested_frequencies!r}"
            )
        expected_features = context_feature_names(warm_context_mode, warm_frequencies)
    else:
        raise ValueError("warm start is not a recognized boundary splat attribute MLP")
    if artifact.get("features") != expected_features or artifact.get("outputs") != OUTPUTS:
        raise ValueError("warm start feature/output order does not match its declared context contract")
    hidden_size = int(artifact["hiddenSize"])
    model = AttributeMlp(hidden_size, len(expected_features))
    layers = artifact.get("layers") or []
    if len(layers) != 2:
        raise ValueError("warm start must contain exactly two dense layers")
    weights = []
    for name, layer in zip(("hidden", "output"), layers):
        matrix = mx.array(layer["weights"]).reshape(layer["outputSize"], layer["inputSize"])
        bias = mx.array(layer["bias"])
        weights.extend([(f"{name}.weight", matrix), (f"{name}.bias", bias)])
    model.load_weights(weights)
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
        "continuation": schema == SPATIAL_MODEL_SCHEMA,
        "legacyFrequencyRecoveryAuthority": "exact-complete-feature-name-groups-v0" if recovered_frequencies else None,
        "contextExpansionAuthority": "zero-delta-local-grid-context-expansion-v0" if warm_context_mode == "world-fourier" and requested_context_mode == "world-grid-neighborhood" else None,
    }, schema, warm_context_mode, warm_frequencies


def parse_fourier_frequencies(value):
    frequencies = [float(item.strip()) for item in value.split(",") if item.strip()]
    if not frequencies or not all(np.isfinite(item) and item > 0 for item in frequencies):
        raise ValueError("fourier frequencies must contain positive finite values")
    return frequencies


def context_feature_names(context_mode, frequencies):
    names = list(FEATURES)
    if context_mode in ("world-xyz", "world-fourier", "world-grid-neighborhood"):
        names.extend(["position.x", "position.y", "position.z"])
    if context_mode in ("world-fourier", "world-grid-neighborhood"):
        for frequency in frequencies:
            label = format(frequency, "g")
            names.extend([f"position.sin.{axis}.{label}" for axis in "xyz"])
            names.extend([f"position.cos.{axis}.{label}" for axis in "xyz"])
    if context_mode == "world-grid-neighborhood":
        names.extend([
            "neighbor.occupancy.x-", "neighbor.occupancy.x+",
            "neighbor.occupancy.y-", "neighbor.occupancy.y+",
            "neighbor.occupancy.z-", "neighbor.occupancy.z+",
        ])
        for statistic in ("mean", "max", "laplacian", "gradient.x", "gradient.y", "gradient.z"):
            names.extend([f"neighbor.{statistic}.{feature}" for feature in FEATURES])
    return names


def local_grid_neighborhood_channels(candidates, grid):
    if not isinstance(grid, int) or grid <= 0:
        raise ValueError("local-grid context requires a positive integer source grid")
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
    offsets = np.asarray([
        [-1, 0, 0], [1, 0, 0],
        [0, -1, 0], [0, 1, 0],
        [0, 0, -1], [0, 0, 1],
    ], dtype=np.int32)
    features = candidates[:, 3:].astype(np.float32)
    neighbor_values = np.zeros((len(candidates), len(offsets), len(FEATURES)), dtype=np.float32)
    occupancy = np.zeros((len(candidates), len(offsets)), dtype=np.float32)
    for neighbor_index, offset in enumerate(offsets):
        neighbor_cells = indices + offset
        in_bounds = np.all((neighbor_cells >= 0) & (neighbor_cells < grid), axis=1)
        neighbor_linear = neighbor_cells[:, 0] + grid * (neighbor_cells[:, 1] + grid * neighbor_cells[:, 2])
        rows = np.full(len(candidates), -1, dtype=np.int32)
        rows[in_bounds] = lookup[neighbor_linear[in_bounds]]
        present = rows >= 0
        occupancy[present, neighbor_index] = 1.0
        neighbor_values[present, neighbor_index] = features[rows[present]]
    neighbor_mean = np.mean(neighbor_values, axis=1)
    neighbor_max = np.max(neighbor_values, axis=1)
    laplacian = neighbor_mean - features
    gradients = [
        (neighbor_values[:, 1] - neighbor_values[:, 0]) * 0.5,
        (neighbor_values[:, 3] - neighbor_values[:, 2]) * 0.5,
        (neighbor_values[:, 5] - neighbor_values[:, 4]) * 0.5,
    ]
    return np.concatenate([occupancy, neighbor_mean, neighbor_max, laplacian, *gradients], axis=1)


def encode_candidate_inputs(candidates, context_mode, frequencies, grid=None):
    features = mx.array(candidates[:, 3:].astype(np.float32))
    if context_mode == "none":
        return features
    positions = mx.array(candidates[:, :3].astype(np.float32))
    channels = [features, positions]
    if context_mode in ("world-fourier", "world-grid-neighborhood"):
        for frequency in frequencies:
            channels.append(mx.sin(positions * frequency * 2.0 * np.pi))
            channels.append(mx.cos(positions * frequency * 2.0 * np.pi))
    if context_mode == "world-grid-neighborhood":
        channels.append(mx.array(local_grid_neighborhood_channels(candidates, grid)))
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
    hidden_bias = np.zeros(hidden_size, dtype=np.float32)
    hidden_bias[:base_hidden_size] = np.asarray(base_model.hidden.bias)
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


def predict_numpy(model, features, output_ranges):
    normalized = np.asarray(model(mx.array(features.astype(np.float32))))
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
    normalized = model(geometry["inputs"])
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
        "fourierFrequencies": frequencies if context_mode in ("world-fourier", "world-grid-neighborhood") else [],
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
    parser.add_argument("--context-mode", choices=["none", "world-xyz", "world-fourier", "world-grid-neighborhood"], default="none")
    parser.add_argument("--fourier-frequencies", default="1,2,4,8")
    parser.add_argument("--hidden-size", type=int, default=0)
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
        if args.steps < 0 or args.hidden_size < 0 or args.render_width <= 0 or args.learning_rate <= 0 or args.depth_bins <= 0 or args.edge_weight < 0:
            raise ValueError("steps, hidden-size, and edge-weight must be non-negative; render-width, learning-rate, and depth-bins must be positive")
        frequencies = parse_fourier_frequencies(args.fourier_frequencies)
        if args.candidate_table_oracle and args.context_mode != "none":
            raise ValueError("candidate table oracle cannot be combined with spatial conditioning")
        feature_names = context_feature_names(args.context_mode, frequencies)
        phase = "corpus"
        corpus = load_corpus(args.corpus)
        phase = "warm-start"
        base_model, warm_artifact, output_ranges, warm_receipt, warm_schema, warm_context_mode, warm_frequencies = load_warm_start(
            args.warm_start,
            args.context_mode,
            frequencies,
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
            )
            for frame in corpus["frames"]
        ]
        exact_spatial_continuation = warm_schema == SPATIAL_MODEL_SCHEMA and warm_context_mode == args.context_mode
        model = base_model if exact_spatial_continuation or args.context_mode == "none" else expand_warm_start_with_context(base_model, len(feature_names))
        warm_hidden_size = int(model.hidden.weight.shape[0])
        requested_hidden_size = args.hidden_size or warm_hidden_size
        if requested_hidden_size < warm_hidden_size:
            raise ValueError(f"requested hidden size {requested_hidden_size} cannot shrink warm hidden size {warm_hidden_size}")
        hidden_width_expansion = requested_hidden_size > warm_hidden_size
        if hidden_width_expansion:
            model = expand_hidden_size(model, requested_hidden_size)
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
        phase = "initial-preview"
        initial_prediction, _ = render_frame(model, geometries[0], lower, span, args.depth_bins)
        mx.eval(initial_prediction)
        initial_preview_path = output_dir / "preview-initial.png"
        target_preview_path = output_dir / "preview-target.png"
        save_preview(initial_preview_path, initial_prediction)
        save_preview(target_preview_path, geometries[0]["target"])
        initial_pixel_loss = float(pixel_loss(initial_prediction, geometries[0]["target"]).item())
        initial_edge_loss = float(edge_loss(initial_prediction, geometries[0]["target"]).item())
        initial_loss = initial_pixel_loss + initial_edge_loss * args.edge_weight
        losses = [{"step": 0, "loss": initial_loss}]
        if not args.probe_only and args.steps > 0:
            phase = "training"
            optimizer = optim.Adam(learning_rate=args.learning_rate)

            def loss_fn(active_model):
                total = mx.array(0.0)
                for geometry, initial_radius_values in zip(geometries, initial_radius):
                    prediction, attributes = render_frame(active_model, geometry, lower, span, args.depth_bins)
                    total = total + image_loss(prediction, geometry["target"], args.edge_weight)
                    total = total + mx.mean(mx.square(attributes[:, 4:6] - initial_radius_values)) * args.radius_preservation
                return total / len(geometries)

            loss_and_grad = nn.value_and_grad(model, loss_fn)
            for step in range(args.steps):
                loss, gradients = loss_and_grad(model)
                optimizer.update(model, gradients)
                mx.eval(model.parameters(), optimizer.state, loss)
                if step == 0 or (step + 1) % 20 == 0 or step + 1 == args.steps:
                    losses.append({"step": step + 1, "loss": float(loss.item())})
        phase = "trained-preview"
        trained_prediction, _ = render_frame(model, geometries[0], lower, span, args.depth_bins)
        mx.eval(trained_prediction)
        trained_preview_path = output_dir / "preview-trained.png"
        save_preview(trained_preview_path, trained_prediction)
        trained_pixel_loss = float(pixel_loss(trained_prediction, geometries[0]["target"]).item())
        trained_edge_loss = float(edge_loss(trained_prediction, geometries[0]["target"]).item())
        trained_loss = trained_pixel_loss + trained_edge_loss * args.edge_weight
        phase = "model-artifact"
        if args.candidate_table_oracle:
            model_path = output_dir / "candidate-attributes.f32"
            candidate_attributes = np.asarray(lower + model(geometries[0]["inputs"]) * span).astype("<f4")
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
            compiled_receipt = compile_model(output_dir, model_path, model, corpus["frames"][0], lower_np, span_np)
            model_receipt = {
                "path": str(model_path),
                "schema": MODEL_SCHEMA,
                "compiledReceipt": str(output_dir / "compiled" / "compiled-model.json"),
                "identity": compiled_receipt["identity"],
                "authority": "shared-pointwise-feature-mlp-v0",
                "deployable": True,
            }
        else:
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
                    else "shared-position-conditioned-feature-mlp-v0"
                ),
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
                "fourierFrequencies": frequencies if args.context_mode in ("world-fourier", "world-grid-neighborhood") else [],
                "inputChannels": len(feature_names),
                "warmHiddenSize": warm_hidden_size,
                "hiddenSize": requested_hidden_size,
                "hiddenWidthExpansionAuthority": "zero-delta-hidden-width-expansion-v0" if hidden_width_expansion else None,
                "initialLoss": initial_loss,
                "trainedLoss": trained_loss,
                "initialPixelLoss": initial_pixel_loss,
                "trainedPixelLoss": trained_pixel_loss,
                "initialEdgeLoss": initial_edge_loss,
                "trainedEdgeLoss": trained_edge_loss,
                "lossTrace": losses,
            },
            "previews": {"initial": str(initial_preview_path), "target": str(target_preview_path), "trained": str(trained_preview_path)},
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
