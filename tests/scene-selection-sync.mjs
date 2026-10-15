// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n}',start)+2);};
function pointerContext(){const c={FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',vantageCaptureHeld:false,performance:{now:()=>100},viewportSuppressedClick:null,viewportPointerDown:null,transformGizmoDragging:false,transformControls:{dragging:false,axis:null},viewportEventHitsInteractiveOverlay:()=>false,viewportEventIsInsideCanvas:()=>true,greenroomPreviewIsActive:()=>false,pickFlameDomainFromViewportPointer:()=>false,pickWaterDomainFromViewportPointer:()=>false,pickSceneObjectFromViewportPointer:()=>({id:'source'}),selection:false,cleared:false,setActiveSceneObject(id,{extend}){c.selection=extend?!c.selection:true;},clearActiveSceneObjectSelection(){c.cleared=true;},setInfo(){},window:{_kaminosDirty(){}}};vm.createContext(c);vm.runInContext(grab('handleViewportPointerDown')+grab('handleViewportSelectionClick'),c);return c;}
test('a pointer release followed by its click toggles Shift selection once',()=>{const c=pointerContext(),event={button:0,clientX:50,clientY:20,pointerId:1,shiftKey:true};c.handleViewportPointerDown(event);c.handleViewportSelectionClick({...event,type:'pointerup'});c.handleViewportSelectionClick({...event,type:'click'});assert.equal(c.selection,true);});
test('releasing a gizmo retains the edited selection instead of picking through it',()=>{const c=pointerContext(),event={button:0,clientX:50,clientY:20,pointerId:1};c.transformControls.dragging=true;c.handleViewportPointerDown(event);c.transformControls.dragging=false;c.handleViewportSelectionClick({...event,type:'pointerup'});c.handleViewportSelectionClick({...event,type:'click'});assert.equal(c.selection,false);assert.equal(c.cleared,false);});
test('ordinary object selection routes a simulation ID to its field inspector',()=>{const c={sceneObjects:[],window:{selectSceneField:id=>c.field=id},clearActiveSceneObjectSelection:()=>{c.cleared=true;}};vm.createContext(c);vm.runInContext(grab('setActiveSceneObject'),c);for(const id of ['flame-field','water-field']){c.setActiveSceneObject(id);assert.equal(c.field,id);assert.equal(c.cleared,undefined);}});
test('selected simulation bounds use the active highlight and revert when deselected',()=>{const guide=new THREE.Box3Helper(new THREE.Box3());const c={THREE,scene:{},activeSceneComposition:{},flameDomainGuide:guide,selectionCaptureSuspended:false,viewportHelpersVisible:true,viewportDisplay:{domains:true,domainWidth:1,domainOpacity:.82},activeSceneFieldId:'flame-field',flameDomainDraft:null,flameDomainProxy:null,acceptedFlameDomainPose:()=>({position:[0,1,0],scale:[1,1,1]}),domainTransformForPose:()=>({translation:[0,0,0],scale:1}),document:{getElementById:()=>null},window:{},styleHelperLines:(root,style)=>{c.style=style;}};vm.createContext(c);const helper=html.includes('function styleSimulationDomainGuide(')?grab('styleSimulationDomainGuide'):'';vm.runInContext(helper+grab('flameDomainTopY')+grab('refreshFlameDomainPreview'),c);c.refreshFlameDomainPreview();assert.equal(guide.material.color.getHex(),0xffc66d);assert.ok(c.style.width>1);c.activeSceneFieldId=null;c.refreshFlameDomainPreview();assert.equal(guide.material.color.getHex(),0x5bd8f5);assert.equal(c.style.width,1);});
test('selected emitter bounds are visible without enabling bounds for every object',()=>{const object=new THREE.Group();object.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));const c={THREE,scene:new THREE.Scene(),sceneObjects:[{id:'source',type:'flame-emitter',object}],sceneSelectionMembers:()=>['source'],activeSceneObjectId:'source',activeSceneGroupId:null,activeSceneFieldId:null,sceneGroups:[],selectionBoxes:new Map(),selectionFeedback:null,selectionCaptureSuspended:false,viewportBoundsVisible:false,viewportHelpersVisible:true,viewportDisplay:{overlays:true,outlines:true,outlineWidth:1.5,outlineOpacity:1,emitters:true},renderer:null,FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',CAMERA_TYPE:'camera',syncSceneHelperVisibility(){},styleHelperLines(){},flameDomainGuide:null,localLiquidDomainGuide:null};vm.createContext(c);vm.runInContext(grab('updateSelectionFeedback'),c);c.updateSelectionFeedback();assert.equal(c.selectionBoxes.get('source').visible,true);c.selectionCaptureSuspended=true;c.updateSelectionFeedback();assert.equal(c.selectionBoxes.get('source').visible,false);});

test('field selection reports the same identity as its properties and accepts the shared setter',()=>{
 const c={structuredClone,sceneSelection:{ids:[],activeId:null},activeSceneFieldId:'flame-field',sceneSelectionMembers:()=>[],transformPreferences:{orientation:'world',pivot:'median'},window:{selectSceneField(id){c.activeSceneFieldId=id;}}};
 vm.createContext(c);vm.runInContext(grab('readSceneSelection')+grab('setSceneSelection'),c);
 assert.equal(c.readSceneSelection().activeId,'flame-field');assert.deepEqual(Array.from(c.readSceneSelection().ids),['flame-field']);assert.equal(c.readSceneSelection().fieldId,'flame-field');
 c.setSceneSelection(['water-field']);assert.equal(c.readSceneSelection().activeId,'water-field');assert.throws(()=>c.setSceneSelection(['water-field','source']),/on its own/);
});
test('opening the Workbench properties retains the selected simulation context',()=>{
 const source=fs.readFileSync(new URL('../authoring-workspace.mjs',import.meta.url),'utf8'),a=source.indexOf('  function setWorkbenchInspector('),b=source.indexOf('  function setContext(',a);
 const c={mode:'workbench',document:{activeElement:null,body:{classList:{toggle(){}}}},byId:id=>id==='transform-inspector'?{hidden:true,dataset:{selectedFieldId:'flame-field'}}:{hidden:true},setInspectorActive(){},sceneTreeSlots:{setActive(){}},setContext(value){c.context=value;}};
 vm.createContext(c);vm.runInContext(source.slice(a,b),c);c.setWorkbenchInspector(true);assert.equal(c.context,'object');
});

test('an emitter symbol wins over a simulation edge crossing the same pixel',()=>{
 const c=pointerContext();c.FLAME_EMITTER_TYPE='flame-emitter';c.LOCAL_LIQUID_EMITTER_TYPE='local-liquid-emitter';c.pickSceneObjectFromViewportPointer=()=>({id:'source',type:'flame-emitter'});c.pickFlameDomainFromViewportPointer=()=>true;c.window.selectSceneField=()=>{c.fieldPicked=true;};
 c.handleViewportSelectionClick({button:0,type:'click',clientX:50,clientY:20});assert.equal(c.selection,true);assert.equal(c.fieldPicked,undefined);
});

import * as framing from '../scene-frame-selected.mjs';
test('Frame selected fits the simulation bounds rather than an ignored helper origin',()=>{
 for(const field of ['flame-field','water-field']){
  const guide=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-3,-1,-3),new THREE.Vector3(3,3,3)));guide.userData.kaminosEditorHelper=true;
  const camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(4,3,6);const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld(true);}};
  const c={THREE,activeSceneFieldId:field,flameDomainGuide:guide,localLiquidDomainGuide:guide,frameObjects:framing.frameObjects,frameBox:framing.frameBox,camera,controls,sceneSelection:{ids:[]},selectedSceneGroupEntry:()=>null,selectedSceneObjectEntry:()=>null,frameSceneObjectRecord:()=>false};
  vm.createContext(c);vm.runInContext(grab('frameAuthoredSelection'),c);assert.equal(c.frameAuthoredSelection(),true,field+' must frame its full solver box');assert.deepEqual(controls.target.toArray(),[0,1,0]);
 }
});

test('an orbit drag and its click cannot clear or replace the existing selection',()=>{const c=pointerContext();c.selection=true;const event={button:0,clientX:50,clientY:20,pointerId:1};c.handleViewportPointerDown(event);c.handleViewportSelectionClick({...event,type:'pointerup',clientX:80});c.handleViewportSelectionClick({...event,type:'click',clientX:80});assert.equal(c.selection,true);assert.equal(c.cleared,false);});
