// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneWorkerAssets} from '../scene-worker-assets.mjs';
import {createSceneWorkerAssetsController} from '../scene-worker-assets-page.mjs';
const asset={kind:'mesh',name:'burner.glb',label:'Burner',source:'/api/read?root=generated-meshes&path=burner.glb',root_id:'generated-meshes',sha256:'a'.repeat(64),generation:{runId:'actual-run',route:'trellis-test'},provenance:{input:{source:'/original.png'}},customFutureHint:true};
const context={signal:new AbortController().signal,assertCurrent(){}};
function fixture(importAsset,uploadMesh){
 const worker=createSceneWorkerAssets({uploadMesh}),requests=[];
 const controller=createSceneWorkerAssetsController({importAsset,page:{request(name,payload){requests.push({name,payload});return {completion:Promise.resolve().then(()=>worker.commands[name](payload,context)).then(output=>({output}))};}}});
 return {controller,worker,requests};
}
test('retained mesh Add consumes the scene-owned import and retains full provenance',async()=>{
 let received,finish;const f=fixture(input=>{received=input;return new Promise(resolve=>finish=resolve);});await f.controller.select(asset);
 const adding=f.controller.add();assert.equal(f.controller.read().adding,true);finish({objectId:'inserted',ui:{selection:{ids:['inserted']}},mutationApplied:true});
 const value=await adding;assert.equal(value.objectId,'inserted');assert.equal(received.source,asset.source);assert.equal(received.fileName,asset.name);assert.equal(received.label,asset.label);assert.deepEqual(received.generation,asset.generation);assert.deepEqual(received.assetOrigin.provenance,asset.provenance);assert.equal(received.assetOrigin.sha256,asset.sha256);assert.equal(received.assetOrigin.root_id,asset.root_id);assert.equal(f.controller.read().adding,false);
 assert.equal(f.controller.read().selected.source,asset.source);
});
test('failed Add retains the stored result and permits retry without regeneration',async()=>{
 let fail=true,calls=0;const f=fixture(async()=>{calls++;if(fail)throw Error('import refused');return {objectId:'retry',mutationApplied:true};});await f.controller.select(asset);
 await assert.rejects(f.controller.add(),/import refused/);assert.equal(f.controller.read().selected.source,asset.source);assert.equal(f.controller.read().adding,false);
 fail=false;await f.controller.add();assert.equal(calls,2);assert.equal(f.controller.read().error,null);
});
test('applied insertion followed by presentation failure is not automatically retried',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw Object.assign(Error('draw failed after commit'),{mutationApplied:true});});await f.controller.select(asset);
 await assert.rejects(f.controller.add(),error=>error.mutationApplied===true);assert.equal(calls,1);assert.equal(f.controller.read().insertion.status,'applied');assert.equal(f.controller.read().selected.source,asset.source);
});
test('uploaded GLB is stored before entering the same scene import path',async()=>{
 const sequence=[];const f=fixture(async input=>{sequence.push('import');assert.equal(input.source,asset.source);return {objectId:'uploaded',mutationApplied:true};},async file=>{sequence.push('store');assert.equal(file.name,'local.glb');return {...asset,name:file.name};});
 await f.controller.upload(new File(['glb-bytes'],'local.glb',{type:'model/gltf-binary'}));assert.deepEqual(sequence,['store','import']);assert.equal(f.controller.read().selected.source,asset.source);
});
test('failed uploaded mesh import leaves a retained source, not a transient File',async()=>{
 const f=fixture(async()=>{throw Error('scene busy');},async()=>asset);
 await assert.rejects(f.controller.upload(new File(['glb'],'local.glb')),/scene busy/);
 const selected=f.controller.read().selected;assert.equal(selected.source,asset.source);assert.equal(selected.file,undefined);
});
test('a missing import receipt leaves insertion authority unknown instead of claiming an added object',async()=>{
 const f=fixture(async()=>({}));await f.controller.select(asset);
 await assert.rejects(f.controller.add(),/confirm.*insertion/i);assert.equal(f.controller.read().insertion.status,'unknown');assert.equal(f.controller.read().selected.source,asset.source);
});
