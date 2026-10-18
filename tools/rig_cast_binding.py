"""Preserve two cast registrations and reuse the existing automatic binder.

Run the whole command through Greenroom: Blender imports each source without
saving it, then NumPy constructs the unchanged surface-geodesic attachment.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
import numpy as np


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def authenticate_record(record):
    path = Path(record['path']).resolve()
    if not path.is_file():
        raise ValueError('missing source: '+str(path))
    if not re.fullmatch('[0-9a-f]{64}', record.get('sha256', '')) or digest(path) != record['sha256']:
        raise ValueError('source digest mismatch: '+str(path))
    return path


def affine(value, label):
    matrix = np.asarray(value, dtype=float)
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all() or not np.array_equal(matrix[3], [0, 0, 0, 1]):
        raise ValueError('invalid '+label+' matrix')
    return matrix


def derive_frame(rig, original):
    transform = affine(original['sourceArmatureLocalToNormalized'], 'source normalization')
    joints = {j['name']: j for j in rig['joints']}
    if len(joints) != len(rig['joints']):
        raise ValueError('duplicate generating joint')
    result = copy.deepcopy(original)
    known = {b['name'] for b in original['bones']}
    for bone in original['bones']:
        name = bone['name']
        if name not in joints:
            raise ValueError('missing base joint: '+name)
        source = joints[name]
        if source['parent'] != bone['parent']:
            raise ValueError('changed base parent: '+name)
        head = transform@np.r_[np.asarray(source['head'], dtype=float), 1]
        expected = affine(bone['restMatrix'], 'base rest')[:3, 3]
        if not np.isfinite(head).all() or np.max(np.abs(head[:3]-expected)) > 1e-5:
            raise ValueError('changed base head: '+name)
    pending = [j for j in rig['joints'] if j['name'] not in known]
    while pending:
        available = next((i for i, j in enumerate(pending) if j['parent'] in known), None)
        if available is None:
            raise ValueError('unresolved or cyclic generating descendant')
        source = pending.pop(available)
        if source.get('provisional') is not True:
            raise ValueError('extra joint is not declared provisional')
        parent = next(b for b in result['bones'] if b['name'] == source['parent'])
        matrix = affine(parent['restMatrix'], 'parent rest').copy()
        head = transform@np.r_[np.asarray(source['head'], dtype=float), 1]
        if not np.isfinite(head).all():
            raise ValueError('nonfinite descendant head')
        matrix[:3, 3] = head[:3]
        result['bones'].append({'name': source['name'], 'parent': source['parent'], 'restMatrix': matrix.tolist()})
        known.add(source['name'])
    result['scope'] = 'exact generating base rig plus provisional fixed-local-rest toe descendants; no corrected-paw pivot transplant'
    return result


def cast_to_normalized(vertices, registration, original):
    vertices = np.asarray(vertices, dtype=float)
    rotation = np.asarray(registration['rotation'], dtype=float)
    translation = np.asarray(registration['translation'], dtype=float)
    scale = registration['scale']
    if (vertices.ndim != 2 or vertices.shape[1] != 3 or not len(vertices) or not np.isfinite(vertices).all()
            or not isinstance(scale, (float, int)) or not np.isfinite(scale) or scale <= 0
            or rotation.shape != (3, 3) or not np.isfinite(rotation).all()
            or not np.allclose(rotation.T@rotation, np.eye(3), atol=1e-7) or np.linalg.det(rotation) <= 0
            or translation.shape != (3,) or not np.isfinite(translation).all()):
        raise ValueError('invalid saved registration or cast positions')
    saved = np.eye(4); saved[:3, :3] = scale*rotation; saved[:3, 3] = translation
    # Ghost's registration consumes Blender imported world coordinates, not raw
    # GLB accessor coordinates. Its target was the source rig flipped about Y.
    flip = np.diag([-1., 1., -1., 1.])
    matrix = affine(original['sourceArmatureLocalToNormalized'], 'normalization')@flip@saved
    return vertices@matrix[:3, :3].T+matrix[:3, 3], matrix.tolist()


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2)+'\n')


def build(args):
    inputs_path = Path(args.inputs).resolve(); out = Path(args.out).resolve(); report_path = Path(args.report).resolve()
    report = {'status': 'running', 'phase': 'input-discovery', 'requested': vars(args), 'casts': []}
    protected = [inputs_path]
    safe_report = report_path != inputs_path and not report_path.is_symlink()
    try:
        if report_path == out or out in report_path.parents:
            safe_report = False
            raise ValueError('report requires an independent destination outside the generated package')
        state = json.loads(inputs_path.read_text())
        records = [state['rig'], state['baseFrame'], *state['binderFiles'],
                   *[record for row in state['casts'] for record in [row['cast'], row['registration']]]]
        protected += [Path(r['path']).resolve() for r in records]
        if report_path in protected or out in [p.parent for p in protected] or any(out == p or out in p.parents for p in protected):
            safe_report = report_path not in protected
            raise ValueError('output overlaps retained sources')
        safe_report = safe_report and (not report_path.exists() or report_path.stat().st_nlink == 1)
        if state.get('schema') != 'kaminos.rig-cast-bind-inputs.v1':
            raise ValueError('unknown input schema')
        if out.exists() and any(out.iterdir()):
            raise ValueError('preserve nonempty output directory')
        report['phase'] = 'authentication'
        for record in records:
            authenticate_record(record)
        report['inputs'] = {str(p): digest(p) for p in protected}
        rig = json.loads(Path(state['rig']['path']).read_text())
        original = json.loads(Path(state['baseFrame']['path']).read_text())
        frame = derive_frame(rig, original)
        out.mkdir(parents=True, exist_ok=True)
        write_json(out/'frame.json', frame)
        report['phase'] = 'blender-import'
        extract = out/'extracted'
        command = [args.blender, '--background', '--factory-startup', '--python', str(Path(__file__).with_name('rig_cast_extract.py')),
                   '--', '--inputs', str(inputs_path), '--out', str(extract)]
        with (out/'blender.stdout.log').open('w') as stdout, (out/'blender.stderr.log').open('w') as stderr:
            result = subprocess.run(command, stdout=stdout, stderr=stderr)
        inventory = json.loads((extract/'report.json').read_text())
        report['blender'] = inventory
        if result.returncode or inventory['status'] != 'completed':
            raise ValueError('Blender extraction failed')
        binder_root = Path(state['binderFiles'][0]['path']).resolve().parent
        if {Path(r['path']).name for r in state['binderFiles']} != {'full-creature-binding.py', 'hindquarter_binding.py', 'trunk_anchors.py'}:
            raise ValueError('incomplete retained binder source inventory')
        if any(Path(r['path']).resolve().parent != binder_root for r in state['binderFiles']):
            raise ValueError('binder source files must share their explicit source root')
        sys.path.insert(0, str(binder_root))
        spec = importlib.util.spec_from_file_location('retained_full_binding', binder_root/'full-creature-binding.py')
        full = importlib.util.module_from_spec(spec); spec.loader.exec_module(full)
        for row in state['casts']:
            slug = row['slug']
            if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', slug):
                raise ValueError('invalid cast slug')
            report['phase'] = 'automatic-binding-'+slug
            geometry = np.load(extract/(slug+'.npz'))
            if set(geometry.files) != {'positions', 'triangles'}:
                raise ValueError('non-geometry source fields')
            registration = json.loads(Path(row['registration']['path']).read_text())
            if Path(registration['cast']).resolve() != Path(row['cast']['path']).resolve():
                raise ValueError('registration belongs to a different cast')
            points, chain = cast_to_normalized(geometry['positions'], registration, original)
            triangles = geometry['triangles']
            control = {'paintedWeightsIncluded': False, 'domainMethod': 'surface', 'surfaceConnectivity': 'coincident', 'articulated': True,
                       'joints': {b['name']: np.asarray(b['restMatrix'])[:3, 3].tolist() for b in frame['bones']},
                       'bounds': {'min': points.min(axis=0).tolist(), 'max': points.max(axis=0).tolist()}}
            rear = full.bind_geometry(points, triangles, control)
            binding = full.distributed_trunk_weights(points, triangles, rear['edges'], rear['jointWeights'], frame['bones'])
            weights = binding['weights'].astype('<f4')
            if not np.isfinite(weights).all() or (weights < 0).any() or not np.allclose(weights.sum(axis=1), 1, atol=1e-6):
                raise ValueError('invalid automatic influence partition')
            leaf = out/slug; leaf.mkdir(exist_ok=False)
            arrays = {'rest.bin': points.astype('<f4'), 'triangles.bin': triangles.astype('<u4'),
                      'automatic-weights.bin': weights, 'automatic-presets.bin': points.astype('<f4')[None]}
            assets = {}
            for name, array in arrays.items():
                path = leaf/name; array.tofile(path)
                assets[name] = {'sha256': digest(path), 'bytes': path.stat().st_size, 'shape': list(array.shape), 'dtype': array.dtype.str}
            manifest = {'schema': 'kaminos.live-transport.v3', 'status': 'completed', 'sourceSha256': row['cast']['sha256'],
                        'sourceCast': row['label'], 'sourceArmature': 'source28 plus8 provisional toe descendants',
                        'vertices': len(points), 'triangles': len(triangles), 'bones': frame['bones'], 'channels': binding['channels'],
                        'presets': [{'name': 'neutral', 'poseWxyz': {}, 'palette': full.palette(frame['bones'], {}).tolist()}],
                        'assets': assets, 'candidatePaintedWeights': False,
                        'reference': {'kind': 'none', 'reason': 'Independent rig-generated cast, no admitted expert paint'},
                        'bindingRule': {k: v for k, v in binding.items() if k not in ['weights', 'channels']},
                        'provenance': {'packageSha256': digest(inputs_path), 'rigSourceSha256': state['rig']['sha256'], 'frameChainSha256': digest(out/'frame.json')},
                        'registration': {'source': row['registration'], 'castBlenderWorldToNormalized': chain, 'refit': False},
                        'scope': 'two retained casts, automatic attachment and derived source28 motion; not learned36 motion, contact or anatomy admission'}
            write_json(leaf/'manifest.json', manifest)
            report['casts'].append({'slug': slug, 'label': row['label'], 'path': str(leaf), 'sha256': digest(leaf/'manifest.json'),
                                    'vertices': len(points), 'triangles': len(triangles), 'bones': len(frame['bones']),
                                    'sourceCast': row['cast'], 'savedRegistration': row['registration'], 'castBlenderWorldToNormalized': chain,
                                    'unknownVertices': len(binding['unknownVertices']), 'registrationRefit': False,
                                    'topologyPreserved': np.array_equal(triangles, arrays['triangles.bin'])})
            write_json(report_path, report)
        if report['inputs'] != {str(p): digest(p) for p in protected}:
            raise ValueError('retained input changed during binding')
        report.update(status='completed', phase='complete', effectiveSolver='retained distributed-trunk surface-geodesic automatic influences',
                      frame={'path': str(out/'frame.json'), 'sha256': digest(out/'frame.json')})
    except Exception as error:
        report.update(status='failed', error=repr(error))
        raise
    finally:
        if safe_report:
            write_json(report_path, report)
        else:
            print(json.dumps({**report, 'reportWriteRefused': True}), file=sys.stderr)
    print(json.dumps({'status': report['status'], 'phase': report['phase'], 'casts': report['casts']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['inputs', 'out', 'report', 'blender']:
        parser.add_argument('--'+name, required=True)
    build(parser.parse_args())
