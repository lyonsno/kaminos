// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSceneDocumentSession} from '../scene-document-session.mjs';
import {createSceneLoadRequests} from '../scene-load-generation.mjs';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {planSceneRestore} from '../scene-persistence-core.js';
const document=()=>({version:8,objects:[{id:'mesh',type:'pbr',source:'demos/cube.glb',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]});
function fixture(){
 const applied=[],requests=createSceneLoadRequests();let plans=0;
 const plan=(...args)=>{plans++;return planSceneRestore(...args);};
 const session=createSceneDocumentSession({requests,records:createSceneRecordOperations(),planRestore:plan,
  readAddress:()=>({origin:'http://fixture.invalid'}),apply:async(data,plan)=>{applied.push({data,plan});},filename:'prior.kaminos.json'});
 return {session,requests,applied,plan,plans:()=>plans};
}

test('an existing parsed document is read once and still receives ordinary certification',async()=>{
 const f=fixture(),data=document(),before=structuredClone(data);let reads=0;
 const result=await f.session.restore({json:async()=>{reads++;return data;},text:()=>{throw Error('unnecessary text read');}},{sceneFile:'current.kaminos.json',mounted:true});
 assert.equal(result.ok,true);assert.equal(reads,1);assert.equal(f.plans(),1);
 assert.equal(f.applied[0].data,data);assert.deepEqual(data,before);
 assert.notEqual(f.applied[0].plan.objects[0],data.objects[0]);
 assert.equal(f.session.state().filename,'current.kaminos.json');assert.equal(f.session.state().blocked,false);
});

test('parsed input cannot bypass invalid-format or reloadability refusals and failures preserve prior admission',async()=>{
 for(const data of [{version:999},null,{...document(),objects:[{id:'mesh',type:'pbr',source:null}]}]){
  const f=fixture(),result=await f.session.restore({json:async()=>data});
  assert.equal(result.ok,false);assert.match(result.error,/Invalid scene format/);assert.equal(f.plans(),1);
  assert.equal(f.applied.length,0);assert.equal(f.session.state().filename,'prior.kaminos.json');assert.equal(f.session.state().blocked,false);
 }
 const f=fixture(),result=await f.session.restore({json:async()=>{throw Error('read failed');}});
 assert.equal(result.ok,false);assert.match(result.error,/read failed/);assert.equal(f.plans(),0);assert.equal(f.applied.length,0);
 assert.equal(f.session.state().filename,'prior.kaminos.json');assert.equal(f.session.state().blocked,false);
});

test('a superseded parsed read cannot certify, apply or bind its document',async()=>{
 const f=fixture();let resolve;const gate=new Promise(r=>resolve=r);
 const old=f.session.restore({json:()=>gate},{sceneFile:'old.kaminos.json'});
 const current=await f.session.restore({text:async()=>JSON.stringify(document())},{sceneFile:'new.kaminos.json'});
 resolve(document());assert.equal((await old).stale,true);assert.equal(current.ok,true);
 assert.equal(f.plans(),1);assert.equal(f.applied.length,1);assert.equal(f.session.state().filename,'new.kaminos.json');
});

test('the production startup-to-document adapter parses saved bytes once while keeping fresh planning',async()=>{
 const page=readFileSync(new URL('../index.html',import.meta.url),'utf8'),f=fixture(),text=JSON.stringify(document());
 const section=(start,end)=>{const a=page.indexOf(start),b=page.indexOf(end,a);assert.ok(a>=0&&b>a,start);return page.slice(a,b);};
 const admission=section('  const startupSceneData = startupSceneText.then(', 'let startupSceneAdmitted');
 const restore=section('  const startupSceneRestore = startupSceneAdmission.then(', '  startupSceneRestore.then(');
 const load=section('async function loadSceneFile(', 'async function applySceneDocument(');
 let parses=0;const json={parse(value){if(value===text)parses++;return JSON.parse(value);}};
 const c=vm.createContext({JSON:json,window:{},location:{search:''},startupSceneText:Promise.resolve(text),startupSceneFile:'saved.kaminos.json',
  startupSceneHash:new URLSearchParams('scene=saved.kaminos.json'),startupSceneRedirect:Symbol('redirect'),sceneDocument:f.session,planSceneRestore:f.plan,
  environmentLoaded:Promise.resolve(),volumeLoaded:Promise.resolve(),authoringBusy:false,vantageCaptureHeld:false,scenePlacementTools:null,sceneWorkerRequested:false,
  environmentLoader:{holdFull:()=>()=>{}},requestAnimationFrame:callback=>callback(),setTimeout:callback=>callback(),setInfo(){},URLSearchParams});
 // Count the document owner's parser too, using an invocation-local wrapper.
 const parse=JSON.parse;JSON.parse=(value,...args)=>{if(value===text)parses++;return parse(value,...args);};
 json.parse=value=>JSON.parse(value);
 try {await vm.runInContext(load+'\n'+admission+'\n'+restore+'\nstartupSceneRestore;',c);}
 finally {JSON.parse=parse;}
 assert.equal(parses,1,'the actual startup call must reuse the already parsed document');
 assert.equal(f.plans(),2,'startup routing and current document admission still derive their own plans');
 assert.equal(f.applied.length,1);assert.equal(f.session.state().filename,'saved.kaminos.json');assert.equal(f.session.state().blocked,false);
});
