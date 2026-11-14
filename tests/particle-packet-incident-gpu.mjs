// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {PARTICLE_LIGHT_MATERIAL_WGSL} from '../volume-optical-particles.mjs';
import {PARTICLE_STATE_WGSL} from '../volume-particle-state.mjs';
import {createPacketIncidentGather,PACKET_SCATTER_WGSL} from '../volume-particle-packet-incident.mjs';

test('native packet lookup retains valid dark receivers, ignores inactive rows and sees a wide support across bins',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owned=[],retired=[];
  const storage=rows=>{const b=d.createBuffer({size:rows.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(b);d.queue.writeBuffer(b,0,rows);return b;};
  const centers=storage(new Float32Array([-.5,0,0,1.25, .5,0,0,1.25, 0,0,0,2]));
  const radiance=storage(new Float32Array([6,2,0,1, 0,0,0,1, 100,100,100,0]));
  const rows=new Float32Array(4*24);
  rows.set([0,0,0,1],0);rows.set([-1.4,0,0,1],24);rows.set([0,0,0,0],48);rows.set([0,5,0,1],72);
  const particles=storage(rows);
  const owner=createPacketIncidentGather(d,PARTICLE_LIGHT_MATERIAL_WGSL,rows=>retired.push(...rows));
  const read=d.createBuffer({size:64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(read);
  const identity={epoch:2,step:4,frame:5};
  async function observe(origin){
   await withGpuErrorScopes(d,'packet lookup',async()=>{
    owner.set({identity,centers,radiance,receiverCount:3,grid:{origin,dims:[8,8,8],pitch:.5}},identity);
    const e=d.createCommandEncoder(),r=owner.encode(e,{identity:2,step:5,particles,slots:4});
    assert.equal(r.ageSteps,1);e.copyBufferToBuffer(r.buffer,0,read,0,64);d.queue.submit([e.finish()]);
   });
   await read.mapAsync(GPUMapMode.READ);
   const result=Array.from(new Float32Array(read.getMappedRange()));
   read.unmap();return result;
  }
  try{
   const expected=[3,1,0,1, 6,2,0,1, 0,0,0,0, 0,0,0,0];
   for(const got of [await observe([-2,-2,-2]),await observe([0,-2,-2])])
    got.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<1e-5,`term ${i}: ${x}`));
  }finally{owner.dispose();for(const b of [...owned,...retired])b.destroy();}
 });
});

test('packet light scatters once with current soot and albedo and keeps intrinsic source separate',async()=>{
 await withKaminosGpu(async ctx=>{
  const rows=await evalWgslBatch(ctx,{preamble:PARTICLE_LIGHT_MATERIAL_WGSL+PARTICLE_STATE_WGSL+PACKET_SCATTER_WGSL,
   inputs:[[2,.25],[0,.25],[2,0]],argTypes:['f32','f32'],returnType:'vec4<f32>',body:`
   var p:Particle;var u:Options;
   p.anchor.w=1; p.shape.w=.5; p.emission=vec4<f32>(3,2,1,1);p.source=vec4<f32>(500);p.state.z=arg0;
   u.gain.x=2;u.material=vec4<f32>(2,4,arg1,1);u.lighting=vec4<f32>(1,0,1,0);
   return vec4<f32>(packetScatter(p,u,vec3<f32>(2,1,.5)),packetIntrinsic(p,u).x);`});
  assert.deepEqual(rows.map(row=>Array.from(row)),[[4,2,1,3],[0,0,0,3],[0,0,0,3]]);
 });
});
