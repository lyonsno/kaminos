// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import experiment from '../experiments/hand-live.experiment.mjs';

test('capacity changes remount water while the camera remains live and reads actual admission',async t=>{
  const saved=new Map(['fetch','navigator','indexedDB'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  let instance;
  t.after(async()=>{await instance?.dispose().catch(()=>{});for(const [k,d] of saved)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];});
  let callback,stops=0,closed=0,disposed=0,finishMount,delay=false,fail=false;
  const mounted=[],records=[];
  const video={style:{},videoWidth:640,videoHeight:480,play:async()=>{},requestVideoFrameCallback:fn=>{callback=fn;return 1;},cancelVideoFrameCallback(){}};
  const canvas={getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,fixture'};
  const document={defaultView:{innerWidth:1000},location:{origin:'http://fixture'},createElement:tag=>tag==='video'?video:canvas};
  const scene={attach:async()=>({}),setView(){},readView:()=>({}),redraw(){},onFrame:()=>()=>{},dispose(){}};
  const identity={model:'mobrecon_densestack_spiralconv',backend:'pytorch',device:'cpu',checkpointSha256:'fixture',sourceRevision:'fixture'};
  const track={stop:()=>stops++,getSettings:()=>({})};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})}}});
  globalThis.indexedDB={open:()=>{const request={result:{close:()=>closed++,transaction:()=>{const tx={objectStore:()=>({put(){}})};queueMicrotask(()=>tx.oncomplete());return tx;}}};queueMicrotask(()=>request.onsuccess());return request;}};
  globalThis.fetch=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):{},path=new URL(url).pathname;
    let value={};
    if(path==='/health')value={status:'loaded',identity,interactionAuthority:false,faces:Array.from({length:1538},()=>[0,1,2])};
    if(path==='/session')value={sessionId:'fixture-session'};
    return {ok:true,json:async()=>value};
  };
  const host={controls:{document},scene:{open:async()=>scene},fluid:{openInlets:async({setup})=>{
    if(delay)await new Promise(resolve=>finishMount=resolve);
    if(fail)throw Error('fixture allocation failed');
    const row={count:setup.particleCount,paused:true};mounted.push(row);
    return {read:()=>({setup,solver:{particleCount:setup.particleCount,liveInlets:{poolCapacity:setup.particleCount,expectedParticleReleaseRate:0,inlets:[]}}}),
      setPacket:p=>{row.packet=p;},setPaused:p=>row.paused=p,dispose:()=>{row.disposed=true;disposed++;}};
  }}};
  instance=await experiment.create({host,inputs:{fingerJuice:true},record:r=>records.push(r)});
  assert.equal(typeof instance.operations.setParticleCount,'function','capacity control is absent');
  await instance.operations.setParticleCount(4800);
  assert.equal(mounted.length,0,'editing idle capacity must not allocate a solver');
  await instance.operations.start();
  assert.equal(mounted[0].count,4800);assert.equal(typeof callback,'function');
  await instance.operations.setParticleCount(9600);
  assert.equal(mounted[0].disposed,true);assert.equal(mounted[1].count,9600);
  assert.equal(mounted[1].paused,false);assert.equal(stops,0);assert.equal(instance.read().running,true);
  assert.equal(instance.read().fingerJuice.load.mountedParticleCount,9600);
  instance.operations.setSourceFlux(3000);
  assert.equal(instance.read().fingerJuice.load.requestedRate,3000);
  assert.equal(mounted.length,2,'rate changes must not reallocate water');
  assert.throws(()=>instance.operations.setParticleCount(0),/particle/i);
  fail=true;
  await assert.rejects(instance.operations.setParticleCount(19200),/allocation failed/);
  assert.equal(instance.read().fingerJuice.load.mountedParticleCount,null);
  assert.match(instance.read().fingerJuice.error,/allocation failed/);
  assert.equal(stops,0);
  fail=false;delay=true;
  const allocation=instance.operations.setParticleCount(2400);
  await new Promise(resolve=>setImmediate(resolve));
  const closing=instance.dispose();finishMount();
  await Promise.allSettled([allocation,closing]);
  assert.equal(mounted.at(-1).disposed,true,'closing during allocation leaked water');
  assert.equal(stops,1);assert.ok(closed>=1);assert.ok(disposed>=2);
  assert.ok(records.some(r=>r.kind==='hand-live.capacity'));
});
