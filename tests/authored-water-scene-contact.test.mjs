// kaminos-test: node
import assert from 'node:assert/strict';
import {authoredDropSetup} from '../authored-water-host.mjs';
import {createWebGPUFingerFluidSolver} from '../finger-fluid-webgpu-core.js';
import {createFiniteFluidHost} from '../finite-fluid-host.mjs';
import {SCENE_LIQUID_SUPPORT_ROUTE} from '../scene-liquid-support.mjs';
const sources=[{id:'drop',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:24,container:null}}}];
const setup=authoredDropSetup(sources);
assert.equal(setup.solver.supportContactRoute,SCENE_LIQUID_SUPPORT_ROUTE,'Finite authored water must consume authored scene contacts');
assert.equal(setup.solver.diagnosticBox.collisions,false,'Scene contact does not silently enable a container');
// Admission reaches the unavailable-device result in Node; this is not a GPU conformance claim.
const unavailable=await createWebGPUFingerFluidSolver(setup.solver);
assert.equal(unavailable.available,false);
let colliders=[{id:'floor'}],events=[];
const host=await createFiniteFluidHost({setup,device:{queue:{onSubmittedWorkDone:async()=>{}}},readColliders:()=>colliders,
 createSolver:async options=>{events.push(['install',options.sceneColliders]);return {available:true,setSceneColliders:r=>events.push(['contacts',r]),step:()=>events.push(['step']),destroy(){},getDebugState:()=>({})};},
 createPresentation:()=>({render(){},state:()=>({}),dispose(){}})});
assert.deepEqual(events[0],['install',colliders]);
colliders=[{id:'raised-floor'}];host.render({timestampMs:0});assert.deepEqual(events.at(-1),['contacts',colliders],'Paused edits update scene support');
host.setPaused(false);host.render({timestampMs:10});host.render({timestampMs:20});assert.equal(events.at(-1)[0],'step');assert.equal(events.at(-2)[0],'contacts');
colliders=[];await host.advanceTo(host.state().clock.step+1);assert.deepEqual(events.at(-2),['contacts',[]],'Offline stepping sees deletion');
colliders=[{id:'replay-floor'}];await host.restart();assert.deepEqual(events.at(-1),['install',colliders],'Replay installs current authored contacts');host.dispose();
console.log('Finite authored scene support admission, live edits, stepping, and replay');
