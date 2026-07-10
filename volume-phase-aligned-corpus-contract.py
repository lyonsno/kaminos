#!/usr/bin/env python3
"""Build phase-aligned high-history corpus inputs and target contracts.

This is an offline field/corpus contract packer. It does not launch the browser,
train a model, or claim native-low deployment success. Its job is to bind one
high-resolution simulator history to downsampled teacher inputs, high-resolution
targets, and optional native-low domain-gap controls.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.phase-aligned-learned-probe-corpus.v0"
IDENTITY = "phase-aligned-high-history-downsample-corpus-v0"
FULL_GRID_EXPORT_SCHEMA = "kaminos.volume.full-grid-field-export.v0"
AUTHORITY = "offline-phase-aligned-field-corpus-contract-not-browser-witness-not-product-inference"
BOX_AVERAGE_OPERATOR = "box-average-linear-field-v0"
MAX_POOL_OPERATOR = "max-pool-support-field-v0"
DOMAIN_GAP_IDENTITY = "native-low-vs-downsampled-high-domain-gap-v0"

DEFAULT_TARGET_GRID = 128
SUPPORT_CHANNELS = {
    "frontTopology",
    "shellAlpha",
    "shellEdge",
    "combustionFront",
    "visibleFireCarrier",
}

SHELL_DETAIL_TARGETS = {
    "identity": "boundary-fire-shell-detail-target-vocabulary-v0",
    "limitation": "Target names are corpus roles, not a claim that every channel is present in every export.",
    "channelGroups": {
        "shellAlpha": {
            "channels": ["frontTopology", "combustionFront"],
            "targetRole": "thin visible reaction sheet support",
        },
        "shellEdge": {
            "channels": ["frontTopology", "interfaceShred", "microdetail"],
            "targetRole": "ragged sheet edge and breakup support",
        },
        "sheetRadiance": {
            "channels": ["radiance", "visibleFireCarrier", "emberFleck"],
            "targetRole": "renderer-coupled sheet glow and fire-color authority",
        },
        "hotCore": {
            "channels": ["heat", "flame", "visibleFireCarrier"],
            "targetRole": "compact bright fire body and combustion authority",
        },
        "internalStreak": {
            "channels": ["curlMagnitude", "vorticity", "microdetail", "fireLick"],
            "targetRole": "internal streaking and high-frequency motion-like detail",
        },
        "confidenceAlpha": {
            "channels": ["frontTopology", "density", "smoke", "visibleFireCarrier"],
            "targetRole": "where learned correction should be trusted or masked",
        },
    },
}


class CorpusFailure(Exception):
    def __init__(self, phase: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.details = details or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--high-manifest", required=True, help="High-resolution full-grid export manifest.")
    parser.add_argument("--out-dir", required=True, help="Output directory for the corpus contract manifest and sidecars.")
    parser.add_argument("--target-grid", type=int, default=0, help="Production/source grid for downsampled-high inputs.")
    parser.add_argument("--native-low-manifest", help="Optional native-low full-grid export manifest for domain-gap controls.")
    parser.add_argument("--witness-manifest", help="Optional phase-aligned browser witness manifest to bind route/basin context.")
    parser.add_argument("--source-note", default="", help="Optional compact note for the manifest.")
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as err:
        raise CorpusFailure("manifest-read", f"Missing manifest {path}", {"path": str(path)}) from err
    except json.JSONDecodeError as err:
        raise CorpusFailure("manifest-read", f"Invalid JSON manifest {path}", {"error": str(err)}) from err


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_path(raw_path: str, base_dir: Path) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = base_dir / path
    return path.resolve()


def verify_manifest(manifest: dict[str, Any], path: Path, role: str) -> None:
    if manifest.get("schema") != FULL_GRID_EXPORT_SCHEMA:
        raise CorpusFailure("manifest-validate", f"{role} manifest schema mismatch.", {
            "path": str(path),
            "schema": manifest.get("schema"),
            "expectedSchema": FULL_GRID_EXPORT_SCHEMA,
        })
    if manifest.get("status") not in (None, "captured"):
        raise CorpusFailure("manifest-validate", f"{role} manifest is not captured.", {
            "path": str(path),
            "status": manifest.get("status"),
            "failurePhase": manifest.get("failurePhase"),
        })


def sidecar_descriptor(manifest: dict[str, Any], manifest_path: Path, kind: str) -> dict[str, Any]:
    desc = (manifest.get("sidecars") or {}).get(kind)
    if not isinstance(desc, dict):
        raise CorpusFailure("source-verify", f"Missing {kind} sidecar descriptor.", {
            "manifest": str(manifest_path),
            "sidecarKeys": sorted((manifest.get("sidecars") or {}).keys()),
        })
    raw_path = desc.get("path")
    if not raw_path:
        raise CorpusFailure("source-verify", f"{kind} descriptor is missing path.", {"descriptor": desc})
    path = resolve_path(str(raw_path), manifest_path.parent)
    if not path.exists():
        raise CorpusFailure("source-verify", f"{kind} sidecar path does not exist.", {"path": str(path)})
    expected_bytes = desc.get("byteLength")
    actual_bytes = path.stat().st_size
    if expected_bytes is not None and int(expected_bytes) != actual_bytes:
        raise CorpusFailure("source-verify", f"{kind} sidecar byte length mismatch.", {
            "path": str(path),
            "expectedByteLength": int(expected_bytes),
            "actualByteLength": actual_bytes,
        })
    expected_sha = desc.get("sha256")
    if expected_sha:
        actual_sha = sha256_file(path)
        if actual_sha != expected_sha:
            raise CorpusFailure("source-verify", f"{kind} sidecar checksum mismatch.", {
                "path": str(path),
                "expectedSha256": expected_sha,
                "actualSha256": actual_sha,
            })
    out = dict(desc)
    out["path"] = str(path)
    return out


def channel_order(manifest: dict[str, Any], desc: dict[str, Any], kind: str) -> list[str]:
    explicit = desc.get("channelOrder")
    if isinstance(explicit, list) and explicit:
        return [str(value) for value in explicit]
    key = "fluidChannelOrder" if kind == "fluid" else "frontChannelOrder"
    fallback = manifest.get(key)
    if isinstance(fallback, list) and fallback:
        return [str(value) for value in fallback]
    return ["frontTopology"] if kind == "front" else []


def infer_shape(manifest: dict[str, Any], desc: dict[str, Any], kind: str, order: list[str]) -> list[int]:
    shape = desc.get("shape")
    if isinstance(shape, list) and len(shape) == 4:
        return [int(value) for value in shape]
    grid = int(manifest.get("grid") or 0)
    if grid <= 0:
        raise CorpusFailure("source-verify", f"Cannot infer {kind} shape without grid.", {"descriptor": desc})
    channels = len(order) or (1 if kind == "front" else int(desc.get("components") or 0))
    if channels <= 0:
        raise CorpusFailure("source-verify", f"Cannot infer {kind} channel count.", {"descriptor": desc})
    return [grid, grid, grid, channels]


def load_sidecar(manifest: dict[str, Any], manifest_path: Path, kind: str) -> tuple[np.ndarray, dict[str, Any]]:
    desc = sidecar_descriptor(manifest, manifest_path, kind)
    order = channel_order(manifest, desc, kind)
    shape = infer_shape(manifest, desc, kind, order)
    expected_floats = math.prod(shape)
    expected_bytes = expected_floats * 4
    path = Path(desc["path"])
    if path.stat().st_size != expected_bytes:
        raise CorpusFailure("source-verify", f"{kind} sidecar size does not match inferred shape.", {
            "path": str(path),
            "shape": shape,
            "expectedByteLength": expected_bytes,
            "actualByteLength": path.stat().st_size,
        })
    arr = np.memmap(path, dtype="<f4", mode="r", shape=tuple(shape))
    normalized_desc = dict(desc)
    normalized_desc.update({
        "path": str(path),
        "shape": shape,
        "channelOrder": order,
        "sha256": desc.get("sha256") or sha256_file(path),
        "dtype": "float32",
        "byteOrder": "little-endian",
        "floatCount": int(expected_floats),
        "byteLength": int(expected_bytes),
    })
    return np.asarray(arr, dtype=np.float32), normalized_desc


def downsample_field(arr: np.ndarray, target_grid: int, operator: str) -> np.ndarray:
    if arr.ndim != 4:
        raise CorpusFailure("downsample", "Sidecar array must be 4D.", {"shape": list(arr.shape)})
    source_grid = int(arr.shape[0])
    if arr.shape[0] != arr.shape[1] or arr.shape[1] != arr.shape[2]:
        raise CorpusFailure("downsample", "Only cubic sidecars are supported.", {"shape": list(arr.shape)})
    if target_grid <= 0:
        raise CorpusFailure("downsample", "Target grid must be positive.", {"targetGrid": target_grid})
    if source_grid % target_grid != 0:
        raise CorpusFailure("downsample", "Target grid must evenly divide high grid for this first contract.", {
            "sourceGrid": source_grid,
            "targetGrid": target_grid,
            "neededHook": "resampling-kernel-with-recorded-filter-footprint-v0",
        })
    factor = source_grid // target_grid
    view = arr.reshape(target_grid, factor, target_grid, factor, target_grid, factor, arr.shape[3])
    if operator == MAX_POOL_OPERATOR:
        return view.max(axis=(1, 3, 5)).astype(np.float32)
    if operator == BOX_AVERAGE_OPERATOR:
        return view.mean(axis=(1, 3, 5)).astype(np.float32)
    raise CorpusFailure("downsample", f"Unknown downsample operator {operator}", {"operator": operator})


def choose_operator(kind: str, order: list[str]) -> str:
    if kind == "front":
        return MAX_POOL_OPERATOR
    if any(channel in SUPPORT_CHANNELS for channel in order):
        return BOX_AVERAGE_OPERATOR
    return BOX_AVERAGE_OPERATOR


def write_sidecar(path: Path, arr: np.ndarray, channel_order_value: list[str], operator: str, source_desc: dict[str, Any]) -> dict[str, Any]:
    out = np.asarray(arr, dtype="<f4")
    path.parent.mkdir(parents=True, exist_ok=True)
    out.tofile(path)
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "dtype": "float32",
        "byteOrder": "little-endian",
        "shape": list(out.shape),
        "channelOrder": channel_order_value,
        "floatCount": int(out.size),
        "byteLength": int(path.stat().st_size),
        "sourceSha256": source_desc.get("sha256"),
        "downsampleOperator": operator,
    }


def descriptor_ref(desc: dict[str, Any]) -> dict[str, Any]:
    keep = ["path", "sha256", "dtype", "byteOrder", "shape", "channelOrder", "floatCount", "byteLength"]
    return {key: desc.get(key) for key in keep if key in desc}


def stats(error: np.ndarray) -> dict[str, Any]:
    e = np.asarray(error, dtype=np.float64)
    return {
        "rmse": float(np.sqrt(np.mean(e * e))) if e.size else 0.0,
        "mae": float(np.mean(np.abs(e))) if e.size else 0.0,
        "maxAbs": float(np.max(np.abs(e))) if e.size else 0.0,
        "mean": float(np.mean(e)) if e.size else 0.0,
    }


def per_channel_stats(error: np.ndarray, order: list[str]) -> dict[str, Any]:
    if error.ndim != 4:
        return {}
    out = {}
    for index in range(error.shape[3]):
        name = order[index] if index < len(order) else str(index)
        out[name] = stats(error[..., index])
    return out


def write_domain_gap(out_dir: Path, native_manifest: dict[str, Any], native_manifest_path: Path, downsampled: dict[str, Any]) -> dict[str, Any]:
    native_fluid, native_fluid_desc = load_sidecar(native_manifest, native_manifest_path, "fluid")
    native_front, native_front_desc = load_sidecar(native_manifest, native_manifest_path, "front")
    gap_dir = out_dir / "domain-gap"
    result: dict[str, Any] = {
        "identity": DOMAIN_GAP_IDENTITY,
        "status": "computed",
        "authority": "offline-domain-gap-between-native-low-and-phase-aligned-downsampled-high",
        "nativeLowManifest": str(native_manifest_path),
        "sidecars": {},
        "metrics": {},
        "limitation": "A small domain gap supports transfer plausibility; a large gap does not disprove the teacher problem.",
    }
    for kind, native_arr, native_desc in (
        ("fluid", native_fluid, native_fluid_desc),
        ("front", native_front, native_front_desc),
    ):
        ds_desc = downsampled["sidecars"][kind]
        ds_arr = np.memmap(ds_desc["path"], dtype="<f4", mode="r", shape=tuple(ds_desc["shape"]))
        if list(native_arr.shape) != list(ds_arr.shape):
            raise CorpusFailure("domain-gap", f"{kind} native-low shape differs from downsampled-high.", {
                "nativeShape": list(native_arr.shape),
                "downsampledShape": list(ds_arr.shape),
            })
        error = native_arr.astype(np.float32) - np.asarray(ds_arr, dtype=np.float32)
        gap_path = gap_dir / f"native-minus-downsampled-high-{kind}.f32"
        gap_desc = write_sidecar(gap_path, error, native_desc.get("channelOrder", []), "native-minus-downsampled-high", native_desc)
        result["sidecars"][kind] = gap_desc
        result["metrics"][kind] = {
            "global": stats(error),
            "perChannel": per_channel_stats(error, native_desc.get("channelOrder", [])),
            "nativeLow": descriptor_ref(native_desc),
            "downsampledHigh": descriptor_ref(ds_desc),
        }
    return result


def source_identity(manifest: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    return {
        "manifestPath": str(manifest_path),
        "manifestSha256": sha256_file(manifest_path),
        "schema": manifest.get("schema"),
        "identity": manifest.get("identity"),
        "status": manifest.get("status"),
        "routeIdentity": manifest.get("routeIdentity"),
        "effectiveRoute": manifest.get("effectiveRoute"),
        "prototypeIdentity": manifest.get("prototypeIdentity"),
        "backend": manifest.get("backend"),
        "grid": manifest.get("grid"),
        "deterministicReplay": manifest.get("deterministicReplay"),
    }


def copy_optional_manifest(path_raw: str | None, out_dir: Path, label: str) -> dict[str, Any] | None:
    if not path_raw:
        return None
    path = Path(path_raw).resolve()
    manifest = read_json(path)
    copied = out_dir / "source-manifests" / f"{label}.json"
    copied.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, copied)
    return {
        "path": str(copied),
        "sha256": sha256_file(copied),
        "originalPath": str(path),
        "schema": manifest.get("schema"),
        "identity": manifest.get("identity"),
        "failurePhase": manifest.get("failurePhase"),
    }


def failure_report(out_dir: Path, phase: str, error: Exception, evidence: dict[str, Any] | None = None) -> None:
    payload: dict[str, Any] = {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "capturedAt": now_iso(),
        "authority": AUTHORITY,
        "error": str(error),
    }
    if isinstance(error, CorpusFailure):
        payload["failurePhase"] = error.phase
        payload["details"] = error.details
    if evidence:
        payload["evidence"] = evidence
    write_json(out_dir / "manifest.json", payload)


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    phase = "argument-parse"
    evidence: dict[str, Any] = {}
    try:
        phase = "manifest-read"
        high_manifest_path = Path(args.high_manifest).resolve()
        high_manifest = read_json(high_manifest_path)
        verify_manifest(high_manifest, high_manifest_path, "high")
        evidence["highManifest"] = str(high_manifest_path)

        target_grid = int(args.target_grid or 0)
        if target_grid <= 0:
            target_grid = int(DEFAULT_TARGET_GRID)
        high_grid = int(high_manifest.get("grid") or 0)
        if high_grid <= 0:
            raise CorpusFailure("manifest-validate", "High manifest is missing grid.", {"manifest": str(high_manifest_path)})
        if target_grid >= high_grid:
            raise CorpusFailure("downsample", "Target grid must be lower than high grid.", {
                "highGrid": high_grid,
                "targetGrid": target_grid,
            })

        phase = "source-verify"
        high_fluid, high_fluid_desc = load_sidecar(high_manifest, high_manifest_path, "fluid")
        high_front, high_front_desc = load_sidecar(high_manifest, high_manifest_path, "front")

        phase = "downsample"
        downsample_dir = out_dir / "downsampled-high-input"
        fluid_operator = choose_operator("fluid", high_fluid_desc["channelOrder"])
        front_operator = choose_operator("front", high_front_desc["channelOrder"])
        low_fluid = downsample_field(high_fluid, target_grid, fluid_operator)
        low_front = downsample_field(high_front, target_grid, front_operator)
        downsampled_high = {
            "identity": "downsampled-high-input-v0",
            "grid": target_grid,
            "sourceGrid": high_grid,
            "sidecars": {
                "fluid": write_sidecar(
                    downsample_dir / "downsampled-high-fluid.f32",
                    low_fluid,
                    high_fluid_desc["channelOrder"],
                    fluid_operator,
                    high_fluid_desc,
                ),
                "front": write_sidecar(
                    downsample_dir / "downsampled-high-front.f32",
                    low_front,
                    high_front_desc["channelOrder"],
                    front_operator,
                    high_front_desc,
                ),
            },
            "downsampleOperators": {
                "fluid": {
                    "identity": fluid_operator,
                    "sourceGrid": high_grid,
                    "targetGrid": target_grid,
                    "factor": high_grid // target_grid,
                    "semantics": "mean over each cubic source block for linear-ish transported field channels",
                },
                "front": {
                    "identity": front_operator,
                    "sourceGrid": high_grid,
                    "targetGrid": target_grid,
                    "factor": high_grid // target_grid,
                    "semantics": "max over each cubic source block to preserve thin shell/support occupancy",
                },
            },
        }

        native_gap: dict[str, Any] = {
            "identity": DOMAIN_GAP_IDENTITY,
            "status": "not-requested",
            "limitation": "No native-low manifest was provided; deployment transfer remains untested by this artifact.",
        }
        native_identity = None
        if args.native_low_manifest:
            phase = "native-low-manifest-read"
            native_manifest_path = Path(args.native_low_manifest).resolve()
            native_manifest = read_json(native_manifest_path)
            verify_manifest(native_manifest, native_manifest_path, "native-low")
            native_identity = source_identity(native_manifest, native_manifest_path)
            phase = "domain-gap"
            native_gap = write_domain_gap(out_dir, native_manifest, native_manifest_path, downsampled_high)

        phase = "manifest-write"
        witness_ref = copy_optional_manifest(args.witness_manifest, out_dir, "phase-aligned-witness")
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "capturedAt": now_iso(),
            "authority": AUTHORITY,
            "sourceNote": args.source_note,
            "route": {
                "highRes": source_identity(high_manifest, high_manifest_path),
                "nativeLow": native_identity,
                "witness": witness_ref,
            },
            "highResSingleHistory": {
                "identity": "high-res-single-history-field-source-v0",
                "grid": high_grid,
                "sidecars": {
                    "fluid": descriptor_ref(high_fluid_desc),
                    "front": descriptor_ref(high_front_desc),
                },
                "truthAuthority": "same-high-history-target-source-for-phase-aligned-teacher-probes",
            },
            "downsampledHighInput": downsampled_high,
            "truthHighTarget": {
                "identity": "truth-high-shell-detail-target-source-v0",
                "grid": high_grid,
                "sidecars": {
                    "fluid": descriptor_ref(high_fluid_desc),
                    "front": descriptor_ref(high_front_desc),
                },
                "shellDetailTargets": SHELL_DETAIL_TARGETS,
                "limitation": "This contract references full high sidecars and target vocabulary; derived target maps may be emitted by later extractors.",
            },
            "shellDetailTargets": SHELL_DETAIL_TARGETS,
            "nativeLowDomainGap": native_gap,
            "teacherProbeRecommendations": [
                {
                    "identity": "teacher-upper-bound-downsampled-high-to-shell-detail-v0",
                    "input": "downsampledHighInput",
                    "target": "truthHighTarget.shellDetailTargets",
                    "reason": "Tests learnability with phase mismatch removed before native-low deployment risk is blamed.",
                },
                {
                    "identity": "native-low-substitution-domain-gap-probe-v0",
                    "input": "nativeLow sidecars with identical target extraction",
                    "target": "downsampledHighInput and truthHighTarget",
                    "reason": "Separates successful teacher map from source-sim distribution shift.",
                },
                {
                    "identity": "derived-feature-ablation-pack-v0",
                    "input": "scalar carriers plus front/Laplacian/curl/velocity invariants where available",
                    "target": "shellAlpha, shellEdge, sheetRadiance, hotCore, internalStreak, confidenceAlpha",
                    "reason": "Ranks which physics-derived carriers buy sheet-detail recovery before WebGPU distillation.",
                },
            ],
            "nonGoals": [
                "not a browser/WebGPU witness",
                "not a model training result",
                "not product inference",
                "not native-low transfer proof unless nativeLowDomainGap and follow-up substitution probes pass",
            ],
        }
        write_json(out_dir / "manifest.json", report)
        print(json.dumps({
            "ok": True,
            "manifest": str(out_dir / "manifest.json"),
            "schema": SCHEMA,
            "targetGrid": target_grid,
            "nativeLowDomainGap": native_gap.get("status"),
        }, indent=2))
    except Exception as err:
        failure_report(out_dir, phase, err, evidence)
        raise


if __name__ == "__main__":
    main()
