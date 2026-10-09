"""Export one SuperMat single-image reference from the pinned PyTorch source.

Runs the source's own pipeline construction and call on CPU float32 and
captures stage boundaries with forward hooks: preprocessed input, VAE encoder
blocks, the image latent, empty-prompt conditioning, time embedding, UNet
blocks, both v predictions, both x0 latents, both VAE decodes and the
postprocessed maps. This observer is separate from browser execution.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

import numpy as np


SCHEMA = 'supermat.single-image-reference.v0'
SOURCE_FILES = (
    'inference_supermat.py',
    'src/adapters.py',
    'src/utils.py',
    'src/pipelines/pipeline_supermat_stable_diffusion.py',
    'src/models/supermat_unet_2d_condition.py',
)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def check_expected(label, actual, expected):
    if expected is not None and actual != expected:
        raise ValueError(f'{label} mismatch: expected {expected}, found {actual}')


def capture_points(pipe):
    """Module boundaries captured as (name, module). Repeated calls get suffixes."""
    vae, unet = pipe.vae, pipe.unet
    points = [('vae.encoder.conv_in', vae.encoder.conv_in)]
    points += [(f'vae.encoder.down.{i}', block) for i, block in enumerate(vae.encoder.down_blocks)]
    points += [('vae.encoder.mid', vae.encoder.mid_block),
               ('vae.encoder.out', vae.encoder.conv_out),
               ('vae.quant', vae.quant_conv),
               ('text.hidden', pipe.text_encoder),
               ('unet.time_proj', unet.time_proj),
               ('unet.temb', unet.time_embedding),
               ('unet.conv_in', unet.conv_in)]
    points += [(f'unet.down.{i}', block) for i, block in enumerate(unet.down_blocks)]
    points += [('unet.mid', unet.mid_block)]
    points += [(f'unet.up.{i}', block) for i, block in enumerate(unet.up_blocks)]
    points += [(f'unet.last_up.{i}', block) for i, block in enumerate(unet.last_up_blocks)]
    points += [(f'unet.conv_out.{i}', conv) for i, conv in enumerate(unet.rep_conv_out)]
    points += [('vae.post_quant', vae.post_quant_conv),
               ('vae.decoder.conv_in', vae.decoder.conv_in),
               ('vae.decoder.mid', vae.decoder.mid_block)]
    points += [(f'vae.decoder.up.{i}', block) for i, block in enumerate(vae.decoder.up_blocks)]
    points += [('vae.decoder.out', vae.decoder.conv_out)]
    return points


def first_tensor(value):
    import torch
    if isinstance(value, torch.Tensor):
        return value
    if isinstance(value, (tuple, list)) and value:
        return first_tensor(value[0])
    if hasattr(value, 'last_hidden_state'):
        return value.last_hidden_state
    raise TypeError(f'no tensor in captured value of type {type(value).__name__}')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root', type=Path, required=True)
    p.add_argument('--expected-source-commit', required=True)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--expected-checkpoint-sha256', required=True)
    p.add_argument('--base-model', type=Path, required=True,
                   help='local Stable Diffusion 2.1 snapshot directory')
    p.add_argument('--image', type=Path, required=True)
    p.add_argument('--expected-image-sha256', required=True)
    p.add_argument('--image-size', type=int, default=512)
    p.add_argument('--threads', type=int, required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report_path = args.out / 'manifest.json'
    report = {'schema': SCHEMA, 'status': 'failed', 'phase': 'source', 'tensors': {},
              'referenceRoute': 'pinned-source-pipeline/torch-cpu-float32',
              'imageSize': args.image_size, 'calls': {}}
    start = time.perf_counter()
    try:
        root = args.source_root.resolve()
        git = lambda *a: subprocess.check_output(['git', '-C', str(root), *a], text=True).strip()
        report['source'] = {'root': str(root), 'commit': git('rev-parse', 'HEAD'),
                            'dirty': git('status', '--porcelain'), 'files': {}}
        check_expected('source commit', report['source']['commit'], args.expected_source_commit)
        if report['source']['dirty']:
            raise ValueError('reference source worktree must be clean')
        for file in SOURCE_FILES:
            report['source']['files'][file] = digest(root / file)

        report['phase'] = 'inputs'
        report['checkpoint'] = {'path': str(args.checkpoint.resolve()), 'sha256': digest(args.checkpoint)}
        check_expected('checkpoint sha256', report['checkpoint']['sha256'], args.expected_checkpoint_sha256)
        report['image'] = {'path': str(args.image.resolve()), 'sha256': digest(args.image)}
        check_expected('image sha256', report['image']['sha256'], args.expected_image_sha256)
        base = args.base_model.resolve()
        report['baseModel'] = {'path': str(base), 'files': {}}
        for file in ('model_index.json', 'scheduler/scheduler_config.json', 'unet/config.json',
                     'vae/config.json', 'vae/diffusion_pytorch_model.safetensors',
                     'unet/diffusion_pytorch_model.safetensors', 'text_encoder/model.safetensors'):
            report['baseModel']['files'][file] = digest(base / file)

        report['phase'] = 'pipeline-construction'
        import torch
        import diffusers
        import transformers
        torch.set_num_threads(args.threads)
        torch.manual_seed(0)
        report['runtime'] = {'python': sys.version.split()[0], 'platform': platform.platform(),
                             'torch': torch.__version__, 'diffusers': diffusers.__version__,
                             'transformers': transformers.__version__, 'device': 'cpu',
                             'dtype': 'float32', 'threads': torch.get_num_threads()}
        sys.path.insert(0, str(root))
        from diffusers import DDIMScheduler
        from src.adapters import SuperMatAdapterWrapper
        from src.pipelines.pipeline_supermat_stable_diffusion import SuperMatStableDiffusionPipeline
        from src.utils import load_rgba_image_as_rgb_tensor, load_unet_weights

        # Mirrors inference_supermat.build_pipeline with device fixed to CPU.
        pipe = SuperMatStableDiffusionPipeline.from_pretrained(
            str(base), safety_checker=None, requires_safety_checker=False, local_files_only=True)
        pipe = SuperMatAdapterWrapper.convert(pipe, use_camera_embeddings=False, camera_embeddings_dim=16)
        incompatible = pipe.unet.load_state_dict(load_unet_weights(args.checkpoint), strict=False)
        report['checkpointLoad'] = {'missingKeys': list(incompatible.missing_keys),
                                    'unexpectedKeys': list(incompatible.unexpected_keys)}
        pipe.unet.eval()
        pipe.scheduler = DDIMScheduler.from_config(pipe.scheduler.config, timestep_spacing='trailing')
        pipe = pipe.to('cpu')
        report['scheduler'] = {key: pipe.scheduler.config[key] for key in
                               ('prediction_type', 'beta_schedule', 'beta_start', 'beta_end',
                                'num_train_timesteps', 'clip_sample', 'timestep_spacing')}
        report['vaeScalingFactor'] = float(pipe.vae.config.scaling_factor)

        def save(name, tensor, **extra):
            values = np.ascontiguousarray(tensor.detach().to(torch.float32).cpu().numpy(), dtype='<f4')
            if not np.isfinite(values).all():
                raise ValueError(f'{name}: non-finite tensor')
            file = args.out / f'{name}.f32'
            values.tofile(file)
            report['tensors'][name] = {'file': file.name, 'shape': list(values.shape), 'dtype': 'float32',
                                       'byteLength': values.nbytes, 'sha256': digest(file), **extra}

        calls = report['calls']

        def output_hook(name):
            def hook(_module, _inputs, output):
                count = calls.get(name, 0)
                calls[name] = count + 1
                save(f'{name}#{count}', first_tensor(output))
            return hook

        handles = [module.register_forward_hook(output_hook(name)) for name, module in capture_points(pipe)]

        def unet_inputs(_module, inputs, kwargs):
            sample = inputs[0] if inputs else kwargs['sample']
            timestep = inputs[1] if len(inputs) > 1 else kwargs['timestep']
            save('unet.in.sample', sample)
            save('unet.in.encoder_hidden_states', kwargs['encoder_hidden_states'])
            report['timestep'] = int(torch.as_tensor(timestep).reshape(-1)[0].item())
        handles.append(pipe.unet.register_forward_pre_hook(unet_inputs, with_kwargs=True))

        def decode_input(_module, inputs):
            count = calls.get('vae.decode.in', 0)
            calls['vae.decode.in'] = count + 1
            save(f'vae.decode.in#{count}', inputs[0])
        handles.append(pipe.vae.post_quant_conv.register_forward_pre_hook(decode_input))

        report['phase'] = 'preprocess'
        image = load_rgba_image_as_rgb_tensor(image_path=args.image, image_size=args.image_size,
                                              device=torch.device('cpu'))
        save('input.rgb', image)

        report['phase'] = 'inference'
        with torch.no_grad():
            images = pipe(prompt='', num_inference_steps=1, source_image=image, output_type='pt',
                          generator=None)
        for handle in handles:
            handle.remove()

        report['phase'] = 'outputs'
        alpha = pipe.scheduler.alphas_cumprod[report['timestep']].to(torch.float64)
        report['x0Rule'] = {'formula': 'x0 = sqrt(alphaBar) * zeros - sqrt(1 - alphaBar) * v',
                            'alphaBar': float(alpha), 'vScale': float(-(1.0 - alpha).sqrt())}
        for index, role in enumerate(('albedo', 'orm')):
            save(f'output.{role}', images[index])
        from PIL import Image
        for role, tensor in (('albedo', images[0]), ('orm', images[1])):
            pixels = (tensor[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255.0).round().astype(np.uint8)
            Image.fromarray(pixels).save(args.out / f'{role}.png')
        orm = (images[1][0].clamp(0, 1).permute(1, 2, 0).numpy() * 255.0).round().astype(np.uint8)
        Image.fromarray(np.repeat(orm[:, :, 1:2], 3, axis=2)).save(args.out / 'roughness.png')
        Image.fromarray(np.repeat(orm[:, :, 2:3], 3, axis=2)).save(args.out / 'metallic.png')
        report['pngs'] = {name: digest(args.out / f'{name}.png')
                          for name in ('albedo', 'orm', 'roughness', 'metallic')}
        expected_calls = {'vae.post_quant': 2, 'vae.decoder.out': 2, 'unet.conv_out.0': 1,
                          'unet.conv_out.1': 1, 'vae.quant': 1, 'text.hidden': 1}
        for name, count in expected_calls.items():
            if calls.get(name) != count:
                raise ValueError(f'{name}: expected {count} captured calls, found {calls.get(name)}')
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
