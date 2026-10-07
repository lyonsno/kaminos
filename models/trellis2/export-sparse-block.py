"""Capture one pinned sparse block, reusing saved prefix/noise and conditioning.

Offline reference only: a single ModulatedBlock, never full model generation.
Uses explicitly named MLX GPU fast SDPA, default two-pass LN, mlx-sum QK norm,
real RoPE and the source's authenticated BF16 GELU table.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import time

import numpy as np


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def load_native_block_input(path, *, block_index, prefix, prefix_sha, conditioning_sha, checkpoint_sha):
    """Admit observed bytes, not the canonical preceding-block reference."""
    native = json.loads(path.read_text())
    result = native.get('result', {})
    composition = result.get('composition', {})
    reference = result.get('reference', {})
    backend = result.get('backend', {})
    route = 'trellis2.sparse-flow-block.webgpu.v0'
    if (native.get('commit') != native.get('expectedCommit') or native.get('dirty') != '' or
            not native.get('finishedAt') or native.get('requestedUrl') != native.get('effectiveUrl') or
            native.get('serverErrors') or native.get('cleanupErrors') or result.get('errors') != [] or
            result.get('requestedRoute') != route or result.get('effectiveRoute') != route or
            backend.get('isFallbackAdapter') is True or backend.get('vendor') != 'apple' or
            not str(backend.get('architecture', '')).startswith('metal') or
            composition.get('observedBlockIndex') != block_index or composition.get('sameSession') is not True or
            composition.get('sameJob') is not True or composition.get('readbackBetweenBlocks') is not False or
            composition.get('reusedResidentBlockHidden') is not True or
            composition.get('incomingHiddenSnapshot') != 'queue-ordered-GPU-copy-before-block1; observer-readback-after-chain' or
            native.get('prefixFixtureSha256') != prefix_sha or
            reference.get('source', {}).get('commit') != prefix['source']['commit'] or
            reference.get('checkpoint', {}).get('sha256') != checkpoint_sha or
            reference.get('conditioning', {}).get('sha256') != conditioning_sha):
        raise ValueError('native input route/source/composition identity mismatch')
    if native.get('status') != 'succeeded' and (native.get('phase') != 'native-block-execution' or
            native.get('error', {}).get('message') != 'whole-block numerical comparison failed'):
        raise ValueError('native input witness failed before trustworthy outputs')
    served = native.get('servedSources', {})
    required = ['models/trellis2/sparse-block-witness.js', 'models/trellis2/sparse-block.js',
                'models/trellis2/sparse-prefix.js', 'webgpu-inference-kit/src/inference-runtime.js']
    if not all(name in served for name in required):
        raise ValueError('native input lacks required served-source attestation')
    for name, sha in served.items():
        blob = subprocess.check_output(['git', '-C', native['repoRoot'], 'show', f'{native["commit"]}:{name}'])
        if hashlib.sha256(blob).hexdigest() != sha:
            raise ValueError(f'native served source changed: {name}')
    values, metadata = {}, {}
    for name, shape, rows in [(f'block{block_index}.input', [4096, 1536], result.get('inputs', {})),
                             ('modulation', [1, 9216], result.get('outputs', {}))]:
        raw = native.get('rawOutputs', {}).get(name, {})
        observed = rows.get(name, {})
        file = Path(raw.get('path', ''))
        size = int(np.prod(shape)) * 4
        if (observed.get('shape') != shape or observed.get('dtype') != 'f32' or
                raw.get('byteLength') != size or not file.is_file() or file.stat().st_size != size or
                raw.get('sha256') != observed.get('sha256') or digest(file) != raw.get('sha256')):
            raise ValueError(f'native input bytes/shape changed: {name}')
        array = np.fromfile(file, dtype='<f4').reshape(shape)
        if not np.isfinite(array).all():
            raise ValueError(f'nonfinite native input: {name}')
        values[name] = array
        metadata[name] = {**raw, 'shape': shape, 'dtype': 'float32'}
    return values[f'block{block_index}.input'], values['modulation'], {
        'path': str(path.resolve()), 'sha256': digest(path), 'nativeCommit': native['commit'],
        'nativeSessionId': result['sessionId'], 'blockIndex': block_index, 'tensors': metadata,
        'comparisonClass': 'MLX single block on identical captured native hidden and time modulation'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root', type=Path, required=True)
    p.add_argument('--prefix', type=Path, required=True)
    p.add_argument('--conditioning', type=Path, required=True)
    p.add_argument('--block-index', type=int, default=0)
    p.add_argument('--input-block', type=Path, help='Saved preceding canonical block manifest; no preceding block rerun.')
    p.add_argument('--native-input-report', type=Path, help='Authenticated browser report supplying actual incoming hidden and modulation, instead of canonical inputs.')
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.sparse-block-reference.v0', 'status': 'failed', 'phase': 'source',
              'tensors': {}, 'fullModelExecutions': 0, 'blockExecutions': 0, 'blockIndex': args.block_index,
              'config': {'resolution': 16, 'channels': 1536, 'heads': 12, 'contextChannels': 1024,
                         'contextRows': 1029, 'hidden': 8192},
              'referenceRoute': 'pinned-MLX-GPU-single-block/fast-SDPA/two-pass-LN/mlx-sum-QK/real-RoPE/source-BF16-GELU'}
    started = time.perf_counter()
    try:
        root = args.source_root.resolve()
        git = lambda *a: subprocess.check_output(['git', '-C', str(root), *a], text=True).strip()
        report['source'] = {'root': str(root), 'commit': git('rev-parse', 'HEAD'), 'dirty': git('status', '--porcelain')}
        if report['source']['dirty']:
            raise ValueError('reference source must be clean')
        report['prefix'] = {'path': str(args.prefix.resolve()), 'sha256': digest(args.prefix)}
        prefix = json.loads(args.prefix.read_text())
        if prefix['status'] != 'succeeded' or prefix['source']['commit'] != report['source']['commit']:
            raise ValueError('pinned prefix source identity mismatch')
        checkpoint = Path(prefix['checkpoint']['path'])
        report['checkpoint'] = {'path': str(checkpoint), 'sha256': digest(checkpoint)}
        if report['checkpoint']['sha256'] != prefix['checkpoint']['sha256']:
            raise ValueError('checkpoint changed since prefix reference')
        previous = None
        if args.block_index < 0 or args.block_index >= 30:
            raise ValueError('block index outside checkpoint model geometry')
        if args.block_index == 0 and args.input_block is not None:
            raise ValueError('block0 must consume the canonical prefix')
        if args.native_input_report is not None and args.input_block is not None:
            raise ValueError('native and canonical input authorities are mutually exclusive')
        if args.block_index > 0 and args.native_input_report is None:
            if args.input_block is None:
                raise ValueError('later block requires preceding canonical block manifest')
            previous = json.loads(args.input_block.read_text())
            if (previous.get('status') != 'succeeded' or previous.get('blockIndex', 0) != args.block_index - 1 or
                    previous.get('source', {}).get('commit') != report['source']['commit'] or
                    previous.get('source', {}).get('dirty') != '' or
                    previous.get('checkpoint', {}).get('sha256') != report['checkpoint']['sha256'] or
                    previous.get('prefix', {}).get('sha256') != report['prefix']['sha256']):
                raise ValueError('preceding block source/checkpoint/prefix/index mismatch')
            descriptor = previous['tensors']['expected.after_mlp']
            report['inputBlock'] = {'path': str(args.input_block.resolve()), 'sha256': digest(args.input_block),
                'blockIndex': args.block_index - 1, 'tensorSha256': descriptor['sha256']}
        report['conditioning'] = {'path': str(args.conditioning.resolve()), 'sha256': digest(args.conditioning)}
        if previous is not None and previous.get('conditioning', {}).get('sha256') != report['conditioning']['sha256']:
            raise ValueError('conditioning changed across canonical blocks')
        for file in ('trellmlx/models/sparse_structure_flow.py', 'trellmlx/modules/attention.py',
                     'trellmlx/modules/norm.py', 'trellmlx/modules/rope.py', 'trellmlx/sparse_flow_layernorm.py'):
            report['source'][file] = digest(root / file)
        os.environ['TRELLIS2MLX_ATTENTION_BACKEND'] = 'fast'
        os.environ['TRELLIS2MLX_QK_NORM_BACKEND'] = 'mlx-sum'
        sys.path.insert(0, str(root))
        import mlx.core as mx
        from trellmlx.models.sparse_structure_flow import ModulatedBlock
        from trellmlx.sparse_flow_rope import build_sparse_flow_rope_phases
        from trellmlx.modules.attention import qk_norm_backend_identity
        from trellmlx.sparse_flow_layernorm import sparse_flow_layernorm_backend_identity
        from trellmlx.sparse_flow_rope import sparse_flow_rope_backend_identity
        report['effectiveBackend'] = {'device': str(mx.default_device()), 'qk': qk_norm_backend_identity(),
            'layernorm': sparse_flow_layernorm_backend_identity(), 'rope': sparse_flow_rope_backend_identity(), 'attention': 'fast'}
        if mx.default_device() != mx.gpu:
            raise ValueError('reference requires the declared MLX GPU route')
        def save(name, values, **extra):
            values = np.asarray(values, dtype='<f4', order='C')
            if name != 'gelu' and not np.isfinite(values).all():
                raise ValueError(f'nonfinite {name}')
            file = args.out / f'{name}.f32'
            values.tofile(file)
            report['tensors'][name] = {'file': file.name, 'shape': list(values.shape), 'dtype': 'float32',
                'byteLength': values.nbytes, 'sha256': digest(file), **extra}
        mapping = {'modulation': 'modulation', 'norm2.weight': 'norm2.weight', 'norm2.bias': 'norm2.bias',
            'self.qkv.weight': 'self_attn.to_qkv.weight', 'self.qkv.bias': 'self_attn.to_qkv.bias',
            'self.out.weight': 'self_attn.to_out.weight', 'self.out.bias': 'self_attn.to_out.bias',
            'self.q.gamma': 'self_attn.q_rms_norm.gamma', 'self.k.gamma': 'self_attn.k_rms_norm.gamma',
            'cross.q.weight': 'cross_attn.to_q.weight', 'cross.q.bias': 'cross_attn.to_q.bias',
            'cross.kv.weight': 'cross_attn.to_kv.weight', 'cross.kv.bias': 'cross_attn.to_kv.bias',
            'cross.out.weight': 'cross_attn.to_out.weight', 'cross.out.bias': 'cross_attn.to_out.bias',
            'cross.q.gamma': 'cross_attn.q_rms_norm.gamma', 'cross.k.gamma': 'cross_attn.k_rms_norm.gamma',
            'mlp.in.weight': 'mlp.mlp.0.weight', 'mlp.in.bias': 'mlp.mlp.0.bias',
            'mlp.out.weight': 'mlp.mlp.2.weight', 'mlp.out.bias': 'mlp.mlp.2.bias'}
        loaded = []
        report['phase'] = 'checkpoint-block-export'
        with checkpoint.open('rb') as f:
            n = struct.unpack('<Q', f.read(8))[0]
            header = json.loads(f.read(n))
            for name, key in mapping.items():
                source_key = f'blocks.{args.block_index}.' + key
                item = header[source_key]
                a, b = item['data_offsets']
                f.seek(8 + n + a)
                raw = f.read(b - a)
                if item['dtype'] == 'BF16':
                    values = (np.frombuffer(raw, dtype='<u2').astype('<u4') << 16).view('<f4')
                elif item['dtype'] == 'F32':
                    values = np.frombuffer(raw, dtype='<f4')
                else:
                    raise ValueError(f'unsupported dtype {item["dtype"]}')
                values = values.reshape(item['shape']).copy()
                save(name, values, checkpointKey=source_key, checkpointDtype=item['dtype'],
                     checkpointTensorSha256=hashlib.sha256(raw).hexdigest())
                local_key = key.replace('mlp.mlp.0.', 'mlp.mlp_0.').replace('mlp.mlp.2.', 'mlp.mlp_2.')
                # Source loader keeps normalization parameters F32; torso linears and modulation BF16.
                value = mx.array(values)
                if name == 'modulation' or name.startswith(('self.qkv.', 'self.out.', 'cross.q.', 'cross.kv.', 'cross.out.', 'mlp.')) and not name.endswith('.gamma'):
                    value = value.astype(mx.bfloat16)
                loaded.append((local_key, value))
        block = ModulatedBlock(1536, 12, 1024, 8192, sparse_flow_layernorm=True)
        block.load_weights(loaded, strict=True)
        def prefix_tensor(name):
            descriptor = prefix['tensors'][name]
            file = args.prefix.parent / descriptor['file']
            if digest(file) != descriptor['sha256']:
                raise ValueError(f'prefix bytes changed: {name}')
            return np.fromfile(file, dtype='<f4').reshape(descriptor['shape'])
        if args.native_input_report is not None:
            hidden, modulation, report['nativeInput'] = load_native_block_input(args.native_input_report,
                block_index=args.block_index, prefix=prefix, prefix_sha=report['prefix']['sha256'],
                conditioning_sha=report['conditioning']['sha256'], checkpoint_sha=report['checkpoint']['sha256'])
        elif previous is None:
            hidden = prefix_tensor('expected.projected')
        else:
            descriptor = previous['tensors']['expected.after_mlp']
            file = args.input_block.parent / descriptor['file']
            if (descriptor.get('dtype') != 'float32' or descriptor.get('shape') != [4096, 1536] or
                    descriptor.get('byteLength') != 4096 * 1536 * 4 or file.stat().st_size != descriptor['byteLength'] or
                    digest(file) != descriptor['sha256']):
                raise ValueError('preceding canonical hidden bytes/shape changed')
            hidden = np.fromfile(file, dtype='<f4').reshape(4096, 1536)
        if not np.isfinite(hidden).all():
            raise ValueError('nonfinite canonical block input')
        projected = mx.array(hidden).astype(mx.bfloat16)
        if args.native_input_report is None:
            modulation = prefix_tensor('expected.modulation')
        mod = mx.array(modulation.reshape(-1)).astype(mx.bfloat16)
        data = np.load(args.conditioning, allow_pickle=False)
        report['conditioning']['keys'] = list(data.files)
        condition = np.asarray(data['cond'], dtype=np.float32)
        if condition.shape != (1, 1029, 1024):
            raise ValueError(f'incompatible conditioning {condition.shape}')
        save('conditioning', condition.reshape(1029, 1024))
        phases = build_sparse_flow_rope_phases(16, 128)
        mx.eval(phases)
        save('phases', np.asarray(phases))
        table_path = root / 'trellmlx/models/source_cuda_bf16_gelu_tanh_table.npy'
        table = np.load(table_path, allow_pickle=False)
        report['geluSource'] = {'path': str(table_path), 'sha256': digest(table_path)}
        save('gelu', (table.astype('<u4') << 16).view('<f4'))
        report['phase'] = 'single-block-reference'
        trace_prefix = f'block{args.block_index}'
        output, trace = block.trace(projected, mod, mx.array(condition).astype(mx.bfloat16), phases, trace_prefix=trace_prefix)
        mx.eval(output, *trace.values())
        report['blockExecutions'] = 1
        names = ['norm1', 'modulated_self_input', 'q_post_norm', 'k_post_norm', 'q_post_rope', 'k_post_rope',
                 'attention_raw', 'self_attn', 'after_self', 'norm2', 'cross_attention_raw', 'after_cross',
                 'mlp_input', 'mlp_fc1', 'mlp_gelu', 'mlp_fc2', 'after_mlp']
        aliases = {'attention_raw': 'self.attention', 'cross_attention_raw': 'cross.attention'}
        for name in names:
            value = np.asarray(trace[trace_prefix + '_' + name].astype(mx.float32))
            if value.ndim == 3:
                value = value.reshape(-1, 1536)
            save('expected.' + aliases.get(name, name), value, arithmetic='bfloat16')
        report['status'] = 'succeeded'
        report['phase'] = None
    except Exception as error:
        report['error'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        report['elapsedSeconds'] = time.perf_counter() - started
        (args.out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'phase': report['phase'], 'report': str(args.out / 'manifest.json')}))


if __name__ == '__main__':
    main()
