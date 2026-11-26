import {THERMAL_MPM_WGSL} from './mpm-kernels.mjs';
export const PARTICLE_WORDS=44;
export function thermalConfig(input={}) {
 const defaults={particlesPerAxis:16,thicknessPoints:0,gridPadding:0,boxWalls:true,floor:false,
  dt:.003,mu:20,bulk:50,contraction:.06,diffusivity:.6,cooling:5,
  ambient:0,fixedBase:true,length:.6,toughness:.025,residual:.00001,variation:.1,
  gravity:0,damping:.05,friction:.4,separation:.65,phaseIterations:8,
  prestrain:0,preparedSplit:false,splitVelocity:.2,damage:true,separationEnabled:true};
 const c={...defaults,...input};
 for(const [key,value] of Object.entries(c)){
  if(!Object.hasOwn(defaults,key))throw Error('Unknown thermal option '+key);
  if(typeof defaults[key]==='boolean'){
   if(typeof value!=='boolean')throw Error('Boolean thermal option required: '+key);
  }else if(!Number.isFinite(value))throw Error('Finite thermal option required: '+key);
 }
 if(!Number.isSafeInteger(c.particlesPerAxis)||c.particlesPerAxis<4||!Number.isSafeInteger(c.phaseIterations)||c.phaseIterations<1)throw Error('Positive integral thermal resolution/iterations required');
 if(c.dt<=0||c.mu<=0||c.bulk<=0||c.length<=0||c.toughness<=0||c.prestrain<=-1||c.contraction<0||c.contraction>=1)throw Error('Invalid positive thermal material domain');
 for(const k of ['diffusivity','cooling','damping','friction','splitVelocity'])if(c[k]<0)throw Error('Nonnegative thermal option required: '+k);
 for(const k of ['ambient','residual','variation','separation'])if(c[k]<0||c[k]>1)throw Error('Unit interval thermal option required: '+k);
 if(c.dt*(24*c.diffusivity+c.cooling)>.8)throw Error('Thermal explicit diffusion step is too large');
 if(c.dt*Math.sqrt(c.bulk+4*c.mu/3)>.35)throw Error('Thermal mechanical step exceeds initial elastic CFL');
 for(const key of ['thicknessPoints','gridPadding']){
  if(!Number.isSafeInteger(c[key])||c[key]<0)throw Error('Nonnegative integral thermal option required: '+key);
 }
 c.heightPoints=c.thicknessPoints||c.particlesPerAxis;
 c.count=c.particlesPerAxis**2*c.heightPoints;
 const gridExtent=points=>Math.ceil(points*.5*(1+c.prestrain))+8+2*c.gridPadding;
 c.gridSize=gridExtent(c.particlesPerAxis);
 c.gridHeight=gridExtent(c.heightPoints);
 c.gridNodes=c.gridSize**2*c.gridHeight;
 return c;
}
export function thermalOptions(config) {
 const {heightPoints,count,gridSize,gridHeight,gridNodes,...options}=config;
 return options;
}
export function sameThermalAllocation(a,b) {
 return ['particlesPerAxis','heightPoints','gridPadding','gridSize','gridHeight'].every(key=>a[key]===b[key]);
}
export function validateThermalAllocation(device,config) {
 const capacity=Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize);
 const largestBinding=Math.max(config.count*PARTICLE_WORDS*4,config.gridNodes*2*64);
 if(largestBinding>capacity)throw Error('Thermal material or grid exceeds device storage limits');
 const largestDispatch=Math.ceil(Math.max(config.count,config.gridNodes*2)/128);
 if(largestDispatch>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Thermal dispatch exceeds hardware workgroup dimension');
}
const DIAGNOSTIC_BYTES=15*4;
const WALL_FACES=['xLow','xHigh','yLow','yHigh','zLow','zHigh'];
function uniforms(c) {
 const bytes=new ArrayBuffer(112),u=new Uint32Array(bytes),f=new Float32Array(bytes);
 u.set([c.gridSize,c.particlesPerAxis,c.count,c.heightPoints]);
 f.set([c.dt,c.mu,c.bulk,c.contraction],4);
 f.set([c.diffusivity,c.cooling,c.ambient,c.fixedBase?1:0],8);
 f.set([c.length,c.toughness,c.residual,c.variation],12);
 f.set([c.gravity,c.damping,c.friction,c.separationEnabled?c.separation:2],16);
 f.set([c.prestrain,c.preparedSplit?1:0,c.splitVelocity,c.damage?1:0],20);
 u.set([c.gridHeight,c.gridPadding,Number(c.boxWalls),Number(c.floor)],24);
 return bytes;
}

export async function createThermalMpm({device,options={},particleBuffer=null}) {
 let config=thermalConfig(options),step=0,disposed=false,completed={step:0,time:0},fault=null;
 validateThermalAllocation(device,config);
 const owned=[],U=GPUBufferUsage,N=config.gridNodes*2;
 const make=(size,usage,label)=>{if(size>device.limits.maxBufferSize||((usage&U.STORAGE)&&size>device.limits.maxStorageBufferBindingSize))throw Error('Thermal state exceeds device buffer limits: '+label);const b=device.createBuffer({size,usage,label});owned.push(b);return b;};
 const storage=(size,label)=>make(size,U.STORAGE|U.COPY_SRC|U.COPY_DST,label);
 const particles=particleBuffer??storage(config.count*PARTICLE_WORDS*4,'Persistent thermal material points');
 if(particles.size!==config.count*PARTICLE_WORDS*4)throw Error('Thermal particle buffer size differs from effective resolution');
 const params=make(112,U.UNIFORM|U.COPY_DST,'Thermal material parameters');
 const resources={0:particles,1:storage(N*64,'Transfer atomics'),2:storage(N*64,'Two motion fields'),
  3:params,4:storage(config.gridNodes*8,'Damage gradient orientation'),5:storage(N*16,'Phase PCG'),
  6:storage(N*4,'Phase stiffness atomics'),7:storage(config.count*16,'Phase gradient'),
  8:storage(Math.ceil(N/128)*16,'Phase reduction'),9:storage(32,'Phase and material clocks'),10:storage(config.count*4,'Persistent material heat increments'),
  11:storage((config.gridNodes+1)*4,'Particle bin heads and damage presence'),12:storage(config.count*4,'Particle bin links'),
  13:storage(DIAGNOSTIC_BYTES,'Material faults, steps and boundary counters')};
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
 const read=()=>({route:'thermal-reference-heat-phase-field-mpm.webgpu.v1',count:config.count,thermalRoute:'reference-material-six-neighbor-diffusion',materialPointSpacing:.5,mechanicalGridSpacing:1,blockWidth:config.particlesPerAxis*.5,blockHeight:config.heightPoints*.5,submittedSteps:step,completedSteps:completed.step,time:completed.time,fault,config:{...config}});
 async function readBuffers(entries){
  const e=device.createCommandEncoder();const staging=entries.map(([buffer,bytes])=>{const b=device.createBuffer({size:bytes,usage:U.COPY_DST|U.MAP_READ});e.copyBufferToBuffer(buffer,0,b,0,bytes);return b;});
  try{device.queue.submit([e.finish()]);await Promise.all(staging.map(b=>b.mapAsync(GPUMapMode.READ)));return staging.map(b=>b.getMappedRange().slice(0));}
  finally{for(const b of staging)b.destroy();}
 }
 async function status(){
  const [raw,clock]=await readBuffers([[resources[13],DIAGNOSTIC_BYTES],[resources[9],32]]),d=new Uint32Array(raw);
  completed={step:d[6],time:new Float32Array(clock)[4]};
  if(d[0]||d[1]||d[2])fault='Material solve paused: '+JSON.stringify({invalidDeformation:d[0],escapedSupport:d[1],nonfiniteOrAtomicRange:d[2],arithmetic:{nonfiniteValues:d[3],fixedPointRange:d[5],floatOverflow:d[7],other:d[2]-d[3]-d[5]-d[7]}});
  const wallStops=Object.fromEntries(WALL_FACES.map((face,index)=>[face,d[8+index]]));
  return {...read(),arithmetic:{nonfiniteValues:d[3],fixedPointRange:d[5],floatOverflow:d[7],other:d[2]-d[3]-d[5]-d[7]},splitNodes:d[4],phasePreconditionedResidual:new Float32Array(clock)[2],diagnostics:Array.from(d.slice(0,8)),wallStops,floorStops:d[14]};
 }
 reset();
 return {particles,get config(){return {...config};},
  setOptions(patch){ensure();const c=thermalConfig({...thermalOptions(config),...patch});if(!sameThermalAllocation(c,config))throw Error('Resolution/reference extent change requires a new thermal solver');for(const key of ['prestrain','preparedSplit','splitVelocity'])if(c[key]!==config[key])throw Error('Initialization option '+key+' requires a new thermal solver');
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
