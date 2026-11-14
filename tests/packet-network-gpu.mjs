// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createPacketNetwork,packetNetworkSettings,PACKET_NETWORK_WGSL} from '../volume-packet-network.mjs';
import {createPacketBundleTransport,finitePacketBundle} from '../volume-packet-bundle.mjs';

test('network settings keep material density, ray coverage and reconstruction support independent',()=>{
 const s=packetNetworkSettings({sources:4,receivers:50,width:12,sections:24,nearDirections:8,receiverRadius:.2});
 assert.equal(s.receivers,50);assert.equal(s.sources,4);assert.equal(s.width,12);assert.equal(s.sections,24);assert.equal(s.nearDirections,8);assert.equal(s.receiverRadius,.2);
 assert.throws(()=>packetNetworkSettings({sources:0}),/sources/);assert.throws(()=>packetNetworkSettings({receiverRadius:0}),/receiverRadius/);
 assert.throws(()=>packetNetworkSettings({hiddenCap:4}),/Unknown/);
});

test('network endpoints preserve long acquired intervals independently from small transverse support',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owned=[],make=(size,usage)=>{const b=d.createBuffer({size,usage});owned.push(b);return b;};
  const particles=make(192,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),options=make(592,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),birthGenerations=make(8,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);d.queue.writeBuffer(birthGenerations,0,new Uint32Array([1,1]));
  const records=new Float32Array(48);records.set([0,0,0,1]);records.set([1e-6,0,0,0],8);records.set([.01,0,0,.01],16);records.set([0,0,1,1],24);records.set([4,2,1,0],32);records.set([.01,0,0,1],40);
  const f=new Float32Array(148);f.set([1,1],44);f.set([1,1],56);f.set([1,1,1,1],88);f.set([1,0,1,0],104);f.set([1,0,1,0],108);d.queue.writeBuffer(options,0,f);d.queue.writeBuffer(particles,0,records);
  const material={particles,options,birthGenerations,slots:2,identity:{epoch:4,step:9,frame:13},domain:{origin:[-1,-1,-1],dims:[4,4,4],pitch:.5},coverage:{kind:'fixture',unsampled:'unknown'}};
  const network=createPacketNetwork(d),reference=createPacketBundleTransport(d);
  async function read(encode){d.pushErrorScope('validation');const e=d.createCommandEncoder(),buffers=encode(e),reads=buffers.map(b=>make(b.size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ));buffers.forEach((b,i)=>e.copyBufferToBuffer(b,0,reads[i],0,b.size));d.queue.submit([e.finish()]);const error=await d.popErrorScope();assert.equal(error,null,error?.message);const values=[];for(const b of reads){await b.mapAsync(GPUMapMode.READ);values.push(new Float32Array(b.getMappedRange().slice(0)));b.unmap();}return values;}
  try{
   const [incoming,bundles]=await read(e=>{const r=network.encode(e,{material,settings:{sources:1,receivers:2,width:1,sections:16,receiverRadius:.2,nearRatio:1e6}});return [r.radiance,network.buffers.bundles];});
   assert.ok(bundles[7]>=1.5,'source interval ends at depth 1.5 even though transverse support is .01');
   const b=finitePacketBundle({origin:[0,0,0],target:[0,0,1],halfSize:[bundles[11],bundles[15]],near:0,far:2,weight:bundles[16]});
   const [extended]=await read(e=>[reference.encode(e,{material,width:1,height:1,sections:16,receivers:1,bundles:[b]}).buffer]);
   assert.ok(extended[0]>0);assert.ok(Math.abs(incoming[0]-extended[0])<1e-5*extended[0],`${incoming[0]} versus complete interval ${extended[0]}`);
  }finally{network.dispose();reference.dispose();owned.forEach(b=>b.destroy());}
 },{wgslSources:[{label:'packet source endpoint production',code:PACKET_NETWORK_WGSL,entryPoint:'buildBundles'}]});
});
test('native network reduces current source membership, keeps every contributor and returns incident on material receivers',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owned=[],make=(size,usage)=>{const b=d.createBuffer({size,usage});owned.push(b);return b;};
  const particles=make(4*96,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),options=make(592,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),birthGenerations=make(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const generations=new Uint32Array([1,1,1,1]);d.queue.writeBuffer(birthGenerations,0,generations);
  const records=new Float32Array(96);
  for(let i=0;i<4;i++){const at=i*24;records.set([i<2?-.5:.5,(i%2)*.1,0,1],at);records.set([2,1,.5,0],at+8);records.set([.03,0,0,.15],at+16);records[at+22]=.1;}
  const f=new Float32Array(148);f.set([1,1],44);f.set([1,1],56);f.set([1,1,1,1],88);f.set([1,0,1,0],104);f.set([1,0,1,0],108);d.queue.writeBuffer(options,0,f);d.queue.writeBuffer(particles,0,records);
  const material={particles,options,birthGenerations,slots:4,identity:{epoch:4,step:9,frame:13},domain:{origin:[-1,-1,-1],dims:[4,4,4],pitch:.5},coverage:{kind:'fixture',unsampled:'unknown'}};
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
   assert.equal(result.identity.epoch,4);assert.equal(result.receipt.temporalReuse,false);assert.equal(result.receipt.work.submittedInstances,4*2*2*6);
   for(const b of read)b.unmap();
   async function selection(nearDirections=6){
    d.queue.writeBuffer(particles,0,records);d.queue.writeBuffer(birthGenerations,0,generations);material.identity.step++;
    d.pushErrorScope('validation');const e=d.createCommandEncoder();const result=network.encode(e,{material,settings:{sources:2,receivers:2,width:3,sections:16,nearDirections,receiverRadius:.3}});
    const inputs=[result.centers,network.buffers.receiverKeys,network.buffers.bundles],outputs=inputs.map(b=>make(b.size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ));inputs.forEach((b,i)=>e.copyBufferToBuffer(b,0,outputs[i],0,b.size));d.queue.submit([e.finish()]);const error=await d.popErrorScope();assert.equal(error,null,error?.message);
    for(const b of outputs)await b.mapAsync(GPUMapMode.READ);const resultData={centers:new Float32Array(outputs[0].getMappedRange().slice(0)),keys:new Uint32Array(outputs[1].getMappedRange().slice(0)),bundles:new Float32Array(outputs[2].getMappedRange().slice(0)),receipt:result.receipt};for(const b of outputs)b.unmap();return resultData;
   }
   records[1]=-.2;records.set([100,50,25],32);let selected=await selection();
   assert.ok(Math.abs(selected.centers[1]+.2)<1e-6,'surviving receiver follows its primary carrier instead of jumping to a newly brighter neighbor');assert.deepEqual([...selected.keys.slice(0,2)],[0,1]);
   generations[0]=2;records[1]=.7;selected=await selection();assert.ok(Math.abs(selected.centers[1]-.1)<1e-6,'a replacement cannot inherit the old receiver association');assert.deepEqual([...selected.keys.slice(0,2)],[1,1]);
   material.identity.epoch++;records[1]=-.4;records.set([500,250,125],8);selected=await selection();assert.ok(Math.abs(selected.centers[1]+.4)<1e-6,'new pool epoch clears even matching slot-generation pairs');assert.deepEqual([...selected.keys.slice(0,2)],[0,2]);
   records.set([1000,500,250],32);selected=await selection(8);assert.deepEqual([...selected.keys.slice(0,2)],[0,2],'angular quality edits preserve surviving primary anchors');assert.equal(selected.receipt.bundles,2*2*8);
   let weight=0;for(let i=0;i<8;i++){const b=selected.bundles.subarray(i*24,(i+1)*24);assert.ok(Math.abs(Math.hypot(...b.subarray(4,7))-1)<1e-6);weight+=b[16];}assert.ok(Math.abs(weight-1)<1e-6,'broad-source angular weights retain the spherical mean when count changes');
  }finally{network.dispose();owned.forEach(b=>b.destroy());}
 },{wgslSources:[{label:'native current material packet network',code:PACKET_NETWORK_WGSL,entryPoint:'buildBundles'}]});
});
