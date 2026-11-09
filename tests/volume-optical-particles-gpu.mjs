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
   const paused=await draw(1,{refresh:1});assert.deepEqual(paused.records,moved.records,'paused material and flow do not evolve with presentation draws');
   const b=d.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:target},{buffer:b,bytesPerRow:256},[4,4]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(b.getMappedRange());assert.ok(pixels.some((x,i)=>i%4!==3&&x>8),'actual particle rendering contributes light');b.unmap();b.destroy();owner.reset();assert.equal((await owner.sample()).available,false,'reset invalidates old readback immediately');
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

async function opticalFixture(d,run,view={}){
 const owner=createOpticalParticles(d,{transparent:true}),n=16,identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const births=d.createBuffer({size:n*64+128,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const uniform=d.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const fine=d.createBuffer({size:8*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 if(view.velocity){const v=new Float32Array(8*16);for(let i=0;i<8;i++)v.set(view.velocity,i*16);d.queue.writeBuffer(fine,0,v);}
 const sf=new Float32Array(60);sf.set(identity);sf.set([0,2,1,0],28);if(view.sourceUniform)sf.set(view.sourceUniform);d.queue.writeBuffer(uniform,0,sf);
 const target=d.createTexture({size:[4,4],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});const depth=d.createTexture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
 const camera=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,0,0,1,0]);const source={buffer:births,uniform,width:4,height:4,pixels:n,step:0,backtrace:view.backtrace??0,reactionStepScale:view.stepScale??1,viewProj:view.vp??identity};
 const seed=rows=>{d.queue.writeBuffer(births,0,rows);owner.reset();};
 const draw=async(step=0,settings={})=>{source.step=step;const e=d.createCommandEncoder();const dp=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:view.depth??1,depthStoreOp:'store'}});dp.end();owner.encode(e,{view:target.createView(),format:'rgba8unorm',source,fine,dims:[2,2,2],invViewProj:view.inverse??identity,depthZeroToOne:view.depthZeroToOne??false,settings:{enabled:true,refresh:0,...settings},cameraValues:camera,depth,identity:'fixture'});const read=d.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[4,4]);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(read.getMappedRange().slice(0));read.unmap();read.destroy();return pixels;};
 try{await run({owner,seed,draw,upload:rows=>d.queue.writeBuffer(births,0,rows)});}finally{owner.dispose();births.destroy();uniform.destroy();fine.destroy();target.destroy();depth.destroy();}
}
test('optically negligible carriers cannot dilute an overlapping live carrier',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,1,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);const alone=await draw();
  rows.set([0,0,0,1e-12,0,0,0,1,-.5,.5,1,1,0,0,0,0],16);seed(rows);const together=await draw();
  for(let y=0;y<4;y++)for(let x=0;x<16;x++)assert.ok(Math.abs(together[256*y+x]-alone[256*y+x])<=1,'near-empty optical state must not erase existing light or extinction');
 }));
});
test('reaction creates smoke extinction even when its source had no initial smoke',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);await draw();const initial=(await owner.sample()).records[20];
  const result=await draw(100,{burnTime:1,cooling:1,heatRelease:0,sootYield:1,smokeLife:10000});const s=await owner.sample();assert.ok(Math.abs(s.records[22]-(initial-s.records[20])*Math.exp(-.01))<1e-5,'soot matches consumed finite potential and survival');assert.ok(s.records[22]>.5,'a strong source produces substantial smoke');assert.ok(s.records[21]<1e-10,'emission has cooled');
  let alpha=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++)alpha=Math.max(alpha,result[256*y+4*x+3]);assert.ok(alpha>10,'new soot must remain visible as extinction after light ends');
 }));
});

import {PerspectiveCamera,WebGPUCoordinateSystem} from '../lib/three.core.js';
test('native WebGPU perspective depth stays in zero-to-one clip space',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const camera=new PerspectiveCamera(45,1,1,10);camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();
  const vp=camera.projectionMatrix.toArray(),inverse=camera.projectionMatrixInverse.toArray();
  for(const [z,depth,visible] of [[-2,.7,true],[-2,.5,false],[-.75,1,false]])await opticalFixture(d,async({seed,draw})=>{
   const rows=new Float32Array(16*16);rows.set([4,2,1,1,0,0,z,1,-.5,.5,1,1,4,2,1,0]);seed(rows);const result=await draw();let alpha=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++)alpha=Math.max(alpha,result[256*y+4*x+3]);assert.equal(alpha>0,visible,JSON.stringify({z,depth,alpha}));
  },{vp,inverse,depthZeroToOne:true,depth});
 });
});

test('arbitrarily faint intrinsic emission cannot manufacture a full soot parcel',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([1e-12,1e-12,1e-12,0,0,0,0,1,-.5,.5,1,1,1e-12,1e-12,1e-12,0]);seed(rows);await draw();await draw(100,{burnTime:1,cooling:1,heatRelease:0,sootYield:1,smokeLife:10000});
  const sample=await owner.sample();assert.ok(sample.records[22]<1e-8,`faint source minted soot ${sample.records[22]}`);
 }));
});
test('explicit particle spacing reduces the retained allocation, independently from source image dimensions',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);for(let i=0;i<16;i++)rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0],16*i);seed(rows);await draw(0,{spacing:2});const sample=await owner.sample();
  assert.equal(sample.records.length,4*24);assert.equal(sample.state.slots,4);assert.equal(sample.state.width,4);
 }));
});
test('maximum age retires an unrefreshed observation instead of carrying its state forever',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw,upload})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);await draw(0,{maxAge:2});upload(new Float32Array(16*16));await draw(3,{maxAge:2});assert.equal((await owner.sample()).records[3],0);
 }));
});
test('particle reaction follows the simulation reference-time scale rather than render-step count',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw,upload})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);await draw();upload(new Float32Array(16*16));await draw(1,{heatRelease:0,cooling:10});const sample=await owner.sample();assert.ok(Math.abs(sample.records[21]-Math.exp(-.1/10))<1e-5);assert.ok(Math.abs(sample.records[3]-1.1)<1e-5);
 },{stepScale:.1}));
});
test('a carrier outside every velocity field does not extrapolate clamped boundary flow',async()=>{
 const sf=new Float32Array(60);sf.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);sf.set([0,2,1,0],28);sf.set([0,0,0,1],32);sf.set([2,2,2,1],36);sf.set([0,0,0,1],40);new Uint32Array(sf.buffer).set([0,0,64,0],56);
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw,upload})=>{
  const rows=new Float32Array(16*16+32);rows.set([4,2,1,0,4,0,0,1,-.5,.5,1,1,4,2,1,0]);for(let i=0;i<8;i++)rows.set([1,0,0,0],256+i*4);seed(rows);await draw();rows.fill(0,0,256);upload(rows);await draw(1);assert.equal((await owner.sample()).records[0],4);
 },{sourceUniform:sf,backtrace:1}));
});
test('population dimensions and optical target scale are independent from source pixels',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);for(let i=0;i<16;i++)rows.set([4,2,1,1,0,0,0,1,-.5,.5,1,1,4,2,1,0],i*16);seed(rows);
  await draw(0,{populationWidth:2,populationHeight:3,targetScale:.5});const a=await owner.sample();assert.equal(a.state.slots,6,'explicit2x3pool must allocate6records');assert.equal(a.records.length,6*24);assert.deepEqual(a.state.targetSize,[2,2]);
  const records=a.records;await draw(0,{populationWidth:2,populationHeight:3,targetScale:1});assert.deepEqual((await owner.sample()).records,records,'paused target-size edit preserves population');
 }));
});
test('smoke yield changes production, and generated-smoke gain changes existing soot while paused',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);await draw(0);await draw(8,{sootYield:0});assert.equal((await owner.sample()).records[22],0);
  seed(rows);await draw(0);await draw(8,{sootYield:2});const born=await owner.sample();assert.ok(born.records[22]>0);
  const hidden=await draw(8,{gain:0,carriedSmokeGain:0,generatedSmokeGain:0});const visible=await draw(8,{gain:0,carriedSmokeGain:0,generatedSmokeGain:20});assert.notDeepEqual(visible,hidden,'existing soot visibility must respond without another sim step');assert.deepEqual((await owner.sample()).records,born.records);
 }));
});

import {PARTICLE_PROJECTION_WGSL} from '../volume-optical-particles.mjs';
test('production support projection uses the local perspective footprint at near and far distances',async()=>{
 const c=new PerspectiveCamera(45,1,.1,100);const matrix=c.projectionMatrix.elements;const k=matrix[0]*32;
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{preamble:PARTICLE_PROJECTION_WGSL,argTypes:['f32','f32'],returnType:'vec3<f32>',body:`let vp=mat4x4<f32>(${matrix.join(',')});return particleProjectedCovariance(vp,vec3<f32>(arg0,0,arg1),vec3<f32>(.2),vec3<f32>(0,1,0),vec2<f32>(64));`,inputs:[[.5,-2],[1,-4]]});
  for(let i=0;i<2;i++){const d=i===0?2:4;const expected=k*k*.04/(d*d)*(1+.25*.25);assert.ok(Math.abs(result[i][0]-expected)<.001,`projected variance ${result[i][0]} differs from local footprint ${expected}`);}
 });
});
test('optional flow orientation reuses advection without changing particle trajectory or reaction',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,1,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);await draw(0);await draw(1,{flowAlignment:0});const a=(await owner.sample()).records;
  seed(rows);await draw(0);await draw(1,{flowAlignment:1});const b=(await owner.sample()).records;
  for(let i=0;i<a.length;i++)if(i%24!==17&&i%24!==18)assert.equal(b[i],a[i]);
  assert.ok(Math.abs(b[17]-1/6)<1e-6&&Math.abs(b[18]-1/3)<1e-6,'stored direction comes from actual nonzero grid velocity');
 },{velocity:[.1,.2,.3]}));
});
import {SPLIT_FINE_PROPOSAL_WGSL} from '../volume-split-integral.mjs';
test('Fine acquisition proposes within the actual intersected interval while keeping the original zero-bias depth',async()=>{
 await withKaminosGpu(async ctx=>{
  const rows=await evalWgslBatch(ctx,{preamble:SPLIT_FINE_PROPOSAL_WGSL,argTypes:['f32','f32'],returnType:'f32',body:'return splitFineProposal(8,vec2<f32>(2,4),vec2<f32>(0,10),arg0,arg1,.25);',inputs:[[0,0],[1,.5],[.25,.5],[.75,.5]]});
  assert.deepEqual(rows.map(x=>Number(x)),[8,2.5,8,2.5]);
 });
});
