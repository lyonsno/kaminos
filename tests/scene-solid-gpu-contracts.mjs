// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneSolidGeometryCache} from '../volume-scene-solid.mjs';
let gpuUpdates=0;
const result={backend:'gpu',revision:'pose-1'};
const cache=createSceneSolidGeometryCache({
  voxelize(){throw Error('Moving-mesh GPU route still reaches CPU triangle voxelization');},
  gpuProducer:{update(){gpuUpdates++;return result;}}
});
assert.equal(cache.update([{id:'mesh',object:new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5))}],{translate:[0,0,0],scale:1},{grid:32,gridHeight:32}),result);
assert.equal(gpuUpdates,1);

const {createResidentSolidMeshes}=await import('../scene-solid-gpu.mjs');
let uploads=0,releases=0;
const resident=createResidentSolidMeshes({upload(data){uploads++;assert.ok(data.every(Number.isFinite));return {data};},release(){releases++;}});
const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5));
const objects=[{id:'log',object:mesh}],domain={translate:[0,0,0],scale:1};
const a=resident.update(objects,domain);assert.equal(uploads,1);
mesh.position.x=.2;const b=resident.update(objects,domain);
assert.notEqual(a[0].revision,b[0].revision);assert.equal(uploads,1,'drag must retain local triangles');
assert.equal(b[0].draws[0].matrix[12],.2);
resident.update(objects,{translate:[.1,0,0],scale:2});assert.equal(uploads,1,'moving domain must not reupload geometry');
mesh.geometry.attributes.position.needsUpdate=true;resident.update(objects,domain);assert.equal(uploads,2);assert.equal(releases,1);
resident.update([],domain);assert.equal(releases,2,'removed collider releases its mesh buffer');
assert.throws(()=>resident.update([{id:'a',object:mesh},{id:'a',object:mesh}],domain),/identity/);
resident.destroy();

// Regional motion is an explicit material route; static meshes retain their
// triangle cache, and unbinding must rebuild that mask instead of retaining it.
const {createGpuSceneSolidProducer}=await import('../scene-solid-gpu.mjs');
globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,COPY_SRC:4,UNIFORM:64};
globalThis.GPUTextureUsage={TEXTURE_BINDING:4,STORAGE_BINDING:8,COPY_SRC:1};
globalThis.GPUShaderStage={COMPUTE:4};
const resources=[],passes=[];
const make=spec=>{const r={...spec,destroyed:0,createView:()=>({}),destroy(){this.destroyed++;}};resources.push(r);return r;};
const device={createBuffer:make,createTexture:make,createShaderModule:make,createBindGroupLayout:make,createPipelineLayout:make,
 createComputePipeline:spec=>({...spec,getBindGroupLayout:()=>({})}),createBindGroup:spec=>spec,queue:{writeBuffer(){}}};
const producer=createGpuSceneSolidProducer(device,{grid:8,gridHeight:16}),shape={grid:8,gridHeight:16};
const encoder={clearBuffer(){},beginComputePass({label}){passes.push(label);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}};
const texture={width:16,height:16,depthOrArrayLayers:16,createView:()=>({})},borrowed={size:64},ownerBuffer={size:16**3*4};
const filter={device,objectId:'log',texture,matrix:new THREE.Matrix4().elements,revision:1,
 regions:{matrices:borrowed,ownerBuffer,count:1,world:new THREE.Matrix4().elements,lo:[-.5,-.5,-.5],size:[1,1,1]}};
producer.update(objects,domain,shape,{materialMasks:[filter]});producer.encode(encoder);
assert.ok(passes.includes('Current surviving material obstruction'));assert.ok(!passes.includes('scene solid raster'));
passes.length=0;producer.update(objects,domain,shape,{materialMasks:[filter]});producer.encode(encoder);
assert.ok(passes.includes('Current surviving material obstruction'),'GPU pose changes cannot be hidden by unchanged CPU transforms');
passes.length=0;producer.update(objects,domain,shape);producer.encode(encoder);
assert.ok(passes.includes('scene solid raster'));assert.ok(!passes.includes('Current surviving material obstruction'));
assert.throws(()=>producer.update(objects,domain,shape,{materialMasks:[{...filter,device:{}}]}),/same-device/);
producer.destroy();assert.ok(resources.filter(r=>r.usage).every(r=>r.destroyed===1),'Own allocations are disposed once');
