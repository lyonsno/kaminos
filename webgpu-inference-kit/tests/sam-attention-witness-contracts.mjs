import assert from 'node:assert/strict';
import { attentionCases, attentionFixture, attentionOracle, compareAttention } from './sam-attention-browser-cases.mjs';
import { validateAttentionWitness, validateAttentionBrowser } from './sam-attention-witness-checks.mjs';

assert.throws(() => compareAttention(new Float32Array(), new Float32Array()), /nonempty/);
assert.throws(() => compareAttention(new Float32Array(3), new Float32Array(2)), /equal-length/);
assert.throws(() => compareAttention(new Float32Array([NaN]), new Float32Array([0])), /nonfinite/);
assert.throws(() => compareAttention(new Float32Array([1]), new Float32Array([Infinity])), /nonfinite/);
assert.deepEqual(compareAttention(new Float32Array([1, 2]), new Float32Array([1, 3])), { count: 2, maxAbs: 1, rms: Math.sqrt(0.5), differing: 1 });
assert.equal(new Set(attentionCases.map(row => row.shader)).size, 7);
for (const spec of attentionCases.filter(row => row.name !== 'long-spatial-keys')) {
  const fixture = attentionFixture(spec);
  assert.equal(fixture.q.length, spec.domains * spec.queries * spec.heads * spec.dim);
  const oracle = attentionOracle(spec, fixture);
  assert.equal(compareAttention(oracle, oracle).maxAbs, 0);
  if (spec.allMasked) {
    for (let query = 0; query < spec.queries; query++) {
      for (let d = 0; d < spec.dim; d++) {
        const mean = fixture.v.reduce((sum, value, i) => i % spec.dim === d ? sum + value / spec.keys : sum, 0);
        assert.ok(Math.abs(oracle[query * spec.dim + d] - mean) < 1e-12);
      }
    }
  }
}
console.log('SAM attention witness contracts passed');

const report = {
  expectedCommit: 'candidate', commit: 'candidate', baselineCommit: 'baseline',
  requestedRoute: 'http://127.0.0.1:1234/', effectiveRoute: 'http://127.0.0.1:1234/',
  expectedVendor: 'apple', backend: { vendor: 'apple', isFallbackAdapter: false },
  cases: attentionCases.map(spec => {
    const values = Array.from({ length: spec.domains * spec.queries * spec.heads * spec.dim }, (_, i) => i / 100);
    return { spec, baseline: { values: values.slice(), timingsMs: [1, 2, 3] }, candidate: { values: values.slice(), timingsMs: [1, 2, 3] }, oracle: values.slice() };
  }),
};
validateAttentionWitness(report);
for (const corrupt of [
  value => { value.backend.isFallbackAdapter = true; },
  value => { value.backend.vendor = 'software'; },
  value => { value.effectiveRoute += 'fallback'; },
  value => { value.commit = 'stale'; },
  value => { value.cases.pop(); },
  value => { value.cases[1] = value.cases[0]; },
  value => { value.cases[0].candidate.values.pop(); },
  value => { value.cases[0].candidate.values[0] = NaN; },
  value => { value.cases[0].candidate.values[0] += 0.1; },
  value => { value.cases[0].candidate.timingsMs = []; },
]) {
  const bad = structuredClone(report); corrupt(bad);
  assert.throws(() => validateAttentionWitness(bad));
}
assert.throws(() => validateAttentionBrowser('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), /independent/);
assert.throws(() => validateAttentionBrowser('/private/tmp/chrome'), /independent/);
validateAttentionBrowser('/Users/test/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
