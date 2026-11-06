import * as THREE from './lib/three.webgpu.js';
import {ArchGpuEngine,ENGINE_REVISION} from './lib/fracture/rigid-engine.js';
import {coarseRestFrame} from './fracture-coarse-rest-frame.mjs';
import {ARCH_GPU_KERNELS} from './fracture-coarse-kernels.mjs';
import {BURN_FRACTURE_IDENTITY,checkBurnFractureInput,checkedBurnMaterial,checkedBurnSupport,burnInitialJointPenalties} from './burn-fracture-core.mjs';
import {createBurnRegionBodiesGpu} from './burn-region-bodies-gpu.mjs';
import {batchCoarseCompute} from './fracture-compute-batch.mjs';
import {createBurnRigidFractureGpu} from './burn-rigid-fracture-gpu.mjs';

export const BURN_STRESS_WGSL=`
fn burnStress(area:f32,normal:vec3f,force:vec3f,torque:vec3f)->vec3f {
 let n=normalize(normal);let axial=dot(force,n);let twist=dot(torque,n);
 let radius=sqrt(area/3.141592653589793);let modulus=3.141592653589793*radius*radius*radius/4.0;
 let bending=length(torque-twist*n)/modulus;
 return vec3f(max(0.0,-axial/area+bending),max(0.0,axial/area+bending),
  4.0*length(force-axial*n)/(3.0*area)+abs(twist)/(2.0*modulus));
}
`;

const FAILURE_WGSL=ARCH_GPU_KERNELS+BURN_STRESS_WGSL+`
@group(0) @binding(10) var<storage,read> materialDamage:array<vec4f>;
@group(0) @binding(11) var<uniform> strength:vec4f;
@compute @workgroup_size(64)
fn burnFailure(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=params.counts.y){return;}let base=i*11u;
 var jointMeta=bitcast<vec4u>(joints[base]);if(jointMeta.w==0u){return;}
 let shape=geometry[i*3u];if(shape.x<=0.0){return;}
 let force=linearForce(i);let arm=max(joints[base+1u].w,1.0);
 let delta=qmul(qmul(quaternions[jointMeta.x],joints[base+3u]),qconj(quaternions[jointMeta.y]));
 let torque=(joints[base+10u].xyz*2.0*delta.xyz*arm+joints[base+8u].xyz)*arm;
 let stress=burnStress(shape.x,qrot(quaternions[jointMeta.x],shape.yzw),force,torque);
 let char=clamp(materialDamage[i].x,0.0,1.0);let unburned=1.0-char;let u2=unburned*unburned;let ratio=stress/(strength.xyz*(strength.w+(1.0-strength.w)*u2*u2));
 let utilization=max(ratio.x,max(ratio.y,ratio.z));
 damage[i*3u]=vec4f(length(force),length(torque),utilization,0);
 damage[i*3u+1u]=vec4f(stress,0);damage[i*3u+2u]=vec4f(ratio,char);
 if(utilization>1.0){jointMeta.w=0u;joints[base]=bitcast<vec4f>(jointMeta);damage[i*3u].w=f32(params.counts.z);}
}
`;

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
 var jointMeta=bitcast<vec4u>(joints[base]);if(jointMeta.w==0u){return;}
 let sample=sections[i];if(sample.w==0.0){return;}
 let previous=geometry[i*3u+1u].w;
 let fraction=min(previous,clamp(sample.x,0.0,1.0));
 geometry[i*3u].x=coefficients[i].x*fraction;geometry[i*3u+1u].w=fraction;
 if(fraction==0.0){jointMeta.w=0u;joints[base]=bitcast<vec4f>(jointMeta);for(var j=5u;j<11u;j++){joints[base+j]=vec4f(0.0);}return;}
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
 let i=gid.x;if(i>=p.counts.x+p.counts.y){return;}
 if(i>=p.counts.x){textureStore(image,vec2i(0,i32(i)),vec4f(f32(bitcast<vec4u>(joints[(i-p.counts.x)*11u]).w),0,0,0));return;}
 let scale=select(1.0,0.0,positions[i].w==0.0&&rest[i].w>0.0);
 let q=normalize(rotations[i]);
 let a=rotate(q,vec3f(scale,0,0));let b=rotate(q,vec3f(0,scale,0));let c=rotate(q,vec3f(0,0,scale));
 let t=positions[i].xyz+p.origin.xyz-rotate(q,rest[i].xyz);
 let m=mat4x4f(vec4f(a,0),vec4f(b,0),vec4f(c,0),vec4f(t,1));matrices[i]=m;
 for(var col=0;col<4;col++){textureStore(image,vec2i(col,i32(i)),m[col]);}
}`;

// Source AVBD dynamics are reused, but pose presentation never maps their buffers.
export async function createBurnFractureGpu({renderer,prepared,sections,supports=[],finiteSupports=[],material,regionMasses,gravity=[0,-9.81,0],field=null,regionMapping=null}){
 checkBurnFractureInput(prepared,sections,supports);
 material=checkedBurnMaterial(material);finiteSupports=finiteSupports.map(checkedBurnSupport);
 if(!sections.damageBuffer)throw Error('Resident section char damage required');
 regionMasses??=prepared.cells.map(c=>c.volume*material.density);
 const device=renderer.backend.device;if(!renderer.backend.isWebGPUBackend||sections.device!==device)throw Error('Same-device native WebGPU mechanics required');
 if(gravity.length!==3||!gravity.every(Number.isFinite))throw Error('Finite gravity required');
 if(regionMasses.length!==prepared.cells.length||!regionMasses.every(m=>Number.isFinite(m)&&m>=0))throw Error('Finite nonnegative current region masses required');
 if(field&&(!regionMapping||supports.length||field.device!==device))throw Error('Live material requires same-device region mapping and physical contact instead of pinned pieces');
 if(field)return createBurnRigidFractureGpu({renderer,prepared,sections,finiteSupports,material,regionMasses,gravity,field,regionMapping,presentationCode:BURN_FRACTURE_WGSL});
 const n=prepared.cells.length,m=prepared.bonds.length,owned=[],restFrame=coarseRestFrame(prepared),h=prepared.config.timeStep;
 let engine,wrapper,liveBodies,disposed=false,steps=0,seconds=0,remainder=0,contactsEnabled=true;
 const own=x=>{owned.push(x);return x;};
 function dispose(){if(disposed)return;disposed=true;liveBodies?.dispose();if(wrapper){delete renderer.backend.get(wrapper).texture;wrapper.dispose();}engine?.dispose(renderer);for(const x of owned)x.destroy();}
 try{
  device.pushErrorScope('validation');
  const shader=device.createShaderModule({label:'Resident consumed-section mechanics',code:BURN_FRACTURE_WGSL});
  const info=await shader.getCompilationInfo(),validation=await device.popErrorScope();
  if(info.messages.some(x=>x.type==='error')||validation)throw Error(info.messages.filter(x=>x.type==='error').map(x=>x.message).join('; ')||validation.message);
  const pipelines={};for(const entryPoint of ['weaken','present'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint}});
  const degree=new Uint32Array(n),adj=Array.from({length:n},()=>[]);for(const b of prepared.bonds){degree[b.a]++;degree[b.b]++;adj[b.a].push(b.b);adj[b.b].push(b.a);}
  const colors=new Int32Array(n).fill(-1),order=Array.from({length:n},(_,i)=>i).sort((a,b)=>degree[b]-degree[a]);
  for(const u of order){const used=new Set();for(const v of adj[u])if(colors[v]>=0)used.add(colors[v]);let c=0;while(used.has(c))c++;colors[u]=c;}
  const colorCount=Math.min(8,Math.max(2,...colors.map(c=>c+1))),bodyCount=n+finiteSupports.length;
  engine=new ArchGpuEngine(device,{maxBodies:bodyCount,gravity:[0,0,0],deltaTime:h,substeps:prepared.config.substeps,solverIterations:prepared.config.solverIterations,
   avbdPairSweeps:1,pairSolveColorCount:colorCount,maxFixedStepsPerFrame:1,enableBvhBuild:false,maxJointsPerBodySolver:Math.max(1,...degree),maxPairsPerBodyBroadphase:Math.max(1,bodyCount-1),maxContactsPerBodySolver:Math.max(1,finiteSupports.length*4),pairManifoldSlots:4,avbdPenaltyDecayGamma:1});
  engine.setAvbdPreventPenetratingNormalDropout(true);
  for(const c of restFrame.cells)engine.addBody({position:c.position,halfExtents:c.halfExtents,mass:supports.includes(c.index)?0:regionMasses[c.index],collisionGroup:1,collisionMask:regionMasses[c.index]>0?2:0});
  const supportBodies=finiteSupports.map(s=>engine.addBody({...s,position:s.position.map((v,k)=>v-restFrame.origin[k]),mass:0,collisionGroup:2,collisionMask:1}));
  for(let i=0;i<n;i++)engine.bodyConstraintCountsData[i]=(colors[i]%colorCount)<<16;
  for(const b of restFrame.bonds){const j=engine.addFixedJoint(b.a,b.b,b.anchorA,b.anchorB,b.linearStiffness,true),a=engine.jointRecordsData,arm=Math.max(a[j*44+7],1);a[j*44+17]=b.rotationalStiffness/(arm*arm);
   const initial=burnInitialJointPenalties({masses:[b.a,b.b].map(i=>supports.includes(i)?0:regionMasses[i]),halfExtents:[restFrame.cells[b.a].halfExtents,restFrame.cells[b.b].halfExtents],timeStep:h/prepared.config.substeps,linearStiffness:a[j*44+16],rotationalStiffness:a[j*44+17],torqueArm:arm});
   for(let axis=0;axis<3;axis++){a[j*44+36+axis]=initial.linear;a[j*44+40+axis]=initial.angular[axis];}
   if(regionMasses[b.a]===0||regionMasses[b.b]===0)engine.setInitialJointActive(j,false);
  }
  const initialPositions=engine.positionsData.slice(0,bodyCount*4),initialQuaternions=engine.quaternionsData.slice(0,bodyCount*4),initialVelocities=engine.velocitiesData.slice(0,bodyCount*4),initialAngular=engine.angularVelData.slice(0,bodyCount*4),initialShapes=engine.shapesData.slice(0,bodyCount*4),initialInertia=engine.inverseInertiaData.slice(0,bodyCount*4),initialJoints=engine.jointRecordsData.slice(0,m*44),initialColors=engine.bodyConstraintCountsData.slice(0,bodyCount);
  // The source engine's first zero-gravity step uploads and allocates its state.
  batchCoarseCompute(renderer,()=>engine.step(h,renderer));engine.setGravity(gravity);
  const attrs=engine.getResidentAttributes(),resident=name=>{const b=renderer.backend.get(attrs[name]).buffer;if(!b)throw Error('Missing resident mechanics '+name);return b;};
  const buffer=(label,data,usage=GPUBufferUsage.STORAGE)=>{const b=own(device.createBuffer({label,size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}));device.queue.writeBuffer(b,0,data);return b;};
  const geometryData=new Float32Array(m*12),coefficientsData=new Float32Array(m*4),initialRest=Float32Array.from(prepared.cells.flatMap(c=>[...c.position,regionMasses[c.index]]));
  restFrame.bonds.forEach((b,i)=>{geometryData.set([b.area,...b.normal,...b.anchorA,1,...b.anchorB,0],i*12);coefficientsData.set([b.area,b.linearStiffness,b.rotationalStiffness,0],i*4);});
  const geometry=buffer('Current burn-bearing material sections',geometryData),coefficients=buffer('Original material section coefficients',coefficientsData);
  const rest=buffer('Current material centers and original masses',initialRest),matrices=buffer('Resident original-to-current region matrices',new Float32Array(n*16));
  const texture=own(device.createTexture({label:'Resident fracture pose and connection visibility',size:[4,n+m],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}));
  wrapper=new THREE.ExternalTexture(texture);wrapper.type=THREE.FloatType;wrapper.format=THREE.RGBAFormat;wrapper.colorSpace=THREE.NoColorSpace;wrapper.minFilter=wrapper.magFilter=THREE.NearestFilter;
  const parameters=buffer('Burn fracture counts and origin',new Uint32Array(8),GPUBufferUsage.UNIFORM);
  const data=new ArrayBuffer(32);new Uint32Array(data).set([n,m,0,0]);new Float32Array(data).set([...restFrame.origin,0],4);device.queue.writeBuffer(parameters,0,data);
  const groups={weaken:device.createBindGroup({layout:pipelines.weaken.getBindGroupLayout(0),entries:[resident('joints'),sections.buffer,coefficients,geometry].map((b,binding)=>({binding,resource:{buffer:b}})).concat([{binding:9,resource:{buffer:parameters}}])}),
   present:device.createBindGroup({layout:pipelines.present.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:resident('joints')}},{binding:4,resource:{buffer:resident('positions')}},{binding:5,resource:{buffer:resident('quaternions')}},{binding:6,resource:{buffer:rest}},{binding:7,resource:{buffer:matrices}},{binding:8,resource:texture.createView()},{binding:9,resource:{buffer:parameters}}]})};
  const damage=buffer('Material fracture reaction and events',new Float32Array(m*12));
  const fractureParams=buffer('Material fracture strength',new Float32Array(16),GPUBufferUsage.UNIFORM),fractureData=new ArrayBuffer(64),fu=new Uint32Array(fractureData),ff=new Float32Array(fractureData);
  fu.set([n,m,0,0],4);ff.set([prepared.config.strength,h,0,0],8);
  const strengths=buffer('Separate material strength limits',Float32Array.of(material.tension,material.compression,material.shear,material.charStrength),GPUBufferUsage.UNIFORM);
  const fractureModule=device.createShaderModule({label:'Burn-loaded brittle section failure',code:FAILURE_WGSL});
  const fractureInfo=await fractureModule.getCompilationInfo();if(fractureInfo.messages.some(x=>x.type==='error'))throw Error(fractureInfo.messages.map(x=>x.message).join('; '));
  const fracturePipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:fractureModule,entryPoint:'burnFailure'}});
  const fractureResources={0:resident('positions'),1:resident('quaternions'),4:resident('joints'),5:geometry,6:damage,8:fractureParams,10:sections.damageBuffer,11:strengths};
  const fractureGroup=device.createBindGroup({layout:fracturePipeline.getBindGroupLayout(0),entries:Object.entries(fractureResources).map(([binding,b])=>({binding:Number(binding),resource:{buffer:b}}))});
  if(field)liveBodies=await createBurnRegionBodiesGpu({device,field,mapping:regionMapping,envelopes:prepared.cells.map(c=>({min:c.position.map((v,k)=>v-c.halfExtents[k]),max:c.position.map((v,k)=>v+c.halfExtents[k])})),rest,positions:resident('positions'),rotations:resident('quaternions'),boxes:renderer.backend.get(engine.shapesAttr).buffer,inertia:renderer.backend.get(engine.inverseInertiaAttr).buffer,velocities:resident('velocities'),angular:resident('angularVelocities'),joints:resident('joints'),contacts:renderer.backend.get(engine.pairContactsAttr).buffer});
  function updateMaterial(){if(!liveBodies)return;const e=device.createCommandEncoder();liveBodies.encode(e);device.queue.submit([e.finish()]);}
  function dispatch(name){const e=device.createCommandEncoder(),p=e.beginComputePass({label:'Burn fracture '+name});p.setPipeline(pipelines[name]);p.setBindGroup(0,groups[name]);p.dispatchWorkgroups(Math.ceil((name==='weaken'?m:n+m)/64));p.end();device.queue.submit([e.finish()]);}
  updateMaterial();
  dispatch('present');
  return {texture,wrapper,matrices,
   setGravity(value){engine.setGravity(value);gravity=[...value];},
   setContactsEnabled(value){if(disposed)throw Error('Burn fracture is disposed');if(typeof value!=='boolean')throw Error('Boolean support contact required');if(value===contactsEnabled)return;for(const body of supportBodies)engine.setBodyCollisionFilter(body,2,value?1:0);contactsEnabled=value;},
   setSupport(index,next){if(disposed)throw Error('Burn fracture is disposed');if(!Number.isInteger(index)||index<0||index>=supportBodies.length)throw Error('Unknown finite support');const s=checkedBurnSupport(next),old=finiteSupports[index];if(s.friction!==old.friction||s.halfExtents.some((v,k)=>v!==old.halfExtents[k]))throw Error('Support resizing requires reconstruction');if(s.position.every((v,k)=>v===old.position[k])&&s.quaternion.every((v,k)=>v===old.quaternion[k]))return;engine.setBodyPose(supportBodies[index],s.position.map((v,k)=>v-restFrame.origin[k]),s.quaternion,[0,0,0],[0,0,0]);finiteSupports[index]=s;},
   advance(dt){if(disposed)throw Error('Burn fracture is disposed');if(!Number.isFinite(dt)||dt<0)throw Error('Finite nonnegative mechanics duration required');remainder=Math.min(remainder+dt,h*2);
    updateMaterial();
    while(remainder+Number.EPSILON>=h){dispatch('weaken');batchCoarseCompute(renderer,()=>engine.step(h,renderer));steps++;seconds+=h;fu[6]=steps;device.queue.writeBuffer(fractureParams,0,fractureData);
     const e=device.createCommandEncoder(),p=e.beginComputePass({label:'Remaining-area mechanical failure'});p.setPipeline(fracturePipeline);p.setBindGroup(0,fractureGroup);p.dispatchWorkgroups(Math.ceil(m/64));p.end();device.queue.submit([e.finish()]);remainder=Math.max(0,remainder-h);
    }dispatch('present');
   },
   reset(){if(disposed)throw Error('Burn fracture is disposed');
    engine.positionsData.set(initialPositions);engine.quaternionsData.set(initialQuaternions);engine.velocitiesData.set(initialVelocities);engine.prevLinearVelData.set(initialVelocities);engine.angularVelData.set(initialAngular);engine.shapesData.set(initialShapes);engine.inverseInertiaData.set(initialInertia);engine.jointRecordsData.set(initialJoints);engine.bodyConstraintCountsData.set(initialColors);
    for(let i=0;i<supportBodies.length;i++){const b=supportBodies[i],s=finiteSupports[i];engine.setBodyPose(b,s.position.map((v,k)=>v-restFrame.origin[k]),s.quaternion,[0,0,0],[0,0,0]);engine.setBodyCollisionFilter(b,2,contactsEnabled?1:0);}
    device.queue.writeBuffer(resident('positions'),0,engine.positionsData,0,bodyCount*4);device.queue.writeBuffer(resident('quaternions'),0,engine.quaternionsData,0,bodyCount*4);device.queue.writeBuffer(resident('velocities'),0,engine.velocitiesData,0,bodyCount*4);device.queue.writeBuffer(resident('angularVelocities'),0,engine.angularVelData,0,bodyCount*4);
    device.queue.writeBuffer(renderer.backend.get(engine.shapesAttr).buffer,0,engine.shapesData,0,bodyCount*4);device.queue.writeBuffer(renderer.backend.get(engine.inverseInertiaAttr).buffer,0,engine.inverseInertiaData,0,bodyCount*4);device.queue.writeBuffer(renderer.backend.get(engine.bodyConstraintCountsAttr).buffer,0,engine.bodyConstraintCountsData,0,bodyCount);
    if(m>0)device.queue.writeBuffer(resident('joints'),0,engine.jointRecordsData,0,m*44);
    const pairContacts=renderer.backend.get(engine.pairContactsAttr).buffer;device.queue.writeBuffer(pairContacts,0,new Float32Array(pairContacts.size/4));
    device.queue.writeBuffer(geometry,0,geometryData);device.queue.writeBuffer(rest,0,initialRest);device.queue.writeBuffer(damage,0,new Float32Array(m*12));
    steps=0;seconds=0;remainder=0;fu[6]=0;device.queue.writeBuffer(fractureParams,0,fractureData);updateMaterial();dispatch('present');
   },
   read:()=>({identity:BURN_FRACTURE_IDENTITY,engine:ENGINE_REVISION,steps,seconds,remainder,regions:n,connections:m,supports:[...supports],finiteSupports:finiteSupports.map(s=>structuredClone(s)),contactsEnabled,regionMasses:[...regionMasses],gravity:[...gravity],material:{...material},failureModel:'equivalent-circular-section-brittle-max-stress-char-strength',runtimeReadbacks:0,contact:'finite-support-boxes-no-piece-self-contact',clock:'fixed-step-with-retained-remainder',residency:'same-device-pose-buffer-and-texture',massModel:liveBodies?'live-region-fuel-surviving-box-inertia':'frozen-region-mean-fuel-density-box-inertia'}),
   async snapshot(){if(disposed)throw Error('Burn fracture is disposed');const buffers=[matrices,resident('positions'),resident('quaternions'),resident('velocities'),resident('angularVelocities'),resident('joints'),geometry,damage,renderer.backend.get(engine.shapesAttr).buffer,rest,renderer.backend.get(engine.inverseInertiaAttr).buffer];if(liveBodies)buffers.push(liveBodies.shape);
    const bytes=buffers.reduce((s,b)=>s+b.size,0),staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const e=device.createCommandEncoder();let offset=0;for(const b of buffers){e.copyBufferToBuffer(b,0,staging,offset,b.size);offset+=b.size;}device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);const raw=new Uint8Array(staging.getMappedRange()),arrays=[];offset=0;for(const b of buffers){arrays.push(Array.from(new Float32Array(raw.slice(offset,offset+b.size).buffer)));offset+=b.size;}
     const jointWords=new Uint32Array(Float32Array.from(arrays[5]).buffer),shapeWords=new Uint32Array(Float32Array.from(arrays[8]).buffer);return {state:this.read(),matrices:arrays[0],positions:arrays[1].slice(0,n*4),quaternions:arrays[2].slice(0,n*4),velocities:arrays[3].slice(0,n*4),angularVelocities:arrays[4].slice(0,n*4),supportPositions:arrays[1].slice(n*4),supportQuaternions:arrays[2].slice(n*4),supportCollisionMasks:supportBodies.map(i=>shapeWords[i*4]>>>24),joints:arrays[5],alive:prepared.bonds.map((_,i)=>jointWords[i*44+3]===1),geometry:arrays[6],damage:arrays[7],boxes:arrays[8],centers:arrays[9],inverseInertia:arrays[10],remainingBodies:arrays[11]??null,origin:restFrame.origin};
    }finally{staging.unmap();staging.destroy();}
   },dispose};
 }catch(error){dispose();throw error;}
}
