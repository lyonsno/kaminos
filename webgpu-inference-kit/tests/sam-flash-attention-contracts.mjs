import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createWebGpuFlashAttentionShader, createWebGpuTiledFlashAttentionShader } from '../src/flash-attention-kernel.js';
import { SAM_FLASH_ATTENTION_QUERIES_PER_PHASE, partitionSamFlashAttentionPhase, samFlashAttentionShader } from '../src/sam-flash-attention.js';

assert.ok(samFlashAttentionShader() === createWebGpuTiledFlashAttentionShader({ headDim: 64 }), 'SAM ViT uses the register-tiled kit generator at head dim 64');
assert.equal(SAM_FLASH_ATTENTION_QUERIES_PER_PHASE, 256, 'default partition remains 256 queries');
assert.equal(SAM_FLASH_ATTENTION_QUERIES_PER_PHASE % 64, 0, 'ranges align to 64-query workgroups');

// Ranges cover every query of every window and head exactly once, tails included; each range keeps the
// template's q, k, v and output bindings and replaces its dims uniform with flash params.
const template = { code: 'online', bindings: ['q', 'k', 'v', 'out', 'dims'] };
for (const [queries, domains] of [[1, 1], [65, 4], [256, 9], [576, 9], [5184, 1]]) {
  const kernels = { attention: template };
  const phases = partitionSamFlashAttentionPhase({ name: 'vit-attention', kernel: 'attention', dispatch: [queries, 16, domains], yieldAfter: true },
    { headDim: 64 }, { createUniformBuffer: spec => spec }, kernels);
  assert.equal(phases.length, Math.ceil(queries / SAM_FLASH_ATTENTION_QUERIES_PER_PHASE));
  let end = 0;
  for (const [index, phase] of phases.entries()) {
    const kernel = kernels[phase.kernel];
    assert.equal(kernel.code, samFlashAttentionShader());
    assert.deepEqual(kernel.bindings.slice(0, 4), ['q', 'k', 'v', 'out']);
    assert.equal(kernel.bindings.length, 5);
    const params = kernel.bindings[4].resource;
    assert.deepEqual(params.schema.map(field => field.name), ['query_tokens', 'key_tokens', 'q_channels', 'kv_channels', 'heads', 'kv_heads',
      'query_offset', 'query_count', 'scale', '_pad0', '_pad1', '_pad2'], 'uniform layout matches the WGSL Params struct');
    assert.equal(params.schema[8].type, 'f32');
    const count = Math.min(SAM_FLASH_ATTENTION_QUERIES_PER_PHASE, queries - end);
    const { query_tokens, key_tokens, q_channels, kv_channels, heads, kv_heads, query_offset, query_count, scale } = params.values;
    assert.deepEqual([query_tokens, key_tokens, q_channels, kv_channels, heads, kv_heads, query_offset, query_count], [queries, queries, 1024, 1024, 16, 16, end, count]);
    assert.equal(scale, 1 / 8);
    assert.deepEqual(phase.dispatch, [Math.ceil(count / 64), 16, domains]);
    assert.equal(phase.yieldAfter, true);
    assert.equal(phase.name, index === 0 ? 'vit-attention' : `vit-attention-query-${end}`);
    end += count;
  }
  assert.equal(end, queries);
}
assert.throws(() => partitionSamFlashAttentionPhase({ kernel: 'attention', dispatch: [10, 2, 1] }, { headDim: 128 }, { createUniformBuffer: spec => spec }, { attention: template }), /headDim/);
// Flash keeps every head dim the online kernels accepted (1..64), including SAM 3.1's 16 and odd sizes.
for (let headDim = 1; headDim <= 64; headDim += 1) {
  const tiled = headDim % 16 === 0;
  const expected = (tiled ? createWebGpuTiledFlashAttentionShader : createWebGpuFlashAttentionShader)({ headDim });
  assert.ok(samFlashAttentionShader(headDim) === expected, `head dim ${headDim}: ${tiled ? 'register-tiled' : 'original'} generator source`);
  const kernels = { attention: template };
  const metadata = { layerIndex: 3, isGlobal: false };
  const yieldAfter = headDim % 2 === 0;
  const phases = partitionSamFlashAttentionPhase({ name: 'attention', kernel: 'attention', dispatch: [321, 2, 3], yieldAfter, metadata },
    { headDim }, { createUniformBuffer: spec => spec }, kernels);
  assert.deepEqual(phases.map(phase => phase.dispatch), [[4, 2, 3], [2, 2, 3]]);
  for (const [index, phase] of phases.entries()) {
    const kernel = kernels[phase.kernel];
    assert.ok(kernel.code === expected, `head dim ${headDim}: actual phase uses selected generator`);
    assert.deepEqual(kernel.bindings.slice(0, 4), template.bindings.slice(0, 4));
    assert.equal(kernel.bindings.length, 5);
    assert.deepEqual(kernel.bindings[4].resource.values, {
      query_tokens: 321, key_tokens: 321, q_channels: 2 * headDim, kv_channels: 2 * headDim,
      heads: 2, kv_heads: 2, query_offset: index * 256, query_count: index === 0 ? 256 : 65,
      scale: 1 / Math.sqrt(headDim), _pad0: 0, _pad1: 0, _pad2: 0,
    });
    assert.equal(phase.yieldAfter, yieldAfter);
    assert.equal(phase.metadata, metadata, 'caller phase metadata is preserved');
  }
  assert.equal(kernels.attention, template, 'original template stays available');
  assert.ok(samFlashAttentionShader(headDim) === expected, 'repeated selection preserves cached shader source');
}
// Programs construct the flash shader only when flash is selected, so explicit 'online' never depends on it.
for (const file of ['sam-image-vit-block-stack-phase-program.js', 'sam-detr-encoder-phase-program.js']) {
  const program = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  assert.match(program, /attentionKernel === 'flash' \? \[samFlashAttentionShader\(/, `${file}: flash shader registered only for flash`);
}

// DETR encoder self-attention: head dim 32, 8 heads, one 5184-token domain; ranges sized by the caller.
{
  assert.ok(samFlashAttentionShader(32) === createWebGpuTiledFlashAttentionShader({ headDim: 32 }));
  const kernels = { attention: template };
  const phases = partitionSamFlashAttentionPhase({ name: 'detr-self', kernel: 'attention', dispatch: [5184, 8, 1], yieldAfter: true },
    { headDim: 32, queriesPerPhase: 2048 }, { createUniformBuffer: spec => spec }, kernels);
  assert.deepEqual(phases.map(phase => phase.dispatch), [[32, 8, 1], [32, 8, 1], [17, 8, 1]]);
  for (const phase of phases) {
    const { values } = kernels[phase.kernel].bindings[4].resource;
    assert.equal(kernels[phase.kernel].code, samFlashAttentionShader(32));
    assert.deepEqual([values.q_channels, values.kv_channels, values.heads], [256, 256, 8]);
    assert.equal(values.scale, 1 / Math.sqrt(32));
  }
}
// Cross-attention (SAM 3.1 memory attention): keys come from a different token set than queries.
{
  const kernels = { attention: template };
  const phases = partitionSamFlashAttentionPhase({ name: 'memory-cross', kernel: 'attention', dispatch: [5184, 8, 1], yieldAfter: true },
    { headDim: 32, keyTokens: 5200, queriesPerPhase: 5184 + 64 - (5184 % 64 || 64) }, { createUniformBuffer: spec => spec }, kernels);
  assert.equal(phases.length, 1);
  assert.ok(kernels[phases[0].kernel].code === createWebGpuTiledFlashAttentionShader({ headDim: 32 }), 'memory cross-attention uses register-tiled source');
  const { values } = kernels[phases[0].kernel].bindings[4].resource;
  assert.deepEqual([values.query_tokens, values.key_tokens, values.query_offset, values.query_count], [5184, 5200, 0, 5184]);
  assert.deepEqual(phases[0].dispatch, [81, 8, 1]);
}
// Default memory partitions keep the full cross-key count for every range, including the tail.
{
  const kernels = { attention: template };
  const phases = partitionSamFlashAttentionPhase({ name: 'memory-cross', kernel: 'attention', dispatch: [576, 8, 2], yieldAfter: true },
    { headDim: 16, keyTokens: 593 }, { createUniformBuffer: spec => spec }, kernels);
  assert.deepEqual(phases.map(phase => phase.dispatch), [[4, 8, 2], [4, 8, 2], [1, 8, 2]]);
  for (const [index, phase] of phases.entries()) {
    const kernel = kernels[phase.kernel];
    assert.ok(kernel.code === createWebGpuTiledFlashAttentionShader({ headDim: 16 }));
    assert.deepEqual(kernel.bindings.slice(0, 4), template.bindings.slice(0, 4));
    const { values } = kernel.bindings[4].resource;
    assert.deepEqual([values.query_tokens, values.key_tokens, values.query_offset, values.query_count], [576, 593, index * 256, index === 2 ? 64 : 256]);
    assert.equal(phase.yieldAfter, true);
  }
}
const memory = readFileSync(new URL('../src/sam31-memory-attention-phase-program.js', import.meta.url), 'utf8');
assert.match(memory, /input\.attentionKernel/);
// The tracker stays provisional (Sammy, 2026-10-12) until a real bank/propagation exercise: flash is opt-in there.
assert.match(memory, /const attentionKernel = input\.attentionKernel \?\? 'online';/, 'SAM 3.1 memory attention defaults to the original kernel');
assert.match(memory, /partitionSamFlashAttentionPhase\(/);
assert.match(memory, /keyTokens: cross \? shape\.memoryTokens : shape\.queryTokens/, 'cross-attention reads the memory token count');
const detr = readFileSync(new URL('../src/sam-detr-encoder-phase-program.js', import.meta.url), 'utf8');
assert.match(detr, /input\.attentionKernel/);
assert.match(detr, /partitionSamFlashAttentionPhase\(/);
assert.match(detr, /partitionSamAttentionPhase\(phases\[attentionIndex\], kernels, runtime\)/, 'online DETR self-attention remains selectable');

// The ViT block stack selects the kernel per invocation and keeps the online kernel as the A/B baseline.
const source = readFileSync(new URL('../src/sam-image-vit-block-stack-phase-program.js', import.meta.url), 'utf8');
assert.match(source, /input\.attentionKernel/);
assert.match(source, /partitionSamFlashAttentionPhase\(/);
assert.match(source, /partitionSamAttentionPhase\(phase, kernels, runtime, 128\)/, 'online attention remains selectable');
assert.match(source, /samFlashAttentionShader\(shape\.headDim\)/, 'flash shader is registered with the range runtime when selected');

console.log('sam flash attention contracts passed');
