// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {checkedSelection,changeSelection} from '../scene-selection.mjs';
import {createLocalLiquidEmitterObject,createLocalLiquidEmitterSceneRecord} from '../local-liquid-scene-object.mjs';
import {LOCAL_LIQUID_EMITTER_TYPE,LOCAL_LIQUID_EMITTER_SOURCE} from '../local-liquid-setup.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function install(context,first,last){const a=html.indexOf(first),b=html.indexOf(last,a);assert.ok(a>=0&&b>a);vm.runInContext(html.slice(a,b),context);}
function fixture(){
 const workingScene=createWorkingScene(),scene=new THREE.Scene(),calls={selection:0,exit:0,water:0};
 const context=vm.createContext({THREE,structuredClone,workingScene,scene,createSceneMembershipOperations,createSceneObjectRecord,
 checkedSelection,changeSelection,createLocalLiquidEmitterObject,LOCAL_LIQUID_EMITTER_TYPE,LOCAL_LIQUID_EMITTER_SOURCE,
 CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural-mesh',FLAME_EMITTER_TYPE:'flame',localLiquidSetup:null,
 sceneNavigation:{prepare(){}},applyGiProxySetting(){},createSceneGroupForObjects(){},
 serializeSceneObject:entry=>({id:entry.id}),isReloadableSceneObjectRecord:()=>true,disposeObjectTree(){},
 syncLocalLiquidHostEmitters(){calls.water++;},sceneCameras:null,sceneSaveBlockedByFailedRestore:false,sceneGiProxies:{release(){}},
 hybridSplatOverlayState:{},transformControls:null,currentMesh:null,splatCorrectionMode:null,
 activeSceneComposition:null,burnerGraphWriting:false,authoringWorkspace:null,
 scenePlacementTools:{selectionChanged(){calls.selection++;}},
 renderSceneObjectList(){},updateTransformInspector(){},updateSelectionFeedback(){},setInfo(){},window:{},
 applySceneObjectTransformState(root,pose){root.position.fromArray(pose.position);root.rotation.fromArray(pose.rotation);root.scale.fromArray(pose.scale);},
 applyMaterialStateToObject(){},canCollideWithFire:()=>false,
 selectedSceneObjectEntry:()=>workingScene.find(workingScene.activeObjectId),
 selectedSceneGroupEntry:()=>workingScene.groups.find(g=>g.id===workingScene.activeGroupId),
 groupProxy:()=>new THREE.Group(),selectionTransformProxy:()=>new THREE.Group(),
 });
 context.exitSplatCorrectionMode=()=>{calls.exit++;context.splatCorrectionMode.helper.removeFromParent();context.splatCorrectionMode=null;};
 for(const [a,b] of [['function setSceneSelection(','function readSceneSelection('],['function clearActiveSceneObjectSelection(','function sceneObjectRecordForDescendant('],['function registerSceneObject(','window.selectSceneField='],['async function addSceneObjectFromSource(','function assertSceneObjectsReloadable('],['function createPageSceneMembershipOperations(','const sceneMembership =']])install(context,a,b);
 context.sceneMembership=context.createPageSceneMembershipOperations();
 const edits=createSceneEdits({read:()=>null,write(){}});context.sceneMembership.attachHistory(edits);
 const old=new THREE.Group();scene.add(old);workingScene.put({id:'selected',object:old,type:'glb',source:'/old.glb'});workingScene.select(['selected'],'selected');context.currentMesh=old;
 return {context,workingScene,scene,calls,edits};
}
test('page admission exits prior splat correction exactly once when activating a different root',()=>{
 const {context,workingScene,scene,calls}=fixture(),helper=new THREE.Group();scene.add(helper);context.splatCorrectionMode={objectId:'selected',helper};
 context.registerSceneObject(new THREE.Group(),{id:'new',type:'glb',source:'/new.glb'});
 assert.equal(workingScene.activeObjectId,'new');assert.equal(calls.exit,1);assert.equal(helper.parent,null);assert.equal(context.splatCorrectionMode,null);
});
test('nonactivating page admission preserves selection and its correction helpers',()=>{
 const {context,workingScene,scene,calls}=fixture(),helper=new THREE.Group();scene.add(helper);context.splatCorrectionMode={objectId:'selected',helper};
 context.registerSceneObject(new THREE.Group(),{id:'quiet',type:'glb',source:'/quiet.glb'},{activate:false});
 assert.deepEqual(workingScene.selection,{ids:['selected'],activeId:'selected'});assert.equal(calls.selection,0);assert.equal(calls.exit,0);assert.equal(helper.parent,scene);
});
for(const group of [false,true])test(`source reconstruction preserves ${group?'group':'object'} selection without activation or history`,async()=>{
 const {context,workingScene,scene,calls,edits}=fixture();
 if(group){workingScene.setGroups([{id:'group',objectIds:['selected']}]);workingScene.select(['@group:group'],'@group:group');}
 const before=structuredClone(workingScene.selection),current=context.currentMesh;
 const record=createLocalLiquidEmitterSceneRecord({id:'restored-water',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]}});
 const entry=await context.sceneMembership.reconstruct(record);
 assert.deepEqual(workingScene.selection,before);assert.equal(context.currentMesh,current);assert.equal(calls.selection,0);assert.equal(calls.exit,0);
 assert.equal(calls.water,1,'reconstruction republishes the restored water emitter');assert.equal(entry.object.parent,scene);assert.equal(entry.object.position.y,1);assert.equal(edits.state().undoCount,0);
});

for(const type of ['image','pbr','glb','splat'])test(`${type} source loader preserves selection through its production registration path`,async()=>{
 const {context,workingScene,calls}=fixture(),current=context.currentMesh;
 const documentEffects=[];
 Object.assign(context,{shouldClearSceneForImport:()=>false,greenroomPreviewIsActive:()=>false,
  loadTexture:async()=>Object.assign(new THREE.Texture(),{image:{width:8,height:4}}),
  loadDemoFiles:async()=>[{name:'albedo.png'}],updateReceiptPanel(){},loadedFiles:{},receipt:null,
  modelSourceUrl:null,modelSourceType:null,glbFileName:null,glbSourceScene:null,
  resolveAssetArrivalMode:()=>null,applyAssetArrival:()=>null,normalizeArrivalLeveling:()=>null,
  GLTFLoader:class {load(_url,done){done({scene:new THREE.Group(),animations:[]});}},
  document:{getElementById:()=>({value:'1',classList:{add:value=>documentEffects.push(value)}})},
  createSceneObjectPublicationGuard:()=>()=>true,
  publishSceneObjectIfCurrent:({object,publish})=>{publish(object);return true;},
  greenroomSplatMetadata:(_display,_name,_url,metadata)=>({...metadata,splat:{}}),fetchSplatAssetCorrection:async()=>null,
  createSplatSceneObjectPreview:async()=>({object:new THREE.Group(),preview:{}}),
  cloneTransformState:structuredClone,sceneObjectTransformState:()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),
  applySplatCorrectionToRecord(){},buildRenderHandoffV0(){},RENDER_HANDOFF_SCHEMA:'test',
 });
 for(const [a,b] of [['async function showImagePlane(','// --- PBR Material Preview ---'],['async function showPBRPreview(','// --- GLB Inspector ---'],['async function showGLB(','// Scene-session owners borrow this loader'],['async function handleFiles(','// --- Drag & Drop ---'],['async function greenroomImportSplat(','window.greenroomImportSplat =']])install(context,a,b);
 const row={id:'restored',source:'/fixture.'+type,type,fileName:'fixture.'+type,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};
 await context.sceneMembership.reconstruct(row);
 assert.equal(workingScene.activeObjectId,'selected');assert.equal(context.currentMesh,current);assert.equal(calls.selection,0);assert.deepEqual(documentEffects,[]);
 assert.ok(workingScene.find('restored'));
});
