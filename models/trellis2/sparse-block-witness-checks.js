import { buildSparseBlockPlan } from './sparse-block.js';

// Declared before native execution. Allows BF16 boundary drift, but does not
// admit arbitrary mean error or a visually "better" output as fidelity.
export const BLOCK_TOLERANCE = Object.freeze({ atol: 1 / 32, rtol: 1 / 64 });
export function compareBlockTensor(actual, expected) {
  if (!actual.length || !expected.length) throw new Error('empty tensor');
  if (actual.length !== expected.length) throw new Error('tensor length mismatch');
  let failures = 0, exactCount = 0, maxAbs = 0, squared = 0, referenceSquared = 0, worstIndex = 0;
  for (let i = 0; i < actual.length; i++) {
    if (!Number.isFinite(actual[i]) || !Number.isFinite(expected[i])) throw new Error(`non-finite tensor at ${i}`);
    const delta = Math.abs(actual[i] - expected[i]);
    if (delta > maxAbs) { maxAbs = delta; worstIndex = i; }
    if (delta > BLOCK_TOLERANCE.atol + BLOCK_TOLERANCE.rtol * Math.abs(expected[i])) failures++;
    if (actual[i] === expected[i]) exactCount++;
    squared += delta * delta; referenceSquared += expected[i] ** 2;
  }
  return { passed: failures === 0, count: actual.length, failures, exactCount, maxAbs, worstIndex,
    actualAtWorst: actual[worstIndex], expectedAtWorst: expected[worstIndex], rmse: Math.sqrt(squared / actual.length),
    relativeL2: Math.sqrt(squared / Math.max(referenceSquared, Number.MIN_VALUE)), tolerance: BLOCK_TOLERANCE };
}
export function validateBlockFixture(manifest, prefix, prefixSha256) {
  if (manifest?.schema !== 'trellis2.sparse-block-reference.v0' || manifest.status !== 'succeeded') throw new Error('complete block reference required');
  if (manifest.prefix?.sha256 !== prefixSha256 || manifest.source?.commit !== prefix.source?.commit) throw new Error('block/prefix source or input identity mismatch');
  const plan = buildSparseBlockPlan(manifest.config);
  if (plan.rows !== 4096 || plan.channels !== 1536 || plan.heads !== 12 || plan.contextRows !== 1029 || plan.contextChannels !== 1024 || plan.hidden !== 8192 ||
      prefix.config.resolution !== plan.resolution || prefix.config.channels !== plan.channels) throw new Error('real block/prefix configuration mismatch');
  const row = manifest.tensors?.['expected.after_mlp'];
  if (!row || JSON.stringify(row.shape) !== JSON.stringify(plan.outputShape) || row.dtype !== 'float32' ||
      row.byteLength !== plan.rows * plan.channels * 4 || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('partial final block reference');
  return plan;
}
