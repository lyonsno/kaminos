"""Provisional intrinsic fine-disc field compression; not a rendering benchmark."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import traceback
import numpy as np


def distance_targets(points, rows, radius):
    rows = rows[rows[:, 11] > 0]
    if not len(rows):
        raise ValueError('No nonzero-support discs in carrier')
    normals = rows[:, 3:6] / np.linalg.norm(rows[:, 3:6], axis=1, keepdims=True)
    delta = points[:, None, :] - rows[None, :, :3]
    plane = np.sum(delta * normals[None, :, :], axis=2)
    radial = np.sqrt(np.maximum(np.sum(delta * delta, axis=2) - plane * plane, 0))
    distances = np.sqrt(plane * plane + np.maximum(radial - radius, 0) ** 2)
    nearest = np.argmin(distances, axis=1)
    return np.concatenate([distances[np.arange(len(points)), nearest, None], normals[nearest], rows[nearest, 6:11]], axis=1).astype(np.float32)


def load_field(source):
    meta = json.loads((source / 'report.json').read_text())
    if meta.get('schema') != 'kaminos.microstructure-control.v1' or meta.get('ok') is not True or meta.get('colorEncoding') != 'srgb':
        raise ValueError('Successful prepared sRGB field required')
    arrays = {}
    for name, dtype in [('rows.f32', '<f4'), ('carriers.f32', '<f4'), ('source-ids.u32', '<u4')]:
        data = (source / name).read_bytes()
        expected = meta['files'][name]
        if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['sha256']:
            raise ValueError(f'Source identity mismatch: {name}')
        arrays[name] = np.frombuffer(data, dtype=dtype)
    rows = arrays['rows.f32'].reshape((-1, 12))
    carriers = arrays['carriers.f32'].reshape((-1, 8))
    if len(rows) != meta['count'] or len(carriers) != meta['carrierCount'] or len(arrays['source-ids.u32']) != len(rows):
        raise ValueError('Source shapes disagree')
    cursor = 0
    for header in carriers:
        start, count = header[6:]
        if start != cursor or count != int(count) or count <= 0 or np.any(header[:3] >= header[3:6]):
            raise ValueError('Noncontiguous or invalid carrier range/bounds')
        cursor += int(count)
    if cursor != len(rows) or not np.isfinite(rows).all() or not np.isfinite(carriers).all():
        raise ValueError('Incomplete or nonfinite field')
    return meta, rows, carriers


def make_dataset(rows, carriers, radius, samples, seed):
    rng = np.random.default_rng(seed)
    positions, targets, identities = [], [], []
    for i, h in enumerate(carriers):
        lo, hi = h[:3], h[3:6]
        start, count = map(int, h[6:])
        children = rows[start:start + count]
        points = rng.uniform(lo, hi, (samples, 3)).astype(np.float32)
        # Half of the samples buy near-surface evidence; the rest observe the
        # empty space that a trivial "everything is solid" field would fill.
        near = samples // 2
        selected = children[rng.integers(0, count, near)]
        points[:near] = np.clip(selected[:, :3] + rng.normal(0, radius * .4, (near, 3)), lo, hi)
        truth = distance_targets(points, children, radius)
        truth[:, 0] /= radius
        positions.append((points - lo) / (hi - lo))
        targets.append(truth)
        identities.append(np.full(samples, i, dtype=np.int32))
    return {'positions': np.concatenate(positions).astype(np.float32), 'targets': np.concatenate(targets), 'carriers': np.concatenate(identities)}


def metrics(prediction, truth):
    error = np.abs(prediction[:, 0] - truth[:, 0])
    inside, actual = prediction[:, 0] <= .2, truth[:, 0] <= .2
    union = np.logical_or(inside, actual).sum()
    return {'distanceMAERadiusUnits': float(error.mean()), 'distanceP95RadiusUnits': float(np.quantile(error, .95)),
            'normalMSE': float(np.mean((prediction[:, 1:4] - truth[:, 1:4]) ** 2)),
            'materialMSE': float(np.mean((prediction[:, 4:] - truth[:, 4:]) ** 2)),
            'shellThresholdRadiusUnits': .2, 'shellIoU': float(np.logical_and(inside, actual).sum() / max(union, 1)),
            'falseSolid': int(np.logical_and(inside, ~actual).sum()), 'missedShell': int(np.logical_and(~inside, actual).sum()),
            'actualShellSamples': int(actual.sum()), 'samples': len(truth)}


def fit(a, report):
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    from mlx.utils import tree_flatten
    mx.set_default_device(mx.gpu)
    if not mx.metal.is_available() or mx.default_device() != mx.gpu:
        raise RuntimeError('Native MLX Metal GPU required; no CPU fallback')
    report['runtime'] = {'python': sys.executable, 'mlx': importlib.metadata.version('mlx'), 'numpy': np.__version__, 'device': str(mx.default_device()), 'backend': 'mlx-metal', 'fallback': False}
    meta, rows, carriers = load_field(a.source)
    report.update(sourceSHA256=meta['sourceSHA256'], sourceFiles=meta['files'], carrierCount=len(carriers), sourceDiscs=len(rows), radius=meta['radius'])
    report['phase'] = 'teacher'
    train = make_dataset(rows, carriers, meta['radius'], a.samples, a.seed)
    held = make_dataset(rows, carriers, meta['radius'], a.samples, a.seed + 1)
    np.savez(a.output / 'training.npz', **train)
    np.savez(a.output / 'heldout.npz', **held)
    g, features = a.grid, a.features
    mx.random.seed(a.seed)

    class Field(nn.Module):
        def __init__(self):
            super().__init__()
            self.grid = mx.random.normal((len(carriers) * g ** 3, features)) * .1
            self.layers = [nn.Linear(features + 3, a.width), nn.Linear(a.width, a.width), nn.Linear(a.width, 9)]

        def __call__(self, ids, positions):
            p = positions * (g - 1)
            low = mx.minimum(mx.floor(p).astype(mx.int32), g - 2)
            fraction = p - low
            code = mx.zeros((positions.shape[0], features))
            for x in range(2):
                for y in range(2):
                    for z in range(2):
                        coord = low + mx.array([x, y, z], dtype=mx.int32)
                        index = ids * g ** 3 + (coord[:, 0] * g + coord[:, 1]) * g + coord[:, 2]
                        weight = (fraction[:, 0] if x else 1 - fraction[:, 0]) * (fraction[:, 1] if y else 1 - fraction[:, 1]) * (fraction[:, 2] if z else 1 - fraction[:, 2])
                        code = code + self.grid[index] * weight[:, None]
            value = mx.concatenate([code, positions * 2 - 1], axis=1)
            for layer in self.layers[:-1]:
                value = mx.maximum(layer(value), 0)
            raw = self.layers[-1](value)
            return mx.concatenate([mx.logaddexp(raw[:, :1], mx.array(0.)), raw[:, 1:]], axis=1)

    model = Field()
    optimizer = optim.Adam(learning_rate=a.learning_rate)
    mx.eval(model.parameters())
    x, ids, y = mx.array(train['positions']), mx.array(train['carriers']), mx.array(train['targets'])

    def loss_fn(model, ids, positions, truth):
        prediction = model(ids, positions)
        near = mx.exp(-mx.square(truth[:, 0]))
        distance = mx.mean(mx.abs(prediction[:, 0] - truth[:, 0]) * (1 + 3 * near))
        material = mx.mean(mx.square(prediction[:, 1:] - truth[:, 1:]), axis=1)
        return distance + .25 * mx.mean(material * near)

    value_and_grad = nn.value_and_grad(model, loss_fn)

    def predict(dataset):
        result = []
        for start in range(0, len(dataset['positions']), a.batch):
            stop = start + a.batch
            result.append(np.array(model(mx.array(dataset['carriers'][start:stop]), mx.array(dataset['positions'][start:stop]))))
        return np.concatenate(result)

    report['initial'] = metrics(predict(held), held['targets'])
    constants = np.stack([np.mean(train['targets'][train['carriers'] == i], axis=0) for i in range(len(carriers))])
    report['spatialConstantBaseline'] = metrics(constants[held['carriers']], held['targets'])
    report['phase'] = 'train'
    report['losses'] = []
    for step in range(a.steps):
        choice = mx.random.randint(0, len(train['positions']), (a.batch,))
        loss, gradients = value_and_grad(model, ids[choice], x[choice], y[choice])
        optimizer.update(model, gradients)
        mx.eval(model.parameters(), optimizer.state, loss)
        if not np.isfinite(float(loss)):
            raise RuntimeError('Nonfinite training loss')
        if step == 0 or (step + 1) % 64 == 0 or step + 1 == a.steps:
            item = {'step': step + 1, 'loss': float(loss)}
            report['losses'].append(item)
            print(json.dumps(item), flush=True)
    report['phase'] = 'evaluate'
    prediction = predict(held)
    if not np.isfinite(prediction).all():
        raise RuntimeError('Nonfinite learned predictions')
    report['heldout'] = metrics(prediction, held['targets'])
    report['training'] = metrics(predict(train), train['targets'])
    prediction.astype('<f4').tofile(a.output / 'heldout-predictions.f32')
    report['phase'] = 'export'
    model.save_weights(str(a.output / 'model.safetensors'))
    package = {'schema': 'kaminos.microstructure-field.v1', 'grid': g, 'features': features, 'width': a.width, 'layers': [features + 3, a.width, a.width, 9],
               'output': ['distance/radius', 'nx', 'ny', 'nz', 'srgb.r', 'srgb.g', 'srgb.b', 'metallic', 'roughness'],
               'distanceActivation': 'softplus', 'hiddenActivation': 'relu', 'interpolation': 'trilinear', 'gridOrder': 'carrier,x,y,z,feature',
               'sourceSHA256': meta['sourceSHA256'], 'sourceFiles': meta['files'], 'carrierCount': len(carriers), 'radius': meta['radius'], 'files': {}}
    for name, value in tree_flatten(model.parameters()):
        array = np.array(value).astype('<f4')
        filename = name.replace('.', '-') + '.f32'
        array.tofile(a.output / filename)
        package['files'][name] = {'file': filename, 'shape': list(array.shape), 'dtype': 'float32', 'bytes': array.nbytes, 'sha256': hashlib.sha256(array.tobytes()).hexdigest()}
    (a.output / 'model.json').write_text(json.dumps(package, indent=2))
    report['parameterBytes'] = sum(f['bytes'] for f in package['files'].values())
    report['carrierBytes'] = int(carriers.nbytes)
    report['sourcePayloadBytes'] = int(rows.nbytes)
    report['parameterAndCarrierRatio'] = rows.nbytes / (report['parameterBytes'] + carriers.nbytes)
    report['peakMetalMemoryBytes'] = mx.get_peak_memory()
    report['ok'], report['phase'] = True, 'done'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--samples', type=int, default=128)
    p.add_argument('--grid', type=int, default=4)
    p.add_argument('--features', type=int, default=4)
    p.add_argument('--width', type=int, default=32)
    p.add_argument('--steps', type=int, default=512)
    p.add_argument('--batch', type=int, default=2048)
    p.add_argument('--seed', type=int, default=1106)
    p.add_argument('--learning-rate', type=float, default=.003)
    a = p.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    report = {'ok': False, 'phase': 'admission', 'schema': 'kaminos.microstructure-fit.v1', 'requested': {k: str(v) if isinstance(v, Path) else v for k, v in vars(a).items()},
              'repoRoot': str(Path.cwd()), 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'implementationSHA256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'claimCeiling': 'Sampled intrinsic-field fitting, not full surface/angle parity, rendering efficiency or production admission'}
    try:
        if a.samples < 2 or a.grid < 2 or min(a.features, a.width, a.steps, a.batch) <= 0 or not np.isfinite(a.learning_rate) or a.learning_rate <= 0:
            raise ValueError('Positive fitting settings and at least two grid vertices/samples required')
        fit(a, report)
    except Exception:
        report['error'] = traceback.format_exc()
    finally:
        (a.output / 'report.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report), flush=True)
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
