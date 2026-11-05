// kaminos-test: node
import assert from 'node:assert/strict';
import {createMlsClock,createMlsEmissionPlan,mlsConfig} from '../mls-juice-contract.mjs';
const clock=createMlsClock(1/240);clock.observe(0,true);
assert.equal(typeof clock.advanceSteps,'function','authored paused stepping needs an exact physical-step path');
clock.advanceSteps(12);assert.equal(clock.read().step,12);assert.equal(clock.read().simulatedSeconds,.05);
clock.observe(9000,true);assert.equal(clock.advance(9000),0,'manual stepping must not admit paused wall time');
assert.throws(()=>clock.advanceSteps(-1),/step/);
const config=mlsConfig({particleCount:3}),plan=createMlsEmissionPlan(config);plan.reserveInitial(2);
const packet={authority:{simulation_safe:true},timestamp_ms:100,emitters:[{id:'flow',active:true,origin_world:[0,1,0],aim_world:[0,-1,0],radius:.04,strength:1,source_flux_particles_per_second:240,lifetime_seconds:6}]};
assert.equal(plan.step(packet,0,100)[0].slot,2);assert.equal(plan.step(packet,1,100).length,0,'continuous release must never overwrite a finite population');
console.log('Authored MLS exact steps and finite population custody');
