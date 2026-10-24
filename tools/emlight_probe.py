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


def rotate_native(xyz, yaw_degrees):
    angle = np.radians(yaw_degrees)
    x, y, z = np.moveaxis(np.asarray(xyz), -1, 0)
    return np.stack((np.cos(angle)*x-np.sin(angle)*y, np.sin(angle)*x+np.cos(angle)*y, z), -1)


def environment_coefficients(rgb, view_yaw):
    directions, weights = panorama_grid(*rgb.shape[:2])
    mean = np.einsum('hwc,hw,c->', rgb, weights, np.array([.2126,.7152,.0722]))/weights.sum()
    if not np.isfinite(mean) or mean <= 0:
        raise ValueError('reference has no positive finite energy')
    local = native_to_camera(rotate_native(directions, -view_yaw))
    return project_sh(rgb/mean, local, weights), float(mean)


def read_environment(path, output_dir):
    import OpenEXR
    source = path
    if path.suffix.lower() == '.hdr':
        source = output_dir / 'decoded-environment.exr'
        subprocess.run(['node', str(Path(__file__).with_name('lighting-hdr.mjs')),
                        '--input', str(path), '--output', str(source)], check=True)
    with OpenEXR.File(str(source), separate_channels=True) as file:
        return np.stack([file.channels()[c].pixels for c in 'RGB'], -1).astype(np.float64)


def diffuse_metrics(reference_sh, estimated_sh):
    directions, weights = panorama_grid(64, 128)
    x, y, z = np.moveaxis(directions, -1, 0)
    # Three's SH irradiance basis, divided by pi for a white Lambertian surface.
    basis = np.stack((np.full_like(x, .886227), 1.023328*y, 1.023328*z, 1.023328*x,
                      .858086*x*y, .858086*y*z, .743125*z*z-.247708,
                      .858086*x*z, .429043*(x*x-y*y)), -1) / np.pi
    ref = np.maximum(np.einsum('hwb,bc->hwc', basis, reference_sh), 0)
    est = np.maximum(np.einsum('hwb,bc->hwc', basis, estimated_sh), 0)
    def rmse(value):
        return float(np.sqrt(np.einsum('hwc,hw->', (value-ref)**2, weights)/(3*weights.sum())))
    return {'estimatedRmse':rmse(est), 'neutralRmse':rmse(np.ones_like(ref)),
            'scope':'solid-angle-weighted RGB diffuse error over normals; equal mean luminance; no fitted yaw/exposure'}


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
    parser.add_argument('--view-yaw', type=float, default=0)
    parser.add_argument('--source-url')
    parser.add_argument('--label')
    args = parser.parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'kaminos.inferred-lighting.v1', 'status': 'failed', 'phase': 'source-validation',
              'requestedDevice': args.device, 'claim': 'relative lighting assay; no neural projector; not calibrated HDR',
              'sourceRoot': str(args.source_root.resolve())}
    report_path = args.output_dir / 'lighting.json'
    try:
        if not 0 < args.fov < 180:
            raise ValueError('fov must be between 0 and 180 degrees')
        if not np.isfinite(args.view_yaw):
            raise ValueError('view yaw must be finite')
        report['label'] = args.label or args.environment.stem
        report['environmentPath'] = str(args.environment.resolve())
        report['checkpointSha256'] = digest(args.checkpoint)
        report['environmentSha256'] = digest(args.environment)
        report['sourceRevision'] = subprocess.check_output(['git', '-C', str(args.source_root), 'rev-parse', 'HEAD'], text=True).strip()
        report['networkSha256'] = digest(args.source_root / 'RegressionNetwork/DenseNet.py')
        report['phase'] = 'model-load'
        import torch
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
        environment = read_environment(args.environment, args.output_dir)
        if environment.ndim != 3 or environment.shape[2] != 3 or not np.isfinite(environment).all():
            raise ValueError('environment must be finite RGB')
        native, weights = panorama_grid(128, 256)
        reference = sample_panorama(environment, rotate_native(native, args.view_yaw))
        # The checkpoint's 8208-wide dense layer requires 192x256 input here.
        x, y = np.meshgrid((np.arange(256)+.5)/256*2-1, 1-(np.arange(192)+.5)/192*2)
        scale = np.tan(np.radians(args.fov)/2)
        camera = np.stack((x*scale, y*scale*192/256, -np.ones_like(x)), -1)
        camera /= np.linalg.norm(camera, axis=-1, keepdims=True)
        crop = tone(sample_panorama(environment, rotate_native(camera_to_native(camera), args.view_yaw)))
        report['input'] = {'width':256, 'height':192, 'horizontalFov':args.fov,
                           'preprocessing':'HDR -> power 1/2.4 -> positive median to 0.5 -> clip [0,1]',
                           'image':png_url(crop), 'source':args.source_url or str(args.environment.resolve()),
                           'viewYawDegrees':args.view_yaw,
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
            if name == 'reference':
                coefficients, mean = environment_coefficients(environment, args.view_yaw)
            else:
                mean = np.einsum('hwc,hw,c->',env,weights,np.array([.2126,.7152,.0722]))/weights.sum()
                if not np.isfinite(mean) or mean <= 0:
                    raise ValueError(f'{name} has no positive finite energy')
                coefficients = project_sh(env / mean, native_to_camera(native), weights)
            report['lights'][name] = {'sh':coefficients.tolist(), 'meanLuminanceBeforeNormalization':float(mean),
                                      'preview':png_url(tone(env))}
        report['interpretation']['referenceIntegration'] = 'original HDR pixels and solid angles; preview downsampling does not set lighting'
        report['metrics'] = diffuse_metrics(report['lights']['reference']['sh'], report['lights']['estimated']['sh'])
        report.update(status='complete', phase='complete')
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report_path.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(str(report_path))


if __name__ == '__main__':
    main()
