import {SurfaceTeacher} from './surface-teacher.mjs';
import {createSurfaceTeacherCommonWGSL} from './surface-teacher-wgsl.mjs';
const queryBody=coverage=>/* wgsl */`
struct Query {uvView:vec4<f32>,lightLod:vec4<f32>}
@group(0) @binding(5) var<storage,read> queries:array<Query>;
@group(0) @binding(6) var<storage,read_write> answers:array<f32>;
@group(0) @binding(7) var<uniform> capture:vec4<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=arrayLength(&queries)){return;}let q=queries[id.x];
 let v=vec3<f32>(q.uvView.z,-sqrt(max(0.0,1.0-dot(q.uvView.zw,q.uvView.zw))),q.uvView.w);
 let l=vec3<f32>(-q.lightLod.x,sqrt(max(0.0,1.0-dot(q.lightLod.xy,q.lightLod.xy))),-q.lightLod.y);
 var state=id.x*747796405u+(params.extent.z+1u)*2891336453u;var sum=vec3<f32>(0.0);var covered=0.0;
 for(var s=0u;s<u32(capture.w);s++){
  // Box footprint in the material reference plane, explicitly not a camera
  // frame integral or a denoised label. Directions use the decoder's incoming convention.
  let uv=q.uvView.xy+(vec2<f32>(random(&state),random(&state))-.5)*exp2(q.lightLod.z)/capture.z;
  let origin=vec3<f32>((uv.x-.5)*capture.x,capture.y,(uv.y-.5)*capture.x);
  ${coverage?`if(trace(origin,v,1e30).id!=0xffffffffu){covered+=1.0;sum+=pathTraceIncident(origin,v,&state,l,true);}`:`sum+=pathTraceIncident(origin,v,&state,l,true);`}
 }
 let response=sum/(${coverage?'max(covered,1.0)':'capture.w'}*l.y);answers[id.x*${coverage?4:3}u]=response.r;answers[id.x*${coverage?4:3}u+1u]=response.g;answers[id.x*${coverage?4:3}u+2u]=response.b;
 ${coverage?`answers[id.x*4u+3u]=covered/capture.w;`:``}
}
`;
export const SURFACE_MATERIAL_QUERY_WGSL=createSurfaceTeacherCommonWGSL()+queryBody(false);
export const createSurfaceMaterialQueryWGSL=(surfaceWGSL,coverage=false)=>createSurfaceTeacherCommonWGSL(surfaceWGSL)+queryBody(coverage);
export class SurfaceMaterialTeacher extends SurfaceTeacher{
 async evaluateMaterial(queries,{tileSize,referenceHeight,samplingPlaneHeight=referenceHeight,resolution,samples,seed=0,coverage=false}={}){
  if(this.disposed)throw Error('surface teacher is disposed');
  if(this.environment!==0)throw Error('Material labels require zero environment; incident light is query-owned');
  if(!(queries instanceof Float32Array)||!queries.length||queries.length%8||!queries.every(Number.isFinite))throw Error('Finite nonempty material queries required');
  for(let i=0;i<queries.length;i+=8)if(queries[i+2]**2+queries[i+3]**2>=1||queries[i+4]**2+queries[i+5]**2>=1||queries[i+6]<0)throw Error('Upper hemisphere directions and nonnegative LOD required');
  if(!Number.isFinite(tileSize)||tileSize<=0||!Number.isFinite(referenceHeight)||!Number.isSafeInteger(resolution)||resolution<1||!Number.isSafeInteger(samples)||samples<1||!Number.isSafeInteger(seed)||seed<0)throw Error('Invalid material capture configuration');
  if(!Number.isFinite(samplingPlaneHeight)||samplingPlaneHeight>referenceHeight)throw Error('Invalid material sampling plane');
  let launchQueries=queries;
  if(samplingPlaneHeight!==referenceHeight){launchQueries=queries.slice();for(let i=0;i<queries.length;i+=8){const vertical=Math.sqrt(1-queries[i+2]**2-queries[i+3]**2),travel=(referenceHeight-samplingPlaneHeight)/vertical;launchQueries[i]-=travel*queries[i+2]/tileSize;launchQueries[i+1]-=travel*queries[i+3]/tileSize;}}
  const count=queries.length/8;if(Math.ceil(count/64)>this.device.limits.maxComputeWorkgroupsPerDimension)throw Error('Material query dispatch exceeds device capacity');
  const key=coverage?'coveragePipeline':'materialPipeline';
  this[key]??=this.device.createComputePipeline({label:'surface material directional query',layout:'auto',compute:{module:this.device.createShaderModule({code:createSurfaceMaterialQueryWGSL(this.surface?.wgsl,coverage)}),entryPoint:'main'}});
  const pipeline=this[key],stride=coverage?4:3;const resources=[];let read;
  try{
   const input=this.buffer('material queries',launchQueries),output=this.buffer('material responses',new Float32Array(count*stride),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);resources.push(input,output);
   const config=this.buffer('material footprint',new Float32Array([tileSize,referenceHeight,resolution,samples]),GPUBufferUsage.UNIFORM);resources.push(config);
   read=this.device.createBuffer({size:count*stride*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
   this.writeParams({frame:seed});const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,this.group(pipeline,[...this.common(),input,output,config]));this.bindSurface(pass,pipeline);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();encoder.copyBufferToBuffer(output,0,read,0,count*stride*4);this.device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const rgb=new Float32Array(read.getMappedRange().slice(0));if(!rgb.every(Number.isFinite))throw Error('Non-finite material response');return rgb;
  }finally{read?.destroy();for(const b of resources){b.destroy();this.resources.splice(this.resources.indexOf(b),1);}}
 }
}
