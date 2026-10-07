import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class ProjectionExport(unittest.TestCase):
    def test_missing_reference_retains_failure_before_operation(self):
        script = Path(__file__).parents[1] / 'export-slat-projection.py'
        self.assertTrue(script.is_file(), 'Capture the first source projection from retained inputs without running a full model.')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            run = subprocess.run([sys.executable, str(script), '--repo-root', str(script.parents[2]),
                '--source-root', str(root / 'missing-source'), '--expected-commit', '0' * 40,
                '--reference', str(root / 'missing-reference'), '--reference-sha256', '0' * 64,
                '--out', str(root / 'out')], capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            m = json.loads((root / 'out' / 'manifest.json').read_text())
            self.assertEqual(m['schema'], 'trellis2.slat-projection-reference.v0')
            self.assertEqual(m['status'], 'failed')
            self.assertEqual(m['phase'], 'parent-reference')
            self.assertEqual(m['operationCalls'], 0)
            self.assertEqual(m['fullDecoderCalls'], 0)
            self.assertIn('error', m)

if __name__ == '__main__': unittest.main()
