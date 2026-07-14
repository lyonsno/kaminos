#!/usr/bin/env python3
"""Pack one exact high replay frame into a phase-aligned model pair and held render roles."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SOURCE_SCHEMA = "kaminos.volume.full-grid-field-export.v0"
PAIR_SCHEMA = "kaminos.volume.full-grid-field-pair.v0"
PAIR_IDENTITY = "phase-aligned-exact-basin-field-pair-v0"
PAIR_AUTHORITY = "downsampled-same-high-history-input-to-exact-high-target"
HELD_SCHEMA = "kaminos.volume.phase-aligned-held-field.v0"
HELD_IDENTITY = "phase-aligned-held-field-render-role-v0"
TRUTH_AUTHORITY = "offline-high-truth-held-render-only-v0"
LOW_AUTHORITY = "downsampled-same-high-history-held-control-v0"
BOX_AVERAGE = "box-average-linear-field-v0"
MAX_POOL = "max-pool-support-field-v0"
ROUTE = "native-3d-compute-fluid-raymarch-v0"
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier", "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront", "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
FRONT_CHANNELS = ["frontTopology"]


class PairFailure(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PairFailure(message)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def resolve_artifact(raw: str, manifest_path: Path) -> Path:
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def validate_artifact(
    descriptor: dict[str, Any], manifest_path: Path, grid: int, channels: list[str], label: str,
) -> tuple[Path, dict[str, Any]]:
    require(isinstance(descriptor, dict), f"{label} descriptor is missing")
    path = resolve_artifact(str(descriptor.get("path") or ""), manifest_path)
    expected_shape = [grid, grid, grid, len(channels)]
    expected_bytes = math.prod(expected_shape) * 4
    require(path.is_file(), f"{label} artifact is missing: {path}")
    require(descriptor.get("shape") == expected_shape, f"{label} shape mismatch")
    require(descriptor.get("channelOrder") == channels, f"{label} channel order mismatch")
    require(descriptor.get("dtype") in ("float32", "float32-le"), f"{label} dtype mismatch")
    require(descriptor.get("byteOrder", "little-endian") == "little-endian", f"{label} byte order mismatch")
    require(int(descriptor.get("byteLength", -1)) == expected_bytes, f"{label} byte length mismatch")
    require(path.stat().st_size == expected_bytes, f"{label} file size mismatch")
    actual_sha = sha256_file(path)
    require(actual_sha == descriptor.get("sha256"), f"{label} sha256 mismatch")
    return path, {
        **descriptor,
        "path": str(path),
        "sha256": actual_sha,
        "shape": expected_shape,
        "channelOrder": channels,
        "byteLength": expected_bytes,
    }


def axis_overlap_weights(source_grid: int, target_grid: int) -> list[tuple[np.ndarray, np.ndarray]]:
    scale = float(source_grid) / float(target_grid)
    weights: list[tuple[np.ndarray, np.ndarray]] = []
    for target_index in range(target_grid):
        start = target_index * scale
        stop = (target_index + 1) * scale
        first = max(0, int(math.floor(start)))
        last = min(source_grid, int(math.ceil(stop)))
        indexes = np.arange(first, last, dtype=np.int64)
        overlap = np.minimum(stop, indexes.astype(np.float64) + 1.0) - np.maximum(start, indexes.astype(np.float64))
        overlap = np.maximum(overlap, 0.0)
        total = float(overlap.sum())
        require(indexes.size > 0 and total > 0.0, "empty resampling footprint")
        weights.append((indexes, (overlap / total).astype(np.float32)))
    return weights


def resample_axis_mean(values: np.ndarray, weights: list[tuple[np.ndarray, np.ndarray]], axis: int) -> np.ndarray:
    moved = np.moveaxis(values, axis, 0)
    output = np.empty((len(weights), *moved.shape[1:]), dtype=np.float32)
    for target_index, (indexes, weight) in enumerate(weights):
        output[target_index] = np.tensordot(weight, moved[indexes], axes=(0, 0)).astype(np.float32)
    return np.moveaxis(output, 0, axis)


def resample_axis_max(values: np.ndarray, weights: list[tuple[np.ndarray, np.ndarray]], axis: int) -> np.ndarray:
    moved = np.moveaxis(values, axis, 0)
    output = np.empty((len(weights), *moved.shape[1:]), dtype=np.float32)
    for target_index, (indexes, _weight) in enumerate(weights):
        output[target_index] = moved[indexes].max(axis=0)
    return np.moveaxis(output, 0, axis)


def downsample(values: np.ndarray, target_grid: int, operator: str) -> np.ndarray:
    source_grid = int(values.shape[0])
    require(values.ndim == 4 and values.shape[0] == values.shape[1] == values.shape[2], "source field must be cubic 4D")
    require(0 < target_grid < source_grid, "low grid must be positive and smaller than high grid")
    if source_grid % target_grid == 0:
        factor = source_grid // target_grid
        view = values.reshape(target_grid, factor, target_grid, factor, target_grid, factor, values.shape[3])
        reducer = np.max if operator == MAX_POOL else np.mean
        return reducer(view, axis=(1, 3, 5)).astype(np.float32)
    weights = axis_overlap_weights(source_grid, target_grid)
    resampler = resample_axis_max if operator == MAX_POOL else resample_axis_mean
    output = resampler(values, weights, 0)
    output = resampler(output, weights, 1)
    output = resampler(output, weights, 2)
    return output.astype(np.float32)


def write_array(
    path: Path, values: np.ndarray, channels: list[str], operator: str | None = None, source_sha: str | None = None,
) -> dict[str, Any]:
    contiguous = np.ascontiguousarray(values, dtype="<f4")
    contiguous.tofile(path)
    descriptor: dict[str, Any] = {
        "path": str(path),
        "sha256": sha256_file(path),
        "dtype": "float32-le",
        "byteOrder": "little-endian",
        "shape": list(contiguous.shape),
        "channelOrder": channels,
        "floatCount": int(contiguous.size),
        "byteLength": int(path.stat().st_size),
    }
    if operator:
        descriptor["downsampleOperator"] = operator
    if source_sha:
        descriptor["sourceSha256"] = source_sha
    return descriptor


def held_manifest(
    role: str,
    authority: str,
    runtime_truth: bool,
    grid: int,
    fluid: dict[str, Any],
    front: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema": HELD_SCHEMA,
        "identity": HELD_IDENTITY,
        "status": "captured",
        "failurePhase": None,
        "role": role,
        "initializationAuthority": authority,
        "runtimeTruthAvailable": runtime_truth,
        "renderOnly": True,
        "layoutIdentity": "x-fastest-zyx-c-interleaved-v0",
        "source": source,
        "receiver": {
            "grid": grid,
            "initialSimStepCount": 0,
            "fluid": fluid,
            "front": front,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--high-manifest", required=True)
    parser.add_argument("--low-grid", required=True, type=int)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    high_manifest_path = Path(args.high_manifest).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    pair_path = out_dir / "pair-manifest.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    phase = "manifest-read"
    evidence: dict[str, Any] = {}
    try:
        high_bytes = high_manifest_path.read_bytes()
        high_manifest_sha = sha256_bytes(high_bytes)
        evidence = {"sourceManifestPath": str(high_manifest_path), "sourceManifestSha256": high_manifest_sha}
        high = json.loads(high_bytes)
        phase = "source-validation"
        require(high.get("schema") == SOURCE_SCHEMA, "high source schema mismatch")
        require(high.get("status") == "captured" and high.get("failurePhase") is None, "high source is not captured")
        require(high.get("completeFieldCoverage") is True, "high source lacks complete field coverage")
        require(high.get("routeIdentity") == ROUTE and high.get("effectiveRoute") == ROUTE, "high source route mismatch")
        require(bool(high.get("backend")), "high source backend is missing")
        high_grid = int(high.get("grid") or 0)
        require(0 < args.low_grid < high_grid, "low grid must be positive and smaller than high grid")
        require(high.get("fluidChannelOrder") == FLUID_CHANNELS, "high fluid channel order mismatch")
        require(high.get("frontChannelOrder") == FRONT_CHANNELS, "high front channel order mismatch")
        source_capture = high.get("sourceCapture") or {}
        require(source_capture.get("hashMatches") is True, "source capture hash is unverified")
        source_sha = str(source_capture.get("payloadSha256") or "")
        require(len(source_sha) == 64, "exact basin source SHA-256 is missing")
        replay = high.get("deterministicReplay") or {}
        require(replay.get("identity") == "deterministic-replay-same-route-controls-fixed-step-v0", "replay identity mismatch")
        require(int(replay.get("completedSteps", -1)) == int(replay.get("simStepCount", -2)), "replay step counts disagree")
        require(replay.get("effectiveRoute") == ROUTE, "replay effective route mismatch")
        require(bool(replay.get("controlsSignature")), "replay controls signature is missing")
        high_fluid_path, high_fluid = validate_artifact(high.get("sidecars", {}).get("fluid"), high_manifest_path, high_grid, FLUID_CHANNELS, "high fluid")
        high_front_path, high_front = validate_artifact(high.get("sidecars", {}).get("front"), high_manifest_path, high_grid, FRONT_CHANNELS, "high front")
        evidence.update({"highGrid": high_grid, "lowGrid": args.low_grid, "sourceCaptureSha256": source_sha, "simulationStep": replay["completedSteps"]})

        phase = "downsample"
        high_fluid_values = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_grid, high_grid, high_grid, len(FLUID_CHANNELS)))
        high_front_values = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_grid, high_grid, high_grid, 1))
        low_fluid_values = downsample(high_fluid_values, args.low_grid, BOX_AVERAGE)
        low_front_values = downsample(high_front_values, args.low_grid, MAX_POOL)

        phase = "artifact-write"
        low_fluid = write_array(out_dir / "low-phase-aligned.fluid.f32", low_fluid_values, FLUID_CHANNELS, BOX_AVERAGE, high_fluid["sha256"])
        low_front = write_array(out_dir / "low-phase-aligned.front.f32", low_front_values, FRONT_CHANNELS, MAX_POOL, high_front["sha256"])
        source = {
            "highManifestPath": str(high_manifest_path),
            "highManifestSha256": high_manifest_sha,
            "exactBasinSourceCaptureSha256": source_sha,
            "deterministicReplay": replay,
            "routeIdentity": high["routeIdentity"],
            "effectiveRoute": high["effectiveRoute"],
            "backend": high["backend"],
        }
        pair = {
            "schema": PAIR_SCHEMA,
            "identity": PAIR_IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "authority": PAIR_AUTHORITY,
            "lowGrid": args.low_grid,
            "highGrid": high_grid,
            "source": source,
            "low": {"fluid": low_fluid, "front": low_front},
            "high": {"fluid": high_fluid, "front": high_front},
        }
        write_json(pair_path, pair)
        write_json(out_dir / "truth-high-held-manifest.json", held_manifest(
            "truthHigh", TRUTH_AUTHORITY, True, high_grid, high_fluid, high_front, source,
        ))
        write_json(out_dir / "low-phase-aligned-held-manifest.json", held_manifest(
            "lowPhaseAligned", LOW_AUTHORITY, False, args.low_grid, low_fluid, low_front, source,
        ))
        print(json.dumps({"ok": True, "pairManifest": str(pair_path), "highGrid": high_grid, "lowGrid": args.low_grid}, indent=2))
        return 0
    except Exception as error:
        write_json(pair_path, {
            "schema": PAIR_SCHEMA,
            "identity": PAIR_IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "error": str(error),
            "lastTrustworthyEvidence": evidence,
        })
        print(json.dumps({"ok": False, "manifest": str(pair_path), "failurePhase": phase, "error": str(error)}, indent=2), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
