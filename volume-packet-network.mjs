import {PARTICLE_LIGHT_MATERIAL_WGSL} from './volume-optical-particles.mjs';
import {PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';
import {PACKET_BUNDLE_STRUCT_WGSL,packetBundlePlan,createPacketBundleTransport} from './volume-packet-bundle.mjs';

export function packetNetworkSettings(input={}){
 const s={mode:"fine-reference",view:"off",packetWidth:4,materialSubdivisions:1,receiverBlend:1.25,receiverPatch:.25,packetSmoothing:1,supportSigmas:3,receivers:8,sources:2,width:8,sections:16,nearDirections:6,receiverRadius:.6,nearRatio:.75,gain:1,...input};
 for(const key of Object.keys(s))if(!['mode','view','packetWidth','materialSubdivisions','receiverBlend','receiverPatch','packetSmoothing','supportSigmas','receivers','sources','width','sections','nearDirections','receiverRadius','nearRatio','gain'].includes(key))throw Error('Unknown packet network setting '+key);
 if(!['off','packets','emission','extinction'].includes(s.view))throw Error('Unknown packet support view');
 if(!['fine-reference','material-packets'].includes(s.mode))throw Error('Unknown packet network mode');
 for(const key of ['packetWidth','materialSubdivisions','receivers','sources','width','sections','nearDirections'])if(!Number.isSafeInteger(s[key])||s[key]<1||s[key]>0xffffffff)throw Error('Invalid packet network '+key);
 for(const key of ['receiverRadius','nearRatio','receiverBlend','receiverPatch','packetSmoothing','supportSigmas'])if(!(s[key]>0&&Number.isFinite(Math.fround(s[key]))))throw Error('Invalid packet network '+key);
 if(!(s.gain>=0&&Number.isFinite(Math.fround(s.gain))))throw Error('Invalid packet network gain');return s;
}

// Source partitions reduce the current medium. Their query anchors survive
// only while the primary carrier's epoch/slot/birth identity is still live.
// This anchors motion; it does not certify a retained light observation.
export const PACKET_NETWORK_WGSL=/* wgsl */`${PARTICLE_LIGHT_MATERIAL_WGSL}${PARTICLE_STATE_WGSL}${PACKET_BUNDLE_STRUCT_WGSL}
struct PacketGroup {center:vec4<f32>,lo:vec4<f32>,hi:vec4<f32>}
struct Network {counts:vec4<u32>,quality:vec4<f32>}
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<uniform> optical:Options;
@group(0) @binding(2) var<uniform> net:Network;
@group(0) @binding(3) var<storage,read_write> seeds:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> membership:array<u32>;
@group(0) @binding(5) var<storage,read_write> groups:array<PacketGroup>;
@group(0) @binding(6) var<storage,read_write> receivers:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read_write> bundles:array<Bundle>;
@group(0) @binding(8) var<storage,read> birthGenerations:array<u32>;
@group(0) @binding(9) var<storage,read_write> sourceKeys:array<vec2<u32>>;
@group(0) @binding(10) var<storage,read_write> receiverKeys:array<vec2<u32>>;
var<workgroup> sums:array<vec4<f32>,64>;
var<workgroup> lower:array<vec3<f32>,64>;
var<workgroup> upper:array<vec3<f32>,64>;
var<workgroup> intervals:array<f32,64>;
var<workgroup> selected:array<u32,64>;
fn packetKeyLive(key:vec2<u32>)->bool{
 return key.x<net.counts.x&&key.y>0u&&key.y<0xffffffffu&&birthGenerations[key.x]==key.y&&particles[key.x].anchor.w>0;
}
fn packetPower(p:Particle)->f32{
 if(p.anchor.w<=0){return 0.0;}let radius=particleLightBaseRadius(p,optical);
 let fade=select(1.0,particleLifeFade(p.motion.w,optical.lifeControl.y),optical.lifeControl.x>0);
 // Importance only. This area/interval proxy is not exported emitted power.
 return max(0.0,dot(particleLightIntrinsic(p),vec3<f32>(.2126,.7152,.0722)))*p.shape.w*radius.x*radius.y*fade;
}
@compute @workgroup_size(64) fn sourceSeeds(@builtin(workgroup_id) id:vec3<u32>,@builtin(local_invocation_index) tid:u32){
 let group=id.x;let first=group*net.counts.x/net.counts.z;let end=(group+1u)*net.counts.x/net.counts.z;var chosen=vec4<f32>(0);var slot=0u;
 let old=sourceKeys[group];let keep=packetKeyLive(old);
 if(!keep){for(var i=first+tid;i<end;i+=64u){let p=particles[i];let w=packetPower(p);let generation=birthGenerations[i];if(w>chosen.w&&generation>0u&&generation<0xffffffffu){chosen=vec4<f32>(p.anchor.xyz,w);slot=i;}}}
 sums[tid]=chosen;selected[tid]=slot;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(tid<stride&&sums[tid+stride].w>sums[tid].w){sums[tid]=sums[tid+stride];selected[tid]=selected[tid+stride];}workgroupBarrier();}
 if(tid==0u){if(keep){seeds[group]=vec4<f32>(particles[old.x].anchor.xyz,1);}else{var key=vec2<u32>(0);if(sums[0].w>0){key=vec2<u32>(selected[0],birthGenerations[selected[0]]);}sourceKeys[group]=key;seeds[group]=vec4<f32>(sums[0].xyz,select(0.0,1.0,key.y>0u));}}
}
@compute @workgroup_size(64) fn assignSources(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=net.counts.x){return;}let p=particles[i];var selected=0xffffffffu;var nearest=3.402823e38;
 if(packetPower(p)>0){for(var g=0u;g<net.counts.z;g++){if(seeds[g].w<=0){continue;}let delta=p.anchor.xyz-seeds[g].xyz;let d=dot(delta,delta);if(d<nearest){nearest=d;selected=g;}}}
 membership[i]=selected;
}
@compute @workgroup_size(64) fn refitSources(@builtin(workgroup_id) id:vec3<u32>,@builtin(local_invocation_index) tid:u32){
 let group=id.x;var sum=vec4<f32>(0);var lo=vec3<f32>(3.402823e38);var hi=-lo;var halfInterval=0.0;
 for(var i=tid;i<net.counts.x;i+=64u){if(membership[i]!=group){continue;}let p=particles[i];let w=packetPower(p);sum+=vec4<f32>(p.anchor.xyz*w,w);
  // Conservative envelope for all rotated projected base supports.
  let r=2.5*length(particleLightBaseRadius(p,optical));lo=min(lo,p.anchor.xyz-vec3<f32>(r));hi=max(hi,p.anchor.xyz+vec3<f32>(r));halfInterval=max(halfInterval,p.shape.w*.5);}
 sums[tid]=sum;lower[tid]=lo;upper[tid]=hi;intervals[tid]=halfInterval;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(tid<stride){sums[tid]+=sums[tid+stride];lower[tid]=min(lower[tid],lower[tid+stride]);upper[tid]=max(upper[tid],upper[tid+stride]);intervals[tid]=max(intervals[tid],intervals[tid+stride]);}workgroupBarrier();}
 if(tid==0u){var g:PacketGroup;if(sums[0].w>0){g.center=vec4<f32>(sums[0].xyz/sums[0].w,sums[0].w);g.lo=vec4<f32>(lower[0],1);g.hi=vec4<f32>(upper[0],intervals[0]);}groups[group]=g;}
}
@compute @workgroup_size(64) fn receiverSeeds(@builtin(workgroup_id) id:vec3<u32>,@builtin(local_invocation_index) tid:u32){
 let group=id.x;let first=group*net.counts.x/net.counts.y;let end=(group+1u)*net.counts.x/net.counts.y;var chosen=vec4<f32>(0);var slot=0u;
 let old=receiverKeys[group];var keep=packetKeyLive(old);if(keep){let p=particles[old.x];keep=packetPower(p)+particleLightExtinction(p,optical)*p.shape.w>0;}
 if(!keep){for(var i=first+tid;i<end;i+=64u){let p=particles[i];let generation=birthGenerations[i];if(p.anchor.w<=0||generation==0u||generation==0xffffffffu){continue;}let importance=packetPower(p)+particleLightExtinction(p,optical)*p.shape.w;
  if(importance>chosen.w){chosen=vec4<f32>(p.anchor.xyz,importance);slot=i;}}}
 sums[tid]=chosen;selected[tid]=slot;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(tid<stride&&sums[tid+stride].w>sums[tid].w){sums[tid]=sums[tid+stride];selected[tid]=selected[tid+stride];}workgroupBarrier();}
 if(tid==0u){if(keep){receivers[group]=vec4<f32>(particles[old.x].anchor.xyz,net.quality.x);}else{var key=vec2<u32>(0);if(sums[0].w>0){key=vec2<u32>(selected[0],birthGenerations[selected[0]]);}receiverKeys[group]=key;receivers[group]=vec4<f32>(sums[0].xyz,select(0.0,net.quality.x,key.y>0u));}}
}
@compute @workgroup_size(64) fn buildBundles(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=net.counts.y*net.counts.z*net.counts.w){return;}
 let pair=i/net.counts.w;let face=i%net.counts.w;let receiver=pair/net.counts.z;let source=pair%net.counts.z;let r=receivers[receiver];let g=groups[source];
 var b:Bundle;b.ids=vec4<u32>(receiver,source,face,0);b.origin=vec4<f32>(r.xyz,0);b.forward=vec4<f32>(0,0,1,1);b.right=vec4<f32>(1,0,0,1);b.up=vec4<f32>(0,1,0,1);
 if(r.w<=0||g.center.w<=0){bundles[i]=b;return;}
 let delta=g.center.xyz-r.xyz;let distance=length(delta);let extent=(g.hi.xyz-g.lo.xyz)*.5;let middle=(g.hi.xyz+g.lo.xyz)*.5-r.xyz;
 let ratio=(length(extent)+g.hi.w)/max(distance,1e-20);let close=ratio>net.quality.y;
 if(!close&&face>0u){bundles[i]=b;return;}
 var forward=vec3<f32>(0,0,1);if(distance>0){forward=delta/distance;}
 if(close){if(net.counts.w==6u){let directions=array<vec3<f32>,6>(vec3<f32>(1,0,0),vec3<f32>(-1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,-1,0),vec3<f32>(0,0,1),vec3<f32>(0,0,-1));forward=directions[face];}
  else{let z=1.0-2.0*(f32(face)+.5)/f32(net.counts.w);let phi=f32(face)*2.399963229728653;let r=sqrt(max(0.0,1.0-z*z));forward=vec3<f32>(r*cos(phi),r*sin(phi),z);}}
 let seed=select(vec3<f32>(0,1,0),vec3<f32>(1,0,0),abs(forward.y)>.9);let right=normalize(cross(seed,forward));let up=cross(forward,right);
 // The directional interval is independent of transverse support. Extend
 // only axial reach; do not turn the acquired length into transverse area.
 let far=dot(middle,forward)+dot(extent,abs(forward))+g.hi.w;
 if(far<=0){bundles[i]=b;return;}
 var halfSize=max(vec2<f32>(net.quality.z),vec2<f32>(abs(dot(middle,right))+dot(extent,abs(right)),abs(dot(middle,up))+dot(extent,abs(up))));
 if(close){halfSize=vec2<f32>(r.w);}
 var weight=atan2(halfSize.x*halfSize.y,max(distance,1e-20)*sqrt(distance*distance+dot(halfSize,halfSize)))/3.141592653589793;
 if(close){weight=1.0/f32(net.counts.w);}
 b.forward=vec4<f32>(forward,far);b.right=vec4<f32>(right,halfSize.x);b.up=vec4<f32>(up,halfSize.y);b.weight=vec4<f32>(weight*net.quality.w,ratio,select(0.0,1.0,close),0);bundles[i]=b;
}
`;

export function createPacketNetwork(device){
 const module=device.createShaderModule({label:'current material packet network',code:PACKET_NETWORK_WGSL}),transport=createPacketBundleTransport(device),pipelines={};
 let resources=null,key=null,latest=null,epoch=null;const retire=items=>queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>items.forEach(b=>b.destroy())));
 let preparing=null;
 return {
  prepare(){return preparing??=Promise.all([transport.prepare(),...['sourceSeeds','assignSources','refitSources','receiverSeeds','buildBundles'].map(async entry=>{pipelines[entry]=await device.createComputePipelineAsync({label:'packet network '+entry,layout:'auto',compute:{module,entryPoint:entry}});})]);},
  encode(encoder,{material,settings,triangles=null,triangleCount=0}){
   if(!material.birthGenerations||material.birthGenerations.size<material.slots*4)throw Error('Packet anchors require current primary birth generations');
   const s=packetNetworkSettings(settings),count=s.receivers*s.sources*s.nearDirections;
   const plan=packetBundlePlan(device.limits,{width:s.width,height:s.width,sections:s.sections,bundles:count,slots:material.slots,receivers:s.receivers});
   if(Math.max(s.sources,s.receivers)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Packet network exceeds effective reduction dispatch');
   const next=JSON.stringify([material.slots,s.receivers,s.sources]);
   if(next!==key){if(resources)retire(Object.values(resources));const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
    resources={params:device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),seeds:device.createBuffer({size:s.sources*16,usage:storage}),membership:device.createBuffer({size:material.slots*4,usage:storage}),groups:device.createBuffer({size:s.sources*48,usage:storage}),centers:device.createBuffer({size:s.receivers*16,usage:storage}),bundles:device.createBuffer({size:count*96,usage:storage}),sourceKeys:device.createBuffer({size:s.sources*8,usage:storage}),receiverKeys:device.createBuffer({size:s.receivers*8,usage:storage})};key=next;epoch=null;}
   if(epoch!==material.identity.epoch){encoder.clearBuffer(resources.sourceKeys);encoder.clearBuffer(resources.receiverKeys);epoch=material.identity.epoch;}
   if(resources.bundles.size!==count*96){retire([resources.bundles]);resources.bundles=device.createBuffer({size:count*96,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});}
   const r=resources,data=new ArrayBuffer(32);new Uint32Array(data).set([material.slots,s.receivers,s.sources,s.nearDirections]);new Float32Array(data).set([s.receiverRadius,s.nearRatio,material.domain.pitch,s.gain],4);device.queue.writeBuffer(r.params,0,data);
   for(const [entry,entries,groups] of [
    ['sourceSeeds',[[0,material.particles],[1,material.options],[2,r.params],[3,r.seeds],[8,material.birthGenerations],[9,r.sourceKeys]],s.sources],
    ['assignSources',[[0,material.particles],[1,material.options],[2,r.params],[3,r.seeds],[4,r.membership]],Math.ceil(material.slots/64)],
    ['refitSources',[[0,material.particles],[1,material.options],[2,r.params],[4,r.membership],[5,r.groups]],s.sources],
    ['receiverSeeds',[[0,material.particles],[1,material.options],[2,r.params],[6,r.centers],[8,material.birthGenerations],[10,r.receiverKeys]],s.receivers],
    ['buildBundles',[[2,r.params],[5,r.groups],[6,r.centers],[7,r.bundles]],Math.ceil(count/64)]]){
    const p=pipelines[entry]??=device.createComputePipeline({label:'packet network '+entry,layout:'auto',compute:{module,entryPoint:entry}});
    const bind=device.createBindGroup({layout:p.getBindGroupLayout(0),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))});
    const pass=encoder.beginComputePass({label:'packet network '+entry});pass.setPipeline(p);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(groups);pass.end();
   }
   const result=transport.encode(encoder,{material,bundles:{buffer:r.bundles,count},membership:r.membership,width:s.width,height:s.width,sections:s.sections,receivers:s.receivers,triangles,triangleCount});
   const domain=material.domain,extent=domain.dims.map(n=>n*domain.pitch),pitch=s.receiverRadius;
   latest={...result.receipt,settings:s,sourcePartition:'current disjoint membership around surviving primary anchors; every source member retained',receivers:'primary epoch/slot/birth anchors; reseeded on replacement or loss',near:s.nearDirections===6?'six-axis spherical quadrature inside broad source support':'fixed spherical Fibonacci quadrature inside broad source support',far:'orthographic source footprint; finite rectangular solid angle',sourceCoverage:'current admitted optical particles only',temporalReuse:false,persistentAnchors:true,bytes:plan.bytes+Object.values(r).reduce((sum,b)=>sum+b.size,0)};
   return {identity:result.identity,centers:r.centers,radiance:result.buffer,receiverCount:s.receivers,grid:{origin:[...domain.origin],dims:extent.map(n=>Math.ceil(n/pitch)),pitch},maxAgeSteps:1,receipt:latest};
  },
  read:()=>latest,
  get buffers(){return {...resources,...(transport.buffers?{transport:transport.buffers}:{})};},
  dispose(){transport.dispose();if(resources)retire(Object.values(resources));resources=null;key=null;latest=null;epoch=null;},
 };
}
