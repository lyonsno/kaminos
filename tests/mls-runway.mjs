// kaminos-test: node
import assert from 'node:assert/strict';
import {mlsConfig,createMlsEmissionPlan,validateMlsPacket,analyzeMlsParticles} from '../mls-juice-contract.mjs';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
import {RUNWAY_INPUTS} from '../experiments/hand-jet-runway.experiment.mjs';
assert.deepEqual(RUNWAY_INPUTS.fluidGridSize,[192,80,256]);assert.equal(RUNWAY_INPUTS.jetSpeed,4.5);
const config=mlsConfig({gridSize:[192,80,256],particleCount:100});
assert.deepEqual(config.dimensions,[192,80,256]);
assert.equal(config.cell,.05,'runway must not silently coarsen the fluid');
assert.equal(config.gridCells,192*80*256);
for(const [i,v]of[-4.8,-.1,-6.4].entries())assert(Math.abs(config.min[i]-v)<1e-12);
assert.throws(()=>mlsConfig({gridSize:[192,7,256]}),/grid size/);
await assert.rejects(createMlsJuiceSolver({device:{limits:{maxStorageBufferBindingSize:10,maxBufferSize:100}},setup:{gridSize:config.grid}}),/device buffer limits/);
await assert.rejects(createMlsJuiceSolver({device:{limits:{maxComputeWorkgroupsPerDimension:10}},setup:{gridSize:config.grid}}),/dispatch limit/);
const packet=validateMlsPacket({authority:{simulation_safe:true},timestamp_ms:1000,emitters:[{
  id:'far-jet',active:true,origin_world:[3,1.5,-4],aim_world:[0,0,-1],radius:.0704,strength:4.5,lifetime_seconds:6,source_flux_particles_per_second:240
}]});
const plan=createMlsEmissionPlan(config),births=plan.step(packet,0,1000);
assert.equal(births.length,1,'rectangular runway point rejected by old cube bounds');
assert(Math.abs(Math.hypot(...births[0].velocity)*config.cell*config.modelSecondsPerSecond-4.5)<1e-12);
const native=new Float32Array(2000);native.set([180,40,240,6,0,0,0]);
assert.equal(analyzeMlsParticles(native,{capacity:100,grid:config.grid}).active,1);
native[0]=190;assert.throws(()=>analyzeMlsParticles(native,{capacity:100,grid:config.grid}),/escaped/);
// Every launch angle from the current glove neighborhood lands before the receiver's edge.
for(const height of [.5,1.5,2.5])for(let pitch=-90;pitch<=90;pitch++)for(let yaw=0;yaw<360;yaw++){
  const p=pitch*Math.PI/180,a=yaw*Math.PI/180,v=4.5,vy=v*Math.sin(p);
  const time=(vy+Math.sqrt(vy*vy+2*9.81*height))/9.81;
  const offset=[v*Math.cos(p)*Math.cos(a)*time,0,v*Math.cos(p)*Math.sin(a)*time];
  for(const i of [0,2])assert(Math.abs(offset[i])+.6+.2<Math.min(-config.bounds.min[i],config.bounds.max[i]),'receiver shorter than launch range plus glove/margin');
}
console.log('Rectangular runway preserves resolution, admission, native bounds and ballistic landing margin');
