# kaminos-test: python
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'tools/hand_browser_server.py'

class Retention(unittest.TestCase):
    def test_source_failure_and_identity_survive(self):
        self.assertTrue(SOURCE.exists(), 'browser smoke retention is absent')
        spec = importlib.util.spec_from_file_location('hand_browser_server', SOURCE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            store = module.HandRecords(Path(directory))
            capture = {'captureId': 'sample-1', 'request': {'image': 'raw-source', 'sessionId': 'session-1'},
                       'identity': {'backend': 'webgpu-local'}, 'outcome': {'state': 'submitted'}}
            store.write({'kind': 'capture', 'payload': capture})
            capture['outcome'] = {'state': 'failed', 'error': 'before-primary-output'}
            store.write({'kind': 'capture', 'payload': capture})
            stored = json.loads((Path(directory) / 'session-1/sample-1.json').read_text())
            self.assertEqual(stored['request']['image'], 'raw-source')
            self.assertEqual(stored['outcome']['state'], 'failed')
            self.assertEqual(stored['identity']['backend'], 'webgpu-local')
            for value in ('../escape', '', '/absolute'):
                capture['captureId'] = value
                with self.assertRaises(ValueError):
                    store.write({'kind': 'capture', 'payload': capture})

if __name__ == '__main__':
    unittest.main()
