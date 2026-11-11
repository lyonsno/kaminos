// Actual page coefficient mapping over plain values; GPU and DOM owners stay outside.
import {REGION_CONTROL_FIELDS} from './volume-region-controls.mjs';
import {WORLD_CALIBRATION_FIELDS,SIMULATION_LEVER_FIELDS} from './volume-world-calibration.mjs';
import {applyPreviewQualityCaps} from './preview-quality.mjs';
import {readAdaptiveMaterialControls} from './volume-adaptive-material-controls.mjs';
import {normalizeVolumeScene} from './volume-scene-ontology.mjs';

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
const CANONICAL_VOLUME_LEGACY_MOTION_REQUEST_VALUES = {
  animated: 0,
  frozen: 1,
};
const CANONICAL_ANALYTIC_MOTION_RETIREMENT_IDENTITY = 'retired-analytic-canonical-motion-v0';
const CANONICAL_VOLUME_CONTENT_MODE_VALUES = {
  smoke: 0,
  fire: 1,
  fire_smoke: 2,
};

export const REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS = [
  { key: 'physicalKelvinPerHeat', id: 'volume-physical-kelvin-per-heat', param: 'volume_physical_kelvin_per_heat', min: 100, max: 6000, continuous: true, decimals: 0 },
  { key: 'physicalSootBurnoutRate', id: 'volume-physical-soot-burnout-rate', param: 'volume_physical_soot_burnout_rate', min: 0, max: 2, continuous: true, decimals: 3 },
  { key: 'physicalSootBurnoutKelvin', id: 'volume-physical-soot-burnout-kelvin', param: 'volume_physical_soot_burnout_kelvin', min: 600, max: 3000, continuous: true, decimals: 0 },
  { key: 'waveletTurbulence', id: 'volume-wavelet-turbulence', param: 'volume_wavelet_turbulence', min: 0, max: 1, continuous: true, decimals: 2 },
  { key: 'waveletOctaves', id: 'volume-wavelet-octaves', param: 'volume_wavelet_octaves', min: 1, max: 2, continuous: false, decimals: 0 },
  { key: 'waveletStrength', id: 'volume-wavelet-strength', param: 'volume_wavelet_strength', min: 0.25, max: 16, continuous: true, decimals: 2 },
  { key: 'waveletOctave1Weight', id: 'volume-wavelet-octave1-weight', param: 'volume_wavelet_octave1_weight', min: 0, max: 1, continuous: true, decimals: 2 },
  { key: 'waveletOctave2Weight', id: 'volume-wavelet-octave2-weight', param: 'volume_wavelet_octave2_weight', min: 0, max: 1, continuous: true, decimals: 2 },
  { key: 'physicalWhiteBalance', id: 'volume-physical-white', param: 'volume_physical_white', min: 2500, max: 10000, continuous: true, decimals: 0 },
  { key: 'physicalSmokeExtinction', id: 'volume-physical-smoke-extinction', param: 'volume_physical_smoke_extinction', min: 0, max: 10, continuous: true, decimals: 2 },
  { key: 'physicalSmokeAlbedo', id: 'volume-physical-smoke-albedo', param: 'volume_physical_smoke_albedo', min: 0, max: 1, continuous: true, decimals: 2 },
  { key: 'physicalAmbient', id: 'volume-physical-ambient', param: 'volume_physical_ambient', min: 0, max: 1, continuous: true, decimals: 3 },
  { key: 'physicalThermalStrength', id: 'volume-physical-thermal', param: 'volume_physical_thermal', min: 0, max: 40, continuous: true, decimals: 2 },
  { key: 'physicalCleanStrength', id: 'volume-physical-clean', param: 'volume_physical_clean', min: 0, max: 5, continuous: true, decimals: 3 },
  { key: 'physicalExposureEV', id: 'volume-physical-exposure', param: 'volume_physical_exposure', min: -8, max: 8, continuous: true, decimals: 2 },
  { key: 'physicalHighlightKnee', id: 'volume-physical-knee', param: 'volume_physical_knee', min: 0.1, max: 0.95, continuous: true, decimals: 2 },
  { key: 'boundarySidecarBlur', id: 'volume-boundary-sidecar-blur', param: 'volume_boundary_sidecar_blur', min: 0, max: 1, decimals: 2 },
  { key: 'boundarySidecarWidth', id: 'volume-boundary-sidecar-width', param: 'volume_boundary_sidecar_width', min: 0, max: 2, decimals: 2 },
  { key: 'boundarySidecarRidge', id: 'volume-boundary-sidecar-ridge', param: 'volume_boundary_sidecar_ridge', min: 0, max: 2, decimals: 2 },
  { key: 'flowKernelStrength', id: 'volume-flow-kernel-strength', param: 'volume_flow_kernel_strength', min: 0, max: 1, decimals: 2 },
  { key: 'flowKernelRadius', id: 'volume-flow-kernel-radius', param: 'volume_flow_kernel_radius', min: 0.0025, max: 0.12, decimals: 4 },
  { key: 'flowKernelCoherence', id: 'volume-flow-kernel-coherence', param: 'volume_flow_kernel_coherence', min: 0, max: 2, decimals: 2 },
  { key: 'reactionHeatMin', id: 'volume-reaction-heat-min', param: 'volume_reaction_heat_min', min: 0, max: 0.2, decimals: 3 },
  { key: 'reactionHeatMax', id: 'volume-reaction-heat-max', param: 'volume_reaction_heat_max', min: 0.04, max: 1.2, decimals: 2 },
  { key: 'reactionFuelMin', id: 'volume-reaction-fuel-min', param: 'volume_reaction_fuel_min', min: 0, max: 0.03, decimals: 4 },
  { key: 'reactionFuelMax', id: 'volume-reaction-fuel-max', param: 'volume_reaction_fuel_max', min: 0.005, max: 0.18, decimals: 3 },
  { key: 'reactionFlameMin', id: 'volume-reaction-flame-min', param: 'volume_reaction_flame_min', min: 0, max: 0.04, decimals: 4 },
  { key: 'reactionFlameMax', id: 'volume-reaction-flame-max', param: 'volume_reaction_flame_max', min: 0.02, max: 0.35, decimals: 3 },
  { key: 'reactionFrontMin', id: 'volume-reaction-front-min', param: 'volume_reaction_front_min', min: 0, max: 0.04, decimals: 4 },
  { key: 'reactionFrontMax', id: 'volume-reaction-front-max', param: 'volume_reaction_front_max', min: 0.01, max: 0.25, decimals: 3 },
  { key: 'reactionGradientMin', id: 'volume-reaction-gradient-min', param: 'volume_reaction_gradient_min', min: 0, max: 0.12, decimals: 3 },
  { key: 'reactionGradientMax', id: 'volume-reaction-gradient-max', param: 'volume_reaction_gradient_max', min: 0.03, max: 0.6, decimals: 3 },
  { key: 'reactionCoreMin', id: 'volume-reaction-core-min', param: 'volume_reaction_core_min', min: 0, max: 0.7, decimals: 2 },
  { key: 'reactionCoreMax', id: 'volume-reaction-core-max', param: 'volume_reaction_core_max', min: 0.15, max: 1.6, decimals: 2 },
  { key: 'reactionCoreReject', id: 'volume-reaction-core-reject', param: 'volume_reaction_core_reject', min: 0, max: 1, decimals: 2 },
  { key: 'reactionTopologyGain', id: 'volume-reaction-topology-gain', param: 'volume_reaction_topology_gain', min: 0, max: 2.5, decimals: 2 },
  { key: 'reactionStretchErode', id: 'volume-reaction-stretch-erode', param: 'volume_reaction_stretch_erode', min: 0, max: 1, decimals: 2 },
  { key: 'reactionDivergenceMin', id: 'volume-reaction-divergence-min', param: 'volume_reaction_divergence_min', min: 0, max: 0.08, decimals: 3 },
  { key: 'reactionDivergenceMax', id: 'volume-reaction-divergence-max', param: 'volume_reaction_divergence_max', min: 0.01, max: 0.2, decimals: 3 },
  { key: 'reactionDivergenceGain', id: 'volume-reaction-divergence-gain', param: 'volume_reaction_divergence_gain', min: 0, max: 1, decimals: 2 },
  { key: 'reactionCurlWarp', id: 'volume-reaction-curl-warp', param: 'volume_reaction_curl_warp', min: 0, max: 3, decimals: 2 },
];

const REACTION_FRONT_LIVE_VIEW_VALUES = new Set(['off', 'shell', 'thermal', 'reaction', 'front', 'edge', 'core', 'curl', 'divergence', 'boundary', 'boundary_fire']);
const BOUNDARY_SIDECAR_SOURCE_VALUES = new Set(['live', 'baked', 'mix', 'override']);
const BOUNDARY_SIDECAR_VIEW_VALUES = new Set(['off', 'support', 'coverage', 'ridge', 'proximity', 'footprint']);
const BOUNDARY_SPLAT_MODE_VALUES = new Set([
  'off',
  'analytic',
  'learned',
  'analytic_conserved',
  'learned_conserved',
  'world_covariance',
  'kernel_moment_covariance',
  'kernel_moment_full_flame_union',
]);

export function normalizeReactionFrontLiveView(value) {
  const mode = String(value || 'off').toLowerCase().replace(/-/g, '_');
  return REACTION_FRONT_LIVE_VIEW_VALUES.has(mode) ? mode : 'off';
}

export function normalizeBoundarySidecarSource(value) {
  const mode = String(value || 'live').toLowerCase().replace(/-/g, '_');
  return BOUNDARY_SIDECAR_SOURCE_VALUES.has(mode) ? mode : 'live';
}

export function normalizeBoundarySidecarView(value) {
  const mode = String(value || 'off').toLowerCase().replace(/-/g, '_');
  return BOUNDARY_SIDECAR_VIEW_VALUES.has(mode) ? mode : 'off';
}

export function normalizeBoundarySplatMode(value) {
  const mode = String(value || 'off').toLowerCase().replace(/-/g, '_');
  return BOUNDARY_SPLAT_MODE_VALUES.has(mode) ? mode : 'off';
}

const VOLUME_LEGACY_PYRO_BACKOFF = {
  pyroCompareMode: 'base',
  pyroDynamicDetail: 0,
  pyroMaterialGain: 0,
  pyroInterfaceFocus: 0,
  pyroEdgeBite: 0,
  pyroBiteBorder: 0,
  pyroBiteTeeth: 0,
  pyroBiteWake: 0,
  pyroBiteHeight: 0,
  pyroBiteFireLock: 1,
  pyroBiteCore: 0,
  pyroBiteCoreCut: 1,
  pyroBiteRim: 0,
  pyroBiteRimCut: 1,
  pyroBiteAfter: 0,
  pyroBiteAfterCut: 1,
  pyroFireMode: 'stock',
  pyroFlamePaint: 0,
  pyroStockMix: 1,
  pyroFlameLuma: 1,
  pyroBiteHeat: 0,
  pyroBiteChroma: 0,
  pyroBiteLuma: 1,
  pyroSmokeFold: 0,
  pyroFoldBorder: 0,
  pyroFoldWake: 0,
  pyroWakeLift: 0,
  pyroWakeWarmth: 0,
  pyroWakeLuma: 1,
  pyroRadiance: 0,
  pyroRadianceGate: 1,
  pyroRadianceSpill: 0,
  pyroRadianceWarmth: 0,
  pyroRadianceHue: 0.5,
  pyroRadianceChroma: 0,
  pyroRadianceLuma: 1,
  pyroRadianceSource: 'fire',
  pyroRadianceHeight: 0,
  pyroRadianceBorder: 0,
  pyroRadianceTeeth: 0,
  pyroRadianceRise: 0,
  pyroRadianceFireLock: 1,
  pyroFlowBite: 0,
  pyroFlowBorder: 0,
  pyroFlowTeeth: 0,
  pyroFlowRise: 0,
  pyroFlowFireLock: 1,
  pyroFlowLuma: 1,
  pyroFlowRadiance: 0,
  pyroFlowSpikes: 0,
  pyroDiagnosticPaint: 0,
  pyroCarrierView: 'normal',
  pyroOverdrive: 1,
};

function backOffVolumeLegacyPyroControls(controls) {
  return {
    ...controls,
    ...VOLUME_LEGACY_PYRO_BACKOFF,
    legacyPyroBackedOff: true,
  };
}


function clampVolumeValue(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}
export function normalizeVolumeRuntimeQuality(value) {
  const normalized = String(value || 'live_high').toLowerCase().replace(/-/g, '_');
  if (['live_high', 'live', 'high', 'hero', 'default'].includes(normalized)) return 'live_high';
  if (['live_low', 'low', 'degraded', 'throttled'].includes(normalized)) return 'live_low';
  if (['holdover', 'hold', 'paused', 'freeze', 'frozen'].includes(normalized)) return 'holdover';
  if (['impostor', 'imposter', 'emergency', 'fallback', 'prerender'].includes(normalized)) return 'impostor';
  if (normalized === 'auto') return 'auto';
  return 'live_high';
}

export function normalizeVolumeQualityReason(value) {
  const raw = String(value || 'unspecified').trim();
  return raw.slice(0, 96) || 'unspecified';
}

export function volumeRuntimeQualityFromPressure(requested, gpuPressure) {
  const normalized = normalizeVolumeRuntimeQuality(requested);
  if (normalized !== 'auto') return normalized;
  const pressure = clampVolumeValue(gpuPressure, 0, 1);
  if (pressure >= 0.90) return 'impostor';
  if (pressure >= 0.70) return 'holdover';
  if (pressure >= 0.45) return 'live_low';
  return 'live_high';
}

export function applyVolumeRuntimeQualityLadder(controls) {
  const requested = normalizeVolumeRuntimeQuality(controls.runtimeQualityRequested);
  const gpuPressure = clampVolumeValue(controls.gpuPressure, 0, 1);
  const effective = volumeRuntimeQualityFromPressure(requested, gpuPressure);
  const next = {
    ...controls,
    runtimeQualityRequested: requested,
    runtimeQualityEffective: effective,
    runtimeQualityReason: normalizeVolumeQualityReason(controls.runtimeQualityReason),
    gpuPressure,
  };
  const changed = [];
  const cap = (key, limit) => {
    const current = Number(next[key]);
    if (Number.isFinite(current) && current > limit) {
      next[key] = limit;
      changed.push(key);
    }
  };
  const floor = (key, limit) => {
    const current = Number(next[key]);
    if (Number.isFinite(current) && current < limit) {
      next[key] = limit;
      changed.push(key);
    }
  };
  if (effective === 'live_low') {
    cap('renderScale', 0.75);
    cap('raySteps', 96);
    floor('adaptiveRays', 0.45);
  } else if (effective === 'holdover') {
    cap('renderScale', 0.70);
    cap('raySteps', 72);
    floor('adaptiveRays', 0.65);
    floor('occupancySkip', 0.25);
    next.pressureStrategy = 'global';
    next.pressureIterations = Math.min(1, Number.isFinite(Number(next.pressureIterations)) ? Number(next.pressureIterations) : 1);
    changed.push('pressureStrategy', 'pressureIterations');
  } else if (effective === 'impostor') {
    cap('renderScale', 0.60);
    cap('raySteps', 48);
    floor('adaptiveRays', 0.85);
    floor('occupancySkip', 0.45);
    next.pressureStrategy = 'global';
    next.pressureIterations = 0;
    changed.push('pressureStrategy', 'pressureIterations');
  }
  // Viewport Preview composes with whichever tier is in effect: it caps the
  // raymarch only, so the tier's simulation settings stand.
  const viewportPreview = next.viewportPreview === true;
  if (viewportPreview) {
    const preview = applyPreviewQualityCaps(next);
    Object.assign(next, preview.controls);
    changed.push(...preview.changed);
  }
  next.runtimeQualityReceipt = {
    identity: 'volume-runtime-quality-ladder-v0',
    requested,
    effective,
    viewportPreview,
    reason: next.runtimeQualityReason,
    gpuPressure,
    changedControls: [...new Set(changed)].sort(),
    knobs: {
      renderScale: next.renderScale,
      raySteps: next.raySteps,
      adaptiveRays: next.adaptiveRays,
      occupancySkip: next.occupancySkip,
      pressureStrategy: next.pressureStrategy,
      pressureIterations: next.pressureIterations,
    },
  };
  return next;
}
function normalizeVolumePressureMode(value) {
  const mode = String(value || 'auto').toLowerCase();
  return ['auto', 'spatial-tiers', 'global-p3', 'global-p2', 'global-p1', 'routed-global'].includes(mode) ? mode : 'auto';
}
function defaultVolumePressureIterationsForScene(scene) {
  return 2;
}
export function volumePressureConfigForMode(mode, scene, {routedVolumePressureIterations,routedVolumePressureStrategy} = {}) {
  const defaultIterations = defaultVolumePressureIterationsForScene(scene);
  switch (normalizeVolumePressureMode(mode)) {
    case 'spatial-tiers':
      return { pressureMode: 'spatial-tiers', pressureStrategy: 'spatial_tiers', pressureIterations: 3, effectivePressureIterations: 3, pressureEffectiveLabel: 'Tiered P3' };
    case 'global-p3':
      return { pressureMode: 'global-p3', pressureStrategy: 'global', pressureIterations: 3, effectivePressureIterations: 3, pressureEffectiveLabel: 'Full P3' };
    case 'global-p2':
      return { pressureMode: 'global-p2', pressureStrategy: 'global', pressureIterations: 2, effectivePressureIterations: 2, pressureEffectiveLabel: 'Full P2' };
    case 'global-p1':
      return { pressureMode: 'global-p1', pressureStrategy: 'global', pressureIterations: 1, effectivePressureIterations: 1, pressureEffectiveLabel: 'Full P1' };
    case 'routed-global':
      {
        const effectiveIterations = routedVolumePressureIterations ?? defaultIterations;
        return {
          pressureMode: 'routed-global',
          pressureStrategy: 'global',
          pressureIterations: effectiveIterations,
          effectivePressureIterations: effectiveIterations,
          pressureEffectiveLabel: effectivePressureModeLabel('routed-global', effectiveIterations),
        };
      }
    default:
      {
        const effectiveIterations = routedVolumePressureIterations ?? defaultIterations;
        const effectiveStrategy = routedVolumePressureStrategy || 'global';
        return {
          pressureMode: 'auto',
          pressureStrategy: effectiveStrategy,
          pressureIterations: routedVolumePressureIterations,
          effectivePressureIterations: effectiveStrategy === 'spatial_tiers' ? 3 : effectiveIterations,
          pressureEffectiveLabel: effectivePressureModeLabel('auto', effectiveStrategy === 'spatial_tiers' ? 3 : effectiveIterations),
        };
      }
  }
}
function effectivePressureModeLabel(mode, effectiveIterations) {
  switch (normalizeVolumePressureMode(mode)) {
    case 'spatial-tiers': return 'Tiered P3';
    case 'global-p3': return 'Full P3';
    case 'global-p2': return 'Full P2';
    case 'global-p1': return 'Full P1';
    case 'routed-global': return `Route P${effectiveIterations}`;
    default: return `Default P${effectiveIterations}`;
  }
}
function normalizeVolumeHexColor(value, fallback = '#ffffff') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return fallback;
}
function readVolumeRenderScaleControlValue(control) {
  const value=Number(control?.value);
  return Number.isFinite(value)?Math.max(.1,Math.min(1,value)):.3;
}
function aperturePatternValue(select) {
  return select.value === 'shape' && select.requestedValue ? select.requestedValue : select.value;
}
export function readVolumeRuntimeControlValues({readControl,quality='full',params=new URLSearchParams(),lightFieldParams=params,route,adaptiveMaterial=null}={}) {
 if(typeof readControl!=='function'||!route)throw Error('Volume controls require plain values and current route state');
 const {activeVolumeRayBudgetPreset,routedVolumeRayBudgetPreset,activeCanonicalVolumeMacroPreset,routedCanonicalSourceMode,routedCanonicalRenderMode,routedCanonicalMotionMode,routedCanonicalContentMode,routedCanonicalSourceY,routedCanonicalInjection,routedCanonicalBuoyancy,routedVolumeReactionFuelScale,routedVolumePressureIterations,routedVolumePressureStrategy,routedVolumePressureMode,routedVolumeSimProfile,routedVolumeLifecycleEffect,routedVolumeLifecycleT,routedVolumeQuenchVapor,routedVolumeRuntimeQuality,routedVolumeGpuPressure,routedVolumeQualityReason,routedBonfireAblationControls}=route;
  const volumeScene = readControl('volume-scene').value;
  const volumeSceneRequested = readControl('volume-scene').requestedValue || volumeScene;
  const pressureConfig = volumePressureConfigForMode(readControl('volume-pressure-mode').value, volumeScene, route);
  const reactionLiveView = normalizeReactionFrontLiveView(readControl('volume-reaction-live-view')?.value);
  const boundarySidecarSource = normalizeBoundarySidecarSource(readControl('volume-boundary-sidecar-source')?.value);
  const boundarySidecarView = normalizeBoundarySidecarView(readControl('volume-boundary-sidecar-view')?.value);
  const boundarySplatMode = normalizeBoundarySplatMode('off');
  const boundarySplatFeatureCapture = ['1', 'true', 'on'].includes(String(params.get('volume_boundary_splat_feature_capture') || '').toLowerCase());
  const flowKernelDescriptorCapture = ['1', 'true', 'on'].includes(String(params.get('volume_flow_kernel_descriptor_capture') || '').toLowerCase());
  const boundarySplatInstanceConsumer = ['1', 'true', 'on'].includes(String(params.get('volume_boundary_splat_instance_consumer') || '').toLowerCase());
  const boundarySplatInstances = Math.max(1, Math.min(128, Math.round(Number(params.get('volume_boundary_splat_instances') || 1))));
  const reactionBoundaryControls = {
    identity: 'reaction-boundary-live-controls-v0',
    gradientGain: 2.6,
    supportThermal: 0.1,
    supportReaction: 0.26,
    supportFront: 1.6,
    supportInterface: 1.46,
    cut: 0.3,
    softness: 0.08,
    coreReject: 0.92,
    topologyGain: 0.9,
    curlGain: 0.7,
    divergenceGain: 0.05,
    displayContrast: 1.35,
    displayGamma: 1.05,
    displayOpacity: 0.7,
  };
  const reactionBoundaryFireControls = {
    identity: 'reaction-boundary-fire-controls-v0',
    ridgeGain: 1.76,
    ridgeCut: 0.04,
    tipBreakup: 1.8,
    topologyErosion: 0.55,
    cleanBlue: 0.9,
    sootYield: 0.72,
    sootYellowing: 0.28,
    thermalWarmth: 0.3,
    fireLuma: 1.05,
    cleanColor: normalizeVolumeHexColor('#4a86ff', '#4a86ff'),
    sootColor: normalizeVolumeHexColor('#ffc460', '#ffc460'),
  };
  return backOffVolumeLegacyPyroControls(applyVolumeRuntimeQualityLadder({
    volumeScene,
    volumeSceneRequested,
    ...Object.fromEntries(REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS.filter(field => field.key.startsWith('physical') || field.key.startsWith('wavelet')).map(field => [field.key, Number(readControl(field.id).value)])),
    artisticSwirl: readControl('volume-artistic-swirl').checked,
    phasedSway: readControl('volume-phased-sway').checked,
    // The procedural-force switches were retired 2026-10-22: Microdetail and
    // Shred are their own switches; Swirl jostle sets the fine force's strength.
    proceduralDetailForces: true,
    swirlJostle: parseFloat(readControl('volume-swirl-jostle').value),
    fineBreakupLocalization: parseFloat(readControl('volume-fine-breakup-localization').value),
    commonGasTransport: readControl('volume-common-gas-transport').checked,
    volumeExposure: 1,
    density: parseFloat(readControl('volume-density').value),
    fire: 1.4, // retired 2026-10-21: legacy raymarch flame gain only
    radiance: 1.65,
    absorption: 0.85, // retired 2026-10-21: legacy renderer only
    glow: 1.15,
    smoke: 2.8, // retired 2026-10-21: no effect under the Physics law
    curl: parseFloat(readControl('volume-curl').value),
    microdetail: parseFloat(readControl('volume-microdetail').value),
    interfaceShred: parseFloat(readControl('volume-interface-shred').value),
    fireLicks: parseFloat(readControl('volume-fire-licks').value),
    projection: parseFloat(readControl('volume-projection').value),
    speed: parseFloat(readControl('volume-speed').value),
    raySteps: parseFloat(readControl('volume-steps').value),
    adaptiveRays: parseFloat(readControl('volume-adaptive-rays').value),
    occupancySkip: parseFloat(readControl('volume-occupancy-skip').value),
    fireScale: parseFloat(readControl('volume-fire-scale').value),
    detailScale: 1.75, // retired 2026-10-21: the single Flame simulator fixes the detail frequency
    plumeHeight: parseFloat(readControl('volume-plume-height').value),
    windStrength: parseFloat(readControl('volume-wind-strength').value),
    windAngle: parseFloat(readControl('volume-wind-angle').value),
    windHeight: parseFloat(readControl('volume-wind-height').value),
    windModel: readControl('volume-wind-model').value,
    windGust: parseFloat(readControl('volume-wind-gust').value),
    windGustPeriod: parseFloat(readControl('volume-wind-gust-period').value),
    windGustVeer: parseFloat(readControl('volume-wind-gust-veer').value),
    renderScale: readVolumeRenderScaleControlValue(readControl('volume-render-scale')),
    inputRadius: parseFloat(readControl('volume-input-radius').value),
    flowRate: parseFloat(readControl('volume-flow-rate').value),
    emitterSourceLaw: readControl('volume-emitter-source-law').value,
    emitterSourceDepth: parseFloat(readControl('volume-emitter-source-depth').value),
    emitterInletProfile: readControl('volume-emitter-inlet-profile').value,
    emitterMomentumLinked: readControl('volume-emitter-momentum-linked').checked,
    emitterInletVelocity: parseFloat(readControl('volume-emitter-inlet-velocity').value),
    emitterShearWidthCells: parseFloat(readControl('volume-emitter-shear-width').value),
    emitterEdgeEntrainment: parseFloat(readControl('volume-emitter-edge-entrainment').value),
    emitterFuelFraction: parseFloat(readControl('volume-emitter-fuel-fraction').value),
    emitterInletTemperature: parseFloat(readControl('volume-emitter-inlet-temperature').value),
    emitterAperturePattern: aperturePatternValue(readControl('volume-emitter-aperture-pattern')),
    emitterApertureCount: parseFloat(readControl('volume-emitter-aperture-count').value),
    emitterApertureRatio: parseFloat(readControl('volume-emitter-aperture-ratio').value),
    emitterApertureSeed: parseFloat(readControl('volume-emitter-aperture-seed').value),
    emitterSwirl: parseFloat(readControl('volume-emitter-swirl').value),
    emitterLineWeight: parseFloat(readControl('volume-emitter-line-weight').value),
    emitterJetJitter: parseFloat(readControl('volume-emitter-jet-jitter').value),
    emitterInletTurbulence: parseFloat(readControl('volume-emitter-inlet-turbulence').value),
    emitterInletTurbulenceScale: parseFloat(readControl('volume-emitter-inlet-turbulence-scale').value),
    emitterPuff: parseFloat(readControl('volume-emitter-puff').value),
    emitterPuffPeriod: parseFloat(readControl('volume-emitter-puff-period').value),
    fixedSourceDephase: readControl('volume-fixed-source-dephase').checked,
    reactionLiveView,
    reactionLiveViewIdentity: 'reaction-live-view-shader-inspect-v0',
    boundarySidecarSource,
    boundarySidecarView,
    boundarySplatMode,
    boundarySplatFeatureCapture,
    flowKernelDescriptorCapture,
    boundarySplatInstanceConsumer,
    boundarySplatInstances,
    boundarySplatRadius: 1,
    boundarySplatSharpness: 3.4,
    flowKernelStrength: parseFloat(readControl('volume-flow-kernel-strength').value),
    flowKernelRadius: parseFloat(readControl('volume-flow-kernel-radius').value),
    flowKernelCoherence: parseFloat(readControl('volume-flow-kernel-coherence').value),
    toneMapping: readControl('volume-tone-mapping').value,
    raymarchMode: readControl('volume-raymarch-mode').value,
    opticalTolerance: Number(readControl('volume-optical-tolerance').value),
    rayStepTelemetry: readControl('volume-ray-step-telemetry').checked,
    rayStartNoise: readControl('volume-ray-start-noise').checked,
    rayNoiseAnimated: readControl('volume-ray-noise-animated').checked,
    quadratureJitter: readControl('volume-quadrature-jitter').checked,
    displayReconstruction: readControl('volume-display-reconstruction').value,
    displayGridScale: Number(readControl('volume-display-grid-scale').value),
    displayAlignment: readControl('volume-display-alignment').value,
    emissionInterpolation: readControl('volume-emission-interpolation').value,
    smokeInterpolation: readControl('volume-smoke-interpolation').value,
    emissionSmoothing: Number(readControl('volume-emission-smoothing').value),
    smokeSmoothing: Number(readControl('volume-smoke-smoothing').value),
    flamePriority: Number(readControl('volume-flame-priority').value),
    boundarySidecarControls: {
      identity: 'baked-boundary-sidecar-v0',
      authority: 'band-limited-support-coverage-ridge-proximity-footprint-v1',
      source: boundarySidecarSource,
      view: boundarySidecarView,
      blur: parseFloat(readControl('volume-boundary-sidecar-blur').value),
      stepWidth: parseFloat(readControl('volume-boundary-sidecar-width').value),
      ridgeGain: parseFloat(readControl('volume-boundary-sidecar-ridge').value),
    },
    reactionBoundaryControls: {
      identity: reactionBoundaryControls.identity,
      gradientGain: reactionBoundaryControls.gradientGain,
      supportThermal: reactionBoundaryControls.supportThermal,
      supportReaction: reactionBoundaryControls.supportReaction,
      supportFront: reactionBoundaryControls.supportFront,
      supportInterface: reactionBoundaryControls.supportInterface,
      cut: reactionBoundaryControls.cut,
      softness: reactionBoundaryControls.softness,
      coreReject: reactionBoundaryControls.coreReject,
      topologyGain: reactionBoundaryControls.topologyGain,
      curlGain: reactionBoundaryControls.curlGain,
      divergenceGain: reactionBoundaryControls.divergenceGain,
      displayContrast: reactionBoundaryControls.displayContrast,
      displayGamma: reactionBoundaryControls.displayGamma,
      displayOpacity: reactionBoundaryControls.displayOpacity,
    },
    reactionBoundaryFireControls: {
      identity: reactionBoundaryFireControls.identity,
      ridgeGain: reactionBoundaryFireControls.ridgeGain,
      ridgeCut: reactionBoundaryFireControls.ridgeCut,
      tipBreakup: reactionBoundaryFireControls.tipBreakup,
      topologyErosion: reactionBoundaryFireControls.topologyErosion,
      cleanBlue: reactionBoundaryFireControls.cleanBlue,
      sootYield: reactionBoundaryFireControls.sootYield,
      sootYellowing: reactionBoundaryFireControls.sootYellowing,
      thermalWarmth: reactionBoundaryFireControls.thermalWarmth,
      fireLuma: reactionBoundaryFireControls.fireLuma,
      cleanColor: reactionBoundaryFireControls.cleanColor,
      sootColor: reactionBoundaryFireControls.sootColor,
    },
    reactionBoundaryGradient: reactionBoundaryControls.gradientGain,
    reactionBoundarySupportThermal: reactionBoundaryControls.supportThermal,
    reactionBoundarySupportReaction: reactionBoundaryControls.supportReaction,
    reactionBoundarySupportFront: reactionBoundaryControls.supportFront,
    reactionBoundarySupportInterface: reactionBoundaryControls.supportInterface,
    reactionBoundaryCut: reactionBoundaryControls.cut,
    reactionBoundarySoftness: reactionBoundaryControls.softness,
    reactionBoundaryCoreReject: reactionBoundaryControls.coreReject,
    reactionBoundaryTopology: reactionBoundaryControls.topologyGain,
    reactionBoundaryCurl: reactionBoundaryControls.curlGain,
    reactionBoundaryDivergence: reactionBoundaryControls.divergenceGain,
    reactionBoundaryContrast: reactionBoundaryControls.displayContrast,
    reactionBoundaryGamma: reactionBoundaryControls.displayGamma,
    reactionBoundaryOpacity: reactionBoundaryControls.displayOpacity,
    reactionBoundaryFireRidge: reactionBoundaryFireControls.ridgeGain,
    reactionBoundaryFireRidgeCut: reactionBoundaryFireControls.ridgeCut,
    reactionBoundaryFireTip: reactionBoundaryFireControls.tipBreakup,
    reactionBoundaryFireErosion: reactionBoundaryFireControls.topologyErosion,
    reactionBoundaryFireCleanBlue: reactionBoundaryFireControls.cleanBlue,
    reactionBoundaryFireSoot: reactionBoundaryFireControls.sootYield,
    reactionBoundaryFireYellow: reactionBoundaryFireControls.sootYellowing,
    reactionBoundaryFireWarmth: reactionBoundaryFireControls.thermalWarmth,
    reactionBoundaryFireLuma: reactionBoundaryFireControls.fireLuma,
    reactionBoundaryFireCleanColor: reactionBoundaryFireControls.cleanColor,
    reactionBoundaryFireSootColor: reactionBoundaryFireControls.sootColor,
    boundarySidecarBlur: parseFloat(readControl('volume-boundary-sidecar-blur').value),
    boundarySidecarWidth: parseFloat(readControl('volume-boundary-sidecar-width').value),
    boundarySidecarRidge: parseFloat(readControl('volume-boundary-sidecar-ridge').value),
    fireRenderMode: reactionLiveView !== 'off' ? 'inspect' : 'inspect',
    shellInspectMode: reactionLiveView !== 'off' ? reactionLiveView : 'boundary_fire',
    shellAmount: 1.1,
    shellWidth: 0.9,
    shellThermal: 0.85,
    shellReaction: 1.1,
    shellFront: 1.25,
    shellEdge: 0.85,
    shellCoreSuppress: 0.55,
    shellBite: 0.8,
    shellCurl: 0.25,
    shellHeat: 1.65,
    shellDivergence: 0,
    shellLuma: 1.35,
    shellExposure: 1.15,
    shellSoftClip: 1.6,
    shellSmoke: 0.25,
    resolution: parseInt(readControl('volume-resolution').value, 10),
    gridHeightRatio: parseFloat(readControl('volume-grid-height-ratio').value) || 2,
    volumeResidualMode: readControl('volume-residual-mode').value || 'off',
    volumeResidualModelUrl: readControl('volume-residual-model-url').value || '',
    volumeResidualStrength: parseFloat(readControl('volume-residual-strength').value),
    volumeResidualFeatureDebug: parseFloat(readControl('volume-residual-feature-debug').value),
    gridOverlay: parseFloat(readControl('volume-grid-overlay').value),
    flowDebug: parseFloat(readControl('volume-flow-debug').value),
    oracleActivityCue: parseFloat(readControl('volume-oracle-activity-cue').value),
    oracleActivityDisplay: parseFloat(readControl('volume-oracle-activity-display').value),
    oracleActivityCurlNoise: parseFloat(readControl('volume-oracle-activity-curl-noise').value),
    oracleActivityVorticity: parseFloat(readControl('volume-oracle-activity-vorticity').value),
    oracleActivityMaterial: parseFloat(readControl('volume-oracle-activity-material').value),
    lookFreeze: parseFloat(readControl('volume-look-freeze').value),
    fireLightField: lightFieldParams.get('volume_light_field') === '1',
    fireProbe: parseInt(params.get('volume_fire_probe') || '', 10) || 0,
    fireLightFieldGrid: parseInt(lightFieldParams.get('volume_light_field_grid') || '', 10) || undefined,
    reactionHeatMin: parseFloat(readControl('volume-reaction-heat-min').value),
    reactionHeatMax: parseFloat(readControl('volume-reaction-heat-max').value),
    reactionFuelMin: parseFloat(readControl('volume-reaction-fuel-min').value),
    reactionFuelMax: parseFloat(readControl('volume-reaction-fuel-max').value),
    reactionFlameMin: parseFloat(readControl('volume-reaction-flame-min').value),
    reactionFlameMax: parseFloat(readControl('volume-reaction-flame-max').value),
    reactionFrontMin: parseFloat(readControl('volume-reaction-front-min').value),
    reactionFrontMax: parseFloat(readControl('volume-reaction-front-max').value),
    reactionGradientMin: parseFloat(readControl('volume-reaction-gradient-min').value),
    reactionGradientMax: parseFloat(readControl('volume-reaction-gradient-max').value),
    reactionCoreMin: parseFloat(readControl('volume-reaction-core-min').value),
    reactionCoreMax: parseFloat(readControl('volume-reaction-core-max').value),
    reactionCoreReject: parseFloat(readControl('volume-reaction-core-reject').value),
    reactionTopologyGain: parseFloat(readControl('volume-reaction-topology-gain').value),
    reactionStretchErode: parseFloat(readControl('volume-reaction-stretch-erode').value),
    reactionDivergenceMin: parseFloat(readControl('volume-reaction-divergence-min').value),
    reactionDivergenceMax: parseFloat(readControl('volume-reaction-divergence-max').value),
    reactionDivergenceGain: parseFloat(readControl('volume-reaction-divergence-gain').value),
    reactionCurlWarp: parseFloat(readControl('volume-reaction-curl-warp').value),
    reactionShellGamma: 1,
    reactionShellContrast: 1,
    pyroCompareMode: 'live',
    pyroDynamicDetail: 0,
    pyroMaterialGain: 0,
    pyroInterfaceFocus: 0.75,
    pyroEdgeBite: 0.35,
    pyroBiteBorder: 0.45,
    pyroBiteTeeth: 0.55,
    pyroBiteWake: 0.25,
    pyroBiteHeight: 0.35,
    pyroBiteFireLock: 0.75,
    pyroBiteCore: 0,
    pyroBiteCoreCut: 0.45,
    pyroBiteRim: 0,
    pyroBiteRimCut: 0.55,
    pyroBiteAfter: 0,
    pyroBiteAfterCut: 0.5,
    pyroFireMode: 'pyro-owned',
    pyroFlamePaint: 0,
    pyroStockMix: 1,
    pyroFlameLuma: 1,
    pyroFlameCoreColor: normalizeVolumeHexColor('#fff4b8', '#fff4b8'),
    pyroFlameEdgeColor: normalizeVolumeHexColor('#ff8a24', '#ff8a24'),
    pyroBiteHeat: 0.65,
    pyroBiteChroma: 0.55,
    pyroBiteLuma: 1,
    pyroBiteEmberColor: normalizeVolumeHexColor('#e65a1a', '#e65a1a'),
    pyroBiteHotColor: normalizeVolumeHexColor('#fff4b8', '#fff4b8'),
    pyroSmokeFold: 0.25,
    pyroFoldBorder: 0.35,
    pyroFoldWake: 0.35,
    pyroWakeLift: 0.45,
    pyroWakeWarmth: 0.35,
    pyroWakeLuma: 1,
    pyroWakeShadowColor: normalizeVolumeHexColor('#384c50', '#384c50'),
    pyroWakeEmberColor: normalizeVolumeHexColor('#b06a2a', '#b06a2a'),
    pyroRadiance: 0,
    pyroRadianceGate: 0.62,
    pyroRadianceSpill: 0.3,
    pyroRadianceWarmth: 0.45,
    pyroRadianceHue: 0.5,
    pyroRadianceChroma: 0.55,
    pyroRadianceLuma: 1,
    pyroRadianceCoolColor: normalizeVolumeHexColor('#7aa8b8', '#7aa8b8'),
    pyroRadianceWarmColor: normalizeVolumeHexColor('#d18438', '#d18438'),
    pyroRadianceSource: 'fire',
    pyroRadianceHeight: 0.45,
    pyroRadianceBorder: 0.55,
    pyroRadianceTeeth: 0.45,
    pyroRadianceRise: 0.45,
    pyroRadianceFireLock: 0.65,
    pyroFlowBite: 0,
    pyroFlowBorder: 0.55,
    pyroFlowTeeth: 0.55,
    pyroFlowRise: 0.5,
    pyroFlowFireLock: 0.55,
    pyroFlowLuma: 1,
    pyroFlowRadiance: 0,
    pyroFlowSpikes: 0.35,
    pyroFlowCoolColor: normalizeVolumeHexColor('#2aa7b8', '#2aa7b8'),
    pyroFlowHotColor: normalizeVolumeHexColor('#ff7a36', '#ff7a36'),
    pyroDiagnosticPaint: 0,
    pyroCarrierView: 'normal', // retired 2026-10-21: the pyro carriers are always zero
    pyroOverdrive: 1,
    pressureMode: pressureConfig.pressureMode,
    pressureEffectiveLabel: pressureConfig.pressureEffectiveLabel,
    pressureSolver: readControl('volume-pressure-solver').value,
    pressureResolution: readControl('volume-pressure-resolution').value,
    worldSmoke: readControl('volume-world-smoke').value,
    worldSmokeFlow: Number(readControl('volume-world-smoke-flow').value),
    worldSmokeMaterial: Number(readControl('volume-world-smoke-material').value),
    worldSmokeExtent: Number(readControl('volume-world-smoke-extent').value),
    worldSmokeTransition: Number(readControl('volume-world-smoke-transition').value),
    worldSmokeIntermediate: readControl('volume-world-smoke-intermediate').value,
    ...Object.fromEntries(REGION_CONTROL_FIELDS.map(field=>[field.key,Number(readControl(field.id).value)])),
    adaptiveMaterial: adaptiveMaterial,
    ...Object.fromEntries([...WORLD_CALIBRATION_FIELDS,...SIMULATION_LEVER_FIELDS].map(f=>[f.key,f.type==='select-one'?readControl(f.id).value:Number(readControl(f.id).value)])),
    heatReleaseExpansion: parseFloat(readControl('volume-heat-release-expansion').value),
    reactionLaw: readControl('volume-reaction-law').value || 'authored-tall-plume',
    reactantMixingTime: parseFloat(readControl('volume-reactant-mixing-time').value),
    reactantCoolingTime: parseFloat(readControl('volume-reactant-cooling-time').value),
    reactantSootYield: parseFloat(readControl('volume-reactant-soot-yield').value),
    appearanceModel: readControl('volume-appearance-model').value || 'authored',
    velocityStaggering: readControl('volume-velocity-staggering').value || 'collocated',
    immersedCentreX: parseFloat(readControl('volume-immersed-centre-x').value),
    immersedCentreY: parseFloat(readControl('volume-immersed-centre-y').value),
    immersedCentreZ: parseFloat(readControl('volume-immersed-centre-z').value),
    immersedYaw: parseFloat(readControl('volume-immersed-yaw').value),
    immersedPitch: parseFloat(readControl('volume-immersed-pitch').value),
    immersedRadius: parseFloat(readControl('volume-immersed-radius').value),
    immersedThickness: parseFloat(readControl('volume-immersed-thickness').value),
    immersedSpeed: parseFloat(readControl('volume-immersed-speed').value),
    immersedFuel: parseFloat(readControl('volume-immersed-fuel').value),
    immersedTemperature: parseFloat(readControl('volume-immersed-temperature').value),
    immersedMomentumGain: parseFloat(readControl('volume-immersed-momentum-gain').value),
    immersedCapFraction: parseFloat(readControl('volume-immersed-cap-fraction').value),
    immersedBackWall: parseFloat(readControl('volume-immersed-back-wall').value),
    pressureSolverIterations: parseFloat(readControl('volume-pressure-solver-iterations').value),
    advectionScheme: readControl('volume-advection-scheme').value,
    confinement: readControl('volume-confinement').value,
    timeStep: readControl('volume-time-step').value,
    pressureTierOverlay: parseFloat(readControl('volume-pressure-tier-overlay').value),
    pressureTierLowerMax: parseFloat(readControl('volume-pressure-tier-lower-max').value),
    pressureTierHeroMin: parseFloat(readControl('volume-pressure-tier-hero-min').value),
    pressureTierHeroMax: parseFloat(readControl('volume-pressure-tier-hero-max').value),
    canonicalSpread: parseFloat(readControl('volume-canonical-spread').value),
    canonicalCenterline: parseFloat(readControl('volume-canonical-centerline').value),
    canonicalBodyBalance: parseFloat(readControl('volume-canonical-body-balance').value),
    canonicalMacroPreset: activeCanonicalVolumeMacroPreset,
    canonicalSourceMode: routedCanonicalSourceMode,
    canonicalSourceModeValue: CANONICAL_VOLUME_SOURCE_MODE_VALUES[routedCanonicalSourceMode] || 0,
    canonicalRenderMode: routedCanonicalRenderMode,
    canonicalRenderModeValue: CANONICAL_VOLUME_RENDER_MODE_VALUES[routedCanonicalRenderMode] || 0,
    canonicalMotionMode: routedCanonicalMotionMode,
    canonicalMotionRetirementIdentity: CANONICAL_ANALYTIC_MOTION_RETIREMENT_IDENTITY,
    canonicalContentMode: routedCanonicalContentMode,
    canonicalContentModeValue: CANONICAL_VOLUME_CONTENT_MODE_VALUES[routedCanonicalContentMode] || 0,
    canonicalSourceY: routedCanonicalSourceY,
    canonicalSourceInjection: routedCanonicalInjection,
    canonicalBuoyancy: routedCanonicalBuoyancy,
    reactionFuelScale: routedVolumeReactionFuelScale,
    lifecycleEffect: routedVolumeLifecycleEffect,
    lifecycleT: routedVolumeLifecycleT,
    quenchVapor: routedVolumeQuenchVapor,
    runtimeQualityRequested: routedVolumeRuntimeQuality,
    viewportPreview: quality === 'preview',
    gpuPressure: routedVolumeGpuPressure,
    runtimeQualityReason: routedVolumeQualityReason,
    pressureIterations: pressureConfig.pressureIterations,
    pressureStrategy: pressureConfig.pressureStrategy,
    simProfile: routedVolumeSimProfile,
    rayBudgetPreset: activeVolumeRayBudgetPreset || routedVolumeRayBudgetPreset,
    ...routedBonfireAblationControls,
  }));
}

// Values already admitted/projected by the canonical saved-settings contract.
// This adapter maps coefficients; it does not claim GPU application or restore.
export function readAuthoredVolumeRuntimeControls(settings,options){
 const controls={...settings.domControls,...settings.rendererControls};
 return readVolumeRuntimeControlValues({...options,
  adaptiveMaterial:(()=>{const value=readAdaptiveMaterialControls(settings.domControls);return value.enabled?value.options:null;})(),
  readControl(id){
   const descriptor=controls[id];if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error(`Missing authored volume control ${id}`);
   const value=descriptor.rawValue??descriptor.value;
   return {value:id==='volume-scene'?normalizeVolumeScene(value):value,
    checked:typeof descriptor.value==='boolean'?descriptor.value:[true,'true','1',1].includes(value),
    requestedValue:id==='volume-scene'?settings.volumeSceneRequested??value:undefined};
  },
 });
}
