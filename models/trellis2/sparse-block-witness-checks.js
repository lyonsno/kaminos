import { buildSparseBlockPlan, sparseBlockWeightShapes } from './sparse-block.js';

// Declared before native execution. Allows BF16 boundary drift, but does not
// admit arbitrary mean error or a visually "better" output as fidelity.
export const BLOCK_TOLERANCE = Object.freeze({ atol: 1 / 32, rtol: 1 / 64 });
// Fixed observation contract, not a caller-selected subset of comparisons.
export const BLOCK_OBSERVATIONS = Object.freeze(['norm1', 'modulated_self_input', 'q_post_norm', 'k_post_norm',
  'q_post_rope', 'k_post_rope', 'self.attention', 'self_attn', 'after_self', 'norm2', 'cross.attention',
  'after_cross', 'mlp_input', 'mlp_fc1', 'mlp_gelu', 'mlp_fc2', 'after_mlp']);
const REFERENCE_ROUTE = 'pinned-MLX-GPU-single-block/fast-SDPA/two-pass-LN/mlx-sum-QK/real-RoPE/source-BF16-GELU';
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
export function validateBlockFixture(manifest, prefix, prefixSha256, { blockIndex = 0 } = {}) {
  if (manifest?.schema !== 'trellis2.sparse-block-reference.v0' || manifest.status !== 'succeeded') throw new Error('complete block reference required');
  if ((manifest.blockIndex ?? 0) !== blockIndex) throw new Error('reference block index mismatch');
  if (!/^[a-f0-9]{64}$/.test(prefixSha256) || manifest.prefix?.sha256 !== prefixSha256 ||
      !/^[a-f0-9]{40}$/.test(manifest.source?.commit) || manifest.source.commit !== prefix.source?.commit ||
      manifest.source.dirty !== '') throw new Error('block/prefix source or input identity mismatch');
  if (!/^[a-f0-9]{64}$/.test(manifest.checkpoint?.sha256) || manifest.checkpoint.sha256 !== prefix.checkpoint?.sha256) {
    throw new Error('block/prefix checkpoint identity mismatch');
  }
  const backend = manifest.effectiveBackend;
  if (manifest.referenceRoute !== REFERENCE_ROUTE || backend?.device !== 'Device(gpu, 0)' ||
      backend.attention !== 'fast' || backend.qk?.backend !== 'mlx-sum' ||
      backend.layernorm?.backend !== 'mlx-two-pass' || backend.rope?.backend !== 'inherit' ||
      manifest.fullModelExecutions !== 0 || manifest.blockExecutions !== 1) throw new Error('single-block reference route or effective backend mismatch');
  const plan = buildSparseBlockPlan(manifest.config);
  if (plan.rows !== 4096 || plan.channels !== 1536 || plan.heads !== 12 || plan.contextRows !== 1029 || plan.contextChannels !== 1024 || plan.hidden !== 8192 ||
      prefix.config.resolution !== plan.resolution || prefix.config.channels !== plan.channels) throw new Error('real block/prefix configuration mismatch');
  for (const name of BLOCK_OBSERVATIONS) {
    const width = name === 'mlp_fc1' || name === 'mlp_gelu' ? plan.hidden : plan.channels;
    const row = manifest.tensors?.[`expected.${name}`];
    if (!row || JSON.stringify(row.shape) !== JSON.stringify([plan.rows, width]) || row.dtype !== 'float32' ||
        row.byteLength !== plan.rows * width * 4 || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error(`partial block reference: ${name}`);
  }
  return plan;
}

// The browser consumes its actual resident exit; the canonical reference used
// the saved MLX exit. This admits composition evidence, not same-input parity.
export function validateBlockChainFixture(next, first, prefix, prefixSha256, firstSha256) {
  validateBlockFixture(first, prefix, prefixSha256);
  const plan = validateBlockFixture(next, prefix, prefixSha256, { blockIndex: 1 });
  if (!/^[a-f0-9]{64}$/.test(firstSha256) || next.inputBlock?.sha256 !== firstSha256 ||
      next.inputBlock.blockIndex !== 0 || next.inputBlock.tensorSha256 !== first.tensors['expected.after_mlp'].sha256) {
    throw new Error('consecutive block hidden reference identity mismatch');
  }
  if (!/^[a-f0-9]{64}$/.test(first.conditioning?.sha256) || next.conditioning?.sha256 !== first.conditioning.sha256) {
    throw new Error('consecutive block conditioning source mismatch');
  }
  for (const name of ['conditioning', 'phases', 'gelu']) {
    if (!/^[a-f0-9]{64}$/.test(first.tensors[name]?.sha256) || next.tensors[name]?.sha256 !== first.tensors[name].sha256) {
      throw new Error(`consecutive block common input changed: ${name}`);
    }
  }
  for (const [name, shape] of Object.entries(sparseBlockWeightShapes(plan))) {
    const row = next.tensors[name];
    if (!row || !row.checkpointKey?.startsWith('blocks.1.') || JSON.stringify(row.shape) !== JSON.stringify(shape) ||
        row.dtype !== 'float32' || row.byteLength !== shape.reduce((a, b) => a * b, 4) || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      throw new Error(`partial or wrong-block weight: ${name}`);
    }
  }
  return plan;
}
