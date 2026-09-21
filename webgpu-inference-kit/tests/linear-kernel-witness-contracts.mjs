import assert from 'node:assert/strict';
import * as checks from './linear-kernel-witness-checks.mjs';

assert.equal(typeof checks.validateLinearKernelInventory, 'function', 'activation cases must be mandatory');
assert.equal(typeof checks.validateLinearKernelSource, 'function', 'pin the evaluator to a clean admitted commit');
const commit = 'a'.repeat(40);
checks.validateLinearKernelSource({ expectedCommit: commit, commit, dirty: '' });
for (const value of [{ expectedCommit: commit, commit: 'b'.repeat(40), dirty: '' },
  { expectedCommit: commit, commit, dirty: ' M tests/linear-kernel-witness-checks.mjs' },
  { expectedCommit: undefined, commit, dirty: '' }]) {
  assert.throws(() => checks.validateLinearKernelSource(value));
}
const inventory = [];
for (const variant of ['sequential4', 'split4', 'split4-range']) {
  for (const transposed of variant === 'sequential4' ? [0] : [0, 1]) {
    for (const channels of variant === 'sequential4' ? [8, 1024] : [7, 8]) {
      for (const activation of ['identity', 'relu', 'helper']) inventory.push({ variant, transposed, channels, activation });
    }
  }
}
checks.validateLinearKernelInventory(inventory);
assert.throws(() => checks.validateLinearKernelInventory(inventory.filter(row => row.activation !== 'helper')));
assert.throws(() => checks.validateLinearKernelInventory([...inventory.slice(1), inventory[1]]));

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
validateLinearKernelCase({ ...row, linearExpected: [-1, 2], expected: [0, 2], arms: [
  { arm: 'original', output: [-1, 2] }, { arm: 'f32', output: [0, 2] }, { arm: 'f16-packed-u32', output: [0, 2] },
] });
console.log('linear numerical-witness falsifiers passed');
