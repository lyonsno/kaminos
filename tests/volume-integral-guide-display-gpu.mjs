// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createIntegralReconstruction} from '../volume-integral-reconstruction.mjs';
test('guide inspection is source-bound, distinguishes optical components, and preserves held reconstruction',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const n=11,h=createIntegralReconstruction(d),camera=new Float32Array(20),target=d.createTexture({size:[n,n],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const c={integralReconstruction:'spatial',reconstructionSpatial:1,reconstructionRadius:2,reconstructionEdges:'off'};
  const read=async()=>{const b=d.createBuffer({size:256*n,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:target},{buffer:b,bytesPerRow:256},[n,n]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);return Array.from(new Uint8Array(b.getMappedRange()).slice(5*256+5*4,5*256+5*4+4));}finally{b.unmap();b.destroy();}};
  try{
   assert.equal(typeof h.setGuideDisplay,'function','the operator needs an actual guide-display operation');
   h.prepare(n,n,c,'guide-fixture',4);const pixels=new Float32Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++)pixels.set(x<5?[0,0,0,1]:[4,4,4,1],(y*n+x)*4);
   d.queue.writeTexture({texture:h.raw},pixels,{bytesPerRow:n*16},[n,n]);d.queue.writeTexture({texture:h.guide},new Float32Array(n*n).fill(10),{bytesPerRow:n*4},[n,n]);
   let e=d.createCommandEncoder();h.encode(e,target.createView(),'rgba8unorm',camera);d.queue.submit([e.finish()]);const before=await h.sample(),beautyPixel=await read();assert.equal((await h.sampleGuides()).available,false);h.beginEvaluation();
   assert.throws(()=>h.setGuideDisplay({view:'unknown'}));assert.throws(()=>h.setGuideDisplay({gain:0}));
   const views={};for(const view of ['light','opacity','image-rejection','depth-rejection','beauty']){h.setGuideDisplay({view,gain:1});e=d.createCommandEncoder();h.encodeEvaluation(e,target.createView(),'rgba8unorm',camera,c);d.queue.submit([e.finish()]);views[view]=await read();const sample=await h.sample();assert.deepEqual(sample.raw,before.raw);assert.deepEqual(sample.filtered,before.filtered);assert.equal(sample.state.frames,1);}
   assert.deepEqual(views.beauty,beautyPixel,'diagnostic presentation must restore the original beauty bytes');assert.ok(views.light[0]>50);assert.deepEqual(views.opacity.slice(0,3),[0,0,0]);assert.ok(views['image-rejection'][0]>10);assert.deepEqual(views['depth-rejection'].slice(0,3),[0,0,0]);
   const guides=await h.sampleGuides();assert.equal(guides.available,true);assert.equal(guides.width,6);assert.equal(guides.height,6);assert.equal(guides.depth.length,n*n);assert.equal(guides.gradients.length,6*6*4);assert.ok(guides.gradients.some(x=>x>.2));
   h.endEvaluation();h.prepare(n,n,c,'guide-fixture',5);e=d.createCommandEncoder();h.encode(e,target.createView(),'rgba8unorm',camera);d.queue.submit([e.finish()]);assert.equal((await h.sampleGuides()).available,false,'the previous raw epoch guide is stale after a new beauty-only draw');
   h.reset('new-source');assert.equal((await h.sampleGuides()).available,false,'old guide cannot masquerade as current after reset');
  }finally{h.dispose();target.destroy();}
 });
});
