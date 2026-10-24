const SCHEMA='kaminos.finger-fluid.interface-record-descriptor.v0';
const SHADER=`
struct Probe { sphere:vec4f, recordInfo:vec4u, dispatch:vec4u }
@group(0) @binding(0) var<storage,read> records:array<f32>;
@group(0) @binding(1) var<storage,read> counters:array<u32>;
@group(0) @binding(2) var<uniform> probe:Probe;
@group(0) @binding(3) var<storage,read_write> result:array<atomic<u32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 let population=counters[probe.recordInfo.y];
 let index=id.y*probe.dispatch.x+id.x;
 if(index==0u){atomicStore(&result[0],population);}
 if(index>=min(population,probe.recordInfo.x)){return;}
 let at=index*probe.recordInfo.z+probe.recordInfo.w;
 let p=vec3f(records[at],records[at+1u],records[at+2u]);
 if(distance(p,probe.sphere.xyz)<=probe.sphere.w){atomicAdd(&result[1],1u);}
}`;

export function validateWaterInterface(d,device=d?.device){
 if(d?.schema!==SCHEMA||!d.device||d.device!==device||!d.recordsBuffer||!d.countersBuffer)throw Error('Water exposure requires the current producer GPU interface');
 if(d.recordFloats!==20||d.recordBytes!==80||d.fields?.positionId!==0||d.activeCountCounterIndex!==0||d.writeStage!=='compacted-after-velocity-update-each-step')throw Error('Unsupported water interface layout');
 for(const key of ['capacity','generation','step','writeTick'])if(!Number.isSafeInteger(d[key])||d[key]<(key==='capacity'?1:0))throw Error('Invalid water interface '+key);
 if(!Number.isFinite(d.visibleParticleRadius)||d.visibleParticleRadius<0||d.counterBytes<4)throw Error('Invalid water interface dimensions');
 return d;
}

// Borrow the entire compacted population. Only two counters cross back to CPU;
// the producer retains ownership of every particle and its simulation clock.
export async function createWaterExposure({descriptor}){
 const first=validateWaterInterface(descriptor()),device=first.device;
 const module=device.createShaderModule({code:SHADER,label:'lerms-water-overlap'});
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
 const uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const result=device.createBuffer({size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
 const readback=device.createBuffer({size:8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 let closed=false,pending=null;
 async function run({center,radius}){
  if(closed)throw Error('Water exposure is disposed');
  if(!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0)throw Error('Water receiver requires a finite sphere');
  const d=validateWaterInterface(descriptor(),device),groups=Math.ceil(d.capacity/64),width=Math.min(groups,device.limits.maxComputeWorkgroupsPerDimension),height=Math.ceil(groups/width);
  if(height>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Water population exceeds GPU dispatch capacity');
  const data=new ArrayBuffer(48);new Float32Array(data,0,4).set([...center,radius+d.visibleParticleRadius]);new Uint32Array(data,16,8).set([d.capacity,d.activeCountCounterIndex,d.recordFloats,d.fields.positionId,width*64,0,0,0]);
  device.queue.writeBuffer(uniform,0,data);
  const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[d.recordsBuffer,d.countersBuffer,uniform,result].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const encoder=device.createCommandEncoder();encoder.clearBuffer(result);const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);pass.dispatchWorkgroups(width,height);pass.end();encoder.copyBufferToBuffer(result,0,readback,0,8);device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const [active,overlap]=new Uint32Array(readback.getMappedRange()).slice();readback.unmap();
  if(closed)return {status:'disposed'};
  const current=validateWaterInterface(descriptor(),device);
  if(current.generation!==d.generation||current.recordsBuffer!==d.recordsBuffer||current.countersBuffer!==d.countersBuffer)return {status:'superseded',generation:d.generation};
  if(active>d.capacity||overlap>active)throw Error('Water interface count exceeds its declared population');
  return {status:'observed',source:'gpu-interface-sphere-overlap',generation:d.generation,step:d.step,writeTick:d.writeTick,active,overlap,center:[...center],radius,particleRadius:d.visibleParticleRadius,capacity:d.capacity};
 }
 return {
  sample(input){if(pending)throw Error('Water exposure sample is already pending');pending=run(input);return pending.finally(()=>{pending=null;});},
  async dispose(){if(closed)return;closed=true;try{await pending;}finally{uniform.destroy();result.destroy();readback.destroy();}},
 };
}
