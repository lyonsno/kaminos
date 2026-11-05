// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
import {createAuthoredMlsHostFixture} from './helpers/authored-mls-host.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
const saved=globalThis.fetch;globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});
const tick=()=>new Promise(r=>setImmediate(r));let now=0,finish,notifications=0;
const device={createBuffer:({size})=>({getMappedRange:()=>new ArrayBuffer(size),unmap(){},destroy(){}}),createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBindGroup:()=>({}),createCommandEncoder:()=>({clearBuffer(){},copyBufferToBuffer(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})}),queue:{writeBuffer(){},submit(){},onSubmittedWorkDone:()=>new Promise(r=>{finish=r;})}};
let solver;
try{
 solver=await createMlsJuiceSolver({device,setup:{particleCount:2},packet:{authority:{simulation_safe:false},emitters:[]},now:()=>now,onBatchComplete(){notifications++;assert.equal(solver.read().pending,false);solver.advance(now);}});
 solver.advance(0);solver.advance(now=20);assert.equal(solver.read().clock.step,4);
 const first=finish;now=40;first();await tick();assert.equal(notifications,1,'Completion must notify the host after releasing single-flight admission');assert.equal(solver.read().clock.step,9,'Due work can continue before another render frame');assert.equal(solver.read().cadence.completedStep,4);
 solver.setPaused(true);finish();await tick();assert.equal(solver.read().clock.step,9,'Pause must prevent a callback from submitting more work');
 solver.setPaused(false);solver.advance(now=60);const afterDispose=finish;solver.dispose();afterDispose();await tick();assert.equal(notifications,2,'Disposed solver must not notify its former host');
}finally{solver?.dispose();globalThis.fetch=saved;}
const f=await createAuthoredMlsHostFixture();try{
 let calls=0;f.solver.advance=()=>{calls++;};assert.equal(typeof f.solverOptions.onBatchComplete,'function','Authored host must consume completion notification');
 f.host.render({advance:true,maxSteps:6});assert.equal(calls,1);f.solverOptions.onBatchComplete();assert.equal(calls,2);
 f.host.setPaused(true);f.solverOptions.onBatchComplete();assert.equal(calls,2);
 f.host.setPaused(false);f.host.render({advance:false});const count=calls;f.solverOptions.onBatchComplete();assert.equal(calls,count,'Coordinator deferral must hold completion-driven work');
 f.host.dispose();f.solverOptions.onBatchComplete();assert.equal(calls,count);
}finally{f.host.dispose();}
console.log('Completion continues due water work without render-frame wait, preserving pause, deferral and disposal');
