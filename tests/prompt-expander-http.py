# kaminos-test: python
"""HTTP behavior; fake queue transport, never a model or accelerator invocation."""
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve
import prompt_expander as helper


class PromptExpanderHttp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config = self.root / 'config.json'
        self.env = patch.dict(os.environ, {'KAMINOS_PROMPT_EXPANDER_CONFIG': str(self.config)})
        self.env.start()
        self.server = serve.http.server.ThreadingHTTPServer(('127.0.0.1', 0), serve.KaminosHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}/api/prompt-expander'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.env.stop()
        self.tmp.cleanup()

    def call(self, path='', payload=None):
        request = Request(self.base + path, data=None if payload is None else json.dumps(payload).encode(),
                          headers={'Content-Type': 'application/json'})
        try:
            response = urlopen(request)
        except HTTPError as error:
            response = error
        body = response.read()
        try:
            body = json.loads(body)
        except ValueError:
            body = body.decode()
        return response.status, body

    def configure(self):
        model = self.root / 'model'
        model.mkdir()
        (model / 'config.json').write_text(json.dumps({'model_type': 'qwen3_5', 'quantization': {'bits': 4}}))
        (model / 'model.safetensors.index.json').write_text(json.dumps({'weight_map': {'weight': 'weights.safetensors'}}))
        (model / 'weights.safetensors').write_bytes(b'not-real-weights')
        (model / 'system_prompts.json').write_text(json.dumps({'t2i': 'caption', 'i2i': 'edit'}))
        queue = self.root / 'queue'
        queue.mkdir()
        fake = self.root / 'queue-command'
        fake.write_text(f'#!{sys.executable}\nimport json,sys,pathlib\nm=json.loads(pathlib.Path(sys.argv[sys.argv.index("--manifest")+1]).read_text())\npathlib.Path({str(self.root / "submitted.json")!r}).write_text(json.dumps(m))\nprint(json.dumps({{"job_id":"abc123def456","queue_dir":{str(queue)!r}}}))\n')
        fake.chmod(0o755)
        self.config.write_text(json.dumps({'model_dir': str(model), 'model_repo': 'mlx-community/flux-3-image-klein-pup-4bit',
            'model_revision': 'fixture-revision', 'python': sys.executable, 'queue_dir': str(queue),
            'greenroom_bin': str(fake), 'state_dir': str(self.root / 'runs')}))
        return model

    def test_unconfigured_is_explicit_and_json(self):
        status, body = self.call('/config')
        self.assertEqual(status, 503, 'the helper must expose an explicit unavailable API, not a missing route')
        self.assertEqual(body['phase'], 'configuration')

    def test_missing_weights_and_wrong_architecture_do_not_advertise_available(self):
        model = self.configure()
        (model / 'weights.safetensors').unlink()
        status, body = self.call('/config')
        self.assertEqual(status, 200)
        self.assertFalse(body['available'])
        self.assertIn('weights.safetensors', body['reason'])
        (model / 'weights.safetensors').write_bytes(b'fixture')
        (model / 'config.json').write_text('{"model_type":"qwen3"}')
        self.assertFalse(self.call('/config')[1]['available'])

    def test_requests_retain_full_text_and_reference_bytes_then_queue(self):
        self.configure()
        text = 'a literal request ' * 1000
        source = b'original reference bytes'
        status, body = self.call('/runs', {'prompt': text, 'images': [{'name': 'source.png', 'data': base64.b64encode(source).decode()}]})
        self.assertEqual(status, 202)
        run = self.root / 'runs' / body['id']
        request = json.loads((run / 'request.json').read_text())
        self.assertEqual(request['prompt'], text)
        self.assertEqual(Path(request['images'][0]['path']).read_bytes(), source)
        manifest = json.loads((self.root / 'submitted.json').read_text())
        self.assertEqual(manifest['agent_id'], 'thomas-the-jank-engine')
        self.assertIsNone(manifest['timeout'])
        self.assertEqual(manifest['repo_root'], str(serve.ROOT))
        self.assertIn(str(run / 'request.json'), manifest['argv'])
        self.assertEqual(self.call('/runs/' + body['id'])[1]['status'], 'queued')
        (run / 'report.json').write_text('{"status":"complete","output":"","effective_backend":"mlx-metal"}')
        self.assertNotEqual(self.call('/runs/' + body['id'])[1]['status'], 'complete', 'blank output is never a completed expansion')

    def test_invalid_requests_never_submit(self):
        self.configure()
        for payload in [{'prompt': ''}, {'prompt': 'x', 'images': [{}] * 11}, {'prompt': 'x', 'images': [{'name': '../escape', 'data': '???'}]}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.call('/runs', payload)[0], 400)
        self.assertFalse((self.root / 'submitted.json').exists())

    def test_foreign_origin_is_rejected(self):
        self.configure()
        request = Request(self.base + '/runs', data=b'{"prompt":"hello"}', headers={'Content-Type':'application/json', 'Origin':'https://example.com'})
        with self.assertRaises(HTTPError) as error:
            urlopen(request)
        self.assertEqual(error.exception.code, 403)

    def test_killed_or_rejected_queue_job_cannot_remain_running(self):
        self.configure()
        _, submitted = self.call('/runs', {'prompt': 'hello'})
        run = self.root / 'runs' / submitted['id']
        (run / 'report.json').write_text('{"status":"running","phase":"loading-model"}')
        terminal = self.root / 'queue' / 'failed' / 'abc123def456'
        terminal.mkdir(parents=True)
        (terminal / 'status.json').write_text('{"status":"failed","exit_code":1}')
        result = self.call('/runs/' + submitted['id'])[1]
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['phase'], 'worker-terminal')

    def test_failure_before_model_import_preserves_report(self):
        target = self.root / 'failed' / 'report.json'
        with self.assertRaises(FileNotFoundError):
            helper.infer(self.root / 'absent.json', target)
        report = json.loads(target.read_text())
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['phase'], 'request')
        self.assertIsNone(report['effective_backend'])


if __name__ == '__main__':
    unittest.main()
