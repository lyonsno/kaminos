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
assert.equal(live.volumeParams.volume_density, 3.05);
assert.equal(live.volumeParams.volume_fire, 0.10);
assert.equal(live.volumeParams.volume_radiance, 2.90);
assert.equal(live.volumeParams.volume_absorption, 2.00);
assert.equal(live.volumeParams.volume_glow, 2.50);
assert.equal(live.volumeParams.volume_smoke, 2.80);
assert.equal(live.volumeParams.volume_curl, 2.30);
assert.equal(live.volumeParams.volume_microdetail, 0.00);
assert.equal(live.volumeParams.volume_interface_shred, 1.55);
assert.equal(live.volumeParams.volume_fire_licks, 3.25);
assert.equal(live.volumeParams.volume_projection, 0.25);
assert.equal(live.volumeParams.volume_speed, 5.00);
assert.equal(live.volumeParams.volume_steps, 160);
assert.equal(live.volumeParams.volume_adaptive_rays, 0.00);
assert.equal(live.volumeParams.volume_occupancy_skip, 0.00);
assert.equal(live.volumeParams.volume_majorant_skip, 0.00);
assert.equal(live.volumeParams.volume_majorant_smooth, 0.10);
assert.equal(live.volumeParams.volume_majorant_guard, 0.30);
assert.equal(live.volumeParams.volume_temporal_accum, 0.00);
assert.equal(live.volumeParams.volume_temporal_jitter, 0.00);
assert.equal(live.volumeParams.volume_history_clamp, 1.00);
assert.equal(live.volumeParams.volume_fire_scale, 0.42);
assert.equal(live.volumeParams.volume_detail_scale, 1.00);
assert.equal(live.volumeParams.volume_plume_height, 0.70);
assert.equal(live.volumeParams.volume_wind_strength, 0.00);
assert.equal(live.volumeParams.volume_wind_angle, 180);
assert.equal(live.volumeParams.volume_wind_height, -0.80);
assert.equal(live.volumeParams.volume_render_scale, 0.95);
assert.equal(Object.hasOwn(live.volumeParams, 'volume_flow_rate'), false);
assert.equal(Object.hasOwn(live.volumeParams, 'volume_input_radius'), false);
assert.equal(Object.hasOwn(live.volumeParams, 'volume_reaction_fuel'), false);
assert.equal(live.lifecycleEffect.kind, 'active_burn');
assert.equal(live.lifecycleEffect.claimsLiveSpend, true);

const preheat = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'queued',
  routePhase: 'preheating',
  truthMode: 'live',
  visualAuthority: 'preheat',
  fire: {
    heatClass: 'preheat',
    fuelClass: 'route-queued',
    truthClass: 'live',
    visualAuthority: 'preheat',
    allowsFullBurn: false,
    spendIntensity: 0.12,
  },
}));

assert.equal(preheat.visualPhase, 'preheat');
assert.equal(preheat.allowsFullBurn, false);
assert.equal(preheat.lifecycleEffect.kind, 'preheat');
assert.equal(preheat.lifecycleEffect.truthClass, 'live');
assert.equal(preheat.lifecycleEffect.claimsLiveSpend, false);
assert.ok(preheat.volumeParams.volume_fire > 0, 'preheat keeps a visible low flame');
assert.ok(preheat.volumeParams.volume_fire < live.volumeParams.volume_fire, 'preheat does not claim full flame authority');
assert.ok(preheat.volumeParams.volume_glow > preheat.volumeParams.volume_fire, 'preheat reads as warmth before full burn');
assert.ok(preheat.volumeParams.volume_reaction_fuel > 0, 'preheat has a little ignition fuel');

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
assert.ok(cached.volumeParams.volume_flow_rate <= 0.03, 'cached glow keeps only a tiny retained flow');
assert.ok(cached.volumeParams.volume_glow > cached.volumeParams.volume_fire, 'cached output keeps warmth as glow');
assert.equal(cached.lifecycleEffect.kind, 'cached_glow');
assert.equal(cached.lifecycleEffect.claimsLiveSpend, false);

const completionBlaze = deriveKilnVolumeFireVisual(routeActivity({
  activityState: 'complete',
  routePhase: 'completed',
  truthMode: 'live',
  visualAuthority: 'completion-blaze',
  fire: {
    heatClass: 'completion-blaze',
    fuelClass: 'settled-output',
    truthClass: 'live',
    visualAuthority: 'completion-blaze',
    allowsFullBurn: false,
    spendIntensity: 0,
    outputSlotCount: 1,
  },
}));

assert.equal(completionBlaze.visualPhase, 'completion_blaze');
assert.equal(completionBlaze.allowsFullBurn, false);
assert.deepEqual(completionBlaze.falseAuthorityViolations, []);
assert.equal(completionBlaze.lifecycleEffect.kind, 'completion_blaze');
assert.equal(completionBlaze.lifecycleEffect.truthClass, 'live');
assert.equal(completionBlaze.lifecycleEffect.claimsLiveSpend, false);
assert.ok(completionBlaze.volumeParams.volume_fire > cached.volumeParams.volume_fire, 'completion blaze can visibly flare above cached glow');
assert.ok(completionBlaze.volumeParams.volume_fire < live.volumeParams.volume_fire, 'completion blaze remains below live full-burn fire');
assert.ok(completionBlaze.volumeParams.volume_radiance > cached.volumeParams.volume_radiance, 'completion blaze gets a visible success flash');
assert.ok(completionBlaze.volumeParams.volume_smoke < live.volumeParams.volume_smoke, 'completion blaze avoids pretending the route is still burning');

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
assert.ok(failed.volumeParams.volume_smoke > 0, 'failure snuff can smoke without keeping flame authority');
assert.equal(failed.lifecycleEffect.kind, 'failure_snuff');
assert.equal(failed.lifecycleEffect.failureSharpness, 1);
assert.equal(failed.lifecycleEffect.claimsLiveSpend, false);

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
