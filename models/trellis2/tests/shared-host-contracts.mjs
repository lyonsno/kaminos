import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWebGpuInferenceSession} from '../../../webgpu-inference-kit/src/core.js';
const source=new URL('../shared-host.js',import.meta.url);
assert.ok(fs.existsSync(source),'TRELLIS needs a borrowed-device host bridge with real foreground boundaries');
const {createTrellisSharedHost}=await import(source);
function fixture(){
  const events=[];let requester,active=false,destroyed=0,bufferDestroyed=0,settlementFailure;
  const device={features:new Set(),limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**29},lost:new Promise(()=>{}),
    queue:{submit(buffers){events.push(...buffers.map(b=>b.kind));},async onSubmittedWorkDone(){events.push('gpu-settled');if(settlementFailure)throw Error(settlementFailure);}},
    destroy(){destroyed++;},createBuffer({size}){return{size,destroy(){bufferDestroyed++;}};},
    createCommandEncoder(){events.push('model-encoded');return{beginComputePass(){return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return{kind:'model-submitted'};}};}
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

const failed=fixture(),failureBridge=await createTrellisSharedHost({...failed,sessionId:'settlement-failure'});
const failedRun=await failureBridge.beginRun({runId:'failed'});
failedRun.route.runtime.createBuffer({size:4,usage:128,label:'held-model-buffer'});
failed.failSettlement('actual queue completion rejected');
await assert.rejects(failedRun.finish(),/queue completion rejected/);
assert.equal(failed.bufferDestroyed,0,'failed settlement cannot release model buffers or certify cancellation');
assert.equal(failed.destroyed,0);assert.equal(failureBridge.snapshot().activeRun.runId,'failed');
await assert.rejects(failureBridge.beginRun({runId:'unsafe-next'}),/active|held/);
console.log('Actual kit session/foreground control flow preserves borrowed ownership, services real callback submissions before encode, and stops at the post-service boundary. Fake GPU/renderer ports are not native TRELLIS or scene-latency evidence.');
