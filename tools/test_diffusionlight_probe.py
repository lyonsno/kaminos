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

    def test_interpolation_keeps_immutable_prompt_endpoints(self):
        a, b = np.array([10.]), np.array([0.])
        np.testing.assert_array_equal([self.probe.interpolate_prompt(a,b,ev)[0] for ev in [0,-2.5,-5]], [10,5,0])
        np.testing.assert_array_equal(a,[10])
        with self.assertRaisesRegex(ValueError, 'exposure'):
            self.probe.interpolate_prompt(a,b,-6)

    def test_call_settings_match_effective_upstream_pipeline_defaults(self):
        import inspect
        from diffusers import StableDiffusionXLControlNetInpaintPipeline
        parameters=inspect.signature(StableDiffusionXLControlNetInpaintPipeline.__call__).parameters
        self.assertEqual(getattr(self.probe,'PIPELINE_SETTINGS',{}),{
            'num_inference_steps':30,'guidance_scale':parameters['guidance_scale'].default,
            'strength':parameters['strength'].default,'controlnet_conditioning_scale':.5})

    def test_both_adapters_load_through_real_diffusers_offline_resolver(self):
        import torch
        from diffusers import StableDiffusionXLControlNetInpaintPipeline as Pipeline
        from safetensors.torch import save_file
        loaded={}
        class LoadingProbe:
            scheduler=SimpleNamespace(config={})
            def to(self, device):
                return self
            def load_lora_weights(self, path, adapter_name, **kwargs):
                loaded[adapter_name]=Pipeline.lora_state_dict(path, **kwargs)[0]
            def prepare_mask_latents(self, *args, **kwargs):
                raise AssertionError('inference is outside this loading test')
            def encode_prompt(self, prompt):
                raise RuntimeError('adapters-observed')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            models={name:{'path':tmp} for name in ['depth','base','control']}
            key='unet.test.to_q.lora_A.weight'
            for value,name in enumerate(['turbo','exposure'],1):
                folder=root/name; folder.mkdir()
                save_file({key:torch.full((2,2),float(value))},folder/'pytorch_lora_weights.safetensors')
                models[name]={'path':str(folder)}
            with (patch.object(self.probe,'require_mps'),
                  patch('torch.mps.empty_cache'),
                  patch('transformers.pipeline',return_value=lambda image:{'depth':Image.new('L',(1024,1024),20)}),
                  patch('diffusers.ControlNetModel.from_pretrained',return_value=object()),
                  patch.object(Pipeline,'from_pretrained',return_value=LoadingProbe()),
                  patch('diffusers.UniPCMultistepScheduler.from_config',return_value=object()),
                  patch('diffusers.loaders.lora_base.HF_HUB_OFFLINE',True)):
                with self.assertRaisesRegex(RuntimeError,'adapters-observed'):
                    self.probe.run_inference(models,Image.new('RGB',(1024,1024)),
                        root,{},root/'loading.json')
            self.assertEqual(set(loaded),{'turbo','exposure'})
            torch.testing.assert_close(loaded['turbo'][key],torch.ones(2,2))
            torch.testing.assert_close(loaded['exposure'][key],torch.full((2,2),2.))

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
