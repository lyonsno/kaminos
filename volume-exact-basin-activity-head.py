#!/usr/bin/env python3
"""Train and pack a phase-aligned high-flow activity residual head for WebGPU."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.exact-basin-activity-head.v0"
IDENTITY = "exact-basin-derived-flow-activity-head-160-to-96-v0"
TARGET_IDENTITY = "derived-flow-debug-rgb-norm-activity-v0"
PAIR_AUTHORITY = "downsampled-same-high-history-input-to-exact-high-target"
TRAINING_INPUT_AUTHORITY = "phase-aligned-high-filtered-to-low-grid-v0"

_PROBE_PATH = Path(__file__).with_name("volume-exact-basin-support-probe.py")
_PROBE_SPEC = importlib.util.spec_from_file_location("volume_exact_basin_support_probe", _PROBE_PATH)
if _PROBE_SPEC is None or _PROBE_SPEC.loader is None:
    raise RuntimeError(f"unable to load {_PROBE_PATH}")
_PROBE = importlib.util.module_from_spec(_PROBE_SPEC)
_PROBE_SPEC.loader.exec_module(_PROBE)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def smoothstep(edge0: float, edge1: float, values: np.ndarray) -> np.ndarray:
    t = np.clip((values.astype(np.float32) - np.float32(edge0)) / np.float32(edge1 - edge0), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32, copy=False)


def gather_velocity(fluid: np.ndarray, x: np.ndarray, y: np.ndarray, z: np.ndarray, grid: int) -> np.ndarray:
    cx = np.clip(x, 0, grid - 1).astype(np.int64, copy=False)
    cy = np.clip(y, 0, grid - 1).astype(np.int64, copy=False)
    cz = np.clip(z, 0, grid - 1).astype(np.int64, copy=False)
    indexes = cx + cy * grid + cz * grid * grid
    return np.asarray(fluid[indexes, 0:3], dtype=np.float32)


def diagnostic_rgb_norm(fluid: np.ndarray, indexes: np.ndarray, grid: int) -> np.ndarray:
    x = (indexes % grid).astype(np.int64, copy=False)
    y = ((indexes // grid) % grid).astype(np.int64, copy=False)
    z = (indexes // (grid * grid)).astype(np.int64, copy=False)
    vx0 = gather_velocity(fluid, x - 1, y, z, grid)
    vx1 = gather_velocity(fluid, x + 1, y, z, grid)
    vy0 = gather_velocity(fluid, x, y - 1, z, grid)
    vy1 = gather_velocity(fluid, x, y + 1, z, grid)
    vz0 = gather_velocity(fluid, x, y, z - 1, grid)
    vz1 = gather_velocity(fluid, x, y, z + 1, grid)
    curl_x = ((vy1[:, 2] - vy0[:, 2]) - (vz1[:, 1] - vz0[:, 1])) * np.float32(0.5)
    curl_y = ((vz1[:, 0] - vz0[:, 0]) - (vx1[:, 2] - vx0[:, 2])) * np.float32(0.5)
    curl_z = ((vx1[:, 1] - vx0[:, 1]) - (vy1[:, 0] - vy0[:, 0])) * np.float32(0.5)
    curlMagnitude = np.sqrt(curl_x * curl_x + curl_y * curl_y + curl_z * curl_z).astype(np.float32)
    divergenceAbs = np.abs(
        ((vx1[:, 0] - vx0[:, 0]) + (vy1[:, 1] - vy0[:, 1]) + (vz1[:, 2] - vz0[:, 2]))
        * np.float32(0.5)
    ).astype(np.float32)
    overlay = smoothstep(0.015, 0.12, curlMagnitude + divergenceAbs)
    mix = smoothstep(0.010, 0.085, divergenceAbs)
    cyan = np.array([0.08, 0.72, 0.95], dtype=np.float32)
    red = np.array([1.0, 0.18, 0.08], dtype=np.float32)
    color = cyan.reshape(1, 3) * (1.0 - mix.reshape(-1, 1)) + red.reshape(1, 3) * mix.reshape(-1, 1)
    color *= (np.float32(0.35) + smoothstep(0.012, 0.18, curlMagnitude)).reshape(-1, 1)
    diagnosticRgbNorm = np.linalg.norm(color * overlay.reshape(-1, 1), axis=1).astype(np.float32)
    return np.clip(diagnosticRgbNorm, 0.0, 1.0).astype(np.float32, copy=False)


def activity_volume(fluid: np.ndarray, grid: int, batch_size: int = 262_144) -> np.ndarray:
    result = np.empty(grid ** 3, dtype=np.float32)
    for start in range(0, result.size, batch_size):
        stop = min(result.size, start + batch_size)
        indexes = np.arange(start, stop, dtype=np.int64)
        result[start:stop] = diagnostic_rgb_norm(fluid, indexes, grid)
    return result


def mapped_low_indexes(high_indexes: np.ndarray, low_grid: int, high_grid: int) -> np.ndarray:
    x = high_indexes % high_grid
    y = (high_indexes // high_grid) % high_grid
    z = high_indexes // (high_grid * high_grid)
    lx = np.minimum(low_grid - 1, np.floor(x * low_grid / high_grid).astype(np.int64))
    ly = np.minimum(low_grid - 1, np.floor(y * low_grid / high_grid).astype(np.int64))
    lz = np.minimum(low_grid - 1, np.floor(z * low_grid / high_grid).astype(np.int64))
    return lx + ly * low_grid + lz * low_grid * low_grid


def metrics(candidate: np.ndarray, truth: np.ndarray, baseline: np.ndarray) -> dict[str, float]:
    error = candidate.astype(np.float64) - truth.astype(np.float64)
    base_error = baseline.astype(np.float64) - truth.astype(np.float64)
    rmse = float(np.sqrt(np.mean(error * error)))
    base_rmse = float(np.sqrt(np.mean(base_error * base_error)))
    centered_a = candidate.astype(np.float64) - float(np.mean(candidate))
    centered_b = truth.astype(np.float64) - float(np.mean(truth))
    denom = float(np.sqrt(np.sum(centered_a * centered_a) * np.sum(centered_b * centered_b)))
    return {
        "rmse": rmse,
        "mae": float(np.mean(np.abs(error))),
        "rmseReductionVsLow": float((base_rmse - rmse) / max(base_rmse, 1.0e-12)),
        "pearsonCorrelation": float(np.sum(centered_a * centered_b) / denom) if denom > 1.0e-12 else 0.0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--train-samples", type=int, default=90_000)
    parser.add_argument("--validation-samples", type=int, default=60_000)
    parser.add_argument("--test-samples", type=int, default=80_000)
    parser.add_argument("--train-positive-fraction", type=float, default=0.55)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--learning-rate", type=float, default=0.002)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--spatial-block-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=9479)
    args = parser.parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    phase = "input"
    evidence: dict[str, Any] = {"args": vars(args)}
    try:
        pair_path = Path(args.pair_manifest).resolve()
        pair = json.loads(pair_path.read_text(encoding="utf-8"))
        if pair.get("schema") != "kaminos.volume.full-grid-field-pair.v0" or pair.get("status") != "captured":
            raise ValueError("pair manifest is not captured")
        if pair.get("authority") != PAIR_AUTHORITY:
            raise ValueError("pair authority mismatch")
        low_grid = int(pair["lowGrid"])
        high_grid = int(pair["highGrid"])
        if (low_grid, high_grid) != (96, 160):
            raise ValueError(f"expected 160->96 pair, got {high_grid}->{low_grid}")
        low_fluid_path = _PROBE.verify_descriptor(pair["low"]["fluid"], phase)
        low_front_path = _PROBE.verify_descriptor(pair["low"]["front"], phase)
        high_fluid_path = _PROBE.verify_descriptor(pair["high"]["fluid"], phase)
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_grid ** 3, 16))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_grid ** 3,))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_grid ** 3, 16))

        phase = "target-derive"
        low_activity = activity_volume(low_fluid, low_grid)
        high_activity = activity_volume(high_fluid, high_grid)
        labels = high_activity >= np.float32(0.08)
        roles, split = _PROBE.spatial_split(high_grid, int(args.spatial_block_size), int(args.seed))
        pools = {"train": np.flatnonzero(roles == 2), "validation": np.flatnonzero(roles == 1), "test": np.flatnonzero(roles == 0)}
        rng = np.random.default_rng(int(args.seed))
        train_indexes = _PROBE.sample_balanced(pools["train"], labels, args.train_samples, args.train_positive_fraction, rng)
        validation_indexes = _PROBE.sample_balanced(pools["validation"], labels, args.validation_samples, args.train_positive_fraction, rng)
        test_indexes = _PROBE.sample_balanced(pools["test"], labels, args.test_samples, args.train_positive_fraction, rng)

        phase = "feature-build"
        low_train, tx, ty, tz = _PROBE.low_values_for_high_cells(low_fluid, low_front, train_indexes, low_grid, high_grid)
        low_validation, vx, vy, vz = _PROBE.low_values_for_high_cells(low_fluid, low_front, validation_indexes, low_grid, high_grid)
        low_test, sx, sy, sz = _PROBE.low_values_for_high_cells(low_fluid, low_front, test_indexes, low_grid, high_grid)
        train_features = _PROBE.build_features(low_train, tx, ty, tz, high_grid)
        validation_features = _PROBE.build_features(low_validation, vx, vy, vz, high_grid)
        test_features = _PROBE.build_features(low_test, sx, sy, sz, high_grid)
        train_features, [validation_features, test_features], standardization = _PROBE.standardize(
            train_features, validation_features, test_features
        )
        low_train_activity = low_activity[mapped_low_indexes(train_indexes, low_grid, high_grid)]
        low_test_activity = low_activity[mapped_low_indexes(test_indexes, low_grid, high_grid)]
        residual_train = high_activity[train_indexes] - low_train_activity

        phase = "train"
        state, training = _PROBE.train_mlp(train_features, residual_train, args, rng, binary=False)
        residual_test = _PROBE.predict_mlp(test_features, state, binary=False)
        predicted_test = np.clip(low_test_activity + residual_test, 0.0, 1.0)
        test_metrics = metrics(predicted_test, high_activity[test_indexes], low_test_activity)

        phase = "pack"
        packed_arrays = [
            np.asarray(standardization["mean"], dtype="<f4").reshape(-1),
            np.asarray(standardization["std"], dtype="<f4").reshape(-1),
            np.asarray(state["w1"], dtype="<f4").reshape(-1),
            np.asarray(state["b1"], dtype="<f4").reshape(-1),
            np.asarray(state["w2"], dtype="<f4").reshape(-1),
            np.asarray(state["b2"], dtype="<f4").reshape(-1),
            np.asarray([state["targetMean"]], dtype="<f4"),
            np.asarray([state["targetStd"]], dtype="<f4"),
        ]
        names = ["featureMean", "featureStd", "w1", "b1", "w2", "b2", "targetMean", "targetStd"]
        offsets: dict[str, int] = {}
        offset = 0
        for name, values in zip(names, packed_arrays):
            offsets[name] = offset
            offset += int(values.size)
        packed = np.concatenate(packed_arrays).astype("<f4", copy=False)
        model_path = out_dir / "model.f32"
        packed.tofile(model_path)
        manifest = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "source": {
                "pairManifestPath": str(pair_path),
                "pairManifestSha256": sha256_file(pair_path),
                "lowGrid": low_grid,
                "highGrid": high_grid,
                "pairAuthority": PAIR_AUTHORITY,
                "trainingInputAuthority": TRAINING_INPUT_AUTHORITY,
                "trainingInputSyntheticDownsample": True,
                "nativeDeploymentInputSeenDuringTraining": False,
                "lowFluidSha256": sha256_file(low_fluid_path),
                "highFluidSha256": sha256_file(high_fluid_path),
            },
            "target": {
                "identity": TARGET_IDENTITY,
                "source": "high-grid velocity curl magnitude plus absolute divergence",
                "formulaAuthority": "legacy-derived-flow-debug-rgb-v0-norm-clamped-v0",
                "runtimeTruthAvailable": False,
                "positiveThreshold": 0.08,
                "highMean": float(np.mean(high_activity, dtype=np.float64)),
                "highNonzeroFraction": float(np.count_nonzero(high_activity > 1.0e-6) / high_activity.size),
            },
            "features": {"identity": _PROBE.FEATURE_IDENTITY, "featureCount": 185},
            "architecture": {"identity": "dense-tanh-dense-residual-v0", "hiddenWidth": int(args.hidden_width)},
            "training": {**training, "split": split, "trainSamples": int(train_indexes.size), "validationSamples": int(validation_indexes.size), "testSamples": int(test_indexes.size)},
            "test": test_metrics,
            "composition": {"identity": "native-derived-flow-activity-plus-learned-residual-clamped-v0"},
            "offsets": offsets,
            "packed": {
                "path": "model.f32",
                "dtype": "float32-le",
                "floatCount": int(packed.size),
                "byteLength": int(model_path.stat().st_size),
                "sha256": sha256_file(model_path),
            },
            "limitations": [
                "Single exact phase-aligned basin; native64 deployment is zero-shot.",
                "Truth-derived activity is used only as an offline training target and metric.",
                "The model predicts scalar flow activity, not velocity direction.",
            ],
        }
        write_json(manifest_path, manifest)
        (out_dir / "model.generated.js").write_text(
            "// Generated by volume-exact-basin-activity-head.py.\n"
            f"export const EXACT_BASIN_ACTIVITY_MODEL = Object.freeze({json.dumps(manifest, separators=(',', ':'))});\n"
            "export const EXACT_BASIN_ACTIVITY_MODEL_URL = new URL('./model.f32', import.meta.url).href;\n",
            encoding="ascii",
        )
        print(json.dumps({"ok": True, "manifest": str(manifest_path), "test": test_metrics}, indent=2))
        return 0
    except Exception as error:
        write_json(manifest_path, {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "error": str(error),
            "lastTrustworthyEvidence": evidence,
        })
        raise


if __name__ == "__main__":
    raise SystemExit(main())
