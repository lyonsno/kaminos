"""Provisional four-origin layout intervention; never anatomical certification."""
import copy
import math


ORIGINS = ('forelimb-left-shoulder', 'forelimb-right-shoulder',
           'hindlimb-left-hip', 'hindlimb-right-hip')


def average(points):
    return [sum(p[k] for p in points) / len(points) for k in range(3)]


def difference(a, b):
    return [a[k] - b[k] for k in range(3)]


def validate_layout(layout):
    positions, names = layout['positions'], layout['names']
    if len(names) != len(set(names)) or len(names) != len(positions):
        raise ValueError('invalid correspondence inventory')
    if not all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in positions):
        raise ValueError('positions must be finite three-vectors')
    indices = [layout['rootIndex'], *layout['fore'], *layout['hips']]
    if len(layout['fore']) != 2 or len(layout['hips']) != 2 or any(i < 0 or i >= len(names) for i in indices):
        raise ValueError('invalid origin correspondence')


def calibrate_attachment_layout(plan, source, reference):
    validate_layout(source)
    validate_layout(reference)
    by_name = {j['name']: j for j in plan['joints']}
    if len(by_name) != len(plan['joints']) or set(by_name) != set(source['names']):
        raise ValueError('plan/source correspondence differs')
    for index, name in enumerate(source['names']):
        joint = by_name[name]
        if not all(math.isfinite(v) for v in joint['head']+joint['tail']):
            raise ValueError('plan control positions must be finite')
        if 'parents' in source:
            parent_index = source['parents'][index]
            expected = None if parent_index < 0 else source['names'][parent_index]
            if joint['parent'] != expected:
                raise ValueError('plan/source parent correspondence differs')
    if [source['names'][i] for i in [*source['fore'], *source['hips']]] != list(ORIGINS):
        raise ValueError('unexpected origin correspondence')
    old_root = by_name[source['names'][source['rootIndex']]]['head']
    canonical_root = source['positions'][source['rootIndex']]
    # This exact source family uses inverted X and swapped/inverted Y/Z.
    # Measure its uniform scale, then verify every point; never infer a new frame.
    canonical_axes = (0, 2, 1)
    scales = []
    for axis, canonical_axis in enumerate(canonical_axes):
        index = max(range(len(source['names'])), key=lambda i: abs(by_name[source['names'][i]]['head'][axis] - old_root[axis]))
        delta = by_name[source['names'][index]]['head'][axis] - old_root[axis]
        if abs(delta) < 1e-10:
            raise ValueError('degenerate source frame')
        scales.append(-(source['positions'][index][canonical_axis] - canonical_root[canonical_axis]) / delta)
    scale = sum(scales) / 3
    if not math.isfinite(scale) or scale <= 0 or max(abs(s-scale) for s in scales) > 1e-6 * scale:
        raise ValueError('source frame is not the recorded uniform axis transform')
    for name, point in zip(source['names'], source['positions']):
        head = by_name[name]['head']
        for axis, canonical_axis in enumerate(canonical_axes):
            predicted = canonical_root[canonical_axis] - scale * (head[axis] - old_root[axis])
            if abs(predicted-point[canonical_axis]) > 1e-6:
                raise ValueError('plan/source frame mismatch')
    fore_centre = average([source['positions'][i] for i in source['fore']])
    ref_root = reference['positions'][reference['rootIndex']]
    ref_fore_centre = average([reference['positions'][i] for i in reference['fore']])
    ref_trunk = math.dist(ref_root, ref_fore_centre)
    if ref_trunk <= 1e-10:
        raise ValueError('degenerate reference frame')
    ratio = math.dist(canonical_root, fore_centre) / ref_trunk
    result = copy.deepcopy(plan)
    targets = []
    for index in reference['fore']:
        offset = difference(reference['positions'][index], ref_fore_centre)
        targets.append([fore_centre[k] + ratio * offset[k] for k in range(3)])
    for index in reference['hips']:
        offset = difference(reference['positions'][index], ref_root)
        targets.append([canonical_root[k] + ratio * offset[k] for k in range(3)])
    changed = []
    for name, point in zip(ORIGINS, targets):
        joint = next(j for j in result['joints'] if j['name'] == name)
        new_head = [old_root[k] - (point[canonical_axes[k]]-canonical_root[canonical_axes[k]]) / scale for k in range(3)]
        delta = difference(new_head, joint['head'])
        changed.append(dict(name=name, before=joint['head'], after=new_head, canonical_target=point))
        joint['head'] = new_head
        joint['tail'] = [joint['tail'][k] + delta[k] for k in range(3)]
        for k in range(3):
            joint['matrix'][k][3] = new_head[k]
        joint.update(retained=False, derivation='provisional reference-calibrated limb origin')
    result['authority'] = 'provisional attachment-layout experiment, not anatomical admission'
    result['attachment_intervention'] = dict(changed=changed, measured_source_scale=scale,
                                           reference_to_source_trunk_ratio=ratio,
                                           preserved='all other joints, parents, names and control-frame orientations')
    return result
