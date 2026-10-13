# kaminos-test: python
import importlib.util
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('full_binding',Path(__file__).resolve().parents[1]/'full-creature-binding.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def bone(name,x,parent=None):
    matrix=np.eye(4);matrix[0,3]=x
    return {'name':name,'parent':parent,'restMatrix':matrix.tolist(),'tail':[x,.1,0]}

class FullTreeContracts(unittest.TestCase):
    def test_unpainted_head_receives_automatic_given_control(self):
        points=np.array([[0.,0,0],[1.,0,0],[2.,0,0]])
        prior=np.zeros((3,8));prior[:,0]=1
        result=module.extend_weights(points,np.array([[0,1],[1,2]]),prior,[bone('pelvis',0),bone('head',2,'pelvis')])
        weights=result['weights'];self.assertGreater(weights[2,2],.99)
        np.testing.assert_allclose(weights.sum(axis=1),1,atol=1e-12)
        self.assertEqual(result['channels'],['fixed','pelvis','head'])
    def test_rear_mobility_is_preserved_when_new_tree_adds_head(self):
        points=np.array([[0.,0,0],[1.,0,0],[2.,0,0]])
        prior=np.zeros((3,8));prior[:,0]=1;prior[0,0]=.4;prior[0,2]=.6
        names=module.JOINT_CHANNELS[1:]
        bones=[bone(name,0,None if name=='pelvis' else 'pelvis') for name in names]+[bone('head',2,'pelvis')]
        result=module.extend_weights(points,np.array([[0,1],[1,2]]),prior,bones)
        self.assertAlmostEqual(result['weights'][0,result['channels'].index('hindlimb-left-hip')],.6)
        self.assertTrue(np.all(result['weights']>=0))
    def test_unreached_material_is_named_and_carried_by_root(self):
        points=np.array([[0.,0,0],[1.,0,0],[3.,0,0]])
        prior=np.zeros((3,8));prior[:,0]=1
        result=module.extend_weights(points,np.array([[0,1]]),prior,[bone('pelvis',0),bone('head',1,'pelvis')])
        self.assertEqual(result['unknownVertices'],[2]);self.assertEqual(result['weights'][2,1],1)

    def test_one_ulp_partition_roundoff_does_not_create_negative_body_weights(self):
        points=np.array([[0.,0,0],[1.,0,0],[2.,0,0]])
        prior=np.zeros((3,8));prior[:,0]=1
        prior[0,2]=np.nextafter(1.,2.);prior[0,0]=1-prior[0,2]
        names=module.JOINT_CHANNELS[1:]
        bones=[bone(name,0,None if name=='pelvis' else 'pelvis') for name in names]+[bone('head',2,'pelvis')]
        result=module.extend_weights(points,np.array([[0,1],[1,2]]),prior,bones)
        self.assertTrue(np.all(result['weights']>=0));np.testing.assert_allclose(result['weights'].sum(axis=1),1,atol=1e-12)
        prior[0,0]=-.01;prior[0,2]=1.01
        with self.assertRaisesRegex(ValueError,'rear partition'):module.extend_weights(points,np.array([[0,1],[1,2]]),prior,bones)

if __name__=='__main__':unittest.main()
