import {THERMAL_STONE_WGSL} from './material-law.mjs';
export const THERMAL_MPM_WGSL=THERMAL_STONE_WGSL+`
struct Particle {
 x:vec4f, v:vec4f, f0:vec4f, f1:vec4f, f2:vec4f,
 c0:vec4f, c1:vec4f, c2:vec4f, history:vec4f, rest:vec4f, grad:vec4f
}
struct Node {v:vec4f, heat:vec4f, normal:vec4f, phase:vec4f}
struct Choice {norm:atomic<u32>, seed:atomic<u32>}
struct Params {dims:vec4u, time:vec4f, heat:vec4f, fracture:vec4f, motion:vec4f, init:vec4f}
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read_write> acc:array<atomic<i32>>;
@group(0) @binding(2) var<storage,read_write> nodes:array<Node>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var<storage,read_write> choices:array<Choice>;
@group(0) @binding(5) var<storage,read_write> cg:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> matrixAcc:array<atomic<i32>>;
@group(0) @binding(7) var<storage,read_write> gradients:array<vec4f>;
@group(0) @binding(8) var<storage,read_write> partials:array<vec4f>;
@group(0) @binding(9) var<storage,read_write> control:array<vec4f>;
@group(0) @binding(11) var<storage,read_write> heads:array<atomic<u32>>;
@group(0) @binding(12) var<storage,read_write> next:array<u32>;
@group(0) @binding(13) var<storage,read_write> diagnostics:array<atomic<u32>>;
const FP:f32=1048576.;
fn nodeId(p:vec3i)->u32 {return u32((p.z*i32(params.dims.x)+p.y)*i32(params.dims.x)+p.x);}
fn inside(p:vec3i)->bool {return all(p>=vec3i(0))&&all(p<vec3i(i32(params.dims.x)));}
fn positionOfNode(i:u32)->vec3i {let n=params.dims.x;return vec3i(i32(i%n),i32((i/n)%n),i32(i/(n*n)));}
fn particleF(p:Particle)->mat3x3f{return mat3x3f(p.f0.xyz,p.f1.xyz,p.f2.xyz);}
fn particleC(p:Particle)->mat3x3f{return mat3x3f(p.c0.xyz,p.c1.xyz,p.c2.xyz);}
@compute @workgroup_size(128) fn initialize(@builtin(global_invocation_id) id:vec3u) {
 let i=id.x;if(i>=params.dims.z){return;}
 let n=params.dims.y;let v=vec3f(f32(i%n),f32((i/n)%n),f32(i/(n*n)));
 let center=3.+f32(n)*.25;let rest=vec3f(3.25)+v*.5;
 let stretch=1.+params.init.x;
 let x=vec3f(center)+(rest-vec3f(center))*stretch;
 let split=params.init.y>0.;
 let intact=select(1.,0.,split&&abs(rest.x-center)<.76);
 let velocity=select(vec3f(0),vec3f(select(-params.init.z,params.init.z,rest.x>=center),0,0),split);
 let strength=1.+params.fracture.w*sin(rest.x*1.71)*sin(rest.y*2.13)*sin(rest.z*1.37);
 particles[i]=Particle(vec4f(x,.125),vec4f(velocity,1.),
  vec4f(stretch,0,0,0),vec4f(0,stretch,0,0),vec4f(0,0,stretch,0),
  vec4f(0),vec4f(0),vec4f(0),vec4f(intact,0,.125,strength),vec4f(rest,1),vec4f(0));
}
`;
