import * as THREE from './lib/three.webgpu.js';
import {ArchGpuEngine,ENGINE_REVISION} from './lib/fracture/rigid-engine.js';
import {coarseRestFrame} from './fracture-coarse-rest-frame.mjs';
import {ARCH_GPU_KERNELS} from './fracture-coarse-kernels.mjs';
import {BURN_FRACTURE_IDENTITY,checkBurnFractureInput} from './burn-fracture-core.mjs';

export const BURN_FRACTURE_WGSL=`
@group(0) @binding(0) var<storage,read_write> joints:array<vec4f>;
@group(0) @binding(1) var<storage,read> sections:array<vec4f>;
@group(0) @binding(2) var<storage,read> coefficients:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> geometry:array<vec4f>;
@group(0) @binding(4) var<storage,read> positions:array<vec4f>;
@group(0) @binding(5) var<storage,read> rotations:array<vec4f>;
@group(0) @binding(6) var<storage,read> rest:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> matrices:array<mat4x4f>;
@group(0) @binding(8) var image:texture_storage_2d<rgba32float,write>;
struct Params {counts:vec4u,origin:vec4f}
@group(0) @binding(9) var<uniform> p:Params;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@compute @workgroup_size(64)
fn weaken(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=p.counts.y){return;}let base=i*11u;
 var meta=bitcast<vec4u>(joints[base]);if(meta.w==0u){return;}
 let sample=sections[i];if(sample.w==0.0){return;}
 let previous=geometry[i*3u+1u].w;
 let fraction=min(previous,clamp(sample.x,0.0,1.0));
 geometry[i*3u].x=coefficients[i].x*fraction;geometry[i*3u+1u].w=fraction;
 if(fraction==0.0){meta.w=0u;joints[base]=bitcast<vec4f>(meta);for(var j=5u;j<11u;j++){joints[base+j]=vec4f(0.0);}return;}
 let arm=max(joints[base+1u].w,1.0);
 joints[base+4u].x=coefficients[i].y*fraction;
 joints[base+4u].y=coefficients[i].z*fraction*fraction/(arm*arm);
 if(fraction<previous){
  let ratio=fraction/previous;
  for(var j=5u;j<11u;j++){joints[base+j]=joints[base+j]*select(ratio,ratio*ratio,j==6u||j==8u||j==10u);}
 }
}
@compute @workgroup_size(64)
fn present(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=p.counts.x){return;}let q=normalize(rotations[i]);
 let a=rotate(q,vec3f(1,0,0));let b=rotate(q,vec3f(0,1,0));let c=rotate(q,vec3f(0,0,1));
 let t=positions[i].xyz+p.origin.xyz-rotate(q,rest[i].xyz);
 let m=mat4x4f(vec4f(a,0),vec4f(b,0),vec4f(c,0),vec4f(t,1));matrices[i]=m;
 for(var col=0;col<4;col++){textureStore(image,vec2i(col,i32(i)),m[col]);}
}`;

// Source AVBD dynamics are reused, but pose presentation never maps their buffers.
// Supports are explicit constraints for this replay, not inferred scene contact.
export async function createBurnFractureGpu({renderer,prepared,sections,supports,regionMasses=prepared.cells.map(c=>c.volume),gravity=[0,-9.81,0]}){
 checkBurnFractureInput(prepared,sections,supports);
 const device=renderer.backend.device;if(!renderer.backend.isWebGPUBackend||sections.device!==device)throw Error('Same-device native WebGPU mechanics required');
 if(gravity.length!==3||!gravity.every(Number.isFinite))throw Error('Finite gravity required');
 if(regionMasses.length!==prepared.cells.length||!regionMasses.every(m=>Number.isFinite(m)&&m>=0))throw Error('Finite nonnegative current region masses required');
 const n=prepared.cells.length,m=prepared.bonds.length,owned=[],restFrame=coarseRestFrame(prepared),h=prepared.config.timeStep;
 let engine,wrapper,disposed=false,steps=0,seconds=0,remainder=0;
 const own=x=>{owned.push(x);return x;};
 function dispose(){if(disposed)return;disposed=true;if(wrapper){delete renderer.backend.get(wrapper).texture;wrapper.dispose();}engine?.dispose(renderer);for(const x of owned)x.destroy();}
 try{
  const degree=new Uint32Array(n);for(const b of prepared.bonds){degree[b.a]++;degree[b.b]++;}
  engine=new ArchGpuEngine(device,{maxBodies:n,gravity:[0,0,0],deltaTime:h,substeps:prepared.config.substeps,solverIterations:prepared.config.solverIterations,
   maxFixedStepsPerFrame:1,enableBvhBuild:false,maxJointsPerBodySolver:Math.max(1,...degree),maxPairsPerBodyBroadphase:Math.max(1,n-1),maxContactsPerBodySolver:Math.max(1,(n-1)*4),pairManifoldSlots:4,avbdPenaltyDecayGamma:1});
  engine.setAvbdPreventPenetratingNormalDropout(true);
  for(const c of restFrame.cells)engine.addBody({position:c.position,halfExtents:c.halfExtents,mass:supports.includes(c.index)?0:regionMasses[c.index],collisionGroup:1,collisionMask:0});
  for(const b of restFrame.bonds){const j=engine.addFixedJoint(b.a,b.b,b.anchorA,b.anchorB,b.linearStiffness,true),a=engine.jointRecordsData,arm=Math.max(a[j*44+7],1);a[j*44+17]=b.rotationalStiffness/(arm*arm);
   for(let axis=0;axis<3;axis++){a[j*44+36+axis]=a[j*44+16];a[j*44+40+axis]=a[j*44+17];}
   if(regionMasses[b.a]===0||regionMasses[b.b]===0)engine.setInitialJointActive(j,false);
  }
  // The source engine's first zero-gravity step uploads and allocates its state.
  engine.step(h,renderer);engine.setGravity(gravity);
  const attrs=engine.getResidentAttributes(),resident=name=>{const b=renderer.backend.get(attrs[name]).buffer;if(!b)throw Error('Missing resident mechanics '+name);return b;};
  const buffer=(label,data,usage=GPUBufferUsage.STORAGE)=>{const b=own(device.createBuffer({label,size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}));device.queue.writeBuffer(b,0,data);return b;};
  const geometryData=new Float32Array(m*12),coefficientsData=new Float32Array(m*4);
  restFrame.bonds.forEach((b,i)=>{geometryData.set([b.area,...b.normal,...b.anchorA,1,...b.anchorB,0],i*12);coefficientsData.set([b.area,b.linearStiffness,b.rotationalStiffness,0],i*4);});
  const geometry=buffer('Current burn-bearing material sections',geometryData),coefficients=buffer('Original material section coefficients',coefficientsData);
  const rest=buffer('Original region centers',Float32Array.from(prepared.cells.flatMap(c=>[...c.position,0]))),matrices=buffer('Resident original-to-current region matrices',new Float32Array(n*16));
  const texture=own(device.createTexture({label:'Resident fracture pose presentation',size:[4,n],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}));
  wrapper=new THREE.ExternalTexture(texture);wrapper.type=THREE.FloatType;wrapper.format=THREE.RGBAFormat;wrapper.colorSpace=THREE.NoColorSpace;wrapper.minFilter=wrapper.magFilter=THREE.NearestFilter;
  const parameters=buffer('Burn fracture counts and origin',new Uint32Array(8),GPUBufferUsage.UNIFORM);
  const data=new ArrayBuffer(32);new Uint32Array(data).set([n,m,0,0]);new Float32Array(data).set([...restFrame.origin,0],4);device.queue.writeBuffer(parameters,0,data);
  const shader=device.createShaderModule({label:'Resident consumed-section mechanics',code:BURN_FRACTURE_WGSL});
  const info=await shader.getCompilationInfo();if(info.messages.some(x=>x.type==='error'))throw Error(info.messages.map(x=>x.message).join('; '));
  const pipelines={};for(const entryPoint of ['weaken','present'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint}});
  const groups={weaken:device.createBindGroup({layout:pipelines.weaken.getBindGroupLayout(0),entries:[resident('joints'),sections.buffer,coefficients,geometry].map((b,binding)=>({binding,resource:{buffer:b}})).concat([{binding:9,resource:{buffer:parameters}}])}),
   present:device.createBindGroup({layout:pipelines.present.getBindGroupLayout(0),entries:[{binding:4,resource:{buffer:resident('positions')}},{binding:5,resource:{buffer:resident('quaternions')}},{binding:6,resource:{buffer:rest}},{binding:7,resource:{buffer:matrices}},{binding:8,resource:texture.createView()},{binding:9,resource:{buffer:parameters}}]})};
  const damage=buffer('Material fracture reaction and events',new Float32Array(m*12)),grip=buffer('Inactive replay grips',new Float32Array(n*12)),output=buffer('Unused reaction pack output',new Float32Array(4));
  const fractureParams=buffer('Material fracture strength',new Float32Array(16),GPUBufferUsage.UNIFORM),fractureData=new ArrayBuffer(64),fu=new Uint32Array(fractureData),ff=new Float32Array(fractureData);
  fu.set([n,m,0,0],4);ff.set([prepared.config.strength,h,0,0],8);
  const fractureModule=device.createShaderModule({label:'Reused material stress and fracture',code:ARCH_GPU_KERNELS});
  const fractureInfo=await fractureModule.getCompilationInfo();if(fractureInfo.messages.some(x=>x.type==='error'))throw Error(fractureInfo.messages.map(x=>x.message).join('; '));
  const fracturePipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:fractureModule,entryPoint:'fracture'}});
  const fractureResources=[resident('positions'),resident('quaternions'),resident('velocities'),resident('angularVelocities'),resident('joints'),geometry,damage,grip,fractureParams,output];
  const fractureGroup=device.createBindGroup({layout:fracturePipeline.getBindGroupLayout(0),entries:[0,1,2,3,4,5,6,8].map(binding=>({binding,resource:{buffer:fractureResources[binding]}}))});
  function dispatch(name){const e=device.createCommandEncoder(),p=e.beginComputePass({label:'Burn fracture '+name});p.setPipeline(pipelines[name]);p.setBindGroup(0,groups[name]);p.dispatchWorkgroups(Math.ceil((name==='weaken'?m:n)/64));p.end();device.queue.submit([e.finish()]);}
  dispatch('present');
  return {texture,wrapper,matrices,
   advance(dt){if(disposed)throw Error('Burn fracture is disposed');if(!Number.isFinite(dt)||dt<0)throw Error('Finite nonnegative mechanics duration required');remainder+=dt;
    while(remainder+Number.EPSILON>=h){dispatch('weaken');engine.step(h,renderer);steps++;seconds+=h;fu[6]=steps;device.queue.writeBuffer(fractureParams,0,fractureData);
     const e=device.createCommandEncoder(),p=e.beginComputePass({label:'Remaining-area mechanical failure'});p.setPipeline(fracturePipeline);p.setBindGroup(0,fractureGroup);p.dispatchWorkgroups(Math.ceil(m/64));p.end();device.queue.submit([e.finish()]);remainder=Math.max(0,remainder-h);
    }dispatch('present');
   },
   read:()=>({identity:BURN_FRACTURE_IDENTITY,engine:ENGINE_REVISION,steps,seconds,remainder,regions:n,connections:m,supports:[...supports],regionMasses:[...regionMasses],gravity:[...gravity],runtimeReadbacks:0,contact:'explicit-clamps-no-scene-contact',clock:'fixed-step-with-retained-remainder',residency:'same-device-pose-buffer-and-texture',massModel:'frozen-region-mean-fuel-box-inertia'}),
   async snapshot(){if(disposed)throw Error('Burn fracture is disposed');const buffers=[matrices,resident('positions'),resident('quaternions'),resident('velocities'),resident('angularVelocities'),resident('joints'),geometry,damage];
    const bytes=buffers.reduce((s,b)=>s+b.size,0),staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const e=device.createCommandEncoder();let offset=0;for(const b of buffers){e.copyBufferToBuffer(b,0,staging,offset,b.size);offset+=b.size;}device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);const raw=new Uint8Array(staging.getMappedRange()),arrays=[];offset=0;for(const b of buffers){arrays.push(Array.from(new Float32Array(raw.slice(offset,offset+b.size).buffer)));offset+=b.size;}
     const jointWords=new Uint32Array(Float32Array.from(arrays[5]).buffer);return {state:this.read(),matrices:arrays[0],positions:arrays[1],quaternions:arrays[2],velocities:arrays[3],angularVelocities:arrays[4],joints:arrays[5],alive:prepared.bonds.map((_,i)=>jointWords[i*44+3]===1),geometry:arrays[6],damage:arrays[7],origin:restFrame.origin};
    }finally{staging.unmap();staging.destroy();}
   },dispose};
 }catch(error){dispose();throw error;}
}
