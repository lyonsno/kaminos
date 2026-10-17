const HISTOGRAM = 12, GLYPHS = HISTOGRAM + 3 * 256;
export const RAY_STEP_MISS = 0xffffffff;
export const RAY_STEP_SUMMARY_BYTES = (GLYPHS + 28 * 6) * 4;

export const RAY_STEP_TELEMETRY_WGSL = /* wgsl */`
override BYTE_SHIFT: u32 = 24u;
@group(0) @binding(0) var<storage, read> samples: array<u32>;
@group(0) @binding(1) var<storage, read_write> summary: array<atomic<u32>>;
var<workgroup> bins: array<atomic<u32>, 768>;
var<workgroup> counts: array<u32, 256>;
var<workgroup> low: array<u32, 256>;
var<workgroup> high: array<u32, 256>;

@compute @workgroup_size(256)
fn histogram(@builtin(local_invocation_index) lane: u32,
 @builtin(workgroup_id) group: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
  for(var q=0u;q<3u;q++){atomicStore(&bins[q*256u+lane],0u);}
  counts[lane]=0u;low[lane]=0u;high[lane]=0u;
  workgroupBarrier();
  let index=(group.x+group.y*groups.x)*256u+lane;
  if(index<arrayLength(&samples)){
    let value=samples[index];
    if(value!=0xffffffffu){
      counts[lane]=1u;low[lane]=value;
      for(var q=0u;q<3u;q++){
        let prefix=atomicLoad(&summary[3u+q]);
        var matches=true;
        if(BYTE_SHIFT<24u){let shift=min(31u,BYTE_SHIFT+8u);matches=(value>>shift)==(prefix>>shift);}
        if(matches){atomicAdd(&bins[q*256u+((value>>BYTE_SHIFT)&255u)],1u);}
      }
    }
  }
  workgroupBarrier();
  for(var q=0u;q<3u;q++){
    let n=atomicLoad(&bins[q*256u+lane]);
    if(n>0u){atomicAdd(&summary[${HISTOGRAM}u+q*256u+lane],n);}
  }
  if(BYTE_SHIFT==24u){
    for(var stride=128u;stride>0u;stride/=2u){
      if(lane<stride){
        counts[lane]+=counts[lane+stride];
        let previous=low[lane];low[lane]+=low[lane+stride];
        high[lane]+=high[lane+stride]+select(0u,1u,low[lane]<previous);
      }
      workgroupBarrier();
    }
    if(lane==0u){
      atomicAdd(&summary[0],counts[0]);
      let previous=atomicAdd(&summary[1],low[0]);
      atomicAdd(&summary[2],high[0]+select(0u,1u,previous+low[0]<previous));
    }
  }
}

fn text(row:u32,offset:u32,letters:ptr<function,array<u32,20>>,length:u32){
  for(var i=0u;i<length;i++){atomicStore(&summary[${GLYPHS}u+row*28u+offset+i],(*letters)[i]);}
}
fn number(row:u32,column:u32,lo:u32,hi:u32){
  // Four base-65536 limbs keep decimal conversion exact without GPU u64 support.
  var limbs=vec4<u32>(hi>>16u,hi&65535u,lo>>16u,lo&65535u);
  var digits:array<u32,20>;var length=0u;
  loop{
    var remainder=0u;
    for(var i=0u;i<4u;i++){
      let value=remainder*65536u+limbs[i];limbs[i]=value/10u;remainder=value%10u;
    }
    digits[length]=48u+remainder;length++;
    if(all(limbs==vec4<u32>(0u))){break;}
  }
  for(var i=0u;i<length;i++){atomicStore(&summary[${GLYPHS}u+row*28u+column+i],digits[length-1u-i]);}
}
@compute @workgroup_size(1)
fn selectQuantiles(){
  let population=atomicLoad(&summary[0]);
  for(var q=0u;q<3u;q++){
    var rank=atomicLoad(&summary[6u+q]);
    if(BYTE_SHIFT==24u){
      let percent=array<u32,3>(50u,95u,99u)[q];
      rank=(population/100u)*percent+((population%100u)*percent+99u)/100u;
    }
    if(population>0u){
      var before=0u;
      for(var bin=0u;bin<256u;bin++){
        let n=atomicLoad(&summary[${HISTOGRAM}u+q*256u+bin]);
        if(before+n>=rank){
          atomicStore(&summary[3u+q],atomicLoad(&summary[3u+q])|(bin<<BYTE_SHIFT));
          atomicStore(&summary[6u+q],rank-before);break;
        }
        before+=n;
      }
    }
  }
  if(BYTE_SHIFT==0u){
    for(var i=0u;i<168u;i++){atomicStore(&summary[${GLYPHS}u+i],32u);}
    var header=array<u32,20>(82u,65u,89u,32u,83u,65u,77u,80u,76u,69u,83u,32u,47u,32u,71u,80u,85u,32u,32u,32u);
    text(0u,0u,&header,17u);
    for(var q=0u;q<3u;q++){
      atomicStore(&summary[${GLYPHS}u+(q+1u)*28u],112u);
      atomicStore(&summary[${GLYPHS}u+(q+1u)*28u+1u],select(53u,57u,q>0u));
      atomicStore(&summary[${GLYPHS}u+(q+1u)*28u+2u],select(select(48u,53u,q==1u),57u,q==2u));
      atomicStore(&summary[${GLYPHS}u+(q+1u)*28u+3u],58u);
      if(population>0u){number(q+1u,5u,atomicLoad(&summary[3u+q]),0u);}
      else{atomicStore(&summary[${GLYPHS}u+(q+1u)*28u+5u],45u);}
    }
    var total=array<u32,20>(84u,79u,84u,65u,76u,58u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u);
    text(4u,0u,&total,6u);number(4u,7u,atomicLoad(&summary[1]),atomicLoad(&summary[2]));
    var rays=array<u32,20>(82u,65u,89u,83u,58u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u,32u);
    text(5u,0u,&rays,5u);number(5u,7u,population,0u);
  }
}
`;

const DISPLAY_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage,read> summary:array<u32>;
@group(0) @binding(1) var glyphs:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index:u32)->@builtin(position) vec4<f32>{
  let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[index],0,1);
}
@fragment fn fs(@builtin(position) position:vec4<f32>)->@location(0) vec4<f32>{
  let cell=vec2<u32>(position.xy)/vec2<u32>(8u,16u);
  let code=summary[${GLYPHS}u+cell.y*28u+cell.x]-32u;
  let local=vec2<u32>(position.xy)%vec2<u32>(8u,16u);
  let uv=vec2<i32>(vec2<u32>((code%16u)*8u,(code/16u)*16u)+local);
  let alpha=textureLoad(glyphs,uv,0).a;
  return vec4<f32>(mix(vec3<f32>(.105),vec3<f32>(.86,.9,.91),alpha),1);
}
`;

export function createRayStepTelemetry(device,{document=globalThis.document}={}){
  let counterBuffer=device.createBuffer({label:'disabled ray sample counters',size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  let summaryBuffer=null,canvas=null,context=null,atlas=null,histogramPipelines,pickPipelines,computeGroup,displayGroup,displayPipeline;
  let pixels=1,active=false,status={requested:false,active:false,reason:'off',readback:false};
  const limit=Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize);
  function initialize(){
    if(summaryBuffer)return;
    summaryBuffer=device.createBuffer({label:'GPU-only ray statistics',size:RAY_STEP_SUMMARY_BYTES,
      usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
    const module=device.createShaderModule({label:'exact ray sample radix quantiles',code:RAY_STEP_TELEMETRY_WGSL});
    const layout=device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
      {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
    ]});
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
    histogramPipelines=[24,16,8,0].map(shift=>device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'histogram',constants:{BYTE_SHIFT:shift}}}));
    pickPipelines=[24,16,8,0].map(shift=>device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'selectQuantiles',constants:{BYTE_SHIFT:shift}}}));
    const bitmap=document.createElement('canvas');bitmap.width=128;bitmap.height=96;
    const ctx=bitmap.getContext('2d');ctx.font='12px monospace';ctx.fillStyle='white';
    for(let i=0;i<96;i++)ctx.fillText(String.fromCharCode(32+i),(i%16)*8,Math.floor(i/16)*16+13);
    atlas=device.createTexture({label:'ray statistics font',size:[128,96],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    device.queue.copyExternalImageToTexture({source:bitmap},{texture:atlas},[128,96]);
    const displayModule=device.createShaderModule({label:'GPU-only ray statistics display',code:DISPLAY_WGSL});
    displayPipeline=device.createRenderPipeline({layout:'auto',vertex:{module:displayModule,entryPoint:'vs'},
      fragment:{module:displayModule,entryPoint:'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'triangle-list'}});
    displayGroup=device.createBindGroup({layout:displayPipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:summaryBuffer}},{binding:1,resource:atlas.createView()},
    ]});
  }
  function setCanvas(next){
    if(canvas===next)return;
    context?.unconfigure();canvas=next;context=null;
    if(canvas){canvas.width=224;canvas.height=96;context=canvas.getContext('webgpu');
      context?.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});}
  }
  function ensure(width,height,requested,{supported=true,reason='unsupported-renderer',allowResize=true,activate=true}={}){
    active=false;let refusal=!requested?'off':!supported?reason:!context?'display-unavailable':
      !canvas.getClientRects().length?'inspector-hidden':null;
    const count=width*height;
    if(!refusal&&(!Number.isSafeInteger(count)||count<=0||count>=0xffffffff||count*4>limit))refusal='counter-buffer-exceeds-device-limits';
    if(!refusal&&!allowResize&&count!==pixels)refusal='counter-buffer-not-prepared';
    let changed=false;
    if(!refusal){
      initialize();
      if(count!==pixels){counterBuffer.destroy();counterBuffer=device.createBuffer({label:'per-pixel ray material evaluations',size:count*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});pixels=count;changed=true;computeGroup=null;}
      active=activate;
    }else if(!requested&&pixels!==1&&allowResize){counterBuffer.destroy();counterBuffer=device.createBuffer({label:'disabled ray sample counters',size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});pixels=1;changed=true;computeGroup=null;}
    if(canvas)canvas.style.visibility=active?'visible':'hidden';
    status={requested,active,reason:refusal||(!activate?'awaiting-instrumented-draw':null),readback:false,scope:'material-evaluations-per-intersecting-ray',width,height};
    return changed;
  }
  function encode(encoder){
    if(!active)return false;
    computeGroup ||= device.createBindGroup({layout:histogramPipelines[0].getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:counterBuffer}},{binding:1,resource:{buffer:summaryBuffer}},
    ]});
    encoder.clearBuffer(summaryBuffer);
    const groups=Math.ceil(pixels/256),x=Math.min(groups,device.limits.maxComputeWorkgroupsPerDimension),y=Math.ceil(groups/x);
    for(let i=0;i<4;i++){
      if(i)encoder.clearBuffer(summaryBuffer,HISTOGRAM*4,768*4);
      const histogram=encoder.beginComputePass({label:'ray sample quantile digit'});
      histogram.setPipeline(histogramPipelines[i]);histogram.setBindGroup(0,computeGroup);histogram.dispatchWorkgroups(x,y);histogram.end();
      const pick=encoder.beginComputePass({label:'ray sample quantile selection'});
      pick.setPipeline(pickPipelines[i]);pick.setBindGroup(0,computeGroup);pick.dispatchWorkgroups(1);pick.end();
    }
    const draw=encoder.beginRenderPass({label:'GPU-only ray statistics',colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.105,g:.105,b:.105,a:1}}]});
    draw.setPipeline(displayPipeline);draw.setBindGroup(0,displayGroup);draw.draw(3);draw.end();return true;
  }
  return {get counterBuffer(){return counterBuffer;},get summaryBuffer(){return summaryBuffer;},get active(){return active;},
    read:()=>({...status}),setCanvas,ensure,encode,
    dispose(){counterBuffer.destroy();summaryBuffer?.destroy();atlas?.destroy();context?.unconfigure();},
  };
}
