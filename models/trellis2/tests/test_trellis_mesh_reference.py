import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class TrellisMeshReference(unittest.TestCase):
    def test_mesh_capture_failure_is_durable_without_model_execution(self):
        decoder = Path(__file__).parents[1] / 'export-slat-decoder.py'
        self.assertTrue(decoder.is_file())
        script = decoder.with_name('export-trellis-mesh.py')
        self.assertTrue(script.is_file(), 'Actual-source mesh conversion must reuse retained decoder arrays, not rerun a model.')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            result = subprocess.run([sys.executable, str(script), '--repo-root', str(script.parents[2]),
                '--source-root', str(root / 'missing'), '--expected-commit', '0' * 40,
                '--decoder-reference', str(root / 'missing-reference'), '--out', str(root / 'out')],
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads((root / 'out' / 'manifest.json').read_text())
            self.assertEqual(report['schema'], 'trellis2.mesh-reference.v0')
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['phase'], 'source')
            self.assertEqual(report['modelCalls'], 0)

if __name__ == '__main__': unittest.main()
