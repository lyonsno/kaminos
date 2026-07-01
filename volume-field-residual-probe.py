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
MODEL_IDENTITY = "same-bin-per-channel-affine-ridge-v0"
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
    parser.add_argument("--ridge", type=float, default=1.0e-4, help="Ridge penalty for per-channel affine slope.")
    parser.add_argument("--seed", type=int, default=7, help="Deterministic tile-pair split seed.")
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
        "identity": MODEL_IDENTITY,
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
        },
        "route": {
            "cwd": str(Path.cwd()),
            "gitCommit": git_value(["rev-parse", "HEAD"]),
            "gitBranch": git_value(["branch", "--show-current"]),
            "gitStatusShort": git_value(["status", "--short"], ""),
        },
        "limitations": [
            "This is a same-bin tile ingestion and learnability probe, not a product residual model.",
            "The model is per-channel affine ridge regression over corresponding low/high tile values; it has no spatial context or temporal memory.",
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


def split_report(name: str, low: np.ndarray, high: np.ndarray, scales: np.ndarray, biases: np.ndarray, mean_high: np.ndarray, mean_residual: np.ndarray) -> dict[str, Any]:
    identity = metrics(low, high)
    mean_high_prediction = np.broadcast_to(mean_high.reshape(1, -1), high.shape)
    mean_residual_prediction = low.astype(np.float64) + mean_residual.reshape(1, -1)
    model_prediction = predict(low, scales, biases)
    model_metrics = metrics(model_prediction, high)
    mean_residual_metrics = metrics(mean_residual_prediction, high)
    return {
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
    train_low, train_high = load_split(usable_matches, train_indexes)
    test_low, test_high = load_split(usable_matches, test_indexes)
    if train_low.shape[1] != test_low.shape[1]:
        raise ProbeFailure("tile-read", "train/test channel counts differ", {"trainChannels": train_low.shape[1], "testChannels": test_low.shape[1]})
    scales, biases = fit_affine_ridge(train_low, train_high, args.ridge)
    mean_high = np.mean(train_high.astype(np.float64), axis=0)
    mean_residual = np.mean(train_high.astype(np.float64) - train_low.astype(np.float64), axis=0)
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
        "model": {
            "identity": MODEL_IDENTITY,
            "backend": BACKEND,
            "ridge": args.ridge,
            "trainableParameters": int(train_low.shape[1] * 2),
            "scale": scales,
            "bias": biases,
            "meanHigh": mean_high,
            "meanResidual": mean_residual,
        },
        "metrics": {
            "train": split_report("train", train_low, train_high, scales, biases, mean_high, mean_residual),
            "test": split_report("test", test_low, test_high, scales, biases, mean_high, mean_residual),
        },
    })
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
