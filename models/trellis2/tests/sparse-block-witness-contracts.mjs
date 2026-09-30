import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const source = new URL('../sparse-block-witness-checks.js', import.meta.url);
assert.ok(existsSync(source), 'Missing whole-block witness admission; wrong reference/config must not establish progress.');
const { validateBlockFixture, compareBlockTensor, BLOCK_TOLERANCE } = await import(source);
// Independent expected stage set, taken from the observed single-block export.
const stages = ['norm1', 'modulated_self_input', 'q_post_norm', 'k_post_norm', 'q_post_rope', 'k_post_rope',
  'self.attention', 'self_attn', 'after_self', 'norm2', 'cross.attention', 'after_cross',
  'mlp_input', 'mlp_fc1', 'mlp_gelu', 'mlp_fc2', 'after_mlp'];
const fixture = { schema: 'trellis2.sparse-block-reference.v0', status: 'succeeded',
  config: {}, source: { commit: 'a'.repeat(40), dirty: '' }, prefix: { sha256: 'b'.repeat(64) },
  checkpoint: { sha256: 'e'.repeat(64) }, fullModelExecutions: 0, blockExecutions: 1,
  referenceRoute: 'pinned-MLX-GPU-single-block/fast-SDPA/two-pass-LN/mlx-sum-QK/real-RoPE/source-BF16-GELU',
  effectiveBackend: { device: 'Device(gpu, 0)', attention: 'fast', qk: { backend: 'mlx-sum' },
    layernorm: { backend: 'mlx-two-pass' }, rope: { backend: 'inherit' } },
  tensors: Object.fromEntries(stages.map(name => {
    const width = ['mlp_fc1', 'mlp_gelu'].includes(name) ? 8192 : 1536;
    return [`expected.${name}`, { file: `expected.${name}.f32`, shape: [4096, width],
      dtype: 'float32', byteLength: 4096 * width * 4, sha256: 'c'.repeat(64) }];
  })) };
const prefix = { source: { commit: 'a'.repeat(40) }, config: { resolution: 16, channels: 1536 }, checkpoint: { sha256: 'e'.repeat(64) } };
assert.equal(validateBlockFixture(fixture, prefix, 'b'.repeat(64)).headDim, 128);
const regressions = [
  ['omitted after-cross comparison', f => { delete f.tensors['expected.after_cross']; }],
  ['changed reference route', f => { f.referenceRoute = 'CPU-single-block'; }],
  ['CPU reference substituted', f => { f.effectiveBackend.device = 'Device(cpu, 0)'; }],
  ['conflicting checkpoint', f => { f.checkpoint.sha256 = 'd'.repeat(64); }],
];
// Report every named false-admission path, including on the pre-fix validator.
const failures = [];
for (const [name, change] of regressions) {
  const bad = structuredClone(fixture); change(bad);
  try { assert.throws(() => validateBlockFixture(bad, prefix, 'b'.repeat(64)), name); }
  catch (error) { failures.push(error.message); }
}
assert.deepEqual(failures, [], `False reference admission: ${failures.join('; ')}`);
for (const change of [f => { f.status = 'failed'; }, f => { f.prefix.sha256 = 'd'.repeat(64); },
  f => { f.source.commit = 'd'.repeat(40); }, f => { f.config.contextRows = 1; },
  f => { f.tensors['expected.after_mlp'].shape = [4095, 1536]; }, f => { delete f.tensors['expected.after_mlp']; },
  f => { f.tensors['expected.mlp_fc1'].shape = [4096, 1536]; },
  f => { f.tensors['expected.norm1'].dtype = 'float16'; },
  f => { f.tensors['expected.self.attention'].byteLength--; },
  f => { f.tensors['expected.mlp_gelu'].sha256 = 'unknown'; },
  f => { f.source.dirty = ' M source.py'; },
  f => { f.effectiveBackend.attention = 'math'; }, f => { f.effectiveBackend.qk.backend = 'other'; },
  f => { f.effectiveBackend.layernorm.backend = 'other'; }, f => { f.effectiveBackend.rope.backend = 'other'; },
  f => { f.fullModelExecutions = 1; }, f => { delete f.blockExecutions; }]) {
  const bad = structuredClone(fixture); change(bad);
  assert.throws(() => validateBlockFixture(bad, prefix, 'b'.repeat(64)));
}
for (const name of stages) {
  const bad = structuredClone(fixture); delete bad.tensors[`expected.${name}`];
  assert.throws(() => validateBlockFixture(bad, prefix, 'b'.repeat(64)), `missing ${name}`);
}
const additive = structuredClone(fixture);
additive.futureMetadata = { value: 'compatible' };
additive.effectiveBackend.qk.futureDiagnostic = true;
assert.equal(validateBlockFixture(additive, prefix, 'b'.repeat(64)).headDim, 128);
assert.equal(compareBlockTensor(new Float32Array([1, 2]), new Float32Array([1, 2])).passed, true);
assert.equal(compareBlockTensor(new Float32Array([0, 0]), new Float32Array([1, 2])).passed, false);
assert.throws(() => compareBlockTensor([], []), /empty/);
assert.throws(() => compareBlockTensor([1], [1, 2]), /length/);
assert.throws(() => compareBlockTensor([NaN], [1]), /non-finite/);
assert.ok(BLOCK_TOLERANCE.atol > 0 && BLOCK_TOLERANCE.rtol > 0);
console.log('Whole-block fixture rejects partial/wrong-source/input/config and blank/nonfinite numerical closure.');
