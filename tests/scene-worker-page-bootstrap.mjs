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
function fixture({retireFailure=false,sceneInput={data:{camera:{position:[1,2,3],target:[0,1,0]}}},preferences={schema:'kaminos.preferences.v1',navigationInput:'mouse'},href='http://localhost/?scene_worker=1'}={}){
 const elements=new Map(),listeners=new Map();
 const element=()=>({style:{},dataset:{},classList:{toggle(){}},addEventListener(){},removeEventListener(){},blur(){},remove(){elements.delete(this.id);}});
 const viewport={clientWidth:80,clientHeight:40,appendChild(node){elements.set(node.id,node);}};
 elements.set('viewport',viewport);elements.set('navigation-input-mode',element());elements.set('navigation-hint',element());
 const document={getElementById:id=>elements.get(id),createElement:element};
 const window={devicePixelRatio:2,location:{href,search:new URL(href).search,hash:new URL(href).hash},navigator:{platform:'MacIntel'},localStorage:{getItem(){return null;},setItem(){}},
  addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
 let input,disposed=0,navDisposed=0,config;
 const instance=module.mountSceneWorkerPage({document,window,THREE,admission:sceneInput,preferences,readFlameControls:()=>({resolution:16}),
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
test('same-epoch partial surface status preserves actual bounds until invalidation clears them visibly',async()=>{
 const f=fixture();f.config.applyUi({bounds:{min:[0,0,0],max:[1,1,1]}});
 f.config.applyUi({surfaces:{volume:{active:true,transparent:true}}});assert.equal(f.input.frameAll(),true);
 f.config.onPhase?.('held');assert.equal(f.input.frameAll(),false,'old-epoch navigation bounds must be cleared');
 assert.equal(f.instance.canvases.scene.dataset.sceneWorkerState,'held');await f.instance.retire();
});

const defaultView={position:[4,3,8],target:[1,2,0],up:[0,1,0],fov:51,near:.04,far:240};
const agentView={position:[-2,5,7],target:[0,1,0],up:[0,1,0],fov:47,near:.03,far:160};
const savedView={position:[8,2,9],target:[3,0,1],up:[0,1,0],fov:39,near:.02,far:180};
const storedViews=()=>({schema:'kaminos.preferences.v1',navigationInput:'mouse',startupConfigured:true,sceneDefaults:{camera:defaultView},agentSceneDefaults:{camera:agentView}});
function assertView(f,view){
 const initial=f.config.initializePayload.camera;f.config.beforeFrame();const frame=f.config.readCamera();
 for(const value of [initial,frame])for(const key of ['position','target','up','fov','near','far'])assert.deepEqual(value[key],view[key],`startup and first frame ${key}`);
 assert.equal(f.config.initializePayload.ui,undefined,'selection is not an applied marker');
}
test('worker transport selection preserves saved scene-default camera through the first frame',async()=>{
 const f=fixture({sceneInput:{data:null,plan:null},preferences:storedViews()});assertView(f,defaultView);await f.instance.retire();
});
test('worker agent-default camera reaches the first frame without being overwritten',async()=>{
 const f=fixture({sceneInput:{data:null},preferences:storedViews(),href:'http://localhost/?scene_worker=1&defaults=agent&workspace=workbench&experiment=material-study'});assertView(f,agentView);await f.instance.retire();
});
test('opened-scene camera keeps precedence over saved default profiles',async()=>{
 const f=fixture({sceneInput:{data:{camera:savedView}},preferences:storedViews()});assertView(f,savedView);await f.instance.retire();
});
test('actual asset route still suppresses preference camera defaults',async()=>{
 const f=fixture({sceneInput:{data:null},preferences:storedViews(),href:'http://localhost/?scene_worker=1&mesh_source=sha256:asset'});
 assert.deepEqual(f.config.initializePayload.camera.position,[0,.6,3]);f.config.beforeFrame();assert.deepEqual(f.config.readCamera().target,[0,0,0]);await f.instance.retire();
});
