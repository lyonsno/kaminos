// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {defaultLocalLiquidSetup,normalizeLocalLiquidSetup,LOCAL_LIQUID_EMITTER_TYPE,LOCAL_LIQUID_EMITTER_SCHEMA} from '../local-liquid-setup.mjs';
import {createLocalLiquidEmitterSceneRecord,createLocalLiquidEmitterObject} from '../local-liquid-scene-object.mjs';
import {resolveAuthoredWaterSampling} from '../authored-water-drop.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function install(h,name,async=false){const a=html.indexOf((async?'async ':'')+'function '+name+'('),b=html.indexOf('\n}',a)+2;assert.ok(a>=0&&b>a);vm.runInContext(html.slice(a,b),h);}
test('actual Add Water refuses preview before setup, construction, selection or history changes',async()=>{
 const workingScene=createWorkingScene(),scene=new THREE.Scene(),original=new THREE.Group();scene.add(original);workingScene.put({id:'original',type:'glb',object:original});workingScene.select(['original']);workingScene.suspendMembership();scene.remove(original);
 const edits=createSceneEdits({read:()=>null,write(){},admit:()=>{if(workingScene.isSuspended)throw Error('Preview editing is refused');}});
 const membership=createSceneMembershipOperations({scene:workingScene,records:{},roots:{}});membership.attachHistory(edits);
 const h=vm.createContext({sceneLightingPreparation:null,THREE,structuredClone,workingScene,scene,createSceneObjectRecord,sceneMembership:membership,
 LOCAL_LIQUID_EMITTER_TYPE,LOCAL_LIQUID_EMITTER_SCHEMA,defaultLocalLiquidSetup,normalizeLocalLiquidSetup,resolveAuthoredWaterSampling,createLocalLiquidEmitterSceneRecord,createLocalLiquidEmitterObject,
 localLiquidSetup:null,authoringBusy:false,sceneSaveBlockedByFailedRestore:false,scenePlacementTools:{edits},controls:{target:new THREE.Vector3()},localLiquidEmitterRecords:()=>[],selectedWaterSource:()=>null,makeSceneObjectId:()=> 'water',
 CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural',FLAME_EMITTER_TYPE:'flame',sceneNavigation:null,sceneObjectDisplayLabel:row=>row.label,
 setActiveSceneObject:id=>workingScene.select([id]),sceneCameras:null,renderSceneObjectList(){},updateTransformInspector(){},applyGiProxySetting(){},setInfo(){},window:{}});
 install(h,'assertSceneConstructionAvailable');install(h,'registerSceneObject');install(h,'addAuthoredWaterDrop',true);
 const history=edits.state();await assert.rejects(h.addAuthoredWaterDrop(),/preview|suspended/i);
 assert.equal(h.localLiquidSetup,null,'refused preview construction must leave the absence of a water domain intact');assert.deepEqual(scene.children,[]);assert.equal(workingScene.objects.length,0);assert.equal(workingScene.suspendedObjects()[0].object,original);assert.deepEqual(edits.state(),history);
 workingScene.resumeMembership();scene.add(original);assert.deepEqual(workingScene.selection,{ids:['original'],activeId:'original'});assert.deepEqual(scene.children,[original]);assert.equal(h.localLiquidSetup,null);
});
