// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as world from '../volume-world-smoke.mjs';
const parcel={lo:[.25,.25,.25],hi:[.75,.75,.75],rate:.2,fuel:.5,heat:1.2,relax:.4,velocity:[0,.1,0]};
const sum=(rows,pitch)=>Array.from({length:rows.length/8},(_,i)=>rows[i*8]*pitch**3).reduce((a,b)=>a+b,0);
test('source volume is independent of receiving cell size and does not renormalize clipped support',()=>{
 assert.equal(typeof world.depositWorldSources,'function','world fields must accept spatial source supply');
 for(const n of [2,4,9]){
  const d=world.depositWorldSources([parcel],{dims:[n,n,n],min:[0,0,0],pitch:1/n});
  assert.ok(Math.abs(sum(d,1/n)-.2*.5**3)<1e-8);
 }
 const d=world.depositWorldSources([parcel],{dims:[4,4,4],min:[.5,0,0],pitch:.25});
 assert.ok(Math.abs(sum(d,.25)-.1*.5**3)<1e-8,'only half of the source is inside the field');
});
test('overlapping sources retain additive supply and weighted mixture; removing sources clears the field',()=>{
 assert.equal(typeof world.depositWorldSources,'function');
 const grid={dims:[2,2,2],min:[0,0,0],pitch:.5};
 const a=world.depositWorldSources([parcel],grid),both=world.depositWorldSources([parcel,{...parcel,fuel:1}],grid);
 for(let i=0;i<a.length;i+=8){assert.ok(Math.abs(both[i]-2*a[i])<1e-7);assert.ok(Math.abs(both[i+1]-both[i]*.75)<1e-7);}
 assert.ok(world.depositWorldSources([],grid).every(v=>v===0));
});

import {MaterialHierarchy} from '../volume-material-hierarchy.mjs';
import {depositHierarchySources,sourceDemandAt} from '../volume-world-sources.mjs';
test('source deposition is conserved across leaf levels and partial edge bricks',()=>{
 const plan={materialDims:[5,4,4],materialPitch:.2,min:[0,0,0],max:[1,.8,.8]};
 const supply={...parcel,lo:[.7,.1,.1],hi:[1.2,.7,.7]};
 for(const budget of [0,8,40]){
  const h=new MaterialHierarchy({dims:plan.materialDims,options:{budget,maxDetail:3}});
  const t=h.allocate(new Map(),n=>sourceDemandAt(n,[{...supply,heat:1,fuel:1}],plan));
  const nodes=t.nodes.map(n=>({...n,pitch:plan.materialPitch/2**n.level,lo:n.c.map(c=>c*4*plan.materialPitch/2**n.level)}));
  const data=depositHierarchySources([supply],nodes,t.capacity,plan);
  let q=0;for(const n of nodes.filter(n=>!n.children))q+=sum(data.subarray(n.slot*512,(n.slot+1)*512),n.pitch);
  assert.ok(Math.abs(q-.2*.3*.6*.6)<1e-8,`supply integral at budget ${budget}`);
  for(const n of nodes.filter(n=>n.children))assert.ok(data.subarray(n.slot*512,(n.slot+1)*512).every(v=>v===0),'parents never inject a second copy');
 }
});
test('cold source demand stays local through successive refinement and disappears with its source',()=>{
 const plan={materialDims:[8,4,4],materialPitch:1,min:[0,0,0],max:[8,4,4]},support={lo:[.2,.2,.2],hi:[.3,.3,.3],heat:1,fuel:1};
 const h=new MaterialHierarchy({dims:plan.materialDims,options:{budget:12,maxDetail:3}});
 const t=h.allocate(new Map(),n=>sourceDemandAt(n,[support],plan));
 assert.ok(t.nodes.some(n=>n.level===3),'a cold source can acquire fine cells before measurement');
 for(const n of t.nodes.filter(n=>n.children))assert.ok(sourceDemandAt(n,[support],plan).thermal>0,'birth demand must not smear into unrelated siblings');
 assert.equal(h.allocate(new Map(),n=>sourceDemandAt(n,[],plan)).nodes.length,h.roots.length);
});
