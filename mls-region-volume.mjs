// Compact measurements of material in raster-shaped, extruded regions. Read
// back one count per region, not the entire APIC particle buffer.
export async function createMlsRegionVolume({device,solver,query,isCurrent=()=>true}){
 const q=structuredClone(query),owned=[],U=GPUBufferUsage;
 if(!Number.isSafeInteger(q.width)||q.width<1||!Number.isSafeInteger(q.height)||q.height<1||q.labels?.length!==q.width*q.height||!q.regions?.length||q.labels.some(n=>!Number.isSafeInteger(n)||n<0||n>q.regions.length)||q.worldToLocal?.length!==16||!q.worldToLocal.every(Number.isFinite)||!Number.isFinite(q.pitch)||q.pitch<=0||!Number.isFinite(q.minY)||!Number.isFinite(q.maxY)||q.minY>=q.maxY)throw Error('Invalid water region query');
 let disposed=false,pending=null;
 const buffer=(size,usage,label)=>{const b=device.createBuffer({size,usage,label});owned.push(b);return b;};
 try{
  const labels=buffer(q.labels.length*4,U.STORAGE|U.COPY_DST,'Water region labels'),params=buffer(112,U.UNIFORM|U.COPY_DST,'Water region frame'),counts=buffer(q.regions.length*4,U.STORAGE|U.COPY_SRC|U.COPY_DST,'Water region counts'),output=buffer(q.regions.length*4,U.MAP_READ|U.COPY_DST,'Water region count readback');
  device.queue.writeBuffer(labels,0,new Uint32Array(q.labels));
  const code=`struct Params { frame:mat4x4f, domain:vec4f, shape:vec4f, limits:vec4u }
  @group(0) @binding(0) var<storage,read> particles:array<f32>;
  @group(0) @binding(1) var<storage,read> labels:array<u32>;
  @group(0) @binding(2) var<storage,read_write> counts:array<atomic<u32>>;
  @group(0) @binding(3) var<uniform> p:Params;
  @compute @workgroup_size(64) fn measure(@builtin(global_invocation_id) id:vec3u){
   let i=id.x*20u;if(i+3u>=arrayLength(&particles)||particles[i+3u]<=0.){return;}
   let world=vec3f(particles[i],particles[i+1u],particles[i+2u])*p.domain.w+p.domain.xyz;
   let local=(p.frame*vec4f(world,1.)).xyz;
   if(local.y<p.shape.y||local.y>=p.shape.z){return;}
   let cell=vec2i(floor(local.xz/p.shape.x+vec2f(f32(p.limits.x),f32(p.limits.y))*.5));
   if(any(cell<vec2i(0))||cell.x>=i32(p.limits.x)||cell.y>=i32(p.limits.y)){return;}
   let region=labels[u32(cell.y)*p.limits.x+u32(cell.x)];
   if(region>0u&&region<=p.limits.z){atomicAdd(&counts[region-1u],1u);}
  }`;
  const module=device.createShaderModule({label:'MLS region volume',code}),errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
  if(errors.length)throw Error(errors.map(e=>e.message).join('; '));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'measure'}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[solver.particles,labels,counts,params].map((b,binding)=>({binding,resource:{buffer:b}}))});
  const active=()=>{if(disposed||!isCurrent())throw Error('Water region measurement belongs to a retired simulation');if(solver.read().failure)throw Error(solver.read().failure);};
  return {measure(){
   active();if(pending)return pending;
   const bytes=new ArrayBuffer(112),f=new Float32Array(bytes);f.set(q.worldToLocal);f.set([...solver.config.min,solver.config.cell],16);f.set([q.pitch,q.minY,q.maxY,0],20);new Uint32Array(bytes,96,4).set([q.width,q.height,q.regions.length,0]);
   device.queue.writeBuffer(params,0,bytes);
   const step=solver.read().clock.step,encoder=device.createCommandEncoder({label:'Measure water in letter cavities'});encoder.clearBuffer(counts);
   const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(solver.config.capacity/64));pass.end();encoder.copyBufferToBuffer(counts,0,output,0,q.regions.length*4);device.queue.submit([encoder.finish()]);
   pending=output.mapAsync(GPUMapMode.READ).then(()=>{const result=Array.from(new Uint32Array(output.getMappedRange()));output.unmap();active();return {counts:result,particleVolume:solver.config.cell**3/solver.config.restDensity,step};}).finally(()=>pending=null);
   return pending;
  },dispose(){if(disposed)return;disposed=true;for(const b of owned)b.destroy();}};
 }catch(e){for(const b of owned)b.destroy();throw e;}
}
