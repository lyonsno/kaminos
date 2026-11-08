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
