// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {createWorkingScene} from '../working-scene.mjs';
import {instantiateAssembly} from '../scene-assembly.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),source=JSON.parse(readFileSync(new URL('../assets/assemblies/piston-arm.json',import.meta.url)));
const start=html.indexOf('async function addSceneAssembly('),addCode=html.slice(start,html.indexOf('\nfunction selectedAssemblySource',start));
const fileStart=html.indexOf("document.getElementById('assembly-file').onchange="),fileCode=html.slice(fileStart,html.indexOf('\ndocument.getElementById(\'assembly-export\')',fileStart));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(fetch){
 const workingScene=createWorkingScene();let actuators=[],serial=0;const history=[],fileInput={},messages=[];
 const read=()=>({objects:workingScene.objects.map(o=>({id:o.id})),groups:structuredClone(workingScene.groups),actuators:structuredClone(actuators),selection:structuredClone(workingScene.selection),history:structuredClone(history)});
 const context=vm.createContext({workingScene,fetch,assemblyCatalog:[{id:'piston',url:'/arm.json'}],instantiateAssembly,assertSceneConstructionAvailable(){},makeSceneObjectId:kind=>kind+(++serial),controls:{target:{toArray:()=>[0,0,0]}},sceneActuators:{pause(){},restore(rows){actuators=structuredClone(rows);}},readSelectionMembership:read,checkSelectionMembership:x=>x,
  scenePlacementTools:{edits:{assertCanRecordApplied(){},discard(){},recordApplied(id,before,after,label){history.push(label);}},start(){return true;}},compoundRetentionTargets:new Map(),mountProceduralMesh:row=>workingScene.put({...row,object:{}}),ensureGroupTarget(){},setSceneSelection:(ids,activeId)=>workingScene.select(ids,activeId),setInfo:msg=>messages.push(msg),document:{getElementById:()=>fileInput}});
 vm.runInContext(addCode+'\n'+fileCode,context);
 const replace=()=>{workingScene.invalidateArrivals();workingScene.clearMembership();workingScene.put({id:'B-cube',object:{}});workingScene.select(['B-cube']);actuators=[{id:'B-piston'}];history.splice(0,history.length,'B-edit');};
 return {context,read,replace,fileInput,messages};
}
for(const phase of ['fetch','json'])test(`assembly ${phase} arrival refuses after scene replacement without touching B`,async()=>{
 const wait=deferred(),response={ok:true,json:()=>phase==='json'?wait.promise:source},f=fixture(()=>phase==='fetch'?wait.promise:Promise.resolve(response));
 const pending=f.context.addSceneAssembly('piston');await Promise.resolve();f.replace();const before=f.read();wait.resolve(phase==='fetch'?response:source);
 await assert.rejects(pending,/Scene changed/);assert.deepEqual(f.read(),before);
});
test('the actual saved-file handler captures the scene before reading text',async()=>{
 const wait=deferred(),f=fixture(()=>assert.fail('saved file should not fetch'));const pending=f.fileInput.onchange({target:{files:[{text:()=>wait.promise}],value:'arm.json'}});
 f.replace();const before=f.read();wait.resolve(JSON.stringify(source));await pending;assert.deepEqual(f.read(),before);assert.match(f.messages.at(-1),/Scene changed/);
});
