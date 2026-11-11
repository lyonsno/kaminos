// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel,Worker} from 'node:worker_threads';
import {createSceneFrameComposition} from '../scene-frame-composition.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('cooperative scope drains admitted frames before its handler applies a new scene',async t=>{
  const started=deferred(),finishWork=deferred(),frameStarted=deferred(),finishFrame=deferred();let applied=false;
  const {client}=await harness(t,async()=>({commands:{load:async(_,ctx)=>{
    await ctx.withFrames(async()=>{started.resolve();await finishWork.promise;});
    applied=true;ctx.advanceEpoch('scene');ctx.activate();return true;
  }},requestFrame:async(_,ctx,draw)=>{frameStarted.resolve();await finishFrame.promise;return draw();},frame:()=>({drawn:true})}));
  await client.initialize({}).completion;
  const load=client.request('load');load.completion.catch(()=>{});await started.promise;
  const frame=client.request('frame');frame.completion.catch(()=>{});await frameStarted.promise;
  finishWork.resolve();await tick();await tick();const appliedBeforeFrame=applied;
  finishFrame.resolve();const observed=await frame.completion;await load.completion;
  assert.equal(appliedBeforeFrame,false);assert.equal(observed.output.drawn,true);assert.equal(applied,true);
});
test('pre-initialization commands fail promptly instead of leaving an unresolved request',async t=>{
  const {client,host,port}=await harness(t,async()=>({commands:{}}));
  const delivered=new Promise(resolve=>port.addEventListener('message',resolve,{once:true}));
  const request=client.request('frame');request.completion.catch(()=>{});await delivered;
  assert.equal(host.read().phase,'transport-failed');
  await assert.rejects(request.completion,/must initialize/);
  assert.equal(client.read().closed,true);
});
test('malformed response kinds and impossible request/control identities fail closed',async()=>{
  const {createSceneWorkerClient,SCENE_WORKER_REPLY}=await import('../scene-worker-handoff.mjs');
  for(const bad of [{kind:'bogus'},{kind:'result',requestId:'bad:99',ok:true},{kind:'progress'},{kind:'control-result',controlId:'bad:control:99'}]){
    const {port1,port2}=new MessageChannel(),client=createSceneWorkerClient({port:port1,sessionId:'bad'});
    const request=client.initialize({});request.completion.catch(()=>{});
    try{
      const delivered=new Promise(resolve=>port1.addEventListener('message',resolve,{once:true}));
      port2.postMessage({schema:SCENE_WORKER_REPLY,sessionId:'bad',epoch:{scene:0,load:0,device:0},...bad});
      await delivered;assert.equal(client.read().closed,true,JSON.stringify(bad));
      await assert.rejects(request.completion,error=>error.gpuRouteHeld===true);
    }finally{client.disconnect();port1.close();port2.close();}
  }
});
test('a caught progress clone failure does not skip the next observable sequence',async t=>{
  const {client}=await harness(t,async()=>({commands:{run:(_,ctx)=>{
    assert.throws(()=>ctx.report({callback(){}}),/clone/i);ctx.report({valid:true});return true;
  }}}));
  await client.initialize({}).completion;const run=client.request('run');await run.completion;
  assert.equal(run.progress[0].sequence,1);assert.deepEqual(run.progress[0].value,{valid:true});
});
test('invalid runtime primitives cannot poison retry, while canceled returned runtimes stay owned until retired',async t=>{
  let first=true;
  const a=await harness(t,async()=>{if(first){first=false;return 42;}return {commands:{}};});
  await assert.rejects(a.client.initialize({}).completion,/returned no runtime/);await a.client.initialize({}).completion;
  const started=deferred(),finish=deferred();let retirements=0;
  const b=await harness(t,async()=>{started.resolve();await finish.promise;return {commands:{},retire:()=>retirements++};});
  const init=b.client.initialize({});init.completion.catch(()=>{});await started.promise;init.cancel();await tick();await tick();finish.resolve();
  await assert.rejects(init.completion,error=>error.name==='AbortError');
  await assert.rejects(b.client.initialize({}).completion,/already initialized/);
  await b.client.request('retire').completion;assert.equal(retirements,1);
});
test('queued authored edits do not freeze cooperative frames or pretend pending state was applied',async t=>{
  const started=deferred(),finish=deferred(),edits=[];let value=0,draws=0;
  const {client}=await harness(t,async()=>({commands:{
    model:(_,ctx)=>ctx.withFrames(async()=>{started.resolve();await finish.promise;}),
    edit:next=>{edits.push(next);value=next;return value;},
  },requestFrame:(_,ctx,draw)=>draw(),frame:payload=>{draws++;return {value,camera:payload.camera};}}));
  await client.initialize({}).completion;
  const model=client.request('model');await started.promise;
  const first=client.request('edit',1),second=client.request('edit',2),frame=client.request('frame',{camera:[1,2,3]});
  await tick();await tick();await tick();const during={draws,edits:[...edits]};
  finish.resolve();await model.completion;await first.completion;await second.completion;
  const observed=await frame.completion;
  assert.equal(during.draws,1,'a queued authored edit must not block current applied scene frames');
  assert.deepEqual(during.edits,[],'inference retains its admitted inputs until a safe mutation boundary');
  assert.deepEqual(observed.output,{value:0,camera:[1,2,3]});
  assert.deepEqual(observed.epoch,{scene:0,load:0,device:0});
  assert.deepEqual(edits,[1,2]);
});
test('an unawaited cooperative scope still holds command completion and retirement',async t=>{
  const started=deferred(),finish=deferred();let retired=false,completed=false;
  const {client}=await harness(t,async()=>({
    commands:{run:(_,ctx)=>{ctx.withFrames(async()=>{started.resolve();await finish.promise;});return 'handler-returned';}},
    requestFrame:(_,ctx,draw)=>draw(),frame:()=>true,retire:()=>{retired=true;},
  }));
  await client.initialize({}).completion;
  const run=client.request('run');run.completion.then(()=>completed=true);
  await started.promise;const retirement=client.request('retire');
  await tick();await tick();
  assert.equal(completed,false,'the scope owns work beyond the handler return');
  assert.equal(retired,false);
  finish.resolve();await run.completion;await retirement.completion;
  assert.equal(retired,true);
});
async function harness(t,createRuntime){
  const {createSceneWorkerClient,installSceneWorkerHost}=await import('../scene-worker-handoff.mjs');
  const {port1,port2}=new MessageChannel();
  const host=installSceneWorkerHost({port:port2,createRuntime});
  const client=createSceneWorkerClient({port:port1,sessionId:'scene-test'});
  t.after(()=>{client.disconnect();host.disconnect();port1.close();port2.close();});
  return {host,client,port:port2};
}

test('frame transaction rejects asynchronous work before drawing a fallback',()=>{
  let frames=0;
  const frame=createSceneFrameComposition({readInputs:()=>({}),draw:()=>frames++,frameCount:()=>frames});
  frame.setForegroundServiceActive(true);
  assert.throws(()=>frame.runForegroundFrame(()=>Promise.resolve({status:'submitted'})),/synchronous/);
  assert.equal(frames,0,'an unresolved callback is not authority to draw a fallback');
});

test('persistent host constructs once, orders commands and keeps frames synchronous',async t=>{
  const calls=[],gate=deferred();let frames=0;
  const composition=createSceneFrameComposition({readInputs:()=>({}),draw:()=>frames++,frameCount:()=>frames});
  composition.setForegroundServiceActive(true);
  const {client}=await harness(t,async({payload})=>{
    calls.push(['initialize',payload]);
    return {commands:{edit:async value=>{calls.push(['edit-start',value]);await gate.promise;calls.push(['edit-end']);return value;}},
      frame:()=>composition.runForegroundFrame(()=>({status:'submitted'})),retire:async()=>calls.push(['retire'])};
  });
  const init=await client.initialize({scene:'original'}).completion;
  assert.equal(init.authority,'worker-handler-returned');
  const edit=client.request('edit',{x:3}),frame=client.request('frame');
  await tick();await tick();assert.equal(frames,0);
  gate.resolve();assert.deepEqual((await edit.completion).output,{x:3});
  const result=await frame.completion;
  assert.equal(result.output.sceneFrameCount,1);
  assert.equal(result.output.sceneAuthority,'three-render-returned-inside-service-not-presentation');
  assert.deepEqual(calls,[['initialize',{scene:'original'}],['edit-start',{x:3}],['edit-end']]);
  await assert.rejects(client.initialize({}).completion,/already initialized/);
});

test('cancellation reaches an active operation but waits for actual settlement',async t=>{
  const started=deferred(),settle=deferred();let signal;
  const {client}=await harness(t,async()=>({commands:{prepare:async(_,ctx)=>{signal=ctx.signal;started.resolve();await settle.promise;return 'too-late';}}}));
  await client.initialize({}).completion;
  const run=client.request('prepare');await started.promise;
  let completed=false;run.completion.catch(()=>{}).finally(()=>completed=true);
  run.cancel('operator stop');await tick();await tick();
  assert.equal(signal.aborted,true);assert.equal(completed,false,'abort request must not pretend that work settled');
  settle.resolve();await assert.rejects(run.completion,error=>error.name==='AbortError');
  assert.deepEqual(client.read().pending,[]);
});

test('scene/load/device epochs invalidate old work and cannot publish stale success',async t=>{
  const started=deferred(),settle=deferred();let lifecycle,signal;
  const {client,host}=await harness(t,async({lifecycle:life})=>{
    lifecycle=life;
    return {commands:{prepare:async(_,ctx)=>{signal=ctx.signal;started.resolve();await settle.promise;return 'old device';},read:()=>42}};
  });
  await client.initialize({}).completion;
  const oldLife=lifecycle.signal,run=client.request('prepare');run.completion.catch(()=>{});await started.promise;
  host.invalidate('device');await tick();
  assert.equal(oldLife.aborted,true);assert.equal(signal.aborted,true);
  assert.notEqual(lifecycle.signal,oldLife);
  settle.resolve();await assert.rejects(run.completion,/epoch|generation/i);
  assert.deepEqual(client.read().epoch,{scene:0,load:0,device:1});
  await assert.rejects(client.request('read',null,{epoch:{scene:0,load:0,device:0}}).completion,/epoch|generation/i);
  assert.equal((await client.request('read').completion).output,42);
});

test('an ordered scene replacement advances its own ticket and fences queued old commands',async t=>{
  const {client}=await harness(t,async()=>({commands:{replace:(_,ctx)=>{ctx.advanceEpoch('load');ctx.advanceEpoch('scene');return 'new scene';},edit:()=>true}}));
  await client.initialize({}).completion;
  const replace=client.request('replace'),stale=client.request('edit');stale.completion.catch(()=>{});
  const result=await replace.completion;
  assert.deepEqual(result.epoch,{scene:1,load:1,device:0});
  await assert.rejects(stale.completion,/epoch|generation/i);
  assert.equal((await client.request('edit').completion).output,true);
});

test('borrowed unsettled inference prevents retirement and no success receipt escapes',async t=>{
  let unsettled=['model-1'],retired=0;
  const {client}=await harness(t,async()=>({host:{unsettledRuns:()=>unsettled},commands:{},retire:async()=>retired++}));
  await client.initialize({}).completion;
  await assert.rejects(client.request('retire').completion,error=>error.gpuRouteHeld===true);
  assert.equal(retired,0);
  unsettled=[];
  const receipt=await client.request('retire').completion;
  assert.equal(retired,1);assert.equal(receipt.authority,'worker-handler-returned');
  assert.equal(receipt.epoch.device,1);
  await assert.rejects(client.request('frame').completion,/not initialized/);
});

test('native MessagePort transfers CPU buffers, forwards progress and rejects unclonable output',async t=>{
  const {client}=await harness(t,async()=>({commands:{bytes:(payload,ctx)=>{ctx.report({loaded:payload.buffer.byteLength});return new Uint8Array(payload.buffer)[0];},bad:()=>({callback(){}})}}));
  await client.initialize({}).completion;
  const buffer=new Uint8Array([7,8,9]).buffer;
  const run=client.request('bytes',{buffer},{transfer:[buffer]});
  assert.equal(buffer.byteLength,0);
  assert.equal((await run.completion).output,7);
  assert.deepEqual(run.progress.map(p=>p.value),[{loaded:3}]);
  await assert.rejects(client.request('bad').completion,/clone|serializ/i);
});

test('malformed or wrong-session receipts fail pending requests without claiming GPU settlement',async t=>{
  const {createSceneWorkerClient}=await import('../scene-worker-handoff.mjs');
  for(const message of [null,{schema:'kaminos.scene-worker.reply.v0',sessionId:'wrong',kind:'result',requestId:'scene-test:1',epoch:{scene:0,load:0,device:0},ok:true,output:'counterfeit'}]){
    const {port1,port2}=new MessageChannel();const client=createSceneWorkerClient({port:port1,sessionId:'scene-test'});
    const request=client.initialize({});port2.postMessage(message);
    await assert.rejects(request.completion,error=>error.gpuRouteHeld===true);
    assert.equal(client.read().closed,true);port1.close();port2.close();
  }
});

test('abort before dispatch retains caller buffer ownership',async t=>{
  const {client}=await harness(t,async()=>({commands:{}}));
  await client.initialize({}).completion;
  const controller=new AbortController();controller.abort();const buffer=new ArrayBuffer(16);
  await assert.rejects(client.request('edit',{buffer},{signal:controller.signal,transfer:[buffer]}).completion,error=>error.name==='AbortError');
  assert.equal(buffer.byteLength,16);
});

test('a real worker runs the production frame owner and applied scene edits',async t=>{
  const {createSceneWorkerClient}=await import('../scene-worker-handoff.mjs');
  const {port1,port2}=new MessageChannel();
  const worker=new Worker(new URL('./fixtures/scene-worker-handoff-runtime.mjs',import.meta.url),{workerData:{port:port2},transferList:[port2]});
  const client=createSceneWorkerClient({port:port1,sessionId:'off-page'});
  t.after(async()=>{client.disconnect();port1.close();await worker.terminate();});
  await client.initialize({value:1}).completion;
  assert.deepEqual((await client.request('edit',8).completion).output.value,8);
  const frame=(await client.request('frame').completion).output;
  assert.ok(frame.threadId>0,'the main test thread must not execute the frame');
  assert.equal(frame.value,8);assert.equal(frame.sceneFrameCount,1);
  const replacement=await client.request('replace',12).completion;
  assert.equal(replacement.epoch.scene,1);
  assert.equal((await client.request('frame').completion).output.value,12);
  assert.equal((await client.request('retire').completion).output.retired,true);
});

test('device invalidation blocks frames until runtime recovery explicitly activates',async t=>{
  const {client,host}=await harness(t,async()=>({commands:{recover:(_,ctx)=>{ctx.activate();return true;}},frame:()=>({drawn:true})}));
  await client.initialize({}).completion;
  host.invalidate('device');await tick();await tick();
  await assert.rejects(client.request('frame').completion,/not active/);
  await client.request('recover').completion;
  assert.deepEqual((await client.request('frame').completion).output,{drawn:true});
});

test('runtime async frame and failed initialization cannot produce a drawn success',async t=>{
  let fail=true;
  const {client}=await harness(t,async()=>{
    if(fail){fail=false;throw Error('construction failed');}
    return {commands:{},frame:async()=>({drawn:true})};
  });
  await assert.rejects(client.initialize({}).completion,/construction failed/);
  await client.initialize({}).completion;
  await assert.rejects(client.request('frame').completion,/synchronous/);
});

test('native transfers return explicit CPU output without retaining a duplicate worker buffer',async t=>{
  let output;
  const {client}=await harness(t,async()=>({commands:{
    result:(_,ctx)=>{output=new Uint8Array([3,4,5]).buffer;ctx.transfer([output]);return {buffer:output};},
    retained:()=>output.byteLength,
  }}));
  await client.initialize({}).completion;
  const result=await client.request('result').completion;
  assert.deepEqual([...new Uint8Array(result.output.buffer)],[3,4,5]);
  assert.equal((await client.request('retained').completion).output,0);
});

test('unclonable input fails dispatch without detaching data or wedging subsequent operations',async t=>{
  const {client}=await harness(t,async()=>({commands:{read:()=>1}}));
  await client.initialize({}).completion;
  const buffer=new ArrayBuffer(16);
  await assert.rejects(client.request('read',{buffer,callback(){}},{transfer:[buffer]}).completion,/clone/i);
  assert.equal(buffer.byteLength,16);assert.deepEqual(client.read().pending,[]);
  assert.equal((await client.request('read').completion).output,1);
});

test('failed retirement remains explicitly held and does not destroy an initialized host',async t=>{
  const {client}=await harness(t,async()=>({commands:{},retire:async()=>{throw Error('settlement failed');}}));
  await client.initialize({}).completion;
  await assert.rejects(client.request('retire').completion,error=>error.gpuRouteHeld===true&&/settlement failed/.test(error.message));
  await assert.rejects(client.initialize({}).completion,/already initialized/);
});

test('cooperative model execution admits synchronous frames before the model finishes',async t=>{
  const started=deferred(),finish=deferred(),calls=[];
  const {client}=await harness(t,async()=>({commands:{
    model:async(_,ctx)=>{assert.equal(typeof ctx.withFrames,'function','model work needs a cooperative frame scope');return ctx.withFrames(async()=>{started.resolve();await finish.promise;return 'model result';});},
  },requestFrame:async(_,ctx,draw)=>{ctx.assertCurrent();calls.push('foreground admission');return draw();},frame:()=>{calls.push('synchronous draw');return {drawn:true};}}));
  await client.initialize({}).completion;
  const model=client.request('model');model.completion.catch(()=>{});
  // Report the missing scope as an assertion, rather than hanging on its gate.
  await Promise.race([started.promise,model.completion]);
  const frame=await client.request('frame').completion;
  assert.equal(frame.output.drawn,true);
  assert.deepEqual(calls,['foreground admission','synchronous draw']);
  finish.resolve();assert.equal((await model.completion).output,'model result');
});

test('sideband model controls stay ordered and scene retirement waits for control settlement',async t=>{
  const started=deferred(),finish=deferred(),controlStarted=deferred(),controlFinish=deferred(),calls=[];
  const {client}=await harness(t,async()=>({commands:{model:async()=>{started.resolve();await finish.promise;return true;}},
    control:async(action,payload,ctx)=>{ctx.assertCurrent();calls.push(action);controlStarted.resolve();await controlFinish.promise;return {action,payload};},
    retire:async()=>{calls.push('retire');return true;}}));
  await client.initialize({}).completion;
  const model=client.request('model');await started.promise;
  const pause=model.control('pause',{reason:'operator'});await controlStarted.promise;
  const retire=client.request('retire');
  finish.resolve();await model.completion;await tick();
  assert.deepEqual(calls,['pause']);
  controlFinish.resolve();assert.equal((await pause.completion).output.action,'pause');
  await retire.completion;assert.deepEqual(calls,['pause','retire']);
  await assert.rejects(model.control('resume').completion,/no longer pending/);
});

test('two-stage initialization retains partial resources through failed cleanup and retirement retry',async t=>{
  let allocations=0,releases=0,attempts=0,commands=0;
  const {client,host}=await harness(t,()=>({
    initialize:async()=>{allocations++;throw Error('renderer init failed');},
    commands:{edit:()=>commands++},frame:()=>{throw Error('partial renderer must not draw');},
    retire:async()=>{attempts++;if(attempts===1)throw Error('renderer cleanup failed');releases++;return {released:true};},
  }));
  await assert.rejects(client.initialize({}).completion,error=>/renderer init failed/.test(error.message)&&error.gpuRouteHeld===true);
  assert.equal(allocations,1);assert.equal(host.read().runtimeRetained,true);assert.equal(host.read().initialized,false);
  await assert.rejects(client.request('edit').completion,/not initialized/);assert.equal(commands,0);
  await assert.rejects(client.request('frame').completion,/not initialized/);
  await assert.rejects(client.initialize({}).completion,/already initialized|retained/);
  await assert.rejects(client.request('retire').completion,error=>/renderer cleanup failed/.test(error.message)&&error.gpuRouteHeld===true);
  assert.equal(host.read().runtimeRetained,true);assert.equal(host.read().initialized,false);assert.equal(releases,0);
  const retired=await client.request('retire').completion;
  assert.deepEqual(retired.output,{released:true});assert.equal(attempts,2);assert.equal(releases,1);
  assert.equal(host.read().runtimeRetained,false);assert.equal(host.read().initialized,false);assert.equal(retired.epoch.device,1);
});
test('two-stage initialization cannot complete or admit work before its actual setup settles',async t=>{
  const started=deferred(),finish=deferred();let completed=false,controls=0;
  const {client,host}=await harness(t,()=>({
    initialize:async ctx=>{ctx.assertCurrent();started.resolve();await finish.promise;},
    commands:{read:()=>42},control:()=>controls++,retire:()=>true,
  }));
  const init=client.initialize({});init.completion.then(()=>completed=true,()=>{});
  await Promise.race([started.promise,init.completion]);
  try{
    assert.equal(completed,false,'factory shell return is not initialization completion');
    assert.equal(host.read().runtimeRetained,true);assert.equal(host.read().initialized,false);
    await assert.rejects(init.control('decodeNow').completion,/not initialized/);assert.equal(controls,0);
  }finally{finish.resolve();await init.completion;}
  assert.equal(host.read().initialized,true);assert.equal((await client.request('read').completion).output,42);
});
test('canceled two-stage setup settles without success and retains its runtime for explicit retirement',async t=>{
  const started=deferred(),finish=deferred();let retired=0;
  const {client,host}=await harness(t,()=>({initialize:async()=>{started.resolve();await finish.promise;},commands:{},retire:()=>++retired}));
  const init=client.initialize({});init.completion.catch(()=>{});
  await Promise.race([started.promise,init.completion]);
  init.cancel('cancel setup');await tick();await tick();finish.resolve();
  await assert.rejects(init.completion,error=>error.name==='AbortError'&&error.gpuRouteHeld===true);
  assert.equal(host.read().runtimeRetained,true);assert.equal(host.read().initialized,false);
  await client.request('retire').completion;assert.equal(retired,1);
});
test('fallible two-stage initialization requires a retirement path before allocating resources',async t=>{
  let initialized=false;
  const {client,host}=await harness(t,()=>({initialize:()=>{initialized=true;},commands:{}}));
  await assert.rejects(client.initialize({}).completion,/retire|retirement/);assert.equal(initialized,false);
  assert.equal(host.read().runtimeRetained,true);assert.equal(host.read().initialized,false);
  await assert.rejects(client.request('retire').completion,error=>error.gpuRouteHeld===true&&/retire|retirement/.test(error.message));
});

test('retained initialization shells keep live resource getters instead of snapshotting partial state',async t=>{
  let resources=null,commandReads=0,hostReads=0;
  const {client,host}=await harness(t,()=>({
    initialize:async()=>{resources={value:73};},
    get commands(){commandReads++;assert.ok(resources);return {read:()=>resources.value};},
    get foregroundCommands(){assert.ok(resources);return {};},
    get host(){hostReads++;return resources?{unsettledRuns:()=>[]}:null;},
    retire:()=>{resources=null;return true;},
  }));
  await client.initialize({}).completion;assert.equal(commandReads,0);
  assert.equal((await client.request('read').completion).output,73);assert.ok(commandReads>0);
  await client.request('retire').completion;assert.equal(resources,null);assert.ok(hostReads>0);
  assert.equal(host.read().runtimeRetained,false);
});
test('scene load and device invalidation during retained setup cannot publish initialized success',async t=>{
  for(const part of ['scene','load','device']){
    const started=deferred(),finish=deferred();let retirements=0;
    const {client,host}=await harness(t,()=>({initialize:async()=>{started.resolve();await finish.promise;},retire:()=>++retirements}));
    const init=client.initialize({});init.completion.catch(()=>{});await started.promise;
    host.invalidate(part);finish.resolve();
    await assert.rejects(init.completion,error=>error.gpuRouteHeld===true&&/epoch/.test(error.message));
    assert.equal(host.read().initialized,false);assert.equal(host.read().runtimeRetained,true);
    await client.request('retire').completion;assert.equal(retirements,1);
  }
});
