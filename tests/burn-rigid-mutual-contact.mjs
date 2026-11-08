// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createBurnRigidIslandsGpu,BURN_RIGID_ISLANDS_WGSL} from '../burn-rigid-islands-gpu.mjs';

await withKaminosGpu(async({device})=>{
 const owned=[];
 const buffer=data=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 const floor={position:[0,-.1,0],quaternion:[0,0,0,1],halfExtents:[10,.1,10],friction:.6};
 async function run({centers,half,masses,velocity,gravity=[0,-9.81,0],supports=[floor],steps=180,removeAt=-1,mutualContacts=true}){
  const n=centers.length,initial=Float32Array.from(centers.flatMap((c,i)=>[...c,1/masses[i]]));
  const positions=buffer(initial),rotations=buffer(Float32Array.from(centers.flatMap(()=>[0,0,0,1]))),velocities=buffer(Float32Array.from(centers.flatMap((_,i)=>[...(velocity?.[i]??[0,0,0]),0]))),angular=buffer(new Float32Array(n*4)),boxes=buffer(Float32Array.from(half.flatMap(h=>[0,...h]))),joints=buffer(new Float32Array(4));
  const motion=await createBurnRigidIslandsGpu({device,positions,rotations,velocities,angular,boxes,joints,bodies:n,bonds:0,supports,gravity,timeStep:1/120,iterations:12,mutualContacts});
  const frames=[];
  async function snapshot(){const readback=device.createBuffer({size:n*16*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});try{const e=device.createCommandEncoder();[positions,rotations,velocities,angular].forEach((b,i)=>e.copyBufferToBuffer(b,0,readback,i*n*16,n*16));device.queue.submit([e.finish()]);await readback.mapAsync(GPUMapMode.READ);const a=new Float32Array(readback.getMappedRange()).slice();assert.ok(a.every(Number.isFinite));frames.push({p:a.slice(0,n*4),q:a.slice(n*4,n*8),v:a.slice(n*8,n*12),w:a.slice(n*12)});}finally{readback.unmap();readback.destroy();}}
  try{await snapshot();for(let i=0;i<steps;i++){if(i===removeAt){device.queue.writeBuffer(positions,12,new Float32Array([0]));}const e=device.createCommandEncoder();motion.encode(e);device.queue.submit([e.finish()]);if(i%30===29||i===steps-1)await snapshot();}return frames;}finally{motion.dispose();}
 }
 try{
  const stack={centers:[[0,.5,0],[0,1.5,0]],half:[[.5,.5,.5],[.4,.5,.4]],masses:[2,1]};
  const held=await run(stack);
  assert.ok(held.at(-1).p[5]>1.48,'An independent lower body must carry the upper body, not let both settle through one another onto the floor');
  assert.ok(held.every(f=>Math.abs(f.v[1])<.15&&Math.abs(f.v[5])<.15),'A cold supported stack must not launch or drift');
  const unsupported=await run({...stack,removeAt:60});
  assert.ok(unsupported.at(-1).p[5]<.6,'Removing the actual lower mass must release its load; no invisible support');
  const off=await run({...stack,mutualContacts:false});
  assert.ok(off.at(-1).p[5]<.6,'Independent-contact-off control must expose the fall-through');
  const impact=await run({centers:[[-.55,.2,0],[.55,0,0]],half:[[.5,.5,.5],[.5,.5,.5]],masses:[1,3],velocity:[[2,0,0],[0,0,0]],gravity:[0,0,0],supports:[],steps:30});
  const hit=impact.at(-1);
  assert.ok(hit.v[4]>.1,'The struck body receives momentum');
  assert.ok(hit.v[0]<1.9,'The striking body receives the opposite reaction');
  assert.ok(Math.abs(hit.v[0]+3*hit.v[4]-2)<.003,'Mutual contact conserves total linear momentum');
  assert.ok(Math.abs(hit.w[2])+Math.abs(hit.w[6])>.02,'An off-center impact transfers angular momentum');
 }finally{owned.forEach(b=>b.destroy());}
},{wgslSources:[{label:'burn-rigid-mutual-production',code:BURN_RIGID_ISLANDS_WGSL,entryPoint:'solve'}]});
