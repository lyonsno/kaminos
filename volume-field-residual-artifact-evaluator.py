#!/usr/bin/env python3
"""Evaluate offline Kaminos field residual application artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.field-residual-artifact-evaluation.v0"
APPLICATION_ARTIFACT_SCHEMA = "kaminos.volume.field-residual-application-artifact.v0"
APPLICATION_ARTIFACT_IDENTITY = "offline-test-tile-target-residual-application-v0"
COMPARISON_AUTHORITY = "offline-heldout-field-artifact-comparison-not-live-renderer-state"
BACKEND = "numpy"
PAYLOAD_KEYS = [
    "lowTarget",
    "predictedHighTarget",
    "residualTarget",
    "truthHighTarget",
    "errorTarget",
]


class EvaluationFailure(RuntimeError):
    def __init__(self, failurePhase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.failurePhase = failurePhase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-manifest", required=True, help="Residual application artifact manifest JSON.")
    parser.add_argument("--out", required=True, help="Path to write the evaluation report JSON.")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def git_value(args: list[str], fallback: str | None = None) -> str | None:
    try:
        value = subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL, text=True).strip()
        return value or fallback
    except Exception:
        return fallback


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def product(values: list[int]) -> int:
    result = 1
    for value in values:
        result *= int(value)
    return result


def to_jsonable(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [to_jsonable(item) for item in value]
    return value


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_jsonable(payload), indent=2) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception as exc:
        raise EvaluationFailure("manifest-read", f"could not read artifact manifest: {exc}", {"path": str(path)}) from exc
    if not isinstance(payload, dict):
        raise EvaluationFailure("manifest-read", "artifact manifest is not a JSON object", {"path": str(path)})
    return payload


def resolve_payload_path(manifest_path: Path, descriptor: dict[str, Any]) -> Path:
    requested = Path(str(descriptor.get("path", "")))
    candidates = []
    if requested.is_absolute():
        candidates.append(requested)
    else:
        candidates.append((manifest_path.parent / requested).resolve())
    if requested.name:
        candidates.append((manifest_path.parent / "tiles" / requested.name).resolve())
        candidates.append((manifest_path.parent / requested.name).resolve())
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise EvaluationFailure(
        "payload-read",
        "payload file is missing",
        {"requestedPath": str(requested), "candidatePaths": [str(candidate) for candidate in candidates]},
    )


def verify_payload_descriptor(manifest_path: Path, descriptor: Any, shape: list[int], payload_key: str) -> tuple[np.ndarray, dict[str, Any]]:
    if not isinstance(descriptor, dict):
        raise EvaluationFailure("payload-validate", f"{payload_key} descriptor is not an object", {"payloadKey": payload_key})
    dtype = descriptor.get("dtype")
    if dtype != "float32":
        raise EvaluationFailure("payload-validate", f"{payload_key} dtype must be float32", {"payloadKey": payload_key, "dtype": dtype})
    path = resolve_payload_path(manifest_path, descriptor)
    expected_values = product(shape)
    expected_bytes = expected_values * 4
    actual_bytes = path.stat().st_size
    descriptor_bytes = int(descriptor.get("byteLength", -1))
    if actual_bytes != expected_bytes or descriptor_bytes != expected_bytes:
        raise EvaluationFailure(
            "payload-validate",
            f"{payload_key} byte length does not match shape",
            {
                "payloadKey": payload_key,
                "path": str(path),
                "shape": shape,
                "expectedBytes": expected_bytes,
                "descriptorBytes": descriptor_bytes,
                "actualBytes": actual_bytes,
            },
        )
    actual_sha = sha256_file(path)
    descriptor_sha = descriptor.get("sha256")
    if actual_sha != descriptor_sha:
        raise EvaluationFailure(
            "payload-validate",
            f"{payload_key} sha256 mismatch",
            {"payloadKey": payload_key, "path": str(path), "expectedSha256": descriptor_sha, "actualSha256": actual_sha},
        )
    values = np.fromfile(path, dtype=np.float32)
    if int(values.size) != expected_values:
        raise EvaluationFailure(
            "payload-read",
            f"{payload_key} value count does not match shape",
            {"payloadKey": payload_key, "path": str(path), "expectedValues": expected_values, "actualValues": int(values.size)},
        )
    if not np.all(np.isfinite(values)):
        raise EvaluationFailure("payload-read", f"{payload_key} contains non-finite values", {"payloadKey": payload_key, "path": str(path)})
    return values.reshape(shape), {
        "payloadKey": payload_key,
        "requestedPath": str(descriptor.get("path")),
        "effectivePath": str(path),
        "shape": shape,
        "byteLength": actual_bytes,
        "sha256": actual_sha,
    }


def mse_mae_max(error: np.ndarray) -> dict[str, float]:
    absolute = np.abs(error)
    return {
        "mse": float(np.mean(error ** 2)),
        "mae": float(np.mean(absolute)),
        "rmse": float(np.sqrt(np.mean(error ** 2))),
        "maxAbsError": float(np.max(absolute)),
    }


def improvement(baseline_mse: float, model_mse: float) -> float | None:
    if baseline_mse == 0:
        return None
    return float((baseline_mse - model_mse) / baseline_mse)


def grouped_metrics(rows: list[dict[str, Any]], group_keys: list[str]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, ...], dict[str, Any]] = {}
    for row in rows:
        key = tuple(str(row.get(group_key, "unknown")) for group_key in group_keys)
        bucket = grouped.setdefault(key, {
            "key": {group_key: key[index] for index, group_key in enumerate(group_keys)},
            "tileCount": 0,
            "sampleCount": 0,
            "sumSquaredError": 0.0,
            "sumAbsoluteError": 0.0,
            "maxAbsError": 0.0,
        })
        bucket["tileCount"] += 1
        bucket["sampleCount"] += int(row["sampleCount"])
        bucket["sumSquaredError"] += float(row["sumSquaredError"])
        bucket["sumAbsoluteError"] += float(row["sumAbsoluteError"])
        bucket["maxAbsError"] = max(float(bucket["maxAbsError"]), float(row["maxAbsError"]))

    result = []
    for bucket in grouped.values():
        denominator = max(1, int(bucket["sampleCount"]))
        result.append({
            **bucket["key"],
            "tileCount": bucket["tileCount"],
            "sampleCount": bucket["sampleCount"],
            "model": {
                "mse": bucket["sumSquaredError"] / denominator,
                "mae": bucket["sumAbsoluteError"] / denominator,
                "rmse": float(np.sqrt(bucket["sumSquaredError"] / denominator)),
                "maxAbsError": bucket["maxAbsError"],
            },
        })
    result.sort(key=lambda item: tuple(str(item.get(group_key, "")) for group_key in group_keys))
    return result


def validate_manifest(manifest_path: Path, manifest: dict[str, Any]) -> None:
    if manifest.get("schema") != APPLICATION_ARTIFACT_SCHEMA:
        raise EvaluationFailure("manifest-validate", "artifact manifest schema mismatch", {"schema": manifest.get("schema")})
    if manifest.get("identity") != APPLICATION_ARTIFACT_IDENTITY:
        raise EvaluationFailure("manifest-validate", "artifact manifest identity mismatch", {"identity": manifest.get("identity")})
    if manifest.get("status") != "written":
        raise EvaluationFailure("manifest-validate", "artifact manifest status is not written", {"status": manifest.get("status")})
    if manifest.get("artifactAuthority") != "offline-residual-application-on-heldout-field-tiles-not-renderer-integration":
        raise EvaluationFailure("manifest-validate", "artifact authority is not offline field residual application", {"artifactAuthority": manifest.get("artifactAuthority")})
    if not isinstance(manifest.get("tiles"), list) or not manifest["tiles"]:
        raise EvaluationFailure("manifest-validate", "artifact manifest has no tiles", {"tileCount": manifest.get("tileCount")})
    if int(manifest.get("tileCount", -1)) != len(manifest["tiles"]):
        raise EvaluationFailure("manifest-validate", "manifest tileCount does not match tiles length", {"tileCount": manifest.get("tileCount"), "actualTiles": len(manifest["tiles"])})
    if not manifest_path.exists():
        raise EvaluationFailure("manifest-read", "artifact manifest path does not exist", {"path": str(manifest_path)})


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = Path(args.artifact_manifest).resolve()
    out_path = Path(args.out).resolve()
    manifest = read_json(manifest_path)
    validate_manifest(manifest_path, manifest)

    channels = manifest.get("model", {}).get("targetChannels", {}).get("targetChannels")
    if not isinstance(channels, list) or not channels:
        raise EvaluationFailure("manifest-validate", "artifact manifest does not name target channels", {"targetChannels": channels})
    channel_count = len(channels)

    tile_rows: list[dict[str, Any]] = []
    payload_verification: list[dict[str, Any]] = []
    model_error_chunks = []
    identity_error_chunks = []
    residual_chunks = []
    local_sum_squared = None
    local_sum_absolute = None
    local_count = 0

    per_channel_squared = np.zeros(channel_count, dtype=np.float64)
    per_channel_absolute = np.zeros(channel_count, dtype=np.float64)
    per_channel_identity_squared = np.zeros(channel_count, dtype=np.float64)
    per_channel_identity_absolute = np.zeros(channel_count, dtype=np.float64)
    per_channel_counts = np.zeros(channel_count, dtype=np.int64)
    per_channel_max = np.zeros(channel_count, dtype=np.float64)

    for index, tile in enumerate(manifest["tiles"]):
        if not isinstance(tile, dict):
            raise EvaluationFailure("tile-validate", "tile entry is not an object", {"tileIndex": index})
        shape = [int(value) for value in tile.get("shape", [])]
        if len(shape) != 4 or shape[-1] != channel_count:
            raise EvaluationFailure(
                "tile-validate",
                "tile shape is not compatible with target channels",
                {"tileIndex": index, "shape": shape, "targetChannelCount": channel_count},
            )
        tile_channels = tile.get("targetChannels")
        if tile_channels != channels:
            raise EvaluationFailure("tile-validate", "tile target channel list diverges from manifest model channels", {"tileIndex": index})

        payloads: dict[str, np.ndarray] = {}
        for payload_key in PAYLOAD_KEYS:
            payload, verification = verify_payload_descriptor(manifest_path, tile.get(payload_key), shape, payload_key)
            payloads[payload_key] = payload.astype(np.float64)
            verification["tileOrder"] = tile.get("order", index)
            payload_verification.append(verification)

        low = payloads["lowTarget"]
        predicted = payloads["predictedHighTarget"]
        residual = payloads["residualTarget"]
        truth = payloads["truthHighTarget"]
        error = payloads["errorTarget"]
        if not np.allclose(predicted - low, residual, atol=1.0e-5, rtol=1.0e-5):
            raise EvaluationFailure("payload-consistency", "residualTarget does not equal predictedHighTarget - lowTarget", {"tileIndex": index})
        if not np.allclose(predicted - truth, error, atol=1.0e-5, rtol=1.0e-5):
            raise EvaluationFailure("payload-consistency", "errorTarget does not equal predictedHighTarget - truthHighTarget", {"tileIndex": index})

        identity_error = low - truth
        tile_error = predicted - truth
        absolute_error = np.abs(tile_error)
        sample_count = int(tile_error.size)
        tile_row = {
            "order": tile.get("order", index),
            "pairId": tile.get("pairId"),
            "matchId": tile.get("matchId"),
            "routeVariantIdentity": tile.get("routeVariantIdentity"),
            "replayStateIdentity": tile.get("replayStateIdentity"),
            "shape": shape,
            "sampleCount": sample_count,
            "sumSquaredError": float(np.sum(tile_error ** 2)),
            "sumAbsoluteError": float(np.sum(absolute_error)),
            "maxAbsError": float(np.max(absolute_error)),
            "model": mse_mae_max(tile_error),
            "identityBaseline": mse_mae_max(identity_error),
            "residualMagnitude": mse_mae_max(residual),
        }
        tile_rows.append(tile_row)
        model_error_chunks.append(tile_error.reshape(-1, channel_count))
        identity_error_chunks.append(identity_error.reshape(-1, channel_count))
        residual_chunks.append(residual.reshape(-1, channel_count))

        per_channel_squared += np.sum(tile_error.reshape(-1, channel_count) ** 2, axis=0)
        per_channel_absolute += np.sum(np.abs(tile_error.reshape(-1, channel_count)), axis=0)
        per_channel_identity_squared += np.sum(identity_error.reshape(-1, channel_count) ** 2, axis=0)
        per_channel_identity_absolute += np.sum(np.abs(identity_error.reshape(-1, channel_count)), axis=0)
        per_channel_counts += int(product(shape[:-1]))
        per_channel_max = np.maximum(per_channel_max, np.max(np.abs(tile_error.reshape(-1, channel_count)), axis=0))

        squared_local = np.mean(tile_error ** 2, axis=-1)
        absolute_local = np.mean(np.abs(tile_error), axis=-1)
        if local_sum_squared is None:
            local_sum_squared = np.zeros_like(squared_local, dtype=np.float64)
            local_sum_absolute = np.zeros_like(absolute_local, dtype=np.float64)
        local_sum_squared += squared_local
        local_sum_absolute += absolute_local
        local_count += 1

    model_errors = np.vstack(model_error_chunks)
    identity_errors = np.vstack(identity_error_chunks)
    residual_values = np.vstack(residual_chunks)
    model_mse = float(np.mean(model_errors ** 2))
    identity_mse = float(np.mean(identity_errors ** 2))
    residual_magnitude_mse = float(np.mean(residual_values ** 2))
    perChannelMetrics = []
    for index, channel in enumerate(channels):
        count = max(1, int(per_channel_counts[index]))
        channel_model_mse = float(per_channel_squared[index] / count)
        channel_identity_mse = float(per_channel_identity_squared[index] / count)
        perChannelMetrics.append({
            "channel": channel,
            "index": index,
            "model": {
                "mse": channel_model_mse,
                "mae": float(per_channel_absolute[index] / count),
                "rmse": float(np.sqrt(channel_model_mse)),
                "maxAbsError": float(per_channel_max[index]),
            },
            "identityBaseline": {
                "mse": channel_identity_mse,
                "mae": float(per_channel_identity_absolute[index] / count),
                "rmse": float(np.sqrt(channel_identity_mse)),
            },
            "improvementVsIdentity": improvement(channel_identity_mse, channel_model_mse),
        })

    local_mse = local_sum_squared / max(1, local_count)
    local_mae = local_sum_absolute / max(1, local_count)
    spatialErrorProfile = {
        "shape": list(local_mse.shape),
        "tileCount": local_count,
        "localVoxelMse": local_mse,
        "localVoxelMae": local_mae,
        "axisMse": {
            "x": np.mean(local_mse, axis=(1, 2)),
            "y": np.mean(local_mse, axis=(0, 2)),
            "z": np.mean(local_mse, axis=(0, 1)),
        },
        "axisMae": {
            "x": np.mean(local_mae, axis=(1, 2)),
            "y": np.mean(local_mae, axis=(0, 2)),
            "z": np.mean(local_mae, axis=(0, 1)),
        },
    }

    report = {
        "schema": REPORT_SCHEMA,
        "identity": "offline-field-residual-artifact-evaluator-v0",
        "status": "evaluated",
        "createdAt": utc_now(),
        "comparisonAuthority": COMPARISON_AUTHORITY,
        "sourceArtifactManifest": str(manifest_path),
        "artifact": {
            "schema": manifest.get("schema"),
            "identity": manifest.get("identity"),
            "status": manifest.get("status"),
            "artifactAuthority": manifest.get("artifactAuthority"),
            "sourceManifest": manifest.get("sourceManifest"),
            "sourceDataset": manifest.get("sourceDataset"),
            "model": manifest.get("model"),
            "split": manifest.get("split"),
            "tileCount": manifest.get("tileCount"),
            "sampleCount": manifest.get("sampleCount"),
        },
        "backend": {
            "name": BACKEND,
            "numpyVersion": np.__version__,
            "pythonVersion": platform.python_version(),
            "platform": platform.platform(),
        },
        "git": {
            "commit": git_value(["rev-parse", "HEAD"], "unknown"),
            "statusShort": git_value(["status", "--short"], ""),
        },
        "payloadVerification": {
            "verifiedPayloadCount": len(payload_verification),
            "verifiedTileCount": len(tile_rows),
            "payloadKeys": PAYLOAD_KEYS,
            "payloads": payload_verification,
        },
        "metrics": {
            "sampleCount": int(model_errors.size),
            "tileCount": len(tile_rows),
            "targetChannels": channels,
            "model": mse_mae_max(model_errors),
            "identityBaseline": mse_mae_max(identity_errors),
            "residualMagnitude": {
                **mse_mae_max(residual_values),
                "mse": residual_magnitude_mse,
            },
            "improvementVsIdentity": improvement(identity_mse, model_mse),
            "perChannelMetrics": perChannelMetrics,
            "routeReplayMetrics": grouped_metrics(tile_rows, ["routeVariantIdentity", "replayStateIdentity"]),
            "routeMetrics": grouped_metrics(tile_rows, ["routeVariantIdentity"]),
            "replayMetrics": grouped_metrics(tile_rows, ["replayStateIdentity"]),
            "spatialErrorProfile": spatialErrorProfile,
        },
        "tiles": tile_rows,
        "limitation": "Offline held-out field residual artifact evaluation only; this report does not mutate simulator state, rendering, cadence fill, or screen-space output.",
    }
    write_json(out_path, report)
    return report


def failure_report(args: argparse.Namespace, failure: EvaluationFailure) -> dict[str, Any]:
    return {
        "schema": REPORT_SCHEMA,
        "identity": "offline-field-residual-artifact-evaluator-v0",
        "status": "failed",
        "createdAt": utc_now(),
        "comparisonAuthority": COMPARISON_AUTHORITY,
        "sourceArtifactManifest": str(Path(args.artifact_manifest).resolve()) if getattr(args, "artifact_manifest", None) else None,
        "failurePhase": failure.failurePhase,
        "error": str(failure),
        "lastTrustworthyEvidence": failure.evidence,
        "limitation": "Failure report only; no field comparison metrics were produced.",
    }


def main() -> int:
    args = parse_args()
    try:
        evaluate(args)
        return 0
    except EvaluationFailure as failure:
        write_json(Path(args.out).resolve(), failure_report(args, failure))
        print(f"field residual artifact evaluator failed at {failure.failurePhase}: {failure}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
