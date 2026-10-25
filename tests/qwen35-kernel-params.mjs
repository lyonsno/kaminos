// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { affineParams, affineDispatch, affineTiledDispatch, deltaParams, attentionParams } from '../models/qwen3_5/kernel-params.js';
import { Qwen35TextModel } from '../models/qwen3_5/text-model.js';
test('tiled prefill covers partial token/row tiles and preserves single-token dispatch', async () => {
  assert.deepEqual(affineTiledDispatch(35, 33, 8), [2, 1, 2]);
  assert.deepEqual(affineTiledDispatch(248320, 743, 65535), [7760, 1, 24]);
  assert.throws(() => affineTiledDispatch(32, 65, 2), /dispatch/);
  assert.throws(() => affineTiledDispatch(0, 1, 8));
  const calls=[], model=Object.create(Qwen35TextModel.prototype);
  model.weights=new Map([['p',{rows:35,columns:64,group:64,slices:[{rows:35,rowStart:0,weight:{},scales:{},biases:{}}]}]]);
  model.device={limits:{maxComputeWorkgroupsPerDimension:8}};
  model.dispatch=async (...args)=>calls.push(args);
  await model.linear('p',{}, {},33,{});
  assert.equal(calls[0][0],'affine-tiled'); assert.deepEqual(calls[0][4],[2,1,2]);
  calls.length=0; model.device.limits.maxComputeWorkgroupsPerDimension=65535;
  await model.linear('p',{}, {},1,{});
  assert.equal(calls[0][0],'affine'); assert.deepEqual(calls[0][4],[35,1,1]);
});
test('affine dispatch covers the full LM vocabulary and keeps explicit row/stride offsets', () => {
  assert.deepEqual(affineDispatch(248320, 1, 65535), [65535, 4, 1]);
  const p = affineParams({ tokens: 3, rows: 32, columns: 4096, group: 64, inputOffset: 7, inputStride: 4100,
    weightRowOffset: 4, outputOffset: 2, outputStride: 40 });
  assert.deepEqual([...p.slice(0, 9)], [3, 32, 4096, 64, 7, 4100, 4, 2, 40]);
});
test('DeltaNet parameters retain distinct key/value axes and full convolution history width', () => {
  const p = deltaParams({ tokens: 5, keyHeads: 2, valueHeads: 4, keyDim: 8, valueDim: 12, kernel: 4 });
  assert.deepEqual([...p.slice(0, 8)], [5, 2, 4, 8, 12, 4, 80, 88]);
  assert.ok(Math.abs(new Float32Array(p.buffer)[8] - 1e-6) < 1e-12);
});
test('cached attention records past length independently of backing capacity', () => {
  const p = attentionParams({ tokens: 2, queryHeads: 16, kvHeads: 4, headDim: 256, rotaryDim: 64,
    pastTokens: 3, capacity: 8, ropeTheta: 1e7 });
  assert.deepEqual([...p.slice(0, 7)], [2, 16, 4, 256, 64, 3, 8]);
  assert.equal(new Float32Array(p.buffer)[8], 1e7);
});
test('invalid geometry and overflowing address spans fail without truncating the request', () => {
  for (const spec of [{ columns: 4095 }, { group: 63 }, { inputStride: 10 }, { outputStride: 1 }, { tokens: 0 }, { outputOffset: 0xffff_ffff }]) {
    assert.throws(() => affineParams({ tokens: 2, rows: 32, columns: 4096, group: 64, ...spec }));
  }
  assert.throws(() => affineDispatch(10, 3, 2));
  assert.throws(() => deltaParams({ tokens: 5, keyHeads: 3, valueHeads: 4, keyDim: 8, valueDim: 12, kernel: 4 }));
  assert.throws(() => attentionParams({ tokens: 2, queryHeads: 16, kvHeads: 4, headDim: 256, rotaryDim: 63, pastTokens: 0, capacity: 8, ropeTheta: 1e7 }));
  assert.throws(() => attentionParams({ tokens: 2, queryHeads: 16, kvHeads: 4, headDim: 256, rotaryDim: 64, pastTokens: 7, capacity: 8, ropeTheta: 1e7 }));
});
