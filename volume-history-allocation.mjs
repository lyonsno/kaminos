// A proposal distribution over ray distance, never a cache of rendered color.
// Every stratum covers its complete distance interval using fresh coefficients.
export function allocateRayStrata(segments, count, phase=.5, freshPhase=undefined) {
  if (!Number.isInteger(count)||count<1||!Number.isFinite(phase)||phase<=0||phase>=1) throw Error('positive count and interior phase required');
  let end=segments[0]?.start, mass=0;
  for(const s of segments){
    if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start!==end||s.end<=s.start||!Number.isFinite(s.weight)||s.weight<=0) throw Error('contiguous positive proposal required');
    mass+=(s.end-s.start)*s.weight;end=s.end;
  }
  if(!segments.length||!Number.isFinite(mass))throw Error('nonempty finite proposal required');
  if(freshPhase!==undefined){
    if(!Number.isFinite(freshPhase)||freshPhase<=0||freshPhase>=1)throw Error('interior fresh phase required');
    const start=segments[0].start;
    const points=count===1?[]:allocateRayStrata(segments,count-1,phase).map(b=>b.sample);
    points.push(start+(end-start)*freshPhase);points.sort((a,b)=>a-b);
    return points.map((sample,i)=>{
      const left=i===0?start:(points[i-1]+sample)*.5;
      const right=i===count-1?end:(sample+points[i+1])*.5;
      return {start:left,end:right,sample,width:right-left};
    });
  }
  let i=0,before=0;
  function at(q){
    while(i<segments.length-1&&before+(segments[i].end-segments[i].start)*segments[i].weight<q){
      before+=(segments[i].end-segments[i].start)*segments[i].weight;i++;
    }
    return segments[i].start+(q-before)/segments[i].weight;
  }
  let left=segments[0].start;
  return Array.from({length:count},(_,n)=>{
    const sample=at(mass*(n+phase)/count),right=n===count-1?end:at(mass*(n+1)/count);
    const result={start:left,end:right,sample,width:right-left};left=right;return result;
  });
}

export function historyAllocationGeometry({min,max,dims}){
  if(!min||!max||!dims||[min,max,dims].some(a=>a.length!==3)||!min.every(Number.isFinite)||!max.every(Number.isFinite)
    ||!dims.every(n=>Number.isInteger(n)&&n>0))throw Error('finite history box and positive dimensions required');
  const pitch=(max[0]-min[0])/dims[0];
  if(!(pitch>0)||!Number.isFinite(pitch)||max.some((v,i)=>Math.abs((v-min[i])/pitch-dims[i])>1e-4))throw Error('history box must have cubic cells');
  const cells=dims.reduce((a,b)=>a*b,1);
  if(!Number.isSafeInteger(cells)||cells>=0xffffffff)throw Error('history cell address exceeds u32');
  return {min:[...min],max:[...max],dims:[...dims],pitch,cells,bytes:cells*4};
}

export function createRayAllocationHistory(device){
  const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  let buffer=device.createBuffer({label:'inactive ray guidance',size:8,usage});
  // Immutable per-bank uniforms also support multiple draws in one encoder.
  const uniforms=[0,1].map(()=>device.createBuffer({label:'ray guidance geometry',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
  let geometry=null,key=null,index=0,frames=0,lastStep=null,resetReason='cold-start';
  function reset(){key=null;frames=0;resetReason='explicit-reset';}
  function prepare(encoder,request,identity,step){
    const next=historyAllocationGeometry(request);
    if(next.bytes*2>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error('ray guidance exceeds device storage limits');
    const nextKey=JSON.stringify([next,identity]);
    if(key!==nextKey||step<lastStep){
      resetReason=key===null?'cold-start':step<lastStep?'simulation-rewind':'geometry-or-settings-change';
      if(!geometry||geometry.bytes!==next.bytes){
        // Earlier passes in this same encoder can reference the previous buffer.
        // Drop our ownership; WebGPU retains it through those encoded uses.
        // Explicit destroy here invalidates the entire later queue submission.
        buffer=device.createBuffer({label:'two-bank last-march spatial guidance',size:next.bytes*2,usage});
      }
      encoder.clearBuffer(buffer);
      for(let bank=0;bank<2;bank++){
        const data=new ArrayBuffer(32);new Float32Array(data).set([...next.min,next.pitch]);
        new Uint32Array(data,16).set([...next.dims,bank*next.cells]);device.queue.writeBuffer(uniforms[bank],0,data);
      }
      geometry=next;key=nextKey;frames=0;index=0;
    }
    lastStep=step;index=1-index;encoder.clearBuffer(buffer,index*geometry.bytes,geometry.bytes);frames++;
    return read();
  }
  function read(){return {frames,historyFrames:frames>1?1:0,resetReason,geometry,
    previousOffset:geometry?(1-index)*geometry.bytes:0,observationsOffset:geometry?index*geometry.bytes:0,
    representation:'previous-draw-spatial-importance-max',prediction:'one-cell-neighborhood; no velocity advection',
    freshCoverage:'one uniform-distance observation per ray; remaining observations guided',colorReuse:false};}
  async function sample(){
    if(!geometry||frames<1)throw Error('ray allocation history has no executed draw');
    const encoder=device.createCommandEncoder({label:'explicit ray guidance readback'});
    const staging=[0,1].map(()=>device.createBuffer({size:geometry.bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
    encoder.copyBufferToBuffer(buffer,(1-index)*geometry.bytes,staging[0],0,geometry.bytes);
    encoder.copyBufferToBuffer(buffer,index*geometry.bytes,staging[1],0,geometry.bytes);device.queue.submit([encoder.finish()]);
    try{
      await Promise.all(staging.map(b=>b.mapAsync(GPUMapMode.READ)));
      return {state:read(),previous:new Uint32Array(staging[0].getMappedRange().slice(0)),observations:new Uint32Array(staging[1].getMappedRange().slice(0))};
    }finally{staging.forEach(b=>{b.unmap();b.destroy();});}
  }
  return {get buffer(){return buffer;},get uniform(){return uniforms[index];},
    prepare,read,reset,sample,dispose(){buffer.destroy();uniforms.forEach(b=>b.destroy());}};
}

export const HISTORY_ALLOCATION_WGSL=/* wgsl */`
@group(0) @binding(35) var<storage,read_write> rayGuidanceData:array<atomic<u32>>;
struct RayGuidanceGeometry { loPitch:vec4<f32>, dimsCells:vec4<u32> }
@group(0) @binding(37) var<uniform> rayGuidance:RayGuidanceGeometry;
fn guidanceCell(p:vec3<f32>)->vec3<i32>{return clamp(vec3<i32>(floor((p-rayGuidance.loPitch.xyz)/rayGuidance.loPitch.w)),vec3<i32>(0),vec3<i32>(rayGuidance.dimsCells.xyz)-1);}
fn guidanceIndex(c:vec3<i32>)->u32{return u32(c.x)+rayGuidance.dimsCells.x*(u32(c.y)+rayGuidance.dimsCells.y*u32(c.z));}
fn previousGuidanceValue(c:vec3<i32>)->f32{
  let cells=rayGuidance.dimsCells.x*rayGuidance.dimsCells.y*rayGuidance.dimsCells.z;
  return f32(atomicLoad(&rayGuidanceData[cells-rayGuidance.dimsCells.w+guidanceIndex(c)]));
}
fn previousGuidance(p:vec3<f32>)->f32{
  let c=guidanceCell(p);var value=previousGuidanceValue(c);
  for(var axis=0u;axis<3u;axis++){
    var d=vec3<i32>(0);d[axis]=1;
    let lo=max(c-d,vec3<i32>(0));let hi=min(c+d,vec3<i32>(rayGuidance.dimsCells.xyz)-1);
    value=max(value,.5*max(previousGuidanceValue(lo),previousGuidanceValue(hi)));
  }
  return value/65535.0;
}
fn recordRayGuidance(p:vec3<f32>,emission:vec3<f32>,sigma:f32,trans:f32,ds:f32){
  if(OPTICAL_STEP_MODE!=6u){return;}
  // Bounded positive score preserves optical contribution and opacity evidence.
  // No old color or old extinction enters the current integral.
  let strength=max(length(max(emission,vec3<f32>(0)))*ds,max(sigma,0.0)*ds)*trans;
  let score=u32(round(65535.0*strength/(1.0+strength)));
  atomicMax(&rayGuidanceData[rayGuidance.dimsCells.w+guidanceIndex(guidanceCell(p))],score);
}
fn joinProposal(p:vec3<f32>)->f32{
  let top=2.0*f32(GRID_Y)/f32(GRID)-1.0;
  let d=min(min(1.0-abs(p.x),1.0-abs(p.z)),min(p.y+1.0,top-p.y));
  let w=smoothstep(0.0,min(.5,worldRender.loPitch.w),d);
  let m=middleSmokeWeight(p);
  return max(4.0*w*(1.0-w),4.0*m*(1.0-m));
}
fn guidanceWeight(p:vec3<f32>)->f32{
  var weight=1.0;
  if(OPTICAL_STEP_MODE>=5u){weight+=4.0*joinProposal(p);}
  if(OPTICAL_STEP_MODE==6u){weight+=4.0*previousGuidance(p);}
  return weight;
}
fn guidanceBoxStop(ro:vec3<f32>,rd:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>,t:f32,stop:f32)->f32{
  if(any(hi<=lo)){return stop;}
  let hit=boxHit(ro-(lo+hi)*.5,rd,(hi-lo)*.5);
  var result=stop;
  if(hit.y>hit.x){if(hit.x>t){result=min(result,hit.x);}if(hit.y>t){result=min(result,hit.y);}}
  return result;
}
fn guidanceStop(ro:vec3<f32>,rd:vec3<f32>,t:f32,end:f32)->f32{
  // Midpoint-owned cells avoid a face-roundoff stall for either ray direction.
  let p=ro+rd*t;let c=guidanceCell(p+rd*rayGuidance.loPitch.w*.0001);
  let low=rayGuidance.loPitch.xyz+vec3<f32>(c)*rayGuidance.loPitch.w;
  let face=select(low,low+vec3<f32>(rayGuidance.loPitch.w),rd>vec3<f32>(0));
  var stop=end;
  for(var axis=0u;axis<3u;axis++){
    if(abs(rd[axis])>1e-12){let q=(face[axis]-ro[axis])/rd[axis];if(q>t){stop=min(stop,q);}}
  }
  let lo=vec3<f32>(-1);let hi=vec3<f32>(1,2.0*f32(GRID_Y)/f32(GRID)-1.0,1);
  let inset=vec3<f32>(min(.5,worldRender.loPitch.w));
  stop=guidanceBoxStop(ro,rd,lo,hi,t,stop);
  stop=guidanceBoxStop(ro,rd,lo+inset,hi-inset,t,stop);
  if(worldRender.middleHiEnabled.w>.5){
    let ml=worldRender.middleLoPitch.xyz;let mh=worldRender.middleHiEnabled.xyz;
    let mi=vec3<f32>(2.0*worldRender.middleLoPitch.w);
    stop=guidanceBoxStop(ro,rd,ml,mh,t,stop);
    stop=guidanceBoxStop(ro,rd,ml+mi,mh-mi,t,stop);
  }
  return stop;
}
struct GuidedRay {
  cursor:f32, end:f32, mass:f32, total:f32,
  segmentEnd:f32, weight:f32, left:f32, width:f32,
  start:f32, freshPoint:f32, candidate:f32, currentPoint:f32,
  guidedCount:u32, guidedIndex:u32, freshPending:u32,
}
fn guidedRayInit(ro:vec3<f32>,rd:vec3<f32>,start:f32,end:f32)->GuidedRay{
  var s:GuidedRay;s.cursor=start;s.left=start;s.start=start;s.end=end;
  var t=start;
  loop{
    if(t>=end){break;}
    let next=guidanceStop(ro,rd,t,end);
    s.total+=(next-t)*guidanceWeight(ro+rd*((t+next)*.5));t=next;
  }
  s.segmentEnd=guidanceStop(ro,rd,start,end);
  s.weight=guidanceWeight(ro+rd*((start+s.segmentEnd)*.5));
  return s;
}
fn guidedQuantile(s:ptr<function,GuidedRay>,ro:vec3<f32>,rd:vec3<f32>,quantileMass:f32)->f32{
  loop{
    let available=((*s).segmentEnd-(*s).cursor)*(*s).weight;
    let remaining=max(0.0,quantileMass-(*s).mass);
    if(remaining<=available||(*s).segmentEnd>=(*s).end){
      let position=min((*s).segmentEnd,(*s).cursor+remaining/(*s).weight);
      (*s).mass=quantileMass;(*s).cursor=position;return position;
    }
    (*s).mass+=available;(*s).cursor=(*s).segmentEnd;
    (*s).segmentEnd=guidanceStop(ro,rd,(*s).cursor,(*s).end);
    (*s).weight=guidanceWeight(ro+rd*(((*s).cursor+(*s).segmentEnd)*.5));
  }
}
fn guidedPop(s:ptr<function,GuidedRay>,ro:vec3<f32>,rd:vec3<f32>,phase:f32)->f32{
  if((*s).freshPending==1u&&((*s).guidedIndex>=(*s).guidedCount||(*s).freshPoint<=(*s).candidate)){
    (*s).freshPending=0u;return (*s).freshPoint;
  }
  let point=(*s).candidate;(*s).guidedIndex++;
  if((*s).guidedIndex<(*s).guidedCount){
    (*s).candidate=guidedQuantile(s,ro,rd,(*s).total*(f32((*s).guidedIndex)+phase)/f32((*s).guidedCount));
  }
  return point;
}
fn guidedNext(s:ptr<function,GuidedRay>,ro:vec3<f32>,rd:vec3<f32>,index:u32,count:u32,phase:f32,freshPhase:f32)->f32{
  if(OPTICAL_STEP_MODE==4u){
    let sample=guidedQuantile(s,ro,rd,(*s).total*(f32(index)+phase)/f32(count));
    var right=(*s).end;
    if(index+1u<count){right=guidedQuantile(s,ro,rd,(*s).total*f32(index+1u)/f32(count));}
    (*s).width=max(0.0,right-(*s).left);(*s).left=right;return sample;
  }
  // One observation is chosen in uniform distance independently of importance.
  // Merge it into the ordered proposal points and integrate their Voronoi cells.
  if(index==0u){
    (*s).guidedCount=count-1u;(*s).guidedIndex=0u;(*s).freshPending=1u;
    (*s).freshPoint=mix((*s).start,(*s).end,freshPhase);
    if(count>1u){(*s).candidate=guidedQuantile(s,ro,rd,(*s).total*phase/f32(count-1u));}
    (*s).currentPoint=guidedPop(s,ro,rd,phase);
  }
  let sample=(*s).currentPoint;var next=(*s).end;var right=(*s).end;
  if(index+1u<count){next=guidedPop(s,ro,rd,phase);right=(sample+next)*.5;}
  (*s).width=max(0.0,right-(*s).left);(*s).left=right;(*s).currentPoint=next;return sample;
}
`;
