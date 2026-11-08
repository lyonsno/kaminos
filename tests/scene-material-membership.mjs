import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {sceneContext} from './helpers/scene-context.mjs';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import {createSceneMembershipBatch} from '../scene-membership-batch.mjs';
import {normalizeFlameDomainTranslation,normalizeFlameDomainScale} from '../scene-flame-emitter.mjs';
import {checkedRepetition} from '../scene-repetition.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
test('production batch removal and source reconstruction restore the recipe and rendered material',async()=>{
 const state=createWorkingScene(),scene=new THREE.Scene(),edits=createSceneEdits({read:()=>null,write(){}});
 const serialize=entry=>({id:entry.id,type:entry.type,label:entry.label,source:entry.source,transform:pose,burnable:entry.burnable});
 const h=sceneContext({structuredClone,workingScene:state,scene,scenePlacementTools:{edits,finish(){}},normalizeFlameDomainTranslation,normalizeFlameDomainScale,createSceneMembershipOperations,createSceneMembershipBatch,checkedRepetition,
  serializeSceneObject:serialize,isReloadableSceneObjectRecord:()=>true,sceneNavigation:null,sceneCameras:null,transformControls:null,currentMesh:null,splatCorrectionMode:null,hybridSplatOverlayState:{},
  applyGiProxySetting(){},sceneGiProxies:{release(){}},applySceneObjectTransformState(){},applyMaterialStateToObject(){},canCollideWithFire:()=>false,disposeObjectTree(){},renderSceneObjectList(){},updateTransformInspector(){},setInfo(){},
  window:{_kaminosDirty(){}},setSceneSelection:(ids,id)=>state.select(ids,id),clearActiveSceneObjectSelection:()=>state.clearSelection(),writeObjectBurnable(){},
  FLAME_EMITTER_TYPE:'flame-emitter',CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural-mesh',LOCAL_LIQUID_EMITTER_TYPE:'water',
  flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:false,authoredFlamePresent:false,flameEmitterPose:pose,applyFlameEmitterPose(){},pruneSceneGroups:()=>state.pruneGroups(),
  canDuplicateObject:()=>true,serializeSceneGroups:()=>[],primaryAuthoredFlameSource:()=>null,sceneObjectTransformState:()=>pose,
  setFlameDomainTranslation(){},syncAuthoredFlameSources(){},createSceneGroupForObjects(){},ensureGroupTarget(){},
 });
 for(const name of ['createPageSceneMembershipOperations','createPageSceneMembershipBatch','applyCompoundSceneRecord','restoreCompoundSceneContext','detachSelectionMember']){const a=html.indexOf('function '+name+'('),b=html.indexOf('\n}',a)+2;vm.runInContext(html.slice(a,b),h);}
 h.sceneMembership=h.createPageSceneMembershipOperations();h.sceneMembership.attachHistory(edits);h.removeSceneObjectInternal=h.sceneMembership.remove;
 h.sceneMembershipBatch=h.createPageSceneMembershipBatch();h.sceneMembershipBatch.attachHistory(edits);
 const mount=record=>{const object=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());h.sceneMembership.admit({...record,object});scene.add(object);return object;};
 h.addSceneObjectFromSource=async record=>mount(record);
 const original=mount({id:'pbr',type:'pbr',source:'local-policy-fixture:pbr',label:'Reconstructed surface'});
 h.sceneMaterials.write({recipes:[{id:'finish',name:'Finish',implementation:'standard-surface',version:1,parameters:{color:'#aa5533',roughness:.23,metalness:.8}}],bindings:[{objectId:'pbr',slot:'.:0',recipeId:'finish'}]});state.select(['pbr']);
 h.sceneMembershipBatch.remove(['pbr']);await edits.undo();const restored=state.find('pbr').object;
 assert.notEqual(restored,original,'this path reconstructs, rather than retaining the root');assert.equal(h.sceneMaterials.bindings('pbr')[0]?.recipeId,'finish');assert.equal(restored.material.roughness,.23);assert.equal(restored.material.color.getHexString(),'aa5533');
});
