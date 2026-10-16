"""Blender export of an existing corrected plan; no source-scene mutation."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    for name in ('plan', 'probe', 'out'):
        parser.add_argument('--'+name, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    inputs = [Path(args.plan).resolve(), Path(args.probe).resolve()]
    out = Path(args.out).resolve()
    if out.exists() or any(out == p.parent or out == p or out in p.parents for p in inputs):
        raise ValueError('choose a fresh output directory distinct from source directories')
    out.mkdir(parents=True)
    digest = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
    report = dict(status='failed',phase='input',argv=sys.argv)
    try:
        report['inputs'] = {str(p):digest(p) for p in inputs}
        plan, probe = [json.loads(p.read_text()) for p in inputs]
        if plan['source'] != probe['source']:
            raise ValueError('plan/probe source mismatch')
        for path, expected in plan['source'].items():
            if digest(path) != expected:
                raise ValueError('source changed: '+path)
        import bpy
        from mathutils import Matrix, Vector
        report.update(phase='build',blender=bpy.app.version_string)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        rig = bpy.data.objects.new('MARIONETTE_COMPLETE_PAWS',bpy.data.armatures.new('CompletePaws'))
        bpy.context.scene.collection.objects.link(rig)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode='EDIT')
        for j in plan['joints']:
            b = rig.data.edit_bones.new(j['name'])
            b.head = Vector(j['head'])
            # Control axes remain the original +Y convention. The actual paw
            # segment is the parent-to-child head edge, not this display tail.
            delta = Vector((0,1,0))
            b.tail = b.head + delta
            b.align_roll(Vector((0,0,1)))
        for j in plan['joints']:
            if j['parent']:
                rig.data.edit_bones[j['name']].parent = rig.data.edit_bones[j['parent']]
        bpy.ops.object.mode_set(mode='OBJECT')
        rig.matrix_world = Matrix.Rotation(math.pi,4,'X')
        marker_material = bpy.data.materials.new('Joint markers')
        marker_material.diffuse_color = (.02,.8,.9,1)
        paw_material = bpy.data.materials.new('Recovered paw chain')
        paw_material.diffuse_color = (1,.35,.025,1)
        markers, rods = [], []
        by_name = {j['name']:j for j in plan['joints']}
        for j in plan['joints']:
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.28)
            o = bpy.context.object
            o.name = j['name']+' marker'
            o.matrix_world = rig.matrix_world @ Matrix.Translation(Vector(j['head']))
            o.data.materials.append(paw_material if '-toe' in j['name'] else marker_material)
            group = o.vertex_groups.new(name=j['name'])
            group.add(list(range(len(o.data.vertices))),1.,'REPLACE')
            modifier = o.modifiers.new('Joint marker skin','ARMATURE')
            modifier.object = rig
            markers.append(o)
            if j['parent']:
                a,b = Vector(by_name[j['parent']]['head']),Vector(j['head'])
                delta = b-a
                bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=.1,depth=delta.length)
                rod = bpy.context.object
                rod.matrix_world = rig.matrix_world @ Matrix.Translation((a+b)/2) @ delta.to_track_quat('Z','Y').to_matrix().to_4x4()
                rod.data.materials.append(paw_material if '-toe' in j['name'] else marker_material)
                rods.append(rod)
        bpy.context.view_layer.update()

        def export(path, objects):
            bpy.ops.object.select_all(action='DESELECT')
            for o in objects:
                o.select_set(True)
            bpy.context.view_layer.objects.active = rig
            bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
                                     export_animations=False,export_apply=False)

        report['phase'] = 'export-rig'
        export(out/'complete-paws.glb',[rig,*markers])
        export(out/'complete-paws-links.glb',[rig,*markers,*rods])
        report['phase'] = 'anatomy-overlay'
        anatomy_path = next(path for path in probe['source'] if Path(path).suffix.lower()=='.glb')
        previous = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=anatomy_path)
        anatomy = []
        for o in set(bpy.data.objects)-previous:
            if o.type == 'MESH' and o.name != 'Cube.012':
                o.matrix_world = rig.matrix_world @ Matrix.Translation(Vector(plan['anatomy_to_rear_frame'])) @ o.matrix_world
                anatomy.append(o)
        export(out/'complete-paws-anatomy.glb',[rig,*markers,*rods,*anatomy])
        if report['inputs'] != {str(p):digest(p) for p in inputs}:
            raise ValueError('input changed during export')
        for path, expected in plan['source'].items():
            if digest(path) != expected:
                raise ValueError('source changed during export: '+path)
        report.update(status='completed',phase='complete',joints=len(plan['joints']),
                      outputs={p.name:digest(p) for p in out.iterdir() if p.is_file()})
    except Exception as exc:
        report['error'] = repr(exc)
        raise
    finally:
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
