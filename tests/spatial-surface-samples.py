# kaminos-test: python
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('spatial', Path(__file__).resolve().parents[1]/'tools/spatial_surface_samples.py')
spatial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(spatial)


def points(x, y, offset=0, normal=1):
    xx, yy = np.meshgrid(x, y)
    rows = np.zeros((xx.size, 12), '<f4')
    rows[:, 0] = xx.ravel()+offset; rows[:, 1] = yy.ravel(); rows[:, 5] = normal
    rows[:, 6:12] = [.4, .3, .2, .1, .7, 1]
    return rows


class SpatialSamples(unittest.TestCase):
    def test_fixed_budget_covers_sparse_and_dense_regions_without_mutation(self):
        rows = np.r_[points(np.linspace(0,.3,27),np.linspace(0,.3,27)),
                     points(np.linspace(0,.3,9),np.linspace(0,.3,9),offset=1)]
        original=rows.copy()
        ids, footprints, meta=spatial.spatial_samples(rows,128,.18)
        self.assertEqual(len(ids),128); self.assertEqual(len(np.unique(ids)),128)
        self.assertGreater(np.count_nonzero(rows[ids,0]>.9),24)
        self.assertGreater(np.count_nonzero(rows[ids,0]<.4),24)
        np.testing.assert_array_equal(rows,original)
        np.testing.assert_array_equal(ids,spatial.spatial_samples(rows,128,.18)[0])
        self.assertEqual(footprints.shape,(128,8)); self.assertEqual(meta['candidateCount'],len(rows))

    def test_fitted_support_tracks_narrow_strip_and_tangent_plane(self):
        rows=points(np.linspace(0,1,128),np.linspace(0,.002,5))
        ids, f, _=spatial.spatial_samples(rows,32,.002)
        self.assertTrue(np.isfinite(f).all()); self.assertTrue((f[:,[3,7]]>0).all())
        np.testing.assert_allclose(np.linalg.norm(f[:,:3],axis=1),1,atol=1e-6)
        np.testing.assert_allclose(np.linalg.norm(f[:,4:7],axis=1),1,atol=1e-6)
        np.testing.assert_allclose(np.sum(f[:,:3]*f[:,4:7],axis=1),0,atol=1e-6)
        np.testing.assert_allclose(f[:,[2,6]],0,atol=1e-6)
        handedness=np.sum(np.cross(f[:,:3],f[:,4:7])*rows[ids,3:6],axis=1)
        self.assertTrue((handedness>.999999).all(), 'Footprint winding must agree with its source normal')
        self.assertGreater(np.median(np.maximum(f[:,3],f[:,7])/np.minimum(f[:,3],f[:,7])),3)

    def test_opposed_normals_remain_separate_and_invalid_input_refuses(self):
        rows=np.r_[points(np.linspace(0,1,8),np.linspace(0,1,8)),
                   points(np.linspace(0,1,8),np.linspace(0,1,8),normal=-1)]
        ids, f, meta=spatial.spatial_samples(rows,32,2)
        self.assertEqual(set(rows[ids,5]),{-1,1})
        self.assertTrue((np.sum(np.cross(f[:,:3],f[:,4:7])*rows[ids,3:6],axis=1)>.999999).all())
        self.assertEqual(meta['normalBins'],6)
        for count, area in [(0,2),(1000,2),(32,0)]:
            with self.assertRaises(ValueError):spatial.spatial_samples(rows,count,area)


if __name__=='__main__':unittest.main()
