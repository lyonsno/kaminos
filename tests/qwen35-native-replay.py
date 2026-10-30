# kaminos-test: python
import hashlib
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'models/qwen3_5/native-replay.py'
spec = importlib.util.spec_from_file_location('native_replay', SCRIPT)
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)

def fixture():
    settings = {'temperature': 0, 'presencePenalty': 1.5, 'eosTokenIds': [248046, 248044]}
    return {'schema':'kaminos.qwen35-model-witness.v2', 'status': 'passed', 'mode': 'serving-profile', 'source': {'rev': 'a'*40, 'dirtyFiles': []},
      'sourceAfter': {'rev': 'a'*40, 'dirtyFiles': []}, 'errors': [], 'rows': [],
      'adapter': {'vendor': 'apple', 'isFallbackAdapter': False},
      'effective': {'backend': 'webgpu', 'weightsManifestSha256': 'b'*64},
      'reference': {'weightsManifestSha256': 'b'*64},
      'pupRequest': {'inputIds': [1,2,3], 'settings': settings, 'tokenizerSha256': 'c'*64, 'systemPromptsSha256': 'd'*64},
      'cleanup': {'states': 0, 'weights': 0, 'borrowedControl': 'running'},
      'expansion': {'inputIds': [1,2,3], 'settings': settings, 'tokenizerSha256': 'c'*64, 'systemPromptsSha256': 'd'*64,
        'stream': ['red ', 'fox'], 'output': {'text': 'red fox', 'promptTokenCount': 3, 'tokenIds': [4,5], 'generatedTokenCount': 3, 'finishReason': 'eos', 'stopTokenId': 248046}}}

class ReplayTests(unittest.TestCase):
    def test_native_call_timing_includes_cpu_logits_like_the_browser_adapter(self):
        clock=[0.0]
        def predict(): clock[0]+=0.003; return 'gpu-logits'
        def copy(value): self.assertEqual(value,'gpu-logits'); clock[0]+=0.002; return [1,2]
        values,ms=replay.timed_prediction(predict,copy,lambda:clock[0])
        self.assertEqual(values,[1,2]); self.assertAlmostEqual(ms,5)

    def test_replay_requires_pinned_complete_actual_route_and_source(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)/'browser.json'
            def check(value):
                raw = json.dumps(value).encode(); path.write_bytes(raw)
                return replay.admit_browser(path, hashlib.sha256(raw).hexdigest())
            self.assertEqual(check(fixture())['expansion']['output']['tokenIds'], [4,5])
            with self.assertRaises(ValueError): replay.admit_browser(path, 'wrong')
            for change in [lambda d: d.update(status='failed'), lambda d: d['effective'].update(backend='cpu'),
              lambda d: d['adapter'].update(isFallbackAdapter=None), lambda d: d['sourceAfter'].update(rev='e'*40),
              lambda d: d['source']['dirtyFiles'].append('modified'), lambda d: d['expansion']['inputIds'].pop(),
              lambda d: d['expansion']['output'].update(finishReason='length'), lambda d: d['expansion'].update(stream=[]),
              lambda d: d['expansion']['output'].update(generatedTokenCount=1), lambda d: d['cleanup'].update(weights=1),
              lambda d: d['reference'].update(weightsManifestSha256='e'*64), lambda d: d['expansion'].update(tokenizerSha256='wrong')]:
                value=fixture(); change(value)
                with self.assertRaises(ValueError): check(value)

    def test_replay_consumes_every_recorded_token_and_predicts_eos_without_caps(self):
        generated=list(range(1,65)); calls=list(replay.replay_calls([100,101,102],generated))
        self.assertEqual(len(calls),65)
        self.assertEqual(calls[0],('prefill',[100,101,102],0))
        self.assertEqual([row[1][0] for row in calls[1:]],generated)
        self.assertEqual([row[2] for row in calls[1:]],list(range(3,67)))

    def test_failure_before_native_runtime_still_writes_report(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); source=root/'browser.json'; source.write_text(json.dumps(fixture())); report=root/'report.json'
            result=subprocess.run([sys.executable,str(SCRIPT),'--browser-report',str(source),'--expected-browser-sha256','wrong',
              '--model-dir',str(root/'no-model'),'--out',str(root/'out'),'--report',str(report)],capture_output=True,text=True)
            self.assertEqual(result.returncode,1)
            saved=json.loads(report.read_text()); self.assertEqual(saved['phase'],'browser-admission')
            self.assertIn('SHA256',saved['error'])

    def test_cleanup_failure_cannot_preserve_an_earlier_success_status(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); source=root/'browser.json'; raw=json.dumps(fixture()).encode(); source.write_bytes(raw)
            report=root/'report.json'; original=replay.run_native; argv=sys.argv
            def broken_cleanup(args,browser,state):
                state.update(status='passed',phase='native-cleanup')
                raise RuntimeError('cleanup fence failed')
            try:
                replay.run_native=broken_cleanup
                sys.argv=[str(SCRIPT),'--browser-report',str(source),'--expected-browser-sha256',hashlib.sha256(raw).hexdigest(),
                  '--model-dir',str(root/'model'),'--out',str(root/'out'),'--report',str(report)]
                with contextlib.redirect_stdout(io.StringIO()): result=replay.main()
                self.assertEqual(result,1)
                saved=json.loads(report.read_text()); self.assertEqual(saved['status'],'failed'); self.assertIn('cleanup fence failed',saved['error'])
            finally: replay.run_native=original; sys.argv=argv

if __name__ == '__main__': unittest.main()
