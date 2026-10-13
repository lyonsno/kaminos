import {FINITE_PLANE_ROUTE,finiteCellWgsl,packFiniteCellOwnership,validateFinitePlane} from './structural-material-finite-plane.mjs';
import {disposeAll} from './structural-material-disposal.mjs';
export const finitePlaneWgsl=`
struct Point{rest:vec4f,position:vec4f,velocity:vec4f,predicted:vec4f};
struct Plane{normalOffset:vec4f,response:vec4f};
@group(0) @binding(0) var<storage,read_write> points:array<Point>;
@group(0) @binding(1) var<storage,read> bonds:array<vec4u>;
@group(0) @binding(2) var<storage,read> vertices:array<CellVertex>;
@group(0) @binding(3) var<storage,read> incidence:array<u32>;
@group(0) @binding(4) var<uniform> plane:Plane;
@group(0) @binding(5) var<storage,read_write> diagnostics:array<vec4f>;
${finiteCellWgsl}
@compute @workgroup_size(64) fn bounds(@builtin(global_invocation_id) id:vec3u){
 let node=id.x;let count=arrayLength(&points);if(node>=count){return;}let p=points[node];
 let n=plane.normalOffset.xyz;var bound=-3.402823e38;
 for(var k=incidence[node];k<incidence[node+1u];k++){
  let v=vertices[incidence[count+1u+k]];let reached=reachedCell(v);
  for(var j=0u;j<v.ownership.x;j++){if(v.ids[j]==node&&(reached&(1u<<j))!=0u){bound=max(bound,plane.normalOffset.w-dot(n,v.rest.xyz));}}
 }
 diagnostics[node*6u+4u].w=p.rest.y+bound;
}
@compute @workgroup_size(64) fn contact(@builtin(global_invocation_id) id:vec3u){
 let node=id.x;if(node>=arrayLength(&points)){return;}let p=points[node];if(p.velocity.w==1.0){return;}let n=plane.normalOffset.xyz;
 let bound=diagnostics[node*6u+4u].w-p.rest.y;
 var x=p.position.xyz;let gap=dot(n,x-p.rest.xyz)-bound;if(gap>1e-6){return;}if(gap<0.0){x-=n*gap;}
 var velocity=p.velocity.xyz;let vn=dot(n,velocity);if(vn<0.0){let bounce=select(0.0,plane.response.y,vn<-.1);let tangent=velocity-n*vn;let speed=length(tangent);var scale=0.0;if(speed>0.0){scale=max(0.0,1.0-plane.response.x*(1.0+bounce)*-vn/speed);}velocity=tangent*scale-n*bounce*vn;}
 points[node].position=vec4f(x,p.position.w);points[node].velocity=vec4f(velocity,p.velocity.w);
}`;
export async function createFinitePlaneContact(resident,binding,{ownershipBuffer,connectionBuffer=resident.bondBuffer()}={}){
 const device=resident.device,packed=packFiniteCellOwnership(binding),owned=[];
 const allocate=(label,size,usage)=>{if(size>device.limits.maxStorageBufferBindingSize)throw Error(`${label} exceeds effective device capacity`);const buffer=device.createBuffer({label,size,usage});owned.push(buffer);return buffer;};
 try{
  const vertices=ownershipBuffer??allocate('finite-plane cell ownership',packed.vertices.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);if(!ownershipBuffer)device.queue.writeBuffer(vertices,0,packed.vertices);
  const incidence=allocate('finite-plane incidence',packed.incidence.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),uniform=allocate('finite-plane response',32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(incidence,0,packed.incidence);
  const module=device.createShaderModule({code:finitePlaneWgsl}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(info.messages));
  const layout=device.createBindGroupLayout({entries:Array.from({length:6},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===4?'uniform':[0,5].includes(binding)?'storage':'read-only-storage'}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  for(const entryPoint of ['bounds','contact'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}});
  const group=device.createBindGroup({layout,entries:[resident.stateBuffer(),connectionBuffer,vertices,incidence,uniform,resident.diagnosticsBuffer()].map((buffer,binding)=>({binding,resource:{buffer}}))});
  let last=null;
  return{route:FINITE_PLANE_ROUTE,apply(plane){validateFinitePlane(plane);const values=[...plane.normal,plane.offset,plane.friction,plane.restitution,0,0];if(!last||values.some((v,i)=>v!==last[i])){device.queue.writeBuffer(uniform,0,new Float32Array(values));last=values;}const encoder=device.createCommandEncoder();for(const name of ['bounds','contact']){const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(binding.points/64));pass.end();}device.queue.submit([encoder.finish()]);},dispose(){disposeAll(owned.map(buffer=>()=>buffer.destroy()),'Finite plane cleanup failed');}};
 }catch(error){disposeAll(owned.map(buffer=>()=>buffer.destroy()),'Finite plane initialization failed',error);}
}
