#!/usr/bin/env python3
"""Filter an exact high-grid export into a canonical coarse receiver state."""

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
OUTPUT_SCHEMA = "kaminos.volume.coarse-receiver-initial.v0"
OUTPUT_IDENTITY = "filtered-high-coarse-receiver-initial-v0"
INITIALIZATION_AUTHORITY = "receiver-initialized-from-filtered-high-t-v0"
FILTER_IDENTITY = "volume-overlap-box-filter-high-to-receiver-v0"
LAYOUT_IDENTITY = "x-fastest-zyx-c-interleaved-v0"
ROUTE_IDENTITY = "native-3d-compute-fluid-raymarch-v0"
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier", "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront", "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
FRONT_CHANNELS = ["frontTopology"]


class InitializerFailure(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise InitializerFailure(message)


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


def high_sim_step(manifest: dict[str, Any]) -> int:
    replay = manifest.get("deterministicReplay") or {}
    step = replay.get("simStepCount", replay.get("completedSteps"))
    require(isinstance(step, (int, float)) and int(step) >= 0, "source deterministic replay sim step is missing")
    return int(step)


def validate_artifact(
    artifact: dict[str, Any],
    grid: int,
    channel_order: list[str],
    label: str,
) -> dict[str, Any]:
    require(isinstance(artifact, dict), f"{label} artifact is missing")
    path = Path(str(artifact.get("path", ""))).expanduser().resolve()
    shape = [grid, grid, grid, len(channel_order)]
    expected_bytes = math.prod(shape) * np.dtype("<f4").itemsize
    require(path.is_file(), f"{label} artifact is missing: {path}")
    require(artifact.get("shape") == shape, f"{label} shape mismatch: {artifact.get('shape')} != {shape}")
    require(artifact.get("channelOrder") == channel_order, f"{label} channel order mismatch")
    require(artifact.get("dtype") in ("float32", "float32-le"), f"{label} dtype must be float32")
    require(artifact.get("byteOrder", "little-endian") == "little-endian", f"{label} byte order must be little-endian")
    require(int(artifact.get("byteLength", -1)) == expected_bytes, f"{label} byteLength mismatch")
    require(path.stat().st_size == expected_bytes, f"{label} file size mismatch")
    actual_sha256 = sha256_file(path)
    require(actual_sha256 == artifact.get("sha256"), f"{label} sha256 mismatch: {actual_sha256} != {artifact.get('sha256')}")
    return {
        "path": path,
        "shape": shape,
        "channelOrder": channel_order,
        "byteLength": expected_bytes,
        "sha256": actual_sha256,
    }


def load_array(artifact: dict[str, Any]) -> np.ndarray:
    values = np.fromfile(artifact["path"], dtype="<f4")
    require(values.size == math.prod(artifact["shape"]), f"array element count mismatch for {artifact['path']}")
    require(bool(np.isfinite(values).all()), f"non-finite values in {artifact['path']}")
    return values.reshape(artifact["shape"])


def overlap_weights(source_grid: int, receiver_grid: int) -> np.ndarray:
    weights = np.zeros((receiver_grid, source_grid), dtype=np.float64)
    source_width = source_grid / receiver_grid
    for receiver in range(receiver_grid):
        start = receiver * source_width
        end = (receiver + 1) * source_width
        first = max(0, int(math.floor(start)))
        last = min(source_grid - 1, int(math.ceil(end) - 1))
        for source in range(first, last + 1):
            overlap = max(0.0, min(end, source + 1.0) - max(start, float(source)))
            weights[receiver, source] = overlap / source_width
    require(bool(np.allclose(weights.sum(axis=1), 1.0, atol=1e-12)), "volume-overlap weights do not conserve constants")
    return weights


def volume_filter(values: np.ndarray, receiver_grid: int) -> np.ndarray:
    source_grid = int(values.shape[0])
    require(values.shape[0] == values.shape[1] == values.shape[2], "source field must use a cubic grid")
    require(source_grid >= receiver_grid > 0, "receiver grid must be positive and no larger than high grid")
    weights = overlap_weights(source_grid, receiver_grid)
    filtered = np.empty((receiver_grid, receiver_grid, receiver_grid, values.shape[3]), dtype=np.float32)
    for channel in range(values.shape[3]):
        source = values[:, :, :, channel].astype(np.float64, copy=False)
        along_x = np.tensordot(source, weights.T, axes=([2], [0]))
        along_y = np.tensordot(weights, along_x, axes=([1], [1])).transpose(1, 0, 2)
        along_z = np.tensordot(weights, along_y, axes=([1], [0]))
        filtered[:, :, :, channel] = along_z.astype(np.float32)
    return filtered


def write_array(path: Path, values: np.ndarray, channel_order: list[str]) -> dict[str, Any]:
    contiguous = np.ascontiguousarray(values, dtype="<f4")
    contiguous.tofile(path)
    return {
        "path": str(path),
        "shape": list(contiguous.shape),
        "channelOrder": channel_order,
        "dtype": "float32-le",
        "byteOrder": "little-endian",
        "floatCount": int(contiguous.size),
        "byteLength": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def validate_source(manifest: dict[str, Any]) -> dict[str, Any]:
    require(manifest.get("schema") == SOURCE_SCHEMA, f"source schema mismatch: {manifest.get('schema')}")
    require(manifest.get("status") == "captured", f"source status must be captured: {manifest.get('status')}")
    require(manifest.get("failurePhase") is None, "source manifest carries a failure phase")
    require(manifest.get("completeFieldCoverage") is True, "source export is not full-field")
    require(manifest.get("routeIdentity") == ROUTE_IDENTITY, "source route identity mismatch")
    require(manifest.get("effectiveRoute") == ROUTE_IDENTITY, "source effective route mismatch")
    require(bool(manifest.get("backend")), "source backend is missing")
    require(int(manifest.get("fluidComponents", 0)) == len(FLUID_CHANNELS), "source fluid component count mismatch")
    require(manifest.get("fluidChannelOrder") == FLUID_CHANNELS, "source fluid channel order mismatch")
    require(manifest.get("frontChannelOrder") == FRONT_CHANNELS, "source front channel order mismatch")
    grid = int(manifest.get("grid", 0))
    require(grid > 0, "source grid is invalid")
    source_capture = manifest.get("sourceCapture") or {}
    require(bool(source_capture.get("identity")), "source basin identity is missing")
    require(isinstance(source_capture.get("payloadSha256"), str) and len(source_capture["payloadSha256"]) == 64, "source basin SHA-256 is missing")
    require(source_capture.get("hashMatches") is True, "source basin hash is not verified")
    sidecars = manifest.get("sidecars") or {}
    return {
        "grid": grid,
        "step": high_sim_step(manifest),
        "fluid": validate_artifact(sidecars.get("fluid"), grid, FLUID_CHANNELS, "source fluid"),
        "front": validate_artifact(sidecars.get("front"), grid, FRONT_CHANNELS, "source front"),
        "route": {"requested": manifest["routeIdentity"], "effective": manifest["effectiveRoute"], "backend": manifest["backend"]},
        "basin": {"identity": source_capture["identity"], "sha256": source_capture["payloadSha256"]},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-manifest", required=True)
    parser.add_argument("--receiver-grid", required=True, type=int)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--report")
    args = parser.parse_args()

    source_path = Path(args.source_manifest).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve() if args.report else out_dir / "manifest.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    failure_phase = "source-manifest-read"
    last_trustworthy_evidence: dict[str, Any] = {}
    try:
        source_bytes = source_path.read_bytes()
        source_manifest_sha256 = sha256_bytes(source_bytes)
        last_trustworthy_evidence = {"sourceManifest": str(source_path), "sourceManifestSha256": source_manifest_sha256}
        source_manifest = json.loads(source_bytes)
        failure_phase = "source-validation"
        source = validate_source(source_manifest)
        require(source["grid"] >= args.receiver_grid > 0, "receiver grid must be positive and no larger than source grid")
        last_trustworthy_evidence.update({
            "sourceGrid": source["grid"],
            "sourceHighSimStepCount": source["step"],
            "receiverGrid": args.receiver_grid,
            "route": source["route"],
            "basin": source["basin"],
        })
        failure_phase = "volume-overlap-filter"
        receiver_fluid = volume_filter(load_array(source["fluid"]), args.receiver_grid)
        receiver_front = volume_filter(load_array(source["front"]), args.receiver_grid)
        failure_phase = "receiver-artifact-write"
        fluid_artifact = write_array(out_dir / "receiver-initial.fluid.f32", receiver_fluid, FLUID_CHANNELS)
        front_artifact = write_array(out_dir / "receiver-initial.front.f32", receiver_front, FRONT_CHANNELS)
        report = {
            "schema": OUTPUT_SCHEMA,
            "identity": OUTPUT_IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "initializationAuthority": INITIALIZATION_AUTHORITY,
            "filterIdentity": FILTER_IDENTITY,
            "layoutIdentity": LAYOUT_IDENTITY,
            "runtimeTruthAvailable": False,
            "source": {
                "manifestPath": str(source_path),
                "manifestSha256": source_manifest_sha256,
                "basin": source["basin"],
                "route": source["route"],
                "grid": source["grid"],
                "highSimStepCount": source["step"],
                "fluidSha256": source["fluid"]["sha256"],
                "frontSha256": source["front"]["sha256"],
            },
            "receiver": {
                "grid": args.receiver_grid,
                "initialSimStepCount": 0,
                "fluid": fluid_artifact,
                "front": front_artifact,
            },
            "doesNotProve": [
                "A learned model can predict this receiver initialization.",
                "High-grid truth is available at product runtime.",
                "The initialized receiver remains close after an ordinary simulation step.",
            ],
        }
        write_json(report_path, report)
        print(json.dumps({"ok": True, "report": str(report_path), "receiverGrid": args.receiver_grid}, indent=2))
        return 0
    except Exception as error:
        write_json(report_path, {
            "schema": OUTPUT_SCHEMA,
            "identity": OUTPUT_IDENTITY,
            "status": "failed",
            "failurePhase": failure_phase,
            "reason": str(error),
            "initializationAuthority": INITIALIZATION_AUTHORITY,
            "filterIdentity": FILTER_IDENTITY,
            "lastTrustworthyEvidence": last_trustworthy_evidence,
        })
        print(json.dumps({"ok": False, "report": str(report_path), "failurePhase": failure_phase, "reason": str(error)}, indent=2), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
