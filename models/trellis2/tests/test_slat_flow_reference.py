import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'models/trellis2'
spec = importlib.util.spec_from_file_location('existing_flow_export', BASE / 'export-sparse-flow.py')
existing = importlib.util.module_from_spec(spec); spec.loader.exec_module(existing)

class SLatReferenceContracts(unittest.TestCase):
    def test_complete_forward_export_exists_after_existing_source_import(self):
        self.assertEqual(len(existing.BLOCK_KEYS), 21)
        target = BASE / 'export-slat-flow.py'
        self.assertTrue(target.exists(), 'variable-row source SLat forward has no reusable matched-input exporter')
        spec = importlib.util.spec_from_file_location('slat_export', target)
        source = importlib.util.module_from_spec(spec); spec.loader.exec_module(source)
        coords = np.array([[0,0,0],[0,0,1],[31,31,31]], dtype=np.int32)
        first = source.matched_slat_noise(coords, seed=42)
        self.assertEqual(first.shape, (3,32)); self.assertEqual(first.dtype, np.float32)
        np.testing.assert_array_equal(first, source.matched_slat_noise(coords, seed=42))
        self.assertTrue(np.isfinite(first).all())
        for wrong in (coords[::-1], np.array([[0,0,0],[0,0,0]],dtype=np.int32), coords.astype(np.float32),
                      np.array([[32,0,0]],dtype=np.int32), np.empty((0,3),dtype=np.int32)):
            with self.assertRaises(ValueError): source.matched_slat_noise(wrong, seed=42)

    def test_early_source_failure_has_durable_zero_model_report(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'output'
            p = subprocess.run([sys.executable, str(BASE / 'export-slat-flow.py'), '--repo-root',str(ROOT),
                '--source-root', temp, '--expected-commit','0'*40,'--mode','shape','--checkpoint',temp,
                '--coordinate-fixture',temp,'--conditioning',temp,'--seed','42','--out',str(out)],capture_output=True,text=True)
            self.assertNotEqual(p.returncode,0)
            self.assertTrue((out/'manifest.json').exists(),'failure before primary data must still receipt the failed phase')
            m=json.loads((out/'manifest.json').read_text())
            self.assertEqual(m['status'],'failed'); self.assertEqual(m['phase'],'source')
            self.assertEqual(m['fullModelExecutions'],0); self.assertEqual(m['fullModelAttempts'],0)

if __name__ == '__main__': unittest.main()
