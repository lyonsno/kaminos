import assert from 'node:assert/strict';
import * as witness from '../sparse-witness-finalize.mjs';

// The native full-schedule run saved every tensor but lost its browser result
// when the CDP connection closed. Result durability must precede its CDP ack.
assert.equal(typeof witness.persistSparseWitnessResult, 'function', 'Browser result needs an independent durable return before CDP acknowledgment.');
assert.equal(typeof witness.admitSparseWitnessResult, 'function');
const report = {}, writes = [];
const bytes = Buffer.from(JSON.stringify({ status: 'failed', phase: 'numerical-comparison', backend: { vendor: 'apple' }, profile: { stages: Array.from({ length: 2200 }, (_, i) => ({ i })) } }));
const receipt = await witness.persistSparseWitnessResult({ report, bytes, outputPath: '/owned/browser-result.json',
  write: async (path, value) => { writes.push({ path, value }); } });
assert.equal(writes.length, 1); assert.equal(writes[0].value, bytes);
assert.equal(report.result.status, 'failed'); assert.equal(report.result.profile.stages.length, 2200);
assert.equal(report.browserResult.path, '/owned/browser-result.json');
assert.equal(receipt.sha256, report.browserResult.sha256); assert.equal(receipt.byteLength, bytes.length);
assert.equal(witness.admitSparseWitnessResult(report, receipt), report.result);
assert.throws(() => witness.admitSparseWitnessResult(report, { ...receipt, sha256: 'wrong' }), /receipt/);
assert.throws(() => witness.admitSparseWitnessResult({}, receipt), /durable/);
const noWrite = {};
await assert.rejects(witness.persistSparseWitnessResult({ report: noWrite, bytes, outputPath: '/owned/browser-result.json',
  write: async () => { throw new Error('disk write failed'); } }), /disk write/);
assert.equal(noWrite.result, undefined); assert.equal(noWrite.browserResult, undefined);
await assert.rejects(witness.persistSparseWitnessResult({ report: {}, bytes: Buffer.from('{'), outputPath: '/owned/browser-result.json', write: async () => {} }), /JSON/);
await assert.rejects(witness.persistSparseWitnessResult({ report: {}, bytes: Buffer.from('{}'), outputPath: '/owned/browser-result.json', write: async () => {} }), /status/);
console.log('Complete browser result persists before its small CDP acknowledgment; wrong, absent, partial, or unwritten evidence cannot close.');
