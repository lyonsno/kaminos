"""Private EMLight checkpoint assay; no training-stack imports.

Reference: fnzhan/EMLight at 3a52b3ac8656e67a825d44b398cd37a1467117cc,
RegressionNetwork/{DenseNet.py,data.py,util.py}. This adapter imports the exact
network and preserves raw predictions. Its SG-to-SH display is a provisional
relative-lighting interpretation, not the paper's neural projector.
"""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import time
import numpy as np


def panorama_grid(height, width):
    phi, theta = np.meshgrid((np.arange(height) + .5) * np.pi / height,
                             (np.arange(width) + .5) * 2 * np.pi / width, indexing='ij')
    native = np.stack((np.sin(phi) * np.cos(theta), np.sin(phi) * np.sin(theta), np.cos(phi)), -1)
    return native, np.sin(phi) * (np.pi / height) * (2 * np.pi / width)


def project_sh(rgb, directions, weights):
    x, y, z = np.moveaxis(directions, -1, 0)
    basis = np.stack((np.full_like(x, .282095), .488603*y, .488603*z, .488603*x,
                      1.092548*x*y, 1.092548*y*z, .315392*(3*z*z-1),
                      1.092548*x*z, .546274*(x*x-y*y)), -1)
    return np.einsum('hwc,hwb,hw->bc', rgb, basis, weights)


def camera_to_native(xyz):
    x, y, z = np.moveaxis(np.asarray(xyz), -1, 0)
    return np.stack((z, -x, y), -1)


def native_to_camera(xyz):
    x, y, z = np.moveaxis(np.asarray(xyz), -1, 0)
    return np.stack((-y, z, x), -1)


def validate_prediction(raw):
    for key, length in [('distribution', 96), ('intensity', 1), ('rgb_ratio', 3), ('ambient', 3)]:
        value = np.asarray(raw.get(key), dtype=float)
        if value.shape != (length,) or not np.isfinite(value).all():
            raise ValueError(f'{key}: expected {length} finite values')
    return raw


def sample_panorama(rgb, native):
    h, w = rgb.shape[:2]
    u = np.mod(np.arctan2(native[..., 1], native[..., 0]), 2*np.pi) / (2*np.pi) * w - .5
    v = np.arccos(np.clip(native[..., 2], -1, 1)) / np.pi * h - .5
    x0, y0 = np.floor(u).astype(int), np.floor(v).astype(int)
    a, b = (u-x0)[..., None], (v-y0)[..., None]
    row0, row1 = np.clip(y0, 0, h-1), np.clip(y0+1, 0, h-1)
    return ((1-a)*rgb[row0, x0 % w] + a*rgb[row0, (x0+1) % w])*(1-b) + ((1-a)*rgb[row1, x0 % w] + a*rgb[row1, (x0+1) % w])*b


def tone(rgb):
    power = np.maximum(rgb, 0) ** (1 / 2.4)
    positive = power[power > 0]
    alpha = .5 / (np.percentile(positive if positive.size else power, 50) + 1e-10)
    return np.clip(power * alpha, 0, 1).astype(np.float32)


def png_url(rgb):
    from PIL import Image
    encoded = io.BytesIO()
    Image.fromarray(np.uint8(np.clip(rgb, 0, 1)*255)).save(encoded, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(encoded.getvalue()).decode('ascii')


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--environment', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--device', choices=['cpu', 'mps'], default='mps')
    parser.add_argument('--fov', type=float, default=60)
    args = parser.parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'kaminos.inferred-lighting.v1', 'status': 'failed', 'phase': 'source-validation',
              'requestedDevice': args.device, 'claim': 'relative lighting assay; no neural projector; not calibrated HDR',
              'sourceRoot': str(args.source_root.resolve())}
    report_path = args.output_dir / 'lighting.json'
    try:
        if not 0 < args.fov < 180:
            raise ValueError('fov must be between 0 and 180 degrees')
        report['checkpointSha256'] = digest(args.checkpoint)
        report['environmentSha256'] = digest(args.environment)
        report['sourceRevision'] = subprocess.check_output(['git', '-C', str(args.source_root), 'rev-parse', 'HEAD'], text=True).strip()
        report['networkSha256'] = digest(args.source_root / 'RegressionNetwork/DenseNet.py')
        report['phase'] = 'model-load'
        import torch
        import OpenEXR
        if args.device == 'mps' and not torch.backends.mps.is_available():
            raise RuntimeError('MPS requested but unavailable; no fallback')
        spec = importlib.util.spec_from_file_location('emlight_network', args.source_root / 'RegressionNetwork/DenseNet.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        model = module.DenseNet().eval()
        model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=True), strict=True)
        model.to(args.device)
        report.update(effectiveDevice=args.device, torchVersion=torch.__version__, parameters=sum(p.numel() for p in model.parameters()))
        report['phase'] = 'preprocess'
        with OpenEXR.File(str(args.environment)) as file:
            environment = np.asarray(file.channels()['RGB'].pixels, dtype=np.float64)
        if environment.ndim != 3 or environment.shape[2] != 3 or not np.isfinite(environment).all():
            raise ValueError('environment must be finite RGB')
        native, weights = panorama_grid(128, 256)
        reference = sample_panorama(environment, native)
        # The checkpoint's 8208-wide dense layer requires 192x256 input here.
        x, y = np.meshgrid((np.arange(256)+.5)/256*2-1, 1-(np.arange(192)+.5)/192*2)
        scale = np.tan(np.radians(args.fov)/2)
        camera = np.stack((x*scale, y*scale*192/256, -np.ones_like(x)), -1)
        camera /= np.linalg.norm(camera, axis=-1, keepdims=True)
        crop = tone(sample_panorama(environment, camera_to_native(camera)))
        report['input'] = {'width':256, 'height':192, 'horizontalFov':args.fov,
                           'preprocessing':'HDR -> power 1/2.4 -> positive median to 0.5 -> clip [0,1]',
                           'image':png_url(crop), 'source':'https://polyhaven.com/a/small_empty_room_1',
                           'scope':'camera projection of a real HDR environment; not an arbitrary camera photo'}
        tensor = torch.from_numpy(crop.transpose(2, 0, 1).copy()).unsqueeze(0).to(args.device)
        report['phase'] = 'inference'
        if args.device == 'mps': torch.mps.synchronize()
        start = time.perf_counter()
        with torch.inference_mode():
            prediction = model(tensor)
        if args.device == 'mps': torch.mps.synchronize()
        report['inferenceSeconds'] = time.perf_counter() - start
        raw = validate_prediction({k:v.detach().cpu().numpy().reshape(-1).tolist() for k,v in prediction.items()})
        report['rawPrediction'] = raw
        report['phase'] = 'lighting-projection'
        clipped = {k:np.maximum(v, 0) for k,v in raw.items()}
        report['displayClampedNegativeCounts'] = {k:int((np.asarray(v)<0).sum()) for k,v in raw.items()}
        n = 96
        z = np.linspace(1-1/n, 1/n-1, n)
        theta = np.pi*(3-np.sqrt(5))*np.arange(n)
        anchors = np.stack((np.sqrt(1-z*z)*np.cos(theta), np.sqrt(1-z*z)*np.sin(theta), z), -1)
        lobes = np.exp((np.einsum('hwd,nd->hwn', native, anchors)-1)/.0025)
        color = clipped['distribution'][:, None] * clipped['intensity'][0] * 500 * clipped['rgb_ratio'][None, :]
        estimated = np.einsum('hwn,nc->hwc', lobes, color) + clipped['ambient']
        report['interpretation'] = {'basis':'96 Fibonacci anchors; upstream SG width 0.0025; intensity x500',
                                    'ambient':'raw per-pixel ambient head, constant over environment',
                                    'coordinates':'camera X right, Y up, Z back = native (-Y,Z,X)',
                                    'normalization':'each map independently normalized by mean luminance; exposure/absolute-energy comparison excluded',
                                    'limits':['SG proxy, not neural-projector output', 'camera FOV is an explicit assay assumption',
                                              'shared RGB ratio for directional lobes; not independently colored lights',
                                              'degree-2 SH diffuse comparison, not sharp specular relighting']}
        report['lights'] = {}
        for name, env in [('reference',reference), ('estimated',estimated)]:
            mean = np.einsum('hwc,hw,c->',env,weights,np.array([.2126,.7152,.0722]))/weights.sum()
            if not np.isfinite(mean) or mean <= 0:
                raise ValueError(f'{name} has no positive finite energy')
            coefficients = project_sh(env / mean, native_to_camera(native), weights)
            report['lights'][name] = {'sh':coefficients.tolist(), 'meanLuminanceBeforeNormalization':float(mean),
                                      'preview':png_url(tone(env))}
        report.update(status='complete', phase='complete')
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report_path.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(str(report_path))


if __name__ == '__main__':
    main()
