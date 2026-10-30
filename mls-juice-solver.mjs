import {mlsConfig,MLS_ROUTE,MLS_SOURCE,createMlsClock,createMlsEmissionPlan,validateMlsPacket} from './mls-juice-contract.mjs';
import {hillContactWGSL} from './mls-hill-terrain.mjs';

const boundary=`
        particles[id.x].position=clamp(particles[id.x].position,vec3f(2.),realBoxSize-vec3f(3.));
        let offset=particles[id.x].position-obstacle.xyz;
        let distance=length(offset);
        if(distance<obstacle.w+.3){
          let normal=select(vec3f(0,1,0),offset/max(distance,1e-6),distance>1e-6);
          particles[id.x].position=obstacle.xyz+normal*(obstacle.w+.3);
          particles[id.x].v-=normal*min(0.,dot(normal,particles[id.x].v));
        }
        // Sphere padding overlaps the floor; preserve the domain contact after projection.
        particles[id.x].position=clamp(particles[id.x].position,vec3f(2.),realBoxSize-vec3f(3.));
        let ground=hillSample(particles[id.x].position.xz);
        let hillNormal=normalize(vec3f(-ground.y,1.,-ground.z));
        let surfaceY=ground.x+hillRadius/hillNormal.y;
        if(ground.w>0.&&particles[id.x].position.y<surfaceY){
          particles[id.x].position.y=surfaceY;
          particles[id.x].v-=hillNormal*min(0.,dot(hillNormal,particles[id.x].v));
        }
        for(var axis=0;axis<3;axis++){
          if(particles[id.x].position[axis]<=2.){particles[id.x].v[axis]=max(0.,particles[id.x].v[axis]);}
          if(particles[id.x].position[axis]>=realBoxSize[axis]-3.){particles[id.x].v[axis]=min(0.,particles[id.x].v[axis]);}
        }
        particles[id.x].life=max(0.,particles[id.x].life-physicalDt);
    }
}`;

export async function createMlsJuiceSolver({device,setup,packet,now=()=>performance.now()}) {
  const config=mlsConfig(setup),owned=[];
  for(const size of [config.capacity*80,config.gridCells*16]){
    if(size>(device.limits?.maxStorageBufferBindingSize??Infinity)||size>(device.limits?.maxBufferSize??Infinity))throw Error('MLS domain exceeds effective device buffer limits');
  }
  if(Math.ceil(config.gridCells/64)>(device.limits?.maxComputeWorkgroupsPerDimension??Infinity))throw Error('MLS grid exceeds effective one-dimensional dispatch limit');
  const buffer=(size,usage,label)=>{const b=device.createBuffer({size,usage,label});owned.push(b);return b;};
  const U=GPUBufferUsage,clock=createMlsClock(config.dt),plan=createMlsEmissionPlan(config);
  let live=validateMlsPacket(packet),paused=false,pending=false,failure=null,disposed=false,time=0;
  const particles=buffer(config.capacity*80,U.STORAGE|U.COPY_DST|U.COPY_SRC,'MLS particles 80-byte APIC');
  const cells=buffer(config.gridCells*16,U.STORAGE|U.COPY_DST,'MLS grid');
  const densities=buffer(config.capacity*4,U.STORAGE,'MLS density');
  const uniform=(values,label)=>{const b=buffer(16,U.UNIFORM|U.COPY_DST,label);device.queue.writeBuffer(b,0,values);return b;};
  const box=uniform(new Float32Array([...config.dimensions,0]),'MLS grid extent');
  const count=uniform(new Uint32Array([config.capacity,0,0,0]),'MLS allocated slots');
  const dt=uniform(new Float32Array([config.dt*config.modelSecondsPerSecond,0,0,0]),'MLS model dt');
  const obstacle=uniform(new Float32Array([...config.obstacle.center.map((x,i)=>(x-config.min[i])/config.cell),config.terrain?-2:config.obstacle.radius/config.cell]),'MLS prescribed sphere');
  const hillHeights=buffer(Math.max(4,(config.terrain?.heights.length??1)*4),U.STORAGE|U.COPY_DST,'Frozen Hill heights');
  const hillParams=buffer(32,U.UNIFORM|U.COPY_DST,'Frozen Hill grid');
  const hillWords=new ArrayBuffer(32);
  if(config.terrain){
    const g=config.terrain.grid;
    device.queue.writeBuffer(hillHeights,0,Float32Array.from(config.terrain.heights,y=>(y-config.min[1])/config.cell));
    new Float32Array(hillWords,0,4).set([(g.min[0]-config.min[0])/config.cell,(g.min[1]-config.min[2])/config.cell,g.step[0]/config.cell,g.step[1]/config.cell]);
    new Uint32Array(hillWords,16,4).set([g.x,g.z,1,0]);
  }
  device.queue.writeBuffer(hillParams,0,hillWords);
  const resources=[particles,cells,box,count,densities,dt,obstacle,hillHeights,hillParams];
  const make=async(code,entry,bindings,constants={})=>{
    const module=device.createShaderModule({label:`MLS ${entry}`,code});
    const messages=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(messages.length)throw Error(`MLS ${entry}: ${messages.map(m=>m.message).join('; ')}`);
    const pipeline=await device.createComputePipelineAsync({label:`MLS ${entry}`,layout:'auto',compute:{module,entryPoint:entry,constants}});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(([binding,index])=>({binding,resource:{buffer:resources[index]}}))});
    return {pipeline,group};
  };
  try {
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
        code=code.slice(0,end)+boundary;
        code=`override physicalDt:f32; override hillRadius:f32; @group(0) @binding(6) var<uniform> obstacle:vec4f;\n`+hillContactWGSL(7,8)+code;
      }
      const common={fixedPointMultiplierInverse:1/65536};
      kernels.push(await make(code,name,name==='p2g_1'?[[0,0],[1,1],[2,2],[3,3]]:
        name==='p2g_2'?[[0,0],[1,1],[2,2],[3,3],[4,4],[5,5]]:[[0,0],[1,1],[2,2],[3,2],[4,3],[5,5],[6,6],[7,7],[8,8]],
      name==='p2g_1'?{fixedPointMultiplier:65536}:name==='p2g_2'?{...common,fixedPointMultiplier:65536,stiffness:config.stiffness,restDensity:config.restDensity,dynamicViscosity:config.viscosity}:{...common,physicalDt:config.dt,hillRadius:config.particleRadius/config.cell}));
    }
    const update=await make(hillContactWGSL(4,5)+`
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
        if(length(delta)<obstacle.w+1.){let normal=normalize(delta);v-=normal*min(0.,dot(v,normal));}
        let ground=hillSample(p.xz);
        if(ground.w>0.&&p.y<ground.x+1.){let normal=normalize(vec3f(-ground.y,1.,-ground.z));v-=normal*min(0.,dot(v,normal));}
        cells[id.x].vx=i32(v.x*65536.);cells[id.x].vy=i32(v.y*65536.);cells[id.x].vz=i32(v.z*65536.);
      }`,'grid',[[0,1],[1,2],[2,5],[3,6],[4,7],[5,8]]);
    const dispatch=(encoder,kernel,n)=>{const pass=encoder.beginComputePass();pass.setPipeline(kernel.pipeline);pass.setBindGroup(0,kernel.group);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();};
    return {config,particles,
      setPacket(packet){live=validateMlsPacket(packet);},
      setPaused(value){clock.observe(now(),paused);paused=Boolean(value);},
      advance(nowMs=now(),epochMs=Date.now()){
        if(disposed||failure)throw Error(failure||'MLS solver disposed');
        clock.observe(nowMs,paused);
        if(pending||paused)return false;
        const startTime=time,steps=clock.advance(nowMs,paused);if(!steps)return false;
        const injections=[];
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
      },
      read:()=>({route:MLS_ROUTE,source:MLS_SOURCE,particleCount:config.capacity,gridCells:config.gridCells,
        domain:{gridDimensions:[...config.dimensions],cellSize:config.cell,originWorld:[...config.min],boundsWorld:structuredClone(config.bounds)},
        modelTimeScale:config.modelSecondsPerSecond,clock:clock.read(),pending,failure,liveInlets:plan.read(time),
        emissionLaw:'unchanged_packet_distal_axis; strength_as_world_meters_per_second; packet_lifetime_seconds',
        material:{restDensity:config.restDensity,stiffness:config.stiffness,viscosity:config.viscosity,surfaceTension:false},
        terrain:config.terrain?{source:config.terrain.source,transform:config.terrain.transform,grid:config.terrain.grid,
          storage:'gpu_resident_frozen_heightfield',interpolation:'mesh_triangles_00_01_10_and_10_01_11',transferPolicy:'initial_upload_only'}:null,
        collision:config.terrain?'axis_aligned_domain_and_frozen_hill_triangles':'axis_aligned_domain_and_prescribed_sphere_not_arbitrary_scene'}),
      async snapshot(){
        if(disposed)throw Error('MLS solver disposed');
        const readback=device.createBuffer({size:config.capacity*80,usage:U.COPY_DST|U.MAP_READ});
        try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(particles,0,readback,0,config.capacity*80);device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);return new Float32Array(readback.getMappedRange()).slice();
        }finally{readback.destroy();}
      },
      dispose(){if(disposed)return;disposed=true;for(const b of owned)b.destroy();}
    };
  }catch(error){for(const b of owned)b.destroy();throw error;}
}
