// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {installGenerationFlame} from '../authoring-generation-flame.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(createRenderer){
 const element=()=>({hidden:false,dataset:{},append(){},setAttribute(){},remove(){},getAnimations:()=>[],animate(){}});
 const document={createElement:element,getElementById:()=>({value:'keep my prompt'})};
 const view=installGenerationFlame({document,slot:element(),createRenderer});view.setVisible(true);return view;
}
test('ending a generation cancels flame startup while the app GPU is still unavailable',async()=>{
 let signal;
 const flame=fixture((_,options)=>{signal=options?.signal;return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
 flame.render({status:'loading'});await tick();
 assert.ok(signal instanceof AbortSignal,'renderer startup needs cancellation');
 flame.render({status:'failed'});await tick();
 assert.equal(signal.aborted,true);assert.equal(flame.read().error,null);
 await flame.dispose();
});
test('a renderer that resolves after stop never starts and is disposed with its owner',async()=>{
 let finish,started=0,destroyed=0;
 const flame=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 flame.render({status:'loading'});await tick();flame.render({status:'complete'});
 finish({setActive:async active=>{if(active)started++;},dispose(){destroyed++;},debugState:()=>({})});
 await tick();assert.equal(started,0);await flame.dispose();assert.equal(destroyed,1);
});
test('the physical kiln receives the admitted prompt rather than a changing editor draft',async()=>{
 let received;const flame=fixture(async(_slot,options)=>{received=options.prompt;return {setActive:async()=>{},setPrompt:async()=>{},dispose(){},debugState:()=>({})};});
 flame.render({status:'loading',request:{id:'actual-run',prompt:'THE ADMITTED PROMPT'}});await tick();await tick();assert.equal(received,'THE ADMITTED PROMPT');await flame.dispose();
});
test('persistence-only retry does not restart the completed physical burn',async()=>{
 let starts=0,active=false;
 const flame=fixture(async(_slot,{signal})=>({async setActive(value){if(value){starts++;signal.throwIfAborted();}active=value;},dispose(){},debugState:()=>({active})}));
 const request={id:'pending-pixels',prompt:'THE SAME PIXELS'};flame.render({status:'running',request});await tick();await tick();flame.render({status:'failed',request});await tick();await tick();flame.render({status:'saving',request});await tick();await tick();
 assert.equal(flame.read().error,null);assert.equal(starts,1);assert.equal(active,false);assert.equal(flame.read().running,false);await flame.dispose();
});
test('temporarily hiding an in-progress kiln pauses and retains its physical state',async()=>{
 let created=0,destroyed=0,active=false;const flame=fixture(async()=>{created++;return {async setActive(value){active=value;},dispose(){destroyed++;},debugState:()=>({active})};});
 flame.render({status:'running',request:{id:'same-burn',prompt:'RETAIN THIS BURN'}});await tick();await tick();await flame.setVisible(false);assert.equal(active,false);assert.equal(destroyed,0);await flame.setVisible(true);assert.equal(created,1);assert.equal(active,true);await flame.dispose();assert.equal(destroyed,1);
});
test('loading prepares the admitted text without igniting; subsequent requests retain the prepared consumer',async()=>{
 let created=0,starts=0;const prepared=[];
 const flame=fixture(async(_slot,options)=>{created++;prepared.push(options.prompt);return {async prepare({prompt}){prepared.push(prompt);},async setActive(active){if(active)starts++;},dispose(){},debugState:()=>({})};});
 const first={id:'first',prompt:'FIRST ADMITTED'};
 flame.render({status:'loading',request:first});await tick();await tick();assert.equal(starts,0,'model loading must remain cold');
 flame.render({status:'running',request:first});await tick();await tick();assert.equal(starts,1);
 flame.render({status:'complete',request:first});await tick();
 flame.render({status:'loading',request:{id:'second',prompt:'SECOND ADMITTED'}});await tick();await tick();
 assert.equal(created,1,'new prompt must reuse the prepared consumer');assert.ok(prepared.includes('SECOND ADMITTED'));await flame.dispose();
});
test('document reset disposes the old consumer and re-entry prepares the current admitted request',async()=>{
 let created=0,destroyed=0;const prompts=[];
 const flame=fixture(async(_slot,options)=>{created++;prompts.push(options.prompt);return {prepare:async({prompt})=>prompts.push(prompt),setActive:async()=>{},dispose(){destroyed++;},debugState:()=>({})};});
 await tick();flame.render({status:'running',request:{id:'live',prompt:'ADMITTED WORDS'}});await tick();await tick();
 await flame.reset();assert.equal(destroyed,1);assert.equal(flame.read().renderer,null);
 await flame.setVisible(true);assert.equal(created,2);assert.equal(prompts.at(-1),'ADMITTED WORDS');await flame.dispose();
});
test('completion releases admission when combustion is unavailable without restarting it',async()=>{
 let completed=0,starts=0;
 const flame=fixture(async()=>({prepare:async()=>{},async setActive(active){if(active){starts++;throw Error('Combustion is not connected');}},complete(){completed++;},dispose(){},debugState:()=>({})}));
 const request={id:'one',prompt:'ADMITTED'};flame.render({status:'running',request});await tick();await tick();assert.match(flame.read().error,/not connected/);
 flame.render({status:'saving',request});await tick();flame.render({status:'complete',request});await tick();await tick();
 assert.equal(completed,1);assert.equal(starts,1);assert.equal(flame.read().error,null);await flame.dispose();
});
