// kaminos-test: node
import assert from 'node:assert/strict';
import {createRefinementLayout,refinementIndex,refinementCell,referenceRefinementStep} from '../ash/refinement-plan.mjs';
import {adaptiveView} from '../ash/adaptive-plan.mjs';
import {refinementArena,refinementShader} from '../ash/refinement-shader.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
const p=createRefinementLayout({cellSize:.02,bounds:{min:[0,0,0],max:[.48,.16,.16]},refinement:{ratio:2,mode:'adaptive',fineCapacity:1}}),a=refinementArena(p),map=p.adaptiveArena;
const code=refinementShader(p,a);
const names=['adaptive_reset','adaptive_release','adaptive_allocate_detail','adaptive_allocate_halo','adaptive_prolong','adaptive_collision_list','adaptive_collision_args','reset','admit','clear_wake','pack_dispatch','limit_flux','gather_flux','commit_mass','admit_surface','build_surface','finish_surface','draw_prefix','adaptive_recount'];
await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U,GPUMapMode:M}=ctx;
 await withGpuErrorScopes(device,'adaptive ash numerical contract',async()=>{
  const owned=[];
  const make=(size,extra=0)=>{const b=device.createBuffer({size,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|extra});owned.push(b);return b;};
  try{
   const bs=[make(p.count*4),make(p.count*4),make(p.count*4),make(p.count*8),make(p.tiles.count*32),make(a.words.byteLength),make(p.faceWords*4),make(64,U.UNIFORM)];
   device.queue.writeBuffer(bs[5],0,a.words);
   const uniform=new Uint32Array(16);uniform[13]=1;device.queue.writeBuffer(bs[7],0,uniform);
   const layout=device.createBindGroupLayout({entries:bs.map((_,binding)=>({binding,visibility:ctx.GPUShaderStage.COMPUTE,buffer:{type:binding===7?'uniform':binding===2?'read-only-storage':'storage'}}))});
   const pl=device.createPipelineLayout({bindGroupLayouts:[layout]}),module=await ctx.compileShaderModule({code,label:'production adaptive ash'});
   const pipelines=Object.fromEntries(await Promise.all(names.map(async entryPoint=>[entryPoint,await device.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})])));
   const group=device.createBindGroup({layout,entries:bs.map((buffer,binding)=>({binding,resource:{buffer}}))});
   const dispatch=(e,name,count=1)=>{const pass=e.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(count);pass.end();};
   const run=()=>{const e=device.createCommandEncoder();for(const name of names.slice(0,7))dispatch(e,name,Math.max(1,Math.ceil((name.includes('allocate')?p.pool.pages:p.pool.capacity)/64)));device.queue.submit([e.finish()]);};
   const read=async b=>{const r=device.createBuffer({size:b.size,usage:U.COPY_DST|U.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,b.size);device.queue.submit([e.finish()]);await r.mapAsync(M.READ);return r.getMappedRange().slice(0);}finally{r.unmap();r.destroy();}};
   const demand=new Uint32Array(p.pool.pages);demand[0]=2;device.queue.writeBuffer(bs[5],map.demand*4,demand);
   const coarse=refinementIndex(p,[0,0,0]),initial=new Float32Array(p.count);initial[coarse]=5.5;device.queue.writeBuffer(bs[0],0,initial);run();
   let state=new Uint32Array(await read(bs[5])),values=new Float32Array(await read(bs[0]));
   const view=()=>adaptiveView(p,{map:state.slice(map.map,map.slots),slots:state.slice(map.slots,map.demand)});
   assert.equal(state[map.map],1);assert.equal(values[coarse],0);assert.equal(values.reduce((x,y)=>x+y,0),5.5,'prolong must retain material volume');
   assert.equal(values[refinementIndex(view(),[0,0,0])],1);assert.equal(values[refinementIndex(view(),[0,1,0])],.375,'prolong preserves height/volume');
   assert.ok(state[map.state+4]>0,'unmet halo demand must remain visible when pool is full');
   demand.fill(0);demand[p.pool.pages-1]=2;device.queue.writeBuffer(bs[5],map.demand*4,demand);run();state=new Uint32Array(await read(bs[5]));
   assert.equal(state[map.map],1,'moving demand cannot demote deposited fine history');assert.equal(state[map.state+5],1);assert.ok(state[map.state+4]>0);
   uniform[13]=0;device.queue.writeBuffer(bs[7],0,uniform);run();state=new Uint32Array(await read(bs[5]));
   assert.equal(state[map.state+7],0,'a full unchanged pool must not rescan demand every settled frame');
   uniform[13]=1;device.queue.writeBuffer(bs[7],0,uniform);
   device.queue.writeBuffer(bs[0],0,new Float32Array(p.count));run();state=new Uint32Array(await read(bs[5]));
   assert.equal(state[map.map],0);assert.equal(state[map.map+p.pool.pages-1],1,'empty slots must be reusable at new demand');
   assert.equal(state[map.state+3],1);assert.equal(state[map.state+2],1);
   assert.equal(view().residency.slots[0],p.pool.pages);
   let seed=1203;const topology=view();let expected=Float32Array.from({length:p.count},(_,i)=>{const c=refinementCell(topology,i);if(!c.owned)return 0;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/4294967296)*c.size**3*.8;});
   device.queue.writeBuffer(bs[0],0,expected);const flags=new Uint32Array(p.tiles.count*8);for(let t=0;t<p.tiles.count;t++)flags[t*8]=1;device.queue.writeBuffer(bs[4],0,flags);
   for(let step=0;step<3;step++){
    expected=referenceRefinementStep(topology,expected);const e=device.createCommandEncoder();dispatch(e,'reset');dispatch(e,'admit',Math.ceil(p.tiles.count/64));dispatch(e,'clear_wake',Math.ceil(p.tiles.count/64));dispatch(e,'pack_dispatch');
    for(const name of ['limit_flux','gather_flux','commit_mass'])dispatch(e,name,p.tiles.count*8);device.queue.submit([e.finish()]);const actual=new Float32Array(await read(bs[0]));
    assert.ok(actual.every((value,i)=>Math.abs(value-expected[i])<1e-5),'dynamic owner map must preserve CPU/GPU conservative exchange parity');
   }
   device.queue.writeBuffer(bs[5],(map.state+4)*4,new Uint32Array([0]));{const e=device.createCommandEncoder();dispatch(e,'adaptive_recount',Math.ceil(p.pool.pages/64));device.queue.submit([e.finish()]);}
   state=new Uint32Array(await read(bs[5]));assert.equal(state[map.state+4],1,'restored resident maps need a fresh derived pressure count');
   console.log('GPU allocation, conservative prolongation, pinned history, overflow and reuse pass');
  }finally{for(const b of owned)b.destroy();}
 });
},{wgslSources:names.map(entryPoint=>({code,entryPoint,label:entryPoint}))});
