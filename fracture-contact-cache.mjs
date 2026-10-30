// Recompute contact reactions when the attachment system that supported them changes.
export const CONTACT_TOPOLOGY_RESET = /* wgsl */`
struct Parameters { handTarget: vec4f, counts: vec4u, control: vec4f, binding: vec4u }
@group(0) @binding(0) var<storage, read> joints: array<vec4f>;
@group(0) @binding(1) var<storage, read> damage: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> changed: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> contacts: array<vec4f>;
@group(0) @binding(4) var<uniform> params: Parameters;

@compute @workgroup_size(64)
fn markChanged(@builtin(global_invocation_id) id: vec3u) {
 let i=id.x;
 if(i>=params.counts.y) { return; }
 let broke=damage[i*3u].w>0.0 && u32(damage[i*3u].w)==params.counts.z-1u;
 let bound=damage[i*3u+2u].z==2.0 && u32(damage[i*3u+2u].y)==params.counts.z;
 if(!broke && !bound) { return; }
 let record=bitcast<vec4u>(joints[i*11u]);
 if(record.x<params.counts.x) { atomicMax(&changed[record.x],params.counts.z); }
 if(record.y<params.counts.x) { atomicMax(&changed[record.y],params.counts.z); }
}

@compute @workgroup_size(64)
fn resetContacts(@builtin(global_invocation_id) id: vec3u) {
 let base=id.x*9u;
 if(base+8u>=arrayLength(&contacts)) { return; }
 let record=contacts[base];
 if(record.z<=0.0) { return; }
 let a=u32(record.x); let b=u32(record.y);
 var invalid=false;
 if(a<params.counts.x) { invalid=atomicLoad(&changed[a])==params.counts.z; }
 if(b<params.counts.x) { invalid=invalid || atomicLoad(&changed[b])==params.counts.z; }
 if(!invalid) { return; }
 // Contact generation reuses shadow; the solver also reads the hot dual.
 // Geometry, friction, penalties and correspondence remain intact.
 contacts[base+5u]=vec4f(vec3f(0.0),contacts[base+5u].w);
 contacts[base+6u]=vec4f(0.0);
}
`;

export async function createContactTopologyReset(device,{joints,damage,contacts,parameters,bodies,bonds,contactCount}) {
 const module=device.createShaderModule({label:'Fracture contact reaction invalidation',code:CONTACT_TOPOLOGY_RESET});
 const info=await module.getCompilationInfo();
 if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
 const layout=device.createBindGroupLayout({entries:Array.from({length:5},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===4?'uniform':binding<2?'read-only-storage':'storage'}}))});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const pipelines=[];
 for(const entryPoint of ['markChanged','resetContacts'])pipelines.push(await device.createComputePipelineAsync({label:`Fracture ${entryPoint}`,layout:pipelineLayout,compute:{module,entryPoint}}));
 const changed=device.createBuffer({label:'Fracture attachment-change epochs',size:Math.max(4,bodies*4),usage:GPUBufferUsage.STORAGE});
 try {
  const group=device.createBindGroup({layout,entries:[joints,damage,changed,contacts,parameters].map((buffer,binding)=>({binding,resource:{buffer}}))});
  return {encode(encoder){
   if(!bonds)return;
   const pass=encoder.beginComputePass({label:'Fracture contact reaction reset'});
   pass.setBindGroup(0,group);
   pass.setPipeline(pipelines[0]);pass.dispatchWorkgroups(Math.ceil(bonds/64));
   pass.setPipeline(pipelines[1]);pass.dispatchWorkgroups(Math.ceil(contactCount/64));
   pass.end();
  },dispose(){changed.destroy();}};
 }catch(error){changed.destroy();throw error;}
}
