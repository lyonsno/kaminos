"""Render exact-source diagnostic views of an admitted cat bauplan classification."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Quaternion, Vector


SCHEMA = "kaminos.cat-bauplan-source-preview.v0"
FAILURE_SCHEMA = "kaminos.cat-bauplan-source-preview-failure.v0"
RENDERER_ID = "blender-cat-source-preview-v0"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--classification", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
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


def _material(name: str, color: tuple[float, float, float, float], roughness: float) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    return material


def _assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)


def _look_at(camera: bpy.types.Object, target: Vector, *, roll: float = 0.0) -> None:
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = (
        (target - camera.location).to_track_quat("-Z", "Y")
        @ Quaternion((0.0, 0.0, 1.0), roll)
    )


def _view_corners(bounds: dict[str, list[float]]) -> list[Vector]:
    low = bounds["min"]
    high = bounds["max"]
    return [Vector((x, y, z)) for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])]


def _frame_orthographic(camera: bpy.types.Object, corners: list[Vector], aspect: float) -> None:
    inverse = camera.matrix_world.inverted()
    camera_corners = [inverse @ corner for corner in corners]
    width = max(point.x for point in camera_corners) - min(point.x for point in camera_corners)
    height = max(point.y for point in camera_corners) - min(point.y for point in camera_corners)
    camera.data.ortho_scale = max(height, width / aspect) * 1.12


def _add_area_light(name: str, location: Vector, energy: float, size: float, target: Vector) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()


def main() -> int:
    args = _arguments()
    Path(args.failure).unlink(missing_ok=True)
    source = Path(bpy.data.filepath).resolve()
    requested_source = Path(args.source).expanduser().resolve()
    if source != requested_source:
        raise ValueError(f"requested source {requested_source} does not match open Blender file {source}")
    source_sha256 = _sha256(source)
    if source_sha256 != args.expected_source_sha256:
        raise ValueError("source SHA-256 mismatch")

    classification_path = Path(args.classification).resolve()
    classification = json.loads(classification_path.read_text(encoding="utf-8"))
    if classification.get("status") != "completed":
        raise ValueError("classification is not completed")
    if classification.get("source", {}).get("sha256") != source_sha256:
        raise ValueError("classification source SHA-256 mismatch")
    admitted = classification.get("admittedObjects")
    if not isinstance(admitted, list) or not admitted:
        raise ValueError("classification contains no admitted source objects")

    admitted_by_name = {record["name"]: record for record in admitted}
    missing = sorted(name for name in admitted_by_name if bpy.data.objects.get(name) is None)
    if missing:
        raise ValueError(f"classification names absent source objects: {missing}")

    bone_material = _material("Diagnostic Bone", (0.72, 0.70, 0.64, 1.0), 0.72)
    muscle_material = _material("Diagnostic Muscle", (0.68, 0.18, 0.13, 1.0), 0.62)
    for obj in bpy.context.scene.objects:
        obj.hide_render = obj.name not in admitted_by_name
    for name, record in admitted_by_name.items():
        obj = bpy.data.objects[name]
        obj.hide_render = False
        _assign_material(obj, muscle_material if record["role"] == "muscle_surface" else bone_material)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.018, 0.022, 0.021)
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.018, 0.022, 0.021)
    if scene.world.use_nodes:
        background = scene.world.node_tree.nodes.get("Background")
        background.inputs["Color"].default_value = (0.018, 0.022, 0.021, 1.0)
        background.inputs["Strength"].default_value = 0.22

    bounds = classification.get("worldBounds")
    if not bounds:
        raise ValueError("classification contains no aggregate world bounds")
    low = Vector(bounds["min"])
    high = Vector(bounds["max"])
    center = (low + high) * 0.5
    diagonal = (high - low).length
    corners = _view_corners(bounds)

    camera_data = bpy.data.cameras.new("Cat Source Diagnostic Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Cat Source Diagnostic Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    _add_area_light("Cat Source Key", center + Vector((diagonal, -diagonal * 0.35, diagonal)), 1700, diagonal * 0.55, center)
    _add_area_light("Cat Source Fill", center + Vector((-diagonal * 0.7, diagonal * 0.4, diagonal * 0.3)), 1050, diagonal * 0.7, center)
    _add_area_light("Cat Source Rim", center + Vector((0, diagonal * 0.2, diagonal)), 1200, diagonal * 0.45, center)

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    views = {
        "right-sagittal": (Vector((1.0, 0.0, 0.08)), 3.141592653589793),
        "front-three-quarter": (Vector((0.75, 0.62, 0.28)), 3.141592653589793),
        "dorsal": (Vector((0.08, 0.0, 1.0)), 0.0),
    }
    outputs = []
    for name, (direction, roll) in views.items():
        camera.location = center + direction.normalized() * diagonal * 1.8
        _look_at(camera, center, roll=roll)
        bpy.context.view_layer.update()
        _frame_orthographic(camera, corners, scene.render.resolution_x / scene.render.resolution_y)
        path = output_dir / f"{name}.png"
        path.unlink(missing_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        if not path.is_file() or path.stat().st_size < 4096:
            raise ValueError(f"rendered output is missing or implausibly small: {path}")
        outputs.append({
            "view": name,
            "path": str(path),
            "byteLength": path.stat().st_size,
            "sha256": _sha256(path),
            "cameraLocation": list(camera.location),
            "orthoScale": camera.data.ortho_scale,
        })

    manifest = {
        "schema": SCHEMA,
        "rendererId": RENDERER_ID,
        "status": "completed",
        "source": {
            "requestedPath": str(requested_source),
            "effectivePath": str(source),
            "sha256": source_sha256,
        },
        "classification": {
            "path": str(classification_path),
            "sha256": _sha256(classification_path),
            "schema": classification.get("schema"),
            "admittedObjectCount": len(admitted),
            "admittedRoleCounts": classification.get("admittedRoleCounts"),
        },
        "effectiveRoute": {
            "blenderVersion": bpy.app.version_string,
            "renderEngine": scene.render.engine,
            "rendererId": RENDERER_ID,
        },
        "outputs": outputs,
    }
    _write_json(args.manifest, manifest)
    print(json.dumps({"status": "completed", "manifest": str(Path(args.manifest).resolve()), "outputCount": len(outputs)}))
    return 0


if __name__ == "__main__":
    arguments: argparse.Namespace | None = None
    try:
        arguments = _arguments()
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        failure_path = arguments.failure if arguments else os.environ.get("KAMINOS_CAT_SOURCE_PREVIEW_FAILURE")
        if failure_path:
            _write_json(failure_path, {
                "schema": FAILURE_SCHEMA,
                "rendererId": RENDERER_ID,
                "status": "failed",
                "failurePhase": "source-preview-render",
                "error": str(error),
                "lastTrustworthyEvidence": "The requested Blender scene opened; no diagnostic preview was admitted",
            })
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
