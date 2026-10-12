import assert from 'node:assert/strict';
import {createFingerFluidBoxReference as fixture} from '../finger-fluid-box-fixtures.mjs';
import {viscosityScale as scale} from '../finger-fluid-viscosity-scale.mjs';
import {targetStep} from '../finger-fluid-box-clock.mjs';
for(const scene of ['block_drop','dam_break','block_flop'])for(const resolution of [16,24,32]){
 const f=fixture({scene,resolution});assert.ok(Math.abs(f.representedVolume-(scene==='block_flop'?1.375:1))<1e-12);
 for(let i=0;i<f.particleCount;i++){const row=f.population.particleData.subarray(i*16,i*16+16);assert.deepEqual([...row.subarray(0,3)],[...row.subarray(4,7)]);assert.ok(row[11]>=.15);assert.deepEqual([...row.subarray(8,11)],[0,0,0]);}
}
assert.equal(scale('nominal_diffusion',1/60,.185),1);
assert.equal(scale('nominal_diffusion',1/120,.185),.5);
assert.equal(scale('nominal_diffusion',1/240,.185/2),1);
assert.equal(scale('legacy',1/240,.185/2),1);
assert.throws(()=>scale('nominal_diffusion',1/60,.185/3),/convex/);
assert.throws(()=>scale('fallback',1/60,.185),/mode/);
assert.equal(targetStep(.5,1/240),120);assert.equal(targetStep(.5,1/120),60);
assert.throws(()=>targetStep(.501,1/240),/multiple/);assert.throws(()=>targetStep(.5,1/240,121),/backward/);
console.log('Equal-volume finite fixtures, nominal scaling and exact-time targets pass');
