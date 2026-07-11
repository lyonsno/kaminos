#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deflateSync, inflateSync as zlibInflateSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-volume-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || mkdtempSync('/tmp/kaminos-volume-witness-profile-');
const settleMs = Number(args.get('--settle-ms') || 1500);
const windowSize = args.get('--window-size') || '1280,960';
const fullScreenshot = args.has('--full-screenshot')
  ? resolve(args.get('--full-screenshot') || out.replace(/\.png$/i, '.full.png'))
  : '';
const VALID_EVIDENCE_MODES = new Set(['fire-volume', 'performance', 'pyro-material', 'no-fire-volume']);
const evidenceMode = args.get('--evidence-mode') || 'fire-volume';
if (!VALID_EVIDENCE_MODES.has(evidenceMode)) {
  throw new Error(`Unknown witness evidence mode: ${evidenceMode}`);
}
const expectsPerformanceVolumeEvidence = evidenceMode === 'performance';
const expectsPyroMaterialEvidence = evidenceMode === 'pyro-material';
const expectsNoFireVolumeEvidence = evidenceMode === 'no-fire-volume';
const visualEvidenceMode = expectsNoFireVolumeEvidence
  ? 'no-fire-volume-signal'
  : (expectsPyroMaterialEvidence ? 'pyro-material-coupled-volume-signal' : (expectsPerformanceVolumeEvidence ? 'performance-volume-signal' : 'fire-volume'));
const TALL_PLUME_PRESSURE_ITERATION_STRATEGY_PRESSURE2 = 'tall-plume-pressure2-v0';
const TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE = 'inactive';
const TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY = 'tall-plume-spatial-pressure-tiers-v0';
const TALL_PLUME_ACTIVITY_PRESSURE_TIER_STRATEGY = 'tall-plume-current-sim-activity-pressure-tiers-v0';
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
const FIRE_LICK_BREAKUP_BYPASS_THRESHOLD = 0.0005;

function normalizeLifecycleEffect(value) {
  const normalized = String(value || 'none').toLowerCase();
  return normalized === 'snuff' ? 'snuff' : 'none';
}

function normalizeRuntimeQuality(value) {
  const normalized = String(value || 'live_high').toLowerCase().replace(/-/g, '_');
  if (['live_high', 'live', 'high', 'hero', 'default'].includes(normalized)) return 'live_high';
  if (['live_low', 'low', 'degraded', 'throttled'].includes(normalized)) return 'live_low';
  if (['holdover', 'hold', 'paused', 'freeze', 'frozen'].includes(normalized)) return 'holdover';
  if (['impostor', 'imposter', 'emergency', 'fallback', 'prerender'].includes(normalized)) return 'impostor';
  if (normalized === 'auto') return 'auto';
  return 'live_high';
}

function runtimeQualityFromPressure(requested, gpuPressure) {
  const normalized = normalizeRuntimeQuality(requested);
  if (normalized !== 'auto') return normalized;
  if (gpuPressure >= 0.90) return 'impostor';
  if (gpuPressure >= 0.70) return 'holdover';
  if (gpuPressure >= 0.45) return 'live_low';
  return 'live_high';
}

function fireLickOperatorGainFromAmount(value) {
  const numeric = Number(value);
  const amount = Math.max(0, Math.min(5, Number.isFinite(numeric) ? numeric : 0));
  return amount * (0.82 + amount * 0.110);
}

function expectedMainFluidKernelStrategy(fireLicks) {
  return fireLickOperatorGainFromAmount(fireLicks) > FIRE_LICK_BREAKUP_BYPASS_THRESHOLD
    ? MAIN_FLUID_KERNEL_STRATEGY_FIRE_LICK_BREAKUP
    : MAIN_FLUID_KERNEL_STRATEGY_ZERO_FIRE_LICK_BYPASS;
}

function expectedFireLickBreakupEvaluationsPerCell(fireLicks) {
  return expectedMainFluidKernelStrategy(fireLicks) === MAIN_FLUID_KERNEL_STRATEGY_FIRE_LICK_BREAKUP ? 2 : 0;
}

function assertNoPlaceholderTopologyClaim(primitives = []) {
  for (const primitive of primitives) {
    const placeholderContract = primitive?.placeholderContract || primitive?.coupling?.placeholderContract || primitive?.lamellarHook?.placeholderContract;
    const claimsProduction =
      primitive?.topologyAuthority === 'production' ||
      primitive?.coupling?.topologyAuthority === 'production' ||
      primitive?.claims?.productionLamellarTopology === true;
    if (placeholderContract && claimsProduction) {
      throw new Error(`Volume primitive ${primitive?.id || '(unknown)'} carries placeholderContract=${placeholderContract} but claims production Lamellar topology`);
    }
  }
}

function expectedBonfireCombustionFieldStrategy(volumeScene) {
  return volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_NON_BONFIRE_BYPASS;
}

function expectedBonfireCombustionFieldEvaluationsPerCell(volumeScene) {
  return volumeScene === 'bonfire_plume' ? 2 : 0;
}

function expectedBonfireProceduralBreakupStrategy(volumeScene) {
  return volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_NON_BONFIRE_BYPASS;
}

function expectedBonfireProceduralBreakupEvaluationsPerCell(volumeScene) {
  return volumeScene === 'bonfire_plume' ? 4 : 0;
}

function expectedBonfireSymmetricForceStrategy(volumeScene) {
  return volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_NON_BONFIRE_BYPASS;
}

function expectedBonfireSymmetricForceEvaluationsPerCell(volumeScene) {
  return volumeScene === 'bonfire_plume' ? 4 : 0;
}

function expectedBonfireNonWindForceStrategy(volumeScene) {
  return volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_NON_BONFIRE_BYPASS;
}

function expectedBonfireNonWindForceEvaluationsPerCell(volumeScene) {
  return volumeScene === 'bonfire_plume' ? 4 : 0;
}

function expectedBonfireScalarNeighborhoodStrategy(volumeScene) {
  return volumeScene === 'bonfire_plume'
    ? MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_ACTIVE
    : MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_NON_BONFIRE_BYPASS;
}

function expectedBonfireScalarNeighborhoodReadsPerCell(volumeScene) {
  return volumeScene === 'bonfire_plume' ? 36 : 0;
}

function expectedTallPlumeDetailCoherenceStrategy(volumeScene) {
  return volumeScene === 'tall_plume'
    ? TALL_PLUME_DETAIL_COHERENCE_STRATEGY_TRANSPORTED_PHASE_ANCHOR
    : TALL_PLUME_DETAIL_COHERENCE_STRATEGY_INACTIVE;
}

function expectedTallPlumeDetailCoherenceExtraReadsPerCell() {
  return 0;
}

function expectedTallPlumeTransitionBandStrategy(volumeScene) {
  return volumeScene === 'tall_plume'
    ? TALL_PLUME_TRANSITION_BAND_STRATEGY_STAGGERED_RETIREMENT
    : TALL_PLUME_TRANSITION_BAND_STRATEGY_INACTIVE;
}

function expectedTallPlumeTransitionBandExtraReadsPerCell() {
  return 0;
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildPyroRawCarrierPaintEvidence(sample = {}, state = {}) {
  const sim = sample.simReadback || {};
  const coupling = sample.pyroMaterialRendererCoupling || state.pyroMaterialRendererCoupling || {};
  const controls = coupling.carrierControls || {};
  const flamePaint = finiteNumber(controls.flamePaint);
  const stockMix = finiteNumber(controls.stockMix, 1);
  const effectiveGain = finiteNumber(coupling.effectiveGain);
  const liveFireAuthority = finiteNumber(coupling.liveFireAuthority);
  const uploadedCells = finiteNumber(coupling.spatialMemory?.uploadedCells);
  const fireLayerMean = finiteNumber(sim.fireLayerMean);
  const heatMean = finiteNumber(sim.heatMean);
  const reactionMean = finiteNumber(sim.reactionMean);
  const fuelConsumptionMean = finiteNumber(sim.fuelConsumptionMean);
  const fireLickMean = finiteNumber(sim.fireLickMean);
  const combustionFrontMean = finiteNumber(sim.combustionFrontMean);
  const frontTopologyMean = finiteNumber(sim.frontTopologyMean);
  const detailMean = finiteNumber(sim.detailMean);
  const radianceMean = finiteNumber(sim.radianceMean);
  const rawCarrierScore =
    heatMean +
    reactionMean +
    fuelConsumptionMean * 8 +
    fireLickMean * 3 +
    combustionFrontMean * 5 +
    frontTopologyMean * 5 +
    detailMean * 0.25 +
    radianceMean * 0.5;
  const hasLiveSpatialCoupling =
    coupling.identity === 'pyro-material-memory-spatial-coupling-v0' &&
    coupling.spatialMemory?.identity === 'pyro-material-memory-spatial-coupling-v0' &&
    uploadedCells > 0 &&
    effectiveGain > 0 &&
    liveFireAuthority > 0.05 &&
    coupling.materialShaderReadiness === 'sampleable-debug-only';
  const wantsRawPaint = flamePaint > 0.05 && stockMix < 0.95;
  const hasRawLiveCarrier = rawCarrierScore > 0.0025 && (heatMean > 0.001 || reactionMean > 0.001 || fireLickMean > 0.0002 || combustionFrontMean > 0.00003 || frontTopologyMean > 0.00003);
  const stockFireLayerLow = fireLayerMean <= 0.0005;
  const acceptsLowStockFireLayer = hasLiveSpatialCoupling && wantsRawPaint && hasRawLiveCarrier;
  return {
    identity: 'pyro-raw-carrier-paint-evidence-v0',
    phase: stockFireLayerLow && acceptsLowStockFireLayer
      ? 'stock-fire-layer-low-but-raw-pyro-carrier-live'
      : (stockFireLayerLow ? 'stock-fire-layer-low-raw-pyro-carrier-unproven' : 'stock-fire-layer-present'),
    acceptsLowStockFireLayer,
    hasLiveSpatialCoupling,
    wantsRawPaint,
    hasRawLiveCarrier,
    flamePaint,
    stockMix,
    effectiveGain,
    liveFireAuthority,
    uploadedCells,
    materialShaderReadiness: coupling.materialShaderReadiness || null,
    fireLayerMean,
    rawCarrierScore,
    carriers: {
      heatMean,
      reactionMean,
      fuelConsumptionMean,
      fireLickMean,
      combustionFrontMean,
      frontTopologyMean,
      detailMean,
      radianceMean,
    },
  };
}

function defaultPressureIterationsForScene(volumeScene) {
  if (volumeScene === 'tall_plume') return 2;
  return volumeScene === 'bonfire_plume' ? 8 : 4;
}

function expectedTallPlumePressureIterationStrategy(volumeScene, pressureIterations) {
  return volumeScene === 'tall_plume' && Number(pressureIterations) === 2
    ? TALL_PLUME_PRESSURE_ITERATION_STRATEGY_PRESSURE2
    : TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE;
}

function normalizePressureStrategy(value, volumeScene) {
  const requested = String(value || 'global').toLowerCase();
  if (volumeScene === 'tall_plume' && requested === 'spatial_tiers') return 'spatial_tiers';
  if (volumeScene === 'tall_plume' && requested === 'activity_tiers') return 'activity_tiers';
  return 'global';
}

function normalizeVolumePressureMode(value) {
  const mode = String(value || 'auto').toLowerCase();
  return ['auto', 'spatial-tiers', 'activity-tiers', 'global-p3', 'global-p2', 'global-p1', 'routed-global'].includes(mode) ? mode : 'auto';
}

function pressureConfigForMode(mode, volumeScene, fallbackStrategy, fallbackIterations) {
  const normalized = normalizeVolumePressureMode(mode);
  switch (normalized) {
    case 'spatial-tiers':
      return { pressureStrategy: volumeScene === 'tall_plume' ? 'spatial_tiers' : 'global', pressureIterations: volumeScene === 'tall_plume' ? 3 : fallbackIterations };
    case 'activity-tiers':
      return { pressureStrategy: volumeScene === 'tall_plume' ? 'activity_tiers' : 'global', pressureIterations: volumeScene === 'tall_plume' ? 3 : fallbackIterations };
    case 'global-p3':
      return { pressureStrategy: 'global', pressureIterations: 3 };
    case 'global-p2':
      return { pressureStrategy: 'global', pressureIterations: 2 };
    case 'global-p1':
      return { pressureStrategy: 'global', pressureIterations: 1 };
    default:
      return { pressureStrategy: fallbackStrategy, pressureIterations: fallbackIterations };
  }
}

function expectedTallPlumePressureTierStrategy(volumeScene, pressureStrategy) {
  if (volumeScene !== 'tall_plume') return TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE;
  if (pressureStrategy === 'spatial_tiers') return TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY;
  if (pressureStrategy === 'activity_tiers') return TALL_PLUME_ACTIVITY_PRESSURE_TIER_STRATEGY;
  return TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE;
}

const routeParams = new URL(url).searchParams;
const VOLUME_SCENE_PRESETS = {
  canonical_plume: {
    fireScale: 0.86,
    detailScale: 0.75,
    plumeHeight: 1.45,
    curl: 0.90,
    microdetail: 0,
    interfaceShred: 0,
    fireLicks: 0,
    windStrength: 0,
    windAngle: 0,
    windHeight: 0.15,
  },
  compact_plume: {},
  tall_plume: {
    fireScale: 0.35,
    detailScale: 3.20,
    plumeHeight: 2.20,
    curl: 3.80,
    microdetail: 2.50,
    interfaceShred: 1.20,
    fireLicks: 5.00,
    windStrength: 0,
    windAngle: 0,
    windHeight: 0.15,
  },
  bonfire_plume: {
    fireScale: 0.78,
    detailScale: 2.75,
    plumeHeight: 2.20,
    curl: 3.40,
    microdetail: 2.50,
    interfaceShred: 1.85,
    fireLicks: 4.25,
    windStrength: 0,
    windAngle: 0,
    windHeight: 0.15,
  },
};
const TALL_PLUME_OPERATOR_PRESETS = {
  operator_fire_0622: {
    volumeScene: 'tall_plume',
    density: 3.05,
    fire: 0.10,
    radiance: 2.90,
    absorption: 2.00,
    glow: 2.50,
    smoke: 2.80,
    curl: 2.30,
    microdetail: 0.00,
    interfaceShred: 1.55,
    fireLicks: 3.25,
    projection: 0.25,
    speed: 5.00,
    raySteps: 160,
    adaptiveRays: 0.00,
    occupancySkip: 0.00,
    majorantSkip: 0.00,
    majorantSmooth: 0.10,
    majorantGuard: 0.30,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 1.00,
    fireScale: 0.42,
    detailScale: 1.00,
    plumeHeight: 0.70,
    windStrength: 0.00,
    windAngle: 180,
    windHeight: -0.80,
    renderScale: 0.95,
  },
  operator_memory_fire_0701: {
    volumeScene: 'tall_plume',
    density: 5.20,
    fire: 0.00,
    radiance: 3.00,
    absorption: 2.00,
    glow: 2.50,
    smoke: 2.80,
    curl: 2.70,
    microdetail: 2.50,
    interfaceShred: 5.00,
    fireLicks: 1.70,
    projection: 1.50,
    speed: 5.00,
    raySteps: 160,
    adaptiveRays: 0.00,
    occupancySkip: 0.00,
    majorantSkip: 1.00,
    majorantSmooth: 0.85,
    majorantGuard: 0.50,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 0.70,
    fireScale: 0.35,
    detailScale: 0.50,
    plumeHeight: 1.20,
    windStrength: 0.80,
    windAngle: 0,
    windHeight: -0.35,
    renderScale: 0.35,
    inputRadius: 0.12,
    flowRate: 0.35,
    resolution: 128,
    majorantGrid: 48,
    pressureMode: 'global-p3',
    pressureTierLowerMax: 0.64,
    pressureTierHeroMin: 0.18,
    pressureTierHeroMax: 0.53,
  },
  pyro_contrast_warm_cap_small_flame_0702: {
    volumeScene: 'tall_plume',
    density: 6.00,
    fire: 3.50,
    radiance: 2.30,
    absorption: 0.30,
    glow: 2.05,
    smoke: 2.15,
    curl: 3.70,
    microdetail: 2.50,
    interfaceShred: 5.00,
    fireLicks: 5.00,
    projection: 1.50,
    speed: 0.75,
    raySteps: 160,
    adaptiveRays: 0.00,
    occupancySkip: 0.00,
    majorantSkip: 1.00,
    majorantSmooth: 0.00,
    majorantGuard: 1.00,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 0.70,
    fireScale: 1.17,
    detailScale: 2.55,
    plumeHeight: 1.75,
    windStrength: 1.50,
    windAngle: 0,
    windHeight: -0.55,
    renderScale: 0.70,
    inputRadius: 0.08,
    flowRate: 0.25,
    resolution: 160,
    majorantGrid: 48,
    pyroDynamicDetail: 1,
    pyroMaterialGain: 1.50,
    pyroInterfaceFocus: 0.00,
    pyroEdgeBite: 1.00,
    pyroBiteBorder: 0.60,
    pyroBiteTeeth: 0.90,
    pyroBiteWake: 1.00,
    pyroBiteHeat: 0.70,
    pyroBiteChroma: 0.60,
    pyroSmokeFold: 1.00,
    pyroFoldBorder: 0.85,
    pyroFoldWake: 1.00,
    pyroRadiance: 0.65,
    pyroRadianceGate: 0.62,
    pyroRadianceSpill: 0.30,
    pyroRadianceWarmth: 0.45,
    pyroRadianceHue: 0.50,
    pyroRadianceChroma: 0.55,
    pyroDiagnosticPaint: 0.00,
    pyroCarrierView: 'normal',
    pyroOverdrive: 8.00,
    pressureMode: 'spatial-tiers',
    pressureTierOverlay: 0.00,
    pressureTierLowerMax: 0.74,
    pressureTierHeroMin: 0.00,
    pressureTierHeroMax: 0.55,
  },
  pyro_material_bonfire_family_0702: {
    volumeScene: 'tall_plume',
    density: 6.00,
    fire: 0.00,
    radiance: 3.00,
    absorption: 1.05,
    glow: 0.50,
    smoke: 2.15,
    curl: 4.00,
    microdetail: 2.50,
    interfaceShred: 5.00,
    fireLicks: 5.00,
    projection: 1.50,
    speed: 3.70,
    raySteps: 160,
    adaptiveRays: 0.05,
    occupancySkip: 0.05,
    majorantSkip: 0.95,
    majorantSmooth: 0.00,
    majorantGuard: 1.00,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 1.00,
    fireScale: 0.65,
    detailScale: 0.45,
    plumeHeight: 1.30,
    windStrength: 1.50,
    windAngle: -65,
    windHeight: -0.80,
    renderScale: 1.00,
    inputRadius: 0.13,
    flowRate: 0.30,
    resolution: 96,
    majorantGrid: 48,
    pyroDynamicDetail: 1,
    pyroMaterialGain: 0.65,
    pyroInterfaceFocus: 0.00,
    pyroEdgeBite: 0.55,
    pyroBiteBorder: 1.00,
    pyroBiteTeeth: 0.35,
    pyroBiteWake: 0.35,
    pyroBiteHeight: 0.60,
    pyroBiteFireLock: 1.00,
    pyroBiteCore: 0.15,
    pyroBiteCoreCut: 0.90,
    pyroBiteRim: 1.00,
    pyroBiteRimCut: 1.00,
    pyroBiteAfter: 1.00,
    pyroBiteAfterCut: 0.00,
    pyroFireMode: 'pyro-owned',
    pyroFlamePaint: 0.00,
    pyroStockMix: 1.00,
    pyroFlameLuma: 3.00,
    pyroFlameCoreColor: '#ff4d00',
    pyroFlameEdgeColor: '#ff4d00',
    pyroBiteHeat: 1.00,
    pyroBiteChroma: 0.65,
    pyroBiteLuma: 3.00,
    pyroBiteEmberColor: '#ff6600',
    pyroBiteHotColor: '#ff4000',
    pyroSmokeFold: 0.05,
    pyroFoldBorder: 0.00,
    pyroFoldWake: 0.00,
    pyroWakeLift: 0.00,
    pyroWakeWarmth: 0.00,
    pyroWakeLuma: 3.00,
    pyroWakeShadowColor: '#384c50',
    pyroWakeEmberColor: '#b06a2a',
    pyroRadiance: 4.30,
    pyroRadianceGate: 0.45,
    pyroRadianceSpill: 0.00,
    pyroRadianceWarmth: 1.00,
    pyroRadianceHue: 1.00,
    pyroRadianceChroma: 0.15,
    pyroRadianceLuma: 2.50,
    pyroRadianceCoolColor: '#ff6b6b',
    pyroRadianceWarmColor: '#ff0000',
    pyroRadianceSource: 'fire',
    pyroRadianceHeight: 1.00,
    pyroRadianceBorder: 0.70,
    pyroRadianceTeeth: 0.55,
    pyroRadianceRise: 1.00,
    pyroRadianceFireLock: 0.00,
    pyroDiagnosticPaint: 0.00,
    pyroCarrierView: 'normal',
    pyroOverdrive: 8.00,
    pressureMode: 'global-p3',
    pressureTierOverlay: 0.00,
    pressureTierLowerMax: 0.50,
    pressureTierHeroMin: 0.05,
    pressureTierHeroMax: 0.22,
    canonicalSpread: 1.00,
    canonicalCenterline: 1.00,
    canonicalBodyBalance: 0.00,
  },
  pyro_flow_small_bonfire_gamut_0707: {
    volumeScene: 'tall_plume',
    density: 6.00,
    fire: 0.00,
    radiance: 3.00,
    absorption: 2.00,
    glow: 2.50,
    smoke: 0.10,
    curl: 1.15,
    microdetail: 2.50,
    interfaceShred: 4.50,
    fireLicks: 5.00,
    projection: 1.50,
    speed: 3.95,
    raySteps: 160,
    adaptiveRays: 0.00,
    occupancySkip: 0.20,
    majorantSkip: 1.00,
    majorantSmooth: 1.00,
    majorantGuard: 1.00,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 1.00,
    fireScale: 0.35,
    detailScale: 0.45,
    plumeHeight: 1.00,
    windStrength: 0.00,
    windAngle: -65,
    windHeight: 0.20,
    renderScale: 0.55,
    inputRadius: 0.19,
    flowRate: 0.85,
    resolution: 160,
    majorantGrid: 48,
    pyroDynamicDetail: 1,
    pyroMaterialGain: 0.20,
    pyroInterfaceFocus: 0.00,
    pyroEdgeBite: 0.00,
    pyroBiteBorder: 0.00,
    pyroBiteTeeth: 0.00,
    pyroBiteWake: 0.00,
    pyroBiteHeight: 0.00,
    pyroBiteFireLock: 1.00,
    pyroBiteCore: 0.00,
    pyroBiteCoreCut: 1.00,
    pyroBiteRim: 0.00,
    pyroBiteRimCut: 1.00,
    pyroBiteAfter: 0.00,
    pyroBiteAfterCut: 1.00,
    pyroFireMode: 'pyro-owned',
    pyroFlamePaint: 0.00,
    pyroStockMix: 1.00,
    pyroFlameLuma: 0.95,
    pyroFlameCoreColor: '#ffae00',
    pyroFlameEdgeColor: '#ff4d00',
    pyroBiteHeat: 0.00,
    pyroBiteChroma: 0.00,
    pyroBiteLuma: 0.00,
    pyroBiteEmberColor: '#ff6600',
    pyroBiteHotColor: '#ff4000',
    pyroSmokeFold: 0.00,
    pyroFoldBorder: 0.00,
    pyroFoldWake: 0.00,
    pyroWakeLift: 0.00,
    pyroWakeWarmth: 0.00,
    pyroWakeLuma: 0.00,
    pyroWakeShadowColor: '#384c50',
    pyroWakeEmberColor: '#b06a2a',
    pyroFlowBite: 3.00,
    pyroFlowBorder: 1.00,
    pyroFlowTeeth: 0.00,
    pyroFlowRise: 1.00,
    pyroFlowFireLock: 1.00,
    pyroFlowLuma: 3.00,
    pyroFlowRadiance: 4.00,
    pyroFlowSpikes: 1.00,
    pyroFlowCoolColor: '#ff6400',
    pyroFlowHotColor: '#ff320f',
    pyroRadiance: 0.00,
    pyroRadianceGate: 0.15,
    pyroRadianceSpill: 0.00,
    pyroRadianceWarmth: 0.00,
    pyroRadianceHue: 0.00,
    pyroRadianceChroma: 1.00,
    pyroRadianceLuma: 3.00,
    pyroRadianceCoolColor: '#eb0000',
    pyroRadianceWarmColor: '#ffcd75',
    pyroRadianceSource: 'fire',
    pyroRadianceHeight: 0.00,
    pyroRadianceBorder: 0.00,
    pyroRadianceTeeth: 0.00,
    pyroRadianceRise: 0.00,
    pyroRadianceFireLock: 1.00,
    pyroDiagnosticPaint: 0.00,
    pyroCarrierView: 'normal',
    pyroOverdrive: 8.00,
    pressureMode: 'global-p3',
    pressureTierOverlay: 0.00,
    pressureTierLowerMax: 0.50,
    pressureTierHeroMin: 0.05,
    pressureTierHeroMax: 0.22,
    canonicalSpread: 1.00,
    canonicalCenterline: 1.00,
    canonicalBodyBalance: 0.00,
  },
  boundary_fire_bonfire_a_la_ruffles_0709: {
    volumeScene: 'tall_plume',
    pyroCompareMode: 'live',
    reactionLiveView: 'boundary_fire',
    reactionBoundaryGradient: 0.20,
    reactionBoundarySupportThermal: 0.86,
    reactionBoundarySupportReaction: 1.80,
    reactionBoundarySupportFront: 1.08,
    reactionBoundarySupportInterface: 0.24,
    reactionBoundaryCut: 0.00,
    reactionBoundarySoftness: 0.29,
    reactionBoundaryCoreReject: 1.00,
    reactionBoundaryTopology: 2.50,
    reactionBoundaryCurl: 2.00,
    reactionBoundaryDivergence: 1.00,
    reactionBoundaryContrast: 0.65,
    reactionBoundaryGamma: 2.65,
    reactionBoundaryOpacity: 3.00,
    reactionBoundaryFireRidge: 2.00,
    reactionBoundaryFireRidgeCut: 0.21,
    reactionBoundaryFireTip: 2.00,
    reactionBoundaryFireErosion: 0.12,
    reactionBoundaryFireCleanBlue: 0.14,
    reactionBoundaryFireSoot: 0.78,
    reactionBoundaryFireYellow: 0.22,
    reactionBoundaryFireWarmth: 0.68,
    reactionBoundaryFireLuma: 5.00,
    reactionHeatMin: 0.00,
    reactionFuelMax: 0.067,
    reactionFlameMin: 0.031,
    reactionFrontMax: 0.076,
    reactionShellGamma: 1.55,
    density: 4.65,
    fire: 3.50,
    radiance: 0.00,
    absorption: 0.00,
    glow: 0.00,
    curl: 1.40,
    microdetail: 0.85,
    interfaceShred: 3.10,
    fireLicks: 4.30,
    projection: 1.50,
    speed: 2.35,
    fireScale: 0.35,
    detailScale: 2.70,
    plumeHeight: 1.85,
    windStrength: 1.50,
    windAngle: -65,
    windHeight: -0.80,
    inputRadius: 0.08,
    flowRate: 0.45,
    raySteps: 160,
    adaptiveRays: 0.30,
    occupancySkip: 1.00,
    majorantSkip: 0.95,
    majorantSmooth: 1.00,
    majorantGuard: 1.00,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 1.00,
    renderScale: 0.50,
    resolution: 128,
    majorantGrid: 48,
    fireRenderMode: 'shell',
    shellInspectMode: 'shell',
    shellAmount: 0.00,
    shellWidth: 0.05,
    shellSoftClip: 0.20,
    shellSmoke: 2.00,
    pyroDynamicDetail: 1,
    pyroMaterialGain: 0.20,
    pyroInterfaceFocus: 0.00,
    pyroFireMode: 'pyro-owned',
    pyroFlameLuma: 0.95,
    pyroFlameCoreColor: '#ffae00',
    pyroFlameEdgeColor: '#ff4d00',
    pyroFlowBite: 3.00,
    pyroFlowBorder: 1.00,
    pyroFlowTeeth: 0.00,
    pyroFlowRise: 1.00,
    pyroFlowFireLock: 1.00,
    pyroFlowLuma: 3.00,
    pyroFlowRadiance: 4.00,
    pyroFlowSpikes: 1.00,
    pyroFlowCoolColor: '#ff6400',
    pyroFlowHotColor: '#ff320f',
    pyroRadianceGate: 0.15,
    pyroRadianceSpill: 0.00,
    pyroRadianceWarmth: 0.00,
    pyroRadianceHue: 0.00,
    pyroRadianceChroma: 1.00,
    pyroRadianceLuma: 3.00,
    pyroRadianceCoolColor: '#eb0000',
    pyroRadianceWarmColor: '#ffcd75',
    pyroRadianceSource: 'fire',
    pyroRadianceHeight: 0.00,
    pyroRadianceBorder: 0.00,
    pyroRadianceTeeth: 0.00,
    pyroRadianceRise: 0.00,
    pyroRadianceFireLock: 1.00,
    pyroEdgeBite: 0.00,
    pyroBiteBorder: 0.00,
    pyroBiteTeeth: 0.00,
    pyroBiteWake: 0.00,
    pyroBiteHeight: 0.00,
    pyroBiteFireLock: 1.00,
    pyroBiteCoreCut: 1.00,
    pyroBiteRimCut: 1.00,
    pyroBiteAfterCut: 1.00,
    pyroBiteHeat: 0.00,
    pyroBiteChroma: 0.00,
    pyroBiteLuma: 0.00,
    pyroBiteEmberColor: '#ff6600',
    pyroBiteHotColor: '#ff4000',
    pyroSmokeFold: 0.00,
    pyroFoldBorder: 0.00,
    pyroFoldWake: 0.00,
    pyroWakeLift: 0.00,
    pyroWakeWarmth: 0.00,
    pyroWakeLuma: 0.00,
    pyroCarrierView: 'normal',
    pyroOverdrive: 8.00,
    pressureMode: 'global-p3',
  },
  hostile_multiflame_pressure_force_0711: {
    extends: 'boundary_fire_bonfire_a_la_ruffles_0709',
    volumeScene: 'tall_plume',
    density: 6.00,
    fire: 3.50,
    radiance: 0.00,
    glow: 0.00,
    detailScale: 1.00,
    raySteps: 96,
    adaptiveRays: 0.65,
    majorantSkip: 0.00,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 0.00,
    renderScale: 0.35,
    resolution: 160,
    majorantGrid: 48,
    oracleActivityCurlNoise: 0.00,
    oracleActivityVorticity: 3.00,
    oracleActivityMaterial: 0.00,
    pressureMode: 'activity-tiers',
    activityPressureMaxTier: 4,
    activityPressureDispatchStrategy: 'coarse',
    activityPressureShadowOverhead: false,
    gpuTiming: true,
    activityVorticityGate: 0.00,
    activityDetailGate: 0.00,
    sourceCaptureHash: 'cae5b1e17bb7cccb',
  },
  exploding_jellow_fireball_motherfucker_0706: {
    volumeScene: 'tall_plume',
    density: 6.00,
    fire: 0.00,
    radiance: 3.00,
    absorption: 1.05,
    glow: 0.50,
    smoke: 2.15,
    curl: 4.00,
    microdetail: 2.50,
    interfaceShred: 5.00,
    fireLicks: 5.00,
    projection: 1.50,
    speed: 3.70,
    raySteps: 160,
    adaptiveRays: 0.05,
    occupancySkip: 0.05,
    majorantSkip: 0.95,
    majorantSmooth: 0.00,
    majorantGuard: 1.00,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 1.00,
    fireScale: 0.65,
    detailScale: 0.45,
    plumeHeight: 1.30,
    windStrength: 1.50,
    windAngle: -65,
    windHeight: -0.80,
    renderScale: 1.00,
    inputRadius: 0.13,
    flowRate: 0.30,
    resolution: 96,
    majorantGrid: 48,
    pyroDynamicDetail: 1,
    pyroMaterialGain: 1.50,
    pyroInterfaceFocus: 0.00,
    pyroEdgeBite: 0.55,
    pyroBiteBorder: 1.00,
    pyroBiteTeeth: 0.35,
    pyroBiteWake: 0.35,
    pyroBiteHeight: 0.60,
    pyroBiteFireLock: 1.00,
    pyroBiteCore: 0.15,
    pyroBiteCoreCut: 0.90,
    pyroBiteRim: 1.00,
    pyroBiteRimCut: 1.00,
    pyroBiteAfter: 1.00,
    pyroBiteAfterCut: 0.00,
    pyroFireMode: 'pyro-owned',
    pyroFlamePaint: 0.00,
    pyroStockMix: 1.00,
    pyroFlameLuma: 3.00,
    pyroFlameCoreColor: '#ff4d00',
    pyroFlameEdgeColor: '#ff4d00',
    pyroBiteHeat: 1.00,
    pyroBiteChroma: 0.65,
    pyroBiteLuma: 3.00,
    pyroBiteEmberColor: '#ff6600',
    pyroBiteHotColor: '#ff4000',
    pyroSmokeFold: 0.05,
    pyroFoldBorder: 0.00,
    pyroFoldWake: 0.00,
    pyroWakeLift: 0.00,
    pyroWakeWarmth: 0.00,
    pyroWakeLuma: 3.00,
    pyroWakeShadowColor: '#384c50',
    pyroWakeEmberColor: '#b06a2a',
    pyroRadiance: 4.30,
    pyroRadianceGate: 0.45,
    pyroRadianceSpill: 0.00,
    pyroRadianceWarmth: 1.00,
    pyroRadianceHue: 1.00,
    pyroRadianceChroma: 0.15,
    pyroRadianceLuma: 2.50,
    pyroRadianceCoolColor: '#ff6b6b',
    pyroRadianceWarmColor: '#ff0000',
    pyroRadianceSource: 'fire',
    pyroRadianceHeight: 1.00,
    pyroRadianceBorder: 0.70,
    pyroRadianceTeeth: 0.55,
    pyroRadianceRise: 1.00,
    pyroRadianceFireLock: 0.00,
    pyroDiagnosticPaint: 0.00,
    pyroCarrierView: 'normal',
    pyroOverdrive: 8.00,
    pressureMode: 'global-p3',
    pressureTierOverlay: 0.00,
    pressureTierLowerMax: 0.50,
    pressureTierHeroMin: 0.05,
    pressureTierHeroMax: 0.22,
    canonicalSpread: 1.00,
    canonicalCenterline: 1.00,
    canonicalBodyBalance: 0.00,
  },
};

function resolveTallPlumeOperatorPreset(name, seen = new Set()) {
  const preset = TALL_PLUME_OPERATOR_PRESETS[name];
  if (!preset || seen.has(name)) return preset || null;
  if (!preset.extends) return preset;
  seen.add(name);
  const parent = resolveTallPlumeOperatorPreset(preset.extends, seen) || {};
  const resolved = { ...parent, ...preset };
  delete resolved.extends;
  return resolved;
}

const DEFAULT_VOLUME_SMOKE_TALL_PRESET = 'boundary_fire_bonfire_a_la_ruffles_0709';
const CANONICAL_VOLUME_MACRO_PRESETS = {
  macro_foothold_0621: {
    density: 0.45,
    fire: 0.00,
    radiance: 0.00,
    glow: 0.00,
    smoke: 2.80,
    absorption: 2.00,
    curl: 1.00,
    microdetail: 0.00,
    interfaceShred: 0.00,
    fireLicks: 0.00,
    projection: 1.05,
    speed: 0.30,
    raySteps: 148,
    adaptiveRays: 0.05,
    occupancySkip: 0.25,
    majorantSkip: 0.15,
    majorantSmooth: 0.10,
    majorantGuard: 0.30,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 1.00,
    fireScale: 0.86,
    detailScale: 0.75,
    plumeHeight: 1.45,
    renderScale: 0.65,
    inputRadius: 0.08,
    flowRate: 1.90,
    resolution: 128,
    majorantGrid: 48,
    canonicalSpread: 0.00,
    canonicalCenterline: 0.50,
    canonicalBodyBalance: 1.50,
  },
  honest_smoke_0622: {
    density: 0.45,
    fire: 0.00,
    radiance: 0.00,
    glow: 0.00,
    smoke: 2.80,
    absorption: 2.00,
    curl: 1.00,
    microdetail: 0.00,
    interfaceShred: 0.00,
    fireLicks: 0.00,
    projection: 1.05,
    speed: 0.30,
    raySteps: 148,
    adaptiveRays: 0.05,
    occupancySkip: 0.25,
    majorantSkip: 0.15,
    majorantSmooth: 0.10,
    majorantGuard: 0.30,
    temporalAccum: 0.00,
    temporalJitter: 0.00,
    historyClamp: 1.00,
    fireScale: 0.86,
    detailScale: 0.75,
    plumeHeight: 1.45,
    renderScale: 0.65,
    inputRadius: 0.08,
    flowRate: 1.90,
    resolution: 128,
    majorantGrid: 48,
    canonicalSpread: 0.00,
    canonicalCenterline: 0.50,
    canonicalBodyBalance: 1.50,
    sourceMode: 'buoyant_bottom',
    renderMode: 'smoke_only',
    motionMode: 'frozen',
    contentMode: 'smoke',
  },
};
const CANONICAL_VOLUME_SOURCE_MODE_VALUES = {
  current: 0,
  passive_bottom: 1,
  forced_bottom: 2,
  buoyant_bottom: 3,
};
const CANONICAL_VOLUME_RENDER_MODE_VALUES = {
  default: 0,
  smoke_only: 1,
};
const CANONICAL_VOLUME_MOTION_MODE_VALUES = {
  animated: 0,
  frozen: 1,
};
const CANONICAL_VOLUME_CONTENT_MODE_VALUES = {
  smoke: 0,
  fire: 1,
  fire_smoke: 2,
};
function normalizeCanonicalSourceMode(value) {
  return Object.hasOwn(CANONICAL_VOLUME_SOURCE_MODE_VALUES, value) ? value : 'current';
}
function normalizeCanonicalRenderMode(value) {
  return Object.hasOwn(CANONICAL_VOLUME_RENDER_MODE_VALUES, value) ? value : 'default';
}
function normalizeCanonicalMotionMode(value) {
  return Object.hasOwn(CANONICAL_VOLUME_MOTION_MODE_VALUES, value) ? value : 'animated';
}
function normalizeCanonicalContentMode(value) {
  return Object.hasOwn(CANONICAL_VOLUME_CONTENT_MODE_VALUES, value) ? value : 'smoke';
}
function canonicalSourceDefaults(mode) {
  const normalized = normalizeCanonicalSourceMode(mode);
  if (normalized === 'passive_bottom') return { sourceY: -0.82, injection: 0.00, buoyancy: 0.00 };
  if (normalized === 'forced_bottom') return { sourceY: -0.82, injection: 1.00, buoyancy: 0.00 };
  if (normalized === 'buoyant_bottom') return { sourceY: -0.82, injection: 0.00, buoyancy: 1.00 };
  return { sourceY: -0.74, injection: 1.00, buoyancy: 1.00 };
}
const shouldApplyDefaultVolumeSmokeTallPreset =
  routeParams.get('kaminos_volume_smoke') === '1' &&
  (!routeParams.has('volume_scene') || routeParams.get('volume_scene') === 'tall_plume') &&
  !routeParams.has('volume_tall_preset') &&
  !routeParams.has('volume_canonical_preset');
const requestedTallPlumePreset = routeParams.get('volume_tall_preset') || (shouldApplyDefaultVolumeSmokeTallPreset ? DEFAULT_VOLUME_SMOKE_TALL_PRESET : '');
const expectedTallPlumePreset = Object.hasOwn(TALL_PLUME_OPERATOR_PRESETS, requestedTallPlumePreset)
  ? requestedTallPlumePreset
  : '';
const tallPlumePreset = resolveTallPlumeOperatorPreset(expectedTallPlumePreset) || {};
const requestedVolumeScene = routeParams.get('volume_scene') || tallPlumePreset.volumeScene || 'compact_plume';
const expectedVolumeScene = Object.hasOwn(VOLUME_SCENE_PRESETS, requestedVolumeScene)
  ? requestedVolumeScene
  : 'compact_plume';
const expectsCanonicalPlumeProof = expectedVolumeScene === 'canonical_plume';
const fieldSliceOut = args.has('--field-slice')
  ? resolve(args.get('--field-slice') || out.replace(/\.png$/i, '.field-slice.png'))
  : expectsCanonicalPlumeProof
    ? resolve(out.replace(/\.png$/i, '.field-slice.png'))
    : '';
const scenePreset = {
  ...(VOLUME_SCENE_PRESETS[expectedVolumeScene] || {}),
  ...(tallPlumePreset.volumeScene === expectedVolumeScene ? tallPlumePreset : {}),
};
const requestedCanonicalMacroPreset = routeParams.get('volume_canonical_preset') || '';
const expectedCanonicalMacroPreset = Object.hasOwn(CANONICAL_VOLUME_MACRO_PRESETS, requestedCanonicalMacroPreset)
  ? requestedCanonicalMacroPreset
  : '';
const canonicalMacroPreset = CANONICAL_VOLUME_MACRO_PRESETS[expectedCanonicalMacroPreset] || {};
const expectedCanonicalSourceMode = normalizeCanonicalSourceMode(routeParams.get('volume_canonical_source_mode') || canonicalMacroPreset.sourceMode || 'current');
const expectedCanonicalRenderMode = normalizeCanonicalRenderMode(routeParams.get('volume_canonical_render_mode') || canonicalMacroPreset.renderMode || 'default');
const expectedCanonicalMotionMode = normalizeCanonicalMotionMode(routeParams.get('volume_canonical_motion_mode') || canonicalMacroPreset.motionMode || 'animated');
const expectedCanonicalContentMode = normalizeCanonicalContentMode(routeParams.get('volume_canonical_content') || canonicalMacroPreset.contentMode || 'smoke');
const canonicalContentRequestsFire = expectedCanonicalContentMode === 'fire' || expectedCanonicalContentMode === 'fire_smoke';
const canonicalSourceDefault = canonicalSourceDefaults(expectedCanonicalSourceMode);
const requestedCanonicalSourceY = Number(routeParams.get('volume_canonical_source_y'));
const expectedCanonicalSourceY = routeParams.has('volume_canonical_source_y') && Number.isFinite(requestedCanonicalSourceY)
  ? Math.max(-0.92, Math.min(-0.20, requestedCanonicalSourceY))
  : canonicalSourceDefault.sourceY;
const requestedCanonicalInjection = Number(routeParams.get('volume_canonical_injection'));
const expectedCanonicalInjection = routeParams.has('volume_canonical_injection') && Number.isFinite(requestedCanonicalInjection)
  ? Math.max(0, Math.min(1.5, requestedCanonicalInjection))
  : canonicalSourceDefault.injection;
const requestedCanonicalBuoyancy = Number(routeParams.get('volume_canonical_buoyancy'));
const expectedCanonicalBuoyancy = routeParams.has('volume_canonical_buoyancy') && Number.isFinite(requestedCanonicalBuoyancy)
  ? Math.max(0, Math.min(1.5, requestedCanonicalBuoyancy))
  : canonicalSourceDefault.buoyancy;
const canonicalPassiveBottomNonRiseProof = expectsCanonicalPlumeProof && expectedCanonicalSourceMode === 'passive_bottom';
const expectsCanonicalSmokeRise = expectsCanonicalPlumeProof && !canonicalPassiveBottomNonRiseProof;
const requestedGrid = Number(routeParams.get('volume_resolution'));
const expectedGrid = [32, 48, 64, 96, 128, 160].includes(requestedGrid)
  ? requestedGrid
  : canonicalMacroPreset.resolution ?? scenePreset.resolution ?? 96;
const requestedMajorantGrid = Number(routeParams.get('volume_majorant_grid'));
const expectedMajorantGrid = [24, 32, 48].includes(requestedMajorantGrid)
  ? requestedMajorantGrid
  : canonicalMacroPreset.majorantGrid ?? scenePreset.majorantGrid ?? 48;
const requestedMajorantCadence = Number(routeParams.get('volume_majorant_cadence'));
let expectedMajorantCadence = routeParams.has('volume_majorant_cadence') && Number.isFinite(requestedMajorantCadence)
  ? Math.max(1, Math.min(8, Math.round(requestedMajorantCadence)))
  : 1;
const requestedPressureIterations = Number(routeParams.get('volume_pressure_iterations'));
const requestedPressureMode = routeParams.get('volume_pressure_mode');
const hasExplicitPressureRoute =
  routeParams.has('volume_pressure_mode') ||
  routeParams.has('volume_pressure_iterations') ||
  routeParams.has('volume_pressure_strategy');
let expectedPressureStrategy = normalizePressureStrategy(routeParams.get('volume_pressure_strategy') || scenePreset.pressureStrategy, expectedVolumeScene);
let expectedSpatialPressureTiers = ['spatial_tiers', 'activity_tiers'].includes(expectedPressureStrategy);
let expectedPressureIterations = expectedSpatialPressureTiers
  ? 3
  : routeParams.has('volume_pressure_iterations') && Number.isFinite(requestedPressureIterations)
    ? Math.max(0, Math.min(12, Math.round(requestedPressureIterations)))
    : defaultPressureIterationsForScene(expectedVolumeScene);
if (routeParams.has('volume_pressure_mode') || (!hasExplicitPressureRoute && scenePreset.pressureMode)) {
  const pressureModeConfig = pressureConfigForMode(requestedPressureMode || scenePreset.pressureMode, expectedVolumeScene, expectedPressureStrategy, expectedPressureIterations);
  expectedPressureStrategy = pressureModeConfig.pressureStrategy;
  expectedPressureIterations = pressureModeConfig.pressureIterations;
  expectedSpatialPressureTiers = ['spatial_tiers', 'activity_tiers'].includes(expectedPressureStrategy);
}
let expectedPressureProjectionIterations = expectedSpatialPressureTiers ? 3 : expectedPressureIterations;
let expectedTallPlumePressureStrategy = expectedSpatialPressureTiers
  ? TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE
  : expectedTallPlumePressureIterationStrategy(expectedVolumeScene, expectedPressureIterations);
let expectedTallPlumePressureTarget = expectedVolumeScene === 'tall_plume' && !expectedSpatialPressureTiers ? 2 : 0;
let expectedTallPlumePressureTierStrategyValue = expectedTallPlumePressureTierStrategy(expectedVolumeScene, expectedPressureStrategy);
let expectedPressureProjectionReadStrategy = expectedSpatialPressureTiers
  ? PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE
  : PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER;
const requestedSimProfile = (routeParams.get('volume_sim_profile') || '').toLowerCase();
const expectedSimProfile = requestedSimProfile === '1' || requestedSimProfile === 'true' || requestedSimProfile === 'yes' || requestedSimProfile === 'on';
const requestedGridOverlay = Number(routeParams.get('volume_grid'));
const expectedGridOverlay = Number.isFinite(requestedGridOverlay)
  ? Math.max(0, Math.min(1, requestedGridOverlay))
  : 0;
const RAY_BUDGET_PRESETS = {
  draft: { raySteps: 48, adaptiveRays: 0.80 },
  live: { raySteps: 72, adaptiveRays: 0.65 },
  rich: { raySteps: 96, adaptiveRays: 0.45 },
  hero: { raySteps: 144, adaptiveRays: 0.30 },
};
const rayBudgetPreset = routeParams.get('volume_ray_budget_preset') || '';
const presetBudget = RAY_BUDGET_PRESETS[rayBudgetPreset] || null;
const requestedRaySteps = Number(routeParams.get('volume_steps'));
let expectedRaySteps = routeParams.has('volume_steps') && Number.isFinite(requestedRaySteps)
  ? Math.max(24, Math.min(160, requestedRaySteps))
  : presetBudget?.raySteps ?? canonicalMacroPreset.raySteps ?? scenePreset.raySteps ?? 96;
const requestedAdaptiveRays = Number(routeParams.get('volume_adaptive_rays'));
let expectedAdaptiveRays = routeParams.has('volume_adaptive_rays') && Number.isFinite(requestedAdaptiveRays)
  ? Math.max(0, Math.min(1, requestedAdaptiveRays))
  : presetBudget?.adaptiveRays ?? canonicalMacroPreset.adaptiveRays ?? scenePreset.adaptiveRays ?? 0.65;
const expectedPrimitiveFixture = routeParams.get('volume_primitive_fixture');
const expectedLamellarHookFixture = ['lamellar_hook', 'lamellar_selected_hook'].includes(expectedPrimitiveFixture);
const expectedPrimitiveId = expectedLamellarHookFixture
  ? 'fixture-lamellar-hook-selected'
  : expectedPrimitiveFixture ? 'fixture-fire-smoke-sphere' : null;
const requestedOccupancySkip = Number(routeParams.get('volume_occupancy_skip'));
let expectedOccupancySkip = routeParams.has('volume_occupancy_skip') && Number.isFinite(requestedOccupancySkip)
  ? Math.max(0, Math.min(1, requestedOccupancySkip))
  : canonicalMacroPreset.occupancySkip ?? scenePreset.occupancySkip ?? 0.35;
const requestedMajorantSkip = Number(routeParams.get('volume_majorant_skip'));
let expectedMajorantSkip = routeParams.has('volume_majorant_skip') && Number.isFinite(requestedMajorantSkip)
  ? Math.max(0, Math.min(1, requestedMajorantSkip))
  : canonicalMacroPreset.majorantSkip ?? scenePreset.majorantSkip ?? 0.70;
const requestedMajorantSmooth = Number(routeParams.get('volume_majorant_smooth'));
const expectedMajorantSmooth = routeParams.has('volume_majorant_smooth') && Number.isFinite(requestedMajorantSmooth)
  ? Math.max(0, Math.min(1, requestedMajorantSmooth))
  : canonicalMacroPreset.majorantSmooth ?? scenePreset.majorantSmooth ?? 0.85;
const requestedMajorantGuard = Number(routeParams.get('volume_majorant_guard'));
const expectedMajorantGuard = routeParams.has('volume_majorant_guard') && Number.isFinite(requestedMajorantGuard)
  ? Math.max(0, Math.min(1, requestedMajorantGuard))
  : canonicalMacroPreset.majorantGuard ?? scenePreset.majorantGuard ?? 0.75;
const requestedMaxSmokeStripeRatio = Number(routeParams.get('volume_max_smoke_stripe_ratio'));
const expectedMaxSmokeStripeRatio = routeParams.has('volume_max_smoke_stripe_ratio') && Number.isFinite(requestedMaxSmokeStripeRatio)
  ? Math.max(1.0, Math.min(4.0, requestedMaxSmokeStripeRatio))
  : expectedVolumeScene === 'bonfire_plume'
    ? 1.45
    : Infinity;
const requestedTemporalAccum = Number(routeParams.get('volume_temporal_accum'));
let expectedTemporalAccum = routeParams.has('volume_temporal_accum') && Number.isFinite(requestedTemporalAccum)
  ? Math.max(0, Math.min(0.85, requestedTemporalAccum))
  : canonicalMacroPreset.temporalAccum ?? scenePreset.temporalAccum ?? 0.25;
const requestedTemporalJitter = Number(routeParams.get('volume_temporal_jitter'));
const expectedTemporalJitter = routeParams.has('volume_temporal_jitter') && Number.isFinite(requestedTemporalJitter)
  ? Math.max(0, Math.min(1, requestedTemporalJitter))
  : canonicalMacroPreset.temporalJitter ?? scenePreset.temporalJitter ?? 0.85;
const requestedHistoryClamp = Number(routeParams.get('volume_history_clamp'));
const expectedHistoryClamp = routeParams.has('volume_history_clamp') && Number.isFinite(requestedHistoryClamp)
  ? Math.max(0, Math.min(1, requestedHistoryClamp))
  : canonicalMacroPreset.historyClamp ?? scenePreset.historyClamp ?? 0.70;
const requestedDensity = Number(routeParams.get('volume_density'));
const expectedDensity = routeParams.has('volume_density') && Number.isFinite(requestedDensity)
  ? Math.max(0.35, Math.min(6, requestedDensity))
  : canonicalMacroPreset.density ?? scenePreset.density ?? 4.2;
const requestedFire = Number(routeParams.get('volume_fire'));
const expectedFire = routeParams.has('volume_fire') && Number.isFinite(requestedFire)
  ? Math.max(0, Math.min(3.5, requestedFire))
  : canonicalMacroPreset.fire ?? scenePreset.fire ?? 1.4;
const requestedSmoke = Number(routeParams.get('volume_smoke'));
const expectedSmoke = routeParams.has('volume_smoke') && Number.isFinite(requestedSmoke)
  ? Math.max(0.1, Math.min(2.8, requestedSmoke))
  : canonicalMacroPreset.smoke ?? scenePreset.smoke ?? 2.8;
const requestedFireScale = Number(routeParams.get('volume_fire_scale'));
const expectedFireScale = routeParams.has('volume_fire_scale') && Number.isFinite(requestedFireScale)
  ? Math.max(0.35, Math.min(1.3, requestedFireScale))
  : scenePreset.fireScale ?? 0.86;
const requestedDetailScale = Number(routeParams.get('volume_detail_scale'));
const expectedDetailScale = routeParams.has('volume_detail_scale') && Number.isFinite(requestedDetailScale)
  ? Math.max(0.45, Math.min(3.2, requestedDetailScale))
  : scenePreset.detailScale ?? 1.75;
const requestedPlumeHeight = Number(routeParams.get('volume_plume_height'));
const expectedPlumeHeight = routeParams.has('volume_plume_height') && Number.isFinite(requestedPlumeHeight)
  ? Math.max(0.7, Math.min(2.2, requestedPlumeHeight))
  : canonicalMacroPreset.plumeHeight ?? scenePreset.plumeHeight ?? 1.45;
const requestedCurl = Number(routeParams.get('volume_curl'));
const expectedCurl = routeParams.has('volume_curl') && Number.isFinite(requestedCurl)
  ? Math.max(0, Math.min(5, requestedCurl))
  : canonicalMacroPreset.curl ?? scenePreset.curl ?? 2.65;
const requestedSpeed = Number(routeParams.get('volume_speed'));
const expectedSpeed = routeParams.has('volume_speed') && Number.isFinite(requestedSpeed)
  ? Math.max(0.1, Math.min(5, requestedSpeed))
  : canonicalMacroPreset.speed ?? scenePreset.speed ?? 5.00;
const requestedMicrodetail = Number(routeParams.get('volume_microdetail'));
const expectedMicrodetail = routeParams.has('volume_microdetail') && Number.isFinite(requestedMicrodetail)
  ? Math.max(0, Math.min(2.5, requestedMicrodetail))
  : scenePreset.microdetail ?? 2.50;
const requestedInterfaceShred = Number(routeParams.get('volume_interface_shred'));
const expectedInterfaceShred = routeParams.has('volume_interface_shred') && Number.isFinite(requestedInterfaceShred)
  ? Math.max(0, Math.min(5, requestedInterfaceShred))
  : scenePreset.interfaceShred ?? 2.50;
const requestedFireLicks = Number(routeParams.get('volume_fire_licks'));
const expectedFireLicks = routeParams.has('volume_fire_licks') && Number.isFinite(requestedFireLicks)
  ? Math.max(0, Math.min(5, requestedFireLicks))
  : scenePreset.fireLicks ?? 1.65;
const requestedWindStrength = Number(routeParams.get('volume_wind_strength'));
const expectedWindStrength = routeParams.has('volume_wind_strength') && Number.isFinite(requestedWindStrength)
  ? Math.max(0, Math.min(1.5, requestedWindStrength))
  : scenePreset.windStrength ?? 0;
const requestedWindAngle = Number(routeParams.get('volume_wind_angle'));
const expectedWindAngle = routeParams.has('volume_wind_angle') && Number.isFinite(requestedWindAngle)
  ? Math.max(-180, Math.min(180, requestedWindAngle))
  : scenePreset.windAngle ?? 0;
const requestedWindHeight = Number(routeParams.get('volume_wind_height'));
const expectedWindHeight = routeParams.has('volume_wind_height') && Number.isFinite(requestedWindHeight)
  ? Math.max(-0.8, Math.min(0.8, requestedWindHeight))
  : scenePreset.windHeight ?? 0.15;
const requestedWindDrift = routeParams.get('volume_expected_wind_drift') || '';
const expectedWindDrift = ['left', 'right', 'none'].includes(requestedWindDrift) ? requestedWindDrift : '';
const requestedRenderScale = Number(routeParams.get('volume_render_scale'));
let expectedRenderScale = routeParams.has('volume_render_scale') && Number.isFinite(requestedRenderScale)
  ? Math.max(0.1, Math.min(1, requestedRenderScale))
  : canonicalMacroPreset.renderScale ?? scenePreset.renderScale ?? 0.85;
const requestedInputRadius = Number(routeParams.get('volume_input_radius'));
const expectedInputRadius = routeParams.has('volume_input_radius') && Number.isFinite(requestedInputRadius)
  ? Math.max(0.08, Math.min(0.7, requestedInputRadius))
  : canonicalMacroPreset.inputRadius ?? scenePreset.inputRadius ?? null;
const requestedFlowRate = Number(routeParams.get('volume_flow_rate'));
const expectedFlowRate = routeParams.has('volume_flow_rate') && Number.isFinite(requestedFlowRate)
  ? Math.max(0, Math.min(2.5, requestedFlowRate))
  : canonicalMacroPreset.flowRate ?? scenePreset.flowRate ?? null;
const requestedReactionFuelScale = Number(routeParams.get('volume_reaction_fuel'));
const expectedReactionFuelScale = routeParams.has('volume_reaction_fuel') && Number.isFinite(requestedReactionFuelScale)
  ? Math.max(0, Math.min(1.5, requestedReactionFuelScale))
  : 1;
const expectedLifecycleEffect = normalizeLifecycleEffect(routeParams.get('volume_lifecycle_effect'));
const requestedLifecycleT = Number(routeParams.get('volume_lifecycle_t'));
const expectedLifecycleT = routeParams.has('volume_lifecycle_t') && Number.isFinite(requestedLifecycleT)
  ? Math.max(0, Math.min(1, requestedLifecycleT))
  : 0;
const requestedQuenchVapor = Number(routeParams.get('volume_quench_vapor'));
const expectedQuenchVapor = routeParams.has('volume_quench_vapor') && Number.isFinite(requestedQuenchVapor)
  ? Math.max(0, Math.min(2, requestedQuenchVapor))
  : 0;
const expectedQuenchEnvelope = expectedLifecycleT * expectedLifecycleT * (3 - 2 * expectedLifecycleT);
const expectedQuenchVaporStrength = expectedLifecycleEffect === 'snuff'
  ? expectedQuenchVapor * expectedQuenchEnvelope
  : 0;
const expectedFlameQuenchModel = expectedQuenchVaporStrength > 0 ? 'quench-flame-body-v0' : 'inactive';
const expectsSnuffVisualEvidence = expectedLifecycleEffect === 'snuff' && expectedQuenchVaporStrength > 0;
const expectsFuelStarvedTallPlume = expectedVolumeScene === 'tall_plume' && expectedReactionFuelScale <= 0.001;
function expectedBonfireAblationParam(name, fallback = 1, max = 1.5) {
  const requested = Number(routeParams.get(name));
  return routeParams.has(name) && Number.isFinite(requested)
    ? Math.max(0, Math.min(max, requested))
    : fallback;
}
const expectedBonfireRecenter = expectedBonfireAblationParam('volume_bonfire_recenter');
const expectedBonfireLateralDamping = expectedBonfireAblationParam('volume_bonfire_lateral_damping');
const expectedBonfireShear = expectedBonfireAblationParam('volume_bonfire_shear');
const expectedBonfireDetailForces = expectedBonfireAblationParam('volume_bonfire_detail_forces');
const expectedBonfireDepinch = expectedBonfireAblationParam('volume_bonfire_depinch');
const expectedBonfireProjection = expectedBonfireAblationParam('volume_bonfire_projection');
const expectedBonfireTemporal = expectedBonfireAblationParam('volume_bonfire_temporal');
const expectedBonfireInstabilityProbe = expectedBonfireAblationParam('volume_bonfire_instability_probe', 0, 1);
const expectedRuntimeQualityRequested = normalizeRuntimeQuality(routeParams.get('volume_runtime_quality'));
const requestedGpuPressure = Number(routeParams.get('volume_gpu_pressure'));
const expectedGpuPressure = routeParams.has('volume_gpu_pressure') && Number.isFinite(requestedGpuPressure)
  ? Math.max(0, Math.min(1, requestedGpuPressure))
  : 0;
const expectedRuntimeQualityReason = String(routeParams.get('volume_quality_reason') || 'route-default').slice(0, 96) || 'route-default';
const expectedRuntimeQualityEffective = runtimeQualityFromPressure(expectedRuntimeQualityRequested, expectedGpuPressure);
if (expectedRuntimeQualityEffective === 'live_low') {
  expectedRenderScale = Math.min(expectedRenderScale, 0.75);
  expectedRaySteps = Math.min(expectedRaySteps, 96);
  expectedAdaptiveRays = Math.max(expectedAdaptiveRays, 0.45);
  expectedMajorantCadence = Math.max(expectedMajorantCadence, 2);
} else if (expectedRuntimeQualityEffective === 'holdover') {
  expectedRenderScale = Math.min(expectedRenderScale, 0.70);
  expectedRaySteps = Math.min(expectedRaySteps, 72);
  expectedAdaptiveRays = Math.max(expectedAdaptiveRays, 0.65);
  expectedOccupancySkip = Math.max(expectedOccupancySkip, 0.25);
  expectedMajorantSkip = Math.max(expectedMajorantSkip, 0.35);
  expectedMajorantCadence = Math.max(expectedMajorantCadence, 4);
  expectedTemporalAccum = Math.max(expectedTemporalAccum, 0.42);
  expectedPressureStrategy = 'global';
  expectedPressureIterations = Math.min(1, expectedPressureIterations);
} else if (expectedRuntimeQualityEffective === 'impostor') {
  expectedRenderScale = Math.min(expectedRenderScale, 0.60);
  expectedRaySteps = Math.min(expectedRaySteps, 48);
  expectedAdaptiveRays = Math.max(expectedAdaptiveRays, 0.85);
  expectedOccupancySkip = Math.max(expectedOccupancySkip, 0.45);
  expectedMajorantSkip = Math.max(expectedMajorantSkip, 0.55);
  expectedMajorantCadence = Math.max(expectedMajorantCadence, 8);
  expectedTemporalAccum = Math.max(expectedTemporalAccum, 0.65);
  expectedPressureStrategy = 'global';
  expectedPressureIterations = 0;
}
expectedSpatialPressureTiers = ['spatial_tiers', 'activity_tiers'].includes(expectedPressureStrategy);
expectedPressureProjectionIterations = expectedSpatialPressureTiers ? 3 : expectedPressureIterations;
expectedTallPlumePressureStrategy = expectedSpatialPressureTiers
  ? TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE
  : expectedTallPlumePressureIterationStrategy(expectedVolumeScene, expectedPressureIterations);
expectedTallPlumePressureTarget = expectedVolumeScene === 'tall_plume' && !expectedSpatialPressureTiers ? 2 : 0;
expectedTallPlumePressureTierStrategyValue = expectedTallPlumePressureTierStrategy(expectedVolumeScene, expectedPressureStrategy);
expectedPressureProjectionReadStrategy = expectedSpatialPressureTiers
  ? PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE
  : PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER;
const expectedEffectiveTemporalAccum = expectedVolumeScene === 'bonfire_plume'
  ? Math.max(0, Math.min(0.85, expectedTemporalAccum * expectedBonfireTemporal))
  : expectedTemporalAccum;
const expectedDetailScaleArtifactQuarantine = expectedVolumeScene === 'tall_plume' ? 1 : 0;
const expectedVisibleDetailOverlayGain = expectedDetailScaleArtifactQuarantine ? 0.35 : 1;
const expectedExternalEmitterMode = routeParams.get('volume_external_emitters') || '';

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8, 'only 8-bit PNG screenshots are supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = zlibInflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let p = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    rows.push(row);
    prev = row;
  }
  return { width, height, channels, rows };
}

function measureScreenshot(buffer) {
  const png = parsePngRgba(buffer);
  let lit = 0;
  let fireLike = 0;
  let smokeLike = 0;
  let totalLum = 0;
  let samples = 0;
  for (let y = Math.floor(png.height * 0.08); y < Math.floor(png.height * 0.92); y += 2) {
    const row = png.rows[y];
    for (let x = Math.floor(png.width * 0.08); x < Math.floor(png.width * 0.92); x += 2) {
      const i = x * png.channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLum += lum;
      samples++;
      if (lum > 20) lit++;
      if (r > 120 && g > 70 && b < 80) fireLike++;
      if (b > 28 && g > 28 && r < 95 && Math.abs(g - b) < 55) smokeLike++;
    }
  }
  return {
    width: png.width,
    height: png.height,
    meanLuma: totalLum / Math.max(1, samples),
    litPixels: lit,
    fireLikePixels: fireLike,
    smokeLikePixels: smokeLike,
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function writeRgbaPng(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

async function captureViewportScreenshot(ws, path) {
  if (!path) return '';
  mkdirSync(dirname(path), { recursive: true });
  const shot = await wsRequest(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  return path;
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });

  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });

  let phase = 'launch';
  try {
    await waitForCdp();
    phase = 'target';
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);
    if (expectedExternalEmitterMode === 'synthetic_hand_trails') {
      await wsRequest(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const prototype = window.__kaminosVolumePrototype;
          const timestampMs = performance.now();
          return prototype?.setExternalEmitters?.({
            mode: 'synthetic_hand_trails',
            frameId: prototype.debugState().frameCount,
            timestampMs,
            coordinateSpace: 'volume-local',
            emitters: prototype.syntheticHandTrailEmitters(timestampMs),
          });
        })()`,
        returnByValue: true,
      });
      await delay(750);
    }
    phase = 'identity';
    let state = null;
    for (let i = 0; i < 80; i++) {
      const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'window.__kaminosVolumePrototype?.debugState?.()',
        returnByValue: true,
      });
      state = stateEval.result.value;
      if (state?.frameCount > 8) break;
      await delay(250);
    }
    assert.ok(state, 'missing volume debug state');
    assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'wrong effective route');
    assert.equal(state.prototypeIdentity, 'kaminos-volume-prototype-v0', 'wrong prototype identity');
    assert.equal(state.active, true, 'volume route is not active');
    const bridgeEval = await wsRequest(ws, 'Runtime.evaluate', {
      expression: 'window.__kaminosVolumeBridge?.debugState?.()',
      returnByValue: true,
    });
    const bridge = bridgeEval.result.value;
    assert.equal(bridge?.identity, 'volume-main-renderer-bridge-v0', 'wrong volume main-renderer bridge identity');
    assert.equal(bridge?.textureSource, 'kaminos-volume-canvas', 'volume bridge is not sourcing the native volume canvas');
    assert.ok(
      state.frameCount > 5,
      `volume route did not render enough frames (${state.frameCount || 0} frames at ${state.displayWidth || 0}x${state.displayHeight || 0})`,
    );
    assert.equal(state.volumeScene, expectedVolumeScene, 'volume scene route/control did not apply');
    assert.equal(state.controls?.volumeScene, expectedVolumeScene, 'volume scene debug controls did not preserve route identity');
    assert.equal(state.simGrid, expectedGrid, `fluid sim is not running on the expected ${expectedGrid}^3 grid`);
    assert.equal(state.simGridLabel, `${expectedGrid}^3 velocity-material-fire-microdetail-storage-buffer+combustion-front-topology-sidecar-v0`, 'fluid sim label does not expose selected grid plus front sidecar identity');
    assert.equal(state.frontFieldIdentity, 'combustion-front-topology-sidecar-v0', 'front topology sidecar identity did not reach debug state');
    assert.equal(state.frontFieldBytes, expectedGrid * expectedGrid * expectedGrid * 4, 'front topology sidecar byte cost does not match one scalar per cell');
    assert.ok(Math.abs((state.controls?.gridOverlay || 0) - expectedGridOverlay) < 0.001, 'fluid grid overlay did not apply route/debug state');
    assert.ok(Math.abs((state.controls?.raySteps ?? 0) - expectedRaySteps) < 0.001, 'ray-step route/control did not apply');
    assert.ok(Math.abs((state.controls?.adaptiveRays ?? 0) - expectedAdaptiveRays) < 0.001, 'adaptive raymarch route/control did not apply');
    if (rayBudgetPreset && !routeParams.has('volume_steps') && !routeParams.has('volume_adaptive_rays')) {
      assert.equal(state.controls?.rayBudgetPreset, rayBudgetPreset, 'ray-budget preset route identity was not preserved in debug controls');
    }
    assert.ok(Math.abs((state.adaptiveRaymarch ?? 0) - expectedAdaptiveRays) < 0.001, 'effective adaptive raymarch state did not match route/control');
    if (expectedPrimitiveFixture) {
      assert.ok(state.volumePrimitiveCount > 0, 'volume primitive fixture was not consumed by the renderer');
      assert.ok(state.volumePrimitiveIds?.includes(expectedPrimitiveId), `volume primitive ids did not include ${expectedPrimitiveId}`);
    }
    assertNoPlaceholderTopologyClaim(state.volumePrimitives);
    if (expectedLamellarHookFixture) {
      const primitive = state.volumePrimitives?.find(item => item.id === expectedPrimitiveId);
      assert.equal(primitive?.couplingSource, 'lamellar', 'Lamellar hook primitive did not preserve coupling source');
      assert.equal(primitive?.targetHookId, 'lamellar-0-0-selected', 'Lamellar hook primitive did not preserve target hook id');
      assert.equal(primitive?.placeholderContract, 'temporary-aesthetic-composition-primitive-not-final-lamellar-topology', 'Lamellar hook primitive did not preserve placeholder topology contract');
      assert.equal(primitive?.coupling?.witnessIdentity, 'kaminos-lamellar-witness-v0', 'Lamellar hook primitive did not preserve witness identity');
      assert.ok(Number.isFinite(primitive?.lamellarHook?.emissiveCatch), 'Lamellar hook primitive did not preserve scalar hook hints');
    }
    assert.ok(Math.abs((state.controls?.occupancySkip ?? 0) - expectedOccupancySkip) < 0.001, 'occupancy skip route/control did not apply');
    assert.ok(Math.abs((state.occupancySkip ?? 0) - expectedOccupancySkip) < 0.001, 'effective occupancy skip state did not match route/control');
    assert.ok(Math.abs((state.controls?.majorantSkip ?? 0) - expectedMajorantSkip) < 0.001, 'majorant skip route/control did not apply');
    assert.ok(Math.abs((state.majorantSkip ?? 0) - expectedMajorantSkip) < 0.001, 'effective majorant skip state did not match route/control');
    assert.ok(Math.abs((state.controls?.majorantSmooth ?? 0) - expectedMajorantSmooth) < 0.001, 'majorant smooth route/control did not apply');
    assert.ok(Math.abs((state.majorantSmooth ?? 0) - expectedMajorantSmooth) < 0.001, 'effective majorant smooth state did not match route/control');
    assert.ok(Math.abs((state.controls?.majorantGuard ?? 0) - expectedMajorantGuard) < 0.001, 'majorant guard route/control did not apply');
    assert.ok(Math.abs((state.majorantGuard ?? 0) - expectedMajorantGuard) < 0.001, 'effective majorant guard state did not match route/control');
    assert.ok(Math.abs((state.controls?.temporalAccum ?? 0) - expectedTemporalAccum) < 0.001, 'temporal accumulation route/control did not apply');
    assert.ok(Math.abs((state.temporalAccum ?? 0) - expectedEffectiveTemporalAccum) < 0.001, 'effective temporal accumulation state did not match route/control');
    assert.ok(Math.abs((state.controls?.temporalJitter ?? 0) - expectedTemporalJitter) < 0.001, 'temporal jitter route/control did not apply');
    assert.ok(Math.abs((state.temporalJitter ?? 0) - expectedTemporalJitter) < 0.001, 'effective temporal jitter state did not match route/control');
    assert.ok(Math.abs((state.controls?.historyClamp ?? 0) - expectedHistoryClamp) < 0.001, 'temporal history clamp route/control did not apply');
    assert.ok(Math.abs((state.historyClamp ?? 0) - expectedHistoryClamp) < 0.001, 'effective temporal history clamp state did not match route/control');
    assert.ok(Math.abs((state.controls?.density ?? 0) - expectedDensity) < 0.001, 'density route/control did not apply');
    assert.ok(Math.abs((state.controls?.fire ?? 0) - expectedFire) < 0.001, 'fire route/control did not apply');
    assert.ok(Math.abs((state.controls?.smoke ?? 0) - expectedSmoke) < 0.001, 'smoke route/control did not apply');
    assert.ok(Math.abs((state.controls?.fireScale ?? 0) - expectedFireScale) < 0.001, 'fire scale route/control did not apply');
    assert.ok(Math.abs((state.fireScale ?? 0) - expectedFireScale) < 0.001, 'effective fire scale state did not match route/control');
    assert.ok(Math.abs((state.controls?.detailScale ?? 0) - expectedDetailScale) < 0.001, 'detail scale route/control did not apply');
    assert.ok(Math.abs((state.detailScale ?? 0) - expectedDetailScale) < 0.001, 'effective detail scale state did not match route/control');
    assert.ok(Math.abs((state.detailScaleArtifactQuarantine ?? 0) - expectedDetailScaleArtifactQuarantine) < 0.001, 'detail-scale artifact quarantine state did not match volume scene');
    assert.ok(Math.abs((state.visibleDetailOverlayGain ?? 0) - expectedVisibleDetailOverlayGain) < 0.001, 'visible detail overlay gain did not match detail quarantine policy');
    if (expectedVolumeScene === 'tall_plume') {
      assert.equal(state.tallPlumeDetailFrequencySource, 'fire-scale-decoupled-v0', 'tall-plume detail frequency was not decoupled from Fire Scale');
      assert.equal(state.tallPlumeFlameCutoffContract, 'tall-plume-speed-cutoff-decoupled-v0', 'tall-plume flame cutoff/speed contract was not active');
      assert.equal(state.tallPlumeFlowShelfContract, 'tall-plume-flow-shelf-mitigated-v0', 'tall-plume flow-rate shelf mitigation contract was not active');
      assert.equal(state.tallPlumeFlameHeightLawContract, 'tall-plume-flame-height-law-v2', 'tall-plume reaction/fuel flame-height law contract was not active');
    }
    assert.ok(Math.abs((state.controls?.plumeHeight ?? 0) - expectedPlumeHeight) < 0.001, 'plume height route/control did not apply');
    assert.ok(Math.abs((state.plumeHeight ?? 0) - expectedPlumeHeight) < 0.001, 'effective plume height state did not match route/control');
    assert.ok(Math.abs((state.controls?.curl ?? 0) - expectedCurl) < 0.001, 'curl route/control did not apply');
    assert.ok(Math.abs((state.controls?.speed ?? 0) - expectedSpeed) < 0.001, 'speed route/control did not apply');
    assert.ok(Math.abs((state.controls?.microdetail ?? 0) - expectedMicrodetail) < 0.001, 'microdetail route/control did not apply');
    assert.ok(Math.abs((state.controls?.interfaceShred ?? 0) - expectedInterfaceShred) < 0.001, 'interface shred route/control did not apply');
    assert.ok(Math.abs((state.controls?.fireLicks ?? 0) - expectedFireLicks) < 0.001, 'fire licks route/control did not apply');
    assert.ok(Math.abs((state.controls?.reactionFuelScale ?? 0) - expectedReactionFuelScale) < 0.001, 'reaction fuel route/control did not apply');
    assert.ok(Math.abs((state.reactionFuelScale ?? 0) - expectedReactionFuelScale) < 0.001, 'effective reaction fuel scale did not reach debug state');
    assert.equal(state.controls?.lifecycleEffect ?? 'none', expectedLifecycleEffect, 'lifecycle effect route/control did not apply');
    assert.equal(state.lifecycleEffect ?? 'none', expectedLifecycleEffect, 'effective lifecycle effect did not reach debug state');
    assert.ok(Math.abs((state.controls?.lifecycleT ?? 0) - expectedLifecycleT) < 0.001, 'lifecycle phase route/control did not apply');
    assert.ok(Math.abs((state.lifecycleT ?? 0) - expectedLifecycleT) < 0.001, 'effective lifecycle phase did not reach debug state');
    assert.ok(Math.abs((state.controls?.quenchVapor ?? 0) - expectedQuenchVapor) < 0.001, 'quench vapor route/control did not apply');
    assert.ok(Math.abs((state.quenchVapor ?? 0) - expectedQuenchVapor) < 0.001, 'effective quench vapor did not reach debug state');
    assert.ok(Math.abs((state.quenchVaporStrength ?? 0) - expectedQuenchVaporStrength) < 0.001, 'effective quench-vapor strength did not match route phase');
    assert.equal(state.snuffVisualModel ?? 'inactive', expectedQuenchVaporStrength > 0 ? 'quench-vapor-v0' : 'inactive', 'snuff visual model identity did not match effective quench-vapor state');
    assert.equal(state.flameQuenchModel ?? 'inactive', expectedFlameQuenchModel, 'flame body quench model identity did not match effective snuff state');
    assert.equal(state.controls?.runtimeQualityRequested ?? 'live_high', expectedRuntimeQualityRequested, 'runtime quality request route/control did not apply');
    assert.equal(state.runtimeQualityRequested ?? 'live_high', expectedRuntimeQualityRequested, 'runtime quality request did not reach debug state');
    assert.equal(state.controls?.runtimeQualityEffective ?? 'live_high', expectedRuntimeQualityEffective, 'effective runtime quality control did not match pressure ladder');
    assert.equal(state.runtimeQualityEffective ?? 'live_high', expectedRuntimeQualityEffective, 'effective runtime quality did not reach debug state');
    assert.equal(state.runtimeQualityReceipt?.identity, 'volume-runtime-quality-ladder-v0', 'runtime quality receipt identity did not reach debug state');
    assert.equal(state.runtimeQualityReceipt?.requested, expectedRuntimeQualityRequested, 'runtime quality receipt requested mode did not match route');
    assert.equal(state.runtimeQualityReceipt?.effective, expectedRuntimeQualityEffective, 'runtime quality receipt effective mode did not match ladder');
    assert.ok(Math.abs((state.gpuPressure ?? 0) - expectedGpuPressure) < 0.001, 'GPU pressure route/control did not apply');
    assert.ok(Math.abs((state.controls?.windStrength ?? 0) - expectedWindStrength) < 0.001, 'wind strength route/control did not apply');
    assert.ok(Math.abs((state.windStrength ?? 0) - expectedWindStrength) < 0.001, 'effective wind strength state did not match route/control');
    assert.ok(Math.abs((state.controls?.windAngle ?? 0) - expectedWindAngle) < 0.001, 'wind direction route/control did not apply');
    assert.ok(Math.abs((state.windAngle ?? 0) - expectedWindAngle) < 0.001, 'effective wind direction state did not match route/control');
    assert.ok(Math.abs((state.controls?.windHeight ?? 0) - expectedWindHeight) < 0.001, 'wind height/ramp route/control did not apply');
    assert.ok(Math.abs((state.windHeight ?? 0) - expectedWindHeight) < 0.001, 'effective wind height/ramp state did not match route/control');
    assert.ok(Math.abs((state.controls?.bonfireRecenter ?? 0) - expectedBonfireRecenter) < 0.001, 'bonfire recenter ablation route/control did not apply');
    assert.ok(Math.abs((state.bonfireAblation?.recenter ?? 0) - expectedBonfireRecenter) < 0.001, 'effective bonfire recenter ablation did not match route/control');
    assert.ok(Math.abs((state.controls?.bonfireLateralDamping ?? 0) - expectedBonfireLateralDamping) < 0.001, 'bonfire lateral damping ablation route/control did not apply');
    assert.ok(Math.abs((state.bonfireAblation?.lateralDamping ?? 0) - expectedBonfireLateralDamping) < 0.001, 'effective bonfire lateral damping ablation did not match route/control');
    assert.ok(Math.abs((state.controls?.bonfireShear ?? 0) - expectedBonfireShear) < 0.001, 'bonfire shear ablation route/control did not apply');
    assert.ok(Math.abs((state.bonfireAblation?.shear ?? 0) - expectedBonfireShear) < 0.001, 'effective bonfire shear ablation did not match route/control');
    assert.ok(Math.abs((state.controls?.bonfireDetailForces ?? 0) - expectedBonfireDetailForces) < 0.001, 'bonfire detail-force ablation route/control did not apply');
    assert.ok(Math.abs((state.bonfireAblation?.detailForces ?? 0) - expectedBonfireDetailForces) < 0.001, 'effective bonfire detail-force ablation did not match route/control');
    assert.ok(Math.abs((state.controls?.bonfireDepinch ?? 0) - expectedBonfireDepinch) < 0.001, 'bonfire depinch ablation route/control did not apply');
    assert.ok(Math.abs((state.bonfireAblation?.depinch ?? 0) - expectedBonfireDepinch) < 0.001, 'effective bonfire depinch ablation did not match route/control');
    assert.ok(Math.abs((state.controls?.bonfireProjection ?? 0) - expectedBonfireProjection) < 0.001, 'bonfire projection ablation route/control did not apply');
    assert.ok(Math.abs((state.bonfireAblation?.projection ?? 0) - expectedBonfireProjection) < 0.001, 'effective bonfire projection ablation did not match route/control');
    assert.ok(Math.abs((state.controls?.bonfireTemporal ?? 0) - expectedBonfireTemporal) < 0.001, 'bonfire temporal ablation route/control did not apply');
    assert.ok(Math.abs((state.bonfireAblation?.temporal ?? 0) - expectedBonfireTemporal) < 0.001, 'effective bonfire temporal ablation did not match route/control');
    assert.ok(Math.abs((state.controls?.bonfireInstabilityProbe ?? 0) - expectedBonfireInstabilityProbe) < 0.001, 'bonfire instability probe route/control did not apply');
    assert.ok(Math.abs((state.bonfireAblation?.instabilityProbe ?? 0) - expectedBonfireInstabilityProbe) < 0.001, 'effective bonfire instability probe did not match route/control');
    assert.equal(state.bonfireReferenceConfinement?.identity, 'bonfire-reference-front-gradient-confinement-v0', 'bonfire reference-confinement identity did not reach debug state');
    if (expectedVolumeScene === 'bonfire_plume') {
      assert.equal(state.bonfireReferenceConfinement?.enabled, true, 'bonfire reference-confinement route was not enabled for bonfire plume');
      assert.equal(state.bonfireReferenceConfinement?.storage, 'four-slot-existing-fluid-state', 'bonfire reference-confinement did not preserve four-slot storage identity');
    }
    assert.equal(state.minimalPlumeProof?.identity, 'minimal-canonical-plume-proof-v0', 'minimal plume proof identity did not reach debug state');
    if (expectsCanonicalPlumeProof) {
      assert.equal(state.minimalPlumeProof?.enabled, true, 'canonical plume route did not enable the minimal plume proof branch');
      assert.match(state.minimalPlumeProof?.excluded || '', /bonfire-front-topology/, 'canonical plume proof did not declare bonfire complexity exclusion');
    }
    assert.equal(state.controls?.canonicalMacroPreset || '', expectedCanonicalMacroPreset, 'canonical macro preset route identity did not apply');
    assert.equal(state.canonicalPlumeControls?.macroPreset || '', expectedCanonicalMacroPreset, 'effective canonical macro preset did not reach debug state');
    assert.equal(state.controls?.canonicalSourceMode || 'current', expectedCanonicalSourceMode, 'canonical source mode route identity did not apply');
    assert.equal(state.canonicalPlumeControls?.sourceMode || 'current', expectedCanonicalSourceMode, 'effective canonical source mode did not reach debug state');
    assert.equal(state.controls?.canonicalRenderMode || 'default', expectedCanonicalRenderMode, 'canonical render diagnostic route identity did not apply');
    assert.equal(state.canonicalPlumeControls?.renderMode || 'default', expectedCanonicalRenderMode, 'effective canonical render diagnostic mode did not reach debug state');
    assert.equal(state.controls?.canonicalMotionMode || 'animated', expectedCanonicalMotionMode, 'canonical motion diagnostic route identity did not apply');
    assert.equal(state.canonicalPlumeControls?.motionMode || 'animated', expectedCanonicalMotionMode, 'effective canonical motion diagnostic mode did not reach debug state');
    assert.equal(state.controls?.canonicalContentMode || 'smoke', expectedCanonicalContentMode, 'canonical content route identity did not apply');
    assert.equal(state.canonicalPlumeControls?.contentMode || 'smoke', expectedCanonicalContentMode, 'effective canonical content mode did not reach debug state');
    assert.ok(Math.abs((state.controls?.canonicalSourceY ?? 0) - expectedCanonicalSourceY) < 0.001, 'canonical source height route/control did not apply');
    assert.ok(Math.abs((state.canonicalPlumeControls?.sourceY ?? 0) - expectedCanonicalSourceY) < 0.001, 'effective canonical source height did not reach debug state');
    assert.ok(Math.abs((state.controls?.canonicalSourceInjection ?? 0) - expectedCanonicalInjection) < 0.001, 'canonical source injection route/control did not apply');
    assert.ok(Math.abs((state.canonicalPlumeControls?.sourceInjection ?? 0) - expectedCanonicalInjection) < 0.001, 'effective canonical source injection did not reach debug state');
    assert.ok(Math.abs((state.controls?.canonicalBuoyancy ?? 0) - expectedCanonicalBuoyancy) < 0.001, 'canonical buoyancy route/control did not apply');
    assert.ok(Math.abs((state.canonicalPlumeControls?.buoyancyLift ?? 0) - expectedCanonicalBuoyancy) < 0.001, 'effective canonical buoyancy did not reach debug state');
    if (expectedCanonicalMacroPreset === 'macro_foothold_0621' || expectedCanonicalMacroPreset === 'honest_smoke_0622') {
      assert.ok(Math.abs((state.controls?.density ?? 0) - canonicalMacroPreset.density) < 0.001, 'canonical macro preset density did not apply');
      assert.ok(Math.abs((state.controls?.smoke ?? 0) - canonicalMacroPreset.smoke) < 0.001, 'canonical macro preset smoke visibility did not apply');
      assert.ok(Math.abs((state.controls?.absorption ?? 0) - canonicalMacroPreset.absorption) < 0.001, 'canonical macro preset absorption did not apply');
      assert.ok(Math.abs((state.controls?.speed ?? 0) - canonicalMacroPreset.speed) < 0.001, 'canonical macro preset speed did not apply');
      assert.ok(Math.abs((state.controls?.projection ?? 0) - canonicalMacroPreset.projection) < 0.001, 'canonical macro preset projection did not apply');
      assert.ok(Math.abs((state.controls?.canonicalSpread ?? 0) - canonicalMacroPreset.canonicalSpread) < 0.001, 'canonical macro preset scalar spread did not apply');
      assert.ok(Math.abs((state.controls?.canonicalCenterline ?? 0) - canonicalMacroPreset.canonicalCenterline) < 0.001, 'canonical macro preset centerline relief did not apply');
      assert.ok(Math.abs((state.controls?.canonicalBodyBalance ?? 0) - canonicalMacroPreset.canonicalBodyBalance) < 0.001, 'canonical macro preset body balance did not apply');
      if (expectedInputRadius != null) assert.ok(Math.abs((state.controls?.inputRadius ?? 0) - expectedInputRadius) < 0.001, 'canonical macro preset input radius did not apply');
      if (expectedFlowRate != null) assert.ok(Math.abs((state.controls?.flowRate ?? 0) - expectedFlowRate) < 0.001, 'canonical macro preset flow rate did not apply');
    }
    assert.ok(Math.abs((state.controls?.renderScale ?? 0) - expectedRenderScale) < 0.001, 'render scale route/control did not apply');
    assert.ok(Math.abs((state.renderScale ?? 0) - expectedRenderScale) < 0.001, 'effective render scale state did not match route/control');
    assert.ok((state.displayWidth ?? 0) >= (state.renderWidth ?? 0), 'internal render width exceeded display width');
    assert.ok((state.displayHeight ?? 0) >= (state.renderHeight ?? 0), 'internal render height exceeded display height');
    assert.ok(Math.abs((state.renderPixelRatio ?? 0) - expectedRenderScale) < 0.015, 'render-to-display pixel ratio did not match render scale');
    if (expectedExternalEmitterMode) {
      assert.equal(state.externalEmitterMode, expectedExternalEmitterMode, 'external emitter route identity did not apply');
      assert.equal(state.externalEmitterCoordinateSpace, 'volume-local', 'external emitter coordinate space did not reach debug state');
      assert.ok((state.externalEmitterCount ?? 0) > 0, 'external emitter route did not seed any emitters');
      assert.ok(Number.isFinite(state.externalEmitterAgeMs), 'external emitter age did not reach debug state');
    }
    if (expectedTemporalAccum > 0) {
      assert.equal(state.temporalHistoryValid, true, 'temporal history did not become valid after settling');
      assert.ok((state.temporalHistoryFrames ?? 0) > 4, 'temporal history did not accumulate enough frames after settling');
      assert.ok((state.temporalHistoryResetCount ?? 0) >= 1, 'temporal history did not record reset/rejection state');
      assert.ok(Number.isFinite(state.temporalReprojectionConfidence), 'temporal reprojection confidence did not reach debug state');
      assert.ok(Number.isFinite(state.temporalHistoryWeight), 'temporal history weight did not reach debug state');
      assert.ok(Number.isFinite(state.temporalRejectedHistory), 'temporal history rejection did not reach debug state');
      assert.ok(Number.isFinite(state.temporalSmokeHistoryTrust), 'material-aware smoke history trust did not reach debug state');
      assert.ok(Number.isFinite(state.temporalFireHistoryProtect), 'material-aware fire history protection did not reach debug state');
      assert.ok(Number.isFinite(state.temporalInterfaceHistoryProtect), 'material-aware interface history protection did not reach debug state');
      assert.equal(state.temporalEvidenceSource, 'cpu-estimate-control-proxy', 'temporal evidence source label did not reach debug state');
    }
    assert.equal(state.controls?.majorantGrid, expectedMajorantGrid, 'majorant grid route/control did not apply');
    assert.equal(state.majorantGrid, expectedMajorantGrid, 'coarse majorant grid identity did not apply');
    assert.equal(state.controls?.majorantCadence, expectedMajorantCadence, 'majorant cadence route/control did not apply');
    assert.equal(state.majorantCadence, expectedMajorantCadence, 'effective majorant cadence did not reach debug state');
    if (routeParams.has('volume_pressure_iterations') || expectedSpatialPressureTiers) {
      assert.equal(state.controls?.pressureIterations, expectedPressureIterations, 'pressure iteration route/control did not apply');
    }
    assert.equal(state.controls?.pressureStrategy || 'global', expectedPressureStrategy, 'pressure strategy route/control did not apply');
    assert.equal(state.pressureIterationDefault, defaultPressureIterationsForScene(expectedVolumeScene), 'effective pressure iteration default did not reach debug state');
    assert.equal(state.pressureIterationRequested, expectedPressureIterations, 'effective pressure iteration request did not reach debug state');
    assert.equal(Boolean(state.controls?.simProfile), expectedSimProfile, 'sim profile route/control did not apply');
    assert.equal(Boolean(state.simProfile), expectedSimProfile, 'effective sim profile flag did not reach debug state');
    assert.equal(state.majorantBuilt, true, 'coarse majorant field was not built before witness');
    const expectedPressureSourceStrategy = state.pressureProjectionEnabled ? 'jacobi-inline-divergence-v0' : 'disabled';
    const effectiveFireLicks = state.controls?.fireLicks ?? expectedFireLicks;
    const expectedMainFluidStrategy = expectedMainFluidKernelStrategy(effectiveFireLicks);
    const expectedMainFluidLocalProjectionStrategy = MAIN_FLUID_LOCAL_PROJECTION_STRATEGY_STAGED_PRESSURE_ONLY;
    const expectedFireLickBreakupEvaluations = expectedFireLickBreakupEvaluationsPerCell(effectiveFireLicks);
    const expectedBonfireCombustionStrategy = expectedBonfireCombustionFieldStrategy(expectedVolumeScene);
    const expectedBonfireCombustionEvaluations = expectedBonfireCombustionFieldEvaluationsPerCell(expectedVolumeScene);
    const expectedBonfireProceduralBreakupStrategyValue = expectedBonfireProceduralBreakupStrategy(expectedVolumeScene);
    const expectedBonfireProceduralBreakupEvaluations = expectedBonfireProceduralBreakupEvaluationsPerCell(expectedVolumeScene);
    const expectedBonfireSymmetricForceStrategyValue = expectedBonfireSymmetricForceStrategy(expectedVolumeScene);
    const expectedBonfireSymmetricForceEvaluations = expectedBonfireSymmetricForceEvaluationsPerCell(expectedVolumeScene);
    const expectedBonfireNonWindForceStrategyValue = expectedBonfireNonWindForceStrategy(expectedVolumeScene);
    const expectedBonfireNonWindForceEvaluations = expectedBonfireNonWindForceEvaluationsPerCell(expectedVolumeScene);
    const expectedBonfireScalarNeighborhoodStrategyValue = expectedBonfireScalarNeighborhoodStrategy(expectedVolumeScene);
    const expectedBonfireScalarNeighborhoodReads = expectedBonfireScalarNeighborhoodReadsPerCell(expectedVolumeScene);
    const expectedDetailCoherenceStrategy = expectedTallPlumeDetailCoherenceStrategy(expectedVolumeScene);
    const expectedDetailCoherenceExtraReads = expectedTallPlumeDetailCoherenceExtraReadsPerCell(expectedVolumeScene);
    const expectedTransitionBandStrategy = expectedTallPlumeTransitionBandStrategy(expectedVolumeScene);
    const expectedTransitionBandExtraReads = expectedTallPlumeTransitionBandExtraReadsPerCell(expectedVolumeScene);
    const stateLedger = state.simCostLedger || {};
    assert.equal(stateLedger.identity, 'tall-plume-sim-cost-ledger-v0', 'sim cost ledger identity did not reach debug state');
    assert.equal(stateLedger.evidenceSource, 'cpu-structural-pass-ledger-plus-raf-queue-proxy', 'sim cost ledger evidence source did not reach debug state');
    assert.equal(stateLedger.routeIdentity, 'native-3d-compute-fluid-raymarch-v0', 'sim cost ledger route identity is missing or stale');
    assert.equal(stateLedger.grid, expectedGrid, 'sim cost ledger grid identity did not match effective route');
    assert.equal(stateLedger.majorantGrid, expectedMajorantGrid, 'sim cost ledger majorant grid did not match effective route');
    assert.equal(stateLedger.majorantBuildCadence, expectedMajorantCadence, 'sim cost ledger majorant cadence did not match effective route');
    assert.equal(stateLedger.pressureSourceStrategy, expectedPressureSourceStrategy, 'sim cost ledger pressure source strategy does not match effective projection state');
    assert.equal(stateLedger.pressureStrategy || 'global', expectedPressureStrategy, 'sim cost ledger pressure strategy does not match effective route');
    assert.equal(stateLedger.tallPlumePressureIterationStrategy, expectedTallPlumePressureStrategy, 'sim cost ledger tall-plume pressure iteration strategy does not match effective route');
    assert.equal(Number(stateLedger.tallPlumePressureIterationTarget), expectedTallPlumePressureTarget, 'sim cost ledger tall-plume pressure target does not match effective scene');
    assert.equal(stateLedger.tallPlumePressureTierStrategy, expectedTallPlumePressureTierStrategyValue, 'sim cost ledger spatial pressure tier strategy does not match effective route');
    assert.equal(stateLedger.pressureProjectionReadStrategy, expectedPressureProjectionReadStrategy, 'sim cost ledger pressure projection read strategy does not match effective route');
    if (expectedSpatialPressureTiers) {
      assert.equal(Number(stateLedger.pressureJacobiFullGridPasses), 1, 'spatial pressure tiers should keep only one full-grid Jacobi pass');
      assert.equal(Number(stateLedger.pressureJacobiPartialSlabPasses), 2, 'spatial pressure tiers should report two partial slab Jacobi passes');
      assert.ok(Number(stateLedger.pressureJacobiFullGridEquivalentPasses) > 1 && Number(stateLedger.pressureJacobiFullGridEquivalentPasses) < 3, 'spatial pressure tiers did not report bounded equivalent full-grid work');
      assert.ok(Array.isArray(stateLedger.pressureTierDispatches) && stateLedger.pressureTierDispatches.length === 3, 'spatial pressure tiers did not report three tier dispatches');
      assert.equal(stateLedger.pressureTierBufferOwnership?.pressure3, 'B', 'spatial pressure tier buffer ownership did not preserve pressure3 in B');
      assert.equal(stateLedger.pressureTierBufferOwnership?.pressure2, 'A', 'spatial pressure tier buffer ownership did not preserve pressure2 in A');
    }
    assert.equal(stateLedger.mainFluidKernelStrategy, expectedMainFluidStrategy, 'sim cost ledger main fluid kernel strategy does not match effective fire-lick state');
    assert.equal(stateLedger.mainFluidLocalProjectionStrategy, expectedMainFluidLocalProjectionStrategy, 'sim cost ledger main fluid local projection strategy does not match staged pressure-only contract');
    assert.equal(Number(stateLedger.mainFluidLocalProjectionDivergenceEvaluationsPerCell), 0, 'sim cost ledger should not report local main-fluid divergence projection evaluations');
    assert.equal(Number(stateLedger.fireLickBreakupEvaluationsPerCell), expectedFireLickBreakupEvaluations, 'sim cost ledger fire-lick breakup evaluation count does not match effective fire-lick state');
    assert.equal(stateLedger.mainFluidBonfireCombustionFieldStrategy, expectedBonfireCombustionStrategy, 'sim cost ledger bonfire combustion-field strategy does not match effective scene');
    assert.equal(Number(stateLedger.bonfireCombustionFieldEvaluationsPerCell), expectedBonfireCombustionEvaluations, 'sim cost ledger bonfire combustion-field evaluation count does not match effective scene');
    assert.equal(stateLedger.mainFluidBonfireProceduralBreakupStrategy, expectedBonfireProceduralBreakupStrategyValue, 'sim cost ledger bonfire procedural-breakup strategy does not match effective scene');
    assert.equal(Number(stateLedger.bonfireProceduralBreakupEvaluationsPerCell), expectedBonfireProceduralBreakupEvaluations, 'sim cost ledger bonfire procedural-breakup evaluation count does not match effective scene');
    assert.equal(stateLedger.mainFluidBonfireSymmetricForceStrategy, expectedBonfireSymmetricForceStrategyValue, 'sim cost ledger bonfire symmetric-force strategy does not match effective scene');
    assert.equal(Number(stateLedger.bonfireSymmetricForceEvaluationsPerCell), expectedBonfireSymmetricForceEvaluations, 'sim cost ledger bonfire symmetric-force evaluation count does not match effective scene');
    assert.equal(stateLedger.mainFluidBonfireNonWindForceStrategy, expectedBonfireNonWindForceStrategyValue, 'sim cost ledger bonfire non-wind force strategy does not match effective scene');
    assert.equal(Number(stateLedger.bonfireNonWindForceEvaluationsPerCell), expectedBonfireNonWindForceEvaluations, 'sim cost ledger bonfire non-wind force evaluation count does not match effective scene');
    assert.equal(stateLedger.mainFluidBonfireScalarNeighborhoodStrategy, expectedBonfireScalarNeighborhoodStrategyValue, 'sim cost ledger bonfire scalar-neighborhood strategy does not match effective scene');
    assert.equal(Number(stateLedger.bonfireScalarNeighborhoodReadsPerCell), expectedBonfireScalarNeighborhoodReads, 'sim cost ledger bonfire scalar-neighborhood read count does not match effective scene');
    assert.equal(stateLedger.tallPlumeDetailCoherenceStrategy, expectedDetailCoherenceStrategy, 'sim cost ledger detail coherence strategy does not match effective scene');
    assert.equal(Number(stateLedger.tallPlumeDetailCoherenceExtraReadsPerCell), expectedDetailCoherenceExtraReads, 'sim cost ledger detail coherence should not restore scalar neighborhood reads');
    assert.equal(stateLedger.tallPlumeTransitionBandStrategy, expectedTransitionBandStrategy, 'sim cost ledger transition-band strategy does not match effective scene');
    assert.equal(Number(stateLedger.tallPlumeTransitionBandExtraReadsPerCell), expectedTransitionBandExtraReads, 'sim cost ledger transition-band breakup should not restore scalar neighborhood reads');
    assert.equal(Number(stateLedger.pressureDivergencePasses), 0, 'sim cost ledger should not report a standalone pressure divergence pass');
    assert.equal(stateLedger.pressureJacobiPasses, state.pressureProjectionEnabled ? expectedPressureProjectionIterations : 0, 'sim cost ledger pressure pass count does not match effective projection state');
    assert.equal(stateLedger.pressureJacobiInlineDivergencePasses, state.pressureProjectionEnabled ? expectedPressureProjectionIterations : 0, 'sim cost ledger inline-divergence Jacobi pass count does not match effective projection state');
    assert.equal(stateLedger.fullGridPassBreakdown?.total, stateLedger.fullGridPassesPerFrame, 'sim cost ledger pass breakdown total does not match full-grid pass count');
    assert.ok(Number.isFinite(stateLedger.fullGridCellVisitsPerFrame) && stateLedger.fullGridCellVisitsPerFrame >= expectedGrid ** 3, 'sim cost ledger did not report full-grid cell visits');
    assert.ok(Number.isFinite(stateLedger.fluidBufferBytes) && stateLedger.fluidBufferBytes > 0, 'sim cost ledger did not report fluid buffer footprint');
    assert.ok(state.simStepCount > 5, 'fluid sim did not advance enough compute steps');
    const stateTiming = state.timing || {};
    assert.equal(stateTiming.timingEvidenceSource, 'raf-and-queue-proxy', 'timing evidence source label did not reach debug state');
    assert.equal(stateTiming.timingDisclaimer, 'not-gpu-exclusive-or-present-latency', 'timing proxy disclaimer did not reach debug state');
    assert.ok(Number.isFinite(stateTiming.rafFps) && stateTiming.rafFps > 0, 'route-local RAF timing did not report a positive cadence');
    assert.ok(Number.isFinite(stateTiming.frameP95Ms) && stateTiming.frameP95Ms > 0, 'route-local frame p95 timing is missing');
    assert.ok(Number.isFinite(stateTiming.cpuFrameMs) && stateTiming.cpuFrameMs >= 0, 'route-local CPU frame timing is missing');

    phase = 'gpu-readback';
    const fullScreenshotPath = await captureViewportScreenshot(ws, fullScreenshot);
    const sampleEval = await wsRequest(ws, 'Runtime.evaluate', {
      expression: 'window.__kaminosVolumePrototype.sampleFrame()',
      awaitPromise: true,
      returnByValue: true,
    });
    const sample = sampleEval.result.value;
    if (sample?.ok !== true) {
      throw new Error(`GPU frame readback failed: ${JSON.stringify(sample)}`);
    }
    const samplePressureSourceStrategy = sample.pressureProjectionEnabled ? 'jacobi-inline-divergence-v0' : 'disabled';
    const sampleFireLicks = sample.controls?.fireLicks ?? effectiveFireLicks;
    const sampleMainFluidStrategy = expectedMainFluidKernelStrategy(sampleFireLicks);
    const sampleFireLickBreakupEvaluations = expectedFireLickBreakupEvaluationsPerCell(sampleFireLicks);
    const sampleVolumeScene = sample.volumeScene || sample.controls?.volumeScene || expectedVolumeScene;
    const sampleBonfireCombustionStrategy = expectedBonfireCombustionFieldStrategy(sampleVolumeScene);
    const sampleBonfireCombustionEvaluations = expectedBonfireCombustionFieldEvaluationsPerCell(sampleVolumeScene);
    const sampleBonfireProceduralBreakupStrategyValue = expectedBonfireProceduralBreakupStrategy(sampleVolumeScene);
    const sampleBonfireProceduralBreakupEvaluations = expectedBonfireProceduralBreakupEvaluationsPerCell(sampleVolumeScene);
    const sampleBonfireSymmetricForceStrategyValue = expectedBonfireSymmetricForceStrategy(sampleVolumeScene);
    const sampleBonfireSymmetricForceEvaluations = expectedBonfireSymmetricForceEvaluationsPerCell(sampleVolumeScene);
    const sampleBonfireNonWindForceStrategyValue = expectedBonfireNonWindForceStrategy(sampleVolumeScene);
    const sampleBonfireNonWindForceEvaluations = expectedBonfireNonWindForceEvaluationsPerCell(sampleVolumeScene);
    const sampleBonfireScalarNeighborhoodStrategyValue = expectedBonfireScalarNeighborhoodStrategy(sampleVolumeScene);
    const sampleBonfireScalarNeighborhoodReads = expectedBonfireScalarNeighborhoodReadsPerCell(sampleVolumeScene);
    const sampleDetailCoherenceStrategy = expectedTallPlumeDetailCoherenceStrategy(sampleVolumeScene);
    const sampleDetailCoherenceExtraReads = expectedTallPlumeDetailCoherenceExtraReadsPerCell(sampleVolumeScene);
    const sampleTransitionBandStrategy = expectedTallPlumeTransitionBandStrategy(sampleVolumeScene);
    const sampleTransitionBandExtraReads = expectedTallPlumeTransitionBandExtraReadsPerCell(sampleVolumeScene);
    const sampleLedger = sample.simCostLedger || stateLedger;
    if (
      sampleLedger?.identity !== 'tall-plume-sim-cost-ledger-v0' ||
      sampleLedger?.majorantBuildCadence !== expectedMajorantCadence ||
      sampleLedger?.pressureSourceStrategy !== samplePressureSourceStrategy ||
      sampleLedger?.mainFluidKernelStrategy !== sampleMainFluidStrategy ||
      sampleLedger?.mainFluidLocalProjectionStrategy !== expectedMainFluidLocalProjectionStrategy ||
      Number(sampleLedger?.mainFluidLocalProjectionDivergenceEvaluationsPerCell) !== 0 ||
      Number(sampleLedger?.fireLickBreakupEvaluationsPerCell) !== sampleFireLickBreakupEvaluations ||
      sampleLedger?.mainFluidBonfireCombustionFieldStrategy !== sampleBonfireCombustionStrategy ||
      Number(sampleLedger?.bonfireCombustionFieldEvaluationsPerCell) !== sampleBonfireCombustionEvaluations ||
      sampleLedger?.mainFluidBonfireProceduralBreakupStrategy !== sampleBonfireProceduralBreakupStrategyValue ||
      Number(sampleLedger?.bonfireProceduralBreakupEvaluationsPerCell) !== sampleBonfireProceduralBreakupEvaluations ||
      sampleLedger?.mainFluidBonfireSymmetricForceStrategy !== sampleBonfireSymmetricForceStrategyValue ||
      Number(sampleLedger?.bonfireSymmetricForceEvaluationsPerCell) !== sampleBonfireSymmetricForceEvaluations ||
      sampleLedger?.mainFluidBonfireNonWindForceStrategy !== sampleBonfireNonWindForceStrategyValue ||
      Number(sampleLedger?.bonfireNonWindForceEvaluationsPerCell) !== sampleBonfireNonWindForceEvaluations ||
      sampleLedger?.mainFluidBonfireScalarNeighborhoodStrategy !== sampleBonfireScalarNeighborhoodStrategyValue ||
      Number(sampleLedger?.bonfireScalarNeighborhoodReadsPerCell) !== sampleBonfireScalarNeighborhoodReads ||
      sampleLedger?.tallPlumeDetailCoherenceStrategy !== sampleDetailCoherenceStrategy ||
      Number(sampleLedger?.tallPlumeDetailCoherenceExtraReadsPerCell) !== sampleDetailCoherenceExtraReads ||
      sampleLedger?.tallPlumeTransitionBandStrategy !== sampleTransitionBandStrategy ||
      Number(sampleLedger?.tallPlumeTransitionBandExtraReadsPerCell) !== sampleTransitionBandExtraReads ||
      Number(sampleLedger?.pressureDivergencePasses) !== 0 ||
      sampleLedger?.pressureStrategy !== expectedPressureStrategy ||
      sampleLedger?.tallPlumePressureTierStrategy !== expectedTallPlumePressureTierStrategyValue ||
      sampleLedger?.pressureProjectionReadStrategy !== expectedPressureProjectionReadStrategy ||
      sampleLedger?.pressureJacobiPasses !== (sample.pressureProjectionEnabled ? expectedPressureProjectionIterations : 0) ||
      sampleLedger?.pressureJacobiInlineDivergencePasses !== (sample.pressureProjectionEnabled ? expectedPressureProjectionIterations : 0) ||
      (expectedSpatialPressureTiers && !Number.isFinite(Number(sampleLedger?.pressureJacobiFullGridEquivalentPasses))) ||
      sampleLedger?.fullGridPassBreakdown?.total !== sampleLedger?.fullGridPassesPerFrame ||
      !Number.isFinite(sampleLedger?.fullGridCellVisitsPerFrame) ||
      typeof sampleLedger?.majorantBuiltThisFrame !== 'boolean'
    ) {
      throw new Error(`GPU readback returned stale or incomplete sim cost ledger: ${JSON.stringify(sampleLedger)}`);
    }
    if (sample.preview?.rgba && Number.isFinite(sample.preview.width) && Number.isFinite(sample.preview.height)) {
      writeRgbaPng(out, sample.preview.width, sample.preview.height, sample.preview.rgba);
    }
    let canonicalFieldSlice = null;
    if (expectsCanonicalPlumeProof) {
      canonicalFieldSlice = sample.simReadback?.canonicalSmokeFieldSlice || null;
      if (
        canonicalFieldSlice?.identity !== 'canonical-smoke-field-slice-v0' ||
        canonicalFieldSlice?.backend !== 'cpu-fluid-buffer-readback' ||
        canonicalFieldSlice?.mode !== 'smoke-density-max-z-projection' ||
        !Number.isFinite(canonicalFieldSlice.width) ||
        !Number.isFinite(canonicalFieldSlice.height) ||
        !Array.isArray(canonicalFieldSlice.rgba) ||
        canonicalFieldSlice.rgba.length !== canonicalFieldSlice.width * canonicalFieldSlice.height * 4
      ) {
        throw new Error(`canonical plume field-slice evidence is missing or incomplete: ${JSON.stringify({
          identity: canonicalFieldSlice?.identity,
          backend: canonicalFieldSlice?.backend,
          mode: canonicalFieldSlice?.mode,
          width: canonicalFieldSlice?.width,
          height: canonicalFieldSlice?.height,
          rgbaLength: canonicalFieldSlice?.rgba?.length,
        })}`);
      }
      if (fieldSliceOut) {
        writeRgbaPng(fieldSliceOut, canonicalFieldSlice.width, canonicalFieldSlice.height, canonicalFieldSlice.rgba);
      }
    }
    if (!sample.simReadback || sample.simReadback.grid !== expectedGrid) {
      throw new Error(`GPU sim readback missing expected grid identity: ${JSON.stringify(sample.simReadback)}`);
    }
    if (
      sample.simReadback.frontFieldIdentity !== 'combustion-front-topology-sidecar-v0' ||
      sample.simReadback.frontFieldBytes !== expectedGrid * expectedGrid * expectedGrid * 4 ||
      !Number.isFinite(sample.simReadback.frontTopologyMean) ||
      !Number.isFinite(sample.simReadback.frontTopologySourcePlugRatio) ||
      !Number.isFinite(sample.simReadback.frontTopologyRisingBodyRatio) ||
      !Number.isFinite(sample.simReadback.frontTopologyHeightSpread) ||
      !Number.isFinite(sample.simReadback.frontTopologyRadianceCoupling) ||
      !Number.isFinite(sample.simReadback.frontTopologyFlameDetailCoupling) ||
      !Number.isFinite(sample.simReadback.frontTopologyFireLickCoupling) ||
      !Number.isFinite(sample.simReadback.frontTopologyVisibleTransferLoss)
    ) {
      throw new Error(`GPU sim readback does not expose live front topology sidecar evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!sample.majorantReadback || sample.majorantReadback.grid !== expectedMajorantGrid || sample.majorantReadback.occupiedBricks < 2 || sample.majorantReadback.importanceMax <= 0.01) {
      throw new Error(`GPU majorant readback does not show a live coarse occupancy field: ${JSON.stringify(sample.majorantReadback)}`);
    }
    const sampleTiming = sample.timing || stateTiming;
    if (!Number.isFinite(sampleTiming.rafFps) || sampleTiming.rafFps <= 0 || !Number.isFinite(sampleTiming.frameP95Ms) || sampleTiming.frameP95Ms <= 0) {
      throw new Error(`Route-local timing did not survive GPU readback: ${JSON.stringify(sampleTiming)}`);
    }
    if (sampleTiming.queueTimingAvailable === true && sampleTiming.queueSamples > 0) {
      if (!Number.isFinite(sampleTiming.queueDoneMs) || !Number.isFinite(sampleTiming.queueDoneP95Ms)) {
        throw new Error(`GPU queue completion timing was sampled but did not report finite latency: ${JSON.stringify(sampleTiming)}`);
      }
    }
    if (sample.simReadback.densityMax <= 0.01 || sample.simReadback.velocityMean <= 0.001 || sample.simReadback.liveVoxels < 8) {
      throw new Error(`GPU sim readback does not show live fluid state: ${JSON.stringify(sample.simReadback)}`);
    }
    if (!expectsCanonicalPlumeProof && (!Number.isFinite(sample.simReadback.detailMean) || sample.simReadback.detailMean <= 0.0005)) {
      throw new Error(`GPU sim readback does not show transported material detail: ${JSON.stringify(sample.simReadback)}`);
    }
    const pyroRawCarrierPaintEvidence = buildPyroRawCarrierPaintEvidence(sample, state);
    const acceptsRawCarrierPyroPaint =
      expectsPyroMaterialEvidence &&
      pyroRawCarrierPaintEvidence.acceptsLowStockFireLayer;
    if (!expectsCanonicalPlumeProof && !expectsFuelStarvedTallPlume && !expectsNoFireVolumeEvidence && (!Number.isFinite(sample.simReadback.fireLayerMean) || sample.simReadback.fireLayerMean <= 0.0005) && !acceptsRawCarrierPyroPaint) {
      throw new Error(`GPU sim readback does not show a transported fire layer or raw-carrier Pyro paint evidence: ${JSON.stringify({
        simReadback: sample.simReadback,
        pyroRawCarrierPaintEvidence,
      })}`);
    }
    if (!expectsCanonicalPlumeProof && !expectsFuelStarvedTallPlume && !expectsNoFireVolumeEvidence && (!Number.isFinite(sample.simReadback.radianceMean) || sample.simReadback.radianceMean <= 0.0005)) {
      throw new Error(`GPU sim readback does not show fire radiance evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (expectedVolumeScene === 'tall_plume') {
      if (
        !Number.isFinite(sample.simReadback.fuelMean) ||
        !Number.isFinite(sample.simReadback.reactionMean) ||
        !Number.isFinite(sample.simReadback.fuelConsumptionMean) ||
        !Number.isFinite(sample.simReadback.fireFuelOverlapRatio)
      ) {
        throw new Error(`GPU sim readback does not expose tall-plume fuel/reaction evidence: ${JSON.stringify(sample.simReadback)}`);
      }
      if (expectsFuelStarvedTallPlume) {
        if (
          sample.simReadback.fireLayerMean > 0.0007 ||
          sample.simReadback.radianceMean > 0.0007 ||
          sample.simReadback.fuelMean > 0.004
        ) {
          throw new Error(`fuel-starved tall plume still carried fire/fuel: ${JSON.stringify({
            fuelMean: sample.simReadback.fuelMean,
            reactionMean: sample.simReadback.reactionMean,
            fuelConsumptionMean: sample.simReadback.fuelConsumptionMean,
            fireFuelOverlapRatio: sample.simReadback.fireFuelOverlapRatio,
            fireLayerMean: sample.simReadback.fireLayerMean,
            radianceMean: sample.simReadback.radianceMean,
            extinctionMean: sample.simReadback.extinctionMean,
          })}`);
        }
      } else if (
        sample.simReadback.fuelMean <= 0.0005 ||
        sample.simReadback.reactionMean <= 0.0005 ||
        sample.simReadback.fuelConsumptionMean <= 0.00001 ||
        sample.simReadback.fireFuelOverlapRatio <= 0.01
      ) {
        throw new Error(`tall plume fire was not supported by live fuel/reaction evidence: ${JSON.stringify(sample.simReadback)}`);
      }
    }
    if (
      expectedVolumeScene === 'bonfire_plume' &&
      (!Number.isFinite(sample.simReadback.emissionDetailMean) || sample.simReadback.emissionDetailMean <= 0.0005)
    ) {
      throw new Error(`GPU sim readback does not show transported bonfire emission-detail evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (
      expectedVolumeScene === 'bonfire_plume' &&
      (
        !Number.isFinite(sample.simReadback.emissionDetailCurlContact) ||
        !Number.isFinite(sample.simReadback.emissionDetailVerticalCoherence) ||
        !Number.isFinite(sample.simReadback.smokeDetailVerticalCoherence)
      )
    ) {
      throw new Error(`GPU sim readback does not show bonfire detail-coherence evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (
      expectedVolumeScene === 'bonfire_plume' &&
      sample.simReadback.radianceMean > 0.0005 &&
      (!Number.isFinite(sample.simReadback.combustionFrontMean) || sample.simReadback.combustionFrontMean <= 0.00025)
    ) {
      throw new Error(`GPU sim readback shows bonfire fire without transported combustion-front evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    const expectedExtinctionFloor = expectsCanonicalPlumeProof ? 0.00025 : 0.0005;
    if (!Number.isFinite(sample.simReadback.extinctionMean) || sample.simReadback.extinctionMean <= expectedExtinctionFloor) {
      throw new Error(`GPU sim readback does not show smoke extinction evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    const expectsMicrodetailEvidence = !expectsCanonicalPlumeProof && (state.controls?.microdetail ?? expectedMicrodetail) > 0.01;
    const expectsCurlEvidence = (state.controls?.curl ?? expectedCurl) > 0.01;
    if (expectsMicrodetailEvidence && (!Number.isFinite(sample.simReadback.microdetailMean) || sample.simReadback.microdetailMean <= 0.0005)) {
      throw new Error(`GPU sim readback does not show transported microdetail: ${JSON.stringify(sample.simReadback)}`);
    }
    const expectsInterfaceShredEvidence = !expectsCanonicalPlumeProof && !expectsFuelStarvedTallPlume && (state.controls?.interfaceShred ?? expectedInterfaceShred) > 0.01;
    const expectsFireLickEvidence = !expectsCanonicalPlumeProof && !expectsFuelStarvedTallPlume && (state.controls?.fireLicks ?? expectedFireLicks) > 0.01;
    const expectsBonfireVerticalTransport = expectedVolumeScene === 'bonfire_plume';
    if (expectsInterfaceShredEvidence && (!Number.isFinite(sample.simReadback.interfaceShredMean) || sample.simReadback.interfaceShredMean <= 0.00025)) {
      throw new Error(`GPU sim readback does not show interface shredding: ${JSON.stringify(sample.simReadback)}`);
    }
    if (expectsFireLickEvidence && (!Number.isFinite(sample.simReadback.fireLickMean) || sample.simReadback.fireLickMean <= 0.00025)) {
      throw new Error(`GPU sim readback does not show fire-lick breakup: ${JSON.stringify(sample.simReadback)}`);
    }
    if (expectsCurlEvidence && (!Number.isFinite(sample.simReadback.curlMean) || sample.simReadback.curlMax <= 0.0005)) {
      throw new Error(`GPU sim readback does not show curl/vorticity evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (expectedWindDrift) {
      const lateralX = sample.simReadback.plumeNetLateralVelocityX ?? 0;
      const screenX = sample.volumeBounds?.screenDriftX ?? 0;
      const fireScreenX = sample.fireBounds?.screenDriftX ?? 0;
      const windEvidence = {
        expectedWindDrift,
        lateralX,
        screenX,
        fireScreenX,
        windStrength: expectedWindStrength,
        windAngle: expectedWindAngle,
      };
      if (expectedWindDrift === 'left' && !(lateralX < -0.010 || screenX < -0.030 || fireScreenX < -0.030)) {
        throw new Error(`wind probe did not drift left: ${JSON.stringify(windEvidence)}`);
      }
      if (expectedWindDrift === 'right' && !(lateralX > 0.010 || screenX > 0.030 || fireScreenX > 0.030)) {
        throw new Error(`wind probe did not drift right: ${JSON.stringify(windEvidence)}`);
      }
      if (expectedWindDrift === 'none' && (Math.abs(lateralX) > 0.140 || Math.abs(screenX) > 0.360)) {
        throw new Error(`no-wind probe drifted too far for a control witness: ${JSON.stringify(windEvidence)}`);
      }
    }
    if (!Number.isFinite(sample.simReadback.divergenceMean) || !Number.isFinite(sample.simReadback.divergenceMax)) {
      throw new Error(`GPU sim readback does not show divergence/projection evidence: ${JSON.stringify(sample.simReadback)}`);
    }
    if (expectsCanonicalSmokeRise) {
      const risingBins = sample.simReadback.sourceRelativeVisualHeightBins || [];
      const hasRisingSmokeAboveSource = risingBins.some(bin =>
        bin.visualCenter > 0.12 &&
        bin.smokeWeight > 0.4 &&
        bin.smokeVisualRiseVelocity > 0.001
      );
      if (
        !Number.isFinite(sample.simReadback.smokeVisualRiseVelocity) ||
        sample.simReadback.smokeVisualRiseVelocity <= 0.004 ||
        !Number.isFinite(sample.simReadback.smokeVisualRiseDisplacement) ||
        sample.simReadback.smokeVisualRiseDisplacement <= 0.030 ||
        !Number.isFinite(sample.simReadback.risingSmokeWeight) ||
        sample.simReadback.risingSmokeWeight <= 0.4 ||
        !hasRisingSmokeAboveSource
      ) {
        throw new Error(`canonical plume did not show simple source-relative smoke rise: ${JSON.stringify(sample.simReadback)}`);
      }
    }
    if (
      expectsCanonicalPlumeProof &&
      !canonicalContentRequestsFire &&
      (
        sample.simReadback.fireLayerMean > 0.0005 ||
        sample.simReadback.radianceMean > 0.0005 ||
        sample.simReadback.microdetailMean > 0.0005 ||
        sample.simReadback.interfaceShredMean > 0.0005 ||
        sample.simReadback.fireLickMean > 0.0005
      )
    ) {
      throw new Error(`canonical plume leaked bonfire/fire/detail carriers: ${JSON.stringify({
        fireLayerMean: sample.simReadback.fireLayerMean,
        radianceMean: sample.simReadback.radianceMean,
        microdetailMean: sample.simReadback.microdetailMean,
        interfaceShredMean: sample.simReadback.interfaceShredMean,
        fireLickMean: sample.simReadback.fireLickMean,
      })}`);
    }
    const expectsCanonicalFireEvidence = expectsCanonicalPlumeProof && canonicalContentRequestsFire;
    if (expectsCanonicalFireEvidence) {
      if (!Number.isFinite(sample.simReadback.fireLayerMean) || sample.simReadback.fireLayerMean <= 0.0005) {
        throw new Error(`canonical fire content did not produce transported fire evidence: ${JSON.stringify(sample.simReadback)}`);
      }
      if (
        sample.simReadback.microdetailMean > 0.0005 ||
        sample.simReadback.interfaceShredMean > 0.0005 ||
        sample.simReadback.fireLickMean > 0.0005 ||
        sample.simReadback.frontTopologyMean > 0.0005
      ) {
        throw new Error(`canonical fire bridge leaked excluded detail/front carriers: ${JSON.stringify({
          microdetailMean: sample.simReadback.microdetailMean,
          interfaceShredMean: sample.simReadback.interfaceShredMean,
          fireLickMean: sample.simReadback.fireLickMean,
          frontTopologyMean: sample.simReadback.frontTopologyMean,
        })}`);
      }
    }
    if (canonicalPassiveBottomNonRiseProof) {
      if (
        Math.abs(expectedCanonicalInjection) > 0.001 ||
        Math.abs(expectedCanonicalBuoyancy) > 0.001 ||
        sample.simReadback.heatMean > 0.01
      ) {
        throw new Error(`passive bottom-source proof was contaminated by injection or buoyancy: ${JSON.stringify({
          expectedCanonicalInjection,
          expectedCanonicalBuoyancy,
          heatMean: sample.simReadback.heatMean,
          smokeVisualRiseVelocity: sample.simReadback.smokeVisualRiseVelocity,
          smokeVisualRiseDisplacement: sample.simReadback.smokeVisualRiseDisplacement,
        })}`);
      }
    }
    if (expectsBonfireVerticalTransport) {
      const risingBins = sample.simReadback.sourceRelativeVisualHeightBins || [];
      const hasRisingSmokeAboveSource = risingBins.some(bin =>
        bin.visualCenter > 0.20 &&
        bin.smokeWeight > 1.0 &&
        bin.smokeVisualRiseVelocity > 0.002
      );
      if (
        !Number.isFinite(sample.simReadback.smokeVisualRiseVelocity) ||
        sample.simReadback.smokeVisualRiseVelocity <= 0.025 ||
        !Number.isFinite(sample.simReadback.smokeVisualRiseDisplacement) ||
        sample.simReadback.smokeVisualRiseDisplacement <= 0.08 ||
        !Number.isFinite(sample.simReadback.risingSmokeVisualRiseDisplacement) ||
        sample.simReadback.risingSmokeVisualRiseDisplacement <= 0.20 ||
        !hasRisingSmokeAboveSource
      ) {
        throw new Error(`bonfire plume did not show source-relative zero-wind vertical smoke transport: ${JSON.stringify(sample.simReadback)}`);
      }
    }
    const expectsBonfireZeroDrift = expectsBonfireVerticalTransport && Math.abs(expectedWindStrength) <= 0.001;
    const expectsBonfireConvectionProof = expectsBonfireZeroDrift;
    if (expectsBonfireConvectionProof) {
      if (
        !Number.isFinite(sample.simReadback.plumeScalarCurlContact) ||
        sample.simReadback.plumeScalarCurlContact <= 0.030 ||
        !Number.isFinite(sample.simReadback.plumeSmokeBodyBreadth) ||
        sample.simReadback.plumeSmokeBodyBreadth <= 0.045 ||
        !Number.isFinite(sample.simReadback.plumeTopPinchRatio) ||
        sample.simReadback.plumeTopPinchRatio <= 0.88 ||
        !Number.isFinite(sample.simReadback.plumeFieldColumnCoherence) ||
        sample.simReadback.plumeFieldColumnCoherence >= 0.92
      ) {
        const failureName = Number.isFinite(sample.simReadback.plumeTopPinchRatio) && sample.simReadback.plumeTopPinchRatio <= 0.88
          ? 'bonfire plume retained centerline chimney pinching'
          : 'bonfire plume retained solver-column coherence';
        throw new Error(`${failureName}: ${JSON.stringify({
          plumeScalarCurlContact: sample.simReadback.plumeScalarCurlContact,
          plumeSmokeBodyBreadth: sample.simReadback.plumeSmokeBodyBreadth,
          plumeTopPinchRatio: sample.simReadback.plumeTopPinchRatio,
          plumeLowerRollingBodyBreadth: sample.simReadback.plumeLowerRollingBodyBreadth,
          plumeUpperRollingBodyBreadth: sample.simReadback.plumeUpperRollingBodyBreadth,
          plumeFieldColumnCoherence: sample.simReadback.plumeFieldColumnCoherence,
          plumeFieldBinCenterSpread: sample.simReadback.plumeFieldBinCenterSpread,
          plumeSmokeWeightedCurlMean: sample.simReadback.plumeSmokeWeightedCurlMean,
        })}`);
      }
    }
    if (
      expectsBonfireConvectionProof &&
      (
        !Number.isFinite(sample.simReadback.fireSourcePlugRatio) ||
        sample.simReadback.fireSourcePlugRatio >= 0.68 ||
        !Number.isFinite(sample.simReadback.fireRisingBodyRatio) ||
        sample.simReadback.fireRisingBodyRatio <= 0.24 ||
        !Number.isFinite(sample.fireEdgeEnergy) ||
        sample.fireEdgeEnergy <= 0.066 ||
        !Number.isFinite(sample.fireRoughnessMean) ||
        sample.fireRoughnessMean <= 0.105 ||
        !Number.isFinite(sample.simReadback.liftedFireShellRatio) ||
        sample.simReadback.liftedFireShellRatio >= 0.62 ||
        !Number.isFinite(sample.simReadback.liftedFireInteriorRatio) ||
        sample.simReadback.liftedFireInteriorRatio <= 0.12
      )
    ) {
      throw new Error(`bonfire plume retained smooth fire source plug: ${JSON.stringify({
        fireSourcePlugRatio: sample.simReadback.fireSourcePlugRatio,
        fireRisingBodyRatio: sample.simReadback.fireRisingBodyRatio,
        fireChannelSourcePlugDominant: sample.simReadback.fireChannelSourcePlugDominant,
        fireFlameSourcePlugRatio: sample.simReadback.fireFlameSourcePlugRatio,
        fireEmberSourcePlugRatio: sample.simReadback.fireEmberSourcePlugRatio,
        fireFlameDetailSourcePlugRatio: sample.simReadback.fireFlameDetailSourcePlugRatio,
        fireVisibleCarrierSourcePlugRatio: sample.simReadback.fireVisibleCarrierSourcePlugRatio,
        fireLickSourcePlugRatio: sample.simReadback.fireLickSourcePlugRatio,
        fireHeatSourcePlugRatio: sample.simReadback.fireHeatSourcePlugRatio,
        fireFlameRisingBodyRatio: sample.simReadback.fireFlameRisingBodyRatio,
        fireEmberRisingBodyRatio: sample.simReadback.fireEmberRisingBodyRatio,
        fireFlameDetailRisingBodyRatio: sample.simReadback.fireFlameDetailRisingBodyRatio,
        fireVisibleCarrierRisingBodyRatio: sample.simReadback.fireVisibleCarrierRisingBodyRatio,
        fireLickRisingBodyRatio: sample.simReadback.fireLickRisingBodyRatio,
        fireHeatRisingBodyRatio: sample.simReadback.fireHeatRisingBodyRatio,
        liftedFireShellRatio: sample.simReadback.liftedFireShellRatio,
        liftedFireInteriorRatio: sample.simReadback.liftedFireInteriorRatio,
        emissionDetailMean: sample.simReadback.emissionDetailMean,
        liftedEmissionDetailRatio: sample.simReadback.liftedEmissionDetailRatio,
        emissionDetailCurlContact: sample.simReadback.emissionDetailCurlContact,
        emissionDetailVerticalCoherence: sample.simReadback.emissionDetailVerticalCoherence,
        emissionDetailBodyBreadth: sample.simReadback.emissionDetailBodyBreadth,
        emissionDetailBinCenterSpread: sample.simReadback.emissionDetailBinCenterSpread,
        smokeDetailVerticalCoherence: sample.simReadback.smokeDetailVerticalCoherence,
        smokeDetailBodyBreadth: sample.simReadback.smokeDetailBodyBreadth,
        smokeDetailBinCenterSpread: sample.simReadback.smokeDetailBinCenterSpread,
        combustionFrontMean: sample.simReadback.combustionFrontMean,
        combustionFrontSourcePlugRatio: sample.simReadback.combustionFrontSourcePlugRatio,
        combustionFrontRisingBodyRatio: sample.simReadback.combustionFrontRisingBodyRatio,
        maxCombustionFrontBinWeight: sample.simReadback.maxCombustionFrontBinWeight,
        combustionFrontWeight: sample.simReadback.combustionFrontWeight,
        frontTopologyMean: sample.simReadback.frontTopologyMean,
        frontTopologySourcePlugRatio: sample.simReadback.frontTopologySourcePlugRatio,
        frontTopologyRisingBodyRatio: sample.simReadback.frontTopologyRisingBodyRatio,
        frontTopologyHeightSpread: sample.simReadback.frontTopologyHeightSpread,
        frontTopologyRadianceCoupling: sample.simReadback.frontTopologyRadianceCoupling,
        frontTopologyFlameDetailCoupling: sample.simReadback.frontTopologyFlameDetailCoupling,
        frontTopologyFireLickCoupling: sample.simReadback.frontTopologyFireLickCoupling,
        frontTopologyVisibleTransferLoss: sample.simReadback.frontTopologyVisibleTransferLoss,
        maxFireBinWeight: sample.simReadback.maxFireBinWeight,
        fireWeight: sample.simReadback.fireWeight,
        fireVisualRiseDisplacement: sample.simReadback.fireVisualRiseDisplacement,
        fireEdgeEnergy: sample.fireEdgeEnergy,
        fireRoughnessMean: sample.fireRoughnessMean,
      })}`);
    }
    if (
      expectsBonfireVerticalTransport &&
      Number.isFinite(expectedMaxSmokeStripeRatio) &&
      (
        !Number.isFinite(sample.smokeVerticalStripeRatio) ||
        sample.smokeVerticalStripeRatio > expectedMaxSmokeStripeRatio
      )
    ) {
      throw new Error(`bonfire plume retained vertical curtain striping: ${JSON.stringify({
        smokeVerticalStripeRatio: sample.smokeVerticalStripeRatio,
        maxSmokeStripeRatio: expectedMaxSmokeStripeRatio,
        smokeHorizontalEnergy: sample.smokeHorizontalEnergy,
        smokeVerticalEnergy: sample.smokeVerticalEnergy,
      })}`);
    }
    if (expectsBonfireZeroDrift) {
      const activeBins = (sample.simReadback.sourceRelativeVisualHeightBins || []).filter(bin =>
        bin.visualCenter > -0.08 &&
        bin.smokeWeight > 1.0
      );
      const maxSmokeBinRadialDrift = activeBins.reduce((maxDrift, bin) =>
        Math.max(maxDrift, Math.hypot(bin.smokeCenterX || 0, bin.smokeCenterZ || 0)),
        0
      );
      if (
        !Number.isFinite(sample.simReadback.smokeRadialDrift) ||
        sample.simReadback.smokeRadialDrift > 0.015 ||
        !Number.isFinite(sample.simReadback.fireRadialDrift) ||
        sample.simReadback.fireRadialDrift > 0.020 ||
        maxSmokeBinRadialDrift > 0.030
      ) {
        throw new Error(`bonfire plume retained non-wind lateral drift: ${JSON.stringify({ simReadback: sample.simReadback, maxSmokeBinRadialDrift })}`);
      }
    }
    if (expectsBonfireConvectionProof) {
      const convectiveBins = (sample.simReadback.sourceRelativeVisualHeightBins || []).filter(bin =>
        bin.visualCenter > 0.02 &&
        bin.smokeWeight > 1.0
      );
      const hasLocalRollAboveSource = convectiveBins.some(bin =>
        bin.smokeLateralVelocityMean > 0.004 &&
        bin.smokeRadialVelocityAbsMean > 0.0015 &&
        bin.smokeWeightedCurlMean > 0.0005
      );
      if (
        !Number.isFinite(sample.simReadback.plumeLocalLateralVelocityMean) ||
        sample.simReadback.plumeLocalLateralVelocityMean <= 0.004 ||
        !Number.isFinite(sample.simReadback.plumeNetLateralVelocity) ||
        !Number.isFinite(sample.simReadback.plumeLateralVelocityBalance) ||
        sample.simReadback.plumeLateralVelocityBalance >= 0.78 ||
        !Number.isFinite(sample.simReadback.plumeRadialVelocityAbsMean) ||
        sample.simReadback.plumeRadialVelocityAbsMean <= 0.0015 ||
        !Number.isFinite(sample.simReadback.plumeSmokeWeightedCurlMean) ||
        sample.simReadback.plumeSmokeWeightedCurlMean <= 0.0005 ||
        !hasLocalRollAboveSource
      ) {
        throw new Error(`bonfire plume lacked local zero-mean convection: ${JSON.stringify({
          plumeLocalLateralVelocityMean: sample.simReadback.plumeLocalLateralVelocityMean,
          plumeNetLateralVelocity: sample.simReadback.plumeNetLateralVelocity,
          plumeLateralVelocityBalance: sample.simReadback.plumeLateralVelocityBalance,
          plumeRadialVelocityAbsMean: sample.simReadback.plumeRadialVelocityAbsMean,
          plumeSmokeWeightedCurlMean: sample.simReadback.plumeSmokeWeightedCurlMean,
          hasLocalRollAboveSource,
          convectiveBins,
        })}`);
      }
    }
    const metrics = {
      width: sample.width,
      height: sample.height,
      meanLuma: sample.meanLuma,
      litPixels: sample.litPixels,
      fireLikePixels: sample.fireLikePixels,
      emissiveLikePixels: sample.emissiveLikePixels,
      smokeLikePixels: sample.smokeLikePixels,
      fireRoughnessMean: sample.fireRoughnessMean,
      fireEdgeEnergy: sample.fireEdgeEnergy,
      smokeHorizontalEnergy: sample.smokeHorizontalEnergy,
      smokeVerticalEnergy: sample.smokeVerticalEnergy,
      smokeVerticalStripeRatio: sample.smokeVerticalStripeRatio,
      volumeBounds: sample.volumeBounds,
      fireBounds: sample.fireBounds,
      smokeBounds: sample.smokeBounds,
      verticalFillRatio: sample.volumeBounds?.verticalFillRatio ?? 0,
      normalizedCenterX: sample.volumeBounds?.normalizedCenterX ?? 0,
      screenDriftX: sample.volumeBounds?.screenDriftX ?? 0,
      smokeScreenDriftX: sample.smokeBounds?.screenDriftX ?? 0,
      fireScreenDriftX: sample.fireBounds?.screenDriftX ?? 0,
      plumeHeightBins: sample.simReadback?.plumeHeightBins ?? [],
      smokeVisualRiseVelocity: sample.simReadback?.smokeVisualRiseVelocity ?? 0,
      fireVisualRiseVelocity: sample.simReadback?.fireVisualRiseVelocity ?? 0,
      fuelMean: sample.simReadback?.fuelMean ?? 0,
      reactionMean: sample.simReadback?.reactionMean ?? 0,
      fuelConsumptionMean: sample.simReadback?.fuelConsumptionMean ?? 0,
      fireFuelOverlapRatio: sample.simReadback?.fireFuelOverlapRatio ?? 0,
      smokeVisualRiseDisplacement: sample.simReadback?.smokeVisualRiseDisplacement ?? 0,
      risingSmokeVisualRiseDisplacement: sample.simReadback?.risingSmokeVisualRiseDisplacement ?? 0,
      fireVisualRiseDisplacement: sample.simReadback?.fireVisualRiseDisplacement ?? 0,
      combustionFrontMean: sample.simReadback?.combustionFrontMean ?? 0,
      combustionFrontSourcePlugRatio: sample.simReadback?.combustionFrontSourcePlugRatio ?? 0,
      combustionFrontRisingBodyRatio: sample.simReadback?.combustionFrontRisingBodyRatio ?? 0,
      maxCombustionFrontBinWeight: sample.simReadback?.maxCombustionFrontBinWeight ?? 0,
      combustionFrontWeight: sample.simReadback?.combustionFrontWeight ?? 0,
      fireSourcePlugRatio: sample.simReadback?.fireSourcePlugRatio ?? 0,
      fireRisingBodyRatio: sample.simReadback?.fireRisingBodyRatio ?? 0,
      liftedFireShellRatio: sample.simReadback?.liftedFireShellRatio ?? 0,
      liftedFireInteriorRatio: sample.simReadback?.liftedFireInteriorRatio ?? 0,
      emissionDetailMean: sample.simReadback?.emissionDetailMean ?? 0,
      liftedEmissionDetailRatio: sample.simReadback?.liftedEmissionDetailRatio ?? 0,
      emissionDetailCurlContact: sample.simReadback?.emissionDetailCurlContact ?? 0,
      emissionDetailVerticalCoherence: sample.simReadback?.emissionDetailVerticalCoherence ?? 0,
      emissionDetailBodyBreadth: sample.simReadback?.emissionDetailBodyBreadth ?? 0,
      emissionDetailBinCenterSpread: sample.simReadback?.emissionDetailBinCenterSpread ?? 0,
      smokeDetailVerticalCoherence: sample.simReadback?.smokeDetailVerticalCoherence ?? 0,
      smokeDetailBodyBreadth: sample.simReadback?.smokeDetailBodyBreadth ?? 0,
      smokeDetailBinCenterSpread: sample.simReadback?.smokeDetailBinCenterSpread ?? 0,
      maxFireBinWeight: sample.simReadback?.maxFireBinWeight ?? 0,
      plumeLocalLateralVelocityMean: sample.simReadback?.plumeLocalLateralVelocityMean ?? 0,
      plumeNetLateralVelocity: sample.simReadback?.plumeNetLateralVelocity ?? 0,
      plumeLateralVelocityBalance: sample.simReadback?.plumeLateralVelocityBalance ?? 0,
      plumeRadialVelocityAbsMean: sample.simReadback?.plumeRadialVelocityAbsMean ?? 0,
      plumeSmokeWeightedCurlMean: sample.simReadback?.plumeSmokeWeightedCurlMean ?? 0,
      plumeScalarCurlContact: sample.simReadback?.plumeScalarCurlContact ?? 0,
      plumeSmokeBodyBreadth: sample.simReadback?.plumeSmokeBodyBreadth ?? 0,
      plumeTopPinchRatio: sample.simReadback?.plumeTopPinchRatio ?? 0,
      plumeLowerRollingBodyBreadth: sample.simReadback?.plumeLowerRollingBodyBreadth ?? 0,
      plumeUpperRollingBodyBreadth: sample.simReadback?.plumeUpperRollingBodyBreadth ?? 0,
      plumeFieldColumnCoherence: sample.simReadback?.plumeFieldColumnCoherence ?? 0,
      plumeFieldBinCenterSpread: sample.simReadback?.plumeFieldBinCenterSpread ?? 0,
      sourceRelativeVisualHeightBins: sample.simReadback?.sourceRelativeVisualHeightBins ?? [],
    };
    writeRgbaPng(out, sample.preview.width, sample.preview.height, sample.preview.rgba);
    const captureBackend = 'webgpu-copy-src-readback';
    const mainRendererScreenshot = out.replace(/\.png$/i, '.main-renderer.png');
    const pageShot = await wsRequest(ws, 'Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    const mainRendererBuffer = Buffer.from(pageShot.data, 'base64');
    writeFileSync(mainRendererScreenshot, mainRendererBuffer);
    const mainRendererMetrics = measureScreenshot(mainRendererBuffer);
    const expectsNoFireMainRendererVolume = expectsNoFireVolumeEvidence ||
      expectsFuelStarvedTallPlume ||
      (expectsCanonicalPlumeProof && !expectsCanonicalFireEvidence);
    if (expectsSnuffVisualEvidence) {
      if (mainRendererMetrics.litPixels < 1500 || mainRendererMetrics.smokeLikePixels < 1500 || mainRendererMetrics.meanLuma < 8) {
        throw new Error(`main renderer screenshot missing bridged snuff vapor volume: ${JSON.stringify(mainRendererMetrics)}`);
      }
    } else if (expectsNoFireMainRendererVolume) {
      if (mainRendererMetrics.litPixels < 650 || mainRendererMetrics.meanLuma < 1.5) {
        throw new Error(`main renderer screenshot missing bridged no-fire volume signal: ${JSON.stringify(mainRendererMetrics)}`);
      }
    } else if (expectsPyroMaterialEvidence) {
      if (mainRendererMetrics.litPixels < 1500 || mainRendererMetrics.meanLuma < 8) {
        throw new Error(`main renderer screenshot missing bridged Pyro material volume: ${JSON.stringify(mainRendererMetrics)}`);
      }
    } else if (mainRendererMetrics.litPixels < 1500 || mainRendererMetrics.fireLikePixels < 80 || mainRendererMetrics.meanLuma < 8) {
      throw new Error(`main renderer screenshot missing bridged fire volume: ${JSON.stringify(mainRendererMetrics)}`);
    }
    const visibleFirePixels = metrics.fireLikePixels + metrics.emissiveLikePixels;
    const performanceVisualWarnings = [];
    const canonicalPassiveBottomFieldProof = canonicalPassiveBottomNonRiseProof &&
      (sample.simReadback?.smokeWeight ?? 0) > 20 &&
      (canonicalFieldSlice?.xyActivePixelRatio ?? 0) > 0.001 &&
      (canonicalFieldSlice?.xyMax ?? 0) > 0.005;
    if (canonicalPassiveBottomNonRiseProof) {
      if (!canonicalPassiveBottomFieldProof) {
        throw new Error(`passive bottom-source proof did not leave live smoke in the field readback: ${JSON.stringify({
          smokeWeight: sample.simReadback?.smokeWeight,
          xyActivePixelRatio: canonicalFieldSlice?.xyActivePixelRatio,
          xyMax: canonicalFieldSlice?.xyMax,
        })}`);
      }
    } else if (expectsNoFireVolumeEvidence) {
      const noFireVolumeSignalPixels =
        Number(metrics.litPixels || 0) +
        Number(metrics.smokeLikePixels || 0) +
        Number(metrics.volumeBounds?.pixelCount || 0);
      if (metrics.litPixels < 220 || noFireVolumeSignalPixels < 350 || metrics.meanLuma < 1.2) {
        throw new Error(`blank frame or missing no-fire volume signal: ${JSON.stringify({
          ...metrics,
          noFireVolumeSignalPixels,
        })}`);
      }
      if (visibleFirePixels > 260) {
        throw new Error(`no-fire volume evidence unexpectedly retained visible fire: ${JSON.stringify({
          visibleFirePixels,
          fireLikePixels: metrics.fireLikePixels,
          emissiveLikePixels: metrics.emissiveLikePixels,
        })}`);
      }
    } else if (expectsCanonicalPlumeProof) {
      if (
        metrics.litPixels < 220 ||
        (metrics.volumeBounds?.pixelCount ?? 0) < 180 ||
        metrics.verticalFillRatio < 0.12 ||
        metrics.meanLuma < 1.5
      ) {
        throw new Error(`blank frame or missing canonical smoke volume: ${JSON.stringify(metrics)}`);
      }
    } else if (expectsFuelStarvedTallPlume) {
      if (metrics.litPixels < 350 || metrics.smokeLikePixels < 120 || visibleFirePixels > 220) {
        throw new Error(`fuel-starved tall plume did not preserve smoke-only negative evidence: ${JSON.stringify(metrics)}`);
      }
    } else if (expectsSnuffVisualEvidence) {
      if (metrics.litPixels < 350 || metrics.smokeLikePixels < 120 || metrics.meanLuma < 1.5) {
        throw new Error(`snuff route did not preserve vapor/smoke volume evidence: ${JSON.stringify(metrics)}`);
      }
    } else if (expectsPyroMaterialEvidence) {
      const coupling = sample.pyroMaterialRendererCoupling || state.pyroMaterialRendererCoupling || {};
      const pyroVolumeSignalPixels =
        Number(metrics.litPixels || 0) +
        Number(metrics.smokeLikePixels || 0) +
        Number(metrics.fireLikePixels || 0) +
        Number(metrics.emissiveLikePixels || 0);
      if (
        coupling.identity !== 'pyro-material-memory-spatial-coupling-v0' ||
        coupling.spatialMemory?.identity !== 'pyro-material-memory-spatial-coupling-v0' ||
        !(coupling.spatialMemory?.uploadedCells > 0) ||
        !(coupling.effectiveGain > 0) ||
        coupling.materialShaderReadiness !== 'sampleable-debug-only'
      ) {
        throw new Error(`Pyro material evidence mode missing effective live spatial coupling: ${JSON.stringify(coupling)}`);
      }
      if (metrics.litPixels < 1000 || pyroVolumeSignalPixels < 1500 || metrics.meanLuma < 1.5) {
        throw new Error(`blank frame or missing Pyro material volume signal: ${JSON.stringify({
          ...metrics,
          pyroVolumeSignalPixels,
        })}`);
      }
    } else if (expectsPerformanceVolumeEvidence) {
      const volumeSignalPixels =
        Number(metrics.litPixels || 0) +
        Number(metrics.smokeLikePixels || 0) +
        Number(metrics.fireLikePixels || 0) +
        Number(metrics.emissiveLikePixels || 0);
      if (metrics.litPixels < 1000 || volumeSignalPixels < 1500 || metrics.meanLuma < 1.5) {
        throw new Error(`blank frame or missing performance volume signal: ${JSON.stringify({
          ...metrics,
          volumeSignalPixels,
        })}`);
      }
      if (visibleFirePixels < 450 || metrics.emissiveLikePixels < 80 || metrics.meanLuma < 8) {
        performanceVisualWarnings.push({
          code: 'low-fire-performance-evidence',
          note: 'Performance mode accepted a real smoke/flame volume frame whose fire beauty signal is below the normal operator-smoke gate.',
          litPixels: metrics.litPixels,
          visibleFirePixels,
          emissiveLikePixels: metrics.emissiveLikePixels,
          smokeLikePixels: metrics.smokeLikePixels,
          meanLuma: metrics.meanLuma,
        });
      }
    } else if (metrics.litPixels < 1500 || visibleFirePixels < 450 || metrics.emissiveLikePixels < 80 || metrics.meanLuma < 8) {
      throw new Error(`blank frame or missing fire volume: ${JSON.stringify(metrics)}`);
    }
    const reportControls = {
      ...(state.controls || {}),
      rayBudgetPreset: state.controls?.rayBudgetPreset || rayBudgetPreset,
    };
    const simReadbackReport = { ...(sample.simReadback || {}) };
    if (simReadbackReport.canonicalSmokeFieldSlice) {
      const { rgba, ...fieldSliceMetadata } = simReadbackReport.canonicalSmokeFieldSlice;
      simReadbackReport.canonicalSmokeFieldSlice = {
        ...fieldSliceMetadata,
        path: fieldSliceOut || null,
      };
    }
    const report = {
      requestedRoute: url,
      settleMs,
      windowSize,
      evidenceMode,
      visualEvidenceMode,
      noFireEvidenceMode: expectsNoFireVolumeEvidence ? 'no-fire-volume-signal' : null,
      pyroMaterialEvidenceMode: expectsPyroMaterialEvidence ? 'pyro-material-coupled-volume-signal' : null,
      pyroRawCarrierPaintEvidence,
      performanceVisualWarnings,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      volumeBridge: bridge,
      backend: state.backend,
      captureBackend,
      frameCount: state.frameCount,
      simStepCount: sample.simStepCount,
      simGrid: sample.simGrid,
      simGridLabel: sample.simGridLabel,
      frontFieldIdentity: sample.frontFieldIdentity,
      frontFieldBytes: sample.frontFieldBytes,
      frontFieldReadIndex: sample.frontFieldReadIndex,
      frontFieldWriteIndex: sample.frontFieldWriteIndex,
      frontFieldProjectionPassthrough: sample.frontFieldProjectionPassthrough,
      simReadback: simReadbackReport,
      fieldSliceBackend: 'cpu-fluid-buffer-readback',
      canonicalFieldSlice: simReadbackReport.canonicalSmokeFieldSlice || null,
      fieldSlice: fieldSliceOut || null,
      majorantReadback: sample.majorantReadback,
      canonicalPlumeControls: state.canonicalPlumeControls || null,
      gridOverlay: sample.gridOverlay,
      raySteps: state.controls?.raySteps,
      volumeScene: sample.volumeScene,
      expectedVolumeScene,
      adaptiveRaymarch: sample.adaptiveRaymarch,
      occupancySkip: sample.occupancySkip,
      majorantSkip: sample.majorantSkip,
      majorantSmooth: sample.majorantSmooth,
      majorantGuard: sample.majorantGuard,
      temporalAccum: sample.temporalAccum,
      temporalJitter: sample.temporalJitter,
      historyClamp: sample.historyClamp,
      fireScale: sample.fireScale,
      detailScale: sample.detailScale,
      detailScaleArtifactQuarantine: sample.detailScaleArtifactQuarantine,
      tallPlumeDetailFrequencySource: sample.tallPlumeDetailFrequencySource,
      visibleDetailOverlayGain: sample.visibleDetailOverlayGain,
      reactionFuelScale: sample.reactionFuelScale,
      lifecycleEffect: sample.lifecycleEffect,
      lifecycleT: sample.lifecycleT,
      quenchVapor: sample.quenchVapor,
      quenchVaporStrength: sample.quenchVaporStrength,
      snuffVisualModel: sample.snuffVisualModel,
      flameQuenchModel: sample.flameQuenchModel,
      pyroDynamicDetail: sample.pyroDynamicDetail || state.pyroDynamicDetail || null,
      pyroMaterialRendererCoupling: sample.pyroMaterialRendererCoupling || state.pyroMaterialRendererCoupling || null,
      runtimeQualityRequested: sample.runtimeQualityRequested,
      runtimeQualityEffective: sample.runtimeQualityEffective,
      gpuPressure: sample.gpuPressure,
      runtimeQualityReason: sample.runtimeQualityReason,
      runtimeQualityReceipt: sample.runtimeQualityReceipt,
      tallPlumeReactionCadenceDebug: sample.tallPlumeReactionCadenceDebug,
      tallPlumeFlameCutoffContract: sample.tallPlumeFlameCutoffContract,
      tallPlumeFlowShelfContract: sample.tallPlumeFlowShelfContract,
      tallPlumeFlameHeightLawContract: sample.tallPlumeFlameHeightLawContract,
      plumeHeight: sample.plumeHeight,
      speed: state.controls?.speed,
      windStrength: sample.windStrength,
      windAngle: sample.windAngle,
      windHeight: sample.windHeight,
      expectedTallPlumePreset,
      expectedWindDrift,
      expectedFireScale,
      expectedDetailScale,
      expectedDetailScaleArtifactQuarantine,
      expectedVisibleDetailOverlayGain,
      expectedReactionFuelScale,
      expectedLifecycleEffect,
      expectedLifecycleT,
      expectedQuenchVapor,
      expectedQuenchVaporStrength,
      expectedRuntimeQualityRequested,
      expectedRuntimeQualityEffective,
      expectedGpuPressure,
      expectedRuntimeQualityReason,
      expectedPlumeHeight,
      expectedCurl,
      expectedSpeed,
      expectedMicrodetail,
      expectedInterfaceShred,
      expectedFireLicks,
      expectedWindStrength,
      expectedWindAngle,
      expectedWindHeight,
      expectedBonfireRecenter,
      expectedBonfireLateralDamping,
      expectedBonfireShear,
      expectedBonfireDetailForces,
      expectedBonfireDepinch,
      expectedBonfireProjection,
      expectedBonfireTemporal,
      expectedBonfireInstabilityProbe,
      expectedEffectiveTemporalAccum,
      bonfireAblation: sample.bonfireAblation,
      bonfireReferenceConfinement: sample.bonfireReferenceConfinement,
      expectedRenderScale,
      renderScale: sample.renderScale,
      renderPixelRatio: sample.renderPixelRatio,
      displayWidth: sample.displayWidth,
      displayHeight: sample.displayHeight,
      renderWidth: sample.renderWidth,
      renderHeight: sample.renderHeight,
      volumeReconstructionStyle: sample.volumeReconstructionStyle,
      externalEmitterMode: sample.externalEmitterMode,
      externalEmitterCoordinateSpace: sample.externalEmitterCoordinateSpace,
      externalEmitterCount: sample.externalEmitterCount,
      externalEmitterAgeMs: sample.externalEmitterAgeMs,
      externalEmitterFrameId: sample.externalEmitterFrameId,
      volumePrimitiveCount: sample.volumePrimitiveCount,
      volumePrimitiveIds: sample.volumePrimitiveIds,
      volumePrimitives: sample.volumePrimitives,
      temporalAccumEffective: sample.temporalAccumEffective,
      temporalReprojectionConfidence: sample.temporalReprojectionConfidence,
      temporalHistoryWeight: sample.temporalHistoryWeight,
      temporalRejectedHistory: sample.temporalRejectedHistory,
      temporalSmokeHistoryTrust: sample.temporalSmokeHistoryTrust,
      temporalFireHistoryProtect: sample.temporalFireHistoryProtect,
      temporalInterfaceHistoryProtect: sample.temporalInterfaceHistoryProtect,
      temporalEvidenceSource: sample.temporalEvidenceSource,
      temporalHistoryFrames: sample.temporalHistoryFrames,
      temporalHistoryResetCount: sample.temporalHistoryResetCount,
      temporalHistoryResetReason: sample.temporalHistoryResetReason,
      temporalHistoryValid: sample.temporalHistoryValid,
      majorantGrid: sample.majorantGrid,
      majorantBuilt: sample.majorantBuilt,
      majorantCadence: sample.majorantCadence,
      majorantBuiltThisFrame: sample.majorantBuiltThisFrame,
      majorantLastBuiltFrame: sample.majorantLastBuiltFrame,
      majorantSkippedFrameCount: sample.majorantSkippedFrameCount,
      pressureProjectionEnabled: sample.pressureProjectionEnabled,
      pressureEffectiveLabel: sample.pressureEffectiveLabel,
      pressureProjectionIterations: sample.pressureProjectionIterations,
      pressureIterationDefault: sample.pressureIterationDefault,
      pressureIterationRequested: sample.pressureIterationRequested,
      pressureStrategy: sample.pressureStrategy,
      tallPlumePressureIterationStrategy: sample.tallPlumePressureIterationStrategy,
      tallPlumePressureIterationTarget: sample.tallPlumePressureIterationTarget,
      tallPlumePressureTierStrategy: sample.tallPlumePressureTierStrategy,
      pressureProjectionReadStrategy: sample.pressureProjectionReadStrategy,
      pressureJacobiFullGridPasses: sample.pressureJacobiFullGridPasses,
      pressureJacobiPartialSlabPasses: sample.pressureJacobiPartialSlabPasses,
      pressureJacobiFullGridEquivalentPasses: sample.pressureJacobiFullGridEquivalentPasses,
      pressureTierDispatches: sample.pressureTierDispatches,
      pressureTierBounds: sample.pressureTierBounds,
      pressureTierRequestedBounds: sample.pressureTierRequestedBounds,
      pressureTierEffectiveBounds: sample.pressureTierEffectiveBounds,
      pressureTierOverlayOpacity: sample.pressureTierOverlayOpacity,
      pressureTierBufferOwnership: sample.pressureTierBufferOwnership,
      simProfile: sample.simProfile,
      simCostLedger: sample.simCostLedger || state.simCostLedger || null,
      expectedMajorantCadence,
      expectedPressureIterations,
      expectedTallPlumePressureIterationStrategy: expectedTallPlumePressureStrategy,
      expectedPressureStrategy,
      expectedTallPlumePressureTierStrategy: expectedTallPlumePressureTierStrategyValue,
      expectedPressureProjectionReadStrategy,
      expectedSimProfile,
      rayBudgetPreset: reportControls.rayBudgetPreset,
      expectedCanonicalMacroPreset,
      expectedCanonicalSourceMode,
      expectedCanonicalRenderMode,
      expectedCanonicalMotionMode,
      expectedCanonicalContentMode,
      expectedCanonicalSourceY,
      expectedCanonicalInjection,
      expectedCanonicalBuoyancy,
      canonicalPassiveBottomNonRiseProof,
      canonicalPassiveBottomFieldProof,
      expectsCanonicalSmokeRise,
      expectsCanonicalFireEvidence,
      expectsNoFireVolumeEvidence,
      expectsPyroMaterialEvidence,
      timing: sample.timing || stateTiming,
      timingEvidenceSource: (sample.timing || stateTiming).timingEvidenceSource,
      timingDisclaimer: (sample.timing || stateTiming).timingDisclaimer,
      gpuTiming: sample.gpuTiming || state.gpuTiming || null,
      gpuPhaseTimings: sample.gpuPhaseTimings || state.gpuPhaseTimings || null,
      gpuTimingStats: sample.gpuTimingStats || state.gpuTimingStats || null,
      controls: reportControls,
      expectsMicrodetailEvidence,
      expectsCurlEvidence,
      expectsInterfaceShredEvidence,
      expectsFireLickEvidence,
      expectsFuelStarvedTallPlume,
      expectsBonfireVerticalTransport,
      expectsBonfireZeroDrift,
      expectsBonfireConvectionProof,
      screenshot: out,
      mainRendererScreenshot,
      mainRendererCaptureBackend: 'cdp-page-capture',
      fullScreenshot: fullScreenshotPath || null,
      fieldSliceScreenshot: fieldSliceOut || null,
      metrics,
      mainRendererMetrics,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    ws.close();
    proc.kill('SIGTERM');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    let state = null;
    try {
      const targets = await cdpFetch('/json/list');
      const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await waitForWebSocketOpen(ws);
        await wsRequest(ws, 'Page.enable');
        await captureViewportScreenshot(ws, fullScreenshot);
        const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: 'window.__kaminosVolumePrototype?.debugState?.()',
          returnByValue: true,
        });
        state = stateEval.result.value || null;
        ws.close();
      }
    } catch {
      state = null;
    }
    const report = {
      requestedRoute: url,
      windowSize,
      evidenceMode,
      visualEvidenceMode,
      phase,
      error: err?.message || String(err),
      state,
      screenshot: out,
      fullScreenshot: fullScreenshot || null,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    proc.kill('SIGTERM');
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

main();
