"""Recover the missing distal chains from a retained anatomy probe."""
import copy
import math


FOOT_MESHES = {
    'forelimb-left-toe': ['Cube.062', 'Cube.063', 'Cube.064', 'Cube.065'],
    'forelimb-right-toe': ['Cube.046', 'Cube.047', 'Cube.048', 'Cube.049'],
    'hindlimb-left-toe': ['Cube.081', 'Cube.082', 'Cube.084', 'Cube.085'],
    'hindlimb-right-toe': ['Cube.072', 'Cube.073', 'Cube.074', 'Cube.075'],
}


def complete_paws(plan, probe):
    if not probe.get('source_unchanged') or probe.get('source') != plan.get('source'):
        raise ValueError('plan/anatomy source mismatch')
    result = copy.deepcopy(plan)
    names = [j['name'] for j in result['joints']]
    meshes = {m['name']: m for m in probe['anatomy']}
    if len(set(names)) != len(names) or len(meshes) != len(probe['anatomy']):
        raise ValueError('duplicate source inventory')
    joints = {j['name']: j for j in result['joints']}

    def point(value):
        if len(value) != 3 or not all(isinstance(v, (float, int)) and math.isfinite(v) for v in value):
            raise ValueError('expected finite three-vector')
        return list(value)

    translation = point(plan['anatomy_to_rear_frame'])
    records = []
    for name, sources in FOOT_MESHES.items():
        if name not in joints or name+'-end' in joints or any(j['parent'] == name for j in joints.values()):
            raise ValueError('expected existing terminal toe: '+name)
        toe = joints[name]
        parent = joints[toe['parent']]
        parent_in_anatomy = [a-b for a,b in zip(point(parent['head']), translation)]
        proximal, distal = [], []
        for source in sources:
            if source not in meshes:
                raise ValueError('missing anatomy: '+source)
            ends = meshes[source]['long_axis_ends']
            if len(ends) != 2:
                raise ValueError('expected two phalanx endpoints')
            a, b = map(point, ends)
            if math.dist(a,b) <= 1e-8:
                raise ValueError('degenerate phalanx: '+source)
            # Endpoint order in the PCA probe is arbitrary. The endpoint nearest
            # this limb's retained wrist/hock is the proximal one.
            a, b = sorted([a,b], key=lambda p: (math.dist(p,parent_in_anatomy),p))
            proximal.append(a)
            distal.append(b)
        average = lambda points: [sum(p[k] for p in points)/len(points)+translation[k] for k in range(3)]
        base, tip = average(proximal), average(distal)
        if math.dist(base,tip) <= 1e-8:
            raise ValueError('degenerate representative toe')
        old_head = point(toe['head'])
        control_delta = [a-b for a,b in zip(point(toe['tail']),old_head)]
        toe.update(head=base, tail=tip, source_meshes=sources[:], retained=False,
                   derivation='mean proximal phalanx PCA endpoints; nearest retained wrist/hock')
        for row, value in zip(toe['matrix'][:3],base):
            row[3] = value
        endpoint = copy.deepcopy(toe)
        endpoint.update(name=name+'-end', parent=name, head=tip,
                        tail=[a+b for a,b in zip(tip,control_delta)],
                        label=toe['label']+' End',
                        derivation='mean distal phalanx PCA endpoints')
        for row, value in zip(endpoint['matrix'][:3],tip):
            row[3] = value
        result['joints'].append(endpoint)
        records.append(dict(name=name, source_meshes=sources[:], old_head=old_head,
                            proximal=base, distal=tip))
    result['model_joint_limit']['count'] = len(result['joints'])
    if len(result['joints']) > result['model_joint_limit']['maximum']:
        raise ValueError('model joint capacity exceeded')
    result['paw_intervention'] = dict(
        kind='source-phalanges-representative-chain.v1', feet=records,
        scope='four relocated toe pivots and four new toe-end children; all other joints unchanged',
        authority='agent-derived source landmarks for operator inspection; not anatomical certification')
    return result
