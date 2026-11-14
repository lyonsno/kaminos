// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneWorkerAssetsController} from '../scene-worker-assets-page.mjs';

function fixture(){
 const selected={kind:'image',name:'source.png',source:'/api/read?root=image-inbox&path=source.png'};
 let state={roots:[],root:'image-inbox',path:'',entries:[],selected,preparation:null,loading:false,adding:false,error:null,results:[]},revision=0;
 const runs=[],adds=[];let finish;
 const mesh={preparesInput:true,read:()=>({status:'idle',pending:null,canStop:false}),run:input=>{runs.push(input);return new Promise(resolve=>{finish=resolve;});},retryPersistence:async()=>({kind:'mesh',name:'recovered.glb',source:'/api/read?root=generated-meshes&path=recovered.glb'}),stop:()=>true};
 const page={request(operation,input){if(operation==='assets.select')state={...state,selected:input.entry};return {completion:Promise.resolve({output:{revision:++revision,state:structuredClone(state)}})};}};
 const controller=createSceneWorkerAssetsController({page,mesh,importAsset:async input=>{adds.push(input);return {objectId:'added-mesh',mutationApplied:true};}});
 return {controller,mesh,selected,runs,adds,finish:value=>finish(value)};
}
test('worker drawer generates from the actual selected source and retains an explicitly addable result',async()=>{
 const f=fixture();await f.controller.select(f.selected);
 assert.equal(typeof f.controller.generate,'function','the actual shared drawer needs its worker mesh-generation operation');
 const pending=f.controller.generate();assert.equal(f.runs[0].source,f.selected.source);
 const result={name:'new.glb',source:'/api/read?root=generated-meshes&path=new.glb',generation:{runId:'actual-run'}};f.finish(result);assert.deepEqual(await pending,result);
 assert.equal(f.adds.length,0,'saving generation does not implicitly insert it into the scene');
 assert.equal(f.controller.read().results[0].generation.runId,'actual-run');
 await f.controller.add(f.controller.read().results[0]);assert.equal(f.adds[0].source,result.source);assert.equal(f.adds[0].generation.runId,'actual-run');
 await f.controller.select({...f.selected,name:'other.png',source:'/api/read?root=image-inbox&path=other.png'});
 assert.equal(f.controller.read().results[0].source,result.source,'catalog replies cannot erase saved generation results');
});
test('worker drawer retries storage without model replay and does not relabel a retained surfel as a mesh',async()=>{
 const f=fixture();assert.equal(typeof f.controller.recover,'function','storage recovery belongs to the existing Generate workflow');
 const retained={kind:'surface',name:'recovered.surface.json',source:'/api/read?root=generated-meshes&path=recovered.surface.json'};
 f.mesh.retryPersistence=async()=>retained;assert.deepEqual(await f.controller.recover(),retained);assert.equal(f.runs.length,0);assert.equal(f.controller.read().results[0].kind,'surface');
 assert.equal(f.controller.stop(),true);assert.equal(f.controller.preparesInput(),true);
});
test('a successful retry clears the previous workflow error while retaining the original input',async()=>{
 const f=fixture();await f.controller.select(f.selected);f.mesh.run=async()=>{throw Error('temporary storage failure');};
 await assert.rejects(f.controller.generate(),/temporary storage failure/);assert.equal(f.controller.read().error,'temporary storage failure');
 f.mesh.run=async()=>({name:'retry.glb',source:'/api/read?root=generated-meshes&path=retry.glb'});await f.controller.generate();
 assert.equal(f.controller.read().error,null,'an older failed attempt must not remain the current successful outcome');assert.equal(f.controller.read().selected.source,f.selected.source);
});
