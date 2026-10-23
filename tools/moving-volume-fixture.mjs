import {createMovingVolumeGpu} from '../moving-volume-gpu.mjs';
import {shiftedCellIndex} from '../moving-volume.mjs';
import * as THREE from '../lib/three.webgpu.js';
import {createMaterialMotionGpu} from '../material-motion-gpu.mjs';

export async function runMovingVolumeConformance(){
 const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw Error('Native GPU adapter required');
 const device=await adapter.requestDevice(),owned=[];const dims=[4,3,4],n=48;
 const buffer=(size)=>{const b=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
 const texture=()=>{const t=device.createTexture({size:dims,dimension:'3d',format:'rg32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});owned.push(t);return t;};
 const read=async b=>{const s=device.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,s,0,b.size);device.queue.submit([e.finish()]);await s.mapAsync(GPUMapMode.READ);return Array.from(new Uint32Array(s.getMappedRange()));}finally{s.unmap();s.destroy();}};
 const rows=[];let gpu;
 try{
  gpu=await createMovingVolumeGpu(device);
  for(const shift of [[1,0,0],[-1,1,0],[0,0,-1],[9,0,0]]){
   const fluid=[buffer(n*64),buffer(n*64)],front=[buffer(n*4),buffer(n*4)],quench=[buffer(n*4+16),buffer(n*4+16)],reactant=[texture(),texture()];
   const f=Float32Array.from({length:n*16},(_,i)=>i+.25),a=Float32Array.from({length:n},(_,i)=>i+.5),q=Uint32Array.from({length:n+4},(_,i)=>i+11);
   const r=Float32Array.from({length:n*2},(_,i)=>i+.75);
   device.queue.writeBuffer(fluid[0],0,f);device.queue.writeBuffer(front[0],0,a);device.queue.writeBuffer(quench[0],0,q);
   device.queue.writeTexture({texture:reactant[0]},r,{bytesPerRow:32,rowsPerImage:3},dims);
   const e=device.createCommandEncoder();gpu.encode(e,{dimensions:dims,shift,fluid,front,quench,reactant,reactantFull:true,ambientOxidizer:1});device.queue.submit([e.finish()]);
   const staging=device.createBuffer({size:256*dims[1]*dims[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   let rr=[];try{const copy=device.createCommandEncoder();copy.copyTextureToBuffer({texture:reactant[1]},{buffer:staging,bytesPerRow:256,rowsPerImage:dims[1]},dims);device.queue.submit([copy.finish()]);await staging.mapAsync(GPUMapMode.READ);const data=new Float32Array(staging.getMappedRange());for(let z=0;z<4;z++)for(let y=0;y<3;y++)rr.push(...data.slice((z*3+y)*64,(z*3+y)*64+8));}finally{staging.unmap();staging.destroy();}
   const actual={fluid:await read(fluid[1]),front:await read(front[1]),quench:await read(quench[1]),reactant:rr};
   const expectedF=new Float32Array(n*16),expectedA=new Float32Array(n),expectedQ=q.slice(),expectedR=new Float32Array(n*2);
   for(let z=0;z<4;z++)for(let y=0;y<3;y++)for(let x=0;x<4;x++){
    const i=x+4*(y+3*z),j=shiftedCellIndex([x,y,z],shift,dims);
    if(j!==null){expectedF.set(f.subarray(j*16,j*16+16),i*16);expectedA[i]=a[j];expectedQ[i]=q[j];expectedR.set(r.subarray(j*2,j*2+2),i*2);}else{expectedQ[i]=0;expectedR[i*2]=1;}
   }
   const expected={fluid:Array.from(new Uint32Array(expectedF.buffer)),front:Array.from(new Uint32Array(expectedA.buffer)),quench:Array.from(expectedQ),reactant:Array.from(expectedR)};
   for(const key of Object.keys(expected))if(JSON.stringify(actual[key])!==JSON.stringify(expected[key]))throw Error('Retained remap mismatch '+key+' '+shift);
   rows.push({shift,actual,expected});
  }
  const coordinateRows=[];
  for(const parity of [0,1])for(const shift of [[1,0,0],[-1,1,0]]){
   const phase=parity===0?13:17,shape=[dims[0],dims[1],dims[2]*2];
   const coordinates=[0,1].map(()=>{const t=device.createTexture({size:shape,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});owned.push(t);return t;});
   const source=new Float32Array(n*2*4);
   for(let coordinateSet=0;coordinateSet<2;coordinateSet++)for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
    const i=(x+dims[0]*(y+dims[1]*(z+coordinateSet*dims[2])))*4;
    source.set([x+.5+coordinateSet*100,y+.5,z+.5,phase],i);
   }
   device.queue.writeTexture({texture:coordinates[parity]},source,{bytesPerRow:dims[0]*16,rowsPerImage:dims[1]},shape);
   const fluid=[buffer(n*64),buffer(n*64)],front=[buffer(n*4),buffer(n*4)],quench=[buffer(n*4),buffer(n*4)],reactant=[texture(),texture()];
   const e=device.createCommandEncoder();gpu.encode(e,{dimensions:dims,shift,fluid,front,quench,reactant,reactantFull:false,ambientOxidizer:1,coordinates:[coordinates[parity],coordinates[1-parity]],coordinatesFull:true});device.queue.submit([e.finish()]);
   const staging=device.createBuffer({size:256*shape[1]*shape[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   let actual=[];
   try{
    const copy=device.createCommandEncoder();copy.copyTextureToBuffer({texture:coordinates[1-parity]},{buffer:staging,bytesPerRow:256,rowsPerImage:shape[1]},shape);device.queue.submit([copy.finish()]);await staging.mapAsync(GPUMapMode.READ);
    const padded=new Float32Array(staging.getMappedRange());for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)actual.push(...padded.slice((z*shape[1]+y)*64,(z*shape[1]+y)*64+shape[0]*4));
   }finally{staging.unmap();staging.destroy();}
   const expected=[];
   for(let coordinateSet=0;coordinateSet<2;coordinateSet++)for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
    const j=shiftedCellIndex([x,y,z],shift,dims);
    if(j!==null)expected.push(...source.subarray((j+coordinateSet*n)*4,(j+coordinateSet*n)*4+4));
    else expected.push(x+shift[0]+.5,y+shift[1]+.5,z+shift[2]+.5,phase);
   }
   if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Retained coordinate remap mismatch '+parity+' '+shift);
   coordinateRows.push({parity,shift,phase,actual,expected});
  }
  const object=new THREE.Object3D(),motion=await createMaterialMotionGpu({renderer:{backend:{device}},object});
  const fluid=buffer(n*64),gas=texture(),gasValues=new Float32Array(n*2);for(let i=0;i<n;i++)gasValues[i*2]=1;
  device.queue.writeTexture({texture:gas},gasValues,{bytesPerRow:32,rowsPerImage:3},dims);
  object.position.x=.1;
  const e=device.createCommandEncoder();motion.encode(e,{fluid,dimensions:dims,transform:{translate:[0,0,0],scale:1},backtraceScale:3.1,dt:1/60},{descriptor:{texture:gas}});device.queue.submit([e.finish()]);
  const actualMotion=new Float32Array(Uint32Array.from(await read(fluid)).buffer),expectedVelocity=.1*2/3.1*(1-Math.exp(-1));
  for(let i=0;i<n;i++)if(Math.abs(actualMotion[i*16]-expectedVelocity)>1e-6||actualMotion[i*16+1]!==0||actualMotion[i*16+2]!==0)throw Error('Emitted motion does not follow material displacement');
  motion.dispose();
  return {backend:'WebGPU',adapter:adapter.info,dimensions:dims,rows,coordinateRows,motion:{actual:Array.from(actualMotion),expectedVelocity},status:'passed'};
 }finally{gpu?.dispose();for(const x of owned)x.destroy();device.destroy();}
}
