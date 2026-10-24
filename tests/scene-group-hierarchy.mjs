// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkingScene} from '../working-scene.mjs';
import {selectionTransformRoots} from '../scene-selection.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {buildSceneOutline,visibleOutlineRows} from '../scene-outline-tree.mjs';
import {resolveSceneMembershipTopology} from '../scene-membership-history.mjs';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const groups=()=>[{id:'machine',objectIds:[],transform:pose},{id:'base',parentId:'machine',objectIds:['foot'],transform:pose},{id:'boom',parentId:'machine',objectIds:['arm'],transform:pose}];
const records=()=>['foot','arm'].map(id=>({id,type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters:{width:1,height:1,depth:1}},transform:pose}));
const scene=()=>{const s=createWorkingScene();for(const row of records())s.put({...row,object:{userData:{}}});return s;};
test('an outer group retains rigid role groups and their direct membership',()=>{
 const s=scene();s.setGroups(groups());assert.deepEqual(s.groups.map(g=>g.id),['machine','base','boom']);assert.equal(s.find('foot').groupId,'base');s.select(['@group:machine']);assert.equal(s.activeGroupId,'machine');
 s.forget('foot');assert.deepEqual(s.groups.map(g=>g.id),['machine','boom']);assert.equal(s.groups[1].parentId,'machine');s.forget('arm');assert.deepEqual(s.groups,[]);
});
test('cycles and absent parents fail before changing accepted topology',()=>{
 const s=scene();s.setGroups(groups());const before=s.groups;
 assert.throws(()=>s.setGroups(groups().map(g=>g.id==='machine'?{...g,parentId:'boom'}:g)),/cycle/i);
 assert.throws(()=>s.setGroups(groups().map(g=>g.id==='boom'?{...g,parentId:'missing'}:g)),/parent/i);assert.equal(s.groups,before);
});
test('selecting a parent, its role group and a child moves each only once',()=>{
 assert.deepEqual(selectionTransformRoots(['@group:machine','@group:base','foot','arm'],groups()),['@group:machine']);
});
test('nested role groups survive save/reopen including a parent with no direct meshes',()=>{
 const saved=buildSceneDocument({objects:records(),groups:groups(),activeGroupId:'machine'}),restored=planSceneRestore(saved);
 assert.equal(saved.version,12,'older clients must refuse a hierarchy they would flatten');
 assert.deepEqual(restored.groups.map(g=>[g.id,g.parentId??null,g.objectIds]),[['machine',null,[]],['base','machine',['foot']],['boom','machine',['arm']]]);assert.equal(restored.activeGroupId,'machine');
});
test('the outliner shows machine, roles and members at their actual depth',()=>{
 const rows=buildSceneOutline({groups:groups(),objects:records()});assert.deepEqual(rows.map(r=>[r.id,r.depth]),[['machine',0],['base',1],['foot',2],['boom',1],['arm',2]]);
 assert.deepEqual(visibleOutlineRows(rows,new Set(['group:machine'])).map(r=>r.id),['machine']);
});
test('authored history retains ancestor groups while leaving live experiments current',()=>{
 const value={objects:records(),groups:groups(),selection:{ids:['@group:machine'],activeId:'@group:machine'}};
 const resolved=resolveSceneMembershipTopology(value,{order:['experiment','foot','arm'],liveIds:['experiment'],groups:[...groups(),{id:'live',objectIds:['experiment']}]});
 assert.deepEqual(resolved.groups.map(g=>g.id),['machine','base','boom','live']);assert.equal(resolved.selection.activeId,'@group:machine');assert.equal(resolved.ids[0],'experiment');
});

import fs from 'node:fs';import vm from 'node:vm';import * as THREE from '../lib/three.core.js';
import {checkedGroupPose,moveGroupMembers,identityGroupPose} from '../scene-group.mjs';
import * as topology from '../scene-group-topology.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=name=>{const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n}',start)+2);};
test('Group selected wraps selected roles without destroying them',()=>{
 const s=scene();s.setGroups(groups().filter(g=>g.id!=='machine').map(g=>({...g,parentId:null})));s.select(['@group:base','@group:boom']);
 const c={...topology,workingScene:s,GROUP_TYPE:'group',structuredClone,selectionTransformRoots,groupPivotPose:()=>structuredClone(pose),makeSceneObjectId:()=> 'wrapper',selectedRootIds:()=>selectionTransformRoots(s.selection.ids,s.groups),setSceneSelection:(ids,active)=>s.select(ids,active),setActiveSceneGroup:id=>s.select(['@group:'+id]),editSceneGroups:change=>{const next=structuredClone(s.groups);change(next);s.setGroups(next);}};
 vm.createContext(c);vm.runInContext(fn('sceneSelectionMembers')+'\n'+fn('groupSceneObjects')+'\n'+fn('groupSelectedObjects'),c);c.groupSelectedObjects('Arm');
 assert.deepEqual(JSON.parse(JSON.stringify(s.groups.map(g=>[g.id,g.parentId??null,g.objectIds]))),[['base','wrapper',['foot']],['boom','wrapper',['arm']],['wrapper',null,[]]]);assert.equal(s.activeGroupId,'wrapper');
});
test('moving the assembly updates every part and each role frame once; reverse restores them',()=>{
 const s=createWorkingScene();for(const row of records()){const object=new THREE.Group();s.put({...row,object});}s.setGroups(groups());
 const c={...topology,THREE,workingScene:s,structuredClone,checkedGroupPose,moveGroupMembers,sceneObjectTransformState:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),applyAuthoredScenePose:(id,p)=>{const o=s.find(id).object;o.position.fromArray(p.position);o.rotation.set(...p.rotation);o.scale.fromArray(p.scale);},FLAME_EMITTER_TYPE:'flame-emitter',groupProxy:()=>new THREE.Group(),applySceneObjectTransformState(){},updateTransformInspector(){},window:{_kaminosDirty(){}}};
 vm.createContext(c);vm.runInContext(fn('groupEditState')+'\n'+fn('writeGroupPose'),c);const before=c.groupEditState(s.groups[0]);c.writeGroupPose('machine',{...before,position:[4,2,1]});
 assert.deepEqual(s.find('arm').object.position.toArray(),[4,2,1]);assert.deepEqual(s.groups.find(g=>g.id==='boom').transform.position,[4,2,1]);c.writeGroupPose('machine',before);assert.deepEqual(s.find('arm').object.position.toArray(),[0,0,0]);assert.deepEqual(s.groups.find(g=>g.id==='boom').transform.position,[0,0,0]);
});

import {sceneItemVisible} from '../scene-visibility.mjs';
import {restoreSceneObjectGroups} from '../scene-membership-history.mjs';
test('hiding an assembly hides its roles and contents, and restoring its last part restores its ancestors',()=>{
 const state={groups:groups(),objects:records()};assert.equal(sceneItemVisible('arm',['@group:machine'],state),false);assert.equal(sceneItemVisible('@group:boom',['@group:machine'],state),false);
 const saved=groups().filter(g=>g.id!=='base').map((g,groupIndex)=>({...g,groupIndex}));const restored=restoreSceneObjectGroups([],saved,'arm',['arm']);assert.deepEqual(restored.map(g=>[g.id,g.parentId??null]),[['machine',null],['boom','machine']]);
});

import {createSceneRepetitionController} from '../scene-repetition-controller.mjs';
test('array placements compose across nested group frames',()=>{
 const object=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),rows=[{id:'foot',type:'procedural-mesh',object}];
 const tree=groups().filter(g=>g.id!=='boom').map(g=>({...g,repetition:{mode:'line',count:g.id==='machine'?3:2,step:g.id==='machine'?[4,0,0]:[0,2,0]}}));
 const c=createSceneRepetitionController({objects:()=>rows,groups:()=>tree,readPose:()=>pose});c.sync();assert.equal(object.children.length,5);assert.equal(c.matrices(rows[0]).length,6);
});

test('adding another part to an existing role retains its assembly parent',()=>{
 const s=scene();s.put({id:'bolt',type:'procedural-mesh',object:{userData:{}}});s.setGroups(groups());
 const c={workingScene:s,checkedRepetition:value=>value??null,checkedGroupPose,GROUP_TYPE:'group',ensureGroupTarget(){},setActiveSceneGroup(){},renderSceneObjectList(){},window:{}};
 vm.createContext(c);vm.runInContext(fn('createSceneGroupForObjects'),c);c.createSceneGroupForObjects(['bolt'],null,{id:'boom'});
 assert.equal(s.groups.find(g=>g.id==='boom').parentId,'machine');assert.equal(s.find('bolt').groupId,'boom');
});
test('ungrouping the outer assembly preserves the rigid role groups',()=>{
 const s=scene();s.setGroups(groups());s.select(['@group:machine']);
 const c={...topology,structuredClone,workingScene:s,selectedRootIds:()=>selectionTransformRoots(s.selection.ids,s.groups),editSceneGroups:change=>{const next=structuredClone(s.groups);change(next);s.setGroups(next);},setSceneSelection:(ids,active)=>s.select(ids,active)};
 vm.createContext(c);vm.runInContext(fn('ungroupSelectedObjects'),c);c.ungroupSelectedObjects();assert.deepEqual(s.groups.map(g=>[g.id,g.parentId??null]),[['base',null],['boom',null]]);assert.deepEqual([...s.selection.ids],['@group:base','@group:boom']);
});

test('the active assembly gives all descendant meshes the active highlight',()=>{
 const s=createWorkingScene();for(const row of records())s.put({...row,object:new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial())});s.setGroups(groups());s.select(['@group:machine']);let active;
 const c={...topology,THREE,workingScene:s,scene:new THREE.Scene(),flameDomainGuide:null,localLiquidDomainGuide:null,syncSceneHelperVisibility(){},viewportDisplay:{outlineWidth:1,outlineOpacity:1,overlays:true,outlines:true},selectionCaptureSuspended:false,renderer:null,selectionFeedback:{setStyle(){},suspend(){},update(_entries,ids){active=[...ids];}},isSceneItemVisible:()=>true,CAMERA_TYPE:'camera',FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',selectionBoxes:new Map(),styleHelperLines(){},viewportBoundsVisible:true,viewportHelpersVisible:true};
 vm.createContext(c);vm.runInContext(fn('sceneSelectionMembers')+'\n'+fn('updateSelectionFeedback'),c);c.updateSelectionFeedback();assert.deepEqual(active,['foot','arm']);for(const box of c.selectionBoxes.values())assert.equal(box.material.color.getHex(),0xffc66d);
});


import {createSceneEdits} from '../scene-edit-session.mjs';
import {checkedGroupEdit} from '../scene-group.mjs';
test('confirmed duplicate placement is one reversible operation, including group aliases',async()=>{
 for(const prefix of ['@group:','@assembly:']){
  const s=createWorkingScene(),retained=new Map();let serial=0;
  const readPose=o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()});
  for(const row of records()){const entry={...row,object:new THREE.Group()};s.put(entry);retained.set(row.id,entry);}s.setGroups(groups());s.select(['@group:machine']);
  const read=()=>({objects:s.objects.map(e=>({id:e.id,transform:readPose(e.object)})),groups:structuredClone(s.groups),selection:structuredClone(s.selection)});
  const apply=(id,p)=>{const o=retained.get(id).object;o.position.fromArray(p.position);o.rotation.set(...p.rotation);o.scale.fromArray(p.scale);};
  const restore=value=>{s.replaceObjects(value.objects.map(row=>{apply(row.id,row.transform);return retained.get(row.id);}));s.setGroups(value.groups);s.select(value.selection.ids,value.selection.activeId);};
  const edits=createSceneEdits({read:()=>null,write(){throw Error('Unexpected object target');}});
  const c={...topology,THREE,workingScene:s,structuredClone,checkedGroupPose,checkedGroupEdit,moveGroupMembers,groupEditTargets:new Set(),sceneObjectTransformState:readPose,applyAuthoredScenePose:apply,
   FLAME_EMITTER_TYPE:'flame-emitter',groupProxy:()=>new THREE.Group(),applySceneObjectTransformState(){},updateTransformInspector(){},window:{},
   assertSceneConstructionAvailable(){},selectedRootIds:()=>selectionTransformRoots(s.selection.ids,s.groups),canDuplicateObject:()=>true,checkSelectionMembership:x=>x,readSelectionMembership:read,compoundRetentionTargets:new Map(),
   makeSceneObjectId:()=> 'copy-group-'+(++serial),setSceneSelection:(ids,id)=>s.select(ids,id),detachSelectionMember:id=>s.forget(id),releaseUnreferencedSceneMembershipObjects(){},
   duplicateSceneObject(id){const row=s.find(id),copy={...row,id:'copy-'+id,object:row.object.clone()};retained.set(copy.id,copy);s.put(copy);return copy.id;},
   scenePlacementTools:{edits,start(_mode,complete){const target=prefix+s.activeGroupId;edits.begin(target);edits.preview({position:[4,2,1]});edits.commit();complete({commit:true});return true;}}};
  vm.createContext(c);vm.runInContext(['sceneSelectionMembers','groupEditState','ensureGroupTarget','writeGroupPose','duplicateSceneGroup','duplicateSelectedSceneObjects'].map(fn).join('\n'),c);
  edits.register('@selection-membership',{read,check:x=>x,write:restore});for(const group of s.groups)c.ensureGroupTarget(group);
  edits.apply('@group:machine',{position:[1,0,0]},'Earlier move');const before=read(),count=edits.state().undoCount;
  const copiedId=c.duplicateSceneGroup('machine',{interactive:true}),accepted=read();
  assert.equal(edits.state().undoCount,count+1,'placement must be absorbed into the duplicate operation');
  assert.deepEqual(s.groups.find(g=>g.id===copiedId).transform.position,[4,2,1]);
  assert.equal(s.groups.filter(g=>g.parentId===copiedId).length,2);
  await edits.undo();assert.deepEqual(read(),before);
  await edits.undo();assert.equal(edits.state().undoCount,0);assert.deepEqual(s.find('arm').object.position.toArray(),[0,0,0]);
  await edits.redo();assert.deepEqual(read(),before);
  await edits.redo();assert.deepEqual(read(),accepted);assert.equal(s.find('arm').groupId,'boom');
 }
});
