# kaminos-test: python
"""The corrected paw must articulate without rebinding the accepted trunk."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('full_binding',Path(__file__).resolve().parents[1]/'full-creature-binding.py')
full=importlib.util.module_from_spec(spec);spec.loader.exec_module(full)

def fixture():
    rows=[('pelvis',None,[0,1,0])]
    for side,z in [('left',0),('right',3)]:
        for joint,x,parent in [('hip',0,'pelvis'),('stifle',1,f'hindlimb-{side}-hip'),('hock',2,f'hindlimb-{side}-stifle')]:
            rows.append((f'hindlimb-{side}-{joint}',parent,[x,-2,z]))
    rows += [('spine-lumbar','pelvis',[2,1,0]),('spine-chest','spine-lumbar',[4,1,0]),('neck','spine-chest',[5,1,0]),('head','neck',[6,1,0]),('head-end','head',[7,1,0])]
    for side,z in [('left',0),('right',3)]:
        for joint,x,parent in [('shoulder',4,'spine-chest'),('elbow',4.5,f'forelimb-{side}-shoulder'),('wrist',5,f'forelimb-{side}-elbow'),('toe',5.8,f'forelimb-{side}-wrist')]:
            rows.append((f'forelimb-{side}-{joint}',parent,[x,-2,z]))
    rows += [(f'hindlimb-{s}-toe',f'hindlimb-{s}-hock',[2.8,-2,z]) for s,z in [('left',0),('right',3)]]
    rows += [(f'tail-{i}','pelvis' if i==1 else f'tail-{i-1}',[-i,1,0]) for i in range(1,7)]
    old=[]
    for name,parent,head in rows:
        matrix=np.eye(4);matrix[:3,3]=head
        old.append({'name':name,'parent':parent,'restMatrix':matrix.tolist(),'tail':(np.asarray(head)+[0,.1,0]).tolist()})
    new=[]
    for bone in old:
        b=copy.deepcopy(bone)
        if b['name'].endswith('-toe'):
            b['restMatrix'][0][3]+=.2;b['tail']=[b['restMatrix'][0][3]+1,b['restMatrix'][1][3],b['restMatrix'][2][3]]
        new.append(b)
        if b['name'].endswith('-toe'):
            endpoint=copy.deepcopy(b);endpoint['name']+='-end';endpoint['parent']=b['name']
            for k in range(3):endpoint['restMatrix'][k][3]=b['tail'][k]
            endpoint['tail']=(np.asarray(b['tail'])+[0,.1,0]).tolist();new.append(endpoint)
    points=np.array([[x,-2,0] for x in range(4,9)],dtype=float);edges=np.array([[i,i+1] for i in range(4)])
    channels=['fixed']+[b['name'] for b in old];weights=np.zeros((len(points),len(channels)),dtype=np.float32)
    for name,share in [('spine-chest',.1),('forelimb-left-wrist',.45),('forelimb-left-toe',.45)]:weights[:,channels.index(name)]=share
    return points,edges,weights,old,new

def rebind(points,edges,weights,old,new):
    if hasattr(full,'rebind_complete_paws'):return full.rebind_complete_paws(points,edges,weights,old,new)
    # Pre-change production can extend a tree, but gives the new leaf nodes
    # body influence and rebuilds unrelated attachment. This is not an import
    # failure or a fabricated substitute for its actual behavior.
    rear=np.zeros((len(points),8));rear[:,0]=1
    return full.extend_weights(points,edges,rear,new)

class PawBindingContracts(unittest.TestCase):
    def test_endpoints_have_no_own_influence_and_body_channels_stay_exact(self):
        p,e,w,old,new=fixture();r=rebind(p,e,w,old,new)
        self.assertEqual(len(old),28);self.assertEqual(len(new),32)
        for n in [b['name'] for b in new if b['name'].endswith('-toe-end')]:
            self.assertTrue(np.all(r['weights'][:,r['channels'].index(n)]==0),'a geometric toe endpoint acquired its own skin')
        old_channels=['fixed']+[b['name'] for b in old]
        changed={f'{limb}-{s}-{j}' for limb,parent in [('hindlimb','hock'),('forelimb','wrist')] for s in ['left','right'] for j in [parent,'toe']}
        for n in old_channels:
            if n not in changed:np.testing.assert_array_equal(r['weights'][:,r['channels'].index(n)],w[:,old_channels.index(n)])
        for s in ['left','right']:
            for limb,parent in [('hindlimb','hock'),('forelimb','wrist')]:
                pair=[f'{limb}-{s}-{parent}',f'{limb}-{s}-toe']
                np.testing.assert_allclose(r['weights'][:,[r['channels'].index(n) for n in pair]].sum(axis=1),w[:,[old_channels.index(n) for n in pair]].sum(axis=1),rtol=0,atol=1e-7)
        self.assertTrue(np.isfinite(r['weights']).all());self.assertTrue((r['weights']>=0).all());np.testing.assert_allclose(r['weights'].sum(axis=1),w.sum(axis=1),atol=1e-7)

    def test_neutral_and_parent_motion_preserve_the_accepted_surface(self):
        p,e,w,old,new=fixture();r=rebind(p,e,w,old,new)
        for pose in [{},{'forelimb-left-wrist':[np.cos(.2),0,0,np.sin(.2)]}]:
            a=full.partial_rotation(p,full.palette(old,pose),w)
            b=full.partial_rotation(p,full.palette(new,pose),r['weights'])
            np.testing.assert_allclose(a,b,rtol=0,atol=1e-6)
        pose={'forelimb-left-toe':[np.cos(.2),0,0,np.sin(.2)]}
        bent=full.partial_rotation(p,full.palette(new,pose),r['weights'])
        self.assertGreater(r['weights'][3,r['channels'].index('forelimb-left-toe')],.8)
        self.assertGreater(bent[3,1]-p[3,1],.2,'distal paw does not bend about its relocated toe')

    def test_refuses_unrelated_tree_edits_or_nonterminal_added_joints(self):
        for edit in ['trunk','missing','parent','rotated-endpoint']:
            p,e,w,old,new=fixture()
            if edit=='trunk':next(b for b in new if b['name']=='spine-chest')['restMatrix'][0][3]+=.1
            if edit=='missing':new.pop()
            if edit=='parent':next(b for b in new if b['name']=='forelimb-left-toe-end')['parent']='pelvis'
            if edit=='rotated-endpoint':next(b for b in new if b['name']=='forelimb-left-toe-end')['restMatrix'][0][0]=-1
            with self.subTest(edit=edit),self.assertRaises(ValueError):rebind(p,e,w,old,new)

if __name__=='__main__':unittest.main()
