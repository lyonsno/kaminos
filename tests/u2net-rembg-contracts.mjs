// kaminos-test: node
// Browser foreground removal reproduces rembg 2.0.76 / Pillow 12.3 byte for
// byte on every CPU stage (pre-resize, model input, mask, cutout); the U2Net
// inference between them is checked on WebGPU by u2net-webgpu-witness.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resizePillowLanczosU8} from '../models/u2net/pillow-resample.js';
import {sourcePreResize,rembgInputTensor,rembgMaskFromPrediction,naiveCutoutRgba,removeForegroundU2Net} from '../models/u2net/rembg-u2net.js';
import {fixtureImage,fixturePrediction,RESAMPLE_CASES,PIPELINE_CASES} from '../models/u2net/fixtures/rembg-fixture.js';

const fixture=JSON.parse(await fs.readFile(new URL('../models/u2net/fixtures/rembg-source.json',import.meta.url)));
const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const recorded=(kind,i)=>fixture.cases.filter(c=>c.kind===kind)[i];

RESAMPLE_CASES.forEach((c,i)=>{
  const want=recorded('resample',i),px=fixtureImage(c.w,c.h,c.seed,c.channels);
  assert.equal(sha(px),want.inputSha256,`resample ${i}: fixture bytes drifted`);
  const out=resizePillowLanczosU8(px,c.w,c.h,c.ow,c.oh,c.channels);
  assert.equal(sha(out),want.outputSha256,`resample ${i}: ${c.w}x${c.h}x${c.channels} -> ${c.ow}x${c.oh} must equal Pillow LANCZOS`);
});

for(const [i,c] of PIPELINE_CASES.entries()){
  const want=recorded('pipeline',i),px=fixtureImage(c.w,c.h,c.seed),pred=fixturePrediction(c.predSeed);
  assert.equal(sha(px),want.inputSha256);assert.equal(sha(pred),want.predSha256);
  const pre=sourcePreResize(px,c.w,c.h);
  assert.deepEqual([pre.width,pre.height],want.size,`pipeline ${i}: source max-1024 size`);
  assert.equal(sha(pre.rgb),want.preSha256,`pipeline ${i}: pre-resized photo`);
  assert.equal(sha(rembgInputTensor(pre.rgb,pre.width,pre.height)),want.inputTensorSha256,`pipeline ${i}: U2Net input tensor`);
  const mask=rembgMaskFromPrediction(pred,pre.width,pre.height);
  assert.equal(sha(mask),want.maskSha256,`pipeline ${i}: mask from prediction`);
  assert.equal(sha(naiveCutoutRgba(pre.rgb,mask)),want.cutoutSha256,`pipeline ${i}: naive cutout`);
  // Whole route with a runner that returns the recorded prediction.
  let calls=0;const runner={run:async input=>{calls++;assert.equal(sha(input),want.inputTensorSha256);return {mask:pred};}};
  const r=await removeForegroundU2Net({pixels:px,width:c.w,height:c.h,runner});
  assert.equal(calls,1);assert.equal(sha(r.rgba),want.cutoutSha256,`pipeline ${i}: removeForegroundU2Net cutout`);
  assert.deepEqual([r.width,r.height],want.size);assert.equal(r.provenance.preResized,c.w>1024||c.h>1024);
}

// Opaque RGBA is accepted as RGB; real alpha belongs to the alpha-cutout route.
const c=PIPELINE_CASES[1],rgb=fixtureImage(c.w,c.h,c.seed),rgba=fixtureImage(c.w,c.h,c.seed,4);
const runner={run:async()=>({mask:fixturePrediction(c.predSeed)})};
const fromRgba=await removeForegroundU2Net({pixels:rgba,width:c.w,height:c.h,channels:4,runner});
assert.equal(sha(fromRgba.rgba),recorded('pipeline',1).cutoutSha256,'opaque RGBA equals its RGB');
rgba[3]=254;
await assert.rejects(removeForegroundU2Net({pixels:rgba,width:c.w,height:c.h,channels:4,runner}),/alpha-cutout preparation/);
await assert.rejects(removeForegroundU2Net({pixels:rgb,width:c.w,height:c.h,runner,signal:AbortSignal.abort()}),e=>e.name==='AbortError');
await assert.rejects(removeForegroundU2Net({pixels:rgb,width:c.w,height:c.h}),/runner/);
