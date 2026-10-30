# kaminos-test: python
import importlib.util
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
assay=module(ROOT/'tools/reference-skin/inner_arm_anchor_assay.py','inner_arm_assay')

def test_midline_side_and_opposite_limb_refusal():
    # Actual retained ray implementation is caller-supplied. This deterministic
    # analytic stand-in tests the probe frames and seed admission, not ray math.
    class Trunk: AXIAL=('pelvis','spine-lumbar','spine-chest')
    trunk=Trunk();original=trunk.AXIAL;bones=[]
    for side,x in [('left',-2.),('right',2.)]:
        for role,y in [('shoulder',1.),('elbow',0.),('wrist',-1.)]:
            m=np.eye(4);m[:3,3]=[x,y,0];bones.append({'name':f'forelimb-{side}-{role}','restMatrix':m.tolist()})
    directions=[]
    def ray(points,triangles,probes):
        assert trunk.AXIAL==('probe','endpoint')
        m=np.asarray(probes[0]['restMatrix']);o=m[:3,3];d=m[:3,0];directions.append((o.copy(),d.copy()))
        # Right-side failure deliberately returns a hit on the opposite limb.
        distance=.4 if o[0]<0 else 3.6
        return {},{'rays':[{'bone':'probe','angularSample':0,'status':'hit','origin':o.tolist(),'direction':d.tolist(),'distance':distance,'point':(o+distance*d).tolist(),'vertex':0,'triangle':0}]}
    seeds,receipt=assay.inner_anchors(np.array([[-1.6,0.,0.]]),np.array([[0,0,0]]),bones,trunk,ray)
    assert len(receipt)==4, 'both arm segments on both sides must be evaluated'
    assert set(seeds)=={'forelimb-left-shoulder','forelimb-left-elbow'}
    assert all(x['status']=='rejected-cross-midplane' for x in receipt if '-right-' in x['bone'])
    assert all(np.allclose(d,[1 if o[0]<0 else -1,0,0]) for o,d in directions)
    assert sorted(round(o[1],2) for o,d in directions)==[-.55,-.55,.45,.45]
    assert trunk.AXIAL==original
    def failed(*args):raise ValueError('ray failure')
    try:assay.inner_anchors(np.array([[-1.6,0.,0.]]),np.array([[0,0,0]]),bones,trunk,failed)
    except ValueError:pass
    else:raise AssertionError('ray failure must propagate')
    assert trunk.AXIAL==original

if __name__=='__main__':
    test_midline_side_and_opposite_limb_refusal()
    print('Inner arm probe frames and opposite-limb rejection passed')
