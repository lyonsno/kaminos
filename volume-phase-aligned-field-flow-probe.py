#!/usr/bin/env python3
"""Phase-aligned field-to-flow diagnostic probe using low-from-high inputs."""

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


SCHEMA = "kaminos.volume.phase-aligned-field-flow-probe.v0"
IDENTITY = "phase-aligned-low-from-high-field-flow-probe-v0"
DOWNSAMPLE_OPERATOR_IDENTITY = "low-from-high-block-average-v0"
FEATURE_IDENTITY = "block-average-plus-six-neighbor-low-field-features-v0"
TARGET_IDENTITY = "derived-flow-debug-diagnostic-rgb-v0"
TARGET_AUTHORITY = "field-derived-curl-divergence-diagnostic-not-shell-render"
MODEL_IDENTITY = "localNeighborhoodMlp"
BASELINE_IDENTITY = "blockAverageRgbBaseline"
TARGET_CHANNELS = ["red", "green", "blue"]

_APPLY_PATH = Path(__file__).with_name("volume-full-grid-field-residual-apply.py")
_APPLY_SPEC = importlib.util.spec_from_file_location("volume_full_grid_field_residual_apply", _APPLY_PATH)
if _APPLY_SPEC is None or _APPLY_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_APPLY_PATH}")
_APPLY = importlib.util.module_from_spec(_APPLY_SPEC)
_APPLY_SPEC.loader.exec_module(_APPLY)

_LABEL_PATH = Path(__file__).with_name("volume-full-grid-diagnostic-rgb-context-ablation.py")
_LABEL_SPEC = importlib.util.spec_from_file_location("volume_full_grid_diagnostic_rgb_context_ablation", _LABEL_PATH)
if _LABEL_SPEC is None or _LABEL_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_LABEL_PATH}")
_LABEL = importlib.util.module_from_spec(_LABEL_SPEC)
_LABEL_SPEC.loader.exec_module(_LABEL)

FLUID_CHANNELS = list(_APPLY.FLUID_CHANNELS)
FRONT_CHANNELS = list(_APPLY.FRONT_CHANNELS)
ALL_CHANNELS = [*FLUID_CHANNELS, *FRONT_CHANNELS]


class ProbeFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application-manifest", required=True, help="Full-grid application manifest with truthHigh role.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--truth-role", default="truthHigh")
    parser.add_argument("--downsample-factor", type=int, default=2)
    parser.add_argument("--train-samples", type=int, default=60_000)
    parser.add_argument("--test-samples", type=int, default=35_000)
    parser.add_argument("--support-sample-fraction", type=float, default=0.55)
    parser.add_argument("--support-scan-samples", type=int, default=120_000)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=45)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--preview-slice-y", type=int)
    parser.add_argument("--seed", type=int, default=7079)
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
        "identity": IDENTITY,
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    }
    if isinstance(error, ProbeFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.evidence
    write_json(path, payload)


def verify_sidecar(descriptor: dict[str, Any]) -> Path:
    path = Path(str(descriptor.get("path") or ""))
    if not path.exists():
        raise ProbeFailure("sidecar-read", f"Missing sidecar {path}", {"descriptor": descriptor})
    expected_bytes = int(descriptor.get("byteLength") or 0)
    actual_bytes = path.stat().st_size
    if expected_bytes and expected_bytes != actual_bytes:
        raise ProbeFailure("sidecar-read", f"Sidecar byte length mismatch for {path}", {
            "expectedBytes": expected_bytes,
            "actualBytes": actual_bytes,
        })
    expected_sha = descriptor.get("sha256")
    actual_sha = sha256_file(path)
    if expected_sha and expected_sha != actual_sha:
        raise ProbeFailure("sidecar-read", f"Sidecar checksum mismatch for {path}", {
            "expectedSha256": expected_sha,
            "actualSha256": actual_sha,
        })
    return path


def load_truth_role(manifest_path: Path, truth_role: str) -> tuple[dict[str, Any], np.memmap, np.memmap, dict[str, Any]]:
    manifest = read_json(manifest_path)
    role = manifest.get("roles", {}).get(truth_role)
    if not role:
        raise ProbeFailure("manifest-read", "Manifest does not expose requested truth role.", {
            "truthRole": truth_role,
            "availableRoles": sorted((manifest.get("roles") or {}).keys()),
        })
    fluid_desc = role.get("fluid") or {}
    front_desc = role.get("front") or {}
    fluid_path = verify_sidecar(fluid_desc)
    front_path = verify_sidecar(front_desc)
    shape = fluid_desc.get("shape") or []
    if len(shape) != 4 or int(shape[3]) != len(FLUID_CHANNELS):
        raise ProbeFailure("manifest-read", "Truth fluid shape/channel mismatch.", {
            "shape": shape,
            "expectedChannels": FLUID_CHANNELS,
            "actualChannels": fluid_desc.get("channelOrder"),
        })
    grid = int(shape[0])
    if shape[:3] != [grid, grid, grid]:
        raise ProbeFailure("manifest-read", "Truth grid must be cubic.", {"shape": shape})
    cells = grid ** 3
    fluid = np.memmap(fluid_path, dtype="<f4", mode="r", shape=(cells, len(FLUID_CHANNELS)))
    front = np.memmap(front_path, dtype="<f4", mode="r", shape=(cells,))
    return manifest, fluid, front, {
        "truthRole": truth_role,
        "grid": grid,
        "fluid": fluid_desc,
        "front": front_desc,
    }


def block_average_high_to_low(high_fluid: np.ndarray, high_front: np.ndarray, high_grid: int, factor: int) -> tuple[np.ndarray, np.ndarray]:
    if factor < 1 or high_grid % factor != 0:
        raise ProbeFailure("downsample", "High grid must be divisible by downsample factor.", {
            "highGrid": high_grid,
            "downsampleFactor": factor,
        })
    low_grid = high_grid // factor
    fluid_4d = np.asarray(high_fluid).reshape(high_grid, high_grid, high_grid, len(FLUID_CHANNELS))
    front_3d = np.asarray(high_front).reshape(high_grid, high_grid, high_grid)
    low_fluid = fluid_4d.reshape(low_grid, factor, low_grid, factor, low_grid, factor, len(FLUID_CHANNELS)).mean(axis=(1, 3, 5), dtype=np.float64).astype(np.float32)
    low_front = front_3d.reshape(low_grid, factor, low_grid, factor, low_grid, factor).mean(axis=(1, 3, 5), dtype=np.float64).astype(np.float32)
    return low_fluid.reshape(low_grid ** 3, len(FLUID_CHANNELS)), low_front.reshape(low_grid ** 3)


def high_to_low_indexes(indexes: np.ndarray, high_grid: int, low_grid: int, factor: int) -> np.ndarray:
    x = indexes % high_grid
    y = (indexes // high_grid) % high_grid
    z = indexes // (high_grid * high_grid)
    lx = np.minimum(low_grid - 1, x // factor)
    ly = np.minimum(low_grid - 1, y // factor)
    lz = np.minimum(low_grid - 1, z // factor)
    return (lx + ly * low_grid + lz * low_grid * low_grid).astype(np.int64, copy=False)


def low_neighbor_features(low_values: np.ndarray, low_fluid: np.ndarray, low_front: np.ndarray, low_indexes: np.ndarray, low_grid: int) -> np.ndarray:
    lx = low_indexes % low_grid
    ly = (low_indexes // low_grid) % low_grid
    lz = low_indexes // (low_grid * low_grid)

    def sample(cx: np.ndarray, cy: np.ndarray, cz: np.ndarray) -> np.ndarray:
        idx = (cx + cy * low_grid + cz * low_grid * low_grid).astype(np.int64, copy=False)
        return np.concatenate([low_fluid[idx], low_front[idx, None]], axis=1).astype(np.float32, copy=False)

    neighbors = np.stack([
        sample(np.maximum(0, lx - 1), ly, lz),
        sample(np.minimum(low_grid - 1, lx + 1), ly, lz),
        sample(lx, np.maximum(0, ly - 1), lz),
        sample(lx, np.minimum(low_grid - 1, ly + 1), lz),
        sample(lx, ly, np.maximum(0, lz - 1)),
        sample(lx, ly, np.minimum(low_grid - 1, lz + 1)),
    ], axis=0)
    deltas = neighbors - low_values.reshape(1, low_values.shape[0], low_values.shape[1])
    return np.concatenate([
        np.mean(deltas, axis=0),
        np.max(np.abs(deltas), axis=0),
    ], axis=1).astype(np.float32, copy=False)


def position_features(indexes: np.ndarray, high_grid: int) -> np.ndarray:
    x = (indexes % high_grid).astype(np.float32)
    y = ((indexes // high_grid) % high_grid).astype(np.float32)
    z = (indexes // (high_grid * high_grid)).astype(np.float32)
    nx = x / max(1, high_grid - 1) * 2 - 1
    ny = y / max(1, high_grid - 1) * 2 - 1
    nz = z / max(1, high_grid - 1) * 2 - 1
    radial = np.sqrt(nx * nx + nz * nz)
    feats = [nx, ny, nz, radial, ny * radial]
    for frequency in (1.0, 2.0, 4.0):
        for axis in (nx, ny, nz):
            phase = np.pi * frequency * axis
            feats.append(np.sin(phase))
            feats.append(np.cos(phase))
    return np.stack(feats, axis=1).astype(np.float32, copy=False)


def build_features(
    indexes: np.ndarray,
    high_grid: int,
    low_grid: int,
    factor: int,
    low_fluid: np.ndarray,
    low_front: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    low_indexes = high_to_low_indexes(indexes, high_grid, low_grid, factor)
    low_values = np.concatenate([low_fluid[low_indexes], low_front[low_indexes, None]], axis=1).astype(np.float32, copy=False)
    low_rgb, _ = _LABEL.derived_flow_debug_rgb(low_fluid, low_indexes, low_grid)
    features = np.concatenate([
        low_values,
        low_values * low_values,
        low_neighbor_features(low_values, low_fluid, low_front, low_indexes, low_grid),
        low_rgb,
        position_features(indexes, high_grid),
    ], axis=1).astype(np.float32, copy=False)
    return features, low_rgb.astype(np.float32, copy=False), low_indexes


def support_indexes(high_fluid: np.ndarray, high_grid: int, rng: np.random.Generator, scan_count: int) -> tuple[np.ndarray, dict[str, Any]]:
    cells = high_grid ** 3
    scan = rng.choice(cells, size=min(scan_count, cells), replace=False).astype(np.int64)
    rgb, diagnostics = _LABEL.derived_flow_debug_rgb(high_fluid, scan, high_grid)
    norm = np.linalg.norm(rgb.astype(np.float32), axis=1)
    threshold = max(1.0e-5, float(np.quantile(norm.astype(np.float64), 0.88)) * 0.35)
    support = scan[np.flatnonzero(norm > threshold)]
    return support.astype(np.int64, copy=False), {
        "identity": "truth-derived-flow-support-sampling-diagnostics-only-v0",
        "supportScanSamples": int(scan.shape[0]),
        "supportCount": int(support.shape[0]),
        "supportThreshold": threshold,
        "targetDiagnostics": diagnostics,
    }


def mixed_sample_indexes(
    cell_count: int,
    sample_count: int,
    support: np.ndarray,
    support_fraction: float,
    rng: np.random.Generator,
    exclude: np.ndarray | None = None,
) -> np.ndarray:
    sample_count = min(max(1, int(sample_count)), cell_count)
    exclude_set = set(int(x) for x in exclude.tolist()) if exclude is not None and exclude.size else set()
    support = support.astype(np.int64, copy=False)
    if exclude_set:
        support = np.array([int(x) for x in support.tolist() if int(x) not in exclude_set], dtype=np.int64)
    support_count = min(support.shape[0], int(sample_count * max(0.0, min(1.0, float(support_fraction)))))
    chosen: list[int] = []
    if support_count > 0:
        chosen.extend(rng.choice(support, size=support_count, replace=False).astype(np.int64).tolist())
    needed = sample_count - len(chosen)
    chosen_set = set(chosen) | exclude_set
    while needed > 0:
        randoms = rng.integers(0, cell_count, size=max(needed * 2, needed + 64), dtype=np.int64)
        for value in randoms.tolist():
            if value in chosen_set:
                continue
            chosen.append(int(value))
            chosen_set.add(int(value))
            needed -= 1
            if needed == 0:
                break
    return np.array(chosen, dtype=np.int64)


def standardize(train_features: np.ndarray, *feature_sets: np.ndarray) -> tuple[np.ndarray, list[np.ndarray], dict[str, Any]]:
    mean = np.mean(train_features, axis=0, dtype=np.float64).astype(np.float32)
    std = np.std(train_features, axis=0, dtype=np.float64).astype(np.float32)
    std = np.where(std < np.float32(1.0e-6), np.float32(1.0), std)
    train = ((train_features - mean.reshape(1, -1)) / std.reshape(1, -1)).astype(np.float32)
    transformed = [((features - mean.reshape(1, -1)) / std.reshape(1, -1)).astype(np.float32) for features in feature_sets]
    return train, transformed, {
        "identity": "train-feature-standardization-v0",
        "featureCount": int(train_features.shape[1]),
        "zeroStdFeatureCount": int(np.count_nonzero(std == 1.0)),
        "mean": mean,
        "std": std,
    }


def train_mlp(
    train_features: np.ndarray,
    train_target_residual: np.ndarray,
    test_features: np.ndarray,
    args: argparse.Namespace,
    rng: np.random.Generator,
) -> tuple[np.ndarray, dict[str, Any], dict[str, Any]]:
    feature_count = train_features.shape[1]
    hidden_width = max(1, int(args.hidden_width))
    target_mean = np.mean(train_target_residual, axis=0, dtype=np.float64).astype(np.float32)
    target_std = np.std(train_target_residual, axis=0, dtype=np.float64).astype(np.float32)
    target_std = np.where(target_std < np.float32(1.0e-7), np.float32(1.0), target_std)
    y = ((train_target_residual - target_mean.reshape(1, 3)) / target_std.reshape(1, 3)).astype(np.float32)
    w1 = rng.normal(0.0, math.sqrt(2.0 / max(1, feature_count)), size=(feature_count, hidden_width)).astype(np.float32)
    b1 = np.zeros((1, hidden_width), dtype=np.float32)
    w2 = rng.normal(0.0, math.sqrt(2.0 / max(1, hidden_width)), size=(hidden_width, 3)).astype(np.float32)
    b2 = np.zeros((1, 3), dtype=np.float32)
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
            h1 = np.tanh(xb @ w1 + b1)
            out = h1 @ w2 + b2
            err = out - yb
            rows = max(1, xb.shape[0])
            total_loss += float(np.mean(err * err)) * rows
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
    residual = (np.tanh(test_features @ w1 + b1) @ w2 + b2) * target_std.reshape(1, 3) + target_mean.reshape(1, 3)
    state = {
        "w1": w1,
        "b1": b1,
        "w2": w2,
        "b2": b2,
        "targetMean": target_mean,
        "targetStd": target_std,
    }
    report = {
        "identity": MODEL_IDENTITY,
        "hiddenWidth": hidden_width,
        "epochs": epochs,
        "learningRate": float(args.learning_rate),
        "batchSize": batch_size,
        "weightDecay": float(args.weight_decay),
        "finalTrainStandardizedMse": final_loss,
    }
    return residual.astype(np.float32), report, state


def predict_mlp(features: np.ndarray, state: dict[str, Any]) -> np.ndarray:
    h1 = np.tanh(features @ state["w1"] + state["b1"])
    residual = (h1 @ state["w2"] + state["b2"]) * state["targetStd"].reshape(1, 3) + state["targetMean"].reshape(1, 3)
    return residual.astype(np.float32)


def metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, Any]:
    err = prediction.astype(np.float64) - truth.astype(np.float64)
    abs_err = np.abs(err)
    flat_p = prediction.reshape(-1).astype(np.float64)
    flat_t = truth.reshape(-1).astype(np.float64)
    corr = None
    if float(np.std(flat_p)) > 1.0e-12 and float(np.std(flat_t)) > 1.0e-12:
        corr = float(np.corrcoef(flat_p, flat_t)[0, 1])
    return {
        "mse": float(np.mean(err * err)),
        "rmse": float(math.sqrt(float(np.mean(err * err)))),
        "mae": float(np.mean(abs_err)),
        "maxAbs": float(np.max(abs_err)) if abs_err.size else 0.0,
        "correlation": corr,
    }


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


GLYPHS = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    " ": ["000", "000", "000", "000", "000", "000", "000"],
}


def draw_label(image: np.ndarray, label: str, x0: int, y0: int) -> None:
    x = x0
    for char in label.upper():
        glyph = GLYPHS.get(char, GLYPHS[" "])
        for yy, row in enumerate(glyph):
            for xx, bit in enumerate(row):
                if bit == "1":
                    image[y0 + yy:y0 + yy + 2, x + xx * 2:x + xx * 2 + 2] = 255
        x += len(glyph[0]) * 2 + 2


def write_png_rgb(path: Path, rgb: np.ndarray) -> None:
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    height, width, _ = rgb.shape
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(rgb[y].tobytes())
    png = b"\x89PNG\r\n\x1a\n"
    png += png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += png_chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def contact_sheet(path: Path, panels: list[tuple[str, np.ndarray]]) -> None:
    panel_h, panel_w = panels[0][1].shape[:2]
    label_h = 18
    gap = 4
    sheet = np.zeros((panel_h + label_h, panel_w * len(panels) + gap * (len(panels) - 1), 3), dtype=np.uint8)
    for i, (label, rgb) in enumerate(panels):
        x = i * (panel_w + gap)
        sheet[:label_h, x:x + panel_w] = 8
        draw_label(sheet, label, x + 4, 4)
        sheet[label_h:, x:x + panel_w] = np.clip(rgb * 255.0, 0, 255).astype(np.uint8)
    write_png_rgb(path, sheet)


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    manifest_out = out_dir / "manifest.json"
    try:
        phase = "manifest-read"
        application_manifest_path = Path(args.application_manifest)
        manifest, high_fluid, high_front, truth_info = load_truth_role(application_manifest_path, args.truth_role)
        high_grid = int(truth_info["grid"])
        factor = int(args.downsample_factor)
        if high_grid % factor != 0:
            raise ProbeFailure("downsample", "High grid is not divisible by downsample factor.", {
                "highGrid": high_grid,
                "downsampleFactor": factor,
            })
        low_grid = high_grid // factor

        phase = "downsample"
        low_fluid, low_front = block_average_high_to_low(high_fluid, high_front, high_grid, factor)
        rng = np.random.default_rng(int(args.seed))
        support, support_report = support_indexes(high_fluid, high_grid, rng, int(args.support_scan_samples))
        cells = high_grid ** 3
        train_indexes = mixed_sample_indexes(cells, int(args.train_samples), support, float(args.support_sample_fraction), rng)
        test_indexes = mixed_sample_indexes(cells, int(args.test_samples), support, float(args.support_sample_fraction), rng, exclude=train_indexes)

        phase = "feature-build"
        train_features, train_low_rgb, train_low_indexes = build_features(train_indexes, high_grid, low_grid, factor, low_fluid, low_front)
        test_features, test_low_rgb, test_low_indexes = build_features(test_indexes, high_grid, low_grid, factor, low_fluid, low_front)
        train_truth_rgb, train_target_diagnostics = _LABEL.derived_flow_debug_rgb(high_fluid, train_indexes, high_grid)
        test_truth_rgb, test_target_diagnostics = _LABEL.derived_flow_debug_rgb(high_fluid, test_indexes, high_grid)
        train_residual = train_truth_rgb - train_low_rgb

        phase = "model-train"
        train_features_std, [test_features_std], standardization = standardize(train_features, test_features)
        test_residual, model_report, model_state = train_mlp(train_features_std, train_residual, test_features_std, args, rng)
        test_prediction = np.clip(test_low_rgb + test_residual, 0.0, 1.0).astype(np.float32)

        phase = "preview"
        preview_y = int(args.preview_slice_y) if args.preview_slice_y is not None else high_grid // 2
        xs, zs = np.meshgrid(np.arange(high_grid, dtype=np.int64), np.arange(high_grid, dtype=np.int64), indexing="xy")
        slice_indexes = (xs.reshape(-1) + preview_y * high_grid + zs.reshape(-1) * high_grid * high_grid).astype(np.int64)
        slice_features, slice_low_rgb, _slice_low_indexes = build_features(slice_indexes, high_grid, low_grid, factor, low_fluid, low_front)
        slice_features_std = ((slice_features - standardization["mean"].reshape(1, -1)) / standardization["std"].reshape(1, -1)).astype(np.float32)
        slice_truth_rgb, _ = _LABEL.derived_flow_debug_rgb(high_fluid, slice_indexes, high_grid)
        slice_prediction = np.clip(slice_low_rgb + predict_mlp(slice_features_std, model_state), 0.0, 1.0).astype(np.float32)
        slice_error = np.clip(np.abs(slice_prediction - slice_truth_rgb) * 4.0, 0.0, 1.0).astype(np.float32)
        contact_path = out_dir / "phase-aligned-field-flow-contact.png"
        contact_sheet(contact_path, [
            ("TRUTH", slice_truth_rgb.reshape(high_grid, high_grid, 3)),
            ("BLOCK", slice_low_rgb.reshape(high_grid, high_grid, 3)),
            ("MLP", slice_prediction.reshape(high_grid, high_grid, 3)),
            ("ERROR", slice_error.reshape(high_grid, high_grid, 3)),
        ])

        phase = "report"
        payload = {
            "schema": SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": IDENTITY,
            "authority": "offline-phase-aligned-field-derived-diagnostic-probe-not-shell-render",
            "applicationManifest": str(application_manifest_path),
            "applicationManifestSha256": sha256_file(application_manifest_path),
            "sourceRole": args.truth_role,
            "sourceChecksums": {
                "fluid": truth_info["fluid"].get("sha256"),
                "front": truth_info["front"].get("sha256"),
            },
            "routeIdentity": manifest.get("routeIdentity"),
            "effectiveRoute": manifest.get("effectiveRoute"),
            "prototypeIdentity": manifest.get("prototypeIdentity"),
            "backend": manifest.get("backend"),
            "highGrid": high_grid,
            "lowGrid": low_grid,
            "downsampleFactor": factor,
            "downsampleOperatorIdentity": DOWNSAMPLE_OPERATOR_IDENTITY,
            "nativeLowRuntimeInput": False,
            "target": {
                "identity": TARGET_IDENTITY,
                "authority": TARGET_AUTHORITY,
                "channelOrder": TARGET_CHANNELS,
                "trainDiagnostics": train_target_diagnostics,
                "testDiagnostics": test_target_diagnostics,
            },
            "features": {
                "identity": FEATURE_IDENTITY,
                "featureCount": int(train_features.shape[1]),
                "sourceChannels": ALL_CHANNELS,
                "components": [
                    "lowFromHighBlockAverageChannels",
                    "squaredLowFromHighBlockAverageChannels",
                    "sixNeighborMeanDelta",
                    "sixNeighborMaxAbsDelta",
                    "blockAverageDerivedFlowRgb",
                    "highGridPositionFourier",
                ],
            },
            "sampling": {
                "seed": int(args.seed),
                "trainSamples": int(train_indexes.shape[0]),
                "testSamples": int(test_indexes.shape[0]),
                "supportSampleFraction": float(args.support_sample_fraction),
                "supportDiagnostics": support_report,
            },
            "models": {
                "blockAverageRgbBaseline": {
                    "identity": BASELINE_IDENTITY,
                    "heldOutPixelMetrics": metrics(test_low_rgb, test_truth_rgb),
                },
                "localNeighborhoodMlp": {
                    **model_report,
                    "heldOutPixelMetrics": metrics(test_prediction, test_truth_rgb),
                    "residualTarget": "truthHighDerivedFlowRgb - blockAverageDerivedFlowRgb",
                    "standardization": {
                        "identity": standardization["identity"],
                        "featureCount": standardization["featureCount"],
                        "zeroStdFeatureCount": standardization["zeroStdFeatureCount"],
                    },
                },
            },
            "preview": {
                "path": str(contact_path),
                "previewSliceY": preview_y,
                "visibleRasterLabels": ["TRUTH", "BLOCK", "MLP", "ERROR"],
            },
            "limitations": [
                "Phase-aligned low input is derived from truthHigh block averages; this does not prove native-low transfer.",
                "Target is derived flow diagnostic RGB, not shell render/radiance and not product beauty.",
                "Truth support is used only for training sample pressure and diagnostic sampling.",
            ],
        }
        write_json(manifest_out, payload)
        return 0
    except Exception as error:
        write_failure(manifest_out, locals().get("phase", "unknown"), error)
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
