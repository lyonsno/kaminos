"""Admission and inspectable transforms for the finite native regional assay.

No training or GPU work occurs on import. The native producer's retained rows
remain authoritative; these helpers never fill absent samples or rewrite them.
"""
import hashlib
import json
from pathlib import Path
import numpy as np

CAPTURE_ID = 'native-fine-regional-optical-query-v0'
DATASET_ID = 'native-regional-transfer-diagnostic-v0'


def finite(values, name):
    if not np.isfinite(values).all():
        raise ValueError(f'nonfinite {name}')
    return values


def load_native_dataset(root, expected_source):
    root = Path(root).resolve()
    report_path = root / 'report.json'
    report_bytes = report_path.read_bytes()
    report = json.loads(report_bytes)
    if report.get('status') != 'observed' or report.get('phase') != 'complete':
        raise ValueError('native capture has no successful terminal report')
    source = report.get('source', {})
    if not expected_source or source.get('commit') != expected_source or source.get('dirty') is not False:
        raise ValueError('native capture source identity differs from requested source')
    dataset = report.get('dataset', {})
    if dataset.get('identity') != DATASET_ID:
        raise ValueError('native regional dataset identity is missing')

    def read_artifact(name):
        target = (root / name).resolve()
        if not target.is_relative_to(root):
            raise ValueError('native artifact escapes its retained capture')
        entry = report.get('artifacts', {}).get(name)
        data = target.read_bytes()
        if not entry or len(data) != entry.get('bytes') or hashlib.sha256(data).hexdigest() != entry.get('sha256'):
            raise ValueError(f'native artifact is missing, partial or changed: {name}')
        return data

    plan = json.loads(read_artifact('plan.json'))
    shape = dataset['shape']
    if plan.get('identity') != DATASET_ID or shape['regions'] != len(plan['regions']) or shape['queries'] != len(plan['segments']):
        raise ValueError('native region/query population changed')
    arrays = {}
    for name, dtype, expected_shape in [
        ('context', '<f4', (shape['regions'], shape['contextWidth'])),
        ('query', '<f4', (shape['queries'], 7)), ('target', '<f4', (shape['queries'], 7)),
        ('coarse', '<f4', (shape['queries'], 7)), ('onePoint', '<f4', (shape['queries'], 7)),
        ('sparse', '<f4', (shape['queries'], 7)), ('opticalDepth', '<f4', (shape['queries'],)),
        ('regionIndex', '<u4', (shape['queries'],)),
    ]:
        values = np.frombuffer(read_artifact(name + '.bin'), dtype=dtype)
        if values.size != np.prod(expected_shape):
            raise ValueError(f'partial native {name} population')
        arrays[name] = finite(values.reshape(expected_shape).copy(), name)

    rows = np.empty((plan['pointCount'], 32), dtype=np.float32)
    written = np.zeros(plan['pointCount'], dtype=np.bool_)
    material_state = None
    for chunk in report['chunks']:
        if chunk.get('label') != 'native-points':
            continue
        effective = chunk.get('effective', {})
        capture = effective.get('regionalCapture', {})
        if (chunk.get('ok') is not True or chunk.get('identity') != CAPTURE_ID
                or effective.get('route') != 'native-3d-compute-fluid-raymarch-v0'
                or effective.get('backend') != 'WebGPU:apple'
                or capture.get('identity') != CAPTURE_ID or capture.get('scope') != 'fine-domain'
                or capture.get('kind') != 'points' or capture.get('worldTraversalIncluded') is not False
                or not isinstance(capture.get('worldCollarIncluded'), bool) or 'materialPreparation' not in capture
                or capture.get('coefficientSource') != 'native-material-before-trace-support-mask'):
            raise ValueError('native regional effective route or material scope changed')
        if effective.get('simStepCount') != report['hold']['effectiveSimStepCount']:
            raise ValueError('native source step changed between chunks')
        this_state = (effective.get('controls'), effective.get('uniforms'))
        if not this_state[0] or not this_state[1]:
            raise ValueError('native material state is missing')
        if material_state is not None and this_state != material_state:
            raise ValueError('native material state changed between chunks')
        material_state = this_state
        offset, count = chunk['offset'], chunk['count']
        if (offset < 0 or count <= 0 or offset + count > len(rows)
                or np.any(written[offset:offset + count])):
            raise ValueError('overlapping or out-of-range native point chunk')
        values = np.frombuffer(read_artifact(chunk['path']), dtype='<f4')
        if values.size != count * 32:
            raise ValueError('partial native point readback')
        rows[offset:offset + count] = finite(values.reshape(count, 32), 'native rows')
        written[offset:offset + count] = True
    if not written.all():
        raise ValueError('missing native source points')
    if not np.all(rows[:, 2:4] == 1) or np.any(rows[:, 16] < 0):
        raise ValueError('unwritten native point or negative extinction')
    positions = np.asarray([p['position'] for p in plan['points']], dtype=np.float32)
    if not np.allclose(rows[:, 8:11], positions, rtol=0, atol=2e-6):
        raise ValueError('native point positions differ from the requested geometry')

    sparse = np.empty((len(plan['segments']), 7), dtype=np.float32)
    tau = np.empty(len(sparse), dtype=np.float64)
    for segment in plan['segments']:
        i = segment['id']
        if arrays['regionIndex'][i] != segment['region']:
            raise ValueError('native query assigned to the wrong region')
        if not np.allclose(arrays['query'][i], [*segment['entry'], *segment['exit'], segment['length']], rtol=2e-7, atol=2e-7):
            raise ValueError('native query geometry changed')
        start, count = segment['pointOffset'], segment['pointCount']
        middle = rows[start + plan['subdivisions'] // 2]
        sparse[i] = middle[16:23]
        sigma = rows[start:start + count, 16].astype(np.float64)
        tau[i] = np.sum((sigma[:-1] + sigma[1:]) * .5) * segment['length'] / plan['subdivisions']
    finite(tau, 'native optical depth')
    if not np.array_equal(sparse, arrays['sparse']):
        raise ValueError('sparse reader input differs from the actual native midpoint')
    if not np.allclose(tau, arrays['opticalDepth'], rtol=2e-6, atol=1e-8):
        raise ValueError('retained optical depth differs from native point coefficients')
    if not np.allclose(np.exp(-tau), arrays['target'][:, 6], rtol=2e-5, atol=1e-7):
        raise ValueError('native transmission and retained coefficient integral disagree')
    # The complete sampled optical brick is the source-context arm. It is not
    # advertised as the complete simulation stencil or a sufficient statistic.
    for region in plan['regions']:
        block = rows[region['contextOffset']:region['contextOffset'] + region['contextCount'], 16:23].reshape(-1)
        if not np.array_equal(block, arrays['context'][region['id']]):
            raise ValueError('native regional context differs from retained source points')
    return {**arrays, 'sparse': sparse, 'tau': tau, 'plan': plan, 'report': report,
            'sourceReport': {'path': str(report_path), 'sha256': hashlib.sha256(report_bytes).hexdigest()}}


def region_split(region_count, seed):
    if region_count < 3:
        raise ValueError('region-held-out comparison requires at least three regions')
    order = np.random.default_rng(seed).permutation(region_count)
    test_count = max(1, region_count // 4)
    return {'train': order[:-test_count].tolist(), 'heldOut': order[-test_count:].tolist()}


def channel_scale(values):
    scale = np.sqrt(np.mean(np.asarray(values, dtype=np.float64) ** 2, axis=0))
    # A truly absent training channel gets an explicit unit scale; no nonzero
    # native values are clipped to a chosen HDR range.
    return np.where(scale == 0, 1.0, scale)


def optical_features(values, scale):
    values = np.asarray(values, dtype=np.float64)
    result = np.arcsinh(values / scale)
    if np.any(values[..., 0] < 0):
        raise ValueError('negative optical extinction input')
    result[..., 0] = np.log1p(values[..., 0] / scale[0])
    return finite(result.astype(np.float32), 'normalized optical context')


def explicit_moments(context, side):
    blocks = context.reshape(len(context), side ** 3, 7)
    z, y, x = np.meshgrid(*([np.linspace(-1, 1, side)] * 3), indexing='ij')
    basis = np.stack([np.ones(side ** 3), x.ravel(), y.ravel(), z.ravel()], axis=1)
    inverse = np.linalg.pinv(basis)
    # Per-channel offset and XYZ linear variation: 28 inspectable features.
    return np.einsum('bc,nck->nbk', inverse, blocks).reshape(len(context), 28).astype(np.float32)


def quantize_vectors(values, bits):
    values = finite(np.asarray(values, dtype=np.float32), 'feature vectors')
    if bits == 16:
        with np.errstate(over='ignore'):
            decoded = values.astype(np.float16).astype(np.float32)
        finite(decoded, 'FP16 feature vectors')
        return decoded, {'bits': 16, 'payloadBytes': values.size * 2, 'metadataBytes': 0}
    if bits not in (4, 8):
        raise ValueError('diagnostic storage precision must be 4, 8 or 16 bits')
    low = values.min(axis=1, keepdims=True)
    width = values.max(axis=1, keepdims=True) - low
    levels = (1 << bits) - 1
    step = np.where(width == 0, 1.0, width / levels)
    integers = np.rint((values - low) / step).astype(np.uint8)
    decoded = integers.astype(np.float32) * step + low
    return finite(decoded, 'quantized features'), {
        'bits': bits, 'payloadBytes': len(values) * ((values.shape[1] * bits + 7) // 8),
        'metadataBytes': len(values) * 8, 'scheme': 'per-vector-affine-two-f32-metadata',
        'maxFeatureError': float(np.max(np.abs(decoded - values))),
    }


def target_features(target, tau, emission_scale):
    return finite(np.concatenate([np.arcsinh(target[:, :6] / emission_scale), np.log1p(tau)[:, None]], axis=1).astype(np.float32), 'target features')


def decode_targets(prediction, emission_scale):
    prediction = np.asarray(prediction, dtype=np.float64)
    if np.any(prediction[:, 6] < 0):
        raise ValueError('decoder must produce nonnegative log1p optical depth')
    with np.errstate(over='ignore'):
        source = np.sinh(prediction[:, :6]) * emission_scale
        tau = np.expm1(prediction[:, 6])
        result = np.concatenate([source, np.exp(-tau)[:, None]], axis=1).astype(np.float32)
    return finite(result, 'decoded segment transfers')


def transfer_metrics(prediction, target):
    difference = np.asarray(prediction, dtype=np.float64) - target
    actual_light = np.asarray(target[:, :3], dtype=np.float64) + target[:, 3:6]
    light_error = difference[:, :3] + difference[:, 3:6]
    light_power = float(np.sum(actual_light ** 2))
    opacity_power = float(np.sum((1 - target[:, 6].astype(np.float64)) ** 2))
    return {'queries': len(target), 'maeByChannel': np.mean(np.abs(difference), axis=0).tolist(),
            'rmseByChannel': np.sqrt(np.mean(difference ** 2, axis=0)).tolist(),
            'maxAbsoluteByChannel': np.max(np.abs(difference), axis=0).tolist(),
            'combinedRadianceRmse': float(np.sqrt(np.mean(light_error ** 2))),
            'transmissionRmse': float(np.sqrt(np.mean(difference[:, 6] ** 2))),
            'radianceRelativeL2': float(np.sqrt(np.sum(light_error ** 2) / light_power)) if light_power > 0 else None,
            'opacityRelativeL2': float(np.sqrt(np.sum(difference[:, 6] ** 2) / opacity_power)) if opacity_power > 0 else None}
