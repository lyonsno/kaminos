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
}
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
    tangent_offsets = (-1.0, -0.5, 0.0, 0.5, 1.0)
    tangent_weights = (0.075, 0.225, 0.4, 0.225, 0.075)
    for tangent_offset, tangent_weight in zip(tangent_offsets, tangent_weights):
        sample_x = pixel_x + tangent_x * major_px * tangent_offset
        sample_y = pixel_y + tangent_y * major_px * tangent_offset
        for x, y, pixel_weight in bilinear_pixel_samples(sample_x, sample_y):
            yield x, y, pixel_weight * tangent_weight


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
    tangent_offsets = (-1.0, -0.5, 0.0, 0.5, 1.0)
    tangent_weights = (0.075, 0.225, 0.4, 0.225, 0.075)
    normal_x = -tangent_y
    normal_y = tangent_x
    normal_samples = (
        (-1.0, skirt_mix * 0.125),
        (0.0, 1.0 - skirt_mix * 0.25),
        (1.0, skirt_mix * 0.125),
    )
    for tangent_offset, tangent_weight in zip(tangent_offsets, tangent_weights):
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
    if args.footprint_mode == "core-skirt":
        require(all(provided), "core-skirt mode requires explicit --skirt-mix, --skirt-minor-scale, and --skirt-ridge-rejection")
        require(math.isfinite(args.skirt_mix) and 0.0 <= args.skirt_mix <= 1.0, "--skirt-mix must be finite and in [0, 1]")
        require(math.isfinite(args.skirt_minor_scale) and args.skirt_minor_scale > 0.0, "--skirt-minor-scale must be finite and positive")
        require(math.isfinite(args.skirt_ridge_rejection) and 0.0 <= args.skirt_ridge_rejection <= 1.0, "--skirt-ridge-rejection must be finite and in [0, 1]")
        return {
            **requested,
            "conditioningFeature": FEATURE_ORDER[RIDGE_FEATURE_INDEX],
            "controlsExplicit": True,
        }
    require(not any(provided), "skirt controls are only lawful with --footprint-mode core-skirt")
    if args.footprint_mode == "ellipse":
        return {
            "skirtMix": 1.0, "skirtMinorScale": 1.0, "skirtRidgeRejection": 0.0,
            "conditioningFeature": None, "controlsExplicit": False,
        }
    if args.footprint_mode == "bilinear":
        return {
            "skirtMix": 0.0, "skirtMinorScale": 1.0, "skirtRidgeRejection": 0.0,
            "conditioningFeature": None, "controlsExplicit": False,
        }
    return {
        "skirtMix": None, "skirtMinorScale": None, "skirtRidgeRejection": None,
        "conditioningFeature": None, "controlsExplicit": False,
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
    else:
        require(footprint_mode == "core-skirt", f"unknown footprint mode {footprint_mode}")
        skirt_mix = conditioned_skirt_mix(
            features,
            float(footprint_controls["skirtMix"]),
            float(footprint_controls["skirtRidgeRejection"]),
        )
        pixel_samples = core_skirt_pixel_samples(pixel_x, pixel_y, tx, ty, major_px, minor_px, skirt_mix)
    for sx, sy, sample_weight in pixel_samples:
        selected = valid & tangent_valid & (sample_weight > 0.0) & (sx >= 0) & (sx < width) & (sy >= 0) & (sy < height)
        rows = np.flatnonzero(selected)
        flat = ((depth_index[rows] * height + sy[rows]) * width + sx[rows]).astype(np.int64)
        for channel in range(8):
            planes[..., channel] += scatter_channel(flat, coefficients[rows, channel] * sample_weight[rows], raster_size).reshape(depth_bins, height, width)
    return planes, {
        "admittedRows": int(positions.shape[0]),
        "projectedRows": int(valid_indices.size),
        "nearDepth": near,
        "farDepth": far,
        "depthBins": depth_bins,
        "orderApproximation": ORDER_APPROXIMATION,
        "kernelGeometry": KERNEL_GEOMETRY,
        "footprintMode": footprint_identity(footprint_mode),
        "orientation": footprint_identity(footprint_mode),
        "nominalQuadratureWeightSum": 1.0,
        "postProcessBlur": False,
        "footprintControls": footprint_controls,
        "effectiveSkirtMix": None if footprint_mode == "nearest" else {
            "minimum": float(np.min(skirt_mix)) if footprint_mode == "core-skirt" else float(footprint_controls["skirtMix"]),
            "mean": float(np.mean(skirt_mix)) if footprint_mode == "core-skirt" else float(footprint_controls["skirtMix"]),
            "maximum": float(np.max(skirt_mix)) if footprint_mode == "core-skirt" else float(footprint_controls["skirtMix"]),
        },
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


def image_metrics(candidate: np.ndarray, target: np.ndarray) -> dict[str, float]:
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

    top_tail_underfit = np.maximum(luma_b[top_tail_mask] - luma_a[top_tail_mask], 0.0)
    high_gradient_underfit = np.maximum(
        gradient_b[high_gradient_mask] - gradient_a[high_gradient_mask], 0.0,
    )
    return {
        "mae": float(np.mean(np.abs(delta))),
        "mse": float(np.mean(delta * delta)),
        "lumaMae": float(np.mean(np.abs(luma_a - luma_b))),
        "gradientMae": float(np.mean(np.abs(gradient_a - gradient_b))),
        "targetTopTailLumaUnderfit": float(np.mean(top_tail_underfit)),
        "targetTopTailLumaThreshold": top_tail_threshold,
        "targetHighGradientUnderfit": float(np.mean(high_gradient_underfit)) if high_gradient_underfit.size else 0.0,
        "targetHighGradientThreshold": high_gradient_threshold,
        "meanLuma": float(np.mean(luma_a)),
        "targetMeanLuma": float(np.mean(luma_b)),
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
    calibration_planes, calibration_raster = rasterize_coefficients(
        descriptors[:, 0:3], descriptors[:, 20:23], features, coefficients, calibration_camera,
        args.depth_bins, args.footprint_mode, footprint_controls,
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

    camera_rows = []
    metrics_rows = []
    for camera in cameras:
        index = int(camera["cameraIndex"])
        planes, raster_receipt = (calibration_planes, calibration_raster) if index == 10 else rasterize_coefficients(
            descriptors[:, 0:3], descriptors[:, 20:23], features, coefficients, camera,
            args.depth_bins, args.footprint_mode, footprint_controls,
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
            "split": "calibration" if index == 10 else "heldOut", "expanded": expanded_metrics,
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
        },
        "effective": {
            "stateId": state.get("id"), "stateStep": state_step, "rowCount": count,
            "candidateAdmissionAuthority": ADMISSION_AUTHORITY, "coefficientBoundary": COEFFICIENT_BOUNDARY,
            "sharedTransmittanceIdentity": SHARED_TRANSMITTANCE, "kernelGeometry": KERNEL_GEOMETRY,
            "orderApproximation": ORDER_APPROXIMATION, "sampleCap": None, "droppedRowCount": 0,
            "footprintMode": footprint_identity(args.footprint_mode), "pathScale": path_scale,
            "footprintControls": footprint_controls,
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
        "metrics": {
            "cameras": metrics_rows,
            "heldOutMean": {
                "expandedMae": float(np.mean([row["expanded"]["mae"] for row in held])),
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
    metric_target = np.zeros((10, 10, 3), dtype=np.uint8)
    metric_target[4:6, 4:6] = 255
    exact_metrics = image_metrics(metric_target, metric_target)
    missing_metrics = image_metrics(np.zeros_like(metric_target), metric_target)
    require(exact_metrics["targetTopTailLumaUnderfit"] == 0.0, "exact target has peak underfit")
    require(exact_metrics["targetHighGradientUnderfit"] == 0.0, "exact target has gradient underfit")
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
