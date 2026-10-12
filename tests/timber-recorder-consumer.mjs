import assert from 'node:assert/strict';
import {readFileSync, realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createTimberIgnitionSmoke, TIMBER_IGNITION_BASIN} from '../timber-ignition-smoke.mjs';
import {bindTimberInvestigation} from '../timber-investigation.mjs';

assert.ok(process.argv[2] && process.argv[3], 'Supply the shared recorder module and its exact source revision');
const modulePath = realpathSync(process.argv[2]);
const sharedRoot = execFileSync('git', ['-C', dirname(modulePath), 'rev-parse', '--show-toplevel'], {encoding:'utf8'}).trim();
const revision = execFileSync('git', ['-C', sharedRoot, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
assert.equal(revision, process.argv[3], 'The effective shared source must match the named consumer');
assert.equal(execFileSync('git', ['-C', sharedRoot, 'diff', 'HEAD', '--', modulePath], {encoding:'utf8'}), '');
const {investigationOperations, createInvestigationRecording} = await import(pathToFileURL(modulePath));
assert.equal(typeof createInvestigationRecording, 'function');
assert.equal(typeof investigationOperations.emit, 'function');
const scene = JSON.parse(readFileSync(new URL('../scenes/sinter-timber-ignition-operator.kaminos.json', import.meta.url)));
let objects = structuredClone(scene.objects), attempt = 0, allocation = 0;
const live = {active:true,backend:'WebGPU:fixture',effectiveRoute:'native-3d-compute-fluid-raymarch-v0',
  simGrid:48,simGridDimensions:[48,96,48],simStepCount:0,fluidAllocationId:'fluid-0',
  controls:{flowRate:0},analyticEmitterDispatchActive:false,combustibleObjectSource:{sameDevice:true},
  gpuStructuralCombustionAssembly:{assemblyId:'material-0',structureCount:2,meshTriangleCount:1728,
    dispatchCount:0,presentationDebugMode:'off',runtimeReadbackCount:0,hostCausalFeedbackCount:0}};
const volume = {debugState:()=>structuredClone(live),setSimulationPaused:paused=>({paused}),
  setSelectiveHeadLiveCapturePaused:paused=>({paused}),
  setAnalyticEmitterDescriptor:()=>{live.analyticEmitterDispatchActive=false;return {mode:'off',count:0,sourceLaw:'inactive'};},
  pauseSelectiveHeadLiveAtSimStep:async target=>{live.simStepCount=target;return {ok:true,gpuComplete:true,paused:true,effectiveSimStepCount:target};}};
const controller = createTimberIgnitionSmoke({volume,basin:()=>TIMBER_IGNITION_BASIN,objects:()=>objects,
  createAttemptId:()=>`fixture-attempt-${++attempt}`,
  setBurner:enabled=>{live.controls.flowRate=enabled?1.95:0;live.analyticEmitterDispatchActive=enabled;},
  moveObject:(id,patch)=>{const object=objects.find(o=>o.id===id);Object.assign(object.transform,patch);return structuredClone(object);},
  restoreScene:async()=>{objects=structuredClone(scene.objects);live.simStepCount=0;
    live.fluidAllocationId=`fluid-${++allocation}`;live.gpuStructuralCombustionAssembly.assemblyId=`material-${allocation}`;
    return {freshFluid:true,freshMaterial:true};}});
await controller.initialize();
const join = bindTimberInvestigation({controller,volume,basin:()=>TIMBER_IGNITION_BASIN,
  readObjects:()=>objects,readCamera:()=>({position:[1,2,3]}),readScene:()=>scene,readEdits:()=>({}),operations:investigationOperations});
const recording = createInvestigationRecording({id:'fixture-timber-consumer',source:{revision,modulePath},
  initial:join.read(),startingConditions:{kind:'deterministic-controller-fixture'}});
await controller.run();
live.simStepCount=612;
controller.togglePause();
const retained = recording.finish();
assert.equal(retained.complete,true);assert.deepEqual(retained.issues,[]);
assert.deepEqual(retained.operations.map(o=>[o.kind,o.phase]),[
  ['timber.burner','on'],['timber.advance','completed'],['timber.burner','off'],
  ['timber.placement','applied'],['timber.placement','applied'],['timber.advance','completed'],
  ['timber.run','live'],['timber.pause','applied']]);
assert.ok(retained.operations.every(o=>o.clock.attemptId==='fixture-attempt-1' && o.actor==='unattributed'));
assert.deepEqual(retained.operations.map(o=>o.sequence),[1,2,3,4,5,6,7,8]);
assert.equal(retained.operations.at(-1).clock.simStepCount,612,'record the live volume clock, not a stale controller boundary');
assert.equal(investigationOperations.active,false);
controller.togglePause();assert.equal(recording.snapshot().operations.length,8,'finished recording stops retention');
join.dispose();
console.log(JSON.stringify({status:'passed',authority:'source-recorder-with-deterministic-domain-fixture',
  sharedRoot,revision,modulePath,sha256:createHash('sha256').update(readFileSync(modulePath)).digest('hex'),operations:retained.operations.length}));
