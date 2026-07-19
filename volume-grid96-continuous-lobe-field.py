#!/usr/bin/env python3
"""Build a multiscale continuous importance teacher from exact Grid96 labels.

The producer consumes the reviewed all-parent, all-camera peak/wisp attribution
socket and the exact source registry. It emits dense world-grid importance
fields and all-parent weighted samples. It does not select, move, merge, split,
or otherwise place Gaussian primitives.
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


REPORT_SCHEMA = "kaminos.volume.grid96-continuous-lobe-field-report.v0"
MANIFEST_SCHEMA = "kaminos.volume.grid96-continuous-lobe-field.v0"
EXPECTED_REGISTRY_SCHEMA = "kaminos.volume.grid96-peak-wisp-source-registry.v0"
EXPECTED_REGISTRY_IDENTITY = "sha256:ce1d84b4bb03c2132a1f9e80406192f1f6f25cb1aec5b970befd7095c16b49f8"
EXPECTED_REGISTRY_SHA256 = "b47a29e72422c903e8c1647e60a31777c527bb9a10ed4cbc405a09ebe50f2481"
EXPECTED_ATTRIBUTION_SCHEMA = "kaminos.volume.grid96-parent-peak-wisp-attribution-socket.v0"
EXPECTED_ATTRIBUTION_IDENTITY = "sha256:6ee6177872333988eaaff59b143c5e5fd890db6128a809ab93ce56ba17909cd7"
EXPECTED_ATTRIBUTION_SHA256 = "fbf40d3690141d61b5ef08eef4eb5dce58273e51ac398d90b67aa192b2cc74c3"
EXPECTED_ROW_COUNT = 370194
EXPECTED_GRID = 96
EXPECTED_STEP = 120
CALIBRATION_CAMERA_INDEX = 10
PER_CAMERA_WIDTH = 8
REDUCED_WIDTH = 14
FIELD_ORDER = (
    "peak.heldAll",
    "peak.heldEven",
    "peak.heldOdd",
    "peak.calibration",
    "wisp.heldAll",
)
DEFAULT_BANDWIDTHS = (0.0, 1.0, 2.0, 4.0)
AXES = {"x": 2, "y": 1, "z": 0}
WORLD_COORDINATE_INDEX = {"x": 0, "y": 1, "z": 2}
CLAIM_BOUNDARY = {
    "projectionRelevanceOnly": True,
    "continuousImportanceTeacherOnly": True,
    "candidateCentersProduced": False,
    "componentCountClaimed": False,
    "temporalPersistenceClaimed": False,
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


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def load_json(path: Path, role: str) -> dict[str, Any]:
    require(path.is_file(), f"{role} is missing: {path}")
    try:
        value = json.loads(path.read_text())
    except Exception as exc:
        raise ValueError(f"{role} JSON could not be read: {exc}") from exc
    require(isinstance(value, dict), f"{role} must be a JSON object")
    return value


def artifact_receipt(path: Path, dtype: str, shape: list[int], role: str) -> dict[str, Any]:
    dtype_map = {"float32-le": "<f4", "uint32-le": "<u4"}
    expected_bytes = int(np.prod(shape, dtype=np.int64)) * np.dtype(dtype_map[dtype]).itemsize
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


def dense_field(native_ids: np.ndarray, weights: np.ndarray, grid: int) -> np.ndarray:
    ids = np.asarray(native_ids, dtype=np.int64)
    values = np.asarray(weights, dtype=np.float64)
    require(grid > 0, "dense field grid must be positive")
    require(ids.ndim == values.ndim == 1 and ids.shape == values.shape, "dense field rows must align")
    require(np.all((ids >= 0) & (ids < grid**3)), "dense field native id is out of range")
    require(np.unique(ids).size == ids.size, "dense field native ids contain duplicates")
    require(np.all(np.isfinite(values)) and np.all(values >= 0.0), "dense field weights are invalid")
    field = np.zeros(grid**3, dtype=np.float32)
    field[ids] = values.astype(np.float32)
    return field.reshape((grid, grid, grid))


def _smooth_axis(field: np.ndarray, kernel: np.ndarray, axis: int) -> np.ndarray:
    radius = kernel.size // 2
    result = np.zeros_like(field, dtype=np.float32)
    for kernel_index, weight in enumerate(kernel):
        offset = kernel_index - radius
        source = [slice(None)] * 3
        target = [slice(None)] * 3
        if offset < 0:
            source[axis] = slice(-offset, None)
            target[axis] = slice(None, offset)
        elif offset > 0:
            source[axis] = slice(None, -offset)
            target[axis] = slice(offset, None)
        result[tuple(target)] += field[tuple(source)] * np.float32(weight)
    return result


def gaussian_smooth(field: np.ndarray, sigma_cells: float) -> np.ndarray:
    values = np.asarray(field, dtype=np.float32)
    require(values.ndim == 3, "continuous field must be three-dimensional")
    require(np.all(np.isfinite(values)) and np.all(values >= 0.0), "continuous field is invalid")
    require(math.isfinite(sigma_cells) and sigma_cells >= 0.0, "bandwidth must be finite and nonnegative")
    if sigma_cells == 0.0:
        return values.copy()
    radius = max(1, int(math.ceil(3.0 * sigma_cells)))
    coordinates = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-0.5 * np.square(coordinates / sigma_cells))
    kernel /= np.sum(kernel, dtype=np.float64)
    result = values
    for axis in range(3):
        result = _smooth_axis(result, kernel, axis)
    require(np.all(np.isfinite(result)) and np.all(result >= 0.0), "smoothed field is invalid")
    return result


def field_metrics(field: np.ndarray) -> dict[str, Any]:
    values = np.asarray(field, dtype=np.float64)
    require(values.ndim == 3 and np.all(np.isfinite(values)) and np.all(values >= 0.0), "field metrics input is invalid")
    flat = values.reshape(-1)
    positive = flat[flat > 0.0]
    total = float(np.sum(positive, dtype=np.float64))
    require(total > 0.0 and positive.size > 0, "field metrics input is blank")
    squared = float(np.sum(np.square(positive), dtype=np.float64))
    probability = positive / total
    entropy = float(-np.sum(probability * np.log(np.maximum(probability, 1e-300)), dtype=np.float64))
    sorted_values = np.sort(positive)[::-1]
    top_mass: dict[str, float] = {}
    for fraction in (0.01, 0.05, 0.10, 0.25):
        count = min(positive.size, max(1, int(math.ceil(fraction * flat.size))))
        top_mass[f"{fraction:.2f}"] = float(np.sum(sorted_values[:count], dtype=np.float64) / total)

    z, y, x = np.indices(values.shape, dtype=np.float64)
    coordinates = (x, y, z)
    centroid = [float(np.sum(axis * values, dtype=np.float64) / total) for axis in coordinates]
    centered = [axis - center for axis, center in zip(coordinates, centroid)]
    covariance = [
        float(np.sum(centered[0] * centered[0] * values, dtype=np.float64) / total),
        float(np.sum(centered[0] * centered[1] * values, dtype=np.float64) / total),
        float(np.sum(centered[0] * centered[2] * values, dtype=np.float64) / total),
        float(np.sum(centered[1] * centered[1] * values, dtype=np.float64) / total),
        float(np.sum(centered[1] * centered[2] * values, dtype=np.float64) / total),
        float(np.sum(centered[2] * centered[2] * values, dtype=np.float64) / total),
    ]
    return {
        "positiveVoxelCount": int(positive.size),
        "totalMass": total,
        "maximum": float(np.max(positive)),
        "effectiveVoxelCount": total * total / max(squared, 1e-300),
        "normalizedEntropy": entropy / math.log(flat.size) if flat.size > 1 else 0.0,
        "topVoxelBasis": "full-grid-voxel-count-v0",
        "topMassFractions": top_mass,
        "weightedCentroidGrid": centroid,
        "weightedCovarianceGrid": covariance,
    }


def centroid_slice_index(centroid: list[float], axis_name: str, *, grid: int) -> int:
    require(axis_name in WORLD_COORDINATE_INDEX, "centroid slice axis is invalid")
    require(len(centroid) == 3 and grid > 0, "centroid slice input is invalid")
    coordinate = float(centroid[WORLD_COORDINATE_INDEX[axis_name]])
    require(math.isfinite(coordinate), "centroid slice coordinate is invalid")
    return int(np.clip(round(coordinate), 0, grid - 1))


def compare_fields(first: np.ndarray, second: np.ndarray) -> dict[str, float]:
    left = np.asarray(first, dtype=np.float64).reshape(-1)
    right = np.asarray(second, dtype=np.float64).reshape(-1)
    require(left.shape == right.shape, "field comparison shapes drifted")
    require(np.all(np.isfinite(left)) and np.all(left >= 0.0), "first comparison field is invalid")
    require(np.all(np.isfinite(right)) and np.all(right >= 0.0), "second comparison field is invalid")
    left_total = float(np.sum(left, dtype=np.float64))
    right_total = float(np.sum(right, dtype=np.float64))
    require(left_total > 0.0 and right_total > 0.0, "field comparison input is blank")
    left_probability = left / left_total
    right_probability = right / right_total
    midpoint = 0.5 * (left_probability + right_probability)

    def kl_divergence(source: np.ndarray, target: np.ndarray) -> float:
        selected = source > 0.0
        return float(np.sum(source[selected] * np.log(source[selected] / np.maximum(target[selected], 1e-300)), dtype=np.float64))

    cosine_denominator = math.sqrt(float(np.dot(left, left)) * float(np.dot(right, right)))
    return {
        "cosineSimilarity": float(np.dot(left, right) / max(cosine_denominator, 1e-300)),
        "normalizedL1": float(0.5 * np.sum(np.abs(left_probability - right_probability), dtype=np.float64)),
        "jensenShannonDivergence": 0.5 * kl_divergence(left_probability, midpoint)
        + 0.5 * kl_divergence(right_probability, midpoint),
        "bhattacharyyaCoefficient": float(np.sum(np.sqrt(left_probability * right_probability), dtype=np.float64)),
    }


def _colorize(field: np.ndarray) -> np.ndarray:
    values = np.asarray(field, dtype=np.float32)
    positive = values[values > 0.0]
    if positive.size == 0:
        return np.zeros((*values.shape, 3), dtype=np.uint8)
    scale = float(np.percentile(positive, 99.5))
    normalized = np.clip(values / max(scale, 1e-20), 0.0, 1.0)
    normalized = np.log1p(9.0 * normalized) / math.log(10.0)
    red = np.clip(2.5 * normalized - 0.4, 0.0, 1.0)
    green = np.clip(1.8 * normalized, 0.0, 1.0)
    blue = np.clip(1.5 * (1.0 - normalized), 0.0, 1.0) * np.sqrt(normalized)
    return np.rint(np.stack((red, green, blue), axis=2) * 255.0).astype(np.uint8)


def render_projection(
    field: np.ndarray,
    *,
    axis: int,
    mode: str,
    slice_index: int | None = None,
) -> np.ndarray:
    values = np.asarray(field, dtype=np.float32)
    require(values.ndim == 3 and axis in (0, 1, 2), "projection axis is invalid")
    require(mode in ("maximum", "integral", "slice"), "projection mode is invalid")
    if mode == "maximum":
        projected = np.max(values, axis=axis)
    elif mode == "integral":
        projected = np.sum(values, axis=axis, dtype=np.float32)
    else:
        require(slice_index is not None and 0 <= slice_index < values.shape[axis], "projection slice is invalid")
        projected = np.take(values, slice_index, axis=axis)
    if axis == 2:
        projected = np.flipud(projected.T)
    else:
        projected = np.flipud(projected)
    return _colorize(projected)


def write_png(
    path: Path,
    image: np.ndarray,
    *,
    semantic_role: str,
    require_nonflat: bool,
) -> dict[str, Any]:
    from PIL import Image

    pixels = np.asarray(image, dtype=np.uint8)
    require(pixels.ndim == 3 and pixels.shape[2] == 3 and pixels.size > 0, "visual output is blank")
    Image.fromarray(pixels, mode="RGB").save(path)
    require(path.is_file() and path.stat().st_size > 0, f"visual output is partial: {path}")
    with Image.open(path) as decoded_image:
        decoded = np.asarray(decoded_image.convert("RGB"), dtype=np.uint8)
    require(decoded.shape == pixels.shape, f"visual output dimensions drifted: {path}")
    unique_color_count = int(np.unique(decoded.reshape(-1, 3), axis=0).shape[0])
    flat = unique_color_count <= 1
    if require_nonflat:
        require(not flat, f"visual output is flat: {path}")
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "shape": list(decoded.shape),
        "uniqueColorCount": unique_color_count,
        "flat": flat,
        "semanticRole": semantic_role,
    }


def gallery_html(
    visual_rows: list[dict[str, Any]],
    *,
    bandwidths: list[float],
    grid: int,
    source_identity: str,
    attribution_identity: str,
) -> str:
    rows = json.dumps(visual_rows, separators=(",", ":"))
    bandwidth_json = json.dumps(bandwidths, separators=(",", ":"))
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>Continuous Grid96 Lobe Importance</title><style>
:root{{--bg:#101214;--line:#363c41;--text:#f3f4f5;--muted:#aeb4b9;--accent:#ffd33d}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0}}header{{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#171a1c;border-bottom:1px solid var(--line)}}h1{{font-size:15px;margin:0}}label{{display:flex;gap:6px;align-items:center;color:var(--muted)}}main{{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:14px;padding:14px}}.stage{{width:min(100%,calc(100vh - 110px));aspect-ratio:1;margin:auto;background:#050607;border:1px solid var(--line)}}.stage img{{display:block;width:100%;height:100%;image-rendering:pixelated;object-fit:contain}}aside{{border-left:1px solid var(--line);padding-left:14px}}h2{{font-size:13px;margin:0 0 10px}}dl{{display:grid;grid-template-columns:1fr auto;gap:6px 10px;margin:0 0 12px}}dt{{color:var(--muted)}}dd{{margin:0;text-align:right;max-width:180px;overflow-wrap:anywhere}}a{{color:var(--accent)}}.note{{color:var(--muted);border-top:1px solid var(--line);padding-top:10px}}@media(max-width:760px){{h1{{width:100%}}main{{grid-template-columns:1fr}}.stage{{width:100%}}aside{{border-left:0;border-top:1px solid var(--line);padding:12px 0 0}}dl{{grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr)}}dd{{max-width:none}}}}
</style></head><body><header><h1>Continuous Grid96 lobe importance</h1><label>Field <select id="field"></select></label><label>Bandwidth <select id="bandwidth"></select></label><label>Axis <select id="axis"><option>x</option><option>y</option><option>z</option></select></label><label>View <select id="mode"><option value="maximum">maximum</option><option value="integral">integral</option><option value="slice">slice</option></select></label></header><main><section><div class="stage"><img id="image" alt="continuous importance field"></div></section><aside><h2>Exact-source receipt</h2><dl><dt>Status</dt><dd>complete</dd><dt>Authority</dt><dd>teacher only</dd><dt>Grid</dt><dd>{grid}</dd><dt>Parents</dt><dd>370,194</dd><dt>No candidate centers</dt><dd>true</dd><dt>Source</dt><dd>{source_identity}</dd><dt>Attribution</dt><dd>{attribution_identity}</dd><dt>Report</dt><dd><a href="report.json">JSON</a></dd><dt>Manifest</dt><dd><a href="grid96-continuous-lobe-field-manifest.json">JSON</a></dd></dl><p class="note">Diagnostic multiscale density, not placement. Integral accumulates each world-axis column; slice uses the weighted-centroid slice.</p></aside></main><script>
const rows={rows},bandwidths={bandwidth_json},fields=[...new Set(rows.map(r=>r.field))],$=id=>document.getElementById(id);for(const value of fields)$('field').add(new Option(value,value));for(const value of bandwidths)$('bandwidth').add(new Option(String(value),String(value)));if(bandwidths.includes(1))$('bandwidth').value='1';$('axis').value='y';$('mode').value='integral';function render(){{const field=$('field').value,bw=+$('bandwidth').value,axis=$('axis').value,mode=$('mode').value,row=rows.find(r=>r.field===field&&r.bandwidthCells===bw&&r.axis===axis&&r.mode===mode);$('image').src=row?row.image:''}}for(const id of ['field','bandwidth','axis','mode'])$(id).addEventListener('input',render);render();</script></body></html>"""


def validate_inputs(
    registry_path: Path,
    attribution_path: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Path], np.ndarray, np.ndarray]:
    registry = load_json(registry_path, "source registry")
    require(sha256_file(registry_path) == EXPECTED_REGISTRY_SHA256, "source registry sha256 drifted")
    require(registry.get("schema") == EXPECTED_REGISTRY_SCHEMA, "source registry schema drifted")
    require(registry.get("identity") == EXPECTED_REGISTRY_IDENTITY, "source registry identity drifted")
    require(registry.get("status") == "complete", "source registry is not complete")
    require(registry.get("rowCount") == EXPECTED_ROW_COUNT, "source registry row count drifted")
    require(registry.get("grid") == EXPECTED_GRID, "source registry grid drifted")
    require(registry.get("simStepCount") == EXPECTED_STEP, "source registry step drifted")
    registry_execution = registry.get("execution") or {}
    require(registry_execution.get("sampleCap") is None, "source registry applied a hidden sample cap")
    require(registry_execution.get("droppedRowCount") == 0, "source registry dropped rows")
    require(registry_execution.get("fallbackRowCount") == 0, "source registry used fallback rows")

    attribution = load_json(attribution_path, "parent attribution manifest")
    require(sha256_file(attribution_path) == EXPECTED_ATTRIBUTION_SHA256, "parent attribution manifest sha256 drifted")
    require(attribution.get("schema") == EXPECTED_ATTRIBUTION_SCHEMA, "parent attribution schema drifted")
    require(attribution.get("identity") == EXPECTED_ATTRIBUTION_IDENTITY, "parent attribution identity drifted")
    require(attribution.get("status") == "complete", "parent attribution is not complete")
    attribution_execution = attribution.get("execution") or {}
    require(attribution_execution.get("rowCount") == EXPECTED_ROW_COUNT, "parent attribution row count drifted")
    require(attribution_execution.get("cameraCount") == 21, "parent attribution camera count drifted")
    require(attribution_execution.get("sampleCap") is None, "parent attribution applied a hidden sample cap")
    require(attribution_execution.get("droppedRowCount") == 0, "parent attribution dropped rows")
    require(attribution_execution.get("fallbackRowCount") == 0, "parent attribution used fallback rows")
    require(attribution_execution.get("cachedCameraCount") == 0, "parent attribution used cached cameras")
    attribution_source = attribution.get("source") or {}
    source_registry = attribution_source.get("registry") or {}
    require(source_registry.get("identity") == EXPECTED_REGISTRY_IDENTITY, "attribution source registry identity drifted")
    require(source_registry.get("sha256") == EXPECTED_REGISTRY_SHA256, "attribution source registry sha256 drifted")
    require(attribution_source.get("sameStateCaptureId") == registry.get("sameStateCaptureId"), "source state identity drifted")

    families = registry.get("featureFamilies") or {}
    descriptor_receipt = (families.get("descriptors") or {}).get("artifact") or {}
    descriptor_path = Path(descriptor_receipt.get("path", "")).resolve()
    require(descriptor_receipt.get("dtype") == "float32-le", "descriptor dtype drifted")
    require(descriptor_receipt.get("shape") == [EXPECTED_ROW_COUNT, 100], "descriptor shape drifted")
    require(descriptor_path.is_file() and descriptor_path.stat().st_size == descriptor_receipt.get("bytes"), "descriptor artifact is missing or partial")
    require(sha256_file(descriptor_path) == descriptor_receipt.get("sha256"), "descriptor sha256 drifted")

    registry_native_receipt = registry.get("nativeCellIndex") or {}
    registry_native_path = Path(registry_native_receipt.get("path", "")).resolve()
    require(registry_native_receipt.get("dtype") == "uint32-le", "source native-id dtype drifted")
    require(registry_native_receipt.get("shape") == [EXPECTED_ROW_COUNT], "source native-id shape drifted")
    require(registry_native_path.is_file() and registry_native_path.stat().st_size == registry_native_receipt.get("bytes"), "source native-id artifact is missing or partial")
    require(sha256_file(registry_native_path) == registry_native_receipt.get("sha256"), "source native-id sha256 drifted")

    artifacts = attribution.get("artifacts") or {}
    paths: dict[str, Path] = {"descriptors": descriptor_path, "sourceNative": registry_native_path}
    for key, dtype, shape in (
        ("perCamera", "float32-le", [21, EXPECTED_ROW_COUNT, PER_CAMERA_WIDTH]),
        ("reduced", "float32-le", [EXPECTED_ROW_COUNT, REDUCED_WIDTH]),
        ("nativeCellIndex", "uint32-le", [EXPECTED_ROW_COUNT]),
    ):
        receipt = artifacts.get(key) or {}
        path = Path(receipt.get("path", "")).resolve()
        require(receipt.get("dtype") == dtype and receipt.get("shape") == shape, f"attribution {key} contract drifted")
        require(path.is_file() and path.stat().st_size == receipt.get("bytes"), f"attribution {key} artifact is missing or partial")
        require(sha256_file(path) == receipt.get("sha256"), f"attribution {key} sha256 drifted")
        paths[key] = path

    source_ids = np.memmap(registry_native_path, dtype="<u4", mode="r", shape=(EXPECTED_ROW_COUNT,))
    attribution_ids = np.memmap(paths["nativeCellIndex"], dtype="<u4", mode="r", shape=(EXPECTED_ROW_COUNT,))
    require(np.array_equal(source_ids, attribution_ids), "source and attribution native-id rows are misaligned")
    require(np.unique(source_ids).size == EXPECTED_ROW_COUNT, "source native ids contain duplicates")
    descriptors = np.memmap(descriptor_path, dtype="<f4", mode="r", shape=(EXPECTED_ROW_COUNT, 100))
    positions = np.asarray(descriptors[:, 0:3], dtype=np.float32)
    descriptor_ids = np.asarray(descriptors[:, 3], dtype=np.float64)
    require(np.array_equal(descriptor_ids, np.asarray(source_ids, dtype=np.float64)), "descriptor position native ids drifted")
    require(np.all(np.isfinite(positions)), "descriptor world positions contain nonfinite values")
    x = np.asarray(source_ids % EXPECTED_GRID, dtype=np.float32)
    y = np.asarray((source_ids // EXPECTED_GRID) % EXPECTED_GRID, dtype=np.float32)
    z = np.asarray(source_ids // (EXPECTED_GRID * EXPECTED_GRID), dtype=np.float32)
    expected_positions = np.stack(((x + 0.5) / 48.0 - 1.0, (y + 0.5) / 48.0 - 1.0, (z + 0.5) / 48.0 - 1.0), axis=1)
    require(float(np.max(np.abs(positions - expected_positions))) <= 2e-7, "descriptor positions are not the exact native cell centers")
    return registry, attribution, paths, source_ids, positions


def build_raw_fields(
    attribution: dict[str, Any],
    paths: dict[str, Path],
) -> tuple[np.ndarray, dict[str, Any]]:
    per_camera = np.memmap(paths["perCamera"], dtype="<f4", mode="r", shape=(21, EXPECTED_ROW_COUNT, PER_CAMERA_WIDTH))
    reduced = np.memmap(paths["reduced"], dtype="<f4", mode="r", shape=(EXPECTED_ROW_COUNT, REDUCED_WIDTH))
    roles = (attribution.get("attribution") or {}).get("cameraRoles") or []
    require(len(roles) == 21, "parent attribution camera roles drifted")
    calibration_slots = [slot for slot, row in enumerate(roles) if row.get("cameraIndex") == CALIBRATION_CAMERA_INDEX and row.get("role") == "calibration"]
    require(calibration_slots == [10], "calibration camera role drifted")
    held_slots = [slot for slot, row in enumerate(roles) if row.get("role") == "held-out"]
    held_even = [slot for slot in held_slots if int(roles[slot]["cameraIndex"]) % 2 == 0]
    held_odd = [slot for slot in held_slots if int(roles[slot]["cameraIndex"]) % 2 == 1]
    require(len(held_slots) == 20 and held_even and held_odd, "held-camera split is incomplete")
    fields = np.stack(
        (
            np.mean(per_camera[held_slots, :, 6], axis=0),
            np.mean(per_camera[held_even, :, 6], axis=0),
            np.mean(per_camera[held_odd, :, 6], axis=0),
            per_camera[calibration_slots[0], :, 6],
            np.mean(per_camera[held_slots, :, 7], axis=0),
        ),
        axis=1,
    ).astype(np.float32)
    require(np.all(np.isfinite(fields)) and np.all(fields >= 0.0), "all-parent lobe fields are invalid")
    require(np.all(np.sum(fields, axis=0, dtype=np.float64) > 0.0), "all-parent peak field is blank")
    require(np.allclose(fields[:, 0], reduced[:, 3], rtol=1e-6, atol=1e-10), "held-all peak reduction drifted")
    require(np.allclose(fields[:, 4], reduced[:, 7], rtol=1e-6, atol=1e-10), "held-all wisp reduction drifted")
    return fields, {
        "calibrationCameraIndices": [CALIBRATION_CAMERA_INDEX],
        "heldCameraIndices": [int(roles[slot]["cameraIndex"]) for slot in held_slots],
        "heldEvenCameraIndices": [int(roles[slot]["cameraIndex"]) for slot in held_even],
        "heldOddCameraIndices": [int(roles[slot]["cameraIndex"]) for slot in held_odd],
    }


def producer_identity() -> dict[str, Any]:
    script = Path(__file__).resolve()
    parent_script = script.with_name("volume-grid96-parent-peak-wisp-attribution.py")
    return {
        "script": {"path": str(script), "sha256": sha256_file(script)},
        "parentAttributionScript": {"path": str(parent_script), "sha256": sha256_file(parent_script)},
        "pythonExecutable": str(Path(sys.executable).resolve()),
        "routeReceiptAuthority": "external-gpu-greenroom-receipt-required-v0",
    }


def run(args: argparse.Namespace, output_dir: Path) -> dict[str, Any]:
    args._phase["value"] = "source-validation"
    registry_path = args.source_registry.resolve()
    attribution_path = args.parent_attribution_manifest.resolve()
    registry, attribution, paths, native_ids, positions = validate_inputs(registry_path, attribution_path)
    bandwidths = sorted(set(float(value) for value in (args.bandwidth_cells or DEFAULT_BANDWIDTHS)))
    require(bandwidths and all(math.isfinite(value) and value >= 0.0 for value in bandwidths), "requested bandwidths are invalid")
    require(0.0 in bandwidths, "requested bandwidths must include the unsmoothed control")

    args._phase["value"] = "parent-field-load"
    raw_weights, camera_split = build_raw_fields(attribution, paths)
    points_path = output_dir / "grid96-continuous-lobe-source-points.f32"
    point_values = np.concatenate((positions, raw_weights), axis=1).astype("<f4")
    point_values.tofile(points_path)
    native_path = output_dir / "grid96-continuous-lobe-native-cell-index.u32"
    np.asarray(native_ids, dtype="<u4").tofile(native_path)

    args._phase["value"] = "multiscale-field-build"
    field_path = output_dir / "grid96-continuous-lobe-fields.f32"
    output_fields = np.memmap(
        field_path,
        dtype="<f4",
        mode="w+",
        shape=(len(FIELD_ORDER), len(bandwidths), EXPECTED_GRID, EXPECTED_GRID, EXPECTED_GRID),
    )
    field_rows: list[dict[str, Any]] = []
    visual_rows: list[dict[str, Any]] = []
    raw_dense: dict[str, np.ndarray] = {}
    smoothed_cache: dict[tuple[str, float], np.ndarray] = {}
    for field_index, field_name in enumerate(FIELD_ORDER):
        dense = dense_field(native_ids, raw_weights[:, field_index], EXPECTED_GRID)
        raw_dense[field_name] = dense
        raw_total = float(np.sum(dense, dtype=np.float64))
        for bandwidth_index, bandwidth in enumerate(bandwidths):
            smooth = gaussian_smooth(dense, bandwidth)
            output_fields[field_index, bandwidth_index] = smooth
            smoothed_cache[(field_name, bandwidth)] = smooth
            metrics = field_metrics(smooth)
            centroid = metrics["weightedCentroidGrid"]
            row = {
                "field": field_name,
                "bandwidthCells": bandwidth,
                "kernel": "separable-zero-boundary-gaussian-three-sigma-v0" if bandwidth > 0.0 else "identity-v0",
                "massRetention": metrics["totalMass"] / raw_total,
                "metrics": metrics,
            }
            field_rows.append(row)
            for axis_name, axis in AXES.items():
                slice_index = centroid_slice_index(centroid, axis_name, grid=EXPECTED_GRID)
                for mode in ("maximum", "integral", "slice"):
                    image_name = (
                        field_name.replace(".", "-")
                        + f"-bw{bandwidth:g}-{axis_name}-{mode}.png"
                    )
                    visual_receipt = write_png(
                        output_dir / image_name,
                        render_projection(
                            smooth,
                            axis=axis,
                            mode=mode,
                            slice_index=slice_index if mode == "slice" else None,
                        ),
                        semantic_role=f"{field_name}-{bandwidth:g}-{axis_name}-{mode}",
                        require_nonflat=mode != "slice",
                    )
                    visual_rows.append(
                        {
                            "field": field_name,
                            "bandwidthCells": bandwidth,
                            "axis": axis_name,
                            "mode": mode,
                            "sliceIndex": slice_index if mode == "slice" else None,
                            "image": image_name,
                            "artifact": visual_receipt,
                        }
                    )
    output_fields.flush()
    del output_fields

    args._phase["value"] = "split-view-agreement"
    split_agreement = []
    calibration_agreement = []
    peak_wisp_agreement = []
    for bandwidth in bandwidths:
        split_agreement.append(
            {
                "bandwidthCells": bandwidth,
                **compare_fields(
                    smoothed_cache[("peak.heldEven", bandwidth)],
                    smoothed_cache[("peak.heldOdd", bandwidth)],
                ),
            }
        )
        calibration_agreement.append(
            {
                "bandwidthCells": bandwidth,
                **compare_fields(
                    smoothed_cache[("peak.heldAll", bandwidth)],
                    smoothed_cache[("peak.calibration", bandwidth)],
                ),
            }
        )
        peak_wisp_agreement.append(
            {
                "bandwidthCells": bandwidth,
                **compare_fields(
                    smoothed_cache[("peak.heldAll", bandwidth)],
                    smoothed_cache[("wisp.heldAll", bandwidth)],
                ),
            }
        )
    del smoothed_cache, raw_dense

    args._phase["value"] = "artifact-validation"
    artifacts = {
        "sourcePoints": artifact_receipt(
            points_path,
            "float32-le",
            [EXPECTED_ROW_COUNT, 3 + len(FIELD_ORDER)],
            "all-parent-world-position-plus-separate-importance-samples",
        ),
        "nativeCellIndex": artifact_receipt(
            native_path,
            "uint32-le",
            [EXPECTED_ROW_COUNT],
            "caller-ordered-native-cell-index",
        ),
        "fields": artifact_receipt(
            field_path,
            "float32-le",
            [len(FIELD_ORDER), len(bandwidths), EXPECTED_GRID, EXPECTED_GRID, EXPECTED_GRID],
            "multiscale-continuous-world-grid-importance-teacher",
        ),
    }
    require(artifacts["nativeCellIndex"]["sha256"] == (attribution.get("artifacts") or {})["nativeCellIndex"]["sha256"], "output native-id hash drifted")
    require(len(visual_rows) == len(FIELD_ORDER) * len(bandwidths) * len(AXES) * 3, "visual output is incomplete")
    require(
        all(row["artifact"]["sha256"] == sha256_file(Path(row["artifact"]["path"])) for row in visual_rows),
        "visual output receipt drifted",
    )

    args._phase["value"] = "gallery-write"
    gallery_path = output_dir / "index.html"
    gallery_path.write_text(
        gallery_html(
            visual_rows,
            bandwidths=bandwidths,
            grid=EXPECTED_GRID,
            source_identity=registry["identity"],
            attribution_identity=attribution["identity"],
        )
    )
    require(gallery_path.stat().st_size > 2000, "gallery output is blank or partial")

    args._phase["value"] = "manifest-write"
    manifest_payload = {
        "schema": MANIFEST_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "source": {
            "registry": {
                "path": str(registry_path),
                "sha256": EXPECTED_REGISTRY_SHA256,
                "identity": registry["identity"],
            },
            "parentAttributionManifest": {
                "path": str(attribution_path),
                "sha256": EXPECTED_ATTRIBUTION_SHA256,
                "identity": attribution["identity"],
            },
            "sameStateCaptureId": registry["sameStateCaptureId"],
            "sourceHashes": registry["sourceHashes"],
            "producerIdentity": producer_identity(),
        },
        "field": {
            "identity": "all-parent-multiview-attribution-gaussian-density-teacher-v0",
            "fieldOrder": list(FIELD_ORDER),
            "bandwidthCells": bandwidths,
            "axisOrder": ["z", "y", "x"],
            "worldCellWidth": 2.0 / EXPECTED_GRID,
            "boundary": "zero-outside-grid-with-explicit-mass-retention-v0",
            "cameraSplit": camera_split,
            "rows": field_rows,
            "agreement": {
                "heldEvenVersusHeldOdd": split_agreement,
                "heldAllVersusCalibration": calibration_agreement,
                "heldPeakVersusHeldWisp": peak_wisp_agreement,
            },
        },
        "artifacts": artifacts,
        "visuals": visual_rows,
        "execution": {
            "rowCount": EXPECTED_ROW_COUNT,
            "cameraCount": 21,
            "bandwidthCount": len(bandwidths),
            "fieldCount": len(FIELD_ORDER),
            "sampleCap": None,
            "droppedRowCount": 0,
            "fallbackRowCount": 0,
            "cachedOutputUsed": False,
        },
        "claimBoundary": CLAIM_BOUNDARY,
    }
    manifest_payload["identity"] = "sha256:" + hashlib.sha256(canonical_json(manifest_payload).encode("ascii")).hexdigest()
    manifest_path = output_dir / "grid96-continuous-lobe-field-manifest.json"
    manifest_path.write_text(json.dumps(manifest_payload, indent=2, sort_keys=True) + "\n")
    artifacts["manifest"] = {
        "path": str(manifest_path),
        "sha256": sha256_file(manifest_path),
        "identity": manifest_payload["identity"],
    }
    artifacts["gallery"] = {
        "path": str(gallery_path),
        "sha256": sha256_file(gallery_path),
        "semanticRole": "interactive-multiscale-continuous-lobe-field-gallery",
    }
    return {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "source": manifest_payload["source"],
        "field": manifest_payload["field"],
        "artifacts": artifacts,
        "execution": manifest_payload["execution"],
        "claimBoundary": CLAIM_BOUNDARY,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-registry", type=Path, required=True)
    parser.add_argument("--parent-attribution-manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--bandwidth-cells", type=float, action="append")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    primary_names = (
        "grid96-continuous-lobe-field-manifest.json",
        "grid96-continuous-lobe-source-points.f32",
        "grid96-continuous-lobe-native-cell-index.u32",
        "grid96-continuous-lobe-fields.f32",
        "index.html",
    )
    phase = {"value": "source-validation"}
    args._phase = phase
    started = time.time()
    try:
        existing = [name for name in primary_names if (output_dir / name).exists()]
        require(not existing, f"cached or partial primary output detected: {existing}")
        result = run(args, output_dir)
        result["durationSeconds"] = time.time() - started
        report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        return 0
    except Exception as exc:
        failure = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": phase["value"],
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
            "requested": {
                "sourceRegistry": str(args.source_registry.resolve()),
                "parentAttributionManifest": str(args.parent_attribution_manifest.resolve()),
                "outputDir": str(output_dir),
                "bandwidthCells": args.bandwidth_cells or list(DEFAULT_BANDWIDTHS),
            },
            "execution": {
                "sampleCap": None,
                "droppedRowCount": None,
                "fallbackRowCount": None,
                "cachedOutputUsed": False,
            },
            "claimBoundary": CLAIM_BOUNDARY,
            "durationSeconds": time.time() - started,
        }
        report_path.write_text(json.dumps(failure, indent=2, sort_keys=True) + "\n")
        print(failure["error"], file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
