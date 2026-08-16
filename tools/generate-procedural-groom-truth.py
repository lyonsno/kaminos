"""Generate a carrier-bound procedural groom truth fixture in Blender.

The Greenroom worker invokes this file with two positional arguments after
Blender's ``--`` separator: a JSON request and an output directory.  The script
always attempts to leave a failure report when it cannot produce the fixture.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import traceback
from pathlib import Path
from typing import Any, Iterable

import bpy
from mathutils import Vector


SCHEMA = "kaminos.procedural-groom-truth.v0"
FIXTURE_ID = "procedural-groom-truth-v0"
REQUIRED_ROUTE = "gpu-greenroom:kaminos_blender_cast_cleanup"


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


def material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = color
    result.metallic = 0.0
    result.roughness = 0.72
    return result


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


def mesh_copy_for_export(source: bpy.types.Object, name: str, target: bpy.types.Collection) -> bpy.types.Object:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    obj = bpy.data.objects.new(name, mesh)
    obj.matrix_world = source.matrix_world.copy()
    target.objects.link(obj)
    return obj


def export_neutral_glb(
    path: Path,
    carrier: bpy.types.Object,
    dense_objects: list[bpy.types.Object],
) -> None:
    export_collection = collection("PortableNeutralExport")
    export_objects = [mesh_copy_for_export(carrier, "Carrier", export_collection)]
    export_objects.extend(
        mesh_copy_for_export(obj, f"{obj.name}Mesh", export_collection) for obj in dense_objects
    )
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
        "carrier": material("CarrierAsh", (0.22, 0.25, 0.29, 1.0)),
        "low": material("ShortCoatLowPuff", (0.10, 0.62, 0.63, 1.0)),
        "high": material("ShortCoatHighPuff", (0.94, 0.42, 0.12, 1.0)),
        "ruff": material("Ruff", (0.58, 0.24, 0.82, 1.0)),
        "whisker": material("MystacialWhiskers", (0.95, 0.87, 0.62, 1.0)),
        "sparse": material("CanonicalGuides", (0.92, 0.98, 1.0, 1.0)),
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
        ("short-coat-low-puff", sample_evenly(coat_left, 14), Vector((0, 0, -1)), 0.17, 0.16, 26.0, "low", 0.82),
        ("short-coat-high-puff", sample_evenly(coat_right, 14), Vector((0, 0, -1)), 0.29, 0.64, 22.0, "high", 0.68),
        ("ruff", sample_evenly(ruff_faces, 16), Vector((0, 0, -1)), 0.48, 0.72, 12.0, "high", 0.46),
    ]

    guides: list[dict[str, Any]] = []
    sparse_curves: list[list[Vector]] = []
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
            sparse_curves.append(points)

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
        "CanonicalSparseGuides", sparse_curves + whisker_curves,
        collections["NeutralSparseGuides"], materials["sparse"], 0.012, "canonical-guides",
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
    export_neutral_glb(glb_path, neutral_carrier, dense_objects)

    set_visibility(collections, {"NeutralCarrier", "NeutralDenseGroom"})
    blend_path = output_dir / "procedural-groom-truth.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    if not blend_path.exists() or blend_path.stat().st_size == 0:
        raise RuntimeError("Blender source scene is blank")

    products = [
        product("blend", blend_path, output_dir),
        product("glb", glb_path, output_dir),
        product("sparse-truth-render", sparse_render, output_dir),
        product("neutral-dense-render", neutral_render, output_dir),
        product("deformed-dense-render", deformed_render, output_dir),
    ]
    glb_product = next(item for item in products if item["kind"] == "glb")
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
        "groom": {
            "systems": [
                {"id": "short-coat-low-puff", "representation": "guide-field", "guideIds": guide_ids_by_system["short-coat-low-puff"]},
                {"id": "short-coat-high-puff", "representation": "guide-field", "guideIds": guide_ids_by_system["short-coat-high-puff"]},
                {"id": "ruff", "representation": "explicit-guides", "guideIds": guide_ids_by_system["ruff"]},
                {"id": "mystacial-whiskers", "representation": "sparse-preset-curves", "guideIds": whisker_ids},
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
