// kaminos-test: node
import assert from 'node:assert/strict';
import {createRefinementLayout,refinementIndex,refinementCell} from '../ash/refinement-plan.mjs';
import {refinementArena} from '../ash/refinement-shader.mjs';
import {refinementVertexWGSL} from '../ash/refinement-surface.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
const p=createRefinementLayout({cellSize:1,bounds:{min:[0,0,0],max:[8,8,8]},tileSize:4,refinement:{ratio:2,regions:[{min:[0,0,0],max:[8,8,8]}]}}),a=refinementArena(p),i=refinementIndex(p,[4,0,4]),tile=refinementCell(p,i).tile;
const mass=new Float32Array(p.count);mass[i]=.8;mass[refinementIndex(p,[5,0,4])]=.2;
const faces=new Uint32Array(p.faceWords);faces[a.words[tile*8+4]]=12;
for(let t=0;t<=p.tiles.count;t++)a.words[a.prefix+t]=t>tile?1:0;
const code=refinementVertexWGSL(p,a)+`
@group(0) @binding(0) var<storage,read> vm:array<f32>;
@group(0) @binding(1) var<storage,read> vs:array<u32>;
@group(0) @binding(2) var<storage,read> vf:array<u32>;
@group(0) @binding(3) var<storage,read> va:array<u32>;
@group(0) @binding(4) var<storage,read_write> result:array<vec4<f32>>;
@compute @workgroup_size(1) fn main(){result[0]=ash_refined_vertex(0u,vec2<f32>(1.0),0.0,&vm,&vs,&vf,&va);result[1]=ash_refined_vertex(0u,vec2<f32>(1.0),1.0,&vm,&vs,&vf,&va);}`;
await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U,GPUMapMode:M}=ctx;const owned=[];
 try{await withGpuErrorScopes(device,'retained ash physical face bands',async()=>{
  const arrays=[mass,new Uint32Array(p.count),faces,a.words,new Float32Array(8)];
  const buffers=arrays.map(array=>{const b=device.createBuffer({size:array.byteLength,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,array);return b;});
  const module=await ctx.compileShaderModule({code,label:'production ash vertex positions'}),pipe=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
  const group=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  const read=device.createBuffer({size:32,usage:U.COPY_DST|U.MAP_READ});owned.push(read);const e=device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();e.copyBufferToBuffer(buffers[4],0,read,0,32);device.queue.submit([e.finish()]);await read.mapAsync(M.READ);const values=new Float32Array(read.getMappedRange().slice(0));read.unmap();
  assert.ok(Math.abs(values[1]-.8)<1e-6,'unsmoothed top remains at its physical cell fill height');assert.ok(Math.abs(values[5]-.8)<1e-6,'smooth lighting must not move geometry into another layer');
  console.log('physical ash tops remain fixed under smooth lighting');
 });}finally{for(const b of owned)b.destroy();}
},{wgslSources:[{code,entryPoint:'main',label:'retained ash physical face bands'}]});
