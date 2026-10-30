// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {patchLayout} from '../ash/gpu-plan.mjs';
import {createAshSceneSolids} from '../ash/scene-gpu.mjs';
// Scheduling regression only. This fake records submissions and executes no WGSL.
function setup(){
 globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4,COPY_DST:8};globalThis.GPUShaderStage={COMPUTE:1};
 const submissions=[];
 const device={limits:{maxTextureDimension3D:256,maxStorageBufferBindingSize:1e7,maxBufferSize:1e7,maxComputeWorkgroupsPerDimension:65535},queue:{writeBuffer(){},submit(commands){submissions.push(commands);}},createBuffer:({size})=>({size,destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),createShaderModule:()=>({}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createComputePipeline:()=>({}),createBindGroup:()=>({}),createCommandEncoder:()=>({clearBuffer(){},copyTextureToTexture(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})})};
 const layout=patchLayout({cellSize:.1,bounds:{min:[-3,0,-3],max:[3,2,3]},tileSize:4});
 const field=createAshSceneSolids({device,layout,collision:device.createBuffer({size:layout.count*4}),headers:device.createBuffer({size:layout.tiles.count*32})});
 const a=new Mesh(new BoxGeometry(.4,.4,.4),new MeshBasicMaterial()),b=new Mesh(new BoxGeometry(.4,.4,.4),new MeshBasicMaterial());a.name='A';b.name='B';a.position.set(-1,.2,0);b.position.set(1,.2,0);
 const records=[{id:'a',object:a},{id:'b',object:b}];
 return {field,a,b,records,submissions,dispose(){field.dispose();for(const mesh of [a,b]){mesh.geometry.dispose();mesh.material.dispose();}}};
}
for(const operation of ['move','remove'])test(`${operation} before later refusal composes on correction without another edit`,()=>{
 const s=setup();try{
  assert.equal(s.field.update(s.records),true);
  const submitted=s.submissions.length;
  if(operation==='move')s.a.position.x=-2;else s.records.shift();
  s.b.scale.x=0;assert.throws(()=>s.field.update(s.records),/invertible/);
  assert.equal(s.submissions.length,submitted,'failed pass did not publish collision');
  s.b.scale.x=1;
  assert.equal(s.field.update(s.records),true,'recovery must compose retained dirty regions');
  assert.equal(s.submissions.length,submitted+1);
  assert.equal(s.field.update(s.records),false,'unchanged recovered scene is quiet');
 }finally{s.dispose();}
});
