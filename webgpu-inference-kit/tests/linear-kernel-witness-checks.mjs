import assert from 'node:assert/strict';

export function validateLinearKernelCase(row) {
  assert.equal(row.expected.length, row.rows * row.columns);
  assert.ok(row.expected.length > 0 && row.expected.every(Number.isFinite));
  assert.deepEqual(row.arms.map(arm => arm.arm), ['original', 'f32', 'f16-packed-u32']);
  for (const arm of row.arms) {
    assert.ok(arm.output.every(Number.isFinite));
    assert.deepEqual(arm.output, row.expected,
      `${row.variant}/${row.transposed}/${row.channels}/${arm.arm}`);
  }
}
