import assert from 'node:assert/strict';

import {
  BEAMING_KILN_VOLUME_BRIDGE_SCHEMA,
  bridgeKilnRouteRunToVolumeFire,
  buildKilnVolumeFireWitness,
} from '../kiln-volume-fire-bridge.mjs';

function routeActivity(overrides = {}) {
  const fire = {
    heatClass: 'burn',
    fuelClass: 'local-webgpu',
    truthClass: 'live',
    visualAuthority: 'live-compute',
    allowsFullBurn: true,
    spendIntensity: 1,
    custodyStrength: 0.8,
    failureSharpness: 0,
    cacheWarmth: 0,
    outputSlotCount: 1,
    warningLoad: 0,
    ...overrides.fire,
  };
  return {
    schema: 'kaminos.kiln.route-activity.v0',
    activityId: 'live-run-route-activity',
    routeRunId: 'live-run',
    activityState: 'burning',
    routePhase: 'running',
    truthMode: 'live',
    visualAuthority: 'live-compute',
    requestedRoute: 'adapter.moge-local-webgpu.v0',
    effectiveRoute: 'adapter.moge-local-webgpu.v0',
    backendClass: 'browser-webgpu',
    receiptId: 'receipt-live-001',
    sourceArtifactIds: ['source-image-a'],
    conditioningArtifactIds: ['depth-a'],
    outputSlots: [{ role: 'output', artifactId: 'mesh-slot-a', status: 'pending' }],
    sourceTruthWarnings: [],
    falseAuthorityViolations: [],
    fire,
    ...overrides,
  };
}

function routeRun(overrides = {}) {
  const activity = overrides.routeActivity || routeActivity(overrides.routeActivityOverrides);
  return {
    schema: 'kaminos.kiln.tray-route-run.v0',
    runId: activity.routeRunId || 'live-run',
    requestedRoute: activity.requestedRoute,
    effectiveRoute: activity.effectiveRoute,
    backendClass: activity.backendClass,
    statusBadge: 'real',
    routePhase: activity.routePhase,
    receiptId: activity.receiptId,
    inputArtifactIds: activity.sourceArtifactIds,
    conditioningArtifactIds: activity.conditioningArtifactIds,
    outputArtifactIds: (activity.outputSlots || []).map(slot => slot.artifactId),
    routeActivity: activity,
    sourceTruthWarnings: activity.sourceTruthWarnings,
    ...overrides,
  };
}

const liveBridge = bridgeKilnRouteRunToVolumeFire(routeRun());

assert.equal(BEAMING_KILN_VOLUME_BRIDGE_SCHEMA, 'beaming.volume-fire.route-activity-bridge.v0');
assert.equal(liveBridge.schema, BEAMING_KILN_VOLUME_BRIDGE_SCHEMA);
assert.equal(liveBridge.visualBackendId, 'beaming.volume-fire.kiln-v0');
assert.equal(liveBridge.routeRunId, 'live-run');
assert.equal(liveBridge.routeActivityId, 'live-run-route-activity');
assert.equal(liveBridge.routeActivitySchema, 'kaminos.kiln.route-activity.v0');
assert.equal(liveBridge.visualReceipt.schema, 'beaming.volume-fire.kiln-v0');
assert.equal(liveBridge.visualReceipt.visualPhase, 'burn');
assert.equal(liveBridge.visualReceipt.allowsFullBurn, true);
assert.equal(liveBridge.visualReceipt.volumeParams.volume_tall_preset, 'operator_fire_0622');
assert.equal(liveBridge.visualReceipt.volumeParams.volume_pressure_strategy, 'spatial_tiers');
assert.equal(liveBridge.routeIdentity.requestedRoute, 'adapter.moge-local-webgpu.v0');
assert.equal(liveBridge.routeIdentity.effectiveRoute, 'adapter.moge-local-webgpu.v0');
assert.equal(liveBridge.routeIdentity.backendClass, 'browser-webgpu');
assert.equal(liveBridge.routeIdentity.receiptId, 'receipt-live-001');
assert.deepEqual(liveBridge.routeIdentity.sourceArtifactIds, ['source-image-a']);
assert.deepEqual(liveBridge.routeIdentity.conditioningArtifactIds, ['depth-a']);
assert.deepEqual(liveBridge.outputSlots, [{ role: 'output', artifactId: 'mesh-slot-a', status: 'pending' }]);
assert.equal(liveBridge.displayAuthority, 'live-compute burn');
assert.deepEqual(liveBridge.falseAuthorityViolations, []);

const cachedBridge = bridgeKilnRouteRunToVolumeFire(routeRun({
  statusBadge: 'cached',
  routeActivity: routeActivity({
    activityId: 'cached-run-route-activity',
    routeRunId: 'cached-run',
    activityState: 'cached',
    routePhase: 'completed',
    truthMode: 'cached',
    visualAuthority: 'cached',
    requestedRoute: 'adapter.moge-local-webgpu.v0',
    effectiveRoute: 'adapter.moge-local-webgpu.v0',
    backendClass: 'cache',
    receiptId: 'receipt-cached-001',
    sourceTruthWarnings: ['cached_not_fresh_compute'],
    fire: {
      heatClass: 'glow',
      fuelClass: 'cached',
      truthClass: 'cached',
      visualAuthority: 'cached',
      allowsFullBurn: false,
      spendIntensity: 0,
      cacheWarmth: 0.8,
    },
  }),
}));

assert.equal(cachedBridge.visualReceipt.visualPhase, 'glow');
assert.equal(cachedBridge.visualReceipt.allowsFullBurn, false);
assert.ok(cachedBridge.truthWarnings.includes('cached_not_fresh_compute'));
assert.ok(cachedBridge.visualReceipt.volumeParams.volume_fire < liveBridge.visualReceipt.volumeParams.volume_fire);

const fallbackBridge = bridgeKilnRouteRunToVolumeFire(routeRun({
  statusBadge: 'fallback',
  routeActivity: routeActivity({
    activityId: 'fallback-run-route-activity',
    routeRunId: 'fallback-run',
    activityState: 'fallback',
    routePhase: 'running',
    truthMode: 'fallback',
    visualAuthority: 'fallback',
    requestedRoute: 'adapter.moge-local-webgpu.v0',
    effectiveRoute: 'fixture-generator',
    backendClass: 'fixture',
    receiptId: 'receipt-fallback-001',
    sourceTruthWarnings: ['fallback_kiln_not_requested_route'],
    fire: {
      heatClass: 'burn',
      fuelClass: 'fixture',
      truthClass: 'fallback',
      visualAuthority: 'fallback',
      allowsFullBurn: true,
      spendIntensity: 1,
      warningLoad: 1,
    },
  }),
}));

assert.equal(fallbackBridge.visualReceipt.visualPhase, 'weak_heat');
assert.equal(fallbackBridge.visualReceipt.allowsFullBurn, false);
assert.ok(fallbackBridge.falseAuthorityViolations.includes('volume_full_burn_without_live_compute'));
assert.ok(fallbackBridge.truthWarnings.includes('fallback_kiln_not_requested_route'));
assert.equal(fallbackBridge.routeIdentity.requestedRoute, 'adapter.moge-local-webgpu.v0');
assert.equal(fallbackBridge.routeIdentity.effectiveRoute, 'fixture-generator');

const unavailableBridge = bridgeKilnRouteRunToVolumeFire(routeRun({
  statusBadge: 'missing-backend',
  routeActivity: routeActivity({
    activityId: 'missing-run-route-activity',
    routeRunId: 'missing-run',
    activityState: 'unavailable',
    routePhase: 'queued',
    truthMode: 'unavailable',
    visualAuthority: 'none',
    effectiveRoute: null,
    backendClass: 'missing',
    receiptId: null,
    sourceArtifactIds: [],
    conditioningArtifactIds: [],
    outputSlots: [],
    sourceTruthWarnings: ['kiln_backend_unavailable'],
    fire: {
      heatClass: 'cold',
      fuelClass: 'unknown',
      truthClass: 'unavailable',
      visualAuthority: 'none',
      allowsFullBurn: false,
    },
  }),
}));

assert.equal(unavailableBridge.visualReceipt.visualPhase, 'cold');
assert.equal(unavailableBridge.visualReceipt.enabled, false);
assert.equal(unavailableBridge.visualReceipt.volumeParams.kaminos_volume_smoke, 0);

const witness = buildKilnVolumeFireWitness({
  witnessId: 'route-tray-fire-witness-001',
  routeRuns: [
    routeRun(),
    routeRun({ statusBadge: 'cached', routeActivity: cachedBridge.sourceRouteActivity }),
    routeRun({ statusBadge: 'fallback', routeActivity: fallbackBridge.sourceRouteActivity }),
    routeRun({ statusBadge: 'missing-backend', routeActivity: unavailableBridge.sourceRouteActivity }),
  ],
});

assert.equal(witness.schema, 'beaming.volume-fire.route-activity-witness.v0');
assert.equal(witness.witnessId, 'route-tray-fire-witness-001');
assert.equal(witness.visualBackendId, 'beaming.volume-fire.kiln-v0');
assert.equal(witness.bridgeSchema, BEAMING_KILN_VOLUME_BRIDGE_SCHEMA);
assert.equal(witness.routeRunCount, 4);
assert.equal(witness.phaseCounts.burn, 1);
assert.equal(witness.phaseCounts.glow, 1);
assert.equal(witness.phaseCounts.weak_heat, 1);
assert.equal(witness.phaseCounts.cold, 1);
assert.equal(witness.truthModeCounts.live, 1);
assert.equal(witness.truthModeCounts.cached, 1);
assert.equal(witness.truthModeCounts.fallback, 1);
assert.equal(witness.truthModeCounts.unavailable, 1);
assert.equal(witness.fullBurnCount, 1);
assert.equal(witness.enabledCount, 3);
assert.equal(witness.primaryBridge.routeRunId, 'live-run');
assert.equal(witness.primaryBridge.visualReceipt.allowsFullBurn, true);
assert.ok(witness.falseAuthorityViolations.includes('fallback-run:volume_full_burn_without_live_compute'));
assert.ok(witness.truthWarnings.includes('fallback_kiln_not_requested_route'));
assert.ok(witness.truthWarnings.includes('kiln_backend_unavailable'));
