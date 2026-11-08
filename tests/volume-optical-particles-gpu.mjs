// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
import {PARTICLE_REACTION_WGSL} from '../volume-optical-particles.mjs';
test('reactive carriers consume finite potential, release heat, make soot and freeze at zero simulation time',async()=>{
 await withKaminosGpu(async ctx=>{
  const rows=await evalWgslBatch(ctx,{preamble:PARTICLE_REACTION_WGSL,argTypes:['f32','f32'],returnType:'vec4<f32>',body:'return particleReact(vec4<f32>(arg0,1,0,0),arg1,2,100,2,.5);',inputs:[[1,0],[1,1],[0,1]]});
  assert.deepEqual(Array.from(rows[0]),[1,1,0,0]);
  assert.ok(rows[1][0]>0&&rows[1][0]<1,'reaction consumes remaining potential');
  assert.ok(rows[1][1]>1,'finite reaction can brighten instead of only fading');
  assert.ok(rows[1][2]>0,'reaction produces smoke');
  assert.equal(rows[2][0],0);assert.ok(rows[2][1]<1,'spent material cools');
 });
});

import {createOpticalParticles} from '../volume-optical-particles.mjs';
test('production particle update transports actual fine flow, preserves paused state and renders supported material',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owner=createOpticalParticles(d),n=16;
  const births=d.createBuffer({size:n*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const sourceUniform=d.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const fine=d.createBuffer({size:8*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const rows=new Float32Array(n*16);rows.set([4,2,1,1,0,0,0,1,-.5,.5,1,1,4,2,1,0]);d.queue.writeBuffer(births,0,rows);
  const fluid=new Float32Array(8*16);for(let i=0;i<8;i++)fluid.set([.1,.2,.3,0],i*16);d.queue.writeBuffer(fine,0,fluid);
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];const sf=new Float32Array(60);sf.set(identity);sf.set([0,2,1,0],28);d.queue.writeBuffer(sourceUniform,0,sf);
  const target=d.createTexture({size:[4,4],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const depth=d.createTexture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
  const camera=new Float32Array(20);camera.set([1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,0,0,1,0]);
  const source={buffer:births,uniform:sourceUniform,width:4,height:4,pixels:n,step:0,backtrace:1,viewProj:identity};
  async function draw(step,settings={}){source.step=step;const e=d.createCommandEncoder();const dp=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}});dp.end();
   owner.encode(e,{view:target.createView(),format:'rgba8unorm',source,fine,dims:[2,2,2],invViewProj:identity,settings:{enabled:true,refresh:0,...settings},cameraValues:camera,depth,identity:'fixture'});d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();return owner.sample();}
  try{
   const first=await draw(0);assert.equal(first.records[3],1);assert.equal(first.records[12],0);
   const moved=await draw(1);assert.ok(Math.abs(moved.records[0]-.1)<1e-5);assert.ok(Math.abs(moved.records[1]-.2)<1e-5);assert.ok(Math.abs(moved.records[2]-.3)<1e-5);assert.ok(moved.records[20]<1,'potential consumed');
   const paused=await draw(1);assert.deepEqual(paused.records,moved.records,'paused material and flow do not evolve with presentation draws');
   const b=d.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:target},{buffer:b,bytesPerRow:256},[4,4]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(b.getMappedRange());assert.ok(pixels.some((x,i)=>i%4!==3&&x>8),'actual particle rendering contributes light');b.unmap();b.destroy();
  }finally{owner.dispose();births.destroy();sourceUniform.destroy();fine.destroy();target.destroy();depth.destroy();}
 });
});

import {createSplitIntegral,SPLIT_OPTICAL_WGSL} from '../volume-split-integral.mjs';
test('native source-only producer retains intrinsic emission separately and clears uncovered pixels',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owner=createSplitIntegral(d),arenaLayout=d.createBindGroupLayout({entries:[{binding:39,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'storage'}}]});
  const code=`fn worldInsideFine(p:vec3<f32>)->bool{return true;}fn worldToCell(p:vec3<f32>)->vec3<f32>{return p;}fn sampleFluidSlot(p:vec3<f32>,slot:u32)->vec4<f32>{return vec4<f32>(0);}${SPLIT_OPTICAL_WGSL}
  @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);}
  @fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0)vec4<f32>{if(p.x>1){return vec4<f32>(0);}var r=splitInit(p.xy,vec3<f32>(0),vec3<f32>(0,0,1),0,2,.5);splitObserve(&r,0u,vec3<f32>(0,0,1),vec3<f32>(5,3,2),1,1,0,2,.25);splitIntrinsic(&r,0u,vec3<f32>(4,1,0));return splitFinish(r,u32(p.x),vec3<f32>(0),vec3<f32>(0,0,1));}`;
  const module=d.createShaderModule({code});const pipeline=d.createRenderPipeline({layout:d.createPipelineLayout({bindGroupLayouts:[arenaLayout,owner.emptyLayout,owner.emptyLayout,owner.layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba32float'}]}});
  const target=d.createTexture({size:[2,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  try{const e=d.createCommandEncoder();const prepared=owner.prepare(e,{width:2,height:1,settings:{mode:'transport',fresh:1},sourcesOnly:true,identity:'genuine-producer-fixture',step:4,viewProj:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],backtrace:1,fineScale:1,staggered:false});
   const p=e.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});p.setPipeline(pipeline);p.setBindGroup(0,d.createBindGroup({layout:arenaLayout,entries:[{binding:39,resource:{buffer:owner.buffer}}]}));p.setBindGroup(1,owner.emptyGroup);p.setBindGroup(2,owner.emptyGroup);p.setBindGroup(3,prepared.group);p.draw(3);p.end();d.queue.submit([e.finish()]);const sample=await owner.sample();
   assert.equal(sample.records.length,32);assert.deepEqual(Array.from(sample.records.slice(0,4)),[5,3,2,1]);assert.deepEqual(Array.from(sample.records.slice(12,15)),[4,1,0]);assert.equal(sample.records[11],.25);assert.ok(sample.records.slice(16).every(x=>x===0),'uncovered source rows are cleared');assert.equal(sample.state.effective,'source-observations');
  }finally{owner.dispose();target.destroy();}
 });
});
