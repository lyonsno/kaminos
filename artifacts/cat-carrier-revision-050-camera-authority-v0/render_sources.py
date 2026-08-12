#!/usr/bin/env python3
"""Render hash-bound revision-050 carrier plates without mutating the source blend."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


EXPECTED_SOURCE_SHA256 = "9f0409d99321ec4d74d237ba6cff1f425b402aeae653db43e699f53150b11fbe"
MATCHED_CAMERA_LOCATION = Vector((23.273109436035156, -8.057132720947266, -3.5653486251831055))
MATCHED_CAMERA_ROTATION = (-1.4455565214157104, 2.1574334141405416e-07, -1.775050401687622)
ORTHOGRAPHIC_SCALE = 19.938169479370117
VIEWS = (
    ("revision-050-matched", 0.0),
    ("revision-050-oblique-negative-35", -35.0),
    ("revision-050-oblique-positive-35", 35.0),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", required=True)
    parser.add_argument("--source-object", default="Cube.056")
    parser.add_argument("--output-root", required=True)
    return parser.parse_args(argv)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def png_dimensions(path: Path) -> list[int]:
    with path.open("rb") as stream:
        header = stream.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"not a PNG: {path}")
    return list(struct.unpack(">II", header[16:24]))


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.rotation_euler.rotate_axis("Z", math.pi)


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    high = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    return low, high


def evaluated_copy(source: bpy.types.Object) -> bpy.types.Object:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    obj = bpy.data.objects.new("Revision 050 Carrier Assay", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = source.matrix_world.copy()
    obj.color = (0.67, 0.71, 0.69, 1.0)
    return obj


def configure_scene() -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.curvature_ridge_factor = 1.2
    scene.display.shading.curvature_valley_factor = 0.8
    scene.display.shading.background_type = "WORLD"
    scene.display.shading.show_specular_highlight = True
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Revision 050 Assay World")
    scene.world.color = (0.028, 0.033, 0.032)

    camera_data = bpy.data.cameras.new("Revision 050 Assay Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ORTHOGRAPHIC_SCALE
    camera = bpy.data.objects.new("Revision 050 Assay Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def main() -> None:
    args = parse_args()
    requested = Path(args.source_blend).expanduser().resolve()
    effective = Path(bpy.data.filepath).resolve()
    output_root = Path(args.output_root).expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    if requested != effective:
        raise ValueError(f"requested source {requested} does not match open blend {effective}")
    source_sha = sha256(effective)
    if source_sha != EXPECTED_SOURCE_SHA256:
        raise ValueError(f"source SHA-256 drift: {source_sha}")

    source = bpy.data.objects.get(args.source_object)
    if source is None or source.type != "MESH":
        raise ValueError(f"mesh object not found: {args.source_object}")
    for obj in bpy.context.scene.objects:
        obj.hide_render = True
    assay = evaluated_copy(source)
    assay.hide_render = False
    low, high = world_bounds(assay)
    target = (low + high) * 0.5
    camera = configure_scene()
    scene = bpy.context.scene

    for source_id, yaw_degrees in VIEWS:
        destination = output_root / source_id
        destination.mkdir(parents=True, exist_ok=True)
        plate = destination / "plate.png"
        manifest = destination / "render-manifest.json"
        plate.unlink(missing_ok=True)
        manifest.unlink(missing_ok=True)

        if yaw_degrees == 0.0:
            camera.location = MATCHED_CAMERA_LOCATION
            camera.rotation_euler = MATCHED_CAMERA_ROTATION
        else:
            relative = MATCHED_CAMERA_LOCATION - target
            rotation = Matrix.Rotation(math.radians(yaw_degrees), 4, "Z")
            camera.location = target + rotation @ relative
            look_at(camera, target)
        camera.data.ortho_scale = ORTHOGRAPHIC_SCALE
        scene.render.filepath = str(plate)
        bpy.ops.render.render(write_still=True)
        if not plate.is_file() or plate.stat().st_size <= 4096:
            raise ValueError(f"missing or implausibly small plate: {plate}")

        payload = {
            "schema": "kaminos.cat-carrier-revision-050-source-plate.v0",
            "source": {
                "requestedBlend": str(requested),
                "effectiveBlend": str(effective),
                "sha256": source_sha,
                "object": source.name,
                "evaluatedVertexCount": len(assay.data.vertices),
                "evaluatedPolygonCount": len(assay.data.polygons),
                "worldBounds": {"low": list(low), "high": list(high)},
            },
            "view": {
                "id": source_id,
                "yawFromMatchedDegrees": yaw_degrees,
                "cameraType": camera.data.type,
                "cameraLocation": list(camera.location),
                "cameraRotationEuler": list(camera.rotation_euler),
                "orthographicScale": camera.data.ortho_scale,
            },
            "plate": {
                "path": plate.name,
                "dimensions": png_dimensions(plate),
                "byteLength": plate.stat().st_size,
                "sha256": sha256(plate),
            },
            "claimCeiling": "Authenticated source-conditioning plate only; no generator behavior claim.",
        }
        manifest.write_text(json.dumps(payload, indent=2) + "\n")
        print(json.dumps({"sourceId": source_id, "plate": str(plate), "sha256": payload["plate"]["sha256"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        args = parse_args()
        failure = Path(args.output_root).expanduser().resolve() / "failure-report.json"
        failure.parent.mkdir(parents=True, exist_ok=True)
        failure.write_text(
            json.dumps(
                {
                    "schema": "kaminos.cat-carrier-revision-050-source-plate.failure.v0",
                    "failurePhase": "source-validation-or-render",
                    "errorType": type(error).__name__,
                    "error": str(error),
                    "lastTrustworthyEvidence": {"effectiveBlend": bpy.data.filepath or None},
                    "traceback": traceback.format_exc(),
                },
                indent=2,
            )
            + "\n"
        )
        raise
