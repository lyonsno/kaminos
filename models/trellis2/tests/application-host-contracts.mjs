// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWebGpuInferenceSession,createWebGpuForegroundService} from '../../../webgpu-inference-kit/src/core.js';
import {createTrellisSharedHost} from '../shared-host.js';
import {GENERATION_ROUTE} from '../sparse-generation-witness-checks.js';

// Real Kit session/foreground/runtime control over a controlled queue. This
// is not GPU numerics, rendered-frame latency or a completed model witness.
async function fixture(){
  const events=[];let destroyed=0;
  const device={features:new Set(),limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**29},lost:new Promise(()=>{}),
    queue:{submit(buffers){events.push(...buffers.map(b=>b.kind));},async onSubmittedWorkDone(){events.push('gpu-settled');}},
    destroy(){destroyed++;},
    createCommandEncoder(){events.push('model-encoded');return {beginComputePass(){return{
      setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {kind:'model-submitted'};}};}
  };
  const session=await createWebGpuInferenceSession({sessionId:'application-fixture',device,queue:device.queue,
    adapterName:'controlled-queue',deviceOwnership:'borrowed'});
  const foreground=createWebGpuForegroundService({routeId:'application-render',device,queue:device.queue});
  let begins=0;
  const appGpu={device,queue:device.queue,session,beginRun(runId,options){begins++;return foreground.beginRun(runId,options);}};
  return{device,session,foreground,appGpu,events,get begins(){return begins;},get destroyed(){return destroyed;},
    async close(){await foreground.dispose();await session.drain();session.close();}};
}
const kernel={name:'controlled-application-duty',pipeline:{},bindGroup:{},bindings:[]};
const submit=async run=>{
  const job=run.route.enqueue({jobId:run.runId+':model',execute:i=>run.route.runtime.runKernel(kernel,
    {stage:'controlled-duty',dispatch:[1],schedulerInvocation:i})});
  return job.completion;
};

test('app-owned device/session/frame service runs TRELLIS without a volume prototype',async()=>{
  const f=await fixture();
  const bridge=await createTrellisSharedHost({appGpu:f.appGpu});
  assert.equal(bridge.device,f.device);assert.equal(bridge.session,f.session);
  assert.equal(bridge.snapshot().foregroundOwnership,'application');
  for(const runId of ['first','second']){
    const run=await bridge.beginRun({runId});
    assert.equal(f.foreground.snapshot().activeRun.routeId,GENERATION_ROUTE);
    const frame=f.foreground.request({requestId:runId+':frame',run:ctx=>ctx.submit([{kind:runId+':frame'}])});
    const before=f.events.length;
    assert.equal((await submit(run)).status,'succeeded');await frame.completion;
    assert.ok(f.events.indexOf(runId+':frame',before)<f.events.indexOf('model-encoded',before));
    await run.withForeground('checkpoint-loading',async()=>{
      const cpuFrame=f.foreground.request({requestId:runId+':cpu',run:ctx=>ctx.submit([{kind:runId+':cpu'}])});
      await cpuFrame.completion;
    });
    assert.equal((await run.finish()).status,'released');
    assert.equal(f.session.snapshot().routes.length,0);
    assert.equal(f.foreground.snapshot().activeRun,null);
  }
  assert.equal(f.begins,2);
  await bridge.dispose();
  assert.equal(f.session.snapshot().status,'active');assert.equal(f.foreground.snapshot().disposed,false);
  const idle=f.foreground.request({requestId:'after-disposal',run:ctx=>ctx.submit([{kind:'idle-frame'}])});
  await idle.completion;assert.equal(f.destroyed,0);await f.close();
});

test('Stop during the actual app frame service prevents model encoding',async()=>{
  const f=await fixture(),abort=new AbortController(),bridge=await createTrellisSharedHost({appGpu:f.appGpu});
  const run=await bridge.beginRun({runId:'stop',signal:abort.signal});
  const frame=f.foreground.request({requestId:'stop-frame',run:ctx=>{
    abort.abort('operator Stop');ctx.submit([{kind:'stop-frame'}]);
  }});
  const terminal=await submit(run);await frame.completion;
  assert.equal(terminal.status,'failed');assert.equal(terminal.failure.name,'AbortError');
  assert.ok(!f.events.includes('model-encoded'));
  await run.finish();await bridge.dispose();await f.close();
});

test('mismatched/ambiguous app ownership refuses before run admission',async()=>{
  for(const change of [
    f=>({appGpu:{...f.appGpu,queue:{}}}),
    f=>({appGpu:{...f.appGpu,device:{queue:f.device.queue}}}),
    f=>({appGpu:{...f.appGpu,beginRun:null}}),
    f=>({appGpu:f.appGpu,session:f.session}),
    f=>({appGpu:f.appGpu,prototype:{}})
  ]){
    const f=await fixture();await assert.rejects(createTrellisSharedHost(change(f)),/app|device|queue|source|session/);
    assert.equal(f.begins,0);assert.equal(f.session.snapshot().routes.length,0);
    assert.equal(f.destroyed,0);await f.close();
  }
});

test('an app run returned with the wrong model identity cannot encode',async()=>{
  const f=await fixture();f.appGpu.beginRun=id=>f.foreground.beginRun(id);
  const bridge=await createTrellisSharedHost({appGpu:f.appGpu});
  await assert.rejects(bridge.beginRun({runId:'wrong-route'}),/model route identity/);
  assert.equal(f.session.snapshot().routes.length,0);assert.ok(!f.events.includes('model-encoded'));
  assert.equal(f.foreground.snapshot().activeRun,null);
  await bridge.dispose();await f.close();
});

test('another application run remains caller-owned after admission refusal',async()=>{
  const f=await fixture(),other=await f.foreground.beginRun('other-model',{routeId:'other-model'});
  const bridge=await createTrellisSharedHost({appGpu:f.appGpu});
  await assert.rejects(bridge.beginRun({runId:'busy'}),/active run/);
  assert.equal(f.foreground.snapshot().activeRun.runId,'other-model');
  assert.equal(f.session.snapshot().routes.length,0);
  await other.finish();
  const next=await bridge.beginRun({runId:'after-other'});await next.finish();
  await bridge.dispose();await f.close();
});

test('opt-in per-duty scheduling reaches the real kit runtime and ordinary scheduling stays explicit',async()=>{
 const f=await fixture(),bridge=await createTrellisSharedHost({appGpu:f.appGpu});
 const normal=await bridge.beginRun({runId:'normal-schedule'});
 assert.equal(normal.scheduling?.().kind,'current-timer-zero-delay');await normal.finish();
 const run=await bridge.beginRun({runId:'fenced-schedule',scheduling:'per-duty-fence-task'});
 const job=run.route.enqueue({jobId:'fenced-duty',execute:i=>run.route.runtime.runKernel(kernel,{dispatch:[1],schedulerInvocation:i,yieldAfter:true})});
 assert.equal((await job.completion).status,'succeeded');
 assert.equal(run.scheduling().kind,'per-duty-fence-task');assert.equal(run.scheduling().gpuDrains,1);assert.equal(run.scheduling().taskYields,1);
 await run.finish();await bridge.dispose();await f.close();
});

test('unknown scheduling refuses before the app run is admitted',async()=>{
 const f=await fixture(),bridge=await createTrellisSharedHost({appGpu:f.appGpu});
 await assert.rejects(bridge.beginRun({runId:'bad-schedule',scheduling:'silent-fallback'}),/scheduling/);
 assert.equal(f.begins,0);await bridge.dispose();await f.close();
});

test('remeshing GPU duties service an actual scene frame before encoding and preserve Stop',async()=>{
 for(const stopping of [false,true]){
  const f=await fixture(),abort=new AbortController(),bridge=await createTrellisSharedHost({appGpu:f.appGpu});
  const run=await bridge.beginRun({runId:'remesh-'+stopping,signal:abort.signal,scheduling:'per-duty-fence-task'});
  const frame=f.foreground.request({requestId:'remesh-frame',run:ctx=>{if(stopping)abort.abort();ctx.submit([{kind:'scene-frame'}]);}});
  const work=run.withGpuDuty('original-remesh-distance',async encoded=>{f.events.push('remesh-encoded');encoded();f.device.queue.submit([{kind:'remesh-submitted'}]);return 7;});
  if(stopping){await assert.rejects(work,{name:'AbortError'});assert.ok(!f.events.includes('remesh-encoded'));}
  else{assert.equal(await work,7);assert.ok(f.events.indexOf('scene-frame')<f.events.indexOf('remesh-encoded'));assert.equal(run.scheduling().gpuDrains,1);}
  await frame.completion;await run.finish();await bridge.dispose();await f.close();
 }
});

test('actual Kit kernel execution emits operation identity and wall timing without another GPU wait',async()=>{
 const f=await fixture(),bridge=await createTrellisSharedHost({appGpu:f.appGpu}),observed=[];
 const run=await bridge.beginRun({runId:'live-operation',onTelemetry:e=>observed.push(e)});
 const terminal=await submit(run),waitsBeforeFinish=f.events.filter(e=>e==='gpu-settled').length;
 await run.finish();await bridge.dispose();await f.close();
 assert.equal(terminal.status,'succeeded');
 assert.deepEqual(observed.filter(e=>e.kind==='kernel').map(e=>[e.status,e.name]),[['started',kernel.name],['completed',kernel.name]]);
 assert.equal(waitsBeforeFinish,0,'observability adds no queue drain');
 const done=observed.find(e=>e.kind==='kernel'&&e.status==='completed');assert.ok(Number.isFinite(done.durationMs)&&done.durationMs>=0);
 assert.equal(done.authority,'host-operation-wall-time-not-gpu-completion');
});

test('a failed live telemetry listener cannot fail model execution or settlement',async()=>{
 const f=await fixture(),bridge=await createTrellisSharedHost({appGpu:f.appGpu});
 const run=await bridge.beginRun({runId:'bad-observer',onTelemetry:()=>{throw Error('display failed');}});
 const terminal=await submit(run),diagnostic=run.telemetry?.();
 await run.finish();await bridge.dispose();await f.close();
 assert.equal(terminal.status,'succeeded');assert.ok(diagnostic?.listenerErrors>=2,'observer errors stay visible as diagnostic failures');
});

test('actual Kit tensor uploads expose timing and identity without capturing weight data',async()=>{
 const f=await fixture(),observed=[];f.device.queue.writeBuffer=()=>{};
 const bridge=await createTrellisSharedHost({appGpu:f.appGpu}),run=await bridge.beginRun({runId:'upload-observation',onTelemetry:e=>observed.push(e)});
 const runtime=run.route.runtime,tensor=runtime.createTensor({name:'tiny-weight',shape:[1],dtype:'f32',buffer:{size:4}}),data=new Float32Array([3]);
 assert.equal(runtime.uploadTensor(tensor,data),tensor);
 await run.finish();await bridge.dispose();await f.close();
 assert.deepEqual(observed.filter(e=>e.kind==='upload').map(e=>[e.name,e.status]),[['tiny-weight','started'],['tiny-weight','completed']]);
 assert.ok(observed.every(e=>!Object.hasOwn(e,'data')&&!Object.hasOwn(e,'values')));
});
