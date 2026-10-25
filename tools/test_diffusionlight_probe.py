import importlib.util
import json
import os
from pathlib import Path
import tempfile
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

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
        from diffusers import StableDiffusionXLControlNetInpaintPipeline as Pipeline, UNet2DConditionModel
        from safetensors.torch import save_file
        loaded={}
        class LoadingProbe:
            scheduler=SimpleNamespace(config={})
            def __init__(self):
                self.unet=UNet2DConditionModel(sample_size=8,in_channels=4,out_channels=4,
                    down_block_types=('CrossAttnDownBlock2D',),up_block_types=('CrossAttnUpBlock2D',),
                    block_out_channels=(8,),layers_per_block=1,cross_attention_dim=8,
                    attention_head_dim=2,norm_num_groups=4)
            def to(self, device):
                return self
            def load_lora_weights(self, path, adapter_name, **kwargs):
                state,alphas=Pipeline.lora_state_dict(path, **kwargs)
                Pipeline.load_lora_into_unet(state,alphas,self.unet,adapter_name=adapter_name)
                loaded[adapter_name]=state
            def prepare_mask_latents(self, *args, **kwargs):
                raise AssertionError('inference is outside this loading test')
            def encode_prompt(self, prompt):
                raise RuntimeError('adapters-observed')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            models={name:{'path':tmp} for name in ['depth','base','control']}
            target='down_blocks.0.attentions.0.transformer_blocks.0.attn1.to_q'
            key=f'unet.unet.{target}.lora.down.weight'
            up_key=f'unet.unet.{target}.lora.up.weight'
            for value,name in enumerate(['turbo','exposure'],1):
                folder=root/name; folder.mkdir()
                save_file({key:torch.full((4,8),float(value)),up_key:torch.full((8,4),float(value))},
                    folder/'pytorch_lora_weights.safetensors')
                models[name]={'path':str(folder)}
            pipe=LoadingProbe()
            original_weight=pipe.unet.get_submodule(target).weight.detach().clone()
            with (patch.object(self.probe,'require_mps'),
                  patch('torch.mps.empty_cache'),
                  patch('transformers.pipeline',return_value=lambda image:{'depth':Image.new('L',(1024,1024),20)}),
                  patch('diffusers.ControlNetModel.from_pretrained',return_value=object()),
                  patch.object(Pipeline,'from_pretrained',return_value=pipe),
                  patch('diffusers.UniPCMultistepScheduler.from_config',return_value=object()),
                  patch('diffusers.loaders.lora_base.HF_HUB_OFFLINE',True)):
                with self.assertRaisesRegex(RuntimeError,'adapters-observed'):
                    self.probe.run_inference(models,Image.new('RGB',(1024,1024)),
                        root,{},root/'loading.json')
            self.assertEqual(set(loaded),{'turbo','exposure'})
            layer=pipe.unet.get_submodule(target)
            for value,name in enumerate(['turbo','exposure'],1):
                torch.testing.assert_close(layer.lora_A[name].weight,torch.full((4,8),float(value)))
                torch.testing.assert_close(layer.lora_B[name].weight,torch.full((8,4),float(value)))
                pipe.unet.set_adapters(name)
                pipe.unet.fuse_lora(adapter_names=[name],lora_scale=1.)
                torch.testing.assert_close(layer.base_layer.weight,original_weight+4*value**2)
                pipe.unet.unfuse_lora()
                torch.testing.assert_close(layer.base_layer.weight,original_weight,atol=2e-6,rtol=1e-5)

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

    def test_adapter_prefix_conversion_preserves_values_and_rejects_ambiguity(self):
        import torch
        from safetensors.torch import save_file
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'pytorch_lora_weights.safetensors'
            for prefix in ['unet.','unet.unet.']:
                tensor=torch.arange(8,dtype=torch.float32).reshape(2,4)
                save_file({prefix+'layer.lora.down.weight':tensor},path)
                before=self.probe.digest(path)
                state,receipt=self.probe.adapter_weights(tmp)
                self.assertEqual(set(state),{'unet.layer.lora.down.weight'})
                torch.testing.assert_close(state['unet.layer.lora.down.weight'],tensor)
                self.assertEqual(self.probe.digest(path),before)
                self.assertEqual(receipt['removedPrefix'],'unet.' if prefix=='unet.unet.' else None)
            for keys in [[],['text_encoder.layer'],['unet.layer','unet.unet.layer'],['unet.unet.unet.layer']]:
                save_file({key:torch.ones(1) for key in keys},path)
                with self.assertRaisesRegex(ValueError,'adapter'):
                    self.probe.adapter_weights(tmp)

    @unittest.skipUnless(os.environ.get('DIFFUSIONLIGHT_MODELS'), 'requires pinned acquired adapters')
    def test_acquired_adapters_match_all_full_sdxl_target_shapes(self):
        from accelerate import init_empty_weights
        from diffusers import UNet2DConditionModel
        from diffusers.utils.state_dict_utils import convert_unet_state_dict_to_peft
        models=json.loads(Path(os.environ['DIFFUSIONLIGHT_MODELS']).read_text())['models']
        config=UNet2DConditionModel.load_config(Path(models['base']['path'])/'unet',local_files_only=True)
        with init_empty_weights():
            unet=UNet2DConditionModel.from_config(config)
        for name in ['turbo','exposure']:
            state,receipt=self.probe.adapter_weights(models[name]['path'])
            self.assertEqual(receipt['removedPrefix'],'unet.')
            state=convert_unet_state_dict_to_peft({key.removeprefix('unet.'):value for key,value in state.items()})
            targets={}
            for key,value in state.items():
                target,kind=key.rsplit('.lora_',1)
                layer=unet.get_submodule(target)
                self.assertEqual(value.ndim,2)
                self.assertIn(kind,['A.weight','B.weight'])
                dimension=1 if kind=='A.weight' else 0
                self.assertEqual(value.shape[dimension],layer.weight.shape[dimension],key)
                targets.setdefault(target,{})[kind]=value.shape
            self.assertTrue(targets)
            for target,pair in targets.items():
                self.assertEqual(set(pair),{'A.weight','B.weight'},target)
                self.assertEqual(pair['A.weight'][0],pair['B.weight'][1],target)

    def test_unavailable_mps_and_fallback_cannot_be_silent(self):
        import torch
        with patch.object(torch.backends.mps,'is_available',return_value=False):
            with self.assertRaisesRegex(RuntimeError,'MPS'):
                self.probe.require_mps()
        with patch.dict('os.environ',{'PYTORCH_ENABLE_MPS_FALLBACK':'1'}):
            with self.assertRaisesRegex(RuntimeError,'fallback'):
                self.probe.require_mps()

    def test_effective_device_accepts_indexed_mps_but_refuses_other_backends(self):
        import torch
        from diffusers import StableDiffusionXLControlNetInpaintPipeline as Pipeline
        for device in ['mps','mps:0','cpu','cuda:0']:
            with self.subTest(device=device), tempfile.TemporaryDirectory() as tmp:
                pipe=MagicMock()
                pipe.unet.device=torch.device(device)
                pipe.to.return_value=pipe
                pipe.encode_prompt.return_value=(torch.ones(1),None,torch.ones(1),None)
                models={name:{'path':tmp} for name in ['depth','base','control','turbo','exposure']}
                report={}
                expected='inference-boundary' if device.startswith('mps') else 'unexpected diffusion device'
                with (patch.object(self.probe,'require_mps'),
                      patch.object(self.probe,'adapter_weights',return_value=({},{})),
                      patch('torch.mps.empty_cache'),
                      patch('torch.mps.synchronize',side_effect=RuntimeError('inference-boundary')),
                      patch('transformers.pipeline',return_value=lambda image:{'depth':Image.new('L',(1024,1024),20)}),
                      patch('diffusers.ControlNetModel.from_pretrained',return_value=object()),
                      patch.object(Pipeline,'from_pretrained',return_value=pipe),
                      patch('diffusers.UniPCMultistepScheduler.from_config',return_value=object())):
                    with self.assertRaisesRegex(RuntimeError,expected):
                        self.probe.run_inference(models,Image.new('RGB',(1024,1024)),
                            Path(tmp),report,Path(tmp)/'loading.json')
                self.assertEqual(report['effectiveDevice'],device)

    def test_selected_seed_reaches_every_exposure_and_its_receipt(self):
        import torch
        from diffusers import StableDiffusionXLControlNetInpaintPipeline as Pipeline
        for selected in [None, 0, -1]:
            with self.subTest(seed=selected), tempfile.TemporaryDirectory() as tmp:
                expected=self.probe.SEED if selected is None else selected
                pipe=MagicMock()
                pipe.unet.device=torch.device('mps:0')
                pipe.to.return_value=pipe
                pipe.encode_prompt.return_value=(torch.ones(1),None,torch.ones(1),None)
                frame=Image.new('RGB',(1024,1024))
                frame.putpixel((512,512),(255,255,255))
                seeds=[]
                def generate(**kwargs):
                    seeds.append(kwargs['generator'].initial_seed())
                    kwargs['callback_on_step_end'](pipe,5,769,{})
                    return SimpleNamespace(images=[frame])
                pipe.side_effect=generate
                models={name:{'path':tmp} for name in ['depth','base','control','turbo','exposure']}
                report={}
                with (patch.object(self.probe,'require_mps'),
                      patch.object(self.probe,'adapter_weights',return_value=({},{})),
                      patch('torch.mps.empty_cache'),patch('torch.mps.synchronize'),
                      patch('transformers.pipeline',return_value=lambda image:{'depth':Image.new('L',(1024,1024),20)}),
                      patch('diffusers.ControlNetModel.from_pretrained',return_value=object()),
                      patch.object(Pipeline,'from_pretrained',return_value=pipe),
                      patch('diffusers.UniPCMultistepScheduler.from_config',return_value=object())):
                    kwargs={} if selected is None else {'seed':selected}
                    self.probe.run_inference(models,frame,Path(tmp),report,Path(tmp)/'lighting.json',**kwargs)
                effective=torch.Generator(device='cpu').manual_seed(expected).initial_seed()
                self.assertEqual(seeds,[effective]*len(self.probe.EVS))
                self.assertEqual(report['settings']['seed'],expected)
                self.assertEqual([item['seed'] for item in report['exposures']],[expected]*len(self.probe.EVS))
                self.assertEqual([item['effectiveSeed'] for item in report['exposures']],seeds)

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
