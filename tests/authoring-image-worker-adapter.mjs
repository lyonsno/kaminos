// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createSceneWorkerClient,installSceneWorkerHost} from '../scene-worker-handoff.mjs';
import {createKleinSceneWorkerAdapter} from '../authoring-image-worker-adapter.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function harness(t,{gate=null,failSave=false,destroyFails=0,encodeGate=null,saveGate=null}={}){
  const {port1,port2}=new MessageChannel(),started=deferred(),encoding=deferred(),saving=deferred(),saved=[];
  let adapter;
  let loads=0,destroyed=0,finished=0,request=null,frames=0;
  const device={features:new Set(['shader-f16']),queue:{onSubmittedWorkDone:async()=>{}}},session={
    registerRoute:async({routeId})=>({routeId,runtime:{runInvocation:async(_options,work)=>work({})},enqueue:({execute})=>({cancel:()=>({status:'not-cancelled-active'}),completion:Promise.resolve().then(()=>execute({})).then(output=>({status:'succeeded',output}))}),drain:async()=>{}}),unregisterRoute(){},
  };
  const appHost={queue:device.queue,session:()=>session,unsettledRuns:()=>[],beginRun:async()=>({foregroundOpportunities:{},withForeground:async(_phase,work)=>work(),finish:async()=>{finished++;}})};
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
  const options={context:()=>({sharedGpu:{device}}),appHost:()=>appHost,weights:async()=>'/weights',
    kit:async()=>({createWebGpuInferenceControl:()=>({close:async()=>{}})}),
    createPipeline:()=>({load:async()=>{loads++;},destroy:async()=>{destroyed++;if(destroyFails-->0)throw Error('pipeline retirement failed');},generate:async value=>{
      request=value;started.resolve();value.onStep(1,4);if(gate)await gate.promise;
      return {width:value.width,height:value.height,rgba:new Uint8ClampedArray(value.width*value.height*4),timings:{}};
    }}),encodePng:async()=>{encoding.resolve();if(encodeGate)await encodeGate.promise;return new Blob([png],{type:'image/png'});},
    deliver:async(file,provenance)=>{saving.resolve();if(saveGate)await saveGate.promise;if(failSave){failSave=false;throw Error('storage unavailable');}saved.push({file,provenance});return {source:'/saved/'+file.name};},
  };
  const host=installSceneWorkerHost({port:port2,createRuntime:async()=>{
    adapter=createKleinSceneWorkerAdapter(options);
    return {...adapter,host:appHost,frame:()=>({frames:++frames}),requestFrame:(_payload,_ctx,draw)=>draw()};
  }});
  const client=createSceneWorkerClient({port:port1,sessionId:'image-adapter'});
  t.after(()=>{client.disconnect();host.disconnect();port1.close();port2.close();gate?.resolve();encodeGate?.resolve();saveGate?.resolve();});
  await client.initialize({}).completion;
  return {client,host,saved,started,encoding,saving,operation:()=>adapter.operation,stats:()=>({loads,destroyed,finished,frames}),request:()=>request};
}

test('worker epoch invalidation prevents saving stale model output',async t=>{
  const gate=deferred(),h=await harness(t,{gate});
  const run=h.client.request('image.generate',{prompt:'lantern',seed:1,size:256});run.completion.catch(()=>{});
  await h.started.promise;h.host.invalidate('scene');gate.resolve();
  await assert.rejects(run.completion,/epoch|generation|abort/i);
  assert.equal(h.saved.length,0,'rejecting a transport reply is too late if the stale image was already saved');
  assert.equal(h.stats().finished,1);
  const output=(await h.client.request('image.read').completion).output.state.outputs[0];
  assert.equal(output.pending,false);
  await assert.rejects(h.client.request('image.retrySave',{runId:output.id}).completion,/Unknown|stale|epoch/i);
});

test('worker model controls and frames reach an active operation without changing epoch',async t=>{
  const gate=deferred(),h=await harness(t,{gate});
  const run=h.client.request('image.generate',{prompt:'lantern',seed:1,size:256});
  await h.started.promise;
  assert.equal((await h.client.request('frame').completion).output.frames,1);
  const controlled=await run.control('decodeNow').completion;
  assert.equal(controlled.output.accepted,true);assert.equal(h.request().shouldDecode(),true);
  await assert.rejects(run.control('pause').completion,/Unsupported image control/);
  gate.resolve();const result=await run.completion;
  assert.equal(result.output.entry.source.includes('lantern'),true);
  assert.equal(result.output.origin.requestId,run.requestId);
  assert.deepEqual(result.epoch,{scene:0,load:0,device:0});
  assert.ok(run.progress.length>0);
  assert.equal(run.progress.some(event=>event.value.preview?.kind==='final'),false,'final pixels are not duplicated into progress');
  await h.client.request('image.generate',{prompt:'kettle',seed:2,size:256}).completion;
  assert.equal(h.stats().loads,1);
  await h.client.request('retire').completion;assert.equal(h.stats().destroyed,1);
});

test('worker save retry retains pixels and origin without another inference',async t=>{
  const h=await harness(t,{failSave:true});
  const run=h.client.request('image.generate',{prompt:'lantern',seed:1,size:256});
  await assert.rejects(run.completion,/storage unavailable/);
  const status=(await h.client.request('image.read').completion).output;
  const output=status.state.outputs[0];assert.equal(output.pending,true);
  assert.equal(status.state.status,'failed');
  assert.equal(output.preview,null);assert.equal(h.operation().read().outputs[0].preview,null);
  const retry=await h.client.request('image.retrySave',{runId:output.id}).completion;
  assert.equal(retry.output.origin.requestId,run.requestId);
  assert.equal(h.stats().loads,1);assert.equal(h.saved.length,1);
});

test('worker command cancellation cannot save a completed output from the canceled request',async t=>{
  const gate=deferred(),h=await harness(t,{gate});
  const run=h.client.request('image.generate',{prompt:'lantern',seed:1,size:256});run.completion.catch(()=>{});
  await h.started.promise;run.cancel('operator Stop');await tick();await tick();gate.resolve();
  await assert.rejects(run.completion,{name:'AbortError'});
  assert.equal(h.saved.length,0);assert.equal(h.stats().finished,1);
  const output=(await h.client.request('image.read').completion).output.state.outputs[0];
  assert.equal(output.pending,false);
  await assert.rejects(h.client.request('image.retrySave',{runId:output.id}).completion,/Unknown|stale|epoch/i);
});

test('worker status and retained history contain no final pixel buffers',async t=>{
  const h=await harness(t);
  for(const seed of [1,2])await h.client.request('image.generate',{prompt:'lantern',seed,size:256}).completion;
  const state=(await h.client.request('image.read').completion).output.state;
  assert.equal(state.outputs.length,2,'metadata history stays complete');
  for(const output of state.outputs){assert.equal(output.preview===null,true);assert.ok(output.entry.source);}
  for(const output of h.operation().read().outputs)assert.equal(output.preview===null,true,'worker operation snapshots must not clone final pixels before projection');
});

test('worker partial progress still retains provisional pixels',async t=>{
  const gate=deferred(),h=await harness(t,{gate});
  const run=h.client.request('image.generate',{prompt:'lantern',seed:1,size:256});await h.started.promise;
  h.request().onPreview({step:1,steps:4,width:1,height:1,rgba:new Uint8ClampedArray([1,2,3,255])});
  const state=(await h.client.request('frame').completion).epoch;
  assert.deepEqual(state,{scene:0,load:0,device:0});
  gate.resolve();await run.completion;
  assert.ok(run.progress.some(event=>event.value.preview?.rgba?.length===4));
});

test('cancellation during PNG encoding is terminal rather than a retryable storage failure',async t=>{
  const encodeGate=deferred(),h=await harness(t,{encodeGate});
  const run=h.client.request('image.generate',{prompt:'lantern',seed:1,size:256});run.completion.catch(()=>{});
  await h.encoding.promise;await tick();await tick();assert.equal(h.stats().finished,1);
  await h.client.request('frame').completion;
  assert.equal(run.progress.at(-1).value.status,'saving');
  run.cancel('operator Stop');await tick();await tick();encodeGate.resolve();
  await assert.rejects(run.completion,{name:'AbortError'});
  const status=(await h.client.request('image.read').completion).output.state;
  assert.equal(status.outputs[0].pending,false);assert.equal(h.saved.length,0);
  await assert.rejects(h.client.request('image.retrySave',{runId:status.outputs[0].id}).completion,/Unknown|stale|epoch/i);
});

test('a storage retry cannot rebind an old-scene image to a new epoch',async t=>{
  const h=await harness(t,{failSave:true});
  await assert.rejects(h.client.request('image.generate',{prompt:'lantern',seed:1,size:256}).completion,/storage unavailable/);
  const old=(await h.client.request('image.read').completion).output.state.outputs[0];
  h.host.invalidate('scene');await tick();await tick();
  await assert.rejects(h.client.request('image.retrySave',{runId:old.id}).completion,/stale|epoch/i);
  const current=(await h.client.request('image.read').completion).output.state.outputs[0];
  assert.equal(current.pending,false);assert.equal(h.saved.length,0);
});

test('storage failure after cancellation cannot turn the output back into a retry',async t=>{
  const saveGate=deferred(),h=await harness(t,{saveGate,failSave:true});
  const run=h.client.request('image.generate',{prompt:'lantern',seed:1,size:256});run.completion.catch(()=>{});
  await h.saving.promise;run.cancel('operator Stop');await tick();await tick();saveGate.resolve();
  await assert.rejects(run.completion,{name:'AbortError'});
  const output=(await h.client.request('image.read').completion).output.state.outputs[0];
  assert.equal(output.pending,false);assert.equal(h.saved.length,0);
});

test('failed model retirement retains cleanup ownership for retry',async t=>{
  const h=await harness(t,{destroyFails:1});
  await h.client.request('image.generate',{prompt:'lantern',seed:1,size:256}).completion;
  await assert.rejects(h.client.request('retire').completion,error=>error.gpuRouteHeld===true&&/retirement failed/.test(error.message));
  await h.client.request('retire').completion;
  assert.equal(h.stats().destroyed,2,'retry must actually retry model cleanup rather than forgetting it');
});
