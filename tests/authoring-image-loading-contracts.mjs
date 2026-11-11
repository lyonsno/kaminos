// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {KleinPipeline} from '../models/flux2-klein/klein-pipeline.js';
import {createKleinAuthoringImageGeneration} from '../authoring-image-operation.mjs';
import {createAppGpuHost} from '../app-gpu-host.mjs';
import * as kit from '../webgpu-inference-kit/src/core.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));

class WarmupProducer extends KleinPipeline{
 constructor(device,preparing){
  super(device);this.preparing=preparing;this.retired=false;
  for(const name of ['textEncoder','transformer','vae'])this[name]={weightsResident:true,destroy(){}};
 }
 async load(_progress,options){this.preparing.resolve();await this.precompile(options);await this.afterLoad?.();}
 async loadTransformer(_url,_progress,options){await this.precompile(options);}
 async generateScheduled(){
  if(this.collecting)return;
  this.sched.encoder();await this.sched.flush('fixture');
  await this.afterDispatch?.();
  return {width:1,height:1,rgba:new Uint8ClampedArray([1,2,3,255])};
 }
 async destroy(){await super.destroy();this.retired=true;}
}
async function fixture(t,{settled=async()=>{},afterDispatch=null,afterLoad=null,clock,deliver=null}={}){
 const preparing=deferred(),submissions=[],pipelines=[],saved=[];
 let app;
 const device={features:new Set(['shader-f16']),lost:new Promise(()=>{}),createCommandEncoder:()=>({finish:()=>({})}),
  queue:{submit:()=>submissions.push(app.foreground.snapshot().activeRun?.routeId??null),onSubmittedWorkDone:()=>settled({submitted:submissions.length})}};
 app=createAppGpuHost({sharedGpu:{device},kit,host:{setForegroundServiceActive(){},runForegroundFrame:work=>work()},frameOwner:()=>({setForegroundOpportunityRequester(){}})});
 const session=await app.session();
 const operation=createKleinAuthoringImageGeneration({clock,context:()=>({sharedGpu:{device}}),appHost:async()=>app,kit:async()=>kit,
  weights:async()=>'/fixture-weights',createPipeline:()=>{const pipeline=new WarmupProducer(device,preparing);pipeline.afterDispatch=afterDispatch;pipeline.afterLoad=afterLoad;pipelines.push(pipeline);return pipeline;},
  encodePng:async()=>new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),
  deliver:async(file,provenance)=>{await deliver?.(file,provenance);saved.push({file,provenance});return {name:file.name};}});
 t.after(async()=>{if(!app.unsettledRuns().length){await operation.destroy();await app.foreground.dispose();session.close();}});
 return {preparing,submissions,pipelines,saved,operation,app,session};
}
const request={prompt:'A brass hinge',seed:1,size:256};

async function holdOtherModel(t,h){
 const release=deferred(),entered=deferred();t.after(()=>release.resolve());
 const route=await h.session.registerRoute({routeId:'other-model'});
 const holding=route.enqueue({jobId:'other',execute:async()=>{
  const run=await h.app.beginRun('other',{routeId:'other-model'});entered.resolve();
  try{await release.promise;}finally{await run.finish();}
 }});
 await entered.promise;
 return async()=>{release.resolve();await holding.completion;await route.drain();h.session.unregisterRoute(route.routeId);};
}

test('warm image generation waits for shared admission without claiming the other model frame run',async t=>{
 let now=0;const h=await fixture(t,{clock:()=>now});await h.operation.run(request);
 const release=await holdOtherModel(t,h),before=h.submissions.length;
 const generating=h.operation.run({...request,seed:2}).then(value=>({value}),error=>({error}));
 await tick();const waiting=h.operation.read();now=500;const elapsed=h.operation.timing();
 const owners=h.app.unsettledRuns(),submitted=h.submissions.length;
 await release();const outcome=await generating;
 assert.equal(waiting.status,'queued');assert.equal(waiting.stage,'Waiting for shared GPU');
 assert.equal(elapsed.loadMs,0);assert.equal(elapsed.queuedMs,500);assert.equal(elapsed.generationMs,null);
 assert.deepEqual(owners,['other']);assert.equal(submitted,before);
 assert.equal(outcome.error,undefined);assert.ok(outcome.value);
 assert.equal(h.pipelines.length,1);assert.deepEqual(h.app.unsettledRuns(),[]);
 assert.equal(h.saved[1].provenance.elapsed.queuedMs,500);
 assert.equal(h.saved[1].provenance.elapsed.generationMs,0);
});

test('Stop cancels queued warm generation without waiting for the current model',async t=>{
 const h=await fixture(t);await h.operation.run(request);const release=await holdOtherModel(t,h);
 const before=h.submissions.length;
 let completed=false;const generating=h.operation.run({...request,seed:2}).then(value=>({value}),error=>({error})).then(value=>{completed=true;return value;});
 await tick();const accepted=h.operation.stop();await tick();const stoppedBeforeRelease=completed;
 const owners=h.app.unsettledRuns();await release();const result=await generating;
 assert.equal(accepted,true);assert.equal(stoppedBeforeRelease,true);assert.equal(result.error,undefined);assert.equal(result.value,null);
 assert.deepEqual(owners,['other']);assert.equal(h.submissions.length,before);assert.equal(h.saved.length,1);
 assert.equal(h.operation.read().status,'stopped');
});

test('completed pixels still win private Stop, but external command cancellation prevents saving',async t=>{
 const h=await fixture(t);await h.operation.run(request);
 for(const external of [false,true]){
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  h.pipelines[0].afterDispatch=async()=>{entered.resolve();await release.promise;};
  const controller=new AbortController(),before=h.saved.length;
  const generating=h.operation.run({...request,seed:external?3:2,signal:controller.signal});
  await entered.promise;
  if(external)controller.abort();else assert.equal(h.operation.stop(),true);
  release.resolve();const result=await generating;
  assert.equal(h.saved.length,before+(external?0:1));
  assert.equal(result===null,external);assert.deepEqual(h.app.unsettledRuns(),[]);
 }
});

test('default image storage does not hold GPU admission after completed generation',async t=>{
 const saving=deferred(),release=deferred();t.after(()=>release.resolve());
 const h=await fixture(t,{deliver:async()=>{saving.resolve();await release.promise;}});
 const generating=h.operation.run(request);await saving.promise;await tick();
 const owners=h.app.unsettledRuns();
 assert.equal(h.operation.busy(),true,'page save remains busy independently of the GPU');
 release.resolve();await generating;assert.deepEqual(owners,[]);
});

test('caller save keeps its own result while another actual session generation finishes',async t=>{
 const h=await fixture(t),saving=deferred(),release=deferred();t.after(()=>release.resolve());
 const first=h.operation.run({...request,deliver:async(file,provenance)=>{saving.resolve();await release.promise;return {seed:provenance.seed,name:file.name};}});
 await saving.promise;await tick();assert.equal(h.operation.busy(),false);assert.deepEqual(h.app.unsettledRuns(),[]);
 const second=await h.operation.run({...request,seed:2});assert.ok(second);
 release.resolve();assert.equal((await first).seed,1);
 assert.equal(h.pipelines.length,1);assert.deepEqual(h.operation.read().outputs.map(o=>o.provenance.seed),[1]);
});

test('unknown normal-generation settlement retains app ownership and blocks model reuse',async t=>{
 let failing=false;const h=await fixture(t,{settled:async()=>{if(failing)throw Error('normal settlement unavailable');}});
 await h.operation.run(request);failing=true;
 await assert.rejects(h.operation.run({...request,seed:2}),error=>error.gpuRouteHeld===true);
 assert.equal(h.saved.length,1);assert.equal(h.app.unsettledRuns().length,1);
 await assert.rejects(h.operation.run(request),error=>error.gpuRouteHeld===true);
 await assert.rejects(h.operation.destroy(),error=>error.gpuRouteHeld===true);
 assert.equal(h.pipelines[0].retired,false);
});

test('authoring warmup waits for shared admission, owns a tracked app run and covers transformer swaps',async(t)=>{
 const h=await fixture(t),release=deferred(),entered=deferred();t.after(()=>release.resolve());
 const host=await h.session.registerRoute({routeId:'other-model'});
 const holding=host.enqueue({jobId:'other',execute:async()=>{const run=await h.app.beginRun('other',{routeId:'other-model'});entered.resolve();await release.promise;await run.finish();}});
 await entered.promise;
 const generating=h.operation.run(request).then(value=>({value}),error=>({error}));
 await h.preparing.promise;await tick();const premature=h.submissions.slice();
 release.resolve();await holding.completion;const outcome=await generating;
 assert.deepEqual(premature,[],'loading warmup must not submit while another model owns admission');
 assert.equal(outcome.error,undefined);
 await h.operation.run({...request,level:'3-bit'});
 assert.equal(h.pipelines.length,1);
 assert.deepEqual(h.submissions.map(id=>id?.endsWith(':warmup')),[true,false,true,false]);
 assert.deepEqual(h.app.unsettledRuns(),[]);
 await host.drain();h.session.unregisterRoute(host.routeId);
});

test('Stop cancels a queued warmup without dispatching or waiting for another model',async(t)=>{
 const h=await fixture(t),release=deferred(),entered=deferred();t.after(()=>release.resolve());
 const host=await h.session.registerRoute({routeId:'other-model'});
 const holding=host.enqueue({jobId:'other',execute:async()=>{const run=await h.app.beginRun('other',{routeId:'other-model'});entered.resolve();await release.promise;await run.finish();}});
 await entered.promise;
 const controller=new AbortController(),generating=h.operation.run({...request,signal:controller.signal}).then(value=>({value}),error=>({error}));
 await h.preparing.promise;await tick();controller.abort();
 const result=await generating;assert.equal(result.error,undefined);assert.equal(result.value,null);
 assert.deepEqual(h.submissions,[]);assert.equal(h.pipelines[0].retired,true);
 assert.deepEqual(h.app.unsettledRuns(),['other']);
 release.resolve();await holding.completion;await host.drain();h.session.unregisterRoute(host.routeId);
});

test('failed warmup settlement holds app ownership and retains model resources across retry and retirement',async(t)=>{
 const h=await fixture(t,{settled:async({submitted})=>{if(submitted)throw Error('queue settlement unavailable');}});
 await assert.rejects(h.operation.run(request),error=>error.gpuRouteHeld===true);
 assert.equal(h.app.unsettledRuns().length,1);
 assert.equal(h.pipelines[0].retired,false);
 await assert.rejects(h.operation.run(request),error=>error.gpuRouteHeld===true);
 await assert.rejects(h.operation.destroy(),error=>error.gpuRouteHeld===true);
 assert.equal(h.pipelines.length,1);assert.equal(h.pipelines[0].retired,false);
});

test('warmup body failure settles admission, retires only its producer and permits retry',async(t)=>{
 let fail=true;
 const h=await fixture(t,{afterDispatch:()=>{if(fail)throw Error('warmup fixture failed');}});
 await assert.rejects(h.operation.run(request),/warmup fixture failed/);
 assert.equal(h.pipelines[0].retired,true);assert.deepEqual(h.app.unsettledRuns(),[]);
 assert.deepEqual(h.session.snapshot().routes,[]);
 fail=false;await h.operation.run(request);assert.equal(h.pipelines.length,2);
});

test('Stop during admitted warmup retains ownership until work returns and settlement finishes',async(t)=>{
 const entered=deferred(),release=deferred();t.after(()=>release.resolve());
 const h=await fixture(t,{afterDispatch:async()=>{entered.resolve();await release.promise;}});
 const controller=new AbortController(),generating=h.operation.run({...request,signal:controller.signal});
 await entered.promise;controller.abort();await tick();
 assert.equal(h.operation.busy(),true);assert.equal(h.app.unsettledRuns().length,1);assert.equal(h.pipelines[0].retired,false);
 release.resolve();assert.equal(await generating,null);
 assert.deepEqual(h.app.unsettledRuns(),[]);assert.equal(h.pipelines[0].retired,true);
});

test('production transformer reload forwards its caller admission to precompile',async(t)=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>({ok:true,json:async()=>({bundles:{}})});
 let admitted=0;
 const receiver={assertUsable(){},cacheWeights:false,residentBytes:{},urls:{},kernels:{},sched:{},
  createTransformer:()=>({loadBundles:async()=>{},destroy(){}}),
  async precompile(options){await options?.runWarmup?.(async()=>{admitted++;});}};
 await KleinPipeline.prototype.loadTransformer.call(receiver,'https://fixture.invalid/dit',()=>{},{runWarmup:work=>work()});
 assert.equal(admitted,1);
});

test('authoring retirement retries actual producer cleanup without closing the borrowed app session',async(t)=>{
 let failing=false;
 const h=await fixture(t,{settled:async()=>{if(failing)throw Error('retirement queue unsettled');}});
 await h.operation.run(request);const pipeline=h.pipelines[0];
 failing=true;await assert.rejects(h.operation.destroy(),/retirement queue unsettled/);
 assert.equal(pipeline.destroyed,true);assert.ok(pipeline.transformer);assert.equal(pipeline.retired,false);
 failing=false;await h.operation.destroy();
 assert.equal(pipeline.transformer,null);assert.equal(pipeline.retired,true);
 assert.equal(h.session.snapshot().status,'active');assert.equal(await h.app.session(),h.session);
});

test('failed load and failed cleanup retain the partial producer for explicit retirement retry',async(t)=>{
 let failing=false;
 const h=await fixture(t,{afterLoad:()=>{failing=true;throw Error('partial load failed');},
  settled:async()=>{if(failing)throw Error('cleanup queue unavailable');}});
 await assert.rejects(h.operation.run(request));const pipeline=h.pipelines[0];
 assert.ok(pipeline.transformer);assert.equal(pipeline.retired,false);
 await assert.rejects(h.operation.destroy(),/cleanup queue unavailable/);
 failing=false;await h.operation.destroy();
 assert.equal(pipeline.transformer,null);assert.equal(pipeline.retired,true);
 assert.equal(h.session.snapshot().status,'active');
});
