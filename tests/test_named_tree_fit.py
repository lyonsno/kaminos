# kaminos-test: python
import importlib.util
from pathlib import Path
import unittest
import numpy as np
spec=importlib.util.spec_from_file_location('fit_tree',Path(__file__).parents[1]/'tools/assays/rig-to-cast-fit/fit_tree.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

@unittest.skipUnless(importlib.util.find_spec('scipy'),'offline fitting requires SciPy')
class NamedTreeFit(unittest.TestCase):
    def test_joint_pose_changes_without_changing_lengths(self):
        rest=np.array([[0.,0,0],[1.,0,0],[2.,0,0],[3.,0,0]])
        target=np.array([[0.,0,0],[1.,0,0],[1.,1,0],[1.,2,0]])
        result=mod.fit_tree(rest,[-1,0,1,2],[{'joint':i,'point':p.tolist(),'sigma':.01} for i,p in enumerate(target)])
        q=np.array(result['joints'])
        self.assertLess(np.max(np.linalg.norm(q-target,axis=1)),.01)
        np.testing.assert_allclose(np.linalg.norm(np.diff(q,axis=0),axis=1),1,atol=1e-9)

    def test_rest_targets_remain_rest(self):
        rest=np.array([[0.,0,0],[1.,0,0],[1.,1,0]])
        result=mod.fit_tree(rest,[-1,0,1],[{'joint':i,'point':p.tolist(),'sigma':.01} for i,p in enumerate(rest)])
        np.testing.assert_allclose(result['joints'],rest,atol=1e-8)

    def test_missing_or_wrong_landmarks_fail(self):
        for targets in [[],[{'joint':3,'point':[0,0,0],'sigma':.1}]]:
            with self.assertRaises(ValueError):mod.fit_tree([[0,0,0],[1,0,0]],[-1,0],targets)

if __name__=='__main__':unittest.main()
