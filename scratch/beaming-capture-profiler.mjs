// Owned-browser instrumentation only. Production does not import this module.
export function installCaptureProfiler(device) {
  if(globalThis.__captureProfile)return;
  const p=globalThis.__captureProfile={device,active:null,scope:'other',pending:[],
    measure(scope,fn){const previous=p.scope;p.scope=scope;const start=performance.now();try{return fn();}finally{p.active?.cpu.push({scope,ms:performance.now()-start});p.scope=previous;}}};
  const create=device.createCommandEncoder.bind(device),submit=device.queue.submit.bind(device.queue),commands=new WeakMap();
  device.createCommandEncoder=descriptor=>{
    const encoder=create(descriptor),request=p.active;
    if(!request?.timestamps)return encoder;
    if(!device.features.has('timestamp-query'))throw Error('capture profiler requires timestamp-query');
    const rows=[];
    for(const method of ['beginRenderPass','beginComputePass']){
      const begin=encoder[method].bind(encoder);
      encoder[method]=spec=>{
        if(spec.timestampWrites)throw Error('capture profiler conflicts with existing timestamps');
        const query=device.createQuerySet({type:'timestamp',count:2});
        rows.push({query,scope:p.scope,kind:method,label:spec.label??descriptor?.label??null});
        return begin({...spec,timestampWrites:{querySet:query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}});
      };
    }
    const finish=encoder.finish.bind(encoder);
    encoder.finish=spec=>{
      for(const row of rows){
        row.resolve=device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
        row.read=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        encoder.resolveQuerySet(row.query,0,2,row.resolve,0);encoder.copyBufferToBuffer(row.resolve,0,row.read,0,16);
      }
      const command=finish(spec);commands.set(command,{request,rows});return command;
    };return encoder;
  };
  device.queue.submit=list=>{
    const all=Array.from(list);if(p.active)p.active.submits++;
    submit(all);
    for(const command of all){const item=commands.get(command);if(!item)continue;commands.delete(command);
      for(const row of item.rows)p.pending.push(row.read.mapAsync(GPUMapMode.READ).then(()=>{
        const times=Array.from(new BigUint64Array(row.read.getMappedRange()));
        const record={scope:row.scope,kind:row.kind,label:row.label,raw:times.map(String)};
        item.request.gpu.push(record);
        if(times[0]===0n||times[1]<times[0])throw Error('invalid GPU timestamp pair');
        record.ms=Number(times[1]-times[0])/1e6;
      }).catch(error=>item.request.errors.push(error.message)).finally(()=>{row.read.destroy();row.resolve.destroy();row.query.destroy();}));
    }
  };
}

export function validateCaptureProfile(row) {
  const fail=message=>{throw Error(message);};
  if(row.backend!=='WebGPU:apple')fail('wrong backend');
  if(row.errors.length)fail('profile errors');
  if(row.frames.length!==row.requestedFrames)fail('partial profile');
  for(const frame of row.frames){
    if(!frame.current||frame.points!==row.points||frame.quality.resolution!==36||frame.quality.blockerSamples!==4||frame.quality.filterSamples!==2)fail('wrong effective configuration');
    if(frame.cpu.filter(x=>x.scope==='shadow').length!==row.points)fail('missing current captures');
    if(frame.timestamps){
      const captures=frame.gpu.filter(x=>x.scope==='cube'&&x.kind==='beginRenderPass');
      if(captures.length!==6*row.points)fail('missing face timestamps');
      if(frame.gpu.some(x=>!Number.isFinite(x.ms)||x.ms<0))fail('invalid timing');
      if(!frame.gpu.some(x=>x.scope==='other'&&x.kind==='beginRenderPass'))fail('missing receiver render');
    }
  }
  return row;
}
