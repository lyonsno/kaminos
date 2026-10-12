import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTimberIgnitionSmoke, TIMBER_IGNITION_BASIN} from '../timber-ignition-smoke.mjs';

const scene = JSON.parse(readFileSync(new URL('../scenes/sinter-timber-ignition-operator.kaminos.json', import.meta.url)));
let objects = structuredClone(scene.objects), nextId = 0, failRestore = false;
const events = [];
const state = {active:true, backend:'WebGPU:apple', effectiveRoute:'native-3d-compute-fluid-raymarch-v0',
  simGrid:48, simGridDimensions:[48,96,48], simStepCount:0, controls:{flowRate:0}, analyticEmitterDispatchActive:false,
  gpuStructuralCombustionAssembly:{structureCount:2,meshTriangleCount:1728,dispatchCount:0,presentationDebugMode:'off',runtimeReadbackCount:0,hostCausalFeedbackCount:0},
  combustibleObjectSource:{sameDevice:true}};
const volume = {
  debugState:()=>structuredClone(state),
  setSimulationPaused:paused=>({paused}),
  setSelectiveHeadLiveCapturePaused:paused=>({paused}),
  pauseSelectiveHeadLiveAtSimStep:async target=>{
    state.simStepCount=target;return {ok:true,gpuComplete:true,paused:true,effectiveSimStepCount:target};
  },
  setAnalyticEmitterDescriptor:()=>{state.analyticEmitterDispatchActive=false;return {mode:'off',count:0,sourceLaw:'inactive'};},
};
const controller=createTimberIgnitionSmoke({volume,basin:()=>TIMBER_IGNITION_BASIN,objects:()=>objects,
  createAttemptId:()=>`attempt-${++nextId}`, onOperation:event=>events.push(event),
  setBurner:enabled=>{state.controls.flowRate=enabled?1.95:0;state.analyticEmitterDispatchActive=enabled;},
  moveObject:(id,patch)=>{const object=objects.find(o=>o.id===id);Object.assign(object.transform,patch);return structuredClone(object);},
  restoreScene:async()=>{if(failRestore)throw Error('restore interrupted');objects=structuredClone(scene.objects);state.simStepCount=0;state.gpuStructuralCombustionAssembly.dispatchCount=0;return {freshFluid:true,freshMaterial:true};},
});
await controller.initialize();
assert.equal(controller.status().attemptId,'attempt-1','successful fresh resources need a physical attempt identity');
assert.equal(controller.status().generation,1);
let subscribed=0;
const unsubscribe=controller.subscribeOperations(()=>subscribed++);
await controller.run();
assert.equal(controller.status().attemptId,'attempt-1','starting and advancing does not replace the cold attempt');
controller.togglePause();controller.togglePause();
assert.equal(controller.status().attemptId,'attempt-1','inspection pause retains the actual evolved material');
const shutdown=events.findLast(e=>e.kind==='timber.burner'&&e.phase==='off');
assert.equal(shutdown.effective.flowRate,0);assert.equal(shutdown.effective.analyticEmitterDispatchActive,false);
const placement=events.filter(e=>e.kind==='timber.placement');
assert.deepEqual(placement.map(e=>e.target),scene.objects.map(o=>o.id));
assert.deepEqual(placement[1].effective.transform.position,[0.4,0.6,0]);
assert.ok(events.indexOf(shutdown)<events.indexOf(placement[0]),'record actual burner-off before receiver introduction');
assert.deepEqual(events.filter(e=>e.kind==='timber.advance'&&e.clock.attemptId==='attempt-1').map(e=>e.effective.effectiveSimStepCount),[240,600]);
assert.ok(events.filter(e=>e.kind==='timber.placement').every(e=>e.clock.attemptId==='attempt-1'));
await controller.run();
assert.equal(controller.status().attemptId,'attempt-2','Repeat starts a new physical attempt');
await controller.reset();assert.equal(controller.status().attemptId,'attempt-3');
unsubscribe();const count=subscribed;await controller.run();assert.equal(subscribed,count);
const stopBadObserver=controller.subscribeOperations(()=>{throw Error('retention unavailable');});
await controller.reset();assert.equal(controller.status().phase,'cold','observer failure must not break the physical reset');
assert.equal(controller.status().operationIssues.at(-1).error,'retention unavailable');
stopBadObserver();
failRestore=true;await assert.rejects(controller.reset(),/restore interrupted/);
assert.equal(controller.status().attemptId,null,'failed partial resource replacement must not advertise the old live attempt');
assert.equal(controller.status().phase,'failed');
assert.ok(events.some(e=>e.kind==='timber.failure'&&e.clock.attemptId===null));
console.log('timber investigation identity and actual operations: ok');
