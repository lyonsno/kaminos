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
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
import traceback
from typing import Any, Callable, Mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))

from source_plate_core import (
    SourcePlateContractError,
    descriptor_sha256,
    read_descriptor,
    require_effective_renderer,
    validate_complete_outputs,
    validate_transform_contracts,
    verify_source_freshness,
    verify_source_unchanged,
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
    descriptor_path: str | Path | None,
    output_dir: str | Path | None,
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
            "descriptorPath": str(Path(descriptor_path).expanduser().resolve())
            if descriptor_path is not None
            else None,
            "outputDirectory": str(Path(output_dir).expanduser().resolve())
            if output_dir is not None
            else None,
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
    requested_objects = selection.get("objects", [])
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
    for collection_name in requested_collections:
        collection = bpy.data.collections[collection_name]
        requested_object_set.update(
            obj.name for obj in collection.all_objects if obj.type == "MESH"
        )
    effective_objects: list[str] = []
    for obj in bpy.context.scene.objects:
        selected = obj.type == "MESH" and obj.name in requested_object_set
        obj.hide_render = not selected
        if selected:
            obj.pass_index = 1
            effective_objects.append(obj.name)
    if sorted(effective_objects) != sorted(requested_object_set):
        raise SourcePlateContractError(
            "source-selection", "effective mesh selection differs from the descriptor"
        )
    return {
        "requestedCollections": requested_collections,
        "effectiveCollections": requested_collections,
        "requestedObjects": requested_objects,
        "resolvedObjects": sorted(requested_object_set),
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
    camera_data.sensor_width = float(camera_contract["sensorWidthMm"])
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
        "target": list(camera_contract["target"]),
        "sensorWidthMm": camera_data.sensor_width,
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


def _apply_materials(
    bpy: Any, selection: Mapping[str, Any], descriptor: Mapping[str, Any]
) -> dict[str, Any]:
    presentation = descriptor.get("presentation")
    if not isinstance(presentation, Mapping):
        raise SourcePlateContractError(
            "descriptor-application", "presentation contract is missing"
        )
    material_mode = presentation.get("materialMode")
    if material_mode not in {"object_color", "neutral_clay"}:
        raise SourcePlateContractError(
            "descriptor-application",
            "presentation.materialMode must be object_color or neutral_clay",
        )
    clay_color = None
    if material_mode == "neutral_clay":
        clay_color = _vector(
            presentation.get("clayColor"), length=4, field="presentation.clayColor"
        )
    material_cache: dict[tuple[float, float, float, float], Any] = {}
    for object_name in selection["effectiveObjects"]:
        obj = bpy.data.objects[object_name]
        color = tuple(clay_color) if clay_color is not None else _color_for_object(obj)
        material = material_cache.get(color)
        if material is None:
            material = _material(bpy, f"SOURCE_PLATE_MATERIAL_{len(material_cache):02d}", color)
            material_cache[color] = material
        obj.data.materials.clear()
        obj.data.materials.append(material)
    return {
        "materialMode": material_mode,
        "clayColor": clay_color,
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


def _emission_material(bpy: Any, name: str) -> tuple[Any, Any, Any]:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material, tree, emission


def _depth_material(bpy: Any) -> Any:
    material, tree, emission = _emission_material(bpy, "SOURCE_PLATE_DEPTH")
    camera_data = tree.nodes.new("ShaderNodeCameraData")
    tree.links.new(camera_data.outputs["View Z Depth"], emission.inputs["Color"])
    return material


def _normal_material(bpy: Any) -> Any:
    material, tree, emission = _emission_material(bpy, "SOURCE_PLATE_NORMAL")
    geometry = tree.nodes.new("ShaderNodeNewGeometry")
    transform = tree.nodes.new("ShaderNodeVectorTransform")
    transform.vector_type = "NORMAL"
    transform.convert_from = "WORLD"
    transform.convert_to = "CAMERA"
    multiply = tree.nodes.new("ShaderNodeVectorMath")
    multiply.operation = "MULTIPLY"
    multiply.inputs[1].default_value = (0.5, 0.5, 0.5)
    add = tree.nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    add.inputs[1].default_value = (0.5, 0.5, 0.5)
    tree.links.new(geometry.outputs["True Normal"], transform.inputs["Vector"])
    tree.links.new(transform.outputs["Vector"], multiply.inputs[0])
    tree.links.new(multiply.outputs["Vector"], add.inputs[0])
    tree.links.new(add.outputs["Vector"], emission.inputs["Color"])
    return material


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


def _inspect_rendered_output(
    bpy: Any,
    name: str,
    path: Path,
    channel_contract: Mapping[str, Any],
) -> dict[str, Any]:
    """Decode one rendered artifact and measure the channel it actually contains."""
    expected_encoding = channel_contract.get("encoding")
    expected_format = {"png": "PNG", "openexr": "OPEN_EXR"}.get(expected_encoding)
    if expected_format is None:
        raise SourcePlateContractError(
            "output-validation", f"unsupported encoding contract for {name}: {expected_encoding}"
        )
    try:
        image = bpy.data.images.load(str(path), check_existing=False)
    except Exception as error:
        raise SourcePlateContractError(
            "output-validation", f"output {name} could not be decoded: {error}"
        ) from error
    try:
        width, height = (int(image.size[0]), int(image.size[1]))
        measured_format = str(image.file_format)
        channels = int(getattr(image, "channels", 4))
        pixels = [float(value) for value in image.pixels]
    finally:
        bpy.data.images.remove(image)
    if measured_format != expected_format:
        raise SourcePlateContractError(
            "output-validation",
            f"output {name} format is {measured_format}, expected {expected_format}",
        )
    if width <= 0 or height <= 0 or channels < 3:
        raise SourcePlateContractError(
            "output-validation", f"output {name} has invalid decoded dimensions/channels"
        )
    if len(pixels) < width * height * channels:
        raise SourcePlateContractError(
            "output-validation", f"output {name} decoded pixel buffer is partial"
        )
    rgb = [
        tuple(pixels[index : index + 3])
        for index in range(0, width * height * channels, channels)
    ]
    flat = [component for pixel in rgb for component in pixel]
    if not flat or any(not math.isfinite(component) for component in flat):
        raise SourcePlateContractError(
            "output-validation", f"output {name} contains no finite RGB samples"
        )
    component_min = min(flat)
    component_max = max(flat)
    representation = channel_contract.get("representation")
    measurement: dict[str, Any] = {
        "measurementSource": "decoded-pixels",
        "measuredEncoding": expected_encoding,
        "width": width,
        "height": height,
        "componentRange": [component_min, component_max],
        "representation": representation,
        "representationValidated": True,
    }
    if name == "rgb":
        nonblank = component_max - component_min > 1.0e-5
        if not nonblank:
            raise SourcePlateContractError("output-validation", "output rgb is blank")
    elif name == "silhouette":
        tolerance = 1.0e-3
        nonbinary = [
            value
            for pixel in rgb
            for value in pixel
            if abs(value) > tolerance and abs(value - 1.0) > tolerance
        ]
        foreground = any(value > 1.0 - tolerance for pixel in rgb for value in pixel)
        background = any(abs(value) <= tolerance for pixel in rgb for value in pixel)
        if nonbinary or not foreground or not background:
            raise SourcePlateContractError(
                "output-validation", "output silhouette is blank or non-binary"
            )
        nonblank = True
        measurement["binaryCoverage"] = True
    elif name == "depth":
        if representation != "metric_camera_z_rgb":
            raise SourcePlateContractError(
                "output-validation", "depth representation is not metric camera Z"
            )
        if component_min < -1.0e-6 or component_max <= 1.0e-6:
            raise SourcePlateContractError(
                "output-validation", "output depth has no positive metric samples"
            )
        nonblank = True
        measurement["positiveMetricSamples"] = sum(
            1 for value in flat if value > 1.0e-6
        )
    elif name == "normal":
        if representation == "camera_space_unit_normal_rgb":
            vectors = [
                pixel
                for pixel in rgb
                if math.sqrt(sum(component * component for component in pixel)) > 1.0e-6
            ]
            if component_min >= -1.0e-5:
                raise SourcePlateContractError(
                    "output-validation",
                    "output normal is not signed camera-space unit normal data",
                )
        elif representation == "camera_space_unit_normal_rgb_encoded_0_1":
            if component_min < -1.0e-6 or component_max > 1.0 + 1.0e-6:
                raise SourcePlateContractError(
                    "output-validation", "encoded normal leaves the declared 0..1 range"
                )
            encoded_vectors = [pixel for pixel in rgb if max(pixel) > 1.0e-6]
            vectors = [
                tuple(component * 2.0 - 1.0 for component in pixel)
                for pixel in encoded_vectors
            ]
            decoded_flat = [component for pixel in vectors for component in pixel]
            measurement["decodeFormula"] = "signed = encoded * 2 - 1"
            measurement["decodedComponentRange"] = [
                min(decoded_flat) if decoded_flat else None,
                max(decoded_flat) if decoded_flat else None,
            ]
        else:
            raise SourcePlateContractError(
                "output-validation", "normal representation is unsupported"
            )
        lengths = [
            math.sqrt(sum(component * component for component in pixel))
            for pixel in vectors
        ]
        unit_lengths = [length for length in lengths if abs(length - 1.0) <= 0.05]
        if (
            not unit_lengths
            or len(unit_lengths) < max(1, len(lengths) // 2)
            or min(component for pixel in vectors for component in pixel) < -1.001
            or max(component for pixel in vectors for component in pixel) > 1.001
        ):
            raise SourcePlateContractError(
                "output-validation", "output normal is not signed camera-space unit normal data"
            )
        nonblank = True
        measurement["unitVectorSamples"] = len(unit_lengths)
        measurement["nonzeroVectorSamples"] = len(lengths)
        measurement["maxUnitLengthError"] = max(
            abs(length - 1.0) for length in unit_lengths
        )
    else:
        raise SourcePlateContractError(
            "output-validation", f"unsupported output channel {name}"
        )
    measurement["nonblank"] = nonblank
    return measurement


def _record_outputs(
    bpy: Any, descriptor: Mapping[str, Any], paths: Mapping[str, Path]
) -> dict[str, Any]:
    identity = descriptor_sha256(descriptor)
    channel_by_name = {
        channel["name"]: channel for channel in descriptor["channels"]
    }
    records: dict[str, Any] = {}
    for name, path in paths.items():
        channel_contract = channel_by_name[name]
        measurement = _inspect_rendered_output(bpy, name, path, channel_contract)
        sha256, byte_length = _sha256_file(path)
        records[name] = {
            "status": "complete",
            "path": str(path.resolve()),
            "encoding": measurement["measuredEncoding"],
            "byteLength": byte_length,
            "sha256": sha256,
            "descriptorSha256": identity,
            **measurement,
        }
    return records


def _promote_staged_run(
    *,
    staging_dir: Path,
    output_dir: Path,
    report_path: Path,
    report: Mapping[str, Any],
    replace: Callable[[str | Path, str | Path], None] = os.replace,
) -> None:
    """Promote a validated product directory, rolling back on any finalization fault."""
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    backup_dir = output_dir.with_name(f".{output_dir.name}.previous")
    if backup_dir.exists():
        raise SourcePlateContractError(
            "output-promotion", f"stale promotion backup exists: {backup_dir}"
        )
    had_previous = output_dir.exists()
    promoted = False
    try:
        if had_previous:
            replace(output_dir, backup_dir)
        replace(staging_dir, output_dir)
        promoted = True
        _atomic_json(report_path, report)
    except BaseException:
        if promoted and output_dir.exists():
            replace(output_dir, staging_dir)
        if had_previous and backup_dir.exists():
            replace(backup_dir, output_dir)
        raise
    if backup_dir.exists():
        shutil.rmtree(backup_dir)


def _parse_cli_arguments(arguments: list[str]) -> dict[str, Path]:
    values: dict[str, str] = {}
    allowed = {"--descriptor", "--out-dir", "--report", "--failure-report"}
    index = 0
    while index < len(arguments):
        flag = arguments[index]
        if flag not in allowed:
            raise SourcePlateContractError(
                "argument-validation", f"unexpected argument {flag}"
            )
        if flag in values:
            raise SourcePlateContractError(
                "argument-validation", f"duplicate argument {flag}"
            )
        if index + 1 >= len(arguments) or arguments[index + 1] in allowed:
            raise SourcePlateContractError(
                "argument-validation", f"{flag} requires a path"
            )
        values[flag] = arguments[index + 1]
        index += 2
    missing = [
        flag for flag in ("--descriptor", "--out-dir", "--report") if flag not in values
    ]
    if missing:
        raise SourcePlateContractError(
            "argument-validation", f"missing required arguments: {', '.join(missing)}"
        )
    report = Path(values["--report"]).expanduser().resolve()
    failure_report = (
        Path(values["--failure-report"]).expanduser().resolve()
        if "--failure-report" in values
        else report.with_name(f"{report.stem}-failure{report.suffix or '.json'}")
    )
    return {
        "descriptor": Path(values["--descriptor"]).expanduser().resolve(),
        "out_dir": Path(values["--out-dir"]).expanduser().resolve(),
        "report": report,
        "failure_report": failure_report,
    }


def _known_argument_path(arguments: list[str], flag: str) -> Path | None:
    try:
        index = arguments.index(flag)
    except ValueError:
        return None
    if index + 1 >= len(arguments) or arguments[index + 1].startswith("--"):
        return None
    return Path(arguments[index + 1]).expanduser().resolve()


def render_descriptor(
    *,
    descriptor_path: Path,
    output_dir: Path,
    report_path: Path,
    failure_report_path: Path,
    bpy: Any,
) -> dict[str, Any]:
    phase = "descriptor-read"
    staging_dir: Path | None = None
    last: dict[str, Any] = {
        "descriptorPath": str(descriptor_path.resolve()),
        "effectiveSourcePath": str(Path(bpy.data.filepath).resolve()),
        "outputDirectory": str(output_dir.resolve()),
        "reportPath": str(report_path.resolve()),
        "failureReportPath": str(failure_report_path.resolve()),
    }
    try:
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        staging_dir = Path(
            tempfile.mkdtemp(
                prefix=f".{output_dir.name}.", suffix=".staging", dir=output_dir.parent
            )
        )
        last["stagingDirectory"] = str(staging_dir)
        outputs = channel_paths(staging_dir)
        descriptor = read_descriptor(descriptor_path)
        identity = descriptor_sha256(descriptor)
        last["descriptorSha256"] = identity

        transform_contract = validate_transform_contracts(descriptor)
        last["transformContract"] = transform_contract

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
        material_receipt = _apply_materials(bpy, selection_receipt, descriptor)
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
        scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (
            0.0,
            0.0,
            0.0,
            1.0,
        )
        scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
        depth_material = _depth_material(bpy)
        normal_material = _normal_material(bpy)
        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.color_depth = "32"
        view_layer.material_override = depth_material
        scene.render.filepath = str(outputs["depth"])
        bpy.ops.render.render(write_still=True)

        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.color_depth = "32"
        view_layer.material_override = normal_material
        scene.render.filepath = str(outputs["normal"])
        bpy.ops.render.render(write_still=True)

        view_layer.material_override = None
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
        output_records = _record_outputs(bpy, descriptor, outputs)
        validation = validate_complete_outputs(descriptor, output_records)
        final_paths = channel_paths(output_dir)
        for output in validation["outputs"]:
            output["path"] = str(final_paths[output["channel"]])

        phase = "post-render-source-freshness"
        post_render_source = verify_source_unchanged(
            descriptor, bpy.data.filepath, source_receipt
        )
        last["postRenderSource"] = post_render_source

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
                "reportPath": str(report_path.resolve()),
                "failureReportPath": str(failure_report_path.resolve()),
            },
            "effective": {
                "descriptorSha256": identity,
                "source": source_receipt,
                "postRenderSource": post_render_source,
                "selection": selection_receipt,
                "camera": camera_receipt,
                "renderer": renderer_receipt,
                "lighting": lighting_receipt,
                "presentation": presentation_receipt,
                "materials": material_receipt,
                "channelSemantics": {
                    channel["name"]: {
                        key: value
                        for key, value in channel.items()
                        if key != "name"
                    }
                    for channel in descriptor["channels"]
                },
                "blenderVersion": bpy.app.version_string,
            },
            "outputs": validation,
        }
        phase = "output-promotion"
        _promote_staged_run(
            staging_dir=staging_dir,
            output_dir=output_dir,
            report_path=report_path,
            report=report,
        )
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
        if staging_dir is not None:
            failure["stagingDirectory"] = str(staging_dir)
        failure["traceback"] = traceback.format_exc()
        _atomic_json(failure_report_path, failure)
        raise


def _main(arguments: list[str] | None = None) -> int:
    if arguments is None:
        separator = sys.argv.index("--") if "--" in sys.argv else -1
        arguments = sys.argv[separator + 1 :] if separator >= 0 else []
    try:
        parsed = _parse_cli_arguments(arguments)
    except SourcePlateContractError as error:
        failure_report_path = _known_argument_path(arguments, "--failure-report")
        if failure_report_path is not None:
            failure = failure_document(
                descriptor_path=_known_argument_path(arguments, "--descriptor"),
                output_dir=_known_argument_path(arguments, "--out-dir"),
                phase=error.phase,
                error=error,
                last_trustworthy_evidence={"arguments": arguments},
            )
            _atomic_json(failure_report_path, failure)
        print(
            "usage: blender ... --python source_plate_blender.py -- "
            "--descriptor PATH --out-dir PATH --report PATH "
            "[--failure-report PATH]",
            file=sys.stderr,
        )
        print(str(error), file=sys.stderr)
        return 2
    descriptor_path = parsed["descriptor"]
    output_dir = parsed["out_dir"]
    report_path = parsed["report"]
    failure_report_path = parsed["failure_report"]
    if report_path == failure_report_path:
        error = SourcePlateContractError(
            "argument-validation", "success and failure report paths must differ"
        )
        _atomic_json(
            failure_report_path,
            failure_document(
                descriptor_path=descriptor_path,
                output_dir=output_dir,
                phase=error.phase,
                error=error,
                last_trustworthy_evidence={"arguments": arguments},
            ),
        )
        print(str(error), file=sys.stderr)
        return 2
    try:
        import bpy

        report = render_descriptor(
            descriptor_path=descriptor_path,
            output_dir=output_dir,
            report_path=report_path,
            failure_report_path=failure_report_path,
            bpy=bpy,
        )
    except BaseException as error:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "report": str(failure_report_path),
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
                "report": str(report_path),
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
