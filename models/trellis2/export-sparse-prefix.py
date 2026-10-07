"""Export one reusable sparse-flow prefix reference; never run DINO or the torso.

Reads only the eight prefix checkpoint tensors. Native source input projection
is evaluated on MLX CPU; timestep modulation uses the pinned source's NumPy
implementation. This observer is separate from browser execution.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import time

import numpy as np


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def model_timestep_from_sampler_capture(timestep):
    """FlowEuler stores normalized t; sparse model receives float32 1000*t."""
    values = np.asarray(timestep)
    if values.size != 1 or not np.isfinite(values).all():
        raise ValueError('sampler capture must contain one finite normalized timestep')
    # Match the source's Python-scalar multiplication before its float32 cast.
    return np.array([1000 * float(values.reshape(-1)[0])], dtype=np.float32)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root', type=Path, required=True)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--sample', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report_path = args.out / 'manifest.json'
    report = {'schema': 'trellis2.sparse-prefix-reference.v0', 'status': 'failed',
              'phase': 'source', 'config': {'resolution': 16, 'inChannels': 8,
              'channels': 1536, 'frequencyDim': 256}, 'tensors': {},
              'referenceRoute': 'pinned-MLX-CPU-input-linear/source-NumPy-timestep/bf16-final-casts',
              'fullModelExecutions': 0}
    start = time.perf_counter()
    try:
        root = args.source_root.resolve()
        git = lambda *a: subprocess.check_output(['git', '-C', str(root), *a], text=True).strip()
        report['source'] = {'root': str(root), 'commit': git('rev-parse', 'HEAD'),
                            'dirty': git('status', '--porcelain')}
        if report['source']['dirty']:
            raise ValueError('reference source worktree must be clean')
        report['checkpoint'] = {'path': str(args.checkpoint.resolve()), 'sha256': digest(args.checkpoint)}
        report['sample'] = {'path': str(args.sample.resolve()), 'sha256': digest(args.sample)}
        for file in ('trellmlx/models/sparse_structure_flow.py', 'trellmlx/weight_loader.py',
                     'trellmlx/samplers.py'):
            report['source'][file] = digest(root / file)
        sys.path.insert(0, str(root))
        import mlx.core as mx
        import mlx.nn as nn
        from trellmlx.models.sparse_structure_flow import TimestepEmbedder, _source_shared_modulation
        report['phase'] = 'checkpoint-tensor-export'
        with args.checkpoint.open('rb') as f:
            header_size = struct.unpack('<Q', f.read(8))[0]
            header = json.loads(f.read(header_size))
            base = 8 + header_size
            mapping = {'input.weight': 'input_layer.weight', 'input.bias': 'input_layer.bias',
                       'time0.weight': 't_embedder.mlp.0.weight', 'time0.bias': 't_embedder.mlp.0.bias',
                       'time2.weight': 't_embedder.mlp.2.weight', 'time2.bias': 't_embedder.mlp.2.bias',
                       'mod.weight': 'adaLN_modulation.1.weight', 'mod.bias': 'adaLN_modulation.1.bias'}
            weights = {}
            def save(name, values, **extra):
                values = np.asarray(values, dtype='<f4', order='C')
                if not np.isfinite(values).all():
                    raise ValueError(f'{name}: non-finite tensor')
                file = args.out / f'{name}.f32'
                values.tofile(file)
                report['tensors'][name] = {'file': file.name, 'shape': list(values.shape),
                    'dtype': 'float32', 'byteLength': values.nbytes, 'sha256': digest(file), **extra}
            for name, source_key in mapping.items():
                item = header[source_key]
                a, b = item['data_offsets']
                f.seek(base + a)
                raw = f.read(b - a)
                if item['dtype'] == 'BF16':
                    values = (np.frombuffer(raw, dtype='<u2').astype('<u4') << 16).view('<f4')
                elif item['dtype'] == 'F32':
                    values = np.frombuffer(raw, dtype='<f4')
                else:
                    raise ValueError(f'unsupported checkpoint dtype: {item["dtype"]}')
                values = values.reshape(item['shape']).copy()
                weights[name] = values
                save(name, values, checkpointKey=source_key, checkpointDtype=item['dtype'],
                     checkpointTensorSha256=hashlib.sha256(raw).hexdigest())
        report['phase'] = 'native-prefix-reference'
        data = np.load(args.sample, allow_pickle=False)
        sample = np.asarray(data['sample_in'], dtype=np.float32)
        if sample.shape != (1, 8, 16, 16, 16):
            raise ValueError(f'unexpected real sample shape {sample.shape}')
        timestep = model_timestep_from_sampler_capture(data['t'])
        report['timeConvention'] = {'captureField': 't', 'captureSpace': 'normalized-sampler-time',
            'captureValue': float(np.asarray(data['t']).reshape(-1)[0]),
            'modelMultiplier': 1000, 'modelValue': float(timestep[0]),
            'modelDtype': 'float32', 'source': 'trellmlx/samplers.py:flow_euler_sample'}
        save('sample', sample)
        save('timestep', timestep)
        with mx.stream(mx.cpu):
            projection = nn.Linear(8, 1536)
            projection.weight = mx.array(weights['input.weight'])
            projection.bias = mx.array(weights['input.bias'])
            time_model = TimestepEmbedder(1536, 256)
            for key, layer in [('time0', time_model.mlp_0), ('time2', time_model.mlp_2)]:
                layer.weight = mx.array(weights[f'{key}.weight'])
                layer.bias = mx.array(weights[f'{key}.bias'])
            modulation_model = nn.Sequential(nn.SiLU(), nn.Linear(1536, 9216))
            modulation_model.layers[1].weight = mx.array(weights['mod.weight'])
            modulation_model.layers[1].bias = mx.array(weights['mod.bias'])
            projected = projection(mx.array(sample.reshape(1, 8, -1).transpose(0, 2, 1).reshape(-1, 8))).astype(mx.bfloat16)
            modulation = _source_shared_modulation(mx.array(timestep), time_model, modulation_model, mx.bfloat16)
            mx.eval(projected, modulation)
            save('expected.projected', np.array(projected.astype(mx.float32)), arithmetic='bfloat16')
            save('expected.modulation', np.array(modulation.astype(mx.float32)), arithmetic='bfloat16')
        report['status'] = 'succeeded'
        report['phase'] = None
    except Exception as error:
        report['error'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        report['elapsedSeconds'] = time.perf_counter() - start
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'phase': report['phase'], 'report': str(report_path)}))


if __name__ == '__main__':
    main()
