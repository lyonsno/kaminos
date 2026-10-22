import {StorageBufferAttribute} from '../../lib/three.webgpu.js';
import {prepareGpuVolume} from './volume.mjs';
import {edgeMatrix,inverse,determinant,tetrahedron} from './elastic.mjs';
import {volumeKernel} from './gpu-volume-kernel.mjs';

// CPU owns topology, authored targets and commands. Physical offsets/velocities
// live on the same GPU device and storage buffer the skin shader consumes.
// snapshot() is an explicit diagnostic/export readback, never a stepping input.
export function createGpuFleshVolume(source,settings={}){
 const config={young:30,poisson:.35,bulk:100,density:1,contact:500,damping:.92,iterations:12,lineSearchTrials:8,...settings};
 const topology=prepareGpuVolume(source,config),{nodes:n}=topology;
 // Reference constructor validates material settings, including Poisson ratio.
 tetrahedron(source.tetrahedra[0].map(i=>source.positions[i]),config);
 if(!Number.isFinite(config.contact)||config.contact<=0||!Number.isFinite(config.damping)||config.damping<0||config.damping>1||![config.iterations,config.lineSearchTrials].every(x=>Number.isSafeInteger(x)&&x>0))throw Error('Invalid GPU solver settings');
 const attribute=new StorageBufferAttribute(new Float32Array((2*n+1)*4),4);attribute.name='physical-offsets-velocities';
 const targetAttribute=new StorageBufferAttribute(new Float32Array(n*4),4);targetAttribute.name='physical-target-points';
 let renderer,device,pipeline,bindGroup,buffers=[],disposed=false,steps=0,epoch=0,enabled=true,resetPending=true,sphere=null,lastSnapshot=null,validation,valid=false;
 let targets=structuredClone(source.positions),rotations=source.positions.map(()=>[1,0,0,0]);
 const originalSigns=source.tetrahedra.map(t=>Math.sign(determinant(edgeMatrix(t.map(i=>source.positions[i])))));
 let referenceBytes;
 function setTargets(next,deltaRotations=source.positions.map(()=>[1,0,0,0])){
  if(next?.length!==n||!next.every(v=>v?.length===3&&v.every(Number.isFinite))||deltaRotations?.length!==n||!deltaRotations.every(q=>q?.length===4&&q.every(Number.isFinite)&&Math.abs(Math.hypot(...q)-1)<1e-5))throw Error('Matching finite targets and unit transport rotations required');
  const packed=new Float32Array(source.tetrahedra.length*16);
  source.tetrahedra.forEach((t,e)=>{
   const D=edgeMatrix(t.map(i=>next[i])),det=determinant(D);
   if(Math.sign(det)!==originalSigns[e])throw Error('Pose reference inverted element '+e);
   const inv=inverse(D);for(let c=0;c<3;c++)packed.set([inv[c],inv[3+c],inv[6+c],0],e*16+c*4);packed[e*16+12]=Math.abs(det)/6;
  });
  targets=structuredClone(next);rotations=structuredClone(deltaRotations);referenceBytes=packed;epoch++;
  for(let i=0;i<n;i++)targetAttribute.array.set(targets[i],i*4);targetAttribute.needsUpdate=true;
 }
 setTargets(targets);
 function bind(actualRenderer){
  if(disposed)throw Error('GPU flesh disposed');
  if(!actualRenderer?.backend?.isWebGPUBackend||!actualRenderer.backend.device)throw Error('Physical solve requires the actual WebGPU renderer/device; no CPU fallback');
  if(renderer&&renderer!==actualRenderer)throw Error('Physical renderer changed');if(renderer)return;
  renderer=actualRenderer;device=renderer.backend.device;
  const required=n*16*3+8;if(required>device.limits.maxComputeWorkgroupStorageSize)throw Error('Physical body exceeds device workgroup storage: '+required+' > '+device.limits.maxComputeWorkgroupStorageSize);
  renderer.backend.createStorageAttribute(attribute);
  const buffer=(label,size,usage,values)=>{const b=device.createBuffer({label,size,usage});buffers.push(b);if(values)device.queue.writeBuffer(b,0,values);return b;};
  const targetBuffer=buffer('flesh targets and rotations',n*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
  const refsBuffer=buffer('flesh pose metric',referenceBytes.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
  const tets=buffer('flesh elements',topology.tets.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,topology.tets);
  const graph=buffer('flesh incidence and colours',topology.graph.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,topology.graph);
  const params=buffer('flesh parameters',64,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const module=device.createShaderModule({label:'flesh elastic volume',code:volumeKernel(topology)});
  validation=module.getCompilationInfo().then(info=>{const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));valid=true;});validation.catch(()=>{});
  pipeline=device.createComputePipeline({label:'physical StVK coloured local solve',layout:'auto',compute:{module,entryPoint:'main'}});
  const state=renderer.backend.get(attribute).buffer;
  bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[state,targetBuffer,refsBuffer,tets,graph,params].map((buffer,binding)=>({binding,resource:{buffer}}))});
 }
 function step(dt){
  if(disposed||!device||!valid)throw Error('Physical GPU must be bound and shader-validated before stepping');
  if(!(Number.isFinite(dt)&&dt>0))throw Error('Positive finite physical timestep required');
  const targetBytes=new Float32Array(n*8);for(let i=0;i<n;i++){targetBytes.set([...targets[i],topology.mass[i]],i*8);targetBytes.set(rotations[i],i*8+4);}
  const {young,poisson,bulk,contact,damping,iterations,lineSearchTrials}=config,mu=young/(2*(1+poisson)),lambda=young*poisson/((1+poisson)*(1-2*poisson));
  device.queue.writeBuffer(buffers[0],0,targetBytes);device.queue.writeBuffer(buffers[1],0,referenceBytes);
  device.queue.writeBuffer(buffers[4],0,new Float32Array([dt,damping,mu,lambda,bulk,contact,iterations,lineSearchTrials,...(sphere?.center??[0,0,0]),sphere?.radius??0,enabled?1:0,resetPending?1:0,0,0]));
  const encoder=device.createCommandEncoder({label:'physical flesh step'}),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.dispatchWorkgroups(1);pass.end();device.queue.submit([encoder.finish()]);
  resetPending=false;rotations=source.positions.map(()=>[1,0,0,0]);steps++;epoch++;
 }
 function read(){return{route:'webgpu-pose-conditioned-tetrahedral-local-energy-v1',backend:device?'webgpu':'unbound',nodes:n,elements:topology.elements,colours:topology.colourCount,steps,epoch,enabled,settings:config,sphere,readbackInStep:false,snapshot:lastSnapshot&&{...lastSnapshot,offsets:undefined,points:undefined,epoch:lastSnapshot.epoch,current:lastSnapshot.epoch===epoch}};}
 return{attribute,targetAttribute,bind,step,read,setTargets,validate:()=>validation??Promise.reject(Error('Physical GPU has not been bound')),
  setSphere(value){if(value!==null&&(!Array.isArray(value?.center)||value.center.length!==3||!value.center.every(Number.isFinite)||!(Number.isFinite(value.radius)&&value.radius>0)))throw Error('Finite sphere and positive radius required');sphere=value&&structuredClone(value);},
  setEnabled(value){if(typeof value!=='boolean')throw Error('Boolean physical response required');enabled=value;if(!value){const zero=new Float32Array((2*n+1)*4);zero[n*8+1]=steps;if(device)device.queue.writeBuffer(renderer.backend.get(attribute).buffer,0,zero);resetPending=true;lastSnapshot=null;epoch++;}},
  reset(){resetPending=true;steps=0;lastSnapshot=null;epoch++;if(device)device.queue.writeBuffer(renderer.backend.get(attribute).buffer,0,new Float32Array((2*n+1)*4));},
  setMaterial(value){tetrahedron(source.tetrahedra[0].map(i=>source.positions[i]),{...config,...value});Object.assign(config,value);this.reset();},
  targets:()=>structuredClone(targets),
  async snapshot(){
   if(!renderer)throw Error('Physical GPU has not been rendered');const capturedEpoch=epoch,capturedTargets=structuredClone(targets),capturedSteps=steps;
   const data=new Float32Array(await renderer.getArrayBufferAsync(attribute));
   if(data.length!==(2*n+1)*4)throw Error('Incomplete GPU physical readback layout');
   if(!data.every(Number.isFinite))throw Error('Nonfinite physical GPU state');
   if(data[n*8+2]!==0)throw Error('GPU physical reference fault: zero residual is not feasible');
   if(!Number.isSafeInteger(data[n*8+1])||data[n*8+1]!==capturedSteps)throw Error('GPU physical dispatch did not execute matching steps');
   const offsets=Array.from({length:n},(_,i)=>Array.from(data.slice(i*4,i*4+3))),points=capturedTargets.map((p,i)=>p.map((v,a)=>v+offsets[i][a]));
   let minJ=Infinity,maxJ=-Infinity,total=0,reference=0;
   source.tetrahedra.forEach(t=>{const ref=tetrahedron(t.map(i=>capturedTargets[i]),config),r=ref.evaluate(t.map(i=>points[i]));minJ=Math.min(minJ,r.J);maxJ=Math.max(maxJ,r.J);total+=ref.volume*r.J;reference+=ref.volume;});
   lastSnapshot={epoch:capturedEpoch,steps:capturedSteps,offsets,points,minJ,maxJ,volumeRatio:total/reference,maxDisplacement:Math.max(...offsets.map(p=>Math.hypot(...p))),transportRetainedFraction:data[n*8],gpuSteps:data[n*8+1]};return structuredClone(lastSnapshot);
  },
  dispose(){if(disposed)return;disposed=true;for(const b of buffers)b.destroy();if(renderer){renderer._attributes.delete(attribute);renderer._attributes.delete(targetAttribute);}},
 };
}
