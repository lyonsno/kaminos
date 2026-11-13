# kaminos-test: python
"""The offline fit must recover angular behavior, not memorize illuminants."""
import importlib.util
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'tools'))


@unittest.skipUnless(importlib.util.find_spec('mlx'), 'Optional MLX dependency')
class FittedReflectanceTest(unittest.TestCase):
    def test_fit_recovers_tilted_anisotropic_response_on_heldout_angles(self):
        import mlx.core as mx
        import numpy as np
        from fitted_reflectance import directions, fit_tile, response
        mx.set_default_device(mx.cpu)
        known = mx.array([[[.08, .035, .015, .28, .38, .62, .14, -.09, .18, .48, .42]]])
        wi, wo = directions(180, 24)
        target = response(known, wi, wo)
        initial, result = fit_tile(target, wi, wo, steps=160)
        v, l = directions(180, 71)
        expected = np.asarray(response(known, v, l))
        error = lambda m: np.mean(np.abs(np.log1p(np.asarray(response(m, v, l))) - np.log1p(expected)))
        self.assertLess(error(result), error(initial) * .45)
        self.assertLess(error(result), .017)

    def test_unlit_hemisphere_and_independent_lobes(self):
        import mlx.core as mx
        import numpy as np
        from fitted_reflectance import response
        mx.set_default_device(mx.cpu)
        # Pure diffuse, no gloss, no tilt: projected result is albedo/pi at normal incidence.
        material = mx.array([[.3, .6, .9, 0, 0, 0, 0, 0, .35, .35, 0.]])
        view = mx.array([[0., 0., 1.]])
        result = response(material, view, mx.array([[0., 0., 1.], [0., 0., -1.]]))
        np.testing.assert_allclose(np.asarray(result), [[.3/np.pi, .6/np.pi, .9/np.pi], [0, 0, 0]], atol=1e-6)


if __name__ == '__main__':
    unittest.main()
