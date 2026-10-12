// Effective Chrome for Testing 153 native query-set limit observed: 4096.
// The rejected 8192 request is retained in the owning native evidence.
// overflowing a sampled frame reports failure, without dropping render work.
const QUERY_COUNT=4096;
export function partitionGpuPassIntervals(passes) {
  const intervals=passes.map(p=>({...p,start:BigInt(p.startNs),end:BigInt(p.endNs)}));
  const edges=[...new Set(intervals.flatMap(p=>[p.start,p.end]))].sort((a,b)=>a<b?-1:a>b?1:0);
  const exclusive={},coverage={};let overlapMs=0,gapMs=0;
  for(let i=1;i<edges.length;i++){
    const start=edges[i-1],end=edges[i],ms=Number(end-start)/1e6;
    const categories=new Set(intervals.filter(p=>p.start<=start && p.end>=end && p.end>p.start).map(p=>p.category));
    for(const category of categories)coverage[category]=(coverage[category]??0)+ms;
    if(categories.size===1){const category=[...categories][0];exclusive[category]=(exclusive[category]??0)+ms;}
    else if(categories.size>1)overlapMs+=ms;else gapMs+=ms;
  }
  return {exclusive,coverage,overlapMs,gapMs};
}
export function createFluidFrameTiming(device) {
  let enabled=false,active=false,pending=false,disposed=false,lastRequest=-Infinity,stage='other';
  let sample=null,failure=null,querySet=null,resolveBuffer=null,readback=null;
  let entries=[],restore=null,invalid=null;
  const read=()=>structuredClone({enabled,available:device.features.has('timestamp-query'),status:failure?'failed':pending?'reading':active?'encoding':enabled?(sample?'measured':'awaiting_frame'):'disabled',failure,sample});
  function setEnabled(value){enabled=Boolean(value);failure=null;return read();}
  function begin(){
    if(!enabled||active||pending||disposed||performance.now()-lastRequest<1000)return false;
    if(!device.features.has('timestamp-query')){failure='This shared GPU device does not support timestamp queries';return false;}
    try{
      querySet??=device.createQuerySet({label:'fluid-budget-timestamps',type:'timestamp',count:QUERY_COUNT});
      resolveBuffer??=device.createBuffer({label:'fluid-budget-resolve',size:QUERY_COUNT*8,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
      readback??=device.createBuffer({label:'fluid-budget-readback',size:QUERY_COUNT*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      entries=[];invalid=null;active=true;stage='other';lastRequest=performance.now();
      const original=device.createCommandEncoder,owned=Object.hasOwn(device,'createCommandEncoder');
      const replacement=function(...args){
        const encoder=original.apply(this,args);
        for(const method of ['beginRenderPass','beginComputePass']){
          const native=encoder[method];
          encoder[method]=function(descriptor={}){
            if(!active)return native.call(this,descriptor);
            if(descriptor.timestampWrites){invalid='Another timestamp owner already instruments this frame';return native.call(this,descriptor);}
            if(entries.length*2+2>QUERY_COUNT){invalid='Frame exceeds the GPU query-set capacity';return native.call(this,descriptor);}
            let category=stage;
            const label=descriptor.label??'';
            if(stage==='water')category=label.includes('particle-depth-optical-thickness')?'accumulation':label.includes('two-interface-optical-slab-composite')?'optical':'other water';
            const index=entries.length*2;entries.push({category,label,kind:method==='beginRenderPass'?'render':'compute',index});
            return native.call(this,{...descriptor,timestampWrites:{querySet,beginningOfPassWriteIndex:index,endOfPassWriteIndex:index+1}});
          };
        }
        return encoder;
      };
      device.createCommandEncoder=replacement;
      restore=()=>{if(device.createCommandEncoder===replacement){if(owned)device.createCommandEncoder=original;else delete device.createCommandEncoder;}else invalid='Timestamp device-hook ownership changed during frame';};
      return true;
    }catch(error){active=false;failure=String(error);restore?.();restore=null;return false;}
  }
  function scope(name,fn){const prior=stage;stage=name;try{return fn();}finally{stage=prior;}}
  function finish(source){
    if(!active)return;
    restore?.();restore=null;active=false;
    if(invalid||!entries.length){failure=invalid??'Frame supplied no timed GPU passes';return;}
    const frameEntries=entries.map(e=>({...e}));const count=frameEntries.length*2;
    const encoder=device.createCommandEncoder({label:'fluid-budget-resolve'});encoder.resolveQuerySet(querySet,0,count,resolveBuffer,0);encoder.copyBufferToBuffer(resolveBuffer,0,readback,0,count*8);device.queue.submit([encoder.finish()]);pending=true;
    readback.mapAsync(GPUMapMode.READ).then(()=>{
      const values=new BigUint64Array(readback.getMappedRange(0,count*8).slice(0));
      const passes=frameEntries.map(e=>{const start=values[e.index],end=values[e.index+1];if(end<start || (start===0n&&end===0n))throw Error('Missing or unordered GPU pass timestamps');return {...e,startNs:String(start),endNs:String(end),ms:Number(end-start)/1e6};});
      const timeline=partitionGpuPassIntervals(passes);
      const first=values.reduce((a,v)=>v<a?v:a,values[0]),last=values.reduce((a,v)=>v>a?v:a,values[0]);
      if(!disposed){sample={...source,stages:timeline.exclusive,stageCoverage:timeline.coverage,overlapMs:timeline.overlapMs,gapMs:timeline.gapMs,passes,passSumMs:passes.reduce((n,p)=>n+p.ms,0),frameSpanMs:Number(last-first)/1e6,measuredAt:performance.now(),unit:'gpu_timestamp_ms',scope:'owned_frame_timestamp_intervals_partitioned_without_overlap_double_count',copies:'inside_span_not_individually_attributed',rayCountInstrumentation:false};failure=null;}
    }).catch(error=>{if(!disposed)failure=String(error);}).finally(()=>{if(readback.mapState==='mapped')readback.unmap();pending=false;});
  }
  function abort(error){restore?.();restore=null;active=false;failure=String(error);}
  return {begin,scope,finish,abort,read,setEnabled,get active(){return active;},destroy(){disposed=true;enabled=false;restore?.();restore=null;active=false;querySet?.destroy();resolveBuffer?.destroy();readback?.destroy();}};
}
