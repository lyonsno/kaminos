// kaminos-test: node
import assert from 'node:assert/strict';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const passes=[];
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(){},submit(){}},createBuffer(){return {destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
 createShaderModule(){return {};},createComputePipeline(){return {getBindGroupLayout(){return {};}};},createBindGroup(){return {};},
 createCommandEncoder(){return {beginComputePass({label}){passes.push(label);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
const gather=createVolumeGather(device,{geometry:buildTriangleVisibility([]).packGpu(),receivers:[],volumeGrid:2,directions:8});
const source={status:'encoded',texture:{createView(){return {};}},scatteringTexture:{createView(){return {};}},scatteringGeneration:1,generation:1,frame:7,dimensions:[4,8,4],localMax:[1,3,1]};
const frame=gather.encode(source,{surfaceScattering:true,gain:3});
assert.equal(frame.surfaceReceivers,0);assert.equal(frame.transportVolumeReceivers,16);
assert(!passes.includes('primary plus smoke scattered light to surfaces'),'smoke-only cache must not schedule distributed surface integration');
const transport=gather.transportSource();
assert.equal(transport.generation,1);assert.equal(transport.frame,7);assert.equal(transport.gain,1,'composed source already includes master gain');
gather.encode(source,{surfaceScattering:false,gain:3});assert.equal(gather.transportSource().gain,3);
gather.destroy();
assert.throws(()=>gather.transportSource(),/current/,'retired GPU source must not remain consumable');
console.log('hybrid smoke-only transport contracts passed');
