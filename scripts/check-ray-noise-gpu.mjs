import assert from 'node:assert/strict';

export async function checkRayNoiseGpu(page, observed=async()=>{}) {
  const result=await page.evaluate(async()=>{
    const {RAY_START_WGSL,createRayStartTexture}=await import('/volume-ray-start.mjs');
    const provenance=await(await fetch('/assets/blue-noise/fast-scalar-temporal.provenance.json')).json();
    const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
    let texture,buffer,read;
    try {
      texture=await createRayStartTexture(device);
      const module=device.createShaderModule({code:RAY_START_WGSL+`
        @group(0) @binding(0) var<storage,read_write> output:array<vec4<f32>>;
        @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3<u32>){
          let points=array<vec2<f32>,3>(vec2<f32>(0.0),vec2<f32>(42.0,73.0),vec2<f32>(127.0));
          let p=points[id.x%3u];let phase=f32(id.x/3u);
          output[id.x]=vec4<f32>(rayNoiseSample(p,phase,0u),rayStartPhaseAtFrame(p,1.0,false,phase),
            rayStartPhaseAtFrame(p,0.0,false,phase),rayStartPhaseAtFrame(p,1.0,true,phase));
        }`});
      const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
      if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));
      device.pushErrorScope('validation');
      const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
      const bytes=32*3*16;buffer=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      read=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);
      pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer}},{binding:25,resource:texture.createView()}]}));
      pass.dispatchWorkgroups(96);pass.end();encoder.copyBufferToBuffer(buffer,0,read,0,bytes);device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(read.getMappedRange().slice(0)));read.unmap();
      const error=await device.popErrorScope();if(error)throw Error(error.message);
      return {values,provenance};
    } finally {texture?.destroy();buffer?.destroy();read?.destroy();device.destroy();}
  });
  await observed(result);
  for(let frame=0;frame<32;frame++)for(let p=0;p<3;p++){
    const offset=(frame*3+p)*4,expected=(result.provenance.frames[frame].reference_red[p]+.5)/256;
    assert.ok(Math.abs(result.values[offset]-expected)<1e-6,'GPU slice matches observed upstream red-channel value');
    assert.equal(result.values[offset],result.values[offset+1],'camera phase uses the same temporal slice');
    assert.equal(result.values[offset+2],.5,'noise off preserves midpoint');
    assert.equal(result.values[offset+3],.5,'full-grid capture ignores noise');
  }
  return result;
}
