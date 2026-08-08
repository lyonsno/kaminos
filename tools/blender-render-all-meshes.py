"""Render every mesh in a scene as an individual thumbnail.

Object identity in this source cannot be inferred reliably from vertex count
(subdivision modifiers), bounding-box extent (long thin bones span more than
compact volumes), or collection membership (the authored envelope may sit in a
subtree the campaign classifier rejects).

So stop inferring. Render each mesh in isolation on a neutral camera and let a
human point at the right one.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--min-vertices", type=int, default=100)
    parser.add_argument("--resolution", type=int, default=300)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def _write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    args = _arguments()
    Path(args.failure).unlink(missing_ok=True)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Thumb World")
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.018, 0.022, 0.021)
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.70, 0.76, 0.67)
    scene.display.shading.show_shadows = True
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.018, 0.022, 0.021)

    camera_data = bpy.data.cameras.new("Thumb Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Thumb Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [o for o in scene.objects if o.type == "MESH"]
    records = []

    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            count = len(mesh.vertices)
        finally:
            evaluated.to_mesh_clear()
        if count < args.min_vertices:
            continue

        for other in meshes:
            other.hide_render = other.name != obj.name
        obj.hide_render = False

        corners = [evaluated.matrix_world @ Vector(c) for c in evaluated.bound_box]
        low = Vector((min(c[i] for c in corners) for i in range(3)))
        high = Vector((max(c[i] for c in corners) for i in range(3)))
        center = (low + high) * 0.5
        diagonal = max((high - low).length, 1e-4)

        camera.location = center + Vector((1.0, 0.0, 0.0)) * diagonal * 1.8
        back = (camera.location - center).normalized()
        image_up = Vector((0.0, 0.0, -1.0))
        projected = image_up - back * image_up.dot(back)
        up = projected.normalized()
        right = up.cross(back).normalized()
        camera.rotation_mode = "QUATERNION"
        camera.rotation_quaternion = Matrix((right, up, back)).transposed().to_quaternion()
        bpy.context.view_layer.update()

        inverse = camera.matrix_world.inverted()
        cam_corners = [inverse @ c for c in corners]
        width = max(p.x for p in cam_corners) - min(p.x for p in cam_corners)
        height = max(p.y for p in cam_corners) - min(p.y for p in cam_corners)
        camera.data.ortho_scale = max(height, width) * 1.15

        safe = obj.name.replace(".", "_").replace("/", "_").replace(" ", "_")
        target = out_dir / f"{safe}.png"
        target.unlink(missing_ok=True)
        scene.render.filepath = str(target)
        bpy.ops.render.render(write_still=True)

        records.append({
            "name": obj.name,
            "evaluatedVertexCount": count,
            "collections": [c.name for c in obj.users_collection],
            "boundsDiagonal": diagonal,
            "extents": [high[i] - low[i] for i in range(3)],
            "thumbnail": str(target),
        })

    if not records:
        raise ValueError("no meshes met the vertex threshold")

    _write_json(args.manifest, {
        "schema": "kaminos.mesh-thumbnail-sheet.v0",
        "status": "completed",
        "source": bpy.data.filepath,
        "blenderVersion": bpy.app.version_string,
        "renderedCount": len(records),
        "minVertices": args.min_vertices,
        "meshes": records,
    })
    print(json.dumps({"status": "completed", "rendered": len(records)}))
    return 0


if __name__ == "__main__":
    arguments: argparse.Namespace | None = None
    try:
        arguments = _arguments()
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        failure_path = arguments.failure if arguments else os.environ.get("KAMINOS_THUMB_FAILURE")
        if failure_path:
            _write_json(failure_path, {
                "schema": "kaminos.mesh-thumbnail-sheet-failure.v0",
                "status": "failed",
                "failurePhase": "mesh-thumbnail-render",
                "error": str(error),
                "lastTrustworthyEvidence": "scene opened; no thumbnails were emitted",
            })
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
