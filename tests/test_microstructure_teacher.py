import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('microstructure_fit', Path(__file__).parents[1] / 'tools' / 'fit-microstructure.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MicrostructureTeacherTest(unittest.TestCase):
    def test_distance_is_to_disc_not_infinite_plane_or_center(self):
        rows = np.array([[0, 0, 0, 0, 0, 2, 1, 0, 0, 0, .8, 1]], dtype=np.float32)
        points = np.array([[0, 0, .5], [.5, 0, 0], [2, 0, 0], [2, 0, 1]], dtype=np.float32)
        result = module.distance_targets(points, rows, 1)
        np.testing.assert_allclose(result[:, 0], [.5, 0, 1, np.sqrt(2)], rtol=1e-6)
        np.testing.assert_allclose(result[:, 1:4], np.tile([0, 0, 1], (4, 1)))
        np.testing.assert_allclose(result[:, 4:7], np.tile([1, 0, 0], (4, 1)))

    def test_nearest_surface_material_and_gap(self):
        rows = np.array([[-.3, 0, 0, 0, 0, 1, 1, 0, 0, 0, .8, 1], [.3, 0, .2, 0, 0, 1, 0, 1, 0, 0, .8, 1]], dtype=np.float32)
        result = module.distance_targets(np.array([[0, 0, 0], [.3, 0, .3]], dtype=np.float32), rows, .1)
        self.assertAlmostEqual(float(result[0, 0]), .2, places=6)
        self.assertAlmostEqual(float(result[1, 0]), .1, places=6)
        np.testing.assert_array_equal(result[1, 4:7], [0, 1, 0])

    def test_transparent_samples_are_not_geometry(self):
        rows = np.array([[0, 0, 0, 0, 0, 1, 1, 0, 0, 0, .8, 0], [0, 0, .5, 0, 0, 1, 0, 1, 0, 0, .8, 1]], dtype=np.float32)
        result = module.distance_targets(np.array([[0, 0, 0]], dtype=np.float32), rows, .1)
        self.assertEqual(float(result[0, 0]), .5)


if __name__ == '__main__':
    unittest.main()
