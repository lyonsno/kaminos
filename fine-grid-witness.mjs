// Deterministic production transfer kernels; arrays retained for independent replay.
import {fineGridPlan,createFineVelocityGrid} from './volume-fine-grid.mjs';
export async function probeFineGrid(){
 const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('Native WebGPU unavailable');
 const device=await adapter.requestDevice(),owned=[],errors=[];
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 let owner;
 try{
  const dims=[8,16,8],n=8*16*8;
  const buffer=(size)=>{const b=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
  const texture=(format,size=dims,dimension='3d')=>{const t=device.createTexture({size,dimension,format,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});owned.push(t);return t;};
  const f={fluid:buffer(n*64),prior:buffer(n*64),front:buffer(n*4),quench:buffer((n+5)*4),solid:texture('r32uint'),reactant:texture('rg32float'),burn:texture('r32float'),lower:texture('r32float',[16,16,3],'2d')};
  const data=new Float32Array(n*16);for(let i=0;i<n;i++){data.set([4,8,12],i*16);data[i*16+4]=1;}
  device.queue.writeBuffer(f.fluid,0,data);
  owner=createFineVelocityGrid(device,fineGridPlan({materialDims:dims,velocity:4,pressure:2}),16);owner.prepare(f);
  const execute=async(kind,source,size)=>{
   const read=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});owned.push(read);
   const e=device.createCommandEncoder();owner.encode(e,kind);e.copyBufferToBuffer(source,0,read,0,size);device.queue.submit([e.finish()]);
   await read.mapAsync(GPUMapMode.READ);const a=Array.from(new Float32Array(read.getMappedRange()));read.unmap();return a;
  };
  const coarse=owner.fluid[owner.current],bytes=4*8*4*64;
  const seed=await execute('restrictScalars',coarse,bytes);
  for(let i=0;i<n;i++)data.set([100,100,100],i*16);
  device.queue.writeBuffer(f.fluid,0,data);
  const preserved=await execute('restrictScalars',coarse,bytes);
  device.queue.writeBuffer(f.prior,0,data);
  for(let i=0;i<n;i++)data.set([104,106,108],i*16);
  device.queue.writeBuffer(f.fluid,0,data);
  const injected=await execute('injectMomentum',coarse,bytes);
  for(let i=0;i<n;i++)data[i*16+4]=3;
  device.queue.writeBuffer(f.fluid,0,data);
  const prolonged=await execute('prolongVelocity',f.fluid,n*64);
  await device.queue.onSubmittedWorkDone();
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},dims,velocityDims:owner.plan.velocityDims,seed,preserved,injected,prolonged,errors};
 }finally{owner?.destroy();owned.forEach(x=>x.destroy());device.destroy();}
}
