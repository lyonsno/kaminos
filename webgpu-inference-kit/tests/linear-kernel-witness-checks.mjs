import assert from 'node:assert/strict';

export function validateLinearKernelSource({ expectedCommit, commit, dirty }) {
  assert.match(expectedCommit ?? '', /^[a-f0-9]{40}$/, 'caller must pin a full commit');
  assert.equal(commit, expectedCommit, 'wrong source revision');
  assert.equal(dirty, '', 'source checkout must be clean');
}

export function validateLinearKernelInventory(rows) {
  const expected = [];
  for (const variant of ['sequential4', 'split4', 'split4-range']) {
    for (const transposed of variant === 'sequential4' ? [0] : [0, 1]) {
      for (const channels of variant === 'sequential4' ? [8, 1024] : [7, 8]) {
        for (const activation of ['identity', 'relu', 'helper']) {
          expected.push(`${variant}/${transposed}/${channels}/${activation}`);
        }
      }
    }
  }
  assert.deepEqual(rows.map(row => `${row.variant}/${row.transposed}/${row.channels}/${row.activation}`).sort(), expected.sort());
}

export function validateLinearKernelCase(row) {
  assert.equal(row.expected.length, row.rows * row.columns);
  assert.ok(row.expected.length > 0 && row.expected.every(Number.isFinite));
  if (row.linearExpected) {
    assert.equal(row.linearExpected.length, row.expected.length);
    assert.ok(row.linearExpected.every(Number.isFinite));
  }
  assert.deepEqual(row.arms.map(arm => arm.arm), ['original', 'f32', 'f16-packed-u32']);
  for (const arm of row.arms) {
    assert.ok(arm.output.every(Number.isFinite));
    const expected = arm.arm === 'original' ? row.linearExpected ?? row.expected : row.expected;
    assert.deepEqual(arm.output, expected,
      `${row.variant}/${row.transposed}/${row.channels}/${arm.arm}`);
  }
}
