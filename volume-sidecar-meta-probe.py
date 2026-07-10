#!/usr/bin/env python3
"""Probe learnability of phase-aligned v1 boundary sidecar/meta targets.

This is an offline model/probe harness. It consumes a phase-aligned corpus
manifest, trains small local operators from downsampled-high boundary/meta
inputs to high-resolution v1 boundary/meta targets, and separately reports
native-low transfer pressure. It does not launch the browser or claim renderer
closure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.sidecar-meta-probe.v0"
REPORT_IDENTITY = "phase-aligned-v1-sidecar-meta-learned-probe-v0"
CORPUS_SCHEMA = "kaminos.volume.phase-aligned-learned-probe-corpus.v0"
SIDECAR_IDENTITY = "baked-boundary-sidecar-v1"
SIDECAR_AUTHORITY = "band-limited-support-coverage-ridge-footprint-proximity-normal-v2"
CHANNEL_ORDER = ["support", "coverage", "ridge", "footprint", "proximity", "normalX", "normalY", "normalZ"]
SPARSE_STRUCTURAL_CHANNELS = ["support", "ridge", "proximity"]
ALL_TARGET_FAMILY_IDENTITY = "all-v1-sidecar-meta-target-family-v0"
SPARSE_STRUCTURAL_TARGET_FAMILY_IDENTITY = "sparse-structural-target-family-v0"
BLOCK_BASELINE_IDENTITY = "block-upsample-copy-baseline-v0"
RIDGE_IDENTITY = "local-linear-ridge-v0"
MLP_IDENTITY = "local-context-mlp-v0"
STANDARD_MLP_LOSS_IDENTITY = "standard-mlp-mse-v0"
SPARSE_POSITIVE_WEIGHTED_LOSS_IDENTITY = "sparse-positive-weighted-mse-v0"
FEATURE_IDENTITY = "low-grid-3d-local-context-plus-high-subcell-v0"
AUTHORITY = "offline-phase-aligned-sidecar-meta-probe-not-browser-witness-not-product-inference"
DEFAULT_THRESHOLD_SWEEP = [1.0e-5, 3.0e-5, 1.0e-4, 3.0e-4, 1.0e-3, 3.0e-3, 1.0e-2, 3.0e-2, 1.0e-1]


class ProbeFailure(Exception):
    def __init__(self, phase: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.details = details or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-manifest", required=True, help="Phase-aligned corpus manifest with v1 boundary/meta sidecars.")
    parser.add_argument("--out", required=True, help="Path to write the probe report JSON.")
    parser.add_argument("--train-samples", type=int, default=70_000, help="Training high-grid voxel samples.")
    parser.add_argument("--test-samples", type=int, default=45_000, help="Held-out high-grid voxel samples.")
    parser.add_argument(
        "--target-channel-list",
        default="all",
        help="Comma-separated target channels to train/predict, or 'all'. Inputs remain the full v1 sidecar/meta state.",
    )
    parser.add_argument("--support-sample-fraction", type=float, default=0.60, help="Fraction of samples drawn from truth support.")
    parser.add_argument(
        "--sparse-loss-mode",
        choices=["standard", "positive-weighted"],
        default="standard",
        help="MLP loss mode. positive-weighted upweights sparse structural positives without changing input channels.",
    )
    parser.add_argument("--sparse-positive-threshold", type=float, default=1.0e-3, help="Truth threshold used to identify sparse positives for weighted loss.")
    parser.add_argument("--sparse-positive-weight", type=float, default=6.0, help="Extra MSE weight for support/proximity positives in sparse-positive weighted loss.")
    parser.add_argument("--sparse-ridge-positive-weight", type=float, default=14.0, help="Extra MSE weight for ridge positives in sparse-positive weighted loss.")
    parser.add_argument(
        "--threshold-sweep",
        default=",".join(str(v) for v in DEFAULT_THRESHOLD_SWEEP),
        help="Comma-separated positive thresholds for support/ridge/proximity precision-recall-Jaccard calibration.",
    )
    parser.add_argument("--context-radius", type=int, default=1, help="Low-grid local context radius; 1 gives a 3x3x3 stencil.")
    parser.add_argument("--ridge", type=float, default=1.0e-3, help="Ridge regularization for local-linear-ridge-v0.")
    parser.add_argument("--hidden-width", type=int, default=64, help="Hidden width for local-context-mlp-v0.")
    parser.add_argument("--epochs", type=int, default=45, help="MLP training epochs.")
    parser.add_argument("--batch-size", type=int, default=2048, help="MLP minibatch size.")
    parser.add_argument("--learning-rate", type=float, default=2.0e-3, help="Adam learning rate.")
    parser.add_argument("--weight-decay", type=float, default=1.0e-5, help="MLP L2 weight decay.")
    parser.add_argument("--seed", type=int, default=17010, help="Deterministic sample/model seed.")
    return parser.parse_args()


def parse_target_channels(value: str) -> tuple[list[int], list[str], str]:
    raw = value.strip()
    if not raw or raw.lower() == "all":
        return list(range(len(CHANNEL_ORDER))), list(CHANNEL_ORDER), ALL_TARGET_FAMILY_IDENTITY
    names = [part.strip() for part in raw.split(",") if part.strip()]
    unknown = [name for name in names if name not in CHANNEL_ORDER]
    if unknown:
        raise ProbeFailure("args", "Unknown target channel in --target-channel-list.", {
            "unknownChannels": unknown,
            "availableChannels": CHANNEL_ORDER,
        })
    indexes = [CHANNEL_ORDER.index(name) for name in names]
    if names == SPARSE_STRUCTURAL_CHANNELS:
        family = SPARSE_STRUCTURAL_TARGET_FAMILY_IDENTITY
    else:
        family = "custom-sidecar-meta-target-family-v0"
    return indexes, names, family


def parse_threshold_sweep(value: str) -> list[float]:
    raw_parts = [part.strip() for part in value.split(",") if part.strip()]
    if not raw_parts:
        raise ProbeFailure("args", "--threshold-sweep must name at least one positive threshold.", {})
    thresholds: list[float] = []
    for raw in raw_parts:
        try:
            threshold = float(raw)
        except ValueError as err:
            raise ProbeFailure("args", "Invalid numeric threshold in --threshold-sweep.", {"threshold": raw}) from err
        if not math.isfinite(threshold) or threshold <= 0.0:
            raise ProbeFailure("args", "--threshold-sweep thresholds must be finite and positive.", {"threshold": raw})
        thresholds.append(threshold)
    return sorted(set(thresholds))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as err:
        raise ProbeFailure("manifest-read", f"Missing manifest {path}", {"path": str(path)}) from err
    except json.JSONDecodeError as err:
        raise ProbeFailure("manifest-read", f"Invalid JSON manifest {path}", {"path": str(path), "error": str(err)}) from err


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_path(raw_path: str, base_dir: Path) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = base_dir / path
    return path.resolve()


def verify_file_descriptor(desc: dict[str, Any], base_dir: Path, role: str) -> Path:
    raw = desc.get("path")
    if not raw:
        raise ProbeFailure("manifest-validate", f"{role} descriptor is missing path.", {"descriptor": desc})
    path = resolve_path(str(raw), base_dir)
    if not path.exists():
        raise ProbeFailure("sidecar-read", f"{role} file does not exist.", {"path": str(path)})
    expected_bytes = desc.get("byteLength")
    actual_bytes = path.stat().st_size
    if expected_bytes is not None and int(expected_bytes) != actual_bytes:
        raise ProbeFailure("sidecar-validate", f"{role} byte length mismatch.", {
            "path": str(path),
            "expectedByteLength": int(expected_bytes),
            "actualByteLength": actual_bytes,
        })
    expected_sha = desc.get("sha256")
    if expected_sha:
        actual_sha = sha256_file(path)
        if actual_sha != expected_sha:
            raise ProbeFailure("sidecar-validate", f"{role} checksum mismatch.", {
                "path": str(path),
                "expectedSha256": expected_sha,
                "actualSha256": actual_sha,
            })
    return path


def shape_cells(shape: list[int], role: str) -> tuple[int, int, int, int]:
    if len(shape) != 4:
        raise ProbeFailure("manifest-validate", f"{role} shape must be 4D.", {"shape": shape})
    z, y, x, c = (int(v) for v in shape)
    if z != y or y != x:
        raise ProbeFailure("manifest-validate", f"{role} grid must be cubic.", {"shape": shape})
    return z, y, x, c


def verify_channel_order(desc: dict[str, Any], role: str) -> None:
    order = desc.get("channelOrder")
    if order != CHANNEL_ORDER:
        raise ProbeFailure("manifest-validate", f"{role} channel order mismatch.", {
            "channelOrder": order,
            "expectedChannelOrder": CHANNEL_ORDER,
        })


def load_combined_sidecar(desc: dict[str, Any], base_dir: Path, role: str) -> np.memmap:
    verify_channel_order(desc, role)
    z, _, _, c = shape_cells(desc.get("shape") or [], role)
    if c != len(CHANNEL_ORDER):
        raise ProbeFailure("manifest-validate", f"{role} channel count mismatch.", {"shape": desc.get("shape")})
    path = verify_file_descriptor(desc, base_dir, role)
    return np.memmap(path, dtype="<f4", mode="r", shape=(z ** 3, c))


def load_split_sidecar(manifest_path: Path, role: str) -> tuple[np.memmap, np.memmap, dict[str, Any]]:
    manifest = read_json(manifest_path)
    boundary = manifest.get("boundarySidecar")
    if not boundary:
        raise ProbeFailure("manifest-validate", f"{role} manifest has no boundarySidecar block.", {"path": str(manifest_path)})
    if boundary.get("identity") != SIDECAR_IDENTITY:
        raise ProbeFailure("manifest-validate", f"{role} sidecar identity mismatch.", {
            "identity": boundary.get("identity"),
            "expectedIdentity": SIDECAR_IDENTITY,
        })
    if boundary.get("channelOrder") != CHANNEL_ORDER:
        raise ProbeFailure("manifest-validate", f"{role} v1 channel order mismatch.", {
            "channelOrder": boundary.get("channelOrder"),
            "expectedChannelOrder": CHANNEL_ORDER,
        })
    sidecars = boundary.get("sidecars") or {}
    side_desc = sidecars.get("boundary")
    meta_desc = sidecars.get("meta")
    if not side_desc or not meta_desc:
        raise ProbeFailure("manifest-validate", f"{role} split sidecar/meta descriptors are missing.", {"path": str(manifest_path)})
    base_dir = manifest_path.parent
    side_path = verify_file_descriptor(side_desc, base_dir, f"{role}.boundary")
    meta_path = verify_file_descriptor(meta_desc, base_dir, f"{role}.meta")
    side_shape = side_desc.get("shape") or []
    meta_shape = meta_desc.get("shape") or []
    side_grid, _, _, side_c = shape_cells(side_shape, f"{role}.boundary")
    meta_grid, _, _, meta_c = shape_cells(meta_shape, f"{role}.meta")
    if side_grid != meta_grid or side_c != 4 or meta_c != 4:
        raise ProbeFailure("manifest-validate", f"{role} split sidecar/meta shape mismatch.", {
            "boundaryShape": side_shape,
            "metaShape": meta_shape,
        })
    if side_desc.get("channelOrder") != CHANNEL_ORDER[:4] or meta_desc.get("channelOrder") != CHANNEL_ORDER[4:]:
        raise ProbeFailure("manifest-validate", f"{role} split channel order mismatch.", {
            "boundaryChannelOrder": side_desc.get("channelOrder"),
            "metaChannelOrder": meta_desc.get("channelOrder"),
        })
    return (
        np.memmap(side_path, dtype="<f4", mode="r", shape=(side_grid ** 3, 4)),
        np.memmap(meta_path, dtype="<f4", mode="r", shape=(side_grid ** 3, 4)),
        {
            "manifest": str(manifest_path),
            "grid": side_grid,
            "identity": boundary.get("identity"),
            "authority": boundary.get("authority"),
            "boundarySha256": side_desc.get("sha256"),
            "metaSha256": meta_desc.get("sha256"),
        },
    )


def high_values(side: np.ndarray, meta: np.ndarray, indexes: np.ndarray) -> np.ndarray:
    return np.concatenate([np.asarray(side[indexes], dtype=np.float32), np.asarray(meta[indexes], dtype=np.float32)], axis=1)


def low_block_values(low: np.ndarray, high_indexes: np.ndarray, high_grid: int, low_grid: int) -> np.ndarray:
    factor = high_grid // low_grid
    z, y, x = np.unravel_index(high_indexes.astype(np.int64), (high_grid, high_grid, high_grid))
    low_lin = ((z // factor) * low_grid + (y // factor)) * low_grid + (x // factor)
    return np.asarray(low[low_lin], dtype=np.float32)


def local_features(low: np.ndarray, high_indexes: np.ndarray, high_grid: int, low_grid: int, radius: int) -> np.ndarray:
    factor = high_grid // low_grid
    z, y, x = np.unravel_index(high_indexes.astype(np.int64), (high_grid, high_grid, high_grid))
    lz = z // factor
    ly = y // factor
    lx = x // factor
    chunks = []
    for dz in range(-radius, radius + 1):
        zz = np.clip(lz + dz, 0, low_grid - 1)
        for dy in range(-radius, radius + 1):
            yy = np.clip(ly + dy, 0, low_grid - 1)
            for dx in range(-radius, radius + 1):
                xx = np.clip(lx + dx, 0, low_grid - 1)
                lin = (zz * low_grid + yy) * low_grid + xx
                chunks.append(np.asarray(low[lin], dtype=np.float32))
    subcell = np.stack([
        (x % factor).astype(np.float32) / max(1, factor - 1),
        (y % factor).astype(np.float32) / max(1, factor - 1),
        (z % factor).astype(np.float32) / max(1, factor - 1),
    ], axis=1)
    return np.concatenate([*chunks, subcell], axis=1).astype(np.float32)


def mixed_sample_indexes(
    high_grid: int,
    count: int,
    support_indexes: np.ndarray,
    support_fraction: float,
    rng: np.random.Generator,
    exclude: np.ndarray | None = None,
) -> np.ndarray:
    high_cells = high_grid ** 3
    count = min(max(1, int(count)), high_cells)
    exclude_mask = np.zeros(high_cells, dtype=bool)
    if exclude is not None and exclude.size:
        exclude_mask[exclude.astype(np.int64)] = True
    available_support = support_indexes[~exclude_mask[support_indexes]]
    support_target = min(available_support.size, int(count * max(0.0, min(1.0, float(support_fraction)))))
    chosen_parts = []
    if support_target:
        chosen_parts.append(rng.choice(available_support, size=support_target, replace=False).astype(np.int64))
    chosen_count = sum(part.size for part in chosen_parts)
    needed = count - chosen_count
    if needed > 0:
        random_pool_count = min(high_cells, max(needed * 3, needed + 1024))
        pool = rng.integers(0, high_cells, size=random_pool_count, dtype=np.int64)
        if chosen_parts:
            exclude_mask[np.concatenate(chosen_parts)] = True
        pool = pool[~exclude_mask[pool]]
        pool = np.unique(pool)
        while pool.size < needed:
            extra = rng.integers(0, high_cells, size=needed * 2, dtype=np.int64)
            extra = extra[~exclude_mask[extra]]
            pool = np.unique(np.concatenate([pool, extra]))
        chosen_parts.append(pool[:needed])
    out = np.concatenate(chosen_parts)
    rng.shuffle(out)
    return out.astype(np.int64)


def standardize(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = x.mean(axis=0, keepdims=True).astype(np.float32)
    std = x.std(axis=0, keepdims=True).astype(np.float32)
    std = np.where(std < 1.0e-6, 1.0, std).astype(np.float32)
    return ((x - mean) / std).astype(np.float32), mean, std


def apply_standardize(x: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return ((x - mean) / std).astype(np.float32)


def fit_ridge(x: np.ndarray, y: np.ndarray, ridge: float) -> dict[str, np.ndarray]:
    xb = np.concatenate([x, np.ones((x.shape[0], 1), dtype=np.float32)], axis=1)
    gram = xb.T @ xb
    penalty = np.eye(gram.shape[0], dtype=np.float32) * float(ridge)
    penalty[-1, -1] = 0.0
    weights = np.linalg.solve(gram + penalty, xb.T @ y).astype(np.float32)
    return {"weights": weights}


def predict_ridge(model: dict[str, np.ndarray], x: np.ndarray) -> np.ndarray:
    xb = np.concatenate([x, np.ones((x.shape[0], 1), dtype=np.float32)], axis=1)
    return (xb @ model["weights"]).astype(np.float32)


def sparse_loss_weights(
    y_raw: np.ndarray,
    channel_names: list[str],
    mode: str,
    positive_threshold: float,
    positive_weight: float,
    ridge_positive_weight: float,
) -> np.ndarray | None:
    if mode == "standard":
        return None
    if mode != "positive-weighted":
        raise ProbeFailure("args", "Unknown sparse loss mode.", {"sparseLossMode": mode})
    weights = np.ones_like(y_raw, dtype=np.float32)
    threshold = float(positive_threshold)
    if not math.isfinite(threshold) or threshold <= 0.0:
        raise ProbeFailure("args", "--sparse-positive-threshold must be finite and positive.", {"threshold": positive_threshold})
    for channel_index, name in enumerate(channel_names):
        if name not in SPARSE_STRUCTURAL_CHANNELS:
            continue
        extra_weight = float(ridge_positive_weight if name == "ridge" else positive_weight)
        if not math.isfinite(extra_weight) or extra_weight < 0.0:
            raise ProbeFailure("args", "Sparse positive weights must be finite and non-negative.", {
                "sparsePositiveWeight": positive_weight,
                "sparseRidgePositiveWeight": ridge_positive_weight,
            })
        positives = (np.abs(y_raw[:, channel_index]) > threshold).astype(np.float32)
        weights[:, channel_index] += positives * extra_weight
    return weights


def train_mlp(
    x: np.ndarray,
    y: np.ndarray,
    hidden_width: int,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    weight_decay: float,
    rng: np.random.Generator,
    sample_weights: np.ndarray | None = None,
) -> tuple[dict[str, np.ndarray], list[dict[str, float]]]:
    in_dim = x.shape[1]
    out_dim = y.shape[1]
    w1 = (rng.normal(0.0, math.sqrt(2.0 / max(1, in_dim)), size=(in_dim, hidden_width))).astype(np.float32)
    b1 = np.zeros((hidden_width,), dtype=np.float32)
    w2 = (rng.normal(0.0, math.sqrt(2.0 / max(1, hidden_width)), size=(hidden_width, out_dim))).astype(np.float32)
    b2 = np.zeros((out_dim,), dtype=np.float32)
    params = [w1, b1, w2, b2]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    history = []
    step = 0
    n = x.shape[0]
    batch_size = max(1, min(int(batch_size), n))
    for epoch in range(int(epochs)):
        order = rng.permutation(n)
        losses = []
        for start in range(0, n, batch_size):
            step += 1
            idx = order[start:start + batch_size]
            xb = x[idx]
            yb = y[idx]
            wb = sample_weights[idx] if sample_weights is not None else None
            h_pre = xb @ w1 + b1
            h = np.tanh(h_pre)
            pred = h @ w2 + b2
            err = pred - yb
            if wb is None:
                loss = float(np.mean(err ** 2))
                grad_pred = (2.0 / max(1, err.size)) * err
            else:
                denom = max(1.0, float(np.sum(wb)))
                loss = float(np.sum(wb * err * err) / denom)
                grad_pred = (2.0 / denom) * wb * err
            losses.append(loss)
            gw2 = h.T @ grad_pred + weight_decay * w2
            gb2 = grad_pred.sum(axis=0)
            gh = grad_pred @ w2.T
            gh_pre = gh * (1.0 - h ** 2)
            gw1 = xb.T @ gh_pre + weight_decay * w1
            gb1 = gh_pre.sum(axis=0)
            grads = [gw1.astype(np.float32), gb1.astype(np.float32), gw2.astype(np.float32), gb2.astype(np.float32)]
            for i, (param, grad) in enumerate(zip(params, grads)):
                m[i] = 0.9 * m[i] + 0.1 * grad
                v[i] = 0.999 * v[i] + 0.001 * (grad * grad)
                m_hat = m[i] / (1.0 - 0.9 ** step)
                v_hat = v[i] / (1.0 - 0.999 ** step)
                param -= learning_rate * m_hat / (np.sqrt(v_hat) + 1.0e-8)
        if epoch == 0 or epoch == epochs - 1 or (epoch + 1) % max(1, epochs // 5) == 0:
            history.append({"epoch": epoch + 1, "trainMse": float(np.mean(losses))})
    return {"w1": w1, "b1": b1, "w2": w2, "b2": b2}, history


def predict_mlp(model: dict[str, np.ndarray], x: np.ndarray) -> np.ndarray:
    return (np.tanh(x @ model["w1"] + model["b1"]) @ model["w2"] + model["b2"]).astype(np.float32)


def channel_metrics(pred: np.ndarray, truth: np.ndarray, channel_names: list[str]) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for i, name in enumerate(channel_names):
        err = np.asarray(pred[:, i] - truth[:, i], dtype=np.float64)
        t = np.asarray(truth[:, i], dtype=np.float64)
        p = np.asarray(pred[:, i], dtype=np.float64)
        t_std = float(t.std())
        p_std = float(p.std())
        corr = 0.0
        if t_std > 1.0e-12 and p_std > 1.0e-12:
            corr = float(np.corrcoef(t, p)[0, 1])
        result[name] = {
            "rmse": float(math.sqrt(float(np.mean(err ** 2)))),
            "mae": float(np.mean(np.abs(err))),
            "maxAbs": float(np.max(np.abs(err))) if err.size else 0.0,
            "corr": corr,
            "truthMean": float(t.mean()) if t.size else 0.0,
            "predMean": float(p.mean()) if p.size else 0.0,
            "truthNonzero1e4": int(np.count_nonzero(np.abs(t) > 1.0e-4)),
            "predNonzero1e4": int(np.count_nonzero(np.abs(p) > 1.0e-4)),
        }
    return result


def global_metrics(per_channel: dict[str, dict[str, float]]) -> dict[str, float]:
    rmses = [v["rmse"] for v in per_channel.values()]
    maes = [v["mae"] for v in per_channel.values()]
    return {
        "meanChannelRmse": float(np.mean(rmses)),
        "meanChannelMae": float(np.mean(maes)),
        "maxChannelRmse": float(np.max(rmses)),
    }


def support_metrics(pred: np.ndarray, truth: np.ndarray, channel_names: list[str], channel_name: str, threshold: float) -> dict[str, float]:
    idx = channel_names.index(channel_name)
    p = np.abs(pred[:, idx]) > threshold
    t = np.abs(truth[:, idx]) > threshold
    tp = int(np.count_nonzero(p & t))
    fp = int(np.count_nonzero(p & ~t))
    fn = int(np.count_nonzero(~p & t))
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    return {
        "channel": channel_name,
        "threshold": threshold,
        "precision": float(precision),
        "recall": float(recall),
        "jaccard": float(tp / max(1, tp + fp + fn)),
        "predictedCount": int(np.count_nonzero(p)),
        "truthCount": int(np.count_nonzero(t)),
    }


def threshold_sweep(
    pred: np.ndarray,
    truth: np.ndarray,
    channel_names: list[str],
    thresholds: list[float],
) -> dict[str, dict[str, Any]]:
    sweep: dict[str, dict[str, Any]] = {}
    for name in SPARSE_STRUCTURAL_CHANNELS:
        if name not in channel_names:
            continue
        rows = [support_metrics(pred, truth, channel_names, name, threshold) for threshold in thresholds]
        best = max(rows, key=lambda row: row["jaccard"])
        sweep[name] = {
            "thresholds": rows,
            "bestJaccardThreshold": float(best["threshold"]),
            "bestJaccard": float(best["jaccard"]),
            "bestPrecision": float(best["precision"]),
            "bestRecall": float(best["recall"]),
            "bestPredictedCount": int(best["predictedCount"]),
            "truthCountAtBestThreshold": int(best["truthCount"]),
        }
    return sweep


def percent_reduction(baseline: float, value: float) -> float:
    if not math.isfinite(baseline) or abs(baseline) < 1.0e-12:
        return 0.0
    return float((baseline - value) / baseline * 100.0)


def verdicts(
    block: dict[str, dict[str, float]],
    ridge: dict[str, dict[str, float]],
    mlp: dict[str, dict[str, float]],
    native_mlp: dict[str, dict[str, float]],
    channel_names: list[str],
) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for name in channel_names:
        block_rmse = block[name]["rmse"]
        ridge_rmse = ridge[name]["rmse"]
        mlp_rmse = mlp[name]["rmse"]
        native_rmse = native_mlp[name]["rmse"]
        mlp_vs_block = percent_reduction(block_rmse, mlp_rmse)
        mlp_vs_ridge = percent_reduction(ridge_rmse, mlp_rmse)
        if mlp_vs_block >= 10.0 and mlp_vs_ridge >= 1.0:
            teacher = "strong-positive"
        elif mlp_vs_block >= 3.0:
            teacher = "useful-positive"
        elif percent_reduction(block_rmse, ridge_rmse) >= 3.0:
            teacher = "linear-positive"
        else:
            teacher = "not-yet-positive"
        transfer_ratio = native_rmse / max(1.0e-12, mlp_rmse)
        if transfer_ratio >= 1.75:
            transfer = "native-low-high-risk"
        elif transfer_ratio >= 1.25:
            transfer = "native-low-degraded"
        else:
            transfer = "native-low-not-catastrophic-on-this-sample"
        out[name] = {
            "teacherLearnability": teacher,
            "mlpReductionVsBlockPct": mlp_vs_block,
            "mlpReductionVsRidgePct": mlp_vs_ridge,
            "nativeLowTransfer": transfer,
            "nativeLowRmseRatioVsPhaseAlignedMlp": float(transfer_ratio),
        }
    return out


def write_failure(path: Path, error: Exception, phase: str = "unknown", evidence: dict[str, Any] | None = None) -> None:
    payload = {
        "schema": REPORT_SCHEMA,
        "identity": REPORT_IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    }
    if isinstance(error, ProbeFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.details
    write_json(path, payload)


def main() -> int:
    args = parse_args()
    out_path = Path(args.out)
    evidence: dict[str, Any] = {"corpusManifest": args.corpus_manifest}
    try:
        target_indexes, selected_target_channels, target_family = parse_target_channels(args.target_channel_list)
        target_indexes_np = np.asarray(target_indexes, dtype=np.int64)
        thresholds = parse_threshold_sweep(args.threshold_sweep)
        loss_identity = (
            SPARSE_POSITIVE_WEIGHTED_LOSS_IDENTITY
            if args.sparse_loss_mode == "positive-weighted"
            else STANDARD_MLP_LOSS_IDENTITY
        )
        corpus_path = Path(args.corpus_manifest).resolve()
        corpus = read_json(corpus_path)
        if corpus.get("schema") != CORPUS_SCHEMA or corpus.get("status") != "captured":
            raise ProbeFailure("manifest-validate", "Corpus manifest schema/status mismatch.", {
                "schema": corpus.get("schema"),
                "status": corpus.get("status"),
                "expectedSchema": CORPUS_SCHEMA,
            })
        target_mapping = corpus.get("boundarySidecarTargets") or {}
        if target_mapping.get("sidecarIdentity") != SIDECAR_IDENTITY or target_mapping.get("channelOrder") != CHANNEL_ORDER:
            raise ProbeFailure("manifest-validate", "Corpus does not expose baked-boundary-sidecar-v1 target order.", {
                "sidecarIdentity": target_mapping.get("sidecarIdentity"),
                "channelOrder": target_mapping.get("channelOrder"),
            })
        base_dir = corpus_path.parent
        low_desc = (((corpus.get("downsampledHighInput") or {}).get("sidecars") or {}).get("boundary"))
        if not low_desc:
            raise ProbeFailure("manifest-validate", "Corpus is missing downsampled-high boundary input sidecar.", {})
        low = load_combined_sidecar(low_desc, base_dir, "downsampledHighInput.boundary")
        low_grid = int(low_desc["shape"][0])
        high_ref = ((corpus.get("truthHighTarget") or {}).get("boundarySidecar") or {})
        high_manifest = high_ref.get("manifest")
        if not high_manifest:
            raise ProbeFailure("manifest-validate", "Corpus truthHighTarget.boundarySidecar is missing source manifest.", {})
        high_side, high_meta, high_source = load_split_sidecar(resolve_path(str(high_manifest), base_dir), "truthHighTarget")
        high_grid = int(high_source["grid"])
        if high_grid % low_grid != 0:
            raise ProbeFailure("manifest-validate", "High grid must be an integer multiple of low grid for this probe.", {
                "highGrid": high_grid,
                "lowGrid": low_grid,
                "neededHook": "recorded-footprint-resampling-probe-v0",
            })
        native_manifest = (((corpus.get("nativeLowDomainGap") or {}).get("boundarySidecar") or {}).get("nativeLowManifest")
                           or (corpus.get("nativeLowDomainGap") or {}).get("nativeLowManifest"))
        native_low = None
        native_source = None
        if native_manifest:
            native_side, native_meta, native_source = load_split_sidecar(resolve_path(str(native_manifest), base_dir), "nativeLowTransfer")
            native_low_array = np.empty((low_grid ** 3, len(CHANNEL_ORDER)), dtype=np.float32)
            native_low_array[:, :4] = native_side
            native_low_array[:, 4:] = native_meta
            native_low = native_low_array
        evidence.update({
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "channelOrder": CHANNEL_ORDER,
            "selectedTargetChannels": selected_target_channels,
            "targetFamily": target_family,
            "highSource": high_source,
            "nativeLowSource": native_source,
        })
        support_channel = np.asarray(high_side[:, 0], dtype=np.float32)
        support_indexes = np.flatnonzero(support_channel > 1.0e-4).astype(np.int64)
        rng = np.random.default_rng(int(args.seed))
        train_idx = mixed_sample_indexes(high_grid, args.train_samples, support_indexes, args.support_sample_fraction, rng)
        test_idx = mixed_sample_indexes(high_grid, args.test_samples, support_indexes, args.support_sample_fraction, rng, exclude=train_idx)
        x_train_raw = local_features(low, train_idx, high_grid, low_grid, int(args.context_radius))
        y_train_full = high_values(high_side, high_meta, train_idx)
        y_train_raw = y_train_full[:, target_indexes_np]
        x_test_raw = local_features(low, test_idx, high_grid, low_grid, int(args.context_radius))
        y_test_full = high_values(high_side, high_meta, test_idx)
        y_test_raw = y_test_full[:, target_indexes_np]
        x_train, x_mean, x_std = standardize(x_train_raw)
        y_train, y_mean, y_std = standardize(y_train_raw)
        mlp_sample_weights = sparse_loss_weights(
            y_train_raw,
            selected_target_channels,
            str(args.sparse_loss_mode),
            float(args.sparse_positive_threshold),
            float(args.sparse_positive_weight),
            float(args.sparse_ridge_positive_weight),
        )
        x_test = apply_standardize(x_test_raw, x_mean, x_std)
        block_test = low_block_values(low, test_idx, high_grid, low_grid)[:, target_indexes_np]
        ridge_model = fit_ridge(x_train, y_train, float(args.ridge))
        ridge_pred = predict_ridge(ridge_model, x_test) * y_std + y_mean
        mlp_model, history = train_mlp(
            x_train,
            y_train,
            int(args.hidden_width),
            int(args.epochs),
            int(args.batch_size),
            float(args.learning_rate),
            float(args.weight_decay),
            rng,
            mlp_sample_weights,
        )
        mlp_pred = predict_mlp(mlp_model, x_test) * y_std + y_mean
        native_block_metrics = None
        native_ridge_metrics = None
        native_mlp_metrics = None
        if native_low is not None:
            native_x_raw = local_features(native_low, test_idx, high_grid, low_grid, int(args.context_radius))
            native_x = apply_standardize(native_x_raw, x_mean, x_std)
            native_block = low_block_values(native_low, test_idx, high_grid, low_grid)[:, target_indexes_np]
            native_ridge = predict_ridge(ridge_model, native_x) * y_std + y_mean
            native_mlp = predict_mlp(mlp_model, native_x) * y_std + y_mean
            native_block_metrics = channel_metrics(native_block, y_test_raw, selected_target_channels)
            native_ridge_metrics = channel_metrics(native_ridge, y_test_raw, selected_target_channels)
            native_mlp_metrics = channel_metrics(native_mlp, y_test_raw, selected_target_channels)
        block_metrics = channel_metrics(block_test, y_test_raw, selected_target_channels)
        ridge_metrics = channel_metrics(ridge_pred, y_test_raw, selected_target_channels)
        mlp_metrics = channel_metrics(mlp_pred, y_test_raw, selected_target_channels)
        mlp_threshold_sweep = threshold_sweep(mlp_pred, y_test_raw, selected_target_channels, thresholds)
        native_mlp_threshold_sweep = None
        if native_mlp_metrics is None:
            native_mlp_metrics = mlp_metrics
        elif native_low is not None:
            native_mlp_threshold_sweep = threshold_sweep(native_mlp, y_test_raw, selected_target_channels, thresholds)
        report = {
            "schema": REPORT_SCHEMA,
            "identity": REPORT_IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "capturedAt": now_iso(),
            "authority": AUTHORITY,
            "corpus": {
                "manifest": str(corpus_path),
                "schema": corpus.get("schema"),
                "identity": corpus.get("identity"),
                "sourceNote": corpus.get("sourceNote"),
                "route": corpus.get("route"),
            },
            "target": {
                "sidecarIdentity": SIDECAR_IDENTITY,
                "sidecarAuthority": SIDECAR_AUTHORITY,
                "channelOrder": CHANNEL_ORDER,
                "selectedTargetChannels": selected_target_channels,
                "targetFamily": target_family,
                "targetFamilyMeaning": "Sparse structural specialization narrows outputs/loss only; input features still include the full v1 sidecar/meta state.",
                "lowGrid": low_grid,
                "highGrid": high_grid,
                "reduction": high_grid // low_grid,
            },
            "sampling": {
                "seed": int(args.seed),
                "trainSamples": int(train_idx.size),
                "testSamples": int(test_idx.size),
                "supportSampleFraction": float(args.support_sample_fraction),
                "truthSupportAvailable": int(support_indexes.size),
                "thresholdSweep": thresholds,
            },
            "features": {
                "identity": FEATURE_IDENTITY,
                "contextRadius": int(args.context_radius),
                "featureCount": int(x_train.shape[1]),
                "includesHighSubcellCoordinates": True,
                "includesAbsoluteCoordinates": False,
            },
            "models": {
                "block": {
                    "identity": BLOCK_BASELINE_IDENTITY,
                    "description": "Copy each 64-grid boundary/meta value to its corresponding 2x2x2 high-grid block.",
                    "selectedTargetChannels": selected_target_channels,
                },
                "ridge": {
                    "identity": RIDGE_IDENTITY,
                    "ridge": float(args.ridge),
                    "inputFeatureCount": int(x_train.shape[1]),
                    "outputChannels": selected_target_channels,
                },
                "mlp": {
                    "identity": MLP_IDENTITY,
                    "loss": {
                        "identity": loss_identity,
                        "mode": str(args.sparse_loss_mode),
                        "sparsePositiveThreshold": float(args.sparse_positive_threshold),
                        "sparsePositiveWeight": float(args.sparse_positive_weight),
                        "sparseRidgePositiveWeight": float(args.sparse_ridge_positive_weight),
                        "meaning": "Weighted mode changes MLP loss pressure for sparse structural positive targets only; inputs and selected output channels are reported separately.",
                    },
                    "hiddenWidth": int(args.hidden_width),
                    "epochs": int(args.epochs),
                    "batchSize": int(args.batch_size),
                    "learningRate": float(args.learning_rate),
                    "weightDecay": float(args.weight_decay),
                    "trainingHistory": history,
                    "inputFeatureCount": int(x_train.shape[1]),
                    "outputChannels": selected_target_channels,
                },
            },
            "phaseAlignedTeacher": {
                "blockUpsampleCopyBaseline": {
                    "identity": BLOCK_BASELINE_IDENTITY,
                    "perChannel": block_metrics,
                    "global": global_metrics(block_metrics),
                },
                "localLinearRidge": {
                    "identity": RIDGE_IDENTITY,
                    "perChannel": ridge_metrics,
                    "global": global_metrics(ridge_metrics),
                },
                "localContextMlp": {
                    "identity": MLP_IDENTITY,
                    "perChannel": mlp_metrics,
                    "global": global_metrics(mlp_metrics),
                    "supportDiagnostics": [
                        support_metrics(mlp_pred, y_test_raw, selected_target_channels, name, 1.0e-3)
                        for name in SPARSE_STRUCTURAL_CHANNELS
                        if name in selected_target_channels
                    ],
                    "thresholdSweep": mlp_threshold_sweep,
                },
            },
            "nativeLowTransfer": {
                "status": "computed" if native_block_metrics is not None else "not-requested",
                "authority": "native-low-input-through-phase-aligned-trained-probes-compared-to-same-high-target",
                "limitation": "Native-low transfer compares a separate low-resolution sim/export to the phase-aligned high target; failure here is transfer/domain-gap pressure, not teacher learnability failure.",
                "source": native_source,
                "blockUpsampleCopyBaseline": {
                    "identity": BLOCK_BASELINE_IDENTITY,
                    "perChannel": native_block_metrics,
                    "global": global_metrics(native_block_metrics) if native_block_metrics else None,
                } if native_block_metrics else None,
                "localLinearRidge": {
                    "identity": RIDGE_IDENTITY,
                    "perChannel": native_ridge_metrics,
                    "global": global_metrics(native_ridge_metrics) if native_ridge_metrics else None,
                } if native_ridge_metrics else None,
                "localContextMlp": {
                    "identity": MLP_IDENTITY,
                    "perChannel": native_mlp_metrics,
                    "global": global_metrics(native_mlp_metrics),
                    "thresholdSweep": native_mlp_threshold_sweep,
                } if native_mlp_metrics else None,
            },
            "perChannelVerdicts": verdicts(block_metrics, ridge_metrics, mlp_metrics, native_mlp_metrics, selected_target_channels),
            "nonGoals": [
                "not a browser/WebGPU export witness",
                "not a live renderer integration proof",
                "not native-low deployment closure",
                "not a public benchmark or product claim",
            ],
        }
        write_json(out_path, report)
        return 0
    except Exception as err:
        write_failure(out_path, err, evidence=evidence)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
