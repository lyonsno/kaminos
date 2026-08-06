"""March a part-aware envelope element plan into a surface and render it.

Consumes an element plan produced by `envelope-compile-part-aware-core.mjs`
(centers, per-part radii, source part identity), builds a metaball field, marches
it to a mesh, exports GLB, and renders a right-sagittal plate through the same
camera construction the prior provisional-envelope compiler used, so the visual
is directly comparable.

Renders the source in the same frame as a companion plate, so the visual
comparison is against the actual authored structure rather than against memory.

Writes a durable failure record naming the phase if it fails before emitting its
primary artifact.
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

SCHEMA = "kaminos.part-aware-envelope.v0"
FAILURE_SCHEMA = "kaminos.part-aware-envelope-failure.v0"
COMPILER_ID = "blender-part-aware-envelope-v0"
ANATOMICAL_RIGHT = Vector((1.0, 0.0, 0.0))
ANATOMICAL_DORSAL = Vector((0.0, 0.0, -1.0))


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--threshold", type=float, default=0.62)
    parser.add_argument("--resolution-fraction", type=float, default=0.0035)
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


def _material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.78
    return material


def _configure_scene(scene: bpy.types.Scene) -> None:
    # `read_factory_settings(use_empty=True)` leaves the scene without a world,
    # so create one before touching its colour.
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Envelope World")
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
    width = max(p.x for p in camera_corners) - min(p.x for p in camera_corners)
    height = max(p.y for p in camera_corners) - min(p.y for p in camera_corners)
    camera.data.ortho_scale = max(height, width / aspect) * 1.12


def _render(scene: bpy.types.Scene, target: Path) -> dict[str, Any]:
    target.unlink(missing_ok=True)
    scene.render.filepath = str(target)
    bpy.ops.render.render(write_still=True)
    if not target.is_file() or target.stat().st_size < 4096:
        raise ValueError(f"rendered output is missing or implausibly small: {target}")
    return {"path": str(target), "byteLength": target.stat().st_size, "sha256": _sha256(target)}


def main() -> int:
    args = _arguments()
    Path(args.failure).unlink(missing_ok=True)

    plan_path = Path(args.plan).resolve()
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    elements = plan.get("elements")
    if not isinstance(elements, list) or not elements:
        raise ValueError("element plan contains no elements")
    source_surfaces = plan.get("sourceSurfaces")
    if not source_surfaces:
        raise ValueError("element plan does not name its source surfaces")

    # Clear the factory scene so nothing inherited leaks into the render.
    bpy.ops.wm.read_factory_settings(use_empty=True)

    diagonal = float(plan["diagonal"])
    metaball_data = bpy.data.metaballs.new("Part Aware Envelope Field")
    metaball_data.resolution = max(diagonal * args.resolution_fraction, 0.04)
    metaball_data.render_resolution = metaball_data.resolution
    metaball_data.threshold = args.threshold
    field_object = bpy.data.objects.new("Part Aware Envelope Field", metaball_data)
    bpy.context.scene.collection.objects.link(field_object)
    for planned in elements:
        element = metaball_data.elements.new()
        element.type = "BALL"
        element.co = planned["center"]
        element.radius = planned["radius"]

    field_object.select_set(True)
    bpy.context.view_layer.objects.active = field_object
    bpy.context.view_layer.update()
    bpy.ops.object.convert(target="MESH")
    envelope = bpy.context.view_layer.objects.active
    envelope.name = "Part Aware Analytical Envelope"
    envelope.data.materials.append(_material("Part Aware Envelope Clay", (0.70, 0.76, 0.67, 1.0)))
    for polygon in envelope.data.polygons:
        polygon.use_smooth = True
    if len(envelope.data.vertices) < 32 or len(envelope.data.polygons) < 32:
        raise ValueError("marched envelope mesh is implausibly small")

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    envelope_path = output_dir / "part-aware-envelope.glb"
    envelope_path.unlink(missing_ok=True)
    envelope.select_set(True)
    bpy.context.view_layer.objects.active = envelope
    bpy.ops.export_scene.gltf(
        filepath=str(envelope_path), export_format="GLB", use_selection=True, export_apply=True
    )
    if not envelope_path.is_file() or envelope_path.stat().st_size < 4096:
        raise ValueError("exported envelope GLB is missing or implausibly small")

    # Rebuild the authored source as a companion object so the visual comparison
    # is against actual geometry in the same frame, not against recollection.
    surfaces = json.loads(Path(source_surfaces).read_text(encoding="utf-8"))
    source_mesh = bpy.data.meshes.new("Authored Source Mesh")
    source_mesh.from_pydata(
        [tuple(p) for p in surfaces["positions"]], [], [tuple(t) for t in surfaces["triangles"]]
    )
    source_mesh.update()
    source_object = bpy.data.objects.new("Authored Source", source_mesh)
    source_object.data.materials.append(_material("Authored Source Clay", (0.72, 0.72, 0.74, 1.0)))
    bpy.context.scene.collection.objects.link(source_object)

    scene = bpy.context.scene
    _configure_scene(scene)

    corners: list[Vector] = []
    for obj in (envelope, source_object):
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    low = Vector((min(c[i] for c in corners) for i in range(3)))
    high = Vector((max(c[i] for c in corners) for i in range(3)))
    center = (low + high) * 0.5
    frame_diagonal = (high - low).length

    camera_data = bpy.data.cameras.new("Envelope Camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Envelope Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = center + ANATOMICAL_RIGHT * frame_diagonal * 1.8
    _orient_camera(camera, center, ANATOMICAL_DORSAL)
    bpy.context.view_layer.update()
    _frame_orthographic(camera, corners, scene.render.resolution_x / scene.render.resolution_y)

    source_object.hide_render = True
    envelope.hide_render = False
    rendered_envelope = _render(scene, output_dir / "envelope-right-sagittal.png")

    envelope.hide_render = True
    source_object.hide_render = False
    rendered_source = _render(scene, output_dir / "source-right-sagittal.png")

    part_count = len({element.get("partIndex") for element in elements})
    _write_json(args.manifest, {
        "schema": SCHEMA,
        "compilerId": COMPILER_ID,
        "status": "completed",
        "authority": "agent-authored part-aware analytical envelope",
        "plan": {"path": str(plan_path), "sha256": _sha256(plan_path)},
        "sourceSurfaces": {"path": str(source_surfaces), "sha256": _sha256(source_surfaces)},
        "parameters": {
            "threshold": args.threshold,
            "resolutionFraction": args.resolution_fraction,
            "fieldResolution": metaball_data.resolution,
        },
        "elementCount": len(elements),
        "partCount": part_count,
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
        "outputs": {"envelope": rendered_envelope, "source": rendered_source},
    })
    print(json.dumps({
        "status": "completed",
        "elementCount": len(elements),
        "partCount": part_count,
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
        failure_path = arguments.failure if arguments else os.environ.get("KAMINOS_PART_AWARE_ENVELOPE_FAILURE")
        if failure_path:
            _write_json(failure_path, {
                "schema": FAILURE_SCHEMA,
                "compilerId": COMPILER_ID,
                "status": "failed",
                "failurePhase": "part-aware-envelope-compile",
                "error": str(error),
                "lastTrustworthyEvidence": "element plan read; no marched envelope was emitted",
            })
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
