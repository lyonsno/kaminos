"""Export a reusable complete sparse-flow prediction, not the generation pipeline."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import time

import numpy as np


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


PREFIX_KEYS = {'input.weight': 'input_layer.weight', 'input.bias': 'input_layer.bias',
    'time0.weight': 't_embedder.mlp.0.weight', 'time0.bias': 't_embedder.mlp.0.bias',
    'time2.weight': 't_embedder.mlp.2.weight', 'time2.bias': 't_embedder.mlp.2.bias',
    'mod.weight': 'adaLN_modulation.1.weight', 'mod.bias': 'adaLN_modulation.1.bias'}
BLOCK_KEYS = {'modulation': 'modulation', 'norm2.weight': 'norm2.weight', 'norm2.bias': 'norm2.bias',
    'self.qkv.weight': 'self_attn.to_qkv.weight', 'self.qkv.bias': 'self_attn.to_qkv.bias',
    'self.out.weight': 'self_attn.to_out.weight', 'self.out.bias': 'self_attn.to_out.bias',
    'self.q.gamma': 'self_attn.q_rms_norm.gamma', 'self.k.gamma': 'self_attn.k_rms_norm.gamma',
    'cross.q.weight': 'cross_attn.to_q.weight', 'cross.q.bias': 'cross_attn.to_q.bias',
    'cross.kv.weight': 'cross_attn.to_kv.weight', 'cross.kv.bias': 'cross_attn.to_kv.bias',
    'cross.out.weight': 'cross_attn.to_out.weight', 'cross.out.bias': 'cross_attn.to_out.bias',
    'cross.q.gamma': 'cross_attn.q_rms_norm.gamma', 'cross.k.gamma': 'cross_attn.k_rms_norm.gamma',
    'mlp.in.weight': 'mlp.mlp.0.weight', 'mlp.in.bias': 'mlp.mlp.0.bias',
    'mlp.out.weight': 'mlp.mlp.2.weight', 'mlp.out.bias': 'mlp.mlp.2.bias'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('repo-root', 'source-root', 'checkpoint', 'sample', 'conditioning', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--expected-commit', required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.sparse-flow-reference.v0', 'status': 'failed', 'phase': 'source',
        'tensors': {}, 'fullModelExecutions': 0, 'fullModelAttempts': 0, 'blocksExecuted': 0,
        'config': {'resolution': 16, 'inChannels': 8, 'outChannels': 8, 'channels': 1536,
            'heads': 12, 'contextChannels': 1024, 'contextRows': 1029, 'hidden': 8192,
            'frequencyDim': 256, 'numBlocks': 30},
        'referenceRoute': 'pinned-MLX-GPU-full-sparse-flow/fast-SDPA/two-pass-LN/mlx-sum-QK/real-RoPE/source-BF16-GELU/F32-terminal'}
    start = time.perf_counter()
    try:
        root = args.source_root.resolve()
        git = lambda base, *a: subprocess.check_output(['git', '-C', str(base), *a], text=True).strip()
        report['source'] = {'root': str(root), 'commit': git(root, 'rev-parse', 'HEAD'), 'dirty': git(root, 'status', '--porcelain')}
        report['producer'] = {'root': str(args.repo_root.resolve()), 'commit': git(args.repo_root, 'rev-parse', 'HEAD'),
            'dirty': git(args.repo_root, 'status', '--porcelain'), 'scriptSha256': digest(Path(__file__))}
        if report['source']['dirty'] or report['producer']['dirty'] or report['producer']['commit'] != args.expected_commit:
            raise ValueError('clean exact producer and reference source required')
        for file in ('trellmlx/models/sparse_structure_flow.py', 'trellmlx/modules/attention.py', 'trellmlx/modules/norm.py',
            'trellmlx/modules/rope.py', 'trellmlx/sparse_flow_layernorm.py', 'trellmlx/sparse_flow_rope.py',
            'trellmlx/sparse_flow_attention.py', 'trellmlx/weight_loader.py', 'trellmlx/samplers.py', 'trellmlx/source_cuda_gelu.py'):
            report['source'][file] = digest(root / file)
        for name in ('checkpoint', 'sample', 'conditioning'):
            file = getattr(args, name)
            report[name] = {'path': str(file.resolve()), 'sha256': digest(file)}
        report['phase'] = 'input-admission'
        with np.load(args.sample, allow_pickle=False) as data:
            sample = np.asarray(data['sample_in'], dtype=np.float32)
            captured_time = np.asarray(data['t'])
        spec = importlib.util.spec_from_file_location('prefix_export', Path(__file__).with_name('export-sparse-prefix.py'))
        prefix_export = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(prefix_export)
        timestep = prefix_export.model_timestep_from_sampler_capture(captured_time)
        if sample.shape != (1, 8, 16, 16, 16) or float(captured_time.reshape(-1)[0]) != 1:
            raise ValueError('complete first-step sample at normalized time1 required')
        with np.load(args.conditioning, allow_pickle=False) as data:
            condition = np.asarray(data['cond'], dtype=np.float32)
        if condition.shape != (1, 1029, 1024):
            raise ValueError('complete saved positive image conditioning required')
        report['timeConvention'] = {'captureSpace': 'normalized-sampler-time', 'captureValue': float(captured_time.reshape(-1)[0]),
            'modelMultiplier': 1000, 'modelValue': float(timestep[0]), 'modelDtype': 'float32',
            'source': 'trellmlx/samplers.py:flow_euler_sample'}
        def save(name, values, **extra):
            values = np.asarray(values, dtype='<f4', order='C')
            if name != 'gelu' and not np.isfinite(values).all():
                raise ValueError(f'nonfinite tensor {name}')
            file = args.out / f'{name}.f32'
            values.tofile(file)
            report['tensors'][name] = {'file': file.name, 'shape': list(values.shape), 'dtype': 'float32',
                'byteLength': values.nbytes, 'sha256': digest(file), **extra}
        save('sample', sample)
        save('timestep', timestep)
        save('conditioning', condition.reshape(1029, 1024))
        report['phase'] = 'checkpoint-export'
        mapping = {**{'prefix.' + k: v for k, v in PREFIX_KEYS.items()},
            **{f'block{i}.{k}': f'blocks.{i}.{v}' for i in range(30) for k, v in BLOCK_KEYS.items()},
            'terminal.weight': 'out_layer.weight', 'terminal.bias': 'out_layer.bias'}
        with args.checkpoint.open('rb') as file:
            length = struct.unpack('<Q', file.read(8))[0]
            header = json.loads(file.read(length))
            if set(mapping.values()) != set(header):
                raise ValueError('checkpoint must supply exactly the complete640 sparse model parameters')
            for name, key in mapping.items():
                row = header[key]
                a, b = row['data_offsets']
                file.seek(8 + length + a)
                raw = file.read(b - a)
                if row['dtype'] == 'BF16':
                    values = (np.frombuffer(raw, dtype='<u2').astype('<u4') << 16).view('<f4')
                elif row['dtype'] == 'F32':
                    values = np.frombuffer(raw, dtype='<f4')
                else:
                    raise ValueError(f'unsupported checkpoint precision {row["dtype"]}')
                save(name, values.reshape(row['shape']), checkpointKey=key, checkpointDtype=row['dtype'],
                    checkpointTensorSha256=hashlib.sha256(raw).hexdigest())
        os.environ['TRELLIS2MLX_ATTENTION_BACKEND'] = 'fast'
        os.environ['TRELLIS2MLX_QK_NORM_BACKEND'] = 'mlx-sum'
        sys.path.insert(0, str(root))
        import mlx.core as mx
        import mlx.utils
        import trellmlx.models.sparse_structure_flow as source
        from trellmlx.weight_loader import load_weights, _remap_key
        from trellmlx.modules.attention import qk_norm_backend_identity
        from trellmlx.sparse_flow_layernorm import sparse_flow_layernorm_backend_identity
        from trellmlx.sparse_flow_rope import sparse_flow_rope_backend_identity, build_sparse_flow_rope_phases
        model = source.SparseStructureFlowModel()
        parameter_keys = set(dict(mlx.utils.tree_flatten(model.parameters())))
        if parameter_keys != {_remap_key(k) for k in header}:
            raise ValueError('source model/checkpoint parameter coverage mismatch')
        skipped = load_weights(model, str(args.checkpoint), verbose=False)
        if skipped:
            raise ValueError(f'source loader skipped checkpoint parameters: {skipped}')
        report['effectiveBackend'] = {'device': str(mx.default_device()), 'attention': 'fast', 'qk': qk_norm_backend_identity(),
            'layernorm': sparse_flow_layernorm_backend_identity(), 'rope': sparse_flow_rope_backend_identity(),
            'terminal': model.terminal_linear_backend_identity(4096)}
        if mx.default_device() != mx.gpu:
            raise ValueError('full sparse reference requires declared MLX GPU route')
        phases = build_sparse_flow_rope_phases(16, 128)
        mx.eval(phases)
        save('phases', np.asarray(phases))
        table_path = root / 'trellmlx/models/source_cuda_bf16_gelu_tanh_table.npy'
        table = np.load(table_path, allow_pickle=False)
        if table.shape != (65536,) or table.dtype != np.uint16:
            raise ValueError('source BF16 GELU table shape/dtype changed')
        report['geluSource'] = {'path': str(table_path), 'sha256': digest(table_path)}
        save('gelu', (table.astype('<u4') << 16).view('<f4'))
        report['phase'] = 'full-sparse-forward'
        terminal = {}
        original_norm = source._sparse_flow_terminal_layernorm
        def observe_terminal(x, eps):
            output = original_norm(x, eps=eps)
            terminal.update(hidden=x, normalized=output)
            return output
        source._sparse_flow_terminal_layernorm = observe_terminal
        report['terminalObservation'] = 'observer wrapper calls unchanged source norm and retains its input/output; no source-file mutation'
        report['fullModelAttempts'] = 1
        try:
            prediction = model(mx.array(sample), mx.array(timestep), mx.array(condition))
            mx.eval(prediction, *terminal.values())
        finally:
            source._sparse_flow_terminal_layernorm = original_norm
        report['fullModelExecutions'] = 1
        report['blocksExecuted'] = len(model.blocks)
        save('expected.prediction', np.asarray(prediction), arithmetic='float32')
        for name, value in terminal.items():
            save('expected.' + name, np.asarray(value.astype(mx.float32)), arithmetic='bfloat16' if name == 'hidden' else 'float32')
        # Small controls/prefix only, not a second transformer forward.
        projected = model.input_layer(mx.array(sample.reshape(1, 8, -1).transpose(0, 2, 1).reshape(-1, 8))).astype(mx.bfloat16)
        modulation = source._source_shared_modulation(mx.array(timestep), model.t_embedder, model.adaLN_modulation, mx.bfloat16)
        mx.eval(projected, modulation)
        save('expected.projected', np.asarray(projected.astype(mx.float32)), arithmetic='bfloat16')
        save('expected.modulation', np.asarray(modulation.astype(mx.float32)), arithmetic='bfloat16')
        report['phase'] = 'post-source-admission'
        for name, base, expected in [('source', root, report['source']['commit']),
                ('producer', args.repo_root, args.expected_commit)]:
            observed = {'commit': git(base, 'rev-parse', 'HEAD'), 'dirty': git(base, 'status', '--porcelain')}
            report[name + 'After'] = observed
            if observed['commit'] != expected or observed['dirty']:
                raise ValueError(f'{name} changed during full sparse reference')
        report['status'] = 'succeeded'
        report['phase'] = None
    except Exception as error:
        report['error'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        report['elapsedSeconds'] = time.perf_counter() - start
        (args.out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'phase': report['phase'], 'report': str(args.out / 'manifest.json')}))


if __name__ == '__main__':
    main()
