// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {getSceneGroupRecords} from '../scene-persistence-core.js';
import {checkedAssembly,assemblySelection,createAssemblyEditing} from '../scene-assembly.mjs';
import {createSceneComponentEdit} from '../scene-component-edit.mjs';
import {createWorkingScene} from '../working-scene.mjs';
const assembly={kind:'burner',roles:{body:'body',outlet:'outlet',support:'collision'}};
const group={id:'burner',objectIds:['body','outlet','support'],assembly};
test('saved assembly roles survive the production scene parser, while ordinary groups stay ordinary',()=>{
 const [restored,ordinary]=getSceneGroupRecords({groups:[group,{id:'loose',objectIds:['other']}]},['body','outlet','support','other'].map(id=>({id})));
 assert.deepEqual(restored.assembly,assembly);assert.equal(ordinary.assembly,undefined);
});
test('Object Mode maps members once to their assembly, Edit Mode keeps their identities',()=>{
 assert.deepEqual(assemblySelection({ids:['body','outlet','other'],activeId:'outlet'},[group]),{ids:['@group:burner','other'],activeId:'@group:burner'});
 assert.deepEqual(assemblySelection({ids:['body','outlet'],activeId:'outlet'},[group],group),{ids:['body','outlet'],activeId:'outlet'});
 assert.throws(()=>checkedAssembly({kind:'burner',roles:{body:'bogus'}},['body']),/Unknown assembly role/);
 assert.deepEqual(checkedAssembly(assembly,['body','support']).roles,{body:'body',support:'collision'});
});
test('native assembly mode admits member multiselection, Tab returns owner, removal retires the mode',()=>{
 const scene=createWorkingScene();for(const id of group.objectIds)scene.put({id,object:{userData:{}}});scene.setGroups([group]);
 const components=createSceneComponentEdit({selected:()=>scene.selection.activeId,cancel(){},refresh(){}});
 const mode=createAssemblyEditing({scene,components,select:(ids,id)=>scene.select(ids,id)});mode.sync();scene.select(['@group:burner']);
 components.toggle('@group:burner');assert.equal(mode.scope().id,'burner');assert.equal(scene.selection.activeId,'body');
 scene.select(['outlet','support'],'support');assert.equal(components.active(),true);
 components.toggle('support');assert.deepEqual(scene.selection.ids,['@group:burner']);assert.equal(mode.scope(),null);
 mode.enter('burner');scene.setGroups([]);mode.sync();assert.equal(components.active(),false);assert.equal(mode.scope(),null);
});
test('selecting a different object exits assembly mode without stealing its selection',()=>{
 const scene=createWorkingScene();for(const id of [...group.objectIds,'other'])scene.put({id,object:{userData:{}}});scene.setGroups([group]);
 const components=createSceneComponentEdit({selected:()=>scene.selection.activeId,cancel(){},refresh(){}});
 const mode=createAssemblyEditing({scene,components,select:(ids,id)=>scene.select(ids,id)});mode.enter('burner');
 scene.select(['other']);assert.equal(components.active(),false);assert.deepEqual(scene.selection.ids,['other']);
});
