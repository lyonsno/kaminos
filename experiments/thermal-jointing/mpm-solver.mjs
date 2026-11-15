import {THERMAL_MPM_WGSL} from './mpm-kernels.mjs';
export const PARTICLE_WORDS=44;
export function thermalConfig(input={}) {
 const c={particlesPerAxis:16,dt:.003,mu:20,bulk:50,contraction:.06,diffusivity:.6,cooling:5,
  ambient:0,fixedBase:true,length:.6,toughness:.025,residual:.00001,variation:.1,
  gravity:0,damping:.05,friction:.4,separation:.65,phaseIterations:8,
  prestrain:0,preparedSplit:false,splitVelocity:.2,damage:true,separationEnabled:true,...input};
 for(const k of Object.keys(input))if(!(k in {particlesPerAxis:1,dt:1,mu:1,bulk:1,contraction:1,diffusivity:1,cooling:1,ambient:1,fixedBase:1,length:1,toughness:1,residual:1,variation:1,gravity:1,damping:1,friction:1,separation:1,phaseIterations:1,prestrain:1,preparedSplit:1,splitVelocity:1,damage:1,separationEnabled:1}))throw Error('Unknown thermal option '+k);
 for(const [k,v] of Object.entries(c))if(!['fixedBase','preparedSplit','damage','separationEnabled'].includes(k)&&!Number.isFinite(v))throw Error('Finite thermal option required: '+k);
 for(const k of ['fixedBase','preparedSplit','damage','separationEnabled'])if(typeof c[k]!=='boolean')throw Error('Boolean thermal option required: '+k);
 if(!Number.isSafeInteger(c.particlesPerAxis)||c.particlesPerAxis<4||!Number.isSafeInteger(c.phaseIterations)||c.phaseIterations<1)throw Error('Positive integral thermal resolution/iterations required');
 if(c.dt<=0||c.mu<=0||c.bulk<=0||c.length<=0||c.toughness<=0||c.prestrain<=-1||c.contraction<0||c.contraction>=1)throw Error('Invalid positive thermal material domain');
 for(const k of ['diffusivity','cooling','damping','friction','splitVelocity'])if(c[k]<0)throw Error('Nonnegative thermal option required: '+k);
 for(const k of ['ambient','residual','variation','separation'])if(c[k]<0||c[k]>1)throw Error('Unit interval thermal option required: '+k);
 if(c.dt*(6*c.diffusivity+c.cooling)>.8)throw Error('Thermal explicit diffusion step is too large');
 if(c.dt*Math.sqrt(c.bulk+4*c.mu/3)>.35)throw Error('Thermal mechanical step exceeds initial elastic CFL');
 c.count=c.particlesPerAxis**3;c.gridSize=Math.ceil(c.particlesPerAxis*.5*(1+c.prestrain))+8;c.gridNodes=c.gridSize**3;
 return c;
}
function uniforms(c) {
 const bytes=new ArrayBuffer(96),u=new Uint32Array(bytes),f=new Float32Array(bytes);
 u.set([c.gridSize,c.particlesPerAxis,c.count,0]);
 f.set([c.dt,c.mu,c.bulk,c.contraction],4);
 f.set([c.diffusivity,c.cooling,c.ambient,c.fixedBase?1:0],8);
 f.set([c.length,c.toughness,c.residual,c.variation],12);
 f.set([c.gravity,c.damping,c.friction,c.separationEnabled?c.separation:2],16);
 f.set([c.prestrain,c.preparedSplit?1:0,c.splitVelocity,c.damage?1:0],20);
 return bytes;
}
export async function createThermalMpm({device,options={},particleBuffer=null}) {
 let config=thermalConfig(options),step=0,disposed=false;
 const owned=[],U=GPUBufferUsage;
 const make=(size,usage,label)=>{if(size>device.limits.maxBufferSize||size>device.limits.maxStorageBufferBindingSize)throw Error('Thermal state exceeds device buffer limits: '+label);const b=device.createBuffer({size,usage,label});owned.push(b);return b;};
 const particles=particleBuffer??make(config.count*PARTICLE_WORDS*4,U.STORAGE|U.COPY_SRC|U.COPY_DST,'Persistent thermal material points');
 const params=make(96,U.UNIFORM|U.COPY_DST,'Thermal material parameters');
 device.queue.writeBuffer(params,0,uniforms(config));
 const resources={0:particles,3:params},kernels={};
 async function kernel(name,bindings) {
  const module=device.createShaderModule({code:THERMAL_MPM_WGSL,label:'Thermal '+name});
  const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
  if(errors.length)throw Error(errors.map(m=>m.message).join('; '));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:name},label:'Thermal '+name});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:{buffer:resources[binding]}}))});
  kernels[name]={pipeline,group};
 }
 function dispatch(e,name,count) {const k=kernels[name],groups=Math.ceil(count/128);if(groups>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Thermal dispatch exceeds hardware workgroup dimension');const p=e.beginComputePass({label:'Thermal '+name});p.setPipeline(k.pipeline);p.setBindGroup(0,k.group);p.dispatchWorkgroups(groups);p.end();}
 await kernel('initialize',[0,3]);
 const reset=()=>{const e=device.createCommandEncoder();dispatch(e,'initialize',config.count);device.queue.submit([e.finish()]);step=0;};
 reset();
 return {particles,get config(){return {...config};},
  setOptions(patch){const c=thermalConfig({...config,...patch});if(c.count!==config.count)throw Error('Resolution change requires a new thermal solver');config=c;device.queue.writeBuffer(params,0,uniforms(config));},
  advance(steps=1){if(disposed)throw Error('Thermal solver disposed');if(!Number.isSafeInteger(steps)||steps<1)throw Error('Positive integral step count required');step+=steps;},
  reset,
  read:()=>({route:'thermal-phase-field-mpm.webgpu.v0',count:config.count,step,time:step*config.dt,config:{...config}}),
  async snapshot(){const b=device.createBuffer({size:particles.size,usage:U.COPY_DST|U.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(particles,0,b,0,particles.size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);return {state:this.read(),particles:new Float32Array(b.getMappedRange()).slice()};}finally{b.destroy();}},
  dispose(){disposed=true;for(const b of owned)b.destroy();}
 };
}
