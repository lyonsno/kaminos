import {SOIL_MATERIAL_WGSL} from './soil-material.mjs';
// Quadratic 27-node APIC transfers follow the pinned Splash MLS implementation
// (vendor/splash-mls-mpm). SI mass/volume, frictional stress and reciprocal rigid
// impulses are specimen-specific. Grid entries hold momentum, then velocity.
export const VOLUME_KERNELS=SOIL_MATERIAL_WGSL+`
struct Particle { p:vec4f, v:vec4f, C:mat3x3f, stress:mat3x3f, meta:vec4f }
struct Cell { x:atomic<i32>, y:atomic<i32>, z:atomic<i32>, mass:atomic<i32> }
struct Body { p:vec4f,q:vec4f,v:vec4f,w:vec4f,i0:vec4f,i1:vec4f,i2:vec4f,shape:vec4u,size:vec4f,rest:vec4f }
struct Triangle { a:vec4f,b:vec4f,c:vec4f }
struct Reaction { x:atomic<i32>,y:atomic<i32>,z:atomic<i32>,tx:atomic<i32>,ty:atomic<i32>,tz:atomic<i32>,pad0:i32,pad1:i32 }
struct Params { origin:vec4f, dims:vec4u, material:vec4f, forces:vec4f, action:vec4f, impulse:vec4f, drive:vec4f }
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read_write> cells:array<Cell>;
@group(0) @binding(2) var<storage,read_write> bodies:array<Body>;
@group(0) @binding(3) var<storage,read> planes:array<vec4f>;
@group(0) @binding(4) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(5) var<storage,read_write> reactions:array<Reaction>;
@group(0) @binding(6) var<uniform> cfg:Params;
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
 let torque=cross(r,impulse);atomicAdd(&reactions[i].x,encode(impulse.x));atomicAdd(&reactions[i].y,encode(impulse.y));atomicAdd(&reactions[i].z,encode(impulse.z));
 atomicAdd(&reactions[i].tx,encode(torque.x));atomicAdd(&reactions[i].ty,encode(torque.y));atomicAdd(&reactions[i].tz,encode(torque.z));
}
fn contact_velocity(point:vec3f,velocity:vec3f,mass:f32,margin:f32)->vec3f{
 var v=velocity;
 for(var i=0u;i<arrayLength(&bodies);i++){
  let b=bodies[i];let r=point-b.p.xyz;if(length(r)>b.size.x+margin){continue;}
  let f=solid_frame(point,b);let bv=b.v.xyz+cross(b.w.xyz,r);let rel=v-bv;let vn=dot(rel,f.xyz);
  if(f.w>margin+max(0.,-vn)*cfg.forces.x||vn>=0.){continue;}
  let effective=1./mass+b.p.w+select(0.,dot(f.xyz,cross(inverse_inertia(b,cross(r,f.xyz)),r)),b.p.w>0.);
  let jn=-vn/max(effective,1e-12);var impulse=f.xyz*jn;
  let tangent=rel-vn*f.xyz;let speed=length(tangent);
  if(speed>1e-8){let t=tangent/speed;let kt=1./mass+b.p.w+select(0.,dot(t,cross(inverse_inertia(b,cross(r,t)),r)),b.p.w>0.);impulse-=t*min(cfg.forces.z*jn,speed/max(kt,1e-12));}
  v+=impulse/mass;react(i,-impulse,r);
 }
 return v;
}
@compute @workgroup_size(64) fn p2g(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&particles)){return;}let p=particles[id.x];let X=(p.p.xyz-cfg.origin.xyz)/cfg.origin.w;
 let base=vec3i(floor(X-.5));let f=X-vec3f(base)-vec3f(1.);let W=weights(f);let h=cfg.origin.w;
 let stress=p.stress-mat3x3f(p.meta.x,0.,0.,0.,p.meta.x,0.,0.,0.,p.meta.x);
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
 if(cfg.action.w>0.){let d=distance(point,cfg.action.xyz);v+=cfg.impulse.xyz*max(0.,1.-d/cfg.action.w);}
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
 let s=soil_stress(p.meta.x,p.stress,C,cfg.forces.x,cfg.material.x,cfg.material.y,cfg.material.z);p.meta.x=s.pressure;p.stress=s.deviator;p.C=C;
 p.v=vec4f(v,p.v.w);p.p=vec4f(p.p.xyz+v*cfg.forces.x,p.p.w);
 // Particle correction closes the residual between grid contact and subcell
 // advection; its velocity impulse is also returned to the rigid body.
 let corrected=contact_velocity(p.p.xyz,p.v.xyz,p.p.w,0.);p.v=vec4f(corrected,p.v.w);
 for(var i=0u;i<arrayLength(&bodies);i++){let b=bodies[i];if(distance(p.p.xyz,b.p.xyz)>b.size.x){continue;}let f=solid_frame(p.p.xyz,b);if(f.w<0.){p.p=vec4f(p.p.xyz-f.xyz*f.w,p.p.w);}}
 let influence=exp(-dot(p.p.xz,p.p.xz)/.75);let floor=cfg.drive.x*influence;
 if(p.p.y<floor){p.p.y=floor;p.v.y=max(cfg.drive.y*influence,p.v.y);}
 let low=cfg.origin.xyz+vec3f(h*1.1);let high=cfg.origin.xyz+(vec3f(cfg.dims.xyz)-vec3f(2.1))*h;
 for(var k=0u;k<3u;k++){if(p.p[k]<low[k]){p.p[k]=low[k];p.v[k]=max(0.,p.v[k]);}if(p.p[k]>high[k]){p.p[k]=high[k];p.v[k]=min(0.,p.v[k]);}}
 // Retained local compaction/work memory is state, independent of pigment.
 p.meta.y+=cfg.forces.x*max(0.,-(C[0].x+C[1].y+C[2].z));particles[id.x]=p;
}
@compute @workgroup_size(1) fn rigid(){
 for(var i=0u;i<arrayLength(&bodies);i++){
  var b=bodies[i];let J=vec3f(f32(atomicLoad(&reactions[i].x)),f32(atomicLoad(&reactions[i].y)),f32(atomicLoad(&reactions[i].z)))/FP;
  let T=vec3f(f32(atomicLoad(&reactions[i].tx)),f32(atomicLoad(&reactions[i].ty)),f32(atomicLoad(&reactions[i].tz)))/FP;
  if(b.p.w==0.){
   let influence=exp(-dot(b.rest.xz,b.rest.xz)/.75);b.p.y=b.rest.y+cfg.drive.x*influence;b.v.y=cfg.drive.y*influence;bodies[i]=b;continue;
  }
  let dt=cfg.forces.x;b.v=vec4f(b.v.xyz+J*b.p.w+vec3f(0.,-cfg.forces.y*dt,0.),0.);
  // Euler's equation includes gyroscopic torque for anisotropic rock inertia.
  let invI=mat3x3f(b.i0.xyz,b.i1.xyz,b.i2.xyz);let wl=invrot(b.q,b.w.xyz);
  let det=dot(invI[0],cross(invI[1],invI[2]));let I=transpose(mat3x3f(cross(invI[1],invI[2]),cross(invI[2],invI[0]),cross(invI[0],invI[1])))*(1./det);
  b.w=vec4f(b.w.xyz+inverse_inertia(b,T)-rot(b.q,invI*cross(wl,I*wl))*dt,0.);
  b.p=vec4f(b.p.xyz+b.v.xyz*dt,b.p.w);let q=b.q;b.q=normalize(q+vec4f(cross(b.w.xyz,q.xyz)+q.w*b.w.xyz,-dot(b.w.xyz,q.xyz))*(dt*.5));
  // Known convex fixture: vertex/face contact against anchored source solids.
  // This does not claim general edge/edge or free-body pile contact.
  for(var pass=0u;pass<3u;pass++){
   var deepest=0.;var normal=vec3f(0,1,0);var arm=vec3f(0.);
   for(var j=0u;j<b.shape.w;j++){let tri=triangles[b.shape.z+j];let verts=array<vec3f,3>(tri.a.xyz,tri.b.xyz,tri.c.xyz);
    for(var k=0u;k<3u;k++){let r=rot(b.q,verts[k]);let point=b.p.xyz+r;
     if(-point.y>deepest){deepest=-point.y;normal=vec3f(0,1,0);arm=r;}
     for(var other=0u;other<arrayLength(&bodies);other++){if(other==i||bodies[other].p.w>0.){continue;}let o=bodies[other];if(distance(point,o.p.xyz)>o.size.x){continue;}let f=solid_frame(point,o);if(-f.w>deepest){deepest=-f.w;normal=f.xyz;arm=r;}}
    }
   }
   if(deepest<=0.){break;}b.p=vec4f(b.p.xyz+normal*deepest,b.p.w);let rel=b.v.xyz+cross(b.w.xyz,arm);let vn=dot(rel,normal);
   if(vn<0.){let jn=-vn/(b.p.w+dot(normal,cross(inverse_inertia(b,cross(arm,normal)),arm)));var imp=normal*jn;let tang=rel-normal*vn;let speed=length(tang);
    if(speed>1e-8){let t=tang/speed;let kt=b.p.w+dot(t,cross(inverse_inertia(b,cross(arm,t)),arm));imp-=t*min(cfg.forces.z*jn,speed/max(kt,1e-12));}
    b.v=vec4f(b.v.xyz+imp*b.p.w,0.);b.w=vec4f(b.w.xyz+inverse_inertia(b,cross(arm,imp)),0.);
   }
  }bodies[i]=b;
 }
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
