"""CPU Blender consumer for the admitted malformed-coat selection."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))

from carrier_shell_recovery import (  # noqa: E402
    choose_candidate,
    evaluate_candidate,
    load_admitted_selection,
    verify_source,
    write_failure_report,
)


LAST_EVIDENCE = {"phase": "not-started"}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def imported_target(path: Path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"GLB import produced no mesh objects: {path}")
    target = max(meshes, key=lambda obj: len(obj.data.polygons))
    if any(len(polygon.vertices) != 3 for polygon in target.data.polygons):
        raise RuntimeError("authenticated target contains non-triangle polygons")
    return target


def world_geometry(obj):
    coordinates = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", coordinates)
    local = coordinates.reshape((-1, 3))
    homogeneous = np.column_stack((local, np.ones(len(local))))
    world = homogeneous @ np.asarray(obj.matrix_world, dtype=np.float64).T
    obj.data.calc_loop_triangles()
    triangles = np.empty(len(obj.data.loop_triangles) * 3, dtype=np.int64)
    obj.data.loop_triangles.foreach_get("vertices", triangles)
    return world[:, :3], triangles.reshape((-1, 3))


def compact_selected_geometry(vertices, triangles, selection):
    selected = triangles[selection]
    used, inverse = np.unique(selected.reshape(-1), return_inverse=True)
    return vertices[used], inverse.reshape((-1, 3))


def create_mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices.tolist(), [], faces.tolist())
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_material(name, color, *, emission=False):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    if emission:
        shader = nodes.new("ShaderNodeEmission")
        shader.inputs["Color"].default_value = color
        shader.inputs["Strength"].default_value = 1.0
    else:
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Roughness"].default_value = 0.68
    links.new(shader.outputs[0], output.inputs["Surface"])
    return material


def assign_material(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


def bounds(obj):
    vertices, _ = world_geometry(obj)
    minimum = vertices.min(axis=0)
    maximum = vertices.max(axis=0)
    return minimum, maximum, maximum - minimum


def component_face_counts(mesh):
    polygons = list(mesh.polygons)
    parent = list(range(len(polygons)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(first, second):
        first_root, second_root = find(first), find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    first_face_by_vertex = {}
    for face_index, polygon in enumerate(polygons):
        for vertex_index in polygon.vertices:
            if vertex_index in first_face_by_vertex:
                union(face_index, first_face_by_vertex[vertex_index])
            else:
                first_face_by_vertex[vertex_index] = face_index
    counts = {}
    for index in range(len(polygons)):
        root = find(index)
        counts[root] = counts.get(root, 0) + 1
    return sorted(counts.values(), reverse=True)


def mesh_volume(mesh):
    mesh.calc_loop_triangles()
    vertices = np.asarray([vertex.co[:] for vertex in mesh.vertices], dtype=np.float64)
    volume = 0.0
    for triangle in mesh.loop_triangles:
        first, second, third = vertices[list(triangle.vertices)]
        volume += float(np.dot(first, np.cross(second, third))) / 6.0
    return abs(volume)


def configure_camera(scene, center, span, direction, *, resolution, transparent):
    for obj in list(scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    camera_data = bpy.data.cameras.new("carrier-camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = span * 1.18
    camera = bpy.data.objects.new("carrier-camera", camera_data)
    scene.collection.objects.link(camera)
    direction = Vector(direction).normalized()
    camera.location = Vector(center) + direction * span * 3.0
    camera.rotation_euler = (Vector(center) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = transparent
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("carrier-world")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.008, 0.01, 0.014, 1.0)
    background.inputs["Strength"].default_value = 0.12
    return camera


def set_only_visible(visible_objects):
    visible = set(visible_objects)
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_render = obj not in visible


def render_mask(obj, destination, direction, source_center, source_span):
    scene = bpy.context.scene
    set_only_visible([obj])
    assign_material(obj, make_material(f"mask-{obj.name}", (1.0, 1.0, 1.0, 1.0), emission=True))
    configure_camera(
        scene,
        source_center,
        source_span,
        direction,
        resolution=256,
        transparent=True,
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    pixels = load_render_pixels(destination, 256)
    mask = pixels[:, :, 3] > 0.05
    if int(mask.sum()) < 300:
        raise RuntimeError(f"silhouette render is blank or nearly blank: {destination}")
    return mask


def silhouette_iou(first, second):
    union = np.logical_or(first, second).sum()
    if not union:
        raise RuntimeError("silhouette comparison has an empty union")
    return float(np.logical_and(first, second).sum() / union)


def load_render_pixels(destination, resolution):
    image = bpy.data.images.load(str(destination), check_existing=False)
    try:
        pixels = np.asarray(image.pixels[:], dtype=np.float32)
        expected = resolution * resolution * 4
        if pixels.size != expected:
            raise RuntimeError(
                f"saved render has {pixels.size} channels; expected {expected}: {destination}"
            )
        return pixels.reshape((resolution, resolution, 4))
    finally:
        bpy.data.images.remove(image)


def render_beauty(objects, destination, center, span, materials):
    scene = bpy.context.scene
    set_only_visible(objects)
    for obj, material in zip(objects, materials):
        assign_material(obj, material)
    configure_camera(
        scene,
        center,
        span,
        (math.cos(math.radians(12)) * math.cos(math.radians(-34)),
         math.cos(math.radians(12)) * math.sin(math.radians(-34)),
         math.sin(math.radians(12))),
        resolution=700,
        transparent=False,
    )
    for name, energy, size, offset in (
        ("key", 900.0, 5.0, (1.4, -1.8, 2.2)),
        ("fill", 450.0, 4.0, (-1.8, -0.3, 1.0)),
    ):
        light_data = bpy.data.lights.new(name, type="AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = Vector(center) + Vector(offset) * span
        light.rotation_euler = (Vector(center) - light.location).to_track_quat("-Z", "Y").to_euler()
    destination.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    pixels = load_render_pixels(destination, 700)
    luminance = pixels[:, :, :3].mean(axis=2)
    if int((luminance > 0.03).sum()) < 3_000:
        raise RuntimeError(f"beauty render is blank or nearly blank: {destination}")


def export_glb(objects, destination):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )


def voxel_candidate(source, name, thickness, voxel_size):
    candidate = source.copy()
    candidate.data = source.data.copy()
    candidate.name = name
    bpy.context.scene.collection.objects.link(candidate)
    bpy.context.view_layer.objects.active = candidate
    candidate.select_set(True)
    solidify = candidate.modifiers.new("measured-solidification", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = 0.0
    solidify.use_even_offset = True
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    candidate.data.remesh_voxel_size = voxel_size
    candidate.data.remesh_voxel_adaptivity = 0.0
    candidate.data.use_remesh_fix_poles = True
    candidate.data.use_remesh_preserve_volume = True
    bpy.ops.object.voxel_remesh()
    candidate.select_set(False)
    if len(candidate.data.polygons) < 100:
        raise RuntimeError(f"voxel remesh collapsed candidate {name}")
    return candidate


def create_static_groom(shell, config):
    vertices = np.asarray([vertex.co[:] for vertex in shell.data.vertices], dtype=np.float64)
    shell.data.calc_loop_triangles()
    triangles = np.asarray([triangle.vertices[:] for triangle in shell.data.loop_triangles], dtype=np.int64)
    points = vertices[triangles]
    cross = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0])
    double_area = np.linalg.norm(cross, axis=1)
    valid = double_area > 1e-12
    triangles = triangles[valid]
    points = points[valid]
    cross = cross[valid]
    double_area = double_area[valid]
    probabilities = double_area / double_area.sum()
    rng = np.random.default_rng(int(config["seed"]))
    chosen = rng.choice(len(triangles), size=int(config["strandCount"]), p=probabilities)
    first = rng.random(len(chosen))
    second = rng.random(len(chosen))
    reflected = first + second > 1.0
    first[reflected] = 1.0 - first[reflected]
    second[reflected] = 1.0 - second[reflected]
    bases = points[chosen, 0] + first[:, None] * (points[chosen, 1] - points[chosen, 0]) + second[:, None] * (points[chosen, 2] - points[chosen, 0])
    normals = cross[chosen] / double_area[chosen, None]
    _, _, extents = bounds(shell)
    diagonal = float(np.linalg.norm(extents))
    length = diagonal * float(config["strandLengthFractionOfDiagonal"])
    width = diagonal * float(config["strandWidthFractionOfDiagonal"])
    all_vertices = []
    all_faces = []
    for base, normal in zip(bases, normals):
        reference = np.array([0.0, 0.0, 1.0])
        if abs(float(np.dot(reference, normal))) > 0.92:
            reference = np.array([0.0, 1.0, 0.0])
        tangent = np.cross(normal, reference)
        tangent /= np.linalg.norm(tangent)
        bitangent = np.cross(normal, tangent)
        tip = base + normal * length
        offset = len(all_vertices)
        all_vertices.extend(
            [
                base - tangent * width,
                base + tangent * width,
                tip + tangent * width * 0.15,
                tip - tangent * width * 0.15,
                base - bitangent * width,
                base + bitangent * width,
                tip + bitangent * width * 0.15,
                tip - bitangent * width * 0.15,
            ]
        )
        all_faces.extend(
            [
                (offset, offset + 1, offset + 2),
                (offset, offset + 2, offset + 3),
                (offset + 4, offset + 5, offset + 6),
                (offset + 4, offset + 6, offset + 7),
            ]
        )
    return create_mesh_object(
        "static-replacement-groom",
        np.asarray(all_vertices, dtype=np.float64),
        np.asarray(all_faces, dtype=np.int64),
    )


def run(args):
    global LAST_EVIDENCE
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    failure_path = output_root / "failure.json"
    failure_path.unlink(missing_ok=True)
    (output_root / "meshes" / "chosen-carrier-with-static-groom.glb").unlink(missing_ok=True)
    (output_root / "views" / "chosen-carrier-with-static-groom.png").unlink(missing_ok=True)
    campaign = json.loads(args.campaign.read_text())
    for record in (campaign["sourcePlate"], campaign["sourceCast"]):
        verify_source(REPO / record["path"], record["sha256"])
    admitted = campaign["admittedSelection"]
    for path_key, hash_key in (
        ("arraysPath", "arraysSha256"),
        ("atlasResultPath", "atlasResultSha256"),
        ("visualAdmissionPath", "visualAdmissionSha256"),
    ):
        verify_source(REPO / admitted[path_key], admitted[hash_key])
    selection = load_admitted_selection(REPO, campaign)
    LAST_EVIDENCE = {
        "phase": "admitted-selection-authenticated",
        "sourceCastSha256": campaign["sourceCast"]["sha256"],
        "selectedFaceCount": int(selection.sum()),
    }

    imported = imported_target(REPO / campaign["sourceCast"]["path"])
    world_vertices, triangles = world_geometry(imported)
    if len(triangles) != len(selection):
        raise RuntimeError("authenticated cast and admitted selection cardinalities differ")
    selected_vertices, selected_triangles = compact_selected_geometry(world_vertices, triangles, selection)
    selected_obj = create_mesh_object("admitted-malformed-coat-selection", selected_vertices, selected_triangles)
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj != selected_obj:
            bpy.data.objects.remove(obj, do_unlink=True)
    minimum, maximum, source_extents = bounds(selected_obj)
    center = (minimum + maximum) * 0.5
    diagonal = float(np.linalg.norm(source_extents))
    span = float(source_extents.max())
    export_glb([selected_obj], output_root / "meshes" / "admitted-selection.glb")
    LAST_EVIDENCE = {
        **LAST_EVIDENCE,
        "phase": "selected-geometry-reconstructed",
        "selectedVertexCount": int(len(selected_obj.data.vertices)),
        "selectedTriangleCount": int(len(selected_obj.data.polygons)),
        "sourceBounds": source_extents.tolist(),
    }

    view_directions = {
        "x": (1.0, 0.0, 0.0),
        "y": (0.0, 1.0, 0.0),
        "z": (0.0, 0.0, 1.0),
    }
    source_masks = {
        name: render_mask(
            selected_obj,
            output_root / "diagnostics" / f"source-mask-{name}.png",
            direction,
            center,
            span,
        )
        for name, direction in view_directions.items()
    }
    render_beauty(
        [selected_obj],
        output_root / "views" / "admitted-selection.png",
        center,
        span,
        [make_material("selection-teal", (0.018, 0.42, 0.38, 1.0))],
    )

    sweep = campaign["candidateSweep"]
    thickness = diagonal * float(sweep["solidifyThicknessFractionOfDiagonal"])
    candidates = []
    objects = {}
    for fraction in sweep["voxelSizeFractionsOfDiagonal"]:
        name = f"voxel-{fraction:.3f}d"
        candidate = voxel_candidate(selected_obj, name, thickness, diagonal * float(fraction))
        objects[name] = candidate
        _, _, candidate_extents = bounds(candidate)
        masks = {
            view_name: render_mask(
                candidate,
                output_root / "diagnostics" / f"{name}-mask-{view_name}.png",
                direction,
                center,
                span,
            )
            for view_name, direction in view_directions.items()
        }
        ious = {view_name: silhouette_iou(source_masks[view_name], masks[view_name]) for view_name in masks}
        record = evaluate_candidate(
            name=name,
            face_counts=component_face_counts(candidate.data),
            source_bounds=source_extents,
            candidate_bounds=candidate_extents,
            silhouette_ious=ious,
            volume=mesh_volume(candidate.data),
            constraints=sweep,
        )
        record.update(
            {
                "voxelSizeFractionOfDiagonal": float(fraction),
                "voxelSize": diagonal * float(fraction),
                "vertexCount": int(len(candidate.data.vertices)),
                "faceCount": int(len(candidate.data.polygons)),
                "meshPath": f"meshes/{name}.glb",
                "viewPath": f"views/{name}.png",
            }
        )
        export_glb([candidate], output_root / record["meshPath"])
        render_beauty(
            [candidate],
            output_root / record["viewPath"],
            center,
            span,
            [make_material(f"{name}-clay", (0.58, 0.55, 0.48, 1.0))],
        )
        candidates.append(record)
        LAST_EVIDENCE = {
            **LAST_EVIDENCE,
            "phase": "candidate-measured",
            "candidate": name,
            "admissible": record["admissible"],
        }

    metric_nominee = choose_candidate(candidates)
    result = {
        "schema": "kaminos.mlx-malformed-coat-carrier-recovery-result.v0",
        "runId": args.run_id,
        "effectiveRoute": {
            "reconstruction": "Blender 5.1.2 CPU solidify plus voxel remesh",
            "groom": "deferred until explicit visual selection",
            "gpuInference": False,
        },
        "sourceCastSha256": campaign["sourceCast"]["sha256"],
        "atlasResultSha256": admitted["atlasResultSha256"],
        "visualAdmissionSha256": admitted["visualAdmissionSha256"],
        "selection": {
            "metric": admitted["metric"],
            "operator": admitted["operator"],
            "threshold": admitted["threshold"],
            "selectedFaceCount": int(selection.sum()),
            "totalFaceCount": int(len(selection)),
        },
        "sourceBounds": source_extents.tolist(),
        "sourceDiagonal": diagonal,
        "candidates": candidates,
        "metricNominee": metric_nominee["name"],
        "visualAdmission": "pending-agent-inspection",
        "claimCeiling": campaign["claimCeiling"],
    }
    (output_root / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    LAST_EVIDENCE = {
        **LAST_EVIDENCE,
        "phase": "result-written",
        "metricNominee": metric_nominee["name"],
    }


def main():
    args = parse_args()
    try:
        run(args)
    except Exception as error:
        write_failure_report(
            args.output_root.resolve() / "failure.json",
            phase=LAST_EVIDENCE.get("phase", "unknown"),
            error=f"{type(error).__name__}: {error}",
            last_trustworthy_evidence=LAST_EVIDENCE,
        )
        raise


if __name__ == "__main__":
    main()
