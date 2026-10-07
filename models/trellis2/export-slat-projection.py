"""Capture the actual first decoder projection and cast; zero full decoder calls."""
import argparse
import hashlib
import importlib.metadata
import inspect
import json
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
    for name in ('repo-root', 'source-root', 'reference', 'out'): parser.add_argument('--' + name, type=Path, required=True)
    for name in ('expected-commit', 'reference-sha256'): parser.add_argument('--' + name, required=True)
    args = parser.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.slat-projection-reference.v0', 'status': 'failed', 'phase': 'parent-reference',
        'referenceRoute': 'pinned-MLX-GPU-SLat-from_latent/F32-then-F16', 'operationCalls': 0, 'fullDecoderCalls': 0, 'tensors': {},
        'inputHandoff': 'complete retained source codes and weights; diagnostic operation, not live sampler composition'}
    started = time.perf_counter()
    try:
        parent_path = args.reference.resolve() / 'manifest.json'
        if digest(parent_path) != args.reference_sha256: raise ValueError('exact named parent reference required')
        m, plan = admit_decoder_reference(parent_path, args.repo_root)
        copied_parent = args.out / 'parent-manifest.json'; shutil.copyfile(parent_path, copied_parent)
        if digest(copied_parent) != args.reference_sha256: raise ValueError('parent reference changed during capture')
        report['parentReference'] = {'file': copied_parent.name, 'sha256': args.reference_sha256, 'path': str(parent_path)}
        report['phase'] = 'source-admission'
        git = lambda folder, *parts: subprocess.check_output(['git', '-C', str(folder), *parts], text=True).strip()
        source, producer = args.source_root.resolve(), args.repo_root.resolve()
        for name, folder, expected in [('source', source, m['source']['commit']), ('producer', producer, args.expected_commit)]:
            report[name] = {'root': str(folder), 'commit': git(folder, 'rev-parse', 'HEAD'), 'dirty': git(folder, 'status', '--porcelain')}
            if report[name]['commit'] != expected or report[name]['dirty']: raise ValueError('clean exact ' + name + ' required')
        report['source']['modelSha256'] = digest(source / 'trellmlx/models/shape_slat_decoder.py')
        report['producer']['scriptSha256'] = digest(__file__)
        report['phase'] = 'tensor-admission'; values = {}
        for name in ('sample', 'weight.from_latent.weight', 'weight.from_latent.bias'):
            row = m['tensors'][name]; file = (parent_path.parent / row['file']).resolve()
            if file.parent != parent_path.parent or file.stat().st_size != row['byteLength'] or digest(file) != row['sha256']:
                raise ValueError('complete matching projection input ' + name + ' required')
            value = np.fromfile(file, dtype='<f4').reshape(row['shape'])
            if not np.isfinite(value).all(): raise ValueError('finite projection input required')
            target = args.out / row['file']; shutil.copyfile(file, target)
            if digest(target) != row['sha256']: raise ValueError('projection input changed during copy')
            values[name] = value; report['tensors'][name] = dict(row)
        sys.path.insert(0, str(source))
        import mlx.core as mx
        from trellmlx.models.shape_slat_decoder import SLatDecoder
        if mx.default_device() != mx.gpu: raise ValueError('actual MLX GPU projection route required')
        model = SLatDecoder(out_channels=7, latent_channels=plan['latentChannels'], model_channels=[plan['channels'][0]],
            num_blocks=[0], pred_subdiv=True, use_fp16=True)
        # Only the authenticated endpoint is loaded and called. Unused torso
        # and output-layer initialization is not a model/reference execution.
        model.from_latent.load_weights([('weight', mx.array(values['weight.from_latent.weight'])),
            ('bias', mx.array(values['weight.from_latent.bias']))])
        if model.from_latent.weight.dtype != mx.float32 or model.from_latent.bias.dtype != mx.float32:
            raise ValueError('unchanged F32 endpoint precision required')
        report['effectiveBackend'] = {'device': str(mx.default_device()), 'operation': 'actual SLatDecoder.from_latent + astype(float16)',
            'arithmetic': 'F32-addmm-then-F16-cast', 'mlxVersion': importlib.metadata.version('mlx'),
            'linearClassFile': inspect.getfile(type(model.from_latent)), 'linearClassSha256': digest(inspect.getfile(type(model.from_latent)))}
        report['phase'] = 'source-from-latent'; report['operationCalls'] = 1
        f32 = model.from_latent(mx.array(values['sample'])); mx.eval(f32)
        if f32.dtype != mx.float32: raise ValueError('source projection silently changed dtype')
        f16 = f32.astype(mx.float16); mx.eval(f16)
        report['phase'] = 'observation-retention'
        for name, output in [('f32', f32), ('f16', f16)]:
            value = np.asarray(output, dtype='<f4', order='C')
            if value.shape != (plan['tokenRows'], plan['channels'][0]) or not np.isfinite(value).all():
                raise ValueError('complete finite source projection output required')
            file = args.out / ('expected.' + name + '.f32'); value.tofile(file)
            report['tensors']['expected.' + name] = {'file': file.name, 'shape': list(value.shape), 'dtype': 'float32',
                'sourceDtype': 'float32' if name == 'f32' else 'float16', 'byteLength': value.nbytes, 'sha256': digest(file)}
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
