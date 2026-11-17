// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
const url=new URL('../authoring-trellis-operation.mjs',import.meta.url);
const module=await import(url).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND'&&e.url===url.href)return {};throw e;});
const create=options=>{assert.equal(typeof module.createTrellisAuthoringOperation,'function','actual TRELLIS page composition must be reusable inside the scene worker');return module.createTrellisAuthoringOperation(options);};
const pixels=new Float32Array(512*512*3),glb=new Uint8Array([103,108,84,70,2,0,0,0,12,0,0,0]).buffer;
function fixture(options={}){
 const calls=[],device={features:new Set(['shader-f16'])},app={device};
 const deps={
  './authoring-trellis-page.mjs':{createTrellisPageCheckpoints:async()=>({manifest:{pipelineType:'512',image:{}},manifestSha256:'observed',fetchTensor:async()=>pixels}),
   runTrellisInPage:async options=>{calls.push(['run',options]);return {glb,runId:options.runId,route:'trellis2.image-generation.webgpu.v0',timing:{scheduling:{kind:'per-duty-fence-task'}},receiptValidation:{ok:true}};}},
  './models/trellis2/mesh-cleanup.js':{createBrowserMeshPostprocess:options=>{calls.push(['cleanup',options]);return async m=>m;}},
  './models/trellis2/wasm-xatlas.js':{createWasmXatlasUnwrapper:options=>{calls.push(['unwrap',options]);return async m=>m;}},
  './models/trellis2/material-bake.js':{createBrowserMaterialBaker:()=>async()=>({})},
 };
 const operation=create({appGpuHost:async()=>app,target:'scene-worker',request:async()=>({ok:true,json:async()=>({trellisPage:{mounted:true}})}),
  loadModule:async path=>{assert.ok(deps[path],path);return deps[path];},WorkerClass:class{},...options});
 return {operation,calls,device,app,deps};
}
test('ordinary TRELLIS operation retains actual host, sampler forwarding and finishing defaults without page globals',async()=>{
 const h=fixture(),out=await h.operation.run({pixels,scheduling:'per-duty-fence-task',textureSize:4096});
 const run=h.calls.find(x=>x[0]==='run')[1];assert.equal(run.appGpu,h.app);assert.equal(run.pixelValues,pixels);
 assert.equal(run.scheduling,'per-duty-fence-task');assert.equal(run.textureSize,4096);assert.equal(run.decoderActivationStorage,'f16');
 assert.equal(run.onPreview,undefined,'no success-shaped optional history observer');
 assert.equal(out.generation.runId,run.runId);assert.equal(out.generation.scheduling.kind,'per-duty-fence-task');
 assert.equal(out.generation.target,'scene-worker');
 assert.equal(out.generation.history,undefined,'an unmounted worker history owner must not advertise a saved history URL');
 assert.equal(h.calls.find(x=>x[0]==='cleanup')[1].mode,'original-remesh');assert.equal(h.calls.find(x=>x[0]==='cleanup')[1].device,h.device);
 await h.operation.retire();
});
test('command currentness is checked before executing a fetched checkpoint and before publishing completed output',async()=>{
 const h=fixture();let current=false;
 const assertCurrent=()=>{if(!current)throw Object.assign(Error('stale operation'),{name:'AbortError'});};
 await assert.rejects(h.operation.run({pixels,assertCurrent}),{name:'AbortError'});assert.equal(h.calls.length,0);
 current=true;h.deps['./authoring-trellis-page.mjs'].runTrellisInPage=async()=>{current=false;return {glb,route:'trellis',runId:'r'};};
 await assert.rejects(h.operation.run({pixels,assertCurrent}),{name:'AbortError'});
});

function opaquePhoto(t,loadRunnerModule){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'ImageDecoder');
 Object.defineProperty(globalThis,'ImageDecoder',{configurable:true,value:class{
  async decode(){return {complete:true,image:{format:'RGBA',codedWidth:1,codedHeight:1,
   async copyTo(out){out.set([200,100,50,255]);},close(){}}};}close(){}
 }});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'ImageDecoder',previous);else delete globalThis.ImageDecoder;});
 let h;h=fixture({request:async path=>path==='/api/runtime-config'
  ?{ok:true,json:async()=>({trellisPage:{mounted:true}})}
  :{ok:true,blob:async()=>new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'})},
  loadModule:async path=>path==='./models/u2net/u2net-webgpu.js'?loadRunnerModule():h.deps[path]});
 h.deps['./authoring-trellis-page.mjs'].createTrellisPageCheckpoints=async()=>({manifest:{pipelineType:'512'},manifestSha256:'fixture'});
 h.deps['./models/trellis2/alpha-preparation.js']={prepareTrellisAlphaRgba:async()=>{throw Error('prepared runner reached');}};
 h.deps['./models/trellis2/generation-inputs.js']={normalizePreparedTrellisRgb:()=>assert.fail('not a generation test')};
 h.deps['./models/u2net/rembg-u2net.js']={removeForegroundU2Net:async input=>({rgba:input.pixels,width:1,height:1,provenance:{route:'fixture'}})};
 h.app.beginRun=async()=>({finish:async()=>{}});h.app.queue={onSubmittedWorkDone:async()=>{}};
 h.photo=()=>h.operation.run({image:{source:'/opaque.png'}});return h;
}

for(const phase of ['module','package','runner'])test(`failed U2Net ${phase} initialization permits retirement and a new attempt`,async t=>{
 let attempts=0,disposed=0,settled=0,fail=true;
 const failed=()=>{if(fail){fail=false;throw Error('checkpoint initialization failed');}};
 const h=opaquePhoto(t,async()=>{attempts++;if(phase==='module')failed();return {
  loadU2NetPackage:async()=>{if(phase==='package')failed();return {};},
  createU2NetRunner:()=>{if(phase==='runner')failed();return {dispose(){disposed++;}};},
 };});
 h.app.queue.onSubmittedWorkDone=async()=>{settled++;};
 await assert.rejects(h.photo(),/checkpoint initialization failed/);
 await h.operation.retire();assert.equal(disposed,0);
 await assert.rejects(h.photo(),/prepared runner reached/);
 assert.equal(attempts,2,'a rejected initialization must not remain the cached runner');
 await h.operation.retire();assert.equal(disposed,1);assert.equal(settled,1);
});

test('retirement awaiting an in-flight failed initialization completes without hiding the run failure',async t=>{
 let reject,entered;const started=new Promise(resolve=>entered=resolve);
 const h=opaquePhoto(t,()=>{entered();return new Promise((_resolve,fail)=>reject=fail);});
 const run=assert.rejects(h.photo(),/checkpoint initialization failed/);await started;
 const retired=h.operation.retire();reject(Error('checkpoint initialization failed'));
 await run;await retired;
});

test('a live U2Net runner stays owned when queue settlement fails and is disposed after retry',async t=>{
 let disposed=0,settled=0;
 const h=opaquePhoto(t,async()=>({loadU2NetPackage:async()=>({}),createU2NetRunner:()=>({dispose(){disposed++;}})}));
 h.app.queue.onSubmittedWorkDone=async()=>{if(++settled===1)throw Error('queue not settled');};
 await assert.rejects(h.photo(),/prepared runner reached/);
 await assert.rejects(h.operation.retire(),/queue not settled/);assert.equal(disposed,0);
 await h.operation.retire();assert.equal(disposed,1);assert.equal(settled,2);
 await h.operation.retire();assert.equal(disposed,1);
});
