import {StorageBufferAttribute,MeshStandardNodeMaterial} from 'three/webgpu';
import {storage,vertexIndex} from 'three/tsl';
import {BOUNDED_FRAGMENT_ROUTE} from './structural-material-bounded-fragments.mjs';

export const boundedSurfaceWgsl=`
struct Point{rest:vec4f,position:vec4f,velocity:vec4f,predicted:vec4f};
struct CellVertex{ids:vec4u,edges:vec4u,tail:vec4u,meta:vec4u,rest:vec4f};
@group(0) @binding(0) var<storage,read> points:array<Point>;
@group(0) @binding(1) var<storage,read> bonds:array<vec4u>;
@group(0) @binding(2) var<storage,read> vertices:array<CellVertex>;
@group(0) @binding(3) var<storage,read_write> output:array<vec4f>;
@compute @workgroup_size(64) fn update(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&vertices)){return;}let v=vertices[i];var reached=1u<<v.meta.y;let pairs=array<vec2u,6>(vec2u(0,1),vec2u(0,2),vec2u(0,3),vec2u(1,2),vec2u(1,3),vec2u(2,3));
 for(var sweep=0u;sweep<4u;sweep++){for(var k=0u;k<6u;k++){var edge=v.tail[k%4u];if(k<4u){edge=v.edges[k];}if(edge==0xffffffffu){continue;}let pair=pairs[k];if(bonds[edge].z==1u&&((reached&(1u<<pair.x))!=0u||(reached&(1u<<pair.y))!=0u)){reached|=(1u<<pair.x)|(1u<<pair.y);}}}
 var displacement=vec3f(0);var count=0.0;for(var j=0u;j<v.meta.x;j++){if((reached&(1u<<j))!=0u){let p=points[v.ids[j]];displacement+=p.position.xyz-p.rest.xyz;count+=1.0;}}
 output[i]=vec4f(v.rest.xyz+displacement/count,1);
}`;

export async function createGpuBoundedSurface(renderer,resident,binding,indices,materials){
 if(binding?.route!==BOUNDED_FRAGMENT_ROUTE||!binding.fixedCellShell||!renderer.backend.isWebGPUBackend||renderer.backend.device!==resident.device)throw new Error('Fixed cell shell and shared native device required');
 const device=resident.device,count=binding.entries.length,bytes=new ArrayBuffer(count*80),u=new Uint32Array(bytes),f=new Float32Array(bytes);
 binding.entries.forEach((e,i)=>{const base=i*20;if(!e.subset?.length||e.subset.length>4||e.edgeIds?.length!==6||!e.rest.every(Number.isFinite))throw new Error('Complete local cell ownership required');u.set([...e.subset,...Array(4-e.subset.length).fill(e.anchor)],base);u.set(e.edgeIds.slice(0,4),base+4);u.set([e.edgeIds[4],e.edgeIds[5],0xffffffff,0xffffffff],base+8);u.set([e.subset.length,e.subset.indexOf(e.anchor),0,0],base+12);f.set([...e.rest,1],base+16);});
 const owned=[],allocate=(label,size,usage)=>{if(size>device.limits.maxStorageBufferBindingSize)throw new Error(`${label} exceeds effective device capacity`);const b=device.createBuffer({label,size,usage});owned.push(b);return b;};let outputAttribute,indexAttribute,materialCopies=[];
 try{
  const vertices=allocate('bounded local visual ownership',bytes.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),output=allocate('bounded visual pose',count*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);device.queue.writeBuffer(vertices,0,bytes);
  const module=device.createShaderModule({code:boundedSurfaceWgsl}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(info.messages));const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'update'}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[resident.stateBuffer(),resident.bondBuffer(),vertices,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
  outputAttribute=new StorageBufferAttribute(new Float32Array(count*4),4);renderer.backend.get(outputAttribute).buffer=output;indexAttribute=new StorageBufferAttribute(Uint32Array.from(indices),1);const positions=storage(outputAttribute,'vec4',count).toReadOnly(),ids=storage(indexAttribute,'uint',indices.length).toReadOnly(),position=positions.element(ids.element(vertexIndex)).xyz;
  materialCopies=materials.map(source=>{const m=new MeshStandardNodeMaterial();for(const k of ['color','map','normalMap','normalScale','normalMapType','roughness','roughnessMap','metalness','metalnessMap','aoMap','aoMapIntensity','emissive','emissiveMap','emissiveIntensity','side'])if(source[k]!==undefined)m[k]=source[k]?.clone&&!source[k].isTexture?source[k].clone():source[k];m.flatShading=true;m.positionNode=position;return m;});
  return{route:'kaminos.deformable-surface.resident-four-split.webgpu.v0',materials:materialCopies,captureState(){const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();device.queue.submit([encoder.finish()]);},async readPositions(){const read=device.createBuffer({size:output.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(output,0,read,0,output.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange());return indices.map(i=>Array.from(values.slice(i*4,i*4+3)));}finally{read.destroy();}},dispose(){for(const m of materialCopies)m.dispose();if(renderer.backend.get(indexAttribute).buffer)renderer.backend.destroyAttribute(indexAttribute);renderer.backend.delete(outputAttribute);for(const b of owned)b.destroy();},bytes:{ownership:bytes.byteLength,pose:output.size,renderIndices:indices.length*4}};
 }catch(e){for(const m of materialCopies)m.dispose();for(const b of owned)b.destroy();throw e;}
}
