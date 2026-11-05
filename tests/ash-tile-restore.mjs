// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuTiledAsh} from '../ash/tile-gpu.mjs';
// Local validation only: fake storage never executes WGSL or supplies GPU evidence.
test('tiled restore rejects material loss and ledger disagreement before any upload',async()=>{
 globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,INDIRECT:8,UNIFORM:16,MAP_READ:32};globalThis.GPUShaderStage={COMPUTE:4};
 const writes=[],attributes=new Map();
 const device={limits:{maxStorageBufferBindingSize:1e7,maxBufferSize:1e7,maxComputeWorkgroupsPerDimension:65535},
  createBuffer:({size})=>({size,destroy(){}}),queue:{writeBuffer(...args){writes.push(args);},submit(){}},
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createComputePipelineAsync:async()=>({}),createBindGroup:()=>({}),
  createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){},end(){}}),copyBufferToBuffer(){},finish(){return {};}})};
 const backend={device,isWebGPUBackend:true,createStorageAttribute:a=>attributes.set(a,{buffer:device.createBuffer({size:a.array.byteLength})}),createIndirectStorageAttribute:a=>attributes.set(a,{buffer:device.createBuffer({size:a.array.byteLength})}),get:a=>attributes.get(a),destroyAttribute:a=>attributes.delete(a)};
 const patch=await createGpuTiledAsh({renderer:{backend},cellSize:1,bounds:{min:[0,0,0],max:[1,2,1]},solid:new Uint8Array(2),tileSize:1});
 try{
  const state={schema:'kaminos.tiled-ash.v1',layout:patch.layout,values:[0,0],pendingTiles:[],steps:0,seededVolume:1,volume:1,retainedVolume:1,lastContact:null,
   falling:{schema:'kaminos.ash-fall.v1',capacity:1,particles:Array(8).fill(0),state:[0,0,0,0],queuedVolume:0,requestedVolume:0}};
  const before=writes.length;assert.throws(()=>patch.restore(state),/volume|material|ledger/i);assert.equal(writes.length,before);
  assert.throws(()=>patch.restore({...state,values:[1,0],volume:2}),/volume|material|ledger/i);assert.equal(writes.length,before);
  patch.restore({...state,values:[1,0]});assert.ok(writes.length>before);assert.equal(patch.read().volume,1);
 }finally{patch.dispose();}
});
