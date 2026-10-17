import assert from 'node:assert/strict';

export async function checkPhasedOpticalGpu(page, observed = async () => {}) {
  const rows=await page.evaluate(async()=>{
    const {OPTICAL_STEPPING_WGSL}=await import('/volume-optical-native.mjs');
    const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
    const module=device.createShaderModule({code:OPTICAL_STEPPING_WGSL+`
      @group(0) @binding(0) var<storage,read_write> output:array<vec4<f32>>;
      @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3<u32>){
        let phase=f32(id.x%5u)*0.249;
        var s=opticalStepInitPhased(0.0,1.0,1.0/6.0,phase);
        var count=0u;var first=0.0;var last=0.0;var interior=0.0;
        loop{
          if(s.cursor>=s.end){break;}
          if(id.x>=5u && s.mask<=1u){
            let supported=s.cursor>=0.4 && s.cursor<0.6;
            var stop=1.0-s.cursor;
            if(s.cursor<0.4){stop=0.4-s.cursor;}
            opticalStepConstrain(&s,select(1.0/6.0,1.0/24.0,supported),select(2.0/3.0,1.0/6.0,supported),stop);
          }
          let t=opticalStepPosition(s);
          if(count==0u){first=t;}if(count==1u){interior=t;}last=t;
          opticalStepObserve(&s,vec4<f32>(2.0,-0.5,0.0,0.03));count++;
        }
        output[id.x*3u]=s.transfer;
        output[id.x*3u+1u]=vec4<f32>(first,last,interior,f32(count));
        output[id.x*3u+2u]=vec4<f32>(s.cursor,s.end,f32(s.mask),f32(s.unresolved));
      }`});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));
    const rows=[];
    try{for(const mode of [1,2,3]){
      device.pushErrorScope('validation');
      const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main',constants:{OPTICAL_STEP_MODE:mode}}});
      const bytes=10*3*16,buffer=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const read=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);
      pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}));
      pass.dispatchWorkgroups(10);pass.end();encoder.copyBufferToBuffer(buffer,0,read,0,bytes);device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(read.getMappedRange().slice(0)));
      read.unmap();read.destroy();buffer.destroy();const error=await device.popErrorScope();if(error)throw Error(error.message);
      rows.push({mode,values});
    }}finally{device.destroy();}
    return rows;
  });
  await observed(rows);
  const integral=-Math.expm1(-.03)/.03;
  for(const row of rows)for(let i=0;i<10;i++){
    const q=row.values.slice(i*12,i*12+12);
    assert.ok(Math.abs(q[0]-2*integral)<1e-5,'phasing/constraining preserves constant emission');
    assert.ok(Math.abs(q[1]+.5*integral)<1e-5,'signed source retained');
    assert.ok(Math.abs(q[3]-Math.exp(-.03))<1e-5,'all smoke extinction retained');
    assert.equal(q[4],0,'ray entry is sampled, not shifted away');
    assert.equal(q[5],1,'clipped exit is sampled');assert.equal(q[8],q[9],'cursor reaches full exit');
  }
  for(const row of rows){
    assert.notEqual(row.values[6],row.values[18],'phase changes interior sample placement');
    assert.notEqual(row.values[66],row.values[78],'guidance retains phased interior placement');
  }
  return rows;
}
