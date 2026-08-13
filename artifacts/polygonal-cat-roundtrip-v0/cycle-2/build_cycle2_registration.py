#!/usr/bin/env python3
"""Register cycle-2 Trellis to cycle-1 with one global similarity transform."""

from __future__ import annotations

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


SCHEMA = "kaminos.polygonal-cat-cycle2.registration.v0"
FAILURE_SCHEMA = "kaminos.polygonal-cat-cycle2.registration-failure.v0"
POSE_FIT_SAMPLE_TARGET = 24000
ICP_ITERATIONS = 12
ICP_INLIER_QUANTILE = 0.82


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixed-glb", type=Path, required=True)
    parser.add_argument("--fixed-sha256", required=True)
    parser.add_argument("--moving-glb", type=Path, required=True)
    parser.add_argument("--moving-sha256", required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def evaluated_world_mesh(obj: bpy.types.Object) -> tuple[np.ndarray, list[tuple[int, ...]]]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    vertices = np.array(
        [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices],
        dtype=np.float64,
    )
    faces = [tuple(poly.vertices) for poly in mesh.polygons]
    evaluated.to_mesh_clear()
    return vertices, faces


def import_combined(path: Path) -> tuple[np.ndarray, list[tuple[int, ...]], int]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not objects:
        raise RuntimeError(f"GLB contains no mesh objects: {path}")
    vertices: list[np.ndarray] = []
    faces: list[tuple[int, ...]] = []
    offset = 0
    for obj in objects:
        object_vertices, object_faces = evaluated_world_mesh(obj)
        vertices.append(object_vertices)
        faces.extend(tuple(index + offset for index in face) for face in object_faces)
        offset += len(object_vertices)
    return np.concatenate(vertices), faces, len(objects)


def principal_axes(points: np.ndarray) -> np.ndarray:
    centered = points - points.mean(axis=0)
    values, vectors = np.linalg.eigh(centered.T @ centered)
    return vectors[:, np.argsort(values)[::-1]]


def deterministic_pose_sample(points: np.ndarray) -> np.ndarray:
    if len(points) <= POSE_FIT_SAMPLE_TARGET:
        return points.copy()
    indices = np.linspace(0, len(points) - 1, POSE_FIT_SAMPLE_TARGET, dtype=np.int64)
    return points[indices]


def nearest_points(points: np.ndarray, tree: KDTree) -> tuple[np.ndarray, np.ndarray]:
    matches = np.empty_like(points)
    distances = np.empty(len(points), dtype=np.float64)
    for index, point in enumerate(points):
        coordinate, _, distance = tree.find(Vector(point))
        matches[index] = coordinate
        distances[index] = distance
    return matches, distances


def build_tree(points: np.ndarray) -> KDTree:
    tree = KDTree(len(points))
    for index, point in enumerate(points):
        tree.insert(Vector(point), index)
    tree.balance()
    return tree


def similarity_delta(source: np.ndarray, target: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    source_center = source.mean(axis=0)
    target_center = target.mean(axis=0)
    source_zero = source - source_center
    target_zero = target - target_center
    covariance = target_zero.T @ source_zero / len(source)
    u, singular, vt = np.linalg.svd(covariance)
    correction = np.eye(3)
    correction[-1, -1] = np.sign(np.linalg.det(u @ vt))
    rotation = u @ correction @ vt
    variance = float(np.mean(np.sum(source_zero * source_zero, axis=1)))
    scale = float(np.sum(singular * np.diag(correction)) / variance)
    translation = target_center - scale * source_center @ rotation.T
    return scale, rotation, translation


def fit_global_similarity(moving: np.ndarray, fixed: np.ndarray) -> dict:
    moving_fit = deterministic_pose_sample(moving)
    fixed_fit = deterministic_pose_sample(fixed)
    fixed_tree = build_tree(fixed_fit)
    moving_center = moving_fit.mean(axis=0)
    fixed_center = fixed_fit.mean(axis=0)
    moving_axes = principal_axes(moving_fit)
    fixed_axes = principal_axes(fixed_fit)
    moving_radius = float(np.sqrt(np.mean(np.sum((moving_fit - moving_center) ** 2, axis=1))))
    fixed_radius = float(np.sqrt(np.mean(np.sum((fixed_fit - fixed_center) ** 2, axis=1))))
    initial_scale = fixed_radius / moving_radius
    candidates = []

    for signs in ((1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)):
        rotation = fixed_axes @ np.diag(signs) @ moving_axes.T
        if np.linalg.det(rotation) < 0:
            continue
        scale = initial_scale
        translation = fixed_center - scale * moving_center @ rotation.T
        transformed = scale * moving_fit @ rotation.T + translation

        for _ in range(ICP_ITERATIONS):
            matches, distances = nearest_points(transformed, fixed_tree)
            admitted = distances <= np.quantile(distances, ICP_INLIER_QUANTILE)
            delta_scale, delta_rotation, delta_translation = similarity_delta(
                transformed[admitted], matches[admitted]
            )
            transformed = delta_scale * transformed @ delta_rotation.T + delta_translation
            scale = delta_scale * scale
            rotation = delta_rotation @ rotation
            translation = delta_scale * translation @ delta_rotation.T + delta_translation

        _, distances = nearest_points(transformed, fixed_tree)
        score = float(np.median(distances) + 0.25 * np.quantile(distances, 0.9))
        candidates.append((score, scale, rotation, translation))

    if not candidates:
        raise RuntimeError("no orientation candidate survived registration")
    score, scale, rotation, translation = min(candidates, key=lambda row: row[0])
    return {
        "score": score,
        "scale": float(scale),
        "rotation": rotation,
        "translation": translation,
        "movingPoseFitSamples": len(moving_fit),
        "fixedPoseFitSamples": len(fixed_fit),
    }


def transform(points: np.ndarray, fit: dict) -> np.ndarray:
    return fit["scale"] * points @ fit["rotation"].T + fit["translation"]


def distance_summary(query: np.ndarray, target: np.ndarray) -> dict:
    tree = build_tree(target)
    _, distances = nearest_points(query, tree)
    return {
        "sampleCount": len(query),
        "medianDistance": float(np.median(distances)),
        "p90Distance": float(np.quantile(distances, 0.9)),
        "p95Distance": float(np.quantile(distances, 0.95)),
    }


def mesh_object(name: str, vertices: np.ndarray, faces: list[tuple[int, ...]]) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(vertices.tolist(), [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def material(name: str, color: tuple[float, float, float], alpha: float = 1.0):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, alpha)
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = 0.58
    principled.inputs["Alpha"].default_value = alpha
    if alpha < 1.0 and hasattr(value, "surface_render_method"):
        value.surface_render_method = "DITHERED"
    return value


def aim_camera(camera: bpy.types.Object, point: np.ndarray) -> None:
    camera.rotation_euler = (Vector(point) - camera.location).to_track_quat("-Z", "Y").to_euler()


def scene_setup() -> tuple[bpy.types.Scene, bpy.types.Object]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 820
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("cycle-2-registration-world")
    scene.world.color = (0.010, 0.013, 0.014)

    camera_data = bpy.data.cameras.new("cycle-2-registration-camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("cycle-2-registration-camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    for name, location, energy, size in (
        ("key", (4.0, -4.0, 6.0), 850.0, 4.0),
        ("fill", (-4.0, 2.0, 3.0), 520.0, 3.0),
        ("rim", (1.0, 5.0, 5.0), 700.0, 3.0),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        light.location = location
        scene.collection.objects.link(light)
    return scene, camera


def render_views(
    root: Path,
    witness_class: str,
    objects: list[bpy.types.Object],
    bounds_points: np.ndarray,
    *,
    remove_after: bool,
) -> list[str]:
    scene = bpy.context.scene
    camera = scene.camera
    center = bounds_points.mean(axis=0)
    span = float(max(np.ptp(bounds_points, axis=0)))
    camera.data.ortho_scale = span * 1.20
    output_dir = root / "registration" / witness_class
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for azimuth in (0, 45, 135):
        radians = math.radians(azimuth)
        elevation = math.radians(10)
        camera.location = Vector(center) + Vector(
            (
                math.cos(radians) * span * 2.6,
                math.sin(radians) * span * 2.6,
                math.sin(elevation) * span * 2.6,
            )
        )
        aim_camera(camera, center)
        relative = Path("registration") / witness_class / f"az{azimuth:03d}-el10.png"
        absolute = root / relative
        absolute.unlink(missing_ok=True)
        scene.render.filepath = str(absolute)
        bpy.ops.render.render(write_still=True)
        if not absolute.is_file() or absolute.stat().st_size < 4096:
            raise RuntimeError(f"registration witness is absent or implausibly small: {absolute}")
        paths.append(relative.as_posix())
    if remove_after:
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    return paths


def run(args: argparse.Namespace) -> None:
    root = args.artifact_root.resolve()
    fixed_path = args.fixed_glb.resolve()
    moving_path = args.moving_glb.resolve()
    if sha256(fixed_path) != args.fixed_sha256:
        raise RuntimeError("cycle-1 fixed cast hash mismatch")
    if sha256(moving_path) != args.moving_sha256:
        raise RuntimeError("cycle-2 moving cast hash mismatch")

    fixed_vertices, fixed_faces, fixed_meshes = import_combined(fixed_path)
    moving_vertices, moving_faces, moving_meshes = import_combined(moving_path)
    fit = fit_global_similarity(moving_vertices, fixed_vertices)
    registered_vertices = transform(moving_vertices, fit)

    fixed_span = float(np.linalg.norm(np.ptp(fixed_vertices, axis=0)))
    moving_to_fixed = distance_summary(registered_vertices, fixed_vertices)
    fixed_to_moving = distance_summary(fixed_vertices, registered_vertices)
    for summary in (moving_to_fixed, fixed_to_moving):
        summary["normalizedMedianDistance"] = summary["medianDistance"] / fixed_span
        summary["normalizedP90Distance"] = summary["p90Distance"] / fixed_span
        summary["normalizedP95Distance"] = summary["p95Distance"] / fixed_span

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene_setup()
    fixed_color = material("cycle-1-cyan", (0.04, 0.63, 0.72))
    moving_color = material("cycle-2-orange", (0.96, 0.31, 0.07))
    fixed_alpha = material("cycle-1-cyan-alpha", (0.04, 0.63, 0.72), 0.58)
    moving_alpha = material("cycle-2-orange-alpha", (0.96, 0.31, 0.07), 0.58)

    fixed_center = fixed_vertices.mean(axis=0)
    moving_center = moving_vertices.mean(axis=0)
    layout_gap = max(np.ptp(fixed_vertices, axis=0).max(), np.ptp(moving_vertices, axis=0).max()) * 1.25
    # The orbit's zero-degree camera looks along X, so Y separation remains
    # visibly side by side rather than collapsing along the view axis.
    raw_fixed_vertices = fixed_vertices - fixed_center + np.array((0.0, -layout_gap * 0.55, 0.0))
    raw_moving_vertices = moving_vertices - moving_center + np.array((0.0, layout_gap * 0.55, 0.0))
    raw_fixed = mesh_object("cycle-1-raw", raw_fixed_vertices, fixed_faces)
    raw_moving = mesh_object("cycle-2-raw", raw_moving_vertices, moving_faces)
    raw_fixed.data.materials.append(fixed_color)
    raw_moving.data.materials.append(moving_color)
    raw_bounds = np.concatenate((raw_fixed_vertices, raw_moving_vertices))
    raw_paths = render_views(
        root,
        "raw-side-by-side",
        [raw_fixed, raw_moving],
        raw_bounds,
        remove_after=True,
    )

    registered_fixed = mesh_object("cycle-1-fixed", fixed_vertices, fixed_faces)
    registered_moving = mesh_object("cycle-2-registered", registered_vertices, moving_faces)
    registered_fixed.data.materials.append(fixed_alpha)
    registered_moving.data.materials.append(moving_alpha)
    overlay_bounds = np.concatenate((fixed_vertices, registered_vertices))
    overlay_paths = render_views(
        root,
        "registered-overlay",
        [registered_fixed, registered_moving],
        overlay_bounds,
        remove_after=False,
    )

    matrix = np.eye(4)
    matrix[:3, :3] = fit["scale"] * fit["rotation"]
    matrix[:3, 3] = fit["translation"]
    result = {
        "schema": SCHEMA,
        "fixed": {
            "role": "cycle-1-trellis",
            "path": str(fixed_path),
            "sha256": args.fixed_sha256,
            "meshCount": fixed_meshes,
            "vertexCount": len(fixed_vertices),
        },
        "moving": {
            "role": "cycle-2-trellis",
            "path": str(moving_path),
            "sha256": args.moving_sha256,
            "meshCount": moving_meshes,
            "vertexCount": len(moving_vertices),
        },
        "method": {
            "transformClass": "global_similarity",
            "uniformScaleOnly": True,
            "allowsLocalDeformation": False,
            "allowsAnisotropicScale": False,
            "initialization": "principal-axis right-handed sign candidates",
            "refinement": "trimmed bidirectional-nearest-surface ICP pose fit",
            "poseFitSamplePolicy": {
                "kind": "deterministic evenly spaced vertex indices",
                "target": POSE_FIT_SAMPLE_TARGET,
                "reason": (
                    "Cycle-1 contains 152,205 vertices; four candidates times twelve full "
                    "Python KDTree sweeps would add 7.3 million pose queries. Sampling is "
                    "used only to estimate the seven global parameters; every vertex is "
                    "retained in witnesses and final bidirectional residuals."
                ),
            },
            "icpIterations": ICP_ITERATIONS,
            "inlierQuantile": ICP_INLIER_QUANTILE,
            "rawWitnessLayout": "translation-only centering and side-by-side display; no rescale",
        },
        "fit": {
            "uniformScale": fit["scale"],
            "matrix": matrix.tolist(),
            "poseScore": fit["score"],
            "movingPoseFitSamples": fit["movingPoseFitSamples"],
            "fixedPoseFitSamples": fit["fixedPoseFitSamples"],
            "movingToFixed": moving_to_fixed,
            "fixedToMoving": fixed_to_moving,
            "normalizedMedianDistance": moving_to_fixed["normalizedMedianDistance"],
            "normalizedP90Distance": moving_to_fixed["normalizedP90Distance"],
        },
        "witnesses": {
            "raw-side-by-side": raw_paths,
            "registered-overlay": overlay_paths,
            "legend": {
                "cyan": "cycle-1 Trellis",
                "orange": "cycle-2 Trellis",
            },
        },
        "claimCeiling": (
            "Diagnostic global pose/scale registration and complete rendered geometry only; "
            "surface-distance residuals are not anatomical correspondence or topology evidence."
        ),
    }
    atomic_json(args.output, result)
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output))


def main() -> int:
    args = arguments()
    failure = args.output.with_name("registration-failure.json")
    try:
        run(args)
        failure.unlink(missing_ok=True)
        return 0
    except Exception as error:
        atomic_json(
            failure,
            {
                "schema": FAILURE_SCHEMA,
                "phase": "global-similarity-registration",
                "error": repr(error),
                "traceback": traceback.format_exc(),
                "lastTrustworthyEvidence": (
                    "Both requested source hashes are checked before import; no complete "
                    "registration witness is admitted."
                ),
            },
        )
        raise


if __name__ == "__main__":
    raise SystemExit(main())
