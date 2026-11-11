// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createAppGpuHost} from '../app-gpu-host.mjs';
import {createSceneFrameComposition} from '../scene-frame-composition.mjs';
import {createWebGpuForegroundService} from '../webgpu-inference-kit/src/foreground-opportunity.js';
const module=await import('../volume-worker-frame-binding.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const factory=()=>{assert.equal(typeof module.createVolumeWorkerFrameBinding,'function','ordinary worker needs a flame frame binding inside the real app foreground service');return module.createVolumeWorkerFrameBinding;};
function fixture({held=false,apply=()=>{}}={}){
 const submissions=[],calls=[];let sceneCount=0,binding;
 const device={queue:{submit:buffers=>submissions.push(...buffers)}};
 const scene=createSceneFrameComposition({readInputs:()=>({}),frameCount:()=>sceneCount,draw:()=>{calls.push('scene');sceneCount++;}});
 const appHost=createAppGpuHost({sharedGpu:{device},host:scene,kit:{createWebGpuForegroundService},frameOwner:()=>binding});
 const volume={foregroundGpuContext:()=>({device,queue:device.queue,renderer:'ordinary-volume',productFrameOwner:'prototype'}),renderSharedFrame({now,service}){
  calls.push('flame');if(held)return {status:'held',reason:'inactive'};
  assert.equal(service.device,device);service.submit(['flame-'+now]);return {status:'submitted',frameCount:1};
 }};
 binding=factory()({appHost,volume,applyFrameInputs:(payload,ctx)=>{calls.push('inputs');return apply(payload,ctx);}});
 const controller=new AbortController(),ctx={signal:controller.signal,assertCurrent(){if(controller.signal.aborted)throw Error('stale frame');}};
 return {binding,appHost,controller,ctx,submissions,calls,volume,device,close:()=>appHost.foreground.dispose(),draw:payload=>binding.frame(payload,ctx)};
}
test('ordinary worker binds actual foreground, inputs, flame and host fallback in order',async()=>{
 const f=fixture();try{
  assert.throws(()=>f.draw({now:10}),/foreground admission/);
  const receipt=await f.binding.requestFrame({now:10},f.ctx,()=>f.draw({now:10}));
  assert.equal(receipt.status,'completed');assert.equal(receipt.result.sceneDrawn,true);assert.deepEqual(f.calls,['inputs','flame','scene']);assert.deepEqual(f.submissions,['flame-10']);
 }finally{await f.close();}
});
test('inactive flame still allows the actual ordinary scene to draw',async()=>{
 const f=fixture({held:true});try{const r=await f.binding.requestFrame({now:10},f.ctx,()=>f.draw({now:10}));assert.equal(r.result.status,'held');assert.equal(r.result.sceneDrawn,true);assert.deepEqual(f.submissions,[]);}finally{await f.close();}
});
test('model borrows the binding without installing a private volume requester',async()=>{
 const f=fixture();let run;try{
  run=await f.appHost.beginRun('model',{routeId:'model.test'});
  const frame=f.binding.requestFrame({now:20},f.ctx,()=>f.draw({now:20}));assert.deepEqual(f.calls,[]);
  await run.withForeground('model-cpu-wait',async()=>{const r=await frame;assert.equal(r.status,'completed');assert.deepEqual(f.submissions,['flame-20']);});
 }finally{await run?.finish();await f.close();}
});
test('cancelled queued frame settles before returning and cannot draw stale inputs',async()=>{
 const f=fixture();let run;try{
  run=await f.appHost.beginRun('model',{routeId:'model.test'});
  const pending=f.binding.requestFrame({now:20},f.ctx,()=>f.draw({now:20}));f.controller.abort('replaced');
  await assert.rejects(pending,/stale frame/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.submissions,[]);
 }finally{await run?.finish();await f.close();}
});
test('asynchronous frame input callbacks reject before flame submission',async()=>{
 const f=fixture({apply:()=>Promise.resolve()});try{await assert.rejects(f.binding.requestFrame({now:10},f.ctx,()=>f.draw({now:10})),/synchronous/);assert.deepEqual(f.calls,['inputs']);assert.deepEqual(f.submissions,[]);}finally{await f.close();}
});
test('binding rejects a second requester and a volume on another device',async()=>{
 const f=fixture();try{
  assert.throws(()=>f.binding.setForegroundOpportunityRequester(()=>{}),/app foreground/);
  assert.throws(()=>factory()({appHost:f.appHost,volume:{...f.volume,foregroundGpuContext:()=>({device:{},queue:f.device.queue})}}),/device/);
 }finally{await f.close();}
});
test('production worker facade consumes the binding and retires after actual receipt',async()=>{
 const {MessageChannel}=await import('node:worker_threads');
 const {installSceneWorkerHost,createSceneWorkerClient}=await import('../scene-worker-handoff.mjs');
 const f=fixture(),{port1,port2}=new MessageChannel();
 const host=installSceneWorkerHost({port:port1,createRuntime:async()=>({host:f.appHost,frame:f.binding.frame,requestFrame:f.binding.requestFrame,retire:f.close})});
 const client=createSceneWorkerClient({port:port2,sessionId:'ordinary-flame-consumer'});
 try{
  await client.initialize({}).completion;
  const r=await client.request('frame',{now:30}).completion;
  assert.equal(r.output.status,'completed');assert.equal(r.output.result.status,'submitted');assert.equal(r.output.result.sceneDrawn,true);
  assert.deepEqual(f.submissions,['flame-30']);
  await client.request('retire').completion;assert.equal(host.read().phase,'retired');
 }finally{client.disconnect();host.disconnect();port1.close();port2.close();await f.close();}
});


test('explicit dormant volume can draw an empty ordinary scene and validates its device when later activated',async()=>{
 const f=fixture();let gpu=null,active=false;
 f.volume.foregroundGpuContext=()=>({device:gpu,queue:gpu?.queue,active,renderer:'ordinary-volume',productFrameOwner:'prototype'});
 try{
  assert.throws(()=>factory()({appHost:f.appHost,volume:f.volume}),/shared device/);
  const binding=factory()({appHost:f.appHost,volume:f.volume,allowDormant:true});
  f.volume.renderSharedFrame=()=>active?{status:'submitted'}:{status:'held',reason:'inactive'};
  const draw=()=>binding.frame({now:10},f.ctx);
  assert.equal((await binding.requestFrame({},f.ctx,draw)).result.sceneDrawn,true);
  gpu={queue:f.device.queue};active=true;
  await assert.rejects(binding.requestFrame({},f.ctx,draw),/shared device/);
  gpu=null;await assert.rejects(binding.requestFrame({},f.ctx,draw),/shared device/);
  gpu=f.device;assert.equal((await binding.requestFrame({},f.ctx,draw)).result.status,'submitted');
 }finally{await f.close();}
});
