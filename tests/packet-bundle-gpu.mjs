// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createPacketBundleTransport,finitePacketBundle,PACKET_BUNDLE_WGSL} from '../volume-packet-bundle.mjs';

test('native finite bundle integrates current intrinsic source and foreground extinction together',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owned=[],buffer=(size,usage)=>{const b=d.createBuffer({size,usage});owned.push(b);return b;};
  const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
  const particles=buffer(3*96,usage),options=buffer(592,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),membership=buffer(12,usage),triangles=buffer(48,usage);
  const f=new Float32Array(148);f.set([1,1],44);f.set([1,1],56);f.set([1,1,1,1],88);f.set([1,0,1,0],104);f.set([1,0,1,0],108);d.queue.writeBuffer(options,0,f);
  const transport=createPacketBundleTransport(d),material={particles,options,slots:3,identity:{epoch:7,step:11,frame:23},coverage:{kind:'fixture',unsampled:'unknown'}};
  const row=(z,emission=[0,0,0],soot=0)=>{const p=new Float32Array(24);p.set([0,0,z,1]);p.set([999,999,999,-1],4);p.set(emission,8);p.set([.4,0,0,.2],16);p[22]=soot;return p;};
  const data=new Float32Array(72);data.set(row(1,[4,2,1]));
  const request={material,width:1,height:1,sections:16,receivers:1,bundles:[finitePacketBundle({origin:[0,0,0],target:[0,0,1],halfSize:[.5,.5],near:0,far:4,weight:1})]};
  async function solve(patch={}){
   d.pushErrorScope('validation');
   d.queue.writeBuffer(particles,0,data);
   const encoder=d.createCommandEncoder(),result=transport.encode(encoder,{...request,...patch});
   const read=buffer(result.buffer.size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);encoder.copyBufferToBuffer(result.buffer,0,read,0,read.size);d.queue.submit([encoder.finish()]);
   const error=await d.popErrorScope();assert.equal(error,null,error?.message);
   await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange().slice(0));read.unmap();return {values,result};
  }
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.002,`${actual} versus ${expected}`);
  try{
   let r=await solve();near(r.values[0],.8);near(r.values[1],.4);assert.equal(r.values[3],1);
   assert.deepEqual(r.result.identity,material.identity);assert.equal(r.result.receipt.history,'fresh-only');
   data.set(row(.5,[0,0,0],3),24);r=await solve();near(r.values[0],.8*Math.exp(-.6));
   data.set(row(2,[0,0,0],3),24);r=await solve();near(r.values[0],.8);
   data.set(row(1,[4,2,1],3));data.fill(0,24);r=await solve();near(r.values[0],.8*(-Math.expm1(-.6))/.6);
   data.set(row(1,[4,2,1]));
   r=await solve({bundles:[finitePacketBundle({origin:[0,0,0],target:[0,0,1],halfSize:[.5,.5],near:1,far:4,weight:1})]});near(r.values[0],.4);
   d.queue.writeBuffer(triangles,0,new Float32Array([-2,-2,.75,0,2,-2,.75,0,0,2,.75,0]));
   r=await solve({triangles,triangleCount:1});near(r.values[0],0);assert.equal(r.result.receipt.visibility,'current-finite-triangle-depth');
   d.queue.writeBuffer(membership,0,new Uint32Array([1,0,0]));
   const b=finitePacketBundle({origin:[0,0,0],target:[0,0,1],halfSize:[.5,.5],near:0,far:4,weight:1,source:0});
   r=await solve({membership,bundles:[b]});near(r.values[0],0);
   b.source=1;r=await solve({membership,bundles:[b]});near(r.values[0],.8);
   b.weight=.5;r=await solve({membership,bundles:[b,{...b}]});near(r.values[0],.8);
   data.set(row(1,[1e8,1e8,1e8]));r=await solve();assert.equal(r.values[3],0,'half-float saturation must invalidate the incident result');
   assert.throws(()=>transport.encode(d.createCommandEncoder(),{...request,triangleCount:1}),/triangle buffer/);
  }finally{transport.dispose();for(const b of owned)b.destroy();}
 },{wgslSources:[{label:'finite orthographic production bundles',code:PACKET_BUNDLE_WGSL,entryPoint:'integrate'}]});
});
