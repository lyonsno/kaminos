import {createSceneLiquidSupport,SCENE_LIQUID_COLLIDER_WGSL,SCENE_LIQUID_SUPPORT_BINDINGS_WGSL} from './scene-liquid-support.mjs';
import {mlsConfig,MLS_ROUTE,MLS_SOURCE,createMlsClock,createMlsEmissionPlan,validateMlsPacket} from './mls-juice-contract.mjs';

const boundaryFor=(config,sceneSupport)=>`
        ${sceneSupport?`var world=domain.xyz+particles[id.x].position*domain.w;
        for(var i=0u;i<sceneSupportParams.x;i++){
          let f=sceneColliderFrame(world,i);let margin=domain.w*.3;
          if(f.w<margin){world+=f.xyz*(margin-f.w);let inward=dot(particles[id.x].v,f.xyz);if(inward<0.){particles[id.x].v-=f.xyz*inward;}}
        }
        particles[id.x].position=(world-domain.xyz)/domain.w;`:''}
        ${!config.boundaryWalls?`if(any(particles[id.x].position<vec3f(2.))||any(particles[id.x].position>realBoxSize-vec3f(3.))){particles[id.x].life=0.;return;}`:''}
        particles[id.x].position=clamp(particles[id.x].position,vec3f(2.),realBoxSize-vec3f(3.));
        let offset=particles[id.x].position-obstacle.xyz;
        let distance=length(offset);
        if(obstacle.w>0.&&distance<obstacle.w+.3){
          let normal=select(vec3f(0,1,0),offset/max(distance,1e-6),distance>1e-6);
          particles[id.x].position=obstacle.xyz+normal*(obstacle.w+.3);
          particles[id.x].v-=normal*min(0.,dot(normal,particles[id.x].v));
        }
        // Sphere padding overlaps the floor; preserve the domain contact after projection.
        particles[id.x].position=clamp(particles[id.x].position,vec3f(2.),realBoxSize-vec3f(3.));
        for(var axis=0;axis<3;axis++){
          if(particles[id.x].position[axis]<=2.){particles[id.x].v[axis]=max(0.,particles[id.x].v[axis]);}
          if(particles[id.x].position[axis]>=realBoxSize[axis]-3.){particles[id.x].v[axis]=min(0.,particles[id.x].v[axis]);}
        }
        particles[id.x].life=max(0.,particles[id.x].life-physicalDt);
    }
}`;

export async function createMlsJuiceSolver({device,setup,packet,initialParticles=null,sceneColliders=null,now=()=>performance.now()}) {
  const config=mlsConfig(setup),owned=[];
  for(const size of [config.capacity*80,config.gridCells*16]){
    if(size>(device.limits?.maxStorageBufferBindingSize??Infinity)||size>(device.limits?.maxBufferSize??Infinity))throw Error('MLS domain exceeds effective device buffer limits');
  }
  if(Math.ceil(config.gridCells/64)>(device.limits?.maxComputeWorkgroupsPerDimension??Infinity))throw Error('MLS grid exceeds effective one-dimensional dispatch limit');
  const buffer=(size,usage,label)=>{const b=device.createBuffer({size,usage,label});owned.push(b);return b;};
  const U=GPUBufferUsage,clock=createMlsClock(config.dt),plan=createMlsEmissionPlan(config);
  let support=null;
  let live=validateMlsPacket(packet),paused=false,pending=false,failure=null,disposed=false,time=0;
  if(initialParticles&&(!(initialParticles instanceof Float32Array)||initialParticles.length%20||initialParticles.length>config.capacity*20||!initialParticles.every(Number.isFinite)))throw Error('Invalid native MLS initial population');
  const particles=buffer(config.capacity*80,U.STORAGE|U.COPY_DST|U.COPY_SRC,'MLS particles 80-byte APIC');
  if(initialParticles){
    device.queue.writeBuffer(particles,0,initialParticles);plan.reserveInitial(initialParticles.length/20);
  }
  const cells=buffer(config.gridCells*16,U.STORAGE|U.COPY_DST,'MLS grid');
  const densities=buffer(config.capacity*4,U.STORAGE,'MLS density');
  const uniform=(values,label)=>{const b=buffer(16,U.UNIFORM|U.COPY_DST,label);device.queue.writeBuffer(b,0,values);return b;};
  const box=uniform(new Float32Array([...config.dimensions,0]),'MLS grid extent');
  const count=uniform(new Uint32Array([config.capacity,0,0,0]),'MLS allocated slots');
  const dt=uniform(new Float32Array([config.dt*config.modelSecondsPerSecond,0,0,0]),'MLS model dt');
  const obstacle=uniform(new Float32Array(config.obstacle?[...config.obstacle.center.map((x,i)=>(x-config.min[i])/config.cell),config.obstacle.radius/config.cell]:[0,0,0,-1]),'MLS prescribed sphere');
  const domain=uniform(new Float32Array([...config.min,config.cell]),'MLS world mapping');
  const resources=[particles,cells,box,count,densities,dt,obstacle,domain];
  const make=async(code,entry,bindings,constants={})=>{
    const module=device.createShaderModule({label:`MLS ${entry}`,code});
    const messages=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(messages.length)throw Error(`MLS ${entry}: ${messages.map(m=>m.message).join('; ')}`);
    const pipeline=await device.createComputePipelineAsync({label:`MLS ${entry}`,layout:'auto',compute:{module,entryPoint:entry,constants}});
    const refresh=()=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(([binding,index])=>({binding,resource:{buffer:resources[index]}})).concat(support&&bindings.some(([binding])=>binding===7)?[{binding:12,resource:support.sampleTextureView},{binding:13,resource:{buffer:support.paramsBuffer}}]:[])});
    return {pipeline,group:refresh(),refresh};
  };
  try {
    if(sceneColliders)support=createSceneLiquidSupport(device,sceneColliders);
    const kernels=[];
    for(const name of ['p2g_1','p2g_2','g2p']){
      const response=await fetch(new URL(`./vendor/splash-mls-mpm/${name}.wgsl`,import.meta.url));
      if(!response.ok)throw Error(`MLS upstream kernel missing: ${name}`);
      let code=await response.text();
      if(!code.includes('position: vec3f,')||!code.includes('if (id.x < numParticles) {'))throw Error('MLS pinned kernel layout changed');
      code=code.replace('position: vec3f,','position: vec3f, life: f32,')
        .replace('if (id.x < numParticles) {','if (id.x < numParticles) {\n        if(particles[id.x].life<=0.){return;}');
      if(name==='g2p'){
        const end=code.indexOf('        particles[id.x].position = vec3f(');
        if(end<0)throw Error('MLS pinned G2P boundary changed');
        code=code.slice(0,end)+boundaryFor(config,support);
        if(support)code=SCENE_LIQUID_SUPPORT_BINDINGS_WGSL+SCENE_LIQUID_COLLIDER_WGSL+`@group(0) @binding(7) var<uniform> domain:vec4f;`+code;
        code=`override physicalDt:f32; @group(0) @binding(6) var<uniform> obstacle:vec4f;\n`+code;
      }
      const common={fixedPointMultiplierInverse:1/65536};
      kernels.push(await make(code,name,name==='p2g_1'?[[0,0],[1,1],[2,2],[3,3]]:
        name==='p2g_2'?[[0,0],[1,1],[2,2],[3,3],[4,4],[5,5]]:[[0,0],[1,1],[2,2],[3,2],[4,3],[5,5],[6,6],...(support?[[7,7]]:[])] ,
      name==='p2g_1'?{fixedPointMultiplier:65536}:name==='p2g_2'?{...common,fixedPointMultiplier:65536,stiffness:config.stiffness,restDensity:config.restDensity,dynamicViscosity:config.viscosity}:{...common,physicalDt:config.dt}));
    }
    const update=await make((support?SCENE_LIQUID_SUPPORT_BINDINGS_WGSL+SCENE_LIQUID_COLLIDER_WGSL+`@group(0) @binding(7) var<uniform> domain:vec4f;`:'')+`
      struct Cell{vx:i32,vy:i32,vz:i32,mass:i32}
      @group(0) @binding(0) var<storage,read_write> cells:array<Cell>;
      @group(0) @binding(1) var<uniform> box:vec3f;
      @group(0) @binding(2) var<uniform> dt:f32;
      @group(0) @binding(3) var<uniform> obstacle:vec4f;
      @compute @workgroup_size(64) fn grid(@builtin(global_invocation_id) id:vec3u){
        if(id.x>=arrayLength(&cells)||cells[id.x].mass<=0){return;}
        let ny=u32(box.y);let nz=u32(box.z);
        let p=vec3f(f32(id.x/(ny*nz)),f32((id.x/nz)%ny),f32(id.x%nz));
        var v=vec3f(f32(cells[id.x].vx),f32(cells[id.x].vy),f32(cells[id.x].vz))/f32(cells[id.x].mass);
        v.y-=.4*dt;
        for(var axis=0;axis<3;axis++){
          if(p[axis]<2.&&v[axis]<0.){v[axis]=0.;}
          if(p[axis]>box[axis]-3.&&v[axis]>0.){v[axis]=0.;}
        }
        let delta=p+vec3f(.5)-obstacle.xyz;
        if(obstacle.w>0.&&length(delta)<obstacle.w+1.){let normal=normalize(delta);v-=normal*min(0.,dot(v,normal));}
        ${support?`let world=domain.xyz+(p+vec3f(.5))*domain.w;
        for(var i=0u;i<sceneSupportParams.x;i++){let f=sceneColliderFrame(world,i);let inward=dot(v,f.xyz);if(f.w<domain.w&&inward<0.){v-=f.xyz*inward;}}`:''}
        cells[id.x].vx=i32(v.x*65536.);cells[id.x].vy=i32(v.y*65536.);cells[id.x].vz=i32(v.z*65536.);
      }`,'grid',[[0,1],[1,2],[2,5],[3,6],...(support?[[7,7]]:[])]);
    const dispatch=(encoder,kernel,n)=>{const pass=encoder.beginComputePass();pass.setPipeline(kernel.pipeline);pass.setBindGroup(0,kernel.group);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();};
    const execute=(steps,epochMs)=>{
        const startTime=time,injections=[];
        for(let i=0;i<steps;i++){
          const births=plan.step(live,time,epochMs);injections.push(births);time+=config.dt;
        }
        const birthCount=injections.reduce((n,b)=>n+b.length,0);
        const upload=birthCount?device.createBuffer({size:birthCount*80,usage:U.COPY_SRC,mappedAtCreation:true,label:'MLS chronological emissions'}):null;
        if(upload){const values=new Float32Array(upload.getMappedRange());let i=0;for(const births of injections)for(const b of births){
          values.set(b.position,i*20);values[i*20+3]=b.life;values.set(b.velocity,i*20+4);i++;
        }upload.unmap();}
        const encoder=device.createCommandEncoder({label:`MLS ${steps} physical substeps from ${startTime}`});let source=0;
        for(const births of injections){
          for(const b of births){encoder.copyBufferToBuffer(upload,source,particles,b.slot*80,80);source+=80;}
          encoder.clearBuffer(cells);
          dispatch(encoder,kernels[0],config.capacity);dispatch(encoder,kernels[1],config.capacity);
          dispatch(encoder,update,config.gridCells);dispatch(encoder,kernels[2],config.capacity);
        }
        device.queue.submit([encoder.finish()]);pending=true;
        device.queue.onSubmittedWorkDone().catch(e=>{failure=String(e);}).finally(()=>{pending=false;upload?.destroy();});
        return true;
    };
    return {config,particles,
      setSceneColliders(records){if(!support)throw Error('MLS scene support was not installed');if(support.update(records)){kernels[2].group=kernels[2].refresh();update.group=update.refresh();}return support.read();},
      setPacket(packet){live=validateMlsPacket(packet);},
      setPaused(value){clock.observe(now(),paused);paused=Boolean(value);},
      advance(nowMs=now(),epochMs=Date.now()){
        if(disposed||failure)throw Error(failure||'MLS solver disposed');
        clock.observe(nowMs,paused);if(pending||paused)return false;
        const steps=clock.advance(nowMs,paused);return steps?execute(steps,epochMs):false;
      },
      async advanceTo(target,epochMs=Date.now()){
        if(disposed||failure)throw Error(failure||'MLS solver disposed');
        if(!Number.isSafeInteger(target)||target<clock.read().step)throw Error('MLS target step must not precede current step');
        clock.observe(now(),paused);paused=true;
        await device.queue.onSubmittedWorkDone();
        const steps=target-clock.read().step;if(steps)execute(clock.advanceSteps(steps),epochMs);
        await device.queue.onSubmittedWorkDone();if(failure)throw Error(failure);
        return clock.read();
      },
      read:()=>({route:MLS_ROUTE,source:MLS_SOURCE,particleCount:config.capacity,gridCells:config.gridCells,
        domain:{gridDimensions:[...config.dimensions],cellSize:config.cell,originWorld:[...config.min],boundsWorld:structuredClone(config.bounds)},
        modelTimeScale:config.modelSecondsPerSecond,clock:clock.read(),pending,failure,liveInlets:plan.read(time),
        emissionLaw:'unchanged_packet_distal_axis; strength_as_world_meters_per_second; packet_lifetime_seconds',
        material:{restDensity:config.restDensity,stiffness:config.stiffness,viscosity:config.viscosity,surfaceTension:false},
        collision:support?support.read():{route:'axis_aligned_domain_and_prescribed_sphere_not_arbitrary_scene'},initialParticleCount:initialParticles?.length/20||0}),
      async snapshot(){
        if(disposed)throw Error('MLS solver disposed');
        const readback=device.createBuffer({size:config.capacity*80,usage:U.COPY_DST|U.MAP_READ});
        try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(particles,0,readback,0,config.capacity*80);device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);return new Float32Array(readback.getMappedRange()).slice();
        }finally{readback.destroy();}
      },
      dispose(){if(disposed)return;disposed=true;support?.dispose();for(const b of owned)b.destroy();}
    };
  }catch(error){support?.dispose();for(const b of owned)b.destroy();throw error;}
}
