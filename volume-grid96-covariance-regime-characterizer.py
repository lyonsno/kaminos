#!/usr/bin/env python3
"""Characterize frozen Grid96 kernel covariance without rendering or fitting.

The output is a source-bound consumer socket for footprint experiments. It
preserves caller row order and emits PSD-clamped kernel moments, eigenspectra,
optical weights, and deterministic regime labels. It does not compare images,
change support or coefficients, estimate runtime, or adjudicate a renderer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Iterable

import numpy as np


REPORT_SCHEMA = "kaminos.volume.grid96-covariance-regime-characterization.v0"
MANIFEST_SCHEMA = "kaminos.volume.grid96-covariance-regime-socket.v0"
COMPONENT_SCHEMA = "kaminos.volume.grid96-native-component.v0"
DESCRIPTOR_IDENTITY = "flow-kernel-local-descriptor-socket-v0"
KERNEL_IDENTITY = "flow-tangent-positive-symmetric-trilinear-v0"
COEFFICIENT_IDENTITY = "exact-local-layer-emission-extinction-v0"
COEFFICIENT_ORDER = (
    "ridge.emission.r",
    "ridge.emission.g",
    "ridge.emission.b",
    "ridge.extinction",
    "nonRidge.emission.r",
    "nonRidge.emission.g",
    "nonRidge.emission.b",
    "nonRidge.extinction",
)
ROW_ORDER_IDENTITY = "caller-ordered-native-cell-index-v0"
REGIME_IDENTITY = "psd-kernel-eigenspectrum-rank-regimes-v0"
REGIME_CODES = {"degenerate": 0, "rank1": 1, "sheet": 2, "volumetric": 3}
QUANTILES = (0.0, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1.0)
QUANTILE_LABELS = ("p00", "p01", "p10", "p25", "p50", "p75", "p90", "p99", "p100")
REQUIRED_DESCRIPTOR_NAMES = (
    "position.world.x",
    "position.world.y",
    "position.world.z",
    "position.nativeCellIndex",
    "kernel.normalizedMass",
    "kernel.firstMoment.x",
    "kernel.firstMoment.y",
    "kernel.firstMoment.z",
    "kernel.covariance.xx",
    "kernel.covariance.xy",
    "kernel.covariance.xz",
    "kernel.covariance.yy",
    "kernel.covariance.yz",
    "kernel.covariance.zz",
    "kernel.radiusWorld",
    "kernel.coherence",
    "structure.normal.x",
    "structure.normal.y",
    "structure.normal.z",
    "structure.normalValid",
    "flow.tangent.x",
    "flow.tangent.y",
    "flow.tangent.z",
    "flow.coherence",
)
CANDIDATE_ORDER = (
    "center.x",
    "center.y",
    "center.z",
    "covariance.xx",
    "covariance.xy",
    "covariance.xz",
    "covariance.yy",
    "covariance.yz",
    "covariance.zz",
    "eigenvalue.major",
    "eigenvalue.middle",
    "eigenvalue.minor",
    "radiusWorld",
    "kernelCoherence",
    "ridgeOpticalWeight",
    "nonRidgeOpticalWeight",
    "opticalWeight",
    "regimeConfidence",
)
CLAIM_BOUNDARY = {
    "targetImageUsed": False,
    "supportRedefined": False,
    "coefficientsChanged": False,
    "notRendererVerdict": True,
    "notRuntimeEstimate": True,
    "notLearnerCampaign": True,
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except Exception as exc:
        raise ValueError(f"{label} JSON could not be read: {exc}") from exc
    require(isinstance(value, dict), f"{label} must be a JSON object")
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def artifact_path(manifest_path: Path, artifact: dict[str, Any]) -> Path:
    raw = Path(str(artifact.get("path", "")))
    require(str(raw), "artifact path is missing")
    return raw if raw.is_absolute() else manifest_path.parent / raw


def descriptor_indices(order: Iterable[str]) -> dict[str, int]:
    names = list(order)
    require(len(names) == len(set(names)), "descriptor order contains duplicate names")
    lookup = {name: index for index, name in enumerate(names)}
    missing = [name for name in REQUIRED_DESCRIPTOR_NAMES if name not in lookup]
    require(not missing, f"descriptor order is missing required fields: {missing}")
    return lookup


def assemble_covariance(packed: np.ndarray) -> np.ndarray:
    values = np.asarray(packed, dtype=np.float64)
    require(values.ndim == 2 and values.shape[1] == 6, "packed covariance must have shape [rows,6]")
    require(np.all(np.isfinite(values)), "packed covariance contains nonfinite values")
    matrices = np.empty((values.shape[0], 3, 3), dtype=np.float64)
    matrices[:, 0, 0] = values[:, 0]
    matrices[:, 0, 1] = matrices[:, 1, 0] = values[:, 1]
    matrices[:, 0, 2] = matrices[:, 2, 0] = values[:, 2]
    matrices[:, 1, 1] = values[:, 3]
    matrices[:, 1, 2] = matrices[:, 2, 1] = values[:, 4]
    matrices[:, 2, 2] = values[:, 5]
    return matrices


def weighted_quantiles(
    values: np.ndarray,
    weights: np.ndarray,
    native_ids: np.ndarray,
    quantiles: Iterable[float],
) -> np.ndarray:
    source = np.asarray(values, dtype=np.float64)
    mass = np.asarray(weights, dtype=np.float64)
    ids = np.asarray(native_ids, dtype=np.uint32)
    requested = np.asarray(tuple(quantiles), dtype=np.float64)
    require(source.ndim == mass.ndim == ids.ndim == 1 and source.size == mass.size == ids.size, "weighted rows must align")
    require(source.size > 0, "weighted quantiles require at least one row")
    require(np.all(np.isfinite(source)), "weighted values contain nonfinite entries")
    require(np.all(np.isfinite(mass)) and np.all(mass >= 0.0), "weights must be finite and nonnegative")
    require(np.all(np.isfinite(requested)) and np.all((requested >= 0.0) & (requested <= 1.0)), "quantiles must be in [0,1]")
    positive = mass > 0.0
    require(np.any(positive), "weighted quantiles require positive total weight")
    source = source[positive]
    mass = mass[positive]
    ids = ids[positive]
    order = np.lexsort((ids.astype(np.uint64), source))
    sorted_values = source[order]
    sorted_weights = mass[order]
    cumulative = np.cumsum(sorted_weights, dtype=np.float64)
    total = float(cumulative[-1])
    targets = requested * total
    indices = np.searchsorted(cumulative, targets, side="left")
    indices = np.clip(indices, 0, sorted_values.size - 1)
    return sorted_values[indices]


def summarize(values: np.ndarray, native_ids: np.ndarray, weights: np.ndarray | None = None) -> dict[str, Any]:
    source = np.asarray(values, dtype=np.float64)
    ids = np.asarray(native_ids, dtype=np.uint32)
    require(source.ndim == ids.ndim == 1 and source.size == ids.size and source.size > 0, "summary rows must align")
    require(np.all(np.isfinite(source)), "summary values contain nonfinite entries")
    if weights is None:
        quantile_values = np.quantile(source, QUANTILES, method="linear")
        mean = float(np.mean(source, dtype=np.float64))
        total_weight = float(source.size)
    else:
        mass = np.asarray(weights, dtype=np.float64)
        quantile_values = weighted_quantiles(source, mass, ids, QUANTILES)
        total_weight = float(np.sum(mass, dtype=np.float64))
        require(total_weight > 0.0, "weighted summary requires positive total weight")
        mean = float(np.sum(source * mass, dtype=np.float64) / total_weight)
    return {
        "count": int(source.size),
        "minimum": float(np.min(source)),
        "maximum": float(np.max(source)),
        "mean": mean,
        "quantiles": {label: float(value) for label, value in zip(QUANTILE_LABELS, quantile_values, strict=True)},
        "totalWeight": total_weight,
    }


def normalize_rows(vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(vectors, dtype=np.float64)
    require(values.ndim == 2 and values.shape[1] == 3, "vectors must have shape [rows,3]")
    lengths = np.linalg.norm(values, axis=1)
    valid = np.all(np.isfinite(values), axis=1) & np.isfinite(lengths) & (lengths > 1e-12)
    normalized = np.zeros_like(values)
    normalized[valid] = values[valid] / lengths[valid, None]
    return normalized, valid


def layer_optical_weights(coefficients: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(coefficients, dtype=np.float64)
    require(values.ndim == 2 and values.shape[1] == 8, "coefficient tensor must have shape [rows,8]")
    require(np.all(np.isfinite(values)) and np.all(values >= 0.0), "coefficients must be finite and nonnegative")
    luma = np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float64)
    ridge = values[:, 0:3] @ luma + 0.5 * values[:, 3]
    nonridge = values[:, 4:7] @ luma + 0.5 * values[:, 7]
    require(np.all(np.isfinite(ridge)) and np.all(ridge >= 0.0), "Ridge optical weights are invalid")
    require(np.all(np.isfinite(nonridge)) and np.all(nonridge >= 0.0), "Non-Ridge optical weights are invalid")
    return ridge, nonridge


def optical_weights(coefficients: np.ndarray) -> np.ndarray:
    ridge, nonridge = layer_optical_weights(coefficients)
    weights = ridge + nonridge
    require(np.all(np.isfinite(weights)) and np.all(weights >= 0.0), "optical weights are invalid")
    require(float(np.sum(weights, dtype=np.float64)) > 0.0, "coefficient tensor has zero total optical weight")
    return weights


def optical_concentration(weights: np.ndarray, native_ids: np.ndarray) -> dict[str, Any]:
    mass = np.asarray(weights, dtype=np.float64)
    ids = np.asarray(native_ids, dtype=np.uint32)
    require(mass.ndim == ids.ndim == 1 and mass.size == ids.size and mass.size > 0, "concentration rows must align")
    require(np.all(np.isfinite(mass)) and np.all(mass >= 0.0), "concentration weights are invalid")
    total = float(np.sum(mass, dtype=np.float64))
    positive_count = int(np.count_nonzero(mass > 0.0))
    if total <= 0.0:
        return {
            "totalOpticalWeight": 0.0,
            "positiveRowCount": 0,
            "rowsForMassFraction": {},
            "massFractionByTopRowFraction": {},
        }
    order = np.lexsort((ids.astype(np.uint64), -mass))
    cumulative = np.cumsum(mass[order], dtype=np.float64)
    rows_for_mass = {}
    for label, target in (("p50", 0.5), ("p75", 0.75), ("p90", 0.9), ("p95", 0.95), ("p99", 0.99)):
        row_count = int(np.searchsorted(cumulative, target * total, side="left") + 1)
        rows_for_mass[label] = {
            "massFraction": target,
            "rowCount": row_count,
            "rowFraction": row_count / mass.size,
            "positiveRowFraction": row_count / positive_count if positive_count else 0.0,
        }
    mass_by_top_rows = {}
    for label, fraction in (("p01", 0.01), ("p05", 0.05), ("p10", 0.1), ("p25", 0.25), ("p50", 0.5), ("p100", 1.0)):
        row_count = max(1, int(math.ceil(fraction * mass.size)))
        mass_by_top_rows[label] = {
            "rowFraction": fraction,
            "rowCount": row_count,
            "massFraction": float(np.clip(cumulative[row_count - 1] / total, 0.0, 1.0)),
        }
    return {
        "totalOpticalWeight": total,
        "positiveRowCount": positive_count,
        "ordering": "optical-weight-descending-native-cell-index-ascending-v0",
        "rowsForMassFraction": rows_for_mass,
        "massFractionByTopRowFraction": mass_by_top_rows,
    }


def validate_component_pair(
    descriptor_manifest_path: Path,
    coefficient_manifest_path: Path,
) -> tuple[dict[str, Any], dict[str, Any], np.ndarray, np.ndarray, np.ndarray, dict[str, int]]:
    descriptor_manifest = load_json(descriptor_manifest_path, "descriptor manifest")
    coefficient_manifest = load_json(coefficient_manifest_path, "coefficient manifest")
    for label, manifest in (("descriptor", descriptor_manifest), ("coefficient", coefficient_manifest)):
        require(manifest.get("schema") == COMPONENT_SCHEMA, f"{label} component schema drifted")
        require(manifest.get("status") == "complete" and manifest.get("failurePhase") is None, f"{label} component is not complete")
        require(manifest.get("grid") == 96, f"{label} component is not native Grid96")
        require(manifest.get("simStepCount") == 120, f"{label} component is not state step 120")
        require(manifest.get("requestedControlIdentity") == manifest.get("effectiveControlIdentity"), f"{label} control identity drifted")
        require(is_sha256(manifest.get("sourceManifestSha256")), f"{label} source manifest SHA-256 is invalid")
        route = manifest.get("route")
        require(isinstance(route, dict), f"{label} route receipt is missing")
        require(route.get("effective") == "native-3d-compute-fluid-raymarch-v0", f"{label} effective route drifted")
        require(route.get("backend") == "WebGPU:apple", f"{label} backend drifted")
        require(route.get("fallbackReason") is None, f"{label} used fallback")
    require(descriptor_manifest.get("role") == "descriptors", "descriptor role drifted")
    require(descriptor_manifest.get("identity") == DESCRIPTOR_IDENTITY, "descriptor socket identity drifted")
    require(descriptor_manifest.get("kernelIdentity") == KERNEL_IDENTITY, "descriptor kernel identity drifted")
    require(coefficient_manifest.get("role") == "coefficients", "coefficient role drifted")
    require(coefficient_manifest.get("identity") == COEFFICIENT_IDENTITY, "coefficient identity drifted")
    require(coefficient_manifest.get("channels") == list(COEFFICIENT_ORDER), "coefficient channel order drifted")
    paired_fields = (
        "sameStateCaptureId",
        "simStepCount",
        "requestedControlIdentity",
        "effectiveControlIdentity",
        "sourceManifestSha256",
        "nativeCellIndexSha256",
        "rowCount",
    )
    for field in paired_fields:
        require(descriptor_manifest.get(field) == coefficient_manifest.get(field), f"component pair {field} mismatch")
    row_count = descriptor_manifest.get("rowCount")
    require(isinstance(row_count, int) and row_count > 0, "component row count is invalid")
    require(is_sha256(descriptor_manifest.get("nativeCellIndexSha256")), "native-cell index SHA-256 is invalid")

    descriptor_artifact = descriptor_manifest.get("artifact")
    coefficient_artifact = coefficient_manifest.get("artifact")
    require(isinstance(descriptor_artifact, dict) and isinstance(coefficient_artifact, dict), "component artifact receipt is missing")
    order = descriptor_manifest.get("descriptorOrder")
    require(isinstance(order, list) and order == descriptor_artifact.get("descriptorOrder"), "descriptor order receipt drifted")
    stride = descriptor_manifest.get("strideFloats")
    require(isinstance(stride, int) and stride == len(order) and stride == descriptor_artifact.get("strideFloats"), "descriptor stride drifted")
    lookup = descriptor_indices(order)
    require(descriptor_artifact.get("dtype") == "float32-le", "descriptor dtype drifted")
    require(descriptor_artifact.get("shape") == [row_count, stride], "descriptor shape drifted")
    require(coefficient_artifact.get("dtype") == "float32-le", "coefficient dtype drifted")
    require(coefficient_artifact.get("shape") == [row_count, 8], "coefficient shape drifted")
    require(coefficient_artifact.get("nativeCellIndexSha256") == descriptor_manifest.get("nativeCellIndexSha256"), "coefficient row-order binding drifted")
    source_hashes = descriptor_artifact.get("sourceHashes")
    require(isinstance(source_hashes, dict), "descriptor source hashes are missing")
    for field in ("fluidSha256", "frontSha256", "boundarySidecarSha256", "majorantSha256"):
        require(is_sha256(source_hashes.get(field)), f"descriptor {field} is invalid")
    require(is_sha256(descriptor_artifact.get("sourceManifestSha256")), "descriptor producer source manifest SHA-256 is invalid")

    descriptor_path = artifact_path(descriptor_manifest_path, descriptor_artifact)
    coefficient_path = artifact_path(coefficient_manifest_path, coefficient_artifact)
    for label, path, artifact in (
        ("descriptor", descriptor_path, descriptor_artifact),
        ("coefficient", coefficient_path, coefficient_artifact),
    ):
        require(path.is_file(), f"{label} artifact is missing: {path}")
        require(path.stat().st_size == artifact.get("bytes"), f"{label} artifact byte length drifted")
        require(sha256_file(path) == artifact.get("sha256"), f"{label} artifact SHA-256 drifted")

    descriptors = np.fromfile(descriptor_path, dtype="<f4")
    coefficients = np.fromfile(coefficient_path, dtype="<f4")
    require(descriptors.size == row_count * stride, "descriptor artifact element count drifted")
    require(coefficients.size == row_count * 8, "coefficient artifact element count drifted")
    descriptors = descriptors.reshape(row_count, stride)
    coefficients = coefficients.reshape(row_count, 8)
    require(np.all(np.isfinite(descriptors)), "descriptor artifact contains nonfinite values")
    require(np.all(np.isfinite(coefficients)) and np.all(coefficients >= 0.0), "coefficient artifact is invalid")
    raw_ids = descriptors[:, lookup["position.nativeCellIndex"]].astype(np.float64)
    require(np.all(raw_ids == np.floor(raw_ids)), "descriptor native-cell identities are not integers")
    require(np.all((raw_ids >= 0) & (raw_ids < 96**3)), "descriptor native-cell identity is outside Grid96")
    native_ids = raw_ids.astype(np.uint32)
    require(np.unique(native_ids).size == row_count, "descriptor native-cell identities contain duplicates")
    actual_index_sha = sha256_bytes(np.asarray(native_ids, dtype="<u4").tobytes())
    require(actual_index_sha == descriptor_manifest.get("nativeCellIndexSha256"), "descriptor native-cell index SHA-256 drifted")
    return descriptor_manifest, coefficient_manifest, descriptors, coefficients, native_ids, lookup


def analyze(
    descriptors: np.ndarray,
    coefficients: np.ndarray,
    native_ids: np.ndarray,
    lookup: dict[str, int],
    rank_threshold: float,
    degenerate_epsilon: float,
    psd_relative_tolerance: float,
) -> dict[str, Any]:
    require(0.0 < rank_threshold < 1.0, "rank threshold must be in (0,1)")
    require(degenerate_epsilon >= 0.0 and math.isfinite(degenerate_epsilon), "degenerate epsilon must be finite and nonnegative")
    require(psd_relative_tolerance >= 0.0 and math.isfinite(psd_relative_tolerance), "PSD tolerance must be finite and nonnegative")
    packed = descriptors[:, [lookup[name] for name in (
        "kernel.covariance.xx", "kernel.covariance.xy", "kernel.covariance.xz",
        "kernel.covariance.yy", "kernel.covariance.yz", "kernel.covariance.zz",
    )]]
    covariance = assemble_covariance(packed)
    eigenvalues_ascending, eigenvectors_ascending = np.linalg.eigh(covariance)
    require(np.all(np.isfinite(eigenvalues_ascending)) and np.all(np.isfinite(eigenvectors_ascending)), "covariance eigendecomposition is nonfinite")
    scale = np.maximum(np.max(np.abs(eigenvalues_ascending), axis=1), degenerate_epsilon)
    material_negative = eigenvalues_ascending[:, 0] < -(psd_relative_tolerance * scale + degenerate_epsilon)
    require(not np.any(material_negative), f"covariance contains {int(np.count_nonzero(material_negative))} materially non-PSD rows")
    tiny_negative = eigenvalues_ascending[:, 0] < 0.0
    clamped_ascending = np.maximum(eigenvalues_ascending, 0.0)
    clamped_descending = clamped_ascending[:, ::-1]
    eigenvectors_descending = eigenvectors_ascending[:, :, ::-1]
    major = clamped_descending[:, 0]
    middle = clamped_descending[:, 1]
    minor = clamped_descending[:, 2]
    middle_ratio = np.divide(middle, major, out=np.zeros_like(middle), where=major > degenerate_epsilon)
    minor_ratio = np.divide(minor, major, out=np.zeros_like(minor), where=major > degenerate_epsilon)

    regimes = np.full(native_ids.size, REGIME_CODES["volumetric"], dtype=np.uint8)
    degenerate = major <= degenerate_epsilon
    rank1 = ~degenerate & (middle_ratio <= rank_threshold)
    sheet = ~degenerate & ~rank1 & (minor_ratio <= rank_threshold)
    regimes[degenerate] = REGIME_CODES["degenerate"]
    regimes[rank1] = REGIME_CODES["rank1"]
    regimes[sheet] = REGIME_CODES["sheet"]
    confidence = np.zeros(native_ids.size, dtype=np.float64)
    confidence[degenerate] = 1.0
    confidence[rank1] = np.clip((rank_threshold - middle_ratio[rank1]) / rank_threshold, 0.0, 1.0)
    confidence[sheet] = np.minimum(
        np.clip((middle_ratio[sheet] - rank_threshold) / (1.0 - rank_threshold), 0.0, 1.0),
        np.clip((rank_threshold - minor_ratio[sheet]) / rank_threshold, 0.0, 1.0),
    )
    volumetric = regimes == REGIME_CODES["volumetric"]
    confidence[volumetric] = np.clip((minor_ratio[volumetric] - rank_threshold) / (1.0 - rank_threshold), 0.0, 1.0)

    psd_covariance = np.einsum(
        "nij,nj,nkj->nik", eigenvectors_ascending, clamped_ascending, eigenvectors_ascending, optimize=True
    )
    centers = descriptors[:, [lookup["position.world.x"], lookup["position.world.y"], lookup["position.world.z"]]].astype(np.float64)
    first_moment = descriptors[:, [lookup["kernel.firstMoment.x"], lookup["kernel.firstMoment.y"], lookup["kernel.firstMoment.z"]]].astype(np.float64)
    centers += first_moment
    radius = descriptors[:, lookup["kernel.radiusWorld"]].astype(np.float64)
    coherence = np.clip(descriptors[:, lookup["kernel.coherence"]].astype(np.float64), 0.0, 1.0)
    require(np.all(np.isfinite(centers)), "candidate centers are nonfinite")
    require(np.all(np.isfinite(radius)) and np.all(radius >= 0.0), "kernel radii are invalid")
    ridge_weights, nonridge_weights = layer_optical_weights(coefficients)
    weights = ridge_weights + nonridge_weights
    require(float(np.sum(weights, dtype=np.float64)) > 0.0, "coefficient tensor has zero total optical weight")

    flow = descriptors[:, [lookup["flow.tangent.x"], lookup["flow.tangent.y"], lookup["flow.tangent.z"]]]
    axis_separation_tolerance = psd_relative_tolerance * major + degenerate_epsilon
    principal_axis_valid = (major - middle) > axis_separation_tolerance
    minor_axis_valid = (middle - minor) > axis_separation_tolerance
    flow_unit, flow_vector_valid = normalize_rows(flow)
    flow_valid = flow_vector_valid & principal_axis_valid
    principal = eigenvectors_descending[:, :, 0]
    principal_alignment = np.abs(np.sum(principal[flow_valid] * flow_unit[flow_valid], axis=1))
    normal = descriptors[:, [lookup["structure.normal.x"], lookup["structure.normal.y"], lookup["structure.normal.z"]]]
    normal_unit, normal_vector_valid = normalize_rows(normal)
    normal_declared_valid = descriptors[:, lookup["structure.normalValid"]] > 0.5
    normal_valid = normal_declared_valid & normal_vector_valid & minor_axis_valid
    minor_axis = eigenvectors_descending[:, :, 2]
    minor_alignment = np.abs(np.sum(minor_axis[normal_valid] * normal_unit[normal_valid], axis=1))

    packed_psd = np.stack(
        (
            psd_covariance[:, 0, 0], psd_covariance[:, 0, 1], psd_covariance[:, 0, 2],
            psd_covariance[:, 1, 1], psd_covariance[:, 1, 2], psd_covariance[:, 2, 2],
        ), axis=1
    )
    candidates = np.column_stack(
        (
            centers,
            packed_psd,
            clamped_descending,
            radius,
            coherence,
            ridge_weights,
            nonridge_weights,
            weights,
            confidence,
        )
    ).astype("<f4")
    require(candidates.shape == (native_ids.size, len(CANDIDATE_ORDER)), "candidate socket shape is invalid")
    require(np.all(np.isfinite(candidates)), "candidate socket contains nonfinite values")

    counts = {name: int(np.count_nonzero(regimes == code)) for name, code in REGIME_CODES.items()}
    weight_by_regime = {
        name: float(np.sum(weights[regimes == code], dtype=np.float64)) for name, code in REGIME_CODES.items()
    }
    total_weight = float(np.sum(weights, dtype=np.float64))
    weight_fraction = {name: value / total_weight for name, value in weight_by_regime.items()}
    distributions = {}
    distribution_values = {
        "eigenvalueMajor": major,
        "eigenvalueMiddle": middle,
        "eigenvalueMinor": minor,
        "middleToMajor": middle_ratio,
        "minorToMajor": minor_ratio,
        "trace": major + middle + minor,
        "radiusWorld": radius,
        "kernelCoherence": coherence,
    }
    for name, values in distribution_values.items():
        distributions[name] = {
            "unweighted": summarize(values, native_ids),
            "opticalWeighted": summarize(values, native_ids, weights),
        }
    principal_ids = native_ids[flow_valid]
    minor_ids = native_ids[normal_valid]
    alignment = {
        "principalVsFlowTangent": summarize(principal_alignment, principal_ids) if principal_ids.size else None,
        "principalVsFlowTangentValidRowCount": int(principal_ids.size),
        "principalAxisValidity": "major-minus-middle-exceeds-psd-tolerance-v0",
        "minorVsValidNormal": summarize(minor_alignment, minor_ids) if minor_ids.size else None,
        "minorVsValidNormalValidRowCount": int(minor_ids.size),
        "minorAxisValidity": "middle-minus-minor-exceeds-psd-tolerance-v0",
    }
    return {
        "candidates": candidates,
        "regimes": regimes,
        "covariance": {
            "identity": "symmetric-kernel-covariance-psd-clamp-v0",
            "materiallyNonPsdRowCount": int(np.count_nonzero(material_negative)),
            "tinyNegativeRowCount": int(np.count_nonzero(tiny_negative)),
            "psdClampRowCount": int(np.count_nonzero(tiny_negative)),
            "psdRelativeTolerance": psd_relative_tolerance,
            "degenerateEpsilon": degenerate_epsilon,
        },
        "regimeReport": {
            "identity": REGIME_IDENTITY,
            "rankThreshold": rank_threshold,
            "codes": REGIME_CODES,
            "counts": counts,
            "opticalWeightByRegime": weight_by_regime,
            "opticalWeightFractionByRegime": weight_fraction,
        },
        "alignment": alignment,
        "opticalWeight": {
            "identity": "ridge-plus-nonridge-luma-plus-half-extinction-v0",
            "coefficientOrder": list(COEFFICIENT_ORDER),
            "positiveRowCount": int(np.count_nonzero(weights > 0.0)),
            "zeroRowCount": int(np.count_nonzero(weights == 0.0)),
            "total": total_weight,
            "summary": summarize(weights, native_ids),
            "layers": {
                "ridge": {
                    "positiveRowCount": int(np.count_nonzero(ridge_weights > 0.0)),
                    "zeroRowCount": int(np.count_nonzero(ridge_weights == 0.0)),
                    "total": float(np.sum(ridge_weights, dtype=np.float64)),
                    "summary": summarize(ridge_weights, native_ids),
                },
                "nonRidge": {
                    "positiveRowCount": int(np.count_nonzero(nonridge_weights > 0.0)),
                    "zeroRowCount": int(np.count_nonzero(nonridge_weights == 0.0)),
                    "total": float(np.sum(nonridge_weights, dtype=np.float64)),
                    "summary": summarize(nonridge_weights, native_ids),
                },
            },
            "concentration": {
                "ridge": optical_concentration(ridge_weights, native_ids),
                "nonRidge": optical_concentration(nonridge_weights, native_ids),
                "combined": optical_concentration(weights, native_ids),
            },
        },
        "distributions": distributions,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--descriptor-manifest", required=True, type=Path)
    parser.add_argument("--coefficient-manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--rank-threshold", type=float, default=0.15)
    parser.add_argument("--degenerate-epsilon", type=float, default=1e-12)
    parser.add_argument("--psd-relative-tolerance", type=float, default=1e-5)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    manifest_path = output_dir / "grid96-covariance-regime-manifest.json"
    candidate_path = output_dir / "grid96-covariance-candidates.f32"
    regime_path = output_dir / "grid96-covariance-regimes.u8"
    native_id_path = output_dir / "grid96-covariance-native-cell-index.u32"
    for path in (report_path, manifest_path, candidate_path, regime_path, native_id_path):
        path.unlink(missing_ok=True)
    started = time.time()
    phase = "source-validation"
    try:
        descriptor_manifest_path = args.descriptor_manifest.resolve()
        coefficient_manifest_path = args.coefficient_manifest.resolve()
        descriptor_manifest, coefficient_manifest, descriptors, coefficients, native_ids, lookup = validate_component_pair(
            descriptor_manifest_path, coefficient_manifest_path
        )
        phase = "covariance-analysis"
        result = analyze(
            descriptors,
            coefficients,
            native_ids,
            lookup,
            args.rank_threshold,
            args.degenerate_epsilon,
            args.psd_relative_tolerance,
        )
        phase = "artifact-write"
        result["candidates"].tofile(candidate_path)
        result["regimes"].tofile(regime_path)
        np.asarray(native_ids, dtype="<u4").tofile(native_id_path)
        descriptor_artifact = descriptor_manifest["artifact"]
        coefficient_artifact = coefficient_manifest["artifact"]
        source_receipt = {
            "descriptorManifestPath": str(descriptor_manifest_path),
            "descriptorManifestSha256": sha256_file(descriptor_manifest_path),
            "coefficientManifestPath": str(coefficient_manifest_path),
            "coefficientManifestSha256": sha256_file(coefficient_manifest_path),
            "sameStateCaptureId": descriptor_manifest["sameStateCaptureId"],
            "grid": 96,
            "simStepCount": 120,
            "rowCount": int(native_ids.size),
            "nativeCellIndexSha256": descriptor_manifest["nativeCellIndexSha256"],
            "componentSourceManifestSha256": descriptor_manifest["sourceManifestSha256"],
            "descriptorSourceManifestSha256": descriptor_artifact["sourceManifestSha256"],
            "descriptorArtifactSha256": descriptor_artifact["sha256"],
            "coefficientArtifactSha256": coefficient_artifact["sha256"],
            "sourceHashes": descriptor_artifact["sourceHashes"],
            "route": descriptor_manifest["route"],
        }
        artifact_receipts = {
            "candidateArtifact": {
                "path": str(candidate_path), "dtype": "float32-le", "shape": [int(native_ids.size), len(CANDIDATE_ORDER)],
                "bytes": candidate_path.stat().st_size, "sha256": sha256_file(candidate_path),
            },
            "regimeArtifact": {
                "path": str(regime_path), "dtype": "uint8", "shape": [int(native_ids.size)],
                "bytes": regime_path.stat().st_size, "sha256": sha256_file(regime_path),
            },
            "nativeCellIndexArtifact": {
                "path": str(native_id_path), "dtype": "uint32-le", "shape": [int(native_ids.size)],
                "bytes": native_id_path.stat().st_size, "sha256": sha256_file(native_id_path),
            },
        }
        manifest = {
            "schema": MANIFEST_SCHEMA,
            "status": "complete",
            "failurePhase": None,
            "identity": "sha256:pending",
            "source": source_receipt,
            "rowCount": int(native_ids.size),
            "rowOrderIdentity": ROW_ORDER_IDENTITY,
            "descriptorArtifactSha256": descriptor_artifact["sha256"],
            "coefficientArtifactSha256": coefficient_artifact["sha256"],
            "candidateOrder": list(CANDIDATE_ORDER),
            "regimeCodes": REGIME_CODES,
            "controls": {
                "rankThreshold": args.rank_threshold,
                "degenerateEpsilon": args.degenerate_epsilon,
                "psdRelativeTolerance": args.psd_relative_tolerance,
            },
            **artifact_receipts,
            "claimBoundary": CLAIM_BOUNDARY,
        }
        identity_payload = dict(manifest)
        identity_payload["identity"] = None
        manifest["identity"] = "sha256:" + sha256_bytes(canonical_json(identity_payload).encode("utf-8"))
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        report = {
            "schema": REPORT_SCHEMA,
            "status": "complete",
            "failurePhase": None,
            "source": source_receipt,
            "execution": {
                "sampleCap": None,
                "droppedRowCount": 0,
                "rowCount": int(native_ids.size),
                "targetImageUsed": False,
                "cameraCount": 0,
            },
            "covariance": result["covariance"],
            "regimes": result["regimeReport"],
            "alignment": result["alignment"],
            "opticalWeight": result["opticalWeight"],
            "distributions": result["distributions"],
            "artifacts": {**artifact_receipts, "manifest": str(manifest_path)},
            "claimBoundary": CLAIM_BOUNDARY,
            "startedAtUnix": started,
            "finishedAtUnix": time.time(),
        }
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"status": "complete", "report": str(report_path), "manifest": str(manifest_path)}))
        return 0
    except Exception as exc:
        failed_report = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": phase,
            "error": {
                "type": type(exc).__name__,
                "message": str(exc),
                "traceback": traceback.format_exc(),
            },
            "requested": {
                "descriptorManifest": str(args.descriptor_manifest),
                "coefficientManifest": str(args.coefficient_manifest),
                "outputDir": str(output_dir),
                "rankThreshold": args.rank_threshold,
                "degenerateEpsilon": args.degenerate_epsilon,
                "psdRelativeTolerance": args.psd_relative_tolerance,
            },
            "claimBoundary": CLAIM_BOUNDARY,
            "startedAtUnix": started,
            "finishedAtUnix": time.time(),
        }
        report_path.write_text(json.dumps(failed_report, indent=2, sort_keys=True) + "\n")
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
