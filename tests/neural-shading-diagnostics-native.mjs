// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {NEURAL_FALLBACK_COUNT_WGSL} from '../scene-neural-diagnostics.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';

test('production reduction counts neural hits and misses over partial tiles without full-frame readback',async()=>{
 await withKaminosGpu(async ctx=>{
  const {device}=ctx,module=await ctx.compileShaderModule({label:'neural-fallback-count',code:NEURAL_FALLBACK_COUNT_WGSL});
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
  const texture=device.createTexture({size:[3,2],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const source=device.createTexture({size:[3,2],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const totals=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  const read=device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  const entries=[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:totals}},{binding:2,resource:source.createView()}];
  const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
  async function count(pixels,expected=pixels.map(p=>p[3]>0)){
   device.queue.writeTexture({texture:source},new Uint16Array(expected.flatMap(covered=>[0,0,0,covered?0x8400:0])),{bytesPerRow:24},[3,2]);
   device.queue.writeTexture({texture},new Uint8Array(pixels.flat()),{bytesPerRow:12},[3,2]);
   device.queue.writeBuffer(totals,0,new Uint32Array(4));
   const e=device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,bind);p.dispatchWorkgroups(1,1);p.end();e.copyBufferToBuffer(totals,0,read,0,16);device.queue.submit([e.finish()]);
   await read.mapAsync(GPUMapMode.READ);try{return [...new Uint32Array(read.getMappedRange())];}finally{read.unmap();}
  }
  try{
   const green=[0,255,0,255],red=[255,0,0,255],empty=[0,0,0,0],unknown=[255,255,0,255];
   assert.deepEqual(await count([green,red,empty,green,empty,red]),[4,2,2,0]);
   assert.deepEqual(await count([empty,empty,empty,empty,empty,empty]),[0,0,0,0]);
   assert.deepEqual(await count([green,red,unknown,empty,empty,empty]),[3,1,1,1]);
   assert.deepEqual(await count([empty,empty,empty,empty,empty,empty],[true,false,false,false,false,false]),[1,0,0,1],'blank mask cannot certify an existing neural source');
   const wrong=await count([red,red,empty,green,empty,red]);assert.throws(()=>assert.deepEqual(wrong,[4,2,2,0]),/Expected/);
  }finally{texture.destroy();source.destroy();totals.destroy();read.destroy();}
 },{wgslSources:[{label:'neural-fallback-count',code:NEURAL_FALLBACK_COUNT_WGSL,entryPoint:'main'}]});
});
