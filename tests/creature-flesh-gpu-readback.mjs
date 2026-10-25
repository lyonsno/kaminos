// kaminos-test: node
import assert from 'node:assert/strict';
import {createGpuFleshVolume} from '../experiments/creature-flesh/gpu-volume.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4};
const source={positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],pinned:[true,false,true,true]};
let bytes=new Float32Array(36);bytes[32]=1;bytes[33]=1;
const device={limits:{maxComputeWorkgroupStorageSize:32768},createBuffer:()=>({destroy(){}}),queue:{writeBuffer(){},submit(){}},createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipeline:()=>({getBindGroupLayout(){}}),createBindGroup(){},createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish(){}})};
const renderer={backend:{isWebGPUBackend:true,device,createStorageAttribute(){},get:()=>({buffer:{}})},getArrayBufferAsync:async()=>bytes.buffer,_attributes:{delete(){}}};
const v=createGpuFleshVolume(source);v.bind(renderer);await v.validate();v.step(1/60);
assert.equal((await v.snapshot()).gpuSteps,1);
bytes=new Float32Array(16);await assert.rejects(()=>v.snapshot(),/layout|length|readback/,'Offset-only output is not a complete physical state');
bytes=new Float32Array(36);bytes[32]=1;bytes[33]=0;await assert.rejects(()=>v.snapshot(),/execute/);
bytes[33]=1;bytes[34]=1;await assert.rejects(()=>v.snapshot(),/reference|fault/);
v.dispose();console.log('Actual snapshot API rejects truncated, unexecuted and GPU-fault states; fixture tests readback contract, not GPU execution');
