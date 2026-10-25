// Diagnostic instrumentation for the model witness, not a serving scheduler.
import { adjudicatePupExpansion } from './pup-witness-contract.js';

export async function withModelProfile(model, work, { profile = {}, now = () => performance.now() } = {}) {
  const names = ['createState', 'prefill', 'decode', 'disposeState', 'dispatch'];
  const originals = names.map(name => ({ name, own: Object.getOwnPropertyDescriptor(model, name), fn: model[name] }));
  if (originals.some(x => typeof x.fn !== 'function')) throw new Error('complete model required for profiling');
  Object.assign(profile, { schema: 'kaminos.qwen35-serving-profile.v1', clock: 'performance.now-wall-ms',
    diagnosticReadbacks: Boolean(model.onLayer || model.onNorm), calls: [], duties: {}, completed: false, startedMs: now() });
  try {
    for (const { name, fn } of originals) model[name] = async function (...args) {
      const startMs = now(), row = { operation: name, startMs, status: 'failed' };
      if (name === 'prefill' || name === 'decode') Object.assign(row, { inputTokens: name === 'prefill' ? args[0].length : 1, pastTokens: args[1].length });
      if (name !== 'dispatch') profile.calls.push(row);
      try { const value = await fn.apply(this, args); row.status = 'passed'; return value; }
      finally {
        row.endMs = now(); row.ms = row.endMs - startMs;
        if (name === 'dispatch') {
          const duty = profile.duties[args[0]] ??= { count: 0, totalMs: 0, maxMs: 0, failures: 0 };
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
  const adapter = result?.adapter;
  if (result?.backend !== 'webgpu' || !adapter || adapter.isFallbackAdapter !== false
    || !['vendor','architecture','device','description'].some(k => String(adapter[k] ?? '').trim())
    || /swiftshader|software|llvmpipe|lavapipe/i.test(Object.values(adapter).join(' '))) throw new Error('native WebGPU adapter required');
  if (result.weightsManifestSha256 !== expected.weightsManifestSha256) throw new Error('wrong model source identity');
  if (!Array.isArray(result.errors) || result.errors.length || !Array.isArray(result.rows) || result.rows.length) throw new Error('serving errors or diagnostic readbacks');
  if (result.cleanup?.states !== 0 || result.cleanup?.weights !== 0 || result.cleanup?.borrowedControl !== 'running') throw new Error('serving cleanup incomplete');
  const output = adjudicatePupExpansion(result.expansion, expected), p = result.profile;
  const finite = x => Number.isFinite(x) && x >= 0;
  if (!p || p.schema !== 'kaminos.qwen35-serving-profile.v1' || p.clock !== 'performance.now-wall-ms' || p.diagnosticReadbacks !== false
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
    otherGenerationMs: p.totalMs-prefill.ms-decodeMs, dutyTiming: 'wall time including admission, compilation and queue fence; not GPU timestamp time' };
}
