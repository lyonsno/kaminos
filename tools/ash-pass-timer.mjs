// Assay-only pass timestamps on the actual shared device. No production import.
export function installAshPassTimer(device){
 if(!device.features.has('timestamp-query'))throw Error('Shared device lacks timestamp-query');
 const original=device.createCommandEncoder;let active=null;
 device.createCommandEncoder=function(...args){
  const encoder=original.apply(this,args);
  for(const [method,kind] of [['beginComputePass','compute'],['beginRenderPass','render']]){
   const begin=encoder[method];encoder[method]=function(descriptor={}){
    if(!active)return begin.call(this,descriptor);
    if(descriptor.timestampWrites)throw Error('Conflicting timestamp instrumentation');
    const querySet=device.createQuerySet({type:'timestamp',count:2});
    active.push({querySet,kind,label:descriptor.label??'',colorAttachments:descriptor.colorAttachments?.filter(Boolean).length??null});
    return begin.call(this,{...descriptor,timestampWrites:{querySet,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}});
   };
  }
  return encoder;
 };
 return {async measure(action){
  if(active)throw Error('Nested timestamp collection');await device.queue.onSubmittedWorkDone();
  const passes=[];let resolved,read;active=passes;const start=performance.now();let submittedMs;
  try{
   await action();submittedMs=performance.now()-start;active=null;
   if(!passes.length)throw Error('Action submitted no GPU passes');
   resolved=device.createBuffer({size:passes.length*256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});read=device.createBuffer({size:passes.length*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const encoder=original.call(device);passes.forEach((p,i)=>encoder.resolveQuerySet(p.querySet,0,2,resolved,i*256));encoder.copyBufferToBuffer(resolved,0,read,0,passes.length*256);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const data=read.getMappedRange();return {submittedMs,passes:passes.map((p,i)=>{const t=new BigUint64Array(data,i*256,2);if(t[0]<=0n||t[1]<t[0])throw Error('Invalid GPU pass interval');return {kind:p.kind,label:p.label,colorAttachments:p.colorAttachments,timestamps:Array.from(t,String),ms:Number(t[1]-t[0])/1e6};})};
  }finally{active=null;read?.unmap();read?.destroy();resolved?.destroy();for(const p of passes)p.querySet.destroy();}
 },dispose(){device.createCommandEncoder=original;}};
}
