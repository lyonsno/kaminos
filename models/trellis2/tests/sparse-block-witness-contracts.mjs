import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const source = new URL('../sparse-block-witness-checks.js', import.meta.url);
assert.ok(existsSync(source), 'Missing whole-block witness admission; wrong reference/config must not establish progress.');
const { validateBlockFixture, compareBlockTensor, BLOCK_TOLERANCE } = await import(source);
const fixture = { schema: 'trellis2.sparse-block-reference.v0', status: 'succeeded',
  config: {}, source: { commit: 'a'.repeat(40) }, prefix: { sha256: 'b'.repeat(64) },
  tensors: { 'expected.after_mlp': { shape: [4096, 1536], dtype: 'float32', byteLength: 4096 * 1536 * 4, sha256: 'c'.repeat(64) } } };
const prefix = { source: { commit: 'a'.repeat(40) }, config: { resolution: 16, channels: 1536 } };
assert.equal(validateBlockFixture(fixture, prefix, 'b'.repeat(64)).headDim, 128);
for (const change of [f => { f.status = 'failed'; }, f => { f.prefix.sha256 = 'd'.repeat(64); },
  f => { f.source.commit = 'd'.repeat(40); }, f => { f.config.contextRows = 1; },
  f => { f.tensors['expected.after_mlp'].shape = [4095, 1536]; }, f => { delete f.tensors['expected.after_mlp']; }]) {
  const bad = structuredClone(fixture); change(bad);
  assert.throws(() => validateBlockFixture(bad, prefix, 'b'.repeat(64)));
}
assert.equal(compareBlockTensor(new Float32Array([1, 2]), new Float32Array([1, 2])).passed, true);
assert.equal(compareBlockTensor(new Float32Array([0, 0]), new Float32Array([1, 2])).passed, false);
assert.throws(() => compareBlockTensor([], []), /empty/);
assert.throws(() => compareBlockTensor([1], [1, 2]), /length/);
assert.throws(() => compareBlockTensor([NaN], [1]), /non-finite/);
assert.ok(BLOCK_TOLERANCE.atol > 0 && BLOCK_TOLERANCE.rtol > 0);
console.log('Whole-block fixture rejects partial/wrong-source/input/config and blank/nonfinite numerical closure.');
