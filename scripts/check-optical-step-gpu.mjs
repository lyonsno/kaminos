import assert from 'node:assert/strict';

export async function checkOpticalStepGpu(page, onObserved = async () => {}) {
  const observations=await page.evaluate(async()=>{
    const {OPTICAL_STEPPING_WGSL}=await import('/volume-optical-native.mjs');
    const core=await (await fetch('/volume-core.js')).text();
    const boxStart=core.indexOf('fn slabAxis('), boxEnd=core.indexOf('${PHYSICAL_COLOR_WGSL}',boxStart);
    if(boxStart<0||boxEnd<=boxStart)throw Error('native slab/box functions missing');
    const adapter=await navigator.gpu.requestAdapter();
    const device=await adapter.requestDevice();
    const code=OPTICAL_STEPPING_WGSL+core.slice(boxStart,boxEnd)+`
      @group(0) @binding(0) var<storage,read_write> result: array<vec4<f32>>;
      @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3<u32>) {
        var s=opticalStepInit(0.0,1.0,0.125);
        if(id.x>=3u){s=opticalStepInit(5.0,5.00001,(5.00001-5.0)/192.0);}
        if(id.x==4u){s=opticalStepInit(5.0,5.000002,(5.00001-5.0)/192.0);}
        if(id.x==5u){s=opticalStepInit(5.0,5.0,(5.00001-5.0)/192.0);}
        if(id.x==6u){
          let ro=vec3<f32>(-3.0,0.9999997615814209,0.0);
          let hit=boxHit(ro-vec3<f32>(0.0,1.0,0.0),normalize(vec3<f32>(1.0,1.0,0.0)),vec3<f32>(1.0,2.0,1.0));
          s=opticalStepInit(hit.x,hit.y,(hit.y-hit.x)/36.0);
        }
        var count=0u;
        var stalled=0.0;
        loop {
          if(s.cursor>=s.end){break;}
          let t=opticalStepPosition(s);
          var q=vec4<f32>(2.0,-0.5,0.0,0.03);
          if(id.x==1u){q=vec4<f32>(0.0,0.0,0.0,3.0);}
          if(id.x==2u){q=vec4<f32>(exp(-250.0*(t-0.3)*(t-0.3))*8.0,0.0,0.0,0.1);}
          let before=s.cursor;
          let beforeMask=s.mask;
          opticalStepObserve(&s,q);count++;
          if(beforeMask!=0u && s.mask==1u && s.cursor==before && s.cursor<s.end){stalled=1.0;break;}
        }
        result[id.x*2u]=s.transfer;
        result[id.x*2u+1u]=vec4<f32>(f32(count),select(0.0,1.0,s.cursor>=s.end),f32(s.unresolved),stalled);
      }`;
    const module=device.createShaderModule({code});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error').map(m=>m.message);
    if(errors.length)throw Error(errors.join('\n'));
    const output=[];
    try {
      for(const [mode,tolerance] of [[1,0.001],[2,0.001],[2,0.00001],[3,0.001]]) {
        device.pushErrorScope('validation');
        const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main',constants:{OPTICAL_STEP_MODE:mode,OPTICAL_STEP_TOLERANCE:tolerance}}});
        const buffer=device.createBuffer({size:224,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
        const read=device.createBuffer({size:224,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
        const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
        pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}));
        pass.dispatchWorkgroups(7);pass.end();encoder.copyBufferToBuffer(buffer,0,read,0,224);
        device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
        const values=Array.from(new Float32Array(read.getMappedRange().slice(0)));
        const error=await device.popErrorScope();
        read.unmap();read.destroy();buffer.destroy();
        if(error)throw Error(error.message);
        output.push({mode,tolerance,values});
      }
    }finally{device.destroy();}
    return output;
  });
  await onObserved(observations);
  for(const {values} of observations) {
    const f=-Math.expm1(-0.03)/0.03;
    assert.ok(Math.abs(values[0]-2*f)<0.00001,'constant emission integral');
    assert.ok(Math.abs(values[1]+0.5*f)<0.00001,'signed source preserved');
    assert.ok(Math.abs(values[3]-Math.exp(-0.03))<0.00001,'constant extinction');
    assert.ok(Math.abs(values[11]-Math.exp(-3))<0.00001,'nonemitting smoke extinction');
    for(const offset of [0,8,16,24,32,40,48]) {
      assert.equal(values[offset+7],0,'native f32 cursor must advance at grazing entry');
      assert.equal(values[offset+5],1,'full clipped interval, no missing tail');
    }
  }
  assert.ok(observations[1].values[4]<observations[0].values[4],'smooth positive material reduces actual GPU probe count');
  assert.ok(observations[2].values[20]>observations[1].values[20],'tighter numerical tolerance triggers additional actual probes');
  return observations;
}
