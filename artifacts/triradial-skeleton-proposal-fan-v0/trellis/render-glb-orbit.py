"""Render a source-bound orbit of a reconstructed GLB for topology inspection."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector


SCHEMA = "kaminos.triradial-glb-orbit.v0"
FAILURE_SCHEMA = "kaminos.triradial-glb-orbit-failure.v0"
WORLD_UP = Vector((0.0, 0.0, 1.0))


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--azimuths", default="0,60,120,180,240,300")
    parser.add_argument("--elevation", type=float, default=12.0)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(argv)


def _sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _orient_camera(camera: bpy.types.Object, target: Vector) -> None:
    back = (camera.location - target).normalized()
    projected_up = WORLD_UP - back * WORLD_UP.dot(back)
    if projected_up.length < 1e-6:
        raise ValueError("camera is parallel to world up")
    up = projected_up.normalized()
    right = up.cross(back).normalized()
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = Matrix((right, up, back)).transposed().to_quaternion()


def main() -> int:
    args = _arguments()
    failure = Path(args.failure)
    failure.unlink(missing_ok=True)

    glb = Path(args.glb).resolve()
    if not glb.is_file():
        raise ValueError(f"GLB not found: {glb}")
    actual_sha = _sha256(glb)
    if actual_sha != args.expected_sha256:
        raise ValueError(
            f"GLB SHA-256 mismatch: expected {args.expected_sha256}, got {actual_sha}"
        )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise ValueError("imported GLB contains no mesh objects")

    corners: list[Vector] = []
    for obj in meshes:
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    low = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    high = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    center = (low + high) * 0.5
    diagonal = (high - low).length

    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Tripodal GLB Orbit World")
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.018, 0.022, 0.021)
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.018, 0.022, 0.021)

    camera_data = bpy.data.cameras.new("Tripodal GLB Orbit Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Tripodal GLB Orbit Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    azimuths = [float(value.strip()) for value in args.azimuths.split(",") if value.strip()]
    elevation = math.radians(args.elevation)
    radius = diagonal * 1.8
    horizontal_radius = math.cos(elevation) * radius
    vertical_offset = math.sin(elevation) * radius
    outputs = []

    for azimuth_degrees in azimuths:
        azimuth = math.radians(azimuth_degrees)
        camera.location = center + Vector(
            (
                math.cos(azimuth) * horizontal_radius,
                math.sin(azimuth) * horizontal_radius,
                vertical_offset,
            )
        )
        _orient_camera(camera, center)
        bpy.context.view_layer.update()

        inverse = camera.matrix_world.inverted()
        camera_corners = [inverse @ corner for corner in corners]
        width = max(point.x for point in camera_corners) - min(point.x for point in camera_corners)
        height = max(point.y for point in camera_corners) - min(point.y for point in camera_corners)
        camera.data.ortho_scale = max(height, width) * 1.10

        label = f"az{int(round(azimuth_degrees)):03d}-el{int(round(args.elevation)):02d}"
        output = out_dir / f"{label}.png"
        output.unlink(missing_ok=True)
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        if not output.is_file() or output.stat().st_size < 4096:
            raise ValueError(f"rendered view is missing or implausibly small: {output}")
        outputs.append(
            {
                "label": label,
                "azimuthDegrees": azimuth_degrees,
                "elevationDegrees": args.elevation,
                "cameraLocation": list(camera.location),
                "orthoScale": camera.data.ortho_scale,
                "path": str(output),
                "byteLength": output.stat().st_size,
                "sha256": _sha256(output),
            }
        )

    _write_json(
        args.manifest,
        {
            "schema": SCHEMA,
            "status": "completed",
            "glb": {"path": str(glb), "sha256": actual_sha},
            "meshCount": len(meshes),
            "totalVertexCount": sum(len(obj.data.vertices) for obj in meshes),
            "bounds": {"low": list(low), "high": list(high)},
            "effectiveRoute": {
                "blenderVersion": bpy.app.version_string,
                "renderEngine": scene.render.engine,
                "projection": "orthographic",
                "colorType": scene.display.shading.color_type,
            },
            "outputs": outputs,
        },
    )
    print(json.dumps({"status": "completed", "outputCount": len(outputs)}))
    return 0


if __name__ == "__main__":
    parsed: argparse.Namespace | None = None
    try:
        parsed = _arguments()
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        failure_path = parsed.failure if parsed else os.environ.get("KAMINOS_TRIRADIAL_GLB_FAILURE")
        if failure_path:
            _write_json(
                failure_path,
                {
                    "schema": FAILURE_SCHEMA,
                    "status": "failed",
                    "failurePhase": "glb-orbit-render",
                    "error": str(error),
                    "lastTrustworthyEvidence": "requested GLB path parsed; no complete orbit admitted",
                },
            )
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
