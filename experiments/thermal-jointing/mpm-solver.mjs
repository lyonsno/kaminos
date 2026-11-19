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
 if(c.dt*(24*c.diffusivity+c.cooling)>.8)throw Error('Thermal explicit diffusion step is too large');
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
 let config=thermalConfig(options),step=0,disposed=false,completed={step:0,time:0},fault=null;
 const authored=()=>Object.fromEntries(Object.entries(config).filter(([k])=>!['count','gridSize','gridNodes'].includes(k)));
 const owned=[],U=GPUBufferUsage,N=config.gridNodes*2;
 const make=(size,usage,label)=>{if(size>device.limits.maxBufferSize||((usage&U.STORAGE)&&size>device.limits.maxStorageBufferBindingSize))throw Error('Thermal state exceeds device buffer limits: '+label);const b=device.createBuffer({size,usage,label});owned.push(b);return b;};
 const storage=(size,label)=>make(size,U.STORAGE|U.COPY_SRC|U.COPY_DST,label);
 const particles=particleBuffer??storage(config.count*PARTICLE_WORDS*4,'Persistent thermal material points');
 if(particles.size!==config.count*PARTICLE_WORDS*4)throw Error('Thermal particle buffer size differs from effective resolution');
 const params=make(96,U.UNIFORM|U.COPY_DST,'Thermal material parameters');
 const resources={0:particles,1:storage(N*64,'Transfer atomics'),2:storage(N*64,'Two motion fields'),
  3:params,4:storage(config.gridNodes*8,'Damage gradient orientation'),5:storage(N*16,'Phase PCG'),
  6:storage(N*4,'Phase stiffness atomics'),7:storage(config.count*16,'Phase gradient'),
  8:storage(Math.ceil(N/128)*16,'Phase reduction'),9:storage(32,'Phase and material clocks'),10:storage(config.count*4,'Persistent material heat increments'),
  11:storage((config.gridNodes+1)*4,'Particle bin heads and damage presence'),12:storage(config.count*4,'Particle bin links'),
  13:storage(32,'Material fault and completion counters')};
 device.queue.writeBuffer(params,0,uniforms(config));
 const module=device.createShaderModule({code:THERMAL_MPM_WGSL,label:'Thermal phase-field MPM'});
 const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
 if(errors.length){for(const b of owned)b.destroy();throw Error(errors.map(m=>m.lineNum+': '+m.message).join('; '));}
 const specs={
 initialize:[0,3],updateStrength:[0,3],binParticles:[0,3,11,12,13],damageGradients:[0,3,4,11,12,13],gradientSeeds:[0,3,4,13],
 deposit:[0,1,3,4,13],reconcile:[1,2,3,13],heatStep:[0,3,10,13],
 phaseSeed:[2,5],matrixGather:[0,2,3,4,5,7,13],matrixScatter:[0,2,3,4,6,7,13],
 phaseStart:[2,5,6],dotPA:[2,5,6,8],reducePA:[8,9],
 phaseUpdate:[2,5,8,9],reduceR:[8,9],phaseDirection:[2,5,9],
 gather:[0,2,3,4,5,10,13],finishStep:[3,9,13]};
 const kernels={};
 try{
 for(const [name,bindings] of Object.entries(specs)){
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:name},label:'Thermal '+name});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:{buffer:resources[binding]}}))});
  kernels[name]={pipeline,group};
 }
 }catch(error){for(const b of owned)b.destroy();throw error;}
 // Keep consecutive dispatches together. Buffer clears end the current pass.
 function commands() {
  const encoder = device.createCommandEncoder();
  let pass;
  function endPass() {
   if (!pass) return;
   pass.end();
   pass = null;
  }
  return {
   dispatch(name, count) {
    const groups = Math.ceil(count / 128);
    if (groups > device.limits.maxComputeWorkgroupsPerDimension) {
     throw Error('Thermal dispatch exceeds hardware workgroup dimension');
    }
    pass ??= encoder.beginComputePass({label: 'Thermal ' + name});
    const {pipeline, group} = kernels[name];
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(groups);
   },
   clearBuffer(...args) {
    endPass();
    encoder.clearBuffer(...args);
   },
   finish() {
    endPass();
    return encoder.finish();
   },
  };
 }
 function matrix(e) {
  e.clearBuffer(resources[6]);
  e.dispatch('matrixGather', config.count);
  e.dispatch('matrixScatter', config.count);
 }
 function ensure(){if(disposed)throw Error('Thermal solver disposed');if(fault)throw Error(fault);}
 const reset=()=>{
  if(disposed)throw Error('Thermal solver disposed');const e=commands();
  e.clearBuffer(resources[9]);e.clearBuffer(resources[13]);e.dispatch('initialize',config.count);device.queue.submit([e.finish()]);step=0;completed={step:0,time:0};fault=null;
 };
 const read=()=>({route:'thermal-reference-heat-phase-field-mpm.webgpu.v1',count:config.count,thermalRoute:'reference-material-six-neighbor-diffusion',materialPointSpacing:.5,mechanicalGridSpacing:1,blockWidth:config.particlesPerAxis*.5,submittedSteps:step,completedSteps:completed.step,time:completed.time,fault,config:{...config}});
 async function readBuffers(entries){
  const e=device.createCommandEncoder();const staging=entries.map(([buffer,bytes])=>{const b=device.createBuffer({size:bytes,usage:U.COPY_DST|U.MAP_READ});e.copyBufferToBuffer(buffer,0,b,0,bytes);return b;});
  try{device.queue.submit([e.finish()]);await Promise.all(staging.map(b=>b.mapAsync(GPUMapMode.READ)));return staging.map(b=>b.getMappedRange().slice(0));}
  finally{for(const b of staging)b.destroy();}
 }
 async function status(){
  const [raw,clock]=await readBuffers([[resources[13],32],[resources[9],32]]),d=new Uint32Array(raw);
  completed={step:d[6],time:new Float32Array(clock)[4]};
  if(d[0]||d[1]||d[2])fault='Material solve paused: '+JSON.stringify({invalidDeformation:d[0],escapedSupport:d[1],nonfiniteOrAtomicRange:d[2],arithmetic:{nonfiniteValues:d[3],fixedPointRange:d[5],floatOverflow:d[7],other:d[2]-d[3]-d[5]-d[7]}});
  return {...read(),arithmetic:{nonfiniteValues:d[3],fixedPointRange:d[5],floatOverflow:d[7],other:d[2]-d[3]-d[5]-d[7]},splitNodes:d[4],phasePreconditionedResidual:new Float32Array(clock)[2],diagnostics:Array.from(d)};
 }
 reset();
 return {particles,get config(){return {...config};},
  setOptions(patch){ensure();const c=thermalConfig({...authored(),...patch});if(c.count!==config.count||c.gridSize!==config.gridSize)throw Error('Resolution/reference extent change requires a new thermal solver');for(const key of ['prestrain','preparedSplit','splitVelocity'])if(c[key]!==config[key])throw Error('Initialization option '+key+' requires a new thermal solver');
   const strengthChanged=c.variation!==config.variation;config=c;device.queue.writeBuffer(params,0,uniforms(config));
   if(strengthChanged){const e=commands();e.dispatch('updateStrength',config.count);device.queue.submit([e.finish()]);}return read();},
  advance(steps=1){
   ensure();if(!Number.isSafeInteger(steps)||steps<1)throw Error('Positive integral step count required');
   const e=commands();
   for(let s=0;s<steps;s++){
    e.clearBuffer(resources[1]);e.clearBuffer(resources[4]);e.clearBuffer(resources[11]);e.clearBuffer(resources[13],16,4);
    e.dispatch('binParticles',config.count);e.dispatch('damageGradients',config.count);e.dispatch('gradientSeeds',config.count);
    e.dispatch('deposit',config.count);e.dispatch('reconcile',config.gridNodes);e.dispatch('heatStep',config.count);
    e.dispatch('phaseSeed',N);
    if(config.damage){
     matrix(e);e.dispatch('phaseStart',N);
     for(let k=0;k<config.phaseIterations;k++){
      matrix(e);e.dispatch('dotPA',N);e.dispatch('reducePA',128);e.dispatch('phaseUpdate',N);
      e.dispatch('reduceR',128);e.dispatch('phaseDirection',N);
     }
    }
    e.dispatch('gather',config.count);e.dispatch('finishStep',1);
   }
   device.queue.submit([e.finish()]);step+=steps;return read();
  },
  reset,read,status,
  async snapshot(){const state=await status();const [raw]=await readBuffers([[particles,particles.size]]);return {state,particles:new Float32Array(raw)};},
  dispose(){if(disposed)return;disposed=true;for(const b of owned)b.destroy();}
 };
}
