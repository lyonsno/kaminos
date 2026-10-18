# kaminos-test: python
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
from pose_normalization import rotation_between, canonical_joints, deform_points, fit_skeleton


class PoseNormalizationTests(unittest.TestCase):
    def test_rotation_including_opposite_and_zero_rejection(self):
        for a, b in [([0,1,0],[1,0,0]), ([0,1,0],[0,-1,0])]:
            r = rotation_between(a,b)
            np.testing.assert_allclose(r@a,b,atol=1e-10)
            np.testing.assert_allclose(r.T@r,np.eye(3),atol=1e-10)
            self.assertAlmostEqual(np.linalg.det(r),1)
        with self.assertRaises(ValueError): rotation_between([0,0,0],[1,0,0])

    def test_pose_only_preserves_fitted_lengths_not_authored_lengths(self):
        rest=np.array([[0.,0,0],[0,1,0],[0,2,0]])
        fitted=np.array([[1.,0,0],[1,.5,0],[1.5,.5,0]])
        parents=np.array([-1,0,1])
        pose=canonical_joints(rest,fitted,parents)
        np.testing.assert_allclose(pose,[[0,0,0],[0,.5,0],[0,1,0]])
        exact=canonical_joints(rest,fitted,parents,match_lengths=True)
        np.testing.assert_allclose(exact,rest)

    def test_transport_preserves_radial_detail_and_maps_both_endpoints(self):
        fitted=np.array([[0.,0,0],[1,0,0]])
        target=np.array([[0.,0,0],[0,2,0]])
        points=np.array([[0.,0,0],[1,0,0],[.5,.1,0]])
        result=deform_points(points,fitted,target,[-1,0],np.ones((3,1)))
        np.testing.assert_allclose(result,[[0,0,0],[0,2,0],[-.1,1,0]],atol=1e-10)
        with self.assertRaises(ValueError):
            deform_points(points,fitted,target,[-1,0],np.zeros((3,1)))

    def test_automatic_fit_to_offset_cylinder_uses_geometry(self):
        # No supplied target correspondences: recover the axis from a surface.
        theta=np.arange(32)*2*np.pi/32
        points=np.array([[.28+.12*np.cos(t),y,.12*np.sin(t)] for y in np.linspace(0,1,17) for t in theta])
        joints=np.array([[0.,0,0],[0,1,0]])
        result=fit_skeleton(points,np.ones(len(points)),joints,[-1,0],[.12,.12],voxel_size=.025)
        self.assertLess(np.max(np.abs(result['joints'][:,0]-.28)),.05)
        self.assertLess(result['after']['surfaceRms'],result['before']['surfaceRms']*.5)
        self.assertGreater(result['coarsePoints'],0)
        self.assertEqual(result['inputPoints'],len(points))

    def test_nonfinite_or_disconnected_tree_fails(self):
        with self.assertRaises(ValueError):
            fit_skeleton([[float('nan'),0,0]],[1],[[0,0,0],[0,1,0]],[-1,0],[.1,.1],voxel_size=.1)
        with self.assertRaises(ValueError):
            canonical_joints(np.zeros((2,3)),np.zeros((2,3)),[-1,-1])


if __name__=='__main__': unittest.main()
