// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createAshSceneSolids} from '../ash/scene-gpu.mjs';
import {createRefinementLayout} from '../ash/refinement-plan.mjs';
import {refinementArena} from '../ash/refinement-shader.mjs';
import {Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
await withKaminosGpu(async ctx=>{
 console.log('ash-collision-device: '+JSON.stringify(ctx.adapterInfo));
 Object.assign(globalThis,{GPUBufferUsage:ctx.GPUBufferUsage,GPUTextureUsage:ctx.GPUTextureUsage,GPUShaderStage:ctx.GPUShaderStage,GPUMapMode:ctx.GPUMapMode});
 const {device,GPUBufferUsage:U}=ctx,p=createRefinementLayout({cellSize:.04,bounds:{min:[-.32,0,-.32],max:[.32,.64,.32]},refinement:{ratio:2,mode:'adaptive',fineCapacity:2}}),a=refinementArena(p);
 // At this observed phase the old .08 cache sees the shelf, while a finer
 // cache sampled only at coarse centers loses it. No authored fine residency.
 const shelf=new Mesh(new BoxGeometry(.35,.001,.35),new MeshBasicMaterial());shelf.position.y=.38;
 try{for(const adaptive of [false,true]){
  const owned=[];let field;
  try{await withGpuErrorScopes(device,'thin coarse support from cached fine occupancy',async()=>{
   const make=size=>{const b=device.createBuffer({size,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST});owned.push(b);return b;};
   const collision=make(p.count*4),headers=make(p.tiles.count*32),arena=make(a.words.byteLength);device.queue.writeBuffer(arena,0,a.words);
   field=createAshSceneSolids({device,layout:p.regions[0].layout,collision,headers,samplingCellSize:adaptive?.04:.08,adaptive:adaptive?{layout:p,arena}:null});field.update([{id:'thin-shelf',object:shelf}]);
   const read=device.createBuffer({size:collision.size+arena.size,usage:U.COPY_DST|U.MAP_READ});owned.push(read);const e=device.createCommandEncoder();e.copyBufferToBuffer(collision,0,read,0,collision.size);e.copyBufferToBuffer(arena,0,read,collision.size,arena.size);device.queue.submit([e.finish()]);await read.mapAsync(ctx.GPUMapMode.READ);
   const data=read.getMappedRange(),values=new Uint32Array(data.slice(0,collision.size)),work=new Uint32Array(data.slice(collision.size));read.unmap();
   console.log(JSON.stringify({adaptive,occupied:values.filter(Boolean).length}));
   assert.equal(values[3+8*(4+8*3)],2,adaptive?'fine cache must retain central coarse support':'baseline must exercise an actual supported shelf');
   if(adaptive)assert.ok(work.subarray(p.adaptiveArena.demand,p.adaptiveArena.demand+p.pool.pages).some(v=>v===2),'fine support missed by the center must request direct detail');
  });}finally{field?.dispose();for(const b of owned)b.destroy();}
 }}finally{shelf.geometry.dispose();shelf.material.dispose();}
});
