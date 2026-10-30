// The pinned MLS producer packs position/life, velocity, and APIC state into 80 bytes.
export async function createMlsSphereQuery({device,particles,config,readSource=()=>({})}){
 const code=`
 struct Particle {position:vec3f,life:f32,rest:array<vec4f,4>}
 struct Query {sphere:vec4f,origin:vec3f,cell:f32}
 @group(0) @binding(0) var<storage,read> particles:array<Particle>;
 @group(0) @binding(1) var<uniform> query:Query;
 @group(0) @binding(2) var<storage,read_write> result:array<atomic<u32>,4>;
 @compute @workgroup_size(64) fn sample(@builtin(global_invocation_id) id:vec3u){
   if(id.x>=arrayLength(&particles)){return;}
   let p=particles[id.x];
   if(p.life<=0.){return;}
   atomicAdd(&result[0],1u);
   let world=p.position*query.cell+query.origin;
   let radius=query.sphere.w+query.cell*.65;
   if(distance(world,query.sphere.xyz)<=radius){atomicAdd(&result[1],1u);}
 }`;
 const module=device.createShaderModule({label:'MLS active liquid sphere query',code});
 const errors=(await module.getCompilationInfo()).messages.filter(x=>x.type==='error');
 if(errors.length)throw Error(errors.map(x=>x.message).join('; '));
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'sample'}});
 const U=GPUBufferUsage,uniform=device.createBuffer({size:32,usage:U.UNIFORM|U.COPY_DST});
 const result=device.createBuffer({size:16,usage:U.STORAGE|U.COPY_SRC|U.COPY_DST});
 const readback=device.createBuffer({size:16,usage:U.MAP_READ|U.COPY_DST});
 const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[particles,uniform,result].map((buffer,binding)=>({binding,resource:{buffer}}))});
 let disposed=false,tail=Promise.resolve();
 async function sample({center,radius}){
   if(disposed)throw Error('MLS sphere query disposed');
   if(!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0)throw Error('Invalid MLS world sphere');
   const source=readSource();
     device.queue.writeBuffer(uniform,0,new Float32Array([...center,radius,...config.min,config.cell]));
     const encoder=device.createCommandEncoder({label:'MLS active liquid overlap'});encoder.clearBuffer(result);
     const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(config.capacity/64));pass.end();
     encoder.copyBufferToBuffer(result,0,readback,0,16);device.queue.submit([encoder.finish()]);
     await readback.mapAsync(GPUMapMode.READ);
     const [active,overlap]=new Uint32Array(readback.getMappedRange()).slice();readback.unmap();
     if(disposed)throw Error('MLS sphere query disposed');
     return {status:'observed',active,overlap,coverage:'all-active-mls-particles',receiver:{center:[...center],radius},particleRadius:config.particleRadius,...source};
 }
 return {sample(sphere){const next=tail.then(()=>sample(sphere));tail=next.catch(()=>{});return next;},
 dispose(){if(disposed)return;disposed=true;uniform.destroy();result.destroy();readback.destroy();}};
}
