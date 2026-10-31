// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import experiment from '../experiments/hand-live.experiment.mjs';
import {openLiveFluidSession} from '../owner-live-fluid-session.mjs';
import {Vector3,Matrix3} from '../lib/three.core.js';

for(const playSpace of [null,{}])for(const present of [false,true])test(`scene expiry releases camera ${present?'after presentation':'before first frame'} (play=${!!playSpace})`,async t=>{
  const saved=new Map(['fetch','navigator','indexedDB'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  t.after(()=>{for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  let trackStops=0,cancelled=0,closed=0,sceneDisposed=0,waterDisposed=0,callback,current=null,generation=0;
  let presented,visibleMesh,presentationEvent;
  const presentation=new Promise(resolve=>presented=resolve);
  const video={style:{},videoWidth:640,videoHeight:480,play:async()=>{},
    requestVideoFrameCallback:fn=>{callback=fn;return 1;},cancelVideoFrameCallback:()=>cancelled++};
  const canvas={getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,fixture'};
  const document={defaultView:{innerWidth:1000},location:{origin:'http://fixture'},createElement:tag=>tag==='video'?video:canvas};
  const scene={attach:async root=>{visibleMesh=root;return {}},setView(){},readView:()=>({}),redraw(){},onFrame:()=>()=>{},dispose:async()=>sceneDisposed++};
  const water={state:()=>({}),setLiveInletPacket(){},setPaused(){},dispose:()=>waterDisposed++};
  const host={controls:{document},scene:{open:async()=>scene},fluid:{openInlets:options=>openLiveFluidSession({
    getHost:()=>current,setHost:v=>current=v,getGeneration:()=>generation,createHost:async()=>water},options)}};
  const identity={model:'mobrecon_densestack_spiralconv',backend:'pytorch',device:'cpu',checkpointSha256:'fixture',sourceRevision:'fixture'};
  const track={stop:()=>trackStops++,getSettings:()=>({})};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})}}});
  globalThis.indexedDB={open:()=>{
    const request={result:{close:()=>closed++,transaction:()=>{
      const tx={objectStore:()=>({put(){}})};queueMicrotask(()=>tx.oncomplete());return tx;
    }}};queueMicrotask(()=>request.onsuccess());return request;
  }};
  globalThis.fetch=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):{};
    const path=new URL(url).pathname;
    let value={};
    if(path==='/health')value={status:'loaded',identity,interactionAuthority:false,faces:Array.from({length:1538},()=>[0,1,2])};
    if(path==='/session')value={sessionId:'fixture-session'};
    if(path==='/frame')value={...body,identity,available:true,interactionAuthority:false,authority:'live_native_diagnostic_not_interaction',
      source:identity.model,jointBasis:'upstream_j_reg_mano_to_mpii',handedness:'right',
      cropBox:[100,80,300,280],cropUV:Array(42).fill(.5),pixelBasis:'unmirrored_camera',
      verticesMeters:Array.from({length:778},(_,i)=>i===1?[.04,0,0]:i===2?[0,.06,0]:i===3?[0,0,.03]:[0,0,0]),
      meshJointsMeters:[[0,0,0],...Array.from({length:5},(_,f)=>Array.from({length:4},(_,j)=>[f*.02,j*.02,0])).flat()]};
    if(path==='/event'&&body.kind==='presented'){presentationEvent=body;presented();}
    return {ok:true,json:async()=>value};
  };
  const instance=await experiment.create({host,inputs:{fingerJuice:true,playSpace},record(){}});
  await instance.operations.start();
  if(present){callback(0,{});await presentation;await new Promise(resolve=>setImmediate(resolve));assert.equal(instance.read().received,1);
    visibleMesh.updateWorldMatrix(true,false);
    const p=visibleMesh.geometry.attributes.position;
    const points=[0,1,2,3].map(i=>new Vector3().fromBufferAttribute(p,i).applyMatrix4(visibleMesh.matrixWorld));
    const [a,b,c]=points.slice(1).map(v=>v.sub(points[0]));
    assert(a.dot(b.clone().cross(c))>0,'default displayed glove must preserve source chirality');
    assert.equal(Math.sign(c.z),playSpace?1:-1,'standalone depth correction must not change accepted play depth');
    if(playSpace){
      assert(Math.abs(a.x+.2)<1e-7);assert(Math.abs(b.y+.3)<1e-7);assert(Math.abs(c.z-.15)<1e-7);
      const normal=new Vector3().fromBufferAttribute(visibleMesh.geometry.attributes.normal,0).applyNormalMatrix(new Matrix3().getNormalMatrix(visibleMesh.matrixWorld));
      assert(normal.z<-.99,'accepted play surface normals must not invert during basis reconciliation');
    }
    assert.equal(presentationEvent.displayTransform.invertZ,true,'retained presentation must name the effective basis');
  }
  generation++;current.dispose();
  const replacement={};current=replacement;
  // Stop must release the actual resources even if the fluid guard rejects it.
  await instance.operations.stop().catch(()=>{});
  assert.equal(trackStops,1,'expired fluid interrupted camera shutdown');
  assert.ok(cancelled>0,'video callback not cancelled');
  const state=instance.read();assert.match(state.fingerJuice.error,/expired/);
  assert.equal(state.fingerJuice.runtime,null);
  await instance.dispose();
  assert.equal(closed,1);assert.equal(sceneDisposed,1);assert.equal(waterDisposed,1);
  assert.equal(current,replacement,'replacement water must remain owned by its scene');
});
