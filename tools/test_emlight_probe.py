import unittest
import json
import tempfile
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import emlight_probe as probe
from emlight_probe import camera_to_native, panorama_grid, project_sh, validate_prediction, main


class LightingMath(unittest.TestCase):
    def test_producer_accepts_reference_energy_missed_by_preview(self):
        rgb = np.zeros((512, 1024, 3)); rgb[100, 100] = [10000, 5000, 1000]
        preview_directions, _ = panorama_grid(128, 256)
        self.assertEqual(probe.sample_panorama(rgb, preview_directions).max(), 0)

        class Tensor:
            def __init__(self, value): self.value = np.asarray(value)
            def to(self, *_): return self
            def unsqueeze(self, *_): return self
            def detach(self): return self
            def cpu(self): return self
            def numpy(self): return self.value

        class Model:
            def eval(self): return self
            def load_state_dict(self, *_, **__): pass
            def to(self, *_): return self
            def parameters(self): return []
            def __call__(self, _):
                return {key:Tensor(value) for key,value in {
                    'distribution':np.ones(96)/96, 'intensity':[1],
                    'rgb_ratio':[1,1,1], 'ambient':[.1,.1,.1]}.items()}

        torch = SimpleNamespace(__version__='deterministic-test-stub',
                                load=lambda *a, **kw:{}, from_numpy=Tensor,
                                inference_mode=nullcontext)
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module:None))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'RegressionNetwork').mkdir()
            for path in ['checkpoint.pth','source.hdr','RegressionNetwork/DenseNet.py']:
                (root/path).write_bytes(b'test-only')
            with patch.dict('sys.modules', {'torch':torch}), \
                 patch.object(probe.importlib.util, 'spec_from_file_location', return_value=spec), \
                 patch.object(probe.importlib.util, 'module_from_spec', return_value=SimpleNamespace(DenseNet=Model)), \
                 patch.object(probe.subprocess, 'check_output', return_value='test-revision'), \
                 patch.object(probe, 'read_environment', return_value=rgb):
                main(['--source-root',tmp,'--checkpoint',str(root/'checkpoint.pth'),
                      '--environment',str(root/'source.hdr'),'--output-dir',tmp,'--device','cpu'])
            state = json.loads((root/'lighting.json').read_text())
            self.assertEqual(state['status'], 'complete')
            self.assertEqual(state['effectiveDevice'], 'cpu')
            expected, mean = probe.environment_coefficients(rgb, 0)
            np.testing.assert_allclose(state['lights']['reference']['sh'], expected)
            self.assertEqual(state['lights']['reference']['meanLuminanceBeforeNormalization'], mean)
            self.assertGreater(mean, 0)

    def test_reference_keeps_a_small_bright_emitter_between_preview_samples(self):
        self.assertTrue(callable(getattr(probe, 'environment_coefficients', None)), 'reference SH must integrate original HDR pixels')
        rgb = np.zeros((256, 512, 3)); rgb[100, 100] = [10000, 5000, 1000]
        sh, mean = probe.environment_coefficients(rgb, 0)
        self.assertGreater(mean, 0)
        np.testing.assert_allclose(np.dot(sh[0], [.2126,.7152,.0722]),np.sqrt(4*np.pi),atol=1e-4)

    def test_view_yaw_rotates_crop_and_reference_together(self):
        self.assertTrue(callable(getattr(probe, 'rotate_native', None)), 'camera yaw must rotate both environment samples')
        np.testing.assert_allclose(probe.rotate_native(np.eye(3), 90), [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], atol=1e-12)

    def test_diffuse_error_has_meaningful_neutral_baseline(self):
        self.assertTrue(callable(getattr(probe, 'diffuse_metrics', None)), 'comparison must include an uninformed neutral baseline')
        sh = np.zeros((9, 3)); sh[0] = np.sqrt(4*np.pi); sh[3] = .4
        metrics = probe.diffuse_metrics(sh, sh)
        self.assertAlmostEqual(metrics['estimatedRmse'], 0)
        self.assertGreater(metrics['neutralRmse'], .01)

    def test_radiance_input_is_decoded_without_vertical_flip_or_clipping(self):
        self.assertTrue(callable(getattr(probe, 'read_environment', None)), 'existing Kaminos HDR files must be accepted')
        with tempfile.TemporaryDirectory() as tmp:
            # The accepted loader's standard flat RGBE layout: top red, bottom blue.
            hdr = Path(tmp) / 'axes.hdr'
            hdr.write_bytes(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n' +
                            bytes([128, 0, 0, 130, 128, 0, 0, 130, 0, 0, 128, 129, 0, 0, 128, 129]))
            rgb = probe.read_environment(hdr, Path(tmp))
            self.assertEqual(rgb.shape, (2, 2, 3))
            # Three RGBELoader uses /255 for RGBE mantissas. This uniform scale
            # cancels in the assay's independent mean-luminance normalization.
            np.testing.assert_allclose(rgb[0, 0], [512/255, 0, 0], atol=1e-6)
            np.testing.assert_allclose(rgb[1, 0], [0, 0, 256/255], atol=1e-6)

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
