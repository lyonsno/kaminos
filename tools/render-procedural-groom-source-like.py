"""Render a source-like observation from the frozen procedural groom truth.

GPU Greenroom invokes this Blender script with ``request.json output-dir`` after
the ``--`` separator.  The script consumes the committed truth ``.blend`` and
changes only the observation presentation: denser tapered fibers, a shared
non-membership palette, ordinary facial landmarks, studio shading, and the
three already-sealed camera poses.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import shutil
import sys
import traceback
from pathlib import Path
from typing import Any, Iterable

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from procedural_groom_source_like_request import resolve_groom_request


SCHEMA = "kaminos.procedural-groom-source-like-observation.v0"
FIXTURE_ID = "procedural-groom-truth-v0"
OBSERVATION_ID = "procedural-groom-source-like-v0"
REQUIRED_ROUTE = "gpu-greenroom:kaminos_blender_cast_cleanup"
VIEW_IDS = ("front", "left-three-quarter", "right-three-quarter")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def product(path: Path, relative_to: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(relative_to).as_posix(),
        "sha256": sha256(path),
        "byteLength": path.stat().st_size,
    }


def rgba(hex_color: str) -> tuple[float, float, float, float]:
    return tuple(int(hex_color[index:index + 2], 16) / 255.0 for index in (1, 3, 5)) + (1.0,)


def principled_material(
    name: str,
    hex_color: str,
    *,
    roughness: float = 0.72,
    metallic: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    color = rgba(hex_color)
    material.diffuse_color = color
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    if shader is None:
        shader = nodes.new("ShaderNodeBsdfPrincipled")
    if "Base Color" in shader.inputs:
        shader.inputs["Base Color"].default_value = color
    if "Roughness" in shader.inputs:
        shader.inputs["Roughness"].default_value = roughness
    if "Metallic" in shader.inputs:
        shader.inputs["Metallic"].default_value = metallic
    if "Specular IOR Level" in shader.inputs:
        shader.inputs["Specular IOR Level"].default_value = 0.24
    return material


def fibrous_surface_material(name: str) -> bpy.types.Material:
    material = principled_material(name, "#87583b", roughness=0.88)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexNoise")
    texture.name = "SourceLikeFiberNoise"
    texture.inputs["Scale"].default_value = 13.0
    texture.inputs["Detail"].default_value = 5.0
    texture.inputs["Roughness"].default_value = 0.72
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.name = "SourceLikeFiberPalette"
    ramp.color_ramp.elements[0].position = 0.22
    ramp.color_ramp.elements[0].color = rgba("#68422f")
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = rgba("#b57d50")
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.23
    bump.inputs["Distance"].default_value = 0.045
    links.new(texture.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material


def set_object_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)


def coat_offset(point: Vector) -> float:
    """Presentation thickness derived from the authored regime partition."""
    is_pad = point.y < -1.13 and -0.38 < point.z < 0.32 and 0.18 < abs(point.x) < 0.86
    if is_pad:
        base = 0.018
    elif point.z < 0.10 and point.y > -0.58:
        base = 0.10
    elif point.x > 0.04:
        base = 0.065
    else:
        base = 0.018
    modulation = 0.92 + 0.08 * math.sin(point.x * 17.0 + point.z * 11.0 + point.y * 7.0)
    return base * modulation


def create_coat_shell(
    carrier: bpy.types.Object,
    material: bpy.types.Material,
) -> bpy.types.Object:
    mesh = carrier.data.copy()
    mesh.name = "SourceLikeCoatShellGeometry"
    shell = bpy.data.objects.new("SourceLikeCoatShell", mesh)
    shell.matrix_world = carrier.matrix_world.copy()
    bpy.context.scene.collection.objects.link(shell)
    for vertex in mesh.vertices:
        normal = vertex.normal.normalized()
        vertex.co += normal * coat_offset(vertex.co)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.update()
    set_object_material(shell, material)
    shell["presentation_role"] = "integrated-spatially-varying-coat-shell"
    return shell


def classify_fiber_regime(point: Vector) -> str:
    is_pad = point.y < -1.13 and -0.38 < point.z < 0.32 and 0.18 < abs(point.x) < 0.86
    if is_pad:
        return "pad"
    if point.z < 0.10 and point.y > -0.58:
        return "ruff"
    if point.x > 0.04:
        return "puffy"
    return "short"


def projected_flow(normal: Vector) -> Vector:
    preferred = Vector((0.0, 0.0, -1.0))
    flow = preferred - normal * preferred.dot(normal)
    if flow.length < 1e-6:
        preferred = Vector((0.0, 1.0, 0.0))
        flow = preferred - normal * preferred.dot(normal)
    return flow.normalized()


def sample_triangle_point(mesh: bpy.types.Mesh, polygon: bpy.types.MeshPolygon, rng: random.Random) -> tuple[Vector, Vector]:
    vertices = [mesh.vertices[index] for index in polygon.vertices]
    if len(vertices) != 3:
        point = sum((vertex.co for vertex in vertices), Vector()) / len(vertices)
        normal = sum((vertex.normal for vertex in vertices), Vector()).normalized()
        return point, normal
    u = rng.random()
    v = rng.random()
    if u + v > 1.0:
        u = 1.0 - u
        v = 1.0 - v
    weights = (1.0 - u - v, u, v)
    point = sum((vertex.co * weight for vertex, weight in zip(vertices, weights)), Vector())
    normal = sum((vertex.normal * weight for vertex, weight in zip(vertices, weights)), Vector()).normalized()
    return point, normal


def build_microfur(
    carrier: bpy.types.Object,
    *,
    density_multiplier: int,
    lengths: dict[str, float],
    seed: int = 8103,
) -> tuple[list[list[Vector]], dict[str, int], dict[str, int]]:
    rng = random.Random(seed)
    curves: list[list[Vector]] = []
    counts = {"short": 0, "puffy": 0, "ruff": 0}
    baseline_counts = {"short": 0, "puffy": 0, "ruff": 0}
    specs = {
        "short": {"length": lengths["short"], "lift": 0.24, "flow": 0.82, "samples": 2},
        "puffy": {"length": lengths["puffy"], "lift": 0.86, "flow": 0.34, "samples": 3},
        "ruff": {"length": lengths["ruff"], "lift": 0.55, "flow": 0.72, "samples": 2},
    }
    mesh = carrier.data
    for polygon in mesh.polygons:
        center = sum((mesh.vertices[index].co for index in polygon.vertices), Vector()) / len(polygon.vertices)
        regime = classify_fiber_regime(center)
        if regime == "pad":
            continue
        spec = specs[regime]
        baseline_counts[regime] += spec["samples"]
        for _ in range(spec["samples"] * density_multiplier):
            root, normal = sample_triangle_point(mesh, polygon, rng)
            flow = projected_flow(normal)
            bitangent = normal.cross(flow).normalized()
            length = spec["length"] * (0.88 + 0.24 * rng.random())
            phase = rng.random() * math.tau
            points: list[Vector] = []
            for index in range(5):
                t = index / 4.0
                arch = math.sin(math.pi * t)
                point = root + normal * 0.0025
                point += flow * (length * spec["flow"] * t)
                point += normal * (length * spec["lift"] * (0.42 * t + 0.58 * arch))
                point += bitangent * (length * 0.025 * math.sin(math.pi * t + phase) * t)
                points.append(point)
            curves.append(points)
            counts[regime] += 1
    return curves, counts, baseline_counts


def curve_points(source: bpy.types.Object) -> Iterable[list[Vector]]:
    for spline in source.data.splines:
        yield [Vector(point.co[:3]) for point in spline.points]


def closest_frame(carrier: bpy.types.Object, point: Vector, fallback_tangent: Vector) -> tuple[Vector, Vector, Vector]:
    success, surface, normal, _ = carrier.closest_point_on_mesh(point)
    if not success:
        surface = point
        normal = point.normalized() if point.length > 1e-6 else Vector((0, -1, 0))
    normal.normalize()
    tangent = fallback_tangent - normal * fallback_tangent.dot(normal)
    if tangent.length < 1e-6:
        tangent = Vector((1, 0, 0)) - normal * normal.x
    tangent.normalize()
    bitangent = normal.cross(tangent)
    if bitangent.length < 1e-6:
        bitangent = Vector((0, 0, 1))
    bitangent.normalize()
    return surface, normal, bitangent


def densify_curves(
    source: bpy.types.Object,
    carrier: bpy.types.Object,
    *,
    replicas: int,
    root_spread: float,
    seed: int,
) -> list[list[Vector]]:
    dense: list[list[Vector]] = []
    rng = random.Random(seed)
    for source_index, points in enumerate(curve_points(source)):
        if len(points) < 2:
            continue
        fallback_tangent = (points[1] - points[0]).normalized()
        root_surface, normal, bitangent = closest_frame(carrier, points[0], fallback_tangent)
        tangent = normal.cross(bitangent).normalized()
        for replica in range(replicas):
            if replica == 0:
                along = across = 0.0
            else:
                radius = root_spread * math.sqrt(rng.random())
                theta = rng.random() * math.tau
                along = math.cos(theta) * radius
                across = math.sin(theta) * radius
            candidate = root_surface + tangent * along + bitangent * across
            success, projected_root, projected_normal, _ = carrier.closest_point_on_mesh(candidate)
            if not success:
                projected_root = candidate
                projected_normal = normal
            projected_normal.normalize()
            root_delta = projected_root + projected_normal * 0.0025 - points[0]
            phase = rng.random() * math.tau + source_index * 0.17
            sway = root_spread * (0.10 + 0.18 * rng.random())
            length_scale = 0.94 + 0.12 * rng.random()
            root = points[0] + root_delta
            strand: list[Vector] = []
            for index, source_point in enumerate(points):
                t = index / max(1, len(points) - 1)
                displacement = (source_point - points[0]) * length_scale
                displacement += bitangent * (sway * math.sin(math.pi * t + phase) * t)
                displacement += projected_normal * (sway * 0.32 * math.sin(math.tau * t + phase) * t)
                strand.append(root + displacement)
            dense.append(strand)
    return dense


def add_curve_object(
    name: str,
    curves: Iterable[list[Vector]],
    materials: list[bpy.types.Material],
    *,
    bevel_depth: float,
    seed: int,
) -> bpy.types.Object:
    data = bpy.data.curves.new(f"{name}Geometry", "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 2
    data.bevel_depth = bevel_depth
    data.bevel_resolution = 1
    for material in materials:
        data.materials.append(material)
    rng = random.Random(seed)
    for points in curves:
        spline = data.splines.new("POLY")
        spline.points.add(len(points) - 1)
        spline.material_index = rng.randrange(len(materials))
        for index, (target, point) in enumerate(zip(spline.points, points)):
            target.co = (*point, 1.0)
            t = index / max(1, len(points) - 1)
            target.radius = 0.92 - 0.74 * (t ** 1.35)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj["presentation_role"] = "source-like-observation-fibers"
    return obj


def create_landmark_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    set_object_material(obj, material)
    obj["presentation_role"] = "non-truth-carrier-landmark"
    return obj


def create_ear(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=0.42, radius2=0.06, depth=0.82, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler[2] = math.radians(180)
    set_object_material(obj, material)
    obj["presentation_role"] = "non-truth-carrier-landmark"
    return obj


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area_light(name: str, location: tuple[float, float, float], energy: float, size: float, color: tuple[float, float, float]) -> None:
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.shape = "DISK"
    light.data.size = size
    light.data.color = color
    look_at(light, Vector((0.0, -0.1, 0.0)))


def configure_render() -> bpy.types.Object:
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1088
    scene.render.resolution_y = 817
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 64
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = scene.world or bpy.data.worlds.new("SourceLikeWorld")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.055, 0.07, 0.09, 1.0)
    background.inputs["Strength"].default_value = 0.18

    camera = bpy.data.objects.get("EvidenceCamera")
    if camera is None:
        bpy.ops.object.camera_add()
        camera = bpy.context.object
        camera.name = "EvidenceCamera"
    camera.data.sensor_fit = "VERTICAL"
    camera.data.angle = 2.0 * math.atan(1.0 / 2.7474774194546225)
    scene.camera = camera
    return camera


def hide_source_presentation() -> None:
    for obj in bpy.context.scene.objects:
        if obj.type in {"LIGHT", "CAMERA"}:
            continue
        obj.hide_render = obj.name != "CarrierNeutral"


def render(path: Path) -> None:
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError(f"render failed to produce {path.name}")


def build(request_path: Path, output_dir: Path) -> dict[str, Any]:
    request = json.loads(request_path.read_text())
    repo_root = Path(__file__).resolve().parents[1]
    if request.get("schema") != "kaminos.procedural-groom-source-like-request.v0":
        raise ValueError("unexpected request schema")
    if request.get("fixtureId") != FIXTURE_ID:
        raise ValueError("fixture identity mismatch")
    if request.get("requestedRoute") != REQUIRED_ROUTE:
        raise ValueError("request does not name the protected Blender route")
    groom_request = resolve_groom_request(request)
    density_multiplier = groom_request["densityMultiplier"]

    source_manifest_path = (repo_root / request["sourceManifestPath"]).resolve()
    source_blend_path = (repo_root / request["sourceBlendPath"]).resolve()
    diagnostic_observation_path = (repo_root / request["diagnosticObservationPath"]).resolve()
    for path, expected, label in [
        (source_manifest_path, request["sourceManifestSha256"], "source manifest"),
        (source_blend_path, request["sourceBlendSha256"], "source blend"),
        (diagnostic_observation_path, request["diagnosticObservationSha256"], "diagnostic observation"),
    ]:
        if not path.is_file() or path.stat().st_size <= 0:
            raise ValueError(f"{label} is missing or blank")
        if sha256(path) != expected:
            raise ValueError(f"{label} digest mismatch")

    source_manifest = json.loads(source_manifest_path.read_text())
    diagnostic_observation = json.loads(diagnostic_observation_path.read_text())
    if source_manifest.get("schema") != "kaminos.procedural-groom-truth.v0":
        raise ValueError("source manifest schema mismatch")
    if diagnostic_observation.get("schema") != "kaminos.procedural-groom-observation.v0":
        raise ValueError("diagnostic observation schema mismatch")

    output_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(source_blend_path))
    hide_source_presentation()
    carrier = bpy.data.objects.get("CarrierNeutral")
    if carrier is None or carrier.type != "MESH":
        raise RuntimeError("source scene lacks CarrierNeutral mesh")

    undercoat = principled_material("SourceLikeUndercoat", "#684633", roughness=0.89)
    coat_surface = fibrous_surface_material("SourceLikeCoatSurface")
    coat_materials = [
        principled_material("SourceLikeFiberWarm", "#805238", roughness=0.84),
        principled_material("SourceLikeFiberLight", "#9c6742", roughness=0.86),
        principled_material("SourceLikeFiberDark", "#563729", roughness=0.88),
    ]
    whisker_material = principled_material("SourceLikeWhiskers", "#eadcc3", roughness=0.64)
    eye_material = principled_material("SourceLikeEyes", "#172018", roughness=0.28)
    nose_material = principled_material("SourceLikeNose", "#2a1717", roughness=0.52)
    inner_ear_material = principled_material("SourceLikeInnerEar", "#a86d68", roughness=0.82)
    set_object_material(carrier, undercoat)
    for polygon in carrier.data.polygons:
        polygon.use_smooth = True
    carrier.hide_render = False
    coat_shell = create_coat_shell(carrier, coat_surface)

    generated_objects = []
    microfur_curves, microfur_counts, baseline_microfur_counts = build_microfur(
        carrier,
        density_multiplier=density_multiplier,
        lengths=groom_request["effectiveLengths"],
    )
    coat_fiber_count = len(microfur_curves)
    baseline_coat_fiber_count = sum(baseline_microfur_counts.values())
    fiber_count = coat_fiber_count
    generated_objects.append(add_curve_object(
        "SourceLikeCarrierMicrofur", microfur_curves, coat_materials, bevel_depth=0.0022, seed=8103,
    ))

    whisker_source = bpy.data.objects.get("MystacialWhiskers")
    if whisker_source is None or whisker_source.type != "CURVE":
        raise RuntimeError("source scene lacks MystacialWhiskers curves")
    whisker_curves = list(curve_points(whisker_source))
    fiber_count += len(whisker_curves)
    generated_objects.append(add_curve_object(
        "SourceLikeMystacialWhiskers", whisker_curves, [whisker_material], bevel_depth=0.0028, seed=449,
    ))

    landmark_objects = [
        create_ear("SourceLikeEarLeft", (-0.48, -0.08, 1.23), (0.95, 0.48, 1.0), undercoat),
        create_ear("SourceLikeEarRight", (0.48, -0.08, 1.23), (0.95, 0.48, 1.0), undercoat),
        create_landmark_sphere("SourceLikeEyeLeft", (-0.37, -1.39, 0.38), (0.12, 0.055, 0.15), eye_material),
        create_landmark_sphere("SourceLikeEyeRight", (0.37, -1.39, 0.38), (0.12, 0.055, 0.15), eye_material),
        create_landmark_sphere("SourceLikeNose", (0.0, -1.72, -0.13), (0.16, 0.07, 0.11), nose_material),
    ]

    camera = configure_render()
    add_area_light("SourceLikeKey", (4.2, -5.0, 5.6), 470.0, 4.2, (1.0, 0.82, 0.68))
    add_area_light("SourceLikeFill", (-4.5, -2.0, 2.8), 270.0, 5.0, (0.62, 0.76, 1.0))
    add_area_light("SourceLikeRim", (2.0, 3.4, 4.2), 360.0, 3.2, (0.90, 0.94, 1.0))

    masks = [product for product in source_manifest.get("products", []) if product.get("kind") == "projected-truth-mask"]
    views: list[dict[str, Any]] = []
    diagnostic_by_id = {view["id"]: view for view in diagnostic_observation.get("views", [])}
    for view_id in VIEW_IDS:
        mask = next((item for item in masks if item.get("viewId") == view_id), None)
        diagnostic = diagnostic_by_id.get(view_id)
        if mask is None or diagnostic is None:
            raise RuntimeError(f"missing sealed camera or diagnostic view {view_id}")
        camera.location = Vector(mask["blenderCameraPosition"])
        look_at(camera, Vector(mask["blenderCameraTarget"]))
        source_path = output_dir / f"source-like-{view_id}.png"
        render(source_path)
        diagnostic_source = (diagnostic_observation_path.parent / diagnostic["path"]).resolve()
        if sha256(diagnostic_source) != diagnostic["sha256"]:
            raise RuntimeError(f"diagnostic view digest drift for {view_id}")
        diagnostic_path = output_dir / f"diagnostic-{view_id}.png"
        shutil.copyfile(diagnostic_source, diagnostic_path)
        views.append({
            "id": view_id,
            "diagnostic": product(diagnostic_path, output_dir),
            "sourceLike": product(source_path, output_dir),
            "cameraPosition": mask["cameraPosition"],
            "cameraTarget": mask["cameraTarget"],
            "blenderCameraPosition": mask["blenderCameraPosition"],
            "blenderCameraTarget": mask["blenderCameraTarget"],
            "membershipColorsVisible": False,
            "labelsVisible": False,
            "gizmoVisible": False,
        })

    source_like_blend = output_dir / "procedural-groom-source-like.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_like_blend))
    if not source_like_blend.is_file() or source_like_blend.stat().st_size <= 0:
        raise RuntimeError("source-like Blender scene is blank")

    observation = {
        "schema": SCHEMA,
        "fixtureId": FIXTURE_ID,
        "observationId": f"{OBSERVATION_ID}-{groom_request['observationSuffix']}",
        "requestedRoute": request["requestedRoute"],
        "effectiveRoute": REQUIRED_ROUTE,
        "presentationVariable": "diagnostic-viewer-vs-source-like-groom",
        "heldConstant": [
            "authored-carrier", "groom-system-membership", "guide-field", "camera-poses",
            "vlm-prompt", "vlm-model", "sam-model", "truth-scoring",
        ],
        "source": {
            "manifestPath": source_manifest_path.relative_to(repo_root).as_posix(),
            "manifestSha256": sha256(source_manifest_path),
            "blendPath": source_blend_path.relative_to(repo_root).as_posix(),
            "blendSha256": sha256(source_blend_path),
            "diagnosticObservationPath": diagnostic_observation_path.relative_to(repo_root).as_posix(),
            "diagnosticObservationSha256": sha256(diagnostic_observation_path),
        },
        "targetDistributionApproximation": {
            "integratedFiberField": True,
            "naturalShading": True,
            "recognizableCarrierLandmarks": True,
            "membershipColorEncoding": False,
            "renderer": bpy.context.scene.render.engine,
            "blenderVersion": bpy.app.version_string,
            "fiberCurveCount": fiber_count,
            "fiberCountsByRegime": microfur_counts,
            "baselineFiberCountsByRegime": baseline_microfur_counts,
            "baselineCoatFiberCurveCount": baseline_coat_fiber_count,
            "coatFiberCurveCount": coat_fiber_count,
            "requestedDensityMultiplier": density_multiplier,
            "effectiveDensityMultiplier": density_multiplier,
            "baselineFiberLengths": groom_request["baselineLengths"],
            "effectiveFiberLengths": groom_request["effectiveLengths"],
            "requestedRuffLengthMultiplier": groom_request["ruffLengthMultiplier"],
            "effectiveRuffLengthMultiplier": groom_request["ruffLengthMultiplier"],
            "coatSurfaceModel": "spatially-varying-displaced-shell-from-authored-regime-partition",
            "fiberConstruction": "carrier-triangle-microfur-following-authored-region-and-flow-rule",
            "coatShellObject": coat_shell.name,
            "auxiliaryLandmarkGeometry": [obj.name for obj in landmark_objects],
            "coatPalettePolicy": "shared-randomized-palette-across-all-coat-regions",
        },
        "views": views,
        "products": [
            {"kind": "source-like-blend", **product(source_like_blend, output_dir)},
        ],
        "claimCeiling": "Observation-domain friendliness under one procedural truth fixture only; no estimator correctness, target-distribution equivalence, anatomical truth, production grooming, or visual admission.",
        "visualAdmission": False,
        "scientificAdmission": False,
    }
    observation_path = output_dir / "observation.json"
    write_json(observation_path, observation)
    write_json(output_dir / "render-report.json", {
        "schema": "kaminos.procedural-groom-source-like-render-report.v0",
        "state": "source_like_views_rendered",
        "phase": "complete",
        "fixtureId": FIXTURE_ID,
        "observationSha256": sha256(observation_path),
        "sourceManifestSha256": sha256(source_manifest_path),
        "sourceBlendSha256": sha256(source_blend_path),
        "requestedRoute": request["requestedRoute"],
        "effectiveRoute": REQUIRED_ROUTE,
        "effectiveRenderer": bpy.context.scene.render.engine,
        "effectiveBlenderVersion": bpy.app.version_string,
        "fiberCurveCount": fiber_count,
        "baselineCoatFiberCurveCount": baseline_coat_fiber_count,
        "coatFiberCurveCount": coat_fiber_count,
        "requestedDensityMultiplier": density_multiplier,
        "effectiveDensityMultiplier": density_multiplier,
        "baselineFiberLengths": groom_request["baselineLengths"],
        "effectiveFiberLengths": groom_request["effectiveLengths"],
        "requestedRuffLengthMultiplier": groom_request["ruffLengthMultiplier"],
        "effectiveRuffLengthMultiplier": groom_request["ruffLengthMultiplier"],
        "lastTrustworthyEvidence": "three-digest-bound-source-like-renders",
        "visualAdmission": False,
        "scientificAdmission": False,
    })
    return observation


def main() -> int:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    output_dir = Path(args[1]).resolve() if len(args) >= 2 else Path.cwd() / "source-like-failed"
    try:
        if len(args) != 2:
            raise ValueError("expected request.json and output directory")
        build(Path(args[0]).resolve(), output_dir)
        return 0
    except Exception as error:
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(output_dir / "render-report.json", {
            "schema": "kaminos.procedural-groom-source-like-render-report.v0",
            "state": "failed",
            "phase": "render",
            "error": str(error),
            "traceback": traceback.format_exc(),
            "lastTrustworthyEvidence": None,
            "visualAdmission": False,
            "scientificAdmission": False,
        })
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
