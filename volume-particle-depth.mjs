// Camera-depth optical field. Each current billboard deposits into one center
// slice; this is not integration of the full 3D Gaussian's depth support.
export function particleDepthLayout(s,{width,height,limit}){
 if(!s.depthMode)return null;
 const slices=s.depthSlices,scale=s.depthScale;
 if(![1,2].includes(s.depthMode)||!Number.isSafeInteger(slices)||slices<1||slices>0xffffffff||!Number.isFinite(scale)||scale<=0)throw Error('Invalid particle depth field');
 const w=Math.max(1,Math.ceil(width*scale)),h=Math.max(1,Math.ceil(height*scale));
 const maxCols=Math.floor(limit.maxTextureDimension2D/w),maxRows=Math.floor(limit.maxTextureDimension2D/h);
 if(maxCols<1||maxRows<1||slices>maxCols*maxRows)throw Error('Particle depth field exceeds device texture dimensions; previous field preserved');
 const columns=Math.max(Math.ceil(slices/maxRows),Math.min(maxCols,Math.ceil(Math.sqrt(slices)))),rows=Math.ceil(slices/columns);
 return {width:w,height:h,slices,columns,rows,atlasWidth:w*columns,atlasHeight:h*rows,bytes:w*h*columns*rows*6+32};
}
export const PARTICLE_DEPTH_RENDER_WGSL=`
struct ParticleDepthParams {size:vec4<u32>}
@group(0) @binding(3) var<uniform> particleDepth:ParticleDepthParams;
@group(0) @binding(4) var<storage,read> particleDepthBounds:array<u32>;
@group(0) @binding(5) var particleDepthPrefix:texture_2d<f32>;
fn particleDepthCoordinate(clip:vec4<f32>)->vec2<f32>{
 var lo=bitcast<f32>(particleDepthBounds[0]);var hi=bitcast<f32>(particleDepthBounds[1]);
 if(hi<=lo){lo=clip.w-.5;hi=clip.w+.5;}
 let z=clamp((clip.w-lo)/max(hi-lo,1e-6),0.0,1.0)*f32(particleDepth.size.w);
 let layer=min(u32(z),particleDepth.size.w-1u);return vec2<f32>(f32(layer),clamp(z-f32(layer),0.0,1.0));
}
fn particleDepthTile(layer:u32)->vec2<u32>{return vec2<u32>(layer%particleDepth.size.z,layer/particleDepth.size.z);}
fn particleDepthCumulative(xy:vec2<i32>,layer:i32)->f32{
 if(layer<0){return 0.0;}return textureLoad(particleDepthPrefix,xy+vec2<i32>(particleDepthTile(u32(layer))*particleDepth.size.xy),0).r;
}
fn particleDepthWeight(xy:vec2<f32>,depth:vec2<f32>)->f32{
 // Nearest field cell is deliberate: this first route uses a piecewise-constant
 // XY profile. Filtering across opaque boundaries is not silently introduced.
 let at=clamp(vec2<i32>(xy/u.raster.xy*vec2<f32>(particleDepth.size.xy)),vec2<i32>(0),vec2<i32>(particleDepth.size.xy)-1);
 let layer=i32(depth.x);let before=particleDepthCumulative(at,layer-1);let tau=max(0.0,particleDepthCumulative(at,layer)-before);
 if(PARTICLE_DEPTH_MODE==2u){return exp(-before-tau*depth.y);}
 let local=select(1.0,(1.0-exp(-tau))/max(tau,1e-6),tau>1e-5);return exp(-before)*local;
}
`;
const PREFIX=`
struct Params {size:vec4<u32>}
@group(0) @binding(0) var opticalDepth:texture_2d<f32>;
@group(0) @binding(1) var prefix:texture_storage_2d<r32float,write>;
@group(0) @binding(2) var<uniform> params:Params;
@compute @workgroup_size(8,8) fn build(@builtin(global_invocation_id) gid:vec3<u32>){
 if(any(gid.xy>=params.size.xy)){return;}var tau=0.0;
 for(var k=0u;k<params.size.w;k++){
  let at=vec2<i32>(gid.xy+vec2<u32>(k%params.size.z,k/params.size.z)*params.size.xy);
  // Half-float additive overflow represents an optically opaque cell. Clamp
  // only at its native finite range before subtraction in the query pass.
  tau+=min(textureLoad(opticalDepth,at,0).r,65504.0);textureStore(prefix,at,vec4<f32>(tau));
 }
}`;
export function createParticleDepthField(device,{optionsWgsl,options}){
 const params=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const bounds=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const boundsCode=optionsWgsl+`
 @group(0) @binding(0) var<storage,read> particles:array<Particle>;
 @group(0) @binding(1) var<uniform> u:Options;
 @group(0) @binding(2) var<storage,read_write> bounds:array<atomic<u32>>;
 var<workgroup> lower:array<u32,64>;var<workgroup> upper:array<u32,64>;
 @compute @workgroup_size(64) fn build(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) tid:u32){
  var lo=0x7f800000u;var hi=0u;
  if(gid.x<u.size.z){let p=particles[gid.x];let depth=(u.vp*vec4<f32>(p.anchor.xyz,1)).w;if(p.anchor.w>0&&depth>0){lo=bitcast<u32>(depth);hi=lo;}}
  lower[tid]=lo;upper[tid]=hi;workgroupBarrier();
  for(var stride=32u;stride>0u;stride/=2u){if(tid<stride){lower[tid]=min(lower[tid],lower[tid+stride]);upper[tid]=max(upper[tid],upper[tid+stride]);}workgroupBarrier();}
  if(tid==0u){atomicMin(&bounds[0],lower[0]);atomicMax(&bounds[1],upper[0]);}
 }`;
 const boundPipeline=device.createComputePipeline({label:'retained particle camera depth range',layout:'auto',compute:{module:device.createShaderModule({code:boundsCode}),entryPoint:'build'}});
 const prefixPipeline=device.createComputePipeline({label:'particle extinction depth prefix',layout:'auto',compute:{module:device.createShaderModule({code:PREFIX}),entryPoint:'build'}});
 let opticalDepth=null,prefix=null,layout=null;const retired=[];
 const drain=()=>{if(retired.length){const old=retired.splice(0);queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(t=>t.destroy())));}};
 return {
  prepare(encoder,s,input,particles,slots,profileWrites=()=>({})){
   const plan=particleDepthLayout(s,input),key=JSON.stringify(plan);
   if(JSON.stringify(layout)!==key){if(opticalDepth)retired.push(opticalDepth,prefix);layout=plan;
    opticalDepth=device.createTexture({label:'particle per-slice optical depth',size:[plan.atlasWidth,plan.atlasHeight],format:'r16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    prefix=device.createTexture({label:'particle cumulative optical depth',size:[plan.atlasWidth,plan.atlasHeight],format:'r32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});}
   device.queue.writeBuffer(params,0,new Uint32Array([plan.width,plan.height,plan.columns,plan.slices]));device.queue.writeBuffer(bounds,0,new Uint32Array([0x7f800000,0,0,0]));
   const p=encoder.beginComputePass({label:'particle retained depth bounds',...profileWrites('depthBounds')});p.setPipeline(boundPipeline);p.setBindGroup(0,device.createBindGroup({layout:boundPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:particles}},{binding:1,resource:{buffer:options}},{binding:2,resource:{buffer:bounds}}]}));p.dispatchWorkgroups(Math.ceil(slots/64));p.end();drain();return plan;
  },
  get target(){return opticalDepth;},
  get layout(){return layout;},
  entries(query=false){return [{binding:3,resource:{buffer:params}},{binding:4,resource:{buffer:bounds}},...(query?[{binding:5,resource:prefix.createView()}]:[])];},
  prefix(encoder,profileWrites=()=>({})){const p=encoder.beginComputePass({label:'particle optical depth prefix',...profileWrites('depthPrefix')});p.setPipeline(prefixPipeline);p.setBindGroup(0,device.createBindGroup({layout:prefixPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:opticalDepth.createView()},{binding:1,resource:prefix.createView()},{binding:2,resource:{buffer:params}}]}));p.dispatchWorkgroups(Math.ceil(layout.width/8),Math.ceil(layout.height/8));p.end();},
  dispose(){retired.push(params,bounds,...(opticalDepth?[opticalDepth,prefix]:[]));opticalDepth=prefix=layout=null;drain();}
 };
}
