// Diagnostic instrumentation for the model witness, not a serving scheduler.
import { adjudicatePupExpansion } from './pup-witness-contract.js';

export async function withModelProfile(model, work, { profile = {}, now = () => performance.now() } = {}) {
  const names = ['createState', 'prefill', 'decode', 'disposeState', 'dispatch'];
  if (typeof model.layerBatch === 'function') names.push('layerBatch');
  const originals = names.map(name => ({ name, own: Object.getOwnPropertyDescriptor(model, name), fn: model[name] }));
  if (originals.some(x => typeof x.fn !== 'function')) throw new Error('complete model required for profiling');
  Object.assign(profile, { schema: `kaminos.qwen35-serving-profile.v${model.batchDecode === true ? 2 : 1}`, clock: 'performance.now-wall-ms',
    diagnosticReadbacks: Boolean(model.onLayer || model.onNorm), calls: [], duties: {}, completed: false, startedMs: now(),
    dispatchTiming: model.batchDecode === true ? 'mixed-encoded-and-fenced' : 'fenced-leaf',
    layerBatches: { count: 0, totalMs: 0, maxMs: 0, failures: 0 } });
  try {
    for (const { name, fn } of originals) model[name] = async function (...args) {
      const startMs = now(), row = { operation: name, startMs, status: 'failed' };
      if (name === 'prefill' || name === 'decode') Object.assign(row, { inputTokens: name === 'prefill' ? args[0].length : 1, pastTokens: args[1].length });
      if (name !== 'dispatch' && name !== 'layerBatch') profile.calls.push(row);
      try { const value = await fn.apply(this, args); row.status = 'passed'; return value; }
      finally {
        row.endMs = now(); row.ms = row.endMs - startMs;
        if (name === 'dispatch') {
          const duty = profile.duties[args[0]] ??= { count: 0, totalMs: 0, maxMs: 0, failures: 0 };
          duty.count++; duty.totalMs += row.ms; duty.maxMs = Math.max(duty.maxMs, row.ms); duty.failures += Number(row.status !== 'passed');
        } else if (name === 'layerBatch') {
          const duty = profile.layerBatches;
          duty.count++; duty.totalMs += row.ms; duty.maxMs = Math.max(duty.maxMs, row.ms); duty.failures += Number(row.status !== 'passed');
        }
      }
    };
    const output = await work(); profile.completed = true; return output;
  } finally {
    profile.finishedMs = now(); profile.totalMs = profile.finishedMs - profile.startedMs;
    for (const { name, own } of originals) { if (own) Object.defineProperty(model, name, own); else delete model[name]; }
  }
}

export function adjudicateServingProfile(result, expected) {
  if (expected.batchDecode !== undefined) {
    adjudicateBatchSelection(result, expected.batchDecode);
    const duty = result.profile?.layerBatches;
    if (!duty || duty.count !== result.layerBatchSubmissions || duty.failures !== 0
      || [duty.totalMs, duty.maxMs].some(x => !Number.isFinite(x) || x < 0) || duty.maxMs > duty.totalMs || duty.totalMs > result.profile.totalMs
      || result.profile.dispatchTiming !== (expected.batchDecode ? 'mixed-encoded-and-fenced' : 'fenced-leaf')) throw new Error('wrong or incomplete layer batch timing evidence');
  }
  if (expected.singleTokenKernel !== undefined) {
    adjudicateAffineSelection(result, expected.singleTokenKernel);
    for (const name of ['affine', 'affine-quad', 'affine-tiled']) {
      if (result.affineDispatches[name] !== (result.profile?.duties?.[name]?.count ?? 0)) throw new Error('affine dispatch/profile kernel mismatch');
    }
  }
  const adapter = result?.adapter;
  if (result?.backend !== 'webgpu' || !adapter || adapter.isFallbackAdapter !== false
    || !['vendor','architecture','device','description'].some(k => String(adapter[k] ?? '').trim())
    || /swiftshader|software|llvmpipe|lavapipe/i.test(Object.values(adapter).join(' '))) throw new Error('native WebGPU adapter required');
  if (result.weightsManifestSha256 !== expected.weightsManifestSha256) throw new Error('wrong model source identity');
  if (!Array.isArray(result.errors) || result.errors.length || !Array.isArray(result.rows) || result.rows.length) throw new Error('serving errors or diagnostic readbacks');
  if (result.cleanup?.states !== 0 || result.cleanup?.weights !== 0 || result.cleanup?.borrowedControl !== 'running') throw new Error('serving cleanup incomplete');
  const output = adjudicatePupExpansion(result.expansion, expected), p = result.profile;
  const finite = x => Number.isFinite(x) && x >= 0;
  if (!p || p.schema !== `kaminos.qwen35-serving-profile.v${expected.batchDecode === true ? 2 : 1}` || p.clock !== 'performance.now-wall-ms' || p.diagnosticReadbacks !== false
    || p.completed !== true || ![p.startedMs,p.finishedMs,p.totalMs,p.firstTextMs,p.loadMs,p.inputPreparationMs].every(finite)
    || p.finishedMs <= p.startedMs || Math.abs(p.finishedMs-p.startedMs-p.totalMs) > 1e-6 || p.firstTextMs > p.totalMs || !Array.isArray(p.calls)) throw new Error('incomplete/malformed serving clocks');
  let previous = p.startedMs;
  for (const row of p.calls) {
    if (row.status !== 'passed' || ![row.startMs,row.endMs,row.ms].every(finite) || row.startMs < previous || row.endMs < row.startMs
      || row.endMs > p.finishedMs || Math.abs(row.endMs-row.startMs-row.ms) > 1e-6) throw new Error('invalid model-call timeline');
    previous = row.endMs;
  }
  const calls = p.calls, decodes = calls.slice(2,-1), prefill = calls[1];
  if (calls.length !== output.generatedTokens + 2 || calls[0]?.operation !== 'createState' || calls.at(-1)?.operation !== 'disposeState'
    || prefill?.operation !== 'prefill' || prefill.inputTokens !== output.inputTokens || prefill.pastTokens !== 0
    || decodes.some((r,i) => r.operation !== 'decode' || r.inputTokens !== 1 || r.pastTokens !== output.inputTokens+i)) throw new Error('missing/extra/wrong model calls');
  const duties = Object.values(p.duties ?? {});
  if (!duties.length || duties.some(d => !Number.isSafeInteger(d.count) || d.count < 1 || d.failures !== 0 || !finite(d.totalMs) || !finite(d.maxMs) || d.maxMs > d.totalMs)
    || duties.reduce((n,d)=>n+d.totalMs,0) > p.totalMs+1e-6) throw new Error('invalid duty timings');
  const decodeMs = decodes.reduce((n,r)=>n+r.ms,0);
  if (prefill.ms <= 0 || (decodes.length && decodeMs <= 0)) throw new Error('zero-duration inference');
  return { ...output, loadMs: p.loadMs, inputPreparationMs: p.inputPreparationMs, totalMs: p.totalMs, firstTextMs: p.firstTextMs,
    prefillMs: prefill.ms, prefillTokensPerSecond: 1000*output.inputTokens/prefill.ms,
    decodeMs, decodeCalls: decodes.length, decodeTokensPerSecond: decodes.length ? 1000*decodes.length/decodeMs : null,
    otherGenerationMs: p.totalMs-prefill.ms-decodeMs, maxLayerDutyMs: p.layerBatches?.maxMs ?? null,
    dutyTiming: expected.batchDecode ? 'batched dispatches measure encoding; layer duties include admission and queue fence; do not add overlapping durations'
      : 'wall time including admission, compilation and queue fence; not GPU timestamp time' };
}

export function adjudicateBatchSelection(result, expected) {
  if (typeof expected !== 'boolean' || result?.batchDecode !== expected || !Number.isSafeInteger(result.layerBatchSubmissions)
    || result.layerBatchSubmissions < (expected ? 1 : 0) || (!expected && result.layerBatchSubmissions !== 0)) throw new Error('wrong or missing layer batch submission evidence');
  const duty = result.layerBatchDuty;
  if (!duty || duty.count !== result.layerBatchSubmissions || duty.failures !== 0
    || [duty.totalMs, duty.maxMs].some(x => !Number.isFinite(x) || x < 0) || duty.maxMs > duty.totalMs
    || (duty.count === 0 && (duty.totalMs !== 0 || duty.maxMs !== 0))) throw new Error('wrong or missing layer batch duty evidence');
}

export function adjudicateAffineSelection(result, expected) {
  if ((expected !== 'oracle' && expected !== 'quad') || result?.singleTokenKernel !== expected) throw new Error('wrong or missing single-token kernel');
  const counts = result.affineDispatches;
  if (!counts || ['affine', 'affine-quad', 'affine-tiled'].some(k => !Number.isSafeInteger(counts[k]) || counts[k] < 0)
    || counts[expected === 'quad' ? 'affine-quad' : 'affine'] < 1
    || counts[expected === 'quad' ? 'affine' : 'affine-quad'] !== 0) throw new Error('wrong or missing affine kernel dispatch evidence');
}

// Complete real expansions bracket the candidate with the existing kernel in
// one browser/model residency. Clocks retain their common performance.now epoch.
export function adjudicateServingComparison(result, expected) {
  const comparison = result?.comparison, axis = expected.comparisonAxis ?? comparison?.axis ?? 'kernel';
  if (!['kernel', 'batchDecode'].includes(axis) || (expected.comparisonAxis !== undefined && comparison?.axis !== expected.comparisonAxis)
    || (expected.singleTokenKernel !== undefined && expected.singleTokenKernel !== 'oracle') || expected.batchDecode === true) throw new Error('wrong or ambiguous comparison axis');
  const kernels = axis === 'batchDecode' ? ['oracle', 'oracle', 'oracle'] : ['oracle', 'quad', 'oracle'];
  const batchModes = [false, axis === 'batchDecode', false], requireBatch = axis === 'batchDecode' || expected.batchDecode !== undefined;
  if (comparison?.schema !== 'kaminos.qwen35-serving-comparison.v1' || !Array.isArray(comparison.runs) || comparison.runs.length !== kernels.length
    || [comparison.sharedLoadMs, comparison.sharedInputPreparationMs].some(x => !Number.isFinite(x) || x < 0)) throw new Error('incomplete serving comparison');
  let previousEnd = -Infinity, first;
  const runs = comparison.runs.map((row, index) => {
    if (row.index !== index || row.statesAfter !== 0 || row.profile?.startedMs < previousEnd) throw new Error('wrong comparison order, overlapping clocks or unretired request state');
    const verdict = adjudicateServingProfile({ ...result, expansion: row.expansion, profile: row.profile,
      singleTokenKernel: row.singleTokenKernel, affineDispatches: row.affineDispatches, batchDecode: row.batchDecode, layerBatchSubmissions: row.layerBatchSubmissions,
      layerBatchDuty: row.profile?.layerBatches },
      { ...expected, singleTokenKernel: kernels[index], ...(requireBatch ? { batchDecode: batchModes[index] } : {}) });
    previousEnd = row.profile.finishedMs;
    const output = row.expansion.output;
    if (first && (output.text !== first.text || output.stopTokenId !== first.stopTokenId
      || output.tokenIds.length !== first.tokenIds.length || output.tokenIds.some((id, i) => id !== first.tokenIds[i]))) throw new Error('complete comparison outputs disagree');
    first ??= output;
    return { index, singleTokenKernel: kernels[index], ...(requireBatch ? { batchDecode: batchModes[index] } : {}), ...verdict };
  });
  if (!runs[1].decodeMs) throw new Error('comparison requires actual cached decode');
  return { comparisonAxis: axis, runs, identicalCompleteOutput: true, decodeSpeedupVsBaselines: [runs[0].decodeMs / runs[1].decodeMs, runs[2].decodeMs / runs[1].decodeMs],
    baselineDriftRatio: runs[2].decodeMs / runs[0].decodeMs };
}
