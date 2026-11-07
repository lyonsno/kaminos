import {VOLUME_KERNELS,SURFACE_KERNELS,ROCK_PICK_KERNEL} from './volume-kernels.mjs';
import {packVolumeBodies,PARTICLE_WORDS,BODY_WORDS} from './volume-model.mjs';

export async function createVolumeGPU({device,model,display={}}){
 const U=GPUBufferUsage,c=model.config,packed=packVolumeBodies(model.bodies),owned=[],kernels={},count=model.particles.length/PARTICLE_WORDS,cells=c.dimensions.reduce((n,v)=>n*v,1);
 const cubeCount=c.dimensions.map(v=>v-1).reduce((n,v)=>n*v,1),maxVertices=cubeCount*36;
 let disposed=false,failure=null,steps=model.runtime?.steps??0,completedSteps=steps,pending=Promise.resolve(),busy=false,driveHeight=model.runtime?.driveHeight??0,driveRate=model.runtime?.driveRate??0,impulse=null;
 const errors=event=>{failure=event.error?.message||String(event.error);};device.addEventListener('uncapturederror',errors);
 const buffer=(data,usage,label)=>{
  const size=typeof data==='number'?data:data.byteLength;
  if(size>device.limits.maxBufferSize||(usage&U.STORAGE)&&size>device.limits.maxStorageBufferBindingSize)throw Error(label+' exceeds effective device limits');
  const b=device.createBuffer({size:Math.max(4,size),usage,label});owned.push(b);if(typeof data!=='number')device.queue.writeBuffer(b,0,data);return b;
 };
 const storage=(data,label)=>buffer(data,U.STORAGE|U.COPY_DST|U.COPY_SRC,label);
 const uniform=(data,label)=>buffer(data,U.UNIFORM|U.COPY_DST,label);
 const resources={particles:storage(model.particles,'Hill volume material samples'),cells:storage(cells*16,'Hill temporary APIC grid'),bodies:storage(packed.body,'Hill volume rigid state'),planes:storage(packed.planes,'Hill local rock planes'),triangles:storage(packed.triangles,'Hill finite contact triangles'),convexData:storage(packed.convex,'Hill convex contact features'),reactions:storage(model.bodies.length*32,'Hill reciprocal rigid impulses'),params:uniform(new Float32Array(28),'Hill material step'),
  soilPositions:display.soilPositions??storage(maxVertices*16,'Hill soil surface positions'),soilNormals:display.soilNormals??storage(maxVertices*16,'Hill soil surface normals'),indirect:display.indirect??buffer(new Uint32Array([0,1,0,0]),U.STORAGE|U.INDIRECT|U.COPY_DST|U.COPY_SRC,'Hill soil draw count'),
  rockPositions:display.rockPositions??storage(packed.vertices.byteLength,'Hill moving rock positions'),rockNormals:display.rockNormals??storage(packed.vertices.byteLength,'Hill moving rock normals'),localVertices:storage(packed.vertices,'Hill retained source vertices'),vertexBodies:storage(packed.vertexBodies,'Hill source vertex ownership'),
  origin:uniform(new Float32Array([...c.origin,c.cell]),'Hill source origin'),shape:uniform(new Uint32Array([...c.dimensions,0]),'Hill source grid extent'),material:uniform(new Float32Array([c.density,.35,0,0]),'Hill surface occupancy'),pickRay:uniform(new Float32Array(8),'Hill pointer ray'),pickHit:storage(32,'Hill pointer hit')};
 const make=async(code,entry,bindings)=>{
  const module=device.createShaderModule({label:'Hill volume '+entry,code});const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');
  if(errors.length)throw Error(entry+': '+errors.map(m=>m.message).join('; '));
  const pipeline=await device.createComputePipelineAsync({label:'Hill volume '+entry,layout:'auto',compute:{module,entryPoint:entry}});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(([binding,name])=>({binding,resource:{buffer:resources[name]}}))});return{pipeline,group};
 };
 const dispatch=(e,k,n)=>{const p=e.beginComputePass();p.setPipeline(k.pipeline);p.setBindGroup(0,k.group);p.dispatchWorkgroups(Math.ceil(n/64));p.end();};
 const draw=e=>{e.clearBuffer(resources.cells);dispatch(e,kernels.p2g,count);e.clearBuffer(resources.indirect);dispatch(e,kernels.surface,cubeCount);dispatch(e,kernels.rock,packed.vertices.length/4);};
 const params=(height,rate,action)=>{const a=new Float32Array(28),u=new Uint32Array(a.buffer);a.set([...c.origin,c.cell]);u.set([...c.dimensions,model.bodies.length],4);a.set([c.bulk,c.shear,c.friction,c.density,c.dt,c.gravity,c.contactFriction,0],8);if(action){if(action.kind==='rock'){a.set([...action.velocity,action.index+1],20);if(action.point)a.set([...action.point,1],16);}else{a.set([...action.center,action.radius],16);a.set([...action.velocity,0],20);}}a.set([height,rate,0,0],24);return a;};
 try{
  kernels.p2g=await make(VOLUME_KERNELS,'p2g',[[0,'particles'],[1,'cells'],[6,'params']]);
  kernels.grid=await make(VOLUME_KERNELS,'grid',[[1,'cells'],[2,'bodies'],[3,'planes'],[4,'triangles'],[5,'reactions'],[6,'params']]);
  kernels.g2p=await make(VOLUME_KERNELS,'g2p',[[0,'particles'],[1,'cells'],[2,'bodies'],[3,'planes'],[4,'triangles'],[5,'reactions'],[6,'params']]);
  kernels.rigid=await make(VOLUME_KERNELS,'rigid',[[2,'bodies'],[3,'planes'],[5,'reactions'],[6,'params'],[7,'convexData']]);
  kernels.pick=await make(ROCK_PICK_KERNEL,'pick_rock',[[2,'bodies'],[3,'planes'],[8,'pickRay'],[9,'pickHit']]);
  kernels.kick=await make(VOLUME_KERNELS,'kick',[[2,'bodies'],[6,'params']]);
  kernels.surface=await make(SURFACE_KERNELS,'surface',[[0,'cells'],[1,'soilPositions'],[2,'soilNormals'],[3,'indirect'],[4,'origin'],[5,'shape'],[6,'material']]);
  kernels.rock=await make(SURFACE_KERNELS,'rock_surface',[[1,'rockPositions'],[2,'rockNormals'],[7,'bodies'],[8,'localVertices'],[9,'vertexBodies']]);
  device.queue.writeBuffer(resources.params,0,params(driveHeight,driveRate));const first=device.createCommandEncoder();draw(first);device.queue.submit([first.finish()]);await device.queue.onSubmittedWorkDone();if(failure)throw Error(failure);
  function advance(n){
   if(disposed||failure)throw Error(failure||'Material specimen disposed');if(busy)throw Error('Material batch still pending');if(!Number.isSafeInteger(n)||n<0)throw Error('Choose a nonnegative physical step count');
   if(!n)return pending;
   const bytes=new Float32Array(n*28);for(let i=0;i<n;i++){driveHeight+=driveRate*c.dt;bytes.set(params(driveHeight,driveRate,i===0?impulse:null),i*28);}impulse=null;
   const upload=device.createBuffer({size:bytes.byteLength,usage:U.COPY_SRC,mappedAtCreation:true});new Float32Array(upload.getMappedRange()).set(bytes);upload.unmap();
   const encoder=device.createCommandEncoder({label:'Hill volume physical batch'});
   for(let i=0;i<n;i++){
    encoder.copyBufferToBuffer(upload,i*112,resources.params,0,112);encoder.clearBuffer(resources.cells);encoder.clearBuffer(resources.reactions);
    const kick=encoder.beginComputePass();kick.setPipeline(kernels.kick.pipeline);kick.setBindGroup(0,kernels.kick.group);kick.dispatchWorkgroups(1);kick.end();
    dispatch(encoder,kernels.p2g,count);dispatch(encoder,kernels.grid,cells);dispatch(encoder,kernels.g2p,count);
    const p=encoder.beginComputePass();p.setPipeline(kernels.rigid.pipeline);p.setBindGroup(0,kernels.rigid.group);p.dispatchWorkgroups(1);p.end();
   }
   draw(encoder);device.queue.submit([encoder.finish()]);steps+=n;busy=true;
   pending=device.queue.onSubmittedWorkDone().then(()=>{if(failure)throw Error(failure);completedSteps=steps;}).catch(e=>{failure=String(e);throw e;}).finally(()=>{busy=false;upload.destroy();});return pending;
  }
  async function snapshot(){
   await pending;if(disposed)throw Error('Material specimen disposed');const lengths=[model.particles.byteLength,packed.body.byteLength,16],buffers=lengths.map((n,i)=>buffer(n,U.COPY_DST|U.MAP_READ,'Hill explicit diagnostic '+i));
   try{const e=device.createCommandEncoder();[resources.particles,resources.bodies,resources.indirect].forEach((b,i)=>e.copyBufferToBuffer(b,0,buffers[i],0,lengths[i]));device.queue.submit([e.finish()]);await Promise.all(buffers.map(b=>b.mapAsync(GPUMapMode.READ)));
    const data=buffers.map(b=>b.getMappedRange().slice(0));const particles=new Float32Array(data[0]),bodies=new Float32Array(data[1]),indirect=new Uint32Array(data[2]);
    // Body shape directory occupies u32 words and is not floating-point state.
    if(!particles.every(Number.isFinite)||!bodies.every((v,i)=>i%BODY_WORDS>=28&&i%BODY_WORDS<32||Number.isFinite(v)))throw Error('Non-finite material state');
    return{particles,bodies,indirect,identity:read()};
   }finally{for(const b of buffers){b.destroy();owned.splice(owned.indexOf(b),1);}}
  }
  const read=()=>({route:'hill/direct-volume-apic-frictional-v1',backend:'webgpu',steps,completedSteps,seconds:completedSteps*c.dt,busy,failure,particleCount:count,bodyCount:model.bodies.length,gridCells:cells,config:c,drive:{height:driveHeight,rate:driveRate},weatheredMass:model.weatheredMass,readbackInRuntime:false,
   material:'rate-form hypoelastic; no tension; Frobenius deviator yield <= friction*pressure',contact:'reciprocal soil/rigid; full convex SAT against anchored volumes; one released body; general free/free pile unresolved',conditioning:model.conditioning,surface:'GPU mass occupancy isosurface; 6 tetrahedra per cell; indirect draw',gpuBufferBytes:[...new Set(Object.values(resources))].reduce((n,b)=>n+b.size,0),maxSurfaceVertices:maxVertices});
  let picking=Promise.resolve();
  function pickRay(origin,direction){
   if(![origin,direction].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||Math.hypot(...direction)===0)return Promise.reject(Error('Invalid pointer ray'));
   const o=[...origin],len=Math.hypot(...direction),d=direction.map(v=>v/len);
   const task=picking.then(async()=>{await pending;if(disposed)throw Error('Material specimen disposed');const rb=buffer(32,U.COPY_DST|U.MAP_READ,'Hill pointer acquisition');
    try{device.queue.writeBuffer(resources.pickRay,0,new Float32Array([...o,0,...d,0]));const e=device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(kernels.pick.pipeline);p.setBindGroup(0,kernels.pick.group);p.dispatchWorkgroups(1);p.end();e.copyBufferToBuffer(resources.pickHit,0,rb,0,32);device.queue.submit([e.finish()]);await rb.mapAsync(GPUMapMode.READ);const h=new Float32Array(rb.getMappedRange());return h[0]>0?{rock:h[0]-1,distance:h[1],released:h[2]===1,point:Array.from(h.slice(4,7))}:null;}finally{rb.destroy();owned.splice(owned.indexOf(rb),1);}
   });picking=task.catch(()=>{});return task;
  }
  return{resources,advance,snapshot,read,pickRay,done:()=>Promise.all([pending,picking]),
   release(index){if(!Number.isInteger(index)||!model.bodies[index])throw Error('Choose a represented rock');if(c.conditionContacts===false)throw Error('Unconditioned authored poses overlap; enable starting contact preparation before release');if(model.bodies.some((b,i)=>i!==index&&!b.anchored))throw Error('This specimen supports one released rock against anchored volumes; reset before releasing another');const b=model.bodies[index];b.anchored=false;device.queue.writeBuffer(resources.bodies,index*BODY_WORDS*4+12,new Float32Array([1/b.mass]));},
   push(action){if(!action||![action.center,action.velocity].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||!Number.isFinite(action.radius)||action.radius<=0)throw Error('Invalid material impulse');impulse=structuredClone(action);},
   pushRock(index,velocity,point){if(!Number.isInteger(index)||!model.bodies[index]||model.bodies[index].anchored||!Array.isArray(velocity)||velocity.length!==3||!velocity.every(Number.isFinite))throw Error('Choose the released rock and a finite velocity impulse');if(point!==undefined&&(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)))throw Error('Invalid contact point');impulse={kind:'rock',index,velocity:[...velocity],...(point?{point:[...point]}:{})};},
   setDrive(rate){if(!Number.isFinite(rate))throw Error('Invalid growth velocity');driveRate=rate;},
   async synchronizeModel(){const s=await snapshot();model.particles=s.particles;model.runtime={steps:completedSteps,driveHeight,driveRate};model.bodies.forEach((b,i)=>{const j=i*BODY_WORDS;b.position=Array.from(s.bodies.slice(j,j+3));b.rotation=Array.from(s.bodies.slice(j+4,j+8));b.velocity=Array.from(s.bodies.slice(j+8,j+11));b.omega=Array.from(s.bodies.slice(j+12,j+15));b.restPosition=Array.from(s.bodies.slice(j+36,j+39));});return model;},
   dispose(){if(disposed)return;disposed=true;device.removeEventListener('uncapturederror',errors);owned.forEach(b=>b.destroy());}
  };
 }catch(e){device.removeEventListener('uncapturederror',errors);owned.forEach(b=>b.destroy());throw e;}
}
