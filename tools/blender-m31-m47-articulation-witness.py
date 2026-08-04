"""Render the bounded M31/M47 support-hinge articulation witness in Blender.

The source .blend is opened read-only. The script isolates one authenticated
support family, transports its two procedural muscle surfaces through an
explicit hinge sweep, and emits a paused image-sequence witness plus replayable
numeric evidence.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


EXPECTED_SOURCE_SHA256 = "a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3"
FIXED_SUPPORT = "Cube.002"
MOVING_SUPPORT = "Cube.003"
SELECTED_MUSCLES = ("Muscle 31", "Muscle 47")
NULL_CONTROL_MUSCLES = ("Muscle 35", "Muscle 38")
ANGLE_DEGREES = (0, 8, 16, 24, 16, 8, 0, -8, -16, -24, -16, -8, 0)
REQUESTED_HINGE = {
    "fixedSupport": FIXED_SUPPORT,
    "movingSupport": MOVING_SUPPORT,
    "pivotStrategy": "moving-support-object-origin",
    "axisStrategy": "moving-support-local-x",
    "angleDegrees": list(ANGLE_DEGREES),
}
REQUESTED_ROUTE = "kaminos_blender_glb_witness"


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def vector_list(value: Vector) -> list[float]:
    return [float(value.x), float(value.y), float(value.z)]


def mean_point(points: list[Vector]) -> Vector:
    if not points:
        raise ValueError("cannot find the center of an empty point set")
    return sum(points, Vector()) / len(points)


def distance(a: Vector, b: Vector) -> float:
    return float((a - b).length)


def custom_text(obj: bpy.types.Object, key: str) -> str:
    value = obj.get(key)
    return "" if value is None else str(value).strip("'")


def ensure_exact_object(name: str, object_type: str | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise ValueError(f"required source object is missing: {name}")
    if object_type is not None and obj.type != object_type:
        raise ValueError(f"{name} must be {object_type}, found {obj.type}")
    return obj


def make_material(name: str, color: tuple[float, float, float, float], metallic: float = 0.0):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = color
    material.metallic = metallic
    material.roughness = 0.38
    return material


def assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)


def select_render_engine(scene: bpy.types.Scene) -> str:
    """Choose the first advertised real-time engine across Blender releases."""

    failures = []
    for candidate in ("BLENDER_WORKBENCH", "BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = candidate
            return candidate
        except (TypeError, ValueError) as error:
            failures.append(f"{candidate}: {error}")
    raise RuntimeError("no supported render engine: " + "; ".join(failures))


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def fit_orthographic_camera(
    camera: bpy.types.Object,
    points: list[Vector],
    *,
    resolution_x: int,
    resolution_y: int,
    margin: float,
) -> dict[str, object]:
    """Center and fit world points in the camera's actual image-plane basis."""

    if not points:
        raise ValueError("camera fit requires at least one world point")
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    local_points = [inverse @ point for point in points]
    minimum_x = min(point.x for point in local_points)
    maximum_x = max(point.x for point in local_points)
    minimum_y = min(point.y for point in local_points)
    maximum_y = max(point.y for point in local_points)
    center_x = (minimum_x + maximum_x) * 0.5
    center_y = (minimum_y + maximum_y) * 0.5
    camera.location += camera.matrix_world.to_3x3() @ Vector((center_x, center_y, 0.0))
    bpy.context.view_layer.update()
    width = maximum_x - minimum_x
    height = maximum_y - minimum_y
    camera.data.ortho_scale = math.hypot(width, height) * margin
    return {
        "pointCount": len(points),
        "cameraPlaneWidth": float(width),
        "cameraPlaneHeight": float(height),
        "imageAspect": float(resolution_x) / float(resolution_y),
        "orthoScale": float(camera.data.ortho_scale),
        "margin": float(margin),
    }


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points: list[Vector] = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        raise ValueError("focused witness has no mesh bounds")
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def section_groups(
    surface: bpy.types.Object,
    *,
    profile_sides: int,
    origin: Vector,
    insertion: Vector,
) -> tuple[list[list[int]], list[list[list[float]]], dict[str, float | bool]]:
    vertex_count = len(surface.data.vertices)
    if profile_sides <= 2 or vertex_count % profile_sides != 0:
        raise ValueError(
            f"{surface.name} cannot form equal profile rings: {vertex_count}/{profile_sides}"
        )
    groups = [
        list(range(start, start + profile_sides))
        for start in range(0, vertex_count, profile_sides)
    ]

    def world_sections(index_groups: list[list[int]]) -> list[list[list[float]]]:
        return [
            [vector_list(surface.matrix_world @ surface.data.vertices[index].co) for index in group]
            for group in index_groups
        ]

    sections = world_sections(groups)
    first = mean_point([Vector(point) for point in sections[0]])
    last = mean_point([Vector(point) for point in sections[-1]])
    forward_residual = distance(first, origin) + distance(last, insertion)
    reverse_residual = distance(first, insertion) + distance(last, origin)
    reversed_order = reverse_residual < forward_residual
    if reversed_order:
        groups.reverse()
        sections = world_sections(groups)
        first = mean_point([Vector(point) for point in sections[0]])
        last = mean_point([Vector(point) for point in sections[-1]])
    origin_residual = distance(first, origin)
    insertion_residual = distance(last, insertion)
    if max(origin_residual, insertion_residual) > 0.08:
        raise ValueError(
            f"{surface.name} endpoint-ring residual exceeds 0.08: "
            f"origin={origin_residual:.6f}, insertion={insertion_residual:.6f}"
        )
    return groups, sections, {
        "reversedSourceRingOrder": reversed_order,
        "originRingResidual": origin_residual,
        "insertionRingResidual": insertion_residual,
        "ringCount": len(groups),
        "profileSideCount": profile_sides,
    }


def duplicate_surface(source: bpy.types.Object, name: str) -> bpy.types.Object:
    duplicate = source.copy()
    duplicate.data = source.data.copy()
    duplicate.name = name
    duplicate.data.name = f"{name} Mesh"
    duplicate.parent = None
    duplicate.matrix_world = source.matrix_world.copy()
    bpy.context.scene.collection.objects.link(duplicate)
    return duplicate


def update_surface(
    obj: bpy.types.Object,
    groups: list[list[int]],
    sections: list[list[list[float]]],
) -> None:
    inverse = obj.matrix_world.inverted()
    for group, section in zip(groups, sections):
        for vertex_index, world_point in zip(group, section):
            obj.data.vertices[vertex_index].co = inverse @ Vector(world_point)
    obj.data.update()


def write_viewer(output_dir: Path, frame_metrics: list[dict[str, object]]) -> None:
    metrics_json = json.dumps(frame_metrics, separators=(",", ":"))
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>M31/M47 articulation witness</title>
<style>
* {{ box-sizing: border-box; }}
html, body {{ width: 100%; min-height: 100%; margin: 0; background: #090b0e; color: #e8edf2; font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }}
body {{ display: grid; place-items: center; padding: 16px; }}
main {{ width: min(1120px, 100%); display: grid; gap: 10px; }}
figure {{ margin: 0; position: relative; aspect-ratio: 9 / 7; overflow: hidden; border: 1px solid #303943; background: #12161b; }}
img {{ width: 100%; height: 100%; object-fit: contain; display: block; }}
.readout {{ position: absolute; left: 12px; top: 12px; padding: 6px 8px; background: rgba(8,10,13,.78); border: 1px solid #3a4652; pointer-events: none; }}
.controls {{ display: grid; grid-template-columns: 40px 1fr; gap: 10px; align-items: center; }}
button {{ width: 40px; height: 36px; border: 1px solid #53606c; background: #151b21; color: #f4f7fa; cursor: pointer; font-size: 16px; }}
button:hover {{ background: #202832; }}
input[type="range"] {{ width: 100%; accent-color: #df9a35; }}
</style>
</head>
<body>
<main>
  <figure>
    <img id="frame" src="frames/frame-000.png" alt="M31 and M47 bounded articulation witness">
    <div class="readout" id="readout"></div>
  </figure>
  <div class="controls">
    <button id="playPause" type="button" title="Play or pause">&#9654;</button>
    <input id="scrub" type="range" min="0" max="{len(frame_metrics) - 1}" value="0" step="1" aria-label="Frame">
  </div>
</main>
<script>
const metrics = {metrics_json};
const frame = document.getElementById('frame');
const scrub = document.getElementById('scrub');
const playPause = document.getElementById('playPause');
const readout = document.getElementById('readout');
let playing = false;
let timer = null;
function show(index) {{
  const i = Number(index);
  const metric = metrics[i];
  scrub.value = String(i);
  frame.src = `frames/frame-${{String(i).padStart(3, '0')}}.png`;
  readout.textContent = `frame ${{i + 1}}/${{metrics.length}} | angle ${{metric.angleDegrees}} deg | max volume drift ${{metric.maxVolumeDrift.toFixed(6)}}`;
}}
function setPlaying(next) {{
  playing = next;
  playPause.textContent = playing ? '\u275a\u275a' : '\u25b6';
  if (timer) clearInterval(timer);
  timer = playing ? setInterval(() => show((Number(scrub.value) + 1) % metrics.length), 140) : null;
}}
scrub.addEventListener('input', () => {{ setPlaying(false); show(scrub.value); }});
playPause.addEventListener('click', () => setPlaying(!playing));
show(0);
</script>
</body>
</html>
"""
    (output_dir / "index.html").write_text(html, encoding="utf-8")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2:
        raise ValueError("expected source .blend and output render path")
    source_path = Path(argv[0]).expanduser().resolve()
    primary_output = Path(argv[1]).expanduser().resolve()
    output_dir = primary_output.parent
    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    failure_path = output_dir / "failure.json"
    repo_root = Path(__file__).resolve().parents[1]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    from tools.m31_m47_articulation import (
        advance_failure_receipt,
        deform_ring_sections,
        rotate_about_axis,
        route_eligibility,
    )

    failure_state: dict[str, object] = {
        "schema": "kaminos.m31-m47-articulation-failure.v1",
        "status": "started",
        "failurePhase": "startup",
        "lastTrustworthyEvidence": "output directory created; source not yet authenticated",
        "witnessScript": str(Path(__file__).resolve()),
        "requestedRoute": REQUESTED_ROUTE,
        "effectiveRoute": REQUESTED_ROUTE,
        "requestedHinge": REQUESTED_HINGE,
        "sourceRequested": str(source_path),
    }
    write_json(failure_path, failure_state)

    source_hash = sha256_file(source_path)
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise ValueError(f"source hash mismatch: {source_hash}")
    advance_failure_receipt(
        failure_state,
        phase="source-open",
        evidence=f"source SHA-256 authenticated: {source_hash}",
        identity={"sourceSha256": source_hash},
    )
    write_json(failure_path, failure_state)

    bpy.ops.wm.open_mainfile(filepath=str(source_path))
    advance_failure_receipt(
        failure_state,
        phase="source-validation",
        evidence="authenticated source opened read-only in Blender",
        identity={
            "sourceEffective": str(source_path),
            "blenderVersion": bpy.app.version_string,
        },
    )
    write_json(failure_path, failure_state)

    fixture_path = repo_root / "fixtures" / "track-m-routing" / "m31-m47-routing-fixture.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    eligibility = route_eligibility(fixture, ("muscle-31", "muscle-47"))
    correct_routes = {
        route["name"]: route for route in fixture["conditions"]["correct"]["routes"]
    }

    fixed_support = ensure_exact_object(FIXED_SUPPORT, "MESH")
    moving_support = ensure_exact_object(MOVING_SUPPORT, "MESH")
    fixed_matrix = fixed_support.matrix_world.copy()
    moving_matrix = moving_support.matrix_world.copy()
    pivot = moving_matrix.translation.copy()
    axis = (moving_matrix.to_3x3() @ Vector((1.0, 0.0, 0.0))).normalized()
    effective_hinge = {
        "fixedSupport": FIXED_SUPPORT,
        "movingSupport": MOVING_SUPPORT,
        "pivotStrategy": "moving-support-object-origin",
        "pivotWorld": vector_list(pivot),
        "axisStrategy": "moving-support-local-x",
        "axisWorld": vector_list(axis),
    }

    source_materials = {
        FIXED_SUPPORT: make_material("Witness | Fixed support", (0.20, 0.24, 0.29, 1.0), 0.15),
        MOVING_SUPPORT: make_material("Witness | Moving support", (0.48, 0.55, 0.63, 1.0), 0.25),
        "Muscle 31": make_material("Witness | Muscle 31", (0.91, 0.42, 0.12, 1.0)),
        "Muscle 47": make_material("Witness | Muscle 47", (0.10, 0.68, 0.80, 1.0)),
    }

    for obj in bpy.context.scene.objects:
        obj.hide_render = True
        obj.hide_set(True)
    for support in (fixed_support, moving_support):
        support.hide_render = False
        support.hide_set(False)
        assign_material(support, source_materials[support.name])

    muscle_states: dict[str, dict[str, object]] = {}
    for muscle_name in SELECTED_MUSCLES:
        rig = ensure_exact_object(muscle_name, "EMPTY")
        route = correct_routes[muscle_name]
        expected_id = muscle_name.lower().replace(" ", "-")
        if custom_text(rig, "cmk_construction_id") != expected_id:
            raise ValueError(f"{muscle_name} construction identity is not {expected_id}")
        if custom_text(rig, "cmk_endpoint_route") != "draw_muscle":
            raise ValueError(f"{muscle_name} is not a draw_muscle source")
        if custom_text(rig, "cmk_origin_source") != FIXED_SUPPORT:
            raise ValueError(f"{muscle_name} origin does not bind {FIXED_SUPPORT}")
        if custom_text(rig, "cmk_insertion_source") != MOVING_SUPPORT:
            raise ValueError(f"{muscle_name} insertion does not bind {MOVING_SUPPORT}")
        surface_name = f"{muscle_name} | Surface"
        source_surface = ensure_exact_object(surface_name, "MESH")
        profile_sides = int(rig.get("cmk_profile_sides", route["settings"]["profile_sides"]))
        origin = Vector(route["origin"]["point"])
        insertion = Vector(route["insertion"]["point"])
        groups, sections, ring_evidence = section_groups(
            source_surface,
            profile_sides=profile_sides,
            origin=origin,
            insertion=insertion,
        )
        witness_surface = duplicate_surface(source_surface, f"Witness | {muscle_name}")
        witness_surface.hide_render = False
        witness_surface.hide_set(False)
        assign_material(witness_surface, source_materials[muscle_name])
        muscle_states[muscle_name] = {
            "origin": origin,
            "insertion": insertion,
            "groups": groups,
            "sections": sections,
            "sourceSurface": surface_name,
            "surface": witness_surface,
            "ringEvidence": ring_evidence,
        }

    advance_failure_receipt(
        failure_state,
        phase="render-setup",
        evidence="selected routes authenticated and ring sections reconstructed",
        identity={
            "fixtureEffective": str(fixture_path),
            "fixtureSha256": sha256_file(fixture_path),
            "eligibility": eligibility,
            "effectiveHinge": effective_hinge,
        },
    )
    write_json(failure_path, failure_state)

    scene = bpy.context.scene
    effective_render_engine = select_render_engine(scene)
    advance_failure_receipt(
        failure_state,
        phase="render-setup",
        evidence=f"render engine selected: {effective_render_engine}",
        identity={"effectiveRenderEngine": effective_render_engine},
    )
    write_json(failure_path, failure_state)
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.055, 0.065, 0.078)
    if effective_render_engine == "BLENDER_WORKBENCH":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.display.shading.cavity_type = "WORLD"
        scene.display.shading.background_type = "WORLD"

    camera_data = bpy.data.cameras.new("Witness Camera")
    camera = bpy.data.objects.new("Witness Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.lens = 52
    scene.camera = camera

    light_data = bpy.data.lights.new("Witness Key", "AREA")
    light_data.energy = 1300
    light_data.shape = "DISK"
    light_data.size = 8.0
    light = bpy.data.objects.new("Witness Key", light_data)
    scene.collection.objects.link(light)
    light.location = (22.0, -16.0, 34.0)

    fill_data = bpy.data.lights.new("Witness Fill", "AREA")
    fill_data.energy = 700
    fill_data.size = 10.0
    fill = bpy.data.objects.new("Witness Fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-16.0, 4.0, 20.0)

    pose_envelope_points = [
        fixed_matrix @ Vector(corner) for corner in fixed_support.bound_box
    ]
    for angle_degrees in ANGLE_DEGREES:
        angle_radians = math.radians(angle_degrees)
        delta = (
            Matrix.Translation(pivot)
            @ Matrix.Rotation(angle_radians, 4, axis)
            @ Matrix.Translation(-pivot)
        )
        pose_envelope_points.extend(
            delta @ moving_matrix @ Vector(corner) for corner in moving_support.bound_box
        )
        for state in muscle_states.values():
            neutral_insertion = state["insertion"]
            posed_insertion = rotate_about_axis(
                vector_list(neutral_insertion),
                pivot=vector_list(pivot),
                axis=vector_list(axis),
                angle_radians=angle_radians,
            )
            deformation = deform_ring_sections(
                state["sections"],
                origin=vector_list(state["origin"]),
                insertion=vector_list(neutral_insertion),
                posed_insertion=posed_insertion,
            )
            pose_envelope_points.extend(
                Vector(point)
                for section in deformation["sections"]
                for point in section
            )

    bounds_min = Vector(
        tuple(min(point[component] for point in pose_envelope_points) for component in range(3))
    )
    bounds_max = Vector(
        tuple(max(point[component] for point in pose_envelope_points) for component in range(3))
    )
    target = (bounds_min + bounds_max) * 0.5
    camera_view_direction = axis.normalized()
    camera.location = target + camera_view_direction * 70.0
    look_at(camera, target)
    camera_fit_margin = 1.32
    camera_fit_evidence = fit_orthographic_camera(
        camera,
        pose_envelope_points,
        resolution_x=scene.render.resolution_x,
        resolution_y=scene.render.resolution_y,
        margin=camera_fit_margin,
    )
    light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
    fill.rotation_euler = (target - fill.location).to_track_quat("-Z", "Y").to_euler()

    neutral_support_corners = [moving_matrix @ Vector(corner) for corner in moving_support.bound_box]
    frame_metrics: list[dict[str, object]] = []
    for frame_index, angle_degrees in enumerate(ANGLE_DEGREES):
        angle_radians = math.radians(angle_degrees)
        delta = (
            Matrix.Translation(pivot)
            @ Matrix.Rotation(angle_radians, 4, axis)
            @ Matrix.Translation(-pivot)
        )
        fixed_support.matrix_world = fixed_matrix.copy()
        moving_support.matrix_world = delta @ moving_matrix
        muscle_metrics: dict[str, object] = {}
        max_volume_drift = 0.0
        muscle_max_vertex_displacement = 0.0
        for muscle_name, state in muscle_states.items():
            neutral_insertion = state["insertion"]
            posed_insertion = Vector(
                rotate_about_axis(
                    vector_list(neutral_insertion),
                    pivot=vector_list(pivot),
                    axis=vector_list(axis),
                    angle_radians=angle_radians,
                )
            )
            deformation = deform_ring_sections(
                state["sections"],
                origin=vector_list(state["origin"]),
                insertion=vector_list(neutral_insertion),
                posed_insertion=vector_list(posed_insertion),
            )
            update_surface(state["surface"], state["groups"], deformation["sections"])
            neutral_volume = deform_ring_sections(
                state["sections"],
                origin=vector_list(state["origin"]),
                insertion=vector_list(neutral_insertion),
                posed_insertion=vector_list(neutral_insertion),
            )["volumeProxy"]
            volume_ratio = float(deformation["volumeProxy"]) / float(neutral_volume)
            volume_drift = abs(volume_ratio - 1.0)
            max_volume_drift = max(max_volume_drift, volume_drift)
            max_vertex_displacement = max(
                distance(Vector(source_point), Vector(posed_point))
                for source_section, posed_section in zip(
                    state["sections"], deformation["sections"]
                )
                for source_point, posed_point in zip(source_section, posed_section)
            )
            muscle_max_vertex_displacement = max(
                muscle_max_vertex_displacement, max_vertex_displacement
            )
            first_center = mean_point([Vector(point) for point in deformation["sections"][0]])
            last_center = mean_point([Vector(point) for point in deformation["sections"][-1]])
            muscle_metrics[muscle_name] = {
                "originEndpointError": distance(first_center, state["origin"]),
                "insertionEndpointError": distance(last_center, posed_insertion),
                "neutralPathLength": deformation["neutralPathLength"],
                "posedPathLength": deformation["posedPathLength"],
                "radialScale": deformation["radialScale"],
                "volumeRatio": volume_ratio,
                "maxVertexDisplacement": max_vertex_displacement,
            }
        scene.view_settings.look = "AgX - Medium High Contrast"
        frame_path = frames_dir / f"frame-{frame_index:03d}.png"
        scene.render.filepath = str(frame_path)
        bpy.ops.render.render(write_still=True)
        frame_metrics.append(
            {
                "frame": frame_index,
                "angleDegrees": angle_degrees,
                "maxVolumeDrift": max_volume_drift,
                "muscleMaxVertexDisplacement": muscle_max_vertex_displacement,
                "movingSupportMaxCornerDisplacement": max(
                    distance(neutral, moving_support.matrix_world @ Vector(corner))
                    for neutral, corner in zip(neutral_support_corners, moving_support.bound_box)
                ),
                "muscles": muscle_metrics,
                "pngFileSha256": sha256_file(frame_path),
            }
        )
        advance_failure_receipt(
            failure_state,
            phase="render-frames",
            evidence=f"rendered frame {frame_index} at {angle_degrees} degrees",
            identity={"renderedFrameCount": frame_index + 1},
        )
        write_json(failure_path, failure_state)

    shutil.copy2(frames_dir / "frame-000.png", primary_output)
    write_viewer(output_dir, frame_metrics)
    manifest = {
        "schema": "kaminos.m31-m47-articulation-witness.v1",
        "status": "complete",
        "requestedRoute": REQUESTED_ROUTE,
        "effectiveRoute": REQUESTED_ROUTE,
        "sourceRequested": str(source_path),
        "sourceEffective": str(source_path),
        "sourceSha256": source_hash,
        "blenderVersion": bpy.app.version_string,
        "effectiveRenderEngine": effective_render_engine,
        "cameraFitMargin": camera_fit_margin,
        "cameraFitEvidence": camera_fit_evidence,
        "eligibility": eligibility,
        "nullControlRoutes": list(NULL_CONTROL_MUSCLES),
        "requestedHinge": REQUESTED_HINGE,
        "effectiveHinge": effective_hinge,
        "frameMetrics": frame_metrics,
        "muscles": {
            name: {
                "sourceSurface": state["sourceSurface"],
                "ringEvidence": state["ringEvidence"],
            }
            for name, state in muscle_states.items()
        },
        "outputs": {
            "primaryFrame": str(primary_output),
            "viewer": str(output_dir / "index.html"),
            "frameDirectory": str(frames_dir),
        },
    }
    write_json(output_dir / "manifest.json", manifest)
    advance_failure_receipt(
        failure_state,
        phase=None,
        evidence="complete manifest and paused frame viewer written",
        identity={
            "status": "not-failed",
            "manifestEffective": str(output_dir / "manifest.json"),
            "viewerEffective": str(output_dir / "index.html"),
        },
    )
    write_json(failure_path, failure_state)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
        if len(argv) >= 2:
            failure_path = Path(argv[1]).expanduser().resolve().parent / "failure.json"
            prior: dict[str, object] = {}
            if failure_path.exists():
                try:
                    prior = json.loads(failure_path.read_text(encoding="utf-8"))
                except Exception:
                    prior = {}
            prior.update(
                status="failed",
                errorType=type(error).__name__,
                error=str(error),
                traceback=traceback.format_exc(),
            )
            write_json(failure_path, prior)
        raise
