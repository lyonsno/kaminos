// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createMlsEmissionPlan,mlsConfig} from '../mls-juice-contract.mjs';
import {createLocalLiquidEmitterSceneRecord} from '../local-liquid-scene-object.mjs';
import {waterControlsFixture} from './helpers/water-controls.mjs';
test('new flow and saved legacy flow',()=>{
const fresh=createLocalLiquidEmitterSceneRecord({id:'new',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]}});
assert(Math.abs(fresh.localLiquidEmitter.volumeRate-.005)<1e-12,'New emitter must start at 5 litres/s, one tenth of the old 50');
const legacy=createLocalLiquidEmitterSceneRecord({id:'old',transform:fresh.transform,settings:{schema:'kaminos.local-liquid-emitter.v1',rate:1200,baseRadius:.08,strength:1}});
assert(Math.abs(legacy.localLiquidEmitter.volumeRate-.05)<1e-12,'Explicit old particle rates retain their amount');
});
test('admission state and work at capacity',()=>{
const config=mlsConfig({particleCount:32,gridSize:16}),plan=createMlsEmissionPlan(config);
const emitter={id:'source',active:true,origin_world:[0,.3,0],aim_world:[0,-1,0],radius:.001,strength:1,source_flux_particles_per_second:240*64,lifetime_seconds:1e30};
const packet={authority:{simulation_safe:true},timestamp_ms:0,emitters:[emitter]};
plan.step(packet,0,0);emitter.origin_world=[.1,.3,0];
assert.equal(plan.step(packet,config.dt,0).length,0,'Full pool must not silently overwrite retained water');
let status=plan.read(config.dt).inlets[0];
assert.equal(status.blockedReason,'capacity');assert.equal(status.capacityBlocked,64);
assert.deepEqual(status.originWorld,[.1,.3,0],'Admission status must name the moved source, even while full');
assert(plan.read(config.dt).slotSearches<=32,'A full pool may be scanned once per step, not once per rejected birth');
emitter.source_flux_particles_per_second=1;plan.step(packet,config.dt,0);assert.equal(plan.read(config.dt).inlets[0].blockedReason,'capacity','Capacity warning persists between fractional-rate births');
emitter.source_flux_particles_per_second=240*64;plan.reconcileOccupancy(new Uint32Array([0xfffffffe]));
const births=plan.step(packet,config.dt*2,0);assert.equal(births.length,1);
assert(Math.abs(config.min[0]+births[0].position[0]*config.cell-.1)<.002,'Freed slot is emitted at the moved position');
emitter.origin_world=[100,.3,0];plan.step(packet,config.dt*3,0);assert.equal(plan.read(config.dt*3).inlets[0].blockedReason,'outside_domain');
packet.timestamp_ms=-1000;plan.step(packet,config.dt*4,0);assert.equal(plan.read(config.dt*4).inlets[0].blockedReason,'stale_input');
});
test('source inspector explains stopped emission',()=>{
const f=waterControlsFixture();f.select('A');
f.setRuntime({paused:false,capacity:32,population:{active:32},liveInlets:{inlets:[{id:'A',blockedReason:'capacity',capacityBlocked:4}]}});
f.controls.refreshStatus();assert.match(f.input('[data-source-status]').textContent,/capacity.*full/i,'Selected source must explain why the stream stopped');
f.setRuntime({paused:false,liveInlets:{inlets:[{id:'A',blockedReason:'outside_domain'}]}});f.controls.refreshStatus();assert.match(f.input('[data-source-status]').textContent,/outside.*bounds/i);
});
