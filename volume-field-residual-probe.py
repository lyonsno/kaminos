#!/usr/bin/env python3
"""Tiny field-space residual probe for Kaminos low/high tile pairs."""

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


REPORT_SCHEMA = "kaminos.volume.field-residual-probe.v0"
AFFINE_MODEL_IDENTITY = "same-bin-per-channel-affine-ridge-v0"
SPATIAL_CONTEXT_MODEL_IDENTITY = "spatial-context-linear-ridge-v0"
MODEL_IDENTITY = AFFINE_MODEL_IDENTITY
BACKEND = "numpy"


class ProbeFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to a volume field-pair dataset manifest JSON.")
    parser.add_argument("--out", required=True, help="Path to write the residual probe report JSON.")
    parser.add_argument("--train-fraction", type=float, default=0.75, help="Tile-pair training fraction.")
    parser.add_argument("--ridge", type=float, default=1.0e-4, help="Ridge penalty for the selected linear model.")
    parser.add_argument("--seed", type=int, default=7, help="Deterministic tile-pair split seed.")
    parser.add_argument(
        "--model",
        choices=[AFFINE_MODEL_IDENTITY, SPATIAL_CONTEXT_MODEL_IDENTITY],
        default=AFFINE_MODEL_IDENTITY,
        help="Residual probe model identity to train.",
    )
    parser.add_argument(
        "--context-radius",
        type=int,
        default=1,
        help="Spatial-context radius for spatial-context-linear-ridge-v0; radius 1 means a 3x3x3 voxel neighborhood.",
    )
    parser.add_argument(
        "--allow-different-spatial-bin",
        action="store_true",
        help="Allow matched pairs whose sidecars do not report the same spatial bin.",
    )
    parser.add_argument(
        "--max-normalized-separation",
        type=float,
        default=None,
        help="Optional maximum normalized tile separation for usable pairs.",
    )
    return parser.parse_args()


def model_identity(args: argparse.Namespace) -> str:
    return str(getattr(args, "model", AFFINE_MODEL_IDENTITY) or AFFINE_MODEL_IDENTITY)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def git_value(args: list[str], fallback: str | None = None) -> str | None:
    try:
        value = subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL, text=True).strip()
        return value or fallback
    except Exception:
        return fallback


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_jsonable(payload), indent=2) + "\n", encoding="utf-8")


def to_jsonable(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def base_report(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "schema": REPORT_SCHEMA,
        "identity": model_identity(args),
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
            "model": model_identity(args),
            "contextRadius": args.context_radius,
            "requireSameSpatialBin": not args.allow_different_spatial_bin,
            "maxNormalizedSeparation": args.max_normalized_separation,
        },
        "route": {
            "cwd": str(Path.cwd()),
            "gitCommit": git_value(["rev-parse", "HEAD"]),
            "gitBranch": git_value(["branch", "--show-current"]),
            "gitStatusShort": git_value(["status", "--short"], ""),
        },
        "limitations": [
            "This is a same-bin tile ingestion and learnability probe, not a product residual model.",
            "The affine model has no spatial context; the spatial-context model is still a tiny linear probe with no temporal memory.",
            "Pairs inherit deterministic replay field authority from the dataset and do not prove literal cross-grid GPU snapshot transfer.",
        ],
    }


def fail_report(args: argparse.Namespace, phase: str, message: str, evidence: dict[str, Any] | None = None) -> int:
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
    return candidates[0]


def product(values: list[Any]) -> int:
    result = 1
    for value in values:
        result *= int(value)
    return result


def load_tile(path: Path, shape: list[Any]) -> np.ndarray:
    if len(shape) < 2:
        raise ProbeFailure("tile-read", f"tile shape must include spatial axes and channels: {shape}")
    expected = product(shape)
    array = np.fromfile(path, dtype=np.float32)
    if array.size != expected:
        raise ProbeFailure(
            "tile-read",
            f"tile payload size mismatch for {path}: expected {expected} float32 values, found {array.size}",
            {"path": str(path), "shape": shape, "expectedFloat32Values": expected, "actualFloat32Values": int(array.size)},
        )
    if not np.isfinite(array).all():
        raise ProbeFailure("tile-read", f"tile payload contains non-finite values: {path}", {"path": str(path)})
    return array.reshape(tuple(int(value) for value in shape))


def candidate_matches(dataset: dict[str, Any], manifest_path: Path, args: argparse.Namespace) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pairs = dataset.get("pairs")
    if not isinstance(pairs, list) or not pairs:
        raise ProbeFailure("pairing-read", "dataset contains no field pairs", {"datasetKeys": sorted(dataset.keys())})
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
            separation = match.get("normalizedTileSeparation")
            if args.max_normalized_separation is not None and float(separation or 0.0) > args.max_normalized_separation:
                discarded.append({
                    "matchId": match_id,
                    "reason": "normalized-separation-above-limit",
                    "normalizedTileSeparation": separation,
                })
                continue
            low_shape = match.get("lowShape")
            high_shape = match.get("highShape")
            if low_shape != high_shape:
                discarded.append({"matchId": match_id, "reason": "shape-mismatch", "lowShape": low_shape, "highShape": high_shape})
                continue
            if not isinstance(low_shape, list) or len(low_shape) < 2:
                discarded.append({"matchId": match_id, "reason": "bad-shape", "shape": low_shape})
                continue
            low_path = resolve_payload_path(match.get("lowPath"), manifest_path, dataset)
            high_path = resolve_payload_path(match.get("highPath"), manifest_path, dataset)
            if not low_path.exists() or not high_path.exists():
                discarded.append({
                    "matchId": match_id,
                    "reason": "missing-payload",
                    "lowPath": str(low_path),
                    "highPath": str(high_path),
                })
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
                "shape": [int(value) for value in low_shape],
                "lowPath": str(low_path),
                "highPath": str(high_path),
                "lowEnergySum": match.get("lowEnergySum"),
                "highEnergySum": match.get("highEnergySum"),
            })
    return usable, discarded


def split_matches(matches: list[dict[str, Any]], train_fraction: float, seed: int) -> tuple[list[int], list[int]]:
    if len(matches) < 2:
        raise ProbeFailure("split", "at least two usable tile pairs are required for a held-out split", {"usableTilePairs": len(matches)})
    fraction = min(0.95, max(0.05, float(train_fraction)))
    train_count = int(math.floor(len(matches) * fraction))
    train_count = min(max(1, train_count), len(matches) - 1)
    rng = np.random.default_rng(seed)
    permutation = list(map(int, rng.permutation(len(matches))))
    return sorted(permutation[:train_count]), sorted(permutation[train_count:])


def load_split(matches: list[dict[str, Any]], indexes: list[int]) -> tuple[np.ndarray, np.ndarray]:
    lows = []
    highs = []
    for index in indexes:
        match = matches[index]
        low = load_tile(Path(match["lowPath"]), match["shape"]).reshape(-1, match["shape"][-1])
        high = load_tile(Path(match["highPath"]), match["shape"]).reshape(-1, match["shape"][-1])
        lows.append(low)
        highs.append(high)
    return np.concatenate(lows, axis=0), np.concatenate(highs, axis=0)


def load_split_tiles(matches: list[dict[str, Any]], indexes: list[int]) -> tuple[list[np.ndarray], list[np.ndarray]]:
    lows = []
    highs = []
    for index in indexes:
        match = matches[index]
        lows.append(load_tile(Path(match["lowPath"]), match["shape"]))
        highs.append(load_tile(Path(match["highPath"]), match["shape"]))
    return lows, highs


def flatten_tiles(tiles: list[np.ndarray]) -> np.ndarray:
    return np.concatenate([tile.reshape(-1, tile.shape[-1]) for tile in tiles], axis=0)


def fit_affine_ridge(low: np.ndarray, high: np.ndarray, ridge: float) -> tuple[np.ndarray, np.ndarray]:
    channels = low.shape[1]
    scales = np.zeros(channels, dtype=np.float64)
    biases = np.zeros(channels, dtype=np.float64)
    for channel in range(channels):
        x = low[:, channel].astype(np.float64)
        y = high[:, channel].astype(np.float64)
        design = np.stack([x, np.ones_like(x)], axis=1)
        normal = design.T @ design
        normal[0, 0] += max(0.0, float(ridge))
        target = design.T @ y
        try:
            coeff = np.linalg.solve(normal, target)
        except np.linalg.LinAlgError:
            coeff = np.linalg.pinv(normal) @ target
        scales[channel] = coeff[0]
        biases[channel] = coeff[1]
    return scales, biases


def predict(low: np.ndarray, scales: np.ndarray, biases: np.ndarray) -> np.ndarray:
    return low.astype(np.float64) * scales.reshape(1, -1) + biases.reshape(1, -1)


def context_window(radius: int) -> int:
    return radius * 2 + 1


def context_feature_count(channels: int, radius: int) -> int:
    window = context_window(radius)
    return int(channels * window * window * window)


def context_features_for_tile(tile: np.ndarray, radius: int) -> np.ndarray:
    if radius < 0:
        raise ProbeFailure("model-config", f"context radius must be non-negative, got {radius}")
    if tile.ndim != 4:
        raise ProbeFailure("tile-read", f"spatial-context model requires 4D tile tensors, got shape {list(tile.shape)}")
    if radius == 0:
        return tile.reshape(-1, tile.shape[-1]).astype(np.float64)
    sx, sy, sz, _channels = tile.shape
    padded = np.pad(tile, ((radius, radius), (radius, radius), (radius, radius), (0, 0)), mode="edge")
    neighborhoods = []
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            for dz in range(-radius, radius + 1):
                view = padded[
                    radius + dx:radius + dx + sx,
                    radius + dy:radius + dy + sy,
                    radius + dz:radius + dz + sz,
                    :,
                ]
                neighborhoods.append(view.reshape(-1, tile.shape[-1]))
    return np.concatenate(neighborhoods, axis=1).astype(np.float64)


def context_feature_matrix(tiles: list[np.ndarray], radius: int) -> np.ndarray:
    return np.concatenate([context_features_for_tile(tile, radius) for tile in tiles], axis=0)


def fit_linear_ridge(features: np.ndarray, high: np.ndarray, ridge: float) -> tuple[np.ndarray, np.ndarray]:
    design = np.concatenate([features.astype(np.float64), np.ones((features.shape[0], 1), dtype=np.float64)], axis=1)
    normal = design.T @ design
    feature_count = features.shape[1]
    if ridge > 0:
        normal[:feature_count, :feature_count] += float(ridge) * np.eye(feature_count, dtype=np.float64)
    target = design.T @ high.astype(np.float64)
    try:
        coeff = np.linalg.solve(normal, target)
    except np.linalg.LinAlgError:
        coeff = np.linalg.pinv(normal) @ target
    return coeff[:feature_count, :], coeff[feature_count, :]


def predict_linear(features: np.ndarray, weights: np.ndarray, bias: np.ndarray) -> np.ndarray:
    return features.astype(np.float64) @ weights.astype(np.float64) + bias.reshape(1, -1)


def metrics(prediction: np.ndarray, target: np.ndarray) -> dict[str, Any]:
    error = prediction.astype(np.float64) - target.astype(np.float64)
    squared = error * error
    absolute = np.abs(error)
    return {
        "mse": float(np.mean(squared)),
        "mae": float(np.mean(absolute)),
        "rmse": float(np.sqrt(np.mean(squared))),
        "perChannelMse": np.mean(squared, axis=0),
        "perChannelMae": np.mean(absolute, axis=0),
    }


def improvement_vs_identity(model_metrics: dict[str, Any], identity_metrics: dict[str, Any]) -> float | None:
    identity_mse = float(identity_metrics["mse"])
    if identity_mse <= 0:
        return None
    return float((identity_mse - float(model_metrics["mse"])) / identity_mse)


def split_report(
    name: str,
    low: np.ndarray,
    high: np.ndarray,
    model_prediction: np.ndarray,
    mean_high: np.ndarray,
    mean_residual: np.ndarray,
    affine_prediction: np.ndarray | None = None,
) -> dict[str, Any]:
    identity = metrics(low, high)
    mean_high_prediction = np.broadcast_to(mean_high.reshape(1, -1), high.shape)
    mean_residual_prediction = low.astype(np.float64) + mean_residual.reshape(1, -1)
    model_metrics = metrics(model_prediction, high)
    mean_residual_metrics = metrics(mean_residual_prediction, high)
    report = {
        "split": name,
        "samples": int(low.shape[0]),
        "channels": int(low.shape[1]),
        "identityBaseline": identity,
        "meanHighBaseline": metrics(mean_high_prediction, high),
        "meanResidualBaseline": mean_residual_metrics,
        "model": model_metrics,
        "improvementVsIdentity": improvement_vs_identity(model_metrics, identity),
        "meanResidualImprovementVsIdentity": improvement_vs_identity(mean_residual_metrics, identity),
    }
    if affine_prediction is not None:
        affine_metrics = metrics(affine_prediction, high)
        affine_mse = float(affine_metrics["mse"])
        model_mse = float(model_metrics["mse"])
        report["affineComparison"] = {
            "affineBaseline": affine_metrics,
            "modelMseDeltaVsAffine": model_mse - affine_mse,
            "improvementVsAffine": None if affine_mse <= 0 else float((affine_mse - model_mse) / affine_mse),
        }
    return report


def summarize_matches(matches: list[dict[str, Any]], indexes: list[int]) -> list[dict[str, Any]]:
    return [
        {
            "pairId": matches[index]["pairId"],
            "matchId": matches[index]["matchId"],
            "lowTileId": matches[index]["lowTileId"],
            "highTileId": matches[index]["highTileId"],
            "sameSpatialBin": matches[index]["sameSpatialBin"],
            "lowSpatialBinId": matches[index]["lowSpatialBinId"],
            "highSpatialBinId": matches[index]["highSpatialBinId"],
            "normalizedTileDistance": matches[index]["normalizedTileDistance"],
            "normalizedTileSeparation": matches[index]["normalizedTileSeparation"],
        }
        for index in indexes
    ]


def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = Path(args.manifest).resolve()
    dataset = read_manifest(manifest_path)
    if dataset.get("status") != "captured":
        raise ProbeFailure("manifest-validate", "source dataset is not captured", {"status": dataset.get("status")})
    usable_matches, discarded_matches = candidate_matches(dataset, manifest_path, args)
    train_indexes, test_indexes = split_matches(usable_matches, args.train_fraction, args.seed)
    train_low_tiles, train_high_tiles = load_split_tiles(usable_matches, train_indexes)
    test_low_tiles, test_high_tiles = load_split_tiles(usable_matches, test_indexes)
    train_low = flatten_tiles(train_low_tiles)
    train_high = flatten_tiles(train_high_tiles)
    test_low = flatten_tiles(test_low_tiles)
    test_high = flatten_tiles(test_high_tiles)
    if train_low.shape[1] != test_low.shape[1]:
        raise ProbeFailure("tile-read", "train/test channel counts differ", {"trainChannels": train_low.shape[1], "testChannels": test_low.shape[1]})
    affine_scales, affine_biases = fit_affine_ridge(train_low, train_high, args.ridge)
    train_affine_prediction = predict(train_low, affine_scales, affine_biases)
    test_affine_prediction = predict(test_low, affine_scales, affine_biases)
    mean_high = np.mean(train_high.astype(np.float64), axis=0)
    mean_residual = np.mean(train_high.astype(np.float64) - train_low.astype(np.float64), axis=0)
    model = model_identity(args)
    context_radius_value = max(0, int(args.context_radius))
    context = None
    if model == AFFINE_MODEL_IDENTITY:
        model_prediction_train = train_affine_prediction
        model_prediction_test = test_affine_prediction
        model_payload = {
            "identity": model,
            "backend": BACKEND,
            "ridge": args.ridge,
            "trainableParameters": int(train_low.shape[1] * 2),
            "scale": affine_scales,
            "bias": affine_biases,
            "meanHigh": mean_high,
            "meanResidual": mean_residual,
        }
    elif model == SPATIAL_CONTEXT_MODEL_IDENTITY:
        train_features = context_feature_matrix(train_low_tiles, context_radius_value)
        test_features = context_feature_matrix(test_low_tiles, context_radius_value)
        weights, bias = fit_linear_ridge(train_features, train_high, args.ridge)
        model_prediction_train = predict_linear(train_features, weights, bias)
        model_prediction_test = predict_linear(test_features, weights, bias)
        context = {
            "contextRadius": context_radius_value,
            "contextWindow": [context_window(context_radius_value)] * 3,
            "contextFeatureCount": context_feature_count(train_low.shape[1], context_radius_value),
            "contextFeatureOrder": "dx-major,dy,dz over edge-padded low tile, channels preserved per offset",
        }
        model_payload = {
            "identity": model,
            "backend": BACKEND,
            "ridge": args.ridge,
            "trainableParameters": int(weights.size + bias.size),
            "context": context,
            "weightsShape": list(weights.shape),
            "biasShape": list(bias.shape),
            "weights": weights,
            "bias": bias,
            "affineBaseline": {
                "identity": AFFINE_MODEL_IDENTITY,
                "scale": affine_scales,
                "bias": affine_biases,
            },
            "meanHigh": mean_high,
            "meanResidual": mean_residual,
        }
    else:
        raise ProbeFailure("model-config", f"unsupported model identity: {model}", {"model": model})
    report = base_report(args)
    train_tile_pairs = summarize_matches(usable_matches, train_indexes)
    test_tile_pairs = summarize_matches(usable_matches, test_indexes)
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
            "coverageExpansion": dataset.get("coverageExpansion"),
            "baseUrl": dataset.get("baseUrl"),
        },
        "data": {
            "candidateMatchedTilePairs": len(usable_matches) + len(discarded_matches),
            "usableTilePairs": len(usable_matches),
            "discardedTilePairs": len(discarded_matches),
            "discarded": discarded_matches,
            "tileShape": usable_matches[0]["shape"] if usable_matches else None,
            "channels": int(train_low.shape[1]),
            "trainTilePairCount": len(train_indexes),
            "testTilePairCount": len(test_indexes),
            "trainSamples": int(train_low.shape[0]),
            "testSamples": int(test_low.shape[0]),
            "trainTilePairs": train_tile_pairs,
            "testTilePairs": test_tile_pairs,
        },
        "model": model_payload,
        "metrics": {
            "train": split_report(
                "train",
                train_low,
                train_high,
                model_prediction_train,
                mean_high,
                mean_residual,
                affine_prediction=None if model == AFFINE_MODEL_IDENTITY else train_affine_prediction,
            ),
            "test": split_report(
                "test",
                test_low,
                test_high,
                model_prediction_test,
                mean_high,
                mean_residual,
                affine_prediction=None if model == AFFINE_MODEL_IDENTITY else test_affine_prediction,
            ),
        },
    })
    if context is not None:
        report["data"]["contextWindow"] = context["contextWindow"]
        report["data"]["contextFeatureCount"] = context["contextFeatureCount"]
    return report


def main() -> int:
    args = parse_args()
    try:
        report = run(args)
        write_json(Path(args.out), report)
        return 0
    except ProbeFailure as exc:
        return fail_report(args, exc.phase, str(exc), exc.evidence)
    except Exception as exc:  # Keep unexpected crashes durable for agent recovery.
        return fail_report(args, "unexpected", f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
