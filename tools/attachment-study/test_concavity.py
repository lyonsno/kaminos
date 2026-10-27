import unittest
import subprocess,tempfile,json,pathlib
import numpy as np
from concavity import edge_penalty,redistribute

class ConcavityContract(unittest.TestCase):
    def test_concave_valley_adds_cost_but_convex_bend_does_not(self):
        p=np.array([[-1.,0,0],[1.,0,0]])
        valley=np.array([[.6,0,.8],[-.6,0,.8]])
        edge=np.array([[0,1]])
        self.assertAlmostEqual(edge_penalty(p,valley,edge,2.)[0],2.4)
        self.assertEqual(edge_penalty(p,-valley,edge,2.)[0],0.)
    def test_flat_and_zero_gain_are_baseline(self):
        p=np.array([[0.,0,0],[1.,0,0]]); e=np.array([[0,1]])
        self.assertEqual(edge_penalty(p,np.array([[0.,0,1],[0,0,1]]),e,1.)[0],0.)
        self.assertEqual(edge_penalty(p,np.array([[1.,0,0],[-1,0,0]]),e,1.,gain=0)[0],0.)

    def test_rigid_frame_invariance(self):
        p=np.array([[-1.,0,0],[1.,0,0]]);n=np.array([[.6,0,.8],[-.6,0,.8]]);e=np.array([[0,1]])
        rot=np.array([[0.,-1,0],[1,0,0],[0,0,1]])
        np.testing.assert_allclose(edge_penalty(p,n,e,2),edge_penalty(p@rot+10,n@rot,e,2))
    def test_transfer_conserves_budget_and_preserves_other_regions(self):
        channels=['fixed','spine-chest','neck']+['forelimb-'+s+'-'+j for s in ['left','right'] for j in ['shoulder','elbow','wrist','toe']]
        w=np.zeros((2,len(channels)));w[:,0]=.1;w[:,1]=.2;w[:,2]=.1;w[:,3]=.6
        result=redistribute(w,channels,{'left':np.array([.5,1.])})
        np.testing.assert_allclose(result.sum(axis=1),w.sum(axis=1));np.testing.assert_array_equal(result[:,[0,2]],w[:,[0,2]])
        self.assertAlmostEqual(result[0,1],.5);self.assertAlmostEqual(result[0,3],.3);np.testing.assert_array_equal(result[1],w[1])
        with self.assertRaises(ValueError):redistribute(w,channels,{'left':np.array([np.nan,1])})

class BuildProvenance(unittest.TestCase):
    def test_source_revision_is_independent_of_calling_directory(self):
        script=pathlib.Path(__file__).with_name('build.py').resolve();repo=script.parents[2]
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);inp=root/'inputs.json';inp.write_text('[]')
            p=subprocess.run([__import__('sys').executable,str(script),'--inputs',str(inp),'--out',str(root/'out')],cwd=root,capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
            d=json.loads((root/'out/report.json').read_text());self.assertEqual(d['sourceRoot'],str(repo));self.assertEqual(d['sourceRevision'],subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip())
    def test_missing_input_retains_failure_report(self):
        script=pathlib.Path(__file__).with_name('build.py').resolve()
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);p=subprocess.run([__import__('sys').executable,str(script),'--inputs',str(root/'missing.json'),'--out',str(root/'out')],capture_output=True,text=True)
            self.assertNotEqual(p.returncode,0);self.assertTrue((root/'out/report.json').exists(),'Missing initialization failure report')
            d=json.loads((root/'out/report.json').read_text());self.assertEqual(d['status'],'failed');self.assertEqual(d['phase'],'input-provenance');self.assertIn('FileNotFoundError',d['error'])

if __name__=='__main__': unittest.main()
