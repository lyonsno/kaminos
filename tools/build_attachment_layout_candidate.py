"""Export a separate reference-calibrated candidate under installed Blender."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from creature_attachment_layout import calibrate_attachment_layout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True)
    parser.add_argument('--layouts', required=True)
    parser.add_argument('--reference', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    output = Path(args.out).resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = dict(status='failed', phase='input', argv=sys.argv)
    paths = [Path(args.plan).resolve(), Path(args.layouts).resolve()]
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    try:
        report['inputs'] = {str(p): digest(p) for p in paths}
        plan = json.loads(paths[0].read_text())
        layouts = json.loads(paths[1].read_text())['rigs']
        source = next(r for r in layouts if r['id'] == 'ours')
        reference = next(r for r in layouts if r['id'] == args.reference)
        candidate = calibrate_attachment_layout(plan, source, reference)
        report.update(phase='export', reference=args.reference,
                      intervention=candidate['attachment_intervention'])
        import bpy
        from mathutils import Matrix, Vector
        bpy.ops.wm.read_factory_settings(use_empty=True)
        armature = bpy.data.armatures.new('Candidate28')
        rig = bpy.data.objects.new('Candidate28', armature)
        bpy.context.scene.collection.objects.link(rig)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode='EDIT')
        for j in candidate['joints']:
            bone = armature.edit_bones.new(j['name'])
            bone.head, bone.tail = Vector(j['head']), Vector(j['tail'])
            bone.align_roll(Vector((0,0,1)))
        for j in candidate['joints']:
            if j['parent']:
                armature.edit_bones[j['name']].parent = armature.edit_bones[j['parent']]
        bpy.ops.object.mode_set(mode='OBJECT')
        rig.matrix_world = Matrix.Rotation(math.pi, 4, 'X')
        markers = []
        for j in candidate['joints']:
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.42)
            marker = bpy.context.object
            marker.name = j['name'] + ' candidate marker'
            marker.matrix_world = rig.matrix_world @ Matrix.Translation(Vector(j['head']))
            group = marker.vertex_groups.new(name=j['name'])
            group.add(list(range(len(marker.data.vertices))), 1., 'REPLACE')
            modifier = marker.modifiers.new('Candidate joint skin', 'ARMATURE')
            modifier.object = rig
            markers.append(marker)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        for obj in [rig,*markers]:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(filepath=str(output/'candidate.glb'), export_format='GLB',
                                 use_selection=True, export_animations=False, export_apply=False)
        (output/'joint-plan.json').write_text(json.dumps(candidate, indent=2)+'\n')
        bpy.ops.wm.save_as_mainfile(filepath=str(output/'candidate.blend'))
        if report['inputs'] != {str(p): digest(p) for p in paths}:
            raise ValueError('input changed during export')
        report.update(status='completed', phase='complete', source_unchanged=True,
                      joints=len(candidate['joints']),
                      outputs={p.name:digest(p) for p in output.iterdir() if p.is_file()})
        print(json.dumps(report))
    except Exception as exc:
        report['error'] = repr(exc)
        raise
    finally:
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')


if __name__ == '__main__':
    main()
