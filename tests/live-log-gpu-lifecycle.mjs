// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createLiveLogHeatGpu} from '../live-log-heat-gpu.mjs';
globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:8,TEXTURE_BINDING:4,COPY_DST:2};

test('resident texture survives reset, transforms follow the mesh and disposal never owns the device',async()=>{
  let deviceDestroyed=0;const resources=[],writes=[],groups=[];
  const make=spec=>{const resource={...spec,destroyed:0,createView:()=>({}),destroy(){this.destroyed++;}};resources.push(resource);return resource;};
  const device={createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
    createBuffer:make,createTexture:make,createBindGroup:spec=>{groups.push(spec);return spec;},destroy(){deviceDestroyed++;},
    queue:{writeBuffer(buffer,offset,values){writes.push({buffer,offset,values:Float32Array.from(values)});},writeTexture(){}}};
  const renderer={backend:{device,get:()=>({})}},mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
  mesh.position.set(2,0,0);mesh.geometry.computeBoundingBox();
  const field=await createLiveLogHeatGpu({renderer,mesh,bounds:mesh.geometry.boundingBox});const texture=field.texture;
  const pass={setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};
  const frame={device,fluid:{},collision:{createView(){}},dimensions:[48,96,48],simStepCount:1,allocationId:'fluid-1',dt:1/60,transform:{translate:[1,0,0],scale:2}};
  field.encode({beginComputePass:()=>pass},frame);
  const params=writes.findLast(w=>w.buffer.label==='live log local-to-volume transform').values;
  assert.deepEqual(Array.from(params.slice(0,3)),[48,96,48]);
  assert.ok(Math.abs(params[3]-1/60)<1e-8);assert.equal(params[12],.25);assert.equal(params[24],.75);
  assert.equal(params[28],4,'normals use the inverse transpose, not the position transform');
  const count=groups.length;field.encode({beginComputePass:()=>pass},frame);assert.equal(groups.length,count);
  field.encode({beginComputePass:()=>pass},{...frame,collision:{createView:()=>({replacement:true})}});
  assert.equal(groups.length,count+2,'same fluid must rebind when the collision allocation changes');
  assert.equal(groups.at(-1).entries.find(entry=>entry.binding===6).resource.replacement,true);
  const generation=field.read().generation;field.reset();assert.equal(field.texture,texture);assert.equal(field.read().steps,0);assert.ok(field.read().generation>generation);
  field.dispose();field.dispose();assert.equal(deviceDestroyed,0);assert.ok(resources.every(r=>r.destroyed===1));
});

test('regional pose binding preserves material state and borrows only same-device current poses',async()=>{
 const resources=[],writes=[];
 const make=spec=>{const r={...spec,destroyed:0,createView:()=>({}),destroy(){this.destroyed++;}};resources.push(r);return r;};
 const device={createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBuffer:make,createTexture:make,createBindGroup:spec=>spec,
  queue:{writeBuffer(buffer,offset,data){writes.push({buffer,data:Array.from(data)});},writeTexture(){}}};
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.geometry.computeBoundingBox();
 const field=await createLiveLogHeatGpu({renderer:{backend:{device,get:()=>({})}},mesh,bounds:mesh.geometry.boundingBox,disintegrate:true});
 assert.equal(typeof field.setRegionMotion,'function','Thermal samples must follow their current rigid region without replacing material history');
 const states=field.residentState(),owners=new Uint32Array(16**3),matrices=make({size:128});owners.fill(1,2048);
 const descriptor={device,owners,matrices,count:2};
 field.setRegionMotion(descriptor);
 assert.equal(field.residentState().after,states.after);assert.equal(field.read().steps,0);
 assert.equal(field.residentState().regionMotion.matrices,matrices);
 const mask=field.materialMask('moving');assert.equal(mask.regions.matrices,matrices);assert.equal(mask.regions.ownerBuffer,field.residentState().regionMotion.ownerBuffer);
 assert.deepEqual(mask.regions.lo,[-.5,-.5,-.5]);assert.deepEqual(mask.regions.size,[1,1,1]);assert.equal(mask.regions.count,2);
 for(const bad of [{...descriptor,device:{}},{...descriptor,owners:new Uint32Array(1)},{...descriptor,count:1},{...descriptor,matrices:{size:64}}])assert.throws(()=>field.setRegionMotion(bad));
 assert.equal(field.residentState().regionMotion.matrices,matrices,'Rejected bindings retain the working pose');
 const bound=[];const encoder={beginComputePass:()=>({setPipeline(){},setBindGroup(_,g){bound.push(g);},dispatchWorkgroups(){},end(){}})};
 const frame={device,fluid:{},collision:{createView(){}},dimensions:[32,64,32],simStepCount:1,allocationId:'live-1',dt:1/60,transform:{translate:[0,0,0],scale:1}};
 field.encode(encoder,frame);field.encodeGasSource(encoder,frame,{enabled:true,accumulation:{}});
 for(const group of [bound[0],bound.at(-1)])assert.equal(group.entries.find(e=>e.binding===9).resource.buffer,matrices,'Heating and gas deposition share current regional poses');
 assert.equal(field.read().steps,1);const advanced=field.residentState().after;field.setRegionMotion(null);assert.equal(field.read().steps,1);
 assert.equal(field.residentState().after,advanced);
 assert.equal(field.materialMask('moving').regions,undefined,'Unbound objects keep the ordinary mesh collision route');
 field.dispose();assert.equal(matrices.destroyed,0,'Borrowed mechanical poses remain caller-owned');
 matrices.destroy();assert.ok(resources.every(r=>r.destroyed===1));
});
