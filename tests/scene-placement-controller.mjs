import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,OrthographicCamera,EventDispatcher} from '../lib/three.core.js';
import {installScenePlacementTools} from '../scene-placement-tools.mjs';
import * as placementTools from '../scene-placement-tools.mjs';

class Element extends EventTarget {
 constructor(){super();this.style={};this.dataset={};this.captures=new Set();this.clientWidth=800;this.clientHeight=600;}
 setAttribute(){} append(...children){this.children??=[];this.children.push(...children);} contains(){return true;} closest(){return null;}
 getBoundingClientRect(){return this.rect||{left:0,top:0,right:800,bottom:600,width:800,height:600};}
 setPointerCapture(id){this.captures.add(id);} hasPointerCapture(id){return this.captures.has(id);} releasePointerCapture(id){this.captures.delete(id);}
}
function emit(target,type,values={}){const event=new Event(type,{cancelable:true});Object.assign(event,values);target.dispatchEvent(event);}
function fixture(){
 const document=new Element(),window=new Element(),viewport=new Element(),input=new Element(),grip=new Element(),status=new Element();
 status.rect={left:16,top:520,right:290,bottom:549,width:274,height:29};document.getElementById=id=>id==='info-bar'?status:null;
 input.dataset.transformField='position.x';input.value='0';Object.defineProperty(input,'valueAsNumber',{get:()=>Number(input.value)});input.parentElement={querySelector:()=>grip};input.blur=()=>{};
 document.createElement=()=>new Element();document.createElementNS=()=>new Element();document.querySelectorAll=()=>[input];
 Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}}});
 const camera=new PerspectiveCamera(45,4/3,.1,100);camera.position.z=10;
 const controls=new EventDispatcher();controls.enabled=true;
 const gizmo=new EventDispatcher(),helper={visible:true};Object.assign(gizmo,{enabled:true,dragging:false,getHelper:()=>helper,pointerUp(){this.dragging=false;this.axis=null;this.dispatchEvent({type:'mouseUp'});}});
 let pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},allowed=true,busy=false;
 const sceneObject={userData:{kaminosSceneObject:{label:'kiln'}},updateWorldMatrix(){}};
 let frames=0;
 const tools=installScenePlacementTools({viewport,camera,controls,gizmo,selected:()=> 'kiln',read:()=>structuredClone(pose),write:(_,p)=>pose=structuredClone(p),object:()=>sceneObject,refresh(){},allowed:()=>allowed,busy:()=>busy,frameSelected:()=>frames++});
 return {tools,input,grip,document,window,viewport,status,controls,gizmo,helper,get frames(){return frames;},get pose(){return pose;},set allowed(v){allowed=v;},set busy(v){busy=v;},
   set position(value){pose.position=[...value];tools.draw();},
   get hud(){return viewport.children.find(child=>child.id==='scene-edit-hud');},get overlay(){return viewport.children.find(child=>child.id==='scene-edit-overlay');},
   beginDrag(){emit(viewport,'pointerdown',{pointerId:7,button:0});viewport.setPointerCapture(7);gizmo.dragging=true;controls.enabled=false;gizmo.dispatchEvent({type:'mouseDown'});pose.position[0]=2;},
   lateMove(){if(gizmo.dragging)pose.position[0]=9;gizmo.pointerUp();}};
}
test('sidebar history scope permits undo without enabling viewport transform shortcuts',()=>{
 const f=fixture(),historyScope=new Element();let pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},frames=0;
 f.viewport.contains=()=>false;
 const scoped=installScenePlacementTools({viewport:f.viewport,historyScope,camera:new PerspectiveCamera(45,4/3,.1,100),controls:f.controls,gizmo:f.gizmo,
  selected:()=> 'kiln',read:()=>structuredClone(pose),write:(_,next)=>pose=structuredClone(next),object:()=>({userData:{kaminosSceneObject:{label:'kiln'}},updateWorldMatrix(){}}),refresh(){},frameSelected:()=>frames++});
 scoped.edits.apply('kiln',{position:[2,0,0]});
 emit(historyScope,'pointerdown',{button:0,pointerId:1});
 emit(f.document,'keydown',{key:'g'});
 assert.equal(scoped.state().modal,null,'a list click must not enable viewport-only G/R/S shortcuts');
 emit(f.document,'keydown',{key:'f'});
 assert.equal(frames,0,'a list click must not enable viewport-only F framing');
 emit(f.document,'keydown',{key:'z',ctrlKey:true});
 assert.deepEqual(pose.position,[0,0,0],'the same sidebar scope must continue to permit scene-history undo');
});

test('pivot projection distinguishes visible, behind-camera, and off-viewport objects',()=>{
 assert.equal(typeof placementTools.getPivotViewState,'function','placement feedback must expose its camera-visibility decision');
 const camera=new PerspectiveCamera(45,4/3,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
 assert.deepEqual(placementTools.getPivotViewState(camera,{x:0,y:0,z:0},800,600),{state:'visible',x:400,y:300});
 assert.equal(placementTools.getPivotViewState(camera,{x:0,y:0,z:20},800,600).state,'behind-camera');
 assert.equal(placementTools.getPivotViewState(camera,{x:100,y:0,z:0},800,600).state,'outside-view');
});
test('zero-near orthographic camera accepts a pivot on its near plane',()=>{
 const camera=new OrthographicCamera(-2,2,2,-2,0,100);camera.position.z=10;camera.updateMatrixWorld(true);
 assert.deepEqual(placementTools.getPivotViewState(camera,{x:0,y:0,z:10},800,600),{state:'visible',x:400,y:300});
});
test('pivot cue disappears offscreen and HUD names why plus the frame-selected recovery',()=>{
 const f=fixture();
 assert.match(f.overlay.innerHTML,/line/);
 f.position=[0,0,20];
 assert.equal(f.overlay.innerHTML,'');
 assert.equal(f.hud.dataset.alert,'true');
 assert.match(f.hud.textContent,/Pivot hidden: selected pivot is behind the camera · F to frame pivot and object/);
 f.position=[100,0,0];
 assert.equal(f.overlay.innerHTML,'');
 assert.match(f.hud.textContent,/Pivot hidden: selected pivot is outside the view · F to frame pivot and object/);
});
test('offscreen-pivot warning moves above the measured status height',()=>{
 const f=fixture();f.position=[100,0,0];
 assert.equal(f.hud.style.bottom,'88px');
 f.status.rect={left:16,top:440,right:200,bottom:529,width:184,height:89};f.tools.draw();
 assert.equal(f.hud.style.bottom,'168px','a taller wrapped status must move the warning above its actual top edge');
});
test('modal pivot warning tells the author to end the gesture before using F',()=>{
 const f=fixture();f.tools.start('translate');f.position=[0,0,20];
 assert.match(f.hud.textContent,/finish.*Enter.*Esc.*then F to frame pivot and object/i);
 emit(f.document,'keydown',{key:'f'});assert.equal(f.frames,0,'F cannot frame while the modal key handler owns the gesture');
 assert.ok(f.tools.state().active);f.tools.finish(false);emit(f.document,'keydown',{key:'f'});assert.equal(f.frames,1,'F frames after the edit has ended');
});
test('blur, selection and clear abort every native gizmo owner before rollback',()=>{
 for(const boundary of ['blur','selectionChanged','clear']){
  const f=fixture();f.beginDrag();assert.ok(f.tools.state().active);
  boundary==='blur'?emit(f.window,'blur'):f.tools[boundary]();
  assert.deepEqual(f.pose.position,[0,0,0],boundary);assert.equal(f.tools.state().undoCount,0);
  assert.equal(f.gizmo.dragging,false,`${boundary} must terminate native drag`);assert.equal(f.tools.state().gizmoEditing,false);
  assert.equal(f.viewport.hasPointerCapture(7),false);assert.equal(f.controls.enabled,true);assert.equal(f.gizmo.enabled,true);assert.equal(f.helper.visible,true);
  f.lateMove();assert.deepEqual(f.pose.position,[0,0,0]);assert.equal(f.tools.state().active,null);
 }
});
test('inspector and direct API share correction/busy rejection with unchanged pose',()=>{
 for(const gate of ['allowed','busy']){
  const f=fixture();f[gate]=gate==='busy';
  assert.throws(()=>f.tools.edits.apply('kiln',{position:[4,0,0]}),/correction|preview|authoring/i);
  f.input.value='5';emit(f.input,'input');emit(f.grip,'pointerdown',{button:0,pointerId:8,clientX:0});emit(f.document,'pointermove',{clientX:100,clientY:0});
  assert.deepEqual(f.pose.position,[0,0,0]);assert.equal(f.tools.state().active,null);
 }
});
test('a correction gizmo remains owned by its correction controller',()=>{
 const f=fixture();f.allowed=false;f.gizmo.dragging=true;f.gizmo.dispatchEvent({type:'mouseDown'});
 assert.equal(f.gizmo.dragging,true);assert.equal(f.tools.state().gizmoEditing,false);assert.equal(f.tools.state().active,null);
});
test('switching operation restores gesture-start pose while keeping frame and one undo entry',()=>{
 const f=fixture();f.tools.start('translate');
 f.tools.edits.preview({position:[3,0,0]});
 emit(f.document,'keydown',{key:'x',shiftKey:false});
 f.tools.edits.preview({position:[3,0,0]});
 f.tools.start('rotate');assert.deepEqual(f.pose.position,[0,0,0]);
 assert.equal(f.tools.state().modal.axis,'x');
 emit(f.document,'keydown',{key:'3'});emit(f.document,'keydown',{key:'0'});
 f.tools.finish(true);assert.deepEqual(f.pose.position,[0,0,0]);assert.equal(f.tools.state().undoCount,1);
 f.tools.edits.undo();assert.deepEqual(f.pose.rotation,[0,0,0]);
});
