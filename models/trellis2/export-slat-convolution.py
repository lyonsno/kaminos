"""Capture one actual sparse convolution from the preserved half projection."""
import argparse
import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import shutil
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
    for name in ('repo-root', 'source-root', 'reference', 'projection', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ('expected-commit', 'reference-sha256', 'projection-sha256'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.slat-convolution-reference.v0', 'status': 'failed', 'phase': 'parent-reference',
        'referenceRoute': 'pinned-MLX-GPU-SLat-first-convolution/F16-per-offset', 'operationCalls': 0,
        'fullDecoderCalls': 0, 'tensors': {},
        'inputHandoff': 'complete retained exact half projection/coordinates/weights; diagnostic, not live composition'}
    started = time.perf_counter()
    try:
        parent_path = args.reference.resolve() / 'manifest.json'
        projection_path = args.projection.resolve() / 'manifest.json'
        if digest(parent_path) != args.reference_sha256: raise ValueError('exact named parent reference required')
        report['phase'] = 'projection-reference'
        if digest(projection_path) != args.projection_sha256: raise ValueError('exact named projection reference required')
        parent, plan = admit_decoder_reference(parent_path, args.repo_root, projection_path)
        projection = json.loads(projection_path.read_bytes())
        if projection['parentReference']['sha256'] != args.reference_sha256:
            raise ValueError('projection must belong to the exact named parent')
        for name, path, expected in [('parentReference', parent_path, args.reference_sha256),
                                     ('projectionReference', projection_path, args.projection_sha256)]:
            target = args.out / ('parent-manifest.json' if name == 'parentReference' else 'projection-manifest.json')
            shutil.copyfile(path, target)
            if digest(target) != expected: raise ValueError('reference changed during capture')
            report[name] = {'file': target.name, 'sha256': expected, 'path': str(path)}
        report['phase'] = 'source-admission'
        git = lambda folder, *parts: subprocess.check_output(['git', '-C', str(folder), *parts], text=True).strip()
        source, producer = args.source_root.resolve(), args.repo_root.resolve()
        for name, folder, expected in [('source', source, parent['source']['commit']), ('producer', producer, args.expected_commit)]:
            report[name] = {'root': str(folder), 'commit': git(folder, 'rev-parse', 'HEAD'), 'dirty': git(folder, 'status', '--porcelain')}
            if report[name]['commit'] != expected or report[name]['dirty']: raise ValueError('clean exact ' + name + ' required')
        source_module = source / 'trellmlx/modules/sparse_conv.py'
        report['source']['convolutionModuleSha256'] = digest(source_module)
        if report['source']['convolutionModuleSha256'] != parent['source']['trellmlx/modules/sparse_conv.py']:
            raise ValueError('unchanged actual source convolution module required')
        report['producer']['scriptSha256'] = digest(__file__)
        report['phase'] = 'tensor-admission'; values = {}
        inputs = {'input': (projection_path.parent, projection['tensors']['expected.f16']),
            **{name: (parent_path.parent, parent['tensors'][name]) for name in
                ('coordinates', 'weight.blocks.0.0.conv.weight', 'weight.blocks.0.0.conv.bias')}}
        for name, (folder, row) in inputs.items():
            file = (folder / row['file']).resolve()
            if file.parent != folder or file.stat().st_size != row['byteLength'] or digest(file) != row['sha256']:
                raise ValueError('complete matching convolution input ' + name + ' required')
            integer = name == 'coordinates'
            value = np.fromfile(file, dtype='<i4' if integer else '<f4').reshape(row['shape'])
            if not integer and (not np.isfinite(value).all() or not np.array_equal(value, value.astype(np.float16).astype(np.float32))):
                raise ValueError('finite exactly half-representable convolution input required')
            target = args.out / (name + ('.i32' if integer else '.f32')); shutil.copyfile(file, target)
            if digest(target) != row['sha256']: raise ValueError('convolution input changed during copy')
            values[name] = value; report['tensors'][name] = {**row, 'file': target.name}
        rows, channels, resolution = plan['tokenRows'], plan['channels'][0], plan['resolution']
        coordinates = values['coordinates']
        if (coordinates < 0).any() or (coordinates >= resolution).any() or len(np.unique(coordinates, axis=0)) != rows:
            raise ValueError('complete unique in-grid coordinates required')
        sys.path.insert(0, str(source))
        import mlx.core as mx
        from trellmlx.modules.sparse_conv import SparseConv3d, build_neighbor_map, SPARSE_CONV_MATMUL_BACKEND_ENV
        backend = os.environ.get(SPARSE_CONV_MATMUL_BACKEND_ENV, 'native').lower()
        if mx.default_device() != mx.gpu or backend != 'native': raise ValueError('actual native MLX GPU convolution route required')
        conv = SparseConv3d(channels, channels)
        conv.load_weights([('weight', mx.array(values['weight.blocks.0.0.conv.weight'], dtype=mx.float16)),
                           ('bias', mx.array(values['weight.blocks.0.0.conv.bias'], dtype=mx.float16))])
        features = mx.array(values['input'], dtype=mx.float16)
        if conv.weight.dtype != mx.float16 or conv.bias.dtype != mx.float16 or features.dtype != mx.float16:
            raise ValueError('unchanged source half precision required')
        report['effectiveBackend'] = {'device': str(mx.default_device()), 'operation': 'actual SparseConv3d.__call__',
            'neighborBuilder': 'actual build_neighbor_map', 'neighborExecution': 'source CPU map returned as MLX arrays',
            'arithmetic': 'source-F16-per-offset-matmul-scatter-add-bias', 'sparseConvMatmulBackend': backend,
            'mlxVersion': importlib.metadata.version('mlx'), 'convolutionClassFile': inspect.getfile(SparseConv3d),
            'convolutionClassSha256': digest(inspect.getfile(SparseConv3d))}
        report['phase'] = 'source-neighbors'
        batch_coordinates = np.concatenate([np.zeros((rows, 1), dtype=np.int32), coordinates], axis=1)
        neighbors = build_neighbor_map(mx.array(batch_coordinates), 3)
        src, tgt, offsets = [np.asarray(value, dtype=np.int32) for value in neighbors]
        if not (src.shape == tgt.shape == offsets.shape) or src.ndim != 1 or not len(src):
            raise ValueError('complete actual source neighbor edges required')
        if (src < 0).any() or (src >= rows).any() or (tgt < 0).any() or (tgt >= rows).any() or (offsets < 0).any() or (offsets >= 27).any():
            raise ValueError('actual source neighbor edge out of range')
        pairs = tgt.astype(np.int64) * 27 + offsets
        if len(np.unique(pairs)) != len(pairs): raise ValueError('ambiguous duplicate source neighbor pairs')
        dense = np.full((rows, 27), -1, dtype='<i4'); dense[tgt, offsets] = src
        report['sourceNeighborEdges'] = len(src)
        report['phase'] = 'source-convolution'; report['operationCalls'] = 1
        output = conv(features, neighbors); mx.eval(output)
        if output.dtype != mx.float16: raise ValueError('source convolution silently changed dtype')
        value = np.asarray(output, dtype='<f4', order='C')
        if value.shape != (rows, channels) or not np.isfinite(value).all(): raise ValueError('complete finite source convolution output required')
        report['phase'] = 'observation-retention'
        for name, array, integer in [('neighbors', dense, True), ('convolution', value, False)]:
            file = args.out / ('expected.' + name + ('.i32' if integer else '.f32')); array.tofile(file)
            report['tensors']['expected.' + name] = {'file': file.name, 'shape': list(array.shape),
                'dtype': 'int32' if integer else 'float32', 'sourceDtype': 'int32' if integer else 'float16',
                'byteLength': array.nbytes, 'sha256': digest(file)}
        report['phase'] = 'post-source-admission'
        for name, folder in [('source', source), ('producer', producer)]:
            state = {'commit': git(folder, 'rev-parse', 'HEAD'), 'dirty': git(folder, 'status', '--porcelain')}; report[name + 'After'] = state
            if state['commit'] != report[name]['commit'] or state['dirty']: raise ValueError(name + ' changed during capture')
        report.update(status='succeeded', phase=None)
    except Exception as error: report['error'] = {'type': type(error).__name__, 'message': str(error)}
    finally:
        report['elapsedSeconds'] = time.perf_counter() - started
        (args.out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'phase': report['phase'], 'manifest': str(args.out / 'manifest.json'), 'error': report.get('error')}))
    return 0 if report['status'] == 'succeeded' else 1

if __name__ == '__main__': sys.exit(main())
