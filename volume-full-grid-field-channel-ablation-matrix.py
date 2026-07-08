#!/usr/bin/env python3
"""Compose full-grid scalar/material channel ablation variants from an application manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.full-grid-field-channel-ablation-matrix.v0"
APPLICATION_SCHEMA = "kaminos.volume.full-grid-field-residual-application.v0"
IDENTITY = "full-grid-channel-ablation-matrix-diagnostic-v0"
LIMITATION = "controlled-low-channel-ablation-not-learned-prediction"
FIELD_AUTHORITY = "complete-webgpu-fluid-front-buffer-readback-sidecars"

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
ALL_CHANNELS = [*FLUID_CHANNELS, *FRONT_CHANNELS]

DEFAULT_VARIANTS: list[dict[str, Any]] = [
    {
        "role": "predictedAll",
        "displayLabel": "predAll",
        "description": "Unmodified predicted residual-completion field.",
        "lowFluidChannels": [],
        "frontSource": "predictedHigh",
    },
    {
        "role": "smokeDensityLow",
        "displayLabel": "smokeLow",
        "description": "Predicted field with smokeDensity reverted to lowUpsampled.",
        "lowFluidChannels": ["smokeDensity"],
        "frontSource": "predictedHigh",
    },
    {
        "role": "densityCarrierLow",
        "displayLabel": "densLow",
        "description": "Predicted field with densityCarrier reverted to lowUpsampled.",
        "lowFluidChannels": ["densityCarrier"],
        "frontSource": "predictedHigh",
    },
    {
        "role": "interfaceShredLow",
        "displayLabel": "shredLow",
        "description": "Predicted field with interfaceShred reverted to lowUpsampled.",
        "lowFluidChannels": ["interfaceShred"],
        "frontSource": "predictedHigh",
    },
    {
        "role": "microdetailLow",
        "displayLabel": "microLow",
        "description": "Predicted field with microdetail reverted to lowUpsampled.",
        "lowFluidChannels": ["microdetail"],
        "frontSource": "predictedHigh",
    },
    {
        "role": "smokeDensityDensityCarrierLow",
        "displayLabel": "smokeDensLow",
        "description": "Predicted field with smokeDensity and densityCarrier reverted to lowUpsampled.",
        "lowFluidChannels": ["smokeDensity", "densityCarrier"],
        "frontSource": "predictedHigh",
    },
    {
        "role": "smokeDensityDensityCarrierInterfaceShredMicrodetailLow",
        "displayLabel": "haze4Low",
        "description": "Predicted field with the primary suspected haze carriers reverted to lowUpsampled.",
        "lowFluidChannels": ["smokeDensity", "densityCarrier", "interfaceShred", "microdetail"],
        "frontSource": "predictedHigh",
    },
    {
        "role": "fireOnlyPredicted",
        "displayLabel": "fireOnly",
        "description": "Only fire/front carrier channels remain predicted; smoke-ish scalar carriers revert to lowUpsampled.",
        "lowFluidChannels": ["densityCarrier", "smokeDensity", "heat", "fuel", "microdetail", "interfaceShred"],
        "frontSource": "predictedHigh",
    },
]


class AblationFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application-manifest", required=True, help="Source full-grid residual/refinement application manifest.")
    parser.add_argument("--out-dir", required=True, help="Output directory for ablated sidecars.")
    parser.add_argument("--out", help="Output manifest path. Defaults to <out-dir>/manifest.json.")
    parser.add_argument("--chunk-cells", type=int, default=262_144, help="Cells per streaming composition chunk.")
    return parser.parse_args()


def utc_now() -> str:
    return np.datetime64("now", "s").astype(str) + "Z"


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


def source_sidecar(role: dict[str, Any], kind: str) -> dict[str, Any]:
    sidecar = role.get(kind)
    if not isinstance(sidecar, dict):
        raise AblationFailure("manifest-read", f"Role is missing {kind} sidecar.", {"role": role.get("role"), "kind": kind})
    return sidecar


def verify_sidecar(desc: dict[str, Any], expected_channels: list[str], phase: str) -> Path:
    path = Path(str(desc.get("path", ""))).resolve()
    if not path.exists():
        raise AblationFailure(phase, "Sidecar path does not exist.", {"path": str(path)})
    if desc.get("dtype") != "float32" or desc.get("byteOrder") != "little-endian":
        raise AblationFailure(phase, "Sidecar dtype/byte order mismatch.", {"path": str(path), "dtype": desc.get("dtype"), "byteOrder": desc.get("byteOrder")})
    if desc.get("channelOrder") != expected_channels:
        raise AblationFailure(phase, "Sidecar channel order mismatch.", {"path": str(path), "actual": desc.get("channelOrder"), "expected": expected_channels})
    expected_bytes = int(desc.get("byteLength", -1))
    if path.stat().st_size != expected_bytes:
        raise AblationFailure(phase, "Sidecar byte length mismatch.", {"path": str(path), "actualBytes": path.stat().st_size, "expectedBytes": expected_bytes})
    if sha256_file(path) != desc.get("sha256"):
        raise AblationFailure(phase, "Sidecar checksum mismatch.", {"path": str(path), "expectedSha256": desc.get("sha256")})
    return path


def shape_cells(desc: dict[str, Any], channels: int, phase: str) -> tuple[int, list[int]]:
    shape = desc.get("shape")
    if not isinstance(shape, list) or len(shape) != 4 or int(shape[3]) != channels:
        raise AblationFailure(phase, "Sidecar shape mismatch.", {"shape": shape, "channels": channels})
    cells = int(shape[0]) * int(shape[1]) * int(shape[2])
    if cells * channels != int(desc.get("floatCount", -1)):
        raise AblationFailure(phase, "Sidecar float count mismatch.", {"shape": shape, "floatCount": desc.get("floatCount")})
    return cells, [int(value) for value in shape]


def variant_channel_map(low_channels: set[str], front_source: str) -> dict[str, str]:
    mapping = {channel: ("lowUpsampled" if channel in low_channels else "predictedHigh") for channel in FLUID_CHANNELS}
    mapping["frontTopology"] = front_source
    return mapping


def write_failure(manifest_out: Path, phase: str, message: str, evidence: dict[str, Any]) -> None:
    write_json(manifest_out, {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "createdAt": utc_now(),
        "failurePhase": phase,
        "error": message,
        "evidence": evidence,
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    manifest_out = Path(args.out).resolve() if args.out else out_dir / "manifest.json"
    phase = "args"
    evidence: dict[str, Any] = {}
    try:
        phase = "manifest-read"
        application_manifest = Path(args.application_manifest).resolve()
        application = read_json(application_manifest)
        if application.get("schema") != APPLICATION_SCHEMA:
            raise AblationFailure(phase, "Application schema mismatch.", {"schema": application.get("schema")})
        roles_in = application.get("roles", {})
        for required in ["lowUpsampled", "predictedHigh", "truthHigh"]:
            if required not in roles_in:
                raise AblationFailure(phase, "Application is missing required role.", {"role": required})
        base_sha = sha256_file(application_manifest)
        evidence = {"applicationManifest": str(application_manifest), "baseApplicationManifestSha256": base_sha}

        low_fluid_desc = source_sidecar(roles_in["lowUpsampled"], "fluid")
        low_front_desc = source_sidecar(roles_in["lowUpsampled"], "front")
        pred_fluid_desc = source_sidecar(roles_in["predictedHigh"], "fluid")
        pred_front_desc = source_sidecar(roles_in["predictedHigh"], "front")
        truth_fluid_desc = source_sidecar(roles_in["truthHigh"], "fluid")
        truth_front_desc = source_sidecar(roles_in["truthHigh"], "front")

        low_fluid_path = verify_sidecar(low_fluid_desc, FLUID_CHANNELS, "sidecar-read")
        low_front_path = verify_sidecar(low_front_desc, FRONT_CHANNELS, "sidecar-read")
        pred_fluid_path = verify_sidecar(pred_fluid_desc, FLUID_CHANNELS, "sidecar-read")
        pred_front_path = verify_sidecar(pred_front_desc, FRONT_CHANNELS, "sidecar-read")
        verify_sidecar(truth_fluid_desc, FLUID_CHANNELS, "sidecar-read")
        verify_sidecar(truth_front_desc, FRONT_CHANNELS, "sidecar-read")

        cells, fluid_shape = shape_cells(low_fluid_desc, len(FLUID_CHANNELS), "shape-validate")
        pred_cells, pred_shape = shape_cells(pred_fluid_desc, len(FLUID_CHANNELS), "shape-validate")
        truth_cells, truth_shape = shape_cells(truth_fluid_desc, len(FLUID_CHANNELS), "shape-validate")
        front_cells, front_shape = shape_cells(low_front_desc, len(FRONT_CHANNELS), "shape-validate")
        if pred_cells != cells or truth_cells != cells or front_cells != cells or pred_shape != fluid_shape or truth_shape != fluid_shape:
            raise AblationFailure("shape-validate", "Role sidecar shapes do not match.", {
                "lowFluidShape": fluid_shape,
                "predFluidShape": pred_shape,
                "truthFluidShape": truth_shape,
                "frontShape": front_shape,
            })

        out_dir.mkdir(parents=True, exist_ok=True)
        chunk_cells = max(1, int(args.chunk_cells))
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(cells, len(FLUID_CHANNELS)))
        pred_fluid = np.memmap(pred_fluid_path, dtype="<f4", mode="r", shape=(cells, len(FLUID_CHANNELS)))

        roles: dict[str, Any] = {
            "lowUpsampled": roles_in["lowUpsampled"],
            "truthHigh": roles_in["truthHigh"],
            "predictedAll": {
                "role": "predictedAll",
                "displayLabel": "predAll",
                "sourceRole": "predictedHigh",
                "fluid": pred_fluid_desc,
                "front": pred_front_desc,
            },
        }
        variant_reports = []
        ablation_role_order = ["lowUpsampled", "predictedAll"]

        phase = "compose-variants"
        for variant in DEFAULT_VARIANTS:
            role_name = str(variant["role"])
            low_channels = set(variant["lowFluidChannels"])
            unknown = sorted(low_channels.difference(FLUID_CHANNELS))
            if unknown:
                raise AblationFailure(phase, "Variant names unknown fluid channels.", {"role": role_name, "unknownChannels": unknown})
            channel_indexes = [FLUID_CHANNELS.index(channel) for channel in variant["lowFluidChannels"]]
            front_source = str(variant["frontSource"])
            if front_source != "predictedHigh":
                raise AblationFailure(phase, "Only predictedHigh front source is currently supported.", {"role": role_name, "frontSource": front_source})

            if role_name == "predictedAll":
                variant_desc = roles["predictedAll"]
            else:
                fluid_path = out_dir / f"{role_name}-fluid.f32"
                fluid_path.write_bytes(b"")
                with fluid_path.open("ab") as handle:
                    for start in range(0, cells, chunk_cells):
                        end = min(cells, start + chunk_cells)
                        chunk = np.array(pred_fluid[start:end], dtype=np.float32, copy=True)
                        for channel_index in channel_indexes:
                            chunk[:, channel_index] = low_fluid[start:end, channel_index]
                        chunk.astype("<f4", copy=False).tofile(handle)
                expected_bytes = cells * len(FLUID_CHANNELS) * 4
                if fluid_path.stat().st_size != expected_bytes:
                    raise AblationFailure(phase, "Variant fluid byte length mismatch.", {"role": role_name, "actualBytes": fluid_path.stat().st_size, "expectedBytes": expected_bytes})
                variant_desc = {
                    "role": role_name,
                    "displayLabel": str(variant["displayLabel"]),
                    "sourceRole": "predictedHigh",
                    "fluid": sidecar_descriptor(fluid_path, fluid_shape, FLUID_CHANNELS),
                    "front": pred_front_desc,
                }
                roles[role_name] = variant_desc
                ablation_role_order.append(role_name)

            report = {
                "role": role_name,
                "displayLabel": str(variant["displayLabel"]),
                "description": variant["description"],
                "lowFluidChannels": sorted(low_channels),
                "predictedFluidChannels": [channel for channel in FLUID_CHANNELS if channel not in low_channels],
                "frontSource": front_source,
                "variantChannelMap": variant_channel_map(low_channels, front_source),
                "fluidSha256": variant_desc["fluid"]["sha256"],
                "frontSha256": variant_desc["front"]["sha256"],
            }
            variant_reports.append(report)

        phase = "write-report"
        manifest = {
            "schema": APPLICATION_SCHEMA,
            "diagnosticSchema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "createdAt": utc_now(),
            "failurePhase": None,
            "channelAblationMatrix": {
                "schema": SCHEMA,
                "identity": IDENTITY,
                "limitation": LIMITATION,
                "baseApplicationManifest": str(application_manifest),
                "baseApplicationManifestSha256": base_sha,
                "applicationIdentity": application.get("identity"),
                "sourceModel": application.get("model"),
                "ablationRoleOrder": ablation_role_order,
                "variants": variant_reports,
            },
            "applicationAuthority": "channel-ablation-matrix-diagnostic",
            "fieldAuthority": FIELD_AUTHORITY,
            "prototypeIdentity": application.get("prototypeIdentity"),
            "routeIdentity": application.get("routeIdentity"),
            "effectiveRoute": application.get("effectiveRoute"),
            "deterministicReplay": application.get("deterministicReplay"),
            "lowGrid": application.get("lowGrid"),
            "highGrid": application.get("highGrid"),
            "model": application.get("model"),
            "pairManifest": application.get("pairManifest"),
            "pairManifestSha256": application.get("pairManifestSha256"),
            "roles": roles,
            "limitations": [
                "Diagnostic composition from an existing same-pair application, not a learned prediction.",
                LIMITATION,
                "TruthHigh is preserved for comparison only; truth support is not used to compose variants.",
            ],
        }
        write_json(manifest_out, manifest)
        return 0
    except AblationFailure as error:
        write_failure(manifest_out, error.phase, str(error), error.evidence or evidence)
        print(f"{error.phase}: {error}", file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 - durable failure report is more useful than a raw traceback only.
        write_failure(manifest_out, phase, str(error), evidence)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
