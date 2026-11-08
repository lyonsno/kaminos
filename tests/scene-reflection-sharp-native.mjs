// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,WebGPUCoordinateSystem,Vector3} from '../lib/three.core.js';
import {SCENE_REFLECTION_RECONSTRUCTION_WGSL} from '../scene-reflection-reconstruction.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
const matrix=m=>'mat4x4<f32>('+Array.from({length:4},(_,i)=>'vec4<f32>('+m.elements.slice(i*4,i*4+4).map(n=>Number(n).toExponential(12)).join(',')+')').join(',')+')';
test('sharp reconstruction preserves a one-pixel reflected feature while broad gloss still collects neighbors',async()=>{
 await withKaminosGpu(async({device})=>{
  const camera=new PerspectiveCamera(60,1,.1,100);camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();
  const depth=device.createTexture({size:[9,1],format:'depth32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});
  const textures=Array.from({length:3},()=>device.createTexture({size:[9,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}));
  const result=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   const current=new Float32Array(36);current.set([1,0,0,1],16);device.queue.writeTexture({texture:textures[0]},current,{bytesPerRow:144},[9,1]);
   device.queue.writeTexture({texture:textures[2]},new Float32Array(36),{bytesPerRow:144},[9,1]);
   const module=device.createShaderModule({code:SCENE_REFLECTION_RECONSTRUCTION_WGSL+`
    @group(0) @binding(0) var depth:texture_depth_2d;
    @group(0) @binding(1) var current:texture_2d<f32>;
    @group(0) @binding(2) var normal:texture_2d<f32>;
    @group(0) @binding(3) var stats:texture_2d<f32>;
    @group(0) @binding(4) var<storage,read_write> out:vec4<f32>;
    @compute @workgroup_size(1) fn main(){out=reconstructSceneReflection(vec2<f32>(.5),current,stats,depth,normal,current,normal,stats,stats,${matrix(camera.projectionMatrixInverse)},mat4x4<f32>(),${matrix(camera.projectionMatrix)},${matrix(camera.projectionMatrixInverse)},false,0.0,.95)[0];}`});
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:depth.createView()},...textures.map((t,i)=>({binding:i+1,resource:t.createView()})),{binding:4,resource:{buffer:result}}]});
   const values=[];
   for(const [roughness,untraced] of [[.05,false],[.5,false],[.5,true]]){
    const stats=new Float32Array(36);if(untraced)for(let i=0;i<9;i++)if(i!==4)stats[i*4+3]=-1;device.queue.writeTexture({texture:textures[2]},stats,{bytesPerRow:144},[9,1]);
    const nr=new Float32Array(36);for(let i=0;i<9;i++)nr.set([0,0,1,roughness],i*4);device.queue.writeTexture({texture:textures[1]},nr,{bytesPerRow:144},[9,1]);
    const encoder=device.createCommandEncoder(),clear=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthClearValue:new Vector3(0,0,-4).applyMatrix4(camera.projectionMatrix).z,depthLoadOp:'clear',depthStoreOp:'store'}});clear.end();
    const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(result,0,read,0,16);device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);values.push(Array.from(new Float32Array(read.getMappedRange())));read.unmap();
   }
   console.log('sharp-and-glossy-feature:',JSON.stringify(values));
   assert.ok(values[0][0]>.99,'near-mirror feature must retain its center intensity');
   assert.ok(values[1][0]<.8&&values[1][0]>0,'broad gloss must still reconstruct neighboring samples');
   assert.ok(values[2][0]>.99,'untraced allocation neighbors must not be treated as observed misses');
  }finally{depth.destroy();textures.forEach(t=>t.destroy());result.destroy();read.destroy();}
 });
});
