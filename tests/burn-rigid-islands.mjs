// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createBurnRigidIslandsGpu,BURN_RIGID_ISLANDS_WGSL} from '../burn-rigid-islands-gpu.mjs';

const near=(a,b,tolerance=2e-4)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
await withKaminosGpu(async({device})=>{
 const allocate=data=>{const buffer=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,data);return buffer;};
 async function run({centers,masses,half=[.5,.5,.5],spin=0,supports=[],gravity=[0,-9.81,0],steps=60,breakAt=null,disableContact=false}){
  const n=centers.length,p=Float32Array.from(centers.flatMap((c,i)=>[...c,1/masses[i]])),q=Float32Array.from(centers.flatMap(()=>[0,0,0,1]));
  const v=Float32Array.from(centers.flatMap(c=>[-spin*c[1],spin*c[0],0,0])),w=Float32Array.from(centers.flatMap(()=>[0,0,spin,0]));
  const box=Float32Array.from(centers.flatMap(()=>[0,...half])),joints=new Float32Array(44);new Uint32Array(joints.buffer).set([0,1,0,1]);
  const buffers=[p,q,v,w,box,joints].map(allocate);let dynamics;const frames=[];
  const snapshot=async()=>{const bytes=n*16*4,staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});try{const encoder=device.createCommandEncoder();for(let i=0;i<4;i++)encoder.copyBufferToBuffer(buffers[i],0,staging,i*n*16,n*16);device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);const data=new Float32Array(staging.getMappedRange()).slice();assert.ok(data.every(Number.isFinite));return {p:data.slice(0,n*4),q:data.slice(n*4,n*8),v:data.slice(n*8,n*12),w:data.slice(n*12)};}finally{staging.unmap();staging.destroy();}};
  try{
   dynamics=await createBurnRigidIslandsGpu({device,positions:buffers[0],rotations:buffers[1],velocities:buffers[2],angular:buffers[3],boxes:buffers[4],joints:buffers[5],bodies:n,bonds:1,supports,gravity,timeStep:1/60,iterations:8});
   if(disableContact)dynamics.setContactsEnabled(false);
   frames.push(await snapshot());
   for(let step=0;step<steps;step++){
    if(step===breakAt){new Uint32Array(joints.buffer)[3]=0;device.queue.writeBuffer(buffers[5],0,joints);}
    const encoder=device.createCommandEncoder();dynamics.encode(encoder);device.queue.submit([encoder.finish()]);frames.push(await snapshot());
   }
   return {frames,state:dynamics.read()};
  }finally{dynamics?.dispose();buffers.forEach(b=>b.destroy());}
 }
 const free=await run({centers:[[-1,0,0],[1,0,0]],masses:[2,2],spin:1});
 for(const row of free.frames)near(Math.hypot(...row.p.slice(0,3).map((v,k)=>v-row.p[4+k])),2);
 const last=free.frames.at(-1);near((last.p[1]+last.p[5])/2,-9.81*61/120);near((last.v[1]+last.v[5])/2,-9.81);near(last.p[4]-last.p[0],2*Math.cos(1));near(last.w[2],1);
 assert.equal(free.state.failureModel,'consumed-connection-only-no-load-estimate');
 const split=await run({centers:[[-1,0,0],[1,0,0]],masses:[2,2],spin:1,breakAt:30});
 assert.ok(Math.hypot(...split.frames.at(-1).p.slice(0,3).map((v,k)=>v-split.frames.at(-1).p[4+k]))>2.1,'Separated regions follow inherited tangential velocities, not continued orbital attachment');
 near((split.frames.at(-1).v[1]+split.frames.at(-1).v[5])/2,-9.81);
 const floor={position:[0,-.1,0],quaternion:[0,0,0,1],halfExtents:[10,.1,10],friction:.5};
 for(const mass of [1,50]){
  const supported=await run({centers:[[-.5,.5,0],[.5,.5,0]],masses:[mass,mass],supports:[floor],steps:180});
  const peak=Math.max(...supported.frames.map(row=>(row.v[1]+row.v[5])/2));assert.ok(peak<.02,`Cold compound must not launch at mass ${mass}: ${peak}`);
  for(const row of supported.frames){near(row.p[4]-row.p[0],1,.003);assert.ok((row.p[1]+row.p[5])/2>.49,'Compound must not sink into support');}
 }
 const away=await run({centers:[[-.5,.5,0],[.5,.5,0]],masses:[1,1],supports:[{...floor,position:[100,-.1,0],halfExtents:[.1,.1,.1]}]});
 near((away.frames.at(-1).v[1]+away.frames.at(-1).v[5])/2,-9.81);
 const off=await run({centers:[[-.5,.5,0],[.5,.5,0]],masses:[1,1],supports:[floor],disableContact:true});
 near((off.frames.at(-1).v[1]+off.frames.at(-1).v[5])/2,-9.81);
 const tipped=await run({centers:[[-.5,.5,0],[.5,.5,0]],masses:[1,1],supports:[{...floor,position:[-.9,-.1,0],halfExtents:[.2,.1,2]}]});
 assert.ok(tipped.frames.some(row=>Math.abs(row.w[2])>.2),'Off-center finite support produces torque and tipping');
 assert.ok((tipped.frames.at(-1).p[1]+tipped.frames.at(-1).p[5])/2<.4,'Unsupported compound falls instead of hovering');
},{wgslSources:[{label:'burn-rigid-islands-production',code:BURN_RIGID_ISLANDS_WGSL,entryPoint:'solve'}]});
