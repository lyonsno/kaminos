"""Read-only rear-control and separate painted-reference export for live transport."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

parser=argparse.ArgumentParser()
parser.add_argument('--source',required=True)
parser.add_argument('--control',required=True)
parser.add_argument('--out',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
source=Path(args.source).resolve();out=Path(args.out).resolve()
if source.parent==out or source.parent in out.parents:raise ValueError('output overlaps source directory')
out.mkdir(parents=True,exist_ok=True)
report={'status':'running','phase':'authentication','requestedSource':str(source),
        'blender':bpy.app.version_string,'build':bpy.app.build_hash.decode(),'effectiveBlender':bpy.app.binary_path}
digest=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
try:
    control=json.loads(Path(args.control).read_text())
    before=digest(source)
    if before!=control['sourceSha256']:raise ValueError('source digest mismatch')
    bpy.ops.wm.open_mainfile(filepath=str(source))
    report.update(effectiveSource=bpy.data.filepath,sourceSha256=before,phase='source-extraction')
    cast=bpy.data.objects[control['cast']];arm=bpy.data.objects[control['armature']]
    modifiers=[m for m in cast.modifiers if m.show_viewport]
    if len(modifiers)!=1 or modifiers[0].type!='ARMATURE' or modifiers[0].object!=arm:raise ValueError('effective modifier mismatch')
    if not modifiers[0].use_deform_preserve_volume:raise ValueError('reference is not Preserve Volume')
    if cast.data.shape_keys or any(b.constraints for b in arm.pose.bones):raise ValueError('unresolved keys or constraints')
    names=['pelvis']+[f'hindlimb-{side}-{joint}' for side in ['left','right'] for joint in ['hip','stifle','hock']]
    if set(names)!=set(arm.data.bones.keys()):raise ValueError('rear bone inventory changed')
    normalization=Matrix(control['normalization'])
    def rigid(matrix):
        p,q,s=matrix.decompose()
        if max(s)-min(s)>1e-5 or min(s)<=0:raise ValueError('nonuniform or reflected source frame')
        return Matrix.LocRotScale(p,q,Vector((1,1,1)))
    def rows(matrix):return [list(row) for row in matrix]
    for pb in arm.pose.bones:pb.matrix_basis=Matrix.Identity(4);pb.rotation_mode='QUATERNION'
    bpy.context.view_layer.update()
    bones=[];rest={}
    for name in names:
        bone=arm.data.bones[name];rest[name]=rigid(normalization@arm.matrix_world@bone.matrix_local)
        bones.append({'name':name,'parent':bone.parent.name if bone.parent else None,
            'restMatrix':rows(rest[name]),'tail':list(normalization@arm.matrix_world@bone.tail_local),
            'useDeform':bone.use_deform})
    painted=np.zeros((len(cast.data.vertices),8),dtype=np.float32)
    groups={group.index:group.name for group in cast.vertex_groups}
    for vertex in cast.data.vertices:
        for membership in vertex.groups:
            name=groups[membership.group]
            if name in names and arm.data.bones[name].use_deform:painted[vertex.index,names.index(name)+1]=membership.weight
    total=painted.sum(axis=1);known=total>0
    painted[known]/=total[known,None];painted[~known,0]=1
    painted.tofile(out/'painted-weights.bin')
    def qx(degrees):return list(Quaternion((1,0,0),math.radians(degrees)))
    presets=[('rest',{}),('accepted-left-hip',{'hindlimb-left-hip':control['frames'][6]['localQuaternion']}),
        ('left-stifle',{'hindlimb-left-stifle':qx(40)}),('left-hock',{'hindlimb-left-hock':qx(-25)}),
        ('left-chain',{'hindlimb-left-hip':qx(25),'hindlimb-left-stifle':qx(40),'hindlimb-left-hock':qx(-25)}),
        ('right-hip',{'hindlimb-right-hip':qx(40)}),('right-stifle',{'hindlimb-right-stifle':qx(40)}),
        ('right-hock',{'hindlimb-right-hock':qx(-25)}),
        ('right-chain',{'hindlimb-right-hip':qx(25),'hindlimb-right-stifle':qx(40),'hindlimb-right-hock':qx(-25)}),
        ('both-chains',{'hindlimb-left-hip':qx(25),'hindlimb-left-stifle':qx(40),'hindlimb-left-hock':qx(-25),
                        'hindlimb-right-hip':qx(-20),'hindlimb-right-stifle':qx(30),'hindlimb-right-hock':qx(-15)})]
    frames=[];references=[]
    for label,pose in presets:
        for pb in arm.pose.bones:pb.rotation_quaternion=Quaternion((1,0,0,0))
        for name,value in pose.items():arm.pose.bones[name].rotation_quaternion=Quaternion(value)
        bpy.context.view_layer.update()
        palette=[rows(Matrix.Identity(4))]+[rows(rigid(normalization@arm.matrix_world@arm.pose.bones[name].matrix)@rest[name].inverted()) for name in names]
        evaluated=cast.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
        try:
            if len(mesh.vertices)!=len(painted):raise ValueError('reference topology changed')
            references.append(np.asarray([list(normalization@evaluated.matrix_world@v.co) for v in mesh.vertices],dtype=np.float32))
        finally:evaluated.to_mesh_clear()
        frames.append({'name':label,'poseWxyz':pose,'palette':palette})
    np.asarray(references,dtype='<f4').tofile(out/'blender-reference.bin')
    derived={'schema':'kaminos.live-transport-source.v1','sourceSha256':before,'cast':cast.name,'armature':arm.name,
        'bones':bones,'channels':['fixed']+names,'vertices':len(painted),'presets':frames,
        'paintedWeights':{'path':str(out/'painted-weights.bin'),'sha256':digest(out/'painted-weights.bin')},
        'reference':{'path':str(out/'blender-reference.bin'),'sha256':digest(out/'blender-reference.bin')},
        'referenceRoute':'Blender 5.1.2 Armature Preserve Volume; live replay conformance remains measured separately'}
    (out/'rig-source.json').write_text(json.dumps(derived,indent=2))
    report.update(status='completed',phase='completed',sourceUnchanged=digest(source)==before,
        bones=len(bones),vertices=len(painted),presets=len(frames),rigSource=str(out/'rig-source.json'))
    if not report['sourceUnchanged']:raise ValueError('source bytes changed')
except Exception as error:
    report.update(status='failed',error=str(error));raise
finally:
    (out/'source-extraction.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
