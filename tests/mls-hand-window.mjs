// kaminos-test: node
import assert from 'node:assert/strict';
import * as witness from '../tools/mls-witness-source.mjs';
import {MLS_ROUTE} from '../mls-juice-contract.mjs';
assert.equal(typeof witness.validateMlsHandWindow,'function','populated-window validation is absent');
const state=(frame,seconds,received)=>({running:true,starting:false,error:null,received,identity:{backend:'webgpu-local'},
  fingerJuice:{enabled:true,backend:'mls-mpm',error:null,runtime:{effectiveRoute:MLS_ROUTE,failure:null,frameCount:frame,solver:{clock:{simulatedSeconds:seconds}}}}});
const start=state(20,8,15),end=state(40,11,20),validate=witness.validateMlsHandWindow;
assert.deepEqual(validate(start,end),{presentedFrames:20,simulatedSeconds:3,handResults:5});
assert.throws(()=>validate(start,state(20,11,20)),/presentation progress/);
assert.throws(()=>validate(start,state(40,8,20)),/simulation progress/);
assert.throws(()=>validate(start,state(40,11,15)),/hand progress/);
for(const mutate of [s=>s.error='hand failed',s=>s.running=false,s=>s.fingerJuice.error='expired',
  s=>s.fingerJuice.runtime.failure='device lost',s=>s.fingerJuice.runtime.effectiveRoute='legacy',s=>delete s.fingerJuice.runtime]){
  const bad=structuredClone(end);mutate(bad);assert.throws(()=>validate(start,bad));
}
console.log('MLS populated-window requires hand, presentation and simulation progress without errors');

assert.equal(typeof witness.resolveMlsHandRequest,'function','experiment defaults are not resolved');
assert.equal(typeof witness.validateMlsHandRequest,'function','effective configuration is not checked');
const runway=witness.resolveMlsHandRequest('hand-jet-runway',{});
assert.equal(runway.particleCount,12000);assert.equal(runway.jetSpeed,4.5);
assert.equal(runway.sourceFlux,1800);assert.deepEqual(runway.fluidGridSize,[192,80,256]);
const effective=state(40,11,20);
Object.assign(effective.fingerJuice,{packet:{economics:{lifetimeSeconds:6,jetSpeedWorldPerSecond:4.5}},load:{requestedRate:1800}});
Object.assign(effective.fingerJuice.runtime.solver,{particleCount:12000,material:{viscosity:.1},domain:{gridDimensions:[192,80,256]}});
witness.validateMlsHandRequest(effective,runway);
for(const mutate of [s=>s.fingerJuice.runtime.solver.particleCount=2400,s=>s.fingerJuice.packet.economics.jetSpeedWorldPerSecond=1.955,
  s=>s.fingerJuice.load.requestedRate=360,s=>s.fingerJuice.runtime.solver.domain.gridDimensions=[64,64,64]]){
  const bad=structuredClone(effective);mutate(bad);assert.throws(()=>witness.validateMlsHandRequest(bad,runway));
}
assert.equal(witness.resolveMlsHandRequest('hand-browser-juice',{}).particleCount,2400);
assert.equal(witness.resolveMlsHandRequest('hand-jet-runway',{jetSpeed:3}).jetSpeed,3);
assert.throws(()=>witness.resolveMlsHandRequest('unknown',{}),/experiment/);

assert.equal(typeof witness.validateMlsJetControl,'function','live jet control validation is absent');
const before=structuredClone(effective),after=structuredClone(effective);
before.sessionId=after.sessionId='same-camera';
before.fingerJuice.runtime.solver.liveInlets={totalAdmitted:100};after.fingerJuice.runtime.solver.liveInlets={totalAdmitted:110};
after.received++;after.fingerJuice.runtime.frameCount++;after.fingerJuice.runtime.solver.clock.simulatedSeconds++;
after.fingerJuice.jetSpeedWorldPerSecond=5;after.fingerJuice.packet.economics.jetSpeedWorldPerSecond=5;
after.fingerJuice.packet.emitters=[{active:true,strength:5}];
witness.validateMlsJetControl(before,after,5);
for(const mutate of [s=>s.sessionId='restarted',s=>s.fingerJuice.packet.economics.jetSpeedWorldPerSecond=4.5,
  s=>s.fingerJuice.packet.emitters[0].strength=4.5,s=>s.fingerJuice.runtime.solver.liveInlets.totalAdmitted=0]){
  const bad=structuredClone(after);mutate(bad);assert.throws(()=>witness.validateMlsJetControl(before,bad,5));
}
