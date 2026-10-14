// kaminos-test: node — TRELLIS in the page on the app GPU host, with controlled model stages
import test from 'node:test';import assert from 'node:assert/strict';
import {runTrellisInPage} from '../authoring-trellis-page.mjs';

const glb=new Uint8Array([0x67,0x6c,0x54,0x46,2,0,0,0,12,0,0,0]).buffer;
function fixture({jobStatus='succeeded',release='released'}={}){
  const events=[],session={id:'app-session'};
  const appGpu={device:{},queue:{},async session(){events.push('session');return session;},
    beginRun(runId,options){events.push(['app.beginRun',options.routeId]);return {routeId:options.routeId};}};
  const outputs={geometry:{g:1},material:{m:1}};
  const route={routeId:'trellis2.image-generation.webgpu.v0',runtime:{readTensor(){}},
    enqueue(job){events.push('enqueue');return {completion:(async()=>{const output=await job.execute('invocation');
      return jobStatus==='succeeded'?{status:'succeeded',output}:{status:jobStatus,failure:{name:'Error',message:'flow diverged'}};})()};}};
  const deps={
    async createTrellisSharedHost({appGpu:facade}){events.push(['host',facade.session===session,typeof facade.beginRun]);
      return {async beginRun({runId,signal}){events.push(['beginRun',typeof runId,signal instanceof AbortSignal]);
        return {runId,route,async finish(){events.push('finish');return {status:release};}};},
        async dispose(){events.push('host.dispose');}};},
    async loadGenerationInputs(manifest,fetchTensor,input){events.push(['inputs',manifest.id,input.pixelValues.length]);return {seed:42};},
    createTrellisImageGenerationAdapter(options){events.push(['adapter',options.route===route,options.seed]);
      return {outputs,async run(invocation){events.push(['model',invocation]);return outputs;},dispose(){events.push('adapter.dispose');}};},
    createTrellisAssetAdapter(options){events.push(['asset',options.geometry===outputs.geometry,typeof options.postprocessMesh,typeof options.unwrapMesh]);
      return {async run(){events.push('asset.run');return {glb,mesh:{uvMetadata:{}},textures:{metadata:{}}};},dispose(){events.push('asset.dispose');}};},
  };
  return {events,appGpu,deps};
}
const call=(f,extra={})=>runTrellisInPage({appGpu:f.appGpu,manifest:{id:'pack'},fetchTensor:async()=>new ArrayBuffer(4),
  pixelValues:new Float32Array(512*512*3),finishing:{postprocessMesh:async m=>m,unwrapMesh:async m=>m},deps:f.deps,...extra});

test('the selected pixels run on the app host and the GLB is finished before the run releases the GPU route',async()=>{
  const f=fixture();const result=await call(f);
  assert.equal(result.glb,glb);
  const names=f.events.map(e=>Array.isArray(e)?e[0]:e);
  assert.deepEqual(names,['session','host','beginRun','inputs','adapter','enqueue','model','asset','asset.run','finish','asset.dispose','adapter.dispose','host.dispose']);
  assert.deepEqual(f.events[1],['host',true,'function'],'TRELLIS receives the resolved app session, not the accessor');
  assert.deepEqual(f.events[2],['beginRun','string',true]);
  assert.deepEqual(f.events[3],['inputs','pack',512*512*3]);
  assert.deepEqual(f.events[7],['asset',true,'function','function']);
});

test('a failed model job reports its own failure, releases the run and makes no asset',async()=>{
  const f=fixture({jobStatus:'failed'});
  await assert.rejects(call(f),/flow diverged/);
  const names=f.events.map(e=>Array.isArray(e)?e[0]:e);
  assert.ok(!names.includes('asset'));assert.ok(names.includes('finish'));
});

test('a run the host cannot release keeps its resources and says so',async()=>{
  const f=fixture({release:'held'});
  await assert.rejects(call(f),/TRELLIS GPU route was not released: held/);
  assert.ok(!f.events.includes('host.dispose'));
});

test('selected pixels are required; the checkpoint package image is never used in their place',async()=>{
  const f=fixture();
  await assert.rejects(call(f,{pixelValues:undefined}),/prepared 512x512 RGB/);
  assert.equal(f.events.length,0);
});

test('the real app GPU host and the real TRELLIS bridge compose, with frames on the one app service',async()=>{
  const {createAppGpuHost}=await import('../app-gpu-host.mjs');
  const kit=await import('../webgpu-inference-kit/src/core.js');
  const {createTrellisSharedHost}=await import('../models/trellis2/shared-host.js');
  const device={features:new Set(),limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**29},lost:new Promise(()=>{}),
    queue:{submit(){},async onSubmittedWorkDone(){}},createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
  const installs=[],owner={setForegroundOpportunityRequester:r=>installs.push(r),foregroundGpuContext:()=>({renderer:'kaminos-app',device,queue:device.queue})};
  const app=createAppGpuHost({sharedGpu:{adapter:{info:{description:'controlled'}},device,queue:device.queue},kit,frameOwner:()=>owner,
    host:{device,setForegroundServiceActive(){},runForegroundFrame:run=>run()}});
  const f=fixture();let sawRoute=null;
  const deps={...f.deps,createTrellisSharedHost,
    createTrellisImageGenerationAdapter:options=>{sawRoute=options.route.routeId;
      return {async run(){return {geometry:{},material:{}};},dispose(){}};}};
  const result=await runTrellisInPage({appGpu:app,manifest:{id:'pack'},fetchTensor:async()=>new ArrayBuffer(4),
    pixelValues:new Float32Array(512*512*3),finishing:{postprocessMesh:async m=>m,unwrapMesh:async m=>m},deps});
  assert.equal(result.glb,glb);assert.equal(sawRoute,'trellis2.image-generation.webgpu.v0');
  assert.equal(installs.length,1,'frames go through the app requester');
  assert.equal(app.snapshot().foreground.activeRun,null,'the run released the app service');
  const sessionRoutes=(await app.session()).snapshot().routes;assert.equal(sessionRoutes.length,0,'the TRELLIS route was unregistered');
});

test('the checkpoint package is read from the server mount, identity-checked against the runtime config',async()=>{
  const {createTrellisPageCheckpoints}=await import('../authoring-trellis-page.mjs');
  const {createHash}=await import('node:crypto');
  const tensor=new Float32Array([1,2,3]).buffer,sha=b=>createHash('sha256').update(new Uint8Array(b)).digest('hex');
  const manifestBytes=new TextEncoder().encode(JSON.stringify({image:{pixelTensor:'px'},tensors:{px:{file:'px.f32',byteLength:12,sha256:sha(tensor)}}}));
  const files={'/trellis-checkpoints/manifest.json':manifestBytes.buffer,'/trellis-checkpoints/px.f32':tensor};
  const fetch=async url=>files[url]?{ok:true,arrayBuffer:async()=>files[url].slice(0)}:{ok:false,status:404};
  const pack=await createTrellisPageCheckpoints({config:{checkpointUrl:'/trellis-checkpoints',mounted:true,manifestSha256:sha(manifestBytes.buffer)},fetch});
  assert.deepEqual([...await pack.fetchTensor('px')],[1,2,3]);
  assert.equal(pack.manifestSha256,sha(manifestBytes.buffer));
  await assert.rejects(createTrellisPageCheckpoints({config:{checkpointUrl:'/trellis-checkpoints',mounted:true,manifestSha256:'0'.repeat(64)},fetch}),/manifest changed/);
  await assert.rejects(createTrellisPageCheckpoints({config:null,fetch}),/no TRELLIS checkpoint package/);
});

test('f16 decoder activations are applied to a copy of the manifest, and refused without shader-f16',async()=>{
  const f=fixture();let seen;
  const manifest={id:'pack',models:{shapeDecoder:{config:{}},textureDecoder:{config:{}}}};
  f.deps.loadGenerationInputs=async m=>{seen=m;return {};};
  await call(f,{manifest,decoderActivationStorage:'f16'});
  assert.equal(seen.models.shapeDecoder.config.activationStorage,'f16');assert.equal(seen.models.textureDecoder.config.activationStorage,'f16');
  assert.equal(manifest.models.shapeDecoder.config.activationStorage,undefined,'the mounted manifest is not changed');
  const g=fixture();g.appGpu.device={features:new Set()};
  await assert.rejects(call(g,{manifest,decoderActivationStorage:'f16'}),/shader-f16/);
});
