import assert from 'node:assert/strict';
import { summarizeFlameSpan, compositionVerdict } from '../lib/kimodo-flame-evidence.mjs';
const sample = (t, frameCount, simStepCount, extra = {}) => ({t, frameCount, simStepCount, active: true, backend: 'WebGPU:apple', visibility: 'visible', ...extra});
const advancing = summarizeFlameSpan([sample(0, 1, 1), sample(20, 2, 2), sample(60, 3, 3)]);
assert.equal(advancing.status, 'advancing');
assert.equal(advancing.pageCadence.maxMs, 40);
assert.equal(advancing.frameDelta, 2);
assert.equal(summarizeFlameSpan([sample(0, 1, 1), sample(20, 1, 1)]).status, 'stalled', 'rAF movement cannot establish flame movement');
for (const extra of [{active:false}, {backend:'fallback'}, {error:'device lost'}, {frameCount:null}, {simStepCount:null}]) {
  assert.equal(summarizeFlameSpan([sample(0, 1, 1), sample(20, 2, 2, extra)]).status, 'unverified');
}
assert.equal(summarizeFlameSpan([sample(0, 5, 5), sample(20, 2, 2)]).status, 'unverified', 'counter reset is not forward movement');
assert.equal(summarizeFlameSpan([]).status, 'unverified');
const telemetry = {status:'succeeded',route:{effectiveRouteId:'kimodo'}};
const distributed=summarizeFlameSpan(Array.from({length:30},(_,i)=>sample(i*20,i,i)));
const input = {telemetry, baseline:advancing, inference:distributed, expectedRoute:'kimodo'};
assert.equal(compositionVerdict(input), 'coexistence-observed');
assert.equal(compositionVerdict({...input, telemetry:{...telemetry, status:'invalid'}}), 'generation-unverified');
assert.equal(compositionVerdict({...input, expectedRoute:'other'}), 'generation-unverified');
assert.equal(compositionVerdict({...input, inference:{...advancing, status:'stalled'}}), 'flame-unverified');
assert.equal(compositionVerdict({...input, inference:{...distributed, hiddenSampleCount:1}}), 'visibility-confounded');
console.log('Kimodo/flame evidence: advancement, fallback, reset, route, and visibility controls pass');
for (const counts of [i=>[Math.min(i,1),Math.min(i,1)], i=>[0,0], i=>[i,Math.min(i,1)]]) {
  const span=summarizeFlameSpan(Array.from({length:1000},(_,i)=>sample(i*16,...counts(i))));
  assert.equal(compositionVerdict({...input,inference:span}),'flame-unverified','a healthy page cadence cannot hide stalled flame counters');
}
assert.equal(compositionVerdict({...input,inference:summarizeFlameSpan(Array.from({length:1000},(_,i)=>sample(i*16,i,i)))}),'coexistence-observed');
