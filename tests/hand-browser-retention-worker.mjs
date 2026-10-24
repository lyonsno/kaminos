// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const worker=await import('../experiments/hand-browser-retention-worker.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const client=await import('../experiments/hand-browser-retention.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
test('browser capture retention has an independent worker path',()=>{
  assert.equal(typeof worker.createCaptureWriter,'function','capture encoding and storage still block the hand path');
  assert.equal(typeof client.openBrowserCaptureStore,'function');
});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('slow encoding preserves source/outcome ordering and flush drains every input',async()=>{
  if(!worker.createCaptureWriter)return;
  const gate=deferred(),saved=[],events=[];
  const writer=worker.createCaptureWriter({store:{put:async value=>saved.push(structuredClone(value))},
    encode:async bitmap=>{await gate.promise;return bitmap.pixels;},writeEvent:async value=>events.push(value)});
  const capture={captureId:'a',request:{sessionId:'s'},identity:{backend:'webgpu-local'}};
  const first=writer.enqueue({type:'capture',capture,bitmap:{pixels:'exact-a'}});
  const second=writer.enqueue({type:'outcome',captureId:'a',outcome:{state:'computed',prediction:{captureId:'a',vertices:[1,2,3]}}});
  const third=writer.enqueue({type:'event',value:{kind:'presented',captureId:'a'}});
  let flushed=false;const flush=writer.enqueue({type:'flush'}).then(()=>{flushed=true;});
  await new Promise(r=>setImmediate(r));assert.equal(flushed,false);assert.equal(saved.length,0);
  gate.resolve();await Promise.all([first,second,third,flush]);
  assert.deepEqual(saved.map(x=>[x.captureId,x.request.image,x.outcome.state]),[['a','exact-a','submitted'],['a','exact-a','computed']]);
  assert.equal(events[0].captureId,'a');assert.equal(writer.read().pendingCaptures,0);
});
test('transport failure does not discard queued raw inputs or replace a failed inference with success',async()=>{
  if(!worker.createCaptureWriter)return;
  const local=[];let writes=0;
  const writer=worker.createCaptureWriter({encode:async b=>b.pixels,writeEvent:async()=>{},store:{put:async value=>{
    local.push(structuredClone(value));if(++writes===1)throw Error('HTTP retention failed');
  }}});
  const capture=id=>({captureId:id,request:{sessionId:'s'},identity:{backend:'webgpu-local'}});
  await assert.rejects(writer.enqueue({type:'capture',capture:capture('a'),bitmap:{pixels:'raw-a'}}),/HTTP retention failed/);
  await writer.enqueue({type:'outcome',captureId:'a',outcome:{state:'failed',error:'inference failed before output'}});
  await writer.enqueue({type:'capture',capture:capture('b'),bitmap:{pixels:'raw-b'}});
  await writer.enqueue({type:'outcome',captureId:'b',outcome:{state:'computed',prediction:{captureId:'b'}}});
  await assert.rejects(writer.enqueue({type:'flush'}),/HTTP retention failed/);
  assert.deepEqual(local.map(x=>[x.captureId,x.request.image,x.outcome.state]),[
    ['a','raw-a','submitted'],['a','raw-a','failed'],['b','raw-b','submitted'],['b','raw-b','computed']]);
  await assert.rejects(writer.enqueue({type:'outcome',captureId:'missing',outcome:{state:'computed'}}),/Unknown capture/);
});
test('client enqueue never waits for disk; close waits for worker flush and errors stay observable',async()=>{
  if(!client.openBrowserCaptureStore)return;
  let instance;class FakeWorker{
    constructor(){instance=this;this.messages=[];this.terminated=false;queueMicrotask(()=>this.onmessage({data:{type:'loaded'}}));}
    postMessage(message,transfer){this.messages.push({message,transfer});}
    terminate(){this.terminated=true;}
  }
  const failures=[];const store=await client.openBrowserCaptureStore({Worker:FakeWorker,onFailure:e=>failures.push(String(e))});
  const bitmap={};store.begin({captureId:'a'},bitmap);store.finish('a',{state:'computed'});
  assert.equal(instance.messages.length,2);assert.equal(instance.messages[0].transfer[0],bitmap);
  assert.equal(store.read().pending,2);
  let closed=false;const closing=store.close().then(()=>{closed=true;});
  await new Promise(r=>setImmediate(r));assert.equal(closed,false);assert.equal(instance.terminated,false);
  for(const {message} of instance.messages)instance.onmessage({data:{type:'settled',sequence:message.sequence}});
  await closing;assert.equal(instance.terminated,true);assert.equal(store.read().pending,0);
  const failed=await client.openBrowserCaptureStore({Worker:FakeWorker,onFailure:e=>failures.push(String(e))});
  failed.begin({captureId:'b'},{});instance.onmessage({data:{type:'settled',sequence:1,error:'disk failure'}});
  assert.throws(()=>failed.check(),/disk failure/);assert.equal(failures.length,1);
  const close=failed.close();const last=instance.messages.at(-1).message;
  instance.onmessage({data:{type:'settled',sequence:last.sequence,error:'disk failure'}});
  await assert.rejects(close,/disk failure/);assert.equal(instance.terminated,true);
});
test('encoding failure leaves a durable phase report and retains any subsequent computed result',async()=>{
  const saved=[];let closed=0;
  const writer=worker.createCaptureWriter({store:{put:async v=>saved.push(structuredClone(v))},
    encode:async()=>{throw Error('PNG encoder failed');},writeEvent:async()=>{}});
  await assert.rejects(writer.enqueue({type:'capture',capture:{captureId:'a',request:{sessionId:'s'}},bitmap:{close(){closed++;}}}),/PNG encoder failed/);
  assert.equal(saved[0]?.outcome.phase,'source_encoding','failure before raw image output needs a durable report');
  assert.equal(saved[0].request.image,undefined);
  await writer.enqueue({type:'outcome',captureId:'a',outcome:{state:'computed',prediction:{captureId:'a'}}});
  assert.match(saved[1].sourceFailure,/PNG encoder failed/);assert.equal(saved[1].outcome.state,'computed');
  assert.equal(closed,1);
});
for(const operation of ['stop','dispose'])test(`${operation} owns a recording worker that finishes loading late`,async t=>{
  const saved=new Map(['Worker','__handStartupBackend','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  t.after(()=>{for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  let instance,sceneClosed=0,backendClosed=0,sessions=0,cameras=0,water=0;
  globalThis.Worker=class {
    constructor(){instance=this;this.terminated=false;}
    postMessage(message){queueMicrotask(()=>this.onmessage({data:{type:'settled',sequence:message.sequence}}));}
    terminate(){this.terminated=true;}
  };
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{cameras++;throw Error('late camera start');}}}});
  globalThis.__handStartupBackend={
    api:async path=>{if(path==='/session'){sessions++;return {sessionId:'late'};}return {status:'loaded',identity:{model:'mobrecon_densestack_spiralconv',detector:{}},interactionAuthority:false,faces:Array.from({length:1538},()=>[0,1,2])};},
    stopRecording:async()=>{},close:async()=>backendClosed++,
  };
  const url=new URL('../experiments/hand-live.experiment.mjs',import.meta.url);
  const source=(await readFile(url,'utf8'))
    .replaceAll(/from '([^']+)'/g,(_,specifier)=>`from '${new URL(specifier,url).href}'`)
    .replace("await (await import('./hand-browser-backend.mjs')).openBrowserHandBackend({host,inputs})",'globalThis.__handStartupBackend');
  const {default:experiment}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${operation}`);
  const scene={attach:async()=>({}),setView(){},onFrame:()=>()=>{},dispose:async()=>sceneClosed++};
  const document={defaultView:{innerWidth:1000},location:{origin:'http://fixture'},createElement:()=>({style:{},getContext:()=>({})})};
  const hand=await experiment.create({host:{controls:{document},scene:{open:async()=>scene},fluid:{openInlets:async()=>{water++;throw Error('late water start');}}},inputs:{backend:'webgpu',fingerJuice:true},record(){}});
  const starting=hand.operations.start().catch(error=>error);
  assert(instance,'worker was not started');
  const cancelling=operation==='dispose'?hand.dispose():hand.operations.stop();
  await new Promise(resolve=>setImmediate(resolve));
  instance.onmessage({data:{type:'loaded'}});
  await Promise.all([starting,cancelling]);
  assert.equal(instance.terminated,true,'late worker survives cancelled startup');
  assert.equal(sessions,0);assert.equal(cameras,0);assert.equal(water,0);
  if(operation==='stop')await hand.dispose();
  assert.equal(sceneClosed,1);assert.equal(backendClosed,1);
});
