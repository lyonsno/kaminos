import assert from 'node:assert/strict';
import * as checks from './linear-kernel-witness-checks.mjs';

assert.equal(typeof checks.validateLinearKernelCase, 'function', 'numerical witness must reject false closure');
const { validateLinearKernelCase } = checks;
const row = { variant: 'sequential4', transposed: 0, channels: 8, rows: 1, columns: 2,
  expected: [1, 2], arms: ['original', 'f32', 'f16-packed-u32'].map(arm => ({ arm, output: [1, 2] })) };
validateLinearKernelCase(row);
for (const output of [[], [0, 0], [1], [1, NaN], [1, Infinity], [1, 3]]) {
  const wrong = structuredClone(row);
  wrong.arms[2].output = output;
  assert.throws(() => validateLinearKernelCase(wrong));
}
const missing = structuredClone(row);
missing.arms.pop();
assert.throws(() => validateLinearKernelCase(missing));
const mislabeled = structuredClone(row);
mislabeled.arms[2].arm = 'f32';
assert.throws(() => validateLinearKernelCase(mislabeled));
console.log('linear numerical-witness falsifiers passed');
