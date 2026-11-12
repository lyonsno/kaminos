import {PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';
// Proposal anchors temporarily occupy their own source row before the source
// raster replaces it. No additional fragment storage slot or CPU readback.
const CODE=/* wgsl */`
struct Particle {anchor:vec4<f32>,source:vec4<f32>,emission:vec4<f32>,motion:vec4<f32>,shape:vec4<f32>,state:vec4<f32>}
struct FollowParams {vp:mat4x4<f32>,dims:vec4<u32>,counts:vec4<u32>,flow:vec4<f32>,policy:vec4<f32>,phases:vec4<f32>,reaction:vec4<f32>,chemistry:vec4<f32>,motion:vec4<f32>}
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<storage,read_write> proposals:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> fine:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> offsets:array<u32>;
@group(0) @binding(4) var<storage,read> ids:array<u32>;
@group(0) @binding(5) var<uniform> u:FollowParams;
${PARTICLE_STATE_WGSL}
fn followHash(x:u32)->u32{var h=x;h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);}
fn followRandom(i:u32,salt:u32)->f32{return f32(followHash(i+u.counts.w*747796405u+salt))/4294967296.0;}
fn followVelocity(p:vec3<f32>)->vec3<f32>{
 let dims=vec3<i32>(u.dims.xyz);var result=vec3<f32>(0);
 for(var a=0u;a<3u;a++){var offset=vec3<f32>(.5);if(u.flow.w>.5){offset[a]=1;}
  let cell=clamp((p+vec3<f32>(1))/u.flow.x-offset,vec3<f32>(0),vec3<f32>(dims)-1.001);let base=vec3<i32>(floor(cell));let f=fract(cell);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),dims-1);let i=u32(c.x+dims.x*(c.y+dims.y*c.z));let w=select(vec3<f32>(1)-f,f,vec3<bool>(x==1,y==1,z==1));result[a]+=fine[4u*i][a]*w.x*w.y*w.z;}}}
 }return result*u.flow.x;
}
@compute @workgroup_size(64) fn propose(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=u.counts.x){return;}let at=4u*i+1u;proposals[at]=vec4<f32>(0);
 let n=offsets[u.dims.w];if(n==0u||followRandom(i,0u)>=u.policy.x){return;}
 let p=particles[ids[min(n-1u,u32(followRandom(i,17u)*f32(n)))]];if(p.anchor.w<=0){return;}
 let activities=vec3<f32>(clamp(p.state.x/max(p.emission.w,1e-20),0.0,1.0),smoothstep(u.chemistry.z,u.chemistry.w,p.state.y),clamp(p.state.z/u.phases.w,0.0,1.0));
 let total=dot(u.phases.xyz,vec3<f32>(1));if(total<=0||followRandom(i,53u)>=dot(activities,u.phases.xyz)/total){return;}
 let dt=u.motion.z;let state=particleCompositionBurn(p.state,u.flow.z,u.chemistry,u.reaction).state;
 let damping=exp(-dt/u.motion.y);let residual=p.motion.xyz*damping+vec3<f32>(0,u.motion.x*state.y*u.motion.y*(1.0-damping),0);
 let jitter=vec3<f32>(followRandom(i,103u),followRandom(i,191u),followRandom(i,293u))*2.0-vec3<f32>(1);
 var velocity=vec3<f32>(0);if(u.flow.y!=0){velocity=followVelocity(p.anchor.xyz);}
 let point=p.anchor.xyz+velocity*u.flow.y+residual*u.motion.z+jitter*u.policy.y*u.flow.x;
 if(any(point<vec3<f32>(-1))||any(point>vec3<f32>(u.dims.xyz)*u.flow.x-vec3<f32>(1))){return;}
 let clip=u.vp*vec4<f32>(point,1);if(clip.w<=1e-5||any(abs(clip.xy)>vec2<f32>(clip.w))){return;}
 proposals[at]=vec4<f32>(point,-1);
}
`;
export function createParticleFollow(device){
 const pipeline=device.createComputePipeline({label:'actual carrier flow-following proposals',layout:'auto',compute:{module:device.createShaderModule({code:CODE}),entryPoint:'propose'}});
 return {encode(encoder,{particles,source,fine,grouping,dims,settings:s,model,stepDelta,reactionDelta,staggered=false,profileWrites=()=>({})}){
  const samples=source.samples??source.pixels;if(Math.ceil(samples/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Follow proposals exceed actual compute dispatch capacity');
  const data=new ArrayBuffer(192),f=new Float32Array(data),u=new Uint32Array(data);f.set(source.viewProj);u.set([...dims,grouping.cellCount],16);u.set([samples,grouping.slots,source.width,source.step],20);f.set([2/dims[0],(s.transportEnabled!==false&&s.updateEnabled!==false?stepDelta:0)*source.backtrace*s.flow,s.reactionEnabled!==false&&s.updateEnabled!==false?reactionDelta:0,Number(staggered)],24);f.set([s.followFraction,s.followJitter,0,0],28);f.set([s.followFuel,s.followHeat,s.followSmoke,1],32);f.set([s.burnTime,s.cooling,s.sootYield,s.smokeLife],36);f.set([model.oxidizerRequirement,s.heatRelease,...model.ignitionBand],40);f.set([s.rise,s.drag,s.transportEnabled!==false&&s.updateEnabled!==false?reactionDelta:0,0],44);
  const params=device.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:true});new Float32Array(params.getMappedRange()).set(f);params.unmap();
  const p=encoder.beginComputePass({label:'flow-following material acquisition',...profileWrites('follow')});p.setPipeline(pipeline);p.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[particles,source.buffer,fine,grouping.offsets,grouping.ids,params].map((buffer,binding)=>({binding,resource:{buffer}}))}));p.dispatchWorkgroups(Math.ceil(samples/64));p.end();queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>params.destroy()));
  return {effective:'gpu-retained-carrier-proposals',attemptFraction:s.followFraction,selection:'uniform live ID; activity-weighted acceptance; analytic coverage fallback',jitterCells:s.followJitter,step:source.step,stepDelta,reactionDelta,counts:'pending explicit source readback'};
 }};
}
