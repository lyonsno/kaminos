import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class SLatDecoderExport(unittest.TestCase):
    def test_source_failure_is_durable_before_any_model_output(self):
        script = Path(__file__).parents[1] / 'export-slat-decoder.py'
        self.assertTrue(script.is_file(), 'Learned decoder needs a reusable actual-source export, not full generation for every shader edit.')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            result = subprocess.run([sys.executable, str(script), '--repo-root', str(script.parents[2]),
                '--expected-commit', '0' * 40, '--source-root', str(root / 'missing'), '--synthetic',
                '--out', str(root / 'out')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads((root / 'out' / 'manifest.json').read_text())
            self.assertEqual(report['schema'], 'trellis2.slat-decoder-reference.v0')
            self.assertEqual(report['phase'], 'source')
            self.assertEqual(report['modelCalls'], 0)
            self.assertEqual(report['status'], 'failed')

if __name__ == '__main__': unittest.main()
