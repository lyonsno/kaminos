// Diagnostic replay only; does not participate in the ordinary render graph.
export function validateProbeSource(state) {
  if(state.backend!=='WebGPUBackend')throw Error('Probe requires the actual WebGPU backend');
  if(state.mode!=='combined')throw Error('Probe requires combined GI');
  if(state.feedback)throw Error('Freeze a first bounce with feedback disabled');
  if(!state.valid)throw Error('Probe requires valid history');
  if(!(state.firstBounceSamples>0))throw Error('Probe requires stationary first-bounce samples');
  if(state.sourceComparison)throw Error('Probe currently requires the detailed source');
  if(!(state.width>1&&state.height>1)||state.historyWidth!==state.width||state.historyHeight!==state.height)
    throw Error('Source/history extent must match');
  if(!Number.isSafeInteger(state.samples)||state.samples<1)throw Error('Invalid replay sample count');
  return state;
}

// Replays the shipped shader. Frozen textures have no source-pass scheduling
// edges: the second stage cannot accidentally recapture or feed itself back.
export async function runFrozenBounceProbe(inputs,{samples=128}={}) {
  const {renderer,source,camera,history,settings,estimator}=inputs;
  const {RenderTarget,FloatType,NearestFilter,NodeMaterial,QuadMesh,RendererUtils,TSL}=await import('./lib/three.webgpu.js');
  const {texture,vec4,mix,uniform}=TSL;
  const {ssgi}=await import('./lib/addons/tsl/display/SSGINode.js');
  const width=source.renderTarget.width,height=source.renderTarget.height;
  const identity=validateProbeSource({backend:renderer.backend.constructor.name,mode:settings.mode,
    feedback:history.feedback.value,valid:history.valid.value,sourceComparison:inputs.sourceComparison,
    width,height,historyWidth:history.size[0],historyHeight:history.size[1],
    firstBounceSamples:history.stableFrames,samples});
  const frozenCamera=camera.clone();
  const initial={...identity,settings:{...settings},estimator:{...estimator},
    projection:camera.projectionMatrix.toArray(),world:camera.matrixWorld.toArray(),
    firstBounceHistoryFrames:history.frames,firstBounceConverged:history.converged,
    sampling:'same production low-discrepancy sequence, indices 1..samples for every replay',
    source:'opaque detailed corner; direct and first-bounce history captured before replay',
    claim:'finite frozen-input diagnostic, not converged or physically calibrated transport'};
  const resources=[];
  const target=()=>{const t=new RenderTarget(width,height,{type:FloatType,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});resources.push(t);return t;};
  const draw=(rt,node)=>{
    const material=new NodeMaterial();material.fragmentNode=node;
    const quad=new QuadMesh(material),state=RendererUtils.resetRendererState(renderer);
    try{renderer.setRenderTarget(rt);quad.render(renderer);}finally{RendererUtils.restoreRendererState(renderer,state);material.dispose();}
  };
  const capture=node=>{const t=target();draw(t,node);return t;};
  const raw=async t=>{
    const data=await renderer.readRenderTargetPixelsAsync(t,0,0,width,height);
    if(!(data instanceof Float32Array))throw Error('Expected rgba32float readback');
    const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),parts=[];
    for(let i=0;i<bytes.length;i+=16384)parts.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
    return {width,height,format:'rgba32float',rowStrideBytes:Math.ceil(width*16/256)*256,byteLength:bytes.length,base64:btoa(parts.join(''))};
  };
  try {
    // Snapshot synchronously in this turn, before any await can advance history.
    const direct=capture(texture(source.getTextureNode('output').value));
    const first=capture(texture(history.oldGI.value));
    const response=capture(texture(source.getTextureNode('probeDiffuseResponse').value));
    const depth=capture(vec4(texture(source.getTextureNode('depth').value).r,0,0,1));
    const normal=capture(texture(source.getTextureNode('normal').value));
    const reflected=capture(vec4(texture(first.texture).rgb.max(0).mul(texture(response.texture).rgb),1));
    const beauty=texture(direct.texture),effect=ssgi(beauty,texture(depth.texture),texture(normal.texture),frozenCamera);
    resources.push(effect);
    for(const [key,value] of Object.entries({sliceCount:settings.slices,stepCount:settings.steps,radius:settings.radius,
      thickness:settings.thickness,giIntensity:1,expFactor:estimator.expFactor,useScreenSpaceSampling:estimator.screenSpaceSampling,
      useLinearThickness:estimator.linearThickness,backfaceLighting:estimator.backfaceLighting}))effect[key].value=value;
    effect.useTemporalFiltering=true;
    // This replay is explicit: FRAME scheduling would reuse one GI evaluation
    // for every synchronous draw in the loop.
    effect.updateBeforeType=TSL.NodeUpdateType.NONE;
    effect.resolutionScale=1;
    // Keep the actual frozen extent even if the live viewport subsequently changes.
    const setSize=effect.setSize.bind(effect);effect.setSize=()=>setSize(width,height);
    const mean=[target(),target()],old=texture(mean[0].texture),weight=uniform(1);
    const material=new NodeMaterial();resources.push(material);
    material.fragmentNode=vec4(mix(old.rgb,effect.getGINode().rgb,weight),1);
    const quad=new QuadMesh(material);
    // Build the production node graph before explicit updateBefore calls.
    {
      const state=RendererUtils.resetRendererState(renderer);
      try{renderer.setRenderTarget(mean[0]);quad.render(renderer);}finally{RendererUtils.restoreRendererState(renderer,state);}
    }
    const replay=async input=>{
      beauty.value=input.texture;effect._sampleIndex=0;
      let written;
      for(let i=0;i<samples;i++){
        effect.updateBefore({renderer});
        old.value=mean[i%2].texture;written=mean[1-i%2];weight.value=1/(i+1);
        const state=RendererUtils.resetRendererState(renderer);
        try{renderer.setRenderTarget(written);quad.render(renderer);}finally{RendererUtils.restoreRendererState(renderer,state);}
      }
      if(effect._sampleIndex!==samples)throw Error(`Replay scheduled ${effect._sampleIndex} GI evaluations, expected ${samples}`);
      return raw(written);
    };
    const snapshots={};
    for(const [key,t] of Object.entries({direct,first,response,depth,normal,reflected}))snapshots[key]=await raw(t);
    const firstReplay=await replay(direct);
    const secondOnly=await replay(reflected);
    const combinedSource=capture(vec4(texture(direct.texture).rgb.add(texture(reflected.texture).rgb),1));
    const combined=await replay(combinedSource);
    return {identity:initial,snapshots,firstReplay,secondOnly,combined};
  }finally{for(const item of resources)item.dispose();}
}
