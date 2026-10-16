import {FUSE_SAMPLES,FUSE_EVOLUTION_WGSL,coldFuse,stepFuse} from '../fuse-core.mjs';

export async function runFuseMaterialConformance(){
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No native WebGPU adapter');
  const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const N=FUSE_SAMPLES,dt=1/60,spacing=.01,steps=1800;
  const code=`${FUSE_EVOLUTION_WGSL}
  @group(0) @binding(0) var<storage,read> before:array<FuseCell>;
  @group(0) @binding(1) var<storage,read_write> after:array<FuseCell>;
  @group(0) @binding(2) var<storage,read> exposure:array<f32>;
  @compute @workgroup_size(64) fn advance(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=${N}u){return;}
  let mean=(before[select(i-1u,i,i==0u)].material.x+before[min(i+1u,${N-1}u)].material.x)*.5;
  after[i]=evolveFuse(before[i],exposure[i],mean,${dt},${spacing});}`;
  const owned=[],rows=[];
  const buffer=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
  try{
    const module=device.createShaderModule({code});const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(info.messages));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'advance'}});
    const pair=[0,1].map(()=>buffer(N*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC));
    const exposureBuffer=buffer(N*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),staging=buffer(N*32,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    const groups=pair.map((b,i)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:b}},{binding:1,resource:{buffer:pair[1-i]}},{binding:2,resource:{buffer:exposureBuffer}}]}));
    for(const heated of [false,true]){
      let expected=coldFuse(),index=0;const exposure=new Float32Array(N);if(heated)exposure.fill(4,0,3);
      for(const b of pair)device.queue.writeBuffer(b,0,expected);device.queue.writeBuffer(exposureBuffer,0,exposure);
      for(const [start,end] of [[0,90],[90,steps]]){
        if(start===90){exposure.fill(0);device.queue.writeBuffer(exposureBuffer,0,exposure);}
        const e=device.createCommandEncoder();for(let j=start;j<end;j++){
          const p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,groups[index]);p.dispatchWorkgroups(Math.ceil(N/64));p.end();index=1-index;
          expected=stepFuse(expected,exposure,dt,spacing);
        }device.queue.submit([e.finish()]);
      }
      const e=device.createCommandEncoder();e.copyBufferToBuffer(pair[index],0,staging,0,N*32);device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);
      const actual=Array.from(new Float32Array(staging.getMappedRange()));staging.unmap();
      rows.push({name:heated?'finite-end-heat':'unlit-control',steps,dt,spacing,expected:Array.from(expected),actual});
    }
    await device.queue.onSubmittedWorkDone();return {backend:'WebGPU',samples:N,rows,errors};
  }finally{for(const b of owned)b.destroy();device.destroy();}
}
