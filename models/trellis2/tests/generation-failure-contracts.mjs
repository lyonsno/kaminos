import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {m} from './generation-input-fixture.js';
import {createWebGpuInferenceQueue} from '../../../webgpu-inference-kit/src/inference-queue.js';
const manifest=new TextEncoder().encode(JSON.stringify(m)),sha=Buffer.from(await webcrypto.subtle.digest('SHA-256',manifest)).toString('hex');
const device={pushErrorScope(){},async popErrorScope(){return null;},addEventListener(){},lost:new Promise(()=>{}),destroy(){}},
  adapter={info:{vendor:'apple',description:'Apple M4 Max',isFallbackAdapter:false},
    limits:{maxStorageBufferBindingSize:4294967292,maxBufferSize:4294967292,maxComputeWorkgroupsPerDimension:65535},async requestDevice(){return device;}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{async requestAdapter(){return adapter;}}}});
globalThis.fetch=async url=>url==='/fixture/manifest.json'?new Response(manifest):new Response('');
const runtime={routeId:'trellis2.image-generation.webgpu.v0',async runInvocation(info,fn){return fn(info);}};
globalThis.generationFailurePorts={
  async createSession(){const queue=createWebGpuInferenceQueue({runtime});return{async registerRoute(){return{routeId:runtime.routeId,runtime,enqueue:queue.enqueue};},
    snapshot(){return{sessionId:'synthetic-failure-test'};},drain:queue.drain,close(){}};},
  async loadInputs(){return{};},
  createAdapter({onPhase,onNoiseInput}){return{noiseInputs:{},phase:'new',async run(){this.phase='generation-checkpoint-input-loading';
    await onPhase({phase:this.phase});
    await onNoiseInput({stage:'sparse',shape:[2],values:new Float32Array([.125,-.25]),source:'synthetic-observed-input',seed:42});
    throw new RangeError('observed checkpoint array allocation failure');},dispose(){}};}
};
// Only the external device/producer ports are substituted. The witness body and actual kit queue terminal schema run unchanged.
let source=await fs.readFile(new URL('../sparse-generation-witness.js',import.meta.url),'utf8');
source=source.replace(/import \{createWebGpuInferenceSession\}[^;]+;/,
  'const {createSession:createWebGpuInferenceSession}=globalThis.generationFailurePorts;')
  .replace(/import \{createTrellisImageGenerationAdapter\}[^;]+;/,
    'const {createAdapter:createTrellisImageGenerationAdapter}=globalThis.generationFailurePorts;')
  .replace(/import \{loadGenerationInputs,validateGenerationInputs(?:,generationPipelineType)?\}[^;]+;/,
    `import {validateGenerationInputs,generationPipelineType} from '${new URL('../generation-inputs.js',import.meta.url)}';const {loadInputs:loadGenerationInputs}=globalThis.generationFailurePorts;`)
  .replaceAll("from './",`from '${new URL('../',import.meta.url)}`);
const {runGenerationWitness}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const report=await runGenerationWitness(sha);
assert.equal(report.status,'failed');
assert.equal(report.error.message,'observed checkpoint array allocation failure',
  'The actual queue publishes failure, not error; preserve the causal exception instead of replacing it with a generic model failure.');
assert.deepEqual(report.jobCompletion.failure,{name:'RangeError',message:'observed checkpoint array allocation failure'});
assert.equal(report.phase,'generation-checkpoint-input-loading');
assert.equal(report.jobCompletion.outputPresent,false);
assert.deepEqual(report.outputs['noise.sparse'].shape,[2]);assert.equal(report.outputs['noise.sparse'].byteLength,8);
globalThis.fetch=async url=>url==='/fixture/manifest.json'?new Response(manifest):
  url==='/phase'?new Response('complete native kernel event required',{status:500}):new Response('');
const rejectedPhase=await runGenerationWitness(sha);
assert.match(rejectedPhase.error.message,/complete native kernel event required/,'The actual phase receiver rejection must survive in the failure report.');
console.log('Actual kit queue failure survives the unchanged witness body and names its last phase; synthetic device/model ports do not claim native execution.');

const hostTest=await fs.readFile(new URL('./shared-host-contracts.mjs',import.meta.url),'utf8');
const fixture=Function(hostTest.slice(hostTest.indexOf('function fixture()'),hostTest.indexOf('const kernel='))+';return fixture;')();
const shared=fixture();
shared.device.pushErrorScope=()=>{};shared.device.popErrorScope=async()=>null;shared.device.addEventListener=()=>{};
shared.sharedGpu.adapter.info={vendor:'apple',architecture:'metal-3',description:'controlled shared Apple device',isFallbackAdapter:false};
let extraDeviceRequests=0;
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{requestAdapter(){extraDeviceRequests++;throw Error('a shared composition must not request another adapter');}}}});
globalThis.fetch=async url=>url==='/fixture/manifest.json'?new Response(manifest):new Response('');
const sharedFailure=await runGenerationWitness(sha,{sharedComposition:shared});
assert.equal(sharedFailure.error?.message,'observed checkpoint array allocation failure',
  'complete generation must consume the existing shared host rather than attempt another adapter');
assert.equal(sharedFailure.deviceTopology,'same-device');
assert.equal(sharedFailure.sharedRelease?.status,'released');
assert.equal(extraDeviceRequests,0);assert.equal(shared.destroyed,0);
assert.equal(shared.active,false);assert.equal(shared.requester,null);
console.log('Full witness failure uses the actual borrowed host/kit bridge, preserves causal failure, releases its route and leaves the host device alive.');
