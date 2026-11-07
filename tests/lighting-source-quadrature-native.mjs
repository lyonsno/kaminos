// kaminos-test: node
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {withKaminosGpu,extractWgslFunction} from '../tools/shader-herder.mjs';
const target=process.argv[2]?pathToFileURL(path.resolve(process.argv[2],'scene-volume-source.mjs')).href:new URL('../scene-volume-source.mjs',import.meta.url).href;
const {SCENE_VOLUME_SOURCE_WGSL}=await import(target);
await withKaminosGpu(async({device})=>{
 const coefficients=device.createTexture({size:[1,1,1],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
 const scattering=device.createTexture({size:[1,1,1],dimension:'3d',format:'r32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
 const params=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),read=device.createBuffer({size:512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const code=`const SCENE_SOURCE_GRID:u32=1u;const SCENE_SOURCE_GRID_Y:u32=1u;
 struct EmissiveMaterial{emission:vec3<f32>,absorption:f32,scattering:f32}
 struct U{open_world_boundary:vec4<f32>}var<private> u:U;
 fn seatGridShape(){}
 fn sceneEmissiveMaterialAt(p:vec3<f32>)->EmissiveMaterial{return EmissiveMaterial(p*p,.25,.5);}
 fn fastEmissiveMaterialAt(p:vec3<f32>,scale:f32)->EmissiveMaterial{return sceneEmissiveMaterialAt(p);}
 fn worldSmokePhysicalBlend(p:vec3<f32>,m:EmissiveMaterial,a:f32,b:f32)->EmissiveMaterial{return m;}
 @group(0) @binding(4) var sceneSourceOut:texture_storage_3d<rgba32float,write>;
 @group(0) @binding(5) var sceneScatteringOut:texture_storage_3d<r32float,write>;
 @group(0) @binding(10) var<uniform> sceneSourceSampling:vec4<u32>;
 @compute @workgroup_size(4,4,4)
 ${extractWgslFunction(SCENE_VOLUME_SOURCE_WGSL,'seedSceneVolumeSource')}`;
 const layout=device.createBindGroupLayout({entries:[{binding:4,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float',viewDimension:'3d'}},{binding:5,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'r32float',viewDimension:'3d'}},{binding:10,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
 const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module:device.createShaderModule({code}),entryPoint:'seedSceneVolumeSource'}});
 const group=device.createBindGroup({layout,entries:[{binding:4,resource:coefficients.createView()},{binding:5,resource:scattering.createView()},{binding:10,resource:{buffer:params}}]});
 try{for(const n of [1,2,3]){
  device.queue.writeBuffer(params,0,new Uint32Array([n,0,0,0]));const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
  encoder.copyTextureToBuffer({texture:coefficients},{buffer:read,bytesPerRow:256},[1,1,1]);encoder.copyTextureToBuffer({texture:scattering},{buffer:read,offset:256,bytesPerRow:256},[1,1,1]);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange()).slice();read.unmap();
  const mean=(n*n-1)/(3*n*n);for(let a=0;a<3;a++)assert(Math.abs(values[a]-mean)<1e-6,`source material quadrature axis${n} evaluates the requested subcell lattice`);assert(Math.abs(values[3]-.75)<1e-6);assert(Math.abs(values[64]-.5)<1e-6);
 }
 // Execute the production Middle seed with a deterministic optical-material
 // fixture. This checks channel/moment/fire-visibility wiring; the full
 // physical material law is covered by the all-region consumer witness.
 const middle=device.createTexture({size:[2,1,1],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 try{
  device.queue.writeTexture({texture:middle},new Float32Array([.125,.25,.5,.75,.5,1,2,0]),{bytesPerRow:32},[2,1,1]);
  const seed=extractWgslFunction(SCENE_VOLUME_SOURCE_WGSL,'seedSceneMiddleMedium');
  const preamble=`struct EmissiveMaterial{emission:vec3<f32>,absorption:f32,scattering:f32}
struct WorldRender{middleLoPitch:vec4<f32>}
var<private> worldRender:WorldRender;
fn seatGridShape(){worldRender.middleLoPitch=vec4<f32>(-1,-1,-1,2);}
@group(0) @binding(2) var middleOptical:texture_3d<f32>;
@group(0) @binding(4) var sceneExteriorEmissionOut:texture_storage_3d<rgba32float,write>;
@group(0) @binding(5) var sceneExteriorOut:texture_storage_3d<r32float,write>;
fn regionSmokeSample(field:texture_3d<f32>,p:vec3<f32>,mapping:vec4<f32>,slot:i32)->vec4<f32>{
 return textureLoad(field,vec3<i32>(slot,0,0),0);
}
fn regionSmokeMaterial(raw:vec4<f32>,moments:vec3<f32>,density:f32,fire:f32)->EmissiveMaterial{
 return EmissiveMaterial((raw.xyz+moments)*fire,raw.w*density,.25*density);
}`;
  const mediumLayout=device.createBindGroupLayout({entries:[
   {binding:2,visibility:GPUShaderStage.COMPUTE,texture:{viewDimension:'3d',sampleType:'unfilterable-float'}},
   {binding:4,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float',viewDimension:'3d'}},
   {binding:5,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'r32float',viewDimension:'3d'}},
  ]});
  const group=device.createBindGroup({layout:mediumLayout,entries:[{binding:2,resource:middle.createView()},{binding:4,resource:coefficients.createView()},{binding:5,resource:scattering.createView()}]});
  const suppressed=seed.replace('regionSmokeMaterial(raw,moments,1.0,1.0)','regionSmokeMaterial(raw,vec3<f32>(0.0),1.0,0.0)');
  for(const [body,expected] of [[seed,[.625,1.25,2.5,1]],[suppressed,[0,0,0,1]]]){
   const module=device.createShaderModule({code:preamble+'\n@compute @workgroup_size(4,4,4)\n'+body});
   const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[mediumLayout]}),compute:{module,entryPoint:'seedSceneMiddleMedium'}});
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
   encoder.copyTextureToBuffer({texture:coefficients},{buffer:read,bytesPerRow:256},[1,1,1]);
   encoder.copyTextureToBuffer({texture:scattering},{buffer:read,offset:256,bytesPerRow:256},[1,1,1]);
   device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange()).slice();read.unmap();
   assert.deepEqual([...values.slice(0,4)],expected,'Middle seed consumes current optical moments and admits physical emission');
   assert.equal(values[64],1,'Middle seed retains extinction beside emission');
  }
 }finally{middle.destroy();}
 }finally{coefficients.destroy();scattering.destroy();params.destroy();read.destroy();}
});
console.log('PASS production Fine quadrature and Middle optical moment/emission seed wiring');
