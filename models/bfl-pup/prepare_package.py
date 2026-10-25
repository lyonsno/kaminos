"""Assemble exact BFL ONNX components for Transformers.js, without loading weights.

Run through Greenroom. External files are split at tensor boundaries for browser
ArrayBuffer loading; no tensor, token or model capacity is truncated.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import traceback
from pathlib import Path


def cache_name(name):
    match = re.fullmatch(r'(past|present)\.(\d+)\.(conv|recurrent)', name)
    return f'{match[1]}_{match[3]}.{match[2]}' if match else name


def package_graph(source, target, *, head_dim, chunk_bytes=2**31-1):
    import onnx
    model = onnx.load(str(source), load_external_data=False)
    # GenAI leaves head dimension symbolic; JS creates initial cache tensors from
    # metadata. Preserve the source's actual head dimension, not an inferred zero.
    for value in [*model.graph.input, *model.graph.output, *model.graph.value_info]:
        value.name = cache_name(value.name)
        for dim in value.type.tensor_type.shape.dim:
            if dim.dim_param == 'kv_cache_dim':
                dim.dim_value = head_dim
    for node in model.graph.node:
        for field in [node.input, node.output]:
            for i, name in enumerate(field):
                field[i] = cache_name(name)
    index = -1
    written = 0
    output = None
    try:
        for tensor in model.graph.initializer:
            if not tensor.external_data:
                continue
            data = {entry.key: entry.value for entry in tensor.external_data}
            raw_path = source.parent / data['location']
            if raw_path.resolve().parent != source.parent.resolve():
                raise ValueError('External tensor path escapes component directory.')
            offset = int(data.get('offset', 0))
            length = int(data.get('length', raw_path.stat().st_size - offset))
            if offset < 0 or length < 0 or offset + length > raw_path.stat().st_size:
                raise ValueError(f'External tensor {tensor.name} is incomplete.')
            if length > chunk_bytes:
                raise ValueError(f'Tensor {tensor.name} exceeds a single browser data file; tensor splitting requires a new graph.')
            if output is None or written + length > chunk_bytes:
                if output:
                    output.close()
                index += 1
                file_name = target.name + '_data' + (f'_{index}' if index else '')
                output = (target.parent / file_name).open('xb')
                written = 0
            with raw_path.open('rb') as handle:
                handle.seek(offset)
                remaining = length
                while remaining:
                    chunk = handle.read(min(2**20, remaining))
                    if not chunk:
                        raise ValueError(f'External tensor {tensor.name} became incomplete.')
                    output.write(chunk)
                    remaining -= len(chunk)
            del tensor.external_data[:]
            for key, value in [('location', file_name), ('offset', str(written)), ('length', str(length))]:
                entry = tensor.external_data.add()
                entry.key, entry.value = key, value
            written += length
    finally:
        if output:
            output.close()
    # Serialize metadata only: save_model may re-open external initializers.
    target.write_bytes(model.SerializeToString())
    return index + 1


def browser_processor_metadata(preprocessor, processor):
    processor_class=processor.get('processor_class')
    if processor_class!='Qwen3VLProcessor':
        raise ValueError('Expected the canonical BFL Qwen3VL processor.')
    return {**preprocessor,'processor_class':processor_class}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['source', 'decoder', 'vision', 'embeddings', 'system-prompts', 'out', 'report']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    report = dict(status='running', phase='validate-components', source=str(args.source),
                  transformers_js='4.2.0', output=str(args.out))
    def save():
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2)+'\n')
    save()
    try:
        config = json.loads((args.source/'config.json').read_text())
        if args.source.name != '3f3edb52b2c55de0d49feab28598b68f7f8e4830' or config.get('model_type') != 'qwen3_5':
            raise ValueError('Expected the exact pinned BFL Qwen3.5 helper.')
        for component in [args.vision, args.embeddings]:
            source_report = json.loads((component/'report.json').read_text())
            if source_report.get('status') != 'complete' or source_report.get('source_weight_sha256') != 'f5062a1fba3e63afe5c88349a311903fec06c959b362f1247127e63d5c860ed4':
                raise ValueError(f'Component has no completed exact-source attestation: {component}')
        terminal = json.loads((args.decoder/'observer-terminal.json').read_text())
        if not terminal.get('succeeded') or terminal.get('job_id') != 'f8dc1888521f':
            raise ValueError('Decoder export did not complete on the expected source-attested job.')
        if args.out.exists() and any(args.out.iterdir()):
            raise ValueError('Choose a fresh output directory; existing artifacts are preserved.')
        (args.out/'onnx').mkdir(parents=True)
        for path in args.source.iterdir():
            if path.is_file() and path.suffix in {'.json', '.jinja', '.md'}:
                shutil.copyfile(path, args.out/path.name)
        shutil.copyfile(args.system_prompts, args.out/'system_prompts.json')
        preprocessor=browser_processor_metadata(json.loads((args.out/'preprocessor_config.json').read_text()),
            json.loads((args.out/'processor_config.json').read_text()))
        (args.out/'preprocessor_config.json').write_text(json.dumps(preprocessor,indent=2)+'\n')
        external = {}
        for folder, name in [(args.decoder,'decoder_model_merged_q4f16.onnx'),
                             (args.vision,'vision_encoder_fp16.onnx'),
                             (args.embeddings,'embed_tokens_q4f16.onnx')]:
            report['phase'] = f'package-{name}'
            save()
            external[name] = package_graph(folder/name,args.out/'onnx'/name,head_dim=config['text_config']['head_dim'])
        config['transformers.js_config'] = dict(use_external_data_format=external,
            kv_cache_dtype={'q4f16':'float16'}, dtype=dict(embed_tokens='q4f16',
            vision_encoder='fp16', decoder_model_merged='q4f16'))
        (args.out/'config.json').write_text(json.dumps(config,indent=2)+'\n')
        report.update(status='complete',phase='package-written', external_data=external,
            claim='exact-source browser package construction; browser execution not established',
            vision_arithmetic='float32 with fp16 parameter storage and output',
            files=[dict(path=str(p.relative_to(args.out)),bytes=p.stat().st_size) for p in args.out.rglob('*') if p.is_file()])
        (args.out/'provenance.json').write_text(json.dumps(report,indent=2)+'\n')
        save()
    except BaseException as error:
        report.update(status='failed',error=str(error),traceback=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    main()
