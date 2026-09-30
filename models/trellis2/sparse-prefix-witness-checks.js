import { buildSparsePrefixPlan, SPARSE_PREFIX_ROUTE } from './sparse-prefix.js';

// One BF16 spacing relative to the reference, plus a small absolute allowance
// for f32 cancellation. Fixed before the first native run; not bitwise parity.
export const PREFIX_TOLERANCE = Object.freeze({ atol: 0.0001, rtol: 1 / 128 });
export function comparePrefixTensor(actual, expected) {
  if (!actual.length || !expected.length) throw new Error('empty tensor cannot establish parity');
  if (actual.length !== expected.length) throw new Error('tensor length mismatch');
  let maxAbs = 0, squared = 0, failures = 0, exactCount = 0, worstIndex = 0;
  for (let i = 0; i < actual.length; i++) {
    if (!Number.isFinite(actual[i]) || !Number.isFinite(expected[i])) throw new Error(`non-finite tensor at ${i}`);
    const delta = Math.abs(actual[i] - expected[i]);
    if (delta > maxAbs) { maxAbs = delta; worstIndex = i; }
    squared += delta * delta;
    if (delta > PREFIX_TOLERANCE.atol + PREFIX_TOLERANCE.rtol * Math.abs(expected[i])) failures++;
    if (actual[i] === expected[i]) exactCount++;
  }
  return { passed: failures === 0, count: actual.length, failures, exactCount, maxAbs,
    rmse: Math.sqrt(squared / actual.length), worstIndex, actualAtWorst: actual[worstIndex],
    expectedAtWorst: expected[worstIndex], tolerance: PREFIX_TOLERANCE };
}
export function validateNativePrefixBackend(backend) {
  if (backend.vendor?.toLowerCase() !== 'apple' || backend.isFallbackAdapter ||
    /swiftshader|software/i.test(backend.description || '')) throw new Error('native Apple WebGPU adapter required');
}
export function validatePrefixRoute(requested, effective) {
  if (requested !== SPARSE_PREFIX_ROUTE || effective !== requested) throw new Error('effective prefix route mismatch');
}
export function validatePrefixFixture(manifest) {
  if (manifest?.schema !== 'trellis2.sparse-prefix-reference.v0' || manifest.status !== 'succeeded') {
    throw new Error('a complete sparse prefix reference is required');
  }
  const plan = buildSparsePrefixPlan(manifest.config);
  const shapes = { sample: plan.inputShape, timestep: [1], 'expected.projected': plan.projectedShape,
    'expected.modulation': plan.modulationShape };
  for (const [name, shape] of Object.entries(shapes)) {
    const row = manifest.tensors?.[name];
    if (!row || JSON.stringify(row.shape) !== JSON.stringify(shape) || row.dtype !== 'float32' ||
      row.byteLength !== shape.reduce((a, b) => a * b, 4) || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      throw new Error(`partial or incompatible fixture tensor: ${name}`);
    }
  }
  return plan;
}
