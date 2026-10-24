// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as T from 'three';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {exportCloneInWorld} from '../scene-export.mjs';import {checkedRepetition,createRepetitionView,withoutRepetitionCopies} from '../scene-repetition.mjs';
import {createWorkingScene} from '../working-scene.mjs';
import * as groupTopology from '../scene-group-topology.mjs';
import {selectionTransformRoots} from '../scene-selection.mjs';
import {canRepeatSceneObject,createSceneRepetitionController} from '../scene-repetition-controller.mjs';import {createSceneEdits,checkedPose} from '../scene-edit-session.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=name=>{const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);assert.ok(a>=0&&b>a);return html.slice(a,b);};
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},repetition=checkedRepetition({mode:'circle',count:6});

test('shared selection duplication preserves nested roles, repetition and cancellation',()=>{
 for(const interactive of [false,true]){
  const workingScene=createWorkingScene();workingScene.put({id:'baffle',type:'procedural-mesh',object:{userData:{}}});
  workingScene.setGroups([{id:'assembly',objectIds:[],transform:pose},{id:'ring',parentId:'assembly',label:'Baffle ring',objectIds:['baffle'],transform:pose,repetition}]);workingScene.select(['@group:assembly']);
  const before=()=>({groups:structuredClone(workingScene.groups),selection:structuredClone(workingScene.selection)});let nextId=0,completion,recorded=0;
  const h={...groupTopology,workingScene,structuredClone,checkedRepetition,compoundRetentionTargets:new Map(),assertSceneConstructionAvailable(){},selectedRootIds:()=>selectionTransformRoots(workingScene.selection.ids,workingScene.groups),canDuplicateObject:()=>true,checkSelectionMembership:x=>x,readSelectionMembership:before,
   duplicateSceneObject(id){const original=workingScene.find(id);workingScene.put({...original,id:'copy',object:{userData:{}}});workingScene.updateGroup(original.groupId,{objectIds:[id,'copy']});return 'copy';},
   makeSceneObjectId:()=> 'group-copy-'+(++nextId),ensureGroupTarget(){},setSceneSelection:(ids,id)=>workingScene.select(ids,id),detachSelectionMember:id=>workingScene.forget(id),releaseUnreferencedSceneMembershipObjects(){},
   scenePlacementTools:{start:(_mode,done)=>{completion=done;return true;},edits:{discard(){},recordApplied(){recorded++;}}}};
  sceneContext(h);vm.runInContext(fn('sceneSelectionMembers')+'\n'+fn('duplicateSelectedSceneObjects'),h);const result=h.duplicateSelectedSceneObjects({interactive});
  const outer=workingScene.groups.find(g=>'@group:'+g.id===result[0]),role=workingScene.groups.find(g=>g.parentId===outer.id);
  assert.deepEqual([...outer.objectIds],[]);assert.equal(role.repetition.count,6);assert.equal(role.repetition.mode,'circle');assert.deepEqual([...role.objectIds],['copy']);assert.equal(workingScene.find('baffle').groupId,'ring');assert.equal(workingScene.find('copy').groupId,role.id);
  if(interactive){completion({commit:false});assert.deepEqual(workingScene.groups.map(g=>g.id),['assembly','ring']);assert.equal(workingScene.find('copy'),undefined);assert.equal(workingScene.selection.activeId,'@group:assembly');assert.equal(recorded,0);}else assert.equal(recorded,1);
 }
});

test('ordinary attachment refuses an unsupported member before changing a repeated group or history',()=>{
 const groups=[{id:'ring',label:'Baffle ring',objectIds:['baffle'],transform:pose,repetition}],objects=[{id:'baffle',type:'procedural-mesh',object:new T.Mesh()},{id:'lamp',type:'light',object:new T.Group()}];
 const edits=createSceneEdits({read:()=>null,write(){}}),h={structuredClone,GROUP_TYPE:'group',sceneObjects:objects,checkedRepetition,canRepeatSceneObject,checkedGroupPose:checkedPose,assertSceneConstructionAvailable(){},serializeSceneGroups:()=>structuredClone(groups),scenePlacementTools:{edits}};
 sceneContext(h);vm.runInContext(fn('checkedSceneGroups')+'\n'+fn('editSceneGroups')+'\n'+fn('attachSceneObject'),h);
 edits.register('@scene-groups',{read:()=>({groups:structuredClone(groups)}),check:value=>({groups:h.checkedSceneGroups(value.groups)}),write:value=>groups.splice(0,groups.length,...value.groups)});
 assert.throws(()=>h.attachSceneObject('lamp','ring'),/static mesh/);assert.deepEqual(groups[0].objectIds,['baffle']);assert.equal(groups[0].repetition.count,6);assert.equal(edits.state().undoCount,0);
 h.attachSceneObject('baffle',null);assert.equal(groups.length,0,'ordinary editing still works after refusal');edits.undo();assert.equal(groups[0].repetition.count,6);
});

globalThis.FileReader??=class{finish(result){this.result=result;this.onload?.({target:this});this.onloadend?.({target:this});}readAsArrayBuffer(blob){blob.arrayBuffer().then(x=>this.finish(x));}readAsDataURL(blob){blob.arrayBuffer().then(x=>this.finish(`data:${blob.type||'application/octet-stream'};base64,${Buffer.from(x).toString('base64')}`));}};
test('exported GLB repetitions become complete source geometry for another repetition',async()=>{
 const root=new T.Group();root.add(new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()));const view=createRepetitionView(),line={mode:'line',count:3,step:[2,0,0]};view.sync(root,line,pose);
 const glb=await new GLTFExporter().parseAsync(exportCloneInWorld(root),{binary:true}),loaded=(await new GLTFLoader().parseAsync(glb,'')).scene;
 const count=object=>{let n=0;object.traverse(o=>{if(o.isMesh)n++;});return n;};assert.equal(count(loaded),3);
 let markers=0;loaded.traverse(o=>{if(o.userData.kaminosRepetitionCopy)markers++;});assert.equal(markers,0,'exported pieces have ordinary asset identity');
 view.sync(loaded,line,pose);assert.equal(count(loaded),9,'all three imported pieces appear in each new placement');
 assert.equal(withoutRepetitionCopies(loaded,()=>count(loaded)),3,'source topology includes every baked piece');assert.equal(root.children.filter(o=>o.userData.kaminosRepetitionCopy).length,2,'export leaves the live source relationship intact');
});

// Real owner + repetition controller + history; persistence/mounting is a small
// in-memory adapter here. The browser exercise covers the page's full restore.
function realGroupConsumer(settings=null){
 const workingScene=createWorkingScene(),roots=new Map(),edits=createSceneEdits({read:()=>null,write(){}});
 const readPose=object=>({position:object.position.toArray(),rotation:[object.rotation.x,object.rotation.y,object.rotation.z],scale:object.scale.toArray()});
 const root=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());root.userData.kaminosSceneObject={};
 const entry={id:'baffle',type:'procedural-mesh',object:root,repetition:null};workingScene.put(entry);roots.set(entry.id,entry);
 workingScene.setGroups([{id:'ring',label:'Baffle ring',objectIds:['baffle'],transform:pose,repetition:settings}]);
 workingScene.select(['@group:ring']);
 const controller=createSceneRepetitionController({objects:()=>workingScene.objects,groups:()=>workingScene.groups,readPose});
 const read=()=>({objects:workingScene.objects.map(e=>({id:e.id,repetition:structuredClone(e.repetition),pose:readPose(e.object)})),groups:structuredClone(workingScene.groups),selection:structuredClone(workingScene.selection)});
 const restore=value=>{workingScene.replaceObjects(value.objects.map(row=>{const e=roots.get(row.id);e.repetition=structuredClone(row.repetition);e.object.position.fromArray(row.pose.position);return e;}));workingScene.setGroups(value.groups);workingScene.select(value.selection.ids,value.selection.activeId);controller.sync();};
 const h=vm.createContext({...groupTopology,THREE:T,workingScene,checkedRepetition,canRepeatSceneObject,sceneObjectTransformState:readPose,
  sceneRepetitionController:controller,sceneRepetitionInspector:null,repetitionEditTargets:new Set(),polyEdit:null,scenePlacementTools:{edits},
  compoundRetentionTargets:new Map(),window:{},assertSceneConstructionAvailable(){},updateSelectionFeedback(){},setInfo(){},
  readSelectionMembership:read,checkSelectionMembership:value=>value,writeSelectionMembership:restore,
  setSceneSelection:(ids,id)=>workingScene.select(ids,id),
  duplicateSceneObject(id){const original=workingScene.find(id),object=withoutRepetitionCopies(original.object,()=>original.object.clone());const e={...original,id:'copy-'+roots.size,object,repetition:null};roots.set(e.id,e);workingScene.put(e);workingScene.updateGroup('ring',{objectIds:[...workingScene.groups[0].objectIds,e.id]});return e.id;},
  applyAuthoredScenePose(id,value){const o=workingScene.find(id).object;o.position.fromArray(value.position);o.rotation.set(...value.rotation);o.scale.fromArray(value.scale);}
 });
 edits.register('@selection-membership',{read,check:value=>value,write:restore});
 vm.runInContext('"use strict";'+['repetitionOwner','writeSceneRepetition','ensureRepetitionTarget','setSceneRepetition'].map(fn).join('\n')+'\nasync '+fn('makeSceneRepetitionReal'),h);
 return {h,workingScene,edits,controller};
}

test('group repetition create, change and clear use owner updates and preserve history',async()=>{
 const {h,workingScene,edits,controller}=realGroupConsumer();
 const count=()=>workingScene.groups[0].repetition?.count??null;
 h.setSceneRepetition('@group:ring',{mode:'line',count:2,step:[2,0,0]});assert.equal(count(),2);
 h.setSceneRepetition('@group:ring',{mode:'line',count:3,step:[2,0,0]});assert.equal(count(),3);
 h.setSceneRepetition('@group:ring',null);assert.equal(count(),null);
 for(const value of [3,2,null]){await edits.undo();assert.equal(count(),value);}
 for(const value of [2,3,null]){await edits.redo();assert.equal(count(),value);}
 assert.equal(Object.isFrozen(workingScene.groups[0]),true);controller.clearAll();
});

test('making repeated group copies editable preserves group topology through Undo and Redo',async()=>{
 const {h,workingScene,edits,controller}=realGroupConsumer(checkedRepetition({mode:'line',count:3,step:[2,0,0]}));
 const original=workingScene.find('baffle').object;
 const copies=await h.makeSceneRepetitionReal('@group:ring');
 assert.equal(copies.length,2);assert.equal(workingScene.groups[0].repetition,null);assert.equal(workingScene.objects.length,3);
 assert.deepEqual(workingScene.objects.map(e=>e.object.position.x),[0,2,4]);
 assert.deepEqual(workingScene.groups[0].objectIds,['baffle',...copies]);assert.equal(edits.state().undoCount,1);
 await edits.undo();assert.equal(workingScene.objects.length,1);assert.equal(workingScene.find('baffle').object,original);assert.equal(workingScene.groups[0].repetition.count,3);
 await edits.redo();assert.equal(workingScene.objects.length,3);assert.equal(workingScene.groups[0].repetition,null);assert.deepEqual(workingScene.groups[0].objectIds,['baffle',...copies]);controller.clearAll();
});

test('baking a nested role refuses an inherited array before changing the assembly',async()=>{
 const {h,workingScene,edits,controller}=realGroupConsumer();
 workingScene.setGroups([{id:'assembly',objectIds:[],transform:pose,repetition:checkedRepetition({mode:'line',count:2,step:[3,0,0]})},...workingScene.groups.map(g=>({...g,parentId:'assembly'}))]);
 const before=JSON.stringify(workingScene.groups);await assert.rejects(h.makeSceneRepetitionReal('@group:ring'),/parent group/);
 assert.equal(JSON.stringify(workingScene.groups),before);assert.equal(workingScene.objects.length,1);assert.equal(edits.state().undoCount,0);controller.clearAll();
});
