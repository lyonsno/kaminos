// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createFireUnitControlDocument} from '../fire-unit-authoring.mjs';
import {installFireUnitFieldEditing} from '../fire-unit-authoring.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const document=()=>({querySelectorAll:()=>[],implementation:{createHTMLDocument(){const nodes=new Map();return{body:{append(node){nodes.set(node.id,node);}},getElementById:id=>nodes.get(id),createElement:()=>({type:'',value:'',id:''})};}}});
test('a canonical basin retains its virtual smoke presentation control in a private document',()=>{
 const settings={presentationControls:{'raymarch-smoke-presentation':{id:'raymarch-smoke-presentation',type:'button-state',value:'off'}}};
 const copy=createFireUnitControlDocument(document(),settings);assert.equal(copy.getElementById('raymarch-smoke-presentation').value,'off');
});
test('an unknown physical control still fails rather than silently using a default',()=>{
 assert.throws(()=>createFireUnitControlDocument(document(),{domControls:{missing:{id:'missing',type:'range',value:1}}}),/Unsupported fire control missing/);
});
test('a valid grid dimension outside the legacy dropdown options round-trips into private controls',()=>{
 function select(){let value='32';return{id:'volume-world-smoke-flow',tagName:'SELECT',type:'select-one',options:[{value:'32'}],get value(){return value;},set value(v){value=this.options.some(o=>o.value===v)?v:'';},cloneNode(){return select();},append(o){this.options.push(o);}};}
 const source=select(),doc=document();doc.querySelectorAll=()=>[source];const create=doc.implementation.createHTMLDocument;
 doc.implementation.createHTMLDocument=()=>{const copy=create(),append=copy.body.append;copy.body.append=node=>{node.ownerDocument=copy;append(node);};return copy;};
 const copy=createFireUnitControlDocument(doc,{domControls:{'volume-world-smoke-flow':{id:'volume-world-smoke-flow',type:'select-one',value:'10'}}});assert.equal(copy.getElementById('volume-world-smoke-flow').value,'10');
});
test('dynamic Flame fields group one gesture, preserve another unit and release on close/disposal',()=>{
 class Field extends EventTarget{constructor(){super();this.type='number';this.value='1';this.dataset={authoringDragStep:'.01'};}closest(){return null;}addEventListener(type,fn,options){super.addEventListener(type,fn,typeof options==='boolean'?{capture:options}:options);}removeEventListener(type,fn,options){super.removeEventListener(type,fn,typeof options==='boolean'?{capture:options}:options);}}
 const field=new Field(),other={value:7},edits=createSceneEdits({read:()=>({}),write(){}}),scrubs=[];
 edits.register('@unit:a',{read:()=>({value:Number(field.value)}),check:v=>v,write:v=>{field.value=String(v.value);}});
 field.addEventListener('input',()=>{const value={value:Number(field.value)};if(edits.state().active)edits.preview(value);else edits.apply('@unit:a',value);});
 const controls=installFireUnitFieldEditing({root:{querySelectorAll:()=>[field]},edits,target:'@unit:a',onError:e=>{throw e;},numberDrag:o=>{assert.equal(o.step,.01);const s={stops:0,disposed:false,stop(){this.stops++;},dispose(){this.disposed=true;}};scrubs.push(s);return s;}});
 field.dispatchEvent(new Event('focusin'));field.value='2';field.dispatchEvent(new Event('input'));field.value='3';field.dispatchEvent(new Event('input'));
 assert.equal(edits.state().undoCount,0);field.dispatchEvent(new Event('change'));assert.equal(edits.state().undoCount,1);assert.equal(other.value,7);
 edits.undo();assert.equal(field.value,'1');edits.redo();assert.equal(field.value,'3');
 field.dispatchEvent(new Event('focusin'));field.value='4';field.dispatchEvent(new Event('input'));controls.close();assert.equal(edits.state().active,null);assert.equal(edits.state().undoCount,2);
 controls.dispose();assert.equal(scrubs[0].disposed,true);field.dispatchEvent(new Event('focusin'));assert.equal(edits.state().active,null,'removed field must not reopen a transaction');
});
