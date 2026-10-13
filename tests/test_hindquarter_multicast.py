# kaminos-test: python
import importlib.util
from pathlib import Path
import unittest
import sys
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('multicast',Path(__file__).resolve().parents[1]/'hindquarter-multicast-build.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FrameContracts(unittest.TestCase):
    def setUp(self):
        self.control={'unitsPerFemur':2.,'sourceSha256':'scene','joints':{'hindlimb-left-hip':[0,0,0]}}
        self.plan={'anatomy_to_rear_frame':[-10,0,0], 'source':{'scene.blend':'scene','anatomy.glb':'anatomy'},
                   'joints':[{'name':'pelvis','head':[0,1,0]},{'name':'hindlimb-left-hip','head':[-1,0,0]},
                             {'name':'hindlimb-right-hip','head':[1,0,0]}]}
        self.hierarchy={'source':{'skeletonSha256':'anatomy'},'controls':[
            {'name':'pelvis','pivot':[10,0,-1]}, {'name':'hindlimb-left-hip','pivot':[11,0,0]},
            {'name':'hindlimb-right-hip','pivot':[9,0,0]}]}
        self.frame={'inputs':{'sourceSha256':'anatomy','envelopeSha256':'envelope'},
                    'link':{'transform':{'rotation':np.eye(3).tolist(),'translation':[0,0,0]}}}
        self.package={'source':{'skeletonSha256':'anatomy','envelopeSha256':'envelope',
                       'comparisonFrame':{'frame':'frozen-envelope-baseline','operation':'inverse-cast-registration'}},
                      'cast':{'positions':[10,0,0,12,0,0,10,0,2],'triangles':[0,1,2]},
                      'skinBinding':'POISON','castBinding':'POISON'}
    def test_receipted_axis_translation_scale_without_old_binding(self):
        points,triangles,receipt=module.prepare_geometry(self.package,self.frame,self.hierarchy,self.plan,self.control)
        np.testing.assert_allclose(points,[[.5,0,0],[1.5,0,0],[.5,0,-1]])
        np.testing.assert_array_equal(triangles,[[0,1,2]])
        self.assertEqual(receipt['anchorMapping'][1]['currentControl'],'hindlimb-right-hip')
    def test_misregistered_anchors_fail_before_binding(self):
        self.plan['anatomy_to_rear_frame']=[0,0,0]
        with self.assertRaisesRegex(ValueError,'anchor'):module.prepare_geometry(self.package,self.frame,self.hierarchy,self.plan,self.control)
    def test_wrong_frame_identity_fails(self):
        self.package['source']['comparisonFrame']['frame']='cast-local'
        with self.assertRaisesRegex(ValueError,'frame'):module.prepare_geometry(self.package,self.frame,self.hierarchy,self.plan,self.control)
    def test_wrong_anatomical_source_fails(self):
        self.frame['inputs']['sourceSha256']='other'
        with self.assertRaisesRegex(ValueError,'source'):module.prepare_geometry(self.package,self.frame,self.hierarchy,self.plan,self.control)

if __name__=='__main__':unittest.main()
