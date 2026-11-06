// An image-space guide over the integrated linear light/transmission image.
// Derivative-of-binomial smoothing rejects a one-pixel alternating pattern;
// it is a structural hint, not a classifier that proves a contour is real.
export const INTEGRAL_SIGNAL_WGSL=/* wgsl */`
fn integralSignal(v:vec4<f32>)->vec2<f32> {
  return vec2<f32>(log(1.0+dot(max(v.rgb,vec3<f32>(0.0)),vec3<f32>(.2126,.7152,.0722))),1.0-clamp(v.a,0.0,1.0));
}
`;
export const INTEGRAL_EDGE_GUIDE_WGSL=/* wgsl */`
@group(0) @binding(0) var raw:texture_2d<f32>;
@group(0) @binding(1) var depth:texture_2d<f32>;
@group(0) @binding(2) var gradients:texture_storage_2d<rgba32float,write>;
${INTEGRAL_SIGNAL_WGSL}
@compute @workgroup_size(8,8)
fn edges(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(raw);if(any(id.xy>=size)){return;}
 let p=vec2<i32>(id.xy);let z=textureLoad(depth,p,0).x;
 let blur=array<f32,5>(1,4,6,4,1);let derivative=array<f32,5>(-1,-2,0,2,1);
 var total=vec2<f32>(0.0);var weight=0.0;
 var dx=vec2<f32>(0.0);var dy=vec2<f32>(0.0);var wx=0.0;var wy=0.0;
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let q=clamp(p+vec2<i32>(x,y),vec2<i32>(0),vec2<i32>(size)-1);
  let qz=textureLoad(depth,q,0).x;
  if(abs(qz-z)>.01*max(1.0,min(abs(z),abs(qz)))){continue;}
  let s=integralSignal(textureLoad(raw,q,0));
  let w=blur[x+2]*blur[y+2];let gx=derivative[x+2]*blur[y+2];let gy=blur[x+2]*derivative[y+2];
  total+=w*s;weight+=w;dx+=gx*s;dy+=gy*s;wx+=gx;wy+=gy;
 }}
 let mean=total/weight;
 // Quotient-rule normalization: masked or clipped support cannot invent an
 // edge in a constant signal. The factor two gives unit slope on a ramp.
 let gx=2.0*(dx-mean*wx)/weight;let gy=2.0*(dy-mean*wy)/weight;
 textureStore(gradients,p,vec4<f32>(gx.x,gy.x,gx.y,gy.y));
}
`;
export const INTEGRAL_IMAGE_EDGE_WEIGHT_WGSL=/* wgsl */`
fn integralImageEdgeWeight(a:vec4<f32>,b:vec4<f32>,offset:vec2<f32>,strength:f32)->f32 {
 let g=.5*(a+b);
 let change=vec2<f32>(dot(g.xy,offset)/.25,dot(g.zw,offset)/.1);
 // Strength bounds attenuation directly: .001 can remove at most .1% of a
 // neighbor's weight, even at an arbitrarily strong detected contour.
 return mix(1.0,exp(-dot(change,change)),clamp(strength,0.0,1.0));
}
`;
export function createIntegralEdgeGuide(device){
 let texture=null,pipeline=null;
 return {
  encode(encoder,raw,depth,timestampWrites){
   if(raw.width!==depth.width||raw.height!==depth.height)throw Error('Image edge guide requires matching raw/depth dimensions');
   if(!texture||texture.width!==raw.width||texture.height!==raw.height){
    texture?.destroy();texture=device.createTexture({label:'integral image edge gradients',size:[raw.width,raw.height],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
   }
   pipeline ||=device.createComputePipeline({label:'smoothed integral image edges',layout:'auto',compute:{module:device.createShaderModule({code:INTEGRAL_EDGE_GUIDE_WGSL}),entryPoint:'edges'}});
   const pass=encoder.beginComputePass({label:'integral image edge guide',...(timestampWrites?{timestampWrites}:{})});pass.setPipeline(pipeline);
   pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[raw,depth,texture].map((t,binding)=>({binding,resource:t.createView()}))}));
   pass.dispatchWorkgroups(Math.ceil(raw.width/8),Math.ceil(raw.height/8));pass.end();return texture;
  },
  get texture(){return texture;},
  describe(){return {width:texture?.width??0,height:texture?.height??0,bytes:texture?texture.width*texture.height*16:0,footprint:'5x5-binomial-derivative-log-light-and-opacity',format:'rgba32float'};},
  dispose(){texture?.destroy();texture=null;}
 };
}
