#!/usr/bin/env python3
"""Frozen-state layer-coefficient rendering oracle.

This is an evidence harness, not a shipping renderer. It consumes Tiger's exact
native-cell coefficient corpus, projects the checksum-bound kernel descriptors
through the already accepted camera orbit, and evaluates Ridge and Non-Ridge
emission under one shared transmittance. The optical path scalar is either fit
on camera 10 or frozen by the caller for a matched footprint comparison.
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
from typing import Any

import numpy as np
from PIL import Image


REPORT_SCHEMA = "kaminos.volume.layer-coefficient-render-oracle.v0"
TRAINING_SCHEMA = "kaminos.volume.layer-coefficient-training-manifest.v0"
CAPTURE_SCHEMA = "kaminos.volume.raymarch-filament-orbit-witness.v0"
ADMISSION_AUTHORITY = "external-native-cell-index-list-v0"
COEFFICIENT_BOUNDARY = "per-sample-pre-tone-map-emission-extinction-v0"
SHARED_TRANSMITTANCE = "ridge-plus-non-ridge-extinction-one-running-transmittance-v0"
KERNEL_GEOMETRY = "base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0"
CALIBRATION_IDENTITY = "camera-10-only-global-optical-path-fit-v0"
FROZEN_CALIBRATION_IDENTITY = "caller-frozen-global-optical-path-v0"
ORDER_APPROXIMATION = "camera-depth-96-bin-one-running-transmittance-v0"
FOOTPRINT_MODES = {
    "nearest": "checksum-bound-flow-tangent-five-tap-projected-kernel-v0",
    "bilinear": "flow-tangent-five-tap-bilinear-v0",
    "ellipse": "flow-tangent-five-by-three-area-conserving-ellipse-quadrature-v0",
    "core-skirt": "flow-tangent-five-tap-core-plus-ridge-conditioned-normal-skirt-v0",
    "higher-order": "flow-covariance-seven-by-seven-gauss-hermite-area-conserving-v0",
    "compound": "flow-bilinear-core-plus-gauss-hermite-compound-shared-mass-v0",
    "selective-split": "view-independent-multiview-residual-three-child-subcell-split-v0",
}
TANGENT_OFFSETS = np.asarray((-1.0, -0.5, 0.0, 0.5, 1.0), dtype=np.float64)
TANGENT_WEIGHTS = np.asarray((0.075, 0.225, 0.4, 0.225, 0.075), dtype=np.float64)
NORMAL_OFFSETS = np.asarray((-1.0, 0.0, 1.0), dtype=np.float64)
NORMAL_WEIGHTS = np.asarray((0.125, 0.75, 0.125), dtype=np.float64)
TANGENT_UNIT_VARIANCE = float(np.sum(TANGENT_WEIGHTS * np.square(TANGENT_OFFSETS)))
NORMAL_UNIT_VARIANCE = float(np.sum(NORMAL_WEIGHTS * np.square(NORMAL_OFFSETS)))
GAUSS_HERMITE_ORDER = 7
GAUSS_HERMITE_RAW_NODES, GAUSS_HERMITE_RAW_WEIGHTS = np.polynomial.hermite.hermgauss(GAUSS_HERMITE_ORDER)
GAUSS_HERMITE_WEIGHTS = GAUSS_HERMITE_RAW_WEIGHTS / math.sqrt(math.pi)
FEATURE_ORDER = [
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.density", "material.heat", "material.fuel", "material.detail",
    "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
    "micro.x", "micro.y", "micro.z", "micro.w", "front.topology",
    "velocity.x", "velocity.y", "velocity.z", "support.reaction",
    "support.interface", "flow.curlMagnitude", "flow.divergence",
]
RIDGE_FEATURE_INDEX = FEATURE_ORDER.index("sidecar.ridge")
COEFFICIENT_ORDER = [
    "ridge.emission.r", "ridge.emission.g", "ridge.emission.b", "ridge.extinction",
    "nonRidge.emission.r", "nonRidge.emission.g", "nonRidge.emission.b", "nonRidge.extinction",
]
REQUIRED_MODES = {
    "kernelMomentCovariance", "stateDerivedSupport", "ridgeTransportRidgeExtinction",
    "ridgeTransportTotalExtinction", "sharedTransmittanceContributionSum", "raymarch",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


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


def resolve_artifact_path(descriptor: dict[str, Any], manifest_path: Path) -> Path:
    raw = descriptor.get("path")
    require(isinstance(raw, str) and raw, "artifact path is missing")
    path = Path(raw)
    return path if path.is_absolute() else (manifest_path.parent / path).resolve()


def validate_artifact(
    descriptor: dict[str, Any],
    manifest_path: Path,
    label: str,
    expected_dtype: str,
    expected_shape: list[int],
    verify_hash: bool,
) -> Path:
    require(isinstance(descriptor, dict), f"{label} artifact descriptor is missing")
    require(descriptor.get("dtype") == expected_dtype, f"{label} dtype must be {expected_dtype}")
    require(descriptor.get("shape") == expected_shape, f"{label} shape does not match row count")
    path = resolve_artifact_path(descriptor, manifest_path)
    require(path.is_file(), f"{label} artifact is missing: {path}")
    actual_bytes = path.stat().st_size
    require(descriptor.get("bytes") == actual_bytes, f"{label} byte length drifted")
    if verify_hash:
        require(sha256_file(path) == descriptor.get("sha256"), f"{label} sha256 drifted")
    return path


def validate_manifest(
    manifest: dict[str, Any], manifest_path: Path, state_step: int | None, verify_hashes: bool
) -> tuple[dict[str, Any], dict[str, Path], dict[str, Any]]:
    require(manifest.get("schema") == TRAINING_SCHEMA, f"manifest schema must be {TRAINING_SCHEMA}")
    require(manifest.get("authority") == "analytical-ridge-or-nonridge-admission-plus-exact-local-coefficients-v0", "manifest authority drifted")
    require(manifest.get("status") in {"complete", "captured"}, "manifest is not complete")
    cohort = manifest.get("cohort") or {}
    require(cohort.get("sampleCap") is None, "manifest applied a hidden sampleCap")
    require(cohort.get("droppedRowCount") == 0, "manifest dropped admitted rows")
    admission = manifest.get("admission") or {}
    require(admission.get("identity") == "explicit-ridge-union-promoted-nonridge-source-selector-v0", "analytical admission identity drifted")
    targets = manifest.get("coefficientTargets") or {}
    boundary = targets.get("coefficientBoundary", targets.get("boundary"))
    require(boundary == COEFFICIENT_BOUNDARY, f"coefficient boundary must be {COEFFICIENT_BOUNDARY}")
    require(targets.get("order") == COEFFICIENT_ORDER, "coefficient order drifted")
    transport = manifest.get("transportEvaluation") or {}
    require(transport.get("identity") == "one-shared-total-transmittance-v0", "shared transport identity drifted")
    require(transport.get("orderPolicy") == "global-order-one-stream-v0", "transport order policy drifted")
    require(transport.get("independentlyRenderedToneMappedImageAdditivity") is False, "independent tone-mapped image additivity is forbidden")
    states = manifest.get("states")
    require(isinstance(states, list) and states, "manifest has no states")
    if state_step is None:
        state = states[0]
    else:
        matches = [item for item in states if (item.get("replay") or {}).get("completedSteps") == state_step]
        require(len(matches) == 1, f"manifest must contain exactly one state at step {state_step}")
        state = matches[0]
    rows = state.get("rows") or {}
    count = rows.get("count")
    require(isinstance(count, int) and count > 0, "state row count must be positive")

    # Validate native indices first. This makes duplicate/partial population lies
    # fail before unrelated optional artifacts can obscure the admission defect.
    index_desc = rows.get("nativeCellIndices") or {}
    index_path = validate_artifact(index_desc, manifest_path, "native-cell indices", "uint32-le", [count], verify_hashes)
    indices = np.memmap(index_path, dtype="<u4", mode="r", shape=(count,))
    require(int(indices.max(initial=0)) < int((state.get("replay") or {}).get("grid", 160)) ** 3, "native-cell index exceeds source grid")
    ordered = np.sort(np.asarray(indices))
    require(not np.any(ordered[1:] == ordered[:-1]), "duplicate native-cell indices are forbidden")
    feature_view = manifest.get("featureView") or {}
    require(feature_view.get("order") == FEATURE_ORDER, "feature order drifted")

    required_rows = {"nativeCellIndices": index_path}
    if rows.get("features") is not None:
        required_rows["features"] = validate_artifact(rows["features"], manifest_path, "features", "float32-le", [count, 24], verify_hashes)
    if rows.get("admission") is not None:
        required_rows["admission"] = validate_artifact(rows["admission"], manifest_path, "admission", "float32-le", [count, 2], verify_hashes)
    if rows.get("coefficients") is not None:
        required_rows["coefficients"] = validate_artifact(rows["coefficients"], manifest_path, "coefficients", "float32-le", [count, 8], verify_hashes)
    descriptor = rows.get("kernelDescriptors")
    descriptor_receipt: dict[str, Any] = {}
    if descriptor is not None:
        required_rows["kernelDescriptors"] = validate_artifact(descriptor, manifest_path, "kernel descriptors", "float32-le", [count, 100], verify_hashes)
        require(descriptor.get("candidateAdmissionAuthority") == ADMISSION_AUTHORITY, f"descriptor admission must be {ADMISSION_AUTHORITY}")
        authority = descriptor.get("admissionIndexAuthority") or {}
        require(authority.get("identity") == ADMISSION_AUTHORITY, "descriptor index authority drifted")
        require(authority.get("indexSha256") == index_desc.get("sha256"), "descriptor/index checksum binding drifted")
        require(authority.get("count") == count, "descriptor/index count binding drifted")
        require(authority.get("duplicatePolicy") == "forbidden", "descriptor duplicate policy drifted")
        require(authority.get("orderIdentity") == "caller-ordered", "descriptor row order drifted")
        runtime = authority.get("runtimeReceipt") or {}
        require(runtime.get("status") == "applied" and runtime.get("fallbackReason") is None, "descriptor population was not applied exactly")
        descriptor_receipt = {
            "socketIdentity": descriptor.get("socketIdentity"),
            "kernelIdentity": descriptor.get("kernelIdentity"),
            "sourceHashes": descriptor.get("sourceHashes"),
            "sourceManifestSha256": descriptor.get("sourceManifestSha256"),
            "indexSha256": index_desc.get("sha256"),
            "descriptorSha256": descriptor.get("sha256"),
            "requestedControls": descriptor.get("requestedControls"),
            "effectiveControls": descriptor.get("effectiveControls"),
            "runtimeReceipt": runtime,
        }
    return state, required_rows, descriptor_receipt


def validate_capture_report(capture: dict[str, Any], state_step: int) -> list[dict[str, Any]]:
    require(capture.get("schema") == CAPTURE_SCHEMA, f"capture report schema must be {CAPTURE_SCHEMA}")
    require(capture.get("status") == "complete", "capture report is not complete")
    require(capture.get("effectiveRendererRoute") == "native-3d-compute-fluid-raymarch-v0", "capture renderer route drifted")
    frozen = capture.get("frozenState") or {}
    require(frozen.get("baseFrameCount") == state_step and frozen.get("baseSimStepCount") == state_step, "capture frozen state step drifted")
    config = capture.get("captureConfig") or {}
    require(config.get("simulatorAdvance") is False, "capture orbit advanced the simulator")
    require(config.get("smoke") == "off", "capture target contains smoke")
    cameras: dict[int, dict[str, Any]] = {}
    modes_by_camera: dict[int, set[str]] = {}
    for item in capture.get("captures") or []:
        index = item.get("cameraIndex")
        if not isinstance(index, int) or not (0 <= index <= 20):
            continue
        modes_by_camera.setdefault(index, set()).add(item.get("mode"))
        if item.get("mode") == "kernelMomentCovariance":
            cameras[index] = item
        if item.get("sameStateCaptureId") != frozen.get("sameStateCaptureId"):
            raise ValueError(f"camera {index} same-state identity drifted")
        if item.get("frameCount") != state_step or item.get("simStepCount") != state_step:
            raise ValueError(f"camera {index} effective state drifted")
        if item.get("effectiveRoute") != "native-3d-compute-fluid-raymarch-v0" or item.get("backend") != "WebGPU:apple":
            raise ValueError(f"camera {index} route/backend fallback detected")
        image_path = Path(item.get("imagePath", ""))
        require(image_path.is_file() and image_path.stat().st_size > 0, f"camera {index} {item.get('mode')} image is missing or blank")
    require(set(cameras) == set(range(21)), "capture must contain all 21 kernel-moment cameras")
    for index in range(21):
        require(REQUIRED_MODES.issubset(modes_by_camera.get(index, set())), f"camera {index} is partial")
    hashes = [cameras[index].get("cameraPoseHash") for index in range(21)]
    require(len(set(hashes)) == 21, "camera orbit reused a cached pose")
    return [cameras[index] for index in range(21)]


def project(points: np.ndarray, matrix_world_inverse: list[float], projection: list[float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    # Three.js serializes column-major Matrix4.elements.
    view = np.asarray(matrix_world_inverse, dtype=np.float64).reshape(4, 4, order="F")
    proj = np.asarray(projection, dtype=np.float64).reshape(4, 4, order="F")
    homogeneous = np.concatenate([points.astype(np.float64, copy=False), np.ones((points.shape[0], 1))], axis=1)
    view_points = homogeneous @ view.T
    clip = view_points @ proj.T
    w = clip[:, 3]
    valid = w > 1e-5
    ndc = np.zeros((points.shape[0], 2), dtype=np.float32)
    ndc[valid] = (clip[valid, :2] / w[valid, None]).astype(np.float32)
    depth = (-view_points[:, 2]).astype(np.float32)
    return ndc, depth, valid


def scatter_channel(flat_indices: np.ndarray, weights: np.ndarray, size: int) -> np.ndarray:
    return np.bincount(flat_indices, weights=weights.astype(np.float64, copy=False), minlength=size).astype(np.float32)


def footprint_identity(mode: str) -> str:
    require(mode in FOOTPRINT_MODES, f"unknown footprint mode {mode}")
    return FOOTPRINT_MODES[mode]


def bilinear_pixel_samples(
    x: np.ndarray, y: np.ndarray
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx = (x - x0).astype(np.float32)
    fy = (y - y0).astype(np.float32)
    return [
        (x0, y0, (1.0 - fx) * (1.0 - fy)),
        (x0 + 1, y0, fx * (1.0 - fy)),
        (x0, y0 + 1, (1.0 - fx) * fy),
        (x0 + 1, y0 + 1, fx * fy),
    ]


def tangent_pixel_samples(
    pixel_x: np.ndarray,
    pixel_y: np.ndarray,
    tangent_x: np.ndarray,
    tangent_y: np.ndarray,
    major_px: np.ndarray,
):
    for tangent_offset, tangent_weight in zip(TANGENT_OFFSETS, TANGENT_WEIGHTS):
        sample_x = pixel_x + tangent_x * major_px * tangent_offset
        sample_y = pixel_y + tangent_y * major_px * tangent_offset
        for x, y, pixel_weight in bilinear_pixel_samples(sample_x, sample_y):
            yield x, y, pixel_weight * tangent_weight


def weighted_tangent_pixel_samples(
    pixel_x: np.ndarray,
    pixel_y: np.ndarray,
    tangent_x: np.ndarray,
    tangent_y: np.ndarray,
    major_px: np.ndarray,
    candidate_weight: np.ndarray,
):
    require(candidate_weight.shape == pixel_x.shape, "candidate weight shape must match candidate rows")
    for x, y, weight in tangent_pixel_samples(pixel_x, pixel_y, tangent_x, tangent_y, major_px):
        yield x, y, weight * candidate_weight


def gauss_hermite_axis(variance: float) -> tuple[np.ndarray, np.ndarray]:
    require(math.isfinite(variance) and variance > 0.0, "Gauss-Hermite variance must be finite and positive")
    offsets = np.sqrt(2.0 * variance) * GAUSS_HERMITE_RAW_NODES
    return offsets.astype(np.float64), GAUSS_HERMITE_WEIGHTS.astype(np.float64)


def gauss_hermite_pixel_samples(
    pixel_x: np.ndarray,
    pixel_y: np.ndarray,
    tangent_x: np.ndarray,
    tangent_y: np.ndarray,
    major_px: np.ndarray,
    minor_px: np.ndarray,
    candidate_weight: np.ndarray | None = None,
):
    tangent_nodes, tangent_weights = gauss_hermite_axis(TANGENT_UNIT_VARIANCE)
    normal_nodes, normal_weights = gauss_hermite_axis(NORMAL_UNIT_VARIANCE)
    normal_x = -tangent_y
    normal_y = tangent_x
    if candidate_weight is None:
        candidate_weight = np.ones_like(pixel_x, dtype=np.float32)
    require(candidate_weight.shape == pixel_x.shape, "candidate weight shape must match candidate rows")
    for tangent_offset, tangent_weight in zip(tangent_nodes, tangent_weights):
        for normal_offset, normal_weight in zip(normal_nodes, normal_weights):
            sample_x = (
                pixel_x
                + tangent_x * major_px * tangent_offset
                + normal_x * minor_px * normal_offset
            )
            sample_y = (
                pixel_y
                + tangent_y * major_px * tangent_offset
                + normal_y * minor_px * normal_offset
            )
            quadrature_weight = float(tangent_weight * normal_weight)
            for x, y, pixel_weight in bilinear_pixel_samples(sample_x, sample_y):
                yield x, y, pixel_weight * quadrature_weight * candidate_weight


def compound_pixel_samples(
    pixel_x: np.ndarray,
    pixel_y: np.ndarray,
    tangent_x: np.ndarray,
    tangent_y: np.ndarray,
    major_px: np.ndarray,
    minor_px: np.ndarray,
    halo_mass: float,
):
    require(math.isfinite(halo_mass) and 0.0 <= halo_mass <= 1.0, "compound halo mass must remain in [0, 1]")
    core_weight = np.full_like(pixel_x, 1.0 - halo_mass, dtype=np.float32)
    halo_weight = np.full_like(pixel_x, halo_mass, dtype=np.float32)
    yield from weighted_tangent_pixel_samples(
        pixel_x, pixel_y, tangent_x, tangent_y, major_px, core_weight,
    )
    yield from gauss_hermite_pixel_samples(
        pixel_x, pixel_y, tangent_x, tangent_y, major_px, minor_px, halo_weight,
    )


def selective_split_pixel_samples(
    pixel_x: np.ndarray,
    pixel_y: np.ndarray,
    negative_x: np.ndarray,
    negative_y: np.ndarray,
    positive_x: np.ndarray,
    positive_y: np.ndarray,
    tangent_x: np.ndarray,
    tangent_y: np.ndarray,
    major_px: np.ndarray,
    split_mask: np.ndarray,
):
    require(split_mask.shape == pixel_x.shape and split_mask.dtype == np.bool_, "split mask must be a boolean candidate-row vector")
    child_rows = (
        (negative_x, negative_y, 0.25),
        (pixel_x, pixel_y, 0.50),
        (positive_x, positive_y, 0.25),
    )
    for child_index, (child_x, child_y, child_mass) in enumerate(child_rows):
        unsplit_mass = 1.0 if child_index == 1 else 0.0
        candidate_weight = np.where(split_mask, child_mass, unsplit_mass).astype(np.float32)
        yield from weighted_tangent_pixel_samples(
            child_x, child_y, tangent_x, tangent_y, major_px, candidate_weight,
        )


def core_skirt_pixel_samples(
    pixel_x: np.ndarray,
    pixel_y: np.ndarray,
    tangent_x: np.ndarray,
    tangent_y: np.ndarray,
    major_px: np.ndarray,
    minor_px: np.ndarray,
    skirt_mix: np.ndarray,
):
    require(skirt_mix.shape == pixel_x.shape, "skirt mix shape must match candidate rows")
    require(np.all(np.isfinite(skirt_mix)), "skirt mix contains nonfinite values")
    require(float(np.min(skirt_mix)) >= 0.0 and float(np.max(skirt_mix)) <= 1.0, "effective skirt mix must remain in [0, 1]")
    normal_x = -tangent_y
    normal_y = tangent_x
    normal_samples = (
        (-1.0, skirt_mix * 0.125),
        (0.0, 1.0 - skirt_mix * 0.25),
        (1.0, skirt_mix * 0.125),
    )
    for tangent_offset, tangent_weight in zip(TANGENT_OFFSETS, TANGENT_WEIGHTS):
        for normal_offset, normal_weight in normal_samples:
            sample_x = (
                pixel_x
                + tangent_x * major_px * tangent_offset
                + normal_x * minor_px * normal_offset
            )
            sample_y = (
                pixel_y
                + tangent_y * major_px * tangent_offset
                + normal_y * minor_px * normal_offset
            )
            quadrature_weight = tangent_weight * normal_weight
            for x, y, pixel_weight in bilinear_pixel_samples(sample_x, sample_y):
                yield x, y, pixel_weight * quadrature_weight


def ellipse_pixel_samples(
    pixel_x: np.ndarray,
    pixel_y: np.ndarray,
    tangent_x: np.ndarray,
    tangent_y: np.ndarray,
    major_px: np.ndarray,
    minor_px: np.ndarray,
):
    yield from core_skirt_pixel_samples(
        pixel_x, pixel_y, tangent_x, tangent_y, major_px, minor_px,
        np.ones_like(pixel_x, dtype=np.float32),
    )


def conditioned_skirt_mix(features: np.ndarray, global_mix: float, ridge_rejection: float) -> np.ndarray:
    ridge = np.clip(features[:, RIDGE_FEATURE_INDEX], 0.0, 1.0)
    return (global_mix * (1.0 - ridge_rejection * ridge)).astype(np.float32)


def resolve_footprint_controls(args: argparse.Namespace) -> dict[str, Any]:
    requested = {
        "skirtMix": args.skirt_mix,
        "skirtMinorScale": args.skirt_minor_scale,
        "skirtRidgeRejection": args.skirt_ridge_rejection,
    }
    provided = [value is not None for value in requested.values()]
    compound_provided = args.compound_halo_mass is not None
    split_requested = {
        "splitAttributionCameras": args.split_attribution_cameras,
        "splitScoreThreshold": args.split_score_threshold,
        "splitMinCameraSupport": args.split_min_camera_support,
        "splitOffsetWorld": args.split_offset_world,
    }
    split_provided = [value is not None for value in split_requested.values()]
    if args.footprint_mode == "core-skirt":
        require(not compound_provided and not any(split_provided), "core-skirt mode forbids compound and selective-split controls")
        require(all(provided), "core-skirt mode requires explicit --skirt-mix, --skirt-minor-scale, and --skirt-ridge-rejection")
        require(math.isfinite(args.skirt_mix) and 0.0 <= args.skirt_mix <= 1.0, "--skirt-mix must be finite and in [0, 1]")
        require(math.isfinite(args.skirt_minor_scale) and args.skirt_minor_scale > 0.0, "--skirt-minor-scale must be finite and positive")
        require(math.isfinite(args.skirt_ridge_rejection) and 0.0 <= args.skirt_ridge_rejection <= 1.0, "--skirt-ridge-rejection must be finite and in [0, 1]")
        return {
            **requested,
            "conditioningFeature": FEATURE_ORDER[RIDGE_FEATURE_INDEX],
            "controlsExplicit": True,
            "compoundHaloMass": None,
            **{key: None for key in split_requested},
        }
    require(not any(provided), "skirt controls are only lawful with --footprint-mode core-skirt")
    if args.footprint_mode == "compound":
        require(compound_provided, "compound mode requires explicit --compound-halo-mass")
        require(not any(split_provided), "compound mode forbids selective-split controls")
        require(math.isfinite(args.compound_halo_mass) and 0.0 <= args.compound_halo_mass <= 1.0, "--compound-halo-mass must be finite and in [0, 1]")
        return {
            "skirtMix": None, "skirtMinorScale": 1.0, "skirtRidgeRejection": None,
            "conditioningFeature": None, "controlsExplicit": True,
            "compoundHaloMass": float(args.compound_halo_mass),
            **{key: None for key in split_requested},
        }
    require(not compound_provided, "--compound-halo-mass is only lawful with --footprint-mode compound")
    if args.footprint_mode == "selective-split":
        require(all(split_provided), "selective-split mode requires explicit attribution cameras, score threshold, minimum camera support, and world offset")
        try:
            attribution_cameras = [int(value) for value in args.split_attribution_cameras.split(",")]
        except Exception as exc:
            raise ValueError("--split-attribution-cameras must be a comma-separated integer list") from exc
        require(len(attribution_cameras) >= 2, "selective-split attribution requires at least two cameras")
        require(len(set(attribution_cameras)) == len(attribution_cameras), "selective-split attribution cameras must be unique")
        require(all(0 <= value <= 20 for value in attribution_cameras), "selective-split attribution cameras must remain in [0, 20]")
        held_out_cameras = set(range(21)) - set(attribution_cameras) - {10}
        require(held_out_cameras, "selective-split must leave at least one non-calibration held-out camera")
        require(math.isfinite(args.split_score_threshold) and args.split_score_threshold >= 0.0, "--split-score-threshold must be finite and nonnegative")
        require(2 <= args.split_min_camera_support <= len(attribution_cameras), "--split-min-camera-support must be multiview and no larger than the attribution cohort")
        require(math.isfinite(args.split_offset_world) and args.split_offset_world > 0.0, "--split-offset-world must be finite and positive")
        return {
            "skirtMix": None, "skirtMinorScale": 1.0, "skirtRidgeRejection": None,
            "conditioningFeature": None, "controlsExplicit": True,
            "compoundHaloMass": None,
            "splitAttributionCameras": attribution_cameras,
            "splitScoreThreshold": float(args.split_score_threshold),
            "splitMinCameraSupport": int(args.split_min_camera_support),
            "splitOffsetWorld": float(args.split_offset_world),
        }
    require(not any(split_provided), "selective-split controls are only lawful with --footprint-mode selective-split")
    if args.footprint_mode == "ellipse":
        return {
            "skirtMix": 1.0, "skirtMinorScale": 1.0, "skirtRidgeRejection": 0.0,
            "conditioningFeature": None, "controlsExplicit": False, "compoundHaloMass": None,
            **{key: None for key in split_requested},
        }
    if args.footprint_mode == "bilinear":
        return {
            "skirtMix": 0.0, "skirtMinorScale": 1.0, "skirtRidgeRejection": 0.0,
            "conditioningFeature": None, "controlsExplicit": False, "compoundHaloMass": None,
            **{key: None for key in split_requested},
        }
    return {
        "skirtMix": None, "skirtMinorScale": None, "skirtRidgeRejection": None,
        "conditioningFeature": None, "controlsExplicit": False, "compoundHaloMass": None,
        **{key: None for key in split_requested},
    }


def bilinear_footprint_controls() -> dict[str, Any]:
    return {
        "skirtMix": 0.0,
        "skirtMinorScale": 1.0,
        "skirtRidgeRejection": 0.0,
        "conditioningFeature": None,
        "controlsExplicit": False,
        "compoundHaloMass": None,
        "splitAttributionCameras": None,
        "splitScoreThreshold": None,
        "splitMinCameraSupport": None,
        "splitOffsetWorld": None,
    }


def rasterize_coefficients(
    positions: np.ndarray,
    tangents: np.ndarray,
    features: np.ndarray,
    coefficients: np.ndarray,
    camera: dict[str, Any],
    depth_bins: int,
    footprint_mode: str,
    footprint_controls: dict[str, Any],
    split_mask: np.ndarray | None = None,
    split_world_offsets: np.ndarray | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    width, height = int(camera["width"]), int(camera["height"])
    pose = camera["cameraPose"]
    ndc, depth, valid = project(positions, pose["matrixWorldInverse"], pose["projectionMatrix"])
    pixel_x = (ndc[:, 0] * 0.5 + 0.5) * width
    pixel_y = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height
    x = pixel_x.astype(np.int32)
    y = pixel_y.astype(np.int32)
    valid &= (x >= 0) & (x < width) & (y >= 0) & (y < height) & np.isfinite(depth)
    valid_indices = np.flatnonzero(valid)
    require(valid_indices.size > 0, f"camera {camera['cameraIndex']} projected zero admitted rows")
    near = float(np.percentile(depth[valid_indices], 0.01))
    far = float(np.percentile(depth[valid_indices], 99.99))
    depth_index = np.clip(((depth - near) / max(far - near, 1e-6) * (depth_bins - 1)).astype(np.int32), 0, depth_bins - 1)

    # Quantized projected tangent offsets retain the accepted descriptor orientation
    # without inventing a learned covariance. Radius is the exact renderer base
    # radius plus its accepted 0.03 world-space second moment.
    tangent_points = positions + tangents * 0.03
    tangent_ndc, _, tangent_valid = project(tangent_points, pose["matrixWorldInverse"], pose["projectionMatrix"])
    tx = (tangent_ndc[:, 0] - ndc[:, 0]) * 0.5 * width
    ty = -(tangent_ndc[:, 1] - ndc[:, 1]) * 0.5 * height
    length = np.maximum(np.sqrt(tx * tx + ty * ty), 1e-5)
    tx = tx / length
    ty = ty / length
    base_radius = (2.0 / 160.0) * (0.60 + features[:, 3] * 2.65 + features[:, 2] * 0.48)
    pixel_world_scale = np.maximum(length / 0.03, 1.0)
    major_px = np.clip(np.sqrt(base_radius * base_radius + 0.5 * 0.03 * 0.03) * pixel_world_scale, 0.75, 5.0)
    minor_scale = float(footprint_controls["skirtMinorScale"] or 1.0)
    minor_px = np.clip(base_radius * pixel_world_scale * minor_scale, 0.5, 4.0)
    offsets = (-1.0, -0.5, 0.0, 0.5, 1.0)
    offset_weights = (0.075, 0.225, 0.4, 0.225, 0.075)
    raster_size = depth_bins * height * width
    planes = np.zeros((depth_bins, height, width, 8), dtype=np.float32)
    if footprint_mode == "nearest":
        pixel_samples = (
            (
                x + np.rint(tx * major_px * offset).astype(np.int32),
                y + np.rint(ty * major_px * offset).astype(np.int32),
                np.full_like(pixel_x, footprint_weight, dtype=np.float32),
            )
            for offset, footprint_weight in zip(offsets, offset_weights)
        )
    elif footprint_mode == "bilinear":
        pixel_samples = tangent_pixel_samples(pixel_x, pixel_y, tx, ty, major_px)
    elif footprint_mode == "ellipse":
        pixel_samples = ellipse_pixel_samples(pixel_x, pixel_y, tx, ty, major_px, minor_px)
        nominal_quadrature_samples = 15
        nominal_pixel_deposits = 60
    elif footprint_mode == "core-skirt":
        skirt_mix = conditioned_skirt_mix(
            features,
            float(footprint_controls["skirtMix"]),
            float(footprint_controls["skirtRidgeRejection"]),
        )
        pixel_samples = core_skirt_pixel_samples(pixel_x, pixel_y, tx, ty, major_px, minor_px, skirt_mix)
        nominal_quadrature_samples = 15
        nominal_pixel_deposits = 60
    elif footprint_mode == "higher-order":
        pixel_samples = gauss_hermite_pixel_samples(pixel_x, pixel_y, tx, ty, major_px, minor_px)
        nominal_quadrature_samples = GAUSS_HERMITE_ORDER ** 2
        nominal_pixel_deposits = nominal_quadrature_samples * 4
    elif footprint_mode == "compound":
        pixel_samples = compound_pixel_samples(
            pixel_x, pixel_y, tx, ty, major_px, minor_px,
            float(footprint_controls["compoundHaloMass"]),
        )
        nominal_quadrature_samples = 5 + GAUSS_HERMITE_ORDER ** 2
        nominal_pixel_deposits = nominal_quadrature_samples * 4
    else:
        require(footprint_mode == "selective-split", f"unknown footprint mode {footprint_mode}")
        require(split_mask is not None and split_mask.shape == (positions.shape[0],), "selective-split requires one frozen split mask for every candidate")
        require(split_world_offsets is not None and split_world_offsets.shape == positions.shape, "selective-split requires one frozen world offset for every candidate")
        negative_ndc, _, negative_valid = project(
            positions - split_world_offsets, pose["matrixWorldInverse"], pose["projectionMatrix"],
        )
        positive_ndc, _, positive_valid = project(
            positions + split_world_offsets, pose["matrixWorldInverse"], pose["projectionMatrix"],
        )
        negative_x = (negative_ndc[:, 0] * 0.5 + 0.5) * width
        negative_y = (1.0 - (negative_ndc[:, 1] * 0.5 + 0.5)) * height
        positive_x = (positive_ndc[:, 0] * 0.5 + 0.5) * width
        positive_y = (1.0 - (positive_ndc[:, 1] * 0.5 + 0.5)) * height
        valid &= (~split_mask) | (negative_valid & positive_valid)
        pixel_samples = selective_split_pixel_samples(
            pixel_x, pixel_y, negative_x, negative_y, positive_x, positive_y,
            tx, ty, major_px, split_mask,
        )
        nominal_quadrature_samples = None
        nominal_pixel_deposits = None
    if footprint_mode == "nearest":
        nominal_quadrature_samples = 5
        nominal_pixel_deposits = 5
    elif footprint_mode == "bilinear":
        nominal_quadrature_samples = 5
        nominal_pixel_deposits = 20
    effective_projected_rows = int(np.count_nonzero(valid & tangent_valid))
    require(effective_projected_rows > 0, f"camera {camera['cameraIndex']} retained zero effective projected rows")
    projected_fragments = 0
    for sx, sy, sample_weight in pixel_samples:
        selected = valid & tangent_valid & (sample_weight > 0.0) & (sx >= 0) & (sx < width) & (sy >= 0) & (sy < height)
        rows = np.flatnonzero(selected)
        projected_fragments += int(rows.size)
        flat = ((depth_index[rows] * height + sy[rows]) * width + sx[rows]).astype(np.int64)
        for channel in range(8):
            planes[..., channel] += scatter_channel(flat, coefficients[rows, channel] * sample_weight[rows], raster_size).reshape(depth_bins, height, width)
    return planes, {
        "admittedRows": int(positions.shape[0]),
        "projectedRows": effective_projected_rows,
        "nearDepth": near,
        "farDepth": far,
        "depthBins": depth_bins,
        "orderApproximation": ORDER_APPROXIMATION,
        "kernelGeometry": KERNEL_GEOMETRY,
        "footprintMode": footprint_identity(footprint_mode),
        "orientation": footprint_identity(footprint_mode),
        "nominalQuadratureWeightSum": 1.0,
        "nominalQuadratureSamples": nominal_quadrature_samples,
        "nominalPixelDepositsPerCandidate": nominal_pixel_deposits,
        "projectedFragments": projected_fragments,
        "projectedFragmentsPerProjectedRow": float(projected_fragments / effective_projected_rows),
        "postProcessBlur": False,
        "footprintControls": footprint_controls,
        "effectiveSkirtMix": {
            "minimum": float(np.min(skirt_mix)) if footprint_mode == "core-skirt" else float(footprint_controls["skirtMix"]),
            "mean": float(np.mean(skirt_mix)) if footprint_mode == "core-skirt" else float(footprint_controls["skirtMix"]),
            "maximum": float(np.max(skirt_mix)) if footprint_mode == "core-skirt" else float(footprint_controls["skirtMix"]),
        } if footprint_mode in {"bilinear", "ellipse", "core-skirt"} else None,
        "compoundHaloMass": footprint_controls["compoundHaloMass"],
        "splitCandidateCount": int(np.count_nonzero(split_mask)) if split_mask is not None else 0,
        "splitSelectionCap": None,
        "minorPixelClamp": [0.5, 4.0],
    }


def compose_planes(planes: np.ndarray, path_scale: float, extinction_mode: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    height, width = planes.shape[1:3]
    transmittance = np.ones((height, width), dtype=np.float32)
    ridge = np.zeros((height, width, 3), dtype=np.float32)
    nonridge = np.zeros_like(ridge)
    for depth_index in range(planes.shape[0]):
        layer = planes[depth_index]
        ridge += transmittance[..., None] * layer[..., 0:3] * path_scale
        nonridge += transmittance[..., None] * layer[..., 4:7] * path_scale
        if extinction_mode == "ridge":
            sigma = layer[..., 3]
        elif extinction_mode == "total":
            sigma = layer[..., 3] + layer[..., 7]
        else:
            raise ValueError(f"unknown extinction mode: {extinction_mode}")
        transmittance *= np.exp(-np.maximum(sigma, 0.0) * path_scale)
    return ridge + nonridge, ridge, nonridge, transmittance


def tone_map(linear: np.ndarray) -> np.ndarray:
    exposed = 1.0 - np.exp(-np.maximum(linear, 0.0) * 0.96)
    mapped = np.power(np.clip(exposed, 0.0, 1.0), 0.84)
    return np.rint(mapped * 255.0).astype(np.uint8)


def image_rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)


def image_metrics(candidate: np.ndarray, target: np.ndarray) -> dict[str, Any]:
    a = candidate.astype(np.float32) / 255.0
    b = target.astype(np.float32) / 255.0
    delta = a - b
    luma_a = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    luma_b = b @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    gradient_a = np.zeros_like(luma_a)
    gradient_b = np.zeros_like(luma_b)
    gradient_a[:, :-1] += np.square(np.diff(luma_a, axis=1))
    gradient_a[:-1, :] += np.square(np.diff(luma_a, axis=0))
    gradient_b[:, :-1] += np.square(np.diff(luma_b, axis=1))
    gradient_b[:-1, :] += np.square(np.diff(luma_b, axis=0))
    np.sqrt(gradient_a, out=gradient_a)
    np.sqrt(gradient_b, out=gradient_b)

    top_tail_threshold = float(np.percentile(luma_b, 99.0))
    top_tail_mask = luma_b >= top_tail_threshold
    high_gradient_threshold = float(np.percentile(gradient_b, 90.0))
    high_gradient_mask = (gradient_b >= high_gradient_threshold) & (gradient_b > 0.0)
    wisp_threshold = float(np.percentile(gradient_b, 97.5))
    wisp_mask = (gradient_b >= wisp_threshold) & (gradient_b > 0.0)

    top_tail_underfit = np.maximum(luma_b[top_tail_mask] - luma_a[top_tail_mask], 0.0)
    high_gradient_underfit = np.maximum(
        gradient_b[high_gradient_mask] - gradient_a[high_gradient_mask], 0.0,
    )
    wisp_underfit = np.maximum(gradient_b[wisp_mask] - gradient_a[wisp_mask], 0.0)
    residual_luma = luma_a - luma_b
    window_y = np.hanning(residual_luma.shape[0]).astype(np.float32)
    window_x = np.hanning(residual_luma.shape[1]).astype(np.float32)
    window = window_y[:, None] * window_x[None, :]
    spectrum = np.fft.rfft2((residual_luma - float(np.mean(residual_luma))) * window)
    power = np.square(np.abs(spectrum)) / max(float(np.sum(np.square(window))), 1e-12)
    frequency_y = np.fft.fftfreq(residual_luma.shape[0])[:, None]
    frequency_x = np.fft.rfftfreq(residual_luma.shape[1])[None, :]
    frequency_radius = np.sqrt(np.square(frequency_x) + np.square(frequency_y))
    dot_band = (frequency_radius >= 0.08) & (frequency_radius <= 0.45)
    return {
        "mae": float(np.mean(np.abs(delta))),
        "mse": float(np.mean(delta * delta)),
        "lumaMae": float(np.mean(np.abs(luma_a - luma_b))),
        "gradientMae": float(np.mean(np.abs(gradient_a - gradient_b))),
        "targetTopTailLumaUnderfit": float(np.mean(top_tail_underfit)),
        "targetTopTailLumaThreshold": top_tail_threshold,
        "targetHighGradientUnderfit": float(np.mean(high_gradient_underfit)) if high_gradient_underfit.size else 0.0,
        "targetHighGradientThreshold": high_gradient_threshold,
        "targetWispUnderfit": float(np.mean(wisp_underfit)) if wisp_underfit.size else 0.0,
        "targetWispGradientThreshold": wisp_threshold,
        "structuredDotSpectralPower": float(np.mean(power[dot_band])) if np.any(dot_band) else 0.0,
        "structuredDotFrequencyBandCyclesPerPixel": [0.08, 0.45],
        "meanLuma": float(np.mean(luma_a)),
        "targetMeanLuma": float(np.mean(luma_b)),
    }


def candidate_residual_importance(
    positions: np.ndarray,
    coefficients: np.ndarray,
    camera: dict[str, Any],
    planes: np.ndarray,
    target: np.ndarray,
    path_scale: float,
    depth_bins: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    candidate = tone_map(compose_planes(planes, path_scale, "total")[0])
    a = candidate.astype(np.float32) / 255.0
    b = target.astype(np.float32) / 255.0
    luma_a = a @ np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)
    luma_b = b @ np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)
    gradient_a = np.zeros_like(luma_a)
    gradient_b = np.zeros_like(luma_b)
    gradient_a[:, :-1] += np.square(np.diff(luma_a, axis=1))
    gradient_a[:-1, :] += np.square(np.diff(luma_a, axis=0))
    gradient_b[:, :-1] += np.square(np.diff(luma_b, axis=1))
    gradient_b[:-1, :] += np.square(np.diff(luma_b, axis=0))
    np.sqrt(gradient_a, out=gradient_a)
    np.sqrt(gradient_b, out=gradient_b)
    tail_threshold = float(np.percentile(luma_b, 99.0))
    wisp_threshold = float(np.percentile(gradient_b, 97.5))
    residual_map = (
        np.maximum(luma_b - luma_a, 0.0) * (luma_b >= tail_threshold)
        + np.maximum(gradient_b - gradient_a, 0.0) * ((gradient_b >= wisp_threshold) & (gradient_b > 0.0))
    ).astype(np.float32)

    width, height = int(camera["width"]), int(camera["height"])
    pose = camera["cameraPose"]
    ndc, depth, valid = project(positions, pose["matrixWorldInverse"], pose["projectionMatrix"])
    pixel_x = np.floor((ndc[:, 0] * 0.5 + 0.5) * width).astype(np.int32)
    pixel_y = np.floor((1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height).astype(np.int32)
    valid &= (
        (pixel_x >= 0) & (pixel_x < width) & (pixel_y >= 0) & (pixel_y < height)
        & np.isfinite(depth)
    )
    valid_indices = np.flatnonzero(valid)
    require(valid_indices.size > 0, f"camera {camera['cameraIndex']} attributed zero candidate rows")
    near = float(np.percentile(depth[valid_indices], 0.01))
    far = float(np.percentile(depth[valid_indices], 99.99))
    depth_index = np.clip(
        ((depth - near) / max(far - near, 1e-6) * (depth_bins - 1)).astype(np.int32),
        0, depth_bins - 1,
    )
    ordered = valid_indices[np.argsort(depth_index[valid_indices], kind="stable")]
    ordered_bins = depth_index[ordered]
    bin_starts = np.searchsorted(ordered_bins, np.arange(depth_bins + 1), side="left")
    transmittance = np.ones((height, width), dtype=np.float32)
    scores = np.zeros(positions.shape[0], dtype=np.float32)
    support = np.zeros(positions.shape[0], dtype=np.bool_)
    emission_luma = (
        (coefficients[:, 0] + coefficients[:, 4]) * 0.2126
        + (coefficients[:, 1] + coefficients[:, 5]) * 0.7152
        + (coefficients[:, 2] + coefficients[:, 6]) * 0.0722
    )
    sigma = coefficients[:, 3] + coefficients[:, 7]
    local_optical_weight = 1.0 - np.exp(-np.maximum(emission_luma + sigma, 0.0) * path_scale)
    for depth_index_value in range(depth_bins):
        rows = ordered[bin_starts[depth_index_value]:bin_starts[depth_index_value + 1]]
        if rows.size:
            y = pixel_y[rows]
            x = pixel_x[rows]
            contribution = transmittance[y, x] * local_optical_weight[rows]
            sampled_residual = residual_map[y, x]
            scores[rows] = sampled_residual * contribution
            support[rows] = (sampled_residual > 0.0) & (contribution > 0.0)
        layer = planes[depth_index_value]
        transmittance *= np.exp(-np.maximum(layer[..., 3] + layer[..., 7], 0.0) * path_scale)
    return scores, support, {
        "cameraIndex": int(camera["cameraIndex"]),
        "tailThreshold": tail_threshold,
        "wispThreshold": wisp_threshold,
        "positiveResidualPixels": int(np.count_nonzero(residual_map > 0.0)),
        "attributedCandidateRows": int(np.count_nonzero(support)),
        "scoreMaximum": float(np.max(scores, initial=0.0)),
        "scoreMeanPositive": float(np.mean(scores[scores > 0.0])) if np.any(scores > 0.0) else 0.0,
    }


def build_split_offsets(
    descriptors: np.ndarray,
    requested_mask: np.ndarray,
    offset_world: float,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    require(requested_mask.shape == (descriptors.shape[0],), "requested split mask shape drifted")
    normals = np.asarray(descriptors[:, 16:19], dtype=np.float32)
    tangents = np.asarray(descriptors[:, 20:23], dtype=np.float32)
    normal_valid = np.asarray(descriptors[:, 19] > 0.5)
    bitangents = np.cross(normals, tangents)
    lengths = np.linalg.norm(bitangents, axis=1)
    orientation_valid = normal_valid & np.isfinite(lengths) & (lengths > 1e-6)
    effective_mask = requested_mask & orientation_valid
    offsets = np.zeros_like(bitangents, dtype=np.float32)
    offsets[effective_mask] = (
        bitangents[effective_mask] / lengths[effective_mask, None] * float(offset_world)
    ).astype(np.float32)
    return effective_mask, offsets, {
        "requestedSplitCount": int(np.count_nonzero(requested_mask)),
        "effectiveSplitCount": int(np.count_nonzero(effective_mask)),
        "orientationRejectedCount": int(np.count_nonzero(requested_mask & ~orientation_valid)),
        "splitOffsetWorld": float(offset_world),
        "orientationIdentity": "structure-normal-cross-flow-tangent-bitangent-v0",
        "splitSelectionCap": None,
    }


def fit_optical_path_scale(planes: np.ndarray, target: np.ndarray) -> dict[str, Any]:
    trials: list[dict[str, float]] = []
    seen: set[float] = set()

    def evaluate(scales: np.ndarray | list[float]) -> None:
        for scalar_value in scales:
            scalar = float(scalar_value)
            key = round(scalar, 15)
            if key in seen:
                continue
            seen.add(key)
            linear, _, _, _ = compose_planes(planes, scalar, "total")
            trials.append({"pathScale": scalar, **image_metrics(tone_map(linear), target)})

    evaluate([0.0])
    upper = 2.0
    evaluate(np.geomspace(0.0005, upper, 41))
    expansion_count = 0
    while min(trials, key=lambda row: row["mae"])["pathScale"] >= upper * (1.0 - 1e-12):
        previous_upper = upper
        upper *= 2.0
        expansion_count += 1
        evaluate(np.geomspace(previous_upper * (1.0 + 1e-8), upper, 17))

    ordered = sorted(trials, key=lambda row: row["pathScale"])
    best = min(ordered, key=lambda row: row["mae"])
    best_index = ordered.index(best)
    calibration_boundary_hit = best_index == len(ordered) - 1
    require(not calibration_boundary_hit, "optical path calibration remained upper-bound limited")
    left = ordered[max(0, best_index - 1)]["pathScale"]
    right = ordered[min(len(ordered) - 1, best_index + 1)]["pathScale"]
    for _ in range(2):
        evaluate(np.linspace(left, right, 33))
        ordered = sorted(trials, key=lambda row: row["pathScale"])
        best = min(ordered, key=lambda row: row["mae"])
        best_index = ordered.index(best)
        left = ordered[max(0, best_index - 1)]["pathScale"]
        right = ordered[min(len(ordered) - 1, best_index + 1)]["pathScale"]
    return {
        "pathScale": float(best["pathScale"]),
        "trials": trials,
        "calibrationBoundaryHit": calibration_boundary_hit,
        "calibrationExpansionCount": expansion_count,
        "calibrationExpansionDiagnostic": expansion_count >= 4,
        "bracketUpper": upper,
    }


def find_capture(report: dict[str, Any], camera_index: int, mode: str, ray_steps: int | None = None) -> dict[str, Any]:
    matches = [item for item in report["captures"] if item.get("cameraIndex") == camera_index and item.get("mode") == mode]
    if ray_steps is not None:
        matches = [item for item in matches if item.get("effectiveRaySteps") == ray_steps]
    require(len(matches) == 1, f"camera {camera_index} mode {mode} has {len(matches)} captures")
    return matches[0]


def write_png(path: Path, pixels: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, mode="RGB").save(path)
    require(path.is_file() and path.stat().st_size > 100, f"blank output image: {path}")


def persist_capture_comparator(source: Path, destination: Path) -> np.ndarray:
    pixels = image_rgb(source)
    write_png(destination, pixels)
    return pixels


def residual_heatmap(candidate: np.ndarray, target: np.ndarray) -> np.ndarray:
    error = np.mean(np.abs(candidate.astype(np.float32) - target.astype(np.float32)), axis=2) / 255.0
    red = np.clip(error * 4.0, 0.0, 1.0)
    green = np.clip(1.0 - np.abs(error * 4.0 - 1.0), 0.0, 1.0) * 0.42
    blue = np.clip(1.0 - error * 5.0, 0.0, 1.0) * 0.18
    return np.rint(np.stack([red, green, blue], axis=2) * 255.0).astype(np.uint8)


def gallery_html(camera_rows: list[dict[str, Any]], report_name: str) -> str:
    data = json.dumps(camera_rows, separators=(",", ":"))
    return f"""<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>Layer Coefficient Oracle</title><style>
:root{{--bg:#111315;--panel:#1a1d20;--line:#353a3f;--text:#f1f3f4;--muted:#aab0b5;--accent:#ffb029}}
*{{box-sizing:border-box}} body{{margin:0;overflow-x:hidden;background:var(--bg);color:var(--text);font:14px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0}}
header{{display:flex;align-items:center;gap:18px;padding:12px 16px;border-bottom:1px solid var(--line);background:#15181a;position:sticky;top:0;z-index:2;flex-wrap:wrap}}
h1{{font-size:15px;margin:0;flex:0 0 auto}} .controls{{display:flex;gap:12px;align-items:center;flex:1;min-width:0;flex-wrap:wrap}} label{{color:var(--muted);display:flex;align-items:center;gap:6px;min-width:0}} select,input{{accent-color:var(--accent);min-width:0}}
button{{width:34px;height:30px;border:1px solid var(--line);background:#202428;color:var(--text);font-size:18px;cursor:pointer}} button:hover{{border-color:var(--accent)}}
main{{padding:14px;display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,290px);gap:14px}} .viewer{{width:100%;min-width:0;overflow:hidden;display:flex;flex-direction:column;align-items:center}} .stage{{position:relative;display:block;width:min(100%,calc((100vh - 125px) * 1.216));aspect-ratio:1.216;background:#050607;border:1px solid var(--line)}}
.stage img{{display:block;width:100%;height:100%;object-fit:contain;image-rendering:auto}} #overlay{{position:absolute;inset:0;clip-path:inset(0 50% 0 0)}}
.divider{{position:absolute;top:0;bottom:0;width:1px;background:#fff;left:50%;pointer-events:none}} .labels{{display:flex;justify-content:space-between;color:var(--muted);margin-top:6px;width:min(100%,calc((100vh - 125px) * 1.216));max-width:100%}} .labels span:last-child{{text-align:right}}
aside{{min-width:0;border-left:1px solid var(--line);padding-left:14px}} aside h2{{font-size:13px;margin:0 0 8px}} dl{{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto);gap:5px 10px;margin:0}} dt{{color:var(--muted)}} dd{{margin:0;text-align:right;overflow-wrap:anywhere}} .status{{color:var(--accent)}}
@media(max-width:760px){{header{{position:static;display:block;padding:12px 16px}} h1{{display:block;width:100%;margin-bottom:10px;white-space:normal}} .controls{{display:flex;width:100%;min-width:0;gap:8px 10px;overflow:hidden}} #prev{{order:1}} .controls label:has(#camera){{order:2;flex:1 1 200px}} #next{{order:3}} #cameraLabel{{order:4;flex:1 0 100%;text-align:center}} .controls label:has(#left){{order:5}} .controls label:has(#right){{order:6}} .controls label:has(#blend){{order:7}} .controls label:has(#left),.controls label:has(#right),.controls label:has(#blend){{flex:1 0 100%;width:100%;overflow:hidden}} select,#blend{{width:0;min-width:0;flex:1}} main{{grid-template-columns:minmax(0,1fr);padding:14px}} aside{{border-left:0;border-top:1px solid var(--line);padding:12px 0 0}}}}
</style></head><body><header><h1>Coefficient / extinction oracle</h1><div class=\"controls\">
<button id=\"prev\" title=\"Previous camera\">&#8592;</button><label>Camera <input id=\"camera\" type=\"range\" min=\"0\" max=\"20\" value=\"10\"></label><span id=\"cameraLabel\">10</span><button id=\"next\" title=\"Next camera\">&#8594;</button>
<label>Left <select id=\"left\"><option value=\"current\">Current learned</option><option value=\"ridgeRidge\">Exact Ridge, Ridge extinction</option><option value=\"ridgeTotal\">Exact Ridge, total extinction</option><option value=\"expanded\">Expanded shared transport</option><option value=\"target\">Complete target</option><option value=\"supportTarget\">Support target</option><option value=\"ridgeContribution\">Ridge contribution</option><option value=\"nonRidgeContribution\">Non-Ridge contribution</option><option value=\"residual\">Residual heatmap</option></select></label>
<label>Right <select id=\"right\"><option value=\"target\">Complete target</option><option value=\"expanded\">Expanded shared transport</option><option value=\"current\">Current learned</option><option value=\"supportTarget\">Support target</option></select></label>
<label>Blend <input id=\"blend\" type=\"range\" min=\"0\" max=\"100\" value=\"50\"></label></div></header>
<main><section class=\"viewer\"><div class=\"stage\"><img id=\"base\" alt=\"left comparison\"><img id=\"overlay\" alt=\"right comparison\"><div class=\"divider\"></div></div><div class=\"labels\"><span id=\"leftLabel\"></span><span id=\"rightLabel\"></span></div></section>
<aside><h2>Frozen evidence</h2><dl><dt>Status</dt><dd class=\"status\">checksum-bound</dd><dt>Fit camera</dt><dd>10 only</dd><dt>Held views</dt><dd>20</dd><dt>Transport</dt><dd>one shared T</dd><dt>Rows</dt><dd id=\"rows\"></dd><dt>Path scalar</dt><dd id=\"scale\"></dd><dt>Expanded MAE</dt><dd id=\"mae\"></dd><dt>Current MAE</dt><dd id=\"currentMae\"></dd><dt>Report</dt><dd><a href=\"{report_name}\" style=\"color:var(--accent)\">JSON</a></dd></dl></aside></main>
<script>const rows={data}; const labels={{current:'Current learned',ridgeRidge:'Exact Ridge / Ridge X',ridgeTotal:'Exact Ridge / total X',expanded:'Expanded shared transport',target:'Complete target',supportTarget:'Support-aligned target',ridgeContribution:'Ridge contribution',nonRidgeContribution:'Non-Ridge contribution',residual:'Residual'}};
const $=id=>document.getElementById(id); function render(){{const i=+$('camera').value,r=rows[i],l=$('left').value,q=$('right').value,b=+$('blend').value;$('cameraLabel').textContent=`${{i}} / ${{r.angle.toFixed(3)}} rad`;$('base').src=r.images[l];$('overlay').src=r.images[q];$('overlay').style.clipPath=`inset(0 ${{100-b}}% 0 0)`;document.querySelector('.divider').style.left=`${{b}}%`;$('leftLabel').textContent=labels[l];$('rightLabel').textContent=labels[q];$('rows').textContent=r.rows.toLocaleString();$('scale').textContent=r.pathScale.toFixed(6);$('mae').textContent=r.metrics.expanded.mae.toFixed(5);$('currentMae').textContent=r.metrics.current.mae.toFixed(5)}}
for(const id of ['camera','left','right','blend']) $(id).addEventListener('input',render);$('prev').onclick=()=>{{$('camera').value=Math.max(0,+$('camera').value-1);render()}};$('next').onclick=()=>{{$('camera').value=Math.min(20,+$('camera').value+1);render()}};render();</script></body></html>"""


def run_oracle(args: argparse.Namespace) -> dict[str, Any]:
    footprint_controls = resolve_footprint_controls(args)
    manifest_path = Path(args.manifest).resolve()
    capture_path = Path(args.capture_report).resolve()
    manifest = load_json(manifest_path, "training manifest")
    state, paths, descriptor_receipt = validate_manifest(manifest, manifest_path, args.state_step, not args.skip_hash_verification)
    state_step = int((state.get("replay") or {}).get("completedSteps"))
    if args.validate_only:
        return {
            "status": "validated", "stateId": state.get("id"), "stateStep": state_step,
            "rowCount": int((state.get("rows") or {}).get("count")), "descriptor": descriptor_receipt,
            "footprintMode": footprint_identity(args.footprint_mode), "footprintControls": footprint_controls,
        }
    required = {"features", "admission", "coefficients", "kernelDescriptors"}
    require(required.issubset(paths), f"rendering requires row artifacts: {sorted(required - set(paths))}")
    if args.footprint_mode in {"higher-order", "compound", "selective-split"}:
        require(args.path_scale is not None, f"{args.footprint_mode} mode requires explicit --path-scale from the frozen bilinear baseline")
    capture_report = load_json(capture_path, "capture report")
    cameras = validate_capture_report(capture_report, state_step)
    capture_config = capture_report.get("captureConfig") or {}
    descriptor_hashes = descriptor_receipt.get("sourceHashes") or {}
    require(
        descriptor_hashes.get("fluidSha256") == capture_config.get("expectedAnchorFluidSha256"),
        "coefficient descriptor fluid hash does not match the frozen orbit anchor",
    )
    require(
        descriptor_hashes.get("frontSha256") == capture_config.get("expectedAnchorFrontSha256"),
        "coefficient descriptor front hash does not match the frozen orbit anchor",
    )
    count = int(state["rows"]["count"])
    features = np.memmap(paths["features"], dtype="<f4", mode="r", shape=(count, 24))
    admission = np.memmap(paths["admission"], dtype="<f4", mode="r", shape=(count, 2))
    coefficients = np.memmap(paths["coefficients"], dtype="<f4", mode="r", shape=(count, 8))
    descriptors = np.memmap(paths["kernelDescriptors"], dtype="<f4", mode="r", shape=(count, 100))
    indices = np.memmap(paths["nativeCellIndices"], dtype="<u4", mode="r", shape=(count,))
    descriptor_indices = np.rint(descriptors[:, 3]).astype(np.uint32)
    require(np.array_equal(descriptor_indices, indices), "kernel descriptor rows are not caller-ordered against native indices")
    require(np.all(np.isfinite(coefficients)) and float(np.min(coefficients)) >= 0.0, "coefficients contain nonfinite or negative values")

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    calibration_camera = cameras[10]
    calibration_footprint_mode = "bilinear" if args.footprint_mode == "selective-split" else args.footprint_mode
    calibration_footprint_controls = (
        bilinear_footprint_controls() if args.footprint_mode == "selective-split" else footprint_controls
    )
    calibration_planes, calibration_raster = rasterize_coefficients(
        descriptors[:, 0:3], descriptors[:, 20:23], features, coefficients, calibration_camera,
        args.depth_bins, calibration_footprint_mode, calibration_footprint_controls,
    )
    target_capture = find_capture(capture_report, 10, "sharedTransmittanceContributionSum", 160)
    target = image_rgb(Path(target_capture["imagePath"]))
    if args.path_scale is None:
        calibration_identity = CALIBRATION_IDENTITY
        calibration_fit = fit_optical_path_scale(calibration_planes, target)
    else:
        require(math.isfinite(args.path_scale) and args.path_scale > 0.0, "--path-scale must be finite and positive")
        calibration_identity = FROZEN_CALIBRATION_IDENTITY
        calibration_fit = {
            "pathScale": float(args.path_scale),
            "trials": [],
            "calibrationBoundaryHit": False,
            "calibrationExpansionCount": 0,
            "calibrationExpansionDiagnostic": False,
            "bracketUpper": None,
        }
    calibration_trials = calibration_fit["trials"]
    path_scale = float(calibration_fit["pathScale"])

    split_mask: np.ndarray | None = None
    split_world_offsets: np.ndarray | None = None
    split_receipt: dict[str, Any] | None = None
    attribution_camera_set: set[int] = set()
    if args.footprint_mode == "selective-split":
        attribution_cameras = list(footprint_controls["splitAttributionCameras"])
        attribution_camera_set = set(attribution_cameras)
        score_sum = np.zeros(count, dtype=np.float64)
        camera_support = np.zeros(count, dtype=np.uint8)
        attribution_rows: list[dict[str, Any]] = []
        for camera_index in attribution_cameras:
            camera = cameras[camera_index]
            baseline_planes = calibration_planes if camera_index == 10 else rasterize_coefficients(
                descriptors[:, 0:3], descriptors[:, 20:23], features, coefficients, camera,
                args.depth_bins, "bilinear", bilinear_footprint_controls(),
            )[0]
            target_capture_for_importance = find_capture(
                capture_report, camera_index, "sharedTransmittanceContributionSum", 160,
            )
            camera_scores, camera_rows, camera_receipt = candidate_residual_importance(
                descriptors[:, 0:3], coefficients, camera, baseline_planes,
                image_rgb(Path(target_capture_for_importance["imagePath"])),
                path_scale, args.depth_bins,
            )
            score_sum += camera_scores
            camera_support += camera_rows.astype(np.uint8)
            attribution_rows.append(camera_receipt)
        mean_score = (score_sum / len(attribution_cameras)).astype(np.float32)
        requested_split_mask = (
            (mean_score >= float(footprint_controls["splitScoreThreshold"]))
            & (camera_support >= int(footprint_controls["splitMinCameraSupport"]))
        )
        split_mask, split_world_offsets, split_geometry_receipt = build_split_offsets(
            descriptors, requested_split_mask, float(footprint_controls["splitOffsetWorld"]),
        )
        require(np.any(split_mask), "selective-split attribution selected zero lawful candidates")
        importance_path = out_dir / "split-importance.f32"
        selected_index_path = out_dir / "split-native-cell-indices.u32"
        mean_score.astype("<f4", copy=False).tofile(importance_path)
        np.asarray(indices[split_mask], dtype="<u4").tofile(selected_index_path)
        require(importance_path.stat().st_size == count * 4, "split importance artifact is partial")
        require(selected_index_path.stat().st_size == int(np.count_nonzero(split_mask)) * 4, "split native-index artifact is partial")
        split_receipt = {
            "identity": "view-independent-multiview-residual-three-child-subcell-split-v0",
            "attributionCameras": attribution_cameras,
            "heldOutCameras": [index for index in range(21) if index not in attribution_camera_set],
            "scoreIdentity": "target-tail-plus-target-wisp-underfit-times-pre-bin-transmitted-optical-weight-v0",
            "scoreThreshold": float(footprint_controls["splitScoreThreshold"]),
            "minimumCameraSupport": int(footprint_controls["splitMinCameraSupport"]),
            "scoreQuantiles": {
                str(percentile): float(np.percentile(mean_score, percentile))
                for percentile in (50.0, 90.0, 95.0, 99.0, 99.9, 100.0)
            },
            "cameraAttribution": attribution_rows,
            **split_geometry_receipt,
            "importanceArtifact": {
                "path": str(importance_path), "dtype": "float32-le", "shape": [count],
                "bytes": importance_path.stat().st_size, "sha256": sha256_file(importance_path),
            },
            "selectedNativeCellArtifact": {
                "path": str(selected_index_path), "dtype": "uint32-le",
                "shape": [int(np.count_nonzero(split_mask))],
                "bytes": selected_index_path.stat().st_size,
                "sha256": sha256_file(selected_index_path),
            },
        }
        calibration_planes, calibration_raster = rasterize_coefficients(
            descriptors[:, 0:3], descriptors[:, 20:23], features, coefficients, calibration_camera,
            args.depth_bins, args.footprint_mode, footprint_controls, split_mask, split_world_offsets,
        )

    camera_rows = []
    metrics_rows = []
    for camera in cameras:
        index = int(camera["cameraIndex"])
        planes, raster_receipt = (calibration_planes, calibration_raster) if index == 10 else rasterize_coefficients(
            descriptors[:, 0:3], descriptors[:, 20:23], features, coefficients, camera,
            args.depth_bins, args.footprint_mode, footprint_controls, split_mask, split_world_offsets,
        )
        expanded_linear, ridge_linear, nonridge_linear, trans = compose_planes(planes, path_scale, "total")
        ridge_total_planes = planes.copy()
        ridge_total_planes[..., 4:7] = 0.0
        ridge_total_linear, _, _, _ = compose_planes(ridge_total_planes, path_scale, "total")
        ridge_ridge_linear, _, _, _ = compose_planes(ridge_total_planes, path_scale, "ridge")
        expanded = tone_map(expanded_linear)
        ridge_total = tone_map(ridge_total_linear)
        ridge_ridge = tone_map(ridge_ridge_linear)
        ridge_contribution = tone_map(ridge_linear)
        nonridge_contribution = tone_map(nonridge_linear)
        current_capture = find_capture(capture_report, index, "kernelMomentCovariance", 160)
        complete_capture = find_capture(capture_report, index, "sharedTransmittanceContributionSum", 160)
        support_capture = find_capture(capture_report, index, "stateDerivedSupport", 160)
        prefix = f"camera-{index:02d}"
        names = {
            "current": f"{prefix}-current-kernel-moment.png",
            "target": f"{prefix}-shared-transport-target.png",
            "supportTarget": f"{prefix}-structural-support-target.png",
            "ridgeRidge": f"{prefix}-exact-ridge-ridge-extinction.png",
            "ridgeTotal": f"{prefix}-exact-ridge-total-extinction.png",
            "expanded": f"{prefix}-expanded-shared-transport.png",
            "ridgeContribution": f"{prefix}-ridge-contribution.png",
            "nonRidgeContribution": f"{prefix}-nonridge-contribution.png",
            "residual": f"{prefix}-expanded-residual.png",
        }
        current = persist_capture_comparator(Path(current_capture["imagePath"]), out_dir / names["current"])
        complete = persist_capture_comparator(Path(complete_capture["imagePath"]), out_dir / names["target"])
        persist_capture_comparator(Path(support_capture["imagePath"]), out_dir / names["supportTarget"])
        write_png(out_dir / names["ridgeRidge"], ridge_ridge)
        write_png(out_dir / names["ridgeTotal"], ridge_total)
        write_png(out_dir / names["expanded"], expanded)
        write_png(out_dir / names["ridgeContribution"], ridge_contribution)
        write_png(out_dir / names["nonRidgeContribution"], nonridge_contribution)
        write_png(out_dir / names["residual"], residual_heatmap(expanded, complete))
        expanded_metrics = image_metrics(expanded, complete)
        current_metrics = image_metrics(current, complete)
        metric = {
            "cameraIndex": index, "cameraAngle": float(camera["cameraAngle"]),
            "split": (
                "attribution" if index in attribution_camera_set
                else ("calibration" if index == 10 else "heldOut")
            ), "expanded": expanded_metrics,
            "current": current_metrics, "ridgeRidge": image_metrics(ridge_ridge, complete),
            "ridgeTotal": image_metrics(ridge_total, complete), "raster": raster_receipt,
            "meanFinalTransmittance": float(np.mean(trans)),
        }
        metrics_rows.append(metric)
        camera_rows.append({
            "index": index, "angle": float(camera["cameraAngle"]), "rows": count,
            "pathScale": path_scale, "metrics": {"expanded": expanded_metrics, "current": current_metrics},
            "images": {
                **names,
            },
        })
    held = [row for row in metrics_rows if row["split"] == "heldOut"]
    report = {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "requested": {
            "manifest": str(manifest_path), "captureReport": str(capture_path), "stateStep": state_step,
            "sampleCap": None, "depthBins": args.depth_bins, "footprintMode": args.footprint_mode,
            "pathScale": args.path_scale,
            "footprintControls": {
                "skirtMix": args.skirt_mix,
                "skirtMinorScale": args.skirt_minor_scale,
                "skirtRidgeRejection": args.skirt_ridge_rejection,
            },
            "depositionControls": {
                "compoundHaloMass": args.compound_halo_mass,
                "splitAttributionCameras": args.split_attribution_cameras,
                "splitScoreThreshold": args.split_score_threshold,
                "splitMinCameraSupport": args.split_min_camera_support,
                "splitOffsetWorld": args.split_offset_world,
            },
        },
        "effective": {
            "stateId": state.get("id"), "stateStep": state_step, "rowCount": count,
            "candidateAdmissionAuthority": ADMISSION_AUTHORITY, "coefficientBoundary": COEFFICIENT_BOUNDARY,
            "sharedTransmittanceIdentity": SHARED_TRANSMITTANCE, "kernelGeometry": KERNEL_GEOMETRY,
            "orderApproximation": ORDER_APPROXIMATION, "sampleCap": None, "droppedRowCount": 0,
            "footprintMode": footprint_identity(args.footprint_mode), "pathScale": path_scale,
            "footprintControls": footprint_controls,
            "splitSelectionCap": None,
            "momentMatchReference": (
                "flow-tangent-five-by-three-ellipse-first-two-moments-v0"
                if args.footprint_mode in {"higher-order", "compound"} else None
            ),
            "independentlyRenderedToneMappedImageAdditivity": False,
        },
        "descriptorReceipt": descriptor_receipt,
        "frozenStateBinding": {
            "sameStateCaptureId": (capture_report.get("frozenState") or {}).get("sameStateCaptureId"),
            "controlsHash": (capture_report.get("frozenState") or {}).get("controlsHash"),
            "fluidSha256": descriptor_hashes.get("fluidSha256"),
            "frontSha256": descriptor_hashes.get("frontSha256"),
            "hashMatch": True,
        },
        "calibration": {
            "identity": calibration_identity, "cameraIndex": 10, "pathScale": path_scale,
            "objective": "native-rgb-mae-to-shared-transmittance-target-v0", "trials": calibration_trials,
            "calibrationBoundaryHit": calibration_fit["calibrationBoundaryHit"],
            "calibrationExpansionCount": calibration_fit["calibrationExpansionCount"],
            "calibrationExpansionDiagnostic": calibration_fit["calibrationExpansionDiagnostic"],
            "bracketUpper": calibration_fit["bracketUpper"],
        },
        "selectiveSplit": split_receipt,
        "metrics": {
            "cameras": metrics_rows,
            "heldOutMean": {
                "cameraCount": len(held),
                "expandedMae": float(np.mean([row["expanded"]["mae"] for row in held])),
                "expandedMaeStdDev": float(np.std([row["expanded"]["mae"] for row in held])),
                "targetTopTailLumaUnderfit": float(np.mean([row["expanded"]["targetTopTailLumaUnderfit"] for row in held])),
                "targetWispUnderfit": float(np.mean([row["expanded"]["targetWispUnderfit"] for row in held])),
                "structuredDotSpectralPower": float(np.mean([row["expanded"]["structuredDotSpectralPower"] for row in held])),
                "projectedFragmentsMean": float(np.mean([row["raster"]["projectedFragments"] for row in held])),
                "projectedFragmentsTotal": int(np.sum([row["raster"]["projectedFragments"] for row in held])),
                "currentMae": float(np.mean([row["current"]["mae"] for row in held])),
                "ridgeRidgeMae": float(np.mean([row["ridgeRidge"]["mae"] for row in held])),
                "ridgeTotalMae": float(np.mean([row["ridgeTotal"]["mae"] for row in held])),
            },
        },
        "artifacts": {"gallery": str(out_dir / "index.html"), "cameraCount": len(camera_rows)},
        "ceiling": {
            "truthful": True,
            "notExactFullCovariance": True,
            "notExactPerSplatOrder": True,
            "orderApproximation": ORDER_APPROXIMATION,
            "orientationApproximation": footprint_identity(args.footprint_mode),
            "interpretation": "coefficient/extinction transplant assay; not a shipping-renderer parity claim",
        },
    }
    (out_dir / "index.html").write_text(gallery_html(camera_rows, Path(args.report).name))
    return report


def self_test() -> None:
    planes = np.zeros((2, 1, 1, 8), dtype=np.float32)
    planes[0, 0, 0, 0] = 1.0
    planes[0, 0, 0, 3] = math.log(2.0)
    planes[0, 0, 0, 7] = math.log(2.0)
    planes[1, 0, 0, 4] = 1.0
    combined, ridge, nonridge, trans = compose_planes(planes, 1.0, "total")
    require(abs(float(ridge[0, 0, 0]) - 1.0) < 1e-6, "self-test Ridge contribution drifted")
    require(abs(float(nonridge[0, 0, 0]) - 0.25) < 1e-6, "self-test shared extinction drifted")
    require(abs(float(combined[0, 0, 0]) - 1.25) < 1e-6, "self-test shared sum drifted")
    require(abs(float(trans[0, 0]) - 0.25) < 1e-6, "self-test transmittance drifted")
    high_scale_planes = np.zeros((2, 4, 4, 8), dtype=np.float32)
    high_scale_planes[0, :, :, 0:3] = 0.05
    high_scale_target = tone_map(compose_planes(high_scale_planes, 8.0, "total")[0])
    high_scale_fit = fit_optical_path_scale(high_scale_planes, high_scale_target)
    require(high_scale_fit["pathScale"] > 2.7, "self-test calibration retained the old upper cap")
    require(high_scale_fit["calibrationBoundaryHit"] is False, "self-test calibration remained boundary-limited")
    samples = list(ellipse_pixel_samples(
        np.asarray([2.25], dtype=np.float32),
        np.asarray([3.5], dtype=np.float32),
        np.asarray([1.0], dtype=np.float32),
        np.asarray([0.0], dtype=np.float32),
        np.asarray([2.0], dtype=np.float32),
        np.asarray([1.0], dtype=np.float32),
    ))
    require(abs(sum(float(weight[0]) for _, _, weight in samples) - 1.0) < 1e-6, "ellipse quadrature does not conserve integrated energy")
    require(len(samples) == 60, "ellipse quadrature sample count drifted")
    pixel_x = np.asarray([2.25], dtype=np.float32)
    pixel_y = np.asarray([3.5], dtype=np.float32)
    tangent_x = np.asarray([1.0], dtype=np.float32)
    tangent_y = np.asarray([0.0], dtype=np.float32)
    major_px = np.asarray([2.0], dtype=np.float32)
    minor_px = np.asarray([1.0], dtype=np.float32)

    def aggregate(sample_rows: list[tuple[np.ndarray, np.ndarray, np.ndarray]]) -> dict[tuple[int, int], float]:
        totals: dict[tuple[int, int], float] = {}
        for sx, sy, weight in sample_rows:
            key = (int(sx[0]), int(sy[0]))
            totals[key] = totals.get(key, 0.0) + float(weight[0])
        return {key: value for key, value in totals.items() if abs(value) > 1e-9}

    bilinear = aggregate(list(tangent_pixel_samples(pixel_x, pixel_y, tangent_x, tangent_y, major_px)))
    zero_skirt = aggregate(list(core_skirt_pixel_samples(
        pixel_x, pixel_y, tangent_x, tangent_y, major_px, minor_px,
        np.asarray([0.0], dtype=np.float32),
    )))
    full_skirt = aggregate(list(core_skirt_pixel_samples(
        pixel_x, pixel_y, tangent_x, tangent_y, major_px, minor_px,
        np.asarray([1.0], dtype=np.float32),
    )))
    ellipse = aggregate(samples)
    require(bilinear.keys() == zero_skirt.keys(), "zero skirt does not preserve bilinear support")
    require(all(abs(bilinear[key] - zero_skirt[key]) < 1e-6 for key in bilinear), "zero skirt does not equal bilinear weights")
    require(full_skirt.keys() == ellipse.keys(), "full skirt does not preserve ellipse support")
    require(all(abs(full_skirt[key] - ellipse[key]) < 1e-6 for key in ellipse), "full skirt does not equal ellipse weights")
    feature_fixture = np.zeros((2, len(FEATURE_ORDER)), dtype=np.float32)
    feature_fixture[:, RIDGE_FEATURE_INDEX] = [0.0, 1.0]
    conditioned = conditioned_skirt_mix(feature_fixture, 0.8, 0.5)
    require(np.allclose(conditioned, [0.8, 0.4]), "Ridge conditioning drifted")
    for candidate_index in range(2):
        candidate_samples = list(core_skirt_pixel_samples(
            np.asarray([2.25], dtype=np.float32), np.asarray([3.5], dtype=np.float32),
            tangent_x, tangent_y, major_px, minor_px,
            np.asarray([conditioned[candidate_index]], dtype=np.float32),
        ))
        require(abs(sum(float(weight[0]) for _, _, weight in candidate_samples) - 1.0) < 1e-6, "conditioned skirt does not conserve candidate mass")
    print("core-skirt endpoint contracts passed")
    tangent_nodes, tangent_node_weights = gauss_hermite_axis(TANGENT_UNIT_VARIANCE)
    normal_nodes, normal_node_weights = gauss_hermite_axis(NORMAL_UNIT_VARIANCE)
    require(abs(float(np.sum(tangent_node_weights)) - 1.0) < 1e-12, "higher-order tangent weights do not conserve mass")
    require(abs(float(np.sum(normal_node_weights)) - 1.0) < 1e-12, "higher-order normal weights do not conserve mass")
    require(abs(float(np.sum(tangent_node_weights * tangent_nodes)) - 0.0) < 1e-12, "higher-order tangent mean drifted")
    require(abs(float(np.sum(normal_node_weights * normal_nodes)) - 0.0) < 1e-12, "higher-order normal mean drifted")
    require(abs(float(np.sum(tangent_node_weights * np.square(tangent_nodes))) - TANGENT_UNIT_VARIANCE) < 1e-12, "higher-order tangent covariance drifted")
    require(abs(float(np.sum(normal_node_weights * np.square(normal_nodes))) - NORMAL_UNIT_VARIANCE) < 1e-12, "higher-order normal covariance drifted")
    higher_order_samples = list(gauss_hermite_pixel_samples(
        pixel_x, pixel_y, tangent_x, tangent_y, major_px, minor_px,
    ))
    require(len(higher_order_samples) == GAUSS_HERMITE_ORDER ** 2 * 4, "higher-order quadrature sample count drifted")
    require(abs(sum(float(weight[0]) for _, _, weight in higher_order_samples) - 1.0) < 1e-6, "higher-order quadrature does not conserve integrated mass")
    print("higher-order covariance contracts passed")
    compound_samples = list(compound_pixel_samples(
        pixel_x, pixel_y, tangent_x, tangent_y, major_px, minor_px, 0.35,
    ))
    require(abs(sum(float(weight[0]) for _, _, weight in compound_samples) - 1.0) < 1e-6, "compound treatment does not conserve shared coefficient mass")
    require(len(compound_samples) == (5 + GAUSS_HERMITE_ORDER ** 2) * 4, "compound treatment sample count drifted")
    print("compound optical mass contracts passed")
    split_pixel_x = np.asarray([2.25, 5.25], dtype=np.float32)
    split_pixel_y = np.asarray([3.5, 6.5], dtype=np.float32)
    split_mask_fixture = np.asarray([True, False], dtype=np.bool_)
    split_samples = list(selective_split_pixel_samples(
        split_pixel_x, split_pixel_y,
        split_pixel_x - 0.75, split_pixel_y,
        split_pixel_x + 0.75, split_pixel_y,
        np.ones(2, dtype=np.float32), np.zeros(2, dtype=np.float32),
        np.full(2, 2.0, dtype=np.float32), split_mask_fixture,
    ))
    split_mass = np.zeros(2, dtype=np.float64)
    for _, _, weight in split_samples:
        split_mass += weight
    require(np.allclose(split_mass, [1.0, 1.0], atol=1e-6), "selective split does not conserve each candidate's coefficient mass")
    descriptor_fixture = np.zeros((2, 100), dtype=np.float32)
    descriptor_fixture[:, 18] = 1.0
    descriptor_fixture[:, 19] = 1.0
    descriptor_fixture[:, 20] = 1.0
    effective_mask, offsets_fixture, split_fixture_receipt = build_split_offsets(
        descriptor_fixture, split_mask_fixture, 0.025,
    )
    require(np.array_equal(effective_mask, split_mask_fixture), "selective split changed a valid requested candidate set")
    require(np.allclose(offsets_fixture[0], [0.0, 0.025, 0.0]), "selective split bitangent offset drifted")
    require(split_fixture_receipt["splitSelectionCap"] is None, "selective split installed a hidden candidate cap")
    print("selective split contracts passed")
    raster_positions = np.asarray([[0.0, 0.0, -0.2], [0.1, 0.1, -0.4]], dtype=np.float32)
    raster_tangents = np.asarray([[1.0, 0.0, 0.0], [1.0, 0.0, 0.0]], dtype=np.float32)
    raster_features = np.zeros((2, len(FEATURE_ORDER)), dtype=np.float32)
    raster_coefficients = np.asarray([
        [1.0, 0.8, 0.6, 0.4, 0.2, 0.15, 0.1, 0.05],
        [0.5, 0.4, 0.3, 0.2, 0.1, 0.075, 0.05, 0.025],
    ], dtype=np.float32)
    identity_matrix = np.eye(4, dtype=np.float64).reshape(-1, order="F").tolist()
    raster_camera = {
        "cameraIndex": 0,
        "width": 16,
        "height": 16,
        "cameraPose": {
            "matrixWorldInverse": identity_matrix,
            "projectionMatrix": identity_matrix,
        },
    }
    selective_controls = {
        **bilinear_footprint_controls(),
        "splitAttributionCameras": [0, 1],
        "splitScoreThreshold": 0.01,
        "splitMinCameraSupport": 2,
        "splitOffsetWorld": 0.025,
        "controlsExplicit": True,
    }
    raster_modes = (
        ("higher-order", {**bilinear_footprint_controls(), "skirtMix": None}),
        ("compound", {**bilinear_footprint_controls(), "skirtMix": None, "compoundHaloMass": 0.35, "controlsExplicit": True}),
        ("selective-split", selective_controls),
    )
    for raster_mode, raster_controls in raster_modes:
        raster_planes, raster_receipt = rasterize_coefficients(
            raster_positions, raster_tangents, raster_features, raster_coefficients,
            raster_camera, 4, raster_mode, raster_controls,
            np.asarray([True, False], dtype=np.bool_) if raster_mode == "selective-split" else None,
            np.asarray([[0.0, 0.025, 0.0], [0.0, 0.0, 0.0]], dtype=np.float32) if raster_mode == "selective-split" else None,
        )
        require(np.allclose(np.sum(raster_planes, axis=(0, 1, 2)), np.sum(raster_coefficients, axis=0), atol=2e-5), f"{raster_mode} raster changed integrated coefficient mass")
        require(raster_receipt["projectedFragments"] > 0, f"{raster_mode} raster did not report projected work")
    print("deposition raster smoke contracts passed")
    metric_target = np.zeros((10, 10, 3), dtype=np.uint8)
    metric_target[4:6, 4:6] = 255
    exact_metrics = image_metrics(metric_target, metric_target)
    missing_metrics = image_metrics(np.zeros_like(metric_target), metric_target)
    require(exact_metrics["targetTopTailLumaUnderfit"] == 0.0, "exact target has peak underfit")
    require(exact_metrics["targetHighGradientUnderfit"] == 0.0, "exact target has gradient underfit")
    require(exact_metrics["targetWispUnderfit"] == 0.0, "exact target has wisp underfit")
    require(exact_metrics["structuredDotSpectralPower"] == 0.0, "exact target has structured dot residual")
    require(missing_metrics["targetTopTailLumaUnderfit"] > 0.0, "missing peak was not diagnosed")
    require(missing_metrics["targetHighGradientUnderfit"] > 0.0, "missing target structure was not diagnosed")
    print("target-aligned metric contracts passed")
    print("coefficient render oracle self-test passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--capture-report")
    parser.add_argument("--out-dir")
    parser.add_argument("--report")
    parser.add_argument("--state-step", type=int, default=96)
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--footprint-mode", choices=sorted(FOOTPRINT_MODES), default="nearest")
    parser.add_argument("--path-scale", type=float)
    parser.add_argument("--skirt-mix", type=float)
    parser.add_argument("--skirt-minor-scale", type=float)
    parser.add_argument("--skirt-ridge-rejection", type=float)
    parser.add_argument("--compound-halo-mass", type=float)
    parser.add_argument("--split-attribution-cameras")
    parser.add_argument("--split-score-threshold", type=float)
    parser.add_argument("--split-min-camera-support", type=int)
    parser.add_argument("--split-offset-world", type=float)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--skip-hash-verification", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        return 0
    if not all([args.manifest, args.capture_report, args.out_dir, args.report]):
        raise ValueError("--manifest, --capture-report, --out-dir, and --report are required")
    report_path = Path(args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    requested = {
        "footprintMode": args.footprint_mode,
        "footprintControls": {
            "skirtMix": args.skirt_mix,
            "skirtMinorScale": args.skirt_minor_scale,
            "skirtRidgeRejection": args.skirt_ridge_rejection,
        },
        "depositionControls": {
            "compoundHaloMass": args.compound_halo_mass,
            "splitAttributionCameras": args.split_attribution_cameras,
            "splitScoreThreshold": args.split_score_threshold,
            "splitMinCameraSupport": args.split_min_camera_support,
            "splitOffsetWorld": args.split_offset_world,
        },
        "pathScale": args.path_scale,
        "stateStep": args.state_step,
        "depthBins": args.depth_bins,
    }
    phase = "footprint-control-validation"
    started = time.time()
    try:
        resolve_footprint_controls(args)
        phase = "manifest-validation"
        result = run_oracle(args)
        phase = "report-write"
        report = {"schema": REPORT_SCHEMA, "startedAtUnix": started, "finishedAtUnix": time.time(), **result}
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"status": report["status"], "report": str(report_path), "artifacts": report.get("artifacts")}, indent=2))
        return 0
    except Exception as exc:
        failure = {
            "schema": REPORT_SCHEMA, "status": "failed", "failurePhase": phase,
            "error": str(exc), "startedAtUnix": started, "finishedAtUnix": time.time(),
            "requested": requested, "traceback": traceback.format_exc(),
        }
        report_path.write_text(json.dumps(failure, indent=2) + "\n")
        print(f"coefficient render oracle failed during {phase}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
