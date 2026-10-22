"""Export WiLoR hand detector reference tensors by running WiLoR-MLX itself.

For each image, decodes it the way the native live route does (OpenCV, BGR to
RGB), letterboxes it with WiLoR-MLX's own `_crop_and_resize_mlx` (512x512, pad
114), runs `HandDetector` stage by stage to record backbone, FPN and head
features (stored CHW), the raw (69, 5376) output, and the detections the
WiLoR-MLX pipeline returns at the requested thresholds. Writes only under --out.
"""
import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

import numpy as np

SCHEMA = 'wilor-hand-detector.reference.v0'
SOURCE_REVISION = 'acf8b06f9376e9c8a10a653a67b6a0a6d9fcb431'
WEIGHTS_SHA256 = '266890896e0ac1b46c39fe48035c09e90e41b36cd8d79c11e483234fafc5bdf3'


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def write_tensor(folder, name, value, rows):
    value = np.ascontiguousarray(value)
    dtype = {np.dtype('float32'): 'f32', np.dtype('uint8'): 'u8'}[value.dtype]
    path = folder / f'{name}.bin'
    path.write_bytes(value.tobytes())
    rows[name] = {'file': f'{folder.name}/{path.name}', 'dtype': dtype, 'shape': list(value.shape), 'sha256': digest(path)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True, help='WiLoR-MLX checkout at the pinned revision')
    p.add_argument('--weights', type=Path, required=True)
    p.add_argument('--images', type=Path, required=True, help='JSON list of {id, image}')
    p.add_argument('--thresholds', default='0.18,0.3')
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = {'schema': SCHEMA, 'status': 'failed', 'phase': 'inputs', 'cases': []}
    start = time.perf_counter()
    try:
        source = args.source.resolve()
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
        dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=source, text=True)
        if revision != SOURCE_REVISION or dirty:
            raise ValueError(f'WiLoR-MLX source must be clean {SOURCE_REVISION}, found {revision}{" (dirty)" if dirty else ""}')
        if digest(args.weights) != WEIGHTS_SHA256:
            raise ValueError('detector weights are not the WiLoR-MLX hand detector')
        thresholds = [float(t) for t in args.thresholds.split(',')]
        cases = json.loads(args.images.read_text())
        manifest['provenance'] = {'sourceRevision': revision, 'weightsSha256': WEIGHTS_SHA256}
        manifest['phase'] = 'model-load'
        sys.path.insert(0, str(source / 'src'))
        import cv2
        import mlx.core as mx
        from wilor_mlx.detector import HandDetector, _upsample_nearest
        from wilor_mlx.pipeline import HandPosePipeline, _crop_and_resize_mlx
        detector = HandDetector.from_pretrained(str(args.weights))
        pipeline = HandPosePipeline(detector, None)
        manifest['runtime'] = {'backend': 'mlx', 'device': str(mx.default_device()), 'mlx': mx.__version__,
                               'opencv': cv2.__version__, 'python': platform.python_version()}
        manifest['phase'] = 'inference'
        for case in cases:
            folder = args.out / case['id']
            folder.mkdir(exist_ok=True)
            rows = {}
            raw = Path(case['image']).read_bytes()
            bgr = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
            if bgr is None:
                raise ValueError(f'image_decode_failed: {case["image"]}')
            rgb = bgr[..., ::-1].copy()
            H, W = rgb.shape[:2]
            write_tensor(folder, 'source.rgb', rgb, rows)
            letterbox = _crop_and_resize_mlx(mx.array(rgb), W / 2.0, H / 2.0, max(H, W), target_size=512, pad_value=114)
            write_tensor(folder, 'letterbox.rgb', np.array(letterbox), rows)
            d = detector
            x = letterbox[None].astype(mx.float32) / 255.0
            stages = {}
            stages['b0'] = d.b0(x); stages['b1'] = d.b1(stages['b0']); stages['b2'] = d.b2(stages['b1'])
            stages['b3'] = d.b3(stages['b2']); stages['b4'] = d.b4(stages['b3']); stages['b5'] = d.b5(stages['b4'])
            stages['b6'] = d.b6(stages['b5']); stages['b7'] = d.b7(stages['b6']); stages['b8'] = d.b8(stages['b7'])
            stages['b9'] = d.b9(stages['b8'])
            stages['h12'] = d.h12(mx.concatenate([_upsample_nearest(stages['b9'], 2), stages['b6']], axis=-1))
            stages['h15'] = d.h15(mx.concatenate([_upsample_nearest(stages['h12'], 2), stages['b4']], axis=-1))
            stages['h16'] = d.h16(stages['h15'])
            stages['h18'] = d.h18(mx.concatenate([stages['h16'], stages['h12']], axis=-1))
            stages['h19'] = d.h19(stages['h18'])
            stages['h21'] = d.h21(mx.concatenate([stages['h19'], stages['b9']], axis=-1))
            for level, feat in enumerate([stages['h15'], stages['h18'], stages['h21']]):
                for branch in ('cv2', 'cv3', 'cv4'):
                    y = feat
                    for layer in getattr(d.pose, branch)[level]:
                        y = layer(y)
                    stages[f'pose.{branch}.{level}'] = y
            out = d.pose([stages['h15'], stages['h18'], stages['h21']])
            whole = detector(letterbox[None])
            mx.eval(out, whole, *stages.values())
            if not np.array_equal(np.array(out), np.array(whole)):
                raise ValueError('stage-by-stage forward differs from HandDetector.__call__')
            for name, value in stages.items():
                write_tensor(folder, name, np.array(value)[0].transpose(2, 0, 1).astype(np.float32), rows)
            write_tensor(folder, 'output', np.array(out)[0].astype(np.float32), rows)
            detections = {str(t): [asdict(h) for h in pipeline(rgb, conf_threshold=t, include_3d=False, include_vertices=False)]
                          for t in thresholds}
            manifest['cases'].append({'id': case['id'], 'image': case['image'], 'imageSha256': digest(case['image']),
                                      'size': [W, H], 'tensors': rows, 'detections': detections})
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
