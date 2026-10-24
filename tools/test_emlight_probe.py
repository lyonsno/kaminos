import unittest
import json
import tempfile
from pathlib import Path
import numpy as np
from emlight_probe import camera_to_native, panorama_grid, project_sh, validate_prediction, main


class LightingMath(unittest.TestCase):
    def test_constant_environment_integrates_to_constant_radiance(self):
        directions, weights = panorama_grid(64, 128)
        self.assertIsNotNone(directions, 'panorama directions must exist')
        self.assertAlmostEqual(float(weights.sum()), 4 * np.pi, delta=0.002)
        c = project_sh(np.ones((64, 128, 3)), directions, weights)
        np.testing.assert_allclose(c[0], np.sqrt(4 * np.pi), atol=0.001)
        np.testing.assert_allclose(c[1:], 0, atol=0.002)

    def test_camera_axes_match_upstream_panorama_crop(self):
        # Camera right/up/back become native -Y/+Z/+X; the view faces -X.
        np.testing.assert_array_equal(camera_to_native(np.eye(3)), [[0, -1, 0], [0, 0, 1], [1, 0, 0]])

    def test_prediction_refuses_partial_and_nonfinite_outputs(self):
        raw = {'distribution': [1 / 96] * 96, 'intensity': [1], 'rgb_ratio': [1, 1, 1], 'ambient': [0, 0, 0]}
        self.assertEqual(validate_prediction(raw), raw)
        with self.assertRaisesRegex(ValueError, 'distribution'):
            validate_prediction({**raw, 'distribution': [1]})
        with self.assertRaisesRegex(ValueError, 'intensity'):
            validate_prediction({**raw, 'intensity': [float('nan')]})

    def test_early_failure_replaces_stale_success_with_failure_phase(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / 'lighting.json'
            report.write_text('{"status":"complete"}')
            with self.assertRaises(FileNotFoundError):
                main(['--source-root',tmp,'--checkpoint',tmp+'/missing.pth',
                      '--environment',tmp+'/missing.exr','--output-dir',tmp])
            state = json.loads(report.read_text())
            self.assertEqual(state['status'], 'failed')
            self.assertEqual(state['phase'], 'source-validation')
            self.assertNotIn('lights', state)


if __name__ == '__main__':
    unittest.main()
