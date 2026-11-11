const GROUP=256,RECORD_BYTES=96,WEIGHT_EPSILON=1e-12;
const MAIN=/* wgsl */`
struct ExchangeParams {grid:vec4<u32>,domain:vec4<f32>,invocation:vec4<u32>,exchange:vec4<f32>}
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> offsets:array<u32>;
@group(0) @binding(3) var<storage,read_write> cursors:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> ids:array<u32>;
@group(0) @binding(5) var<storage,read_write> metadata:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> params:ExchangeParams;
var<workgroup> totals:array<vec4<u32>,256>;
var<workgroup> pairTotals:array<u32,256>;
fn exchangeCell(position:vec3<f32>)->u32{
 let p=position+vec3<f32>(1);
 if(!all(p>=vec3<f32>(0))||!all(p<=params.domain.xyz)){return 0xffffffffu;}
 let cell=min(vec3<u32>(floor(p/params.domain.w)),params.grid.xyz-vec3<u32>(1));
 return cell.x+params.grid.x*(cell.y+params.grid.y*cell.z);
}
fn exchangeIndex(gid:vec3<u32>)->u32{return gid.x+gid.y*params.invocation.z;}
@compute @workgroup_size(256) fn count(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) tid:u32){
 let i=exchangeIndex(gid);var local=vec4<u32>(0);
 if(i<params.invocation.x&&particles[i].anchor.w>0){
  let cell=exchangeCell(particles[i].anchor.xyz);
  if(cell==0xffffffffu){local.w=1u;}else{let previous=atomicAdd(&counts[cell],1u);local=vec4<u32>(1u,previous&1u,select(0u,1u,previous==0u),0u);}
 }
 totals[tid]=local;workgroupBarrier();
 for(var stride=128u;stride>0u;stride/=2u){if(tid<stride){totals[tid]+=totals[tid+stride];}workgroupBarrier();}
 if(tid==0u){for(var k=0u;k<4u;k++){atomicAdd(&metadata[k],totals[0][k]);}}
}
@compute @workgroup_size(256) fn scatter(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=exchangeIndex(gid);
 if(i==0u){atomicStore(&metadata[4],params.invocation.x-atomicLoad(&metadata[0])-atomicLoad(&metadata[3]));}
 if(i>=params.invocation.x||!(particles[i].anchor.w>0)){return;}
 let cell=exchangeCell(particles[i].anchor.xyz);if(cell==0xffffffffu){return;}
 ids[offsets[cell]+atomicAdd(&cursors[cell],1u)]=i;
}
@compute @workgroup_size(256) fn mixPairs(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) tid:u32){
 let i=exchangeIndex(gid);var paired=0u;
 if(i<offsets[params.grid.w]){
  let cell=exchangeCell(particles[ids[i]].anchor.xyz);let n=atomicLoad(&counts[cell]);let local=i-offsets[cell];
  if(local<n/2u){
   let rotation=params.invocation.y%n;let a=ids[offsets[cell]+(2u*local+rotation)%n];let b=ids[offsets[cell]+(2u*local+rotation+1u)%n];
   let pa=particles[a];let pb=particles[b];
   let wa=max(${WEIGHT_EPSILON},pa.shape.x*pa.shape.x*pa.shape.w);let wb=max(${WEIGHT_EPSILON},pb.shape.x*pb.shape.x*pb.shape.w);
   // Each pair is disjoint. Scale weights before their sum to avoid overflow.
   let scale=max(wa,wb);let relativeA=wa/scale;let relativeB=wb/scale;let denominator=relativeA+relativeB;
   let delta=(pb.state-pa.state)*params.exchange.w;
   particles[a].state=pa.state+delta*(relativeB/denominator);
   particles[b].state=pb.state-delta*(relativeA/denominator);paired=1u;
  }
 }
 pairTotals[tid]=paired;workgroupBarrier();
 for(var stride=128u;stride>0u;stride/=2u){if(tid<stride){pairTotals[tid]+=pairTotals[tid+stride];}workgroupBarrier();}
 if(tid==0u){atomicAdd(&metadata[5],pairTotals[0]);}
}
`;
const SCAN=/* wgsl */`
struct ScanParams {size:vec4<u32>}
@group(0) @binding(0) var<storage,read> input:array<u32>;
@group(0) @binding(1) var<storage,read_write> output:array<u32>;
@group(0) @binding(2) var<storage,read_write> sums:array<u32>;
@group(0) @binding(3) var<uniform> params:ScanParams;
var<workgroup> values:array<u32,256>;
@compute @workgroup_size(256) fn scan(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) tid:u32){
 let block=group.x+group.y*params.size.y;if(block>=params.size.z){return;}
 let i=block*256u+tid;var value=0u;if(i<params.size.x){value=input[i];}
 values[tid]=value;workgroupBarrier();
 for(var stride=1u;stride<256u;stride*=2u){var previous=0u;if(tid>=stride){previous=values[tid-stride];}workgroupBarrier();values[tid]+=previous;workgroupBarrier();}
 if(i<params.size.x){output[i]=values[tid]-value;}if(tid==255u){sums[block]=values[tid];}
}
@compute @workgroup_size(256) fn add(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x+gid.y*params.size.y*256u;if(i>=params.size.x){return;}output[i]+=input[i/256u];
}
`;

function dispatch(n,limit){
 const groups=Math.ceil(n/GROUP),x=Math.min(limit,groups),y=groups?Math.ceil(groups/x):0;
 if(y>limit)throw Error('Particle exchange exceeds effective device compute dispatch capacity');
 return {x,y,groups};
}
function positive(value,label){if(!Number.isFinite(value)||value<=0||!Number.isFinite(Math.fround(value))||Math.fround(value)<=0)throw Error(`Particle exchange ${label} must be positive finite FP32`);return value;}
function integer(value,label,zero=false){if(!Number.isSafeInteger(value)||value<(zero?0:1)||value>0xffffffff)throw Error(`Particle exchange ${label} must be ${zero?'nonnegative':'positive'} u32`);return value;}
export function particleExchangePlan(limits,{slots,dims,pitch,cellSize=1}){
 integer(slots,'slots',true);if(!Array.isArray(dims)||dims.length!==3)throw Error('Particle exchange requires three domain dimensions');
 dims.forEach(v=>integer(v,'domain dimension'));positive(pitch,'pitch');positive(cellSize,'cell size');
 const cellDims=dims.map(v=>Math.ceil(v/cellSize));cellDims.forEach(v=>integer(v,'cell dimension'));
 const cellCount=cellDims.reduce((a,b)=>a*b,1);integer(cellCount+1,'cell offset count');
 const extent=dims.map(v=>positive(Math.fround(v*pitch),'domain extent'));const cellPitch=positive(Math.fround(pitch*cellSize),'cell pitch');
 if(limits.maxComputeInvocationsPerWorkgroup<GROUP||limits.maxComputeWorkgroupSizeX<GROUP||limits.maxComputeWorkgroupStorageSize<GROUP*20)throw Error('Particle exchange exceeds effective device workgroup capacity');
 if(limits.maxStorageBuffersPerShaderStage<6||limits.maxBindingsPerBindGroup<7||limits.maxUniformBufferBindingSize<64)throw Error('Particle exchange exceeds effective device shader binding capacity');
 const bindingLimit=Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize);
 const sizes={particles:Math.max(RECORD_BYTES,slots*RECORD_BYTES),counts:(cellCount+1)*4,offsets:(cellCount+1)*4,cursors:cellCount*4,ids:Math.max(4,slots*4),metadata:32};
 for(const [name,size] of Object.entries(sizes))if(size>bindingLimit)throw Error(`Particle exchange ${name} requires ${size} bytes; exceeds effective device binding capacity ${bindingLimit}`);
 const particleDispatch=dispatch(slots,limits.maxComputeWorkgroupsPerDimension),scanLevels=[];
 for(let n=cellCount+1;;){const work=dispatch(n,limits.maxComputeWorkgroupsPerDimension);scanLevels.push({length:n,...work});if(work.groups===1)break;n=work.groups;}
 const scanBytes=scanLevels.reduce((sum,level,i)=>sum+level.groups*4+(i?level.length*4:0)+16,0);
 const groupingProfilePasses=[...(slots?['exchangeCount']:[]),...scanLevels.map((_,i)=>`exchangePrefix${i}`),...scanLevels.slice(0,-1).map((_,i)=>`exchangePrefixAdd${scanLevels.length-2-i}`),...(slots?['exchangeScatter']:[])];
 return {slots,cellDims,cellCount,extent,cellPitch,sizes,particleDispatch,scanLevels,groupingProfilePasses,mixProfilePass:'exchangeMix',bytes:sizes.counts+sizes.offsets+sizes.cursors+sizes.ids+sizes.metadata+scanBytes};
}

// Grouping is useful independently of mixing: offsets[cellCount] is the GPU
// live count and ids[offsets[c]..offsets[c+1]) holds every admitted ID once.
// Scatter order within a cell is deliberately unspecified. Frame rotates the
// current order; it does not promise a persistent sort or deterministic partner.
// Counts has one zero sentinel for exclusive scan. Metadata u32 fields are
// placed/pairs/nonemptyCells/outside/inactive/mixedPairs; callers must read GPU
// buffers before treating these quantities as observed. Submit the encoder
// before yielding, as with the other retained-particle GPU helpers.
export function createParticleExchange(device,{particleWgsl}){
 if(typeof particleWgsl!=='string'||!particleWgsl.trim())throw Error('Particle exchange requires the production Particle WGSL record');
 const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const mainLayout=device.createBindGroupLayout({entries:[...Array.from({length:6},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}})),{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
 const scanLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
 function pipelines(code,layout,names){const module=device.createShaderModule({code});const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});return Object.fromEntries(names.map(entryPoint=>[entryPoint,device.createComputePipeline({label:`particle exchange ${entryPoint}`,layout:pipelineLayout,compute:{module,entryPoint}})]));}
 const main=pipelines(particleWgsl+MAIN,mainLayout,['count','scatter','mixPairs']),scan=pipelines(SCAN,scanLayout,['scan','add']);
 let arena=null,latest=null,disposed=false;const retired=[];
 const retire=resources=>{const owned=[...resources];queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>owned.forEach(b=>b.destroy())));};
 const buffer=(label,size)=>device.createBuffer({label:`particle exchange ${label}`,size,usage});
 function uniform(label,data){const b=device.createBuffer({label,size:data.byteLength,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:true});new Uint8Array(b.getMappedRange()).set(new Uint8Array(data));b.unmap();return b;}
 function group(layout,buffers){return device.createBindGroup({layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});}
 function pass(encoder,label,pipeline,bind,work,profileWrites){const p=encoder.beginComputePass({label:`particle exchange ${label}`,...profileWrites(label)});p.setPipeline(pipeline);p.setBindGroup(0,bind);p.dispatchWorkgroups(work.x,work.y);p.end();}
 function allocate(plan){
  if(arena&&arena.slots===plan.slots&&arena.cellCount===plan.cellCount)return;
  if(arena)retired.push(...arena.resources);
  const counts=buffer('counts',plan.sizes.counts),offsets=buffer('offsets',plan.sizes.offsets),cursors=buffer('cursors',plan.sizes.cursors),ids=buffer('ids',plan.sizes.ids),metadata=buffer('metadata',32);
  const resources=[counts,offsets,cursors,ids,metadata],levels=[];
  for(let i=0;i<plan.scanLevels.length;i++){
   const l=plan.scanLevels[i],output=i?buffer(`scan ${i} offsets`,l.length*4):offsets,sums=buffer(`scan ${i} sums`,l.groups*4),params=uniform(`particle exchange scan ${i} parameters`,new Uint32Array([l.length,l.x,l.groups,0]).buffer);
   resources.push(sums,params,...(i?[output]:[]));const input=i?levels[i-1].sums:counts;
   levels.push({...l,output,sums,params,scanGroup:group(scanLayout,[input,output,sums,params])});
  }
  for(let i=0;i<levels.length-1;i++){const l=levels[i];l.addGroup=group(scanLayout,[levels[i+1].output,l.output,l.sums,l.params]);}
  arena={slots:plan.slots,cellCount:plan.cellCount,counts,offsets,cursors,ids,metadata,levels,resources};
 }
 return {
  encode(encoder,{particles,slots,dims,pitch,stepDelta=0,frame=0,strength=0,time=1,cellSize=1,profileWrites=()=>({})}){
   if(disposed)throw Error('Particle exchange has been disposed');
   const plan=particleExchangePlan(device.limits,{slots,dims,pitch,cellSize});
   if(!particles||particles.size<plan.sizes.particles||!(particles.usage&GPUBufferUsage.STORAGE))throw Error('Particle exchange requires the complete 96-byte particle storage population');
   integer(frame,'frame',true);if(!Number.isFinite(stepDelta)||stepDelta<0)throw Error('Particle exchange step delta must be finite and nonnegative');
   if(!Number.isFinite(strength)||strength<0||strength>1)throw Error('Particle exchange strength must be within [0,1]');positive(time,'time');
   const fraction=Math.fround(strength*-Math.expm1(-stepDelta/time));
   // All hardware/input checks precede allocation, clear, dispatch and state writes.
   allocate(plan);const data=new ArrayBuffer(64),u=new Uint32Array(data),f=new Float32Array(data);
   u.set([...plan.cellDims,plan.cellCount]);f.set([...plan.extent,plan.cellPitch],4);u.set([slots,frame,plan.particleDispatch.x*GROUP,0],8);f.set([0,0,0,fraction],12);
   const params=uniform('particle exchange invocation parameters',data),bindings=group(mainLayout,[particles,arena.counts,arena.offsets,arena.cursors,arena.ids,arena.metadata,params]);
   encoder.clearBuffer(arena.counts);encoder.clearBuffer(arena.cursors);encoder.clearBuffer(arena.metadata);
   if(slots)pass(encoder,'exchangeCount',main.count,bindings,plan.particleDispatch,profileWrites);
   for(let i=0;i<arena.levels.length;i++){const l=arena.levels[i];pass(encoder,`exchangePrefix${i}`,scan.scan,l.scanGroup,l,profileWrites);}
   for(let i=arena.levels.length-2;i>=0;i--){const l=arena.levels[i];pass(encoder,`exchangePrefixAdd${i}`,scan.add,l.addGroup,l,profileWrites);}
   if(slots)pass(encoder,'exchangeScatter',main.scatter,bindings,plan.particleDispatch,profileWrites);
   if(slots&&fraction>0)pass(encoder,'exchangeMix',main.mixPairs,bindings,plan.particleDispatch,profileWrites);
   latest={...plan,counts:arena.counts,offsets:arena.offsets,ids:arena.ids,metadata:arena.metadata,liveCount:{buffer:arena.offsets,byteOffset:plan.cellCount*4},requested:{stepDelta,frame,strength,time,cellSize},effectiveFraction:fraction,grouping:'gpu-count-exclusive-prefix-scatter',mixing:fraction>0?'cell-local-disjoint-weighted-pairs':'identity',gpuDerived:'pending-readback',placed:null,pairs:null,nonemptyCells:null,outside:null,inactive:null,mixedPairs:null,metadataFields:['placed','pairs','nonemptyCells','outside','inactive','mixedPairs'],scanPasses:arena.levels.length*2-1,profilePasses:[...plan.groupingProfilePasses,...(slots&&fraction>0?['exchangeMix']:[])]};
   retire([params,...retired.splice(0)]);return latest;
  },
  get buffers(){return latest;},
  dispose(){if(disposed)return;disposed=true;retire([...retired.splice(0),...(arena?.resources??[])]);arena=latest=null;}
 };
}
