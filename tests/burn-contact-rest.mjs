// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createBurnContactWorldGpu,BURN_CONTACT_WORLD_WGSL} from '../burn-contact-world-gpu.mjs';
import {BURN_RIGID_ISLANDS_WGSL} from '../burn-rigid-islands-gpu.mjs';

const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/burn-cold-propped-stack.json',import.meta.url)));
await withKaminosGpu(async({device})=>{
 const owned=[];
 const alloc=data=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 const participants=fixture.objects.map(o=>({
  resident:{device,buffers:Object.fromEntries(['positions','rotations','velocities','angular','boxes','joints'].map(k=>[k,alloc(Float32Array.from(o[k]))])),bodies:o.positions.length/4,bonds:o.joints.length/44,origin:o.origin,timeStep:fixture.timeStep,substeps:1,iterations:fixture.iterations,encodeMaterial(){},encodePresentation(){},setClockPhase(){}},
  frame:()=>({position:o.transform.position,quaternion:[0,0,0,1],scale:1,ground:fixture.ground,contactsEnabled:true}),present(){}
 }));
 let world;
 async function read(buffer){const b=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,b.size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);return new Float32Array(b.getMappedRange()).slice();}finally{b.unmap();b.destroy();}}
 try{
  assert.equal(participants.reduce((n,p)=>n+p.resident.bodies,0),136);
  world=await createBurnContactWorldGpu({device,participants});
  for(let i=0;i<180;i++)world.advance(fixture.timeStep);
  const drift=[];
  for(let i=0;i<participants.length;i++){
   const actual=await read(participants[i].resident.buffers.positions),initial=fixture.objects[i].positions;
   const maxHorizontal=Math.max(...Array.from({length:actual.length/4},(_,j)=>Math.hypot(actual[j*4]-initial[j*4],actual[j*4+2]-initial[j*4+2])));
   const maxVertical=Math.max(...Array.from({length:actual.length/4},(_,j)=>Math.abs(actual[j*4+1]-initial[j*4+1])));
   assert.ok(maxHorizontal<.002,`Cold object ${i} must remain at rest, not creep across its support: ${maxHorizontal}m in three seconds`);
   assert.ok(maxVertical<.002,`Cold object ${i} must stay supported: ${maxVertical}m vertical displacement`);
   assert.ok(actual.every(Number.isFinite));
   drift.push({object:i,maxHorizontal,maxVertical});
  }
  console.log('Cold propped assembly displacement (meters): '+JSON.stringify(drift));
 }finally{world?.dispose();owned.forEach(b=>b.destroy());}
},{wgslSources:[...['toWorld','toLocal','reindex'].map(entryPoint=>({label:'burn-rest-transfer-'+entryPoint,code:BURN_CONTACT_WORLD_WGSL,entryPoint})),...['connect','aggregate','findContacts','findMutual','solveMutual','publish'].map(entryPoint=>({label:'burn-rest-contact-'+entryPoint,code:BURN_RIGID_ISLANDS_WGSL,entryPoint}))]});
