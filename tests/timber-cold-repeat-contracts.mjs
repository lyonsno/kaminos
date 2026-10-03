import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTimberIgnitionSmoke, TIMBER_IGNITION_BASIN} from '../timber-ignition-smoke.mjs';
const scene = JSON.parse(readFileSync(new URL('../scenes/sinter-timber-ignition-operator.kaminos.json', import.meta.url)));
function fixture() {
  let objects = structuredClone(scene.objects);
  const events = [];
  const state = {active:true, backend:'WebGPU:apple', effectiveRoute:'native-3d-compute-fluid-raymarch-v0',
    simGrid:48, simGridDimensions:[48,96,48], simStepCount:9, controls:{flowRate:1.95}, analyticEmitterDispatchActive:true,
    gpuStructuralCombustionAssembly:{structureCount:2,meshTriangleCount:1728,dispatchCount:9,presentationDebugMode:'off',runtimeReadbackCount:0,hostCausalFeedbackCount:0},
    combustibleObjectSource:{sameDevice:true}};
  const volume = {
    debugState:()=>structuredClone(state),
    setSimulationPaused:paused=>{state.simulationPaused=paused;return {paused};},
    setSelectiveHeadLiveCapturePaused:paused=>{state.selectiveHeadLiveCapturePaused=paused;return {paused};},
    pauseSelectiveHeadLiveAtSimStep:async target=>{
      events.push(['step',target]);state.simStepCount=target;state.selectiveHeadLiveCapturePaused=true;
      return {ok:true,gpuComplete:true,paused:true,effectiveSimStepCount:target};
    },
    setControls:controls=>Object.assign(state.controls,controls),
    setAnalyticEmitterDescriptor:()=>{state.analyticEmitterDispatchActive=false;return {mode:'off',count:0,sourceLaw:'inactive'};},
  };
  const options = {volume,basin:()=>TIMBER_IGNITION_BASIN,objects:()=>objects,
    moveObject:(id,pose)=>{const object=objects.find(item=>item.id===id);Object.assign(object.transform,pose);events.push(['move',id]);return structuredClone(object);},
    setBurner:enabled=>{events.push(['burner',enabled]);state.controls.flowRate=enabled?1.95:0;state.analyticEmitterDispatchActive=enabled;return {enabled};},
    restoreScene:async()=>{
      assert.equal(state.simulationPaused,true,'restoration must not run material steps');
      assert.equal(state.controls.flowRate,0,'fresh fluid must be seeded with the burner off');
      events.push(['restore']);objects=structuredClone(scene.objects);state.simStepCount=0;
      state.gpuStructuralCombustionAssembly.dispatchCount=0;
      return {freshFluid:true,freshMaterial:true};
    },
  };
  return {smoke:createTimberIgnitionSmoke(options),state,events,options,volume};
}
const good=fixture();
await good.smoke.initialize();
assert.equal(good.smoke.status().phase,'cold','mount must restore an unconsumed cold experiment');
assert.equal(good.state.simStepCount,0);
assert.equal(good.state.controls.flowRate,0);
assert.equal(good.state.analyticEmitterDispatchActive,false);
assert.equal(good.state.simulationPaused,true);
assert.equal(good.state.selectiveHeadLiveCapturePaused,false,'cold camera remains live');
assert.equal(good.events.filter(event=>event[0]==='restore').length,1);
await new Promise(setImmediate);
assert.equal(good.state.simStepCount,0,'idle operator must not lose a priming window');
await good.smoke.run();
assert.equal(good.smoke.status().phase,'live');
assert.equal(good.state.simStepCount,600);
assert.equal(good.state.controls.flowRate,0);
assert.equal(good.state.analyticEmitterDispatchActive,false);
assert.deepEqual(good.events.filter(event=>event[0]==='step').map(event=>event[1]),[9,240,600]);
assert.deepEqual(good.events.filter(event=>event[0]==='move').map(event=>event[1]),scene.objects.map(object=>object.id));
good.smoke.togglePause();assert.equal(good.state.simulationPaused,true);
good.smoke.togglePause();assert.equal(good.state.simulationPaused,false);
await good.smoke.run();
assert.equal(good.events.filter(event=>event[0]==='restore').length,2,'repeat restores both objects and fluid in-page');
await good.smoke.reset();
assert.equal(good.smoke.status().phase,'cold');assert.equal(good.state.simStepCount,0);
assert.equal(good.state.simulationPaused,true);assert.equal(good.state.selectiveHeadLiveCapturePaused,false);
const bad=fixture();bad.options.restoreScene=async()=>({freshFluid:true,freshMaterial:false});
const invalid=createTimberIgnitionSmoke(bad.options);
await assert.rejects(invalid.initialize(),/fresh/);assert.equal(invalid.status().phase,'failed');
for(const mutate of [s=>s.backend='fallback',s=>s.simGrid=96,s=>s.effectiveRoute='fallback',s=>s.combustibleObjectSource.sameDevice=false]){
  const wrong=fixture();mutate(wrong.state);await assert.rejects(wrong.smoke.initialize());
  assert.ok(!wrong.events.some(event=>event[0]==='restore'),'wrong route must not mutate the saved scene');
}
const concurrent=fixture();await concurrent.smoke.initialize();
let finish;const advance=concurrent.volume.pauseSelectiveHeadLiveAtSimStep;
concurrent.volume.pauseSelectiveHeadLiveAtSimStep=async target=>{const receipt=await advance(target);if(target===600)await new Promise(resolve=>finish=resolve);return receipt;};
const pending=concurrent.smoke.run();while(!finish)await new Promise(setImmediate);
await assert.rejects(concurrent.smoke.run(),/progress/);await assert.rejects(concurrent.smoke.reset(),/progress/);
concurrent.smoke.togglePause();finish();await pending;
assert.equal(concurrent.state.simulationPaused,true,'explicit pause survives final GPU completion');
assert.equal(concurrent.smoke.status().busy,false);
const source=readFileSync(new URL('../timber-ignition-smoke.mjs',import.meta.url),'utf8');
assert.doesNotMatch(source,/location\.reload/,'repeat must not reload the page');
console.log('cold repeatable timber transfer contracts: ok');
