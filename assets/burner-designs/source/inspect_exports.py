"""Reimport the deliverable GLBs, ray-check apertures, and render their real meshes.

blender -b -t 2 --python inspect_exports.py -- --assets DIR
Render-only studio props are never written into the deliverable GLBs.
"""
import argparse
import hashlib
import json
import math
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector


def blender(v):
    return Vector((v[0], -v[2], v[1]))


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def load(path):
    clear()
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()


def bounds():
    pts = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects if o.type == 'MESH' for c in o.bound_box]
    return [Vector(tuple(min(p[i] for p in pts) for i in range(3))),
            Vector(tuple(max(p[i] for p in pts) for i in range(3)))]


def inspect(path, record):
    load(path)
    deps = bpy.context.evaluated_depsgraph_get()
    tests = []
    for aperture in record['outlets']:
        p = blender(aperture['position'])
        d = blender(aperture['direction']).normalized()
        a = aperture['aperture']
        if a['shape'] == 'capsule':
            u = blender(a['major_axis']).normalized()
            v = d.cross(u)
            offsets = [Vector((0, 0, 0)), u*.023, u*-.023, v*.004, v*-.004]
        elif a['shape'] == 'rectangle':
            u = blender(a['major_axis'])
            v = blender(a['minor_axis'])
            offsets = [u*x + v*y for x in [-.43, 0, .43] for y in [-.004, 0, .004]]
        else:
            u = Vector((1, 0, 0))
            v = d.cross(u).normalized()
            offsets = [Vector((0, 0, 0)), u*.035, u*-.035, v*.035, v*-.035]
        for offset in offsets:
            start = p + offset + d*.002
            hit = bpy.context.scene.ray_cast(deps, start, -d, distance=.052)
            tests.append({'outlet': aperture['id'], 'offset_gltf': [offset.x, offset.z, -offset.y],
                          'clear_50mm_inward': not hit[0],
                          'blocking_mesh': hit[4].name if hit[0] else None})
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    lo, hi = bounds()
    return {'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'mesh_parts': len(meshes), 'triangles': sum(len(o.data.polygons) for o in meshes),
            'bounds_gltf': [[lo.x, lo.z, -hi.y], [hi.x, hi.z, -lo.y]],
            'aperture_checks': tests, 'apertures_clear': all(t['clear_50mm_inward'] for t in tests),
            'missing_parts': sorted(set(record['mesh_parts']) - {o.name for o in meshes})}


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def render(path, outfile, camera_side=(1, -1.5, 1.1), width=1600, height=1100):
    load(path)
    lo, hi = bounds()
    center = (lo + hi)/2
    span = max(hi.x-lo.x, (hi.y-lo.y)*1.1, (hi.z-lo.z)*1.4)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.22, .26, .30, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .5
    scene.view_settings.view_transform = 'AgX'
    # Broad floor and large area sources produce readable metal and contact shadows.
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.001))
    floor = bpy.context.object
    floor.name = 'inspection_only_floor'
    m = bpy.data.materials.new('inspection_only_floor')
    m.diffuse_color = (.085, .11, .13, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (.085, .11, .13, 1)
    bsdf.inputs['Roughness'].default_value = .72
    floor.data.materials.append(m)
    lights = [((-1.5, -2.5, 3.5), 420, 3, (1, .90, .78)),
              ((2, -1, 2), 280, 2, (.72, .88, 1)),
              ((0, 2.3, 3), 500, 2.5, (1, .92, .80))]
    # Keep studio distance/energy fixed across all renders for comparable materials.
    for i, (loc, energy, size, color) in enumerate(lights):
        bpy.ops.object.light_add(type='AREA', location=loc)
        l = bpy.context.object
        l.name = 'inspection_only_light_' + str(i)
        l.data.energy = energy
        l.data.shape = 'DISK'
        l.data.size = size
        l.data.color = color
        aim(l, center)
    bpy.ops.object.camera_add(location=center + Vector(camera_side).normalized()*span*3)
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = span*1.25
    cam.data.lens = 50
    aim(cam, center)
    scene.camera = cam
    scene.render.filepath = str(outfile)
    bpy.ops.render.render(write_still=True)


def main(assets, render_enabled=True, views=None):
    out = assets/'previews'
    out.mkdir(exist_ok=True)
    report = {'status': 'running', 'phase': 'import', 'blender_version': bpy.app.version_string,
              'effective_route': 'Blender glTF importer; Cycles CPU, 2 threads, 24 samples',
              'requested_views': views or ('all' if render_enabled else []), 'rendered_views': [], 'assets': []}
    report_path = out/'inspection.json'
    report_path.write_text(json.dumps(report, indent=2)+'\n')
    try:
        manifest = json.loads((assets/'outlets.json').read_text())
        for key, record in manifest['assets'].items():
            report['assets'].append(inspect(assets/record['file'], record))
            report_path.write_text(json.dumps(report, indent=2)+'\n')
        assert all(r['apertures_clear'] for r in report['assets']), 'An actual outlet is blocked within 50mm'
        assert all(not r['missing_parts'] for r in report['assets']), 'Named mesh parts lost during glTF export'
        report['phase'] = 'render'
        if render_enabled:
            for name, file, side, w, h in [
                ('comparison', 'burner-comparison.glb', (.45, -2.5, 1.9), 2200, 1100),
                ('annular', 'annular-burner.glb', (.95, -1.4, 1.55), 1300, 1100),
                ('linear', 'linear-burner.glb', (.8, -1.7, 1.6), 1500, 1050),
                ('nozzle', 'directional-nozzle.glb', (1.4, -1.9, 1.0), 1300, 1150),
                ('annular-top', 'annular-burner.glb', (.02, -.04, 3), 1100, 1100),
                ('nozzle-bore', 'directional-nozzle.glb', (.20, -2, .65), 1100, 1100),
            ]:
                if views and name not in views:
                    continue
                report['rendering'] = name
                report_path.write_text(json.dumps(report, indent=2)+'\n')
                render(assets/file, out/(name+'.png'), side, w, h)
                report['rendered_views'].append(name)
        report.update(status='passed', phase='complete')
    except Exception:
        report.update(status='failed', error=traceback.format_exc())
        raise
    finally:
        report_path.write_text(json.dumps(report, indent=2)+'\n')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--assets', type=Path, default=Path(__file__).resolve().parent.parent)
    p.add_argument('--no-render', action='store_true')
    p.add_argument('--views', nargs='+', choices=['comparison', 'annular', 'linear', 'nozzle', 'annular-top', 'nozzle-bore'])
    args = p.parse_args(sys.argv[sys.argv.index('--')+1:])
    main(args.assets.resolve(), not args.no_render, args.views)
