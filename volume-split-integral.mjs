import {HISTORY_ALLOCATION_WGSL} from './volume-history-allocation.mjs';
// Two local optical observations, never two copies of a whole-chord integral.
export function splitIntegralSettings(c={}) {
  const v={mode:'off',fresh:1,memory:6,opacityMemory:6,response:.5,exploration:.25,motion:1,footprint:2,depthSupport:2,...c};
  if(!['off','split','transport'].includes(v.mode))throw Error('Unknown split optical mode');
  if(![1,2].includes(v.fresh))throw Error('Fresh optical evaluations must be 1 or 2');
  for(const k of ['memory','opacityMemory','response','exploration','motion','footprint','depthSupport'])if(!Number.isFinite(v[k])||!Number.isFinite(Math.fround(v[k]))||v[k]<0)throw Error(`Invalid split optical ${k}`);
  if(v.memory<1||v.opacityMemory<1||v.response>1||v.exploration>1)throw Error('Invalid optical memory or fraction');
  return v;
}
export const SPLIT_OPTICAL_MATH_WGSL=/* wgsl */`
struct SplitObservation { optical:vec4<f32>, anchor:vec4<f32>, support:vec4<f32> }
fn splitTransfer(s:SplitObservation,width:f32,lightLife:f32,opacityLife:f32)->vec4<f32>{
  let age=max(0.0,s.anchor.w-1.0);
  let q=max(s.optical.xyz,vec3<f32>(0))*exp(-age/lightLife);let sigma=max(s.optical.w,0.0)*exp(-age/opacityLife);
  let trans=exp(-sigma*width);
  let tau=sigma*width;var scale=width*(1.0-tau*.5+tau*tau/6.0);if(tau>=.001){scale=(1.0-trans)/sigma;}
  return vec4<f32>(q*scale,trans);
}
fn splitCompose(a:vec4<f32>,b:vec4<f32>)->vec4<f32>{return vec4<f32>(a.xyz+a.w*b.xyz,a.w*b.w);}
fn splitRefresh(old:SplitObservation,fresh:SplitObservation,response:f32,lightLife:f32,opacityLife:f32)->SplitObservation{
 let age=max(0.0,old.anchor.w-1.0);let evolved=old.optical*vec4<f32>(vec3<f32>(exp(-age/lightLife)),exp(-age/opacityLife));
 return SplitObservation(mix(evolved,fresh.optical,response),fresh.anchor,fresh.support);
}
fn splitWidths(a:vec2<f32>,b:vec2<f32>,boundary:f32,start:f32,end:f32,hasB:bool)->vec2<f32>{
 var near=clamp(a,vec2<f32>(start),vec2<f32>(end));var far=clamp(b,vec2<f32>(start),vec2<f32>(end));
 if(hasB&&near.y>far.x){let cut=clamp(boundary,max(near.x,far.x),min(near.y,far.y));near.y=min(near.y,cut);far.x=max(far.x,cut);}
 return max(vec2<f32>(0),vec2<f32>(near.y-near.x,select(0.0,far.y-far.x,hasB)));
}
fn splitNeedsAcquisition(a:SplitObservation,b:SplitObservation)->bool{return a.anchor.w<=0.0||b.anchor.w<=0.0;}
fn splitProminence(s:SplitObservation)->f32{return max(length(s.optical.xyz),s.optical.w);}
`;

export const SPLIT_OPTICAL_WGSL=/* wgsl */`
override SPLIT_INTEGRAL:bool=false;
struct SplitOptions {
 viewProj:mat4x4<f32>, size:vec4<u32>, policy:vec4<f32>, life:vec4<f32>,
 flow:vec4<f32>, worldLo:vec4<f32>, worldDims:vec4<f32>, worldMap:vec4<f32>,
 middleLo:vec4<f32>, middleDims:vec4<f32>, middleMap:vec4<f32>, arenaOffsets:vec4<u32>
}
@group(3) @binding(0) var<uniform> splitOptions:SplitOptions;
@group(0) @binding(39) var<storage,read_write> splitArena:array<vec4<f32>>;
${SPLIT_OPTICAL_MATH_WGSL}
struct SplitRay { kept:array<SplitObservation,2>, fresh:array<SplitObservation,2>, refreshSlot:i32, start:f32, end:f32 }
fn splitProject(p:vec3<f32>)->vec3<f32>{let clip=splitOptions.viewProj*vec4<f32>(p,1);return vec3<f32>((clip.xy/clip.w*vec2<f32>(.5,-.5)+.5)*vec2<f32>(splitOptions.size.xy),clip.w);}
fn splitCoarseVelocity(p:vec3<f32>,middle:bool)->vec3<f32>{
 let lo=select(splitOptions.worldLo,splitOptions.middleLo,middle);
 let dims=select(splitOptions.worldDims,splitOptions.middleDims,middle);
 let map=select(splitOptions.worldMap,splitOptions.middleMap,middle);
 if(dims.w<=0.0){return vec3<f32>(0);}
 let q=p*map.w+map.xyz;var result=vec3<f32>(0);
 // Face-centered coarse flow, matching the world's own advection convention.
 for(var a=0u;a<3u;a++){
  var offset=vec3<f32>(.5);offset[a]=1.0;let cell=(q-lo.xyz)/lo.w-offset;
  let base=vec3<i32>(floor(cell));let f=fract(cell);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),vec3<i32>(dims.xyz)-1);
   let i=u32(c.x)+u32(dims.x)*(u32(c.y)+u32(dims.y)*u32(c.z));
   let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));
   let flowOffset=select(splitOptions.arenaOffsets.z,splitOptions.arenaOffsets.w,middle);let v=splitArena[flowOffset+i][a];
   result[a]+=v*w.x*w.y*w.z;
  }}}
 }return result/map.w;
}
fn splitVelocity(p:vec3<f32>)->vec3<f32>{
 if(worldInsideFine(p)){
  // sampleWorldVelocity is expressed in fine cells; use component-face offsets
  // on the staggered route, matching sampleRaymarchNeighborhood's convention.
  var v=vec3<f32>(0);for(var a=0u;a<3u;a++){
   var offset=vec3<f32>(.5);if(splitOptions.flow.w>.5){offset[a]=1.0;}
   v[a]=sampleFluidSlot(worldToCell(p)+vec3<f32>(.5)-offset,0u)[a];
  }return v*splitOptions.flow.z;
 }
 let m=splitOptions.middleMap;let mp=p*m.w+m.xyz;
 let inside=splitOptions.middleDims.w>.5&&all(mp>=splitOptions.middleLo.xyz)&&all(mp<splitOptions.middleLo.xyz+splitOptions.middleDims.xyz*splitOptions.middleLo.w);
 return splitCoarseVelocity(p,inside);
}
fn splitMove(s:SplitObservation)->SplitObservation{
 var r=s;if(s.anchor.w<=0){return r;}
 r.anchor=vec4<f32>(s.anchor.xyz+splitVelocity(s.anchor.xyz)*splitOptions.flow.x*splitOptions.policy.w,s.anchor.w+1.0);return r;
}
fn splitLoad(pixel:vec2<f32>,slot:u32)->SplitObservation{
 var empty:SplitObservation;if(any(pixel<vec2<f32>(0))||any(pixel>=vec2<f32>(splitOptions.size.xy))){return empty;}
 let at=vec2<u32>(pixel);let i=splitOptions.arenaOffsets.x+3u*(2u*(at.x+at.y*splitOptions.size.x)+slot);return SplitObservation(splitArena[i],splitArena[i+1u],splitArena[i+2u]);
}
fn splitPull(pixel:vec2<f32>,slot:u32,ro:vec3<f32>,rd:vec3<f32>,start:f32,end:f32)->SplitObservation{
 var old=splitLoad(pixel,slot);if(old.anchor.w<=0){return old;}
 let moved=splitMove(old);let motion=splitProject(moved.anchor.xyz).xy-splitProject(old.anchor.xyz).xy;
 old=splitLoad(pixel-motion,slot);old=splitMove(old);
 let screen=splitProject(old.anchor.xyz);let depth=dot(old.anchor.xyz-ro,rd);
 if(old.anchor.w<=0||screen.z<=0||distance(screen.xy,pixel)>splitOptions.life.w||depth<start||depth>end){var empty:SplitObservation;return empty;}
 return old;
}
fn splitInit(pixel:vec2<f32>,ro:vec3<f32>,rd:vec3<f32>,start:f32,end:f32,phase:f32)->SplitRay{
 var r:SplitRay;r.refreshSlot=-1;r.start=start;r.end=end;
 if(splitOptions.size.w>0u&&splitOptions.policy.x>1.5&&splitOptions.size.z==1u){
  r.kept[0]=splitPull(pixel,0u,ro,rd,start,end);r.kept[1]=splitPull(pixel,1u,ro,rd,start,end);
  // Refresh old or consequential evidence; reserve explicit independent coverage.
  if(phase>=splitOptions.policy.y&&!splitNeedsAcquisition(r.kept[0],r.kept[1])){
   let a=r.kept[0];let b=r.kept[1];
   let pa=splitProminence(a);let pb=splitProminence(b);
   let ua=a.anchor.w*(.25+pa/(1.0+pa));let ub=b.anchor.w*(.25+pb/(1.0+pb));
   r.refreshSlot=select(0,1,ub>ua);
   if(r.kept[u32(r.refreshSlot)].anchor.w<=0){r.refreshSlot=-1;}
  }
 }return r;
}
fn splitSampleDepth(r:SplitRay,ro:vec3<f32>,rd:vec3<f32>,ordinary:f32)->f32{
 if(r.refreshSlot>=0){return clamp(dot(r.kept[u32(r.refreshSlot)].anchor.xyz-ro,rd),r.start,r.end);}
 // A fixed phase still acquires a distinct second depth rather than duplicating
 // the first observation after a cold start.
 if(splitNeedsAcquisition(r.kept[0],r.kept[1])&&r.kept[0].anchor.w>0.0){let old=dot(r.kept[0].anchor.xyz-ro,rd);let span=r.end-r.start;if(abs(ordinary-old)<span*.0001){return mix(r.start,r.end,fract((ordinary-r.start)/span+.381966));}}
 return ordinary;
}
fn splitObserve(r:ptr<function,SplitRay>,index:u32,p:vec3<f32>,q:vec3<f32>,sigma:f32,depth:f32,lo:f32,hi:f32,pitch:f32){
 if(index<2u){
  var support=vec4<f32>(lo-depth,hi-depth,1,0);
  if(splitOptions.size.z==1u){
   let extent=.5*pitch*splitOptions.flow.y;support.xy=vec2<f32>(max(lo-depth,-extent),min(hi-depth,extent));
   if((*r).refreshSlot>=0){support=(*r).kept[u32((*r).refreshSlot)].support;}
  }
  (*r).fresh[index]=SplitObservation(vec4<f32>(q,sigma),vec4<f32>(p,1),support);
 }
}
fn splitFinish(r:SplitRay,pixel:u32,ro:vec3<f32>,rd:vec3<f32>)->vec4<f32>{
 var a=r.kept[0];var b=r.kept[1];let fresh=r.fresh[0];
 if(splitOptions.size.z==2u){a=fresh;b=r.fresh[1];}
 else if(r.refreshSlot>=0){
  if(r.refreshSlot==0){a=splitRefresh(a,fresh,splitOptions.policy.z,splitOptions.life.x,splitOptions.life.y);}
  else{b=splitRefresh(b,fresh,splitOptions.policy.z,splitOptions.life.x,splitOptions.life.y);}
 }else{
  if(a.anchor.w<=0){a=fresh;}else if(b.anchor.w<=0){b=fresh;}else{
   let pa=splitProminence(a)*exp(-max(0.0,a.anchor.w-1.0)/splitOptions.life.x);
   let pb=splitProminence(b)*exp(-max(0.0,b.anchor.w-1.0)/splitOptions.life.x);
   // A weak exploratory miss does not erase a strong retained observation.
   if(splitProminence(fresh)>=min(pa,pb)){if(pa<=pb){a=fresh;}else{b=fresh;}}
  }
 }
 if(a.anchor.w<=0&&b.anchor.w>0){a=b;b=SplitObservation(vec4<f32>(0),vec4<f32>(0),vec4<f32>(0));}
 if(a.anchor.w>0&&b.anchor.w>0&&dot(a.anchor.xyz-ro,rd)>dot(b.anchor.xyz-ro,rd)){let t=a;a=b;b=t;}
 let address=splitOptions.arenaOffsets.y+6u*pixel;splitArena[address]=a.optical;splitArena[address+1u]=a.anchor;splitArena[address+2u]=a.support;splitArena[address+3u]=b.optical;splitArena[address+4u]=b.anchor;splitArena[address+5u]=b.support;
 if(a.anchor.w<=0){return vec4<f32>(0,0,0,1);}
 let da=dot(a.anchor.xyz-ro,rd);let db=dot(b.anchor.xyz-ro,rd);
 var boundary=(da+db)*.5;if(splitOptions.size.z==2u){boundary=(r.start+r.end)*.5;}
 let widths=splitWidths(vec2<f32>(da)+a.support.xy,vec2<f32>(db)+b.support.xy,boundary,r.start,r.end,b.anchor.w>0.0);
 let first=widths.x;let second=widths.y;
 return splitCompose(splitTransfer(a,first,splitOptions.life.x,splitOptions.life.y),splitTransfer(b,second,splitOptions.life.x,splitOptions.life.y));
}
`;

export function splitArenaLayout(width,height,worldCells=0,middleCells=0){
 for(const value of [width,height,worldCells,middleCells])if(!Number.isSafeInteger(value)||value<0)throw Error('Split arena dimensions must be nonnegative integers');
 if(!width||!height)throw Error('Split arena requires a positive render target');
 const bankBytes=width*height*96,historyBytes=bankBytes*2,flowBytes=(worldCells+middleCells)*16,bytes=historyBytes+flowBytes;
 if(!Number.isSafeInteger(bytes)||bytes/16>=0x100000000)throw Error('Split arena exceeds u32 addressing');
 return {bankBytes,historyBytes,flowBytes,bytes,worldOffset:historyBytes/16,middleOffset:historyBytes/16+worldCells};
}
export function createSplitIntegral(device) {
 const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
 // The ordinary Fixed-mode allocator never consumes importance history. Its
 // existing binding39 carries the arena, keeping the composed stage at10slots.
 const layout=device.createBindGroupLayout({label:'split optical policy',entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
 const emptyLayout=device.createBindGroupLayout({entries:[]});
 const emptyGroup=device.createBindGroup({layout:emptyLayout,entries:[]});
 const uniform=device.createBuffer({label:'split optical transport policy',size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 let arena=null,allocation=null,key=null,index=0,frames=0,lastStep=0,config=splitIntegralSettings(),state={requested:'off',effective:'off',bytes:0};
 function retire(owned){if(!owned)return;queueMicrotask(()=>{device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>owned.destroy());});}
 function disable(reason='off'){retire(arena);arena=null;allocation=null;key=null;frames=0;state={requested:config.mode,effective:'off',reason,bytes:0};return state;}
 function prepare(encoder,{width,height,settings,identity,step,viewProj,world,middle,backtrace,fineScale,staggered}) {
  config=splitIntegralSettings(settings);const fresh=config.mode==='split'?2:config.fresh;
  const cells=field=>field?field.plan.flowDims.reduce((a,b)=>a*b,1):0;
  const next=splitArenaLayout(width,height,cells(world),cells(middle));
  if(next.bytes>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error(`Split optical arena needs ${next.bytes} bytes; exceeds effective device binding capacity`);
  const nextKey=JSON.stringify([width,height,identity,next]);let reset=key!==nextKey||step<lastStep;
  if(!arena||arena.size!==next.bytes){retire(arena);arena=device.createBuffer({label:'two local optical contributions per pixel',size:next.bytes,usage});reset=true;}
  allocation=next;
  if(reset){encoder.clearBuffer(arena,0,next.historyBytes);frames=0;index=0;}else index=1-index;
  encoder.clearBuffer(arena,index*next.bankBytes,next.bankBytes);
  // Small current coarse-flow snapshots share this storage binding. No CPU
  // readback or extra material march is needed; existing flow buffers stay owned.
  if(world)encoder.copyBufferToBuffer(world.velocity,0,arena,next.worldOffset*16,cells(world)*16);
  if(middle)encoder.copyBufferToBuffer(middle.velocity,0,arena,next.middleOffset*16,cells(middle)*16);
  const stepDelta=reset?0:step-lastStep;const data=new ArrayBuffer(240),f=new Float32Array(data),u=new Uint32Array(data);
  f.set(viewProj);u.set([width,height,fresh,frames],16);
  f.set([config.mode==='transport'?2:1,config.exploration,config.response,config.motion],20);
  f.set([config.memory,config.opacityMemory,stepDelta,config.footprint],24);
  f.set([stepDelta*backtrace,config.depthSupport,fineScale,staggered?1:0],28);
  const put=(field,offset)=>{if(!field){f.set([0,0,0,1,1,1,1,0,0,0,0,1],offset);return;}
   f.set([...field.plan.min,field.plan.flowPitch,...field.plan.flowDims,1,...field.map],offset);};
  put(world,32);put(middle,44);u.set([(1-index)*next.bankBytes/16,index*next.bankBytes/16,next.worldOffset,next.middleOffset],56);device.queue.writeBuffer(uniform,0,data);
  const group=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:uniform}}]});
  frames++;key=nextKey;lastStep=step;
  state={requested:config.mode,effective:config.mode==='transport'&&fresh===2?'full-refresh':config.mode,retainedSlots:2,freshEvaluations:fresh,frames,step,stepDelta,reset,
   width,height,pixels:width*height,bytes:next.bytes,historyBytes:next.historyBytes,flowBytes:next.flowBytes,recordBytes:48,storageBindings:1,storageSlot:39,recordAllocation:'dense-fire-render-target',settings:config,
   motion:'pull warped source anchors using current Fine/Middle/World velocity; camera changes reset',life:'independent exponential radiance/extinction lifetime in rendered draws',source:'local source coefficient including incident scattering, before prefix attenuation',intervals:fresh===2?'original equal-distance strata':'bounded source support; sorted nonoverlapping optical intervals',extraWork:'anchor reprojection and velocity queries plus coarse flow buffer copies; no additional material evaluation'};
  return {group,state};
 }
 async function sample(){if(!frames)return {available:false,state};const epoch=frames,b=arena,offset=index*allocation.bankBytes,size=allocation.bankBytes,read=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,offset,read,0,size);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);if(frames!==epoch||arena!==b)throw Error('Split readback became stale');return {available:true,state,records:new Float32Array(read.getMappedRange().slice(0))};}finally{read.unmap();read.destroy();}}
 return {layout,emptyLayout,emptyGroup,get buffer(){return arena;},prepare,disable,sample,reset(){key=null;},read:()=>state,dispose(){disable();uniform.destroy();}};
}

// WebGPU discovers resource use before constant branch elimination. Ordinary
// pipelines compile these resource-free hooks; only the split specialization
// substitutes the real group-three implementation.
export const SPLIT_OPTICAL_OFF_WGSL=/* wgsl */`
override SPLIT_INTEGRAL:bool=false;
struct SplitOptions {size:vec4<u32>}
var<private> splitOptions:SplitOptions;
struct SplitRay {unused:f32}
fn splitInit(pixel:vec2<f32>,ro:vec3<f32>,rd:vec3<f32>,start:f32,end:f32,phase:f32)->SplitRay{return SplitRay(0);}
fn splitSampleDepth(r:SplitRay,ro:vec3<f32>,rd:vec3<f32>,ordinary:f32)->f32{return ordinary;}
fn splitObserve(r:ptr<function,SplitRay>,index:u32,p:vec3<f32>,q:vec3<f32>,sigma:f32,depth:f32,lo:f32,hi:f32,pitch:f32){}
fn splitFinish(r:SplitRay,pixel:u32,ro:vec3<f32>,rd:vec3<f32>)->vec4<f32>{return vec4<f32>(0,0,0,1);}
`;
// Same equal-distance placement and widths as mode4 of the ordinary allocator.
// No spatial importance read/write is reached in this specialization.
export const SPLIT_FIXED_ALLOCATION_WGSL=/* wgsl */`
struct GuidedRay {start:f32,end:f32,left:f32,width:f32,intervalStart:f32}
fn guidedRayInit(ro:vec3<f32>,rd:vec3<f32>,start:f32,end:f32)->GuidedRay{return GuidedRay(start,end,start,0,start);}
fn guidedNext(s:ptr<function,GuidedRay>,ro:vec3<f32>,rd:vec3<f32>,index:u32,count:u32,phase:f32,freshPhase:f32)->f32{
 let total=(*s).end-(*s).start;(*s).intervalStart=(*s).left;
 let point=(*s).start+total*(f32(index)+phase)/f32(count);
 var right=(*s).end;if(index+1u<count){right=(*s).start+total*f32(index+1u)/f32(count);}
 (*s).width=max(0.0,right-(*s).left);(*s).left=right;return point;
}
fn recordRayGuidance(p:vec3<f32>,q:vec3<f32>,sigma:f32,trans:f32,ds:f32){}
`;
export function splitOpticalShader(code,active=false){
 if(!active)return code;
 if(!code.includes(HISTORY_ALLOCATION_WGSL)||!code.includes(SPLIT_OPTICAL_OFF_WGSL))throw Error('Split specialization requires ordinary allocation and resource-free hooks');
 return code.replace(HISTORY_ALLOCATION_WGSL,SPLIT_FIXED_ALLOCATION_WGSL).replace(SPLIT_OPTICAL_OFF_WGSL,SPLIT_OPTICAL_WGSL);
}
