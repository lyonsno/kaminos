// kaminos-test: node
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
const moduleUrl=name=>process.argv[2]?pathToFileURL(path.resolve(process.argv[2],name)).href:new URL('../'+name,import.meta.url).href;
const {createPointRegions}=await import(moduleUrl('scene-point-regions.mjs')),{ANGULAR_IMPORTANCE_WGSL}=await import(moduleUrl('scene-angular-importance.mjs'));
await withKaminosGpu(async({device})=>{
 const texture=device.createTexture({size:[8,8,8],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const world=device.createTexture({size:[6,6,6],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING});
 const field={status:'encoded',texture,dimensions:[8,8,8],generation:1,frame:1,gain:1};
 for(const exterior of [false,true]){
 field.exterior=exterior?{status:'encoded',emissionTexture:world,texture:world,dimensions:[6,6,6],localMin:[-3,-3,-3],localMax:[3,3,3],frame:1,generation:1}:null;
 const points=[createPointRegions(device,{count:2,partition:'spatial'}),createPointRegions(device,{count:2,partition:'spatial'})];
 try{
  points[0].setSourcePolicy?.({sourceAxisPreference:.15,sourceSplitHysteresis:0});points[1].setSourcePolicy?.({sourceAxisPreference:2,sourceSplitHysteresis:0});
  for(const [frame,xs,zs]of [[1,[1,6],[2,5]],[2,[2,5],[1,6]]]){
   const data=new Float32Array(8**3*4);for(let i=0;i<2;i++)for(const z of zs)data.set(i?[0,0,1,0]:[1,0,0,0],(xs[i]+8*(3+8*z))*4);
   device.queue.writeTexture({texture},data,{bytesPerRow:128,rowsPerImage:8},[8,8,8]);field.frame=frame;if(field.exterior)field.exterior.frame=frame;for(const p of points)p.encode(field);
  }
  const changed=(await points[0].readback()).regions,retained=(await points[1].readback()).regions;
  assert(changed.every(r=>r.energy[0]>0&&r.energy[2]>0),'small axis preference follows changed dominant variance');
  assert(retained.every(r=>Math.min(r.energy[0],r.energy[2])===0&&Math.max(r.energy[0],r.energy[2])>0),'large axis preference retains the earlier source grouping');
  for(const rows of [changed,retained])for(const a of [0,2])assert(Math.abs(rows.reduce((s,r)=>s+r.energy[a],0)-2/64)<1e-6,'source policy conserves RGB energy');
 }finally{points.forEach(p=>p.destroy());}
 }
 texture.destroy();world.destroy();
 const scores=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),cdf=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),params=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),read=device.createBuffer({size:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{
  const code=`const RECEIVER_COUNT:u32=1u;const DIRECTION_COUNT:u32=4u;const DISPATCH_WIDTH:u32=64u;`+ANGULAR_IMPORTANCE_WGSL+`@compute @workgroup_size(1)fn record(){recordImportance(0u,0u,vec3<f32>(20.0));}`;
  const layout=device.createBindGroupLayout({entries:[{binding:20,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:21,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:28,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
  const module=device.createShaderModule({code}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),prepare=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint:'prepareImportance'}}),record=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint:'record'}});
  const group=device.createBindGroup({layout,entries:[{binding:20,resource:{buffer:scores}},{binding:21,resource:{buffer:cdf}},{binding:28,resource:{buffer:params}}]});device.queue.writeBuffer(scores,0,new Float32Array([0,0,10,0]));device.queue.writeBuffer(params,0,new Float32Array([.5,.8,.1,0]));
  const e=device.createCommandEncoder();for(const pipeline of [prepare,record]){const p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(1);p.end();}e.copyBufferToBuffer(scores,0,read,0,16);e.copyBufferToBuffer(cdf,0,read,16,16);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const result=new Float32Array(read.getMappedRange()).slice();read.unmap();
  for(const [i,value]of [[0,2],[2,8],[4,.125],[5,.25],[6,.875],[7,1]])assert(Math.abs(result[i]-value)<1e-5,'live importance exploration, decay and score blend reach the production kernels');
 }finally{scores.destroy();cdf.destroy();params.destroy();read.destroy();}
});
await withKaminosGpu(async({device})=>{
 const {createVolumeGather}=await import('../scene-volume-gather.mjs'),{buildTriangleVisibility}=await import('../scene-light-visibility.mjs');
 const texture=device.createTexture({size:[4,4,4],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const noise=device.createTexture({size:[128,128],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING});
 const data=new Float32Array(4**3*4);for(let i=0;i<data.length;i+=4)data.set([1,1,1,0],i);device.queue.writeTexture({texture},data,{bytesPerRow:64,rowsPerImage:4},[4,4,4]);
 const field={status:'encoded',texture,dimensions:[4,4,4],generation:1,frame:1,gain:1};
 const gather=createVolumeGather(device,{geometry:buildTriangleVisibility([]).packGpu(),receivers:[],volumeGrid:2,sourceDimensions:field.dimensions,directions:4,smokeRefinement:1,angularPattern:'importance',samplingNoise:noise,asynchronous:true});
 try{for(const multiplier of [1,3,2]){
  gather.setImportancePolicy({importanceBankMultiplier:multiplier,importanceExploration:.5,importanceHistoryDecay:.9,importanceHistoryBlend:.1});await gather.prepare(field);const frame=gather.encode(field);const output=await gather.readback();
  assert.equal(frame.importance.bankDirections,4*multiplier);assert.equal(frame.importance.freshRaysPerReceiver,4);assert.equal(frame.importance.exploration,.5);assert.equal(frame.importance.historyDecay,.9);assert.equal(frame.importance.historyBlend,.1);assert(output.smoke.data.every(Number.isFinite),'resized proposal buffers produce finite actual receiver lighting');
 }}finally{gather.destroy();texture.destroy();noise.destroy();}
});
console.log('PASS production source grouping and importance proposal kernels respond to live policy without changing energy');
