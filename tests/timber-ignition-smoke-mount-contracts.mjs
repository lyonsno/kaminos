import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountTimberIgnitionSmoke, TIMBER_IGNITION_BASIN} from '../timber-ignition-smoke.mjs';

const objects = JSON.parse(readFileSync(new URL('../scenes/sinter-timber-ignition-operator.kaminos.json', import.meta.url))).objects;
const state = {active:true, backend:'WebGPU:apple', effectiveRoute:'native-3d-compute-fluid-raymarch-v0',
  simGrid:48, simGridDimensions:[48,96,48], simStepCount:2, controls:{flowRate:1}, analyticEmitterDispatchActive:true,
  gpuStructuralCombustionAssembly:{structureCount:2,meshTriangleCount:1728,dispatchCount:2,presentationDebugMode:'off',runtimeReadbackCount:0,hostCausalFeedbackCount:0},
  combustibleObjectSource:{sameDevice:true}};
const element = () => ({style:{}, dataset:{}, handlers:new Map(), addEventListener(name,handler){this.handlers.set(name,handler);}});
const label = element(), pause = element(), reset = element(), run = element();
const nodes = new Map([['[role="status"]',label],['[data-action="pause"]',pause],['[data-action="reset"]',reset],['[data-action="run"]',run]]);
const section = {...element(), querySelector:selector=>nodes.get(selector)};
const root = {prepend:node=>assert.equal(node,section)};
globalThis.document = {getElementById:id=>id==='viewport'?root:null,createElement:()=>section};
globalThis.window = {
  __kaminosDefaultVolumeSmokeBasin:{presetId:TIMBER_IGNITION_BASIN},
  kaminosSceneObjectDebugState:()=>structuredClone(objects),
  kaminosSetSceneObjectTransform:(id,pose)=>{
    const object=objects.find(item=>item.id===id);Object.assign(object.transform,pose);return structuredClone(object);
  },
  __kaminosVolumePrototype:{
    debugState:()=>structuredClone(state),
    pauseSelectiveHeadLiveAtSimStep:async target=>{
      state.simStepCount=target;state.selectiveHeadLiveCapturePaused=true;
      return {ok:true,gpuComplete:true,paused:true,effectiveSimStepCount:target};
    },
    setSimulationPaused:paused=>{state.simulationPaused=paused;return {paused};},
    setSelectiveHeadLiveCapturePaused:paused=>{state.selectiveHeadLiveCapturePaused=paused;return {paused};},
    setControls:controls=>Object.assign(state.controls,controls),
    setAnalyticEmitterDescriptor:()=>{state.analyticEmitterDispatchActive=false;return {mode:'off',count:0,sourceLaw:'inactive'};},
  },
};
try {
  let restores=0;
  const smoke=await mountTimberIgnitionSmoke({
    setBurner:enabled=>{state.controls.flowRate=enabled?1:0;state.analyticEmitterDispatchActive=enabled;},
    restoreScene:async()=>{restores++;state.simStepCount=0;state.gpuStructuralCombustionAssembly.dispatchCount=0;
      const saved=JSON.parse(readFileSync(new URL('../scenes/sinter-timber-ignition-operator.kaminos.json',import.meta.url))).objects;
      objects.splice(0,objects.length,...saved);return {freshFluid:true,freshMaterial:true};},
  });
  await new Promise(setImmediate);
  assert.equal(smoke.status().running,false,'mount must wait indefinitely for a deliberate Run click');
  assert.equal(smoke.status().phase,'cold');
  assert.equal(state.simulationPaused,true);
  assert.equal(state.selectiveHeadLiveCapturePaused,false);
  assert.equal(state.controls.flowRate,0);
  assert.equal(state.analyticEmitterDispatchActive,false);
  assert.equal(run.disabled,false);
  assert.equal(pause.disabled,true);
  assert.equal(reset.disabled,false);
  run.handlers.get('click')();
  await new Promise(setImmediate);
  assert.equal(smoke.status().phase,'live');
  assert.equal(state.simulationPaused,false);
  assert.equal(run.textContent,'Repeat transfer');
  assert.equal(pause.disabled,false,'the operator must be able to pause after the prescribed sequence');
  assert.equal(pause.textContent,'Pause');
  pause.handlers.get('click')();
  assert.equal(state.simulationPaused,true);
  assert.equal(pause.textContent,'Resume');
  pause.handlers.get('click')();
  assert.equal(state.simulationPaused,false);
  assert.equal(pause.textContent,'Pause');
  run.handlers.get('click')();await new Promise(setImmediate);
  assert.equal(restores,2,'Repeat must restore without navigation');
  reset.handlers.get('click')();await new Promise(setImmediate);
  assert.equal(smoke.status().phase,'cold');assert.equal(run.disabled,false);
  assert.equal(restores,3);assert.equal(state.simulationPaused,true);
} finally {
  delete globalThis.document;delete globalThis.window;
}
console.log('timber ignition mounted live preview contracts: ok');
