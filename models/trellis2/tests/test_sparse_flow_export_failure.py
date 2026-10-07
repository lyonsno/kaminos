from pathlib import Path
import subprocess
import sys
import tempfile
import json
import unittest


class FullFlowExportFailure(unittest.TestCase):
    def test_missing_source_preserves_failure_phase(self):
        script = Path(__file__).parents[1] / 'export-sparse-flow.py'
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'reference'
            run = subprocess.run([sys.executable, str(script), '--repo-root', str(script.parents[2]),
                '--expected-commit', '0' * 40, '--source-root', str(Path(folder) / 'missing-source'),
                '--checkpoint', str(Path(folder) / 'missing-checkpoint'), '--sample', str(Path(folder) / 'missing-sample'),
                '--conditioning', str(Path(folder) / 'missing-conditioning'), '--out', str(output)], capture_output=True, text=True)
            self.assertTrue((output / 'manifest.json').is_file(), 'Full-stack export failure must persist a terminal manifest before primary outputs.')
            report = json.loads((output / 'manifest.json').read_text())
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['phase'], 'source')
            self.assertEqual(report['fullModelExecutions'], 0)
            self.assertEqual(report['tensors'], {})


if __name__ == '__main__':
    unittest.main()
