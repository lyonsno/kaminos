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
