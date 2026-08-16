"""Generate a carrier-bound procedural groom truth fixture in Blender.

The Greenroom worker invokes this file with two positional arguments after
Blender's ``--`` separator: a JSON request and an output directory.  The script
always attempts to leave a failure report when it cannot produce the fixture.
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
import traceback
from pathlib import Path
from typing import Any, Iterable

import bpy
from mathutils import Vector


SCHEMA = "kaminos.procedural-groom-truth.v0"
FIXTURE_ID = "procedural-groom-truth-v0"
REQUIRED_ROUTE = "gpu-greenroom:kaminos_blender_cast_cleanup"
OBSERVATION_OBJECT_SCALE = 0.40197228574259536
OBSERVATION_OBJECT_POSITION = (0.0, 0.09772014617919922, -0.1836080551147461)
DISPLAY_COLORS = {
    "carrier": "#383f4a",
    "low": "#1fa0a1",
    "high": "#ef6b1f",
    "ruff": "#943dd1",
    "whisker": "#f2dea0",
    "observation_fiber": "#b8bfc7",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def product(kind: str, path: Path, output_dir: Path) -> dict[str, Any]:
    return {
        "kind": kind,
        "path": str(path.relative_to(output_dir)),
        "sha256": sha256(path),
        "byteLength": path.stat().st_size,
    }


def as_list(vector: Vector) -> list[float]:
    return [round(float(component), 8) for component in vector]


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)


def collection(name: str) -> bpy.types.Collection:
    result = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(result)
    return result


def rgba(hex_color: str) -> tuple[float, float, float, float]:
    return tuple(int(hex_color[index:index + 2], 16) / 255.0 for index in (1, 3, 5)) + (1.0,)


def material(name: str, hex_color: str) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    color = rgba(hex_color)
    result.diffuse_color = color
    result.metallic = 0.0
    result.roughness = 0.72
    return result


def patch_glb_material_colors(path: Path, colors: dict[str, str]) -> None:
    """Encode portable PBR colors without Blender 5.1's node teardown crash."""
    payload = path.read_bytes()
    if payload[:4] != b"glTF" or len(payload) < 20:
        raise RuntimeError(f"{path.name}: invalid GLB header")
    json_length, json_type = struct.unpack_from("<I4s", payload, 12)
    if json_type != b"JSON":
        raise RuntimeError(f"{path.name}: first GLB chunk is not JSON")
    json_end = 20 + json_length
    document = json.loads(payload[20:json_end].decode("utf-8").rstrip(" \t\r\n\0"))
    encoded = set()
    for entry in document.get("materials") or []:
        hex_color = colors.get(entry.get("name"))
        if not hex_color:
            continue
        entry.setdefault("pbrMetallicRoughness", {})["baseColorFactor"] = list(rgba(hex_color))
        encoded.add(entry["name"])
    missing = set(colors) - encoded
    if missing:
        raise RuntimeError(f"{path.name}: missing exported materials {sorted(missing)}")
    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    tail = payload[json_end:]
    rebuilt = bytearray(payload[:12])
    rebuilt.extend(struct.pack("<I4s", len(json_bytes), b"JSON"))
    rebuilt.extend(json_bytes)
    rebuilt.extend(tail)
    struct.pack_into("<I", rebuilt, 8, len(rebuilt))
    path.write_bytes(rebuilt)


def move_to_collection(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    target.objects.link(obj)


def carrier_position(raw: Vector) -> Vector:
    point = Vector((raw.x * 1.08, raw.y * 1.28, raw.z * 1.03))
    muzzle = max(0.0, min(1.0, (-point.y - 0.42) / 0.82))
    point.y -= 0.38 * muzzle * muzzle
    point.x *= 1.0 + 0.12 * muzzle
    point.z -= 0.10 * muzzle
    return point


def deform(point: Vector) -> Vector:
    bend = 0.12 + 0.24 * (point.z + 1.15) ** 2
    return Vector((point.x + bend, point.y + 0.07 * point.x * point.z, point.z))


def create_carrier(
    name: str,
    target: bpy.types.Collection,
    carrier_material: bpy.types.Material,
    deformed: bool = False,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=36, ring_count=24, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    for vertex in obj.data.vertices:
        point = carrier_position(vertex.co)
        vertex.co = deform(point) if deformed else point
    obj.data.update()
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new(name="TruthTriangulation", type="TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.materials.append(carrier_material)
    obj["truth_role"] = "deformed-carrier" if deformed else "neutral-carrier"
    move_to_collection(obj, target)
    return obj


def face_center(mesh: bpy.types.Mesh, polygon: bpy.types.MeshPolygon) -> Vector:
    return sum((mesh.vertices[index].co for index in polygon.vertices), Vector()) / len(polygon.vertices)


def classify_domain(center: Vector) -> str:
    pad = center.y < -1.13 and -0.38 < center.z < 0.32 and 0.18 < abs(center.x) < 0.86
    if pad:
        return "mystacial-pad-left" if center.x < 0 else "mystacial-pad-right"
    if center.z < 0.10 and center.y > -0.58:
        return "ruff"
    return "short-coat"


def projected_direction(normal: Vector, preferred: Vector) -> Vector:
    direction = preferred - normal * preferred.dot(normal)
    if direction.length < 1e-5:
        fallback = Vector((0.0, 1.0, 0.0))
        direction = fallback - normal * fallback.dot(normal)
    return direction.normalized()


def curve_points(
    root: Vector,
    flow: Vector,
    normal: Vector,
    bitangent: Vector,
    length: float,
    lift: float,
    phase: float = 0.0,
) -> list[Vector]:
    result = []
    for index in range(5):
        t = index / 4.0
        arch = math.sin(math.pi * t)
        point = root + flow * (length * t)
        point += normal * (length * lift * (0.20 * t + 0.30 * arch))
        point += bitangent * (0.028 * length * math.sin(math.pi * t + phase))
        result.append(point)
    return result


def add_curve_bundle(
    name: str,
    curves: Iterable[list[Vector]],
    target: bpy.types.Collection,
    curve_material: bpy.types.Material,
    bevel_depth: float,
    truth_role: str,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(name=f"{name}Geometry", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 2
    curve_data.bevel_depth = bevel_depth
    curve_data.bevel_resolution = 2
    curve_data.resolution_u = 2
    curve_data.materials.append(curve_material)
    for points in curves:
        spline = curve_data.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for spline_point, point in zip(spline.points, points):
            spline_point.co = (*point, 1.0)
    obj = bpy.data.objects.new(name, curve_data)
    obj["truth_role"] = truth_role
    target.objects.link(obj)
    return obj


def sample_evenly(items: list[Any], count: int) -> list[Any]:
    if len(items) <= count:
        return list(items)
    return [items[round(index * (len(items) - 1) / (count - 1))] for index in range(count)]


def face_frame(mesh: bpy.types.Mesh, polygon: bpy.types.MeshPolygon, preferred: Vector) -> tuple[Vector, Vector, Vector, Vector]:
    root = face_center(mesh, polygon)
    normal = polygon.normal.normalized()
    tangent = projected_direction(normal, preferred)
    bitangent = normal.cross(tangent).normalized()
    return root, normal, tangent, bitangent


def guide_record(
    guide_id: str,
    system_id: str,
    polygon: bpy.types.MeshPolygon,
    root: Vector,
    normal: Vector,
    tangent: Vector,
    bitangent: Vector,
    points: list[Vector],
    length: float,
    density: float,
    lift: float,
    puff: str,
    stiffness: float,
) -> dict[str, Any]:
    return {
        "id": guide_id,
        "systemId": system_id,
        "root": {
            "triangleIndex": polygon.index,
            "barycentric": [1 / 3, 1 / 3, 1 / 3],
            "neutralPosition": as_list(root),
            "deformedPosition": as_list(deform(root)),
        },
        "frame": {
            "normal": as_list(normal),
            "tangent": as_list(tangent),
            "bitangent": as_list(bitangent),
        },
        "flow": as_list(tangent),
        "length": length,
        "density": density,
        "lift": lift,
        "puff": puff,
        "stiffness": stiffness,
        "confidence": 1.0,
        "provenance": "procedural-authored-truth",
        "points": [as_list(point) for point in points],
    }


def whisker_points(root: Vector, side: int, index: int, count: int, length: float) -> list[Vector]:
    fan = (index / (count - 1) - 0.5) * math.radians(52.0)
    direction = Vector((side * math.cos(fan), -0.42, math.sin(fan) + 0.12)).normalized()
    points = []
    for step in range(7):
        t = step / 6.0
        point = root + direction * (length * t)
        point.z -= 0.12 * length * t * t
        points.append(point)
    return points


def nearest_face(mesh: bpy.types.Mesh, faces: list[bpy.types.MeshPolygon], target: Vector) -> bpy.types.MeshPolygon:
    return min(faces, key=lambda polygon: (face_center(mesh, polygon) - target).length_squared)


def set_visibility(collections: dict[str, bpy.types.Collection], visible: set[str]) -> None:
    for name, value in collections.items():
        value.hide_render = name not in visible


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.curvature_ridge_factor = 1.35
    scene.display.shading.curvature_valley_factor = 0.85
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.025, 0.03, 0.04)
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False

    bpy.ops.object.camera_add(location=(4.45, -6.4, 2.45))
    camera = bpy.context.object
    camera.name = "EvidenceCamera"
    camera.data.lens = 58
    look_at(camera, Vector((0.0, -0.05, -0.05)))
    scene.camera = camera


def render(path: Path) -> None:
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError(f"render did not produce a nonblank artifact: {path}")


def render_truth_masks(
    output_dir: Path,
    collections: dict[str, bpy.types.Collection],
    carrier: bpy.types.Object,
    dense_objects: list[bpy.types.Object],
    domains: dict[str, list[bpy.types.MeshPolygon]],
) -> list[dict[str, Any]]:
    """Render truth-only visible-region masks from the observation camera poses."""
    # MeshPolygon RNA wrappers can be invalidated by material-slot mutation and
    # render/depsgraph evaluation. Freeze plain integer indices before either.
    domain_indices = {
        region_id: [polygon.index for polygon in polygons]
        for region_id, polygons in domains.items()
    }
    scene = bpy.context.scene
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = False
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.0, 0.0, 0.0)
    scene.render.resolution_x = 1088
    scene.render.resolution_y = 817
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.camera.data.sensor_fit = "VERTICAL"
    scene.camera.data.angle = 2.0 * math.atan(1.0 / 2.7474774194546225)

    black = material("TruthMaskBlack", "#000000")
    white = material("TruthMaskWhite", "#ffffff")
    original_carrier_materials = list(carrier.data.materials)
    original_dense_materials = [list(obj.data.materials) for obj in dense_objects]
    carrier.data.materials.clear()
    carrier.data.materials.append(black)
    carrier.data.materials.append(white)
    for polygon in carrier.data.polygons:
        polygon.material_index = 0
    for obj in dense_objects:
        obj.data.materials.clear()
        obj.data.materials.append(black)

    set_visibility(collections, {"NeutralCarrier", "NeutralDenseGroom"})
    mask_dir = output_dir / "truth-masks"
    target_objects = {
        "short-coat": dense_objects[0],
        "puffy-coat": dense_objects[1],
        "ruff": dense_objects[2],
    }
    def observation_point_to_blender_source(point: tuple[float, float, float]) -> tuple[float, float, float]:
        source = tuple(
            (point[axis] - OBSERVATION_OBJECT_POSITION[axis]) / OBSERVATION_OBJECT_SCALE
            for axis in range(3)
        )
        return (source[0], -source[2], source[1])

    observation_target = (0.0, 0.0, 0.0)
    blender_target = observation_point_to_blender_source(observation_target)
    view_specs = [
        ("front", (0.0, 0.6, 3.0)),
        ("left-three-quarter", (-2.1, 0.6, 2.1)),
        ("right-three-quarter", (2.1, 0.6, 2.1)),
    ]
    results: list[dict[str, Any]] = []
    for view_id, observation_position in view_specs:
        blender_position = observation_point_to_blender_source(observation_position)
        scene.camera.location = blender_position
        look_at(scene.camera, Vector(blender_target))
        for region_id in [
            "short-coat", "puffy-coat", "ruff",
            "mystacial-pad-left", "mystacial-pad-right",
        ]:
            for obj in dense_objects:
                obj.data.materials[0] = black
            for polygon in carrier.data.polygons:
                polygon.material_index = 0
            if region_id in target_objects:
                target_objects[region_id].data.materials[0] = white
            else:
                for polygon_index in domain_indices[region_id]:
                    carrier.data.polygons[polygon_index].material_index = 1
            path = mask_dir / view_id / f"{region_id}.png"
            path.parent.mkdir(parents=True, exist_ok=True)
            render(path)
            results.append({
                **product("projected-truth-mask", path, output_dir),
                "viewId": view_id,
                "regionId": region_id,
                "cameraPosition": list(observation_position),
                "cameraTarget": list(observation_target),
                "blenderCameraPosition": list(blender_position),
                "blenderCameraTarget": list(blender_target),
                "observationObjectScale": OBSERVATION_OBJECT_SCALE,
                "observationObjectPosition": list(OBSERVATION_OBJECT_POSITION),
                "coordinateConversion": "undo-observation-object-transform-then-browser-y-up-to-blender-z-up",
                "resolution": [1088, 817],
                "projectionMatrixYScale": 2.7474774194546225,
            })
    carrier.data.materials.clear()
    for source_material in original_carrier_materials:
        carrier.data.materials.append(source_material)
    for polygon in carrier.data.polygons:
        polygon.material_index = 0
    for obj, source_materials in zip(dense_objects, original_dense_materials):
        obj.data.materials.clear()
        for source_material in source_materials:
            obj.data.materials.append(source_material)
    bpy.context.view_layer.update()
    return results


def mesh_copy_for_export(source: bpy.types.Object, name: str, target: bpy.types.Collection) -> bpy.types.Object:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    obj = bpy.data.objects.new(name, mesh)
    obj.matrix_world = source.matrix_world.copy()
    target.objects.link(obj)
    return obj


def export_groom_glb(
    path: Path,
    carrier: bpy.types.Object,
    dense_objects: list[bpy.types.Object],
    fiber_material: bpy.types.Material | None = None,
) -> None:
    export_collection = collection(f"PortableExport-{path.stem}")
    export_objects = [mesh_copy_for_export(carrier, "Carrier", export_collection)]
    groom_export_objects = [
        mesh_copy_for_export(obj, f"{obj.name}Mesh", export_collection) for obj in dense_objects
    ]
    if fiber_material is not None:
        for obj in groom_export_objects:
            obj.data.materials.clear()
            obj.data.materials.append(fiber_material)
    export_objects.extend(groom_export_objects)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = export_objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError("portable GLB export is blank")
    bpy.data.collections.remove(export_collection, do_unlink=True)


def build(request_path: Path, output_dir: Path) -> dict[str, Any]:
    request = json.loads(request_path.read_text())
    if request.get("schema") != "kaminos.procedural-groom-request.v0":
        raise ValueError("unexpected request schema")
    if request.get("fixtureId") != FIXTURE_ID:
        raise ValueError("request fixture identity mismatch")
    if request.get("requestedRoute") != REQUIRED_ROUTE:
        raise ValueError("request route does not match the protected authoring route")

    output_dir.mkdir(parents=True, exist_ok=True)
    reset_scene()
    configure_scene()

    collections = {
        name: collection(name)
        for name in [
            "NeutralCarrier", "NeutralSparseGuides", "NeutralDenseGroom",
            "DeformedCarrier", "DeformedDenseGroom",
        ]
    }
    materials = {
        "carrier": material("CarrierAsh", DISPLAY_COLORS["carrier"]),
        "low": material("ShortCoatLowPuff", DISPLAY_COLORS["low"]),
        "high": material("ShortCoatHighPuff", DISPLAY_COLORS["high"]),
        "ruff": material("Ruff", DISPLAY_COLORS["ruff"]),
        "whisker": material("MystacialWhiskers", DISPLAY_COLORS["whisker"]),
        "observation_fiber": material("ObservationFiberNeutral", DISPLAY_COLORS["observation_fiber"]),
    }

    neutral_carrier = create_carrier("CarrierNeutral", collections["NeutralCarrier"], materials["carrier"])
    deformed_carrier = create_carrier("CarrierDeformed", collections["DeformedCarrier"], materials["carrier"], deformed=True)
    mesh = neutral_carrier.data
    mesh.calc_loop_triangles()
    mesh.update()

    domains: dict[str, list[bpy.types.MeshPolygon]] = {
        "short-coat": [], "ruff": [], "mystacial-pad-left": [], "mystacial-pad-right": [],
    }
    for polygon in mesh.polygons:
        domains[classify_domain(face_center(mesh, polygon))].append(polygon)
    if any(not faces for faces in domains.values()):
        missing = [name for name, faces in domains.items() if not faces]
        raise RuntimeError(f"semantic domain has no carrier triangles: {missing}")

    coat_left = sorted(
        [polygon for polygon in domains["short-coat"] if face_center(mesh, polygon).x < -0.04],
        key=lambda polygon: (face_center(mesh, polygon).z, face_center(mesh, polygon).y, polygon.index),
    )
    coat_right = sorted(
        [polygon for polygon in domains["short-coat"] if face_center(mesh, polygon).x > 0.04],
        key=lambda polygon: (face_center(mesh, polygon).z, face_center(mesh, polygon).y, polygon.index),
    )
    ruff_faces = sorted(domains["ruff"], key=lambda polygon: (face_center(mesh, polygon).x, polygon.index))

    system_specs = [
        ("short-coat-low-puff", sample_evenly(coat_left, 14), Vector((0, 0, -1)), 0.14, 0.08, 28.0, "low", 0.86),
        ("short-coat-high-puff", sample_evenly(coat_right, 14), Vector((0, 0, -1)), 0.40, 0.95, 18.0, "high", 0.58),
        ("ruff", sample_evenly(ruff_faces, 16), Vector((0, 0, -1)), 0.78, 0.58, 10.0, "high", 0.34),
    ]

    guides: list[dict[str, Any]] = []
    sparse_by_system: dict[str, list[list[Vector]]] = {spec[0]: [] for spec in system_specs}
    dense_by_system: dict[str, list[list[Vector]]] = {spec[0]: [] for spec in system_specs}
    guide_ids_by_system: dict[str, list[str]] = {spec[0]: [] for spec in system_specs}

    for system_id, faces, preferred, length, lift, density, puff, stiffness in system_specs:
        for index, polygon in enumerate(faces):
            root, normal, tangent, bitangent = face_frame(mesh, polygon, preferred)
            points = curve_points(root, tangent, normal, bitangent, length, lift, index * 0.37)
            guide_id = f"{system_id}-{index:02d}"
            guides.append(guide_record(
                guide_id, system_id, polygon, root, normal, tangent, bitangent,
                points, length, density, lift, puff, stiffness,
            ))
            guide_ids_by_system[system_id].append(guide_id)
            sparse_by_system[system_id].append(points)

        dense_source = coat_left if system_id == "short-coat-low-puff" else coat_right if system_id == "short-coat-high-puff" else ruff_faces
        dense_count = 175 if system_id.startswith("short-coat") else 110
        for index, polygon in enumerate(sample_evenly(dense_source, dense_count)):
            root, normal, tangent, bitangent = face_frame(mesh, polygon, preferred)
            dense_by_system[system_id].append(curve_points(
                root, tangent, normal, bitangent, length, lift, index * 0.71,
            ))

    whisker_count = 7
    whisker_curves: list[list[Vector]] = []
    whisker_ids: list[str] = []
    for side, domain_name in [(-1, "mystacial-pad-left"), (1, "mystacial-pad-right")]:
        pad_faces = domains[domain_name]
        for index in range(whisker_count):
            target = Vector((side * (0.38 + 0.045 * index), -1.45, -0.22 + 0.07 * index))
            polygon = nearest_face(mesh, pad_faces, target)
            root, normal, tangent, bitangent = face_frame(mesh, polygon, Vector((side, -0.3, 0.0)))
            length = 0.76 + 0.035 * index
            points = whisker_points(root, side, index, whisker_count, length)
            guide_id = f"mystacial-whiskers-{'left' if side < 0 else 'right'}-{index:02d}"
            guides.append(guide_record(
                guide_id, "mystacial-whiskers", polygon, root, normal, tangent, bitangent,
                points, length, 2.0, 0.02, "low", 0.91,
            ))
            whisker_ids.append(guide_id)
            whisker_curves.append(points)

    add_curve_bundle(
        "CanonicalLowPuffGuides", sparse_by_system["short-coat-low-puff"],
        collections["NeutralSparseGuides"], materials["low"], 0.014, "short-coat-low-puff-guides",
    )
    add_curve_bundle(
        "CanonicalHighPuffGuides", sparse_by_system["short-coat-high-puff"],
        collections["NeutralSparseGuides"], materials["high"], 0.014, "short-coat-high-puff-guides",
    )
    add_curve_bundle(
        "CanonicalRuffGuides", sparse_by_system["ruff"],
        collections["NeutralSparseGuides"], materials["ruff"], 0.014, "ruff-guides",
    )
    add_curve_bundle(
        "CanonicalWhiskerGuides", whisker_curves,
        collections["NeutralSparseGuides"], materials["whisker"], 0.010, "mystacial-whisker-guides",
    )
    dense_objects = [
        add_curve_bundle("ShortCoatLowPuff", dense_by_system["short-coat-low-puff"], collections["NeutralDenseGroom"], materials["low"], 0.010, "short-coat-low-puff"),
        add_curve_bundle("ShortCoatHighPuff", dense_by_system["short-coat-high-puff"], collections["NeutralDenseGroom"], materials["high"], 0.012, "short-coat-high-puff"),
        add_curve_bundle("Ruff", dense_by_system["ruff"], collections["NeutralDenseGroom"], materials["ruff"], 0.015, "ruff"),
        add_curve_bundle("MystacialWhiskers", whisker_curves, collections["NeutralDenseGroom"], materials["whisker"], 0.008, "mystacial-whiskers"),
    ]
    deformed_dense_objects = []
    for source in dense_objects:
        deformed_curves = []
        for spline in source.data.splines:
            deformed_curves.append([deform(Vector(point.co[:3])) for point in spline.points])
        deformed_dense_objects.append(add_curve_bundle(
            f"{source.name}Deformed", deformed_curves, collections["DeformedDenseGroom"],
            source.data.materials[0], source.data.bevel_depth, f"{source['truth_role']}-deformed",
        ))

    sparse_render = output_dir / "sparse-truth.png"
    neutral_render = output_dir / "neutral-dense.png"
    deformed_render = output_dir / "deformed-dense.png"
    set_visibility(collections, {"NeutralCarrier", "NeutralSparseGuides"})
    render(sparse_render)
    set_visibility(collections, {"NeutralCarrier", "NeutralDenseGroom"})
    render(neutral_render)
    set_visibility(collections, {"DeformedCarrier", "DeformedDenseGroom"})
    render(deformed_render)

    glb_path = output_dir / "procedural-groom-truth.glb"
    export_groom_glb(glb_path, neutral_carrier, dense_objects)
    patch_glb_material_colors(glb_path, {
        "CarrierAsh": DISPLAY_COLORS["carrier"],
        "ShortCoatLowPuff": DISPLAY_COLORS["low"],
        "ShortCoatHighPuff": DISPLAY_COLORS["high"],
        "Ruff": DISPLAY_COLORS["ruff"],
        "MystacialWhiskers": DISPLAY_COLORS["whisker"],
    })
    observation_glb_path = output_dir / "procedural-groom-observation.glb"
    export_groom_glb(
        observation_glb_path,
        neutral_carrier,
        dense_objects,
        fiber_material=materials["observation_fiber"],
    )
    patch_glb_material_colors(observation_glb_path, {
        "CarrierAsh": DISPLAY_COLORS["carrier"],
        "ObservationFiberNeutral": DISPLAY_COLORS["observation_fiber"],
    })

    set_visibility(collections, {"NeutralCarrier", "NeutralDenseGroom"})
    blend_path = output_dir / "procedural-groom-truth.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    if not blend_path.exists() or blend_path.stat().st_size == 0:
        raise RuntimeError("Blender source scene is blank")

    truth_mask_products = render_truth_masks(
        output_dir, collections, neutral_carrier, dense_objects, domains,
    )

    products = [
        product("blend", blend_path, output_dir),
        product("glb", glb_path, output_dir),
        product("neutral-observation-glb", observation_glb_path, output_dir),
        product("sparse-truth-render", sparse_render, output_dir),
        product("neutral-dense-render", neutral_render, output_dir),
        product("deformed-dense-render", deformed_render, output_dir),
        *truth_mask_products,
    ]
    glb_product = next(item for item in products if item["kind"] == "glb")
    observation_glb_product = next(
        item for item in products if item["kind"] == "neutral-observation-glb"
    )
    manifest = {
        "schema": SCHEMA,
        "fixtureId": FIXTURE_ID,
        "source": {
            "kind": "procedural-authored-truth",
            "generatorPath": "tools/generate-procedural-groom-truth.py",
            "generatorSha256": sha256(Path(__file__).resolve()),
            "requestedRoute": request["requestedRoute"],
            "effectiveRoute": REQUIRED_ROUTE,
            "blenderVersion": bpy.app.version_string,
        },
        "carrier": {
            "mesh": {
                "path": glb_product["path"],
                "sha256": glb_product["sha256"],
                "byteLength": glb_product["byteLength"],
                "vertices": len(mesh.vertices),
                "triangles": len(mesh.polygons),
                "connectedComponents": 1,
            },
            "coordinateSystem": {"handedness": "right", "upAxis": "Z", "unit": "meter"},
            "semanticDomains": [
                {"id": name, "triangleCount": len(faces)} for name, faces in domains.items()
            ],
        },
        "observation": {
            "mesh": {
                "path": observation_glb_product["path"],
                "sha256": observation_glb_product["sha256"],
                "byteLength": observation_glb_product["byteLength"],
                "membershipColorsVisible": False,
            },
        },
        "groom": {
            "contrastContract": {
                "source": "operator-visual-disposition",
                "target": "approximately-twofold-perceptual-separation",
                "shortToPuffy": {"minimumLengthRatio": 2.5, "minimumLiftDelta": 0.70},
                "puffyToRuff": {"minimumLengthRatio": 1.75, "maximumDensityRatio": 0.75},
            },
            "systems": [
                {"id": "short-coat-low-puff", "representation": "guide-field", "displayColor": DISPLAY_COLORS["low"], "guideIds": guide_ids_by_system["short-coat-low-puff"]},
                {"id": "short-coat-high-puff", "representation": "guide-field", "displayColor": DISPLAY_COLORS["high"], "guideIds": guide_ids_by_system["short-coat-high-puff"]},
                {"id": "ruff", "representation": "explicit-guides", "displayColor": DISPLAY_COLORS["ruff"], "guideIds": guide_ids_by_system["ruff"]},
                {"id": "mystacial-whiskers", "representation": "sparse-preset-curves", "displayColor": DISPLAY_COLORS["whisker"], "guideIds": whisker_ids},
            ],
            "guides": guides,
            "whiskerPreset": {
                "detectionTarget": "whisker-presence",
                "segmentationTarget": "mystacial-pad",
                "bilateral": True,
                "countPerSide": whisker_count,
                "lengthToMuzzleWidth": 1.15,
                "angularFanDegrees": 52.0,
                "elevationDegrees": 8.0,
                "sag": 0.12,
                "taper": 0.82,
                "stiffness": 0.91,
                "sparseness": 0.78,
                "confidence": 0.75,
            },
        },
        "deformation": {
            "method": "carrier-bound-bend-v0",
            "neutralFrame": 1,
            "deformedFrame": 24,
            "transportedGuideCount": len(guides),
        },
        "products": products,
        "claimCeiling": "Procedural representation, carrier attachment, regime distinction, and carrier-bound deformation truth only; no image recovery, VLM/SAM correctness, anatomical truth, production grooming, or visual admission.",
        "visualAdmission": False,
        "scientificAdmission": False,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> int:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(args) != 2:
        raise SystemExit("expected: <request.json> <output-dir>")
    request_path = Path(args[0]).resolve()
    output_dir = Path(args[1]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    failure_path = output_dir / "failure.json"
    phase = "request"
    try:
        phase = "scene-generation"
        manifest = build(request_path, output_dir)
        if failure_path.exists():
            failure_path.unlink()
        print(json.dumps({
            "state": "generated",
            "manifest": str(output_dir / "manifest.json"),
            "guides": len(manifest["groom"]["guides"]),
            "products": len(manifest["products"]),
        }))
        return 0
    except Exception as error:
        failure = {
            "schema": "kaminos.procedural-groom-generation-failure.v0",
            "fixtureId": FIXTURE_ID,
            "failurePhase": phase,
            "errorType": type(error).__name__,
            "errorMessage": str(error),
            "lastTrustworthyEvidence": "request_identity" if request_path.exists() else None,
            "traceback": traceback.format_exc(),
        }
        failure_path.write_text(json.dumps(failure, indent=2) + "\n")
        print(json.dumps(failure), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
