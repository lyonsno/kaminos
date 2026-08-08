"""Import a GLB and render it through the campaign's right-sagittal camera.

GLB export applies a Y-up conversion, so an exported mesh no longer sits in the
Blender source's coordinate frame. This renderer derives its camera from the
imported geometry's own principal axes rather than assuming the source frame,
so the plate is framed correctly regardless of the exporter's axis convention.

The longest bounding extent is taken as the anterior-posterior axis and the
shortest as the mediolateral axis, which holds for any quadruped body volume.
The resulting plate is a lateral view comparable with the other conditioning
plates; it is NOT a claim that the mesh is in source coordinates.
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

SCHEMA = "kaminos.glb-plate-render.v0"
FAILURE_SCHEMA = "kaminos.glb-plate-render-failure.v0"
RENDERER_ID = "blender-glb-lateral-plate-v0"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument(
        "--flip-up",
        action="store_true",
        help="Invert the derived up axis. The heuristic cannot tell dorsal from "
             "ventral, so a body may render belly-up; this corrects it.",
    )
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


def main() -> int:
    args = _arguments()
    Path(args.failure).unlink(missing_ok=True)

    glb = Path(args.glb).resolve()
    if not glb.is_file():
        raise ValueError(f"GLB not found: {glb}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise ValueError("imported GLB contains no mesh objects")

    corners: list[Vector] = []
    for obj in meshes:
        corners.extend(obj.matrix_world @ Vector(c) for c in obj.bound_box)
    low = Vector((min(c[i] for c in corners) for i in range(3)))
    high = Vector((max(c[i] for c in corners) for i in range(3)))
    center = (low + high) * 0.5
    extents = [high[i] - low[i] for i in range(3)]

    # Longest extent is the body axis; shortest is left-right. The camera looks
    # down the shortest axis to give a lateral view.
    long_axis = max(range(3), key=lambda i: extents[i])
    short_axis = min(range(3), key=lambda i: extents[i])
    up_axis = ({0, 1, 2} - {long_axis, short_axis}).pop()

    view_dir = Vector((0.0, 0.0, 0.0))
    view_dir[short_axis] = 1.0
    image_up = Vector((0.0, 0.0, 0.0))
    image_up[up_axis] = -1.0 if args.flip_up else 1.0

    diagonal = (high - low).length
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Plate World")
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
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

    camera_data = bpy.data.cameras.new("Plate Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Plate Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = center + view_dir * diagonal * 1.8

    back = (camera.location - center).normalized()
    projected = image_up - back * image_up.dot(back)
    if projected.length < 1e-6:
        raise ValueError("derived image-up axis is parallel to the view direction")
    up = projected.normalized()
    right = up.cross(back).normalized()
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = Matrix((right, up, back)).transposed().to_quaternion()
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
        "glb": {"path": str(glb), "sha256": _sha256(glb)},
        "meshCount": len(meshes),
        "totalVertexCount": sum(len(o.data.vertices) for o in meshes),
        "derivedFrame": {
            "note": "axes derived from imported geometry, not assumed to match the Blender source frame",
            "longAxisIndex": long_axis,
            "shortAxisIndex": short_axis,
            "upAxisIndex": up_axis,
            "extents": extents,
        },
        "effectiveRoute": {
            "blenderVersion": bpy.app.version_string,
            "renderEngine": scene.render.engine,
            "orthoScale": camera.data.ortho_scale,
        },
        "output": {"path": str(out), "byteLength": out.stat().st_size, "sha256": _sha256(out)},
    })
    print(json.dumps({"status": "completed", "meshes": len(meshes)}))
    return 0


if __name__ == "__main__":
    arguments: argparse.Namespace | None = None
    try:
        arguments = _arguments()
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        failure_path = arguments.failure if arguments else os.environ.get("KAMINOS_GLB_RENDER_FAILURE")
        if failure_path:
            _write_json(failure_path, {
                "schema": FAILURE_SCHEMA,
                "rendererId": RENDERER_ID,
                "status": "failed",
                "failurePhase": "glb-plate-render",
                "error": str(error),
                "lastTrustworthyEvidence": "GLB located; no plate was rendered",
            })
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
