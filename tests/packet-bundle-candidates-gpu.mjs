// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createPacketBundleTransport,finitePacketBundle} from '../volume-packet-bundle.mjs';
import {createResidentVolume} from '../particle-resident-volume.mjs';

test('current spatial candidates reach the production bundle raster without losing support', async()=>{
 await withKaminosGpu(async({device})=>{
  const slots=128,owned=[];
  const buffer=(size,usage)=>{
   const b=device.createBuffer({size,usage});owned.push(b);return b;
  };
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
  const particles=buffer(slots*96,storage);
  const options=buffer(592,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const material={
   particles,options,slots,identity:{epoch:7,step:11,frame:23},
   domain:{origin:[-1,-1,-1],pitch:2/32,dims:[32,32,32]},
  };
  const uniforms=new Float32Array(148);
  uniforms.set([1,1],44);uniforms.set([1,1],56);uniforms.set([1,1,1,1],88);
  uniforms.set([1,0,1,0],104);uniforms.set([1,0,1,0],108);
  device.queue.writeBuffer(options,0,uniforms);
  const data=new Float32Array(slots*24);
  function row(slot,position,{radius=.03125,interval=.125,emission=.5,soot=0}={}){
   const i=slot*24;
   data.set([...position,1],i);
   data.set([emission,emission*.5,emission*.25,0],i+8);
   data.set([radius,0,0,interval],i+16);
   data[i+22]=soot;
  }
  for(let i=0;i<slots-4;i++)row(i,[.7,.7,(i%20)/16-.625]);
  // The bundle ends at x=.23125. Slot 124 is across the x=.25 bin
  // boundary but its projected support overlaps the sampled column.
  row(124,[.27,0,.25],{radius:.0625});
  row(125,[.2,0,-.4],{emission:0,soot:1});
  row(126,[.2,0,1.02],{interval:.125});
  const axial=finitePacketBundle({origin:[.2,0,-1],target:[.2,0,1],halfSize:[.03125,.0625],far:2,weight:1});
  const diagonal=finitePacketBundle({origin:[-.6,-.4,-1],target:[.6,.4,1],halfSize:[.0625,.0625],far:2.5,weight:.5});
  const transport=createPacketBundleTransport(device);
  async function solve(bundles,cull){
   const read=device.createBuffer({size:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try {
    device.pushErrorScope('validation');
    device.queue.writeBuffer(particles,0,data);
    const encoder=device.createCommandEncoder();
    const result=transport.encode(encoder,{material,bundles,width:1,height:1,sections:12,receivers:1,cull});
    encoder.copyBufferToBuffer(result.buffer,0,read,0,16);
    if(result.submission)encoder.copyBufferToBuffer(result.submission,0,read,16,16);
    device.queue.submit([encoder.finish()]);
    const error=await device.popErrorScope();
    assert.equal(error,null,error?.message);
    await read.mapAsync(GPUMapMode.READ);
    const snapshot=read.getMappedRange().slice(0);
    return {light:[...new Float32Array(snapshot,0,4)],draw:[...new Uint32Array(snapshot,16,4)],work:result.receipt.work};
   } finally {read.destroy();}
  }
  function equivalent(actual,reference){
   assert.equal(actual[3],1);
   for(let channel=0;channel<3;channel++){
    assert.ok(Math.abs(actual[channel]-reference[channel])<.002,
     `channel ${channel}: ${actual[channel]} versus ${reference[channel]}`);
   }
  }
  try {
   const reference=await solve([axial,diagonal],false);
   assert.ok(reference.light[0]>.02,'fixture must see the support and exterior depth interval');
   const culled=await solve([axial,diagonal],true);
   assert.equal(culled.work.rasterSubmission,'gpu-current-support-index');
   assert.equal(culled.draw[0],6);
   assert.ok(culled.draw[1]>0&&culled.draw[1]<slots/4,`submitted ${culled.draw[1]}`);
   equivalent(culled.light,reference.light);

   // Move a previously indexed slot into the ray and create another live slot.
   // Deliberately reuse the same buffers and identity to rule out a spatial cache.
   row(30,[.2,0,.375],{emission:2});
   row(127,[.2,0,-.625],{emission:1});
   const moved=await solve([axial,diagonal],true);
   const movedReference=await solve([axial,diagonal],false);
   assert.ok(moved.light[0]>culled.light[0]+.1);
   equivalent(moved.light,movedReference.light);

   const wide={...axial,halfSize:[1,1]};
   const wideRequests=[wide,wide,wide];
   const wideResult=await solve(wideRequests,true);
   assert.equal(wideResult.draw[1],slots*wideRequests.length,'workspace overflow selects the complete dense draw');
   equivalent(wideResult.light,(await solve(wideRequests,false)).light);

   const empty={...axial,weight:0};
   const emptyResult=await solve([empty],true);
   assert.deepEqual(emptyResult.draw,[6,0,0,0]);
   assert.deepEqual(emptyResult.light,[0,0,0,1]);
  } finally {
   transport.dispose();
   for(const b of owned)b.destroy();
  }
 });
});

test('resident volume culls fresh columns only and retains the shared light cadence',async()=>{
 await withKaminosGpu(async({device})=>{
  const usage=GPUBufferUsage,owned=[];
  const buffer=(size,extra=0)=>{
   const b=device.createBuffer({size,usage:usage.STORAGE|usage.COPY_DST|extra});owned.push(b);return b;
  };
  const dims=[8,8,8],slots=4;
  const material={
   particles:buffer(slots*96),options:device.createBuffer({size:592,usage:usage.UNIFORM|usage.COPY_DST}),
   fine:buffer(16),sourceOptions:device.createBuffer({size:240,usage:usage.UNIFORM|usage.COPY_DST}),
   slots,domain:{origin:[-1,-1,-1],pitch:2/8,dims,worldFromFine:{scale:1,translate:[0,0,0]}},
  };
  const u=new Float32Array(148);
  u.set([1,1],44);u.set([1,1],56);u.set([1,1,1,1],88);
  u.set([1,0,1,0],104);u.set([1,0,1,0],108);
  device.queue.writeBuffer(material.options,0,u);
  const data=new Float32Array(slots*24);
  data.set([0,0,0,1]);data.set([2,1,.5,0],8);data.set([.075,0,0,.2],16);data[22]=1;
  device.queue.writeBuffer(material.particles,0,data);
  const settings={mode:'advected',width:3,stride:3,refreshEvery:2};
  const dense=createResidentVolume(device,settings,dims);
  const indexed=createResidentVolume(device,{...settings,cullFresh:true},dims);
  const results=device.createBuffer({size:2*27*16,usage:usage.COPY_DST|usage.MAP_READ});
  async function frame(step){
   device.pushErrorScope('validation');
   const encoder=device.createCommandEncoder();
   const frame={...material,identity:{epoch:1,step,frame:step,materialStamp:'controlled'}};
   const a=dense.encode(encoder,frame),b=indexed.encode(encoder,frame);
   [a,b].forEach((result,i)=>encoder.copyBufferToBuffer(result.views.advected.buffer,0,results,i*27*16,27*16));
   device.queue.submit([encoder.finish()]);
   const error=await device.popErrorScope();assert.equal(error,null,error?.message);
   await results.mapAsync(GPUMapMode.READ);
   const values=new Float32Array(results.getMappedRange());
   for(let i=0;i<27*4;i++)assert.ok(Math.abs(values[i]-values[i+27*4])<.002,`voxel component ${i}`);
   const lit=values.some((v,i)=>i%4!==3&&v>0);
   results.unmap();
   return {work:b.work,lit};
  }
  try{
   const seed=await frame(1);
   assert.equal(seed.work.freshRasterSubmission,'dense');
   const refresh=await frame(2);
   assert.equal(refresh.work.freshRasterSubmission,'gpu-current-support-index');
   assert.equal(refresh.work.freshIndexSlots,slots);
   assert.equal(refresh.work.freshRays,6);
   assert.equal(refresh.lit,true);
   const reuse=await frame(3);
   assert.equal(reuse.work.freshRasterSubmission,null);
   assert.equal(reuse.work.freshIndexSlots,0);
   assert.equal(reuse.work.freshRays,0);
  }finally{
   dense.dispose();indexed.dispose();results.destroy();
   material.options.destroy();material.sourceOptions.destroy();
   for(const b of owned)b.destroy();
  }
 });
});
