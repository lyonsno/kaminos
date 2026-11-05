import {AGX_WGSL} from './volume-agx.mjs';
import {EMISSIVE_CAMERA_WGSL} from './volume-emissive-transport.mjs';

// Image reconstruction is independent of the spatial importance allocator.
export function integralReconstructionSettings(c={}) {
  const mode=c.integralReconstruction??'off';
  if(!['off','spatial','temporal','combined'].includes(mode))throw Error('Reconstruction mode is unknown');
  const values={reconstructionSpatial:.6,reconstructionRadius:1,reconstructionWindow:8,reconstructionResponse:1,reconstructionEdge:2};
  for(const k of Object.keys(values)) {
    const v=c[k]??values[k];
    if(typeof v!=='number'||!Number.isFinite(v)||!Number.isFinite(Math.fround(v))||v<0||(k==='reconstructionSpatial'&&v>1)||(k==='reconstructionWindow'&&v<1))throw Error(`Reconstruction invalid ${k}`);
    values[k]=v;
  }
  if(c.reconstructionFresh!==undefined&&typeof c.reconstructionFresh!=='boolean')throw Error('Reconstruction fresh samples must be boolean');
  const retention=Math.fround(1-1/values.reconstructionWindow);
  if(retention>=1)throw Error('Reconstruction window exceeds f32 memory precision');
  return {integralReconstruction:mode,...values,reconstructionFresh:c.reconstructionFresh??true,retention};
}

export const INTEGRAL_FILTER_FUNCTIONS_WGSL=/* wgsl */`
fn integralSignal(v:vec4<f32>)->vec2<f32> {
  return vec2<f32>(log(1.0+dot(max(v.rgb,vec3<f32>(0.0)),vec3<f32>(.2126,.7152,.0722))),1.0-clamp(v.a,0.0,1.0));
}
fn integralVariance(m:vec4<f32>)->vec2<f32>{return max(vec2<f32>(0.0),m.zw-m.xy*m.xy);}
fn integralEdgeWeight(a:vec2<f32>,b:vec2<f32>,noise:vec2<f32>,protection:f32)->f32 {
  let d=(a-b)/sqrt(vec2<f32>(.0025)+noise);
  return exp(-protection*dot(d,d));
}
fn integralReuse(current:vec2<f32>,previous:vec2<f32>,variance:vec2<f32>,response:f32,retention:f32)->f32 {
  let d=abs(current-previous)/sqrt(vec2<f32>(.0025)+variance);
  return retention*exp(-response*dot(d,d));
}
`;

export const INTEGRAL_FILTER_WGSL=/* wgsl */`
struct Options { spatial:vec4<f32>, temporal:vec4<f32> }
@group(0) @binding(0) var raw:texture_2d<f32>;
@group(0) @binding(1) var guide:texture_2d<f32>;
@group(0) @binding(2) var previous:texture_2d<f32>;
@group(0) @binding(3) var moments:texture_2d<f32>;
@group(0) @binding(4) var output:texture_storage_2d<rgba32float,write>;
@group(0) @binding(5) var nextMoments:texture_storage_2d<rgba32float,write>;
@group(0) @binding(6) var<uniform> options:Options;
${INTEGRAL_FILTER_FUNCTIONS_WGSL}
@compute @workgroup_size(8,8)
fn reconstruct(@builtin(global_invocation_id) id:vec3<u32>) {
  let size=textureDimensions(raw);if(any(id.xy>=size)){return;}
  let p=vec2<i32>(id.xy);let center=textureLoad(raw,p,0);let signal=integralSignal(center);
  let valid=options.temporal.y>.5;
  let old=textureLoad(previous,p,0);let oldMoments=textureLoad(moments,p,0);
  let variance=select(vec2<f32>(0.0),integralVariance(oldMoments),valid);
  var lo=center;var hi=center;var total=center;var weights=1.0;
  var signalSum=signal;var signalSquare=signal*signal;var neighbors=1.0;
  let depth=textureLoad(guide,p,0).x;
  // Fixed nine-tap footprint. Radius changes the footprint, not the tap count.
  // Depth gating prevents a filter across opaque scene geometry boundaries.
  for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    if(x==0&&y==0){continue;}
    let q=clamp(p+vec2<i32>(round(vec2<f32>(f32(x),f32(y))*options.spatial.y)),vec2<i32>(0),vec2<i32>(size)-1);
    let v=textureLoad(raw,q,0);let d=textureLoad(guide,q,0).x;
    let sameDepth=abs(d-depth)<=.01*max(1.0,min(abs(depth),abs(d)));
    if(!sameDepth){continue;}
    lo=min(lo,v);hi=max(hi,v);
    let neighborSignal=integralSignal(v);signalSum+=neighborSignal;signalSquare+=neighborSignal*neighborSignal;neighbors+=1.0;
    let w=integralEdgeWeight(signal,neighborSignal,variance,options.spatial.z)*exp(-.5*f32(x*x+y*y));
    total+=v*w;weights+=w;
  }}
  let relativeNoise=dot(variance,vec2<f32>(1.0))/(.0025+dot(signal,signal));
  // A nonzero spatial floor treats persistent grid quantization too; variance
  // alone would classify stationary voxel boundaries as trustworthy detail.
  let amount=options.spatial.x*(.25+.75*relativeNoise/(relativeNoise+.02));
  let fresh=mix(center,total/weights,amount);
  let freshSignal=integralSignal(fresh);
  let reuse=select(0.0,integralReuse(freshSignal,oldMoments.xy,variance,options.temporal.z,options.temporal.x),valid);
  // Current-neighborhood clamping bounds stale moving flame/smoke history.
  let result=mix(fresh,clamp(old,lo,hi),reuse);
  let localMean=signalSum/neighbors;
  let localVariance=max(vec2<f32>(0.0),signalSquare/neighbors-localMean*localMean);
  // Neighborhood variance seeds uncertain new history instead of trapping a
  // previously unobserved noisy pixel at zero variance forever. This is a
  // reconstruction heuristic, not an unbiased Monte Carlo variance estimator.
  let observation=vec4<f32>(freshSignal,freshSignal*freshSignal+localVariance);
  textureStore(output,p,result);
  textureStore(nextMoments,p,mix(observation,oldMoments,reuse));
}
`;

export const INTEGRAL_PRESENT_WGSL=/* wgsl */`
struct Camera {emissive_white_r:vec4<f32>,emissive_white_g:vec4<f32>,emissive_white_b:vec4<f32>,physical_display:vec4<f32>,reserved_render_controls:vec4<f32>}
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var<uniform> u:Camera;
override TRANSPARENT_CANVAS:bool=false;
${AGX_WGSL}
${EMISSIVE_CAMERA_WGSL}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
  let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);
}
@fragment fn present(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
  let v=textureLoad(image,vec2<i32>(p.xy),0);
  var rgb=emissiveCamera(max(v.rgb,vec3<f32>(0.0)));
  let alpha=clamp(1.0-v.a+max(max(rgb.r,rgb.g),rgb.b)*.08,0.0,1.0);
  if(TRANSPARENT_CANVAS){return vec4<f32>(rgb*alpha,alpha);}
  if(all(v.rgb==vec3<f32>(0.0))&&v.a==1.0){rgb=vec3<f32>(.004,.005,.006);}
  return vec4<f32>(rgb,1.0);
}
`;

export function createIntegralReconstruction(device,{transparent=false}={}) {
  let textures=[],key='',index=0,frames=0,identity=null,lastStep=null,resetReason='new-history',config=null;
  let filter=null,presentModule=null;const pipelines=new Map();
  const options=device.createBuffer({label:'integral reconstruction settings',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const camera=device.createBuffer({label:'integral reconstruction camera',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const reset=reason=>{frames=0;resetReason=reason;};
  const describe=()=>({requested:config?.integralReconstruction??'off',effective:config?.integralReconstruction??'off',frames,resetReason,
    format:'linear-radiance-transmission-rgba32float',bytes:textures.reduce((a,t)=>a+t.width*t.height*(t.format==='r32float'?4:16),0),
    motion:'camera-reset-current-neighborhood-clamp',passes:config?.integralReconstruction==='off'?0:2});
  return {
    reset,
    disable(reason='disabled'){reset(reason);for(const t of textures)t.destroy();textures=[];key='';},
    describe,
    prepare(width,height,controls,sourceIdentity,step) {
      config=integralReconstructionSettings(controls);
      if(config.integralReconstruction==='off'){reset('disabled');return null;}
      if(Math.max(width,height)>device.limits.maxTextureDimension2D)throw Error('Reconstruction dimensions exceed GPU texture capacity');
      if(config.reconstructionRadius>device.limits.maxTextureDimension2D)throw Error('Reconstruction radius exceeds GPU texture capacity');
      const nextKey=`${width}x${height}`;
      if(key!==nextKey) {
        for(const t of textures)t.destroy();
        const make=format=>device.createTexture({label:'linear integral reconstruction',size:[width,height],format,
          usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|(format==='r32float'?GPUTextureUsage.RENDER_ATTACHMENT:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.STORAGE_BINDING)});
        textures=[make('rgba32float'),make('r32float'),make('rgba32float'),make('rgba32float'),make('rgba32float'),make('rgba32float')];key=nextKey;reset('resize');
      }
      if(sourceIdentity!==identity){identity=sourceIdentity;reset('camera-or-render-settings-change');}
      if(lastStep!==null&&(step<lastStep||step>lastStep+1))reset('simulation-discontinuity');lastStep=step;
      return [{view:textures[0].createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}},
        {view:textures[1].createView(),loadOp:'clear',storeOp:'store',clearValue:{r:1e6,g:0,b:0,a:0}}];
    },
    encode(encoder,view,format,cameraValues) {
      filter ||= device.createComputePipeline({label:'noise-aware linear integral reconstruction',layout:'auto',compute:{module:device.createShaderModule({code:INTEGRAL_FILTER_WGSL}),entryPoint:'reconstruct'}});
      presentModule ||= device.createShaderModule({label:'linear integral presentation',code:INTEGRAL_PRESENT_WGSL});
      if(!pipelines.has(format))pipelines.set(format,device.createRenderPipeline({label:'reconstructed volume presentation',layout:'auto',vertex:{module:presentModule,entryPoint:'vs'},fragment:{module:presentModule,entryPoint:'present',constants:{TRANSPARENT_CANVAS:transparent},targets:[{format}]},primitive:{topology:'triangle-list'}}));
      const next=1-index,c=config,spatial=['spatial','combined'].includes(c.integralReconstruction),temporal=['temporal','combined'].includes(c.integralReconstruction);
      device.queue.writeBuffer(options,0,new Float32Array([spatial?c.reconstructionSpatial:0,c.reconstructionRadius,c.reconstructionEdge,0,temporal?Math.min(c.retention,frames/(frames+1)):0,frames>0?1:0,c.reconstructionResponse,0]));
      device.queue.writeBuffer(camera,0,cameraValues);
      const entries=[textures[0],textures[1],textures[2+index],textures[4+index],textures[2+next],textures[4+next]].map((t,binding)=>({binding,resource:t.createView()}));
      entries.push({binding:6,resource:{buffer:options}});
      const compute=encoder.beginComputePass({label:'reconstruct linear light and transmission'});compute.setPipeline(filter);
      compute.setBindGroup(0,device.createBindGroup({layout:filter.getBindGroupLayout(0),entries}));compute.dispatchWorkgroups(Math.ceil(textures[0].width/8),Math.ceil(textures[0].height/8));compute.end();
      const pipeline=pipelines.get(format),pass=encoder.beginRenderPass({label:'present reconstructed integral',colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
      pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:textures[2+next].createView()},{binding:1,resource:{buffer:camera}}]}));pass.draw(3);pass.end();
      index=next;frames++;return describe();
    },
    get raw(){return textures[0];},get guide(){return textures[1];},get output(){return textures[2+index];},get moments(){return textures[4+index];},
    async sample() {
      if(!textures.length||!frames)return {available:false,state:describe()};
      const width=textures[0].width,height=textures[0].height,row=Math.ceil(width*16/256)*256;
      const buffers=[0,2+index,4+index].map(()=>device.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
      try {
        const e=device.createCommandEncoder();[0,2+index,4+index].forEach((n,i)=>e.copyTextureToBuffer({texture:textures[n]},{buffer:buffers[i],bytesPerRow:row},[width,height]));
        device.queue.submit([e.finish()]);await Promise.all(buffers.map(b=>b.mapAsync(GPUMapMode.READ)));
        const arrays=buffers.map(b=>{const raw=new Float32Array(b.getMappedRange()),out=new Float32Array(width*height*4);for(let y=0;y<height;y++)out.set(raw.subarray(y*row/4,y*row/4+width*4),y*width*4);return out;});
        return {available:true,width,height,state:describe(),raw:arrays[0],filtered:arrays[1],moments:arrays[2]};
      }finally{for(const b of buffers){b.unmap();b.destroy();}}
    },
    dispose(){for(const t of textures)t.destroy();textures=[];options.destroy();camera.destroy();}
  };
}
