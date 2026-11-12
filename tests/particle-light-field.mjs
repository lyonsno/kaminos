// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {readLightBuffer} from '../tools/particle-light-reference.mjs';
import {createParticleIncidentField} from '../volume-particle-light-field.mjs';
// RGBA16F directional slabs quantize coefficients to about 5e-4 relative.
const near=(a,b,t=8e-4)=>assert.ok(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('full angular receiver field has correct normalized units, extinction and reset over a homogeneous medium',async()=>{
 await withKaminosGpu(async ctx=>withGpuErrorScopes(ctx.device,'full angular particle receiver field',async()=>{
  const d=ctx.device;
  for(const sigma of [0,.7]){
   const medium=new Float32Array(3**3*4);for(let i=0;i<27;i++)medium.set([2,1,.5,sigma],4*i);
   const owner=await createParticleIncidentField(d,{dims:[3,3,3],origin:[-1,-1,-1],extent:[2,2,2],transportWidth:3,pairs:[[0,0,1]],medium});
   try{for(let run=0;run<2;run++){const e=d.createCommandEncoder();owner.encode(e);d.queue.submit([e.finish()]);const field=await readLightBuffer(d,owner.incident),phi=sigma?-Math.expm1(-sigma)/sigma:1;for(let k=0;k<3;k++)near(field[4*13+k],[2,1,.5][k]*phi);assert.ok(field.every(Number.isFinite));near(owner.plan.weightSum,1);}}
   finally{owner.dispose();}
  }
 }));
});
import {particleDirectionPairs,directionalLightFrame} from '../volume-particle-light-field.mjs';
test('direction pairs cover a normalized sphere and oriented frames enclose the complete physical box',()=>{
 const origin=[-2,1,4],extent=[2,3,2];
 for(const count of [2,8,24,48]){
  const pairs=particleDirectionPairs(count);assert.equal(pairs.length*2,count);
  for(const direction of pairs){near(Math.hypot(...direction),1,1e-12);const f=directionalLightFrame({dims:[8,8,8],origin,extent,direction});
   for(let i=0;i<8;i++){const point=origin.map((a,k)=>a+((i>>k)&1)*extent[k]);for(const [axis,k] of [[f.u,0],[f.v,1],[f.direction,2]]){const q=axis.reduce((v,a,j)=>v+a*(point[j]-f.origin[j]),0);assert.ok(q>=-1e-12&&q<=f.extent[k]+1e-12);}}
  }
 }
 assert.throws(()=>particleDirectionPairs(3));assert.throws(()=>particleDirectionPairs(0));
});
import {PARTICLE_LIGHT_VIEW_WGSL} from '../volume-particle-light-view.mjs';
test('camera integrates every voxel including inside and parallel rays, separating intrinsic and first-scattered light',async()=>{
 await withKaminosGpu(async ctx=>withGpuErrorScopes(ctx.device,'shared medium camera integral',async()=>{
  const d=ctx.device,usage=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST;
  const medium=d.createTexture({size:[2,2,2],dimension:'3d',format:'rgba32float',usage}),incident=d.createTexture({size:[2,2,2],dimension:'3d',format:'rgba32float',usage});
  const output=d.createBuffer({size:4*4*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  try{
   const m=new Float32Array(32),j=new Float32Array(32);for(let i=0;i<8;i++){m.set([2,1,.5,.5],4*i);j.set([4,2,1,0],4*i);}d.queue.writeTexture({texture:medium},m,{bytesPerRow:32,rowsPerImage:2},[2,2,2]);d.queue.writeTexture({texture:incident},j,{bytesPerRow:32,rowsPerImage:2},[2,2,2]);
   const code=PARTICLE_LIGHT_VIEW_WGSL+`\n@group(0) @binding(0) var m:texture_3d<f32>;@group(0) @binding(1) var j:texture_3d<f32>;@group(0) @binding(2) var<storage,read_write> output:array<vec4<f32>>;\n@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;let eye=select(vec3<f32>(0,0,3),vec3<f32>(0),i==3u);output[i]=particleLightCamera(m,j,eye,vec3<f32>(0,0,-1),vec3<f32>(-1),vec3<f32>(2),.5,min(i,2u),-3.0);}`;
   const module=await ctx.compileShaderModule({code}),pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}}),group=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:medium.createView()},{binding:1,resource:incident.createView()},{binding:2,resource:{buffer:output}}]});const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(4);p.end();d.queue.submit([e.finish()]);const actual=await readLightBuffer(d,output);
   for(let i=0;i<4;i++){const length=i===3?1:2,alpha=-Math.expm1(-.5*length),source=i===0?2:i===1?1:3,linear=source*alpha/.5;near(actual[4*i],-Math.expm1(-linear/8));near(actual[4*i+3],alpha);}
  }finally{medium.destroy();incident.destroy();output.destroy();}
 }));
});
