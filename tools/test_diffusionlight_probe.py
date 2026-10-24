import importlib.util
import json
import os
from pathlib import Path
import tempfile
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image


class TurboContract(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('diffusionlight_probe.py')
        self.assertTrue(path.exists(), 'Turbo needs a source-identified adapter, not an EMLight report')
        spec = importlib.util.spec_from_file_location('turbo_probe', path)
        self.probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.probe)

    def test_padding_preserves_aspect_and_circle_contract(self):
        image = self.probe.pad_input(Image.new('RGB', (256, 192), (32, 64, 96)))
        pixels = np.asarray(image)
        self.assertEqual(image.size, (1024, 1024))
        np.testing.assert_array_equal(pixels[127, 512], [0, 0, 0])
        np.testing.assert_array_equal(pixels[128, 512], [32, 64, 96])
        np.testing.assert_array_equal(pixels[895, 512], [32, 64, 96])
        np.testing.assert_array_equal(pixels[896, 512], [0, 0, 0])
        control, mask = self.probe.ball_controls(Image.new('L', (1024, 1024), 20))
        self.assertEqual(np.asarray(control)[512, 512], 255)
        self.assertEqual(np.asarray(control)[100, 100], 20)
        self.assertEqual(np.asarray(mask)[512, 374], 0)
        self.assertEqual(np.asarray(mask)[512, 375], 255)

    def test_projection_matches_known_camera_frustum(self):
        environment = np.ones((32, 64, 3))
        crop = self.probe.camera_input(environment, 60, 0)
        self.assertEqual(crop.shape, (768, 1024, 3))
        np.testing.assert_allclose(crop, .5, atol=1e-6)
        with self.assertRaisesRegex(ValueError, 'fov'):
            self.probe.camera_input(environment, 180, 0)

    def test_exposures_share_seed_and_keep_immutable_prompt_endpoints(self):
        a, b = np.array([10.]), np.array([0.])
        np.testing.assert_array_equal([self.probe.interpolate_prompt(a,b,ev)[0] for ev in [0,-2.5,-5]], [10,5,0])
        np.testing.assert_array_equal(a,[10])
        with self.assertRaisesRegex(ValueError, 'exposure'):
            self.probe.interpolate_prompt(a,b,-6)

    def test_absent_assets_leave_durable_failure_not_stale_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'lighting.json').write_text('{"status":"complete"}')
            with self.assertRaises(FileNotFoundError):
                self.probe.main(['--models',str(root/'missing.json'),'--source-root',tmp,
                    '--environment',str(root/'missing.hdr'),'--output-dir',tmp])
            report=json.loads((root/'lighting.json').read_text())
            self.assertEqual(report['status'],'failed')
            self.assertEqual(report['phase'],'source-validation')
            self.assertNotIn('lights',report)

    def test_unavailable_mps_and_fallback_cannot_be_silent(self):
        import torch
        with patch.object(torch.backends.mps,'is_available',return_value=False):
            with self.assertRaisesRegex(RuntimeError,'MPS'):
                self.probe.require_mps()
        with patch.dict('os.environ',{'PYTORCH_ENABLE_MPS_FALLBACK':'1'}):
            with self.assertRaisesRegex(RuntimeError,'fallback'):
                self.probe.require_mps()

    @unittest.skipUnless(os.environ.get('DIFFUSIONLIGHT_SOURCE_ROOT'), 'requires pinned upstream conversion source')
    def test_upstream_projection_axes_and_hdr_merge_preserve_real_radiance(self):
        root=Path(os.environ['DIFFUSIONLIGHT_SOURCE_ROOT'])
        sys.path.insert(0,str(root))
        ball=self.probe.import_source(root,'ball2envmap')
        hdr=self.probe.hdr_converter(root)
        # Canonical projection contract: normal = normalize(camera + light).
        lights=np.eye(3)
        normals=ball.get_normal_vector(np.array([1,0,0]),lights)
        positions=1-(normals[:,1:]+1)/2
        np.testing.assert_allclose(positions,[[.5,.5],[.14644661,.5],[.5,.14644661]],atol=1e-7)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp); output=path/'hdr'; names={}
            # Same bright physical radiance, clipped at EV0 but resolved at EV-5.
            for ev in self.probe.EVS:
                names[ev]=f'probe_ev{int(ev*10)}.png'
                value=np.uint8(np.clip((4*2**ev)**(1/2.4),0,1)*255)
                Image.fromarray(np.full((4,8,3),value,dtype=np.uint8)).save(path/names[ev])
            hdr.process_image(SimpleNamespace(input_dir=tmp,output_dir=str(output),gamma=2.4,
                preview_output=False),{'name':'probe','ev':names})
            rgb=self.probe.read_environment(output/'probe.exr',output)
            self.assertEqual(rgb.shape,(4,8,3))
            np.testing.assert_allclose(rgb,4,atol=.08)


if __name__ == '__main__':
    unittest.main()
