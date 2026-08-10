#!/usr/bin/env python3
"""Replay the historical authored-envelope/Trellis registration under the current fit."""

import argparse
import hashlib
import importlib.util
import json
import math
import sys
import traceback
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


SOURCE_SHA256 = "cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e"
CAST_SHA256 = "372887134a3994e2d980f14419ef7bc8bdcbc36c275feaeeaf53c311fffcf24d"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_registration_module(root):
    path = root / "build_registration_witness.py"
    spec = importlib.util.spec_from_file_location("current_registration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def import_largest_mesh(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no mesh in {path}")
    return max(meshes, key=lambda obj: len(obj.data.vertices))


def render_views(module, root, target, envelope, target_points):
    target_mat = module.material("historical-cast", (0.10, 0.30, 0.34), metallic=0.05, roughness=0.48)
    envelope_mat = module.material("historical-envelope", (0.18, 0.90, 0.95), roughness=0.35)
    target.data.materials.clear()
    target.data.materials.append(target_mat)
    envelope.data.materials.clear()
    envelope.data.materials.append(envelope_mat)

    target_wire = target.modifiers.new("historical-cast-wire", "WIREFRAME")
    target_wire.thickness = max(np.ptp(target_points, axis=0)) * 0.0015
    target_wire.use_replace = True
    envelope_wire = envelope.modifiers.new("historical-envelope-wire", "WIREFRAME")
    envelope_wire.thickness = max(np.ptp(target_points, axis=0)) * 0.0025
    envelope_wire.use_replace = True

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("historical-registration-world")
    scene.world.color = (0.012, 0.015, 0.017)

    camera_data = bpy.data.cameras.new("historical-registration-camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("historical-registration-camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    center = target_points.mean(axis=0)
    span = float(max(np.ptp(target_points, axis=0)))
    camera_data.ortho_scale = span * 1.28
    output_dir = root / "historical-registration"
    output_dir.mkdir(parents=True, exist_ok=True)
    views = []
    for azimuth in (0, 45, 135):
        radians = math.radians(azimuth)
        camera.location = center + Vector(
            (math.cos(radians) * span * 2.4, math.sin(radians) * span * 2.4, math.sin(math.radians(10)) * span * 2.4)
        )
        module.aim_camera(camera, center)
        relative = Path("historical-registration") / f"az{azimuth:03d}-el10.png"
        scene.render.filepath = str(root / relative)
        bpy.ops.render.render(write_still=True)
        views.append(str(relative))
    return views


def run(args):
    repo_root = args.repo_root.resolve()
    root = args.artifact_root.resolve()
    historical_relative = Path("artifacts") / "authored-envelope-v0" / "recon-trellis-maquette"
    historical = repo_root / historical_relative
    source_path = historical / "AUTHORED-ENVELOPE-for-comparison.glb"
    cast_path = historical / "output.glb"
    if sha256(source_path) != SOURCE_SHA256 or sha256(cast_path) != CAST_SHA256:
        raise RuntimeError("historical source or cast hash does not match the admitted pair")

    module = load_registration_module(root)
    source = import_largest_mesh(source_path)
    source_points, source_faces = module.evaluated_world_mesh(source)
    target = import_largest_mesh(cast_path)
    target_points, _ = module.evaluated_world_mesh(target)
    fit = module.fit_global_similarity(source_points, target_points)
    envelope = module.make_mesh_object(
        "historical-authored-envelope",
        module.transform_points(source_points, fit),
        source_faces,
    )
    views = render_views(module, root, target, envelope, target_points)

    matrix = np.eye(4)
    matrix[:3, :3] = fit["scale"] * fit["rotation"]
    matrix[:3, 3] = fit["translation"]
    result = {
        "schema": "kaminos.historical-registration-witness.v0",
        "source": {"path": str(source_path.relative_to(repo_root)), "sha256": SOURCE_SHA256},
        "cast": {"path": str(cast_path.relative_to(repo_root)), "sha256": CAST_SHA256},
        "method": {
            "transformClass": "global_similarity",
            "allowsLocalDeformation": False,
            "allowsAnatomicalLandmarkEditing": False,
            "comparisonLimit": "Historical and current prompts differ, so this cannot isolate source revision causally.",
        },
        "fit": {
            "sampleCount": len(source_points),
            "scale": fit["scale"],
            "medianDistance": fit["medianDistance"],
            "p90Distance": fit["p90Distance"],
            "normalizedMedianDistance": fit["normalizedMedianDistance"],
            "normalizedP90Distance": fit["normalizedP90Distance"],
            "matrix": matrix.tolist(),
        },
        "views": views,
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")


def main():
    args = parse_args()
    failure = args.output.with_name("historical-registration-failure.json")
    try:
        run(args)
        failure.unlink(missing_ok=True)
    except Exception as exc:
        failure.write_text(
            json.dumps(
                {
                    "schema": "kaminos.historical-registration-failure.v0",
                    "phase": "historical-registration-witness",
                    "error": repr(exc),
                    "traceback": traceback.format_exc(),
                },
                indent=2,
            )
            + "\n"
        )
        raise


if __name__ == "__main__":
    main()
