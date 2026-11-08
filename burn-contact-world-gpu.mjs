import {BURN_RIGID_CONTACT_WGSL} from './burn-rigid-contact.mjs';
import {createBurnRigidIslandsGpu} from './burn-rigid-islands-gpu.mjs';
import {checkedBurnSupport} from './burn-fracture-core.mjs';

export const BURN_CONTACT_WORLD_WGSL=BURN_RIGID_CONTACT_WGSL+`
struct Frame {counts:vec4u,translationScale:vec4f,rotation:vec4f,origin:vec4f}
@group(0) @binding(0) var<storage,read_write> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> rotations:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> velocities:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> angular:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> boxes:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> joints:array<vec4f>;
@group(0) @binding(6) var<uniform> frame:Frame;
@compute @workgroup_size(64) fn toWorld(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=frame.counts.y){return;}let i=frame.counts.x+id.x;let q=frame.rotation;let s=frame.translationScale.w;
 positions[i]=vec4f(frame.translationScale.xyz+rigidRotate(q,(positions[i].xyz+frame.origin.xyz)*s),positions[i].w);
 rotations[i]=normalize(rigidMultiply(q,rotations[i]));velocities[i]=vec4f(rigidRotate(q,velocities[i].xyz*s),0);angular[i]=vec4f(rigidRotate(q,angular[i].xyz),0);boxes[i]=vec4f(boxes[i].x,boxes[i].yzw*s);
}
@compute @workgroup_size(64) fn toLocal(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=frame.counts.y){return;}let i=frame.counts.x+id.x;let q=rigidConjugate(frame.rotation);let s=frame.translationScale.w;
 positions[i]=vec4f(rigidRotate(q,positions[i].xyz-frame.translationScale.xyz)/s-frame.origin.xyz,positions[i].w);
 rotations[i]=normalize(rigidMultiply(q,rotations[i]));velocities[i]=vec4f(rigidRotate(q,velocities[i].xyz)/s,0);angular[i]=vec4f(rigidRotate(q,angular[i].xyz),0);
}
@compute @workgroup_size(64) fn reindex(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=frame.counts.w){return;}let i=(frame.counts.z+id.x)*11u;var ids=bitcast<vec4u>(joints[i]);ids.x+=frame.counts.x;ids.y+=frame.counts.x;joints[i]=bitcast<vec4f>(ids);
}
`;

// The material owners retain their buffers and presentation. This arena gathers
// their surviving regions into world coordinates for one shared fixed-step solve,
// then scatters poses back before the same material/selection presentation runs.
export async function createBurnContactWorldGpu({device,participants}){
 if(!participants.length)throw Error('Shared burn contacts require material participants');
 const owned=[],rows=[];let motion,disposed=false,remainder=0,steps=0,seconds=0;
 const first=participants[0].resident,h=first.timeStep,substeps=first.substeps;
 const n=participants.reduce((s,r)=>s+r.resident.bodies,0),m=participants.reduce((s,r)=>s+r.resident.bonds,0);
 const allocate=(label,size,usage=GPUBufferUsage.STORAGE)=>{const b=device.createBuffer({label,size:Math.max(16,size),usage:usage|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
 function dispose(){if(disposed)return;disposed=true;motion?.dispose();owned.forEach(b=>b.destroy());}
 try{
  for(const row of participants){const r=row.resident;if(r.device!==device||r.timeStep!==h||r.substeps!==substeps)throw Error('Shared burn mechanics require one device and fixed clock');}
  const buffers={positions:allocate('Shared burn positions',n*16),rotations:allocate('Shared burn rotations',n*16),velocities:allocate('Shared burn velocities',n*16),angular:allocate('Shared burn angular velocities',n*16),boxes:allocate('Shared surviving region bounds',n*16),joints:allocate('Shared consumed connections',m*176)};
  const module=device.createShaderModule({label:'Burn material world-coordinate transfer',code:BURN_CONTACT_WORLD_WGSL});
  const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
  const pipelines={},indices={toWorld:[0,1,2,3,4,6],toLocal:[0,1,2,3,6],reindex:[5,6]};
  for(const entryPoint of Object.keys(indices))pipelines[entryPoint]=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});
  let bodyOffset=0,bondOffset=0;
  for(const participant of participants){
   const resident=participant.resident,raw=new ArrayBuffer(64),u=new Uint32Array(raw),f=new Float32Array(raw),params=allocate('Burn participant frame',64,GPUBufferUsage.UNIFORM);
   u.set([bodyOffset,resident.bodies,bondOffset,resident.bonds]);f.set([...resident.origin,0],12);
   const groups={},resources=[buffers.positions,buffers.rotations,buffers.velocities,buffers.angular,buffers.boxes,buffers.joints,params];
   for(const name of Object.keys(indices))groups[name]=device.createBindGroup({layout:pipelines[name].getBindGroupLayout(0),entries:indices[name].map(binding=>({binding,resource:{buffer:resources[binding]}}))});
   rows.push({participant,resident,raw,f,params,groups,bodyOffset,bondOffset});bodyOffset+=resident.bodies;bondOffset+=resident.bonds;
  }
  const ground=checkedBurnSupport(participants[0].frame().ground);
  motion=await createBurnRigidIslandsGpu({device,...buffers,bodies:n,bonds:m,supports:[ground],gravity:[0,-9.81,0],timeStep:h/substeps,iterations:Math.max(...participants.map(r=>r.resident.iterations)),mutualContacts:true});
  function dispatch(encoder,row,name){const count=name==='reindex'?row.resident.bonds:row.resident.bodies;if(!count)return;const pass=encoder.beginComputePass({label:'Burn world '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,row.groups[name]);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();}
  function updateFrames(){
   const frames=rows.map(row=>row.participant.frame());
   for(let i=0;i<rows.length;i++){const row=rows[i],frame=frames[i];if(!Number.isFinite(frame.scale)||frame.scale<=0||frame.position?.length!==3||!frame.position.every(Number.isFinite)||frame.quaternion?.length!==4||!frame.quaternion.every(Number.isFinite)||Math.abs(Math.hypot(...frame.quaternion)-1)>1e-5)throw Error('Finite positive uniform world frame required');row.f.set([...frame.position,frame.scale],4);row.f.set(frame.quaternion,8);device.queue.writeBuffer(row.params,0,row.raw);}
   motion.setSupport(0,checkedBurnSupport(frames[0].ground));motion.setContactsEnabled(frames[0].contactsEnabled);
  }
  return {
   advance(dt){
    if(disposed)throw Error('Shared burn contact world disposed');if(!Number.isFinite(dt)||dt<0||!Number.isFinite(remainder+dt))throw Error('Finite nonnegative shared mechanics duration required');
    updateFrames();remainder+=dt;const encoder=device.createCommandEncoder();
    for(const row of rows){const r=row.resident;r.encodeMaterial(encoder);for(const name of ['positions','rotations','velocities','angular','boxes'])encoder.copyBufferToBuffer(r.buffers[name],0,buffers[name],row.bodyOffset*16,r.bodies*16);if(r.bonds)encoder.copyBufferToBuffer(r.buffers.joints,0,buffers.joints,row.bondOffset*176,r.bonds*176);dispatch(encoder,row,'toWorld');dispatch(encoder,row,'reindex');}
    let advanced=0;while(remainder+Number.EPSILON>=h){for(let s=0;s<substeps;s++)motion.encode(encoder);advanced++;steps++;seconds+=h;remainder=Math.max(0,remainder-h);}
    for(const row of rows){dispatch(encoder,row,'toLocal');const r=row.resident;for(const name of ['positions','rotations','velocities','angular'])encoder.copyBufferToBuffer(buffers[name],row.bodyOffset*16,r.buffers[name],0,r.bodies*16);r.encodePresentation(encoder,{steps:advanced,seconds:advanced*h,remainder});}
    device.queue.submit([encoder.finish()]);for(const row of rows)row.participant.present();
   },
   read:()=>({status:'live',objects:rows.length,regions:n,connections:m,steps,seconds,remainder,coordinates:'world-aligned-positive-uniform-source-frames',...motion.read()}),
   dispose,
  };
 }catch(error){dispose();throw error;}
}
