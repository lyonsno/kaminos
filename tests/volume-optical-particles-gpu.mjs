// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
import {PARTICLE_STATE_WGSL} from '../volume-particle-state.mjs';
test('actual reactants burn stoichiometrically, release heat, make soot and freeze at zero simulation time',async()=>{
 await withKaminosGpu(async ctx=>{
  const rows=await evalWgslBatch(ctx,{preamble:PARTICLE_STATE_WGSL,argTypes:['f32','f32','f32'],returnType:'vec4<f32>',body:'return particleCompositionBurn(vec4<f32>(arg0,1,0,arg2),arg1,vec4<f32>(2,2,.15,.75),vec4<f32>(2,100,.5,1000)).state;',inputs:[[1,0,2],[1,1,2],[0,1,2],[1,1,0]]});
  assert.deepEqual(Array.from(rows[0]),[1,1,0,2]);
  assert.ok(rows[1][0]>0&&rows[1][0]<1,'reaction consumes carried fuel');
  assert.ok(rows[1][1]>1,'burning available reactants releases heat');assert.ok(Math.abs(rows[1][3]-2*rows[1][0])<1e-6,'oxygen consumption follows the declared stoichiometry');
  assert.ok(rows[1][2]>0,'reaction produces actual soot');
  assert.equal(rows[2][0],0);assert.ok(rows[2][1]<1,'spent material cools');
  assert.equal(rows[3][0],1,'fuel cannot burn without oxygen');assert.equal(rows[3][2],0);
 });
});

import {createOpticalParticles} from '../volume-optical-particles.mjs';
function actualGrid(d,{state=[1,1,.2,3],velocity=[0,0,0]}={}){
 const fine=d.createBuffer({size:8*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const reactants=d.createTexture({size:[2,2,2],dimension:'3d',format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 function upload(next=state){const material=new Float32Array(8*16),oxygen=new Float32Array(8*2);for(let i=0;i<8;i++){const s=typeof next==='function'?next([i%2,Math.floor(i/2)%2,Math.floor(i/4)].map(v=>v-.5)):next;material.set([...velocity,0],i*16);material.set([s[2],s[1],s[0],0],i*16+4);oxygen.set([s[3],.01],i*2);}d.queue.writeBuffer(fine,0,material);d.queue.writeTexture({texture:reactants},oxygen,{bytesPerRow:16,rowsPerImage:2},[2,2,2]);}
 upload();return {fine,reactants,upload,dispose(){fine.destroy();reactants.destroy();}};
}
test('production particle update transports actual fine flow, preserves paused state and renders supported material',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owner=createOpticalParticles(d),n=16;
  const births=d.createBuffer({size:n*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const sourceUniform=d.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const grid=actualGrid(d,{velocity:[.1,.2,.3]}),{fine,reactants}=grid;
  const rows=new Float32Array(n*16);rows.set([4,2,1,1,0,0,0,1,-.5,.5,1,1,4,2,1,0]);d.queue.writeBuffer(births,0,rows);
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];const sf=new Float32Array(60);sf.set(identity);sf.set([0,2,1,0],28);d.queue.writeBuffer(sourceUniform,0,sf);
  const target=d.createTexture({size:[4,4],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const depth=d.createTexture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
  const camera=new Float32Array(20);camera.set([1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,0,0,1,0]);
  const source={buffer:births,uniform:sourceUniform,width:4,height:4,pixels:n,step:0,backtrace:1,viewProj:identity};
  async function draw(step,settings={}){source.step=step;const e=d.createCommandEncoder();const dp=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}});dp.end();
   owner.encode(e,{view:target.createView(),format:'rgba8unorm',source,fine,reactants,dims:[2,2,2],invViewProj:identity,settings:{enabled:true,refresh:0,exchangeStrength:0,stateLife:0,...settings},cameraValues:camera,depth,identity:'fixture'});d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();return owner.sample();}
  try{
   const first=await draw(0);assert.equal(first.records[3],1);assert.equal(first.records[12],0);
   const moved=await draw(1);assert.ok(Math.abs(moved.records[0]-.1)<1e-5);assert.ok(Math.abs(moved.records[1]-.2)<1e-5);assert.ok(Math.abs(moved.records[2]-.3)<1e-5);assert.ok(moved.records[20]<1,'potential consumed');
   const paused=await draw(1,{refresh:1});assert.deepEqual(paused.records,moved.records,'paused material and flow do not evolve with presentation draws');
   const b=d.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:target},{buffer:b,bytesPerRow:256},[4,4]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(b.getMappedRange());assert.ok(pixels.some((x,i)=>i%4!==3&&x>8),'actual particle rendering contributes light');b.unmap();b.destroy();owner.reset();assert.equal((await owner.sample()).available,false,'reset invalidates old readback immediately');
  }finally{owner.dispose();births.destroy();sourceUniform.destroy();grid.dispose();target.destroy();depth.destroy();}
 });
});

import {createSplitIntegral,SPLIT_OPTICAL_WGSL} from '../volume-split-integral.mjs';
import {particleAcquisitionData} from '../volume-particle-acquisition.mjs';
test('native source-only producer retains intrinsic emission separately and clears uncovered pixels',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owner=createSplitIntegral(d),arenaLayout=d.createBindGroupLayout({entries:[{binding:39,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'storage'}}]});
  const code=`fn worldInsideFine(p:vec3<f32>)->bool{return true;}fn worldToCell(p:vec3<f32>)->vec3<f32>{return p;}fn sampleFluidSlot(p:vec3<f32>,slot:u32)->vec4<f32>{return vec4<f32>(0);}${SPLIT_OPTICAL_WGSL}
  @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);}
  @fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0)vec4<f32>{if(p.x>1){return vec4<f32>(0);}var r=splitInit(p.xy,vec3<f32>(0),vec3<f32>(0,0,1),0,2,.5);splitObserve(&r,0u,vec3<f32>(0,0,1),vec3<f32>(5,3,2),1,1,0,2,.25);splitIntrinsic(&r,0u,vec3<f32>(4,1,0));return splitFinish(r,splitAcquisitionIndex(p.xy,4u),vec3<f32>(0),vec3<f32>(0,0,1));}`;
  const module=d.createShaderModule({code});const pipeline=d.createRenderPipeline({layout:d.createPipelineLayout({bindGroupLayouts:[arenaLayout,owner.emptyLayout,owner.emptyLayout,owner.layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba32float'}]}});
  const target=d.createTexture({size:[2,2],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  const flow=d.createBuffer({size:128,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST|GPUBufferUsage.STORAGE}),expected=new Float32Array(32).fill(.125);d.queue.writeBuffer(flow,0,expected);
  const acquisition=particleAcquisitionData({settings:{acquisitionMode:1,filmJitter:0,sourceBias:0,fineCoverage:1,coarseCoverage:0},batch:{width:2,height:2,samples:4},phase:0,vp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],fine:{lo:[-1,-1,-1],hi:[1,1,1]}});
  try{const e=d.createCommandEncoder();const prepared=owner.prepare(e,{width:2,height:2,acquisition,world:{velocity:flow,plan:{flowDims:[2,2,2],min:[-1,-1,-1],flowPitch:1},map:[0,0,0,1]},settings:{mode:'transport',fresh:1},sourcesOnly:true,identity:'genuine-producer-fixture',step:4,viewProj:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],backtrace:1,fineScale:1,staggered:false});
   const p=e.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});p.setPipeline(pipeline);p.setBindGroup(0,d.createBindGroup({layout:arenaLayout,entries:[{binding:39,resource:{buffer:owner.buffer}}]}));p.setBindGroup(1,owner.emptyGroup);p.setBindGroup(2,owner.emptyGroup);p.setBindGroup(3,prepared.group);p.draw(3);p.end();d.queue.submit([e.finish()]);const sample=await owner.sample({includeFlow:true});
   assert.equal(sample.records.length,64);assert.deepEqual(Array.from(sample.records.slice(0,4)),[5,3,2,1]);assert.deepEqual(Array.from(sample.records.slice(12,15)),[4,1,0]);assert.equal(sample.records[11],.25);assert.ok(sample.records.slice(16,32).every(x=>x===0),'uncovered source rows are cleared');assert.equal(sample.records[32],5,'second row follows acquisition stride, not output stride');assert.deepEqual(sample.flow.actual,expected,'source raster must preserve adjacent flow snapshots');assert.deepEqual(sample.flow.expected,expected);assert.equal(sample.state.effective,'source-observations');
  }finally{owner.dispose();target.destroy();flow.destroy();}
 });
});

async function opticalFixture(d,run,view={}){
 const owner=createOpticalParticles(d,{transparent:view.transparent??true,indexedQuads:view.indexedQuads??true,fusedResolve:view.fusedResolve??true}),n=16,identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const births=d.createBuffer({size:n*64+128,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const uniform=d.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const grid=actualGrid(d,{state:view.state,velocity:view.velocity}),{fine,reactants}=grid;
 const sf=new Float32Array(60);sf.set(identity);sf.set([0,2,1,0],28);if(view.sourceUniform)sf.set(view.sourceUniform);d.queue.writeBuffer(uniform,0,sf);
 const target=d.createTexture({size:[4,4],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});const depth=d.createTexture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
 const camera=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,0,0,1,0]);const source={buffer:births,uniform,width:4,height:4,pixels:n,step:0,backtrace:view.backtrace??0,reactionStepScale:view.stepScale??1,viewProj:view.vp??identity};
 const seed=rows=>{d.queue.writeBuffer(births,0,rows);owner.reset();};
 const draw=async(step=0,settings={})=>{source.step=step;const e=d.createCommandEncoder();const dp=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:view.depth??1,depthStoreOp:'store'}});dp.end();const measured=view.trace||view.passTrace?new Proxy(e,{get(target,key){if(key==='beginRenderPass')return desc=>{view.passTrace?.push(desc.label);const pass=target.beginRenderPass(desc);return desc.label==='spatial material support'?new Proxy(pass,{get(p,k){const value=p[k];return typeof value==='function'?function(...args){if(k==='draw'||k==='drawIndexed')view.trace?.push({method:k,args});return value.apply(p,args);}:value;}}):pass;};const value=target[key];return typeof value==='function'?value.bind(target):value;}}):e;owner.encode(measured,{view:target.createView(),format:'rgba8unorm',source,fine,reactants,dims:[2,2,2],invViewProj:view.inverse??identity,depthZeroToOne:view.depthZeroToOne??false,settings:{enabled:true,refresh:0,exchangeStrength:0,stateLife:0,...settings},cameraValues:camera,depth,identity:'fixture',gridExtinction:view.gridExtinction,allowUnavailableGridExtinction:view.allowUnavailableGridExtinction});const read=d.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[4,4]);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(read.getMappedRange().slice(0));read.unmap();read.destroy();return pixels;};
 try{await run({owner,seed,draw,setMaterial:grid.upload,setFreshSamples:n=>{source.samples=n;},upload:rows=>d.queue.writeBuffer(births,0,rows)});}finally{owner.dispose();births.destroy();uniform.destroy();grid.dispose();target.destroy();depth.destroy();}
}
test('optically negligible carriers cannot dilute an overlapping live carrier',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,1,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);const alone=await draw();
  rows.set([0,0,0,1e-12,0,0,0,1,-.5,.5,1,1,0,0,0,0],16);seed(rows);const together=await draw();
  for(let y=0;y<4;y++)for(let x=0;x<16;x++)assert.ok(Math.abs(together[256*y+x]-alone[256*y+x])<=1,'near-empty optical state must not erase existing light or extinction');
 },{state:[1,1,0,3]}));
});
test('reaction creates soot extinction from actual fuel and oxygen when the initial grid has no soot',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);await draw();const initial=(await owner.sample()).records[20];
  const result=await draw(100,{burnTime:1,cooling:1,heatRelease:0,sootYield:1,smokeLife:10000});const s=await owner.sample();assert.ok(Math.abs(s.records[22]-(initial-s.records[20])*Math.exp(-.01))<1e-5,'soot matches consumed actual fuel and retirement');assert.ok(s.records[22]>.5,'available reactants produce substantial smoke');assert.ok(s.records[21]<1e-10,'material has cooled');
  let alpha=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++)alpha=Math.max(alpha,result[256*y+4*x+3]);assert.ok(alpha>10,'new soot must remain visible as extinction after light ends');
 },{state:[1,1,0,3]}));
});

import {PerspectiveCamera,Matrix4,WebGPUCoordinateSystem} from '../lib/three.core.js';
function cameraView(camera){camera.updateProjectionMatrix();camera.updateMatrixWorld();const vp=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);return {vp:vp.toArray(),inverse:vp.clone().invert().toArray(),depthZeroToOne:true};}
test('native WebGPU perspective depth stays in zero-to-one clip space',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const camera=new PerspectiveCamera(45,1,.5,10);camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.z=1;const view=cameraView(camera);
  for(const [z,depth,visible] of [[-.5,.8,true],[-.5,.6,false],[.75,1,false]])await opticalFixture(d,async({seed,draw})=>{
   const rows=new Float32Array(16*16);rows.set([4,2,1,1,0,0,z,1,-.5,.5,1,1,4,2,1,0]);seed(rows);const result=await draw();let alpha=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++)alpha=Math.max(alpha,result[256*y+4*x+3]);assert.equal(alpha>0,visible,JSON.stringify({z,depth,alpha}));
  },{...view,depth});
 });
});

test('initial optical emission does not seed chemistry or limit soot from actual reactants',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const states=[];
  for(const light of [1e-12,4]){const rows=new Float32Array(16*16);rows.set([light,light,light,0,0,0,0,1,-.5,.5,1,1,light,light,light,0]);seed(rows);await draw();const born=await owner.sample();assert.equal(born.records[20],1);await draw(100,{burnTime:1,cooling:1,heatRelease:0,sootYield:1,smokeLife:10000});states.push((await owner.sample()).records.slice(20,24));}
  assert.deepEqual(states[0],states[1],'equal actual reactants evolve equally despite different source light');assert.ok(states[0][2]>.5,'faint optical source still carries real fuel and oxygen');
 },{state:[1,1,0,3]}));
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
test('explicit retained capacity uses a rotating pool instead of duplicating source pixels',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);for(let i=0;i<16;i++)rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0],16*i);seed(rows);
  await draw(0,{capacity:37,acquisitionMode:1,refresh:1});const first=await owner.sample();assert.equal(first.state.slots,37,'capacity is independent of source dimensions');assert.equal(first.records.filter((x,i)=>i%24===3&&x>0).length,16,'one birth per fresh observation, not one duplicate per retained slot');
  await draw(1,{capacity:37,acquisitionMode:1,refresh:1});assert.equal((await owner.sample()).records.filter((x,i)=>i%24===3&&x>0).length,32,'new observations fill distinct retained slots');
 }));
});
test('soot yield changes actual production and total extinction gain changes its held visibility',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);await draw(0);await draw(8,{sootYield:0});assert.equal((await owner.sample()).records[22],0);
  seed(rows);await draw(0);await draw(8,{sootYield:2});const born=await owner.sample();assert.ok(born.records[22]>0);
  const hidden=await draw(8,{gain:0,scatteredGain:0,opacity:0});const visible=await draw(8,{gain:0,scatteredGain:0,opacity:20});assert.notDeepEqual(visible,hidden,'total soot visibility responds without another sim step');assert.deepEqual((await owner.sample()).records,born.records);
  assert.deepEqual(await draw(8,{gain:0,scatteredGain:0,opacity:20,carriedSmokeGain:0,generatedSmokeGain:0}),visible,'legacy split gains cannot override actual total soot');
 },{state:[1,1,0,3]}));
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
test('particles-only source batch clears the old display when both display toggles are off',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);await draw(0,{acquisitionMode:1,capacity:16});const hidden=await draw(0,{acquisitionMode:1,capacity:16,showParticles:false,showRaymarch:false});
  for(let y=0;y<4;y++)for(let x=0;x<16;x++)assert.equal(hidden[256*y+x],0,'turning display off must not leave the preceding particle image');
 }));
});

test('indexed particle quads use the native index route with exactly the expanded route pixels',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const images=[],calls=[[],[]];
  for(const indexedQuads of [false,true])await opticalFixture(d,async({seed,draw})=>{
   const rows=new Float32Array(16*16);rows.set([.1,.2,.3,.4,-.2,0,0,1,-.25,.25,.5,.5,.1,.1,.1,0]);rows.set([.2,.1,.05,.2,.3,.25,-.1,1,-.25,.25,.5,.5,.05,.02,.01,0],16);seed(rows);images.push(await draw(0,{gain:.2,opacity:.5,radius:.3,stretch:1.5}));
  },{indexedQuads,trace:calls[Number(indexedQuads)]});
  assert.ok(images[0].some(x=>x>0),'the geometry comparison must contain visible material');
  assert.deepEqual(images[1],images[0],'indexing must preserve the exact production rendered pixels');
  assert.ok(calls[0].some(x=>x.method==='draw'&&x.args[0]===6),'expanded comparison must execute its actual native route');
  assert.ok(calls[1].some(x=>x.method==='drawIndexed'&&x.args[0]===6),'requested indexed geometry must not silently fall back to six repeated vertices');
 });
});


test('same-size particle presentation transfers optics directly with exact resolved pixels',async()=>{
 await withKaminosGpu(async({device:d})=>{
  for(const targetScale of [1,.5,2]){
   const images=[],passes=[[],[]];
   for(const fusedResolve of [false,true])await opticalFixture(d,async({seed,draw})=>{
    const rows=new Float32Array(16*16);rows.set([.1,.2,.3,.4,-.2,0,0,1,-.25,.25,.5,.5,.1,.1,.1,0]);rows.set([.2,.1,.05,.2,.3,.25,-.1,1,-.25,.25,.5,.5,.05,.02,.01,0],16);seed(rows);images.push(await draw(0,{gain:.2,opacity:.5,radius:.3,stretch:1.5,targetScale}));
   },{fusedResolve,passTrace:passes[Number(fusedResolve)]});
   assert.ok(images[0].some(x=>x>0));assert.deepEqual(images[1],images[0],'direct transfer must preserve the resolved image');
   assert.ok(passes[0].includes('material optical moment transfer'),'comparison must execute the original transfer pass');
   assert.equal(passes[1].includes('material optical moment transfer'),targetScale!==1,'only equal-size output may omit the separate transfer pass');
  }
 });
});

test('depth field suppresses a rear flame through foreground smoke without sorting particles',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const camera=new PerspectiveCamera(45,1,.1,20);camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.z=1.5;const view=cameraView(camera);
  await opticalFixture(d,async({seed,draw,owner,setMaterial})=>{
   const rows=new Float32Array(16*16),pixels=p=>{let sum=0;for(let y=1;y<3;y++)for(let x=1;x<3;x++)sum+=p[y*256+x*4];return sum;};
   const config={depthMode:1,depthSlices:8,depthScale:1,radius:.8,stretch:1.1,pixelFloor:0};
   setMaterial(p=>p[2]>0?[0,0,4,0]:[1,1,0,3]);rows.set([1,.4,.1,0,0,0,-.5,1,-.5,.5,1,2,1,.4,.1,0]);rows.set([0,0,0,0,0,0,.5,1,-.5,.5,1,1,0,0,0,0],16);seed(rows);
   const behind=await draw(0,config),held=(await owner.sample()).records;
   const more=await draw(0,{...config,depthSlices:16});assert.deepEqual((await owner.sample()).records,held,'changing slices preserves retained material');
   assert.ok(pixels(more)<=pixels(behind)+4,'separated layers remain occluded at higher depth resolution');
   setMaterial(p=>p[2]<0?[0,0,4,0]:[1,1,0,3]);rows.set([1,.4,.1,0,0,0,.5,1,-.5,.5,1,1,1,.4,.1,0]);rows.set([0,0,0,0,0,0,-.5,1,-.5,.5,1,2,0,0,0,0],16);seed(rows);
   const inFront=await draw(0,config);const mixedOne=await draw(0,{...config,depthSlices:1});const fractionalFront=await draw(0,{...config,depthSlices:1,depthMode:2});assert.ok(pixels(fractionalFront)>pixels(mixedOne),'fractional source depth differs from uniform mixing inside a slice');assert.ok(pixels(inFront)>0,`front light is visible: ${pixels(inFront)}, behind ${pixels(behind)}`);
   assert.ok(pixels(behind)<pixels(inFront)*.4,`foreground smoke must attenuate rear light: ${pixels(behind)} vs ${pixels(inFront)}`);
   const swapped=rows.slice();swapped.set(rows.slice(16,32));swapped.set(rows.slice(0,16),16);seed(swapped);assert.deepEqual(await draw(0,config),inFront,'particle order does not change depth visibility');
   const resized=await draw(0,{...config,depthScale:.5,targetScale:.5});assert.ok(resized.some(x=>x>0),'different visibility and draw resolutions produce real output');assert.equal((await owner.sample()).state.depthField.width,1);
  },view);
 });
});
test('captured light can be removed while inherited extinction and retained material persist',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({seed,draw,owner})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,3,0,0,0,1,-.5,.5,1,1,0,0,0,0]);seed(rows);
  const lit=await draw(),records=(await owner.sample()).records;
  const dark=await draw(0,{scatteredGain:0});assert.deepEqual((await owner.sample()).records,records);
  const old=await draw(8,{refresh:0,smokeLife:1000,scatteredLife:1});assert.deepEqual((await owner.sample()).records.slice(4,8),records.slice(4,8),'light lifetime does not alter captured extinction');assert.notDeepEqual(old,lit,'short light lifetime quenches old illumination');
  let light=0,opacity=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++){light+=dark[y*256+x*4];opacity=Math.max(opacity,dark[y*256+x*4+3]);}
  assert.equal(light,0,'captured illumination is independent of intrinsic emission');assert.ok(opacity>50,'removing illumination must keep inherited smoke');assert.notDeepEqual(lit,dark);
 }));
});
test('equal horizontal and vertical particle radii produce a visible round footprint',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([4,2,1,1,0,0,0,1,-.5,.5,1,1,4,2,1,0]);seed(rows);const image=await draw(0,{stretch:1});
  assert.ok(image.some((x,i)=>i%4!==3&&x>0),'isotropic covariance must not generate invalid vertex coordinates');
 }));
});
test('fractional depth preserves an isolated carrier self transfer when harmless range anchors change',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const camera=new PerspectiveCamera(45,1,.1,20);camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.z=1;const view=cameraView(camera);
  await opticalFixture(d,async({seed,draw})=>{
   const rows=new Float32Array(16*16);rows.set([.1,.05,.01,0,0,0,.5,1,-.5,.5,1,1,.1,.05,.01,0]);seed(rows);const settings={depthMode:2,depthSlices:7,depthScale:1,radius:.6};const alone=await draw(0,settings);assert.ok(alone.some((v,i)=>i%4===0&&v>0),'isolated source is actually visible');
   rows.set([0,0,0,0,0,0,-.5,1,-.5,.5,1,1,0,0,0,0],16);seed(rows);const range=await draw(0,settings);
   for(let y=0;y<4;y++)for(let x=0;x<16;x++)assert.ok(Math.abs(alone[y*256+x]-range[y*256+x])<=1,'a negligible far source cannot change isolated self attenuation');
  },{...view,state:p=>p[2]>0?[1,1,2,3]:[0,0,5e-7,0]});
 });
});
test('subpixel smoke survives coarse visibility deposition instead of vanishing between atlas samples',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const camera=new PerspectiveCamera(45,1,.1,20);camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.z=1.5;const view=cameraView(camera);
  await opticalFixture(d,async({seed,draw})=>{
   const rows=new Float32Array(16*16),settings={depthMode:1,depthSlices:8,depthScale:.25,radius:.001,stretch:1,pixelFloor:.5};
   rows.set([4,2,1,0,-.6,0,-.5,1,-.5,.5,1,1,4,2,1,0]);seed(rows);const alone=await draw(0,settings);
   rows.set([0,0,0,0,-.3,0,.5,1,-.5,.5,1,1,0,0,0,0],16);seed(rows);const smoke=await draw(0,settings);
   let a=0,b=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++){a+=alone[y*256+x*4];b+=smoke[y*256+x*4];}assert.ok(a>0);assert.ok(b<a*.9,`coarse smoke must attenuate: ${b} vs ${a}`);
  },{...view,state:p=>p[2]>0?[0,0,100,0]:[1,1,0,3]});
 });
});
test('actual composition is independent of represented optical length and legacy proxy seed settings',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const states=[];
  for(const coupling of [0,1])for(const length of [.25,1]){
   const rows=new Float32Array(16*16);rows.set([.2,.1,.05,.3,0,0,0,1,0,length,1,.25,.2,.1,.05,0]);seed(rows);
   await draw(0,{reactionSupportCoupling:coupling,reactionSeedLength:.5});const r=(await owner.sample()).records;
   assert.equal(r[19],length,'represented optical length retains its independent value');states.push(r.slice(20,24));
  }
  for(const state of states)assert.deepEqual(state,states[0],'material comes from the grid, not optical support or legacy reserve knobs');assert.equal(states[0][0],1);
 }));
});
test('a carrier exiting the single grid retires while stationary in-domain material survives',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw,upload})=>{
  const rows=new Float32Array(16*16);rows.set([1,.5,.1,.3,.9,0,0,1,0,.25,1,.25,1,.5,.1,0]);seed(rows);await draw();upload(new Float32Array(16*16));await draw(1);
  assert.equal((await owner.sample()).records[3],0,'a boundary crossing must remove the optical carrier');
 },{velocity:[.5,0,0],backtrace:1}));
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw,upload})=>{
  const rows=new Float32Array(16*16);rows.set([1,.5,.1,.3,0,0,0,1,0,.25,1,.25,1,.5,.1,0]);seed(rows);await draw();upload(new Float32Array(16*16));await draw(1);
  assert.ok((await owner.sample()).records[3]>0,'zero velocity is valid inside the domain');
 },{backtrace:1}));
});

test('compact renewal readback distinguishes real observations, placed births, replacements and expiry',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw,upload})=>{
  const rows=new Float32Array(16*16);rows.set([0,0,0,2,0,0,0,1,0,.25,1,.25,0,0,0,0]);seed(rows);
  const cfg={acquisitionMode:1,capacity:1,refresh:1,renewalDiagnostics:true,maxAge:2};await draw(0,cfg);
  assert.equal(typeof owner.statistics,'function','the actual GPU population supplies a compact readout');
  const first=await owner.statistics();assert.equal(first.active,1);assert.equal(first.evaluated,1);assert.equal(first.valid,1);assert.equal(first.placed,1);assert.equal(first.overwritten,0);assert.equal(first.extinctive,1);
  await draw(1,cfg);const next=await owner.statistics();assert.equal(next.placed,1);assert.equal(next.overwritten,1);assert.equal(next.active,1);
  upload(new Float32Array(16*16));await draw(4,{...cfg,refresh:0});const last=await owner.statistics();assert.equal(last.active,0);assert.equal(last.placed,0);assert.equal(last.expired,1);assert.equal(last.valid,0);assert.equal(last.overwriteUpdates,null);
 }));
});
async function withExtinctionFixture(d,run,options={}){
 const grid=d.createTexture({size:[4,4,4],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const voxels=new Float32Array(4*4*4*4);for(let i=0;i<64;i++)voxels[4*i+3]=options.sigma??4;
 d.queue.writeTexture({texture:grid},voxels,{bytesPerRow:64,rowsPerImage:4},[4,4,4]);
 const field={status:'encoded',texture:grid,frame:0,expectedFrame:0,generation:1,coefficientLengthSpace:'volume-local',dimensions:[4,4,4],localMin:[-1,-1,-1],localMax:[1,1,1]};
 const camera=new PerspectiveCamera(45,1,.1,20);camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.z=4;camera.updateProjectionMatrix();camera.updateMatrixWorld();const vp=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 try{await opticalFixture(d,x=>run({...x,field}),{vp:vp.toArray(),inverse:vp.clone().invert().toArray(),depthZeroToOne:true,transparent:options.transparent??false,gridExtinction:field,allowUnavailableGridExtinction:options.allowUnavailableGridExtinction});}finally{grid.destroy();}
}
const centerLight=image=>image[256+4]+image[256+8]+image[512+4]+image[512+8];
test('independent grid extinction hides a rear particle without changing retained state and off remains exact',async()=>{
 await withKaminosGpu(async({device:d})=>withExtinctionFixture(d,async({seed,draw,owner})=>{
  const rows=new Float32Array(16*16);rows.set([1,.4,.1,.1,0,0,-.5,1,0,.25,1,.3,1,.4,.1,0]);seed(rows);
  const cfg={depthMode:1,depthSlices:8,depthScale:1,radius:1,pixelFloor:0};const plain=await draw(0,cfg),records=(await owner.sample()).records;
  const guarded=await draw(0,{...cfg,fillExtinction:1});assert.ok(centerLight(guarded)<centerLight(plain)*.6,'foreground grid opacity must attenuate actual rendered source light');assert.deepEqual((await owner.sample()).records,records,'visibility controls preserve the medium');
  const suppressed=await draw(0,{...cfg,extinctionView:2});assert.ok(centerLight(suppressed)>0,'suppressed-light view exposes the consequential missing opacity');
  assert.deepEqual(await draw(0,{...cfg,fillExtinction:0}),plain,'turning assist off restores exact baseline pixels');
 }));
});
test('zero independent extinction cannot add opacity already represented by particles',async()=>{
 await withKaminosGpu(async({device:d})=>withExtinctionFixture(d,async({seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([.2,.1,.05,2,0,0,0,1,0,.25,1,.3,.2,.1,.05,0]);seed(rows);const cfg={depthMode:2,depthSlices:8,depthScale:1,radius:1};
  const baseline=await draw(0,cfg);assert.deepEqual(await draw(0,{...cfg,fillExtinction:1}),baseline,'a zero deficit preserves the complete original transfer');
 },{sigma:0}));
});
test('grid extinction contributes background opacity even when no particles cover it',async()=>{
 await withKaminosGpu(async({device:d})=>withExtinctionFixture(d,async({seed,draw})=>{
  seed(new Float32Array(16*16));const p=await draw(0,{depthMode:1,depthSlices:8,depthScale:1,fillExtinction:1});assert.ok(p[256+4+3]>150,'terminal transmission includes independent smoke without a particle footprint');
 },{transparent:true}));
});
test('stale independent extinction is refused before changing retained state',async()=>{
 await withKaminosGpu(async({device:d})=>withExtinctionFixture(d,async({seed,draw,owner,field})=>{
  const rows=new Float32Array(16*16);rows.set([1,.4,.1,0,0,0,0,1,0,.25,1,.3,1,.4,.1,0]);seed(rows);const cfg={depthMode:1,depthSlices:8,depthScale:1};await draw(0,cfg);const old=(await owner.sample()).records;field.expectedFrame=1;
  await assert.rejects(()=>draw(0,{...cfg,fillExtinction:1}),/extinction.*(stale|current)|current.*extinction/i);assert.deepEqual((await owner.sample()).records,old);
 }));
});


test('paused renewal readouts preserve the last population update and its tracking provenance',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([0,0,0,2,0,0,0,1,0,.25,1,.25,0,0,0,0]);seed(rows);
  const cfg={acquisitionMode:1,capacity:1,refresh:1,renewalDiagnostics:true};await draw(0,cfg);await draw(1,cfg);const next=await owner.statistics();assert.equal(next.overwritten,1);
  await draw(1,{...cfg,fillExtinction:0});const paused=await owner.statistics();assert.equal(paused.overwritten,1,'presentation redraw cannot erase actual replacement');assert.equal(paused.placed,1);assert.equal(paused.reactionDelta,1);assert.deepEqual(paused.renewal,next.renewal);assert.ok(paused.identity.frame>paused.renewal.frame,'readout and renewal clocks remain distinguishable');
  await draw(2,{...cfg,renewalDiagnostics:false});await draw(2,cfg);const untracked=await owner.statistics();assert.equal(untracked.overwritten,null,'enabling diagnostics on pause cannot invent past counters');assert.equal(untracked.renewal.tracked,false);
 }));
});
test('unavailable grid assist can explicitly suspend at a live host without changing the original transfer',async()=>{
 await withKaminosGpu(async({device:d})=>withExtinctionFixture(d,async({seed,draw,owner,field})=>{
  const rows=new Float32Array(16*16);rows.set([1,.4,.1,.1,0,0,-.5,1,0,.25,1,.3,1,.4,.1,0]);seed(rows);const cfg={depthMode:1,depthSlices:8,depthScale:1};const plain=await draw(0,cfg),records=(await owner.sample()).records;
  for(const unavailable of [{expectedFrame:1},{exterior:{}},{texture:null}]){
   const old={...field};Object.assign(field,unavailable);assert.deepEqual(await draw(0,{...cfg,fillExtinction:1}),plain,'unsupported assist uses the exact unassisted transfer');const state=owner.read();assert.equal(state.gridAssist.requested,true);assert.equal(state.gridAssist.effective,'unavailable');assert.ok(state.gridAssist.reason);assert.equal(state.gridAssist.effectiveStrength,0);assert.deepEqual((await owner.sample()).records,records);Object.assign(field,old);
  }
 },{allowUnavailableGridExtinction:true}));
});

test('paused rendering cannot advance the next rotating birth slot',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([0,0,0,2,0,0,0,1,0,.25,1,.25,0,0,0,0]);seed(rows);const cfg={acquisitionMode:1,capacity:5,refresh:1,renewalDiagnostics:true};await draw(0,cfg);await draw(1,cfg);await draw(1,cfg);await draw(2,cfg);assert.ok((await owner.sample()).records[2*24+3]>0,'the third actual birth belongs to slot2 despite a paused redraw');
 }));
});

test('paused lifetime edits defer retirement and preserve renewal provenance until the next update',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{
  const rows=new Float32Array(16*16);rows.set([0,0,0,2,0,0,0,1,0,.25,1,.25,0,0,0,0]);seed(rows);const cfg={acquisitionMode:1,capacity:5,refresh:0,renewalDiagnostics:true};await draw(0,cfg);await draw(2,cfg);const before=(await owner.sample()).records,stats=await owner.statistics();await draw(2,{...cfg,maxAge:1});assert.deepEqual((await owner.sample()).records,before,'paused lifetime edits cannot retire material outside a population update');assert.deepEqual((await owner.statistics()).renewal,stats.renewal);assert.equal((await owner.statistics()).expired,stats.expired);await draw(3,{...cfg,maxAge:1});const after=await owner.statistics();assert.equal(after.active,0);assert.equal(after.expired,1);assert.equal(after.renewal.step,3);
 }));
});

test('birth-only source-focused updates clear renewal counters even with carrier advance disabled',async()=>withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw})=>{const rows=new Float32Array(16*16);for(let i=0;i<16;i++)rows.set([4,2,1,0,0,0,0,1,-.5,.5,1,1,4,2,1,0],16*i);seed(rows);const settings={acquisitionMode:1,capacity:4,refresh:1,updateEnabled:false,birthsEnabled:true};await draw(0,settings);const a=await owner.statistics();await draw(1,settings);const b=await owner.statistics();assert.equal(a.accepted,16);assert.equal(b.accepted,16,'birth count describes this draw rather than accumulating across held updates');assert.equal(b.placed,4);})));


test('skipped acquisition steps retain and render live source-focused material between birth batches',async()=>{
 await withKaminosGpu(async({device:d})=>opticalFixture(d,async({owner,seed,draw,setFreshSamples})=>{
  const rows=new Float32Array(16*16);for(let i=0;i<16;i++)rows.set([4,2,1,.2,0,0,0,1,-.5,.5,1,1,4,2,1,0],16*i);seed(rows);
  const cfg={acquisitionMode:1,capacity:4,refresh:1,flow:0,stateLife:1,lifeFuel:24,lifeHeat:24,lifeSmoke:48,lifeQuiet:6,renewalDiagnostics:true};
  setFreshSamples(16);await draw(0,cfg);const born=await owner.sample();assert.equal((await owner.statistics()).active,4);
  setFreshSamples(0);
  for(let step=1;step<=8;step++){
   const image=await draw(step,cfg),sample=await owner.sample(),stats=await owner.statistics();
   assert.equal(sample.state.reset,false,'a zero fresh budget must not replace the retained pool');assert.equal(stats.active,4,'supported material must survive skipped acquisition steps');assert.equal(stats.placed,0,'skipped acquisition must not secretly birth observations');
   for(let i=0;i<4;i++)assert.ok(sample.records[24*i+3]>born.records[24*i+3],'age advances on the same retained carrier');
   let alpha=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++)alpha+=image[y*256+x*4+3];assert.ok(alpha>0,'retained extinction must remain drawn without a fresh source batch');
  }
 }));
});
