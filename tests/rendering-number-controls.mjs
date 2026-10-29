// kaminos-test: node
import assert from 'node:assert/strict';
import {installRenderingNumberControl,installRenderingNumberControls} from '../rendering-number-controls.mjs';
import {installRelativeNumberDrag} from '../scene-control-history.mjs';
class Control extends EventTarget {
 constructor(){super();this.listeners=new Map();this.style={};this.type='range';this.value='3';this.min='1';this.max='';this.step='1';}
 addEventListener(type,fn,options){super.addEventListener(type,fn,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listeners.get(type)?.delete(fn);}
 listenerCount(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.size,0);}
 setPointerCapture(){}hasPointerCapture(){return false;}
 fire(type,props={}){const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(props))Object.defineProperty(event,key,{value});this.dispatchEvent(event);}
}
const doc=new Control(),win=new Control(),input=new Control();doc.defaultView=win;win.Event=Event;input.ownerDocument=doc;globalThis.document=doc;globalThis.window=win;
try {
 let commits=0,live=3;input.addEventListener('input',()=>live=Number(input.value));input.addEventListener('change',()=>commits++);
 const firstScrub=installRenderingNumberControl(input);installRenderingNumberControl(input);
 assert.equal(input.type,'number');
 input.fire('pointerdown',{button:0,pointerId:1,clientX:0,clientY:0});input.fire('pointermove',{pointerId:1,clientX:5,clientY:0});
 assert.equal(live,8);assert.equal(commits,0,'expensive changes wait for release');
 input.fire('pointercancel');assert.equal(live,3);assert.equal(input.value,'3');assert.equal(commits,0,'cancel restores without rebuilding');
 input.fire('pointerdown',{button:0,pointerId:2,clientX:0,clientY:0});input.fire('pointermove',{pointerId:2,clientX:6,clientY:0});input.fire('pointerup');
 assert.equal(commits,1,'one widget per input, one commit per drag');assert.equal(live,9);
 const even=new Control();even.ownerDocument=doc;even.value='0';even.min='0';even.max='32';even.step='2';
 let validation='',reported=0;even.setCustomValidity=text=>validation=text;even.reportValidity=()=>reported++;
 const evenScrub=installRenderingNumberControl(even);
 const values=[];even.addEventListener('input',()=>values.push(Number(even.value)));
 even.fire('pointerdown',{button:0,pointerId:3,clientX:0,clientY:0});even.fire('pointermove',{pointerId:3,clientX:5,clientY:0});even.fire('pointerup');
 assert.ok(values.every(value=>value%2===0),'scrubbing preserves the former range step');
 for(const value of ['', '1.5', '33', '-2']) {
   const count=values.length,last=even.value;even.value=value;even.fire('input');
   assert.equal(values.length,count,'invalid typed edits must not reach live handlers');
   even.fire('change');assert.equal(even.value,last,'invalid commit restores the last valid value');assert(validation.length>0,'rejected numeric input must explain its constraint');even.fire('blur');assert(validation.length>0,'blur must not erase the rejected-edit explanation');
 }
 even.value='6';even.fire('input');even.fire('change');assert.equal(values.at(-1),6);assert.equal(validation,'');assert.equal(reported,4);
 const gi=new Control();gi.ownerDocument=doc;gi.type='number';gi.value='5';gi.step='.1';gi.closest=selector=>selector==='#scene-gi-controls'?{}:null;
 installRenderingNumberControls({querySelectorAll:()=>[gi]});
 const historyScrub=installRelativeNumberDrag({input:gi,grip:gi,step:.1});
 let giEvents=0;gi.addEventListener('input',()=>giEvents++);
 gi.fire('pointerdown',{button:0,pointerId:4,clientX:0,clientY:0});gi.fire('pointermove',{pointerId:4,clientX:5,clientY:0});
 assert.equal(giEvents,1,'GI retains its existing history-owned scrub without a second Rendering scrub');
 historyScrub.stop();const released=gi.value;
 gi.fire('pointermove',{pointerId:4,clientX:10,clientY:0});
 assert.equal(gi.value,released,'history release stops all GI scrubbing');
 firstScrub.dispose();evenScrub.dispose();historyScrub.dispose();
 const baseline=doc.listenerCount()+win.listenerCount();
 for(let cycle=0;cycle<3;cycle++){
   let retiredCancel=0;const retired=[];
   const scrubs=Array.from({length:4},()=>{const input=new Control();input.ownerDocument=doc;input.addEventListener('pointercancel',()=>retiredCancel++);retired.push(input);return installRenderingNumberControl(input);});
   assert.equal(doc.listenerCount()+win.listenerCount(),baseline+12);
   for(const scrub of scrubs)scrub.dispose?.();
   assert.equal(doc.listenerCount()+win.listenerCount(),baseline,'retiring the lighting panel must release every global scrub subscription');
   for(const input of retired){doc.activeElement=input;doc.fire('keydown',{key:'Escape'});}
   assert.equal(retiredCancel,0,'retired inputs must not receive global keyboard callbacks');
 }
}finally{delete globalThis.document;delete globalThis.window;}
console.log('PASS Rendering scrubs preserve live handlers, commit on release and restore cancellation');
