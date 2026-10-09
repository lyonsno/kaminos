import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {m} from './generation-input-fixture.js';
import {createWebGpuInferenceQueue} from '../../../webgpu-inference-kit/src/inference-queue.js';
import {GENERATION_ROUTE,generationPhases,generationModelCallCounts} from '../sparse-generation-witness-checks.js';

// Synthetic model ports exercise actual observer control flow, not GPU inference.
const manifest=new TextEncoder().encode(JSON.stringify(m)),sha=Buffer.from(await webcrypto.subtle.digest('SHA-256',manifest)).toString('hex');
let assets=0,devices=0,profileOptions;
const device={createBuffer(d){return{size:d.size,destroy(){}};},destroy(){},pushErrorScope(){},async popErrorScope(){return null;},
  addEventListener(){},lost:new Promise(()=>{})},
  adapter={info:{vendor:'apple',architecture:'metal-3',isFallbackAdapter:false},
    limits:{maxStorageBufferBindingSize:4294967292,maxBufferSize:4294967292,maxComputeWorkgroupsPerDimension:65535},
    async requestDevice(){devices++;return device;}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{async requestAdapter(){return adapter;}}}});
globalThis.fetch=async url=>url==='/fixture/manifest.json'?new Response(manifest):new Response('');
const tensor=(shape,dtype='f32')=>({shape,dtype,buffer:{},byteLength:shape.reduce((n,x)=>n*x,4)});
const levels=[4,6,7,8,5].map((rows,i)=>({rows,resolution:64*2**i,channels:[1024,512,256,128,64][i],blocksExecuted:[4,16,8,4,0][i]}));
const noise={sparse:{shape:[1,8,16,16,16],values:new Float32Array(32768)},lowResolutionShape:{shape:[3,32],values:new Float32Array(96)},
  highResolutionShape:{shape:[4,32],values:new Float32Array(128)},texture:{shape:[4,32],values:new Float32Array(128)}};
const runtime={device,routeId:GENERATION_ROUTE,async runInvocation(info,fn){return fn(info);},
  async readTensor(t){return new ArrayBuffer(t.byteLength);},
  async runKernel(){},finishProfile(options){profileOptions=options;return{routeId:GENERATION_ROUTE,evidence:{mode:'live'}};}};
globalThis.fieldsOnlyPorts={
  async createSession(){const queue=createWebGpuInferenceQueue({runtime});return{
    async registerRoute(){return{routeId:GENERATION_ROUTE,runtime,enqueue:queue.enqueue};},
    snapshot(){return{sessionId:'synthetic-fields-only'};},drain:queue.drain,close(){}};},
  async loadInputs(){return{};},
  createAdapter({onPhase,route}){return{noiseInputs:noise,async run(invocation){
    for(const [phase,calls]of Object.entries(generationModelCallCounts(m))){
      await onPhase({phase});
      for(let i=0;i<calls;i++){
        await route.runtime.runKernel({}, {stage:'terminal-output-projection',schedulerInvocation:invocation,dispatch:[1]});
        for(let j=0;j<30;j++)await route.runtime.runKernel({}, {stage:'block-modulation',schedulerInvocation:invocation,dispatch:[1]});
      }
    }
    this.outputs={dino:{blocksExecuted:24},conditioning:tensor([1,1029,1024]),lowResolutionRows:3,highResolutionRows:4,
      geometry:{features:tensor([5,7]),coordinates:tensor([5,3],'i32'),subdivisions:levels.slice(0,4).map(l=>tensor([l.rows,8])),levels,resolution:1024},
      material:{features:tensor([5,6]),coordinates:tensor([5,3],'i32'),levels,resolution:1024},
      shapeCodes:tensor([4,32]),textureCodes:tensor([4,32]),phases:generationPhases(m).map(phase=>({phase})),
      pipelineType:'1024_cascade',featureBytesToCPUDuringServing:0,coordinateBytesToCPUDuringServing:0};
    return this.outputs;
  },dispose(){}};},
  createAsset(){assets++;return{async run(){throw Error('intentional raw-asset sentinel');},dispose(){}};}
};
let source=await fs.readFile(new URL('../sparse-generation-witness.js',import.meta.url),'utf8');
source=source.replace(/import \{createWebGpuInferenceSession\}[^;]+;/,'const {createSession:createWebGpuInferenceSession}=globalThis.fieldsOnlyPorts;')
  .replace(/import \{createTrellisImageGenerationAdapter\}[^;]+;/,'const {createAdapter:createTrellisImageGenerationAdapter}=globalThis.fieldsOnlyPorts;')
  .replace(/import \{createTrellisAssetAdapter\}[^;]+;/,'const {createAsset:createTrellisAssetAdapter}=globalThis.fieldsOnlyPorts;')
  .replace(/import \{loadGenerationInputs,validateGenerationInputs,generationPipelineType\}[^;]+;/,
    `import {validateGenerationInputs,generationPipelineType} from '${new URL('../generation-inputs.js',import.meta.url)}';const {loadInputs:loadGenerationInputs}=globalThis.fieldsOnlyPorts;`)
  .replaceAll("from './",`from '${new URL('../',import.meta.url)}`);
const {runGenerationWitness}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const fields=await runGenerationWitness(sha,{assetMode:'retained-fields-only'});
assert.equal(fields.status,'succeeded','explicit fields-only execution must bypass raw UV/bake after retaining complete model fields: '+fields.error?.message);
assert.equal(assets,0);assert.equal(fields.assetMode,'retained-fields-only');assert.equal(fields.assetArtifact,undefined);
assert.equal(Object.keys(fields.outputs).length,15);assert.ok(profileOptions.requiredStages.includes('decoder-sparse-conv'));
assert.match(fields.handoff,/fields/);assert.doesNotMatch(fields.handoff,/become retained PBR GLB/);
const ordinary=await runGenerationWitness(sha);assert.equal(ordinary.status,'failed');
assert.equal(ordinary.error.message,'intentional raw-asset sentinel');assert.equal(assets,1);
const before=devices,bad=await runGenerationWitness(sha,{assetMode:'unknown'});
assert.equal(bad.status,'failed');assert.match(bad.error.message,/asset mode/);assert.equal(devices,before);
console.log('Explicit fields-only handoff retains the complete model contract without raw UV/bake; default raw export and unknown-mode refusal remain visible. Synthetic ports do not prove native inference.');
