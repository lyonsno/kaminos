// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {sampleSourceMaterialPoints,createSourceMaterialSampler} from '../trellis-source-material.mjs';
import {MeshStandardMaterial} from '../lib/three.core.js';
const identity=[1,0,0,0,1,0,0,0,1],close=(a,b)=>assert.ok(Math.abs(a-b)<3e-4,`${a} != ${b}`);
test('native material labels decode sRGB before filtering and use glTF roughness/metalness channels',async()=>{
 await withKaminosGpu(async({device})=>{
  const base=device.createTexture({size:[2,2],format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),mr=device.createTexture({size:[2,2],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  try{
   device.queue.writeTexture({texture:base},Uint8Array.from([128,0,0,128,0,128,0,64,0,0,128,32,255,255,255,0]),{bytesPerRow:8},[2,2]);
   device.queue.writeTexture({texture:mr},Uint8Array.from([255,64,192,255,255,128,64,255,255,192,128,255,255,255,0,255]),{bytesPerRow:8},[2,2]);
   const sampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'}),map=texture=>({texture,sampler,transform:identity}),binding={color:[.5,.75,1,1],roughness:.5,metalness:.8,base:map(base),rough:map(mr),metal:map(mr)};
   const r=await sampleSourceMaterialPoints(device,binding,[[.25,.25],[.5,.5],[1.25,.25]]),linear=((128/255+.055)/1.055)**2.4;
   close(r[0].linearBaseColor[0],linear*.5);close(r[0].linearBaseColor[1],0);close(r[0].roughness,64/255*.5);close(r[0].metalness,192/255*.8);assert.equal(r[0].opacity,1,'OPAQUE must ignore stored texture alpha');close(r[0].rawTextureFactorAlpha,128/255);
   close(r[1].linearBaseColor[0],(linear+1)/4*.5);close(r[1].linearBaseColor[1],(linear+1)/4*.75);close(r[1].linearBaseColor[2],(linear+1)/4);assert.deepEqual(r[0],r[2]);
   binding.base={...binding.base,transform:[1,0,0,0,1,0,.5,0,1]};const shifted=await sampleSourceMaterialPoints(device,binding,[[.25,.25]]);close(shifted[0].linearBaseColor[1],linear*.75);close(shifted[0].linearBaseColor[0],0);
   await assert.rejects(sampleSourceMaterialPoints(device,binding,[[NaN,0]]),/finite/);
  }finally{base.destroy();mr.destroy();}
 });
});
test('factor-only source adapter preserves physical factors and rejects unsupported channels or stale use',async()=>{
 await withKaminosGpu(async({device})=>{
  const renderer={backend:{device,isWebGPUBackend:true}},material=new MeshStandardMaterial({color:0xffffff,roughness:.35,metalness:.6}),sampler=createSourceMaterialSampler(renderer,material);
  try{const [r]=await sampler.sample([[.2,.3]]);assert.deepEqual(r.linearBaseColor,[1,1,1]);close(r.roughness,.35);close(r.metalness,.6);material.normalMap={};await assert.rejects(sampler.sample([[.2,.3]]),/additional material channels/);material.normalMap=null;}
  finally{sampler.dispose();material.dispose();}await assert.rejects(sampler.sample([[0,0]]),/disposed/);
 });
});
