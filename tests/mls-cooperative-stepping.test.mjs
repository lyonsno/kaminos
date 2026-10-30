// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
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
try{
 solver=await createMlsJuiceSolver({device,setup:{particleCount:2,cooperativeScheduling:{targetDurationMs:8}},packet:{authority:{simulation_safe:false},emitters:[]},now:()=>now});
 solver.advance(0);completion=pending();solver.advance(now=100);
 assert(solver.read().clock.step<24,'Cooperative fluid must publish an intermediate complete state instead of submitting every catch-up step');
 assert(Math.abs(solver.read().clock.simulatedSeconds+solver.read().clock.backlogSeconds-.1)<1e-12,'Unsubmitted time stays in backlog');
 const first=solver.read().clock.step;now=120;complete();await new Promise(resolve=>setImmediate(resolve));
 // No newer wall time: drain precisely the original .1 seconds over frames.
 completion=Promise.resolve();let previous=first,submissions=1;
 while(solver.read().clock.backlogSeconds>=1/240-1e-10){solver.advance(100);await new Promise(resolve=>setImmediate(resolve));assert(solver.read().clock.step>previous);previous=solver.read().clock.step;submissions++;}
 assert.equal(solver.read().clock.step,24);assert.equal(solver.read().clock.completedStep,24);assert(submissions>1);
 assert.equal(solver.read().cadence.scheduling.policy,'adaptive-complete-physical-steps');
 assert.equal(solver.read().cadence.scheduling.targetDurationMs,8);
 solver.setPaused(true);solver.advance(now=1000);assert.equal(solver.read().clock.step,24);
}finally{solver?.dispose();globalThis.fetch=saved;}
console.log('Cooperative complete-step publication retains all elapsed simulation time');
