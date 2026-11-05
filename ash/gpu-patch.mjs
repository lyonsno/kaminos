import * as THREE from '../lib/three.webgpu.js';
import {patchLayout,seedPatch} from './gpu-plan.mjs';
import {createGpuAshFall} from './fall-gpu.mjs';
import {retainedVolume} from './fall-plan.mjs';
export const ASH_PATCH_WGSL=`
struct Params {dims:vec4<u32>,origin:vec4<f32>,contact:vec4<f32>,previous:vec4<f32>,mode:vec4<u32>}
struct Surface {cell:vec4<f32>}
@group(0) @binding(0) var<storage,read_write> density:array<f32>;
@group(0) @binding(1) var<storage,read> solid:array<u32>;
@group(0) @binding(2) var<storage,read_write> surface:array<Surface>;
@group(0) @binding(3) var<storage,read_write> draw:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> dispatch:array<atomic<u32>>;
@group(0) @binding(5) var<uniform> p:Params;
fn coord(i:u32)->vec3<u32>{return vec3<u32>(i%p.dims.x,(i/p.dims.x)%p.dims.y,i/(p.dims.x*p.dims.y));}
fn index(c:vec3<u32>)->u32{return c.x+p.dims.x*(c.y+p.dims.y*c.z);}
fn penetration(c:vec3<u32>)->f32{
 if(p.contact.w<=0.0){return 0.0;}
 let w=p.origin.xyz+(vec3<f32>(c)+vec3<f32>(.5))*p.origin.w;
 let d=p.contact.xyz-p.previous.xyz;let t=clamp(dot(w-p.previous.xyz,d)/max(dot(d,d),1e-12),0.0,1.0);
 return max(0.0,p.contact.w-length(w-(p.previous.xyz+t*d)))/p.origin.w;
}
@compute @workgroup_size(1) fn prepare(){
 let awake=atomicLoad(&dispatch[3])>0u||p.mode.z>0u;
 atomicStore(&dispatch[0],select(0u,(p.dims.w+63u)/64u,awake));atomicStore(&dispatch[1],1u);atomicStore(&dispatch[2],1u);atomicStore(&dispatch[3],0u);
 if(awake){atomicStore(&draw[1],0u);}
}
@compute @workgroup_size(64) fn exchange(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=p.dims.w){return;}let c=coord(i);let axis=p.mode.x;
 if(c[axis]%2u!=p.mode.y||c[axis]+1u>=p.dims[axis]){return;}
 var q=c;q[axis]+=1u;let j=index(q);if(solid[i]!=0u||solid[j]!=0u){return;}
 let a=density[i];let b=density[j];if(a==0.0&&b==0.0){return;}
 let pa=penetration(c);let pb=penetration(q);var transfer=0.0;
 if(pa>pb+1e-5){transfer=min(a,1.0-b);}else if(pb>pa+1e-5){transfer=-min(b,1.0-a);}
 else if(pa==0.0&&pb==0.0){
  if(axis==1u){transfer=-min(b,1.0-a);}else{let diff=a-b;if(abs(diff)>.5){transfer=sign(diff)*(abs(diff)-.5)*.5;}}
 }
 // Ignore non-representable changes, retaining the material exactly where it is.
 let nextA=a-transfer;let nextB=b+transfer;
 if(nextA!=a&&nextB!=b){density[i]=nextA;density[j]=nextB;atomicStore(&dispatch[3],1u);}
}
fn filled(c:vec3<i32>)->f32{
 if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(p.dims.xyz))){return 0.0;}
 let i=index(vec3<u32>(c));return select(density[i],1.0,solid[i]!=0u);
}
@compute @workgroup_size(64) fn compact(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=p.dims.w){return;}let amount=density[i];if(amount<=0.0){return;}
 let c=coord(i);let v=vec3<i32>(c);
 if(amount==1.0&&filled(v+vec3<i32>(1,0,0))==1.0&&filled(v-vec3<i32>(1,0,0))==1.0&&filled(v+vec3<i32>(0,1,0))==1.0&&filled(v-vec3<i32>(0,1,0))==1.0&&filled(v+vec3<i32>(0,0,1))==1.0&&filled(v-vec3<i32>(0,0,1))==1.0){return;}
 let slot=atomicAdd(&draw[1],1u);surface[slot].cell=vec4<f32>(vec3<f32>(c),amount);
}`;
export async function createGpuAshPatch({renderer,cellSize,bounds,solid}){
 if(!renderer?.backend?.isWebGPUBackend)throw Error('GPU ash requires the shared WebGPU renderer');
 const device=renderer.backend.device,p=patchLayout({cellSize,bounds}),{count,dims,origin}=p;
 if(solid.length!==count)throw Error('Collision mask shape differs from ash patch');
 for(const bytes of [count*4,count*16])if(bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Requested ash patch exceeds effective device buffer capacity; choose a coarser cell width or smaller patch');
 if(Math.ceil(count/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Requested ash patch exceeds dispatch dimension');
 const owned=[],buffer=(label,size,usage)=>{const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
 const attrs=[];let mesh,fall,disposed=false,steps=0,snapshots=0,lastContact=null,volume=0;
 try{
 const module=device.createShaderModule({label:'ash conservative voxel pair exchange',code:ASH_PATCH_WGSL});
 const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('; '));
 const layout=device.createBindGroupLayout({entries:[0,1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===1?'read-only-storage':'storage'}})).concat([{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}])});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const pipelines=await Promise.all(['prepare','exchange','compact'].map(entryPoint=>device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}})));
 const density=buffer('ash resident density',count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
 const collision=buffer('ash static kiln support',count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(collision,0,Uint32Array.from(solid));
 const dispatch=buffer('ash sleeping dispatch',16,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
 const args=buffer('ash indirect work args',12,GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST);
 const surfaceAttr=new THREE.StorageBufferAttribute(new Float32Array(count*4),4);renderer.backend.createStorageAttribute(surfaceAttr);attrs.push(surfaceAttr);
 const drawAttr=new THREE.IndirectStorageBufferAttribute(new Uint32Array([36,0,0,0,0]),1);renderer.backend.createIndirectStorageAttribute(drawAttr);attrs.push(drawAttr);
 const surface=renderer.backend.get(surfaceAttr).buffer,draw=renderer.backend.get(drawAttr).buffer;
 fall=await createGpuAshFall({renderer,layout:p,density,collision,wake:dispatch});
 const uniforms=[],groups=[];
 for(let phase=0;phase<6;phase++){
  const uniform=buffer('ash pair phase',80,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);uniforms.push(uniform);
  groups.push(device.createBindGroup({layout,entries:[density,collision,surface,draw,dispatch,uniform].map((b,binding)=>({binding,resource:{buffer:b}}))}));
 }
 const geometry=new THREE.BoxGeometry(1,1,1);geometry.setIndirect(drawAttr);
 const material=new THREE.MeshStandardNodeMaterial({color:0xb9b3a8,roughness:1});
 const {storage,instanceIndex,positionGeometry,vec3}=THREE.TSL;
 const cell=storage(surfaceAttr,'vec4',count).toReadOnly().element(instanceIndex);
 material.positionNode=positionGeometry.add(vec3(.5)).mul(vec3(1,cell.w,1)).add(cell.xyz).mul(cellSize).add(vec3(...origin));
 mesh=new THREE.Mesh(geometry,material);mesh.name='GPU accumulated ash';mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.castShadow=true;mesh.add(fall.root);
 const writeParams=(contact,previous,wake)=>{
  for(let phase=0;phase<6;phase++){
   const bytes=new ArrayBuffer(80),u=new Uint32Array(bytes),f=new Float32Array(bytes);
   u.set([...dims,count]);f.set([...origin,cellSize],4);f.set(contact??[0,0,0,0],8);f.set([...(previous??contact?.slice(0,3)??[0,0,0]),0],12);
   // Gravity, then X and Z, with disjoint even/odd pair phases.
   u.set([[1,0,2][Math.floor(phase/2)],phase%2,wake?1:0,0],16);device.queue.writeBuffer(uniforms[phase],0,bytes);
  }
 };
 const compactOnly=()=>{writeParams(null,null,true);const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipelines[0]);pass.setBindGroup(0,groups[0]);pass.dispatchWorkgroups(1);pass.end();const c=encoder.beginComputePass();c.setPipeline(pipelines[2]);c.setBindGroup(0,groups[0]);c.dispatchWorkgroups(Math.ceil(count/64));c.end();device.queue.submit([encoder.finish()]);device.queue.writeBuffer(dispatch,12,new Uint32Array([1]));};
 const check=()=>{if(disposed)throw Error('GPU ash patch disposed');};
 const readback=async()=>{check();snapshots++;const staging=buffer('explicit ash checkpoint readback',count*4+36,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  try{const e=device.createCommandEncoder();e.copyBufferToBuffer(density,0,staging,0,count*4);e.copyBufferToBuffer(draw,0,staging,count*4,20);e.copyBufferToBuffer(dispatch,0,staging,count*4+20,16);device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);const bytes=staging.getMappedRange();return {values:new Float32Array(bytes.slice(0,count*4)),visibleCells:new Uint32Array(bytes,count*4,5)[1],active:new Uint32Array(bytes,count*4+20,4)[3]!==0};}finally{staging.unmap();staging.destroy();owned.splice(owned.indexOf(staging),1);}};
 const upload=values=>{device.queue.writeBuffer(density,0,values);compactOnly();};
 return {root:mesh,layout:p,
  step(contact=null,source=null,timing=null){check();if(contact&&(!Array.isArray(contact)||contact.length!==4||!contact.every(Number.isFinite)||contact[3]<=0))throw Error('Invalid contact');
   const moved=JSON.stringify(contact)!==JSON.stringify(lastContact);writeParams(contact,lastContact?.slice(0,3),moved);lastContact=contact?.slice()??null;
   const e=device.createCommandEncoder();if(source)fall.encode(e,{...source,contact,timestampWrites:timing?{querySet:timing.querySet,beginningOfPassWriteIndex:timing.begin}:undefined});let pass=e.beginComputePass({label:'ash sleep admission',...(!source&&timing?{timestampWrites:{querySet:timing.querySet,beginningOfPassWriteIndex:timing.begin}}:{})});pass.setPipeline(pipelines[0]);pass.setBindGroup(0,groups[0]);pass.dispatchWorkgroups(1);pass.end();e.copyBufferToBuffer(dispatch,0,args,0,12);
   for(let phase=0;phase<6;phase++){pass=e.beginComputePass();pass.setPipeline(pipelines[1]);pass.setBindGroup(0,groups[phase]);pass.dispatchWorkgroupsIndirect(args,0);pass.end();}
   pass=e.beginComputePass({label:'ash visible surface',...(timing?{timestampWrites:{querySet:timing.querySet,endOfPassWriteIndex:timing.end}}:{})});pass.setPipeline(pipelines[2]);pass.setBindGroup(0,groups[0]);pass.dispatchWorkgroupsIndirect(args,0);pass.end();device.queue.submit([e.finish()]);steps++;
  },
  async deposit(input){const previous=await readback();const next=seedPatch(p,solid,input,previous.values);upload(next);volume+=input.volume;return this.read();},
  burst(value){fall.request(value);return this.read();},
  async snapshot(){const state=await readback(),air=await fall.snapshot();const pendingUnits=new Float32Array(new Uint32Array(air.state).buffer)[0];return {falling:air,seededVolume:volume,depositedVolume:state.values.reduce((a,b)=>a+b,0)*cellSize**3,retainedVolume:retainedVolume({density:state.values,parcels:air.particles,pendingUnits,cellSize})+air.queuedVolume,schema:'kaminos.gpu-ash-patch.v1',layout:p,values:Array.from(state.values),steps,volume:volume+air.requestedVolume,lastContact,visibleCells:state.visibleCells,active:state.active};},
  restore(state){check();if(state?.schema!=='kaminos.gpu-ash-patch.v1'||JSON.stringify(state.layout)!==JSON.stringify(p)||!Array.isArray(state.values)||state.values.length!==count||state.values.some((v,i)=>!Number.isFinite(v)||v<0||v>1||(solid[i]&&v!==0))||!Number.isSafeInteger(state.steps)||state.steps<0||!Number.isFinite(state.volume)||state.volume<0)throw Error('Invalid GPU ash checkpoint or mapping');
   if(typeof state.active!=='boolean'||(state.lastContact!==null&&(!Array.isArray(state.lastContact)||state.lastContact.length!==4||!state.lastContact.every(Number.isFinite)||state.lastContact[3]<=0)))throw Error('Invalid GPU ash continuation state');
   const values=Float32Array.from(state.values);if(state.falling)fall.validate(state.falling);const pending=state.falling?new Float32Array(new Uint32Array(state.falling.state).buffer)[0]:0;const actual=retainedVolume({density:values,parcels:state.falling?.particles??[],pendingUnits:pending,cellSize})+(state.falling?.queuedVolume??0);if(Math.abs(actual-state.volume)>Math.max(1e-9,state.volume*1e-4))throw Error('Checkpoint volume differs from retained material');if(state.falling&&(!Number.isFinite(state.seededVolume)||state.seededVolume<0||Math.abs(state.seededVolume+state.falling.requestedVolume-state.volume)>1e-8))throw Error('Checkpoint source ledger differs');
   upload(values);device.queue.writeBuffer(dispatch,12,new Uint32Array([state.active?1:0]));steps=state.steps;volume=state.seededVolume??state.volume;if(state.falling)fall.restore(state.falling);else fall.clear();lastContact=state.lastContact?.slice()??null;return this.read();},
  async profile({samples=24,contact=null,source=null,motion=false}={}){
   if(!Number.isSafeInteger(samples)||samples<1)throw Error('Invalid profiling sample count');
   if(!device.features.has('timestamp-query'))return {status:'unsupported',reason:'shared device lacks timestamp-query'};
   if(samples*2>4096)throw Error('Requested samples exceed WebGPU query-set capacity');
   const querySet=device.createQuerySet({type:'timestamp',count:samples*2}),resolved=buffer('ash timing resolve',samples*16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC),read=buffer('ash timing read',samples*16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
   try{for(let i=0;i<samples;i++){const pose=contact?.slice()??null;if(motion&&pose)pose[0]+=Math.sin(i*.4)*.3;this.step(pose,source,{querySet,begin:i*2,end:i*2+1});await device.queue.onSubmittedWorkDone();}const e=device.createCommandEncoder();e.resolveQuerySet(querySet,0,samples*2,resolved,0);e.copyBufferToBuffer(resolved,0,read,0,samples*16);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const times=new BigUint64Array(read.getMappedRange()),milliseconds=[];for(let i=0;i<samples;i++){if(times[i*2+1]<=times[i*2])throw Error('Invalid ash GPU timestamp interval');milliseconds.push(Number(times[i*2+1]-times[i*2])/1e6);}return {status:'measured',route:'shared-renderer GPU timestamps; solver, transport and surface compaction; excludes drawing',milliseconds,features:[...device.features]};}finally{read.unmap();querySet.destroy();for(const b of [resolved,read]){b.destroy();owned.splice(owned.indexOf(b),1);}}
  },
  read:()=>({backend:'webgpu-pair-exchange',surface:'gpu-compacted-indirect-cells',layout:p,steps,volume:volume+fall.read().requestedVolume,volumeMeaning:'total introduced, including airborne and pending',falling:fall.read(),explicitReadbacks:snapshots,runtimeReadbacks:0,allocatedBytes:fall.description.bytes+16+80+count*24+16+12+20+6*80,boundary:'closed local patch; no silent discard',lastContact}),
  dispose(){if(disposed)return;disposed=true;fall?.dispose();mesh?.removeFromParent();mesh?.geometry.dispose();mesh?.material.dispose();for(const a of attrs){if(renderer.backend.get(a).buffer)renderer.backend.destroyAttribute(a);}for(const b of owned)b.destroy();}
 };
 }catch(error){fall?.dispose();mesh?.geometry.dispose();mesh?.material.dispose();for(const a of attrs)if(renderer.backend.get(a).buffer)renderer.backend.destroyAttribute(a);for(const b of owned)b.destroy();throw error;}
}
