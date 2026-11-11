// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {EMPTY_SPACE_WGSL} from '../volume-empty-space.mjs';
import {OPTICAL_STEPPING_WGSL} from '../volume-optical-native.mjs';
import {withKaminosGpu,withGpuErrorScopes,extractWgslFunction,evalWgslBatch} from '../tools/shader-herder.mjs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const fixture=`const GRID:u32=8u;const GRID_Y:u32=12u;const SLOTS_PER_CELL:u32=4u;const RAY_STEP_STATS:bool=false;
struct UniformFixture{occupancy_controls:vec4<f32>,emissive_physics:vec4<f32>,reconstruction_kernel_controls:vec4<f32>}
var<private> u:UniformFixture;var<private> fixtureMode:u32;var<private> fluidSrc:array<vec4<f32>,8>;
struct WorldFixture{loPitch:vec4<f32>,hiEnabled:vec4<f32>,atlas:vec4<f32>}
var<private> worldRender:WorldFixture;
@group(1) @binding(0) var reactantSrc:texture_3d<f32>;
fn index3(c:vec3<u32>)->u32{return select(0u,1u,fixtureMode==3u&&c.x==3u);}
fn reactantLawOn()->bool{return fixtureMode==4u;}
fn displayReconstructionActive()->bool{return fixtureMode==7u;}
fn worldSmokeBlendWeight(p:vec3<f32>)->f32{return select(0.0,.2,fixtureMode==11u);}
fn worldResidentLeafBoundsAtGrid(q:vec3<f32>,n:ptr<function,vec4<f32>>)->vec4<f32>{
 *n=vec4<f32>(floor(q/4.0)*4.0,1);return vec4<f32>(0,0,select(0.0,1.0,fixtureMode==14u&&q.x>=4.0),select(1.0,0.0,fixtureMode==12u));
}
${extractWgslFunction(core,'worldToCell')}
${extractWgslFunction(core,'clampCell')}
`;
const cases=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14],expected=[1,1,0,0,0,0,0,0,0,1,0,0,0,1,0];
const body=`fixtureMode=id.x;u.occupancy_controls=vec4<f32>(select(1.0,0.0,fixtureMode==8u),0,0,0);u.emissive_physics=vec4<f32>(select(1.0,0.0,fixtureMode==5u),0,0,0);u.reconstruction_kernel_controls=vec4<f32>(select(0.0,1.0,fixtureMode==6u),0,0,0);
 fluidSrc[0]=vec4<f32>(3,0,0,0);fluidSrc[1]=vec4<f32>(select(0.0,1.0,fixtureMode==2u),5,0,0);fluidSrc[5]=vec4<f32>(1,5,0,0);
 worldRender.loPitch=vec4<f32>(-1,-1,-1,.25);worldRender.hiEnabled=vec4<f32>(1,2,1,1);worldRender.atlas=vec4<f32>(1,8,12,8);
 let negative=fixtureMode==9u;let ro=select(vec3<f32>(-.9375,-.4,0),vec3<f32>(.5,-.4,0),negative);let rd=vec3<f32>(select(1.0,-1.0,negative),0,0);
 let length=select(.01,1.5,fixtureMode==1u||fixtureMode==3u||negative||fixtureMode>=12u);let sampleT=select(0.0,length+.01,fixtureMode==10u);
 let world=fixtureMode>=11u;let near=select(vec2<f32>(-1,2),vec2<f32>(10,11),fixtureMode>=12u);
 output[id.x]=select(0u,1u,emptyOpticalInterval(ro,rd,0.0,length,sampleT,world,near,vec2<f32>(0)));`;
async function execute(ctx,source){
 const code=fixture+source+`\n@group(0) @binding(0) var<storage,read_write> output:array<u32>;\n@compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id:vec3<u32>){${body}}`;
 return withGpuErrorScopes(ctx.device,'exact-optical-interval-fixtures',async()=>{
  const d=ctx.device,out=d.createBuffer({size:cases.length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size:cases.length*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const texture=d.createTexture({dimension:'3d',size:[8,12,8],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  try{
   d.queue.writeTexture({texture},new Float32Array(8*12*8*2).fill(1),{bytesPerRow:64,rowsPerImage:12},[8,12,8]);
   const module=await ctx.compileShaderModule({label:'production exact optical intervals',code});
   const layout0=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});
   const layout1=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}}]});
   const p=d.createComputePipeline({layout:d.createPipelineLayout({bindGroupLayouts:[layout0,layout1]}),compute:{module,entryPoint:'check'}});
   const g0=d.createBindGroup({layout:p.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:out}}]}),g1=d.createBindGroup({layout:p.getBindGroupLayout(1),entries:[{binding:0,resource:texture.createView()}]});
   const e=d.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(p);pass.setBindGroup(0,g0);pass.setBindGroup(1,g1);pass.dispatchWorkgroups(cases.length);pass.end();e.copyBufferToBuffer(out,0,read,0,cases.length*4);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const values=Array.from(new Uint32Array(read.getMappedRange().slice(0)));read.unmap();return values;
  }finally{out.destroy();read.destroy();texture.destroy();}
 });
}
test('production exact certificates accept moving optical vacuum over full intervals and preserve material/ownership/refusal boundaries',async()=>{
 await withKaminosGpu(async ctx=>{
  assert.deepEqual(await execute(ctx,EMPTY_SPACE_WGSL),expected);
  const mutant=EMPTY_SPACE_WGSL.replace(extractWgslFunction(EMPTY_SPACE_WGSL,'emptyFineFootprint'),'fn emptyFineFootprint(c:vec3<i32>)->bool{return true;}');
  assert.notDeepEqual(await execute(ctx,mutant),expected,'valid shader that ignores a thin emitting/absorbing footprint must fail');
 });
});
test('zero-panel progression equals actual zero quadrature for cold/retained/phased fixed and adaptive controllers',async()=>{
 await withKaminosGpu(async ctx=>{
  for(const mode of [1,2,3]){
   const preamble=OPTICAL_STEPPING_WGSL.replace('override OPTICAL_STEP_MODE: u32 = 0u;',`override OPTICAL_STEP_MODE: u32 = ${mode}u;`);
   const values=await evalWgslBatch(ctx,{preamble,argTypes:['f32','u32'],returnType:'u32',inputs:[[-1,0],[-1,1],[.3,0],[.3,1]],body:`var a=opticalStepInitPhased(0.0,2.0,.25,arg0);a.mask=arg1;var b=a;let probes=select(5u,4u,arg1==1u);for(var i=0u;i<probes;i++){opticalStepObserveWithTolerance(&a,vec4<f32>(0),.01);}opticalStepSkipEmpty(&b);return select(0u,1u,a.cursor==b.cursor&&a.width==b.width&&a.mask==b.mask&&a.phased==b.phased&&all(a.transfer==b.transfer)&&all(a.probes[0]==b.probes[0]));`});
   assert.deepEqual(values,[1,1,1,1],`mode${mode} preserves accepted zero-panel state`);
  }
 });
});
