// kaminos-test: node
import assert from 'node:assert/strict';
import {createFleshVolume} from '../experiments/creature-flesh/volume.mjs';
const source={positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],pinned:[true,false,true,true]};
const v=createFleshVolume(source,{iterations:12});
v.step(1/60);assert.ok(v.read().maxDisplacement<1e-12);
v.setSphere({center:[1.2,0,0],radius:.4});for(let i=0;i<30;i++)v.step(1/60);
assert.ok(v.points()[1][0]<.95,'sphere contact compresses the elastic element');
assert.ok(v.read().minJ>0,'accepted state never inverts');
assert.deepEqual(v.points()[0],source.positions[0]);
v.setSphere(null);for(let i=0;i<90;i++)v.step(1/60);
assert.ok(Math.abs(v.points()[1][0]-1)<.015,'elastic response recovers after release');
v.setEnabled(false);assert.equal(v.read().maxDisplacement,0);
const state=v.read();assert.throws(()=>v.step(0),/timestep/);assert.equal(v.read().steps,state.steps);
assert.throws(()=>v.setTargets([[0,0,0]]),/targets/);
assert.throws(()=>v.setSphere({center:[NaN,0,0],radius:1}),/sphere/);
console.log('held-pose contact, recovery, pins, no-contact baseline and input refusal');
