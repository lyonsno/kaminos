// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createLiveParticleCohort} from '../volume-particle-live-cohort.mjs';
import {createPacketCandidateIndex,createPacketCandidates,PACKET_BUNDLE_STRUCT_WGSL} from '../volume-packet-candidates.mjs';
import {packPacketBundles,finitePacketBundle} from '../volume-packet-bundle.mjs';

test('live source membership separates movers, fresh soot and reused slots on a shared native index',async()=>{
 await withKaminosGpu(async({device})=>{
  const buffers=[];
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
  function buffer(size,usage=storage){
   const b=device.createBuffer({size,usage});buffers.push(b);return b;
  }
  const slots=4;
  const particles=buffer(slots*96),birthGenerations=buffer(slots*4);
  const options=buffer(592,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const bundles=buffer(96);
  const candidateIndex=createPacketCandidateIndex(device);
  const transport=createPacketCandidates(device,PACKET_BUNDLE_STRUCT_WGSL);
  const retired=[];
  const cohort=createLiveParticleCohort(device,bs=>retired.push(...bs));
  const domain={origin:[-1,-1,-1],dims:[32,32,32],pitch:1/16};
  const optics=new Float32Array(148);
  optics.set([.02,1],44);
  optics[56]=1;
  optics.set([1,2],88);
  optics.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],128);
  optics[147]=1;
  device.queue.writeBuffer(options,0,optics);
  device.queue.writeBuffer(bundles,0,packPacketBundles([finitePacketBundle({
   origin:[0,0,-1],target:[0,0,1],halfSize:[1,1],far:2,weight:1,
  })]));
  const carriers=new Float32Array(slots*24);
  function particle(slot,x,emission,soot,width=.05){
   const i=slot*24;
   carriers.set([x,0,0,1],i);
   carriers.set([emission,0,0,1],i+8);
   carriers.set([width,0,0,.06],i+16);
   carriers.set([1,1,soot,1],i+20);
  }
  const pick={point:[0,0],pixelScale:[100,100],radiusPixels:2};
  async function observe(step,keys,picking,epoch=1){
   device.queue.writeBuffer(particles,0,carriers);
   device.queue.writeBuffer(birthGenerations,0,new Uint32Array(keys));
   const material={particles,birthGenerations,options,slots,domain,candidateIndex,identity:{epoch,step,frame:step}};
   const encoder=device.createCommandEncoder();
   const baseline=transport.encode(encoder,{material,bundleBuffer:bundles,plan:{bundles:1,slots,instances:slots},profileWrites:()=>({})});
   assert.equal(baseline.reusedIndex,false);
   let submitted;
   const next=cohort.encode(encoder,{material,pick:picking?pick:null,step,radiusCells:1,afterSubmit:cb=>{submitted=cb;}});
   device.queue.submit([encoder.finish()]);
   await submitted?.();
   return next.mask?cohort.read():next.status;
  }
  try{
   particle(0,0,1,0);
   // Its center lies outside the box. Its native support reaches into it.
   particle(1,.07,0,.6,.2);
   particle(2,.4,1,0);
   const first=await observe(1,[10,11,12,0],true);
   assert.equal(first.reusedIndex,true);
   assert.equal(first.seedSlot,0);
   assert.deepEqual([first.original,first.fresh,first.overlap,first.emittingOriginal,first.extinctiveOriginal],[2,2,2,1,1]);
   particle(0,.12,0,.4);
   particle(1,.6,0,.6);
   particle(2,.13,1,0);
   const later=await observe(2,[10,11,12,0]);
   assert.deepEqual([later.original,later.fresh,later.overlap,later.emittingOriginal,later.extinctiveOriginal],[2,2,1,0,2]);
   const reused=await observe(3,[13,11,12,0]);
   assert.equal(reused.phase,'seed-lost');
   assert.deepEqual([reused.original,reused.fresh,reused.overlap],[1,0,0]);
   const expired=await observe(4,[10,11,12,0],false,2);
   assert.equal(expired.phase,'expired');
  }finally{
   await device.queue.onSubmittedWorkDone();
   cohort.dispose();candidateIndex.dispose();transport.dispose();
   for(const b of [...buffers,...retired])b.destroy();
  }
 });
});
