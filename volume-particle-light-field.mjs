// A held particle medium, once deposited, supplies both transport and camera.
import {createParticleLightSweep,particleLightPlan} from './volume-particle-light-sweep.mjs';
export const COMMON_LIGHT_PARAMS=/*wgsl*/`
struct World {dims:vec4<u32>,origin:vec4<f32>,extent:vec4<f32>}
struct Frame {dims:vec4<u32>,origin:vec4<f32>,extent:vec4<f32>,u:vec4<f32>,v:vec4<f32>,d:vec4<f32>,optical:vec4<f32>,shape:vec4<f32>,support:vec4<f32>}
`;
const SOURCE=/*wgsl*/`${COMMON_LIGHT_PARAMS}
@group(0) @binding(0) var atlas:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> medium:array<vec4<f32>>;
@group(0) @binding(2) var<uniform> w:World;
@compute @workgroup_size(64) fn convert(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;let n=w.dims.x*w.dims.y*w.dims.z;if(i>=n){return;}let x=i%w.dims.x;let y=(i/w.dims.x)%w.dims.y;let z=i/(w.dims.x*w.dims.y);medium[i]=textureLoad(atlas,vec2<i32>(i32(x+z*w.dims.x),i32(y)),0)/(w.extent.z/f32(w.dims.z));}
`;
const RESAMPLE=/*wgsl*/`${COMMON_LIGHT_PARAMS}
@group(0) @binding(0) var<storage,read> medium:array<vec4<f32>>;
@group(0) @binding(1) var outputAtlas:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> w:World;
@group(0) @binding(3) var<uniform> f:Frame;
@compute @workgroup_size(64) fn resample(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let n=f.dims.x*f.dims.y*f.dims.z;if(i>=n){return;}
 let c=vec3<u32>(i%f.dims.x,(i/f.dims.x)%f.dims.y,i/(f.dims.x*f.dims.y));let local=(vec3<f32>(c)+.5)/vec3<f32>(f.dims.xyz)*f.extent.xyz;
 let point=f.origin.xyz+f.u.xyz*local.x+f.v.xyz*local.y+f.d.xyz*local.z;let q=(point-w.origin.xyz)/w.extent.xyz;
 var value=vec4<f32>(0);if(all(q>=vec3<f32>(0))&&all(q<vec3<f32>(1))){let at=min(vec3<u32>(q*vec3<f32>(w.dims.xyz)),w.dims.xyz-vec3<u32>(1));value=medium[at.x+w.dims.x*(at.y+w.dims.y*at.z)]*(f.extent.z/f32(f.dims.z));}
 textureStore(outputAtlas,vec2<i32>(i32(c.x+c.z*f.dims.x),i32(c.y)),value);
}
`;
const ACCUMULATE=/*wgsl*/`${COMMON_LIGHT_PARAMS}
@group(0) @binding(0) var<storage,read> positive:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> negative:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> incident:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> w:World;
@group(0) @binding(4) var<uniform> f:Frame;
fn at(c:vec3<i32>,reverse:bool)->vec3<f32>{let p=vec3<u32>(clamp(c,vec3<i32>(0),vec3<i32>(f.dims.xyz)-vec3<i32>(1)));let i=p.x+f.dims.x*(p.y+f.dims.y*p.z);if(reverse){return negative[i].xyz;}return positive[i].xyz;}
fn value(q:vec3<f32>,reverse:bool)->vec3<f32>{let base=vec3<i32>(floor(q));let t=fract(q);var total=vec3<f32>(0);for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){let s=vec3<i32>(x,y,z);let a=select(vec3<f32>(1)-t,t,s==vec3<i32>(1));total+=at(base+s,reverse)*a.x*a.y*a.z;}}}return total;}
@compute @workgroup_size(64) fn accumulate(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let n=w.dims.x*w.dims.y*w.dims.z;if(i>=n){return;}
 let c=vec3<u32>(i%w.dims.x,(i/w.dims.x)%w.dims.y,i/(w.dims.x*w.dims.y));let point=w.origin.xyz+(vec3<f32>(c)+.5)/vec3<f32>(w.dims.xyz)*w.extent.xyz;
 let delta=point-f.origin.xyz;let q=vec3<f32>(dot(delta,f.u.xyz),dot(delta,f.v.xyz),dot(delta,f.d.xyz))/f.extent.xyz*vec3<f32>(f.dims.xyz)-.5;
 incident[i]+=vec4<f32>((value(q,false)+value(q,true))*f.support.w,0);
}
`;
export function particleDirectionPairs(count){
 if(!Number.isSafeInteger(count)||count<2||count%2)throw Error('Direction count must be a positive even integer');
 return Array.from({length:count/2},(_,i)=>{const z=(i+.5)/(count/2),r=Math.sqrt(1-z*z),phi=i*Math.PI*(3-Math.sqrt(5));return [r*Math.cos(phi),r*Math.sin(phi),z];});
}
export function directionalLightFrame({dims,origin,extent,direction}){
 const basis=particleLightPlan({dims,origin,extent,direction},{maxTextureDimension2D:0xffffffff,maxBufferSize:Number.MAX_SAFE_INTEGER,maxStorageBufferBindingSize:Number.MAX_SAFE_INTEGER});
 const center=origin.map((v,i)=>v+extent[i]/2),axes=[basis.u,basis.v,basis.direction],dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),span=axes.map(a=>a.reduce((n,x,i)=>n+Math.abs(x)*extent[i],0));
 // Each oriented box encloses all eight corners of the same physical domain.
 const corner=center.map((v,i)=>v-axes.reduce((n,a,j)=>n+a[i]*span[j]/2,0));
 return {...basis,origin:corner,extent:span};
}
const uniform=(device,data,label)=>{const b=device.createBuffer({label,size:data.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});device.queue.writeBuffer(b,0,data);return b;};
function worldUniform(device,{dims,origin,extent}){const a=new ArrayBuffer(48);new Uint32Array(a).set(dims);const f=new Float32Array(a);f.set(origin,4);f.set(extent,8);return uniform(device,a,'common particle optical grid');}
function frameUniform(device,frame,weight){const a=new ArrayBuffer(144);new Uint32Array(a).set(frame.dims);const f=new Float32Array(a);[frame.origin,frame.extent,frame.u,frame.v,frame.direction].forEach((v,i)=>f.set(v,4*(i+1)));f[35]=weight;return uniform(device,a,'weighted light direction pair');}
const fieldKernels=new WeakMap();
function kernel(device,code,entryPoint,onProgress){
 let cache=fieldKernels.get(device);if(!cache){cache=new Map();fieldKernels.set(device,cache);}
 let value=cache.get(entryPoint);onProgress({phase:value?'prepare':'compile',detail:entryPoint});
 if(!value){value=(async()=>{const module=device.createShaderModule({code});const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(entryPoint+': '+errors.map(m=>m.lineNum+': '+m.message).join('\n'));return device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});})();cache.set(entryPoint,value);value.catch(()=>{if(cache.get(entryPoint)===value)cache.delete(entryPoint);});}
 return value;
}
function abortable(promise,signal){
 if(!signal)return promise;signal.throwIfAborted();
 return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
export async function createParticleIncidentField(device,{dims,origin,extent,transportWidth=dims[0],directionCount=24,pairs=particleDirectionPairs(directionCount),medium,particles,slots,settings={},filterLength=.125,signal,onProgress=()=>{}}){
 const resources=[];let scratch,deposit;
 signal?.throwIfAborted();
 try{
  const base=particleLightPlan({dims,origin,extent,direction:[0,0,1],settings},device.limits);
  if(!Number.isSafeInteger(transportWidth)||transportWidth<1||!pairs.length||!Number.isFinite(filterLength)||filterLength<0)throw Error('Invalid angular field plan');
  const frames=pairs.map(direction=>directionalLightFrame({dims:[transportWidth,transportWidth,transportWidth],origin,extent,direction}));
  const n=base.cells,buffer=(label)=>{const b=device.createBuffer({label,size:n*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});resources.push(b);return b;},source=buffer('particle optical coefficients per world length'),incident=buffer('current angular mean incident radiance');
  const w=worldUniform(device,base);resources.push(w);
  const constants=frames.map(f=>frameUniform(device,f,1/(pairs.length*2)));resources.push(...constants);
  scratch=createParticleLightSweep(device,frames[0],onProgress);
  const pipeline=(code,entryPoint)=>kernel(device,code,entryPoint,onProgress);
  const [resample,accumulate]=await abortable(Promise.all([pipeline(RESAMPLE,'resample'),pipeline(ACCUMULATE,'accumulate')]),signal);
  signal?.throwIfAborted();
  const group=(p,entries)=>device.createBindGroup({layout:p.getBindGroupLayout(0),entries:entries.map((resource,binding)=>({binding,resource:typeof resource.mapAsync==='function'?{buffer:resource}:resource}))});
  const resampleGroups=constants.map(f=>group(resample,[source,scratch.coefficients.createView(),w,f])),accumulateGroups=constants.map(f=>group(accumulate,[scratch.positive,scratch.negative,incident,w,f]));
  let convert,convertGroup;
  if(medium){if(!(medium instanceof Float32Array)||medium.length!==n*4||!medium.every(v=>Number.isFinite(v)&&v>=0))throw Error('Invalid complete optical medium');device.queue.writeBuffer(source,0,medium);}
  else{
   if(!particles||!Number.isSafeInteger(slots)||slots<1)throw Error('Particle source or explicit complete medium required');
   const pitch=extent[0]/dims[0];if(Math.abs(extent[1]/dims[1]-pitch)>1e-8)throw Error('Particle source deposition requires equal transverse pitches');
   deposit=createParticleLightSweep(device,{dims,origin,extent,direction:[0,0,1],settings:{...settings,filterWidth:filterLength/pitch}});
   convert=await abortable(pipeline(SOURCE,'convert'),signal);signal?.throwIfAborted();convertGroup=group(convert,[deposit.coefficients.createView(),source,w]);
  }
  let disposed=false;
  const plan={dims,origin,extent,transportWidth,directionCount:pairs.length*2,weightSum:1,frames,settings:deposit?.plan.settings??base.settings,filterLength,source:'held intrinsic emission and current extinction; captured scattered light excluded',medium:'common piecewise-constant particle-deposited optical coefficients',angular:'equal-area antipodal hemisphere quadrature; incident stores spherical mean, normalized by4pi',spatial:'midpoint oriented cell sampling; trilinear incident reconstruction at world receivers',geometry:'open volume, no external solid geometry'};
  return {plan,medium:source,incident,
   encode(encoder){if(disposed)throw Error('Particle incident field disposed');if(deposit){deposit.deposit(encoder,{particles,slots});const p=encoder.beginComputePass();p.setPipeline(convert);p.setBindGroup(0,convertGroup);p.dispatchWorkgroups(Math.ceil(n/64));p.end();}
    encoder.clearBuffer(incident);for(let i=0;i<frames.length;i++){
     encoder.copyBufferToBuffer(constants[i],0,scratch.coordinates,0,144);let p=encoder.beginComputePass({label:'oriented common-medium optical sampling'});p.setPipeline(resample);p.setBindGroup(0,resampleGroups[i]);p.dispatchWorkgroups(Math.ceil(transportWidth**3/64));p.end();scratch.sweep(encoder);
     p=encoder.beginComputePass({label:'full-sphere receiver reconstruction'});p.setPipeline(accumulate);p.setBindGroup(0,accumulateGroups[i]);p.dispatchWorkgroups(Math.ceil(n/64));p.end();
    }
   },
   dispose(){if(disposed)return;disposed=true;scratch.dispose();deposit?.dispose();resources.forEach(r=>r.destroy());}
  };
 }catch(e){scratch?.dispose();deposit?.dispose();resources.forEach(r=>r.destroy());throw e;}
}
