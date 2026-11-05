// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {planRingBurner,planBurnerBodyReplacement} from '../ring-burner.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {FLAME_EMITTER_SOURCE} from '../scene-flame-emitter.mjs';
import {assemblySelection,copyAssembly} from '../scene-assembly.mjs';
const pose={position:[1,2,3],rotation:[0,.3,0],scale:[2,2,2]};
const template={id:'existing-source',type:'flame-emitter',source:FLAME_EMITTER_SOURCE,transform:pose,emission:{domainId:'flame-field',settings:{'emitter-assay-family':{type:'select-one',value:'ribbon'},'volume-flow-rate':{type:'range',value:1.5}}}};
const mesh={kind:'mesh',source:'/api/read?root=generated-meshes&path=ring.glb',name:'ring.glb',label:'Gothic crown'};
const state={objects:[template],groups:[],selection:{ids:[template.id],activeId:template.id},liveIds:['live-experiment'],domain:[0,0,0]};
const options={groupId:'ring',bodyId:'housing',outletId:'outlet',template,pose,mesh};
test('ring creation owns independent body/outlet and preserves its existing neighbors',()=>{
 const before=structuredClone(state),next=planRingBurner(state,options);
 assert.deepEqual(state,before);assert.deepEqual(next.objects[0],template);assert.deepEqual(next.liveIds,state.liveIds);
 const group=next.groups[0],outlet=next.objects.find(o=>o.id==='outlet'),body=next.objects.find(o=>o.id==='housing');
 assert.deepEqual(group.assembly,{kind:'burner',roles:{housing:'body',outlet:'outlet'}});
 assert.deepEqual(next.selection,{ids:['@group:ring'],activeId:'@group:ring'});
 assert.equal(outlet.emission.settings['emitter-assay-family'].value,'ring');assert.equal(outlet.emission.settings['volume-flow-rate'].value,1.5);
 assert.equal(body.type,'glb');assert.equal(body.source,mesh.source);assert.equal(body.collision,undefined,'generated surface is not an inferred obstacle');
 assert.deepEqual(assemblySelection({ids:['housing'],activeId:'housing'},next.groups),next.selection);
 assert.deepEqual(copyAssembly(group,new Map([['housing','copy-body'],['outlet','copy-outlet']])),{kind:'burner',roles:{'copy-body':'body','copy-outlet':'outlet'}});
});
test('ring body has a procedural fallback and each additional ring gets its own source',()=>{
 const first=planRingBurner(state,{...options,mesh:null}),next=planRingBurner(first,{...options,groupId:'ring2',bodyId:'body2',outletId:'outlet2',mesh:null});
 assert.equal(first.objects.find(o=>o.id==='housing').geometry.kind,'annular');assert.equal(next.groups.length,2);
 assert.equal(next.objects.filter(o=>o.type==='flame-emitter').length,3);assert.equal(next.objects.find(o=>o.id==='outlet2').emission.settings['emitter-assay-family'].value,'ring');
});
test('body replacement keeps edited world pose, source settings, support members and assembly frame',()=>{
 const first=planRingBurner(state,options);first.objects.find(o=>o.id==='housing').transform.position=[4,5,6];
 const group=first.groups[0];group.objectIds.push('support');group.assembly.roles.support='collision';first.objects.push({id:'support',type:'glb',source:mesh.source,transform:pose});
 const next=planBurnerBodyReplacement(first,{groupId:'ring',oldBodyId:'housing',bodyId:'new-housing',mesh:{...mesh,source:'/api/read?root=generated-meshes&path=lance.glb'}});
 assert.deepEqual(next.objects.find(o=>o.id==='new-housing').transform.position,[4,5,6]);assert.deepEqual(next.objects.find(o=>o.id==='outlet'),first.objects.find(o=>o.id==='outlet'));
 assert.deepEqual(next.groups[0].transform,group.transform);assert.equal(next.groups[0].assembly.roles.support,'collision');assert.equal(next.groups[0].assembly.roles.housing,undefined);assert.equal(next.groups[0].assembly.roles['new-housing'],'body');assert.ok(!next.objects.some(o=>o.id==='housing'));
 const doc=buildSceneDocument({objects:next.objects,groups:next.groups,activeGroupId:'ring',composition:{schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}}}),restored=planSceneRestore(doc);
 assert.equal(restored.objects.find(o=>o.id==='new-housing').source,'/api/read?root=generated-meshes&path=lance.glb');assert.deepEqual(restored.groups[0].assembly,next.groups[0].assembly);
});
test('reusing the first mounted source is explicit and does not take a source from an existing assembly',()=>{
 const next=planRingBurner(state,{...options,outletId:template.id,reuseSource:true});assert.equal(next.objects.filter(o=>o.id===template.id).length,1);
 assert.throws(()=>planRingBurner({...state,groups:[{id:'other',objectIds:[template.id]}]},{...options,outletId:template.id,reuseSource:true}),/already.*group/i);
});
test('invalid or withheld body choices and identity collisions fail before changing membership',()=>{
 for(const mesh of [{...options.mesh,kind:'image'},{...options.mesh,source:''},{...options.mesh,visibility:{status:'withheld'}}])assert.throws(()=>planRingBurner(state,{...options,mesh}),/mesh|source|withheld/i);
 assert.throws(()=>planRingBurner(state,{...options,outletId:template.id}),/identity/i);
 const next=planRingBurner(state,options);assert.throws(()=>planBurnerBodyReplacement(next,{groupId:'ring',oldBodyId:'outlet',bodyId:'new',mesh}),/body/i);
});
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneMembershipBatch} from '../scene-membership-batch.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
test('production membership selects a new burner from either field and restores selection on Undo/Redo',async()=>{
 for(const field of ['flame-field','water-field']){
  const scene=createWorkingScene();scene.put({...structuredClone(template),object:{}});scene.select([field],field,['flame-field','water-field']);
  const edits=createSceneEdits({read:()=>null,write(){throw Error('wrong target');}}),serialize=({object,...row})=>structuredClone(row);
  const batch=createSceneMembershipBatch({scene,membership:{async reconstruct(record){return scene.put({...structuredClone(record),object:{}});}},
   detach:id=>scene.forget(id),records:{serialize,reloadable:()=>true,apply(){}},groups:{serialize:()=>structuredClone(scene.groups)},
   context:{capture:()=>({field:scene.activeFieldId})},select:(ids,id)=>scene.select(ids,id,['flame-field','water-field'])});batch.attachHistory(edits);
  await edits.applySettled('@selection-membership',planRingBurner(batch.capture(),options),'Add ring');assert.equal(scene.activeGroupId,'ring');
  await edits.undo();assert.equal(scene.activeFieldId,field);assert.equal(scene.groups.length,0);await edits.redo();assert.equal(scene.activeGroupId,'ring');
  scene.select([field],field,['flame-field','water-field']);
  await edits.applySettled('@selection-membership',planBurnerBodyReplacement(batch.capture(),{groupId:'ring',oldBodyId:'housing',bodyId:'changed',mesh}),'Change body');assert.equal(scene.activeGroupId,'ring');
  await edits.undo();assert.equal(scene.activeFieldId,field);assert.ok(scene.find('housing'));await edits.redo();assert.equal(scene.activeGroupId,'ring');assert.ok(scene.find('changed'));
 }
});

import fs from 'node:fs';import vm from 'node:vm';
import {FLAME_EMITTER_TYPE} from '../scene-flame-emitter.mjs';
const settings={'volume-flow-rate':{type:'range',value:1}};
test('an existing empty fire field can receive a new ring using its source template',async()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('async function addRingBurner('),b=html.indexOf('async function setBurnerBody(',a);let n=0,applied;
 const workingScene={activeGroupId:null};const context={assertSceneConstructionAvailable(){},activeSceneComposition:{},sceneComponents:null,requirePluralFlameSourceRuntime(){},primaryAuthoredFlameSource:()=>null,serializeSceneObject:v=>v,readVolumeSettingsValues:()=>({domControls:settings}),fireControlOwner:()=> 'source',FIRE_DOMAIN_ID:'flame-field',FLAME_EMITTER_TYPE,FLAME_EMITTER_SOURCE,readSelectionMembership:()=>({objects:[],groups:[],selection:{ids:[],activeId:null}}),planRingBurner,makeSceneObjectId:p=>p+ ++n,flameEmitterPose:pose,workingScene,scenePlacementTools:{edits:{async applySettled(_id,value){applied=value;workingScene.activeGroupId=value.groups[0].id;}}}};
 vm.createContext(context);vm.runInContext(html.slice(a,b)+'\nthis.create=addRingBurner',context);await context.create();assert.equal(applied.objects.find(o=>o.type===FLAME_EMITTER_TYPE).emission.settings['volume-flow-rate'].value,1);
});
test('replacing an explicit fire obstacle body retains its authored collision participation',()=>{
 const first=planRingBurner({objects:[],groups:[],selection:{ids:[],activeId:null}},{groupId:'ring',bodyId:'body',outletId:'outlet',template:{type:FLAME_EMITTER_TYPE,source:FLAME_EMITTER_SOURCE,emission:{domainId:'flame-field',settings}},pose});first.objects.find(o=>o.id==='body').collision={domainId:'flame-field',enabled:true};
 const next=planBurnerBodyReplacement(first,{groupId:'ring',oldBodyId:'body',bodyId:'new',mesh:{kind:'mesh',source:'/api/read?root=generated-meshes&path=other.glb'}});assert.deepEqual(next.objects.find(o=>o.id==='new').collision,{domainId:'flame-field',enabled:true});
});

import {createSceneComponentEdit} from '../scene-component-edit.mjs';
import {createAssemblyEditing} from '../scene-assembly.mjs';
import {checkedSelection} from '../scene-selection.mjs';
test('adding a ring from component Edit Mode settles insertion and supports Undo/Redo',async()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const grab=name=>{const a=html.indexOf('function '+name+'(');return html.slice(a,html.indexOf('\n}',a)+2);};
 const scene=createWorkingScene();let n=0,cancels=0,components,editing;
 const edits=createSceneEdits({read:()=>null,write(){throw Error('wrong target');}});
 const finish=()=>{if(!edits.state().active)return false;cancels++;edits.cancel();return true;};
 const context={window:{},structuredClone,checkedSelection,assemblySelection,workingScene:scene,activeSceneComposition:{},waterFeature:{setup:null},burnerGraphWriting:false,
  scenePlacementTools:{edits,selectionChanged:finish},currentMesh:null,selectedSceneGroupEntry:()=>scene.groups.find(g=>g.id===scene.activeGroupId),groupProxy:()=>({}),selectedSceneObjectEntry:()=>scene.find(scene.activeObjectId),
  renderSceneObjectList(){editing.sync();components.active();},updateTransformInspector(){},authoringWorkspace:null,transformControls:null,updateSelectionFeedback(){},
  assertSceneConstructionAvailable(){assert.equal(edits.state().active,null);},requirePluralFlameSourceRuntime(){},primaryAuthoredFlameSource:()=>scene.objects.find(o=>o.type===FLAME_EMITTER_TYPE),serializeSceneObject:({object,...row})=>structuredClone(row),
  readVolumeSettingsValues:()=>({domControls:settings}),fireControlOwner:()=> 'source',FIRE_DOMAIN_ID:'flame-field',FLAME_EMITTER_TYPE,FLAME_EMITTER_SOURCE,planRingBurner,planBurnerBodyReplacement,makeSceneObjectId:p=>p+ ++n,flameEmitterPose:pose};
 vm.createContext(context);vm.runInContext(grab('setSceneSelection')+'async '+grab('addRingBurner')+'async '+grab('setBurnerBody'),context);
 components=createSceneComponentEdit({selected:()=>scene.selection.activeId,cancel:finish,refresh(){editing.sync();components.active();}});
 editing=createAssemblyEditing({scene,components,select:context.setSceneSelection});context.sceneComponents=components;context.assemblyEditing=editing;
 const batch=createSceneMembershipBatch({scene,membership:{async reconstruct(record){return scene.put({...structuredClone(record),object:{}});}},detach:id=>scene.forget(id),
  records:{serialize:context.serializeSceneObject,reloadable:()=>true,apply(){}},groups:{serialize:()=>structuredClone(scene.groups)},select:(ids,id)=>context.setSceneSelection(ids,id,{fromHistory:true})});batch.attachHistory(edits);context.readSelectionMembership=batch.capture;
 const first=await context.addRingBurner();editing.enter(first);assert.equal(editing.read().mode,'edit');
 const second=await context.addRingBurner();assert.notEqual(second,first);assert.equal(scene.groups.length,2);assert.equal(scene.activeGroupId,second);assert.equal(cancels,0,'component retirement must precede insertion transaction');
 await edits.undo();assert.equal(scene.groups.length,1);assert.equal(scene.groups[0].id,first);await edits.redo();assert.equal(scene.groups.length,2);assert.equal(scene.activeGroupId,second);assert.equal(cancels,0);
 editing.enter(second);const outletId=scene.groups.find(g=>g.id===second).objectIds.find(id=>scene.find(id).type===FLAME_EMITTER_TYPE),outlet=structuredClone(context.serializeSceneObject(scene.find(outletId)));
 const replacement=await context.setBurnerBody(second,mesh);assert.ok(scene.find(replacement));assert.equal(scene.activeGroupId,second);assert.equal(cancels,0);assert.deepEqual(context.serializeSceneObject(scene.find(outletId)),outlet);
 await edits.undo();assert.ok(!scene.find(replacement));await edits.redo();assert.ok(scene.find(replacement));assert.equal(cancels,0);
});
