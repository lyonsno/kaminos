// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../scene-worker-page-bootstrap.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
test('a worker initialize acknowledgement cannot impersonate applied saved scene or preferences',()=>{
 assert.equal(typeof module.assertSceneWorkerStartup,'function');
 const admission={data:{objects:[{id:'authored'}]},plan:{}};
 assert.throws(()=>module.assertSceneWorkerStartup({}, {admission,preferences:{studioLook:'default'}}),/saved scene/);
 assert.throws(()=>module.assertSceneWorkerStartup({output:{ui:{initialization:{sceneApplied:true}}}}, {admission,preferences:{studioLook:'default'}}),/preferences/);
 assert.doesNotThrow(()=>module.assertSceneWorkerStartup({output:{ui:{initialization:{sceneApplied:true,preferencesApplied:true}}}}, {admission,preferences:{}}));
 assert.doesNotThrow(()=>module.assertSceneWorkerStartup({output:{}},{admission:{data:null},preferences:null}));
 assert.doesNotThrow(()=>module.assertSceneWorkerStartup({output:{initialized:true}},{admission,preferences:{},ui:{initialization:{sceneApplied:true,preferencesApplied:true}}}));
});
import * as THREE from '../lib/three.core.js';
function fixture({retireFailure=false}={}){
 const elements=new Map(),listeners=new Map();
 const element=()=>({style:{},dataset:{},classList:{toggle(){}},addEventListener(){},removeEventListener(){},blur(){},remove(){elements.delete(this.id);}});
 const viewport={clientWidth:80,clientHeight:40,appendChild(node){elements.set(node.id,node);}};
 elements.set('viewport',viewport);elements.set('navigation-input-mode',element());elements.set('navigation-hint',element());
 const document={getElementById:id=>elements.get(id),createElement:element};
 const window={devicePixelRatio:2,location:{href:'http://localhost/?scene_worker=1',search:'?scene_worker=1',hash:''},navigator:{platform:'MacIntel'},localStorage:{getItem(){return null;},setItem(){}},
  addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
 let input,disposed=0,navDisposed=0,config;
 const instance=module.mountSceneWorkerPage({document,window,THREE,admission:{data:{camera:{position:[1,2,3],target:[0,1,0]}}},preferences:{navigationInput:'mouse'},readFlameControls:()=>({resolution:16}),
  createControls:camera=>({target:new THREE.Vector3(),update(){camera.lookAt(this.target);},dispose(){disposed++;}}),
  installNavigation:value=>{input=value;return {state:()=>({inputMode:value.inputMode()}),dispose(){navDisposed++;}};},frameBox:()=>true,
  createPage:value=>{config=value;return {start:()=>Promise.resolve({output:{initialized:true}}),read:()=>({phase:'active'}),holdFrames(){},
   retire:async()=>{if(retireFailure){retireFailure=false;throw Error('GPU still held');}return {output:{retired:true}};}};}});
 return {instance,elements,listeners,input,config,disposed:()=>({controls:disposed,navigation:navDisposed})};
}
test('actual mount captures saved camera and clock inputs without creating a page renderer or scene copy',async()=>{
 const f=fixture();assert.equal(f.elements.size,5);assert.equal(f.config.entryUrl,'/scene-worker.entry.bundle.mjs');
 assert.deepEqual(f.config.initializePayload.camera.position,[1,2,3]);assert.deepEqual(f.config.initializePayload.camera.target,[0,1,0]);
 assert.equal(f.input.inputMode(),'mouse');assert.deepEqual(f.input.roots(),[]);
 f.config.beforeFrame();assert.equal(f.config.readCamera().aspect,2);
 assert.throws(()=>f.config.validateInitialization({output:{initialized:true}},null),/saved scene/);
 f.config.validateInitialization({output:{initialized:true}},{initialization:{sceneApplied:true,preferencesApplied:true}});
 f.config.applyUi({surfaces:{volume:{active:true,transparent:true}},bounds:{min:[0,0,0],max:[1,1,1]}});
 assert.equal(f.input.frameAll(),true);assert.equal(f.instance.canvases.volume.hidden,false);
 await f.instance.retire();assert.equal(f.elements.size,3);assert.deepEqual(f.disposed(),{controls:1,navigation:1});assert.equal(f.listeners.has('pagehide'),false);
});
test('failed actual retirement preserves mounted surfaces and input owner until the same resource cleanup succeeds',async()=>{
 const f=fixture({retireFailure:true});await assert.rejects(f.instance.retire(),/GPU still held/);
 assert.equal(f.elements.size,5);assert.deepEqual(f.disposed(),{controls:0,navigation:0});
 await f.instance.retire();assert.equal(f.elements.size,3);assert.deepEqual(f.disposed(),{controls:1,navigation:1});
});
