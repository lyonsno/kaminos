// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppGpuHost} from '../app-gpu-host.mjs';
import * as kit from '../webgpu-inference-kit/src/core.js';
import {createTrellisSharedHost} from '../models/trellis2/shared-host.js';
import {runTrellisInPage} from '../authoring-trellis-page.mjs';
import {createTrellisApp} from '../models/trellis2/trellis-app.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const glb=new Uint32Array([0x46546c67,2,12]).buffer;
function fixture({now}={}){
  const events=[];
  const device={features:new Set(),limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**29},lost:new Promise(()=>{}),
    queue:{submit(){events.push('submit');},async onSubmittedWorkDone(){events.push('settled');}},
    createCommandEncoder(){events.push('encode');return{beginComputePass(){return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return{};}};}};
  const owner={setForegroundOpportunityRequester(){events.push('install');},foregroundGpuContext:()=>({renderer:'kaminos-app',device,queue:device.queue})};
  const appGpu=createAppGpuHost({sharedGpu:{device,queue:device.queue,adapter:{info:{description:'controlled-test-device'}}},
    kit:{...kit,createWebGpuForegroundService:options=>kit.createWebGpuForegroundService({...options,...(now?{now}:{})})},
    frameOwner:()=>owner,host:{device,setForegroundServiceActive(){},runForegroundFrame:work=>work()}});
  const deps={createTrellisSharedHost,
    async loadGenerationInputs(){events.push('load');return{};},
    createTrellisImageGenerationAdapter({route}){return{async run(invocation){events.push('model');
      await route.runtime.runKernel({name:'controlled-model',pipeline:{},bindGroup:{},bindings:[]},{stage:'model',dispatch:[1],schedulerInvocation:invocation});
      return{geometry:{},material:{}};},dispose(){events.push('model.dispose');}};},
    createTrellisAssetAdapter(){return{async run(){events.push('asset');return{glb};},dispose(){events.push('asset.dispose');}};},
  };
  return{appGpu,device,deps,events};
}
const options=f=>({appGpu:f.appGpu,manifest:{},fetchTensor:async()=>{},pixelValues:new Float32Array(512*512*3),
  finishing:{postprocessMesh:async m=>m,unwrapMesh:async m=>m},deps:f.deps});

test('the actual page waits for shared admission before taking foreground or loading model inputs',async()=>{
  const f=fixture(),session=await f.appGpu.session(),entered=deferred(),release=deferred();
  const other=await session.registerRoute({routeId:'other-model'});
  const job=other.enqueue({jobId:'held-other-model',async execute(){entered.resolve();await release.promise;}});
  await entered.promise;
  const result=runTrellisInPage(options(f));
  // Attach the rejection before assertions so failed pre-fix cleanup is observed.
  result.catch(()=>{});
  try{
    await new Promise(setImmediate);
    assert.equal(f.appGpu.unsettledRuns().length,0,'TRELLIS took foreground before its queue admission');
    assert.ok(!f.events.includes('load'),'TRELLIS prepared its model before admission');
  }finally{release.resolve();await job.completion;}
  assert.equal((await result).glb,glb);
  assert.equal(f.appGpu.unsettledRuns().length,0);
  await other.drain();session.unregisterRoute(other.routeId);session.close();await f.appGpu.foreground.dispose();
});

test('queued cancellation leaves the other model foreground alone, then the same app can retry',async()=>{
  const f=fixture(),session=await f.appGpu.session(),entered=deferred(),release=deferred();
  const other=await session.registerRoute({routeId:'other-model'});
  const job=other.enqueue({jobId:'other',async execute(){
    const frame=await f.appGpu.beginRun('other',{routeId:'other-model'});
    entered.resolve();await release.promise;await frame.finish();
  }});
  await entered.promise;
  const app=await createTrellisApp(options(f)),running=app.generate();running.catch(()=>{});
  await new Promise(setImmediate);
  assert.equal(app.snapshot().phase,'queued');
  app.stop('cancel pending TRELLIS');await assert.rejects(running,{name:'AbortError'});
  assert.equal(f.appGpu.foreground.snapshot().activeRun.runId,'other');
  assert.deepEqual(f.appGpu.unsettledRuns(),['other']);
  release.resolve();await job.completion;
  assert.equal((await app.generate()).glb,glb);
  assert.equal((await app.generate()).glb,glb);
  await app.destroy();assert.equal(session.snapshot().status,'active');
  assert.equal(f.appGpu.foreground.snapshot().disposed,false);
  await other.drain();session.unregisterRoute(other.routeId);session.close();await f.appGpu.foreground.dispose();
});

test('pause parks the next real runtime duty while the host keeps serving frames',async()=>{
  const f=fixture(),entered=deferred(),next=deferred(),produce=f.deps.createTrellisImageGenerationAdapter;
  f.deps.createTrellisImageGenerationAdapter=options=>{
    const original=produce(options);return {...original,async run(invocation){
      await original.run(invocation);entered.resolve();await next.promise;return original.run(invocation);
    }};
  };
  const app=await createTrellisApp(options(f)),running=app.generate();await entered.promise;
  await assert.rejects(app.generate(),/already running/);
  assert.equal((await app.pause()).status,'paused');
  const count=f.events.filter(e=>e==='encode').length;
  const frame=f.appGpu.foreground.request({requestId:'paused-frame',run:ctx=>ctx.submit([{}])});
  await frame.completion;
  next.resolve();await new Promise(setImmediate);
  assert.equal(f.events.filter(e=>e==='encode').length,count,'no next duty while paused');
  await app.resume();assert.equal((await running).glb,glb);
  assert.equal(f.events.filter(e=>e==='encode').length,count+1);
  await app.destroy();const session=await f.appGpu.session();session.close();await f.appGpu.foreground.dispose();
});

test('Stop delivered by a foreground callback prevents the following model encode',async()=>{
  const f=fixture(),produce=f.deps.createTrellisImageGenerationAdapter,abort=new AbortController();let frame;
  f.deps.createTrellisImageGenerationAdapter=options=>{const original=produce(options);return {...original,async run(invocation){
    frame=f.appGpu.foreground.request({requestId:'stop-frame',run:ctx=>{abort.abort('Stop at frame');ctx.submit([{}]);}});
    return original.run(invocation);
  }};};
  const app=await createTrellisApp(options(f));await assert.rejects(app.generate({signal:abort.signal}),{name:'AbortError'});
  await frame.completion;assert.ok(!f.events.includes('encode'));
  assert.equal(f.appGpu.unsettledRuns().length,0);
  await app.destroy();const session=await f.appGpu.session();session.close();await f.appGpu.foreground.dispose();
});

test('a failed queue fence retains resident model resources and poisons reuse',async()=>{
  const f=fixture(),produce=f.deps.createTrellisImageGenerationAdapter;let fail=false,bufferDestroyed=0;
  f.device.createBuffer=({size})=>({size,destroy(){bufferDestroyed++;}});
  f.device.queue.onSubmittedWorkDone=async()=>{if(fail)throw Error('completion lost');};
  f.deps.createTrellisImageGenerationAdapter=options=>{const original=produce(options);
    options.route.runtime.createBuffer({size:4,usage:128,label:'resident-model-field'});return {...original,async run(invocation){
      const out=await original.run(invocation);fail=true;return out;
    }};
  };
  const app=await createTrellisApp(options(f));
  await assert.rejects(app.generate(),error=>error.gpuRouteHeld===true);
  assert.equal(app.snapshot().gpuRouteHeld,true);assert.equal(bufferDestroyed,0);
  assert.ok(!f.events.includes('model.dispose'));assert.ok(!f.events.includes('asset.dispose'));
  await assert.rejects(app.generate(),/not released/);await assert.rejects(app.destroy(),/not released/);
  const session=await f.appGpu.session();assert.ok(session.snapshot().routes.some(r=>r.routeId===app.routeId));
  // Fixture-only recovery after observing the held state, never production certification.
  fail=false;await session.drain();session.close();await f.appGpu.foreground.dispose();
});

test('successful model settlement cannot erase a failed foreground finish and host hold',async()=>{
  let breakFinish=false,arm=false;
  const f=fixture({now(){if(breakFinish)throw Error('foreground finish observation failed');return performance.now();}});
  f.device.queue.onSubmittedWorkDone=async()=>{if(arm)breakFinish=true;};
  f.deps.createTrellisAssetAdapter=()=>({async run(){
    f.appGpu.foreground.request({requestId:'last-frame',run(){}});arm=true;return{glb};
  },dispose(){f.events.push('asset.dispose');}});
  const app=await createTrellisApp(options(f));
  await assert.rejects(app.generate(),error=>error.gpuRouteHeld===true);
  assert.equal(app.snapshot().gpuRouteHeld,true);
  assert.equal(f.appGpu.unsettledRuns().length,1,'the actual host keeps its unresolved-release ledger');
  await assert.rejects(app.destroy(),error=>error.gpuRouteHeld===true);
  assert.equal(f.appGpu.unsettledRuns().length,1);
});
