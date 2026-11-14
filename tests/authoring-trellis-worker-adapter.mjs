// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createSceneWorkerClient,installSceneWorkerHost} from '../scene-worker-handoff.mjs';
import {createTrellisPageAuthoringGeneration} from '../authoring-trellis-page.mjs';
const url=new URL('../authoring-trellis-worker-adapter.mjs',import.meta.url);
const module=await import(url).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND'&&e.url===url.href)return {};throw e;});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const glb=new Uint8Array([103,108,84,70,2,0,0,0,12,0,0,0]).buffer;
function fixture({run,save}={}){
 assert.equal(typeof module.createTrellisSceneWorkerAdapter,'function','TRELLIS needs a real worker command consumer');
 let runs=0,saves=0,disposed=0;const progress=[];
 const adapter=module.createTrellisSceneWorkerAdapter({appHost:async()=>({unsettledRuns:()=>[]}),
  availability:async()=>({status:'available'}),
  operation:{async run(options){runs++;await run?.(options);return {glb,label:options.label,generation:{runId:'model-run',input:{source:options.image.source}}};},async retire(){disposed++;}},
  persistence:{async persist(out,context){saves++;context.assertCurrent();await save?.(out);return {source:'/stored.glb',name:out.label,generation:out.generation};},async retire(){}},
  lease:async(_options,work)=>({result:await work(),lease:{status:'unconfigured'}})});
 const ctx=(epoch={scene:0})=>{const controller=new AbortController();return {requestId:crypto.randomUUID(),signal:controller.signal,controller,
  epoch:()=>epoch,assertCurrent(){controller.signal.throwIfAborted();},report:value=>progress.push(value),withFrames:work=>work()};};
 return {adapter,ctx,progress,runs:()=>runs,saves:()=>saves,disposed:()=>disposed};
}
const input={source:'/api/read?root=image-inbox&path=a.png',name:'a.png'};
test('actual authoring service accepts external cancellation before input and after completed producer bytes',async()=>{
 for(const pre of [true,false]){
  let runs=0,saves=0;const controller=new AbortController();
  const service=createTrellisPageAuthoringGeneration({availability:()=>({status:'available'}),runPage:async()=>{runs++;controller.abort();return {glb,generation:{runId:'r'}};},persist:async()=>{saves++;}});
  if(pre)controller.abort();
  await Promise.resolve(service.run({...input,signal:controller.signal})).catch(()=>{});
  assert.equal(runs,pre?0:1);assert.equal(saves,0,'external command cancellation must prevent persistence');
 }
});
test('worker Generate returns persisted identity and plain status, with explicit retry using the exact retained output',async()=>{
 let fail=true;const h=fixture({save:()=>{if(fail)throw Error('disk full');}}),ctx=h.ctx();
 await assert.rejects(h.adapter.commands['mesh.generate'](input,ctx),/disk full/);
 const failed=await h.adapter.commands['mesh.read']({},h.ctx());assert.equal(failed.model,'trellis-page');assert.equal(failed.preparesInput,true);assert.ok(failed.state.pending);
 assert.equal(JSON.stringify(failed).includes('byteLength'),false);assert.equal(failed.state.pending.glb,undefined);
 fail=false;const result=await h.adapter.commands['mesh.retrySave']({},h.ctx());
 assert.equal(result.entry.source,'/stored.glb');assert.equal(result.runId,'model-run');assert.deepEqual(result.origin,{requestId:ctx.requestId,epoch:{scene:0}});
 assert.equal(h.runs(),1);assert.equal(h.saves(),2);await h.adapter.retire();assert.equal(h.disposed(),1);
});
test('Stop reaches the producer signal and waits for its return before command settlement; canceled output is never saved',async()=>{
 const entered=deferred(),release=deferred();let signal;
 const h=fixture({run:async options=>{signal=options.signal;options.onInput?.({kind:'original-alpha',source:input.source});entered.resolve();await release.promise;}}),ctx=h.ctx();
 let done=false;const pending=h.adapter.commands['mesh.generate'](input,ctx).finally(()=>done=true);pending.catch(()=>{});
 await entered.promise;ctx.controller.abort(new DOMException('Stop','AbortError'));await new Promise(r=>setImmediate(r));
 assert.equal(signal.aborted,true);assert.equal(done,false);assert.equal(h.progress.find(x=>x.inputPreview)?.inputPreview.input,input.source);
 release.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal(h.saves(),0);
});
test('stale epoch cannot retry pending bytes or start a second model generation',async()=>{
 const h=fixture({save:()=>{throw Error('disk');}});await assert.rejects(h.adapter.commands['mesh.generate'](input,h.ctx()),/disk/);
 await assert.rejects(h.adapter.commands['mesh.retrySave']({},h.ctx({scene:1})),/stale|epoch/);
 assert.equal(h.saves(),1);assert.equal(h.runs(),1);assert.equal((await h.adapter.commands['mesh.read']({},h.ctx({scene:1}))).state.pending,null);
});

async function transport(t,options){
 const h=fixture(options),{port1,port2}=new MessageChannel();let frames=0;
 const host=installSceneWorkerHost({port:port2,createRuntime:async()=>({
  ...h.adapter,host:{unsettledRuns:()=>[]},frame:()=>({frames:++frames}),requestFrame:(_input,_ctx,draw)=>draw(),
 })});
 const client=createSceneWorkerClient({port:port1,sessionId:'trellis-consumer'});
 t.after(()=>{client.disconnect();host.disconnect();port1.close();port2.close();});
 await client.initialize({}).completion;return {...h,client,host};
}
test('real scene transport keeps frames flowing during Generate and retries storage without re-running the producer',async t=>{
 const entered=deferred(),release=deferred();let fail=true;
 t.after(()=>release.resolve());
 const h=await transport(t,{run:async()=>{entered.resolve();await release.promise;},save:()=>{if(fail)throw Error('disk full');}});
 const run=h.client.request('mesh.generate',input);run.completion.catch(()=>{});
 await entered.promise;
 assert.equal((await h.client.request('frame').completion).output.frames,1);
 release.resolve();await assert.rejects(run.completion,/disk full/);
 const read=(await h.client.request('mesh.read').completion).output;
 assert.ok(read.state.pending);assert.equal(read.state.pending.glb,undefined);assert.deepEqual(read.controls,[]);
 fail=false;const saved=(await h.client.request('mesh.retrySave').completion).output;
 assert.equal(saved.origin.requestId,run.requestId);assert.equal(saved.runId,'model-run');
 assert.equal(saved.entry.source,'/stored.glb');assert.equal(h.runs(),1);assert.equal(h.saves(),2);
 await h.client.request('retire').completion;assert.equal(h.disposed(),1);
});
test('real scene transport Stop waits for producer settlement and epoch invalidation cannot save stale bytes',async t=>{
 for(const invalidate of [false,true]){
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());let signal;
  const h=await transport(t,{run:async options=>{signal=options.signal;entered.resolve();await release.promise;}});
  const run=h.client.request('mesh.generate',input);let done=false;run.completion.finally(()=>done=true).catch(()=>{});
  await entered.promise;
  if(invalidate)h.host.invalidate('scene');else run.cancel('Operator Stop');
  // The frame reply proves cancellation reached the worker before releasing the producer.
  if(!invalidate)await h.client.request('frame').completion;
  else await new Promise(r=>setImmediate(r));
  assert.equal(signal.aborted,true);assert.equal(done,false);
  release.resolve();await assert.rejects(run.completion,/Stop|epoch/);
  assert.equal(h.saves(),0);
 }
});
test('Stop during failed persistence clears canceled raw output instead of offering an impossible save retry',async t=>{
 const saving=deferred(),release=deferred();t.after(()=>release.resolve());
 const h=await transport(t,{save:async()=>{saving.resolve();await release.promise;throw Error('disk failed after Stop');}});
 const run=h.client.request('mesh.generate',input);run.completion.catch(()=>{});
 await saving.promise;run.cancel('Operator Stop');await h.client.request('frame').completion;
 release.resolve();await assert.rejects(run.completion,/Stop/);
 const read=(await h.client.request('mesh.read').completion).output;
 assert.equal(read.state.pending,null);
 await assert.rejects(h.client.request('mesh.retrySave').completion,/No retained/);
 assert.equal(h.runs(),1);
});
test('Stop during retry persistence also discards canceled bytes without another model run',async t=>{
 const saving=deferred(),release=deferred();t.after(()=>release.resolve());let retry=false;
 const h=await transport(t,{save:async()=>{if(retry){saving.resolve();await release.promise;}throw Error('disk full');}});
 await assert.rejects(h.client.request('mesh.generate',input).completion,/disk full/);retry=true;
 const run=h.client.request('mesh.retrySave');run.completion.catch(()=>{});
 await saving.promise;run.cancel('Operator Stop');await h.client.request('frame').completion;
 release.resolve();await assert.rejects(run.completion,/Stop/);
 assert.equal((await h.client.request('mesh.read').completion).output.state.pending,null);
 assert.equal(h.runs(),1);assert.equal(h.saves(),2);
});
