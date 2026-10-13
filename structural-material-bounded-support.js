export const ELASTIC_SUPPORT_ROUTE='kaminos.bounded-connectivity.elastic-support.v1';
export const elasticSupportWgsl=`
@group(0) @binding(0) var<storage,read> bonds:array<vec4u>;
@group(0) @binding(1) var<storage,read> elements:array<vec4u>;
@group(0) @binding(2) var<storage,read> parameters:array<f32>;
@group(0) @binding(3) var<storage,read> incidence:array<u32>;
@group(0) @binding(4) var<storage,read_write> output:array<vec4u>;
@group(0) @binding(5) var<uniform> counts:vec4u;
@compute @workgroup_size(64) fn update(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&bonds)){return;}let edge=bonds[i];var supported=false;
 if(edge.z==1u){for(var j=incidence[edge.x];j<incidence[edge.x+1u];j++){
  let t=incidence[counts.x+1u+j*2u];
  if(parameters[t*16u+11u]>0.0&&any(elements[t]==vec4u(edge.y))){supported=true;break;}
 }}
 output[i]=vec4u(edge.xy,select(0u,1u,supported),edge.z);
}`;

export async function createBoundedElasticSupport(resident){
 const device=resident.device,model=resident.submittedState().model,owned=[];
 try{
  const output=device.createBuffer({label:'Derived elastic support connections',size:model.bonds*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});owned.push(output);
  const counts=device.createBuffer({label:'Elastic support counts',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(counts);device.queue.writeBuffer(counts,0,new Uint32Array([model.points,0,0,0]));
  const buffers=resident.elasticSupportBuffers(),shader=device.createShaderModule({code:elasticSupportWgsl}),info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(info.messages));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'update'}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[resident.bondBuffer(),buffers.elements,buffers.parameters,buffers.incidence,output,counts].map((buffer,binding)=>({binding,resource:{buffer}}))});
  return{route:ELASTIC_SUPPORT_ROUTE,buffer:output,
   update(){const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(model.bonds/64));pass.end();device.queue.submit([encoder.finish()]);},
   dispose(){disposeAll(owned.map(b=>()=>b.destroy()),'Elastic support cleanup failed');}
  };
 }catch(error){disposeAll(owned.map(b=>()=>b.destroy()),'Elastic support initialization failed',error);}
}
import {disposeAll} from './structural-material-disposal.mjs';
