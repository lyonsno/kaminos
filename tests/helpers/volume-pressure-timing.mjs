// Diagnostic adapter around the existing single-pass PCG encoder. No kernel edits.
export function decodePressureTimestamps(ticks){
  if(ticks.length!==2)throw new Error('exactly two GPU timestamps required');
  if(ticks[0]<=0n||ticks[1]<=ticks[0])throw new Error('positive ordered GPU timestamps required');
  return {gpuMs:Number(ticks[1]-ticks[0])/1e6,timestampNs:Array.from(ticks,String)};
}
export function pressureTimestampScope(device,encoder){
  if(!device.features.has('timestamp-query'))throw new Error('timestamp-query required; no wall-time fallback');
  const queries=device.createQuerySet({type:'timestamp',count:2});
  const resolved=device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
  const read=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  let passes=0,dispatches=0;
  return {
    get dispatches(){return dispatches;},
    encoder:{
      clearBuffer(...args){return encoder.clearBuffer(...args);},
      beginComputePass(descriptor){
        if(passes++)throw new Error('timing scope requires exactly one compute pass');
        const pass=encoder.beginComputePass({...descriptor,timestampWrites:{querySet:queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}});
        return new Proxy(pass,{get(target,key){if(key==='dispatchWorkgroups')return(...args)=>{dispatches++;return target.dispatchWorkgroups(...args);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
      },
    },
    resolve(){if(passes!==1)throw new Error('timing scope requires exactly one compute pass');encoder.resolveQuerySet(queries,0,2,resolved,0);encoder.copyBufferToBuffer(resolved,0,read,0,16);},
    async read(){await read.mapAsync(GPUMapMode.READ);try{return {...decodePressureTimestamps(new BigUint64Array(read.getMappedRange())),dispatches};}finally{read.unmap();}},
    destroy(){queries.destroy();resolved.destroy();read.destroy();},
  };
}
