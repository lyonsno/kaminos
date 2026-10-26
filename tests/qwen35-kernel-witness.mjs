// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as contract from '../models/qwen3_5/kernel-witness-contract.js';
import { collectKernelWitness, runKernelWitness } from '../models/qwen3_5/run-kernel-witness.mjs';

// Local admission-policy fixture, not evidence about an external GPU runtime.
function fixture() {
  const meta = { schema: 'kaminos.qwen35-kernel-reference.v1', source: { effective: { backend: 'mlx-metal' } },
    affine: [{ name: 'tiny', tokens: 1, rows: 10 }], gdn: [{ name: 'tiny', tokens: 1 }], attention: {}, chunks: [1], arrays: {} };
  const arrays = new Map();
  for (const name of ['affine-tiny.output', ...['convolved', 'prepared', 'recurrence', 'state', 'gated', 'history'].map(s => `gdn-tiny.${s}`),
    ...['q', 'key-cache', 'value-cache', 'output', 'gated'].map(s => `attention.${s}`)]) {
    const data = new Float32Array(name === 'affine-tiny.output' ? 10 : 2).fill(.5);
    arrays.set(name, data); meta.arrays[name] = { dtype: 'f32', shape: [data.length], bytes: data.byteLength };
  }
  const result = { backend: 'webgpu', adapter: { vendor: 'apple', architecture: 'apple-m4', isFallbackAdapter: false }, errors: [], rows: [] };
  for (const [name, elements] of contract.kernelWitnessContract(meta)) {
    let data = new Float32Array(elements).fill(.5);
    if (name.endsWith('.strided')) { data.fill(-1234); data.set(new Float32Array(7).fill(.5), 2); }
    result.rows.push({ name, elements, nonFinite: 0, relL2: 0, maxAbs: 0, data: Buffer.from(data.buffer).toString('base64') });
  }
  return { meta, arrays, result };
}
test('an explicitly requested affine route cannot close with a missing or different effective kernel', () => {
  const { result, meta, arrays } = fixture();
  assert.throws(() => contract.adjudicateKernelReadbacks(result, meta, arrays, { affineKernel: 'tiled' }), /route/);
  result.affineKernel = 'oracle';
  assert.throws(() => contract.adjudicateKernelReadbacks(result, meta, arrays, { affineKernel: 'tiled' }), /route/);
  result.affineKernel = 'tiled';
  assert.equal(contract.adjudicateKernelReadbacks(result, meta, arrays, { affineKernel: 'tiled' }).rows, 24);
});
test('kernel admission rejects fallback, missing, repeated, partial and errored observations', () => {
  const { meta, result } = fixture();
  assert.equal(contract.validateKernelWitness(result, meta).rows, 24);
  for (const change of [r => { r.backend = 'cpu'; }, r => { r.adapter.isFallbackAdapter = true; }, r => { r.adapter.description = 'SwiftShader'; },
    r => { r.rows = []; }, r => { r.rows.pop(); }, r => { r.rows.push(r.rows[0]); }, r => { r.errors.push('device lost'); },
    r => { r.rows[0].elements--; }, r => { r.rows[0].maxAbs = NaN; }]) {
    const altered = structuredClone(result); change(altered); assert.throws(() => contract.validateKernelWitness(altered, meta));
  }
});
test('host adjudication measures preserved GPU bytes rather than trusting page metrics', () => {
  const { meta, arrays, result } = fixture();
  assert.equal(contract.adjudicateKernelReadbacks(result, meta, arrays).rows, 24);
  const liar = structuredClone(result);
  liar.rows[0].data = Buffer.from(new Float32Array(liar.rows[0].elements).buffer).toString('base64');
  assert.throws(() => contract.adjudicateKernelReadbacks(liar, meta, arrays), /mismatch/);
});
test('host adjudication refuses short and nonfinite raw data with falsely passing metrics', () => {
  const { meta, arrays, result } = fixture();
  for (const value of [new Float32Array(1), new Float32Array(result.rows[0].elements).fill(NaN)]) {
    const liar = structuredClone(result); liar.rows[0].data = Buffer.from(value.buffer).toString('base64');
    assert.throws(() => contract.adjudicateKernelReadbacks(liar, meta, arrays), /partial|mismatch/);
  }
});
test('readback collection preserves every row when the combined result exceeds a transport message', async () => {
  const source = { rows: Array.from({ length: 5 }, (_, index) => ({ name: String(index), data: 'x'.repeat(1024 * 1024) })) };
  const window = { qwenKernelResult: Promise.resolve(source) }, received = [];
  const browser = { async evaluate(expression) {
    const value = await Function('window', `return (${expression})`)(window);
    if (JSON.stringify(value).length > 4 * 1024 * 1024) throw new Error('transport frame rejected');
    return structuredClone(value);
  } };
  const result = await collectKernelWitness(browser, async row => received.push(row));
  assert.deepEqual(result.rows, source.rows); assert.deepEqual(received, source.rows);
});

test('four-row route rejects oracle substitution and admits the exact effective kernel', () => {
  const { result, meta, arrays } = fixture();
  result.affineKernel = 'oracle';
  assert.throws(() => contract.adjudicateKernelReadbacks(result, meta, arrays, { affineKernel: 'quad' }), /route/);
  result.affineKernel = 'quad';
  assert.equal(contract.adjudicateKernelReadbacks(result, meta, arrays, { affineKernel: 'quad' }).rows, 24);
});
test('ambiguous affine requests write a failure report before reference or browser access', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-affine-route-'));
  try {
    const out = path.join(dir, 'report.json');
    const report = await runKernelWitness({ out, fixture: 'absent-fixture', tiledAffine: true, quadAffine: true });
    assert.equal(report.status, 'failed'); assert.equal(report.phase, 'source-admission');
    assert.match(report.error, /ambiguous affine/);
    const saved = JSON.parse(await fs.readFile(out, 'utf8'));
    assert.equal(saved.status, 'failed'); assert.equal(saved.phase, 'source-admission');
    assert.match(saved.error, /ambiguous affine/);
    assert.equal(saved.requested.tiledAffine, true); assert.equal(saved.requested.quadAffine, true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
