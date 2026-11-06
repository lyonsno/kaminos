// kaminos-test: node
import assert from 'node:assert/strict';
import {createRefinementLayout,refinementCell} from '../ash/refinement-plan.mjs';
import {adaptiveView} from '../ash/adaptive-plan.mjs';
import {refinementArena,refinementShader} from '../ash/refinement-shader.mjs';
import {refinementVertexWGSL} from '../ash/refinement-surface.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';

const inputs=[
 {cellSize:1,bounds:{min:[0,0,0],max:[12,8,8]},tileSize:4,refinement:{ratio:2,regions:[{min:[2,0,2],max:[6,8,6]}]}},
 {cellSize:.1,bounds:{min:[0,0,0],max:[2.4,.8,.8]},refinement:{ratio:2,mode:'adaptive',fineCapacity:2}},
];
await withKaminosGpu(async ctx=>{
 const {device,GPUBufferUsage:U,GPUMapMode:M}=ctx;
 await withGpuErrorScopes(device,'compact ash physical surface parity',async()=>{
  async function run(p,encoding,values,solid,residency,{fault=false,empty=false}={}){
   const a=refinementArena(p,{surfaceEncoding:encoding}),owned=[];
   const make=(size,extra=0)=>{const b=device.createBuffer({size,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST|extra});owned.push(b);return b;};
   const read=async b=>{const r=device.createBuffer({size:b.size,usage:U.COPY_DST|U.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,b.size);device.queue.submit([e.finish()]);await r.mapAsync(M.READ);return r.getMappedRange().slice(0);}finally{r.unmap();r.destroy();}};
   try{
    const bs=[make(p.count*4),make(p.count*4),make(p.count*4),make(p.count*8),make(p.tiles.count*32),make(a.words.byteLength),make(a.surfaceCache.words*4),make(64,U.UNIFORM)];
    if(residency){a.words.set(residency.map,p.adaptiveArena.map);a.words.set(residency.slots,p.adaptiveArena.slots);}
    device.queue.writeBuffer(bs[0],0,values);device.queue.writeBuffer(bs[2],0,solid);device.queue.writeBuffer(bs[5],0,a.words);
    const flags=new Uint32Array(p.tiles.count*8);for(let t=0;t<p.tiles.count;t++)flags[t*8+2]=1;device.queue.writeBuffer(bs[4],0,flags);
    let code=refinementShader(p,a);
    if(fault)code=code.replace('mask|=1u<<(face*4u+sub);','mask|=1u<<(face*4u+sub+1u);');
    const module=await ctx.compileShaderModule({code,label:'production '+encoding+' cache'});
    const layout=device.createBindGroupLayout({entries:bs.map((_,binding)=>({binding,visibility:ctx.GPUShaderStage.COMPUTE,buffer:{type:binding===7?'uniform':binding===2?'read-only-storage':'storage'}}))});
    const pl=device.createPipelineLayout({bindGroupLayouts:[layout]});
    const names=['reset','admit_surface','pack_dispatch','build_surface',...(encoding==='cell-masks'?['prefix_surface']:[]),'finish_surface','draw_prefix'];
    const pipes=Object.fromEntries(await Promise.all(names.map(async entryPoint=>[entryPoint,await device.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})])));
    const group=device.createBindGroup({layout,entries:bs.map((buffer,binding)=>({binding,resource:{buffer}}))});
    const build=()=>{const e=device.createCommandEncoder();for(const name of names){const pass=e.beginComputePass();pass.setPipeline(pipes[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(['build_surface','prefix_surface'].includes(name)?p.tiles.count*p.tiles.groupsPerTile:['reset','pack_dispatch','draw_prefix'].includes(name)?1:Math.ceil(p.tiles.count/64));pass.end();}device.queue.submit([e.finish()]);};
    build();let state=new Uint32Array(await read(bs[5]));assert.equal(state[a.stats+5],0);const count=state[a.stats+4];assert.ok(count>0);
    const vertexCode=refinementVertexWGSL(p,a)+`
@group(0) @binding(0) var<storage,read> mass:array<f32>;
@group(0) @binding(1) var<storage,read> solid:array<u32>;
@group(0) @binding(2) var<storage,read> faces:array<u32>;
@group(0) @binding(3) var<storage,read> arena:array<u32>;
@group(0) @binding(4) var<storage,read_write> result:array<vec4<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let rank=id.x;if(rank>=${count}u){return;}
 result[rank*5u]=vec4<f32>(vec2<f32>(ash_refined_face_code(rank,&faces,&arena)),0.0,0.0);
 for(var n=0u;n<4u;n++){let uv=vec2<f32>(f32(n&1u),f32(n>>1u));result[rank*5u+1u+n]=ash_refined_vertex(rank,uv,1.0,&mass,&solid,&faces,&arena);}
}`;
    const vm=await ctx.compileShaderModule({code:vertexCode,label:'production '+encoding+' surface decoding'}),vp=await device.createComputePipelineAsync({layout:'auto',compute:{module:vm,entryPoint:'main'}}),output=make(count*80);
    const vg=device.createBindGroup({layout:vp.getBindGroupLayout(0),entries:[bs[0],bs[2],bs[6],bs[5],output].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const e=device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(vp);pass.setBindGroup(0,vg);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();device.queue.submit([e.finish()]);
    const raw=new Float32Array(await read(output));const rows=Array.from({length:count},(_,i)=>Array.from(raw.subarray(i*20,(i+1)*20))).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    if(empty){device.queue.writeBuffer(bs[0],0,new Float32Array(p.count));device.queue.writeBuffer(bs[4],0,flags);build();state=new Uint32Array(await read(bs[5]));assert.equal(state[a.stats+4],0,'dirty rebuild must remove every old face when material is cleared');}
    return rows;
   }finally{for(const b of owned)b.destroy();}
  }
  for(const input of inputs){
   const p=createRefinementLayout(input);let residency=null;
   if(p.adaptive){residency={map:Array(p.pool.pages).fill(0),slots:[1,p.pool.pages]};residency.map[0]=1;residency.map[p.pool.pages-1]=2;}
   const view=residency?adaptiveView(p,residency):p;
   const mass=Float32Array.from({length:p.count},(_,i)=>{const c=refinementCell(view,i);return !c.owned||((i*17+3)%7===0)?0:c.size**3*(.15+((i*23)%11)/15);});
   const solid=Uint32Array.from({length:p.count},(_,i)=>i%19===0?2:0);for(let i=0;i<p.count;i++)if(solid[i])mass[i]=0;
   const records=await run(p,'face-records',mass,solid,residency),masks=await run(p,'cell-masks',mass,solid,residency,{empty:true});
   assert.deepEqual(masks,records,'compact decoding must preserve every face, physical corner, normal and edge-coverage value');
   const broken=await run(p,'cell-masks',mass,solid,residency,{fault:true});assert.notDeepEqual(broken,records,'valid WGSL face-bit fault must be exposed by physical output parity');
   console.log(`${p.adaptive?'adaptive':'fixed'} compact cache preserves ${records.length} physical faces and their four corners`);
  }
 });
});
