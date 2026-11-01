// Rehydrate a newly allocated detail region from the live world field. The
// world remains allocated and keeps its transport clock throughout the edit.
export const WORLD_SEED_WGSL=/* wgsl */`
struct Params {dims:vec4<f32>,mapping:vec4<f32>,lo:vec4<f32>,flow:vec4<f32>,material:vec4<f32>,ambient:vec4<f32>}
struct Gas {a:vec4<f32>,b:vec4<f32>}
@group(0) @binding(0) var<uniform> u:Params;
@group(0) @binding(1) var<storage,read> gas:array<Gas>;
@group(0) @binding(2) var<storage,read> velocity:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> fine:array<vec4<f32>>;
@group(0) @binding(4) var reaction:texture_storage_3d<rg32float,write>;
fn inside(c:vec3<i32>,d:vec3<f32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(d));}
fn idx(c:vec3<i32>,d:vec3<f32>)->u32{return u32(c.x+i32(d.x)*(c.y+i32(d.y)*c.z));}
fn materialAt(p:vec3<f32>)->Gas{
 let q=(p-u.lo.xyz)/u.material.w-.5;let b=vec3<i32>(floor(q));let f=fract(q);var a=vec4<f32>(0);var r=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let c=b+vec3<i32>(x,y,z);let weights=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));let w=weights.x*weights.y*weights.z;
  var v=Gas(vec4<f32>(0,0,0,u.ambient.x),vec4<f32>(0));if(inside(c,u.material.xyz)){v=gas[idx(c,u.material.xyz)];}a+=w*v.a;r+=w*v.b;
 }}}return Gas(a,r);
}
fn faceAt(p:vec3<f32>,axis:u32)->f32{
 var offset=vec3<f32>(.5);offset[axis]=1.0;let q=(p-u.lo.xyz)/u.flow.w-offset;let b=vec3<i32>(floor(q));let f=fract(q);var value=0.0;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let c=b+vec3<i32>(x,y,z);if(!inside(c,u.flow.xyz)){continue;}let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));value+=velocity[idx(c,u.flow.xyz)][axis]*w.x*w.y*w.z;
 }}}return value;
}
@compute @workgroup_size(4,4,4)
fn seedFine(@builtin(global_invocation_id)c:vec3<u32>){
 if(any(c>=vec3<u32>(u.dims.xyz))){return;}
 let local=(vec3<f32>(c)+.5)*2.0/u.dims.x-1.0;let p=u.mapping.xyz+local*u.mapping.w;let r=materialAt(p);
 var v=vec3<f32>(0);for(var axis=0u;axis<3u;axis++){
  var face=p;if(u.dims.w>.5){face[axis]+=u.mapping.w/u.dims.x;}
  v[axis]=faceAt(face,axis)/(u.mapping.w*2.0/u.dims.x);
 }
 let i=idx(vec3<i32>(c),u.dims.xyz)*4u;
 fine[i]=vec4<f32>(v,0);fine[i+1u]=vec4<f32>(r.a.xyz,0);fine[i+2u]=vec4<f32>(0);fine[i+3u]=vec4<f32>(0);
 textureStore(reaction,vec3<i32>(c),vec4<f32>(r.a.w,r.b.x,0,0));
}
`;
export function createWorldSeed(device){
 const module=device.createShaderModule({label:'world gas into relocated Fine region',code:WORLD_SEED_WGSL});
 const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'seedFine'}});
 const uniform=device.createBuffer({label:'world seed coordinates',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 return {encode(encoder,{plan,mapping,dims,staggered,gas,velocity,fluid,reaction,ambient=1}){
  device.queue.writeBuffer(uniform,0,new Float32Array([...dims,staggered?1:0,...mapping,...plan.min,0,...plan.flowDims,plan.flowPitch,...plan.materialDims,plan.materialPitch,ambient,0,0,0]));
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[uniform,gas,velocity,fluid].map((buffer,binding)=>({binding,resource:{buffer}})).concat({binding:4,resource:reaction.createView()})});
  const pass=encoder.beginComputePass({label:'restore live gas in Fine region'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(...dims.map(n=>Math.ceil(n/4)));pass.end();
 },destroy(){uniform.destroy();}};
}
