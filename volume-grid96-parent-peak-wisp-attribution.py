#!/usr/bin/env python3
"""Emit exact-source, per-camera Grid96 parent peak/wisp relevance labels.

This is a projection-owned diagnostic socket. It binds the all-parent source
registry to the frozen 21-camera target orbit and measures where each existing
bilinear footprint overlaps positive peak-luminance and thin-wisp underfit.
It does not move parents, change coefficients, select features, or claim that
the relevance labels are leave-one-out causal effects.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np


ORACLE_PATH = Path(__file__).with_name("volume-layer-coefficient-render-oracle.py")
ORACLE: Any = None

REPORT_SCHEMA = "kaminos.volume.grid96-parent-peak-wisp-attribution-report.v0"
MANIFEST_SCHEMA = "kaminos.volume.grid96-parent-peak-wisp-attribution-socket.v0"
ATTRIBUTION_IDENTITY = (
    "target-positive-underfit-bilinear-footprint-overlap-times-"
    "pre-bin-transmitted-local-optical-weight-v0"
)
EXPECTED_REGISTRY_SCHEMA = "kaminos.volume.grid96-peak-wisp-source-registry.v0"
EXPECTED_REGISTRY_IDENTITY = "sha256:ce1d84b4bb03c2132a1f9e80406192f1f6f25cb1aec5b970befd7095c16b49f8"
EXPECTED_REGISTRY_SHA256 = "b47a29e72422c903e8c1647e60a31777c527bb9a10ed4cbc405a09ebe50f2481"
EXPECTED_CAPTURE_SHA256 = "ddb6af2ee0cabaca1a7fe6e08b6acf049d8e7ee67317cd02d36f1344acb2c709"
EXPECTED_MANIFEST_SHA256 = "b967c04a50b37d6c64dd1857ec521f61202708f6920c125503500f702ddea87f"
EXPECTED_ROW_COUNT = 370194
EXPECTED_GRID = 96
EXPECTED_STEP = 120
CALIBRATION_CAMERA_INDEX = 10
PER_CAMERA_ORDER = (
    "projected",
    "viewportKernelMass",
    "preBinTransmittanceMean",
    "localOpticalWeight",
    "peakResidualOverlap",
    "wispResidualOverlap",
    "peakImportance",
    "wispImportance",
)
REDUCED_ORDER = (
    "localOpticalWeight",
    "projectedCameraCount",
    "peakImportance.calibration",
    "peakImportance.heldMean",
    "peakImportance.heldMaximum",
    "peakImportance.heldSupportCount",
    "wispImportance.calibration",
    "wispImportance.heldMean",
    "wispImportance.heldMaximum",
    "wispImportance.heldSupportCount",
    "peakResidualOverlap.heldMean",
    "wispResidualOverlap.heldMean",
    "viewportKernelMass.heldMean",
    "preBinTransmittance.heldMean",
)
CLAIM_BOUNDARY = {
    "projectionRelevanceOnly": True,
    "leaveOneOutCausalityClaimed": False,
    "supportChanged": False,
    "coefficientsChanged": False,
    "opticalMassChanged": False,
    "parentsMoved": False,
    "cameraConditionedAttributesProduced": False,
    "featureSelectionPerformed": False,
    "learnerStarted": False,
    "placementChosen": False,
    "rendererClaimMade": False,
    "productClaimMade": False,
}


def load_oracle() -> Any:
    global ORACLE
    if ORACLE is not None:
        return ORACLE
    spec = importlib.util.spec_from_file_location("kaminos_layer_coefficient_oracle", ORACLE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load coefficient oracle dependency: {ORACLE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    ORACLE = module
    return ORACLE


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_receipt(path: Path, dtype: str, shape: list[int], role: str) -> dict[str, Any]:
    expected_bytes = int(np.prod(shape, dtype=np.int64)) * np.dtype(
        {"float32-le": "<f4", "uint32-le": "<u4"}[dtype]
    ).itemsize
    require(path.is_file(), f"artifact is missing: {path}")
    require(path.stat().st_size == expected_bytes, f"artifact byte length is partial: {path}")
    return {
        "path": str(path),
        "bytes": expected_bytes,
        "sha256": sha256_file(path),
        "dtype": dtype,
        "shape": shape,
        "semanticRole": role,
    }


def luma_and_gradient(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rgb = np.asarray(image, dtype=np.float32) / 255.0
    require(rgb.ndim == 3 and rgb.shape[2] == 3, "residual image must be RGB")
    luma = rgb @ np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float32)
    gradient = np.zeros_like(luma)
    gradient[:, :-1] += np.square(np.diff(luma, axis=1))
    gradient[:-1, :] += np.square(np.diff(luma, axis=0))
    np.sqrt(gradient, out=gradient)
    return luma, gradient


def positive_residual_fields(
    candidate: np.ndarray, target: np.ndarray
) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    """Return separate target-tail luma and target-wisp gradient underfit fields."""

    require(candidate.shape == target.shape, "candidate and target image shapes drifted")
    candidate_luma, candidate_gradient = luma_and_gradient(candidate)
    target_luma, target_gradient = luma_and_gradient(target)
    peak_threshold = float(np.percentile(target_luma, 99.0))
    wisp_threshold = float(np.percentile(target_gradient, 97.5))
    peak = (
        np.maximum(target_luma - candidate_luma, 0.0)
        * (target_luma >= peak_threshold)
    ).astype(np.float32)
    wisp = (
        np.maximum(target_gradient - candidate_gradient, 0.0)
        * ((target_gradient >= wisp_threshold) & (target_gradient > 0.0))
    ).astype(np.float32)
    return peak, wisp, {
        "peakLumaPercentile": 99.0,
        "peakLumaThreshold": peak_threshold,
        "wispGradientPercentile": 97.5,
        "wispGradientThreshold": wisp_threshold,
    }


def transmittance_before_bins(planes: np.ndarray, path_scale: float) -> np.ndarray:
    require(planes.ndim == 4 and planes.shape[-1] == 8, "planes must have shape [depth,height,width,8]")
    require(math.isfinite(path_scale) and path_scale > 0.0, "path scale must be finite and positive")
    result = np.empty(planes.shape[:3], dtype=np.float32)
    running = np.ones(planes.shape[1:3], dtype=np.float32)
    for depth_index in range(planes.shape[0]):
        result[depth_index] = running
        sigma = np.maximum(planes[depth_index, ..., 3] + planes[depth_index, ..., 7], 0.0)
        running *= np.exp(-sigma * path_scale)
    require(np.all(np.isfinite(result)), "pre-bin transmittance contains nonfinite values")
    return result


def integrate_footprint_fragments(
    *,
    row_count: int,
    row_index: np.ndarray,
    sample_x: np.ndarray,
    sample_y: np.ndarray,
    sample_depth: np.ndarray,
    sample_weight: np.ndarray,
    transmittance_before: np.ndarray,
    local_optical_weight: np.ndarray,
    peak_field: np.ndarray,
    wisp_field: np.ndarray,
) -> np.ndarray:
    """Reduce in-viewport deposited fragments into one label row per parent."""

    rows = np.asarray(row_index, dtype=np.int64)
    x = np.asarray(sample_x, dtype=np.int64)
    y = np.asarray(sample_y, dtype=np.int64)
    depth = np.asarray(sample_depth, dtype=np.int64)
    weight = np.asarray(sample_weight, dtype=np.float64)
    require(row_count > 0, "row count must be positive")
    require(rows.ndim == 1 and all(value.shape == rows.shape for value in (x, y, depth, weight)), "fragment vectors must align")
    require(local_optical_weight.shape == (row_count,), "local optical weights must contain every parent")
    require(peak_field.shape == wisp_field.shape == transmittance_before.shape[1:], "residual and transmittance image shapes drifted")
    require(np.all((rows >= 0) & (rows < row_count)), "fragment parent row is out of range")
    require(np.all((depth >= 0) & (depth < transmittance_before.shape[0])), "fragment depth is out of range")
    require(np.all((x >= 0) & (x < peak_field.shape[1]) & (y >= 0) & (y < peak_field.shape[0])), "fragment pixel is out of range")
    require(np.all(np.isfinite(weight)) and np.all(weight > 0.0), "fragment weights must be finite and positive")

    transmittance = transmittance_before[depth, y, x].astype(np.float64, copy=False)
    peak = peak_field[y, x].astype(np.float64, copy=False)
    wisp = wisp_field[y, x].astype(np.float64, copy=False)
    optical = np.asarray(local_optical_weight[rows], dtype=np.float64)
    labels = np.zeros((row_count, len(PER_CAMERA_ORDER)), dtype=np.float32)

    def reduce(values: np.ndarray) -> np.ndarray:
        return np.bincount(rows, weights=values, minlength=row_count).astype(np.float32)

    mass = reduce(weight)
    labels[:, 0] = mass > 0.0
    labels[:, 1] = mass
    transmitted_mass = reduce(weight * transmittance)
    np.divide(transmitted_mass, mass, out=labels[:, 2], where=mass > 0.0)
    labels[:, 3] = np.asarray(local_optical_weight, dtype=np.float32)
    labels[:, 4] = reduce(weight * peak)
    labels[:, 5] = reduce(weight * wisp)
    labels[:, 6] = reduce(weight * peak * transmittance * optical)
    labels[:, 7] = reduce(weight * wisp * transmittance * optical)
    require(np.all(np.isfinite(labels)) and float(np.min(labels)) >= 0.0, "attribution labels are invalid")
    return labels


def reduce_camera_attribution(per_camera: np.ndarray, calibration_camera_slot: int) -> np.ndarray:
    values = np.asarray(per_camera, dtype=np.float32)
    require(values.ndim == 3 and values.shape[2] == len(PER_CAMERA_ORDER), "per-camera attribution shape drifted")
    require(values.shape[0] >= 2, "attribution reduction requires calibration and held-out cameras")
    require(0 <= calibration_camera_slot < values.shape[0], "calibration camera slot is out of range")
    held_mask = np.ones(values.shape[0], dtype=bool)
    held_mask[calibration_camera_slot] = False
    column = {name: index for index, name in enumerate(PER_CAMERA_ORDER)}
    reduced = np.zeros((values.shape[1], len(REDUCED_ORDER)), dtype=np.float32)
    peak = values[:, :, column["peakImportance"]]
    wisp = values[:, :, column["wispImportance"]]
    reduced[:, 0] = values[calibration_camera_slot, :, column["localOpticalWeight"]]
    reduced[:, 1] = np.sum(values[:, :, column["projected"]] > 0.5, axis=0)
    reduced[:, 2] = peak[calibration_camera_slot]
    reduced[:, 3] = np.mean(peak[held_mask], axis=0)
    reduced[:, 4] = np.max(peak[held_mask], axis=0)
    reduced[:, 5] = np.count_nonzero(peak[held_mask] > 0.0, axis=0)
    reduced[:, 6] = wisp[calibration_camera_slot]
    reduced[:, 7] = np.mean(wisp[held_mask], axis=0)
    reduced[:, 8] = np.max(wisp[held_mask], axis=0)
    reduced[:, 9] = np.count_nonzero(wisp[held_mask] > 0.0, axis=0)
    reduced[:, 10] = np.mean(values[held_mask, :, column["peakResidualOverlap"]], axis=0)
    reduced[:, 11] = np.mean(values[held_mask, :, column["wispResidualOverlap"]], axis=0)
    reduced[:, 12] = np.mean(values[held_mask, :, column["viewportKernelMass"]], axis=0)
    reduced[:, 13] = np.mean(values[held_mask, :, column["preBinTransmittanceMean"]], axis=0)
    require(np.all(np.isfinite(reduced)), "reduced attribution contains nonfinite values")
    return reduced


def validate_registry(path: Path) -> tuple[dict[str, Any], dict[str, Path], np.ndarray]:
    require(path.is_file(), f"source registry is missing: {path}")
    require(sha256_file(path) == EXPECTED_REGISTRY_SHA256, "source registry sha256 drifted")
    try:
        registry = json.loads(path.read_text())
    except Exception as exc:
        raise ValueError(f"source registry JSON could not be read: {exc}") from exc
    require(isinstance(registry, dict), "source registry must be a JSON object")
    require(registry.get("schema") == EXPECTED_REGISTRY_SCHEMA, "source registry schema drifted")
    require(registry.get("identity") == EXPECTED_REGISTRY_IDENTITY, "source registry identity drifted")
    require(registry.get("status") == "complete", "source registry is not complete")
    require(registry.get("rowCount") == EXPECTED_ROW_COUNT, "source registry row count drifted")
    require(registry.get("grid") == EXPECTED_GRID, "source registry grid drifted")
    require(registry.get("simStepCount") == EXPECTED_STEP, "source registry step drifted")
    execution = registry.get("execution") or {}
    require(execution.get("rowCount") == EXPECTED_ROW_COUNT, "registry execution row count drifted")
    require(execution.get("sampleCap") is None, "source registry applied a hidden sample cap")
    require(execution.get("droppedRowCount") == 0, "source registry dropped rows")
    require(execution.get("fallbackRowCount") == 0, "source registry used fallback rows")
    route = registry.get("route") or {}
    require(route.get("effective") == "native-3d-compute-fluid-raymarch-v0", "source registry route drifted")
    require(route.get("backend") == "WebGPU:apple", "source registry backend drifted")
    require(route.get("fallbackReason") is None, "source registry route used fallback")

    families = registry.get("featureFamilies") or {}
    paths: dict[str, Path] = {}
    for key, width in (("descriptors", 100), ("coefficients", 8)):
        descriptor = (families.get(key) or {}).get("artifact") or {}
        require(descriptor.get("dtype") == "float32-le", f"registry {key} dtype drifted")
        require(descriptor.get("shape") == [EXPECTED_ROW_COUNT, width], f"registry {key} shape drifted")
        artifact_path = Path(descriptor.get("path", "")).resolve()
        require(artifact_path.is_file(), f"registry {key} artifact is missing")
        require(artifact_path.stat().st_size == descriptor.get("bytes"), f"registry {key} bytes drifted")
        require(sha256_file(artifact_path) == descriptor.get("sha256"), f"registry {key} sha256 drifted")
        paths[key] = artifact_path
    native = registry.get("nativeCellIndex") or {}
    native_path = Path(native.get("path", "")).resolve()
    require(native.get("dtype") == "uint32-le" and native.get("shape") == [EXPECTED_ROW_COUNT], "registry native-id contract drifted")
    require(native_path.is_file() and native_path.stat().st_size == native.get("bytes"), "registry native-id artifact is missing or partial")
    require(sha256_file(native_path) == native.get("sha256") == registry.get("nativeCellIndexSha256"), "registry native-id sha256 drifted")
    paths["nativeCellIndices"] = native_path
    native_ids = np.memmap(native_path, dtype="<u4", mode="r", shape=(EXPECTED_ROW_COUNT,))
    require(np.unique(native_ids).size == EXPECTED_ROW_COUNT, "registry native ids contain duplicates")
    return registry, paths, native_ids


def validate_frozen_sources(
    manifest_path: Path,
    capture_path: Path,
    registry: dict[str, Any],
    registry_paths: dict[str, Path],
    registry_ids: np.ndarray,
) -> tuple[dict[str, Any], dict[str, Path], dict[str, Any], list[dict[str, Any]]]:
    require(manifest_path.is_file() and sha256_file(manifest_path) == EXPECTED_MANIFEST_SHA256, "training manifest sha256 drifted")
    manifest = ORACLE.load_json(manifest_path, "training manifest")
    state, paths, descriptor_receipt = ORACLE.validate_manifest(manifest, manifest_path, EXPECTED_STEP, True)
    require(int(state["rows"]["count"]) == EXPECTED_ROW_COUNT, "training manifest row count drifted")
    require(int((state.get("replay") or {}).get("grid")) == EXPECTED_GRID, "training manifest grid drifted")
    require(sha256_file(paths["kernelDescriptors"]) == sha256_file(registry_paths["descriptors"]), "registry/training descriptor payload drifted")
    require(sha256_file(paths["coefficients"]) == sha256_file(registry_paths["coefficients"]), "registry/training coefficient payload drifted")
    manifest_ids = np.memmap(paths["nativeCellIndices"], dtype="<u4", mode="r", shape=(EXPECTED_ROW_COUNT,))
    require(np.array_equal(manifest_ids, registry_ids), "registry and training native-id rows are misaligned")

    require(capture_path.is_file() and sha256_file(capture_path) == EXPECTED_CAPTURE_SHA256, "capture report sha256 drifted")
    capture = ORACLE.load_json(capture_path, "capture report")
    cameras = ORACLE.validate_capture_report(capture, EXPECTED_STEP)
    source_hashes = registry.get("sourceHashes") or {}
    capture_config = capture.get("captureConfig") or {}
    require(source_hashes.get("fluidSha256") == capture_config.get("expectedAnchorFluidSha256"), "registry/capture fluid source drifted")
    require(source_hashes.get("frontSha256") == capture_config.get("expectedAnchorFrontSha256"), "registry/capture front source drifted")
    return state, paths, capture, cameras


def projected_bilinear_fragments(
    positions: np.ndarray,
    tangents: np.ndarray,
    features: np.ndarray,
    camera: dict[str, Any],
    source_grid: int,
    depth_bins: int,
):
    """Yield the exact in-viewport fragments used by the bilinear oracle path."""

    width, height = int(camera["width"]), int(camera["height"])
    pose = camera["cameraPose"]
    ndc, depth, valid = ORACLE.project(positions, pose["matrixWorldInverse"], pose["projectionMatrix"])
    pixel_x = (ndc[:, 0] * 0.5 + 0.5) * width
    pixel_y = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height
    center_x = pixel_x.astype(np.int32)
    center_y = pixel_y.astype(np.int32)
    valid &= (center_x >= 0) & (center_x < width) & (center_y >= 0) & (center_y < height) & np.isfinite(depth)
    valid_rows = np.flatnonzero(valid)
    require(valid_rows.size > 0, f"camera {camera['cameraIndex']} projected zero source parents")
    near = float(np.percentile(depth[valid_rows], 0.01))
    far = float(np.percentile(depth[valid_rows], 99.99))
    depth_index = np.clip(((depth - near) / max(far - near, 1e-6) * (depth_bins - 1)).astype(np.int32), 0, depth_bins - 1)
    tangent_points = positions + tangents * 0.03
    tangent_ndc, _, tangent_valid = ORACLE.project(tangent_points, pose["matrixWorldInverse"], pose["projectionMatrix"])
    tangent_x = (tangent_ndc[:, 0] - ndc[:, 0]) * 0.5 * width
    tangent_y = -(tangent_ndc[:, 1] - ndc[:, 1]) * 0.5 * height
    tangent_length = np.maximum(np.sqrt(tangent_x * tangent_x + tangent_y * tangent_y), 1e-5)
    tangent_x /= tangent_length
    tangent_y /= tangent_length
    base_radius = ORACLE.native_cell_width_world(source_grid) * (0.60 + features[:, 3] * 2.65 + features[:, 2] * 0.48)
    pixel_world_scale = np.maximum(tangent_length / 0.03, 1.0)
    major_px = np.clip(np.sqrt(base_radius * base_radius + 0.5 * 0.03 * 0.03) * pixel_world_scale, 0.75, 5.0)
    effective = valid & tangent_valid
    for sample_x, sample_y, sample_weight in ORACLE.tangent_pixel_samples(
        pixel_x, pixel_y, tangent_x, tangent_y, major_px
    ):
        selected = effective & (sample_weight > 0.0) & (sample_x >= 0) & (sample_x < width) & (sample_y >= 0) & (sample_y < height)
        rows = np.flatnonzero(selected)
        if rows.size:
            yield rows, sample_x[rows], sample_y[rows], depth_index[rows], sample_weight[rows]


def local_optical_weights(coefficients: np.ndarray, path_scale: float) -> np.ndarray:
    luma = np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float32)
    emission_luma = (coefficients[:, 0:3] + coefficients[:, 4:7]) @ luma
    sigma = coefficients[:, 3] + coefficients[:, 7]
    return (1.0 - np.exp(-np.maximum(emission_luma + sigma, 0.0) * path_scale)).astype(np.float32)


def heatmap(values: np.ndarray) -> np.ndarray:
    field = np.asarray(values, dtype=np.float32)
    positive = field[field > 0.0]
    scale = float(np.percentile(positive, 99.0)) if positive.size else 1.0
    normalized = np.clip(field / max(scale, 1e-12), 0.0, 1.0)
    red = np.clip(normalized * 2.5, 0.0, 1.0)
    green = np.clip(1.5 - np.abs(normalized * 3.0 - 1.5), 0.0, 1.0)
    blue = np.clip(1.0 - normalized * 2.0, 0.0, 1.0) * 0.35
    return np.rint(np.stack((red, green, blue), axis=2) * 255.0).astype(np.uint8)


def gallery_html(camera_rows: list[dict[str, Any]]) -> str:
    rows = json.dumps(camera_rows, separators=(",", ":"))
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>Grid96 Parent Peak/Wisp Attribution</title><style>
:root{{--bg:#101214;--panel:#181b1e;--line:#353b40;--text:#f3f4f5;--muted:#aeb4b9;--peak:#ffb020;--wisp:#58c7ff}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0}}header{{position:sticky;top:0;z-index:2;display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#15181a;border-bottom:1px solid var(--line)}}h1{{font-size:15px;margin:0}}label{{display:flex;gap:6px;align-items:center;color:var(--muted)}}select,input{{min-width:0}}button{{width:32px;height:30px;border:1px solid var(--line);background:#22272b;color:var(--text);font-size:18px;cursor:pointer}}main{{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:14px;padding:14px}}.stage{{position:relative;width:min(100%,calc((100vh - 110px)*1.298));aspect-ratio:314/242;margin:auto;background:#050607;border:1px solid var(--line)}}.stage img{{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}}#rightImage{{clip-path:inset(0 0 0 50%)}}#divider{{position:absolute;top:0;bottom:0;left:50%;width:1px;background:white}}.labels{{display:flex;justify-content:space-between;width:min(100%,calc((100vh - 110px)*1.298));margin:6px auto;color:var(--muted)}}aside{{border-left:1px solid var(--line);padding-left:14px}}h2{{font-size:13px;margin:0 0 10px}}dl{{display:grid;grid-template-columns:1fr auto;gap:6px 10px;margin:0}}dt{{color:var(--muted)}}dd{{margin:0;text-align:right}}a{{color:var(--peak)}}@media(max-width:760px){{header{{position:static}}h1{{width:100%}}main{{grid-template-columns:1fr}}.stage{{width:100%;aspect-ratio:314/242}}.labels{{width:100%}}aside{{border-left:0;border-top:1px solid var(--line);padding:12px 0 0}}}}
</style></head><body><header><h1>Grid96 parent peak / wisp attribution</h1><button id="prev" title="Previous camera">&#8592;</button><label>Camera <input id="camera" type="range" min="0" max="20" value="10"></label><span id="cameraLabel"></span><button id="next" title="Next camera">&#8594;</button><label>Left <select id="left"><option value="candidate">Bilinear splats</option><option value="target">Exact target</option><option value="peak">Peak relevance</option><option value="wisp">Wisp relevance</option></select></label><label>Right <select id="right"><option value="target">Exact target</option><option value="candidate">Bilinear splats</option><option value="peak">Peak relevance</option><option value="wisp">Wisp relevance</option></select></label><label>Blend <input id="blend" type="range" min="0" max="100" value="50"></label></header><main><section><div class="stage"><img id="leftImage" alt="left evidence"><img id="rightImage" alt="right evidence"><div id="divider"></div></div><div class="labels"><span id="leftLabel"></span><span id="rightLabel"></span></div></section><aside><h2>Exact-source receipt</h2><dl><dt>Status</dt><dd>complete</dd><dt>Parents</dt><dd>370,194</dd><dt>Cameras</dt><dd>1 fit + 20 held</dd><dt>Footprint</dt><dd>bilinear</dd><dt>Peak parents</dt><dd id="peakCount"></dd><dt>Wisp parents</dt><dd id="wispCount"></dd><dt>Report</dt><dd><a href="report.json">JSON</a></dd><dt>Socket</dt><dd><a href="grid96-parent-peak-wisp-attribution-manifest.json">JSON</a></dd></dl></aside></main><script>
const rows={rows},labels={{candidate:'Bilinear splats',target:'Exact target',peak:'Peak relevance',wisp:'Wisp relevance'}},$=id=>document.getElementById(id);function render(){{const r=rows[+$('camera').value],l=$('left').value,q=$('right').value,b=+$('blend').value;$('cameraLabel').textContent=`${{r.cameraIndex}} / ${{r.role}}`;$('leftImage').src=r.images[l];$('rightImage').src=r.images[q];$('rightImage').style.clipPath=`inset(0 0 0 ${{b}}%)`;$('divider').style.left=`${{b}}%`;$('leftLabel').textContent=labels[l];$('rightLabel').textContent=labels[q];$('peakCount').textContent=r.peakParentCount.toLocaleString();$('wispCount').textContent=r.wispParentCount.toLocaleString()}}for(const id of ['camera','left','right','blend'])$(id).addEventListener('input',render);$('prev').onclick=()=>{{$('camera').value=Math.max(0,+$('camera').value-1);render()}};$('next').onclick=()=>{{$('camera').value=Math.min(20,+$('camera').value+1);render()}};render();</script></body></html>"""


def run(args: argparse.Namespace, output_dir: Path) -> dict[str, Any]:
    registry_path = args.source_registry.resolve()
    registry, registry_paths, registry_ids = validate_registry(registry_path)
    load_oracle()
    args._phase["value"] = "frozen-source-validation"
    state, paths, capture, cameras = validate_frozen_sources(
        args.manifest.resolve(), args.capture_report.resolve(), registry, registry_paths, registry_ids
    )
    if args.validate_only:
        return {
            "schema": REPORT_SCHEMA,
            "status": "validated",
            "failurePhase": None,
            "source": {"registry": str(registry_path), "identity": registry["identity"]},
            "execution": {"rowCount": EXPECTED_ROW_COUNT, "cameraCount": 21, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0},
            "claimBoundary": CLAIM_BOUNDARY,
        }

    args._phase["value"] = "row-artifact-load"
    count = EXPECTED_ROW_COUNT
    features = np.memmap(paths["features"], dtype="<f4", mode="r", shape=(count, 24))
    coefficients = np.memmap(paths["coefficients"], dtype="<f4", mode="r", shape=(count, 8))
    descriptors = np.memmap(paths["kernelDescriptors"], dtype="<f4", mode="r", shape=(count, 100))
    positions = np.asarray(descriptors[:, 0:3])
    tangents = np.asarray(descriptors[:, 20:23])
    optical = local_optical_weights(coefficients, args.path_scale)
    require(np.all(np.isfinite(optical)) and np.any(optical > 0.0), "local optical weights are blank")

    per_camera_path = output_dir / "grid96-parent-peak-wisp-per-camera.f32"
    reduced_path = output_dir / "grid96-parent-peak-wisp-reduced.f32"
    native_path = output_dir / "grid96-parent-peak-wisp-native-cell-index.u32"
    per_camera = np.memmap(per_camera_path, dtype="<f4", mode="w+", shape=(21, count, len(PER_CAMERA_ORDER)))
    camera_rows: list[dict[str, Any]] = []
    controls = ORACLE.bilinear_footprint_controls()

    for camera_slot, camera in enumerate(cameras):
        camera_index = int(camera["cameraIndex"])
        args._phase["value"] = f"camera-{camera_index:02d}-raster"
        planes, raster_receipt = ORACLE.rasterize_coefficients(
            positions, tangents, features, coefficients, camera, args.depth_bins,
            "bilinear", controls, EXPECTED_GRID,
        )
        candidate = ORACLE.tone_map(ORACLE.compose_planes(planes, args.path_scale, "total")[0])
        target_capture = ORACLE.find_capture(capture, camera_index, "sharedTransmittanceContributionSum", 160)
        target = ORACLE.image_rgb(Path(target_capture["imagePath"]))
        peak_field, wisp_field, thresholds = positive_residual_fields(candidate, target)
        transmittance = transmittance_before_bins(planes, args.path_scale)

        fragment_rows: list[np.ndarray] = []
        fragment_x: list[np.ndarray] = []
        fragment_y: list[np.ndarray] = []
        fragment_depth: list[np.ndarray] = []
        fragment_weight: list[np.ndarray] = []
        for rows, x, y, depth, weight in projected_bilinear_fragments(
            positions, tangents, features, camera, EXPECTED_GRID, args.depth_bins
        ):
            fragment_rows.append(rows)
            fragment_x.append(x)
            fragment_y.append(y)
            fragment_depth.append(depth)
            fragment_weight.append(weight)
        rows = np.concatenate(fragment_rows)
        x = np.concatenate(fragment_x)
        y = np.concatenate(fragment_y)
        depth = np.concatenate(fragment_depth)
        weight = np.concatenate(fragment_weight)
        labels = integrate_footprint_fragments(
            row_count=count, row_index=rows, sample_x=x, sample_y=y, sample_depth=depth,
            sample_weight=weight, transmittance_before=transmittance,
            local_optical_weight=optical, peak_field=peak_field, wisp_field=wisp_field,
        )
        per_camera[camera_slot] = labels
        require(int(np.count_nonzero(labels[:, 0])) == raster_receipt["projectedRows"], f"camera {camera_index} attribution/raster projected-row count drifted")

        peak_name = f"camera-{camera_index:02d}-peak-relevance.png"
        wisp_name = f"camera-{camera_index:02d}-wisp-relevance.png"
        candidate_name = f"camera-{camera_index:02d}-bilinear.png"
        target_name = f"camera-{camera_index:02d}-target.png"
        ORACLE.write_png(output_dir / peak_name, heatmap(peak_field))
        ORACLE.write_png(output_dir / wisp_name, heatmap(wisp_field))
        ORACLE.write_png(output_dir / candidate_name, candidate)
        ORACLE.write_png(output_dir / target_name, target)
        camera_rows.append({
            "cameraIndex": camera_index,
            "role": "calibration" if camera_index == CALIBRATION_CAMERA_INDEX else "held-out",
            "cameraPoseHash": ORACLE.effective_camera_pose_hash(camera["cameraPose"]),
            "targetPixelHash": target_capture.get("pixelHash"),
            "thresholds": thresholds,
            "projectedParentCount": int(np.count_nonzero(labels[:, 0])),
            "peakParentCount": int(np.count_nonzero(labels[:, 6] > 0.0)),
            "wispParentCount": int(np.count_nonzero(labels[:, 7] > 0.0)),
            "peakImportanceSum": float(np.sum(labels[:, 6], dtype=np.float64)),
            "wispImportanceSum": float(np.sum(labels[:, 7], dtype=np.float64)),
            "raster": raster_receipt,
            "images": {"candidate": candidate_name, "target": target_name, "peak": peak_name, "wisp": wisp_name},
        })
        del planes, transmittance, labels, rows, x, y, depth, weight

    args._phase["value"] = "reduction"
    per_camera.flush()
    calibration_slots = [index for index, row in enumerate(camera_rows) if row["cameraIndex"] == CALIBRATION_CAMERA_INDEX]
    require(calibration_slots == [CALIBRATION_CAMERA_INDEX], "calibration camera role drifted")
    reduced = reduce_camera_attribution(per_camera, calibration_slots[0])
    np.asarray(reduced, dtype="<f4").tofile(reduced_path)
    np.asarray(registry_ids, dtype="<u4").tofile(native_path)
    del per_camera

    args._phase["value"] = "artifact-validation"
    artifacts = {
        "perCamera": artifact_receipt(per_camera_path, "float32-le", [21, count, len(PER_CAMERA_ORDER)], "all-camera-all-parent-separate-peak-wisp-relevance"),
        "reduced": artifact_receipt(reduced_path, "float32-le", [count, len(REDUCED_ORDER)], "calibration-plus-held-out-parent-relevance-reduction"),
        "nativeCellIndex": artifact_receipt(native_path, "uint32-le", [count], "caller-ordered-native-cell-index"),
    }
    require(artifacts["nativeCellIndex"]["sha256"] == registry["nativeCellIndexSha256"], "output native-id hash drifted from registry")
    require(any(row["peakParentCount"] > 0 for row in camera_rows), "all-camera peak attribution is blank")
    require(any(row["wispParentCount"] > 0 for row in camera_rows), "all-camera wisp attribution is blank")

    args._phase["value"] = "manifest-write"
    manifest_payload = {
        "schema": MANIFEST_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "source": {
            "registry": {"path": str(registry_path), "sha256": EXPECTED_REGISTRY_SHA256, "identity": EXPECTED_REGISTRY_IDENTITY},
            "trainingManifest": {"path": str(args.manifest.resolve()), "sha256": EXPECTED_MANIFEST_SHA256},
            "captureReport": {"path": str(args.capture_report.resolve()), "sha256": EXPECTED_CAPTURE_SHA256},
            "sameStateCaptureId": registry["sameStateCaptureId"],
            "sourceHashes": registry["sourceHashes"],
        },
        "attribution": {
            "identity": ATTRIBUTION_IDENTITY,
            "footprint": ORACLE.FOOTPRINT_MODES["bilinear"],
            "pathScale": args.path_scale,
            "depthBins": args.depth_bins,
            "perCameraOrder": list(PER_CAMERA_ORDER),
            "reducedOrder": list(REDUCED_ORDER),
            "cameraRoles": [{"cameraIndex": row["cameraIndex"], "role": row["role"]} for row in camera_rows],
            "peakDefinition": "positive-target-minus-candidate-luma-on-target-99th-percentile-mask-v0",
            "wispDefinition": "positive-target-minus-candidate-gradient-on-target-97.5th-percentile-mask-v0",
            "opticalWeight": "one-minus-exp-negative-total-emission-luma-plus-extinction-times-path-scale-v0",
            "transmittance": "pre-depth-bin-shared-ridge-plus-nonridge-transmittance-v0",
        },
        "artifacts": artifacts,
        "execution": {"rowCount": count, "cameraCount": 21, "calibrationCameraCount": 1, "heldOutCameraCount": 20, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "cachedCameraCount": 0},
        "claimBoundary": CLAIM_BOUNDARY,
    }
    manifest_payload["identity"] = "sha256:" + hashlib.sha256(
        ORACLE.canonical_json(manifest_payload).encode("ascii")
    ).hexdigest()
    manifest_path = output_dir / "grid96-parent-peak-wisp-attribution-manifest.json"
    manifest_path.write_text(json.dumps(manifest_payload, indent=2, sort_keys=True) + "\n")
    gallery_path = output_dir / "index.html"
    gallery_path.write_text(gallery_html(camera_rows))
    require(gallery_path.stat().st_size > 1000, "attribution gallery is blank or partial")
    return {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "source": manifest_payload["source"],
        "effective": manifest_payload["attribution"],
        "cameras": camera_rows,
        "artifacts": {**artifacts, "manifest": {"path": str(manifest_path), "sha256": sha256_file(manifest_path), "identity": manifest_payload["identity"]}, "gallery": str(gallery_path)},
        "execution": manifest_payload["execution"],
        "claimBoundary": CLAIM_BOUNDARY,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-registry", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--capture-report", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--path-scale", type=float, required=True)
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    primary_names = (
        "grid96-parent-peak-wisp-attribution-manifest.json",
        "grid96-parent-peak-wisp-per-camera.f32",
        "grid96-parent-peak-wisp-reduced.f32",
        "grid96-parent-peak-wisp-native-cell-index.u32",
        "index.html",
    )
    for name in primary_names:
        (output_dir / name).unlink(missing_ok=True)
    started = time.time()
    args._phase = {"value": "source-registry-validation"}
    requested = {
        "sourceRegistry": str(args.source_registry.resolve()),
        "manifest": str(args.manifest.resolve()),
        "captureReport": str(args.capture_report.resolve()),
        "outputDir": str(output_dir),
        "pathScale": args.path_scale,
        "depthBins": args.depth_bins,
        "validateOnly": args.validate_only,
    }
    try:
        require(math.isfinite(args.path_scale) and args.path_scale > 0.0, "path scale must be finite and positive")
        require(args.depth_bins == 96, "the frozen attribution contract requires exactly 96 depth bins")
        result = run(args, output_dir)
        report = {**result, "requested": requested, "startedAtUnix": started, "finishedAtUnix": time.time()}
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"ok": True, "status": report["status"], "report": str(report_path), "artifacts": report.get("artifacts")}, indent=2))
        return 0
    except Exception as exc:
        for name in primary_names:
            (output_dir / name).unlink(missing_ok=True)
        failed = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": args._phase["value"],
            "requested": requested,
            "startedAtUnix": started,
            "finishedAtUnix": time.time(),
            "error": {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()},
            "lastTrustworthyEvidence": {"sourceRegistryExpectedIdentity": EXPECTED_REGISTRY_IDENTITY, "sourceRegistryExpectedSha256": EXPECTED_REGISTRY_SHA256},
            "claimBoundary": CLAIM_BOUNDARY,
        }
        report_path.write_text(json.dumps(failed, indent=2, sort_keys=True) + "\n")
        print(f"Grid96 parent attribution failed at {args._phase['value']}: {exc}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
