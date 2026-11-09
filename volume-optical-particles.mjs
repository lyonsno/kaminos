import {INTEGRAL_PRESENT_WGSL} from './volume-integral-reconstruction.mjs';

export function opticalParticleSettings(input={}) {
 const s={enabled:false,refresh:.18,depthSupport:2,radius:.4,stretch:2,gain:1,opacity:1,
  burnTime:8,cooling:10,heatRelease:.35,sootYield:.25,smokeLife:24,
  flow:1,rise:0,drag:4,expansion:0,spacing:1,maxAge:0,
  populationWidth:0,populationHeight:0,targetScale:1,fineAcquisition:0,flowAlignment:0,pixelFloor:.5,supportFloor:0,projection:1,
  capacity:0,acquisitionMode:0,acquisitionSamples:8192,filmJitter:1,fineCoverage:1,coarseCoverage:0,sourceBias:.75,sourceHistory:4,sourceMargin:1,
  carriedSmokeGain:1,generatedSmokeGain:1,showParticles:true,showRaymarch:false,sourceColorOutput:false,...input};
 const flags=['enabled','showParticles','showRaymarch','sourceColorOutput'];for(const key of flags)if(typeof s[key]!=='boolean')throw Error('Particle '+key+' must be boolean');
 for(const [k,v] of Object.entries(s))if(!flags.includes(k)&&(!Number.isFinite(v)||v<0||!Number.isFinite(Math.fround(v))))throw Error(`Invalid particle ${k}`);
 if(!Number.isSafeInteger(s.spacing)||s.spacing<1)throw Error('Particle spacing must be a positive whole number of source pixels');
 for(const key of ['populationWidth','populationHeight'])if(!Number.isSafeInteger(s[key])||s[key]>0xffffffff)throw Error('Particle population dimensions must be nonnegative whole numbers within u32');
 for(const key of ['capacity','acquisitionSamples'])if(!Number.isSafeInteger(s[key])||s[key]>0xffffffff)throw Error('Particle capacity and acquisition samples must be u32 counts');
 if(s.acquisitionSamples<1||![0,1].includes(s.acquisitionMode)||s.filmJitter>1||s.sourceBias>1||s.fineCoverage>1||s.coarseCoverage>1)throw Error('Invalid particle acquisition policy');
 if(![0,1].includes(s.projection)||s.flowAlignment>1||s.fineAcquisition>1||s.targetScale<=0)throw Error('Invalid particle projection, alignment or target scale');
 if(s.refresh>1||s.radius<=0||s.stretch<=0||s.burnTime<=0||s.cooling<=0||s.smokeLife<=0||s.drag<=0)throw Error('Particle fractions must be at most one and scales/lifetimes positive');
 return s;
}
export const PARTICLE_REACTION_WGSL=/* wgsl */`
// Finite visual reaction proxy: remaining potential, heat, soot production, burned.
// This is not inferred chemistry: intrinsic source emission initializes the proxy.
fn particleReact(state:vec4<f32>,dt:f32,burnTime:f32,cooling:f32,heatRelease:f32,sootYield:f32)->vec4<f32>{
 let burn=state.x*smoothstep(.15,.75,state.y)*(1.0-exp(-dt/burnTime));
 return vec4<f32>(max(0.0,state.x-burn),(state.y+heatRelease*burn)*exp(-dt/cooling),state.z+sootYield*burn,burn);
}
`;
export function particleReactionFromSimulation(config){
 const e=config?.effective;if(!e?.admitted)return null;
 return {burnTime:e.mixingTimeSteps,cooling:e.coolingTimeSteps,heatRelease:e.model.heatOfCombustion};
}
const OPTIONS=/* wgsl */`
struct Particle {anchor:vec4<f32>, source:vec4<f32>, emission:vec4<f32>, motion:vec4<f32>, shape:vec4<f32>, state:vec4<f32>}
struct Options {vp:mat4x4<f32>, inverse:mat4x4<f32>, size:vec4<u32>, time:vec4<f32>, reaction:vec4<f32>, shape:vec4<f32>, transport:vec4<f32>, fine:vec4<f32>, gain:vec4<f32>, raster:vec4<f32>, support:vec4<f32>, acquisition:vec4<u32>}
struct SourceOptions {vp:mat4x4<f32>,size:vec4<u32>,policy:vec4<f32>,life:vec4<f32>,flow:vec4<f32>,worldLo:vec4<f32>,worldDims:vec4<f32>,worldMap:vec4<f32>,middleLo:vec4<f32>,middleDims:vec4<f32>,middleMap:vec4<f32>,arenaOffsets:vec4<u32>}
`;
export const PARTICLE_PROJECTION_WGSL=/* wgsl */`
fn particleProjectedCovariance(vp:mat4x4<f32>,point:vec3<f32>,radius:vec3<f32>,axisY:vec3<f32>,size:vec2<f32>)->vec3<f32>{
 let center=vp*vec4<f32>(point,1);var sum=vec3<f32>(0);
 var basis=array<vec3<f32>,3>(vec3<f32>(1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,0,1));
 if(any(axisY!=vec3<f32>(0,1,0))){let x=normalize(cross(axisY,select(vec3<f32>(0,0,1),vec3<f32>(1,0,0),abs(axisY.z)>.99)));basis=array<vec3<f32>,3>(x,axisY,cross(x,axisY));}
 for(var a=0u;a<3u;a++){
  let delta=vp*vec4<f32>(basis[a]*radius[a],0);
  let v=(delta.xy*center.w-center.xy*delta.w)/(center.w*center.w)*size*.5;
  sum+=vec3<f32>(v.x*v.x,v.y*v.y,v.x*v.y);
 }return sum;
}
fn particleLegacyCovariance(vp:mat4x4<f32>,point:vec3<f32>,radius:vec3<f32>,size:vec2<f32>)->vec3<f32>{
 let center=vp*vec4<f32>(point,1);var sum=vec3<f32>(0);
 for(var a=0u;a<3u;a++){var delta=vec3<f32>(0);delta[a]=radius[a];let clip=vp*vec4<f32>(point+delta,1);let v=(clip.xy/clip.w-center.xy/center.w)*size*.5;sum+=vec3<f32>(v.x*v.x,v.y*v.y,v.x*v.y);}return sum;
}
fn particleDirectionEncode(v:vec3<f32>)->vec2<f32>{
 let n=v/(abs(v.x)+abs(v.y)+abs(v.z));if(n.z>=0){return n.xy;}
 return (vec2<f32>(1)-abs(n.yx))*select(vec2<f32>(-1),vec2<f32>(1),n.xy>=vec2<f32>(0));
}
fn particleDirectionDecode(v:vec2<f32>)->vec3<f32>{
 var n=vec3<f32>(v,1.0-abs(v.x)-abs(v.y));let t=clamp(-n.z,0.0,1.0);n.x+=select(t,-t,n.x>=0);n.y+=select(t,-t,n.y>=0);return normalize(n);
}
`;
export const PARTICLE_COMPUTE_WGSL=/* wgsl */`${OPTIONS}
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read> births:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> fine:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> source:SourceOptions;
@group(0) @binding(4) var<uniform> u:Options;
struct ParticlePool {next:atomic<u32>,frameBirths:atomic<u32>}
@group(0) @binding(5) var<storage,read_write> pool:ParticlePool;
${PARTICLE_REACTION_WGSL}
${PARTICLE_PROJECTION_WGSL}
fn hash32(x:u32)->u32{var h=x;h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);}
fn coarseVelocity(p:vec3<f32>,middle:bool)->vec3<f32>{
 let lo=select(source.worldLo,source.middleLo,middle);let dims=select(source.worldDims,source.middleDims,middle);let map=select(source.worldMap,source.middleMap,middle);
 if(dims.w<=0){return vec3<f32>(0);}
 let q=p*map.w+map.xyz;if(any(q<lo.xyz)||any(q>=lo.xyz+dims.xyz*lo.w)){return vec3<f32>(0);}
 var result=vec3<f32>(0);
 for(var a=0u;a<3u;a++){
  var offset=vec3<f32>(.5);offset[a]=1;let cell=(q-lo.xyz)/lo.w-offset;let base=vec3<i32>(floor(cell));let f=fract(cell);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),vec3<i32>(dims.xyz)-1);let i=u32(c.x)+u32(dims.x)*(u32(c.y)+u32(dims.y)*u32(c.z));let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));
   result[a]+=births[select(source.arenaOffsets.z,source.arenaOffsets.w,middle)+i][a]*w.x*w.y*w.z;
  }}}
 }return result/map.w;
}
fn particleVelocity(p:vec3<f32>)->vec3<f32>{
 let dims=vec3<i32>(u.fine.xyz);let pitch=source.flow.z;
 if(all(p>=vec3<f32>(-1))&&all(p<=vec3<f32>(1,2.0*u.fine.y/u.fine.x-1.0,1))){
  var result=vec3<f32>(0);
  for(var a=0u;a<3u;a++){
   var offset=vec3<f32>(.5);if(source.flow.w>.5){offset[a]=1;}
   let cell=clamp((p+vec3<f32>(1))/pitch-offset,vec3<f32>(0),vec3<f32>(dims)-1.001);let base=vec3<i32>(floor(cell));let f=fract(cell);
   for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),dims-1);let i=u32(c.x+dims.x*(c.y+dims.y*c.z));let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));result[a]+=fine[4u*i][a]*w.x*w.y*w.z;
   }}}
  }return result*pitch;
 }
 let q=p*source.middleMap.w+source.middleMap.xyz;
 let middle=source.middleDims.w>.5&&all(q>=source.middleLo.xyz)&&all(q<source.middleLo.xyz+source.middleDims.xyz*source.middleLo.w);
 return coarseVelocity(p,middle);
}
@compute @workgroup_size(64) fn update(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=u.size.z){return;}var p=particles[i];let steps=u.time.x;let dt=steps*u.fine.w;
 if(i==0u&&u.acquisition.x>0u){atomicStore(&pool.frameBirths,0u);}
 if(p.anchor.w>0&&dt>0){
  let s=particleReact(p.state,dt,u.reaction.x,u.reaction.y,u.reaction.z,u.reaction.w);
  p.state=vec4<f32>(s.xy,s.z*exp(-dt/u.time.w),s.w);
  let damping=exp(-dt/u.transport.z);
  p.motion=vec4<f32>(p.motion.xyz*damping+vec3<f32>(0,u.transport.y*p.state.y*u.transport.z*(1.0-damping),0),0);
  let flow=particleVelocity(p.anchor.xyz);
  if(u.raster.z>0&&dot(flow,flow)>1e-12){p.shape.yz=particleDirectionEncode(normalize(flow));}
  p.anchor=vec4<f32>(p.anchor.xyz+flow*steps*u.time.z*u.transport.x+p.motion.xyz*dt,p.anchor.w+dt);
 }
 if(u.gain.z>0&&p.anchor.w-1.0>=u.gain.z){p.anchor.w=0;}
 if(u.acquisition.x>0u){particles[i]=p;return;}
 // Explicit spacing selects one source within each source-pixel block per update.
 // All source pixels participate. Refresh probability is an exposed policy, not
 // a hidden truncation of the source set. Weak source evaluations can replace slots.
 let columns=u32(u.shape.z);let rows=u32(u.shape.w);
 let noise=hash32(i+u.size.w*747796405u);let jitter=vec2<f32>(f32(noise&65535u),f32(noise>>16u))/65536.0;
 let pixel=min(u.size.xy-vec2<u32>(1),vec2<u32>((vec2<f32>(vec2<u32>(i%columns,i/columns))+jitter)*vec2<f32>(u.size.xy)/vec2<f32>(f32(columns),f32(rows))));
 let at=4u*(pixel.x+pixel.y*u.size.x);let q=births[at];let anchor=births[at+1u];
 let random=f32(hash32(i+u.size.w*1664525u))/4294967296.0;
 if((dt>0||u.size.w==1u)&&anchor.w>0&&max(length(q.xyz),q.w)>0&&(p.anchor.w<=0||random<u.time.y)){
  let support=births[at+2u];let emission=min(q.xyz,births[at+3u].xyz);
  let pitch=max(support.w,.00001);let burning=select(0.0,1.0,length(emission)>0.0);
  p.anchor=anchor;p.source=q;p.emission=vec4<f32>(emission,0);p.motion=vec4<f32>(0);
  p.shape=vec4<f32>(pitch,0,1,max(.00001,support.y-support.x));
  // Finite visual energy comes from the observed emission over its source interval.
  // Vanishing emission must produce vanishing new soot, without a hard threshold.
  let energy=max(0.0,dot(emission,vec3<f32>(.2126,.7152,.0722)))*p.shape.w;
  let potential=(1.0-exp(-energy))/max(1.0,u.reaction.z);
  p.state=vec4<f32>(potential,burning,0,0);p.emission.w=potential;
 }
 particles[i]=p;
}
@compute @workgroup_size(64) fn acquire(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=u.acquisition.y||(u.time.x<=0&&u.size.w!=1u)){return;}
 let at=i*4u;let q=births[at];let anchor=births[at+1u];
 if(anchor.w<=0||max(length(q.xyz),q.w)<=0){return;}
 if(u.size.w>1u&&f32(hash32(i+u.size.w*1664525u))/4294967296.0>=u.time.y){return;}
 let ordinal=atomicAdd(&pool.frameBirths,1u);if(ordinal>=u.size.z){return;}
 let slot=(atomicLoad(&pool.next)+ordinal)%u.size.z;let support=births[at+2u];let emission=min(q.xyz,births[at+3u].xyz);
 let interval=max(.00001,support.y-support.x);let energy=max(0.0,dot(emission,vec3<f32>(.2126,.7152,.0722)))*interval;
 let potential=(1.0-exp(-energy))/max(1.0,u.reaction.z);
 particles[slot]=Particle(anchor,q,vec4<f32>(emission,potential),vec4<f32>(0),vec4<f32>(max(support.w,.00001),0,1,interval),vec4<f32>(potential,select(0.0,1.0,length(emission)>0),0,0));
}
@compute @workgroup_size(1) fn finishBirths(){atomicStore(&pool.next,(atomicLoad(&pool.next)+min(atomicLoad(&pool.frameBirths),u.size.z))%u.size.z);}
`;
const RENDER=/* wgsl */`${OPTIONS}
${PARTICLE_PROJECTION_WGSL}
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<uniform> u:Options;
@group(0) @binding(2) var sceneDepth:DEPTH_TYPE;
struct Vertex {@builtin(position) clip:vec4<f32>,@location(0) local:vec2<f32>,@location(1) @interpolate(flat) light:vec3<f32>,@location(2) @interpolate(flat) tau:f32}
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) i:u32)->Vertex{
 let p=particles[i];var out:Vertex;
 if(p.anchor.w<=0){out.clip=vec4<f32>(2,2,2,1);return out;}
 let growth=1.0+u.transport.w*select(0.0,max(0.0,1.0-p.state.x/max(p.emission.w,1e-20)),p.emission.w>0);
 let radius=vec3<f32>(max(p.shape.x,u.support.x))*u.shape.x*vec3<f32>(1,u.shape.y,1)*growth;
 var center=u.vp*vec4<f32>(p.anchor.xyz,1);var cxx=0.0;var cyy=0.0;var cxy=0.0;
 if(center.w<=.0001){out.clip=vec4<f32>(2,2,2,1);return out;}
 var flowAxis=vec3<f32>(0,1,0);if(u.raster.z>0){let mixed=mix(flowAxis,particleDirectionDecode(p.shape.yz),u.raster.z);if(dot(mixed,mixed)>1e-10){flowAxis=normalize(mixed);}}
 var covariance:vec3<f32>;if(u.support.w<.5){covariance=particleLegacyCovariance(u.vp,p.anchor.xyz,radius,u.raster.xy);}else{covariance=particleProjectedCovariance(u.vp,p.anchor.xyz,radius,flowAxis,u.raster.xy);}cxx=covariance.x;cyy=covariance.y;cxy=covariance.z;
 let angle=.5*atan2(2.0*cxy,cxx-cyy);let axis=vec2<f32>(cos(angle),sin(angle));let disc=sqrt((cxx-cyy)*(cxx-cyy)+4.0*cxy*cxy);
 let major=sqrt(max(u.raster.w*u.raster.w,(cxx+cyy+disc)*.5));let minor=sqrt(max(u.raster.w*u.raster.w,(cxx+cyy-disc)*.5));
 let corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));let xy=corners[vertex]*2.5;
 let offset=axis*xy.x*major+vec2<f32>(-axis.y,axis.x)*xy.y*minor;center.x+=offset.x*2.0/u.raster.x*center.w;center.y+=offset.y*2.0/u.raster.y*center.w;if(u.gain.w<.5){center.z=(center.z+center.w)*.5;}
 out.clip=center;out.local=xy;
 let opacity=exp(-max(0.0,p.anchor.w-1.0)/u.time.w);
 let emission=p.emission.xyz*pow(max(0.0,p.state.y),4.0)*u.gain.x;
 out.light=(emission+max(vec3<f32>(0),p.source.xyz-p.emission.xyz)*opacity*u.support.y)*p.shape.w;
 // New soot has its own absorption even when the source had no extinction.
 out.tau=(p.source.w*opacity*u.support.y+p.state.z*u.support.z)*p.shape.w*u.gain.y;return out;
}
@fragment fn fs(v:Vertex)->@location(0) vec4<f32>{
 let pixel=clamp(vec2<i32>(v.clip.xy/u.raster.xy*vec2<f32>(textureDimensions(sceneDepth))),vec2<i32>(0),vec2<i32>(textureDimensions(sceneDepth))-1);var depth=DEPTH_LOAD;DEPTH_REDUCE
 if(v.clip.z>depth+.00001){discard;}
 let weight=exp(-.5*dot(v.local,v.local));return vec4<f32>(v.light,v.tau)*weight;
}
`;
const RESOLVE=/* wgsl */`
@group(0) @binding(0) var optics:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0)vec4<f32>{
 let at=vec2<i32>(p.xy);let v=textureLoad(optics,at,0);
 let trans=exp(-v.w);let scale=select(1.0,(1.0-trans)/max(v.w,1e-6),v.w>.00001);return vec4<f32>(v.xyz*scale,trans);
}
`;

export function createOpticalParticles(device,{transparent=false}={}) {
 const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const options=device.createBuffer({size:288,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const pool=device.createBuffer({label:'particle rotating birth cursor',size:8,usage:storage});
 const camera=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const compute=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_COMPUTE_WGSL}),entryPoint:'update'}});
 const acquire=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_COMPUTE_WGSL}),entryPoint:'acquire'}});
 const finishBirths=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_COMPUTE_WGSL}),entryPoint:'finishBirths'}});
 const present=new Map(),render=new Map();let particles=null,textures=[],key=null,frame=0,lastStep=null,info={effective:'off'};
 const retired=[];
 function retire(items){if(items.length)retired.push(...items);}
 function reset(){key=null;frame=0;info={effective:'off',reason:'reset'};}
 function encode(encoder,{view,format,source,fine,dims,invViewProj,settings,cameraValues,depth,identity,depthZeroToOne=false,profileWrites=()=>({})}){
  const s=opticalParticleSettings(settings),{width,height,pixels,step}=source;
  const columns=s.populationWidth||Math.ceil(width/s.spacing),rows=s.populationHeight||Math.ceil(height/s.spacing),slots=s.capacity||columns*rows;
  const outputWidth=source.outputWidth??width,outputHeight=source.outputHeight??height;
  if(!Number.isSafeInteger(slots)||slots>0xffffffff)throw Error('Particle population exceeds u32 indexing');
  const targetWidth=Math.max(1,Math.ceil(outputWidth*s.targetScale)),targetHeight=Math.max(1,Math.ceil(outputHeight*s.targetScale));
  if(Math.max(targetWidth,targetHeight)>device.limits.maxTextureDimension2D)throw Error('Particle target exceeds device texture dimensions');
  if(slots*96>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error(`Particle population requires ${slots*96} bytes; exceeds effective device binding capacity`);
  if(Math.ceil(slots/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Particle population exceeds effective device compute dispatch capacity');
  if(s.acquisitionMode&&Math.ceil((source.samples??pixels)/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Fresh particle observations exceed effective device compute dispatch capacity');
  const nextKey=JSON.stringify([slots,s.acquisitionMode,s.capacity?null:[columns,rows],identity]);
  const resetNeeded=key!==nextKey||lastStep===null||step<lastStep;const dt=resetNeeded?0:step-lastStep;
  if(!particles||particles.size!==slots*96){retire(particles?[particles]:[]);particles=device.createBuffer({label:'shared world optical material carriers',size:slots*96,usage:storage});}
  if(!textures.length||textures[0].width!==targetWidth||textures[0].height!==targetHeight){retire(textures);textures=['rgba16float','rgba32float'].map(f=>device.createTexture({size:[targetWidth,targetHeight],format:f,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}));}
  if(resetNeeded){encoder.clearBuffer(particles);encoder.clearBuffer(pool);frame=0;}frame++;lastStep=step;key=nextKey;
  const data=new ArrayBuffer(288),f=new Float32Array(data),u=new Uint32Array(data);f.set(source.viewProj);f.set(invViewProj,16);u.set([width,height,slots,frame],32);
  const floorWidth=s.acquisitionMode?(source.displayWidth??outputWidth):width,floorHeight=s.acquisitionMode?(source.displayHeight??outputHeight):height;
  f.set([dt,s.refresh,source.backtrace,s.smokeLife],36);f.set([s.burnTime,s.cooling,s.heatRelease,s.sootYield],40);f.set([s.radius,s.stretch,columns,rows],44);f.set([s.flow,s.rise,s.drag,s.expansion],48);f.set([...dims,source.reactionStepScale??1],52);f.set([s.gain,s.opacity,s.maxAge,depthZeroToOne?1:0],56);f.set([targetWidth,targetHeight,s.flowAlignment,s.pixelFloor*Math.min(targetWidth/floorWidth,targetHeight/floorHeight)],60);f.set([s.supportFloor,s.carriedSmokeGain,s.generatedSmokeGain,s.projection],64);u.set([s.acquisitionMode,source.samples??pixels,outputWidth,outputHeight],68);device.queue.writeBuffer(options,0,data);
  const c=encoder.beginComputePass({label:'particle finite reaction and native grid flow',...profileWrites('update')});c.setPipeline(compute);c.setBindGroup(0,device.createBindGroup({layout:compute.getBindGroupLayout(0),entries:[particles,source.buffer,fine,source.uniform,options,pool].map((buffer,binding)=>({binding,resource:{buffer}}))}));c.dispatchWorkgroups(Math.ceil(slots/64));c.end();
  if(s.acquisitionMode){const p=encoder.beginComputePass({label:'particle fresh observations to rotating pool',...profileWrites('births')});p.setPipeline(acquire);p.setBindGroup(0,device.createBindGroup({layout:acquire.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:1,resource:{buffer:source.buffer}},{binding:4,resource:{buffer:options}},{binding:5,resource:{buffer:pool}}]}));p.dispatchWorkgroups(Math.ceil((source.samples??pixels)/64));p.setPipeline(finishBirths);p.setBindGroup(0,device.createBindGroup({layout:finishBirths.getBindGroupLayout(0),entries:[{binding:4,resource:{buffer:options}},{binding:5,resource:{buffer:pool}}]}));p.dispatchWorkgroups(1);p.end();}
  const readState=()=>({requested:true,effective:'world-optical-particles',width,height,slots,spacing:s.spacing,populationSize:s.capacity?[slots,1]:[columns,rows],sourcePixels:pixels,targetSize:[targetWidth,targetHeight],bytes:particles.size+targetWidth*targetHeight*24,sourceBytes:source.buffer.size,totalBytes:particles.size+targetWidth*targetHeight*24+source.buffer.size,frames:frame,step,stepDelta:dt,settings:s,
   outputSize:[outputWidth,outputHeight],freshSamples:source.samples??pixels,collection:s.acquisitionMode?'rotating world-space pool':'camera-stratified slots',screenSupportUnits:s.acquisitionMode?'display pixels':'source pixels',drawn:s.showParticles,raymarchVisible:s.showRaymarch,recordFloats:24,shapeEncoding:'birth pitch; octahedral flow direction XY; represented ray length',
   clipDepth:depthZeroToOne?'zero-to-one':'minus-one-to-one',source:'one fresh native local optical observation; separate intrinsic emission',flow:'existing sampled Fine/Middle/World velocity; optional orientation adds no field lookups',reaction:'finite visual proxy seeded by intrinsic emission; no inferred fuel/oxygen',composition:'additive optical moments; approximate mixed-depth attenuation',generatedSmoke:'future burn creates soot; generated/carried visibility gains are independent',reset:resetNeeded});
  if(!s.showParticles){if(!s.showRaymarch){const clear=encoder.beginRenderPass({label:'hidden particle display clear',...profileWrites('present'),colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});clear.end();}if(retired.length){const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy())));}info=readState();return info;}
  const ms=depth.sampleCount>1;let rp=render.get(ms);
  if(!rp){const code=RENDER.replace('DEPTH_TYPE',ms?'texture_depth_multisampled_2d':'texture_depth_2d').replace('DEPTH_LOAD','textureLoad(sceneDepth,pixel,0)').replace('DEPTH_REDUCE',ms?'for(var sample=1u;sample<textureNumSamples(sceneDepth);sample++){depth=min(depth,textureLoad(sceneDepth,pixel,sample));}':'');const module=device.createShaderModule({code});
   const blend={color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}};
   rp=device.createRenderPipeline({label:'anisotropic material carrier optical moments',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float',blend}]},primitive:{topology:'triangle-list'}});render.set(ms,rp);}
  const r=encoder.beginRenderPass({label:'spatial material support',...profileWrites('raster'),colorAttachments:textures.slice(0,1).map(t=>({view:t.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}))});r.setPipeline(rp);r.setBindGroup(0,device.createBindGroup({layout:rp.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:1,resource:{buffer:options}},{binding:2,resource:depth.createView()}]}));r.draw(6,slots);r.end();
  if(!resolvePipeline){const module=device.createShaderModule({code:RESOLVE});
  resolvePipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba32float'}]}});}
  const resolve=encoder.beginRenderPass({label:'material optical moment transfer',...profileWrites('resolve'),colorAttachments:[{view:textures[1].createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});resolve.setPipeline(resolvePipeline);resolve.setBindGroup(0,device.createBindGroup({layout:resolvePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:textures[0].createView()}]}));resolve.draw(3);resolve.end();
  const presentKey=format+':overlay='+s.showRaymarch;
  let pp=present.get(presentKey);if(!pp){const code=INTEGRAL_PRESENT_WGSL.replace('let v=textureLoad(image,vec2<i32>(p.xy),0);',`let dims=vec2<i32>(textureDimensions(image));let uv=p.xy/u.reserved_render_controls.xy;let q=uv*vec2<f32>(dims)-.5;let base=vec2<i32>(floor(q));let f=fract(q);let hi=dims-vec2<i32>(1);var v:vec4<f32>;if(all(vec2<f32>(dims)==u.reserved_render_controls.xy)){v=textureLoad(image,vec2<i32>(p.xy),0);}else{v=mix(mix(textureLoad(image,clamp(base,vec2<i32>(0),hi),0),textureLoad(image,clamp(base+vec2<i32>(1,0),vec2<i32>(0),hi),0),f.x),mix(textureLoad(image,clamp(base+vec2<i32>(0,1),vec2<i32>(0),hi),0),textureLoad(image,clamp(base+vec2<i32>(1,1),vec2<i32>(0),hi),0),f.x),f.y);}`);
   const m=device.createShaderModule({code});pp=device.createRenderPipeline({layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'present',constants:{TRANSPARENT_CANVAS:transparent||s.showRaymarch},targets:[{format,...(s.showRaymarch?{blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}:{})}]}});present.set(presentKey,pp);}
  const displayCamera=new Float32Array(cameraValues);displayCamera.set([outputWidth,outputHeight],16);device.queue.writeBuffer(camera,0,displayCamera);
  const output=encoder.beginRenderPass({label:'native optical particle presentation',...profileWrites('present'),colorAttachments:[{view,loadOp:s.showRaymarch?'load':'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});output.setPipeline(pp);output.setBindGroup(0,device.createBindGroup({layout:pp.getBindGroupLayout(0),entries:[{binding:0,resource:textures[1].createView()},{binding:1,resource:{buffer:camera}}]}));output.draw(3);output.end();
  if(retired.length){const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy())));}
  info=readState();return info;
 }
 let resolvePipeline=null;
 async function sample(){if(!particles||!frame||key===null)return {available:false,state:info};const epoch=frame,sourceKey=key,snapshot=structuredClone(info),p=particles,read=device.createBuffer({size:p.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(p,0,read,0,p.size);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);if(frame!==epoch||key!==sourceKey||particles!==p)throw Error('Particle readback became stale');return {available:true,state:snapshot,records:new Float32Array(read.getMappedRange().slice(0))};}finally{read.unmap();read.destroy();}}
 return {encode,reset,read:()=>info,sample,dispose(){retire([options,camera,pool,...textures,...(particles?[particles]:[])]);const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy())));particles=null;textures=[];}};
}
