// Simulation-only common GPU boundary for real independent runtime steps.
export async function sampleSimulationGroupGpuProfile(runtimes,{steps=32}={}) {
 if(!Array.isArray(runtimes)||!runtimes.length)throw Error('At least one simulation runtime required');
 if(new Set(runtimes).size!==runtimes.length)throw Error('Simulation runtimes must be distinct');
 if(!Number.isSafeInteger(steps)||steps<1)throw Error('Steps must be a positive safe integer');
 const contexts=await Promise.all(runtimes.map(r=>r.borrowThermalGpuContext()));
 const device=contexts[0].device;
 if(!device||contexts.some(c=>c.device!==device))throw Error('All simulation runtimes must share the same GPU device');
 if(!device.features.has('timestamp-query'))return {status:'unsupported',reason:'timestamp-query-not-supported'};
 const bytes=steps*256;
 if(!Number.isSafeInteger(bytes)||bytes>device.limits.maxBufferSize)throw Error('Profile exceeds GPU buffer capacity');
 for(const r of runtimes){if(typeof r.encodeSimulationProfileStep!=='function')throw Error('Runtime lacks common-scope simulation profiling');}
 for(const r of runtimes)r.setSelectiveHeadLiveCapturePaused(true);
 await device.queue.onSubmittedWorkDone();
 const owned=[];
 try {
 const querySet=device.createQuerySet({type:'timestamp',count:2});owned.push(querySet);
 const resolve=device.createBuffer({label:'simulation group profile resolve',size:bytes,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});owned.push(resolve);
 const readback=device.createBuffer({label:'simulation group profile readback',size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(readback);
 const encodeCpuMs=[],receipts=[];
 const marker=(encoder,index)=>{const p=encoder.beginComputePass({label:'simulation profile boundary',timestampWrites:{querySet,...(index===0?{beginningOfPassWriteIndex:0}:{endOfPassWriteIndex:1})}});p.end();};
  const origin=performance.now();
  for(let round=0;round<steps;round++) {
   const start=device.createCommandEncoder({label:'simulation group start'});marker(start,0);device.queue.submit([start.finish()]);
   const cpuStart=performance.now(),row=[];
   for(const runtime of runtimes){const encoder=device.createCommandEncoder({label:'simulation group unit'});row.push(runtime.encodeSimulationProfileStep(encoder,origin+round*1000/60));device.queue.submit([encoder.finish()]);}
   encodeCpuMs.push(performance.now()-cpuStart);receipts.push(row);
   const end=device.createCommandEncoder({label:'simulation group end'});marker(end,1);end.resolveQuerySet(querySet,0,2,resolve,round*256);
   if(round===steps-1)end.copyBufferToBuffer(resolve,0,readback,0,bytes);
   device.queue.submit([end.finish()]);
  }
  await readback.mapAsync(GPUMapMode.READ);const raw=new BigUint64Array(readback.getMappedRange().slice(0));readback.unmap();
  const timestampsNs=[],samplesUs=[];
  for(let round=0;round<steps;round++){const a=raw[round*32],b=raw[round*32+1];timestampsNs.push([String(a),String(b)]);samplesUs.push(a>0n&&b>=a?Number(b-a)/1000:null);}
  const valid=samplesUs.filter(v=>v!==null),ordered=[...valid].sort((a,b)=>a-b),q=f=>ordered[Math.min(ordered.length-1,Math.floor(f*ordered.length))]??null;
  return {identity:'kaminos.simulation-group-gpu-profile.v1',status:valid.length===steps?'sampled':'partial',rounds:steps,unitCount:runtimes.length,
   samplesUs,timestampsNs,encodeCpuMs,receipts,medianUs:q(.5),p10Us:q(.1),p90Us:q(.9),validRounds:valid.length,
   ordinarySubmissions:steps*runtimes.length,instrumentationSubmissions:steps*2,
   scope:'Common GPU interval before all unit updates through all encodeSim work; one ordinary submit per unit/round plus two fixed boundary submits. Includes predictors, coupling and World work. Excludes rendering and lighting. CPU gaps between submissions can be inside the elapsed interval; encodeCpuMs is reported separately. Runtimes remain capture-paused.'};
 } finally {for(const resource of owned)resource.destroy();}
}
