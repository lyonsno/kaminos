// kaminos-test: node
import assert from 'node:assert/strict';
import {createVolumeGather} from '../scene-volume-gather.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const pending=[],calls=[];
const pipeline={getBindGroupLayout:()=>({})};
const device={limits:{maxStorageBufferBindingSize:1e8,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(){},submit(){}},createBuffer:()=>({destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),
 createShaderModule:()=>({}),createBindGroup:()=>({}),
 createComputePipeline(){throw Error('synchronous gather compilation');},
 createComputePipelineAsync(descriptor){calls.push(descriptor.label);return new Promise(resolve=>pending.push(()=>resolve(pipeline)));}};
const geometry={nodes:new Float32Array(12),triangles:new Float32Array(12),nodeCount:0,triangleCount:0};
const field={status:'encoded',texture:device.createTexture(),dimensions:[4,8,4],generation:1,frame:1};
const gather=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,smokeRefinement:1,directions:8,asynchronous:true});
assert.equal(gather.isPrepared(field),false);
let complete=false;const preparing=gather.prepare(field).then(()=>complete=true);
await Promise.resolve();assert.equal(complete,false);
for(const release of pending.splice(0))release();await preparing;
assert.equal(gather.isPrepared(field),true);
const count=calls.length;
gather.setDirections(16);await gather.prepare(field);
assert.equal(calls.length,count,'direction edits reuse native gather pipelines');
assert.equal(gather.isPrepared(field),true);
gather.destroy();
console.log('PASS actual gather asynchronous preparation and direction-count pipeline reuse');
