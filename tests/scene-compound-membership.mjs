// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sceneContext} from './helpers/scene-context.mjs';
import * as THREE from '../lib/three.core.js';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneMembershipBatch} from '../scene-membership-batch.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {checkedRepetition} from '../scene-repetition.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function fixture(){
 const state=createWorkingScene(),scene=new THREE.Scene(),edits=createSceneEdits({read:()=>null,write(){}}),lights=new Map();let next=0,failAttach=null;
 const serialize=row=>({id:row.id,type:row.type,label:row.label,source:row.source,transform:pose});
 const mount=row=>{if(row.id===failAttach)throw Error('typed attachment failed');const light=lights.get(row.id);scene.add(row.object,light,light.target);};
 const operations=createSceneMembershipOperations({scene:state,records:{serialize,reloadable:()=>true},
  roots:{attach:mount,restore(){},detach:row=>{row.object.removeFromParent();lights.get(row.id).removeFromParent();lights.get(row.id).target.removeFromParent();},dispose(){}},domains:{light:{retainRoot:true}}});operations.attachHistory(edits);
 const add=id=>{const row={id,type:'light',label:id,source:'kaminos:light',object:new THREE.Group()};lights.set(id,new THREE.SpotLight());state.put(row);mount(row);return row;};
 const group=(ids,label,options)=>{const {select=true,...data}=options;state.setGroups([...state.groups,{...data,label,objectIds:ids}]);if(select)state.select(['@group:'+data.id]);};
 const context=vm.createContext({structuredClone,workingScene:state,scene,sceneMembership:operations,
  scenePlacementTools:{edits},checkedRepetition,assertSceneConstructionAvailable(){},canDuplicateObject:()=>true,
  makeSceneObjectId:()=> 'group-'+(++next),duplicateSceneObject:id=>add(id+'-copy').id,
  createSceneGroupForObjects:group,serializeSceneObject:serialize,isReloadableSceneObjectRecord:()=>true,
  removeSceneObjectInternal:operations.remove,setActiveSceneGroup:id=>state.select(['@group:'+id]),
  addSceneObjectFromSource(){throw Error('must retain exact light roots');},applySceneObjectTransformState(){},applyMaterialStateToObject(){},
 });
 context.sceneMembershipBatch=createSceneMembershipBatch({scene:state,membership:operations,
  records:{serialize,reloadable:()=>true,apply(){}},groups:{serialize:()=>structuredClone(state.groups),create:group},
  duplicate:{supported:()=>true,object:id=>context.duplicateSceneObject(id),groupId:context.makeSceneObjectId}});
 context.sceneMembershipBatch.attachHistory(edits);
 const a=html.indexOf('function duplicateSceneGroup('),b=html.indexOf('function duplicateSceneSelection(',a);assert.ok(a>=0&&b>a);vm.runInContext(html.slice(a,b),context);
 add('lamp');group(['lamp'],'Lights',{id:'original',transform:pose});
 return {state,scene,edits,lights,context,add,group,failAttach:id=>failAttach=id};
}
test('duplicated light group restores light and target alongside its marker on Redo',async()=>{
 const f=fixture();const group=f.context.duplicateSceneGroup('original');
 const copy=f.state.find('lamp-copy'),light=f.lights.get('lamp-copy');
 assert.equal(light.parent,f.scene);await f.edits.undo();assert.equal(light.parent,null);assert.equal(copy.object.parent,null);
 await f.edits.redo();assert.equal(f.state.find('lamp-copy'),copy);assert.equal(copy.object.parent,f.scene);
 assert.ok(light.parent===f.scene,'Redo must restore the domain light, not only its authored marker');
 assert.equal(light.target.parent,f.scene);assert.ok(f.state.groups.some(g=>g.id===group));
});

test('failed group Redo rolls back partial reconstruction and permits retry',async()=>{
 const f=fixture();f.add('second');f.state.setGroups([{id:'original',label:'Lights',objectIds:['lamp','second'],transform:pose}]);
 f.context.duplicateSceneGroup('original');await f.edits.undo();f.failAttach('second-copy');
 await assert.rejects(f.edits.redo(),/typed attachment failed/);
 assert.equal(f.state.find('lamp-copy'),undefined,'failed Redo must retire the first reconstructed copy');
 assert.equal(f.state.find('second-copy'),undefined);assert.equal(f.edits.state().redoCount,1);
 f.failAttach(null);await f.edits.redo();assert.ok(f.state.find('lamp-copy'));assert.ok(f.state.find('second-copy'));
});

test('group Redo republishes restored flame sources through the production domain adapters',async()=>{
 const state=createWorkingScene(),scene=new THREE.Scene(),edits=createSceneEdits({read:()=>null,write(){}}),published=[];let next=0;
 const serialize=row=>({id:row.id,type:row.type,label:row.label,source:row.source,transform:pose,emission:row.emission});
 const h=sceneContext({structuredClone,createSceneMembershipOperations,createSceneMembershipBatch,workingScene:state,scene,scenePlacementTools:{edits},checkedRepetition,
 FLAME_EMITTER_TYPE:'flame-emitter',CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural',LOCAL_LIQUID_EMITTER_TYPE:'water',GROUP_TYPE:'group',
 serializeSceneObject:serialize,isReloadableSceneObjectRecord:()=>true,sceneNavigation:null,sceneCameras:null,transformControls:null,currentMesh:null,splatCorrectionMode:null,hybridSplatOverlayState:{},
 applyGiProxySetting(){},sceneGiProxies:{release(){}},applySceneObjectTransformState(){},applyMaterialStateToObject(){},canCollideWithFire:()=>false,disposeObjectTree(){},renderSceneObjectList(){},updateTransformInspector(){},setInfo(){},
 window:{_kaminosDirty(){}},setSceneSelection:(ids,id)=>state.select(ids,id),clearActiveSceneObjectSelection:()=>state.clearSelection(),setActiveSceneObject:id=>state.select([id]),setActiveSceneGroup:id=>state.select(['@group:'+id]),
 setSceneObjectMounted:(entry,on)=>on?scene.add(entry.object):scene.remove(entry.object),sceneSaveBlockedByFailedRestore:false,
 assertSceneConstructionAvailable(){},canDuplicateObject:()=>true,makeSceneObjectId:prefix=>prefix+'-'+(++next),sceneObjectDisplayLabel:row=>row.label,requirePluralFlameSourceRuntime(){},
 serializeSceneGroups:()=>structuredClone(state.groups),ensureGroupTarget(){},checkedGroupPose:value=>value,groupPivotPose:()=>pose,
 flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:false,authoredFlamePresent:true,flameEmitterPose:pose,
 sceneObjectTransformState:()=>pose,projectAuthoredFlameSourceControls(){},applyFlameEmitterPose(){},pruneSceneGroups:()=>state.pruneGroups(),
 });
 h.primaryAuthoredFlameSource=()=>state.objects.find(row=>row.type==='flame-emitter');
 h.syncAuthoredFlameSources=()=>published.push(state.objects.filter(row=>row.type==='flame-emitter').map(row=>row.id));
 h.ensureAuthoredFlameEmitter=record=>{const row={...record,object:new THREE.Group()};h.sceneMembership.admit(row);scene.add(row.object);};
 for(const name of ['createPageSceneMembershipOperations','createPageSceneMembershipBatch','createSceneGroupForObjects','duplicateSceneObject','duplicateSceneGroup','detachSelectionMember','applyCompoundSceneRecord','restoreCompoundSceneContext']){
   const a=html.indexOf('function '+name+'('),b=html.indexOf('\n}',a)+2;assert.ok(a>=0&&b>a);vm.runInContext(html.slice(a,b),h);
 }
 h.sceneMembership=h.createPageSceneMembershipOperations();h.sceneMembership.attachHistory(edits);
 h.ensureSceneObjectMembershipTarget=h.sceneMembership.ensureTarget;
 h.sceneMembershipBatch=h.createPageSceneMembershipBatch();h.sceneMembershipBatch.attachHistory(edits);
 h.ensureAuthoredFlameEmitter({id:'flame',type:'flame-emitter',label:'Fire',source:'kaminos:analytic-flame',emission:{fuel:.8}});
 h.createSceneGroupForObjects(['flame'],'Flames',{id:'original',transform:pose});
 const group=h.duplicateSceneGroup('original'),copy=state.groups.find(row=>row.id===group).objectIds[0];
 assert.deepEqual(published.at(-1),['flame',copy]);await edits.undo();assert.deepEqual(published.at(-1),['flame']);
 await edits.redo();assert.deepEqual(state.objects.map(row=>row.id),['flame',copy]);
 assert.deepEqual(published.at(-1),['flame',copy],'Redo must publish every restored source, not just restore its handle');
 assert.equal(state.find(copy).emission.fuel,.8);
});
