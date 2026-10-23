// kaminos-test: node — async compilation is opt-in, preserves pipeline identity and cannot encode before preparation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebGpuResourceCaches,createWebGpuInferenceRuntime} from '../webgpu-inference-kit/src/inference-runtime.js';

function fixture(){
 const events=[];let resolve,reject;
 const pipeline={kind:'native-pipeline'};
 const device={features:new Set(),limits:{},lost:new Promise(()=>{}),queue:{submit(){events.push('submit');},async onSubmittedWorkDone(){}},
  createShaderModule:descriptor=>({descriptor}),
  createComputePipeline:()=>{events.push('sync');return pipeline;},
  createComputePipelineAsync:()=>{events.push('async');return new Promise((yes,no)=>{resolve=yes;reject=no;});},
  createCommandEncoder(){events.push('encode');return {beginComputePass(){return {setPipeline(p){assert.equal(p,pipeline);events.push('pipeline');},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
 return {device,events,pipeline,resolve:()=>resolve(pipeline),reject:error=>reject(error)};
}
const descriptor=()=>({layout:'auto',compute:{module:{},entryPoint:'main'}});

test('async pipeline preparation is explicit, deduplicated, and never falls back to synchronous creation',async()=>{
 const f=fixture(),c=createWebGpuResourceCaches(f.device,{asyncPipelines:true}),d=descriptor();
 const a=c.getComputePipeline('x',d),b=c.getComputePipeline('x',d);
 assert.equal(typeof a?.then,'function','async opt-in returns native preparation promise');assert.equal(a,b);assert.deepEqual(f.events,['async']);
 f.resolve();assert.equal(await a,f.pipeline);
 const legacy=createWebGpuResourceCaches(f.device);assert.equal(legacy.getComputePipeline('legacy',d),f.pipeline);assert.deepEqual(f.events,['async','sync']);
 const unavailable={...f.device,createComputePipelineAsync:undefined};assert.throws(()=>createWebGpuResourceCaches(unavailable,{asyncPipelines:true}).getComputePipeline('x',descriptor()),/createComputePipelineAsync/);
});

test('runKernel waits for the prepared pipeline before command admission or encoding',async()=>{
 const f=fixture(),runtime=await createWebGpuInferenceRuntime({device:f.device,queue:f.device.queue,routeId:'trellis-async-test',adapterName:'test',browser:'contract fake',kernel:{profile:'test'}});
 let resolve;const pipeline=new Promise(yes=>{resolve=yes;});
 const running=runtime.runKernel({name:'deferred',pipeline,bindGroup:{},bindings:[]},{dispatch:[1]});
 await new Promise(yes=>setImmediate(yes));assert.deepEqual(f.events,[],'pending compilation does not encode or submit');
 resolve(f.pipeline);await running;assert.deepEqual(f.events,['encode','pipeline','submit']);
});

test('pipeline rejection fails without submitting an invalid or fallback pipeline',async()=>{
 const f=fixture(),runtime=await createWebGpuInferenceRuntime({device:f.device,queue:f.device.queue,routeId:'trellis-async-error-test',adapterName:'test',browser:'contract fake',kernel:{profile:'test'}});
 const failure=Error('native shader rejected');
 await assert.rejects(runtime.runKernel({name:'rejected',pipeline:Promise.reject(failure),bindGroup:{},bindings:[]},{dispatch:[1]}),error=>error===failure);
 assert.deepEqual(f.events,[]);
});


test('the real TRELLIS bridge opts in without replacing session-owned caches and serves frames while compilation waits',async()=>{
 const {createTrellisSharedHost}=await import('../models/trellis2/shared-host.js');
 const {createWebGpuInferenceSession,createWebGpuForegroundService}=await import('../webgpu-inference-kit/src/core.js');
 const f=fixture(),session=await createWebGpuInferenceSession({sessionId:'compile-stop',device:f.device,adapterName:'fake native',deviceOwnership:'borrowed'});
 const foreground=createWebGpuForegroundService({routeId:'app',device:f.device,queue:f.device.queue});
 const appGpu={device:f.device,queue:f.device.queue,session,beginRun:(id,options)=>foreground.beginRun(id,options)};
 const bridge=await createTrellisSharedHost({appGpu}),abort=new AbortController(),run=await bridge.beginRun({runId:'compile-stop-run',signal:abort.signal});
 const pipeline=run.route.runtime.getComputePipeline('awaiting',descriptor());
 assert.equal(typeof pipeline.then,'function');assert.deepEqual(f.events,['async']);
 const job=run.route.enqueue({jobId:'compile',execute:invocation=>run.route.runtime.runKernel({name:'awaiting',pipeline,bindGroup:{},bindings:[]},{dispatch:[1],schedulerInvocation:invocation})});
 await new Promise(yes=>setImmediate(yes));
 const frame=foreground.request({requestId:'during-compile',run:()=>{f.events.push('foreground');return {status:'submitted'};}});
 assert.equal((await frame.completion).status,'completed','ordinary foreground can draw during native compilation');
 abort.abort(new DOMException('operator Stop','AbortError'));f.resolve();
 const result=await job.completion;assert.equal(result.status,'failed');assert.equal(result.failure.name,'AbortError');
 assert.deepEqual(f.events,['async','foreground'],'no model command after Stop during preparation');
 assert.equal((await run.finish()).status,'released');await bridge.dispose();session.close();
});


test('cleanup serves new frames until every unused compilation settles, after Stop or failure',async()=>{
 const {createTrellisSharedHost}=await import('../models/trellis2/shared-host.js');
 const {createWebGpuInferenceSession,createWebGpuForegroundService}=await import('../webgpu-inference-kit/src/core.js');
 for(const outcome of ['stop','failure'])for(const remaining of ['resolve','reject']){
  const f=fixture(),compilations=[];f.device.createComputePipelineAsync=()=>new Promise((resolve,reject)=>compilations.push({resolve,reject}));
  const session=await createWebGpuInferenceSession({sessionId:'cleanup-'+outcome+remaining,device:f.device,adapterName:'fake native',deviceOwnership:'borrowed'});
  const foreground=createWebGpuForegroundService({routeId:'app',device:f.device,queue:f.device.queue});
  const bridge=await createTrellisSharedHost({appGpu:{device:f.device,queue:f.device.queue,session,beginRun:(id,options)=>foreground.beginRun(id,options)}}),abort=new AbortController();
  const run=await bridge.beginRun({runId:'cleanup-'+outcome+remaining,signal:abort.signal});
  const first=run.route.runtime.getComputePipeline('first',descriptor());run.route.runtime.getComputePipeline('later-unused',descriptor());
  const job=run.route.enqueue({jobId:'compile',execute:invocation=>run.route.runtime.runKernel({name:'first',pipeline:first,bindGroup:{},bindings:[]},{dispatch:[1],schedulerInvocation:invocation})});
  await new Promise(yes=>setImmediate(yes));
  if(outcome==='stop'){abort.abort(new DOMException('operator Stop','AbortError'));compilations[0].resolve(f.pipeline);}else compilations[0].reject(Error('compile failed'));
  const terminal=await job.completion;assert.equal(terminal.status,'failed');
  let released=false;const finishing=run.finish().then(result=>{released=true;return result;});await new Promise(yes=>setImmediate(yes));
  const frame=foreground.request({requestId:'during-cleanup',run:()=>{f.events.push('cleanup-frame');return {status:'submitted'};}});
  await new Promise(yes=>setImmediate(yes));
  const servedBeforeSettlement=f.events.includes('cleanup-frame'),releasedBeforeSettlement=released;
  if(remaining==='resolve')compilations[1].resolve(f.pipeline);else compilations[1].reject(Error('unused compile failed'));
  await frame.completion;assert.equal((await finishing).status,'released');await bridge.dispose();session.close();
  assert.equal(servedBeforeSettlement,true,outcome+'/'+remaining+': frames continue while cleanup waits');
  assert.equal(releasedBeforeSettlement,false,'no early resource release');assert.deepEqual(f.events,['cleanup-frame'],'no model encoding after Stop/failure');
 }
});
