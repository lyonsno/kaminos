import * as THREE from '../lib/three.webgpu.js';
import {fallingLayout,sourceSettings,fallingGroupState} from './fall-plan.mjs';
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
export async function createGpuAshFall({renderer,layout,density,collision,wake,tileHeaders=null}){
 const device=renderer.backend.device,description=fallingLayout(layout),owned=[];let disposed=false,queuedVolume=0,requestedVolume=0;
 const {capacity}=description;const tiled=tileHeaders!==null;let airGroups,airArgs,visibleAttr,drawAttr;const extraAttrs=[];if(description.bytes>device.limits.maxStorageBufferBindingSize||description.bytes>device.limits.maxBufferSize)throw Error('Falling ash transport exceeds effective GPU buffer capacity');
 const attr=new THREE.StorageBufferAttribute(new Float32Array(capacity*8),8);renderer.backend.createStorageAttribute(attr);const particles=renderer.backend.get(attr).buffer;
 const make=(label,size,usage)=>{const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
 const state=make('ash retained source and airborne count',16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
 const uniform=make('ash falling source',80,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
 let root,geometry,material;try{
 let code=SHADER;
 if(tiled){
  const tiles=layout.tiles,groups=Math.ceil(capacity/64);
  visibleAttr=new THREE.StorageBufferAttribute(new Uint32Array(capacity),1);drawAttr=new THREE.IndirectStorageBufferAttribute(new Uint32Array([24,0,0,0,0]),1);extraAttrs.push(visibleAttr,drawAttr);
  renderer.backend.createStorageAttribute(visibleAttr);renderer.backend.createIndirectStorageAttribute(drawAttr);
  code=code.replace('@compute @workgroup_size(1) fn prepare_fall(){',`@group(0) @binding(6) var<storage,read_write> tiles:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> groupData:array<atomic<u32>>;
@group(0) @binding(8) var<storage,read_write> visible:array<u32>;
@group(0) @binding(9) var<storage,read_write> draw:array<atomic<u32>>;
fn wake_cell(i:u32){let c=vec3<u32>(i%p.dims.x,(i/p.dims.x)%p.dims.y,i/(p.dims.x*p.dims.y));let b=c/${tiles.width}u;let t=b.x+${tiles.dims[0]}u*(b.y+${tiles.dims[1]}u*b.z);atomicStore(&tiles[t*8u],1u);atomicStore(&tiles[t*8u+2u],1u);
 for(var axis=0u;axis<3u;axis++){for(var side=0u;side<2u;side++){var q=vec3<i32>(c);q[axis]+=select(-1,1,side==1u);if(all(q>=vec3<i32>(0))&&all(q<vec3<i32>(p.dims.xyz))){let n=vec3<u32>(q)/${tiles.width}u;let j=n.x+${tiles.dims[0]}u*(n.y+${tiles.dims[1]}u*n.z);atomicStore(&tiles[j*8u+2u],1u);}}}}
@compute @workgroup_size(1) fn prepare_fall(){`);
  code=code.replace('@group(0) @binding(4) var<storage,read_write> wake:array<atomic<u32>>;','').replace('atomicStore(&wake[3],1u);','wake_cell(i);');
  code=code.replace('atomicStore(&state[1],0u);atomicAdd(&state[2],1u);',`atomicStore(&state[1],0u);atomicAdd(&state[2],1u);atomicStore(&draw[1],0u);
 var need=u32(ceil(bitcast<f32>(atomicLoad(&state[0]))/8.0));var count=0u;
 for(var group=0u;group<${groups}u;group++){let a=atomicLoad(&groupData[group*2u]);let b=atomicLoad(&groupData[group*2u+1u]);let slots=min(64u,p.dims.w-group*64u);let occupied=countOneBits(a)+countOneBits(b);let free=slots-occupied;
 if(occupied>0u||(need>0u&&free>0u)){atomicStore(&groupData[${groups*2}u+count],group);count++;need-=min(need,free);}atomicStore(&groupData[group*2u],0u);atomicStore(&groupData[group*2u+1u],0u);}
 atomicStore(&groupData[${groups*3}u],count);atomicStore(&groupData[${groups*3+1}u],1u);atomicStore(&groupData[${groups*3+2}u],1u);`);
  code=code.replace('@builtin(global_invocation_id) gid:vec3<u32>','@builtin(workgroup_id) wg:vec3<u32>,@builtin(local_invocation_id) lane:vec3<u32>').replace('let i=gid.x;if(i>=p.dims.w)',`let group=atomicLoad(&groupData[${groups*2}u+wg.x]);let i=group*64u+lane.x;if(i>=p.dims.w)`);
  code=code.replace('atomicAdd(&state[1],1u);',`atomicOr(&groupData[group*2u+lane.x/32u],1u<<(lane.x%32u));let slot=atomicAdd(&state[1],1u);visible[slot]=i;atomicAdd(&draw[1],1u);`);
  // One packed storage/indirect buffer holds masks, group list and dispatch args.
  airGroups=make('ash airborne masks lists and dispatch',groups*12+16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);airArgs=make('ash airborne indirect dispatch',16,GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST);
 }
 const module=device.createShaderModule({code,label:'falling ash conservative deposition'});const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('; '));
 const bgl=device.createBindGroupLayout({entries:[0,1,2,3,...(tiled?[6,7,8,9]:[4])].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===1?'read-only-storage':'storage'}})).concat([{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}])});
 const pl=device.createPipelineLayout({bindGroupLayouts:[bgl]});const pipelines=await Promise.all(['prepare_fall','fall'].map(entryPoint=>device.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})));
 const group=device.createBindGroup({layout:bgl,entries:[density,collision,particles,state,wake,uniform,...(tiled?[tileHeaders,airGroups,renderer.backend.get(visibleAttr).buffer,renderer.backend.get(drawAttr).buffer]:[])].map((buffer,binding)=>({binding,resource:{buffer}})).filter(entry=>!tiled||entry.binding!==4)});
 // Two vec4 values per parcel: position/remaining mass, then velocity.
 const {storage,instanceIndex,positionGeometry,vec3}=THREE.TSL;
 const particleId=tiled?storage(visibleAttr,'uint',capacity).toReadOnly().element(instanceIndex):instanceIndex;
 const positions=storage(attr,'vec4',capacity*2).toReadOnly().element(particleId.mul(2));
 geometry=new THREE.OctahedronGeometry(1,0);
 material=new THREE.MeshStandardNodeMaterial({color:0xc6bfb3,roughness:1});
 material.positionNode=positionGeometry.mul(positions.w.greaterThan(0).select(layout.cellSize*.36,0)).add(positions.xyz);
 if(tiled)geometry.setIndirect(drawAttr);root=tiled?new THREE.Mesh(geometry,material):new THREE.InstancedMesh(geometry,material,capacity);root.name='Airborne ash';root.frustumCulled=false;root.castShadow=false;
 return {root,description,
  request(volume){if(!Number.isFinite(volume)||volume<=0)throw Error('Invalid ash burst volume');if(!Number.isFinite(requestedVolume+volume))throw Error('Ash source volume exceeds numeric range');if(!Number.isFinite(Math.fround((queuedVolume+volume)/layout.cellSize**3)))throw Error('Ash source budget exceeds GPU float capacity');queuedVolume+=volume;requestedVolume+=volume;},
  encode(encoder,{position,spread,dt=1/30,rate=0,contact=null,timestampWrites}={}){
   if(disposed)throw Error('Falling ash disposed');sourceSettings({position,spread,rate});if(!Number.isFinite(dt)||dt<=0)throw Error('Invalid ash timestep');
   const extra=rate*dt,addition=queuedVolume+extra;if(!Number.isFinite(Math.fround(addition/layout.cellSize**3)))throw Error('Ash source budget exceeds GPU float capacity');requestedVolume+=extra;queuedVolume=0;
   const bytes=new ArrayBuffer(80),u=new Uint32Array(bytes),f=new Float32Array(bytes);u.set([...layout.dims,capacity]);f.set([...layout.origin,layout.cellSize],4);f.set([...position,spread],8);f.set(contact??[0,0,0,0],12);f.set([dt,addition/layout.cellSize**3,0,0],16);device.queue.writeBuffer(uniform,0,bytes);
   let pass=encoder.beginComputePass({label:'ash source budget',...(timestampWrites?{timestampWrites}:{})});pass.setPipeline(pipelines[0]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
   if(tiled)encoder.copyBufferToBuffer(airGroups,Math.ceil(capacity/64)*12,airArgs,0,12);
   pass=encoder.beginComputePass({label:'ash airborne transport and deposition'});pass.setPipeline(pipelines[1]);pass.setBindGroup(0,group);if(tiled)pass.dispatchWorkgroupsIndirect(airArgs,0);else pass.dispatchWorkgroups(Math.ceil(capacity/64));pass.end();
  },
  async snapshot(){
   const b=make('explicit airborne ash checkpoint',description.bytes+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);try{const e=device.createCommandEncoder();e.copyBufferToBuffer(particles,0,b,0,description.bytes);e.copyBufferToBuffer(state,0,b,description.bytes,16);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=b.getMappedRange();return {schema:'kaminos.ash-fall.v1',capacity,particles:Array.from(new Float32Array(data.slice(0,description.bytes))),state:Array.from(new Uint32Array(data.slice(description.bytes))),queuedVolume,requestedVolume};}finally{b.unmap();b.destroy();owned.splice(owned.indexOf(b),1);}
  },
  validate(snapshot){if(snapshot?.schema!=='kaminos.ash-fall.v1'||snapshot.capacity!==capacity||!Array.isArray(snapshot.particles)||snapshot.particles.length!==capacity*8||snapshot.particles.some((v,i)=>!Number.isFinite(v)||(i%8===3&&v<0))||!Array.isArray(snapshot.state)||snapshot.state.length!==4||snapshot.state.some(v=>!Number.isInteger(v)||v<0||v>4294967295)||!Number.isFinite(snapshot.queuedVolume)||snapshot.queuedVolume<0||!Number.isFinite(snapshot.requestedVolume)||snapshot.requestedVolume<0)throw Error('Invalid falling ash checkpoint');const pending=new Float32Array(new Uint32Array(snapshot.state).buffer)[0];if(!Number.isFinite(pending)||pending<0)throw Error('Invalid pending ash checkpoint');},
  restore(snapshot){this.validate(snapshot);if(tiled){const {packed,visible}=fallingGroupState(snapshot.particles,capacity);device.queue.writeBuffer(airGroups,0,packed);device.queue.writeBuffer(renderer.backend.get(visibleAttr).buffer,0,visible);device.queue.writeBuffer(renderer.backend.get(drawAttr).buffer,0,new Uint32Array([24,visible.length,0,0,0]));}device.queue.writeBuffer(particles,0,Float32Array.from(snapshot.particles));device.queue.writeBuffer(state,0,Uint32Array.from(snapshot.state));queuedVolume=snapshot.queuedVolume;requestedVolume=snapshot.requestedVolume;},
  clear(){if(tiled){device.queue.writeBuffer(airGroups,0,new Uint32Array(Math.ceil(capacity/64)*3+4));device.queue.writeBuffer(renderer.backend.get(drawAttr).buffer,4,new Uint32Array([0]));}device.queue.writeBuffer(particles,0,new Float32Array(capacity*8));device.queue.writeBuffer(state,0,new Uint32Array(4));queuedVolume=0;requestedVolume=0;},
  async schedulingSnapshot(){if(!tiled)return {scheduling:'all allocated slots'};const size=airGroups.size,b=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(airGroups,0,b,0,size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const words=new Uint32Array(b.getMappedRange());return {scheduling:'occupied groups',allocatedGroups:Math.ceil(capacity/64),lastDispatchedGroups:words[Math.ceil(capacity/64)*3]};}finally{b.unmap();b.destroy();}},
  read:()=>({backend:'webgpu-ballistic-parcels',allocatedBytes:description.bytes+owned.reduce((n,b)=>n+b.size,0)+extraAttrs.reduce((n,a)=>n+a.array.byteLength,0),scheduling:tiled?'occupied-64-slot-groups; indirect live parcel draw':'all allocated slots',...description,requestedVolume,queuedVolume,runtimeReadbacks:0}),
  dispose(){if(disposed)return;disposed=true;root.removeFromParent();geometry.dispose();material.dispose();renderer.backend.destroyAttribute(attr);for(const a of extraAttrs)renderer.backend.destroyAttribute(a);for(const b of owned)b.destroy();}
 };
 }catch(error){geometry?.dispose();material?.dispose();renderer.backend.destroyAttribute(attr);for(const a of extraAttrs)renderer.backend.destroyAttribute(a);for(const b of owned)b.destroy();throw error;}
}
