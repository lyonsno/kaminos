// Prototype: all source cells contribute to fixed vertical regions. No CPU
// readback, brightest-cell selection, or temporal history in the serving path.
export function pointRegionPlan(dimensions,count) {
  if(!Array.isArray(dimensions)||dimensions.length!==3||dimensions.some(n=>!Number.isInteger(n)||n<1))throw new Error('positive source dimensions required');
  if(!Number.isInteger(count)||count<1||count>dimensions[1])throw new Error('point region count must fit source height');
  return {dimensions:[...dimensions],count};
}
export function reducePointRegionsReference(values,dimensions,count,gain=1) {
  pointRegionPlan(dimensions,count);
  if(values.length!==dimensions.reduce((a,b)=>a*b,4)||!Number.isFinite(gain)||gain<0)throw new Error('source values and gain invalid');
  const pitch=2/dimensions[0],rows=Array.from({length:count},()=>({position:[0,0,0],radiusSquared:0,energy:[0,0,0],weight:0}));
  for(let z=0;z<dimensions[2];z++)for(let y=0;y<dimensions[1];y++)for(let x=0;x<dimensions[0];x++){
    const row=rows[Math.min(count-1,Math.floor(y*count/dimensions[1]))],i=4*(x+dimensions[0]*(y+dimensions[1]*z));
    const rgb=[0,1,2].map(c=>Math.max(0,values[i+c])*gain*pitch**3),w=rgb.reduce((a,b)=>a+b,0),p=[x,y,z].map(v=>-1+(v+.5)*pitch);
    for(let a=0;a<3;a++){row.energy[a]+=rgb[a];row.position[a]+=p[a]*w;}
    row.radiusSquared+=p.reduce((s,v)=>s+v*v,0)*w;row.weight+=w;
  }
  return rows.map(({weight,position,radiusSquared,energy})=>{
    position=position.map(v=>weight?v/weight:0);
    return {position,energy,radiusSquared:Math.max(0,weight?radiusSquared/weight-position.reduce((s,v)=>s+v*v,0):0)+pitch*pitch/4};
  });
}

export const POINT_REGIONS_WGSL=/* wgsl */`
@group(0) @binding(0) var source:texture_3d<f32>;
@group(0) @binding(1) var output:texture_storage_2d<rgba32float,write>;
@group(0) @binding(2) var<uniform> settings:vec4<f32>;
var<workgroup> energy:array<vec4<f32>,64>;
var<workgroup> moment:array<vec4<f32>,64>;
@compute @workgroup_size(64)
fn reduce(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
 let dims=textureDimensions(source);let count=u32(settings.y);let band=group.x;
 // ceil bounds match floor(y * count / height), even for uneven bands.
 let first=(band*dims.y+count-1u)/count;let end=((band+1u)*dims.y+count-1u)/count;
 let height=end-first;let total=dims.x*height*dims.z;let pitch=2.0/f32(dims.x);
 var e=vec4<f32>(0);var m=vec4<f32>(0);
 for(var i=lane;i<total;i+=64u){
  let c=vec3<u32>(i%dims.x,first+(i/dims.x)%height,i/(dims.x*height));
  let rgb=max(textureLoad(source,vec3<i32>(c),0).rgb,vec3<f32>(0))*settings.x*pitch*pitch*pitch;
  let w=rgb.x+rgb.y+rgb.z;let p=-vec3<f32>(1)+(vec3<f32>(c)+vec3<f32>(.5))*pitch;
  e+=vec4<f32>(rgb,w);m+=vec4<f32>(p*w,dot(p,p)*w);
 }
 energy[lane]=e;moment[lane]=m;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){
  if(lane<stride){energy[lane]+=energy[lane+stride];moment[lane]+=moment[lane+stride];}workgroupBarrier();
 }
 if(lane==0u){
  let w=energy[0].w;let p=moment[0].xyz/max(w,1e-30);
  let radius=max(0.0,moment[0].w/max(w,1e-30)-dot(p,p))+pitch*pitch*.25;
  textureStore(output,vec2<i32>(i32(band),0),vec4<f32>(p,radius));
  textureStore(output,vec2<i32>(i32(band),1),vec4<f32>(energy[0].rgb,w));
 }
}`;

export function createPointRegions(device,{count=4}={}) {
  if(!Number.isInteger(count)||count<1||count>device.limits.maxTextureDimension2D||count>device.limits.maxComputeWorkgroupsPerDimension)throw new Error('point count exceeds device capacity');
  const texture=device.createTexture({label:'live hybrid surface point regions',size:[count,2],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const params=device.createBuffer({label:'hybrid point reduction parameters',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const pipeline=device.createComputePipeline({label:'all-cell source to surface points',layout:'auto',compute:{module:device.createShaderModule({code:POINT_REGIONS_WGSL}),entryPoint:'reduce'}});
  let sourceTexture=null,group=null,metadata=null,disposed=false;
  return {texture,count,
    encode(field){
      if(disposed||field.status!=='encoded'||!field.texture)throw new Error('point reduction requires current encoded source');
      pointRegionPlan(field.dimensions,count);
      if(!Number.isFinite(field.gain)||field.gain<0)throw new Error('point reduction requires nonnegative gain');
      if(sourceTexture!==field.texture){sourceTexture=field.texture;group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:sourceTexture.createView()},{binding:1,resource:texture.createView()},{binding:2,resource:{buffer:params}}]});}
      device.queue.writeBuffer(params,0,new Float32Array([field.gain,count,0,0]));
      const encoder=device.createCommandEncoder({label:'hybrid live surface light reduction'}),pass=encoder.beginComputePass();
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(count);pass.end();device.queue.submit([encoder.finish()]);
      metadata={identity:'all-cell-vertical-point-regions-v0',count,generation:field.generation,frame:field.frame,gain:field.gain,sourceCells:field.dimensions.reduce((a,b)=>a*b,1)};
      return {...metadata};
    },
    debugState:()=>metadata?{...metadata}:null,
    destroy(){disposed=true;metadata=null;texture.destroy();params.destroy();},
  };
}
