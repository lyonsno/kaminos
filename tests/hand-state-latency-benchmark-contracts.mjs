import assert from 'node:assert/strict';

import { summarizeLatencySamples } from '../hand-state-latency-benchmark.mjs';

const sample = (frameId, value) => ({
  schema: 'hand-state.viewer-latency-sample.v0',
  frameId,
  runtimeOwner: 'hand-state-runtime',
  sourceAuthority: 'live_simulation',
  requestedRoute: 'hand-state-runtime/wilor-mini-mlx-sidecar/live-glove-input',
  effectiveRoute: 'native_wilor_mini_mlx_detector_sidecar_live',
  model: 'WiLoR-MLX+HandDetector-MLX',
  deviceRoute: 'mlx',
  dtypeRoute: 'float32',
  manoVertexCount: 778,
  manoFaceCount: 1538,
  modelLatencyMs: value,
  captureToSidecarPublishMs: value + 40,
  publishToViewerReceiveMs: 8,
  captureToViewerReceiveMs: value + 48,
  captureToRenderCompleteMs: value + 60,
  clientEncodeMs: 5,
  nativePostMs: 3,
});

const report = summarizeLatencySamples([
  sample('frame-1', 10),
  sample('frame-2', 20),
  sample('frame-3', 30),
  sample('frame-4', 40),
]);

assert.equal(report.schema, 'hand-state.viewer-latency-benchmark.v0');
assert.equal(report.sampleCount, 4);
assert.equal(report.runtimeOwner, 'hand-state-runtime');
assert.equal(report.effectiveRoute, 'native_wilor_mini_mlx_detector_sidecar_live');
assert.equal(report.manoVertexCount, 778);
assert.equal(report.manoFaceCount, 1538);
assert.deepEqual(report.distributions.modelLatencyMs, {
  min: 10,
  mean: 25,
  p50: 20,
  p90: 40,
  p95: 40,
  p99: 40,
  max: 40,
});
assert.equal(report.distributions.captureToRenderCompleteMs.p50, 80);

assert.throws(
  () => summarizeLatencySamples([]),
  /no live latency samples/i,
  'blank benchmark output must fail loud',
);
assert.throws(
  () => summarizeLatencySamples([sample('frame-1', 10), sample('frame-1', 20)]),
  /duplicate frame/i,
  'replayed frames must not pretend to be independent evidence',
);
assert.throws(
  () => summarizeLatencySamples([{ ...sample('frame-1', 10), sourceAuthority: 'fallback' }]),
  /source authority/i,
  'fallback state must not enter a live benchmark',
);
assert.throws(
  () => summarizeLatencySamples([{ ...sample('frame-1', 10), effectiveRoute: 'browser-fallback' }]),
  /effective route/i,
  'wrong backend must not enter a WiLoR benchmark',
);
assert.throws(
  () => summarizeLatencySamples([{ ...sample('frame-1', 10), manoVertexCount: 0 }]),
  /MANO geometry/i,
  'skeleton-only or missing output must not count as full-MANO evidence',
);
assert.throws(
  () => summarizeLatencySamples([{ ...sample('frame-1', 10), captureToRenderCompleteMs: null }]),
  /captureToRenderCompleteMs/i,
  'partial output must not masquerade as end-to-render evidence',
);

console.log('hand-state latency benchmark contracts passed');
