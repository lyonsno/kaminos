// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
const saved=globalThis.fetch;globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});
const writes=[],pipelines=[],buffers=[];let complete;let completion=Promise.resolve();
const device={createBuffer:options=>{const b={...options,destroy(){}};buffers.push(b);return b;},createShaderModule:options=>({...options,getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async options=>{pipelines.push(options);return {getBindGroupLayout:()=>({})};},createBindGroup:()=>({}),createCommandEncoder:()=>({clearBuffer(){},copyBufferToBuffer(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})}),queue:{writeBuffer:(b,o,data)=>writes.push({label:b.label,data:Array.from(data)}),submit(){},onSubmittedWorkDone:()=>completion}};
let solver;try{
 solver=await createMlsJuiceSolver({device,setup:{particleCount:64,cellSize:.05,trackPopulation:false},packet:{authority:{simulation_safe:false},emitters:[]},now:()=>0});
 assert.equal(typeof solver.setMaterial,'function','Material must be editable without constructing another solver');
 const allocation=solver.particles,pipelineCount=pipelines.length,bufferCount=buffers.length;
 solver.advance(0);completion=new Promise(resolve=>complete=resolve);solver.advance(20);
 const previous=solver.read().material.world;
 solver.setMaterial({pressureWaveSpeed:2,kinematicViscosity:.001});
 assert.deepEqual(solver.read().material.world,previous,'Submitted work retains its active material');
 assert.equal(solver.read().pendingMaterial.pressureWaveSpeed,2);
 solver.setMaterial({pressureWaveSpeed:3,kinematicViscosity:.002});
 assert.throws(()=>solver.setMaterial({pressureWaveSpeed:-1,kinematicViscosity:0}));
 assert.equal(solver.read().pendingMaterial.pressureWaveSpeed,3,'Invalid edits must not replace accepted pending material');
 complete();await new Promise(resolve=>setImmediate(resolve));completion=Promise.resolve();solver.advance(40);
 assert.equal(solver.read().material.world.pressureWaveSpeed,3);
 assert.equal(solver.read().pendingMaterial,null);
 assert.equal(solver.particles,allocation);assert.equal(pipelines.length,pipelineCount);assert.equal(buffers.length,bufferCount);
 const materialWrites=writes.filter(w=>w.label==='MLS live material');assert.equal(materialWrites.length,2,'Only initial and latest accepted coefficients upload');
 const p=pipelines.find(p=>p.compute.entryPoint==='p2g_2');assert.match(p.compute.module.code,/material\.x/);assert.equal(p.compute.constants.stiffness,undefined);
}finally{solver?.dispose();globalThis.fetch=saved;}
console.log('MLS material updates coalesce at submission boundaries without allocations or pipeline compilation');
