// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createBurnContactWorldGpu,BURN_CONTACT_WORLD_WGSL} from '../burn-contact-world-gpu.mjs';
import {createSceneBurnContact} from '../scene-burn-contact.mjs';

await withKaminosGpu(async({device})=>{
 const owned=[];
 const alloc=data=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 const ground={position:[0,-.1,0],quaternion:[0,0,0,1],halfExtents:[10,.1,10],friction:.6};
 function participant({center,origin,half,mass,position,scale=1,quaternion=[0,0,0,1]}){
  const buffers={positions:alloc(Float32Array.from([...center,1/mass])),rotations:alloc(Float32Array.from([0,0,0,1])),velocities:alloc(new Float32Array(4)),angular:alloc(new Float32Array(4)),boxes:alloc(Float32Array.from([0,...half])),joints:alloc(new Float32Array(4))};
  const frame={position,scale,quaternion,ground,contactsEnabled:true};let materialCalls=0,presentCalls=0,steps=0,seconds=0;
  const resident={device,buffers,origin,bodies:1,bonds:0,timeStep:1/60,substeps:2,iterations:12,encodeMaterial(){materialCalls++;},encodePresentation(_e,clock){steps+=clock.steps;seconds+=clock.seconds;presentCalls++;}};
  return {resident,frame:()=>frame,present(){},counts:()=>({materialCalls,presentCalls,steps,seconds})};
 }
 async function read(buffer){const b=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,b.size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);return new Float32Array(b.getMappedRange()).slice();}finally{b.unmap();b.destroy();}}
 let world;
 try{
  const lower=participant({center:[0,0,0],origin:[0,0,0],half:[.5,.5,.5],mass:2,position:[0,.5,0]});
  // The upper source has an unrelated origin, rotation and scale. Its mass
  // already includes source-scale density, just as burnMechanicsLocalScale does.
  const upper=participant({center:[10,0,0],origin:[-10,0,0],half:[.2,.25,.2],mass:3,position:[0,1.5,0],scale:2,quaternion:[0,Math.SQRT1_2,0,Math.SQRT1_2]});
  world=await createBurnContactWorldGpu({device,participants:[lower,upper]});
  for(let i=0;i<180;i++)world.advance(1/120);
  const pos=await read(upper.resident.buffers.positions),vel=await read(upper.resident.buffers.velocities);
  assert.ok(Math.abs(pos[0]-10)<.01&&Math.abs(pos[1])<.01&&Math.abs(pos[2])<.01,'Independent local frames must stack at the same world-space contact');
  assert.ok(Math.abs(pos[3]-1/3)<1e-6,'Gather/scatter must not scale physical mass a second time');
  assert.ok(Math.abs(vel[1])<.05,'World support reactions must return to the local velocity field');
  assert.equal(lower.counts().steps,90);assert.equal(upper.counts().steps,90);assert.ok(Math.abs(upper.counts().seconds-1.5)<1e-10);
  device.queue.writeBuffer(lower.resident.buffers.positions,12,new Float32Array([0]));
  for(let i=0;i<120;i++)world.advance(1/120);
  const fallen=await read(upper.resident.buffers.positions);
  assert.ok(fallen[1]<-.45,'Consumed lower material must cease carrying the independently owned upper field');
  const before=Array.from(fallen);upper.frame().position[0]+=3;world.advance(0);const moved=await read(upper.resident.buffers.positions);
  moved.forEach((v,k)=>assert.ok(Math.abs(v-before[k])<1e-5,'Native root placement must not rebind or reset the local mechanical pose'));
  assert.equal(world.read().runtimeReadbacks,0);assert.equal(world.read().objects,2);
 }finally{world?.dispose();owned.forEach(b=>b.destroy());}
},{wgslSources:[{label:'burn-world-transfer-production',code:BURN_CONTACT_WORLD_WGSL,entryPoint:'toWorld'}]});

let builds=0,drops=0,advances=0;
const host=createSceneBurnContact({renderer:{backend:{device:{}}},createWorld:async()=>{builds++;return {dispose(){drops++;},advance(){advances++;},read:()=>({})};}});
const a={resident:{}},b={resident:{}};
await host.sync([a,b]);assert.equal(host.matches([a,b]),true);await host.sync([a,b]);assert.equal(builds,1,'Placement, heat and elapsed time do not rebuild the shared contact world');
host.advance(.1,[a,b]);assert.equal(advances,1);assert.equal(host.matches([a]),false);assert.throws(()=>host.advance(.1,[a]),/not synchronized/);
await host.sync([a]);assert.equal(builds,2);assert.equal(drops,1);host.dispose();assert.equal(drops,2);assert.equal(host.matches([a]),false);
let release;const delayed=createSceneBurnContact({renderer:{backend:{device:{}}},createWorld:()=>new Promise(r=>{release=r;})});
const build=delayed.sync([a]);assert.equal(delayed.matches([a]),false);delayed.dispose();release({dispose(){drops++;}});await build;assert.equal(drops,3,'Late creation after disposal must release its owned world');
