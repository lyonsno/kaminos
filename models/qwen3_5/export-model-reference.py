"""Export the retained Q4 text-model source and actual FP32 prefill/decode references.

Run through Greenroom. No model conversion, clipping, or model download. The
manifest addresses existing safetensor ranges; reference arrays are standalone.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import struct
import sys
import traceback


def sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare(root, output, report):
    report['phase'] = 'source-admission'
    config_bytes = (root / 'config.json').read_bytes()
    config = json.loads(config_bytes)
    if config.get('model_type') != 'qwen3_5' or config.get('quantization') != {'group_size': 64, 'bits': 4, 'mode': 'affine'}:
        raise ValueError('expected retained dense Qwen3.5 affine4/group64 source')
    tensors = {}
    source_files = {}
    for file in sorted(root.glob('*.safetensors')):
        with file.open('rb') as f:
            length = struct.unpack('<Q', f.read(8))[0]
            raw_header = f.read(length)
            header = json.loads(raw_header)
            source_files[file.name] = {'bytes': file.stat().st_size, 'headerSha256': sha(raw_header)}
            for name, row in header.items():
                if not name.startswith('language_model.'):
                    continue
                key = name.removeprefix('language_model.')
                if key in tensors:
                    raise ValueError(f'duplicate source {name}')
                begin, end = row['data_offsets']
                elements = 1
                for dimension in row['shape']:
                    if not isinstance(dimension, int) or dimension < 1:
                        raise ValueError(f'invalid source shape {name}')
                    elements *= dimension
                width = {'U32': 4, 'BF16': 2}.get(row['dtype'])
                if not width or begin < 0 or end - begin != elements * width or length + 8 + end > file.stat().st_size:
                    raise ValueError(f'invalid source range/type {name}')
                f.seek(length + 8 + begin)
                digest = hashlib.sha256()
                remaining = end - begin
                while remaining:
                    data = f.read(min(4 * 1024 * 1024, remaining))
                    if not data:
                        raise ValueError(f'partial source {name}')
                    digest.update(data)
                    remaining -= len(data)
                tensors[key] = {
                    'file': file.name, 'offset': length + 8 + begin, 'bytes': end - begin,
                    'shape': row['shape'], 'dtype': row['dtype'], 'sha256': digest.hexdigest()}
    if not tensors:
        raise ValueError('no language model tensors')
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'schema': 'kaminos.qwen35-text-weights.v1', 'config': config,
                'source': {'localRoot': str(root), 'configSha256': sha(config_bytes), 'files': source_files}, 'tensors': tensors}
    (output / 'weights.json').write_text(json.dumps(manifest, indent=2) + '\n')
    report['weightsManifestSha256'] = sha((output / 'weights.json').read_bytes())
    return config, manifest


def load_native_fp32(root, config, report):
    """Exact retained language weights and lossless FP32 parameter expansion."""
    report['phase'] = 'native-runtime'
    import mlx.core as mx
    from mlx.utils import tree_map
    from mlx_vlm.utils import load_model_weights
    from mlx_vlm.models.qwen3_5 import language, gated_delta
    from mlx_vlm.models.qwen3_5.config import TextConfig
    if not mx.metal.is_available():
        raise RuntimeError('native MLX Metal required')
    mx.set_default_device(mx.gpu)
    report['effective'] = {'backend': 'mlx-metal', 'device': str(mx.default_device()),
        'activationDtype': 'float32', 'smallParameters': 'lossless BF16 to float32',
        'mlx': importlib.metadata.version('mlx'), 'mlx_vlm': importlib.metadata.version('mlx-vlm')}
    report['implementation'] = {str(Path(module.__file__).resolve()): sha(Path(module.__file__).read_bytes()) for module in [language, gated_delta]}
    report['phase'] = 'native-model-load'
    weights = {}
    for file in sorted(root.glob('*.safetensors')):
        loaded = mx.load(str(file))
        weights.update({key.removeprefix('language_model.'): value for key, value in loaded.items() if key.startswith('language_model.')})
        del loaded
    model = language.LanguageModel(TextConfig.from_dict(config['text_config']))
    load_model_weights(model, {'quantization': config['quantization']}, weights, root, lazy=True)
    del weights
    model.update(tree_map(lambda value: value.astype(mx.float32) if mx.issubdtype(value.dtype, mx.floating) else value, model.parameters()))
    model.eval()
    return model, mx


def export(root, output, text, report):
    config, manifest = prepare(root, output, report)
    model, mx = load_native_fp32(root, config, report)
    import numpy as np
    from tokenizers import Tokenizer
    tokenizer = Tokenizer.from_file(str(root / 'tokenizer.json'))
    prompt = tokenizer.encode(text, add_special_tokens=False).ids
    if len(prompt) < 2:
        raise ValueError('reference input needs multiple tokens for cached continuation')
    arrays = {}

    def save(name, value):
        mx.eval(value)
        data = np.ascontiguousarray(np.array(value, dtype=np.float32))
        raw = data.tobytes()
        if not np.isfinite(data).all():
            raise ValueError(f'nonfinite reference {name}')
        (output / (name + '.bin')).write_bytes(raw)
        arrays[name] = {'file': name + '.bin', 'shape': list(data.shape), 'bytes': len(raw), 'sha256': sha(raw), 'dtype': 'f32'}
        return data

    def run(name, ids, cache, offset):
        report['phase'] = name
        inputs = mx.array([ids], dtype=mx.int32)
        positions = mx.broadcast_to(mx.arange(offset, offset + len(ids))[None, None, :], (3, 1, len(ids)))
        sink = []
        hidden = model.model(inputs, cache=cache, position_ids=positions,
                             capture_layer_ids=list(range(config['text_config']['num_hidden_layers'])), hidden_sink=sink)
        logits = model.lm_head(hidden[:, -1:, :])
        values = save(name + '.logits', logits.reshape(-1))
        save(name + '.layers', mx.stack([row[0, -1] for row in sink]))
        save(name + '.norm', hidden[0, -1])
        return int(values.argmax())

    cache = model.make_cache()
    next_token = run('prefill', prompt, cache, 0)
    continuation = [next_token]
    next_after_decode = run('decode', continuation, cache, len(prompt))
    next_after_full = run('full-prefix', prompt + continuation, model.make_cache(), 0)
    if next_after_decode != next_after_full:
        raise ValueError('native cached and full-prefix argmax diverged')
    refs = {'schema': 'kaminos.qwen35-model-reference.v1', 'source': manifest['source'],
        'weightsManifestSha256': report['weightsManifestSha256'], 'effective': report['effective'],
        'implementation': report['implementation'], 'inputText': text, 'inputIds': prompt,
        'continuationIds': continuation, 'expectedNextIds': {'prefill': next_token, 'decode': next_after_decode, 'full-prefix': next_after_full},
        'arrays': arrays}
    (output / 'meta.json').write_text(json.dumps(refs, indent=2) + '\n')
    report.update(status='passed', phase='complete', arrays=len(arrays), inputIds=prompt,
                  expectedNextIds=refs['expectedNextIds'], metaSha256=sha((output / 'meta.json').read_bytes()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--text', default='A red fox in a forest.')
    parser.add_argument('--manifest-only', action='store_true', help='write the source-range manifest without importing or executing MLX')
    args = parser.parse_args()
    report = {'status': 'failed', 'phase': 'setup', 'requested': {'modelRoot': str(args.model_dir.resolve()), 'text': args.text},
              'exporter': {'path': str(Path(__file__).resolve()), 'sha256': sha(Path(__file__).read_bytes())}}
    try:
        if args.manifest_only:
            prepare(args.model_dir.resolve(), args.out.resolve(), report)
            report.update(status='passed', phase='complete', effective={'backend': 'source-files-only'}, output=str(args.out.resolve() / 'weights.json'))
        else:
            export(args.model_dir.resolve(), args.out.resolve(), args.text, report)
    except BaseException:
        report['error'] = traceback.format_exc()
    finally:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
