import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const module = new URL('../sparse-witness-finalize.mjs', import.meta.url);
assert.ok(existsSync(module), 'Witness cleanup must not suppress the terminal failure report (observed profile ENOTEMPTY).');
const { finalizeSparseWitness } = await import(module);
const report = { status: 'failed', phase: 'native-block-execution', error: { message: 'primary browser failure' } };
const order = []; let persisted;
await finalizeSparseWitness({ report, cleanup: [
  ['browser', async () => { order.push('browser'); }],
  ['child', async () => { order.push('child'); }],
  ['server', async () => { order.push('server'); }],
  ['profile', async () => { order.push('profile'); throw Object.assign(new Error('directory not empty'), { code: 'ENOTEMPTY' }); }],
], persist: async () => { order.push('report'); persisted = structuredClone(report); } });
assert.deepEqual(order, ['browser', 'child', 'server', 'profile', 'report']);
assert.equal(persisted.error.message, 'primary browser failure');
assert.equal(persisted.phase, 'native-block-execution');
assert.equal(persisted.cleanupErrors[0].phase, 'profile');
assert.equal(persisted.cleanupErrors[0].code, 'ENOTEMPTY');
assert.ok(persisted.finishedAt);
const otherwisePassed = { status: 'succeeded', phase: null };
await finalizeSparseWitness({ report: otherwisePassed, cleanup: [['child', async () => { throw new Error('child still owned'); }]], persist: async () => {} });
assert.equal(otherwisePassed.status, 'failed');
assert.equal(otherwisePassed.phase, 'cleanup');
assert.match(otherwisePassed.error.message, /cleanup/);
console.log('Observed cleanup failure preserves primary error/phase, performs remaining cleanup, and always writes terminal report.');
