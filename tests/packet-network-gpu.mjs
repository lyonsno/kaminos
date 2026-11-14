// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createPacketNetwork,packetNetworkSettings,PACKET_NETWORK_WGSL} from '../volume-packet-network.mjs';

test('network settings keep material density, ray coverage and reconstruction support independent',()=>{
 const s=packetNetworkSettings({sources:4,receivers:50,width:12,sections:24,receiverRadius:.2});
 assert.equal(s.receivers,50);assert.equal(s.sources,4);assert.equal(s.width,12);assert.equal(s.sections,24);assert.equal(s.receiverRadius,.2);
 assert.throws(()=>packetNetworkSettings({sources:0}),/sources/);assert.throws(()=>packetNetworkSettings({receiverRadius:0}),/receiverRadius/);
 assert.throws(()=>packetNetworkSettings({hiddenCap:4}),/Unknown/);
});
test('native network reduces current source membership, keeps every contributor and returns incident on material receivers',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owned=[],make=(size,usage)=>{const b=d.createBuffer({size,usage});owned.push(b);return b;};
  const particles=make(4*96,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),options=make(592,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const records=new Float32Array(96);
  for(let i=0;i<4;i++){const at=i*24;records.set([i<2?-.5:.5,(i%2)*.1,0,1],at);records.set([2,1,.5,0],at+8);records.set([.03,0,0,.15],at+16);records[at+22]=.1;}
  const f=new Float32Array(148);f.set([1,1],44);f.set([1,1],56);f.set([1,1,1,1],88);f.set([1,0,1,0],104);f.set([1,0,1,0],108);d.queue.writeBuffer(options,0,f);d.queue.writeBuffer(particles,0,records);
  const material={particles,options,slots:4,identity:{epoch:4,step:9,frame:13},domain:{origin:[-1,-1,-1],dims:[4,4,4],pitch:.5},coverage:{kind:'fixture',unsampled:'unknown'}};
  const network=createPacketNetwork(d);d.pushErrorScope('validation');
  try{
   const e=d.createCommandEncoder(),result=network.encode(e,{material,settings:{sources:2,receivers:2,width:3,sections:16,receiverRadius:.3}});
   const views=[network.buffers.membership,network.buffers.groups,result.centers,result.radiance];
   const read=views.map(b=>make(b.size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ));views.forEach((b,i)=>e.copyBufferToBuffer(b,0,read[i],0,b.size));d.queue.submit([e.finish()]);
   const error=await d.popErrorScope();assert.equal(error,null,error?.message);
   for(const b of read)await b.mapAsync(GPUMapMode.READ);
   assert.deepEqual([...new Uint32Array(read[0].getMappedRange())],[0,0,1,1],'source domains are disjoint while retaining all four members');
   const centers=new Float32Array(read[2].getMappedRange());assert.ok(Math.abs(centers[0]+.5)<1e-6);assert.ok(Math.abs(centers[4]-.5)<1e-6);
   const incoming=new Float32Array(read[3].getMappedRange());assert.ok(incoming[0]>0&&incoming[4]>0,'both actual material receivers see the current sources');assert.equal(incoming[3],1);assert.equal(incoming[7],1);
   assert.equal(result.identity.epoch,4);assert.equal(result.receipt.temporalReuse,false);assert.equal(result.receipt.work.depositedInstances,4*2*2*6);
   for(const b of read)b.unmap();
  }finally{network.dispose();owned.forEach(b=>b.destroy());}
 },{wgslSources:[{label:'native current material packet network',code:PACKET_NETWORK_WGSL,entryPoint:'buildBundles'}]});
});
