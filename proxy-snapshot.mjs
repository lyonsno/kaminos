// Proxy snapshots: small, timestamped, CPU-resident payloads that a sim owner
// publishes and a proxy layer draws every frame. A snapshot never references sim
// GPU buffers, so any renderer, device or loop can draw it, and a stale one is
// still drawable.
export const PROXY_SNAPSHOT_SCHEMA='kaminos.proxy-snapshot.v0';
// Surfel packing: position xyz, normal xyz, velocity xyz, thickness, curvature.
export const SURFEL_FLOATS=11;

// Heat-block packing: world centroid xyz, mean heat, mean smoke, heat-weighted
// rise speed, block world size.
export const HEAT_BLOCK_FLOATS=7;

// Decode the fire's pressure-residual probe partials (one record of 20 floats
// per 4x4x4 cell block, linear index x + y*wx + z*wx*wy) into a world-space
// heat-block snapshot. The lateral centroid comes from the heat moments; height
// is the block centre. Blocks below both thresholds (per-cell means) are dropped.
export function decodeHeatBlocks({partials,grid,gridY,workgroupsX,workgroupsY,workgroupsZ,floatsPerWorkgroup=20,step=0},{domain,heatThreshold=1e-3,smokeThreshold=1e-2,capturedAtMs=0,stepSeconds=1/60}) {
 const blocks=workgroupsX*workgroupsY*workgroupsZ;
 if(!(partials instanceof Float32Array)||partials.length<blocks*floatsPerWorkgroup)throw Error('Residual partials do not cover the block grid');
 const cell=2/grid,scale=domain.scale,[tx,ty,tz]=domain.translation,toWorld=(c,t)=>t+scale*(-1+(c+0.5)*cell);
 const data=new Float32Array(blocks*HEAT_BLOCK_FLOATS);let count=0,heatTotal=0,heatMax=0,smokeMax=0;const heatMoment=[0,0,0];
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<blocks;i++){
  const at=i*floatsPerWorkgroup,heatSum=partials[at+13],smokeSum=partials[at+14];
  const bx=i%workgroupsX,by=Math.floor(i/workgroupsX)%workgroupsY,bz=Math.floor(i/(workgroupsX*workgroupsY));
  const cellsInBlock=Math.min(4,grid-bx*4)*Math.min(4,gridY-by*4)*Math.min(4,grid-bz*4);
  const heat=heatSum/cellsInBlock,smoke=smokeSum/cellsInBlock;
  if(!(heat>=heatThreshold||smoke>=smokeThreshold))continue;
  const centreX=bx*4+1.5,centreY=by*4+1.5,centreZ=bz*4+1.5;
  const cx=heatSum>1e-9?partials[at+16]/heatSum:centreX,cz=heatSum>1e-9?partials[at+17]/heatSum:centreZ;
  const x=toWorld(cx,tx),y=toWorld(centreY,ty),z=toWorld(cz,tz);
  const values=[x,y,z,heat,smoke,heatSum>1e-9?partials[at+15]/heatSum:0,scale*4*cell];
  if(!values.every(Number.isFinite))continue;
  data.set(values,count*HEAT_BLOCK_FLOATS);count++;
  for(const [k,v] of [x,y,z].entries()){if(v<min[k])min[k]=v;if(v>max[k])max[k]=v;heatMoment[k]+=v*heatSum;}
  heatTotal+=heatSum;if(heat>heatMax)heatMax=heat;if(smoke>smokeMax)smokeMax=smoke;
 }
 return {schema:PROXY_SNAPSHOT_SCHEMA,kind:'heat-blocks',source:'volume-pressure-residual-probe',writeTick:step,simTimeS:step*stepSeconds,capturedAtMs,
  grid:[grid,gridY,grid],count,floatsPerBlock:HEAT_BLOCK_FLOATS,data:data.subarray(0,count*HEAT_BLOCK_FLOATS),
  summary:{count,bounds:count?[min,max]:null,heatCentroid:heatTotal>1e-9?heatMoment.map(v=>v/heatTotal):null,heatTotal,heatMax,smokeMax}};
}

// Where the surfels are, without iterating them: world bounds, centroid and
// mean thickness, for maps, sketches and agents that need no drawing.
export function surfelSummary(data,count) {
 if(!count)return {count:0,bounds:null,centroid:null,meanThickness:null};
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],sum=[0,0,0];let thickness=0;
 for(let i=0;i<count;i++){const at=i*SURFEL_FLOATS;for(let k=0;k<3;k++){const v=data[at+k];if(v<min[k])min[k]=v;if(v>max[k])max[k]=v;sum[k]+=v;}thickness+=data[at+9];}
 return {count,bounds:[min,max],centroid:sum.map(v=>v/count),meanThickness:thickness/count};
}

// Page-level publication: the latest snapshot per source, subscribers, and a
// demand signal so producers run while anyone (viewport layer, map, agent) is
// listening. A failing consumer is counted and skipped, never allowed to stop
// publication to the others.
export function createProxySnapshotRegistry() {
 const latest=new Map(),subscribers=new Map();let consumerErrors=0,lastConsumerError=null;
 const set=source=>{if(!subscribers.has(source))subscribers.set(source,new Set());return subscribers.get(source);};
 return {
  publish(source,snapshot){latest.set(source,snapshot);for(const fn of [...(subscribers.get(source)||[])])try{fn(snapshot);}catch(error){consumerErrors++;lastConsumerError=String(error?.message||error);}},
  latest:source=>latest.get(source)??null,
  subscribe(source,fn,{replayLatest=false}={}){const listeners=set(source);listeners.add(fn);if(replayLatest&&latest.has(source))fn(latest.get(source));return ()=>listeners.delete(fn);},
  wanted:source=>(subscribers.get(source)?.size??0)>0,
  sources:()=>[...new Set([...latest.keys(),...subscribers.keys()])].map(source=>{const s=latest.get(source);
   return {source,subscribers:subscribers.get(source)?.size??0,writeTick:s?.writeTick??null,capturedAtMs:s?.capturedAtMs??null,count:s?.count??null,summary:s?.summary??null};}),
  clear(source){latest.delete(source);},
  state:()=>({consumerErrors,lastConsumerError}),
 };
}

export function surfelExtrapolationSeconds(nowS,snapshotS,maxS) {
 return Math.min(maxS,Math.max(0,nowS-snapshotS));
}

// Decode the water solver's compacted interface records. Non-finite records and
// dormant particles (material < 0) are dropped; past the instance budget the
// records are strided rather than truncated, so coverage stays spatially even.
export function decodeInterfaceSurfels(counters,records,{recordFloats,capacity,activeCountCounterIndex=0,fields,maxInstances,writeTick=0,stepSeconds=1/60,capturedAtMs=0}) {
 if(!(records instanceof Float32Array)||records.length<capacity*recordFloats)throw Error('Interface records do not cover the declared capacity');
 const activeRecords=Math.min(capacity,counters[activeCountCounterIndex]>>>0);
 const stride=Math.max(1,Math.ceil(activeRecords/Math.max(1,maxInstances)));
 const {positionId:p,velocityConfidence:v,normalCurvature:n,thicknessContactWetnessMaterial:t}=fields;
 const data=new Float32Array(Math.ceil(activeRecords/stride)*SURFEL_FLOATS);
 let count=0;
 for(let i=0;i<activeRecords;i+=stride) {
  const at=i*recordFloats;
  const values=[records[at+p],records[at+p+1],records[at+p+2],records[at+n],records[at+n+1],records[at+n+2],
   records[at+v],records[at+v+1],records[at+v+2],records[at+t],records[at+n+3]];
  if(records[at+t+3]<0||!values.every(Number.isFinite))continue;
  data.set(values,count*SURFEL_FLOATS);count++;
 }
 return {schema:PROXY_SNAPSHOT_SCHEMA,kind:'surfels',source:'local-liquid-interface-records',writeTick,simTimeS:writeTick*stepSeconds,
  capturedAtMs,activeRecords,stride,count,floatsPerSurfel:SURFEL_FLOATS,data:data.subarray(0,count*SURFEL_FLOATS),summary:surfelSummary(data,count)};
}

// Copy interface records into caller-owned staging buffers every N ticks, with
// at most one map in flight, and publish each decoded snapshot. The copy is
// encoded after the step that wrote the records (queue order), and nothing here
// waits on the GPU.
export function createInterfaceSurfelProducer({descriptor,everyFrames=4,maxInstances=16384,stepSeconds=1/60,onSnapshot,now=()=>performance.now()}) {
 let staging=null,pending=false,ticks=0,snapshotsPublished=0,copiesSubmitted=0,lastError=null,disposed=false;
 const ensureStaging=d=>{
  if(staging?.device===d.device&&staging.capacity===d.capacity&&staging.counters.size===d.counterBytes)return staging;
  staging?.records.destroy();staging?.counters.destroy();
  const usage=(globalThis.GPUBufferUsage?.COPY_DST??8)|(globalThis.GPUBufferUsage?.MAP_READ??1);
  staging={device:d.device,capacity:d.capacity,
   records:d.device.createBuffer({label:'kaminos-proxy-surfel-records',size:d.capacity*d.recordBytes,usage}),
   counters:d.device.createBuffer({label:'kaminos-proxy-surfel-counters',size:d.counterBytes,usage})};
  return staging;
 };
 return {
  tick() {
   if(disposed||pending||ticks++%everyFrames!==0)return false;
   const d=descriptor();
   if(!d)return false;
   const s=ensureStaging(d),writeTick=d.writeTick,capturedAtMs=now();
   const encoder=d.device.createCommandEncoder({label:'kaminos-proxy-surfel-copy'});
   encoder.copyBufferToBuffer(d.countersBuffer,0,s.counters,0,d.counterBytes);
   encoder.copyBufferToBuffer(d.recordsBuffer,0,s.records,0,d.capacity*d.recordBytes);
   d.device.queue.submit([encoder.finish()]);copiesSubmitted++;
   pending=true;
   // The pair stays owned by this readback until both maps settle: mapped
   // buffers are always unmapped, and a failed or retired pair is destroyed
   // rather than reused.
   const pair=s,mapRead=globalThis.GPUMapMode?.READ??1;
   Promise.allSettled([pair.counters.mapAsync(mapRead),pair.records.mapAsync(mapRead)]).then(([counters,records])=>{
    const mapped=counters.status==='fulfilled'&&records.status==='fulfilled';
    try {
     if(!mapped)lastError=String((counters.reason??records.reason)?.message||counters.reason||records.reason);
     else if(!disposed&&staging===pair){
      const snapshot=decodeInterfaceSurfels(new Uint32Array(pair.counters.getMappedRange()),new Float32Array(pair.records.getMappedRange()),
       {recordFloats:d.recordFloats,capacity:d.capacity,activeCountCounterIndex:d.activeCountCounterIndex,fields:d.fields,maxInstances,writeTick,stepSeconds,capturedAtMs});
      snapshotsPublished++;onSnapshot?.(snapshot);
     }
    } catch(error) { lastError=String(error?.message||error); }
    finally {
     if(counters.status==='fulfilled')pair.counters.unmap();
     if(records.status==='fulfilled')pair.records.unmap();
     if(!mapped||disposed||staging!==pair){pair.counters.destroy();pair.records.destroy();if(staging===pair)staging=null;}
     pending=false;
    }
   });
   return true;
  },
  state:()=>({ticks,copiesSubmitted,snapshotsPublished,pending,everyFrames,maxInstances,lastError}),
  // A pending readback releases its own pair when its maps settle.
  dispose() {disposed=true;if(!pending){staging?.records.destroy();staging?.counters.destroy();}staging=null;},
 };
}
