import importlib.util
import os
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import numpy as np
import torch
from diffusers import FluxPipeline, FluxTransformer2DModel, FlowMatchEulerDiscreteScheduler

import limo_probe as probe


class LimoProbeTests(unittest.TestCase):
    def packed_asset_fixture(self, root):
        checkpoint_sha='29e6f6e98e81c0ac187d95927641d4ef61c3d1b9e18f278c06369d98cbc1a6be'
        transformer=root/'transformer'; transformer.mkdir()
        t5=root/'t5'; t5.mkdir()
        (transformer/'package.json').write_text(json.dumps({
            'schema':'kaminos.limo-quanto.v1','quantization':{'layer':{'weights':'qint4','activations':'none'}},
            'source':{'component':'transformer','checkpointSha256':checkpoint_sha}}))
        shard='text_encoder_2/model-00001-of-00002.safetensors'
        shard_sha='a'*64
        (t5/'package.json').write_text(json.dumps({
            'schema':'kaminos.limo-quanto.v1','quantization':{'layer':{'weights':'qint4','activations':'none'}},
            'source':{'component':'t5','files':{Path(shard).name:shard_sha}}}))
        metadata=root/'metadata.json'; metadata.write_text('{}')
        args=SimpleNamespace(source_root=root,checkpoint=root/'retired.pt',metadata=metadata,support=root,
                             quantized_transformer=transformer,quantized_t5=t5)
        return args,[{'rfilename':shard,'size':100,'lfs':{'sha256':shard_sha}}]

    def test_packed_replacements_do_not_require_retired_full_weight_files(self):
        with tempfile.TemporaryDirectory() as temp:
            args,entries=self.packed_asset_fixture(Path(temp))
            with patch.object(probe.subprocess,'check_output',side_effect=[probe.SOURCE_REVISION,'']), \
                 patch.object(probe,'support_files',return_value=entries):
                result=probe.validate_assets(args)
            self.assertEqual(result['checkpoint']['sha256'],
                '29e6f6e98e81c0ac187d95927641d4ef61c3d1b9e18f278c06369d98cbc1a6be')
            self.assertEqual(result['checkpoint']['authority'],'packed-source-provenance; full weights not required')
            self.assertEqual(result['support']['files'][entries[0]['rfilename']]['authority'],
                             'packed-source-provenance; full weights not required')

    def test_wrong_source_package_cannot_bypass_original_weight_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            args,entries=self.packed_asset_fixture(Path(temp))
            path=args.quantized_transformer/'package.json'; record=json.loads(path.read_text())
            record['source']['checkpointSha256']='b'*64; path.write_text(json.dumps(record))
            with patch.object(probe.subprocess,'check_output',side_effect=[probe.SOURCE_REVISION,'']), \
                 patch.object(probe,'support_files',return_value=entries):
                with self.assertRaisesRegex(ValueError,'source mismatch'):
                    probe.validate_assets(args)

    def test_missing_t5_source_digest_cannot_bypass_original_shard_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            args,entries=self.packed_asset_fixture(Path(temp))
            path=args.quantized_t5/'package.json'; record=json.loads(path.read_text())
            record['source']['files']={}; path.write_text(json.dumps(record))
            with patch.object(probe.subprocess,'check_output',side_effect=[probe.SOURCE_REVISION,'']), \
                 patch.object(probe,'support_files',return_value=entries):
                with self.assertRaisesRegex(ValueError,'T5 source mismatch'):
                    probe.validate_assets(args)

    def test_missing_support_manifest_cannot_validate(self):
        with self.assertRaisesRegex(ValueError,'incomplete support manifest'):
            probe.support_files({'sha':probe.SUPPORT_REVISION,'siblings':[]})

    def test_early_failure_preserves_requested_route_and_phase(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)/'out'
            argv=[]
            for name in ('source-root','support','checkpoint','metadata','scene'):
                argv.extend(['--'+name,temp])
            argv.extend(['--output-dir',str(output),'--targets','sphere_0','--evs','0'])
            with patch.object(probe,'require_mps',side_effect=RuntimeError('MPS unavailable')):
                with self.assertRaisesRegex(RuntimeError,'MPS unavailable'):
                    probe.main(argv)
            report=json.loads((output/'probe.json').read_text())
            self.assertEqual(report['status'],'failed')
            self.assertEqual(report['phase'],'initialization')
            self.assertEqual(report['requestedDevice'],'mps')
            self.assertNotIn('route',report)
            self.assertIn('MPS unavailable',report['error'])

    def test_conditioned_config_preserves_output_width_and_original(self):
        base={'in_channels':64,'out_channels':None,'num_layers':1,'guidance_embeds':False}
        actual=probe.conditioned_config(base)
        self.assertEqual(actual['in_channels'],384)
        self.assertEqual(actual['out_channels'],64)
        self.assertEqual(base['in_channels'],64)
        self.assertFalse(actual['guidance_embeds'])

    def test_explicit_noise_has_output_channels_not_condition_channels(self):
        class Pipe:
            vae_scale_factor=8
            transformer=type('Transformer',(),{'config':type('Config',(),{'in_channels':384,'out_channels':64})()})()
            _pack_latents=staticmethod(FluxPipeline._pack_latents)
        a=probe.packed_noise(Pipe(),32,32,torch.Generator().manual_seed(0),torch.float32,'cpu')
        b=probe.packed_noise(Pipe(),32,32,torch.Generator().manual_seed(0),torch.float32,'cpu')
        self.assertEqual(tuple(a.shape),(1,4,64))
        torch.testing.assert_close(a,b,rtol=0,atol=0)

    def test_blank_masked_output_and_partial_steps_cannot_pass(self):
        image=np.zeros((4,4,3),dtype=np.float32)
        image[0,0]=1
        mask=np.zeros((4,4),dtype=bool); mask[1:3,1:3]=True
        with self.assertRaisesRegex(ValueError,'blank'):
            probe.validate_pass(image,mask,20,20)
        image[1,1]=.5
        with self.assertRaisesRegex(ValueError,'steps'):
            probe.validate_pass(image,mask,19,20)
        with self.assertRaisesRegex(ValueError,'mask'):
            probe.validate_pass(image,np.zeros_like(mask),20,20)
        image[1,1,0]=np.nan
        with self.assertRaisesRegex(ValueError,'finite'):
            probe.validate_pass(image,mask,20,20)

    def test_nonblank_probe_returns_concrete_region_statistics(self):
        image=np.zeros((4,4,3),dtype=np.float32); image[1,1]=.5
        mask=np.ones((4,4),dtype=bool)
        result=probe.validate_pass(image,mask,20,20)
        self.assertEqual(result['maskPixels'],16)
        self.assertEqual(result['max'],.5)

    @unittest.skipUnless(os.environ.get('LIMO_SOURCE_ROOT'),'set LIMO_SOURCE_ROOT for upstream pipeline conformance')
    def test_actual_upstream_pipeline_accepts_explicit_output_latents(self):
        root=Path(os.environ['LIMO_SOURCE_ROOT'])
        spec=importlib.util.spec_from_file_location('limo_pipeline_test',root/'image/conditional_pipelines.py')
        source=importlib.util.module_from_spec(spec); spec.loader.exec_module(source)
        config=probe.conditioned_config(dict(in_channels=64,out_channels=None,num_layers=1,
            num_single_layers=1,attention_head_dim=16,num_attention_heads=2,
            joint_attention_dim=32,pooled_projection_dim=16,axes_dims_rope=(4,6,6),guidance_embeds=False))
        transformer=FluxTransformer2DModel(**config)
        pipe=source.ConditionalFluxPipeline(transformer=transformer,
            scheduler=FlowMatchEulerDiscreteScheduler(use_dynamic_shifting=False),vae=None,
            text_encoder=None,tokenizer=None,text_encoder_2=None,tokenizer_2=None)
        kwargs=dict(height=32,width=32,num_inference_steps=1,
            prompt_embeds=torch.zeros(1,3,32),pooled_prompt_embeds=torch.zeros(1,16),
            latent_conditions=[torch.zeros(1,16,4,4) for _ in range(5)],output_type='latent')
        with self.assertRaisesRegex(RuntimeError,'shapes cannot be multiplied'):
            pipe(**kwargs,generator=torch.Generator().manual_seed(0))
        noise=probe.packed_noise(pipe,32,32,torch.Generator().manual_seed(0),torch.float32,'cpu')
        result=pipe(**kwargs,latents=noise).images
        self.assertEqual(tuple(result.shape),(1,4,64))
        self.assertTrue(torch.isfinite(result).all())


if __name__=='__main__':
    unittest.main()
