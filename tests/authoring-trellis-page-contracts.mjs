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
        return {runId,route,withForeground:(phase,work)=>work(),async finish(){events.push('finish');return {status:release};}};},
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

test('the caller names where the pixels came from and the GLB provenance keeps it',async()=>{
  const f=fixture();let seen;f.deps.createTrellisAssetAdapter=options=>{seen=options.provenance;return {async run(){return {glb};},dispose(){}};};
  await call(f,{provenance:{input:'checkpoint package prepared pixels'}});
  assert.equal(seen.input,'checkpoint package prepared pixels');
});

test('the finished asset must be a GLB, and the run returns the receipt checks it passed',async()=>{
  const f=fixture();const result=await call(f);
  assert.equal(result.receiptValidation.ok,true);assert.deepEqual(result.receiptValidation.checks,['route-released','glb-magic']);
  const g=fixture();g.deps.createTrellisAssetAdapter=()=>({async run(){return {glb:new ArrayBuffer(12)};},dispose(){}});
  await assert.rejects(call(g),/not a GLB/);
});

test('each phase records its wall time and the kit GPU time spent in it, settled before the route is released',async()=>{
  const f=fixture();const timing={status:'active',resolvedKernels:0,pendingKernels:0,totalGpuMs:0};let settled=0;
  const runtime={profile:{gpuTiming:timing},async settleGpuTiming(){settled++;timing.totalGpuMs=30;timing.resolvedKernels=3;return timing;},readTensor(){}};
  const base=f.deps.createTrellisSharedHost;
  f.deps.createTrellisSharedHost=async o=>{const h=await base(o);return {...h,async beginRun(x){const r=await h.beginRun(x);r.route.runtime=runtime;return r;}};};
  f.deps.createTrellisImageGenerationAdapter=options=>({async run(){await options.onPhase({phase:'sparse-structure-sampling'});timing.totalGpuMs=10;
    await options.onPhase({phase:'texture'});timing.totalGpuMs=25;return {geometry:{},material:{}};},dispose(){}});
  const result=await call(f);
  assert.equal(settled,1,'GPU timings are settled once, before release');
  const names=result.timing.phases.map(p=>p.phase);
  assert.deepEqual(names,['checkpoint-loading','sparse-structure-sampling','texture']);
  assert.equal(result.timing.phases[1].gpuMs,10,'GPU time inside a phase is the change in the kit total');
  assert.equal(result.timing.phases[2].gpuMs,20,'the last phase ends at the settled total');
  assert.equal(result.timing.gpu.totalGpuMs,30);assert.equal(result.timing.gpu.status,'active');
  assert.ok(result.timing.phases.every(p=>Number.isFinite(p.wallMs)));
});

test('a failed decode is captured before the route is released: tensor bytes, boundary, noise and the stage profile',async()=>{
  const f=fixture({jobStatus:'failed'});const order=[];
  const t=(name,shape,dtype)=>({name,shape,dtype,byteLength:4*shape.reduce((a,b)=>a*b,1)});
  const sample=t('sample',[2,8],'f32'),coords=t('coords',[2,4],'i32'),logits=t('logits',[2,8],'f32');
  const context={mode:'shape',operation:'subdivision-count',level:0,rows:2,resolution:2,plan:{mode:'shape',activationStorage:'f16'},
    inputs:{sample,coordinates:coords,guideSubdivisions:[]},coordinates:coords,features:sample,subdivisionLogits:logits,
    error:{name:'Error',message:'learned decoder generated empty cells; no replacement support'}};
  const runtime={profile:{stages:[{name:'decoder-linear',ms:5,gpuMs:2,gpuStatus:'resolved',metadata:{yields:[1,2]}},{name:'decoder-linear',ms:3,gpuMs:1,gpuStatus:'resolved'}]},
    async readTensor(x){order.push('read:'+x.name);return new ArrayBuffer(x.byteLength);},async settleGpuTiming(){return {status:'active',totalGpuMs:3};}};
  const base=f.deps.createTrellisSharedHost;
  f.deps.createTrellisSharedHost=async o=>{const h=await base(o);return {...h,async beginRun(x){const r=await h.beginRun(x);r.route.runtime=runtime;
    const finish=r.finish;r.finish=async()=>{order.push('finish');return finish();};return r;}};};
  f.deps.createTrellisImageGenerationAdapter=()=>({decoderFailureContext:context,noiseInputs:{sparse:{shape:[1,8],values:new Float32Array(8),seed:42,source:'browser'}},
    async run(){return null;},dispose(){}});
  const error=await call(f).then(()=>null,e=>e);
  assert.match(error.message,/flow diverged/);
  const c=error.trellisCapture;
  assert.ok(c,'the failure carries its capture');
  assert.equal(c.decoder.operation,'subdivision-count');assert.equal(c.decoder.error.message,context.error.message);
  assert.deepEqual(Object.keys(c.tensors).sort(),['coordinates','features','inputs.coordinates','inputs.sample','subdivisionLogits']);
  assert.equal(c.tensors.subdivisionLogits.bytes.byteLength,64);assert.deepEqual(c.tensors.subdivisionLogits.shape,[2,8]);
  assert.equal(c.noise.sparse.values.length,8);
  assert.deepEqual(c.stages['decoder-linear'],{count:2,wallMs:8,gpuMs:3,yields:2});
  assert.ok(order.indexOf('finish')>order.lastIndexOf('read:logits'),'tensors are read before the route releases them');
});

test('scene frames are served while checkpoints load and while the mesh is cleaned and unwrapped',async()=>{
  const {createAppGpuHost}=await import('../app-gpu-host.mjs');
  const kit=await import('../webgpu-inference-kit/src/core.js');
  const {createTrellisSharedHost}=await import('../models/trellis2/shared-host.js');
  const device={features:new Set(),limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**29},lost:new Promise(()=>{}),
    queue:{submit(){},async onSubmittedWorkDone(){}},createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
  const installs=[],owner={setForegroundOpportunityRequester:r=>installs.push(r),foregroundGpuContext:()=>({renderer:'kaminos-app',device,queue:device.queue})};
  const app=createAppGpuHost({sharedGpu:{adapter:{info:{description:'controlled'}},device,queue:device.queue},kit,frameOwner:()=>owner,
    host:{device,setForegroundServiceActive(){},runForegroundFrame:run=>run()}});
  let frames=0,seq=0;const frame=()=>installs[0]({requestId:'frame-'+(++seq),run:()=>{frames++;}}).completion;
  const gate=()=>{let open;const p=new Promise(r=>open=r);return {p,open};};
  const loading=gate(),cleaning=gate(),unwrapping=gate();const seen={};
  const f=fixture();
  const deps={...f.deps,createTrellisSharedHost,
    loadGenerationInputs:async()=>{await loading.p;return {};},
    createTrellisImageGenerationAdapter:()=>({async run(){return {geometry:{},material:{}};},dispose(){}}),
    createTrellisAssetAdapter:options=>({async run(){await options.postprocessMesh({});await options.unwrapMesh({});return {glb};},dispose(){}})};
  const running=runTrellisInPage({appGpu:app,manifest:{id:'pack'},fetchTensor:async()=>new ArrayBuffer(4),pixelValues:new Float32Array(512*512*3),deps,
    finishing:{postprocessMesh:async m=>{await cleaning.p;return m;},unwrapMesh:async m=>{await unwrapping.p;return m;}}});
  const settle=()=>new Promise(r=>setTimeout(r,20));
  await settle();await Promise.race([frame(),settle()]);seen.loading=frames;loading.open();
  await settle();await Promise.race([frame(),settle()]);seen.cleaning=frames;cleaning.open();
  await settle();await Promise.race([frame(),settle()]);seen.unwrapping=frames;unwrapping.open();
  await running;
  assert.deepEqual(seen,{loading:1,cleaning:2,unwrapping:3},'a frame is served inside each CPU span, not only at route finish');
});

// A run whose asset consumer cleans a real (tiny) raw dual-grid mesh, with readable geometry and material tensors.
const rawFixture=()=>{const coords=[[2,2,3],[3,2,3],[2,3,3],[3,3,3],[6,6,6]];
  return {vertices:new Float32Array(coords.flatMap(c=>c.map(v=>(v+.5)/8-.5))),triangles:new Uint32Array([0,1,3,0,3,2])};};
function surfelRun({failMaterial=false}={}){
  const f=fixture(),res=8,coords=[[2,2,3],[3,2,3],[2,3,3],[3,3,3],[6,6,6]];
  const {vertices,triangles}=rawFixture();
  const tensors={gc:new Int32Array(coords.flat()).buffer,mc:new Int32Array(coords.flat()).buffer,
    mf:new Float32Array(coords.flatMap(()=>[1,-1,-1,-1,.8,1])).buffer};
  const outputs={geometry:{coordinates:{id:'gc'},resolution:res},material:{coordinates:{id:'mc'},features:{id:'mf'},resolution:res}};
  const runtime={async readTensor(t){if(failMaterial&&t.id==='mf')throw Error('material readback lost');return tensors[t.id].slice(0);}};
  const host=f.deps.createTrellisSharedHost;
  f.deps.createTrellisSharedHost=async args=>{const h=await host(args);const begin=h.beginRun;h.beginRun=async o=>{const r=await begin(o);r.route={...r.route,runtime};return r;};return h;};
  f.deps.createTrellisImageGenerationAdapter=()=>({outputs,async run(){return outputs;},dispose(){}});
  f.deps.createTrellisAssetAdapter=options=>({async run(){await options.postprocessMesh({vertices,triangles});return {glb};},dispose(){}});
  return f;
}

test('every page run also yields a surfel asset from the decoded field, read before the route is released',async()=>{
  const {readSurfelGLBExtension}=await import('../trellis-surfels.mjs');
  const result=await call(surfelRun());
  assert.equal(result.glb,glb,'the mesh is unchanged');
  assert.equal(result.surfels.count,5);assert.equal(result.surfels.status,'built');
  const {field}=readSurfelGLBExtension(result.surfelGlb);
  assert.equal(field.count,5);assert.deepEqual([...field.color.subarray(0,3)],[255,0,0]);
});

test('a surfel failure is recorded but never costs the mesh',async()=>{
  const result=await call(surfelRun({failMaterial:true}));
  assert.equal(result.glb,glb);assert.equal(result.surfelGlb,null);
  assert.equal(result.surfels.status,'failed');assert.match(result.surfels.error,/material readback lost/);
});

test('surfels are built from the raw mesh before cleanup, so a failed finish still carries them',async()=>{
  const f=surfelRun();const adapter=f.deps.createTrellisAssetAdapter;
  f.deps.createTrellisAssetAdapter=options=>({...adapter(options),async run(){await options.postprocessMesh(rawFixture());throw Error('UV unwrap failed');},dispose(){}});
  const error=await call(f).catch(e=>e);
  assert.match(error.message,/UV unwrap failed/);
  assert.equal(error.trellisSurfels?.surfels?.status,'built');assert.ok(error.trellisSurfels.surfelGlb.byteLength>0);
});

test('finishMesh:false yields the surfel asset without cleanup, UV or bake',async()=>{
  const f=surfelRun();let assetBuilt=false;const adapter=f.deps.createTrellisAssetAdapter;
  f.deps.createTrellisAssetAdapter=o=>{assetBuilt=true;return adapter(o);};
  f.deps.createTrellisMeshAdapter=()=>({async run(){return {status:'surface',...rawFixture()};},dispose(){}});
  const result=await call(f,{finishMesh:false,finishing:undefined});
  assert.equal(assetBuilt,false,'no mesh finishing');assert.equal(result.glb,null);
  assert.equal(result.surfels.status,'built');assert.equal(result.surfels.count,5);
});

test('a run hands back its raw decode and material fields for GI tiers, as copies the cleanup cannot take away',async()=>{
  const f=surfelRun();const adapter=f.deps.createTrellisAssetAdapter;
  // a cleanup that takes ownership of its input (as the worker transfer does) by zeroing it
  f.deps.createTrellisAssetAdapter=options=>({...adapter(options),async run(){const raw=rawFixture();await options.postprocessMesh(raw);raw.vertices.fill(0);return {glb};},dispose(){}});
  const result=await call(f);
  const {decode,materialFields}=result.levelInputs;
  assert.deepEqual([...decode.vertices.subarray(0,3)],[...rawFixture().vertices.subarray(0,3)]);
  assert.equal(decode.triangles.length,6);assert.equal(materialFields.resolution,8);
  assert.equal(materialFields.features.length,5*6);assert.equal(materialFields.coordinates.length,5*3);
});
