// kaminos-test: node
import assert from 'node:assert/strict';
import {createRefinementLayout,refinementIndex,refinementCell,referenceRefinementStep} from '../ash/refinement-plan.mjs';
import {adaptiveView} from '../ash/adaptive-plan.mjs';
import {refinementArena,refinementShader} from '../ash/refinement-shader.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
const p=createRefinementLayout({cellSize:.04,bounds:{min:[0,0,0],max:[.64,.32,.64]},refinement:{ratio:2,mode:'adaptive',levels:3,fineCapacity:4,detailCapacity:1}}),a=refinementArena(p,{surfaceEncoding:'cell-masks'}),m=p.adaptiveArena,d=m.detail;
const primary=['adaptive_reset','adaptive_release','adaptive_count_direct','adaptive_reclaim_halo','adaptive_allocate_detail','adaptive_allocate_halo','adaptive_prolong'];
const extra=['detail_reset','detail_requests','detail_release','detail_max_priority','detail_count_priority','detail_reclaim_lower','detail_allocate_highest','detail_allocate_high','detail_allocate_medium','detail_allocate_low','detail_prolong','detail_collision_list','detail_collision_args'];
const names=[...primary,...extra,'reset','admit','clear_wake','pack_dispatch','limit_flux','gather_flux','commit_mass','admit_surface','build_surface','prefix_surface','finish_surface','draw_prefix'];
const code=refinementShader(p,a);
await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U,GPUMapMode:M}=ctx;
 await withGpuErrorScopes(device,'third-level physical ownership',async()=>{
  const owned=[];const make=(size,usage=0)=>{const b=device.createBuffer({size,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|usage});owned.push(b);return b;};
  try{
   const bs=[make(p.count*4),make(p.count*4),make(p.count*4),make(p.count*8),make(p.tiles.count*32),make(a.words.byteLength),make(a.surfaceCache.words*4),make(144,U.UNIFORM)];
   const layout=device.createBindGroupLayout({entries:bs.map((_,binding)=>({binding,visibility:ctx.GPUShaderStage.COMPUTE,buffer:{type:binding===7?'uniform':binding===2?'read-only-storage':'storage'}}))});
   const pl=device.createPipelineLayout({bindGroupLayouts:[layout]}),module=await ctx.compileShaderModule({code,label:'production third-level ash'});
   const pipelines=Object.fromEntries(await Promise.all(names.map(async entryPoint=>[entryPoint,await device.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})])));
   const group=device.createBindGroup({layout,entries:bs.map((buffer,binding)=>({binding,resource:{buffer}}))});
   const dispatch=(e,name,count=1)=>{const pass=e.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(count);pass.end();};
   const run=(list)=>{const e=device.createCommandEncoder();for(const name of list)dispatch(e,name,Math.ceil(Math.max(p.pool.pages,p.detailPool.pages,p.pool.capacity,p.detailPool.capacity)/64));device.queue.submit([e.finish()]);};
   const surfaces=()=>{const flags=new Uint32Array(p.tiles.count*8);for(let t=0;t<p.tiles.count;t++)flags[t*8+2]=1;device.queue.writeBuffer(bs[4],0,flags);const e=device.createCommandEncoder();for(const n of ['reset','admit_surface','pack_dispatch','build_surface','prefix_surface','finish_surface','draw_prefix'])dispatch(e,n,['build_surface','prefix_surface'].includes(n)?p.tiles.count*8:['admit_surface','finish_surface'].includes(n)?Math.ceil(p.tiles.count/64):1);device.queue.submit([e.finish()]);};
   const read=async b=>{const staging=device.createBuffer({size:b.size,usage:U.COPY_DST|U.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,staging,0,b.size);device.queue.submit([e.finish()]);await staging.mapAsync(M.READ);return staging.getMappedRange().slice(0);}finally{staging.unmap();staging.destroy();}};
   const params=new ArrayBuffer(144),ints=new Uint32Array(params),floats=new Float32Array(params);ints[13]=1;
   device.queue.writeBuffer(bs[5],0,a.words);device.queue.writeBuffer(bs[7],0,params);
   device.queue.writeBuffer(bs[5],m.demand*4,Uint32Array.from({length:p.pool.pages},()=>2));
   const initial=new Float32Array(p.count);initial[0]=44;device.queue.writeBuffer(bs[0],0,initial);run(primary);
   device.queue.writeBuffer(bs[5],d.demand*4,new Uint32Array([2]));run(extra);surfaces();
   let state=new Uint32Array(await read(bs[5])),values=new Float32Array(await read(bs[0]));
   const view=()=>adaptiveView(p,{map:Array.from(state.slice(m.map,m.slots)),slots:Array.from(state.slice(m.slots,m.demand)),detail:{map:Array.from(state.slice(d.map,d.slots)),slots:Array.from(state.slice(d.slots,d.demand))}});
   assert.equal(state[d.map],1);assert.equal(values.reduce((x,y)=>x+y,0),44,'both prolongations retain volume');
   assert.equal(values[refinementIndex(view(),[0,0,0])],1);assert.equal(values[refinementIndex(view(),[0,2,0])],.75,'physical column height survives two refinements');
   assert.equal(values[0],0);assert.equal(refinementCell(view(),refinementIndex(view(),[9,0,0])).size,2);
   // Collider demand moves. Occupied micro-history pins both its own slot and its middle balancing pages.
   device.queue.writeBuffer(bs[5],d.demand*4,new Uint32Array(p.detailPool.pages));device.queue.writeBuffer(bs[5],m.demand*4,new Uint32Array(p.pool.pages));run(primary);run(extra);
   state=new Uint32Array(await read(bs[5]));assert.equal(state[d.map],1);assert.ok(state[d.state+5]>0);view();
   // Frozen three-level ownership must obey the same conservative exchange.
   let seed=51;const topology=view();let expected=Float32Array.from({length:p.count},(_,i)=>{const c=refinementCell(topology,i);seed=(Math.imul(seed,1664525)+1013904223)>>>0;return c.owned?(seed/4294967296)*c.size**3*.8:0;});
   device.queue.writeBuffer(bs[0],0,expected);const flags=new Uint32Array(p.tiles.count*8);for(let t=0;t<p.tiles.count;t++)flags[t*8]=1;device.queue.writeBuffer(bs[4],0,flags);
   expected=referenceRefinementStep(topology,expected);const e=device.createCommandEncoder();dispatch(e,'reset');dispatch(e,'admit',Math.ceil(p.tiles.count/64));dispatch(e,'clear_wake',Math.ceil(p.tiles.count/64));dispatch(e,'pack_dispatch');for(const n of ['limit_flux','gather_flux','commit_mass'])dispatch(e,n,p.tiles.count*8);device.queue.submit([e.finish()]);
   values=new Float32Array(await read(bs[0]));assert.ok(values.every((v,i)=>Math.abs(v-expected[i])<2e-4),'three physical owner sizes must share conservative CPU/GPU exchange');
   assert.ok(Math.abs(values.reduce((s,x)=>s+x,0)-expected.reduce((s,x)=>s+x,0))<1e-3);
   // Empty finest history can yield; projection rejects a distant feature and admits it when its current footprint grows.
   device.queue.writeBuffer(bs[0],0,new Float32Array(p.count));surfaces();device.queue.writeBuffer(bs[5],d.demand*4,new Uint32Array(p.detailPool.pages));run(extra);
   state=new Uint32Array(await read(bs[5]));assert.equal(state[d.map],0);
   device.queue.writeBuffer(bs[5],d.demand*4,new Uint32Array([2]));floats.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],16);floats.set([100,100,3,1],32);ints[14]=1;device.queue.writeBuffer(bs[7],0,params);run(extra);
   state=new Uint32Array(await read(bs[5]));assert.equal(state[d.map],0,'subpixel middle cells should remain at middle resolution');
   floats[32]=1000;floats[33]=1000;device.queue.writeBuffer(bs[7],0,params);run(extra);state=new Uint32Array(await read(bs[5]));assert.equal(state[d.map],1,'projected detail above the threshold should allocate physical cells');
   ints[13]=0;ints[14]=0;device.queue.writeBuffer(bs[7],0,params);run(extra);state=new Uint32Array(await read(bs[5]));assert.equal(state[d.state+7],0,'unchanged view and geometry should sleep the detail scan');
   // Under pressure, a newly prominent feature replaces empty lower-priority detail.
   device.queue.writeBuffer(bs[5],0,a.words);device.queue.writeBuffer(bs[0],0,new Float32Array(p.count));device.queue.writeBuffer(bs[4],0,new Uint32Array(p.tiles.count*8));
   ints[13]=1;ints[14]=1;floats.set([.5,0,0,0,0,.5,0,0,0,0,0,1,0,0,0,.2],16);floats.set([360,360,3,1],32);device.queue.writeBuffer(bs[7],0,params);
   device.queue.writeBuffer(bs[5],m.demand*4,Uint32Array.from({length:p.pool.pages},()=>2));run(primary);
   const farPage=24,requests=new Uint32Array(p.detailPool.pages);requests[farPage]=2;device.queue.writeBuffer(bs[5],d.demand*4,requests);run(extra);surfaces();
   state=new Uint32Array(await read(bs[5]));assert.equal(state[d.map+farPage],1,'distant resolvable geometry can use spare detail');
   requests[0]=2;device.queue.writeBuffer(bs[5],d.demand*4,requests);run(extra);surfaces();state=new Uint32Array(await read(bs[5]));
   assert.equal(state[d.map],1,'nearer feature takes the empty slot under projection pressure');assert.equal(state[d.map+farPage],0);assert.equal(state[d.state+3],1);
   // A valid shader fault must fail the volume invariant, not merely compile.
   const faultCode=code.replace('mass[j]=clamp(volume*.25-f32(dy),0.0,1.0);','mass[j]=clamp(volume*.125-f32(dy),0.0,1.0);');
   const fm=await ctx.compileShaderModule({code:faultCode,label:'deliberate valid transfer fault'});pipelines.detail_prolong=await device.createComputePipelineAsync({layout:pl,compute:{module:fm,entryPoint:'detail_prolong'}});
   device.queue.writeBuffer(bs[5],0,a.words);device.queue.writeBuffer(bs[4],0,new Uint32Array(p.tiles.count*8));device.queue.writeBuffer(bs[0],0,initial);floats[35]=0;device.queue.writeBuffer(bs[7],0,params);device.queue.writeBuffer(bs[5],m.demand*4,Uint32Array.from({length:p.pool.pages},()=>2));run(primary);device.queue.writeBuffer(bs[5],d.demand*4,new Uint32Array([2]));run(extra);
   const wrong=new Float32Array(await read(bs[0])).reduce((sum,x)=>sum+x,0);assert.ok(Math.abs(wrong-44)>1,'conservation oracle rejects valid transfer fault');
   console.log('third-level production transfer, history, exchange, projection and sleeping pass');
  }finally{for(const b of owned)b.destroy();}
 });
},{wgslSources:names.map(entryPoint=>({code,entryPoint,label:entryPoint}))});
