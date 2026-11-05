// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
const url=new URL('../volume-inlet-perturbation-gpu.mjs',import.meta.url),api=existsSync(url)?await import(url):{};
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8};
test('steady inlet evolution submits a scalar clock and keeps lattice work resident',()=>{
 assert.equal(typeof api.createGPUStochasticSignalSet,'function','the inlet lattice must have a GPU evolution route');
 const writes=[],passes=[];const device={limits:{maxStorageBufferBindingSize:2**27,maxBufferSize:2**28,maxComputeWorkgroupsPerDimension:65535},createBuffer:s=>({...s,destroy(){}}),createShaderModule:s=>s,createComputePipeline:s=>({...s,getBindGroupLayout:()=>({})}),createBindGroup:s=>s,queue:{writeBuffer(buffer,offset,data){writes.push({buffer,bytes:data.byteLength});},onSubmittedWorkDone:async()=>{}}};
 const encoder={beginComputePass(){const p={};passes.push(p);return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(...count){p.count=count;},end(){}};}};
 const f=api.createGPUStochasticSignalSet(device,{seed:7,count:81,label:'test inlet'});try{const buffer=f.buffer,initial=writes.length;for(let i=0;i<4;i++)f.encode(encoder,i,30);assert.equal(f.buffer,buffer);assert.equal(writes.length-initial,4);assert.ok(writes.slice(initial).every(x=>x.bytes===16),'evolving the field uploads only its clock and OU coefficients');assert.equal(new Set(writes.slice(initial).map(x=>x.buffer)).size,4,'queued steps cannot overwrite each other before submission');assert.equal(passes.length,4);assert.deepEqual(passes[0].count,[2,1]);}finally{f.destroy();}
});
