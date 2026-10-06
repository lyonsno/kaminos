// Explicit frozen-state diagnostic only. Never called by the serving step loop.
export async function capturePackedDensityWitness({device,shader,layout,buffers,count,cells,packedLayout,stepCount}) {
  const owned=[];
  const buffer=(label,size,usage)=>{const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
  device.pushErrorScope('validation');
  let scopeOpen=true;
  try {
    const base=buffer('packed-witness-linked-particles',count*64,storage);
    const candidate=buffer('packed-witness-packed-particles',count*64,storage);
    const heads=buffer('packed-witness-cell-heads',packedLayout.headWords*4,storage);
    const links=buffer('packed-witness-links-and-records',packedLayout.particleWords*4,storage);
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
    const moduleFor=enabled=>device.createShaderModule({code:shader.replace(/const packedDensityEnabled: bool = (true|false);/,`const packedDensityEnabled: bool = ${enabled};`)});
    const modules={base:moduleFor(false),candidate:moduleFor(true)};
    const pipeline=async(mode,entryPoint)=>device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:modules[mode],entryPoint}});
    const p={};
    for(const [name,mode,entry] of [['clear','base','clear_grid'],['build','base','build_linked_cell_grid'],['scan','candidate','scan_packed_cell_blocks'],['totals','candidate','scan_packed_block_totals'],['pack','candidate','pack_density_cell_records'],['lambdaBase','base','compute_density_lambda'],['deltaBase','base','solve_position_delta'],['lambdaPacked','candidate','compute_density_lambda'],['deltaPacked','candidate','solve_position_delta']])p[name]=await pipeline(mode,entry);
    const binding=particle=>device.createBindGroup({layout,entries:buffers.map(e=>({binding:e.binding,resource:e.binding===0?{buffer:particle}:e.binding===1?{buffer:heads}:e.binding===2?{buffer:links}:e.resource}))});
    const groups={base:binding(base),candidate:binding(candidate)};
    const readbacks={};
    for(const [name,size] of [['source',count*64],['linkedResult',count*64],['packedResult',count*64],['heads',packedLayout.headWords*4],['records',packedLayout.particleWords*4]])readbacks[name]=buffer('packed-witness-readback-'+name,size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    const encoder=device.createCommandEncoder();
    const source=buffers.find(x=>x.binding===0).resource.buffer;
    for(const dst of [base,candidate,readbacks.source])encoder.copyBufferToBuffer(source,0,dst,0,count*64);
    const pass=encoder.beginComputePass();
    const dispatch=(name,mode,n)=>{pass.setBindGroup(0,groups[mode]);pass.setPipeline(p[name]);pass.dispatchWorkgroups(name==='totals'?1:Math.ceil(n/64));};
    dispatch('clear','base',cells);dispatch('build','base',count);
    dispatch('scan','candidate',cells);dispatch('totals','candidate',1);dispatch('pack','candidate',cells);
    dispatch('lambdaBase','base',count);dispatch('deltaBase','base',count);
    dispatch('lambdaPacked','candidate',count);dispatch('deltaPacked','candidate',count);
    pass.end();
    for(const [name,src] of [['linkedResult',base],['packedResult',candidate],['heads',heads],['records',links]])encoder.copyBufferToBuffer(src,0,readbacks[name],0,readbacks[name].size);
    device.queue.submit([encoder.finish()]);
    await Promise.all(Object.values(readbacks).map(b=>b.mapAsync(GPUMapMode.READ)));
    const validation=await device.popErrorScope();scopeOpen=false;if(validation)throw Error(validation.message);
    const result={schema:'kaminos.packed-density-frozen-witness.v1',stepCount,count,cells,packedLayout,route:'same-native-grid-linked-vs-packed-lambda-delta-scratch-buffers',buffers:{}};
    for(const [name,b] of Object.entries(readbacks)){
      const bytes=new Uint8Array(b.getMappedRange());
      // Bounded string chunks avoid JS argument/rope limits; every byte retained.
      let binary='';for(let start=0;start<bytes.length;start+=16384)binary+=String.fromCharCode(...bytes.subarray(start,start+16384));
      result.buffers[name]=btoa(binary);b.unmap();
    }
    return result;
  } finally {
    if(scopeOpen)await device.popErrorScope();
    for(const b of owned)b.destroy();
  }
}

// Paired microbenchmark of one frozen density iteration. No apply-position stage.
// All compute bindings are copied once; every timed arm writes owned scratch only.
export async function capturePairedDensityWitness({device,shader,layout,buffers,count,cells,packedLayout,stepCount,
  pairs = 64, repetitions = 4, comparison = 'linked-vs-packed', frozenBindings = null, onProgress = () => {}}) {
  if(!Number.isSafeInteger(pairs)||pairs<1||!Number.isSafeInteger(repetitions)||repetitions<1)
    throw new RangeError('paired density pairs/repetitions must be positive safe integers');
  if(!['linked-vs-packed','packed-vs-packed'].includes(comparison))throw new Error('paired density comparison unsupported');
  if(!device?.features?.has('timestamp-query'))throw new Error('paired density requires timestamp-query');
  if(!Array.isArray(buffers)||buffers.length!==12||buffers.some((e,i)=>e.binding!==i||!e.resource?.buffer))
    throw new Error('paired density currently requires the twelve buffer-only synthetic-scene bindings');
  if(!/const packedDensityEnabled: bool = (true|false);/.test(shader))throw new Error('paired density shader selection missing');
  const U=GPUBufferUsage, storage=U.STORAGE|U.COPY_SRC|U.COPY_DST;
  for(const e of buffers)if(!(e.resource.buffer.usage&U.COPY_SRC))throw new Error('paired density binding cannot be frozen: '+e.binding);
  const owned=[];let scope=true;
  const buffer=(label,size,usage)=>{const b=device.createBuffer({label,size,usage});owned.push(b);return b;};
  const encode=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);};
  const read=async b=>{const r=buffer('paired-readback',b.size,U.COPY_DST|U.MAP_READ);const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,b.size);device.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);const data=new Uint8Array(r.getMappedRange().slice(0));r.unmap();return data;};
  device.pushErrorScope('validation');
  try{
    const snapshot=buffers.map(e=>buffer('paired-frozen-binding-'+e.binding,e.resource.buffer.size,
      (e.resource.buffer.usage&U.UNIFORM?U.UNIFORM:U.STORAGE)|U.COPY_SRC|U.COPY_DST));
    if(frozenBindings!==null){
      if(!Array.isArray(frozenBindings)||frozenBindings.length!==12)throw Error('paired density replay requires twelve bindings');
      for(let i=0;i<12;i++){const f=frozenBindings[i];if(f.binding!==i||f.size!==snapshot[i].size||typeof f.bytes!=='string')throw Error('paired density replay binding mismatch');const bytes=Uint8Array.from(atob(f.bytes),c=>c.charCodeAt(0));if(bytes.length!==f.size)throw Error('paired density replay partial bytes');device.queue.writeBuffer(snapshot[i],0,bytes);}
    }else{
      const freeze=device.createCommandEncoder();
      buffers.forEach((e,i)=>freeze.copyBufferToBuffer(e.resource.buffer,0,snapshot[i],0,snapshot[i].size));
      device.queue.submit([freeze.finish()]);
    }
    await device.queue.onSubmittedWorkDone();
    const module=packed=>device.createShaderModule({code:shader.replace(/const packedDensityEnabled: bool = (true|false);/,`const packedDensityEnabled: bool = ${packed};`)});
    const modules={linked:module(false),packed:module(true)};
    const pl=device.createPipelineLayout({bindGroupLayouts:[layout]});
    const pipelines={};
    for(const mode of ['linked','packed'])for(const [name,entry] of [['clear','clear_grid'],['build','build_linked_cell_grid'],['lambda','compute_density_lambda'],['delta','solve_position_delta'],...(mode==='packed'?[['scan','scan_packed_cell_blocks'],['totals','scan_packed_block_totals'],['pack','pack_density_cell_records']]:[])])
      pipelines[mode+':'+name]=await device.createComputePipelineAsync({layout:pl,compute:{module:modules[mode],entryPoint:entry}});
    const group=(particle,heads,links)=>device.createBindGroup({layout,entries:snapshot.map((b,i)=>({binding:i,resource:{buffer:i===0?particle:i===1?heads:i===2?links:b}}))});
    const arms={};
    for(const name of ['A','B']){
      const mode=comparison==='packed-vs-packed'||name==='B'?'packed':'linked';
      const particles=buffer(name+'-particles',count*64,storage), heads=buffer(name+'-heads',packedLayout.headWords*4,storage), links=buffer(name+'-links',packedLayout.particleWords*4,storage);
      arms[name]={mode,particles,heads,links,group:group(particles,heads,links)};
    }
    const dispatch=(pass,arm,name)=>{pass.setBindGroup(0,arm.group);pass.setPipeline(pipelines[(name==='scan'||name==='totals'||name==='pack'?'packed':arm.mode)+':'+name]);pass.dispatchWorkgroups(name==='totals'?1:Math.ceil((['clear','scan','pack'].includes(name)?cells:count)/64));};
    const build=(pass,arm)=>{dispatch(pass,arm,'clear');dispatch(pass,arm,'build');if(arm.mode==='packed'){dispatch(pass,arm,'scan');dispatch(pass,arm,'totals');dispatch(pass,arm,'pack');}};
    const consume=(pass,arm)=>{dispatch(pass,arm,'lambda');dispatch(pass,arm,'delta');};
    const querySet=device.createQuerySet({type:'timestamp',count:4});owned.push(querySet);
    const resolve=buffer('paired-query-resolve',32,U.QUERY_RESOLVE|U.COPY_SRC), map=buffer('paired-query-map',32,U.COPY_DST|U.MAP_READ);
    const result={schema:'kaminos.paired-density-frozen.v1',route:'same-device-frozen-production-density-pairs',stepCount,count,cells,packedLayout,comparison,pairs,repetitions,
      restorationSubmission:'separate-untimed-completion-fenced',armSubmission:'separate-command-buffers-with-completion-fence',snapshotMode:frozenBindings?'retained-replay':'live-copied',frozenBindings:[],series:[],armModes:{A:arms.A.mode,B:arms.B.mode},claimLimit:'One frozen density iteration; close pairing reduces slow drift but does not establish live solver cadence or immunity to contention.'};
    onProgress(result);
    // Caller receives all bindings for replay; serialization/readback is outside timing.
    for(let i=0;i<snapshot.length;i++)result.frozenBindings.push({binding:i,size:snapshot[i].size,bytes:encode(await read(snapshot[i]))});
    for(const kind of ['consumer-only','construction-inclusive']){
      const init=device.createCommandEncoder();
      for(const arm of Object.values(arms)){init.copyBufferToBuffer(snapshot[0],0,arm.particles,0,count*64);const p=init.beginComputePass();build(p,arm);p.end();}
      device.queue.submit([init.finish()]);await device.queue.onSubmittedWorkDone();
      const series={kind,samples:[],validation:[],warmupPairs:2};result.series.push(series);
      for(let index=-2;index<pairs;index++){
        const order=(index%2===0)?['A','B']:['B','A'];
        const preparation=device.createCommandEncoder();for(const name of order)preparation.copyBufferToBuffer(snapshot[0],0,arms[name].particles,0,count*64);device.queue.submit([preparation.finish()]);await device.queue.onSubmittedWorkDone();
        for(let slot=0;slot<2;slot++){
          const e=device.createCommandEncoder();const arm=arms[order[slot]];
          const p=e.beginComputePass(index<0?{}:{timestampWrites:{querySet,beginningOfPassWriteIndex:slot*2,endOfPassWriteIndex:slot*2+1}});
          for(let repeat=0;repeat<repetitions;repeat++){if(kind==='construction-inclusive')build(p,arm);consume(p,arm);}p.end();
          device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
        }
        if(index<0)continue;
        const e=device.createCommandEncoder();e.resolveQuerySet(querySet,0,4,resolve,0);e.copyBufferToBuffer(resolve,0,map,0,32);device.queue.submit([e.finish()]);
        await map.mapAsync(GPUMapMode.READ);const values=Array.from(new BigUint64Array(map.getMappedRange().slice(0)),String);map.unmap();
        series.samples.push({index,order,timestamps:values});onProgress(result);
      }
      // Verify each arm against its opposite traversal on that arm's exact final grid.
      // Separate grid builds may reorder sums, so cross-grid bit identity is not claimed.
      for(const [name,arm] of Object.entries(arms)){
        const ref=buffer(name+'-reference',count*64,storage);const opposite=arm.mode==='linked'?'packed':'linked';
        const refArm={...arm,mode:opposite,particles:ref,group:group(ref,arm.heads,arm.links)};
        const e=device.createCommandEncoder();e.copyBufferToBuffer(snapshot[0],0,ref,0,count*64);const p=e.beginComputePass();
        if(opposite==='packed'){dispatch(p,refArm,'scan');dispatch(p,refArm,'totals');dispatch(p,refArm,'pack');}
        consume(p,refArm);p.end();device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
        const actual=await read(arm.particles), reference=await read(ref);
        series.validation.push({arm:name,witness:{schema:'kaminos.packed-density-frozen-witness.v1',route:'same-native-grid-linked-vs-packed-lambda-delta-scratch-buffers',stepCount,count,cells,packedLayout,
          buffers:{source:result.frozenBindings[0].bytes,linkedResult:encode(arm.mode==='linked'?actual:reference),packedResult:encode(arm.mode==='packed'?actual:reference),heads:encode(await read(arm.heads)),records:encode(await read(arm.links))}}});
      }
    }
    const error=await device.popErrorScope();scope=false;if(error)throw Error('paired density GPU validation: '+error.message);
    return result;
  }finally{if(scope)await device.popErrorScope();for(const x of owned)x.destroy();}
}
