import {INTEGRAL_PRESENT_WGSL} from './volume-integral-reconstruction.mjs';

export function opticalParticleSettings(input={}) {
 const s={enabled:false,refresh:.18,depthSupport:2,radius:.4,stretch:2,gain:1,opacity:1,
  burnTime:8,cooling:10,heatRelease:.35,sootYield:.25,smokeLife:24,
  flow:1,rise:0,drag:4,expansion:0,...input};
 if(typeof s.enabled!=='boolean')throw Error('Particle enabled must be boolean');
 for(const [k,v] of Object.entries(s))if(k!=='enabled'&&(!Number.isFinite(v)||v<0||!Number.isFinite(Math.fround(v))))throw Error(`Invalid particle ${k}`);
 if(s.refresh>1||s.radius<=0||s.stretch<=0||s.burnTime<=0||s.cooling<=0||s.smokeLife<=0||s.drag<=0)throw Error('Particle fractions must be at most one and scales/lifetimes positive');
 return s;
}
export const PARTICLE_REACTION_WGSL=/* wgsl */`
// Finite visual reaction proxy: remaining potential, heat, soot production, burned.
// This is not inferred chemistry: intrinsic source emission initializes the proxy.
fn particleReact(state:vec4<f32>,dt:f32,burnTime:f32,cooling:f32,heatRelease:f32,sootYield:f32)->vec4<f32>{
 let burn=state.x*smoothstep(.15,.75,state.y)*(1.0-exp(-dt/burnTime));
 return vec4<f32>(max(0.0,state.x-burn),(state.y+heatRelease*burn)*exp(-dt/cooling),state.z+sootYield*burn,burn);
}
`;
const OPTIONS=/* wgsl */`
struct Particle {anchor:vec4<f32>, source:vec4<f32>, emission:vec4<f32>, motion:vec4<f32>, shape:vec4<f32>, state:vec4<f32>}
struct Options {vp:mat4x4<f32>, inverse:mat4x4<f32>, size:vec4<u32>, time:vec4<f32>, reaction:vec4<f32>, shape:vec4<f32>, transport:vec4<f32>, fine:vec4<f32>, gain:vec4<f32>}
struct SourceOptions {vp:mat4x4<f32>,size:vec4<u32>,policy:vec4<f32>,life:vec4<f32>,flow:vec4<f32>,worldLo:vec4<f32>,worldDims:vec4<f32>,worldMap:vec4<f32>,middleLo:vec4<f32>,middleDims:vec4<f32>,middleMap:vec4<f32>,arenaOffsets:vec4<u32>}
`;
export const PARTICLE_COMPUTE_WGSL=/* wgsl */`${OPTIONS}
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read> births:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> fine:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> source:SourceOptions;
@group(0) @binding(4) var<uniform> u:Options;
${PARTICLE_REACTION_WGSL}
fn hash32(x:u32)->u32{var h=x;h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);}
fn coarseVelocity(p:vec3<f32>,middle:bool)->vec3<f32>{
 let lo=select(source.worldLo,source.middleLo,middle);let dims=select(source.worldDims,source.middleDims,middle);let map=select(source.worldMap,source.middleMap,middle);
 if(dims.w<=0){return vec3<f32>(0);}
 let q=p*map.w+map.xyz;var result=vec3<f32>(0);
 for(var a=0u;a<3u;a++){
  var offset=vec3<f32>(.5);offset[a]=1;let cell=(q-lo.xyz)/lo.w-offset;let base=vec3<i32>(floor(cell));let f=fract(cell);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),vec3<i32>(dims.xyz)-1);let i=u32(c.x)+u32(dims.x)*(u32(c.y)+u32(dims.y)*u32(c.z));let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));
   result[a]+=births[select(source.arenaOffsets.z,source.arenaOffsets.w,middle)+i][a]*w.x*w.y*w.z;
  }}}
 }return result/map.w;
}
fn particleVelocity(p:vec3<f32>)->vec3<f32>{
 let dims=vec3<i32>(u.fine.xyz);let pitch=source.flow.z;
 if(all(p>=vec3<f32>(-1))&&all(p<=vec3<f32>(1,2.0*u.fine.y/u.fine.x-1.0,1))){
  var result=vec3<f32>(0);
  for(var a=0u;a<3u;a++){
   var offset=vec3<f32>(.5);if(source.flow.w>.5){offset[a]=1;}
   let cell=clamp((p+vec3<f32>(1))/pitch-offset,vec3<f32>(0),vec3<f32>(dims)-1.001);let base=vec3<i32>(floor(cell));let f=fract(cell);
   for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),dims-1);let i=u32(c.x+dims.x*(c.y+dims.y*c.z));let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));result[a]+=fine[4u*i][a]*w.x*w.y*w.z;
   }}}
  }return result*pitch;
 }
 let q=p*source.middleMap.w+source.middleMap.xyz;
 let middle=source.middleDims.w>.5&&all(q>=source.middleLo.xyz)&&all(q<source.middleLo.xyz+source.middleDims.xyz*source.middleLo.w);
 return coarseVelocity(p,middle);
}
@compute @workgroup_size(64) fn update(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=u.size.z){return;}var p=particles[i];let dt=u.time.x;
 if(p.anchor.w>0&&dt>0){
  let s=particleReact(p.state,dt,u.reaction.x,u.reaction.y,u.reaction.z,u.reaction.w);
  p.state=vec4<f32>(s.xy,s.z*exp(-dt/u.time.w),s.w);
  let damping=exp(-dt/u.transport.z);
  p.motion=vec4<f32>(p.motion.xyz*damping+vec3<f32>(0,u.transport.y*p.state.y*u.transport.z*(1.0-damping),0),0);
  p.anchor=vec4<f32>(p.anchor.xyz+particleVelocity(p.anchor.xyz)*dt*u.time.z*u.transport.x+p.motion.xyz*dt,p.anchor.w+dt);
 }
 // A bounded representation with one explicit slot per current fire-target pixel.
 // All source pixels participate. Refresh probability is an exposed policy, not
 // a hidden truncation of the source set. Weak source evaluations can replace slots.
 let at=4u*i;let q=births[at];let anchor=births[at+1u];
 let random=f32(hash32(i+u.size.w*1664525u))/4294967296.0;
 if((dt>0||u.size.w==1u)&&anchor.w>0&&max(length(q.xyz),q.w)>0&&(p.anchor.w<=0||random<u.time.y)){
  let support=births[at+2u];let emission=min(q.xyz,births[at+3u].xyz);
  let pitch=max(support.w,.00001);let burning=select(0.0,1.0,length(emission)>0.0);
  p.anchor=anchor;p.source=q;p.emission=vec4<f32>(emission,0);p.motion=vec4<f32>(0);
  p.shape=vec4<f32>(vec3<f32>(pitch),max(.00001,support.y-support.x));p.state=vec4<f32>(burning,burning,0,0);
 }
 particles[i]=p;
}
`;
const RENDER=/* wgsl */`${OPTIONS}
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<uniform> u:Options;
@group(0) @binding(2) var sceneDepth:DEPTH_TYPE;
struct Vertex {@builtin(position) clip:vec4<f32>,@location(0) local:vec2<f32>,@location(1) @interpolate(flat) light:vec3<f32>,@location(2) @interpolate(flat) tau:f32}
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) i:u32)->Vertex{
 let p=particles[i];var out:Vertex;
 if(p.anchor.w<=0){out.clip=vec4<f32>(2,2,2,1);return out;}
 let growth=1.0+u.transport.w*(select(0.0,1.0,length(p.emission.xyz)>0)-p.state.x);
 let radius=p.shape.xyz*u.shape.x*vec3<f32>(1,u.shape.y,1)*growth;
 var center=u.vp*vec4<f32>(p.anchor.xyz,1);var cxx=0.0;var cyy=0.0;var cxy=0.0;
 if(center.w<=.0001){out.clip=vec4<f32>(2,2,2,1);return out;}
 for(var a=0u;a<3u;a++){var delta=vec3<f32>(0);delta[a]=radius[a];let clip=u.vp*vec4<f32>(p.anchor.xyz+delta,1);let v=(clip.xy/clip.w-center.xy/center.w)*vec2<f32>(u.size.xy)*.5;cxx+=v.x*v.x;cyy+=v.y*v.y;cxy+=v.x*v.y;}
 let angle=.5*atan2(2.0*cxy,cxx-cyy);let axis=vec2<f32>(cos(angle),sin(angle));let disc=sqrt((cxx-cyy)*(cxx-cyy)+4.0*cxy*cxy);
 let major=sqrt(max(.25,(cxx+cyy+disc)*.5));let minor=sqrt(max(.25,(cxx+cyy-disc)*.5));
 let corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));let xy=corners[vertex]*2.5;
 let offset=axis*xy.x*major+vec2<f32>(-axis.y,axis.x)*xy.y*minor;center.x+=offset.x*2.0/f32(u.size.x)*center.w;center.y+=offset.y*2.0/f32(u.size.y)*center.w;if(u.gain.w<.5){center.z=(center.z+center.w)*.5;}
 out.clip=center;out.local=xy;
 let opacity=exp(-max(0.0,p.anchor.w-1.0)/u.time.w);
 let emission=p.emission.xyz*pow(max(0.0,p.state.y),4.0)*u.gain.x;
 out.light=(emission+max(vec3<f32>(0),p.source.xyz-p.emission.xyz)*opacity)*p.shape.w;
 // New soot has its own absorption even when the source had no extinction.
 out.tau=(p.source.w*opacity+p.state.z)*p.shape.w*u.gain.y;return out;
}
@fragment fn fs(v:Vertex)->@location(0) vec4<f32>{
 let pixel=clamp(vec2<i32>(v.clip.xy/vec2<f32>(u.size.xy)*vec2<f32>(textureDimensions(sceneDepth))),vec2<i32>(0),vec2<i32>(textureDimensions(sceneDepth))-1);var depth=DEPTH_LOAD;DEPTH_REDUCE
 if(v.clip.z>depth+.00001){discard;}
 let weight=exp(-.5*dot(v.local,v.local));return vec4<f32>(v.light,v.tau)*weight;
}
`;
const RESOLVE=/* wgsl */`
@group(0) @binding(0) var optics:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0)vec4<f32>{
 let at=vec2<i32>(p.xy);let v=textureLoad(optics,at,0);
 let trans=exp(-v.w);let scale=select(1.0,(1.0-trans)/max(v.w,1e-6),v.w>.00001);return vec4<f32>(v.xyz*scale,trans);
}
`;

export function createOpticalParticles(device,{transparent=false}={}) {
 const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const options=device.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const camera=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const compute=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_COMPUTE_WGSL}),entryPoint:'update'}});
 const present=new Map(),render=new Map();let particles=null,textures=[],key=null,frame=0,lastStep=null,info={effective:'off'};
 const retired=[];
 function retire(items){if(items.length)retired.push(...items);}
 function reset(){key=null;frame=0;info={effective:'off',reason:'reset'};}
 function encode(encoder,{view,format,source,fine,dims,invViewProj,settings,cameraValues,depth,identity,depthZeroToOne=false}){
  const s=opticalParticleSettings(settings),{width,height,pixels,step}=source;
  if(pixels*96>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error(`Particle population requires ${pixels*96} bytes; exceeds effective device binding capacity`);
  const nextKey=JSON.stringify([width,height,identity]);
  const resetNeeded=key!==nextKey||lastStep===null||step<lastStep;const dt=resetNeeded?0:step-lastStep;
  if(!particles||particles.size!==pixels*96){retire(particles?[particles]:[]);particles=device.createBuffer({label:'shared world optical material carriers',size:pixels*96,usage:storage});}
  if(!textures.length||textures[0].width!==width||textures[0].height!==height){retire(textures);textures=['rgba16float','rgba32float'].map(f=>device.createTexture({size:[width,height],format:f,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}));}
  if(resetNeeded){encoder.clearBuffer(particles);frame=0;}frame++;lastStep=step;key=nextKey;
  const data=new ArrayBuffer(240),f=new Float32Array(data),u=new Uint32Array(data);f.set(source.viewProj);f.set(invViewProj,16);u.set([width,height,pixels,frame],32);
  f.set([dt,s.refresh,source.backtrace,s.smokeLife],36);f.set([s.burnTime,s.cooling,s.heatRelease,s.sootYield],40);f.set([s.radius,s.stretch,0,0],44);f.set([s.flow,s.rise,s.drag,s.expansion],48);f.set([...dims,0],52);f.set([s.gain,s.opacity,0,depthZeroToOne?1:0],56);device.queue.writeBuffer(options,0,data);
  const c=encoder.beginComputePass({label:'particle finite reaction and native grid flow'});c.setPipeline(compute);c.setBindGroup(0,device.createBindGroup({layout:compute.getBindGroupLayout(0),entries:[particles,source.buffer,fine,source.uniform,options].map((buffer,binding)=>({binding,resource:{buffer}}))}));c.dispatchWorkgroups(Math.ceil(pixels/64));c.end();
  const ms=depth.sampleCount>1;let rp=render.get(ms);
  if(!rp){const code=RENDER.replace('DEPTH_TYPE',ms?'texture_depth_multisampled_2d':'texture_depth_2d').replace('DEPTH_LOAD','textureLoad(sceneDepth,pixel,0)').replace('DEPTH_REDUCE',ms?'for(var sample=1u;sample<textureNumSamples(sceneDepth);sample++){depth=min(depth,textureLoad(sceneDepth,pixel,sample));}':'');const module=device.createShaderModule({code});
   const blend={color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}};
   rp=device.createRenderPipeline({label:'anisotropic material carrier optical moments',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float',blend}]},primitive:{topology:'triangle-list'}});render.set(ms,rp);}
  const r=encoder.beginRenderPass({label:'spatial material support',colorAttachments:textures.slice(0,1).map(t=>({view:t.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}))});r.setPipeline(rp);r.setBindGroup(0,device.createBindGroup({layout:rp.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:1,resource:{buffer:options}},{binding:2,resource:depth.createView()}]}));r.draw(6,pixels);r.end();
  if(!resolvePipeline){const module=device.createShaderModule({code:RESOLVE});
  resolvePipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba32float'}]}});}
  const resolve=encoder.beginRenderPass({label:'material optical moment transfer',colorAttachments:[{view:textures[1].createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});resolve.setPipeline(resolvePipeline);resolve.setBindGroup(0,device.createBindGroup({layout:resolvePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:textures[0].createView()}]}));resolve.draw(3);resolve.end();
  let pp=present.get(format);if(!pp){const m=device.createShaderModule({code:INTEGRAL_PRESENT_WGSL});pp=device.createRenderPipeline({layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'present',constants:{TRANSPARENT_CANVAS:transparent},targets:[{format}]}});present.set(format,pp);}
  device.queue.writeBuffer(camera,0,cameraValues);
  const output=encoder.beginRenderPass({label:'native optical particle presentation',colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});output.setPipeline(pp);output.setBindGroup(0,device.createBindGroup({layout:pp.getBindGroupLayout(0),entries:[{binding:0,resource:textures[1].createView()},{binding:1,resource:{buffer:camera}}]}));output.draw(3);output.end();
  if(retired.length){const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy())));}
  info={requested:true,effective:'world-optical-particles',width,height,slots:pixels,bytes:particles.size+pixels*24,sourceBytes:source.buffer.size,totalBytes:particles.size+pixels*24+source.buffer.size,frames:frame,step,stepDelta:dt,settings:s,
   clipDepth:depthZeroToOne?'zero-to-one':'minus-one-to-one',source:'one fresh native local optical observation; separate intrinsic emission',flow:'current Fine/Middle/World grid velocity',reaction:'finite visual proxy seeded by intrinsic emission; no inferred fuel/oxygen',composition:'additive optical moments; approximate mixed-depth attenuation',generatedSmoke:'new reaction soot contributes absorption; carried source scattering uses birth illumination',reset:resetNeeded};return info;
 }
 let resolvePipeline=null;
 async function sample(){if(!particles||!frame||key===null)return {available:false,state:info};const epoch=frame,sourceKey=key,snapshot=structuredClone(info),p=particles,read=device.createBuffer({size:p.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(p,0,read,0,p.size);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);if(frame!==epoch||key!==sourceKey||particles!==p)throw Error('Particle readback became stale');return {available:true,state:snapshot,records:new Float32Array(read.getMappedRange().slice(0))};}finally{read.unmap();read.destroy();}}
 return {encode,reset,read:()=>info,sample,dispose(){retire([options,camera,...textures,...(particles?[particles]:[])]);const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy())));particles=null;textures=[];}};
}
