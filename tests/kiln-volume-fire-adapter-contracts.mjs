import assert from 'node:assert/strict';

import {
  BEAMING_KILN_VOLUME_VISUAL_SCHEMA,
  deriveKilnVolumeFireVisual,
} from '../kiln-volume-fire-adapter.mjs';

function routeActivity(overrides = {}) {
  return {
    schema: 'kaminos.kiln.route-activity.v0',
    requestedRoute: 'moge-webgpu',
    effectiveRoute: 'moge-webgpu-local',
    backendClass: 'local-webgpu',
    receiptId: 'receipt-live-001',
    activityState: 'burning',
    routePhase: 'running',
    truthMode: 'live',
    visualAuthority: 'live-compute',
    sourceArtifactIds: ['source-image-a'],
    conditioningArtifactIds: ['conditioning-volume-a'],
    sourceTruthWarnings: [],
    fire: {
      heatClass: 'burn',
      fuelClass: 'live-route',
      truthClass: 'live',
      visualAuthority: 'live-compute',
      allowsFullBurn: true,
      spendIntensity: 1,
      custodyStrength: 1,
      failureSharpness: 0,
      cacheWarmth: 0,
      outputSlotCount: 0,
      warningLoad: 0,
      ...overrides.fire,
    },
    ...overrides,
  };
}

const live = deriveKilnVolumeFireVisual(routeActivity());

assert.equal(BEAMING_KILN_VOLUME_VISUAL_SCHEMA, 'beaming.volume-fire.kiln-v0');
assert.equal(live.schema, BEAMING_KILN_VOLUME_VISUAL_SCHEMA);
assert.equal(live.visualBackendId, 'beaming.volume-fire.kiln-v0');
assert.equal(live.routeActivitySchema, 'kaminos.kiln.route-activity.v0');
assert.equal(live.activityState, 'burning');
assert.equal(live.truthMode, 'live');
assert.equal(live.visualAuthority, 'live-compute');
assert.equal(live.visualPhase, 'burn');
assert.equal(live.allowsFullBurn, true);
assert.deepEqual(live.falseAuthorityViolations, []);
assert.equal(live.routeIdentity.requestedRoute, 'moge-webgpu');
assert.equal(live.routeIdentity.effectiveRoute, 'moge-webgpu-local');
assert.equal(live.routeIdentity.backendClass, 'local-webgpu');
assert.equal(live.routeIdentity.receiptId, 'receipt-live-001');
assert.deepEqual(live.routeIdentity.sourceArtifactIds, ['source-image-a']);
assert.deepEqual(live.routeIdentity.conditioningArtifactIds, ['conditioning-volume-a']);
assert.equal(live.volumeParams.volume_scene, 'tall_plume');
assert.equal(live.volumeParams.volume_tall_preset, 'operator_fire_0622');
assert.equal(live.volumeParams.volume_pressure_strategy, 'spatial_tiers');
assert.equal(live.volumeParams.volume_pressure_tier_overlay, 0);
assert.equal(live.volumeParams.kaminos_volume_smoke, 1);
assert.ok(live.volumeParams.volume_fire > 0.15, 'live compute receives a visible fire body');
assert.ok(live.volumeParams.volume_radiance > 2, 'live compute receives strong fire radiance');
assert.ok(live.volumeParams.volume_flow_rate > 0.2, 'live compute receives the active tall-plume flow regime');

const cached = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'cached',
  routePhase: 'complete',
  truthMode: 'cached',
  visualAuthority: 'warm-recall',
  fire: {
    heatClass: 'glow',
    fuelClass: 'cached-output',
    truthClass: 'cached',
    visualAuthority: 'warm-recall',
    allowsFullBurn: false,
    spendIntensity: 0,
    cacheWarmth: 0.85,
  },
}));

assert.equal(cached.visualPhase, 'glow');
assert.equal(cached.allowsFullBurn, false);
assert.equal(cached.volumeParams.kaminos_volume_smoke, 1);
assert.ok(cached.volumeParams.volume_fire < live.volumeParams.volume_fire, 'cached glow is weaker than live fire');
assert.ok(cached.volumeParams.volume_flow_rate < live.volumeParams.volume_flow_rate, 'cached glow does not pretend to spend');
assert.ok(cached.volumeParams.volume_glow > cached.volumeParams.volume_fire, 'cached output keeps warmth as glow');

const fixture = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'fixture',
  routePhase: 'demo',
  truthMode: 'fixture',
  visualAuthority: 'demo',
  sourceTruthWarnings: ['fixture_kiln_not_live_compute'],
  fire: {
    heatClass: 'pilot',
    fuelClass: 'fixture',
    truthClass: 'fixture',
    visualAuthority: 'demo',
    allowsFullBurn: false,
    spendIntensity: 0,
    warningLoad: 1,
  },
}));

assert.equal(fixture.visualPhase, 'pilot');
assert.equal(fixture.allowsFullBurn, false);
assert.ok(fixture.volumeParams.volume_fire < live.volumeParams.volume_fire);
assert.ok(fixture.truthWarnings.includes('fixture_kiln_not_live_compute'));

const fallback = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'fallback',
  routePhase: 'degraded',
  truthMode: 'fallback',
  visualAuthority: 'degraded',
  fire: {
    heatClass: 'weak-heat',
    fuelClass: 'fallback',
    truthClass: 'fallback',
    visualAuthority: 'degraded',
    allowsFullBurn: false,
    spendIntensity: 0,
    warningLoad: 1,
  },
}));

assert.equal(fallback.visualPhase, 'weak_heat');
assert.equal(fallback.allowsFullBurn, false);
assert.ok(fallback.volumeParams.volume_smoke > cached.volumeParams.volume_smoke);
assert.ok(fallback.volumeParams.volume_radiance < live.volumeParams.volume_radiance);

const partial = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'banking',
  routePhase: 'partial-output',
  truthMode: 'partial',
  visualAuthority: 'partial-output',
  fire: {
    heatClass: 'ember',
    fuelClass: 'partial-output',
    truthClass: 'partial',
    visualAuthority: 'partial-output',
    allowsFullBurn: false,
    spendIntensity: 0.35,
    outputSlotCount: 1,
  },
}));

assert.equal(partial.visualPhase, 'ember');
assert.equal(partial.allowsFullBurn, false);
assert.ok(partial.volumeParams.volume_fire < live.volumeParams.volume_fire);
assert.ok(partial.volumeParams.volume_smoke > cached.volumeParams.volume_smoke);

const failed = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'failed',
  routePhase: 'failed',
  truthMode: 'failed',
  visualAuthority: 'snuffed',
  fire: {
    heatClass: 'snuff',
    fuelClass: 'failed-route',
    truthClass: 'failed',
    visualAuthority: 'snuffed',
    allowsFullBurn: false,
    spendIntensity: 0,
    failureSharpness: 1,
  },
}));

assert.equal(failed.visualPhase, 'snuff');
assert.equal(failed.allowsFullBurn, false);
assert.equal(failed.volumeParams.volume_fire, 0);
assert.ok(failed.volumeParams.volume_smoke > live.volumeParams.volume_smoke, 'failure snuff can smoke without keeping flame authority');

const unavailable = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'unavailable',
  routePhase: 'unavailable',
  truthMode: 'missing',
  visualAuthority: 'unavailable',
  requestedRoute: 'missing-backend',
  effectiveRoute: null,
  backendClass: 'missing',
  receiptId: null,
  sourceArtifactIds: [],
  conditioningArtifactIds: [],
  fire: {
    heatClass: 'cold',
    fuelClass: 'none',
    truthClass: 'missing',
    visualAuthority: 'unavailable',
    allowsFullBurn: false,
    spendIntensity: 0,
  },
}));

assert.equal(unavailable.visualPhase, 'cold');
assert.equal(unavailable.enabled, false);
assert.equal(unavailable.allowsFullBurn, false);
assert.equal(unavailable.volumeParams.kaminos_volume_smoke, 0);
assert.equal(unavailable.volumeParams.volume_fire, 0);
assert.equal(unavailable.volumeParams.volume_smoke, 0);

const lyingFallback = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'fallback',
  routePhase: 'degraded',
  truthMode: 'fallback',
  visualAuthority: 'degraded',
  fire: {
    heatClass: 'burn',
    truthClass: 'fallback',
    visualAuthority: 'degraded',
    allowsFullBurn: true,
    spendIntensity: 1,
  },
}));

assert.equal(lyingFallback.allowsFullBurn, false, 'adapter computes full-burn authority from route truth, not fire payload optimism');
assert.ok(
  lyingFallback.falseAuthorityViolations.includes('volume_full_burn_without_live_compute'),
  'adapter records false full-burn pressure for diagnostics',
);
assert.ok(lyingFallback.volumeParams.volume_fire < live.volumeParams.volume_fire);
