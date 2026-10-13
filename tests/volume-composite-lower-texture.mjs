// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../volume-composite-storage-gpu.mjs';

globalThis.GPUBufferUsage ??= {STORAGE:128};
globalThis.GPUTextureUsage ??= {TEXTURE_BINDING:4,STORAGE_BINDING:8};
const dims=[4,6,2], length=6*2+2*4+4*6;
const buffer={size:length*4,usage:GPUBufferUsage.STORAGE};
const texture={width:6,height:6,depthOrArrayLayers:3,dimension:'2d',format:'r32float',mipLevelCount:1,sampleCount:1,
  usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING,createView:()=>({})};
test('shared lower velocities can feed the fine producer texture',()=>{
  assert.equal(typeof storage.createCompositeLowerFaceGPU,'function','missing GPU lower-face texture consumer');
  const events=[];
  const device={limits:{maxComputeWorkgroupsPerDimension:65535},createShaderModule:x=>x,
    createComputePipeline:()=>({getBindGroupLayout:()=>({})}),createBindGroup:x=>x};
  const bridge=storage.createCompositeLowerFaceGPU(device,{dims,lowerBuffer:buffer,lowerFaceTexture:texture});
  const encoder={beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(...x){events.push(x);},end(){}})};
  bridge.encode(encoder);
  assert.deepEqual(events,[[1,1,3]],'all three padded layers are written');
  for(const [key,value] of Object.entries({width:1,height:1,depthOrArrayLayers:1,format:'rgba32float',dimension:'3d',mipLevelCount:2,sampleCount:4,usage:GPUTextureUsage.TEXTURE_BINDING})){
    assert.throws(()=>storage.createCompositeLowerFaceGPU(device,{dims,lowerBuffer:buffer,lowerFaceTexture:{...texture,[key]:value}}),/lower-face texture/);
  }
  assert.throws(()=>storage.createCompositeLowerFaceGPU(device,{dims,lowerBuffer:{...buffer,size:buffer.size-4},lowerFaceTexture:texture}),/lower-face buffer/);
  assert.throws(()=>storage.createCompositeLowerFaceGPU(device,{dims:[4,0,2],lowerBuffer:buffer,lowerFaceTexture:texture}),/dimensions/);
});
