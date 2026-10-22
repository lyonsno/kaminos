"""Pack MobRecon browser weights into one kit model-resource bundle; runs no inference.

Inference-time BatchNorm is folded into the preceding convolution or linear
layer: w' = w * g / sqrt(v + eps), b' = beta - m * g / sqrt(v + eps). Tensors
are named by the module path of the block that owns them (`<path>.weight`,
`<path>.bias`), so the browser graph mirrors the source module tree.

The mesh decoder's fixed topology travels with the weights: the spiral
neighbourhood of every vertex at each level (i32 [N, 9], from the source's own
preprocess_spiral) and each upsampling matrix as three source vertices and
barycentric weights per output vertex (i32/f32 [N, 3]). Level-0 faces (u32
[1538, 3]) are included for rendering. These derive from MANO through
template/transform.pkl, so the package stays local.
"""
import argparse
import json
from pathlib import Path
import time

import numpy as np

from mobrecon_source import check_source, digest, load_model, OUT_CHANNELS, SPIRAL_LENGTH

SCHEMA = 'mobrecon.browser-weight-package.v0'
MODEL_ID = 'mobrecon.densestack-spiralconv'
ALIGN = 256
STORAGE_COPY_DST = 0x0080 | 0x0008
DTYPES = {np.dtype('<f4'): 'f32', np.dtype('<f2'): 'f16', np.dtype('<i4'): 'i32', np.dtype('<u4'): 'u32'}


def executed_modules(model):
    """Module paths that run in one forward. The source builds some modules its
    forward never calls (DenseStack's senet3/dense4/dense5); those stay unpacked."""
    import torch
    ran, handles = set(), []
    for path, module in model.named_modules():
        handles.append(module.register_forward_hook(lambda m, i, o, path=path: ran.add(path)))
    try:
        with torch.inference_mode():
            model(torch.zeros(1, 3, 128, 128))
    finally:
        for handle in handles:
            handle.remove()
    return ran


def folded_tensors(model, ran):
    """(name, array) for every learned tensor the forward uses, BatchNorm folded in.
    Returns (tensors, unused parameter names)."""
    import torch
    nn = torch.nn
    out, consumed = [], set()

    def add(name, value):
        out.append((name, np.ascontiguousarray(value.detach().to(torch.float32).numpy())))

    for path, module in model.named_modules():
        if not isinstance(module, nn.Sequential) or len(module) == 0 or path not in ran:
            continue
        head = module[0]
        if not isinstance(head, (nn.Conv2d, nn.Linear)):
            continue
        weight = head.weight.detach().to(torch.float64)
        bias = head.bias.detach().to(torch.float64) if head.bias is not None else None
        norm = module[1] if len(module) > 1 and isinstance(module[1], (nn.BatchNorm1d, nn.BatchNorm2d)) else None
        if norm is not None:
            scale = norm.weight.detach().to(torch.float64) / torch.sqrt(norm.running_var.detach().to(torch.float64) + norm.eps)
            shift = norm.bias.detach().to(torch.float64) - norm.running_mean.detach().to(torch.float64) * scale
            if bias is not None:
                shift = shift + bias * scale
            weight = weight * scale.reshape(-1, *([1] * (weight.dim() - 1)))
            bias = shift
            consumed.update(id(p) for p in norm.parameters())
            consumed.update(id(b) for b in norm.buffers())
        add(f'{path}.weight', weight)
        if bias is not None:
            add(f'{path}.bias', bias)
        consumed.update(id(p) for p in head.parameters())
    for path, module in model.named_modules():
        if type(module).__name__ == 'SpiralConv' and path in ran:
            add(f'{path}.weight', module.layer.weight)
            add(f'{path}.bias', module.layer.bias)
            consumed.update(id(p) for p in module.layer.parameters())
    add('decoder3d.upsample', model.decoder3d.upsample)
    consumed.add(id(model.decoder3d.upsample))
    unused = []
    for name, p in model.named_parameters():
        if id(p) in consumed:
            continue
        if name.rsplit('.', 1)[0] in ran:
            raise ValueError(f'unpacked learned tensor of an executed module: {name}')
        unused.append(name)
    return out, unused


def topology_tensors(transforms, spirals):
    out = []
    for level, spiral in enumerate(spirals):
        if spiral.shape != (transforms['vertices'][level].shape[0], SPIRAL_LENGTH):
            raise ValueError(f'spiral level {level} shape {spiral.shape}')
        out.append((f'topology.spiral.{level}', spiral.astype('<i4')))
    for level, transform in enumerate(transforms['up_transform']):
        coo = transform.tocoo()
        rows, cols, values = coo.row, coo.col, coo.data
        count = transform.shape[0]
        order = np.lexsort((np.arange(len(rows)), rows))
        rows, cols, values = rows[order], cols[order], values[order]
        if not np.array_equal(np.bincount(rows, minlength=count), np.full(count, 3)):
            raise ValueError(f'up_transform {level} must have exactly three sources per output vertex')
        out.append((f'topology.up.{level}.index', cols.reshape(count, 3).astype('<i4')))
        out.append((f'topology.up.{level}.weight', values.reshape(count, 3).astype('<f4')))
    out.append(('topology.faces', np.asarray(transforms['face'][0]).astype('<u4')))
    return out


def write_bundle(out, resource_id, tensors, revision):
    path = out / f'{resource_id}.bin'
    rows, offset = [], 0
    with path.open('wb') as f:
        for name, values in tensors:
            dtype = DTYPES.get(values.dtype)
            if dtype is None:
                raise ValueError(f'{name}: unsupported dtype {values.dtype}')
            f.seek(offset)
            f.write(np.ascontiguousarray(values).tobytes())
            rows.append({'name': name, 'dtype': dtype, 'shape': list(values.shape) or [1],
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
    p.add_argument('--source', type=Path, required=True, help='HandMesh checkout at the pinned revision')
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': SCHEMA, 'status': 'failed', 'phase': 'inputs', 'resources': []}
    start = time.perf_counter()
    try:
        provenance = check_source(args.source, args.checkpoint)
        report['provenance'] = provenance
        report['phase'] = 'model-load'
        model, transforms, spirals = load_model(args.source, args.checkpoint)
        report['phase'] = 'fold'
        weights, unused = folded_tensors(model, executed_modules(model))
        report['unusedByForward'] = sorted({name.rsplit('.', 2)[0] for name in unused})
        report['unusedParameterCount'] = int(sum(dict(model.named_parameters())[n].numel() for n in unused))
        topology = topology_tensors(transforms, spirals)
        revision = f'SeanChenxy/HandMesh@{provenance["sourceRevision"][:8]}:{provenance["checkpointSha256"][:16]}:f32-bn-folded'
        report.update(revision=revision, dtype='f32', outChannels=OUT_CHANNELS, spiralLength=SPIRAL_LENGTH,
                      vertexCounts=[int(v.shape[0]) for v in transforms['vertices']],
                      tensorCount=len(weights) + len(topology),
                      parameterCount=int(sum(v.size for _, v in weights)))
        report['phase'] = 'bundle-write'
        report['resources'].append(write_bundle(args.out, 'mobrecon', weights + topology, revision))
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
