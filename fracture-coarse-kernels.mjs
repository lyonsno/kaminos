export const ARCH_GPU_KERNELS = /* wgsl */`
struct Parameters {
  handTarget: vec4f,
  counts: vec4u,
  control: vec4f,
  binding: vec4u,
}
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> quaternions: array<vec4f>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4f>;
@group(0) @binding(3) var<storage, read> angularVelocities: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> joints: array<vec4f>;
@group(0) @binding(5) var<storage, read> geometry: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> damage: array<vec4f>;
@group(0) @binding(7) var<storage, read> grip: array<vec4f>;
@group(0) @binding(8) var<uniform> params: Parameters;
@group(0) @binding(9) var<storage, read_write> output: array<vec4f>;

fn qmul(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(a.w*b.xyz + b.w*a.xyz + cross(a.xyz,b.xyz), a.w*b.w-dot(a.xyz,b.xyz));
}
fn qconj(q: vec4f) -> vec4f { return vec4f(-q.xyz,q.w); }
fn qrot(q: vec4f,v: vec3f) -> vec3f { return v + 2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v); }
fn worldAnchor(body: u32, anchor: vec3f) -> vec3f {
  if(body == 0xffffffffu) { return anchor; }
  return positions[body].xyz + qrot(quaternions[body],anchor);
}
fn linearForce(j: u32) -> vec3f {
  let base=j*11u; let jointMeta=bitcast<vec4u>(joints[base]);
  let c=worldAnchor(jointMeta.x,joints[base+1u].xyz)-worldAnchor(jointMeta.y,joints[base+2u].xyz);
  return joints[base+9u].xyz*c+joints[base+7u].xyz;
}
fn clearDual(j: u32) {
  let base=j*11u;
  for(var field=5u;field<11u;field++) { joints[base+field]=vec4f(0.0); }
  let start=bitcast<f32>(params.counts.w);
  joints[base+9u]=vec4f(vec3f(min(joints[base+4u].x,start)),0.0);
  joints[base+10u]=vec4f(vec3f(min(joints[base+4u].y,start)),0.0);
}

@compute @workgroup_size(64)
fn commands(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;
  if(i<params.counts.x) {
    let command=grip[i*3u]; let j=params.counts.y+i; let base=j*11u;
    var jointMeta=bitcast<vec4u>(joints[base]);
    if(command.x<=0.0) { jointMeta.w=0u; joints[base]=bitcast<vec4f>(jointMeta); }
    else {
      let local=grip[i*3u+1u]; let offset=grip[i*3u+2u];
      let changed=joints[base+2u].w!=command.z || jointMeta.w==0u;
      jointMeta.w=1u; joints[base]=bitcast<vec4f>(jointMeta);
      joints[base+1u]=vec4f(params.handTarget.xyz+offset.xyz,1.0);
      joints[base+2u]=vec4f(local.xyz,command.z);
      joints[base+4u]=vec4f(params.control.z*command.y,0.0,0.0,0.0);
      if(changed) { clearDual(j); }
    }
  }
  if(i>=params.counts.y || params.binding.x==0u) { return; }
  let base=i*11u; var jointMeta=bitcast<vec4u>(joints[base]);
  if(jointMeta.w!=0u) { return; }
  let a=jointMeta.x; let b=jointMeta.y;
  let selected=positions[params.binding.y].xyz;
  if(min(distance(positions[a].xyz,selected),distance(positions[b].xyz,selected))>params.control.w) { return; }
  let faceA=worldAnchor(a,geometry[i*3u+1u].xyz);
  let faceB=worldAnchor(b,geometry[i*3u+2u].xyz);
  if(distance(faceA,faceB)>params.handTarget.w || abs(dot(quaternions[a],quaternions[b]))<0.98) { return; }
  let midpoint=(faceA+faceB)*0.5;
  joints[base+1u]=vec4f(qrot(qconj(quaternions[a]),midpoint-positions[a].xyz),1.0);
  joints[base+2u]=vec4f(qrot(qconj(quaternions[b]),midpoint-positions[b].xyz),0.0);
  joints[base+3u]=normalize(qmul(qconj(quaternions[a]),quaternions[b]));
  clearDual(i); jointMeta.w=1u; joints[base]=bitcast<vec4f>(jointMeta);
  damage[i*3u+2u]=vec4f(0.0,f32(params.counts.z),2.0,f32(params.binding.z));
}

@compute @workgroup_size(64)
fn fracture(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;
  if(i>=params.counts.y) { return; }
  let base=i*11u; var jointMeta=bitcast<vec4u>(joints[base]);
  if(jointMeta.w==0u) { return; }
  let a=jointMeta.x; let b=jointMeta.y; let shape=geometry[i*3u];
  let force=linearForce(i); let arm=max(joints[base+1u].w,1.0);
  let delta=qmul(qmul(quaternions[a],joints[base+3u]),qconj(quaternions[b]));
  let angularConstraint=2.0*delta.xyz*arm;
  let torque=(joints[base+10u].xyz*angularConstraint+joints[base+8u].xyz)*arm;
  let normal=qrot(quaternions[a],shape.yzw); let axial=dot(force,normal);
  let shear=sqrt(max(0.0,dot(force,force)-axial*axial));
  let stress=(max(0.0,-axial)+shear+length(torque)/sqrt(shape.x))/shape.x;
  let previous=damage[i*3u];
  damage[i*3u]=vec4f(length(force),length(torque),stress,previous.w);
  if(stress>params.control.x) {
    jointMeta.w=0u; joints[base]=bitcast<vec4f>(jointMeta);
    damage[i*3u].w=f32(params.counts.z);
    let energy=(length(force)*length(velocities[a].xyz-velocities[b].xyz)+length(torque)*length(angularVelocities[a].xyz-angularVelocities[b].xyz))*params.control.y;
    damage[i*3u+1u]=vec4f(energy,f32(params.counts.z),1.0,f32(params.binding.z));
  }
}

@compute @workgroup_size(64)
fn pack(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;
  if(i<params.counts.x) {
    output[i*5u]=positions[i]; output[i*5u+1u]=quaternions[i];
    output[i*5u+2u]=velocities[i]; output[i*5u+3u]=angularVelocities[i];
    let j=params.counts.y+i; let jointActive=bitcast<vec4u>(joints[j*11u]).w;
    var force=vec3f(0.0); if(jointActive!=0u) { force=linearForce(j); }
    output[i*5u+4u]=vec4f(force,f32(jointActive));
  }
  if(i<params.counts.y) {
    let start=params.counts.x*5u+i*4u;
    output[start]=damage[i*3u]; output[start+1u]=damage[i*3u+1u];
    output[start+2u]=damage[i*3u+2u];
    let lin=joints[i*11u+9u].xyz; let ang=joints[i*11u+10u].xyz;
    output[start+3u]=vec4f(f32(bitcast<vec4u>(joints[i*11u]).w),max(lin.x,max(lin.y,lin.z)),max(ang.x,max(ang.y,ang.z)),min(min(lin.x,min(lin.y,lin.z)),min(ang.x,min(ang.y,ang.z))));
  }
}
`;
