// kaminos-test: node
import assert from 'node:assert/strict';
import {createRefinementLayout,refinementIndex,refinementCell,referenceRefinementStep} from '../ash/refinement-plan.mjs';
import {adaptiveView} from '../ash/adaptive-plan.mjs';
import {refinementArena,refinementShader} from '../ash/refinement-shader.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U,GPUMapMode:M}=ctx;
 await withGpuErrorScopes(device,'saturated physical interface conservation',async()=>{
  for(const kind of ['coarse-middle','middle-finest','legacy'])for(const axis of [0,2])for(const mirror of [false,true]){
   const bounds={min:[0,0,0],max:kind==='coarse-middle'?[.32,.32,.32]:[.16,.16,.16]};bounds.max[axis]=kind==='coarse-middle'?.96:.48;
   const p=createRefinementLayout({cellSize:kind==='legacy'?.02:.04,bounds,refinement:{mode:'adaptive',ratio:2,fineCapacity:kind==='middle-finest'?2:1,...(kind==='legacy'?{}:{levels:3,detailCapacity:1})}});
   const a=refinementArena(p),r={map:Array(p.pool.pages).fill(0),slots:[(mirror?1:0)+1]};r.map[mirror?1:0]=1;
   if(p.detailPool)r.detail={map:Array(p.detailPool.pages).fill(0),slots:[0]};
   let source=[0,0,0],target=[0,0,0];
   if(kind==='coarse-middle'){source[axis]=mirror?12:16;target[axis]=mirror?16:14;}
   else if(kind==='legacy'){source[axis]=mirror?6:8;target[axis]=mirror?8:7;}
   else{
    r.map=Array.from({length:p.pool.pages},(_,i)=>i+1);r.slots=Array.from({length:p.pool.capacity},(_,i)=>i+1);
    const page=mirror?1:0;r.detail.map[page]=1;r.detail.slots[0]=page+1;
    source[axis]=mirror?6:8;target[axis]=mirror?8:7;
   }
   const view=adaptiveView(p,r),i=refinementIndex(view,source),j=refinementIndex(view,target),values=new Float32Array(p.count),solid=new Uint32Array(p.count).fill(1);
   values[i]=refinementCell(view,i).size**3*.99;values[j]=refinementCell(view,j).size**3*.99;solid[i]=solid[j]=0;
   const before=values.reduce((s,x)=>s+x,0),expected=referenceRefinementStep(view,values,{solid});
   const owned=[],make=(size,extra=0)=>{const b=device.createBuffer({size,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|extra});owned.push(b);return b;};
   try{
    a.words.set(r.map,p.adaptiveArena.map);a.words.set(r.slots,p.adaptiveArena.slots);if(r.detail){a.words.set(r.detail.map,p.adaptiveArena.detail.map);a.words.set(r.detail.slots,p.adaptiveArena.detail.slots);}
    const bs=[make(p.count*4),make(p.count*4),make(p.count*4),make(p.count*8),make(p.tiles.count*32),make(a.words.byteLength),make(p.faceWords*4),make(p.detailPool?144:64,U.UNIFORM)];
    device.queue.writeBuffer(bs[0],0,values);device.queue.writeBuffer(bs[2],0,solid);device.queue.writeBuffer(bs[5],0,a.words);const flags=new Uint32Array(p.tiles.count*8);for(let t=0;t<p.tiles.count;t++)flags[t*8]=1;device.queue.writeBuffer(bs[4],0,flags);
    const code=refinementShader(p,a),module=await ctx.compileShaderModule({code,label:'production saturated '+kind});
    const layout=device.createBindGroupLayout({entries:bs.map((_,binding)=>({binding,visibility:ctx.GPUShaderStage.COMPUTE,buffer:{type:binding===7?'uniform':binding===2?'read-only-storage':'storage'}}))}),pl=device.createPipelineLayout({bindGroupLayouts:[layout]}),group=device.createBindGroup({layout,entries:bs.map((buffer,binding)=>({binding,resource:{buffer}}))});
    const names=['reset','admit','clear_wake','pack_dispatch','limit_flux','gather_flux','commit_mass'],pipes=Object.fromEntries(await Promise.all(names.map(async entryPoint=>[entryPoint,await device.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})])));
    const e=device.createCommandEncoder();for(const n of names){const pass=e.beginComputePass();pass.setPipeline(pipes[n]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(['limit_flux','gather_flux','commit_mass'].includes(n)?p.tiles.count*8:['admit','clear_wake'].includes(n)?Math.ceil(p.tiles.count/64):1);pass.end();}
    const staging=device.createBuffer({size:p.count*4,usage:U.COPY_DST|U.MAP_READ});owned.push(staging);e.copyBufferToBuffer(bs[0],0,staging,0,staging.size);device.queue.submit([e.finish()]);await staging.mapAsync(M.READ);const actual=new Float32Array(staging.getMappedRange().slice(0));staging.unmap();
    const after=actual.reduce((s,x)=>s+x,0);console.log(JSON.stringify({kind,axis,mirror,before,after,delta:after-before}));
    assert.ok(Math.abs(after-before)<5e-5,`${kind}/${axis}/${mirror} saturated interface must conserve material, delta ${after-before}`);
    assert.ok(actual.every((v,k)=>Math.abs(v-expected[k])<2e-5),`${kind} endpoints must agree with the conservative interface oracle`);
   }finally{for(const b of owned)b.destroy();}
  }
 });
});
