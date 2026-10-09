import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWebGpuInferenceSession} from '../../../webgpu-inference-kit/src/core.js';
const source=new URL('../shared-host.js',import.meta.url);
assert.ok(fs.existsSync(source),'TRELLIS needs a borrowed-device host bridge with real foreground boundaries');
const {createTrellisSharedHost}=await import(source);
function fixture(){
  const events=[];let requester,active=false,destroyed=0,bufferDestroyed=0,settlementFailure;
  const device={features:new Set(),limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**29},lost:new Promise(()=>{}),
    queue:{submit(buffers){events.push(...buffers.map(b=>b.kind));for(const b of buffers)for(const [from,sourceOffset,to,targetOffset,size]of b.copies??[])
      new Uint8Array(to.data).set(new Uint8Array(from.data,sourceOffset,size),targetOffset);},
      async onSubmittedWorkDone(){events.push('gpu-settled');if(settlementFailure)throw Error(settlementFailure);}},
    destroy(){destroyed++;},createBuffer({size}){const data=new ArrayBuffer(size);let gone=false;return{size,data,
      async mapAsync(){},getMappedRange(){return data;},unmap(){},destroy(){if(!gone){gone=true;bufferDestroyed++;}}};},
    createCommandEncoder(){events.push('model-encoded');const copies=[];return{beginComputePass(){return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},
      copyBufferToBuffer(...args){copies.push(args);},finish(){return{kind:'model-submitted',copies};}};}
  };
  const sharedGpu={device,queue:device.queue,adapter:{info:{vendor:'fixture'},features:device.features,limits:device.limits}},
    prototype={foregroundGpuContext:()=>({device,queue:device.queue,renderer:'ordinary-volume',productFrameOwner:'prototype'}),
      setForegroundOpportunityRequester(fn){requester=fn;}},
    host={device,setForegroundServiceActive(value){active=value;},runForegroundFrame(work){events.push('host-frame');return work();}};
  return{device,sharedGpu,prototype,host,events,get requester(){return requester;},get active(){return active;},
    get destroyed(){return destroyed;},get bufferDestroyed(){return bufferDestroyed;},failSettlement(value){settlementFailure=value;}};
}
const kernel={name:'synthetic-control-flow',pipeline:{},bindGroup:{},bindings:[]};
const racing=fixture(),races=await Promise.allSettled([
  createTrellisSharedHost({...racing,sessionId:'race-first'}),
  createTrellisSharedHost({...racing,sessionId:'race-second'}),
]);
assert.equal(races[0].status,'fulfilled');
assert.equal(races[1].status,'rejected','concurrent construction must not steal the renderer requester');
await races[0].value.dispose();
async function submit(run){
  const job=run.route.enqueue({jobId:'one-duty',execute:i=>run.route.runtime.runKernel(kernel,{stage:'synthetic-duty',dispatch:[1],schedulerInvocation:i})});
  return job.completion;
}
const f=fixture(),bridge=await createTrellisSharedHost({...f,sessionId:'borrowed-host'});
assert.equal(bridge.device,f.device);assert.equal(f.active,true);
const idle=f.requester({requestId:'idle',run:ctx=>{ctx.submit([{kind:'idle-frame'}]);return{renderer:'ordinary-volume',status:'submitted'};}});
assert.equal((await idle.completion).runId,null);
const run=await bridge.beginRun({runId:'first'});
run.route.runtime.createBuffer({size:4,usage:128,label:'owned-model-buffer'});
const frame=f.requester({requestId:'in-run',run:ctx=>{ctx.submit([{kind:'in-run-frame'}]);return{renderer:'ordinary-volume',status:'submitted'};}});
assert.equal((await submit(run)).status,'succeeded');
assert.equal((await frame.completion).runId,'first');
assert.ok(f.events.indexOf('in-run-frame')<f.events.indexOf('model-encoded'),'actual foreground service must precede model encoding');
assert.equal((await run.finish()).status,'released');
assert.equal(f.bufferDestroyed,1);assert.equal(f.destroyed,0);
const second=await bridge.beginRun({runId:'second'});await second.finish();await bridge.dispose();
assert.equal(f.active,false);assert.equal(f.requester,null);assert.equal(f.destroyed,0);

for(const change of [
  f=>({...f,sharedGpu:{...f.sharedGpu,queue:{}}}),
  f=>({...f,host:{...f.host,device:{}}}),
  f=>({...f,prototype:{...f.prototype,foregroundGpuContext:()=>({...f.prototype.foregroundGpuContext(),renderer:'alternate-renderer'})}}),
]){
  const f=fixture();await assert.rejects(createTrellisSharedHost({...change(f),sessionId:'reject'}),/same|ordinary|device|queue/);
  assert.equal(f.active,false);assert.equal(f.destroyed,0);
}
const stopped=fixture(),abort=new AbortController(),stopBridge=await createTrellisSharedHost({...stopped,sessionId:'stop'});
const stopRun=await stopBridge.beginRun({runId:'stop-run',signal:abort.signal});
const stopFrame=stopped.requester({requestId:'stop-at-boundary',run:ctx=>{abort.abort('operator Stop');ctx.submit([{kind:'stop-frame'}]);}});
const terminal=await submit(stopRun);
assert.equal(terminal.status,'failed');assert.equal(terminal.failure.name,'AbortError');
await stopFrame.completion;
assert.ok(!stopped.events.includes('model-encoded'),'Stop during foreground service must prevent the subsequent encode');
await stopRun.finish();await stopBridge.dispose();assert.equal(stopped.destroyed,0);

const external=fixture(),session=await createWebGpuInferenceSession({sessionId:'existing-host-session',device:external.device,adapterName:'fixture-adapter',deviceOwnership:'borrowed'});
const borrowed=await createTrellisSharedHost({...external,session});
const third=await borrowed.beginRun({runId:'external'});await third.finish();await borrowed.dispose();
assert.equal(session.snapshot().status,'active','bridge disposal must not close caller-owned session');session.close();
assert.equal(external.destroyed,0);

const reading=fixture(),readBridge=await createTrellisSharedHost({...reading,sessionId:'readback'});
const readRun=await readBridge.beginRun({runId:'readback'});
const readBuffer=readRun.route.runtime.createBuffer({size:4,usage:132,label:'resident-output'});
new Float32Array(readBuffer.data)[0]=7;
const tensor={name:'resident-output',buffer:readBuffer,byteLength:4,shape:[1],dtype:'f32',usage:132};
const inFrame=reading.requester({requestId:'in-read-frame',run:ctx=>ctx.submit([{kind:'in-read-frame'}])});
const readJob=readRun.route.enqueue({jobId:'model-count-read',execute:i=>readRun.route.runtime.readTensor(tensor,{schedulerInvocation:i})});
const readCompletion=await readJob.completion;
assert.equal(readCompletion.status,'succeeded','active metadata readback must inherit its actual scheduler invocation: '+JSON.stringify(readCompletion.failure));
assert.equal(new Float32Array(readCompletion.output)[0],7);await inFrame.completion;
const postFrame=reading.requester({requestId:'post-read-frame',run:ctx=>ctx.submit([{kind:'post-read-frame'}])});
assert.equal(new Float32Array(await readRun.route.runtime.readTensor(tensor))[0],7,'post-model readback must acquire its own real scheduler invocation');
await postFrame.completion;await readRun.finish();await readBridge.dispose();assert.equal(reading.destroyed,0);

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const overlap=fixture(),overlapBridge=await createTrellisSharedHost({...overlap,sessionId:'overlap'});
const overlapRun=await overlapBridge.beginRun({runId:'overlap'}),entered=deferred(),modelGate=deferred(),mapped=deferred(),mapGate=deferred();
const overlapBuffer=overlapRun.route.runtime.createBuffer({size:4,usage:132,label:'overlap-output'});
new Float32Array(overlapBuffer.data)[0]=7;
const overlapTensor={...tensor,buffer:overlapBuffer};
const create=overlap.device.createBuffer;
overlap.device.createBuffer=d=>{const b=create(d);b.mapAsync=async()=>{mapped.resolve();await mapGate.promise;};return b;};
const held=overlapRun.route.enqueue({jobId:'model-held',execute:async()=>{entered.resolve();await modelGate.promise;}});
await entered.promise;
let independentSettled=false;
const independent=overlapRun.route.runtime.readTensor(overlapTensor).then(b=>{independentSettled=true;return b;});
await Promise.resolve();await Promise.resolve();
assert.equal(overlapBridge.session.snapshot().routes[0].queue.jobs.length,2,
  'an independent read must enqueue its own job instead of borrowing the held model invocation');
modelGate.resolve();await held.completion;await mapped.promise;
let released=false;
const finishing=overlapRun.finish().then(r=>{released=true;return r;});
await new Promise(setImmediate);
assert.equal(released,false,'finish must wait for independently admitted mapping');
assert.equal(overlap.bufferDestroyed,0,'no output/staging destruction while the consumer maps');
mapGate.resolve();assert.equal(new Float32Array(await independent)[0],7);
assert.equal((await finishing).status,'released');assert.equal(independentSettled,true);
await assert.rejects(overlapRun.route.runtime.readTensor(overlapTensor),/active|settling|released/);
await overlapBridge.dispose();assert.equal(overlap.destroyed,0);

const detached=fixture(),detachedBridge=await createTrellisSharedHost({...detached,sessionId:'detached-read'});
const detachedRun=await detachedBridge.beginRun({runId:'detached-read'}),detachedMapped=deferred(),detachedGate=deferred();
const detachedBuffer=detachedRun.route.runtime.createBuffer({size:4,usage:132,label:'detached-output'});
const detachedCreate=detached.device.createBuffer;
detached.device.createBuffer=d=>{const b=detachedCreate(d);b.mapAsync=async()=>{detachedMapped.resolve();await detachedGate.promise;};return b;};
let detachedRead;
const detachedJob=detachedRun.route.enqueue({jobId:'caller-returns-before-map',execute:i=>{
  detachedRead=detachedRun.route.runtime.readTensor({...tensor,buffer:detachedBuffer},{schedulerInvocation:i});
}});
await detachedJob.completion;await detachedMapped.promise;
let detachedReleased=false;
const detachedFinish=detachedRun.finish().then(r=>{detachedReleased=true;return r;});
await new Promise(setImmediate);
assert.equal(detachedReleased,false,'an explicitly attributed read remains owned even if its caller returns before mapping');
assert.equal(detached.bufferDestroyed,0,'caller return must not destroy outstanding mapped resources');
detachedGate.resolve();await detachedRead;await detachedFinish;await detachedBridge.dispose();

for(const nested of [false,true]){
  const f=fixture(),abort=new AbortController(),b=await createTrellisSharedHost({...f,sessionId:'read-stop-'+nested});
  const r=await b.beginRun({runId:'read-stop-'+nested,signal:abort.signal});
  const buffer=r.route.runtime.createBuffer({size:4,usage:132,label:'stop-output'}),t={...tensor,buffer};
  const frame=f.requester({requestId:'read-stop-frame',run:ctx=>{abort.abort('Stop during readback service');ctx.submit([{kind:'stop-frame'}]);}});
  if(nested){
    const job=r.route.enqueue({jobId:'nested-read-stop',execute:i=>r.route.runtime.readTensor(t,{schedulerInvocation:i})});
    const result=await job.completion;assert.equal(result.status,'failed');assert.equal(result.failure.name,'AbortError');
  }else await assert.rejects(r.route.runtime.readTensor(t),{name:'AbortError'});
  await frame.completion;
  assert.ok(!f.events.includes('model-encoded'),'Stop in readback foreground service must prevent the subsequent staging encode');
  await r.finish();await b.dispose();assert.equal(f.destroyed,0);
}

const failed=fixture(),failureBridge=await createTrellisSharedHost({...failed,sessionId:'settlement-failure'});
const failedRun=await failureBridge.beginRun({runId:'failed'});
failedRun.route.runtime.createBuffer({size:4,usage:128,label:'held-model-buffer'});
failed.failSettlement('actual queue completion rejected');
await assert.rejects(failedRun.finish(),/queue completion rejected/);
assert.equal(failed.bufferDestroyed,0,'failed settlement cannot release model buffers or certify cancellation');
assert.equal(failed.destroyed,0);assert.equal(failureBridge.snapshot().activeRun.runId,'failed');
await assert.rejects(failureBridge.beginRun({runId:'unsafe-next'}),/active|held/);
console.log('Actual kit session/foreground control flow preserves borrowed ownership, services real callback submissions before encode, and stops at the post-service boundary. Fake GPU/renderer ports are not native TRELLIS or scene-latency evidence.');
