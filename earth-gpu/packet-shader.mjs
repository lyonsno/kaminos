import {EARTH_GPU_MATH_WGSL} from './shader.mjs';
export const PACKET_WGSL=EARTH_GPU_MATH_WGSL+`
struct Body{p:vec4f,q:vec4f,v:vec4f,w:vec4f,shape:vec4f,inertia:vec4f}
struct Delta{p:array<atomic<i32>,4>,r:array<atomic<i32>,4>}
struct Params{counts:vec4u,domain:vec4f,cells:vec4f,tool:vec4f,previousTool:vec4f,law:vec4f,cohesion:vec4f}
@group(0) @binding(0) var<storage,read_write> bodies:array<Body>;
@group(0) @binding(1) var<storage,read_write> before:array<Body>;
@group(0) @binding(2) var<storage,read_write> heads:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> next:array<u32>;
@group(0) @binding(4) var<storage,read_write> deltas:array<Delta>;
@group(0) @binding(5) var<storage,read_write> degree:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> p:Params;
@group(0) @binding(7) var<storage,read_write> status:array<atomic<u32>>;
const END=0xffffffffu;
fn cell(x:vec3f,fine:bool)->vec3i{return vec3i(floor(x/select(p.cells.x,p.cells.y,fine)));}
fn hash(c:vec3i,fine:bool)->u32{let h=(bitcast<u32>(c.x)*73856093u)^(bitcast<u32>(c.y)*19349663u)^(bitcast<u32>(c.z)*83492791u);return select(0u,p.counts.z,fine)+(h&(select(p.counts.z,p.counts.w,fine)-1u));}
fn invI(b:Body,v:vec3f)->vec3f{return qrotate(b.q,qrotate(qconj(b.q),v)*b.inertia.xyz);}
fn arm(b:Body,l:u32)->vec3f{return qrotate(b.q,vec3f(select(b.shape.x,b.shape.y,l==1u),0,0));}
fn radius(b:Body,l:u32)->f32{return select(b.v.w,b.w.w,l==1u);}
fn checkedAdd(i:u32,k:u32,v:f32,rot:bool){
 if(!isFiniteValue(v)||abs(v)>2147483000.0){atomicStore(&status[0],1u);return;}let a=i32(round(v));var old:i32;
 if(rot){old=atomicAdd(&deltas[i].r[k],a);}else{old=atomicAdd(&deltas[i].p[k],a);}
 if((a>0&&old>2147483647-a)||(a<0&&old<(-2147483647-1)-a)){atomicStore(&status[0],1u);}
}
fn isFiniteValue(v:f32)->bool{return v==v&&abs(v)<=3.402823e38;}
fn add(i:u32,impulse:vec3f,angular:vec3f){for(var k=0u;k<3u;k++){checkedAdd(i,k,impulse[k]*(16777216.0/p.domain.x),false);checkedAdd(i,k,angular[k]*1048576.0,true);}}
fn motion(i:u32,r:vec3f)->vec3f{let b=bodies[i];let old=before[i];return b.p.xyz-old.p.xyz+r-qrotate(old.q,qrotate(qconj(b.q),r));}
fn solve(i:u32,j:u32,ai:vec3f,aj:vec3f,ri:f32,rj:f32,countOnly:bool,adhesion:bool){
 let a=bodies[i];let b=bodies[j];let d=a.p.xyz+ai-b.p.xyz-aj;let len=length(d);let gap=len-ri-rj;let reach=p.cohesion.y*min(ri,rj);
 if(gap>=select(0.0,reach,adhesion)){return;}
 if(countOnly){if(gap<0.0||(adhesion&&p.cohesion.x>0.0&&(j>=p.counts.y||p.cohesion.z>0.0))){atomicAdd(&degree[i],1u);atomicAdd(&degree[j],1u);}return;}
 let n=select(vec3f(0,1,0),d/max(len,1e-30),len>1e-20);let point=(a.p.xyz+ai-n*ri+b.p.xyz+aj+n*rj)*.5;let ra=point-a.p.xyz;let rb=point-b.p.xyz;
 let ga=cross(ra,n);let gb=cross(rb,n);let effective=a.p.w+b.p.w+dot(ga,invI(a,ga))+dot(gb,invI(b,gb));let relax=.9/f32(max(1u,max(atomicLoad(&degree[i]),atomicLoad(&degree[j]))));
 var lambda=max(-gap,0.0)/max(effective,1e-30)*relax;var preload=0.0;
 // Cohesive preload survives touching/compressed contact for tangential yield.
 // Only tensile closure is gap-limited; shared adhesive neighbors relax together.
 if(adhesion&&reach>0.0){let force=p.cohesion.x*3.14159265*min(ri,rj)*min(ri,rj)*(1.0-max(gap,0.0)/reach)*select(p.cohesion.z,1.0,i>=p.counts.y&&j>=p.counts.y);preload=force*p.domain.w*p.domain.w/(p.cohesion.w*p.law.w);if(gap>0.0){lambda-=min(gap/max(effective,1e-30)*relax,preload);}}
 var impulse=n*lambda;let relative=motion(i,ra)-motion(j,rb);let tangent=relative-n*dot(relative,n);let speed=length(tangent);
 if(speed>1e-12){let t=tangent/speed;let gta=cross(ra,t);let gtb=cross(rb,t);let wt=a.p.w+b.p.w+dot(gta,invI(a,gta))+dot(gtb,invI(b,gtb));impulse-=t*min(p.law.y*(max(lambda,0.0)+preload),speed/max(wt,1e-30)*relax);}
 add(i,impulse,invI(a,cross(ra,impulse)));add(j,-impulse,-invI(b,cross(rb,impulse)));
}
fn bodyPair(i:u32,j:u32,countOnly:bool){let a=bodies[i];let b=bodies[j];
 if(i<p.counts.y&&j<p.counts.y){for(var sa=0u;sa<2u;sa++){for(var sb=0u;sb<2u;sb++){solve(i,j,arm(a,sa),arm(b,sb),radius(a,sa),radius(b,sb),countOnly,false);}}return;}
 // A sphere packet sees the closest exposed lobe once, rather than getting
 // duplicate cohesive forces from the overlapping interior of a rigid pair.
 if(j<p.counts.y){var best=1e20;var chosen=0u;for(var l=0u;l<2u;l++){let gap=distance(a.p.xyz,b.p.xyz+arm(b,l))-a.v.w-radius(b,l);if(gap<best){best=gap;chosen=l;}}solve(i,j,vec3f(0),arm(b,chosen),a.v.w,radius(b,chosen),countOnly,true);}
 else{solve(i,j,vec3f(0),vec3f(0),a.v.w,b.v.w,countOnly,true);}
}
fn neighbors(i:u32,fine:bool,countOnly:bool){let a=bodies[i];let c=cell(a.p.xyz,fine);for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let q=c+vec3i(x,y,z);var j=atomicLoad(&heads[hash(q,fine)]);loop{if(j==END){break;}
 if(j!=i&&all(cell(bodies[j].p.xyz,fine)==q)&&((fine&&j>i)||(!fine&&(i>=p.counts.y||j>i)))){bodyPair(i,j,countOnly);}j=next[j];}
 }}}}
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.x){return;}var b=bodies[i];before[i]=b;b.v.y-=p.law.x*p.domain.w;b.p=vec4f(b.p.xyz+b.v.xyz*p.domain.w,b.p.w);b.q=normalize(b.q+qmul(vec4f(b.w.xyz*p.domain.w*.5,0),b.q));bodies[i]=b;}
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i<p.counts.z+p.counts.w){atomicStore(&heads[i],END);}if(i<p.counts.x){atomicStore(&degree[i],0u);for(var k=0u;k<4u;k++){atomicStore(&deltas[i].p[k],0);atomicStore(&deltas[i].r[k],0);}}}
@compute @workgroup_size(64) fn index(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.x){return;}let fine=i>=p.counts.y;next[i]=atomicExchange(&heads[hash(cell(bodies[i].p.xyz,fine),fine)],i);}
@compute @workgroup_size(64) fn countContacts(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.x){return;}neighbors(i,false,true);if(i>=p.counts.y){neighbors(i,true,true);}}
@compute @workgroup_size(64) fn contacts(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.x){return;}neighbors(i,false,false);if(i>=p.counts.y){neighbors(i,true,false);}}
// One local body owns its tool/tray projections; there is no global boundary scan.
fn boundary(b0:Body,old:Body,n:vec3f,penetration:f32,point:vec3f,wallMotion:vec3f)->Body{var b=b0;let r=point-b.p.xyz;let g=cross(r,n);let w=b.p.w+dot(g,invI(b,g));let lambda=penetration/max(w,1e-30);var impulse=n*lambda;let relative=b.p.xyz-old.p.xyz+r-qrotate(old.q,qrotate(qconj(b.q),r))-wallMotion;let tangent=relative-n*dot(relative,n);let speed=length(tangent);if(speed>1e-12){let t=tangent/speed;let gt=cross(r,t);let wt=b.p.w+dot(gt,invI(b,gt));impulse-=t*min(p.law.y*lambda,speed/max(wt,1e-30));}b.p=vec4f(b.p.xyz+impulse*b.p.w,b.p.w);b.q=normalize(b.q+qmul(vec4f(invI(b,cross(r,impulse))*.5,0),b.q));return b;}
@compute @workgroup_size(64) fn apply(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.x){return;}var b=bodies[i];var shift=vec3f(0);var rot=vec3f(0);for(var k=0u;k<3u;k++){shift[k]=f32(atomicLoad(&deltas[i].p[k]))*(p.domain.x/16777216.0)*b.p.w;rot[k]=f32(atomicLoad(&deltas[i].r[k]))/1048576.0;}b.p=vec4f(b.p.xyz+shift,b.p.w);b.q=normalize(b.q+qmul(vec4f(rot*.5,0),b.q));let lobes=select(1u,2u,i<p.counts.y);
 for(var l=0u;l<lobes;l++){let r=radius(b,l);let a=arm(b,l);let center=b.p.xyz+a;
 if(p.tool.w>0.0){let delta=center-p.tool.xyz;let len=length(delta);let overlap=p.tool.w+r-len;if(overlap>0.0){let n=select(vec3f(0,1,0),delta/max(len,1e-30),len>1e-20);b=boundary(b,before[i],n,overlap,center-n*r,p.tool.xyz-p.previousTool.xyz);}}
 }
 // Tool first; final tray projection cannot publish a packet beneath the floor.
 for(var l=0u;l<lobes;l++){let r=radius(b,l);for(var axis=0u;axis<3u;axis++){let center=b.p.xyz+arm(b,l);let low=select(select(-p.domain.x*.5,-p.domain.y*.5,axis==2u),0.0,axis==1u)+r;let high=select(p.domain.x*.5,p.domain.y*.5,axis==2u)-r;var n=vec3f(0);var penetration=0.0;if(center[axis]<low){n[axis]=1.0;penetration=low-center[axis];}else if(axis!=1u&&center[axis]>high){n[axis]=-1.0;penetration=center[axis]-high;}if(penetration>0.0){b=boundary(b,before[i],n,penetration,center-n*r,vec3f(0));}}}
 var floorGap=0.0;for(var l=0u;l<lobes;l++){floorGap=min(floorGap,b.p.y+arm(b,l).y-radius(b,l));}b.p.y-=floorGap;
 for(var k=0u;k<3u;k++){if(!isFiniteValue(b.p[k])){atomicStore(&status[0],2u);}}bodies[i]=b;
}
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.x){return;}var b=bodies[i];let damping=exp(-p.law.z*p.domain.w);b.v=vec4f((b.p.xyz-before[i].p.xyz)/p.domain.w*damping,b.v.w);let dq=qmul(b.q,qconj(before[i].q));b.w=vec4f(dq.xyz*select(-2.0,2.0,dq.w>=0.0)/p.domain.w*damping,b.w.w);bodies[i]=b;}
`;
