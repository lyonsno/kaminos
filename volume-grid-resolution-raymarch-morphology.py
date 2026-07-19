#!/usr/bin/env python3
"""Separate cross-grid field lift from raymarch and sidecar grid coupling."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import numpy as np


SCHEMA = "kaminos.volume.grid-resolution-raymarch-morphology-discriminant.v0"
IDENTITY = "phase-aligned-deterministic-grid-morphology-discriminant-v0"
ROUTE = "native-3d-compute-fluid-raymarch-v0"
SAMPLING_IDENTITY = "normalized-nearest-cell-low-to-output-grid-v0"
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
SIDECAR_CHANNELS = ["support", "coverage", "ridge", "footprint"]
KEY_MORPHOLOGY_CHANNELS = [
    "heat", "flame", "visibleFireCarrier", "combustionFront",
    "interfaceShred", "fireLick", "frontTopology",
]
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
RENDER_CONTROL_KEYS = [
    "raySteps", "adaptiveRays", "occupancySkip", "majorantSkip",
    "majorantGrid", "majorantCadence", "majorantSmooth", "majorantGuard",
    "temporalAccum", "temporalJitter", "density", "absorption", "smoke",
    "fire", "radiance", "glow", "fireRenderMode", "shellInspectMode",
]
SUPPORT_QUERY_KEYS = {
    "thermal": "volume_reaction_boundary_support_thermal",
    "reaction": "volume_reaction_boundary_support_reaction",
    "front": "volume_reaction_boundary_support_front",
    "interface": "volume_reaction_boundary_support_interface",
    "boundaryFireRidgeGain": "volume_reaction_boundary_fire_ridge",
    "boundaryFireRidgeCut": "volume_reaction_boundary_fire_ridge_cut",
}


class DiscriminantFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True)
    parser.add_argument("--deterministic-manifest", required=True)
    parser.add_argument("--truth-render-manifest", required=True)
    parser.add_argument("--low-render-manifest", required=True)
    parser.add_argument("--deterministic-render-manifest", required=True)
    parser.add_argument("--renderer-source", required=True)
    parser.add_argument("--materializer-source", required=True)
    parser.add_argument("--out-dir", required=True)
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


def read_manifest(path: Path, phase: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except Exception as error:
        raise DiscriminantFailure(phase, f"cannot read manifest {path}: {error}") from error
    if value.get("status") != "captured" or value.get("failurePhase") is not None:
        raise DiscriminantFailure(phase, f"manifest is not a complete capture: {path}")
    return value


def resolve_artifact_path(raw: str, manifest_path: Path) -> Path:
    candidate = Path(raw)
    return candidate.resolve() if candidate.is_absolute() else (manifest_path.parent / candidate).resolve()


def verify_artifact(
    descriptor: dict[str, Any],
    manifest_path: Path,
    expected_shape: list[int],
    expected_channels: list[str],
    label: str,
) -> Path:
    path = resolve_artifact_path(str(descriptor.get("path") or ""), manifest_path)
    if not path.is_file():
        raise DiscriminantFailure("artifact-validation", f"missing {label}: {path}")
    if descriptor.get("shape") != expected_shape:
        raise DiscriminantFailure("artifact-validation", f"{label} shape mismatch", {
            "expectedShape": expected_shape, "actualShape": descriptor.get("shape"),
        })
    if descriptor.get("channelOrder") != expected_channels:
        raise DiscriminantFailure("artifact-validation", f"{label} channel order mismatch")
    expected_bytes = int(descriptor.get("byteLength") or -1)
    if path.stat().st_size != expected_bytes:
        raise DiscriminantFailure("artifact-validation", f"{label} byte length mismatch", {
            "expectedByteLength": expected_bytes, "actualByteLength": path.stat().st_size,
        })
    actual_sha = sha256_file(path)
    if actual_sha != descriptor.get("sha256"):
        raise DiscriminantFailure("artifact-validation", f"{label} SHA-256 mismatch", {
            "expectedSha256": descriptor.get("sha256"), "actualSha256": actual_sha,
        })
    return path


def smoothstep(edge0: float, edge1: float, values: np.ndarray) -> np.ndarray:
    width = max(edge1 - edge0, 1.0e-12)
    t = np.clip((values - np.float32(edge0)) / np.float32(width), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32, copy=False)


def query_number(query: dict[str, list[str]], key: str) -> float:
    try:
        values = query[key]
        value = float(values[0])
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise DiscriminantFailure("render-contract-validation", f"missing or invalid replay control {key}") from error
    if len(values) != 1 or not np.isfinite(value):
        raise DiscriminantFailure("render-contract-validation", f"ambiguous or non-finite replay control {key}")
    return value


def source_query(render: dict[str, Any]) -> dict[str, list[str]]:
    capture = render.get("sourceCapture") or {}
    raw = capture.get("effectiveReplayRoute")
    if not isinstance(raw, str) or not raw:
        raise DiscriminantFailure("render-contract-validation", "missing effective replay route receipt")
    return parse_qs(urlparse(str(raw)).query)


def support_controls(render: dict[str, Any]) -> dict[str, float]:
    query = source_query(render)
    return {name: query_number(query, key) for name, key in SUPPORT_QUERY_KEYS.items()}


def upload_identity(descriptor: dict[str, Any]) -> dict[str, Any]:
    return {
        "sha256": descriptor.get("sha256"),
        "byteLength": descriptor.get("byteLength"),
    }


def render_contract(
    render: dict[str, Any], label: str, expected_grid: int,
    expected_fluid: dict[str, Any], expected_front: dict[str, Any],
) -> dict[str, Any]:
    route = render.get("effectiveRoute")
    debug = render.get("lastDebugState") or {}
    controls = debug.get("controls") or {}
    imported = render.get("importedRender") or {}
    source = render.get("sourceCapture") or {}
    initial_import = render.get("initialFieldImport") or {}
    requested = initial_import.get("requested") or {}
    uploads = initial_import.get("uploads") or {}
    if route != ROUTE or render.get("routeIdentity") != ROUTE:
        raise DiscriminantFailure("render-contract-validation", f"{label} effective route drift", {
            "label": label, "routeIdentity": render.get("routeIdentity"), "effectiveRoute": route,
        })
    if imported.get("ok") is not True:
        raise DiscriminantFailure("render-contract-validation", f"{label} imported render is incomplete")
    if imported.get("raymarchApplied") is not True or imported.get("splatApplied") is not False:
        raise DiscriminantFailure("render-contract-validation", f"{label} is not raymarch-only")
    if imported.get("sameStateCaptureId") != "imported-receiver-render-step-0":
        raise DiscriminantFailure("render-contract-validation", f"{label} is not a held step-zero render")
    payload_sha = source.get("payloadSha256")
    actual_sha = source.get("actualPayloadSha256")
    if (
        source.get("hashMatches") is not True
        or not isinstance(payload_sha, str)
        or not isinstance(actual_sha, str)
        or not SHA256_PATTERN.fullmatch(payload_sha)
        or not SHA256_PATTERN.fullmatch(actual_sha)
        or payload_sha != actual_sha
    ):
        raise DiscriminantFailure("render-contract-validation", f"{label} source capture hash receipt is absent or mismatched")
    if int(requested.get("grid") or 0) != expected_grid:
        raise DiscriminantFailure("render-contract-validation", f"{label} requested import grid mismatch")
    backend = render.get("backend")
    if not isinstance(backend, str) or not backend:
        raise DiscriminantFailure("render-contract-validation", f"{label} missing effective backend receipt")
    missing_controls = [key for key in RENDER_CONTROL_KEYS if key not in controls or controls[key] is None]
    if missing_controls:
        raise DiscriminantFailure("render-contract-validation", f"{label} missing effective render controls", {
            "label": label, "missingControls": missing_controls,
        })
    expected_uploads = {
        "fluid": upload_identity(expected_fluid),
        "front": upload_identity(expected_front),
    }
    actual_uploads = {
        "fluid": upload_identity(uploads.get("fluid") or {}),
        "front": upload_identity(uploads.get("front") or {}),
    }
    if actual_uploads != expected_uploads:
        raise DiscriminantFailure("render-contract-validation", f"{label} imported field identity mismatch", {
            "label": label, "expectedUploads": expected_uploads, "actualUploads": actual_uploads,
        })
    sidecar = controls.get("boundarySidecarControls") or {}
    required_sidecar_keys = {"identity", "authority", "source", "view", "blur", "stepWidth", "ridgeGain"}
    if not required_sidecar_keys.issubset(sidecar) or any(sidecar[key] is None for key in required_sidecar_keys):
        raise DiscriminantFailure("render-contract-validation", f"{label} missing effective boundary sidecar controls")
    render_width = imported.get("renderWidth")
    render_height = imported.get("renderHeight")
    if not isinstance(render_width, int) or render_width <= 0 or not isinstance(render_height, int) or render_height <= 0:
        raise DiscriminantFailure("render-contract-validation", f"{label} missing valid render dimensions")
    return {
        "label": label,
        "grid": int(debug.get("simGrid") or requested.get("grid") or 0),
        "route": route,
        "backend": backend,
        "sourceCaptureSha256": payload_sha,
        "effectiveControls": {key: controls.get(key) for key in RENDER_CONTROL_KEYS},
        "boundarySidecar": sidecar,
        "supportControls": support_controls(render),
        "uploads": actual_uploads,
        "cameraSignature": imported.get("cameraSignature") or debug.get("cameraSignature"),
        "renderWidth": render_width,
        "renderHeight": render_height,
    }


def validate_render_parity(
    truth: dict[str, Any], low: dict[str, Any], deterministic: dict[str, Any],
    low_grid: int, high_grid: int, pair: dict[str, Any], receiver: dict[str, Any],
) -> dict[str, Any]:
    contracts = [
        render_contract(truth, "truthHigh", high_grid, pair["high"]["fluid"], pair["high"]["front"]),
        render_contract(low, "filteredLowNative", low_grid, pair["low"]["fluid"], pair["low"]["front"]),
        render_contract(deterministic, "deterministicLowToHigh", high_grid, receiver["fluid"], receiver["front"]),
    ]
    if [item["grid"] for item in contracts] != [high_grid, low_grid, high_grid]:
        raise DiscriminantFailure("render-contract-validation", "render role grid mismatch", {"roles": contracts})
    parity_keys = [
        "route", "backend", "sourceCaptureSha256", "effectiveControls",
        "boundarySidecar", "supportControls", "renderWidth", "renderHeight",
    ]
    mismatches = {
        key: [item[key] for item in contracts]
        for key in parity_keys
        if len({json.dumps(item[key], sort_keys=True) for item in contracts}) != 1
    }
    if mismatches:
        raise DiscriminantFailure("render-contract-validation", "render preset parity mismatch", {"mismatches": mismatches})
    cameras = [item["cameraSignature"] for item in contracts]
    if all(cameras) and len(set(cameras)) != 1:
        raise DiscriminantFailure("render-contract-validation", "effective camera signature mismatch", {"cameraSignatures": cameras})
    camera_evidence = {
        "status": "verified-equal" if all(cameras) else "missing-effective-receipt",
        "signatures": cameras,
        "sameCameraClaimAllowed": bool(all(cameras)),
        "note": None if all(cameras) else "The witness requested one camera but did not record an effective camera signature.",
    }
    complete_parity = bool(all(cameras))
    return {
        "effectiveRoute": ROUTE,
        "sourceCaptureSha256": contracts[0]["sourceCaptureSha256"],
        "backend": contracts[0]["backend"],
        "effectiveControls": {
            **contracts[0]["effectiveControls"],
            "boundarySidecar": contracts[0]["boundarySidecar"],
            "supportControls": contracts[0]["supportControls"],
            "renderWidth": contracts[0]["renderWidth"],
            "renderHeight": contracts[0]["renderHeight"],
        },
        "parityStatus": "verified-complete" if complete_parity else "partial-camera-unverified",
        "completeParity": complete_parity,
        "renderVisualComparisonAdmitted": complete_parity,
        "cameraEvidence": camera_evidence,
        "roles": contracts,
    }


def linear_coordinates(source_grid: int, target_grid: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    q = (np.arange(target_grid, dtype=np.float64) + 0.5) * source_grid / target_grid - 0.5
    q = np.clip(q, 0.0, source_grid - 1.001)
    i0 = np.floor(q).astype(np.int64)
    i1 = np.minimum(source_grid - 1, i0 + 1)
    f = (q - i0).astype(np.float32)
    return i0, i1, f


def trilinear_plane(source: np.ndarray, target_z: int, target_grid: int) -> np.ndarray:
    source_grid = source.shape[0]
    x0, x1, fx = linear_coordinates(source_grid, target_grid)
    y0, y1, fy = linear_coordinates(source_grid, target_grid)
    z0, z1, fz = linear_coordinates(source_grid, target_grid)
    c00 = source[z0[target_z]][np.ix_(y0, x0)] * (1.0 - fx)[None, :, None] + source[z0[target_z]][np.ix_(y0, x1)] * fx[None, :, None]
    c10 = source[z0[target_z]][np.ix_(y1, x0)] * (1.0 - fx)[None, :, None] + source[z0[target_z]][np.ix_(y1, x1)] * fx[None, :, None]
    c01 = source[z1[target_z]][np.ix_(y0, x0)] * (1.0 - fx)[None, :, None] + source[z1[target_z]][np.ix_(y0, x1)] * fx[None, :, None]
    c11 = source[z1[target_z]][np.ix_(y1, x0)] * (1.0 - fx)[None, :, None] + source[z1[target_z]][np.ix_(y1, x1)] * fx[None, :, None]
    y_a = c00 * (1.0 - fy)[:, None, None] + c10 * fy[:, None, None]
    y_b = c01 * (1.0 - fy)[:, None, None] + c11 * fy[:, None, None]
    return (y_a * (1.0 - fz[target_z]) + y_b * fz[target_z]).astype(np.float32, copy=False)


def nearest_plane(source: np.ndarray, target_z: int, target_grid: int) -> np.ndarray:
    source_grid = source.shape[0]
    indexes = np.minimum(source_grid - 1, np.floor(np.arange(target_grid) * source_grid / target_grid).astype(np.int64))
    source_z = indexes[target_z]
    return source[source_z][np.ix_(indexes, indexes)]


def error_record(sum_sq: float, sum_abs: float, count: int) -> dict[str, float | int]:
    return {
        "count": count,
        "rmse": float(np.sqrt(sum_sq / max(1, count))),
        "mae": float(sum_abs / max(1, count)),
    }


def derived_descriptor(path: Path, shape: list[int], channel_order: list[str]) -> dict[str, Any]:
    return {
        "path": str(path),
        "shape": shape,
        "channelOrder": channel_order,
        "dtype": "float32-le",
        "byteOrder": "little-endian",
        "elementCount": int(np.prod(shape, dtype=np.int64)),
        "byteLength": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def compare_fields(
    low_fluid: np.ndarray, low_front: np.ndarray,
    high_fluid: np.ndarray, high_front: np.ndarray,
    deterministic_fluid: np.ndarray, deterministic_front: np.ndarray,
    high_grid: int,
) -> tuple[dict[str, Any], bool]:
    channel_count = len(FLUID_CHANNELS)
    low_sq = np.zeros(channel_count + 1, dtype=np.float64)
    low_abs = np.zeros(channel_count + 1, dtype=np.float64)
    det_sq = np.zeros(channel_count + 1, dtype=np.float64)
    det_abs = np.zeros(channel_count + 1, dtype=np.float64)
    reconstruction_sq = np.zeros(channel_count + 1, dtype=np.float64)
    exact = True
    for z in range(high_grid):
        low_linear_fluid = trilinear_plane(low_fluid, z, high_grid)
        low_linear_front = trilinear_plane(low_front[..., None], z, high_grid)[..., 0]
        expected_fluid = nearest_plane(low_fluid, z, high_grid)
        expected_front = nearest_plane(low_front[..., None], z, high_grid)[..., 0]
        det_fluid_plane = np.asarray(deterministic_fluid[z])
        det_front_plane = np.asarray(deterministic_front[z])
        high_fluid_plane = np.asarray(high_fluid[z])
        high_front_plane = np.asarray(high_front[z])
        exact = exact and np.array_equal(det_fluid_plane, expected_fluid) and np.array_equal(det_front_plane, expected_front)
        low_delta = low_linear_fluid.astype(np.float64) - high_fluid_plane
        det_delta = det_fluid_plane.astype(np.float64) - high_fluid_plane
        reconstruction_delta = det_fluid_plane.astype(np.float64) - low_linear_fluid
        low_sq[:channel_count] += np.sum(low_delta * low_delta, axis=(0, 1))
        low_abs[:channel_count] += np.sum(np.abs(low_delta), axis=(0, 1))
        det_sq[:channel_count] += np.sum(det_delta * det_delta, axis=(0, 1))
        det_abs[:channel_count] += np.sum(np.abs(det_delta), axis=(0, 1))
        reconstruction_sq[:channel_count] += np.sum(reconstruction_delta * reconstruction_delta, axis=(0, 1))
        low_front_delta = low_linear_front.astype(np.float64) - high_front_plane
        det_front_delta = det_front_plane.astype(np.float64) - high_front_plane
        reconstruction_front_delta = det_front_plane.astype(np.float64) - low_linear_front
        low_sq[-1] += np.sum(low_front_delta * low_front_delta)
        low_abs[-1] += np.sum(np.abs(low_front_delta))
        det_sq[-1] += np.sum(det_front_delta * det_front_delta)
        det_abs[-1] += np.sum(np.abs(det_front_delta))
        reconstruction_sq[-1] += np.sum(reconstruction_front_delta * reconstruction_front_delta)
    count = high_grid ** 3
    names = [*FLUID_CHANNELS, "frontTopology"]
    metrics = {}
    for index, name in enumerate(names):
        low_record = error_record(low_sq[index], low_abs[index], count)
        det_record = error_record(det_sq[index], det_abs[index], count)
        metrics[name] = {
            "nativeLowLinearVsTruth": low_record,
            "deterministicVsTruth": det_record,
            "deterministicVsNativeLowLinear": {
                "count": count,
                "rmse": float(np.sqrt(reconstruction_sq[index] / count)),
            },
            "deterministicMovesTowardTruth": det_record["rmse"] < low_record["rmse"],
        }
    return metrics, exact


def boundary_support(fluid: np.ndarray, front: np.ndarray, controls: dict[str, float], output: Path) -> np.memmap:
    grid = fluid.shape[0]
    support = np.memmap(output, dtype="<f4", mode="w+", shape=(grid, grid, grid))
    weights = np.array([controls["thermal"], controls["reaction"], controls["front"], controls["interface"]], dtype=np.float32)
    weight_sum = max(0.001, float(np.sum(weights)))
    for z in range(grid):
        plane = np.asarray(fluid[z])
        velocity = np.linalg.norm(plane[..., :3], axis=-1)
        material = plane[..., 4:8]
        fire = plane[..., 8:12]
        micro = plane[..., 12:16]
        raw_temp = np.clip(
            fire[..., 0] * 1.22 + fire[..., 1] * 0.46 + fire[..., 2] * 0.40
            + micro[..., 2] * 1.18 + micro[..., 3] * 0.48 + material[..., 1] * 0.20
            + velocity * 0.30,
            0.0, 2.4,
        )
        thermal = smoothstep(0.018, 0.62, raw_temp + fire[..., 0] * 0.16 + material[..., 1] * 0.24 + fire[..., 1] * 0.12)
        reaction = smoothstep(0.004, 0.30, fire[..., 2] * 0.72 + micro[..., 2] * 0.44 + fire[..., 3] * 0.34 + material[..., 2] * material[..., 1] * 0.28)
        front_support = smoothstep(0.001, 0.088, np.asarray(front[z]) * 1.08 + fire[..., 3] * 0.54 + micro[..., 2] * 0.12)
        interface = smoothstep(0.004, 0.24, micro[..., 1] * 0.58 + micro[..., 0] * 0.18 + material[..., 0] * 0.08 + micro[..., 3] * 0.06)
        support[z] = np.clip((thermal * weights[0] + reaction * weights[1] + front_support * weights[2] + interface * weights[3]) / weight_sum, 0.0, 1.35)
    support.flush()
    return support


def boundary_sidecar(
    support: np.ndarray,
    blur: float,
    ridge_gain: float,
    ridge_cut: float,
    output: Path,
) -> np.memmap:
    grid = support.shape[0]
    sidecar = np.memmap(output, dtype="<f4", mode="w+", shape=(grid, grid, grid, 4))
    x = np.arange(grid)
    xp = np.minimum(grid - 1, x + 1)
    xn = np.maximum(0, x - 1)
    for z in range(grid):
        center = np.asarray(support[z])
        px = center[:, xp]
        nx = center[:, xn]
        py = center[xp, :]
        ny = center[xn, :]
        pz = np.asarray(support[min(grid - 1, z + 1)])
        nz = np.asarray(support[max(0, z - 1)])
        neighbor_mean = (center * 2.0 + px + nx + py + ny + pz + nz) * 0.125
        neighbor_max = np.maximum.reduce([px, nx, py, ny, pz, nz])
        effective_support = center * (1.0 - blur * 0.45) + neighbor_mean * (blur * 0.45)
        raw_gradient = np.sqrt((px - nx) ** 2 + (py - ny) ** 2 + (pz - nz) ** 2) * 0.5
        laplacian = np.abs(px + nx + py + ny + pz + nz - 6.0 * center)
        ridge = smoothstep(ridge_cut, ridge_cut + 0.14, laplacian * ridge_gain)
        coverage = np.clip(
            np.maximum(effective_support, neighbor_max * (0.34 + blur * 0.28))
            + smoothstep(0.014, 0.30, raw_gradient) * 0.28 + ridge * 0.18,
            0.0, 1.8,
        )
        footprint = np.clip(
            0.16 + blur * 0.34 + smoothstep(0.014, 0.34, raw_gradient) * 0.42
            + ridge * 0.26 + np.maximum(0.0, neighbor_max - center) * 0.22,
            0.06, 1.65,
        )
        sidecar[z, ..., 0] = effective_support
        sidecar[z, ..., 1] = coverage
        sidecar[z, ..., 2] = ridge
        sidecar[z, ..., 3] = footprint
    sidecar.flush()
    return sidecar


def compare_sidecars(low: np.ndarray, high: np.ndarray, deterministic: np.ndarray, high_grid: int) -> dict[str, Any]:
    low_sq = np.zeros(4, dtype=np.float64)
    low_abs = np.zeros(4, dtype=np.float64)
    det_sq = np.zeros(4, dtype=np.float64)
    det_abs = np.zeros(4, dtype=np.float64)
    cross_sq = np.zeros(4, dtype=np.float64)
    for z in range(high_grid):
        low_linear = trilinear_plane(low, z, high_grid)
        truth = np.asarray(high[z])
        det = np.asarray(deterministic[z])
        low_delta = low_linear.astype(np.float64) - truth
        det_delta = det.astype(np.float64) - truth
        cross_delta = det.astype(np.float64) - low_linear
        low_sq += np.sum(low_delta * low_delta, axis=(0, 1))
        low_abs += np.sum(np.abs(low_delta), axis=(0, 1))
        det_sq += np.sum(det_delta * det_delta, axis=(0, 1))
        det_abs += np.sum(np.abs(det_delta), axis=(0, 1))
        cross_sq += np.sum(cross_delta * cross_delta, axis=(0, 1))
    count = high_grid ** 3
    metrics = {}
    for index, name in enumerate(SIDECAR_CHANNELS):
        low_record = error_record(low_sq[index], low_abs[index], count)
        det_record = error_record(det_sq[index], det_abs[index], count)
        metrics[name] = {
            "nativeLowLinearVsTruth": low_record,
            "deterministicVsTruth": det_record,
            "deterministicVsNativeLowLinear": {"count": count, "rmse": float(np.sqrt(cross_sq[index] / count))},
            "deterministicMovesTowardTruth": det_record["rmse"] < low_record["rmse"],
        }
    return metrics


def source_receipts(renderer_path: Path, materializer_path: Path) -> dict[str, Any]:
    renderer = renderer_path.read_text()
    materializer = materializer_path.read_text()
    required_renderer = {
        "nearestWorldFieldSampling": r"sampleWorldMaterial[\s\S]+f32\(GRID\)[\s\S]+sampleFluidSlot",
        "sidecarRawGradient": r"boundarySidecarGradient\s*=.*px\s*-\s*nx.*\*\s*0\.5",
        "sidecarRawLaplacian": r"laplacian\s*=\s*abs\(px\s*\+\s*nx[\s\S]+6\.0\s*\*\s*center\)",
        "liveWorldGradient": r"boundaryGradient\s*=[\s\S]*?0\.5\s*/\s*boundaryCellStep",
        "worldRayStep": r"dtBase\s*=\s*\(endT\s*-\s*startT\)\s*/\s*steps",
        "opacityDistanceScaling": r"rayStepOpacity\s*=\s*localDt\s*\*\s*3\.65",
    }
    missing_renderer = [name for name, pattern in required_renderer.items() if not re.search(pattern, renderer)]
    if missing_renderer:
        raise DiscriminantFailure("source-contract-validation", "renderer scale contract changed", {"missing": missing_renderer})
    if not re.search(r"floor\(x\s*/\s*ratio\).*floor\(y\s*/\s*ratio\).*floor\(z\s*/\s*ratio\)", materializer, re.S):
        raise DiscriminantFailure("source-contract-validation", "materializer no longer proves normalized nearest-cell sampling")
    return {
        "renderer": {"path": str(renderer_path), "sha256": sha256_file(renderer_path), "matchedContracts": list(required_renderer)},
        "materializer": {"path": str(materializer_path), "sha256": sha256_file(materializer_path), "samplingIdentity": SAMPLING_IDENTITY},
    }


def classify(channel_metrics: dict[str, Any], sidecar_metrics: dict[str, Any]) -> dict[str, Any]:
    field_moves = sum(bool(channel_metrics[name]["deterministicMovesTowardTruth"]) for name in KEY_MORPHOLOGY_CHANNELS)
    sidecar_moves = sum(bool(sidecar_metrics[name]["deterministicMovesTowardTruth"]) for name in SIDECAR_CHANNELS)
    if field_moves >= 5 and sidecar_moves >= 3:
        classification = "target-directional-deterministic-lift"
    elif field_moves <= 3 and sidecar_moves <= 2:
        classification = "renderer-grid-coupling"
    else:
        classification = "partial-common-morphology"
    return {
        "classification": classification,
        "fieldChannelsMovingTowardTruth": field_moves,
        "fieldChannelCount": len(KEY_MORPHOLOGY_CHANNELS),
        "sidecarChannelsMovingTowardTruth": sidecar_moves,
        "sidecarChannelCount": len(SIDECAR_CHANNELS),
        "mechanisms": [
            {
                "id": "nearest-materialization-reconstruction-kernel",
                "finding": "The deterministic receiver stores nearest-cell replicated low values, then the renderer trilinearly samples that piecewise-constant high-grid field; this is not the native-low trilinear reconstruction.",
            },
            {
                "id": "cell-unit-boundary-sidecar-rebake",
                "finding": "The baked sidecar recomputes gradient and laplacian from one-cell differences without world-width normalization, so rebaking at 160 changes shell/ridge morphology even when source values are only replicated.",
            },
            {
                "id": "ray-distance-optical-integration",
                "finding": "Ray step length and opacity scale with world-space path length and the shared ray-step count, not simulation grid resolution; this term is not the primary 96/160 coupling in the held assay.",
            },
        ],
        "learnedModelJudgment": "Judge learned output against the deterministic receiver only until the deterministic grid coupling is normalized or explicitly accepted.",
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "manifest.json"
    phase = "manifest-validation"
    evidence: dict[str, Any] = {}
    try:
        paths = {
            "pair": Path(args.pair_manifest).resolve(),
            "deterministic": Path(args.deterministic_manifest).resolve(),
            "truthRender": Path(args.truth_render_manifest).resolve(),
            "lowRender": Path(args.low_render_manifest).resolve(),
            "deterministicRender": Path(args.deterministic_render_manifest).resolve(),
        }
        pair = read_manifest(paths["pair"], phase)
        deterministic_manifest = read_manifest(paths["deterministic"], phase)
        truth_render = read_manifest(paths["truthRender"], phase)
        low_render = read_manifest(paths["lowRender"], phase)
        deterministic_render = read_manifest(paths["deterministicRender"], phase)
        evidence = {f"{name}ManifestSha256": sha256_file(path) for name, path in paths.items()}
        if pair.get("schema") != "kaminos.volume.full-grid-field-pair.v0" or pair.get("authority") != "downsampled-same-high-history-input-to-exact-high-target":
            raise DiscriminantFailure(phase, "pair lacks phase-aligned same-high-history authority")
        low_grid = int(pair.get("lowGrid") or 0)
        high_grid = int(pair.get("highGrid") or 0)
        if low_grid < 2 or high_grid <= low_grid:
            raise DiscriminantFailure(phase, "invalid low/high grid relationship")
        replay = (pair.get("source") or {}).get("deterministicReplay") or {}
        if replay.get("authority") != "same-route-controls-fixed-step-replay":
            raise DiscriminantFailure(phase, "pair lacks deterministic replay authority")
        deterministic_source = deterministic_manifest.get("source") or {}
        deterministic_relationship = deterministic_manifest.get("relationship") or {}
        receiver = deterministic_manifest.get("receiver") or {}
        pair_source = pair.get("source") or {}
        declared_pair_path = resolve_artifact_path(str(deterministic_source.get("pairManifestPath") or ""), paths["deterministic"])
        if declared_pair_path != paths["pair"]:
            raise DiscriminantFailure(phase, "deterministic source pair path does not match the analyzed pair", {
                "declaredPairPath": str(declared_pair_path), "analyzedPairPath": str(paths["pair"]),
            })
        if deterministic_source.get("pairManifestSha256") != evidence["pairManifestSha256"]:
            raise DiscriminantFailure(phase, "deterministic source pair SHA-256 does not match the analyzed pair")
        if deterministic_source.get("exactBasinSourceCaptureSha256") != pair_source.get("exactBasinSourceCaptureSha256"):
            raise DiscriminantFailure(phase, "deterministic source capture does not match pair authority")
        if deterministic_source.get("effectiveRoute") != pair_source.get("effectiveRoute") or deterministic_source.get("effectiveRoute") != ROUTE:
            raise DiscriminantFailure(phase, "deterministic source route does not match pair authority")
        if (
            deterministic_relationship.get("authority") != pair.get("authority")
            or int(deterministic_relationship.get("lowGrid") or 0) != low_grid
            or int(deterministic_relationship.get("highGrid") or 0) != high_grid
            or int(receiver.get("grid") or 0) != high_grid
        ):
            raise DiscriminantFailure(phase, "deterministic relationship does not match the analyzed grid pair")
        if deterministic_manifest.get("residualBlend", {}).get("scale") != 0:
            raise DiscriminantFailure(phase, "deterministic role has nonzero learned residual scale")
        if deterministic_manifest.get("batching", {}).get("completeFieldCoverage") is not True:
            raise DiscriminantFailure(phase, "deterministic role is partial")

        phase = "render-contract-validation"
        route_parity = validate_render_parity(
            truth_render, low_render, deterministic_render, low_grid, high_grid, pair, receiver,
        )
        if route_parity["sourceCaptureSha256"] != (pair.get("source") or {}).get("exactBasinSourceCaptureSha256"):
            raise DiscriminantFailure(phase, "render source capture does not match pair authority")

        phase = "source-contract-validation"
        source = source_receipts(Path(args.renderer_source).resolve(), Path(args.materializer_source).resolve())

        phase = "artifact-validation"
        low_fluid_path = verify_artifact(pair["low"]["fluid"], paths["pair"], [low_grid, low_grid, low_grid, 16], FLUID_CHANNELS, "low fluid")
        low_front_path = verify_artifact(pair["low"]["front"], paths["pair"], [low_grid, low_grid, low_grid, 1], ["frontTopology"], "low front")
        high_fluid_path = verify_artifact(pair["high"]["fluid"], paths["pair"], [high_grid, high_grid, high_grid, 16], FLUID_CHANNELS, "high fluid")
        high_front_path = verify_artifact(pair["high"]["front"], paths["pair"], [high_grid, high_grid, high_grid, 1], ["frontTopology"], "high front")
        det_fluid_path = verify_artifact(receiver.get("fluid") or {}, paths["deterministic"], [high_grid, high_grid, high_grid, 16], FLUID_CHANNELS, "deterministic fluid")
        det_front_path = verify_artifact(receiver.get("front") or {}, paths["deterministic"], [high_grid, high_grid, high_grid, 1], ["frontTopology"], "deterministic front")

        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_grid, low_grid, low_grid, 16))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_grid, low_grid, low_grid))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_grid, high_grid, high_grid, 16))
        high_front = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_grid, high_grid, high_grid))
        det_fluid = np.memmap(det_fluid_path, dtype="<f4", mode="r", shape=(high_grid, high_grid, high_grid, 16))
        det_front = np.memmap(det_front_path, dtype="<f4", mode="r", shape=(high_grid, high_grid, high_grid))

        phase = "field-analysis"
        channel_metrics, deterministic_exact = compare_fields(
            low_fluid, low_front, high_fluid, high_front, det_fluid, det_front, high_grid,
        )
        if not deterministic_exact:
            raise DiscriminantFailure(phase, "deterministic residual-zero field is not the declared nearest-cell materialization")

        controls = route_parity["effectiveControls"]["supportControls"]
        boundary_controls = route_parity["effectiveControls"]["boundarySidecar"]
        blur = float(boundary_controls.get("blur") or 0)
        ridge_gain = controls["boundaryFireRidgeGain"] * float(boundary_controls.get("ridgeGain") or 1)
        ridge_cut = controls["boundaryFireRidgeCut"]
        low_support = boundary_support(low_fluid, low_front, controls, out_dir / "low-support.f32")
        high_support = boundary_support(high_fluid, high_front, controls, out_dir / "truth-support.f32")
        det_support = boundary_support(det_fluid, det_front, controls, out_dir / "deterministic-support.f32")
        low_sidecar = boundary_sidecar(low_support, blur, ridge_gain, ridge_cut, out_dir / "low-sidecar.f32")
        high_sidecar = boundary_sidecar(high_support, blur, ridge_gain, ridge_cut, out_dir / "truth-sidecar.f32")
        det_sidecar = boundary_sidecar(det_support, blur, ridge_gain, ridge_cut, out_dir / "deterministic-sidecar.f32")
        sidecar_metrics = compare_sidecars(low_sidecar, high_sidecar, det_sidecar, high_grid)
        verdict = classify(channel_metrics, sidecar_metrics)

        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "relationship": {
                "authority": pair.get("authority"),
                "lowGrid": low_grid,
                "highGrid": high_grid,
                "deterministicMaterialization": {
                    "samplingIdentity": SAMPLING_IDENTITY,
                    "verifiedExact": True,
                    "fluidSha256": receiver["fluid"]["sha256"],
                    "frontSha256": receiver["front"]["sha256"],
                },
            },
            "routeAndPresetParity": route_parity,
            "sourceReceipts": source,
            "scaleAccounting": {
                "gridResolutionRatio": high_grid / low_grid,
                "low": {"grid": low_grid, "voxelWorldWidth": 2.0 / low_grid},
                "high": {"grid": high_grid, "voxelWorldWidth": 2.0 / high_grid},
                "materialization": {
                    "storedKernel": "nearest-cell-replication",
                    "nativeRenderKernel": "trilinear-over-low-cell-centers",
                    "receiverRenderKernel": "trilinear-over-nearest-replicated-high-cells",
                    "sameContinuousField": False,
                },
                "boundarySidecar": {
                    "neighborOffsetCells": 1,
                    "gradientNormalization": "cell-difference-unnormalized",
                    "laplacianNormalization": "cell-difference-unnormalized",
                    "lowNeighborWorldWidth": 2.0 / low_grid,
                    "highNeighborWorldWidth": 2.0 / high_grid,
                    "neighborWorldWidthRatio": high_grid / low_grid,
                    "liveGradientNormalization": "central-difference-divided-by-world-cell-width",
                    "bakedVsLiveDerivativeUnitsMatch": False,
                    "stepFootprintWidthEnabled": float(boundary_controls.get("stepWidth") or 0) > 0,
                },
                "raymarch": {
                    "raySteps": route_parity["effectiveControls"]["raySteps"],
                    "baseStep": "(boxExit-boxEntry)/raySteps",
                    "opacityScale": "localWorldStep*3.65",
                    "baseOpacityDistanceScalingGridDependent": False,
                    "overallTraversalGridIndependent": False,
                    "gridDependentTraversalTerms": [
                        "field-sampling-cell-width",
                        "occupancy-grid",
                        "majorant-grid",
                        "cell-crossing-and-skip-logic",
                    ],
                },
            },
            "metrics": {"channels": channel_metrics, "boundarySidecar": sidecar_metrics},
            "derivedArtifacts": {
                "lowSupport": derived_descriptor(out_dir / "low-support.f32", [low_grid, low_grid, low_grid, 1], ["support"]),
                "truthSupport": derived_descriptor(out_dir / "truth-support.f32", [high_grid, high_grid, high_grid, 1], ["support"]),
                "deterministicSupport": derived_descriptor(out_dir / "deterministic-support.f32", [high_grid, high_grid, high_grid, 1], ["support"]),
                "lowSidecar": derived_descriptor(out_dir / "low-sidecar.f32", [low_grid, low_grid, low_grid, 4], SIDECAR_CHANNELS),
                "truthSidecar": derived_descriptor(out_dir / "truth-sidecar.f32", [high_grid, high_grid, high_grid, 4], SIDECAR_CHANNELS),
                "deterministicSidecar": derived_descriptor(out_dir / "deterministic-sidecar.f32", [high_grid, high_grid, high_grid, 4], SIDECAR_CHANNELS),
            },
            "verdict": verdict,
            "limitations": [
                "The source witness did not record an effective camera signature, so visual render parity is partial and no same-camera image comparison is admitted.",
                "This assay reproduces the baked sidecar numerics and field sampling relationship; it does not substitute a fresh normalized-sidecar visual render.",
            ],
            "sources": {name: {"path": str(path), "sha256": evidence[f"{name}ManifestSha256"]} for name, path in paths.items()},
        }
        write_json(report_path, report)
        print(json.dumps({"status": "captured", "manifest": str(report_path), "classification": verdict["classification"]}))
        return 0
    except Exception as error:
        if isinstance(error, DiscriminantFailure):
            phase = error.phase
            failure_evidence = error.evidence
        else:
            failure_evidence = {}
        write_json(report_path, {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "error": str(error),
            "lastTrustworthyEvidence": {**evidence, **failure_evidence},
        })
        print(json.dumps({"status": "failed", "manifest": str(report_path), "failurePhase": phase, "error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
