"""Capture actual pinned-source mesh conversion from retained decoder arrays; zero model calls."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import numpy as np
from slat_reference_admission import admit_decoder_reference

def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('repo-root', 'source-root', 'decoder-reference', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--expected-source', default='34a7a570d5d6d8b9c99bbddb1d52bd414600d5c6')
    args = parser.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    report = {'schema': 'trellis2.mesh-reference.v0', 'status': 'failed', 'phase': 'source',
        'modelCalls': 0, 'tensors': {}, 'inputHandoff': 'retained exact-source decoder arrays; not live sampler composition'}
    try:
        git = lambda folder, *parts: subprocess.check_output(['git', '-C', str(folder), *parts], text=True).strip()
        source, producer = args.source_root.resolve(), args.repo_root.resolve()
        for name, folder, expected in [('source', source, args.expected_source), ('producer', producer, args.expected_commit)]:
            report[name] = {'root': str(folder), 'commit': git(folder, 'rev-parse', 'HEAD'), 'dirty': git(folder, 'status', '--porcelain')}
            if report[name]['commit'] != expected or report[name]['dirty']: raise ValueError('clean exact ' + name + ' required')
        report['source']['files'] = {name: digest(source / name) for name in ('trellmlx/mesh_extract.py', 'trellmlx/source_cuda_ex2.py')}
        report['producer']['scriptSha256'] = digest(__file__)
        report['phase'] = 'decoder-input-admission'
        ref = args.decoder_reference.resolve(); manifest_path = ref / 'manifest.json'
        m, plan = admit_decoder_reference(manifest_path, producer)
        if plan['mode'] != 'shape' or m['source']['commit'] != args.expected_source:
            raise ValueError('complete matching actual-source learned shape decoder reference required')
        report['decoderReference'] = {'path': str(manifest_path), 'sha256': digest(manifest_path)}
        arrays = {}
        rows = m['outputRows']; resolution = m['outputResolution']
        for name, shape, dtype in [('features', [rows, 7], '<f4'), ('coordinates', [rows, 3], '<i4')]:
            descriptor = m['tensors']['expected.' + name]; file = (ref / descriptor['file']).resolve()
            if file.parent != ref or descriptor['shape'] != shape or file.stat().st_size != int(np.prod(shape)) * 4 or digest(file) != descriptor['sha256']:
                raise ValueError('complete hash-matched decoder ' + name + ' required')
            arrays[name] = np.fromfile(file, dtype=dtype).reshape(shape)
            report['tensors']['input.' + name] = {'path': str(file), 'sha256': descriptor['sha256'], 'shape': shape, 'dtype': dtype}
        if not np.isfinite(arrays['features']).all(): raise ValueError('finite learned geometry channels required')
        coordinates = arrays['coordinates']
        if np.any(coordinates < 0) or np.any(coordinates >= resolution) or len(np.unique(coordinates, axis=0)) != rows:
            raise ValueError('complete unique decoder-grid support required')
        sys.path.insert(0, str(source))
        import mlx.core as mx
        from trellmlx.mesh_extract import decoder_output_to_mesh
        if mx.default_device() != mx.gpu: raise ValueError('actual source mesh sigmoid GPU route required')
        report['effectiveRoute'] = 'pinned-MLX-source-CUDA-exp-sigmoid/NumPy-dual-grid-topology'
        report['device'] = str(mx.default_device()); report['resolution'] = resolution; report['voxelMargin'] = .5
        report['phase'] = 'source-mesh-conversion'
        batch_coordinates = np.zeros((rows, 4), dtype=np.int32); batch_coordinates[:, 1:] = coordinates
        vertices, faces = decoder_output_to_mesh(arrays['features'], batch_coordinates, resolution=resolution)
        if not np.isfinite(vertices).all() or (faces.size and (faces.min() < 0 or faces.max() >= len(vertices))):
            raise ValueError('invalid actual source mesh')
        if faces.size and faces.max() > np.iinfo(np.uint32).max: raise ValueError('GLB uint32 index format exceeded')
        for name, value in [('vertices', np.asarray(vertices, dtype='<f4')), ('triangles', np.asarray(faces, dtype='<u4'))]:
            file = args.out / (name + ('.f32' if name == 'vertices' else '.u32')); value.tofile(file)
            report['tensors'][name] = {'file': file.name, 'shape': list(value.shape), 'byteLength': value.nbytes, 'sha256': digest(file),
                'dtype': 'float32' if name == 'vertices' else 'uint32'}
        report['vertexCount'] = len(vertices); report['triangleCount'] = len(faces); report['surfaceEmpty'] = not len(faces)
        report['phase'] = 'post-source-admission'
        for name, folder in [('source', source), ('producer', producer)]:
            state = {'commit': git(folder, 'rev-parse', 'HEAD'), 'dirty': git(folder, 'status', '--porcelain')}; report[name + 'After'] = state
            if state['commit'] != report[name]['commit'] or state['dirty']: raise ValueError(name + ' changed during mesh conversion')
        report.update(status='succeeded', phase=None)
    except Exception as error: report['error'] = {'type': type(error).__name__, 'message': str(error)}
    finally:
        report['elapsedSeconds'] = time.perf_counter() - started
        (args.out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'phase': report['phase'], 'manifest': str(args.out / 'manifest.json'), 'error': report.get('error')}))
    return 0 if report['status'] == 'succeeded' else 1

if __name__ == '__main__': sys.exit(main())
