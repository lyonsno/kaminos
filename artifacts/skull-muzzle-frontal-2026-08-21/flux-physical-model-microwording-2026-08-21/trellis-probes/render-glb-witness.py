import argparse
import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Vector


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True)
parser.add_argument("--out-dir", required=True)
parser.add_argument("--manifest", required=True)
parser.add_argument("--failure", required=True)
parser.add_argument("--up-axis", default="z")
parser.add_argument("--exclude", default="")
parser.add_argument("--auto-up", action="store_true")
script_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
args = parser.parse_args(script_args)
os.makedirs(args.out_dir, exist_ok=True)
for stale_path in (args.manifest, args.failure):
    if os.path.exists(stale_path):
        os.remove(stale_path)

try:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.glb)

    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError("GLB imported without mesh objects")

    corners = [obj.matrix_world @ Vector(corner) for obj in mesh_objects for corner in obj.bound_box]
    lower = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    upper = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    center = (lower + upper) / 2
    extent = max(upper - lower)

    for obj in mesh_objects:
        for slot in obj.material_slots:
            if slot.material:
                slot.material.use_backface_culling = False

    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    effective_engine = scene.render.engine
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("WitnessWorld")
    scene.world.color = (0.008, 0.008, 0.008)
    scene.view_settings.look = "AgX - Medium High Contrast"

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.lens = 70
    scene.camera = camera

    for location, energy, size in [
        ((-3.0, -4.0, 4.0), 1100, 4.0),
        ((4.0, -1.0, 2.0), 700, 3.0),
        ((0.0, 4.0, 3.0), 900, 3.0),
    ]:
        bpy.ops.object.light_add(type="AREA", location=center + Vector(location) * extent)
        light = bpy.context.object
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size * extent
        look_at(light, center)

    distance = extent * 2.25
    elevation = extent * 0.12
    outputs = []
    for label, degrees in [("front", 0), ("left", 90), ("rear", 180), ("right", 270)]:
        radians = math.radians(degrees)
        camera.location = center + Vector(
            (math.sin(radians) * distance, -math.cos(radians) * distance, elevation)
        )
        look_at(camera, center)
        output_path = os.path.join(args.out_dir, f"{label}.png")
        scene.render.filepath = output_path
        bpy.ops.render.render(write_still=True)
        outputs.append(output_path)

    with open(args.manifest, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schema": "handy.glb-orbit-witness.v1",
                "input_glb": os.path.abspath(args.glb),
                "renderer": "Blender EEVEE Next",
                "effective_engine_enum": effective_engine,
                "two_sided_materials": True,
                "ambient_occlusion_override": "none",
                "camera_lens_mm": 70,
                "views": outputs,
                "mesh_object_count": len(mesh_objects),
                "bounds": {"lower": list(lower), "upper": list(upper)},
                "requested_up_axis": args.up_axis,
                "auto_up_requested": args.auto_up,
            },
            handle,
            indent=2,
        )
except Exception as error:
    with open(args.failure, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schema": "handy.glb-orbit-witness.failure.v1",
                "failure_phase": "import_or_render",
                "error": str(error),
                "traceback": traceback.format_exc(),
            },
            handle,
            indent=2,
        )
    sys.stderr.write(f"GLB witness failed: {error}\n")
    sys.stderr.flush()
    os._exit(1)
