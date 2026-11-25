import {EARTH_GPU_WGSL} from './shader.mjs';
// Fine matrix particles contact grit and each other, but not the boundary of
// their own continuum support. Attachment reactions already couple that mass.
const contactStart='let b=bodies[i];\n for(var f=0u;f<p.counts.w;f++)';
if(!EARTH_GPU_WGSL.includes(contactStart))throw Error('Earth material-contact entry changed');
export const REGION_MATH_WGSL=`
fn regionDamageNext(old:f32,strain:f32,dt:f32,rate:f32)->f32{return clamp(old+max(strain-0.25,0.0)*dt*rate,old,1.0);}
fn regionCorrection(error:vec3f,inverseMass:f32,strength:f32)->vec3f{return -error/max(inverseMass,1e-30)*strength;}
`;
const start=EARTH_GPU_WGSL.indexOf('@compute @workgroup_size(64) fn transition('),end=EARTH_GPU_WGSL.indexOf('@compute @workgroup_size(64) fn apply(');
if(start<0||end<=start)throw Error('Earth transition entry changed');
const base=EARTH_GPU_WGSL.slice(0,start)+'@compute @workgroup_size(64) fn transition(){}\n'+EARTH_GPU_WGSL.slice(end);
export const REGION_WGSL=base.replace('for(var sa=0u;sa<2u;sa++){for(var sb=0u;sb<2u;sb++){','for(var sa=0u;sa<select(2u,1u,a.shape.z>1.5);sa++){for(var sb=0u;sb<select(2u,1u,b.shape.z>1.5);sb++){').replace('@group(0) @binding(8) var<storage,read> ties:array<vec4u>;','@group(0) @binding(8) var<storage,read_write> regionLinks:array<RegionLink>;').replace(contactStart,'let b=bodies[i];if(b.shape.z>1.5){return;}\n for(var f=0u;f<p.counts.w;f++)')+REGION_MATH_WGSL+`
struct RegionLink{ids:vec4u,extra:vec4u,weights:vec4f,law:vec4f}
struct RegionControl{law:vec4f,gripDelta:vec4f,gripGain:f32}
@group(0) @binding(9) var<uniform> regionControl:RegionControl;
@compute @workgroup_size(64) fn regionDamage(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&regionLinks)){return;}var c=regionLinks[i];if(c.extra.y!=1u){return;}
 let strain=max(0.0,distance(bodies[c.ids.x].p.xyz,bodies[c.ids.y].p.xyz)/c.law.y-1.0);
 // Above the original stiffness range, extend the strain tolerance.
 let toughness=max(1.0,regionControl.law.x);
 c.law.z=regionDamageNext(c.law.z,strain/toughness,p.domain.w,regionControl.law.y);regionLinks[i]=c;
}
@compute @workgroup_size(64) fn regionConstraints(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&regionLinks)){return;}let c=regionLinks[i];let a=c.ids.x;
 if(c.extra.y==2u){
  let corner=c.extra.z==1u;
  let delta=select(vec3f(0),regionControl.gripDelta.xyz,corner);
  let gain=select(1.0,regionControl.gripGain,corner);
  let shift=regionCorrection(bodies[a].p.xyz-c.weights.xyz-delta,bodies[a].p.w,c.law.x*gain);
  addDelta(a,shift*bodies[a].p.w,vec3f(0));return;
 }
 if(c.extra.y==1u){
  let b=c.ids.y;let d=bodies[a].p.xyz-bodies[b].p.xyz;let len=length(d);if(len<1e-20){return;}
  let shift=regionCorrection(d/len*(len-c.law.y),bodies[a].p.w+bodies[b].p.w,c.law.x*min(1.0,regionControl.law.x)*(1.0-c.law.z)*(1.0-c.law.z));
  addDelta(a,shift*bodies[a].p.w,vec3f(0));addDelta(b,-shift*bodies[b].p.w,vec3f(0));return;
 }
 let ids=vec4u(c.ids.yzw,c.extra.x);var destination=vec3f(0);var inverseMass=bodies[a].p.w;
 for(var k=0u;k<4u;k++){destination+=bodies[ids[k]].p.xyz*c.weights[k];inverseMass+=bodies[ids[k]].p.w*c.weights[k]*c.weights[k];}
 let shift=regionCorrection(bodies[a].p.xyz-destination,inverseMass,c.law.x*regionControl.law.z);
 addDelta(a,shift*bodies[a].p.w,vec3f(0));for(var k=0u;k<4u;k++){addDelta(ids[k],-shift*bodies[ids[k]].p.w*c.weights[k],vec3f(0));}
}
`;
