"""Replay a pinned browser trajectory through the same native FP32 text model.

Model-compute timing excludes sampling and raw-logit capture. Run in Greenroom.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import traceback

def sha(data):
    return hashlib.sha256(data).hexdigest()

def admit_browser(path, digest):
    raw = Path(path).read_bytes()
    if sha(raw) != digest:
        raise ValueError('browser report SHA256 mismatch')
    d = json.loads(raw)
    if (d.get('schema') != 'kaminos.qwen35-model-witness.v2' or d.get('status') != 'passed'
        or d.get('mode') != 'serving-profile' or d.get('effective', {}).get('backend') != 'webgpu'
        or d.get('adapter', {}).get('isFallbackAdapter') is not False or d.get('errors') != [] or d.get('rows') != []):
        raise ValueError('complete native WebGPU serving report required')
    source = d.get('source', {})
    if (not source.get('rev') or source.get('dirtyFiles') != [] or source != d.get('sourceAfter')
        or d.get('reference', {}).get('weightsManifestSha256') != d['effective'].get('weightsManifestSha256')):
        raise ValueError('clean unchanged model source required')
    expected, actual = d.get('pupRequest', {}), d.get('expansion', {})
    for key in ['inputIds', 'settings', 'tokenizerSha256', 'systemPromptsSha256']:
        if key not in expected or expected[key] != actual.get(key):
            raise ValueError('wrong framed input/settings/assets')
    output, prompt = actual.get('output', {}), expected['inputIds']
    generated = output.get('tokenIds')
    if (not isinstance(prompt, list) or not prompt or not isinstance(generated, list) or not generated
        or any(type(x) is not int or x < 0 or x > 0xffffffff for x in prompt + generated)
        or output.get('finishReason') != 'eos' or output.get('stopTokenId') not in expected['settings'].get('eosTokenIds', [])
        or output.get('promptTokenCount') != len(prompt) or output.get('generatedTokenCount') != len(generated)+1
        or not isinstance(output.get('text'), str) or not output['text'].strip()
        or not isinstance(actual.get('stream'), list) or any(not isinstance(x, str) for x in actual['stream'])
        or ''.join(actual['stream']) != output['text']):
        raise ValueError('complete recorded EOS trajectory required')
    if d.get('cleanup', {}).get('states') != 0 or d['cleanup'].get('weights') != 0 or d['cleanup'].get('borrowedControl') != 'running':
        raise ValueError('browser cleanup incomplete')
    return d

def replay_calls(prompt, generated):
    yield 'prefill', prompt, 0
    for i, token in enumerate(generated):
        yield 'decode', [token], len(prompt)+i

def timed_prediction(predict, copy_logits, clock=time.perf_counter):
    start = clock(); values = copy_logits(predict())
    return values, 1000*(clock()-start)

def source_identity():
    repo = Path(__file__).resolve().parents[2]
    return {'repoRoot': str(repo), 'rev': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
      'dirtyFiles': subprocess.check_output(['git', 'status', '--porcelain', '--', '.'], cwd=repo, text=True).splitlines()}

def run_native(args, browser, report):
    report['phase'] = 'source-admission'
    report['source'] = source_identity()
    if report['source']['dirtyFiles']:
        raise ValueError('native replay requires clean committed source')
    root, out = args.model_dir.resolve(), args.out.resolve()
    if str(root) != browser['requested']['modelRoot']:
        raise ValueError('wrong retained model root')
    spec = importlib.util.spec_from_file_location('qwen_reference_loader', Path(__file__).with_name('export-model-reference.py'))
    reference = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reference)
    verified = time.perf_counter()
    config, manifest = reference.prepare(root, out, report)
    if report['weightsManifestSha256'] != browser['reference']['weightsManifestSha256']:
        raise ValueError('native/browser source tensor mismatch')
    for key, file in [('tokenizerSha256','tokenizer.json'),('systemPromptsSha256','system_prompts.json')]:
        if sha((root/file).read_bytes()) != browser['pupRequest'][key]:
            raise ValueError('native/browser source asset mismatch')
    prompt = browser['pupRequest']['inputIds']; generated = browser['expansion']['output']['tokenIds']
    if any(x >= config['text_config']['vocab_size'] for x in prompt+generated):
        raise ValueError('trajectory token outside vocabulary')
    report['sourceVerificationMs'] = 1000*(time.perf_counter()-verified)
    report['phase'] = 'native-model-load'
    args.report.write_text(json.dumps(report, indent=2)+'\n')
    load_start = time.perf_counter()
    model, mx = reference.load_native_fp32(root, config, report)
    import numpy as np
    from mlx.utils import tree_flatten
    cache = None
    try:
        mx.eval(model.parameters()); mx.synchronize()
        report['modelLoadMs'] = 1000*(time.perf_counter()-load_start)
        dtypes = {}
        for _, value in tree_flatten(model.parameters()):
            name = str(value.dtype); dtypes[name] = dtypes.get(name, 0)+1
            if mx.issubdtype(value.dtype, mx.floating) and value.dtype != mx.float32:
                raise ValueError('native model contains non-FP32 floating parameters')
        report['parameterDtypes'] = dtypes
        report['effective']['mode'] = 'forced-token-model-replay'
        report['timingScope'] = 'synchronized model-forward and full-logit CPU readback wall time; excludes sampling and raw-logit archival'
        report['inputIds'] = prompt; report['replayedTokenIds'] = generated
        report['settings'] = browser['pupRequest']['settings']
        report['calls'] = []; report['greedyMismatches'] = []
        expected = generated + [browser['expansion']['output']['stopTokenId']]
        raw_path = out/'logits.f32.bin'; report['rawLogitsFile'] = str(raw_path)
        cache = model.make_cache()
        with raw_path.open('wb') as raw_file:
            for index, (operation, tokens, past) in enumerate(replay_calls(prompt, generated)):
                report['phase'] = operation; report['nextCallIndex'] = index
                args.report.write_text(json.dumps(report, indent=2)+'\n')
                def predict():
                    ids = mx.array([tokens], dtype=mx.int32)
                    positions = mx.broadcast_to(mx.arange(past, past+len(tokens))[None,None,:], (3,1,len(tokens)))
                    hidden = model.model(ids, cache=cache, position_ids=positions)
                    logits = model.lm_head(hidden[:,-1:,:]).reshape(-1)
                    mx.eval(logits); mx.synchronize()
                    return logits
                values, elapsed = timed_prediction(predict, lambda logits: np.ascontiguousarray(np.array(logits,dtype=np.float32)))
                if values.size != config['text_config']['vocab_size'] or not np.isfinite(values).all() or not np.any(values):
                    raise ValueError('partial, nonfinite or blank native logits')
                raw = values.tobytes(); offset = raw_file.tell(); raw_file.write(raw)
                penalized = values.copy()
                penalized[list(set(generated[:index]))] -= np.float32(report['settings']['presencePenalty'])
                selected = int(penalized.argmax())
                if selected != expected[index]: report['greedyMismatches'].append(index)
                report['calls'].append({'operation':operation, 'inputTokens':len(tokens), 'pastTokens':past, 'ms':elapsed,
                  'logits':{'offset':offset,'bytes':len(raw),'sha256':sha(raw),'dtype':'f32','elements':int(values.size)},
                  'selectedTokenId':selected,'recordedTokenId':expected[index]})
        if len(report['calls']) != len(generated)+1:
            raise ValueError('incomplete native replay')
        decode_ms = sum(x['ms'] for x in report['calls'][1:])
        report['summary'] = {'promptTokens':len(prompt),'decodeCalls':len(generated),'predictions':len(report['calls']),
          'prefillMs':report['calls'][0]['ms'],'decodeMs':decode_ms,'decodeTokensPerSecond':1000*len(generated)/decode_ms,
          'greedyMatches':len(report['calls'])-len(report['greedyMismatches'])}
    finally:
        prior_phase = report['phase']; report['phase'] = 'native-cleanup'
        cache = None; model = None
        mx.synchronize(); mx.clear_cache()
        report['cleanup'] = {'cacheDiscarded':True,'allocatorCacheCleared':True}
        report['phase'] = prior_phase
    report['sourceAfter'] = source_identity()
    if report['sourceAfter'] != report['source']:
        raise ValueError('native replay source changed during execution')
    report.update(status='passed',phase='complete')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--browser-report', type=Path, required=True)
    p.add_argument('--expected-browser-sha256', required=True)
    p.add_argument('--model-dir', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    args = p.parse_args()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'kaminos.qwen35-native-replay.v1', 'status': 'failed', 'phase': 'browser-admission',
      'requested': {'browserReport':str(args.browser_report.resolve()), 'browserReportSha256':args.expected_browser_sha256,
        'modelRoot':str(args.model_dir.resolve()),'out':str(args.out.resolve())},
      'runner':{'path':str(Path(__file__).resolve()),'sha256':sha(Path(__file__).read_bytes()),'python':sys.executable}}
    args.report.write_text(json.dumps(report, indent=2)+'\n')
    try:
        browser = admit_browser(args.browser_report, args.expected_browser_sha256)
        run_native(args, browser, report)
    except BaseException:
        report['status'] = 'failed'
        report['error'] = traceback.format_exc()
    finally:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['status'] == 'passed' else 1

if __name__ == '__main__':
    sys.exit(main())
