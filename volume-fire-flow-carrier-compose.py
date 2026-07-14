#!/usr/bin/env python3
"""Compose a dense fire-flow carrier residual into low-upsampled fireLick only."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.fire-flow-carrier-composition.v0"
IDENTITY = "low-upsampled-plus-fire-flow-carrier-fire-lick-v0"
COMPOSITION_AUTHORITY = "frozen-fire-flow-carrier-fire-lick-composition-v0"
POLICY_IDENTITY = "positive-carrier-residual-to-fire-lick-v0"
PAIR_SCHEMA = "kaminos.volume.full-grid-field-pair.v0"
TRANSFER_SCHEMA = "kaminos.volume.fire-flow-carrier-frozen-transfer.v0"
CARRIER_CHANNEL = "fireFlowVisibilityCarrier"
TARGET_CHANNEL = "fireLick"
TARGET_CHANNEL_INDEX = 14
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
ALLOWED_ROLES = {"lowDerived", "truthHigh", "frozenConstant"}


class CompositionFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True)
    parser.add_argument("--carrier-manifest", required=True)
    parser.add_argument("--carrier-role", required=True)
    parser.add_argument("--gain", required=True, type=float)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manifest")
    parser.add_argument("--batch-cells", type=int, default=65_536)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def resolve_artifact_path(raw: str, manifest_path: Path) -> Path:
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def verify_descriptor(
    descriptor: dict[str, Any],
    manifest_path: Path,
    phase: str,
    label: str,
    shape: list[int],
    channels: list[str],
) -> Path:
    path = resolve_artifact_path(str(descriptor.get("path") or ""), manifest_path)
    if not path.exists():
        raise CompositionFailure(phase, f"missing {label}: {path}", {"descriptor": descriptor})
    if descriptor.get("shape") != shape:
        raise CompositionFailure(phase, f"{label} shape mismatch", {
            "expected": shape, "actual": descriptor.get("shape"),
        })
    if descriptor.get("channelOrder") != channels:
        raise CompositionFailure(phase, f"{label} channel order mismatch", {
            "expected": channels, "actual": descriptor.get("channelOrder"),
        })
    expected_bytes = int(descriptor.get("byteLength") or 0)
    actual_bytes = path.stat().st_size
    if actual_bytes != expected_bytes:
        raise CompositionFailure(phase, f"{label} byte length mismatch", {
            "expectedBytes": expected_bytes, "actualBytes": actual_bytes,
        })
    expected_sha = str(descriptor.get("sha256") or "")
    actual_sha = sha256_file(path)
    if not expected_sha or expected_sha != actual_sha:
        raise CompositionFailure(phase, f"{label} SHA-256 mismatch", {
            "expectedSha256": expected_sha, "actualSha256": actual_sha,
        })
    return path


def artifact_descriptor(path: Path, shape: list[int], channels: list[str]) -> dict[str, Any]:
    float_count = int(np.prod(shape, dtype=np.int64))
    return {
        "path": str(path),
        "shape": shape,
        "channelOrder": channels,
        "dtype": "float32-le",
        "byteOrder": "little-endian",
        "floatCount": float_count,
        "byteLength": float_count * 4,
        "sha256": sha256_file(path),
    }


def fail_manifest(path: Path, phase: str, error: Exception, evidence: dict[str, Any] | None = None) -> None:
    if isinstance(error, CompositionFailure):
        phase = error.phase
        evidence = error.evidence
    write_json(path, {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = Path(args.manifest).resolve() if args.manifest else out_dir / "manifest.json"
    phase = "manifest-validation"
    evidence: dict[str, Any] = {}
    try:
        pair_path = Path(args.pair_manifest).resolve()
        carrier_path = Path(args.carrier_manifest).resolve()
        pair = json.loads(pair_path.read_text())
        carrier = json.loads(carrier_path.read_text())
        if pair.get("schema") != PAIR_SCHEMA or pair.get("status") != "captured" or pair.get("failurePhase") is not None:
            raise CompositionFailure(phase, "pair manifest is not a captured full-grid pair")
        if carrier.get("schema") != TRANSFER_SCHEMA or carrier.get("status") != "captured" or carrier.get("failurePhase") is not None:
            raise CompositionFailure(phase, "carrier manifest is not a captured frozen transfer")
        role = str(args.carrier_role)
        if role not in ALLOWED_ROLES:
            raise CompositionFailure(phase, f"unsupported carrier role: {role}", {"allowedRoles": sorted(ALLOWED_ROLES)})
        gain = float(args.gain)
        if not math.isfinite(gain) or gain < 0:
            raise CompositionFailure(phase, "gain must be finite and nonnegative", {"gain": args.gain})
        low_grid = int(pair.get("lowGrid") or 0)
        high_grid = int(pair.get("highGrid") or 0)
        if low_grid < 1 or high_grid <= low_grid:
            raise CompositionFailure(phase, "invalid low/high grid relationship", {
                "lowGrid": low_grid, "highGrid": high_grid,
            })
        pair_sha = sha256_file(pair_path)
        carrier_pair = carrier.get("target", {}).get("pairManifest", {})
        if str(carrier_pair.get("sha256") or "") != pair_sha:
            raise CompositionFailure(phase, "carrier was evaluated against a different pair manifest", {
                "pairManifestSha256": pair_sha,
                "carrierPairManifestSha256": carrier_pair.get("sha256"),
            })
        if (int(carrier.get("target", {}).get("lowGrid") or 0), int(carrier.get("target", {}).get("highGrid") or 0)) != (low_grid, high_grid):
            raise CompositionFailure(phase, "carrier grid relationship differs from pair")
        evidence = {
            "pairManifestSha256": pair_sha,
            "carrierManifestSha256": sha256_file(carrier_path),
            "carrierRole": role,
            "lowGrid": low_grid,
            "highGrid": high_grid,
        }

        phase = "artifact-validation"
        low_cells = low_grid ** 3
        high_cells = high_grid ** 3
        low_fluid_path = verify_descriptor(
            pair["low"]["fluid"], pair_path, phase, "low fluid",
            [low_grid, low_grid, low_grid, 16], FLUID_CHANNELS,
        )
        low_front_path = verify_descriptor(
            pair["low"]["front"], pair_path, phase, "low front",
            [low_grid, low_grid, low_grid, 1], ["frontTopology"],
        )
        dense = carrier.get("denseDerivedTargets", {}).get(CARRIER_CHANNEL, {})
        low_carrier_descriptor = dense.get("lowDerived") or {}
        role_descriptor = dense.get(role) or {}
        low_carrier_path = verify_descriptor(
            low_carrier_descriptor, carrier_path, phase, "low-derived carrier",
            [high_grid, high_grid, high_grid, 1], [CARRIER_CHANNEL],
        )
        role_carrier_path = verify_descriptor(
            role_descriptor, carrier_path, phase, f"{role} carrier",
            [high_grid, high_grid, high_grid, 1], [CARRIER_CHANNEL],
        )

        phase = "composition-write"
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, 16))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        low_carrier = np.memmap(low_carrier_path, dtype="<f4", mode="r", shape=(high_cells,))
        role_carrier = np.memmap(role_carrier_path, dtype="<f4", mode="r", shape=(high_cells,))
        output_fluid_path = out_dir / "carrier-composed.fluid.f32"
        output_front_path = out_dir / "carrier-composed.front.f32"
        output_fluid = np.memmap(output_fluid_path, dtype="<f4", mode="w+", shape=(high_cells, 16))
        output_front = np.memmap(output_front_path, dtype="<f4", mode="w+", shape=(high_cells,))
        batch_cells = max(1, int(args.batch_cells))
        positive_count = 0
        suppressed_negative_count = 0
        residual_sum = 0.0
        residual_max = 0.0
        changed_count = 0
        unchanged_mismatch_count = 0
        front_mismatch_count = 0
        ratio = high_grid / low_grid
        unchanged_indexes = np.asarray([index for index in range(16) if index != TARGET_CHANNEL_INDEX], dtype=np.int64)
        for start in range(0, high_cells, batch_cells):
            end = min(high_cells, start + batch_cells)
            indexes = np.arange(start, end, dtype=np.int64)
            x = indexes % high_grid
            y = (indexes // high_grid) % high_grid
            z = indexes // (high_grid * high_grid)
            lx = np.minimum(low_grid - 1, np.floor(x / ratio).astype(np.int64))
            ly = np.minimum(low_grid - 1, np.floor(y / ratio).astype(np.int64))
            lz = np.minimum(low_grid - 1, np.floor(z / ratio).astype(np.int64))
            low_indexes = lx + ly * low_grid + lz * low_grid * low_grid
            base = np.asarray(low_fluid[low_indexes], dtype=np.float32)
            output_fluid[start:end] = base
            output_front[start:end] = low_front[low_indexes]
            raw_residual = np.asarray(role_carrier[start:end] - low_carrier[start:end], dtype=np.float32)
            positive = np.maximum(raw_residual, np.float32(0.0))
            applied = positive * np.float32(gain)
            output_fluid[start:end, TARGET_CHANNEL_INDEX] = base[:, TARGET_CHANNEL_INDEX] + applied
            positive_count += int(np.count_nonzero(positive > 0))
            suppressed_negative_count += int(np.count_nonzero(raw_residual < 0))
            changed_count += int(np.count_nonzero(applied != 0))
            residual_sum += float(np.sum(applied, dtype=np.float64))
            residual_max = max(residual_max, float(np.max(applied, initial=np.float32(0))))
            unchanged_mismatch_count += int(np.count_nonzero(output_fluid[start:end, unchanged_indexes] != base[:, unchanged_indexes]))
            front_mismatch_count += int(np.count_nonzero(output_front[start:end] != low_front[low_indexes]))
        output_fluid.flush()
        output_front.flush()
        del output_fluid
        del output_front
        if unchanged_mismatch_count != 0 or front_mismatch_count != 0:
            raise CompositionFailure("unchanged-field-verification", "composition mutated fields outside fireLick", {
                "unchangedFluidMismatchCount": unchanged_mismatch_count,
                "frontMismatchCount": front_mismatch_count,
            })

        phase = "manifest-write"
        fluid_descriptor = artifact_descriptor(
            output_fluid_path, [high_grid, high_grid, high_grid, 16], FLUID_CHANNELS,
        )
        front_descriptor = artifact_descriptor(
            output_front_path, [high_grid, high_grid, high_grid, 1], ["frontTopology"],
        )
        source_replay = carrier.get("transfer", {}).get("sourceReplay")
        target_replay = carrier.get("transfer", {}).get("targetReplay") or pair.get("source", {}).get("deterministicReplay")
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "compositionAuthority": COMPOSITION_AUTHORITY,
            "runtimeTruthAvailable": False,
            "layoutIdentity": "x-fastest-zyx-c-interleaved-v0",
            "source": {
                "pairManifest": {"path": str(pair_path), "sha256": pair_sha},
                "carrierManifest": {"path": str(carrier_path), "sha256": sha256_file(carrier_path)},
                "carrierRole": role,
                "carrierRoleAuthority": role_descriptor.get("authority"),
                "lowGrid": low_grid,
                "highGrid": high_grid,
                "sourceReplay": source_replay,
                "targetReplay": target_replay,
                "exactBasinSourceCaptureSha256": pair.get("source", {}).get("exactBasinSourceCaptureSha256"),
                "route": {
                    "effective": carrier.get("target", {}).get("effectiveRoute"),
                    "backend": carrier.get("target", {}).get("backend"),
                },
                "targetDataUsedForTraining": carrier.get("transfer", {}).get("targetDataUsedForTraining"),
                "targetDataUsedForCalibration": carrier.get("transfer", {}).get("targetDataUsedForCalibration"),
                "targetLabelsUsedForModelSelection": carrier.get("transfer", {}).get("targetLabelsUsedForModelSelection"),
            },
            "policy": {
                "identity": POLICY_IDENTITY,
                "base": "native-low-nearest-upsampled-to-high-grid-v0",
                "carrierResidual": "max(selectedCarrier-lowDerivedCarrier,0)",
                "channel": TARGET_CHANNEL,
                "channelIndex": TARGET_CHANNEL_INDEX,
                "gain": gain,
                "subtractiveResidualApplied": False,
                "clippingApplied": False,
                "untouchedChannels": [channel for index, channel in enumerate(FLUID_CHANNELS) if index != TARGET_CHANNEL_INDEX],
            },
            "application": {
                "highCellCount": high_cells,
                "positiveResidualCellCount": positive_count,
                "suppressedNegativeResidualCellCount": suppressed_negative_count,
                "changedCellCount": changed_count,
                "appliedResidualMean": residual_sum / max(1, high_cells),
                "appliedResidualMax": residual_max,
            },
            "verification": {
                "identity": "byte-value-unchanged-outside-target-channel-v0",
                "unchangedFluidChannelCount": 15,
                "unchangedFluidMismatchCount": unchanged_mismatch_count,
                "frontByteIdenticalToLowUpsampled": front_mismatch_count == 0,
                "frontMismatchCount": front_mismatch_count,
            },
            "receiver": {
                "grid": high_grid,
                "initialSimStepCount": 0,
                "fluid": fluid_descriptor,
                "front": front_descriptor,
            },
            "consumptionContract": {
                "requiresExplicitSchemaAdmission": True,
                "mustNotBeAcceptedAs": "kaminos.volume.coarse-receiver-initial.v0",
                "heldOnly": True,
                "smokeChannelsPredicted": False,
                "physicalTruth": False,
                "mustNotBePromotedAs": "full-field reconstruction, smoke closure, native-low deployment, or simulation-force truth",
            },
        }
        write_json(manifest_path, report)
        print(json.dumps(report, indent=2))
        return 0
    except Exception as error:
        fail_manifest(manifest_path, phase, error, evidence)
        print(f"fire-flow carrier composition failed during {phase}: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
