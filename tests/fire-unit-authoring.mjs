// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createFireUnitControlDocument} from '../fire-unit-authoring.mjs';
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
