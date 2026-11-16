import {PARTICLE_BUFFER_ABI_WGSL,PARTICLE_FINE_VELOCITY_WGSL} from './volume-optical-particles.mjs';
import {createPacketBundleTransport,finitePacketBundle} from './volume-packet-bundle.mjs';
import {readOpticalAtlas} from './particle-light-slice.mjs';

export const BUNDLE_REUSE_FLOW_WGSL=/* wgsl */`
${PARTICLE_BUFFER_ABI_WGSL}
@group(0) @binding(0) var<storage,read_write> points:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> fine:array<vec4<f32>>;
@group(0) @binding(2) var<uniform> source:SourceOptions;
@group(0) @binding(3) var<uniform> u:Options;
${PARTICLE_FINE_VELOCITY_WGSL}
@compute @workgroup_size(64) fn carry(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=arrayLength(&points)){return;}
 let q=points[id.x];if(q.w==0.0){return;}
 if(!particleInsideFine(q.xyz)){points[id.x].w=0.0;return;}
 let p=q.xyz+particleFineVelocity(q.xyz)*u.time.z*u.transport.x;
 points[id.x]=vec4<f32>(p,select(0.0,1.0,particleInsideFine(p)));
}
`;

// Replay-only borrow; no per-frame browser work is installed. Reference and
// velocity are submitted together against the same immutable material identity.
export function createBundleReuseSampler(runtime,geometry){
 let device=null,transport=null,flow=null,busy=false,last=null;
 async function capture(positions=null){
  if(busy)throw Error('A bundle capture is already in flight');
  if(positions&&(!last||!positions.length))throw Error('Seed the bundle before advancing');
  busy=true;
  const buffers=[];let scoped=false,pending=null;
  try{
   const admission=runtime.submitOpticalParticleMaterial((encoder,frame,d)=>{
    if(last&&(frame.identity.epoch!==last.epoch||frame.identity.materialStamp!==last.materialStamp||frame.identity.step!==last.step+1))throw Error('Replay requires one consecutive step of the same native material');
    const s=runtime.opticalParticleSettings();
    if(!s.updateEnabled||!s.transportEnabled||s.rise!==0)throw Error('Replay requires updating Fine flow with zero authored particle rise');
    if(!frame.fine||!frame.sourceOptions)throw Error('Native Fine velocity is unavailable');
    if(device&&d!==device)throw Error('Replay GPU device changed');
    d.pushErrorScope('validation');scoped=true;
    device=d;transport??=createPacketBundleTransport(d);
    const make=(size,usage,mappedAtCreation=false)=>{const b=d.createBuffer({size,usage,mappedAtCreation});buffers.push(b);return b;};
    const {emitter,receiver,halfWidth,width,sections}=geometry,{scale,translate}=frame.domain.worldFromFine,
      toFine=p=>p.map((v,i)=>(v-translate[i])/scale);
    const a=toFine(emitter),b=toFine(receiver),far=Math.hypot(...b.map((v,i)=>v-a[i]));
    const bundle=finitePacketBundle({origin:a,target:b,halfSize:[halfWidth/scale,halfWidth/scale],far,weight:1});
    const {receipt}=transport.encode(encoder,{material:frame,bundles:[bundle],width,height:width,sections,receivers:1});
    const rowBytes=Math.ceil(receipt.atlasWidth*8/256)*256,read=make(rowBytes*receipt.atlasHeight,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    encoder.copyTextureToBuffer({texture:transport.buffers.atlas},{buffer:read,bytesPerRow:rowBytes},[receipt.atlasWidth,receipt.atlasHeight]);
    let moved=null;
    if(positions){
     const count=positions.length,n=count*16,groups=Math.ceil(count/64);
     if(groups>d.limits.maxComputeWorkgroupsPerDimension||n>d.limits.maxStorageBufferBindingSize)throw Error('Bundle positions exceed actual device capacity');
     const storage=make(n,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,true);
     const input=new Float32Array(storage.getMappedRange());
     positions.forEach((p,i)=>{if(p)input.set([...toFine(p),1],i*4);});storage.unmap();
     flow??=d.createComputePipeline({label:'advect retained light positions through Fine flow',layout:'auto',compute:{module:d.createShaderModule({code:BUNDLE_REUSE_FLOW_WGSL}),entryPoint:'carry'}});
     const bindings=d.createBindGroup({layout:flow.getBindGroupLayout(0),entries:[storage,frame.fine,frame.sourceOptions,frame.options].map((buffer,binding)=>({binding,resource:{buffer}}))});
     const pass=encoder.beginComputePass({label:'advect all retained ray sections'});pass.setPipeline(flow);pass.setBindGroup(0,bindings);pass.dispatchWorkgroups(groups);pass.end();
     moved=make(n,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);encoder.copyBufferToBuffer(storage,0,moved,0,n);
    }
    pending={read,rowBytes,receipt,moved,scale,translate:[...translate],identity:{...frame.identity}};
   });
   if(!admission.available||!pending)throw Error(admission.reason??'No current native replay capture');
   const {read,rowBytes,receipt,moved,scale,translate,identity}=pending;
   const validation=await device.popErrorScope();scoped=false;
   if(validation)throw Error(validation.message);
   await Promise.all([read.mapAsync(GPUMapMode.READ),moved?.mapAsync(GPUMapMode.READ)]);
   const moments=readOpticalAtlas(new Uint8Array(read.getMappedRange()),receipt,rowBytes);
   const data=moved&&new Float32Array(moved.getMappedRange());
   const next=data?Array.from({length:positions.length},(_,i)=>data[4*i+3]===1?[0,1,2].map(c=>data[4*i+c]*scale+translate[c]):null):null;
   if(next?.some(p=>p?.some(v=>!Number.isFinite(v))))throw Error('Non-finite native Fine advection result');
   last=identity;
   return {...geometry,identity,moments,positions:next,route:'native-particle-bundle / same-material Fine velocity',
    flowModel:'pointwise one-step Fine flow, fixed reconstruction support, carried emission, fixed extinction'};
  }finally{if(scoped)await device?.popErrorScope().catch(()=>{});buffers.forEach(b=>b.destroy());busy=false;}
 }
 return {capture,dispose(){transport?.dispose();transport=null;}};
}
