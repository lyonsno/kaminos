// Small native conformance check; no benchmark or visual-acceptance claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const [out,repo]=process.argv.slice(2);
assert.ok(out&&repo,'output and explicit checkout required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:repo,errors:[]};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let browser,server;
try{
 await save();report.sourceStatus=execFileSync('git',['status','--short'],{cwd:repo,encoding:'utf8'});
 await fs.writeFile(path.join(out,'source.patch'),execFileSync('git',['diff','HEAD'],{cwd:repo}));
 report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
 report.executable=process.env.CHROME_EXECUTABLE;
 assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'),'independent test browser required');
 report.phase='server-bind';await save();server=http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Exterior GPU conformance</title>');return;}
  const file=path.resolve(repo,'.'+name);if(!file.startsWith(path.resolve(repo)+'/'))throw Error('outside checkout');
  res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 report.phase='native-gather';await save();
 report.signal=await page.evaluate(async()=>{
  const {createVolumeGather}=await import('/scene-volume-gather.mjs');
  const {createExteriorSmokeLight}=await import('/scene-exterior-light.mjs');
  const {buildTriangleVisibility}=await import('/scene-light-visibility.mjs');
  const {COMPOSED_SMOKE_WGSL,createDistributedSmokeBindings}=await import('/scene-smoke-reconstruction.mjs');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw Error('native adapter required');
  const identity={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,fallback:adapter.isFallbackAdapter};
  if(/swiftshader/i.test(JSON.stringify(identity)))throw Error('software fallback refused');
  const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  device.pushErrorScope('validation');
  const geometry=buildTriangleVisibility([]).packGpu(),dimensions=[4,8,4],bounds={lo:[-3,-3,-3],hi:[3,9,3]};
  const texture=device.createTexture({dimension:'3d',size:dimensions,format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const medium=device.createTexture({dimension:'3d',size:dimensions,format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const middle=device.createTexture({dimension:'3d',size:dimensions,format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const fine=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,sourceDimensions:dimensions,directions:4,smokeRefinement:1,angularPattern:'source'});
  const coarse=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,sourceDimensions:dimensions,directions:4,smokeRefinement:1,angularPattern:'source',receiverBounds:bounds,exteriorMedium:true});
  const source={texture,dimensions,status:'encoded',generation:1,frame:1,exterior:{texture:medium,dimensions,status:'encoded',generation:1,frame:1,localMin:bounds.lo,localMax:bounds.hi}};
  const rows=[];
  try{
   for(const [name,emission,sigma,middleSigma] of [['clear',1,0],['doubled',2,0],['attenuated',2,1],['dark',0,0],['middle-only',2,0,1],['same-medium',2,1,1],['removed-middle',2,0]]){
    const data=new Float32Array(4*8*4*4);for(let i=0;i<data.length;i+=4)data.set([emission,emission,emission,0],i);
    device.queue.writeTexture({texture},data,{bytesPerRow:64,rowsPerImage:8},dimensions);
    device.queue.writeTexture({texture:medium},new Float32Array(4*8*4).fill(sigma),{bytesPerRow:16,rowsPerImage:8},dimensions);
    source.exterior.middle=middleSigma===undefined?null:{texture:middle,dimensions,status:'encoded',generation:1,frame:1,localMin:bounds.lo,localMax:bounds.hi};
    if(middleSigma!==undefined)device.queue.writeTexture({texture:middle},new Float32Array(4*8*4).fill(middleSigma),{bytesPerRow:16,rowsPerImage:8},dimensions);
    fine.encode(source);coarse.encode(source);
    const f=await fine.readback(),c=await coarse.readback();
    rows.push({name,fine:Array.from(f.smoke.data),coarse:Array.from(c.smoke.data)});
   }
   const layout={lo:[-1.5,-1,-2],hi:[1.5,5,2],pitch:.5};
   const regional=createExteriorSmokeLight(device,{grid:2,refinement:1,receiverCoverage:layout});
   let independent;
   try{
    const frame=regional.encode(source,{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
    const again=regional.encode(source,{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
    independent={requested:layout,effective:frame.middle.smokeReconstruction.coarseDimensions,bounds:[frame.middle.smokeReconstruction.localMin,frame.middle.smokeReconstruction.localMax],builds:[frame.builds,again.builds],generation:frame.middle.generation};
    independent.low=[];
    for(const fineReceiverGrid of [1,2]){
     const low=regional.encode(source,{geometry,revision:1,worldGeometry:false,directions:4,gain:1,fineReceiverGrid});
     independent.low.push({grid:fineReceiverGrid,active:low.middle.activeVolumeReceivers,allocated:low.middle.allocatedVolumeReceivers});
    }
   }finally{regional.destroy();}
   const overlapOptions={geometry,receivers:[],volumeGrid:16,sourceDimensions:dimensions,directions:4,smokeRefinement:1,angularPattern:'source',receiverBounds:{lo:[-2,-2,-2],hi:[2,6,2]}};
   const baseline=createVolumeGather(device,overlapOptions);
   const clipped=createVolumeGather(device,{...overlapOptions,receiverExclusion:{lo:[-1,-1,-1],hi:[1,3,1],blendWidth:.125}});
   let overlap;
   try{baseline.encode(source);const frame=clipped.encode(source);overlap={active:frame.activeVolumeReceivers,allocated:frame.allocatedVolumeReceivers,full:Array.from((await baseline.readback()).smoke.data),clipped:Array.from((await clipped.readback()).smoke.data)};}
   finally{baseline.destroy();clipped.destroy();}
   const {createSceneVolumeSource,SCENE_VOLUME_SOURCE_WGSL}=await import('/scene-volume-source.mjs');
   const {WORLD_SMOKE_OPTICS_WGSL}=await import('/volume-world-smoke-optics.mjs');
   const {WORLD_RENDER_WGSL}=await import('/volume-world-render.mjs');
   // Controlled coefficients; the production seed and shared camera blend are
   // compiled unchanged. This tests composition, not the combustion law.
   const definitions=`
    const GRID:u32=4u;const GRID_Y:u32=8u;const SCENE_SOURCE_GRID:u32=4u;const SCENE_SOURCE_GRID_Y:u32=8u;
    struct EmissiveMaterial {emission:vec3<f32>,absorption:f32,scattering:f32}
    struct FlowReconstructionSample {material:vec4<f32>,freshBurn:f32}
    struct U {emissive_physics:vec4<f32>,viewport_steps_density:vec4<f32>,emissive_material:vec4<f32>,physical_fire:vec4<f32>,open_world_boundary:vec4<f32>}
    @group(0) @binding(0) var<uniform> u:U;
    @group(0) @binding(1) var<storage,read> fluid:array<vec4<f32>>;
    @group(0) @binding(7) var<storage,read> front:array<vec4<f32>>;
    @group(0) @binding(23) var reactant:texture_3d<f32>;
    fn seatGridShape(){}
    fn thermalRadiance(k:f32)->vec3<f32>{return vec3<f32>(k);}
    fn physicsSootKelvin(a:f32,b:f32)->f32{return a+b;}
    fn emissiveMaterial(r:FlowReconstructionSample,f:f32,s:f32)->EmissiveMaterial{return EmissiveMaterial(vec3<f32>(r.material.y)*f,r.material.x*.75*s,r.material.x*.25*s);}
    fn fastEmissiveMaterialAt(p:vec3<f32>,v:f32)->EmissiveMaterial{return sceneEmissiveMaterialAt(p);}
    fn sceneEmissiveMaterialAt(p:vec3<f32>)->EmissiveMaterial{
     let v=fluid[0].x+front[0].x+textureLoad(reactant,vec3<i32>(0),0).x;
     return EmissiveMaterial(vec3<f32>(10.0+v+p.x*0.0),1.0,2.0);
    }`;
   const seedModule=device.createShaderModule({code:definitions+WORLD_SMOKE_OPTICS_WGSL+WORLD_RENDER_WGSL+SCENE_VOLUME_SOURCE_WGSL+COMPOSED_SMOKE_WGSL});
   const seedCompilation=await seedModule.getCompilationInfo();
   if(seedCompilation.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(seedCompilation.messages.map(m=>({message:m.message,line:m.lineNum,type:m.type}))));
   const uniform=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   const worldUniform=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   const fluid=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE});
   const reactant=device.createTexture({dimension:'3d',size:[1,1,1],format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING});
   const raw=device.createTexture({dimension:'3d',size:[4,8,8],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const rawData=new Float32Array(4*8*8*4);for(let i=0;i<4*8*4;i++)rawData.set([9,20,0,0],i*4);
   device.queue.writeTexture({texture:raw},rawData,{bytesPerRow:64,rowsPerImage:8},[4,8,8]);
   device.queue.writeBuffer(worldUniform,0,new Float32Array([-3,-3,-3,1.5,3,9,3,1,...Array(12).fill(0)]));
   const resident=device.createTexture({dimension:'3d',size:[219,2,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const atlas=new Float32Array(219*2*4);
   for(let slot=0;slot<2;slot++){
    atlas.set([0,slot*4,0,1],slot*219*4);
    for(let i=0;i<216;i++)atlas.set([30,30,30,12],(slot*219+3+i)*4);
   }
   device.queue.writeTexture({texture:resident},atlas,{bytesPerRow:219*16,rowsPerImage:2},[219,2,1]);
   let world={texture:raw,dimensions:[4,8,4],localMin:[-3,-3,-3],localMax:[3,9,3]};
   const producer=createSceneVolumeSource({device,module:seedModule,uniformBuffer:uniform,fluidBuffers:[fluid],frontBuffers:[fluid],getReactantTextures:()=>[reactant],grid:4,gridY:8,getWorldSmoke:()=>world,worldRenderUniform:worldUniform});
   let seed;
   try{
    const encode=async()=>{const e=device.createCommandEncoder();producer.encode(e,0,1);device.queue.submit([e.finish()]);const result=await producer.readback();const region=producer.describe().exterior;
     if(region){const dims=region.dimensions,row=Math.ceil(dims[0]*16/256)*256,buffer=device.createBuffer({size:row*dims[1]*dims[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyTextureToBuffer({texture:region.emissionTexture},{buffer,bytesPerRow:row,rowsPerImage:dims[1]},dims);device.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);const data=new Float32Array(buffer.getMappedRange()),values=[];for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)values.push(...data.slice((z*dims[1]+y)*row/4,(z*dims[1]+y)*row/4+dims[0]*4));result.exterior={dimensions:dims,values,exteriorEmission:region.exteriorEmission};}finally{buffer.destroy();}}
     return result;};
    seed=await encode();
    world.handoffMargin=.36;seed.rounded=await encode();
    delete world.handoffMargin;seed.restored=await encode();
    world.handoffMargin=0;seed.zero=await encode();
    world.renderView=resident.createView();device.queue.writeBuffer(worldUniform,80,new Float32Array([1,4,8,4]));
    seed.resident=await encode();
    device.queue.writeBuffer(uniform,64,new Float32Array([0,1,0,0]));seed.smokeOnly=await encode();
    device.queue.writeBuffer(uniform,64,new Float32Array([0,0,1,0]));seed.fast=await encode();
    device.queue.writeBuffer(uniform,64,new Float32Array(4));
    world=null;device.queue.writeBuffer(worldUniform,0,new Float32Array(8));
    seed.off=await encode();
   }finally{producer.destroy();uniform.destroy();worldUniform.destroy();fluid.destroy();raw.destroy();reactant.destroy();resident.destroy();}
   // Exercise the actual composed fragment lookup and binding owner at the
   // bottom join using constant incident fields and production clear masks.
   const fFrame=fine.encode(source),cFrame=coarse.encode(source);
   const constant=(r,value)=>{
    const texture=device.createTexture({dimension:'3d',size:r.dimensions,format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const data=new Float32Array(r.dimensions.reduce((a,b)=>a*b,4));for(let i=0;i<data.length;i+=4)data.set([value,value,value,1],i);
    device.queue.writeTexture({texture},data,{bytesPerRow:r.dimensions[0]*16,rowsPerImage:r.dimensions[1]},r.dimensions);return texture;
   };
   const fineConstant=constant(fFrame.smokeReconstruction,10),coarseConstant=constant(cFrame.smokeReconstruction,20);
   const binding=createDistributedSmokeBindings(device);
   const query=device.createBuffer({size:64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
   device.queue.writeBuffer(query,0,new Float32Array([0,-1.001,0,0,0,-1,0,0,0,-.999,0,0,0,-.95,0,0]));
   const queryLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]});
   const queryGroup=device.createBindGroup({layout:queryLayout,entries:[{binding:0,resource:{buffer:query}}]});
   const target=device.createTexture({size:[4,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const read=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   let bottom;
   try{
    const group=binding.update({...source,smokeReconstruction:{...fFrame.smokeReconstruction,texture:fineConstant},exterior:{...cFrame,texture:coarse.smoke,handoffMargin:.36,smokeReconstruction:{...cFrame.smokeReconstruction,texture:coarseConstant}}});
    const module=device.createShaderModule({code:COMPOSED_SMOKE_WGSL+`
     @group(0) @binding(0) var<storage,read> queries:array<vec4<f32>>;
     @vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{let x=f32((i<<1u)&2u);let y=f32(i&2u);return vec4<f32>(x*2.0-1.0,y*2.0-1.0,0,1);}
     @fragment fn fragment(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{return vec4<f32>(distributedMeanIncident(queries[u32(p.x)].xyz),1);}`});
    const layout=device.createPipelineLayout({bindGroupLayouts:[queryLayout,device.createBindGroupLayout({entries:[]}),binding.layout]});
    const pipeline=device.createRenderPipeline({layout,vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragment',targets:[{format:'rgba32float'}]}});
    const e=device.createCommandEncoder();const pass=e.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
    pass.setPipeline(pipeline);pass.setBindGroup(0,queryGroup);pass.setBindGroup(2,group);pass.draw(3);pass.end();
    e.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[4,1]);device.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);bottom=Array.from(new Float32Array(read.getMappedRange()).slice(0,16));
   }finally{binding.destroy();fineConstant.destroy();coarseConstant.destroy();query.destroy();target.destroy();read.destroy();}
   const module=device.createShaderModule({code:COMPOSED_SMOKE_WGSL});
   const compilation=await module.getCompilationInfo();
   const validation=await device.popErrorScope();
   return {identity,rows,independent,overlap,seed,bottom,errors,validation:validation?.message??null,compilation:compilation.messages.map(m=>({type:m.type,message:m.message,line:m.lineNum}))};
  }finally{fine.destroy();coarse.destroy();texture.destroy();medium.destroy();middle.destroy();device.destroy();}
 });await save();
 assert.equal(report.signal.validation,null);assert.deepEqual(report.signal.errors,[]);assert.deepEqual(report.errors,[]);
 assert.ok(!report.signal.compilation.some(m=>m.type==='error'),JSON.stringify(report.signal.compilation));
 for(const low of report.signal.independent.low)assert.equal(low.active,low.allocated,'empty low-grid core retains every receiver');
 assert.deepEqual(report.signal.independent.effective,[6,12,8]);
 assert.deepEqual(report.signal.independent.builds,[2,2]);
 assert.deepEqual(report.signal.independent.bounds,[[-1.5,-1,-2],[1.5,5,2]]);
 assert.equal(report.signal.independent.generation,1);
 const overlap=report.signal.overlap;
 assert.ok(overlap.active>0&&overlap.active<overlap.allocated);
 let zeroed=0;
 assert.equal(overlap.clipped.length,overlap.allocated*4);
 for(let i=0;i<overlap.clipped.length;i+=4){
  if(overlap.clipped[i+3]===0){zeroed++;assert.deepEqual(overlap.clipped.slice(i,i+4),[0,0,0,0]);}
  else assert.deepEqual(overlap.clipped.slice(i,i+4),overlap.full.slice(i,i+4),'retained receivers preserve full quadrature');
 }
 assert.equal(zeroed,overlap.allocated-overlap.active,'GPU skip mask matches effective receiver count');
 assert.equal(report.signal.bottom.length,16);
 for(let i=0;i<3;i++)assert.ok(Math.abs(report.signal.bottom[i*4]-20)<.001,'bottom incident join must approach the exterior field continuously');
 assert.ok(report.signal.bottom[12]<20&&report.signal.bottom[12]>19,'inside bottom blend samples both fields');
 const seed=report.signal.seed;
 assert.ok(seed.exterior.exteriorEmission);assert.ok(seed.exterior.values.some((v,i)=>i%4!==3&&v>0),'World producer exports current radiance');
 assert.ok(seed.resident.exterior.values.some((v,i)=>i%4!==3&&v>20),'adaptive resident radiance reaches exterior source');
 assert.ok(seed.smokeOnly.exterior.values.every((v,i)=>i%4===3||v===0),'World smoke-only option suppresses source emission');
 assert.ok(seed.smokeOnly.exterior.values.some((v,i)=>i%4===3&&v>0),'smoke-only World retains extinction');
 assert.equal(seed.off.exterior,undefined);

 assert.deepEqual(seed.dimensions,[4,8,4]);
 assert.deepEqual(seed.restored.values,seed.values,'removing rounded margin restores legacy physical law');
 assert.deepEqual(seed.zero.values,seed.values,'zero margin selects the same legacy law');
 assert.ok(seed.values.every(Number.isFinite)&&seed.values.length===512);
 // Each Fine cell averages eight physical samples. Compare to the camera's
 // established smooth boundary ownership with constant raw World material.
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 for(let z=0;z<4;z++)for(let y=0;y<8;y++)for(let x=0;x<4;x++){
  let weight=0,smokeEmission=0;for(let k=0;k<8;k++){
   const p=[x,y,z].map((v,a)=>(v+(((k>>a)&1)+.5)*.5)*.5-1);
   const d=Math.min(1-Math.abs(p[0]),1-Math.abs(p[2]),p[1]+1,3-p[1]);const w=1-smooth(d/.5);weight+=w/8;
   const containD=Math.min((1-Math.abs(p[0]))/.22,(1-Math.abs(p[2]))/.22,(3-p[1])/.8);
   const cap=.08+.92*smooth(containD)**2;smokeEmission+=10*cap*(1-w)/8;
  }
  const i=4*(x+4*(y+8*z));
  assert.ok(Math.abs(seed.resident.values[i]-(10+20*weight))<1e-5,'World-on source consumes prepared resident radiance');
  assert.ok(Math.abs(seed.resident.values[i+3]-(3+9*weight))<1e-5,'World extinction consumes the prepared resident atlas');
  assert.ok(Math.abs(seed.smokeOnly.values[i]-smokeEmission)<1e-5,'World-off source preserves Sexy flame containment and camera ownership');
  assert.ok(Math.abs(seed.fast.values[i]-seed.resident.values[i])<1e-5,'fast material option remains composed');
  assert.ok(Math.abs(seed.values[i]-(10+10*weight))<1e-5,'live seed emission must match camera ownership');
  assert.ok(Math.abs(seed.values[i+3]-(3+6*weight))<1e-5,'collar extinction is mixed, never omitted or doubled');
  let roundedWeight=0;
  for(let k=0;k<8;k++){
   const p=[x,y,z].map((v,a)=>(v+(((k>>a)&1)+.5)*.5)*.5-1);
   const rx=Math.max(0,Math.min(1,(Math.abs(p[0])-.58)/.4)),rz=Math.max(0,Math.min(1,(Math.abs(p[2])-.58)/.4));
   const ry=Math.max(0,Math.min(1,(p[1]-1.88)/1.04));
   roundedWeight+=smooth(Math.min(1,Math.hypot(rx,ry,rz)))/8;
  }
  assert.ok(Math.abs(seed.rounded.values[i+3]-(3+6*roundedWeight))<1e-5,'authored margin drives physical camera uniform and seeded extinction together');
  assert.deepEqual(seed.off.values.slice(i,i+4),[10,10,10,3],'disabled World preserves original Fine coefficients');
 }
 const [a,b,c,d,m,s,r]=report.signal.rows;assert.equal(report.signal.rows.length,7);
 for(const row of report.signal.rows)for(const field of ['fine','coarse'])assert.ok(row[field].length===64&&row[field].every(Number.isFinite),'complete finite raw receiver output');
 const rgb=values=>values.filter((_,i)=>i%4!==3);
 assert.ok(rgb(a.coarse).every(v=>v>0),'fine flame must illuminate all empty-scene exterior receivers');
 for(let i=0;i<a.coarse.length;i++)if(i%4!==3){assert.ok(Math.abs(b.coarse[i]-2*a.coarse[i])<1e-5,'live emission update');assert.ok(c.coarse[i]<b.coarse[i],'exterior attenuation');assert.equal(d.coarse[i],0,'zero-emission negative control');}
 assert.deepEqual(b.fine,c.fine,'coarse extinction does not change fine field');
 assert.ok(rgb(m.coarse).some((v,i)=>v<rgb(b.coarse)[i]),'middle-only density must attenuate light');
 for(let i=0;i<c.coarse.length;i++)assert.ok(Math.abs(c.coarse[i]-s.coarse[i])<1e-5,'overlapping equal media must blend, never double extinction');
 assert.deepEqual(r.coarse,b.coarse,'removing middle restores the unattenuated field');
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanupErrors=[];try{await browser?.close();}catch(error){report.cleanupErrors.push(String(error));report.status='failed';process.exitCode=1;}try{if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){report.cleanupErrors.push(String(error));report.status='failed';process.exitCode=1;}await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,out,error:report.error}));
