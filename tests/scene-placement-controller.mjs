import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,EventDispatcher} from '../lib/three.core.js';
import {installScenePlacementTools} from '../scene-placement-tools.mjs';

class Element extends EventTarget {
 constructor(){super();this.style={};this.dataset={};this.captures=new Set();this.clientWidth=800;this.clientHeight=600;}
 setAttribute(){} append(){} contains(){return true;} closest(){return null;}
 getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
 setPointerCapture(id){this.captures.add(id);} hasPointerCapture(id){return this.captures.has(id);} releasePointerCapture(id){this.captures.delete(id);}
}
function emit(target,type,values={}){const event=new Event(type,{cancelable:true});Object.assign(event,values);target.dispatchEvent(event);}
function fixture(){
 const document=new Element(),window=new Element(),viewport=new Element(),input=new Element(),grip=new Element();
 input.dataset.transformField='position.x';input.value='0';Object.defineProperty(input,'valueAsNumber',{get:()=>Number(input.value)});input.parentElement={querySelector:()=>grip};input.blur=()=>{};
 document.createElement=()=>new Element();document.createElementNS=()=>new Element();document.querySelectorAll=()=>[input];
 Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}}});
 const camera=new PerspectiveCamera(45,4/3,.1,100);camera.position.z=10;
 const controls=new EventDispatcher();controls.enabled=true;
 const gizmo=new EventDispatcher(),helper={visible:true};Object.assign(gizmo,{enabled:true,dragging:false,getHelper:()=>helper,pointerUp(){this.dragging=false;this.axis=null;this.dispatchEvent({type:'mouseUp'});}});
 let pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},allowed=true,busy=false;
 const tools=installScenePlacementTools({viewport,camera,controls,gizmo,selected:()=> 'kiln',read:()=>structuredClone(pose),write:(_,p)=>pose=structuredClone(p),object:()=>null,refresh(){},allowed:()=>allowed,busy:()=>busy});
 return {tools,input,grip,document,window,viewport,controls,gizmo,helper,get pose(){return pose;},set allowed(v){allowed=v;},set busy(v){busy=v;},
   beginDrag(){emit(viewport,'pointerdown',{pointerId:7,button:0});viewport.setPointerCapture(7);gizmo.dragging=true;controls.enabled=false;gizmo.dispatchEvent({type:'mouseDown'});pose.position[0]=2;},
   lateMove(){if(gizmo.dragging)pose.position[0]=9;gizmo.pointerUp();}};
}
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
