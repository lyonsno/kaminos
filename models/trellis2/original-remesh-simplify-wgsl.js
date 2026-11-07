// Adapted from CuMesh/mtlmesh simplify.metal (MIT, vendor/original-remesh).
// The face-gather propagation is the native fallback for targets without
// uint64 atomics. Store its lexicographic (cost-bits, edge-id) as two u32s.
// Selection and mutation are separate dispatches: no stale propagated reads.
export const CUMESH_SIMPLIFY_WGSL=/*wgsl*/`
struct Params {
  V:u32, F:u32, E:u32, start:u32,
  faceOffsets:u32, faceIds:u32, edgeOffsets:u32, edgeIds:u32,
  boundary:u32, threshold:f32, lambdaLength:f32, lambdaSkinny:f32,
};
struct Qem { e:array<f32,10> };
@group(0) @binding(0) var<storage,read_write> vertices:array<f32>;
@group(0) @binding(1) var<storage,read_write> faces:array<u32>;
@group(0) @binding(2) var<storage,read> edges:array<vec2<u32>>;
@group(0) @binding(3) var<storage,read> topo:array<u32>;
@group(0) @binding(4) var<storage,read_write> qems:array<Qem>;
@group(0) @binding(5) var<storage,read_write> costs:array<u32>;
@group(0) @binding(6) var<storage,read_write> propagated:array<vec2<u32>>;
@group(0) @binding(7) var<storage,read_write> flags:array<u32>;
@group(0) @binding(8) var<uniform> p:Params;
fn point(i:u32)->vec3<f32>{return vec3<f32>(vertices[i*3u],vertices[i*3u+1u],vertices[i*3u+2u]);}
fn face(i:u32)->vec3<u32>{return vec3<u32>(faces[i*3u],faces[i*3u+1u],faces[i*3u+2u]);}
fn norm2(v:vec3<f32>)->f32{return (v.x*v.x+v.y*v.y)+v.z*v.z;}
fn scalarDot(a:vec3<f32>,b:vec3<f32>)->f32{return (a.x*b.x+a.y*b.y)+a.z*b.z;}
fn perpendicular(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{return vec3<f32>(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
fn candidate(e:vec2<u32>)->vec3<f32>{
  let b0=topo[p.boundary+e.x]!=0u;let b1=topo[p.boundary+e.y]!=0u;
  var w=0.5;if(b0&&!b1){w=1.0;}else if(!b0&&b1){w=0.0;}
  return point(e.x)*w+point(e.y)*(1.0-w);
}
@compute @workgroup_size(64) fn get_qem(@builtin(global_invocation_id) id:vec3<u32>){
  let v=p.start+id.x;if(v>=p.V){return;}var q:Qem;
  for(var i=topo[p.faceOffsets+v];i<topo[p.faceOffsets+v+1u];i++){
    let f=face(topo[p.faceIds+i]);let a=point(f.x);
    var n=perpendicular(point(f.y)-a,point(f.z)-a);n*=inverseSqrt(norm2(n));
    let d=-scalarDot(n,a);
    let plane=array<f32,10>(n.x*n.x,n.x*n.y,n.x*n.z,n.x*d,n.y*n.y,n.y*n.z,n.y*d,n.z*n.z,n.z*d,d*d);
    for(var k=0u;k<10u;k++){q.e[k]+=plane[k];}
  }qems[v]=q;
}
// Returns (skinny penalty, count, flipped). Shared faces are removed later.
fn incident(fid:u32,keep:u32,other:u32,v:vec3<f32>)->vec3<f32>{
  let f=face(fid);if(any(f==vec3<u32>(other))){return vec3<f32>(0.0);}
  let a=point(f.x);let b=point(f.y);let c=point(f.z);
  let na=select(a,v,f.x==keep);let nb=select(b,v,f.y==keep);let nc=select(c,v,f.z==keep);
  let old=perpendicular(b-a,c-a);let e1=nb-na;let e2=nc-na;let normal=perpendicular(e1,e2);
  if(scalarDot(old,normal)<0.0){return vec3<f32>(0.0,0.0,1.0);}
  let area=0.5*sqrt(norm2(normal));let e0=nc-nb;
  let denom=max(1e-12,(norm2(e0)+norm2(e1))+norm2(e2));
  let shape=4.0*sqrt(3.0)*area/denom;
  return vec3<f32>(1.0-clamp(shape,0.0,1.0),1.0,0.0);
}
@compute @workgroup_size(64) fn edge_cost(@builtin(global_invocation_id) id:vec3<u32>){
  let ei=p.start+id.x;if(ei>=p.E){return;}let e=edges[ei];let v=candidate(e);
  var q:Qem;for(var k=0u;k<10u;k++){q.e[k]=qems[e.x].e[k]+qems[e.y].e[k];}
  let x=v.x;let y=v.y;let z=v.z;
  var cost=q.e[0]*x*x+2.0*q.e[1]*x*y+2.0*q.e[2]*x*z+2.0*q.e[3]*x
    +q.e[4]*y*y+2.0*q.e[5]*y*z+2.0*q.e[6]*y+q.e[7]*z*z+2.0*q.e[8]*z+q.e[9];
  let length2=norm2(point(e.y)-point(e.x));cost+=p.lambdaLength*length2;
  var skinny=0.0;var count=0.0;
  for(var k=0u;k<2u;k++){
    let keep=e[k];let other=e[1u-k];
    for(var i=topo[p.faceOffsets+keep];i<topo[p.faceOffsets+keep+1u];i++){
      let r=incident(topo[p.faceIds+i],keep,other,v);
      if(r.z!=0.0){costs[ei]=0x7f800000u;return;}skinny+=r.x;count+=r.y;
    }
  }
  if(count>0.0){skinny/=count;}costs[ei]=bitcast<u32>(cost+p.lambdaSkinny*skinny*length2);
}
fn key(e:u32)->vec2<u32>{return vec2<u32>(costs[e],e);}
fn less(a:vec2<u32>,b:vec2<u32>)->bool{return a.x<b.x||(a.x==b.x&&a.y<b.y);}
@compute @workgroup_size(64) fn propagate(@builtin(global_invocation_id) id:vec3<u32>){
  let fi=p.start+id.x;if(fi>=p.F){return;}let f=face(fi);var best=vec2<u32>(0xffffffffu);
  for(var k=0u;k<3u;k++){
    let v=f[k];for(var i=topo[p.edgeOffsets+v];i<topo[p.edgeOffsets+v+1u];i++){
      let next=key(topo[p.edgeIds+i]);if(less(next,best)){best=next;}
    }
  }propagated[fi]=best;
}
@compute @workgroup_size(64) fn select_edges(@builtin(global_invocation_id) id:vec3<u32>){
  let ei=p.start+id.x;if(ei>=p.E){return;}if(bitcast<f32>(costs[ei])>p.threshold){return;}
  let e=edges[ei];let pack=key(ei);
  for(var k=0u;k<2u;k++){
    let v=e[k];for(var i=topo[p.faceOffsets+v];i<topo[p.faceOffsets+v+1u];i++){
      if(any(propagated[topo[p.faceIds+i]]!=pack)){return;}
    }
  }flags[p.V+p.F+ei]=1u;
}
@compute @workgroup_size(64) fn collapse(@builtin(global_invocation_id) id:vec3<u32>){
  let ei=p.start+id.x;if(ei>=p.E){return;}if(flags[p.V+p.F+ei]==0u){return;}
  let e=edges[ei];let v=candidate(e);
  vertices[e.x*3u]=v.x;vertices[e.x*3u+1u]=v.y;vertices[e.x*3u+2u]=v.z;flags[e.y]=0u;
  for(var i=topo[p.faceOffsets+e.x];i<topo[p.faceOffsets+e.x+1u];i++){
    let fid=topo[p.faceIds+i];if(any(face(fid)==vec3<u32>(e.y))){flags[p.V+fid]=0u;}
  }
  for(var i=topo[p.faceOffsets+e.y];i<topo[p.faceOffsets+e.y+1u];i++){
    let fid=topo[p.faceIds+i];let f=face(fid);
    if(f.x==e.y){faces[fid*3u]=e.x;}else if(f.y==e.y){faces[fid*3u+1u]=e.x;}else if(f.z==e.y){faces[fid*3u+2u]=e.x;}
  }
}
`;
