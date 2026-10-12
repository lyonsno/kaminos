import assert from 'node:assert/strict';

import {
  FLASH_ATTENTION_PARAMS_WORDS,
  createWebGpuFlashAttentionShader,
  flashAttentionDispatch,
  flashAttentionParams,
} from '../src/flash-attention-kernel.js';

// Generated shader: compile-time head dim and tiles, unrolled registers, workgroup tiles within the
// default 16 KiB workgroup storage limit, and the binding layout q, k, v, out, params.
{
  const code = createWebGpuFlashAttentionShader({ headDim: 64 });
  assert.match(code, /@compute @workgroup_size\(64\)/);
  assert.match(code, /var<workgroup> key_tile: array<vec4<f32>, 512>/);
  assert.match(code, /var<workgroup> value_tile: array<vec4<f32>, 512>/);
  for (const binding of [0, 1, 2, 3, 4]) assert.match(code, new RegExp(`@binding\\(${binding}\\)`));
  assert.match(code, /var q15: vec4<f32>/, 'query held in unrolled vec4 registers');
  assert.doesNotMatch(code, /var q16:/);
  assert.match(code, /var s31: f32/, 'one score register per key in the tile');
  const small = createWebGpuFlashAttentionShader({ headDim: 32, blockKeys: 16 });
  assert.match(small, /var q7: vec4<f32>/);
  assert.doesNotMatch(small, /var q8:/);
  assert.match(small, /array<vec4<f32>, 128>/);
}

// Invalid geometry fails loudly instead of compiling a kernel that reads past a head.
assert.throws(() => createWebGpuFlashAttentionShader({ headDim: 66 }), /headDim must be a multiple of 4/);
assert.throws(() => createWebGpuFlashAttentionShader({ headDim: 128 }), /headDim must be at most 64/);
assert.throws(() => createWebGpuFlashAttentionShader({ headDim: 64, blockKeys: 64 }), /workgroup storage/);

// Params: 12 words; counts, channel strides, grouped KV heads, query range and the softmax scale.
{
  const words = flashAttentionParams({ queryTokens: 576, keyTokens: 576, heads: 16, kvHeads: 16, headDim: 64, queryOffset: 64, queryCount: 128 });
  assert.equal(words.length, FLASH_ATTENTION_PARAMS_WORDS);
  assert.deepEqual([...new Uint32Array(words.buffer, 0, 8)], [576, 576, 1024, 1024, 16, 16, 64, 128]);
  assert.equal(new Float32Array(words.buffer)[8], Math.fround(1 / 8));
  const gqa = flashAttentionParams({ queryTokens: 10, keyTokens: 10, heads: 8, kvHeads: 2, headDim: 32 });
  assert.deepEqual([...new Uint32Array(gqa.buffer, 0, 8)], [10, 10, 256, 64, 8, 2, 0, 10]);
  assert.throws(() => flashAttentionParams({ queryTokens: 1, keyTokens: 1, heads: 6, kvHeads: 4, headDim: 64 }), /heads must be a multiple of kvHeads/);
  assert.throws(() => flashAttentionParams({ queryTokens: 4, keyTokens: 1, heads: 1, headDim: 64, queryOffset: 3, queryCount: 2 }), /query range/);
}

// Dispatch: one workgroup per 64-query block of the range, per head, per domain.
assert.deepEqual(flashAttentionDispatch({ queryCount: 5184, heads: 16, domains: 1 }), [81, 16, 1]);
assert.deepEqual(flashAttentionDispatch({ queryCount: 576, heads: 16, domains: 9 }), [9, 16, 9]);
assert.deepEqual(flashAttentionDispatch({ queryCount: 65, heads: 2, domains: 4 }), [2, 2, 4]);

console.log('flash attention kernel contracts passed');
