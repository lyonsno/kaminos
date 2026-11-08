// kaminos-test: node
import assert from 'node:assert/strict';
import {installRelativeNumberDrag} from '../scene-control-history.mjs';
import {installRenderingNumberControl} from '../rendering-number-controls.mjs';
class Target extends EventTarget {
 constructor(){super();this.style={};this.type='number';this.value='2';this.min='1';this.max='';this.step='1';}
 setPointerCapture(){}hasPointerCapture(){return false;}
 fire(name,values={}){const e=new Event(name,{cancelable:true});for(const[k,v]of Object.entries(values))Object.defineProperty(e,k,{value:v});this.dispatchEvent(e);}
}
const doc=new Target(),win=new Target();doc.defaultView=win;win.Event=Event;const input=new Target();input.ownerDocument=doc;globalThis.document=doc;globalThis.window=win;
try {
 let commits=0;input.addEventListener('change',()=>commits++);const scrub=installRenderingNumberControl(input,installRelativeNumberDrag,{dragScale:1/16});
 input.fire('pointerdown',{button:0,pointerId:1,clientX:0,clientY:0});input.fire('pointermove',{pointerId:1,clientX:6,clientY:0});assert.equal(Number(input.value),2,'A short drag must not multiply cubic source work by jumping several whole samples');
 input.fire('pointermove',{pointerId:1,clientX:16,clientY:0});assert.equal(Number(input.value),3);assert.equal(commits,0,'Cost changes commit on release');input.fire('pointerup');assert.equal(commits,1);
 input.value='10';input.fire('input');input.fire('change');assert.equal(Number(input.value),10,'Reduced pointer sensitivity preserves precise typed settings');assert.equal(input.max,'','Pointer sensitivity does not invent a quality cap');
 input.fire('pointerdown',{button:0,pointerId:2,clientX:0,clientY:0});input.fire('pointermove',{pointerId:2,clientX:16,clientY:0});input.fire('pointercancel');assert.equal(Number(input.value),10,'Cancelled scrub restores the accepted typed setting');scrub.dispose();
} finally {delete globalThis.document;delete globalThis.window;}
console.log('Cubic lighting controls have deliberate scrubbing and unchanged typed capacity');
