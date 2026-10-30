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
  solver=await createMlsJuiceSolver({device,setup:{particleCount:2},packet:{authority:{simulation_safe:false},emitters:[]},now:()=>now});
  solver.advance(now=0);completion=pending();solver.advance(now=100);
  solver.setPaused(true);solver.advance(now=200);solver.advance(now=1000);
  complete();await new Promise(resolve=>setImmediate(resolve));
  solver.setPaused(false);solver.advance(now=1100);
  assert.equal(solver.read().clock.simulatedSeconds,.2,'paused pending interval entered simulation');
  assert.equal(solver.read().clock.elapsedSeconds,.2);
}finally{solver?.dispose();globalThis.fetch=saved;}
console.log('Pending GPU pause excludes held time');
