import {MATERIAL_PACKET_STRUCT_WGSL,createMaterialPacketBuilder,materialPacketPlan} from './volume-material-packets.mjs';
import {OPTICAL_GAUSSIAN_INTERVAL_WGSL} from './volume-optical-gaussian.mjs';
import {packetNetworkSettings} from './volume-packet-network.mjs';

export function materialPacketTransportWgsl(sections){
 if(!Number.isSafeInteger(sections)||sections<1)throw Error('Invalid packet depth sections');
 return /* wgsl */`${MATERIAL_PACKET_STRUCT_WGSL}${OPTICAL_GAUSSIAN_INTERVAL_WGSL}
struct Transport {counts:vec4<u32>,rays:vec4<u32>,quality:vec4<f32>}
@group(0) @binding(0) var<storage,read> packets:array<MaterialPacket>;
@group(0) @binding(1) var<storage,read> kernels:array<MaterialKernel>;
@group(0) @binding(2) var<uniform> plan:Transport;
@group(0) @binding(3) var<storage,read_write> output:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> incident:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read> triangles:array<vec4<f32>>;
@group(0) @binding(6) var<storage,read_write> stats:array<atomic<u32>>;
fn track(i:u32,n:u32){if(atomicAdd(&stats[i],n)>0xffffffffu-n){atomicStore(&stats[8],1u);}}
fn solidEnd(origin:vec3<f32>,direction:vec3<f32>,far:f32)->f32{
 var end=far;for(var i=0u;i<plan.counts.z;i++){let a=triangles[3u*i].xyz;let ab=triangles[3u*i+1u].xyz-a;let ac=triangles[3u*i+2u].xyz-a;let p=cross(direction,ac);let det=dot(ab,p);if(abs(det)<1e-12){continue;}let q=origin-a;let u=dot(q,p)/det;if(u< -1e-6||u>1.0+1e-6){continue;}let v=dot(direction,cross(q,ab))/det;if(v< -1e-6||u+v>1.0+1e-6){continue;}let t=dot(ac,cross(q,ab))/det;if(t>=0&&t<end){end=t;}}return end;
}
fn slab(tau:f32)->f32{if(tau<1e-4){return 1.0-tau*.5+tau*tau/6.0;}return (1.0-exp(-tau))/tau;}
@compute @workgroup_size(64) fn tracePackets(@builtin(global_invocation_id) gid:vec3<u32>){
 let total=plan.rays.w;if(gid.x>=total){return;}output[gid.x]=vec4<f32>(0);let samples=plan.rays.x*plan.rays.x;let sample=gid.x%samples;let bundle=gid.x/samples;let face=bundle%plan.rays.y;let pair=bundle/plan.rays.y;let source=pair%plan.counts.x;let receiver=pair/plan.counts.x;
 let r=packets[receiver];let s=packets[source];if(r.center.w<=0||!any(s.power.xyz>vec3<f32>(0))){return;}
 if(face==0u&&sample==0u){track(2u,1u);}
 let delta=s.center.xyz-r.center.xyz;let distance=length(delta);let extent=(s.hi.xyz-s.lo.xyz)*.5;let middle=(s.hi.xyz+s.lo.xyz)*.5-r.center.xyz;
 let close=length(extent)/max(distance,1e-20)>plan.quality.x;if(!close&&face>0u){return;}
 var direction=vec3<f32>(0,0,1);if(distance>0){direction=delta/distance;}
 if(close){if(plan.rays.y==6u){let dirs=array<vec3<f32>,6>(vec3<f32>(1,0,0),vec3<f32>(-1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,-1,0),vec3<f32>(0,0,1),vec3<f32>(0,0,-1));direction=dirs[face];}
 else{let z=1.0-2.0*(f32(face)+.5)/f32(plan.rays.y);let phi=f32(face)*2.399963229728653;let radial=sqrt(max(0.0,1.0-z*z));direction=vec3<f32>(radial*cos(phi),radial*sin(phi),z);}}
 let axis=select(vec3<f32>(0,1,0),vec3<f32>(1,0,0),abs(direction.y)>.9);let right=normalize(cross(axis,direction));let up=cross(direction,right);
 let far=dot(middle,direction)+dot(extent,abs(direction));if(far<=0){return;}
 var halfSize=max(vec2<f32>(plan.quality.w),vec2<f32>(abs(dot(middle,right))+dot(extent,abs(right)),abs(dot(middle,up))+dot(extent,abs(up))));
 var weight=atan2(halfSize.x*halfSize.y,max(distance,1e-20)*sqrt(distance*distance+dot(halfSize,halfSize)))/3.141592653589793;
 if(close){let re=(r.hi.xyz-r.lo.xyz)*.5;halfSize=max(vec2<f32>(plan.quality.w),vec2<f32>(dot(re,abs(right)),dot(re,abs(up)))*plan.quality.y);weight=1.0/f32(plan.rays.y);}
 let uv=(vec2<f32>(f32(sample%plan.rays.x),f32(sample/plan.rays.x))+.5)/f32(plan.rays.x)*2.0-1.0;let origin=r.center.xyz+right*uv.x*halfSize.x+up*uv.y*halfSize.y;
 let end=solidEnd(origin,direction,far);track(3u,1u);track(7u,plan.counts.z);if(end<=0){return;}
 var bins:array<vec4<f32>,${sections}>;var candidates=0u;var hits=0u;var deposits=0u;
 for(var i=0u;i<plan.counts.y;i++){
  let k=kernels[i];if(k.tags.w==0u||(k.tags.y==0u&&k.tags.x!=source)){continue;}candidates++;
  // Slab AABB rejection is conservative for this declared finite kernel.
  var enter=0.0;var leave=end;var missed=false;
  for(var a=0u;a<3u;a++){if(abs(direction[a])<1e-20){if(origin[a]<k.lo[a]||origin[a]>k.hi[a]){missed=true;}}else{let t0=(k.lo[a]-origin[a])/direction[a];let t1=(k.hi[a]-origin[a])/direction[a];enter=max(enter,min(t0,t1));leave=min(leave,max(t0,t1));}}
  if(missed||leave<=enter){continue;}
  let q=mat3x3<f32>(k.q0.xyz,k.q1.xyz,k.q2.xyz);let local=origin-k.center.xyz;let a=dot(direction,q*direction);let mean=-dot(direction,q*local)/a;let perpendicular=local+direction*mean;let residual=dot(perpendicular,q*perpendicular);let remaining=k.q0.w*k.q0.w-residual;
  if(!(remaining>0&&a>0)){continue;}let radius=sqrt(remaining/a);let lo=max(0.0,mean-radius);let hi=min(end,mean+radius);if(hi<=lo){continue;}hits++;
  let first=min(${sections-1}u,u32(max(0.0,lo/far)*${sections}.0));let last=min(${sections-1}u,u32(max(0.0,hi/far)*${sections}.0));let scale=sqrt(a);let amplitude=k.center.w*exp(-.5*residual)*2.5066282746310002/scale;
  for(var z=first;z<=last;z++){let begin=max(lo,f32(z)*far/${sections}.0);let finish=min(hi,f32(z+1u)*far/${sections}.0);if(finish<=begin){continue;}let column=amplitude*opticalNormalSpan(((begin+finish)*.5-mean)*scale,(finish-begin)*scale);bins[z]+=k.amount*column;deposits++;}
 }
 track(4u,candidates);track(5u,hits);track(6u,deposits);
 var light=vec3<f32>(0);var transmission=1.0;for(var z=0u;z<${sections}u;z++){let v=bins[z];light+=transmission*v.xyz*slab(v.w);transmission*=exp(-v.w);}
 let valid=all(abs(light)<vec3<f32>(3.402823e38));output[gid.x]=vec4<f32>(light*(weight*plan.quality.z/f32(samples)),select(-1.0,1.0,valid));
}
@compute @workgroup_size(64) fn collectPackets(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=plan.counts.x){return;}let count=plan.counts.x*plan.rays.y*plan.rays.x*plan.rays.x;var light=vec3<f32>(0);var valid=packets[i].center.w>0;
 for(var j=0u;j<count;j++){let v=output[i*count+j];light+=v.xyz;if(v.w<0){valid=false;}}
 incident[i]=vec4<f32>(light,select(0.0,1.0,valid));
}
`;
}

export function createMaterialPacketNetwork(device){
 const builder=createMaterialPacketBuilder(device),variants=new Map();let resources=null,key=null,latest=null,identity=null,settings=null,transform=null;
 const retire=items=>queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>items.forEach(b=>b.destroy())));
 const preparationKey=s=>String(packetNetworkSettings(s).sections);
 return {
  preparationKey,
  async prepare(input={}){const s=packetNetworkSettings(input),k=preparationKey(s);if(!variants.has(k)){const module=device.createShaderModule({label:'fresh material packet optical integral',code:materialPacketTransportWgsl(s.sections)});variants.set(k,Promise.all(['tracePackets','collectPackets'].map(entryPoint=>device.createComputePipelineAsync({label:'material packet '+entryPoint,layout:'auto',compute:{module,entryPoint}}))));}const result=await Promise.all([builder.prepare(),variants.get(k)]);variants.get(k).pipelines=result[1];},
  encode(encoder,{material,settings:input,triangles=null,triangleCount=0}){
   settings=packetNetworkSettings(input);const prepared=variants.get(preparationKey(settings));if(!prepared?.pipelines)throw Error('Material packet section pipelines are not prepared');
   const plan=materialPacketPlan(device.limits,{slots:material.slots,dims:material.domain.dims,pitch:material.domain.pitch,settings});const n=plan.packetCount,rays=n*n*settings.nearDirections*settings.width*settings.width;
   if(!Number.isSafeInteger(rays)||rays>0xffffffff||rays*16>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize)||Math.ceil(rays/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Common packet rays exceed effective device capacity; reduce packet density, directions or transverse resolution');
   if(!Number.isSafeInteger(triangleCount)||triangleCount<0||triangleCount*48>(triangles?.size??0))throw Error('Common packet solid data is incomplete');
   const built=builder.encode(encoder,{material,settings});const next=JSON.stringify([rays,n]);
   if(key!==next){if(resources)retire(Object.values(resources));const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;resources={params:device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),rays:device.createBuffer({size:rays*16,usage}),incident:device.createBuffer({size:n*16,usage}),emptyTriangles:device.createBuffer({size:16,usage})};key=next;}
   const r=resources,b=built.resources,data=new ArrayBuffer(48),u=new Uint32Array(data),f=new Float32Array(data);u.set([n,plan.kernels,triangleCount,0,settings.width,settings.nearDirections,settings.sections,rays]);f.set([settings.nearRatio,settings.receiverPatch,settings.gain,material.domain.pitch*.001],8);device.queue.writeBuffer(r.params,0,data);
   const buffers=[b.packets,b.kernels,r.params,r.rays,r.incident,triangles??r.emptyTriangles,b.stats],pipelines=prepared.pipelines;
   for(const [pipeline,bindings,groups,label]of [[pipelines[0],[0,1,2,3,5,6],Math.ceil(rays/64),'current packet kernel deposition and ordered transfer'],[pipelines[1],[0,2,3,4],Math.ceil(n/64),'direct packet source-range gather']]){
    const pass=encoder.beginComputePass({label});pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:{buffer:buffers[binding]}}))}));pass.dispatchWorkgroups(groups);pass.end();
   }
   identity={...material.identity};transform=structuredClone(material.domain.worldFromFine);latest={identity,settings,packetDims:plan.packetDims,packetCapacity:n,kernelCapacity:plan.kernels,source:'intrinsic-emission-only',quantity:'spherical-mean-incoming-radiance',measure:built.receipt.measure,construction:built.receipt.construction,sourceReceiverRelationship:'one current material packet identity in both roles; all emitting sources evaluated',temporalReuse:false,persistentAnchors:false,history:'fresh-only; packet advection deferred',sourceCoverage:material.coverage,visibility:triangleCount?'current finite straight-ray triangle intersections':'empty-solid-scene',work:{maximumDirectedPairs:n*n,maximumSubrays:rays,kernelCandidateTestsUpper:rays*plan.kernels,maximumSectionsPerRay:settings.sections,rawFineSlotsReadForConstruction:material.slots,rawFineSlotsSubmittedForTransport:0},bytes:plan.bytes+Object.values(r).reduce((a,b)=>a+b.size,0)};
   return {identity,centers:b.centers,radiance:r.incident,receiverCount:n,grid:{origin:[...material.domain.origin],dims:material.domain.dims.map(v=>Math.ceil(v*material.domain.pitch/(2/settings.packetWidth))),pitch:2/settings.packetWidth},maxAgeSteps:1,receipt:latest};
  },
  read:()=>latest,
  get buffers(){return {...builder.buffers,...resources};},
  async inspect(){if(!latest)return {available:false,reason:'No packet material submitted'};const source={identity:{...identity},settings:{...settings},transform,receipt:structuredClone(latest)};const b=builder.buffers;const inputs={packets:b.packets,kernels:b.kernels,stats:b.stats,bounds:b.bounds};const staging={};const e=device.createCommandEncoder({label:'inspect actual bulk packet material'});
   for(const [name,buffer]of Object.entries(inputs)){staging[name]=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyBufferToBuffer(buffer,0,staging[name],0,buffer.size);}device.queue.submit([e.finish()]);
   try{for(const buffer of Object.values(staging))await buffer.mapAsync(GPUMapMode.READ);const arrays={};for(const [name,buffer]of Object.entries(staging)){arrays[name]=(name==='stats'?new Uint32Array(buffer.getMappedRange().slice(0)):new Float32Array(buffer.getMappedRange().slice(0)));buffer.unmap();}return {available:true,...source,...arrays};}finally{Object.values(staging).forEach(b=>b.destroy());}
  },
  dispose(){builder.dispose();if(resources)retire(Object.values(resources));resources=null;latest=null;key=null;},
 };
}
