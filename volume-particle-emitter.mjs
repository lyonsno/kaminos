import {IMMERSED_COLLECTION_WGSL,IMMERSED_SINGLE_SOURCE_WGSL} from './volume-immersed-source-collection-wgsl.mjs';

// The same per-cell source law as the simulator, including source pattern,
// puff, velocity-dependent supply, and the actual solid exclusion.
export const PARTICLE_EMITTER_WGSL=/* wgsl */`
struct EmitterBirth {
 immersed_source_a:vec4<f32>, immersed_source_b:vec4<f32>, immersed_source_c:vec4<f32>,
 immersed_source_d:vec4<f32>, immersed_source_e:vec4<f32>, immersed_source_f:vec4<f32>,
 lo:vec4<i32>, span:vec4<u32>, schedule:vec4<u32>, stepScale:vec4<f32>,
}
@group(0) @binding(9) var<uniform> emitter:EmitterBirth;
@group(0) @binding(10) var<storage,read_write> sourceCdf:array<f32>;
@group(0) @binding(11) var<storage,read_write> freeSlots:array<atomic<u32>>;
@group(0) @binding(12) var inflowCoverage:texture_2d<f32>;
@group(0) @binding(13) var inflowPerturbation:texture_2d<f32>;
@group(0) @binding(14) var sourceSolids:texture_3d<u32>;
${IMMERSED_SINGLE_SOURCE_WGSL.replaceAll('u.immersed_source_','emitter.immersed_source_').replaceAll('f32(GRID)','f32(emitter.schedule.z)')}
${IMMERSED_COLLECTION_WGSL.replace('@binding(33)','@binding(15)').replaceAll('u.immersed_source_','emitter.immersed_source_').replaceAll('f32(GRID)','f32(emitter.schedule.z)')}
fn emitterCell(i:u32)->vec3<i32>{
 let s=emitter.span.xyz;return emitter.lo.xyz+vec3<i32>(i32(i%s.x),i32(i/s.x%s.y),i32(i/(s.x*s.y)));
}
@compute @workgroup_size(1) fn measureEmitter(){
 // One small, ordered scan over the admitted source bounds, not the volume.
 // Interval width is actual local created volume in material-cell units.
 var total=0.0;
 for(var i=0u;i<emitter.span.w;i++){
  let c=emitterCell(i);
  if(textureDimensions(sourceSolids).x!=emitter.schedule.z||textureLoad(sourceSolids,c,0).x==0u){
   let entry=immersedContributions(vec3<f32>(c)+.5);
   total+=clamp(entry.supply*emitter.stepScale.x,0.0,1.0);
  }
  sourceCdf[i]=total;
 }
}
@compute @workgroup_size(64) fn findFreeEmitterSlots(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;
 if(i<u.size.z&&particles[i].anchor.w<=0.0){
  let free=atomicAdd(&freeSlots[0],1u);atomicStore(&freeSlots[free+1u],i);
 }
}
fn emitterRandom(seed:u32)->f32{return f32(hash32(seed)>>8u)/16777216.0;}
@compute @workgroup_size(64) fn birthFromEmitter(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;let count=emitter.schedule.x;
 if(i>=count){return;}
 let total=sourceCdf[emitter.span.w-1u];
 if(total<=0.0){return;}
 let free=atomicLoad(&freeSlots[0]);
 if(i==0u){atomicStore(&pool.legacyBirths,count-min(count,free));}
 if(i>=free){return;}
 atomicAdd(&pool.frameBirths,1u);
 let seed=hash32(i+emitter.schedule.y*1664525u);
 // Stratify the supply CDF over the births actually placed. Dropped slots
 // still drop their share of volume rather than strengthening survivors.
 let at=min(total*(1.0-1e-7),total*(f32(i)+emitterRandom(seed))/f32(min(free,count)));
 var lo=0u;var hi=emitter.span.w-1u;
 while(lo<hi){let mid=lo+(hi-lo)/2u;if(sourceCdf[mid]>at){hi=mid;}else{lo=mid+1u;}}
 let pitch=2.0/f32(emitter.schedule.z);
 let jitter=vec3<f32>(emitterRandom(seed+1u),emitterRandom(seed+2u),emitterRandom(seed+3u));
 let position=(vec3<f32>(emitterCell(lo))+vec3<f32>(.05)+.9*jitter)*pitch-1.0;
 let material=particleGridState(position);
 let intrinsic=particleIntrinsic(material,0.0);
 // pitch² × thickness = physical share in Fine-local volume units.
 let thickness=total*pitch/f32(count);
 let slot=atomicLoad(&freeSlots[i+1u]);
 particles[slot]=Particle(vec4<f32>(position,1),vec4<f32>(0),vec4<f32>(intrinsic,material.x),
   vec4<f32>(0),vec4<f32>(pitch,0,1,thickness),material);
}
`;

export function emitterBirthDispatch(device,settings,emitter,dims,step,delta,backtrace){
 if(!emitter||!settings.birthsEnabled||!settings.emitterBirthsPerStep||delta<=0||emitter.sourceStep!==step-1)return null;
 const cells=emitter.span.reduce((a,b)=>a*b,1);
 if(!cells)return null;
 const count=settings.emitterBirthsPerStep;
 if(!Number.isSafeInteger(cells)||cells>0xffffffff||cells*4>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error('Emitter support exceeds device storage capacity');
 const data=new ArrayBuffer(160),f=new Float32Array(data),u=new Uint32Array(data),i=new Int32Array(data);
 f.set(emitter.uniformValues);i.set(emitter.lo,24);u.set([...emitter.span,cells],28);
 u.set([count,step,dims[0],0],32);f.set([backtrace,0,0,0],36);
 return {data,count,cells,sourceStep:emitter.sourceStep};
}
