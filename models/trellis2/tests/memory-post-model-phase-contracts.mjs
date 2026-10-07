import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {m} from './generation-input-fixture.js';
import {createWebGpuInferenceQueue} from '../../../webgpu-inference-kit/src/inference-queue.js';
const manifest=new TextEncoder().encode(JSON.stringify(m)),sha=Buffer.from(await webcrypto.subtle.digest('SHA-256',manifest)).toString('hex');
const device={createBuffer(d){return{size:d.size,destroy(){}};},destroy(){},pushErrorScope(){},async popErrorScope(){return null;},addEventListener(){},lost:new Promise(()=>{})},
  adapter={info:{vendor:'apple',architecture:'metal-3',isFallbackAdapter:false},limits:{maxStorageBufferBindingSize:4294967292,maxBufferSize:4294967292,maxComputeWorkgroupsPerDimension:65535},async requestDevice(){return device;}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{async requestAdapter(){return adapter;}}}});
globalThis.fetch=async url=>url==='/fixture/manifest.json'?new Response(manifest):new Response('');
const runtime={device,routeId:'trellis2.image-generation.webgpu.v0',async runInvocation(info,fn){return fn(info);},async readTensor(t){device.createBuffer({size:512,label:'retained-fields-readback'});return new ArrayBuffer(t.shape.reduce((n,x)=>n*x,4));}};
const tensor=(shape,dtype='f32')=>({shape,dtype,buffer:device.createBuffer({size:4,label:'model-output'})});
globalThis.memoryPhasePorts={async createSession(){const queue=createWebGpuInferenceQueue({runtime});return{
  async registerRoute(){return{routeId:'trellis2.image-generation.webgpu.v0',runtime,enqueue:queue.enqueue};},snapshot(){return{sessionId:'synthetic-memory-phase'};},drain:queue.drain,close(){}};},
  async loadInputs(){return{};},createAdapter({onPhase}){return{noiseInputs:{},async run(){await onPhase({phase:'shape-guided-material-decoding'});
    this.outputs={dino:{blocksExecuted:24},conditioning:tensor([1]),geometry:{features:tensor([1,7]),coordinates:tensor([1,3],'i32'),subdivisions:[],levels:[],resolution:1024},
      material:{features:tensor([1,6]),coordinates:tensor([1,3],'i32'),levels:[],resolution:1024},shapeCodes:tensor([1,32]),textureCodes:tensor([1,32]),phases:[]};return this.outputs;},dispose(){}};},
  createAsset({onPhase}){return{async run(){await onPhase({phase:'post-model-material-readback'});device.createBuffer({size:8192,label:'asset-readback'});throw Error('intentional asset replay stop');},dispose(){}};}};
let source=await fs.readFile(new URL('../sparse-generation-witness.js',import.meta.url),'utf8');
source=source.replace(/import \{createWebGpuInferenceSession\}[^;]+;/,'const {createSession:createWebGpuInferenceSession}=globalThis.memoryPhasePorts;')
  .replace(/import \{createTrellisImageGenerationAdapter\}[^;]+;/,'const {createAdapter:createTrellisImageGenerationAdapter}=globalThis.memoryPhasePorts;')
  .replace(/import \{createTrellisAssetAdapter\}[^;]+;/,'const {createAsset:createTrellisAssetAdapter}=globalThis.memoryPhasePorts;')
  .replace(/import \{loadGenerationInputs,validateGenerationInputs,generationPipelineType\}[^;]+;/,
    `import {validateGenerationInputs,generationPipelineType} from '${new URL('../generation-inputs.js',import.meta.url)}';const {loadInputs:loadGenerationInputs}=globalThis.memoryPhasePorts;`)
  .replaceAll("from './",`from '${new URL('../',import.meta.url)}`);
const {runGenerationWitness}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const result=await runGenerationWitness(sha,{memoryMonitor:true});assert.equal(result.error.message,'intentional asset replay stop');
assert.equal(result.memory.deviceEvents.find(e=>e.label==='retained-fields-readback').phase,'post-model-observation-retention');
assert.equal(result.memory.deviceEvents.find(e=>e.label==='asset-readback').phase,'post-model-material-readback');
assert.equal(result.memory.device.peakPhase,'post-model-material-readback');
console.log('Actual witness/observer control flow assigns post-model readback to its true phase; synthetic ports are not native model execution.');
