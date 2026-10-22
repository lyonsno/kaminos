// Same StVK + log-volume energy and PSD local Hessian as elastic.mjs. A colour
// contains no vertices sharing an element. One workgroup owns this small body;
// barriers separate colours, not host-side dispatches or CPU solver sweeps.
export function volumeKernel({nodes,colourCount}){return `
const N:u32=${nodes}u;
struct Params { material:vec4<f32>, solve:vec4<f32>, sphere:vec4<f32>, flags:vec4<f32> }
@group(0) @binding(0) var<storage,read_write> state:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> targets:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> refs:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> tets:array<vec4<u32>>;
@group(0) @binding(4) var<storage,read> graph:array<u32>;
@group(0) @binding(5) var<uniform> p:Params;
var<workgroup> x:array<vec4<f32>,${nodes}>;
var<workgroup> before:array<vec4<f32>,${nodes}>;
var<workgroup> predicted:array<vec4<f32>,${nodes}>;
var<workgroup> invalid:atomic<u32>;
var<workgroup> bad:u32;
var<workgroup> fraction:f32;
fn rotate(q:vec4<f32>,v:vec3<f32>)->vec3<f32>{let t=2.0*cross(q.yzw,v);return v+q.x*t+cross(q.yzw,t);}
fn outer(a:vec3<f32>,b:vec3<f32>)->mat3x3<f32>{return mat3x3<f32>(a*b.x,a*b.y,a*b.z);}
fn eye(a:f32)->mat3x3<f32>{return mat3x3<f32>(vec3<f32>(a,0,0),vec3<f32>(0,a,0),vec3<f32>(0,0,a));}
fn inv(a:mat3x3<f32>)->mat3x3<f32>{return transpose(mat3x3<f32>(cross(a[1],a[2]),cross(a[2],a[0]),cross(a[0],a[1])))*(1.0/determinant(a));}
fn refInv(e:u32)->mat3x3<f32>{return mat3x3<f32>(refs[e*4u].xyz,refs[e*4u+1u].xyz,refs[e*4u+2u].xyz);}
fn point(i:u32,vertex:u32,trial:vec3<f32>)->vec3<f32>{if(i==vertex){return targets[i*2u].xyz+trial;}return targets[i*2u].xyz+x[i].xyz;}
fn deformation(e:u32,vertex:u32,trial:vec3<f32>)->mat3x3<f32>{
 let ids=tets[e];let a=point(ids.x,vertex,trial);
 return mat3x3<f32>(point(ids.y,vertex,trial)-a,point(ids.z,vertex,trial)-a,point(ids.w,vertex,trial)-a)*refInv(e);
}
struct Value { energy:f32, gradient:vec3<f32>, h:mat3x3<f32> }
fn value(i:u32,trial:vec3<f32>,hessian:bool)->Value{
 let dt=p.material.x;let m=targets[i*2u].w/(dt*dt);let d=trial-predicted[i].xyz;
 var out=Value(m*dot(d,d)*0.5,m*d,eye(m));
 let start=graph[i*4u];let count=graph[i*4u+1u];let mu=p.material.z;let lambda=p.material.w;let bulk=p.solve.x;
 for(var k=0u;k<count;k++){
  let entry=N*4u+(start+k)*2u;let e=graph[entry];let local=graph[entry+1u];
  let F=deformation(e,i,trial);let J=determinant(F);
  if(!(J>0.0)){out.energy=3.4e38;return out;}
  let c0=F[0];let c1=F[1];let c2=F[2];
  let strain=vec3<f32>((dot(c0,c0)-1.0)*0.5,(dot(c1,c1)-1.0)*0.5,(dot(c2,c2)-1.0)*0.5);
  let shear=vec3<f32>(dot(c0,c1),dot(c0,c2),dot(c1,c2));
  let stress=2.0*mu*strain+vec3<f32>(lambda*(strain.x+strain.y+strain.z));let ss=mu*shear;
  let S=mat3x3<f32>(vec3<f32>(stress.x,ss.x,ss.y),vec3<f32>(ss.x,stress.y,ss.z),vec3<f32>(ss.y,ss.z,stress.z));
  let volume=refs[e*4u+3u].x;
  out.energy+=volume*(0.5*(dot(strain,stress)+dot(shear,ss))+bulk*(J-1.0-log(J)));
  if(hessian){
   let rows=transpose(refInv(e));var g=-(rows[0]+rows[1]+rows[2]);if(local>0u){g=rows[local-1u];}
   let cof=mat3x3<f32>(cross(c1,c2),cross(c2,c0),cross(c0,c1));let q=cof*g;
   out.gradient+=volume*(F*S*g+bulk*(1.0-1.0/J)*q);
   let a0=c0*g.x;let a1=c1*g.y;let a2=c2*g.z;let a3=c1*g.x+c0*g.y;let a4=c2*g.x+c0*g.z;let a5=c2*g.y+c1*g.z;let sum=a0+a1+a2;
   out.h+=volume*(lambda*outer(sum,sum)+2.0*mu*(outer(a0,a0)+outer(a1,a1)+outer(a2,a2))+mu*(outer(a3,a3)+outer(a4,a4)+outer(a5,a5))+(bulk/(J*J))*outer(q,q)+eye(max(0.0,dot(g,S*g))));
  }
 }
 if(p.sphere.w>0.0){
  let q=targets[i*2u].xyz+trial-p.sphere.xyz;let r=length(q);let depth=r-p.sphere.w;
  if(depth<0.0){var normal=vec3<f32>(1,0,0);if(r>1e-12){normal=q/r;}out.energy+=p.solve.y*depth*depth*0.5;if(hessian){out.gradient+=p.solve.y*depth*normal;out.h+=p.solve.y*outer(normal,normal);}}
 }
 return out;
}
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) lane:u32){
 for(var i=lane;i<N;i+=64u){
  let q=targets[i*2u+1u];var offset=rotate(q,state[i].xyz);var velocity=rotate(q,state[N+i].xyz);
  if(p.flags.x==0.0||p.flags.y!=0.0||graph[i*4u+3u]!=0u){offset=vec3<f32>(0);velocity=vec3<f32>(0);}
  x[i]=vec4<f32>(offset,0);before[i]=x[i];predicted[i]=vec4<f32>(offset+p.material.x*p.material.y*velocity,0);
 }
 if(lane==0u){fraction=1.0;}workgroupBarrier();
 // Transport is checked, never allowed to silently invert the next metric.
 // If necessary, retract the residual (and velocity) towards zero; the exact
 // retained fraction is exported as a diagnostic, not disguised as elasticity.
 loop{
  if(lane==0u){atomicStore(&invalid,0u);}workgroupBarrier();
  for(var e=lane;e<arrayLength(&tets);e+=64u){if(!(determinant(deformation(e,N,vec3<f32>(0)))>0.0)){atomicStore(&invalid,1u);}}
  workgroupBarrier();if(lane==0u){bad=atomicLoad(&invalid);}if(workgroupUniformLoad(&bad)==0u){break;}
  if(lane==0u){fraction*=0.5;}workgroupBarrier();
  for(var i=lane;i<N;i+=64u){x[i]=before[i]*fraction;}workgroupBarrier();
 }
 for(var i=lane;i<N;i+=64u){before[i]=x[i];predicted[i]*=fraction;}workgroupBarrier();
 if(p.flags.x!=0.0){
  for(var iteration=0u;iteration<u32(p.solve.z);iteration++){
   for(var colour=0u;colour<${colourCount}u;colour++){
    for(var i=lane;i<N;i+=64u){
     if(graph[i*4u+2u]!=colour||graph[i*4u+3u]!=0u){continue;}
     let v=value(i,x[i].xyz,true);let delta=-(inv(v.h)*v.gradient);var alpha=1.0;
     for(var attempt=0u;attempt<u32(p.solve.w);attempt++){
      let candidate=x[i].xyz+alpha*delta;let after=value(i,candidate,false).energy;
      if(after<=v.energy){x[i]=vec4<f32>(candidate,0);break;}alpha*=0.5;
     }
    }
    workgroupBarrier();
   }
  }
 }
 for(var i=lane;i<N;i+=64u){state[i]=x[i];state[N+i]=vec4<f32>((x[i].xyz-before[i].xyz)/p.material.x,0);}
 if(lane==0u){state[N*2u]=vec4<f32>(fraction,state[N*2u].y+1.0,0,0);}
}`;}
