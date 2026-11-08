// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createRefinementLayout} from '../ash/refinement-plan.mjs';
import {refinementArena,refinementShader} from '../ash/refinement-shader.mjs';
await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U,GPUMapMode:M,GPUShaderStage:S}=ctx;
 const p=createRefinementLayout({cellSize:.005,bounds:{min:[0,0,0],max:[.32,.32,.32]},refinement:{mode:'hierarchy',ratio:2,backgroundCellSize:.08,budgetMiB:.25}}),a=refinementArena(p),h=p.hierarchyArena,owned=[];
 const make=(size,extra=0)=>{const b=device.createBuffer({size,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|extra});owned.push(b);return b;};
 try{await withGpuErrorScopes(device,'shared-pool pressure eligibility',async()=>{
  const buffers=[make(p.count*4),make(p.count*4),make(p.count*4),make(p.count*8),make(p.tiles.count*32),make(a.words.byteLength),make(a.surfaceCache.words*4),make(144,U.UNIFORM)];
  const layout=device.createBindGroupLayout({entries:buffers.map((_,binding)=>({binding,visibility:S.COMPUTE,buffer:{type:binding===7?'uniform':binding===2?'read-only-storage':'storage'}}))});
  const module=await ctx.compileShaderModule({code:refinementShader(p,a,device.limits.maxComputeWorkgroupsPerDimension)}),pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'hierarchy_pressure'}}),group=device.createBindGroup({layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  for(const [free,quota,demand,expected]of [[5,10,3,0],[0,0,3,0],[0,10,3,1],[0,0,4,1]]){
   const words=a.words.slice();words[h.state]=free;words[h.state+7]=1;words[h.state+11]=0;words[h.demand]=demand;words[h.policy+5]=quota;device.queue.writeBuffer(buffers[5],0,words);
   const read=device.createBuffer({size:4,usage:U.COPY_DST|U.MAP_READ});
   try{const e=device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();e.copyBufferToBuffer(buffers[5],(h.state+11)*4,read,0,4);device.queue.submit([e.finish()]);await read.mapAsync(M.READ);const actual=new Uint32Array(read.getMappedRange())[0];read.unmap();assert.equal(actual,expected,JSON.stringify({free,quota,demand}));}finally{read.destroy();}
  }
 });}finally{for(const b of owned)b.destroy();}
});
