import {validateLiquidFireContactSourceDescriptor,LIQUID_FIRE_CONTACT_MAGIC,LIQUID_FIRE_CONTACT_VERSION} from '../../liquid-fire-contact-consumer.mjs';
const SHADER=`
struct Probe { sphere:vec4f, identity:vec4u, dispatch:vec4u }
@group(0) @binding(0) var<storage,read> records:array<f32>;
@group(0) @binding(1) var<storage,read> counters:array<u32>;
@group(0) @binding(2) var<uniform> probe:Probe;
@group(0) @binding(3) var<storage,read_write> result:array<atomic<u32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 let index=id.y*probe.dispatch.x+id.x;
 if(counters[0]==0u){return;}
 let valid=counters[0]==${LIQUID_FIRE_CONTACT_MAGIC}u && counters[1]==${LIQUID_FIRE_CONTACT_VERSION}u
  && counters[2]==probe.identity.x && counters[3]==probe.identity.y && counters[7]==probe.identity.z
  && counters[5]==1u && counters[6]==1u && counters[13]==0u && counters[14]==0u
  && counters[15]==32u && counters[16]==2u && counters[12]==probe.identity.w && counters[9]<=counters[12];
 if(!valid){if(index==0u){atomicStore(&result[2],2u);}return;}
 let population=counters[9];
 if(index==0u){atomicStore(&result[0],population);atomicMax(&result[2],1u);atomicStore(&result[3],counters[4]);}
 if(index>=population){return;}
 let at=index*32u;
 if(u32(records[at+24u]+.5)!=probe.identity.x || u32(records[at+25u]+.5)!=probe.identity.y || u32(records[at+26u]+.5)!=counters[4]){atomicStore(&result[2],2u);return;}
 let p=vec3f(records[at],records[at+1u],records[at+2u]);
 let radius=records[at+11u]*.5;
 if(distance(p,probe.sphere.xyz)<=probe.sphere.w+radius){atomicAdd(&result[1],1u);}
}`;

export function validateWaterInterface(d,device=d?.device){
 validateLiquidFireContactSourceDescriptor(d,{device});
 if(d.coverage!=='active-liquid-particles'||d.volumeMeaning!=='world-volume-per-particle'||d.sourceFrameId!=='kaminos/finger-fluid-bench:gpu-simulation-frame'||d.validitySource!=='gpu_header_only_fail_closed_v0')throw Error('Water exposure requires full liquid volume in the shared simulation frame');
 for(const key of ['capacity','generation','step','writeTick'])if(!Number.isSafeInteger(d[key])||d[key]<(key==='capacity'?1:0))throw Error('Invalid water interface '+key);
 return d;
}

// Borrow the entire compacted population. Only counts and validity cross to CPU;
// the producer retains ownership of every particle and its simulation clock.
export async function createWaterExposure({descriptor}){
 const first=validateWaterInterface(descriptor()),device=first.device;
 const module=device.createShaderModule({code:SHADER,label:'lerms-water-overlap'});
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
 const uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const result=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
 const readback=device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 let closed=false,pending=null;
 async function run({center,radius}){
  if(closed)throw Error('Water exposure is disposed');
  if(!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0)throw Error('Water receiver requires a finite sphere');
  const d=validateWaterInterface(descriptor(),device),groups=Math.ceil(d.capacity/64),width=Math.min(groups,device.limits.maxComputeWorkgroupsPerDimension),height=Math.ceil(groups/width);
  if(height>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Water population exceeds GPU dispatch capacity');
  const data=new ArrayBuffer(48);new Float32Array(data,0,4).set([...center,radius]);new Uint32Array(data,16,8).set([d.allocationGeneration,d.epoch,d.sourceFrameHash,d.capacity,width*64,0,0,0]);
  device.queue.writeBuffer(uniform,0,data);
  const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[d.recordsBuffer,d.headerBuffer,uniform,result].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const encoder=device.createCommandEncoder();encoder.clearBuffer(result);const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);pass.dispatchWorkgroups(width,height);pass.end();encoder.copyBufferToBuffer(result,0,readback,0,16);device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const [active,overlap,valid,writeTick]=new Uint32Array(readback.getMappedRange()).slice();readback.unmap();
  if(closed)return {status:'disposed'};
  const current=validateWaterInterface(descriptor(),device);
  if(current.generation!==d.generation||current.allocationGeneration!==d.allocationGeneration||current.epoch!==d.epoch||current.recordsBuffer!==d.recordsBuffer||current.headerBuffer!==d.headerBuffer)return {status:'superseded',generation:d.generation};
  if(valid===0&&d.step===0)return {status:'awaiting-source',generation:d.generation};
  if(valid!==1||writeTick!==d.writeTick)throw Error('Water source header or record identity is invalid');
  if(active>d.capacity||overlap>active)throw Error('Water interface count exceeds its declared population');
  return {status:'observed',source:'gpu-liquid-volume-sphere-overlap',coverage:d.coverage,generation:d.generation,allocationGeneration:d.allocationGeneration,epoch:d.epoch,sourceFrameId:d.sourceFrameId,step:d.step,writeTick,active,overlap,center:[...center],radius,capacity:d.capacity};
 }
 return {
  sample(input){if(pending)throw Error('Water exposure sample is already pending');pending=run(input);return pending.finally(()=>{pending=null;});},
  async dispose(){if(closed)return;closed=true;try{await pending;}finally{uniform.destroy();result.destroy();readback.destroy();}},
 };
}
