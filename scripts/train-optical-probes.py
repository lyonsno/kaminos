import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np


def prepare_arrays(rows, probe_count, conditioning='raw-v0'):
    if conditioning not in ['raw-v0', 'source-max-abs-v1']:
        raise ValueError('unknown optical conditioning')
    x = np.asarray([r['features'] for r in rows], dtype=np.float32)
    y = np.asarray([r['label'] for r in rows], dtype=np.float32)
    if x.shape != (len(rows), 9*probe_count+8) or y.shape != (len(rows), 4):
        raise ValueError('invalid feature/label shape')
    if not np.isfinite(x).all() or not np.isfinite(y).all() or (y < 0).any():
        raise ValueError('finite features and nonnegative finite labels required')
    training_y = y.copy()
    source_scale = np.ones(len(rows), dtype=np.float32)
    zero_source = np.zeros(len(rows), dtype=bool)
    if conditioning == 'source-max-abs-v1':
        source = [9*j+k for j in range(probe_count) for k in range(1, 7)]
        amplitude = np.max(np.abs(x[:, source]), axis=1)
        zero_source = amplitude == 0
        # Zero observed source can hide emission between probes; keep those labels.
        source_scale = np.where(zero_source, np.float32(1), amplitude)
        x[:, source] /= source_scale[:, None]
        training_y[:, :3] /= source_scale[:, None]
        if not np.isfinite(x).all() or not np.isfinite(training_y).all():
            raise ValueError('nonfinite source-conditioned features or labels')
    splits = ['train', 'validation', 'test', 'view-test']
    if any(r['split'] not in splits or type(r['resolved']) is not bool for r in rows):
        raise ValueError('invalid split or reference status')
    indices = {s: np.array([i for i, r in enumerate(rows) if r['split'] == s and r['resolved']], dtype=np.int64) for s in splits}
    if any(len(i) == 0 for i in indices.values()):
        raise ValueError('empty resolved split')
    train = indices['train']
    mean = x[train].mean(axis=0, dtype=np.float64).astype(np.float32)
    scale = x[train].std(axis=0, dtype=np.float64).astype(np.float32)
    scale = np.where(scale > 0, scale, 1)
    target_scale = np.maximum(training_y[train].mean(axis=0, dtype=np.float64), 1e-8).astype(np.float32)
    return dict(x=x, y=y, training_y=training_y, source_scale=source_scale, zero_source=zero_source,
                mean=mean, scale=scale, target_scale=target_scale, indices=indices)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--seed', type=int, default=1012)
    parser.add_argument('--patience', type=int, default=30)
    parser.add_argument('--relative-improvement', type=float, default=0.001)
    parser.add_argument('--learning-rate', type=float, default=0.001)
    parser.add_argument('--conditioning', choices=['raw-v0', 'source-max-abs-v1'], default='raw-v0')
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = dict(identity='optical-quantile-pilot-v0', status='running', phase='inputs',
                  claim='three-scanline prediction pilot; not native adaptive rendering or image quality',
                  config=vars(args), started=time.time(), models=[])
    def save():
        (out/'report.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    save()
    try:
        if args.patience <= 0 or not 0 < args.relative_improvement < 1 or args.learning_rate <= 0:
            raise ValueError('invalid convergence settings')
        dataset_path = Path(args.dataset).resolve()
        raw = dataset_path.read_bytes()
        dataset = json.loads(raw)
        report['dataset'] = dict(path=str(dataset_path), sha256=hashlib.sha256(raw).hexdigest())
        if dataset['identity'] != 'optical-probe-dataset-v0' or dataset['status'] != 'observed' or dataset['phase'] != 'complete':
            raise ValueError('complete optical dataset required')
        if sorted(f['probeCount'] for f in dataset['files']) != [3, 5]:
            raise ValueError('both probe budgets required')
        import mlx.core as mx
        import mlx.nn as nn
        import mlx.optimizers as optim
        from importlib.metadata import version
        report['backend'] = dict(name='mlx', version=version('mlx'), numpy=version('numpy'), device=str(mx.default_device()), python=sys.executable)
        if mx.default_device() != mx.gpu:
            raise ValueError('MLX GPU route required')

        class Predictor(nn.Module):
            def __init__(self, width):
                super().__init__()
                self.hidden1 = nn.Linear(width, 32)
                self.hidden2 = nn.Linear(32, 32)
                self.output = nn.Linear(32, 4)
            def __call__(self, x):
                return mx.logaddexp(self.output(nn.relu(self.hidden2(nn.relu(self.hidden1(x))))), 0)

        def quantile_loss(model, x, y):
            residual = y-model(x)
            return mx.mean(mx.maximum(0.95*residual, -0.05*residual))

        for source in dataset['files']:
            n = source['probeCount']
            report['phase'] = f'load-probes{n}'
            save()
            raw = Path(source['path']).read_bytes()
            if hashlib.sha256(raw).hexdigest() != source['sha256']:
                raise ValueError('dataset bytes changed')
            rows = [json.loads(line) for line in raw.splitlines()]
            data = prepare_arrays(rows, n, args.conditioning)
            normalized = (data['x']-data['mean'])/data['scale']
            targets = data['training_y']/data['target_scale']
            train, validation = data['indices']['train'], data['indices']['validation']
            tx, ty = mx.array(normalized[train]), mx.array(targets[train])
            vx, vy = mx.array(normalized[validation]), mx.array(targets[validation])
            mx.random.seed(args.seed+n)
            model = Predictor(normalized.shape[1])
            optimizer = optim.Adam(learning_rate=args.learning_rate)
            gradient = nn.value_and_grad(model, quantile_loss)
            entry = dict(probeCount=n, seed=args.seed+n, architecture=[9*n+8, 32, 32, 4],
                         quantile=0.95, batch='all resolved training rows each epoch', dataset=source,
                         counts={s: len(indices) for s, indices in data['indices'].items()},
                         excludedUnresolved=sum(not r['resolved'] for r in rows), history=[])
            entry['conditioning'] = dict(mode=args.conditioning,
                zeroObservedSourceRows=int(data['zero_source'].sum()),
                hiddenSourceErrorRows=int(np.sum(data['zero_source'] & np.any(data['y'][:, :3] > 0, axis=1))),
                sourceScaleRange=[float(data['source_scale'].min()), float(data['source_scale'].max())],
                conditionedLabelMax=data['training_y'].max(axis=0).tolist())
            report['models'].append(entry)
            checkpoint = out/f'probes{n}.npz'
            best = None
            anchor = None
            stale = 0
            epoch = 0
            report['phase'] = f'train-probes{n}'
            # Patience is a validation-convergence rule, not an epoch cap.
            while stale < args.patience:
                loss, grads = gradient(model, tx, ty)
                optimizer.update(model, grads)
                val = quantile_loss(model, vx, vy)
                mx.eval(model.parameters(), optimizer.state, loss, val)
                epoch += 1
                value = float(val.item())
                train_loss = float(loss.item())
                if not np.isfinite([value, train_loss]).all():
                    raise ValueError('nonfinite optimization loss')
                entry['history'].append(dict(epoch=epoch, train=train_loss, validation=value))
                if best is None or value < best:
                    best = value
                    entry['bestEpoch'] = epoch
                    model.save_weights(str(checkpoint))
                if anchor is None or value < anchor*(1-args.relative_improvement):
                    anchor, stale = value, 0
                else:
                    stale += 1
                save()
            model.load_weights(str(checkpoint))
            prediction = np.asarray(model(mx.array(normalized)))*data['target_scale']
            prediction[:, :3] *= data['source_scale'][:, None]
            if not np.isfinite(prediction).all() or (prediction < 0).any():
                raise ValueError('invalid error prediction')
            prediction_path = out/f'predictions{n}.f32'
            prediction.astype('<f4').tofile(prediction_path)
            entry['predictions'] = dict(path=str(prediction_path), rows=len(rows), sha256=hashlib.sha256(prediction_path.read_bytes()).hexdigest())
            entry['stopping'] = dict(reason='validation plateau', epochs=epoch, patience=args.patience,
                                     relativeImprovement=args.relative_improvement, bestValidation=best)
            entry['metrics'] = {}
            for split in data['indices']:
                for resolved in [True, False]:
                    indices = np.array([i for i, r in enumerate(rows) if r['split'] == split and r['resolved'] == resolved], dtype=np.int64)
                    if not len(indices):
                        continue
                    y, p = data['y'][indices], prediction[indices]
                    entry['metrics'][f'{split}:resolved={resolved}'] = dict(rows=len(indices),
                        underestimation=(p < y).mean(axis=0).tolist(), meanAbsoluteError=np.abs(p-y).mean(axis=0).tolist())
            # Calibrate the numerical estimator only on validation. Zeros cannot
            # be repaired multiplicatively; preserve their missed-error count.
            numeric = np.array([r['numerical'] for r in rows], dtype=np.float64)
            calibration = []
            zero_misses = []
            for channel in range(4):
                a, b = numeric[validation, channel], data['y'][validation, channel]
                active = a > 0
                calibration.append(float(np.quantile(b[active]/a[active], 0.95)) if active.any() else 1.0)
                zero_misses.append(int(np.sum((~active) & (b > 0))))
            entry['numericalCalibration'] = dict(factors=calibration, validationZeroEstimateMisses=zero_misses)
            layers = []
            for layer in [model.hidden1, model.hidden2, model.output]:
                layers.append(dict(weights=np.asarray(layer.weight).tolist(), bias=np.asarray(layer.bias).tolist()))
            artifact = dict(identity='optical-error-mlp-v0', probeCount=n, architecture=entry['architecture'],
                            activations=['relu', 'relu', 'softplus'], mean=data['mean'].tolist(), scale=data['scale'].tolist(),
                            targetScale=data['target_scale'].tolist(), layers=layers, dataset=source)
            if args.conditioning != 'raw-v0':
                artifact.update(identity='optical-error-mlp-v1', conditioning=args.conditioning)
            artifact_path = out/f'model{n}.json'
            artifact_path.write_text(json.dumps(artifact, indent=2, allow_nan=False)+'\n')
            entry['artifact'] = dict(path=str(artifact_path), sha256=hashlib.sha256(artifact_path.read_bytes()).hexdigest())
            save()
        report['phase'] = 'complete'
        report['status'] = 'trained'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        report['finished'] = time.time()
        save()


if __name__ == '__main__':
    main()
