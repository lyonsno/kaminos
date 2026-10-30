// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,COPY_SRC:4,UNIFORM:64,MAP_READ:1};
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});
let now=0,queries=0,passes=[],resolved=[],finish;
const device={features:new Set(['timestamp-query']),
 createQuerySet:()=>{queries++;return {destroy(){}};},
 createBuffer:({size,label})=>({mapAsync:async()=>{},getMappedRange:()=>{
  const bytes=new ArrayBuffer(size);
  if(label==='kaminos.gpu-timing.readback')new BigUint64Array(bytes).set([1000000n,3000000n]);
  return bytes;
 },unmap(){},destroy(){}}),
 createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
 createComputePipelineAsync:async()=>({getBindGroupLayout(){return {};}}),createBindGroup:()=>({}),
 createCommandEncoder:()=>({clearBuffer(){},copyBufferToBuffer(){},resolveQuerySet(...args){resolved.push(args);},beginComputePass(options){passes.push(options);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish:()=>({})}),
 queue:{writeBuffer(){},submit(){},onSubmittedWorkDone:()=>new Promise(resolve=>finish=resolve)}};
const options={device,setup:{particleCount:2},packet:{authority:{simulation_safe:false},emitters:[]},now:()=>now};
let solver;
try{
 solver=await createMlsJuiceSolver({...options,profile:true});
 solver.advance(0);solver.advance(now=1000/240);
 assert.equal(queries,1,'Requested native GPU timing must use the shared timestamp timer');
 const writes=passes.flatMap(p=>p?.timestampWrites?[p.timestampWrites]:[]);
 assert.equal(writes.length,2);assert.equal(writes[0].beginningOfPassWriteIndex,0);
 assert.equal(writes[0].endOfPassWriteIndex,undefined);
 assert.equal(writes[1].beginningOfPassWriteIndex,undefined);
 assert.equal(writes[1].endOfPassWriteIndex,1);
 assert.equal(resolved.length,1,'Resolve only after the final simulation pass');
 assert.equal(solver.read().pending,true,'Profiling readback must not masquerade as simulation completion');
 now+=40;finish();await new Promise(resolve=>setImmediate(resolve));
 const trace=solver.read().timing;
 assert.equal(trace.authority,'gpu-timestamp-query');
 assert.equal(trace.batches.length,1);assert.equal(trace.batches[0].steps,1);
 assert.equal(trace.batches[0].gpuMs,2);assert.equal(trace.batches[0].gpuStatus,'resolved');
 assert.equal(trace.batches[0].submitToCompletionMs,40,'CPU-visible completion must remain distinct from GPU execution time');
 assert.equal(solver.read().clock.completedStep,1);
 solver.dispose();queries=0;passes=[];resolved=[];
 solver=await createMlsJuiceSolver(options);
 assert.equal(solver.read().timing.status,'disabled');assert.equal(queries,0);
 solver.dispose();device.features.clear();
 solver=await createMlsJuiceSolver({...options,profile:true});
 assert.equal(solver.read().timing.status,'unavailable','Missing timestamps cannot be replaced with wall-clock estimates');
 assert.equal(queries,0);
}finally{solver?.dispose();globalThis.fetch=originalFetch;}
console.log('MLS diagnostics separate actual GPU batch cost from completion latency without changing progression');
