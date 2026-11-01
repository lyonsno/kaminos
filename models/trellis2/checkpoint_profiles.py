"""Source checkpoint identities for the supported TRELLIS generation profiles."""
from pathlib import PurePosixPath


def expanded_flow_specs(pipeline_type):
    if pipeline_type not in ('512', '1024_cascade'):
        raise ValueError('supported source pipeline type required')
    size = 512 if pipeline_type == '512' else 1024
    specs = [] if size == 512 else [
        ('highResolutionShape', 'slat_flow_img2shape_dit_1_3B_1024_bf16', 64, 'shape_slat_sampler')]
    return specs + [('textureFlow', f'slat_flow_imgshape2tex_dit_1_3B_{size}_bf16', size // 16, 'tex_slat_sampler')]


def require_texture_checkpoint(manifest, pipeline_type):
    stem = expanded_flow_specs(pipeline_type)[-1][1]
    identity = manifest.get('models', {}).get('textureFlow', {}).get('identity', {})
    if PurePosixPath(identity.get('path') or '').name != stem + '.safetensors':
        raise ValueError(f'{pipeline_type} requires {stem}; rebuild checkpoint base with pack-generation.py --pipeline-type {pipeline_type}; image preparation cannot replace model weights')
