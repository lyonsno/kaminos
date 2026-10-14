import {createChunkIntegration} from './dist/structural-material-chunk-integration.js';
import {disposeAll} from './structural-material-disposal.mjs';

export const COHERENT_TRANSLATION_ROUTE='kaminos.stone.detached-translation.webgpu.v1';
export const coherentTranslationWgsl=`
struct Point{rest:vec4f,position:vec4f,velocity:vec4f,predicted:vec4f};
struct Input{counts:vec4u,time:vec4f};
@group(0) @binding(0) var<storage,read_write> points:array<Point>;
@group(0) @binding(1) var<storage,read> roots:array<u32>;
@group(0) @binding(2) var<storage,read_write> local:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> links:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> centers:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> velocities:array<vec4f>;
@group(0) @binding(6) var<storage,read> changes:array<u32>;
@group(0) @binding(7) var<storage,read> inertial:array<vec4f>;
@group(0) @binding(8) var<uniform> input:Input;
fn refresh()->bool{return input.counts.z==1u||changes[0]!=0u;}
@compute @workgroup_size(64) fn clearLinks(@builtin(global_invocation_id) id:vec3u){if(id.x<input.counts.x&&refresh()){atomicStore(&links[id.x],0xffffffffu);}}
@compute @workgroup_size(64) fn linkMembers(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i<input.counts.x&&refresh()){let old=atomicExchange(&links[roots[i]],i);atomicStore(&links[input.counts.x+i],old);}}
@compute @workgroup_size(64) fn aggregate(@builtin(global_invocation_id) id:vec3u){
 let root=id.x;if(root>=input.counts.x||!refresh()){return;}
 centers[root]=vec4f(0);velocities[root]=vec4f(0);var node=atomicLoad(&links[root]);var count=0u;var mass=0.0;var center=vec3f(0);var velocity=vec3f(0);var blocked=false;
 loop{if(node==0xffffffffu){break;}let p=points[node];blocked=blocked||p.velocity.w==1.0;mass+=p.rest.w;center+=p.rest.w*p.position.xyz;velocity+=p.rest.w*p.velocity.xyz;count++;node=atomicLoad(&links[input.counts.x+node]);}
 if(input.counts.y!=0xffffffffu){blocked=blocked||roots[input.counts.y]==root;}
 if(blocked||count<2u){return;}centers[root]=vec4f(center/mass,1.0/mass);velocities[root]=vec4f(velocity/mass,0);
}
@compute @workgroup_size(64) fn capture(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=input.counts.x||!refresh()){return;}let root=roots[i];let owned=centers[root].w>0.0;
 local[i]=vec4f(points[i].position.xyz-centers[root].xyz,select(0.0,f32(root+1u),owned));points[i].predicted.w=select(0.0,2.0,owned);
}
@compute @workgroup_size(64) fn damp(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i<input.counts.x&&centers[i].w>0.0){velocities[i]=vec4f(velocities[i].xyz*input.time.z,0);}}
@compute @workgroup_size(64) fn commit(@builtin(global_invocation_id) id:vec3u){let root=id.x;if(root>=input.counts.x||centers[root].w==0.0){return;}let next=inertial[root*4u];velocities[root]=vec4f((next.xyz-centers[root].xyz)/input.time.x,0);centers[root]=next;}
@compute @workgroup_size(64) fn publish(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=input.counts.x||local[i].w==0.0){return;}let root=u32(local[i].w)-1u;points[i].position=vec4f(centers[root].xyz+local[i].xyz,points[i].position.w);points[i].velocity=vec4f(velocities[root].xyz,points[i].velocity.w);points[i].predicted=vec4f(points[i].position.xyz,2);}
@compute @workgroup_size(64) fn floorResponse(@builtin(global_invocation_id) id:vec3u){
 let root=id.x;if(root>=input.counts.x||centers[root].w==0.0){return;}var node=atomicLoad(&links[root]);var lift=0.0;var chosen=0xffffffffu;var velocity=velocities[root].xyz;
 loop{if(node==0xffffffffu){break;}let p=points[node];let delta=p.position.y-centers[root].y-local[node].y;
  if(delta>lift||(delta==lift&&node<chosen&&any(p.velocity.xyz!=velocities[root].xyz))){lift=delta;chosen=node;velocity=p.velocity.xyz;}
  node=atomicLoad(&links[input.counts.x+node]);}
 centers[root].y+=max(0.0,lift);if(chosen!=0xffffffffu){velocities[root]=vec4f(velocity,0);}
}
`;

export async function createGpuCoherentTranslation(renderer,resident,grip){
 if(renderer.backend.device!==resident.device||!grip.componentBuffer||!grip.changeBuffer)throw Error('Shared native device and resident component ownership required');
 const device=resident.device,n=resident.submittedState().model.points,owned=[];let integration;
 const allocate=(label,size,usage)=>{if(size>device.limits.maxStorageBufferBindingSize)throw Error(`${label} exceeds effective storage capacity`);const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
 try{
  integration=await createChunkIntegration(renderer,n);
  const local=allocate('Acquired chunk shape',n*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),links=allocate('Complete chunk member lists',n*8,GPUBufferUsage.STORAGE),uniform=allocate('Chunk handoff command',32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const shader=device.createShaderModule({code:coherentTranslationWgsl}),info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(info.messages));
  const layout=device.createBindGroupLayout({entries:Array.from({length:9},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===8?'uniform':[1,6,7].includes(binding)?'read-only-storage':'storage'}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  for(const entryPoint of ['clearLinks','linkMembers','aggregate','capture','damp','commit','publish','floorResponse'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:shader,entryPoint}});
  const buffers=[resident.stateBuffer(),grip.componentBuffer,local,links,integration.buffers.positions,integration.buffers.velocities,grip.changeBuffer,integration.buffers.inertial,uniform],group=device.createBindGroup({layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  let anchor=null,first=true,disposed=false;
  const configure=(settings,force=false)=>{const next=resident.submittedState().grip,selected=next?.index===-3?next.anchor:next?.index>=0?next.index:null;if(next?.index===-2)throw Error('Translation handoff requires resident component grip, not a host patch');const bytes=new ArrayBuffer(32);new Uint32Array(bytes,0,4).set([n,selected??0xffffffff,Number(force||first||anchor!==selected),0]);new Float32Array(bytes,16,4).set([settings.timeStep,settings.gravity,settings.damping,0]);device.queue.writeBuffer(uniform,0,bytes);anchor=selected;first=false;};
  const run=names=>{if(disposed)throw Error('Chunk transport disposed');const encoder=device.createCommandEncoder();for(const name of names){const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();}device.queue.submit([encoder.finish()]);};
  return{route:COHERENT_TRANSLATION_ROUTE,motion:'translation-only',sourceRevision:integration.sourceRevision,
   prepare(settings){configure(settings);run(['clearLinks','linkMembers','aggregate','capture']);},
   advance(settings){configure(settings);run(['damp']);integration.step(settings.timeStep,settings.gravity);run(['commit','publish']);},
   afterFloor(){run(['floorResponse','publish']);},
   async read(){const read=device.createBuffer({size:n*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(local,0,read,0,local.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);return{route:COHERENT_TRANSLATION_ROUTE,motion:'translation-only',ownership:Array.from(new Float32Array(read.getMappedRange())),readbackBytes:local.size};}finally{read.destroy();}},
   dispose(){if(disposed)return;disposed=true;disposeAll([()=>integration.dispose(),...owned.map(b=>()=>b.destroy())],'Chunk transport cleanup failed');}
  };
 }catch(error){disposeAll([()=>integration?.dispose(),...owned.map(b=>()=>b.destroy())],'Chunk transport initialization failed',error);}
}
