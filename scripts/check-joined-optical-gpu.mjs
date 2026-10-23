import assert from 'node:assert/strict';

export async function checkJoinedOpticalGpu(page,retain=async()=>{}) {
 const rows=await page.evaluate(async()=>{
  const {OPTICAL_STEPPING_WGSL}=await import('/volume-optical-native.mjs');
  const {WORLD_SMOKE_OPTICS_WGSL}=await import('/volume-world-smoke-optics.mjs');
  const functions=WORLD_SMOKE_OPTICS_WGSL.slice(WORLD_SMOKE_OPTICS_WGSL.indexOf('fn joinedOpticalRegion('),WORLD_SMOKE_OPTICS_WGSL.indexOf('fn worldSmokeOn('));
  const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
  try{
   const module=device.createShaderModule({code:OPTICAL_STEPPING_WGSL+functions+`
    @group(0) @binding(0) var<storage,read_write> result:array<vec4<f32>>;
    @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3<u32>){
     let phase=select(-1.0,.731,id.x%2u==1u);
     let span=select(12.0,.000001,id.x>=2u);
     var s=opticalStepInitPhased(5.0,5.0+span,.5*span/12.0,phase);
     let fine=vec2<f32>(.25,.75)*s.end;
     let inner=vec2<f32>(.27,.73)*s.end;
     var violations=0u;var count=0u;
     loop{
      if(s.cursor>=s.end){break;}
      joinedOpticalConstrain(&s,fine,inner,.5*s.end/12.0,2.0*s.end/12.0,.02*s.end);
      let region=joinedOpticalRegion(s.cursor,s.end,fine,inner,.5*s.end/12.0,2.0*s.end/12.0,.02*s.end);
      if(s.cursor+s.width>region.x+1e-6*s.end){violations++;}
      opticalStepObserve(&s,vec4<f32>(2.0,-.5,0.0,.03));count++;
     }
     result[id.x*2u]=s.transfer;
     result[id.x*2u+1u]=vec4<f32>(s.cursor,s.end,f32(violations),f32(count));
    }`});
   const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
   if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));
   const rows=[];
   for(const mode of [1,2,3]){
    device.pushErrorScope('validation');
    const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main',constants:{OPTICAL_STEP_MODE:mode}}});
    const buffer=device.createBuffer({size:128,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const read=device.createBuffer({size:128,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
     const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
     pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}));
     pass.dispatchWorkgroups(4);pass.end();encoder.copyBufferToBuffer(buffer,0,read,0,128);device.queue.submit([encoder.finish()]);
     await read.mapAsync(GPUMapMode.READ);rows.push({mode,values:Array.from(new Float32Array(read.getMappedRange().slice(0)))});
     read.unmap();
    }finally{read.destroy();buffer.destroy();}
    const error=await device.popErrorScope();if(error)throw Error(error.message);
   }
   return rows;
  }finally{device.destroy();}
 });
 await retain(rows);
 for(const {values} of rows)for(let i=0;i<4;i++){
  const [r,g,,trans,cursor,end,violations,count]=values.slice(i*8,i*8+8);
  const integral=-Math.expm1(-.03*end)/.03;
  assert.ok(Math.abs(r-2*integral)<Math.max(2e-5,end*2e-6),'complete constant emission across grid transitions');
  assert.ok(Math.abs(g+.5*integral)<Math.max(2e-5,end*2e-6),'signed emission');
  assert.ok(Math.abs(trans-Math.exp(-.03*end))<2e-5,'complete extinction');
  assert.equal(cursor,end,'grazing and phased rays reach the end');
  assert.equal(violations,0,'a candidate may not straddle a grid/blend boundary');
  assert.ok(count>0);
 }
 return rows;
}
