// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {PARTICLE_GRID_EXTINCTION_WGSL} from '../volume-particle-extinction.mjs';
import {Matrix4,PerspectiveCamera,WebGPUCoordinateSystem} from '../lib/three.core.js';

test('grid extinction visits each crossed voxel once and preserves every ordered prefix',async()=>{
 await withKaminosGpu(async ctx=>{
  const d=ctx.device,n=32;
  // Count executed coefficient loads without changing their values. Compare the
  // output to the analytic integral of four differently extinctive z slabs.
  const code=`
struct Options {vp:mat4x4<f32>,inverse:mat4x4<f32>,fine:vec4<f32>,gain:vec4<f32>}
@group(0) @binding(7) var<storage,read_write> loads:atomic<u32>;
fn witnessLoad(cell:vec3<i32>)->vec4<f32>{atomicAdd(&loads,1u);return textureLoad(medium,cell,0);}
`+PARTICLE_GRID_EXTINCTION_WGSL.replace('SCENE_DEPTH_TYPE','texture_depth_2d').replace('SCENE_DEPTH_REDUCE','').replaceAll('textureLoad(medium,cell,0)','witnessLoad(cell)');
  const pipeline=d.createComputePipeline({layout:'auto',compute:{module:await ctx.compileShaderModule({code}),entryPoint:'build'}});
  const buffer=(size,usage)=>d.createBuffer({size,usage});
  const u=buffer(160,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const params=buffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const bounds=buffer(8,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
  const loads=buffer(4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
  const read=buffer(768,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  const medium=d.createTexture({size:[1,1,4],format:'rgba32float',dimension:'3d',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const tex=(format,width,usage)=>d.createTexture({size:[width,1],format,usage});
  const prefix=tex('r32float',n,GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC);
  const totals=tex('rg32float',1,GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC);
  const depth=tex('depth32float',1,GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING);
  const sigmas=[1,4,2,3],voxelRows=new Float32Array(16);
  sigmas.forEach((sigma,i)=>voxelRows[4*i+3]=sigma);
  d.queue.writeTexture({texture:medium},voxelRows,{bytesPerRow:16,rowsPerImage:1},[1,1,4]);
  d.queue.writeBuffer(params,0,new Uint32Array([1,1,n,n]));
  d.queue.writeBuffer(bounds,0,new Float32Array([3.125,4.875]));
  const near=.1,far=20,eps=2e-5;
  try{
   for(const {z,solidAt,expectedLoads,reverse=false} of [{z:4,solidAt:null,expectedLoads:4},{z:-4,solidAt:4.125,expectedLoads:3,reverse:true}]){
    const camera=new PerspectiveCamera(45,1,near,far);camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.z=z;camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const vp=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    const values=new Float32Array(40);values.set(vp.elements);values.set(vp.clone().invert().elements,16);values.set([4,4,4,0,0,0,0,1],32);d.queue.writeBuffer(u,0,values);
    d.queue.writeBuffer(loads,0,new Uint32Array([0]));
    const solidDepth=solidAt==null?1:far/(far-near)*(1-near/solidAt);
    const e=d.createCommandEncoder();e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:solidDepth}}).end();
    const resources=[medium.createView(),{buffer:u},{buffer:params},{buffer:bounds},prefix.createView(),totals.createView(),depth.createView(),{buffer:loads}];
    const p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({resource,binding}))}));p.dispatchWorkgroups(1);p.end();
    for(const [texture,offset,width] of [[prefix,0,n],[totals,256,1]])e.copyTextureToBuffer({texture},{buffer:read,offset,bytesPerRow:256},[width,1]);
    e.copyBufferToBuffer(loads,0,read,512,4);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);
    const bytes=read.getMappedRange().slice(0);read.unmap();const row=new Float32Array(bytes);
    const order=reverse?sigmas:[...sigmas].reverse();
    const integral=t=>order.reduce((a,sigma,i)=>a+sigma*Math.max(0,Math.min(.5,Math.min(t,solidAt??5)-(3+i*.5))),0);
    for(let k=0;k<n;k++)assert.ok(Math.abs(row[k]-integral(3.125+1.75*(k+1)/n))<eps,`slice ${k}, camera z ${z}, got ${row[k]}`);
    assert.ok(Math.abs(row[64]-integral(3.125))<eps,'before first slice');
    assert.ok(Math.abs(row[65]-integral(5))<eps,'after last slice and at opaque depth');
    assert.equal(new Uint32Array(bytes)[128],expectedLoads,'denser slice cuts must not refetch the same coefficients');
   }
  }finally{for(const x of [u,params,bounds,loads,read,medium,prefix,totals,depth])x.destroy();}
 });
});
