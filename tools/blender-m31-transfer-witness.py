#!/usr/bin/env python3
"""Render locked neutral and +24-degree views from the exact M31 transfer receipt."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.58
    principled.inputs["Metallic"].default_value = 0.03
    return value


def create_pose_mesh(
    pose: dict[str, object],
    memberships: dict[str, object],
    materials: list[bpy.types.Material],
) -> bpy.types.Object:
    vertices = [record["position"] for record in pose["outputVertices"]]
    faces = [record["vertexIndices"] for record in pose["outputTriangles"]]
    mesh = bpy.data.meshes.new(f"M31 {pose['angleDegrees']} mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f"M31 {pose['angleDegrees']} degrees", mesh)
    bpy.context.collection.objects.link(obj)
    for value in materials:
        mesh.materials.append(value)
    role_indices = {
        source_id: material_index
        for material_index, role in enumerate(
            ("originAttachmentCap", "transitionBelly", "insertionAttachmentCap")
        )
        for source_id in memberships[role]["sourceTriangleIds"]
    }
    for polygon, triangle in zip(mesh.polygons, pose["outputTriangles"], strict=True):
        polygon.material_index = role_indices.get(triangle["sourceTriangleId"], 3)
        polygon.use_smooth = True
    return obj


def projected_scale(points: list[Vector], view_direction: Vector) -> tuple[Vector, float]:
    center = sum(points, Vector((0.0, 0.0, 0.0))) / len(points)
    forward = view_direction.normalized()
    world_up = Vector((0.0, 0.0, 1.0))
    if abs(forward.dot(world_up)) > 0.96:
        world_up = Vector((0.0, 1.0, 0.0))
    right = forward.cross(world_up).normalized()
    up = right.cross(forward).normalized()
    width = max((point - center).dot(right) for point in points) - min(
        (point - center).dot(right) for point in points
    )
    height = max((point - center).dot(up) for point in points) - min(
        (point - center).dot(up) for point in points
    )
    return center, max(width, height) * 1.18


def point_camera(camera: bpy.types.Object, center: Vector, view_direction: Vector) -> None:
    camera.location = center + view_direction.normalized() * 100.0
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 2:
        raise ValueError("expected transfer JSON and output directory")
    transfer_path = Path(argv[0]).expanduser().resolve()
    output_dir = Path(argv[1]).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    failure_path = output_dir / "witness.failure.json"
    transfer = json.loads(transfer_path.read_text(encoding="utf-8"))
    write_json(
        failure_path,
        {
            "schema": "kaminos.m31-transfer-visual-witness.v0",
            "status": "started",
            "failurePhase": "transfer-validation",
            "requestedTransfer": str(transfer_path),
            "effectiveTransfer": None,
            "primaryOutput": None,
        },
    )
    if transfer.get("status") != "M31_TRANSFER_COMPLETE":
        raise ValueError("visual witness requires a completed transfer")
    if transfer.get("producerEnvelope", {}).get("transfer_hash") is None:
        raise ValueError("visual witness requires the producer transfer identity")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    materials = [
        material("Origin cap", (0.08, 0.62, 0.78, 1.0)),
        material("Transition belly", (0.92, 0.39, 0.12, 1.0)),
        material("Insertion cap", (0.76, 0.18, 0.46, 1.0)),
        material("Boundary triangles", (0.58, 0.61, 0.65, 1.0)),
    ]
    objects = [
        create_pose_mesh(pose, transfer["semanticMemberships"], materials)
        for pose in transfer["poses"]
    ]
    points = [
        Vector(record["position"])
        for pose in transfer["poses"]
        for record in pose["outputVertices"]
    ]
    axis = Vector(transfer["manifest"]["targetTransforms"][1]["hinge"]["axisWorld"])
    view_directions = {
        "profile": axis,
        "three-quarter": (axis + Vector((0.34, -0.52, 0.72))).normalized(),
    }

    camera_data = bpy.data.cameras.new("Locked transfer camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Locked transfer camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    light_data = bpy.data.lights.new("Witness key", "AREA")
    light_data.energy = 1100
    light_data.shape = "DISK"
    light_data.size = 8.0
    light = bpy.data.objects.new("Witness key", light_data)
    bpy.context.collection.objects.link(light)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.018, 0.022, 0.029)
    scene.view_settings.look = "AgX - Medium High Contrast"

    outputs = []
    for view_name, view_direction in view_directions.items():
        center, scale = projected_scale(points, view_direction)
        camera_data.ortho_scale = scale
        point_camera(camera, center, view_direction)
        light.location = center + view_direction.normalized() * 25 + Vector((8, -8, 12))
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
        for obj, pose in zip(objects, transfer["poses"], strict=True):
            for candidate in objects:
                candidate.hide_render = candidate != obj
            filename = f"m31-{view_name}-{pose['angleDegrees']}deg.png"
            scene.render.filepath = str(output_dir / filename)
            bpy.ops.render.render(write_still=True)
            outputs.append(
                {
                    "view": view_name,
                    "angleDegrees": pose["angleDegrees"],
                    "path": filename,
                    "cameraType": "orthographic",
                    "cameraDirection": list(view_direction),
                    "orthographicScale": scale,
                }
            )

    witness = {
        "schema": "kaminos.m31-transfer-visual-witness.v0",
        "status": "complete",
        "requestedTransfer": str(transfer_path),
        "effectiveTransfer": str(transfer_path),
        "transferHash": transfer["producerEnvelope"]["transfer_hash"],
        "requestedRoute": "blender-eevee-locked-orthographic",
        "effectiveRoute": "blender-eevee-locked-orthographic",
        "fallbackUsed": False,
        "outputs": outputs,
        "failurePhase": None,
        "primaryOutput": outputs[0]["path"],
    }
    write_json(output_dir / "witness.json", witness)
    write_json(failure_path, {**witness, "primaryOutput": "witness.json"})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
        if len(argv) == 2:
            failure_path = Path(argv[1]).expanduser().resolve() / "witness.failure.json"
            prior = {}
            if failure_path.is_file():
                prior = json.loads(failure_path.read_text(encoding="utf-8"))
            write_json(
                failure_path,
                {
                    **prior,
                    "status": "failed",
                    "failurePhase": "blender-render",
                    "lastTrustworthyEvidence": prior.get(
                        "effectiveTransfer", "transfer receipt parsed before render failure"
                    ),
                    "error": str(error),
                    "primaryOutput": None,
                },
            )
        print(f"M31 transfer witness failed: {error}", file=sys.stderr)
        raise
