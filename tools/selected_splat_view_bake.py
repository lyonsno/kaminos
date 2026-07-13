#!/usr/bin/env python3
"""Bake and compose view-local per-splat normal layers for Kaminos."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

import numpy as np


LAYER_SCHEMA = "kaminos.selected-view-pbr-layer.v0"
ADAPTER_REPORT_SCHEMA = "kaminos.selected-splat-view-bake-adapter-report.v0"


def project_positions(positions, view, projection, width, height):
    """Project asset-local positions to top-left-origin image pixels."""
    positions = np.asarray(positions, dtype=np.float32)
    view = np.asarray(view, dtype=np.float32).reshape(4, 4)
    projection = np.asarray(projection, dtype=np.float32).reshape(4, 4)
    points = np.concatenate(
        [positions, np.ones((positions.shape[0], 1), dtype=np.float32)], axis=1
    )
    clip = (projection @ view @ points.T).T
    clip_w = clip[:, 3]
    visible = clip_w > 1e-4
    safe_w = np.where(visible, clip_w, 1.0)
    ndc = clip[:, :3] / safe_w[:, None]
    visible &= np.all(np.isfinite(ndc), axis=1)
    visible &= (ndc[:, 0] >= -1.0) & (ndc[:, 0] <= 1.0)
    visible &= (ndc[:, 1] >= -1.0) & (ndc[:, 1] <= 1.0)
    visible &= (ndc[:, 2] >= -1.0) & (ndc[:, 2] <= 1.0)
    pixel_x = (ndc[:, 0] * 0.5 + 0.5) * float(width)
    pixel_y = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * float(height)
    return np.stack([pixel_x, pixel_y], axis=1), visible


def _normalize_vectors(vectors, fallback=None):
    result = np.asarray(vectors, dtype=np.float32).copy()
    lengths = np.linalg.norm(result, axis=1, keepdims=True)
    valid = np.isfinite(lengths[:, 0]) & (lengths[:, 0] > 1e-8)
    result[valid] /= lengths[valid]
    if fallback is None:
        result[~valid] = np.array([0.0, 0.0, 1.0], dtype=np.float32)
    else:
        result[~valid] = np.asarray(fallback, dtype=np.float32)[~valid]
    return result


def compose_material_layers(base, layers):
    """Sequentially blend enabled layer payloads over base per-splat material data."""
    result = {key: np.asarray(value, dtype=np.float32).copy() for key, value in base.items()}
    for layer in layers:
        if layer.get("enabled", True) is False:
            continue
        strength = float(np.clip(layer.get("strength", 1.0), 0.0, 1.0))
        coverage = np.asarray(layer.get("coverage"), dtype=np.float32)
        weight = np.clip(coverage * strength, 0.0, 1.0)
        for channel in ("roughness", "metallic"):
            if channel not in layer or channel not in result:
                continue
            result[channel] = (
                result[channel] * (1.0 - weight)
                + np.asarray(layer[channel], dtype=np.float32) * weight
            )
        if "normals" in layer and "normals" in result:
            normal_weight = weight[:, None]
            blended = (
                result["normals"] * (1.0 - normal_weight)
                + np.asarray(layer["normals"], dtype=np.float32) * normal_weight
            )
            result["normals"] = _normalize_vectors(blended, result["normals"])
    return result


def _matrix_from_three(values):
    values = np.asarray(values, dtype=np.float32)
    if values.size != 16:
        raise ValueError("camera matrix must contain 16 values")
    return values.reshape(4, 4).T


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def _emit_progress(phase, message, progress):
    if os.environ.get("KAMINOS_PIPELINE_PROGRESS_STREAM") != "1":
        return
    print(json.dumps({
        "schema": "kaminos.pipeline-progress.v0",
        "kind": "adapter-progress",
        "phase": phase,
        "message": message,
        "status": "running",
        "progress": progress,
    }), flush=True)


def _load_request_context():
    paths = json.loads(os.environ.get("KAMINOS_PIPELINE_ARTIFACT_PATHS", "{}"))
    context_path = paths.get("requestContext")
    if not context_path or not Path(context_path).is_file():
        raise FileNotFoundError("selected-view bake requestContext artifact is missing")
    return json.loads(Path(context_path).read_text()), Path(context_path)


def _renderer_root():
    configured = os.environ.get("KAMINOS_MESHSPLAT_RENDERER_ROOT")
    candidates = [
        Path(configured).expanduser() if configured else None,
        Path.home() / "dev" / "hybrid-differentiable-defferred-splat-mesh-renderer",
    ]
    for candidate in candidates:
        if candidate and (candidate / "preprocessing" / "splat_oracle").is_dir():
            return candidate.resolve()
    raise FileNotFoundError("MeshSplat renderer preprocessing package was not found")


def _load_selected_view(input_path, context, image_path):
    renderer_root = _renderer_root()
    sys.path.insert(0, str(renderer_root / "preprocessing"))
    from splat_oracle.loader import load_ply

    camera = context.get("camera") or {}
    view_values = camera.get("sourceAssetViewMatrix")
    projection_values = camera.get("projectionMatrix")
    viewport = camera.get("viewport") or {}
    if not view_values or not projection_values:
        raise ValueError("request camera lacks sourceAssetViewMatrix or projectionMatrix")
    width = int(viewport.get("width") or 0)
    height = int(viewport.get("height") or 0)
    if width <= 0 or height <= 0:
        raise ValueError("request camera viewport must have positive width and height")

    view = _matrix_from_three(view_values)
    projection = _matrix_from_three(projection_values)
    capture = context.get("sourceViewCapture") or {}
    capture_path = Path(str(capture.get("path") or "")).expanduser()
    if not capture_path.is_file():
        raise FileNotFoundError("request context lacks a readable sourceViewCapture")
    from PIL import Image
    image_path.parent.mkdir(parents=True, exist_ok=True)
    Image.open(capture_path).convert("RGB").save(image_path)
    return load_ply(input_path), view, projection


def _run_lotus(image_path, normal_map_path):
    lotus_dir = Path(os.environ.get("KAMINOS_LOTUS_DIR", Path.home() / "dev" / "Lotus")).expanduser()
    lotus_python = Path(os.environ.get("KAMINOS_LOTUS_PYTHON", lotus_dir / ".venv" / "bin" / "python")).expanduser()
    if not lotus_python.is_file():
        raise FileNotFoundError(f"Lotus Python is missing: {lotus_python}")
    device = os.environ.get("KAMINOS_LOTUS_DEVICE", "mps")
    code = r'''
import sys
import numpy as np
import torch
from PIL import Image
from pipeline import LotusDPipeline

source, output, device = sys.argv[1:4]
image = Image.open(source).convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
array = np.asarray(image)
model = LotusDPipeline.from_pretrained(
    "jingheya/lotus-normal-d-v1-1", torch_dtype=torch.float32
).to(device)
model.set_progress_bar_config(disable=True)
rgb = torch.from_numpy(array.copy()).permute(2, 0, 1).unsqueeze(0).float() / 127.5 - 1.0
rgb = rgb.to(device)
task = torch.tensor([1, 0]).float().unsqueeze(0).to(device)
task = torch.cat([torch.sin(task), torch.cos(task)], dim=-1)
with torch.no_grad():
    pred = model(
        rgb_in=rgb,
        prompt="",
        num_inference_steps=1,
        generator=None,
        output_type="np",
        timesteps=[999],
        task_emb=task,
        processing_res=0,
    ).images[0]
normals = pred * 2.0 - 1.0
normals /= np.maximum(np.linalg.norm(normals, axis=2, keepdims=True), 1e-8)
np.save(output, normals.astype(np.float32))
'''
    result = subprocess.run(
        [str(lotus_python), "-c", code, str(image_path), str(normal_map_path), device],
        cwd=str(lotus_dir),
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Lotus-D inference failed: {result.stderr[-2000:]}")
    return np.load(normal_map_path)


def _sample_normal_layer(cloud, view, projection, normal_map):
    height, width = normal_map.shape[:2]
    uv, visible = project_positions(cloud.positions, view, projection, width, height)
    pixel_x = np.clip(np.rint(uv[:, 0]).astype(np.int64), 0, width - 1)
    pixel_y = np.clip(np.rint(uv[:, 1]).astype(np.int64), 0, height - 1)

    points = np.concatenate(
        [cloud.positions, np.ones((cloud.num_points, 1), dtype=np.float32)], axis=1
    )
    camera_points = (view @ points.T).T
    depth = -camera_points[:, 2]
    visible &= depth > 1e-4
    linear_pixel = pixel_y * width + pixel_x
    nearest_depth = np.full(width * height, np.inf, dtype=np.float32)
    np.minimum.at(nearest_depth, linear_pixel[visible], depth[visible])
    surface = visible & (depth <= nearest_depth[linear_pixel] * 1.01 + 1e-4)
    coverage = surface.astype(np.float32)

    camera_normals = normal_map[pixel_y, pixel_x]
    asset_normals = (view[:3, :3].T @ camera_normals.T).T
    asset_normals = _normalize_vectors(asset_normals)
    asset_normals[~surface] = 0.0
    return asset_normals.astype(np.float32), coverage.astype(np.float32)


def bake_layer(input_path, output_path, report_path):
    context, context_path = _load_request_context()
    output_path = Path(output_path)
    report_path = Path(report_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image_path = output_path.with_suffix(".source-view.png")
    normal_map_path = output_path.with_suffix(".lotus-normal.npy")
    _emit_progress("selected-view:render", "Rendering selected splat from the effective Kaminos camera", 0.1)
    cloud, view, projection = _load_selected_view(Path(input_path), context, image_path)
    _emit_progress("selected-view:lotus", "Running Lotus-D normal inference", 0.35)
    normal_map = _run_lotus(image_path, normal_map_path)
    _emit_progress("selected-view:project", "Projecting Lotus-D normals back to covered splats", 0.85)
    normals, coverage = _sample_normal_layer(cloud, view, projection, normal_map)
    np.savez_compressed(
        output_path,
        schema=np.asarray(LAYER_SCHEMA),
        channels=np.asarray(["normal"]),
        normals=normals,
        coverage=coverage,
        vertex_count=np.asarray(cloud.num_points, dtype=np.int64),
    )
    report = {
        "schema": ADAPTER_REPORT_SCHEMA,
        "ok": True,
        "backend": {
            "modelFamily": "Lotus-D",
            "runtime": "local-mps-subprocess",
            "repo": str(Path(os.environ.get("KAMINOS_LOTUS_DIR", Path.home() / "dev" / "Lotus")).expanduser()),
        },
        "input": {"path": str(input_path), "sha256": _sha256(input_path)},
        "requestContext": {"path": str(context_path), "sha256": _sha256(context_path)},
        "output": {"path": str(output_path), "sha256": _sha256(output_path)},
        "channels": ["normal"],
        "coverage": {
            "coveredSplats": int(np.count_nonzero(coverage)),
            "totalSplats": int(cloud.num_points),
            "max": float(coverage.max(initial=0.0)),
        },
        "frameContract": {
            "projection": "host-projection-times-effective-asset-to-camera-view",
            "imageOrigin": "top-left",
            "lotusNormalConvention": "camera-space-x-right-y-up-z-toward-camera",
            "outputNormalFrame": "raw-asset-local",
            "verticalFlip": "none-beyond-standard-ndc-to-top-left-image-mapping",
        },
        "sideArtifacts": [
            {"id": "sourceView", "role": "selected-splat-source-view", "path": str(image_path)},
            {"id": "normalMap", "role": "lotus-normal-map-npy", "path": str(normal_map_path)},
        ],
    }
    _write_json(report_path, report)
    _emit_progress("selected-view:complete", "Per-splat normal layer written", 1.0)


def _base_material(vertex):
    names = set(vertex.data.dtype.names)
    positions = np.stack([vertex["x"], vertex["y"], vertex["z"]], axis=1).astype(np.float32)
    if {"nx", "ny", "nz"}.issubset(names):
        normals = np.stack([vertex["nx"], vertex["ny"], vertex["nz"]], axis=1).astype(np.float32)
        normals = _normalize_vectors(normals)
    else:
        normals = _normalize_vectors(positions - positions.mean(axis=0, keepdims=True))
    roughness = np.asarray(vertex["roughness"], dtype=np.float32) if "roughness" in names else np.full(len(vertex), 0.5, dtype=np.float32)
    metallic = np.asarray(vertex["metallic"], dtype=np.float32) if "metallic" in names else np.zeros(len(vertex), dtype=np.float32)
    return {"normals": normals, "roughness": roughness, "metallic": metallic}


def _write_composed_ply(source_path, output_path, material):
    from plyfile import PlyData, PlyElement
    source = PlyData.read(str(source_path))
    vertex = source["vertex"]
    names = set(vertex.data.dtype.names)
    additions = [(name, "f4") for name in ("nx", "ny", "nz", "roughness", "metallic") if name not in names]
    data = np.empty(len(vertex), dtype=np.dtype(list(vertex.data.dtype.descr) + additions))
    for name in vertex.data.dtype.names:
        data[name] = vertex[name]
    data["nx"], data["ny"], data["nz"] = material["normals"].T
    data["roughness"] = np.clip(material["roughness"], 0.0, 1.0)
    data["metallic"] = np.clip(material["metallic"], 0.0, 1.0)
    elements = [PlyElement.describe(data, "vertex")]
    elements.extend(element for element in source.elements if element.name != "vertex")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    PlyData(elements, text=False).write(str(output_path))


def compose_layers(input_path, output_path, layers_json, report_path=None):
    from plyfile import PlyData
    source = PlyData.read(str(input_path))
    base = _base_material(source["vertex"])
    layer_specs = json.loads(layers_json)
    layers = []
    for spec in layer_specs:
        with np.load(spec["path"], allow_pickle=False) as payload:
            vertex_count = int(payload["vertex_count"])
            if vertex_count != len(source["vertex"]):
                raise ValueError(f"layer vertex count {vertex_count} does not match source {len(source['vertex'])}")
            layer = {
                "enabled": spec.get("enabled", True),
                "strength": spec.get("strength", 1.0),
                "coverage": payload["coverage"],
            }
            for channel in ("normals", "roughness", "metallic"):
                if channel in payload.files:
                    layer[channel] = payload[channel]
            layers.append(layer)
    composed = compose_material_layers(base, layers)
    _write_composed_ply(input_path, output_path, composed)
    if report_path:
        _write_json(report_path, {
            "schema": "kaminos.selected-splat-bake-composite-report.v0",
            "ok": True,
            "source": str(input_path),
            "output": str(output_path),
            "layerCount": len(layers),
            "outputSha256": _sha256(output_path),
        })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report")
    parser.add_argument("--compose-layers")
    args = parser.parse_args()
    try:
        if args.compose_layers is not None:
            compose_layers(args.input, args.output, args.compose_layers, args.report)
        else:
            if not args.report:
                raise ValueError("--report is required for a model bake")
            bake_layer(args.input, args.output, args.report)
    except Exception as error:
        if args.report:
            _write_json(args.report, {
                "schema": ADAPTER_REPORT_SCHEMA,
                "ok": False,
                "failurePhase": "compose" if args.compose_layers is not None else "selected-view-bake",
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
        raise


if __name__ == "__main__":
    main()
