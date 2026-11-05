export const BURN_FRACTURE_WGSL=`
@group(0) @binding(0) var<storage,read_write> joints:array<vec4f>;
@group(0) @binding(1) var<storage,read> sections:array<vec4f>;
@group(0) @binding(2) var<storage,read> coefficients:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> geometry:array<vec4f>;
@group(0) @binding(4) var<storage,read> positions:array<vec4f>;
@group(0) @binding(5) var<storage,read> rotations:array<vec4f>;
@group(0) @binding(6) var<storage,read> rest:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> matrices:array<mat4x4f>;
@group(0) @binding(8) var image:texture_storage_2d<rgba32float,write>;
struct Params {counts:vec4u,origin:vec4f}
@group(0) @binding(9) var<uniform> p:Params;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@compute @workgroup_size(64)
fn weaken(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=p.counts.y){return;}let base=i*11u;
 var jointMeta=bitcast<vec4u>(joints[base]);if(jointMeta.w==0u){return;}
 let sample=sections[i];if(sample.w==0.0){return;}
 let previous=geometry[i*3u+1u].w;
 let fraction=min(previous,clamp(sample.x,0.0,1.0));
 geometry[i*3u].x=coefficients[i].x*fraction;geometry[i*3u+1u].w=fraction;
 if(fraction==0.0){jointMeta.w=0u;joints[base]=bitcast<vec4f>(jointMeta);for(var j=5u;j<11u;j++){joints[base+j]=vec4f(0.0);}return;}
 let arm=max(joints[base+1u].w,1.0);
 joints[base+4u].x=coefficients[i].y*fraction;
 joints[base+4u].y=coefficients[i].z*fraction*fraction/(arm*arm);
 if(fraction<previous){
  let ratio=fraction/previous;
  for(var j=5u;j<11u;j++){joints[base+j]=joints[base+j]*select(ratio,ratio*ratio,j==6u||j==8u||j==10u);}
 }
}
@compute @workgroup_size(64)
fn present(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=p.counts.x+p.counts.y){return;}
 if(i>=p.counts.x){textureStore(image,vec2i(0,i32(i)),vec4f(f32(bitcast<vec4u>(joints[(i-p.counts.x)*11u]).w),0,0,0));return;}
 let scale=select(1.0,0.0,positions[i].w==0.0&&rest[i].w>0.0);
 let q=normalize(rotations[i]);
 let a=rotate(q,vec3f(scale,0,0));let b=rotate(q,vec3f(0,scale,0));let c=rotate(q,vec3f(0,0,scale));
 let t=positions[i].xyz+p.origin.xyz-rotate(q,rest[i].xyz);
 let m=mat4x4f(vec4f(a,0),vec4f(b,0),vec4f(c,0),vec4f(t,1));matrices[i]=m;
 for(var col=0;col<4;col++){textureStore(image,vec2i(col,i32(i)),m[col]);}
}`;

// Reuse the native contact shadow/dual invalidation law from Burning Demon's
// fracture-contact-cache.mjs@35c3cc6aa, but observe our own joint activity ABI.
export const BURN_CONTACT_RELEASE_WGSL=`
struct ReleaseParams {counts:vec4u,dispatch:vec4u}
@group(0) @binding(0) var<storage,read> joints:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> previous:array<u32>;
@group(0) @binding(2) var<storage,read_write> changed:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> contacts:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> indirect:array<atomic<u32>>;
@group(0) @binding(5) var<uniform> p:ReleaseParams;
@compute @workgroup_size(64)
fn markChanged(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.counts.y){return;}
 let record=bitcast<vec4u>(joints[i*11u]);
 let enabled=record.w;if(previous[i]==enabled){return;}previous[i]=enabled;
 if(record.x<p.counts.x){atomicOr(&changed[record.x],1u);}
 if(record.y<p.counts.x){atomicOr(&changed[record.y],1u);}
 atomicMax(&indirect[0],p.dispatch.x);
}
@compute @workgroup_size(64)
fn resetContacts(@builtin(global_invocation_id) id:vec3u){
 let i=id.x+id.y*p.dispatch.x*64u;if(i>=p.counts.z){return;}
 let base=i*9u;let record=contacts[base];if(record.z<=0.0){return;}
 let a=u32(record.x);let b=u32(record.y);var invalid=false;
 if(a<p.counts.x){invalid=atomicLoad(&changed[a])!=0u;}
 if(b<p.counts.x){invalid=invalid||atomicLoad(&changed[b])!=0u;}
 if(!invalid){return;}
 // Preserve geometry, friction, penalties, correspondence and shadow.w.
 contacts[base+5u]=vec4f(vec3f(0),contacts[base+5u].w);
 contacts[base+6u]=vec4f(0);
}`;

export async function createBurnFractureReleaseGpu({device,joints,sections,coefficients,geometry,parameters,contacts,initialJoints,bodies,bonds}){
 const module=device.createShaderModule({label:'Remaining section release',code:BURN_FRACTURE_WGSL});
 const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'weaken'}});
 const resources={0:joints,1:sections,2:coefficients,3:geometry,9:parameters};
 const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:Object.entries(resources).map(([binding,buffer])=>({binding:Number(binding),resource:{buffer}}))});
 const owned=[];let disposed=false;
 try{
  const allocate=(label,data,usage=GPUBufferUsage.STORAGE)=>{
   const b=device.createBuffer({label,size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST});
   owned.push(b);device.queue.writeBuffer(b,0,data);return b;
  };
  const words=new Uint32Array(initialJoints.buffer,initialJoints.byteOffset,initialJoints.length);
  const initialActive=Uint32Array.from({length:bonds},(_,i)=>words[i*44+3]);
  const previous=allocate('Previous burn joint activity',initialActive);
  const changed=allocate('Burn attachment change flags',new Uint32Array(bodies));
  const count=contacts.size/(9*16),groups=Math.ceil(count/64),width=Math.min(groups,device.limits.maxComputeWorkgroupsPerDimension),height=Math.ceil(groups/width);
  const indirect=allocate('Burn contact reset dispatch',Uint32Array.of(0,height,1),GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT);
  const releaseParams=allocate('Burn contact release counts',Uint32Array.of(bodies,bonds,count,0,width,height,0,0),GPUBufferUsage.UNIFORM);
  const releaseModule=device.createShaderModule({label:'Burn attachment contact reset',code:BURN_CONTACT_RELEASE_WGSL});
  const errors=(await releaseModule.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
  const resources={0:joints,1:previous,2:changed,3:contacts,4:indirect,5:releaseParams},stages={};
  for(const [entryPoint,indices]of [['markChanged',[0,1,2,4,5]],['resetContacts',[2,3,5]]]){
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:releaseModule,entryPoint}});
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:indices.map(binding=>({binding,resource:{buffer:resources[binding]}}))});
   stages[entryPoint]={pipeline,group};
  }
  return {encode(encoder){
   if(disposed)throw Error('Burn section release is disposed');if(!bonds)return;
   encoder.clearBuffer(changed);encoder.clearBuffer(indirect,0,4);
   const weaken=encoder.beginComputePass({label:'Burn fracture weaken'});weaken.setPipeline(pipeline);weaken.setBindGroup(0,group);weaken.dispatchWorkgroups(Math.ceil(bonds/64));weaken.end();
   for(const [name,stage]of Object.entries(stages)){
    const pass=encoder.beginComputePass({label:'Burn attachment '+name});pass.setPipeline(stage.pipeline);pass.setBindGroup(0,stage.group);
    if(name==='markChanged')pass.dispatchWorkgroups(Math.ceil(bonds/64));else pass.dispatchWorkgroupsIndirect(indirect,0);
    pass.end();
   }
  },reset(){if(disposed)throw Error('Burn section release is disposed');if(bonds)device.queue.writeBuffer(previous,0,initialActive);},dispose(){if(disposed)return;disposed=true;owned.forEach(b=>b.destroy());}};
 }catch(error){owned.forEach(b=>b.destroy());throw error;}
}
