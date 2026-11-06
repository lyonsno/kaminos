// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createIntegralEdgeGuide} from '../volume-integral-edge-guide.mjs';

test('image edge guide rejects pixel checkerboard gradients and retains coherent light and smoke contours',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const size=11,raw=d.createTexture({size:[size,size],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const depth=d.createTexture({size:[size,size],format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const g=createIntegralEdgeGuide(d);
  async function draw(pixel,depthAt=()=>10){
   const values=new Float32Array(size*size*4),depths=new Float32Array(size*size);
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){values.set(pixel(x,y),(y*size+x)*4);depths[y*size+x]=depthAt(x,y);}
   d.queue.writeTexture({texture:raw},values,{bytesPerRow:size*16},[size,size]);d.queue.writeTexture({texture:depth},depths,{bytesPerRow:size*4},[size,size]);
   const e=d.createCommandEncoder();g.encode(e,raw,depth);const width=g.texture.width,height=g.texture.height;const row=256,b=d.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyTextureToBuffer({texture:g.texture},{buffer:b,bytesPerRow:row},[width,height]);d.queue.submit([e.finish()]);
   try{await b.mapAsync(GPUMapMode.READ);return Array.from(new Float16Array(b.getMappedRange()).slice(2*128+2*4,2*128+2*4+4));}finally{b.unmap();b.destroy();}
  }
  try{
   const step=await draw((x,y)=>x<5?[0,0,0,1]:[4,4,4,1]);assert.ok(step[0]>.2,JSON.stringify(step));assert.ok(Math.abs(step[1])<1e-6);assert.ok(Math.abs(step[2])+Math.abs(step[3])<1e-6);
   const noise=await draw((x,y)=>(x+y)%2?[4,4,4,.5]:[0,0,0,.5]);assert.ok(noise.every(x=>Math.abs(x)<1e-6),'alternating sampling noise has no coherent edge');
   const smoke=await draw((x,y)=>[0,0,0,y<5?1:.25]);assert.ok(smoke[3]>.1);assert.ok(Math.abs(smoke[2])<1e-6);
   const boundary=await draw(()=>[4,4,4,.5],x=>x<5?3:10);assert.ok(boundary.every(x=>Math.abs(x)<1e-6),'opaque depth masking must not invent a gradient in constant light');
   assert.deepEqual(await draw(()=>[0,0,0,1]),[0,0,0,0]);
  }finally{g.dispose();raw.destroy();depth.destroy();}
 });
});
