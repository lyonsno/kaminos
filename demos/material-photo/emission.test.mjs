import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

const map = pixels => ({width:pixels.length,height:1,data:new Uint8Array(pixels.flat())});
test('hue-divergent residual contributes glow, aligned highlights do not',async()=>{
  const url = new URL('./emission.js',import.meta.url);
  assert.ok(existsSync(url),'photo material surface has no inferred emission channel');
  const {inferEmission} = await import(url);
  const source = map([[200,200,200,255],[255,100,20,255],[10,10,10,255]]);
  const albedo = map([[100,100,100,255],[45,45,45,255],[10,10,10,255]]);
  const before = source.data.slice(), beforeAlbedo = albedo.data.slice();
  const output = inferEmission(source,albedo);
  assert.ok(output.data instanceof Float32Array);
  assert.equal(output.width,source.width); assert.equal(output.height,source.height);
  assert.equal(output.data.length,source.data.length);
  assert.deepEqual([...output.data.slice(0,3)],[0,0,0]);
  assert.ok(output.data[4]>.8 && output.data[5]>.05 && output.data[6]===0,'orange over neutral remains');
  assert.deepEqual([...output.data.slice(8,11)],[0,0,0]);
  assert.ok([...output.data].every(Number.isFinite));
  assert.deepEqual(source.data,before); assert.deepEqual(albedo.data,beforeAlbedo);
});
test('emission resampling and upload preserve image-space registration',async()=>{
  const url = new URL('./emission.js',import.meta.url); assert.ok(existsSync(url),'emission missing');
  const {inferEmission,emissionTexturePixels}=await import(url);
  const image={width:1,height:2,data:new Uint8Array([255,100,0,255,50,50,50,255])};
  const output=inferEmission(image,map([[50,50,50,255]]));
  const flipped=emissionTexturePixels(output);
  assert.deepEqual([...flipped.data.slice(0,3)],[0,0,0]);
  assert.ok(flipped.data[4]>.8);
  assert.throws(()=>inferEmission({...image,data:new Uint8Array(1)},map([[50,50,50,255]])),/dimensions/);
  assert.throws(()=>emissionTexturePixels({...output,data:new Uint8Array(8)}),/dimensions/);
  assert.throws(()=>emissionTexturePixels({...output,data:new Float32Array([NaN,0,0,1,0,0,0,1])}),/finite/);
});
