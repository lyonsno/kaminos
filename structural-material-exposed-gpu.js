import {IndirectStorageBufferAttribute,StorageBufferAttribute} from 'three/webgpu';
import {packFixedCellFaces} from './structural-material-bounded-fragments.mjs';
import {finiteCellWgsl} from './structural-material-finite-plane.mjs';
import {disposeAll} from './structural-material-disposal.mjs';

export const exposedFacesWgsl=`
@group(0) @binding(0) var<storage,read> bonds:array<vec4u>;
@group(0) @binding(1) var<storage,read> vertices:array<CellVertex>;
@group(0) @binding(2) var<storage,read> faces:array<array<u32,8>>;
@group(0) @binding(3) var<storage,read_write> indices:array<u32>;
@group(0) @binding(4) var<storage,read_write> draws:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read> changes:array<u32>;
${finiteCellWgsl}
fn dirty()->bool{return atomicLoad(&draws[10])!=0u||changes[0]!=0u;}
@compute @workgroup_size(64) fn latch(@builtin(global_invocation_id) id:vec3u){if(id.x==0u&&changes[0]!=0u){atomicStore(&draws[10],1u);}}
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) id:vec3u){if(id.x==0u&&dirty()){atomicStore(&draws[0],0u);atomicStore(&draws[5],0u);}}
@compute @workgroup_size(64) fn expose(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&faces)||!dirty()){return;}let f=faces[i];var hidden=f[3]==0u;
 if(hidden){for(var k=0u;k<3u;k++){let v=vertices[f[k]];hidden=hidden&&((reachedCell(v)&(1u<<f[k+4u]))!=0u);}}
 if(hidden){return;}let draw=select(5u,0u,f[3]==1u);let slot=atomicAdd(&draws[draw],3u)+atomicLoad(&draws[draw+2u]);
 for(var k=0u;k<3u;k++){indices[slot+k]=f[k];}
}
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) id:vec3u){if(id.x==0u){atomicStore(&draws[10],0u);}}
`;

export async function createGpuExposedFaces(renderer,shell,geometry,{ownershipBuffer,connectionBuffer,changeBuffer,faceBuffer=null}){
 const device=renderer.backend.device,packed=packFixedCellFaces(shell),owned=[],allocate=(label,size,usage)=>{if(size>device.limits.maxStorageBufferBindingSize)throw Error(`${label} exceeds effective storage capacity`);const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
 let indexAttribute,indirect;
 try{
  const faces=faceBuffer??allocate('Stone opposed faces',packed.faces.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),indices=allocate('Stone exposed indices',shell.geometry.indices.length*4,GPUBufferUsage.STORAGE|GPUBufferUsage.INDEX|GPUBufferUsage.COPY_SRC),draws=allocate('Stone exposed draws',44,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
  if(!faceBuffer)device.queue.writeBuffer(faces,0,packed.faces);device.queue.writeBuffer(draws,0,new Uint32Array([0,1,0,0,0,0,1,packed.exteriorTriangles*3,0,0,1]));
  const module=device.createShaderModule({code:exposedFacesWgsl}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(info.messages));
  const layout=device.createBindGroupLayout({entries:Array.from({length:6},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===3||binding===4?'storage':'read-only-storage'}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  for(const entryPoint of ['latch','clear','expose','finish'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}});
  const group=device.createBindGroup({layout,entries:[connectionBuffer,ownershipBuffer,faces,indices,draws,changeBuffer].map((buffer,binding)=>({binding,resource:{buffer}}))});
  indexAttribute=new StorageBufferAttribute(Uint32Array.from(shell.geometry.indices),1);renderer.backend.get(indexAttribute).buffer=indices;geometry.setIndex(indexAttribute);
  indirect=new IndirectStorageBufferAttribute(new Uint32Array(11),1);renderer.backend.get(indirect).buffer=draws;geometry.indirect=indirect;
  const submit=names=>{const encoder=device.createCommandEncoder();for(const name of names){const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(name==='expose'?Math.ceil(shell.geometry.exterior.length/64):1);pass.end();}device.queue.submit([encoder.finish()]);};
  return{route:'kaminos.stone.exposed-cell-faces.webgpu.v1',prepare(){submit(['latch']);},update(){submit(['clear','expose','finish']);},
   async readCounts(){const read=device.createBuffer({size:44,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(draws,0,read,0,44);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const v=new Uint32Array(read.getMappedRange());return{route:this.route,exteriorTriangles:v[0]/3,interiorTriangles:v[5]/3,totalTriangles:(v[0]+v[5])/3,capacityTriangles:shell.geometry.exterior.length};}finally{read.destroy();}},
   dispose(){geometry.indirect=null;renderer.backend.delete(indexAttribute);renderer.backend.delete(indirect);disposeAll(owned.map(b=>()=>b.destroy()),'Stone exposure cleanup failed');}};
 }catch(error){disposeAll(owned.map(b=>()=>b.destroy()),'Stone exposure initialization failed',error);}
}
