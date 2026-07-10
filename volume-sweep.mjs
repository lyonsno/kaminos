#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, true);
  }
}

const baseUrl = args.get('--base-url') || 'http://127.0.0.1:8097/?kaminos_volume_smoke=1';
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-volume-sweep');
const aggregatePath = resolve(args.get('--aggregate') || `${outDir}/aggregate.json`);
const settleMs = Number(args.get('--settle-ms') || 8000);
const windowSize = args.get('--window-size') || '1280,960';
const debugPort = Number(args.get('--debug-port') || 9500);
const matrixMode = args.get('--matrix') || 'compact';
const dryRun = args.has('--dry-run');

const PERFORMANCE_MATRIX_ID = 'tall-plume-performance-matrix-v0';
const EXPECTED_VOLUME_ROUTE_ID = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE_ID = 'kaminos-volume-prototype-v0';
const TALL_PLUME_PRESSURE_ITERATION_STRATEGY_PRESSURE2 = 'tall-plume-pressure2-v0';
const TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE = 'inactive';
const TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY = 'tall-plume-spatial-pressure-tiers-v0';
const TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE = 'inactive';
const PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE = 'composite-pressure-tier-read-v0';
const PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER = 'single-pressure-buffer-read-v0';
const MAIN_FLUID_KERNEL_STRATEGY_FIRE_LICK_BREAKUP = 'main-fluid-fire-lick-breakup-v0';
const MAIN_FLUID_KERNEL_STRATEGY_ZERO_FIRE_LICK_BYPASS = 'main-fluid-zero-fire-lick-bypass-v0';
const MAIN_FLUID_LOCAL_PROJECTION_STRATEGY_STAGED_PRESSURE_ONLY = 'main-fluid-local-projection-staged-pressure-only-v0';
const MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_ACTIVE = 'bonfire-combustion-field-active-v0';
const MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_NON_BONFIRE_BYPASS = 'non-bonfire-combustion-field-bypass-v0';
const MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_ACTIVE = 'bonfire-procedural-breakup-active-v0';
const MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_NON_BONFIRE_BYPASS = 'non-bonfire-procedural-breakup-bypass-v0';
const MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_ACTIVE = 'bonfire-symmetric-force-active-v0';
const MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_NON_BONFIRE_BYPASS = 'non-bonfire-symmetric-force-bypass-v0';
const MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_ACTIVE = 'bonfire-non-wind-force-active-v0';
const MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_NON_BONFIRE_BYPASS = 'non-bonfire-non-wind-force-bypass-v0';
const MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_ACTIVE = 'bonfire-scalar-neighborhood-active-v0';
const MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_NON_BONFIRE_BYPASS = 'non-bonfire-scalar-neighborhood-bypass-v0';
const TALL_PLUME_DETAIL_COHERENCE_STRATEGY_TRANSPORTED_PHASE_ANCHOR = 'transported-detail-phase-anchor-v0';
const TALL_PLUME_DETAIL_COHERENCE_STRATEGY_INACTIVE = 'inactive';
const TALL_PLUME_TRANSITION_BAND_STRATEGY_STAGGERED_RETIREMENT = 'staggered-transition-retirement-v0';
const TALL_PLUME_TRANSITION_BAND_STRATEGY_INACTIVE = 'inactive';
const FALSE_CLOSURE_LABELS = [
  'wrong-fallback-route',
  'stale-default-config',
  'missing-primary-report',
  'blank-or-partial-output',
  'absent-effective-identity',
];

const COMPACT_MATRIX_SCENARIOS = [
  {
    id: 'draft-fast',
    label: 'Draft Fast',
    simGrid: 96,
    majorantGrid: 48,
    raySteps: 64,
    renderScale: 0.75,
    adaptiveRays: 0.80,
    occupancySkip: 0.60,
    majorantSkip: 0.68,
    majorantSmooth: 0.70,
    majorantGuard: 0.70,
    temporalAccum: 0.30,
    temporalJitter: 0.45,
    historyClamp: 0.70,
  },
  {
    id: 'live-balanced',
    label: 'Live Balanced',
    simGrid: 96,
    majorantGrid: 48,
    raySteps: 96,
    renderScale: 0.85,
    adaptiveRays: 0.65,
    occupancySkip: 0.45,
    majorantSkip: 0.60,
    majorantSmooth: 0.80,
    majorantGuard: 0.75,
    temporalAccum: 0.35,
    temporalJitter: 0.40,
    historyClamp: 0.70,
  },
  {
    id: 'rich-fullscreen',
    label: 'Rich Fullscreen',
    simGrid: 128,
    majorantGrid: 48,
    raySteps: 120,
    renderScale: 0.85,
    adaptiveRays: 0.50,
    occupancySkip: 0.30,
    majorantSkip: 0.45,
    majorantSmooth: 0.80,
    majorantGuard: 0.80,
    temporalAccum: 0.30,
    temporalJitter: 0.30,
    historyClamp: 0.80,
  },
  {
    id: 'hero-reference',
    label: 'Hero Reference',
    simGrid: 128,
    majorantGrid: 48,
    raySteps: 160,
    renderScale: 1.0,
    adaptiveRays: 0.30,
    occupancySkip: 0.20,
    majorantSkip: 0.30,
    majorantSmooth: 0.85,
    majorantGuard: 0.85,
    temporalAccum: 0.10,
    temporalJitter: 0.20,
    historyClamp: 0.90,
  },
  {
    id: 'hand-trail-live',
    label: 'Hand Trail Live',
    simGrid: 96,
    majorantGrid: 48,
    raySteps: 72,
    renderScale: 0.80,
    adaptiveRays: 0.70,
    occupancySkip: 0.50,
    majorantSkip: 0.60,
    majorantSmooth: 0.75,
    majorantGuard: 0.75,
    temporalAccum: 0.25,
    temporalJitter: 0.40,
    historyClamp: 0.75,
    externalEmitterMode: 'synthetic_hand_trails',
    flowRate: 0,
    fireScale: 0.45,
    detailScale: 2.35,
    plumeHeight: 1.05,
    radiance: 2.4,
    absorption: 1.1,
  },
  {
    id: 'tall-plume-scale',
    label: 'Tall Plume Scale',
    volumeScene: 'tall_plume',
    simGrid: 128,
    majorantGrid: 48,
    raySteps: 96,
    renderScale: 0.85,
    adaptiveRays: 0.65,
    occupancySkip: 0.50,
    majorantSkip: 0.60,
    majorantSmooth: 0.78,
    majorantGuard: 0.78,
    temporalAccum: 0.35,
    temporalJitter: 0.40,
    historyClamp: 0.75,
  },
  {
    id: 'bonfire-plume-scale',
    label: 'Bonfire Plume Scale',
    volumeScene: 'bonfire_plume',
    simGrid: 128,
    majorantGrid: 48,
    raySteps: 96,
    renderScale: 0.85,
    adaptiveRays: 0.65,
    occupancySkip: 0.45,
    majorantSkip: 0.55,
    majorantSmooth: 0.80,
    majorantGuard: 0.80,
    temporalAccum: 0.30,
    temporalJitter: 0.40,
    historyClamp: 0.78,
  },
];

const TALL_PLUME_PERFORMANCE_BASE = {
  performanceMatrixId: PERFORMANCE_MATRIX_ID,
  volumeScene: 'tall_plume',
  tallPreset: 'operator_fire_0622',
  reactionFuel: 1,
  density: 3.05,
  fire: 0.50,
  radiance: 3,
  absorption: 0,
  glow: 2.5,
  smoke: 2.8,
  curl: 3.5,
  microdetail: 2.5,
  interfaceShred: 0,
  fireLicks: 0,
  projection: 1.5,
  speed: 5,
  fireScale: 0.59,
  detailScale: 0.45,
  plumeHeight: 2.2,
  windStrength: 0,
  windAngle: 180,
  windHeight: -0.8,
  inputRadius: 0.11,
  flowRate: 0.35,
  temporalAccum: 0,
  temporalJitter: 0,
  historyClamp: 1,
  occupancySkip: 0.1,
  majorantSkip: 0,
  majorantSmooth: 0.1,
  majorantGuard: 0.3,
  majorantCadence: 1,
  pressureIterations: 2,
  pressureStrategy: 'global',
  simProfile: true,
  renderScale: 0.75,
  adaptiveRays: 0.75,
  raySteps: 148,
  majorantGrid: 48,
};

const PERFORMANCE_MATRIX_SCENARIOS = [
  {
    id: 'perf-096-baseline',
    label: 'Perf 096 Baseline',
    simGrid: 96,
  },
  {
    id: 'activity-p4-low-res',
    label: 'Activity P4 Low Res',
    simGrid: 64,
    majorantGrid: 32,
    pressureStrategy: 'activity_tiers',
    activityPressureP4Enabled: true,
    activityVorticityGate: 1,
    activityDetailGate: 1,
    raySteps: 96,
    renderScale: 0.75,
  },
  {
    id: 'activity-p4-dense-low-res',
    label: 'Activity P4 Dense Low Res',
    simGrid: 64,
    majorantGrid: 32,
    pressureStrategy: 'activity_tiers',
    activityPressureP4Enabled: true,
    activityPressureDispatchStrategy: 'dense',
    activityVorticityGate: 1,
    activityDetailGate: 1,
    raySteps: 96,
    renderScale: 0.75,
  },
  {
    id: 'activity-p3-low-res',
    label: 'Activity P3 Low Res',
    simGrid: 64,
    majorantGrid: 32,
    pressureStrategy: 'activity_tiers',
    activityPressureP4Enabled: false,
    activityVorticityGate: 1,
    activityDetailGate: 1,
    raySteps: 96,
    renderScale: 0.75,
  },
  {
    id: 'perf-128-baseline',
    label: 'Perf 128 Baseline',
    simGrid: 128,
  },
  {
    id: 'perf-160-baseline',
    label: 'Perf 160 Baseline',
    simGrid: 160,
  },
  {
    id: 'perf-128-cadence2',
    label: 'Perf 128 Majorant Cadence 2',
    simGrid: 128,
    majorantCadence: 2,
  },
  {
    id: 'perf-128-cadence3',
    label: 'Perf 128 Majorant Cadence 3',
    simGrid: 128,
    majorantCadence: 3,
  },
  {
    id: 'perf-128-pressure4',
    label: 'Perf 128 Pressure 4',
    simGrid: 128,
    pressureIterations: 4,
  },
  {
    id: 'perf-128-ray96',
    label: 'Perf 128 Raymarch 96',
    simGrid: 128,
    raySteps: 96,
    renderScale: 0.6,
    adaptiveRays: 0.75,
  },
  {
    id: 'perf-128-ray160',
    label: 'Perf 128 Raymarch 160',
    simGrid: 128,
    raySteps: 160,
    renderScale: 0.75,
    adaptiveRays: 0.25,
  },
].map((scenario) => ({ ...TALL_PLUME_PERFORMANCE_BASE, ...scenario }));

function numberList(value, fallback) {
  return String(value || fallback)
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pressureEffectiveLabelForRun(run, effective) {
  const strategy = String(effective.pressureStrategy || run.pressureStrategy || 'global').toLowerCase();
  if (strategy === 'spatial_tiers') return 'Tiered P3';
  if (strategy === 'activity_tiers') {
    const p4Enabled = effective.activityPressureP4Enabled ?? effective.activityTierControls?.activityPressureP4Enabled ?? run.activityPressureP4Enabled;
    return p4Enabled === false ? 'Activity P3' : 'Activity P4';
  }
  const effectiveIterations = Number(
    effective.pressureIterationRequested
      ?? effective.pressureProjectionIterations
      ?? effective.pressureIterationDefault
      ?? run.pressureIterations
      ?? 0,
  );
  if (!Number.isFinite(effectiveIterations)) return '';
  if (run.pressureIterations !== undefined) {
    return [1, 2, 3].includes(effectiveIterations) ? `Full P${effectiveIterations}` : `Route P${effectiveIterations}`;
  }
  return `Default P${effectiveIterations}`;
}

function parseScenarioList(value, scenarios = COMPACT_MATRIX_SCENARIOS, label = 'compact') {
  if (!value || value === 'all') return scenarios;
  const requested = new Set(String(value).split(',').map((entry) => entry.trim()).filter(Boolean));
  const selected = scenarios.filter((scenario) => requested.has(scenario.id));
  if (selected.length !== requested.size) {
    const known = new Set(scenarios.map((scenario) => scenario.id));
    const unknown = [...requested].filter((id) => !known.has(id));
    throw new Error(`Unknown ${label} matrix scenario(s): ${unknown.join(', ')}`);
  }
  return selected;
}

function gridRuns() {
  const simGrids = numberList(args.get('--sim-grids'), '96,128');
  const majorantGrids = numberList(args.get('--majorant-grids'), '24,32');
  const raySteps = numberList(args.get('--ray-steps'), '72,120');
  const runs = [];
  for (const simGrid of simGrids) {
    for (const majorantGrid of majorantGrids) {
      for (const steps of raySteps) {
        runs.push({
          id: `grid-sim${simGrid}-maj${majorantGrid}-steps${steps}`,
          label: `Grid ${simGrid}/${majorantGrid}/${steps}`,
          simGrid,
          majorantGrid,
          raySteps: steps,
          adaptiveRays: finiteOr(args.get('--adaptive-rays'), 0.40),
          majorantSkip: finiteOr(args.get('--majorant-skip'), 0.45),
          occupancySkip: finiteOr(args.get('--occupancy-skip'), 0.35),
          majorantSmooth: finiteOr(args.get('--majorant-smooth'), 0.75),
          majorantGuard: finiteOr(args.get('--majorant-guard'), 0.75),
          temporalAccum: finiteOr(args.get('--temporal-accum'), 0.25),
          temporalJitter: finiteOr(args.get('--temporal-jitter'), 0.35),
          historyClamp: finiteOr(args.get('--history-clamp'), 0.75),
          renderScale: finiteOr(args.get('--render-scale'), 0.85),
        });
      }
    }
  }
  return runs;
}

function selectedRuns() {
  if (matrixMode === 'grid') return gridRuns();
  if (matrixMode === 'performance') {
    return parseScenarioList(args.get('--scenarios'), PERFORMANCE_MATRIX_SCENARIOS, 'performance').map((scenario) => ({ ...scenario }));
  }
  if (matrixMode !== 'compact') throw new Error(`Unknown sweep matrix mode: ${matrixMode}`);
  return parseScenarioList(args.get('--scenarios')).map((scenario) => ({ ...scenario }));
}

function applyNumberParam(url, name, value) {
  if (Number.isFinite(value)) url.searchParams.set(name, String(value));
}

function applyStringParam(url, name, value) {
  if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
}

function applyBooleanParam(url, name, value) {
  if (value !== undefined && value !== null) url.searchParams.set(name, value ? '1' : '0');
}

function routeFor(run) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  applyStringParam(url, 'volume_scene', run.volumeScene);
  applyStringParam(url, 'volume_tall_preset', run.tallPreset);
  applyNumberParam(url, 'volume_resolution', run.simGrid);
  applyNumberParam(url, 'volume_majorant_grid', run.majorantGrid);
  applyNumberParam(url, 'volume_steps', run.raySteps);
  applyNumberParam(url, 'volume_render_scale', run.renderScale);
  applyNumberParam(url, 'volume_adaptive_rays', run.adaptiveRays);
  applyNumberParam(url, 'volume_occupancy_skip', run.occupancySkip);
  applyNumberParam(url, 'volume_majorant_skip', run.majorantSkip);
  applyNumberParam(url, 'volume_majorant_smooth', run.majorantSmooth);
  applyNumberParam(url, 'volume_majorant_guard', run.majorantGuard);
  applyNumberParam(url, 'volume_temporal_accum', run.temporalAccum);
  applyNumberParam(url, 'volume_temporal_jitter', run.temporalJitter);
  applyNumberParam(url, 'volume_history_clamp', run.historyClamp);
  applyNumberParam(url, 'volume_density', run.density);
  applyNumberParam(url, 'volume_fire', run.fire);
  applyNumberParam(url, 'volume_smoke', run.smoke);
  applyNumberParam(url, 'volume_glow', run.glow);
  applyNumberParam(url, 'volume_curl', run.curl);
  applyNumberParam(url, 'volume_reaction_fuel', run.reactionFuel);
  applyNumberParam(url, 'volume_microdetail', run.microdetail);
  applyNumberParam(url, 'volume_interface_shred', run.interfaceShred);
  applyNumberParam(url, 'volume_fire_licks', run.fireLicks);
  applyNumberParam(url, 'volume_projection', run.projection);
  applyNumberParam(url, 'volume_speed', run.speed);
  applyNumberParam(url, 'volume_flow_rate', run.flowRate);
  applyNumberParam(url, 'volume_fire_scale', run.fireScale);
  applyNumberParam(url, 'volume_detail_scale', run.detailScale);
  applyNumberParam(url, 'volume_plume_height', run.plumeHeight);
  applyNumberParam(url, 'volume_radiance', run.radiance);
  applyNumberParam(url, 'volume_absorption', run.absorption);
  applyNumberParam(url, 'volume_wind_strength', run.windStrength);
  applyNumberParam(url, 'volume_wind_angle', run.windAngle);
  applyNumberParam(url, 'volume_wind_height', run.windHeight);
  applyNumberParam(url, 'volume_input_radius', run.inputRadius);
  applyNumberParam(url, 'volume_majorant_cadence', run.majorantCadence);
  applyNumberParam(url, 'volume_pressure_iterations', run.pressureIterations);
  applyStringParam(url, 'volume_pressure_strategy', run.pressureStrategy);
  applyBooleanParam(url, 'volume_activity_pressure_p4', run.activityPressureP4Enabled);
  applyStringParam(url, 'volume_activity_pressure_dispatch', run.activityPressureDispatchStrategy);
  applyNumberParam(url, 'volume_activity_vorticity_gate', run.activityVorticityGate);
  applyNumberParam(url, 'volume_activity_detail_gate', run.activityDetailGate);
  applyBooleanParam(url, 'volume_sim_profile', run.simProfile);
  applyStringParam(url, 'volume_external_emitters', run.externalEmitterMode);
  return url.toString();
}

function slugFor(run) {
  return run.id.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
}

function requestedConfig(run) {
  return {
    performanceMatrixId: run.performanceMatrixId || null,
    scenarioId: run.id,
    label: run.label,
    volumeScene: run.volumeScene || 'compact_plume',
    tallPreset: run.tallPreset,
    simGrid: run.simGrid,
    majorantGrid: run.majorantGrid,
    raySteps: run.raySteps,
    renderScale: run.renderScale,
    adaptiveRays: run.adaptiveRays,
    occupancySkip: run.occupancySkip,
    majorantSkip: run.majorantSkip,
    majorantSmooth: run.majorantSmooth,
    majorantGuard: run.majorantGuard,
    temporalAccum: run.temporalAccum,
    temporalJitter: run.temporalJitter,
    historyClamp: run.historyClamp,
    density: run.density,
    fire: run.fire,
    radiance: run.radiance,
    absorption: run.absorption,
    glow: run.glow,
    smoke: run.smoke,
    curl: run.curl,
    reactionFuel: run.reactionFuel,
    fireScale: run.fireScale,
    detailScale: run.detailScale,
    microdetail: run.microdetail,
    interfaceShred: run.interfaceShred,
    fireLicks: run.fireLicks,
    projection: run.projection,
    speed: run.speed,
    plumeHeight: run.plumeHeight,
    windStrength: run.windStrength,
    windAngle: run.windAngle,
    windHeight: run.windHeight,
    inputRadius: run.inputRadius,
    flowRate: run.flowRate,
    majorantCadence: run.majorantCadence,
    pressureIterations: run.pressureIterations,
    pressureStrategy: run.pressureStrategy,
    activityPressureP4Enabled: run.activityPressureP4Enabled,
    activityVorticityGate: run.activityVorticityGate,
    activityDetailGate: run.activityDetailGate,
    simProfile: run.simProfile,
    externalEmitterMode: run.externalEmitterMode || 'off',
  };
}

function effectiveConfig(witness) {
  const controls = witness.controls || {};
  const effectiveTallPreset = witness.tallPreset
    ?? controls.tallPreset
    ?? controls.tallPlumePreset
    ?? controls.volumeTallPreset
    ?? null;
  return {
    backend: witness.backend,
    effectiveRoute: witness.effectiveRoute,
    prototypeIdentity: witness.prototypeIdentity,
    evidenceMode: witness.evidenceMode,
    visualEvidenceMode: witness.visualEvidenceMode,
    performanceVisualWarnings: witness.performanceVisualWarnings || [],
    volumeScene: witness.volumeScene || controls.volumeScene || 'compact_plume',
    tallPreset: effectiveTallPreset,
    tallPresetEvidence: effectiveTallPreset ? 'reported' : 'expanded-controls',
    simGrid: witness.simGrid,
    majorantGrid: witness.majorantGrid,
    raySteps: witness.raySteps ?? controls.raySteps,
    renderScale: witness.renderScale ?? controls.renderScale,
    renderPixelRatio: witness.renderPixelRatio,
    displayWidth: witness.displayWidth,
    displayHeight: witness.displayHeight,
    renderWidth: witness.renderWidth,
    renderHeight: witness.renderHeight,
    volumeReconstructionStyle: witness.volumeReconstructionStyle,
    adaptiveRaymarch: witness.adaptiveRaymarch ?? controls.adaptiveRaymarch ?? controls.adaptiveRays,
    occupancySkip: witness.occupancySkip ?? controls.occupancySkip,
    majorantSkip: witness.majorantSkip ?? controls.majorantSkip,
    majorantSmooth: witness.majorantSmooth ?? controls.majorantSmooth,
    majorantGuard: witness.majorantGuard ?? controls.majorantGuard,
    temporalAccum: witness.temporalAccum ?? controls.temporalAccum,
    temporalJitter: witness.temporalJitter ?? controls.temporalJitter,
    historyClamp: witness.historyClamp ?? controls.historyClamp,
    density: witness.density ?? controls.density,
    fire: witness.fire ?? controls.fire,
    radiance: witness.radiance ?? controls.radiance,
    absorption: witness.absorption ?? controls.absorption,
    glow: witness.glow ?? controls.glow,
    smoke: witness.smoke ?? controls.smoke,
    curl: witness.curl ?? controls.curl,
    reactionFuelScale: witness.reactionFuelScale ?? controls.reactionFuelScale ?? controls.reactionFuel,
    fireScale: witness.fireScale ?? controls.fireScale,
    detailScale: witness.detailScale ?? controls.detailScale,
    microdetail: witness.microdetail ?? controls.microdetail,
    interfaceShred: witness.interfaceShred ?? controls.interfaceShred,
    fireLicks: witness.fireLicks ?? controls.fireLicks,
    projection: witness.projection ?? controls.projection,
    speed: witness.speed ?? controls.speed,
    plumeHeight: witness.plumeHeight ?? controls.plumeHeight,
    windStrength: witness.windStrength ?? controls.windStrength,
    windAngle: witness.windAngle ?? controls.windAngle,
    windHeight: witness.windHeight ?? controls.windHeight,
    inputRadius: witness.inputRadius ?? controls.inputRadius,
    flowRate: witness.flowRate ?? controls.flowRate,
    majorantCadence: witness.majorantCadence ?? controls.majorantCadence,
    majorantBuildCadence: witness.majorantBuildCadence || witness.simCostLedger?.majorantBuildCadence,
    majorantBuiltThisFrame: witness.majorantBuiltThisFrame || witness.simCostLedger?.majorantBuiltThisFrame,
    majorantLastBuiltFrame: witness.majorantLastBuiltFrame || witness.simCostLedger?.majorantLastBuiltFrame,
    majorantSkippedFrameCount: witness.majorantSkippedFrameCount || witness.simCostLedger?.majorantSkippedFrameCount,
    pressureProjectionEnabled: witness.pressureProjectionEnabled ?? controls.pressureProjectionEnabled,
    pressureEffectiveLabel: witness.pressureEffectiveLabel ?? controls.pressureEffectiveLabel,
    pressureProjectionIterations: witness.pressureProjectionIterations ?? controls.pressureProjectionIterations ?? controls.pressureIterations,
    pressureIterationRequested: witness.pressureIterationRequested ?? controls.pressureIterationRequested,
    pressureIterationDefault: witness.pressureIterationDefault ?? controls.pressureIterationDefault,
    pressureStrategy: witness.pressureStrategy ?? controls.pressureStrategy ?? witness.simCostLedger?.pressureStrategy,
    activityPressureP4Enabled: witness.activityTierControls?.activityPressureP4Enabled ?? controls.activityPressureP4Enabled,
    activityPressureDispatchStrategy: witness.activityTierControls?.activityPressureDispatchStrategy ?? controls.activityPressureDispatchStrategy,
    activityTierControls: witness.activityTierControls,
    tallPlumePressureIterationStrategy: witness.tallPlumePressureIterationStrategy ?? witness.simCostLedger?.tallPlumePressureIterationStrategy,
    tallPlumePressureIterationTarget: witness.tallPlumePressureIterationTarget ?? witness.simCostLedger?.tallPlumePressureIterationTarget,
    tallPlumePressureTierStrategy: witness.tallPlumePressureTierStrategy ?? witness.simCostLedger?.tallPlumePressureTierStrategy,
    pressureProjectionReadStrategy: witness.pressureProjectionReadStrategy ?? witness.simCostLedger?.pressureProjectionReadStrategy,
    pressureJacobiFullGridEquivalentPasses: witness.pressureJacobiFullGridEquivalentPasses ?? witness.simCostLedger?.pressureJacobiFullGridEquivalentPasses,
    pressureTierDispatches: witness.pressureTierDispatches ?? witness.simCostLedger?.pressureTierDispatches,
    pressureTierRequestedBounds: witness.pressureTierRequestedBounds ?? witness.simCostLedger?.pressureTierRequestedBounds,
    pressureTierEffectiveBounds: witness.pressureTierEffectiveBounds ?? witness.simCostLedger?.pressureTierEffectiveBounds,
    pressureTierOverlayOpacity: witness.pressureTierOverlayOpacity ?? witness.simCostLedger?.pressureTierOverlayOpacity,
    simProfile: witness.simProfile ?? Boolean(witness.simCostLedger),
    simCostLedger: witness.simCostLedger,
    temporalEvidenceSource: witness.temporalEvidenceSource,
    timingEvidenceSource: witness.timingEvidenceSource,
    timingDisclaimer: witness.timingDisclaimer,
    externalEmitterMode: witness.externalEmitterMode,
    externalEmitterCount: witness.externalEmitterCount,
    externalEmitterCoordinateSpace: witness.externalEmitterCoordinateSpace,
  };
}

function makeSweepFailure(code, failurePhase, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.failurePhase = failurePhase;
  error.details = details;
  return error;
}

function throwSweepFailure(code, failurePhase, message, details = {}) {
  throw makeSweepFailure(code, failurePhase, message, details);
}

function closeEnough(actual, expected, epsilon = 0.015) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && Math.abs(actualNumber - expectedNumber) <= epsilon;
}

function witnessNumber(effective, primary, fallback) {
  const value = effective[primary] ?? (fallback ? effective[fallback] : undefined);
  return Number(value);
}

function checkNumber(checks, run, effective, runKey, effectiveKey = runKey, epsilon = 0.015) {
  if (run[runKey] === undefined) return;
  const actual = witnessNumber(effective, effectiveKey);
  if (!closeEnough(actual, run[runKey], epsilon)) {
    throwSweepFailure('stale-default-config', 'validation', `${runKey} requested ${run[runKey]} but effective ${effectiveKey} was ${effective[effectiveKey]}`, {
      scenarioId: run.id,
      runKey,
      effectiveKey,
      requested: run[runKey],
      effective: effective[effectiveKey],
    });
  }
  checks.push({ name: runKey, requested: run[runKey], effective: actual });
}

function checkExact(checks, run, effective, runKey, effectiveKey = runKey) {
  if (run[runKey] === undefined) return;
  if (String(effective[effectiveKey]) !== String(run[runKey])) {
    throwSweepFailure('stale-default-config', 'validation', `${runKey} requested ${run[runKey]} but effective ${effectiveKey} was ${effective[effectiveKey]}`, {
      scenarioId: run.id,
      runKey,
      effectiveKey,
      requested: run[runKey],
      effective: effective[effectiveKey],
    });
  }
  checks.push({ name: runKey, requested: run[runKey], effective: effective[effectiveKey] });
}

function validateWitness(run, witness, effective) {
  const checks = [];
  const warnings = [];
  if (effective.effectiveRoute !== EXPECTED_VOLUME_ROUTE_ID) {
    throwSweepFailure('wrong-fallback-route', 'validation', `expected ${EXPECTED_VOLUME_ROUTE_ID}, got ${effective.effectiveRoute || 'none'}`, {
      scenarioId: run.id,
      expected: EXPECTED_VOLUME_ROUTE_ID,
      effective: effective.effectiveRoute,
    });
  }
  checks.push({ name: 'effectiveRoute', effective: effective.effectiveRoute });

  if (effective.prototypeIdentity !== EXPECTED_PROTOTYPE_ID) {
    throwSweepFailure('absent-effective-identity', 'validation', `expected ${EXPECTED_PROTOTYPE_ID}, got ${effective.prototypeIdentity || 'none'}`, {
      scenarioId: run.id,
      expected: EXPECTED_PROTOTYPE_ID,
      effective: effective.prototypeIdentity,
    });
  }
  checks.push({ name: 'prototypeIdentity', effective: effective.prototypeIdentity });

  checkExact(checks, run, effective, 'volumeScene');
  if (run.tallPreset !== undefined) {
    if (effective.tallPreset === null || effective.tallPreset === undefined || effective.tallPreset === '') {
      warnings.push({
        code: 'preset-identity-not-retained',
        requested: run.tallPreset,
        effective: effective.tallPreset,
        evidence: effective.tallPresetEvidence,
        note: 'The page applied the tall-plume route controls but did not echo the preset label in witness state; expanded control checks carry effective identity.',
      });
      checks.push({
        name: 'tallPreset',
        requested: run.tallPreset,
        effective: effective.tallPreset,
        evidence: effective.tallPresetEvidence,
      });
    } else {
      checkExact(checks, run, effective, 'tallPreset');
    }
  }
  checkNumber(checks, run, effective, 'simGrid', 'simGrid', 0.5);
  checkNumber(checks, run, effective, 'majorantGrid', 'majorantGrid', 0.5);
  checkNumber(checks, run, effective, 'raySteps', 'raySteps', 0.5);
  checkNumber(checks, run, effective, 'renderScale');
  checkNumber(checks, run, effective, 'adaptiveRays', 'adaptiveRaymarch');
  checkNumber(checks, run, effective, 'occupancySkip');
  checkNumber(checks, run, effective, 'majorantSkip');
  checkNumber(checks, run, effective, 'majorantSmooth');
  checkNumber(checks, run, effective, 'majorantGuard');
  checkNumber(checks, run, effective, 'temporalAccum');
  checkNumber(checks, run, effective, 'temporalJitter');
  checkNumber(checks, run, effective, 'historyClamp');
  checkNumber(checks, run, effective, 'density');
  checkNumber(checks, run, effective, 'fire');
  checkNumber(checks, run, effective, 'smoke');
  checkNumber(checks, run, effective, 'glow');
  checkNumber(checks, run, effective, 'curl');
  checkNumber(checks, run, effective, 'radiance');
  checkNumber(checks, run, effective, 'absorption');
  checkNumber(checks, run, effective, 'reactionFuel', 'reactionFuelScale');
  checkNumber(checks, run, effective, 'fireScale');
  checkNumber(checks, run, effective, 'detailScale');
  checkNumber(checks, run, effective, 'microdetail');
  checkNumber(checks, run, effective, 'interfaceShred');
  checkNumber(checks, run, effective, 'fireLicks');
  checkNumber(checks, run, effective, 'projection');
  checkNumber(checks, run, effective, 'speed');
  checkNumber(checks, run, effective, 'plumeHeight');
  checkNumber(checks, run, effective, 'windStrength');
  checkNumber(checks, run, effective, 'windAngle');
  checkNumber(checks, run, effective, 'windHeight');
  checkNumber(checks, run, effective, 'inputRadius');
  checkNumber(checks, run, effective, 'flowRate');
  checkNumber(checks, run, effective, 'majorantCadence', 'majorantBuildCadence', 0.5);
  if (run.pressureStrategy !== 'spatial_tiers') {
    checkNumber(checks, run, effective, 'pressureIterations', 'pressureProjectionIterations', 0.5);
  }
  const expectedPressureEffectiveLabel = pressureEffectiveLabelForRun(run, effective);
  if (effective.pressureEffectiveLabel !== expectedPressureEffectiveLabel) {
    throwSweepFailure('pressure-effective-label-mismatch', 'validation', 'effective pressure label did not match route identity', {
      scenarioId: run.id,
      expected: expectedPressureEffectiveLabel,
      effective: effective.pressureEffectiveLabel,
      pressureStrategy: effective.pressureStrategy,
      pressureIterationRequested: effective.pressureIterationRequested,
      pressureProjectionIterations: effective.pressureProjectionIterations,
    });
  }
  checks.push({ name: 'pressureEffectiveLabel', expected: expectedPressureEffectiveLabel, effective: effective.pressureEffectiveLabel });

  if (run.simProfile !== undefined && !effective.simProfile && !effective.simCostLedger) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation profile was requested but no effective cost ledger was produced', {
      scenarioId: run.id,
      requested: run.simProfile,
      effective: effective.simProfile,
    });
  }
  checks.push({ name: 'simProfile', requested: Boolean(run.simProfile), effective: Boolean(effective.simProfile || effective.simCostLedger) });

  const metrics = witness.metrics || {};
  const visualPixels = Number(metrics.litPixels || 0)
    + Number(metrics.smokeLikePixels || 0)
    + Number(metrics.fireLikePixels || 0)
    + Number(metrics.emissiveLikePixels || 0);
  if (!Number.isFinite(visualPixels) || visualPixels <= 0) {
    throwSweepFailure('blank-or-partial-output', 'validation', 'witness reported no lit, smoke, fire, or emissive pixels', {
      scenarioId: run.id,
      metrics,
    });
  }
  checks.push({ name: 'visualSignalPixels', effective: visualPixels });

  const ledger = effective.simCostLedger;
  if (!ledger || ledger.identity !== 'tall-plume-sim-cost-ledger-v0' || ledger.routeIdentity !== EXPECTED_VOLUME_ROUTE_ID) {
    throwSweepFailure('missing-primary-report', 'validation', 'witness did not produce a trustworthy tall-plume simulation cost ledger', {
      scenarioId: run.id,
      ledger,
    });
  }
  for (const field of ['grid', 'majorantBuildCadence', 'pressureDivergencePasses', 'pressureJacobiPasses', 'pressureJacobiInlineDivergencePasses', 'pressureJacobiFullGridEquivalentPasses', 'mainFluidLocalProjectionDivergenceEvaluationsPerCell', 'fireLickBreakupEvaluationsPerCell', 'fireLickOperatorGain', 'bonfireCombustionFieldEvaluationsPerCell', 'bonfireProceduralBreakupEvaluationsPerCell', 'bonfireSymmetricForceEvaluationsPerCell', 'bonfireNonWindForceEvaluationsPerCell', 'bonfireScalarNeighborhoodReadsPerCell', 'tallPlumeDetailCoherenceExtraReadsPerCell', 'tallPlumeTransitionBandExtraReadsPerCell', 'tallPlumePressureIterationTarget', 'fullGridPassesPerFrame', 'fullGridCellVisitsPerFrame', 'fluidBufferBytes']) {
    if (!Number.isFinite(Number(ledger[field]))) {
      throwSweepFailure('missing-primary-report', 'validation', `simulation cost ledger missing numeric ${field}`, {
        scenarioId: run.id,
        field,
        ledger,
      });
    }
  }
  if (!['jacobi-inline-divergence-v0', 'disabled'].includes(ledger.pressureSourceStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown pressure source strategy', {
      scenarioId: run.id,
      pressureSourceStrategy: ledger.pressureSourceStrategy,
      ledger,
    });
  }
  if (![TALL_PLUME_PRESSURE_ITERATION_STRATEGY_PRESSURE2, TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE].includes(ledger.tallPlumePressureIterationStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown tall-plume pressure iteration strategy', {
      scenarioId: run.id,
      tallPlumePressureIterationStrategy: ledger.tallPlumePressureIterationStrategy,
      ledger,
    });
  }
  if (![TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY, TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE].includes(ledger.tallPlumePressureTierStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown tall-plume pressure tier strategy', {
      scenarioId: run.id,
      tallPlumePressureTierStrategy: ledger.tallPlumePressureTierStrategy,
      ledger,
    });
  }
  if (![PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE, PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER].includes(ledger.pressureProjectionReadStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown pressure projection read strategy', {
      scenarioId: run.id,
      pressureProjectionReadStrategy: ledger.pressureProjectionReadStrategy,
      ledger,
    });
  }
  const expectedTallPlumePressureIterationStrategy = effective.volumeScene === 'tall_plume' && Number(effective.pressureProjectionIterations) === 2
    ? TALL_PLUME_PRESSURE_ITERATION_STRATEGY_PRESSURE2
    : TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE;
  const expectedTallPlumePressureTierStrategy = effective.volumeScene === 'tall_plume' && effective.pressureStrategy === 'spatial_tiers'
    ? TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY
    : TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE;
  const expectedPressureProjectionReadStrategy = expectedTallPlumePressureTierStrategy === TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY
    ? PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE
    : PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER;
  const expectedTallPlumePressureIterationTarget = effective.volumeScene === 'tall_plume' && expectedTallPlumePressureTierStrategy !== TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY ? 2 : 0;
  if (
    ledger.tallPlumePressureIterationStrategy !== expectedTallPlumePressureIterationStrategy ||
    Number(ledger.tallPlumePressureIterationTarget) !== expectedTallPlumePressureIterationTarget ||
    ledger.tallPlumePressureTierStrategy !== expectedTallPlumePressureTierStrategy ||
    ledger.pressureProjectionReadStrategy !== expectedPressureProjectionReadStrategy
  ) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger tall-plume pressure strategy does not match the effective route', {
      scenarioId: run.id,
      volumeScene: effective.volumeScene,
      pressureProjectionIterations: effective.pressureProjectionIterations,
      tallPlumePressureIterationStrategy: ledger.tallPlumePressureIterationStrategy,
      tallPlumePressureIterationTarget: ledger.tallPlumePressureIterationTarget,
      expectedTallPlumePressureIterationStrategy,
      expectedTallPlumePressureIterationTarget,
      expectedTallPlumePressureTierStrategy,
      expectedPressureProjectionReadStrategy,
      ledger,
    });
  }
  if (![MAIN_FLUID_KERNEL_STRATEGY_FIRE_LICK_BREAKUP, MAIN_FLUID_KERNEL_STRATEGY_ZERO_FIRE_LICK_BYPASS].includes(ledger.mainFluidKernelStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown main fluid kernel strategy', {
      scenarioId: run.id,
      mainFluidKernelStrategy: ledger.mainFluidKernelStrategy,
      ledger,
    });
  }
  if (ledger.mainFluidLocalProjectionStrategy !== MAIN_FLUID_LOCAL_PROJECTION_STRATEGY_STAGED_PRESSURE_ONLY) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown main fluid local projection strategy', {
      scenarioId: run.id,
      mainFluidLocalProjectionStrategy: ledger.mainFluidLocalProjectionStrategy,
      ledger,
    });
  }
  if (![MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_ACTIVE, MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_NON_BONFIRE_BYPASS].includes(ledger.mainFluidBonfireCombustionFieldStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown bonfire combustion-field strategy', {
      scenarioId: run.id,
      mainFluidBonfireCombustionFieldStrategy: ledger.mainFluidBonfireCombustionFieldStrategy,
      ledger,
    });
  }
  const expectedBonfireCombustionStrategy = effective.volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_NON_BONFIRE_BYPASS;
  const expectedBonfireCombustionEvaluations = effective.volumeScene === 'bonfire_plume' ? 2 : 0;
  if (
    ledger.mainFluidBonfireCombustionFieldStrategy !== expectedBonfireCombustionStrategy ||
    Number(ledger.bonfireCombustionFieldEvaluationsPerCell) !== expectedBonfireCombustionEvaluations
  ) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger bonfire combustion-field cost does not match the effective scene', {
      scenarioId: run.id,
      volumeScene: effective.volumeScene,
      mainFluidBonfireCombustionFieldStrategy: ledger.mainFluidBonfireCombustionFieldStrategy,
      bonfireCombustionFieldEvaluationsPerCell: ledger.bonfireCombustionFieldEvaluationsPerCell,
      expectedBonfireCombustionStrategy,
      expectedBonfireCombustionEvaluations,
      ledger,
    });
  }
  if (![MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_ACTIVE, MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_NON_BONFIRE_BYPASS].includes(ledger.mainFluidBonfireProceduralBreakupStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown bonfire procedural-breakup strategy', {
      scenarioId: run.id,
      mainFluidBonfireProceduralBreakupStrategy: ledger.mainFluidBonfireProceduralBreakupStrategy,
      ledger,
    });
  }
  const expectedBonfireProceduralBreakupStrategy = effective.volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_NON_BONFIRE_BYPASS;
  const expectedBonfireProceduralBreakupEvaluations = effective.volumeScene === 'bonfire_plume' ? 4 : 0;
  if (
    ledger.mainFluidBonfireProceduralBreakupStrategy !== expectedBonfireProceduralBreakupStrategy ||
    Number(ledger.bonfireProceduralBreakupEvaluationsPerCell) !== expectedBonfireProceduralBreakupEvaluations
  ) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger bonfire procedural-breakup cost does not match the effective scene', {
      scenarioId: run.id,
      volumeScene: effective.volumeScene,
      mainFluidBonfireProceduralBreakupStrategy: ledger.mainFluidBonfireProceduralBreakupStrategy,
      bonfireProceduralBreakupEvaluationsPerCell: ledger.bonfireProceduralBreakupEvaluationsPerCell,
      expectedBonfireProceduralBreakupStrategy,
      expectedBonfireProceduralBreakupEvaluations,
      ledger,
    });
  }
  if (![MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_ACTIVE, MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_NON_BONFIRE_BYPASS].includes(ledger.mainFluidBonfireSymmetricForceStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown bonfire symmetric-force strategy', {
      scenarioId: run.id,
      mainFluidBonfireSymmetricForceStrategy: ledger.mainFluidBonfireSymmetricForceStrategy,
      ledger,
    });
  }
  const expectedBonfireSymmetricForceStrategy = effective.volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_NON_BONFIRE_BYPASS;
  const expectedBonfireSymmetricForceEvaluations = effective.volumeScene === 'bonfire_plume' ? 4 : 0;
  if (
    ledger.mainFluidBonfireSymmetricForceStrategy !== expectedBonfireSymmetricForceStrategy ||
    Number(ledger.bonfireSymmetricForceEvaluationsPerCell) !== expectedBonfireSymmetricForceEvaluations
  ) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger bonfire symmetric-force cost does not match the effective scene', {
      scenarioId: run.id,
      volumeScene: effective.volumeScene,
      mainFluidBonfireSymmetricForceStrategy: ledger.mainFluidBonfireSymmetricForceStrategy,
      bonfireSymmetricForceEvaluationsPerCell: ledger.bonfireSymmetricForceEvaluationsPerCell,
      expectedBonfireSymmetricForceStrategy,
      expectedBonfireSymmetricForceEvaluations,
      ledger,
    });
  }
  if (![MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_ACTIVE, MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_NON_BONFIRE_BYPASS].includes(ledger.mainFluidBonfireNonWindForceStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown bonfire non-wind force strategy', {
      scenarioId: run.id,
      mainFluidBonfireNonWindForceStrategy: ledger.mainFluidBonfireNonWindForceStrategy,
      ledger,
    });
  }
  const expectedBonfireNonWindForceStrategy = effective.volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_NON_BONFIRE_BYPASS;
  const expectedBonfireNonWindForceEvaluations = effective.volumeScene === 'bonfire_plume' ? 4 : 0;
  if (
    ledger.mainFluidBonfireNonWindForceStrategy !== expectedBonfireNonWindForceStrategy ||
    Number(ledger.bonfireNonWindForceEvaluationsPerCell) !== expectedBonfireNonWindForceEvaluations
  ) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger bonfire non-wind force cost does not match the effective scene', {
      scenarioId: run.id,
      volumeScene: effective.volumeScene,
      mainFluidBonfireNonWindForceStrategy: ledger.mainFluidBonfireNonWindForceStrategy,
      bonfireNonWindForceEvaluationsPerCell: ledger.bonfireNonWindForceEvaluationsPerCell,
      expectedBonfireNonWindForceStrategy,
      expectedBonfireNonWindForceEvaluations,
      ledger,
    });
  }
  if (![MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_ACTIVE, MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_NON_BONFIRE_BYPASS].includes(ledger.mainFluidBonfireScalarNeighborhoodStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown bonfire scalar-neighborhood strategy', {
      scenarioId: run.id,
      mainFluidBonfireScalarNeighborhoodStrategy: ledger.mainFluidBonfireScalarNeighborhoodStrategy,
      ledger,
    });
  }
  const expectedBonfireScalarNeighborhoodStrategy = effective.volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_NON_BONFIRE_BYPASS;
  const expectedBonfireScalarNeighborhoodReads = effective.volumeScene === 'bonfire_plume' ? 36 : 0;
  if (
    ledger.mainFluidBonfireScalarNeighborhoodStrategy !== expectedBonfireScalarNeighborhoodStrategy ||
    Number(ledger.bonfireScalarNeighborhoodReadsPerCell) !== expectedBonfireScalarNeighborhoodReads
  ) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger bonfire scalar-neighborhood cost does not match the effective scene', {
      scenarioId: run.id,
      volumeScene: effective.volumeScene,
      mainFluidBonfireScalarNeighborhoodStrategy: ledger.mainFluidBonfireScalarNeighborhoodStrategy,
      bonfireScalarNeighborhoodReadsPerCell: ledger.bonfireScalarNeighborhoodReadsPerCell,
      expectedBonfireScalarNeighborhoodStrategy,
      expectedBonfireScalarNeighborhoodReads,
      ledger,
    });
  }
  if (![TALL_PLUME_DETAIL_COHERENCE_STRATEGY_TRANSPORTED_PHASE_ANCHOR, TALL_PLUME_DETAIL_COHERENCE_STRATEGY_INACTIVE].includes(ledger.tallPlumeDetailCoherenceStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown tall-plume detail coherence strategy', {
      scenarioId: run.id,
      tallPlumeDetailCoherenceStrategy: ledger.tallPlumeDetailCoherenceStrategy,
      ledger,
    });
  }
  const expectedDetailCoherenceStrategy = effective.volumeScene === 'tall_plume'
    ? TALL_PLUME_DETAIL_COHERENCE_STRATEGY_TRANSPORTED_PHASE_ANCHOR
    : TALL_PLUME_DETAIL_COHERENCE_STRATEGY_INACTIVE;
  if (
    ledger.tallPlumeDetailCoherenceStrategy !== expectedDetailCoherenceStrategy ||
    Number(ledger.tallPlumeDetailCoherenceExtraReadsPerCell) !== 0
  ) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger tall-plume detail coherence cost does not match the effective scene', {
      scenarioId: run.id,
      volumeScene: effective.volumeScene,
      tallPlumeDetailCoherenceStrategy: ledger.tallPlumeDetailCoherenceStrategy,
      tallPlumeDetailCoherenceExtraReadsPerCell: ledger.tallPlumeDetailCoherenceExtraReadsPerCell,
      expectedDetailCoherenceStrategy,
      expectedDetailCoherenceExtraReads: 0,
      ledger,
    });
  }
  if (![TALL_PLUME_TRANSITION_BAND_STRATEGY_STAGGERED_RETIREMENT, TALL_PLUME_TRANSITION_BAND_STRATEGY_INACTIVE].includes(ledger.tallPlumeTransitionBandStrategy)) {
    throwSweepFailure('wrong-fallback-route', 'validation', 'simulation cost ledger reported an unknown tall-plume transition-band strategy', {
      scenarioId: run.id,
      tallPlumeTransitionBandStrategy: ledger.tallPlumeTransitionBandStrategy,
      ledger,
    });
  }
  const expectedTransitionBandStrategy = effective.volumeScene === 'tall_plume'
    ? TALL_PLUME_TRANSITION_BAND_STRATEGY_STAGGERED_RETIREMENT
    : TALL_PLUME_TRANSITION_BAND_STRATEGY_INACTIVE;
  if (
    ledger.tallPlumeTransitionBandStrategy !== expectedTransitionBandStrategy ||
    Number(ledger.tallPlumeTransitionBandExtraReadsPerCell) !== 0
  ) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger tall-plume transition-band cost does not match the effective scene', {
      scenarioId: run.id,
      volumeScene: effective.volumeScene,
      tallPlumeTransitionBandStrategy: ledger.tallPlumeTransitionBandStrategy,
      tallPlumeTransitionBandExtraReadsPerCell: ledger.tallPlumeTransitionBandExtraReadsPerCell,
      expectedTransitionBandStrategy,
      expectedTransitionBandExtraReads: 0,
      ledger,
    });
  }
  if (Number(ledger.mainFluidLocalProjectionDivergenceEvaluationsPerCell) !== 0) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger still reports local main-fluid divergence projection evaluations', {
      scenarioId: run.id,
      mainFluidLocalProjectionDivergenceEvaluationsPerCell: ledger.mainFluidLocalProjectionDivergenceEvaluationsPerCell,
      ledger,
    });
  }
  if (ledger.mainFluidKernelStrategy === MAIN_FLUID_KERNEL_STRATEGY_ZERO_FIRE_LICK_BYPASS && Number(ledger.fireLickBreakupEvaluationsPerCell) !== 0) {
    throwSweepFailure('stale-default-config', 'validation', 'zero fire-lick bypass still reports breakup evaluations', {
      scenarioId: run.id,
      fireLickBreakupEvaluationsPerCell: ledger.fireLickBreakupEvaluationsPerCell,
      ledger,
    });
  }
  if (ledger.mainFluidKernelStrategy === MAIN_FLUID_KERNEL_STRATEGY_FIRE_LICK_BREAKUP && Number(ledger.fireLickBreakupEvaluationsPerCell) <= 0) {
    throwSweepFailure('partial-primary-output', 'validation', 'active fire-lick strategy did not report breakup evaluations', {
      scenarioId: run.id,
      fireLickBreakupEvaluationsPerCell: ledger.fireLickBreakupEvaluationsPerCell,
      ledger,
    });
  }
  if (Number(ledger.pressureDivergencePasses) !== 0) {
    throwSweepFailure('stale-default-config', 'validation', 'simulation cost ledger still reports a standalone pressure divergence pass', {
      scenarioId: run.id,
      pressureDivergencePasses: ledger.pressureDivergencePasses,
      ledger,
    });
  }
  if (Number(ledger.pressureJacobiInlineDivergencePasses) !== Number(ledger.pressureJacobiPasses)) {
    throwSweepFailure('partial-primary-output', 'validation', 'simulation cost ledger inline-divergence Jacobi count does not match Jacobi pressure cost', {
      scenarioId: run.id,
      pressureJacobiPasses: ledger.pressureJacobiPasses,
      pressureJacobiInlineDivergencePasses: ledger.pressureJacobiInlineDivergencePasses,
      ledger,
    });
  }
  if (!ledger.fullGridPassBreakdown || Number(ledger.fullGridPassBreakdown.total) !== Number(ledger.fullGridPassesPerFrame)) {
    throwSweepFailure('partial-primary-output', 'validation', 'simulation cost ledger pass breakdown does not match full-grid pass count', {
      scenarioId: run.id,
      fullGridPassBreakdown: ledger.fullGridPassBreakdown,
      fullGridPassesPerFrame: ledger.fullGridPassesPerFrame,
      ledger,
    });
  }
  checks.push({ name: 'simCostLedger', effective: ledger.identity });

  return {
    status: 'passed',
    matrixId: run.performanceMatrixId || null,
    checks,
    warnings,
    falseClosureLabels: FALSE_CLOSURE_LABELS,
    simCostLedgerIdentity: ledger.identity,
    routeIdentity: effective.effectiveRoute,
    prototypeIdentity: effective.prototypeIdentity,
  };
}

function scoreSweepRun(run) {
  const frameP95 = Number(run.frameP95Ms);
  const queueP95 = Number(run.queueDoneP95Ms);
  const metrics = run.metrics || {};
  const litPixels = Number(metrics.litPixels || 0);
  const smokePixels = Number(metrics.smokeLikePixels || 0);
  const firePixels = Number(metrics.fireLikePixels || 0);
  const emissivePixels = Number(metrics.emissiveLikePixels || 0);
  const timingPenalty = (Number.isFinite(frameP95) ? frameP95 : 20) * 0.9 + (Number.isFinite(queueP95) ? queueP95 : 20) * 0.35;
  const visualSignal = Math.log1p(litPixels) * 4 + Math.log1p(smokePixels) * 2 + Math.log1p(firePixels + emissivePixels) * 2.5;
  const resolutionPenalty = Math.max(0, 1 - Number(run.effectiveConfig?.renderPixelRatio || 1)) * 5.5;
  return Number((visualSignal - timingPenalty - resolutionPenalty).toFixed(3));
}

function rankRecommendations(aggregate) {
  const ranked = aggregate.runs
    .map((run) => ({ run, score: scoreSweepRun(run) }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach((entry, index) => {
    entry.run.score = entry.score;
    entry.run.recommendationRank = index + 1;
  });
  aggregate.recommendations = ranked.slice(0, 4).map(({ run, score }) => ({
    recommendationRank: run.recommendationRank,
    scenarioId: run.scenarioId,
    label: run.label,
    score,
    frameP95Ms: run.frameP95Ms,
    queueDoneP95Ms: run.queueDoneP95Ms,
    renderScale: run.effectiveConfig?.renderScale,
    raySteps: run.effectiveConfig?.raySteps,
    adaptiveRaymarch: run.effectiveConfig?.adaptiveRaymarch,
    report: run.report,
    screenshot: run.screenshot,
  }));
}

function writeAggregate(aggregate) {
  rankRecommendations(aggregate);
  writeFileSync(aggregatePath, JSON.stringify({ aggregate }, null, 2));
}

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(aggregatePath), { recursive: true });

const runs = selectedRuns();
const aggregate = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  matrixMode,
  performanceMatrixId: PERFORMANCE_MATRIX_ID,
  expectedRoute: EXPECTED_VOLUME_ROUTE_ID,
  expectedPrototype: EXPECTED_PROTOTYPE_ID,
  dryRun,
  settleMs,
  windowSize,
  compactScenarioIds: COMPACT_MATRIX_SCENARIOS.map((scenario) => scenario.id),
  performanceScenarioIds: PERFORMANCE_MATRIX_SCENARIOS.map((scenario) => scenario.id),
  runs: [],
  failures: [],
  recommendations: [],
};

if (dryRun) {
  aggregate.runs = runs.map((run) => ({
    scenarioId: run.id,
    label: run.label,
    url: routeFor(run),
    requestedConfig: requestedConfig(run),
  }));
  writeFileSync(aggregatePath, JSON.stringify({ aggregate }, null, 2));
  console.log(JSON.stringify({ aggregate }, null, 2));
  process.exit(0);
}

for (let i = 0; i < runs.length; i += 1) {
  const run = runs[i];
  const slug = slugFor(run);
  const screenshot = `${outDir}/${slug}.png`;
  const report = `${outDir}/${slug}.json`;
  const url = routeFor(run);
  try {
    execFileSync(process.execPath, [
      'volume-witness.mjs',
      '--url', url,
      '--out', screenshot,
      '--report', report,
      '--debug-port', String(debugPort + i),
      '--user-data-dir', `${outDir}/profile-${slug}`,
      '--settle-ms', String(settleMs),
      '--window-size', windowSize,
      '--evidence-mode', matrixMode === 'performance' ? 'performance' : 'fire-volume',
    ], { cwd: new URL('.', import.meta.url).pathname, stdio: 'pipe' });
    const witness = JSON.parse(readFileSync(report, 'utf8'));
    const effective = effectiveConfig(witness);
    const validation = validateWitness(run, witness, effective);
    const simCostLedger = witness.simCostLedger;
    aggregate.runs.push({
      performanceMatrixId: run.performanceMatrixId || null,
      scenarioId: run.id,
      label: run.label,
      url,
      report,
      screenshot,
      requestedConfig: requestedConfig(run),
      effectiveConfig: effective,
      validation,
      evidenceMode: witness.evidenceMode,
      visualEvidenceMode: witness.visualEvidenceMode,
      performanceVisualWarnings: witness.performanceVisualWarnings || [],
      simCostLedger,
      fullGridPassesPerFrame: simCostLedger?.fullGridPassesPerFrame,
      fullGridCellVisitsPerFrame: simCostLedger?.fullGridCellVisitsPerFrame,
      fluidBufferBytes: simCostLedger?.fluidBufferBytes,
      pressureSourceStrategy: simCostLedger?.pressureSourceStrategy,
      mainFluidKernelStrategy: simCostLedger?.mainFluidKernelStrategy,
      mainFluidLocalProjectionStrategy: simCostLedger?.mainFluidLocalProjectionStrategy,
      mainFluidLocalProjectionDivergenceEvaluationsPerCell: simCostLedger?.mainFluidLocalProjectionDivergenceEvaluationsPerCell,
      fireLickBreakupEvaluationsPerCell: simCostLedger?.fireLickBreakupEvaluationsPerCell,
      fireLickOperatorGain: simCostLedger?.fireLickOperatorGain,
      mainFluidBonfireCombustionFieldStrategy: simCostLedger?.mainFluidBonfireCombustionFieldStrategy,
      bonfireCombustionFieldEvaluationsPerCell: simCostLedger?.bonfireCombustionFieldEvaluationsPerCell,
      mainFluidBonfireProceduralBreakupStrategy: simCostLedger?.mainFluidBonfireProceduralBreakupStrategy,
      bonfireProceduralBreakupEvaluationsPerCell: simCostLedger?.bonfireProceduralBreakupEvaluationsPerCell,
      mainFluidBonfireSymmetricForceStrategy: simCostLedger?.mainFluidBonfireSymmetricForceStrategy,
      bonfireSymmetricForceEvaluationsPerCell: simCostLedger?.bonfireSymmetricForceEvaluationsPerCell,
      mainFluidBonfireNonWindForceStrategy: simCostLedger?.mainFluidBonfireNonWindForceStrategy,
      bonfireNonWindForceEvaluationsPerCell: simCostLedger?.bonfireNonWindForceEvaluationsPerCell,
      mainFluidBonfireScalarNeighborhoodStrategy: simCostLedger?.mainFluidBonfireScalarNeighborhoodStrategy,
      bonfireScalarNeighborhoodReadsPerCell: simCostLedger?.bonfireScalarNeighborhoodReadsPerCell,
      pressureDivergencePasses: simCostLedger?.pressureDivergencePasses,
      pressureJacobiPasses: simCostLedger?.pressureJacobiPasses,
      pressureJacobiInlineDivergencePasses: simCostLedger?.pressureJacobiInlineDivergencePasses,
      pressureJacobiFullGridEquivalentPasses: simCostLedger?.pressureJacobiFullGridEquivalentPasses,
      pressureEffectiveLabel: witness.pressureEffectiveLabel,
      activityPressureP4Enabled: effective.activityPressureP4Enabled,
      activityTierControls: effective.activityTierControls,
      tallPlumePressureIterationStrategy: simCostLedger?.tallPlumePressureIterationStrategy,
      tallPlumePressureIterationTarget: simCostLedger?.tallPlumePressureIterationTarget,
      tallPlumePressureTierStrategy: simCostLedger?.tallPlumePressureTierStrategy,
      pressureProjectionReadStrategy: simCostLedger?.pressureProjectionReadStrategy,
      pressureTierDispatches: simCostLedger?.pressureTierDispatches,
      pressureTierRequestedBounds: simCostLedger?.pressureTierRequestedBounds,
      pressureTierEffectiveBounds: simCostLedger?.pressureTierEffectiveBounds,
      pressureTierOverlayOpacity: simCostLedger?.pressureTierOverlayOpacity,
      fullGridPassBreakdown: simCostLedger?.fullGridPassBreakdown,
      majorantBuildCadence: simCostLedger?.majorantBuildCadence,
      backend: witness.backend,
      effectiveRoute: witness.effectiveRoute,
      prototypeIdentity: witness.prototypeIdentity,
      raySteps: witness.raySteps,
      adaptiveRaymarch: witness.adaptiveRaymarch,
      occupancySkip: witness.occupancySkip,
      majorantSkip: witness.majorantSkip,
      majorantSmooth: witness.majorantSmooth,
      majorantGuard: witness.majorantGuard,
      simGrid: witness.simGrid,
      majorantGrid: witness.majorantGrid,
      majorantBuilt: witness.majorantBuilt,
      occupiedBricks: witness.majorantReadback?.occupiedBricks,
      renderScale: witness.renderScale,
      renderPixelRatio: witness.renderPixelRatio,
      displayWidth: witness.displayWidth,
      displayHeight: witness.displayHeight,
      renderWidth: witness.renderWidth,
      renderHeight: witness.renderHeight,
      externalEmitterMode: witness.externalEmitterMode,
      externalEmitterCount: witness.externalEmitterCount,
      temporalEvidenceSource: witness.temporalEvidenceSource,
      timingEvidenceSource: witness.timingEvidenceSource,
      timingDisclaimer: witness.timingDisclaimer,
      frameP95Ms: witness.timing?.frameP95Ms,
      queueDoneMs: witness.timing?.queueDoneMs,
      queueDoneP95Ms: witness.timing?.queueDoneP95Ms,
      metrics: witness.metrics,
      simReadback: witness.simReadback,
      majorantReadback: witness.majorantReadback,
    });
  } catch (error) {
    const failure = {
      scenarioId: run.id,
      label: run.label,
      url,
      report,
      screenshot,
      requestedConfig: requestedConfig(run),
      failureCode: error?.code || 'missing-primary-report',
      failurePhase: error?.failurePhase || 'witness-execution',
      failureDetails: error?.details || null,
      validation: error?.validation || null,
      error: error?.message || String(error),
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || ''),
    };
    aggregate.failures.push(failure);
    try {
      failure.partialReport = JSON.parse(readFileSync(report, 'utf8'));
    } catch {}
  } finally {
    writeAggregate(aggregate);
  }
}

writeAggregate(aggregate);
console.log(JSON.stringify({ aggregate }, null, 2));
if (aggregate.failures.length > 0) process.exit(1);
