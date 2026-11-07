// kaminos-test: node
import assert from 'node:assert/strict';
import {makeVolumeSpecimen} from '../experiments/hill-terrain/volume-model.mjs';
import {createVolumeGPU} from '../experiments/hill-terrain/volume-gpu.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,INDIRECT:16,MAP_READ:32};globalThis.GPUMapMode={READ:1};
const buffers=[];
const device={limits:{maxStorageBufferBindingSize:1e9,maxBufferSize:1e9},addEventListener(){},removeEventListener(){},createBuffer(d){const b={size:d.size,label:d.label,bytes:new ArrayBuffer(d.size),getMappedRange(){return this.bytes;},unmap(){},mapAsync:async()=>{},destroy(){this.destroyed=true;}};buffers.push(b);return b;},createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBindGroup:()=>({}),createCommandEncoder:()=>({clearBuffer(){},copyBufferToBuffer:(a,ao,b,bo,n)=>new Uint8Array(b.bytes,bo,n).set(new Uint8Array(a.bytes,ao,n)),beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})}),queue:{writeBuffer(b,o,a){new Uint8Array(b.bytes,o,a.byteLength).set(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));},submit(){},onSubmittedWorkDone:async()=>{}}};
const model=makeVolumeSpecimen({dimensions:[8,8,8],spacing:.15}),s=await createVolumeGPU({device,model});
try{
 assert.equal(typeof s.pickRay,'function','Source-current rock picking must be available without a material snapshot');
 s.release(7);s.pushRock(7,[1,2,3],[.2,.7,.1]);await s.advance(1);
 const p=new Float32Array(s.resources.params.bytes);assert.deepEqual(Array.from(p.slice(16,20)),[Math.fround(.2),Math.fround(.7),Math.fround(.1),1],'The impulse must retain its contact point in specimen coordinates');
 assert.throws(()=>s.pushRock(7,[1,0,0],[NaN,0,0]),/point/i);
 assert.throws(()=>s.pushRock(0,[1,0,0],[0,0,0]),/released/i,'Dragging cannot release an attachment');
}finally{s.dispose();}
assert.ok(buffers.every(b=>b.destroyed),'Solver owns and releases picking resources');
