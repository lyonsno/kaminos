const u32=(value,min=0)=>Number.isSafeInteger(value)&&value>=min&&value<=0xffffffff;
export function checkedOpticalPacketIncident(field,source,limits,storageUsage){
 if(field===null)return null;
 if(!source||field?.identity?.epoch!==source.epoch)throw Error('Packet incident field belongs to a different material epoch');
 const {identity,centers,radiance,receiverCount,grid,maxAgeSteps=1}=field;
 if(!u32(identity.step)||!u32(identity.frame,1)||identity.step>source.step||identity.frame>source.frame)throw Error('Packet incident field identity is invalid or in the future');
 if(!u32(maxAgeSteps)||!u32(receiverCount,1))throw Error('Invalid packet incident count or max age');
 const limit=Math.min(limits.maxStorageBufferBindingSize,limits.maxBufferSize);
 for(const [name,buffer] of Object.entries({centers,radiance})){
  if(!buffer||!(buffer.usage&storageUsage)||buffer.size<16*receiverCount||16*receiverCount>limit)throw Error('Invalid packet incident '+name+' buffer');
 }
 if(!grid?.origin||grid.origin.length!==3||grid.origin.some(x=>!Number.isFinite(Math.fround(x)))||
    !grid.dims||grid.dims.length!==3||grid.dims.some(x=>!u32(x,1))||!Number.isFinite(Math.fround(grid.pitch))||!(Math.fround(grid.pitch)>0)){
  throw Error('Invalid packet incident search grid');
 }
 const cells=grid.dims.reduce((a,b)=>a*b,1);
 if(!u32(cells,1)||4*(cells+2)>limit||4*receiverCount>limit||Math.ceil(receiverCount/64)>limits.maxComputeWorkgroupsPerDimension)throw Error('Packet incident index exceeds device capacity');
 return {identity:{...identity},centers,radiance,receiverCount,maxAgeSteps,cells,grid:{origin:[...grid.origin],dims:[...grid.dims],pitch:grid.pitch}};
}

export function opticalPacketIncidentFreshness(field,epoch,step){
 if(!field)return {effective:'legacy-light'};
 const receipt={source:field.identity,ageSteps:step-field.identity.step,maxAgeSteps:field.maxAgeSteps,receivers:field.receiverCount};
 return field.identity.epoch===epoch&&receipt.ageSteps>=0&&receipt.ageSteps<=field.maxAgeSteps
  ?{effective:'packet-incident-only',...receipt}
  :{effective:'legacy-light',reason:'packet-source-expired',...receipt};
}

export const PACKET_INCIDENT_LOOKUP_WGSL=/* wgsl */`
struct PacketLookup {origin:vec4<f32>,dims:vec4<u32>,counts:vec4<u32>}
@group(0) @binding(0) var<storage,read> carriers:array<Particle>;
@group(0) @binding(1) var<storage,read> centers:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> radiance:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> heads:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> links:array<u32>;
@group(0) @binding(5) var<storage,read_write> result:array<vec4<f32>>;
@group(0) @binding(6) var<uniform> lut:PacketLookup;
fn packetCell(at:vec3<u32>)->u32{return at.x+lut.dims.x*(at.y+lut.dims.y*at.z);}
fn packetContribution(i:u32,p:vec3<f32>)->vec4<f32>{
 let c=centers[i];let incoming=radiance[i];
 if(!(c.w>0.0&&incoming.w>0.0)){return vec4<f32>(0);}
 let d=distance(p,c.xyz)/c.w;
 if(!(d<1.0)){return vec4<f32>(0);}
 let w=1.0-d;let weight=w*w*w*w*(1.0+4.0*d);
 return vec4<f32>(max(vec3<f32>(0),incoming.xyz)*weight,weight);
}
@compute @workgroup_size(64) fn indexPackets(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=lut.dims.w){return;}
 let c=centers[i];if(!(c.w>0.0)){return;}
 let q=(c.xyz-lut.origin.xyz)/lut.origin.w;
 atomicMax(&heads[lut.counts.x+1u],bitcast<u32>(c.w));
 if(!all(q>=vec3<f32>(0))||!all(q<vec3<f32>(lut.dims.xyz))){
  atomicStore(&heads[lut.counts.x],1u);return;
 }
 let cell=packetCell(vec3<u32>(q));links[i]=atomicExchange(&heads[cell],i+1u);
}
@compute @workgroup_size(64) fn gatherPackets(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=lut.counts.y){return;}
 let p=carriers[i].anchor;
 if(!(p.w>0.0)){result[i]=vec4<f32>(0);return;}
 var sum=vec4<f32>(0);
 if(atomicLoad(&heads[lut.counts.x])!=0u){
  // Correctness fallback for a producer center outside the lookup grid.
  for(var r=0u;r<lut.dims.w;r++){sum+=packetContribution(r,p.xyz);}
 }else{
  let q=(p.xyz-lut.origin.xyz)/lut.origin.w;let extent=vec3<f32>(lut.dims.xyz);
  let reach=bitcast<f32>(atomicLoad(&heads[lut.counts.x+1u]))/lut.origin.w;
  if(any(q < -vec3<f32>(reach))||any(q>extent+vec3<f32>(reach))){result[i]=vec4<f32>(0);return;}
  let lo=vec3<i32>(clamp(floor(q-reach),vec3<f32>(0),extent-1.0));
  let hi=vec3<i32>(clamp(floor(q+reach),vec3<f32>(0),extent-1.0));
  for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){
   var link=atomicLoad(&heads[packetCell(vec3<u32>(u32(x),u32(y),u32(z)))]);
   while(link>0u){sum+=packetContribution(link-1u,p.xyz);link=links[link-1u];}
  }}}
 }
 if(sum.w>0.0){result[i]=vec4<f32>(sum.xyz/sum.w,1.0);}else{result[i]=vec4<f32>(0);}
}
`;

export const PACKET_SCATTER_WGSL=/* wgsl */`
fn packetScatter(p:Particle,u:Options,incoming:vec3<f32>)->vec3<f32>{
 let fade=select(1.0,particleLifeFade(p.motion.w,u.lifeControl.y),u.lifeControl.x>0);
 let sigmaS=particleLightExtinction(p,u)*u.material.z*u.material.w;
 return incoming*sigmaS*p.shape.w*fade*u.lighting.x*u.lighting.z;
}
fn packetIntrinsic(p:Particle,u:Options)->vec3<f32>{
 let fade=select(1.0,particleLifeFade(p.motion.w,u.lifeControl.y),u.lifeControl.x>0);
 return particleLightIntrinsic(p)*u.gain.x*p.shape.w*fade;
}
`;

export function createPacketIncidentGather(device,particleWgsl,retire){
 let field=null,heads=null,links=null,result=null,index=null,gather=null,uniform=null;
 return {
  set(next,source){field=checkedOpticalPacketIncident(next,source,device.limits,GPUBufferUsage.STORAGE);},
  encode(encoder,{identity,step,particles,slots}){
   const receipt=opticalPacketIncidentFreshness(field,identity,step);
   if(receipt.effective!=='packet-incident-only')return receipt;
   if(!index){
    const module=device.createShaderModule({label:'particle packet incident overlap lookup',code:particleWgsl+PACKET_INCIDENT_LOOKUP_WGSL});
    index=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'indexPackets'}});
    gather=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'gatherPackets'}});
    uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   }
   const resize=(buffer,size,extraUsage=0)=>{
    if(buffer?.size===size)return buffer;
    if(buffer)retire([buffer]);
    return device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|extraUsage});
   };
   heads=resize(heads,4*(field.cells+2));links=resize(links,4*field.receiverCount);result=resize(result,16*slots,GPUBufferUsage.COPY_SRC);
   const data=new ArrayBuffer(48),f=new Float32Array(data),u=new Uint32Array(data);
   f.set([...field.grid.origin,field.grid.pitch]);u.set([...field.grid.dims,field.receiverCount,field.cells,slots],4);
   device.queue.writeBuffer(uniform,0,data);
   const buffers=[particles,field.centers,field.radiance,heads,links,result,uniform];
   const run=(pipeline,bindings,count,label)=>{
    const p=encoder.beginComputePass({label});p.setPipeline(pipeline);p.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:{buffer:buffers[binding]}}))}));p.dispatchWorkgroups(Math.ceil(count/64));p.end();
   };
   encoder.clearBuffer(heads);run(index,[1,3,4,6],field.receiverCount,'index incident receiver support');
   run(gather,[0,1,2,3,4,5,6],slots,'reconstruct incident light on current optical particles');
   return {index:'receiver-center-bins-with-exact-overlap-fallback',buffer:result,...receipt};
  },
  dispose(){field=null;retire([heads,links,result,uniform].filter(Boolean));heads=links=result=uniform=null;},
 };
}
