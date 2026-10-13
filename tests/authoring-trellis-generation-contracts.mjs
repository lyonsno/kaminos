import test from 'node:test';import assert from 'node:assert/strict';
import * as module from '../authoring-trellis-generation.mjs';
const {createTrellisAuthoringGeneration,TRELLIS_PIPELINE_ID}=module;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
const glb=new Uint8Array([0x67,0x6c,0x54,0x46,2,0,0,0,12,0,0,0]).buffer;
const okResult={schema:'kaminos.pipeline-run-result.v0',ok:true,pipelineId:TRELLIS_PIPELINE_ID,runId:'run-7',report:{document:{artifacts:{mesh:{role:'textured-mesh',path:'/runs/run-7/artifacts/trellis-output.glb'}}}}};
const input={source:'/api/read?root=image-inbox&path=lantern.png',name:'klein-lantern-s1.png',label:'klein-lantern-s1.png',preparation:{original:{sha256:'a'.repeat(64)}}};

function harness({result=okResult,gate=null,availability={status:'available',message:'Queued WebGPU with local mesh finishing'},persistFails=0}={}){
 const calls=[],persisted=[];let failures=persistFails;
 const service=createTrellisAuthoringGeneration({
  availability:()=>availability,
  runPipeline:async(payload,{onProgress})=>{calls.push(payload);onProgress({schema:'kaminos.pipeline-progress.v0',phase:'queued',message:'Waiting for the GPU Greenroom'});
   onProgress({schema:'kaminos.pipeline-progress.v0',phase:'running',message:'Preparing and generating the selected image'});if(gate)await gate.promise;return result;},
  meshUrl:run=>run.report?.document?.artifacts?.mesh?.path?`/api/read?root=pipeline-runs&path=${run.runId}/artifacts/trellis-output.glb`:null,
  fetchBytes:async url=>{calls.push({fetched:url});return glb;},
  persist:async(bytes,generation,label)=>{if(failures-->0)throw Error('disk');persisted.push({bytes,generation,label});return{source:'/api/read?root=generated-meshes&path=x.glb',name:`${label} · TRELLIS.glb`,generation};},
 });
 return {service,calls,persisted};
}

test('a selected image runs the queued TRELLIS route and its fresh GLB is saved for Add',async()=>{
 const h=harness();
 const saved=await h.service.run(input);
 assert.deepEqual(h.calls[0],{pipelineId:TRELLIS_PIPELINE_ID,source:input.source,streamProgress:true,clientRunId:h.calls[0].clientRunId});
 assert.match(h.calls[0].clientRunId,/^authoring-trellis-/);
 assert.deepEqual(h.calls[1],{fetched:'/api/read?root=pipeline-runs&path=run-7/artifacts/trellis-output.glb'});
 assert.equal(h.persisted.length,1);assert.equal(h.persisted[0].bytes.byteLength,12);
 const generation=h.persisted[0].generation;
 assert.equal(generation.schema,'kaminos.asset-generation.v1');assert.equal(generation.route,'trellis2.image-generation.webgpu.v0');
 assert.equal(generation.runId,'run-7');assert.equal(generation.input.sha256,'a'.repeat(64));assert.deepEqual(generation.receiptValidation,{ok:true,by:'trellis-greenroom-adapter'});
 assert.equal(saved.name,'klein-lantern-s1 · TRELLIS.glb');
 const state=h.service.read();assert.equal(state.status,'complete');assert.equal(state.percent,100);assert.equal(state.results.length,1);
});

test('progress shows the queue phase without inventing a percentage, and the run cannot be stopped from the page',async()=>{
 const gate=deferred(),h=harness({gate});const run=h.service.run(input);await tick();
 const state=h.service.read();assert.equal(state.status,'running');assert.equal(state.stage,'Generating');assert.equal(state.percent,null);
 assert.match(state.progress,/Preparing and generating/);assert.equal(state.canStop,false);assert.equal(h.service.stop(),false);
 await assert.rejects(h.service.run(input),/already running/);
 gate.resolve();await run;
});

test('a failed or meshless pipeline result fails loud and saves nothing',async()=>{
 for(const result of [{...okResult,ok:false,error:'queued TRELLIS generation failed: execution'},{...okResult,report:{document:{artifacts:{}}}}]){
  const h=harness({result});
  await assert.rejects(h.service.run(input),/TRELLIS/);
  assert.equal(h.persisted.length,0);assert.equal(h.service.read().status,'failed');
 }
});

test('a computed mesh survives a storage failure and retries without another generation',async()=>{
 const h=harness({persistFails:1});
 await assert.rejects(h.service.run(input),/disk/);
 assert.ok(h.service.read().pending);const runs=h.calls.filter(c=>c.pipelineId).length;
 await h.service.retryPersistence();assert.equal(h.calls.filter(c=>c.pipelineId).length,runs);assert.equal(h.service.read().status,'complete');
});

test('an unconfigured server makes TRELLIS unavailable with its own setup message',async()=>{
 const h=harness({availability:{status:'unconfigured',message:'Local TRELLIS setup required'}});
 assert.equal(h.service.read().status,'unavailable');assert.equal(h.service.read().error,'Local TRELLIS setup required');
 await assert.rejects(h.service.run(input),/Local TRELLIS setup required/);assert.equal(h.calls.length,0);
});
