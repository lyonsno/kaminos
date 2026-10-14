export const boundedGripWgsl=`
override supportAware:bool=false;
struct Point{rest:vec4f,position:vec4f,velocity:vec4f,predicted:vec4f};
struct Input{counts:vec4u,center:vec4f,travel:vec4f,time:vec4u};
@group(0) @binding(0) var<storage,read> points:array<Point>;
@group(0) @binding(1) var<storage,read> bonds:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> diagnostics:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> parents:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> previous:array<u32>;
@group(0) @binding(5) var<storage,read_write> weights:array<f32>;
@group(0) @binding(6) var<storage,read_write> control:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> transitions:array<vec2u>;
@group(0) @binding(8) var<uniform> input:Input;
fn changed()->bool{return input.counts.w!=0u||atomicLoad(&control[0])!=0u;}
fn root(node:u32)->u32{var i=node;loop{let next=atomicLoad(&parents[i]);if(next==i){return i;}i=next;}}
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) id:vec3u){if(id.x==0u){atomicStore(&control[0],0u);}}
@compute @workgroup_size(64) fn changes(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=input.counts.y){return;}let alive=select(bonds[i].z,bonds[i].w,supportAware);let signature=select(alive,bonds[i].z|(alive<<1u),supportAware);let old=previous[i];if(signature!=old){atomicAdd(&control[0],1u);previous[i]=signature;let oldAlive=select(old,old>>1u,supportAware);if(alive!=oldAlive){if(alive==0u){transitions[i]=vec2u(input.time.x+1u,bitcast<u32>(input.travel.w));}else{transitions[i]=vec2u(0);}}}}
@compute @workgroup_size(64) fn initialize(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i<input.counts.x&&changed()){atomicStore(&parents[i],i);}}
@compute @workgroup_size(64) fn unite(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=input.counts.y||!changed()||bonds[i].z!=1u){return;}let edge=bonds[i];
 // Atomic roots only point downward; retries preserve complete connectivity.
 loop{let a=root(edge.x);let b=root(edge.y);if(a==b){return;}let high=max(a,b);let low=min(a,b);
  let joined=atomicCompareExchangeWeak(&parents[high],high,low);if(joined.exchanged){return;}}
}
@compute @workgroup_size(64) fn compress(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i<input.counts.x&&changed()){atomicStore(&parents[i],root(i));}}
@compute @workgroup_size(64) fn selectWeights(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=input.counts.x||!changed()||input.counts.w==2u){return;}var w=0.0;
 if(points[i].velocity.w!=1.0&&atomicLoad(&parents[i])==atomicLoad(&parents[input.counts.z])){
  if(input.counts.w==1u){let r=length(points[i].position.xyz-input.center.xyz)/input.center.w;if(r<1.0){w=(1.0-r*r)*(1.0-r*r);}}
  else{w=diagnostics[i*6u+5u].w;}}
 weights[i]=w;
}
var<workgroup> sums:array<f32,256>;
@compute @workgroup_size(256) fn sumWeights(@builtin(local_invocation_index) lane:u32){
 var value=0.0;for(var i=lane;i<input.counts.x;i+=256u){value+=weights[i];}sums[lane]=value;workgroupBarrier();
 for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){sums[lane]+=sums[lane+stride];}workgroupBarrier();}
 if(lane==0u&&changed()&&input.counts.w!=2u){diagnostics[arrayLength(&diagnostics)-1u]=vec4f(input.travel.xyz,sums[0]);}
}
@compute @workgroup_size(64) fn capture(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=input.counts.x||!changed()||input.counts.w==2u){return;}let total=diagnostics[arrayLength(&diagnostics)-1u].w;
 var w=0.0;if(total>0.0){w=weights[i]/total;}diagnostics[i*6u+5u]=vec4f(points[i].position.xyz,w);
}
`;

export async function createBoundedResidentGrip(resident,initialBonds,{connectionBuffer=resident.bondBuffer(),supportAware=false}={}){
 const device=resident.device,model=resident.submittedState().model,n=model.points,b=model.bonds,owned=[];
 const allocate=(label,size,usage)=>{const buffer=device.createBuffer({label,size,usage});owned.push(buffer);return buffer;};
 try{
  const parents=allocate('Resident grip components',n*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),previous=allocate('Resident grip previous edges',b*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),weights=allocate('Resident grip weights',n*4,GPUBufferUsage.STORAGE),control=allocate('Resident grip changes',4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),transitions=allocate('Resident fracture transitions',b*8,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),uniform=allocate('Resident grip input',64,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(previous,0,Uint32Array.from({length:b},(_,i)=>initialBonds[i*4+2]*(supportAware?3:1)));
  const shader=device.createShaderModule({code:boundedGripWgsl}),info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(info.messages));
  const layout=device.createBindGroupLayout({entries:Array.from({length:9},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===8?'uniform':binding<2?'read-only-storage':'storage'}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  for(const entryPoint of ['clear','changes','initialize','unite','compress','selectWeights','sumWeights','capture'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:shader,entryPoint,constants:{supportAware}}});
  const buffers=[resident.stateBuffer(),connectionBuffer,resident.diagnosticsBuffer(),parents,previous,weights,control,transitions,uniform],group=device.createBindGroup({layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  let anchor=0,center=[0,0,0],radius=1;
  const submit=(mode,travel,threshold=0)=>{
   const bytes=new ArrayBuffer(64);new Uint32Array(bytes,0,4).set([n,b,anchor,mode]);new Float32Array(bytes,16,8).set([...center,radius,...travel,threshold]);new Uint32Array(bytes,48,4).set([resident.submittedState().steps,0,0,0]);device.queue.writeBuffer(uniform,0,bytes);
   const encoder=device.createCommandEncoder();for(const [name,size] of [['clear',1],['changes',b],['initialize',n],['unite',b],['compress',n],['selectWeights',n],['sumWeights',256],['capture',n]]){const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(name==='sumWeights'?1:Math.ceil(size/64));pass.end();}device.queue.submit([encoder.finish()]);
  };
  return {route:'kaminos.bounded-grip.resident-connectivity.v1',
   changeBuffer:control,
   componentBuffer:parents,
   refreshComponents(){submit(2,[0,0,0]);},
   clearChanges(){const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipelines.clear);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();device.queue.submit([encoder.finish()]);},
   async begin(node,point,patchRadius,stiffness){if(!Number.isInteger(node)||node<0||node>=n||!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||!(Number.isFinite(patchRadius)&&patchRadius>0))throw new Error('Finite resident contact required');anchor=node;center=[...point];radius=patchRadius;await resident.captureResidentPatch(anchor,stiffness);submit(1,[0,0,0]);},
   update(travel,threshold=0){submit(0,travel,threshold);},
   async read(){submit(2,[0,0,0]);const read=device.createBuffer({size:n*4+8+b*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(parents,0,read,0,n*4);encoder.copyBufferToBuffer(control,0,read,n*4,4);encoder.copyBufferToBuffer(transitions,0,read,n*4+8,b*8);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=read.getMappedRange(),values=new Uint32Array(bytes),history=new Uint32Array(bytes,n*4+8,b*2),floats=new Float32Array(bytes,n*4+8,b*2);return {route:this.route,anchor,components:Array.from(values.slice(0,n)),changedEdges:values[n],fractureHistory:Array.from({length:b},(_,i)=>({edge:i,step:history[i*2]?history[i*2]-1:null,threshold:floats[i*2+1]}))};}finally{read.destroy();}},
   dispose(){disposeAll(owned.map(buffer=>()=>buffer.destroy()),'Bounded grip cleanup failed');},
  };
 }catch(e){disposeAll(owned.map(buffer=>()=>buffer.destroy()),'Bounded grip initialization failed',e);}
}
import {disposeAll} from './structural-material-disposal.mjs';
