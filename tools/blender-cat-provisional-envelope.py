"""Compile a deterministic provisional low-frequency envelope over admitted cat anatomy."""

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
import numpy as np
from mathutils import Matrix, Vector


SCHEMA = "kaminos.cat-bauplan-provisional-envelope.v0"
FAILURE_SCHEMA = "kaminos.cat-bauplan-provisional-envelope-failure.v0"
COMPILER_ID = "blender-cat-source-surface-closing-envelope-v0"
ANATOMICAL_RIGHT = Vector((1.0, 0.0, 0.0))
ANATOMICAL_DORSAL = Vector((0.0, 0.0, -1.0))


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--classification", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--surface-sample-fraction", type=float, default=0.018)
    parser.add_argument("--closing-radius-fraction", type=float, default=0.030)
    parser.add_argument("--field-resolution-fraction", type=float, default=0.006)
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


def _view_corners(bounds: dict[str, list[float]]) -> list[Vector]:
    low = bounds["min"]
    high = bounds["max"]
    return [Vector((x, y, z)) for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])]


def _orient_camera(camera: bpy.types.Object, target: Vector, image_up: Vector) -> None:
    camera_back = (camera.location - target).normalized()
    projected_up = image_up - camera_back * image_up.dot(camera_back)
    if projected_up.length < 1e-6:
        raise ValueError("camera image-up axis is parallel to its view direction")
    camera_up = projected_up.normalized()
    camera_right = camera_up.cross(camera_back).normalized()
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = Matrix((camera_right, camera_up, camera_back)).transposed().to_quaternion()


def _frame_orthographic(camera: bpy.types.Object, corners: list[Vector], aspect: float) -> None:
    inverse = camera.matrix_world.inverted()
    camera_corners = [inverse @ corner for corner in corners]
    width = max(point.x for point in camera_corners) - min(point.x for point in camera_corners)
    height = max(point.y for point in camera_corners) - min(point.y for point in camera_corners)
    camera.data.ortho_scale = max(height, width / aspect) * 1.12


def _mesh_world_surface_samples(
    source_object: bpy.types.Object,
    depsgraph: Any,
    sample_spacing: float,
) -> tuple[np.ndarray, int]:
    evaluated = source_object.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        if len(mesh.vertices) == 0:
            return np.empty((0, 3), dtype=np.float64), 0
        matrix = evaluated.matrix_world
        mesh.calc_loop_triangles()
        world_vertices = [matrix @ vertex.co for vertex in mesh.vertices]
        samples: list[tuple[float, float, float]] = []
        for triangle in mesh.loop_triangles:
            a, b, c = [world_vertices[index] for index in triangle.vertices]
            longest_edge = max((a - b).length, (b - c).length, (c - a).length)
            subdivisions = max(1, min(32, int(math.ceil(longest_edge / sample_spacing))))
            for i in range(subdivisions + 1):
                for j in range(subdivisions + 1 - i):
                    u = i / subdivisions
                    v = j / subdivisions
                    point = a + (b - a) * u + (c - a) * v
                    samples.append(tuple(point))
        if not samples:
            samples = [tuple(point) for point in world_vertices]
        return np.asarray(samples, dtype=np.float64), len(mesh.vertices)
    finally:
        evaluated.to_mesh_clear()


def surface_cloud_closing(
    surface_samples: np.ndarray,
    *,
    sample_spacing: float,
    closing_radius: float,
) -> tuple[list[dict[str, Any]], int]:
    buckets: dict[tuple[int, int, int], tuple[np.ndarray, int]] = {}
    for point in surface_samples:
        voxel_key = tuple(np.floor(point / sample_spacing).astype(np.int64))
        current = buckets.get(voxel_key)
        if current is None:
            buckets[voxel_key] = (point.copy(), 1)
        else:
            buckets[voxel_key] = (current[0] + point, current[1] + 1)
    elements = [
        {
            "center": [float(value) for value in total / count],
            "radius": closing_radius,
        }
        for _, (total, count) in sorted(buckets.items())
    ]
    return elements, len(buckets)


def _material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.78
    return material


def _configure_scene(scene: bpy.types.Scene) -> None:
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


def _render(scene: bpy.types.Scene, target: Path) -> dict[str, Any]:
    target.unlink(missing_ok=True)
    scene.render.filepath = str(target)
    bpy.ops.render.render(write_still=True)
    if not target.is_file() or target.stat().st_size < 4096:
        raise ValueError(f"rendered output is missing or implausibly small: {target}")
    return {
        "path": str(target),
        "byteLength": target.stat().st_size,
        "sha256": _sha256(target),
    }


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
    if len(admitted_by_name) != len(admitted):
        raise ValueError("classification contains duplicate admitted object names")

    source_bounds = classification.get("worldBounds")
    if not source_bounds:
        raise ValueError("classification contains no aggregate world bounds")
    low = Vector(source_bounds["min"])
    high = Vector(source_bounds["max"])
    center = (low + high) * 0.5
    diagonal = (high - low).length
    if diagonal <= 0:
        raise ValueError("classification aggregate world bounds are degenerate")

    depsgraph = bpy.context.evaluated_depsgraph_get()
    sample_spacing = diagonal * args.surface_sample_fraction
    closing_radius = diagonal * args.closing_radius_fraction
    all_surface_samples: list[np.ndarray] = []
    source_records: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    total_input_vertices = 0
    total_surface_samples = 0
    for name in sorted(admitted_by_name):
        source_object = bpy.data.objects.get(name)
        if source_object is None:
            raise ValueError(f"classified source object is missing from Blender scene: {name}")
        surface_samples = _mesh_world_surface_samples(source_object, depsgraph, sample_spacing)
        samples, vertex_count = surface_samples
        if samples.shape[0] == 0:
            skipped.append({"sourceObjectName": name, "reason": "no_evaluated_surface_samples"})
            continue
        all_surface_samples.append(samples)
        source_records.append({
            "sourceObjectName": name,
            "sourceRole": admitted_by_name[name]["role"],
            "vertexCount": vertex_count,
            "surfaceSampleCount": int(samples.shape[0]),
        })
        total_input_vertices += vertex_count
        total_surface_samples += int(samples.shape[0])
    if not all_surface_samples:
        raise ValueError("no surface samples were derived from admitted source geometry")
    combined_surface_samples = np.concatenate(all_surface_samples, axis=0)
    element_plan, deduplicated_surface_sample_count = surface_cloud_closing(
        combined_surface_samples,
        sample_spacing=sample_spacing,
        closing_radius=closing_radius,
    )
    if not element_plan:
        raise ValueError("no envelope elements were derived from admitted source geometry")

    for obj in bpy.context.scene.objects:
        obj.hide_render = True
        obj.select_set(False)

    metaball_data = bpy.data.metaballs.new("Provisional Cat Envelope Field")
    metaball_data.resolution = max(diagonal * args.field_resolution_fraction, 0.08)
    metaball_data.render_resolution = metaball_data.resolution
    metaball_data.threshold = 0.62
    field_object = bpy.data.objects.new("Provisional Cat Envelope Field", metaball_data)
    bpy.context.scene.collection.objects.link(field_object)
    for planned in element_plan:
        element = metaball_data.elements.new()
        element.type = "BALL"
        element.co = planned["center"]
        element.radius = planned["radius"]

    field_object.hide_render = False
    field_object.select_set(True)
    bpy.context.view_layer.objects.active = field_object
    bpy.context.view_layer.update()
    bpy.ops.object.convert(target="MESH")
    envelope = bpy.context.view_layer.objects.active
    envelope.name = "Provisional Cat Analytical Envelope"
    envelope.data.name = "Provisional Cat Analytical Envelope Mesh"
    envelope.data.materials.append(_material("Provisional Envelope Clay", (0.70, 0.76, 0.67, 1.0)))
    for polygon in envelope.data.polygons:
        polygon.use_smooth = True
    if len(envelope.data.vertices) < 32 or len(envelope.data.polygons) < 32:
        raise ValueError("compiled envelope mesh is implausibly small")

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    envelope_path = output_dir / "provisional-envelope.glb"
    envelope_path.unlink(missing_ok=True)
    envelope.select_set(True)
    bpy.context.view_layer.objects.active = envelope
    bpy.ops.export_scene.gltf(
        filepath=str(envelope_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    if not envelope_path.is_file() or envelope_path.stat().st_size < 4096:
        raise ValueError("compiled envelope GLB is missing or implausibly small")

    scene = bpy.context.scene
    _configure_scene(scene)
    camera_data = bpy.data.cameras.new("Provisional Envelope Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Provisional Envelope Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = center + ANATOMICAL_RIGHT * diagonal * 1.8
    _orient_camera(camera, center, ANATOMICAL_DORSAL)
    source_corners = _view_corners(source_bounds)
    bpy.context.view_layer.update()
    _frame_orthographic(camera, source_corners, scene.render.resolution_x / scene.render.resolution_y)

    envelope.hide_render = False
    rendered_envelope = _render(scene, output_dir / "right-sagittal.png")
    envelope.hide_render = True
    neutral_path = output_dir / "neutral-plate.png"
    rendered_neutral = _render(scene, neutral_path)
    envelope.hide_render = False

    mesh_bounds = [envelope.matrix_world @ Vector(corner) for corner in envelope.bound_box]
    envelope_bounds = {
        "min": [min(point[axis] for point in mesh_bounds) for axis in range(3)],
        "max": [max(point[axis] for point in mesh_bounds) for axis in range(3)],
    }
    manifest = {
        "schema": SCHEMA,
        "compilerId": COMPILER_ID,
        "status": "completed",
        "authority": "agent-authored provisional analytical envelope",
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
        },
        "parameters": {
            "surfaceSampleFraction": args.surface_sample_fraction,
            "surfaceSampleSpacing": sample_spacing,
            "closingRadiusFraction": args.closing_radius_fraction,
            "closingRadius": closing_radius,
            "fieldResolutionFraction": args.field_resolution_fraction,
            "fieldThreshold": metaball_data.threshold,
        },
        "sourceObjectCount": len(source_records),
        "skippedSourceObjects": skipped,
        "inputVertexCount": total_input_vertices,
        "surfaceSampleCount": total_surface_samples,
        "deduplicatedSurfaceSampleCount": deduplicated_surface_sample_count,
        "envelopeElementCount": len(element_plan),
        "sourceRecords": source_records,
        "sourceBounds": source_bounds,
        "envelopeBounds": envelope_bounds,
        "mesh": {
            "path": str(envelope_path),
            "byteLength": envelope_path.stat().st_size,
            "sha256": _sha256(envelope_path),
            "vertexCount": len(envelope.data.vertices),
            "polygonCount": len(envelope.data.polygons),
        },
        "effectiveRoute": {
            "blenderVersion": bpy.app.version_string,
            "compilerId": COMPILER_ID,
            "renderEngine": scene.render.engine,
            "cameraView": "right-sagittal",
            "anatomicalRight": list(ANATOMICAL_RIGHT),
            "anatomicalDorsal": list(ANATOMICAL_DORSAL),
            "orthoScale": camera.data.ortho_scale,
        },
        "outputs": {
            "envelope": rendered_envelope,
            "neutralPlate": {
                "path": str(neutral_path),
                "byteLength": neutral_path.stat().st_size,
                "sha256": _sha256(neutral_path),
            },
        },
    }
    _write_json(args.manifest, manifest)
    print(json.dumps({
        "status": "completed",
        "manifest": str(Path(args.manifest).resolve()),
        "envelopeElementCount": len(element_plan),
        "envelopeVertexCount": len(envelope.data.vertices),
    }))
    return 0


if __name__ == "__main__":
    arguments: argparse.Namespace | None = None
    try:
        arguments = _arguments()
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        failure_path = arguments.failure if arguments else os.environ.get("KAMINOS_CAT_ENVELOPE_FAILURE")
        if failure_path:
            _write_json(failure_path, {
                "schema": FAILURE_SCHEMA,
                "compilerId": COMPILER_ID,
                "status": "failed",
                "failurePhase": "provisional-envelope-compile",
                "error": str(error),
                "lastTrustworthyEvidence": "The requested Blender scene opened; no provisional envelope output was admitted",
            })
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
