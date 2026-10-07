import assert from 'node:assert/strict';
import {stoneConsumerFixture} from './helpers/stone-consumer-fixture.mjs';
import {assertStoneHeld,createStoneObservationRuntime} from '../structural-material-stone-experiment.mjs';
const f=await stoneConsumerFixture();
const expected={preparedSha256:f.api.witness().preparedSha256,sourceSha256:f.api.witness().sourceSha256,strength:200};
const state=await f.api.hold();
// These are policy fixtures; native backend conformance belongs to the browser exercise.
state.identity={backend:'webgpu',adapterFallback:false,isFallbackAdapter:false};
state.specimens.forEach(s=>{s.state.backend='webgpu-avbd';s.normalMapped=true;});
assertStoneHeld(state,expected);
for(const [name,mutate] of [
  ['fallback',s=>s.identity.adapterFallback=true],['wrong route',s=>s.route='different'],
  ['stale prepared source',s=>s.preparedSha256='stale'],['not held',s=>s.clock.paused=false],
  ['partial work',s=>s.clock.submittedSteps++],['stale presentation',s=>s.clock.presentedSteps--],
  ['missing specimen',s=>s.specimens.pop()],['lost startup offset',s=>s.clock.completedSeconds=0],
  ['wrong model clock',s=>s.specimens[1].state.step++],['undrained draw',s=>s.clock.presentationDrained=false],
]){const bad=structuredClone(state);mutate(bad);assert.throws(()=>assertStoneHeld(bad,expected),undefined,name);}
const runtime=createStoneObservationRuntime({evaluate:()=>state,expected});
runtime.assertStable(state,structuredClone(state));
for(const [name,mutate] of [
  ['reset during capture',s=>s.clock.runId='new-run'],['camera mutation',s=>s.camera.position[0]++],
  ['damage mutation',s=>s.specimens[0].state.connectivityEpoch++],['body motion',s=>s.specimens[0].state.bodies[0].position.x++],
  ['cohesion mutation',s=>s.specimens.forEach(p=>p.state.config.strength=300)],
]){const bad=structuredClone(state);mutate(bad);assert.throws(()=>runtime.assertStable(state,bad),undefined,name);}
const additive=structuredClone(state);additive.newDiagnostic=true;additive.clock.optionalDiagnostic=123;additive.specimens[0].state.bodies[0].newDiagnostic=42;
runtime.assertStable(state,additive);
console.log('Stone observation authority negatives pass; synthetic policy fixtures only');
