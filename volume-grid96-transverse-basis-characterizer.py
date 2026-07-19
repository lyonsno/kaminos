#!/usr/bin/env python3
"""Characterize an independent Grid96 transverse frame without rendering.

The socket uses only declared source normals and flow tangents from the frozen
descriptor corpus. Invalid or parallel rows remain invalid; no fallback frame,
width, child count, cap, or deposition policy is installed.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np


BASE_PATH = Path(__file__).with_name("volume-grid96-covariance-regime-characterizer.py")
_SPEC = importlib.util.spec_from_file_location("kaminos_grid96_covariance_base", BASE_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError(f"could not load Grid96 source contract dependency: {BASE_PATH}")
BASE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(BASE)

REPORT_SCHEMA = "kaminos.volume.grid96-transverse-basis-characterization.v0"
MANIFEST_SCHEMA = "kaminos.volume.grid96-transverse-basis-socket.v0"
BASIS_IDENTITY = "declared-normal-flow-tangent-orthonormal-frame-v0"
FALLBACK_POLICY = "none-invalid-rows-remain-invalid-v0"
REASON_IDENTITY = "grid96-transverse-basis-reason-codes-v0"
REASON_CODES = {
    "valid": 0,
    "normalUndeclared": 1,
    "normalZero": 2,
    "tangentZero": 3,
    "parallel": 4,
}
BASIS_ORDER = (
    "center.x", "center.y", "center.z",
    "tangent.x", "tangent.y", "tangent.z",
    "normal.x", "normal.y", "normal.z",
    "binormal.x", "binormal.y", "binormal.z",
    "radiusWorld", "flowCoherence", "tangentPlaneConditioning",
    "orthogonalityResidual", "ridgeOpticalWeight", "nonRidgeOpticalWeight",
    "opticalWeight", "basis.valid", "structure.normalDeclaredValid",
)
CLAIM_BOUNDARY = {
    "targetImageUsed": False,
    "widthsChosen": False,
    "childCountChosen": False,
    "capInstalled": False,
    "fallbackInstalled": False,
    "supportRedefined": False,
    "coefficientsChanged": False,
    "notRendererVerdict": True,
    "notRuntimeEstimate": True,
    "notLearnerCampaign": True,
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def derive_transverse_basis(
    normals: np.ndarray,
    normal_declared_valid: np.ndarray,
    tangents: np.ndarray,
    *,
    conditioning_epsilon: float,
) -> dict[str, np.ndarray]:
    """Return a no-fallback orthonormal frame and explicit reason per row."""

    normal_values = np.asarray(normals, dtype=np.float64)
    tangent_values = np.asarray(tangents, dtype=np.float64)
    declared = np.asarray(normal_declared_valid, dtype=bool)
    require(normal_values.ndim == 2 and normal_values.shape[1] == 3, "normals must have shape [rows,3]")
    require(tangent_values.shape == normal_values.shape, "tangents must match normal shape")
    require(declared.ndim == 1 and declared.size == normal_values.shape[0], "normal validity rows must align")
    require(math.isfinite(conditioning_epsilon) and 0.0 < conditioning_epsilon < 1.0, "conditioning epsilon must be in (0,1)")

    normal_unit, normal_vector_valid = BASE.normalize_rows(normal_values)
    tangent_unit, tangent_vector_valid = BASE.normalize_rows(tangent_values)
    projected = tangent_unit - np.sum(tangent_unit * normal_unit, axis=1)[:, None] * normal_unit
    conditioning = np.linalg.norm(projected, axis=1)
    finite_conditioning = np.isfinite(conditioning)
    basis_valid = declared & normal_vector_valid & tangent_vector_valid & finite_conditioning & (conditioning > conditioning_epsilon)

    tangent_frame = np.zeros_like(tangent_unit)
    tangent_frame[basis_valid] = projected[basis_valid] / conditioning[basis_valid, None]
    normal_frame = np.zeros_like(normal_unit)
    normal_frame[declared & normal_vector_valid] = normal_unit[declared & normal_vector_valid]
    binormal_frame = np.zeros_like(normal_unit)
    binormal_frame[basis_valid] = np.cross(normal_frame[basis_valid], tangent_frame[basis_valid])
    binormal_lengths = np.linalg.norm(binormal_frame, axis=1)
    binormal_valid = np.isfinite(binormal_lengths) & (binormal_lengths > conditioning_epsilon)
    require(np.all(binormal_valid[basis_valid]), "conditioned basis produced a degenerate binormal")
    binormal_frame[basis_valid] /= binormal_lengths[basis_valid, None]

    reason_code = np.full(declared.size, REASON_CODES["valid"], dtype=np.uint8)
    reason_code[~declared] = REASON_CODES["normalUndeclared"]
    reason_code[declared & ~normal_vector_valid] = REASON_CODES["normalZero"]
    reason_code[declared & normal_vector_valid & ~tangent_vector_valid] = REASON_CODES["tangentZero"]
    reason_code[
        declared & normal_vector_valid & tangent_vector_valid
        & (~finite_conditioning | (conditioning <= conditioning_epsilon))
    ] = REASON_CODES["parallel"]
    require(np.array_equal(reason_code == REASON_CODES["valid"], basis_valid), "basis validity and reason codes disagree")

    orthogonality = np.zeros(declared.size, dtype=np.float64)
    if np.any(basis_valid):
        residuals = np.column_stack((
            np.abs(np.sum(tangent_frame[basis_valid] * normal_frame[basis_valid], axis=1)),
            np.abs(np.sum(tangent_frame[basis_valid] * binormal_frame[basis_valid], axis=1)),
            np.abs(np.sum(normal_frame[basis_valid] * binormal_frame[basis_valid], axis=1)),
            np.abs(np.linalg.norm(tangent_frame[basis_valid], axis=1) - 1.0),
            np.abs(np.linalg.norm(normal_frame[basis_valid], axis=1) - 1.0),
            np.abs(np.linalg.norm(binormal_frame[basis_valid], axis=1) - 1.0),
        ))
        orthogonality[basis_valid] = np.max(residuals, axis=1)
    return {
        "tangent": tangent_frame,
        "normal": normal_frame,
        "binormal": binormal_frame,
        "conditioning": np.where(finite_conditioning, conditioning, 0.0),
        "orthogonalityResidual": orthogonality,
        "basisValid": basis_valid,
        "reasonCode": reason_code,
        "fallbackUsed": np.zeros(declared.size, dtype=bool),
        "normalVectorValid": normal_vector_valid,
        "tangentVectorValid": tangent_vector_valid,
    }


def mass_coverage(weights: np.ndarray, valid: np.ndarray) -> dict[str, Any]:
    mass = np.asarray(weights, dtype=np.float64)
    mask = np.asarray(valid, dtype=bool)
    require(mass.ndim == mask.ndim == 1 and mass.size == mask.size, "coverage rows must align")
    require(np.all(np.isfinite(mass)) and np.all(mass >= 0.0), "coverage weights are invalid")
    total = float(np.sum(mass, dtype=np.float64))
    retained = float(np.sum(mass[mask], dtype=np.float64))
    return {
        "totalOpticalWeight": total,
        "validOpticalWeight": retained,
        "fraction": retained / total if total > 0.0 else None,
        "positiveRowCount": int(np.count_nonzero(mass > 0.0)),
        "validPositiveRowCount": int(np.count_nonzero((mass > 0.0) & mask)),
    }


def optional_summary(
    values: np.ndarray,
    native_ids: np.ndarray,
    mask: np.ndarray,
    weights: np.ndarray | None = None,
) -> dict[str, Any] | None:
    selected = np.asarray(mask, dtype=bool)
    if not np.any(selected):
        return None
    if weights is not None:
        selected_weights = np.asarray(weights, dtype=np.float64)[selected]
        if float(np.sum(selected_weights, dtype=np.float64)) <= 0.0:
            return None
    else:
        selected_weights = None
    return BASE.summarize(
        np.asarray(values, dtype=np.float64)[selected],
        np.asarray(native_ids, dtype=np.uint32)[selected],
        selected_weights,
    )


def analyze(
    descriptors: np.ndarray,
    coefficients: np.ndarray,
    native_ids: np.ndarray,
    lookup: dict[str, int],
    *,
    conditioning_epsilon: float,
) -> dict[str, Any]:
    normals = descriptors[:, [lookup["structure.normal.x"], lookup["structure.normal.y"], lookup["structure.normal.z"]]]
    declared = descriptors[:, lookup["structure.normalValid"]] > 0.5
    tangents = descriptors[:, [lookup["flow.tangent.x"], lookup["flow.tangent.y"], lookup["flow.tangent.z"]]]
    frame = derive_transverse_basis(normals, declared, tangents, conditioning_epsilon=conditioning_epsilon)
    ridge, nonridge = BASE.layer_optical_weights(coefficients)
    combined = ridge + nonridge
    require(float(np.sum(combined, dtype=np.float64)) > 0.0, "coefficient tensor has zero total optical weight")

    centers = descriptors[:, [lookup["position.world.x"], lookup["position.world.y"], lookup["position.world.z"]]].astype(np.float64)
    centers += descriptors[:, [lookup["kernel.firstMoment.x"], lookup["kernel.firstMoment.y"], lookup["kernel.firstMoment.z"]]]
    radius = descriptors[:, lookup["kernel.radiusWorld"]].astype(np.float64)
    flow_coherence = np.clip(descriptors[:, lookup["flow.coherence"]].astype(np.float64), 0.0, 1.0)
    require(np.all(np.isfinite(centers)), "basis centers are nonfinite")
    require(np.all(np.isfinite(radius)) and np.all(radius >= 0.0), "kernel radii are invalid")

    valid = frame["basisValid"]
    basis = np.column_stack((
        centers,
        frame["tangent"],
        frame["normal"],
        frame["binormal"],
        radius,
        flow_coherence,
        frame["conditioning"],
        frame["orthogonalityResidual"],
        ridge,
        nonridge,
        combined,
        valid.astype(np.float64),
        declared.astype(np.float64),
    )).astype("<f4")
    require(basis.shape == (native_ids.size, len(BASIS_ORDER)), "basis socket shape drifted")
    require(np.all(np.isfinite(basis)), "basis socket contains nonfinite values")

    reason_counts = {
        name: int(np.count_nonzero(frame["reasonCode"] == code)) for name, code in REASON_CODES.items()
    }
    coverage_detail = {
        "declaredNormalValidRowCount": int(np.count_nonzero(declared)),
        "normalVectorValidRowCount": int(np.count_nonzero(declared & frame["normalVectorValid"])),
        "tangentVectorValidRowCount": int(np.count_nonzero(frame["tangentVectorValid"])),
        "basisValidRowCount": int(np.count_nonzero(valid)),
        "basisValidRowFraction": float(np.mean(valid)),
        "reasonCounts": reason_counts,
        "opticalMass": {
            "ridge": mass_coverage(ridge, valid),
            "nonRidge": mass_coverage(nonridge, valid),
            "combined": mass_coverage(combined, valid),
        },
    }
    coverage_detail["opticalMassFraction"] = {
        name: detail["fraction"] for name, detail in coverage_detail["opticalMass"].items()
    }
    eligible = declared & frame["normalVectorValid"] & frame["tangentVectorValid"]
    normal_unit, _ = BASE.normalize_rows(normals)
    tangent_unit, _ = BASE.normalize_rows(tangents)
    raw_abs_dot = np.abs(np.sum(normal_unit * tangent_unit, axis=1))
    quality = {
        "rawTangentNormalAbsDot": {
            "unweighted": optional_summary(raw_abs_dot, native_ids, eligible),
            "ridgeWeighted": optional_summary(raw_abs_dot, native_ids, eligible, ridge),
            "nonRidgeWeighted": optional_summary(raw_abs_dot, native_ids, eligible, nonridge),
        },
        "tangentPlaneConditioning": {
            "unweighted": optional_summary(frame["conditioning"], native_ids, eligible),
            "ridgeWeighted": optional_summary(frame["conditioning"], native_ids, eligible, ridge),
            "nonRidgeWeighted": optional_summary(frame["conditioning"], native_ids, eligible, nonridge),
        },
        "validBasisOrthogonalityResidual": optional_summary(
            frame["orthogonalityResidual"], native_ids, valid
        ),
    }
    return {
        "basis": basis,
        "reasonCodes": frame["reasonCode"],
        "coverage": coverage_detail,
        "quality": quality,
    }


def artifact_receipt(path: Path, dtype: str, shape: list[int], semantic_role: str) -> dict[str, Any]:
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": BASE.sha256_file(path),
        "dtype": dtype,
        "shape": shape,
        "semanticRole": semantic_role,
    }


def source_receipt(
    descriptor_manifest_path: Path,
    coefficient_manifest_path: Path,
    descriptor_manifest: dict[str, Any],
    coefficient_manifest: dict[str, Any],
) -> dict[str, Any]:
    descriptor_artifact = descriptor_manifest["artifact"]
    coefficient_artifact = coefficient_manifest["artifact"]
    return {
        "grid": descriptor_manifest["grid"],
        "sameStateCaptureId": descriptor_manifest["sameStateCaptureId"],
        "simStepCount": descriptor_manifest["simStepCount"],
        "rowCount": descriptor_manifest["rowCount"],
        "route": descriptor_manifest["route"],
        "descriptorManifestPath": str(descriptor_manifest_path),
        "descriptorManifestSha256": BASE.sha256_file(descriptor_manifest_path),
        "descriptorArtifactSha256": descriptor_artifact["sha256"],
        "coefficientManifestPath": str(coefficient_manifest_path),
        "coefficientManifestSha256": BASE.sha256_file(coefficient_manifest_path),
        "coefficientArtifactSha256": coefficient_artifact["sha256"],
        "nativeCellIndexSha256": descriptor_manifest["nativeCellIndexSha256"],
        "componentSourceManifestSha256": descriptor_manifest["sourceManifestSha256"],
        "descriptorSourceManifestSha256": descriptor_artifact["sourceManifestSha256"],
        "sourceHashes": descriptor_artifact["sourceHashes"],
        "validatorDependency": {
            "path": str(BASE_PATH),
            "sha256": BASE.sha256_file(BASE_PATH),
        },
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--descriptor-manifest", type=Path, required=True)
    parser.add_argument("--coefficient-manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--conditioning-epsilon", type=float, default=1e-6)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    manifest_path = output_dir / "grid96-transverse-basis-manifest.json"
    basis_path = output_dir / "grid96-transverse-basis.f32"
    reason_path = output_dir / "grid96-transverse-basis-reasons.u8"
    native_path = output_dir / "grid96-transverse-basis-native-cell-index.u32"
    primary_paths = (manifest_path, basis_path, reason_path, native_path)
    for path in primary_paths:
        path.unlink(missing_ok=True)

    started = time.time()
    failure_phase = "source-validation"
    try:
        require(math.isfinite(args.conditioning_epsilon) and 0.0 < args.conditioning_epsilon < 1.0, "conditioning epsilon must be in (0,1)")
        descriptor_manifest_path = args.descriptor_manifest.resolve()
        coefficient_manifest_path = args.coefficient_manifest.resolve()
        (
            descriptor_manifest,
            coefficient_manifest,
            descriptors,
            coefficients,
            native_ids,
            lookup,
        ) = BASE.validate_component_pair(descriptor_manifest_path, coefficient_manifest_path)
        source = source_receipt(
            descriptor_manifest_path, coefficient_manifest_path, descriptor_manifest, coefficient_manifest
        )

        failure_phase = "basis-analysis"
        result = analyze(
            descriptors, coefficients, native_ids, lookup,
            conditioning_epsilon=args.conditioning_epsilon,
        )

        failure_phase = "artifact-write"
        result["basis"].tofile(basis_path)
        np.asarray(result["reasonCodes"], dtype=np.uint8).tofile(reason_path)
        np.asarray(native_ids, dtype="<u4").tofile(native_path)
        artifacts = {
            "basis": artifact_receipt(
                basis_path, "float32-le", [int(native_ids.size), len(BASIS_ORDER)],
                "camera-independent-source-derived-transverse-frame",
            ),
            "reasonCodes": artifact_receipt(
                reason_path, "uint8", [int(native_ids.size)], "explicit-transverse-frame-invalidity-reason",
            ),
            "nativeCellIndex": artifact_receipt(
                native_path, "uint32-le", [int(native_ids.size)], "caller-ordered-native-cell-index",
            ),
        }
        manifest_payload = {
            "schema": MANIFEST_SCHEMA,
            "status": "complete",
            "source": source,
            "basis": {
                "identity": BASIS_IDENTITY,
                "order": list(BASIS_ORDER),
                "conditioningEpsilon": args.conditioning_epsilon,
                "fallbackPolicy": FALLBACK_POLICY,
                "reasonIdentity": REASON_IDENTITY,
                "reasonCodes": REASON_CODES,
            },
            "coverage": result["coverage"],
            "artifacts": artifacts,
            "execution": {
                "rowCount": int(native_ids.size),
                "sampleCap": None,
                "droppedRowCount": 0,
                "fallbackRowCount": 0,
                "targetImageUsed": False,
            },
            "claimBoundary": CLAIM_BOUNDARY,
        }
        manifest_payload["identity"] = "sha256:" + BASE.sha256_bytes(
            BASE.canonical_json(manifest_payload).encode("utf-8")
        )
        manifest_path.write_text(json.dumps(manifest_payload, indent=2, sort_keys=True) + "\n")

        finished = time.time()
        report = {
            "schema": REPORT_SCHEMA,
            "status": "complete",
            "failurePhase": None,
            "startedAtUnix": started,
            "finishedAtUnix": finished,
            "source": source,
            "controls": {"conditioningEpsilon": args.conditioning_epsilon},
            "basis": manifest_payload["basis"],
            "coverage": result["coverage"],
            "quality": result["quality"],
            "artifacts": artifacts,
            "manifest": {
                "path": str(manifest_path),
                "sha256": BASE.sha256_file(manifest_path),
                "identity": manifest_payload["identity"],
            },
            "execution": manifest_payload["execution"],
            "claimBoundary": CLAIM_BOUNDARY,
        }
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({
            "ok": True,
            "report": str(report_path),
            "manifest": str(manifest_path),
            "basisValidRowCount": result["coverage"]["basisValidRowCount"],
        }))
        return 0
    except Exception as exc:
        for path in primary_paths:
            path.unlink(missing_ok=True)
        failed = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": failure_phase,
            "startedAtUnix": started,
            "finishedAtUnix": time.time(),
            "requested": {
                "descriptorManifest": str(args.descriptor_manifest),
                "coefficientManifest": str(args.coefficient_manifest),
                "outputDir": str(args.output_dir),
                "conditioningEpsilon": args.conditioning_epsilon,
            },
            "error": {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()},
            "claimBoundary": CLAIM_BOUNDARY,
        }
        report_path.write_text(json.dumps(failed, indent=2, sort_keys=True) + "\n")
        print(f"Grid96 transverse-basis characterization failed at {failure_phase}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
