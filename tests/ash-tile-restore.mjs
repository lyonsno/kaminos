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
import {Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
test('tiled restore rejects moved or missing colliders by default, while allowCollisionUpgrade admits proxy-collapsed colliders at identical poses',async()=>{
 globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,INDIRECT:8,UNIFORM:16,MAP_READ:32};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4,COPY_DST:8};globalThis.GPUShaderStage={COMPUTE:4};
 const attributes=new Map();
 const device={limits:{maxTextureDimension3D:256,maxStorageBufferBindingSize:1e7,maxBufferSize:1e7,maxComputeWorkgroupsPerDimension:65535},
  createBuffer:({size})=>({size,destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),queue:{writeBuffer(){},submit(){}},
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createComputePipeline:()=>({}),createComputePipelineAsync:async()=>({}),createBindGroup:()=>({}),
  createCommandEncoder:()=>({clearBuffer(){},copyTextureToTexture(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){},end(){}}),copyBufferToBuffer(){},finish(){return {};}})};
 const backend={device,isWebGPUBackend:true,createStorageAttribute:a=>attributes.set(a,{buffer:device.createBuffer({size:a.array.byteLength})}),createIndirectStorageAttribute:a=>attributes.set(a,{buffer:device.createBuffer({size:a.array.byteLength})}),get:a=>attributes.get(a),destroyAttribute:a=>attributes.delete(a)};
 const m=new Mesh(new BoxGeometry(.4,.4,.4),new MeshBasicMaterial());m.position.set(.5,.5,.5);m.updateMatrixWorld(true);
 const patch=await createGpuTiledAsh({renderer:{backend},cellSize:1,bounds:{min:[0,0,0],max:[1,2,1]},solid:new Uint8Array(2),tileSize:1,sceneRecords:()=>[{id:'burner',key:'burner:0',object:m}]});
 try{
  patch.syncScene();
  const current=patch.read().sceneCollision.members;
  const legacySavedCollision=[
   {key:'burner:0',geometry:'old-part-0:24:36:16',matrix:current[0].matrix},
   {key:'burner:1',geometry:'old-part-1:120:360:16',matrix:current[0].matrix},
  ];
  const state={schema:'kaminos.tiled-ash.v1',collisionIdentity:legacySavedCollision,layout:patch.layout,values:[1,0],pendingTiles:[],steps:5,seededVolume:1,volume:1,retainedVolume:1,lastContact:null,
   falling:{schema:'kaminos.ash-fall.v1',capacity:1,particles:Array(8).fill(0),state:[0,0,0,0],queuedVolume:0,requestedVolume:0}};
  assert.throws(()=>patch.restore(state),/scene geometry or poses differ/i,'strict restore rejects changed collider sub-meshes');
  assert.doesNotThrow(()=>patch.restore(state,{allowCollisionUpgrade:true}),'scene-load restore admits proxy-collapsed collider at identical object pose');
  const movedMatrix=[...current[0].matrix];movedMatrix[12]+=2;
  const movedState={...state,collisionIdentity:[{key:'burner:0',geometry:'old-part-0:24:36:16',matrix:movedMatrix}]};
  assert.throws(()=>patch.restore(movedState,{allowCollisionUpgrade:true}),/scene geometry or poses differ/i,'moved pose still rejected even with allowCollisionUpgrade');
  const addedState={...state,collisionIdentity:[...legacySavedCollision,{key:'other:0',geometry:'box:24:36:16',matrix:current[0].matrix}]};
  assert.throws(()=>patch.restore(addedState,{allowCollisionUpgrade:true}),/scene geometry or poses differ/i,'added/removed collider object ID still rejected');
  const secondPose=[...current[0].matrix];secondPose[12]+=1.5;
  const missingPlacementState={...state,collisionIdentity:[...legacySavedCollision,{key:'burner:2',geometry:'old-part-2:24:36:16',matrix:secondPose}]};
  assert.throws(()=>patch.restore(missingPlacementState,{allowCollisionUpgrade:true}),/scene geometry or poses differ/i,'missing saved placement pose for same collider ID is rejected');
 }finally{patch.dispose();m.geometry.dispose();m.material.dispose();}
});

test('strict restore reconstructs a recorded pre-quantization sampling grid and keeps it on subsequent syncs',async()=>{
 globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,INDIRECT:8,UNIFORM:16,MAP_READ:32};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4,COPY_DST:8};globalThis.GPUShaderStage={COMPUTE:4};
 const attributes=new Map();
 const device={limits:{maxTextureDimension3D:256,maxStorageBufferBindingSize:1e7,maxBufferSize:1e7,maxComputeWorkgroupsPerDimension:65535},
  createBuffer:({size})=>({size,destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),queue:{writeBuffer(){},submit(){}},
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createComputePipeline:()=>({}),createComputePipelineAsync:async()=>({}),createBindGroup:()=>({}),
  createCommandEncoder:()=>({clearBuffer(){},copyTextureToTexture(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){},end(){}}),copyBufferToBuffer(){},finish(){return {};}})};
 const backend={device,isWebGPUBackend:true,createStorageAttribute:a=>attributes.set(a,{buffer:device.createBuffer({size:a.array.byteLength})}),createIndirectStorageAttribute:a=>attributes.set(a,{buffer:device.createBuffer({size:a.array.byteLength})}),get:a=>attributes.get(a),destroyAttribute:a=>attributes.delete(a)};
 const m=new Mesh(new BoxGeometry(3,3,3),new MeshBasicMaterial());m.position.set(.1,.1,.1);m.updateMatrixWorld(true);
 const patch=await createGpuTiledAsh({renderer:{backend},cellSize:.1,bounds:{min:[0,0,0],max:[.2,.2,.2]},solid:new Uint8Array(8),tileSize:1,sceneRecords:()=>[{id:'box',key:'box:0',object:m}]});
 try{
  // Recorded on d72c1538 using this geometry/pose/layout; not generated by
  // the new planner. See shrine composition review SHRINE-F1 reproduction.
  const identity={key:'box:0',geometry:'4020f49b:ae8722b9:24:36:34',matrix:m.matrixWorld.toArray()};
  const state={schema:'kaminos.tiled-ash.v1',collisionIdentity:[identity],layout:patch.layout,values:Array(8).fill(0),pendingTiles:[],steps:5,seededVolume:0,volume:0,retainedVolume:0,lastContact:null,
   falling:{schema:'kaminos.ash-fall.v1',capacity:4,particles:Array(32).fill(0),state:[0,0,0,0],queuedVolume:0,requestedVolume:0}};
  assert.doesNotThrow(()=>patch.restore(state),'unchanged pre-quantization checkpoint restores strictly');
  patch.syncScene();assert.equal(patch.read().sceneCollision.members[0].geometry,identity.geometry,'subsequent sync retains restored sampling');
  m.position.x+=.01;assert.throws(()=>patch.restore(state),/geometry or poses differ/,'changed pose remains refused');
  m.position.x=.1;m.geometry.attributes.position.setX(0,2);m.geometry.attributes.position.needsUpdate=true;
  assert.throws(()=>patch.restore(state),/geometry or poses differ/,'changed geometry remains refused');
 }finally{patch.dispose();m.geometry.dispose();m.material.dispose();}
});
