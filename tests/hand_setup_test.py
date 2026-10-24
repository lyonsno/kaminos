# kaminos-test: python
"""Setup failure paths; no model compute or live downloads."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hand_setup', ROOT / 'demos/hand-mesh/setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

class SetupTests(unittest.TestCase):
    def test_interactive_terms_on_a_real_terminal_descriptor(self):
        master, slave = os.openpty()
        real_open = open
        def terminal_open(path, mode='r', *args, **kwargs):
            if path == '/dev/tty': return real_open(os.dup(slave), mode, *args, **kwargs)
            return real_open(path, mode, *args, **kwargs)
        try:
            os.write(master, b'yes\n')
            with tempfile.TemporaryDirectory() as temp, patch('builtins.open', side_effect=terminal_open):
                setup.acknowledge_terms(Path(temp), False)
                self.assertTrue(json.loads((Path(temp) / 'model-terms.json').read_text())['acknowledged'])
        finally:
            os.close(master)
            os.close(slave)

    def test_interactive_refusal_does_not_acquire_models(self):
        master, slave = os.openpty()
        real_open = open
        def terminal_open(path, mode='r', *args, **kwargs):
            if path == '/dev/tty': return real_open(os.dup(slave), mode, *args, **kwargs)
            return real_open(path, mode, *args, **kwargs)
        try:
            os.write(master, b'no\n')
            with tempfile.TemporaryDirectory() as temp, patch('builtins.open', side_effect=terminal_open), patch.object(setup, 'fetch_client') as acquire:
                self.assertEqual(setup.main(['--state-dir', temp, '--revision', 'a' * 40, '--prepare-only']), 1)
                acquire.assert_not_called()
                self.assertFalse((Path(temp) / 'model-terms.json').exists())
                state = json.loads((Path(temp) / 'setup-state.json').read_text())
                self.assertEqual((state['status'], state['phase']), ('failed', 'terms'))
        finally:
            os.close(master)
            os.close(slave)

    def test_crossed_packages_are_not_a_valid_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            expected = {}
            for name in ['mobrecon.bin', 'hand-detector.bin']:
                (root / name).write_bytes(name.encode())
                expected[name] = setup.digest(root / name)
            for kind, schema in [('mobrecon', 'mobrecon.browser-weight-package.v0'), ('detector', 'wilor-hand-detector.browser-weight-package.v0')]:
                name = 'hand-detector.bin' if kind == 'mobrecon' else 'mobrecon.bin'
                (root / f'{kind}.package.json').write_text(json.dumps({'schema': schema, 'status': 'succeeded', 'resources': [{'file': name, 'manifest': {'bundle': {'byteLength': len(name), 'sha256': expected[name]}}}]}))
            with patch.object(setup, 'EXPECTED_BUNDLES', expected):
                self.assertFalse(setup.prepared_models_valid(root), 'crossed detector/reconstructor packages must be rejected')

    def test_bad_download_retains_previous_file_and_rejected_response(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'asset'
            path.write_bytes(b'previous')
            response = io.BytesIO(b'upstream HTML warning')
            response.geturl = lambda: 'https://example.invalid/warning'
            with patch.object(setup.urllib.request, 'urlopen', return_value=response):
                with self.assertRaisesRegex(ValueError, 'SHA-256'):
                    setup.download('https://example.invalid/model', path, hashlib.sha256(b'correct').hexdigest())
            self.assertEqual(path.read_bytes(), b'previous')
            self.assertEqual(next(path.parent.glob('asset.rejected-*')).read_bytes(), b'upstream HTML warning')

    def test_failure_writes_effective_phase(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(setup, 'acknowledge_terms'), patch.object(setup, 'fetch_client', side_effect=OSError('source unavailable')):
                self.assertEqual(setup.main(['--state-dir', temp, '--revision', 'a' * 40, '--prepare-only']), 1)
            state = json.loads((Path(temp) / 'setup-state.json').read_text())
            self.assertEqual((state['status'], state['phase'], state['revision']), ('failed', 'client-download', 'a' * 40))
            self.assertIn('source unavailable', state['error'])

    def test_manifest_cannot_escape(self):
        for name in ['../asset', '/asset', 'dir\\asset']:
            with self.assertRaises(ValueError): setup.client_path(Path('/client'), name)

    def test_new_revision_failure_never_uses_cached_client(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'client-manifest.json').write_text('{"schema":"kaminos.hand-demo-client.v1","files":[{}]}')
            with patch.object(setup, 'download', side_effect=OSError('new revision absent')):
                with self.assertRaisesRegex(OSError, 'new revision absent'): setup.fetch_client(root, 'b' * 40)

if __name__ == '__main__': unittest.main()
