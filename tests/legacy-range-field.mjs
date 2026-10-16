// kaminos-test: node
import assert from 'node:assert/strict';
import {bindRangeNumber} from '../legacy-range-field.mjs';
class Input extends EventTarget {
  constructor(value){super();this.value=value;this.min='0';this.max='10';this.step='.1';this.disabled=false;this.readOnly=true;}
}
const source=new Input('2'),input=new Input('');
bindRangeNumber(source,input);
let changes=0,inputs=0;
source.addEventListener('input',()=>inputs++);source.addEventListener('change',()=>changes++);
input.value='4';input.dispatchEvent(new Event('input'));
assert.equal(source.value,'4','numeric preview must reach the original control and its owner');
assert.equal(inputs,1);
input.dispatchEvent(new Event('change'));assert.equal(changes,1);
source.value='7';assert.equal(input.value,'7','programmatic undo/load updates must reach the visible field');
input.value='';input.dispatchEvent(new Event('input'));assert.equal(source.value,'7','unfinished typing must not zero the owner value');
input.dispatchEvent(new Event('change'));assert.equal(input.value,'7');
assert.equal(source.type,undefined,'the original control identity/type must be preserved');
console.log('Legacy range field propagation and restoration pass');
