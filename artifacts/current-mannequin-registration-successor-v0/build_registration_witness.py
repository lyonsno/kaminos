#!/usr/bin/env python3
"""Build a global-only authored-envelope/Trellis registration witness in Blender."""

import argparse
import hashlib
import json
import math
import sys
import traceback
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree


EXPECTED_SOURCE_SHA256 = "ba04387f9e20c47a297450b0cc93747ae2f5918d5ab48a39820273c871b5ef48"
CAST_NAMES = ("mannequin-seed80301", "mannequin-seed80413", "fur-seed80413")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--source-object", default="Cube.056")
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluated_world_mesh(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    vertices = np.array([evaluated.matrix_world @ vertex.co for vertex in mesh.vertices], dtype=np.float64)
    faces = [tuple(poly.vertices) for poly in mesh.polygons]
    evaluated.to_mesh_clear()
    return vertices, faces


def principal_axes(points):
    centered = points - points.mean(axis=0)
    values, vectors = np.linalg.eigh(centered.T @ centered)
    return vectors[:, np.argsort(values)[::-1]]


def rigid_delta(source, target):
    source_center = source.mean(axis=0)
    target_center = target.mean(axis=0)
    source_zero = source - source_center
    target_zero = target - target_center
    covariance = target_zero.T @ source_zero / len(source)
    u, _, vt = np.linalg.svd(covariance)
    correction = np.eye(3)
    correction[-1, -1] = np.sign(np.linalg.det(u @ vt))
    rotation = u @ correction @ vt
    translation = target_center - source_center @ rotation.T
    return rotation, translation


def nearest_points(points, tree):
    matches = np.empty_like(points)
    distances = np.empty(len(points), dtype=np.float64)
    for index, point in enumerate(points):
        coordinate, _, distance = tree.find(Vector(point))
        matches[index] = coordinate
        distances[index] = distance
    return matches, distances


def fit_global_similarity(source, target):
    tree = KDTree(len(target))
    for index, point in enumerate(target):
        tree.insert(Vector(point), index)
    tree.balance()

    source_center = source.mean(axis=0)
    target_center = target.mean(axis=0)
    source_axes = principal_axes(source)
    target_axes = principal_axes(target)
    source_extent = np.ptp((source - source_center) @ source_axes, axis=0)
    target_extent = np.ptp((target - target_center) @ target_axes, axis=0)
    scale = float(target_extent[0] / source_extent[0])

    candidates = []
    for signs in ((1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)):
        sign_matrix = np.diag(signs)
        rotation = target_axes @ sign_matrix @ source_axes.T
        if np.linalg.det(rotation) < 0:
            continue
        translation = target_center - scale * source_center @ rotation.T
        transformed = scale * source @ rotation.T + translation

        for _ in range(30):
            matches, distances = nearest_points(transformed, tree)
            cutoff = np.quantile(distances, 0.82)
            admitted = distances <= cutoff
            delta_rotation, delta_translation = rigid_delta(transformed[admitted], matches[admitted])
            transformed = transformed @ delta_rotation.T + delta_translation
            rotation = delta_rotation @ rotation
            translation = translation @ delta_rotation.T + delta_translation

        _, distances = nearest_points(transformed, tree)
        score = float(np.median(distances) + 0.25 * np.quantile(distances, 0.9))
        candidates.append((score, rotation, translation, distances))

    score, rotation, translation, distances = min(candidates, key=lambda candidate: candidate[0])
    target_extent_world = float(np.linalg.norm(np.ptp(target, axis=0)))
    return {
        "scale": scale,
        "rotation": rotation,
        "translation": translation,
        "medianDistance": float(np.median(distances)),
        "p90Distance": float(np.quantile(distances, 0.9)),
        "normalizedMedianDistance": float(np.median(distances) / target_extent_world),
        "normalizedP90Distance": float(np.quantile(distances, 0.9) / target_extent_world),
        "score": score,
    }


def transform_points(points, fit):
    return fit["scale"] * points @ fit["rotation"].T + fit["translation"]


def make_mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(vertices.tolist(), [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def material(name, color, metallic=0.0, roughness=0.55):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    return value


def combined_source_geometry(objects, fit):
    vertices = []
    faces = []
    for obj in objects:
        object_vertices, object_faces = evaluated_world_mesh(obj)
        transformed = transform_points(object_vertices, fit)
        offset = len(vertices)
        vertices.extend(transformed)
        faces.extend(tuple(index + offset for index in face) for face in object_faces)
    return np.asarray(vertices), faces


def aim_camera(camera, point):
    camera.rotation_euler = (Vector(point) - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_views(root, cast_name, target, envelope, skeleton, target_points):
    target_mat = material("cast", (0.10, 0.30, 0.34), metallic=0.05, roughness=0.48)
    skeleton_mat = material("skeleton", (1.0, 0.23, 0.04), metallic=0.0, roughness=0.4)
    envelope_mat = material("authored-envelope", (0.18, 0.90, 0.95), metallic=0.0, roughness=0.35)
    target.data.materials.clear()
    target.data.materials.append(target_mat)
    skeleton.data.materials.append(skeleton_mat)
    envelope.data.materials.append(envelope_mat)

    target_wire = target.modifiers.new("cast-wire", "WIREFRAME")
    target_wire.thickness = max(np.ptp(target_points, axis=0)) * 0.0015
    target_wire.use_replace = True
    envelope_wire = envelope.modifiers.new("envelope-wire", "WIREFRAME")
    envelope_wire.thickness = max(np.ptp(target_points, axis=0)) * 0.0025
    envelope_wire.use_replace = True

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("registration-world")
    scene.world.color = (0.012, 0.015, 0.017)

    camera_data = bpy.data.cameras.new("registration-camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("registration-camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    center = target_points.mean(axis=0)
    span = float(max(np.ptp(target_points, axis=0)))
    camera_data.ortho_scale = span * 1.28
    elevation = math.radians(10)
    view_dir = root / "registration" / cast_name
    view_dir.mkdir(parents=True, exist_ok=True)
    view_paths = []
    for azimuth in (0, 45, 135):
        radians = math.radians(azimuth)
        camera.location = center + Vector(
            (
                math.cos(radians) * span * 2.4,
                math.sin(radians) * span * 2.4,
                math.sin(elevation) * span * 2.4,
            )
        )
        aim_camera(camera, center)
        relative = Path("registration") / cast_name / f"az{azimuth:03d}-el10.png"
        scene.render.filepath = str(root / relative)
        bpy.ops.render.render(write_still=True)
        view_paths.append(str(relative))
    return view_paths


def source_objects(source, source_points):
    low = source_points.min(axis=0) - 2.0
    high = source_points.max(axis=0) + 2.0
    rejected_tokens = ("Muscle", "Paint", "Surface")
    selected = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj == source or any(token in obj.name for token in rejected_tokens):
            continue
        location = np.asarray(obj.matrix_world.translation)
        if np.all(location >= low) and np.all(location <= high) and len(obj.data.vertices) > 0:
            selected.append(obj)
    return selected


def run(args):
    root = args.artifact_root.resolve()
    source_blend = args.source_blend.resolve()
    if sha256(source_blend) != EXPECTED_SOURCE_SHA256:
        raise RuntimeError("source blend hash does not match the assay source")

    bpy.ops.wm.open_mainfile(filepath=str(source_blend))
    source = bpy.data.objects.get(args.source_object)
    if source is None or source.type != "MESH":
        raise RuntimeError(f"missing mesh source object {args.source_object}")
    source_points, source_faces = evaluated_world_mesh(source)
    skeleton_sources = source_objects(source, source_points)

    result = {
        "schema": "kaminos.registration-witness.v0",
        "source": {
            "blend": str(source_blend),
            "sha256": EXPECTED_SOURCE_SHA256,
            "object": args.source_object,
            "sampleCount": len(source_points),
            "skeletonObjectCount": len(skeleton_sources),
        },
        "method": {
            "transformClass": "global_similarity",
            "allowsLocalDeformation": False,
            "allowsAnatomicalLandmarkEditing": False,
            "fitSurface": "authored envelope to reconstructed cast",
            "claimCeiling": "Diagnostic registration pressure only; automated fit is not operator anatomical admission.",
        },
        "casts": [],
    }

    source_payload = []
    for obj in skeleton_sources:
        source_payload.append((obj.name, *evaluated_world_mesh(obj)))

    for cast_name in CAST_NAMES:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        glb = root / "trellis" / cast_name / "output.glb"
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(glb))
        imported = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
        target = max(imported, key=lambda obj: len(obj.data.vertices))
        target_points, _ = evaluated_world_mesh(target)
        fit = fit_global_similarity(source_points, target_points)

        envelope_points = transform_points(source_points, fit)
        envelope = make_mesh_object("authored-envelope", envelope_points, source_faces)
        skeleton_objects = []
        for name, vertices, faces in source_payload:
            skeleton_objects.append(make_mesh_object(name, transform_points(vertices, fit), faces))
        skeleton_vertices = []
        skeleton_faces = []
        for obj in skeleton_objects:
            vertices, faces = evaluated_world_mesh(obj)
            offset = len(skeleton_vertices)
            skeleton_vertices.extend(vertices)
            skeleton_faces.extend(tuple(index + offset for index in face) for face in faces)
            bpy.data.objects.remove(obj, do_unlink=True)
        skeleton = make_mesh_object("authored-skeleton", np.asarray(skeleton_vertices), skeleton_faces)

        views = render_views(root, cast_name, target, envelope, skeleton, target_points)
        matrix = np.eye(4)
        matrix[:3, :3] = fit["scale"] * fit["rotation"]
        matrix[:3, 3] = fit["translation"]
        result["casts"].append(
            {
                "name": cast_name,
                "glb": str(glb.relative_to(root)),
                "glbSha256": sha256(glb),
                "fit": {
                    "sampleCount": len(source_points),
                    "scale": fit["scale"],
                    "medianDistance": fit["medianDistance"],
                    "p90Distance": fit["p90Distance"],
                    "normalizedMedianDistance": fit["normalizedMedianDistance"],
                    "normalizedP90Distance": fit["normalizedP90Distance"],
                    "matrix": matrix.tolist(),
                },
                "views": views,
            }
        )

    args.output.write_text(json.dumps(result, indent=2) + "\n")


def main():
    args = parse_args()
    failure = args.output.with_name("registration-failure.json")
    try:
        run(args)
        failure.unlink(missing_ok=True)
    except Exception as exc:
        failure.write_text(
            json.dumps(
                {
                    "schema": "kaminos.registration-failure.v0",
                    "phase": "registration-witness",
                    "error": repr(exc),
                    "traceback": traceback.format_exc(),
                },
                indent=2,
            )
            + "\n"
        )
        raise


if __name__ == "__main__":
    main()
