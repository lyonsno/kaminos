"""Extend the recovered adapter on a derived scene and export inspectable joints."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0,str(Path(__file__).parent))
from creature_joint_plan import build_plan


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def weights_digest(obj):
    return hashlib.sha256(json.dumps([[v.index,[(g.group,g.weight) for g in v.groups]]
                                     for v in obj.data.vertices]).encode()).hexdigest()


def material(name,color,alpha=1):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color,alpha)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color,alpha)
    p.inputs['Alpha'].default_value = alpha
    p.inputs['Roughness'].default_value = .7
    return m


def export(path,objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
                             export_animations=False,export_apply=False)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--probe',required=True)
    p.add_argument('--source',required=True)
    p.add_argument('--output-dir',required=True)
    args = p.parse_args(sys.argv[sys.argv.index('--')+1:])
    output = Path(args.output_dir).resolve()
    if output.exists():
        raise ValueError('choose a fresh output directory to preserve prior evidence')
    output.mkdir(parents=True)
    report = {'status':'failed','phase':'input','source':str(Path(args.source).resolve())}
    try:
        probe = json.loads(Path(args.probe).read_text())
        plan = build_plan(probe)
        source_hash = digest(args.source)
        if probe['source'].get(str(Path(args.source).resolve())) != source_hash:
            raise ValueError('source differs from admitted probe')
        report['phase'] = 'source-open'
        bpy.ops.wm.open_mainfile(filepath=args.source)
        bpy.context.view_layer.update()
        old = bpy.data.objects['KAMINOS_CONTROL_ADAPTER']
        casts = [o for o in bpy.data.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
        before_weights = {o.name:weights_digest(o) for o in casts}
        old_frames = {b.name:[list(r) for r in b.matrix_local] for b in old.data.bones}
        rig = bpy.data.objects.new('MARIONETTE_COMPLETE_JOINTS',old.data.copy())
        bpy.context.scene.collection.objects.link(rig)
        rig.matrix_world = old.matrix_world.copy()
        rig.show_in_front = True
        rig['authority'] = 'Mushfinger rear adapter plus agent-derived complete joint placement'
        rig['source_sha256'] = source_hash
        bpy.ops.object.select_all(action='DESELECT')
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode='EDIT')
        for j in plan['joints']:
            if j['retained']:
                continue
            bone = rig.data.edit_bones.new(j['name'])
            bone.head, bone.tail = Vector(j['head']),Vector(j['tail'])
            bone.align_roll(Vector((0,0,1)))
            bone.parent = rig.data.edit_bones[j['parent']]
            bone.use_connect = False
        bpy.ops.object.mode_set(mode='OBJECT')
        for j in plan['joints']:
            rig.data.bones[j['name']]['unimate_label'] = j['label']
            rig.data.bones[j['name']]['derivation'] = j['derivation']
        # A rigid marker at every joint is the skeleton-only interchange skin.
        # The painted creature remains bound to its original seven-bone rig.
        markers = []
        colors = {'retained':material('Retained rear controls',(0.04,.8,1.)),
                  'new':material('Added front and body joints',(1.,.35,.025)),
                  'anatomy':material('Anatomical bone geometry',(.68,.66,.58)),
                  'cast':material('Cast registration silhouette',(.35,.6,.43),.17)}
        for j in plan['joints']:
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.42,location=j['head'])
            o = bpy.context.object
            o.name = j['name']+' joint marker'
            o.data.materials.append(colors['retained' if j['retained'] else 'new'])
            o.matrix_world = rig.matrix_world @ o.matrix_world
            group = o.vertex_groups.new(name=j['name'])
            group.add(list(range(len(o.data.vertices))),1.,'REPLACE')
            modifier = o.modifiers.new('Complete joint marker skin','ARMATURE')
            modifier.object = rig
            markers.append(o)
        rods = []
        by_name = {j['name']:j for j in plan['joints']}
        for j in plan['joints']:
            if j['parent'] is None:
                continue
            a,b = Vector(by_name[j['parent']]['head']),Vector(j['head'])
            delta = b-a
            bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=.16,depth=delta.length,location=(a+b)/2)
            o = bpy.context.object
            o.name = j['name']+' hierarchy link'
            o.rotation_euler = delta.to_track_quat('Z','Y').to_euler()
            o.data.materials.append(colors['retained' if j['retained'] else 'new'])
            o.matrix_world = rig.matrix_world @ o.matrix_world
            rods.append(o)
        # Source anatomy is put into precisely the same local frame as the rear adapter.
        anatomy = []
        previous = set(bpy.data.objects)
        anatomy_path = next(path for path,sha in probe['source'].items() if sha==
                            '533e4a6a63e658d86e841e0294bbecb4cd3f9be52b253c063282aa15b3596eb7')
        bpy.ops.import_scene.gltf(filepath=anatomy_path)
        for o in set(bpy.data.objects)-previous:
            if o.type=='MESH':
                o.matrix_world = rig.matrix_world @ Matrix.Translation(plan['anatomy_to_rear_frame']) @ o.matrix_world
                o.data.materials.clear()
                o.data.materials.append(colors['anatomy'])
                anatomy.append(o)
        original_cast = bpy.data.objects['CAT_CAST_MANNEQUIN_80413_STRONG']
        cast = bpy.data.objects.new('CAST_REGISTRATION_REFERENCE',original_cast.data.copy())
        bpy.context.scene.collection.objects.link(cast)
        cast.matrix_world = original_cast.matrix_world.copy()
        cast.data.materials.clear()
        cast.data.materials.append(colors['cast'])
        # Stand only the new inspection objects upright around the copied rig origin.
        display = Matrix.Rotation(math.pi,4,'X') @ rig.matrix_world.inverted()
        for o in [rig,*markers,*rods,*anatomy,cast]:
            o.matrix_world = display @ o.matrix_world
        report['phase'] = 'export'
        export(output/'complete-joints.glb',[rig,*markers])
        export(output/'complete-joints-anatomy.glb',[rig,*markers,*rods,*anatomy])
        export(output/'complete-joints-cast.glb',[rig,*markers,*rods,cast])
        plan['display_transform'] = [list(r) for r in display]
        plan['rest_rotation_for_gltf'] = 'none (upright display transform baked in exported object frame)'
        (output/'joint-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
        bpy.ops.wm.save_as_mainfile(filepath=str(output/'complete-joints-derived.blend'))
        report.update({'status':'completed','phase':'complete','joint_count':len(plan['joints']),
                       'retained_rear_frames_unchanged':all([list(r) for r in rig.data.bones[name].matrix_local]==mat for name,mat in old_frames.items()),
                       'painted_weights_unchanged':all(weights_digest(o)==before_weights[o.name] for o in casts),
                       'original_rear_frames_unchanged':all([list(r) for r in old.data.bones[name].matrix_local]==mat for name,mat in old_frames.items()),
                       'source_unchanged':digest(args.source)==source_hash,
                       'source_sha256':source_hash,
                       'outputs':{f.name:digest(f) for f in output.iterdir() if f.is_file()}})
        if not all(report[k] for k in ('retained_rear_frames_unchanged','painted_weights_unchanged',
                                      'original_rear_frames_unchanged','source_unchanged')):
            raise ValueError('source/continuity invariant failed')
        print(json.dumps(report),flush=True)
    except Exception as exc:
        report.update(status='failed',error=repr(exc))
        raise
    finally:
        (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':
    main()
