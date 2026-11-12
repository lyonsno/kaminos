export const EARTH_GPU_MATH_WGSL=`
fn qmul(a:vec4f,b:vec4f)->vec4f{return vec4f(a.w*b.xyz+b.w*a.xyz+cross(a.xyz,b.xyz),a.w*b.w-dot(a.xyz,b.xyz));}
fn qrotate(q:vec4f,v:vec3f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn qconj(q:vec4f)->vec4f{return vec4f(-q.xyz,q.w);}
fn signedVolume(a:vec3f,b:vec3f,c:vec3f,d:vec3f)->f32{return dot(b-a,cross(c-a,d-a))/6.0;}
fn triBary(p:vec3f,a:vec3f,b:vec3f,c:vec3f)->vec3f{
 let ab=b-a;let ac=c-a;let ap=p-a;let d1=dot(ab,ap);let d2=dot(ac,ap);
 if(d1<=0.0&&d2<=0.0){return vec3f(1,0,0);}let bp=p-b;let d3=dot(ab,bp);let d4=dot(ac,bp);
 if(d3>=0.0&&d4<=d3){return vec3f(0,1,0);}let vc=d1*d4-d3*d2;
 if(vc<=0.0&&d1>=0.0&&d3<=0.0){let v=d1/max(d1-d3,1e-30);return vec3f(1.0-v,v,0);}
 let cp=p-c;let d5=dot(ab,cp);let d6=dot(ac,cp);if(d6>=0.0&&d5<=d6){return vec3f(0,0,1);}
 let vb=d5*d2-d1*d6;if(vb<=0.0&&d2>=0.0&&d6<=0.0){let w=d2/max(d2-d6,1e-30);return vec3f(1.0-w,0,w);}
 let va=d3*d6-d5*d4;if(va<=0.0&&(d4-d3)>=0.0&&(d5-d6)>=0.0){let w=(d4-d3)/max(d4-d3+d5-d6,1e-30);return vec3f(0,1.0-w,w);}
 let inv=1.0/max(va+vb+vc,1e-30);let v=vb*inv;let w=vc*inv;return vec3f(1.0-v-w,v,w);
}
`;
export const EARTH_GPU_WGSL=EARTH_GPU_MATH_WGSL+`
struct Body{p:vec4f,q:vec4f,v:vec4f,w:vec4f,shape:vec4f,inertia:vec4f}
struct Tet{ids:vec4u,law:vec4f,rest0:vec4f,rest1:vec4f,history:vec4u}
struct Delta{p:array<atomic<i32>,4>,r:array<atomic<i32>,4>}
struct Params{counts:vec4u,grid:vec4u,domain:vec4f,tool:vec4f,previousTool:vec4f,law:vec4f}
@group(0) @binding(0) var<storage,read_write> bodies:array<Body>;
@group(0) @binding(1) var<storage,read_write> before:array<Body>;
@group(0) @binding(2) var<storage,read_write> heads:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> next:array<u32>;
@group(0) @binding(4) var<storage,read_write> deltas:array<Delta>;
@group(0) @binding(5) var<storage,read_write> tets:array<Tet>;
@group(0) @binding(6) var<storage,read> faces:array<vec4u>;
@group(0) @binding(7) var<uniform> p:Params;
@group(0) @binding(8) var<storage,read> ties:array<vec4u>;
const END=0xffffffffu;
fn cellKey(c:vec3i)->u32{let q=vec3u(clamp(c,vec3i(0),vec3i(p.grid.xyz)-1));return(q.z*p.grid.y+q.y)*p.grid.x+q.x;}
fn cell(x:vec3f)->vec3i{return vec3i(floor((x+vec3f(p.domain.x*.5,0,p.domain.y*.5))/p.domain.z));}
fn invInertia(b:Body,v:vec3f)->vec3f{return qrotate(b.q,qrotate(qconj(b.q),v)*b.inertia.xyz);}
fn addDelta(i:u32,shift:vec3f,rotate:vec3f){for(var k=0u;k<3u;k++){atomicAdd(&deltas[i].p[k],i32(round(shift[k]/bodies[i].p.w*(262144.0/p.domain.x))));atomicAdd(&deltas[i].r[k],i32(round(rotate[k]*1048576.0)));}}
fn sphereArm(b:Body,lobe:u32)->vec3f{return qrotate(b.q,vec3f(select(b.shape.x,b.shape.y,lobe==1u),0,0));}
fn sphereRadius(b:Body,lobe:u32)->f32{return select(b.v.w,b.w.w,lobe==1u);}
fn contact(i:u32,j:u32,armI:vec3f,armJ:vec3f,n:vec3f,penetration:f32){
 let a=bodies[i];let b=bodies[j];let ga=cross(armI,n);let gb=cross(armJ,n);
 let wa=a.p.w+dot(ga,invInertia(a,ga));let wb=b.p.w+dot(gb,invInertia(b,gb));let lambda=penetration/max(wa+wb,1e-30)*.35;
 var correction=n*lambda;
 let relative=(a.p.xyz-before[i].p.xyz)-(b.p.xyz-before[j].p.xyz);let tangent=relative-n*dot(relative,n);let speed=length(tangent);
 if(speed>1e-12){correction-=tangent/speed*min(p.law.y*lambda,speed/max(wa+wb,1e-30)*.35);}
 addDelta(i,correction*a.p.w,invInertia(a,cross(armI,correction)));addDelta(j,-correction*b.p.w,-invInertia(b,cross(armJ,correction)));
}
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.x){return;}var b=bodies[i];before[i]=b;b.v.y-=p.law.x*p.domain.w;b.p=vec4f(b.p.xyz+b.v.xyz*p.domain.w,b.p.w);b.q=normalize(b.q+qmul(vec4f(b.w.xyz*p.domain.w*.5,0),b.q));bodies[i]=b;}
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i<arrayLength(&heads)){atomicStore(&heads[i],END);}if(i<p.counts.x){for(var k=0u;k<4u;k++){atomicStore(&deltas[i].p[k],0);atomicStore(&deltas[i].r[k],0);}}}
@compute @workgroup_size(64) fn index(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.y){return;}next[i]=atomicExchange(&heads[cellKey(cell(bodies[i].p.xyz))],i);}
@compute @workgroup_size(64) fn grainContacts(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.counts.y){return;}let a=bodies[i];let c=clamp(cell(a.p.xyz),vec3i(0),vec3i(p.grid.xyz)-1);
 for(var z=max(0,c.z-1);z<=min(i32(p.grid.z)-1,c.z+1);z++){for(var y=max(0,c.y-1);y<=min(i32(p.grid.y)-1,c.y+1);y++){for(var x=max(0,c.x-1);x<=min(i32(p.grid.x)-1,c.x+1);x++){
  var j=atomicLoad(&heads[cellKey(vec3i(x,y,z))]);loop{if(j==END){break;}if(j>i){let b=bodies[j];let bound=max(abs(a.shape.x)+a.v.w,abs(a.shape.y)+a.w.w)+max(abs(b.shape.x)+b.v.w,abs(b.shape.y)+b.w.w);
   if(distance(a.p.xyz,b.p.xyz)<bound){for(var sa=0u;sa<2u;sa++){for(var sb=0u;sb<2u;sb++){let ra=sphereArm(a,sa);let rb=sphereArm(b,sb);let d=a.p.xyz+ra-b.p.xyz-rb;let l=length(d);let overlap=sphereRadius(a,sa)+sphereRadius(b,sb)-l;if(overlap>0.0){contact(i,j,ra,rb,select(vec3f(0,1,0),d/max(l,1e-30),l>1e-20),overlap);}}}}
  }j=next[j];}
 }}}
}
@compute @workgroup_size(64) fn materialContacts(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.counts.y){return;}let b=bodies[i];
 for(var f=0u;f<p.counts.w;f++){
  let face=faces[f];let a=bodies[face.x].p.xyz;let c=bodies[face.y].p.xyz;let d=bodies[face.z].p.xyz;
  let bound=max(b.v.w,b.w.w)+max(abs(b.shape.x),abs(b.shape.y));if(any(b.p.xyz<min(a,min(c,d))-vec3f(bound))||any(b.p.xyz>max(a,max(c,d))+vec3f(bound))){continue;}
  let area=cross(c-a,d-a);let areaLength=length(area);if(areaLength<1e-20){continue;}let outward=area/areaLength;
  for(var lobe=0u;lobe<2u;lobe++){
   let arm=sphereArm(b,lobe);let center=b.p.xyz+arm;let radius=sphereRadius(b,lobe);let bary=triBary(center,a,c,d);let point=a*bary.x+c*bary.y+d*bary.z;let delta=center-point;let dist=length(delta);let side=dot(center-a,outward);
   if(dist>=radius||side< -radius*.5){continue;}let n=select(outward,delta/max(dist,1e-30),side>0.0);let gradient=cross(arm,n);let ids=face.xyz;
   var effective=b.p.w+dot(gradient,invInertia(b,gradient));for(var k=0u;k<3u;k++){effective+=bodies[ids[k]].p.w*bary[k]*bary[k];}
   let penetration=select(radius-side,radius-dist,side>0.0);let lambda=penetration/max(effective,1e-30)*.35;var correction=n*lambda;
   var relative=b.p.xyz-before[i].p.xyz;for(var k=0u;k<3u;k++){relative-=(bodies[ids[k]].p.xyz-before[ids[k]].p.xyz)*bary[k];}
   let tangent=relative-n*dot(relative,n);let speed=length(tangent);if(speed>1e-12){correction-=tangent/speed*min(p.law.y*lambda,speed/max(effective,1e-30)*.35);}
   addDelta(i,correction*b.p.w,invInertia(b,cross(arm,correction)));for(var k=0u;k<3u;k++){addDelta(ids[k],-correction*(bodies[ids[k]].p.w*bary[k]),vec3f(0));}
  }
 }
}
// The tool uses the same continuous boundary as grain contact, even between vertices.
@compute @workgroup_size(64) fn formingContacts(@builtin(global_invocation_id) id:vec3u){
 let fi=id.x;if(fi>=p.counts.w||p.tool.w<=0.0){return;}let ids=faces[fi].xyz;let a=bodies[ids.x].p.xyz;let b=bodies[ids.y].p.xyz;let c=bodies[ids.z].p.xyz;
 let bary=triBary(p.tool.xyz,a,b,c);let point=a*bary.x+b*bary.y+c*bary.z;let delta=point-p.tool.xyz;let dist=length(delta);if(dist>=p.tool.w){return;}let area=cross(b-a,c-a);if(length(area)<1e-20){return;}let n=select(-normalize(area),delta/max(dist,1e-30),dist>1e-20);var effective=0.0;for(var k=0u;k<3u;k++){effective+=bodies[ids[k]].p.w*bary[k]*bary[k];}
 let lambda=(p.tool.w-dist)/max(effective,1e-30)*.35;var correction=n*lambda;var relative=-(p.tool.xyz-p.previousTool.xyz);for(var k=0u;k<3u;k++){relative+=(bodies[ids[k]].p.xyz-before[ids[k]].p.xyz)*bary[k];}let tangent=relative-n*dot(relative,n);let speed=length(tangent);if(speed>1e-12){correction-=tangent/speed*min(p.law.y*lambda,speed/max(effective,1e-30)*.35);}for(var k=0u;k<3u;k++){addDelta(ids[k],correction*(bodies[ids[k]].p.w*bary[k]),vec3f(0));}
}
// Disjoint element colors allow local Gauss-Seidel solves without racing on nodes.
@compute @workgroup_size(64) fn material(@builtin(global_invocation_id) id:vec3u){
 let ti=id.x;if(ti>=p.counts.z){return;}let t=tets[ti];if(t.law.w>0.5||t.history.z!=u32(p.law.w)){return;}let ids=t.ids;var x:array<vec3f,4>;var im:array<f32,4>;
 for(var k=0u;k<4u;k++){x[k]=bodies[ids[k]].p.xyz;im[k]=bodies[ids[k]].p.w;}
 let edge=array<vec2u,6>(vec2u(0,1),vec2u(0,2),vec2u(0,3),vec2u(1,2),vec2u(1,3),vec2u(2,3));
 for(var k=0u;k<6u;k++){let a=edge[k].x;let b=edge[k].y;let delta=x[a]-x[b];let len=length(delta);var rest=t.rest1[0];if(k<4u){rest=t.rest0[k];}else{rest=t.rest1[k-4u];}if(len>1e-20){let correction=delta/len*((rest-len)/max(im[a]+im[b],1e-30)*.25);x[a]+=correction*im[a];x[b]-=correction*im[b];}}
 let g1=cross(x[2]-x[0],x[3]-x[0])/6.0;let g2=cross(x[3]-x[0],x[1]-x[0])/6.0;let g3=cross(x[1]-x[0],x[2]-x[0])/6.0;let gradients=array<vec3f,4>(-g1-g2-g3,g1,g2,g3);
 var denominator=0.0;for(var k=0u;k<4u;k++){denominator+=im[k]*dot(gradients[k],gradients[k]);}
 let volume=signedVolume(x[0],x[1],x[2],x[3]);let lambda=(t.law.x-volume)/max(denominator,1e-30)*.9;
 for(var k=0u;k<4u;k++){bodies[ids[k]].p=vec4f(x[k]+gradients[k]*(lambda*im[k]),im[k]);}
}
@compute @workgroup_size(64) fn transition(@builtin(global_invocation_id) id:vec3u){let ti=id.x;if(ti>=p.grid.w){return;}let ids=ties[ti].xyz;let error=bodies[ids.x].p.xyz-(bodies[ids.y].p.xyz+bodies[ids.z].p.xyz)*.5;let inv=bodies[ids.x].p.w+(bodies[ids.y].p.w+bodies[ids.z].p.w)*.25;let correction=-error/max(inv,1e-30)*.35;addDelta(ids.x,correction*bodies[ids.x].p.w,vec3f(0));addDelta(ids.y,-correction*bodies[ids.y].p.w*.5,vec3f(0));addDelta(ids.z,-correction*bodies[ids.z].p.w*.5,vec3f(0));}
@compute @workgroup_size(64) fn apply(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.counts.x){return;}var b=bodies[i];var shift=vec3f(0);var rotate=vec3f(0);for(var k=0u;k<3u;k++){shift[k]=f32(atomicLoad(&deltas[i].p[k]))*(p.domain.x/262144.0)*b.p.w;rotate[k]=f32(atomicLoad(&deltas[i].r[k]))/1048576.0;}
 b.p=vec4f(b.p.xyz+shift,b.p.w);b.q=normalize(b.q+qmul(vec4f(rotate*.5,0),b.q));
 let lobes=select(1u,2u,i<p.counts.y);
 for(var lobe=0u;lobe<lobes;lobe++){
  let arm=sphereArm(b,lobe);let radius=sphereRadius(b,lobe);let center=b.p.xyz+arm;
  let lower=vec3f(-p.domain.x*.5,0,-p.domain.y*.5)+vec3f(radius);let upper=vec3f(p.domain.x*.5,1e10,p.domain.y*.5)-vec3f(radius);let difference=clamp(center,lower,upper)-center;
  if(length(difference)>0.0){let n=normalize(difference);let g=cross(arm,n);let effective=b.p.w+dot(g,invInertia(b,g));let impulse=difference/max(effective,1e-30);b.p=vec4f(b.p.xyz+impulse*b.p.w,b.p.w);b.q=normalize(b.q+qmul(vec4f(invInertia(b,cross(arm,impulse))*.5,0),b.q));}
  if(p.tool.w>0.0&&i<p.counts.y){let delta=b.p.xyz+arm-p.tool.xyz;let dist=length(delta);let overlap=p.tool.w+radius-dist;if(overlap>0.0){let n=select(vec3f(0,1,0),delta/max(dist,1e-30),dist>1e-20);let g=cross(arm,n);let effective=b.p.w+dot(g,invInertia(b,g));var correction=n*(overlap/max(effective,1e-30));let relative=(b.p.xyz-before[i].p.xyz)-(p.tool.xyz-p.previousTool.xyz);let tangent=relative-n*dot(relative,n);let speed=length(tangent);if(speed>1e-12){correction-=tangent/speed*min(p.law.y*overlap/max(effective,1e-30),speed/max(effective,1e-30));}b.p=vec4f(b.p.xyz+correction*b.p.w,b.p.w);b.q=normalize(b.q+qmul(vec4f(invInertia(b,cross(arm,correction))*.5,0),b.q));}}
 }
 // The tool and floor share the same material domain. Tool projection is not
 // permitted to publish points below the tray.
 if(i>=p.counts.y){b.p.y=max(0.0,b.p.y);}
 bodies[i]=b;
}
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.x){return;}var b=bodies[i];b.v=vec4f((b.p.xyz-before[i].p.xyz)/p.domain.w*exp(-p.law.z*p.domain.w),b.v.w);let dq=qmul(b.q,qconj(before[i].q));b.w=vec4f(dq.xyz*select(-2.0,2.0,dq.w>=0.0)/p.domain.w*exp(-p.law.z*p.domain.w),b.w.w);bodies[i]=b;}
// Update one realizable canonical rest tetrahedron, then normalize its volume.
// Distances remain objective under a world-space rotation; the canonical edge
// frame is a prototype plastic law, not an isotropic calibrated clay model.
fn canonical(l:array<f32,6>)->array<vec3f,4>{let x=l[0];let cx=(x*x+l[1]*l[1]-l[3]*l[3])/(2.0*x);let cy=sqrt(max(1e-30,l[1]*l[1]-cx*cx));let dx=(x*x+l[2]*l[2]-l[4]*l[4])/(2.0*x);let dy=(l[1]*l[1]+l[2]*l[2]-l[5]*l[5]-2.0*cx*dx)/(2.0*cy);let dz=sqrt(max(1e-30,l[2]*l[2]-dx*dx-dy*dy));return array<vec3f,4>(vec3f(0),vec3f(x,0,0),vec3f(cx,cy,0),vec3f(dx,dy,dz));}
@compute @workgroup_size(64) fn plastic(@builtin(global_invocation_id) id:vec3u){
 let ti=id.x;if(ti>=p.counts.z){return;}var t=tets[ti];let edge=array<vec2u,6>(vec2u(0,1),vec2u(0,2),vec2u(0,3),vec2u(1,2),vec2u(1,3),vec2u(2,3));var old:array<f32,6>;var current:array<f32,6>;var strain=0.0;
 for(var k=0u;k<6u;k++){if(k<4u){old[k]=t.rest0[k];}else{old[k]=t.rest1[k-4u];}current[k]=distance(bodies[t.ids[edge[k].x]].p.xyz,bodies[t.ids[edge[k].y]].p.xyz);strain=max(strain,abs(current[k]/old[k]-1.0));}
 if(strain<=t.law.y){return;}var r=canonical(old);let destination=canonical(current);let alpha=1.0-exp(-t.law.z*p.domain.w);for(var k=1u;k<4u;k++){r[k]=mix(r[k],destination[k],alpha);}let volume=signedVolume(r[0],r[1],r[2],r[3]);if(volume<=1e-30){return;}let scale=pow(t.law.x/volume,1.0/3.0);
 for(var k=0u;k<6u;k++){let len=distance(r[edge[k].x],r[edge[k].y])*scale;if(k<4u){t.rest0[k]=len;}else{t.rest1[k-4u]=len;}}tets[ti]=t;
}
`;
