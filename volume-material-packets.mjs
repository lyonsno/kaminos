import {PARTICLE_LIGHT_MATERIAL_WGSL} from './volume-optical-particles.mjs';
import {PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';
import {opticalGaussian,gaussianNormalInterval} from './volume-optical-gaussian.mjs';
import {packetNetworkSettings} from './volume-packet-network.mjs';

export const MATERIAL_PACKET_STRUCT_WGSL=/* wgsl */`
struct MaterialKernel {center:vec4<f32>,q0:vec4<f32>,q1:vec4<f32>,q2:vec4<f32>,amount:vec4<f32>,lo:vec4<f32>,hi:vec4<f32>,tags:vec4<u32>}
struct MaterialPacket {center:vec4<f32>,lo:vec4<f32>,hi:vec4<f32>,power:vec4<f32>}
struct PacketBuild {counts:vec4<u32>,packets:vec4<u32>,shape:vec4<f32>,measure:vec4<f32>}
`;
export function materialPacketPlan(limits,{slots,dims,pitch,settings}){
 const s=packetNetworkSettings(settings),packetDims=[s.packetWidth,Math.ceil(s.packetWidth*dims[1]/dims[0]),Math.ceil(s.packetWidth*dims[2]/dims[0])];
 const leafDims=packetDims.map(x=>x*s.materialSubdivisions),packetCount=packetDims.reduce((a,b)=>a*b,1),leaves=leafDims.reduce((a,b)=>a*b,1),kernels=leaves*2,partials=Math.ceil(slots/128);
 for(const n of [slots,packetCount,leaves,kernels,partials])if(!Number.isSafeInteger(n)||n<1||n>0xffffffff)throw Error('Material packet count exceeds u32 capacity');
 const sizes={params:64,bounds:32,partials:partials*32,counts:leaves*4,cursors:leaves*4,offsets:(leaves+1)*4,ids:slots*4,membership:slots*4,kernels:kernels*128,leaves:leaves*64,packets:packetCount*64,centers:packetCount*16,stats:64};
 for(const [k,n]of Object.entries(sizes))if(n>Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize))throw Error('Material packet '+k+' exceeds effective device buffer capacity');
 for(const n of [partials,Math.ceil(slots/64),leaves,Math.ceil(packetCount/64)])if(n>limits.maxComputeWorkgroupsPerDimension)throw Error('Material packet dispatch exceeds effective device capacity');
 return {slots,packetDims,leafDims,packetCount,leaves,kernels,partials,pitch,sizes,settings:s,bytes:Object.values(sizes).reduce((a,b)=>a+b,0)};
}
export const MATERIAL_PACKET_BUILD_WGSL=/* wgsl */`${PARTICLE_LIGHT_MATERIAL_WGSL}${PARTICLE_STATE_WGSL}${MATERIAL_PACKET_STRUCT_WGSL}
@group(0) @binding(0) var<storage,read> primary:array<Particle>;
@group(0) @binding(1) var<uniform> optics:Options;
@group(0) @binding(2) var<uniform> plan:PacketBuild;
@group(0) @binding(3) var<storage,read_write> partial:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> bounds:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read_write> offsets:array<u32>;
@group(0) @binding(7) var<storage,read_write> cursors:array<atomic<u32>>;
@group(0) @binding(8) var<storage,read_write> ids:array<u32>;
@group(0) @binding(9) var<storage,read_write> membership:array<u32>;
@group(0) @binding(10) var<storage,read_write> kernels:array<MaterialKernel>;
@group(0) @binding(11) var<storage,read_write> leafMaterial:array<vec4<f32>>;
@group(0) @binding(12) var<storage,read_write> packets:array<MaterialPacket>;
@group(0) @binding(13) var<storage,read_write> centers:array<vec4<f32>>;
@group(0) @binding(14) var<storage,read_write> stats:array<atomic<u32>>;
var<workgroup> lower:array<vec4<f32>,128>;
var<workgroup> upper:array<vec4<f32>,128>;
fn useful(p:Particle)->bool{return p.anchor.w>0&&p.shape.w>0&&(any(particleLightIntrinsic(p)>vec3<f32>(0))||particleLightExtinction(p,optics)>0);}
@compute @workgroup_size(128) fn materialBounds(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) tid:u32,@builtin(workgroup_id) group:vec3<u32>){
 var lo=vec3<f32>(3.402823e38);var hi=-lo;var n=0.0;
 if(id.x<plan.counts.x){let p=primary[id.x];if(useful(p)){let radius=2.5*length(particleLightBaseRadius(p,optics));lo=p.anchor.xyz-vec3<f32>(radius);hi=p.anchor.xyz+vec3<f32>(radius);n=1;}}
 lower[tid]=vec4<f32>(lo,n);upper[tid]=vec4<f32>(hi,0);workgroupBarrier();
 for(var k=64u;k>0u;k/=2u){if(tid<k){lower[tid]=vec4<f32>(min(lower[tid].xyz,lower[tid+k].xyz),lower[tid].w+lower[tid+k].w);upper[tid]=vec4<f32>(max(upper[tid].xyz,upper[tid+k].xyz),0);}workgroupBarrier();}
 if(tid==0u){partial[group.x*2u]=lower[0];partial[group.x*2u+1u]=upper[0];}
}
@compute @workgroup_size(128) fn reduceBounds(@builtin(local_invocation_index) tid:u32){
 var lo=vec3<f32>(3.402823e38);var hi=-lo;var n=0.0;let length=(plan.counts.x+127u)/128u;
 for(var i=tid;i<length;i+=128u){let v=partial[2u*i];if(v.w>0){lo=min(lo,v.xyz);hi=max(hi,partial[2u*i+1u].xyz);n+=v.w;}}
 lower[tid]=vec4<f32>(lo,n);upper[tid]=vec4<f32>(hi,0);workgroupBarrier();
 for(var k=64u;k>0u;k/=2u){if(tid<k){lower[tid]=vec4<f32>(min(lower[tid].xyz,lower[tid+k].xyz),lower[tid].w+lower[tid+k].w);upper[tid]=vec4<f32>(max(upper[tid].xyz,upper[tid+k].xyz),0);}workgroupBarrier();}
 if(tid==0u){if(lower[0].w>0){let lo=lower[0].xyz;bounds[0]=vec4<f32>(lo,lower[0].w);bounds[1]=vec4<f32>(max(upper[0].xyz,lo+vec3<f32>(plan.shape.w)),0);}else{bounds[0]=vec4<f32>(-1,-1,-1,0);bounds[1]=vec4<f32>(1,1,1,0);}}
}
fn leafAt(p:vec3<f32>)->u32{let dims=plan.counts.yzw;let q=min(vec3<u32>(clamp((p-bounds[0].xyz)/(bounds[1].xyz-bounds[0].xyz),vec3<f32>(0),vec3<f32>(1))*vec3<f32>(dims)),dims-vec3<u32>(1));return q.x+dims.x*(q.y+dims.y*q.z);}
@compute @workgroup_size(64) fn countMaterial(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=plan.counts.x){return;}membership[i]=0xffffffffu;if(useful(primary[i])){let cell=leafAt(primary[i].anchor.xyz);membership[i]=cell;atomicAdd(&counts[cell],1u);}}
@compute @workgroup_size(1) fn prefixMaterial(){let total=plan.counts.y*plan.counts.z*plan.counts.w;var offset=0u;for(var i=0u;i<total;i++){offsets[i]=offset;offset+=atomicLoad(&counts[i]);atomicStore(&cursors[i],0u);}offsets[total]=offset;}
@compute @workgroup_size(64) fn scatterMaterial(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=plan.counts.x){return;}let cell=membership[i];if(cell!=0xffffffffu){ids[offsets[cell]+atomicAdd(&cursors[cell],1u)]=i;}}
struct Moment {emission:vec4<f32>,ef:vec4<f32>,ed:vec4<f32>,ec:vec4<f32>,tf:vec4<f32>,td:vec4<f32>,tc:vec4<f32>,bulk:vec4<f32>,blo:vec4<f32>,bhi:vec4<f32>}
var<workgroup> moments:array<Moment,64>;
fn crossTerms(p:vec3<f32>)->vec3<f32>{return vec3<f32>(p.x*p.y,p.x*p.z,p.y*p.z);}
fn fittedKernel(first:vec4<f32>,diag:vec3<f32>,off:vec3<f32>,amount:vec4<f32>,origin:vec3<f32>,parent:u32,role:u32,count:u32)->MaterialKernel{
 var out:MaterialKernel;out.tags=vec4<u32>(parent,role,count,0);if(first.w<=0){return out;}let mean=first.xyz/first.w;
 var d=max(vec3<f32>(0),diag/first.w-mean*mean);let o=off/first.w-crossTerms(mean);
 let ridge=max(plan.shape.w*plan.shape.w*1e-8,dot(d,vec3<f32>(1))*1e-5);d+=vec3<f32>(ridge);let scale=plan.shape.y*plan.shape.y;
 let c=mat3x3<f32>(vec3<f32>(d.x,o.x,o.y)*scale,vec3<f32>(o.x,d.y,o.z)*scale,vec3<f32>(o.y,o.z,d.z)*scale);
 let a=cross(c[1],c[2]);let b=cross(c[2],c[0]);let cc=cross(c[0],c[1]);let det=dot(c[0],a);if(!(det>0)){return out;}let q=transpose(mat3x3<f32>(a,b,cc))*(1.0/det);
 out.center=vec4<f32>(origin+mean,plan.measure.x/sqrt(det));out.q0=vec4<f32>(q[0],plan.shape.x);out.q1=vec4<f32>(q[1],0);out.q2=vec4<f32>(q[2],0);out.amount=amount;
 let extent=plan.shape.x*sqrt(vec3<f32>(c[0].x,c[1].y,c[2].z));out.lo=vec4<f32>(out.center.xyz-extent,0);out.hi=vec4<f32>(out.center.xyz+extent,0);out.tags.w=1u;return out;
}
@compute @workgroup_size(64) fn fitMaterial(@builtin(workgroup_id) gid:vec3<u32>,@builtin(local_invocation_index) tid:u32){
 let cell=gid.x;let dims=plan.counts.yzw;let xyz=vec3<u32>(cell%dims.x,cell/dims.x%dims.y,cell/(dims.x*dims.y));let cellWidth=(bounds[1].xyz-bounds[0].xyz)/vec3<f32>(dims);let origin=bounds[0].xyz+(vec3<f32>(xyz)+.5)*cellWidth;
 var m:Moment;m.blo=vec4<f32>(3.402823e38);m.bhi=-m.blo;
 for(var at=offsets[cell]+tid;at<offsets[cell+1u];at+=64u){let p=primary[ids[at]];let radius=particleLightBaseRadius(p,optics);let fade=select(1.0,particleLifeFade(p.motion.w,optics.lifeControl.y),optics.lifeControl.x>0);let volume=radius.x*radius.y*p.shape.w*plan.measure.y;let e=max(vec3<f32>(0),particleLightIntrinsic(p)*optics.gain.x*fade)*volume;let ew=dot(e,vec3<f32>(.2126,.7152,.0722));let tw=particleLightExtinction(p,optics)*optics.material.w*optics.gain.y*fade*volume;
  let pos=p.anchor.xyz-origin;var y=vec3<f32>(0,1,0);if(optics.raster.z>0){let v=mix(y,particleDirectionDecode(p.shape.yz),optics.raster.z);if(dot(v,v)>1e-10){y=normalize(v);}}let x=normalize(cross(y,select(vec3<f32>(0,0,1),vec3<f32>(1,0,0),abs(y.z)>.99)));let z=cross(x,y);
  let vd=x*x*radius.x*radius.x+y*y*radius.y*radius.y+z*z*radius.z*radius.z;
  let vc=crossTerms(x)*radius.x*radius.x+crossTerms(y)*radius.y*radius.y+crossTerms(z)*radius.z*radius.z;
  m.emission+=vec4<f32>(e,ew);m.ef+=vec4<f32>(pos*ew,ew);m.ed+=vec4<f32>((pos*pos+vd)*ew,0);m.ec+=vec4<f32>((crossTerms(pos)+vc)*ew,0);
  m.tf+=vec4<f32>(pos*tw,tw);m.td+=vec4<f32>((pos*pos+vd)*tw,0);m.tc+=vec4<f32>((crossTerms(pos)+vc)*tw,0);m.bulk+=vec4<f32>(p.anchor.xyz*volume,volume);let materialExtent=plan.shape.x*plan.shape.y*sqrt(vd);m.blo=min(m.blo,vec4<f32>(p.anchor.xyz-materialExtent,0));m.bhi=max(m.bhi,vec4<f32>(p.anchor.xyz+materialExtent,0));
 }
 moments[tid]=m;workgroupBarrier();for(var k=32u;k>0u;k/=2u){if(tid<k){let n=moments[tid+k];moments[tid].emission+=n.emission;moments[tid].ef+=n.ef;moments[tid].ed+=n.ed;moments[tid].ec+=n.ec;moments[tid].tf+=n.tf;moments[tid].td+=n.td;moments[tid].tc+=n.tc;moments[tid].bulk+=n.bulk;moments[tid].blo=min(moments[tid].blo,n.blo);moments[tid].bhi=max(moments[tid].bhi,n.bhi);}workgroupBarrier();}
 if(tid==0u){let m=moments[0];let parentXYZ=xyz/plan.packets.w;let parent=parentXYZ.x+plan.packets.x*(parentXYZ.y+plan.packets.y*parentXYZ.z);let count=atomicLoad(&counts[cell]);kernels[2u*cell]=fittedKernel(m.ef,m.ed.xyz,m.ec.xyz,vec4<f32>(m.emission.xyz,0),origin,parent,0u,count);kernels[2u*cell+1u]=fittedKernel(m.tf,m.td.xyz,m.tc.xyz,vec4<f32>(0,0,0,m.tf.w),origin,parent,1u,count);leafMaterial[4u*cell]=m.bulk;leafMaterial[4u*cell+1u]=vec4<f32>(m.emission.xyz,m.tf.w);leafMaterial[4u*cell+2u]=m.blo;leafMaterial[4u*cell+3u]=m.bhi;}
}
@compute @workgroup_size(64) fn summarizePackets(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;let pd=plan.packets.xyz;if(i>=pd.x*pd.y*pd.z){return;}let at=vec3<u32>(i%pd.x,i/pd.x%pd.y,i/(pd.x*pd.y));let sub=plan.packets.w;let ld=plan.counts.yzw;var p:MaterialPacket;var bulk=vec4<f32>(0);var lo=vec3<f32>(3.402823e38);var hi=-lo;var members=0u;
 for(var z=0u;z<sub;z++){for(var y=0u;y<sub;y++){for(var x=0u;x<sub;x++){let c=at*sub+vec3<u32>(x,y,z);let leaf=c.x+ld.x*(c.y+ld.y*c.z);bulk+=leafMaterial[4u*leaf];p.power+=leafMaterial[4u*leaf+1u];if(atomicLoad(&counts[leaf])>0u&&kernels[2u*leaf].tags.w==0u&&kernels[2u*leaf+1u].tags.w==0u){lo=min(lo,leafMaterial[4u*leaf+2u].xyz);hi=max(hi,leafMaterial[4u*leaf+3u].xyz);}members+=atomicLoad(&counts[leaf]);for(var role=0u;role<2u;role++){let k=kernels[2u*leaf+role];if(k.tags.w!=0u){lo=min(lo,k.lo.xyz);hi=max(hi,k.hi.xyz);}}}}}
 if(bulk.w>0){let center=bulk.xyz/bulk.w;let radius=length(max(abs(lo-center),abs(hi-center)))*plan.shape.z;p.center=vec4<f32>(center,max(radius,plan.shape.w*.01));p.lo=vec4<f32>(lo,bulk.w);p.hi=vec4<f32>(hi,f32(members));atomicAdd(&stats[0],1u);if(any(p.power.xyz>vec3<f32>(0))){atomicAdd(&stats[1],1u);}}
 packets[i]=p;centers[i]=p.center;
}
`;

export function createMaterialPacketBuilder(device){
 const module=device.createShaderModule({label:'current primary material packets',code:MATERIAL_PACKET_BUILD_WGSL}),pipelines={};let resources=null,key=null,latest=null;
 const retire=items=>queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>items.forEach(b=>b.destroy())));
 const entries={materialBounds:[0,1,2,3],reduceBounds:[2,3,4],countMaterial:[0,1,2,4,5,9],prefixMaterial:[2,5,6,7],scatterMaterial:[2,6,7,8,9],fitMaterial:[0,1,2,4,5,6,8,10,11],summarizePackets:[2,5,10,11,12,13,14]};
 return {
  prepare(){return Promise.all(Object.keys(entries).map(async entry=>{pipelines[entry]??=await device.createComputePipelineAsync({label:'material packets '+entry,layout:'auto',compute:{module,entryPoint:entry}});}));},
  encode(encoder,{material,settings}){
   const plan=materialPacketPlan(device.limits,{slots:material.slots,dims:material.domain.dims,pitch:material.domain.pitch,settings});const s=plan.settings;
   const next=JSON.stringify([material.slots,plan.leafDims,s.materialSubdivisions]);
   if(key!==next){if(resources)retire(Object.values(resources));resources={};for(const [name,size]of Object.entries(plan.sizes))resources[name]=device.createBuffer({label:'material packets '+name,size,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST|(name==='params'?GPUBufferUsage.UNIFORM:GPUBufferUsage.STORAGE)});key=next;}
   const r=resources,data=new ArrayBuffer(64),u=new Uint32Array(data),f=new Float32Array(data);u.set([material.slots,...plan.leafDims,...plan.packetDims,s.materialSubdivisions]);f.set([s.supportSigmas,s.packetSmoothing,s.receiverBlend,material.domain.pitch],8);
   const unit=opticalGaussian({id:0,center:[0,0,0],radii:[1,1,1],supportSigmas:s.supportSigmas});f.set([unit.normalization,2*Math.PI*gaussianNormalInterval(-2.5,2.5)**2,0,0],12);device.queue.writeBuffer(r.params,0,data);encoder.clearBuffer(r.counts);encoder.clearBuffer(r.stats);
   const buffers={0:material.particles,1:material.options,2:r.params,3:r.partials,4:r.bounds,5:r.counts,6:r.offsets,7:r.cursors,8:r.ids,9:r.membership,10:r.kernels,11:r.leaves,12:r.packets,13:r.centers,14:r.stats};
   for(const [entry,count]of [['materialBounds',plan.partials],['reduceBounds',1],['countMaterial',Math.ceil(material.slots/64)],['prefixMaterial',1],['scatterMaterial',Math.ceil(material.slots/64)],['fitMaterial',plan.leaves],['summarizePackets',Math.ceil(plan.packetCount/64)]]){
    const pipeline=pipelines[entry];if(!pipeline)throw Error('Material packet pipelines are not prepared');const pass=encoder.beginComputePass({label:'material packets '+entry});pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries[entry].map(binding=>({binding,resource:{buffer:buffers[binding]}}))}));pass.dispatchWorkgroups(count);pass.end();
   }
   latest={...plan,identity:{...material.identity},construction:'fresh center partition; separate normalized emission/extinction spatial moments',measure:'reference-profile-area times base-radius-XY times represented interval; a declared coarse volume proxy',temporalReuse:false};return {plan,resources:r,identity:{...material.identity},receipt:latest};
  },
  get buffers(){return resources;},read:()=>latest,
  dispose(){if(resources)retire(Object.values(resources));resources=null;key=null;latest=null;},
 };
}
