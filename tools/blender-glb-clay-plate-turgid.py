"""Render a GLB as a neutral clay plate matching the cat-envelope presentation.

Arm A of the carrier-class calibration comes from a GLB (photo -> TRELLIS),
while arms B and C come from the Blender envelope compiler. For the comparison
to isolate *carrier provenance*, the presentation must be identical: same
engine, resolution, background, studio shading, cavity, clay material, and
orthographic framing rule. Every constant below is taken from
`blender-cat-provisional-envelope.py` on `cc/molten-cat-analytical-carrier-0805`
so the two arms differ in geometry, not in look.

The camera view is selectable because the source photograph's subject may face
either way; polarity is an open campaign predicate and must be recorded, not
silently normalized.

Writes a manifest on success and a failure report naming the phase and last
trustworthy evidence on any failure, including failures before the first image.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector

MANIFEST_SCHEMA = "kaminos.glb-clay-plate.v0"
COMPILER_ID = "blender-glb-clay-plate-v0"

# Presentation constants, held identical to the envelope compiler.
RESOLUTION = 900
WORLD_COLOR = (0.018, 0.022, 0.021)
CLAY_COLOR = (0.62, 0.62, 0.60, 1.0)
ORTHO_MARGIN = 1.12

# Anatomical basis from the envelope manifest's effectiveRoute.
ANATOMICAL_RIGHT = Vector((1.0, 0.0, 0.0))
ANATOMICAL_DORSAL = Vector((0.0, 0.0, -1.0))


def _sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: str | Path, value: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _arguments() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--expected-glb-sha256", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--view", default="right-sagittal")
    return parser.parse_args(argv)


def _configure_scene(scene: bpy.types.Scene) -> None:
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    # `read_factory_settings(use_empty=True)` leaves the scene without a world,
    # so the Workbench background colour has nothing to bind to. Create one
    # rather than letting the render fall back to a different background than
    # the envelope arm.
    if scene.world is None:
        scene.world = bpy.data.worlds.new("plate-world")
    scene.world.color = WORLD_COLOR
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = WORLD_COLOR


def _clay_material() -> bpy.types.Material:
    material = bpy.data.materials.new("clay")
    material.diffuse_color = CLAY_COLOR
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = CLAY_COLOR
    principled.inputs["Roughness"].default_value = 0.78
    return material


def _orient_camera(camera: bpy.types.Object, target: Vector, image_up: Vector) -> None:
    camera_back = (camera.location - target).normalized()
    projected_up = image_up - camera_back * image_up.dot(camera_back)
    if projected_up.length < 1e-6:
        raise ValueError("camera image-up axis is parallel to its view direction")
    camera_up = projected_up.normalized()
    camera_right = camera_up.cross(camera_back).normalized()
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = (
        Matrix((camera_right, camera_up, camera_back)).transposed().to_quaternion()
    )


def _frame_orthographic(camera, corners: list[Vector], aspect: float) -> None:
    inverse = camera.matrix_world.inverted()
    camera_corners = [inverse @ corner for corner in corners]
    width = max(p.x for p in camera_corners) - min(p.x for p in camera_corners)
    height = max(p.y for p in camera_corners) - min(p.y for p in camera_corners)
    camera.data.ortho_scale = max(height, width / aspect) * ORTHO_MARGIN


def _world_bounds(objects) -> tuple[Vector, Vector]:
    points: list[Vector] = []
    for obj in objects:
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        raise ValueError("imported GLB contains no renderable geometry")
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return low, high


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
    phase = "argument-parse"
    evidence: dict[str, Any] = {"glb": args.glb, "view": args.view}
    # A failure report from a previous run must not survive beside a fresh
    # success: a reader finding both cannot tell which describes the image on
    # disk, and the stale report reads as a live defect.
    Path(args.failure).unlink(missing_ok=True)
    try:
        phase = "source-verify"
        glb_path = Path(args.glb)
        if not glb_path.is_file():
            raise ValueError(f"GLB not found: {glb_path}")
        effective_sha = _sha256(glb_path)
        evidence["effectiveGlbSha256"] = effective_sha
        if effective_sha != args.expected_glb_sha256:
            raise ValueError(
                "GLB identity mismatch: expected "
                f"{args.expected_glb_sha256}, found {effective_sha}"
            )

        phase = "scene-reset"
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        _configure_scene(scene)

        phase = "glb-import"
        bpy.ops.import_scene.gltf(filepath=str(glb_path))
        meshes = [o for o in scene.objects if o.type == "MESH"]
        if not meshes:
            raise ValueError("GLB import produced no mesh objects")
        evidence["importedMeshCount"] = len(meshes)

        phase = "clay-apply"
        clay = _clay_material()
        for obj in meshes:
            obj.data.materials.clear()
            obj.data.materials.append(clay)

        phase = "camera-frame"
        low, high = _world_bounds(meshes)
        center = (low + high) * 0.5
        radius = max((high - low).length, 1e-3)
        camera_data = bpy.data.cameras.new("plate-camera")
        camera_data.type = "ORTHO"
        camera_data.clip_start = 0.001
        camera_data.clip_end = radius * 20.0
        camera = bpy.data.objects.new("plate-camera", camera_data)
        scene.collection.objects.link(camera)
        scene.camera = camera

        # right-sagittal: viewer on the anatomical-right side, dorsal up.
        direction = ANATOMICAL_RIGHT if args.view == "right-sagittal" else -ANATOMICAL_RIGHT
        camera.location = center + direction * radius * 3.0
        _orient_camera(camera, center, -ANATOMICAL_DORSAL)
        bpy.context.view_layer.update()
        corners = [
            Vector((x, y, z))
            for x in (low.x, high.x)
            for y in (low.y, high.y)
            for z in (low.z, high.z)
        ]
        _frame_orthographic(camera, corners, 1.0)
        bpy.context.view_layer.update()

        phase = "render"
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        rendered = _render(scene, output_dir / f"{args.view}.png")

        phase = "manifest-write"
        manifest = {
            "schema": MANIFEST_SCHEMA,
            "compilerId": COMPILER_ID,
            "authority": "agent-authored carrier-class control render",
            "source": {
                "path": str(glb_path),
                "requestedSha256": args.expected_glb_sha256,
                "effectiveSha256": effective_sha,
                "byteLength": glb_path.stat().st_size,
            },
            "effectiveRoute": {
                "blenderVersion": bpy.app.version_string,
                "renderEngine": scene.render.engine,
                "cameraView": args.view,
                "orthoScale": camera.data.ortho_scale,
                "resolution": [RESOLUTION, RESOLUTION],
                "anatomicalRight": list(ANATOMICAL_RIGHT),
                "anatomicalDorsal": list(ANATOMICAL_DORSAL),
                "presentationMatchedTo": "blender-cat-source-surface-closing-envelope-v0",
            },
            "importedMeshCount": len(meshes),
            "bounds": {"min": list(low), "max": list(high)},
            "outputs": {"clay": rendered},
        }
        _write_json(args.manifest, manifest)
        print(json.dumps({"status": "complete", "output": rendered["path"]}, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001 - every failure must leave a report
        _write_json(
            args.failure,
            {
                "schema": MANIFEST_SCHEMA,
                "status": "failed",
                "failurePhase": phase,
                "message": str(exc),
                "lastTrustworthyEvidence": evidence,
            },
        )
        print(json.dumps({"status": "failed", "failurePhase": phase, "message": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
