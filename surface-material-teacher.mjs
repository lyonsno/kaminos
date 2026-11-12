import {SurfaceTeacher} from './surface-teacher.mjs';
import {SURFACE_TEACHER_COMMON_WGSL} from './surface-teacher-wgsl.mjs';
export const SURFACE_MATERIAL_QUERY_WGSL=SURFACE_TEACHER_COMMON_WGSL+/* wgsl */`
struct Query {uvView:vec4<f32>,lightLod:vec4<f32>}
@group(0) @binding(5) var<storage,read> queries:array<Query>;
@group(0) @binding(6) var<storage,read_write> answers:array<f32>;
@group(0) @binding(7) var<uniform> capture:array<vec4<f32>,2>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=arrayLength(&queries)){return;}let q=queries[id.x];
 let v=vec3<f32>(q.uvView.z,-sqrt(max(0.0,1.0-dot(q.uvView.zw,q.uvView.zw))),q.uvView.w);
 let l=vec3<f32>(-q.lightLod.x,sqrt(max(0.0,1.0-dot(q.lightLod.xy,q.lightLod.xy))),-q.lightLod.y);
 var state=id.x*747796405u+(params.extent.z+1u)*2891336453u;var sum=vec3<f32>(0.0);
 for(var s=0u;s<u32(capture[0].w);s++){
  // Box footprint in the material reference plane, explicitly not a camera
  // frame integral or a denoised label. Directions use the decoder's incoming convention.
  let uv=q.uvView.xy+(vec2<f32>(random(&state),random(&state))-.5)*exp2(q.lightLod.z)/vec2<f32>(capture[0].z,capture[1].y);
  let origin=vec3<f32>((uv.x-.5)*capture[0].x,capture[0].y,(uv.y-.5)*capture[1].x);
  sum+=pathTraceIncident(origin,v,&state,l,true);
 }
 let response=sum/(capture[0].w*l.y);answers[id.x*3u]=response.r;answers[id.x*3u+1u]=response.g;answers[id.x*3u+2u]=response.b;
}
`;
export const SURFACE_MATERIAL_GRID_WGSL=SURFACE_TEACHER_COMMON_WGSL+/* wgsl */`
struct Query {uvView:vec4<f32>,lightLod:vec4<f32>}
@group(0) @binding(5) var<storage,read> queries:array<Query>;
@group(0) @binding(6) var<uniform> capture:array<vec4<f32>,2>;
@group(0) @binding(7) var raw:texture_storage_2d<rgba32float,write>;
@group(0) @binding(8) var positions:texture_storage_2d<rgba32float,write>;
@group(0) @binding(9) var normals:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(any(id.xy>=params.extent.xy)){return;}let index=id.y*params.extent.x+id.x;let q=queries[index];
 let v=vec3<f32>(q.uvView.z,-sqrt(1.0-dot(q.uvView.zw,q.uvView.zw)),q.uvView.w);
 let l=vec3<f32>(-q.lightLod.x,sqrt(1.0-dot(q.lightLod.xy,q.lightLod.xy)),-q.lightLod.y);
 let extent=vec2<f32>(capture[0].x,capture[1].x);
 var state=index*747796405u+(params.extent.z+1u)*2891336453u;var sum=vec3<f32>(0.0);
 for(var s=0u;s<u32(capture[0].w);s++){
  let uv=q.uvView.xy+(vec2<f32>(random(&state),random(&state))-.5)*exp2(q.lightLod.z)/vec2<f32>(capture[0].z,capture[1].y);
  let origin=vec3<f32>((uv.x-.5)*extent.x,capture[0].y,(uv.y-.5)*extent.y);
  sum+=pathTraceIncident(origin,v,&state,l,true);
 }
 let origin=vec3<f32>((q.uvView.x-.5)*extent.x,capture[0].y,(q.uvView.y-.5)*extent.y);
 let hit=trace(origin,v,1e20);var p=vec4<f32>(0.0);var n=vec4<f32>(0.0);
 if(hit.id!=0xffffffffu){p=vec4<f32>(origin+v*hit.t,1.0);n=vec4<f32>(hit.normal,triangles[hit.id].a.w+1.0);}
 textureStore(raw,id.xy,vec4<f32>(sum/(capture[0].w*l.y),1.0));textureStore(positions,id.xy,p);textureStore(normals,id.xy,n);
}
`;
export class SurfaceMaterialTeacher extends SurfaceTeacher{
 async evaluateMaterialGrid({width,height,tileWidth,tileDepth,referenceHeight,resolution,resolutionHeight=resolution,samples,view,light,lod=0,seed=0,uvOrigin=[0,0],uvScale=[1,1]}={}){
  if(this.disposed)throw Error('surface teacher is disposed');
  if(this.environment!==0)throw Error('Material labels require zero environment');
  if(![width,height,resolution,resolutionHeight,samples].every(v=>Number.isSafeInteger(v)&&v>0)||![tileWidth,tileDepth].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(referenceHeight)||!Number.isFinite(lod)||lod<0||!Number.isSafeInteger(seed)||seed<0)throw Error('Invalid material grid configuration');
  for(const d of [view,light])if(!Array.isArray(d)||d.length!==2||!d.every(Number.isFinite)||d[0]**2+d[1]**2>=1)throw Error('Upper hemisphere directions required');
  if(![uvOrigin,uvScale].every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite))||uvScale.some(v=>v<=0)||uvOrigin.some((v,i)=>v<0||v+uvScale[i]>1.000001))throw Error('Invalid material grid UV window');
  this.resize(width,height);
  const queries=new Float32Array(width*height*8);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)queries.set([uvOrigin[0]+(x+.5)/width*uvScale[0],uvOrigin[1]+(y+.5)/height*uvScale[1],...view,...light,lod,0],(y*width+x)*8);
  this.materialGridPipeline??=this.device.createComputePipeline({label:'coherent directional material grid',layout:'auto',compute:{module:this.device.createShaderModule({code:SURFACE_MATERIAL_GRID_WGSL}),entryPoint:'main'}});
  const input=this.buffer('material grid queries',queries),config=this.buffer('material grid footprint',new Float32Array([tileWidth,referenceHeight,resolution,samples,tileDepth,resolutionHeight,0,0]),GPUBufferUsage.UNIFORM);
  try{
   this.writeParams({width,height,frame:seed});const encoder=this.device.createCommandEncoder();
   const dispatch=(pipeline,resources)=>{const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,this.group(pipeline,resources));pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();};
   dispatch(this.materialGridPipeline,[...this.common(),input,config,this.raw,this.points[0],this.normals[0]]);
   let output=this.raw;
   for(let step=0;step<3;step++){const target=this.filtered[step%2];dispatch(this.pipelines.filter,[output,this.points[0],this.normals[0],target,this.filterParams[step]]);output=target;}
   this.device.queue.submit([encoder.finish()]);
   this.accumulation=this.raw;const raw=await this.readLinear();this.accumulation=output;const filtered=await this.readLinear();
   const rgb=rgba=>{const result=new Float32Array(width*height*3);for(let i=0;i<width*height;i++)result.set(rgba.subarray(i*4,i*4+3),i*3);if(!result.every(Number.isFinite))throw Error('Non-finite material grid response');return result;};
   return {queries,raw:rgb(raw),filtered:rgb(filtered)};
  }finally{for(const b of [input,config]){b.destroy();this.resources.splice(this.resources.indexOf(b),1);}}
 }
 async evaluateMaterial(queries,{tileSize,tileDepth=tileSize,referenceHeight,resolution,resolutionHeight=resolution,samples,seed=0}={}){
  if(this.disposed)throw Error('surface teacher is disposed');
  if(this.environment!==0)throw Error('Material labels require zero environment; incident light is query-owned');
  if(!(queries instanceof Float32Array)||!queries.length||queries.length%8||!queries.every(Number.isFinite))throw Error('Finite nonempty material queries required');
  for(let i=0;i<queries.length;i+=8)if(queries[i+2]**2+queries[i+3]**2>=1||queries[i+4]**2+queries[i+5]**2>=1||queries[i+6]<0)throw Error('Upper hemisphere directions and nonnegative LOD required');
  if(!Number.isFinite(tileDepth)||tileDepth<=0||!Number.isFinite(tileSize)||tileSize<=0||!Number.isFinite(referenceHeight)||!Number.isSafeInteger(resolution)||resolution<1||!Number.isSafeInteger(resolutionHeight)||resolutionHeight<1||!Number.isSafeInteger(samples)||samples<1||!Number.isSafeInteger(seed)||seed<0)throw Error('Invalid material capture configuration');
  const count=queries.length/8;if(Math.ceil(count/64)>this.device.limits.maxComputeWorkgroupsPerDimension)throw Error('Material query dispatch exceeds device capacity');
  this.materialPipeline??=this.device.createComputePipeline({label:'surface material directional query',layout:'auto',compute:{module:this.device.createShaderModule({code:SURFACE_MATERIAL_QUERY_WGSL}),entryPoint:'main'}});
  const resources=[];let read;
  try{
   const input=this.buffer('material queries',queries),output=this.buffer('material responses',new Float32Array(count*3),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);resources.push(input,output);
   const config=this.buffer('material footprint',new Float32Array([tileSize,referenceHeight,resolution,samples,tileDepth,resolutionHeight,0,0]),GPUBufferUsage.UNIFORM);resources.push(config);
   read=this.device.createBuffer({size:count*12,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
   this.writeParams({frame:seed});const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(this.materialPipeline);pass.setBindGroup(0,this.group(this.materialPipeline,[...this.common(),input,output,config]));pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();encoder.copyBufferToBuffer(output,0,read,0,count*12);this.device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const rgb=new Float32Array(read.getMappedRange().slice(0));if(!rgb.every(Number.isFinite))throw Error('Non-finite material response');return rgb;
  }finally{read?.destroy();for(const b of resources){b.destroy();this.resources.splice(this.resources.indexOf(b),1);}}
 }
}
