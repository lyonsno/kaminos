import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('existing_decoder_export', BASE / 'export-sparse-decoder.py')
decoder_export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(decoder_export)

class OccupancyCoordinateReference(unittest.TestCase):
    def test_source_coordinate_policy(self):
        self.assertTrue(callable(getattr(decoder_export, 'source_occupancy_coordinates', None)),
            'Source coordinate extraction must independently cover the complete volume and preserve np.argwhere row identity.')
        logits = np.full((1, 1, 4, 4, 4), -1, dtype=np.float32)
        logits[0, 0, 0, 0, 0] = 0  # Source threshold is strictly positive.
        logits[0, 0, 1, 1, 1] = 0.1
        logits[0, 0, 0, 3, 3] = 0.2
        logits[0, 0, 3, 3, 3] = 0.3
        coordinates, flags = decoder_export.source_occupancy_coordinates(logits)
        np.testing.assert_array_equal(coordinates, np.array([[0, 0, 0], [0, 1, 1], [1, 1, 1]], dtype=np.int32))
        self.assertEqual(coordinates.dtype, np.dtype('int32'))
        self.assertEqual(int(flags.sum()), 3)
        bad = logits.copy(); bad[0, 0, 0, 0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, 'finite'):
            decoder_export.source_occupancy_coordinates(bad)
        with self.assertRaisesRegex(ValueError, 'cubic|shape|even'):
            decoder_export.source_occupancy_coordinates(np.zeros((1, 1, 3, 3, 3), dtype=np.float32))

    def test_failure_before_input_has_durable_report(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'evidence'
            result = subprocess.run([sys.executable, str(BASE / 'export-occupancy-coordinates.py'),
                '--repo-root', str(Path(directory) / 'missing-producer'), '--source-root', str(Path(directory) / 'missing-source'),
                '--expected-commit', '0' * 40, '--decoder-fixture', str(Path(directory) / 'missing-input'), '--out', str(out)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue((out / 'manifest.json').exists(), 'Early source/input failure must still preserve its terminal phase.')
            report = json.loads((out / 'manifest.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['phase'], 'source')
            self.assertEqual(report['modelCalls'], 0)

if __name__ == '__main__':
    unittest.main()
