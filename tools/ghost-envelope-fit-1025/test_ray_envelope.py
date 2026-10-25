import unittest
import numpy as np
from ray_envelope import sphere_depth, cone_depth, require_target


class Rays(unittest.TestCase):
    def test_axial_depth_and_miss(self):
        actual = sphere_depth(np.zeros(3), np.array([[0.,0.,-1.],[2.,0.,-1.]]), np.array([0.,0.,-5.]), 1.)
        self.assertEqual(actual[0], 4.)
        self.assertTrue(np.isinf(actual[1]))

    def test_connector_between_nonoverlapping_end_spheres(self):
        # A ray hits the middle of a horizontal cylinder; neither end sphere covers it.
        actual = cone_depth(np.zeros(3), np.array([[0.,0.,-1.]]), np.array([-2.,0.,-5.]), np.array([2.,0.,-5.]), 1., 1.)
        self.assertAlmostEqual(actual[0], 4., places=10)

    def test_taper_and_finite_segment(self):
        rays=np.array([[0.,0.,-1.],[1.,0.,-1.]])
        actual=cone_depth(np.zeros(3),rays,np.array([-2.,0.,-5.]),np.array([2.,0.,-5.]),.5,1.5)
        self.assertAlmostEqual(actual[0],4.,places=10)
        self.assertTrue(np.isinf(actual[1]))

    def test_blank_and_nonfinite_target_rejected(self):
        for depth,mask in [(np.ones((2,2)),np.zeros((2,2),bool)),(np.full((2,2),np.nan),np.ones((2,2),bool))]:
            with self.assertRaisesRegex(ValueError,'nonempty positive finite'):
                require_target(depth,mask)

if __name__ == '__main__': unittest.main()
