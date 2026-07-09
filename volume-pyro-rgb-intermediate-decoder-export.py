#!/usr/bin/env python3
"""Train/export a tiny WebGPU-route-shaped Pyro RGB intermediate decoder."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.pyro-rgb-intermediate-decoder-export.v0"
IDENTITY = "pyro-rgb-intermediate-route-shaped-tiny-decoder-export-v0"
ROUTE_ID = "pyro.rgb-intermediate-decoder.webgpu-local.v0"
MODEL_ID = "kaminos/pyro-rgb-intermediate-decoder"
KERNEL_PROFILE = "tiny-3x3-carrier-decoder-wgsl-v0"
PAIR_AUTHORITY = "sequential-route-captures-not-frame-locked"
LOW_CARRIER_INPUT_ROLE = "lowCarrierInput"
RGB_TARGET_ROLE = "rgbTarget"
LIMITATION = "route-shaped-rgb-intermediate-map-smoke-not-live-webgpu-product-proof"
FEATURE_IDENTITY = "debug-flow-rgb-engineered-carrier-planes-v0"
TARGET_IDENTITY = "rgb-derived-intermediate-fire-detail-maps-v0"
BASELINE_MEAN_ROLE = "baselineMeanMaps"
BASELINE_LINEAR_ROLE = "baselineCarrierLinearMaps"
DECODER_ROLE = "webgpuTiny3x3IntermediateDecoder"
ARCHITECTURE_MATRIX_IDENTITY = "architectureMatrix"
OUTPUT_ROLES = [
    "hot-core",
    "fire-body",
    "smoke-body",
    "edge-breakup",
    "radiance-gain",
    "confidence-alpha",
]
ARCHITECTURE_MATRIX_DEFAULT = [
    {"variantId": "linear-k3", "family": "linear-logistic", "kernelSize": 3, "hiddenChannels": 0},
    {"variantId": "linear-k5", "family": "linear-logistic", "kernelSize": 5, "hiddenChannels": 0},
    {"variantId": "elm-k3-h16", "family": "elm-relu-logistic", "kernelSize": 3, "hiddenChannels": 16},
    {"variantId": "elm-k5-h16", "family": "elm-relu-logistic", "kernelSize": 5, "hiddenChannels": 16},
]


class ExportFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def load_alpha_helpers() -> Any:
    helper_path = Path(__file__).with_name("volume-render-rgb-alpha-cleanup.py")
    if not helper_path.exists():
        raise ExportFailure("helper-load", "RGB/PNG helper script is missing.", {"path": str(helper_path)})
    spec = importlib.util.spec_from_file_location("kaminos_rgb_alpha_cleanup", helper_path)
    if spec is None or spec.loader is None:
        raise ExportFailure("helper-load", "Could not load RGB/PNG helper module.", {"path": str(helper_path)})
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


H = load_alpha_helpers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-manifest", required=True, help="Manifest from volume-pyro-rgb-reconstruction-dataset.mjs.")
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--out", help="Output manifest path. Defaults to <out-dir>/manifest.json.")
    parser.add_argument("--train-samples", type=int, default=60000, help="Deterministic training pixels.")
    parser.add_argument("--test-samples", type=int, default=30000, help="Deterministic held-out pixels.")
    parser.add_argument("--ridge", type=float, default=1.0e-3, help="Ridge regularization.")
    parser.add_argument("--seed", type=int, default=730709, help="Deterministic pixel split seed.")
    parser.add_argument("--logit-epsilon", type=float, default=1.0e-4, help="Target clamp before logit solve.")
    parser.add_argument("--architecture-matrix", action="store_true", help="Run the default support-width/depth architectureMatrix.")
    return parser.parse_args()


def utc_now() -> str:
    return np.datetime64("now", "s").astype(str) + "Z"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def dataset_payload(path: Path) -> dict[str, Any]:
    payload = read_json(path)
    dataset = payload.get("dataset", payload)
    if not isinstance(dataset, dict):
        raise ExportFailure("manifest-read", "Dataset manifest root is not an object.", {"path": str(path)})
    if dataset.get("schema") != "kaminos.volume.pyro-rgb-reconstruction-dataset.v0":
        raise ExportFailure("manifest-read", "Dataset manifest schema mismatch.", {
            "path": str(path),
            "schema": dataset.get("schema"),
        })
    if dataset.get("pairAuthority") != PAIR_AUTHORITY:
        raise ExportFailure("manifest-read", "Dataset pair authority is not the expected sequential identity.", {
            "expected": PAIR_AUTHORITY,
            "actual": dataset.get("pairAuthority"),
        })
    return dataset


def capture_path(dataset: dict[str, Any], role: str) -> Path:
    capture = dataset.get("captures", {}).get(role)
    if not isinstance(capture, dict):
        raise ExportFailure("manifest-read", "Dataset missing required capture role.", {"role": role})
    effective = capture.get("effective") if isinstance(capture.get("effective"), dict) else {}
    path = effective.get("path") or capture.get("out")
    if not path:
        raise ExportFailure("manifest-read", "Dataset capture role has no image path.", {"role": role})
    return Path(path)


def capture_effective(dataset: dict[str, Any], role: str) -> dict[str, Any]:
    capture = dataset.get("captures", {}).get(role, {})
    effective = capture.get("effective")
    return effective if isinstance(effective, dict) else {}


def rgb_float(path: Path) -> tuple[np.ndarray, np.ndarray]:
    rgba = H.read_png_rgba(path)
    return rgba[:, :, :3].astype(np.float32) / 255.0, rgba


def resize_nearest(rgb: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    target_h, target_w = shape
    source_h, source_w = rgb.shape[:2]
    if (source_h, source_w) == (target_h, target_w):
        return rgb.copy()
    y = np.minimum((np.arange(target_h) * source_h / target_h).astype(np.int64), source_h - 1)
    x = np.minimum((np.arange(target_w) * source_w / target_w).astype(np.int64), source_w - 1)
    return rgb[y[:, None], x[None, :], :]


def rgb_norm(rgb: np.ndarray) -> np.ndarray:
    return np.sqrt(np.sum(np.square(rgb), axis=2))


def luma(rgb: np.ndarray) -> np.ndarray:
    return np.sum(rgb * np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32), axis=2)


def normalize_by_percentile(values: np.ndarray, percentile: float = 99.0) -> np.ndarray:
    scale = float(np.percentile(values, percentile)) if np.any(values > 0) else 1.0
    return np.clip(values / max(scale, 1.0e-6), 0.0, 1.0)


def gradient_magnitude(values: np.ndarray) -> np.ndarray:
    dy = np.zeros_like(values)
    dx = np.zeros_like(values)
    dy[1:-1, :] = (values[2:, :] - values[:-2, :]) * 0.5
    dx[:, 1:-1] = (values[:, 2:] - values[:, :-2]) * 0.5
    return np.sqrt(np.square(dx) + np.square(dy))


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / max(edge1 - edge0, 1.0e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def carrier_planes(input_rgb: np.ndarray) -> tuple[np.ndarray, list[str]]:
    h, w, _ = input_rgb.shape
    lum = luma(input_rgb)
    norm = normalize_by_percentile(rgb_norm(input_rgb), 99.0)
    yy, xx = np.meshgrid(
        np.linspace(-1.0, 1.0, h, dtype=np.float32),
        np.linspace(-1.0, 1.0, w, dtype=np.float32),
        indexing="ij",
    )
    red_minus_blue = np.clip(input_rgb[:, :, 0] - input_rgb[:, :, 2], -1.0, 1.0)
    red_minus_green = np.clip(input_rgb[:, :, 0] - input_rgb[:, :, 1], -1.0, 1.0)
    saturation = np.max(input_rgb, axis=2) - np.min(input_rgb, axis=2)
    grad = normalize_by_percentile(gradient_magnitude(lum), 98.0)
    planes = np.stack([
        input_rgb[:, :, 0],
        input_rgb[:, :, 1],
        input_rgb[:, :, 2],
        lum,
        norm,
        red_minus_blue,
        red_minus_green,
        saturation,
        grad,
        xx,
        yy,
        yy * yy,
    ], axis=0).astype(np.float32)
    names = [
        "carrier-r",
        "carrier-g",
        "carrier-b",
        "carrier-luma",
        "carrier-rgb-norm",
        "carrier-red-minus-blue",
        "carrier-red-minus-green",
        "carrier-saturation",
        "carrier-luma-gradient",
        "screen-x",
        "screen-y",
        "screen-y2",
    ]
    return planes, names


def target_maps(target_rgb: np.ndarray, raw_rgb: np.ndarray) -> np.ndarray:
    target_luma = luma(target_rgb)
    target_norm = normalize_by_percentile(rgb_norm(target_rgb), 99.0)
    raw_luma = luma(raw_rgb)
    red = target_rgb[:, :, 0]
    green = target_rgb[:, :, 1]
    blue = target_rgb[:, :, 2]
    hot_core = smoothstep(0.50, 0.92, normalize_by_percentile(target_luma, 99.5))
    fire_chroma = np.clip(red * 1.15 + green * 0.35 - blue * 0.45, 0.0, 1.0)
    fire_body = np.clip(target_norm * smoothstep(0.06, 0.42, fire_chroma), 0.0, 1.0)
    cool_smoke = np.clip((green + blue) * 0.48 - red * 0.18, 0.0, 1.0)
    smoke_body = np.clip(smoothstep(0.025, 0.22, target_luma) * smoothstep(0.015, 0.18, cool_smoke), 0.0, 1.0)
    edge_breakup = normalize_by_percentile(gradient_magnitude(target_luma), 98.5)
    radiance_gain = np.clip((target_luma - raw_luma) * 2.0 + fire_body * 0.35, 0.0, 1.0)
    confidence_alpha = smoothstep(0.015, 0.18, target_norm)
    return np.stack([
        hot_core,
        fire_body,
        smoke_body,
        edge_breakup,
        radiance_gain,
        confidence_alpha,
    ], axis=0).astype(np.float32)


def split_indices(pixel_count: int, train_samples: int, test_samples: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    perm = rng.permutation(pixel_count)
    train_count = min(max(1, int(train_samples)), max(1, pixel_count - 1))
    test_count = min(max(1, int(test_samples)), max(1, pixel_count - train_count))
    train = perm[:train_count]
    test = perm[train_count:train_count + test_count]
    if test.size == 0:
        test = perm[-1:]
    return train, test


def logit(values: np.ndarray, epsilon: float) -> np.ndarray:
    clipped = np.clip(values, epsilon, 1.0 - epsilon)
    return np.log(clipped / (1.0 - clipped))


def sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(values, -60.0, 60.0)))


def validate_kernel_size(kernel_size: int) -> int:
    kernel_size = int(kernel_size)
    if kernel_size < 1 or kernel_size % 2 != 1:
        raise ExportFailure("training", "kernelSize must be a positive odd integer.", {"kernelSize": kernel_size})
    return kernel_size


def sampled_conv_features(planes: np.ndarray, indices: np.ndarray, h: int, w: int, kernel_size: int = 3) -> np.ndarray:
    kernel_size = validate_kernel_size(kernel_size)
    radius = kernel_size // 2
    channels = planes.shape[0]
    padded = np.pad(planes, ((0, 0), (radius, radius), (radius, radius)), mode="reflect")
    ys = indices // w
    xs = indices % w
    features = np.empty((indices.size, channels * kernel_size * kernel_size), dtype=np.float32)
    offset = 0
    for channel in range(channels):
        for ky in range(kernel_size):
            for kx in range(kernel_size):
                features[:, offset] = padded[channel, ys + ky, xs + kx]
                offset += 1
    return features


def all_conv_features(planes: np.ndarray, kernel_size: int = 3) -> np.ndarray:
    kernel_size = validate_kernel_size(kernel_size)
    radius = kernel_size // 2
    channels, h, w = planes.shape
    padded = np.pad(planes, ((0, 0), (radius, radius), (radius, radius)), mode="reflect")
    chunks = []
    for channel in range(channels):
        for ky in range(kernel_size):
            for kx in range(kernel_size):
                chunks.append(padded[channel, ky:ky + h, kx:kx + w])
    return np.stack(chunks, axis=2).reshape(-1, channels * kernel_size * kernel_size).astype(np.float32)


def solve_ridge(features: np.ndarray, targets: np.ndarray, ridge: float) -> tuple[np.ndarray, np.ndarray]:
    x = np.concatenate([features.astype(np.float64), np.ones((features.shape[0], 1), dtype=np.float64)], axis=1)
    y = targets.astype(np.float64)
    xtx = x.T @ x
    penalty = np.eye(xtx.shape[0], dtype=np.float64) * max(float(ridge), 0.0)
    penalty[-1, -1] = 0.0
    solved = np.linalg.solve(xtx + penalty, x.T @ y)
    return solved[:-1].T.astype(np.float32), solved[-1].astype(np.float32)


def apply_decoder_features(features: np.ndarray, weights: np.ndarray, bias: np.ndarray, chunk: int = 250000) -> np.ndarray:
    out = np.empty((features.shape[0], weights.shape[0]), dtype=np.float32)
    for start in range(0, features.shape[0], chunk):
        stop = min(start + chunk, features.shape[0])
        out[start:stop] = sigmoid(features[start:stop].astype(np.float64) @ weights.T.astype(np.float64) + bias)
    return out


def cpu_mirror_apply(planes: np.ndarray, weights: np.ndarray, bias: np.ndarray, kernel_size: int = 3) -> np.ndarray:
    channels, h, w = planes.shape
    features = all_conv_features(planes, kernel_size)
    flat = apply_decoder_features(features, weights.reshape(weights.shape[0], channels * kernel_size * kernel_size), bias)
    return flat.T.reshape(weights.shape[0], h, w).astype(np.float32)


def relu(values: np.ndarray) -> np.ndarray:
    return np.maximum(values, 0.0)


def variant_seed(seed: int, variant_id: str) -> int:
    return int(seed) + sum((index + 1) * ord(char) for index, char in enumerate(variant_id))


def hidden_projection(feature_count: int, hidden_channels: int, seed: int, variant_id: str) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(variant_seed(seed, variant_id))
    scale = 1.0 / np.sqrt(max(feature_count, 1))
    weights = rng.normal(0.0, scale, size=(feature_count, hidden_channels)).astype(np.float32)
    bias = rng.normal(0.0, 0.05, size=(hidden_channels,)).astype(np.float32)
    return weights, bias


def apply_hidden_features(features: np.ndarray, weights: np.ndarray, bias: np.ndarray, chunk: int = 250000) -> np.ndarray:
    out = np.empty((features.shape[0], weights.shape[1]), dtype=np.float32)
    for start in range(0, features.shape[0], chunk):
        stop = min(start + chunk, features.shape[0])
        out[start:stop] = relu(features[start:stop].astype(np.float64) @ weights.astype(np.float64) + bias)
    return out


def train_linear_variant(
    planes: np.ndarray,
    maps: np.ndarray,
    train_indices: np.ndarray,
    kernel_size: int,
    epsilon: float,
    ridge: float,
) -> dict[str, Any]:
    channels, h, w = planes.shape
    train_features = sampled_conv_features(planes, train_indices, h, w, kernel_size)
    train_targets = logit(maps.reshape(maps.shape[0], -1).T[train_indices], epsilon)
    flat_weights, bias = solve_ridge(train_features, train_targets, ridge)
    weights = flat_weights.reshape(len(OUTPUT_ROLES), channels, kernel_size, kernel_size)
    predicted = cpu_mirror_apply(planes, weights, bias, kernel_size)
    return {
        "predicted": predicted,
        "weights": weights,
        "bias": bias,
        "featureCount": int(train_features.shape[1]),
        "trainableParameterCount": int(weights.size + bias.size),
        "routeTensorCompatible": kernel_size == 3,
    }


def train_elm_variant(
    planes: np.ndarray,
    maps: np.ndarray,
    train_indices: np.ndarray,
    kernel_size: int,
    hidden_channels: int,
    epsilon: float,
    ridge: float,
    seed: int,
    variant_id: str,
) -> dict[str, Any]:
    _channels, h, w = planes.shape
    train_features = sampled_conv_features(planes, train_indices, h, w, kernel_size)
    hidden_weights, hidden_bias = hidden_projection(train_features.shape[1], hidden_channels, seed, variant_id)
    train_hidden = apply_hidden_features(train_features, hidden_weights, hidden_bias)
    train_targets = logit(maps.reshape(maps.shape[0], -1).T[train_indices], epsilon)
    output_weights, output_bias = solve_ridge(train_hidden, train_targets, ridge)
    all_features = all_conv_features(planes, kernel_size)
    all_hidden = apply_hidden_features(all_features, hidden_weights, hidden_bias)
    flat = apply_decoder_features(all_hidden, output_weights, output_bias)
    predicted = flat.T.reshape(maps.shape).astype(np.float32)
    return {
        "predicted": predicted,
        "hiddenWeights": hidden_weights,
        "hiddenBias": hidden_bias,
        "outputWeights": output_weights,
        "outputBias": output_bias,
        "featureCount": int(train_features.shape[1]),
        "trainableParameterCount": int(hidden_weights.size + hidden_bias.size + output_weights.size + output_bias.size),
        "routeTensorCompatible": False,
    }


def train_architecture_variant(
    spec: dict[str, Any],
    planes: np.ndarray,
    maps: np.ndarray,
    train_indices: np.ndarray,
    test_indices: np.ndarray,
    epsilon: float,
    ridge: float,
    seed: int,
) -> dict[str, Any]:
    variant_id = spec["variantId"]
    kernel_size = int(spec["kernelSize"])
    hidden_channels = int(spec.get("hiddenChannels", 0))
    if spec["family"] == "linear-logistic":
        result = train_linear_variant(planes, maps, train_indices, kernel_size, epsilon, ridge)
    elif spec["family"] == "elm-relu-logistic":
        result = train_elm_variant(planes, maps, train_indices, kernel_size, hidden_channels, epsilon, ridge, seed, variant_id)
    else:
        raise ExportFailure("training", "Unsupported architecture matrix family.", {"variantId": variant_id, "family": spec["family"]})
    return {
        **spec,
        **result,
        "metrics": metrics_for(result["predicted"], maps, test_indices),
    }


def solve_linear_baseline(planes: np.ndarray, maps: np.ndarray, train_indices: np.ndarray, epsilon: float, ridge: float) -> np.ndarray:
    channels, h, w = planes.shape
    flat_planes = planes.reshape(channels, -1).T
    train_targets = logit(maps.reshape(maps.shape[0], -1).T[train_indices], epsilon)
    weights, bias = solve_ridge(flat_planes[train_indices], train_targets, ridge)
    return apply_decoder_features(flat_planes, weights, bias).T.reshape(maps.shape).astype(np.float32)


def mean_baseline(maps: np.ndarray, train_indices: np.ndarray) -> np.ndarray:
    flat = maps.reshape(maps.shape[0], -1)
    mean = np.mean(flat[:, train_indices], axis=1)
    return np.repeat(mean[:, None], flat.shape[1], axis=1).reshape(maps.shape).astype(np.float32)


def metrics_for(predicted: np.ndarray, target: np.ndarray, heldout: np.ndarray) -> dict[str, Any]:
    err = predicted - target
    abs_err = np.abs(err)
    sq_err = np.square(err)
    flat_abs = abs_err.reshape(abs_err.shape[0], -1).T
    flat_sq = sq_err.reshape(sq_err.shape[0], -1).T
    held_abs = flat_abs[heldout]
    held_sq = flat_sq[heldout]
    per_role = {}
    for index, role in enumerate(OUTPUT_ROLES):
        role_err = err[index].reshape(-1)
        role_held = role_err[heldout]
        per_role[role] = {
            "mae": float(np.mean(np.abs(role_err))),
            "rmse": float(np.sqrt(np.mean(np.square(role_err)))),
            "heldOutPixelMetrics": {
                "mae": float(np.mean(np.abs(role_held))),
                "rmse": float(np.sqrt(np.mean(np.square(role_held)))),
                "pixelCount": int(heldout.size),
            },
        }
    return {
        "mae": float(np.mean(abs_err)),
        "rmse": float(np.sqrt(np.mean(sq_err))),
        "heldOutPixelMetrics": {
            "mae": float(np.mean(held_abs)),
            "rmse": float(np.sqrt(np.mean(held_sq))),
            "pixelCount": int(heldout.size),
        },
        "perRole": per_role,
    }


def improvement_summary(metrics: dict[str, Any]) -> dict[str, Any]:
    mean_rmse = metrics[BASELINE_MEAN_ROLE]["heldOutPixelMetrics"]["rmse"]
    linear_rmse = metrics[BASELINE_LINEAR_ROLE]["heldOutPixelMetrics"]["rmse"]
    decoder_rmse = metrics[DECODER_ROLE]["heldOutPixelMetrics"]["rmse"]
    return {
        "decoderHeldOutRmseReductionVsMean": rate(mean_rmse - decoder_rmse, mean_rmse),
        "decoderHeldOutRmseReductionVsCarrierLinear": rate(linear_rmse - decoder_rmse, linear_rmse),
    }


def rate(numerator: float, denominator: float) -> float | None:
    if abs(denominator) <= 1.0e-12:
        return None
    return float(numerator / denominator)


def tensor_artifact(path: Path, array: np.ndarray, role: str, shape: list[int]) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    contiguous = np.ascontiguousarray(array.astype(np.float32))
    path.write_bytes(contiguous.tobytes(order="C"))
    return {
        "role": role,
        "path": str(path),
        "sha256": H.sha256_file(path),
        "dtype": "f32",
        "shape": shape,
        "byteLength": int(path.stat().st_size),
    }


def write_map_png(path: Path, values: np.ndarray, role: str, display_label: str) -> dict[str, Any]:
    rgba = H.rgba_from_gray(values)
    H.write_png_rgba(path, rgba)
    return {
        "role": role,
        "displayLabel": display_label,
        "path": str(path),
        "sha256": H.sha256_file(path),
    }


def write_rgb_png(path: Path, rgb: np.ndarray, role: str, display_label: str) -> dict[str, Any]:
    rgba = H.rgba_from_rgb_float(rgb)
    H.write_png_rgba(path, rgba)
    return {
        "role": role,
        "displayLabel": display_label,
        "path": str(path),
        "sha256": H.sha256_file(path),
    }


def proxy_rgb_from_maps(maps: np.ndarray) -> np.ndarray:
    hot, fire, smoke, edge, radiance, alpha = maps
    rgb = np.zeros((maps.shape[1], maps.shape[2], 3), dtype=np.float32)
    rgb[:, :, 0] = 0.95 * fire + 1.00 * hot + 0.45 * radiance + 0.18 * edge
    rgb[:, :, 1] = 0.38 * fire + 0.82 * hot + 0.14 * radiance + 0.16 * smoke
    rgb[:, :, 2] = 0.12 * fire + 0.05 * hot + 0.42 * smoke + 0.10 * edge
    return np.clip(rgb * np.clip(0.35 + 0.85 * alpha, 0.0, 1.0)[:, :, None], 0.0, 1.0)


def map_contact_sheet(target: np.ndarray, predicted: np.ndarray, out_path: Path) -> dict[str, Any]:
    h, w = target.shape[1:]
    label_h = 24
    rows = [
        ("target", target, "TGT"),
        ("predicted", predicted, "PRED"),
        ("absError", np.abs(predicted - target), "ERR"),
    ]
    sheet = np.zeros((len(rows) * (h + label_h), len(OUTPUT_ROLES) * w, 4), dtype=np.uint8)
    sheet[:, :, 3] = 255
    labels = []
    for row_index, (row_role, maps, row_label) in enumerate(rows):
        y0 = row_index * (h + label_h)
        for col_index, role in enumerate(OUTPUT_ROLES):
            x0 = col_index * w
            sheet[y0 + label_h:y0 + label_h + h, x0:x0 + w, :] = H.rgba_from_gray(maps[col_index])
            short = f"{row_label}-{role[:4].upper()}"
            label = H.draw_label(sheet, short, x0 + 8, y0 + 6, 2)
            label["role"] = f"{row_role}:{role}"
            label["displayLabel"] = short
            labels.append(label)
    H.write_png_rgba(out_path, sheet)
    return {
        "path": str(out_path),
        "sha256": H.sha256_file(out_path),
        "rowOrder": [row[0] for row in rows],
        "columnOrder": OUTPUT_ROLES,
        "visibleRasterLabels": {
            "identity": "visible-raster-role-labels-v0",
            "labels": labels,
        },
    }


def rgb_contact_sheet(frames: list[tuple[str, str, np.ndarray]], out_path: Path) -> dict[str, Any]:
    h, w, _ = frames[0][2].shape
    label_h = 24
    sheet = np.zeros((h + label_h, w * len(frames), 4), dtype=np.uint8)
    sheet[:, :, 3] = 255
    labels = []
    for index, (role, display, rgb) in enumerate(frames):
        x0 = index * w
        sheet[label_h:label_h + h, x0:x0 + w, :] = H.rgba_from_rgb_float(rgb)
        label = H.draw_label(sheet, display, x0 + 8, 6, 2)
        label["role"] = role
        label["displayLabel"] = display
        labels.append(label)
    H.write_png_rgba(out_path, sheet)
    return {
        "path": str(out_path),
        "sha256": H.sha256_file(out_path),
        "columnOrder": [frame[0] for frame in frames],
        "visibleRasterLabels": {
            "identity": "visible-raster-role-labels-v0",
            "columnLabels": labels,
        },
    }


def matrix_proxy_rgb_contact_sheet(
    raw_resized: np.ndarray,
    target_rgb: np.ndarray,
    target_proxy: np.ndarray,
    variants: list[dict[str, Any]],
    out_path: Path,
) -> dict[str, Any]:
    frames = [
        ("carrierInput", "CARRIER", raw_resized),
        ("rgbTarget", "TARGET", target_rgb),
        ("targetMapProxyRgb", "MAPTGT", target_proxy),
    ]
    for variant in variants:
        frames.append((variant["variantId"], variant["variantId"].upper()[:10], proxy_rgb_from_maps(variant["predicted"])))
    sheet = rgb_contact_sheet(frames, out_path)
    sheet["identity"] = "matrixProxyRgbContactSheet"
    sheet["architectureMatrix"] = [variant["variantId"] for variant in variants]
    return sheet


def matrix_map_contact_sheet(target: np.ndarray, variants: list[dict[str, Any]], out_path: Path) -> dict[str, Any]:
    selected_roles = ["hot-core", "fire-body", "edge-breakup", "radiance-gain"]
    selected_indices = [OUTPUT_ROLES.index(role) for role in selected_roles]
    h, w = target.shape[1:]
    label_h = 24
    columns = [("target", "TARGET", target)]
    columns.extend((variant["variantId"], variant["variantId"].upper()[:10], variant["predicted"]) for variant in variants)
    sheet = np.zeros((len(selected_roles) * (h + label_h), len(columns) * w, 4), dtype=np.uint8)
    sheet[:, :, 3] = 255
    labels = []
    for row_index, (role, role_index) in enumerate(zip(selected_roles, selected_indices)):
        y0 = row_index * (h + label_h)
        for col_index, (column_role, display, maps) in enumerate(columns):
            x0 = col_index * w
            sheet[y0 + label_h:y0 + label_h + h, x0:x0 + w, :] = H.rgba_from_gray(maps[role_index])
            short = f"{display}-{role[:4].upper()}"
            label = H.draw_label(sheet, short, x0 + 8, y0 + 6, 2)
            label["role"] = f"{column_role}:{role}"
            label["displayLabel"] = short
            labels.append(label)
    H.write_png_rgba(out_path, sheet)
    return {
        "identity": "matrixMapContactSheet",
        "path": str(out_path),
        "sha256": H.sha256_file(out_path),
        "rowOrder": selected_roles,
        "columnOrder": [column[0] for column in columns],
        "visibleRasterLabels": {
            "identity": "visible-raster-role-labels-v0",
            "labels": labels,
        },
    }


def write_failure(out_path: Path | None, out_dir: Path | None, phase: str, message: str, evidence: dict[str, Any]) -> None:
    target = out_path or ((out_dir / "manifest.json") if out_dir is not None else None)
    if target is None:
        return
    write_json(target, {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": message,
        "evidence": evidence,
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_path = Path(args.out) if args.out else out_dir / "manifest.json"
    phase = "start"
    try:
        phase = "manifest-read"
        dataset_manifest_path = Path(args.dataset_manifest)
        dataset = dataset_payload(dataset_manifest_path)
        input_path = capture_path(dataset, LOW_CARRIER_INPUT_ROLE)
        target_path = capture_path(dataset, RGB_TARGET_ROLE)

        phase = "image-read"
        input_rgb, _input_rgba = rgb_float(input_path)
        target_rgb, _target_rgba = rgb_float(target_path)
        raw_resized = resize_nearest(input_rgb, target_rgb.shape[:2])

        phase = "training"
        h, w, _ = target_rgb.shape
        planes, carrier_names = carrier_planes(raw_resized)
        maps = target_maps(target_rgb, raw_resized)
        train_indices, test_indices = split_indices(h * w, args.train_samples, args.test_samples, args.seed)
        matrix_specs = ARCHITECTURE_MATRIX_DEFAULT if args.architecture_matrix else [ARCHITECTURE_MATRIX_DEFAULT[0]]
        variants = [
            train_architecture_variant(
                spec,
                planes,
                maps,
                train_indices,
                test_indices,
                float(args.logit_epsilon),
                float(args.ridge),
                int(args.seed),
            )
            for spec in matrix_specs
        ]
        baseline_variant = next((variant for variant in variants if variant["variantId"] == "linear-k3"), variants[0])
        weights = baseline_variant["weights"]
        bias = baseline_variant["bias"]
        predicted = baseline_variant["predicted"]
        baseline_mean = mean_baseline(maps, train_indices)
        baseline_linear = solve_linear_baseline(planes, maps, train_indices, float(args.logit_epsilon), float(args.ridge))

        phase = "metrics"
        variant_metrics = {variant["variantId"]: variant["metrics"] for variant in variants}
        best_metric_variant = min(
            variants,
            key=lambda variant: variant["metrics"]["heldOutPixelMetrics"]["rmse"],
        )
        metrics = {
            BASELINE_MEAN_ROLE: metrics_for(baseline_mean, maps, test_indices),
            BASELINE_LINEAR_ROLE: metrics_for(baseline_linear, maps, test_indices),
            DECODER_ROLE: metrics_for(predicted, maps, test_indices),
            "variantMetrics": variant_metrics,
            "bestMetricVariant": {
                "variantId": best_metric_variant["variantId"],
                "metric": "heldOutPixelMetrics.rmse",
                "value": best_metric_variant["metrics"]["heldOutPixelMetrics"]["rmse"],
                "visualTruthWarning": "Metric-selected best variant is not visual truth; inspect matrix contact sheets.",
            },
        }
        metrics["improvementSummary"] = improvement_summary(metrics)

        phase = "artifact-write"
        out_dir.mkdir(parents=True, exist_ok=True)
        tensors = {
            "carrierPlanes": tensor_artifact(out_dir / "carrierPlanes.f32.bin", planes, "carrierPlanes", list(planes.shape)),
            "decoderWeights": tensor_artifact(out_dir / "decoderWeights.f32.bin", weights, "decoderWeights", list(weights.shape)),
            "decoderBias": tensor_artifact(out_dir / "decoderBias.f32.bin", bias, "decoderBias", list(bias.shape)),
            "intermediateFields": tensor_artifact(out_dir / "intermediateFields.f32.bin", predicted, "intermediateFields", list(predicted.shape)),
            "targetIntermediateFields": tensor_artifact(out_dir / "targetIntermediateFields.f32.bin", maps, "targetIntermediateFields", list(maps.shape)),
        }
        map_outputs = {}
        for index, role in enumerate(OUTPUT_ROLES):
            key = role.replace("-", "")
            map_outputs[f"{key}Target"] = write_map_png(out_dir / f"{role}-target.png", maps[index], f"{role}:target", f"T-{role}")
            map_outputs[f"{key}Predicted"] = write_map_png(out_dir / f"{role}-predicted.png", predicted[index], f"{role}:predicted", f"P-{role}")
        proxy_predicted = proxy_rgb_from_maps(predicted)
        proxy_target = proxy_rgb_from_maps(maps)
        rgb_outputs = {
            "carrierInput": write_rgb_png(out_dir / "carrier-input-resized.png", raw_resized, "carrierInput", "CARRIER"),
            "rgbTarget": write_rgb_png(out_dir / "rgb-target.png", target_rgb, "rgbTarget", "TARGET"),
            "targetMapProxyRgb": write_rgb_png(out_dir / "target-map-proxy-rgb.png", proxy_target, "targetMapProxyRgb", "MAPTGT"),
            "predictedMapProxyRgb": write_rgb_png(out_dir / "predicted-map-proxy-rgb.png", proxy_predicted, "predictedMapProxyRgb", "MAPPRED"),
        }
        contact_sheets = {
            "mapContactSheet": map_contact_sheet(maps, predicted, out_dir / "pyro-rgb-intermediate-decoder-map-contact.png"),
            "proxyRgbContactSheet": rgb_contact_sheet([
                ("carrierInput", "CARRIER", raw_resized),
                ("rgbTarget", "TARGET", target_rgb),
                ("targetMapProxyRgb", "MAPTGT", proxy_target),
                ("predictedMapProxyRgb", "MAPPRED", proxy_predicted),
            ], out_dir / "pyro-rgb-intermediate-decoder-proxy-rgb-contact.png"),
        }
        if args.architecture_matrix:
            contact_sheets["matrixProxyRgbContactSheet"] = matrix_proxy_rgb_contact_sheet(
                raw_resized,
                target_rgb,
                proxy_target,
                variants,
                out_dir / "pyro-rgb-intermediate-decoder-matrix-proxy-rgb-contact.png",
            )
            contact_sheets["matrixMapContactSheet"] = matrix_map_contact_sheet(
                maps,
                variants,
                out_dir / "pyro-rgb-intermediate-decoder-matrix-map-contact.png",
            )

        phase = "manifest-write"
        manifest = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "completed",
            "createdAt": utc_now(),
            "datasetManifest": str(dataset_manifest_path),
            "pairAuthority": PAIR_AUTHORITY,
            "limitation": LIMITATION,
            "route": {
                "routeId": ROUTE_ID,
                "modelId": MODEL_ID,
                "kernelProfile": KERNEL_PROFILE,
                "requiredInputs": ["carrier-planes", "decoder-weights"],
                "requiredOutputs": OUTPUT_ROLES,
                "requiredStages": ["decode-intermediate-fields", "readback-intermediate-fields"],
            },
            "featureIdentity": FEATURE_IDENTITY,
            "targetIdentity": TARGET_IDENTITY,
            "carrierPlaneNames": carrier_names,
            "architectureMatrix": {
                "identity": ARCHITECTURE_MATRIX_IDENTITY,
                "enabled": bool(args.architecture_matrix),
                "variants": [
                    {
                        "variantId": variant["variantId"],
                        "family": variant["family"],
                        "kernelSize": int(variant["kernelSize"]),
                        "hiddenChannels": int(variant.get("hiddenChannels", 0)),
                        "featureCount": int(variant["featureCount"]),
                        "trainableParameterCount": int(variant["trainableParameterCount"]),
                        "routeTensorCompatible": bool(variant["routeTensorCompatible"]),
                    }
                    for variant in variants
                ],
                "baselineExportVariant": baseline_variant["variantId"],
                "bestMetricVariant": metrics["bestMetricVariant"],
                "candidateBoundary": "Hidden variants are CPU-mirror architecture candidates until a matching WebGPU phase-program route profile lands.",
            },
            "roles": {
                "input": LOW_CARRIER_INPUT_ROLE,
                "target": RGB_TARGET_ROLE,
                "baselineMeanMaps": BASELINE_MEAN_ROLE,
                "baselineCarrierLinearMaps": BASELINE_LINEAR_ROLE,
                "decoder": DECODER_ROLE,
            },
            "model": {
                "identity": IDENTITY,
                "routeId": ROUTE_ID,
                "kernelProfile": KERNEL_PROFILE,
                "dtype": "f32",
                "inputChannels": int(planes.shape[0]),
                "outputChannels": int(len(OUTPUT_ROLES)),
                "kernelSize": [3, 3],
                "activation": "logistic",
                "ridge": float(args.ridge),
                "logitEpsilon": float(args.logit_epsilon),
                "trainSamplesRequested": int(args.train_samples),
                "trainSamplesEffective": int(train_indices.size),
                "testSamplesRequested": int(args.test_samples),
                "testSamplesEffective": int(test_indices.size),
                "seed": int(args.seed),
            },
            "sourceRouteIdentity": {
                "datasetRoutes": dataset.get("routes", {}),
                LOW_CARRIER_INPUT_ROLE: capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("requestedRouteIdentity"),
                RGB_TARGET_ROLE: capture_effective(dataset, RGB_TARGET_ROLE).get("requestedRouteIdentity"),
            },
            "effectiveWitnessIdentity": {
                LOW_CARRIER_INPUT_ROLE: {
                    "effectiveRoute": capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("effectiveRoute"),
                    "prototypeIdentity": capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("prototypeIdentity"),
                    "backend": capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("backend"),
                    "timing": capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("timing"),
                },
                RGB_TARGET_ROLE: {
                    "effectiveRoute": capture_effective(dataset, RGB_TARGET_ROLE).get("effectiveRoute"),
                    "prototypeIdentity": capture_effective(dataset, RGB_TARGET_ROLE).get("prototypeIdentity"),
                    "backend": capture_effective(dataset, RGB_TARGET_ROLE).get("backend"),
                    "timing": capture_effective(dataset, RGB_TARGET_ROLE).get("timing"),
                },
            },
            "sourceChecksums": {
                LOW_CARRIER_INPUT_ROLE: H.sha256_file(input_path),
                RGB_TARGET_ROLE: H.sha256_file(target_path),
                "datasetManifest": H.sha256_file(dataset_manifest_path),
                "carrierPlanes": tensors["carrierPlanes"]["sha256"],
                "decoderWeights": tensors["decoderWeights"]["sha256"],
                "decoderBias": tensors["decoderBias"]["sha256"],
                "intermediateFields": tensors["intermediateFields"]["sha256"],
            },
            "imageShape": {
                "inputOriginal": list(input_rgb.shape),
                "target": list(target_rgb.shape),
                "modelInput": list(raw_resized.shape),
                "carrierPlanes": list(planes.shape),
                "intermediateFields": list(predicted.shape),
            },
            "metrics": metrics,
            "tensors": tensors,
            "outputs": {
                **map_outputs,
                **rgb_outputs,
                **contact_sheets,
            },
            "failurePhase": None,
        }
        write_json(out_path, manifest)
        print(json.dumps(manifest, indent=2))
        return 0
    except ExportFailure as error:
        write_failure(out_path, out_dir, error.phase, str(error), error.evidence)
        print(json.dumps({
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": error.phase,
            "error": str(error),
            "evidence": error.evidence,
        }, indent=2), file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 - preserve unexpected failure phase in a manifest.
        write_failure(out_path, out_dir, phase, str(error), {"exceptionType": type(error).__name__})
        print(json.dumps({
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "error": str(error),
            "evidence": {"exceptionType": type(error).__name__},
        }, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
