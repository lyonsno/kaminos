// Experimental lighting reconstruction, independent of the camera renderer.
// 96B current-composition carriers -> Gaussian slab integrals -> two sweeps.
import {PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';

export function particleLightPlan(input,limits){
 const {dims,origin,extent,direction}=input;
 for(const [key,a] of Object.entries({dims,origin,extent,direction}))if(!Array.isArray(a)||a.length!==3||a.some(v=>!Number.isFinite(v)||!Number.isFinite(Math.fround(v))))throw Error('Invalid particle lighting '+key);
 if(dims.some(v=>!Number.isSafeInteger(v)||v<1)||extent.some(v=>v<=0))throw Error('Particle lighting dimensions and extents must be positive');
 const length=Math.hypot(...direction);if(length===0)throw Error('Particle lighting direction must be nonzero');
 const d=direction.map(v=>v/length),seed=Math.abs(d[2])<.9?[0,0,1]:[0,1,0],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const raw=cross(seed,d),norm=Math.hypot(...raw),u=raw.map(v=>v/norm),v=cross(d,u);
 const cells=dims.reduce((a,b)=>a*b,1),atlas=[dims[0]*dims[2],dims[1]],bytes=cells*16;
 if(!Number.isSafeInteger(bytes)||cells>0xffffffff||atlas.some(v=>v>limits.maxTextureDimension2D)||bytes>Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize))throw Error('Particle lighting field exceeds device limits');
 const settings={carrierMode:0,radius:.4,stretch:2,flowAlignment:0,expansion:0,supportFloor:0,supportSigmas:4,filterWidth:1,gain:1,extinction:2,stateLife:1,lifeFade:.2,...input.settings};
 for(const [k,v] of Object.entries(settings))if(!Number.isFinite(v)||v<0||!Number.isFinite(Math.fround(v)))throw Error('Invalid particle lighting '+k);
 if(settings.radius<=0||settings.stretch<=0||settings.supportSigmas<=0||settings.flowAlignment>1||settings.lifeFade>1)throw Error('Invalid particle lighting support');
 return {dims:[...dims],origin:[...origin],extent:[...extent],direction:d,u,v,cells,atlas,settings,bytes:cells*(8+4+32)+144,medium:'normalized 3D Gaussian; birth-pitch² × represented-length quadrature; intrinsic emission only',support:'projected ellipse cutoff in sigma units; full conditional depth integral within field'};
}
const PARAMS=`
struct Params {dims:vec4<u32>,origin:vec4<f32>,extent:vec4<f32>,axisU:vec4<f32>,axisV:vec4<f32>,axisD:vec4<f32>,optical:vec4<f32>,shape:vec4<f32>,support:vec4<f32>}
`;
export const PARTICLE_LIGHT_DEPOSIT_WGSL=/* wgsl */`${PARAMS}
${PARTICLE_STATE_WGSL}
struct Particle {anchor:vec4<f32>,source:vec4<f32>,emission:vec4<f32>,motion:vec4<f32>,shape:vec4<f32>,state:vec4<f32>}
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<uniform> p:Params;
struct Vertex {
 @builtin(position) clip:vec4<f32>,@location(0) delta:vec2<f32>,
 @location(1) @interpolate(flat) inverseXY:vec3<f32>,
 @location(2) @interpolate(flat) conditional:vec4<f32>,
 @location(3) @interpolate(flat) optical:vec4<f32>,
 @location(4) @interpolate(flat) layer:u32
}
fn decode(v:vec2<f32>)->vec3<f32>{var n=vec3<f32>(v,1.0-abs(v.x)-abs(v.y));let t=clamp(-n.z,0.0,1.0);n.x+=select(t,-t,n.x>=0);n.y+=select(t,-t,n.y>=0);return normalize(n);}
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Vertex{
 var out:Vertex;out.clip=vec4<f32>(2,2,2,1);
 let a=particles[instance/p.dims.z];let layer=instance%p.dims.z;
 if(a.anchor.w<=0||a.shape.x<=0||a.shape.w<=0){return out;}
 let fade=select(select(1.0,particleLifeFade(a.motion.w,p.optical.w),p.optical.z>0),1.0-clamp(a.motion.w,0.0,1.0),p.support.w>.5);
 let volume=a.shape.x*a.shape.x*a.shape.w;
 let optical=vec4<f32>(max(a.emission.xyz,vec3<f32>(0))*p.optical.x,max(a.state.z,0.0)*p.optical.y)*fade*volume;
 if(all(optical==vec4<f32>(0))){return out;}
 var axisY=vec3<f32>(0,1,0);if(p.shape.z>0){let mixed=mix(axisY,decode(a.shape.yz),p.shape.z);if(dot(mixed,mixed)>1e-10){axisY=normalize(mixed);}}
 let axisX=normalize(cross(axisY,select(vec3<f32>(0,0,1),vec3<f32>(1,0,0),abs(axisY.z)>.99)));let axisZ=cross(axisX,axisY);
 let growth=1.0+p.shape.w*select(0.0,max(0.0,1.0-a.state.x/max(a.emission.w,1e-20)),a.emission.w>0);
 let radius=max(a.shape.x,p.support.x)*p.shape.x*growth;
 let basis=array<vec3<f32>,3>(axisX*radius,axisY*radius*p.shape.y,axisZ*radius);
 var xx=0.0;var yy=0.0;var xy=0.0;var xz=0.0;var yz=0.0;var zz=0.0;
 for(var i=0u;i<3u;i++){let b=basis[i];let q=vec3<f32>(dot(b,p.axisU.xyz),dot(b,p.axisV.xyz),dot(b,p.axisD.xyz));xx+=q.x*q.x;yy+=q.y*q.y;xy+=q.x*q.y;xz+=q.x*q.z;yz+=q.y*q.z;zz+=q.z*q.z;}
 xx+=pow(p.extent.x/f32(p.dims.x)*p.support.z,2.0)/12.0;yy+=pow(p.extent.y/f32(p.dims.y)*p.support.z,2.0)/12.0;
 let det=xx*yy-xy*xy;let inv=vec3<f32>(yy,xx,-xy)/det;
 let slope=vec2<f32>(inv.x*xz+inv.z*yz,inv.z*xz+inv.y*yz);let sigma=sqrt(max(zz-dot(vec2<f32>(xz,yz),slope),1e-20));
 let at=a.anchor.xyz-p.origin.xyz;let center=vec3<f32>(dot(at,p.axisU.xyz),dot(at,p.axisV.xyz),dot(at,p.axisD.xyz));
 let corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));
 let offset=corners[vertex]*vec2<f32>(sqrt(xx),sqrt(yy))*p.support.y;
 let pixel=(center.xy+offset)/p.extent.xy*vec2<f32>(p.dims.xy);
 let atlas=vec2<f32>(pixel.x+f32(layer*p.dims.x),pixel.y)/vec2<f32>(f32(p.dims.x*p.dims.z),f32(p.dims.y));
 out.clip=vec4<f32>(atlas.x*2.0-1.0,1.0-atlas.y*2.0,0,1);out.delta=offset;out.inverseXY=inv;
 out.conditional=vec4<f32>(center.z,slope,sigma);out.optical=optical/(6.28318530718*sqrt(det));out.layer=layer;return out;
}
// Abramowitz/Stegun 7.1.26; maximum absolute erf error about 1.5e-7.
fn erfApprox(x:f32)->f32{let a=abs(x);let t=1.0/(1.0+.3275911*a);let e=1.0-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*exp(-a*a);return sign(x)*e;}
@fragment fn fs(v:Vertex)->@location(0) vec4<f32>{
 // Clip to this slab's XY tile; an out-of-volume footprint must not spill
 // into the neighboring depth tile in the atlas.
 let at=vec2<u32>(v.clip.xy);if(at.x/p.dims.x!=v.layer){discard;}
 let q=v.delta.x*v.delta.x*v.inverseXY.x+v.delta.y*v.delta.y*v.inverseXY.y+2.0*v.delta.x*v.delta.y*v.inverseXY.z;
 if(q>p.support.y*p.support.y){discard;}
 let mean=v.conditional.x+dot(v.conditional.yz,v.delta);let step=p.extent.z/f32(p.dims.z);let lo=f32(v.layer)*step;
 let scale=.70710678118/v.conditional.w;let fraction=max(0.0,.5*(erfApprox((lo+step-mean)*scale)-erfApprox((lo-mean)*scale)));
 return v.optical*(exp(-.5*q)*fraction);
}
`;
export const PARTICLE_LIGHT_SWEEP_WGSL=/* wgsl */`${PARAMS}
@group(0) @binding(0) var coefficients:texture_2d<f32>;
@group(0) @binding(1) var<storage,read> solid:array<u32>;
@group(0) @binding(2) var<storage,read_write> positive:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> negative:array<vec4<f32>>;
@group(0) @binding(4) var<uniform> p:Params;
fn halfEmission(c:vec4<f32>)->vec3<f32>{
 let tau=c.w*.5;
 // Avoid subtracting nearly equal f32 values in optically thin fine slabs.
 var factor=1.0-tau*.5+tau*tau/6.0-tau*tau*tau/24.0;
 if(tau>.01){factor=(1.0-exp(-tau))/tau;}
 return c.xyz*.5*factor;
}
@compute @workgroup_size(8,8) fn sweep(@builtin(global_invocation_id) gid:vec3<u32>){
 if(any(gid.xy>=p.dims.xy)){return;}
 var forward=vec3<f32>(0);var backward=vec3<f32>(0);var tf=1.0;var tb=1.0;
 for(var z=0u;z<p.dims.z;z++){
  let k=p.dims.z-1u-z;let i=gid.x+p.dims.x*(gid.y+p.dims.y*z);let j=gid.x+p.dims.x*(gid.y+p.dims.y*k);
  let a=textureLoad(coefficients,vec2<i32>(i32(gid.x+z*p.dims.x),i32(gid.y)),0);
  let b=textureLoad(coefficients,vec2<i32>(i32(gid.x+k*p.dims.x),i32(gid.y)),0);
  if(solid[i]>0u){forward=vec3<f32>(0);tf=0.0;positive[i]=vec4<f32>(0);}else{
   let t=exp(-a.w*.5);let e=halfEmission(a);let center=e+t*forward;positive[i]=vec4<f32>(center,tf*t);forward=e+t*center;tf*=t*t;
  }
  if(solid[j]>0u){backward=vec3<f32>(0);tb=0.0;negative[j]=vec4<f32>(0);}else{
   let t=exp(-b.w*.5);let e=halfEmission(b);let center=e+t*backward;negative[j]=vec4<f32>(center,tb*t);backward=e+t*center;tb*=t*t;
  }
 }
}
`;

export function createParticleLightSweep(device,input){
 const plan=particleLightPlan(input,device.limits),s=plan.settings;
 const params=device.createBuffer({label:'particle light sweep coordinates',size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const data=new ArrayBuffer(144),u=new Uint32Array(data),f=new Float32Array(data);u.set([...plan.dims,0]);
 [plan.origin,plan.extent,plan.u,plan.v,plan.direction,[s.gain,s.extinction,s.stateLife,s.lifeFade],[s.radius,s.stretch,s.flowAlignment,s.expansion],[s.supportFloor,s.supportSigmas,s.filterWidth,s.carrierMode]].forEach((a,i)=>f.set(a,4*(i+1)));device.queue.writeBuffer(params,0,data);
 const coefficients=device.createTexture({label:'particle Gaussian slab optical integrals',size:plan.atlas,format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
 const buffer=(label,stride)=>device.createBuffer({label,size:plan.cells*stride,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
 const solids=buffer('interior opaque-cell mask',4),positive=buffer('positive interior radiance and boundary transmission',16),negative=buffer('negative interior radiance and boundary transmission',16);
 const dm=device.createShaderModule({code:PARTICLE_LIGHT_DEPOSIT_WGSL}),sm=device.createShaderModule({code:PARTICLE_LIGHT_SWEEP_WGSL});
 const depositPipeline=device.createRenderPipeline({label:'particle intrinsic optical deposition',layout:'auto',vertex:{module:dm,entryPoint:'vs'},fragment:{module:dm,entryPoint:'fs',targets:[{format:'rgba16float',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]}});
 const sweepPipeline=device.createComputePipeline({label:'shared opposite particle light sweeps',layout:'auto',compute:{module:sm,entryPoint:'sweep'}});
 const sweepGroup=device.createBindGroup({layout:sweepPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:coefficients.createView()},{binding:1,resource:{buffer:solids}},{binding:2,resource:{buffer:positive}},{binding:3,resource:{buffer:negative}},{binding:4,resource:{buffer:params}}]});
 let disposed=false;
 return {plan,coefficients,solids,positive,negative,coordinates:params,
  deposit(encoder,{particles,slots},profileWrites=()=>({})){
   if(disposed)throw Error('Particle light sweep disposed');
   if(!Number.isSafeInteger(slots)||slots<0||slots*96>particles.size||slots*plan.dims[2]>0xffffffff)throw Error('Invalid full particle light population');
   const pass=encoder.beginRenderPass({label:'particle light slab deposition',...profileWrites('particleLightDeposit'),colorAttachments:[{view:coefficients.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
   if(slots){pass.setPipeline(depositPipeline);pass.setBindGroup(0,device.createBindGroup({layout:depositPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:1,resource:{buffer:params}}]}));pass.draw(6,slots*plan.dims[2]);}pass.end();
  },
  sweep(encoder,profileWrites=()=>({})){if(disposed)throw Error('Particle light sweep disposed');const pass=encoder.beginComputePass({label:'opposite interior light sweeps',...profileWrites('particleLightSweep')});pass.setPipeline(sweepPipeline);pass.setBindGroup(0,sweepGroup);pass.dispatchWorkgroups(Math.ceil(plan.dims[0]/8),Math.ceil(plan.dims[1]/8));pass.end();},
  dispose(){if(disposed)return;disposed=true;for(const r of [params,coefficients,solids,positive,negative])r.destroy();}
 };
}
