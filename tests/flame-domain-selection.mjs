// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n}',start)+2);};
test('visible domain edge click selects field after emitter editing',()=>{
 const ctx={isSceneItemVisible:()=>true,performance,polyEdit:null,vantageCaptureHeld:false,viewportSuppressedClick:null,viewportPointerDown:null,transformGizmoDragging:false,transformControls:null,
 viewportEventHitsInteractiveOverlay:()=>false,viewportEventIsInsideCanvas:()=>true,greenroomPreviewIsActive:()=>false,
 pickFlameDomainFromViewportPointer:()=>true,pickSceneObjectFromViewportPointer:()=>null,
 selected:'flame-emitter',setActiveSceneObject(id){ctx.selected=id;},clearActiveSceneObjectSelection(){ctx.selected=null;},setInfo(){},
 window:{selectSceneField(id){ctx.selected=id;},_kaminosDirty(){}}};
 vm.createContext(ctx);vm.runInContext(grab('handleViewportSelectionClick'),ctx);
 ctx.handleViewportSelectionClick({button:0,type:'click',clientX:42,clientY:20});
 assert.equal(ctx.selected,'flame-field');
});
test('domain outline remains visible after unrelated selection, but respects helper hiding',()=>{
 const ctx={isSceneItemVisible:()=>true,THREE,scene:{},activeSceneComposition:{},flameDomainGuide:{box:new THREE.Box3()},selectionCaptureSuspended:false,viewportHelpersVisible:true,
 viewportDisplay:{domains:true,domainOpacity:.82},styleHelperLines(){},styleSimulationDomainGuide(){},sceneSelectionMembers:()=>[],FLAME_EMITTER_ID:'flame-emitter',activeSceneFieldId:null,flameDomainDraft:null,flameDomainProxy:null,
 acceptedFlameDomainPose:()=>({position:[0,1,0],scale:[1,1,1]}),domainTransformForPose:()=>({translation:[0,0,0],scale:1}),document:{getElementById:()=>null},window:{}};
 vm.createContext(ctx);vm.runInContext(grab('flameDomainTopY')+grab('refreshFlameDomainPreview'),ctx);ctx.refreshFlameDomainPreview();
 assert.equal(ctx.flameDomainGuide.visible,true);ctx.window.__kaminosVolumeGridDimensions=[32,96,32];ctx.refreshFlameDomainPreview();assert.deepEqual(ctx.flameDomainGuide.box.max.toArray(),[1,5,1],'outline follows actual tall grid bounds');
 ctx.viewportHelpersVisible=false;ctx.refreshFlameDomainPreview();assert.equal(ctx.flameDomainGuide.visible,false);
 ctx.viewportHelpersVisible=true;ctx.selectionCaptureSuspended=true;ctx.refreshFlameDomainPreview();assert.equal(ctx.flameDomainGuide.visible,false);
});

import {pointerHitsBoxOutline} from '../scene-selection.mjs';
test('outline picking uses a fixed pixel margin, leaves interior free, and rejects behind-eye geometry',()=>{
 const camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.position.z=5;camera.updateMatrixWorld(true);
 const box=new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1));
 for(const size of [400,1200]){
  const viewport={left:30,top:50,width:size,height:size};
  const corner=new THREE.Vector3(1,0,1).project(camera),x=30+(corner.x+1)*size/2,y=50+size/2;
  assert.equal(pointerHitsBoxOutline(box,camera,{x:x+5,y},viewport),true);
  assert.equal(pointerHitsBoxOutline(box,camera,{x:x+8,y},viewport),false);
  assert.equal(pointerHitsBoxOutline(box,camera,{x:30+size/2,y},viewport),false);
 }
 const viewport={left:0,top:0,width:400,height:400};
 const behind=new THREE.Box3(new THREE.Vector3(-1,-1,6),new THREE.Vector3(1,1,8));
 assert.equal(pointerHitsBoxOutline(behind,camera,{x:200,y:200},viewport),false);
 camera.position.z=0;camera.updateMatrixWorld(true);
 const crossing=new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1));
 assert.equal(pointerHitsBoxOutline(crossing,camera,{x:200,y:200},viewport),false);
});
test('hidden domain outline cannot intercept viewport input',()=>{
 const ctx={isSceneItemVisible:()=>true,activeSceneComposition:{},flameDomainGuide:{visible:false},selectionCaptureSuspended:false,viewportHelpersVisible:true,
 renderer:{},camera:{},pointerHitsBoxOutline(){throw Error('hidden helper was picked');}};
 vm.createContext(ctx);vm.runInContext(grab('pickFlameDomainFromViewportPointer'),ctx);
 assert.equal(ctx.pickFlameDomainFromViewportPointer({clientX:0,clientY:0}),false);
});
