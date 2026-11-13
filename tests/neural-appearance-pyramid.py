# kaminos-test: python
import json
import importlib.util
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'tools'))

@unittest.skipUnless(importlib.util.find_spec('mlx'), 'Optional MLX dependency')
class PyramidTest(unittest.TestCase):
    def test_continuation_keeps_fine_bytes_and_improves_a_coarse_response(self):
        import mlx.core as mx
        import numpy as np
        from neural_appearance_mlx import Appearance
        from neural_appearance_pyramid import checkpoint_digest, fit_level, load_parent, write_bundle
        mx.set_default_device(mx.cpu)
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            fine = Appearance(4, recipe='published-direct')
            fine.latents = mx.zeros((16, 8))
            parent = fine.save_bundle(root/'parent', {'sourceHash': 'b'*64, 'step': 100000})
            original = (root/'parent/latents.f32').read_bytes()
            raw, _, codes = load_parent(root/'parent/model.json', parent['sha256'], 'b'*64)
            xyz = np.tile(np.array([[0., 0., 1., 0., 0., 1.]], dtype='f4'), (4,1))
            q = np.concatenate((np.array([[.25,.25],[.75,.25],[.25,.75],[.75,.75]], dtype='f4'),xyz),axis=1)
            coarse = Appearance(2, recipe='published-direct')
            coarse.latents = mx.ones((4,8))*.25
            target = np.asarray(coarse(mx.array(q)))
            train = lambda _: (q,target)
            output, stats = fit_level(raw, codes, 2, train, (q,target), steps=120, learning_rate=.015)
            self.assertLess(stats['after']['meanLog1pL1'], .2*stats['before']['meanLog1pL1'])
            manifest = write_bundle(root/'trained', raw, original, [(2,output)], parent['sha256'])
            self.assertEqual(checkpoint_digest((root/'trained/latents.f32').read_bytes()),checkpoint_digest(original))
            self.assertEqual(manifest['decoder'], raw['decoder'])
            self.assertEqual([level['width'] for level in manifest['kaminos']['levels']],[4,2])
            with self.assertRaisesRegex(ValueError,'source'):
                load_parent(root/'parent/model.json',parent['sha256'],'c'*64)

if __name__=='__main__':
    unittest.main()
