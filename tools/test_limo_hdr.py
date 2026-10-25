import importlib
import os
import json
from pathlib import Path
import sys
import unittest
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

import torch
from PIL import Image

from emlight_probe import digest
import limo_hdr
from limo_hdr import validate_probe


class LimoHdrInputTests(unittest.TestCase):
    def test_pre_output_failure_has_durable_phase(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'out'
            argv=['--source-root',directory,'--probe',str(Path(directory)/'missing.json'),
                '--output-dir',str(output)]
            with patch.object(limo_hdr,'fit',side_effect=RuntimeError('route rejected')):
                with self.assertRaisesRegex(RuntimeError,'route rejected'): limo_hdr.main(argv)
            report=json.loads((output/'fit.json').read_text())
            self.assertEqual(report['status'],'failed')
            self.assertEqual(report['phase'],'initialization')
            self.assertNotIn('route',report)
            self.assertIn('route rejected',report['error'])

    def test_partial_exposure_set_cannot_be_joint_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'probe.json'
            path.write_text(json.dumps({'status':'complete','estimator':'LiMo-image','passes':[]}))
            with self.assertRaisesRegex(ValueError,'complete eight-pass'):
                validate_probe(path)

    def test_changed_image_cannot_silently_become_fit_input(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'probe.json'; image=Path(directory)/'image.png'
            Image.new('RGB',(512,512),'gray').save(image)
            entries=[{'target':target,'ev':ev,'effectiveSteps':20,'path':str(image),'sha256':digest(image)}
                for target in ('sphere_0','sphere_1') for ev in (0,-3,-6,-9)]
            path.write_text(json.dumps({'status':'complete','estimator':'LiMo-image','passes':entries}))
            result=validate_probe(path)
            self.assertEqual(len(result['passes']),8)
            Image.new('RGB',(512,512),'white').save(image)
            with self.assertRaisesRegex(ValueError,'digest mismatch'):
                validate_probe(path)


@unittest.skipUnless(os.environ.get('LIMO_HDR_SOURCE_ROOT'),'set LIMO_HDR_SOURCE_ROOT for source renderer tests')
class LimoHdrTests(unittest.TestCase):
    def test_bilinear_gather_matches_grid_sample_values_and_environment_gradients(self):
        root=Path(os.environ['LIMO_HDR_SOURCE_ROOT']); sys.path.insert(0,str(root))
        source=importlib.import_module('HDRMerge.batch_optimization_pol_manual_gt')
        torch.manual_seed(3)
        env=torch.randn(1,3,5,7,requires_grad=True)
        uv=torch.tensor([[0.,0.],[1.,1.],[.34,.67],[-.07,.5],[1.07,.5],[-1.,.5],[.5,1.2]])
        expected=source.sample_envmap(env,uv)
        actual=source.sample_envmap_bilinear(env,uv)
        torch.testing.assert_close(actual,expected,rtol=1e-6,atol=1e-6)
        a,=torch.autograd.grad(actual.square().sum(),env,retain_graph=True)
        b,=torch.autograd.grad(expected.square().sum(),env)
        torch.testing.assert_close(a,b,rtol=1e-6,atol=1e-6)

    def test_omitted_geometry_digest_rejected_before_any_geometry_read(self):
        root=Path(os.environ['LIMO_HDR_SOURCE_ROOT'])
        consumed=('sphere_0/mask_0001.exr','sphere_0/position_0001.exr',
            'sphere_0/normal_0001.exr','camera_info.pkl')
        with tempfile.TemporaryDirectory() as directory:
            scene=Path(directory)/'scene'; scene.mkdir()
            for relative in consumed:
                item=scene/relative; item.parent.mkdir(exist_ok=True); item.write_bytes(b'fixture')
            probe_path=Path(directory)/'probe.json'; probe_path.write_text('{}')
            report_path=Path(directory)/'fit.json'
            for omitted in (consumed,('camera_info.pkl',)):
                with self.subTest(omitted=omitted):
                    probe={'scene':{'path':str(scene),'files':{
                        name:digest(scene/name) for name in consumed if name not in omitted}}}
                    args=SimpleNamespace(probe=probe_path,source_root=root)
                    with patch.object(limo_hdr,'require_mps'),patch.object(limo_hdr,'validate_probe',return_value=probe), \
                            patch('pyexr.read',side_effect=RuntimeError('unexpected geometry read')) as read:
                        with self.assertRaisesRegex(ValueError,'incomplete scene manifest'):
                            limo_hdr.fit(args,{},report_path)
                        read.assert_not_called()

    def test_source_renderer_keeps_device_and_environment_gradient(self):
        root=Path(os.environ['LIMO_HDR_SOURCE_ROOT'])
        sys.path.insert(0,str(root))
        source=importlib.import_module('HDRMerge.batch_optimization_pol_manual_gt')
        position=torch.zeros(3,2,2); position[2]=-2
        normal=torch.zeros_like(position); normal[2]=1
        env=torch.full((3,8,16),2.,requires_grad=True)
        actual=source.render(position,torch.eye(4),normal,env,mode='mirror')
        self.assertEqual(tuple(actual.shape),(3,2,2))
        torch.testing.assert_close(actual,torch.full_like(actual,2.))
        actual.sum().backward()
        self.assertGreater(env.grad.abs().sum().item(),0)
        self.assertEqual(actual.device.type,'cpu')

    def test_source_diffuse_renderer_and_nongraphed_pyramid(self):
        root=Path(os.environ['LIMO_HDR_SOURCE_ROOT']); sys.path.insert(0,str(root))
        source=importlib.import_module('HDRMerge.batch_optimization_pol_manual_gt')
        torch.manual_seed(0)
        pol=source.PoL(torch.full((1,3,8,16),.5),padding_mode='circular',graphed=False)
        env=pol().squeeze(0).exp2()
        position=torch.zeros(3,2,2); position[2]=-2
        normal=torch.zeros_like(position); normal[2]=1
        actual=source.render(position,torch.eye(4),normal,env,mode='diffuse',num_samples=64)
        self.assertTrue(torch.isfinite(actual).all())
        actual.sum().backward()
        self.assertTrue(any(group['params'].grad.abs().sum()>0 for group in pol.parameters()))


if __name__=='__main__': unittest.main()
