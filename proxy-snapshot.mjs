// Proxy snapshots: small, timestamped, CPU-resident payloads that a sim owner
// publishes and a proxy layer draws every frame. A snapshot never references sim
// GPU buffers, so any renderer, device or loop can draw it, and a stale one is
// still drawable.
export const PROXY_SNAPSHOT_SCHEMA='kaminos.proxy-snapshot.v0';
// Surfel packing: position xyz, normal xyz, velocity xyz, thickness, curvature.
export const SURFEL_FLOATS=11;

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
  capturedAtMs,activeRecords,stride,count,floatsPerSurfel:SURFEL_FLOATS,data:data.subarray(0,count*SURFEL_FLOATS)};
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
   const mapRead=globalThis.GPUMapMode?.READ??1;
   Promise.all([s.counters.mapAsync(mapRead),s.records.mapAsync(mapRead)]).then(()=>{
    if(disposed)return;
    const snapshot=decodeInterfaceSurfels(new Uint32Array(s.counters.getMappedRange()),new Float32Array(s.records.getMappedRange()),
     {recordFloats:d.recordFloats,capacity:d.capacity,activeCountCounterIndex:d.activeCountCounterIndex,fields:d.fields,maxInstances,writeTick,stepSeconds,capturedAtMs});
    s.counters.unmap();s.records.unmap();
    snapshotsPublished++;onSnapshot?.(snapshot);
   }).catch(error=>{lastError=String(error?.message||error);}).finally(()=>{pending=false;});
   return true;
  },
  state:()=>({ticks,copiesSubmitted,snapshotsPublished,pending,everyFrames,maxInstances,lastError}),
  dispose() {disposed=true;if(!pending){staging?.records.destroy();staging?.counters.destroy();}staging=null;},
 };
}
