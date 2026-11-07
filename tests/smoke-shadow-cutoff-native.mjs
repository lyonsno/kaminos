// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createFireSmokeShadow} from '../fire-smoke-shadow.mjs';
await withKaminosGpu(async({device})=>{
 const dims=[4,4,4],coefficients=device.createTexture({size:dims,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const points=device.createTexture({size:[1,2],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const staging=device.createBuffer({size:256*33,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const half=x=>{const sign=x>>15?-1:1,e=x>>10&31,m=x&1023;return sign*(e?2**(e-15)*(1+m/1024):2**-14*m/1024);};
 const shadow=createFireSmokeShadow(device,{points,count:1,resolution:1,steps:128});
 const data=new Float32Array(4*4*4*4);for(let i=3;i<data.length;i+=4)data[i]=1000;
 device.queue.writeTexture({texture:coefficients},data,{bytesPerRow:64,rowsPerImage:4},dims);
 device.queue.writeTexture({texture:points},new Float32Array([0,0,0,.01,1,1,1,1]),{bytesPerRow:16,rowsPerImage:2},[1,2]);
 const field={status:'encoded',texture:coefficients,dimensions:dims,generation:1,frame:1};
 try{
  for(const steps of [128,129]){
   const groups=Math.ceil(steps/4),rows=[];shadow.setQuality({steps});
   for(const transmissionCutoff of [0,.001]){
    shadow.setQuality({transmissionCutoff});shadow.encode(field,{generation:1,frame:1,count:1});
    const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:shadow.external.sourceTexture},{buffer:staging,bytesPerRow:256},[6,groups]);device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);const raw=new Uint16Array(staging.getMappedRange()),tau=Array.from({length:groups*4},(_,i)=>half(raw[Math.floor(i/4)*128+i%4]));staging.unmap();rows.push(tau);
   }
   assert(rows[0][steps-1]>900,'reference integrates the complete opaque path');
   assert(rows[1][steps-1]<20,'opaque prefix skips further density integration');
   assert(rows[1].slice(1).every(tau=>tau===rows[1][0]),'every remaining atlas prefix is filled, including non-multiple-of-four padding');
   for(let i=0;i<steps;i++){
    const next=Math.min(i+1,steps-1);
    for(const t of [0,.25,.5,.75,1])assert(Math.abs(Math.exp(-((1-t)*rows[1][i]+t*rows[1][next]))-Math.exp(-((1-t)*rows[0][i]+t*rows[0][next])))<=.001,'bounded visibility difference at prefixes and radial interpolation');
   }
  }
  data.fill(0);device.queue.writeTexture({texture:coefficients},data,{bytesPerRow:64,rowsPerImage:4},dims);field.frame=2;
  shadow.encode(field,{generation:1,frame:2,count:1});const clear=device.createCommandEncoder();clear.copyTextureToBuffer({texture:shadow.external.sourceTexture},{buffer:staging,bytesPerRow:256},[6,33]);device.queue.submit([clear.finish()]);
  await staging.mapAsync(GPUMapMode.READ);const transparent=new Uint16Array(staging.getMappedRange());
  for(let group=0;group<33;group++)for(let i=0;i<24;i++)assert.equal(transparent[group*128+i],0,'next clear source cannot retain opaque prefix or padding values');staging.unmap();
 }finally{shadow.dispose();coefficients.destroy();points.destroy();staging.destroy();}
});
