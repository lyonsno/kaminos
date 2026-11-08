// kaminos-test: node
// Production factory accounting. Shader behavior is checked by native witnesses.
import assert from 'node:assert/strict';
import {createVolumeGPU} from '../experiments/hill-terrain/volume-gpu.mjs';
import {makeVolumeSpecimen} from '../experiments/hill-terrain/volume-model.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,INDIRECT:16,MAP_READ:32};
const calls=[],buffers=[];
const device={limits:{maxStorageBufferBindingSize:1e9,maxBufferSize:1e9,maxComputeWorkgroupsPerDimension:65535},addEventListener(){},removeEventListener(){},createBuffer(d){const b={...d,bytes:new ArrayBuffer(d.size),getMappedRange(){return this.bytes;},unmap(){},destroy(){}};buffers.push(b);return b;},createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async d=>({entry:d.compute.entryPoint,getBindGroupLayout:()=>({})}),createBindGroup:()=>({}),createCommandEncoder:()=>({clearBuffer(){},copyBufferToBuffer(){},beginComputePass(){let entry;return{setPipeline:p=>entry=p.entry,setBindGroup(){},dispatchWorkgroups:(...groups)=>calls.push({entry,groups}),dispatchWorkgroupsIndirect:()=>calls.push({entry,indirect:true}),end(){}};},finish:()=>({})}),queue:{writeBuffer(){},submit(){},onSubmittedWorkDone:async()=>{}}};
const model=makeVolumeSpecimen({fixture:'hundred-rocks',spacing:.5,contactIterations:8});const solver=await createVolumeGPU({device,model});
try{
 calls.length=0;await solver.advance(1);
 assert.equal(calls.filter(x=>x.entry==='generate_contacts').length,1,'Discover each unique contact once per physical step, outside constraint iterations');
 assert.equal(calls.filter(x=>x.entry==='solve_contacts').length,8);
 assert.equal(calls.filter(x=>x.entry==='gather_contacts').length,8);
 assert.ok(calls.filter(x=>x.entry==='solve_contacts').every(x=>x.indirect),'Constraint dispatch consumes the GPU contact count');
 assert.equal(calls.filter(x=>['contact_degrees','solve_rigid'].includes(x.entry)).length,0,'The old duplicate SAT route is no longer the physical solver');
 assert.equal(solver.read().contactGraph.kind,'unique source-convex contact patches');
 assert.equal(solver.read().contactGraph.capacity,4950,'One hundred bodies cannot have more than4950 unique pairs; this is a geometric bound, not a neighbor cap');
 assert.equal(solver.read().materialReadbackInRuntime,false);
}finally{solver.dispose();}
