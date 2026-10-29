// Adapter for the shared proxy consumer. These are particle samples with an
// explicit placeholder normal, not a reconstructed fluid interface claim.
export async function createMlsWaterProxy(device,solver){
 const U=GPUBufferUsage,c=solver.config,owned=[];
 const buffer=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
 const records=buffer(c.capacity*80,U.STORAGE|U.COPY_SRC),counters=buffer(16,U.STORAGE|U.COPY_SRC|U.COPY_DST),world=buffer(32,U.UNIFORM|U.COPY_DST);
 device.queue.writeBuffer(world,0,new Float32Array([...c.min,c.cell,c.modelSecondsPerSecond,c.particleRadius,0,0]));
 try{
  const module=device.createShaderModule({code:`
   struct Particle{position:vec3f,life:f32,v:vec3f,C:mat3x3f}
   struct Record{position:vec4f,velocity:vec4f,normal:vec4f,thickness:vec4f,age:vec4f}
   struct World{domain:vec4f,params:vec4f}
   @group(0) @binding(0) var<storage,read> particles:array<Particle>;
   @group(0) @binding(1) var<storage,read_write> records:array<Record>;
   @group(0) @binding(2) var<storage,read_write> count:atomic<u32>;
   @group(0) @binding(3) var<uniform> world:World;
   @compute @workgroup_size(64) fn proxy(@builtin(global_invocation_id) id:vec3u){
    if(id.x>=arrayLength(&particles)){return;}let p=particles[id.x];if(p.life<=0.){return;}
    let slot=atomicAdd(&count,1u);
    records[slot]=Record(vec4f(world.domain.xyz+p.position*world.domain.w,f32(id.x)),vec4f(p.v*world.domain.w*world.params.x,1),vec4f(0,1,0,0),vec4f(world.params.y*2.,0,0,0),vec4f(0));
   }`});
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'proxy'}});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[solver.particles,records,counters,world].map((buffer,binding)=>({binding,resource:{buffer}}))});
  let tick=-1;
  return {descriptor(){const step=solver.read().clock.step;if(step!==tick){
    const encoder=device.createCommandEncoder({label:'MLS shared particle proxy'});encoder.clearBuffer(counters);
    const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(c.capacity/64));pass.end();device.queue.submit([encoder.finish()]);tick=step;
   }
   return {schema:'kaminos.mls-particle-proxy.v1',device,recordsBuffer:records,countersBuffer:counters,capacity:c.capacity,recordFloats:20,recordBytes:80,counterBytes:16,activeCountCounterIndex:0,
    fields:{positionId:0,velocityConfidence:4,normalCurvature:8,thicknessContactWetnessMaterial:12,stabilityAgeSource:16},visibleParticleRadius:c.particleRadius,writeTick:step,stepSeconds:c.dt,writeStage:'mls-particle-proxy-normal-up'};
  },dispose(){for(const b of owned)b.destroy();}};
 }catch(error){for(const b of owned)b.destroy();throw error;}
}
