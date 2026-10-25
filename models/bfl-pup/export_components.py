"""Export BFL PUP token embeddings (Q4) and per-image vision (FP16) to ONNX.

Run through the shared compute queue. The language decoder is exported by the
pinned ONNX Runtime GenAI builder. All persistent paths belong to the caller.
"""
import argparse
import hashlib
import importlib.metadata
import json
import shutil
import struct
import time
import traceback
from pathlib import Path


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def export_vision(source, out, config, report, save):
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from safetensors import safe_open
    from transformers.models.qwen3_5.configuration_qwen3_5 import Qwen3_5VisionConfig
    from transformers.models.qwen3_5.modeling_qwen3_5 import Qwen3_5VisionModel, Qwen3_5VisionRotaryEmbedding
    from transformers.vision_utils import get_vision_interpolation_indices_and_weights, get_vision_position_ids
    from vision_export import VisionForExport

    vc = Qwen3_5VisionConfig(**config['vision_config'])
    vc._attn_implementation = 'sdpa'
    with torch.device('meta'):
        vision = Qwen3_5VisionModel(vc)
    with safe_open(str(source / 'model.safetensors'), framework='pt', device='cpu') as weights:
        state = {key.removeprefix('model.visual.'): weights.get_tensor(key).to(torch.float16)
                 for key in weights.keys() if key.startswith('model.visual.')}
    vision.load_state_dict(state, strict=True, assign=True)
    vision.rotary_pos_emb = Qwen3_5VisionRotaryEmbedding(vc)
    vision.eval()
    wrapper = VisionForExport(vision).eval()
    names = ['pixel_values', 'position_ids', 'interp_indices', 'interp_weights', 'grid_thw']

    def inputs(h, w):
        grid = torch.tensor([[1, h, w]], dtype=torch.int64)
        width = vc.in_channels * vc.temporal_patch_size * vc.patch_size ** 2
        pixels = torch.linspace(-1, 1, h * w * width).reshape(h * w, width)
        positions = get_vision_position_ids(grid, vc.spatial_merge_size)
        indices, weights = get_vision_interpolation_indices_and_weights(
            grid, int(vc.num_position_embeddings ** .5), align_corners=True,
            spatial_merge_size=vc.spatial_merge_size)
        return pixels, positions, indices, weights, grid

    report['phase'] = 'vision-reference'
    report['vision_reference'] = []
    save()
    with torch.no_grad():
        for h, w in [(4, 4), (4, 6)]:
            args = inputs(h, w)
            original = vision(args[0], args[-1]).pooler_output.float().numpy()
            actual = wrapper(*args).float().numpy()
            relative = float(np.linalg.norm(actual - original) / max(np.linalg.norm(original), 1e-12))
            if relative > .003:
                raise ValueError(f'Vision export wrapper disagrees with source: relative L2 {relative}')
            np.savez(out / f'vision-reference-{h}x{w}.npz', expected=original, wrapper=actual,
                     **{name: value.numpy() for name, value in zip(names, args)})
            report['vision_reference'].append(dict(grid=[1, h, w], relative_l2=relative))
            save()
        report['phase'] = 'vision-export'
        save()
        target = out / 'vision_encoder_fp16.onnx'
        torch.onnx.export(wrapper, inputs(4, 4), target, input_names=names,
            output_names=['image_features'], opset_version=17, dynamo=False,
            dynamic_axes={**{name: {0: 'patches' if name != 'grid_thw' else 'images'} for name in names},
                          'image_features': {0: 'features'}})

    # Normalize the external-data filename to Transformers.js's component convention.
    graph = onnx.load(str(target))
    onnx.save_model(graph, str(target), save_as_external_data=True, all_tensors_to_one_file=True,
                    location=target.name + '_data', size_threshold=1024)
    report['phase'] = 'vision-onnx-reference'
    save()
    session = ort.InferenceSession(str(target), providers=['CPUExecutionProvider'])
    for row in report['vision_reference']:
        _, h, w = row['grid']
        fixture = np.load(out / f'vision-reference-{h}x{w}.npz')
        actual = session.run(None, {item.name: fixture[item.name] for item in session.get_inputs()})[0].astype(np.float32)
        original = fixture['expected']
        relative = float(np.linalg.norm(actual - original) / max(np.linalg.norm(original), 1e-12))
        row['onnx_relative_l2'] = relative
        if not np.isfinite(actual).all() or relative > .005:
            raise ValueError(f'Vision ONNX disagrees with source: relative L2 {relative}')
        save()
    report['vision_contract'] = dict(per_call='one image; concatenate features in reference order',
        inputs=[item.name for item in session.get_inputs()], output='image_features', storage='fp16')
    return target


def export_embeddings(source, out, config, report, save):
    import onnx
    import torch
    from onnx import TensorProto, helper, numpy_helper
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    from safetensors import safe_open

    report['phase'] = 'embedding-read'
    save()
    with safe_open(str(source / 'model.safetensors'), framework='pt', device='cpu') as weights:
        embedding = weights.get_tensor('model.language_model.embed_tokens.weight').to(torch.float16).numpy()
    hidden = config['text_config']['hidden_size']
    if list(embedding.shape) != [config['text_config']['vocab_size'], hidden]:
        raise ValueError('Embedding shape disagrees with the source config.')
    graph = helper.make_graph([helper.make_node('Gather', ['weight', 'input_ids'], ['inputs_embeds'],
        axis=0, name='token_embedding')], 'bfl_pup_embeddings',
        [helper.make_tensor_value_info('input_ids', TensorProto.INT64, ['batch', 'tokens'])],
        [helper.make_tensor_value_info('inputs_embeds', TensorProto.FLOAT16, ['batch', 'tokens', hidden])],
        [numpy_helper.from_array(embedding, 'weight')])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 21)], ir_version=10)
    report['phase'] = 'embedding-quantize'
    save()
    quantizer = MatMulNBitsQuantizer(model, bits=4, block_size=64, is_symmetric=False,
        op_types_to_quantize=('Gather',), quant_axes=(('Gather', 1),))
    quantizer.process()
    result = quantizer.model.model
    if not any(node.op_type == 'GatherBlockQuantized' for node in result.graph.node):
        raise ValueError('The embedding quantizer did not produce a Q4 gather.')
    target = out / 'embed_tokens_q4f16.onnx'
    onnx.save_model(result, str(target), save_as_external_data=True, all_tensors_to_one_file=True,
                    location=target.name + '_data', size_threshold=1024)
    report['embedding_contract'] = dict(storage='uint4', block_size=64, io='float16',
        input='input_ids', output='inputs_embeds', shape=list(embedding.shape))
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--source-revision', required=True)
    parser.add_argument('--source-weight-sha256', required=True,
                        help='Expected LFS SHA-256 from the pinned source repository tree')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--component', choices=['vision', 'embeddings'], required=True)
    args = parser.parse_args()
    started = time.monotonic()
    report = dict(status='running', phase='source-validation', component=args.component,
        source_repo='black-forest-labs/flux-3-image-klein-pup', source_revision=args.source_revision,
        source_dir=str(args.source_dir.resolve()), output_dir=str(args.out.resolve()))
    save = lambda: write(args.report, report)
    save()
    try:
        config = json.loads((args.source_dir / 'config.json').read_text())
        if config.get('model_type') != 'qwen3_5' or config['text_config']['hidden_size'] != 4096:
            raise ValueError('Expected the BFL Qwen3.5-9B helper source, without model substitution.')
        if args.source_dir.name != args.source_revision:
            raise ValueError('Source snapshot directory does not match its requested revision.')
        weights = args.source_dir / 'model.safetensors'
        before = weights.stat()
        report['phase'] = 'source-digest'
        save()
        digest = hashlib.sha256()
        with weights.open('rb') as handle:
            for chunk in iter(lambda: handle.read(2 ** 20), b''):
                digest.update(chunk)
        if digest.hexdigest() != args.source_weight_sha256:
            raise ValueError('Source weights do not match the pinned repository LFS digest.')
        after = weights.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise ValueError('Source weights changed during attestation.')
        report['source_weight_sha256'] = digest.hexdigest()
        report['source_stat'] = dict(bytes=after.st_size, mtime_ns=after.st_mtime_ns, inode=after.st_ino)
        with weights.open('rb') as handle:
            header_length = struct.unpack('<Q', handle.read(8))[0]
            header = json.loads(handle.read(header_length))
        args.out.mkdir(parents=True, exist_ok=True)
        if (args.out / ('vision_encoder_fp16.onnx' if args.component == 'vision' else 'embed_tokens_q4f16.onnx')).exists():
            raise ValueError('Choose a fresh component output directory; existing artifacts are preserved.')
        write(args.out / 'source-safetensors-header.json', header)
        for path in args.source_dir.iterdir():
            if path.is_file() and path.suffix in {'.json', '.jinja', '.md'}:
                shutil.copyfile(path, args.out / path.name)
        report['source_weight_bytes'] = weights.stat().st_size
        report['source_header_sha256'] = hashlib.sha256(json.dumps(header, sort_keys=True).encode()).hexdigest()
        report['versions'] = {name: importlib.metadata.version(name) for name in
            ['torch', 'transformers', 'onnx', 'onnxruntime', 'safetensors']}
        save()
        target = (export_vision if args.component == 'vision' else export_embeddings)(
            args.source_dir, args.out, config, report, save)
        report.update(status='complete', phase='component-exported', graph=str(target),
            files=[dict(name=p.name, bytes=p.stat().st_size) for p in args.out.iterdir() if p.is_file()],
            claim='component construction and recorded CPU checks; browser execution remains unverified')
    except BaseException as error:
        report.update(status='failed', error=str(error), traceback=traceback.format_exc())
        raise
    finally:
        report['elapsed_seconds'] = time.monotonic() - started
        save()


if __name__ == '__main__':
    main()
