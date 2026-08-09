#!/usr/bin/env python3
"""Render a non-destructive decimation ladder from one Blender mesh object."""

import argparse
import hashlib
import json
import math
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", required=True)
    parser.add_argument("--source-object", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--ratios",
        default="1.0,0.75,0.5,0.3,0.15",
        help="Comma-separated collapse ratios in descending order.",
    )
    return parser.parse_args(argv)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.rotation_euler.rotate_axis("Z", math.pi)


def configure_scene(scene: bpy.types.Scene, target: Vector, radius: float) -> bpy.types.Object:
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
    scene.world.color = (0.028, 0.033, 0.032)

    camera_data = bpy.data.cameras.new("Decimation Assay Camera")
    camera = bpy.data.objects.new("Decimation Assay Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = radius * 2.35
    camera.location = target + Vector((radius * 2.8, radius * -0.58, radius * 0.38))
    look_at(camera, target + Vector((0.0, 0.0, radius * 0.02)))
    return camera


def evaluated_mesh(source: bpy.types.Object) -> bpy.types.Mesh:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    mesh.name = f"{source.name} evaluated baseline"
    return mesh


def triangle_count(mesh: bpy.types.Mesh) -> int:
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, float]:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    maximum = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    center = (minimum + maximum) * 0.5
    radius = max(maximum - minimum) * 0.5
    return center, radius


def main() -> None:
    args = parse_args()
    source_path = Path(args.source_blend).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    effective_source_path = Path(bpy.data.filepath).resolve()
    if effective_source_path != source_path:
        raise ValueError(
            f"requested source {source_path} does not match open blend {effective_source_path}"
        )

    for stale_render in output_dir.glob("lod-*.png"):
        stale_render.unlink()
    for stale_report in (output_dir / "manifest.json", output_dir / "failure-report.json"):
        stale_report.unlink(missing_ok=True)

    ratios = [float(value) for value in args.ratios.split(",")]
    if not ratios or ratios[0] != 1.0 or any(not 0.0 < ratio <= 1.0 for ratio in ratios):
        raise ValueError("ratios must begin with 1.0 and remain within (0, 1]")
    if any(left <= right for left, right in zip(ratios, ratios[1:])):
        raise ValueError("ratios must be strictly descending")

    source = bpy.data.objects.get(args.source_object)
    if source is None or source.type != "MESH":
        raise ValueError(f"mesh object not found: {args.source_object}")

    scene = bpy.context.scene
    for obj in scene.objects:
        obj.hide_render = True

    base_mesh = evaluated_mesh(source)
    assay_obj = bpy.data.objects.new("Decimation Assay Envelope", base_mesh)
    scene.collection.objects.link(assay_obj)
    assay_obj.matrix_world = source.matrix_world.copy()
    assay_obj.color = (0.67, 0.71, 0.69, 1.0)
    assay_obj.hide_render = False
    center, radius = world_bounds(assay_obj)
    configure_scene(scene, center, radius)

    baseline_vertices = len(base_mesh.vertices)
    baseline_polygons = len(base_mesh.polygons)
    baseline_triangles = triangle_count(base_mesh)
    cells = []

    for index, ratio in enumerate(ratios):
        assay_obj.data = base_mesh.copy()
        if ratio < 1.0:
            modifier = assay_obj.modifiers.new("Controlled Collapse", "DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = ratio
            modifier.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = assay_obj
            assay_obj.select_set(True)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            assay_obj.select_set(False)

        label = f"lod-{index:02d}-r{ratio:.2f}"
        render_path = output_dir / f"{label}.png"
        scene.render.filepath = str(render_path)
        bpy.ops.render.render(write_still=True)
        cells.append(
            {
                "label": label,
                "requestedRatio": ratio,
                "vertexCount": len(assay_obj.data.vertices),
                "polygonCount": len(assay_obj.data.polygons),
                "triangleCount": triangle_count(assay_obj.data),
                "render": render_path.name,
            }
        )

    triangle_counts = [cell["triangleCount"] for cell in cells]
    if any(left <= right for left, right in zip(triangle_counts, triangle_counts[1:])):
        raise RuntimeError(f"triangle density did not decrease strictly: {triangle_counts}")

    manifest = {
        "schema": "kaminos.decimation-ladder.v1",
        "source": {
            "requestedBlend": str(source_path),
            "effectiveBlend": str(effective_source_path),
            "sha256": sha256(source_path),
            "object": args.source_object,
            "evaluatedVertexCount": baseline_vertices,
            "evaluatedPolygonCount": baseline_polygons,
            "evaluatedTriangleCount": baseline_triangles,
        },
        "render": {
            "engine": scene.render.engine,
            "resolution": [scene.render.resolution_x, scene.render.resolution_y],
            "cameraType": scene.camera.data.type,
            "cameraLocation": list(scene.camera.location),
            "cameraRotationEuler": list(scene.camera.rotation_euler),
            "orthographicScale": scene.camera.data.ortho_scale,
        },
        "cells": cells,
        "claimCeiling": (
            "Geometry-source inspection only. These renders do not establish generator behavior."
        ),
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
        if "--output-dir" in argv:
            output_dir = Path(argv[argv.index("--output-dir") + 1]).expanduser().resolve()
            output_dir.mkdir(parents=True, exist_ok=True)
            failure_report = {
                "schema": "kaminos.decimation-ladder.failure.v0",
                "phase": "source-validation-or-ladder-generation",
                "errorType": type(error).__name__,
                "error": str(error),
                "lastTrustworthyEvidence": {
                    "effectiveBlend": bpy.data.filepath or None,
                    "outputDirectory": str(output_dir),
                },
                "traceback": traceback.format_exc(),
            }
            (output_dir / "failure-report.json").write_text(
                json.dumps(failure_report, indent=2) + "\n"
            )
        raise
