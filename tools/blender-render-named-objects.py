"""Render a named subset of a Blender scene through the campaign's canonical camera.

Used to render an authored envelope in isolation, on the same right-sagittal
orthographic construction as every other conditioning plate, so the resulting
plate is directly comparable with the compiled-envelope and ecorche plates.

Never mutates, saves, exports over, or relinks the operator's source.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector

SCHEMA = "kaminos.named-object-render.v0"
FAILURE_SCHEMA = "kaminos.named-object-render-failure.v0"
RENDERER_ID = "blender-named-object-right-sagittal-v0"
ANATOMICAL_RIGHT = Vector((1.0, 0.0, 0.0))
ANATOMICAL_DORSAL = Vector((0.0, 0.0, -1.0))


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--objects", required=True, help="comma-separated object names")
    parser.add_argument("--out", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
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


def _orient_camera(camera, target: Vector, image_up: Vector) -> None:
    back = (camera.location - target).normalized()
    projected = image_up - back * image_up.dot(back)
    if projected.length < 1e-6:
        raise ValueError("camera image-up axis is parallel to its view direction")
    up = projected.normalized()
    right = up.cross(back).normalized()
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = Matrix((right, up, back)).transposed().to_quaternion()


def main() -> int:
    args = _arguments()
    Path(args.failure).unlink(missing_ok=True)

    source = Path(bpy.data.filepath).resolve()
    if _sha256(source) != args.expected_source_sha256:
        raise ValueError("source SHA-256 mismatch")

    wanted = [n.strip() for n in args.objects.split(",") if n.strip()]
    targets = []
    for name in wanted:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise ValueError(f"requested object is not in the scene: {name}")
        targets.append(obj)

    for obj in bpy.context.scene.objects:
        obj.hide_render = obj.name not in wanted
    for obj in targets:
        obj.hide_render = False

    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Render World")
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.018, 0.022, 0.021)
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.70, 0.76, 0.67)
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.018, 0.022, 0.021)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    corners = []
    for obj in targets:
        evaluated = obj.evaluated_get(depsgraph)
        corners.extend(evaluated.matrix_world @ Vector(c) for c in evaluated.bound_box)
    low = Vector((min(c[i] for c in corners) for i in range(3)))
    high = Vector((max(c[i] for c in corners) for i in range(3)))
    center = (low + high) * 0.5
    diagonal = (high - low).length

    camera_data = bpy.data.cameras.new("Plate Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Plate Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = center + ANATOMICAL_RIGHT * diagonal * 1.8
    _orient_camera(camera, center, ANATOMICAL_DORSAL)
    bpy.context.view_layer.update()

    inverse = camera.matrix_world.inverted()
    cam_corners = [inverse @ c for c in corners]
    width = max(p.x for p in cam_corners) - min(p.x for p in cam_corners)
    height = max(p.y for p in cam_corners) - min(p.y for p in cam_corners)
    aspect = scene.render.resolution_x / scene.render.resolution_y
    camera.data.ortho_scale = max(height, width / aspect) * 1.12

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    if not out.is_file() or out.stat().st_size < 4096:
        raise ValueError("rendered plate is missing or implausibly small")

    _write_json(args.manifest, {
        "schema": SCHEMA,
        "rendererId": RENDERER_ID,
        "status": "completed",
        "source": {"path": str(source), "sha256": args.expected_source_sha256},
        "renderedObjects": [
            {"name": o.name, "vertexCount": len(o.data.vertices)} for o in targets
        ],
        "effectiveRoute": {
            "blenderVersion": bpy.app.version_string,
            "renderEngine": scene.render.engine,
            "cameraView": "right-sagittal",
            "anatomicalRight": list(ANATOMICAL_RIGHT),
            "anatomicalDorsal": list(ANATOMICAL_DORSAL),
            "orthoScale": camera.data.ortho_scale,
        },
        "output": {"path": str(out), "byteLength": out.stat().st_size, "sha256": _sha256(out)},
    })
    print(json.dumps({"status": "completed", "objects": wanted}))
    return 0


if __name__ == "__main__":
    arguments: argparse.Namespace | None = None
    try:
        arguments = _arguments()
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        failure_path = arguments.failure if arguments else os.environ.get("KAMINOS_RENDER_FAILURE")
        if failure_path:
            _write_json(failure_path, {
                "schema": FAILURE_SCHEMA,
                "rendererId": RENDERER_ID,
                "status": "failed",
                "failurePhase": "named-object-render",
                "error": str(error),
                "lastTrustworthyEvidence": "source opened and verified; no plate was rendered",
            })
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
