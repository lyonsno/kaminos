// Pair impulses act at one common point, conserving linear and angular momentum.
// A degree-weighted gather keeps simultaneous neighboring contractions passive.
export const BURN_DISSIPATION_WGSL=`
struct Params {bodies:u32,bonds:u32,step:f32,ratio:f32}
struct Motion {va:vec3f,wa:vec3f,vb:vec3f,wb:vec3f}
@group(0) @binding(0) var<storage,read> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read> rotations:array<vec4f>;
@group(0) @binding(2) var<storage,read> inertia:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> velocities:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> angular:array<vec4f>;
@group(0) @binding(5) var<storage,read> joints:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> impulses:array<vec4f>;
@group(0) @binding(7) var<storage,read> adjacency:array<u32>;
@group(0) @binding(8) var<uniform> p:Params;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn inverseMoment(q:vec4f,d:vec3f)->mat3x3f{
 let qc=vec4f(-q.xyz,q.w);
 return mat3x3f(rotate(q,d*rotate(qc,vec3f(1,0,0))),rotate(q,d*rotate(qc,vec3f(0,1,0))),rotate(q,d*rotate(qc,vec3f(0,0,1))));
}
fn fraction(k:f32,w:f32)->f32{return 1.0-exp(-2.0*p.ratio*sqrt(max(0.0,k*w))*p.step);}
fn linear(s:ptr<function,Motion>,n:vec3f,ra:vec3f,rb:vec3f,ia:mat3x3f,ib:mat3x3f,ma:f32,mb:f32,k:f32){
 let ca=cross(ra,n);let cb=cross(rb,n);
 let effective=ma+mb+dot(ca,ia*ca)+dot(cb,ib*cb);
 if(effective<=0.0||k<=0.0){return;}
 let speed=dot(n,(*s).va+cross((*s).wa,ra)-(*s).vb-cross((*s).wb,rb));
 let impulse=-fraction(k,effective)*speed/effective*n;
 (*s).va+=ma*impulse;(*s).vb-=mb*impulse;
 (*s).wa+=ia*cross(ra,impulse);(*s).wb-=ib*cross(rb,impulse);
}
fn angularImpulse(s:ptr<function,Motion>,n:vec3f,ia:mat3x3f,ib:mat3x3f,k:f32){
 let effective=dot(n,(ia+ib)*n);if(effective<=0.0||k<=0.0){return;}
 let impulse=-fraction(k,effective)*dot(n,(*s).wa-(*s).wb)/effective*n;
 (*s).wa+=ia*impulse;(*s).wb-=ib*impulse;
}
@compute @workgroup_size(64)
fn pairs(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.bonds){return;}let base=i*11u;let out=i*4u;
 for(var j=0u;j<4u;j++){impulses[out+j]=vec4f(0);}
 let jointMeta=bitcast<vec4u>(joints[base]);if(jointMeta.w==0u||p.ratio==0.0||p.step==0.0){return;}
 let a=jointMeta.x;let b=jointMeta.y;let pa=positions[a];let pb=positions[b];
 let qa=normalize(rotations[a]);let qb=normalize(rotations[b]);
 let ia=inverseMoment(qa,inertia[a].xyz);let ib=inverseMoment(qb,inertia[b].xyz);
 let anchorA=joints[base+1u];let anchorB=joints[base+2u];
 let point=(pa.xyz+rotate(qa,anchorA.xyz)+pb.xyz+rotate(qb,anchorB.xyz))*0.5;
 let ra=point-pa.xyz;let rb=point-pb.xyz;let stiffness=joints[base+4u];
 let before=Motion(velocities[a].xyz,angular[a].xyz,velocities[b].xyz,angular[b].xyz);
 var after=before;
 for(var axis=0u;axis<3u;axis++){var n=vec3f(0);n[axis]=1.0;linear(&after,n,ra,rb,ia,ib,pa.w,pb.w,stiffness.x);}
 if(jointMeta.z==1u){
  let arm=max(anchorA.w,1.0);
  for(var axis=0u;axis<3u;axis++){var n=vec3f(0);n[axis]=1.0;angularImpulse(&after,n,ia,ib,stiffness.y*arm*arm);}
 }
 let degree=max(adjacency[a+1u]-adjacency[a],adjacency[b+1u]-adjacency[b]);let weight=1.0/f32(degree);
 impulses[out]=vec4f((after.va-before.va)*weight,0);impulses[out+1u]=vec4f((after.wa-before.wa)*weight,0);
 impulses[out+2u]=vec4f((after.vb-before.vb)*weight,0);impulses[out+3u]=vec4f((after.wb-before.wb)*weight,0);
}
@compute @workgroup_size(64)
fn gather(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.bodies){return;}var dv=vec3f(0);var dw=vec3f(0);
 for(var j=adjacency[i];j<adjacency[i+1u];j++){
  let link=adjacency[j];let base=(link/2u)*4u+(link%2u)*2u;dv+=impulses[base].xyz;dw+=impulses[base+1u].xyz;
 }
 velocities[i]=vec4f(velocities[i].xyz+dv,velocities[i].w);angular[i]=vec4f(angular[i].xyz+dw,angular[i].w);
}`;

export async function createBurnFractureDissipationGpu({device,positions,rotations,inertia,velocities,angularVelocities,joints,initialJoints,bodies,bonds,timeStep,ratio=.7}){
 if(!Number.isInteger(bodies)||bodies<=0||!Number.isInteger(bonds)||bonds<0
  ||![timeStep,ratio].every(x=>Number.isFinite(x)&&x>=0))throw Error('Finite nonnegative material damping and complete topology required');
 for(const b of [positions,rotations,inertia,velocities,angularVelocities])if(!b||b.size<bodies*16)throw Error('Complete resident body buffers required');
 if(!(initialJoints instanceof Float32Array)||initialJoints.length<bonds*44||!joints||joints.size<bonds*44*4)throw Error('Complete native joint records required');
 const words=new Uint32Array(initialJoints.buffer,initialJoints.byteOffset,initialJoints.length),refs=Array.from({length:bodies},()=>[]);
 for(let i=0;i<bonds;i++){
  const a=words[i*44],b=words[i*44+1];if(a>=bodies||b>=bodies||a===b)throw Error('Material damping requires two distinct resident endpoints');
  refs[a].push(i*2);refs[b].push(i*2+1);
 }
 const adjacency=new Uint32Array(bodies+1+bonds*2);let cursor=bodies+1;
 refs.forEach((list,i)=>{adjacency[i]=cursor;adjacency.set(list,cursor);cursor+=list.length;});adjacency[bodies]=cursor;
 const owned=[];let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;owned.forEach(b=>b.destroy());};
 try{
  const allocate=(label,data,usage=GPUBufferUsage.STORAGE)=>{const b=device.createBuffer({label,size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
  const params=new ArrayBuffer(16);new Uint32Array(params).set([bodies,bonds]);new Float32Array(params).set([timeStep,ratio],2);
  const resources={0:positions,1:rotations,2:inertia,3:velocities,4:angularVelocities,5:joints,
   6:allocate('Material damping pair impulses',new Float32Array(bonds*16)),7:allocate('Material damping adjacency',adjacency),8:allocate('Material damping parameters',new Uint8Array(params),GPUBufferUsage.UNIFORM)};
  const module=device.createShaderModule({label:'Internal material dissipation',code:BURN_DISSIPATION_WGSL}),errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
  if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
  const stages=[];
  for(const [entryPoint,bindings]of [['pairs',[0,1,2,3,4,5,6,7,8]],['gather',[3,4,6,7,8]]]){
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:{buffer:resources[binding]}}))});stages.push({pipeline,group,count:entryPoint==='pairs'?bonds:bodies});
  }
  return {read:()=>({identity:'active-bond-relative-velocity-dissipation-v1',ratio,timeStep,scope:'intact-material-only',momentum:'linear-and-angular-conserving-pair-impulses'}),encode(encoder){if(disposed)throw Error('Burn dissipation is disposed');if(!bonds||ratio===0||timeStep===0)return;
   for(const {pipeline,group,count}of stages){const p=encoder.beginComputePass({label:'Burn internal dissipation'});p.setPipeline(pipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(Math.ceil(count/64));p.end();}
  },dispose};
 }catch(error){dispose();throw error;}
}
