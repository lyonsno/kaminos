// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createGpuRefinedAsh} from '../ash/refinement-gpu.mjs';

await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U}=ctx,attributes=new Map();
 const renderer={backend:{isWebGPUBackend:true,device,createStorageAttribute(a){const buffer=device.createBuffer({size:a.array.byteLength,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|U.INDIRECT});device.queue.writeBuffer(buffer,0,a.array);attributes.set(a,{buffer});},createIndirectStorageAttribute(a){this.createStorageAttribute(a);},get:a=>attributes.get(a),destroyAttribute(a){attributes.get(a)?.buffer.destroy();attributes.delete(a);}}};


 let patch;try{await withGpuErrorScopes(device,'deep coarse exchange area',async()=>{
  patch=await createGpuRefinedAsh({renderer,cellSize:.08/131072,bounds:{min:[0,0,0],max:[.16,.16,.16]},refinement:{mode:'hierarchy',ratio:2,backgroundCellSize:.08,budgetMiB:.25}});
  await patch.deposit({center:[.04,0,.04],radius:.01,volume:.0005});patch.setSliding({variation:0,scale:.24,release:1});const before=await patch.snapshot();
  patch.step();const after=await patch.snapshot();assert.ok(after.values.some((v,i)=>v>0&&before.values[i]===0),'coarse material must exchange even when fine-coordinate face area exceeds u32');
  assert.ok(Math.abs(before.retainedVolume-after.retainedVolume)<1e-7);assert.match(patch.read().allocationMeaning,/hierarch/);
 });}finally{patch?.dispose();}
});
