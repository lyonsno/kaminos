import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  FLASH_ATTENTION_PARAMS_WORDS,
  createWebGpuFlashAttentionShader,
  flashAttentionDispatch,
  flashAttentionParams,
  flashAttentionStridedParams,
  createWebGpuTiledFlashAttentionShader,
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

// Every head dim the original online kernels accept (1..64): multiples of 4 use vec4 registers and tiles,
// others fall back to unrolled scalars with the same online-softmax structure.
{
  const odd = createWebGpuFlashAttentionShader({ headDim: 7 });
  assert.match(odd, /var<storage, read> q_values: array<f32>/);
  assert.match(odd, /var<workgroup> key_tile: array<f32, 224>/);
  assert.match(odd, /var q6: f32/);
  assert.doesNotMatch(odd, /var q7:/);
  assert.doesNotMatch(odd, /vec4/);
  for (const headDim of [1, 2, 16, 24, 63, 64]) assert.equal(typeof createWebGpuFlashAttentionShader({ headDim }), 'string');
  assert.match(createWebGpuFlashAttentionShader({ headDim: 24 }), /var q5: vec4<f32>/);
}
// Packed shaders for head dims <= 64 are the accepted ones (SAM ViT, DETR, memory attention): byte-identical.
{
  const accepted = {
    7: 'sha256:cc7dddaab8f79e97786fc1415049037012e0f3fdaba5d68643fd11195325b69a',
    16: 'sha256:1ca69278a248a684d5145e148ccf2928cd75a5f6271dc60d9411c489d14a6267',
    24: 'sha256:242025f1faa3116f974b0a339cc38f03ca7cfcf3019a2a2d19b3122de1333efe',
    32: 'sha256:9b5f762f400e8343fa62c77a08285664b8cdf33d13e07a24009fcb59796fa517',
    64: 'sha256:4adc5cc2744858d5fb72261eda42dfb1a2620f7259debdb4ab2f9372bc94d75b',
  };
  for (const [headDim, hash] of Object.entries(accepted)) {
    assert.equal(`sha256:${createHash('sha256').update(createWebGpuFlashAttentionShader({ headDim: Number(headDim) })).digest('hex')}`, hash, `head dim ${headDim} shader changed`);
  }
}

// Head dims above 64 split each query across P threads, each holding at most 64 dims of q and the
// accumulator; partial scores meet in workgroup memory. Workgroup storage stays within 16 KiB.
for (const [headDim, parts, perPart, keyTile] of [[96, 2, 12, 8], [128, 2, 16, 8], [160, 4, 10, 4], [256, 4, 16, 4]]) {
  const code = createWebGpuFlashAttentionShader({ headDim });
  assert.match(code, new RegExp(`@compute @workgroup_size\\(${64 * parts}\\)`), `head dim ${headDim}: 64 queries x ${parts} parts`);
  assert.match(code, new RegExp(`var q${perPart - 1}: vec4<f32>`));
  assert.doesNotMatch(code, new RegExp(`var q${perPart}:`));
  assert.match(code, new RegExp(`var<workgroup> partial_scores: array<f32, ${parts * 64 * keyTile}>`));
  assert.match(code, new RegExp(`var<workgroup> key_tile: array<vec4<f32>, ${keyTile * headDim / 4}>`));
  assert.ok(2 * keyTile * headDim * 4 + parts * 64 * keyTile * 4 <= 16384);
}
// Invalid geometry fails loudly instead of compiling a kernel that reads past a head.
for (const headDim of [0, 257, 2.5]) assert.throws(() => createWebGpuFlashAttentionShader({ headDim }), /headDim must be an integer from 1 to 256/);
assert.throws(() => createWebGpuFlashAttentionShader({ headDim: 130 }), /head dims above 64 must be multiples of 4/);

// Strided layout: per-tensor offsets and token/head/domain strides, e.g. TRELLIS fused QKV rows of 3c with
// q, k, v at offsets 0, c, 2c and a separate c-wide output, or head-major [H][L][D] tensors.
{
  const code = createWebGpuFlashAttentionShader({ headDim: 128, layout: 'strided' });
  for (const field of ['q_offset', 'q_token_stride', 'q_head_stride', 'q_domain_stride', 'k_offset', 'v_offset', 'o_token_stride']) assert.match(code, new RegExp(field));
  const c = 1536;
  const words = flashAttentionStridedParams({ queryTokens: 4096, keyTokens: 4096, heads: 12, headDim: 128,
    q: { offset: 0, tokenStride: 3 * c }, k: { offset: c, tokenStride: 3 * c }, v: { offset: 2 * c, tokenStride: 3 * c }, out: { tokenStride: c } });
  assert.equal(words.length, 24);
  const u = [...words];
  assert.deepEqual(u.slice(0, 6), [4096, 4096, 12, 12, 0, 4096]);
  assert.equal(new Float32Array(words.buffer)[6], Math.fround(1 / Math.sqrt(128)));
  assert.deepEqual(u.slice(8, 12), [0, 3 * c, 128, 4096 * 3 * c], 'q: offset, token, head, domain strides');
  assert.deepEqual(u.slice(12, 16), [c, 3 * c, 128, 4096 * 3 * c]);
  assert.deepEqual(u.slice(16, 20), [2 * c, 3 * c, 128, 4096 * 3 * c]);
  assert.deepEqual(u.slice(20, 24), [0, c, 128, 4096 * c]);
  const headMajor = [...flashAttentionStridedParams({ queryTokens: 10, keyTokens: 10, heads: 3, headDim: 128, q: { tokenStride: 128, headStride: 1280 } })];
  assert.deepEqual(headMajor.slice(8, 12), [0, 128, 1280, 10 * 3 * 128], 'domain stride defaults to the whole domain');
  assert.throws(() => flashAttentionStridedParams({ queryTokens: 1, keyTokens: 1, heads: 1, headDim: 64, k: { offset: 2 } }), /multiples of 4/);
  assert.equal(flashAttentionStridedParams({ queryTokens: 1, keyTokens: 1, heads: 1, headDim: 7, k: { offset: 2 } }).length, 24, 'scalar head dims take any offset');
}
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

// Register-tiled variant: 256 threads (16x16) per 64-query block; each thread holds a 4x2 score micro-tile
// and a 4 x headDim/16 output slice; K/V stream in 32-key tiles through <= 16 KiB of workgroup memory.
for (const headDim of [64, 128, 256]) {
  for (const layout of ['packed', 'strided']) {
    const code = createWebGpuTiledFlashAttentionShader({ headDim, layout });
    assert.match(code, /@compute @workgroup_size\(256\)/);
    assert.match(code, /var<workgroup> score_tile: array<f32, 2048>/);
    assert.match(code, new RegExp(`var o3_${headDim / 16 - 1}: f32`), 'four rows of headDim/16 output registers');
    assert.doesNotMatch(code, new RegExp(`var o3_${headDim / 16}:`));
    assert.match(code, /var s3_1: f32/, '4x2 score micro-tile');
    const shared = Number(code.match(/var<workgroup> stage: array<f32, (\d+)>/)[1]);
    assert.ok((2048 + shared) * 4 <= 16384, `head dim ${headDim}: workgroup storage`);
    if (layout === 'strided') assert.match(code, /q_token_stride/);
  }
}
for (const headDim of [8, 72, 130, 272]) assert.throws(() => createWebGpuTiledFlashAttentionShader({ headDim }), /multiple of 16 from 16 to 256/);

console.log('flash attention kernel contracts passed');
