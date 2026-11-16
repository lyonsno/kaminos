// Damage-gradient partition/contact follows TwoFieldMPM (MIT, adjacent license).
// penn-graphics-research/TwoFieldMPM@79e4a15c3a3bcc2e30a0de2590c70c03a7e5c67c
import {THERMAL_STONE_WGSL} from './material-law.mjs';
export const THERMAL_MPM_WGSL=THERMAL_STONE_WGSL+`
struct Particle {
 x:vec4f, v:vec4f, f0:vec4f, f1:vec4f, f2:vec4f,
 c0:vec4f, c1:vec4f, c2:vec4f, history:vec4f, rest:vec4f, grad:vec4f
}
struct Node {v:vec4f, damage:vec4f, normal:vec4f, phase:vec4f}
struct Choice {norm:atomic<u32>, seed:atomic<u32>}
struct Params {dims:vec4u, time:vec4f, heat:vec4f, fracture:vec4f, motion:vec4f, init:vec4f}
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read_write> acc:array<atomic<i32>>;
@group(0) @binding(2) var<storage,read_write> nodes:array<Node>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var<storage,read_write> choices:array<Choice>;
@group(0) @binding(5) var<storage,read_write> cg:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> matrixAcc:array<atomic<i32>>;
@group(0) @binding(7) var<storage,read_write> gradients:array<vec4f>;
@group(0) @binding(8) var<storage,read_write> partials:array<vec4f>;
@group(0) @binding(9) var<storage,read_write> control:array<vec4f>;
@group(0) @binding(10) var<storage,read_write> thermalDelta:array<f32>;
@group(0) @binding(11) var<storage,read_write> heads:array<atomic<u32>>;
@group(0) @binding(12) var<storage,read_write> next:array<u32>;
@group(0) @binding(13) var<storage,read_write> diagnostics:array<atomic<u32>>;
const FP:f32=1048576.;
fn nodeId(p:vec3i)->u32 {return u32((p.z*i32(params.dims.x)+p.y)*i32(params.dims.x)+p.x);}
fn inside(p:vec3i)->bool {return all(p>=vec3i(0))&&all(p<vec3i(i32(params.dims.x)));}
fn positionOfNode(i:u32)->vec3i {let n=params.dims.x;return vec3i(i32(i%n),i32((i/n)%n),i32(i/(n*n)));}
fn particleF(p:Particle)->mat3x3f{return mat3x3f(p.f0.xyz,p.f1.xyz,p.f2.xyz);}
fn particleC(p:Particle)->mat3x3f{return mat3x3f(p.c0.xyz,p.c1.xyz,p.c2.xyz);}
@compute @workgroup_size(128) fn initialize(@builtin(global_invocation_id) id:vec3u) {
 let i=id.x;if(i>=params.dims.z){return;}
 let n=params.dims.y;let v=vec3f(f32(i%n),f32((i/n)%n),f32(i/(n*n)));
 let center=3.+f32(n)*.25;let rest=vec3f(3.25)+v*.5;
 let stretch=1.+params.init.x;
 let x=vec3f(center)+(rest-vec3f(center))*stretch;
 let split=params.init.y>0.;
 let intact=select(1.,0.,split&&abs(rest.x-center)<.76);
 let velocity=select(vec3f(0),vec3f(select(-params.init.z,params.init.z,rest.x>=center),0,0),split);
 let strength=1.+params.fracture.w*sin(rest.x*1.71)*sin(rest.y*2.13)*sin(rest.z*1.37);
 particles[i]=Particle(vec4f(x,.125),vec4f(velocity,1.),
  vec4f(stretch,0,0,0),vec4f(0,stretch,0,0),vec4f(0,0,stretch,0),
  vec4f(0),vec4f(0),vec4f(0),vec4f(intact,0,.125,strength),vec4f(rest,1),vec4f(0));
}

fn weights(f:vec3f,o:vec3i)->vec3f {
 var r=vec3f(0);for(var k=0;k<3;k++){let a=f[k];if(o[k]==0){r[k]=.5*(1.5-a)*(1.5-a);}else if(o[k]==1){r[k]=.75-(a-1.)*(a-1.);}else{r[k]=.5*(a-.5)*(a-.5);}}return r;
}
fn weight(f:vec3f,o:vec3i)->f32 {let w=weights(f,o);return w.x*w.y*w.z;}
fn derivative(f:vec3f,o:vec3i)->vec3f {
 let w=weights(f,o);var d=vec3f(0);for(var k=0;k<3;k++){if(o[k]==0){d[k]=f[k]-1.5;}else if(o[k]==1){d[k]=-2.*(f[k]-1.);}else{d[k]=f[k]-.5;}}
 return vec3f(d.x*w.y*w.z,w.x*d.y*w.z,w.x*w.y*d.z);
}
fn outer(a:vec3f,b:vec3f)->mat3x3f{return mat3x3f(a*b.x,a*b.y,a*b.z);}
fn validF(F:mat3x3f)->bool {let j=determinant(F);return j>0.&&j<3.4e38;}
fn broken()->bool{return atomicLoad(&diagnostics[0])+atomicLoad(&diagnostics[1])+atomicLoad(&diagnostics[2])>0u;}
fn arithmeticFault(kind:u32){atomicAdd(&diagnostics[2],1u);atomicAdd(&diagnostics[kind],1u);}
fn checkedAtomic(cell:ptr<storage,atomic<i32>,read_write>,v:f32) {
 if(!(abs(v)<=bitcast<f32>(0x7f7fffffu))){arithmeticFault(3u);return;}
 if(!(abs(v)<2047.)){arithmeticFault(5u);return;}
 let amount=i32(round(v*FP));let old=atomicAdd(cell,amount);
 if((amount>0&&old>2147483647-amount)||(amount<0&&old<(-2147483647-1)-amount)){arithmeticFault(5u);}
}
// Phase coefficients grow with tensile history / toughness. Accumulate their
// f32 bit patterns with CAS instead of imposing the transfer's fixed-point range.
fn phaseAdd(cell:ptr<storage,atomic<i32>,read_write>,v:f32) {
 let largest=bitcast<f32>(0x7f7fffffu);
 if(!(abs(v)<=largest)){arithmeticFault(3u);return;}
 var old=atomicLoad(cell);
 loop {
  let current=bitcast<f32>(old);
  if(!(abs(current)<=largest)){arithmeticFault(3u);return;}
  let sum=current+v;
  if(!(abs(sum)<=largest)){arithmeticFault(7u);return;}
  let result=atomicCompareExchangeWeak(cell,old,bitcast<i32>(sum));
  if(result.exchanged){break;}
  old=result.old_value;
 }
}
fn add(i:u32,v:f32){checkedAtomic(&acc[i],v);}
fn side(p:Particle,n:u32)->u32 {
 let seed=atomicLoad(&choices[n].seed);if(seed==0u){return 0u;}
 return select(1u,0u,dot(p.grad.xyz,particles[params.dims.z-seed].grad.xyz)>=0.);
}
fn fieldFor(p:Particle,n:u32)->u32 {if(nodes[n*2u].normal.w>.5){return n*2u+side(p,n);}return n*2u;}
@compute @workgroup_size(128) fn binParticles(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z||broken()){return;}let p=particles[i];let base=vec3i(floor(p.x.xyz-.5));
 if(!inside(base)||!inside(base+vec3i(2))){atomicAdd(&diagnostics[1],1u);return;}
 let h=nodeId(vec3i(floor(p.x.xyz)));next[i]=atomicExchange(&heads[h],i+1u);
}
@compute @workgroup_size(128) fn damageGradients(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z||broken()){return;}let p=particles[i];let cell=vec3i(floor(p.x.xyz));
 var S=1.;var D=1.-p.history.x;var dS=vec3f(0);var dD=vec3f(0);
 for(var z=-2;z<=2;z++){for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let c=cell+vec3i(x,y,z);if(!inside(c)){continue;}var link=atomicLoad(&heads[nodeId(c)]);
  while(link>0u){let j=link-1u;link=next[j];if(j==i){continue;}let q=particles[j];let delta=p.x.xyz-q.x.xyz;let dist=length(delta);let r=dist/1.5;
   if(dist>0.&&r<1.){let w=1.-3.*r*r+2.*r*r*r;let dw=6.*(r*r-r)*delta/(1.5*dist);S+=w;D+=w*(1.-q.history.x);dS+=dw;dD+=dw*(1.-q.history.x);}
  }
 }}}
 let g=(dD*S-D*dS)/(S*S);particles[i].grad=vec4f(g,0);
 let base=vec3i(floor(p.x.xyz-.5));let magnitude=bitcast<u32>(dot(g,g));
 for(var z=0;z<3;z++){for(var y=0;y<3;y++){for(var x=0;x<3;x++){atomicMax(&choices[nodeId(base+vec3i(x,y,z))].norm,magnitude);}}}
}
@compute @workgroup_size(128) fn gradientSeeds(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z||broken()){return;}let p=particles[i];let base=vec3i(floor(p.x.xyz-.5));
 let magnitude=bitcast<u32>(dot(p.grad.xyz,p.grad.xyz));if(magnitude==0u){return;}
 for(var z=0;z<3;z++){for(var y=0;y<3;y++){for(var x=0;x<3;x++){let n=nodeId(base+vec3i(x,y,z));if(atomicLoad(&choices[n].norm)==magnitude){atomicMax(&choices[n].seed,params.dims.z-i);}}}}
}
@compute @workgroup_size(128) fn deposit(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z||broken()){return;}var p=particles[i];let F=particleF(p);let Fe=stoneElasticF(F,p.v.w,params.time.w);
 if(!validF(Fe)){atomicAdd(&diagnostics[0],1u);return;}
 p.history.y=stoneHistory(p.history.y,stonePositiveEnergy(Fe,params.time.y,params.time.z));particles[i].history=p.history;
 let stress=stoneStress(Fe,p.history.x,params.fracture.z,params.time.y,params.time.z);
 let volume=p.history.z*determinant(F);
 let beta=4.*params.fracture.x*(1.-params.fracture.z)/(params.fracture.y*p.history.w);
 let base=vec3i(floor(p.x.xyz-.5));let f=p.x.xyz-vec3f(base);let C=particleC(p);
 for(var z=0;z<3;z++){for(var y=0;y<3;y++){for(var x=0;x<3;x++){
  let o=vec3i(x,y,z);let n=nodeId(base+o);let j=(n*2u+side(p,n))*16u;let w=weight(f,o);let dw=derivative(f,o);let d=vec3f(base+o)-p.x.xyz;
  let m=p.x.w*w;let momentum=m*(p.v.xyz+C*d)-params.time.x*p.history.z*(stress*dw);
  add(j,m);add(j+1u,momentum.x);add(j+2u,momentum.y);add(j+3u,momentum.z);
  add(j+5u,m*(1.-p.history.x));atomicMax(&acc[j+7u],bitcast<i32>(1.-p.history.x));
  add(j+8u,p.x.w*dw.x);add(j+9u,p.x.w*dw.y);add(j+10u,p.x.w*dw.z);
  phaseAdd(&acc[j+11u],volume*w*(1.+beta*p.history.y));phaseAdd(&acc[j+12u],volume*w);phaseAdd(&acc[j+13u],volume*w*p.history.x);
 }}}
}
fn value(i:u32)->f32{return f32(atomicLoad(&acc[i]))/FP;}
fn nodeFrom(j:u32)->Node {
 let a=j*16u;let m=value(a);var n=Node(vec4f(0),vec4f(0),vec4f(0),vec4f(0));
 if(m<=0.){return n;}n.v=vec4f(value(a+1u),value(a+2u),value(a+3u),m);
 n.damage=vec4f(0,0,value(a+5u),bitcast<f32>(atomicLoad(&acc[a+7u])));
 n.normal=vec4f(value(a+8u),value(a+9u),value(a+10u),0);
 n.phase=vec4f(bitcast<f32>(atomicLoad(&acc[a+11u])),bitcast<f32>(atomicLoad(&acc[a+12u])),bitcast<f32>(atomicLoad(&acc[a+13u])),0);return n;
}
@compute @workgroup_size(128) fn reconcile(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.x*params.dims.x*params.dims.x||broken()){return;}
 var a=nodeFrom(i*2u);var b=nodeFrom(i*2u+1u);
 let separate=a.v.w>0.&&b.v.w>0.&&max(a.damage.w,b.damage.w)>=params.motion.w&&min(a.damage.z/a.v.w,b.damage.z/b.v.w)>.03;
 if(!separate){a.v+=b.v;a.damage.z+=b.damage.z;a.phase+=b.phase;a.normal+=b.normal;b=Node(vec4f(0),vec4f(0),vec4f(0),vec4f(0));}
 if(a.v.w>0.){a.v=vec4f(a.v.xyz/a.v.w,a.v.w);a.phase.z/=max(a.phase.y,1e-20);}
 if(b.v.w>0.){b.v=vec4f(b.v.xyz/b.v.w,b.v.w);b.phase.z/=max(b.phase.y,1e-20);}
 if(separate){
  var n=a.normal.xyz/max(length(a.normal.xyz),1e-20)-b.normal.xyz/max(length(b.normal.xyz),1e-20);
  n/=max(length(n),1e-20);let relative=b.v.xyz-a.v.xyz;let reduced=a.v.w*b.v.w/(a.v.w+b.v.w);
  let impulse=max(0.,-dot(relative,n))*reduced;let tangent=relative-dot(relative,n)*n;
  let friction=min(params.motion.z*impulse,reduced*length(tangent))*tangent/max(length(tangent),1e-20);
  let J=impulse*n-friction;a.v=vec4f(a.v.xyz-J/a.v.w,a.v.w);b.v=vec4f(b.v.xyz+J/b.v.w,b.v.w);
  a.normal.w=1.;b.normal.w=1.;atomicAdd(&diagnostics[4],1u);
 }
 let pos=positionOfNode(i);
 for(var k=0;k<2;k++){
  var n=a;if(k==1){n=b;}
  if(n.v.w>0.){
   n.v.y-=params.time.x*params.motion.x;n.v=vec4f(n.v.xyz*exp(-params.motion.y*params.time.x),n.v.w);
   if(params.heat.w>.5&&pos.y<=3){n.v=vec4f(0,0,0,n.v.w);}
   for(var axis=0;axis<3;axis++){if((pos[axis]<2&&n.v[axis]<0.)||(pos[axis]>=i32(params.dims.x)-2&&n.v[axis]>0.)){n.v[axis]=0.;}}
  }else{n.phase=vec4f(1,0,1,0);}
  nodes[i*2u+u32(k)]=n;
 }
}
// Diffusion on the persistent reference material lattice (spacing .5).
// Reference thermal connectivity is retained after mechanical separation.
@compute @workgroup_size(128) fn heatStep(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z||broken()){return;}let n=params.dims.y;
 let coordinates=vec3i(i32(i%n),i32((i/n)%n),i32(i/(n*n)));let strides=vec3u(1u,n,n*n);
 let T=particles[i].v.w;var rate=0.;
 for(var axis=0;axis<3;axis++){
  if(coordinates[axis]>0){rate+=4.*params.heat.x*(particles[i-strides[axis]].v.w-T);}
  if(coordinates[axis]<i32(n)-1){rate+=4.*params.heat.x*(particles[i+strides[axis]].v.w-T);}
 }
 if(coordinates.y==i32(n)-1){rate+=params.heat.y*(params.heat.z-T);}
 let delta=params.time.x*rate;let nextT=T+delta;
 if(!(nextT>=-.000001&&nextT<=1.000001)){atomicAdd(&diagnostics[2],1u);return;}
 thermalDelta[i]=delta;
}
@compute @workgroup_size(128) fn updateStrength(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z){return;}let r=particles[i].rest.xyz;
 particles[i].history.w=1.+params.fracture.w*sin(r.x*1.71)*sin(r.y*2.13)*sin(r.z*1.37);
}
@compute @workgroup_size(128) fn phaseSeed(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=arrayLength(&cg)){return;}let c=nodes[i].phase.z;cg[i]=vec4f(c,0,c,0);
}
@compute @workgroup_size(128) fn matrixGather(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z||broken()){return;}let p=particles[i];let base=vec3i(floor(p.x.xyz-.5));let f=p.x.xyz-vec3f(base);var g=vec3f(0);
 for(var z=0;z<3;z++){for(var y=0;y<3;y++){for(var x=0;x<3;x++){let o=vec3i(x,y,z);g+=derivative(f,o)*cg[fieldFor(p,nodeId(base+o))].z;}}}
 gradients[i]=vec4f(g*(4.*params.fracture.x*params.fracture.x*p.history.z*determinant(particleF(p))),0);
}
@compute @workgroup_size(128) fn matrixScatter(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z||broken()){return;}let p=particles[i];let base=vec3i(floor(p.x.xyz-.5));let f=p.x.xyz-vec3f(base);
 for(var z=0;z<3;z++){for(var y=0;y<3;y++){for(var x=0;x<3;x++){
  let o=vec3i(x,y,z);let v=dot(gradients[i].xyz,derivative(f,o));
  phaseAdd(&matrixAcc[fieldFor(p,nodeId(base+o))],v);
 }}}
}
@compute @workgroup_size(128) fn matrixFinish(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=arrayLength(&cg)){return;}cg[i].w=nodes[i].phase.x*cg[i].z+bitcast<f32>(atomicLoad(&matrixAcc[i]));
}
@compute @workgroup_size(128) fn phaseStart(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=arrayLength(&cg)){return;}let r=nodes[i].phase.y-cg[i].w;cg[i]=vec4f(cg[i].x,r,r/max(nodes[i].phase.x,1e-20),0);
}
var<workgroup> sums:array<vec4f,128>;
@compute @workgroup_size(128) fn dotPA(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u){
 let i=gid.x;var v=vec4f(0);if(i<arrayLength(&cg)){let s=cg[i];v=vec4f(s.y*s.y/max(nodes[i].phase.x,1e-20),s.z*s.w,0,0);}
 sums[lid.x]=v;workgroupBarrier();for(var stride=64u;stride>0u;stride/=2u){if(lid.x<stride){sums[lid.x]+=sums[lid.x+stride];}workgroupBarrier();}if(lid.x==0u){partials[group.x]=sums[0];}
}
@compute @workgroup_size(128) fn reducePA(@builtin(local_invocation_id) lid:vec3u){
 var v=vec4f(0);for(var i=lid.x;i<arrayLength(&partials);i+=128u){v+=partials[i];}
 sums[lid.x]=v;workgroupBarrier();for(var stride=64u;stride>0u;stride/=2u){if(lid.x<stride){sums[lid.x]+=sums[lid.x+stride];}workgroupBarrier();}if(lid.x==0u){control[0]=sums[0];}
}
@compute @workgroup_size(128) fn phaseUpdate(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=arrayLength(&cg)){return;}var alpha=0.;if(control[0].x>1e-14&&control[0].y>1e-14){alpha=control[0].x/control[0].y;}
 cg[i].x+=alpha*cg[i].z;cg[i].y-=alpha*cg[i].w;
}
@compute @workgroup_size(128) fn dotR(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u){
 let i=gid.x;var v=vec4f(0);if(i<arrayLength(&cg)){v.x=cg[i].y*cg[i].y/max(nodes[i].phase.x,1e-20);}
 sums[lid.x]=v;workgroupBarrier();for(var stride=64u;stride>0u;stride/=2u){if(lid.x<stride){sums[lid.x]+=sums[lid.x+stride];}workgroupBarrier();}if(lid.x==0u){partials[group.x]=sums[0];}
}
@compute @workgroup_size(128) fn reduceR(@builtin(local_invocation_id) lid:vec3u){
 var v=0.;for(var i=lid.x;i<arrayLength(&partials);i+=128u){v+=partials[i].x;}
 sums[lid.x]=vec4f(v,0,0,0);workgroupBarrier();for(var stride=64u;stride>0u;stride/=2u){if(lid.x<stride){sums[lid.x]+=sums[lid.x+stride];}workgroupBarrier();}if(lid.x==0u){control[0].z=sums[0].x;}
}
@compute @workgroup_size(128) fn phaseDirection(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=arrayLength(&cg)){return;}let beta=control[0].z/max(control[0].x,1e-30);cg[i].z=cg[i].y/max(nodes[i].phase.x,1e-20)+beta*cg[i].z;
}
@compute @workgroup_size(128) fn gather(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=params.dims.z||broken()){return;}var p=particles[i];let base=vec3i(floor(p.x.xyz-.5));let f=p.x.xyz-vec3f(base);
 var velocity=vec3f(0);var C=mat3x3f(vec3f(0),vec3f(0),vec3f(0));var L=C;let heat=thermalDelta[i];var intact=0.;
 for(var z=0;z<3;z++){for(var y=0;y<3;y++){for(var x=0;x<3;x++){
  let o=vec3i(x,y,z);let j=fieldFor(p,nodeId(base+o));let n=nodes[j];let w=weight(f,o);let dw=derivative(f,o);
  velocity+=w*n.v.xyz;C+=4.*w*outer(n.v.xyz,vec3f(base+o)-p.x.xyz);L+=outer(n.v.xyz,dw);intact+=w*cg[j].x;
 }}}
 let F=(stoneIdentity()+params.time.x*L)*particleF(p);let x=p.x.xyz+params.time.x*velocity;
 if(!validF(F)){atomicAdd(&diagnostics[0],1u);return;}
 let newBase=vec3i(floor(x-.5));if(!inside(newBase)||!inside(newBase+vec3i(2))){atomicAdd(&diagnostics[1],1u);return;}
 if(!(all(abs(velocity)<vec3f(3.4e38))&&abs(p.v.w+heat)<3.4e38)){atomicAdd(&diagnostics[2],1u);return;}
 p.x=vec4f(x,p.x.w);p.v=vec4f(velocity,p.v.w+heat);p.f0=vec4f(F[0],0);p.f1=vec4f(F[1],0);p.f2=vec4f(F[2],0);
 p.c0=vec4f(C[0],0);p.c1=vec4f(C[1],0);p.c2=vec4f(C[2],0);
 if(params.init.w>.5){p.history.x=stoneIntact(p.history.x,intact);}particles[i]=p;
}
@compute @workgroup_size(128) fn finishStep(@builtin(global_invocation_id) gid:vec3u){
 if(gid.x!=0u||broken()){return;}atomicAdd(&diagnostics[6],1u);control[1].x+=params.time.x;
}
`;
