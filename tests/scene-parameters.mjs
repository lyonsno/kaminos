import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {installParameterTools} from '../scene-parameter-tools.mjs';
class Element {
 constructor(type=''){this.type=type;this.value='1';this.min='0';this.max='4';this.dataset={};this.style={};this.events={};this.captured=false;}
 get valueAsNumber(){return Number(this.value);}
 addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
 emit(type,extra={}){const e={isTrusted:true,key:'',button:0,pointerId:3,clientX:0,target:this,preventDefault(){},stopImmediatePropagation(){this.stopped=true;},...extra};for(const fn of this.events[type]||[]){fn(e);if(e.stopped)break;}}
 setPointerCapture(){this.captured=true;}hasPointerCapture(){return this.captured;}releasePointerCapture(){this.captured=false;this.emit('lostpointercapture');}blur(){document.activeElement=null;this.emit('blur');}
}
function fixture(){
 globalThis.document=new Element();globalThis.window=new Element();
 const range=new Element('range'),number=new Element('number'),grip=new Element();let value=1,blocked=false;
 const edits=createSceneEdits({read:()=>null,write(){},admit(){if(blocked)throw Error('busy');}});
 const ui=installParameterTools({edits,descriptors:[{id:'light',label:'Light',inputs:[range,number],grip,step:.01,read:()=>value,validate:v=>{if(v<0)throw Error('negative');},write:v=>{value=v;}}]});
 return {range,number,grip,edits,ui,get value(){return value;},set blocked(v){blocked=v;}};
}
test('one slider gesture is one edit, escape rolls back and invalid/busy input cannot mutate state',()=>{
 const f=fixture();f.range.emit('pointerdown');f.range.value='2';f.range.emit('input');f.range.value='3';f.range.emit('input');f.range.emit('change');
 assert.equal(f.value,3);assert.equal(f.edits.state().undoCount,1);f.edits.undo();assert.equal(f.value,1);assert.equal(f.range.value,'1');
 document.activeElement=f.number;f.number.emit('beforeinput');f.number.value='2';f.number.emit('input');f.number.emit('keydown',{key:'Escape'});assert.equal(f.value,1);
 f.number.emit('beforeinput');f.number.value='-1';f.number.emit('input');f.number.emit('change');assert.equal(f.value,1);
 f.blocked=true;f.range.emit('pointerdown');f.range.value='4';f.range.emit('input');assert.equal(f.value,1);assert.equal(f.range.value,'1');
});
test('relative grip begins at its value, cancels on blur and releases capture on an external cancellation',()=>{
 const f=fixture();f.grip.emit('pointerdown',{clientX:100});f.grip.emit('pointermove',{clientX:130});assert.equal(f.value,1.3);
 f.edits.cancel();assert.equal(f.value,1);assert.equal(f.grip.captured,false);f.grip.emit('pointermove',{clientX:200});assert.equal(f.value,1);
 f.grip.emit('pointerdown',{clientX:100});f.grip.emit('pointermove',{clientX:130});window.emit('blur');assert.equal(f.value,1);
 f.ui.set('light',2);assert.equal(f.edits.state().undoCount,1);f.edits.undo();assert.equal(f.value,1);
});
