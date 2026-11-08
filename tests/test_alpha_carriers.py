# kaminos-test: python
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('alpha', Path(__file__).parents[1] / 'tools/alpha-carriers.py')
alpha = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alpha)


class AlphaCarriers(unittest.TestCase):
    def rows(self):
        a = np.zeros((8, 12), np.float32)
        a[:, :3] = [[x, y, 0] for x in [-.6, -.2, .2, .6] for y in [-.3, .3]]
        a[:, 5] = 1
        a[:, 11] = 1
        return a

    def test_partition_keeps_every_source_once_at_each_level(self):
        a = self.rows()
        levels = alpha.partition(a, [2, 4, 8], .1)
        for count, groups in levels.items():
            self.assertEqual(len(groups), count)
            np.testing.assert_array_equal(np.sort(np.concatenate(groups)), np.arange(8))
        self.assertEqual([g.tolist() for g in levels[4]], [g.tolist() for g in alpha.partition(a, [4], .1)[4]])

    def test_projected_disc_union_has_real_hole_not_filled_bounding_region(self):
        a = self.rows()[[0, 6]]
        h = alpha.patch(a, .1)
        q = np.stack([a[0, :3], a[1, :3], (a[0, :3] + a[1, :3]) / 2])
        np.testing.assert_array_equal(alpha.coverage(q, a, h[9:12], .1), [1, 1, 0])

    def test_invisible_source_does_not_fill_hole(self):
        a = self.rows()[[0, 6]]
        a[1, 11] = 0
        np.testing.assert_array_equal(alpha.coverage(a[:, :3], a, np.array([0, 0, 1]), .1), [1, 0])

    def test_plane_frame_and_bounds_are_geometric(self):
        a = self.rows()
        h = alpha.patch(a, .1)
        u, v, n = h[3:6], h[6:9], h[9:12]
        np.testing.assert_allclose(np.array([u, v, n]) @ np.array([u, v, n]).T, np.eye(3), atol=1e-6)
        p = a[:, :3] - h[:3]
        self.assertTrue(np.all(np.abs(p @ u) + .1 <= h[12] + 1e-6))
        self.assertTrue(np.all(np.abs(p @ v) + .1 <= h[13] + 1e-6))

    def test_curved_normals_across_dominant_axis_boundary_keep_their_plane(self):
        a = self.rows()
        a[:4, 3:6] = [.71, -.70, 0]
        a[4:, 3:6] = [.70, -.71, 0]
        expected = alpha.unit(a[:, 3:6].mean(0))
        self.assertGreater(abs(float(alpha.patch(a, .1)[9:12] @ expected)), .999)
        a[::2, 3:6] *= -1
        self.assertGreater(abs(float(alpha.patch(a, .1)[9:12] @ expected)), .999)

    def test_tilted_finite_disc_projection_contracts_instead_of_expanding(self):
        a = self.rows()[:1]
        a[0, :3] = 0
        a[0, 3:6] = [np.sqrt(3) / 2, 0, .5]
        q = np.array([[.4, 0, 0], [.6, 0, 0], [0, .9, 0], [0, 1.1, 0]])
        np.testing.assert_array_equal(alpha.coverage(q, a, np.array([0, 0, 1]), 1), [1, 0, 1, 0])

    def test_actual_mask_samples_disk_and_empty_corners(self):
        a = self.rows()[:1]
        h = alpha.patch(a, .1)
        mask = alpha.bake(a, h, .1, 16)
        self.assertEqual(mask.shape, (16, 16))
        self.assertEqual(mask[8, 8], 1)
        self.assertEqual(mask[0, 0], 0)

    def test_invalid_counts_and_empty_support_reject(self):
        with self.assertRaises(ValueError):
            alpha.partition(self.rows(), [9], .1)
        a = self.rows()
        a[:, 11] = 0
        with self.assertRaises(ValueError):
            alpha.patch(a, .1)


if __name__ == '__main__':
    unittest.main()
