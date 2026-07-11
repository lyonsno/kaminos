#!/usr/bin/env python3
"""Assemble dense learned cue packs into renderer-overridable v1 boundary sidecars."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.dense-cue-pack-sidecar-application.v0"
IDENTITY = "dense-learned-cue-boundary-sidecar-application-v0"
FIELD_AUTHORITY = "truthFluidFrontSidecarOnlyDiagnostic"
APPLICATION_AUTHORITY = "offline-learned-boundary-sidecar-override-diagnostic"
BOUNDARY_OVERRIDE_IDENTITY = "boundary-sidecar-override-source-v0"
SIDECAR_IDENTITY = "baked-boundary-sidecar-v1"
SIDE_CHANNELS = ["support", "coverage", "ridge", "footprint"]
META_CHANNELS = ["proximity", "normalX", "normalY", "normalZ"]
COMBINED_CHANNELS = [*SIDE_CHANNELS, *META_CHANNELS]
SCALAR_CHANNELS = ["support", "coverage", "ridge", "proximity"]
CLASSIFIER_CHANNELS = [
    "supportClassifierProbability",
    "coverageClassifierProbability",
    "ridgeClassifierProbability",
    "proximityClassifierProbability",
]


class ApplyFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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


def resolve_path(desc: dict[str, Any], base_dir: Path) -> Path:
    path = Path(str(desc.get("path") or ""))
    return path if path.is_absolute() else (base_dir / path).resolve()


def verify_descriptor(desc: dict[str, Any], base_dir: Path, role: str) -> Path:
    path = resolve_path(desc, base_dir)
    if not path.exists():
        raise ApplyFailure("sidecar-read", f"{role} sidecar missing.", {"path": str(path)})
    expected_bytes = int(desc.get("byteLength") or 0)
    actual_bytes = path.stat().st_size
    if expected_bytes and expected_bytes != actual_bytes:
        raise ApplyFailure("sidecar-validate", f"{role} byte length mismatch.", {
            "path": str(path),
            "expectedBytes": expected_bytes,
            "actualBytes": actual_bytes,
        })
    expected_sha = desc.get("sha256")
    if expected_sha:
        actual_sha = sha256_file(path)
        if actual_sha != expected_sha:
            raise ApplyFailure("sidecar-validate", f"{role} checksum mismatch.", {
                "path": str(path),
                "expectedSha256": expected_sha,
                "actualSha256": actual_sha,
            })
    return path


def load_array(desc: dict[str, Any], base_dir: Path, role: str) -> np.memmap:
    path = verify_descriptor(desc, base_dir, role)
    shape = tuple(int(value) for value in desc.get("shape") or [])
    if not shape:
        raise ApplyFailure("descriptor-validate", f"{role} descriptor is missing shape.", {"descriptor": desc})
    dtype = np.dtype(str(desc.get("dtype") or "<f4"))
    return np.memmap(path, dtype=dtype, mode="r", shape=shape)


def descriptor(path: Path, shape: list[int], channel_order: list[str], kind: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "path": str(path),
        "sha256": sha256_file(path),
        "dtype": "float32",
        "byteOrder": "little-endian",
        "floatCount": int(math.prod(shape)),
        "byteLength": path.stat().st_size,
        "shape": shape,
        "channelOrder": channel_order,
    }


def write_f32(path: Path, values: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    arr = np.asarray(values, dtype="<f4")
    arr.tofile(path)


def flatten_grid(values: np.ndarray, channel_count: int, role: str) -> np.ndarray:
    arr = np.asarray(values)
    if arr.ndim == 4:
        return arr.reshape((arr.shape[0] ** 3, int(arr.shape[-1])))
    if arr.ndim == 2:
        return arr
    raise ApplyFailure("shape-validate", f"{role} must be flat or grid-shaped.", {"shape": list(arr.shape)})


def load_split_boundary(manifest_path: Path, role: str) -> tuple[np.ndarray, np.ndarray, dict[str, Any], dict[str, Any]]:
    manifest = read_json(manifest_path)
    boundary = manifest.get("boundarySidecar") or {}
    if boundary.get("identity") != SIDECAR_IDENTITY:
        raise ApplyFailure("manifest-validate", f"{role} sidecar identity mismatch.", {
            "path": str(manifest_path),
            "identity": boundary.get("identity"),
        })
    sidecars = boundary.get("sidecars") or {}
    side_desc = sidecars.get("boundary")
    meta_desc = sidecars.get("meta")
    if not side_desc or not meta_desc:
        raise ApplyFailure("manifest-validate", f"{role} boundary/meta descriptors missing.", {"path": str(manifest_path)})
    side = flatten_grid(load_array(side_desc, manifest_path.parent, f"{role}.boundary"), 4, f"{role}.boundary")
    meta = flatten_grid(load_array(meta_desc, manifest_path.parent, f"{role}.meta"), 4, f"{role}.meta")
    return side, meta, manifest, boundary


def low_to_high_nearest(low: np.ndarray, high_grid: int) -> np.ndarray:
    if low.ndim == 4:
        low_grid = int(low.shape[0])
        low_flat = np.asarray(low).reshape((low_grid ** 3, int(low.shape[-1])))
    elif low.ndim == 2:
        low_grid = int(round(low.shape[0] ** (1.0 / 3.0)))
        if low_grid ** 3 != low.shape[0]:
            raise ApplyFailure("shape-validate", "Low sidecar cell count is not cubic.", {"cellCount": int(low.shape[0])})
        low_flat = np.asarray(low)
    else:
        raise ApplyFailure("shape-validate", "Low sidecar must be flat or grid-shaped.", {"shape": list(low.shape)})
    z, y, x = np.indices((high_grid, high_grid, high_grid), dtype=np.float32)
    scale = float(low_grid) / float(high_grid)
    lx = np.clip(np.floor((x + 0.5) * scale), 0, low_grid - 1).astype(np.int64)
    ly = np.clip(np.floor((y + 0.5) * scale), 0, low_grid - 1).astype(np.int64)
    lz = np.clip(np.floor((z + 0.5) * scale), 0, low_grid - 1).astype(np.int64)
    indexes = (lx + ly * low_grid + lz * low_grid * low_grid).reshape(-1)
    return low_flat[indexes]


def clip01(values: np.ndarray) -> np.ndarray:
    return np.clip(np.nan_to_num(values, nan=0.0, posinf=1.0, neginf=0.0), 0.0, 1.0).astype(np.float32, copy=False)


def parse_float_arg(value: str, name: str, minimum: float = 0.0, maximum: float = 4.0) -> float:
    try:
        parsed = float(value)
    except ValueError as err:
        raise argparse.ArgumentTypeError(f"{name} must be numeric") from err
    if not math.isfinite(parsed) or parsed < minimum or parsed > maximum:
        raise argparse.ArgumentTypeError(f"{name} must be in [{minimum}, {maximum}]")
    return parsed


def blend_parameters(args: argparse.Namespace) -> dict[str, float]:
    return {
        "learnedStrength": float(args.learned_strength),
        "supportClassifierGain": float(args.support_classifier_gain),
        "supportScalarGain": float(args.support_scalar_gain),
        "coverageClassifierGain": float(args.coverage_classifier_gain),
        "coverageScalarGain": float(args.coverage_scalar_gain),
        "ridgeClassifierGain": float(args.ridge_classifier_gain),
        "ridgeScalarGain": float(args.ridge_scalar_gain),
        "proximityClassifierGain": float(args.proximity_classifier_gain),
        "proximityScalarGain": float(args.proximity_scalar_gain),
    }


def assemble_predicted_sidecar(
    low_high: np.ndarray,
    scalar: np.ndarray,
    classifier: np.ndarray,
    params: dict[str, float],
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    support_prob = clip01(classifier[:, CLASSIFIER_CHANNELS.index("supportClassifierProbability")])
    coverage_prob = clip01(classifier[:, CLASSIFIER_CHANNELS.index("coverageClassifierProbability")])
    ridge_prob = clip01(classifier[:, CLASSIFIER_CHANNELS.index("ridgeClassifierProbability")])
    proximity_prob = clip01(classifier[:, CLASSIFIER_CHANNELS.index("proximityClassifierProbability")])
    scalar_support = clip01(scalar[:, SCALAR_CHANNELS.index("support")])
    scalar_coverage = clip01(scalar[:, SCALAR_CHANNELS.index("coverage")])
    scalar_ridge = clip01(np.abs(scalar[:, SCALAR_CHANNELS.index("ridge")]))
    scalar_proximity = clip01(scalar[:, SCALAR_CHANNELS.index("proximity")])
    low_side = low_high[:, :4].astype(np.float32, copy=False)
    low_meta = low_high[:, 4:].astype(np.float32, copy=False)
    hybrid_side = np.zeros((low_high.shape[0], 4), dtype=np.float32)
    hybrid_meta = np.zeros((low_high.shape[0], 4), dtype=np.float32)
    hybrid_side[:, 0] = np.maximum(
        params["supportClassifierGain"] * support_prob,
        params["supportScalarGain"] * scalar_support,
    )
    hybrid_side[:, 1] = np.maximum(
        params["coverageClassifierGain"] * coverage_prob,
        params["coverageScalarGain"] * scalar_coverage * np.maximum(support_prob, proximity_prob),
    )
    hybrid_side[:, 2] = np.maximum(
        params["ridgeClassifierGain"] * ridge_prob,
        params["ridgeScalarGain"] * scalar_ridge * np.maximum(0.35, support_prob),
    )
    hybrid_side[:, 3] = clip01(low_high[:, COMBINED_CHANNELS.index("footprint")])
    hybrid_meta[:, 0] = np.maximum(
        params["proximityClassifierGain"] * proximity_prob,
        params["proximityScalarGain"] * scalar_proximity,
    )
    hybrid_meta[:, 1] = low_high[:, COMBINED_CHANNELS.index("normalX")]
    hybrid_meta[:, 2] = low_high[:, COMBINED_CHANNELS.index("normalY")]
    hybrid_meta[:, 3] = low_high[:, COMBINED_CHANNELS.index("normalZ")]
    learned_strength = params["learnedStrength"]
    side = clip01(low_side + learned_strength * (hybrid_side - low_side))
    meta = clip01(low_meta + learned_strength * (hybrid_meta - low_meta))
    return side, meta, {
        "identity": "classifier-gated-scalar-sidecar-hybrid-v1",
        "blend": "low + learnedStrength * (hybrid - low)",
        "blendParameters": params,
        "support": "max(supportClassifierGain * supportClassifierProbability, supportScalarGain * scalarSupport)",
        "coverage": "max(coverageClassifierGain * coverageClassifierProbability, coverageScalarGain * scalarCoverage * max(supportProbability, proximityProbability))",
        "ridge": "max(ridgeClassifierGain * ridgeClassifierProbability, ridgeScalarGain * abs(scalarRidge) * max(0.35, supportProbability))",
        "footprint": "lowInputUpsampled footprint",
        "proximity": "max(proximityClassifierGain * proximityClassifierProbability, proximityScalarGain * scalarProximity)",
        "normals": "lowInputUpsampled normal proxy components",
    }


def role(fluid_desc: dict[str, Any], front_desc: dict[str, Any], boundary_desc: dict[str, Any], meta_desc: dict[str, Any], role_name: str) -> dict[str, Any]:
    return {
        "role": role_name,
        "fluid": fluid_desc,
        "front": front_desc,
        "boundarySidecar": {
            "identity": BOUNDARY_OVERRIDE_IDENTITY,
            "boundary": boundary_desc,
            "meta": meta_desc,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dense-cue-pack-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--out", default="")
    parser.add_argument("--learned-strength", type=lambda value: parse_float_arg(value, "--learned-strength", 0.0, 2.0), default=1.0)
    parser.add_argument("--support-classifier-gain", type=lambda value: parse_float_arg(value, "--support-classifier-gain"), default=1.0)
    parser.add_argument("--support-scalar-gain", type=lambda value: parse_float_arg(value, "--support-scalar-gain"), default=0.35)
    parser.add_argument("--coverage-classifier-gain", type=lambda value: parse_float_arg(value, "--coverage-classifier-gain"), default=0.35)
    parser.add_argument("--coverage-scalar-gain", type=lambda value: parse_float_arg(value, "--coverage-scalar-gain"), default=1.0)
    parser.add_argument("--ridge-classifier-gain", type=lambda value: parse_float_arg(value, "--ridge-classifier-gain"), default=0.65)
    parser.add_argument("--ridge-scalar-gain", type=lambda value: parse_float_arg(value, "--ridge-scalar-gain"), default=1.0)
    parser.add_argument("--proximity-classifier-gain", type=lambda value: parse_float_arg(value, "--proximity-classifier-gain"), default=1.0)
    parser.add_argument("--proximity-scalar-gain", type=lambda value: parse_float_arg(value, "--proximity-scalar-gain"), default=0.35)
    args = parser.parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_path = Path(args.out).resolve() if args.out else out_dir / "manifest.json"
    phase = "start"
    evidence: dict[str, Any] = {}
    try:
        phase = "manifest-read"
        dense_path = Path(args.dense_cue_pack_manifest).resolve()
        dense = read_json(dense_path)
        if dense.get("schema") != "kaminos.volume.learned-sparse-cue-pack.v0" or dense.get("status") != "captured":
            raise ApplyFailure("manifest-validate", "Dense cue pack schema/status mismatch.", {
                "schema": dense.get("schema"),
                "status": dense.get("status"),
            })
        corpus_path = Path(str((dense.get("source") or {}).get("corpusManifest") or "")).resolve()
        corpus = read_json(corpus_path)
        high_manifest_path = Path(str((((corpus.get("truthHighTarget") or {}).get("boundarySidecar") or {}).get("manifest") or ""))).resolve()
        high_manifest = read_json(high_manifest_path)
        high_grid = int((dense.get("grid") or {}).get("highGrid") or high_manifest.get("grid") or 0)
        low_grid = int((dense.get("grid") or {}).get("lowGrid") or 0)
        if high_grid <= 0 or low_grid <= 0:
            raise ApplyFailure("manifest-validate", "Dense cue pack grid metadata missing.", {"grid": dense.get("grid")})
        high_cells = high_grid ** 3
        truth_side, truth_meta, _, truth_boundary = load_split_boundary(high_manifest_path, "truthHigh")
        low_desc = (((corpus.get("downsampledHighInput") or {}).get("sidecars") or {}).get("boundary"))
        if not low_desc:
            raise ApplyFailure("manifest-validate", "Corpus missing downsampled-high boundary input.", {"corpusManifest": str(corpus_path)})
        low_raw = load_array(low_desc, corpus_path.parent, "lowInput")
        low_high = low_to_high_nearest(np.asarray(low_raw), high_grid)
        arrays = dense.get("arrays") or {}
        scalar = flatten_grid(load_array(arrays.get("scalarMlpCue") or {}, dense_path.parent, "scalarMlpCue"), 4, "scalarMlpCue")
        classifier = flatten_grid(load_array(arrays.get("classifierProbabilityCues") or {}, dense_path.parent, "classifierProbabilityCues"), 4, "classifierProbabilityCues")
        if truth_side.shape[0] != high_cells or low_high.shape[0] != high_cells or scalar.shape[0] != high_cells or classifier.shape[0] != high_cells:
            raise ApplyFailure("shape-validate", "Input sidecars do not share the high-grid cell count.", {
                "highCells": high_cells,
                "truthCells": int(truth_side.shape[0]),
                "lowCells": int(low_high.shape[0]),
                "scalarCells": int(scalar.shape[0]),
                "classifierCells": int(classifier.shape[0]),
            })
        out_dir.mkdir(parents=True, exist_ok=True)
        low_side = low_high[:, :4].astype(np.float32, copy=False)
        low_meta = low_high[:, 4:].astype(np.float32, copy=False)
        params = blend_parameters(args)
        pred_side, pred_meta, assembly = assemble_predicted_sidecar(low_high, scalar, classifier, params)
        truth_side_path = out_dir / "truthHigh-boundary-sidecar.f32"
        truth_meta_path = out_dir / "truthHigh-boundary-sidecar-meta.f32"
        low_side_path = out_dir / "lowUpsampled-boundary-sidecar.f32"
        low_meta_path = out_dir / "lowUpsampled-boundary-sidecar-meta.f32"
        pred_side_path = out_dir / "predictedHigh-boundary-sidecar.f32"
        pred_meta_path = out_dir / "predictedHigh-boundary-sidecar-meta.f32"
        phase = "sidecar-write"
        write_f32(truth_side_path, truth_side)
        write_f32(truth_meta_path, truth_meta)
        write_f32(low_side_path, low_side)
        write_f32(low_meta_path, low_meta)
        write_f32(pred_side_path, pred_side)
        write_f32(pred_meta_path, pred_meta)
        side_shape = [high_grid, high_grid, high_grid, 4]
        meta_shape = [high_grid, high_grid, high_grid, 4]
        high_sidecars = high_manifest.get("sidecars") or {}
        fluid_desc = high_sidecars.get("fluid")
        front_desc = high_sidecars.get("front")
        if not fluid_desc or not front_desc:
            raise ApplyFailure("manifest-validate", "High full-grid manifest missing fluid/front descriptors.", {"manifest": str(high_manifest_path)})
        manifest = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "capturedAt": now_iso(),
            "applicationAuthority": APPLICATION_AUTHORITY,
            "fieldAuthority": FIELD_AUTHORITY,
            "boundaryReceiverIdentity": BOUNDARY_OVERRIDE_IDENTITY,
            "completeFieldCoverage": True,
            "truthFluidFrontSidecarOnlyDiagnostic": True,
            "denseCuePackManifest": str(dense_path),
            "denseCuePackSha256": sha256_file(dense_path),
            "corpusManifest": str(corpus_path),
            "highFullGridManifest": str(high_manifest_path),
            "routeIdentity": high_manifest.get("routeIdentity"),
            "effectiveRoute": high_manifest.get("effectiveRoute"),
            "prototypeIdentity": high_manifest.get("prototypeIdentity"),
            "backend": high_manifest.get("backend"),
            "deterministicReplay": high_manifest.get("deterministicReplay"),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "gridScaleRatio": float(high_grid) / float(low_grid),
            "learnedCueFamily": dense.get("learnedCueFamily"),
            "scalarMlpCue": arrays.get("scalarMlpCue"),
            "classifierProbabilityCues": arrays.get("classifierProbabilityCues"),
            "assembly": assembly,
            "blendParameters": params,
            "roles": {
                "truthHigh": role(
                    fluid_desc,
                    front_desc,
                    descriptor(truth_side_path, side_shape, SIDE_CHANNELS, "boundary"),
                    descriptor(truth_meta_path, meta_shape, META_CHANNELS, "boundaryMeta"),
                    "truthHigh",
                ),
                "lowUpsampled": role(
                    fluid_desc,
                    front_desc,
                    descriptor(low_side_path, side_shape, SIDE_CHANNELS, "boundary"),
                    descriptor(low_meta_path, meta_shape, META_CHANNELS, "boundaryMeta"),
                    "lowUpsampled",
                ),
                "predictedHigh": role(
                    fluid_desc,
                    front_desc,
                    descriptor(pred_side_path, side_shape, SIDE_CHANNELS, "boundary"),
                    descriptor(pred_meta_path, meta_shape, META_CHANNELS, "boundaryMeta"),
                    "predictedHigh",
                ),
            },
            "truthHigh": {
                "boundarySidecarIdentity": truth_boundary.get("identity"),
                "boundarySidecarAuthority": truth_boundary.get("authority"),
            },
            "limitations": [
                "Fluid/front buffers are fixed to the truth-high export for all roles; this isolates boundary sidecar visual influence.",
                "Predicted sidecar is phase-aligned teacher-domain output, not native-low deployment proof.",
                "Renderer inspection still needs browser witness before visual/product claims.",
            ],
        }
        phase = "manifest-write"
        write_json(out_path, manifest)
        print(json.dumps({"ok": True, "manifest": str(out_path), "roles": list(manifest["roles"].keys())}, indent=2))
        return 0
    except ApplyFailure as err:
        failure = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failure",
            "failurePhase": err.phase,
            "capturedAt": now_iso(),
            "applicationAuthority": APPLICATION_AUTHORITY,
            "fieldAuthority": FIELD_AUTHORITY,
            "message": str(err),
            "evidence": {**evidence, **err.evidence},
        }
        write_json(out_path, failure)
        print(json.dumps(failure, indent=2), file=sys.stderr)
        return 2
    except Exception as err:
        failure = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failure",
            "failurePhase": phase,
            "capturedAt": now_iso(),
            "applicationAuthority": APPLICATION_AUTHORITY,
            "fieldAuthority": FIELD_AUTHORITY,
            "message": str(err),
            "evidence": evidence,
        }
        write_json(out_path, failure)
        print(json.dumps(failure, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
