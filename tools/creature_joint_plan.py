"""Source-derived joint plan; the seven accepted rear controls are the base."""
import copy
import math
from pathlib import Path
import hashlib


def validate_probe_paths(source, anatomy, output):
    source, anatomy, output = (Path(p).resolve() for p in (source,anatomy,output))
    for input_path in (source,anatomy):
        if output == input_path or (output.exists() and input_path.exists() and output.samefile(input_path)):
            raise ValueError('probe output aliases an input')
    if output.exists():
        raise ValueError('probe output already exists; preserve prior evidence')
    return source,anatomy,output


def verify_probe_sources(probe):
    observed = {}
    for raw,expected in probe['source'].items():
        path = Path(raw).resolve()
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f'source hash mismatch: {path}; expected {expected}, effective {actual}')
        observed[str(path)] = actual
    return observed

SOURCE_ANATOMY_SHA = '533e4a6a63e658d86e841e0294bbecb4cd3f9be52b253c063282aa15b3596eb7'
# August10 source hierarchy receipt: hierarchy-to-frozen anatomy translation,
# converted from glTF Y-up into the original Blender frame. The new points
# inherit that frame; the accepted cast/rig transform then places them.
ANATOMY_TO_REAR_FRAME = [-20.362567901611328, 12.2189040184021, 0.0]


def mean(points):
    return [sum(p[k] for p in points)/len(points) for k in range(3)]


def validate_plan(plan):
    joints = plan['joints']
    names = [j['name'] for j in joints]
    if len(names) != len(set(names)):
        raise ValueError('duplicate joint names')
    if sum(j['parent'] is None for j in joints) != 1:
        raise ValueError('joint tree must have one root')
    parents = {j['name']: j['parent'] for j in joints}
    for j in joints:
        if not all(isinstance(x, (int,float)) and math.isfinite(x) for x in j['head']+j['tail']):
            raise ValueError('nonfinite joint position')
        seen = {j['name']}
        p = j['parent']
        while p is not None:
            if p not in parents or p in seen:
                raise ValueError('missing parent or cycle')
            seen.add(p)
            p = parents[p]
    return plan


def build_plan(probe):
    if not probe['source_unchanged'] or SOURCE_ANATOMY_SHA not in probe['source'].values():
        raise ValueError('unverified anatomical source')
    meshes = {m['name']:m for m in probe['anatomy']}
    plan = {'schema':'kaminos.complete-creature-joints.v0',
            'authority':'agent-derived joint placement for operator inspection',
            'source':copy.deepcopy(probe['source']), 'source_armature':'KAMINOS_CONTROL_ADAPTER',
            'frame':'accepted armature local; original Blender rest pose',
            'anatomy_to_rear_frame':ANATOMY_TO_REAR_FRAME,
            'joints':copy.deepcopy(probe['bones'])}
    length = math.dist(probe['bones'][0]['head'],probe['bones'][0]['tail'])
    for j in plan['joints']:
        j.update({'derivation':'exact existing Mushfinger adapter bone', 'retained':True,
                  'label': 'Hips' if j['name']=='pelvis' else
                  ('Left ' if '-left-' in j['name'] else 'Right ')+
                  {'hip':'Thigh','stifle':'Shin','hock':'Foot'}[j['name'].rsplit('-',1)[-1]]})

    def point(p):
        return [float(p[k]+ANATOMY_TO_REAR_FRAME[k]) for k in range(3)]

    def add(name,parent,p,sources,label,method='mesh centre'):
        head = point(p)
        matrix = [[1.,0.,0.,head[0]],[0.,1.,0.,head[1]],[0.,0.,1.,head[2]],[0.,0.,0.,1.]]
        plan['joints'].append({'name':name,'parent':parent,'head':head,
                              'tail':[head[0],head[1]+length,head[2]], 'matrix':matrix,
                              'source_meshes':sources,'derivation':method,
                              'retained':False,'label':label})

    for name,parent,mesh,label in [
        ('spine-lumbar','pelvis','Cube.079','Spine'),
        ('spine-chest','spine-lumbar','Cube.031','Spine'),
        ('neck','spine-chest','Cube.024','Neck'),
        ('head','neck','Cube.043','Head')]:
        add(name,parent,meshes[mesh]['centre'],[mesh],label,'vertebral mesh centre')
    add('head-end','head',meshes['Cube.020']['centre'],['Cube.020'],'Head End','skull centre tip')

    # Left/right follow the preserved adapter after standing the source upright.
    # Two long-bone endpoints locate the elbow; paired radius/ulna locate wrist.
    for side,upper,lower,ulna,pedal in [
        ('left','Cube.090','Cube.091','Cube.092','Cube.016'),
        ('right','Cube.014','Cube.017','Cube.018','Cube.058')]:
        upper_ends = sorted(meshes[upper]['long_axis_ends'],key=lambda p:p[2])
        lower_ends = sorted(meshes[lower]['long_axis_ends'],key=lambda p:p[2])
        ulna_ends = sorted(meshes[ulna]['long_axis_ends'],key=lambda p:p[2])
        shoulder,elbow = upper_ends[0],mean([upper_ends[1],lower_ends[0],ulna_ends[0]])
        wrist = mean([lower_ends[1],ulna_ends[1]])
        prefix = f'forelimb-{side}'
        label_side = side.title()
        add(prefix+'-shoulder','spine-chest',shoulder,[upper],label_side+' Upper Arm','proximal long-axis endpoint')
        add(prefix+'-elbow',prefix+'-shoulder',elbow,[upper,lower,ulna],label_side+' Forearm','mean adjacent humerus/radius/ulna axis endpoints')
        add(prefix+'-wrist',prefix+'-elbow',wrist,[lower,ulna],label_side+' Hand','mean distal radius/ulna axis endpoints')
        add(prefix+'-toe',prefix+'-wrist',meshes[pedal]['centre'],[pedal],label_side+' Toe','pedal centre')
    for side,pedal in [('left','Cube.068'),('right','Cube.004')]:
        add(f'hindlimb-{side}-toe',f'hindlimb-{side}-hock',meshes[pedal]['centre'],[pedal],side.title()+' Toe','pedal centre')
    parent = 'pelvis'
    for i,mesh in enumerate(['Cube.006','Cube.008','Cube.054','Cube.053','Cube.010','Cube.050']):
        name = f'tail-{i+1}'
        add(name,parent,meshes[mesh]['centre'],[mesh],'Tail','caudal vertebral mesh centre')
        parent = name
    plan['face_pair'] = {'right':'hindlimb-right-hip','left':'hindlimb-left-hip','body_axis':False}
    plan['rest_rotation_for_gltf'] = 'x180'
    plan['model_joint_limit'] = {'maximum':71,'count':len(plan['joints'])}
    return validate_plan(plan)
