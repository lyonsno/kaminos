import {BURN_RIGID_CONTACT_WGSL} from './burn-rigid-contact.mjs';

export const BURN_RIGID_ISLANDS_WGSL=BURN_RIGID_CONTACT_WGSL+`
struct Island {center:vec4f,velocity:vec4f,angular:vec4f,inertia:array<vec4f,3>,inverse:array<vec4f,3>,before:vec4f,delta:vec4f}
struct Contact {point:vec4f,normal:vec4f,impulse:vec4f,bias:vec4f}
struct Params {counts:vec4u,gravityDt:vec4f}
@group(0) @binding(0) var<storage,read_write> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> rotations:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> velocities:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> angular:array<vec4f>;
@group(0) @binding(4) var<storage,read> boxes:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> links:array<vec4u>;
@group(0) @binding(6) var<storage,read_write> islands:array<Island>;
@group(0) @binding(7) var<storage,read_write> contacts:array<Contact>;
@group(0) @binding(8) var<storage,read> joints:array<vec4f>;
@group(0) @binding(9) var<uniform> p:Params;
@group(0) @binding(10) var<storage,read> supports:array<RigidBox>;
const END:u32=0xffffffffu;
fn rootOf(start:u32)->u32{var i=start;loop{let next=links[i].x;if(next==i){break;}i=next;}return i;}
@compute @workgroup_size(1) fn connect(){
 for(var i=0u;i<p.counts.x;i++){links[i]=vec4u(i,END,END,0);}
 for(var i=0u;i<p.counts.y;i++){
  let ids=bitcast<vec4u>(joints[i*11u]);if(ids.w==0u||positions[ids.x].w<=0.0||positions[ids.y].w<=0.0){continue;}
  let a=rootOf(ids.x);let b=rootOf(ids.y);if(a!=b){links[max(a,b)].x=min(a,b);}
 }
 for(var i=0u;i<p.counts.x;i++){links[i].x=rootOf(i);}
 for(var i=0u;i<p.counts.x;i++){if(positions[i].w>0.0){let r=links[i].x;links[i].z=links[r].y;links[r].y=i;}}
}
@compute @workgroup_size(64) fn aggregate(@builtin(global_invocation_id) id:vec3u){
 let r=id.x;if(r>=p.counts.x||links[r].x!=r||links[r].y==END){return;}
 var mass=0.0;var center=vec3f(0);var linear=vec3f(0);var i=links[r].y;
 loop{if(i==END){break;}let m=1.0/positions[i].w;mass+=m;center+=positions[i].xyz*m;linear+=velocities[i].xyz*m;i=links[i].z;}
 center/=mass;linear/=mass;var inertia=mat3x3f(vec3f(0),vec3f(0),vec3f(0));var momentum=vec3f(0);i=links[r].y;
 loop{if(i==END){break;}let m=1.0/positions[i].w;let offset=positions[i].xyz-center;let body=rigidBoxInertia(rotations[i],boxes[i].yzw,m);
  inertia+=body+(rigidIdentity()*dot(offset,offset)-rigidOuter(offset,offset))*m;momentum+=body*angular[i].xyz+cross(offset,(velocities[i].xyz-linear)*m);i=links[i].z;
 }
 let inverse=rigidInverse(inertia);islands[r].center=vec4f(center,mass);islands[r].before=vec4f(center,0);islands[r].velocity=vec4f(linear,0);islands[r].angular=vec4f(inverse*momentum,0);
 for(var k=0u;k<3u;k++){islands[r].inertia[k]=vec4f(inertia[k],0);islands[r].inverse[k]=vec4f(inverse[k],0);}islands[r].delta=vec4f(0,0,0,1);
}
@compute @workgroup_size(64) fn findContacts(@builtin(global_invocation_id) id:vec3u){
 let pair=id.x;if(pair>=p.counts.x*p.counts.z){return;}for(var k=0u;k<8u;k++){contacts[pair*8u+k]=Contact(vec4f(0),vec4f(0),vec4f(0),vec4f(0));}
 let i=pair/p.counts.z;let s=pair%p.counts.z;if(positions[i].w<=0.0){return;}let island=islands[links[i].x];let half=boxes[i].yzw;
 let margin=(length(island.velocity.xyz)+length(island.angular.xyz)*(length(positions[i].xyz-island.center.xyz)+length(half))+length(p.gravityDt.xyz)*p.gravityDt.w)*p.gravityDt.w;
 let manifold=rigidManifold(RigidBox(positions[i],rotations[i],vec4f(half,0)),supports[s],margin);
 for(var k=0u;k<manifold.count;k++){contacts[pair*8u+k].point=manifold.points[k];contacts[pair*8u+k].normal=vec4f(manifold.normal,1);}
}
fn rigidEffective(inverse:mat3x3f,arm:vec3f,n:vec3f,inverseMass:f32)->f32{return inverseMass+dot(n,cross(inverse*cross(arm,n),arm));}
@compute @workgroup_size(64) fn solve(@builtin(global_invocation_id) id:vec3u){
 let r=id.x;if(r>=p.counts.x||links[r].x!=r||links[r].y==END){return;}
 let dt=p.gravityDt.w;let center=islands[r].center.xyz;let im=1.0/islands[r].center.w;
 let inverse=mat3x3f(islands[r].inverse[0].xyz,islands[r].inverse[1].xyz,islands[r].inverse[2].xyz);
 var v=islands[r].velocity.xyz+p.gravityDt.xyz*dt;var w=islands[r].angular.xyz;var pv=vec3f(0);var pw=vec3f(0);
 for(var iteration=0u;iteration<p.counts.w;iteration++){
  var member=links[r].y;
  loop{if(member==END){break;}
   for(var s=0u;s<p.counts.z;s++){for(var k=0u;k<8u;k++){
    let ci=(member*p.counts.z+s)*8u+k;var c=contacts[ci];if(c.normal.w==0.0){continue;}
    let n=c.normal.xyz;let arm=c.point.xyz-center;let effective=rigidEffective(inverse,arm,n,im);let normalSpeed=-max(c.point.w,0.0)/dt;
    let impulse=max(0.0,c.impulse.w+(normalSpeed-dot(v+cross(w,arm),n))/effective);let change=n*(impulse-c.impulse.w);v+=change*im;w+=inverse*cross(arm,change);c.impulse.w=impulse;
    let cv=v+cross(w,arm);let vt=cv-n*dot(cv,n);let speed=length(vt);
    if(speed>1e-10){let tangent=vt/speed;let old=c.impulse.xyz;var next=old-tangent*(speed/rigidEffective(inverse,arm,tangent,im));let limit=supports[s].half.w*impulse;
     if(length(next)>limit){next*=limit/max(length(next),1e-30);}let friction=next-old;v+=friction*im;w+=inverse*cross(arm,friction);c.impulse=vec4f(next,impulse);
    }
    // Position correction is a separate, non-physical velocity. It never
    // becomes the next frame's physical velocity or launches a resting body.
    let biasTarget=max(-c.point.w,0.0)/dt;let bias=max(0.0,c.bias.w+(biasTarget-dot(pv+cross(pw,arm),n))/effective);let correction=n*(bias-c.bias.w);
    pv+=correction*im;pw+=inverse*cross(arm,correction);c.bias.w=bias;contacts[ci]=c;
   }}member=links[member].z;
  }
 }
 let delta=rigidIncrement(w+pw,dt);let rotation=rigidRotation(delta);let inertia=mat3x3f(islands[r].inertia[0].xyz,islands[r].inertia[1].xyz,islands[r].inertia[2].xyz);
 let momentum=inertia*w;let newInertia=rotation*inertia*transpose(rotation);w=rigidInverse(newInertia)*momentum;
 islands[r].center=vec4f(center+(v+pv)*dt,1.0/im);islands[r].velocity=vec4f(v,0);islands[r].angular=vec4f(w,0);islands[r].delta=delta;
}
@compute @workgroup_size(64) fn publish(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.counts.x||positions[i].w<=0.0){return;}let island=islands[links[i].x];let offset=rigidRotate(island.delta,positions[i].xyz-island.before.xyz);
 positions[i]=vec4f(island.center.xyz+offset,positions[i].w);rotations[i]=normalize(rigidMultiply(island.delta,rotations[i]));
 velocities[i]=vec4f(island.velocity.xyz+cross(island.angular.xyz,offset),0);angular[i]=island.angular;
}
`;

export async function createBurnRigidIslandsGpu({device,positions,rotations,velocities,angular,boxes,joints,bodies,bonds,supports=[],gravity,timeStep,iterations}){
 if(!Number.isInteger(bodies)||bodies<1||!Number.isInteger(bonds)||bonds<0||!Number.isInteger(iterations)||iterations<1||!Number.isFinite(timeStep)||timeStep<=0||gravity?.length!==3||!gravity.every(Number.isFinite))throw Error('Finite rigid-island topology, clock and gravity required');
 const owned=[];let disposed=false,enabled=true,validationScope=false;
 const allocate=(label,size,usage=GPUBufferUsage.STORAGE)=>{const b=device.createBuffer({label,size:Math.max(16,size),usage:usage|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);return b;};
 try{
  device.pushErrorScope('validation');validationScope=true;
  const links=allocate('Resident burn connected components',bodies*16),islands=allocate('Resident compound mass and full inertia',bodies*176),contacts=allocate('Finite compound support manifolds',Math.max(64,bodies*supports.length*8*64)),supportBuffer=allocate('Finite rigid supports',Math.max(48,supports.length*48)),params=allocate('Rigid island topology and clock',32,GPUBufferUsage.UNIFORM);
  const raw=new ArrayBuffer(32),u=new Uint32Array(raw),f=new Float32Array(raw);u.set([bodies,bonds,supports.length,iterations]);f.set([...gravity,timeStep],4);
  const uploadParams=()=>device.queue.writeBuffer(params,0,raw);
  const uploadSupports=()=>{if(supports.length)device.queue.writeBuffer(supportBuffer,0,Float32Array.from(supports.flatMap(s=>[...s.position,0,...s.quaternion,...s.halfExtents,s.friction])));};uploadParams();uploadSupports();
  const module=device.createShaderModule({label:'Rigid connected burning material',code:BURN_RIGID_ISLANDS_WGSL});const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
  const buffers={0:positions,1:rotations,2:velocities,3:angular,4:boxes,5:links,6:islands,7:contacts,8:joints,9:params,10:supportBuffer};
  const indices={connect:[0,5,8,9],aggregate:[0,1,2,3,4,5,6,9],findContacts:[0,1,4,5,6,7,9,10],solve:[5,6,7,9,10],publish:[0,1,2,3,5,6,9]},stages={};
  for(const [entryPoint,bindings]of Object.entries(indices)){const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:{buffer:buffers[binding]}}))});stages[entryPoint]={pipeline,group};}
  const validation=await device.popErrorScope();validationScope=false;if(validation)throw Error(validation.message);
  const encodeStage=(encoder,name)=>{const stage=stages[name],count=name==='connect'?1:name==='findContacts'?bodies*supports.length:bodies;if(!count)return;const pass=encoder.beginComputePass({label:'Burn rigid '+name});pass.setPipeline(stage.pipeline);pass.setBindGroup(0,stage.group);pass.dispatchWorkgroups(name==='connect'?1:Math.ceil(count/64));pass.end();};
  return {links,islands,contacts,
   encodeTopology(encoder){if(disposed)throw Error('Rigid burning material disposed');encodeStage(encoder,'connect');encodeStage(encoder,'aggregate');},
   encode(encoder){if(disposed)throw Error('Rigid burning material disposed');for(const name of Object.keys(stages))encodeStage(encoder,name);},
   setGravity(next){if(next?.length!==3||!next.every(Number.isFinite))throw Error('Finite gravity required');f.set(next,4);uploadParams();},
   setContactsEnabled(value){if(typeof value!=='boolean')throw Error('Boolean contact state required');enabled=value;u[2]=value?supports.length:0;uploadParams();},
   setSupport(index,support){if(!Number.isInteger(index)||index<0||index>=supports.length)throw Error('Unknown rigid support');supports[index]=support;uploadSupports();},
   read:()=>({motionModel:'burn-connected-rigid-compounds-v1',failureModel:'consumed-connection-only-no-load-estimate',inertia:'summed-region-box-full-tensor-parallel-axis',contact:'finite-obb-compound-manifolds-split-impulse-no-piece-self-contact',contactsEnabled:enabled,runtimeReadbacks:0}),
   dispose(){if(disposed)return;disposed=true;owned.forEach(b=>b.destroy());},
  };
 }catch(error){if(validationScope)await device.popErrorScope();owned.forEach(b=>b.destroy());throw error;}
}
