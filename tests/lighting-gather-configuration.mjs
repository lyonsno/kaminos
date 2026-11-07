// kaminos-test: node
import assert from 'node:assert/strict';
import {createVolumeGather} from '../scene-volume-gather.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const pipeline={getBindGroupLayout:()=>({})};
const device={limits:{maxStorageBufferBindingSize:128,maxTextureDimension2D:256,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},queue:{writeBuffer(){},submit(){}},createBuffer:()=>({destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),createShaderModule:()=>({}),createBindGroup:()=>({}),createComputePipeline:()=>pipeline,createCommandEncoder:()=>({copyBufferToBuffer(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})})};
const field={status:'encoded',texture:device.createTexture(),dimensions:[1,4,1],generation:1,frame:1};
const gather=createVolumeGather(device,{geometry:{nodes:new Float32Array(12),triangles:new Float32Array(12),nodeCount:0,triangleCount:0},receivers:[],sourceDimensions:field.dimensions,volumeGrid:1,directions:4,smokeRefinement:1,angularPattern:'importance',samplingNoise:device.createTexture()});
try{
 const before=gather.encode(field);assert.equal(before.directions,4);assert.equal(before.importance.bankDirections,8);
 assert.throws(()=>gather.setImportancePolicy({importanceBankMultiplier:4}),/256.*128/,'the unwanted old-D/new-bank intermediate does not fit');
 gather.setConfiguration?.({directions:2,angularPattern:'importance',importancePolicy:{importanceBankMultiplier:4}});
 const down=gather.encode(field);assert.equal(down.directions,2,'the admitted complete requested configuration must reach the gather');assert.equal(down.importance.bankDirections,8);
 gather.setConfiguration({directions:4,angularPattern:'importance',importancePolicy:{importanceBankMultiplier:2}});
 const up=gather.encode(field);assert.equal(up.directions,4);assert.equal(up.importance.bankDirections,8,'the converse D-up/bank-down edit is atomic too');
 assert.throws(()=>gather.setConfiguration({directions:4,importancePolicy:{importanceBankMultiplier:4}}),/256.*128/);const accepted=gather.encode(field);assert.equal(accepted.directions,4);assert.equal(accepted.importance.bankDirections,8,'a rejected final plan leaves the accepted combination untouched');
}finally{gather.destroy();}
console.log('PASS complete direction/pattern/proposal configuration is admitted atomically at actual storage capacity');
