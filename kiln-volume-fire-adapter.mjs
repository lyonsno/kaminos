export const BEAMING_KILN_VOLUME_VISUAL_SCHEMA = 'beaming.volume-fire.kiln-v0';
export const BEAMING_KILN_VOLUME_BACKEND_ID = 'beaming.volume-fire.kiln-v0';
export const KAMINOS_ROUTE_ACTIVITY_SCHEMA = 'kaminos.kiln.route-activity.v0';

const BASE_TALL_PLUME_PARAMS = Object.freeze({
  volume_scene: 'tall_plume',
  volume_tall_preset: 'operator_fire_0622',
  volume_pressure_strategy: 'spatial_tiers',
  volume_pressure_tier_overlay: 0,
  volume_resolution: 128,
  volume_majorant_grid: 48,
});

const PHASE_VOLUME_PROFILES = Object.freeze({
  burn: Object.freeze({
    enabled: true,
    volume_density: 3.05,
    volume_fire: 0.10,
    volume_radiance: 2.90,
    volume_absorption: 2.00,
    volume_glow: 2.5,
    volume_smoke: 2.80,
    volume_curl: 2.30,
    volume_microdetail: 0.00,
    volume_interface_shred: 1.55,
    volume_fire_licks: 3.25,
    volume_projection: 0.25,
    volume_speed: 5.00,
    volume_steps: 160,
    volume_adaptive_rays: 0.00,
    volume_occupancy_skip: 0.00,
    volume_majorant_skip: 0.00,
    volume_majorant_smooth: 0.10,
    volume_majorant_guard: 0.30,
    volume_temporal_accum: 0.00,
    volume_temporal_jitter: 0.00,
    volume_history_clamp: 1.00,
    volume_fire_scale: 0.42,
    volume_detail_scale: 1.00,
    volume_plume_height: 0.70,
    volume_wind_strength: 0.00,
    volume_wind_angle: 180,
    volume_wind_height: -0.80,
    volume_render_scale: 0.95,
  }),
  preheat: Object.freeze({
    enabled: true,
    volume_density: 0.28,
    volume_fire: 0.05,
    volume_smoke: 0.1,
    volume_radiance: 0.45,
    volume_glow: 0.75,
    volume_curl: 1.4,
    volume_microdetail: 0.9,
    volume_interface_shred: 1.2,
    volume_fire_licks: 0.7,
    volume_input_radius: 0.08,
    volume_flow_rate: 0.08,
    volume_reaction_fuel: 0.25,
    volume_absorption: 0.35,
  }),
  ember: Object.freeze({
    enabled: true,
    volume_density: 0.45,
    volume_fire: 0.06,
    volume_smoke: 0.42,
    volume_radiance: 0.65,
    volume_glow: 1.1,
    volume_curl: 2.1,
    volume_microdetail: 1.4,
    volume_interface_shred: 1.5,
    volume_fire_licks: 1.0,
    volume_input_radius: 0.1,
    volume_flow_rate: 0.12,
    volume_reaction_fuel: 0.35,
    volume_absorption: 0.5,
  }),
  bank: Object.freeze({
    enabled: true,
    volume_density: 0.55,
    volume_fire: 0.04,
    volume_smoke: 0.5,
    volume_radiance: 0.45,
    volume_glow: 0.9,
    volume_curl: 1.8,
    volume_microdetail: 1.1,
    volume_interface_shred: 1.0,
    volume_fire_licks: 0.6,
    volume_input_radius: 0.12,
    volume_flow_rate: 0.1,
    volume_reaction_fuel: 0.25,
    volume_absorption: 0.55,
  }),
  glow: Object.freeze({
    enabled: true,
    volume_density: 0.18,
    volume_fire: 0.02,
    volume_smoke: 0.08,
    volume_radiance: 0.35,
    volume_glow: 0.85,
    volume_curl: 0.8,
    volume_microdetail: 0.45,
    volume_interface_shred: 0.3,
    volume_fire_licks: 0.2,
    volume_input_radius: 0.08,
    volume_flow_rate: 0.03,
    volume_reaction_fuel: 0.1,
    volume_absorption: 0.28,
  }),
  pilot: Object.freeze({
    enabled: true,
    volume_density: 0.24,
    volume_fire: 0.045,
    volume_smoke: 0.12,
    volume_radiance: 0.5,
    volume_glow: 0.75,
    volume_curl: 1.1,
    volume_microdetail: 0.7,
    volume_interface_shred: 0.7,
    volume_fire_licks: 0.5,
    volume_input_radius: 0.07,
    volume_flow_rate: 0.05,
    volume_reaction_fuel: 0.18,
    volume_absorption: 0.32,
  }),
  weak_heat: Object.freeze({
    enabled: true,
    volume_density: 0.32,
    volume_fire: 0.03,
    volume_smoke: 0.18,
    volume_radiance: 0.42,
    volume_glow: 0.62,
    volume_curl: 1.15,
    volume_microdetail: 0.65,
    volume_interface_shred: 0.6,
    volume_fire_licks: 0.35,
    volume_input_radius: 0.07,
    volume_flow_rate: 0.06,
    volume_reaction_fuel: 0.16,
    volume_absorption: 0.42,
  }),
  snuff: Object.freeze({
    enabled: true,
    volume_density: 0.75,
    volume_fire: 0,
    volume_smoke: 0.75,
    volume_radiance: 0,
    volume_glow: 0.08,
    volume_curl: 2.2,
    volume_microdetail: 1.3,
    volume_interface_shred: 0.8,
    volume_fire_licks: 0,
    volume_input_radius: 0.1,
    volume_flow_rate: 0.11,
    volume_reaction_fuel: 0,
    volume_absorption: 0.7,
  }),
  cooled: Object.freeze({
    enabled: true,
    volume_density: 0.05,
    volume_fire: 0,
    volume_smoke: 0.03,
    volume_radiance: 0,
    volume_glow: 0.15,
    volume_curl: 0.4,
    volume_microdetail: 0.2,
    volume_interface_shred: 0,
    volume_fire_licks: 0,
    volume_input_radius: 0.08,
    volume_flow_rate: 0,
    volume_reaction_fuel: 0,
    volume_absorption: 0.25,
  }),
  cold: Object.freeze({
    enabled: false,
    volume_density: 0,
    volume_fire: 0,
    volume_smoke: 0,
    volume_radiance: 0,
    volume_glow: 0,
    volume_curl: 0,
    volume_microdetail: 0,
    volume_interface_shred: 0,
    volume_fire_licks: 0,
    volume_input_radius: 0,
    volume_flow_rate: 0,
    volume_reaction_fuel: 0,
    volume_absorption: 0,
  }),
});

const HEAT_CLASS_PHASES = Object.freeze({
  burn: 'burn',
  preheat: 'preheat',
  warming: 'preheat',
  ember: 'ember',
  banking: 'bank',
  bank: 'bank',
  glow: 'glow',
  pilot: 'pilot',
  'weak-heat': 'weak_heat',
  weak_heat: 'weak_heat',
  snuff: 'snuff',
  failed: 'snuff',
  cold: 'cold',
  cooled: 'cooled',
});

const ACTIVITY_PHASES = Object.freeze({
  burning: 'burn',
  preheating: 'preheat',
  queued: 'preheat',
  banking: 'ember',
  partial: 'ember',
  cached: 'glow',
  fixture: 'pilot',
  fallback: 'weak_heat',
  failed: 'snuff',
  timeout: 'snuff',
  unavailable: 'cold',
  cold: 'cold',
  cooled: 'cooled',
  complete: 'cooled',
});

export function deriveKilnVolumeFireVisual(routeActivity = {}, options = {}) {
  const fire = routeActivity.fire || {};
  const requestedFullBurn = fire.allowsFullBurn === true;
  const fullBurnEligible = isFullBurnEligible(routeActivity);
  const allowsFullBurn = requestedFullBurn && fullBurnEligible;
  const falseAuthorityViolations = falseAuthorityViolationsFor(routeActivity, requestedFullBurn, fullBurnEligible);
  const visualPhase = allowsFullBurn ? 'burn' : phaseFor(routeActivity);
  const profile = PHASE_VOLUME_PROFILES[visualPhase] || PHASE_VOLUME_PROFILES.cold;
  const enabled = profile.enabled;
  const volumeParams = {
    ...BASE_TALL_PLUME_PARAMS,
    ...profile,
    kaminos_volume_smoke: enabled ? 1 : 0,
    ...(options.volumeParams || {}),
  };

  return {
    schema: BEAMING_KILN_VOLUME_VISUAL_SCHEMA,
    visualBackendId: BEAMING_KILN_VOLUME_BACKEND_ID,
    routeActivitySchema: routeActivity.schema || KAMINOS_ROUTE_ACTIVITY_SCHEMA,
    enabled,
    visualPhase,
    activityState: routeActivity.activityState || null,
    routePhase: routeActivity.routePhase || null,
    truthMode: routeActivity.truthMode || fire.truthClass || null,
    visualAuthority: routeActivity.visualAuthority || fire.visualAuthority || null,
    heatClass: fire.heatClass || null,
    fuelClass: fire.fuelClass || null,
    allowsFullBurn,
    requestedFullBurn,
    spendIntensity: finiteOr(fire.spendIntensity, 0),
    custodyStrength: finiteOr(fire.custodyStrength, 0),
    cacheWarmth: finiteOr(fire.cacheWarmth, 0),
    failureSharpness: finiteOr(fire.failureSharpness, 0),
    outputSlotCount: finiteOr(fire.outputSlotCount, 0),
    warningLoad: finiteOr(fire.warningLoad, 0),
    routeIdentity: {
      requestedRoute: routeActivity.requestedRoute ?? null,
      effectiveRoute: routeActivity.effectiveRoute ?? null,
      backendClass: routeActivity.backendClass ?? null,
      receiptId: routeActivity.receiptId ?? null,
      sourceArtifactIds: arrayOrEmpty(routeActivity.sourceArtifactIds),
      conditioningArtifactIds: arrayOrEmpty(routeActivity.conditioningArtifactIds),
    },
    truthWarnings: arrayOrEmpty(routeActivity.sourceTruthWarnings),
    falseAuthorityViolations,
    volumeParams,
  };
}

function phaseFor(routeActivity) {
  const fire = routeActivity.fire || {};
  const heatPhase = HEAT_CLASS_PHASES[fire.heatClass];
  if (heatPhase && heatPhase !== 'burn') return heatPhase;

  const activityPhase = ACTIVITY_PHASES[routeActivity.activityState];
  if (activityPhase) return activityPhase;

  const phasePhase = ACTIVITY_PHASES[routeActivity.routePhase];
  if (phasePhase) return phasePhase;

  if (routeActivity.truthMode === 'live' && routeActivity.visualAuthority === 'live-compute') return 'preheat';
  if (routeActivity.truthMode === 'cached') return 'glow';
  if (routeActivity.truthMode === 'fixture') return 'pilot';
  if (routeActivity.truthMode === 'fallback') return 'weak_heat';
  if (routeActivity.truthMode === 'partial') return 'ember';
  if (routeActivity.truthMode === 'failed') return 'snuff';
  return 'cold';
}

function isFullBurnEligible(routeActivity) {
  const fire = routeActivity.fire || {};
  return (
    routeActivity.activityState === 'burning' &&
    routeActivity.truthMode === 'live' &&
    routeActivity.visualAuthority === 'live-compute' &&
    (fire.truthClass === undefined || fire.truthClass === 'live') &&
    (fire.visualAuthority === undefined || fire.visualAuthority === 'live-compute')
  );
}

function falseAuthorityViolationsFor(routeActivity, requestedFullBurn, fullBurnEligible) {
  const violations = [];
  if (requestedFullBurn && !fullBurnEligible) {
    violations.push('volume_full_burn_without_live_compute');
  }
  if (routeActivity.visualAuthority === 'live-compute' && routeActivity.truthMode !== 'live') {
    violations.push('volume_live_visual_without_live_truth');
  }
  return violations;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? [...value] : [];
}
