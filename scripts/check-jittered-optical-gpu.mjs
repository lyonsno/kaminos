import assert from 'node:assert/strict';

export async function checkJitteredOpticalGpu(page, observed=async()=>{}, source=null) {
  const rows=await page.evaluate(async source=>{
    const code=source??(await import('/volume-optical-native.mjs')).OPTICAL_STEPPING_WGSL;
    // The pre-fix implementation runs too: its regular nodes fail the geometry assertion.
    const position=code.includes('fn opticalStepPositionJittered(')
      ? 'opticalStepPositionJittered(&s,noise)' : 'opticalStepPosition(s)';
    const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
    try {
      const module=device.createShaderModule({code:code+`
        @group(0) @binding(0) var<storage,read_write> output:array<vec4<f32>>;
        @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3<u32>){
          var s=opticalStepInit(0.0,1.0,1.0/6.0);
          var count=0u;var first=0.0;var last=0.0;var quarter=0.0;var middle=0.0;
          var invalid=0.0;var retained=0.0;
          loop {
            if(s.cursor>=s.end){break;}
            let noise=select(0.05,0.95,(count+id.x)%2u==0u);
            let index=opticalStepIndex(s.mask);
            let t=${position};
            if(count==0u){first=t;}if(count==1u){quarter=t;}if(count==2u){middle=t;}last=t;
            if(t<s.cursor || t>s.cursor+s.width+0.000001){invalid=1.0;}
            // Retained samples encode their positions; mismatched reuse breaks the integral.
            var q=vec4<f32>(2.0,-0.5,0.0,0.03);
            if(id.x==1u){q=vec4<f32>(1.0+3.0*t,-t,0.0,0.0);}
            if(id.x==2u){q=vec4<f32>(t*t,0.0,0.0,0.0);}
            opticalStepObserve(&s,q);count++;
            if(s.mask==21u){retained+=1.0;}
          }
          output[id.x*3u]=s.transfer;
          output[id.x*3u+1u]=vec4<f32>(first,last,quarter,middle);
          output[id.x*3u+2u]=vec4<f32>(s.cursor,invalid,f32(count),retained);
        }`});
      const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
      if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));
      const rows=[];
      for(const mode of [1,2,3]){
        device.pushErrorScope('validation');
        const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main',constants:{OPTICAL_STEP_MODE:mode,OPTICAL_STEP_TOLERANCE:0.00001}}});
        const bytes=3*3*16,buffer=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
        const read=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);
        pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}));
        pass.dispatchWorkgroups(3);pass.end();encoder.copyBufferToBuffer(buffer,0,read,0,bytes);device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(read.getMappedRange().slice(0)));
        read.unmap();read.destroy();buffer.destroy();const error=await device.popErrorScope();if(error)throw Error(error.message);
        rows.push({mode,values});
      }
      return rows;
    } finally {device.destroy();}
  },source);
  await observed(rows);
  for(const {mode,values:v} of rows){
    assert.ok(Math.abs(v[6]/v[7]-.5)>.05,'interior quarter node must move within its stratum');
    assert.ok(Math.abs(v[0]-2*(-Math.expm1(-.03)/.03))<1e-5,'constant emission unchanged');
    assert.ok(Math.abs(v[3]-Math.exp(-.03))<1e-5,'constant extinction unchanged');
    assert.ok(Math.abs(v[12]-2.5)<1e-5,'actual nonuniform widths integrate linear source exactly');
    assert.ok(Math.abs(v[13]+.5)<1e-5,'signed linear source retained');
    for(let i=0;i<3;i++){
      assert.equal(v[i*12+4],0,'entry covered');assert.equal(v[i*12+5],1,'exit covered');
      assert.equal(v[i*12+8],1,'no uncovered tail');assert.equal(v[i*12+9],0,'ordered, in-panel nodes');
    }
    if(mode===2){assert.ok(v[35]>0,'curvature must exercise actual refinement/reused probes');
      assert.ok(Math.abs(v[24]-1/3)<.002,'reused samples retain their actual geometric positions');}
  }
  return rows;
}
