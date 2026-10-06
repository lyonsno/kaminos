import assert from 'node:assert/strict';
import * as evidence from '../structural-material-arch-gpu-evidence.mjs';

assert.equal(typeof evidence.inspectArchPerformanceTrial, 'function', 'timing evidence needs native-route and complete-sample validation');
const expected = { mode: 'coupled', samples: 2, warmup: 1, renderPasses: 1, appearance: 'stones', bodies: 198, triangles: 19634139, config: { substeps: 4, strength: 80 } };
const trial = { ...expected, visualRoute: 'handy-weathered-stone-v1', identity: { backend: 'webgpu', adapterFallback: false },
  route: 'kaminos.structural-material.arch-gravity-collapse.webgpu-avbd.v0', effectiveUrl: 'http://localhost/structural-material-arch-gpu.html?smoke=1&stones=1',
  viewport: { width: 1280, height: 900, pixelRatio: 1 }, stepBefore: 120, stepAfter: 123,
  observed: Array.from({ length: 2 }, (_, index) => ({ index, milliseconds: 12, stepMilliseconds: 8, renderSubmitMilliseconds: 2, fenceMilliseconds: 2 })) };
assert.deepEqual(evidence.inspectArchPerformanceTrial(trial, expected), []);
for (const mutate of [
  x => x.identity.adapterFallback = true, x => x.identity.backend = 'webgl', x => x.visualRoute = 'box-baseline',
  x => x.effectiveUrl = 'http://localhost/structural-material-arch-gpu.html?smoke=1', x => x.config.substeps = 1,
  x => x.observed.pop(), x => x.observed[1].index = 0, x => x.observed[0].milliseconds = NaN,
  x => x.stepAfter = x.stepBefore, x => x.triangles = 0, x => x.renderPasses = 2,
]) {
  const bad = structuredClone(trial); mutate(bad);
  assert.ok(evidence.inspectArchPerformanceTrial(bad, expected).length, 'invalid or incomplete measurements cannot clear attribution');
}
console.log('Performance evidence rejects fallback, wrong workload, partial samples and missing physical progress');
