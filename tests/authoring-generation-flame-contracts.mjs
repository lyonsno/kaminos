// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {installGenerationFlame} from '../authoring-generation-flame.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(createRenderer,options={}){
 const element=()=>({hidden:false,dataset:{},append(){},setAttribute(){},remove(){},getAnimations:()=>[],animate(){}});
 const document={createElement:element,getElementById:()=>({value:'keep my prompt'})};
 const view=installGenerationFlame({document,slot:element(),createRenderer,...options});view.setVisible(true);return view;
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

test('disabled kiln skips cold setup, refresh and active-request work until explicitly enabled',async()=>{
 let created=0,destroyed=0,active=false;
 const flame=fixture(async()=>{created++;return {setActive:async value=>{active=value;},dispose:async()=>{destroyed++;},debugState:()=>({active})};},{enabled:false});
 flame.render({status:'running',request:{id:'inference',prompt:'kept'}});await flame.refresh();await tick();
 assert.equal(created,0,'disabled means no renderer or simulation setup');assert.equal(flame.read().enabled,false);
 await flame.setEnabled(true);assert.equal(created,1);assert.equal(active,true);
 await flame.setEnabled(false);assert.equal(active,false);assert.equal(destroyed,1,'disable releases a running kiln rather than only hiding it');
 await flame.refresh();assert.equal(created,1);await flame.dispose();
});
test('disabling during asynchronous kiln setup aborts and disposes the late renderer without activation',async()=>{
 let finish,signal,starts=0,disposed=0;const flame=fixture((_,options)=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});
 await tick();const disabled=flame.setEnabled(false);assert.equal(signal.aborted,true);
 finish({setActive:async value=>{if(value)starts++;},dispose:async()=>disposed++,debugState:()=>({})});await disabled;
 assert.equal(starts,0);assert.equal(disposed,1);await flame.dispose();
});

test('the actual kiln checkbox still disables active and pending renderers when preferences cannot be written',async()=>{
 const {installGenerateLayout}=await import('../authoring-generate-layout.mjs');
 for(const pending of [false,true]){
  const nodes=new Map(),node=()=>({children:[],childNodes:[],dataset:{},style:{},hidden:false,value:'',textContent:'',classList:{toggle(){}},append(...c){this.children.push(...c);},prepend(){},before(){},after(){},remove(){},insertBefore(){},replaceChildren(...c){this.children=c;},setAttribute(){},getAttribute(){return null;},removeAttribute(){},addEventListener(){},querySelectorAll(){return [];},querySelector(s){return s.startsWith('#')?get(s.slice(1)):null;},closest(){return this;},getBoundingClientRect(){return {width:300,height:200};}});
  const get=id=>{if(id==='asset-text-image')return null;if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const document={getElementById:get,createElement:()=>{const e=node();Object.defineProperty(e,'id',{set(id){nodes.set(id,e);}});return e;},createTextNode:node,defaultView:{localStorage:{getItem:key=>key==='kaminos.generate-kiln.v1'?'{"disabled":false}':null,setItem(){throw Error('QuotaExceededError');}},addEventListener(){},IntersectionObserver:class{observe(){}}}};
  let finish,signal,disposed=0,active=false;const resource={async setActive(v){active=v;},async dispose(){disposed++;},debugState:()=>({active})};
  const layout=installGenerateLayout({document,createFlame:async(_slot,options)=>{signal=options.signal;return pending?new Promise(r=>finish=r):resource;}});
  layout.ceremony.render({status:'running',request:{id:'current'}});const visible=layout.ceremony.setVisible(true);await tick();
  get('asset-kiln-disabled').checked=true;const change=get('asset-kiln-disabled').onchange();
  assert.equal(layout.ceremony.read().enabled,false,'storage failure must not skip the operator choice');assert.equal(signal.aborted,true);
  if(pending)finish(resource);await change;await visible;
  assert.equal(active,false);assert.equal(disposed,1);await layout.ceremony.dispose();
 }
});
