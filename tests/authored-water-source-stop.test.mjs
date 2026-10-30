// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createMlsEmissionPlan,mlsConfig} from '../mls-juice-contract.mjs';
import {createLocalLiquidEmitterSceneRecord} from '../local-liquid-scene-object.mjs';
import {waterControlsFixture} from './helpers/water-controls.mjs';
import {authoredMlsInlets} from '../authored-mls-water.mjs';
import {normalizeLocalLiquidSceneDocument} from '../local-liquid-scene-object.mjs';
import {defaultLocalLiquidSetup,localLiquidInletPacket} from '../local-liquid-setup.mjs';
test('emission switch retains authored flow through save/reopen and both inlet adapters',()=>{
 const source=createLocalLiquidEmitterSceneRecord({id:'pour',transform:{position:[0,1,0],rotation:[Math.PI/2,0,0],scale:[1,1,1]}});
 source.localLiquidEmitter.volumeRate=.0023;
 source.localLiquidEmitter.emissionEnabled=false;
 const saved=JSON.parse(JSON.stringify({objects:[source],localLiquid:defaultLocalLiquidSetup()}));
 const {emitters,setup}=normalizeLocalLiquidSceneDocument(saved);
 assert.equal(emitters[0].localLiquidEmitter.emissionEnabled,false,'stopped is authored state');
 assert.equal(emitters[0].localLiquidEmitter.volumeRate,.0023);
 for(const packet of [authoredMlsInlets(emitters),localLiquidInletPacket(setup,emitters)]){
  assert.equal(packet.emitters[0].active,false);
  assert.equal(packet.emitters[0].source_flux_particles_per_second,0);
 }
 emitters[0].localLiquidEmitter.emissionEnabled=true;
 assert.equal(authoredMlsInlets(emitters).emitters[0].active,true);
 assert.equal(authoredMlsInlets(emitters).emitters[0].source_flux_particles_per_second,.0023/(.05**3/3));
 emitters[0].localLiquidEmitter.volumeRate=0;
 assert.equal(authoredMlsInlets(emitters).emitters[0].active,false,'zero is a deliberate rate, not a request for defaults');
 assert.throws(()=>createLocalLiquidEmitterSceneRecord({...source,settings:{...source.localLiquidEmitter,emissionEnabled:'false'}}),/emission.*Boolean/i);
});
test('native emitter switch edits only activation and flushes a pending rate first',async()=>{
 const f=waterControlsFixture();const selected={id:'A',settings:{mode:'continuous',volumeRate:.0023,baseRadius:.075,strength:.25,emissionEnabled:true}};
 f.api.read=()=>({selected});f.api.edit=(id,patch)=>{f.edits.push({id,settings:patch});Object.assign(selected.settings,patch);};f.controls.refresh();
 assert.equal(f.input('[data-emission]').checked,true);
 f.input('[data-rate]').value='3.1';f.input('[data-rate]').listeners.input();
 f.input('[data-emission]').checked=false;await f.input('[data-emission]').onchange();
 assert.equal(selected.settings.volumeRate,.0031);assert.equal(selected.settings.emissionEnabled,false);
 assert.deepEqual(f.edits.at(-1).settings,{emissionEnabled:false});
 f.input('[data-emission]').checked=true;await f.input('[data-emission]').onchange();
 assert.equal(selected.settings.volumeRate,.0031);assert.equal(selected.settings.emissionEnabled,true);
});
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
