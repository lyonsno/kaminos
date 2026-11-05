// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
globalThis.GPUMapMode={READ:1};
const saved=globalThis.fetch;globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});
let passes=0,now=0;
const device={createBuffer:({size})=>({mapAsync:async()=>{},getMappedRange:()=>new ArrayBuffer(size),unmap(){},destroy(){}}),createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout(){return {};}}),createBindGroup:()=>({}),createCommandEncoder:()=>({clearBuffer(){},copyBufferToBuffer(){},beginComputePass(){passes++;return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish:()=>({})}),queue:{writeBuffer(){},submit(){},onSubmittedWorkDone:async()=>{}}};
let solver;
try{
 solver=await createMlsJuiceSolver({device,setup:{particleCount:20,trackPopulation:true},packet:{authority:{simulation_safe:false},emitters:[]},now:()=>now});
 solver.advance(0);now=1000;await solver.advanceTo(240);solver.setPaused(false);
 assert.equal(passes,0,'An initially empty solver must not dispatch 240 empty physical steps');
 assert.equal(solver.read().clock.step,240,'Explicit empty stepping still advances the physical clock');
 assert.equal(solver.read().clock.completedStep,240);
 assert.equal(solver.read().population.active,0);
 solver.setPacket({authority:{simulation_safe:true},timestamp_ms:Date.now(),emitters:[{id:'source',active:true,origin_world:[0,1,0],aim_world:[0,-1,0],radius:.04,strength:1,source_flux_particles_per_second:240,lifetime_seconds:6}]});
 solver.advance(now=1010);assert.ok(passes>0,'Opening the source resumes simulation in the same call');
}finally{solver?.dispose();globalThis.fetch=saved;}
console.log('Empty water skips physical dispatch and resumes on births');
