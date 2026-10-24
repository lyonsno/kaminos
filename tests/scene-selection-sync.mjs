// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {checkedSelection,changeSelection} from '../scene-selection.mjs';
import {installPolyEditMode} from '../poly-edit-host.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n}',start)+2);};
function pointerContext(){const c={polyEdit:null,FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',vantageCaptureHeld:false,performance:{now:()=>100},viewportSuppressedClick:null,viewportPointerDown:null,transformGizmoDragging:false,transformControls:{dragging:false,axis:null},viewportEventHitsInteractiveOverlay:()=>false,viewportEventIsInsideCanvas:()=>true,greenroomPreviewIsActive:()=>false,pickFlameDomainFromViewportPointer:()=>false,pickWaterDomainFromViewportPointer:()=>false,sceneHitsFromViewportPointer:()=>[],pickVisibleFlameFromViewportPointer:()=>null,pickSceneObjectFromViewportPointer:()=>({id:'source'}),selection:false,cleared:false,setActiveSceneObject(id,{extend}){c.selection=extend?!c.selection:true;},clearActiveSceneObjectSelection(){c.cleared=true;},setInfo(){},window:{_kaminosDirty(){}}};c.window.selectSceneObject=(id,options)=>c.setActiveSceneObject(id,options);c.window.kaminosSelection={clear:()=>c.clearActiveSceneObjectSelection()};sceneContext(c);vm.runInContext(grab('handleViewportPointerDown')+grab('handleViewportSelectionClick'),c);return c;}
test('a pointer release followed by its click toggles Shift selection once',()=>{const c=pointerContext(),event={button:0,clientX:50,clientY:20,pointerId:1,shiftKey:true};c.handleViewportPointerDown(event);c.handleViewportSelectionClick({...event,type:'pointerup'});c.handleViewportSelectionClick({...event,type:'click'});assert.equal(c.selection,true);});
test('releasing a gizmo retains the edited selection instead of picking through it',()=>{const c=pointerContext(),event={button:0,clientX:50,clientY:20,pointerId:1};c.transformControls.dragging=true;c.handleViewportPointerDown(event);c.transformControls.dragging=false;c.handleViewportSelectionClick({...event,type:'pointerup'});c.handleViewportSelectionClick({...event,type:'click'});assert.equal(c.selection,false);assert.equal(c.cleared,false);});
test('ordinary object selection routes a simulation ID to its field inspector',()=>{const c=selectionTargetContext();vm.runInContext(grab('setActiveSceneObject'),c);for(const id of ['flame-field','water-field']){c.setActiveSceneObject(id);assert.equal(c.activeSceneFieldId,id);}});
test('selected simulation bounds use the active highlight and revert when deselected',()=>{const guide=new THREE.Box3Helper(new THREE.Box3());const c={THREE,scene:{},activeSceneComposition:{},flameDomainGuide:guide,selectionCaptureSuspended:false,viewportHelpersVisible:true,viewportDisplay:{domains:true,domainWidth:1,domainOpacity:.82},activeSceneFieldId:'flame-field',sceneSelection:{ids:['flame-field'],activeId:'flame-field'},flameDomainDraft:null,flameDomainProxy:null,acceptedFlameDomainPose:()=>({position:[0,1,0],scale:[1,1,1]}),domainTransformForPose:()=>({translation:[0,0,0],scale:1}),document:{getElementById:()=>null},window:{},styleHelperLines:(root,style)=>{c.style=style;}};sceneContext(c);const helper=html.includes('function styleSimulationDomainGuide(')?grab('styleSimulationDomainGuide'):'';vm.runInContext(helper+grab('flameDomainTopY')+grab('refreshFlameDomainPreview'),c);c.isSceneItemVisible??=()=>true;c.refreshFlameDomainPreview();assert.equal(guide.material.color.getHex(),0xffc66d);assert.ok(c.style.width>1);c.activeSceneFieldId=null;c.sceneSelection={ids:[],activeId:null};c.isSceneItemVisible??=()=>true;c.refreshFlameDomainPreview();assert.equal(guide.material.color.getHex(),0x5bd8f5);assert.equal(c.style.width,1);});
test('selected emitter bounds are visible without enabling bounds for every object',()=>{const object=new THREE.Group();object.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));const c={THREE,scene:new THREE.Scene(),sceneObjects:[{id:'source',type:'flame-emitter',object}],sceneSelectionMembers:()=>['source'],activeSceneObjectId:'source',activeSceneGroupId:null,activeSceneFieldId:null,sceneGroups:[],selectionBoxes:new Map(),selectionFeedback:null,selectionCaptureSuspended:false,viewportBoundsVisible:false,viewportHelpersVisible:true,viewportDisplay:{overlays:true,outlines:true,outlineWidth:1.5,outlineOpacity:1,emitters:true},renderer:null,FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',CAMERA_TYPE:'camera',syncSceneHelperVisibility(){},styleHelperLines(){},flameDomainGuide:null,localLiquidDomainGuide:null};sceneContext(c);c.isSceneItemVisible=()=>true;vm.runInContext(grab('updateSelectionFeedback'),c);c.updateSelectionFeedback();assert.equal(c.selectionBoxes.get('source').visible,true);c.selectionCaptureSuspended=true;c.updateSelectionFeedback();assert.equal(c.selectionBoxes.get('source').visible,false);});

test('field selection reports the same identity as its properties and accepts the shared setter',()=>{
 const c=selectionTargetContext();vm.runInContext(grab('readSceneSelection'),c);
 c.setSceneSelection(['flame-field']);assert.equal(c.readSceneSelection().activeId,'flame-field');assert.deepEqual(Array.from(c.readSceneSelection().ids),['flame-field']);assert.equal(c.readSceneSelection().fieldId,'flame-field');
 c.setSceneSelection(['water-field']);assert.equal(c.readSceneSelection().activeId,'water-field');assert.throws(()=>c.setSceneSelection(['absent']),/absent/);
});
test('opening the Workbench properties retains the selected simulation context',()=>{
 const source=fs.readFileSync(new URL('../authoring-workspace.mjs',import.meta.url),'utf8'),a=source.indexOf('  function setWorkbenchInspector('),b=source.indexOf('  function setContext(',a);
 const c={mode:'workbench',document:{activeElement:null,body:{classList:{toggle(){}}}},byId:id=>id==='transform-inspector'?{hidden:true,dataset:{selectedFieldId:'flame-field'}}:{hidden:true},setInspectorActive(){},sceneTreeSlots:{setActive(){}},setContext(value){c.context=value;}};
 sceneContext(c);vm.runInContext(source.slice(a,b),c);c.setWorkbenchInspector(true);assert.equal(c.context,'object');
});

test('an emitter symbol wins over a simulation edge crossing the same pixel',()=>{
 const c=pointerContext();c.FLAME_EMITTER_TYPE='flame-emitter';c.LOCAL_LIQUID_EMITTER_TYPE='local-liquid-emitter';c.pickSceneObjectFromViewportPointer=()=>({id:'source',type:'flame-emitter'});c.pickFlameDomainFromViewportPointer=()=>true;c.window.selectSceneField=()=>{c.fieldPicked=true;};
 c.handleViewportSelectionClick({button:0,type:'click',clientX:50,clientY:20});assert.equal(c.selection,true);assert.equal(c.fieldPicked,undefined);
});

import * as framing from '../scene-frame-selected.mjs';
test('Frame selected fits the simulation bounds rather than an ignored helper origin',()=>{
 for(const field of ['flame-field','water-field']){
  const guide=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-2,-1,3),new THREE.Vector3(4,3,9)));guide.userData.kaminosEditorHelper=true;
  const camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(4,3,6);const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld(true);}};
  const c={THREE,activeSceneFieldId:field,flameDomainGuide:guide,localLiquidDomainGuide:guide,frameObjects:framing.frameObjects,frameBox:framing.frameBox,camera,controls,sceneSelection:{ids:[]},selectedSceneGroupEntry:()=>null,selectedSceneObjectEntry:()=>null,frameSceneObjectRecord:()=>false};
  sceneContext(c);vm.runInContext(grab('frameAuthoredSelection'),c);assert.equal(c.frameAuthoredSelection(),true,field+' must frame its full solver box');assert.deepEqual(controls.target.toArray(),[1,1,6]);for(const x of [-2,4])for(const y of [-1,3])for(const z of [3,9]){const point=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1&&Math.abs(point.z)<1,'every solver-box corner fits the viewport');}
 }
});

test('an orbit drag and its click cannot clear or replace the existing selection',()=>{const c=pointerContext();c.selection=true;const event={button:0,clientX:50,clientY:20,pointerId:1};c.handleViewportPointerDown(event);c.handleViewportSelectionClick({...event,type:'pointerup',clientX:80});c.handleViewportSelectionClick({...event,type:'click',clientX:80});assert.equal(c.selection,true);assert.equal(c.cleared,false);});

test('ordinary selection keeps the field status label rather than overwriting it with a null mesh ID',()=>{
 const a=html.indexOf('window.selectSceneObject = function'),b=html.indexOf('\n};',a)+3;
 const c={changeSelection,sceneSelection:{ids:[],activeId:null},sceneSelectionHistory:null,window:{},sceneObjects:[],activeSceneObjectId:null,activeSceneFieldId:null,currentMesh:null,setActiveSceneObject(id){c.activeSceneFieldId=id;c.currentMesh={};c.status='Selected: Fire & smoke domain';},setInfo(value){c.status=value;}};
 sceneContext(c);vm.runInContext(html.slice(a,b),c);c.window.selectSceneObject('flame-field');assert.equal(c.status,'Selected: Fire & smoke domain');
});

// Current-main polygon editing must keep component input away from object picking.
test('Edit Mode owns viewport down, release and click without changing object or field selection',()=>{
 const c=pointerContext();c.polyEdit={active:()=>true};c.selection=true;c.pickFlameDomainFromViewportPointer=()=>{throw Error('object-mode domain picker ran');};c.pickSceneObjectFromViewportPointer=()=>{throw Error('object-mode source picker ran');};
 const event={button:0,clientX:50,clientY:20,pointerId:1};c.handleViewportPointerDown(event);c.handleViewportSelectionClick({...event,type:'pointerup'});c.handleViewportSelectionClick({...event,type:'click'});
 assert.equal(c.viewportPointerDown,null);assert.equal(c.selection,true);assert.equal(c.cleared,false);
});

function selectionTargetContext(){
 const c={structuredClone,checkedSelection,changeSelection,sceneSelectionHistory:null,transformPreferences:{orientation:'world'},sceneObjects:[{id:'mesh',object:{}},{id:'source',object:{}}],sceneGroups:[],sceneSelection:{ids:['mesh'],activeId:'mesh'},activeSceneObjectId:'mesh',activeSceneGroupId:null,activeSceneFieldId:null,currentMesh:{},activeSceneComposition:{},localLiquidSetup:{},burnerGraphWriting:false,transformControls:null,
  editing:true,exits:0,splatCorrectionMode:null,scenePlacementTools:{selectionChanged(){}},updateSelectionFeedback(){},renderSceneObjectList(){},updateTransformInspector(){},refreshFlameDomainPreview(){},flameDomainEditObject:()=>({}),authoringWorkspace:{setContext(){}},setInfo(){},document:{getElementById:()=>({classList:{remove(){}}})},
  selectedSceneObjectEntry:()=>c.sceneObjects.find(o=>o.id===c.activeSceneObjectId),sceneSelectionMembers:()=>c.sceneSelection.ids.filter(id=>!id.endsWith('-field')),window:{_kaminosDirty(){}}
 };
 c.window.kaminosPolyEdit={active:()=>c.editing,read:()=>({objectId:'mesh'}),exit(){c.editing=false;c.exits++;}};
 sceneContext(c);vm.runInContext(grab('setSceneSelection')+grab('clearActiveSceneObjectSelection'),c);
 const a=html.indexOf('window.selectSceneField=function'),b=html.indexOf('\n};',a)+3;vm.runInContext(html.slice(a,b),c);
 return c;
}
test('selecting a field leaves component editing before changing the inspector target',()=>{
 for(const field of ['water-field','flame-field']){const c=selectionTargetContext();c.window.selectSceneField(field);assert.equal(c.activeSceneFieldId,field);assert.equal(c.editing,false);assert.equal(c.exits,1);}
});
test('object selection preserves Edit Mode only for the same sole object',()=>{
 const c=selectionTargetContext();c.setSceneSelection(['mesh']);assert.equal(c.editing,true);assert.equal(c.exits,0);
 c.setSceneSelection(['source']);assert.equal(c.editing,false);assert.equal(c.exits,1);assert.equal(c.activeSceneObjectId,'source');
});
test('clearing the authored target also leaves its component editing mode',()=>{
 const c=selectionTargetContext();c.clearActiveSceneObjectSelection();assert.equal(c.editing,false);assert.equal(c.exits,1);assert.equal(c.activeSceneObjectId,null);
});


test('same-object reselection keeps the installed component host in sole control of the gizmo',()=>{
 const c=selectionTargetContext(),object=new THREE.Group();object.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));object.updateMatrixWorld(true);c.sceneObjects[0].object=object;
 const helper={visible:true};c.transformControls={object,visible:true,enabled:true,attach(target){this.object=target;this.visible=true;},detach(){this.object=undefined;this.visible=false;},getHelper:()=>helper,setSpace(){}};
 c.selectionTransforms=null;c.viewportGizmosVisible=true;c.transformPreferences={orientation:'world'};
 vm.runInContext(grab('attachViewportGizmo'),c);
 const body={closest:()=>null},document=Object.assign(new EventTarget(),{body,activeElement:body});
 const camera=new THREE.PerspectiveCamera(50,1,.01,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const {api}=installPolyEditMode({document,viewport:{contains:()=>false,matches:()=>false},canvas:{getBoundingClientRect:()=>({left:0,top:0,right:400,bottom:400,width:400,height:400})},camera,objectFor:id=>c.sceneObjects.find(o=>o.id===id)?.object,selectedId:()=>c.activeSceneObjectId,gizmo:c.transformControls});
 c.window.kaminosPolyEdit=api;api.enter('mesh');
 assert.deepEqual([c.transformControls.visible,c.transformControls.enabled,helper.visible],[false,false,false]);
 c.setSceneSelection(['mesh']);
 assert.equal(api.active(),true,'reselecting the same object retains component editing');
 assert.deepEqual([c.transformControls.visible,c.transformControls.enabled,helper.visible],[false,false,false],'same-object selection cannot revive the object tool');
 api.exit();assert.deepEqual([c.transformControls.visible,c.transformControls.enabled,helper.visible],[true,true,true],'leaving component editing restores the prior object tool');
 assert.equal(c.transformControls.object,object);
});

test('a disabled hidden gizmo cannot block ordinary scene selection with its stale hover axis',()=>{
 const c=pointerContext(),event={button:0,clientX:50,clientY:20,pointerId:1};
 c.transformControls.enabled=false;c.transformControls.axis='X';c.transformControls.getHelper=()=>({visible:false});
 c.handleViewportPointerDown(event);c.handleViewportSelectionClick({...event,type:'pointerup'});assert.equal(c.selection,true);
});

test('a hidden fire field cannot be selected through its retained visible-flame snapshot',()=>{const c={isSceneItemVisible:()=>false};sceneContext(c);vm.runInContext(grab('pickVisibleFlameFromViewportPointer'),c);assert.equal(c.pickVisibleFlameFromViewportPointer([]),null);});
