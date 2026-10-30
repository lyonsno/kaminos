struct Particle {position:vec3f,life:f32,v:vec3f,C:mat3x3f,}
struct Body {position:vec4f,rotation:vec4f,velocity:vec4f,angular:vec4f,inertia0:vec4f,inertia1:vec4f,inertia2:vec4f,}
struct Impulse {x:atomic<i32>,y:atomic<i32>,z:atomic<i32>,count:atomic<i32>,tx:atomic<i32>,ty:atomic<i32>,tz:atomic<i32>,overflow:atomic<i32>,}
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read> bodies:array<Body>;
@group(0) @binding(2) var<storage,read_write> impulses:array<Impulse>;
override cell:f32;override timeScale:f32;override originX:f32;override originY:f32;override originZ:f32;
override particleMass:f32;override impulseScale:f32;
override extentX:f32;override extentY:f32;override extentZ:f32;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@compute @workgroup_size(64) fn contact(@builtin(global_invocation_id) id:vec3u){
  if(id.x>=arrayLength(&particles)||particles[id.x].life<=0.){return;}
  let origin=vec3f(originX,originY,originZ);
  var position=origin+particles[id.x].position*cell;
  var velocity=particles[id.x].v*cell*timeScale;
  for(var i=0u;i<arrayLength(&bodies);i++){
    let body=bodies[i];let q=body.rotation;let local=rotate(vec4f(-q.xyz,q.w),position-body.position.xyz);
    let radial=length(local.xz);let dr=radial-body.position.w;let dy=abs(local.y)-body.velocity.w;
    let distance=length(max(vec2f(dr,dy),vec2f(0)))+min(max(dr,dy),0.);
    if(distance>=.01){continue;}
    var n=vec3f(0,select(-1.,1.,local.y>=0.),0);
    if(dr>dy){n=vec3f(local.x/max(radial,1e-8),0,local.z/max(radial,1e-8));}
    if(dr>0.&&dy>0.){n=normalize(vec3f(local.x/max(radial,1e-8)*dr,select(-dy,dy,local.y>=0.),local.z/max(radial,1e-8)*dr));}
    let normal=rotate(q,n);let surface=position-normal*distance;let arm=surface-body.position.xyz;
    position+=normal*(.01-distance);
    let relative=velocity-body.velocity.xyz-cross(body.angular.xyz,arm);let vn=dot(relative,normal);
    if(vn>=0.){continue;}
    let lever=cross(arm,normal);
    let inverseLever=vec3f(dot(body.inertia0.xyz,lever),dot(body.inertia1.xyz,lever),dot(body.inertia2.xyz,lever));
    let magnitude=-vn/(1./particleMass+body.angular.w+dot(lever,inverseLever));
    let impulse=-normal*magnitude;let torque=cross(arm,impulse);
    velocity-=impulse/particleMass;
    let linear=vec3i(round(impulse*impulseScale));let angular=vec3i(round(torque*impulseScale));
    atomicAdd(&impulses[i].x,linear.x);atomicAdd(&impulses[i].y,linear.y);atomicAdd(&impulses[i].z,linear.z);
    atomicAdd(&impulses[i].tx,angular.x);atomicAdd(&impulses[i].ty,angular.y);atomicAdd(&impulses[i].tz,angular.z);
    atomicAdd(&impulses[i].count,1);
    if(any(abs(impulse*impulseScale)>vec3f(1e8))||any(abs(torque*impulseScale)>vec3f(1e8))){atomicStore(&impulses[i].overflow,1);}
  }
  particles[id.x].position=clamp((position-origin)/cell,vec3f(2),vec3f(extentX,extentY,extentZ)-vec3f(3));
  particles[id.x].v=velocity/(cell*timeScale);
  for(var axis=0;axis<3;axis++){
    if(particles[id.x].position[axis]<=2.){particles[id.x].v[axis]=max(0.,particles[id.x].v[axis]);}
    if(particles[id.x].position[axis]>=vec3f(extentX,extentY,extentZ)[axis]-3.){particles[id.x].v[axis]=min(0.,particles[id.x].v[axis]);}
  }
}
