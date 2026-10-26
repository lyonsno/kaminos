// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as reach from '../mineral-worlds/reach.mjs';
test('reach stores nested deposit features and stratigraphy independently of a render grid',()=>{
 const s=reach.createReach({size:12,seed:17});
 assert.equal(s.representation,'sparse-nested-mineral-reach-v1','missing retained sparse material');
 reach.advanceReach(s,160);
 assert.ok(s.features.some(f=>f.level===1),'local deposition must develop child features');
 assert.ok(s.layers.length>1,'deposition composition history must be retained');
 assert.ok(Math.abs(reach.readReach(s).mineralError)<1e-8);
 assert.ok(s.features.every(f=>f.volume>=0&&Number.isFinite(f.volume)));
});
test('material save/continue is deterministic and retains exact local history',()=>{
 const a=reach.createReach({size:10});reach.advanceReach(a,60);
 reach.conditions(a,{mineral:1.8});reach.advanceReach(a,40);
 const b=reach.restoreReach(reach.saveReach(a));
 reach.advanceReach(a,20);reach.advanceReach(b,20);
 assert.deepEqual(reach.saveReach(a),reach.saveReach(b));
 const broken=reach.saveReach(a);broken.features[0].volume=-1;
 assert.throws(()=>reach.restoreReach(broken),/feature|volume/i);
});
test('conditions act on future growth and rejection is atomic',()=>{
 const s=reach.createReach({size:10});reach.advanceReach(s,40);
 const before=reach.saveReach(s);
 assert.throws(()=>reach.conditions(s,{supply:2,mineral:NaN}),/condition/i);
 assert.deepEqual(reach.saveReach(s),before);
 reach.conditions(s,{mineral:2});
 assert.deepEqual(reach.saveReach(s).features,before.features);
 assert.equal(s.tick,before.tick);
});
test('compact kernel integrates to retained volume and children affect sampled terrain',()=>{
 const s=reach.createReach({size:8});
 s.features=[{id:0,parent:null,level:0,x:0,z:0,rx:1,rz:1,angle:0,volume:.5,layers:[.5]}];
 let integral=0;const n=160,d=2/n;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++)integral+=reach.depositAt(s,-1+(x+.5)*d,-1+(z+.5)*d)*d*d;
 assert.ok(Math.abs(integral-.5)<1e-5);
 const h=reach.depositAt(s,0,0);
 s.features.push({id:1,parent:0,level:1,x:0,z:0,rx:.2,rz:.2,angle:0,volume:.02,layers:[.02]});
 assert.ok(reach.depositAt(s,0,0)>h);
});
