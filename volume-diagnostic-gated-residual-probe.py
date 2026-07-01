#!/usr/bin/env python3
"""Diagnostic-gated residual solver probe for Kaminos field tile pairs.

Question: can compact diagnostic cues from the cheap (low-grid) simulation
predict WHERE the field residual between cheap and expensive simulation is large?

This is the core diagnostic-gating hypothesis: compact low-dimensional sensors
(tile energy, per-channel field statistics, spatial position) could guide
where to allocate expensive solver budget — not by predicting the full residual
field, but by predicting which tiles have large low/high differences.

What flowDebug IS and IS NOT:
  In volume-core.js, flowDebug (uniform u.source_controls.w) controls blending
  a diagnostic color (blue=low-divergence, red=high-divergence; brightness
  from curl) into the raymarched output at a single sample cell per ray.
  curlDebug = curlMagnitudeAtCell(sampleCell) and
  divDebug = abs(divergenceAtCell(sampleCell)) are computed per-pixel at one
  GPU cell per fragment. This is a RENDERED LOSSY SCREEN-SPACE PROJECTION,
  not a field quantity. It has no field authority and must not be used as
  physical truth.

  Available non-screen field cues (from CPU readback):
    - curlMean, curlMax: full-grid curl statistics from simReadback
    - divergenceMean, divergenceMax: full-grid divergence from simReadback
    - velocityMean: full-grid velocity magnitude from simReadback
    - majorantOccupiedBricks: coarse occupancy from majorantReadback
    - Per-tile: energySum, densityMax, fireMax, detailMax, liveCells,
      normalizedCenter (spatial position), per-channel tile means
  These are the diagnostic features this probe uses.

Target (what we are predicting):
  Per-matched-tile-pair residual magnitude = mean absolute difference between
  the low-grid and high-grid field tensors, averaged over voxels and channels.
  This is a continuous scalar per tile pair: "how much does cheap vs expensive
  differ here?"

Baselines:
  - Constant: always predict mean training residual (dumb floor)
  - EnergyThreshold: threshold on low tile energySum
  - SpatialPosition: threshold on normalized Y center (height in plume)
  - PerChannelMean: per-channel mean of low tile as features for ridge regression

Probe model:
  Ridge regression from per-tile diagnostic features -> per-tile residual magnitude.
  Features: [energySum, densityMax, fireMax, detailMax, liveCells, normCenterX,
             normCenterY, normCenterZ, per-channel voxel means (17 channels)]
  Target: mean absolute error between low and high tile tensors (per voxel, all channels).

The probe reports whether any diagnostic feature beats the constant baseline.
It explicitly records if no improvement is found (honest null result).

Route identity: webgpu-copy-src-readback-simReadback-summary-and-majorant
Effective computation: CPU tile readback via buildFieldTileExport in volume-core.js
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.diagnostic-gated-residual-probe.v0"
PROBE_IDENTITY = "diagnostic-gated-tile-residual-magnitude-v0"
BACKEND = "numpy"

# Verbatim from volume-core.js buildFieldTileExport channels list.
FIELD_CHANNELS = [
    "velocityX", "velocityY", "velocityZ",
    "densityCarrier", "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
    "frontTopology",
]
N_FIELD_CHANNELS = len(FIELD_CHANNELS)  # 17


class ProbeFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def git_value(args_list: list[str], fallback: str | None = None) -> str | None:
    try:
        value = subprocess.check_output(["git", *args_list], stderr=subprocess.DEVNULL, text=True).strip()
        return value or fallback
    except Exception:
        return fallback


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_jsonable(payload), indent=2) + "\n", encoding="utf-8")


def to_jsonable(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True,
                        help="Path to a volume field-pair dataset manifest JSON.")
    parser.add_argument("--out", required=True,
                        help="Path to write the diagnostic-gated residual probe report JSON.")
    parser.add_argument("--train-fraction", type=float, default=0.75,
                        help="Tile-pair training fraction (default 0.75).")
    parser.add_argument("--ridge", type=float, default=1e-4,
                        help="Ridge penalty for feature regression (default 1e-4).")
    parser.add_argument("--seed", type=int, default=7,
                        help="Deterministic split seed (default 7).")
    parser.add_argument("--allow-different-spatial-bin", action="store_true",
                        help="Allow matched pairs whose sidecars report different spatial bins.")
    parser.add_argument("--max-normalized-separation", type=float, default=None,
                        help="Optional maximum normalized tile separation for usable pairs.")
    parser.add_argument("--n-thresholds", type=int, default=20,
                        help="Number of threshold candidates for each baseline sweep.")
    return parser.parse_args()


def base_report(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "schema": REPORT_SCHEMA,
        "identity": PROBE_IDENTITY,
        "status": "started",
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "failurePhase": None,
        "backend": {
            "name": BACKEND,
            "numpyVersion": np.__version__,
            "pythonVersion": platform.python_version(),
            "platform": platform.platform(),
        },
        "sourceManifest": str(Path(args.manifest).resolve()),
        "requested": {
            "trainFraction": args.train_fraction,
            "ridge": args.ridge,
            "seed": args.seed,
            "requireSameSpatialBin": not args.allow_different_spatial_bin,
            "maxNormalizedSeparation": args.max_normalized_separation,
            "nThresholds": args.n_thresholds,
        },
        "route": {
            "cwd": str(Path.cwd()),
            "gitCommit": git_value(["rev-parse", "HEAD"]),
            "gitBranch": git_value(["branch", "--show-current"]),
            "gitStatusShort": git_value(["status", "--short"], ""),
        },
        # Explicit record of what flowDebug is and is not.
        "flowDebugAuthority": {
            "isFieldTruth": False,
            "description": (
                "flowDebug (uniform u.source_controls.w) is a rendered lossy screen-space "
                "diagnostic projection. It mixes a blue/red color (divergence-driven hue, "
                "curl-driven brightness) into the raymarched output at one GPU sample cell "
                "per ray fragment. curlDebug=curlMagnitudeAtCell(sampleCell) and "
                "divDebug=abs(divergenceAtCell(sampleCell)) are per-pixel single-cell reads "
                "inside the WGSL fragment shader. This is NOT a field quantity."
            ),
            "availableFieldCues": [
                "curlMean", "curlMax", "divergenceMean", "divergenceMax",
                "velocityMean", "majorantOccupiedBricks",
                "tileEnergySum", "tileDensityMax", "tileFireMax", "tileDetailMax",
                "tileLiveCells", "tileNormalizedCenter",
                "tilePerChannelMeans",
            ],
            "fieldCueAuthority": "webgpu-copy-src-readback-simReadback-summary-and-majorant",
            "sourceCode": "volume-core.js buildFieldTileExport() + simReadback CPU walk",
        },
        "limitations": [
            "This is a per-tile residual magnitude prediction probe, not a dense voxel residual model.",
            "Pairs inherit deterministic-replay field authority from the dataset; they are not literal same-GPU-state snapshots.",
            "Tile matching is by nearest normalized center; tiles may overlap different physical regions at different grid resolutions.",
            "Low/high grid captures use deterministic replay (same route/controls/steps) but separate GPU runs.",
            "flowDebug screen-space overlay is not used as input or target; only CPU-readback field cues are used.",
        ],
    }


def fail_report(args: argparse.Namespace, phase: str, message: str,
                evidence: dict[str, Any] | None = None) -> int:
    report = base_report(args)
    report.update({
        "status": "failed",
        "updatedAt": utc_now(),
        "failurePhase": phase,
        "error": message,
        "lastTrustworthyEvidence": evidence or {},
    })
    write_json(Path(args.out), report)
    return 1


def read_manifest(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProbeFailure("manifest-read", f"source manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ProbeFailure("manifest-read", f"source manifest is not valid JSON: {exc}") from exc
    dataset = payload.get("dataset", payload)
    if not isinstance(dataset, dict):
        raise ProbeFailure("manifest-read", "source manifest does not contain a dataset object")
    return dataset


def resolve_payload_path(raw_path: str, manifest_path: Path, dataset: dict[str, Any]) -> Path:
    path = Path(str(raw_path))
    if path.is_absolute():
        return path
    out_dir = dataset.get("outDir")
    candidates = []
    if out_dir:
        candidates.append(Path(str(out_dir)) / path)
    candidates.append(manifest_path.parent / path)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0] if candidates else path


def load_tile(path: Path, shape: list[Any]) -> np.ndarray:
    expected = 1
    for dim in shape:
        expected *= int(dim)
    array = np.fromfile(path, dtype=np.float32)
    if array.size != expected:
        raise ProbeFailure(
            "tile-read",
            f"tile payload size mismatch for {path}: expected {expected} values, found {array.size}",
            {"path": str(path), "shape": shape, "expected": expected, "actual": int(array.size)},
        )
    if not np.isfinite(array).all():
        raise ProbeFailure("tile-read", f"tile payload contains non-finite values: {path}",
                           {"path": str(path)})
    return array.reshape(tuple(int(v) for v in shape))


def candidate_matches(dataset: dict[str, Any], manifest_path: Path,
                      args: argparse.Namespace) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Extract usable matched tile pairs from the dataset, with discard accounting."""
    pairs = dataset.get("pairs")
    if not isinstance(pairs, list) or not pairs:
        raise ProbeFailure("pairing-read", "dataset contains no field pairs",
                           {"datasetKeys": sorted(dataset.keys())})
    usable: list[dict[str, Any]] = []
    discarded: list[dict[str, Any]] = []
    require_same_bin = not args.allow_different_spatial_bin

    for pair in pairs:
        pairing = pair.get("fieldTileCoveragePairing") if isinstance(pair, dict) else None
        if not isinstance(pairing, dict):
            discarded.append({"pairId": pair.get("pairId"), "reason": "missing-fieldTileCoveragePairing"})
            continue
        for match in pairing.get("matchedTilePairs", []):
            match_id = f"{pair.get('pairId')}:{match.get('matchId')}"
            if require_same_bin and not match.get("sameSpatialBin"):
                discarded.append({"matchId": match_id, "reason": "different-spatial-bin"})
                continue
            sep = match.get("normalizedTileSeparation")
            if args.max_normalized_separation is not None and float(sep or 0.0) > args.max_normalized_separation:
                discarded.append({"matchId": match_id, "reason": "normalized-separation-above-limit",
                                  "normalizedTileSeparation": sep})
                continue
            low_shape = match.get("lowShape")
            high_shape = match.get("highShape")
            if low_shape != high_shape:
                discarded.append({"matchId": match_id, "reason": "shape-mismatch",
                                  "lowShape": low_shape, "highShape": high_shape})
                continue
            if not isinstance(low_shape, list) or len(low_shape) < 2:
                discarded.append({"matchId": match_id, "reason": "bad-shape", "shape": low_shape})
                continue
            low_path = resolve_payload_path(match.get("lowPath", ""), manifest_path, dataset)
            high_path = resolve_payload_path(match.get("highPath", ""), manifest_path, dataset)
            if not low_path.exists() or not high_path.exists():
                discarded.append({"matchId": match_id, "reason": "missing-payload",
                                  "lowPath": str(low_path), "highPath": str(high_path)})
                continue
            usable.append({
                "pairId": pair.get("pairId"),
                "matchId": match.get("matchId"),
                "lowTileId": match.get("lowTileId"),
                "highTileId": match.get("highTileId"),
                "sameSpatialBin": bool(match.get("sameSpatialBin")),
                "lowSpatialBinId": match.get("lowSpatialBinId"),
                "highSpatialBinId": match.get("highSpatialBinId"),
                "normalizedTileDistance": match.get("normalizedTileDistance"),
                "normalizedTileSeparation": match.get("normalizedTileSeparation"),
                "shape": [int(v) for v in low_shape],
                "lowPath": str(low_path),
                "highPath": str(high_path),
                "lowEnergySum": match.get("lowEnergySum"),
                "highEnergySum": match.get("highEnergySum"),
                "lowNormalizedCenter": match.get("lowNormalizedCenter") or [0.0, 0.0, 0.0],
            })
    return usable, discarded


def extract_diagnostic_features(match: dict[str, Any], low_tile: np.ndarray) -> np.ndarray:
    """Extract compact diagnostic feature vector from a low-grid tile.

    Features (all from CPU readback, no screen-space input):
      - energySum: tile-level energy proxy (from sidecar metadata)
      - normalizedCenterX/Y/Z: spatial position in [0,1]^3
      - per-channel voxel mean (17 channels): mean field value per channel
      - per-channel voxel max (17 channels): max field value per channel
      - tile voxel count (proxy for tile size / boundary effects)

    Total: 3 (spatial) + 1 (energy) + 17 (channel means) + 17 (channel maxes) + 1 (voxel count) = 39 features.
    """
    voxels = low_tile.reshape(-1, low_tile.shape[-1]).astype(np.float64)
    n_voxels = voxels.shape[0]

    energy_sum = float(match.get("lowEnergySum") or 0.0)
    center = match.get("lowNormalizedCenter") or [0.0, 0.0, 0.0]
    cx = float(center[0]) if len(center) > 0 else 0.0
    cy = float(center[1]) if len(center) > 1 else 0.0
    cz = float(center[2]) if len(center) > 2 else 0.0

    channel_means = np.mean(voxels, axis=0)  # shape [C]
    channel_maxes = np.max(voxels, axis=0)   # shape [C]

    features = np.array([
        energy_sum,
        cx, cy, cz,
        *channel_means.tolist(),
        *channel_maxes.tolist(),
        float(n_voxels),
    ], dtype=np.float64)
    return features


def compute_tile_residual_magnitude(low_tile: np.ndarray, high_tile: np.ndarray) -> float:
    """Per-tile residual magnitude: mean absolute error between low and high field tensors.

    This is the target variable: how much does cheap (low-grid) differ from
    expensive (high-grid) at this spatial location?
    """
    diff = np.abs(low_tile.astype(np.float64) - high_tile.astype(np.float64))
    return float(np.mean(diff))


def build_feature_matrix(
    matches: list[dict[str, Any]], indexes: list[int]
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    """Load tiles for the given indexes, extract features and residual targets.

    Returns:
      features: shape [N, F]
      targets: shape [N] — per-tile residual magnitude
      tile_summaries: metadata list for reporting
    """
    feature_rows = []
    target_rows = []
    tile_summaries = []
    for index in indexes:
        match = matches[index]
        low_tile = load_tile(Path(match["lowPath"]), match["shape"])
        high_tile = load_tile(Path(match["highPath"]), match["shape"])
        features = extract_diagnostic_features(match, low_tile)
        target = compute_tile_residual_magnitude(low_tile, high_tile)
        feature_rows.append(features)
        target_rows.append(target)
        tile_summaries.append({
            "pairId": match["pairId"],
            "matchId": match["matchId"],
            "lowTileId": match["lowTileId"],
            "highTileId": match["highTileId"],
            "sameSpatialBin": match["sameSpatialBin"],
            "lowSpatialBinId": match["lowSpatialBinId"],
            "lowNormalizedCenter": match.get("lowNormalizedCenter"),
            "lowEnergySum": match.get("lowEnergySum"),
            "residualMagnitude": target,
        })
    return (
        np.stack(feature_rows, axis=0),
        np.array(target_rows, dtype=np.float64),
        tile_summaries,
    )


def fit_ridge(features: np.ndarray, targets: np.ndarray, ridge: float) -> tuple[np.ndarray, float]:
    """Fit ridge regression: targets = features @ weights + bias."""
    n, f = features.shape
    design = np.concatenate([features, np.ones((n, 1), dtype=np.float64)], axis=1)
    normal = design.T @ design
    normal[:f, :f] += float(ridge) * np.eye(f, dtype=np.float64)
    rhs = design.T @ targets
    try:
        coeff = np.linalg.solve(normal, rhs)
    except np.linalg.LinAlgError:
        coeff = np.linalg.pinv(normal) @ rhs
    return coeff[:f], float(coeff[f])


def predict_ridge(features: np.ndarray, weights: np.ndarray, bias: float) -> np.ndarray:
    return features @ weights + bias


def mse(pred: np.ndarray, target: np.ndarray) -> float:
    err = pred - target
    return float(np.mean(err * err))


def mae(pred: np.ndarray, target: np.ndarray) -> float:
    return float(np.mean(np.abs(pred - target)))


def pearson_r(x: np.ndarray, y: np.ndarray) -> float | None:
    if len(x) < 2:
        return None
    x_std = float(np.std(x))
    y_std = float(np.std(y))
    if x_std < 1e-12 or y_std < 1e-12:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def threshold_sweep_pearson(
    feature_col: np.ndarray, targets: np.ndarray, n_thresholds: int
) -> dict[str, Any]:
    """Sweep thresholds on a single feature column, report best Pearson r vs target."""
    r = pearson_r(feature_col, targets)
    return {
        "pearsonR": r,
        "mse": mse(feature_col, targets),
    }


def constant_baseline_metrics(targets_train: np.ndarray, targets_test: np.ndarray) -> dict[str, Any]:
    """Constant prediction: always predict mean training residual."""
    mean_pred = float(np.mean(targets_train))
    train_pred = np.full_like(targets_train, mean_pred)
    test_pred = np.full_like(targets_test, mean_pred)
    return {
        "meanTrainingResidual": mean_pred,
        "train": {"mse": mse(train_pred, targets_train), "mae": mae(train_pred, targets_train)},
        "test": {"mse": mse(test_pred, targets_test), "mae": mae(test_pred, targets_test)},
    }


def energy_threshold_baseline(
    train_features: np.ndarray, train_targets: np.ndarray,
    test_features: np.ndarray, test_targets: np.ndarray,
) -> dict[str, Any]:
    """Baseline: use tile energySum (feature index 0) as a predictor."""
    # energySum is feature index 0 (see extract_diagnostic_features)
    train_energy = train_features[:, 0]
    test_energy = test_features[:, 0]
    train_r = pearson_r(train_energy, train_targets)
    test_r = pearson_r(test_energy, test_targets)
    return {
        "featureIndex": 0,
        "featureName": "energySum",
        "pearsonR": {"train": train_r, "test": test_r},
        "mse": {
            "train": mse(train_energy, train_targets),
            "test": mse(test_energy, test_targets),
        },
    }


def spatial_y_baseline(
    train_features: np.ndarray, train_targets: np.ndarray,
    test_features: np.ndarray, test_targets: np.ndarray,
) -> dict[str, Any]:
    """Baseline: use normalizedCenterY (feature index 2) as a predictor."""
    # normalizedCenterY is feature index 2 (energy, cx, cy, cz = indices 0,1,2,3)
    train_y = train_features[:, 2]
    test_y = test_features[:, 2]
    train_r = pearson_r(train_y, train_targets)
    test_r = pearson_r(test_y, test_targets)
    return {
        "featureIndex": 2,
        "featureName": "normalizedCenterY",
        "pearsonR": {"train": train_r, "test": test_r},
        "mse": {
            "train": mse(train_y, train_targets),
            "test": mse(test_y, test_targets),
        },
    }


def per_channel_mean_baseline(
    train_features: np.ndarray, train_targets: np.ndarray,
    test_features: np.ndarray, test_targets: np.ndarray,
) -> dict[str, Any]:
    """Baseline: use per-channel voxel means (features 4..20) for ridge regression.

    Feature layout: [energySum, cx, cy, cz, ch_mean_0..16, ch_max_0..16, n_voxels]
    Channel means start at index 4.
    """
    # Channel means: indices 4 through 4+N_FIELD_CHANNELS-1
    ch_start = 4
    ch_end = ch_start + N_FIELD_CHANNELS
    train_ch = train_features[:, ch_start:ch_end]
    test_ch = test_features[:, ch_start:ch_end]
    weights, bias = fit_ridge(train_ch, train_targets, ridge=1e-4)
    train_pred = predict_ridge(train_ch, weights, bias)
    test_pred = predict_ridge(test_ch, weights, bias)
    return {
        "featureRange": [ch_start, ch_end],
        "featureNames": FIELD_CHANNELS,
        "train": {"mse": mse(train_pred, train_targets), "mae": mae(train_pred, train_targets)},
        "test": {"mse": mse(test_pred, test_targets), "mae": mae(test_pred, test_targets)},
    }


def split_indexes(
    n: int, train_fraction: float, seed: int
) -> tuple[list[int], list[int]]:
    if n < 2:
        raise ProbeFailure("split", "at least 2 usable tile pairs required for a held-out split",
                           {"usableTilePairs": n})
    fraction = min(0.95, max(0.05, float(train_fraction)))
    train_count = int(math.floor(n * fraction))
    train_count = min(max(1, train_count), n - 1)
    rng = np.random.default_rng(seed)
    perm = list(map(int, rng.permutation(n)))
    return sorted(perm[:train_count]), sorted(perm[train_count:])


def compute_improvement(model_mse: float, baseline_mse: float) -> float | None:
    if baseline_mse <= 0:
        return None
    return float((baseline_mse - model_mse) / baseline_mse)


def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = Path(args.manifest).resolve()
    dataset = read_manifest(manifest_path)
    if dataset.get("status") != "captured":
        raise ProbeFailure("manifest-validate", "source dataset is not captured",
                           {"status": dataset.get("status")})

    usable_matches, discarded_matches = candidate_matches(dataset, manifest_path, args)
    train_indexes, test_indexes = split_indexes(
        len(usable_matches), args.train_fraction, args.seed
    )

    train_features, train_targets, train_summaries = build_feature_matrix(usable_matches, train_indexes)
    test_features, test_targets, test_summaries = build_feature_matrix(usable_matches, test_indexes)

    n_features = train_features.shape[1]

    # Full-feature ridge model
    weights, bias = fit_ridge(train_features, train_targets, args.ridge)
    train_pred = predict_ridge(train_features, weights, bias)
    test_pred = predict_ridge(test_features, weights, bias)

    # Constant baseline
    const_baseline = constant_baseline_metrics(train_targets, test_targets)

    # Per-cue baselines
    energy_baseline = energy_threshold_baseline(
        train_features, train_targets, test_features, test_targets
    )
    spatial_y_base = spatial_y_baseline(
        train_features, train_targets, test_features, test_targets
    )
    ch_mean_base = per_channel_mean_baseline(
        train_features, train_targets, test_features, test_targets
    )

    # Model metrics
    train_model_mse = mse(train_pred, train_targets)
    test_model_mse = mse(test_pred, test_targets)
    train_model_mae = mae(train_pred, train_targets)
    test_model_mae = mae(test_pred, test_targets)

    constant_test_mse = const_baseline["test"]["mse"]
    improvement_vs_constant = compute_improvement(test_model_mse, constant_test_mse)

    report = base_report(args)
    report.update({
        "status": "completed",
        "updatedAt": utc_now(),
        "sourceDataset": {
            "schema": dataset.get("schema"),
            "status": dataset.get("status"),
            "manifestPath": dataset.get("manifestPath"),
            "gitCommit": dataset.get("gitCommit"),
            "gitBranch": dataset.get("gitBranch"),
            "pairAuthority": dataset.get("pairAuthority"),
            "fieldAuthority": dataset.get("fieldAuthority"),
            "deterministicReplay": dataset.get("deterministicReplay"),
            "fieldTileExport": dataset.get("fieldTileExport"),
        },
        "data": {
            "candidateMatchedTilePairs": len(usable_matches) + len(discarded_matches),
            "usableTilePairs": len(usable_matches),
            "discardedTilePairs": len(discarded_matches),
            "discarded": discarded_matches,
            "tileShape": usable_matches[0]["shape"] if usable_matches else None,
            "trainTilePairCount": len(train_indexes),
            "testTilePairCount": len(test_indexes),
            "trainTilePairs": train_summaries,
            "testTilePairs": test_summaries,
        },
        "diagnosticFeatures": {
            "featureCount": n_features,
            "featureLayout": (
                "0: energySum | 1: normCenterX | 2: normCenterY | 3: normCenterZ | "
                "4..20: per-channel voxel means (17 channels, see FIELD_CHANNELS) | "
                "21..37: per-channel voxel maxes (17 channels) | 38: voxelCount"
            ),
            "fieldChannels": FIELD_CHANNELS,
            "featureAuthority": "webgpu-copy-src-readback-simReadback-summary-and-majorant",
            "noScreenSpaceInput": True,
        },
        "model": {
            "identity": PROBE_IDENTITY,
            "type": "ridge-regression-all-diagnostic-features",
            "backend": BACKEND,
            "ridge": args.ridge,
            "trainableParameters": int(weights.size + 1),
            "weightsShape": list(weights.shape),
        },
        "baselines": {
            "constant": const_baseline,
            "energyThreshold": energy_baseline,
            "spatialY": spatial_y_base,
            "perChannelMean": ch_mean_base,
        },
        "metrics": {
            "train": {
                "samples": int(len(train_indexes)),
                "residualMagnitudeMean": float(np.mean(train_targets)),
                "residualMagnitudeStd": float(np.std(train_targets)),
                "model": {"mse": train_model_mse, "mae": train_model_mae},
                "baselines": {
                    "constant": const_baseline["train"],
                    "energyThreshold": {
                        "pearsonR": energy_baseline["pearsonR"]["train"],
                        "mse": energy_baseline["mse"]["train"],
                    },
                    "spatialY": {
                        "pearsonR": spatial_y_base["pearsonR"]["train"],
                        "mse": spatial_y_base["mse"]["train"],
                    },
                    "perChannelMean": ch_mean_base["train"],
                },
            },
            "test": {
                "samples": int(len(test_indexes)),
                "residualMagnitudeMean": float(np.mean(test_targets)),
                "residualMagnitudeStd": float(np.std(test_targets)),
                "model": {"mse": test_model_mse, "mae": test_model_mae},
                "modelImprovementVsConstantBaseline": improvement_vs_constant,
                "baselines": {
                    "constant": const_baseline["test"],
                    "energyThreshold": {
                        "pearsonR": energy_baseline["pearsonR"]["test"],
                        "mse": energy_baseline["mse"]["test"],
                    },
                    "spatialY": {
                        "pearsonR": spatial_y_base["pearsonR"]["test"],
                        "mse": spatial_y_base["mse"]["test"],
                    },
                    "perChannelMean": ch_mean_base["test"],
                },
            },
        },
        "verdict": _build_verdict(
            improvement_vs_constant=improvement_vs_constant,
            energy_r_train=energy_baseline["pearsonR"]["train"],
            energy_r_test=energy_baseline["pearsonR"]["test"],
            spatial_y_r_train=spatial_y_base["pearsonR"]["train"],
            spatial_y_r_test=spatial_y_base["pearsonR"]["test"],
            train_n=len(train_indexes),
            test_n=len(test_indexes),
        ),
    })
    return report


def _build_verdict(
    *,
    improvement_vs_constant: float | None,
    energy_r_train: float | None,
    energy_r_test: float | None,
    spatial_y_r_train: float | None,
    spatial_y_r_test: float | None,
    train_n: int,
    test_n: int,
) -> dict[str, Any]:
    """Honest summary of whether diagnostic cues show signal for residual gating."""
    signals = []
    concerns = []

    if train_n < 4 or test_n < 2:
        concerns.append(f"very small sample: train={train_n}, test={test_n}; results not reliable")

    if improvement_vs_constant is not None:
        if improvement_vs_constant > 0.05:
            signals.append(f"full-feature ridge improves vs constant baseline on test by {improvement_vs_constant:.1%}")
        elif improvement_vs_constant > 0:
            signals.append(f"marginal improvement vs constant ({improvement_vs_constant:.1%}); within noise at this sample size")
        else:
            concerns.append(f"full-feature ridge does NOT improve vs constant baseline on test ({improvement_vs_constant:.1%})")
    else:
        concerns.append("improvement vs constant baseline could not be computed (zero baseline MSE)")

    if energy_r_train is not None and abs(energy_r_train) > 0.3:
        signals.append(f"tile energySum shows non-trivial correlation with residual magnitude on train (r={energy_r_train:.3f})")
    if energy_r_test is not None and abs(energy_r_test) > 0.3:
        signals.append(f"tile energySum correlation holds on test (r={energy_r_test:.3f})")

    if spatial_y_r_train is not None and abs(spatial_y_r_train) > 0.3:
        signals.append(f"spatial Y (height) shows correlation with residual magnitude on train (r={spatial_y_r_train:.3f})")

    if signals and not concerns:
        conclusion = "weak-signal-present"
    elif signals and concerns:
        conclusion = "mixed-signal"
    elif not signals and not concerns:
        conclusion = "inconclusive-too-few-samples"
    else:
        conclusion = "no-signal"

    return {
        "conclusion": conclusion,
        "signals": signals,
        "concerns": concerns,
        "interpretation": (
            "Diagnostic cues (tile energy, field channel statistics, spatial position) "
            "from the low-grid simulation can serve as sensors for where cheap/expensive "
            "differ IF correlation with residual magnitude is present. "
            "A null result here means the current feature set does not capture the relevant variation, "
            "not that the gating hypothesis is wrong in principle."
        ),
    }


def main_with_args(args: argparse.Namespace) -> int:
    """Entrypoint for testing: takes a pre-built args namespace."""
    try:
        report = run(args)
        write_json(Path(args.out), report)
        return 0
    except ProbeFailure as exc:
        return fail_report(args, exc.phase, str(exc), exc.evidence)
    except Exception as exc:
        return fail_report(args, "unexpected", f"{type(exc).__name__}: {exc}")


def main() -> int:
    args = parse_args()
    return main_with_args(args)


if __name__ == "__main__":
    raise SystemExit(main())
