// kaminos-test: node
// Edit Mode keys through the app's capture listeners, with Node's EventTarget as the document.
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {installPolyEditMode} from '../poly-edit-host.mjs';

const geometry=new THREE.BoxGeometry(2,2,2),object=new THREE.Group();object.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));object.updateMatrixWorld(true);
const camera=new THREE.PerspectiveCamera(50,1,.01,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const body={closest:()=>null},field={closest:selector=>selector.includes('input')?{}:null};
const document=Object.assign(new EventTarget(),{body,activeElement:body});
const viewport={contains:()=>false,matches:()=>false,getBoundingClientRect:()=>({left:0,top:0})};
const canvas={getBoundingClientRect:()=>({left:0,top:0,right:400,bottom:400,width:400,height:400})};
const helper={visible:true},gizmo={visible:true,enabled:true,getHelper:()=>helper},infos=[];let blocked=false,selected='mesh-1',present=true;
const {active,api}=installPolyEditMode({document,viewport,canvas,camera,objectFor:id=>present&&id==='mesh-1'?object:null,selectedId:()=>selected,setInfo:t=>infos.push(t),blocked:()=>blocked,gizmo});
const key=(code,init={})=>{
  const event=new Event('keydown',{cancelable:true}),fields={key:code==='Tab'?'Tab':code==='Escape'?'Escape':code.replace(/^(Key|Digit)/,'').toLowerCase(),code,target:body,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...init};
  for(const [name,value] of Object.entries(fields))Object.defineProperty(event,name,{value});
  document.dispatchEvent(event);return event;
};

let event=key('Tab');
assert.equal(active(),true,'Tab on the selected mesh enters Edit Mode');
assert.ok(event.defaultPrevented,'and the key is consumed');
assert.deepEqual([gizmo.visible,gizmo.enabled,helper.visible],[false,false,false],'the object gizmo and its drawn helper stand down while editing');
key('Digit3');assert.equal(api.read().mode,'face');
key('Digit2');assert.equal(api.read().mode,'edge');
key('Digit1');assert.equal(api.read().mode,'vertex');
key('KeyA');assert.equal(api.read().counts.vertices,8,'A selects all');
key('KeyA',{altKey:true});assert.equal(api.read().counts.vertices,0,'Alt-A deselects all');
key('KeyZ',{altKey:true});assert.equal(api.read().through,true,'Alt+Z toggles x-ray');
key('KeyZ',{altKey:true});assert.equal(api.read().through,false);
key('KeyA',{target:field});assert.equal(api.read().counts.vertices,0,'typing in a field never selects');
event=key('Tab',{target:field});assert.equal(active(),true,'Tab in a field moves focus, not modes');assert.ok(!event.defaultPrevented);
blocked=true;key('KeyA');assert.equal(api.read().counts.vertices,0,'a modal gesture or capture holds Edit Mode keys');blocked=false;
key('Tab');
assert.equal(active(),false,'Tab again leaves Edit Mode');
assert.deepEqual([gizmo.visible,gizmo.enabled,helper.visible],[true,true,true],'and gives the gizmo back as it was');
event=key('KeyA');assert.ok(!event.defaultPrevented,'outside Edit Mode the object tools keep A');

// Click-drag box selects, as Blender's Select Box tool: plain replaces, Shift adds, Ctrl or Cmd removes.
const pointer=(type,x,y,init={})=>{
  const event=new Event(type,{cancelable:true}),fields={clientX:x,clientY:y,button:0,pointerId:1,target:body,shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,...init};
  for(const [name,value] of Object.entries(fields))Object.defineProperty(event,name,{value});
  document.dispatchEvent(event);return event;
};
const drag=(x0,y0,x1,y1,init={})=>{pointer('pointerdown',x0,y0,init);pointer('pointermove',(x0+x1)/2,(y0+y1)/2,init);pointer('pointermove',x1,y1,init);return pointer('pointerup',x1,y1,init);};
key('Tab');assert.equal(active(),true);key('Digit1');
drag(1,1,399,399);assert.equal(api.read().counts.vertices,4,'a drag over the view selects the visible corners');
drag(1,1,200,200);assert.equal(api.read().counts.vertices,1,'a plain drag replaces the selection');
drag(200,200,399,399,{shiftKey:true});assert.equal(api.read().counts.vertices,2,'Shift-drag adds');
drag(1,1,200,200,{ctrlKey:true});assert.equal(api.read().counts.vertices,1,'Ctrl-drag removes');
drag(200,200,399,399,{metaKey:true});assert.equal(api.read().counts.vertices,0,'Cmd-drag removes too, since Ctrl-click is a right click on a Mac trackpad');
pointer('pointerdown',100,100);pointer('pointermove',102,101);pointer('pointerup',102,101);
assert.equal(api.read().counts.vertices,1,'a click that wobbles a few pixels still picks the nearest corner; a tiny box would pick nothing');
key('Tab');

selected=null;key('Tab');assert.equal(active(),false);assert.match(infos.at(-1),/Select a mesh/);
selected='mesh-1';key('Tab');assert.equal(active(),true);
present=false;assert.equal(api.active(),false,'removing the object ends Edit Mode');
assert.deepEqual([gizmo.visible,gizmo.enabled,helper.visible],[true,true,true]);
