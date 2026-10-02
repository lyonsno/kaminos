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
