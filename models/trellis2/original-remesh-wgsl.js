// Closest-point geometry and narrow-band DC kernels for the original finisher.
// Traversal uses preorder escape links: there is no fixed traversal stack and
// therefore no silent loss of deep BVH subtrees (the old Metal failure mode).
export const CLOSEST_SURFACE_WGSL=/* wgsl */`
struct Node { lo:vec4<f32>, hi:vec4<f32>, links:vec4<u32> }
struct Hit { pointDistance:vec4<f32>, baryFace:vec4<f32> }
@group(0) @binding(0) var<storage,read> nodes:array<Node>;
@group(0) @binding(1) var<storage,read> vertices:array<f32>;
@group(0) @binding(2) var<storage,read> faces:array<u32>;
@group(0) @binding(3) var<storage,read> order:array<u32>;
@group(0) @binding(4) var<storage,read> points:array<f32>;
@group(0) @binding(5) var<storage,read_write> hits:array<Hit>;
@group(0) @binding(6) var<uniform> params:vec4<u32>;
fn vertex(i:u32)->vec3<f32>{return vec3<f32>(vertices[i*3u],vertices[i*3u+1u],vertices[i*3u+2u]);}
fn segment(p:vec3<f32>,a:vec3<f32>,b:vec3<f32>)->f32{
 let d=b-a;let n=dot(d,d);if(n==0.0){return 0.0;}return clamp(dot(p-a,d)/n,0.0,1.0);
}
fn triangleBary(p:vec3<f32>,a:vec3<f32>,b:vec3<f32>,c:vec3<f32>)->vec3<f32>{
 let ab=b-a;let ac=c-a;let normal=cross(ab,ac);
 if(dot(normal,normal)==0.0){
  let t0=segment(p,a,b);let t1=segment(p,b,c);let t2=segment(p,a,c);
  let p0=a+t0*ab;let p1=b+t1*(c-b);let p2=a+t2*ac;
  let d0=dot(p-p0,p-p0);let d1=dot(p-p1,p-p1);let d2=dot(p-p2,p-p2);
  if(d0<=d1&&d0<=d2){return vec3<f32>(1.0-t0,t0,0.0);}
  if(d1<=d2){return vec3<f32>(0.0,1.0-t1,t1);}return vec3<f32>(1.0-t2,0.0,t2);
 }
 let ap=p-a;let d1=dot(ab,ap);let d2=dot(ac,ap);
 if(d1<=0.0&&d2<=0.0){return vec3<f32>(1.0,0.0,0.0);}
 let bp=p-b;let d3=dot(ab,bp);let d4=dot(ac,bp);
 if(d3>=0.0&&d4<=d3){return vec3<f32>(0.0,1.0,0.0);}
 let vc=d1*d4-d3*d2;
 if(vc<=0.0&&d1>=0.0&&d3<=0.0){let v=d1/(d1-d3);return vec3<f32>(1.0-v,v,0.0);}
 let cp=p-c;let d5=dot(ab,cp);let d6=dot(ac,cp);
 if(d6>=0.0&&d5<=d6){return vec3<f32>(0.0,0.0,1.0);}
 let vb=d5*d2-d1*d6;
 if(vb<=0.0&&d2>=0.0&&d6<=0.0){let w=d2/(d2-d6);return vec3<f32>(1.0-w,0.0,w);}
 let va=d3*d6-d5*d4;
 if(va<=0.0&&(d4-d3)>=0.0&&(d5-d6)>=0.0){let w=(d4-d3)/((d4-d3)+(d5-d6));return vec3<f32>(0.0,1.0-w,w);}
 let inv=1.0/(va+vb+vc);let v=vb*inv;let w=vc*inv;return vec3<f32>(1.0-v-w,v,w);
}
@compute @workgroup_size(64) fn closest_surface(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=params.x){return;}
 let p=vec3<f32>(points[i*3u],points[i*3u+1u],points[i*3u+2u]);
 var best=3.402823e38;var face=0xffffffffu;var point=vec3<f32>(0.0);var bary=vec3<f32>(0.0);var node=0u;
 loop {
  if(node>=arrayLength(&nodes)){break;}let n=nodes[node];
  let delta=max(max(n.lo.xyz-p,p-n.hi.xyz),vec3<f32>(0.0));
  if(dot(delta,delta)>best){node=n.links.x;continue;}
  if(n.links.z==0u){node++;continue;}
  for(var j=0u;j<n.links.z;j++){
   let fi=order[n.links.y+j];let a=vertex(faces[fi*3u]);let b=vertex(faces[fi*3u+1u]);let c=vertex(faces[fi*3u+2u]);
   let uvw=triangleBary(p,a,b,c);let q=a*uvw.x+b*uvw.y+c*uvw.z;let d=dot(p-q,p-q);
   if(d<best||(d==best&&fi<face)){best=d;face=fi;point=q;bary=uvw;}
  }
  node=n.links.x;
 }
 hits[i].pointDistance=vec4<f32>(point,sqrt(best));hits[i].baryFace=vec4<f32>(bary,bitcast<f32>(face));
}
`;

// Corner addressing is resolved from the complete sparse grid on the CPU
// worker. The interpolation/edge ownership is the production Metal DC kernel.
export const DUAL_CONTOUR_WGSL=/* wgsl */`
@group(0) @binding(0) var<storage,read> cells:array<u32>;
@group(0) @binding(1) var<storage,read> corners:array<u32>;
@group(0) @binding(2) var<storage,read> sdf:array<f32>;
@group(0) @binding(3) var<storage,read_write> dual:array<f32>;
@group(0) @binding(4) var<storage,read_write> signs:array<i32>;
@group(0) @binding(5) var<uniform> params:vec4<u32>;
fn value(i:u32,c:vec3<u32>)->f32{return sdf[corners[i*8u+c.x+2u*c.y+4u*c.z]];}
@compute @workgroup_size(64) fn dual_contour(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=params.x){return;}let cell=vec3<f32>(f32(cells[i*3u]),f32(cells[i*3u+1u]),f32(cells[i*3u+2u]));
 var sum=vec3<f32>(0.0);var count=0u;
 for(var axis=0u;axis<3u;axis++){
  for(var u=0u;u<2u;u++) {for(var v=0u;v<2u;v++){
   var a=vec3<u32>(0u,u,v);if(axis==1u){a=vec3<u32>(u,0u,v);}if(axis==2u){a=vec3<u32>(u,v,0u);}
   var b=a;b[axis]=1u;let v1=value(i,a);let v2=value(i,b);
   var direction=0i;if(v1<0.0&&v2>=0.0){direction=1;}else if(v1>=0.0&&v2<0.0){direction=-1;}
   if(direction!=0){var p=cell+vec3<f32>(a);p[axis]=cell[axis]+(-v1/(v2-v1));sum+=p;count++;}
   if(u==1u&&v==1u){signs[i*3u+axis]=direction;}
  }}
 }
 var position=cell+vec3<f32>(0.5);if(count>0u){position=sum/f32(count);}
 dual[i*3u]=position.x;dual[i*3u+1u]=position.y;dual[i*3u+2u]=position.z;
}
`;
