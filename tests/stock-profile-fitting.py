# kaminos-test: python
import importlib.util
from pathlib import Path
import unittest
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stock_profile_recovery',ROOT/'tools/stock_profile_recovery.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProfileCorrespondence(unittest.TestCase):
    def test_affine_correspondence_is_exact_between_landmarks(self):
        points=np.array([[-1,-1],[1,-1],[1,1],[-1,1]],dtype=float)
        affine=np.array([[1.2,.3],[-.2,.8]])
        targets=points@affine.T+[.4,-.1]
        field=module.fit_profile_field(points,targets)
        probes=np.array([[.2,.3],[-.4,.25],[0,0]])
        np.testing.assert_allclose(module.evaluate_field(field,probes),probes@affine.T+[.4,-.1],atol=1e-10)
        np.testing.assert_allclose(field['weights'],0,atol=1e-10)

    def test_nonlinear_correspondence_matches_an_independent_exact_field(self):
        points=np.array([[-1,-1],[1,-1],[1,1],[-1,1]],dtype=float)
        weights=np.array([[.1,0],[-.1,0],[.1,0],[-.1,0]])
        def exact(query):
            r2=((query[:,None,:]-points[None,:,:])**2).sum(2)
            basis=np.zeros_like(r2)
            positive=r2>0
            basis[positive]=.5*r2[positive]*np.log(r2[positive])
            return query+basis@weights
        field=module.fit_profile_field(points,exact(points))
        probes=np.array([[.25,.3],[-.2,.7],[0,0]])
        np.testing.assert_allclose(module.evaluate_field(field,probes),exact(probes),atol=1e-10)

    def test_conflicting_or_unresolved_features_refuse(self):
        with self.assertRaisesRegex(ValueError,'distinct|conflict'):
            module.fit_profile_field([[0,0],[0,0],[1,1]],[[0,0],[1,0],[1,1]])
        with self.assertRaisesRegex(ValueError,'rank|collinear'):
            module.fit_profile_field([[0,0],[1,0],[2,0]],[[0,0],[1,0],[2,0]])

    def test_common_rays_below_rim_pair_inner_and_outer_walls(self):
        inner=np.array([[-.9,0],[-.8,0],[0,-.8],[.8,0],[.9,0]])
        outer=np.array([[-1.1,0],[-1,0],[0,-1],[1,0],[1.1,0]])
        segments=np.concatenate([np.stack([inner[:-1],inner[1:]],axis=1),np.stack([outer[:-1],outer[1:]],axis=1)])
        section=dict(evidence=dict(opening=dict(center=[0,0]),segments=segments.tolist(),innerSegments=list(range(4)),outerSegments=list(range(4,8))))
        features=module.section_features(section,dict(center=[0,0],innerRadius=.8,outerRadius=1),[0,.5,1],.01)
        np.testing.assert_allclose(features['points'][0],[-.79,-.01])
        np.testing.assert_allclose(features['points'][3],[-.99,-.01])
        self.assertEqual(len(features['raw']),len(inner)+len(outer),'Fitted envelope must retain all raw rim evidence')

    def test_unresolved_wall_separation_is_not_a_conflicting_control(self):
        inner=np.array([[-1,0],[0,-1],[1,0]])
        outer=inner*1.00001
        segments=np.concatenate([np.stack([inner[:-1],inner[1:]],axis=1),np.stack([outer[:-1],outer[1:]],axis=1)])
        section=dict(evidence=dict(opening=dict(center=[0,0]),segments=segments.tolist(),innerSegments=[0,1],outerSegments=[2,3]))
        features=module.section_features(section,dict(center=[0,0],innerRadius=.8,outerRadius=1),[0,.5,1],.01,.001)
        self.assertEqual(len(features['points']),3)
        self.assertEqual(len(features['raw']),6)
        self.assertTrue(all(not r['outerResolved'] and len(r['distances'])==2 for r in features['rays']))


if __name__=='__main__':unittest.main()
