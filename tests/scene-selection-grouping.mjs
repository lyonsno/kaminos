import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {checkedSelection,changeSelection} from '../scene-selection.mjs';import {createSceneEdits} from '../scene-edit-session.mjs';
const html=readFileSync(process.env.KAMINOS_SELECTION_GROUP_SOURCE||new URL('../index.html',import.meta.url),'utf8');
function source(a,b){const start=html.indexOf(a),end=html.indexOf(b,start);assert.ok(start>=0&&end>start);return html.slice(start,end);}
test('a group membership write preserves the selection without cancelling its owned transaction',()=>{
 let selectionChanges=0;const context=vm.createContext({structuredClone,checkedSelection,changeSelection,
  sceneObjects:[{id:'a',object:{}},{id:'b',object:{}}],sceneGroups:[],sceneSelection:{ids:['a','b'],activeId:'b'},activeSceneObjectId:'b',activeSceneGroupId:null,activeSceneFieldId:null,
  burnerGraphWriting:false,splatCorrectionMode:null,currentMesh:null,transformControls:null,authoringWorkspace:null,groupProxies:new Map(),window:{_kaminosDirty(){}},
  selectedSceneObjectEntry:()=>context.sceneObjects.find(o=>o.id===context.activeSceneObjectId),selectedSceneGroupEntry:()=>null,groupProxy:()=>({}),selectionTransformProxy:()=>({}),
  renderSceneObjectList(){},updateTransformInspector(){},renderPipelineDock(){},updateSelectionFeedback(){},clearActiveSceneObjectSelection(){context.sceneSelection={ids:[],activeId:null};},
  sceneSelectionMembers:()=>[...context.sceneSelection.ids],checkedSceneGroups:value=>structuredClone(value),setSceneGroupsFromRecords:value=>{context.sceneGroups=structuredClone(value);},
  scenePlacementTools:{selectionChanged(){selectionChanges++;},edits:null}});
 vm.runInContext(source('function setSceneSelection(','function updateSelectionFeedback(')+source('function setActiveSceneObject(','function sceneObjectRecordForDescendant(')+source('function writeSceneGroups(','function editSceneGroups('),context);
 const edits=createSceneEdits({read:()=>null,write(){}});context.scenePlacementTools.edits=edits;
 edits.register('@scene-groups',{read:()=>({groups:context.sceneGroups}),check:value=>value,write:value=>context.writeSceneGroups(value.groups)});
 edits.apply('@scene-groups',{groups:[{id:'g',objectIds:['a','b']}]},'Group selected');
 assert.equal(selectionChanges,0,'an internal selection projection must not end the active group transaction');
 assert.deepEqual(Array.from(context.sceneSelection.ids),['a','b']);assert.equal(edits.state().undoCount,1);
 edits.undo();assert.equal(context.sceneGroups.length,0);assert.deepEqual(Array.from(context.sceneSelection.ids),['a','b']);
});
