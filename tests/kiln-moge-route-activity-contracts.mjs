import assert from 'node:assert/strict';

import { routeActivityFromMogeRouteResult } from '../kiln-moge-route-activity.mjs';
import { bridgeKilnRouteRunToVolumeFire } from '../kiln-volume-fire-bridge.mjs';

// Fixtures mirror the shape moge-webgpu emits: a
// kaminos.webgpu-route-result.v0 worker result whose receipt is a
// kaminos.webgpu-route-receipt.v0 with runtime.schedulerVerification nested.

function mogeRouteResult(overrides = {}) {
  const receipt = {
    schema: 'kaminos.webgpu-route-receipt.v0',
    requestedRouteId: 'moge.depth-normal.webgpu-local.v0',
    effectiveRouteId: 'moge.depth-normal.webgpu-local.v0',
    status: 'real',
    fallbackReason: null,
    runtimeEvidence: { weights: 'real', encoderFeatures: 'backbone-gpu' },
    backend: { kind: 'webgpu-local', runtime: 'browser', adapterName: 'apple-m4-max' },
    model: { id: 'Ruicheng/moge-2-vitl-normal', dtype: 'fp16' },
    inputs: [{ role: 'source-image', artifactId: 'image:bunnycake', sha256: 'sha256:img' }],
    outputs: [
      { role: 'depth', artifactId: 'depth:bunnycake', status: 'real' },
      { role: 'normal', artifactId: 'normal:bunnycake', status: 'real' },
      { role: 'pointmap', artifactId: 'pointmap:bunnycake', status: 'real' },
    ],
    runtime: {
      scheduler: { requestedScheduler: { mode: 'cooperative', yieldMs: 4 } },
      schedulerVerification: { status: 'verified', classification: 'observed-boundary' },
    },
    timings: { source: 'queue-submit-wait', totalMs: 3200 },
    ...overrides.receipt,
  };
  return {
    schema: 'kaminos.webgpu-route-result.v0',
    requestId: 'moge-depth-normal:test-0001',
    routeId: 'moge.depth-normal.webgpu-local.v0',
    status: receipt.status,
    receipt,
    ...overrides.result,
  };
}

// 1. A real-weights, real-status, verified-cooperative run becomes live fuel
//    and survives the bridge with full burn and no violations.
{
  const activity = routeActivityFromMogeRouteResult(mogeRouteResult());
  assert.equal(activity.schema, 'kaminos.kiln.route-activity.v0');
  assert.equal(activity.truthMode, 'live');
  assert.equal(activity.visualAuthority, 'live-compute');
  assert.equal(activity.backendClass, 'browser-webgpu');
  assert.equal(activity.requestedRoute, 'moge.depth-normal.webgpu-local.v0');
  assert.equal(activity.effectiveRoute, 'moge.depth-normal.webgpu-local.v0');
  assert.equal(activity.fire.heatClass, 'burn');
  assert.equal(activity.fire.fuelClass, 'local-webgpu');
  assert.equal(activity.fire.allowsFullBurn, true);
  assert.deepEqual(activity.sourceArtifactIds, ['image:bunnycake']);
  assert.equal(activity.outputSlots.length, 3);
  assert.deepEqual(activity.sourceTruthWarnings, []);

  const bridge = bridgeKilnRouteRunToVolumeFire(activity);
  assert.equal(bridge.truthMode, 'live');
  assert.deepEqual(bridge.falseAuthorityViolations, []);
  assert.equal(bridge.visualReceipt.allowsFullBurn, true);
}

// 2. Hash-less browser receipt ('partial' purely from missing hashes, real
//    weights, no fallback) stays live but carries the custody warning and
//    weaker custody strength.
{
  const activity = routeActivityFromMogeRouteResult(mogeRouteResult({
    receipt: {
      status: 'partial',
      inputs: [{ role: 'source-image', artifactId: 'image:bunnycake', sha256: null }],
    },
  }));
  assert.equal(activity.truthMode, 'live');
  assert.ok(activity.sourceTruthWarnings.includes('moge_artifact_hashes_missing_browser_runtime'));
  assert.ok(activity.fire.custodyStrength < 0.8);
  assert.equal(activity.fire.allowsFullBurn, true);
}

// 3. Stub weights must NEVER burn as live — fixture truth, pilot-class fire,
//    no full burn. This is the false-closure guard.
{
  const activity = routeActivityFromMogeRouteResult(mogeRouteResult({
    receipt: {
      status: 'partial',
      fallbackReason: 'non-authoritative runtime evidence (weights=stub)',
      runtimeEvidence: { weights: 'stub', encoderFeatures: 'random' },
    },
  }));
  assert.equal(activity.truthMode, 'fixture');
  assert.notEqual(activity.visualAuthority, 'live-compute');
  assert.equal(activity.fire.allowsFullBurn, false);
  assert.ok(activity.sourceTruthWarnings.includes('moge_stub_weights_not_live'));

  const bridge = bridgeKilnRouteRunToVolumeFire(activity);
  assert.notEqual(bridge.visualReceipt.allowsFullBurn, true);
}

// 4. Cooperative scheduling requested but unverified: still live (compute is
//    real) but the scheduling claim is flagged, and it does not block burn.
{
  const activity = routeActivityFromMogeRouteResult(mogeRouteResult({
    receipt: {
      runtime: {
        scheduler: { requestedScheduler: { mode: 'cooperative', yieldMs: 4 } },
        schedulerVerification: { status: 'scheduler-unverified', classification: 'config-only' },
      },
    },
  }));
  assert.equal(activity.truthMode, 'live');
  assert.ok(activity.sourceTruthWarnings.includes('moge_cooperative_scheduling_unverified'));
}

// 5. Missing/garbage receipt fails loud rather than producing a burnable
//    activity.
{
  assert.throws(() => routeActivityFromMogeRouteResult(null));
  assert.throws(() => routeActivityFromMogeRouteResult({ schema: 'wrong.schema' }));
}

console.log('kiln-moge-route-activity contracts: PASS');
