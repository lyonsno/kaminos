import assert from 'node:assert/strict';
import {mountComposition} from '../kiln-cinematic.mjs';
import {defaultKilnCues} from '../kiln-cinematic-cues.mjs';
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function setup({deferPresentation=false}={}) {
  const elements=new Map();
  const element=()=>({style:{},classList:{add(){},toggle(){}},append(){},addEventListener(){},querySelector(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}});
  globalThis.document={createElement:element,head:element(),body:element()};
  globalThis.window={addEventListener(){}};
  globalThis.requestAnimationFrame=()=>1;
  const requests=[],objects=new Set(),staged=[];
  let next=0;
  const presentation=deferred();
  globalThis.fetch=()=>{const request=deferred();requests.push(request);return request.promise;};
  const host={cinematic:{available:()=>false,read:()=>defaultKilnCues(),begin(){},end(){},hideOutputs(){},
    contains:id=>objects.has(id),findOutput:()=>null,
    stage(id,options){assert.ok(objects.has(id));staged.push({id,options});}},
    async presentGlb(bytes,{signal}){
      if(deferPresentation)await presentation.promise;
      signal?.throwIfAborted();
      const id=`object-${++next}`;objects.add(id);return {status:'registered',objectId:id};
    }};
  const api=await mountComposition({host});
  const resolve=()=>requests.at(-1).resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
  return {api,requests,objects,staged,presentation,resolve};
}
{
  const s=await setup();const pending=s.api.preview();s.api.stop();s.resolve();await pending;
  assert.equal(s.objects.size,0,'stopped fetch may not register an object');
  assert.equal(s.api.state().failure,null,'stopped work may not overwrite current state');
}
{
  const s=await setup({deferPresentation:true});const pending=s.api.preview();s.resolve();
  await new Promise(resolve=>setImmediate(resolve));s.api.stop();s.presentation.resolve();await pending;
  assert.equal(s.objects.size,0,'stopped presentation may not register an object');
  assert.equal(s.api.state().failure,null);
}
{
  const s=await setup();const old=s.api.preview();s.api.stop();const current=s.api.preview();
  s.requests[0].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});await old;
  s.resolve();await current;
  assert.equal(s.objects.size,1);assert.equal(s.api.state().failure,null);
  s.api.stop();const replay=s.api.preview();await replay;
  assert.equal(s.staged.at(-1).options?.temporary,true,'replay staging is temporary');
  s.api.stop();s.objects.clear();const replaced=s.api.preview();s.resolve();await replaced;
  assert.equal(s.objects.size,1,'removed or replaced membership is recovered');
  assert.equal(s.api.state().failure,null);
}
console.log('Cinematic async cancellation, pose intent and membership recovery passed');
