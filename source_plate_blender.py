"""Blender-side source-plate application and render adapter.

Invoke from a source already loaded by Blender::

    blender --background source.blend --python source_plate_blender.py -- \
        descriptor.json output-directory

The adapter only mutates Blender's in-memory scene.  Workbench state and render
products are caller-addressed; the loaded source is never saved.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import traceback
from typing import Any, Mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))

from source_plate_core import (
    SourcePlateContractError,
    descriptor_sha256,
    read_descriptor,
    require_effective_renderer,
    validate_complete_outputs,
    verify_source_freshness,
)


REPORT_SCHEMA = "kaminos.source-plate-render-report.v0"


def channel_paths(output_dir: str | Path) -> dict[str, Path]:
    """Return the canonical caller-addressed artifacts for a four-channel plate."""
    root = Path(output_dir).expanduser().resolve()
    return {
        "rgb": root / "rgb.png",
        "silhouette": root / "silhouette.png",
        "depth": root / "depth.exr",
        "normal": root / "normal.exr",
    }


def failure_document(
    *,
    descriptor_path: str | Path,
    output_dir: str | Path,
    phase: str,
    error: BaseException,
    last_trustworthy_evidence: dict[str, Any],
) -> dict[str, Any]:
    """Build the durable report written when Blender exits before completion."""
    return {
        "schema": REPORT_SCHEMA,
        "status": "failed",
        "failurePhase": phase,
        "requested": {
            "descriptorPath": str(Path(descriptor_path).expanduser().resolve()),
            "outputDirectory": str(Path(output_dir).expanduser().resolve()),
        },
        "lastTrustworthyEvidence": last_trustworthy_evidence,
        "error": {"type": type(error).__name__, "message": str(error)},
    }


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(value, temporary, indent=2, sort_keys=True, allow_nan=False)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, path)
    except Exception:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise


def _sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    byte_length = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
            byte_length += len(block)
    return digest.hexdigest(), byte_length


def _vector(value: Any, *, length: int, field: str) -> list[float]:
    if (
        not isinstance(value, list)
        or len(value) != length
        or any(type(component) not in (int, float) for component in value)
    ):
        raise SourcePlateContractError(
            "descriptor-application", f"{field} must contain {length} numbers"
        )
    return [float(component) for component in value]


def _color_for_object(obj: Any) -> tuple[float, float, float, float]:
    collections = {collection.name for collection in obj.users_collection}
    if "20 Muscle" in collections:
        return (0.63, 0.16, 0.10, 1.0)
    if "30 Tendon + Constraint" in collections:
        return (0.84, 0.69, 0.42, 1.0)
    if "Attachment Patches" in collections:
        return (0.72, 0.78, 0.85, 1.0)
    return (0.83, 0.78, 0.67, 1.0)


def _apply_selection(bpy: Any, descriptor: Mapping[str, Any]) -> dict[str, Any]:
    source = descriptor.get("source")
    selection = source.get("selection") if isinstance(source, Mapping) else None
    if not isinstance(selection, Mapping):
        raise SourcePlateContractError(
            "source-selection", "descriptor source.selection is missing"
        )
    requested_collections = selection.get("collections")
    requested_objects = selection.get("objects")
    if not isinstance(requested_collections, list) or not all(
        isinstance(name, str) and name for name in requested_collections
    ):
        raise SourcePlateContractError(
            "source-selection", "source.selection.collections must be a string list"
        )
    if not isinstance(requested_objects, list) or not all(
        isinstance(name, str) and name for name in requested_objects
    ):
        raise SourcePlateContractError(
            "source-selection", "source.selection.objects must be a string list"
        )
    missing_collections = sorted(set(requested_collections) - set(bpy.data.collections.keys()))
    missing_objects = sorted(set(requested_objects) - set(bpy.data.objects.keys()))
    if missing_collections or missing_objects:
        raise SourcePlateContractError(
            "source-selection",
            "source selection is stale: "
            f"missing collections={missing_collections}, missing objects={missing_objects}",
        )
    requested_object_set = set(requested_objects)
    effective_objects: list[str] = []
    for obj in bpy.context.scene.objects:
        selected = obj.type == "MESH" and obj.name in requested_object_set
        obj.hide_render = not selected
        if selected:
            obj.pass_index = 1
            effective_objects.append(obj.name)
    if sorted(effective_objects) != sorted(requested_objects):
        raise SourcePlateContractError(
            "source-selection", "effective mesh selection differs from the descriptor"
        )
    return {
        "requestedCollections": requested_collections,
        "effectiveCollections": requested_collections,
        "requestedObjects": requested_objects,
        "effectiveObjects": sorted(effective_objects),
    }


def _apply_camera(bpy: Any, descriptor: Mapping[str, Any]) -> tuple[Any, dict[str, Any]]:
    camera_contract = descriptor.get("camera")
    if not isinstance(camera_contract, Mapping):
        raise SourcePlateContractError("descriptor-application", "camera contract is missing")
    projection = camera_contract.get("projection")
    if projection not in {"orthographic", "perspective"}:
        raise SourcePlateContractError(
            "descriptor-application", "camera projection must be orthographic or perspective"
        )
    location = _vector(camera_contract.get("location"), length=3, field="camera.location")
    rotation = _vector(
        camera_contract.get("rotationEuler"), length=3, field="camera.rotationEuler"
    )
    camera_data = bpy.data.cameras.new("SOURCE_PLATE_CAMERA")
    camera = bpy.data.objects.new("SOURCE_PLATE_CAMERA", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera.location = location
    camera.rotation_mode = "XYZ"
    camera.rotation_euler = rotation
    camera_data.clip_start = float(camera_contract.get("clipStart", 0.01))
    camera_data.clip_end = float(camera_contract.get("clipEnd", 1000.0))
    if projection == "orthographic":
        ortho_scale = camera_contract.get("orthoScale")
        if type(ortho_scale) not in (int, float) or ortho_scale <= 0:
            raise SourcePlateContractError(
                "descriptor-application", "orthographic camera needs positive orthoScale"
            )
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = float(ortho_scale)
    else:
        focal_length = camera_contract.get("focalLengthMm")
        if type(focal_length) not in (int, float) or focal_length <= 0:
            raise SourcePlateContractError(
                "descriptor-application", "perspective camera needs positive focalLengthMm"
            )
        camera_data.type = "PERSP"
        camera_data.lens = float(focal_length)
    effective = {
        "projection": projection,
        "location": list(camera.location),
        "rotationEuler": list(camera.rotation_euler),
        "clipStart": camera_data.clip_start,
        "clipEnd": camera_data.clip_end,
        "framing": camera_contract.get("framing"),
    }
    if projection == "orthographic":
        effective["orthoScale"] = camera_data.ortho_scale
    else:
        effective["focalLengthMm"] = camera_data.lens
    return camera, effective


def _material(bpy: Any, name: str, color: tuple[float, float, float, float]) -> Any:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.72
    principled.inputs["Metallic"].default_value = 0.0
    return material


def _apply_materials(bpy: Any, selection: Mapping[str, Any]) -> dict[str, Any]:
    material_cache: dict[tuple[float, float, float, float], Any] = {}
    for object_name in selection["effectiveObjects"]:
        obj = bpy.data.objects[object_name]
        color = _color_for_object(obj)
        material = material_cache.get(color)
        if material is None:
            material = _material(bpy, f"SOURCE_PLATE_MATERIAL_{len(material_cache):02d}", color)
            material_cache[color] = material
        obj.data.materials.clear()
        obj.data.materials.append(material)
    return {
        "materialMode": "object_color",
        "materialCount": len(material_cache),
        "objectCount": len(selection["effectiveObjects"]),
    }


def _apply_lighting(bpy: Any, descriptor: Mapping[str, Any]) -> dict[str, Any]:
    lighting = descriptor.get("lighting")
    if not isinstance(lighting, Mapping) or lighting.get("preset") != "restrained-studio":
        raise SourcePlateContractError(
            "descriptor-application", "only restrained-studio lighting is supported"
        )
    lights = lighting.get("lights")
    if not isinstance(lights, list) or not lights:
        raise SourcePlateContractError(
            "descriptor-application", "lighting contract needs at least one light"
        )
    for obj in bpy.context.scene.objects:
        if obj.type == "LIGHT":
            obj.hide_render = True
    effective_lights: list[dict[str, Any]] = []
    for index, light_contract in enumerate(lights):
        if not isinstance(light_contract, Mapping):
            raise SourcePlateContractError(
                "descriptor-application", "each lighting entry must be an object"
            )
        light_type = light_contract.get("type")
        if light_type not in {"AREA", "POINT", "SUN"}:
            raise SourcePlateContractError(
                "descriptor-application", f"unsupported light type {light_type}"
            )
        name = str(light_contract.get("name") or f"light-{index}")
        location = _vector(
            light_contract.get("location"), length=3, field=f"lighting.{name}.location"
        )
        rotation = _vector(
            light_contract.get("rotationEuler"),
            length=3,
            field=f"lighting.{name}.rotationEuler",
        )
        energy = light_contract.get("energy")
        if type(energy) not in (int, float) or energy <= 0:
            raise SourcePlateContractError(
                "descriptor-application", f"lighting.{name}.energy must be positive"
            )
        data = bpy.data.lights.new(f"SOURCE_PLATE_{name}", type=light_type)
        data.energy = float(energy)
        if light_type == "AREA":
            data.shape = "DISK"
            data.size = float(light_contract.get("size", 20.0))
        obj = bpy.data.objects.new(f"SOURCE_PLATE_{name}", data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rotation
        effective_lights.append(
            {
                "name": name,
                "type": light_type,
                "location": list(obj.location),
                "rotationEuler": list(obj.rotation_euler),
                "energy": data.energy,
                "size": data.size if light_type == "AREA" else None,
            }
        )
    return {"preset": "restrained-studio", "lights": effective_lights}


def _apply_presentation(bpy: Any, descriptor: Mapping[str, Any]) -> dict[str, Any]:
    presentation = descriptor.get("presentation")
    if not isinstance(presentation, Mapping):
        raise SourcePlateContractError(
            "descriptor-application", "presentation contract is missing"
        )
    background = presentation.get("background")
    if not isinstance(background, Mapping) or background.get("mode") != "color":
        raise SourcePlateContractError(
            "descriptor-application", "only color background presentation is supported"
        )
    color = _vector(background.get("color"), length=4, field="background.color")
    world = bpy.context.scene.world or bpy.data.worlds.new("SOURCE_PLATE_WORLD")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = color
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22
    floor = presentation.get("floor")
    shadow = presentation.get("shadow")
    floor_enabled = isinstance(floor, Mapping) and floor.get("enabled") is True
    shadow_enabled = isinstance(shadow, Mapping) and shadow.get("enabled") is True
    if floor_enabled:
        floor_height = floor.get("height")
        if type(floor_height) not in (int, float):
            raise SourcePlateContractError(
                "descriptor-application", "enabled floor needs numeric height"
            )
        bpy.ops.mesh.primitive_plane_add(size=float(floor.get("size", 200.0)))
        floor_object = bpy.context.active_object
        floor_object.name = "SOURCE_PLATE_FLOOR"
        floor_object.location.z = float(floor_height)
        floor_object.pass_index = 0
        floor_material = _material(bpy, "SOURCE_PLATE_FLOOR_MATERIAL", (0.18, 0.19, 0.20, 1.0))
        floor_object.data.materials.append(floor_material)
    return {
        "materialMode": presentation.get("materialMode"),
        "floor": {"enabled": floor_enabled},
        "shadow": {"enabled": shadow_enabled},
        "background": {"mode": "color", "color": color},
    }


def _write_silhouette_mask(bpy: Any, source_path: Path, output_path: Path) -> None:
    source_image = bpy.data.images.load(str(source_path), check_existing=False)
    width, height = source_image.size
    source_pixels = list(source_image.pixels)
    mask_pixels = [0.0] * len(source_pixels)
    for index in range(0, len(source_pixels), 4):
        value = 1.0 if source_pixels[index + 3] > 0.0 else 0.0
        mask_pixels[index] = value
        mask_pixels[index + 1] = value
        mask_pixels[index + 2] = value
        mask_pixels[index + 3] = 1.0
    mask_image = bpy.data.images.new(
        "SOURCE_PLATE_SILHOUETTE",
        width=width,
        height=height,
        alpha=True,
        float_buffer=False,
    )
    try:
        mask_image.pixels.foreach_set(mask_pixels)
        mask_image.file_format = "PNG"
        mask_image.filepath_raw = str(output_path)
        mask_image.save()
    finally:
        bpy.data.images.remove(mask_image)
        bpy.data.images.remove(source_image)


def _record_outputs(descriptor: Mapping[str, Any], paths: Mapping[str, Path]) -> dict[str, Any]:
    identity = descriptor_sha256(descriptor)
    render = descriptor["render"]
    encoding_by_channel = {
        channel["name"]: channel["encoding"] for channel in descriptor["channels"]
    }
    records: dict[str, Any] = {}
    for name, path in paths.items():
        sha256, byte_length = _sha256_file(path)
        records[name] = {
            "status": "complete",
            "path": str(path.resolve()),
            "encoding": encoding_by_channel[name],
            "width": render["width"],
            "height": render["height"],
            "byteLength": byte_length,
            "sha256": sha256,
            "descriptorSha256": identity,
        }
    return records


def render_descriptor(
    *, descriptor_path: Path, output_dir: Path, bpy: Any
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "render-report.json"
    outputs = channel_paths(output_dir)
    for path in [*outputs.values(), report_path]:
        path.unlink(missing_ok=True)
    for pattern in ("silhouette*.png", "depth*.exr", "normal*.exr"):
        for path in output_dir.glob(pattern):
            path.unlink()

    phase = "descriptor-read"
    last: dict[str, Any] = {
        "descriptorPath": str(descriptor_path.resolve()),
        "effectiveSourcePath": str(Path(bpy.data.filepath).resolve()),
    }
    try:
        descriptor = read_descriptor(descriptor_path)
        identity = descriptor_sha256(descriptor)
        last["descriptorSha256"] = identity

        phase = "source-freshness"
        source_receipt = verify_source_freshness(descriptor, bpy.data.filepath)
        last["source"] = source_receipt

        phase = "source-selection"
        selection_receipt = _apply_selection(bpy, descriptor)
        last["selection"] = selection_receipt

        phase = "descriptor-application"
        scene = bpy.context.scene
        render = descriptor.get("render")
        if not isinstance(render, Mapping):
            raise SourcePlateContractError("descriptor-application", "render contract is missing")
        scene.render.resolution_x = int(render["width"])
        scene.render.resolution_y = int(render["height"])
        scene.render.resolution_percentage = 100
        scene.render.engine = str(render["requestedRenderer"])
        renderer_receipt = require_effective_renderer(descriptor, scene.render.engine)
        last["renderer"] = renderer_receipt
        _camera, camera_receipt = _apply_camera(bpy, descriptor)
        material_receipt = _apply_materials(bpy, selection_receipt)
        lighting_receipt = _apply_lighting(bpy, descriptor)
        presentation_receipt = _apply_presentation(bpy, descriptor)
        last["camera"] = camera_receipt
        last["lighting"] = lighting_receipt
        last["presentation"] = presentation_receipt
        last["materials"] = material_receipt

        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.color_depth = "8"
        scene.render.film_transparent = False
        scene.render.filepath = str(outputs["rgb"])
        scene.render.use_file_extension = True
        scene.render.engine = str(render["requestedRenderer"])
        try:
            scene.view_settings.look = "AgX - Medium High Contrast"
        except TypeError:
            scene.view_settings.look = "AgX - Medium High Contrast"
        phase = "render"
        bpy.ops.render.render(write_still=True)

        view_layer = bpy.context.view_layer
        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "32"
        view_layer.use_pass_z = True
        view_layer.use_pass_normal = False
        scene.render.filepath = str(outputs["depth"])
        bpy.ops.render.render(write_still=True)

        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "32"
        view_layer.use_pass_z = False
        view_layer.use_pass_normal = True
        scene.render.filepath = str(outputs["normal"])
        bpy.ops.render.render(write_still=True)

        view_layer.use_pass_normal = False
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "8"
        scene.render.film_transparent = True
        scene.render.filepath = str(outputs["silhouette"])
        bpy.ops.render.render(write_still=True)
        _write_silhouette_mask(
            bpy, outputs["silhouette"], outputs["silhouette"]
        )

        phase = "output-validation"
        output_records = _record_outputs(descriptor, outputs)
        validation = validate_complete_outputs(descriptor, output_records)
        report = {
            "schema": REPORT_SCHEMA,
            "status": "complete",
            "requested": {
                "descriptorPath": str(descriptor_path.resolve()),
                "descriptorSha256": identity,
                "sourcePath": descriptor["source"]["requestedPath"],
                "renderer": render["requestedRenderer"],
                "channels": [channel["name"] for channel in descriptor["channels"]],
                "outputDirectory": str(output_dir.resolve()),
            },
            "effective": {
                "descriptorSha256": identity,
                "source": source_receipt,
                "selection": selection_receipt,
                "camera": camera_receipt,
                "renderer": renderer_receipt,
                "lighting": lighting_receipt,
                "presentation": presentation_receipt,
                "materials": material_receipt,
                "blenderVersion": bpy.app.version_string,
            },
            "outputs": validation,
        }
        _atomic_json(report_path, report)
        return report
    except BaseException as error:
        failure_phase = error.phase if isinstance(error, SourcePlateContractError) else phase
        failure = failure_document(
            descriptor_path=descriptor_path,
            output_dir=output_dir,
            phase=failure_phase,
            error=error,
            last_trustworthy_evidence=last,
        )
        failure["traceback"] = traceback.format_exc()
        _atomic_json(report_path, failure)
        raise


def _main() -> int:
    separator = sys.argv.index("--") if "--" in sys.argv else -1
    arguments = sys.argv[separator + 1 :] if separator >= 0 else []
    if len(arguments) != 2:
        print(
            "usage: blender ... --python source_plate_blender.py -- DESCRIPTOR OUTPUT_DIR",
            file=sys.stderr,
        )
        return 2
    descriptor_path = Path(arguments[0]).expanduser().resolve()
    output_dir = Path(arguments[1]).expanduser().resolve()
    try:
        import bpy

        report = render_descriptor(
            descriptor_path=descriptor_path, output_dir=output_dir, bpy=bpy
        )
    except BaseException as error:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "report": str(output_dir / "render-report.json"),
                    "error": str(error),
                }
            ),
            file=sys.stderr,
            flush=True,
        )
        return 1
    print(
        json.dumps(
            {
                "status": report["status"],
                "report": str(output_dir / "render-report.json"),
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
