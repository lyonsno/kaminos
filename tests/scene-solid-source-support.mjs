// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createGpuSceneSolidProducer} from '../scene-solid-gpu.mjs';

globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8};
globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
globalThis.GPUShaderStage={COMPUTE:1};

function fixture(){
 const writes=[],buffers=[],clears=[],passes=[];
 const device={limits:{maxComputeWorkgroupsPerDimension:65535},
  createBuffer(spec){const b={...spec,destroy(){}};buffers.push(b);return b;},
  createTexture:spec=>({...spec,createView:()=>({texture:spec}),destroy(){}}),
  createShaderModule:x=>x,createBindGroupLayout:x=>x,createPipelineLayout:x=>x,
  createComputePipeline:x=>({...x,getBindGroupLayout:()=>({})}),createBindGroup:x=>x,
  queue:{writeBuffer(buffer,offset,data){writes.push({buffer,offset,bytes:data.byteLength});}},
 };
 const encoder={clearBuffer:b=>clears.push(b),copyBufferToBuffer(){},beginComputePass({label}){
  const pass={label};passes.push(pass);return{setPipeline:p=>pass.pipeline=p,setBindGroup:(i,g)=>pass.group=g,dispatchWorkgroups:(...n)=>pass.groups=n,end(){}};
 }};
 const producer=createGpuSceneSolidProducer(device,{grid:16,gridHeight:32});
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5));
 producer.update([{id:'obstacle',object:mesh}],{translate:[0,0,0],scale:1},{grid:16,gridHeight:32});
 const uniforms=new ArrayBuffer(144);new Uint32Array(uniforms).set([16,8,12,4,32],31);
 const pipeline={getBindGroupLayout:()=>({})};
 return{producer,writes,buffers,clears,passes,encoder,uniforms,pipeline};
}

test('analytic support uploads only compact parameters and dispatches its bounded GPU box',()=>{
 const f=fixture();try{
  assert.equal(typeof f.producer.setAnalyticSourceSupport,'function');
  f.producer.setAnalyticSourceSupport({pipeline:f.pipeline,uniforms:f.uniforms,workgroups:[2,3,1]});
  f.producer.encode(f.encoder);
  assert.equal(f.writes.filter(w=>w.buffer.label==='scene solid source support').length,0,'no grid-sized support upload, including initialization');
  const support=f.buffers.find(b=>b.label==='scene solid source support');
  assert.ok(f.clears.includes(support),'old support is cleared on the GPU');
  const p=f.passes.find(p=>p.label==='scene solid analytic source support');
  assert.equal(p.pipeline,f.pipeline);assert.deepEqual(p.groups,[2,3,1]);
  assert.equal(p.group.entries.find(e=>e.binding===3).resource.buffer,support);
  assert.ok(f.writes.some(w=>w.buffer.label==='scene solid source parameters'&&w.bytes===144));
  assert.ok(f.passes.indexOf(p)<f.passes.findIndex(p=>p.label==='scene solid measure'),'support must precede validation');
  const count=f.passes.length;assert.equal(f.producer.encode(f.encoder),false);assert.equal(f.passes.length,count);
 }finally{f.producer.destroy();}
});

test('disabling support clears previous GPU support without a source dispatch or CPU mask',()=>{
 const f=fixture();try{
  f.producer.setAnalyticSourceSupport({pipeline:f.pipeline,uniforms:f.uniforms,workgroups:[2,3,1]});f.producer.encode(f.encoder);
  const support=f.buffers.find(b=>b.label==='scene solid source support'),before=f.clears.filter(b=>b===support).length;
  const inactive=new ArrayBuffer(144);new Uint32Array(inactive)[31]=16;new Uint32Array(inactive)[35]=32;
  f.producer.setAnalyticSourceSupport({pipeline:f.pipeline,uniforms:inactive,workgroups:[0,0,0]});f.producer.encode(f.encoder);
  assert.equal(f.clears.filter(b=>b===support).length,before+1);
  assert.equal(f.passes.filter(p=>p.label==='scene solid analytic source support').length,1);
  assert.equal(f.writes.filter(w=>w.buffer.label==='scene solid source support').length,0);
 }finally{f.producer.destroy();}
});

test('support refuses mismatched dimensions and partial dispatch before replacing accepted parameters',()=>{
 const f=fixture();try{
  assert.equal(typeof f.producer.setAnalyticSourceSupport,'function');
  f.producer.setAnalyticSourceSupport({pipeline:f.pipeline,uniforms:f.uniforms,workgroups:[2,3,1]});
  const before=f.writes.length;
  assert.throws(()=>f.producer.setAnalyticSourceSupport({pipeline:f.pipeline,uniforms:f.uniforms,workgroups:[1,3,1]}),/dispatch/);
  const bad=f.uniforms.slice(0);new Uint32Array(bad)[35]=16;
  assert.throws(()=>f.producer.setAnalyticSourceSupport({pipeline:f.pipeline,uniforms:bad,workgroups:[2,3,1]}),/dimensions/);
  assert.equal(f.writes.length,before);
  f.producer.encode(f.encoder);assert.deepEqual(f.passes.find(p=>p.label==='scene solid analytic source support').groups,[2,3,1]);
 }finally{f.producer.destroy();}
});
