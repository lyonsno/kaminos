// kaminos-test: node — a selected photo becomes TRELLIS input in the page: alpha images go straight to the
// alpha preparation, opaque photos go through browser U2Net first; no server step, no Canvas.
import test from 'node:test';import assert from 'node:assert/strict';
import {prepareImageForTrellis} from '../authoring-trellis-page.mjs';

function decoderFor({width,height,alpha}){
  return class{constructor(o){this.o=o;}async decode(){return {complete:true,image:{format:'RGBA',codedWidth:width,codedHeight:height,
    async copyTo(dst){for(let i=0;i<dst.length;i+=4){dst[i]=200;dst[i+1]=100;dst[i+2]=50;dst[i+3]=alpha(i/4);}return [{offset:0,stride:width*4}];},close(){}}};}close(){}};
}
const deps=calls=>({
  prepareTrellisAlphaRgba:async({pixels,width,height})=>{calls.push(['alpha',width,height,pixels[3]]);return {pixels:new Uint8Array(512*512*3),width:512,height:512,provenance:{route:'alpha'}};},
  removeForegroundU2Net:async({pixels,width,height,channels})=>{calls.push(['u2net',width,height,channels]);const rgba=new Uint8Array(pixels.length);rgba.set(pixels);rgba[3]=0;return {rgba,width,height,provenance:{route:'u2net'}};},
  runner:async()=>{calls.push(['runner']);return {run(){}};},
});
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0]);

test('an image with real alpha goes straight to the alpha preparation',async()=>{
  const calls=[];const out=await prepareImageForTrellis({bytes:png,ImageDecoderClass:decoderFor({width:4,height:2,alpha:i=>i===0?0:255}),...deps(calls)});
  assert.deepEqual(calls.map(c=>c[0]),['alpha']);assert.equal(out.provenance.segmentation,null);assert.equal(out.provenance.route,'input-alpha');
});

test('an opaque photo is segmented by browser U2Net first, then prepared once',async()=>{
  const calls=[];const out=await prepareImageForTrellis({bytes:png,ImageDecoderClass:decoderFor({width:4,height:2,alpha:()=>255}),...deps(calls)});
  assert.deepEqual(calls.map(c=>c[0]),['runner','u2net','alpha']);
  assert.equal(calls[1][3],4,'decoded RGBA goes to U2Net as four channels');
  assert.equal(calls[2][3],0,'the cutout alpha, not the opaque photo, reaches the alpha preparation');
  assert.equal(out.provenance.route,'browser-u2net');assert.equal(out.provenance.segmentation.route,'u2net');
  assert.equal(out.pixels.length,512*512*3);
});

test('no decoder means no fallback',async()=>{
  await assert.rejects(prepareImageForTrellis({bytes:png,ImageDecoderClass:undefined,...deps([])}),/ImageDecoder/);
});
