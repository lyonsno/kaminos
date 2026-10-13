import fs from 'node:fs';import assert from 'node:assert/strict';
assert.ok(fs.existsSync(new URL('../experiments/lazarus-fluid/finite-pbf.experiment.mjs',import.meta.url)),'Finite PBF must contribute a discovered owner module');
const {lazarusFiniteSetup}=await import('../experiments/lazarus-fluid/contributions.mjs');
for(const scene of ['block_drop','dam_break','block_flop'])for(const resolution of [16,24,32]){
 const s=lazarusFiniteSetup({scene,resolution});assert.equal(s.dt,1/240);assert.equal(s.solver.pressureSolver,'pbf');assert.equal(s.solver.diagnosticDynamics,'assembled');assert.ok(Math.abs(s.sampling.worldVolume-(scene==='block_flop'?1.375:1))<1e-12);
}
assert.throws(()=>lazarusFiniteSetup({dt:1/1000}),/timestep/);
assert.throws(()=>lazarusFiniteSetup({rate:0}),/positive/);
const {createOwnerWaterCapability}=await import('../fluid-owner-host.mjs');let applied;
const water=createOwnerWaterCapability({state:()=>({available:true,generation:1}),debug:()=>({pressureSolver:'pbf'}),pressure:()=>({available:false}),material:()=>({available:true}),applyMaterial:p=>(applied=p),pause:()=>{},advance:()=>{},restart:()=>{},dispose:()=>{},playback:()=>1,setPlaybackRate:x=>x});
assert.equal(water.getSolver().getMaterialControls().available,true);water.applyMaterial({capillaryStrength:.4});assert.deepEqual(applied,{capillaryStrength:.4});assert.equal(water.setPlaybackRate(2),2);
console.log('Owner finite config and generic material/playback capability pass');
