import assert from 'node:assert/strict';
import {createBoundedResidentGrip} from '../structural-material-bounded-grip.js';
globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8,MAP_READ:16};globalThis.GPUShaderStage={COMPUTE:1};
const calls=[],device={createBuffer({size,label}){return{size,label,destroy(){}};},createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createBindGroupLayout:x=>x,createPipelineLayout:x=>x,createComputePipelineAsync:async({compute})=>compute,createBindGroup:x=>x,
 createCommandEncoder(){return{beginComputePass(){return{setPipeline(p){calls.push(p.entryPoint);},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish:()=>({})};},
 queue:{writeBuffer(){},submit(){calls.push('submit');},onSubmittedWorkDone(){throw new Error('Live grip waited for GPU');}}};
const resident={device,submittedState:()=>({model:{points:4,bonds:6}}),stateBuffer:()=>({}),bondBuffer:()=>({}),diagnosticsBuffer:()=>({}),async captureResidentPatch(anchor,k){calls.push(['anchor',anchor,k]);}};
const grip=await createBoundedResidentGrip(resident,Array(24).fill(1));await grip.begin(2,[0,0,0],.3,1000);
assert.deepEqual(calls[0],['anchor',2,1000]);assert.ok(calls.includes('unite'));assert.ok(calls.includes('capture'));assert.equal(calls.at(-1),'submit');
calls.length=0;const value=grip.update([0,.1,0]);assert.equal(value,undefined,'Continuation is submission, not an asynchronous read');assert.equal(calls.at(-1),'submit');
assert.ok(!calls.some(c=>c==='readback'));grip.dispose();console.log('Initial resident capture and fracture continuation submit without a completion fence or readback');
