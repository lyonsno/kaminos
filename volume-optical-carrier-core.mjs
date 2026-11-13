import {CARRIER_DEFORMATION_WGSL} from './volume-carrier-deformation.mjs';

export function createOpticalCarrierSource(device){
 const uniform=device.createBuffer({label:'optical carrier grid coordinates',size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const buffer=device.createBuffer({label:'unused optical observation binding',size:64,usage:GPUBufferUsage.STORAGE});
 return {prepare({viewProj,step,backtrace,pitch,staggered,outputWidth,outputHeight,displayWidth,displayHeight,emitterBounds,coarsePresent}){
  const data=new ArrayBuffer(240),f=new Float32Array(data),u=new Uint32Array(data);f.set(viewProj);u.set([1,1,step,0],16);f.set([0,2,pitch,Number(staggered)],28);device.queue.writeBuffer(uniform,0,data);
  return {buffer,uniform,width:1,height:1,pixels:1,samples:0,configuredSamples:0,step,backtrace,viewProj,outputWidth,outputHeight,displayWidth,displayHeight,emitterBounds,world:coarsePresent?{omitted:true}:null};
 },dispose(){buffer.destroy();uniform.destroy();}};
}

export const CARRIER_DEFAULTS={carrierMode:0,carrierRate:128,carrierLifetime:60,carrierEaseIn:2,carrierEaseOut:10,carrierRotation:1,carrierStrain:1,carrierRelaxation:.02,carrierRefreshEvery:1,carrierPreserveAmount:true};
export function validateCarrierSettings(s){
 if(![0,1].includes(s.carrierMode)||typeof s.carrierPreserveAmount!=='boolean')throw Error('Invalid optical carrier mode or amount policy');
 for(const key of Object.keys(CARRIER_DEFAULTS))if(!['carrierMode','carrierPreserveAmount'].includes(key)&&(!Number.isFinite(s[key])||s[key]<0))throw Error('Invalid '+key);
 if(s.carrierLifetime<=0||!Number.isSafeInteger(s.carrierRefreshEvery)||s.carrierRefreshEvery<1)throw Error('Carrier lifetime and refresh interval must be positive');
 if(s.carrierMode&&s.capacity<1)throw Error('Optical carrier capacity must be a positive explicit count');
 return s;
}

// Derivatives of the same trilinear interpolant as center velocity. Staggered
// components use their own eight corners; no extra neighboring field queries.
export const CARRIER_CORE_WGSL=/* wgsl */`${CARRIER_DEFORMATION_WGSL}
struct CarrierShape {x:vec4<f32>,y:vec4<f32>,z:vec4<f32>}
@group(0) @binding(9) var<storage,read_write> carrierShapes:array<CarrierShape>;
struct CarrierOptions {lo:vec4<f32>,hi:vec4<f32>,life:vec4<f32>,deform:vec4<f32>,births:vec4<u32>}
@group(0) @binding(10) var<uniform> carrier:CarrierOptions;
struct CarrierJet {velocity:vec3<f32>,gradient:mat3x3<f32>}
fn carrierVelocityJet(p:vec3<f32>)->CarrierJet{
 let dims=vec3<i32>(u.fine.xyz);let pitch=source.flow.z;
 var result=CarrierJet(vec3<f32>(0),mat3x3<f32>(vec3<f32>(0),vec3<f32>(0),vec3<f32>(0)));
 for(var a=0u;a<3u;a++){
  var offset=vec3<f32>(.5);if(source.flow.w>.5){offset[a]=1;}
  let raw=(p+vec3<f32>(1))/pitch-offset;
  let cell=clamp(raw,vec3<f32>(0),vec3<f32>(dims)-1.001);let base=vec3<i32>(floor(cell));let f=fract(cell);
  let interior=select(vec3<f32>(0),vec3<f32>(1),raw>=vec3<f32>(0))*select(vec3<f32>(0),vec3<f32>(1),raw<=vec3<f32>(dims)-1.001);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let corner=vec3<i32>(x,y,z);let c=clamp(base+corner,vec3<i32>(0),dims-1);let i=u32(c.x+dims.x*(c.y+dims.y*c.z));
   let positive=corner==vec3<i32>(1);let w=select(1.0-f,f,positive);let sign=select(vec3<f32>(-1),vec3<f32>(1),positive);let v=fine[4u*i][a];
   result.velocity[a]+=v*w.x*w.y*w.z*pitch;
   result.gradient[0][a]+=v*sign.x*w.y*w.z*interior.x;
   result.gradient[1][a]+=v*w.x*sign.y*w.z*interior.y;
   result.gradient[2][a]+=v*w.x*w.y*sign.z*interior.z;
  }}}
 }return result;
}
fn carrierWindow(age:f32,lifetime:f32,easeIn:f32,easeOut:f32)->f32{
 var weight=1.0;if(easeIn>0){weight*=smoothstep(0.0,easeIn,age);}
 if(easeOut>0){weight*=smoothstep(0.0,easeOut,lifetime-age);}return weight;
}
struct CarrierMaterial {state:vec4<f32>,freshBurn:f32}
fn carrierGridMaterial(p:vec3<f32>)->CarrierMaterial{
 let dims=vec3<i32>(u.fine.xyz);let cell=clamp((p+vec3<f32>(1))/source.flow.z-vec3<f32>(.5),vec3<f32>(0),vec3<f32>(dims)-1.001);let base=vec3<i32>(floor(cell));let f=fract(cell);
 var result=CarrierMaterial(vec4<f32>(0),0.0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),dims-1);let i=u32(c.x+dims.x*(c.y+dims.y*c.z));
  let w=select(vec3<f32>(1)-f,f,vec3<bool>(x==1,y==1,z==1));let weight=w.x*w.y*w.z;
  let m=fine[4u*i+1u];let reacting=textureLoad(reactants,c,0).xy;
  result.state+=vec4<f32>(m.z,m.y,m.x,reacting.x)*weight;result.freshBurn+=reacting.y*weight;
 }}}result.state=max(result.state,vec4<f32>(0));result.freshBurn=max(result.freshBurn,0.0);return result;
}
@compute @workgroup_size(64) fn carrierUpdate(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=u.size.z){return;}let slots=u.size.z;
 let offset=(i+slots-carrier.births.x%slots)%slots;
 let count=carrier.births.y;let isBirth=count>0u&&(count>=slots||offset<count);
 var p=particles[i];var shape=carrierShapes[i];var elapsed=u.time.x*u.fine.w;
 if(isBirth){
  var sequence=carrier.births.x+offset;
  if(count>=slots){sequence+=((count-1u-offset)/slots)*slots;}
  let seed=hash32(sequence);let r=vec3<f32>(f32(hash32(seed)),f32(hash32(seed+1u)),f32(hash32(seed+2u)))/4294967296.0;
  let position=mix(carrier.lo.xyz,carrier.hi.xyz,r);
  p=Particle(vec4<f32>(position,1),vec4<f32>(0),vec4<f32>(0),vec4<f32>(0),vec4<f32>(source.flow.z,0,1,source.flow.z),vec4<f32>(0));
  shape=CarrierShape(vec4<f32>(1,0,0,0),vec4<f32>(0,1,0,0),vec4<f32>(0,0,1,0));
  elapsed=u.time.x*u.fine.w*(1.0-(f32(sequence-carrier.births.x)+.5)/f32(count));
 }
 if(p.anchor.w<=0){return;}
 let age=p.anchor.w-1.0+elapsed;
 if(age>=carrier.life.x||!particleInsideFine(p.anchor.xyz)){p.anchor.w=0;particles[i]=p;return;}
 let jet=carrierVelocityJet(p.anchor.xyz);
 let seconds=elapsed*u.time.z/u.fine.w;
 var deformation=mat3x3<f32>(shape.x.xyz,shape.y.xyz,shape.z.xyz);
 deformation=carrierDeformation(deformation,jet.gradient,seconds,carrier.deform.x,carrier.deform.y,carrier.deform.z);
 p.anchor=vec4<f32>(p.anchor.xyz+jet.velocity*seconds*u.transport.x,age+1.0);
 if(!particleInsideFine(p.anchor.xyz)){p.anchor.w=0;particles[i]=p;return;}
 if(isBirth||carrier.births.z>0u){
  let sampled=carrierGridMaterial(p.anchor.xyz);p.state=sampled.state;
  // Grid state is authoritative. This is not a second reaction law.
  p.emission=vec4<f32>(particleIntrinsic(p.state,sampled.freshBurn),p.state.x);
  p.source=vec4<f32>(0);
 }
 let fade=carrierWindow(age,carrier.life.x,carrier.life.y,carrier.life.z);
 p.motion.w=1.0-fade;
 particles[i]=p;
 carrierShapes[i]=CarrierShape(vec4<f32>(deformation[0],0),vec4<f32>(deformation[1],0),vec4<f32>(deformation[2],0));
}
`;

export function createOpticalCarrierCore(device,preamble){
 const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const uniform=device.createBuffer({label:'explicit optical carrier birth and deformation',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const pipeline=device.createComputePipeline({label:'source-born optical carriers; grid material and local deformation',layout:'auto',compute:{module:device.createShaderModule({code:preamble+CARRIER_CORE_WGSL}),entryPoint:'carrierUpdate'}});
 let shapes=null,clock=0,total=0,lastRefresh=null,receipt=null;
 const retire=buffer=>{if(buffer)queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>buffer.destroy()));};
 function reset(){clock=0;total=0;lastRefresh=null;receipt=null;}
 return {
  reset,get shapes(){return shapes;},read:()=>receipt,
  encode(encoder,{particles,slots,source,fine,reactants,options,thermal,settings:s,reset:clear,dt,profileWrites}){
   if(!source.emitterBounds)throw Error('Optical carriers need an admitted emitter support; no fallback ray acquisition is used');
   if(!shapes||shapes.size!==slots*48){retire(shapes);shapes=device.createBuffer({label:'retained optical carrier deformation axes',size:slots*48,usage});clear=true;}
   if(clear){reset();encoder.clearBuffer(shapes);}
   const nextClock=clock+dt*(source.reactionStepScale??1);let requested=s.birthsEnabled?Math.floor(nextClock*s.carrierRate)-Math.floor(clock*s.carrierRate):0;
   if(requested>0xffffffff||total+requested>0xffffffff)throw Error('Carrier birth sequence exceeds u32; reset the experiment to continue');
   const refresh=lastRefresh===null||source.step-lastRefresh>=s.carrierRefreshEvery;
   const data=new ArrayBuffer(80),f=new Float32Array(data),u=new Uint32Array(data);
   f.set(source.emitterBounds.lo);f.set(source.emitterBounds.hi,4);f.set([s.carrierLifetime,s.carrierEaseIn,s.carrierEaseOut,0],8);f.set([s.carrierRotation,s.carrierStrain,s.carrierRelaxation,0],12);u.set([total,requested,Number(refresh),0],16);
   device.queue.writeBuffer(uniform,0,data);
   if(dt>0){const pass=encoder.beginComputePass({label:'source-born optical carrier update',...profileWrites('update')});pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:2,resource:{buffer:fine}},{binding:3,resource:{buffer:source.uniform}},{binding:4,resource:{buffer:options}},{binding:7,resource:reactants.createView()},{binding:8,resource:{buffer:thermal}},{binding:9,resource:{buffer:shapes}},{binding:10,resource:{buffer:uniform}}]}));pass.dispatchWorkgroups(Math.ceil(slots/64));pass.end();clock=nextClock;total+=requested;if(refresh)lastRefresh=source.step;}
   receipt={mode:'emitter-support-box',requestedBirths:dt>0?requested:0,retainedBirths:dt>0?Math.min(requested,slots):0,totalBirths:total,clock,refresh:dt>0&&refresh,bytes:shapes.size+uniform.size,chemistry:false,exchange:false,rayAcquisition:false};return receipt;
  },dispose(){retire(shapes);retire(uniform);shapes=null;}
 };
}
