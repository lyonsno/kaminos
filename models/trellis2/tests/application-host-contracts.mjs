// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWebGpuInferenceSession,createWebGpuForegroundService,createWebGpuModelBufferBudget,
  WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
import {createTrellisSharedHost} from '../shared-host.js';
import {GENERATION_ROUTE} from '../sparse-generation-witness-checks.js';

// Real Kit session/foreground/runtime control over a controlled queue. This
// is not GPU numerics, rendered-frame latency or a completed model witness.
async function fixture(){
  const events=[];let destroyed=0;const allocations=[];
  const device={features:new Set(),limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**29},lost:new Promise(()=>{}),
    queue:{submit(buffers){events.push(...buffers.map(b=>b.kind));},async onSubmittedWorkDone(){events.push('gpu-settled');}},
    destroy(){destroyed++;},
    createBuffer(descriptor){
      const data=new ArrayBuffer(descriptor.size),buffer={...descriptor,data,destroyed:false,
        destroy(){this.destroyed=true;},async mapAsync(){},getMappedRange(offset=0,size=data.byteLength){return data.slice(offset,offset+size);},unmap(){}};
      allocations.push(buffer);return buffer;
    },
    createCommandEncoder(){events.push('model-encoded');return {beginComputePass(){return{
      setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},
      copyBufferToBuffer(from,offset,to,destination,size){new Uint8Array(to.data,destination,size).set(new Uint8Array(from.data,offset,size));},
      finish(){return {kind:'model-submitted'};}};}
  };
  const session=await createWebGpuInferenceSession({sessionId:'application-fixture',device,queue:device.queue,
    adapterName:'controlled-queue',deviceOwnership:'borrowed'});
  const foreground=createWebGpuForegroundService({routeId:'application-render',device,queue:device.queue});
  let begins=0;
  const appGpu={device,queue:device.queue,session,beginRun(runId,options){begins++;return foreground.beginRun(runId,options);}};
  return{device,session,foreground,appGpu,events,allocations,get begins(){return begins;},get destroyed(){return destroyed;},
    async close(){await foreground.dispose();await session.drain();session.close();}};
}
const kernel={name:'controlled-application-duty',pipeline:{},bindGroup:{},bindings:[]};
const submit=async run=>{
  const job=run.route.enqueue({jobId:run.runId+':model',execute:i=>run.route.runtime.runKernel(kernel,
    {stage:'controlled-duty',dispatch:[1],schedulerInvocation:i})});
  return job.completion;
};

test('caller GPU timing options reach the real Kit runtime without changing the omitted default',async()=>{
  for(const option of [undefined,false,{enabled:false},'off']){
    const f=await fixture(),registered=[],register=f.session.registerRoute.bind(f.session),
      budget=createWebGpuModelBufferBudget({device:f.device,maxBytes:32});
    // Observe the bridge boundary, then delegate to the real Kit registration.
    const appGpu={...f.appGpu,session:{device:f.device,queue:f.device.queue,
      unregisterRoute:id=>f.session.unregisterRoute(id),
      snapshot:()=>f.session.snapshot(),registerRoute:input=>{
        registered.push(input);return register(input);
      }}};
    const bridge=await createTrellisSharedHost({appGpu,bufferBudget:budget,...(option===undefined?{}:{gpuTiming:option})});
    try{
      for(const runId of ['timing-first','timing-second']){
        const run=await bridge.beginRun({runId});
        try{
          const actual=registered.at(-1).runtimeOptions;
          assert.equal(Object.hasOwn(actual,'gpuTiming'),option!==undefined);
          assert.equal(actual.gpuTiming,option,'forward the exact caller value, including false and object identity');
          assert.equal(actual.bufferBudget,budget,'timing and buffer allowances compose on the same route');
          assert.equal(run.route.runtime.profile.gpuTiming.status,option===undefined?'unavailable':'disabled');
        }finally{await run.finish();}
      }
    }finally{await bridge.dispose();await f.close();}
  }
});

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

test('explicit budget covers model tensor, staging and managed resident buffers without wrapping the app device',async()=>{
  const f=await fixture(),create=f.device.createBuffer,
    budget=createWebGpuModelBufferBudget({device:f.device,maxBytes:32}),
    bridge=await createTrellisSharedHost({appGpu:f.appGpu,bufferBudget:budget});
  const renderer=f.device.createBuffer({size:4096,label:'renderer-outside-model'});
  const run=await bridge.beginRun({runId:'budgeted'}),runtime=run.route.runtime;
  const tensor=runtime.createTensor({name:'model-output',shape:[2],dtype:'f32',usage:U.storage|U.copySrc|U.copyDst});
  const resident=runtime.createManagedBuffer({label:'resident-weight',size:8,usage:U.storage|U.copyDst});
  const scratch=runtime.createBuffer({label:'model-scratch',size:4,usage:U.storage});
  assert.equal(budget.snapshot().chargedBytes,20,'the model route must receive the caller scope');
  const bytes=await runtime.readTensor(tensor);
  assert.equal(bytes.byteLength,8);
  assert.equal(budget.snapshot().chargedBytes,28,'post-model queued staging remains inside the same scope');
  const before=f.allocations.length;
  assert.throws(()=>runtime.createBuffer({label:'too-large',size:8,usage:U.storage}),{name:'WebGpuBufferBudgetError'});
  assert.equal(f.allocations.length,before,'refuse before invoking the borrowed device allocator');
  assert.equal(f.device.createBuffer,create,'renderer device method is unchanged');
  await run.finish();await budget.settleRetirements();
  assert.equal(tensor.buffer.destroyed,true);assert.equal(scratch.destroyed,true);
  assert.equal(resident.destroyed,false);assert.equal(renderer.destroyed,false);
  assert.equal(budget.snapshot().chargedBytes,8,'resident caller-managed bytes survive route disposal');
  const next=await bridge.beginRun({runId:'budgeted-again'});
  next.route.runtime.createBuffer({label:'second-run',size:24,usage:U.storage});
  assert.throws(()=>next.route.runtime.createBuffer({label:'resident-still-counts',size:4,usage:U.storage}),{name:'WebGpuBufferBudgetError'});
  await next.finish();resident.destroy();await budget.settleRetirements();
  assert.equal(budget.snapshot().chargedBytes,0);assert.equal(f.destroyed,0);
  await bridge.dispose();await f.close();renderer.destroy();
});

test('a budget for another device refuses admission and releases the foreground run',async()=>{
  const f=await fixture(),other=await fixture(),budget=createWebGpuModelBufferBudget({device:other.device,maxBytes:32});
  const bridge=await createTrellisSharedHost({appGpu:f.appGpu,bufferBudget:budget});
  await assert.rejects(bridge.beginRun({runId:'wrong-budget-device'}),/bufferBudget.*exact device and queue/);
  assert.equal(f.session.snapshot().routes.length,0);assert.equal(f.foreground.snapshot().activeRun,null);
  assert.equal(f.allocations.length,0);assert.equal(f.destroyed,0);
  await bridge.dispose();await f.close();await other.close();
});
