"""Export MobRecon reference tensors from the pinned PyTorch source on CPU F32.

For each input image and square crop box, runs the native live route's own
preprocessing (OpenCV warpAffine to 128x128, left hands flipped, the source's
base_transform) and model forward, and records block-level module outputs with
forward hooks plus the mesh decoder's sampled, lifted and per-layer features.
When a case names a retained native prediction (`native-0000.npz` from the
live CPU route), the exported mesh and landmarks are compared with it so the
reference is tied to the route the operator smoked, not just to this script.

The decoded source pixels and the crop are stored too, so the browser crop and
network can be checked separately. This observer is separate from browser
execution and writes only under --out.
"""
import argparse
import json
from pathlib import Path
import platform
import time

import numpy as np

from mobrecon_source import check_source, crop_rgb, digest, load_model, network_input

SCHEMA = 'mobrecon.reference.v0'
INPUT_SCHEMA = 'mobrecon.reference-inputs.v0'
BLOCK_TYPES = ('Sequential', 'mobile_unit', 'DenseBlock', 'DenseBlock2', 'DenseBlock2_noExpand', 'SenetBlock',
               'DenseStack', 'DenseStack2', 'Reorg', 'AvgPool2d', 'Upsample', 'SpiralDeblock', 'SpiralConv')


def write_tensor(folder, name, value, rows):
    value = np.ascontiguousarray(value)
    dtype = {np.dtype('float32'): 'f32', np.dtype('uint8'): 'u8'}[value.dtype]
    path = folder / f'{name}.bin'
    path.write_bytes(value.astype('<f4' if dtype == 'f32' else 'u1').tobytes())
    rows[name] = {'file': f'{folder.name}/{path.name}', 'dtype': dtype, 'shape': list(value.shape),
                  'sha256': digest(path)}


def run_case(model, case, folder, torch):
    import cv2
    from utils.vis import base_transform
    rows, captured, counts = {}, [], {}
    bgr = cv2.imread(str(case['image']))
    if bgr is None:
        raise ValueError(f'image_decode_failed: {case["image"]}')
    rgb = bgr[..., ::-1].copy()
    crop = crop_rgb(rgb, case['cropBox'], case['handedness'])
    source_input = base_transform(crop, size=128)
    mine = network_input(crop)
    if not np.array_equal(source_input, mine):
        raise ValueError('browser-side normalization formula diverges from base_transform')
    write_tensor(folder, 'source.rgb', rgb, rows)
    write_tensor(folder, 'crop.rgb', crop, rows)
    write_tensor(folder, 'input', source_input, rows)

    handles = []
    for path, module in model.named_modules():
        if type(module).__name__ in BLOCK_TYPES and path:
            def hook(module, args, output, path=path):
                index = counts.get(path, 0)
                counts[path] = index + 1
                captured.append((path if index == 0 else f'{path}#call{index}', output))
            handles.append(module.register_forward_hook(hook))
    decoder = model.decoder3d
    lifted = {}
    def keep_lifted(module, args):
        lifted.setdefault('x', args[0])  # returning None keeps the call's own arguments
    handles.append(decoder.de_layer[0].register_forward_pre_hook(keep_lifted))
    try:
        with torch.inference_mode():
            x = torch.from_numpy(source_input).unsqueeze(0)
            out = model(x)
            latent, uv = model.backbone(x)
            uvc = torch.clamp((uv - 0.5) * 2, -1, 1)
            sampled = decoder.index(latent, uvc).permute(0, 2, 1)
    finally:
        for handle in handles:
            handle.remove()
    seen = set()
    for name, output in captured:
        if name in seen:
            continue  # the second backbone call above repeats the first exactly
        seen.add(name)
        outputs = output if isinstance(output, tuple) else (output,)
        for index, value in enumerate(outputs):
            label = name if len(outputs) == 1 else f'{name}#{index}'
            write_tensor(folder, label, value[0].numpy(), rows)
    write_tensor(folder, 'decoder3d.sampled', sampled[0].numpy(), rows)
    write_tensor(folder, 'decoder3d.lifted', lifted['x'][0].numpy(), rows)
    mesh, uv_pred = out['mesh_pred'][0].numpy(), out['uv_pred'][0].numpy()
    write_tensor(folder, 'mesh_pred', mesh, rows)
    write_tensor(folder, 'uv_pred', uv_pred, rows)
    if not np.isfinite(mesh).all() or mesh.shape != (778, 3) or uv_pred.shape != (21, 2):
        raise ValueError('invalid model output')
    result = {'id': case['id'], 'image': str(case['image']), 'imageSha256': digest(case['image']),
              'cropBox': case['cropBox'], 'handedness': case['handedness'], 'tensors': rows}
    if case.get('nativeNpz'):
        native = np.load(case['nativeNpz'])
        result['native'] = {'npz': str(case['nativeNpz']), 'npzSha256': digest(case['nativeNpz']),
                            'meshMaxAbs': float(np.abs(native['vertices'] - mesh).max()),
                            'uvMaxAbs': float(np.abs(native['uv'] - uv_pred).max())}
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True, help='HandMesh checkout at the pinned revision')
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--inputs', type=Path, required=True, help=f'{INPUT_SCHEMA} JSON: cases of image, cropBox, handedness')
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = {'schema': SCHEMA, 'status': 'failed', 'phase': 'inputs', 'cases': []}
    start = time.perf_counter()
    try:
        spec = json.loads(args.inputs.read_text())
        if spec.get('schema') != INPUT_SCHEMA or not spec.get('cases'):
            raise ValueError(f'{INPUT_SCHEMA} inputs with at least one case required')
        manifest['inputs'] = {'path': str(args.inputs.resolve()), 'sha256': digest(args.inputs)}
        manifest['provenance'] = check_source(args.source, args.checkpoint)
        manifest['phase'] = 'model-load'
        import cv2
        import torch
        torch.set_num_threads(1)
        model, _, _ = load_model(args.source, args.checkpoint)
        manifest['runtime'] = {'backend': 'pytorch', 'device': 'cpu', 'dtype': 'f32', 'torch': torch.__version__,
                               'opencv': cv2.__version__, 'numpy': np.__version__, 'python': platform.python_version(),
                               'threads': 1}
        manifest['phase'] = 'inference'
        for case in spec['cases']:
            folder = args.out / case['id']
            folder.mkdir(exist_ok=True)
            manifest['cases'].append(run_case(model, case, folder, torch))
            (args.out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        manifest['status'] = 'succeeded'
        manifest['phase'] = 'complete'
    except Exception as error:
        manifest['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        manifest['durationSeconds'] = time.perf_counter() - start
        (args.out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
