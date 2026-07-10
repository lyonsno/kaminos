#!/usr/bin/env python3
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def fail(message: str) -> None:
    print(f"blender_glb_witness: {message}", file=sys.stderr)
    raise SystemExit(2)


def look_at(obj, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def scene_bbox(objects):
    mins = Vector((float("inf"), float("inf"), float("inf")))
    maxs = Vector((float("-inf"), float("-inf"), float("-inf")))
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, world.x)
            mins.y = min(mins.y, world.y)
            mins.z = min(mins.z, world.z)
            maxs.x = max(maxs.x, world.x)
            maxs.y = max(maxs.y, world.y)
            maxs.z = max(maxs.z, world.z)
    if not found:
        fail("import produced no mesh objects")
    return mins, maxs


def main(argv):
    if len(argv) < 2:
        fail("usage: blender --background --python blender_glb_witness.py -- input.glb output.png [yaw] [pitch]")
    glb_path = Path(argv[0]).resolve()
    out_path = Path(argv[1]).resolve()
    yaw = float(argv[2]) if len(argv) > 2 else 0.0
    pitch = float(argv[3]) if len(argv) > 3 else 0.2
    if not glb_path.exists():
        fail(f"missing input {glb_path}")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    imported = list(bpy.context.scene.objects)

    root = bpy.data.objects.new("witness_root", None)
    bpy.context.collection.objects.link(root)
    for obj in imported:
        if obj.parent is None:
            obj.parent = root

    mins, maxs = scene_bbox(imported)
    center = (mins + maxs) * 0.5
    diagonal = max((maxs - mins).length, 1e-6)
    for obj in imported:
        if obj.parent == root:
            obj.location -= center
    root.scale = (2.25 / diagonal, 2.25 / diagonal, 2.25 / diagonal)

    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
    bpy.context.scene.eevee.taa_render_samples = 64
    bpy.context.scene.world = bpy.data.worlds.new("witness_world")
    bpy.context.scene.world.color = (0.045, 0.045, 0.045)
    bpy.context.scene.render.resolution_x = 1100
    bpy.context.scene.render.resolution_y = 900
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.view_settings.exposure = 0.25
    bpy.context.scene.view_settings.gamma = 1.0

    camera = bpy.data.objects.new("witness_camera", bpy.data.cameras.new("witness_camera"))
    bpy.context.collection.objects.link(camera)
    radius = 4.2
    camera.location = Vector((
        math.sin(yaw) * radius * math.cos(pitch),
        -math.cos(yaw) * radius * math.cos(pitch),
        radius * math.sin(pitch) + 0.25,
    ))
    camera.data.lens = 60
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.85
    look_at(camera, Vector((0, 0, 0)))
    bpy.context.scene.camera = camera

    key_data = bpy.data.lights.new("key", "AREA")
    key = bpy.data.objects.new("key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = Vector((2.2, -3.0, 4.0))
    key.data.energy = 520
    key.data.size = 4.0
    look_at(key, Vector((0, 0, 0)))

    fill_data = bpy.data.lights.new("fill", "AREA")
    fill = bpy.data.objects.new("fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = Vector((-3.0, 2.0, 2.5))
    fill.data.energy = 120
    fill.data.size = 5.0
    look_at(fill, Vector((0, 0, 0)))

    bpy.context.scene.render.filepath = str(out_path)
    bpy.ops.render.render(write_still=True)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv)
