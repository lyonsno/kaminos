# kaminos-test: python
"""A trunk surface must not become an arm merely because its back seed is far away."""
import importlib.util
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('full_binding',Path(__file__).resolve().parents[1]/'full-creature-binding.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def fixture():
    points=[];triangles=[];rings=32;levels=np.linspace(-2.,0.,9)
    for z in levels:
        for a in np.arange(rings)*2*np.pi/rings:points.append([.6*np.cos(a),.6*np.sin(a),z])
    for k in range(len(levels)-1):
        for a in range(rings):
            b=(a+1)%rings;u=k*rings+a;v=k*rings+b
            triangles.extend([[u,v,u+rings],[v,v+rings,u+rings]])
    for level in [0,len(levels)-1]:
        c=len(points);points.append([0,0,levels[level]])
        for a in range(rings):triangles.append([c,level*rings+a,level*rings+(a+1)%rings])
    # Narrow appendages continue from the lower lateral trunk, not from the belly.
    for angle in [20,28]:
        base=2*rings+angle
        previous=[base,2*rings+(angle+1)%rings]
        for y in [-.9,-1.4,-1.9]:
            pair=[]
            for v in previous:
                pair.append(len(points));points.append([points[v][0],y,points[v][2]])
            triangles.extend([[previous[0],previous[1],pair[0]],[previous[1],pair[1],pair[0]]]);previous=pair
    points=np.asarray(points);triangles=np.asarray(triangles)
    edges=np.unique(np.sort(np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]]),axis=1),axis=0)
    def bone(name,p,parent=None):
        matrix=np.eye(4);matrix[:3,3]=p
        return {'name':name,'parent':parent,'restMatrix':matrix.tolist(),'tail':(np.asarray(p)+[0,0,.1]).tolist()}
    bones=[bone('pelvis',[0,.35,0]),bone('spine-lumbar',[0,.35,-.75],'pelvis'),bone('spine-chest',[0,.35,-1.5],'spine-lumbar')]
    for side,x in [('left',-.424264),('right',.424264)]:
        for joint,y,parent in [('shoulder',-.2,'spine-chest'),('elbow',-.9,f'forelimb-{side}-shoulder'),('wrist',-1.4,f'forelimb-{side}-elbow'),('toe',-1.9,f'forelimb-{side}-wrist')]:
            bones.append(bone(f'forelimb-{side}-{joint}',[x,y,-1.5],parent))
    prior=np.zeros((len(points),8));prior[:,0]=1
    return points,triangles,edges,prior,bones

class TrunkAnchorContracts(unittest.TestCase):
    def test_ventral_trunk_is_carried_by_axial_controls_without_paint(self):
        p,t,e,w,b=fixture()
        if hasattr(module,'distributed_trunk_weights'):
            result=module.distributed_trunk_weights(p,t,e,w,b)
        else:
            # Exercise pre-change production behavior, not a missing-import failure.
            result=module.extend_weights(p,e,w,b)
        belly=5*32+24 # z=-.75, centered underside, well behind the forelimbs
        axial=[result['channels'].index(n) for n in ['pelvis','spine-lumbar','spine-chest']]
        self.assertGreater(result['weights'][belly,axial].sum(),.9,'single dorsal seeds let forelimbs acquire the belly')

    def test_distal_limbs_still_articulate_and_partition_stays_complete(self):
        p,t,e,w,b=fixture()
        result=module.distributed_trunk_weights(p,t,e,w,b) if hasattr(module,'distributed_trunk_weights') else module.extend_weights(p,e,w,b)
        np.testing.assert_allclose(result['weights'].sum(axis=1),1,atol=1e-12)
        self.assertTrue(np.isfinite(result['weights']).all());self.assertTrue((result['weights']>=0).all())
        for side,v in [('left',len(p)-7),('right',len(p)-1)]:
            fore=[i for i,n in enumerate(result['channels']) if n.startswith('forelimb-'+side+'-')]
            self.assertGreater(result['weights'][v,fore].sum(),.9)

    def test_non_target_channels_are_bitwise_preserved(self):
        channels=['fixed','pelvis','spine-lumbar','spine-chest','forelimb-left-shoulder','head','hindlimb-left-hip']
        baseline=np.array([[0,.15,.15,.1,.1,.2,.3],[0,0,0,0,0,1,0]],dtype=np.float32)
        proposed=np.array([[0,.1,.8,.1,0,0,0],[0,.1,.8,.1,0,0,0]])
        result=module.preserve_nontrunk_channels(proposed,baseline,channels)
        np.testing.assert_array_equal(result[:,[0,5,6]],baseline[:,[0,5,6]])
        np.testing.assert_allclose(result.sum(axis=1),1,atol=1e-7)
        np.testing.assert_array_equal(result[1],baseline[1])

if __name__=='__main__':unittest.main()
