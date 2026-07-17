#!/usr/bin/env python3
"""Render and measure an exact-state temporal sequence with frozen bilinear splats."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import traceback
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


REPORT_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-render.v0"
MANIFEST_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0"
FLOW_TAP_OFFSETS = (-1.0, -0.5, 0.0, 0.5, 1.0)
FLOW_TAP_WEIGHTS = (0.075, 0.225, 0.4, 0.225, 0.075)
DEPTH_BINS = 96
DEPOSITS_PER_CANDIDATE = len(FLOW_TAP_OFFSETS) * 4


def load_oracle() -> Any:
    path = Path(__file__).with_name("volume-layer-coefficient-render-oracle.py")
    spec = importlib.util.spec_from_file_location("kaminos_layer_coefficient_render_oracle", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load rendering oracle: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ORACLE = load_oracle()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_pixels(pixels: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(pixels).tobytes()).hexdigest()


def resolve_artifact(descriptor: dict[str, Any], manifest_path: Path, label: str) -> Path:
    raw = descriptor.get("path")
    require(isinstance(raw, str) and raw, f"{label} path is missing")
    path = Path(raw)
    path = path if path.is_absolute() else (manifest_path.parent / path).resolve()
    require(path.is_file(), f"{label} is missing: {path}")
    require(path.stat().st_size == descriptor.get("bytes"), f"{label} byte length drifted")
    require(sha256_file(path) == descriptor.get("sha256"), f"{label} sha256 drifted")
    return path


def load_rows(state: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    rows = state.get("rows") or {}
    count = rows.get("count")
    require(isinstance(count, int) and count > 0, f"{state.get('id')} row count is invalid")
    expected = {
        "features": ("float32-le", [count, 24], "<f4"),
        "coefficients": ("float32-le", [count, 8], "<f4"),
        "nativeCellIndices": ("uint32-le", [count], "<u4"),
        "kernelDescriptors": ("float32-le", [count, 8], "<f4"),
    }
    loaded: dict[str, Any] = {"count": count}
    for key, (dtype_name, shape, numpy_dtype) in expected.items():
        descriptor = rows.get(key) or {}
        require(descriptor.get("dtype") == dtype_name, f"{state.get('id')} {key} dtype drifted")
        require(descriptor.get("shape") == shape, f"{state.get('id')} {key} shape drifted")
        path = resolve_artifact(descriptor, manifest_path, f"{state.get('id')} {key}")
        loaded[key] = np.memmap(path, dtype=numpy_dtype, mode="r", shape=tuple(shape))
    projected_ids = np.rint(loaded["kernelDescriptors"][:, 3]).astype(np.uint32)
    require(np.array_equal(projected_ids, loaded["nativeCellIndices"]), f"{state.get('id')} projected native identities drifted")
    return loaded


def target_image(state: dict[str, Any], manifest_path: Path) -> np.ndarray:
    descriptor = state.get("target") or {}
    path = resolve_artifact(descriptor, manifest_path, f"{state.get('id')} exact target")
    pixels = np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)
    require(pixels.shape == (descriptor.get("height"), descriptor.get("width"), 3), f"{state.get('id')} target dimensions drifted")
    require(sha256_pixels(np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)) == descriptor.get("targetPixelSha256"), f"{state.get('id')} exact target pixel hash drifted")
    return pixels


def camera_contract(state: dict[str, Any]) -> dict[str, Any]:
    target = state.get("target") or {}
    return {
        "cameraIndex": 0,
        "width": int(target["width"]),
        "height": int(target["height"]),
        "cameraPose": target["cameraPose"],
    }


def raster_state(state: dict[str, Any], manifest_path: Path) -> tuple[np.ndarray, dict[str, Any], dict[str, Any]]:
    rows = load_rows(state, manifest_path)
    descriptors = rows["kernelDescriptors"]
    planes, telemetry = ORACLE.rasterize_coefficients(
        np.asarray(descriptors[:, 0:3]),
        np.asarray(descriptors[:, 4:7]),
        rows["features"],
        rows["coefficients"],
        camera_contract(state),
        DEPTH_BINS,
        "bilinear",
    )
    return planes, telemetry, rows


def pixel_mae(left: np.ndarray, right: np.ndarray) -> float:
    return float(np.mean(np.abs(left.astype(np.float32) - right.astype(np.float32))) / 255.0)


def flow_tap_placements(rows: dict[str, Any], camera: dict[str, Any]) -> np.ndarray:
    descriptors = rows["kernelDescriptors"]
    positions = np.asarray(descriptors[:, 0:3])
    tangents = np.asarray(descriptors[:, 4:7])
    features = rows["features"]
    width, height = int(camera["width"]), int(camera["height"])
    pose = camera["cameraPose"]
    ndc, _, valid = ORACLE.project(positions, pose["matrixWorldInverse"], pose["projectionMatrix"])
    tangent_ndc, _, tangent_valid = ORACLE.project(
        positions + tangents * 0.03, pose["matrixWorldInverse"], pose["projectionMatrix"]
    )
    pixel_x = (ndc[:, 0] * 0.5 + 0.5) * width
    pixel_y = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height
    tx = (tangent_ndc[:, 0] - ndc[:, 0]) * 0.5 * width
    ty = -(tangent_ndc[:, 1] - ndc[:, 1]) * 0.5 * height
    length = np.maximum(np.sqrt(tx * tx + ty * ty), 1e-5)
    tx /= length
    ty /= length
    base_radius = (2.0 / 160.0) * (0.60 + features[:, 3] * 2.65 + features[:, 2] * 0.48)
    pixel_world_scale = np.maximum(length / 0.03, 1.0)
    major_px = np.clip(np.sqrt(base_radius * base_radius + 0.5 * 0.03 * 0.03) * pixel_world_scale, 0.75, 5.0)
    offsets = np.asarray(FLOW_TAP_OFFSETS, dtype=np.float32)
    placements = np.stack([
        pixel_x[:, None] + tx[:, None] * major_px[:, None] * offsets[None, :],
        pixel_y[:, None] + ty[:, None] * major_px[:, None] * offsets[None, :],
    ], axis=2).astype(np.float32)
    placements[~(valid & tangent_valid)] = np.nan
    return placements


def bilinear_deposit_multiplicity(placements: np.ndarray, width: int, height: int) -> np.ndarray:
    finite = np.isfinite(placements).all(axis=2)
    x0 = np.floor(np.where(finite, placements[..., 0], -1.0)).astype(np.int32)
    y0 = np.floor(np.where(finite, placements[..., 1], -1.0)).astype(np.int32)
    multiplicity = np.zeros(placements.shape[0], dtype=np.int16)
    for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
        valid = finite & (x0 + dx >= 0) & (x0 + dx < width) & (y0 + dy >= 0) & (y0 + dy < height)
        multiplicity += np.sum(valid, axis=1).astype(np.int16)
    return multiplicity


def placement_velocity(previous: dict[str, Any], current: dict[str, Any], step_delta: int) -> dict[str, Any]:
    require(step_delta > 0, "adjacent temporal states must have a positive step delta")
    shared, previous_rows, current_rows = np.intersect1d(
        previous["ids"], current["ids"], assume_unique=True, return_indices=True
    )
    if shared.size == 0:
        return {"sharedNodeCount": 0, "sharedVisibleTapCount": 0, "mean": None, "p50": None, "p95": None, "max": None, "unit": "screen-pixels-per-simulator-step"}
    previous_taps = previous["placements"][previous_rows]
    current_taps = current["placements"][current_rows]
    finite = np.isfinite(previous_taps).all(axis=2) & np.isfinite(current_taps).all(axis=2)
    displacement = np.linalg.norm(current_taps - previous_taps, axis=2)[finite] / step_delta
    if displacement.size == 0:
        return {"sharedNodeCount": int(shared.size), "sharedVisibleTapCount": 0, "mean": None, "p50": None, "p95": None, "max": None, "unit": "screen-pixels-per-simulator-step"}
    return {
        "sharedNodeCount": int(shared.size),
        "sharedVisibleTapCount": int(displacement.size),
        "mean": float(np.mean(displacement)),
        "p50": float(np.percentile(displacement, 50)),
        "p95": float(np.percentile(displacement, 95)),
        "max": float(np.max(displacement)),
        "unit": "screen-pixels-per-simulator-step",
        "authority": "matched-native-node-flow-tangent-tap-centers-v0",
    }


def node_turnover(previous_ids: np.ndarray, current_ids: np.ndarray) -> dict[str, Any]:
    shared = np.intersect1d(previous_ids, current_ids, assume_unique=True)
    union_count = previous_ids.size + current_ids.size - shared.size
    return {
        "previousNodeCount": int(previous_ids.size),
        "currentNodeCount": int(current_ids.size),
        "sharedNodeCount": int(shared.size),
        "enteredNodeCount": int(current_ids.size - shared.size),
        "exitedNodeCount": int(previous_ids.size - shared.size),
        "unionNodeCount": int(union_count),
        "jaccard": float(shared.size / max(union_count, 1)),
        "turnoverFraction": float(1.0 - shared.size / max(union_count, 1)),
    }


def multiplicity_churn(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    shared, previous_rows, current_rows = np.intersect1d(
        previous["ids"], current["ids"], assume_unique=True, return_indices=True
    )
    previous_values = previous["multiplicity"][previous_rows]
    current_values = current["multiplicity"][current_rows]
    delta = np.abs(current_values.astype(np.int32) - previous_values.astype(np.int32))
    return {
        "depositRule": "five-flow-taps-times-four-bilinear-neighbors-clipped-to-frame-v0",
        "maximumDepositsPerCandidate": DEPOSITS_PER_CANDIDATE,
        "previousDepositCount": int(np.sum(previous["multiplicity"], dtype=np.int64)),
        "currentDepositCount": int(np.sum(current["multiplicity"], dtype=np.int64)),
        "sharedNodeCount": int(shared.size),
        "sharedNodesWithChangedMultiplicity": int(np.count_nonzero(delta)),
        "meanAbsoluteSharedNodeDepositDelta": float(np.mean(delta)) if delta.size else None,
        "maxAbsoluteSharedNodeDepositDelta": int(np.max(delta)) if delta.size else None,
        "authority": "actual-in-bounds-bilinear-deposit-count-v0",
    }


def validate_dynamic_hashes(target_hashes: set[str], render_hashes: set[str], state_count: int) -> None:
    require(len(target_hashes) == state_count, "cached-or-static-render: exact targets are duplicated")
    require(len(render_hashes) == state_count, "cached-or-static-render: bilinear renders are duplicated")


def self_test() -> None:
    turnover = node_turnover(
        np.asarray([1, 2, 3], dtype=np.uint32),
        np.asarray([2, 3, 4, 5], dtype=np.uint32),
    )
    require(turnover["sharedNodeCount"] == 2, "self-test node turnover shared count drifted")
    require(turnover["enteredNodeCount"] == 2, "self-test node turnover entered count drifted")
    require(turnover["exitedNodeCount"] == 1, "self-test node turnover exited count drifted")

    previous = {
        "ids": np.asarray([7, 9], dtype=np.uint32),
        "placements": np.asarray([
            [[1.0, 1.0], [2.0, 1.0]],
            [[4.0, 4.0], [5.0, 4.0]],
        ], dtype=np.float32),
        "multiplicity": np.asarray([8, 7], dtype=np.int16),
    }
    current = {
        "ids": np.asarray([7, 9], dtype=np.uint32),
        "placements": np.asarray([
            [[3.0, 1.0], [4.0, 1.0]],
            [[4.0, 6.0], [5.0, 6.0]],
        ], dtype=np.float32),
        "multiplicity": np.asarray([6, 10], dtype=np.int16),
    }
    velocity = placement_velocity(previous, current, 2)
    require(velocity["sharedVisibleTapCount"] == 4, "self-test placement visible tap count drifted")
    require(abs(float(velocity["mean"]) - 1.0) < 1e-6, "self-test placement velocity drifted")
    churn = multiplicity_churn(previous, current)
    require(churn["sharedNodesWithChangedMultiplicity"] == 2, "self-test multiplicity churn missed changes")
    require(abs(float(churn["meanAbsoluteSharedNodeDepositDelta"]) - 2.5) < 1e-6, "self-test multiplicity delta drifted")

    try:
        validate_dynamic_hashes({"target-a"}, {"render-a", "render-b"}, 2)
    except ValueError as error:
        require("exact targets are duplicated" in str(error), "self-test static target failure reason drifted")
    else:
        raise ValueError("self-test static target sequence was accepted")

    print("bilinear motion renderer self-test passed")


def sequence_viewer(rows: list[dict[str, Any]]) -> str:
    payload = json.dumps(rows, separators=(",", ":"))
    return f"""<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Exact Bilinear Motion Witness</title><style>
body{{margin:0;background:#0d1013;color:#f4f5f6;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}}header{{position:sticky;top:0;z-index:2;padding:12px;background:#15191d;border-bottom:1px solid #343a40;display:flex;gap:14px;align-items:center;flex-wrap:wrap}}button{{background:#222930;color:#fff;border:1px solid #46515b;padding:7px 12px}}input{{width:min(580px,60vw)}}main{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:10px}}figure{{margin:0;background:#15191d;border:1px solid #343a40}}figcaption{{padding:8px;color:#b8c0c8}}img{{display:block;width:100%;height:auto;image-rendering:auto}}pre{{white-space:pre-wrap;margin:0;padding:10px;border-top:1px solid #343a40;color:#b8c0c8}}@media(max-width:900px){{main{{grid-template-columns:1fr}}}}
</style></head><body><header><strong>Adjacent exact-state temporal witness</strong><button id=\"prev\">◀</button><input id=\"step\" type=\"range\" min=\"0\" max=\"{len(rows)-1}\" value=\"0\"><button id=\"next\">▶</button><span id=\"label\"></span></header><main><figure><figcaption>Exact target</figcaption><img id=\"target\"></figure><figure><figcaption>Frozen bilinear splats</figcaption><img id=\"splat\"></figure><figure><figcaption>Residual</figcaption><img id=\"residual\"><pre id=\"metrics\"></pre></figure></main><script>
const rows={payload};const slider=document.querySelector('#step');function show(index){{index=Math.max(0,Math.min(rows.length-1,index));slider.value=index;const row=rows[index];target.src=row.target;splat.src=row.splat;residual.src=row.residual;label.textContent=`${{row.stateId}} · step ${{row.steps}}`;metrics.textContent=JSON.stringify(row.metrics,null,2)}}slider.oninput=()=>show(+slider.value);prev.onclick=()=>show(+slider.value-1);next.onclick=()=>show(+slider.value+1);addEventListener('keydown',event=>{{if(event.key==='ArrowLeft')show(+slider.value-1);if(event.key==='ArrowRight')show(+slider.value+1)}});show(0);
</script></body></html>"""


def run(manifest_path: Path, out_dir: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text())
    require(manifest.get("schema") == MANIFEST_SCHEMA, f"manifest schema must be {MANIFEST_SCHEMA}")
    states = manifest.get("states")
    require(isinstance(states, list) and len(states) >= 2, "motion manifest requires at least two exact states")
    sequence = manifest.get("sequence") or {}
    require(sequence.get("sampleCap") is None, "motion manifest applied a hidden sample cap")
    require(sequence.get("droppedRowCount") == 0, "motion manifest dropped analytical candidates")
    require((manifest.get("transportEvaluation") or {}).get("depthBins") == DEPTH_BINS, "motion manifest depth-bin contract drifted")

    out_dir.mkdir(parents=True, exist_ok=True)
    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    final_state = states[-1]
    final_target = target_image(final_state, manifest_path)
    final_planes, final_telemetry, _ = raster_state(final_state, manifest_path)
    calibration = ORACLE.fit_optical_path_scale(final_planes, final_target)
    global_path_scale = float(calibration["pathScale"])
    del final_planes

    rendered_rows: list[dict[str, Any]] = []
    motion_rows: list[dict[str, Any]] = []
    target_hashes: set[str] = set()
    render_hashes: set[str] = set()
    previous: dict[str, Any] | None = None
    for state in states:
        state_id = str(state["id"])
        steps = int((state.get("replay") or {}).get("completedSteps"))
        target = target_image(state, manifest_path)
        planes, telemetry, rows = raster_state(state, manifest_path)
        linear, _, _, _ = ORACLE.compose_planes(planes, global_path_scale, "total")
        splat = ORACLE.tone_map(linear)
        residual = ORACLE.residual_heatmap(splat, target)
        del planes, linear

        target_hash = sha256_pixels(target)
        render_hash = sha256_pixels(splat)
        target_hashes.add(target_hash)
        render_hashes.add(render_hash)
        target_path = images_dir / f"{state_id}-target.png"
        splat_path = images_dir / f"{state_id}-splat.png"
        residual_path = images_dir / f"{state_id}-residual.png"
        ORACLE.write_png(target_path, target)
        ORACLE.write_png(splat_path, splat)
        ORACLE.write_png(residual_path, residual)

        camera = camera_contract(state)
        ids = np.asarray(rows["nativeCellIndices"], dtype=np.uint32).copy()
        placements = flow_tap_placements(rows, camera)
        multiplicity = bilinear_deposit_multiplicity(placements, camera["width"], camera["height"])
        estimated_dense_plane_bytes = DEPTH_BINS * camera["height"] * camera["width"] * 8 * np.dtype(np.float32).itemsize
        current = {
            "stateId": state_id,
            "steps": steps,
            "ids": ids,
            "placements": placements,
            "multiplicity": multiplicity,
            "target": target,
            "splat": splat,
            "error": splat.astype(np.float32) - target.astype(np.float32),
        }
        metrics = ORACLE.image_metrics(splat, target)
        rendered_rows.append({
            "stateId": state_id,
            "steps": steps,
            "rowCount": int(rows["count"]),
            "targetPixelSha256": target_hash,
            "renderPixelSha256": render_hash,
            "metrics": metrics,
            "rasterTelemetry": telemetry,
            "estimatedDensePlaneBytes": int(estimated_dense_plane_bytes),
            "images": {"target": str(target_path), "splat": str(splat_path), "residual": str(residual_path)},
        })
        if previous is not None:
            step_delta = steps - int(previous["steps"])
            turnover = node_turnover(previous["ids"], current["ids"])
            placement = placement_velocity(previous, current, step_delta)
            adjacent = {
                "fromStateId": previous["stateId"],
                "toStateId": state_id,
                "stepDelta": step_delta,
                "nodeIdentityTurnover": turnover,
                "multiplicityChurn": multiplicity_churn(previous, current),
                "placementVelocity": placement,
                "adjacentFramePixelDiffs": {
                    "targetMae": pixel_mae(previous["target"], target),
                    "splatMae": pixel_mae(previous["splat"], splat),
                    "motionDeltaMae": pixel_mae(
                        current["splat"].astype(np.int16) - previous["splat"].astype(np.int16),
                        current["target"].astype(np.int16) - previous["target"].astype(np.int16),
                    ),
                    "errorFieldDeltaMae": float(np.mean(np.abs(current["error"] - previous["error"])) / 255.0),
                },
            }
            adjacent["adjacentFramePixelDiffs"]["splatMinusTargetMotionMae"] = float(
                adjacent["adjacentFramePixelDiffs"]["splatMae"] - adjacent["adjacentFramePixelDiffs"]["targetMae"]
            )
            motion_rows.append(adjacent)
        previous = current

    validate_dynamic_hashes(target_hashes, render_hashes, len(states))

    viewer_rows = [
        {
            "stateId": row["stateId"],
            "steps": row["steps"],
            "target": str(Path(row["images"]["target"]).relative_to(out_dir)),
            "splat": str(Path(row["images"]["splat"]).relative_to(out_dir)),
            "residual": str(Path(row["images"]["residual"]).relative_to(out_dir)),
            "metrics": row["metrics"],
        }
        for row in rendered_rows
    ]
    viewer_path = out_dir / "sequence-viewer.html"
    viewer_path.write_text(sequence_viewer(viewer_rows))
    return {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "authority": "adjacent-exact-state-bilinear-motion-oracle-v0",
        "source": {"manifestPath": str(manifest_path), "manifestSha256": sha256_file(manifest_path)},
        "transport": {
            "flowTapOffsets": FLOW_TAP_OFFSETS,
            "flowTapWeights": FLOW_TAP_WEIGHTS,
            "depthBins": DEPTH_BINS,
            "globalPathScale": global_path_scale,
            "calibrationStateId": final_state["id"],
            "perStateRefit": False,
            "calibration": calibration,
            "calibrationRasterTelemetry": final_telemetry,
        },
        "states": rendered_rows,
        "adjacentStateMotion": motion_rows,
        "resourceDiagnostics": {
            "identity": "dense-depth-plane-allocation-diagnostic-v0",
            "depthBins": DEPTH_BINS,
            "channelsPerDepthBin": 8,
            "floatBytes": np.dtype(np.float32).itemsize,
            "maximumEstimatedDensePlaneBytes": max(row["estimatedDensePlaneBytes"] for row in rendered_rows),
            "sampleCap": None,
        },
        "sequenceViewer": str(viewer_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--manifest")
    parser.add_argument("--out-dir")
    parser.add_argument("--report")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    require(args.manifest is not None, "--manifest is required")
    require(args.out_dir is not None, "--out-dir is required")
    require(args.report is not None, "--report is required")
    manifest_path = Path(args.manifest).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    failure_phase = "manifest-validation"
    last_trustworthy_evidence: dict[str, Any] = {"manifestPath": str(manifest_path)}
    try:
        require(manifest_path.is_file(), f"manifest is missing: {manifest_path}")
        last_trustworthy_evidence["manifestSha256"] = sha256_file(manifest_path)
        failure_phase = "temporal-render"
        report = run(manifest_path, out_dir)
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"status": "complete", "reportPath": str(report_path), "sequenceViewer": report["sequenceViewer"]}, indent=2))
        return 0
    except Exception as error:
        failure = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": failure_phase,
            "reason": str(error),
            "lastTrustworthyEvidence": last_trustworthy_evidence,
            "traceback": traceback.format_exc(),
        }
        report_path.write_text(json.dumps(failure, indent=2) + "\n")
        print(json.dumps(failure, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
