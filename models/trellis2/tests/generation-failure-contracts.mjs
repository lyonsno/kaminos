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
const runtime={routeId:'trellis2.image-generation.webgpu.v0',async runInvocation(info,fn){return fn(info);}},
  queue=createWebGpuInferenceQueue({runtime});
globalThis.generationFailurePorts={
  async createSession(){return{async registerRoute(){return{routeId:runtime.routeId,runtime,enqueue:queue.enqueue};},
    snapshot(){return{sessionId:'synthetic-failure-test'};},drain:queue.drain,close(){}};},
  async loadInputs(){return{};},
  createAdapter({onPhase}){return{noiseInputs:{},phase:'new',async run(){this.phase='generation-checkpoint-input-loading';
    await onPhase({phase:this.phase});throw new RangeError('observed checkpoint array allocation failure');},dispose(){}};}
};
// Only the external device/producer ports are substituted. The witness body and actual kit queue terminal schema run unchanged.
let source=await fs.readFile(new URL('../sparse-generation-witness.js',import.meta.url),'utf8');
source=source.replace(/import \{createWebGpuInferenceSession\}[^;]+;/,
  'const {createSession:createWebGpuInferenceSession}=globalThis.generationFailurePorts;')
  .replace(/import \{createTrellisImageGenerationAdapter\}[^;]+;/,
    'const {createAdapter:createTrellisImageGenerationAdapter}=globalThis.generationFailurePorts;')
  .replace(/import \{loadGenerationInputs,validateGenerationInputs\}[^;]+;/,
    `import {validateGenerationInputs} from '${new URL('../generation-inputs.js',import.meta.url)}';const {loadInputs:loadGenerationInputs}=globalThis.generationFailurePorts;`)
  .replaceAll("from './",`from '${new URL('../',import.meta.url)}`);
const {runGenerationWitness}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const report=await runGenerationWitness(sha);
assert.equal(report.status,'failed');
assert.equal(report.error.message,'observed checkpoint array allocation failure',
  'The actual queue publishes failure, not error; preserve the causal exception instead of replacing it with a generic model failure.');
assert.deepEqual(report.jobCompletion.failure,{name:'RangeError',message:'observed checkpoint array allocation failure'});
assert.equal(report.phase,'generation-checkpoint-input-loading');
assert.equal(report.jobCompletion.outputPresent,false);
console.log('Actual kit queue failure survives the unchanged witness body and names its last phase; synthetic device/model ports do not claim native execution.');
