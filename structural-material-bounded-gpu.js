import {StorageBufferAttribute,MeshStandardNodeMaterial} from 'three/webgpu';
import {storage,vertexIndex} from 'three/tsl';
import {BOUNDED_FRAGMENT_ROUTE} from './structural-material-bounded-fragments.mjs';
import {disposeAll} from './structural-material-disposal.mjs';
import {finiteCellWgsl,packFiniteCellOwnership} from './structural-material-finite-plane.mjs';

export const boundedSurfaceWgsl=`
struct Point{rest:vec4f,position:vec4f,velocity:vec4f,predicted:vec4f};
@group(0) @binding(0) var<storage,read> points:array<Point>;
@group(0) @binding(1) var<storage,read> bonds:array<vec4u>;
@group(0) @binding(2) var<storage,read> vertices:array<CellVertex>;
@group(0) @binding(3) var<storage,read_write> output:array<vec4f>;
@group(0) @binding(4) var<storage,read> changes:array<u32>;
${finiteCellWgsl}
@compute @workgroup_size(64) fn update(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&vertices)){return;}let v=vertices[i];var reached=u32(output[i].w);if(reached==0u||changes[0]!=0u){reached=reachedCell(v);}
 var displacement=vec3f(0);var count=0.0;for(var j=0u;j<v.ownership.x;j++){if((reached&(1u<<j))!=0u){let p=points[v.ids[j]];displacement+=p.position.xyz-p.rest.xyz;count+=1.0;}}
 output[i]=vec4f(v.rest.xyz+displacement/count,f32(reached));
}`;

export const boundedPickingWgsl=`
struct Ray{origin:vec4f,direction:vec4f};
@group(0) @binding(0) var<storage,read> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read> indices:array<u32>;
@group(0) @binding(2) var<uniform> ray:Ray;
@group(0) @binding(3) var<storage,read_write> hit:array<atomic<u32>>;
fn distance(face:u32)->f32{
 let a=positions[indices[face*3u]].xyz;let b=positions[indices[face*3u+1u]].xyz;let c=positions[indices[face*3u+2u]].xyz;
 let e=b-a;let f=c-a;let p=cross(ray.direction.xyz,f);let d=dot(e,p);if(abs(d)<1e-12){return -1.0;}
 let s=ray.origin.xyz-a;let u=dot(s,p)/d;if(u<0.0||u>1.0){return -1.0;}let q=cross(s,e);let v=dot(ray.direction.xyz,q)/d;if(v<0.0||u+v>1.0){return -1.0;}
 return dot(f,q)/d;
}
@compute @workgroup_size(64) fn clearHit(@builtin(global_invocation_id) id:vec3u){if(id.x==0u){atomicStore(&hit[0],0x7f800000u);atomicStore(&hit[1],0xffffffffu);}}
@compute @workgroup_size(64) fn nearest(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&indices)/3u){return;}let t=distance(i);if(t>=0.0){atomicMin(&hit[0],bitcast<u32>(t));}}
@compute @workgroup_size(64) fn selectFace(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&indices)/3u){return;}let t=distance(i);if(t>=0.0&&bitcast<u32>(t)==atomicLoad(&hit[0])){atomicMin(&hit[1],i);}}
`;

async function createBoundedPicking(device,positions,indices){
 const owned=[],allocate=(label,size,usage)=>{const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
 try{
  const index=allocate('Bounded pick triangles',indices.length*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),uniform=allocate('Bounded pick ray',32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),hit=allocate('Bounded pick result',8,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);device.queue.writeBuffer(index,0,Uint32Array.from(indices));
  const shader=device.createShaderModule({code:boundedPickingWgsl}),info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(info.messages));
  const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  for(const entryPoint of ['clearHit','nearest','selectFace'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:shader,entryPoint}});
  const group=device.createBindGroup({layout,entries:[positions,index,uniform,hit].map((buffer,binding)=>({binding,resource:{buffer}}))});
  return {async pick(origin,direction){
   if(![origin,direction].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||Math.abs(Math.hypot(...direction)-1)>1e-6)throw new Error('Finite unit picking ray required');
   device.queue.writeBuffer(uniform,0,new Float32Array([...origin,0,...direction,0]));const read=device.createBuffer({size:8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{const encoder=device.createCommandEncoder();for(const name of ['clearHit','nearest','selectFace']){const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(name==='clearHit'?1:Math.ceil(indices.length/3/64));pass.end();}encoder.copyBufferToBuffer(hit,0,read,0,8);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=read.getMappedRange(),values=new Uint32Array(bytes),t=new Float32Array(bytes)[0];return values[1]===0xffffffff?null:{faceIndex:values[1],distance:t,point:origin.map((v,k)=>v+direction[k]*t),route:'kaminos.bounded-surface.gpu-ray-pick.v1',readbackBytes:8};}finally{read.destroy();}
  },dispose(){disposeAll(owned.map(b=>()=>b.destroy()),'Bounded picker cleanup failed');}};
 }catch(e){disposeAll(owned.map(b=>()=>b.destroy()),'Bounded picker initialization failed',e);}
}

export async function createGpuBoundedSurface(renderer,resident,binding,indices,materials,{connectionBuffer=resident.bondBuffer(),indexed=false,changeBuffer=null}={}){
 if(binding?.route!==BOUNDED_FRAGMENT_ROUTE||!binding.fixedCellShell||!renderer.backend.isWebGPUBackend||renderer.backend.device!==resident.device)throw new Error('Fixed cell shell and shared native device required');
 const device=resident.device,count=binding.entries.length,bytes=packFiniteCellOwnership(binding).vertices;
 const owned=[],allocate=(label,size,usage)=>{if(size>device.limits.maxStorageBufferBindingSize)throw new Error(`${label} exceeds effective device capacity`);const b=device.createBuffer({label,size,usage});owned.push(b);return b;};let outputAttribute,indexAttribute,materialCopies=[];
 try{
  const vertices=allocate('bounded local visual ownership',bytes.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),output=allocate('bounded visual pose',count*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);device.queue.writeBuffer(vertices,0,bytes);
  if(!changeBuffer){changeBuffer=allocate('Always refresh cell ownership',4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(changeBuffer,0,new Uint32Array([1]));}
  const module=device.createShaderModule({code:boundedSurfaceWgsl}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(info.messages.map(m=>({message:m.message,line:m.linePos,column:m.linePos}))));const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'update'}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[resident.stateBuffer(),connectionBuffer,vertices,output,changeBuffer].map((buffer,binding)=>({binding,resource:{buffer}}))});
  outputAttribute=new StorageBufferAttribute(new Float32Array(count*4),4);renderer.backend.get(outputAttribute).buffer=output;indexAttribute=new StorageBufferAttribute(Uint32Array.from(indices),1);const positions=storage(outputAttribute,'vec4',count).toReadOnly(),ids=storage(indexAttribute,'uint',indices.length).toReadOnly(),position=positions.element(indexed?vertexIndex:ids.element(vertexIndex)).xyz;
  materialCopies=materials.map(source=>{const m=new MeshStandardNodeMaterial();for(const k of ['color','map','normalMap','normalScale','normalMapType','roughness','roughnessMap','metalness','metalnessMap','aoMap','aoMapIntensity','emissive','emissiveMap','emissiveIntensity','side'])if(source[k]!==undefined)m[k]=source[k]?.clone&&!source[k].isTexture?source[k].clone():source[k];m.flatShading=true;m.positionNode=position;return m;});
  const picking=await createBoundedPicking(device,output,indices);
  return{route:'kaminos.deformable-surface.resident-four-split.webgpu.v0',materials:materialCopies,ownershipBuffer:vertices,pick:(origin,direction)=>picking.pick(origin,direction),captureState(){const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();device.queue.submit([encoder.finish()]);},async readPositions(){const read=device.createBuffer({size:output.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(output,0,read,0,output.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange());return(indexed?Array.from({length:count},(_,i)=>i):indices).map(i=>Array.from(values.slice(i*4,i*4+3)));}finally{read.destroy();}},dispose(){disposeAll([()=>picking.dispose(),...materialCopies.map(m=>()=>m.dispose()),()=>{if(renderer.backend.get(indexAttribute).buffer)renderer.backend.destroyAttribute(indexAttribute);},()=>renderer.backend.delete(outputAttribute),...owned.map(b=>()=>b.destroy())],'Bounded surface cleanup failed');},bytes:{ownership:bytes.byteLength,pose:output.size,renderIndices:indices.length*4}};
 }catch(e){disposeAll([...materialCopies.map(m=>()=>m.dispose()),...owned.map(b=>()=>b.destroy())],'Bounded surface initialization failed',e);}
}
