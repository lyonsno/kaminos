// kaminos-test: manual — requires native WebGPU module and evidence directory
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {JOINED_LIGHT_TRANSPORT_WGSL} from '../scene-joined-light-transport.mjs';
import {GATHER_WGSL,createVolumeGather} from '../scene-volume-gather.mjs';
import {DISTRIBUTED_SMOKE_WGSL} from '../scene-smoke-reconstruction.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
import {createSceneVolumeSource} from '../scene-volume-source.mjs';
const [native,out]=process.argv.slice(2);
assert.ok(native&&out,'name native WebGPU module and persistent evidence directory');
mkdirSync(out,{recursive:true});
const report={status:'running',phase:'source-discovery',cases:[],source:{root:resolve('.'),revision:null,files:{}}};
let device;const owned=[];
const save=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));save();
try{
  report.source.revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  for(const f of ['scene-joined-light-transport.mjs','scene-volume-source.mjs','scene-volume-gather.mjs','scene-prepared-smoke.mjs','scene-smoke-reconstruction.mjs','tests/scene-joined-light-native.mjs'])report.source.files[f]=createHash('sha256').update(readFileSync(f)).digest('hex');
  report.phase='adapter';save();
  const {create,globals}=await import(pathToFileURL(resolve(native)));Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']),adapter=await gpu.requestAdapter();assert(adapter&&!adapter.isFallbackAdapter,'native adapter required');
  report.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,native:resolve(native),backend:'metal'};
  device=await adapter.requestDevice();report.errors=[];device.addEventListener('uncapturederror',e=>report.errors.push(e.error.message));
  const buffer=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
  const texture=dims=>{const t=device.createTexture({dimension:'3d',size:dims,format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(t);return t;};
  const fine=texture([4,4,4]),outer=texture([3,3,3]);
  const fill=(t,dims,m)=>device.queue.writeTexture({texture:t},Float32Array.from({length:dims.reduce((a,b)=>a*b)*4},(_,i)=>m[i%4]),{bytesPerRow:dims[0]*16,rowsPerImage:dims[1]},dims);
  const interval=GATHER_WGSL.match(/fn interval\([\s\S]*?\n}\n/)[0];
  const code=`const SOURCE_DOMAIN_LO=vec3<f32>(-3);const SOURCE_DOMAIN_HI=vec3<f32>(3);
const FINE_SOURCE_LO=vec3<f32>(-1);const FINE_SOURCE_HI=vec3<f32>(1);
@group(0) @binding(5) var coefficients:texture_3d<f32>;
struct Ray {p:vec4<f32>,d:vec4<f32>}
@group(0) @binding(0) var<storage,read> rays:array<Ray>;
@group(0) @binding(1) var<storage,read_write> results:array<vec4<f32>>;
${interval}${JOINED_LIGHT_TRANSPORT_WGSL}
@compute @workgroup_size(1) fn test(@builtin(global_invocation_id) id:vec3<u32>){let r=rays[id.x];results[id.x]=vec4<f32>(integrateJoinedRay(r.p.xyz,r.d.xyz,r.p.w),1);}`;
  report.phase='compile-transport';save();
  const module=device.createShaderModule({code});assert.deepEqual((await module.getCompilationInfo()).messages.filter(m=>m.type==='error'),[]);
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'test'}});
  const rays=buffer(32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),result=buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),read=buffer(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rays}},{binding:1,resource:{buffer:result}},{binding:5,resource:fine.createView()},{binding:11,resource:outer.createView()}]});
  const segment=(j,s,L)=>s?j*-Math.expm1(-s*L)/s:j*L;
  const cases=[
    {name:'homogeneous-crossing',f:[2,1,.5,.4],o:[2,1,.5,.4],p:[-4,0,0],d:[1,0,0],limit:20,expected:[2,1,.5].map(j=>segment(j,.4,6))},
    {name:'negative-direction',f:[2,1,.5,.4],o:[2,1,.5,.4],p:[4,0,0],d:[-1,0,0],limit:20,expected:[2,1,.5].map(j=>segment(j,.4,6))},
    {name:'outer-attenuates-fine',f:[2,1,.5,0],o:[0,0,0,.7],p:[-4,0,0],d:[1,0,0],limit:20,expected:[2,1,.5].map(j=>Math.exp(-1.4)*j*2)},
    {name:'overlap-replaced',f:[0,0,0,0],o:[1,2,3,0],p:[-4,0,0],d:[1,0,0],limit:20,expected:[4,8,12]},
    {name:'opaque-before-fine',f:[100,100,100,0],o:[1,2,3,0],p:[-4,0,0],d:[1,0,0],limit:2,expected:[1,2,3]},
    {name:'inside-fine-opaque-clip',f:[2,1,.5,0],o:[100,100,100,0],p:[0,0,0],d:[0,1,0],limit:.5,expected:[1,.5,.25]},
    {name:'outer-only-chord',f:[100,100,100,0],o:[1,2,3,.5],p:[-4,2,0],d:[1,0,0],limit:20,expected:[1,2,3].map(j=>segment(j,.5,6))},
    {name:'miss',f:[100,100,100,0],o:[100,100,100,0],p:[-4,4,0],d:[1,0,0],limit:20,expected:[0,0,0]},
    {name:'diagonal-tied-faces',f:[1,1,1,0],o:[1,1,1,0],p:[-4,-4,-4],d:[1,1,1].map(v=>v/Math.sqrt(3)),limit:20,expected:[1,1,1].map(()=>6*Math.sqrt(3))},
  ];
  for(const c of cases){
    report.phase=c.name;save();fill(fine,[4,4,4],c.f);fill(outer,[3,3,3],c.o);
    device.queue.writeBuffer(rays,0,new Float32Array([...c.p,c.limit,...c.d,0]));
    const e=device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(1);p.end();e.copyBufferToBuffer(result,0,read,0,16);device.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);const actual=Array.from(new Float32Array(read.getMappedRange()));read.unmap();
    report.cases.push({...c,actual});actual.slice(0,3).forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-c.expected[i])<.00002,`${c.name}: ${v} vs ${c.expected[i]}`));
  }
  report.phase='production-gather-and-reconstruction';save();
  fill(fine,[4,4,4],[1,1,1,.1]);fill(outer,[3,3,3],[1,1,1,.1]);
  const geometry=buildTriangleVisibility([]).packGpu(),fineDomain={lo:[-1,-1,-1],hi:[1,1,1]},exteriorDomain={lo:[-3,-3,-3],hi:[3,3,3]};
  const field={status:'encoded',texture:fine,dimensions:[4,4,4],localMin:fineDomain.lo,localMax:fineDomain.hi,generation:1,frame:1,exterior:{texture:outer,dimensions:[3,3,3],localMin:exteriorDomain.lo,localMax:exteriorDomain.hi,generation:1}};
  report.gathers=[];
  for(const angularPattern of ['fixed','source','guided']){
    const gather=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,volumeDimensions:[2,2,2],directions:8,smokeRefinement:1,fineDomain,exteriorDomain,receiverDomain:exteriorDomain,angularPattern});
    try{const meta=gather.encode(field),data=await gather.readback();assert(data.smoke.data.every(Number.isFinite));assert(data.smoke.data.some((x,i)=>i%4!==3&&x>0));report.gathers.push({angularPattern,integration:meta.integration,values:Array.from(data.smoke.data),bounds:meta.smokeReconstruction.localMax});}
    finally{gather.destroy();}
  }
  report.phase='camera-shader';save();
  const camera=device.createShaderModule({code:DISTRIBUTED_SMOKE_WGSL+`@fragment fn test()->@location(0) vec4<f32>{return vec4<f32>(distributedMeanIncident(vec3<f32>(0)),1);}`});
  assert.deepEqual((await camera.getCompilationInfo()).messages.filter(m=>m.type==='error'),[]);
  report.phase='production-material-export-bindings';save();
  // Expose the existing private shader in memory without changing it. All its
  // imports still resolve to this exact worktree; this is compilation/binding
  // evidence, not a replacement material implementation or a flame fixture.
  const coreText=readFileSync('volume-core.js','utf8');
  report.source.files['volume-core.js']=createHash('sha256').update(coreText).digest('hex');
  const exposed=coreText.replaceAll("from './","from '"+pathToFileURL(resolve('.')+'/').href)+'\nexport {WGSL};';
  const core=await import('data:text/javascript;base64,'+Buffer.from(exposed).toString('base64'));
  device.pushErrorScope('validation');
  const materialShader=device.createShaderModule({code:core.WGSL});
  assert.deepEqual((await materialShader.getCompilationInfo()).messages.filter(m=>m.type==='error'),[]);
  const uniforms=buffer(core.VOLUME_UNIFORM_FLOATS*4,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const data=new Float32Array(core.VOLUME_UNIFORM_FLOATS);data.set([4,4,4,4,4,4,0,0],core.GRID_SHAPE_UNIFORM_OFFSET);device.queue.writeBuffer(uniforms,0,data);
  const fluidBuffers=[0,1].map(()=>buffer(64*64,GPUBufferUsage.STORAGE)),frontBuffers=[0,1].map(()=>buffer(64*64,GPUBufferUsage.STORAGE));
  const reactants=[texture([4,4,4]),texture([4,4,4])];
  const joinedUniform=buffer(32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(joinedUniform,0,new Float32Array([-3,-3,-3,2,3,3,3,1]));
  const source=createSceneVolumeSource({device,module:materialShader,uniformBuffer:uniforms,fluidBuffers,frontBuffers,getReactantTextures:()=>reactants,grid:4,gridY:4,
    getJoinedOptics:()=>({enabled:true,texture:outer,uniformBuffer:joinedUniform,dimensions:[3,3,3],localMin:[-3,-3,-3],localMax:[3,3,3]})});
  try{const e=device.createCommandEncoder();source.encode(e,0,1);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();assert.equal((await device.popErrorScope())?.message??null,null);}
  finally{source.destroy();}
  await device.queue.onSubmittedWorkDone();assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{for(const r of owned)r.destroy();device?.destroy();save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
