// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createBurnMaterial} from '../burn-table-material.mjs';
import {createLiveLogHeatGpu} from '../live-log-heat-gpu.mjs';

const bounds=new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(1,1,1));
const renderer={library:{fromMaterial:source=>new THREE.MeshStandardNodeMaterial().copy(source)}};
test('resident char and heat views are inspectable without overwriting physical state',()=>{
  const original=new THREE.MeshStandardMaterial();original.map=new THREE.Texture();
  const binding=createBurnMaterial({renderer,original,bounds,settings:{},stateNode:THREE.TSL.vec4(.4,.8,0,0),stateIdentity:'resident-test'});
  assert.equal(binding.read().view,'beauty');
  binding.setView('char');assert.equal(binding.read().view,'char');
  assert.equal(binding.read().stateAuthority,'resident-test');assert.equal(binding.material.map,original.map);
  binding.setView('heat');binding.setView('beauty');
  assert.throws(()=>binding.setView('fake'),/view/);binding.dispose();
});
test('whole-log held damage is distinct from the partial-exposure comparison',()=>{
  const original=new THREE.MeshStandardMaterial();
  const binding=createBurnMaterial({renderer,original,bounds,settings:{char:1},coverage:'whole'});
  assert.equal(binding.read().coverage,'whole');
  assert.throws(()=>createBurnMaterial({renderer,original,bounds,settings:{},coverage:'unknown'}),/coverage/);
  binding.dispose();
});
test('visible burn status has resident GPU summary and is reset with the material field',async()=>{
  globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8};
  globalThis.GPUTextureUsage={STORAGE_BINDING:8,TEXTURE_BINDING:4,COPY_DST:2};
  const resources=[],writes=[],passes=[];
  const make=spec=>{const r={...spec,createView:()=>({}),destroyed:0,destroy(){this.destroyed++;}};resources.push(r);return r;};
  const device={createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
    createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBuffer:make,createTexture:make,createBindGroup:x=>x,
    queue:{writeBuffer(){},writeTexture(target){writes.push(target.texture);}}};
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.geometry.computeBoundingBox();
  const field=await createLiveLogHeatGpu({renderer:{backend:{device,get:()=>({})}},mesh,bounds:mesh.geometry.boundingBox});
  assert.ok(field.summaryNode,'burn label must sample GPU-derived material summary, not Run or burner state');
  assert.equal(field.read().summaryDomain,'mesh-intersecting-voxels','empty bounding-box cells cannot establish that wood is reacting');
  const summary=field.summaryTexture;assert.ok(writes.includes(summary));
  field.encode({beginComputePass(spec){passes.push(spec.label);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}},
    {device,fluid:{},collision:{createView(){}},dimensions:[32,32,32],simStepCount:1,allocationId:'field-1',dt:1/60,transform:{translate:[0,0,0],scale:1}});
  assert.ok(passes.includes('live log GPU burn summary'));
  field.reset();assert.equal(field.summaryTexture,summary);assert.ok(writes.filter(x=>x===summary).length>=2);
  assert.equal(field.read().runtimeReadbacks,0);field.dispose();assert.ok(resources.every(x=>x.destroyed===1));
});
