import {PARTICLE_LIGHT_MATERIAL_WGSL, PARTICLE_SEED_SELECTION_WGSL} from './volume-optical-particles.mjs';
import {PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';
import {PARTICLE_COHORT_RECORD_WGSL, PARTICLE_COHORT_SAMPLE_WGSL} from './volume-particle-cohort-abi.mjs';
import {createPacketCandidates, PACKET_BUNDLE_STRUCT_WGSL} from './volume-packet-candidates.mjs';

// Single-seed inspection of the native bundle support convention. The
// neighborhood is a box in Fine coordinates with a finite axial interval.
function cohortShader() {
 return `${PARTICLE_LIGHT_MATERIAL_WGSL}${PARTICLE_STATE_WGSL}${PARTICLE_SEED_SELECTION_WGSL}
 ${PACKET_BUNDLE_STRUCT_WGSL}${PARTICLE_COHORT_RECORD_WGSL}
 struct Controls {pointAndScale:vec4<f32>, radius:f32, pixelRadius:f32, picking:u32, pad:u32}
 struct Pick {distance:atomic<u32>, slot:atomic<u32>}
 struct Counts {
  slot:u32, generation:u32, seedAlive:u32, pad:u32,
  original:atomic<u32>, fresh:atomic<u32>, overlap:atomic<u32>, emittingOriginal:atomic<u32>,
  emittingFresh:atomic<u32>, extinctiveOriginal:atomic<u32>, extinctiveFresh:atomic<u32>, pad2:u32,
  projectedSeed:vec4<f32>,
 }
 @group(0) @binding(0) var<storage,read> particles:array<Particle>;
 @group(0) @binding(1) var<storage,read> generations:array<u32>;
 @group(0) @binding(2) var<uniform> optical:Options;
 @group(0) @binding(3) var<uniform> controls:Controls;
 @group(0) @binding(4) var<storage,read_write> pick:Pick;
 @group(0) @binding(5) var<storage,read_write> seed:vec2<u32>;
 @group(0) @binding(6) var<storage,read_write> bundle:Bundle;
 @group(0) @binding(7) var<storage,read> candidates:array<u32>;
 @group(0) @binding(8) var<storage,read> draw:array<u32>;
 @group(0) @binding(9) var<storage,read_write> mask:array<u32>;
 @group(0) @binding(10) var<storage,read_write> frozen:array<u32>;
 @group(0) @binding(11) var<storage,read_write> counts:Counts;
 ${PARTICLE_COHORT_SAMPLE_WGSL}

 fn pickDistance(i:u32)->u32 {
  let p=particles[i];let g=generations[i];
  if(p.anchor.w<=0.0||p.shape.w<=0.0||g==0u||g==0xffffffffu||
     !particleSelected(i,g,optical.viewRaster.w)||!particleMatchesPhase(p,optical)){return 0xffffffffu;}
  let v=optical.viewProj*vec4<f32>(p.anchor.xyz,1.0);
  let near=select(-v.w,0.0,optical.gain.w>0.5);
  if(v.w<=0.0||v.z<near||v.z>v.w){return 0xffffffffu;}
  let d=(v.xy/v.w-controls.pointAndScale.xy)*controls.pointAndScale.zw;
  let d2=dot(d,d);
  return select(0xffffffffu,bitcast<u32>(d2),d2<=controls.pixelRadius*controls.pixelRadius);
 }
 @compute @workgroup_size(64) fn closest(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x<arrayLength(&particles)){atomicMin(&pick.distance,pickDistance(id.x));}
 }
 @compute @workgroup_size(64) fn choose(@builtin(global_invocation_id) id:vec3<u32>){
  let distance=atomicLoad(&pick.distance);
  if(id.x<arrayLength(&particles)&&distance!=0xffffffffu&&pickDistance(id.x)==distance){atomicMin(&pick.slot,id.x);}
 }
 @compute @workgroup_size(1) fn center(){
  if(controls.picking!=0u){
   let slot=atomicLoad(&pick.slot);
   seed=vec2<u32>(slot,0u);
   if(slot<arrayLength(&particles)){seed.y=generations[slot];}
  }
  counts.slot=seed.x;counts.generation=seed.y;
  bundle.weight=vec4<f32>(0);
  let seedSample=sampleMember(ParticleCohortMember(seed.x,seed.y,1.0,0u));
  if(seedSample.positionAndAlive.w==0.0){return;}
  counts.seedAlive=1u;
  let clip=optical.viewProj*vec4<f32>(seedSample.positionAndAlive.xyz,1.0);
  if(clip.w>0.0&&clip.z>=select(-clip.w,0.0,optical.gain.w>0.5)&&clip.z<=clip.w){
   counts.projectedSeed=vec4<f32>(clip.xy/clip.w,1,0);
  }
  let r=controls.radius;
  bundle=Bundle(vec4<f32>(seedSample.positionAndAlive.xyz-vec3<f32>(0,0,r),0),
    vec4<f32>(0,0,1,r*2),vec4<f32>(1,0,0,r),vec4<f32>(0,1,0,r),vec4<f32>(1,0,0,0),vec4<u32>(0));
 }
 @compute @workgroup_size(64) fn markFresh(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x>=draw[1]){return;}
  // One bundle has at most one candidate per slot. Domain outliers get
  // through the broad phase, so check every admitted slot against the box.
  let i=candidates[id.x];
  let p=particles[i];
  let radius=abs(particleLightBaseRadius(p,optical));
  let lateral=4.0*max(radius.x,max(radius.y,radius.z));
  let d=abs(p.anchor.xyz-(bundle.origin.xyz+vec3<f32>(0,0,controls.radius)));
  if(any(d>vec3<f32>(controls.radius)+vec3<f32>(lateral,lateral,p.shape.w*0.5))){return;}
  mask[i]=2u;
 }
 @compute @workgroup_size(64) fn inspect(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;
  if(i>=arrayLength(&frozen)){return;}
  let fresh=mask[i]==2u;
  if(controls.picking!=0u){frozen[i]=select(0u,generations[i],fresh);}
  let generation=frozen[i];
  if(!fresh&&generation==0u){return;}
  let originalSample=sampleMember(ParticleCohortMember(i,select(generation,generations[i],fresh),1.0,0u));
  if(originalSample.positionAndAlive.w==0.0){mask[i]=0u;return;}
  let original=generation==generations[i];
  mask[i]|=u32(original);
  let light=originalSample.intrinsicAndExtinction;
  let emits=u32(any(light.xyz>vec3<f32>(0)));
  let blocks=u32(light.w>0.0);
  if(original){
   atomicAdd(&counts.original,1u);
   atomicAdd(&counts.emittingOriginal,emits);
   atomicAdd(&counts.extinctiveOriginal,blocks);
  }
  if(fresh){
   atomicAdd(&counts.fresh,1u);
   atomicAdd(&counts.emittingFresh,emits);
   atomicAdd(&counts.extinctiveFresh,blocks);
  }
  if(original&&fresh){atomicAdd(&counts.overlap,1u);}
 }`;
}

const countKeys = ['seedSlot','seedGeneration','seedAlive',null,'original','fresh','overlap',
 'emittingOriginal','emittingFresh','extinctiveOriginal','extinctiveFresh'];

export function createLiveParticleCohort(device, retire) {
 const module=device.createShaderModule({label:'live source neighborhood comparison',code:cohortShader()});
 const bindings={
  closest:[0,1,2,3,4], choose:[0,1,2,3,4], center:[0,1,2,3,4,5,6,11],
  markFresh:[0,2,3,6,7,8,9], inspect:[0,1,2,3,9,10,11],
 };
 const pipelines=new Map();
 const selector=createPacketCandidates(device,PACKET_BUNDLE_STRUCT_WGSL);
 let arena, epoch, acquisitionStep, radiusAtPick, status, pending, revision=0;
 function dispose(){
  revision++;
  if(arena)retire(Object.values(arena));
  selector.dispose();
  arena=null;status=null;epoch=null;acquisitionStep=null;
 }
 function encode(encoder,{material,pick,step,radiusCells,profileWrites=()=>({}),afterSubmit}){
  const {slots,identity}=material;
  const invalidated=!!arena&&(epoch!==identity.epoch||arena.mask.size!==4*slots);
  if(invalidated)dispose();
  if(!arena&&!pick)return {mask:null,status:{phase:'expired'}};
  if(!arena){
   const {STORAGE,COPY_DST,COPY_SRC,UNIFORM}=GPUBufferUsage;
   const buffer=(label,size,usage=STORAGE|COPY_DST)=>device.createBuffer({label,size,usage});
   arena={control:buffer('cohort controls',32,UNIFORM|COPY_DST), pick:buffer('projected seed pick',8),
    seed:buffer('cohort seed key',8), bundle:buffer('cohort neighborhood',96),
    mask:buffer('cohort comparison mask',4*slots), frozen:buffer('cohort original generations',4*slots),
    counts:buffer('cohort inspection counts',64,STORAGE|COPY_DST|COPY_SRC)};
   epoch=identity.epoch;
  }
  if(pick){
   revision++;
   acquisitionStep=step;radiusAtPick=radiusCells*material.domain.pitch;status=null;
   device.queue.writeBuffer(arena.pick,0,new Uint32Array([0xffffffff,0xffffffff]));
  }
  const params=new ArrayBuffer(32);
  new Float32Array(params).set([...(pick?.point??[0,0]),...(pick?.pixelScale??[1,1]),radiusAtPick,pick?.radiusPixels??0]);
  new Uint32Array(params)[6]=Number(!!pick);
  device.queue.writeBuffer(arena.control,0,params);
  encoder.clearBuffer(arena.mask);
  encoder.clearBuffer(arena.counts);
  const resources=[material.particles,material.birthGenerations,material.options,arena.control,arena.pick,
   arena.seed,arena.bundle,null,null,arena.mask,arena.frozen,arena.counts];
  const groups=Math.ceil(slots/64);
  function run(entryPoint,workgroups=groups){
   if(!pipelines.has(entryPoint))pipelines.set(entryPoint,device.createComputePipeline({
    label:'cohort '+entryPoint,layout:'auto',compute:{module,entryPoint}}));
   const pipeline=pipelines.get(entryPoint);
   const pass=encoder.beginComputePass({label:pipeline.label});
   pass.setPipeline(pipeline);
   pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),
    entries:bindings[entryPoint].map(binding=>({binding,resource:{buffer:resources[binding]}}))}));
   pass.dispatchWorkgroups(workgroups);
   pass.end();
  }
  if(pick){run('closest');run('choose');}
  run('center',1);
  const selection=selector.encode(encoder,{material,bundleBuffer:arena.bundle,
   plan:{bundles:1,slots,instances:slots},profileWrites:key=>profileWrites('cohort-'+key)});
  resources[7]=selection.ids;resources[8]=selection.draw;
  run('markFresh');run('inspect');

  if(!pending&&afterSubmit){
   const captured={step,acquisitionStep,reusedIndex:selection.reusedIndex};
   const version=revision;
   const read=device.createBuffer({label:'cohort counts readback',size:64,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
   encoder.copyBufferToBuffer(arena.counts,0,read,0,64);
   pending=read;
   afterSubmit(()=>read.mapAsync(GPUMapMode.READ).then(()=>{
     const range=read.getMappedRange(),data=new Uint32Array(range),projection=new Float32Array(range,48,4);
     if(revision===version)status={...captured,...Object.fromEntries(countKeys.flatMap((key,i)=>key?[[key,data[i]]]:[])),
      projectedSeed:projection[2]?[projection[0],projection[1]]:null,
      phase:data[1]===0?'no-seed':data[2]?'tracking':'seed-lost'};
    },error=>{if(revision===version)status={...captured,phase:'unavailable',reason:error.message};}).finally(()=>{
     read.destroy();if(pending===read)pending=null;
    }));
  }
  return {mask:arena.mask};
 }
 return {encode,dispose,read:()=>status};
}
