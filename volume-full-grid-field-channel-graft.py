#!/usr/bin/env python3
"""Graft truth channels into a full-grid predicted field for render-coupling diagnosis."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.full-grid-field-channel-graft.v0"
APPLICATION_SCHEMA = "kaminos.volume.full-grid-field-residual-application.v0"
OUTPUT_APPLICATION_SCHEMA = APPLICATION_SCHEMA
IDENTITY = "full-grid-channel-graft-diagnostic-v0"
APPLICATION_AUTHORITY = "controlled-truth-channel-graft-not-learned-prediction"
FIELD_AUTHORITY = "complete-webgpu-fluid-front-buffer-readback-sidecars"
LIMITATION = "controlled-truth-channel-graft-not-learned-prediction"
FLUID_CHANNELS = [
    "velocityX",
    "velocityY",
    "velocityZ",
    "densityCarrier",
    "smokeDensity",
    "heat",
    "fuel",
    "detail",
    "flame",
    "ember",
    "visibleFireCarrier",
    "combustionFront",
    "microdetail",
    "interfaceShred",
    "fireLick",
    "emberFleck",
]
FRONT_CHANNELS = ["frontTopology"]


class GraftFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application-manifest", required=True, help="Source full-grid residual application manifest.")
    parser.add_argument("--out-dir", required=True, help="Output directory for grafted full-grid sidecars.")
    parser.add_argument(
        "--graft-fluid-channels",
        default="",
        help="Comma-separated fluid channel names to copy from truthHigh into predictedHigh.",
    )
    parser.add_argument("--graft-front", action="store_true", help="Copy truthHigh frontTopology into predictedHigh.")
    parser.add_argument("--chunk-cells", type=int, default=262_144, help="Cells per sidecar copy chunk.")
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


def sidecar_descriptor(path: Path, shape: list[int], channel_order: list[str]) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "dtype": "float32",
        "byteOrder": "little-endian",
        "floatCount": int(math.prod(shape)),
        "byteLength": path.stat().st_size,
        "shape": shape,
        "channelOrder": channel_order,
    }


def verify_sidecar(descriptor: dict[str, Any]) -> Path:
    path = Path(str(descriptor.get("path") or ""))
    if not path.exists():
        raise GraftFailure("sidecar-read", f"Missing sidecar {path}", {"descriptor": descriptor})
    expected_bytes = int(descriptor.get("byteLength") or 0)
    if path.stat().st_size != expected_bytes:
        raise GraftFailure("sidecar-read", f"Sidecar byte length mismatch for {path}", {
            "expectedBytes": expected_bytes,
            "actualBytes": path.stat().st_size,
        })
    expected_sha = descriptor.get("sha256")
    actual_sha = sha256_file(path)
    if expected_sha and expected_sha != actual_sha:
        raise GraftFailure("sidecar-read", f"Sidecar checksum mismatch for {path}", {
            "expectedSha256": expected_sha,
            "actualSha256": actual_sha,
        })
    return path


def parse_channel_names(value: str) -> list[str]:
    names = [name.strip() for name in value.split(",") if name.strip()]
    unknown = [name for name in names if name not in FLUID_CHANNELS]
    if unknown:
        raise GraftFailure("args", "Unknown fluid channels requested for graft.", {
            "unknown": unknown,
            "known": FLUID_CHANNELS,
        })
    return list(dict.fromkeys(names))


def write_failure(out_path: Path, phase: str, error: Exception, evidence: dict[str, Any] | None = None) -> None:
    payload = {
        "schema": SCHEMA,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
        "limitation": LIMITATION,
    }
    if isinstance(error, GraftFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.evidence
    write_json(out_path, payload)


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    manifest_out = out_dir / "manifest.json"
    phase = "args"
    evidence: dict[str, Any] = {}
    try:
        grafted_channels = parse_channel_names(str(args.graft_fluid_channels))
        grafted_indexes = [FLUID_CHANNELS.index(name) for name in grafted_channels]
        out_dir.mkdir(parents=True, exist_ok=True)

        phase = "application-read"
        source_path = Path(args.application_manifest).resolve()
        source = read_json(source_path)
        if source.get("schema") != APPLICATION_SCHEMA:
            raise GraftFailure("application-read", f"Application schema mismatch: {source.get('schema')}")
        high_grid = int(source["highGrid"])
        high_cells = high_grid ** 3
        roles = source["roles"]
        evidence = {
            "sourceApplicationManifest": str(source_path),
            "highGrid": high_grid,
            "graftedFluidChannels": grafted_channels,
            "graftedFrontTopology": bool(args.graft_front),
        }

        phase = "sidecar-read"
        predicted_fluid_path = verify_sidecar(roles["predictedHigh"]["fluid"])
        predicted_front_path = verify_sidecar(roles["predictedHigh"]["front"])
        truth_fluid_path = verify_sidecar(roles["truthHigh"]["fluid"])
        truth_front_path = verify_sidecar(roles["truthHigh"]["front"])

        phase = "sidecar-write"
        out_fluid_path = out_dir / "predictedHigh-fluid.f32"
        out_front_path = out_dir / "predictedHigh-front.f32"
        for path in [out_fluid_path, out_front_path]:
            path.write_bytes(b"")

        predicted_fluid = np.memmap(predicted_fluid_path, dtype="<f4", mode="r", shape=(high_cells, len(FLUID_CHANNELS)))
        truth_fluid = np.memmap(truth_fluid_path, dtype="<f4", mode="r", shape=(high_cells, len(FLUID_CHANNELS)))
        chunk_cells = max(1, int(args.chunk_cells))
        fluid_chunks = []
        with out_fluid_path.open("ab") as handle:
            for start in range(0, high_cells, chunk_cells):
                end = min(high_cells, start + chunk_cells)
                chunk = np.array(predicted_fluid[start:end], dtype="<f4", copy=True)
                if grafted_indexes:
                    chunk[:, grafted_indexes] = truth_fluid[start:end, grafted_indexes]
                chunk.tofile(handle)
                fluid_chunks.append({"cellStart": start, "cellEnd": end, "cellCount": end - start})

        if args.graft_front:
            truth_front = np.memmap(truth_front_path, dtype="<f4", mode="r", shape=(high_cells,))
            with out_front_path.open("ab") as handle:
                for start in range(0, high_cells, chunk_cells):
                    end = min(high_cells, start + chunk_cells)
                    np.asarray(truth_front[start:end], dtype="<f4").tofile(handle)
        else:
            predicted_front = np.memmap(predicted_front_path, dtype="<f4", mode="r", shape=(high_cells,))
            with out_front_path.open("ab") as handle:
                for start in range(0, high_cells, chunk_cells):
                    end = min(high_cells, start + chunk_cells)
                    np.asarray(predicted_front[start:end], dtype="<f4").tofile(handle)

        expected_fluid_bytes = high_cells * len(FLUID_CHANNELS) * 4
        expected_front_bytes = high_cells * 4
        if out_fluid_path.stat().st_size != expected_fluid_bytes or out_front_path.stat().st_size != expected_front_bytes:
            raise GraftFailure("sidecar-write", "Grafted sidecar byte length mismatch.", {
                "fluidBytes": out_fluid_path.stat().st_size,
                "frontBytes": out_front_path.stat().st_size,
                "expectedFluidBytes": expected_fluid_bytes,
                "expectedFrontBytes": expected_front_bytes,
            })

        phase = "manifest-write"
        high_shape_fluid = [high_grid, high_grid, high_grid, len(FLUID_CHANNELS)]
        high_shape_front = [high_grid, high_grid, high_grid, 1]
        diagnostic = {
            "schema": SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": IDENTITY,
            "applicationAuthority": APPLICATION_AUTHORITY,
            "sourceApplicationManifest": str(source_path),
            "sourceApplicationManifestSha256": sha256_file(source_path),
            "graftedFluidChannels": grafted_channels,
            "graftedFluidChannelIndexes": grafted_indexes,
            "graftedFrontTopology": bool(args.graft_front),
            "limitation": LIMITATION,
        }
        manifest = {
            "schema": OUTPUT_APPLICATION_SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": "full-grid-channel-graft-application-sidecars-v0",
            "applicationAuthority": APPLICATION_AUTHORITY,
            "fieldAuthority": FIELD_AUTHORITY,
            "completeFieldCoverage": True,
            "fitOnSamePairVisualDiagnostic": True,
            "pairManifest": source.get("pairManifest"),
            "pairManifestSha256": source.get("pairManifestSha256"),
            "routeIdentity": source.get("routeIdentity"),
            "effectiveRoute": source.get("effectiveRoute"),
            "prototypeIdentity": source.get("prototypeIdentity"),
            "backend": source.get("backend"),
            "deterministicReplay": source.get("deterministicReplay"),
            "lowGrid": source.get("lowGrid"),
            "highGrid": high_grid,
            "gridScaleRatio": source.get("gridScaleRatio"),
            "model": {
                "identity": IDENTITY,
                "sourceModel": source.get("model"),
                "channelGraft": diagnostic,
                "limitation": LIMITATION,
            },
            "roles": {
                "lowUpsampled": roles["lowUpsampled"],
                "predictedHigh": {
                    "role": "predictedHigh",
                    "fluid": sidecar_descriptor(out_fluid_path, high_shape_fluid, FLUID_CHANNELS),
                    "front": sidecar_descriptor(out_front_path, high_shape_front, FRONT_CHANNELS),
                },
                "truthHigh": roles["truthHigh"],
            },
            "applicationChunks": {
                "chunkCells": chunk_cells,
                "chunks": fluid_chunks,
            },
            "limitations": [
                LIMITATION,
                "Output preserves full-grid render compatibility but is not a learned model result.",
                "Use only to identify which truth channel groups unlock renderer-visible fire.",
            ],
        }
        write_json(manifest_out, manifest)
        write_json(out_dir / "channel-graft-diagnostic.json", diagnostic)
        print(json.dumps({
            "ok": True,
            "manifest": str(manifest_out),
            "diagnostic": str(out_dir / "channel-graft-diagnostic.json"),
            "graftedFluidChannels": grafted_channels,
            "graftedFrontTopology": bool(args.graft_front),
        }, indent=2))
        return 0
    except Exception as error:
        write_failure(manifest_out, phase, error, evidence)
        print(f"full-grid channel graft failed at {phase}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
