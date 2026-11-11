import {createParticleExchange,particleExchangePlan} from './volume-particle-exchange.mjs';
const GROUP=64;
const WGSL=/* wgsl */`
struct FieldNode {state:vec4<f32>,mass:vec4<f32>}
struct FieldParams {grid:vec4<u32>,nodes:vec4<u32>,domain:vec4<f32>,fraction:vec4<f32>,dispatch:vec4<u32>}
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read> offsets:array<u32>;
@group(0) @binding(2) var<storage,read> ids:array<u32>;
@group(0) @binding(3) var<storage,read_write> nodes:array<FieldNode>;
@group(0) @binding(4) var<uniform> u:FieldParams;
var<workgroup> totals:array<vec4<f32>,64>;
var<workgroup> masses:array<f32,64>;
fn fieldWeight(p:Particle)->f32{return max(1e-12,p.shape.x*p.shape.x*p.shape.w);}
@compute @workgroup_size(64) fn reduceField(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) tid:u32){
 let n=group.x+group.y*u.dispatch.x;if(n>=u.nodes.w){return;}
 let node=vec3<i32>(i32(n%u.nodes.x),i32(n/u.nodes.x%u.nodes.y),i32(n/(u.nodes.x*u.nodes.y)));
 var sum=vec4<f32>(0);var mass=0.0;
 // Each node sees the eight touching bins. The per-lane loops have no
 // population cap; count/prefix/scatter has retained every admitted ID.
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let cell=node+vec3<i32>(x,y,z)-vec3<i32>(1);if(any(cell<vec3<i32>(0))||any(cell>=vec3<i32>(u.grid.xyz))){continue;}
  let c=u32(cell.x)+u.grid.x*(u32(cell.y)+u.grid.y*u32(cell.z));
  for(var at=offsets[c]+tid;at<offsets[c+1u];at+=64u){
   let p=particles[ids[at]];let w=max(vec3<f32>(0),vec3<f32>(1)-abs((p.anchor.xyz+vec3<f32>(1))/u.domain.w-vec3<f32>(node)));
   let weight=w.x*w.y*w.z*fieldWeight(p);sum+=p.state*weight;mass+=weight;
  }
 }}}
 totals[tid]=sum;masses[tid]=mass;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(tid<stride){totals[tid]+=totals[tid+stride];masses[tid]+=masses[tid+stride];}workgroupBarrier();}
 if(tid==0u){var mean=vec4<f32>(0);if(masses[0]>0){mean=totals[0]/masses[0];}nodes[n]=FieldNode(mean,vec4<f32>(masses[0],0,0,0));}
}
@compute @workgroup_size(64) fn gatherField(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x+gid.y*u.dispatch.y;if(i>=u.dispatch.z){return;}let p=particles[i];if(!(p.anchor.w>0)){return;}
 let position=p.anchor.xyz+vec3<f32>(1);if(any(position<vec3<f32>(0))||any(position>u.domain.xyz)){return;}
 let q=position/u.domain.w;let base=min(vec3<u32>(floor(q)),u.nodes.xyz-vec3<u32>(2));let f=clamp(q-vec3<f32>(base),vec3<f32>(0),vec3<f32>(1));var neighborhood=vec4<f32>(0);
 for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
  let at=base+vec3<u32>(x,y,z);let node=nodes[at.x+u.nodes.x*(at.y+u.nodes.y*at.z)];let w=select(vec3<f32>(1)-f,f,vec3<bool>(x==1u,y==1u,z==1u));
  neighborhood+=select(p.state,node.state,node.mass.x>0)*w.x*w.y*w.z;
 }}}
 // Matched trilinear scatter/gather gives a convex local exchange. With
 // constant per-component fractions it preserves the declared weighted sums.
 particles[i].state=mix(p.state,neighborhood,u.fraction);
}
`;
function dispatch(groups,limit){const x=Math.min(groups,limit),y=groups?Math.ceil(groups/x):0;if(y>limit)throw Error('Particle exchange field exceeds effective dispatch capacity');return {x,y};}
export function particleFieldPlan(limits,input){
 const plan=particleExchangePlan(limits,input),nodeDims=plan.cellDims.map(n=>n+1),nodeCount=nodeDims.reduce((a,b)=>a*b,1),fieldBytes=nodeCount*32;
 if(!Number.isSafeInteger(nodeCount)||nodeCount>0xffffffff||fieldBytes>Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize))throw Error('Particle exchange field exceeds effective storage capacity');
 const fieldDispatch=dispatch(nodeCount,limits.maxComputeWorkgroupsPerDimension),gatherDispatch=dispatch(Math.ceil(input.slots/GROUP),limits.maxComputeWorkgroupsPerDimension);
 return {...plan,nodeDims,nodeCount,fieldBytes,fieldDispatch,gatherDispatch,bytes:plan.bytes+fieldBytes,fieldProfilePasses:['exchangeField','exchangeGather']};
}
const positive=(v,name)=>{if(!(Number.isFinite(v)&&v>0&&Math.fround(v)>0))throw Error('Invalid particle exchange '+name);};
const nonnegative=(v,name)=>{if(!(Number.isFinite(v)&&v>=0&&Number.isFinite(Math.fround(v))))throw Error('Invalid particle exchange '+name);};
export function createParticleField(device,{particleWgsl}){
 const grouping=createParticleExchange(device,{particleWgsl}),module=device.createShaderModule({code:particleWgsl+WGSL});
 const layout=device.createBindGroupLayout({entries:[0,1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===4?'uniform':binding===1||binding===2?'read-only-storage':'storage'}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const reduce=device.createComputePipeline({label:'overlapping particle composition moments',layout:pipelineLayout,compute:{module,entryPoint:'reduceField'}}),gather=device.createComputePipeline({label:'connected particle composition exchange',layout:pipelineLayout,compute:{module,entryPoint:'gatherField'}});
 let field=null,fieldPlan=null,lastGroupedStep=null,groupState=null,groupKey=null,dirty=true,lastSeen=null,lastField=null,pending=0,latest=null,disposed=false;
 const retire=buffer=>{if(buffer)queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>buffer.destroy()));};
 function pass(encoder,label,pipeline,bind,work,profileWrites){if(!work.x)return;const p=encoder.beginComputePass({label,...profileWrites(label)});p.setPipeline(pipeline);p.setBindGroup(0,bind);p.dispatchWorkgroups(work.x,work.y);p.end();}
 return {encode(encoder,{particles,slots,dims,pitch,stepDelta=0,step=0,frame=0,strength=1,time=8,cellSize=1,heatRate=1,speciesRate=1,sootRate=1,rate=1,interval=1,enabled=true,groupingEnabled=true,requireGrouping=false,profileWrites=()=>({})}){
  if(disposed)throw Error('Particle exchange field is disposed');const plan=particleFieldPlan(device.limits,{slots,dims,pitch,cellSize});
  if(!particles||particles.size<slots*96||!(particles.usage&GPUBufferUsage.STORAGE))throw Error('Particle exchange requires its complete storage population');
  for(const [k,v] of Object.entries({stepDelta,step,frame,heatRate,speciesRate,sootRate,rate}))nonnegative(v,k);positive(time,'time');
  if(!(strength>=0&&strength<=1&&Number.isFinite(strength))||!Number.isSafeInteger(interval)||interval<1)throw Error('Invalid particle exchange strength or cadence');
  for(const b of [enabled,groupingEnabled,requireGrouping])if(typeof b!=='boolean')throw Error('Particle exchange gates must be boolean');
  const k=JSON.stringify([slots,plan.cellDims,plan.cellPitch]);if(lastSeen!==null&&step<lastSeen){lastField=null;pending=0;dirty=true;}
  const active=enabled&&groupingEnabled&&strength>0&&rate>0&&Math.max(heatRate,speciesRate,sootRate)>0;
  if(!active)pending=0;else if(lastSeen!==step)pending+=stepDelta;
  const due=active&&stepDelta>0&&(lastField===null||step-lastField>=interval),need=groupingEnabled&&(requireGrouping||due);
  let grouped=false;if(need&&(dirty||groupKey!==k||lastSeen!==step||!groupState)){
   groupState=grouping.encode(encoder,{particles,slots,dims,pitch,stepDelta:0,frame,strength:0,time,cellSize,profileWrites});groupKey=k;dirty=false;grouped=true;lastGroupedStep=step;
  }
  lastSeen=step;let fractions=[0,0,0,0];
  if(due){
   if(!field||field.size!==plan.fieldBytes){retire(field);field=device.createBuffer({label:'weighted overlapping carrier field',size:plan.fieldBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});}
   fieldPlan=plan;
   fractions=[speciesRate,heatRate,sootRate,speciesRate].map(r=>Math.fround(strength*-Math.expm1(-pending*rate*r/time)));
   const data=new ArrayBuffer(80),u=new Uint32Array(data),f=new Float32Array(data);u.set([...plan.cellDims,plan.cellCount]);u.set([...plan.nodeDims,plan.nodeCount],4);f.set([...plan.extent,plan.cellPitch],8);f.set(fractions,12);u.set([plan.fieldDispatch.x,plan.gatherDispatch.x*64,slots,0],16);
   const params=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:true});new Uint8Array(params.getMappedRange()).set(new Uint8Array(data));params.unmap();
   const bind=device.createBindGroup({layout,entries:[particles,groupState.offsets,groupState.ids,field,params].map((buffer,binding)=>({binding,resource:{buffer}}))});
   pass(encoder,'exchangeField',reduce,bind,plan.fieldDispatch,profileWrites);pass(encoder,'exchangeGather',gather,bind,plan.gatherDispatch,profileWrites);retire(params);lastField=step;pending=0;
  }
  latest={...(groupState??{}),bytes:(groupState?.bytes??0)+(field?.size??0),field:field?{buffer:field,nodeDims:fieldPlan.nodeDims,nodeCount:fieldPlan.nodeCount,spacing:fieldPlan.cellPitch,bytes:field.size,valid:lastField!==null}:null,cellDims:groupState?.cellDims??null,cellCount:groupState?.cellCount??0,residentGrouping:groupState?{cellDims:groupState.cellDims,cellCount:groupState.cellCount,spacing:groupState.cellPitch,step:lastGroupedStep,bytes:groupState.bytes}:null,planned:{cellDims:plan.cellDims,cellCount:plan.cellCount,nodeDims:plan.nodeDims,nodeCount:plan.nodeCount,spacing:plan.cellPitch,bytes:plan.bytes},effectiveFraction:Math.max(...fractions),fractions,lastFieldStep:lastField,pendingReactionDelta:pending,groupStep:lastGroupedStep,grouping:need?'gpu-count-exclusive-prefix-scatter':'off',mixing:due?'overlapping-trilinear-field':active?'cadence-held':'off',work:{grouping:grouped,fieldReduce:due,fieldGather:due,interval,reason:!groupingEnabled?'grouping-disabled':!active?'exchange-disabled':due?'advanced':'cadence-or-pause',particles:slots,nodeCount:due?plan.nodeCount:0},profilePasses:[...(grouped?plan.groupingProfilePasses:[]),...(due?plan.fieldProfilePasses:[])]};return latest;
 },async statistics(){
  if(!groupState)return {available:false,reason:'Grouping has not run'};const atStep=lastGroupedStep,buffer=groupState.metadata,read=device.createBuffer({size:24,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,read,0,24);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const a=new Uint32Array(read.getMappedRange().slice(0));return {available:true,step:atStep,active:a[0],nonemptyCells:a[2],outside:a[3],inactive:a[4],phase:'grouping before carrier advance and births',authority:'GPU compact counters'};}finally{read.unmap();read.destroy();}
 },invalidate(){dirty=true;},reset(){dirty=true;lastSeen=null;lastField=null;lastGroupedStep=null;groupState=null;groupKey=null;pending=0;latest=null;},get buffers(){return latest;},dispose(){disposed=true;grouping.dispose();retire(field);field=null;}};
}
