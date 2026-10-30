// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createSceneDocumentSession} from '../scene-document-session.mjs';
import {createSceneLoadRequests} from '../scene-load-generation.mjs';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {planSceneRestore} from '../scene-persistence-core.js';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const document=(source='demos/cube.glb')=>({version:8,objects:[{id:'root',type:'pbr',source,transform:pose}],composition:null});
const file=data=>({name:'disk-name.kaminos.json',text:async()=>JSON.stringify(data)});
const response=(saved='accepted.kaminos.json')=>({ok:true,status:200,json:async()=>({saved})});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(overrides={}) {
 const posts=[],bindings=[],messages=[],applied=[],navigations=[];
 const requests=createSceneLoadRequests();
 let address={origin:'http://localhost:9000',workspace:'workbench',owner:{id:'record-fixture',inputsText:'{"root":"original"}'}};
 const config={requests,records:createSceneRecordOperations(),planRestore:planSceneRestore,
  post:async body=>{posts.push(JSON.parse(body));return response();},readAddress:()=>address,
  restoreUrl:(doc,name,a)=>compositionRestoreUrl(doc.composition,name,a.origin,a.workspace,a.owner),
  apply:async(data,plan)=>{applied.push(plan.objects);},
  navigate:url=>navigations.push(url),bound:name=>bindings.push(name),status:text=>messages.push(text),filename:'existing.kaminos.json',...overrides};
 const session=createSceneDocumentSession(config);
 return {session,posts,bindings,messages,applied,navigations,requests,config,setAddress:value=>address=value};
}

test('authored Save rejects unsupported records before HTTP overwrite; Capture preserves live context',async()=>{
 const f=fixture(),live=document(null);live.capture={image:'data:image/png;base64,YQ==',width:1,height:1};
 const rejected=await f.session.save(live,'existing.kaminos.json',{result:true});
 assert.equal(rejected.ok,false);assert.match(rejected.error,/not reloadable/);assert.equal(f.posts.length,0);
 assert.equal(f.session.state().filename,'existing.kaminos.json');assert.equal(f.session.state().blocked,false);
 const retained=await f.session.capture(live,null,{result:true});
 assert.equal(retained.ok,true);assert.equal(f.posts.length,1);assert.deepEqual(retained.document,live);
 assert.equal(await f.session.save(document()),true);
});

test('save results retain submitted bytes and invocation address across asynchronous edits',async()=>{
 const gate=deferred(),f=fixture({post:()=>gate.promise}),doc=document();
 const pending=f.session.save(doc,null,{result:true});doc.objects[0].source='demos/changed.glb';
 f.setAddress({origin:'http://later',workspace:'authoring',owner:{id:'later',inputsText:'{}'}});
 gate.resolve(response());const result=await pending;
 assert.equal(result.document.objects[0].source,'demos/cube.glb');
 const url=new URL(result.url);assert.equal(url.origin,'http://localhost:9000');
 assert.equal(new URLSearchParams(url.hash.slice(1)).get('workspace'),'workbench');
 assert.match(result.url,/record-fixture/);assert.doesNotMatch(result.url,/later/);
});

test('failed responses and name conflicts preserve prior binding and have invocation-local results',async()=>{
 for(const resp of [{ok:false,status:503,json:async()=>({saved:'misleading.kaminos.json'})},response('../bad.kaminos.json'),response(''),{ok:true,json:async()=>null}]){
  const f=fixture({post:async()=>resp}),result=await f.session.save(document(),null,{result:true});
  assert.equal(result.ok,false);assert.equal(result.filename,undefined);assert.equal(f.session.state().filename,'existing.kaminos.json');assert.deepEqual(f.bindings,[]);
 }
 const f=fixture({post:async()=>({ok:false,status:409,json:async()=>({exists:'named.kaminos.json',error:'Exists'})})});
 const result=await f.session.save(document(),null,{result:true,saveAsName:'named'});
 assert.equal(result.exists,'named.kaminos.json');assert.equal(result.ok,false);assert.equal(f.session.state().filename,'existing.kaminos.json');
 const p=fixture();await p.session.save(document(),null,{result:true,saveAsName:'named',overwrite:true});
 assert.equal(p.posts[0]._saveAsName,'named');assert.equal(p.posts[0]._overwrite,true);
});

test('invalid JSON, document format and source preflight preserve the viable prior document',async()=>{
 for(const incoming of [{text:async()=>'{invalid'},file({version:999}),file(document(null)),{text:async()=>{throw Error('Read refused');}}]){
  const f=fixture();const result=await f.session.restore(incoming);
  assert.equal(result.ok,false);assert.equal(f.session.state().filename,'existing.kaminos.json');assert.equal(f.session.state().blocked,false);
  assert.equal(f.applied.length,0);assert.equal(f.bindings.length,0);
 }
});

test('partial application cannot keep or reacquire the old overwrite target',async()=>{
 let f;f=fixture({apply:async()=>{f.session.authoringChanged();assert.equal(f.session.state().blocked,true);throw Error('Environment or object stage failed');}});
 const result=await f.session.restore(file(document()),{sceneFile:'incoming.kaminos.json'});
 assert.equal(result.ok,false);assert.match(result.error,/stage failed/);assert.equal(f.session.state().filename,null);assert.equal(f.session.state().blocked,true);
 assert.deepEqual(f.bindings,[null]);assert.equal(await f.session.save(document()),false);assert.equal(f.posts.length,0);
 f.session.authoringChanged();assert.equal(f.session.state().blocked,false);
});

test('only completed current restoration binds a server file; disk names never imply server ownership',async()=>{
 const f=fixture();assert.equal((await f.session.restore(file(document()),{sceneFile:'incoming.kaminos.json'})).ok,true);
 assert.equal(f.session.state().filename,'incoming.kaminos.json');assert.equal(f.session.state().blocked,false);
 await f.session.restore(file(document()));assert.equal(f.session.state().filename,null);assert.deepEqual(f.bindings,['incoming.kaminos.json',null]);
});

test('superseded apply stages cannot claim a newer document',async()=>{
 const gate=deferred();let n=0;
 const f=fixture({apply:async()=>{if(++n===1)await gate.promise;}});
 const old=f.session.restore(file(document()),{sceneFile:'old.kaminos.json'});
 await new Promise(r=>setImmediate(r));
 await f.session.restore(file(document()),{sceneFile:'new.kaminos.json'});gate.resolve();
 assert.equal((await old).stale,true);assert.equal(f.session.state().filename,'new.kaminos.json');assert.deepEqual(f.bindings,['new.kaminos.json']);
});

test('a rejected newer read restores the viable admission, while an interrupted apply stays blocked',async()=>{
 const gate=deferred(),f=fixture();const old=f.session.restore({text:()=>gate.promise});
 await f.session.restore({text:async()=>'{invalid'});assert.equal(f.session.state().blocked,false);assert.equal(f.session.state().filename,'existing.kaminos.json');
 gate.resolve(JSON.stringify(document()));assert.equal((await old).stale,true);
 const applyGate=deferred(),g=fixture({apply:()=>applyGate.promise});const applying=g.session.restore(file(document()));await new Promise(r=>setImmediate(r));
 await g.session.restore({text:async()=>'{invalid'});assert.equal(g.session.state().blocked,true);assert.equal(g.session.state().filename,null);
 applyGate.resolve();assert.equal((await applying).stale,true);
});

test('a completed old save remains an artifact without rebinding a later restored document',async()=>{
 const gate=deferred(),f=fixture({post:()=>gate.promise});const old=f.session.save(document(),null,{result:true});
 await f.session.restore(file(document()),{sceneFile:'new.kaminos.json'});gate.resolve(response('old-save.kaminos.json'));
 const result=await old;assert.equal(result.ok,true);assert.equal(result.filename,'old-save.kaminos.json');
 assert.equal(f.session.state().filename,'new.kaminos.json');assert.deepEqual(f.bindings,['new.kaminos.json']);
});

test('preview snapshots cannot overwrite a newer document binding',async()=>{
 const f=fixture(),snapshot=f.session.snapshot();
 assert.equal(f.session.resume(snapshot),true);await f.session.restore(file(document()),{sceneFile:'new.kaminos.json'});
 assert.equal(f.session.resume(snapshot),false);assert.equal(f.session.state().filename,'new.kaminos.json');
});

test('navigation stages a certified document without claiming the current page; failed staging preserves it',async()=>{
 const f=fixture({requiresNavigation:()=>true});const result=await f.session.restore(file(document()));
 assert.equal(result.navigating,true);assert.equal(f.posts.length,1);assert.equal(f.navigations.length,1);assert.equal(f.applied.length,0);assert.deepEqual(f.bindings,[]);
 assert.equal(f.session.state().filename,'existing.kaminos.json');assert.equal(f.session.state().blocked,true);
 const g=fixture({requiresNavigation:()=>true,post:async()=>({ok:false,status:500,json:async()=>({error:'Disk failed'})})});
 assert.equal((await g.session.restore(file(document()))).ok,false);assert.equal(g.session.state().blocked,false);assert.equal(g.session.state().filename,'existing.kaminos.json');
});

test('startup holds survive preflight refusal; explicit clear cancels reads without leaving a transient block',async()=>{
 const f=fixture();f.session.holdRestore();await f.session.restore({text:async()=>'{invalid'});assert.equal(f.session.state().blocked,true);
 await f.session.restore(file(document()));assert.equal(f.session.state().blocked,false);
 const gate=deferred(),old=f.session.restore({text:()=>gate.promise});f.requests.invalidate();f.session.sceneCleared();
 assert.equal(f.session.state().blocked,false);gate.resolve(JSON.stringify(document()));assert.equal((await old).stale,true);
});

test('navigation retains the restore invocation address while file reading is pending',async()=>{
 const gate=deferred(),f=fixture({requiresNavigation:()=>true});
 const pending=f.session.restore({text:()=>gate.promise},{sceneFile:'incoming.kaminos.json'});
 f.setAddress({origin:'http://later',workspace:'authoring',owner:{id:'later',inputsText:'{}'}});
 gate.resolve(JSON.stringify(document()));assert.equal((await pending).navigating,true);
 assert.match(f.navigations[0],/localhost:9000/);assert.match(f.navigations[0],/record-fixture/);assert.doesNotMatch(f.navigations[0],/later/);
});
