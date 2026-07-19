#!/usr/bin/env python3
"""Characterize an explicit material-density basis for missing Grid96 Non-Ridge rows.

This is a separately labeled source assay, not a fallback for the structure
normal socket. It emits every source parent with explicit cohort validity and
does not compose bases, choose widths, change support, or inspect target images.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np


ROOT = Path(__file__).resolve().parent
BASE_PATH = ROOT / "volume-grid96-covariance-regime-characterizer.py"
spec = importlib.util.spec_from_file_location("kaminos_grid96_covariance_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"could not load Grid96 covariance validator from {BASE_PATH}")
BASE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(BASE)

REPORT_SCHEMA = "kaminos.volume.grid96-nonridge-material-basis-characterization.v0"
MANIFEST_SCHEMA = "kaminos.volume.grid96-nonridge-material-basis-socket.v0"
EXACT_SOURCE_RECEIPT_SCHEMA = "kaminos.volume.grid96-exact-component-pair-receipt.v0"
BASIS_IDENTITY = "material-density-gradient-flow-tangent-plane-v0"
COHORT_IDENTITY = "structure-normal-undeclared-positive-nonridge-v0"
NORMAL_SOURCE = "gradient.material.x"
FALLBACK_POLICY = "none-separate-cohort-only-v0"
REASON_IDENTITY = "grid96-nonridge-material-basis-reasons-v0"
REASON_CODES = {
    "valid": 0,
    "declaredStructureNormal": 1,
    "zeroNonRidgeWeight": 2,
    "gradientZero": 3,
    "tangentZero": 4,
    "parallel": 5,
}
BASIS_ORDER = (
    "center.x", "center.y", "center.z",
    "tangent.x", "tangent.y", "tangent.z",
    "normal.x", "normal.y", "normal.z",
    "binormal.x", "binormal.y", "binormal.z",
    "gradientMagnitude", "tangentPlaneConditioning", "nonRidgeOpticalWeight",
    "basis.valid", "cohort.missingStructureNormal",
)
REQUIRED_DESCRIPTOR_NAMES = (
    "position.world.x", "position.world.y", "position.world.z",
    "kernel.firstMoment.x", "kernel.firstMoment.y", "kernel.firstMoment.z",
    "structure.normal.x", "structure.normal.y", "structure.normal.z", "structure.normalValid",
    "flow.tangent.x", "flow.tangent.y", "flow.tangent.z",
    "gradient.material.x.x", "gradient.material.x.y", "gradient.material.x.z",
    "value.sidecar.x", "value.sidecar.y", "value.sidecar.z", "value.sidecar.w",
    "value.material.x", "value.fire.x",
)
QUANTILES = (0.0, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1.0)
QUANTILE_LABELS = ("p00", "p01", "p10", "p25", "p50", "p75", "p90", "p99", "p100")
CLAIM_BOUNDARY = {
    "targetImageUsed": False,
    "supportRedefined": False,
    "coefficientsChanged": False,
    "fallbackInstalled": False,
    "composedWithStructureBasis": False,
    "widthsChosen": False,
    "childCountChosen": False,
    "capInstalled": False,
    "notRendererVerdict": True,
    "notRuntimeEstimate": True,
    "notLearnerCampaign": True,
}


require = BASE.require


def load_exact_source_receipt(path: Path) -> dict[str, Any]:
    receipt = BASE.load_json(path, "exact-source receipt")
    require(receipt.get("schema") == EXACT_SOURCE_RECEIPT_SCHEMA, "exact-source receipt schema drifted")
    for field in (
        "descriptorManifestSha256", "coefficientManifestSha256",
        "descriptorArtifactSha256", "coefficientArtifactSha256",
        "nativeCellIndexSha256", "componentSourceManifestSha256",
        "descriptorSourceManifestSha256",
    ):
        require(BASE.is_sha256(receipt.get(field)), f"exact-source receipt {field} is invalid")
    for field in ("sameStateCaptureId", "requestedControlIdentity", "effectiveControlIdentity"):
        require(isinstance(receipt.get(field), str) and receipt[field], f"exact-source receipt {field} is invalid")
    require(
        receipt["requestedControlIdentity"] == receipt["effectiveControlIdentity"],
        "exact-source receipt control identity drifted",
    )
    return receipt


def validate_exact_source_admission(
    receipt_path: Path,
    receipt: dict[str, Any],
    descriptor_manifest_path: Path,
    coefficient_manifest_path: Path,
    descriptor_manifest: dict[str, Any] | None = None,
    coefficient_manifest: dict[str, Any] | None = None,
) -> None:
    require(
        BASE.sha256_file(descriptor_manifest_path) == receipt["descriptorManifestSha256"],
        "descriptor manifest SHA-256 does not match exact-source receipt",
    )
    require(
        BASE.sha256_file(coefficient_manifest_path) == receipt["coefficientManifestSha256"],
        "coefficient manifest SHA-256 does not match exact-source receipt",
    )
    if descriptor_manifest is None or coefficient_manifest is None:
        return
    descriptor_artifact = descriptor_manifest["artifact"]
    coefficient_artifact = coefficient_manifest["artifact"]
    checks = (
        (descriptor_artifact.get("sha256"), receipt["descriptorArtifactSha256"], "descriptor artifact"),
        (coefficient_artifact.get("sha256"), receipt["coefficientArtifactSha256"], "coefficient artifact"),
        (descriptor_manifest.get("nativeCellIndexSha256"), receipt["nativeCellIndexSha256"], "native-cell index"),
        (descriptor_manifest.get("sameStateCaptureId"), receipt["sameStateCaptureId"], "same-state capture"),
        (descriptor_manifest.get("requestedControlIdentity"), receipt["requestedControlIdentity"], "requested control"),
        (descriptor_manifest.get("effectiveControlIdentity"), receipt["effectiveControlIdentity"], "effective control"),
        (descriptor_manifest.get("sourceManifestSha256"), receipt["componentSourceManifestSha256"], "component source manifest"),
        (descriptor_artifact.get("sourceManifestSha256"), receipt["descriptorSourceManifestSha256"], "descriptor source manifest"),
    )
    for actual, expected, label in checks:
        require(actual == expected, f"{label} does not match exact-source receipt")
    require(receipt_path.is_file(), "exact-source receipt disappeared during validation")


def normalize_rows(vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    values = np.asarray(vectors, dtype=np.float64)
    require(values.ndim == 2 and values.shape[1] == 3, "vectors must have shape [rows,3]")
    lengths = np.linalg.norm(values, axis=1)
    valid = np.all(np.isfinite(values), axis=1) & np.isfinite(lengths) & (lengths > 1e-12)
    normalized = np.zeros_like(values)
    normalized[valid] = values[valid] / lengths[valid, None]
    return normalized, valid, lengths


def weighted_quantiles(values: np.ndarray, weights: np.ndarray) -> dict[str, float] | None:
    values = np.asarray(values, dtype=np.float64)
    weights = np.asarray(weights, dtype=np.float64)
    eligible = np.isfinite(values) & np.isfinite(weights) & (weights > 0.0)
    if not np.any(eligible):
        return None
    selected_values = values[eligible]
    selected_weights = weights[eligible]
    order = np.argsort(selected_values, kind="stable")
    selected_values = selected_values[order]
    cumulative = np.cumsum(selected_weights[order], dtype=np.float64)
    total = float(cumulative[-1])
    result = {}
    for label, quantile in zip(QUANTILE_LABELS, QUANTILES, strict=True):
        index = min(int(np.searchsorted(cumulative, quantile * total, side="left")), selected_values.size - 1)
        result[label] = float(selected_values[index])
    return result


def weighted_summary(values: np.ndarray, weights: np.ndarray) -> dict[str, Any] | None:
    values = np.asarray(values, dtype=np.float64)
    weights = np.asarray(weights, dtype=np.float64)
    eligible = np.isfinite(values) & np.isfinite(weights) & (weights > 0.0)
    if not np.any(eligible):
        return None
    selected = values[eligible]
    selected_weights = weights[eligible]
    return {
        "count": int(selected.size),
        "totalWeight": float(np.sum(selected_weights, dtype=np.float64)),
        "mean": float(np.average(selected, weights=selected_weights)),
        "minimum": float(np.min(selected)),
        "maximum": float(np.max(selected)),
        "quantiles": weighted_quantiles(selected, selected_weights),
    }


def derive_material_basis(
    structure_normal_declared: np.ndarray,
    nonridge_weights: np.ndarray,
    gradients: np.ndarray,
    tangents: np.ndarray,
    *,
    conditioning_epsilon: float,
) -> dict[str, np.ndarray]:
    declared = np.asarray(structure_normal_declared, dtype=bool)
    weights = np.asarray(nonridge_weights, dtype=np.float64)
    gradient_unit, gradient_valid, gradient_magnitude = normalize_rows(gradients)
    tangent_unit, tangent_valid, _ = normalize_rows(tangents)
    require(declared.shape == weights.shape == gradient_valid.shape == tangent_valid.shape, "basis inputs are row-misaligned")
    require(np.all(np.isfinite(weights)) and np.all(weights >= 0.0), "Non-Ridge weights are invalid")

    projected = tangent_unit - gradient_unit * np.sum(tangent_unit * gradient_unit, axis=1)[:, None]
    projected_unit, projected_valid, conditioning = normalize_rows(projected)
    candidate = ~declared & (weights > 0.0)
    valid = candidate & gradient_valid & tangent_valid & projected_valid & (conditioning > conditioning_epsilon)
    normal = np.zeros_like(gradient_unit)
    tangent = np.zeros_like(projected_unit)
    binormal = np.zeros_like(projected_unit)
    normal[valid] = gradient_unit[valid]
    tangent[valid] = projected_unit[valid]
    binormal[valid] = np.cross(normal[valid], tangent[valid])
    binormal_unit, binormal_valid, _ = normalize_rows(binormal)
    require(np.array_equal(valid, valid & binormal_valid), "valid basis produced a degenerate binormal")
    binormal[valid] = binormal_unit[valid]

    reasons = np.full(weights.size, REASON_CODES["valid"], dtype=np.uint8)
    reasons[declared] = REASON_CODES["declaredStructureNormal"]
    reasons[~declared & (weights <= 0.0)] = REASON_CODES["zeroNonRidgeWeight"]
    reasons[candidate & ~gradient_valid] = REASON_CODES["gradientZero"]
    reasons[candidate & gradient_valid & ~tangent_valid] = REASON_CODES["tangentZero"]
    reasons[candidate & gradient_valid & tangent_valid & (~projected_valid | (conditioning <= conditioning_epsilon))] = REASON_CODES["parallel"]
    require(np.array_equal(valid, reasons == REASON_CODES["valid"]), "reason codes disagree with basis validity")

    orthogonality = np.zeros(weights.size, dtype=np.float64)
    if np.any(valid):
        orthogonality[valid] = np.maximum.reduce((
            np.abs(np.sum(tangent[valid] * normal[valid], axis=1)),
            np.abs(np.sum(tangent[valid] * binormal[valid], axis=1)),
            np.abs(np.sum(normal[valid] * binormal[valid], axis=1)),
            np.abs(np.linalg.norm(tangent[valid], axis=1) - 1.0),
            np.abs(np.linalg.norm(normal[valid], axis=1) - 1.0),
            np.abs(np.linalg.norm(binormal[valid], axis=1) - 1.0),
        ))
    return {
        "valid": valid,
        "reasonCodes": reasons,
        "normal": normal,
        "tangent": tangent,
        "binormal": binormal,
        "gradientMagnitude": gradient_magnitude,
        "conditioning": conditioning,
        "orthogonalityResidual": orthogonality,
        "fallbackUsed": np.zeros(weights.size, dtype=bool),
    }


def source_receipt(
    exact_source_receipt_path: Path,
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
        "exactSourceReceiptPath": str(exact_source_receipt_path),
        "exactSourceReceiptSha256": BASE.sha256_file(exact_source_receipt_path),
        "sourceHashes": descriptor_artifact["sourceHashes"],
        "validatorDependency": {"path": str(BASE_PATH), "sha256": BASE.sha256_file(BASE_PATH)},
    }


def artifact_receipt(path: Path, dtype: str, shape: list[int], semantic_role: str) -> dict[str, Any]:
    return {
        "path": str(path), "bytes": path.stat().st_size, "sha256": BASE.sha256_file(path),
        "dtype": dtype, "shape": shape, "semanticRole": semantic_role,
    }


def analyze(
    descriptors: np.ndarray,
    coefficients: np.ndarray,
    native_ids: np.ndarray,
    lookup: dict[str, int],
    *,
    conditioning_epsilon: float,
) -> dict[str, Any]:
    for name in REQUIRED_DESCRIPTOR_NAMES:
        require(name in lookup, f"descriptor order is missing {name}")
    ridge_weights, nonridge_weights = BASE.layer_optical_weights(coefficients)
    declared = descriptors[:, lookup["structure.normalValid"]] > 0.5
    gradient = descriptors[:, [lookup["gradient.material.x.x"], lookup["gradient.material.x.y"], lookup["gradient.material.x.z"]]]
    tangent = descriptors[:, [lookup["flow.tangent.x"], lookup["flow.tangent.y"], lookup["flow.tangent.z"]]]
    frame = derive_material_basis(declared, nonridge_weights, gradient, tangent, conditioning_epsilon=conditioning_epsilon)
    valid = frame["valid"]
    missing = ~declared & (nonridge_weights > 0.0)
    require(not np.any(frame["fallbackUsed"]), "material basis used fallback")

    centers = descriptors[:, [lookup["position.world.x"], lookup["position.world.y"], lookup["position.world.z"]]].astype(np.float64)
    centers += descriptors[:, [lookup["kernel.firstMoment.x"], lookup["kernel.firstMoment.y"], lookup["kernel.firstMoment.z"]]].astype(np.float64)
    basis = np.column_stack((
        centers, frame["tangent"], frame["normal"], frame["binormal"],
        frame["gradientMagnitude"], frame["conditioning"], nonridge_weights,
        valid.astype(np.float64), missing.astype(np.float64),
    )).astype("<f4")
    require(basis.shape == (native_ids.size, len(BASIS_ORDER)), "basis artifact shape is invalid")
    require(np.all(np.isfinite(basis)), "basis artifact contains nonfinite values")

    missing_mass = float(np.sum(nonridge_weights[missing], dtype=np.float64))
    total_mass = float(np.sum(nonridge_weights, dtype=np.float64))
    valid_mass = float(np.sum(nonridge_weights[valid], dtype=np.float64))
    require(missing_mass > 0.0 and total_mass > 0.0, "Non-Ridge cohort has zero optical mass")
    reason_counts = {name: int(np.count_nonzero(frame["reasonCodes"] == code)) for name, code in REASON_CODES.items()}

    structure_normal = descriptors[:, [lookup["structure.normal.x"], lookup["structure.normal.y"], lookup["structure.normal.z"]]]
    structure_unit, structure_vector_valid, _ = normalize_rows(structure_normal)
    gradient_unit, gradient_valid, _ = normalize_rows(gradient)
    overlap = declared & structure_vector_valid & gradient_valid
    agreement = np.abs(np.sum(structure_unit * gradient_unit, axis=1))

    profile_names = (
        "value.sidecar.x", "value.sidecar.y", "value.sidecar.z", "value.sidecar.w",
        "value.material.x", "value.fire.x",
    )
    profile = {
        name: {
            "missingNonRidge": weighted_summary(descriptors[:, lookup[name]], nonridge_weights * missing),
            "declaredNormalNonRidge": weighted_summary(descriptors[:, lookup[name]], nonridge_weights * declared),
        }
        for name in profile_names
    }
    coverage = {
        "basisValidRowCount": int(np.count_nonzero(valid)),
        "basisValidRowFraction": float(np.mean(valid)),
        "missingCohortRowCount": int(np.count_nonzero(missing)),
        "missingNonRidgeOpticalMass": missing_mass,
        "totalNonRidgeOpticalMass": total_mass,
        "validCandidateOpticalMass": valid_mass,
        "missingNonRidgeMassRecoveryFraction": valid_mass / missing_mass,
        "totalNonRidgeMassCoverageFraction": valid_mass / total_mass,
        "reasonCounts": reason_counts,
    }
    quality = {
        "candidateGradientMagnitude": weighted_summary(frame["gradientMagnitude"], nonridge_weights * valid),
        "candidateTangentPlaneConditioning": weighted_summary(frame["conditioning"], nonridge_weights * valid),
        "candidateOrthogonalityResidual": weighted_summary(frame["orthogonalityResidual"], nonridge_weights * valid),
    }
    overlap_agreement = {
        "rowCount": int(np.count_nonzero(overlap)),
        "ridgeWeightedAbsDot": weighted_summary(agreement, ridge_weights * overlap),
        "nonRidgeWeightedAbsDot": weighted_summary(agreement, nonridge_weights * overlap),
    }
    return {
        "basis": basis, "reasonCodes": frame["reasonCodes"], "coverage": coverage,
        "quality": quality, "overlapAgreement": overlap_agreement, "cohortProfile": profile,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--descriptor-manifest", type=Path, required=True)
    parser.add_argument("--coefficient-manifest", type=Path, required=True)
    parser.add_argument("--exact-source-receipt", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--conditioning-epsilon", type=float, default=1e-6)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    manifest_path = output_dir / "grid96-nonridge-material-basis-manifest.json"
    basis_path = output_dir / "grid96-nonridge-material-basis.f32"
    reason_path = output_dir / "grid96-nonridge-material-basis-reasons.u8"
    native_path = output_dir / "grid96-nonridge-material-basis-native-cell-index.u32"
    primary_paths = (manifest_path, basis_path, reason_path, native_path)
    for path in primary_paths:
        path.unlink(missing_ok=True)
    started = time.time()
    failure_phase = "source-validation"
    try:
        require(math.isfinite(args.conditioning_epsilon) and 0.0 < args.conditioning_epsilon < 1.0, "conditioning epsilon must be in (0,1)")
        descriptor_manifest_path = args.descriptor_manifest.resolve()
        coefficient_manifest_path = args.coefficient_manifest.resolve()
        exact_source_receipt_path = args.exact_source_receipt.resolve()
        exact_source_receipt = load_exact_source_receipt(exact_source_receipt_path)
        validate_exact_source_admission(
            exact_source_receipt_path, exact_source_receipt,
            descriptor_manifest_path, coefficient_manifest_path,
        )
        descriptor_manifest, coefficient_manifest, descriptors, coefficients, native_ids, lookup = BASE.validate_component_pair(
            descriptor_manifest_path, coefficient_manifest_path
        )
        validate_exact_source_admission(
            exact_source_receipt_path, exact_source_receipt,
            descriptor_manifest_path, coefficient_manifest_path,
            descriptor_manifest, coefficient_manifest,
        )
        source = source_receipt(
            exact_source_receipt_path, descriptor_manifest_path, coefficient_manifest_path,
            descriptor_manifest, coefficient_manifest,
        )

        failure_phase = "basis-analysis"
        result = analyze(descriptors, coefficients, native_ids, lookup, conditioning_epsilon=args.conditioning_epsilon)

        failure_phase = "artifact-write"
        result["basis"].tofile(basis_path)
        np.asarray(result["reasonCodes"], dtype=np.uint8).tofile(reason_path)
        np.asarray(native_ids, dtype="<u4").tofile(native_path)
        artifacts = {
            "basis": artifact_receipt(basis_path, "float32-le", [int(native_ids.size), len(BASIS_ORDER)], "separate-material-density-gradient-nonridge-frame"),
            "reasonCodes": artifact_receipt(reason_path, "uint8", [int(native_ids.size)], "explicit-material-basis-cohort-invalidity-reason"),
            "nativeCellIndex": artifact_receipt(native_path, "uint32-le", [int(native_ids.size)], "caller-ordered-native-cell-index"),
        }
        basis_contract = {
            "identity": BASIS_IDENTITY, "order": list(BASIS_ORDER), "normalSource": NORMAL_SOURCE,
            "cohort": COHORT_IDENTITY, "conditioningEpsilon": args.conditioning_epsilon,
            "fallbackPolicy": FALLBACK_POLICY, "reasonIdentity": REASON_IDENTITY, "reasonCodes": REASON_CODES,
        }
        execution = {"rowCount": int(native_ids.size), "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "targetImageUsed": False}
        manifest_payload = {
            "schema": MANIFEST_SCHEMA, "status": "complete", "source": source, "basis": basis_contract,
            "coverage": result["coverage"], "overlapAgreement": result["overlapAgreement"],
            "artifacts": artifacts, "execution": execution, "claimBoundary": CLAIM_BOUNDARY,
        }
        manifest_payload["identity"] = "sha256:" + BASE.sha256_bytes(BASE.canonical_json(manifest_payload).encode("utf-8"))
        manifest_path.write_text(json.dumps(manifest_payload, indent=2, sort_keys=True) + "\n")
        report = {
            "schema": REPORT_SCHEMA, "status": "complete", "failurePhase": None,
            "startedAtUnix": started, "finishedAtUnix": time.time(), "source": source,
            "controls": {"conditioningEpsilon": args.conditioning_epsilon}, "basis": basis_contract,
            "coverage": result["coverage"], "quality": result["quality"],
            "overlapAgreement": result["overlapAgreement"], "cohortProfile": result["cohortProfile"],
            "artifacts": artifacts,
            "manifest": {"path": str(manifest_path), "sha256": BASE.sha256_file(manifest_path), "identity": manifest_payload["identity"]},
            "execution": execution, "claimBoundary": CLAIM_BOUNDARY,
        }
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"ok": True, "report": str(report_path), "manifest": str(manifest_path), "basisValidRowCount": result["coverage"]["basisValidRowCount"]}))
        return 0
    except Exception as exc:
        for path in primary_paths:
            path.unlink(missing_ok=True)
        failed = {
            "schema": REPORT_SCHEMA, "status": "failed", "failurePhase": failure_phase,
            "startedAtUnix": started, "finishedAtUnix": time.time(),
            "requested": {"descriptorManifest": str(args.descriptor_manifest), "coefficientManifest": str(args.coefficient_manifest), "exactSourceReceipt": str(args.exact_source_receipt), "outputDir": str(args.output_dir), "conditioningEpsilon": args.conditioning_epsilon},
            "error": {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()},
            "claimBoundary": CLAIM_BOUNDARY,
        }
        report_path.write_text(json.dumps(failed, indent=2, sort_keys=True) + "\n")
        print(f"Grid96 Non-Ridge material-basis characterization failed at {failure_phase}: {exc}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
