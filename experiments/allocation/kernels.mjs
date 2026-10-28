export function kernel(c,capacity,sparse) {
 return `
const N:u32=${c.size}u; const B:u32=${c.brick}u; const Q:u32=N/B; const CELLS:u32=B*B*B; const CAP:u32=${capacity}u;
const VELOCITY=vec3<f32>(${c.velocity.map(v=>v.toFixed(8)).join(',')});
struct Box {lo:vec4<i32>,hi:vec4<i32>};
struct Step {value:u32};
@group(0) @binding(0) var<storage,read> src:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read_write> dst:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> oldMap:array<u32>;
@group(0) @binding(3) var<storage,read_write> newMap:array<u32>;
@group(0) @binding(4) var<storage,read_write> ids:array<u32>;
@group(0) @binding(5) var<storage,read_write> count:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read> boxes:array<Box>;
@group(0) @binding(7) var<uniform> step:Step;
fn xyz(i:u32,n:u32)->vec3<u32>{return vec3<u32>(i%n,(i/n)%n,i/(n*n));}
fn linear(p:vec3<u32>,n:u32)->u32{return p.x+n*(p.y+n*p.z);}
fn readCell(p:vec3<i32>)->vec4<f32>{
 if(any(p<vec3<i32>(0))||any(p>=vec3<i32>(i32(N)))){return vec4<f32>(0);}
 let u=vec3<u32>(p);
 ${sparse?`let slot=oldMap[linear(u/B,Q)];if(slot==0xffffffffu){return vec4<f32>(0);}return src[slot*CELLS+linear(u%B,B)];`:`return src[linear(u,N)];`}
}
fn initial(p:vec3<i32>)->vec4<f32>{
 for(var j=0u;j<arrayLength(&boxes);j++){
  if(all(p>=boxes[j].lo.xyz)&&all(p<boxes[j].hi.xyz)){
   let v=.5+.5*sin(dot(vec3<f32>(p),vec3<f32>(.31,.17,.23)));
   return vec4<f32>(.5+.5*v,.7+.3*v,.1*v,0);
  }
 }return vec4<f32>(0);
}
fn material(p:vec3<i32>)->vec4<f32>{
 if(step.value==0u){return initial(p);}
 let back=vec3<f32>(p)-VELOCITY;let lo=vec3<i32>(floor(back));let w=fract(back);
 let a=mix(readCell(lo),readCell(lo+vec3<i32>(1,0,0)),w.x);
 let b=mix(readCell(lo+vec3<i32>(0,1,0)),readCell(lo+vec3<i32>(1,1,0)),w.x);
 let d=mix(readCell(lo+vec3<i32>(0,0,1)),readCell(lo+vec3<i32>(1,0,1)),w.x);
 let e=mix(readCell(lo+vec3<i32>(0,1,1)),readCell(lo+vec3<i32>(1,1,1)),w.x);
 let v=mix(mix(a,b,w.y),mix(d,e,w.y),w.z);
 // Representative local reaction, identical on both routes; zero stays zero.
 let burn=min(v.x,max(0.0,v.y-.15)*.025);
 return vec4<f32>(v.x-burn,(v.y+burn*.3)*.995,v.z+burn*.2,burn);
}
@compute @workgroup_size(1) fn reset(){atomicStore(&count[0],0u);atomicStore(&count[1],1u);atomicStore(&count[2],1u);atomicStore(&count[3],0u);}
@compute @workgroup_size(64) fn allocate(@builtin(global_invocation_id) gid:vec3<u32>){
 let id=gid.x;if(id>=Q*Q*Q){return;}let p=vec3<i32>(xyz(id,Q)*B);newMap[id]=0xffffffffu;
 for(var j=0u;j<arrayLength(&boxes);j++){
  let lo=max(vec3<i32>(0),boxes[j].lo.xyz+i32(step.value)*vec3<i32>(floor(VELOCITY)));
  let hi=min(vec3<i32>(i32(N)),boxes[j].hi.xyz+i32(step.value)*vec3<i32>(ceil(VELOCITY)));
  if(all(p<hi)&&all(p+vec3<i32>(i32(B))>lo)){
   let slot=atomicAdd(&count[0],1u);
   if(slot>=CAP){atomicStore(&count[3],1u);return;}
   newMap[id]=slot;ids[slot]=id;return;
  }
 }
}
@compute @workgroup_size(64) fn update(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let slot=group.x;${sparse?'if(slot>=CAP){return;}let id=ids[slot];':'let id=slot;'}
 let origin=xyz(id,Q)*B;
 for(var local=lane;local<CELLS;local+=64u){let p=origin+xyz(local,B);
 dst[${sparse?'slot*CELLS+local':'linear(p,N)'}]=material(vec3<i32>(p));}
}
`;
}
