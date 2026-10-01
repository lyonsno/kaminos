"""Export one reusable source sampler step; no downstream generation."""
import argparse
import hashlib
import inspect
import json
import os
from pathlib import Path
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


def model_checkpoint_path(named, captured):
    if named is None or Path(named).suffix != '.safetensors':
        raise ValueError('named .safetensors checkpoint path required by source MLX format routing')
    if Path(named).resolve() != Path(captured).resolve():
        raise ValueError('named model input must resolve to the same checkpoint bytes')
    return Path(named).absolute()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('repo-root', 'source-root', 'flow-fixture', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--checkpoint', type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.sparse-sampler-reference.v0', 'status': 'failed', 'phase': 'source',
        'tensors': {}, 'modelCalls': 0, 'modelAttempts': 0, 'stepsExecuted': 0, 'blocksExecuted': 0, 'stepIndex': 0,
        'referenceRoute': 'pinned-MLX-GPU-source-first-step-sampler/fast-SDPA/two-pass-LN/mlx-sum-QK/F32-CFG-Euler'}
    started = time.perf_counter()
    try:
        root = args.source_root.resolve()
        git = lambda base, *items: subprocess.check_output(['git', '-C', str(base), *items], text=True).strip()
        report['source'] = {'root': str(root), 'commit': git(root, 'rev-parse', 'HEAD'), 'dirty': git(root, 'status', '--porcelain')}
        report['producer'] = {'root': str(args.repo_root.resolve()), 'commit': git(args.repo_root, 'rev-parse', 'HEAD'),
            'dirty': git(args.repo_root, 'status', '--porcelain'), 'scriptSha256': digest(Path(__file__))}
        if report['source']['dirty'] or report['producer']['dirty'] or report['producer']['commit'] != args.expected_commit:
            raise ValueError('clean exact producer and source required')
        report['phase'] = 'flow-reference-admission'
        fixture = args.flow_fixture.resolve()
        manifest_path = fixture / 'manifest.json'
        base = json.loads(manifest_path.read_text())
        report['flowFixture'] = {'root': str(fixture), 'sha256': digest(manifest_path)}
        if base.get('schema') != 'trellis2.sparse-flow-reference.v0' or base.get('status') != 'succeeded' or base['source']['commit'] != report['source']['commit']:
            raise ValueError('matching complete flow source reference required')
        for file, sha in base['source'].items():
            if file.startswith('trellmlx/'):
                observed = digest(root / file)
                if observed != sha:
                    raise ValueError(f'source file changed: {file}')
                report['source'][file] = observed
        for name in ('checkpoint', 'sample', 'conditioning'):
            report[name] = base[name]
            if digest(Path(base[name]['path'])) != base[name]['sha256']:
                raise ValueError(f'changed {name} input')
        checkpoint = model_checkpoint_path(args.checkpoint, base['checkpoint']['path'])
        report['modelCheckpoint'] = {'requestedPath': str(args.checkpoint), 'effectivePath': str(checkpoint),
            'resolvedPath': str(checkpoint.resolve()), 'sha256': base['checkpoint']['sha256']}
        sample_path = Path(base['sample']['path'])
        with np.load(sample_path, allow_pickle=False) as capture:
            sample = np.asarray(capture['sample_in'], dtype=np.float32)
            steps = int(capture['steps'].item())
            if float(capture['t'].item()) != 1 or int(capture['sparse_flow_start_step_index'].item()) != 0:
                raise ValueError('original first-step capture required')
        with np.load(base['conditioning']['path'], allow_pickle=False) as data:
            conditioning = np.asarray(data['cond'], dtype=np.float32)
        if sample.shape != (1, 8, 16, 16, 16) or conditioning.shape != (1, 1029, 1024) or not np.isfinite(sample).all() or not np.isfinite(conditioning).all():
            raise ValueError('complete finite first-step inputs required')
        for name, values in [('sample', sample), ('conditioning', conditioning)]:
            if hashlib.sha256(np.asarray(values, dtype='<f4', order='C').tobytes()).hexdigest() != base['tensors'][name]['sha256']:
                raise ValueError(f'capture differs from exported flow {name}')
        os.environ['TRELLIS2MLX_ATTENTION_BACKEND'] = 'fast'
        os.environ['TRELLIS2MLX_QK_NORM_BACKEND'] = 'mlx-sum'
        sys.path.insert(0, str(root))
        import mlx.core as mx
        from trellmlx.models.sparse_structure_flow import SparseStructureFlowModel
        from trellmlx.weight_loader import load_weights
        from trellmlx.samplers import flow_euler_sample, dense_cfg_rescale_std_backend_identity
        from trellmlx.modules.attention import qk_norm_backend_identity
        from trellmlx.sparse_flow_layernorm import sparse_flow_layernorm_backend_identity
        from trellmlx.sparse_flow_rope import sparse_flow_rope_backend_identity
        names = {'guidanceStrength': 'guidance_strength', 'guidanceRescale': 'guidance_rescale',
            'guidanceInterval': 'guidance_interval', 'rescaleT': 'rescale_t', 'sigmaMin': 'sigma_min'}
        signature = inspect.signature(flow_euler_sample)
        config = {'steps': steps, **{key: signature.parameters[value].default for key, value in names.items()}}
        config['guidanceInterval'] = list(config['guidanceInterval'])
        report['config'] = config
        report['configSource'] = {'steps': 'captured NPZ integer', 'other': 'pinned source sampler literal defaults, not rounded serialized F32 config'}
        times = np.linspace(1, 0, steps + 1)
        times = config['rescaleT'] * times / (1 + (config['rescaleT'] - 1) * times)
        coefficient = config['sigmaMin'] + (1 - config['sigmaMin']) * times[0]
        report['clock'] = {'index': 0, 'time': float(times[0]), 'previousTime': float(times[1]), 'modelTime': float(np.float32(1000 * times[0])),
            'dt': float(np.float32(times[0] - times[1])), 'coefficient': float(np.float32(coefficient)),
            'inverseCoefficient': float(np.float32(1 / coefficient)), 'guided': True}
        report['phase'] = 'model-load'
        model = SparseStructureFlowModel()
        skipped = load_weights(model, str(checkpoint), verbose=False)
        if skipped or len(model.blocks) != 30:
            raise ValueError('complete source sparse checkpoint required')
        report['effectiveBackend'] = {'device': str(mx.default_device()), 'attention': 'fast', 'qk': qk_norm_backend_identity(),
            'layernorm': sparse_flow_layernorm_backend_identity(), 'rope': sparse_flow_rope_backend_identity(),
            'terminal': model.terminal_linear_backend_identity(4096),
            'std': dense_cfg_rescale_std_backend_identity(tuple(sample.shape), dtype='float32'),
            'conditioningKV': 'source builds positive/negative caches once; browser recomputes projections per branch'}
        if mx.default_device() != mx.gpu:
            raise ValueError('source sampler reference requires MLX GPU')
        class ObservedModel:
            def build_cross_kv_cache(self, cond):
                return model.build_cross_kv_cache(cond)
            def __call__(self, *values, **kwargs):
                report['modelAttempts'] += 1
                result = model(*values, **kwargs)
                mx.eval(result)
                report['modelCalls'] += 1
                report['blocksExecuted'] += len(model.blocks)
                return result
        report['phase'] = 'source-first-sampler-step'
        capture = {}
        result = flow_euler_sample(ObservedModel(), mx.array(sample), mx.array(conditioning), mx.zeros(conditioning.shape, dtype=mx.float32),
            steps=steps, verbose=False, stop_after_first_step=True, capture_first_step=capture,
            **{value: config[key] for key, value in names.items()})
        mx.eval(result)
        report['stepsExecuted'] = 1
        mapping = {'positive': 'pred_pos', 'negative': 'pred_neg', 'guided': 'pred_cfg', 'x0Positive': 'x0_pos', 'x0Guided': 'x0_cfg',
            'rescaled': 'x0_rescaled', 'mixed': 'x0_after_rescale', 'final': 'pred_final', 'sample': 'sample_next'}
        values = {name: np.asarray(capture[key].astype(mx.float32)) for name, key in mapping.items()}
        values['stds'] = np.array([np.asarray(capture['std_pos']).item(), np.asarray(capture['std_cfg']).item()], dtype=np.float32)
        report['phase'] = 'output-export'
        for name, value in values.items():
            value = np.asarray(value, dtype='<f4', order='C')
            if not np.isfinite(value).all():
                raise ValueError(f'nonfinite reference {name}')
            file = args.out / f'{name}.f32'
            value.tofile(file)
            report['tensors'][name] = {'file': file.name, 'shape': list(value.shape), 'dtype': 'float32', 'byteLength': value.nbytes, 'sha256': digest(file)}
        report['positiveVsUncachedFullFlow'] = {'byteIdentical': report['tensors']['positive']['sha256'] == base['tensors']['expected.prediction']['sha256'],
            'referenceSha256': base['tensors']['expected.prediction']['sha256']}
        report['phase'] = 'post-source-admission'
        for name, base_root, commit in [('source', root, report['source']['commit']), ('producer', args.repo_root, args.expected_commit)]:
            state = {'commit': git(base_root, 'rev-parse', 'HEAD'), 'dirty': git(base_root, 'status', '--porcelain')}
            report[name + 'After'] = state
            if state['commit'] != commit or state['dirty']:
                raise ValueError(f'{name} changed during sampler reference')
        report['status'] = 'succeeded'
        report['phase'] = None
    except Exception as error:
        report['error'] = {'type': type(error).__name__, 'message': str(error)}
    finally:
        report['elapsedSeconds'] = time.perf_counter() - started
        (args.out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'phase': report['phase'], 'manifest': str(args.out / 'manifest.json'), 'error': report.get('error')}))
    return 0 if report['status'] == 'succeeded' else 1


if __name__ == '__main__':
    sys.exit(main())
