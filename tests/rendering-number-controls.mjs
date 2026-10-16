// kaminos-test: node
import assert from 'node:assert/strict';
import {installRenderingNumberControl} from '../rendering-number-controls.mjs';
class Control extends EventTarget {
 constructor(){super();this.style={};this.type='range';this.value='3';this.min='1';this.max='';this.step='1';}
 setPointerCapture(){}hasPointerCapture(){return false;}
 fire(type,props={}){const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(props))Object.defineProperty(event,key,{value});this.dispatchEvent(event);}
}
const doc=new Control(),win=new Control(),input=new Control();doc.defaultView=win;win.Event=Event;input.ownerDocument=doc;globalThis.document=doc;globalThis.window=win;
try {
 let commits=0,live=3;input.addEventListener('input',()=>live=Number(input.value));input.addEventListener('change',()=>commits++);
 installRenderingNumberControl(input);installRenderingNumberControl(input);
 assert.equal(input.type,'number');
 input.fire('pointerdown',{button:0,pointerId:1,clientX:0,clientY:0});input.fire('pointermove',{pointerId:1,clientX:5,clientY:0});
 assert.equal(live,8);assert.equal(commits,0,'expensive changes wait for release');
 input.fire('pointercancel');assert.equal(live,3);assert.equal(input.value,'3');assert.equal(commits,0,'cancel restores without rebuilding');
 input.fire('pointerdown',{button:0,pointerId:2,clientX:0,clientY:0});input.fire('pointermove',{pointerId:2,clientX:6,clientY:0});input.fire('pointerup');
 assert.equal(commits,1,'one widget per input, one commit per drag');assert.equal(live,9);
}finally{delete globalThis.document;delete globalThis.window;}
console.log('PASS Rendering scrubs preserve live handlers, commit on release and restore cancellation');
