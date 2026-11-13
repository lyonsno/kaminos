import {isNeuralSourceMaterial} from './scene-neural-shading.mjs';
import {TSL,Color} from './lib/three.webgpu.js';
const {Fn,pass,mrt,context,vec4}=TSL;

// Counts source-stage pixels, not GPU time, MACs, sample-frequency invocations,
// or fallback in the multisampled receiving pass.
export function sourceFallbackSummary(counters,{width,height,scale,capture,frame}={}){
 const [neuralPixels,reconstructedPixels,fullRatePixels,unclassifiedPixels]=Array.from(counters);
 if(![width,height].every(v=>Number.isSafeInteger(v)&&v>0)||!Number.isFinite(scale)||scale<=0||scale>1)throw Error('Invalid neural diagnostic dimensions or scale');
 if(![neuralPixels,reconstructedPixels,fullRatePixels,unclassifiedPixels].every(v=>Number.isSafeInteger(v)&&v>=0)||neuralPixels>width*height||neuralPixels!==reconstructedPixels+fullRatePixels+unclassifiedPixels)throw Error('Invalid neural diagnostic counters');
 if(unclassifiedPixels)throw Error('Neural diagnostic has unclassified pixels');
 return {scope:'opaque-neural-source-pixels',receivingPassIncluded:false,width,height,frame,requestedScale:scale,nominalPixelFraction:scale*scale,captureResolution:scale<1&&neuralPixels>0?(capture??null):null,captureActive:scale<1&&neuralPixels>0,neuralPixels,reconstructedPixels,fullRatePixels,fullRateFraction:neuralPixels?fullRatePixels/neuralPixels:null,neuralCoverage:neuralPixels/(width*height),readbackBytes:16,additionalMaskPasses:1,neuralInferenceInMask:false};
}

// No timer, worker, pass or readback exists until sample() is explicitly called.
export class NeuralFallbackReadout{
 constructor(probe,{onChange=()=>{},now=()=>Date.now(),deferInvalidationUntilCapture=false}={}){this.deferInvalidationUntilCapture=deferInvalidationUntilCapture;this.probe=probe;this.onChange=onChange;this.now=now;this.generation=0;this.pending=null;this.value={status:'off',result:null,error:null};}
 read(){return {...this.value,busy:this.pending!==null};}
 publish(value){this.value=value;this.onChange(this.read());return this.read();}
 sample(){
  if(this.pending)return this.pending;
  const generation=++this.generation,abort=new AbortController();this.abort=abort;this.awaitingCapture=this.deferInvalidationUntilCapture;
  let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});this.pending=pending;
  this.publish({status:'sampling',result:null,error:null});
  (async()=>{
   try{const result=await this.probe({signal:abort.signal,captured:()=>{if(generation===this.generation)this.awaitingCapture=false;}});if(generation===this.generation){if(this.awaitingCapture)throw Error('Neural diagnostic capture boundary was not recorded');this.publish({status:'snapshot',result:{...result,sampledAt:this.now()},error:null});}}
   catch(error){if(generation===this.generation){this.publish({status:'failed',result:null,error:error.message});throw error;}}
   finally{this.pending=null;this.onChange(this.read());}
   return this.read();
  })().then(resolve,reject);
  return pending;
 }
 invalidate(reason='scene changed'){
  if(['off','stale'].includes(this.value.status)||this.value.status==='sampling'&&this.awaitingCapture)return;
  this.generation++;this.abort?.abort();this.publish({status:'stale',result:null,error:null,reason});
 }
 stop(){this.generation++;this.abort?.abort();return this.publish({status:'off',result:null,error:null});}
}

export const NEURAL_FALLBACK_COUNT_WGSL=`
@group(0) @binding(0) var mask: texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> totals: array<atomic<u32>,4>;
@group(0) @binding(2) var source: texture_2d<f32>;
var<workgroup> tile: array<atomic<u32>,4>;
@compute @workgroup_size(16,16)
fn main(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) local:u32){
 if(local<4u){atomicStore(&tile[local],0u);}
 workgroupBarrier();
 let size=textureDimensions(mask);
 if(all(id.xy<size)){
  let value=textureLoad(mask,vec2<i32>(id.xy),0);
  let expected=textureLoad(source,vec2<i32>(id.xy),0).a<0.0;
  if(expected){
   atomicAdd(&tile[0],1u);
   if(value.a<=0.5){atomicAdd(&tile[3],1u);}
   else if(value.g>0.9 && value.r<0.1){atomicAdd(&tile[1],1u);}
   else if(value.r>0.9 && value.g<0.1){atomicAdd(&tile[2],1u);}
   else{atomicAdd(&tile[3],1u);}
  }else if(value.a>0.5){atomicAdd(&tile[3],1u);}
 }
 workgroupBarrier();
 if(local<4u){atomicAdd(&totals[local],atomicLoad(&tile[local]));}
}`;

// One on-demand mask draw runs the production reconstruction branch with
// radiance replaced by its exact acceptance bit. Its model path is bypassed.
// GPU reduction returns four integers instead of a full-size CPU image.
export class SourceNeuralFallbackProbe{
 constructor(cache){this.cache=cache;this.mask=null;this.gpu=null;}
 ensureMask(){
  if(this.mask)return this.mask;
  const cache=this.cache,p=pass(cache.capture.scene,cache.camera,{samples:0});
  p.name='Neural source fallback snapshot';p.transparent=false;
  p.contextNode=context({sceneReflectionLighting:null,sceneNeuralShading:cache,neuralShadingMode:'diagnostic-source'});
  p.setMRT(mrt({output:Fn(([],builder)=>isNeuralSourceMaterial(builder.material)?vec4((builder.material.lightsNode??builder.lightsNode).totalDiffuseNode,1):vec4(0))()}));
  this.mask=p;return p;
 }
 ensureGpu(renderer){
  const device=renderer.backend?.device;
  if(!renderer.backend?.isWebGPUBackend||!device)throw Error('Neural fallback measurement requires WebGPU');
  if(this.gpu?.device===device)return this.gpu;
  this.disposeGpu();
  const module=device.createShaderModule({label:'neural source fallback reduction',code:NEURAL_FALLBACK_COUNT_WGSL});
  const pipeline=device.createComputePipeline({label:'neural source fallback reduction',layout:'auto',compute:{module,entryPoint:'main'}});
  const counts=device.createBuffer({label:'neural fallback counts',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  const readback=device.createBuffer({label:'neural fallback small readback',size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  return this.gpu={device,pipeline,counts,readback};
 }
 async sample(renderer,{frame,borrowVisibility=()=>()=>{}}={}){
  const cache=this.cache;
  if(renderer.logarithmicDepthBuffer===true)throw Error('Neural fallback measurement does not support logarithmic depth');
  if(cache.uncacheableMaterials>0)throw Error('Neural material keys are exhausted; source coverage cannot be classified');
  if(cache.capture.renderTarget.width<1||cache.capture.renderTarget.height<1)throw Error('No neural capture is available');
  const p=this.ensureMask(),gpu=this.ensureGpu(renderer),scene=p.scene,scale=cache.scale.value,capture=cache.state().resolution;
  const restoreVisibility=borrowVisibility();let restoreMaterials;
  const saved={target:renderer.getRenderTarget(),mrt:renderer.getMRT(),context:renderer.contextNode,autoClear:renderer.autoClear,transparent:renderer.transparent,opaque:renderer.opaque,background:scene.background,clear:renderer.getClearColor(new Color()).clone(),alpha:renderer.getClearAlpha(),override:scene.overrideMaterial,sceneName:scene.name,mask:cache.camera.layers.mask};
  try{
   restoreMaterials=cache.borrowMaterials(renderer);
   scene.background=null;renderer.setClearColor(0,0);p.updateBefore({renderer});
  }finally{
   renderer.setRenderTarget(saved.target);renderer.setMRT(saved.mrt);renderer.contextNode=saved.context;renderer.autoClear=saved.autoClear;renderer.transparent=saved.transparent;renderer.opaque=saved.opaque;renderer.setClearColor(saved.clear,saved.alpha);scene.background=saved.background;scene.overrideMaterial=saved.override;scene.name=saved.sceneName;cache.camera.layers.mask=saved.mask;
   try{restoreMaterials?.();}finally{restoreVisibility();}
  }
  const texture=renderer.backend.get(p.getTexture('output'))?.texture,source=renderer.backend.get(cache.source.getTexture('transport'))?.texture;
  if(!texture||!source)throw Error('Neural diagnostic mask or completed source was not produced');
  if(source.width!==texture.width||source.height!==texture.height)throw Error('Neural diagnostic and source dimensions differ');
  const {device,pipeline,counts,readback}=gpu;
  device.queue.writeBuffer(counts,0,new Uint32Array(4));
  const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:counts}},{binding:2,resource:source.createView()}]});
  const encoder=device.createCommandEncoder({label:'neural source fallback count'}),pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(p.renderTarget.width/16),Math.ceil(p.renderTarget.height/16));pass.end();encoder.copyBufferToBuffer(counts,0,readback,0,16);device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  let counters;try{counters=new Uint32Array(readback.getMappedRange().slice(0));}finally{readback.unmap();}
  try{return sourceFallbackSummary(counters,{width:p.renderTarget.width,height:p.renderTarget.height,scale,capture,frame});}catch(error){throw Error(error.message+': '+Array.from(counters).join(','));}
 }
 disposeGpu(){this.gpu?.counts.destroy();this.gpu?.readback.destroy();this.gpu=null;}
 dispose(){this.mask?.dispose();this.mask=null;this.disposeGpu();}
}

export function mountNeuralFallbackReadout(root,readout){
 const doc=root.ownerDocument,measure=doc.createElement('button'),stop=doc.createElement('button'),output=doc.createElement('p');
 measure.type=stop.type='button';measure.className=stop.className='btn';measure.style.flex='1';stop.style.width='auto';measure.textContent='Measure source shading';stop.textContent='Clear';output.setAttribute('aria-live','polite');
 const buttons=doc.createElement('div');buttons.style.display='flex';buttons.style.gap='6px';buttons.append(measure,stop);
 output.className='hint';root.append(buttons,output);
 const previous=readout.onChange;
 const sync=state=>{
  measure.disabled=state.busy;stop.hidden=state.status==='off'&&!state.busy;stop.textContent=state.busy?'Stop':'Clear';
  if(state.status==='snapshot'){
   const r=state.result,percent=r.fullRateFraction===null?'No neural pixels':`${(100*r.fullRateFraction).toFixed(1)}% full rate`;
   const label=r.requestedScale===1?'Native full-resolution shading':percent;
   output.textContent=`Snapshot ${new Date(r.sampledAt).toLocaleTimeString()}: ${label} · ${r.fullRatePixels.toLocaleString()} / ${r.neuralPixels.toLocaleString()} NeuMIP + NVIDIA source pixels. Excludes receiving pass and GPU timing. No background updates.`;
  }else output.textContent=({off:'Off · no background sampling.',sampling:'Measuring one frame…',stale:'Scene changed · measure again.',failed:`Measurement failed: ${state.error}`})[state.status];
 };
 readout.onChange=state=>{previous(state);sync(state);};sync(readout.read());
 measure.onclick=()=>{readout.sample().catch(()=>{});};stop.onclick=()=>readout.stop();
 return {sync:()=>sync(readout.read()),dispose(){readout.stop();readout.onChange=previous;root.replaceChildren();}};
}
