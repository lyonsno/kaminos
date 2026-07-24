#!/usr/bin/env python3

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


PATCH_COLORS = {
    "front-left": (0.05, 0.95, 0.85, 1.0),
    "front-right": (0.95, 0.25, 0.65, 1.0),
    "rear-left": (1.0, 0.65, 0.05, 1.0),
    "rear-right": (0.15, 0.45, 1.0, 1.0),
}


def fail(message):
    print(f"render-lirm-support-atlas-witness: {message}", file=sys.stderr)
    raise SystemExit(2)


def raw_to_blender(values):
    x, y, z = values
    return Vector((x, -z, y))


def make_material(name, color, emission_strength=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.36
    if emission_strength:
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return material


def add_icosphere(name, location, radius, material, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdivisions,
        radius=radius,
        location=location,
    )
    sphere = bpy.context.object
    sphere.name = name
    sphere.data.materials.append(material)
    for polygon in sphere.data.polygons:
        polygon.use_smooth = True
    return sphere


def add_influence_ellipsoid(name, centroid, radii, material):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=28,
        ring_count=16,
        radius=1.0,
        location=raw_to_blender(centroid),
    )
    sphere = bpy.context.object
    sphere.name = name
    sphere.scale = (radii[0], radii[2], radii[1])
    sphere.data.materials.append(material)
    wire = sphere.modifiers.new("carrier-boundary", "WIREFRAME")
    wire.thickness = 0.0024
    wire.use_replace = True
    return sphere


def sample_indices(indices, limit):
    if len(indices) <= limit:
        return indices
    return [indices[round(index * (len(indices) - 1) / (limit - 1))] for index in range(limit)]


def look_at(obj, target):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def scene_bounds(objects):
    mins = Vector((float("inf"), float("inf"), float("inf")))
    maxs = Vector((float("-inf"), float("-inf"), float("-inf")))
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                mins[axis] = min(mins[axis], world[axis])
                maxs[axis] = max(maxs[axis], world[axis])
    if not found:
        fail("witness scene has no mesh geometry")
    return mins, maxs


def render_view(scene, camera, center, diagonal, output_path, yaw, pitch):
    radius = diagonal * 2.35
    camera.location = center + Vector((
        math.sin(yaw) * radius * math.cos(pitch),
        -math.cos(yaw) * radius * math.cos(pitch),
        radius * math.sin(pitch) + diagonal * 0.12,
    ))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = diagonal * 1.13
    camera.data.lens = 58
    look_at(camera, center)
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)


def main(argv):
    if len(argv) != 3:
        fail("usage: blender --background --python render-lirm-support-atlas-witness.py -- input.glb atlas.json output-dir")
    glb_path = Path(argv[0]).resolve()
    atlas_path = Path(argv[1]).resolve()
    output_dir = Path(argv[2]).resolve()
    if not glb_path.exists():
        fail(f"missing GLB {glb_path}")
    if not atlas_path.exists():
        fail(f"missing atlas {atlas_path}")
    output_dir.mkdir(parents=True, exist_ok=True)
    atlas = json.loads(atlas_path.read_text())

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    imported = list(bpy.context.scene.objects)
    mesh_objects = [obj for obj in imported if obj.type == "MESH"]
    if len(mesh_objects) != 1:
        fail(f"expected one source mesh, found {len(mesh_objects)}")
    source = mesh_objects[0]
    if len(source.data.vertices) != atlas.get("vertexCount"):
        fail(
            f"atlas vertex count {atlas.get('vertexCount')} does not match imported mesh "
            f"{len(source.data.vertices)}"
        )

    source_bounds_min, source_bounds_max = scene_bounds([source])
    diagonal = max((source_bounds_max - source_bounds_min).length, 1e-5)
    contact_radius = diagonal * 0.008
    core_radius = diagonal * 0.0045
    centroid_radius = diagonal * 0.014

    for patch in atlas["patches"]:
        patch_id = patch["id"]
        color = PATCH_COLORS[patch_id]
        contact_material = make_material(f"{patch_id}-contact", color, emission_strength=0.4)
        core_color = tuple(component * 0.55 if index < 3 else component for index, component in enumerate(color))
        core_material = make_material(f"{patch_id}-core", core_color, emission_strength=0.12)
        for ordinal, vertex_index in enumerate(sample_indices(patch["vertexIndices"], 20)):
            location = source.matrix_world @ source.data.vertices[vertex_index].co
            add_icosphere(
                f"{patch_id}-contact-{ordinal:02d}",
                location,
                contact_radius,
                contact_material,
            )
        rigid_core = [
            vertex_index
            for vertex_index, weight in zip(
                patch["influenceVertexIndices"],
                patch["influenceWeights"],
            )
            if weight >= 0.5
        ]
        for ordinal, vertex_index in enumerate(sample_indices(rigid_core, 14)):
            location = source.matrix_world @ source.data.vertices[vertex_index].co
            add_icosphere(
                f"{patch_id}-core-{ordinal:02d}",
                location,
                core_radius,
                core_material,
            )
        add_icosphere(
            f"{patch_id}-carrier-origin",
            raw_to_blender(patch["restCentroid"]),
            centroid_radius,
            contact_material,
            subdivisions=2,
        )
        add_influence_ellipsoid(
            f"{patch_id}-influence-boundary",
            patch["restCentroid"],
            patch["derivation"]["influenceRadii"],
            contact_material,
        )

    floor_z = min(vertex.co.z for vertex in source.data.vertices)
    bpy.ops.mesh.primitive_plane_add(size=diagonal * 2.6, location=(0, 0, floor_z - diagonal * 0.012))
    floor = bpy.context.object
    floor.name = "contact-floor"
    floor.data.materials.append(make_material("contact-floor", (0.08, 0.09, 0.08, 1.0)))

    scene = bpy.context.scene
    scene.render.engine = (
        "BLENDER_EEVEE_NEXT"
        if "BLENDER_EEVEE_NEXT"
        in {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
        else "BLENDER_EEVEE"
    )
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1050
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("support-atlas-world")
    scene.world.color = (0.018, 0.02, 0.018)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.25

    center = (source_bounds_min + source_bounds_max) * 0.5
    camera = bpy.data.objects.new("support-atlas-camera", bpy.data.cameras.new("support-atlas-camera"))
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    key_data = bpy.data.lights.new("support-atlas-key", "AREA")
    key = bpy.data.objects.new("support-atlas-key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = center + Vector((diagonal * 1.4, -diagonal * 1.7, diagonal * 2.2))
    key.data.energy = 700
    key.data.size = diagonal * 3.0
    look_at(key, center)

    fill_data = bpy.data.lights.new("support-atlas-fill", "AREA")
    fill = bpy.data.objects.new("support-atlas-fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = center + Vector((-diagonal * 1.7, diagonal * 1.2, diagonal * 1.0))
    fill.data.energy = 260
    fill.data.size = diagonal * 3.5
    look_at(fill, center)

    render_view(scene, camera, center, diagonal, output_dir / "atlas-front-three-quarter.png", -0.72, 0.22)
    render_view(scene, camera, center, diagonal, output_dir / "atlas-rear-three-quarter.png", 2.38, 0.25)
    render_view(scene, camera, center, diagonal, output_dir / "atlas-low-side.png", -1.55, 0.06)

    bpy.ops.export_scene.gltf(
        filepath=str(output_dir / "annotated-support-atlas.glb"),
        export_format="GLB",
        use_selection=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"wrote support-atlas witness to {output_dir}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv)
