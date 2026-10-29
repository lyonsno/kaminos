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

// A queued authored step must validate the inlet current when GPU work starts.
// Rendering can publish a newer inlet while advanceTo awaits the prior work.
const epochNow=Date.now;
let epoch=100;
Date.now=()=>epoch;
globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});
const inlet=()=>({authority:{simulation_safe:true},timestamp_ms:epoch,emitters:[{id:'live',active:true,origin_world:[0,1,0],aim_world:[0,-1,0],radius:.04,strength:1,source_flux_particles_per_second:240,lifetime_seconds:6}]});
try{
  completion=Promise.resolve();
  solver=await createMlsJuiceSolver({device,setup:{particleCount:4},packet:inlet(),now:()=>now});
  completion=pending();
  const stepping=solver.advanceTo(1);
  epoch=101;solver.setPacket(inlet());complete();await stepping;
  assert.equal(solver.read().liveInlets.totalAdmitted,1,'newer authored inlet was rejected using the pre-wait timestamp');
  epoch=2000;await solver.advanceTo(2);
  assert.equal(solver.read().liveInlets.totalAdmitted,1,'stale inlet freshness must still reject emission');
  epoch=2001;solver.setPacket(inlet());await solver.advanceTo(3,2000);
  assert.equal(solver.read().liveInlets.totalAdmitted,1,'explicit earlier assay epoch must remain authoritative');
}finally{solver?.dispose();Date.now=epochNow;globalThis.fetch=saved;}
console.log('Queued authored stepping uses execution-time inlet freshness');
