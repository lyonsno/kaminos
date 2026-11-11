// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Matrix4,WebGPUCoordinateSystem} from '../lib/three.core.js';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createSplitIntegral,SPLIT_OPTICAL_WGSL} from '../volume-split-integral.mjs';
import {particleAcquisitionData} from '../volume-particle-acquisition.mjs';

test('off-center follow targets survive native UV, ray and depth reconstruction without vertical mirroring',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const camera=new PerspectiveCamera(45,1,.1,10);camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.z=4;camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const vp=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),inverse=vp.clone().invert();
  const owner=createSplitIntegral(d),arenaLayout=d.createBindGroupLayout({entries:[{binding:39,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'storage'}}]});
  const code=`fn worldInsideFine(p:vec3<f32>)->bool{return true;}fn worldToCell(p:vec3<f32>)->vec3<f32>{return p;}fn sampleFluidSlot(p:vec3<f32>,slot:u32)->vec4<f32>{return vec4<f32>(0);}${SPLIT_OPTICAL_WGSL}
  @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-3),vec2<f32>(3,1),vec2<f32>(-1,1));return vec4<f32>(p[i],0,1);}
  @fragment fn fs(@builtin(position) pixel:vec4<f32>)->@location(0)vec4<f32>{
   let uv=splitAcquisitionUv(vec2<f32>(.5),pixel.xy);let ndc=uv*2.0-vec2<f32>(1);
   let inverse=mat4x4<f32>(${inverse.elements.join(',')});let nearRaw=inverse*vec4<f32>(ndc,-1,1);let farRaw=inverse*vec4<f32>(ndc,1,1);
   let ro=vec3<f32>(0,0,4);let rd=normalize(farRaw.xyz/farRaw.w-nearRaw.xyz/nearRaw.w);
   let hit=acquisitionBox(ro,rd,vec3<f32>(-1),vec3<f32>(1));let selected=splitAcquisitionHit(pixel.xy,ro,rd,hit,hit,100);
   let r=splitInit(pixel.xy,ro,rd,max(0.0,selected.x),selected.y,.5);let depth=splitSampleDepth(r,ro,rd,(r.start+r.end)*.5,hit,0,.5);
   return vec4<f32>(ro+rd*depth,select(0.0,1.0,selected.y>selected.x));
  }`;
  const module=d.createShaderModule({code}),pipeline=d.createRenderPipeline({layout:d.createPipelineLayout({bindGroupLayouts:[arenaLayout,owner.emptyLayout,owner.emptyLayout,owner.layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba32float'}]}});
  const target=d.createTexture({size:[1,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  try{for(const point of [[.2,.6,.1],[-.3,-.5,-.1]]){
   const e=d.createCommandEncoder(),acquisition=particleAcquisitionData({settings:{acquisitionMode:1,filmJitter:0,sourceBias:0,fineCoverage:1,coarseCoverage:0},batch:{width:1,height:1,samples:1},phase:1,vp:vp.elements,fine:{lo:[-1,-1,-1],hi:[1,1,1]}});
   const prepared=owner.prepare(e,{width:1,height:1,acquisition,settings:{mode:'transport',fresh:1},sourcesOnly:true,identity:'off-center-ray',step:1,viewProj:vp.elements,backtrace:1,fineScale:1,staggered:false});
   const upload=d.createBuffer({size:64,usage:GPUBufferUsage.COPY_SRC,mappedAtCreation:true}),values=new Float32Array(upload.getMappedRange());values.set([...point,-1],4);upload.unmap();e.copyBufferToBuffer(upload,0,owner.buffer,0,64);
   const pass=e.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});pass.setPipeline(pipeline);pass.setBindGroup(0,d.createBindGroup({layout:arenaLayout,entries:[{binding:39,resource:{buffer:owner.buffer}}]}));pass.setBindGroup(1,owner.emptyGroup);pass.setBindGroup(2,owner.emptyGroup);pass.setBindGroup(3,prepared.group);pass.draw(3);pass.end();
   const read=d.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[1,1]);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const result=new Float32Array(read.getMappedRange().slice(0,16));assert.equal(result[3],1);point.forEach((v,i)=>assert.ok(Math.abs(result[i]-v)<1e-5,`actual ray missed target component${i}: ${result[i]} != ${v}`));read.unmap();read.destroy();upload.destroy();
  }}finally{owner.dispose();target.destroy();}
 });
});
