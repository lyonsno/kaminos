"""Pack the WiLoR hand detector (YOLOv8m-pose, 2 classes, 21 keypoints) for the browser.

Reads the WiLoR-MLX `hand-detector.safetensors` (MLX layout: conv weights
[out, kh, kw, in]) and writes one kit model-resource bundle with convolution
weights as [out, in, kh, kw] and inference BatchNorm (eps 1e-3, as WiLoR-MLX
builds it) folded into each Conv block: w' = w * g / sqrt(v + eps),
b' = beta - m * g / sqrt(v + eps). Tensor names keep the MLX module paths.

The DFL convolution weight is not packed: WiLoR-MLX decodes boxes with fixed
bin weights 0..15 and never reads it; the report records whether the stored
weight equals those bins.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np

SCHEMA = 'wilor-hand-detector.browser-weight-package.v0'
MODEL_ID = 'wilor.hand-detector.yolov8m-pose'
WEIGHTS_SHA256 = '266890896e0ac1b46c39fe48035c09e90e41b36cd8d79c11e483234fafc5bdf3'
SOURCE_REVISION = 'acf8b06f9376e9c8a10a653a67b6a0a6d9fcb431'
BN_EPS = 1e-3
ALIGN = 256
STORAGE_COPY_DST = 0x0080 | 0x0008


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fold(arrays):
    out, consumed = [], set()
    blocks = sorted({key[:-len('.conv.weight')] for key in arrays if key.endswith('.conv.weight') and f'{key[:-len(".conv.weight")]}.bn.weight' in arrays})
    for block in blocks:
        w = arrays[f'{block}.conv.weight'].astype(np.float64)
        g, b = arrays[f'{block}.bn.weight'].astype(np.float64), arrays[f'{block}.bn.bias'].astype(np.float64)
        m, v = arrays[f'{block}.bn.running_mean'].astype(np.float64), arrays[f'{block}.bn.running_var'].astype(np.float64)
        scale = g / np.sqrt(v + BN_EPS)
        out.append((f'{block}.weight', (w.transpose(0, 3, 1, 2) * scale[:, None, None, None]).astype('<f4')))
        out.append((f'{block}.bias', (b - m * scale).astype('<f4')))
        consumed.update(f'{block}.{part}' for part in ('conv.weight', 'bn.weight', 'bn.bias', 'bn.running_mean', 'bn.running_var'))
    # Plain convolutions with bias: the last layer of each head branch.
    for key in sorted(arrays):
        if key in consumed or key == 'pose.dfl.conv.weight' or not key.endswith('.weight'):
            continue
        stem = key[:-len('.weight')]
        w = arrays[key]
        if w.ndim != 4 or f'{stem}.bias' not in arrays:
            raise ValueError(f'unrecognized detector tensor {key} {w.shape}')
        out.append((key, np.ascontiguousarray(w.transpose(0, 3, 1, 2)).astype('<f4')))
        out.append((f'{stem}.bias', arrays[f'{stem}.bias'].astype('<f4')))
        consumed.update((key, f'{stem}.bias'))
    left = sorted(set(arrays) - consumed - {'pose.dfl.conv.weight'})
    if left:
        raise ValueError(f'unpacked detector tensors: {left}')
    return out


def write_bundle(out, resource_id, tensors, revision):
    path = out / f'{resource_id}.bin'
    rows, offset = [], 0
    with path.open('wb') as f:
        for name, values in tensors:
            f.seek(offset)
            f.write(np.ascontiguousarray(values).tobytes())
            rows.append({'name': name, 'dtype': 'f32', 'shape': list(values.shape),
                         'byteOffset': offset, 'byteLength': values.nbytes})
            offset = (offset + values.nbytes + ALIGN - 1) // ALIGN * ALIGN
        f.truncate(offset)
    return {'resourceId': resource_id, 'file': path.name,
            'manifest': {'modelId': MODEL_ID, 'revision': revision,
                         'bundle': {'byteLength': path.stat().st_size, 'sha256': digest(path)},
                         'allocations': [{'allocationId': f'{resource_id}.0', 'byteOffset': 0, 'byteLength': offset,
                                          'usage': STORAGE_COPY_DST, 'tensors': rows}]}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--weights', type=Path, required=True, help='WiLoR-MLX hand-detector.safetensors')
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': SCHEMA, 'status': 'failed', 'phase': 'inputs', 'resources': []}
    start = time.perf_counter()
    try:
        sha = digest(args.weights)
        if sha != WEIGHTS_SHA256:
            raise ValueError(f'detector weights sha256 {sha} is not the WiLoR-MLX hand detector')
        from safetensors.numpy import load_file
        arrays = load_file(str(args.weights))
        dfl = arrays.get('pose.dfl.conv.weight')
        report['provenance'] = {'weightsSha256': sha, 'weightsFile': args.weights.name, 'sourceRevision': SOURCE_REVISION,
                                'source': 'WiLoR-MLX src/wilor_mlx/detector.py', 'bnEps': BN_EPS}
        report['unusedByForward'] = ['pose.dfl.conv.weight']
        report['dflWeightIsBinIndex'] = bool(dfl is not None and np.array_equal(dfl.reshape(-1), np.arange(16, dtype=dfl.dtype)))
        report['phase'] = 'fold'
        tensors = fold(arrays)
        revision = f'BasinShapers/wilor-mlx:hand-detector:{sha[:16]}:f32-bn-folded'
        report.update(revision=revision, dtype='f32', tensorCount=len(tensors),
                      parameterCount=int(sum(v.size for _, v in tensors)), inputSize=512, classes=['left', 'right'],
                      keypoints=21, strides=[8, 16, 32])
        report['phase'] = 'bundle-write'
        report['resources'].append(write_bundle(args.out, 'hand-detector', tensors, revision))
        report['totalBytes'] = report['resources'][0]['manifest']['bundle']['byteLength']
        report['status'] = 'succeeded'
        report['phase'] = 'complete'
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['durationSeconds'] = time.perf_counter() - start
        (args.out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
