// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,WebGPUCoordinateSystem,Vector3} from '../lib/three.core.js';
import {SCENE_REFLECTION_QUERY_WGSL} from '../scene-reflection-query.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';

test('production reflection query retains nearby distinct surfaces independently of depth thickness',async()=>{
 await withKaminosGpu(async({device})=>{
  const camera=new PerspectiveCamera(60,1,.1,100);camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();
  const depthValue=new Vector3(0,0,-2).applyMatrix4(camera.projectionMatrix).z;
  const matrix=m=>'mat4x4<f32>('+Array.from({length:4},(_,i)=>'vec4<f32>('+m.elements.slice(i*4,i*4+4).map(n=>Number(n).toExponential(12)).join(',')+')').join(',')+')';
  const usage=GPUTextureUsage,depth=device.createTexture({size:[256,1],format:'depth32float',usage:usage.TEXTURE_BINDING|usage.RENDER_ATTACHMENT});
  const color=device.createTexture({size:[1,1],format:'rgba16float',usage:usage.TEXTURE_BINDING|usage.COPY_DST});
  const normal=device.createTexture({size:[256,1],format:'rgba32float',usage:usage.TEXTURE_BINDING|usage.COPY_DST});
  const result=device.createBuffer({size:48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:48,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  try{
   device.queue.writeTexture({texture:color},new Uint16Array([0x4000,0,0,0x3c00]),{bytesPerRow:8},[1,1]);
   const normals=new Float32Array(256*4);for(let i=0;i<256;i++)normals.set([0,0,1,.1],i*4);
   device.queue.writeTexture({texture:normal},normals,{bytesPerRow:256*16},[256,1]);
   const module=device.createShaderModule({code:SCENE_REFLECTION_QUERY_WGSL+`
    @group(0) @binding(0) var depths:texture_depth_2d;
    @group(0) @binding(1) var colors:texture_2d<f32>;
    @group(0) @binding(2) var filtered:sampler;
    @group(0) @binding(3) var normals:texture_2d<f32>;
    @group(0) @binding(4) var<storage,read_write> results:array<vec4<f32>>;
    @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3<u32>){
     let gap=select(0.02,0.08,id.x==2u);let thickness=select(0.15,0.3,id.x==1u);
     let hit=traceSceneReflection(vec3<f32>(0.0,0.0,-2.0+gap),normalize(vec3<f32>(0.6,0.0,-1.0)),
      depths,colors,filtered,normals,${matrix(camera.projectionMatrix)},${matrix(camera.projectionMatrixInverse)},
      0.4,thickness,0.1,64u,vec3<f32>(0.0,0.0,1.0),vec3<f32>(0.0,0.0,1.0),0.1);
     results[id.x]=vec4<f32>(f32(hit.kind),hit.distance,hit.confidence,hit.radiance.r);
    }`});
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:depth.createView()},{binding:1,resource:color.createView()},
    {binding:2,resource:device.createSampler({minFilter:'linear',magFilter:'linear'})},
    {binding:3,resource:normal.createView()},{binding:4,resource:{buffer:result}},
   ]});
   const encoder=device.createCommandEncoder(),clear=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthClearValue:depthValue,depthLoadOp:'clear',depthStoreOp:'store'}});clear.end();
   const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(3);pass.end();encoder.copyBufferToBuffer(result,0,read,0,48);device.queue.submit([encoder.finish()]);
   await read.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(read.getMappedRange()));read.unmap();
   console.log('reflection-contact-hits:',JSON.stringify(values));
   assert.equal(values[8],1,'distant control surface is hit');
   assert.equal(values[0],1,'distinct surface two centimeters away must remain hittable');
   assert.equal(values[4],1,'depth penetration tolerance must not enlarge the origin exclusion');
   assert.ok(values[1]>.02&&values[1]<.03);assert.ok(Math.abs(values[1]-values[5])<1e-5);
   assert.equal(values[3],2,'HDR source preserved');
  }finally{depth.destroy();color.destroy();normal.destroy();result.destroy();read.destroy();}
 });
});
