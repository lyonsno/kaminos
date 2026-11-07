// OBB SAT and incident-face clipping, using the same quaternion/support
// conventions as lib/fracture/rigid-engine.js. This is finite box contact,
// not an infinite plane or an enclosing assembly box.
export const BURN_RIGID_CONTACT_WGSL=`
fn rigidRotate(q:vec4f,v:vec3f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn rigidConjugate(q:vec4f)->vec4f{return vec4f(-q.xyz,q.w);}
fn rigidMultiply(a:vec4f,b:vec4f)->vec4f{return vec4f(a.w*b.xyz+b.w*a.xyz+cross(a.xyz,b.xyz),a.w*b.w-dot(a.xyz,b.xyz));}
fn rigidRotation(q:vec4f)->mat3x3f{return mat3x3f(rigidRotate(q,vec3f(1,0,0)),rigidRotate(q,vec3f(0,1,0)),rigidRotate(q,vec3f(0,0,1)));}
fn rigidOuter(a:vec3f,b:vec3f)->mat3x3f{return mat3x3f(a*b.x,a*b.y,a*b.z);}
fn rigidIdentity()->mat3x3f{return mat3x3f(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1));}
fn rigidInverse(a:mat3x3f)->mat3x3f{
 let c0=cross(a[1],a[2]);let c1=cross(a[2],a[0]);let c2=cross(a[0],a[1]);let d=dot(a[0],c0);
 if(d<=0.0){return mat3x3f(vec3f(0),vec3f(0),vec3f(0));}
 return transpose(mat3x3f(c0/d,c1/d,c2/d));
}
fn rigidBoxInertia(q:vec4f,half:vec3f,mass:f32)->mat3x3f{
 let d=mass/3.0*vec3f(dot(half.yz,half.yz),dot(half.xz,half.xz),dot(half.xy,half.xy));let r=rigidRotation(q);
 return mat3x3f(r[0]*d.x,r[1]*d.y,r[2]*d.z)*transpose(r);
}
fn rigidIncrement(w:vec3f,dt:f32)->vec4f{
 let angle=length(w)*dt;if(angle<1e-8){return normalize(vec4f(w*dt*.5,1));}
 return vec4f(w/length(w)*sin(angle*.5),cos(angle*.5));
}
struct RigidBox {center:vec4f,rotation:vec4f,half:vec4f}
struct RigidManifold {points:array<vec4f,8>,normal:vec3f,count:u32}
fn rigidRadius(axes:mat3x3f,half:vec3f,n:vec3f)->f32{return abs(dot(axes[0],n))*half.x+abs(dot(axes[1],n))*half.y+abs(dot(axes[2],n))*half.z;}
fn rigidSupport(box:RigidBox,n:vec3f)->vec3f{
 let d=rigidRotate(rigidConjugate(box.rotation),n);return box.center.xyz+rigidRotate(box.rotation,select(vec3f(-1),vec3f(1),d>=vec3f(0))*box.half.xyz);
}
fn rigidSegmentClosest(a:vec3f,b:vec3f,c:vec3f,d:vec3f)->vec3f{
 let u=b-a;let v=d-c;let w=a-c;let aa=dot(u,u);let bb=dot(u,v);let cc=dot(v,v);let dd=dot(u,w);let ee=dot(v,w);
 let denom=aa*cc-bb*bb;var s=0.0;if(denom>1e-20){s=clamp((bb*ee-cc*dd)/denom,0.0,1.0);}
 var t=clamp((bb*s+ee)/max(cc,1e-30),0.0,1.0);s=clamp((bb*t-dd)/max(aa,1e-30),0.0,1.0);t=clamp((bb*s+ee)/max(cc,1e-30),0.0,1.0);
 return (a+s*u+c+t*v)*.5;
}
fn rigidManifold(a:RigidBox,b:RigidBox,margin:f32)->RigidManifold{
 var out:RigidManifold;out.count=0u;let ra=rigidRotation(a.rotation);let rb=rigidRotation(b.rotation);let delta=a.center.xyz-b.center.xyz;
 var best=-1e30;var normal=vec3f(0);var feature=0u;
 for(var k=0u;k<15u;k++){
  var n=vec3f(0);if(k<3u){n=ra[k];}else if(k<6u){n=rb[k-3u];}else{n=cross(ra[(k-6u)/3u],rb[(k-6u)%3u]);}
  let len=length(n);if(len<1e-6){continue;}n/=len;
  let gap=abs(dot(delta,n))-rigidRadius(ra,a.half.xyz,n)-rigidRadius(rb,b.half.xyz,n);
  if(gap>margin){return out;}if(gap>best+1e-6){best=gap;normal=select(-n,n,dot(delta,n)>=0.0);feature=k;}
 }
 out.normal=normal;
 if(feature>=6u){
  let ia=(feature-6u)/3u;let ib=(feature-6u)%3u;var ca=rigidSupport(a,-normal);var cb=rigidSupport(b,normal);
  ca-=ra[ia]*dot(ca-a.center.xyz,ra[ia]);cb-=rb[ib]*dot(cb-b.center.xyz,rb[ib]);
  out.points[0]=vec4f(rigidSegmentClosest(ca-ra[ia]*a.half[ia],ca+ra[ia]*a.half[ia],cb-rb[ib]*b.half[ib],cb+rb[ib]*b.half[ib]),best);out.count=1u;return out;
 }
 // Clip the incident rectangle against the four side planes of the reference
 // face. The intersection of two rectangles has at most eight vertices.
 var reference=b;var incident=a;var refAxis=feature-3u;var refNormal=normal;
 if(feature<3u){reference=a;incident=b;refAxis=feature;refNormal=-normal;}
 let rr=rigidRotation(reference.rotation);let ri=rigidRotation(incident.rotation);
 var incAxis=0u;var aligned=abs(dot(ri[0],refNormal));
 for(var k=1u;k<3u;k++){if(abs(dot(ri[k],refNormal))>aligned){aligned=abs(dot(ri[k],refNormal));incAxis=k;}}
 let incNormal=select(ri[incAxis],-ri[incAxis],dot(ri[incAxis],refNormal)>0.0);
 let faceCenter=incident.center.xyz+incNormal*incident.half[incAxis];let u=ri[(incAxis+1u)%3u]*incident.half[(incAxis+1u)%3u];let v=ri[(incAxis+2u)%3u]*incident.half[(incAxis+2u)%3u];
 var poly:array<vec3f,8>;poly[0]=faceCenter-u-v;poly[1]=faceCenter+u-v;poly[2]=faceCenter+u+v;poly[3]=faceCenter-u+v;var count=4u;
 for(var side=0u;side<4u;side++){
  let axis=(refAxis+1u+side/2u)%3u;let n=rr[axis]*select(-1.0,1.0,side%2u==1u);let plane=dot(reference.center.xyz,n)+reference.half[axis];
  var clipped:array<vec3f,8>;var used=0u;
  for(var k=0u;k<count;k++){
   let x=poly[k];let y=poly[(k+1u)%count];let dx=dot(x,n)-plane;let dy=dot(y,n)-plane;
   if(dx<=0.0){clipped[used]=x;used++;}if((dx<0.0&&dy>0.0)||(dx>0.0&&dy<0.0)){clipped[used]=mix(x,y,dx/(dx-dy));used++;}
  }
  poly=clipped;count=used;if(count==0u){return out;}
 }
 let plane=dot(reference.center.xyz,refNormal)+reference.half[refAxis];
 for(var k=0u;k<count;k++){let gap=dot(poly[k],refNormal)-plane;if(gap<=margin){out.points[out.count]=vec4f(poly[k]-refNormal*gap*.5,gap);out.count++;}}
 return out;
}
`;
