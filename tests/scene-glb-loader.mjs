// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
const module=await import('../scene-glb-loader.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const factory=options=>{assert.equal(typeof module.createSceneGlbLoader,'function','ordinary GLB construction/publication must be usable inside the scene worker');return module.createSceneGlbLoader(options);};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(){
 const scene=new THREE.Scene(),root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({color:0x876543}));root.add(mesh);
 const clips=[new THREE.AnimationClip('authored',1,[])],calls=[],lighting=deferred();let generation=1;
 const services={workingScene:{get generation(){return generation;}},readScene:()=>scene,origin:()=> 'http://localhost',
  sourceChanged:value=>calls.push(['source',value]),loadingTelemetry:{start:()=>({token:1}),progress(){},complete(){calls.push('complete');},cancel(){calls.push('cancel');},fail(){calls.push('fail');}},
  readAssetBytes:async()=>{calls.push('read');return new ArrayBuffer(12);},sceneLightingPreparation:{whenIdle:()=>lighting.promise},shouldClearSceneForImport:()=>false,
  resolveAssetArrivalMode:()=>null,GLTFLoader:class{async parseAsync(bytes,path){calls.push(['parse',bytes.byteLength,path]);return {scene:root,animations:clips};}},
  greenroomPreviewIsActive:()=>false,readPreviewGeneration:()=>0,readEnvironmentIntensity:()=>.7,readMaxAnisotropy:()=>8,
  readArrivalLighting:()=>({materialTuningEnabled:false,materialProfile:null}),
  prepareArrivedMeshMaterials:(model,options)=>calls.push(['materials',model,options]),applyAssetArrival:()=>null,
  registerSceneObject:(model,metadata)=>{calls.push(['admit',metadata]);return {id:'retained'};},
  disposeObjectTree:model=>{calls.push('dispose');model.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});},
  onActivate:()=>calls.push('activate'),setInfo:()=>{},
 };
 return {services,calls,scene,root,clips,lighting,change:()=>generation++};
}
test('ordinary worker-local GLB loader overlaps byte read, preserves authored root/clips/material flow and admits once',async()=>{
 const f=fixture(),load=factory(f.services);const task=load('/api/mesh.glb',{clear:false,returnAsset:true,metadata:{label:'Kiln'}});
 assert.ok(f.calls.includes('read'));assert.equal(f.calls.some(row=>row[0]==='parse'),false);f.lighting.resolve();const asset=await task;
 assert.equal(asset.root,f.root);assert.equal(asset.clips,f.clips);assert.equal(asset.id,'retained');assert.equal(f.scene.children[0],f.root);
 assert.deepEqual(f.calls.find(row=>row[0]==='parse'),['parse',12,'/api/']);assert.equal(f.calls.filter(row=>row[0]==='admit').length,1);
 assert.equal(f.calls.filter(row=>row[0]==='materials').length,2);assert.equal(f.root.children[0].castShadow,true);assert.equal(f.root.children[0].receiveShadow,true);
 assert.equal(f.calls.filter(row=>row==='complete').length,1);
});
test('stale asynchronous geometry never enters current membership and releases the loaded root',async()=>{
 const f=fixture(),geometry=deferred(),entered=deferred();f.services.prepareGLBGeometryArrival=async()=>{entered.resolve();await geometry.promise;return {};};
 const task=factory(f.services)('/mesh.glb',{clear:false});f.lighting.resolve();await entered.promise;f.change();geometry.resolve();
 await assert.rejects(task,/stale/);assert.equal(f.scene.children.length,0);assert.ok(f.calls.includes('dispose'));assert.equal(f.calls.some(row=>row[0]==='admit'),false);
});
test('prepared source keeps its exact independently owned root and avoids a duplicate fetch/parse',async()=>{
 const f=fixture(),task=factory(f.services)('/mesh.glb',{preparedAsset:{scene:f.root,animations:f.clips},activate:false,returnAsset:true});f.lighting.resolve();
 assert.equal((await task).root,f.root);assert.equal(f.calls.includes('read'),false);assert.equal(f.calls.some(row=>row[0]==='parse'),false);assert.equal(f.calls.includes('activate'),false);
});
test('detached GLB preparation does not publish membership or complete until its single synchronous commit',async()=>{
 const f=fixture(),load=factory(f.services);
 assert.equal(typeof load.prepare,'function','GLB preparation must expose a detached publication handle');
 const task=load.prepare('/mesh.glb',{clear:false,returnAsset:true,metadata:{id:'held',label:'Held mesh'}});
 f.lighting.resolve();const prepared=await task;
 assert.equal(prepared.root,f.root);assert.equal(f.root.parent,null);
 assert.equal(f.calls.some(row=>row[0]==='admit'),false);assert.equal(f.calls.includes('activate'),false);assert.equal(f.calls.includes('complete'),false);
 const result=prepared.commit();assert.equal(result.id,'retained');assert.equal(result.root,f.root);
 assert.equal(f.root.parent,f.scene);assert.equal(f.calls.filter(row=>row[0]==='admit').length,1);
 assert.throws(()=>prepared.commit(),/already|committed|settled/i);
 prepared.dispose();assert.equal(f.calls.includes('dispose'),false,'committed root belongs to scene lifetime');
});
test('abandoned or stale prepared GLB releases only its detached root and cannot publish',async()=>{
 for(const stale of [false,true]){
  const f=fixture(),load=factory(f.services);assert.equal(typeof load.prepare,'function');
  const task=load.prepare('/mesh.glb',{clear:false});f.lighting.resolve();const prepared=await task;
  if(stale){f.change();assert.throws(()=>prepared.commit(),/stale/i);}else prepared.dispose();
  prepared.dispose();assert.equal(f.calls.filter(row=>row==='dispose').length,1);
  assert.equal(f.scene.children.length,0);assert.equal(f.calls.some(row=>row[0]==='admit'),false);
  assert.throws(()=>prepared.commit(),/stale|disposed|settled/i);
 }
});
