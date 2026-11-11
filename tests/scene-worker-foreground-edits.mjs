// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createSceneWorkerClient,installSceneWorkerHost} from '../scene-worker-handoff.mjs';
import {createWebGpuForegroundService} from '../webgpu-inference-kit/src/core.js';
import {createSceneFrameComposition} from '../scene-frame-composition.mjs';
import {createSceneWorkerMutationBinding} from '../scene-worker-mutation-binding.mjs';
import * as THREE from '../lib/three.webgpu.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function turns(){await tick();await tick();await tick();}
async function fixture(t,{normal={},edits={},admission,draw}={}){
 const object=new THREE.Object3D(),started=deferred(),finish=deferred(),calls=[];
 const device={queue:{submit(){}}};let draws=0,run;
 const composition=createSceneFrameComposition({readInputs:()=>({}),draw:()=>{draw?.(object);draws++;},frameCount:()=>draws});
 const foreground=createWebGpuForegroundService({routeId:'scene.edits',device});
 const appHost={device,queue:device.queue,activateFrames:async()=>composition.setForegroundServiceActive(true),
  requester:request=>foreground.request({...request,run:service=>composition.runForegroundFrame(()=>request.run(service))})};
 const requestMutation=admission??createSceneWorkerMutationBinding({appHost}).requestMutation;
 const {port1,port2}=new MessageChannel();
 const host=installSceneWorkerHost({port:port2,createRuntime:async()=>({
  commands:{model:async(_,ctx)=>{
   const snapshot=object.position.x;run=await foreground.beginRun('model:1',{routeId:'klein'});
   return ctx.withFrames(async()=>{started.resolve();try{await finish.promise;return {snapshot};}finally{await run.finish();}});
  },...normal},foregroundCommands:{move:(value,ctx,service)=>{
   assert.equal(service.device,device);ctx.assertCurrent();calls.push(value);object.position.x=value;return {x:value};
  },...edits},requestMutation,requestFrame:async(payload,ctx,draw)=>{
   await appHost.activateFrames();return appHost.requester({requestId:ctx.requestId,run:()=>draw()}).completion;
  },frame:()=>({x:object.position.x}),retire:()=>true,
 })});
 const client=createSceneWorkerClient({port:port1,sessionId:'edits'});
 t.after(async()=>{finish.resolve();client.disconnect();host.disconnect();port1.close();port2.close();await foreground.dispose();});
 await client.initialize({}).completion;
 const model=client.request('model');model.completion.catch(()=>{});await started.promise;
 const boundary=()=>run.foregroundOpportunities.serviceAtBoundary({invocationId:'model:1',boundaryId:'edit-boundary',dutyId:'duty:1',phase:'denoise',position:'before-encode'});
 const close=async()=>{finish.resolve();return model.completion;};
 return {client,host,object,calls,model,finish,boundary,close,foreground,draws:()=>draws};
}
test('opted-in synchronous edits apply at actual Kit boundaries during model work and preserve the model snapshot',async t=>{
 const f=await fixture(t);let completed=false;
 const first=f.client.request('move',3),second=f.client.request('move',7);
 first.completion.catch(()=>{});second.completion.catch(()=>{});
 try{
  await turns();assert.equal(f.object.position.x,0,'pending is not applied');
  await f.boundary();await turns();await f.boundary();await turns();
  assert.deepEqual(f.calls,[3,7],'foreground edits must apply before the model completes');
  const receipt=await second.completion;completed=true;
  assert.equal(receipt.output.foregroundReceipt.status,'completed');assert.equal(receipt.output.mutationApplied,true);
  assert.deepEqual(receipt.output.value,{x:7});assert.equal(f.draws(),2);
  assert.deepEqual(receipt.epoch,{scene:0,load:0,device:0});
 }finally{await f.close();await Promise.allSettled([first.completion,second.completion]);}
 assert.equal(completed,true);assert.equal((await f.model.completion).output.snapshot,0);
});
test('an earlier ordinary authored operation blocks later foreground edits while navigation still passes',async t=>{
 let asynchronousApplied=false;
 const f=await fixture(t,{normal:{load:async()=>{asynchronousApplied=true;}}});
 const before=f.client.request('move',1),load=f.client.request('load'),after=f.client.request('move',2),frame=f.client.request('frame');
 for(const h of [before,load,after,frame])h.completion.catch(()=>{});
 try{
  await turns();await f.boundary();await turns();await f.boundary();await turns();
  assert.deepEqual(f.calls,[1]);assert.equal(asynchronousApplied,false);
  assert.equal((await frame.completion).output.result.x,1);
 }finally{await f.close();await Promise.allSettled([before.completion,load.completion,after.completion,frame.completion]);}
 assert.deepEqual(f.calls,[1,2]);assert.equal(asynchronousApplied,true);
});
test('canceled and replaced pending edits never mutate the scene at a later Kit boundary',async t=>{
 for(const part of [null,'scene','load','device']){
  const f=await fixture(t);const edit=f.client.request('move',4);edit.completion.catch(()=>{});
  try{
   await turns();
   if(part)f.host.invalidate(part);else edit.cancel('operator changed mind');
   await turns();await f.boundary();await turns();
   await assert.rejects(edit.completion,/epoch|canceled|changed mind/i);
   assert.equal(f.object.position.x,0);assert.deepEqual(f.calls,[]);
  }finally{await f.close().catch(()=>{});}
 }
});
test('foreground edit context cannot replace epochs or reopen cooperative scopes',async t=>{
 const f=await fixture(t,{edits:{inspect:(_,ctx)=>{
  assert.equal(ctx.advanceEpoch,undefined);assert.equal(ctx.lifecycle,undefined);
  assert.equal(ctx.activate,undefined);assert.equal(ctx.withFrames,undefined);return 'restricted';
 }}});
 const edit=f.client.request('inspect');edit.completion.catch(()=>{});
 try{await turns();await f.boundary();assert.equal((await edit.completion).output.value,'restricted');}
 finally{await f.close();}
});
test('declared async edits are rejected before invocation; unexpected thenables invalidate and hold the route',async t=>{
 let invoked=false;
 const a=await fixture(t,{edits:{bad:async()=>{invoked=true;}}});const bad=a.client.request('bad');bad.completion.catch(()=>{});
 try{await turns();await assert.rejects(bad.completion,/must be synchronous/);assert.equal(invoked,false);}
 finally{await a.close();}
 const b=await fixture(t,{edits:{bad:()=>Promise.resolve('unsupported')}});const escaped=b.client.request('bad');escaped.completion.catch(()=>{});
 try{
  await turns();await b.boundary();
  await assert.rejects(escaped.completion,error=>error.gpuRouteHeld===true&&error.mutationApplied===null);
  assert.equal(b.host.read().epoch.device,1);assert.equal(b.host.read().phase,'mutation-held');
 }finally{await b.close().catch(()=>{});}
 await assert.rejects(b.client.request('retire').completion,error=>error.gpuRouteHeld===true);
});
test('an admission adapter cannot claim application without calling the transaction or call it later',async t=>{
 let late;
 const f=await fixture(t,{admission:async(operation,payload,ctx,apply)=>{late=apply;return {fake:true};}});
 const edit=f.client.request('move',9);edit.completion.catch(()=>{});
 try{
  await turns();await assert.rejects(edit.completion,/without applying/);
  assert.throws(()=>late({}),/no longer available/);assert.equal(f.object.position.x,0);
 }finally{await f.close();}
});
test('a later render failure reports that the synchronous scene edit already applied',async t=>{
 const f=await fixture(t,{draw:object=>{if(object.position.x===3)throw Error('render failed after edit');}});
 const edit=f.client.request('move',3);edit.completion.catch(()=>{});
 try{
  await turns();await f.boundary();
  await assert.rejects(edit.completion,error=>error.mutationApplied===true&&/render failed after edit/.test(error.message));
  assert.equal(f.object.position.x,3);
 }finally{await f.close();}
});
test('an actual worker applies Three object edits in the model foreground window without changing admitted inputs',async t=>{
 const {Worker}=await import('node:worker_threads');const {port1,port2}=new MessageChannel();
 const worker=new Worker(new URL('./fixtures/scene-worker-foreground-runtime.mjs',import.meta.url),{workerData:{port:port2},transferList:[port2]});
 const client=createSceneWorkerClient({port:port1,sessionId:'worker-edits'});
 t.after(async()=>{client.disconnect();port1.close();await worker.terminate();});
 await client.initialize({}).completion;
 const started=deferred(),model=client.request('model',null,{onProgress:()=>started.resolve()});model.completion.catch(()=>{});await started.promise;
 const edit=await client.request('move',12).completion;
 assert.equal(edit.output.mutationApplied,true);assert.equal(edit.output.value.x,12);assert.ok(edit.output.value.threadId>0);
 const frame=await client.request('frame').completion;assert.equal(frame.output.result.x,12);
 await model.control('finish').completion;
 assert.deepEqual((await model.completion).output,{snapshot:0,threadId:edit.output.value.threadId});
 await client.request('retire').completion;
});
test('the binding refuses a different foreground device before invoking an edit',async()=>{
 let applied=false;const device={queue:{}},other={queue:{}};
 const appHost={device,queue:device.queue,activateFrames:async()=>{},requester:request=>{
  const completion=Promise.resolve().then(()=>request.run({device:other,queue:other.queue})).then(result=>({status:'completed',result}));
  return {completion,cancel(){}};
 }};
 const {requestMutation}=createSceneWorkerMutationBinding({appHost});
 await assert.rejects(requestMutation('move',1,{assertCurrent(){},signal:new AbortController().signal},()=>applied=true),/device\/queue mismatch/);
 assert.equal(applied,false);
});
