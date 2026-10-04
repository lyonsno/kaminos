// Runs in an owned browser on its observed native WebGPU adapter.
export async function checkSurfaceGPU() {
  const {surfaceGraph,reconstructSurfaceCPU,createSurfaceReconstruction}=await import('/scene-surface-reconstruction.mjs');
  const adapter=await navigator.gpu.requestAdapter();
  const device=await adapter.requestDevice();const errors=[];
  device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const receivers=Array.from({length:7},(_,i)=>({normal:i===6?[0,0,-1]:[0,0,1]}));
  const graph=surfaceGraph(receivers,[0,1,2,3,4,5,0,1,6]);
  const textures=[0,1].map(()=>device.createTexture({size:[8,1],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST}));
  const filter=createSurfaceReconstruction(device,{graph,front:textures[0],back:textures[1],dimensions:[8,1]});
  const read=device.createBuffer({size:512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const frames=[];
  try {
    for(const [name,scale] of [['lit',1],['black',0],['relit',2]]) {
      const front=new Float32Array(32),back=new Float32Array(32);
      front.set([12*scale,6*scale,3*scale,1]);back.set([0,3*scale,9*scale,1],12);
      for(const [i,data] of [front,back].entries())device.queue.writeTexture({texture:textures[i]},data,{bytesPerRow:128},[8,1]);
      const encoder=device.createCommandEncoder();filter.encode(encoder,8);
      for(let i=0;i<2;i++)encoder.copyTextureToBuffer({texture:textures[i]},{buffer:read,offset:i*256,bytesPerRow:256},[8,1]);
      device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
      const raw=new Float32Array(read.getMappedRange()),actual=[Array.from(raw.slice(0,28)),Array.from(raw.slice(64,92))];read.unmap();
      const expected=[front,back].map(v=>Array.from(reconstructSurfaceCPU(v.subarray(0,28),graph,8)));
      let maxError=0;
      for(let side=0;side<2;side++)for(let i=0;i<28;i++)maxError=Math.max(maxError,Math.abs(actual[side][i]-expected[side][i]));
      if(maxError>1e-5)throw new Error('GPU surface reconstruction differs from CPU oracle: '+maxError);
      if(name==='black'&&actual.some(a=>a.some((v,i)=>i%4!==3&&v!==0)))throw new Error('GPU retained previous-frame light');
      frames.push({name,actual,expected,maxError});
    }
    await device.queue.onSubmittedWorkDone();
    if(errors.length)throw new Error(errors.join('\n'));
    return {status:'passed',adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,isFallbackAdapter:adapter.isFallbackAdapter},frames};
  } finally {filter.destroy();read.destroy();textures.forEach(t=>t.destroy());device.destroy();}
}

export async function measureSurfaceGPU({device,graph,front,back,dimensions}) {
  if(!device.features.has('timestamp-query'))return {status:'unsupported',reason:'effective device has no timestamp-query'};
  const {createSurfaceReconstruction}=await import('/scene-surface-reconstruction.mjs');
  const textures=[0,1].map(()=>device.createTexture({size:dimensions,format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}));
  const filter=createSurfaceReconstruction(device,{graph,front:textures[0],back:textures[1],dimensions});
  const queries=device.createQuerySet({type:'timestamp',count:2});
  const resolve=device.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
  const read=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const result={status:'measured',scope:'isolated reconstruction dispatch span on actual authored receiver graph; excludes gather and rendering',vertices:graph.count,edges:graph.neighbors.length,samples:[]};
  try {
    for(const passes of [0,8,32])for(let repeat=0;repeat<8;repeat++) {
      const encoder=device.createCommandEncoder();
      for(const [i,source] of [front,back].entries())encoder.copyTextureToTexture({texture:source},{texture:textures[i]},dimensions);
      encoder.beginComputePass({timestampWrites:{querySet:queries,beginningOfPassWriteIndex:0}}).end();
      filter.encode(encoder,passes);
      encoder.beginComputePass({timestampWrites:{querySet:queries,endOfPassWriteIndex:1}}).end();
      encoder.resolveQuerySet(queries,0,2,resolve,0);encoder.copyBufferToBuffer(resolve,0,read,0,16);
      device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
      const times=new BigUint64Array(read.getMappedRange());const ms=Number(times[1]-times[0])/1e6;read.unmap();
      if(!Number.isFinite(ms)||ms<0)throw new Error('invalid GPU timestamp span');
      result.samples.push({passes,repeat,ms});
    }
    return result;
  }finally{filter.destroy();textures.forEach(t=>t.destroy());queries.destroy();resolve.destroy();read.destroy();}
}
