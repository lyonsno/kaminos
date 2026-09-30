import assert from 'node:assert/strict';
import * as checks from '../sparse-block-witness-checks.js';
assert.equal(typeof checks.validateBlockChainFixture, 'function', 'Missing source-pinned consecutive block admission.');
const stages = ['norm1', 'modulated_self_input', 'q_post_norm', 'k_post_norm', 'q_post_rope', 'k_post_rope',
  'self.attention', 'self_attn', 'after_self', 'norm2', 'cross.attention', 'after_cross', 'mlp_input',
  'mlp_fc1', 'mlp_gelu', 'mlp_fc2', 'after_mlp'];
const prefixSha = 'b'.repeat(64), firstSha = 'f'.repeat(64);
const prefix = { source: { commit: 'a'.repeat(40) }, config: { resolution: 16, channels: 1536 }, checkpoint: { sha256: 'e'.repeat(64) } };
const first = { schema: 'trellis2.sparse-block-reference.v0', status: 'succeeded', config: {},
  source: { commit: prefix.source.commit, dirty: '' }, prefix: { sha256: prefixSha }, checkpoint: prefix.checkpoint,
  conditioning: { sha256: 'd'.repeat(64) }, fullModelExecutions: 0, blockExecutions: 1,
  referenceRoute: 'pinned-MLX-GPU-single-block/fast-SDPA/two-pass-LN/mlx-sum-QK/real-RoPE/source-BF16-GELU',
  effectiveBackend: { device: 'Device(gpu, 0)', attention: 'fast', qk: { backend: 'mlx-sum' },
    layernorm: { backend: 'mlx-two-pass' }, rope: { backend: 'inherit' } },
  tensors: Object.fromEntries(stages.map(name => {
    const width = ['mlp_fc1', 'mlp_gelu'].includes(name) ? 8192 : 1536;
    return [`expected.${name}`, { file: `expected.${name}.f32`, shape: [4096, width], dtype: 'float32',
      byteLength: 4096 * width * 4, sha256: 'c'.repeat(64) }];
  })) };
for (const name of ['conditioning', 'phases', 'gelu']) first.tensors[name] = { sha256: 'd'.repeat(64) };
const next = structuredClone(first);
next.blockIndex = 1;
next.inputBlock = { blockIndex: 0, sha256: firstSha, tensorSha256: first.tensors['expected.after_mlp'].sha256 };
const { sparseBlockWeightShapes, buildSparseBlockPlan } = await import('../sparse-block.js');
for (const [name, shape] of Object.entries(sparseBlockWeightShapes(buildSparseBlockPlan()))) {
  next.tensors[name] = { shape, dtype: 'float32', byteLength: shape.reduce((a, b) => a * b, 4),
    sha256: 'a'.repeat(64), checkpointKey: `blocks.1.${name}` };
}
assert.equal(checks.validateBlockChainFixture(next, first, prefix, prefixSha, firstSha).rows, 4096);
for (const change of [f => { f.blockIndex = 0; }, f => { delete f.blockIndex; },
  f => { f.inputBlock.sha256 = 'a'.repeat(64); }, f => { f.inputBlock.blockIndex = 3; },
  f => { f.inputBlock.tensorSha256 = 'a'.repeat(64); }, f => { delete f.inputBlock; },
  f => { f.tensors.phases.sha256 = 'a'.repeat(64); }, f => { f.tensors.conditioning.sha256 = 'a'.repeat(64); },
  f => { f.conditioning.sha256 = 'a'.repeat(64); }, f => { f.tensors.gelu.sha256 = 'a'.repeat(64); },
  f => { f.tensors['self.qkv.weight'].checkpointKey = 'blocks.0.self_attn.to_qkv.weight'; },
  f => { delete f.tensors['mlp.out.weight']; }, f => { f.tensors['mlp.out.weight'].shape = [1]; },
  f => { delete f.tensors['expected.after_cross']; }, f => { f.effectiveBackend.device = 'Device(cpu, 0)'; }]) {
  const bad = structuredClone(next); change(bad);
  assert.throws(() => checks.validateBlockChainFixture(bad, first, prefix, prefixSha, firstSha));
}
assert.throws(() => checks.validateBlockFixture(next, prefix, prefixSha), /block.*index/);
console.log('Consecutive real-block admission rejects wrong block weights, replaced common inputs, partial references and broken canonical hidden provenance.');
