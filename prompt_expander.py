"""Local BFL prompt helper. HTTP/queue plumbing imports no model dependencies.

Set KAMINOS_PROMPT_EXPANDER_CONFIG to a caller-owned JSON configuration.
The queued CLI reads request.json and always writes a report, including failures.
"""
import argparse
import base64
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time
import traceback
from urllib.parse import urlparse
import uuid

MODEL_REPO = 'mlx-community/flux-3-image-klein-pup-4bit'
MAX_REFERENCES = 10  # BFL pup.py's actual model/harness contract.
SAMPLING = dict(temperature=0.0, top_p=0.95, top_k=20, min_p=0.0, max_tokens=3584)
SCAFFOLD = 'Reference images follow in order (the first image, the second image, ...).\nUser request: {instruction}\nOutput the caption.'


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def configuration():
    path = os.environ.get('KAMINOS_PROMPT_EXPANDER_CONFIG')
    if not path:
        raise ValueError('Set KAMINOS_PROMPT_EXPANDER_CONFIG to the local helper configuration.')
    config = read(path)
    for key in ('model_dir', 'model_repo', 'model_revision', 'python', 'queue_dir', 'greenroom_bin', 'state_dir'):
        if not config.get(key):
            raise ValueError(f'Missing configuration: {key}')
    return config


def availability(config):
    """Check local installation only. Inference separately proves the effective backend."""
    try:
        model = Path(config['model_dir'])
        architecture = read(model / 'config.json')
        if config['model_repo'] != MODEL_REPO or architecture.get('model_type') != 'qwen3_5':
            raise ValueError('Expected the BFL Qwen3.5 prompt-helper four-bit conversion.')
        if architecture.get('quantization', {}).get('bits') != 4:
            raise ValueError('Expected four-bit model configuration.')
        weights = set(read(model / 'model.safetensors.index.json')['weight_map'].values())
        if not weights:
            raise ValueError('Empty model weight index.')
        for name in weights:
            if not (model / name).is_file() or (model / name).stat().st_size == 0:
                raise ValueError(f'Model download incomplete: {name}')
        prompts = read(model / 'system_prompts.json')
        if not all(isinstance(prompts.get(task), str) and prompts[task].strip() for task in ('t2i', 'i2i')):
            raise ValueError('Missing BFL system prompts.')
        for name in ('python', 'greenroom_bin'):
            if not os.access(config[name], os.X_OK):
                raise ValueError(f'Unavailable executable: {config[name]}')
        return True, None
    except (OSError, ValueError, KeyError, TypeError) as error:
        return False, str(error)


def submit(config, payload, repo_root):
    prompt = payload.get('prompt')
    images = payload.get('images', [])
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError('Enter a prompt.')
    if not isinstance(images, list) or len(images) > MAX_REFERENCES:
        raise ValueError(f'BFL supports at most {MAX_REFERENCES} reference images.')
    decoded = []
    for image in images:
        if not isinstance(image, dict) or not isinstance(image.get('data'), str):
            raise ValueError('Each reference must contain base64 image data.')
        try:
            raw = base64.b64decode(image['data'], validate=True)
        except (ValueError, TypeError) as error:
            raise ValueError('Invalid reference image encoding.') from error
        if not raw:
            raise ValueError('Empty reference image.')
        decoded.append((str(image.get('name', 'reference')), raw))
    available, reason = availability(config)
    if not available:
        raise RuntimeError(reason)
    run_id = uuid.uuid4().hex
    run = Path(config['state_dir']) / run_id
    run.mkdir(parents=True)
    references = []
    for index, (name, raw) in enumerate(decoded):
        target = run / f'reference-{index}.image'
        target.write_bytes(raw)
        references.append(dict(name=name, path=str(target), sha256=hashlib.sha256(raw).hexdigest()))
    request = dict(schema='kaminos.prompt-expander.request.v1', id=run_id, prompt=prompt,
                   images=references, config=config, submitted_at=time.time())
    write(run / 'request.json', request)
    manifest = dict(schema='gpu-greenroom.command.v1', agent_id='thomas-the-jank-engine',
                    repo_root=str(repo_root), cwd=str(repo_root), output_dir=str(run),
                    route_identity='bfl-pup/mlx-metal/4bit', timeout=None,
                    env={'HF_HUB_OFFLINE': '1', 'TOKENIZERS_PARALLELISM': 'false'},
                    argv=[config['python'], '-u', str(repo_root / 'prompt_expander.py'),
                          '--request', str(run / 'request.json'), '--report', str(run / 'report.json')])
    write(run / 'command.json', manifest)
    try:
        result = subprocess.run([config['greenroom_bin'], '--queue-dir', config['queue_dir'],
                                 'submit-command', '--manifest', str(run / 'command.json')],
                                capture_output=True, text=True, check=True)
        queue = json.loads(result.stdout)
        if not queue.get('job_id'):
            raise RuntimeError('Queue submission returned no job id.')
        write(run / 'queue.json', queue)
        return dict(id=run_id, status='queued', job_id=queue['job_id'])
    except Exception as error:
        write(run / 'report.json', dict(status='failed', phase='submission', error=str(error)))
        raise


def run_status(config, run_id):
    if not re.fullmatch(r'[a-f0-9]{32}', run_id):
        raise ValueError('Invalid run id.')
    run = Path(config['state_dir']) / run_id
    request = read(run / 'request.json')
    result = dict(id=run_id, status='queued', prompt=request['prompt'],
                  images=[dict(name=x['name'], sha256=x['sha256']) for x in request['images']],
                  submitted_at=request['submitted_at'])
    if (run / 'queue.json').exists():
        result['job_id'] = read(run / 'queue.json')['job_id']
    if (run / 'report.json').exists():
        result.update(read(run / 'report.json'))
        if result['status'] == 'complete' and (not result.get('output', '').strip() or result.get('effective_backend') != 'mlx-metal'):
            result.update(status='failed', phase='report-validation', error='Incomplete or unexpected backend evidence.')
    if result['status'] in ('queued', 'running') and result.get('job_id'):
        # A killed worker can leave its last progress report behind. Consult the
        # queue's terminal state as well so progress cannot impersonate liveness.
        for bucket in ('done', 'failed', 'cancelled'):
            queue_file = Path(config['queue_dir']) / bucket / result['job_id'] / 'status.json'
            if queue_file.exists():
                queue_state = read(queue_file)
                result.update(status='failed', phase='worker-terminal', queue_terminal=queue_state,
                              error=f'Queue ended ({bucket}) without a complete expansion.')
                break
    return result


def handle(handler, method, path, repo_root):
    origin = handler.headers.get('Origin')
    if origin and urlparse(origin).netloc != handler.headers.get('Host'):
        return handler.send_json(dict(error='Cross-origin helper requests are not allowed.'), 403)
    try:
        config = configuration()
    except (OSError, ValueError) as error:
        return handler.send_json(dict(status='unavailable', phase='configuration', error=str(error)), 503)
    try:
        if method == 'GET' and path == '/api/prompt-expander/config':
            available, reason = availability(config)
            return handler.send_json(dict(available=available, reason=reason, model_repo=config['model_repo'],
                                          model_revision=config['model_revision'], backend='Local MLX · Metal', max_references=MAX_REFERENCES))
        if method == 'POST' and path == '/api/prompt-expander/runs':
            if handler.headers.get_content_type() != 'application/json':
                raise ValueError('Expected application/json.')
            payload = json.loads(handler.rfile.read(int(handler.headers.get('Content-Length', 0))))
            if not isinstance(payload, dict):
                raise ValueError('Expected a JSON object.')
            return handler.send_json(submit(config, payload, repo_root), 202)
        if method == 'GET' and path.startswith('/api/prompt-expander/runs/'):
            reference = re.fullmatch(r'/api/prompt-expander/runs/([a-f0-9]{32})/references/([0-9]+)', path)
            if reference:
                run_id, index = reference.groups()
                request = read(Path(config['state_dir']) / run_id / 'request.json')
                if int(index) >= len(request['images']):
                    raise ValueError('Reference index is out of range.')
                data = Path(request['images'][int(index)]['path']).read_bytes()
                handler.send_response(200)
                handler.send_header('Content-Type', 'application/octet-stream')
                handler.send_header('Content-Length', str(len(data)))
                handler.send_header('Cache-Control', 'no-store')
                handler.end_headers()
                handler.wfile.write(data)
                return
            return handler.send_json(run_status(config, path.rsplit('/', 1)[-1]))
        return handler.send_json(dict(error='Unknown helper route.'), 404)
    except FileNotFoundError as error:
        return handler.send_json(dict(error=str(error)), 404)
    except (ValueError, TypeError, KeyError) as error:
        return handler.send_json(dict(error=str(error)), 400)
    except Exception as error:
        return handler.send_json(dict(error=str(error)), 503)


def reference_size(width, height, count):
    """BFL flux3/pup.py geometry, including extreme-aspect correction."""
    if max(width, height) / min(width, height) > 200:
        raise ValueError('Reference aspect ratio exceeds the BFL 200:1 limit.')
    floor = lambda v: max(32, math.floor(v / 32) * 32)
    cap = (1024 if count == 1 else 724 if count == 2 else 512) ** 2
    w, h = max(32, round(width / 32) * 32), max(32, round(height / 32) * 32)
    if w * h > cap:
        beta = math.sqrt(width * height / cap)
        w, h = floor(width / beta), floor(height / beta)
    if w * h > cap:
        if w == 32:
            h = floor(cap / w)
        else:
            w = floor(cap / h)
    return w, h


def prepare_reference(path, count, output):
    from PIL import Image, ImageOps
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in ('RGBA', 'LA', 'PA') or (image.mode == 'P' and 'transparency' in image.info):
            rgba = image.convert('RGBA')
            image = Image.alpha_composite(Image.new('RGBA', rgba.size, (255, 255, 255, 255)), rgba)
        image = image.convert('RGB')
        size = reference_size(*image.size, count)
        if image.size != size:
            image = image.resize(size, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG', quality=92)
    output.write_bytes(buffer.getvalue())
    return dict(path=str(output), width=size[0], height=size[1], sha256=hashlib.sha256(buffer.getvalue()).hexdigest())


def messages_for(prompt, count, prompts):
    task = 'i2i' if count else 't2i'
    content = ([{'type': 'image'} for _ in range(count)] + [{'type': 'text', 'text': SCAFFOLD.format(instruction=prompt)}]) if count else prompt
    return [{'role': 'system', 'content': prompts[task]}, {'role': 'user', 'content': content}]


def generated_presence_penalty(mx, penalty):
    """Match vLLM: penalize generated tokens only, never the supplied prompt."""
    prompt_length = None

    def process(tokens, logits):
        nonlocal prompt_length
        if prompt_length is None:
            prompt_length = tokens.size
        generated = tokens[prompt_length:]
        if generated.size:
            # Scatter assignment applies once even when an id appears repeatedly.
            logits[:, generated] = logits[:, generated] - penalty
        return logits
    return process


def infer(request_path, report_path):
    started = time.monotonic()
    report = dict(status='running', phase='request', output='', effective_backend=None)
    write(report_path, report)
    try:
        request = read(request_path)
        config = request['config']
        available, reason = availability(config)
        if not available:
            raise RuntimeError(reason)
        model_dir = Path(config['model_dir'])
        report.update(model_repo=config['model_repo'], model_revision=config['model_revision'],
                      model_dir=str(model_dir), task='i2i' if request['images'] else 't2i',
                      phase='preparing-references', sampling=SAMPLING,
                      presence_penalty=0.0 if request['images'] else 1.5,
                      source_sha=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=Path(__file__).parent, text=True).strip())
        write(report_path, report)
        prepared = [prepare_reference(x['path'], len(request['images']), Path(report_path).parent / f'prepared-{i}.jpg') for i, x in enumerate(request['images'])]
        report['prepared_images'] = prepared
        report['phase'] = 'loading-model'
        write(report_path, report)
        import mlx.core as mx
        from mlx_vlm import load, stream_generate
        from importlib.metadata import version
        if not mx.metal.is_available():
            raise RuntimeError('Metal is unavailable; no CPU fallback is selected.')
        mx.set_default_device(mx.gpu)
        load_started = time.monotonic()
        model, processor = load(str(model_dir), strict=True)
        report.update(effective_backend='mlx-metal', mlx_vlm=version('mlx-vlm'), mlx=version('mlx'),
                      load_seconds=time.monotonic() - load_started)
        prompts = read(model_dir / 'system_prompts.json')
        messages = messages_for(request['prompt'], len(prepared), prompts)
        templater = processor if prepared else processor.tokenizer
        formatted = templater.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        write(Path(report_path).parent / 'effective-input.json', dict(messages=messages, formatted=formatted,
              system_prompts_sha256=hashlib.sha256((model_dir / 'system_prompts.json').read_bytes()).hexdigest()))
        tokenizer = processor.tokenizer
        stop_ids = [tokenizer.convert_tokens_to_ids(t) for t in ('<|im_end|>', '<|endoftext|>')]
        tokenizer.stopping_criteria = lambda token: int(token) in stop_ids
        processors = [generated_presence_penalty(mx, 1.5)] if not prepared else []
        report['phase'] = 'expanding'
        write(report_path, report)
        generation_started = time.monotonic()
        last_write = 0
        final = None
        for chunk in stream_generate(model, processor, formatted, image=[x['path'] for x in prepared] or None,
                                     **SAMPLING, logits_processors=processors):
            report['output'] += chunk.text
            final = chunk
            if time.monotonic() - last_write > .2:
                report['elapsed_seconds'] = time.monotonic() - started
                write(report_path, report)
                last_write = time.monotonic()
        report.update(generation_seconds=time.monotonic() - generation_started,
                      prompt_tokens=final.prompt_tokens if final else 0,
                      generated_tokens=final.generation_tokens if final else 0,
                      peak_memory_gb=final.peak_memory if final else None,
                      finish_reason=final.finish_reason if final else None)
        if not report['output'].strip():
            raise RuntimeError('The helper returned no caption.')
        report.update(status='complete' if report['finish_reason'] == 'stop' else 'partial', phase='finished')
        (Path(report_path).parent / 'caption.txt').write_text(report['output'].strip() + '\n')
    except BaseException as error:
        report.update(status='failed', error=str(error), traceback=traceback.format_exc())
        raise
    finally:
        report['elapsed_seconds'] = time.monotonic() - started
        write(report_path, report)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    infer(args.request, args.report)
