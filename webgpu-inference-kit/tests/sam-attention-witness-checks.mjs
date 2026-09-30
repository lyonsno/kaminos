import assert from 'node:assert/strict';
import { attentionCases, compareAttention } from './sam-attention-browser-cases.mjs';

export function validateAttentionBrowser(executable) {
  assert.ok(/\/(?:ms-playwright|chrome-for-testing)\//i.test(executable), 'an independent Playwright or Chrome for Testing executable is required');
  assert.doesNotMatch(executable, /Google Chrome\.app\//, 'installed GUI Chrome is not an independent browser');
}

export function validateAttentionWitness(report) {
  assert.ok(report.expectedCommit && report.baselineCommit, 'both source revisions are required');
  assert.equal(report.commit, report.expectedCommit, 'candidate revision changed');
  assert.equal(report.effectiveRoute, report.requestedRoute, 'effective page differs from requested page');
  assert.equal(report.backend?.isFallbackAdapter, false, 'fallback WebGPU does not verify the native kernel');
  assert.equal(report.backend.vendor.toLowerCase(), report.expectedVendor.toLowerCase(), 'unexpected adapter vendor');
  assert.equal(report.cases.length, attentionCases.length, 'incomplete attention case inventory');
  for (let i = 0; i < attentionCases.length; i++) {
    const row = report.cases[i];
    assert.deepEqual(row.spec, attentionCases[i], 'wrong or duplicate attention case');
    const count = row.spec.domains * row.spec.queries * row.spec.heads * row.spec.dim;
    assert.equal(row.candidate.values.length, count, 'incomplete output');
    const baselineComparison = compareAttention(new Float32Array(row.candidate.values), new Float32Array(row.baseline.values));
    const oracleComparison = compareAttention(new Float32Array(row.candidate.values), new Float64Array(row.oracle));
    assert.ok(baselineComparison.maxAbs <= 1e-6, `${row.spec.name}: old/new error ${baselineComparison.maxAbs}`);
    assert.ok(oracleComparison.maxAbs <= 5e-5, `${row.spec.name}: f64 oracle error ${oracleComparison.maxAbs}`);
    for (const result of [row.baseline, row.candidate]) {
      assert.equal(result.timingsMs.length, 3, 'missing timing samples');
      assert.ok(result.timingsMs.every(value => Number.isFinite(value) && value > 0), 'invalid timing sample');
    }
  }
}
