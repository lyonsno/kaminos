import {SOIL_MATERIAL_WGSL} from './soil-material.mjs';
// Quadratic 27-node APIC transfers follow the pinned Splash MLS implementation
// (vendor/splash-mls-mpm). SI mass/volume, frictional stress and reciprocal rigid
// impulses are specimen-specific. Grid entries hold momentum, then velocity.
export const VOLUME_KERNELS=SOIL_MATERIAL_WGSL+`
struct Particle { p:vec4f, v:vec4f, C:mat3x3f, stress:mat3x3f, memory:vec4f }
struct Cell { x:atomic<i32>, y:atomic<i32>, z:atomic<i32>, mass:atomic<i32> }
struct Body { p:vec4f,q:vec4f,v:vec4f,w:vec4f,i0:vec4f,i1:vec4f,i2:vec4f,shape:vec4u,size:vec4f,rest:vec4f }
struct Triangle { a:vec4f,b:vec4f,c:vec4f }

struct Params { origin:vec4f, dims:vec4u, material:vec4f, forces:vec4f, action:vec4f, impulse:vec4f, drive:vec4f }
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read_write> cells:array<Cell>;
@group(0) @binding(2) var<storage,read_write> bodies:array<Body>;
@group(0) @binding(3) var<storage,read> planes:array<vec4f>;
@group(0) @binding(4) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(5) var<storage,read_write> reactions:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> cfg:Params;
@group(0) @binding(7) var<storage,read> convexData:array<vec4f>;
struct SpatialParams { origin:vec4f, dims:vec4u }
@group(1) @binding(0) var<storage,read_write> bodyHeads:array<atomic<u32>>;
@group(1) @binding(1) var<storage,read_write> bodyLinks:array<u32>;
@group(1) @binding(2) var<uniform> spatial:SpatialParams;
@group(1) @binding(3) var<storage,read_write> bodyDegrees:array<u32>;
@group(1) @binding(4) var<storage,read_write> worldFeatures:array<vec4f>;
@group(1) @binding(5) var<storage,read_write> nextBodies:array<Body>;
@group(1) @binding(6) var<storage,read> featureOwners:array<u32>;
fn bucket(p:vec3f)->vec3i{return clamp(vec3i(floor((p-spatial.origin.xyz)/spatial.origin.w)),vec3i(0),vec3i(spatial.dims.xyz)-vec3i(1));}
fn bucket_index(p:vec3i)->u32{return u32((p.x*i32(spatial.dims.y)+p.y)*i32(spatial.dims.z)+p.z);}
fn reaction_add(index:u32,value:f32){
 var old=atomicLoad(&reactions[index]);
 loop{let result=atomicCompareExchangeWeak(&reactions[index],old,bitcast<u32>(bitcast<f32>(old)+value));if(result.exchanged){break;}old=result.old_value;}
}
@compute @workgroup_size(64) fn build_body_grid(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&bodies)){return;}bodyLinks[id.x]=atomicExchange(&bodyHeads[bucket_index(bucket(bodies[id.x].p.xyz))],id.x+1u);
}
@compute @workgroup_size(64) fn transform_features(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&convexData)){return;}let b=bodies[featureOwners[id.x]];var p=rot(b.q,convexData[id.x].xyz);if(id.x<u32(b.i0.w+b.i1.w)){p+=b.p.xyz;}worldFeatures[id.x]=vec4f(p,0.);
}
@compute @workgroup_size(64) fn contact_degrees(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&bodies)){return;}let b=bodies[id.x];var count=0u;
 if(b.p.w>0.){let extent=b.size.x+spatial.origin.w*.5;let lo=bucket(b.p.xyz-vec3f(extent));let hi=bucket(b.p.xyz+vec3f(extent));
 for(var x=lo.x;x<=hi.x;x++){for(var y=lo.y;y<=hi.y;y++){for(var z=lo.z;z<=hi.z;z++){
 var link=atomicLoad(&bodyHeads[bucket_index(vec3i(x,y,z))]);while(link>0u){let j=link-1u;link=bodyLinks[j];if(j!=id.x&&distance(b.p.xyz,bodies[j].p.xyz)<b.size.x+bodies[j].size.x){count++;}}
 }}}}bodyDegrees[id.x]=max(1u,count);
}
const FP:f32=1048576.;
fn encode(v:f32)->i32{return i32(round(v*FP));}
fn rot(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn invrot(q:vec4f,v:vec3f)->vec3f{return rot(vec4f(-q.xyz,q.w),v);}
fn inverse_inertia(b:Body,v:vec3f)->vec3f{return rot(b.q,mat3x3f(b.i0.xyz,b.i1.xyz,b.i2.xyz)*invrot(b.q,v));}
fn node_index(p:vec3i)->u32{return u32((p.x*i32(cfg.dims.y)+p.y)*i32(cfg.dims.z)+p.z);}
fn node_position(i:u32)->vec3f{return cfg.origin.xyz+vec3f(f32(i/(cfg.dims.y*cfg.dims.z)),f32((i/cfg.dims.z)%cfg.dims.y),f32(i%cfg.dims.z))*cfg.origin.w;}
fn valid(p:vec3i)->bool{return all(p>=vec3i(0))&&all(p<vec3i(cfg.dims.xyz));}
fn weights(d:vec3f)->mat3x3f{return mat3x3f(.5*(.5-d)*(.5-d),.75-d*d,.5*(.5+d)*(.5+d));}
fn closest_triangle(p:vec3f,t:Triangle)->vec3f{
 let a=t.a.xyz;let b=t.b.xyz;let c=t.c.xyz;let ab=b-a;let ac=c-a;let ap=p-a;let d1=dot(ab,ap);let d2=dot(ac,ap);
 if(d1<=0.&&d2<=0.){return a;}let bp=p-b;let d3=dot(ab,bp);let d4=dot(ac,bp);if(d3>=0.&&d4<=d3){return b;}
 let vc=d1*d4-d3*d2;if(vc<=0.&&d1>=0.&&d3<=0.){return a+ab*(d1/(d1-d3));}
 let cp=p-c;let d5=dot(ab,cp);let d6=dot(ac,cp);if(d6>=0.&&d5<=d6){return c;}
 let vb=d5*d2-d1*d6;if(vb<=0.&&d2>=0.&&d6<=0.){return a+ac*(d2/(d2-d6));}
 let va=d3*d6-d5*d4;if(va<=0.&&(d4-d3)>=0.&&(d5-d6)>=0.){return b+(c-b)*((d4-d3)/((d4-d3)+(d5-d6)));}
 let inv=1./(va+vb+vc);return a+ab*(vb*inv)+ac*(vc*inv);
}
fn solid_frame(world:vec3f,b:Body)->vec4f{
 let p=invrot(b.q,world-b.p.xyz);var d=-1e30;var n=vec3f(0,1,0);
 for(var j=0u;j<b.shape.y;j++){let pl=planes[b.shape.x+j];let q=dot(pl.xyz,p)-pl.w;if(q>d){d=q;n=pl.xyz;}}
 if(d<=0.){return vec4f(rot(b.q,n),d);}
 // Outside a corner, plane distance alone is not the finite-surface distance.
 var distance=1e30;var delta=vec3f(0,1,0);
 for(var j=0u;j<b.shape.w;j++){let q=p-closest_triangle(p,triangles[b.shape.z+j]);let q2=dot(q,q);if(q2<distance){distance=q2;delta=q;}}
 return vec4f(rot(b.q,normalize(delta)),sqrt(distance));
}
fn react(i:u32,impulse:vec3f,r:vec3f){
 let torque=cross(r,impulse);reaction_add(i*8u,impulse.x);reaction_add(i*8u+1u,impulse.y);reaction_add(i*8u+2u,impulse.z);
 reaction_add(i*8u+3u,torque.x);reaction_add(i*8u+4u,torque.y);reaction_add(i*8u+5u,torque.z);
}
fn contact_velocity(point:vec3f,velocity:vec3f,mass:f32,margin:f32)->vec3f{
 var v=velocity;
 let extent=spatial.origin.w*.5+margin;let lo=bucket(point-vec3f(extent));let hi=bucket(point+vec3f(extent));
 for(var x=lo.x;x<=hi.x;x++){for(var y=lo.y;y<=hi.y;y++){for(var z=lo.z;z<=hi.z;z++){
 var link=atomicLoad(&bodyHeads[bucket_index(vec3i(x,y,z))]);while(link>0u){let i=link-1u;link=bodyLinks[i];
  let b=bodies[i];let r=point-b.p.xyz;if(length(r)>b.size.x+margin){continue;}
  let f=solid_frame(point,b);let bv=b.v.xyz+cross(b.w.xyz,r);let rel=v-bv;let vn=dot(rel,f.xyz);
  if(f.w>margin+max(0.,-vn)*cfg.forces.x||vn>=0.){continue;}
  let effective=1./mass+b.p.w+select(0.,dot(f.xyz,cross(inverse_inertia(b,cross(r,f.xyz)),r)),b.p.w>0.);
  let jn=-vn/max(effective,1e-12);var impulse=f.xyz*jn;
  let tangent=rel-vn*f.xyz;let speed=length(tangent);
  if(speed>1e-8){let t=tangent/speed;let kt=1./mass+b.p.w+select(0.,dot(t,cross(inverse_inertia(b,cross(r,t)),r)),b.p.w>0.);impulse-=t*min(cfg.forces.z*jn,speed/max(kt,1e-12));}
  v+=impulse/mass;react(i,-impulse,r);
 }}}}
 return v;
}
@compute @workgroup_size(64) fn p2g(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&particles)){return;}let p=particles[id.x];let X=(p.p.xyz-cfg.origin.xyz)/cfg.origin.w;
 let base=vec3i(floor(X-.5));let f=X-vec3f(base)-vec3f(1.);let W=weights(f);let h=cfg.origin.w;
 let stress=p.stress-mat3x3f(p.memory.x,0.,0.,0.,p.memory.x,0.,0.,0.,p.memory.x);
 let affine=p.p.w*p.C-cfg.forces.x*p.v.w*4./(h*h)*stress;
 for(var x=0;x<3;x++){for(var y=0;y<3;y++){for(var z=0;z<3;z++){
  let node=base+vec3i(x,y,z);if(!valid(node)){continue;}let weight=W[x].x*W[y].y*W[z].z;
  let dist=(vec3f(node)-X)*h;let momentum=weight*(p.p.w*p.v.xyz+affine*dist);let i=node_index(node);
  atomicAdd(&cells[i].mass,encode(weight*p.p.w));atomicAdd(&cells[i].x,encode(momentum.x));atomicAdd(&cells[i].y,encode(momentum.y));atomicAdd(&cells[i].z,encode(momentum.z));
 }}}
}
@compute @workgroup_size(64) fn grid(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&cells)){return;}let mass=f32(atomicLoad(&cells[id.x].mass))/FP;if(mass<=0.){return;}
 let point=node_position(id.x);var v=vec3f(f32(atomicLoad(&cells[id.x].x)),f32(atomicLoad(&cells[id.x].y)),f32(atomicLoad(&cells[id.x].z)))/(FP*mass);
 v.y-=cfg.forces.y*cfg.forces.x;
 if(cfg.action.w>0.&&cfg.impulse.w<1.){let d=distance(point,cfg.action.xyz);v+=cfg.impulse.xyz*max(0.,1.-d/cfg.action.w);}
 // A prescribed growth boundary supplies displacement and its matching velocity.
 let r2=dot(point.xz,point.xz);let influence=exp(-r2/.75);let floor=cfg.drive.x*influence;
 if(point.y<floor+cfg.origin.w*.5&&v.y<cfg.drive.y*influence){v.y=cfg.drive.y*influence;}
 let high=cfg.origin.xyz+(vec3f(cfg.dims.xyz)-vec3f(2.))*cfg.origin.w;let low=cfg.origin.xyz+vec3f(cfg.origin.w);
 for(var k=0u;k<3u;k++){if(point[k]<low[k]&&v[k]<0.){v[k]=0.;}if(point[k]>high[k]&&v[k]>0.){v[k]=0.;}}
 v=contact_velocity(point,v,mass,cfg.origin.w*.18);
 atomicStore(&cells[id.x].x,encode(v.x));atomicStore(&cells[id.x].y,encode(v.y));atomicStore(&cells[id.x].z,encode(v.z));
}
@compute @workgroup_size(64) fn g2p(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&particles)){return;}var p=particles[id.x];let h=cfg.origin.w;let X=(p.p.xyz-cfg.origin.xyz)/h;
 let base=vec3i(floor(X-.5));let W=weights(X-vec3f(base)-vec3f(1.));var v=vec3f(0.);var C=mat3x3f(vec3f(0.),vec3f(0.),vec3f(0.));
 for(var x=0;x<3;x++){for(var y=0;y<3;y++){for(var z=0;z<3;z++){
  let node=base+vec3i(x,y,z);if(!valid(node)){continue;}let i=node_index(node);let weight=W[x].x*W[y].y*W[z].z;
  let nv=vec3f(f32(atomicLoad(&cells[i].x)),f32(atomicLoad(&cells[i].y)),f32(atomicLoad(&cells[i].z)))/FP;
  v+=weight*nv;let dist=(vec3f(node)-X)*h;C+=mat3x3f(nv*dist.x,nv*dist.y,nv*dist.z)*(4.*weight/(h*h));
 }}}
 let s=soil_stress(p.memory.x,p.stress,C,cfg.forces.x,cfg.material.x,cfg.material.y,cfg.material.z);p.memory.x=s.pressure;p.stress=s.deviator;p.C=C;
 p.v=vec4f(v,p.v.w);p.p=vec4f(p.p.xyz+v*cfg.forces.x,p.p.w);
 // Particle correction closes the residual between grid contact and subcell
 // advection; its velocity impulse is also returned to the rigid body.
 let corrected=contact_velocity(p.p.xyz,p.v.xyz,p.p.w,0.);p.v=vec4f(corrected,p.v.w);
 let extent=spatial.origin.w*.5;let loBody=bucket(p.p.xyz-vec3f(extent));let hiBody=bucket(p.p.xyz+vec3f(extent));
 for(var x=loBody.x;x<=hiBody.x;x++){for(var y=loBody.y;y<=hiBody.y;y++){for(var z=loBody.z;z<=hiBody.z;z++){
 var link=atomicLoad(&bodyHeads[bucket_index(vec3i(x,y,z))]);while(link>0u){let i=link-1u;link=bodyLinks[i];let b=bodies[i];if(distance(p.p.xyz,b.p.xyz)>b.size.x){continue;}let f=solid_frame(p.p.xyz,b);if(f.w<0.){p.p=vec4f(p.p.xyz-f.xyz*f.w,p.p.w);}}
 }}}
 let influence=exp(-dot(p.p.xz,p.p.xz)/.75);let floor=cfg.drive.x*influence;
 if(p.p.y<floor){p.p.y=floor;p.v.y=max(cfg.drive.y*influence,p.v.y);}
 let low=cfg.origin.xyz+vec3f(h*1.1);let high=cfg.origin.xyz+(vec3f(cfg.dims.xyz)-vec3f(2.1))*h;
 for(var k=0u;k<3u;k++){if(p.p[k]<low[k]){p.p[k]=low[k];p.v[k]=max(0.,p.v[k]);}if(p.p[k]>high[k]){p.p[k]=high[k];p.v[k]=min(0.,p.v[k]);}}
 // Retained local compaction/work memory is state, independent of pigment.
 p.memory.y+=cfg.forces.x*max(0.,-(C[0].x+C[1].y+C[2].z));particles[id.x]=p;
}
fn interval(b:Body,axis:vec3f)->vec2f{
 var lo=1e30;var hi=-1e30;
 for(var k=0u;k<u32(b.i1.w);k++){let p=worldFeatures[u32(b.i0.w)+k].xyz;let d=dot(p,axis);lo=min(lo,d);hi=max(hi,d);}return vec2f(lo,hi);
}
fn contact_axis(a:Body,b:Body,inputAxis:vec3f)->vec4f{
 let len=length(inputAxis);if(len<1e-7){return vec4f(0.,0.,0.,1e30);}let axis=inputAxis/len;let A=interval(a,axis);let B=interval(b,axis);let left=A.y-B.x;let right=B.y-A.x;
 if(left<=0.||right<=0.){return vec4f(0.,0.,0.,-1.);}return vec4f(select(axis,-axis,left<right),min(left,right));
}
fn convex_contact(a:Body,b:Body)->vec4f{
 var best=vec4f(0.,0.,0.,1e30);
 for(var k=0u;k<a.shape.y;k++){let c=contact_axis(a,b,rot(a.q,planes[a.shape.x+k].xyz));if(c.w<0.){return c;}if(c.w<best.w){best=c;}}
 for(var k=0u;k<b.shape.y;k++){let c=contact_axis(a,b,rot(b.q,planes[b.shape.x+k].xyz));if(c.w<0.){return c;}if(c.w<best.w){best=c;}}
 for(var i=0u;i<u32(a.size.w);i++){let edge=worldFeatures[u32(a.i2.w)+i].xyz;
  for(var j=0u;j<u32(b.size.w);j++){let axis=cross(edge,worldFeatures[u32(b.i2.w)+j].xyz);let c=contact_axis(a,b,axis);if(c.w<0.){return c;}if(c.w<best.w){best=c;}}
 }return best;
}
fn support_center(b:Body,n:vec3f)->vec3f{
 let lo=interval(b,n).x;var sum=vec3f(0.);var count=0.;
 for(var k=0u;k<u32(b.i1.w);k++){let p=worldFeatures[u32(b.i0.w)+k].xyz;if(dot(p,n)<lo+1e-5){sum+=p;count+=1.;}}return sum/max(count,1.);
}
fn contact_body(inputBody:Body,normal:vec3f,depth:f32,point:vec3f,supportVelocity:vec3f)->Body{
 var b=inputBody;let arm=point-b.p.xyz;b.p=vec4f(b.p.xyz+normal*depth,b.p.w);let rel=b.v.xyz+cross(b.w.xyz,arm)-supportVelocity;let vn=dot(rel,normal);
 if(vn<0.){let jn=-vn/(b.p.w+dot(normal,cross(inverse_inertia(b,cross(arm,normal)),arm)));var imp=normal*jn;let tang=rel-normal*vn;let speed=length(tang);
  if(speed>1e-8){let t=tang/speed;let kt=b.p.w+dot(t,cross(inverse_inertia(b,cross(arm,t)),arm));imp-=t*min(cfg.forces.z*jn,speed/max(kt,1e-12));}
  b.v=vec4f(b.v.xyz+imp*b.p.w,0.);b.w=vec4f(b.w.xyz+inverse_inertia(b,cross(arm,imp)),0.);
 }return b;
}
@compute @workgroup_size(1) fn kick(){
 if(cfg.impulse.w<1.){return;}let i=u32(cfg.impulse.w)-1u;if(i>=arrayLength(&bodies)||bodies[i].p.w==0.){return;}var b=bodies[i];b.v=vec4f(b.v.xyz+cfg.impulse.xyz,0.);if(cfg.action.w>0.){b.w=vec4f(b.w.xyz+inverse_inertia(b,cross(cfg.action.xyz-b.p.xyz,cfg.impulse.xyz/b.p.w)),0.);}bodies[i]=b;
}
@compute @workgroup_size(64) fn integrate_rigid(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&bodies)){return;}var b=bodies[i];
 let J=vec3f(bitcast<f32>(atomicLoad(&reactions[i*8u])),bitcast<f32>(atomicLoad(&reactions[i*8u+1u])),bitcast<f32>(atomicLoad(&reactions[i*8u+2u])));
 let T=vec3f(bitcast<f32>(atomicLoad(&reactions[i*8u+3u])),bitcast<f32>(atomicLoad(&reactions[i*8u+4u])),bitcast<f32>(atomicLoad(&reactions[i*8u+5u])));
 if(b.p.w==0.){let influence=exp(-dot(b.rest.xz,b.rest.xz)/.75);b.p.y=b.rest.y+cfg.drive.x*influence;b.v.y=cfg.drive.y*influence;bodies[i]=b;return;}
 let dt=cfg.forces.x;b.v=vec4f(b.v.xyz+J*b.p.w+vec3f(0.,-cfg.forces.y*dt,0.),0.);
 let invI=mat3x3f(b.i0.xyz,b.i1.xyz,b.i2.xyz);let wl=invrot(b.q,b.w.xyz);let det=dot(invI[0],cross(invI[1],invI[2]));
 let I=transpose(mat3x3f(cross(invI[1],invI[2]),cross(invI[2],invI[0]),cross(invI[0],invI[1])))*(1./det);
 b.w=vec4f(b.w.xyz+inverse_inertia(b,T)-rot(b.q,invI*cross(wl,I*wl))*dt,0.);
 b.p=vec4f(b.p.xyz+b.v.xyz*dt,b.p.w);let q=b.q;b.q=normalize(q+vec4f(cross(b.w.xyz,q.xyz)+q.w*b.w.xyz,-dot(b.w.xyz,q.xyz))*(dt*.5));bodies[i]=b;
}
fn responsive_inertia(b:Body,v:vec3f)->vec3f{if(b.p.w==0.){return vec3f(0.);}return inverse_inertia(b,v);}
fn pair_effective(a:Body,b:Body,ra:vec3f,rb:vec3f,n:vec3f)->f32{
 return a.p.w+b.p.w+dot(n,cross(responsive_inertia(a,cross(ra,n)),ra)+cross(responsive_inertia(b,cross(rb,n)),rb));
}
fn pair_impulse(a:Body,b:Body,n:vec3f,point:vec3f)->vec3f{
 let ra=point-a.p.xyz;let rb=point-b.p.xyz;let rel=a.v.xyz+cross(a.w.xyz,ra)-b.v.xyz-cross(b.w.xyz,rb);let vn=dot(rel,n);if(vn>=0.){return vec3f(0.);}
 let jn=-vn/max(pair_effective(a,b,ra,rb,n),1e-12);let normalImpulse=n*jn;
 let after=rel+normalImpulse*(a.p.w+b.p.w)+cross(responsive_inertia(a,cross(ra,normalImpulse)),ra)+cross(responsive_inertia(b,cross(rb,normalImpulse)),rb);
 let tangent=after-n*dot(after,n);let speed=length(tangent);var impulse=normalImpulse;
 if(speed>1e-8){let t=tangent/speed;impulse-=t*min(cfg.forces.z*jn,speed/max(pair_effective(a,b,ra,rb,t),1e-12));}return impulse;
}
@compute @workgroup_size(64) fn solve_rigid(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&bodies)){return;}let original=bodies[i];var body=original;if(body.p.w==0.){nextBodies[i]=body;return;}
 let extent=body.size.x+spatial.origin.w*.5;let lo=bucket(body.p.xyz-vec3f(extent));let hi=bucket(body.p.xyz+vec3f(extent));var dp=vec3f(0.);var dv=vec3f(0.);var dw=vec3f(0.);
 for(var x=lo.x;x<=hi.x;x++){for(var y=lo.y;y<=hi.y;y++){for(var z=lo.z;z<=hi.z;z++){
 var link=atomicLoad(&bodyHeads[bucket_index(vec3i(x,y,z))]);while(link>0u){let j=link-1u;link=bodyLinks[j];if(j==i){continue;}let other=bodies[j];if(distance(original.p.xyz,other.p.xyz)>original.size.x+other.size.x){continue;}
 // Canonical pair order gives both body threads the same normal/contact and
 // impulse; each writes only its own next pose, with equal/opposite impulses.
 let a=bodies[min(i,j)];let b=bodies[max(i,j)];let c=convex_contact(a,b);if(c.w<=0.||c.w>=1e29){continue;}
 let point=(support_center(a,c.xyz)+support_center(b,-c.xyz))*.5;let sign=select(-1.,1.,i<j);
 let degree=max(select(0u,bodyDegrees[min(i,j)],a.p.w>0.),select(0u,bodyDegrees[max(i,j)],b.p.w>0.));let weight=1./f32(max(1u,degree));
 let impulse=pair_impulse(a,b,c.xyz,point)*sign*weight;dv+=impulse*original.p.w;dw+=inverse_inertia(original,cross(point-original.p.xyz,impulse));dp+=c.xyz*(sign*c.w*original.p.w/(a.p.w+b.p.w)*weight);
 }}}}
 body.p=vec4f(original.p.xyz+dp,original.p.w);body.v=vec4f(original.v.xyz+dv,0.);body.w=vec4f(original.w.xyz+dw,0.);
 let bottom=support_center(original,vec3f(0,1,0))+dp;let influence=exp(-dot(bottom.xz,bottom.xz)/.75);let floor=cfg.drive.x*influence;
 if(bottom.y<floor){body=contact_body(body,vec3f(0,1,0),floor-bottom.y,bottom,vec3f(0.,cfg.drive.y*influence,0.));}nextBodies[i]=body;
}

`;

export const SURFACE_KERNELS=`
struct Cell { x:i32,y:i32,z:i32,mass:i32 }
struct Shape { p:vec4f,q:vec4f,v:vec4f,w:vec4f,i0:vec4f,i1:vec4f,i2:vec4f,shape:vec4u,size:vec4f,rest:vec4f }
@group(0) @binding(0) var<storage,read> cells:array<Cell>;
@group(0) @binding(1) var<storage,read_write> positions:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> normals:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> indirect:array<atomic<u32>>;
@group(0) @binding(4) var<uniform> origin:vec4f;
@group(0) @binding(5) var<uniform> shape:vec4u;
@group(0) @binding(6) var<uniform> material:vec4f;
fn index(p:vec3u)->u32{return (p.x*shape.y+p.y)*shape.z+p.z;}
fn field(p:vec3i)->f32{let q=vec3u(clamp(p,vec3i(0),vec3i(shape.xyz)-vec3i(1)));return f32(cells[index(q)].mass)/(1048576.*material.x*pow(origin.w,3.));}
fn gradient(p:vec3i)->vec3f{return -vec3f(field(p+vec3i(1,0,0))-field(p-vec3i(1,0,0)),field(p+vec3i(0,1,0))-field(p-vec3i(0,1,0)),field(p+vec3i(0,0,1))-field(p-vec3i(0,0,1)));}
struct Edge {p:vec3f,n:vec3f}
fn edge(a:vec3u,b:vec3u)->Edge{let va=field(vec3i(a));let vb=field(vec3i(b));let t=clamp((material.y-va)/(vb-va),0.,1.);let g=mix(gradient(vec3i(a)),gradient(vec3i(b)),t);return Edge(origin.xyz+mix(vec3f(a),vec3f(b),t)*origin.w,normalize(g+vec3f(0.,1e-10,0.)));}
fn triangle(a:Edge,b:Edge,c:Edge){let n=a.n+b.n+c.n;let flip=dot(cross(b.p-a.p,c.p-a.p),n)<0.;let B=select(b.p,c.p,flip);let C=select(c.p,b.p,flip);let bn=select(b.n,c.n,flip);let cn=select(c.n,b.n,flip);let start=atomicAdd(&indirect[0],3u);positions[start]=vec4f(a.p,1.);positions[start+1u]=vec4f(B,1.);positions[start+2u]=vec4f(C,1.);normals[start]=vec4f(a.n,0.);normals[start+1u]=vec4f(bn,0.);normals[start+2u]=vec4f(cn,0.);}
@compute @workgroup_size(64) fn surface(@builtin(global_invocation_id) id:vec3u){
 let dims=shape.xyz-vec3u(1);if(id.x>=dims.x*dims.y*dims.z){return;}let p=vec3u(id.x/(dims.y*dims.z),(id.x/dims.z)%dims.y,id.x%dims.z);
 let corners=array<vec3u,8>(p,p+vec3u(1,0,0),p+vec3u(1,1,0),p+vec3u(0,1,0),p+vec3u(0,0,1),p+vec3u(1,0,1),p+vec3u(1,1,1),p+vec3u(0,1,1));
 let tets=array<vec4u,6>(vec4u(0,1,2,6),vec4u(0,2,3,6),vec4u(0,3,7,6),vec4u(0,7,4,6),vec4u(0,4,5,6),vec4u(0,5,1,6));
 for(var k=0u;k<6u;k++){let tet=tets[k];var inside:array<u32,4>;var outside:array<u32,4>;var ni=0u;var no=0u;
  for(var j=0u;j<4u;j++){if(field(vec3i(corners[tet[j]]))>=material.y){inside[ni]=tet[j];ni++;}else{outside[no]=tet[j];no++;}}
  if(ni==1u){triangle(edge(corners[inside[0]],corners[outside[0]]),edge(corners[inside[0]],corners[outside[1]]),edge(corners[inside[0]],corners[outside[2]]));}
  if(ni==3u){triangle(edge(corners[outside[0]],corners[inside[0]]),edge(corners[outside[0]],corners[inside[1]]),edge(corners[outside[0]],corners[inside[2]]));}
  if(ni==2u){let a=edge(corners[inside[0]],corners[outside[0]]);let b=edge(corners[inside[0]],corners[outside[1]]);let c=edge(corners[inside[1]],corners[outside[0]]);let d=edge(corners[inside[1]],corners[outside[1]]);triangle(a,b,c);triangle(b,d,c);}
 }if(id.x==0u){atomicStore(&indirect[1],1u);}
}
@group(0) @binding(7) var<storage,read> bodies:array<Shape>;
@group(0) @binding(8) var<storage,read> localVertices:array<vec4f>;
@group(0) @binding(9) var<storage,read> vertexBodies:array<u32>;
fn rot(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@compute @workgroup_size(64) fn rock_surface(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&localVertices)){return;}let b=bodies[vertexBodies[id.x]];let j=(id.x/3u)*3u;
 let a=localVertices[j].xyz;let c=localVertices[j+1u].xyz;let d=localVertices[j+2u].xyz;
 positions[id.x]=vec4f(b.p.xyz+rot(b.q,localVertices[id.x].xyz),1.);normals[id.x]=vec4f(rot(b.q,normalize(cross(c-a,d-a))),0.);
}
`;

// Pointer queries use the current resident poses and source planes. Only this
// 32-byte hit record is acquired; no soil or rigid-state snapshot is needed.
export const ROCK_PICK_KERNEL=VOLUME_KERNELS+`
@group(0) @binding(8) var<uniform> ray:array<vec4f,2>;
@group(0) @binding(9) var<storage,read_write> hit:array<vec4f>;
@compute @workgroup_size(1) fn pick_rock(){
 var best=1e30;var index=0.;
 for(var i=0u;i<arrayLength(&bodies);i++){
  let b=bodies[i];let o=invrot(b.q,ray[0].xyz-b.p.xyz);let d=invrot(b.q,ray[1].xyz);var near=-1e30;var far=1e30;var miss=false;
  for(var j=0u;j<b.shape.y;j++){let p=planes[b.shape.x+j];let den=dot(p.xyz,d);let gap=p.w-dot(p.xyz,o);
   if(abs(den)<1e-8){if(gap<0.){miss=true;break;}}else{let t=gap/den;if(den<0.){near=max(near,t);}else{far=min(far,t);}}
  }
  let t=select(near,far,near<0.);if(!miss&&near<=far&&t>=0.&&t<best){best=t;index=f32(i+1u);}
 }
 hit[0]=vec4f(index,best,0.,0.);if(index>0.){hit[0].z=bodies[u32(index)-1u].p.w;}hit[1]=vec4f(ray[0].xyz+ray[1].xyz*select(0.,best,index>0.),0.);
}
`;
