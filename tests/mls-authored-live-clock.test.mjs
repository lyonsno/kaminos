// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
import {createAuthoredMlsHostFixture} from './helpers/authored-mls-host.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
const saved=globalThis.fetch;
globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});
let now=0,complete;
const pending=()=>new Promise(resolve=>complete=resolve);
let completion=Promise.resolve();
const device={createBuffer:({size})=>({getMappedRange:()=>new ArrayBuffer(size),unmap(){},destroy(){}}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
  createComputePipelineAsync:async()=>({getBindGroupLayout(){return {};}}),createBindGroup:()=>({}),
  createCommandEncoder:()=>({clearBuffer(){},copyBufferToBuffer(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})}),
  queue:{writeBuffer(){},submit(){},onSubmittedWorkDone:()=>completion}};
let solver;
const fixture=await createAuthoredMlsHostFixture();
try{
 // Use the production authored host's selected scheduling configuration.
 // GPU occupancy itself is exercised by the separate native source witness.
 solver=await createMlsJuiceSolver({device,setup:{...fixture.solverOptions.setup,particleCount:2,trackPopulation:false},packet:{authority:{simulation_safe:false},emitters:[]},now:()=>now});
 solver.advance(0);
 for(let frame=1;frame<=30;frame++){
  now=frame*1000/30;completion=pending();solver.advance(now);
  now+=20;complete();await new Promise(resolve=>setImmediate(resolve));
 }
 assert.equal(solver.read().clock.completedStep,240,'Normal authored stepping must keep processing elapsed time when each prior batch has completed');
 assert(solver.read().clock.backlogSeconds<1/240,'Default scheduling must not build seconds of avoidable lag from queue-completion latency');
 solver.setPaused(true);solver.advance(now=2000);assert.equal(solver.read().clock.completedStep,240);
}finally{solver?.dispose();fixture.host.dispose();globalThis.fetch=saved;}
console.log('Authored live clock follows continuing wall-time arrivals without avoidable backlog');
