// A Reactive Lagrangian Optical Integrator for Subgrid Flame Super-Resolution.
// Method and continuation plan: docs/reactive-lagrangian-optical-integrator.md.
import {particleDepthLayout,createParticleDepthField,PARTICLE_DEPTH_RENDER_WGSL} from './volume-particle-depth.mjs';
import {createParticleGridExtinction,validateParticleGridExtinction,PARTICLE_EXTINCTION_QUERY_WGSL} from './volume-particle-extinction.mjs';
import {INTEGRAL_PRESENT_WGSL} from './volume-integral-reconstruction.mjs';
import {PARTICLE_STATE_DEFAULTS,PARTICLE_STATE_WGSL,PARTICLE_KERNEL_WGSL,validateParticleStateSettings,particleKernelNormalization} from './volume-particle-state.mjs';
import {createParticleExchange,particleExchangePlan} from './volume-particle-exchange.mjs';
import {createParticleFollow} from './volume-particle-follow.mjs';
import {THERMAL_LUT,THERMAL_LUT_COUNT} from './volume-physical-color.mjs';
import {REACTION_RGB} from './volume-emissive-transport.mjs';
import {REACTANT_MODEL} from './volume-reactant-combustion.mjs';

export function opticalParticleSettings(input={}) {
 const s={enabled:false,refresh:.18,depthSupport:2,radius:.4,stretch:2,gain:1,opacity:1,
  burnTime:8,cooling:10,heatRelease:.35,sootYield:.25,smokeLife:24,reactionSeedLength:1,reactionSupportCoupling:1,renewalDiagnostics:false,
  flow:1,rise:0,drag:4,expansion:0,spacing:1,maxAge:0,
  populationWidth:0,populationHeight:0,targetScale:1,fineAcquisition:0,flowAlignment:0,pixelFloor:.5,supportFloor:0,projection:1,
  capacity:0,acquisitionMode:0,acquisitionSamples:8192,filmJitter:1,fineCoverage:1,coarseCoverage:0,sourceBias:.75,sourceHistory:4,sourceMargin:1,
  depthMode:0,depthSlices:16,depthScale:.25,fillExtinction:0,extinctionSlack:0,extinctionView:0,scatteredGain:input.scatteredGain??input.carriedSmokeGain??1,scatteredLife:0,carriedSmokeGain:1,generatedSmokeGain:1,showParticles:true,showRaymarch:false,sourceColorOutput:false,...PARTICLE_STATE_DEFAULTS,...input};
 if(![0,1,2].includes(s.depthMode)||!Number.isSafeInteger(s.depthSlices)||s.depthSlices<1||s.depthSlices>0xffffffff||s.depthScale<=0)throw Error('Invalid particle depth settings');
 const flags=['enabled','showParticles','showRaymarch','sourceColorOutput','renewalDiagnostics'];for(const key of flags)if(typeof s[key]!=='boolean')throw Error('Particle '+key+' must be boolean');
 for(const [k,v] of Object.entries(s))if(!flags.includes(k)&&(!Number.isFinite(v)||v<0||!Number.isFinite(Math.fround(v))))throw Error(`Invalid particle ${k}`);
 if(!Number.isSafeInteger(s.spacing)||s.spacing<1)throw Error('Particle spacing must be a positive whole number of source pixels');
 for(const key of ['populationWidth','populationHeight'])if(!Number.isSafeInteger(s[key])||s[key]>0xffffffff)throw Error('Particle population dimensions must be nonnegative whole numbers within u32');
 for(const key of ['capacity','acquisitionSamples'])if(!Number.isSafeInteger(s[key])||s[key]>0xffffffff)throw Error('Particle capacity and acquisition samples must be u32 counts');
 if(s.acquisitionSamples<1||![0,1].includes(s.acquisitionMode)||s.filmJitter>1||s.sourceBias>1||s.fineCoverage>1||s.coarseCoverage>1)throw Error('Invalid particle acquisition policy');
 if(![0,1].includes(s.projection)||s.flowAlignment>1||s.fineAcquisition>1||s.targetScale<=0)throw Error('Invalid particle projection, alignment or target scale');
 if(s.reactionSupportCoupling>1||s.fillExtinction>1||![0,1,2].includes(s.extinctionView))throw Error('Invalid particle reaction coupling or extinction assist');
 if((s.fillExtinction>0||s.extinctionView>0)&&!s.depthMode)throw Error('Extinction assist requires depth-sliced integration');
 if(s.refresh>1||s.radius<=0||s.stretch<=0||s.burnTime<=0||s.cooling<=0||s.smokeLife<=0||s.drag<=0)throw Error('Particle fractions must be at most one and scales/lifetimes positive');
 return validateParticleStateSettings(s);
}
export const PARTICLE_REACTION_WGSL=/* wgsl */`
// Finite visual reaction proxy: remaining potential, heat, soot production, burned.
// This is not inferred chemistry: intrinsic source emission initializes the proxy.
fn particleSeedPotential(emission:vec3<f32>,supportLength:f32,referenceLength:f32,coupling:f32,heatRelease:f32)->f32{
 var length=supportLength;if(coupling<1.0){length=mix(referenceLength,supportLength,coupling);}
 let energy=max(0.0,dot(emission,vec3<f32>(.2126,.7152,.0722)))*length;
 return (1.0-exp(-energy))/max(1.0,heatRelease);
}
fn particleReact(state:vec4<f32>,dt:f32,burnTime:f32,cooling:f32,heatRelease:f32,sootYield:f32)->vec4<f32>{
 let burn=state.x*smoothstep(.15,.75,state.y)*(1.0-exp(-dt/burnTime));
 return vec4<f32>(max(0.0,state.x-burn),(state.y+heatRelease*burn)*exp(-dt/cooling),state.z+sootYield*burn,burn);
}
`;
export function particleReactionFromSimulation(config){
 const e=config?.effective;if(!e?.admitted)return null;
 return {burnTime:e.mixingTimeSteps,cooling:e.coolingTimeSteps,heatRelease:e.model.heatOfCombustion,sootYield:e.model.sootYield,smokeLife:e.model.sootRetirementSteps};
}
const OPTIONS=/* wgsl */`
struct Particle {anchor:vec4<f32>, source:vec4<f32>, emission:vec4<f32>, motion:vec4<f32>, shape:vec4<f32>, state:vec4<f32>}
struct Options {vp:mat4x4<f32>, inverse:mat4x4<f32>, size:vec4<u32>, time:vec4<f32>, reaction:vec4<f32>, shape:vec4<f32>, transport:vec4<f32>, fine:vec4<f32>, gain:vec4<f32>, raster:vec4<f32>, support:vec4<f32>, acquisition:vec4<u32>, lighting:vec4<f32>, seed:vec4<f32>, visibility:vec4<f32>,chemistry:vec4<f32>,material:vec4<f32>,appearance:vec4<f32>,lives:vec4<f32>,lifeControl:vec4<f32>,kernelE:vec4<f32>,kernelT:vec4<f32>,oxidation:vec4<f32>}
struct SourceOptions {vp:mat4x4<f32>,size:vec4<u32>,policy:vec4<f32>,life:vec4<f32>,flow:vec4<f32>,worldLo:vec4<f32>,worldDims:vec4<f32>,worldMap:vec4<f32>,middleLo:vec4<f32>,middleDims:vec4<f32>,middleMap:vec4<f32>,arenaOffsets:vec4<u32>}
`;
const PARTICLE_MATERIAL_WGSL=/* wgsl */`
fn particleMaterial(p:Particle,u:Options)->vec4<f32>{
 let age=max(0.0,p.anchor.w-1.0);
 let emission=p.emission.xyz*u.gain.x;
 let lightLife=select(u.time.w,u.lighting.y,u.lighting.y>0);
 let scattered=p.source.xyz*exp(-age/lightLife)*u.lighting.x;
 let fade=select(1.0,particleLifeFade(p.motion.w,u.lifeControl.y),u.lifeControl.x>0);
 return vec4<f32>((emission+scattered)*p.shape.w,max(0.0,p.state.z)*u.material.x*u.material.y*u.material.w*p.shape.w*u.gain.y)*fade;
}
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
struct ParticlePool {next:atomic<u32>,frameBirths:atomic<u32>,overwritten:atomic<u32>,expired:atomic<u32>,escaped:atomic<u32>,legacyBirths:atomic<u32>}
@group(0) @binding(5) var<storage,read_write> pool:ParticlePool;
@group(0) @binding(7) var reactants:texture_3d<f32>;
struct ParticleThermalTable {values:array<vec4<f32>,${THERMAL_LUT_COUNT}>}
@group(0) @binding(8) var<uniform> thermal:ParticleThermalTable;
${PARTICLE_STATE_WGSL}
${PARTICLE_MATERIAL_WGSL}
${PARTICLE_PROJECTION_WGSL}
fn hash32(x:u32)->u32{var h=x;h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);}
fn particleGridState(p:vec3<f32>)->vec4<f32>{
 let dims=vec3<i32>(u.fine.xyz);let cell=clamp((p+vec3<f32>(1))/source.flow.z-vec3<f32>(.5),vec3<f32>(0),vec3<f32>(dims)-1.001);let base=vec3<i32>(floor(cell));let f=fract(cell);var state=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),dims-1);let i=u32(c.x+dims.x*(c.y+dims.y*c.z));let w=select(vec3<f32>(1)-f,f,vec3<bool>(x==1,y==1,z==1));let m=fine[4u*i+1u];let oxygen=textureLoad(reactants,c,0).x;state+=vec4<f32>(m.z,m.y,m.x,oxygen)*w.x*w.y*w.z;
 }}}return max(state,vec4<f32>(0));
}
fn particleIntrinsic(state:vec4<f32>,freshBurn:f32)->vec3<f32>{
 let extinction=state.z*u.material.x*u.material.y;let absorbing=extinction*(1.0-u.material.z);
 let t=(clamp(300.0+state.y*u.appearance.x,800.0,6000.0)-800.0)/10.0;let lo=min(u32(floor(t)),${THERMAL_LUT_COUNT-2}u);let a=thermal.values[lo];let b=thermal.values[lo+1u];let planck=mix(a.rgb*a.w,b.rgb*b.w,t-f32(lo));
 let clean=(1.0-exp(-max(0.0,freshBurn)/max(1e-6,u.appearance.w)))*exp(-extinction*2.0);
 return absorbing*planck*u.appearance.y+vec3<f32>(${REACTION_RGB.join(',')})*clean*u.appearance.z;
}
fn particleBirth(anchor:vec4<f32>,q:vec4<f32>,support:vec4<f32>,intrinsic:vec3<f32>,state:vec4<f32>)->Particle{
 return Particle(anchor,vec4<f32>(max(vec3<f32>(0),q.xyz-intrinsic),state.z),vec4<f32>(intrinsic,state.x),vec4<f32>(0),vec4<f32>(max(support.w,.00001),0,1,max(.00001,support.y-support.x)),state);
}
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
fn particleInsideFine(p:vec3<f32>)->bool{return all(p>=vec3<f32>(-1))&&all(p<=vec3<f32>(1,2.0*u.fine.y/u.fine.x-1.0,1));}
fn particleOutsideSingleGrid(p:vec3<f32>)->bool{return source.worldDims.w<.5&&!particleInsideFine(p);}
fn particleVelocity(p:vec3<f32>)->vec3<f32>{
 let dims=vec3<i32>(u.fine.xyz);let pitch=source.flow.z;
 if(particleInsideFine(p)){
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
 if(p.anchor.w>0&&dt>0&&particleOutsideSingleGrid(p.anchor.xyz)){p.anchor.w=0;if(u.seed.z>.5){atomicAdd(&pool.escaped,1u);}}
 if(p.anchor.w>0&&dt>0){
  let s=particleCompositionBurn(p.state,dt,u.chemistry,vec4<f32>(u.reaction.xy,u.reaction.w,u.time.w));
  p.state=s.state;p.state.z=particleSootBurnout(p.state,dt,u.oxidation.x,u.appearance.x,u.oxidation.y);p.emission=vec4<f32>(particleIntrinsic(p.state,s.burned/dt),p.emission.w);
  let life=particleLifeAdvance(p.state,p.emission.w,p.motion.w,dt,u.lives,u.chemistry.zw,u.lifeControl.z,u.lifeControl.x,u.lifeControl.y);
  let damping=exp(-dt/u.transport.z);
  p.motion=vec4<f32>(p.motion.xyz*damping+vec3<f32>(0,u.transport.y*p.state.y*u.transport.z*(1.0-damping),0),life.x);
  let flow=particleVelocity(p.anchor.xyz);
  if(u.raster.z>0&&dot(flow,flow)>1e-12){p.shape.yz=particleDirectionEncode(normalize(flow));}
  p.anchor=vec4<f32>(p.anchor.xyz+flow*steps*u.time.z*u.transport.x+p.motion.xyz*dt,p.anchor.w+dt);
  if(particleOutsideSingleGrid(p.anchor.xyz)){p.anchor.w=0;if(u.seed.z>.5){atomicAdd(&pool.escaped,1u);}}
  if(life.w>0){p.anchor.w=0;if(u.seed.z>.5){atomicAdd(&pool.expired,1u);}}
 }
 if(dt>0&&p.anchor.w>0&&u.gain.z>0&&p.anchor.w-1.0>=u.gain.z){p.anchor.w=0;if(u.seed.z>.5){atomicAdd(&pool.expired,1u);}}
 if(u.acquisition.x>0u){particles[i]=p;return;}
 // Explicit spacing selects one source within each source-pixel block per update.
 // All source pixels participate. Refresh probability is an exposed policy, not
 // a hidden truncation of the source set. Weak source evaluations can replace slots.
 let columns=u32(u.shape.z);let rows=u32(u.shape.w);
 let noise=hash32(i+u.size.w*747796405u);let jitter=vec2<f32>(f32(noise&65535u),f32(noise>>16u))/65536.0;
 let pixel=min(u.size.xy-vec2<u32>(1),vec2<u32>((vec2<f32>(vec2<u32>(i%columns,i/columns))+jitter)*vec2<f32>(u.size.xy)/vec2<f32>(f32(columns),f32(rows))));
 let at=4u*(pixel.x+pixel.y*u.size.x);let q=births[at];let anchor=births[at+1u];
 let random=f32(hash32(i+u.size.w*1664525u))/4294967296.0;
 if((dt>0||u.size.w==1u)&&anchor.w>0&&(p.anchor.w<=0||random<u.time.y)){
  let state=particleGridState(anchor.xyz);if(max(max(state.x,state.y),max(state.z,length(q.xyz)))<=0){particles[i]=p;return;}
  if(u.seed.z>.5){atomicAdd(&pool.legacyBirths,1u);if(p.anchor.w>0){atomicAdd(&pool.overwritten,1u);}}
  p=particleBirth(anchor,q,births[at+2u],births[at+3u].xyz,state);
 }
 particles[i]=p;
}
@compute @workgroup_size(64) fn acquire(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=u.acquisition.y||(u.time.x<=0&&u.size.w!=1u)){return;}
 let at=i*4u;let q=births[at];let anchor=births[at+1u];
 if(anchor.w<=0){return;}
 let state=particleGridState(anchor.xyz);if(max(max(state.x,state.y),max(state.z,length(q.xyz)))<=0){return;}
 if(u.size.w>1u&&f32(hash32(i+u.size.w*1664525u))/4294967296.0>=u.time.y){return;}
 let ordinal=atomicAdd(&pool.frameBirths,1u);if(ordinal>=u.size.z){return;}
 let slot=(atomicLoad(&pool.next)+ordinal)%u.size.z;let support=births[at+2u];let emission=min(q.xyz,births[at+3u].xyz);
 if(u.seed.z>.5&&particles[slot].anchor.w>0){atomicAdd(&pool.overwritten,1u);}
 particles[slot]=particleBirth(anchor,q,support,emission,state);
}
@compute @workgroup_size(1) fn finishBirths(){if(u.time.x<=0&&u.size.w!=1u){return;}atomicStore(&pool.next,(atomicLoad(&pool.next)+min(atomicLoad(&pool.frameBirths),u.size.z))%u.size.z);}
@group(0) @binding(6) var<storage,read_write> statsOutput:array<vec4<u32>>;
var<workgroup> statsCounts:array<vec4<u32>,64>;
var<workgroup> statsExtinction:array<vec2<u32>,64>;
var<workgroup> statsAges:array<vec4<f32>,64>;
@compute @workgroup_size(64) fn populationStatistics(@builtin(local_invocation_index) tid:u32){
 var counts=vec4<u32>(0);var extinctive=0u;var followed=0u;var ages=vec4<f32>(3.402823e38,0,0,0);
 for(var i=tid;i<u.size.z;i+=64u){let p=particles[i];if(p.anchor.w>0){counts.x++;let age=max(0.0,p.anchor.w-1.0);ages.x=min(ages.x,age);ages.y=max(ages.y,age);ages.z+=age;if(particleMaterial(p,u).w>0){extinctive++;}}}
 for(var i=tid;i<u.acquisition.y;i+=64u){let at=4u*i;let q=births[at];if(births[at+1u].w>0){counts.y++;if(max(length(q.xyz),q.w)>0){counts.z++;}if(any(births[at+3u].xyz>vec3<f32>(0))){counts.w++;}if(births[at+3u].w>0){followed++;}}}
 statsCounts[tid]=counts;statsExtinction[tid]=vec2<u32>(extinctive,followed);statsAges[tid]=ages;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(tid<stride){statsCounts[tid]+=statsCounts[tid+stride];statsExtinction[tid]+=statsExtinction[tid+stride];let a=statsAges[tid];let b=statsAges[tid+stride];statsAges[tid]=vec4<f32>(min(a.x,b.x),max(a.y,b.y),a.z+b.z,0);}workgroupBarrier();}
 if(tid==0u){let c=statsCounts[0];let accepted=select(atomicLoad(&pool.legacyBirths),atomicLoad(&pool.frameBirths),u.acquisition.x>0u);let placed=select(accepted,min(accepted,u.size.z),u.acquisition.x>0u);let age=statsAges[0];
  statsOutput[0]=c;statsOutput[1]=vec4<u32>(statsExtinction[0].x,accepted,placed,atomicLoad(&pool.overwritten));statsOutput[2]=vec4<u32>(atomicLoad(&pool.expired),atomicLoad(&pool.escaped),statsExtinction[0].y,u.size.w);statsOutput[3]=bitcast<vec4<u32>>(vec4<f32>(select(0.0,age.x,c.x>0u),age.y,age.z,u.time.x*u.fine.w));
 }
}

`;
const RENDER=/* wgsl */`${OPTIONS}
${PARTICLE_STATE_WGSL}
${PARTICLE_KERNEL_WGSL}
${PARTICLE_MATERIAL_WGSL}
override PARTICLE_INDEXED_QUADS:bool=false;
DEPTH_DECLARATIONS
${PARTICLE_PROJECTION_WGSL}
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<uniform> u:Options;
@group(0) @binding(2) var sceneDepth:DEPTH_TYPE;
struct Vertex {@builtin(position) clip:vec4<f32>,@location(0) local:vec2<f32>,@location(1) @interpolate(flat) light:vec3<f32>,@location(2) @interpolate(flat) tau:f32 DEPTH_VERTEX_FIELD}
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) i:u32)->Vertex{
 let p=particles[i];var out:Vertex;
 if(p.anchor.w<=0){out.clip=vec4<f32>(2,2,2,1);return out;}
 let growth=1.0+u.transport.w*select(0.0,max(0.0,1.0-p.state.x/max(p.emission.w,1e-20)),p.emission.w>0);
 let radius=vec3<f32>(max(p.shape.x,u.support.x))*u.shape.x*vec3<f32>(1,u.shape.y,1)*growth;
 var center=u.vp*vec4<f32>(p.anchor.xyz,1);var cxx=0.0;var cyy=0.0;var cxy=0.0;
 if(center.w<=.0001){out.clip=vec4<f32>(2,2,2,1);return out;}
 var flowAxis=vec3<f32>(0,1,0);if(u.raster.z>0){let mixed=mix(flowAxis,particleDirectionDecode(p.shape.yz),u.raster.z);if(dot(mixed,mixed)>1e-10){flowAxis=normalize(mixed);}}
 var covariance:vec3<f32>;if(u.support.w<.5){covariance=particleLegacyCovariance(u.vp,p.anchor.xyz,radius,u.raster.xy);}else{covariance=particleProjectedCovariance(u.vp,p.anchor.xyz,radius,flowAxis,u.raster.xy);}cxx=covariance.x;cyy=covariance.y;cxy=covariance.z;
 var angle=0.0;if(abs(cxy)+abs(cxx-cyy)>1e-20){angle=.5*atan2(2.0*cxy,cxx-cyy);}let axis=vec2<f32>(cos(angle),sin(angle));let disc=sqrt((cxx-cyy)*(cxx-cyy)+4.0*cxy*cxy);
 let major=sqrt(max(u.raster.w*u.raster.w,(cxx+cyy+disc)*.5));let minor=sqrt(max(u.raster.w*u.raster.w,(cxx+cyy-disc)*.5));
 var xy:vec2<f32>;
 if(PARTICLE_INDEXED_QUADS){let corners=array<vec2<f32>,4>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));xy=corners[vertex]*2.5;}
 else{let corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));xy=corners[vertex]*2.5;}
 var offset=axis*xy.x*major+vec2<f32>(-axis.y,axis.x)*xy.y*minor;var footprintGain=1.0;DEPTH_FOOTPRINT_FILTER
center.x+=offset.x*2.0/u.raster.x*center.w;center.y+=offset.y*2.0/u.raster.y*center.w;if(u.gain.w<.5){center.z=(center.z+center.w)*.5;}
 DEPTH_VERTEX_TRANSFORM
 out.clip=center;out.local=xy;
 var optical=particleMaterial(p,u);
 if(u.lifeControl.w>0){
  let viewMode=u32(u.lifeControl.w);var color=vec3<f32>(0);
  if(viewMode==1u){color=vec3<f32>(1,.25,.02)*p.state.x;}
  else if(viewMode==2u){color=vec3<f32>(1,.4,.05)*p.state.y;}
  else if(viewMode==3u){color=vec3<f32>(.05,.4,1)*p.state.w;}
  else if(viewMode==4u){color=vec3<f32>(.65,.8,1)*p.state.z;}
  else if(viewMode==5u){let t=clamp((p.anchor.w-1.0)/max(1.0,u.lives.y),0.0,1.0);color=vec3<f32>(t,.2,1.0-t);}
  else if(viewMode==6u){color=vec3<f32>(p.motion.w,1.0-p.motion.w,.1);}
  else{let c=floor((p.anchor.xyz+vec3<f32>(1))/(u.kernelE.w*2.0/u.fine.x));color=.3+.7*fract(sin(c*vec3<f32>(12.9898,78.233,39.425))*43758.5453);}
  optical=vec4<f32>(max(color,vec3<f32>(.02))*.2,.08);
 }
 out.light=optical.xyz;out.tau=optical.w*footprintGain;return out;
}
@fragment fn fs(v:Vertex)->@location(0) vec4<f32>{
 DEPTH_FRAGMENT_COORDINATES
 let pixel=clamp(vec2<i32>(sceneUv*vec2<f32>(textureDimensions(sceneDepth))),vec2<i32>(0),vec2<i32>(textureDimensions(sceneDepth))-1);var depth=DEPTH_LOAD;DEPTH_REDUCE
 if(v.clip.z>depth+.00001){discard;}
 let weight=particleKernel(v.local,u.kernelT.x,u.kernelT.y,u.kernelT.z);let lightWeight=particleKernel(v.local,u.kernelE.x,u.kernelE.y,u.kernelE.z);DEPTH_FRAGMENT_OUTPUT
}
`;
const OPTICAL_TRANSFER=/* wgsl */`
fn particleOpticalTransfer(v:vec4<f32>)->vec4<f32>{
 let trans=exp(-v.w);let scale=select(1.0,(1.0-trans)/max(v.w,1e-6),v.w>.00001);return vec4<f32>(v.xyz*scale,trans);
}
`;
const DEPTH_TRANSFER='fn particleOpticalTransfer(v:vec4<f32>)->vec4<f32>{return vec4<f32>(v.xyz,exp(-v.w));}';
const RESOLVE=/* wgsl */`${OPTICAL_TRANSFER}
@group(0) @binding(0) var optics:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0)vec4<f32>{
 let at=vec2<i32>(p.xy);let v=textureLoad(optics,at,0);
 return particleOpticalTransfer(v);
}
`;

const ASSIST_RESOLVE=/* wgsl */`${OPTIONS}
struct AssistDepthParams {size:vec4<u32>}
@group(0) @binding(0) var optics:texture_2d<f32>;
@group(0) @binding(1) var gridBase:texture_2d<f32>;
@group(0) @binding(2) var<uniform> u:Options;
@group(0) @binding(3) var<uniform> depthParams:AssistDepthParams;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0)vec4<f32>{
 let v=textureLoad(optics,vec2<i32>(p.xy),0);let uv=p.xy/vec2<f32>(textureDimensions(optics));let at=clamp(vec2<i32>(uv*vec2<f32>(depthParams.size.xy)),vec2<i32>(0),vec2<i32>(depthParams.size.xy)-1);
 let total=textureLoad(gridBase,at,0).y;let gap=max(0.0,total-v.w-u.visibility.y);
 if(u.visibility.z>.5&&u.visibility.z<1.5){let heat=1.0-exp(-gap);return vec4<f32>(heat,heat*.25,heat*.02,0);}
 if(u.visibility.z>1.5){return vec4<f32>(v.xyz,0);}
 return vec4<f32>(v.xyz,exp(-v.w-u.visibility.x*gap));
}
`;

export function createOpticalParticles(device,{transparent=false,indexedQuads=true,fusedResolve=true}={}) {
 if(typeof indexedQuads!=='boolean'||typeof fusedResolve!=='boolean')throw Error('Particle geometry and transfer options must be boolean');
 const quadIndices=indexedQuads?device.createBuffer({label:'particle quad topology',size:12,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST}):null;
 if(quadIndices)device.queue.writeBuffer(quadIndices,0,new Uint16Array([0,1,2,0,2,3]));
 const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const options=device.createBuffer({size:464,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const thermal=device.createBuffer({size:THERMAL_LUT.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(thermal,0,THERMAL_LUT);
 const exchange=createParticleExchange(device,{particleWgsl:'struct Particle {anchor:vec4<f32>,source:vec4<f32>,emission:vec4<f32>,motion:vec4<f32>,shape:vec4<f32>,state:vec4<f32>}'});
 const follow=createParticleFollow(device);
 let exchangeState=null,stagedAcquisition=null,followState=null;
 const pool=device.createBuffer({label:'particle rotating birth cursor',size:24,usage:storage});
 const camera=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const compute=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_COMPUTE_WGSL}),entryPoint:'update'}});
 const acquire=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_COMPUTE_WGSL}),entryPoint:'acquire'}});
 const finishBirths=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_COMPUTE_WGSL}),entryPoint:'finishBirths'}});
 let statisticsPipeline=null,statisticsResources=null,lastRenewal=null;
 let gridField=null;
 let depthField=null,depthPlan=null;const resolvePipelines=new Map();
 const present=new Map(),render=new Map();let particles=null,textures=[],key=null,frame=0,lastStep=null,info={effective:'off'};
 const retired=[];
 function retire(items){if(items.length)retired.push(...items);}
 function reset(){key=null;frame=0;lastRenewal=null;stagedAcquisition=null;followState=null;info={effective:'off',reason:'reset'};}
 function prepareAcquisition(encoder,{source,fine,dims,settings,identity,model=REACTANT_MODEL,staggered=false,profileWrites=()=>({})}){
  const s=opticalParticleSettings(settings),columns=s.populationWidth||Math.ceil(source.width/s.spacing),rows=s.populationHeight||Math.ceil(source.height/s.spacing),slots=s.capacity||columns*rows;
  const expected=JSON.stringify([slots,s.acquisitionMode,s.capacity?null:[columns,rows],identity]);
  if(!s.acquisitionMode||!particles||expected!==key||source.step<lastStep||s.followFraction<=0){followState={effective:'analytic-bootstrap-or-disabled'};return followState;}
  const stepDelta=source.step-lastStep,reactionDelta=stepDelta*(source.reactionStepScale??1);
  exchangeState=exchange.encode(encoder,{particles,slots,dims,pitch:2/dims[0],stepDelta:reactionDelta,frame:frame+1,strength:s.exchangeStrength,time:s.exchangeTime,cellSize:s.exchangeCellSize,profileWrites});
  followState=follow.encode(encoder,{particles,source,fine,grouping:exchangeState,dims,settings:s,model,stepDelta,reactionDelta,staggered,profileWrites});
  stagedAcquisition={key,step:source.step};return followState;
 }
 function encode(encoder,{view,format,source,fine,reactants,model=REACTANT_MODEL,material={},dims,invViewProj,settings,cameraValues,depth,identity,depthZeroToOne=false,profileWrites=()=>({}),gridExtinction=null,allowUnavailableGridExtinction=false}){
  if(!reactants)throw Error('Actual particle composition requires the current grid oxidizer texture');
  if(source.world||source.middle)throw Error('Carried-composition candidate currently requires a single Fine grid');
  const requested=opticalParticleSettings(settings),{width,height,pixels,step}=source;let s=requested;
  // Material diagnostics show every live carrier, including clear fuel/air,
  // without optical occlusion hiding the state being inspected.
  if(s.debugView>0)s={...s,depthMode:0,fillExtinction:0,extinctionView:0};
  const gridRequested=requested.fillExtinction>0||requested.extinctionView>0;let gridActive=gridRequested&&s.debugView===0,gridUnavailable=null;
  if(gridActive)try{validateParticleGridExtinction(gridExtinction,{viewProj:source.viewProj,dims});}catch(error){if(!allowUnavailableGridExtinction)throw error;gridUnavailable=error.message;gridActive=false;s={...s,fillExtinction:0,extinctionView:0};}
  const columns=s.populationWidth||Math.ceil(width/s.spacing),rows=s.populationHeight||Math.ceil(height/s.spacing),slots=s.capacity||columns*rows;
  const outputWidth=source.outputWidth??width,outputHeight=source.outputHeight??height;
  if(!Number.isSafeInteger(slots)||slots>0xffffffff)throw Error('Particle population exceeds u32 indexing');
  const targetWidth=Math.max(1,Math.ceil(outputWidth*s.targetScale)),targetHeight=Math.max(1,Math.ceil(outputHeight*s.targetScale));
  const plannedDepth=particleDepthLayout(s,{width:targetWidth,height:targetHeight,limit:device.limits});
  if(Math.max(targetWidth,targetHeight)>device.limits.maxTextureDimension2D)throw Error('Particle target exceeds device texture dimensions');
  if(slots*96>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error(`Particle population requires ${slots*96} bytes; exceeds effective device binding capacity`);
  if(Math.ceil(slots/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Particle population exceeds effective device compute dispatch capacity');
  if(s.acquisitionMode&&Math.ceil((source.samples??pixels)/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Fresh particle observations exceed effective device compute dispatch capacity');
  particleExchangePlan(device.limits,{slots,dims,pitch:2/dims[0],cellSize:s.exchangeCellSize});
  const nextKey=JSON.stringify([slots,s.acquisitionMode,s.capacity?null:[columns,rows],identity]);
  const resetNeeded=key!==nextKey||lastStep===null||step<lastStep;const dt=resetNeeded?0:step-lastStep;
  if(!particles||particles.size!==slots*96){retire(particles?[particles]:[]);particles=device.createBuffer({label:'shared world optical material carriers',size:slots*96,usage:storage});}
  const directTransfer=!gridActive&&fusedResolve&&targetWidth===outputWidth&&targetHeight===outputHeight;
  const formats=directTransfer?['rgba16float']:['rgba16float','rgba32float'],textureBytes=targetWidth*targetHeight*(directTransfer?8:24);
  if(textures.length!==formats.length||textures[0].width!==targetWidth||textures[0].height!==targetHeight){retire(textures);textures=formats.map(f=>device.createTexture({size:[targetWidth,targetHeight],format:f,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}));}
  if(resetNeeded){encoder.clearBuffer(particles);encoder.clearBuffer(pool);frame=0;}frame++;lastStep=step;key=nextKey;
  const data=new ArrayBuffer(464),f=new Float32Array(data),u=new Uint32Array(data);f.set(source.viewProj);f.set(invViewProj,16);u.set([width,height,slots,frame],32);
  const floorWidth=s.acquisitionMode?(source.displayWidth??outputWidth):width,floorHeight=s.acquisitionMode?(source.displayHeight??outputHeight):height;
  f.set([dt,s.refresh,source.backtrace,s.smokeLife],36);f.set([s.burnTime,s.cooling,s.heatRelease,s.sootYield],40);f.set([s.radius,s.stretch,columns,rows],44);f.set([s.flow,s.rise,s.drag,s.expansion],48);f.set([...dims,source.reactionStepScale??1],52);f.set([s.gain,s.opacity,s.maxAge,depthZeroToOne?1:0],56);f.set([targetWidth,targetHeight,s.flowAlignment,s.pixelFloor*Math.min(targetWidth/floorWidth,targetHeight/floorHeight)],60);f.set([s.supportFloor,s.carriedSmokeGain,s.generatedSmokeGain,s.projection],64);u.set([s.acquisitionMode,source.samples??pixels,outputWidth,outputHeight],68);f.set([s.scatteredGain,s.scatteredLife,0,0],72);f.set([s.reactionSeedLength,s.reactionSupportCoupling,s.renewalDiagnostics?1:0,0],76);f.set([s.fillExtinction,s.extinctionSlack,s.extinctionView,0],80);device.queue.writeBuffer(options,0,data);
  f.set([model.oxidizerRequirement,s.heatRelease,...model.ignitionBand],84);f.set([material.density??1,material.extinction??2,material.albedo??.35,material.smokeVisible??1],88);f.set([material.kelvinPerHeat??1600,material.thermalGain??1,material.cleanGain??.08,model.appearanceBurnReference??.01],92);f.set([s.lifeFuel,s.lifeHeat,s.lifeSmoke,s.lifeQuiet],96);f.set([s.stateLife,s.lifeFade,material.sootReference??1,s.debugView],100);f.set([s.emissionFalloff,s.emissionEdgeSoftness,particleKernelNormalization(s.emissionFalloff,s.emissionEdgeSoftness),s.exchangeCellSize],104);f.set([s.extinctionFalloff,s.extinctionEdgeSoftness,particleKernelNormalization(s.extinctionFalloff,s.extinctionEdgeSoftness),0],108);f.set([material.sootBurnoutRate??0,material.sootBurnoutKelvin??1300,0,0],112);device.queue.writeBuffer(options,0,data);
  statisticsResources={source,fine};
  if(!stagedAcquisition||stagedAcquisition.key!==key||stagedAcquisition.step!==step)exchangeState=exchange.encode(encoder,{particles,slots,dims,pitch:2/dims[0],stepDelta:dt*(source.reactionStepScale??1),frame,strength:s.exchangeStrength,time:s.exchangeTime,cellSize:s.exchangeCellSize,profileWrites});
  stagedAcquisition=null;
  if(resetNeeded||dt>0||frame===1){encoder.clearBuffer(pool,4,20);lastRenewal={frame,step,stepDelta:dt,reactionDelta:dt*(source.reactionStepScale??1),tracked:s.renewalDiagnostics};}
  const c=encoder.beginComputePass({label:'particle carried reaction, survival and native grid flow',...profileWrites('update')});c.setPipeline(compute);c.setBindGroup(0,device.createBindGroup({layout:compute.getBindGroupLayout(0),entries:[... [particles,source.buffer,fine,source.uniform,options,pool].map((buffer,binding)=>({binding,resource:{buffer}})),{binding:7,resource:reactants.createView()},{binding:8,resource:{buffer:thermal}}]}));c.dispatchWorkgroups(Math.ceil(slots/64));c.end();
  if(s.acquisitionMode){const p=encoder.beginComputePass({label:'particle fresh observations to rotating pool',...profileWrites('births')});p.setPipeline(acquire);p.setBindGroup(0,device.createBindGroup({layout:acquire.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:1,resource:{buffer:source.buffer}},{binding:2,resource:{buffer:fine}},{binding:3,resource:{buffer:source.uniform}},{binding:4,resource:{buffer:options}},{binding:5,resource:{buffer:pool}},{binding:7,resource:reactants.createView()}]}));p.dispatchWorkgroups(Math.ceil((source.samples??pixels)/64));p.setPipeline(finishBirths);p.setBindGroup(0,device.createBindGroup({layout:finishBirths.getBindGroupLayout(0),entries:[{binding:4,resource:{buffer:options}},{binding:5,resource:{buffer:pool}}]}));p.dispatchWorkgroups(1);p.end();}
  if(!gridActive&&gridField){gridField.dispose();gridField=null;}
  if(!s.depthMode&&depthField){depthField.dispose();depthField=null;}depthPlan=depthField?.layout??null;
  const readState=()=>({requested:true,effective:'world-optical-particles',width,height,slots,spacing:s.spacing,populationSize:s.capacity?[slots,1]:[columns,rows],sourcePixels:pixels,targetSize:[targetWidth,targetHeight],bytes:particles.size+textureBytes+(depthPlan?.bytes??0)+(quadIndices?.size??0)+(exchangeState?.bytes??0)+options.size+thermal.size+camera.size+pool.size,sourceBytes:source.buffer.size,totalBytes:particles.size+textureBytes+source.buffer.size+(depthPlan?.bytes??0)+(quadIndices?.size??0)+(exchangeState?.bytes??0)+options.size+thermal.size+camera.size+pool.size,memoryScope:"current pool, targets, grouping and uniforms; excludes in-flight retired resources and external fields",frames:frame,step,stepDelta:dt,reactionStepDelta:dt*(source.reactionStepScale??1),renewal:lastRenewal?{...lastRenewal}:null,settings:requested,effectiveDepthMode:s.depthMode,
   presentation:directTransfer?'direct-optical-transfer':'resolved-image',resolvePass:!directTransfer,geometry:indexedQuads?'indexed-quad':'expanded-quad',geometryBytes:quadIndices?.size??0,uniqueVertexReferences:indexedQuads?4:6,outputSize:[outputWidth,outputHeight],freshSamples:source.samples??pixels,follow:followState,collection:s.acquisitionMode?'rotating world-space pool':'camera-stratified slots',screenSupportUnits:s.acquisitionMode?'display pixels':'source pixels',drawn:s.showParticles,raymarchVisible:s.showRaymarch,recordFloats:24,shapeEncoding:'birth pitch; octahedral flow direction XY; represented ray length',
   clipDepth:depthZeroToOne?'zero-to-one':'minus-one-to-one',source:'native optical observation plus actual interpolated Fine fuel/heat/soot/oxidizer',flow:'current sampled Fine velocity plus authored heat-driven residual',reaction:'carried reactants; stoichiometric burn, thermal release, cooling and soot retirement',exchange:exchangeState?{bytes:exchangeState.bytes,cellDims:exchangeState.cellDims,cellCount:exchangeState.cellCount,fraction:exchangeState.effectiveFraction,grouping:exchangeState.grouping,mixing:exchangeState.mixing,counts:'pending explicit readback'}:null,lifetime:'state-weighted representation clock; independent advanced maximum age',view:s.debugView?'carried-material-diagnostic':'optical' ,gridAssist:{requested:gridRequested,effective:gridActive?'current-single-grid-extinction':gridUnavailable?'unavailable':'off',reason:gridUnavailable,strength:requested.fillExtinction,effectiveStrength:s.fillExtinction,slack:s.extinctionSlack,view:requested.extinctionView,frame:gridActive?gridExtinction.frame:null,generation:gridActive?gridExtinction.generation:null,coefficientSampling:gridActive?'prepared cell coefficients, exact cell traversal':'none'},depthField:depthPlan?{...depthPlan,mode:s.depthMode===1?'uniform-slice-mixture':'fractional-source-depth',range:'GPU retained positive camera-depth min/max',support:'one billboard center slice; piecewise-constant XY',cost:'bounds + one deposition + prefix + source raster'}:null,composition:s.depthMode?'depth-sliced particle extinction; ordered slices':'additive optical moments; approximate mixed-depth attenuation',generatedSmoke:'actual carried soot, updated by reaction and exchange; total visibility controlled by extinction gain',reset:resetNeeded});
  if(!s.showParticles){if(!s.showRaymarch){const clear=encoder.beginRenderPass({label:'hidden particle display clear',...profileWrites('present'),colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});clear.end();}if(retired.length){const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy())));}info=readState();return info;}
  const ms=depth.sampleCount>1;
  const depthCode=(deposit)=>s.depthMode?{declarations:`override PARTICLE_DEPTH_MODE:u32=${s.depthMode}u;${PARTICLE_DEPTH_RENDER_WGSL}${gridActive&&!deposit?PARTICLE_EXTINCTION_QUERY_WGSL:""}`,
   filter:deposit?`let ratio=vec2<f32>(particleDepth.size.xy)/u.raster.xy;
    if(any(ratio<vec2<f32>(1))){
     let ax=axis*major*ratio;let ay=vec2<f32>(-axis.y,axis.x)*minor*ratio;
     let a=ax.x*ax.x+ay.x*ay.x;let b=ax.y*ax.y+ay.y*ay.y;let c=ax.x*ax.y+ay.x*ay.y;
     let filtered=vec2<f32>(a,b)+vec2<f32>(1.0/12.0);let det=max(a*b-c*c,1e-20);let detFiltered=max(filtered.x*filtered.y-c*c,1e-20);
     footprintGain=sqrt(det/detFiltered);var theta=0.0;if(abs(c)+abs(a-b)>1e-20){theta=.5*atan2(2*c,a-b);}
     let faxis=vec2<f32>(cos(theta),sin(theta));let disc=sqrt((a-b)*(a-b)+4*c*c);let sig=sqrt(max(vec2<f32>(1e-20),(vec2<f32>(filtered.x+filtered.y)+vec2<f32>(disc,-disc))*.5));
     offset=(faxis*xy.x*sig.x+vec2<f32>(-faxis.y,faxis.x)*xy.y*sig.y)/ratio;
    }`:'',
   field:', @location(3) @interpolate(flat) depthInfo:vec2<f32>',
   vertex:`out.depthInfo=particleDepthCoordinate(center);${deposit?`let tile=particleDepthTile(u32(out.depthInfo.x));let size=vec2<f32>(particleDepth.size.xy);let dims=vec2<f32>(f32(particleDepth.size.z)*size.x,f32((particleDepth.size.w+particleDepth.size.z-1u)/particleDepth.size.z)*size.y);let at=(center.xy/center.w*vec2<f32>(.5,-.5)+.5)*size+vec2<f32>(tile)*size;center.xy=(at/dims*vec2<f32>(2,-2)+vec2<f32>(-1,1))*center.w;`:''}`,
   coords:deposit?'let local=v.clip.xy-vec2<f32>(particleDepthTile(u32(v.depthInfo.x))*particleDepth.size.xy);if(any(local<vec2<f32>(0))||any(local>=vec2<f32>(particleDepth.size.xy))){discard;}let sceneUv=local/vec2<f32>(particleDepth.size.xy);':'let sceneUv=v.clip.xy/u.raster.xy;',
   output:deposit?'return vec4<f32>(min(v.tau*weight,65504.0),0,0,0);':gridActive?'let ordinary=particleDepthWeight(v.clip.xy,v.depthInfo,v.tau*weight);let assisted=particleAssistedWeight(v.clip.xy,v.depthInfo,v.tau*weight);let visibility=select(assisted,max(0.0,ordinary-assisted),u.visibility.z>1.5);return vec4<f32>(v.light*visibility*lightWeight,v.tau*weight);':'return vec4<f32>(v.light*lightWeight*particleDepthWeight(v.clip.xy,v.depthInfo,v.tau*weight),v.tau*weight);'}:
   {declarations:'',filter:'',field:'',vertex:'',coords:'let sceneUv=v.clip.xy/u.raster.xy;',output:'return vec4<f32>(v.light*lightWeight,v.tau*weight);'};
  function raster(deposit=false){
   const key=`${ms}:${s.depthMode}:${deposit}:${gridActive}`;let rp=render.get(key);
   if(!rp){const dc=depthCode(deposit);const code=RENDER.replace('DEPTH_DECLARATIONS',dc.declarations).replace('DEPTH_FOOTPRINT_FILTER',dc.filter).replace('DEPTH_VERTEX_FIELD',dc.field).replace('DEPTH_VERTEX_TRANSFORM',dc.vertex).replace('DEPTH_FRAGMENT_COORDINATES',dc.coords).replace('DEPTH_FRAGMENT_OUTPUT',dc.output).replace('DEPTH_TYPE',ms?'texture_depth_multisampled_2d':'texture_depth_2d').replace('DEPTH_LOAD','textureLoad(sceneDepth,pixel,0)').replace('DEPTH_REDUCE',ms?'for(var sample=1u;sample<textureNumSamples(sceneDepth);sample++){depth=min(depth,textureLoad(sceneDepth,pixel,sample));}':'');const module=device.createShaderModule({code});
    const blend={color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}};
    rp=device.createRenderPipeline({label:deposit?'particle extinction slice deposition':'particle depth-weighted source',layout:'auto',vertex:{module,entryPoint:'vs',constants:{PARTICLE_INDEXED_QUADS:indexedQuads}},fragment:{module,entryPoint:'fs',targets:[{format:deposit?'r16float':'rgba16float',blend}]},primitive:{topology:'triangle-list'}});render.set(key,rp);}
   const r=encoder.beginRenderPass({label:deposit?'particle extinction deposition':'spatial material support',...profileWrites(deposit?'depthDeposit':'raster'),colorAttachments:[{view:(deposit?depthField.target:textures[0]).createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});r.setPipeline(rp);r.setBindGroup(0,device.createBindGroup({layout:rp.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:1,resource:{buffer:options}},{binding:2,resource:depth.createView()},...(s.depthMode?depthField.entries(!deposit):[]),...(gridActive&&!deposit?gridField.entries():[])]}));if(quadIndices){r.setIndexBuffer(quadIndices,'uint16');r.drawIndexed(6,slots);}else r.draw(6,slots);r.end();
  }
  if(s.depthMode){depthField??=createParticleDepthField(device,{optionsWgsl:OPTIONS+PARTICLE_STATE_WGSL+PARTICLE_MATERIAL_WGSL,options});depthPlan=depthField.prepare(encoder,s,{width:targetWidth,height:targetHeight,limit:device.limits},particles,slots,profileWrites);raster(true);depthField.prefix(encoder,profileWrites);if(gridActive){gridField??=createParticleGridExtinction(device,{optionsWgsl:OPTIONS,options});gridField.encode(encoder,{field:gridExtinction,depthField,layout:depthPlan,sceneDepth:depth,profileWrites});}}
  raster();
  if(!directTransfer){let resolvePipeline=resolvePipelines.get(gridActive?"assist":!!s.depthMode);if(!resolvePipeline){const module=device.createShaderModule({code:gridActive?ASSIST_RESOLVE:s.depthMode?RESOLVE.replace(OPTICAL_TRANSFER,DEPTH_TRANSFER):RESOLVE});
  resolvePipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba32float'}]}});resolvePipelines.set(gridActive?"assist":!!s.depthMode,resolvePipeline);}
  const resolve=encoder.beginRenderPass({label:'material optical moment transfer',...profileWrites('resolve'),colorAttachments:[{view:textures[1].createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});resolve.setPipeline(resolvePipeline);resolve.setBindGroup(0,device.createBindGroup({layout:resolvePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:textures[0].createView()},...(gridActive?[{binding:1,resource:gridField.base.createView()},{binding:2,resource:{buffer:options}},{binding:3,resource:depthField.entries()[0].resource}]:[])]}));resolve.draw(3);resolve.end();}
  const presentKey=format+':overlay='+s.showRaymarch+':direct='+directTransfer+':depth='+!!s.depthMode;
  let pp=present.get(presentKey);if(!pp){let code=INTEGRAL_PRESENT_WGSL.replace('let v=textureLoad(image,vec2<i32>(p.xy),0);',`let dims=vec2<i32>(textureDimensions(image));let uv=p.xy/u.reserved_render_controls.xy;let q=uv*vec2<f32>(dims)-.5;let base=vec2<i32>(floor(q));let f=fract(q);let hi=dims-vec2<i32>(1);var v:vec4<f32>;if(all(vec2<f32>(dims)==u.reserved_render_controls.xy)){v=textureLoad(image,vec2<i32>(p.xy),0);}else{v=mix(mix(textureLoad(image,clamp(base,vec2<i32>(0),hi),0),textureLoad(image,clamp(base+vec2<i32>(1,0),vec2<i32>(0),hi),0),f.x),mix(textureLoad(image,clamp(base+vec2<i32>(0,1),vec2<i32>(0),hi),0),textureLoad(image,clamp(base+vec2<i32>(1,1),vec2<i32>(0),hi),0),f.x),f.y);}`);
   if(directTransfer)code=(s.depthMode?DEPTH_TRANSFER:OPTICAL_TRANSFER)+INTEGRAL_PRESENT_WGSL.replace('let v=textureLoad(image,vec2<i32>(p.xy),0);','let v=particleOpticalTransfer(textureLoad(image,vec2<i32>(p.xy),0));');
   const m=device.createShaderModule({code});pp=device.createRenderPipeline({layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'present',constants:{TRANSPARENT_CANVAS:transparent||s.showRaymarch},targets:[{format,...(s.showRaymarch?{blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}:{})}]}});present.set(presentKey,pp);}
  const displayCamera=new Float32Array(cameraValues);displayCamera.set([outputWidth,outputHeight],16);device.queue.writeBuffer(camera,0,displayCamera);
  const output=encoder.beginRenderPass({label:'native optical particle presentation',...profileWrites('present'),colorAttachments:[{view,loadOp:s.showRaymarch?'load':'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});output.setPipeline(pp);output.setBindGroup(0,device.createBindGroup({layout:pp.getBindGroupLayout(0),entries:[{binding:0,resource:textures[directTransfer?0:1].createView()},{binding:1,resource:{buffer:camera}}]}));output.draw(3);output.end();
  if(retired.length){const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy())));}
  info=readState();return info;
 }
 async function sample(){if(!particles||!frame||key===null)return {available:false,state:info};const epoch=frame,sourceKey=key,snapshot=structuredClone(info),p=particles,read=device.createBuffer({size:p.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(p,0,read,0,p.size);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);if(frame!==epoch||key!==sourceKey||particles!==p)throw Error('Particle readback became stale');return {available:true,state:snapshot,records:new Float32Array(read.getMappedRange().slice(0))};}finally{read.unmap();read.destroy();}}
 async function statistics(){
  if(!particles||!statisticsResources||!frame||key===null)return {available:false,reason:'No current particle population'};
  const snapshot=structuredClone(info),src=statisticsResources.source;
  statisticsPipeline??=device.createComputePipeline({label:'compact particle population statistics',layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_COMPUTE_WGSL}),entryPoint:'populationStatistics'}});
  const output=device.createBuffer({size:64,usage:storage}),read=device.createBuffer({size:64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const e=device.createCommandEncoder(),p=e.beginComputePass({label:'snapshot optical population and source counts'});p.setPipeline(statisticsPipeline);p.setBindGroup(0,device.createBindGroup({layout:statisticsPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:1,resource:{buffer:src.buffer}},{binding:4,resource:{buffer:options}},{binding:5,resource:{buffer:pool}},{binding:6,resource:{buffer:output}}]}));p.dispatchWorkgroups(1);p.end();e.copyBufferToBuffer(output,0,read,0,64);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const data=read.getMappedRange().slice(0),u=new Uint32Array(data),f=new Float32Array(data),tracked=snapshot.renewal?.tracked===true,placed=snapshot.settings.acquisitionMode||tracked?u[6]:null;
   return {available:true,state:snapshot,active:u[0],evaluated:u[1],valid:u[2],emissive:u[3],extinctive:u[4],accepted:snapshot.settings.acquisitionMode||tracked?u[5]:null,placed,overwritten:tracked?u[7]:null,expired:tracked?u[8]:null,escaped:tracked?u[9]:null,followed:u[10],age:{min:f[12],max:f[13],mean:u[0]?f[14]/u[0]:0},renewal:snapshot.renewal,reactionDelta:snapshot.renewal?.reactionDelta??0,overwriteUpdates:placed?snapshot.slots/placed:null,identity:{frame:u[11],step:snapshot.step},definition:'evaluated/valid rows describe the current anchored source batch; renewal counters and reactionDelta describe the last population update, retained across paused draws; diagnostic counters require tracking during that update'};
  }finally{read.unmap();read.destroy();output.destroy();}
 }
 return {encode,prepareAcquisition,reset,read:()=>info,sample,statistics,dispose(){exchange.dispose();gridField?.dispose();gridField=null;depthField?.dispose();depthField=null;retire([options,thermal,camera,pool,...(quadIndices?[quadIndices]:[]),...textures,...(particles?[particles]:[])]);const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy())));particles=null;textures=[];}};
}
