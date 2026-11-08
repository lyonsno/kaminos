"""Alpha-only surface-patch experiment; all source rows retained at every level."""
import argparse
import hashlib
import heapq
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import traceback
import numpy as np


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unit(a):
    lengths = np.linalg.norm(a, axis=-1, keepdims=True)
    if np.any(lengths < 1e-12):
        raise ValueError('Zero source direction')
    return a / lengths


def canonical_normals(a):
    n = unit(a)
    biggest = np.argmax(np.abs(n), axis=1)
    return n * np.where(n[np.arange(len(n)), biggest] < 0, -1, 1)[:, None]


def partition(rows, counts, radius):
    if rows.ndim != 2 or rows.shape[1] != 12 or not np.isfinite(rows).all() or radius <= 0:
        raise ValueError('Finite source rows and positive radius required')
    if not counts or min(counts) < 1 or max(counts) > len(rows):
        raise ValueError('Carrier count must lie within source count')
    features = np.concatenate([rows[:, :3], canonical_normals(rows[:, 3:6]) * radius * 4], axis=1)
    groups, queue, serial = {}, [], 0

    def add(ids):
        nonlocal serial
        key = serial
        serial += 1
        groups[key] = ids
        if len(ids) > 1:
            variance = np.var(features[ids], axis=0)
            axis = int(np.argmax(variance))
            heapq.heappush(queue, (-float(variance[axis] * len(ids)), key, axis))

    add(np.arange(len(rows), dtype=np.uint32))
    wanted, levels = set(counts), {}
    while True:
        if len(groups) in wanted:
            levels[len(groups)] = [groups[k].copy() for k in sorted(groups)]
        if len(groups) >= max(counts):
            return levels
        _, key, axis = heapq.heappop(queue)
        ids = groups.pop(key)
        # Stable tie-breaking makes independently requested levels reproducible.
        order = np.lexsort((ids, features[ids, axis]))
        mid = len(ids) // 2
        add(ids[order[:mid]])
        add(ids[order[mid:]])


def patch(rows, radius):
    visible = rows[rows[:, 11] > 0]
    if not len(visible):
        raise ValueError('No visible support')
    p = visible[:, :3].astype(np.float64)
    center = p.mean(0)
    normals = canonical_normals(visible[:, 3:6])
    n = normals.mean(0)
    if np.linalg.norm(n) < 1e-8:
        n = normals[0]
    n = unit(n)
    axis = np.array([0., 0., 1.]) if abs(n[2]) < .9 else np.array([0., 1., 0.])
    u = unit(np.cross(axis, n))
    v = np.cross(n, u)
    tangent = np.stack([(p - center) @ u, (p - center) @ v], axis=1)
    if len(p) > 1:
        _, vectors = np.linalg.eigh(tangent.T @ tangent)
        direction = vectors[:, -1]
        u = unit(u * direction[0] + v * direction[1])
        v = np.cross(n, u)
    xy = np.stack([(p - center) @ u, (p - center) @ v], axis=1)
    lo, hi = xy.min(0) - radius, xy.max(0) + radius
    offset = (lo + hi) / 2
    center = center + u * offset[0] + v * offset[1]
    half = (hi - lo) / 2
    z = (p - center) @ n
    return np.concatenate([center, u, v, n, half, [z.min(), z.max()]]).astype(np.float32)


def coverage(points, rows, direction, radius):
    rows = rows[rows[:, 11] > 0]
    if not len(rows):
        return np.zeros(len(points), np.float32)
    normals = unit(rows[:, 3:6])
    denom = normals @ direction
    valid = np.abs(denom) > 1e-6
    centers, normals, denom = rows[valid, :3], normals[valid], denom[valid]
    if not len(centers):
        return np.zeros(len(points), np.float32)
    # Ray/finite-disc intersection projected onto the carrier. No fitted UDF.
    delta = points[:, None, :] - centers[None, :, :]
    t = -np.sum(delta * normals[None, :, :], axis=2) / denom[None, :]
    residual = delta + t[:, :, None] * direction
    return (np.sum(residual * residual, axis=2) <= radius * radius).any(1).astype(np.float32)


def bake(rows, header, radius, size):
    values = np.zeros((size, size), np.float32)
    y, x = np.mgrid[:size, :size]
    for ox, oy in [(.25, .25), (.75, .25), (.25, .75), (.75, .75)]:
        uv = np.stack([(x.ravel() + ox) / size, (y.ravel() + oy) / size], axis=1) * 2 - 1
        q = header[:3] + uv[:, :1] * header[12] * header[3:6] + uv[:, 1:] * header[13] * header[6:9]
        # Small point batches bound temporary pairwise matrices, not retained data.
        result = np.concatenate([coverage(q[s:s + 128], rows, header[9:12], radius) for s in range(0, len(q), 128)])
        values += result.reshape(size, size) * .25
    return values


def load_source(path):
    meta = json.loads((path / 'report.json').read_text())
    if not meta.get('ok'):
        raise ValueError('Successful source report required')
    if meta.get('schema') == 'kaminos.microstructure-control.v1':
        name, expected = 'rows.f32', meta['files']['rows.f32']['sha256']
    else:
        name, expected = 'surfels.f32', meta['dataSHA256']
    if digest(path / name) != expected:
        raise ValueError('Source hash mismatch')
    rows = np.fromfile(path / name, '<f4').reshape(-1, 12)
    if len(rows) != meta['count']:
        raise ValueError('Source count mismatch')
    return meta, rows, expected


def fit(masks, out, grid_size, steps):
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    from mlx.utils import tree_flatten
    if not mx.metal.is_available():
        raise RuntimeError('Native MLX Metal required')
    mx.set_default_device(mx.gpu)
    mx.random.seed(1108)
    count, resolution, _ = masks.shape
    truth = mx.array(masks.reshape(-1))

    class Model(nn.Module):
        def __init__(self):
            super().__init__()
            self.grid = mx.random.normal((count * grid_size * grid_size, 4)) * .1
            self.layers = [nn.Linear(4, 8), nn.Linear(8, 8), nn.Linear(8, 1)]

        def __call__(self, flat):
            patch_id = flat // (resolution * resolution)
            pixel = flat % (resolution * resolution)
            uv = mx.stack([(pixel % resolution + .5) / resolution, (pixel // resolution + .5) / resolution], axis=1)
            p = uv * (grid_size - 1)
            low = mx.minimum(mx.floor(p).astype(mx.int32), grid_size - 2)
            f = p - low
            value = mx.zeros((len(flat), 4))
            for x in range(2):
                for y in range(2):
                    coord = low + mx.array([x, y])
                    index = patch_id * grid_size ** 2 + coord[:, 1] * grid_size + coord[:, 0]
                    weight = (f[:, 0] if x else 1 - f[:, 0]) * (f[:, 1] if y else 1 - f[:, 1])
                    value = value + self.grid[index] * weight[:, None]
            for layer in self.layers[:-1]:
                value = mx.maximum(layer(value), 0)
            return self.layers[-1](value)[:, 0]

    model = Model()
    optimizer = optim.Adam(.01)

    def loss(model, indices):
        logits = model(indices)
        return mx.mean(mx.logaddexp(logits, mx.array(0.)) - truth[indices] * logits)

    vg = nn.value_and_grad(model, loss)
    started = time.monotonic()
    losses = []
    for step in range(steps):
        indices = mx.random.randint(0, masks.size, (4096,))
        value, gradients = vg(model, indices)
        optimizer.update(model, gradients)
        mx.eval(model.parameters(), optimizer.state, value)
        if not np.isfinite(float(value)):
            raise RuntimeError('Nonfinite alpha fitting loss')
        if step == 0 or (step + 1) % 256 == 0 or step + 1 == steps:
            item = {'step': step + 1, 'loss': float(value)}
            losses.append(item)
            print(json.dumps(item), flush=True)
    train_seconds = time.monotonic() - started
    params = {name: np.array(value).astype('<f4') for name, value in tree_flatten(model.parameters())}
    # GPU samples the same exported half-float feature texture, not hidden FP32 codes.
    params['grid'] = params['grid'].astype('<f2')
    model.grid = mx.array(params['grid'].astype(np.float32))
    predictions = []
    for start in range(0, masks.size, 8192):
        predictions.append(np.array(mx.sigmoid(model(mx.arange(start, min(start + 8192, masks.size))))))
    prediction = np.concatenate(predictions).reshape(masks.shape)
    prediction.astype('<f4').tofile(out / 'alpha-predictions.f32')
    files = {}
    for name, value in params.items():
        file = name.replace('.', '-') + ('.f16' if name == 'grid' else '.f32')
        value.tofile(out / file)
        files[name] = {'file': file, 'shape': list(value.shape), 'dtype': str(value.dtype), 'bytes': value.nbytes, 'sha256': digest(out / file)}
    union = np.logical_or(prediction >= .5, masks >= .5).sum()
    return {'schema': 'kaminos.alpha-model.v1', 'layers': [4, 8, 8, 1], 'gridSize': grid_size, 'files': files,
            'carrierCount': count, 'sourceMaskResolution': resolution, 'trainingSteps': steps, 'trainingSeconds': train_seconds,
            'losses': losses, 'backend': 'mlx-metal', 'fallback': False, 'fitPixelMAE': float(np.abs(prediction - masks).mean()),
            'fitMaskIoU': float(np.logical_and(prediction >= .5, masks >= .5).sum() / max(union, 1)),
            'parameterBytes': sum(f['bytes'] for f in files.values()), 'evaluation': 'all baked texel centers after FP16 export; not heldout view fidelity'}


def run(a, report):
    started = time.monotonic()
    meta, rows, sha = load_source(a.source)
    radius = float(meta['radius'])
    report.update(source=str(a.source), sourceSHA256=sha, sourceCount=len(rows), radius=radius,
                  regionYUp=meta.get('regionYUp'), reference='all retained source discs, not triangle mesh')
    report['phase'] = 'partition'
    levels = partition(rows, a.counts, radius)
    report['levels'] = []
    for count in a.counts:
        report['phase'] = f'prepare-{count}'
        out = a.output / str(count)
        out.mkdir(parents=True, exist_ok=True)
        groups = levels[count]
        headers = np.stack([patch(rows[g], radius) for g in groups]).astype('<f4')
        headers.tofile(out / 'patches.f32')
        parents = np.empty(len(rows), '<u4')
        for i, group in enumerate(groups):
            parents[group] = i
        parents.tofile(out / 'parent.u32')
        item = {'count': count, 'sourceCount': len(rows), 'sourceSHA256': sha, 'radius': radius,
                'patchesSHA256': digest(out / 'patches.f32'), 'parentSHA256': digest(out / 'parent.u32'),
                'patchStride': 16, 'normalThicknessP95': float(np.quantile(headers[:, 15] - headers[:, 14], .95)),
                'projection': 'orthographic union of finite source discs onto each fixed carrier plane; depth inside group flattened'}
        if count in a.learn:
            report['phase'] = f'bake-{count}'
            bake_started = time.monotonic()
            masks = np.stack([bake(rows[g], h, radius, a.resolution) for g, h in zip(groups, headers)])
            encoded = np.rint(masks * 255).astype('u1')
            encoded.tofile(out / 'alpha.u8')
            item.update(maskResolution=a.resolution, maskSHA256=digest(out / 'alpha.u8'), bakeSeconds=time.monotonic() - bake_started)
            report['phase'] = f'fit-{count}'
            model = fit(encoded.astype(np.float32) / 255, out, a.grid, a.steps)
            model.update(sourceSHA256=sha, patchesSHA256=item['patchesSHA256'])
            (out / 'model.json').write_text(json.dumps(model, indent=2))
            item['model'] = model
        (out / 'report.json').write_text(json.dumps(item, indent=2))
        report['levels'].append(item)
        (a.output / 'report.json').write_text(json.dumps(report, indent=2))
    report.update(ok=True, phase='done', elapsedSeconds=time.monotonic() - started)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--counts', nargs='+', type=int, default=[2000, 4000, 16000])
    parser.add_argument('--learn', nargs='+', type=int, default=[2000, 4000])
    parser.add_argument('--resolution', type=int, default=32)
    parser.add_argument('--grid', type=int, default=4)
    parser.add_argument('--steps', type=int, default=4096)
    a = parser.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    report = {'ok': False, 'phase': 'admission', 'schema': 'kaminos.alpha-ladder.v1', 'requested': {k: str(v) if isinstance(v, Path) else v for k, v in vars(a).items()},
              'repoRoot': str(Path(__file__).resolve().parents[1]), 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'implementationSHA256': digest(Path(__file__)), 'claimCeiling': 'fixed-level alpha-only experiment, no learned depth, appearance, speedup or full mesh parity'}
    try:
        if a.grid < 2 or a.resolution < 2 or a.steps < 1 or not set(a.learn) <= set(a.counts):
            raise ValueError('Valid grid, masks, steps and learned subset required')
        run(a, report)
    except Exception:
        report['error'] = traceback.format_exc()
    finally:
        (a.output / 'report.json').write_text(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
