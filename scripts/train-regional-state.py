#!/usr/bin/env python3
"""Matched regional-information/readout diagnostic. Run training in Greenroom."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from regional_state_data import (load_native_dataset, region_split, channel_scale,
                                optical_features, explicit_moments, target_features,
                                decode_targets, transfer_metrics, quantize_vectors, finite)


def run(args, report, save):
    report['phase'] = 'native-data-admission'
    save()
    data = load_native_dataset(args.capture, args.capture_source)
    report['capture'] = data['sourceReport']
    report['sourceScope'] = data['report']['scope']
    report['reference'] = data['report']['dataset']['reference']
    report['observation'] = data['report']['dataset']['observation']
    nregions = len(data['context'])
    split = region_split(nregions, args.seed)
    rid = data['regionIndex']
    train = np.flatnonzero(np.isin(rid, split['train']))
    held = np.flatnonzero(np.isin(rid, split['heldOut']))
    report['split'] = {**split, 'trainQueries': len(train), 'heldOutQueries': len(held),
                       'authority': 'spatial-region-held-out within one native held state; no temporal/scene generalization'}
    side = data['plan']['contextSide']
    scale = channel_scale(data['context'][split['train']].reshape(-1, 7))
    context = optical_features(data['context'].reshape(nregions, -1, 7), scale).reshape(nregions, -1)
    sparse = optical_features(data['sparse'], scale)
    query = data['query'].copy()
    query[:, :6] = query[:, :6] * 2 - 1
    length_scale = float(np.max(query[train, 6]))
    if length_scale <= 0:
        raise ValueError('training intervals have no length')
    query[:, 6] /= length_scale
    observation_query = np.concatenate([query, sparse], axis=1)
    emission_scale = channel_scale(data['target'][train, :6])
    target = target_features(data['target'], data['tau'], emission_scale)
    explicit = explicit_moments(context, side)
    report['normalization'] = {'opticalScale': scale.tolist(), 'emissionScale': emission_scale.tolist(),
                               'lengthScale': length_scale, 'fittedOn': 'training regions/queries only'}
    report['architecture'] = {'codeWidth': args.code_width, 'encoderHidden': args.encoder_hidden,
                               'generousReaderHidden': args.reader_hidden, 'smallReaderHidden': args.small_hidden,
                               'queryWidth': observation_query.shape[1], 'contextWidth': context.shape[1],
                               'explicitWidth': explicit.shape[1], 'history': False,
                               'representation': 'one shared code per region; explicit one-native-midpoint observation per interval'}
    report['preparationWork'] = {'capturedContextSitesPerSourceUpdate': nregions * side ** 3,
                                  'freshMaterialObservationsPerQuery': 1,
                                  'sharedCodeCount': nregions,
                                  'servingAuthority': 'operation/storage description only; no timing or production preparation implementation'}
    report['phase'] = 'mlx-admission'
    save()
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    from mlx.utils import tree_flatten
    if not mx.metal.is_available():
        raise RuntimeError('Apple Metal MLX execution is unavailable; CPU fallback is not this assay')
    mx.set_default_device(mx.gpu)
    report['runtime'] = {'python': sys.executable, 'mlx': importlib.metadata.version('mlx'),
                         'numpy': np.__version__, 'device': str(mx.default_device()),
                         'metalAvailable': True}
    mx.random.seed(args.seed)

    class Reader(nn.Module):
        def __init__(self, width, hidden):
            super().__init__()
            self.layers = [nn.Linear(width, hidden), nn.Linear(hidden, hidden), nn.Linear(hidden, 7)]

        def __call__(self, x):
            x = self.layers[2](nn.tanh(self.layers[1](nn.tanh(self.layers[0](x)))))
            # The last output is log1p optical depth. Its positivity gives a
            # valid transmission without clipping predicted radiance.
            return mx.concatenate([x[:, :6], nn.softplus(x[:, 6:7])], axis=1)

    class Joint(nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = [nn.Linear(context.shape[1], args.encoder_hidden),
                            nn.Linear(args.encoder_hidden, args.code_width)]
            self.reader = Reader(args.code_width + observation_query.shape[1], args.reader_hidden)

        def encode(self, x):
            return self.encoder[1](nn.tanh(self.encoder[0](x)))

        def __call__(self, inputs):
            c, q, indices = inputs
            return self.reader(mx.concatenate([self.encode(c)[indices], q], axis=1))

    out = Path(args.out)
    arrays = {}
    for name, values in [('normalized-context', context), ('explicit-moments', explicit),
                         ('observation-query', observation_query), ('normalized-target', target)]:
        name = name + '.f32'
        values.astype('<f4').tofile(out / name)
        arrays[name] = {'shape': list(values.shape), 'sha256': hashlib.sha256((out / name).read_bytes()).hexdigest()}
    report['preparedInputs'] = arrays
    report['arms'] = {}

    def fit(name, model, inputs, selected, steps):
        report['phase'] = 'training:' + name
        save()
        desired = mx.array(target[selected])
        if isinstance(inputs, tuple):
            inputs_gpu = (mx.array(inputs[0]), mx.array(inputs[1][selected]), mx.array(inputs[2][selected]))
        else:
            inputs_gpu = mx.array(inputs[selected])
        optimizer = optim.Adam(learning_rate=args.learning_rate)

        def loss_fn(m, x, y):
            return mx.mean((m(x) - y) ** 2)

        value_grad = nn.value_and_grad(model, loss_fn)
        losses = []
        for _ in range(steps):
            loss, gradient = value_grad(model, inputs_gpu, desired)
            optimizer.update(model, gradient)
            mx.eval(model.parameters(), optimizer.state, loss)
            value = float(loss.item())
            if not np.isfinite(value):
                raise ValueError('nonfinite training loss: ' + name)
            losses.append(value)
        # Every optimization step is retained. Steps are an explicit first
        # experiment budget, not a claim of optimization convergence.
        weights = out / (name + '.npz')
        model.save_weights(str(weights))
        count = sum(int(value.size) for _, value in tree_flatten(model.parameters()))
        report['arms'][name] = {'losses': losses, 'trainingQueries': selected.tolist(),
                               'steps': steps, 'parameters': count, 'weights': name + '.npz',
                               'weightsSha256': hashlib.sha256(weights.read_bytes()).hexdigest()}
        if isinstance(model, Joint):
            report['arms'][name]['denseMACs'] = {
                'encoderPerRegionUpdate': context.shape[1] * args.encoder_hidden + args.encoder_hidden * args.code_width,
                'readerPerInterval': (args.code_width + observation_query.shape[1]) * args.reader_hidden + args.reader_hidden ** 2 + args.reader_hidden * 7,
                'authority': 'linear-layer arithmetic count; activations, reads, preparation and dispatch are additional'}
        else:
            report['arms'][name]['denseMACs'] = {
                'readerPerInterval': sum(int(value.size) for key, value in tree_flatten(model.parameters()) if key.endswith('weight')),
                'authority': 'linear-layer arithmetic count; activations, reads and dispatch are additional'}
        save()
        return model

    def observe(name, model, inputs):
        if isinstance(inputs, tuple):
            prediction = model((mx.array(inputs[0]), mx.array(inputs[1]), mx.array(inputs[2])))
        else:
            prediction = model(mx.array(inputs))
        mx.eval(prediction)
        prediction = decode_targets(np.array(prediction), emission_scale)
        prediction.astype('<f4').tofile(out / (name + '-predictions.f32'))
        result = report['arms'].setdefault(name, {})
        result.update({'train': transfer_metrics(prediction[train], data['target'][train]),
                       'heldOut': transfer_metrics(prediction[held], data['target'][held]),
                       'predictions': name + '-predictions.f32',
                       'predictionSha256': hashlib.sha256((out / (name + '-predictions.f32')).read_bytes()).hexdigest()})
        result['perRegion'] = {str(region): transfer_metrics(prediction[rid == region], data['target'][rid == region]) for region in range(nregions)}
        save()

    # First distinguish a fitting/wiring failure on a nonempty single region.
    energy = np.sum(np.abs(data['target'][:, :6]), axis=1) + data['tau']
    wire_region = max(split['train'], key=lambda r: float(np.sum(energy[rid == r])))
    wire = np.flatnonzero(rid == wire_region)
    full_input = np.concatenate([context[rid], observation_query], axis=1)
    model = fit('one-region-wiring', Reader(full_input.shape[1], args.reader_hidden), full_input, wire, args.steps)
    observe('one-region-wiring', model, full_input)
    report['arms']['one-region-wiring']['claim'] = 'one-region fitting only; neither its all-region metrics nor training fit establish generalization'

    for name, features in [('sparse-only-reader', observation_query),
                            ('full-context-reader', full_input),
                            ('explicit-moments-reader', np.concatenate([explicit[rid], observation_query], axis=1))]:
        model = fit(name, Reader(features.shape[1], args.reader_hidden), features, train, args.steps)
        observe(name, model, features)

    joint = fit('joint-regional-encoder', Joint(), (context, observation_query, rid), train, args.steps)
    observe('joint-regional-encoder', joint, (context, observation_query, rid))
    codes_gpu = joint.encode(mx.array(context))
    mx.eval(codes_gpu)
    codes = finite(np.array(codes_gpu), 'learned regional codes')
    codes.astype('<f4').tofile(out / 'frozen-codes.f32')
    code_digest = hashlib.sha256((out / 'frozen-codes.f32').read_bytes()).hexdigest()
    report['frozenCode'] = {'shape': list(codes.shape), 'path': 'frozen-codes.f32', 'sha256': code_digest,
                             'encoder': 'joint-regional-encoder.npz', 'freezeBeforeIndependentReaders': True}
    save()
    features = np.concatenate([codes[rid], observation_query], axis=1)
    strong = fit('frozen-code-generous-reader', Reader(features.shape[1], args.reader_hidden), features, train, args.steps)
    observe('frozen-code-generous-reader', strong, features)
    small = fit('frozen-code-small-reader', Reader(features.shape[1], args.small_hidden), features, train, args.steps)
    observe('frozen-code-small-reader', small, features)
    report['precision'] = {}
    for bits in (16, 8, 4):
        quantized, cost = quantize_vectors(codes, bits)
        name = f'frozen-code-{bits}bit-same-reader'
        report['precision'][str(bits)] = cost
        observe(name, small, np.concatenate([quantized[rid], observation_query], axis=1))
    # Separate readout adaptation from fixed-reader damage. This does not
    # masquerade as end-to-end quantization-aware encoder training.
    quantized, _ = quantize_vectors(codes, 4)
    features = np.concatenate([quantized[rid], observation_query], axis=1)
    adapted = fit('frozen-code-4bit-adapted-small-reader', Reader(features.shape[1], args.small_hidden), features, train, args.steps)
    observe('frozen-code-4bit-adapted-small-reader', adapted, features)
    assert hashlib.sha256((out / 'frozen-codes.f32').read_bytes()).hexdigest() == code_digest
    for name, prediction in [('native-one-point', data['onePoint']), ('nested-reference', data['coarse'])]:
        report['arms'][name] = {'train': transfer_metrics(prediction[train], data['target'][train]),
                               'heldOut': transfer_metrics(prediction[held], data['target'][held])}
    report['state'] = 'diagnostic-comparison-produced'
    report['limitations'] = [
        'One recreated held native source; spatial-region holdout is not a held-out scene or trajectory.',
        'Source-context is the complete captured optical brick, not the full raw simulation stencil.',
        'Finite native quadrature is a reference with reported nested differences, not certified convergence.',
        'Encoder and readout capacity, training budget and code size are experimental choices.',
        'No temporal state, actual retained-observation continuation, confidence policy or production speedup is established.',
        'Precision results use per-vector affine storage and simulated dequantization, not TurboQuant or measured packed runtime kernels.',
        'Native image composition and motion remain the consumer criteria after this information/readout diagnostic.',
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--capture')
    parser.add_argument('--capture-source')
    parser.add_argument('--out', required=True)
    parser.add_argument('--steps', type=int, default=400)
    parser.add_argument('--code-width', type=int, default=32)
    parser.add_argument('--encoder-hidden', type=int, default=64)
    parser.add_argument('--reader-hidden', type=int, default=128)
    parser.add_argument('--small-hidden', type=int, default=32)
    parser.add_argument('--learning-rate', type=float, default=.002)
    parser.add_argument('--seed', type=int, default=1108)
    raw_invocation = sys.argv[1:]
    destination = None
    for i, value in enumerate(raw_invocation):
        if value == '--':
            break
        if value.startswith('--out='):
            destination = value[6:]
        elif value == '--out' and i + 1 < len(raw_invocation) and not raw_invocation[i + 1].startswith('--'):
            destination = raw_invocation[i + 1]
    if not destination:
        parser.parse_args()  # Preserve normal help/errors when no report path is recoverable.
        raise ValueError('--out is required to retain a report')
    out = Path(destination).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {'identity': 'regional-information-and-readout-diagnostic-v0', 'status': 'running',
              'phase': 'arguments', 'requested': None, 'rawInvocation': raw_invocation, 'started': time.time(),
              'claim': 'matched finite-source diagnostic; no final-image, temporal or runtime-benefit claim'}
    def save():
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    save()
    try:
        args = parser.parse_args(raw_invocation)
        report['requested'] = vars(args)
        report['phase'] = 'inputs'
        if not args.capture or not args.capture_source:
            raise ValueError('--capture and --capture-source are required native input identities')
        if any(getattr(args, key) <= 0 for key in ['steps', 'code_width', 'encoder_hidden', 'reader_hidden', 'small_hidden']):
            raise ValueError('training budget and model dimensions must be positive')
        if not np.isfinite(args.learning_rate) or args.learning_rate <= 0:
            raise ValueError('learning rate must be finite and positive')
        root = Path(__file__).resolve().parents[1]
        git = lambda *argv: subprocess.check_output(['git', *argv], cwd=root, text=True).strip()
        report['source'] = {'root': str(root), 'commit': git('rev-parse', 'HEAD'), 'dirty': bool(git('status', '--porcelain'))}
        if report['source']['dirty']:
            raise ValueError('training requires a committed source tree')
        run(args, report, save)
        report['phase'] = 'source-postflight'
        if git('rev-parse', 'HEAD') != report['source']['commit'] or git('status', '--porcelain'):
            raise ValueError('training source changed during execution')
        report['status'] = 'observed'
        report['phase'] = 'complete'
    except (Exception, SystemExit) as error:
        report['status'] = 'failed'
        report['failurePhase'] = report['phase']
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished'] = time.time()
        save()


if __name__ == '__main__':
    main()
