// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createMaterialPacketBuilder,MATERIAL_PACKET_BUILD_WGSL} from '../volume-material-packets.mjs';
import {createMaterialPacketNetwork,materialPacketTransportWgsl} from '../volume-material-packet-transport.mjs';
import {gaussianNormalInterval,opticalGaussian,opticalGaussianSegment} from '../volume-optical-gaussian.mjs';
function fixture(d,records){
 const buffers=[],make=(size,usage)=>{const b=d.createBuffer({size,usage});buffers.push(b);return b;};
 const particles=make(records.length*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),options=make(592,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),f=new Float32Array(148);
 f.set([1,1],44);f.set([1,1],56);f.set([1,1,1,1],88);f.set([1,0,1,0],104);f.set([1,0,1,0],108);d.queue.writeBuffer(particles,0,records);d.queue.writeBuffer(options,0,f);
 return {make,particles,options,optionData:f,material:{particles,options,slots:records.length/24,identity:{epoch:1,step:1,frame:1,materialStamp:'fixture'},domain:{origin:[-1,-1,-1],dims:[2,2,2],pitch:1,worldFromFine:{scale:1,translate:[0,0,0]}},coverage:{kind:'deterministic admitted material',unsampled:'unknown'}},dispose:()=>buffers.forEach(b=>b.destroy())};
}
function record(position,e,soot,radius=.03,length=.2){const f=new Float32Array(24);f.set([...position,1]);f.set([100,100,100,0],4);f.set([...e,0],8);f.set([radius,0,0,length],16);f[22]=soot;return f;}
async function read(d,encode,make){d.pushErrorScope('validation');const e=d.createCommandEncoder(),input=encode(e),out=input.map(b=>make(b.size,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST));input.forEach((b,i)=>e.copyBufferToBuffer(b,0,out[i],0,b.size));d.queue.submit([e.finish()]);const error=await d.popErrorScope();assert.equal(error,null,error?.message);const result=[];for(const b of out){await b.mapAsync(GPUMapMode.READ);result.push(b.getMappedRange().slice(0));b.unmap();}return result;}
const close=(a,b,relative=3e-5)=>assert.ok(Math.abs(a-b)<=relative*Math.max(1e-10,Math.abs(b)),`${a} versus ${b}`);

test('current packets preserve every admitted coefficient amount and separate bright and absorbing morphology',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const rows=new Float32Array([...record([-.3,0,0],[4,2,1],0),...record([.3,0,0],[0,0,0],7)]),f=fixture(d,rows),b=createMaterialPacketBuilder(d);await b.prepare();
  try{
   for(const materialSubdivisions of [1,2]){
    const [rawPackets,rawKernels,rawStats,rawIds]=await read(d,e=>{const built=b.encode(e,{material:f.material,settings:{mode:'material-packets',packetWidth:1,materialSubdivisions}});return [built.resources.packets,built.resources.kernels,built.resources.stats,built.resources.ids];},f.make);
    const p=new Float32Array(rawPackets),k=new Float32Array(rawKernels),u=new Uint32Array(rawKernels),stats=new Uint32Array(rawStats);
    const volume=2*Math.PI*gaussianNormalInterval(-2.5,2.5)**2*.03*.03*.2;
    close(p[12],4*volume);close(p[13],2*volume);close(p[14],volume);close(p[15],7*volume);assert.equal(p[11],2);assert.equal(stats[0],1);assert.equal(stats[1],1);assert.deepEqual([...new Uint32Array(rawIds)].sort(),[0,1]);
    let e=0,t=0,ex=0,tx=0;for(let at=0;at<k.length;at+=32){if(!u[at+31])continue;assert.equal(u[at+28],0,'same packet identity owns both roles');e+=k[at+16];t+=k[at+19];if(u[at+29]===0)ex=k[at];else tx=k[at];assert.ok(k[at+3]>0&&Number.isFinite(k[at+3]));}
    close(e,4*volume);close(t,7*volume);close(ex,-.3);close(tx,.3);f.material.identity.step++;
   }
   f.optionData[57]=2;f.optionData[91]=3;d.queue.writeBuffer(f.options,0,f.optionData);
   const [scaled]=await read(d,e=>[b.encode(e,{material:f.material,settings:{mode:'material-packets',packetWidth:1}}).resources.packets],f.make);
   close(new Float32Array(scaled)[15],7*6*2*Math.PI*gaussianNormalInterval(-2.5,2.5)**2*.03*.03*.2);
  }finally{b.dispose();f.dispose();}
 },{wgslSources:[{label:'current packet material production',code:MATERIAL_PACKET_BUILD_WGSL,entryPoint:'fitMaterial'}]});
});

test('fresh packet transfer has the analytic homogeneous source/extinction ratio and never feeds captured light back',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const f=fixture(d,record([0,0,0],[2,1,.5],1,.1,.2)),network=createMaterialPacketNetwork(d),settings={mode:'material-packets',packetWidth:1,width:1,sections:8,nearDirections:6};await network.prepare(settings);
  try{
   const [rr,kk,ss]=await read(d,e=>{const result=network.encode(e,{material:f.material,settings});assert.equal(result.receipt.work.rawFineSlotsSubmittedForTransport,0);assert.match(result.receipt.sourceReceiverRelationship,/one current material packet/);return [result.radiance,network.buffers.kernels,network.buffers.stats];},f.make);
   const r=new Float32Array(rr),k=new Float32Array(kk),stats=new Uint32Array(ss);const t=32;
   const radius=[1/Math.sqrt(k[t+4]),1/Math.sqrt(k[t+9]),1/Math.sqrt(k[t+14])],kernel=opticalGaussian({id:0,center:[0,0,0],radii:radius,supportSigmas:3});
   const tau=k[t+19]*opticalGaussianSegment(kernel,[0,0,0],[10,0,0]),expected=1-Math.exp(-tau);
   close(r[0],2*expected,2e-4);close(r[1],expected,2e-4);close(r[2],.5*expected,2e-4);assert.equal(r[3],1);assert.equal(stats[2],1);assert.equal(stats[3],6);assert.equal(stats[8],0);
  }finally{network.dispose();f.dispose();}
 },{wgslSources:[{label:'fresh material packet transfer production',code:materialPacketTransportWgsl(8),entryPoint:'tracePackets'}]});
});

test('every intervening absorbing packet and current solid clip the finite source connection',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const rows=new Float32Array([...record([-.5,0,0],[0,0,0],.1),...record([0,0,0],[0,0,0],0),...record([.5,0,0],[10,4,1],0)]),f=fixture(d,rows),network=createMaterialPacketNetwork(d),settings={mode:'material-packets',packetWidth:3,width:2,sections:16,nearDirections:6};await network.prepare(settings);
  const wall=f.make(96,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);d.queue.writeBuffer(wall,0,new Float32Array([0,-10,-10,0,0,10,-10,0,0,10,10,0,0,-10,-10,0,0,10,10,0,0,-10,10,0]));
  async function run(block=false){f.material.identity.step++;f.material.identity.frame++;d.queue.writeBuffer(f.particles,0,rows);const [rr,pp,rawRays,rawKernels,rawStats]=await read(d,e=>{const result=network.encode(e,{material:f.material,settings,triangles:wall,triangleCount:block?2:0});return [result.radiance,network.buffers.packets,network.buffers.rays,network.buffers.kernels,network.buffers.stats];},f.make);const p=new Float32Array(pp),r=new Float32Array(rr);let index=-1;for(let i=0;i<p.length/16;i++)if(p[i*16+3]>0&&Math.abs(p[i*16]+.5)<1e-5)index=i;assert.ok(index>=0);return r[index*4];}
  try{const open=await run();assert.ok(open>0);const solid=await run(true);assert.ok(solid<open*1e-5,`${solid} behind solid versus ${open}`);rows[24+22]=500;const smoke=await run();assert.ok(smoke<open*.01,`${smoke} through third material versus ${open}`);}finally{network.dispose();f.dispose();}
 },{wgslSources:[{label:'current packet source and third material',code:materialPacketTransportWgsl(16),entryPoint:'tracePackets'}]});
});

test('zero effective optical amounts retain finite local material receiver supports',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const f=fixture(d,new Float32Array([...record([-.5,0,0],[0,0,0],2),...record([.5,0,0],[2,1,.5],0)])),b=createMaterialPacketBuilder(d);await b.prepare();
  try{for(const zero of ['extinction','emission','both']){
   f.optionData[57]=zero==='emission'?1:0;f.optionData[56]=zero==='extinction'?1:0;d.queue.writeBuffer(f.options,0,f.optionData);
   const [pp]=await read(d,e=>[b.encode(e,{material:f.material,settings:{mode:'material-packets',packetWidth:3}}).resources.packets],f.make);const p=new Float32Array(pp);let occupied=0;
   for(let at=0;at<p.length;at+=16){if(!p[at+11])continue;occupied++;assert.ok(p.slice(at,at+16).every(Number.isFinite),'zero effective coefficients must retain finite material support');assert.ok(p[at+3]>0&&p[at+3]<.5,'zero optical gain must not grant global receiving reach');for(let a=0;a<3;a++)assert.ok(p[at+4+a]<=p[at+a]&&p[at+a]<=p[at+8+a]);}assert.equal(occupied,2);
  }}finally{b.dispose();f.dispose();}
 },{wgslSources:[{label:'zero gain packet support production',code:MATERIAL_PACKET_BUILD_WGSL,entryPoint:'summarizePackets'}]});
});

test('coarse emission covariance retains a tilted material population',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const f=fixture(d,new Float32Array([...record([-.1,-.15,0],[1,1,1],0),...record([.1,.15,0],[1,1,1],0)])),b=createMaterialPacketBuilder(d);await b.prepare();
  try{const [raw]=await read(d,e=>[b.encode(e,{material:f.material,settings:{mode:'material-packets',packetWidth:1}}).resources.kernels],f.make);const k=new Float32Array(raw),a=k[4],bb=k[5],c=k[6],dd=k[9],ee=k[10],ff=k[14],det=a*(dd*ff-ee*ee)-bb*(bb*ff-c*ee)+c*(bb*ee-c*dd);
   close(k[0],0,1e-3);close(k[1],0,1e-3);close((dd*ff-ee*ee)/det,.0109,1e-3);close((a*ff-c*c)/det,.0234,1e-3);close((c*ee-bb*ff)/det,.015,1e-3);
  }finally{b.dispose();f.dispose();}
 },{wgslSources:[{label:'tilted material covariance production',code:MATERIAL_PACKET_BUILD_WGSL,entryPoint:'fitMaterial'}]});
});
