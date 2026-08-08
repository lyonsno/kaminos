"""Render source-hashed oblique views of the authored tri-radial skeleton.

This is a fixture-local diagnostic renderer. It opens the operator-authored
scene read-only, renders every non-empty mesh, and records the effective camera
and output identities. It never saves or mutates the source blend file.
"""

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


SCHEMA = "kaminos.triradial-oblique-source-sweep.v0"
FAILURE_SCHEMA = "kaminos.triradial-oblique-source-sweep-failure.v0"
DORSAL = Vector((0.0, 0.0, -1.0))


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--azimuths", default="0,30,60,90,120,150")
    parser.add_argument("--elevation", type=float, default=18.0)
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
    projected_up = DORSAL - back * DORSAL.dot(back)
    if projected_up.length < 1e-6:
        raise ValueError("camera is parallel to the anatomical dorsal axis")
    up = projected_up.normalized()
    right = up.cross(back).normalized()
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = Matrix((right, up, back)).transposed().to_quaternion()


def main() -> int:
    args = _arguments()
    failure = Path(args.failure)
    failure.unlink(missing_ok=True)

    source = Path(bpy.data.filepath).resolve()
    actual_source_sha = _sha256(source)
    if source != Path(args.source).resolve():
        raise ValueError(f"opened source differs from requested source: {source}")
    if actual_source_sha != args.expected_source_sha256:
        raise ValueError("source SHA-256 mismatch")

    meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and len(obj.data.vertices) > 0 and obj.dimensions.length > 1e-6
    ]
    if not meshes:
        raise ValueError("source scene contains no non-empty mesh objects")
    for obj in bpy.context.scene.objects:
        obj.hide_render = obj not in meshes

    depsgraph = bpy.context.evaluated_depsgraph_get()
    corners: list[Vector] = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        corners.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    low = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    high = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    center = (low + high) * 0.5
    diagonal = (high - low).length

    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Tri-radial Source World")
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.018, 0.022, 0.021)
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.80, 0.75, 0.62)
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.018, 0.022, 0.021)

    camera_data = bpy.data.cameras.new("Tri-radial Sweep Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Tri-radial Sweep Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    azimuths = [float(value.strip()) for value in args.azimuths.split(",") if value.strip()]
    elevation = math.radians(args.elevation)
    outputs = []
    horizontal_radius = math.cos(elevation) * diagonal * 1.8
    dorsal_offset = math.sin(elevation) * diagonal * 1.8

    for azimuth_degrees in azimuths:
        azimuth = math.radians(azimuth_degrees)
        horizontal = Vector((math.cos(azimuth), math.sin(azimuth), 0.0))
        camera.location = center + horizontal * horizontal_radius + DORSAL * dorsal_offset
        _orient_camera(camera, center)
        bpy.context.view_layer.update()

        inverse = camera.matrix_world.inverted()
        camera_corners = [inverse @ corner for corner in corners]
        width = max(p.x for p in camera_corners) - min(p.x for p in camera_corners)
        height = max(p.y for p in camera_corners) - min(p.y for p in camera_corners)
        camera.data.ortho_scale = max(height, width) * 1.10

        label = f"az{int(round(azimuth_degrees)):03d}-el{int(round(args.elevation)):02d}"
        output = out_dir / f"{label}.png"
        output.unlink(missing_ok=True)
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        if not output.is_file() or output.stat().st_size < 4096:
            raise ValueError(f"rendered plate is missing or implausibly small: {output}")
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
            "source": {"path": str(source), "sha256": actual_source_sha},
            "effectiveRoute": {
                "blenderVersion": bpy.app.version_string,
                "renderEngine": scene.render.engine,
                "projection": "orthographic",
                "anatomicalDorsal": list(DORSAL),
                "singleColor": list(scene.display.shading.single_color),
            },
            "meshCount": len(meshes),
            "meshNames": [obj.name for obj in meshes],
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
        failure_path = parsed.failure if parsed else os.environ.get("KAMINOS_TRIRADIAL_FAILURE")
        if failure_path:
            _write_json(
                failure_path,
                {
                    "schema": FAILURE_SCHEMA,
                    "status": "failed",
                    "failurePhase": "oblique-source-sweep",
                    "error": str(error),
                    "lastTrustworthyEvidence": "source opened; no complete sweep admitted",
                },
            )
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
