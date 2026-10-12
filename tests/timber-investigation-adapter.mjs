import assert from 'node:assert/strict';
import {TIMBER_IGNITION_BASIN} from '../timber-ignition-smoke.mjs';
const module = await import('../timber-investigation.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
assert.equal(typeof module.bindTimberInvestigation,'function','the domain needs a passive shared-investigation join');
const {bindTimberInvestigation} = module;

let listener, disposed = false, active = true;
const emitted = [];
const material = {assemblyId:'material-1',structureCount:2,runtimeReadbackCount:0,hostCausalFeedbackCount:0};
let fluidAllocationId='fluid-1';
const state = {attemptId:'physical-1',generation:1,phase:'live',operationIssues:[],resources:{fluidAllocationId:'fluid-1',materialAssemblyId:'material-1'}};
const objects = [{id:'sinter-source-timber'},{id:'sinter-receiver-timber'}];
const controller = {status:()=>structuredClone(state),subscribeOperations:callback=>{
  listener=callback;return ()=>{disposed=true;};
}};
const volume = {debugState:()=>({active,backend:'WebGPU:apple',effectiveRoute:'native-3d-compute-fluid-raymarch-v0',
  simGrid:48,simGridDimensions:[48,96,48],simStepCount:601,fluidAllocationId,gpuStructuralCombustionAssembly:material,
  combustibleObjectSource:{sameDevice:true}})};
const join=bindTimberInvestigation({controller,volume,basin:()=>TIMBER_IGNITION_BASIN,
  readObjects:()=>objects,readCamera:()=>({position:[1,2,3],target:[0,0,0],up:[0,1,0]}),
  readScene:()=>({objects}),readEdits:()=>({history:{length:2}}),
  operations:{get active(){return active;},emit:event=>emitted.push(event)},
});
const observed=join.read();
assert.equal(observed.attempt.id,'physical-1');assert.equal(observed.attempt.available,true);
assert.equal(observed.context.volume.simStepCount,601);
assert.deepEqual(observed.context.camera.up,[0,1,0]);
assert.deepEqual(observed.context.scene.objects,objects);
assert.equal(observed.context.edits.history.length,2);
material.assemblyId='material-2';
assert.equal(join.read().attempt.available,false,'same authored IDs cannot disguise replacement material resources');
material.assemblyId='material-1';fluidAllocationId='fluid-2';
assert.equal(join.read().attempt.available,false,'fresh gas cannot be attributed to the old physical attempt');
fluidAllocationId='fluid-1';assert.equal(join.read().attempt.available,true,'same-resource continuation remains available');
objects[0].id='replacement';
assert.equal(join.read().attempt.available,false,'a replaced scene must not advertise a live timber attempt');
assert.equal(join.read().context.objects[0].id,'replacement','raw disputed context survives downgrade');
objects[0].id='sinter-source-timber';
state.attemptId=null;state.phase='restoring';assert.equal(join.read().attempt.available,false);
const event={kind:'timber.pause',phase:'applied',target:'timber-experiment',effective:{paused:true},clock:{attemptId:'physical-1'}};
listener(event);assert.deepEqual(emitted,[event]);
active=false;listener(event);assert.equal(emitted.length,1,'inactive shared recorder needs no new observation traffic');
join.dispose();assert.equal(disposed,true);
assert.throws(()=>join.read(),/disposed/);
assert.equal(material.runtimeReadbackCount,0);
console.log('passive timber investigation and shared recorder join: ok');
