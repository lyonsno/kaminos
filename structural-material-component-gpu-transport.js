import {StorageBufferAttribute,MeshStandardNodeMaterial,Vector4} from 'three/webgpu';
import {Fn,Loop,storage,uniform,uint,vec3,vec4,vertexIndex,instanceIndex,cross} from 'three/tsl';
import {COMPONENT_TRANSPORT_ROUTE} from './structural-material-component-transport.mjs';

export function packGpuTransport(binding,indices){
 if(binding?.route!==COMPONENT_TRANSPORT_ROUTE||!Array.isArray(indices)||!indices.length||!indices.every(i=>Number.isInteger(i)&&binding.entries[i]))throw new Error('Complete transport vertex correspondence required');
 const ranges=[],offsets=[],ids=[],weights=[];
 for(const i of indices){const e=binding.entries[i];if(!Array.isArray(e.ids)||!e.ids.length||e.ids.length!==e.weights?.length||new Set(e.ids).size!==e.ids.length||!e.ids.every(id=>Number.isInteger(id)&&id>=0&&id<binding.points)||!e.weights.every(w=>Number.isFinite(w)&&w>0)||Math.abs(e.weights.reduce((a,b)=>a+b,0)-1)>1e-10||!Array.isArray(e.offset)||e.offset.length!==3||!e.offset.every(Number.isFinite))throw new Error('Complete positive surface support required');
  ranges.push(ids.length,ids.length+e.ids.length);ids.push(...e.ids);weights.push(...e.weights);offsets.push(...e.offset,0);
 }
 return{ranges:new Uint32Array(ranges),offsets:new Float32Array(offsets),ids:new Uint32Array(ids),weights:new Float32Array(weights)};
}

const surfaceStates=new WeakMap();
function acquireSurfaceState(resident){
 let shared=surfaceStates.get(resident);if(!shared){const source=resident.stateBuffer(),device=resident.device,buffer=device.createBuffer({label:'published material surface pose',size:source.size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});shared={buffer,references:0,capture(){const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(resident.stateBuffer(),0,buffer,0,source.size);device.queue.submit([encoder.finish()]);}};surfaceStates.set(resident,shared);}shared.references++;
 return{buffer:shared.buffer,capture:()=>shared.capture(),release(){if(--shared.references===0){shared.buffer.destroy();surfaceStates.delete(resident);}}};
}

export function createGpuTransport(renderer,resident,binding,indices,materials){
 if(!renderer.backend.isWebGPUBackend||renderer.backend.device!==resident.device)throw new Error('Surface and material must share the effective GPU device');
 const packed=packGpuTransport(binding,indices),attributes=[],node=(data,type,size)=>{const attribute=new StorageBufferAttribute(data,size);attributes.push(attribute);return storage(attribute,type,attribute.count).toReadOnly();};
 const published=acquireSurfaceState(resident),points=new StorageBufferAttribute(new Float32Array(binding.points*16),4);
 // A GPU copy publishes a stable pose, so camera rendering need not await the next solve.
 renderer.backend.get(points).buffer=published.buffer;
 const positions=storage(points,'vec4',binding.points*4).toReadOnly(),ranges=node(packed.ranges,'uvec2',2),offsets=node(packed.offsets,'vec4',4),ids=node(packed.ids,'uint',1),weights=node(packed.weights,'float',1),quaternion=uniform(new Vector4(0,0,0,1));
 const transported=Fn(([index])=>{
  const range=ranges.element(index),offset=offsets.element(index).xyz,center=vec3(0).toVar();
  Loop({start:range.x,end:range.y,type:'uint',condition:'<'},({i})=>{center.addAssign(positions.element(ids.element(i).mul(uint(4)).add(uint(1))).xyz.mul(weights.element(i)));});
  const t=cross(quaternion.xyz,offset).mul(2);return center.add(offset).add(t.mul(quaternion.w)).add(cross(quaternion.xyz,t));
 }),position=transported(vertexIndex);
 const owned=materials.map(source=>{const material=new MeshStandardNodeMaterial();for(const key of ['color','map','normalMap','normalScale','normalMapType','roughness','roughnessMap','metalness','metalnessMap','aoMap','aoMapIntensity','emissive','emissiveMap','emissiveIntensity','side'])if(source[key]!==undefined)material[key]=source[key]?.clone&&!source[key].isTexture?source[key].clone():source[key];material.flatShading=true;material.positionNode=position;return material;});
 return{route:'kaminos.deformable-surface.resident-vertex-transport.webgpu.v0',materials:owned,captureState:published.capture,setQuaternion(q){quaternion.value.set(q.x,q.y,q.z,q.w);},async readPositions(){const attribute=new StorageBufferAttribute(new Float32Array(indices.length*4),4),output=storage(attribute,'vec4',indices.length),compute=Fn(()=>{output.element(instanceIndex).assign(vec4(transported(instanceIndex),1));})().compute(indices.length);try{await renderer.computeAsync(compute);const values=new Float32Array(await renderer.getArrayBufferAsync(attribute));return Array.from({length:indices.length},(_,i)=>Array.from(values.slice(i*4,i*4+3)));}finally{compute.dispose();if(renderer.backend.get(attribute).buffer)renderer.backend.destroyAttribute(attribute);}},dispose(){for(const material of owned)material.dispose();for(const attribute of attributes)if(renderer.backend.get(attribute).buffer)renderer.backend.destroyAttribute(attribute);renderer.backend.delete(points);published.release();},stateAttribute:points};
}
