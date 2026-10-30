// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as historyModule from '../authoring-image-history.mjs';
import {createAuthoringPromptExpansion} from '../authoring-prompt-expansion.mjs';
import {installEditCritic} from '../authoring-edit-critic.mjs';
import {createPagePromptHelper} from '../models/bfl-pup/page-helper.mjs';
assert.equal(typeof historyModule.createEditCritic,'function','history must provide an explicit original/request/result review operation');
const {createEditCritic,createImageIterationHistory}=historyModule;
const history=createImageIterationHistory();
const original={kind:'image',source:'/original',name:'Original'};
const result={kind:'image',source:'/result',name:'Result',provenance:{model:'FLUX.3',prompt:'expanded blue request',promptExpansion:{request:{prompt:'Turn it blue'}},reference:original}};
history.record(original);history.record(result);history.useReference('/original');
let input,resolve;const operation={busy:()=>false,expand:async x=>{input=x;return new Promise(r=>resolve=r);},read:()=>({status:'complete'})};
const critic=createEditCritic({history,operation});
const run=critic.review();assert.equal(input.reference.source,'/original');assert.equal(input.resultImage.source,'/result');assert.match(input.prompt,/Turn it blue/);assert.match(input.prompt,/expanded blue request/);
resolve({task:'critique',text:'Still copper.\nNEXT EDIT:\nChange the body to blue.',stopReason:'eos',partial:false});await run;
assert.equal(history.read().viewed.editReview.assessment,'Still copper.');assert.equal(history.read().viewed.editReview.correction,'Change the body to blue.');
assert.equal(history.reference().source,'/original','review never changes conditioning');
assert.equal(critic.adopt('/result','Make it blue').source,'/result');assert.equal(history.reference().source,'/result');
history.view('/original');assert.throws(()=>critic.adopt('/result','Make it blue'),/viewed/);
assert.throws(()=>critic.request(),/saved edit/);
history.view('/result');const partial=critic.review();resolve({task:'critique',text:'Still copper.\nNEXT EDIT:\nChange',partial:true,stopReason:'output-limit'});await partial;
assert.equal(history.read().viewed.editReview.status,'partial');assert.throws(()=>critic.adopt('/result','Change'),/complete/);
const wrong=critic.review();resolve({task:'expand',text:'caption',partial:false,stopReason:'eos'});await assert.rejects(wrong,/review task/);
const malformed=critic.review();resolve({task:'critique',text:'A scene caption',partial:false,stopReason:'eos'});await malformed;
assert.equal(history.read().viewed.editReview.status,'unstructured');assert.equal(history.read().viewed.editReview.raw.text,'A scene caption');
const passed=critic.review();resolve({task:'critique',text:'The body is blue.\nNEXT EDIT:\nNONE',partial:false,stopReason:'eos'});await passed;
assert.equal(history.read().viewed.editReview.correction,'');assert.equal(history.read().viewed.editReview.status,'complete');
console.log('Edit critic: image/request identity, explicit adoption, stale, partial, wrong-task and unstructured returns pass');

// Exercise the real operation and visible controls, with deterministic model text.
function controls(history,operation){
 const nodes=new Map(),document={createElement:()=>({}),getElementById:id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',insertAdjacentElement(){}});return nodes.get(id);
 }};
 const ui=installEditCritic({document,history,operation,imageController:{busy:()=>false,read:()=>({})},onAdopt(){throw Error('Must not adopt failed review');}});
 return{ui,node:id=>document.getElementById(id)};
}
const freshHistory=()=>{const h=createImageIterationHistory();h.record(original);h.record(result);return h;};
test('failed handback preserves review under captured image identity',async()=>{
 const h=freshHistory();let release;
 const releaseGate=new Promise(r=>release=r),text='The body remains copper.\nNEXT EDIT:\nChange it to blue.';
 const op=createAuthoringPromptExpansion({createHelper:callbacks=>createPagePromptHelper({...callbacks,
  providerFactory:()=>({expand:async()=>({task:'critique',text,partial:false,stopReason:'eos'}),dispose:async()=>{}}),
  post:async body=>{if(body.action==='release'){await releaseGate;throw Error('release broke');}return{status:'held',leaseId:'critic-test'};},
 })});
 const {ui,node}=controls(h,op),run=ui.review();await new Promise(r=>setImmediate(r));
 h.view('/original');release();await run;
 const stored=h.read().entries.find(e=>e.source==='/result').editReview;
 assert.equal(stored?.status,'failed','failed handback must preserve review on the captured result');
 assert.equal(stored.raw.text,text);assert.match(stored.error,/release broke/);
 assert.equal(h.read().viewed.editReview,undefined,'view change must not move review to another image');
 h.view('/result');ui.render();assert.equal(node('asset-review-assessment').textContent,text);
 assert.equal(node('asset-review-use').hidden,true);assert.throws(()=>createEditCritic({history:h,operation:op}).adopt('/result','Blue'),/complete/);
});
test('cancelled streamed review remains visible and cannot leak to a rejected next operation',async()=>{
 const h=freshHistory(),text='The body is still copper.';
 const op=createAuthoringPromptExpansion({createHelper:()=>({expand:async options=>{
  options.onText(text);return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 },dispose:async()=>{}})});
 const {ui,node}=controls(h,op),run=ui.review();await new Promise(r=>setImmediate(r));
 h.view('/original');op.stop();await run;h.view('/result');ui.render();
 assert.equal(h.read().viewed.editReview?.status,'stopped','cancelled streamed text must remain in history');
 assert.equal(node('asset-review-assessment').textContent,text);assert.match(node('asset-review-status').textContent,/stopped|cancel/i);
 assert.equal(node('asset-review-use').hidden,true);
 // A rejected new attempt must not attach the previous operation's retained draft.
 const critic=createEditCritic({history:h,operation:{read:()=>op.read(),expand:async()=>{throw Error('blocked before admission');}}});
 const prior=h.read().viewed.editReview;await assert.rejects(critic.review(),/blocked/);assert.deepEqual(h.read().viewed.editReview,prior);
});
