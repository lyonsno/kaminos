// kaminos-test: node
import assert from 'node:assert/strict';
import {PerspectiveCamera} from '../lib/three.core.js';
import {mountViewportAttachmentControls} from '../viewport-attachment-controls.mjs';
class Node extends EventTarget{
 constructor(tag='div'){super();this.tag=tag;this.style={};this.dataset={};this.attrs={};this.children=[];}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}append(...nodes){for(const n of nodes){this.children.push(n);n.parentNode=this;}}remove(){if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);}
 getBoundingClientRect(){return{left:0,top:0,width:400,height:400};}setPointerCapture(i){this.capture=i;}releasePointerCapture(){this.capture=null;}
}
const doc=new Node();doc.defaultView=new Node();doc.createElement=t=>new Node(t);doc.createElementNS=(_,t)=>new Node(t);const viewport=new Node(),canvas=new Node(),camera=new PerspectiveCamera(45,1,.01,100);camera.position.z=5;camera.lookAt(0,0,0);camera.updateMatrixWorld(true);let frame,active=true,called=[],resets=0,occluded=false;
let records=[{id:'a',bodyId:'rock-a',generation:0,attached:true,canRelease:true,worldPoint:[0,0,0],worldFace:[[0,0,0],[.2,0,0],[0,.2,0]]}];
const tool=mountViewportAttachmentControls({document:doc,viewport,canvas,camera,isActive:()=>active,onFrame:f=>{frame=f;return()=>{frame=null;};},asset:{id:'owner',root:{}},attachments:()=>records,onReset:async()=>{resets++;},createPin:()=>({update(){},visible:()=>!occluded,dispose(){}}),onRelease:async r=>{called.push(r);}});
const layer=viewport.children[0],button=layer.children.find(n=>n.tag==='button');assert.equal(button.attrs['aria-label'],'Release pose anchor — rock-a');
const fire=(type,p={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{button:0,pointerId:1,clientX:100,clientY:100,...p});button.dispatchEvent(e);return e;};const flush=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
occluded=true;frame();assert.equal(button.hidden,true,'Occluded pins have no active hit target');fire('click');await flush();assert.equal(called.length,0);occluded=false;frame();
const reset=viewport.children.find(n=>n.className==='specimen-reset-control');assert.ok(reset,'Reset lives in a separate viewport control');reset.dispatchEvent(new Event('click'));await flush();assert.equal(resets,1);
fire('click');await flush();assert.deepEqual(called,[{id:'a',generation:0}]);
fire('pointerdown');fire('pointermove',{clientX:135});fire('keydown',{key:'Escape'});assert.equal(button.capture,1,'A cancelled pull must retain ownership until pointerup');fire('pointerup',{clientX:135});fire('click');await flush();assert.equal(called.length,1,'Escape consumes the activation associated with the cancelled pull');
fire('pointerdown');fire('pointermove',{clientX:140});fire('pointerup',{clientX:140});fire('click');await flush();assert.equal(called.length,2,'A pull releases once, without a second trailing-click release');
fire('pointerdown');records=[{...records[0],generation:1}];frame();fire('pointerup');fire('click');await flush();assert.equal(called.length,2,'A rebuilt anchor cancels the old pull');
records=[{...records[0],canRelease:false,reason:'Reset specimen first'}];frame();fire('pointerdown');fire('pointerup');fire('click');await flush();assert.equal(called.length,2);assert.equal(button.attrs['aria-disabled'],'true');
tool.setVisible(false);assert.equal(layer.hidden,true);tool.setVisible(true);assert.equal(layer.hidden,false);active=false;frame();assert.equal(layer.hidden,true);active=true;records=[];frame();assert.equal(layer.children.filter(n=>n.tag==='button').length,0);tool.dispose();assert.equal(viewport.children.length,0);assert.equal(frame,null);
