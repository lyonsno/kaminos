"""Integer-weight LiMo conversion and native MPS route checks."""
import argparse
from fnmatch import fnmatch
import gc
import importlib.metadata
import json
from pathlib import Path
import resource

import torch
from optimum.quanto import QModuleMixin, freeze, quantization_map, quantize, qint4, qint8
from safetensors.torch import load_file, save_file

from diffusionlight_probe import require_mps, save_json
from emlight_probe import digest


def quantize_linears(model, bits, exclude=()):
    if bits not in (4, 8):
        raise ValueError('weight bits must be 4 or 8')
    names = [name for name, module in model.named_modules()
             if name and isinstance(module, torch.nn.Linear)
             and not any(fnmatch(name, pattern) for pattern in exclude)]
    if not names:
        raise ValueError('no eligible linear weights')
    for name in names:
        model.get_submodule(name).to(dtype=torch.float16)
        quantize(model, weights=qint4 if bits == 4 else qint8, include=[name])
        freeze(model.get_submodule(name))
    return names


def tensor_specs(state):
    return {name: {'shape': list(value.shape), 'dtype': str(value.dtype)}
            for name, value in state.items()}


def save_package(model, root, source):
    root.mkdir(parents=True, exist_ok=False)
    state = model.state_dict()
    # T5 shares its embedding matrix. Keep one payload and explicit aliases.
    unique, aliases, addresses = {}, {}, {}
    for name, value in state.items():
        address = (value.untyped_storage().data_ptr(), value.storage_offset(),
                   tuple(value.shape), tuple(value.stride()), value.dtype)
        if address in addresses:
            aliases[name] = addresses[address]
        else:
            addresses[address] = name
            unique[name] = value.detach().cpu().contiguous()
    path = root / 'weights.safetensors'
    save_file(unique, str(path))
    record = {'schema': 'kaminos.limo-quanto.v1', 'source': source,
              'quantization': quantization_map(model), 'aliases': aliases,
              'tensors': tensor_specs(state),
              'versions': {name: importlib.metadata.version(name)
                           for name in ('torch', 'optimum-quanto', 'diffusers', 'transformers')},
              'weights': {'bytes': path.stat().st_size, 'sha256': digest(path)}}
    save_json(root / 'package.json', record)
    return record


def load_package(model, root):
    record = json.loads((root / 'package.json').read_text())
    if record['schema'] != 'kaminos.limo-quanto.v1' or not record['quantization']:
        raise ValueError('not a quantized LiMo package')
    path = root / 'weights.safetensors'
    if path.stat().st_size != record['weights']['bytes'] or digest(path) != record['weights']['sha256']:
        raise ValueError('packed weight digest mismatch')
    state = load_file(str(path), device='cpu')
    for alias, canonical in record['aliases'].items():
        if alias in state or canonical not in state:
            raise ValueError('invalid weight alias')
        state[alias] = state[canonical]
    if tensor_specs(state) != record['tensors']:
        raise ValueError('packed tensor coverage mismatch')
    available = dict(model.named_modules())
    for name, config in record['quantization'].items():
        if name not in available or not isinstance(available[name], torch.nn.Linear):
            raise ValueError(f'quantized module absent: {name}')
        if config['weights'] not in ('qint4', 'qint8') or config['activations'] != 'none':
            raise ValueError('unsupported quantization configuration')
        quantize(model, weights=config['weights'], include=[name])
    # Quanto's requantize materializes full float parameters before loading. Assign
    # directly into a meta model instead, so reload retains the memory benefit.
    model.load_state_dict(state, strict=False, assign=True)
    if any(parameter.device.type == 'meta' for parameter in model.parameters()):
        raise ValueError('unloaded meta parameter')
    if tensor_specs(model.state_dict()) != record['tensors']:
        raise ValueError('loaded tensor coverage mismatch')
    for name, config in record['quantization'].items():
        module = model.get_submodule(name)
        if not module.frozen or module.weight.qtype.name != config['weights']:
            raise ValueError('integer weights were not retained')
    return model.eval(), record


def tiny_model(device='cpu'):
    with torch.device(device):
        return torch.nn.Sequential(torch.nn.Linear(256, 256), torch.nn.SiLU(),
                                   torch.nn.Linear(256, 256)).half().eval()


def route_check(args, report, phase):
    require_mps()
    report['effective'] = {'device': 'mps', 'torch': torch.__version__,
                           'quanto': importlib.metadata.version('optimum-quanto'),
                           'cpuFallback': False, 'arithmetic': 'fp16; integer weight storage'}
    report['checks'] = []
    for bits in (4, 8):
        phase(f'int{bits}-quantize-save-reload')
        torch.manual_seed(31)
        model = tiny_model()
        inputs = torch.randn(2, 16, 256).half()
        with torch.inference_mode():
            reference = model(inputs)
        quantize_linears(model, bits)
        with torch.inference_mode():
            packed_cpu = model(inputs)
        record = save_package(model, args.output_dir / f'int{bits}', {'scope': 'tiny route conformance'})
        del model
        gc.collect()
        loaded, _ = load_package(tiny_model('meta'), args.output_dir / f'int{bits}')
        torch.mps.empty_cache()
        before = torch.mps.current_allocated_memory()
        loaded.to('mps')
        weight_bytes = torch.mps.current_allocated_memory() - before
        with torch.inference_mode():
            actual = loaded(inputs.to('mps')).cpu()
        torch.mps.synchronize()
        if not torch.isfinite(actual).all():
            raise ValueError('nonfinite quantized MPS output')
        torch.testing.assert_close(actual, packed_cpu, rtol=.02, atol=.002)
        report['checks'].append({'bits': bits, 'packedFileBytes': record['weights']['bytes'],
                                 'mpsWeightAllocationBytes': weight_bytes,
                                 'fp16ParameterBytes': 2 * (256 * 256 + 256) * 2,
                                 'cpuReloadMaxAbs': float((actual - packed_cpu).abs().max()),
                                 'referenceRelativeL2': float((actual.float() - reference.float()).norm()
                                                              / reference.float().norm())})
        del loaded, actual, packed_cpu, reference, inputs
        gc.collect()
        torch.mps.empty_cache()


def convert(args, report, phase):
    from diffusers import FluxTransformer2DModel
    from transformers import T5EncoderModel, CLIPTextModel
    from limo_probe import conditioned_config, CHECKPOINT_BYTES
    phase('source-loading')
    if args.component == 'transformer':
        if args.checkpoint.stat().st_size != CHECKPOINT_BYTES:
            raise ValueError('incomplete source checkpoint')
        config = conditioned_config(json.loads((args.support / 'transformer/config.json').read_text()))
        with torch.device('meta'):
            model = FluxTransformer2DModel.from_config(config)
        state = torch.load(args.checkpoint, map_location='cpu', weights_only=True, mmap=True)
        model.load_state_dict(state['module'], strict=True, assign=True)
        del state
        source = {'component': args.component, 'checkpointSha256': digest(args.checkpoint), 'config': config}
        exclude = ('proj_out', 'x_embedder', 'context_embedder', 'time_text_embed.*')
    else:
        cls = T5EncoderModel if args.component == 't5' else CLIPTextModel
        subdir = args.support / ('text_encoder_2' if args.component == 't5' else 'text_encoder')
        model = cls.from_pretrained(str(subdir), torch_dtype=torch.float16, local_files_only=True)
        source = {'component': args.component, 'config': model.config.to_dict(),
                  'files': {p.name: digest(p) for p in sorted(subdir.glob('*')) if p.is_file()}}
        exclude = ()
    model.eval().requires_grad_(False)
    report['sourceParameterBytes'] = sum(p.numel() * p.element_size() for p in model.parameters())
    report['effective'] = {'conversionDevice': 'cpu', 'bits': args.bits,
                           'quanto': importlib.metadata.version('optimum-quanto'),
                           'torch': torch.__version__, 'excludedModules': list(exclude)}
    phase('weight-quantization')
    report['quantizedModules'] = quantize_linears(model, args.bits, exclude)
    # Nonlinear layers and excluded projections retain FP16, never float8 on MPS.
    model.to(dtype=torch.float16)
    phase('packed-serialization')
    record = save_package(model, args.output_dir / 'model', source)
    report['package'] = record
    report['packedRatio'] = record['weights']['bytes'] / report['sourceParameterBytes']
    report['hostPeakRssBytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    del model
    gc.collect()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--route-check', action='store_true')
    parser.add_argument('--component', choices=('transformer', 't5', 'clip'), default='transformer')
    parser.add_argument('--bits', choices=(4, 8), type=int, default=4)
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--support', type=Path)
    args = parser.parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    path = args.output_dir / 'conversion.json'
    if path.exists():
        raise FileExistsError('preserve prior conversion; choose a fresh output directory')
    report = {'schema': 'kaminos.limo-compression.v1', 'status': 'failed', 'phase': 'initialization',
              'receiver': 'welcome-to-the-desert-of-the-real', 'adapterSha256': digest(__file__),
              'requested': {'bits': args.bits, 'component': args.component, 'routeCheck': args.route_check}}
    def phase(name):
        report['phase'] = name
        save_json(path, report)
        print(name, flush=True)
    phase('initialization')
    try:
        if args.route_check:
            route_check(args, report, phase)
        else:
            if args.support is None or (args.component == 'transformer' and args.checkpoint is None):
                raise ValueError('conversion requires support and transformer checkpoint')
            convert(args, report, phase)
        report.update(status='complete', phase='complete')
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        save_json(path, report)


if __name__ == '__main__':
    main()
