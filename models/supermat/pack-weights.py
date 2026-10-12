"""Pack SuperMat browser weights into kit model-resource bundles; runs no inference.

Reads the SuperMat UNet checkpoint (a complete converted UNet state dict), the
Stable Diffusion 2.1 VAE safetensors, and the empty-prompt conditioning tensor
captured by export-reference.py. Writes one bundle per execution section with a
`defineWebGpuModelResourceManifest` input per bundle. Tensor offsets are
256-byte aligned so tensor views bind directly as storage-buffer ranges.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np


SCHEMA = 'supermat.browser-weight-package.v0'
ALIGN = 256
STORAGE_COPY_DST = 0x0080 | 0x0008
MAX_ALLOCATION_BYTES = 1 << 30


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def check_expected(label, actual, expected):
    if actual != expected:
        raise ValueError(f'{label} mismatch: expected {expected}, found {actual}')


def unet_section(key):
    """Execution section that owns one UNet state-dict key."""
    head = key.split('.')[0]
    if head in ('conv_in', 'time_embedding'):
        return 'unet-embed'
    if head == 'down_blocks':
        return f'unet-down-{key.split(".")[1]}'
    if head == 'mid_block':
        return 'unet-mid'
    if head == 'up_blocks':
        return f'unet-up-{key.split(".")[1]}'
    if head in ('last_up_blocks', 'rep_conv_out', 'conv_norm_out'):
        return 'unet-heads'
    raise ValueError(f'unassigned UNet key: {key}')


def vae_section(key):
    head = key.split('.')[0]
    if head in ('encoder', 'quant_conv'):
        return 'vae-encoder'
    if head in ('decoder', 'post_quant_conv'):
        return 'vae-decoder'
    raise ValueError(f'unassigned VAE key: {key}')


LEGACY_VAE_ATTENTION = {'query': 'to_q', 'key': 'to_k', 'value': 'to_v', 'proj_attn': 'to_out.0'}


def runtime_vae_key(key):
    """Legacy VAE attention names as diffusers loads them into Attention modules."""
    parts = key.split('.')
    if 'attentions' in parts and len(parts) >= 2 and parts[-2] in LEGACY_VAE_ATTENTION:
        return '.'.join(parts[:-2] + [LEGACY_VAE_ATTENTION[parts[-2]], parts[-1]])
    return key


def write_bundle(out, resource_id, tensors, model_id, revision):
    """tensors: ordered list of (name, float32 ndarray). Returns manifest input."""
    allocations, current, offset = [], [], 0
    for name, values in tensors:
        size = values.nbytes
        if size > MAX_ALLOCATION_BYTES:
            raise ValueError(f'{name}: tensor exceeds one allocation')
        if current and offset + size > MAX_ALLOCATION_BYTES:
            allocations.append(current)
            current, offset = [], 0
        current.append((name, values, offset))
        offset = (offset + size + ALIGN - 1) // ALIGN * ALIGN
    if current:
        allocations.append(current)
    path = out / f'{resource_id}.bin'
    manifest_allocations, bundle_offset = [], 0
    with path.open('wb') as f:
        for index, rows in enumerate(allocations):
            end = 0
            for name, values, tensor_offset in rows:
                f.seek(bundle_offset + tensor_offset)
                f.write(np.ascontiguousarray(values).tobytes())
                end = tensor_offset + values.nbytes
            length = (end + ALIGN - 1) // ALIGN * ALIGN
            manifest_allocations.append({
                'allocationId': f'{resource_id}.{index}', 'byteOffset': bundle_offset, 'byteLength': length,
                'usage': STORAGE_COPY_DST,
                'tensors': [{'name': name, 'dtype': 'f16' if values.dtype == np.float16 else 'f32',
                             'shape': list(values.shape) or [1],
                             'byteOffset': tensor_offset, 'byteLength': values.nbytes}
                            for name, values, tensor_offset in rows]})
            bundle_offset += length
        f.truncate(bundle_offset)
    return {'resourceId': resource_id, 'file': path.name,
            'manifest': {'modelId': model_id, 'revision': revision,
                         'bundle': {'byteLength': path.stat().st_size, 'sha256': digest(path)},
                         'allocations': manifest_allocations}}


def write_chunks(out, row, chunk_bytes):
    """Split each allocation of a written bundle into contiguous chunk files."""
    folder = out / f"{row['resourceId']}.chunks"
    folder.mkdir(exist_ok=True)
    allocations, files = [], {}
    with (out / row['file']).open('rb') as f:
        for allocation in row['manifest']['allocations']:
            chunks = []
            for start in range(0, allocation['byteLength'], chunk_bytes):
                length = min(chunk_bytes, allocation['byteLength'] - start)
                f.seek(allocation['byteOffset'] + start)
                data = f.read(length)
                chunk_id = f"{allocation['allocationId']}.{len(chunks):04d}"
                name = f'{chunk_id}.bin'
                (folder / name).write_bytes(data)
                chunks.append({'chunkId': chunk_id, 'byteOffset': start, 'byteLength': length,
                               'sha256': hashlib.sha256(data).hexdigest()})
                files[chunk_id] = f'{folder.name}/{name}'
            allocations.append({'allocationId': allocation['allocationId'], 'chunks': chunks})
    row['chunks'] = {'allocations': allocations, 'files': files}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--expected-checkpoint-sha256', required=True)
    p.add_argument('--base-model', type=Path, required=True)
    p.add_argument('--expected-vae-sha256', required=True)
    p.add_argument('--reference', type=Path, required=True,
                   help='export-reference.py output supplying the empty-prompt conditioning')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--chunk-bytes', type=int, default=0,
                   help='also write each allocation as verified chunks of this many bytes for chunked browser loading')
    p.add_argument('--dtype', choices=('f32', 'f16'), default='f32',
                   help='f16 stores matrix and conv weights (2+ dims) as binary16; vectors and conditioning stay f32')
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report_path = args.out / 'package.json'
    report = {'schema': SCHEMA, 'status': 'failed', 'phase': 'inputs', 'resources': []}
    start = time.perf_counter()
    try:
        checkpoint_sha = digest(args.checkpoint)
        check_expected('checkpoint sha256', checkpoint_sha, args.expected_checkpoint_sha256)
        vae_path = args.base_model.resolve() / 'vae' / 'diffusion_pytorch_model.safetensors'
        vae_sha = digest(vae_path)
        check_expected('VAE sha256', vae_sha, args.expected_vae_sha256)
        reference = json.loads((args.reference / 'manifest.json').read_text())
        if reference.get('status') != 'succeeded' or reference.get('checkpoint', {}).get('sha256') != checkpoint_sha:
            raise ValueError('conditioning reference must be a succeeded export of this checkpoint')
        def reference_tensor(name):
            row = reference['tensors'][name]
            path = args.reference / row['file']
            check_expected(f'{name} sha256', digest(path), row['sha256'])
            return np.fromfile(path, dtype='<f4').reshape(row['shape']), row['sha256']
        # Fixed-input subgraphs of the single-image contract, taken from the
        # source pipeline itself: empty-prompt CLIP states and the t=999 sinusoid.
        conditioning, conditioning_sha = reference_tensor('unet.in.encoder_hidden_states')
        time_proj, time_proj_sha = reference_tensor('unet.time_proj#0')
        report['constants'] = {'timestep': reference['timestep'], 'alphaBar': reference['x0Rule']['alphaBar'],
                               'vScale': reference['x0Rule']['vScale'],
                               'vaeScalingFactor': reference['vaeScalingFactor']}
        revision = f'oyiya/SuperMat@91ffb8ed:{checkpoint_sha[:16]}+sd2-1-vae:{vae_sha[:16]}:{args.dtype}'
        report['provenance'] = {'checkpoint': {'path': str(args.checkpoint.resolve()), 'sha256': checkpoint_sha},
                                'vae': {'path': str(vae_path), 'sha256': vae_sha},
                                'conditioning': {'reference': str(args.reference.resolve()),
                                                 'referenceManifestSha256': digest(args.reference / 'manifest.json'),
                                                 'emptyPrompt': conditioning_sha, 'timeProjection': time_proj_sha}}
        report['revision'] = revision

        report['phase'] = 'checkpoint-read'
        import torch
        from safetensors.numpy import load_file
        unet = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
        vae = load_file(str(vae_path))
        sections = {}
        for key, tensor in unet.items():
            values = tensor.detach().to(torch.float32).numpy()
            sections.setdefault(unet_section(key), []).append((f'unet.{key}', values))
        renamed = {}
        for key, values in vae.items():
            runtime_key = runtime_vae_key(key)
            if runtime_key != key:
                renamed[key] = runtime_key
            sections.setdefault(vae_section(key), []).append((f'vae.{runtime_key}', values.astype('<f4')))
        report['renamedVaeKeys'] = renamed
        sections['conditioning'] = [('conditioning.empty_prompt', conditioning[0]),
                                    ('conditioning.time_proj', time_proj[0])]
        report['tensorCounts'] = {name: len(rows) for name, rows in sections.items()}
        report['dtype'] = args.dtype
        for name, rows in sections.items():
            converted = []
            for tensor_name, values in rows:
                values = np.asarray(values, dtype='<f4')
                if args.dtype == 'f16' and name != 'conditioning' and values.ndim >= 2:
                    if values.size % 2:
                        raise ValueError(f'{tensor_name}: f16 storage needs an even element count')
                    if not np.isfinite(values.astype('<f2')).all():
                        raise ValueError(f'{tensor_name}: value overflows binary16')
                    values = values.astype('<f2')
                converted.append((tensor_name, values))
            sections[name] = converted

        report['phase'] = 'bundle-write'
        for resource_id in sorted(sections):
            report['resources'].append(write_bundle(args.out, resource_id, sections[resource_id],
                                                    'supermat.single-image', revision))
        if args.chunk_bytes:
            report['phase'] = 'chunk-write'
            if args.chunk_bytes % 4:
                raise ValueError('--chunk-bytes must be a multiple of 4')
            report['chunkBytes'] = args.chunk_bytes
            for row in report['resources']:
                write_chunks(args.out, row, args.chunk_bytes)
        report['totalBytes'] = sum(r['manifest']['bundle']['byteLength'] for r in report['resources'])
        report['status'] = 'succeeded'
        report['phase'] = 'complete'
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['durationSeconds'] = time.perf_counter() - start
        report_path.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
