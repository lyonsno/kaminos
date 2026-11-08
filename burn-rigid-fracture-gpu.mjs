import * as THREE from './lib/three.webgpu.js';
import {coarseRestFrame} from './fracture-coarse-rest-frame.mjs';
import {BURN_FRACTURE_IDENTITY,checkedBurnSupport} from './burn-fracture-core.mjs';
import {createBurnRegionBodiesGpu} from './burn-region-bodies-gpu.mjs';
import {createBurnRigidIslandsGpu} from './burn-rigid-islands-gpu.mjs';

// Live motion consumes the same regional material and presentation ABI as the
// elastic contender, but a connection is broken only by material consumption.
export async function createBurnRigidFractureGpu({renderer,prepared,sections,finiteSupports,material,regionMasses,gravity,field,regionMapping,presentationCode}){
 const device=renderer.backend.device,n=prepared.cells.length,m=prepared.bonds.length,frame=coarseRestFrame(prepared),h=prepared.config.timeStep,substeps=prepared.config.substeps,owned=[];
 if(!Number.isInteger(substeps)||substeps<1)throw Error('Positive rigid material substeps required');
 let disposed=false,steps=0,seconds=0,remainder=0,contactsEnabled=true,liveBodies,motion,wrapper;
 const allocate=(label,data,usage=GPUBufferUsage.STORAGE)=>{const b=device.createBuffer({label,size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 const initial={positions:Float32Array.from(frame.cells.flatMap((c,i)=>[...c.position,regionMasses[i]>0?1/regionMasses[i]:0])),rotations:Float32Array.from(frame.cells.flatMap(()=>[0,0,0,1])),velocities:new Float32Array(n*4),angular:new Float32Array(n*4),boxes:Float32Array.from(frame.cells.flatMap(c=>[0,...c.halfExtents])),rest:Float32Array.from(prepared.cells.flatMap((c,i)=>[...c.position,regionMasses[i]])),joints:new Float32Array(m*44),geometry:new Float32Array(m*12)};
 const jointWords=new Uint32Array(initial.joints.buffer),coefficientsData=new Float32Array(m*4);
 frame.bonds.forEach((b,i)=>{jointWords.set([b.a,b.b,0,regionMasses[b.a]>0&&regionMasses[b.b]>0?1:0],i*44);initial.joints.set([...b.anchorA,1,...b.anchorB,0,0,0,0,1,b.linearStiffness,b.rotationalStiffness],i*44+4);initial.geometry.set([b.area,...b.normal,...b.anchorA,1,...b.anchorB,0],i*12);coefficientsData.set([b.area,b.linearStiffness,b.rotationalStiffness,0],i*4);});
 function dispose(){if(disposed)return;disposed=true;liveBodies?.dispose();motion?.dispose();if(wrapper){delete renderer.backend.get(wrapper).texture;wrapper.dispose();}owned.forEach(b=>b.destroy());}
 try{
  const buffers=Object.fromEntries(Object.entries(initial).map(([key,data])=>[key,allocate('Burn rigid '+key,data)]));
  const inertia=allocate('Regional surviving box inertia',new Float32Array(n*4)),emptyContacts=allocate('Unused elastic contact ABI',new Float32Array(36)),coefficients=allocate('Original burn section coefficients',coefficientsData),matrices=allocate('Resident rigid material matrices',new Float32Array(n*16)),damage=allocate('No mechanical-load estimate',new Float32Array(m*12));
  const texture=device.createTexture({label:'Resident rigid burn pose and connection visibility',size:[4,n+m],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});owned.push(texture);
  wrapper=new THREE.ExternalTexture(texture);wrapper.type=THREE.FloatType;wrapper.format=THREE.RGBAFormat;wrapper.colorSpace=THREE.NoColorSpace;wrapper.minFilter=wrapper.magFilter=THREE.NearestFilter;
  const raw=new ArrayBuffer(32);new Uint32Array(raw).set([n,m,0,0]);new Float32Array(raw).set([...frame.origin,0],4);const parameters=allocate('Rigid burn presentation counts and origin',new Uint8Array(raw),GPUBufferUsage.UNIFORM);
  const module=device.createShaderModule({label:'Shared burn material weakening and presentation',code:presentationCode});const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
  const resources={0:buffers.joints,1:sections.buffer,2:coefficients,3:buffers.geometry,4:buffers.positions,5:buffers.rotations,6:buffers.rest,7:matrices,8:texture,9:parameters},stages={};
  for(const [entryPoint,indices]of [['weaken',[0,1,2,3,9]],['present',[0,4,5,6,7,8,9]]]){const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:indices.map(binding=>({binding,resource:binding===8?texture.createView():{buffer:resources[binding]}}))});stages[entryPoint]={pipeline,group};}
  const localSupport=s=>({...s,position:s.position.map((v,k)=>v-frame.origin[k])});
  motion=await createBurnRigidIslandsGpu({device,positions:buffers.positions,rotations:buffers.rotations,velocities:buffers.velocities,angular:buffers.angular,boxes:buffers.boxes,joints:buffers.joints,bodies:n,bonds:m,supports:finiteSupports.map(localSupport),gravity,timeStep:h/substeps,iterations:prepared.config.solverIterations});
  liveBodies=await createBurnRegionBodiesGpu({device,field,mapping:regionMapping,envelopes:prepared.cells.map(c=>({min:c.position.map((v,k)=>v-c.halfExtents[k]),max:c.position.map((v,k)=>v+c.halfExtents[k])})),rest:buffers.rest,positions:buffers.positions,rotations:buffers.rotations,boxes:buffers.boxes,inertia,velocities:buffers.velocities,angular:buffers.angular,joints:buffers.joints,contacts:emptyContacts});
  const dispatch=(encoder,name)=>{const stage=stages[name],pass=encoder.beginComputePass({label:'Burn rigid '+name});pass.setPipeline(stage.pipeline);pass.setBindGroup(0,stage.group);pass.dispatchWorkgroups(Math.ceil((name==='weaken'?m:n+m)/64));pass.end();};
  function presentMaterial(){const encoder=device.createCommandEncoder();liveBodies.encode(encoder);dispatch(encoder,'weaken');motion.encodeTopology(encoder);dispatch(encoder,'present');device.queue.submit([encoder.finish()]);}
  presentMaterial();
  const residentMotion={device,buffers,bodies:n,bonds:m,origin:frame.origin,timeStep:h,substeps,iterations:prepared.config.solverIterations,
   setClockPhase(value){if(disposed)throw Error('Burn fracture disposed');if(!Number.isFinite(value)||value<0||value>=h)throw Error('Shared clock phase must be within its fixed step');remainder=value;},
   encodeMaterial(encoder){if(disposed)throw Error('Burn fracture disposed');liveBodies.encode(encoder);dispatch(encoder,'weaken');},
   encodePresentation(encoder,clock){if(disposed)throw Error('Burn fracture disposed');steps+=clock.steps;seconds+=clock.seconds;remainder=clock.remainder;motion.encodeTopology(encoder);dispatch(encoder,'present');},
  };
  return {texture,wrapper,matrices,residentMotion,
   setGravity(value){motion.setGravity(value);gravity=[...value];},
   setContactsEnabled(value){if(disposed)throw Error('Burn fracture disposed');motion.setContactsEnabled(value);contactsEnabled=value;},
   setSupport(index,next){if(disposed)throw Error('Burn fracture disposed');if(!Number.isInteger(index)||index<0||index>=finiteSupports.length)throw Error('Unknown finite support');const s=checkedBurnSupport(next);if(s.friction!==finiteSupports[index].friction||s.halfExtents.some((v,k)=>v!==finiteSupports[index].halfExtents[k]))throw Error('Support resizing requires reconstruction');finiteSupports[index]=s;motion.setSupport(index,localSupport(s));},
   advance(dt){if(disposed)throw Error('Burn fracture disposed');if(!Number.isFinite(dt)||dt<0||!Number.isFinite(remainder+dt))throw Error('Finite nonnegative mechanics duration required');remainder+=dt;
    const encoder=device.createCommandEncoder();liveBodies.encode(encoder);dispatch(encoder,'weaken');
    while(remainder+Number.EPSILON>=h){for(let i=0;i<substeps;i++)motion.encode(encoder);steps++;seconds+=h;remainder=Math.max(0,remainder-h);}
    dispatch(encoder,'present');device.queue.submit([encoder.finish()]);
   },
   reset(){if(disposed)throw Error('Burn fracture disposed');for(const [key,data]of Object.entries(initial))device.queue.writeBuffer(buffers[key],0,data);steps=0;seconds=0;remainder=0;presentMaterial();},
   read:()=>({identity:BURN_FRACTURE_IDENTITY,engine:'resident-rigid-islands-v1',steps,seconds,remainder,regions:n,connections:m,supports:[],finiteSupports:structuredClone(finiteSupports),contactsEnabled,regionMasses:[...regionMasses],gravity:[...gravity],material:{...material},...motion.read(),clock:'fixed-step-with-retained-remainder',residency:'same-device-pose-buffer-and-texture',massModel:'live-region-fuel-surviving-box-inertia'}),
   // Explicit diagnostic snapshots are not used by playback or presentation.
   async snapshot(){if(disposed)throw Error('Burn fracture disposed');const ordered=[matrices,buffers.positions,buffers.rotations,buffers.velocities,buffers.angular,buffers.joints,buffers.geometry,damage,buffers.boxes,buffers.rest,inertia,liveBodies.shape,motion.links,motion.islands];const bytes=ordered.reduce((s,b)=>s+b.size,0),staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    try{const encoder=device.createCommandEncoder();let offset=0;for(const b of ordered){encoder.copyBufferToBuffer(b,0,staging,offset,b.size);offset+=b.size;}device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);const raw=new Uint8Array(staging.getMappedRange()),arrays=[];offset=0;for(const b of ordered){arrays.push(new Float32Array(raw.slice(offset,offset+b.size).buffer));offset+=b.size;}
     const words=new Uint32Array(arrays[5].buffer),links=new Uint32Array(arrays[12].buffer);return {state:this.read(),matrices:Array.from(arrays[0]),positions:Array.from(arrays[1]),quaternions:Array.from(arrays[2]),velocities:Array.from(arrays[3]),angularVelocities:Array.from(arrays[4]),supportPositions:finiteSupports.flatMap(s=>[...localSupport(s).position,0]),supportQuaternions:finiteSupports.flatMap(s=>s.quaternion),supportCollisionMasks:finiteSupports.map(()=>contactsEnabled?1:0),joints:Array.from(arrays[5]),alive:prepared.bonds.map((_,i)=>words[i*44+3]===1),geometry:Array.from(arrays[6]),damage:Array.from(arrays[7]),boxes:Array.from(arrays[8]),centers:Array.from(arrays[9]),inverseInertia:Array.from(arrays[10]),remainingBodies:Array.from(arrays[11]),islandLinks:Array.from(links),islands:Array.from(arrays[13]),origin:frame.origin};
    }finally{staging.unmap();staging.destroy();}
   },dispose,
  };
 }catch(error){dispose();throw error;}
}
