import {createIntegralEdgeGuide,INTEGRAL_SIGNAL_WGSL,INTEGRAL_IMAGE_EDGE_WEIGHT_WGSL} from './volume-integral-edge-guide.mjs';
import {AGX_WGSL} from './volume-agx.mjs';
import {EMISSIVE_CAMERA_WGSL} from './volume-emissive-transport.mjs';

// Image reconstruction is independent of the spatial importance allocator.
export function integralReconstructionSettings(c={}) {
  const mode=c.integralReconstruction??'off';
  if(!['off','spatial','temporal','combined'].includes(mode))throw Error('Reconstruction mode is unknown');
  const edges=c.reconstructionEdges??'samples';
  if(!['off','samples','image'].includes(edges))throw Error('Reconstruction edge guide is unknown');
  const values={reconstructionSpatial:.6,reconstructionRadius:1,reconstructionWindow:8,reconstructionResponse:1,reconstructionEdge:2,reconstructionImageEdge:1};
  for(const k of Object.keys(values)) {
    const v=c[k]??values[k];
    if(typeof v!=='number'||!Number.isFinite(v)||!Number.isFinite(Math.fround(v))||v<0||(['reconstructionSpatial','reconstructionImageEdge'].includes(k)&&v>1)||(k==='reconstructionWindow'&&v<1))throw Error(`Reconstruction invalid ${k}`);
    values[k]=v;
  }
  if(c.reconstructionFresh!==undefined&&typeof c.reconstructionFresh!=='boolean')throw Error('Reconstruction fresh samples must be boolean');
  const retention=Math.fround(1-1/values.reconstructionWindow);
  if(retention>=1)throw Error('Reconstruction window exceeds f32 memory precision');
  return {integralReconstruction:mode,reconstructionEdges:edges,...values,reconstructionFresh:c.reconstructionFresh??true,retention};
}

export const INTEGRAL_FILTER_FUNCTIONS_WGSL=/* wgsl */`
${INTEGRAL_SIGNAL_WGSL}
${INTEGRAL_IMAGE_EDGE_WEIGHT_WGSL}
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
struct Options { spatial:vec4<f32>, temporal:vec4<f32>, edges:vec4<f32> }
@group(0) @binding(0) var raw:texture_2d<f32>;
@group(0) @binding(1) var guide:texture_2d<f32>;
@group(0) @binding(2) var previous:texture_2d<f32>;
@group(0) @binding(3) var moments:texture_2d<f32>;
@group(0) @binding(4) var output:texture_storage_2d<rgba32float,write>;
@group(0) @binding(5) var nextMoments:texture_storage_2d<rgba32float,write>;
@group(0) @binding(6) var<uniform> options:Options;
@group(0) @binding(7) var imageEdges:texture_2d<f32>;
@group(0) @binding(8) var imageEdgeSampler:sampler;
${INTEGRAL_FILTER_FUNCTIONS_WGSL}
fn imageGradient(p:vec2<i32>)->vec4<f32>{return textureSampleLevel(imageEdges,imageEdgeSampler,vec2<f32>(p)/(2.0*vec2<f32>(textureDimensions(imageEdges))),0.0);}
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
  // A contiguous tent footprint includes intervening pixels at every radius.
  // Fractional radii add outer weights continuously instead of rounding offsets.
  // Depth gating prevents a filter across opaque scene geometry boundaries.
  let extent=i32(ceil(options.spatial.y));
  for(var y=-extent;y<=extent;y++){for(var x=-extent;x<=extent;x++){
    if(x==0&&y==0){continue;}
    let footprint=(1.0-abs(f32(x))/(options.spatial.y+1.0))*(1.0-abs(f32(y))/(options.spatial.y+1.0));
    let q=clamp(p+vec2<i32>(x,y),vec2<i32>(0),vec2<i32>(size)-1);
    let v=textureLoad(raw,q,0);let d=textureLoad(guide,q,0).x;
    let sameDepth=abs(d-depth)<=.01*max(1.0,min(abs(depth),abs(d)));
    if(!sameDepth){continue;}
    lo=min(lo,v);hi=max(hi,v);
    let neighborSignal=integralSignal(v);signalSum+=neighborSignal*footprint;signalSquare+=neighborSignal*neighborSignal*footprint;neighbors+=footprint;
    var edgeWeight=1.0;
    if(options.edges.x>1.5){edgeWeight=integralImageEdgeWeight(imageGradient(p),imageGradient(q),vec2<f32>(q-p),options.spatial.z);}
    else if(options.edges.x>.5){edgeWeight=integralEdgeWeight(signal,neighborSignal,variance,options.spatial.z);}
    let w=edgeWeight*footprint;
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
  let stepChanges=0,sameStepDraws=0,evaluation=null;
  let imageEdges=null,rawEpoch=0,edgeEpoch=-1,edgeActive=false,edgeBuilt=false;
  const emptyEdges=device.createTexture({label:'inactive edge guide',size:[1,1],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING});
  const edgeSampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
  let filter=null,presentModule=null;const pipelines=new Map();
  const options=device.createBuffer({label:'integral reconstruction settings',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const camera=device.createBuffer({label:'integral reconstruction camera',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const endEvaluation=()=>{if(evaluation)for(const t of evaluation.textures)t.destroy();evaluation=null;};
  const reset=reason=>{endEvaluation();frames=0;lastStep=null;stepChanges=0;sameStepDraws=0;resetReason=reason;edgeEpoch=-1;edgeActive=false;};
  const describe=()=>({requested:config?.integralReconstruction??'off',effective:config?.integralReconstruction??'off',frames,resetReason,
    clock:'rendered-draws',simulationStep:lastStep,simulationStepChanges:stepChanges,sameStepDraws,
    evaluation:evaluation?{active:true,view:evaluation.view,previousDraws:frames-1,simulationStep:lastStep}:null,
    edgeGuide:{active:edgeActive,builtThisDraw:edgeBuilt,...imageEdges?.describe()},
    format:'linear-radiance-transmission-rgba32float',bytes:[...textures,...(evaluation?.textures??[])].reduce((a,t)=>a+t.width*t.height*(t.format==='r32float'?4:16),0)+(imageEdges?.describe().bytes??0),
    motion:'camera-reset-current-neighborhood-clamp',passes:config?.integralReconstruction==='off'?0:2+(edgeBuilt?1:0)});
  const make=(width,height,format)=>device.createTexture({label:'linear integral reconstruction',size:[width,height],format,
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT|(format==='r32float'?0:GPUTextureUsage.STORAGE_BINDING)});
  function encodeFilter(encoder,view,format,cameraValues,c,previousIndex,output,moments,age) {
    filter ||= device.createComputePipeline({label:'noise-aware linear integral reconstruction',layout:'auto',compute:{module:device.createShaderModule({code:INTEGRAL_FILTER_WGSL}),entryPoint:'reconstruct'}});
    presentModule ||= device.createShaderModule({label:'linear integral presentation',code:INTEGRAL_PRESENT_WGSL});
    if(!pipelines.has(format))pipelines.set(format,device.createRenderPipeline({label:'reconstructed volume presentation',layout:'auto',vertex:{module:presentModule,entryPoint:'vs'},fragment:{module:presentModule,entryPoint:'present',constants:{TRANSPARENT_CANVAS:transparent},targets:[{format}]},primitive:{topology:'triangle-list'}}));
    const spatial=['spatial','combined'].includes(c.integralReconstruction),temporal=['temporal','combined'].includes(c.integralReconstruction);
    edgeActive=spatial&&c.reconstructionSpatial>0&&c.reconstructionRadius>0&&c.reconstructionImageEdge>0&&c.reconstructionEdges==='image';edgeBuilt=false;
    if(edgeActive){imageEdges ||=createIntegralEdgeGuide(device);if(edgeEpoch!==rawEpoch){imageEdges.encode(encoder,textures[0],textures[1]);edgeEpoch=rawEpoch;edgeBuilt=true;}}
    const edgeMode=edgeActive?2:spatial&&c.reconstructionEdges==='samples'?1:0;
    device.queue.writeBuffer(options,0,new Float32Array([spatial?c.reconstructionSpatial:0,c.reconstructionRadius,c.reconstructionEdges==='image'?c.reconstructionImageEdge:c.reconstructionEdge,0,temporal?Math.min(c.retention,age/(age+1)):0,age>0?1:0,c.reconstructionResponse,0,edgeMode,0,0,0]));
    device.queue.writeBuffer(camera,0,cameraValues);
    const entries=[textures[0],textures[1],textures[2+previousIndex],textures[4+previousIndex],output,moments].map((t,binding)=>({binding,resource:t.createView()}));
    entries.push({binding:6,resource:{buffer:options}},{binding:7,resource:(imageEdges?.texture??emptyEdges).createView()},{binding:8,resource:edgeSampler});
    const compute=encoder.beginComputePass({label:'reconstruct linear light and transmission'});compute.setPipeline(filter);
    compute.setBindGroup(0,device.createBindGroup({layout:filter.getBindGroupLayout(0),entries}));compute.dispatchWorkgroups(Math.ceil(textures[0].width/8),Math.ceil(textures[0].height/8));compute.end();
    const pipeline=pipelines.get(format),pass=encoder.beginRenderPass({label:'present reconstructed integral',colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
    pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:output.createView()},{binding:1,resource:{buffer:camera}}]}));pass.draw(3);pass.end();
  }
  return {
    reset,endEvaluation,
    disable(reason='disabled'){reset(reason);imageEdges?.dispose();imageEdges=null;for(const t of textures)t.destroy();textures=[];key='';},
    describe,
    prepare(width,height,controls,sourceIdentity,step) {
      if(evaluation)throw Error('End integral evaluation before collecting another draw');
      config=integralReconstructionSettings(controls);
      if(config.integralReconstruction==='off'){reset('disabled');return null;}
      if(Math.max(width,height)>device.limits.maxTextureDimension2D)throw Error('Reconstruction dimensions exceed GPU texture capacity');
      if(config.reconstructionRadius>device.limits.maxTextureDimension2D)throw Error('Reconstruction radius exceeds GPU texture capacity');
      const nextKey=`${width}x${height}`;
      if(key!==nextKey) {
        for(const t of textures)t.destroy();
        textures=['rgba32float','r32float','rgba32float','rgba32float','rgba32float','rgba32float'].map(f=>make(width,height,f));key=nextKey;reset('resize');
      }
      if(sourceIdentity!==identity){identity=sourceIdentity;reset('camera-or-render-settings-change');}
      if(lastStep!==null&&(step<lastStep||step>lastStep+1))reset('simulation-discontinuity');
      if(lastStep!==null&&lastStep!==step){stepChanges++;sameStepDraws=0;}
      lastStep=step;
      return [{view:textures[0].createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}},
        {view:textures[1].createView(),loadOp:'clear',storeOp:'store',clearValue:{r:1e6,g:0,b:0,a:0}}];
    },
    encode(encoder,view,format,cameraValues) {
      if(evaluation)throw Error('End integral evaluation before collecting another draw');
      const next=1-index;rawEpoch++;
      encodeFilter(encoder,view,format,cameraValues,config,index,textures[2+next],textures[4+next],frames);
      index=next;frames++;sameStepDraws++;return describe();
    },
    beginEvaluation() {
      if(!frames)throw Error('Evaluation needs rendered history; enable Temporal or Combined and collect draws first');
      if(!evaluation)evaluation={view:config.integralReconstruction,textures:[make(textures[0].width,textures[0].height,'rgba32float'),make(textures[0].width,textures[0].height,'rgba32float')],rendered:false};
      return {...describe(),previousDraws:frames-1};
    },
    encodeEvaluation(encoder,view,format,cameraValues,controls) {
      if(!evaluation)throw Error('Integral evaluation is not held');
      const c=integralReconstructionSettings(controls);
      if(c.reconstructionRadius>device.limits.maxTextureDimension2D)throw Error('Reconstruction radius exceeds GPU texture capacity');
      encodeFilter(encoder,view,format,cameraValues,c,1-index,...evaluation.textures,frames-1);
      evaluation.view=c.integralReconstruction;evaluation.rendered=true;return describe();
    },
    get raw(){return textures[0];},get guide(){return textures[1];},get output(){return evaluation?.rendered?evaluation.textures[0]:textures[2+index];},get moments(){return evaluation?.rendered?evaluation.textures[1]:textures[4+index];},
    async sample() {
      if(!textures.length||!frames)return {available:false,state:describe()};
      const width=textures[0].width,height=textures[0].height,row=Math.ceil(width*16/256)*256;
      const sources=[textures[0],this.output,this.moments];
      const buffers=sources.map(()=>device.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
      try {
        const e=device.createCommandEncoder();sources.forEach((texture,i)=>e.copyTextureToBuffer({texture},{buffer:buffers[i],bytesPerRow:row},[width,height]));
        device.queue.submit([e.finish()]);await Promise.all(buffers.map(b=>b.mapAsync(GPUMapMode.READ)));
        const arrays=buffers.map(b=>{const raw=new Float32Array(b.getMappedRange()),out=new Float32Array(width*height*4);for(let y=0;y<height;y++)out.set(raw.subarray(y*row/4,y*row/4+width*4),y*width*4);return out;});
        return {available:true,width,height,state:describe(),raw:arrays[0],filtered:arrays[1],moments:arrays[2]};
      }finally{for(const b of buffers){b.unmap();b.destroy();}}
    },
    dispose(){endEvaluation();imageEdges?.dispose();emptyEdges.destroy();for(const t of textures)t.destroy();textures=[];options.destroy();camera.destroy();}
  };
}
