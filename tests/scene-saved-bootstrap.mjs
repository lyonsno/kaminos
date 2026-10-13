// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';import{compositionRestoreUrl}from'../scene-authoring.mjs';
import {readOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
const startupSceneRedirect=Symbol('saved-scene-recovery-redirect');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');const start=html.indexOf('    if (plan.composition) {',html.indexOf('const sceneInitialization ='));const end=html.indexOf('    await loadSceneFile(',start);assert.ok(start>=0&&end>start);const code=html.slice(start,end);
const comp={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+ 'a'.repeat(64),label:'Saved tuning',stationary:true},route:{volume_light_field:'1',volume_light_field_scene_depth:'1'},lightGainStops:0};
test('saved composition redirects a stale mounted basin to the saved recipe',()=>{let redirected=null;const c=vm.createContext({plan:{composition:comp},sceneFile:'tuned.kaminos.json',compositionRestoreUrl,readOwnerExperimentAddress,startupSceneRedirect,hash:new URLSearchParams(),URLSearchParams,setInfo(){},location:{origin:'http://localhost:50825',search:'?settings_preset=vsp-'+ 'b'.repeat(64),replace:url=>redirected=url}});assert.doesNotThrow(()=>vm.runInContext('(function(){'+code+'})()',c),'a stale address must not refuse an intact saved scene');assert.equal(redirected,compositionRestoreUrl(comp,'tuned.kaminos.json','http://localhost:50825'));});
test('matching or ordinary documents do not redirect',()=>{for(const composition of [comp,null]){let count=0;vm.runInNewContext('(function(){'+code+'})()',{plan:{composition},sceneFile:'tuned.kaminos.json',compositionRestoreUrl,readOwnerExperimentAddress,startupSceneRedirect,hash:new URLSearchParams(),URLSearchParams,setInfo(){},location:{origin:'http://localhost:50825',search:'?settings_preset='+comp.flame.presetId,replace:()=>count++}});assert.equal(count,0);}});

test('saved document address preserves renderer and unknown view parameters',async()=>{
 const {savedSceneLocation}=await import('../scene-authoring.mjs');const before=new URL('http://localhost:50825/index.html?renderer=custom&mesh_root=assets#workspace=workbench&extra=kept&scene=old.kaminos.json'),after=new URL(savedSceneLocation(before.href,'new.kaminos.json'));
 assert.equal(after.origin,before.origin);assert.equal(after.pathname,before.pathname);assert.equal(after.search,before.search);const hash=new URLSearchParams(after.hash.slice(1));assert.equal(hash.get('scene'),'new.kaminos.json');assert.equal(hash.get('workspace'),'workbench');assert.equal(hash.get('extra'),'kept');assert.equal(hash.has('authoring'),false,'Save does not change workspace selection');
 for(const filename of ['../escape.kaminos.json','wrong.json',null])assert.throws(()=>savedSceneLocation(before.href,filename),/Saved scene filename/);
});

test('successful current in-place Load adopts the document address; superseded load cannot',async()=>{
 const {savedSceneLocation}=await import('../scene-authoring.mjs');
 const begin=html.indexOf('function claimLoadedSceneFile('),end=html.indexOf('async function loadSceneFile(',begin),claim=html.slice(begin,end);
 const call=html.indexOf('  claimLoadedSceneFile(file, sceneFile);',end);
 const gate=html.lastIndexOf('  if (!sceneLoadRequests.isCurrent(loadRequestId)) return;',call);
 assert.ok(gate> end&&call>gate);
 for(const current of [true,false]){
  const c=vm.createContext({currentSceneFile:'A.kaminos.json',file:{name:'B.kaminos.json'},sceneFile:'B.kaminos.json',loadRequestId:2,
   sceneLoadRequests:{isCurrent:()=>current},savedSceneLocation,URL,URLSearchParams,
   location:{href:'http://localhost/index.html?workspace=workbench#scene=A.kaminos.json&extra=kept'},
   history:{replaceState(_state,_title,url){c.location.href=url;}}});
  vm.runInContext(claim,c);vm.runInContext('(function(){'+html.slice(gate,call+'  claimLoadedSceneFile(file, sceneFile);'.length)+'})()',c);
  assert.equal(c.currentSceneFile,current?'B.kaminos.json':'A.kaminos.json');
  assert.equal(new URLSearchParams(new URL(c.location.href).hash.slice(1)).get('scene'),current?'B.kaminos.json':'A.kaminos.json');
 }
});

test('canonical stale-recipe recovery carries explicit Workbench through the actual preset forwarder',async()=>{
 const {forwardCompositionHash}=await import('../scene-authoring.mjs');
 let recovery;const search='?workspace=workbench&settings_preset=vsp-'+ 'b'.repeat(64);
 vm.runInNewContext('(function(){'+code+'})()',{plan:{composition:comp},sceneFile:'tuned.kaminos.json',compositionRestoreUrl,readOwnerExperimentAddress,startupSceneRedirect,hash:new URLSearchParams(),URLSearchParams,setInfo(){},location:{origin:'http://localhost',search,replace:url=>recovery=url}});
 assert.equal(new URL(recovery).searchParams.get('workspace'),null,'workspace must not enter the canonical recipe parameter channel');
 assert.equal(new URLSearchParams(new URL(recovery).hash.slice(1)).get('workspace'),'workbench');
 const wrapper=readFileSync(new URL('../volume-settings-preset.html',import.meta.url),'utf8');
 const match=wrapper.match(/location.replace\((forwardCompositionHash\(target, location.hash[^;]+)\);/);assert.ok(match);
 const destination=new URL(recovery);
 const forwarded=vm.runInNewContext(match[1],{forwardCompositionHash,target:'http://localhost/index.html?settings_preset='+comp.flame.presetId,location:{hash:destination.hash,search:destination.search}});
 assert.equal(new URL(forwarded).searchParams.get('workspace'),null);
 assert.equal(new URLSearchParams(new URL(forwarded).hash.slice(1)).get('workspace'),'workbench');
 assert.equal(new URLSearchParams(new URL(forwarded).hash.slice(1)).get('scene'),'tuned.kaminos.json');
});

test('hash-carried workspace survives another changed-recipe recovery',()=>{
 let recovery;
 vm.runInNewContext('(function(){'+code+'})()',{plan:{composition:comp},sceneFile:'tuned.kaminos.json',compositionRestoreUrl,readOwnerExperimentAddress,startupSceneRedirect,hash:new URLSearchParams('workspace=workbench'),URLSearchParams,setInfo(){},location:{origin:'http://localhost',search:'?settings_preset=vsp-'+ 'b'.repeat(64),replace:url=>recovery=url}});
 assert.equal(new URLSearchParams(new URL(recovery).hash.slice(1)).get('workspace'),'workbench');
 assert.equal(new URL(recovery).searchParams.get('workspace'),null);
});

test('valid disk files cannot claim same-named or absent server documents',()=>{
 const begin=html.indexOf('function claimLoadedSceneFile('),end=html.indexOf('async function loadSceneFile(',begin),claim=html.slice(begin,end);
 for(const name of ['stored-B.kaminos.json','absent-file.kaminos.json']){
  const c=vm.createContext({currentSceneFile:'stored-A.kaminos.json',file:{name},savedSceneLocation:(href,name)=>{const url=new URL(href);const hash=new URLSearchParams(url.hash.slice(1));hash.set('scene',name);url.hash=hash.toString();return url.href;},URL,URLSearchParams,
   location:{href:'http://localhost/index.html?workspace=workbench#scene=stored-A.kaminos.json&extra=kept'},
   history:{replaceState(_state,_title,url){c.location.href=String(url);}}});
  vm.runInContext(claim,c);vm.runInContext('claimLoadedSceneFile(file)',c);
  assert.equal(c.currentSceneFile,null,'an imported file has no stored overwrite target');
  const url=new URL(c.location.href);assert.equal(new URLSearchParams(url.hash.slice(1)).has('scene'),false,'disk bytes must not publish a server document address');
  assert.equal(url.searchParams.get('workspace'),'workbench');assert.equal(new URLSearchParams(url.hash.slice(1)).get('extra'),'kept');
 }
});
