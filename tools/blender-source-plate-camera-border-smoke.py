from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import traceback

import bpy


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _material(name: str, color: tuple[float, float, float, float]):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = 1.0
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def _cube(name: str, location: tuple[float, float, float], scale, material) -> None:
    bpy.ops.mesh.primitive_cube_add(location=location, scale=scale)
    cube = bpy.context.object
    cube.name = name
    cube.data.materials.append(material)


def main() -> int:
    if "--" not in sys.argv or len(sys.argv) <= sys.argv.index("--") + 1:
        raise RuntimeError("expected evidence directory after --")
    evidence_root = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    evidence_root.mkdir(parents=True, exist_ok=False)
    report_path = evidence_root / "receipt.json"
    raw_path = evidence_root / "uncropped-border-render.png"
    plate_path = evidence_root / "uncropped-border-plate.png"
    repo_root = Path(__file__).resolve().parents[1]
    source_root = repo_root / "blender_addons"
    sys.path.insert(0, str(source_root))
    report = {
        "schema": "kaminos.source-plate-camera-border-smoke.v1",
        "status": "running",
        "blenderVersion": bpy.app.version_string,
        "repoRoot": str(repo_root),
        "worktree": str(repo_root),
        "command": " ".join(sys.argv),
        "backend": "Blender background; effective render engine recorded after selection",
        "requested": {
            "sourceWidth": 640,
            "sourceHeight": 360,
            "targetWidth": 512,
            "targetHeight": 512,
            "useBorder": True,
            "useCropToBorder": False,
            "border": {"minX": 0.18, "maxX": 0.82, "minY": 0.2, "maxY": 0.8},
        },
    }
    try:
        core_path = source_root / "kaminos_source_plate" / "capture_core.py"
        spec = importlib.util.spec_from_file_location(
            "kaminos_source_plate_camera_border_smoke_core", core_path
        )
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load exact capture core: {core_path}")
        core = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = core
        spec.loader.exec_module(core)
        report["effectiveSource"] = {
            "captureCorePath": str(Path(core.__file__).resolve()),
            "captureCoreSha256": _sha256(core_path),
        }

        report["commit"] = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        available_engines = {
            item.identifier
            for item in scene.render.bl_rna.properties["engine"].enum_items
        }
        effective_engine = (
            "BLENDER_EEVEE_NEXT"
            if "BLENDER_EEVEE_NEXT" in available_engines
            else "BLENDER_EEVEE"
        )
        scene.render.engine = effective_engine
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "8"
        scene.render.film_transparent = False
        if scene.world is None:
            scene.world = bpy.data.worlds.new("SmokeWorld")
        scene.world.color = (0.005, 0.008, 0.015)

        camera_data = bpy.data.cameras.new("SmokeCamera")
        camera = bpy.data.objects.new("SmokeCamera", camera_data)
        scene.collection.objects.link(camera)
        scene.camera = camera
        camera.location = (0.0, 0.0, 6.0)
        camera.rotation_euler = (0.0, 0.0, 0.0)
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 7.0

        _cube("WideRed", (-1.45, 0.15, 0.0), (1.15, 0.72, 0.35), _material("Red", (0.8, 0.04, 0.02, 1.0)))
        _cube("TallGreen", (1.35, -0.05, 0.0), (0.48, 1.28, 0.35), _material("Green", (0.02, 0.75, 0.12, 1.0)))
        _cube("BlueMarker", (0.15, 1.1, 0.2), (0.28, 0.28, 0.55), _material("Blue", (0.04, 0.16, 0.95, 1.0)))

        snapshot = {
            "filepath": scene.render.filepath,
            "resolution_x": scene.render.resolution_x,
            "resolution_y": scene.render.resolution_y,
            "resolution_percentage": scene.render.resolution_percentage,
            "pixel_aspect_x": scene.render.pixel_aspect_x,
            "pixel_aspect_y": scene.render.pixel_aspect_y,
            "use_border": scene.render.use_border,
            "use_crop_to_border": scene.render.use_crop_to_border,
            "border_min_x": scene.render.border_min_x,
            "border_max_x": scene.render.border_max_x,
            "border_min_y": scene.render.border_min_y,
            "border_max_y": scene.render.border_max_y,
        }
        plan = core.camera_frame_capture_plan(
            source_width=640,
            source_height=360,
            pixel_aspect_x=1.0,
            pixel_aspect_y=1.0,
            target_width=512,
            target_height=512,
            use_border=True,
            use_crop_to_border=False,
            border_min_x=0.18,
            border_max_x=0.82,
            border_min_y=0.2,
            border_max_y=0.8,
        )
        try:
            scene.render.filepath = str(raw_path)
            scene.render.resolution_x = plan["renderWidth"]
            scene.render.resolution_y = plan["renderHeight"]
            scene.render.resolution_percentage = 100
            scene.render.pixel_aspect_x = 1.0
            scene.render.pixel_aspect_y = 1.0
            scene.render.use_border = plan["useBorder"]
            scene.render.use_crop_to_border = plan["cropToBorder"]
            scene.render.border_min_x = plan["border"]["minX"]
            scene.render.border_max_x = plan["border"]["maxX"]
            scene.render.border_min_y = plan["border"]["minY"]
            scene.render.border_max_y = plan["border"]["maxY"]
            result = bpy.ops.render.render(write_still=True)
            if "FINISHED" not in result:
                raise RuntimeError(f"Blender render returned {sorted(result)}")
            raw_record = core.inspect_png(
                raw_path,
                expected_width=plan["expectedContentWidth"],
                expected_height=plan["expectedContentHeight"],
            )
            placement = core.letterbox_png(
                raw_path,
                plate_path,
                target_width=512,
                target_height=512,
            )
            plate_record = core.inspect_png(
                plate_path, expected_width=512, expected_height=512
            )
        finally:
            for key, value in snapshot.items():
                setattr(scene.render, key, value)
        restored = all(getattr(scene.render, key) == value for key, value in snapshot.items())
        if plan["frame"] != "camera-frame-with-render-border" or plan["cropToBorder"]:
            raise RuntimeError("uncropped-border capture plan was not preserved")
        if not restored:
            raise RuntimeError("render settings were not restored")
        if raw_record["uniform"] or plate_record["uniform"]:
            raise RuntimeError("visual witness is uniform")
        report.update(
            status="completed",
            effective={
                "renderEngine": effective_engine,
                "plan": plan,
                "raw": {**raw_record, "path": str(raw_path), "sha256": _sha256(raw_path)},
                "plate": {**plate_record, "path": str(plate_path), "sha256": _sha256(plate_path)},
                "placement": placement,
                "renderSettingsRestored": restored,
            },
            claimCeiling=(
                "Exact Blender background uncropped-border route only; does not establish arbitrary scenes, "
                "Blender versions, interactive viewport state, or operator morphology quality."
            ),
        )
        return_code = 0
    except Exception as error:
        report.update(
            status="failed",
            failure={
                "phase": "uncropped-border-smoke",
                "errorType": type(error).__name__,
                "message": str(error),
                "traceback": traceback.format_exc(),
            },
        )
        return_code = 1
    finally:
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(report, sort_keys=True))
    return return_code


raise SystemExit(main())
