// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {planArrivalStudioLights,resolveStudioLook,inspectArrivalMaterialProfile,resolveEarlyLowLodMeshSha} from '../asset-arrival.mjs';
import {createCoarseRepetition} from '../scene-lod-startup.mjs';
import {sceneItemVisible,withViewportVisibility} from '../scene-visibility.mjs';
import {prepareSceneAssetBatch} from '../scene-asset-preparation.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,start);return html.slice(a,b);};

test('ordinary bounds refresh preserves saved studio lights and rig; explicit look application replaces them',async()=>{
 const records=['@studio-key-light','@studio-rim-light'].map((id,i)=>({id,type:'light',transform:{position:[9+i,4,2],rotation:[.1,.2,.3],scale:[1,1,1]},light:{kind:'spot',enabled:true,color:'#123456',intensity:123+i,angle:27,penumbra:.4,aimDistance:7}}));
 const rig={id:'@studio-light-rig',objectIds:records.map(r=>r.id),transform:{position:[8,3,2],rotation:[.2,.1,0],scale:[1,1,1]}};
 const c={THREE,planArrivalStudioLights,resolveStudioLook,inspectArrivalMaterialProfile,groundPlane:null,renderer:null,scene:new THREE.Scene(),sceneSpotLights:new Map(records.map(r=>[r.id,{}])),workingScene:{objects:structuredClone(records),groups:[structuredClone(rig)],updateGroup(id,patch){Object.assign(this.groups.find(g=>g.id===id),patch);}},arrivalLightingState:{bounds:null,lookId:'sculptural-studio',materialProfile:inspectArrivalMaterialProfile([]),materialTuningEnabled:false,studioLightsEnabled:false,rigTransformEdited:false},syncingArrivalStudioLighting:false,document:{getElementById:()=>null},window:{},serializeSceneObject:r=>structuredClone(r),mountSceneSpotLight(r){Object.assign(c.workingScene.objects.find(x=>x.id===r.id),r);},extractObjectMaterialSamples:()=>[],scenePlacementTools:null,sceneLightingPreparation:null,sceneGIManuallyConfigured:true,sceneGIBounceManuallyConfigured:true,autoCalibrateSceneGIFromScene(){},renderSceneObjectList(){},updateTransformInspector(){},setInfo(){}};
 vm.createContext(c);vm.runInContext(section('function syncArrivalStudioLighting(', 'function autoCalibrateSceneGIFromScene(')+section('function refreshArrivalLightingFromWorkingScene(', 'function promoteArrivalStudioLightsToScene(')+section('async function applyStudioLookToCurrentScene(', 'function readSceneGIControls('),c);
 c.refreshArrivalLightingFromWorkingScene();
 assert.deepEqual(c.workingScene.objects,records,'refresh must preserve reserializable enabled/color/intensity/pose');
 assert.deepEqual(c.workingScene.groups,[rig],'saved rig pivot must survive bounds refresh');
 await c.applyStudioLookToCurrentScene('technical-daylight',{promoteRig:false,recordHistory:false});
 const plan=c.arrivalLightingState.plan;
 assert.deepEqual(structuredClone(c.workingScene.objects.map(r=>r.light)),structuredClone(plan.lights.map(r=>({...r.light,enabled:true}))),'an explicit look selection must still update authored rig lights');
});

test('coarse and replacement roots obey saved object/group visibility',async()=>{
 const sha='a'.repeat(64),records=['hidden','grouped','visible'].map(id=>({id,type:'glb',source:`/api/read?root=generated-meshes&path=${sha}.glb`}));
 const groups=[{id:'shelf',objectIds:['grouped']}],c={THREE,createCoarseRepetition,resolveEarlyLowLodMeshSha,scene:new THREE.Scene(),workingScene:{objects:[],groups:[]},sceneSpotLights:new Map(),activeSceneComposition:null,waterFeature:{setup:null},viewportDisplay:{hiddenIds:['hidden','@group:shelf']},itemVisible:sceneItemVisible,GLTFLoader:class{},loadPreparedLod:async()=>new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial())),fetch:async()=>({ok:true,json:async()=>({choice:{sha256:sha},levels:[]})}),sceneLoadRequests:{isCurrent:()=>true},sceneEnvironment:{read:()=>({intensity:1})},disposeObjectTree(){},window:{}};
 vm.createContext(c);vm.runInContext(section('let sceneLoadingStandInGroup = null;', 'async function showGLB(')+section('function viewportVisibilityObjects(', 'function isSceneItemEditable('),c);
 await c.stageSceneLowLodStandIns(records,1,groups);
 assert.equal(c.window.kaminosLoadingStandIns.state().mountedCount,3,'all synthetic proxies must mount before testing visibility');
 const draw=()=>withViewportVisibility(c.viewportVisibilityObjects(),c.isSceneItemVisible,()=>Object.fromEntries(c.viewportVisibilityObjects().map(r=>[r.id,r.object.visible])));
 assert.deepEqual(draw(),{hidden:false,grouped:false,visible:true});
 for(const record of records){c.workingScene.objects.push({...record,object:new THREE.Group()});c.removeSceneLowLodStandIn(record.id);assert.equal(draw()[record.id],record.id==='visible','replacement keeps the same visibility before group restoration');}
 c.workingScene.groups=groups;c.clearSceneLowLodStandIns(1);
 assert.deepEqual(draw(),{hidden:false,grouped:false,visible:true});
});

test('static coarse arrival never regresses to neutral gray; domain waits retain their fallback',async()=>{
 for(const [coarsePresented,domain,expected]of [[true,null,[]],[false,null,['gray']],[true,'water',['gray','water']],[true,'ash',['gray','ash']],[true,'flame',['gray']]]){
  const calls=[],rows=domain==='ash'?[{id:'ash',type:'retained-ash',ash:{}}]:[];
  const c={sceneMaterials:{sync(){}},createSceneLifecycle:x=>x,workingScene:{objects:rows},scene:{},disposeObjectTree(){},setSceneObjectMounted(){},prepareSavedSceneAssets(){},addSceneObjectFromSource(){},restoreLoadedSceneRecord(){},setSceneGroupsFromRecords(){},setSceneSelection(){},setActiveSceneObject(){},setActiveSceneGroup(){},retireSceneFlame(){},clearSceneEditingState(){},clearSceneDomains(){},clearSceneTransient(){},projectClearedScene(){},sceneArrivalState:{coarsePresented,coarseObjects:coarsePresented?1:0},sceneGeometryPreview:{present:async()=>calls.push('gray')},mountLocalLiquidHost:async()=>calls.push('water'),ASH_OBJECT_TYPE:'retained-ash',authoredAsh:new Map([['ash',{initialize:async()=>calls.push('ash')}]]),sceneColliderCollection:{}};
  vm.createContext(c);vm.runInContext(section('function createPageSceneLifecycle(', 'function loadTexture(').replace('const sceneLifecycle=createPageSceneLifecycle();',''),c);
  const setup={water:domain==='water'?{}:null,flame:{sourcePresent:domain==='flame'}};
  await c.createPageSceneLifecycle().context.loaded(setup,1);
  assert.deepEqual(calls,expected,JSON.stringify({coarsePresented,domain}));
 }
});

test('preparation preserves the fallback when no coarse asset root reaches its presented frame',async()=>{
 for(const mode of ['procedural','failed-lod','textured-lod']){
  const calls=[],sha='b'.repeat(64),record={id:'asset',type:mode==='procedural'?'procedural-mesh':'glb',source:mode==='procedural'?'/local/procedural':`/api/read?root=generated-meshes&path=${sha}.glb`};
  const c={THREE,createCoarseRepetition,resolveEarlyLowLodMeshSha,prepareSceneAssetBatch,
   sceneMaterials:{sync(){}},createSceneLifecycle:x=>x,workingScene:{objects:[record],groups:[]},scene:new THREE.Scene(),
   disposeObjectTree(){},disposePreparedAsset(){},setSceneObjectMounted(){},addSceneObjectFromSource(){},restoreLoadedSceneRecord(){},setSceneGroupsFromRecords(){},setSceneSelection(){},setActiveSceneObject(){},setActiveSceneGroup(){},retireSceneFlame(){},clearSceneEditingState(){},clearSceneDomains(){},clearSceneTransient(){},projectClearedScene(){},
   sceneArrivalState:{},sceneAssetPreparationOwner:null,setSceneAssetPreparationActive(){},lodPreparationContext:()=>({}),readAuthoredCameraView:()=>({}),renderer:{domElement:{width:128,height:128}},sceneBeautyLods:null,cachedLodPreparation:()=>new Map(),fullSceneAssetPool:{acquire:async()=>({scene:new THREE.Group()})},prepareArrivedMeshMaterials(){},seedInitialBeautyLevels(){},
   sceneGeometryPreview:{present:async()=>calls.push('gray')},ASH_OBJECT_TYPE:'retained-ash',sceneColliderCollection:{},
   GLTFLoader:class{},fetch:async()=>({ok:true,json:async()=>({choice:{sha256:sha,faces:12},levels:[]})}),
   loadPreparedLod:async()=>{if(mode==='failed-lod')throw Error('LOD unavailable');return new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({color:'#a04020'})));},
   sceneLoadRequests:{isCurrent:()=>true},window:{dispatchEvent(){}},CustomEvent:class{},requestAnimationFrame:fn=>queueMicrotask(fn),
   sceneLightingPreparation:{whenIdle:async()=>{},withRenderer:fn=>fn()},deviceRecoveryHeld:()=>false,syncViewportRendererSize(){},camera:new THREE.PerspectiveCamera(),sceneFrameCount:0,drawSceneFrame(){c.sceneFrameCount++;},
  };
  vm.createContext(c);
  vm.runInContext(section('let sceneLoadingStandInGroup = null;', 'async function showGLB(')+section('function createPageSceneLifecycle(', 'function loadTexture(').replace('const sceneLifecycle=createPageSceneLifecycle();','')+section('presentSceneCoarseFrame=async requestId=>{','  window.kaminosSceneLoadPresentation='),c);
  const setup={flame:{sourcePresent:false}},batch=await c.prepareSavedSceneAssets([record],1,setup);
  assert.equal(c.sceneFrameCount,2,'the real presenter draws even when staging has no roots');
  assert.equal(c.sceneArrivalState.coarseObjects,mode==='textured-lod'?1:0,mode);
  assert.equal(c.sceneArrivalState.expectedCoarseObjects,mode==='procedural'?0:1,mode);
  await c.createPageSceneLifecycle().context.loaded(setup,1);
  assert.deepEqual(calls,mode==='textured-lod'?[]:['gray'],mode);
  batch.dispose();
 }
});
