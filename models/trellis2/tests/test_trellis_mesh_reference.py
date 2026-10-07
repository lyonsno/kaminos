import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import importlib.util

class TrellisMeshReference(unittest.TestCase):
    def test_exporter_uses_existing_decoder_admission(self):
        script = Path(__file__).parents[1] / 'export-trellis-mesh.py'
        sys.path.insert(0, str(script.parent))
        spec = importlib.util.spec_from_file_location('mesh_export_admission', script)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.assertTrue(callable(getattr(module, 'admit_decoder_reference', None)),
            'Source conversion must use the same complete decoder-reference admission as the browser, before GPU work.')
        with tempfile.TemporaryDirectory() as folder:
            manifest = Path(folder) / 'manifest.json'
            manifest.write_text(json.dumps({'schema': 'trellis2.slat-decoder-reference.v0', 'status': 'succeeded',
                'effectiveBackend': {'device': 'Device(cpu, 0)'},
                'tensors': {'expected.features': {'dtype': 'int32'}}}))
            with self.assertRaises(ValueError): module.admit_decoder_reference(manifest, script.parents[2])

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
