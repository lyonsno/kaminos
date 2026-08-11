#!/usr/bin/env python3
"""Render one SHA-bound diagnostic view of a dense GLB using CPU Cycles."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


WORLD_UP = Vector((0.0, 0.0, 1.0))


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--azimuth", type=float, default=30.0)
    parser.add_argument("--elevation", type=float, default=12.0)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(argv)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def orient_camera(camera: bpy.types.Object, target: Vector) -> None:
    back = (camera.location - target).normalized()
    projected_up = WORLD_UP - back * WORLD_UP.dot(back)
    up = projected_up.normalized()
    right = up.cross(back).normalized()
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = Matrix((right, up, back)).transposed().to_quaternion()


def main() -> int:
    args = arguments()
    glb = Path(args.glb).resolve()
    output = Path(args.output).resolve()
    manifest = Path(args.manifest).resolve()
    failure = Path(args.failure).resolve()
    for prior_artifact in (output, manifest, failure):
        prior_artifact.unlink(missing_ok=True)

    if not glb.is_file():
        raise FileNotFoundError(glb)
    actual_sha = sha256(glb)
    if actual_sha != args.expected_sha256:
        raise ValueError(f"GLB SHA mismatch: expected {args.expected_sha256}, got {actual_sha}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("imported GLB contains no mesh objects")

    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    high = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    center = (low + high) * 0.5
    diagonal = (high - low).length

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 8
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.exposure = -1.5
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Dense geometry diagnostic world")
    scene.world.color = (0.025, 0.025, 0.025)

    material = bpy.data.materials.new("Dense geometry diagnostic clay")
    material.use_nodes = True
    material.diffuse_color = (0.18, 0.22, 0.24, 1.0)
    material.roughness = 0.78
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.18, 0.22, 0.24, 1.0)
    principled.inputs["Roughness"].default_value = 0.78
    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(material)

    for name, location, energy, size in (
        ("Key", center + Vector((diagonal, -diagonal, diagonal)), 500.0, diagonal),
        ("Fill", center + Vector((-diagonal, -0.5 * diagonal, 0.4 * diagonal)), 200.0, diagonal),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        light.location = location
        scene.collection.objects.link(light)
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("Dense geometry diagnostic camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Dense geometry diagnostic camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    azimuth = math.radians(args.azimuth)
    elevation = math.radians(args.elevation)
    radius = diagonal * 1.8
    camera.location = center + Vector(
        (
            math.cos(azimuth) * math.cos(elevation) * radius,
            math.sin(azimuth) * math.cos(elevation) * radius,
            math.sin(elevation) * radius,
        )
    )
    orient_camera(camera, center)
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    camera_corners = [inverse @ corner for corner in corners]
    width = max(point.x for point in camera_corners) - min(point.x for point in camera_corners)
    height = max(point.y for point in camera_corners) - min(point.y for point in camera_corners)
    camera.data.ortho_scale = max(width, height) * 1.10

    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    if not output.is_file() or output.stat().st_size < 4096:
        raise RuntimeError("rendered frame is missing or implausibly small")

    write_json(
        manifest,
        {
            "schema": "kaminos.dense-glb-cpu-render.v1",
            "status": "completed",
            "source": {"path": str(glb), "sha256": actual_sha},
            "geometry": {
                "meshCount": len(meshes),
                "vertexCount": sum(len(obj.data.vertices) for obj in meshes),
                "polygonCount": sum(len(obj.data.polygons) for obj in meshes),
                "bounds": {"low": list(low), "high": list(high)},
            },
            "effectiveRoute": {
                "blenderVersion": bpy.app.version_string,
                "engine": scene.render.engine,
                "cyclesDevice": scene.cycles.device,
                "samples": scene.cycles.samples,
                "resolution": [scene.render.resolution_x, scene.render.resolution_y],
                "projection": "orthographic",
                "azimuthDegrees": args.azimuth,
                "elevationDegrees": args.elevation,
            },
            "output": {
                "path": str(output),
                "bytes": output.stat().st_size,
                "sha256": sha256(output),
            },
        },
    )
    print(json.dumps({"status": "completed", "output": str(output)}))
    return 0


if __name__ == "__main__":
    parsed = None
    try:
        parsed = arguments()
        exit_code = main()
    except Exception as error:
        failure_path = Path(parsed.failure).resolve() if parsed else None
        if failure_path:
            write_json(
                failure_path,
                {
                    "schema": "kaminos.dense-glb-cpu-render-failure.v1",
                    "status": "failed",
                    "failurePhase": "dense-glb-cpu-render",
                    "lastTrustworthyEvidence": "requested source and render route parsed",
                    "error": {
                        "type": type(error).__name__,
                        "message": str(error),
                        "traceback": traceback.format_exc(),
                    },
                },
            )
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        os._exit(1)
    if exit_code:
        raise SystemExit(exit_code)
