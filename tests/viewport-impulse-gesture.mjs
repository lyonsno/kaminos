// kaminos-test: node
import assert from 'node:assert/strict';
import {dragVelocity} from '../viewport-impulse-gesture.mjs';
assert.deepEqual(dragVelocity([1,2,3],[1,2,3]),[0,0,0]);
const x=dragVelocity([2,3,4],[3,3,4]);assert.ok(Math.abs(x[0]-2*Math.log(2))<1e-12);assert.deepEqual(x.slice(1),[0,0]);
assert.ok(Math.abs(dragVelocity([0,0,0],[0,3,4])[1]/dragVelocity([0,0,0],[0,3,4])[2]-.75)<1e-12);
assert.ok(dragVelocity([0,0,0],[2,0,0])[0]>x[0]);assert.ok(dragVelocity([0,0,0],[2,0,0])[0]<2*x[0]);
assert.throws(()=>dragVelocity([NaN,0,0],[1,0,0]),/Invalid/);

import {PerspectiveCamera} from '../lib/three.core.js';
import {mountViewportImpulseGesture} from '../viewport-impulse-gesture.mjs';
class Node extends EventTarget{
 constructor(){super();this.style={};this.attrs={};this.children=[];this.classList={add(){}};}
 setAttribute(k,v){this.attrs[k]=v;}append(n){this.children.push(n);n.parent=this;}remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
 getBoundingClientRect(){return{left:0,top:0,width:400,height:400};}setPointerCapture(i){this.captured=i;}releasePointerCapture(){this.captured=null;}
}
const doc=new Node();doc.defaultView=new Node();doc.createElementNS=()=>new Node();const viewport=new Node(),canvas=new Node(),camera=new PerspectiveCamera(45,1,.01,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);const controls={enabled:true};let active=true,frame,pickHit={released:true,rock:7,worldPoint:[0,0,0]},commits=[],cancels=0;
const tool=mountViewportImpulseGesture({document:doc,viewport,canvas,camera,controls,isActive:()=>active,onFrame:f=>{frame=f;return()=>{frame=null;};},pick:async()=>pickHit,begin:async()=>pickHit,commit:async v=>commits.push(v),cancel:async()=>{cancels++;},onError:e=>{throw e;}});
const event=(target,type,p={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{button:0,buttons:0,pointerId:1,clientX:200,clientY:200,...p});target.dispatchEvent(e);return e;};
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate);};
event(canvas,'pointermove');await flush();assert.equal(tool.read().hover,7);
assert.equal(event(canvas,'pointerdown').defaultPrevented,true);await flush();assert.equal(controls.enabled,false);event(canvas,'pointermove',{clientX:260,clientY:180});event(canvas,'pointerup',{clientX:260,clientY:180});await flush();assert.equal(commits.length,1);assert.ok(commits[0].velocity[0]>0&&commits[0].velocity[1]>0);assert.equal(controls.enabled,true);assert.equal(canvas.captured,null);assert.equal(event(canvas,'click').defaultPrevented,true,'The native selection click must not escape a shove');
event(canvas,'pointermove');await flush();event(canvas,'pointerdown');await flush();event(canvas,'pointermove',{clientX:270});event(doc,'keydown',{key:'Escape'});await flush();event(canvas,'pointerup');await flush();assert.equal(commits.length,1);assert.equal(cancels,1);assert.equal(controls.enabled,true);
active=false;event(canvas,'pointermove');assert.equal(event(canvas,'pointerdown').defaultPrevented,false,'Authoring pointer events stay native');active=true;pickHit={...pickHit,released:false};event(canvas,'pointermove');await flush();assert.equal(event(canvas,'pointerdown').defaultPrevented,false,'Attached rock cannot begin a shove');
pickHit={...pickHit,released:true};event(canvas,'pointermove');await flush();event(canvas,'pointerdown');await flush();await tool.dispose();assert.equal(cancels,2);assert.equal(controls.enabled,true);assert.equal(viewport.children.length,0);assert.equal(frame,null);

// Same endpoint, distinct release motion; a held stroke must not act as a fling.
const flingTool=mountViewportImpulseGesture({document:doc,viewport,canvas,camera,controls,isActive:()=>active,onFrame:f=>{frame=f;return()=>{};},pick:async()=>pickHit,begin:async()=>pickHit,commit:async v=>commits.push(v),cancel:async()=>{},onError:e=>{throw e;},fling:true});
async function stroke(duration,hold){
 const fire=(type,x,t)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{button:0,buttons:0,pointerId:1,clientX:x,clientY:200});Object.defineProperty(e,'timeStamp',{value:t});canvas.dispatchEvent(e);};
 fire('pointermove',200,1000);await flush();fire('pointerdown',200,1010);await flush();
 for(let i=1;i<=4;i++)fire('pointermove',200+25*i,1010+duration*i/4);
 fire('pointerup',300,1010+duration+hold);await flush();
 return Math.hypot(...commits.at(-1).velocity);
}
const quick=await stroke(80,1),slow=await stroke(600,1),held=await stroke(80,250),fast=await stroke(4,1);
assert.ok(fast>quick,'A delivered motion sample under 8 ms must not become zero impulse');
assert.ok(quick>slow*3,'Release speed drives the impulse at equal displacement');
assert.ok(held<quick*.1,'Stopping before release sheds the flick momentum');
assert.ok(quick>10*2*Math.log1p(1),'A committed flick is substantially stronger than the old drag');
await flingTool.dispose();

let resolveFresh;const fresh=new Promise(r=>resolveFresh=r);const target={...pickHit,rock:4};
const freshTool=mountViewportImpulseGesture({document:doc,viewport,canvas,camera,controls,isActive:()=>active,onFrame:()=>()=>{},pick:async()=>null,begin:()=>fresh,commit:async v=>commits.push(v),cancel:async()=>{},onError:e=>{throw e;},fling:true});
const count=commits.length;
event(canvas,'pointerdown');await new Promise(r=>setTimeout(r,10));
event(canvas,'pointermove',{clientX:255,buttons:1});event(canvas,'pointerup',{clientX:255});
resolveFresh(target);await flush();
assert.equal(commits.length,count+1,'A flick can finish before the first hit readback');
assert.equal(commits.at(-1).hit.rock,4,'Pointerdown ray owns the target without a hover');
assert.equal(controls.enabled,true);
assert.equal(freshTool.read().target,null);
await freshTool.dispose();
let missCancels=0;
const missTool=mountViewportImpulseGesture({document:doc,viewport,canvas,camera,controls,isActive:()=>active,onFrame:()=>()=>{},pick:async()=>null,begin:async()=>null,commit:async v=>commits.push(v),cancel:async()=>{missCancels++;},onError:e=>{throw e;},fling:true});
event(canvas,'pointerdown');event(canvas,'pointerup');
assert.equal(event(canvas,'click').defaultPrevented,false,'A cold click without a stroke remains a native click');
await flush();assert.equal(commits.length,count+1,'Empty space cannot produce a fling');assert.equal(missCancels,1);assert.equal(controls.enabled,true);
await missTool.dispose();
