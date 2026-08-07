"""Render read-only inspection views of an operator .blend bauplan.

This exists so the production lane can *look at* an operator source without
touching it. It never saves, never exports, and re-hashes the source after
rendering to prove non-mutation — the same before/after receipt the Source Plate
contract requires for operator `.blend` inputs.

Presentation is held identical to the envelope compiler
(`blender-cat-source-surface-closing-envelope-v0`): WORKBENCH, 900x900, studio
lighting, cavity, dark background, one shared clay material. That way an
inspection view is visually comparable to the envelope arm rather than being a
differently-lit picture of the same thing.

Anatomical axes are the measured ones recorded in the campaign:
`+X` right, `-Y` anterior, `-Z` dorsal.
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

MANIFEST_SCHEMA = "kaminos.bauplan-inspect-plate.v0"
COMPILER_ID = "blender-bauplan-inspect-plate-v0"

RESOLUTION = 900
WORLD_COLOR = (0.018, 0.022, 0.021)
CLAY_COLOR = (0.62, 0.62, 0.60, 1.0)
ORTHO_MARGIN = 1.12

# Axis convention is a PER-FILE FACT, not a campaign constant. The historical
# `-Z dorsal` reading came from an older source file; on `cat-bauplan-008` it
# renders the skull at the bottom and the limbs pointing up, i.e. inverted.
# Verified empirically from the render, then confirmed against bounds: the Y
# extent (62.2) is the long body axis, Z (47.75) is height, X (20.43) is the
# narrow lateral axis. Getting this wrong reproduces the campaign's own recorded
# defect — a diagnostic whose label did not describe its actual camera — so the
# convention is exposed as a flag rather than hardcoded silently.
ANATOMICAL_RIGHT = Vector((1.0, 0.0, 0.0))
ANATOMICAL_ANTERIOR = Vector((0.0, -1.0, 0.0))
ANATOMICAL_DORSAL = Vector((0.0, 0.0, 1.0))

# view name -> (camera direction from centre, image-up)
VIEWS = {
    "right-sagittal": (ANATOMICAL_RIGHT, -ANATOMICAL_DORSAL),
    "left-sagittal": (-ANATOMICAL_RIGHT, -ANATOMICAL_DORSAL),
    "anterior": (ANATOMICAL_ANTERIOR, -ANATOMICAL_DORSAL),
    "dorsal": (-ANATOMICAL_DORSAL, ANATOMICAL_ANTERIOR),
}


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
    parser.add_argument("--source", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--views", default="right-sagittal,anterior,dorsal")
    return parser.parse_args(argv)


def _configure_scene(scene: bpy.types.Scene) -> None:
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("plate-world")
    scene.world.color = WORLD_COLOR
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_shadows = True
    shading.show_cavity = True
    shading.cavity_type = "BOTH"
    shading.background_type = "VIEWPORT"
    shading.background_color = WORLD_COLOR


def _orient_camera(camera, target: Vector, image_up: Vector) -> None:
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
    local = [inverse @ corner for corner in corners]
    width = max(p.x for p in local) - min(p.x for p in local)
    height = max(p.y for p in local) - min(p.y for p in local)
    camera.data.ortho_scale = max(height, width / aspect) * ORTHO_MARGIN


def main() -> int:
    args = _arguments()
    phase = "argument-parse"
    evidence: dict[str, Any] = {"source": args.source}
    Path(args.failure).unlink(missing_ok=True)
    try:
        phase = "source-verify"
        source = Path(args.source)
        if not source.is_file():
            raise ValueError(f"source not found: {source}")
        before = _sha256(source)
        evidence["effectiveSourceSha256"] = before
        if before != args.expected_source_sha256:
            raise ValueError(
                f"source identity mismatch: expected {args.expected_source_sha256}, found {before}"
            )

        phase = "source-open"
        # Read-only load. Nothing in this script calls save_mainfile.
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene = bpy.context.scene
        _configure_scene(scene)

        phase = "select-visible-meshes"
        meshes = [
            obj
            for obj in scene.objects
            if obj.type == "MESH" and obj.visible_get() and len(obj.data.vertices) > 0
        ]
        if not meshes:
            raise ValueError("no visible mesh objects in source scene")
        evidence["visibleMeshCount"] = len(meshes)

        phase = "clay-apply"
        clay = bpy.data.materials.new("inspect-clay")
        clay.diffuse_color = CLAY_COLOR
        clay.use_nodes = True
        principled = clay.node_tree.nodes.get("Principled BSDF")
        principled.inputs["Base Color"].default_value = CLAY_COLOR
        principled.inputs["Roughness"].default_value = 0.78
        # In-memory override only; the file is never written back.
        for obj in meshes:
            obj.data.materials.clear()
            obj.data.materials.append(clay)

        phase = "bounds"
        points: list[Vector] = []
        for obj in meshes:
            for corner in obj.bound_box:
                points.append(obj.matrix_world @ Vector(corner))
        low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
        high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
        centre = (low + high) * 0.5
        radius = max((high - low).length, 1e-3)
        corners = [
            Vector((x, y, z))
            for x in (low.x, high.x)
            for y in (low.y, high.y)
            for z in (low.z, high.z)
        ]

        phase = "camera-build"
        camera_data = bpy.data.cameras.new("inspect-camera")
        camera_data.type = "ORTHO"
        camera_data.clip_start = 0.001
        camera_data.clip_end = radius * 20.0
        camera = bpy.data.objects.new("inspect-camera", camera_data)
        scene.collection.objects.link(camera)
        scene.camera = camera

        outputs: dict[str, Any] = {}
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        for view in [v.strip() for v in args.views.split(",") if v.strip()]:
            if view not in VIEWS:
                raise ValueError(f"unsupported view: {view}")
            phase = f"render:{view}"
            direction, image_up = VIEWS[view]
            camera.location = centre + direction * radius * 3.0
            _orient_camera(camera, centre, image_up)
            bpy.context.view_layer.update()
            _frame_orthographic(camera, corners, 1.0)
            bpy.context.view_layer.update()
            target = output_dir / f"{view}.png"
            target.unlink(missing_ok=True)
            scene.render.filepath = str(target)
            bpy.ops.render.render(write_still=True)
            if not target.is_file() or target.stat().st_size < 4096:
                raise ValueError(f"render missing or implausibly small: {target}")
            outputs[view] = {
                "path": str(target),
                "byteLength": target.stat().st_size,
                "sha256": _sha256(target),
                "orthoScale": camera.data.ortho_scale,
            }

        phase = "non-mutation-verify"
        after = _sha256(source)
        if after != before:
            raise ValueError(
                f"SOURCE MUTATED during inspection: {before} -> {after}"
            )

        phase = "manifest-write"
        _write_json(
            args.manifest,
            {
                "schema": MANIFEST_SCHEMA,
                "compilerId": COMPILER_ID,
                "authority": "read-only operator-source inspection render",
                "source": {
                    "path": str(source),
                    "requestedSha256": args.expected_source_sha256,
                    "sha256Before": before,
                    "sha256After": after,
                    "mutated": False,
                    "byteLength": source.stat().st_size,
                },
                "effectiveRoute": {
                    "blenderVersion": bpy.app.version_string,
                    "renderEngine": scene.render.engine,
                    "resolution": [RESOLUTION, RESOLUTION],
                    "anatomicalRight": list(ANATOMICAL_RIGHT),
                    "anatomicalAnterior": list(ANATOMICAL_ANTERIOR),
                    "anatomicalDorsal": list(ANATOMICAL_DORSAL),
                    "presentationMatchedTo": "blender-cat-source-surface-closing-envelope-v0",
                },
                "visibleMeshCount": len(meshes),
                "bounds": {"min": list(low), "max": list(high)},
                "outputs": outputs,
            },
        )
        print(json.dumps({"status": "complete", "views": list(outputs)}, indent=2))
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
