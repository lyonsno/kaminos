// Tiny production-kernel conformance. Raw arrays are returned for replay.
export async function probePressureGrids() {
 const {worldSmokePlan,createWorldSmoke}=await import('./volume-world-smoke.mjs');
 const adapter=await navigator.gpu.requestAdapter();
 if(!adapter)throw Error('No native WebGPU adapter');
 const device=await adapter.requestDevice(),errors=[],cases=[];
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 try {
  for(const pressure of [8,4,2]) {
   const resources=[];
   const proxy=new Proxy(device,{get(t,k){
    if(k==='createBuffer')return d=>{const b=t.createBuffer(d);resources.push({label:d.label,buffer:b,size:d.size});return b;};
    const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;
   }});
   const plan=worldSmokePlan({flow:8,material:8,pressure,extent:2});
   const transform={translate:[0,0,0],scale:1},field=createWorldSmoke(proxy,plan,transform);
   const input=new Float32Array(plan.flowCells*4);
   for(let i=0;i<plan.flowCells;i++){input[i*4]=Math.sin(i*.31)*.1;input[i*4+1]=Math.cos(i*.17)*.1;input[i*4+2]=Math.sin(i*.07)*.1;}
   device.queue.writeBuffer(resources.find(x=>x.label==='world smoke flow 0').buffer,0,input);
   const fine=device.createBuffer({size:8*16*8*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
   const reaction=device.createTexture({size:[8,16,8],dimension:'3d',format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING});
   const encoder=device.createCommandEncoder();
   const receipt=field.encode(encoder,{fineBuffer:fine,reactionTexture:reaction,fineDims:[8,16,8],
    fineVelocityMode:'staggered',transform,time:{dtScale:0,backtraceScale:0},buoyancy:0,iterations:12});
   const reads=resources.filter(x=>/^world smoke (flow [01]|pressure [01]|pressure rhs)/.test(x.label)).map(x=>{
    const buffer=device.createBuffer({size:x.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    encoder.copyBufferToBuffer(x.buffer,0,buffer,0,x.size);return {...x,buffer};
   });
   device.queue.submit([encoder.finish()]);
   const arrays={};
   for(const r of reads){await r.buffer.mapAsync(GPUMapMode.READ);arrays[r.label]=Array.from(new Float32Array(r.buffer.getMappedRange()));r.buffer.unmap();r.buffer.destroy();}
   cases.push({plan,receipt,input:Array.from(input),arrays});
   field.destroy();fine.destroy();reaction.destroy();
  }
  await device.queue.onSubmittedWorkDone();
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},cases,errors};
 }finally{device.destroy();}
}
