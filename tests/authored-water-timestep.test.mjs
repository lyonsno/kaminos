// kaminos-test: node
import assert from 'node:assert/strict';
import {defaultLocalLiquidSetup,normalizeLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {authoredDropSetup} from '../authored-water-host.mjs';
import {createFiniteFluidHost} from '../finite-fluid-host.mjs';
const saved=normalizeLocalLiquidSetup({...defaultLocalLiquidSetup(),simulationStepSeconds:1/120});
assert.equal(saved.simulationStepSeconds,1/120,'Saved water setup must retain the requested physics timestep');
assert.equal(normalizeLocalLiquidSetup(JSON.parse(JSON.stringify(saved))).simulationStepSeconds,1/120);
for(const v of [null,0,-1,NaN,Infinity,'0.008333'])assert.throws(()=>normalizeLocalLiquidSetup({...saved,simulationStepSeconds:v}),/timestep/i);
const rows=[{id:'A',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:32}}}];
assert.equal(authoredDropSetup(rows,{}).dt,1/240,'Legacy scenes retain the previous timestep');
for(const dt of [1/480,1/240,1/120,1/60,1/30,1/15]){
 const setup=authoredDropSetup(rows,{simulationStepSeconds:dt,densityIterations:2});
 assert.equal(setup.dt,dt,'Authored timestep must reach the real finite host');assert.equal(setup.playbackRate,1,'Physics timestep must not change playback speed');
 let options;const steps=[];
 const host=await createFiniteFluidHost({setup,device:{queue:{onSubmittedWorkDone:async()=>{}}},createSolver:async o=>{options=o;return {available:true,step:d=>steps.push(d),getDebugState:()=>({}),destroy(){}};},createPresentation:()=>({render(){},state:()=>({}),dispose(){}})});
 assert.equal(options.simulationStepSeconds,dt);await host.advanceTo(2);assert.deepEqual(steps,[dt,dt]);assert.equal(host.state().clock.timeSeconds,2*dt);assert.equal(host.state().clock.playbackRate,1);host.dispose();
}
for(const v of [null,0,NaN,Infinity,1e-100,1e100])assert.throws(()=>authoredDropSetup(rows,{simulationStepSeconds:v}),/timestep/i);
console.log('Finite-water timestep persists and reaches allocation, stepping and simulated time independently of playback rate');
