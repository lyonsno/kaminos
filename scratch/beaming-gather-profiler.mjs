// Isolated witness instrumentation. Loaded only by owned-browser response
// rewriting; production does not import or install this hook.
export function installGatherProfiler(device){
 if(window.__beamingGatherDevice)return;window.__beamingGatherDevice=device;
 if(!device.features.has('timestamp-query'))return;
 const make=device.createCommandEncoder.bind(device),submit=device.queue.submit.bind(device.queue),pending=new WeakMap();
 device.createCommandEncoder=spec=>{
  const encoder=make(spec),request=window.__beamingGatherProfile;
  if(spec?.label!=='same-state distributed flame lighting'||!request||request.remaining<=0)return encoder;
  request.remaining--;const query=device.createQuerySet({type:'timestamp',count:32}),labels=[];let slots=0;
  const begin=encoder.beginComputePass.bind(encoder),finish=encoder.finish.bind(encoder);
  encoder.beginComputePass=descriptor=>{if(slots+2>32)throw Error('lighting profile query capacity exceeded');
   labels.push(descriptor.label);const timestampWrites={querySet:query,beginningOfPassWriteIndex:slots++,endOfPassWriteIndex:slots++};return begin({...descriptor,timestampWrites});};
  encoder.finish=descriptor=>{
   if(!slots)throw Error('lighting profile contains no compute passes');
   const bytes=Math.ceil(slots*8/16)*16;
   const resolved=device.createBuffer({size:bytes,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
   const mapped=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   encoder.resolveQuerySet(query,0,slots,resolved,0);encoder.copyBufferToBuffer(resolved,0,mapped,0,bytes);
   const commands=finish(descriptor);pending.set(commands,{request,query,labels,slots,resolved,mapped});return commands;
  };return encoder;
 };
 device.queue.submit=commands=>{
  const list=Array.from(commands);submit(list);
  for(const command of list){const row=pending.get(command);if(!row)continue;pending.delete(command);
   row.mapped.mapAsync(GPUMapMode.READ).then(()=>{
    const times=Array.from(new BigUint64Array(row.mapped.getMappedRange())).slice(0,row.slots);
    const valid=!times.some((t,i)=>t===0n||(i&&t<times[i-1]));
    row.request.records.push({valid,rawNanoseconds:times.map(String),totalMs:valid?Number(times.at(-1)-times[0])/1e6:null,
      passes:row.labels.map((label,i)=>({label,ms:valid?Number(times[2*i+1]-times[2*i])/1e6:null}))});
    if(!valid)throw Error('missing/nonmonotonic lighting timestamps');
   }).catch(e=>row.request.errors.push(String(e))).finally(()=>{row.mapped.destroy();row.resolved.destroy();row.query.destroy();});
  }
 };
}
