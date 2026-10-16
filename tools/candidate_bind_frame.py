"""Relate a separate candidate tree to a retained cast's geometry frame."""
import copy
import math


def transform(matrix, point):
    return [sum(matrix[k][a]*point[a] for a in range(3))+matrix[k][3] for k in range(3)]


def similarity_scale(matrix):
    if len(matrix) != 4 or any(len(r) != 4 or not all(math.isfinite(x) for x in r) for r in matrix):
        raise ValueError('invalid geometry frame')
    if matrix[3] != [0, 0, 0, 1]:
        raise ValueError('invalid affine geometry frame')
    columns = [[matrix[k][a] for k in range(3)] for a in range(3)]
    scale = math.sqrt(sum(x*x for x in columns[0]))
    if scale <= 0 or any(abs(sum(x*x for x in c)-scale*scale) > scale*scale*1e-5 for c in columns):
        raise ValueError('geometry frame is not uniform')
    if any(abs(sum(x*y for x, y in zip(columns[a], columns[b]))) > scale*scale*1e-5 for a in range(3) for b in range(a)):
        raise ValueError('geometry frame is not orthogonal')
    a, b, c = columns
    det = a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1])
    if det <= 0:
        raise ValueError('geometry frame reflects the creature')
    return scale


def derive_frame(original_plan, candidate_plan, original_frame, control, names, parents, positions):
    old = {j['name']: j for j in original_plan['joints']}
    new = {j['name']: j for j in candidate_plan['joints']}
    bones = {b['name']: b for b in original_frame['bones']}
    if (len(set(names)) != len(names) or len(new) != len(candidate_plan['joints'])
            or set(new) != set(names) or set(old) != set(bones) or not set(old).issubset(new)
            or len(old) != len(original_plan['joints']) or len(bones) != len(original_frame['bones'])):
        raise ValueError('candidate/original inventory mismatch')
    if len(parents) != len(names) or len(positions) != len(names):
        raise ValueError('canonical inventory mismatch')
    if sum(p == -1 for p in parents) != 1:
        raise ValueError('canonical parent root mismatch')
    for i, name in enumerate(names):
        p = parents[i]
        if not isinstance(p, int) or p < -1 or p >= i:
            raise ValueError('canonical parent order mismatch')
        expected = None if p < 0 else names[p]
        if new[name]['parent'] != expected or any(x[name]['parent'] != expected for x in [old,bones] if name in x):
            raise ValueError('candidate/original parent mismatch')
        for j in [x[name] for x in [old,new] if name in x]:
            if any(len(j[k]) != 3 or not all(math.isfinite(v) for v in j[k]) for k in ['head', 'tail']):
                raise ValueError('nonfinite plan position')
        expected_axes = old[name]['matrix'] if name in old else [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]
        if [r[:3] for r in new[name]['matrix'][:3]] != [r[:3] for r in expected_axes[:3]]:
            raise ValueError('candidate control orientation changed')
        if len(positions[i]) != 3 or not all(math.isfinite(v) for v in positions[i]):
            raise ValueError('nonfinite canonical position')
    geometry = original_frame['sourceArmatureLocalToNormalized']
    geometry_scale = similarity_scale(geometry)
    for name in old:
        expected = transform(geometry, old[name]['head'])
        if math.dist(expected, [r[3] for r in bones[name]['restMatrix'][:3]]) > 1e-5:
            raise ValueError('original plan/frame position mismatch')
    # The observed source family has -X,-Z,-Y canonical axes. Measure its
    # new diameter normalization, then require all candidate heads to agree.
    root = parents.index(-1)
    source_root, canonical_root = new[names[root]]['head'], positions[root]
    axes = [0, 2, 1]
    scales = []
    for a, k in enumerate(axes):
        i = max(range(len(names)), key=lambda i: abs(new[names[i]]['head'][a]-source_root[a]))
        delta = new[names[i]]['head'][a]-source_root[a]
        if abs(delta) < 1e-10:
            raise ValueError('degenerate canonical frame')
        scales.append(-(positions[i][k]-canonical_root[k])/delta)
    scale = sum(scales)/3
    if not math.isfinite(scale) or scale <= 0 or any(abs(s/scale-1) > 1e-5 for s in scales):
        raise ValueError('canonical frame is not the recorded axis similarity')
    inverse = [[0., 0., 0., 0.] for _ in range(4)]
    for a, k in enumerate(axes):
        inverse[a][k] = -1/scale
        inverse[a][3] = source_root[a]+canonical_root[k]/scale
    inverse[3][3] = 1
    conversion = [[sum(geometry[k][a]*inverse[a][j] for a in range(4)) for j in range(4)] for k in range(4)]
    similarity_scale(conversion)
    result_bones, errors = [], []
    for name, point in zip(names, positions):
        b = copy.deepcopy(bones[name]) if name in bones else {
            'name':name,'parent':new[name]['parent'],
            'restMatrix':[[*(geometry[k][a]/geometry_scale for a in range(3)),0.] for k in range(3)]+[[0.,0.,0.,1.]],
            'retainedRear':False}
        head = transform(geometry, new[name]['head'])
        for k in range(3):
            b['restMatrix'][k][3] = head[k]
        b['tail'] = transform(geometry, new[name]['tail'])
        b['retainedRear'] = bool(b.get('retainedRear')) and name in old and new[name]['head'] == old[name]['head']
        error = math.dist(transform(conversion, point), head)
        if error > 1e-5:
            raise ValueError('canonical candidate head mismatch')
        errors.append({'name': name, 'residualSourceNormalized': error})
        result_bones.append(b)
    frame = {'schema': 'kaminos.full-given-rig-frame.v1', 'source': {},
             'sourceArmatureLocalToNormalized': copy.deepcopy(geometry),
             'canonicalWorldToSourceNormalized': conversion, 'bones': result_bones,
             'canonicalRestHeadErrors': errors, 'measuredCanonicalScale': scale,
             'scope': 'separate candidate rest tree in retained cast geometry frame; no old rear-bind or painted-reference equivalence'}
    new_control = copy.deepcopy(control)
    new_control['joints'] = {name: [r[3] for r in next(b for b in result_bones if b['name'] == name)['restMatrix'][:3]] for name in control['joints']}
    new_control['frames'] = []
    new_control.pop('reference', None)
    new_control['referenceRoute'] = {'kind': 'none', 'reason': 'Edited joint origins invalidate old painted pose comparator'}
    new_control['scope'] = frame['scope']
    return frame, new_control

