"""One actual learned sparse decoder capture, never the generation pipeline."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import numpy as np

def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('repo-root', 'source-root', 'out'): parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--synthetic', action='store_true')
    parser.add_argument('--mode', choices=('shape', 'texture'), default='shape')
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--input-npz', type=Path)
    parser.add_argument('--guide-npz', type=Path)
    parser.add_argument('--resolution', type=int, default=64)
    args = parser.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.slat-decoder-reference.v0', 'status': 'failed', 'phase': 'source',
        'modelCalls': 0, 'tensors': {}, 'referenceRoute': 'pinned-MLX-GPU-source-SLat-decoder/native-FP16-torso-F32-endpoints',
        'fixtureKind': 'synthetic-operation-conformance' if args.synthetic else 'checkpoint-decoder',
        'inputHandoff': 'artifact input for stage isolation, not live WebGPU composition'}
    started = time.perf_counter()
    try:
        git = lambda root, *items: subprocess.check_output(['git', '-C', str(root), *items], text=True).strip()
        root, producer = args.source_root.resolve(), args.repo_root.resolve()
        for name, folder in [('source', root), ('producer', producer)]:
            report[name] = {'root': str(folder), 'commit': git(folder, 'rev-parse', 'HEAD'), 'dirty': git(folder, 'status', '--porcelain')}
        if report['source']['dirty'] or report['producer']['dirty'] or report['producer']['commit'] != args.expected_commit:
            raise ValueError('clean exact source and producer required')
        for name in ('trellmlx/models/shape_slat_decoder.py', 'trellmlx/modules/sparse_conv.py', 'trellmlx/modules/norm.py',
            'trellmlx/decoder_turing_silu.py', 'trellmlx/decoder_turing_layernorm.py', 'trellmlx/weight_loader.py'):
            report['source'][name] = digest(root / name)
        report['producer']['scriptSha256'] = digest(__file__)
        report['phase'] = 'input-admission'
        if args.synthetic:
            if args.checkpoint or args.input_npz or args.guide_npz or args.mode != 'shape': raise ValueError('synthetic actual-source decoder is a distinct shape conformance fixture')
            config = {'tokenRows': 3, 'latentChannels': 2, 'resolution': 2, 'channels': [16, 8], 'numBlocks': [1, 0], 'mode': 'shape'}
            feats = np.linspace(-.4, .6, 6, dtype=np.float32).reshape(3, 2)
            coords = np.array([[0, 0, 0, 0], [0, 0, 1, 1], [0, 1, 0, 1]], dtype=np.int32)
            report['input'] = {'kind': 'deterministic-synthetic', 'seed': 42}
        else:
            if not args.checkpoint or not args.input_npz: raise ValueError('named checkpoint and saved denormalized SLat input required')
            if args.checkpoint.suffix != '.safetensors': raise ValueError('named safetensors checkpoint required')
            expected_name = ('shape' if args.mode == 'shape' else 'tex') + '_dec_next_dc_f16c32_fp16.safetensors'
            if args.checkpoint.name != expected_name: raise ValueError('observed source decoder checkpoint required')
            config_path = args.checkpoint.with_suffix('.json'); stored = json.loads(config_path.read_text())
            c = stored['args']
            if c.get('model_channels') != [1024, 512, 256, 128, 64] or c.get('num_blocks') != [4, 16, 8, 4, 0] or c.get('latent_channels') != 32 or c.get('use_fp16') is not True:
                raise ValueError('observed source FP16 decoder checkpoint config required')
            with np.load(args.input_npz) as saved:
                feats, coords = saved['feats'], saved['coords']
            config = {'tokenRows': int(len(feats)), 'latentChannels': 32, 'resolution': args.resolution,
                'channels': c['model_channels'], 'numBlocks': c['num_blocks'], 'mode': args.mode}
            report['input'] = {'kind': 'saved-denormalized-SLat', 'path': str(args.input_npz.resolve()), 'sha256': digest(args.input_npz),
                'interpretation': 'stage input supplied explicitly; not source noise-stream or live sampler equivalence'}
            report['checkpoint'] = {'path': str(args.checkpoint.absolute()), 'resolvedPath': str(args.checkpoint.resolve()), 'sha256': digest(args.checkpoint)}
            report['checkpointConfig'] = {'path': str(config_path.resolve()), 'sha256': digest(config_path), 'stored': stored}
        if feats.dtype != np.float32 or feats.shape != (config['tokenRows'], config['latentChannels']) or not np.isfinite(feats).all(): raise ValueError('complete finite F32 denormalized decoder codes required')
        if coords.dtype != np.int32 or coords.shape != (len(feats), 4) or np.any(coords[:, 0] != 0) or np.any(coords[:, 1:] < 0) or np.any(coords[:, 1:] >= config['resolution']): raise ValueError('complete batch-zero source Int32 grid coordinates required')
        if len(np.unique(coords, axis=0)) != len(coords): raise ValueError('unique complete source coordinates required')
        report['config'] = config
        sys.path.insert(0, str(root))
        import mlx.core as mx
        from mlx.utils import tree_flatten
        from trellmlx.models.shape_slat_decoder import SLatDecoder
        from trellmlx.weight_loader import load_weights, _remap_key
        from trellmlx.decoder_turing_silu import silu, decoder_silu_backend_identity
        from trellmlx.decoder_turing_layernorm import decoder_layernorm_backend_identity
        import os
        if mx.default_device() != mx.gpu: raise ValueError('actual MLX GPU source route required')
        route = {'decoder_linear_backend': os.environ.get('TRELLIS2MLX_DECODER_LINEAR_BACKEND', 'native'),
            'sparse_conv_matmul_backend': os.environ.get('TRELLIS2MLX_SPARSE_CONV_MATMUL_BACKEND', 'native'),
            'decoder_silu': decoder_silu_backend_identity(), 'decoder_layernorm': decoder_layernorm_backend_identity()}
        if route['decoder_linear_backend'] != 'native' or route['sparse_conv_matmul_backend'] != 'native' or route['decoder_silu']['backend'] != 'mlx-native' or route['decoder_layernorm']['backend'] != 'mlx-fast-layer-norm':
            raise ValueError('actual default native decoder arithmetic required; no silent route substitution')
        report['phase'] = 'model-load'
        model = SLatDecoder(out_channels=7 if args.mode == 'shape' else 6, latent_channels=config['latentChannels'],
            model_channels=config['channels'], num_blocks=config['numBlocks'], pred_subdiv=args.mode == 'shape', use_fp16=True)
        initial = dict(tree_flatten(model.parameters()))
        if args.synthetic:
            rng = np.random.default_rng(42); parameters = {}
            for name, value in initial.items():
                if name.endswith('.weight') and '.norm' in name: data = np.ones(value.shape, dtype=np.float32)
                elif name.endswith('.bias'): data = np.zeros(value.shape, dtype=np.float32)
                else: data = rng.normal(0, .03, value.shape).astype(np.float32)
                if '.to_subdiv.' in name: data = np.zeros(value.shape, dtype=np.float32) if name.endswith('weight') else np.array([.25, -.25] * 4, dtype=np.float32)
                parameters[name] = mx.array(data, dtype=value.dtype)
            model.load_weights(list(parameters.items()))
        else:
            from safetensors import safe_open
            with safe_open(str(args.checkpoint), framework='numpy') as checkpoint:
                if {_remap_key(key) for key in checkpoint.keys()} != set(initial): raise ValueError('exact complete learned decoder parameter keys required')
            if load_weights(model, str(args.checkpoint), verbose=False): raise ValueError('complete learned decoder checkpoint required')
        parameters = dict(tree_flatten(model.parameters()))
        if set(parameters) != set(initial): raise ValueError('source parameter coverage changed')
        for name, value in parameters.items():
            if value.dtype != (mx.float16 if name.startswith('blocks.') else mx.float32): raise ValueError('source endpoint/torso precision changed: ' + name)
        values = {'sample': feats, 'coordinates': coords[:, 1:].copy()}
        for name, value in parameters.items(): values['weight.' + name] = np.asarray(value, dtype=np.float32)
        report['parameterCount'] = sum(int(v.size) for v in parameters.values())
        report['effectiveBackend'] = {'device': str(mx.default_device()), 'arithmetic': 'semantic-f16-torso-f32-endpoints',
            'weightLayout': 'source-Co-kD-kH-kW-Ci', 'normEpsilon': 1e-6, 'terminalNormEpsilon': 1e-5,
            'sourceModel': 'actual SLatDecoder.__call__', 'route': route}
        report['phase'] = 'source-native-half-silu'
        half_inputs = np.arange(65536, dtype=np.uint16).view(np.float16)
        table = silu(mx.array(half_inputs)); mx.eval(table)
        values['silu'] = np.asarray(table, dtype=np.float32)
        values['halfInputs'] = half_inputs.astype(np.float32)
        guide = None
        if args.mode == 'texture':
            if not args.guide_npz: raise ValueError('saved matching learned shape guide required for source texture decoder')
            with np.load(args.guide_npz) as saved:
                guide = [mx.array(saved[f'shape_subs{i}']) for i in range(len(config['channels']) - 1)]
                report['guide'] = {'path': str(args.guide_npz.resolve()), 'sha256': digest(args.guide_npz)}
            for i, value in enumerate(guide): values[f'guide{i}'] = np.asarray(value, dtype=np.float32)
        report['phase'] = 'source-learned-decode'; report['modelCalls'] = 1
        result = model(mx.array(feats), mx.array(coords), guide_subs=guide, return_subs=True)
        decoded, final_coords, subdivisions = result; mx.eval(decoded, final_coords, *subdivisions)
        values['expected.features'] = np.asarray(decoded, dtype=np.float32)
        values['expected.coordinates'] = np.asarray(final_coords, dtype=np.int32)[:, 1:].copy()
        for i, value in enumerate(subdivisions): values[f'expected.subdivision{i}'] = np.asarray(value, dtype=np.float32)
        report['outputRows'] = int(len(final_coords)); report['outputResolution'] = config['resolution'] * 2 ** (len(config['channels']) - 1)
        report['subdivisionRows'] = [list(value.shape) for value in subdivisions]
        report['convolutionsExecuted'] = sum(config['numBlocks']) + 2 * (len(config['channels']) - 1)
        report['phase'] = 'output-export'
        for name, value in values.items():
            integer = value.dtype == np.int32; value = np.asarray(value, dtype='<i4' if integer else '<f4', order='C')
            if name not in ('silu', 'halfInputs') and not np.isfinite(value).all(): raise ValueError('nonfinite learned decoder tensor ' + name)
            file = args.out / (name + ('.i32' if integer else '.f32')); value.tofile(file)
            report['tensors'][name] = {'file': file.name, 'shape': list(value.shape), 'dtype': 'int32' if integer else 'float32',
                'sourceDtype': 'float16' if name == 'silu' or name.startswith('weight.blocks.') or name.startswith('expected.subdivision') else 'int32' if integer else 'float32',
                'byteLength': value.nbytes, 'sha256': digest(file)}
        report['phase'] = 'post-source-admission'
        for name, folder in [('source', root), ('producer', producer)]:
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
