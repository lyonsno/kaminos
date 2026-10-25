import * as THREE from '../lib/three.webgpu.js';
import {fallingLayout,sourceSettings} from './fall-plan.mjs';
const SHADER=`
struct Parcel {position:vec4<f32>,velocity:vec4<f32>}
struct Params {dims:vec4<u32>,origin:vec4<f32>,source:vec4<f32>,contact:vec4<f32>,clock:vec4<f32>}
@group(0) @binding(0) var<storage,read_write> density:array<atomic<u32>>;
@group(0) @binding(1) var<storage,read> solid:array<u32>;
@group(0) @binding(2) var<storage,read_write> parcels:array<Parcel>;
@group(0) @binding(3) var<storage,read_write> state:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> wake:array<atomic<u32>>;
@group(0) @binding(5) var<uniform> p:Params;
fn random(seed:u32)->f32{var h=seed;h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return f32(h^(h>>16u))/4294967296.0;}
fn index(c:vec3<u32>)->u32{return c.x+p.dims.x*(c.y+p.dims.y*c.z);}
fn take_budget()->f32{
 loop{let old=atomicLoad(&state[0]);let available=bitcast<f32>(old);if(available<=0.0){return 0.0;}
 let taken=min(available,8.0);let result=atomicCompareExchangeWeak(&state[0],old,bitcast<u32>(available-taken));if(result.exchanged){return taken;}}
}
fn put(i:u32,amount:f32)->f32{
 loop{let old=atomicLoad(&density[i]);let available=1.0-bitcast<f32>(old);if(available<=0.0){return 0.0;}
 let next=min(1.0,bitcast<f32>(old)+amount);let taken=next-bitcast<f32>(old);if(taken<=0.0||taken>amount){return 0.0;}
 let result=atomicCompareExchangeWeak(&density[i],old,bitcast<u32>(next));if(result.exchanged){atomicStore(&wake[3],1u);return taken;}}
}
@compute @workgroup_size(1) fn prepare_fall(){
 atomicStore(&state[0],bitcast<u32>(bitcast<f32>(atomicLoad(&state[0]))+p.clock.y));atomicStore(&state[1],0u);atomicAdd(&state[2],1u);
}
@compute @workgroup_size(64) fn fall(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=p.dims.w){return;}var parcel=parcels[i];var amount=parcel.position.w;
 if(amount==0.0){
  amount=take_budget();if(amount==0.0){return;}let seed=i+atomicLoad(&state[2])*747796405u;
  let angle=random(seed)*6.2831853;let r=sqrt(random(seed+13u))*p.source.w;
  parcel.position=vec4<f32>(p.source.xyz+vec3<f32>(cos(angle)*r,random(seed+27u)*p.origin.w,sin(angle)*r),amount);
  parcel.velocity=vec4<f32>((random(seed+31u)-.5)*.10,-.08,(random(seed+43u)-.5)*.10,0.0);
 }
 let dt=p.clock.x;let cell=p.origin.w;
 var pos=parcel.position.xyz;var velocity=parcel.velocity.xyz;
 velocity.y=max(-.8,velocity.y-2.0*dt);velocity=vec3<f32>(velocity.x*exp(-dt*2.0),velocity.y,velocity.z*exp(-dt*2.0));
 var nextPosition=pos+velocity*dt;
 let low=p.origin.xz+vec2<f32>(cell*.5);let high=p.origin.xz+vec2<f32>(p.dims.xz)*cell-vec2<f32>(cell*.5);
 let clipped=clamp(nextPosition.xz,low,high);nextPosition=vec3<f32>(clipped.x,nextPosition.y,clipped.y);
 if(p.contact.w>0.0&&distance(nextPosition,p.contact.xyz)<p.contact.w+cell*.3){
  let d=nextPosition-p.contact.xyz;let n=select(vec3<f32>(0,1,0),normalize(d),dot(d,d)>1e-12);
  nextPosition=p.contact.xyz+n*(p.contact.w+cell*.4);let clippedContact=clamp(nextPosition.xz,low,high);nextPosition=vec3<f32>(clippedContact.x,nextPosition.y,clippedContact.y);velocity=reflect(velocity,n)*.2;
 }
 let samples=max(1u,u32(ceil(distance(pos,nextPosition)/(cell*.45))));var hit=false;var hitCell=vec3<i32>(0);
 for(var n=1u;n<=samples;n++){
  let point=mix(pos,nextPosition,f32(n)/f32(samples));let c=vec3<i32>(floor((point-p.origin.xyz)/cell));
  if(c.y<0){hit=true;hitCell=vec3<i32>(c.x,0,c.z);break;}
  if(c.y>=i32(p.dims.y)){continue;}
  let within=all(c>=vec3<i32>(0))&&all(c<vec3<i32>(p.dims.xyz));if(!within){continue;}
  let j=index(vec3<u32>(c));if(solid[j]!=0u){hit=true;hitCell=c+vec3<i32>(0,1,0);break;}
  if(bitcast<f32>(atomicLoad(&density[j]))>0.0){hit=true;hitCell=c;break;}
 }
 if(hit){
  hitCell.x=clamp(hitCell.x,0,i32(p.dims.x)-1);hitCell.z=clamp(hitCell.z,0,i32(p.dims.z)-1);
  for(var y=max(0,hitCell.y);y<i32(p.dims.y)&&amount>0.0;y++){
   let j=index(vec3<u32>(u32(hitCell.x),u32(y),u32(hitCell.z)));if(solid[j]!=0u){continue;}amount-=put(j,amount);
  }
  if(amount>0.0){nextPosition=vec3<f32>(nextPosition.x,p.origin.y+f32(p.dims.y)*cell+cell*.5,nextPosition.z);velocity=vec3<f32>(0);}
 }
 parcel.position=vec4<f32>(nextPosition,max(0.0,amount));parcel.velocity=vec4<f32>(velocity,0);parcels[i]=parcel;
 if(amount>0.0){atomicAdd(&state[1],1u);}
}`;
export async function createGpuAshFall({renderer,layout,density,collision,wake}){
 const device=renderer.backend.device,description=fallingLayout(layout),owned=[];let disposed=false,queuedVolume=0,requestedVolume=0;
 const {capacity}=description;if(description.bytes>device.limits.maxStorageBufferBindingSize||description.bytes>device.limits.maxBufferSize)throw Error('Falling ash transport exceeds effective GPU buffer capacity');
 const attr=new THREE.StorageBufferAttribute(new Float32Array(capacity*8),8);renderer.backend.createStorageAttribute(attr);const particles=renderer.backend.get(attr).buffer;
 const make=(label,size,usage)=>{const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
 const state=make('ash retained source and airborne count',16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
 const uniform=make('ash falling source',80,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
 let root,geometry,material;try{
 const module=device.createShaderModule({code:SHADER,label:'falling ash conservative deposition'});const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('; '));
 const bgl=device.createBindGroupLayout({entries:[0,1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===1?'read-only-storage':'storage'}})).concat([{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}])});
 const pl=device.createPipelineLayout({bindGroupLayouts:[bgl]});const pipelines=await Promise.all(['prepare_fall','fall'].map(entryPoint=>device.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})));
 const group=device.createBindGroup({layout:bgl,entries:[density,collision,particles,state,wake,uniform].map((buffer,binding)=>({binding,resource:{buffer}}))});
 // Two vec4 values per parcel: position/remaining mass, then velocity.
 const {storage,instanceIndex,positionGeometry,vec3}=THREE.TSL;
 const positions=storage(attr,'vec4',capacity*2).toReadOnly().element(instanceIndex.mul(2));
 geometry=new THREE.OctahedronGeometry(1,0);
 material=new THREE.MeshStandardNodeMaterial({color:0xc6bfb3,roughness:1});
 material.positionNode=positionGeometry.mul(positions.w.greaterThan(0).select(layout.cellSize*.36,0)).add(positions.xyz);
 root=new THREE.InstancedMesh(geometry,material,capacity);root.name='Airborne ash';root.frustumCulled=false;root.castShadow=false;
 return {root,description,
  request(volume){if(!Number.isFinite(volume)||volume<=0)throw Error('Invalid ash burst volume');if(!Number.isFinite(requestedVolume+volume))throw Error('Ash source volume exceeds numeric range');if(!Number.isFinite(Math.fround((queuedVolume+volume)/layout.cellSize**3)))throw Error('Ash source budget exceeds GPU float capacity');queuedVolume+=volume;requestedVolume+=volume;},
  encode(encoder,{position,spread,dt=1/30,rate=0,contact=null,timestampWrites}={}){
   if(disposed)throw Error('Falling ash disposed');sourceSettings({position,spread,rate});if(!Number.isFinite(dt)||dt<=0)throw Error('Invalid ash timestep');
   const extra=rate*dt,addition=queuedVolume+extra;if(!Number.isFinite(Math.fround(addition/layout.cellSize**3)))throw Error('Ash source budget exceeds GPU float capacity');requestedVolume+=extra;queuedVolume=0;
   const bytes=new ArrayBuffer(80),u=new Uint32Array(bytes),f=new Float32Array(bytes);u.set([...layout.dims,capacity]);f.set([...layout.origin,layout.cellSize],4);f.set([...position,spread],8);f.set(contact??[0,0,0,0],12);f.set([dt,addition/layout.cellSize**3,0,0],16);device.queue.writeBuffer(uniform,0,bytes);
   let pass=encoder.beginComputePass({label:'ash source budget',...(timestampWrites?{timestampWrites}:{})});pass.setPipeline(pipelines[0]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
   pass=encoder.beginComputePass({label:'ash airborne transport and deposition'});pass.setPipeline(pipelines[1]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(capacity/64));pass.end();
  },
  async snapshot(){
   const b=make('explicit airborne ash checkpoint',description.bytes+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);try{const e=device.createCommandEncoder();e.copyBufferToBuffer(particles,0,b,0,description.bytes);e.copyBufferToBuffer(state,0,b,description.bytes,16);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=b.getMappedRange();return {schema:'kaminos.ash-fall.v1',capacity,particles:Array.from(new Float32Array(data.slice(0,description.bytes))),state:Array.from(new Uint32Array(data.slice(description.bytes))),queuedVolume,requestedVolume};}finally{b.unmap();b.destroy();owned.splice(owned.indexOf(b),1);}
  },
  validate(snapshot){if(snapshot?.schema!=='kaminos.ash-fall.v1'||snapshot.capacity!==capacity||!Array.isArray(snapshot.particles)||snapshot.particles.length!==capacity*8||snapshot.particles.some((v,i)=>!Number.isFinite(v)||(i%8===3&&v<0))||!Array.isArray(snapshot.state)||snapshot.state.length!==4||snapshot.state.some(v=>!Number.isInteger(v)||v<0||v>4294967295)||!Number.isFinite(snapshot.queuedVolume)||snapshot.queuedVolume<0||!Number.isFinite(snapshot.requestedVolume)||snapshot.requestedVolume<0)throw Error('Invalid falling ash checkpoint');const pending=new Float32Array(new Uint32Array(snapshot.state).buffer)[0];if(!Number.isFinite(pending)||pending<0)throw Error('Invalid pending ash checkpoint');},
  restore(snapshot){this.validate(snapshot);device.queue.writeBuffer(particles,0,Float32Array.from(snapshot.particles));device.queue.writeBuffer(state,0,Uint32Array.from(snapshot.state));queuedVolume=snapshot.queuedVolume;requestedVolume=snapshot.requestedVolume;},
  clear(){device.queue.writeBuffer(particles,0,new Float32Array(capacity*8));device.queue.writeBuffer(state,0,new Uint32Array(4));queuedVolume=0;requestedVolume=0;},
  read:()=>({backend:'webgpu-ballistic-parcels',...description,requestedVolume,queuedVolume,runtimeReadbacks:0}),
  dispose(){if(disposed)return;disposed=true;root.removeFromParent();geometry.dispose();material.dispose();renderer.backend.destroyAttribute(attr);for(const b of owned)b.destroy();}
 };
 }catch(error){geometry?.dispose();material?.dispose();renderer.backend.destroyAttribute(attr);for(const b of owned)b.destroy();throw error;}
}
