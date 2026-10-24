// kaminos-test: node
import assert from 'node:assert/strict';
import { admitFrozenStdResult } from '../frozen-std-witness-checks.mjs';
const expected = { shaderSha256: 'a'.repeat(64), caseIds: ['hr1', 'hr4'], repeats: 3 };
const good = { backend: { vendor: 'apple', architecture: 'apple-metal-3', isFallbackAdapter: false },
  shaderSha256: expected.shaderSha256, rows: expected.caseIds.flatMap(id =>
    Array.from({ length: 3 }, (_, trial) => ({ id, trial, actual: [0.5, 0.7], expected: [0.5, 0.7] }))) };
assert.equal(admitFrozenStdResult(good, expected).exact, true);
const mutate = fn => { const r = structuredClone(good); fn(r); return r; };
for (const change of [r => r.rows.pop(), r => r.rows.push(r.rows[0]),
  r => r.rows[0].id = 'another-input', r => r.rows[0].trial = 9,
  r => r.backend.isFallbackAdapter = true, r => r.backend.vendor = 'google',
  r => r.shaderSha256 = 'b'.repeat(64), r => r.rows[0].actual = [0.5],
  r => r.rows[0].actual[0] = NaN, r => r.rows[0].expected[0] = Infinity]) {
  assert.throws(() => admitFrozenStdResult(mutate(change), expected));
}
const observedCorruptScalar = mutate(r => { r.rows[0].actual = [1e-12, 1e-6]; });
assert.equal(admitFrozenStdResult(observedCorruptScalar, expected).exact, false,
  'Finite corrupt output must remain a numerical mismatch, never a successful parity result.');
console.log('Frozen standard-deviation witness rejects fallback, changed source, incomplete/duplicate cases and finite corruption.');
