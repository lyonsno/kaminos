import {INTEGRAL_IMAGE_EDGE_WEIGHT_WGSL} from './volume-integral-edge-guide.mjs';
export const INTEGRAL_GUIDE_VIEWS=['beauty','contours','light','opacity','image-rejection','depth-rejection'];
export function integralGuideDisplaySettings({view='beauty',gain=1}={}){
 if(!INTEGRAL_GUIDE_VIEWS.includes(view))throw Error('Unknown integral guide view');
 if(typeof gain!=='number'||!Number.isFinite(Math.fround(gain))||gain<=0)throw Error('Guide display gain must be positive and finite');
 return {view,gain};
}
export const INTEGRAL_GUIDE_DISPLAY_WGSL=/* wgsl */`
struct Display {values:vec4<f32>}
@group(0) @binding(0) var edges:texture_2d<f32>;
@group(0) @binding(1) var edgeSampler:sampler;
@group(0) @binding(2) var sceneDepth:texture_2d<f32>;
@group(0) @binding(3) var<uniform> settings:Display;
${INTEGRAL_IMAGE_EDGE_WEIGHT_WGSL}
fn gradient(p:vec2<i32>)->vec4<f32>{return textureSampleLevel(edges,edgeSampler,vec2<f32>(p)/(2.0*vec2<f32>(textureDimensions(edges))),0.0);}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
 let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);
}
@fragment fn present(@builtin(position) pixel:vec4<f32>)->@location(0) vec4<f32>{
 let p=vec2<i32>(pixel.xy);let mode=settings.values.x;let gain=settings.values.y;
 if(mode<3.5){
  let g=gradient(p);let magnitude=vec2<f32>(length(g.xy)/.25,length(g.zw)/.1);
  let v=1.0-exp(-gain*magnitude);
  if(mode>2.5){return vec4<f32>(vec3<f32>(v.y),1);}
  if(mode>1.5){return vec4<f32>(vec3<f32>(v.x),1);}
  return vec4<f32>(v.x,v.y,v.y,1);
 }
 let size=vec2<i32>(textureDimensions(sceneDepth));let z=textureLoad(sceneDepth,p,0).x;
 let radius=settings.values.z;let extent=i32(ceil(radius));var rejected=0.0;var total=0.0;
 for(var y=-extent;y<=extent;y++){for(var x=-extent;x<=extent;x++){
  if(x==0&&y==0){continue;}
  let q=clamp(p+vec2<i32>(x,y),vec2<i32>(0),size-1);let qz=textureLoad(sceneDepth,q,0).x;
  let w=(1.0-abs(f32(x))/(radius+1.0))*(1.0-abs(f32(y))/(radius+1.0));
  let sameDepth=abs(qz-z)<=.01*max(1.0,min(abs(z),abs(qz)));
  if(mode>4.5){total+=w;if(!sameDepth){rejected+=w;}}
  else if(sameDepth){total+=w;rejected+=w*(1.0-integralImageEdgeWeight(gradient(p),gradient(q),vec2<f32>(q-p),settings.values.w));}
 }}
 let value=clamp(gain*rejected/max(total,1e-20),0.0,1.0);
 if(mode>4.5){return vec4<f32>(value,0.0,value,1);}
 return vec4<f32>(vec3<f32>(value),1);
}
`;
export function createIntegralGuideDisplay(device){
 const options=device.createBuffer({label:'integral guide display',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const sampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});let module;const pipelines=new Map();
 return {
  encode(encoder,view,format,{edges,depth,display,radius,strength}){
   module ||=device.createShaderModule({code:INTEGRAL_GUIDE_DISPLAY_WGSL});
   if(!pipelines.has(format))pipelines.set(format,device.createRenderPipeline({label:'inspect optical image guide',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'present',targets:[{format}]},primitive:{topology:'triangle-list'}}));
   const pipeline=pipelines.get(format);device.queue.writeBuffer(options,0,new Float32Array([INTEGRAL_GUIDE_VIEWS.indexOf(display.view),display.gain,radius,strength]));
   const pass=encoder.beginRenderPass({label:'display optical guide diagnostic',colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
   pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:edges.createView()},{binding:1,resource:sampler},{binding:2,resource:depth.createView()},{binding:3,resource:{buffer:options}}]}));pass.draw(3);pass.end();
  },dispose(){options.destroy();}
 };
}
