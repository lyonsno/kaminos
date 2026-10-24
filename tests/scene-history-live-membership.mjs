// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneMembershipBatch} from '../scene-membership-batch.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneEdits,checkedPose} from '../scene-edit-session.mjs';
import {checkedSelection} from '../scene-selection.mjs';
import {checkedRepetition} from '../scene-repetition.mjs';
import {isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function fixture(){
 const workingScene=createWorkingScene(),scene=new THREE.Scene(),disposed=[],loaded=[];
 const edits=createSceneEdits({read:()=>null,write(){}});
 function add(id,type='glb'){
  const object=new THREE.Group();object.userData.kaminosSceneObject={id};scene.add(object);
  const row={id,object,type,source:type==='glb'?`/api/read?root=models&path=${id}.glb`:null,label:id,repetition:null};workingScene.put(row);return row;
 }
 function detach(id){return operations.remove(id,{recordHistory:false,preserveForMembershipHistory:true});}
 const serializeSceneObject=row=>({id:row.id,type:row.type,source:row.source,label:row.label,groupId:row.groupId??null,repetition:row.repetition,transform:{...pose,position:row.object.position.toArray()}});
 const operations=createSceneMembershipOperations({scene:workingScene,
  records:{serialize:serializeSceneObject,reloadable:isReloadableSceneObjectRecord,load:record=>context.addSceneObjectFromSource(record)},
  roots:{attach:row=>scene.add(row.object),restore(){},detach:row=>scene.remove(row.object),dispose:root=>disposed.push(root.userData.kaminosSceneObject.id)},
  domains:{glb:{retainRoot:true}},
 });
 operations.attachHistory(edits);
 const context={sceneMembership:operations,workingScene,scene,structuredClone,checkedPose,checkedGroupPose:checkedPose,checkedSelection,checkedRepetition,isReloadableSceneObjectRecord,
  serializeSceneObject,serializeSceneGroups:()=>structuredClone(workingScene.groups),sceneCameras:null,
  flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:true,FLAME_EMITTER_TYPE:'flame-emitter',CAMERA_TYPE:'camera',
  normalizeFlameDomainTranslation:x=>x,normalizeFlameDomainScale:x=>x,clearActiveSceneObjectSelection:()=>workingScene.clearSelection(),
  setSceneObjectMounted:(row,mounted)=>mounted?scene.add(row.object):scene.remove(row.object),
  addSceneObjectFromSource:async record=>{loaded.push(record.id);return add(record.id,record.type).object;},
  applyAuthoredScenePose:(id,value)=>workingScene.find(id).object.position.fromArray(value.position),
  ensureGroupTarget(){},primaryAuthoredFlameSource:()=>null,setFlameDomainTranslation(){},syncAuthoredFlameSources(){},
  setSceneSelection:(ids,id)=>workingScene.select(ids,id,['flame-field','water-field']),renderSceneObjectList(){},updateTransformInspector(){},window:{},
  assertSceneConstructionAvailable(){},sceneSelectionMembers:()=>workingScene.selection.ids,
  scenePlacementTools:{edits},setInfo(){},
 };
 const h=context;
 const batch=createSceneMembershipBatch({scene:workingScene,membership:operations,detach,
 records:{serialize:serializeSceneObject,reloadable:isReloadableSceneObjectRecord,apply:(entry,record)=>{entry.object.position.fromArray(record.transform.position);entry.label=record.label;}},
 groups:{serialize:()=>structuredClone(workingScene.groups)},select:context.setSceneSelection});
 Object.assign(h,{readSelectionMembership:batch.capture,checkSelectionMembership:batch.check,writeSelectionMembership:batch.write,
 removeSelectedSceneObjects:()=>batch.remove(workingScene.selection.ids)});batch.attachHistory(edits);
 return {h,workingScene,scene,edits,add,detach,disposed,loaded};
}

test('compound remove/Undo/Redo leaves live experiment identity and evolved state intact',async()=>{
 const f=fixture(),live=f.add('experiment','experiment'),a=f.add('a');
 f.workingScene.select(['a']);f.h.removeSelectedSceneObjects();
 assert.equal(f.workingScene.find('a'),undefined);assert.equal(f.workingScene.find('experiment'),live);
 live.object.position.x=9;live.object.userData.evolved=17;
 await f.edits.undo();assert.equal(f.workingScene.find('a'),a);assert.equal(live.object.parent,f.scene);
 assert.equal(live.object.position.x,9);assert.equal(live.object.userData.evolved,17);
 await f.edits.redo();assert.equal(f.workingScene.find('a'),undefined);assert.equal(f.workingScene.find('experiment'),live);
 assert.deepEqual(f.disposed,[]);assert.deepEqual(f.loaded,[]);
});

test('retired experiment references do not resurrect; replacement experiment survives replay',async()=>{
 const f=fixture();f.add('old','experiment');const a=f.add('a');
 f.workingScene.setGroups([{id:'mixed',objectIds:['a','old'],transform:pose,label:'Mixed'}]);f.workingScene.select(['a']);f.h.removeSelectedSceneObjects();
 f.detach('old');const replacement=f.add('new','experiment');
 f.workingScene.setGroups([{id:'new-live-group',objectIds:['new'],transform:pose,label:'New live group'}]);
 await f.edits.undo();assert.equal(f.workingScene.find('a'),a);assert.equal(f.workingScene.find('old'),undefined);
 assert.equal(f.workingScene.find('new'),replacement);assert.equal(replacement.object.parent,f.scene);
 assert.deepEqual(f.workingScene.groups.map(g=>[g.id,[...g.objectIds]]),[['mixed',['a']],['new-live-group',['new']]]);
 await f.edits.redo();assert.equal(f.workingScene.find('new'),replacement);assert.deepEqual(f.loaded,[]);assert.deepEqual(f.disposed,['old']);
});

test('removal containing a live-only member refuses before changing any roots or history',()=>{
 const f=fixture(),a=f.add('a'),live=f.add('experiment','experiment');f.workingScene.select(['a','experiment']);
 assert.throws(()=>f.h.removeSelectedSceneObjects(),/no retained source/);
 assert.equal(f.workingScene.find('a'),a);assert.equal(f.workingScene.find('experiment'),live);assert.equal(f.edits.state().undoCount,0);assert.deepEqual(f.disposed,[]);
});

test('selection references to closed experiments are pruned during restore',async()=>{
 const f=fixture();f.add('old','experiment');f.add('a');f.workingScene.select(['old']);
 const before=f.h.checkSelectionMembership(f.h.readSelectionMembership());f.detach('old');f.add('replacement','experiment');
 await f.h.writeSelectionMembership(before);assert.deepEqual([...f.workingScene.selection.ids],[]);assert.equal(f.workingScene.find('old'),undefined);assert.ok(f.workingScene.find('replacement'));assert.deepEqual(f.loaded,[]);
});

test('experiment close/open during asynchronous source restore is resolved from current owners',async()=>{
 const f=fixture();f.add('old','experiment');f.add('a');f.workingScene.select(['a']);const saved=f.h.readSelectionMembership();
 f.workingScene.forget('a');let release;const waiting=new Promise(resolve=>{release=resolve;});
 f.h.addSceneObjectFromSource=async record=>{await waiting;return f.add(record.id).object;};
 const restoring=f.h.writeSelectionMembership(saved);f.detach('old');const live=f.add('new','experiment');live.object.position.x=7;
 release();await restoring;assert.ok(f.workingScene.find('a'));assert.equal(f.workingScene.find('new'),live);assert.equal(live.object.position.x,7);assert.equal(f.workingScene.find('old'),undefined);
});

test('failed source reconstruction restores prior authored membership and preserves live changes',async()=>{
 const f=fixture(),a=f.add('a'),live=f.add('live','experiment');f.workingScene.select(['a']);
 const before=f.h.readSelectionMembership();let release;
 f.h.addSceneObjectFromSource=async record=>{await new Promise(resolve=>{release=resolve;});f.add(record.id);throw Error('source decode failed after publication');};
 const pending=f.h.writeSelectionMembership({...before,objects:[{...before.objects[0],id:'broken',source:'/api/read?root=models&path=broken.glb'}],selection:{ids:['broken'],activeId:'broken'}});
 live.object.position.x=12;release();await assert.rejects(pending,/source decode failed/);
 assert.equal(f.workingScene.find('a'),a);assert.equal(a.object.parent,f.scene);assert.equal(f.workingScene.find('broken'),undefined);
 assert.equal(f.workingScene.find('live'),live);assert.equal(live.object.position.x,12);assert.deepEqual(f.workingScene.selection,{ids:['a'],activeId:'a'});
});
