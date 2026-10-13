import unittest
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hindquarter_binding import bind_geometry, solve_pose

class IndependentBindingTests(unittest.TestCase):
    def setUp(self):
        self.positions = np.array([[-.25, .15, .2],[-.25,-.4,-.2],[-.3,-.9,-.5],[.3,-.9,-.5],[.2,.4,-1.2]],dtype=float)
        self.triangles = np.array([[0,1,2],[1,2,3],[0,1,4]],dtype=np.uint32)
        self.control = {'paintedWeightsIncluded':False,'joints':{'pelvis':[.18,.28,-.25],
            'hindlimb-left-hip':[0,0,0],'hindlimb-left-stifle':[-.16,-.8,-.57],'hindlimb-left-hock':[-.08,-1.49,-.14],
            'hindlimb-right-hip':[.37,0,0],'hindlimb-right-stifle':[.53,-.8,-.57],'hindlimb-right-hock':[.45,-1.49,-.14]},
            'bounds':{'min':[-.5,-2.4,-3.2],'max':[.9,1.1,1.1]}}

    def test_neutral_is_exact_own_rest_shape(self):
        binding=bind_geometry(self.positions,self.triangles,self.control)
        result=solve_pose(binding,{'movingMatrix':np.eye(4).tolist()})
        np.testing.assert_allclose(result['candidate'],self.positions,atol=1e-10)
        self.assertTrue(np.all(np.isfinite(binding['weights'])))
        self.assertTrue(np.all((binding['weights']>=0)&(binding['weights']<=1)))
        self.assertEqual(binding['triangles'].tolist(),self.triangles.tolist())

    def test_painted_weights_and_bad_topology_rejected(self):
        with self.assertRaisesRegex(ValueError,'painted'):
            bind_geometry(self.positions,self.triangles,{**self.control,'paintedWeightsIncluded':True})
        with self.assertRaisesRegex(ValueError,'topology'):
            bind_geometry(self.positions,np.array([[0,1,99]]),self.control)

    def test_pose_moves_distal_skin_and_preserves_geometry_identity(self):
        binding=bind_geometry(self.positions,self.triangles,self.control)
        angle=.5
        matrix=np.eye(4);matrix[1:3,1:3]=[[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]]
        result=solve_pose(binding,{'movingMatrix':matrix.tolist()})
        self.assertEqual(result['candidate'].shape,self.positions.shape)
        self.assertTrue(np.all(np.isfinite(result['candidate'])))
        self.assertGreater(np.linalg.norm(result['candidate'][2]-self.positions[2]),.05)
        restored=solve_pose(binding,{'movingMatrix':np.eye(4).tolist()})
        np.testing.assert_allclose(restored['candidate'],self.positions,atol=1e-10)

    def test_unrepresented_front_limb_remains_outside_regional_domain(self):
        positions=np.vstack([self.positions,[0,-1.2,-2.7]])
        triangles=np.vstack([self.triangles,[1,4,5]])
        binding=bind_geometry(positions,triangles,self.control)
        angle=.5;matrix=np.eye(4);matrix[1:3,1:3]=[[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]]
        result=solve_pose(binding,{'movingMatrix':matrix.tolist()})
        np.testing.assert_allclose(result['candidate'][-1],positions[-1],atol=1e-10)
        self.assertEqual(binding['domain'][-1],0)

    def test_regional_domain_does_not_end_halfway_through_distal_foot(self):
        positions=np.vstack([self.positions,[-.15,-2.34,-.14]])
        triangles=np.vstack([self.triangles,[1,2,5]])
        binding=bind_geometry(positions,triangles,self.control)
        self.assertEqual(binding['domain'][-1],1)

    def test_unknown_domain_method_must_not_silently_fall_back(self):
        with self.assertRaisesRegex(ValueError,'domain method'):
            bind_geometry(self.positions,self.triangles,{**self.control,'domainMethod':'unknown'})

    def test_surface_domain_follows_seeded_limb_component(self):
        positions=np.array([[-.14,-2.31,-.14],[-.2,-1.2,-.3],[-.24,-.45,-.3],
                            [.51,-2.31,-.14],[.63,-1.2,-.3],[.67,-.45,-.3],
                            [.3,-1.5,-2.8],[.1,-1.2,-2.9],[.4,-1.,-3.],
                            [.18,.58,-.7],[.3,.6,-.6],[.4,.5,-.5]])
        triangles=np.array([[0,1,2],[3,4,5],[6,7,8],[9,10,11]])
        binding=bind_geometry(positions,triangles,{**self.control,'domainMethod':'surface'})
        np.testing.assert_array_equal(binding['domain'][:3],np.ones(3))
        np.testing.assert_array_equal(binding['domain'][3:],np.zeros(9))

if __name__=='__main__':unittest.main()
