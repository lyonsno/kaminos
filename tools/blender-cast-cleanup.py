"""Source-bound Blender worker for the mannequin 80413 cast cleanup assay."""

from __future__ import annotations

import hashlib
import json
import math
import sys
import traceback
from pathlib import Path
from typing import Any

import bmesh
import bpy
from mathutils import Vector


REPORT_SCHEMA = "kaminos.cast-cleanup-report.v0"
ROUTE_ID = "kaminos_blender_cast_cleanup"
WORKER_ID = "blender-cast-cleanup-v0"
VIEW_IDS = ("left", "right", "front", "rear")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha256(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def _component_sets(mesh: bpy.types.Mesh) -> list[list[int]]:
    adjacency = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        left, right = edge.vertices
        adjacency[left].append(right)
        adjacency[right].append(left)
    remaining = set(range(len(mesh.vertices)))
    components: list[list[int]] = []
    while remaining:
        seed = remaining.pop()
        stack = [seed]
        component = [seed]
        while stack:
            current = stack.pop()
            for neighbor in adjacency[current]:
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    stack.append(neighbor)
                    component.append(neighbor)
        components.append(component)
    components.sort(key=len, reverse=True)
    return components


def _keep_largest_component(mesh: bpy.types.Mesh) -> tuple[int, int]:
    before = _component_sets(mesh)
    if len(before) <= 1:
        return len(before), len(before)
    keep = set(before[0])
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        remove = [vertex for vertex in bm.verts if vertex.index not in keep]
        bmesh.ops.delete(bm, geom=remove, context="VERTS")
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()
    return len(before), len(_component_sets(mesh))


def _smooth(mesh: bpy.types.Mesh, iterations: int, factor: float) -> None:
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        for _ in range(iterations):
            bmesh.ops.smooth_vert(
                bm,
                verts=list(bm.verts),
                factor=factor,
                use_axis_x=True,
                use_axis_y=True,
                use_axis_z=True,
            )
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()


def _bounds(obj: bpy.types.Object) -> dict[str, list[float]]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return {
        "min": minimum,
        "max": maximum,
        "extent": [maximum[axis] - minimum[axis] for axis in range(3)],
    }


def _geometry(obj: bpy.types.Object) -> dict[str, Any]:
    mesh = obj.data
    mesh.calc_loop_triangles()
    return {
        "vertexCount": len(mesh.vertices),
        "triangleCount": len(mesh.loop_triangles),
        "connectedComponentCount": len(_component_sets(mesh)),
        "bounds": _bounds(obj),
    }


def _select_only(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_render = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _clear_startup_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def _import_source(source_path: Path) -> bpy.types.Object:
    _clear_startup_scene()
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("source import produced no mesh objects")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    source = bpy.context.view_layer.objects.active
    source.name = "mannequin-80413-source"
    _select_only(source)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return source


def _clean_candidate(source: bpy.types.Object, profile: dict[str, Any]) -> tuple[bpy.types.Object, dict[str, int]]:
    candidate = source.copy()
    candidate.data = source.data.copy()
    candidate.name = f"mannequin-80413-{profile['id']}"
    bpy.context.scene.collection.objects.link(candidate)
    _select_only(candidate)
    candidate.data.remesh_voxel_size = float(profile["voxelSize"])
    candidate.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()
    components_before_prune, components_after_prune = _keep_largest_component(candidate.data)
    _smooth(candidate.data, int(profile["smoothIterations"]), float(profile["smoothFactor"]))
    candidate.data.validate(verbose=False)
    candidate.data.update()
    return candidate, {
        "componentsBeforePrune": components_before_prune,
        "componentsAfterPrune": components_after_prune,
    }


def _export_glb(obj: bpy.types.Object, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _select_only(obj)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
    )
    if not path.exists() or path.stat().st_size <= 0:
        raise RuntimeError(f"Blender export did not produce {path}")


def _look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def _render_setup(source_bounds: dict[str, list[float]]) -> tuple[bpy.types.Object, Vector, dict[str, Vector]]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.075)

    camera_data = bpy.data.cameras.new("cleanup-camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("cleanup-camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    minimum = source_bounds["min"]
    maximum = source_bounds["max"]
    extent = source_bounds["extent"]
    center = Vector(tuple((minimum[axis] + maximum[axis]) * 0.5 for axis in range(3)))
    distance = max(extent) * 2.5
    camera_data.ortho_scale = max(extent[1], extent[2], extent[0]) * 1.18
    views = {
        "left": Vector((-distance, center.y, center.z)),
        "right": Vector((distance, center.y, center.z)),
        "front": Vector((center.x, -distance, center.z)),
        "rear": Vector((center.x, distance, center.z)),
    }
    return camera, center, views


def _render_views(
    obj: bpy.types.Object,
    directory: Path,
    camera: bpy.types.Object,
    target: Vector,
    views: dict[str, Vector],
) -> list[dict[str, Any]]:
    directory.mkdir(parents=True, exist_ok=True)
    obj.color = (0.82, 0.62, 0.31, 1.0)
    obj.hide_render = False
    renders = []
    for view_id in VIEW_IDS:
        camera.location = views[view_id]
        _look_at(camera, target)
        output_path = directory / f"{view_id}.png"
        bpy.context.scene.render.filepath = str(output_path)
        bpy.ops.render.render(write_still=True)
        renders.append({
            "viewId": view_id,
            "path": str(output_path),
            "sha256": _sha256(output_path),
            "byteLength": output_path.stat().st_size,
        })
    obj.hide_render = True
    return renders


def _load_and_verify_spec(source_path: Path, output_directory: Path, worker_path: Path) -> dict[str, Any]:
    spec_path = output_directory / "cleanup-spec.json"
    spec = json.loads(spec_path.read_text())
    spec_core = {key: value for key, value in spec.items() if key != "specSha256"}
    if _canonical_sha256(spec_core) != spec.get("specSha256"):
        raise ValueError("cleanup spec hash does not match canonical content")
    if Path(spec["source"]["path"]).resolve() != source_path:
        raise ValueError("requested source path does not match cleanup spec")
    if spec["source"]["sha256"] != _sha256(source_path):
        raise ValueError("requested source bytes do not match cleanup spec")
    if Path(spec["worker"]["path"]).resolve() != worker_path:
        raise ValueError("effective worker path does not match cleanup spec")
    if spec["worker"]["sha256"] != _sha256(worker_path):
        raise ValueError("effective worker bytes do not match cleanup spec")
    if Path(spec["outputDirectory"]).resolve() != output_directory:
        raise ValueError("effective output directory does not match cleanup spec")
    return spec


def main() -> None:
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 2:
        raise ValueError("worker requires <source.glb> <output-directory>")
    source_path = Path(arguments[0]).resolve()
    output_directory = Path(arguments[1]).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    report_path = output_directory / "cleanup-report.json"
    worker_path = Path(__file__).resolve()
    phase = "source-verification"
    last_evidence = "Worker started; no source identity was admitted"
    outputs: list[dict[str, Any]] = []
    spec: dict[str, Any] | None = None

    try:
        spec = _load_and_verify_spec(source_path, output_directory, worker_path)
        source_sha = _sha256(source_path)
        last_evidence = "Source, worker, output directory, and canonical cleanup spec identities matched"
        phase = "source-import"
        source = _import_source(source_path)
        source_bounds = _bounds(source)
        source_geometry = _geometry(source)
        camera, target, views = _render_setup(source_bounds)
        phase = "source-render"
        source_renders = _render_views(source, output_directory / "source" / "renders", camera, target, views)
        source.hide_render = True
        last_evidence = "Observed source imported and rendered from all frozen views"

        for profile in spec["profiles"]:
            profile_id = profile["id"]
            phase = f"voxel-remesh-{profile_id}"
            candidate, cleanup_facts = _clean_candidate(source, profile)
            geometry = _geometry(candidate)
            if geometry["connectedComponentCount"] != 1:
                raise RuntimeError(f"{profile_id} cleanup retained more than one connected component")
            phase = f"export-{profile_id}"
            glb_path = output_directory / profile_id / "cast.glb"
            _export_glb(candidate, glb_path)
            phase = f"render-{profile_id}"
            renders = _render_views(candidate, output_directory / profile_id / "renders", camera, target, views)
            outputs.append({
                "profileId": profile_id,
                "path": str(glb_path),
                "sha256": _sha256(glb_path),
                "byteLength": glb_path.stat().st_size,
                "geometry": geometry,
                "cleanupFacts": cleanup_facts,
                "renders": renders,
            })
            candidate.hide_render = True
            last_evidence = f"{profile_id} output and all matched-view renders were exported and hashed"

        phase = "report"
        report = {
            "schema": REPORT_SCHEMA,
            "status": "succeeded",
            "requestedRoute": {
                "id": ROUTE_ID,
                "sourcePath": spec["source"]["path"],
                "sourceSha256": spec["source"]["sha256"],
                "specSha256": spec["specSha256"],
            },
            "effectiveRoute": {
                "id": WORKER_ID,
                "blenderVersion": bpy.app.version_string,
                "sourcePath": str(source_path),
                "sourceSha256": source_sha,
                "scriptPath": str(worker_path),
                "scriptSha256": _sha256(worker_path),
                "specSha256": spec["specSha256"],
            },
            "sourceWitness": {
                "geometry": source_geometry,
                "renders": source_renders,
            },
            "outputs": outputs,
            "failurePhase": None,
            "lastTrustworthyEvidence": "All output bytes and matched-view renders were hashed after export",
        }
        _write_report(report_path, report)
    except Exception as error:
        spec_source = spec.get("source", {}) if spec else {}
        spec_worker = spec.get("worker", {}) if spec else {}
        report = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "requestedRoute": {
                "id": ROUTE_ID,
                "sourcePath": spec_source.get("path", str(source_path)),
                "sourceSha256": spec_source.get("sha256", "unknown"),
                "specSha256": spec.get("specSha256", "unknown") if spec else "unknown",
            },
            "effectiveRoute": {
                "id": WORKER_ID,
                "blenderVersion": bpy.app.version_string,
                "sourcePath": str(source_path),
                "sourceSha256": _sha256(source_path) if source_path.exists() else "missing",
                "scriptPath": str(worker_path),
                "scriptSha256": _sha256(worker_path),
                "specSha256": spec.get("specSha256", "unknown") if spec else "unknown",
            },
            "outputs": outputs,
            "failurePhase": phase,
            "error": str(error),
            "traceback": traceback.format_exc(),
            "lastTrustworthyEvidence": last_evidence,
        }
        _write_report(report_path, report)
        raise


if __name__ == "__main__":
    main()
