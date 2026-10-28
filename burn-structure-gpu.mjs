import * as THREE from './lib/three.webgpu.js';
import {LOG_RESIDUE,LOG_MATERIAL_EPSILON} from './log-consumption.mjs';
import {BURN_STRUCTURE_IDENTITY} from './burn-structure-core.mjs';

export const BURN_SECTION_WGSL=`
struct Cell {material:vec4f,burn:vec4f}
struct Sample {cell:u32,area:f32}
@group(0) @binding(0) var<storage,read> cells:array<Cell>;
@group(0) @binding(1) var<storage,read> spans:array<vec2u>;
@group(0) @binding(2) var<storage,read> samples:array<Sample>;
@group(0) @binding(3) var<storage,read_write> sections:array<vec4f>;
@group(0) @binding(4) var image:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(64)
fn reduce(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&spans)){return;}
 let span=spans[i];var area=0.0;var remaining=0.0;
 for(var s=span.x;s<span.x+span.y;s++){
  let sample=samples[s];let fuel=cells[sample.cell].burn.y;
  area+=sample.area;remaining+=sample.area*select(0.0,clamp((fuel-${LOG_RESIDUE})/(1.0-${LOG_RESIDUE}),0.0,1.0),fuel>${LOG_RESIDUE}+${LOG_MATERIAL_EPSILON});
 }
 var value=vec4f(0.0);if(area>0.0){value=vec4f(remaining/area,remaining,area,1.0);}
 sections[i]=value;textureStore(image,vec2i(i32(i),0),value);
}`;

export async function createBurnStructureGpu({renderer,field,prepared,mapping,sourceMaterials}){
 const device=field.device,count=mapping.connections.length,owned=[];let disposed=false,steps=0,cache=new WeakMap();
 const own=x=>{owned.push(x);return x;};
 let overlay,wrapper;
 function dispose(){if(disposed)return;disposed=true;overlay?.removeFromParent();overlay?.geometry.dispose();overlay?.material.dispose();if(wrapper){delete renderer.backend.get(wrapper).texture;wrapper.dispose();}for(const x of owned)x.destroy();}
 try{
  const module=device.createShaderModule({label:'Resident burn section reduction',code:BURN_SECTION_WGSL});
  const errors=(await module.getCompilationInfo()).messages.filter(x=>x.type==='error');if(errors.length)throw Error(errors.map(x=>x.message).join('; '));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'reduce'}});
  const upload=(label,data)=>{const b=own(device.createBuffer({label,size:Math.max(8,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));if(data.byteLength)device.queue.writeBuffer(b,0,data);return b;};
  const spans=upload('Original material section spans',mapping.spans),samplesData=new ArrayBuffer(Math.max(1,mapping.cells.length)*8),u=new Uint32Array(samplesData),f=new Float32Array(samplesData);
  for(let i=0;i<mapping.cells.length;i++){u[i*2]=mapping.cells[i];f[i*2+1]=mapping.areas[i];}
  const samples=upload('Section to original material cells',new Uint8Array(samplesData));
  const output=own(device.createBuffer({label:'Remaining load-bearing sections',size:Math.max(1,count)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}));
  const texture=own(device.createTexture({label:'Remaining section preview',size:[Math.max(1,count),1],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}));
  wrapper=new THREE.ExternalTexture(texture);wrapper.type=THREE.FloatType;wrapper.format=THREE.RGBAFormat;wrapper.colorSpace=THREE.NoColorSpace;wrapper.minFilter=wrapper.magFilter=THREE.NearestFilter;
  const geometry=new THREE.CylinderGeometry(.004,.004,1,5),material=new THREE.MeshBasicNodeMaterial({depthTest:false,depthWrite:false});
  const health=THREE.TSL.textureLoad(wrapper,THREE.TSL.ivec2(THREE.TSL.instanceIndex.toInt(),0));
  material.colorNode=THREE.TSL.mix(THREE.TSL.vec3(1,.08,.01),THREE.TSL.vec3(.1,.8,.35),health.x).mul(health.w);
  overlay=new THREE.InstancedMesh(geometry,material,count);overlay.name='Structural connection inspection';overlay.userData.kaminosEditorHelper=true;overlay.frustumCulled=false;overlay.renderOrder=100;overlay.raycast=()=>{};
  const a=new THREE.Vector3(),b=new THREE.Vector3(),q=new THREE.Quaternion(),matrix=new THREE.Matrix4();
  prepared.bonds.forEach((bond,i)=>{a.fromArray(prepared.cells[bond.a].position);b.fromArray(prepared.cells[bond.b].position);const length=a.distanceTo(b);q.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());matrix.compose(a.add(b).multiplyScalar(.5),q,new THREE.Vector3(1,length,1));overlay.setMatrixAt(i,matrix);});
  overlay.instanceMatrix.needsUpdate=true;
  const cold=new Float32Array(Math.max(1,count)*4);for(let i=0;i<count;i++){let area=0;const start=mapping.spans[i*2];for(let j=start;j<start+mapping.spans[i*2+1];j++)area+=mapping.areas[j];cold.set([area?1:0,area,area,area?1:0],i*4);}
  device.queue.writeTexture({texture},cold,{bytesPerRow:Math.max(1,count)*16},[Math.max(1,count),1]);
  device.queue.writeBuffer(output,0,cold);
  function encode(encoder){if(disposed)throw Error('Burn structure is disposed');if(!count)return;const buffer=field.residentState().after;let group=cache.get(buffer);
    if(!group){group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}},{binding:1,resource:{buffer:spans}},{binding:2,resource:{buffer:samples}},{binding:3,resource:{buffer:output}},{binding:4,resource:texture.createView()}]});cache.set(buffer,group);}
    const pass=encoder.beginComputePass({label:'Burn material remaining at structural sections'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();steps++;
  }
  const initialEncoder=device.createCommandEncoder({label:'Current material structural sections'});encode(initialEncoder);device.queue.submit([initialEncoder.finish()]);
  return {overlay,encode,
   resident:()=>({device,buffer:output,count,mapping,prepared,sourceMaterials}),
   read:()=>({identity:BURN_STRUCTURE_IDENTITY,status:disposed?'disposed':'resident',steps,regions:prepared.cells.length,connections:count,source:'original-resident-fuel',runtimeReadbacks:0,receipt:mapping.receipt}),
   async snapshot(){if(disposed)throw Error('Burn structure is disposed');if(!count)return {identity:BURN_STRUCTURE_IDENTITY,sections:[]};
    const staging=device.createBuffer({size:output.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(output,0,staging,0,output.size);device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);const values=new Float32Array(staging.getMappedRange()).slice();return {identity:BURN_STRUCTURE_IDENTITY,steps,sections:mapping.connections.map((c,i)=>({...c,fraction:values[i*4+3]?values[i*4]:null,remainingArea:values[i*4+1],sampledArea:values[i*4+2],mapped:values[i*4+3]===1})),mapping:{...mapping,cells:Array.from(mapping.cells),areas:Array.from(mapping.areas),spans:Array.from(mapping.spans)}};}finally{staging.unmap();staging.destroy();}
   },dispose};
 }catch(error){dispose();throw error;}
}
