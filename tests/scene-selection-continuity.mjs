// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {checkedSelection,changeSelection} from '../scene-selection.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const a=html.indexOf(`function ${name}(`);assert.ok(a>=0,`missing ${name}`);return html.slice(a,html.indexOf('\n}',a)+2);};
function context(){
 const c={structuredClone,checkedSelection,changeSelection,sceneObjects:[{id:'mesh',object:{}},{id:'source',object:{}}],sceneGroups:[],sceneSelection:{ids:['mesh'],activeId:'mesh'},activeSceneObjectId:'mesh',activeSceneGroupId:null,activeSceneFieldId:null,currentMesh:{},activeSceneComposition:{},localLiquidSetup:{},burnerGraphWriting:false,transformControls:null,sceneSelectionHistory:null,selectionHistory:null,splatCorrectionMode:null,
  updateSelectionFeedback(){},renderSceneObjectList(){},updateTransformInspector(){},refreshFlameDomainPreview(){},flameDomainEditObject:()=>({}),authoringWorkspace:{setContext(){}},setInfo(){},document:{getElementById:()=>({classList:{remove(){}}})},transformPreferences:{orientation:'world'},
  selectedSceneObjectEntry:()=>c.sceneObjects.find(o=>o.id===c.activeSceneObjectId),selectedSceneGroupEntry:()=>null,selectionTransformProxy:()=>({}),sceneSelectionMembers:()=>c.sceneSelection.ids.filter(id=>!id.endsWith('-field')),window:{_kaminosDirty(){}}
 };
 c.scenePlacementTools={selectionChanged(){},edits:createSceneEdits({read(){},write(){}})};
 vm.createContext(c);
 for(const name of ['setSceneSelection','readSceneSelection','setActiveSceneObject','clearActiveSceneObjectSelection'])vm.runInContext(grab(name),c);
 const a=html.indexOf('window.selectSceneObject = function'),b=html.indexOf('\n};',a)+3;vm.runInContext(html.slice(a,b),c);
 if(html.includes('function setActiveSceneField('))vm.runInContext(grab('setActiveSceneField'),c);
 else {const a=html.indexOf('window.selectSceneField=function'),b=html.indexOf('\n};',a)+3;vm.runInContext(html.slice(a,b),c);}
 return c;
}
test('a simulation and a mesh share one selection with the latest active inspector',()=>{
 const c=context();c.setSceneSelection(['flame-field','mesh'],'mesh');assert.deepEqual(Array.from(c.readSceneSelection().ids),['flame-field','mesh']);assert.equal(c.activeSceneObjectId,'mesh');assert.equal(c.activeSceneFieldId,null);
 c.setSceneSelection(['mesh','water-field'],'water-field');assert.deepEqual(Array.from(c.readSceneSelection().ids),['mesh','water-field']);assert.equal(c.activeSceneFieldId,'water-field');assert.equal(c.activeSceneObjectId,null);
});
test('a user selection enters shared chronological history and restores via Undo and Redo',async()=>{
 const c=context();
 // Wire the production installer if present; baseline still exercises its actual user entry.
 if(html.includes('function setupSelectionHistory('))vm.runInContext(grab('setupSelectionHistory'),c),c.setupSelectionHistory();
 c.window.selectSceneObject('source');assert.equal(c.readSceneSelection().activeId,'source');
 assert.equal(c.scenePlacementTools.edits.state().undoCount,1,'selecting an object must create one shared history entry');
 await c.scenePlacementTools.edits.undo();assert.equal(c.readSceneSelection().activeId,'mesh');
 await c.scenePlacementTools.edits.redo();assert.equal(c.readSceneSelection().activeId,'source');assert.equal(c.scenePlacementTools.edits.state().undoCount,1,'replay cannot recursively add selection history');
 c.window.selectSceneObject('source');assert.equal(c.scenePlacementTools.edits.state().undoCount,1,'reselecting an identical target adds no noise');
});
test('a mesh overlapping a domain edge wins an ordinary viewport click',()=>{
 let picked=null;const c={polyEdit:null,vantageCaptureHeld:false,viewportEventHitsInteractiveOverlay:()=>false,viewportEventIsInsideCanvas:()=>true,viewportSuppressedClick:null,viewportPointerDown:null,greenroomPreviewIsActive:()=>false,transformGizmoDragging:false,transformControls:null,pickSceneObjectFromViewportPointer:()=>({id:'mesh',type:'glb'}),pickFlameDomainFromViewportPointer:()=>true,pickWaterDomainFromViewportPointer:()=>false,FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',setActiveSceneObject:id=>picked=id,clearActiveSceneObjectSelection(){},setInfo(){},window:{selectSceneObject:id=>picked=id,selectSceneField:id=>picked=id,_kaminosDirty(){}}};vm.createContext(c);vm.runInContext(grab('handleViewportSelectionClick'),c);c.handleViewportSelectionClick({button:0,type:'click',clientX:20,clientY:30});assert.equal(picked,'mesh');
});
test('selection and authored edits undo in one chronology without changing poses on selection replay',()=>{
 const c=context();vm.runInContext(grab('setupSelectionHistory'),c);c.setupSelectionHistory();const edits=c.scenePlacementTools.edits;
 let pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};edits.register('@test-pose',{read:()=>pose,write:value=>{pose=value;}});
 c.window.selectSceneObject('source');edits.apply('@test-pose',{position:[2,0,0]},'Move source');c.window.selectSceneObject('mesh');
 edits.undo();assert.equal(c.readSceneSelection().activeId,'source');assert.deepEqual(pose.position,[2,0,0]);
 edits.undo();assert.deepEqual(pose.position,[0,0,0]);assert.equal(c.readSceneSelection().activeId,'source');
 edits.undo();assert.equal(c.readSceneSelection().activeId,'mesh');assert.equal(edits.state().undoCount,0);
 edits.redo();edits.redo();edits.redo();assert.equal(c.readSceneSelection().activeId,'mesh');assert.deepEqual(pose.position,[2,0,0]);
});
test('an absent requested target leaves no pending selection transaction or history entry',()=>{
 const c=context();vm.runInContext(grab('setupSelectionHistory'),c);c.setupSelectionHistory();
 assert.throws(()=>c.window.selectSceneObject('absent'),/absent/);assert.equal(c.scenePlacementTools.edits.state().active,null);assert.equal(c.scenePlacementTools.edits.state().undoCount,0);assert.equal(c.readSceneSelection().activeId,'mesh');
});
test('Select All keeps bulk object editing usable when visible simulation volumes are present',()=>{
 const c=context();Object.assign(c,{createSelectionTransformTarget:()=>({}),selectionRootState(){},applyAuthoredScenePose(){},checkSelectionRoot(){},readSelectionMembership(){},checkSelectionMembership(){},writeSelectionMembership(){},duplicateSelectedSceneObjects(){},removeSelectedSceneObjects(){},groupSelectedObjects(){},ungroupSelectedObjects(){},isSceneItemVisible:()=>true});
 vm.runInContext(grab('setupSelectionHistory')+grab('setupSelectionTransforms'),c);c.setupSelectionTransforms();c.window.kaminosSelection.all();assert.deepEqual(Array.from(c.readSceneSelection().ids),['mesh','source'],'A selects editable objects; fields join through explicit Shift selection');
});
