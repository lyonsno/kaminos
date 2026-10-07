import test from 'node:test';import assert from 'node:assert/strict';
import * as generation from '../authoring-generation.mjs';
const {createAuthoringGeneration,generationProgress}=generation;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const source={image:{},identity:{source:'image',sha256:'input'}};
const result={glb:new ArrayBuffer(3),receiptValidation:{ok:true},receipt:{routeId:'observed'}};
test('progress uses producer stage percentages, never invents whole-run completion',()=>{
 assert.equal(typeof generationProgress,'function','producer percentages need an explicit presentation contract');
 assert.deepEqual(generationProgress('Two-stream duties 20/80 (25%)'),{message:'Two-stream duties 20/80 (25%)',stage:'Two-stream',percent:25});
 assert.equal(generationProgress('Running post-processor...').percent,null);
 assert.equal(generationProgress('Texture bake 4/8 (50%)').percent,50);
 assert.equal(generationProgress('Loading weights 10%').percent,10);
 assert.equal(generationProgress('bad 200%').percent,null);
});
test('Stop aborts the admitted producer and does not free the run until it settles',async()=>{
 const gate=deferred();let options,writes=0;
 const c=createAuthoringGeneration({loadInput:async()=>source,initialize:async()=>({run:async(_,o)=>{options=o;return gate.promise;}}),persist:async()=>writes++});
 const run=c.run({source:'image'});await new Promise(r=>setImmediate(r));assert.equal(c.read().canStop,true);
 options.onProgress('Two-stream duties 20/80 (25%)');assert.equal(c.read().percent,25);
 assert.equal(c.stop(),true);assert.equal(options.signal.aborted,true);assert.equal(c.read().status,'stopping');
 await assert.rejects(c.run({source:'image'}),/already running/);assert.throws(()=>options.onProgress('Post-processor duties 4/8 (50%)'),{name:'AbortError'});assert.equal(c.read().status,'stopping');
 gate.reject(Object.assign(Error('stopped at duty boundary'),{name:'AbortError'}));assert.equal(await run,null);assert.equal(c.read().status,'stopped');assert.equal(writes,0);assert.equal(c.read().canStop,false);
});
test('stopping during input or weights cannot launch inference afterward',async()=>{
 for(const phase of ['input','weights']){
  const gate=deferred();let runs=0;
  const c=createAuthoringGeneration({loadInput:async()=>phase==='input'?gate.promise:source,initialize:async()=>{if(phase==='weights')await gate.promise;return{run:async()=>{runs++;return result;}};},persist:async()=>({})});
  const run=c.run({source:'image'});await new Promise(r=>setImmediate(r));c.stop();gate.resolve(source);assert.equal(await run,null);assert.equal(runs,0);assert.equal(c.read().status,'stopped');
 }
});
test('a computed result wins the stop race and remains retryable without reinference',async()=>{
 const gate=deferred();let runs=0,writes=0;
 const c=createAuthoringGeneration({loadInput:async()=>source,initialize:async()=>({run:async()=>{runs++;return gate.promise;}}),persist:async()=>{if(++writes===1)throw Error('disk');return{name:'Retained',source:'stored'};}});
 const run=c.run({source:'image'});await new Promise(r=>setImmediate(r));c.stop();gate.resolve(result);await assert.rejects(run,/disk/);assert.equal(c.read().pending.glb.byteLength,3);await c.retryPersistence();assert.equal(runs,1);assert.equal(c.read().status,'complete');
});
test('Stop is unavailable while writing a completed mesh and save retry owns the active interval',async()=>{
 const gate=deferred();const c=createAuthoringGeneration({loadInput:async()=>source,initialize:async()=>({run:async()=>result}),persist:()=>gate.promise});
 const run=c.run({source:'image'});await new Promise(r=>setImmediate(r));assert.equal(c.read().status,'saving');assert.equal(c.stop(),false);gate.resolve({name:'Result'});await run;assert.equal(c.read().percent,100);
});

test('Stop does not disguise a device or foreground settlement failure as clean cancellation',async()=>{
 const gate=deferred();const c=createAuthoringGeneration({loadInput:async()=>source,initialize:async()=>({run:()=>gate.promise}),persist:async()=>({})});
 const run=c.run({source:'image'});await new Promise(r=>setImmediate(r));c.stop();gate.reject(Error('device lost while draining'));await assert.rejects(run,/device lost/);assert.equal(c.read().status,'failed');
});

// Replay the effective bundled executor, rather than assuming a producer stub
// will propagate a thrown progress callback. GPU queue tokens only establish
// orchestration here; the separate browser witness covers the effective device.
test('effective SF3D cooperative DINO executor stops after a settled duty on callback AbortError',async()=>{
 const {readFile,writeFile,mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {pathToFileURL}=await import('node:url');const sourceText=await readFile(new URL('../lib/sf3d/sf3d-producer.js',import.meta.url),'utf8');
 const scratch=await mkdtemp(`${tmpdir()}/modal-executor-`);let runCooperativeDino;
 try{await writeFile(`${scratch}/producer.mjs`,sourceText+'\nexport {runCooperativeDino};');({runCooperativeDino}=await import(pathToFileURL(`${scratch}/producer.mjs`)));}finally{await rm(scratch,{recursive:true});}
 const calls=[];let c;
 const producer={run:async(_,options)=>{
  const device={queue:{submit:buffers=>calls.push(['submit',buffers]),onSubmittedWorkDone:async()=>calls.push(['settled'])},createCommandEncoder:()=>({finish:()=>({command:'dino'})})};
  await runCooperativeDino({device,numBlocks:3,chunkBlocks:1,schedulingMode:'cooperative',tokenizer:{encodeCooperative:async({driver})=>{for(let i=0;i<3;i++)await driver(i,i+1,()=>{});return{};}},onProgress:p=>{if(p.completedItems===1)c.stop();options.onProgress(`DINOv2 blocks ${p.completedItems}/${p.totalItems} (${p.percent.toFixed(0)}%)`);}});
  return result;
 }};
 c=createAuthoringGeneration({loadInput:async()=>source,initialize:async()=>producer,persist:async()=>assert.fail('Canceled execution must not persist an output')});
 assert.equal(await c.run({source:'image'}),null);assert.equal(c.read().status,'stopped');assert.equal(calls.filter(r=>r[0]==='submit').length,1);assert.equal(calls.filter(r=>r[0]==='settled').length,1);
});

test('native Fetch AbortSignal preserves a stopped input result and prevents initialization',async()=>{
 let initializes=0;const c=createAuthoringGeneration({loadInput:async(_,options)=>{await fetch('data:text/plain,image',options);return source;},initialize:async()=>{initializes++;return{run:async()=>result};},persist:async()=>assert.fail('stopped input cannot be persisted')});
 const run=c.run({source:'image'});c.stop();assert.equal(await run,null);assert.equal(c.read().status,'stopped');assert.equal(c.read().terminal.error.name,'AbortError');assert.match(c.read().terminal.error.message,/stop/i);assert.equal(initializes,0);
});

test('bundled bounded-prefix cancellation with a rejected drain fence remains a failure',async()=>{
 const {readFile,writeFile,mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {pathToFileURL}=await import('node:url');const sourceText=await readFile(new URL('../lib/sf3d/sf3d-producer.js',import.meta.url),'utf8');
 const scratch=await mkdtemp(`${tmpdir()}/modal-bounded-`);let bundle;
 try{await writeFile(`${scratch}/producer.mjs`,sourceText+'\nexport {createWebGpuCooperativeExecution,createSf3dCooperativeRuntime,definePostProcessorChannelManifest};');bundle=await import(pathToFileURL(`${scratch}/producer.mjs`));}finally{await rm(scratch,{recursive:true});}
 let submits=0,fences=0,c;
 const producer={run:async(_,options)=>{
  const device={queue:{submit:()=>submits++,onSubmittedWorkDone:()=>++fences===1?Promise.resolve():Promise.reject(Error('second prefix fence rejected during cancellation drain'))}};
  const manifest=bundle.definePostProcessorChannelManifest(16),execution=bundle.createWebGpuCooperativeExecution({runtime:bundle.createSf3dCooperativeRuntime(device),manifest,invocationId:'stop-drain',schedulingMode:'cooperative',completionPolicy:'bounded-prefix',maxInFlightGpuDuties:2,onProgress:p=>{if(p.completedItems===1)c.stop();options.onProgress(`Post-processor duties ${p.completedItems}/${p.totalItems} (${p.percent.toFixed(0)}%)`);}});
  try{await execution.run(async facade=>{const gpu=facade.startBoundary(manifest.phases[0].boundaries[0].boundaryId);let range;while((range=gpu.nextRange()))await gpu.runGpuDuty(range,{encode:()=>({command:'post'})});});}catch(error){await bundle.finishProducerRunWithEvidence({prepared:{release:async()=>({status:'succeeded'})},pipelineFailed:true,pipelineError:error,runId:'stop-drain',lastProgress:'Post-processor',startedAtMs:0,deviceInjected:true,commit:'effective-bundle'});}
  return result;
 }};
 c=createAuthoringGeneration({loadInput:async()=>source,initialize:async()=>producer,persist:async()=>assert.fail('failed drain cannot persist an output')});
 await assert.rejects(c.run({source:'image'}),/second prefix fence/);assert.equal(c.read().status,'failed');assert.equal(submits,2);assert.equal(fences,2);assert.equal(c.read().terminal.cooperative.failure.secondaryFailures[0].phase,'queue-completion');
});

test('primitive producer rejections retain a visible reason and terminal evidence',async()=>{
 const c=createAuthoringGeneration({loadInput:async()=>source,initialize:async()=>({run:async()=>{throw 'producer rejection';}}),persist:async()=>assert.fail('no output')});await assert.rejects(c.run({source:'image'}),value=>value==='producer rejection');assert.equal(c.read().error,'inference: producer rejection');assert.equal(c.read().terminal.error.message,'producer rejection');
});
