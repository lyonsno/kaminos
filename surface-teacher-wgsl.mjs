// Shared by interactive images and raw teacher queries. Explicit surface
// transport; a constant environment plus native directional/point lights.
export const SURFACE_TEACHER_COMMON_WGSL=/* wgsl */`
const PI=3.141592653589793;
struct Node {lo:vec4<f32>,hi:vec4<f32>,range:vec4<u32>}
struct Triangle {a:vec4<f32>,e1:vec4<f32>,e2:vec4<f32>}
struct Material {color:vec4<f32>,optics:vec4<f32>}
struct Light {positionType:vec4<f32>,color:vec4<f32>}
struct Params {inverseVP:mat4x4<f32>,previousVP:mat4x4<f32>,camera:vec4<f32>,extent:vec4<u32>,knobs:vec4<f32>}
struct Hit {t:f32,id:u32,normal:vec3<f32>,uv:vec2<f32>}
@group(0) @binding(0) var<storage,read> nodes:array<Node>;
@group(0) @binding(1) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(2) var<storage,read> materials:array<Material>;
@group(0) @binding(3) var<storage,read> lights:array<Light>;
@group(0) @binding(4) var<uniform> params:Params;
fn random(state:ptr<function,u32>)->f32{*state=*state*1664525u+1013904223u;var v=*state;v=(v^(v>>16u))*2246822519u;v=(v^(v>>13u))*3266489917u;return f32(v^(v>>16u))*(1.0/4294967296.0);}
fn rayBox(origin:vec3<f32>,direction:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>,limit:f32)->bool{
 var near=0.00001;var far=limit;
 for(var a=0u;a<3u;a++){
  if(abs(direction[a])<1e-12){if(origin[a]<lo[a]||origin[a]>hi[a]){return false;}}
  else{let first=(lo[a]-origin[a])/direction[a];let last=(hi[a]-origin[a])/direction[a];near=max(near,min(first,last));far=min(far,max(first,last));}
 }
 return far>=near;
}
fn rayTriangle(origin:vec3<f32>,direction:vec3<f32>,a:vec3<f32>,e1:vec3<f32>,e2:vec3<f32>)->vec3<f32>{
 let p=cross(direction,e2);let determinant=dot(e1,p);
 if(abs(determinant)<1e-10){return vec3<f32>(-1.0);}
 let offset=origin-a;let u=dot(offset,p)/determinant;let q=cross(offset,e1);let v=dot(direction,q)/determinant;let t=dot(e2,q)/determinant;
 if(u<0.0||v<0.0||u+v>1.0||t<=0.00001){return vec3<f32>(-1.0);}
 return vec3<f32>(t,u,v);
}
fn trace(origin:vec3<f32>,direction:vec3<f32>,limit:f32)->Hit{
 var hit=Hit(limit,0xffffffffu,vec3<f32>(0.0),vec2<f32>(0.0));var node=0u;
 loop{if(node>=arrayLength(&nodes)){break;}let item=nodes[node];
  if(!rayBox(origin,direction,item.lo.xyz,item.hi.xyz,hit.t)){node=item.range.x;continue;}
  for(var i=0u;i<item.range.z;i++){
   let id=item.range.y+i;let tri=triangles[id];let sample=rayTriangle(origin,direction,tri.a.xyz,tri.e1.xyz,tri.e2.xyz);
   if(sample.x>0.0&&sample.x<hit.t){var normal=normalize(cross(tri.e1.xyz,tri.e2.xyz));if(dot(normal,direction)>0.0){normal=-normal;}hit=Hit(sample.x,id,normal,sample.yz);}
  }
  node++;
 }
 return hit;
}
fn tangentDirection(n:vec3<f32>,local:vec3<f32>)->vec3<f32>{
 let helper=select(vec3<f32>(0.0,1.0,0.0),vec3<f32>(1.0,0.0,0.0),abs(n.y)>.99);let x=normalize(cross(helper,n));return normalize(x*local.x+cross(n,x)*local.y+n*local.z);
}
fn cosineSample(n:vec3<f32>,s:ptr<function,u32>)->vec3<f32>{let r=sqrt(random(s));let phi=2.0*PI*random(s);return tangentDirection(n,vec3<f32>(r*cos(phi),r*sin(phi),sqrt(max(0.0,1.0-r*r))));}
fn ggxD(nh:f32,alpha:f32)->f32{let a2=alpha*alpha;let denominator=nh*nh*(a2-1.0)+1.0;return a2/(PI*denominator*denominator);}
fn smithG(nv:f32,alpha:f32)->f32{return 2.0*nv/max(nv+sqrt(alpha*alpha+(1.0-alpha*alpha)*nv*nv),1e-8);}
fn bsdf(n:vec3<f32>,v:vec3<f32>,l:vec3<f32>,m:Material)->vec3<f32>{
 let nl=dot(n,l);let nv=dot(n,v);if(nl<=0.0||nv<=0.0){return vec3<f32>(0.0);}
 let h=normalize(v+l);let nh=max(dot(n,h),0.0);let vh=max(dot(v,h),0.0);let alpha=max(.02,m.optics.x*m.optics.x);
 let f0=mix(vec3<f32>(.04),m.color.rgb,m.optics.y);let fresnel=f0+(vec3<f32>(1.0)-f0)*pow(1.0-vh,5.0);
 return m.color.rgb*(1.0-m.optics.y)*(vec3<f32>(1.0)-fresnel)/PI+fresnel*ggxD(nh,alpha)*smithG(nl,alpha)*smithG(nv,alpha)/max(4.0*nl*nv,1e-8);
}
fn bsdfPdf(n:vec3<f32>,v:vec3<f32>,l:vec3<f32>,m:Material)->f32{
 if(dot(n,l)<=0.0){return 0.0;}let h=normalize(v+l);let alpha=max(.02,m.optics.x*m.optics.x);
 return .5*max(dot(n,l),0.0)/PI+.5*ggxD(max(dot(n,h),0.0),alpha)*max(dot(n,h),0.0)/max(4.0*abs(dot(v,h)),1e-8);
}
fn bsdfSample(n:vec3<f32>,v:vec3<f32>,m:Material,s:ptr<function,u32>)->vec3<f32>{
 if(random(s)<.5){return cosineSample(n,s);}
 let alpha=max(.02,m.optics.x*m.optics.x);let u=random(s);let phi=2.0*PI*random(s);let c=sqrt((1.0-u)/(1.0+(alpha*alpha-1.0)*u));
 let h=tangentDirection(n,vec3<f32>(sqrt(1.0-c*c)*cos(phi),sqrt(1.0-c*c)*sin(phi),c));return reflect(-v,h);
}
fn powerWeight(a:f32,b:f32)->f32{return a*a/max(a*a+b*b,1e-20);}
fn pathTrace(origin:vec3<f32>,direction:vec3<f32>,state:ptr<function,u32>)->vec3<f32>{
 var o=origin;var d=direction;var throughput=vec3<f32>(1.0);var radiance=vec3<f32>(0.0);var previousPdf=0.0;var previousNormal=vec3<f32>(0.0);
 for(var bounce=0u;bounce<params.extent.w;bounce++){
  let hit=trace(o,d,1e20);
  if(hit.id==0xffffffffu){var weight=1.0;if(bounce>0u){weight=powerWeight(previousPdf,max(dot(previousNormal,d),0.0)/PI);}radiance+=throughput*params.knobs.z*weight;break;}
  let point=o+d*hit.t;let n=hit.normal;let v=-d;let m=materials[u32(triangles[hit.id].a.w)];let offset=point+n*0.0001;
  for(var i=0u;i<u32(params.knobs.w);i++){
   let light=lights[i];var l=normalize(light.positionType.xyz);var distance=1e20;var intensity=light.color.rgb;
   if(light.positionType.w>0.5){let delta=light.positionType.xyz-point;distance=length(delta);l=delta/max(distance,1e-8);intensity/=max(distance*distance,1e-8);}
   if(dot(n,l)>0.0&&trace(offset,l,distance-.0002).id==0xffffffffu){radiance+=throughput*bsdf(n,v,l,m)*dot(n,l)*intensity;}
  }
  let envDirection=cosineSample(n,state);let envPdf=max(dot(n,envDirection),0.0)/PI;let otherPdf=bsdfPdf(n,v,envDirection,m);
  if(trace(offset,envDirection,1e20).id==0xffffffffu){
   // At the terminal vertex only NEE samples this environment contribution.
   let weight=select(powerWeight(envPdf,otherPdf),1.0,bounce+1u==params.extent.w);
   radiance+=throughput*bsdf(n,v,envDirection,m)*max(dot(n,envDirection),0.0)*params.knobs.z*weight/max(envPdf,1e-8);
  }
  let next=bsdfSample(n,v,m,state);let pdf=bsdfPdf(n,v,next,m);if(pdf<=0.0||dot(n,next)<=0.0){break;}
  throughput*=bsdf(n,v,next,m)*max(dot(n,next),0.0)/pdf;previousPdf=pdf;previousNormal=n;o=offset;d=next;
  if(bounce>=2u){let survive=clamp(max(throughput.x,max(throughput.y,throughput.z)),.05,.95);if(random(state)>survive){break;}throughput/=survive;}
 }
 return radiance;
}
`;

export const SURFACE_TEACHER_IMAGE_WGSL=SURFACE_TEACHER_COMMON_WGSL+/* wgsl */`
@group(0) @binding(5) var raw:texture_storage_2d<rgba32float,write>;
@group(0) @binding(6) var positions:texture_storage_2d<rgba32float,write>;
@group(0) @binding(7) var normals:texture_storage_2d<rgba32float,write>;
fn cameraRay(q:vec2<f32>)->vec3<f32>{let far=params.inverseVP*vec4<f32>(q.x*2.0-1.0,1.0-q.y*2.0,1.0,1.0);return normalize(far.xyz/far.w-params.camera.xyz);}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(any(id.xy>=params.extent.xy)){return;}let pixel=vec2<i32>(id.xy);var state=(id.x+id.y*params.extent.x)*747796405u+(params.extent.z+1u)*2891336453u;
 let q=(vec2<f32>(id.xy)+vec2<f32>(random(&state),random(&state)))/vec2<f32>(params.extent.xy);
 let color=pathTrace(params.camera.xyz,cameraRay(q),&state);textureStore(raw,pixel,vec4<f32>(color,1.0));
 let centre=cameraRay((vec2<f32>(id.xy)+.5)/vec2<f32>(params.extent.xy));let hit=trace(params.camera.xyz,centre,1e20);
 var point=vec4<f32>(0.0);var normal=vec4<f32>(0.0);
 if(hit.id!=0xffffffffu){point=vec4<f32>(params.camera.xyz+centre*hit.t,1.0);normal=vec4<f32>(hit.normal,triangles[hit.id].a.w+1.0);}
 textureStore(positions,pixel,point);textureStore(normals,pixel,normal);
}
`;

export const SURFACE_TEACHER_QUERY_WGSL=SURFACE_TEACHER_COMMON_WGSL+/* wgsl */`
struct Query {origin:vec4<f32>,direction:vec4<f32>}
@group(0) @binding(5) var<storage,read> queries:array<Query>;
@group(0) @binding(6) var<storage,read_write> answers:array<vec4<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=arrayLength(&queries)){return;}var state=id.x*747796405u+(params.extent.z+1u)*2891336453u;
 answers[id.x]=vec4<f32>(pathTrace(queries[id.x].origin.xyz,normalize(queries[id.x].direction.xyz),&state),1.0);
}
`;

export const SURFACE_TEACHER_HISTORY_WGSL=/* wgsl */`
struct HistoryParams {previousVP:mat4x4<f32>,settings:vec4<f32>}
@group(0) @binding(0) var current:texture_2d<f32>;
@group(0) @binding(1) var point:texture_2d<f32>;
@group(0) @binding(2) var normal:texture_2d<f32>;
@group(0) @binding(3) var oldColor:texture_2d<f32>;
@group(0) @binding(4) var oldPoint:texture_2d<f32>;
@group(0) @binding(5) var oldNormal:texture_2d<f32>;
@group(0) @binding(6) var output:texture_storage_2d<rgba32float,write>;
@group(0) @binding(7) var<uniform> params:HistoryParams;
fn historyCompatible(p:vec4<f32>,n:vec4<f32>,oldP:vec4<f32>,oldN:vec4<f32>,tolerance:f32)->bool{
 return p.w==oldP.w&&n.w==oldN.w&&(p.w==0.0||(distance(p.xyz,oldP.xyz)<tolerance&&dot(n.xyz,oldN.xyz)>.95));
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(current);if(any(id.xy>=size)){return;}let pixel=vec2<i32>(id.xy);let value=textureLoad(current,pixel,0);let p=textureLoad(point,pixel,0);let n=textureLoad(normal,pixel,0);
 var old=vec4<f32>(0.0);var valid=params.settings.x>0.5;
 var q=pixel;
 if(params.settings.y>0.5){
  valid=valid&&p.w>0.0;let clip=params.previousVP*vec4<f32>(p.xyz,1.0);let uv=vec2<f32>(clip.x/clip.w*.5+.5,.5-clip.y/clip.w*.5);q=vec2<i32>(floor(uv*vec2<f32>(size)));valid=valid&&clip.w>0.0&&all(q>=vec2<i32>(0))&&all(q<vec2<i32>(size));
 }
 if(valid){old=textureLoad(oldColor,q,0);valid=old.a>0.0&&historyCompatible(p,n,textureLoad(oldPoint,q,0),textureLoad(oldNormal,q,0),params.settings.z);}
 if(!valid){old=vec4<f32>(0.0);}
 var count=old.a+1.0;var alpha=1.0/count;
 if(params.settings.y>0.5&&old.a>0.0){alpha=max(alpha,.2);count=1.0/alpha;}
 textureStore(output,pixel,vec4<f32>(mix(old.rgb,value.rgb,alpha),count));
}
`;

export const SURFACE_TEACHER_FILTER_WGSL=/* wgsl */`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var point:texture_2d<f32>;
@group(0) @binding(2) var normal:texture_2d<f32>;
@group(0) @binding(3) var output:texture_storage_2d<rgba32float,write>;
@group(0) @binding(4) var<uniform> settings:vec4<f32>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(source);if(any(id.xy>=size)){return;}let pixel=vec2<i32>(id.xy);let c=textureLoad(source,pixel,0);let p=textureLoad(point,pixel,0);let n=textureLoad(normal,pixel,0);
 var mean=0.0;var squared=0.0;var samples=0.0;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let q=clamp(pixel+vec2<i32>(x,y),vec2<i32>(0),vec2<i32>(size)-1);let l=dot(textureLoad(source,q,0).rgb,vec3<f32>(.2126,.7152,.0722));mean+=l;squared+=l*l;samples+=1.0;}}
 let variance=max(0.0001,squared/samples-(mean/samples)*(mean/samples));let sigma=sqrt(variance);var sum=vec3<f32>(0.0);var weights=0.0;
 let kernel=array<f32,5>(1.0,4.0,6.0,4.0,1.0);
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let q=pixel+vec2<i32>(x,y)*i32(settings.x);if(any(q<vec2<i32>(0))||any(q>=vec2<i32>(size))){continue;}
  let neighbor=textureLoad(source,q,0);let pn=textureLoad(point,q,0);let nn=textureLoad(normal,q,0);
  if(p.w!=pn.w||n.w!=nn.w){continue;}
  var weight=kernel[u32(x+2)]*kernel[u32(y+2)];
  if(p.w>0.0){weight*=pow(max(dot(n.xyz,nn.xyz),0.0),64.0)*exp(-abs(dot(pn.xyz-p.xyz,n.xyz))/max(settings.y,.0001));}
  let delta=abs(dot(neighbor.rgb-c.rgb,vec3<f32>(.2126,.7152,.0722)));weight*=exp(-delta/max(.015,4.0*sigma));sum+=neighbor.rgb*weight;weights+=weight;
 }}
 textureStore(output,pixel,vec4<f32>(sum/max(weights,1e-12),c.a));
}
`;

export const SURFACE_TEACHER_PRESENT_WGSL=/* wgsl */`
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings:vec4<f32>;
@vertex fn vertex(@builtin(vertex_index) id:u32)->@builtin(position) vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[id],0,1);}
@fragment fn fragment(@builtin(position) pixel:vec4<f32>)->@location(0) vec4<f32>{
 let size=vec2<f32>(textureDimensions(image));let q=clamp(vec2<i32>(pixel.xy/settings.xy*size),vec2<i32>(0),vec2<i32>(size)-1);let linear=max(textureLoad(image,q,0).rgb*settings.z,vec3<f32>(0));let mapped=linear/(vec3<f32>(1)+linear);return vec4<f32>(pow(mapped,vec3<f32>(1.0/2.2)),1.0);
}
`;
