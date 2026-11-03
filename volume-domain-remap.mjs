// Change the coverage transform without reallocating the simulation. Fields
// remain at their world positions; velocity is converted between cell units.
// Overlap uses the retained Fine field; new coverage samples the live World.
export const DOMAIN_REMAP_WGSL = /* wgsl */`
struct Params {
 dims:vec4<f32>, before:vec4<f32>, after:vec4<f32>, world:vec4<f32>,
 lo:vec4<f32>, flow:vec4<f32>, material:vec4<f32>, options:vec4<f32>
}
struct Gas { a:vec4<f32>, b:vec4<f32> }
@group(0) @binding(0) var<uniform> u:Params;
@group(0) @binding(1) var<storage,read> src:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> dst:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> frontSrc:array<f32>;
@group(0) @binding(4) var<storage,read_write> frontDst:array<f32>;
@group(0) @binding(5) var<storage,read> quenchSrc:array<u32>;
@group(0) @binding(6) var<storage,read_write> quenchDst:array<u32>;
@group(0) @binding(7) var<storage,read> gas:array<Gas>;
@group(0) @binding(8) var<storage,read> flow:array<vec4<f32>>;
@group(0) @binding(9) var reactionSrc:texture_3d<f32>;
@group(0) @binding(10) var reactionDst:texture_storage_3d<rg32float,write>;
@group(0) @binding(11) var waveletSrc:texture_3d<f32>;
@group(0) @binding(12) var waveletDst:texture_storage_3d<rgba32float,write>;
@group(0) @binding(13) var lowerSrc:texture_2d_array<f32>;
@group(0) @binding(14) var lowerDst:texture_storage_2d_array<r32float,write>;
fn idx(c:vec3<i32>,d:vec3<f32>)->u32{return u32(c.x+i32(d.x)*(c.y+i32(d.y)*c.z));}
fn inside(p:vec3<f32>,d:vec3<f32>)->bool{return all(p>=vec3<f32>(0))&&all(p<d);}
fn weights(f:vec3<f32>,o:vec3<i32>)->f32{let w=select(1.0-f,f,o==vec3<i32>(1));return w.x*w.y*w.z;}
fn worldPosition(p:vec3<f32>)->vec3<f32>{return u.after.xyz+(p*2.0/u.dims.x-1.0)*u.after.w;}
fn oldPosition(w:vec3<f32>)->vec3<f32>{return ((w-u.before.xyz)/u.before.w+1.0)*u.dims.x*.5;}
fn worldGas(w:vec3<f32>)->Gas{
 var result=Gas(vec4<f32>(0,0,0,u.options.z),vec4<f32>(0));
 if(u.options.x<.5){return result;}
 let p=(w-u.world.xyz)/u.world.w;
 let q=(p-u.lo.xyz)/u.material.w-.5;let b=vec3<i32>(floor(q));let f=fract(q);
 result=Gas(vec4<f32>(0),vec4<f32>(0));
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let o=vec3<i32>(x,y,z);let c=b+o;var v=Gas(vec4<f32>(0,0,0,u.options.z),vec4<f32>(0));
  if(inside(vec3<f32>(c),u.material.xyz)){v=gas[idx(c,u.material.xyz)];}
  let weight=weights(f,o);result.a+=v.a*weight;result.b+=v.b*weight;
 }}}return result;
}
fn worldVelocity(w:vec3<f32>,axis:u32)->f32{
 if(u.options.x<.5){return 0.0;}
 var offset=vec3<f32>(.5);offset[axis]=1.0;
 let q=((w-u.world.xyz)/u.world.w-u.lo.xyz)/u.flow.w-offset;let b=vec3<i32>(floor(q));let f=fract(q);var result=0.0;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let o=vec3<i32>(x,y,z);let c=b+o;
  if(inside(vec3<f32>(c),u.flow.xyz)){result+=flow[idx(c,u.flow.xyz)][axis]*weights(f,o);}
 }}}return result*u.world.w/(2.0*u.after.w/u.dims.x);
}
fn velocityAt(w:vec3<f32>,axis:u32)->f32{
 let raw=oldPosition(w);
 // Roundoff at a retained boundary face must not switch ownership to World.
 if(any(raw<vec3<f32>(-0.0001))||any(raw>u.dims.xyz+0.0001)){return worldVelocity(w,axis);}
 let p=clamp(raw,vec3<f32>(0),u.dims.xyz);
 var offset=vec3<f32>(.5);if(u.options.y>.5){offset[axis]=1.0;}
 let q=p-offset;let b=vec3<i32>(floor(q));let f=fract(q);var result=0.0;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let o=vec3<i32>(x,y,z);let raw=b+o;let c=clamp(raw,vec3<i32>(0),vec3<i32>(u.dims.xyz)-1);
  var value=src[idx(c,u.dims.xyz)*4u][axis];
  if(u.options.y>.5&&raw[axis]<0){value=textureLoad(lowerSrc,vec2<i32>(c[(axis+1u)%3u],c[(axis+2u)%3u]),i32(axis),0).x;}
  result+=value*weights(f,o);
 }}}return result*u.before.w/u.after.w;
}
@compute @workgroup_size(4,4,4)
fn remap(@builtin(global_invocation_id)c:vec3<u32>){
 if(any(c>=vec3<u32>(u.dims.xyz))){return;}
 let w=worldPosition(vec3<f32>(c)+.5);let p=oldPosition(w);let retained=inside(p,u.dims.xyz);
 let base=vec3<i32>(floor(p-.5));let f=fract(p-.5);let i=idx(vec3<i32>(c),u.dims.xyz);
 var cells:array<vec4<f32>,4>;var front=0.0;var wet=0.0;var reaction=vec4<f32>(u.options.z,0,0,0);
 if(retained){
  reaction=vec4<f32>(0);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let o=vec3<i32>(x,y,z);let q=clamp(base+o,vec3<i32>(0),vec3<i32>(u.dims.xyz)-1);let j=idx(q,u.dims.xyz);let weight=weights(f,o);
   for(var slot=0u;slot<4u;slot++){cells[slot]+=src[j*4u+slot]*weight;}
   front+=frontSrc[j]*weight;wet+=f32(quenchSrc[j])*weight;
   if(textureDimensions(reactionSrc).x==u32(u.dims.x)){reaction+=textureLoad(reactionSrc,q,0)*weight;}
  }}}
 }else{
  let r=worldGas(w);cells[1]=vec4<f32>(r.a.xyz,0);reaction=vec4<f32>(r.a.w,r.b.x,0,0);
 }
 for(var axis=0u;axis<3u;axis++){
  var face=vec3<f32>(c)+.5;if(u.options.y>.5){face[axis]+=.5;}
  cells[0][axis]=velocityAt(worldPosition(face),axis);
  if(c[axis]==0u){face[axis]=0.0;textureStore(lowerDst,vec2<i32>(i32(c[(axis+1u)%3u]),i32(c[(axis+2u)%3u])),i32(axis),vec4<f32>(velocityAt(worldPosition(face),axis)));}
 }
 for(var slot=0u;slot<4u;slot++){dst[i*4u+slot]=cells[slot];}
 frontDst[i]=front;quenchDst[i]=u32(wet+.5);
 if(textureDimensions(reactionSrc).x==u32(u.dims.x)){textureStore(reactionDst,vec3<i32>(c),reaction);}
 if(textureDimensions(waveletSrc).x==u32(u.dims.x)){
  for(var coordinateSet=0;coordinateSet<2;coordinateSet++){
   var coord=vec4<f32>(p,0);
   if(u.dims.w>0.0){coord=vec4<f32>((w/u.options.w+1.0)*u.dims.w*.5,0);}
   if(retained){coord=vec4<f32>(0);
    for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
     let o=vec3<i32>(x,y,z);var q=clamp(base+o,vec3<i32>(0),vec3<i32>(u.dims.xyz)-1);q.z+=coordinateSet*i32(u.dims.z);
     coord+=textureLoad(waveletSrc,q,0)*weights(f,o);
    }}}
   }
   coord.w*=u.before.w/u.after.w;
   var destination=vec3<i32>(c);destination.z+=coordinateSet*i32(u.dims.z);textureStore(waveletDst,destination,coord);
  }
 }
}
`;

const pipelines = new WeakMap();
export function createDomainRemap(device, dimensions) {
  let pipeline = pipelines.get(device);
  if (!pipeline) {
    const module = device.createShaderModule({label: 'live domain remap', code: DOMAIN_REMAP_WGSL});
    pipeline = device.createComputePipeline({layout: 'auto', compute: {module, entryPoint: 'remap'}});
    pipelines.set(device, pipeline);
  }
  const uniform = device.createBuffer({label: 'domain remap coordinates', size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  const empty = device.createBuffer({label: 'domain remap absent World', size: 32, usage: GPUBufferUsage.STORAGE});
  const side = Math.max(...dimensions);
  const lowerSnapshot = device.createTexture({label: 'domain remap prior lower faces', size: [side, side, 3],
    dimension: '2d', format: 'r32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING});
  return {
    residentBytes: 160 + side * side * 12,
    encode(encoder, {before, after, fluid, front, quench, reaction, wavelet, lower, world = null, staggered = true, ambient = 1, calibration = null}) {
      const anchor = world?.anchor ?? {translate: [0, 0, 0], scale: 1};
      const plan = world?.plan ?? {min: [0, 0, 0], flowDims: [1, 1, 1], flowPitch: 1, materialDims: [1, 1, 1], materialPitch: 1};
      device.queue.writeBuffer(uniform, 0, new Float32Array([
        ...dimensions, calibration?.velocityCells??0, ...before.translate, before.scale, ...after.translate, after.scale,
        ...anchor.translate, anchor.scale, ...plan.min, 0, ...plan.flowDims, plan.flowPitch,
        ...plan.materialDims, plan.materialPitch, world ? 1 : 0, staggered ? 1 : 0, ambient, (calibration?.width??2)/2,
      ]));
      encoder.copyTextureToTexture({texture: lower}, {texture: lowerSnapshot}, [side, side, 3]);
      const entries = [uniform, ...fluid, ...front, ...quench, world?.gas ?? empty, world?.velocity ?? empty]
        .map((buffer, binding) => ({binding, resource: {buffer}}));
      [...reaction, ...wavelet].forEach((texture, i) => entries.push({binding: 9 + i, resource: texture.createView()}));
      entries.push({binding: 13, resource: lowerSnapshot.createView({dimension: '2d-array'})},
        {binding: 14, resource: lower.createView({dimension: '2d-array'})});
      const group = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries});
      const pass = encoder.beginComputePass({label: 'retain live domain overlap'});
      pass.setPipeline(pipeline); pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(...dimensions.map(n => Math.ceil(n / 4))); pass.end();
      const cells = dimensions.reduce((a, b) => a * b, 1);
      encoder.copyBufferToBuffer(quench[0], cells * 4, quench[1], cells * 4, 20);
    },
    destroy() { uniform.destroy(); empty.destroy(); lowerSnapshot.destroy(); },
  };
}
