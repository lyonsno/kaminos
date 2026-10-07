from pathlib import Path
import subprocess
import sys
import tempfile
import json
import unittest


class SamplerExportFailure(unittest.TestCase):
    def test_missing_source_preserves_failure_phase(self):
        script = Path(__file__).parents[1] / 'export-sparse-sampler.py'
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'reference'
            run = subprocess.run([sys.executable, str(script), '--repo-root', str(script.parents[2]),
                '--expected-commit', '0' * 40, '--source-root', str(Path(folder) / 'missing-source'),
                '--flow-fixture', str(Path(folder) / 'missing-flow'), '--out', str(output)], capture_output=True, text=True)
            self.assertTrue((output / 'manifest.json').is_file(), 'Sampler export must persist terminal failure before primary output.')
            report = json.loads((output / 'manifest.json').read_text())
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['phase'], 'source')
            self.assertEqual(report['modelCalls'], 0)
            self.assertEqual(report['tensors'], {})


if __name__ == '__main__':
    unittest.main()
