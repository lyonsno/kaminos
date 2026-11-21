// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createPacketBundleTransport,finitePacketBundle} from '../volume-packet-bundle.mjs';

test('fixed cells replace fine attenuation, refresh from current material, and leave emission intact',async()=>{
 await withKaminosGpu(async({device})=>{
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
  const particles=device.createBuffer({size:192,usage:storage});
  const options=device.createBuffer({size:592,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const read=device.createBuffer({size:48,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  const transport=createPacketBundleTransport(device);
  try{
   const material={particles,options,slots:2,identity:{epoch:1,step:1},domain:{origin:[0,0,0],dims:[2,2,2],pitch:1}};
   const u=new Float32Array(148);
   for(const at of [44,56,88])u.set([1,1],at);
   u.set([1,0,1,0],108);u.set([1,0,1,0],104);device.queue.writeBuffer(options,0,u);
   const p=new Float32Array(48);
   p.set([.5,.5,.5,1]);p.set([.2,0,0,.5],16);p[22]=2;
   p.set([.5,.5,1.5,1],24);p[32]=1;p.set([.2,0,0,.25],40);
   const rays=[[.5,.5,0],[1.5,.5,0],[1,1,1]].map((origin,i)=>finitePacketBundle({
    origin,target:i===2?[0,0,0]:[origin[0],origin[1],2],halfSize:[.02,.02],far:i===2?Math.sqrt(3):2,weight:1}));
   async function sample(gridWidth,extinctionOnly=false){
    device.queue.writeBuffer(particles,0,p);
    const e=device.createCommandEncoder();
    transport.encode(e,{material,bundles:rays,width:1,height:1,sections:4,receivers:1,cull:false,extinctionGridWidth:gridWidth,extinctionOnly});
    e.copyBufferToBuffer(transport.buffers.rays,0,read,0,48);device.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);const v=new Float32Array(read.getMappedRange().slice(0));read.unmap();return v;
   }
   const near=(a,b)=>assert.ok(Math.abs(a-b)<.002,`${a} != ${b}`);
   // Integral of the unit reference Gaussian over its finite square, times XY radii and interval.
   const sigma=6.128*.2*.2*.5*2;
   const first=await sample(2);near(first[3],Math.exp(-sigma));near(first[7],1);near(first[11],Math.exp(-sigma*Math.sqrt(3)));
   p[0]=1.5;material.identity.step++;
   const moved=await sample(2);near(moved[3],1);near(moved[7],Math.exp(-sigma));near(moved[11],1);
   const fine=await sample(0);near(moved[0],fine[0]);assert.ok(moved[0]>.2);near(first[0],moved[0]*first[3]);
   for(const width of [0,2]){const probe=await sample(width,true);near(probe[0],0);near(probe[7],width?moved[7]:fine[7]);}
   assert.equal(transport.read().work.submittedInstances,0);
  }finally{transport.dispose();particles.destroy();options.destroy();read.destroy();}
 });
});
