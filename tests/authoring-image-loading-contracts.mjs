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
 async load(_progress,options){this.preparing.resolve();await this.precompile(options);}
 async loadTransformer(_url,_progress,options){await this.precompile(options);}
 async generateScheduled(){
  if(this.collecting)return;
  this.sched.encoder();await this.sched.flush('fixture');
  await this.afterDispatch?.();
  return {width:1,height:1,rgba:new Uint8ClampedArray([1,2,3,255])};
 }
 async destroy(){await super.destroy();this.retired=true;}
}
async function fixture(t,{settled=async()=>{},afterDispatch=null}={}){
 const preparing=deferred(),submissions=[],pipelines=[];
 let app;
 const device={features:new Set(['shader-f16']),lost:new Promise(()=>{}),createCommandEncoder:()=>({finish:()=>({})}),
  queue:{submit:()=>submissions.push(app.foreground.snapshot().activeRun?.routeId??null),onSubmittedWorkDone:()=>settled({submitted:submissions.length})}};
 app=createAppGpuHost({sharedGpu:{device},kit,host:{setForegroundServiceActive(){},runForegroundFrame:work=>work()},frameOwner:()=>({setForegroundOpportunityRequester(){}})});
 const session=await app.session();
 const operation=createKleinAuthoringImageGeneration({context:()=>({sharedGpu:{device}}),appHost:async()=>app,kit:async()=>kit,
  weights:async()=>'/fixture-weights',createPipeline:()=>{const pipeline=new WarmupProducer(device,preparing);pipeline.afterDispatch=afterDispatch;pipelines.push(pipeline);return pipeline;},
  encodePng:async()=>new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),
  deliver:async file=>({name:file.name})});
 t.after(async()=>{if(!app.unsettledRuns().length){await operation.destroy();await app.foreground.dispose();session.close();}});
 return {preparing,submissions,pipelines,operation,app,session};
}
const request={prompt:'A brass hinge',seed:1,size:256};

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
