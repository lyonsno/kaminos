// Count logical scene-ray query invocations, including misses. Environment
// samples, march iterations and triangle tests are distinct work units.
export function instrumentOpticalRayQueries(code) {
  const replace=(from,to)=>{if(code.split(from).length!==2)throw Error(`Ray instrumentation anchor is missing or ambiguous: ${from}`);code=code.replace(from,to);};
  replace('struct CompositeOutput {','var<private> countedRayPhase: u32;\nvar<private> countedReflectionRays: u32;\nvar<private> countedTransmissionRays: u32;\nfn countSceneRayQuery() {\n  if (countedRayPhase == 1u) { countedReflectionRays += 1u; } else { countedTransmissionRays += 1u; }\n}\nstruct CompositeOutput {\n  @location(1) rayCounts: vec4<u32>,');
  replace('  output.color = color;','  output.rayCounts = vec4<u32>(countedReflectionRays, countedReflectionRays + countedTransmissionRays, 0u, 1u);\n  output.color = color;');
  replace('fn sampleHybridOpticalQuery(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> OpticalQuerySample {','fn sampleHybridOpticalQuery(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> OpticalQuerySample {\n  countSceneRayQuery();');
  replace('fn sampleHostWaterSegment(rayOrigin: vec3<f32>, rayDirection: vec3<f32>, waterPath: f32) -> OpticalQuerySample {','fn sampleHostWaterSegment(rayOrigin: vec3<f32>, rayDirection: vec3<f32>, waterPath: f32) -> OpticalQuerySample {\n  countSceneRayQuery();');
  replace('  return reflectionSampleFromOpticalQuery(sampleWorldOpticalQuery(rayOrigin, rayDirection));','  countSceneRayQuery();\n  return reflectionSampleFromOpticalQuery(sampleWorldOpticalQuery(rayOrigin, rayDirection));');
  replace('  let centerDirection = normalize(reflect(cameraRay, worldNormal));','  countedRayPhase = 1u;\n  let centerDirection = normalize(reflect(cameraRay, worldNormal));');
  return code;
}

// Current shader has at most nine reflection and six transmission queries.
// Larger results fail visibly rather than silently clipping the histogram.
const BINS=16, WORDS=33;
export function summarizeOpticalRayHistogram(words) {
  if(words.length!==WORDS)throw Error('Ray histogram is partial');
  if(words[32]!==0)throw Error('Ray histogram exceeds current shader query domain');
  const reflection=Array.from(words.slice(0,BINS)),total=Array.from(words.slice(BINS,BINS*2));
  const sum=a=>a.reduce((n,v)=>n+v,0),waterPixels=sum(reflection);
  if(sum(total)!==waterPixels)throw Error('Reflection and total ray populations disagree');
  const describe=bins=>{
    if(!waterPixels)return {p50:null,p95:null,p99:null,mean:null,sum:0};
    const percentile=q=>{const rank=Math.ceil(waterPixels*q);let n=0;for(let i=0;i<bins.length;i++){n+=bins[i];if(n>=rank)return i;}};
    const count=bins.reduce((n,v,i)=>n+v*i,0);
    return {p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),mean:count/waterPixels,sum:count};
  };
  return {waterPixels,reflection:describe(reflection),total:describe(total),skippedReflectionFraction:waterPixels?reflection[0]/waterPixels:null,histogram:{reflection,total}};
}

const HISTOGRAM_SHADER=`
@group(0) @binding(0) var counts: texture_2d<u32>;
@group(0) @binding(1) var<storage,read_write> histogram: array<atomic<u32>,33>;
var<workgroup> localHistogram: array<atomic<u32>,33>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32,@builtin(global_invocation_id) invocation:vec3<u32>) {
  if(lane<33u){atomicStore(&localHistogram[lane],0u);}
  workgroupBarrier();
  let dims=textureDimensions(counts);
  let index=invocation.x;
  if(index<dims.x*dims.y){
    let sample=textureLoad(counts,vec2<i32>(i32(index%dims.x),i32(index/dims.x)),0);
    if(sample.w==1u){
      if(sample.x<16u && sample.y<16u){atomicAdd(&localHistogram[sample.x],1u);atomicAdd(&localHistogram[16u+sample.y],1u);}
      else {atomicAdd(&localHistogram[32],1u);}
    }
  }
  workgroupBarrier();
  if(lane<33u){atomicAdd(&histogram[lane],atomicLoad(&localHistogram[lane]));}
}`;

export function createOpticalRayCounter({device,shaderCode,pipelineDescriptor}) {
  let state={status:'not_requested',sample:null},compiling=null,renderPipeline=null,computePipeline=null;
  let requested=false,reading=false,disposed=false,texture=null,extent=null;
  const histogram=device.createBuffer({label:'fluid-ray-histogram',size:WORDS*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  const readback=device.createBuffer({label:'fluid-ray-histogram-readback',size:WORDS*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const read=()=>structuredClone(state);
  async function request() {
    if(disposed || reading || requested)return read();
    if(!renderPipeline){
      state={status:'preparing',sample:state.sample};
      compiling??=(async()=>{
        const module=device.createShaderModule({label:'fluid-optical-ray-counter',code:instrumentOpticalRayQueries(shaderCode)});
        renderPipeline=await device.createRenderPipelineAsync({...pipelineDescriptor,label:'fluid-optical-ray-counted-composite',
          vertex:{...pipelineDescriptor.vertex,module},fragment:{...pipelineDescriptor.fragment,module,targets:[...pipelineDescriptor.fragment.targets,{format:'rgba8uint'}]}});
        computePipeline=await device.createComputePipelineAsync({label:'fluid-optical-ray-histogram',layout:'auto',compute:{module:device.createShaderModule({code:HISTOGRAM_SHADER}),entryPoint:'main'}});
      })();
      try{await compiling;}catch(error){state={status:'failed',failure:String(error),sample:state.sample};throw error;}
    }
    if(!disposed){requested=true;state={status:'waiting_for_frame',sample:state.sample};}
    return read();
  }
  function begin({width,height,rendererMode,opticalDebugMode}) {
    if(!requested||reading||!renderPipeline||disposed)return null;
    if(rendererMode!=='screen_space_refraction'||opticalDebugMode!=='shaded'){state={status:'unsupported_view',sample:state.sample};return null;}
    const key=`${width}x${height}`;
    if(extent!==key){texture?.destroy();texture=device.createTexture({label:'fluid-actual-ray-counts',size:[width,height],format:'rgba8uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});extent=key;}
    requested=false;reading=true;state={status:'reading',sample:state.sample};
    return {pipeline:renderPipeline,attachment:{view:texture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}};
  }
  function finish(encoder,source) {
    encoder.clearBuffer(histogram);
    const group=device.createBindGroup({layout:computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:histogram}}]});
    const pass=encoder.beginComputePass({label:'fluid-ray-count-reduction'});pass.setPipeline(computePipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(source.width*source.height/256));pass.end();
    encoder.copyBufferToBuffer(histogram,0,readback,0,WORDS*4);
    // Mapping is scheduled after the host submits its supplied encoder.
    queueMicrotask(async()=>{
      try{
        await readback.mapAsync(GPUMapMode.READ);
        const words=new Uint32Array(readback.getMappedRange().slice(0));
        const summary=summarizeOpticalRayHistogram(words);
        if(!disposed)state={status:'measured',sample:{...source,...summary,measuredAt:performance.now(),population:'visible_shaded_water_pixels',unit:'scene_ray_query_invocations_including_misses'}};
      }catch(error){if(!disposed)state={status:'failed',failure:String(error),sample:state.sample};}
      finally{if(readback.mapState==='mapped')readback.unmap();reading=false;}
    });
  }
  function abort(error){reading=false;requested=false;state={status:'failed',failure:String(error),sample:state.sample};}
  return {request,read,begin,finish,abort,destroy(){disposed=true;requested=false;texture?.destroy();histogram.destroy();readback.destroy();}};
}
