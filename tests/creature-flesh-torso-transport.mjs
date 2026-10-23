// kaminos-test: node
import assert from 'node:assert/strict';
import * as torso from '../experiments/creature-flesh/torso.mjs';
assert.equal(typeof torso.torsoNodeWeights,'function','The physical proxy needs an explicit torso-only attachment, independent of nearest surface limb weights');
const channels=['fixed','pelvis','spine-lumbar','spine-chest','forelimb'];
const prepared={positions:Array.from({length:45},()=>[0,0,0]),construction:{sections:5,crossSection:3}};
const w=torso.torsoNodeWeights(prepared,channels);
assert.equal(w.length,45*5);
for(let i=0;i<45;i++){
 assert.equal(w[i*5],0);assert.equal(w[i*5+4],0);
 assert.ok(Math.abs(w.slice(i*5,i*5+5).reduce((a,b)=>a+b,0)-1)<1e-7);
 assert.deepEqual(w.slice(i*5,i*5+5),w.slice(Math.floor(i/9)*45,Math.floor(i/9)*45+5));
}
assert.deepEqual(Array.from(w.slice(0,5)),[0,1,0,0,0]);
assert.deepEqual(Array.from(w.slice(22*5,23*5)),[0,0,1,0,0]);
assert.deepEqual(Array.from(w.slice(44*5,45*5)),[0,0,0,1,0]);
assert.throws(()=>torso.torsoNodeWeights(prepared,['pelvis','spine-chest']),/family/);
