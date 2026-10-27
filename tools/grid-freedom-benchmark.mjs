// Native transfer-only GPU cost; compilation, pressure iterations, dynamics,
// rendering and query readback are outside each timestamp interval.
import {createFineVelocityGrid,fineGridPlan} from '../volume-fine-grid.mjs';
import {createPressureTransfer,pressureResolutionPlan} from '../volume-pressure-resolution.mjs';
import {transferWork} from '../volume-grid-transfer.mjs';
export async function benchmarkTransfers(device){
 const results=[];
 for(const kind of ['velocity','pressure'])for(const width of [24,25,36,47,48,49,64]){
  const dims=[48,96,48],n=dims.reduce((a,b)=>a*b,1),owned=[];
  const buffer=(size)=>{const b=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
  const texture=(format,size=dims)=>{const t=device.createTexture({size,dimension:'3d',format,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});owned.push(t);return t;};
  const fluid=buffer(n*64),solid=texture('r32uint'),burn=texture('r32float');
  const lower=device.createTexture({size:[96,96,3],format:'r32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});owned.push(lower);
  const owner=kind==='velocity'?createFineVelocityGrid(device,fineGridPlan({materialDims:dims,velocity:width,pressure:width}),16):createPressureTransfer(device,pressureResolutionPlan({dims,width}));
  if(kind==='velocity')owner.prepare({fluid,prior:buffer(n*64),front:buffer(n*4),quench:buffer((n+5)*4),solid,reactant:texture('rg32float'),burn,lower});
  else owner.prepare({fluid,solidTexture:solid,burnTexture:burn,fineLower:lower,openBoundary:true,openTop:true,nonLegacy:true,maxSpeed:64});
  const kinds=kind==='velocity'?['restrictScalars','restrictBurn','injectMomentum','prolongVelocity']:['restrict','prolong'];
  const query=device.createQuerySet({type:'timestamp',count:2});owned.push(query);
  const resolved=device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(resolved,read);
  const gpuUs=[];
  try{
   for(let repeat=0;repeat<12;repeat++){
    const encoder=device.createCommandEncoder();
    kinds.forEach((k,i)=>owner.encode(encoder,k,i===0||i===kinds.length-1?{querySet:query,...(i===0?{beginningOfPassWriteIndex:0}:{}),...(i===kinds.length-1?{endOfPassWriteIndex:1}:{})}:undefined));
    encoder.resolveQuerySet(query,0,2,resolved,0);encoder.copyBufferToBuffer(resolved,0,read,0,16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
    const [a,b]=new BigUint64Array(read.getMappedRange());read.unmap();if(b<=a)throw Error('native timestamp interval missing');if(repeat>=3)gpuUs.push(Number(b-a)/1000);
   }
   results.push({kind,source:dims,target:[width,width*2,width],passes:kinds,work:transferWork(dims,[width,width*2,width]),gpuUs});
  }finally{owner.destroy();owned.forEach(r=>r.destroy());}
 }
 return results;
}
