"""Read-only source inspection/extraction. Outputs never enter Operator Scratch."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector


def matrix_rows(matrix):
    return [list(row) for row in matrix]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--cast', help='exact object for neutral geometry and separate painted reference extraction')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source = Path(args.source).resolve()
    output = Path(args.out).resolve()
    if output == source or source.parent in output.parents:
        raise ValueError('derived output must be outside the source scene directory')
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'kaminos.hindquarter-source-inspection.v1',
              'requestedSource': str(source), 'expectedSha256': args.expected_sha256,
              'requestedBlender': sys.argv[0], 'blender': bpy.app.version_string,
              'status': 'running', 'phase': 'source-authentication'}
    digest = lambda: hashlib.sha256(source.read_bytes()).hexdigest()
    try:
        before = digest()
        report['sourceSha256'] = before
        if before != args.expected_sha256:
            raise ValueError('source digest mismatch')
        report['phase'] = 'read-only-scene-open'
        bpy.ops.wm.open_mainfile(filepath=str(source))
        report['effectiveSource'] = bpy.data.filepath
        report['casts'] = []
        for obj in bpy.data.objects:
            if obj.type != 'MESH' or not obj.name.startswith('CAT_CAST_MANNEQUIN_80413_STRONG'):
                continue
            report['casts'].append({'name': obj.name, 'mesh': obj.data.name,
                'vertices': len(obj.data.vertices), 'polygons': len(obj.data.polygons),
                'matrixWorld': matrix_rows(obj.matrix_world), 'parent': obj.parent.name if obj.parent else None,
                'shapeKeys': [{'name': key.name, 'value': key.value} for key in obj.data.shape_keys.key_blocks] if obj.data.shape_keys else [],
                'modifiers': [{'name': m.name, 'type': m.type, 'visible': m.show_viewport,
                    'armature': m.object.name if m.type == 'ARMATURE' and m.object else None,
                    'preserveVolume': m.use_deform_preserve_volume if m.type == 'ARMATURE' else None} for m in obj.modifiers],
                'groupNames': [group.name for group in obj.vertex_groups]})
        report['armatures'] = []
        for obj in bpy.data.objects:
            if obj.type != 'ARMATURE':
                continue
            report['armatures'].append({'name': obj.name, 'matrixWorld': matrix_rows(obj.matrix_world),
                'bones': [{'name': bone.name, 'parent': bone.parent.name if bone.parent else None,
                    'head': list(obj.matrix_world @ bone.head_local),
                    'tail': list(obj.matrix_world @ bone.tail_local),
                    'restMatrix': matrix_rows(obj.matrix_world @ bone.matrix_local),
                    'poseBasis': matrix_rows(obj.pose.bones[bone.name].matrix_basis),
                    'constraints': [constraint.type for constraint in obj.pose.bones[bone.name].constraints]}
                    for bone in obj.data.bones]})
        report['sourceUnchanged'] = digest() == before
        if not report['sourceUnchanged']:
            raise ValueError('source changed during read-only inspection')
        if args.cast:
            report['phase'] = 'exact-cast-extraction'
            cast = bpy.data.objects.get(args.cast)
            if cast is None or cast.type != 'MESH':
                raise ValueError('exact cast object missing')
            modifiers = [m for m in cast.modifiers if m.show_viewport]
            if len(modifiers) != 1 or modifiers[0].type != 'ARMATURE':
                raise ValueError('selected cast requires exactly one effective Armature modifier')
            armature = modifiers[0].object
            if armature is None or cast.data.shape_keys:
                raise ValueError('missing armature or unresolved shape keys')
            if any(pb.constraints for pb in armature.pose.bones):
                raise ValueError('unresolved pose constraints')
            for pb in armature.pose.bones:
                pb.matrix_basis = Matrix.Identity(4)
            bpy.context.view_layer.update()
            hip_name = 'hindlimb-left-hip'
            hip = armature.data.bones[hip_name]
            stifle = armature.data.bones['hindlimb-left-stifle']
            scale = (stifle.head_local - hip.head_local).length
            if scale <= 0:
                raise ValueError('invalid hip-stifle control spacing')
            # A recorded proper rotation makes source +Z-down become viewer -Y.
            rotation = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
            normalization = Matrix.Diagonal((1/scale, 1/scale, 1/scale, 1)) @ rotation @ Matrix.Translation(-hip.head_local) @ armature.matrix_world.inverted()
            cast_transform = normalization @ cast.matrix_world
            rest = np.array([list(cast_transform @ v.co) for v in cast.data.vertices], dtype=np.float64)
            cast.data.calc_loop_triangles()
            triangles = np.array([list(t.vertices) for t in cast.data.loop_triangles], dtype=np.uint32)
            geometry_path = output.parent / 'cast-geometry.npz'
            # Candidate input contains geometry only: no vertex-group data.
            np.savez(geometry_path, positions=rest, triangles=triangles)
            joints = {bone.name: list(normalization @ armature.matrix_world @ bone.head_local) for bone in armature.data.bones}
            rest_world = armature.matrix_world @ hip.matrix_local
            normalized_rest = normalization @ rest_world
            local_thigh_axis = hip.matrix_local.to_3x3().inverted() @ (stifle.head_local - hip.head_local).normalized()
            frames = []
            references = []
            pb = armature.pose.bones[hip_name]
            pb.rotation_mode = 'QUATERNION'
            for kind, flex_max, twist_max in [('flex', 40, 0), ('twist', 0, 30), ('combined', 30, 20)]:
                for step in range(13):
                    amount = math.sin(math.pi * step / 12)**2
                    flex = math.radians(flex_max) * amount
                    twist = math.radians(twist_max) * amount
                    q = Quaternion((1, 0, 0), flex) @ Quaternion(local_thigh_axis, twist)
                    pb.rotation_quaternion = q
                    bpy.context.view_layer.update()
                    delta = normalization @ armature.matrix_world @ pb.matrix @ rest_world.inverted() @ normalization.inverted()
                    evaluated = cast.evaluated_get(bpy.context.evaluated_depsgraph_get())
                    mesh = evaluated.to_mesh()
                    try:
                        if len(mesh.vertices) != len(rest):
                            raise ValueError('reference modifier changed topology')
                        references.append(np.array([list(normalization @ evaluated.matrix_world @ v.co) for v in mesh.vertices], dtype=np.float32))
                    finally:
                        evaluated.to_mesh_clear()
                    frames.append({'kind': kind, 'step': step, 'flexDegrees': math.degrees(flex),
                                   'twistDegrees': math.degrees(twist), 'localQuaternion': list(q),
                                   'movingMatrix': matrix_rows(delta),
                                   'movingQuaternion': list(delta.to_quaternion())})
            reference_path = output.parent / 'painted-reference.npy'
            np.save(reference_path, np.asarray(references))
            control = {'schema': 'kaminos.hindquarter-cast-input.v1', 'sourceSha256': before,
                       'cast': cast.name, 'armature': armature.name,
                       'normalization': matrix_rows(normalization), 'unitsPerFemur': scale,
                       'joints': joints, 'parents': {b.name: b.parent.name if b.parent else None for b in armature.data.bones},
                       'hipRestMatrix': matrix_rows(normalized_rest), 'frames': frames,
                       'candidateInputs': ['positions', 'triangles', 'joints', 'parents', 'hipRestMatrix', 'frames'],
                       'paintedWeightsIncluded': False,
                       'referenceRoute': {'type': 'Blender Armature evaluation', 'modifier': modifiers[0].name,
                                          'preserveVolume': modifiers[0].use_deform_preserve_volume},
                       'geometry': {'path': str(geometry_path), 'sha256': hashlib.sha256(geometry_path.read_bytes()).hexdigest()},
                       'reference': {'path': str(reference_path), 'sha256': hashlib.sha256(reference_path.read_bytes()).hexdigest()},
                       'bounds': {'min': rest.min(axis=0).tolist(), 'max': rest.max(axis=0).tolist()}}
            control_path = output.parent / 'cast-input.json'
            control_path.write_text(json.dumps(control, indent=2))
            report['extraction'] = {'cast': cast.name, 'armature': armature.name, 'vertices': len(rest),
                                    'triangles': len(triangles), 'frames': len(frames), 'control': str(control_path),
                                    'geometry': control['geometry'], 'reference': control['reference']}
            report['sourceUnchanged'] = digest() == before
            if not report['sourceUnchanged']:
                raise ValueError('source changed during extraction')
        report.update(status='completed', phase='completed')
    except Exception as error:
        report.update(status='failed', error=str(error))
        output.write_text(json.dumps(report, indent=2))
        raise
    output.write_text(json.dumps(report, indent=2))
    print(json.dumps({'out': str(output), 'status': report['status'],
                      'casts': [row['name'] for row in report['casts']]}))


main()
