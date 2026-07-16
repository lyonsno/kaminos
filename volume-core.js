import {
  BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY,
  BOUNDARY_SPLAT_ATTRIBUTE_MODEL_WGSL,
} from './models/boundary-splat-attribute/live-support-h64-v0/boundary-splat-attribute-model.generated.js';
import {
  BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY,
  BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS,
  packBoundarySplatFeatureCapture,
} from './boundary-splat-feature-capture.mjs';
import {
  SELECTIVE_HEAD_LIVE_FEATURE_AUTHORITY,
  SELECTIVE_HEAD_LIVE_MODEL,
  SELECTIVE_HEAD_LIVE_MODEL_URL,
  SELECTIVE_HEAD_LIVE_PAIR_AUTHORITY,
  SELECTIVE_HEAD_LIVE_ROUTE,
  createSelectiveHeadLiveRuntime,
} from './selective-head-live-runtime.mjs';
import {
  NATIVE_LOW_INPUT_AUTHORITY,
  NATIVE_LOW_LEARNED_FLOW_ACTIVITY_CUE_PROJECTION,
  NATIVE_LOW_LEARNED_FLOW_ACTIVITY_MODEL_IDENTITY,
  NATIVE_LOW_LEARNED_FLOW_ACTIVITY_MODEL_SHA256,
  NATIVE_LOW_PREDICTED_ACTIVITY_CUE_PROJECTION,
  NATIVE_LOW_SHARED_DEVICE_ROUTE,
  NATIVE_LOW_TRANSPORT_MODE,
  NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE,
  NATIVE_LOW_TRANSFER_160_TO_96_DEPLOYMENT_GRID_ROUTE,
  createNativeLowSelectiveSharedDeviceRuntime,
} from './native-low-selective-live-runtime.mjs';
import { verifyExpectedSourceStepIdentity } from './volume-source-step-identity.mjs';

const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';
const FRONT_FIELD_IDENTITY = 'combustion-front-topology-sidecar-v0';
const FULL_FIELD_EXPORT_IDENTITY = 'kaminos.volume.full-field-export.v0';
const FULL_FIELD_IMPORT_IDENTITY = 'kaminos.volume.full-field-import.v0';
const COARSE_RECEIVER_INITIALIZATION_AUTHORITY = 'receiver-initialized-from-filtered-high-t-v0';
const SELECTIVE_COMPOSITION_AUTHORITY = 'learned-selective-head-composition-not-filtered-high-truth-v0';
const SELECTIVE_COMPOSITION_APPLICATION_IDENTITY = 'learned-selective-head-application-v0';
const NATIVE_LOW_HELD_INITIALIZATION_AUTHORITY = 'native-low-simulator-held-control-v0';
const NATIVE_LOW_HELD_APPLICATION_IDENTITY = 'native-low-held-render-application-v0';
const NATIVE_LOW_SELECTIVE_INITIALIZATION_AUTHORITY = 'frozen-exact-basin-heads-applied-to-native-low-state-v0';
const NATIVE_LOW_CROSS_GRID_SELECTIVE_INITIALIZATION_AUTHORITY = 'frozen-trained-grid-heads-applied-to-explicit-cross-grid-native-state-v0';
const NATIVE_LOW_SELECTIVE_APPLICATION_IDENTITY = 'native-low-selective-held-render-application-v0';
const PHASE_ALIGNED_TRUTH_HELD_AUTHORITY = 'offline-high-truth-held-render-only-v0';
const PHASE_ALIGNED_LOW_HELD_AUTHORITY = 'downsampled-same-high-history-held-control-v0';
const PHASE_ALIGNED_HELD_APPLICATION_IDENTITY = 'phase-aligned-held-render-application-v0';
const CHECKSUM_ADDRESSED_LIVE_REPLAY_AUTHORITY = 'checksum-addressed-live-replay-resume-v0';
const EXACT_FIELD_LIVE_REPLAY_APPLICATION_IDENTITY = 'exact-field-live-replay-application-v0';
const BOUNDARY_SIDECAR_IDENTITY = 'baked-boundary-sidecar-v0';
const BOUNDARY_SIDECAR_BAKE_AUTHORITY = 'band-limited-support-coverage-ridge-proximity-footprint-v1';
const BOUNDARY_SPLAT_RENDERER_IDENTITY = 'live-boundary-sidecar-analytic-splats-v0';
const BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY = 'live-boundary-sidecar-learned-attribute-splats-v0';
const BOUNDARY_SPLAT_SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const EXTERNAL_BOUNDARY_SIDECAR_AUTHORITY = 'externally-uploaded-boundary-sidecar-plus-live-fluid-material-v0';
const EXTERNAL_BOUNDARY_SIDECAR_UPLOAD_IDENTITY = 'chunked-external-boundary-sidecar-upload-v0';
const BOUNDARY_SPLAT_GPU_PROFILE_IDENTITY = 'boundary-splat-stage-gpu-timestamp-profile-v0';
const BOUNDARY_SPLAT_ATTRIBUTE_HOOK_IDENTITY = 'boundary-splat-learned-attribute-hook-v0';
const NATIVE_LOW_LEARNED_SPLAT_CALIBRATION_IDENTITY = 'native-low-learned-splat-calibration-v0';
const BOUNDARY_SPLAT_INITIAL_CAPACITY = 131072;
const BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES = 48;
const BOUNDARY_SPLAT_FEATURE_STRIDE_BYTES = BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const TRUTH_ORACLE_ACTIVITY_RECEIVER_IDENTITY = 'truth-oracle-scalar-activity-receiver-v0';
const TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY = 'truth-high-diagnostic-activity-projected-to-receiver-grid-v0';
const PROCEDURAL_ACTIVITY_CUE_AUTHORITY = 'procedural-receiver-activity-proxy-no-truth-v0';
const NATIVE64_LEARNED_CUE_AUTHORITY = 'learned-96-trained-derived-flow-activity-head-v0';
const SCALAR_ACTIVITY_RECEIVER_HOOK_IDENTITY = 'scalar-activity-receiver-hook-controls-v0';
const REACTION_FRONT_STAGE_IDENTITY = 'reaction-front-stage-fields-v0';
const REACTION_FRONT_ATLAS_SCHEMA = 'kaminos.volume.reaction-front-atlas.v0';
const BROWSER_RESIDUAL_FEATURE_AUTHORITY = 'shader-material-authority-residual-feature-v0';
const DEFAULT_GRID_SIZE = 96;
const SUPPORTED_GRID_SIZES = [32, 48, 64, 96, 128, 160];
const SELECTIVE_HEAD_LIVE_ROLES = new Set(['off', 'truthHigh', 'lowPhaseAligned', 'selectiveFullResidual']);
const SELECTIVE_HEAD_LIVE_ROLE_AUTHORITIES = Object.freeze({
  off: 'off',
  truthHigh: 'current-high-field-reference-no-learned-composition-v0',
  lowPhaseAligned: 'phase-aligned-low-field-control-v0',
  selectiveFullResidual: 'learned-selective-full-residual-composition-v0',
});
const SELECTIVE_HEAD_LIVE_DEFAULT_RENDER_COMPOSITION = 'smoke-raymarch-under-splats-v0';
const SELECTIVE_HEAD_LIVE_RENDER_COMPOSITIONS = Object.freeze({
  'splat-only-v0': {
    raymarch: false,
    splat: true,
    raymarchFireAuthority: 0,
    compositionAuthority: 'splat-fire-authority-learned-boundary-sheets-v0',
  },
  'raymarch-only-v0': {
    raymarch: true,
    splat: false,
    raymarchFireAuthority: 1,
    compositionAuthority: 'diagnostic-raymarch-full-selected-field-authority-v0',
  },
  'smoke-raymarch-under-splats-v0': {
    raymarch: true,
    splat: true,
    raymarchFireAuthority: 0,
    compositionAuthority: 'smoke-raymarch-authority-broad-smoke-only-v0+splat-fire-authority-learned-boundary-sheets-v0',
  },
  'full-raymarch-under-splats-diagnostic-v0': {
    raymarch: true,
    splat: true,
    raymarchFireAuthority: 1,
    compositionAuthority: 'diagnostic-full-fire-raymarch-under-splats-duplicate-fire-authority-v0',
  },
});
const SELECTIVE_HEAD_LIVE_REPLAY_ANCHOR_AUTHORITY = 'checksum-bound-exact-basin-step96-field-anchor-v0';
const FLUID_SLOTS_PER_CELL = 4;
const FLUID_COMPONENTS = FLUID_SLOTS_PER_CELL * 4;
const FULL_FIELD_CHANNELS = [
  'velocityX',
  'velocityY',
  'velocityZ',
  'densityCarrier',
  'smokeDensity',
  'heat',
  'fuel',
  'detail',
  'flame',
  'ember',
  'visibleFireCarrier',
  'combustionFront',
  'microdetail',
  'interfaceShred',
  'fireLick',
  'emberFleck',
];
const BOUNDARY_SPLAT_CHANNELS = [
  'positionX',
  'positionY',
  'positionZ',
  'support',
  'colorR',
  'colorG',
  'colorB',
  'opacity',
  'radiusX',
  'radiusY',
  'ridge',
  'fireSignal',
];
const DEFAULT_MAJORANT_GRID_SIZE = 48;
const SUPPORTED_MAJORANT_GRID_SIZES = [24, 32, 48];
const MAX_EXTERNAL_EMITTERS = 32;
const EXTERNAL_EMITTER_COMPONENTS = 20;
const DEFAULT_VOLUME_SCENE = 'compact_plume';
const SUPPORTED_VOLUME_SCENES = new Set([DEFAULT_VOLUME_SCENE, 'canonical_plume', 'tall_plume', 'bonfire_plume']);
const CANONICAL_SOURCE_MODE_VALUES = {
  current: 0,
  passive_bottom: 1,
  forced_bottom: 2,
  buoyant_bottom: 3,
};
const CANONICAL_RENDER_MODE_VALUES = {
  default: 0,
  smoke_only: 1,
};
const CANONICAL_MOTION_MODE_VALUES = {
  animated: 0,
  frozen: 1,
};
const CANONICAL_CONTENT_MODE_VALUES = {
  smoke: 0,
  fire: 1,
  fire_smoke: 2,
};

function normalizeGridSize(value) {
  const requested = Number(value);
  if (SUPPORTED_GRID_SIZES.includes(requested)) return requested;
  return DEFAULT_GRID_SIZE;
}

function normalizeSelectiveHeadLiveRole(value) {
  const role = String(value || 'off');
  return SELECTIVE_HEAD_LIVE_ROLES.has(role) ? role : 'off';
}

function selectiveHeadLiveRoleAuthority(role) {
  return SELECTIVE_HEAD_LIVE_ROLE_AUTHORITIES[normalizeSelectiveHeadLiveRole(role)];
}

function normalizeSelectiveHeadLiveRenderComposition(value) {
  const normalized = String(value || SELECTIVE_HEAD_LIVE_DEFAULT_RENDER_COMPOSITION).trim();
  if (Object.hasOwn(SELECTIVE_HEAD_LIVE_RENDER_COMPOSITIONS, normalized)) return normalized;
  if (normalized === 'raymarch-under-splats-v0' || normalized === 'hybrid') return 'full-raymarch-under-splats-diagnostic-v0';
  if (normalized === 'smoke-hybrid') return 'smoke-raymarch-under-splats-v0';
  if (normalized === 'splat-only') return 'splat-only-v0';
  if (normalized === 'raymarch-only') return 'raymarch-only-v0';
  return SELECTIVE_HEAD_LIVE_DEFAULT_RENDER_COMPOSITION;
}

function selectiveHeadLiveRenderCompositionRequest(rawValue) {
  const raw = rawValue == null || rawValue === ''
    ? SELECTIVE_HEAD_LIVE_DEFAULT_RENDER_COMPOSITION
    : String(rawValue);
  const requested = normalizeSelectiveHeadLiveRenderComposition(raw);
  const canonicalOrAlias = raw === requested
    || raw === 'raymarch-under-splats-v0'
    || raw === 'hybrid'
    || raw === 'smoke-hybrid'
    || raw === 'splat-only'
    || raw === 'raymarch-only';
  return {
    raw,
    requested,
    fallbackReason: canonicalOrAlias ? null : `unsupported-selective-head-live-composition:${raw}`,
    definition: SELECTIVE_HEAD_LIVE_RENDER_COMPOSITIONS[requested],
  };
}

function selectiveHeadLiveRenderCompositionAuthority(composition) {
  return SELECTIVE_HEAD_LIVE_RENDER_COMPOSITIONS[normalizeSelectiveHeadLiveRenderComposition(composition)]?.compositionAuthority || 'unavailable';
}

function makeSelectiveHeadLivePassReceipt({
  composition,
  raymarchEncoded = false,
  raymarchApplied = false,
  splatEncoded = false,
  splatApplied = false,
  fallbackReason = null,
} = {}) {
  const effectiveComposition = normalizeSelectiveHeadLiveRenderComposition(composition);
  const definition = SELECTIVE_HEAD_LIVE_RENDER_COMPOSITIONS[effectiveComposition];
  return {
    identity: 'selective-head-live-render-pass-receipt-v0',
    composition: effectiveComposition,
    compositionAuthority: definition.compositionAuthority,
    raymarchAuthority: definition.raymarchFireAuthority > 0
      ? 'diagnostic-raymarch-selected-fields-fire-smoke-v0'
      : 'smoke-raymarch-authority-broad-smoke-only-v0',
    splatAuthority: definition.splat
      ? 'splat-fire-authority-learned-boundary-sheets-v0'
      : 'off',
    raymarchFireAuthority: definition.raymarchFireAuthority,
    raymarchEncoded,
    raymarchApplied,
    splatEncoded,
    splatApplied,
    fallbackReason,
  };
}

function normalizeScalarActivityCueGridSize(value, fallback = DEFAULT_GRID_SIZE) {
  const requested = Math.round(Number(value));
  if (Number.isFinite(requested) && requested > 0) return requested;
  return fallback;
}

function normalizeMajorantGridSize(value) {
  const requested = Number(value);
  if (SUPPORTED_MAJORANT_GRID_SIZES.includes(requested)) return requested;
  return DEFAULT_MAJORANT_GRID_SIZE;
}

function normalizeRenderScale(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 0.85;
  return Math.max(0.1, Math.min(1, requested));
}

function normalizeBrowserResidualMode(value) {
  const mode = String(value || 'off').toLowerCase().replace(/_/g, '-');
  if (['direct', 'direct-residual', 'webgpu-direct-residual', 'on', '1', 'true'].includes(mode)) return 'webgpu-direct-residual';
  return 'off';
}

function normalizeBrowserResidualStrength(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 1;
  return Math.max(0, Math.min(2, requested));
}

function normalizeBrowserResidualFeatureDebug(value) {
  const normalized = String(value ?? '0').toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'debug' ? 1 : 0;
}

function normalizeVolumeScene(value) {
  return SUPPORTED_VOLUME_SCENES.has(value) ? value : DEFAULT_VOLUME_SCENE;
}

function normalizeCanonicalSourceMode(value) {
  return Object.hasOwn(CANONICAL_SOURCE_MODE_VALUES, value) ? value : 'current';
}

function canonicalSourceModeValue(value) {
  return CANONICAL_SOURCE_MODE_VALUES[normalizeCanonicalSourceMode(value)] || 0;
}

function normalizeCanonicalRenderMode(value) {
  return Object.hasOwn(CANONICAL_RENDER_MODE_VALUES, value) ? value : 'default';
}

function canonicalRenderModeValue(value) {
  return CANONICAL_RENDER_MODE_VALUES[normalizeCanonicalRenderMode(value)] || 0;
}

function normalizeCanonicalMotionMode(value) {
  return Object.hasOwn(CANONICAL_MOTION_MODE_VALUES, value) ? value : 'animated';
}

function canonicalMotionModeValue(value) {
  return CANONICAL_MOTION_MODE_VALUES[normalizeCanonicalMotionMode(value)] || 0;
}

function normalizeCanonicalContentMode(value) {
  return Object.hasOwn(CANONICAL_CONTENT_MODE_VALUES, value) ? value : 'smoke';
}

function canonicalContentModeValue(value) {
  return CANONICAL_CONTENT_MODE_VALUES[normalizeCanonicalContentMode(value)] || 0;
}

function normalizeBoundarySidecarSource(value) {
  const normalized = String(value || 'live').toLowerCase().replace(/-/g, '_');
  if (normalized === 'baked' || normalized === 'mix' || normalized === 'override') return normalized;
  return 'live';
}

function boundarySidecarSourceValue(value) {
  const normalized = normalizeBoundarySidecarSource(value);
  if (normalized === 'baked' || normalized === 'override') return 1;
  if (normalized === 'mix') return 2;
  return 0;
}

function normalizeBoundarySidecarView(value) {
  const normalized = String(value || 'off').toLowerCase().replace(/-/g, '_');
  if (normalized === 'support' || normalized === 'coverage' || normalized === 'ridge' || normalized === 'proximity' || normalized === 'footprint') return normalized;
  return 'off';
}

function boundarySidecarViewValue(value) {
  const normalized = normalizeBoundarySidecarView(value);
  if (normalized === 'support') return 1;
  if (normalized === 'coverage') return 2;
  if (normalized === 'ridge') return 3;
  if (normalized === 'proximity') return 4;
  if (normalized === 'footprint') return 5;
  return 0;
}

function normalizeBoundarySplatMode(value) {
  const normalized = String(value || 'off').toLowerCase().replace(/-/g, '_');
  return normalized === 'analytic' || normalized === 'learned' ? normalized : 'off';
}

function normalizeBoundarySplatFeatureCapture(value) {
  if (value === true || value === 1) return true;
  return ['1', 'true', 'on'].includes(String(value || '').toLowerCase());
}

function normalizeBoundarySplatRadius(value) {
  return clampFinite(value, 0.35, 1.5, 1);
}

function normalizeBoundarySplatSharpness(value) {
  return clampFinite(value, 1, 12, 3.4);
}

function normalizeNativeLowTreatmentSplatRadianceGain(value) {
  return clampFinite(value, 0, 8, 1);
}

function normalizeNativeLowTreatmentSplatOpacityGain(value) {
  return clampFinite(value, 0, 8, 1);
}

function boundarySplatEffectiveRendererIdentity(mode) {
  return normalizeBoundarySplatMode(mode) === 'learned'
    ? BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY
    : BOUNDARY_SPLAT_RENDERER_IDENTITY;
}

function boundarySplatEffectiveAttributeModelIdentity(mode) {
  return normalizeBoundarySplatMode(mode) === 'learned'
    ? BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY
    : null;
}

function normalizeWindStrength(value) {
  return clampFinite(value, 0, 1.5, 0);
}

function normalizeWindAngle(value) {
  return clampFinite(value, -180, 180, 0);
}

function normalizeWindHeight(value) {
  return clampFinite(value, -0.8, 0.8, 0.15);
}

function normalizeReactionFuelScale(value) {
  return clampFinite(value, 0, 1.5, 1);
}

function normalizeLifecycleEffect(value) {
  const normalized = String(value || 'none').toLowerCase();
  return normalized === 'snuff' ? 'snuff' : 'none';
}

function normalizeLifecycleT(value) {
  return clampFinite(value, 0, 1, 0);
}

function normalizeQuenchVapor(value) {
  return clampFinite(value, 0, 2, 0);
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

function runtimeQualityEffectiveFromPressure(requested, gpuPressure) {
  const normalized = normalizeRuntimeQuality(requested);
  if (normalized !== 'auto') return normalized;
  const pressure = clampFinite(gpuPressure, 0, 1, 0);
  if (pressure >= 0.90) return 'impostor';
  if (pressure >= 0.70) return 'holdover';
  if (pressure >= 0.45) return 'live_low';
  return 'live_high';
}

function applyRuntimeQualityControls(controls = {}) {
  const requested = normalizeRuntimeQuality(controls.runtimeQualityRequested);
  const gpuPressure = clampFinite(controls.gpuPressure, 0, 1, 0);
  const effective = runtimeQualityEffectiveFromPressure(requested, gpuPressure);
  const next = {
    ...controls,
    runtimeQualityRequested: requested,
    runtimeQualityEffective: effective,
    runtimeQualityReason: String(controls.runtimeQualityReason || 'unspecified').slice(0, 96) || 'unspecified',
    gpuPressure,
  };
  const cap = (key, limit) => {
    const current = Number(next[key]);
    if (Number.isFinite(current) && current > limit) next[key] = limit;
  };
  const floor = (key, limit) => {
    const current = Number(next[key]);
    if (Number.isFinite(current) && current < limit) next[key] = limit;
  };
  if (effective === 'live_low') {
    cap('renderScale', 0.75);
    cap('raySteps', 96);
    floor('adaptiveRays', 0.45);
    floor('majorantCadence', 2);
  } else if (effective === 'holdover') {
    cap('renderScale', 0.70);
    cap('raySteps', 72);
    floor('adaptiveRays', 0.65);
    floor('occupancySkip', 0.25);
    floor('majorantSkip', 0.35);
    floor('majorantCadence', 4);
    floor('temporalAccum', 0.42);
    next.pressureStrategy = 'global';
    next.pressureIterations = Math.min(1, Number.isFinite(Number(next.pressureIterations)) ? Number(next.pressureIterations) : 1);
  } else if (effective === 'impostor') {
    cap('renderScale', 0.60);
    cap('raySteps', 48);
    floor('adaptiveRays', 0.85);
    floor('occupancySkip', 0.45);
    floor('majorantSkip', 0.55);
    floor('majorantCadence', 8);
    floor('temporalAccum', 0.65);
    next.pressureStrategy = 'global';
    next.pressureIterations = 0;
  }
  return next;
}

function runtimeQualityReceipt(controls = {}) {
  const requested = normalizeRuntimeQuality(controls.runtimeQualityRequested);
  const effective = runtimeQualityEffectiveFromPressure(controls.runtimeQualityEffective || requested, controls.gpuPressure);
  const gpuPressure = clampFinite(controls.gpuPressure, 0, 1, 0);
  const reason = String(controls.runtimeQualityReason || 'unspecified').slice(0, 96) || 'unspecified';
  return {
    identity: 'volume-runtime-quality-ladder-v0',
    requested,
    effective,
    reason,
    gpuPressure,
    knobs: {
      renderScale: normalizeRenderScale(controls.renderScale),
      raySteps: clampFinite(controls.raySteps, 24, 160, 96),
      adaptiveRays: clampFinite(controls.adaptiveRays, 0, 1, 0.65),
      occupancySkip: clampFinite(controls.occupancySkip, 0, 1, 0.35),
      majorantSkip: clampFinite(controls.majorantSkip, 0, 1, 0.70),
      majorantCadence: normalizeMajorantBuildCadence(controls.majorantCadence),
      temporalAccum: clampFinite(controls.temporalAccum, 0, 0.85, 0.25),
      pressureStrategy: normalizePressureStrategy(controls.pressureStrategy, controls.volumeScene),
      pressureIterations: normalizePressureIterationCount(controls.pressureIterations, controls.volumeScene),
    },
  };
}

function snuffQuenchVaporStrength(controls = {}) {
  if (normalizeLifecycleEffect(controls.lifecycleEffect) !== 'snuff') return 0;
  const t = normalizeLifecycleT(controls.lifecycleT);
  const envelope = t * t * (3 - 2 * t);
  return normalizeQuenchVapor(controls.quenchVapor) * envelope;
}

function normalizeBonfireAblationValue(value, fallback = 1, max = 1.5) {
  return clampFinite(value, 0, max, fallback);
}

function normalizeBonfireAblationControls(controls = {}) {
  return {
    recenter: normalizeBonfireAblationValue(controls.bonfireRecenter),
    lateralDamping: normalizeBonfireAblationValue(controls.bonfireLateralDamping),
    shear: normalizeBonfireAblationValue(controls.bonfireShear),
    detailForces: normalizeBonfireAblationValue(controls.bonfireDetailForces),
    depinch: normalizeBonfireAblationValue(controls.bonfireDepinch),
    projection: normalizeBonfireAblationValue(controls.bonfireProjection),
    temporal: normalizeBonfireAblationValue(controls.bonfireTemporal),
    instabilityProbe: normalizeBonfireAblationValue(controls.bonfireInstabilityProbe, 0, 1),
  };
}

function volumeSceneMode(value) {
  const scene = normalizeVolumeScene(value);
  if (scene === 'canonical_plume') return 3;
  if (scene === 'tall_plume') return 1;
  if (scene === 'bonfire_plume') return 2;
  return 0;
}

function detailScaleArtifactQuarantine(value) {
  return normalizeVolumeScene(value) === 'tall_plume' ? 1 : 0;
}

function bonfireReferenceConfinementDebug(value) {
  const scene = normalizeVolumeScene(value);
  return {
    identity: 'bonfire-reference-front-gradient-confinement-v0',
    enabled: scene === 'bonfire_plume',
    storage: 'four-slot-existing-fluid-state',
    forceSource: 'neighbor-slot-front-gradient-plus-curl',
    radiancePolicy: 'front-contact-gated-emission',
  };
}

function minimalPlumeProofDebug(value) {
  const scene = normalizeVolumeScene(value);
  return {
    identity: 'minimal-canonical-plume-proof-v0',
    enabled: scene === 'canonical_plume',
    fieldView: 'density-smoke-readback',
    raymarchView: 'same-field-linear-volume-render',
    canonicalRenderSourceOrientation: 'screen-y-matches-source-field-y',
    excluded: 'bonfire-front-topology/fire-licks/microdetail/authored-bonfire-shape',
  };
}

function gridCellCount(gridSize) {
  return gridSize * gridSize * gridSize;
}

function nextPowerOfTwo(value) {
  const finiteValue = Math.max(1, Math.ceil(Number(value) || 1));
  return 2 ** Math.ceil(Math.log2(finiteValue));
}

function nextBoundarySplatCapacity(currentCapacity, candidateCount, gridSize) {
  if (candidateCount <= currentCapacity) return currentCapacity;
  return Math.min(gridCellCount(gridSize), Math.max(currentCapacity, nextPowerOfTwo(candidateCount)));
}

function fluidBufferBytes(gridSize) {
  return gridCellCount(gridSize) * FLUID_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
}

function majorantBufferBytes(majorantGridSize = DEFAULT_MAJORANT_GRID_SIZE) {
  return majorantGridSize * majorantGridSize * majorantGridSize * 4 * Float32Array.BYTES_PER_ELEMENT;
}

function boundarySidecarBufferBytes(gridSize) {
  return gridCellCount(gridSize) * 4 * Float32Array.BYTES_PER_ELEMENT;
}

function frontFieldBufferBytes(gridSize) {
  return gridCellCount(gridSize) * Float32Array.BYTES_PER_ELEMENT;
}

function pressureBufferBytes(gridSize) {
  return gridCellCount(gridSize) * 4 * Float32Array.BYTES_PER_ELEMENT;
}

const SIM_COST_LEDGER_IDENTITY = 'tall-plume-sim-cost-ledger-v0';
const SIM_COST_LEDGER_EVIDENCE_SOURCE = 'cpu-structural-pass-ledger-plus-raf-queue-proxy';
const PRESSURE_SOURCE_STRATEGY_INLINE_DIVERGENCE = 'jacobi-inline-divergence-v0';
const PRESSURE_SOURCE_STRATEGY_DISABLED = 'disabled';
const TALL_PLUME_PRESSURE_ITERATION_STRATEGY_PRESSURE2 = 'tall-plume-pressure2-v0';
const TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE = 'inactive';
const TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY = 'tall-plume-spatial-pressure-tiers-v0';
const TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE = 'inactive';
const PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE = 'composite-pressure-tier-read-v0';
const PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER = 'single-pressure-buffer-read-v0';
const PRESSURE_STRATEGY_SPATIAL_TIERS = 'spatial_tiers';
const PRESSURE_STRATEGY_GLOBAL = 'global';
const DEFAULT_PRESSURE_TIER_LOWER_MAX = 0.50;
const DEFAULT_PRESSURE_TIER_HERO_MIN = 0.05;
const DEFAULT_PRESSURE_TIER_HERO_MAX = 0.22;
const DEFAULT_PRESSURE_TIER_OVERLAY = 0;
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
const PYRO_DYNAMIC_DETAIL_ATLAS_IDENTITY = 'pyro-dynamic-detail-atlas-v0';
const PYRO_DYNAMIC_DETAIL_AUTHORITY_SOURCE = 'pyro-dynamic-detail-authority-live-fields-v0';
const PYRO_DYNAMIC_DETAIL_RESET_POLICY = 'pyro-dynamic-detail-reset-policy-v0';
const PYRO_DYNAMIC_DETAIL_MATERIAL_CONTRACT = 'pyro-dynamic-detail-material-contract-v0';
const PYRO_DYNAMIC_DETAIL_PHASE_BASE_STEP = 0.004;
const PYRO_DYNAMIC_DETAIL_PHASE_FIRE_STEP = 0.018;
const PYRO_DYNAMIC_DETAIL_PHASE_SMOKE_STEP = 0.004;
const PYRO_DYNAMIC_DETAIL_CELL_BLEND = 0.14;
const PYRO_DYNAMIC_DETAIL_TEXTURE_LAYOUT = {
  width: 8,
  height: 3,
  channels: 4,
  channelOrder: ['energy', 'confidence', 'liveFireAuthority', 'smokeAuthority'],
};

function externalEmitterBufferBytes() {
  return MAX_EXTERNAL_EMITTERS * EXTERNAL_EMITTER_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
}

function scalarActivityCueBufferBytes(grid = DEFAULT_GRID_SIZE) {
  return gridCellCount(normalizeGridSize(grid)) * Float32Array.BYTES_PER_ELEMENT;
}

function clampFinite(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeScalarActivityReceiverControls(snapshot = {}) {
  return {
    enabled: clampFinite(snapshot.oracleActivityCue, 0, 1, 0),
    display: clampFinite(snapshot.oracleActivityDisplay, 0, 1, 0),
    curlNoiseGain: clampFinite(snapshot.oracleActivityCurlNoise, 0, 3, 0),
    vorticityGain: clampFinite(snapshot.oracleActivityVorticity, 0, 3, 0),
    materialGain: clampFinite(snapshot.oracleActivityMaterial, 0, 3, 0),
  };
}

function smoothstep01(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clampFinite((value - edge0) / (edge1 - edge0), 0, 1, 0);
  return t * t * (3 - 2 * t);
}

function normalizeReactionFrontAtlasControls(controls = {}) {
  const orderedPair = (minValue, maxValue, minFallback, maxFallback, lo, hi) => {
    const a = clampFinite(minValue, lo, hi, minFallback);
    const b = clampFinite(maxValue, lo, hi, maxFallback);
    return a <= b ? [a, b] : [b, a];
  };
  const [heatMin, heatMax] = orderedPair(controls.reactionHeatMin, controls.reactionHeatMax, 0.026, 0.42, 0, 1.2);
  const [fuelMin, fuelMax] = orderedPair(controls.reactionFuelMin, controls.reactionFuelMax, 0.0015, 0.055, 0, 0.18);
  const [flameMin, flameMax] = orderedPair(controls.reactionFlameMin, controls.reactionFlameMax, 0.0035, 0.12, 0, 0.35);
  const [frontMin, frontMax] = orderedPair(controls.reactionFrontMin, controls.reactionFrontMax, 0.0015, 0.075, 0, 0.25);
  const [gradientMin, gradientMax] = orderedPair(controls.reactionGradientMin, controls.reactionGradientMax, 0.018, 0.18, 0, 0.6);
  const [coreMin, coreMax] = orderedPair(controls.reactionCoreMin, controls.reactionCoreMax, 0.18, 0.95, 0, 1.6);
  const [divergenceMin, divergenceMax] = orderedPair(controls.reactionDivergenceMin, controls.reactionDivergenceMax, 0.004, 0.07, 0, 0.2);
  return {
    heatMin,
    heatMax,
    fuelMin,
    fuelMax,
    flameMin,
    flameMax,
    frontMin,
    frontMax,
    gradientMin,
    gradientMax,
    coreMin,
    coreMax,
    coreReject: clampFinite(controls.reactionCoreReject, 0, 1, 0.82),
    topologyGain: clampFinite(controls.reactionTopologyGain, 0, 2.5, 0.44),
    stretchErode: clampFinite(controls.reactionStretchErode, 0, 1, 0),
    divergenceMin,
    divergenceMax,
    divergenceGain: clampFinite(controls.reactionDivergenceGain, 0, 1, 0),
    curlWarp: clampFinite(controls.reactionCurlWarp, 0, 3, 0),
    shellGamma: clampFinite(controls.reactionShellGamma, 0.35, 3, 1),
    shellContrast: clampFinite(controls.reactionShellContrast, 0.25, 5, 1),
  };
}

function pyroHexColorToRgb(value, fallback) {
  const raw = String(value || fallback || '#ffffff').trim();
  const normalized = /^#[0-9a-f]{6}$/i.test(raw)
    ? raw.slice(1)
    : (/^[0-9a-f]{6}$/i.test(raw) ? raw : String(fallback || '#ffffff').replace(/^#/, ''));
  const safe = /^[0-9a-f]{6}$/i.test(normalized) ? normalized : 'ffffff';
  return [
    parseInt(safe.slice(0, 2), 16) / 255,
    parseInt(safe.slice(2, 4), 16) / 255,
    parseInt(safe.slice(4, 6), 16) / 255,
  ];
}

function writePyroPaletteUniform(uniforms, offset, value, fallback) {
  const rgb = pyroHexColorToRgb(value, fallback);
  uniforms[offset] = rgb[0];
  uniforms[offset + 1] = rgb[1];
  uniforms[offset + 2] = rgb[2];
  uniforms[offset + 3] = 1;
}

function normalizePyroDynamicDetailEnabled(value) {
  return clampFinite(value, 0, 1, 0) >= 0.5;
}

function normalizeLookFreeze(value) {
  return clampFinite(value, 0, 1, 0) >= 0.5 ? 1 : 0;
}

function normalizePyroCompareMode(value) {
  const mode = String(value || 'live').toLowerCase();
  if (mode === 'base') return 'base';
  return 'live';
}

function lookFreezeCanPin(state) {
  return (state?.simStepCount || 0) > 0;
}

function updateRenderPhaseState(now, state, lookFreeze) {
  const liveTimeMs = Number.isFinite(Number(now)) ? Number(now) : performance.now();
  const liveFrame = Number.isFinite(Number(state?.frameCount)) ? Number(state.frameCount) : 0;
  if (lookFreeze) {
    if (typeof state.lookFreezeRenderTimeMs !== 'number' || !Number.isFinite(state.lookFreezeRenderTimeMs)) state.lookFreezeRenderTimeMs = liveTimeMs;
    if (typeof state.lookFreezeRenderFrame !== 'number' || !Number.isFinite(state.lookFreezeRenderFrame)) state.lookFreezeRenderFrame = liveFrame;
  } else {
    state.lookFreezeRenderTimeMs = null;
    state.lookFreezeRenderFrame = null;
  }
  const renderPhaseTimeMs = lookFreeze ? state.lookFreezeRenderTimeMs : liveTimeMs;
  const renderPhaseFrame = lookFreeze ? state.lookFreezeRenderFrame : liveFrame;
  const renderPhaseAuthority = lookFreeze ? 'look-freeze-pinned-render-phase' : 'live-render-phase';
  state.renderPhaseTimeMs = renderPhaseTimeMs;
  state.renderPhaseFrame = renderPhaseFrame;
  state.renderPhaseAuthority = renderPhaseAuthority;
  return { renderPhaseTimeMs, renderPhaseFrame, renderPhaseAuthority };
}

function pyroCarrierViewModeValue(value) {
  const mode = String(value || 'normal').toLowerCase();
  if (mode === 'border') return 1;
  if (mode === 'bite') return 2;
  if (mode === 'fold') return 3;
  if (mode === 'wake') return 4;
  if (mode === 'radiance') return 5;
  if (mode === 'flow') return 6;
  if (mode === 'all') return 7;
  return 0;
}

function pyroRadianceSourceValue(value) {
  const mode = String(value || 'fire').toLowerCase();
  if (mode === 'mixed') return 1;
  if (mode === 'wake') return 2;
  return 0;
}

function normalizeFireRenderMode(value) {
  const mode = String(value || 'shell').toLowerCase().replace(/-/g, '_');
  if (mode === 'off') return 'off';
  if (mode === 'inspect' || mode === 'carrier_inspect') return 'inspect';
  if (mode === 'stock' || mode === 'legacy') return 'stock';
  return 'shell';
}

function fireRenderModeValue(value) {
  const mode = normalizeFireRenderMode(value);
  if (mode === 'off') return 0;
  if (mode === 'inspect') return 2;
  if (mode === 'stock') return 3;
  return 1;
}

function normalizeShellInspectMode(value) {
  const mode = String(value || 'shell').toLowerCase().replace(/-/g, '_');
  if (['thermal', 'reaction', 'front', 'edge', 'core', 'curl', 'divergence', 'boundary', 'boundary_fire'].includes(mode)) return mode;
  return 'shell';
}

function shellInspectModeValue(value) {
  const mode = normalizeShellInspectMode(value);
  if (mode === 'thermal') return 1;
  if (mode === 'reaction') return 2;
  if (mode === 'front') return 3;
  if (mode === 'edge') return 4;
  if (mode === 'core') return 5;
  if (mode === 'curl') return 6;
  if (mode === 'divergence') return 7;
  if (mode === 'boundary') return 8;
  if (mode === 'boundary_fire') return 9;
  return 0;
}

function normalizePyroFireMode(value) {
  const mode = String(value || 'hybrid').toLowerCase();
  if (mode === 'stock') return 'stock';
  if (mode === 'pyro-owned' || mode === 'pyro_owned' || mode === 'owned') return 'pyro-owned';
  return 'hybrid';
}

function pyroFireModeValue(value) {
  const mode = normalizePyroFireMode(value);
  if (mode === 'stock') return 0;
  if (mode === 'pyro-owned') return 2;
  return 1;
}

function fireLickOperatorGainFromAmount(value) {
  const amount = clampFinite(value, 0, 5, 0);
  return amount * (0.82 + amount * 0.110);
}

function normalizeMajorantBuildCadence(value) {
  const requested = Math.round(Number(value));
  if (!Number.isFinite(requested)) return 1;
  return Math.max(1, Math.min(8, requested));
}

function defaultPressureIterationsForScene(value) {
  return normalizeVolumeScene(value) === 'tall_plume' ? 2 : (normalizeVolumeScene(value) === 'bonfire_plume' ? 8 : 4);
}

function normalizePressureIterationCount(value, scene) {
  const requested = Math.round(Number(value));
  if (!Number.isFinite(requested)) return defaultPressureIterationsForScene(scene);
  return Math.max(0, Math.min(12, requested));
}

function normalizePressureStrategy(value, scene) {
  const requested = String(value ?? PRESSURE_STRATEGY_GLOBAL).toLowerCase();
  if (normalizeVolumeScene(scene) === 'tall_plume' && requested === PRESSURE_STRATEGY_SPATIAL_TIERS) {
    return PRESSURE_STRATEGY_SPATIAL_TIERS;
  }
  return PRESSURE_STRATEGY_GLOBAL;
}

function tallPlumePressureIterationStrategy(scene, pressureIterations) {
  return normalizeVolumeScene(scene) === 'tall_plume' && Number(pressureIterations) === 2
    ? TALL_PLUME_PRESSURE_ITERATION_STRATEGY_PRESSURE2
    : TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE;
}

function tallPlumePressureTierStrategy(scene, pressureStrategy) {
  return normalizeVolumeScene(scene) === 'tall_plume' && pressureStrategy === PRESSURE_STRATEGY_SPATIAL_TIERS
    ? TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY
    : TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE;
}

function normalizePressureTierControls(value = {}) {
  const lowerMax = clampFinite(value.pressureTierLowerMax ?? value.lowerMax, 0.10, 0.98, DEFAULT_PRESSURE_TIER_LOWER_MAX);
  const rawHeroMax = clampFinite(value.pressureTierHeroMax ?? value.heroMax, 0.02, Math.min(0.98, lowerMax), DEFAULT_PRESSURE_TIER_HERO_MAX);
  const heroMin = clampFinite(value.pressureTierHeroMin ?? value.heroMin, 0, Math.min(0.95, Math.max(0, rawHeroMax - 0.01)), DEFAULT_PRESSURE_TIER_HERO_MIN);
  const heroMax = clampFinite(rawHeroMax, heroMin + 0.01, Math.min(0.98, lowerMax), DEFAULT_PRESSURE_TIER_HERO_MAX);
  const overlay = clampFinite(value.pressureTierOverlay ?? value.overlay, 0, 1, DEFAULT_PRESSURE_TIER_OVERLAY);
  return { lowerMax, heroMin, heroMax, overlay };
}

function pressureTierDispatchMaxY(gridSize, tierWorkgroupsY) {
  const cells = Math.max(1, Math.min(gridSize, tierWorkgroupsY * 4));
  return (cells - 1) / Math.max(1, gridSize - 1);
}

function pressureTierDispatchPlan(gridSize, pressureStrategy, scene, pressureTierControls = {}) {
  const spatial = normalizeVolumeScene(scene) === 'tall_plume' && pressureStrategy === PRESSURE_STRATEGY_SPATIAL_TIERS;
  const tierControls = normalizePressureTierControls(pressureTierControls);
  const workgroups = Math.ceil(gridSize / 4);
  const fullCells = gridCellCount(gridSize);
  if (!spatial) {
    return {
      strategy: TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE,
      projectionReadStrategy: PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER,
      maxTierIterations: 0,
      fullGridPasses: 0,
      partialSlabPasses: 0,
      equivalentPasses: 0,
      dispatches: [],
      bounds: null,
      requestedBounds: null,
      effectiveBounds: null,
      bufferOwnership: null,
    };
  }
  const lowerWorkgroupsY = Math.max(1, Math.min(workgroups, Math.ceil(Math.ceil(gridSize * tierControls.lowerMax) / 4)));
  const heroWorkgroupsY = Math.max(1, Math.min(workgroups, Math.ceil(Math.ceil(gridSize * tierControls.heroMax) / 4)));
  const lowerDispatchCells = gridSize * gridSize * Math.min(gridSize, lowerWorkgroupsY * 4);
  const heroDispatchCells = gridSize * gridSize * Math.min(gridSize, heroWorkgroupsY * 4);
  const equivalentPasses = 1 + lowerDispatchCells / fullCells + heroDispatchCells / fullCells;
  const requestedBounds = {
    pressure1: { minY: 0, maxY: 1, buffer: 'B' },
    pressure2: { minY: 0, maxY: tierControls.lowerMax, buffer: 'A' },
    pressure3: { minY: tierControls.heroMin, maxY: tierControls.heroMax, buffer: 'B' },
  };
  const effectiveBounds = {
    pressure1: { minY: 0, maxY: 1, buffer: 'B' },
    pressure2: { minY: 0, maxY: pressureTierDispatchMaxY(gridSize, lowerWorkgroupsY), buffer: 'A' },
    pressure3: { minY: tierControls.heroMin, maxY: pressureTierDispatchMaxY(gridSize, heroWorkgroupsY), buffer: 'B' },
  };
  return {
    strategy: TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY,
    projectionReadStrategy: PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE,
    maxTierIterations: 3,
    fullGridPasses: 1,
    partialSlabPasses: 2,
    equivalentPasses,
    dispatches: [
      { tier: 1, label: 'full-volume-pressure1', workgroupsX: workgroups, workgroupsY: workgroups, workgroupsZ: workgroups, pressureBuffer: 'B' },
      { tier: 2, label: 'lower-plume-pressure2', workgroupsX: workgroups, workgroupsY: lowerWorkgroupsY, workgroupsZ: workgroups, pressureBuffer: 'A' },
      { tier: 3, label: 'hero-fire-band-pressure3', workgroupsX: workgroups, workgroupsY: heroWorkgroupsY, workgroupsZ: workgroups, pressureBuffer: 'B' },
    ],
    bounds: requestedBounds,
    requestedBounds,
    effectiveBounds,
    bufferOwnership: {
      pressure1: 'B',
      pressure2: 'A',
      pressure3: 'B',
      projectionCompositeBinding0: 'B',
      projectionCompositeBinding1: 'A',
    },
  };
}

function normalizeSimProfileFlag(value) {
  if (value === true || value === 1) return true;
  const text = String(value ?? '').toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function externalEmitterNowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function syntheticHandTrailEmitters(nowMs = externalEmitterNowMs()) {
  const t = nowMs * 0.001;
  const emitters = [];
  for (let i = 0; i < 5; i += 1) {
    const f = i - 2;
    const phase = t * 1.75 + i * 0.72;
    const x = f * 0.105 + Math.sin(phase * 0.81) * 0.035;
    const y = -0.58 + Math.sin(phase * 0.63) * 0.28 + i * 0.012;
    const z = Math.cos(phase * 0.74) * 0.055;
    const dx = Math.cos(phase * 1.17) * 0.075;
    const dy = 0.05 + Math.sin(phase * 0.91) * 0.045;
    const dz = Math.sin(phase * 1.23) * 0.055;
    emitters.push({
      start: [x - dx, y - dy, z - dz],
      end: [x + dx, y + dy, z + dz],
      radius: 0.030 + i * 0.002,
      strength: 0.92,
      velocity: [dx * 2.2, 0.20 + dy * 1.8, dz * 2.0],
      smoke: 0.62,
      heat: 1.08,
      fuel: 0.72,
      flame: 1.18,
      detail: 0.82,
      lifetime: 0.55,
      active: true,
    });
  }
  return emitters;
}

function normalizeExternalEmitters(payload = {}, nowMs = externalEmitterNowMs()) {
  const emitters = Array.isArray(payload.emitters) ? payload.emitters.slice(0, MAX_EXTERNAL_EMITTERS) : [];
  const data = new Float32Array(MAX_EXTERNAL_EMITTERS * EXTERNAL_EMITTER_COMPONENTS);
  const timestampMs = clampFinite(payload.timestampMs, 0, Number.MAX_SAFE_INTEGER, nowMs);
  const ageSeconds = Math.max(0, (nowMs - timestampMs) / 1000);
  const coordinateSpace = 'volume-local';
  let count = 0;
  for (const emitter of emitters) {
    if (!emitter || emitter.active === false) continue;
    const start = Array.isArray(emitter.start) ? emitter.start : [0, -0.72, 0];
    const end = Array.isArray(emitter.end) ? emitter.end : start;
    const velocity = Array.isArray(emitter.velocity) ? emitter.velocity : [0, 0.18, 0];
    const offset = count * EXTERNAL_EMITTER_COMPONENTS;
    data[offset] = clampFinite(start[0], -1.5, 1.5, 0);
    data[offset + 1] = clampFinite(start[1], -1.5, 1.5, -0.72);
    data[offset + 2] = clampFinite(start[2], -1.5, 1.5, 0);
    data[offset + 3] = clampFinite(emitter.radius, 0.006, 0.18, 0.028);
    data[offset + 4] = clampFinite(end[0], -1.5, 1.5, data[offset]);
    data[offset + 5] = clampFinite(end[1], -1.5, 1.5, data[offset + 1]);
    data[offset + 6] = clampFinite(end[2], -1.5, 1.5, data[offset + 2]);
    data[offset + 7] = clampFinite(emitter.strength, 0, 4, 1);
    data[offset + 8] = clampFinite(velocity[0], -3, 3, 0);
    data[offset + 9] = clampFinite(velocity[1], -3, 3, 0.18);
    data[offset + 10] = clampFinite(velocity[2], -3, 3, 0);
    data[offset + 11] = clampFinite(emitter.ageSeconds, 0, 10, ageSeconds);
    data[offset + 12] = clampFinite(emitter.smoke, 0, 3, 0.62);
    data[offset + 13] = clampFinite(emitter.heat, 0, 4, 1.08);
    data[offset + 14] = clampFinite(emitter.fuel, 0, 3, 0.72);
    data[offset + 15] = clampFinite(emitter.flame, 0, 4, 1.18);
    data[offset + 16] = clampFinite(emitter.detail, 0, 3, 0.82);
    data[offset + 17] = clampFinite(emitter.lifetime, 0.016, 8, 0.55);
    data[offset + 18] = 0;
    data[offset + 19] = 1;
    count += 1;
  }
  return {
    data,
    count,
    mode: payload.mode || (count > 0 ? 'external' : 'off'),
    coordinateSpace: count > 0 ? coordinateSpace : 'none',
    timestampMs,
    frameId: payload.frameId ?? null,
    ageMs: Math.max(0, nowMs - timestampMs),
  };
}

const WGSL = /* wgsl */`
override GRID: u32 = 64u;
override MAJORANT_GRID: u32 = 24u;
const SLOTS_PER_CELL: u32 = 4u;
const MAX_EXTERNAL_EMITTERS_WGSL: u32 = 32u;

struct Uniforms {
  invViewProj: mat4x4<f32>,
  cameraPos_time: vec4<f32>,
  viewport_steps_density: vec4<f32>,
  fire_smoke_curl_speed: vec4<f32>,
  grid_overlay_debug: vec4<f32>,
  source_controls: vec4<f32>,
  radiance_controls: vec4<f32>,
  occupancy_controls: vec4<f32>,
  temporal_controls: vec4<f32>,
  scale_controls: vec4<f32>,
  scene_controls: vec4<f32>,
  bonfire_ablation_controls: vec4<f32>,
  bonfire_ablation_controls2: vec4<f32>,
  canonical_controls: vec4<f32>,
  canonical_source_controls: vec4<f32>,
  canonical_render_motion_controls: vec4<f32>,
  pressure_tier_controls: vec4<f32>,
  primitive_source: vec4<f32>,
  pyro_detail_controls: vec4<f32>,
  pyro_detail_cells: array<vec4<f32>, 24>,
  pyro_carrier_controls: vec4<f32>,
  pyro_diagnostic_controls: vec4<f32>,
  pyro_shape_controls: vec4<f32>,
  pyro_light_controls: vec4<f32>,
  pyro_color_controls: vec4<f32>,
  pyro_route_controls: vec4<f32>,
  pyro_radiance_route_controls: vec4<f32>,
  pyro_luma_controls: vec4<f32>,
  pyro_luma_controls2: vec4<f32>,
  pyro_bite_stack_controls: vec4<f32>,
  pyro_bite_stack_controls2: vec4<f32>,
  pyro_flow_controls: vec4<f32>,
  pyro_flow_controls2: vec4<f32>,
  pyro_palette_flame: vec4<f32>,
  pyro_palette_flame_edge: vec4<f32>,
  pyro_palette_bite: vec4<f32>,
  pyro_palette_bite_hot: vec4<f32>,
  pyro_palette_wake: vec4<f32>,
  pyro_palette_wake_ember: vec4<f32>,
  pyro_palette_radiance: vec4<f32>,
  pyro_palette_radiance_warm: vec4<f32>,
  pyro_palette_flow: vec4<f32>,
  pyro_palette_flow_hot: vec4<f32>,
  topology_shell_controls: vec4<f32>,
  topology_shell_carriers: vec4<f32>,
  topology_shell_shape: vec4<f32>,
  topology_shell_transport: vec4<f32>,
  topology_shell_light: vec4<f32>,
  boundary_fire_structure: vec4<f32>,
  boundary_fire_color: vec4<f32>,
  boundary_fire_display: vec4<f32>,
  boundary_sidecar_controls: vec4<f32>,
  boundary_sidecar_display: vec4<f32>,
  selective_live_render_controls: vec4<f32>,
  oracle_activity_controls: vec4<f32>,
  oracle_activity_controls2: vec4<f32>,
  previousViewProj: mat4x4<f32>,
};

struct ExternalEmitter {
  start_radius: vec4<f32>,
  end_strength: vec4<f32>,
  velocity_age: vec4<f32>,
  material: vec4<f32>,
  detail_lifetime: vec4<f32>,
};

struct ExternalEmitterInfluence {
  material: vec4<f32>,
  fire: vec4<f32>,
  micro: vec4<f32>,
  velocity: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> fluidSrc: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> fluidDst: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> majorantField: array<vec4<f32>>;
@group(0) @binding(4) var historyTexture: texture_2d<f32>;
@group(0) @binding(5) var historySampler: sampler;
@group(0) @binding(6) var<storage, read> externalEmitters: array<ExternalEmitter>;
@group(0) @binding(7) var<storage, read> frontSrc: array<f32>;
@group(0) @binding(8) var<storage, read_write> frontDst: array<f32>;
@group(0) @binding(9) var<storage, read> oracleActivityCue: array<f32>;
@group(0) @binding(10) var<storage, read> boundarySidecar: array<vec4<f32>>;
@group(1) @binding(0) var<storage, read_write> majorantDst: array<vec4<f32>>;
@group(2) @binding(0) var<storage, read> pressureSrc: array<vec4<f32>>;
@group(2) @binding(1) var<storage, read_write> pressureDst: array<vec4<f32>>;
@group(3) @binding(0) var<storage, read_write> boundarySidecarDst: array<vec4<f32>>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  out.uv = p[i] * 0.5 + vec2<f32>(0.5);
  return out;
}

fn hash31(p: vec3<f32>) -> f32 {
  let q = fract(p * 0.1031);
  let r = q + dot(q, q.yzx + 33.33);
  return fract((r.x + r.y) * r.z);
}

fn sampleHistoryColor(uv: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(historyTexture, historySampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
}

fn temporalReprojectionUv(worldPos: vec3<f32>, velocity: vec3<f32>, confidence: f32) -> vec3<f32> {
  let historyLag = mix(0.012, 0.042, clamp(confidence, 0.0, 1.0));
  let previousWorld = worldPos - velocity * historyLag;
  let clip = u.previousViewProj * vec4<f32>(previousWorld, 1.0);
  let safeW = max(abs(clip.w), 0.0001);
  let ndc = clip.xy / safeW;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
  let validX = step(0.0, uv.x) * step(uv.x, 1.0);
  let validY = step(0.0, uv.y) * step(uv.y, 1.0);
  let validW = step(0.0001, clip.w);
  return vec3<f32>(uv, validX * validY * validW);
}

fn temporalReprojectionConfidence(materialWeight: f32, majorantEdge: f32, reactiveSignal: f32) -> f32 {
  let materialConfidence = smoothstep(0.012, 0.18, materialWeight);
  let edgePenalty = 1.0 - smoothstep(0.05, 0.34, majorantEdge);
  let reactivePenalty = 1.0 - smoothstep(0.18, 1.15, reactiveSignal);
  return clamp(materialConfidence * edgePenalty * reactivePenalty, 0.0, 1.0);
}

fn temporalJitterOffset(uv: vec2<f32>, dtBase: f32) -> f32 {
  let temporalJitter = clamp(u.temporal_controls.y, 0.0, 1.0);
  let temporalFrame = u.temporal_controls.w;
  let pixel = floor(uv * u.viewport_steps_density.xy);
  let interleaved = hash31(vec3<f32>(pixel + vec2<f32>(temporalFrame * 17.0, temporalFrame * 29.0), temporalFrame));
  let r2 = fract(temporalFrame * 0.754877666 + interleaved * 0.569840296);
  return mix(0.5, r2, temporalJitter) * dtBase;
}

fn temporalHistoryClamp(history: vec3<f32>, current: vec3<f32>, clampStrength: f32) -> vec3<f32> {
  let currentLuma = dot(current, vec3<f32>(0.2126, 0.7152, 0.0722));
  let historyLuma = dot(history, vec3<f32>(0.2126, 0.7152, 0.0722));
  let energyDelta = abs(currentLuma - historyLuma);
  let fireTighten = smoothstep(0.42, 0.92, max(current.r, current.g));
  let radius = mix(vec3<f32>(0.26), vec3<f32>(0.045), clampStrength) + current * mix(0.10, 0.035, fireTighten) + vec3<f32>(energyDelta * 0.045);
  return clamp(history, max(vec3<f32>(0.0), current - radius), current + radius);
}

fn cheapTemporalRamp(x: f32, lo: f32, hi: f32) -> f32 {
  return clamp((x - lo) / max(hi - lo, 0.0001), 0.0, 1.0);
}

struct MaterialTemporalSignals {
  lanes: vec4<f32>,
  protectedDetail: f32,
  sampleWeight: f32,
  reactiveBoost: f32,
};

fn materialTemporalSignals(alpha: f32, smokeAlpha: f32, fireAlpha: f32, temp: f32, microTextureSignal: f32, interfaceShred: f32, fireLick: f32, majorantEdge: f32, interest: f32, trans: f32) -> MaterialTemporalSignals {
  let fireHistoryProtect = clamp(
    cheapTemporalRamp(fireAlpha, 0.010, 0.105)
      + cheapTemporalRamp(temp, 0.40, 1.18) * 0.70
      + cheapTemporalRamp(fireLick, 0.045, 0.36) * 0.36,
    0.0,
    1.0
  );
  let interfaceSignal = interfaceShred * 1.30 + fireLick * 0.34 + majorantEdge * 0.82;
  let detailSignal = microTextureSignal + interest * 0.20;
  let interfaceHistoryProtect = clamp(
    cheapTemporalRamp(interfaceSignal, 0.035, 0.52)
      + cheapTemporalRamp(detailSignal, 0.22, 1.20) * 0.30,
    0.0,
    1.0
  );
  let detailHistoryProtect = clamp(
    cheapTemporalRamp(detailSignal, 0.24, 1.35) * 0.74
      + interfaceHistoryProtect * 0.26,
    0.0,
    1.0
  );
  let smokeBody = cheapTemporalRamp(smokeAlpha, 0.012, 0.13) * (1.0 - cheapTemporalRamp(fireAlpha, 0.006, 0.075));
  let smokeHistoryTrust = clamp(
    smokeBody * (1.0 - fireHistoryProtect * 0.82) * (1.0 - interfaceHistoryProtect * 0.52)
      + cheapTemporalRamp(smokeAlpha, 0.025, 0.22) * 0.12,
    0.0,
    1.0
  );
  let protectedDetail = max(fireHistoryProtect, max(interfaceHistoryProtect, detailHistoryProtect));
  let smokeCarrier = smokeAlpha * (1.35 + smokeHistoryTrust * 0.68);
  let hotCarrier = fireAlpha * (3.10 + protectedDetail * 1.20);
  let edgeCarrier = interest * (0.030 + protectedDetail * 0.040);
  let sampleWeight = clamp((alpha * 2.20 + smokeCarrier + hotCarrier + edgeCarrier) * trans, 0.0, 1.0);
  let reactiveBoost = fireHistoryProtect * 0.36 + interfaceHistoryProtect * 0.22;
  return MaterialTemporalSignals(vec4<f32>(smokeHistoryTrust, fireHistoryProtect, interfaceHistoryProtect, detailHistoryProtect), protectedDetail, sampleWeight, reactiveBoost);
}

fn materialTemporalClassificationFromSignals(signals: MaterialTemporalSignals) -> vec4<f32> {
  return signals.lanes;
}

fn materialTemporalClassification(smokeAlpha: f32, fireAlpha: f32, temp: f32, microTextureSignal: f32, interfaceShred: f32, fireLick: f32, majorantEdge: f32, interest: f32) -> vec4<f32> {
  return materialTemporalClassificationFromSignals(materialTemporalSignals(smokeAlpha + fireAlpha, smokeAlpha, fireAlpha, temp, microTextureSignal, interfaceShred, fireLick, majorantEdge, interest, 1.0));
}

fn materialAwareImportanceWeightFromSignals(signals: MaterialTemporalSignals) -> f32 {
  return signals.sampleWeight;
}

fn materialAwareImportanceWeight(alpha: f32, smokeAlpha: f32, fireAlpha: f32, interest: f32, materialTemporal: vec4<f32>, trans: f32) -> f32 {
  let protectedDetail = max(materialTemporal.y, max(materialTemporal.z, materialTemporal.w));
  let smokeCarrier = smokeAlpha * (1.35 + materialTemporal.x * 0.68);
  let hotCarrier = fireAlpha * (3.10 + protectedDetail * 1.20);
  let edgeCarrier = interest * (0.030 + protectedDetail * 0.040);
  return clamp((alpha * 2.20 + smokeCarrier + hotCarrier + edgeCarrier) * trans, 0.0, 1.0);
}

fn materialAwareTemporalWeights(smokeHistoryTrustSum: f32, fireHistoryProtectSum: f32, interfaceHistoryProtectSum: f32, detailHistoryProtectSum: f32, materialWeight: f32) -> vec4<f32> {
  let inv = 1.0 / max(materialWeight, 0.0001);
  let fireHistoryProtect = clamp(fireHistoryProtectSum * inv, 0.0, 1.0);
  let interfaceHistoryProtect = clamp(interfaceHistoryProtectSum * inv, 0.0, 1.0);
  let detailHistoryProtect = clamp(detailHistoryProtectSum * inv, 0.0, 1.0);
  let smokeHistoryTrust = clamp(smokeHistoryTrustSum * inv * (1.0 - fireHistoryProtect * 0.58) * (1.0 - interfaceHistoryProtect * 0.40), 0.0, 1.0);
  return vec4<f32>(smokeHistoryTrust, fireHistoryProtect, interfaceHistoryProtect, detailHistoryProtect);
}

fn temporalReactiveMask(current: vec3<f32>, history: vec3<f32>, confidence: f32, reactiveSignal: f32, majorantEdge: f32, historyUvValid: f32, materialTemporalWeights: vec4<f32>) -> f32 {
  let currentLuma = dot(current, vec3<f32>(0.2126, 0.7152, 0.0722));
  let historyLuma = dot(history, vec3<f32>(0.2126, 0.7152, 0.0722));
  let currentHot = max(current.r, current.g);
  let historyHot = max(history.r, history.g);
  let smokeHistoryTrust = materialTemporalWeights.x;
  let fireHistoryProtect = materialTemporalWeights.y;
  let interfaceHistoryProtect = materialTemporalWeights.z;
  let detailHistoryProtect = materialTemporalWeights.w;
  let hotMismatch = smoothstep(0.055, 0.27, abs(historyHot - currentHot));
  let colorMismatch = smoothstep(0.045, 0.24, length(history - current));
  let fireReactive = smoothstep(0.22, 0.76, currentHot) * 0.78 + smoothstep(0.30, 1.10, reactiveSignal) * 0.82 + fireHistoryProtect * 0.76;
  let smokeBodyLoss = smoothstep(0.025, 0.16, historyLuma - currentLuma) * (1.0 - smokeHistoryTrust * 0.42);
  let edgeReactive = smoothstep(0.08, 0.34, majorantEdge) + interfaceHistoryProtect * 0.58 + detailHistoryProtect * 0.28;
  let invalid = 1.0 - historyUvValid * step(0.03, confidence);
  return clamp(max(max(hotMismatch, colorMismatch), max(fireReactive, max(smokeBodyLoss, edgeReactive))) + invalid, 0.0, 1.0);
}

fn temporalHistoryWeight(current: vec3<f32>, history: vec3<f32>, confidence: f32, reactiveMask: f32, materialTemporalWeights: vec4<f32>) -> f32 {
  let temporalAccum = clamp(u.temporal_controls.x, 0.0, 0.90);
  let currentLuma = dot(current, vec3<f32>(0.2126, 0.7152, 0.0722));
  let historyLuma = dot(history, vec3<f32>(0.2126, 0.7152, 0.0722));
  let currentHot = max(current.r, current.g);
  let historyHot = max(history.r, history.g);
  let smokeHistoryTrust = materialTemporalWeights.x;
  let fireHistoryProtect = materialTemporalWeights.y;
  let interfaceHistoryProtect = materialTemporalWeights.z;
  let detailHistoryProtect = materialTemporalWeights.w;
  let fireProtect = max(smoothstep(0.38, 0.82, currentHot), fireHistoryProtect);
  let hotMismatch = smoothstep(0.08, 0.34, abs(historyHot - currentHot));
  let colorMismatch = smoothstep(0.05, 0.28, length(history - current));
  let currentSupport = max(smoothstep(0.035, 0.18, currentLuma), smokeHistoryTrust * 0.26);
  let fadingTrailReject = 1.0 - smoothstep(0.018, 0.12, historyLuma - currentLuma);
  let smokeHistoryGain = mix(0.34, 1.08, smokeHistoryTrust);
  let materialProtection = (1.0 - fireProtect * 0.90) * (1.0 - interfaceHistoryProtect * 0.68) * (1.0 - detailHistoryProtect * 0.34);
  return temporalAccum * confidence * currentSupport * smokeHistoryGain * fadingTrailReject * (1.0 - reactiveMask) * materialProtection * (1.0 - hotMismatch * 0.82) * (1.0 - colorMismatch * 0.70);
}

fn temporalResolveColor(current: vec3<f32>, sameScreenUv: vec2<f32>, reprojectedUv: vec2<f32>, reprojectionConfidence: f32, reactiveSignal: f32, majorantEdge: f32, historyUvValid: f32, materialTemporalWeights: vec4<f32>) -> vec3<f32> {
  let historyClampStrength = clamp(u.temporal_controls.z, 0.0, 1.0);
  let uv = mix(sameScreenUv, reprojectedUv, smoothstep(0.04, 0.30, reprojectionConfidence) * historyUvValid);
  let history = sampleHistoryColor(uv);
  let clampedHistory = temporalHistoryClamp(history, current, historyClampStrength);
  let reactiveMask = temporalReactiveMask(current, history, reprojectionConfidence, reactiveSignal, majorantEdge, historyUvValid, materialTemporalWeights);
  let historyWeight = temporalHistoryWeight(current, history, reprojectionConfidence, reactiveMask, materialTemporalWeights);
  return mix(current, clampedHistory, historyWeight);
}

fn rotate2(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn index3(c: vec3<u32>) -> u32 {
  return c.x + c.y * GRID + c.z * GRID * GRID;
}

fn clampCell(c: vec3<i32>) -> vec3<u32> {
  return vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(GRID) - 1)));
}

fn slotIndex(c: vec3<i32>, slot: u32) -> u32 {
  return index3(clampCell(c)) * SLOTS_PER_CELL + slot;
}

fn readSlot(c: vec3<i32>, slot: u32) -> vec4<f32> {
  return fluidSrc[slotIndex(c, slot)];
}

fn readFrontField(c: vec3<i32>) -> f32 {
  return frontSrc[index3(clampCell(c))];
}

fn sampleFrontField(cellCenter: vec3<f32>) -> f32 {
  let pc = clamp(cellCenter - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.001));
  let i0 = vec3<i32>(floor(pc));
  let f = fract(pc);
  let c000 = readFrontField(i0 + vec3<i32>(0, 0, 0));
  let c100 = readFrontField(i0 + vec3<i32>(1, 0, 0));
  let c010 = readFrontField(i0 + vec3<i32>(0, 1, 0));
  let c110 = readFrontField(i0 + vec3<i32>(1, 1, 0));
  let c001 = readFrontField(i0 + vec3<i32>(0, 0, 1));
  let c101 = readFrontField(i0 + vec3<i32>(1, 0, 1));
  let c011 = readFrontField(i0 + vec3<i32>(0, 1, 1));
  let c111 = readFrontField(i0 + vec3<i32>(1, 1, 1));
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleFluidSlot(cellCenter: vec3<f32>, slot: u32) -> vec4<f32> {
  let pc = clamp(cellCenter - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.001));
  let i0 = vec3<i32>(floor(pc));
  let f = fract(pc);
  let c000 = readSlot(i0 + vec3<i32>(0, 0, 0), slot);
  let c100 = readSlot(i0 + vec3<i32>(1, 0, 0), slot);
  let c010 = readSlot(i0 + vec3<i32>(0, 1, 0), slot);
  let c110 = readSlot(i0 + vec3<i32>(1, 1, 0), slot);
  let c001 = readSlot(i0 + vec3<i32>(0, 0, 1), slot);
  let c101 = readSlot(i0 + vec3<i32>(1, 0, 1), slot);
  let c011 = readSlot(i0 + vec3<i32>(0, 1, 1), slot);
  let c111 = readSlot(i0 + vec3<i32>(1, 1, 1), slot);
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleWorldVelocity(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * f32(GRID);
  return sampleFluidSlot(cell, 0u);
}

fn sampleWorldMaterial(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * f32(GRID);
  return sampleFluidSlot(cell, 1u);
}

fn sampleWorldFireLayer(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * f32(GRID);
  return sampleFluidSlot(cell, 2u);
}

fn sampleWorldMicrodetail(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * f32(GRID);
  return sampleFluidSlot(cell, 3u);
}

fn sampleWorldFrontField(p: vec3<f32>) -> f32 {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * f32(GRID);
  return sampleFrontField(cell);
}

fn sampleBoundarySidecarCell(c: vec3<i32>) -> vec4<f32> {
  return boundarySidecar[index3(clampCell(c))];
}

fn sampleWorldBoundarySidecar(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(GRID) - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.001));
  let i0 = vec3<i32>(floor(q));
  let f = fract(q);
  let c000 = sampleBoundarySidecarCell(i0 + vec3<i32>(0, 0, 0));
  let c100 = sampleBoundarySidecarCell(i0 + vec3<i32>(1, 0, 0));
  let c010 = sampleBoundarySidecarCell(i0 + vec3<i32>(0, 1, 0));
  let c110 = sampleBoundarySidecarCell(i0 + vec3<i32>(1, 1, 0));
  let c001 = sampleBoundarySidecarCell(i0 + vec3<i32>(0, 0, 1));
  let c101 = sampleBoundarySidecarCell(i0 + vec3<i32>(1, 0, 1));
  let c011 = sampleBoundarySidecarCell(i0 + vec3<i32>(0, 1, 1));
  let c111 = sampleBoundarySidecarCell(i0 + vec3<i32>(1, 1, 1));
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn majorantIndex(c: vec3<u32>) -> u32 {
  return c.x + c.y * MAJORANT_GRID + c.z * MAJORANT_GRID * MAJORANT_GRID;
}

fn materialMajorantFromSlots(velocityDensity: vec4<f32>, material: vec4<f32>, fireLayer: vec4<f32>, microLayer: vec4<f32>, combustionFrontTopology: f32) -> vec4<f32> {
  let velMag = length(velocityDensity.xyz);
  let smoke = material.x + microLayer.x * 0.52 + microLayer.y * 0.34;
  let fire = fireLayer.x * 1.25 + fireLayer.y * 0.42 + fireLayer.z * 0.55 + fireLayer.w * 0.72 + combustionFrontTopology * 0.35 + microLayer.z * 0.70 + material.y * 0.28;
  let density = max(velocityDensity.w, smoke * 0.82 + material.y * 0.22 + material.w * 0.18);
  let extinction = smoke * 0.62 + microLayer.y * 0.36 + material.w * 0.16;
  let importance = clamp(density * 0.50 + extinction * 0.40 + fire * 0.44 + combustionFrontTopology * 0.12 + velMag * 0.36, 0.0, 3.0);
  return vec4<f32>(density, fire, extinction, importance);
}

fn sampleWorldMajorant(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  return majorantField[majorantIndex(vec3<u32>(floor(q)))];
}

fn sampleMajorantCell(c: vec3<i32>) -> vec4<f32> {
  let cell = vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(MAJORANT_GRID) - 1)));
  return majorantField[majorantIndex(cell)];
}

fn sampleWorldMajorantLinear(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * (f32(MAJORANT_GRID) - 1.0), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 1.001));
  let i0 = vec3<i32>(floor(q));
  let f = fract(q);
  let c000 = sampleMajorantCell(i0 + vec3<i32>(0, 0, 0));
  let c100 = sampleMajorantCell(i0 + vec3<i32>(1, 0, 0));
  let c010 = sampleMajorantCell(i0 + vec3<i32>(0, 1, 0));
  let c110 = sampleMajorantCell(i0 + vec3<i32>(1, 1, 0));
  let c001 = sampleMajorantCell(i0 + vec3<i32>(0, 0, 1));
  let c101 = sampleMajorantCell(i0 + vec3<i32>(1, 0, 1));
  let c011 = sampleMajorantCell(i0 + vec3<i32>(0, 1, 1));
  let c111 = sampleMajorantCell(i0 + vec3<i32>(1, 1, 1));
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleWorldMajorantDilated(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let c = vec3<i32>(floor(q));
  var m = sampleMajorantCell(c);
  m = max(m, sampleMajorantCell(c + vec3<i32>(1, 0, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(-1, 0, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 1, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, -1, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 0, 1)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 0, -1)));
  return m;
}

fn majorantGradientSignal(p: vec3<f32>) -> f32 {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let c = vec3<i32>(floor(q));
  let x0 = sampleMajorantCell(c + vec3<i32>(-1, 0, 0)).w;
  let x1 = sampleMajorantCell(c + vec3<i32>(1, 0, 0)).w;
  let y0 = sampleMajorantCell(c + vec3<i32>(0, -1, 0)).w;
  let y1 = sampleMajorantCell(c + vec3<i32>(0, 1, 0)).w;
  let z0 = sampleMajorantCell(c + vec3<i32>(0, 0, -1)).w;
  let z1 = sampleMajorantCell(c + vec3<i32>(0, 0, 1)).w;
  return clamp(abs(x1 - x0) + abs(y1 - y0) + abs(z1 - z0), 0.0, 1.5);
}

fn majorantCellExitDistance(p: vec3<f32>, rd: vec3<f32>) -> f32 {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let dqdt = rd * (0.5 * f32(MAJORANT_GRID));
  var best = 1.0e6;
  if (abs(dqdt.x) > 0.0001) {
    let bx = select(floor(q.x), floor(q.x) + 1.0, dqdt.x > 0.0);
    let tx = (bx - q.x) / dqdt.x;
    if (tx > 0.0001) { best = min(best, tx); }
  }
  if (abs(dqdt.y) > 0.0001) {
    let by = select(floor(q.y), floor(q.y) + 1.0, dqdt.y > 0.0);
    let ty = (by - q.y) / dqdt.y;
    if (ty > 0.0001) { best = min(best, ty); }
  }
  if (abs(dqdt.z) > 0.0001) {
    let bz = select(floor(q.z), floor(q.z) + 1.0, dqdt.z > 0.0);
    let tz = (bz - q.z) / dqdt.z;
    if (tz > 0.0001) { best = min(best, tz); }
  }
  return min(best, 0.20);
}

fn curlAtCell(c: vec3<i32>) -> vec3<f32> {
  let vx0 = readSlot(c + vec3<i32>(-1, 0, 0), 0u).xyz;
  let vx1 = readSlot(c + vec3<i32>( 1, 0, 0), 0u).xyz;
  let vy0 = readSlot(c + vec3<i32>(0, -1, 0), 0u).xyz;
  let vy1 = readSlot(c + vec3<i32>(0,  1, 0), 0u).xyz;
  let vz0 = readSlot(c + vec3<i32>(0, 0, -1), 0u).xyz;
  let vz1 = readSlot(c + vec3<i32>(0, 0,  1), 0u).xyz;
  return vec3<f32>(
    (vy1.z - vy0.z) - (vz1.y - vz0.y),
    (vz1.x - vz0.x) - (vx1.z - vx0.z),
    (vx1.y - vx0.y) - (vy1.x - vy0.x)
  ) * 0.5;
}

fn curlMagnitudeAtCell(c: vec3<i32>) -> f32 {
  return length(curlAtCell(c));
}

fn divergenceAtCell(c: vec3<i32>) -> f32 {
  let vx0 = readSlot(c + vec3<i32>(-1, 0, 0), 0u).x;
  let vx1 = readSlot(c + vec3<i32>( 1, 0, 0), 0u).x;
  let vy0 = readSlot(c + vec3<i32>(0, -1, 0), 0u).y;
  let vy1 = readSlot(c + vec3<i32>(0,  1, 0), 0u).y;
  let vz0 = readSlot(c + vec3<i32>(0, 0, -1), 0u).z;
  let vz1 = readSlot(c + vec3<i32>(0, 0,  1), 0u).z;
  return ((vx1 - vx0) + (vy1 - vy0) + (vz1 - vz0)) * 0.5;
}

fn proceduralReceiverActivityCue(c: vec3<i32>) -> f32 {
  let flowEnergy = curlMagnitudeAtCell(c) + abs(divergenceAtCell(c));
  let fireLayer = readSlot(c, 2u);
  let microLayer = readSlot(c, 3u);
  let front = readFrontField(c);
  let materialEnergy = max(max(fireLayer.x, fireLayer.z), max(microLayer.y, front));
  return clamp(max(smoothstep(0.010, 0.13, flowEnergy), smoothstep(0.025, 0.74, materialEnergy) * 0.72), 0.0, 1.0);
}

fn rawTruthOracleActivityCueAtCell(c: vec3<i32>) -> f32 {
  let safe = clamp(c, vec3<i32>(0), vec3<i32>(i32(GRID) - 1));
  let idx = u32(safe.x) + u32(safe.y) * GRID + u32(safe.z) * GRID * GRID;
  let externalCue = clamp(oracleActivityCue[idx], 0.0, 1.0);
  let proceduralCue = proceduralReceiverActivityCue(c);
  let externalCueEnabled = step(0.5, u.oracle_activity_controls2.y);
  return clamp(mix(proceduralCue, externalCue, externalCueEnabled), 0.0, 1.0);
}

fn truthOracleActivityCueAtCell(c: vec3<i32>) -> f32 {
  return rawTruthOracleActivityCueAtCell(c) * clamp(u.oracle_activity_controls.x, 0.0, 1.0);
}

fn oracleActivityCurlNoiseForce(c: vec3<i32>, p: vec3<f32>, time: f32, cue: f32, gain: f32) -> vec3<f32> {
  let amount = clamp(cue * gain, 0.0, 3.0);
  let base = turbulentDetailForce(p * 2.05 + vec3<f32>(0.17, -0.23, 0.11), time * 1.37 + f32(c.x + c.y * 3 + c.z * 7) * 0.0009);
  let crossA = cross(normalize(base + vec3<f32>(0.001)), normalize(vec3<f32>(p.z, -p.x, p.y) + vec3<f32>(0.001)));
  return normalize(base + crossA * 0.55 + vec3<f32>(0.001)) * amount * 0.020;
}

fn oracleActivityVorticityConfinement(c: vec3<i32>, cue: f32, gain: f32) -> vec3<f32> {
  return vorticityConfinement(c, clamp(cue * gain, 0.0, 3.0) * 0.085);
}

fn oracleActivityMaterialBirth(cue: f32, gain: f32, heat: f32, smoke: f32, flame: f32, source: f32) -> f32 {
  let support = clamp(0.34 + heat * 0.22 + smoke * 0.10 + flame * 0.32 + source * 0.22, 0.0, 1.35);
  return clamp(cue * gain, 0.0, 3.0) * support;
}

fn pressureProjectionCorrection(c: vec3<i32>, strength: f32) -> vec3<f32> {
  let divX = divergenceAtCell(c + vec3<i32>(1, 0, 0)) - divergenceAtCell(c + vec3<i32>(-1, 0, 0));
  let divY = divergenceAtCell(c + vec3<i32>(0, 1, 0)) - divergenceAtCell(c + vec3<i32>(0, -1, 0));
  let divZ = divergenceAtCell(c + vec3<i32>(0, 0, 1)) - divergenceAtCell(c + vec3<i32>(0, 0, -1));
  let gradient = vec3<f32>(divX, divY, divZ) * 0.5;
  let center = divergenceAtCell(c);
  let localDamping = readSlot(c, 0u).xyz * center * 0.055;
  return (gradient * 0.46 + localDamping) * clamp(strength, 0.0, 1.5);
}

fn pressureIndexForCell(c: vec3<i32>) -> u32 {
  return index3(clampCell(c));
}

fn pressureRead(c: vec3<i32>) -> vec4<f32> {
  return pressureSrc[pressureIndexForCell(c)];
}

fn pressureReadAlt(c: vec3<i32>) -> vec4<f32> {
  return pressureDst[pressureIndexForCell(c)];
}

fn pressureTierY(c: vec3<i32>) -> f32 {
  return f32(clamp(c.y, 0, i32(GRID) - 1)) / max(1.0, f32(GRID - 1u));
}

fn pressureTierLowerMax() -> f32 {
  return clamp(u.pressure_tier_controls.x, 0.10, 0.98);
}

fn pressureTierHeroMin() -> f32 {
  return clamp(u.pressure_tier_controls.y, 0.0, 0.95);
}

fn pressureTierHeroMax() -> f32 {
  return max(pressureTierHeroMin() + 0.01, clamp(u.pressure_tier_controls.z, 0.02, min(0.98, pressureTierLowerMax())));
}

fn pressureTierDebugOverlayColor(y: f32) -> vec4<f32> {
  let lowerMax = pressureTierLowerMax();
  let heroMin = pressureTierHeroMin();
  let heroMax = pressureTierHeroMax();
  let inPressure2 = step(0.0, y) * step(y, lowerMax);
  let inPressure3 = step(heroMin, y) * step(y, heroMax);
  let lowerBoundary = 1.0 - smoothstep(0.004, 0.018, abs(y - lowerMax));
  let heroBoundary = max(
    1.0 - smoothstep(0.004, 0.014, abs(y - heroMin)),
    1.0 - smoothstep(0.004, 0.014, abs(y - heroMax))
  );
  let p1Color = vec3<f32>(0.07, 0.28, 0.42);
  let p2Color = vec3<f32>(0.08, 0.55, 0.95);
  let p3Color = vec3<f32>(1.0, 0.62, 0.10);
  let bandColor = mix(p1Color, p2Color, inPressure2);
  let color = mix(bandColor, p3Color, inPressure3);
  let lineBoost = clamp(lowerBoundary * 0.34 + heroBoundary * 0.46, 0.0, 0.72);
  return vec4<f32>(mix(color, vec3<f32>(1.0, 0.92, 0.52), lineBoost), clamp(u.pressure_tier_controls.w, 0.0, 1.0) * (0.32 + inPressure3 * 0.24 + lineBoost * 0.70));
}

fn samplePyroMaterialMemoryCell(p: vec3<f32>) -> vec4<f32> {
  let normalized = clamp(p * 0.5 + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(0.999));
  let lateral = clamp(normalized.x * 0.64 + normalized.z * 0.36, 0.0, 0.999);
  let cellUv = vec2<f32>(lateral * 7.0, normalized.y * 2.0);
  let col0 = u32(clamp(floor(cellUv.x), 0.0, 7.0));
  let row0 = u32(clamp(floor(cellUv.y), 0.0, 2.0));
  let col1 = min(col0 + 1u, 7u);
  let row1 = min(row0 + 1u, 2u);
  let blend = fract(cellUv);
  let memoryIndex00 = row0 * 8u + col0;
  let memoryIndex10 = row0 * 8u + col1;
  let memoryIndex01 = row1 * 8u + col0;
  let memoryIndex11 = row1 * 8u + col1;
  let lower = mix(u.pyro_detail_cells[memoryIndex00], u.pyro_detail_cells[memoryIndex10], blend.x);
  let upper = mix(u.pyro_detail_cells[memoryIndex01], u.pyro_detail_cells[memoryIndex11], blend.x);
  return mix(lower, upper, blend.y);
}

fn pressureReadComposite(c: vec3<i32>) -> vec4<f32> {
  let y = pressureTierY(c);
  if (y >= pressureTierHeroMin() && y <= pressureTierHeroMax()) {
    return pressureRead(c);
  }
  if (y <= pressureTierLowerMax()) {
    return pressureReadAlt(c);
  }
  return pressureRead(c);
}

@compute @workgroup_size(4, 4, 4)
fn csDivergencePressure(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let c = vec3<i32>(gid);
  let div = divergenceAtCell(c);
  pressureDst[index3(gid)] = vec4<f32>(div, 0.0, 0.0, 0.0);
}

@compute @workgroup_size(4, 4, 4)
fn csPressureJacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let c = vec3<i32>(gid);
  let div = divergenceAtCell(c);
  let neighborPressure =
    pressureRead(c + vec3<i32>(-1, 0, 0)).y +
    pressureRead(c + vec3<i32>( 1, 0, 0)).y +
    pressureRead(c + vec3<i32>(0, -1, 0)).y +
    pressureRead(c + vec3<i32>(0,  1, 0)).y +
    pressureRead(c + vec3<i32>(0, 0, -1)).y +
    pressureRead(c + vec3<i32>(0, 0,  1)).y;
  let pressure = (neighborPressure - div) * (1.0 / 6.0);
  pressureDst[index3(gid)] = vec4<f32>(div, pressure * 0.985, 0.0, 0.0);
}

fn pressureJacobiTiered(gid: vec3<u32>, minY: f32, maxY: f32) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let y = f32(gid.y) / max(1.0, f32(GRID - 1u));
  if (y < minY || y > maxY) {
    return;
  }
  let c = vec3<i32>(gid);
  let div = divergenceAtCell(c);
  let neighborPressure =
    pressureRead(c + vec3<i32>(-1, 0, 0)).y +
    pressureRead(c + vec3<i32>( 1, 0, 0)).y +
    pressureRead(c + vec3<i32>(0, -1, 0)).y +
    pressureRead(c + vec3<i32>(0,  1, 0)).y +
    pressureRead(c + vec3<i32>(0, 0, -1)).y +
    pressureRead(c + vec3<i32>(0, 0,  1)).y;
  let pressure = (neighborPressure - div) * (1.0 / 6.0);
  pressureDst[index3(gid)] = vec4<f32>(div, pressure * 0.985, 0.0, 0.0);
}

@compute @workgroup_size(4, 4, 4)
fn csPressureJacobiTieredLower(@builtin(global_invocation_id) gid: vec3<u32>) {
  pressureJacobiTiered(gid, 0.0, pressureTierLowerMax());
}

@compute @workgroup_size(4, 4, 4)
fn csPressureJacobiTieredHero(@builtin(global_invocation_id) gid: vec3<u32>) {
  pressureJacobiTiered(gid, pressureTierHeroMin(), pressureTierHeroMax());
}

@compute @workgroup_size(4, 4, 4)
fn csProjectPressure(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let idx = index3(gid);
  let base = idx * SLOTS_PER_CELL;
  let c = vec3<i32>(gid);
  let sceneMode = clamp(u.scene_controls.x, 0.0, 3.0);
  let canonicalPlumeScene = step(2.5, sceneMode);
  let bonfireScene = step(1.5, sceneMode) * (1.0 - canonicalPlumeScene);
  let bonfireProjectionAblation = mix(1.0, clamp(u.bonfire_ablation_controls2.y, 0.0, 1.5), bonfireScene);
  let projection = clamp(u.source_controls.z, 0.0, 1.5) * bonfireProjectionAblation;
  let pressureGradient = vec3<f32>(
    pressureRead(c + vec3<i32>(1, 0, 0)).y - pressureRead(c + vec3<i32>(-1, 0, 0)).y,
    pressureRead(c + vec3<i32>(0, 1, 0)).y - pressureRead(c + vec3<i32>(0, -1, 0)).y,
    pressureRead(c + vec3<i32>(0, 0, 1)).y - pressureRead(c + vec3<i32>(0, 0, -1)).y
  ) * 0.5;
  let velocityDensity = fluidSrc[base];
  let density = velocityDensity.w;
  let material = fluidSrc[base + 1u];
  let fireLayer = fluidSrc[base + 2u];
  let microLayer = fluidSrc[base + 3u];
  frontDst[idx] = frontSrc[idx];
  let activeMaterial = clamp(density * 0.48 + material.x * 0.24 + material.y * 0.18 + fireLayer.x * 0.18 + microLayer.x * 0.12, 0.0, 1.6);
  let projectionGain = projection * mix(0.62, 0.94, bonfireScene) * (0.42 + activeMaterial * 0.58);
  let correctedVelocity = velocityDensity.xyz - pressureGradient * projectionGain;
  fluidDst[base] = vec4<f32>(clamp(correctedVelocity, vec3<f32>(-0.34), vec3<f32>(0.52)), density);
  fluidDst[base + 1u] = material;
  fluidDst[base + 2u] = fireLayer;
  fluidDst[base + 3u] = microLayer;
}

@compute @workgroup_size(4, 4, 4)
fn csProjectPressureTiered(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let idx = index3(gid);
  let base = idx * SLOTS_PER_CELL;
  let c = vec3<i32>(gid);
  let sceneMode = clamp(u.scene_controls.x, 0.0, 3.0);
  let canonicalPlumeScene = step(2.5, sceneMode);
  let bonfireScene = step(1.5, sceneMode) * (1.0 - canonicalPlumeScene);
  let bonfireProjectionAblation = mix(1.0, clamp(u.bonfire_ablation_controls2.y, 0.0, 1.5), bonfireScene);
  let projection = clamp(u.source_controls.z, 0.0, 1.5) * bonfireProjectionAblation;
  let pressureGradient = vec3<f32>(
    pressureReadComposite(c + vec3<i32>(1, 0, 0)).y - pressureReadComposite(c + vec3<i32>(-1, 0, 0)).y,
    pressureReadComposite(c + vec3<i32>(0, 1, 0)).y - pressureReadComposite(c + vec3<i32>(0, -1, 0)).y,
    pressureReadComposite(c + vec3<i32>(0, 0, 1)).y - pressureReadComposite(c + vec3<i32>(0, 0, -1)).y
  ) * 0.5;
  let velocityDensity = fluidSrc[base];
  let density = velocityDensity.w;
  let material = fluidSrc[base + 1u];
  let fireLayer = fluidSrc[base + 2u];
  let microLayer = fluidSrc[base + 3u];
  frontDst[idx] = frontSrc[idx];
  let activeMaterial = clamp(density * 0.48 + material.x * 0.24 + material.y * 0.18 + fireLayer.x * 0.18 + microLayer.x * 0.12, 0.0, 1.6);
  let projectionGain = projection * mix(0.62, 0.94, bonfireScene) * (0.42 + activeMaterial * 0.58);
  let correctedVelocity = velocityDensity.xyz - pressureGradient * projectionGain;
  fluidDst[base] = vec4<f32>(clamp(correctedVelocity, vec3<f32>(-0.34), vec3<f32>(0.52)), density);
  fluidDst[base + 1u] = material;
  fluidDst[base + 2u] = fireLayer;
  fluidDst[base + 3u] = microLayer;
}

fn vorticityConfinement(c: vec3<i32>, amount: f32) -> vec3<f32> {
  // Vorticity confinement preserves small curl features that semi-Lagrangian advection damps away.
  let magX = curlMagnitudeAtCell(c + vec3<i32>(1, 0, 0)) - curlMagnitudeAtCell(c + vec3<i32>(-1, 0, 0));
  let magY = curlMagnitudeAtCell(c + vec3<i32>(0, 1, 0)) - curlMagnitudeAtCell(c + vec3<i32>(0, -1, 0));
  let magZ = curlMagnitudeAtCell(c + vec3<i32>(0, 0, 1)) - curlMagnitudeAtCell(c + vec3<i32>(0, 0, -1));
  let normal = normalize(vec3<f32>(magX, magY, magZ) + vec3<f32>(0.0001));
  return cross(normal, curlAtCell(c)) * amount;
}

fn fineScaleBreakup(c: vec3<i32>, p: vec3<f32>, time: f32, curl: f32, heat: f32, smoke: f32, source: f32) -> vec3<f32> {
  let localCurl = curlAtCell(c);
  let curlEnergy = length(localCurl);
  let detailA = turbulentDetailForce(p * 1.63 + vec3<f32>(0.17, -0.11, 0.23), time * 1.37);
  let detailB = turbulentDetailForce(p * 2.41 + vec3<f32>(-0.31, 0.19, -0.07), time * 1.91);
  let shearAxis = normalize(localCurl + detailA * 0.19 + vec3<f32>(0.001));
  let shear = normalize(cross(shearAxis, detailB) + detailA * 0.36 + vec3<f32>(0.001));
  let activeFlow = source * 1.55 + heat * 0.52 + smoke * 0.18 + smoothstep(0.006, 0.095, curlEnergy) * 0.32;
  return shear * activeFlow * (0.006 + curl * 0.010);
}

fn transportedDetailPhaseAnchor(material: vec4<f32>, fireLayer: vec4<f32>, microLayer: vec4<f32>, frontTopology: f32, velocity: vec3<f32>, p: vec3<f32>) -> vec3<f32> {
  let carrier = clamp(
    material.x * 0.34
      + material.w * 0.52
      + microLayer.x * 0.42
      + microLayer.y * 0.36
      + fireLayer.z * 0.30
      + frontTopology * 0.70,
    0.0,
    2.4
  );
  let scalarPhase = vec3<f32>(
    material.w - microLayer.x * 0.45 + frontTopology * 0.32,
    fireLayer.z * 0.58 + microLayer.y * 0.28 - material.x * 0.22,
    microLayer.x * 0.46 + material.y * 0.18 - fireLayer.x * 0.16
  );
  let flow = normalize(velocity + vec3<f32>(0.012, 0.019, -0.014));
  return (scalarPhase * 0.075 + flow * carrier * 0.040 + p.yzx * carrier * 0.012) * carrier;
}

fn tallPlumeTransitionBandStagger(contourBreakup: f32, materialDetail: f32, microSmoke: f32, interfaceShred: f32, flameDetail: f32, frontTopology: f32) -> f32 {
  return clamp(
    0.58
      + contourBreakup * 0.28
      + materialDetail * 0.08
      + microSmoke * 0.10
      + interfaceShred * 0.16
      + flameDetail * 0.08
      + frontTopology * 0.12,
    0.44,
    1.24
  );
}

fn turbulentDetailForce(p: vec3<f32>, time: f32) -> vec3<f32> {
  let q = p * vec3<f32>(9.0, 13.0, 11.0) + vec3<f32>(time * 1.7, -time * 2.1, time * 1.3);
  let a = vec3<f32>(
    sin(q.y + cos(q.z)),
    sin(q.z + cos(q.x)),
    sin(q.x + cos(q.y))
  );
  let b = vec3<f32>(
    cos(q.z * 1.37 - q.y),
    cos(q.x * 1.21 - q.z),
    cos(q.y * 1.43 - q.x)
  );
  return normalize(a + b * 0.72 + vec3<f32>(0.001));
}

fn materialInterfaceGradient(c: vec3<i32>) -> vec3<f32> {
  let sx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).x;
  let sx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).x;
  let hx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).y;
  let hx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).y;
  let fx0 = readSlot(c + vec3<i32>(-1, 0, 0), 2u).x;
  let fx1 = readSlot(c + vec3<i32>( 1, 0, 0), 2u).x;
  let sy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).x;
  let sy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).x;
  let hy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).y;
  let hy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).y;
  let fy0 = readSlot(c + vec3<i32>(0, -1, 0), 2u).x;
  let fy1 = readSlot(c + vec3<i32>(0,  1, 0), 2u).x;
  let sz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).x;
  let sz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).x;
  let hz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).y;
  let hz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).y;
  let fz0 = readSlot(c + vec3<i32>(0, 0, -1), 2u).x;
  let fz1 = readSlot(c + vec3<i32>(0, 0,  1), 2u).x;
  return vec3<f32>(
    (sx1 - sx0) * 0.72 - (hx1 - hx0) * 0.44 + (fx1 - fx0) * 0.38,
    (sy1 - sy0) * 0.72 - (hy1 - hy0) * 0.44 + (fy1 - fy0) * 0.38,
    (sz1 - sz0) * 0.72 - (hz1 - hz0) * 0.44 + (fz1 - fz0) * 0.38
  ) * 0.5;
}

fn bonfireReferenceFrontGradient(c: vec3<i32>) -> vec3<f32> {
  let mx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u);
  let mx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u);
  let fx0 = readSlot(c + vec3<i32>(-1, 0, 0), 2u);
  let fx1 = readSlot(c + vec3<i32>( 1, 0, 0), 2u);
  let ux0 = readSlot(c + vec3<i32>(-1, 0, 0), 3u);
  let ux1 = readSlot(c + vec3<i32>( 1, 0, 0), 3u);
  let my0 = readSlot(c + vec3<i32>(0, -1, 0), 1u);
  let my1 = readSlot(c + vec3<i32>(0,  1, 0), 1u);
  let fy0 = readSlot(c + vec3<i32>(0, -1, 0), 2u);
  let fy1 = readSlot(c + vec3<i32>(0,  1, 0), 2u);
  let uy0 = readSlot(c + vec3<i32>(0, -1, 0), 3u);
  let uy1 = readSlot(c + vec3<i32>(0,  1, 0), 3u);
  let mz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u);
  let mz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u);
  let fz0 = readSlot(c + vec3<i32>(0, 0, -1), 2u);
  let fz1 = readSlot(c + vec3<i32>(0, 0,  1), 2u);
  let uz0 = readSlot(c + vec3<i32>(0, 0, -1), 3u);
  let uz1 = readSlot(c + vec3<i32>(0, 0,  1), 3u);
  let x = (fx1.w - fx0.w) * 0.70 + (fx1.z - fx0.z) * 0.42 + (mx1.y - mx0.y) * 0.32 + (mx1.x - mx0.x) * 0.24 + (ux1.y - ux0.y) * 0.22;
  let y = (fy1.w - fy0.w) * 0.70 + (fy1.z - fy0.z) * 0.42 + (my1.y - my0.y) * 0.32 + (my1.x - my0.x) * 0.24 + (uy1.y - uy0.y) * 0.22;
  let z = (fz1.w - fz0.w) * 0.70 + (fz1.z - fz0.z) * 0.42 + (mz1.y - mz0.y) * 0.32 + (mz1.x - mz0.x) * 0.24 + (uz1.y - uz0.y) * 0.22;
  return vec3<f32>(x, y, z) * 0.5;
}

fn bonfireReferenceConfinementForce(c: vec3<i32>, smoke: f32, heat: f32, flame: f32, source: f32, frontContact: f32, strength: f32) -> vec3<f32> {
  let frontGradient = bonfireReferenceFrontGradient(c);
  let materialGradient = materialInterfaceGradient(c);
  let curlMagnitudeGradient = vec3<f32>(
    curlMagnitudeAtCell(c + vec3<i32>(1, 0, 0)) - curlMagnitudeAtCell(c + vec3<i32>(-1, 0, 0)),
    curlMagnitudeAtCell(c + vec3<i32>(0, 1, 0)) - curlMagnitudeAtCell(c + vec3<i32>(0, -1, 0)),
    curlMagnitudeAtCell(c + vec3<i32>(0, 0, 1)) - curlMagnitudeAtCell(c + vec3<i32>(0, 0, -1))
  ) * 0.5;
  let frontDirection = normalize(frontGradient * 0.76 + materialGradient * 0.34 + curlMagnitudeGradient * 0.48 + vec3<f32>(0.0001));
  let localCurl = curlAtCell(c);
  let confinement = cross(frontDirection, localCurl);
  let frontShear = cross(normalize(frontGradient + vec3<f32>(0.0001)), normalize(materialGradient + curlMagnitudeGradient + vec3<f32>(0.0001)));
  let carrier = clamp(frontContact * 0.72 + smoke * 0.34 + heat * 0.24 + flame * 0.22 + source * 0.10, 0.0, 1.9);
  let frontEnergy = smoothstep(0.006, 0.16, length(frontGradient) + length(materialGradient) * 0.42);
  return (confinement * 0.074 + frontShear * 0.018) * carrier * frontEnergy * clamp(strength, 0.0, 1.5);
}

fn transportedMicrodetailAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, heat: f32, smoke: f32, flame: f32, lateralSlipScale: f32, microdetailRiseDirection: f32) -> vec4<f32> {
  let lift = vec3<f32>(0.0, (heat * 0.22 + flame * 0.34) * (0.28 + speed * 0.055) * microdetailRiseDirection, 0.0);
  let rawSlip = turbulentDetailForce(cell * 0.031 + vec3<f32>(0.11, -0.07, 0.17), u.cameraPos_time.w * 1.27) * (0.18 + heat * 0.12 + smoke * 0.06);
  let slip = vec3<f32>(rawSlip.x * lateralSlipScale, rawSlip.y, rawSlip.z * lateralSlipScale);
  let backCell = cell - (velocity + lift + slip) * (1.44 + speed * 0.28);
  return sampleFluidSlot(backCell, 3u);
}

fn interfaceShreddingForce(c: vec3<i32>, p: vec3<f32>, time: f32, amount: f32, heat: f32, smoke: f32, flame: f32, carriedShred: f32) -> vec3<f32> {
  let interfaceGrad = materialInterfaceGradient(c);
  let interfaceEnergy = length(interfaceGrad);
  let localCurl = curlAtCell(c);
  let crossCurl = cross(normalize(interfaceGrad + vec3<f32>(0.001)), normalize(localCurl + turbulentDetailForce(p * 2.2, time) * 0.24 + vec3<f32>(0.001)));
  let interfaceActive = smoothstep(0.018, 0.23, interfaceEnergy) * (0.28 + smoke * 0.34 + heat * 0.28 + flame * 0.20 + carriedShred * 0.30);
  return normalize(crossCurl + turbulentDetailForce(p * 1.7 + vec3<f32>(0.23, -0.19, 0.13), time * 1.5) * 0.36 + vec3<f32>(0.001)) * interfaceActive * amount * 0.036;
}

fn smokeShredEnergy(c: vec3<i32>) -> f32 {
  let m = readSlot(c, 3u);
  return m.x * 0.52 + m.y * 0.90 + m.z * 0.30;
}

fn fireLickAshCarry(c: vec3<i32>, lick: f32, bonfireBlend: f32) -> f32 {
  let shred = smoothstep(0.18, 1.4, smokeShredEnergy(c));
  let baseAsh = mix(0.06, 0.055, bonfireBlend);
  let lickAsh = mix(0.34, 0.30, bonfireBlend);
  return shred * (baseAsh + lick * lickAsh);
}

fn fireLickBreakup(c: vec3<i32>, p: vec3<f32>, time: f32, amount: f32, heat: f32, fuel: f32, flame: f32, flameDetail: f32, source: f32) -> vec4<f32> {
  let interfaceEnergy = length(materialInterfaceGradient(c));
  let lickWarp = turbulentDetailForce(p * 2.64 + vec3<f32>(0.19, -0.23, 0.11), time * 0.91) * (0.046 + source * 0.040 + heat * 0.018 + flameDetail * 0.016);
  let q = p + lickWarp;
  let combA = sin(q.y * 23.0 + sin(q.x * 19.0 + q.z * 11.0 + time * 3.2) + source * 2.6);
  let combB = cos(q.z * 27.0 - q.x * 13.0 + q.y * 7.0 - time * 4.1 + flameDetail * 1.7);
  let combC = hash31(floor((q + vec3<f32>(1.0)) * 24.0) + vec3<f32>(floor(time * 3.0)));
  let verticalComb = clamp(0.54 + 0.22 * combA + 0.18 * combB + 0.10 * (combC - 0.5), 0.12, 1.10);
  let hotEdge = smoothstep(0.10, 1.20, heat + flame * 0.62) * smoothstep(0.014, 0.18, interfaceEnergy + source * 0.08);
  let lick = hotEdge * verticalComb * amount * (0.16 + fuel * 0.22 + flameDetail * 0.18 + source * 0.24);
  let ash = fireLickAshCarry(c, lick, 0.0);
  return vec4<f32>(lick, lick * (0.42 + fuel * 0.24), lick * (0.58 + heat * 0.22), ash);
}

fn bonfireRadialFireLickBreakup(c: vec3<i32>, p: vec3<f32>, time: f32, amount: f32, heat: f32, fuel: f32, flame: f32, flameDetail: f32, source: f32) -> vec4<f32> {
  let interfaceEnergy = length(materialInterfaceGradient(c));
  let radial = length(p.xz);
  let radialWarp = (hash31(vec3<f32>(floor(radial * 19.0), floor((p.y + 1.0) * 17.0), floor(time * 3.0))) - 0.5) * 0.085;
  let qRadius = max(0.0, radial + radialWarp * (0.30 + source * 0.42 + heat * 0.18));
  let combA = sin(p.y * 24.0 + qRadius * 31.0 + time * 3.0 + source * 2.4);
  let combB = cos(p.y * 9.0 - qRadius * 23.0 - time * 4.0 + flameDetail * 1.6);
  let combC = hash31(vec3<f32>(floor(qRadius * 26.0), floor((p.y + 1.0) * 22.0), floor(time * 3.0)));
  let verticalComb = clamp(0.56 + 0.22 * combA + 0.16 * combB + 0.08 * (combC - 0.5), 0.14, 1.06);
  let hotEdge = smoothstep(0.10, 1.20, heat + flame * 0.62) * smoothstep(0.014, 0.18, interfaceEnergy + source * 0.08);
  let lick = hotEdge * verticalComb * amount * (0.15 + fuel * 0.21 + flameDetail * 0.17 + source * 0.22);
  let ash = fireLickAshCarry(c, lick, 1.0);
  return vec4<f32>(lick, lick * (0.40 + fuel * 0.22), lick * (0.54 + heat * 0.20), ash);
}

fn bonfireSymmetricCombustionPairOffset(pairIndex: f32, side: f32, sourceRadius: f32, detailFrequency: f32, time: f32) -> vec2<f32> {
  let ringRadius = sourceRadius * (0.72 + detailFrequency * 0.045);
  let angle = pairIndex * 2.0943951 + sin(time * (0.31 + pairIndex * 0.049)) * 0.18;
  let spoke = vec2<f32>(cos(angle), sin(angle));
  let tangent = vec2<f32>(-spoke.y, spoke.x);
  let radialPulse = sin(time * 0.73 + pairIndex * 1.71) * sourceRadius * 0.045;
  let tangentPulse = cos(time * 0.61 - pairIndex * 1.33) * sourceRadius * 0.035;
  return (spoke * (ringRadius + radialPulse) + tangent * tangentPulse) * side;
}

fn bonfirePairStrength(pairIndex: f32, time: f32) -> f32 {
  return 0.46 + 0.22 * sin(time * 1.23 + pairIndex * 1.37);
}

fn bonfirePairYOffset(pairIndex: f32, time: f32) -> f32 {
  return sin(time * 0.82 + pairIndex * 1.31) * 0.045 + cos(time * 0.47 - pairIndex * 0.73) * 0.024;
}

fn bonfirePairRadius(pairIndex: f32, time: f32) -> f32 {
  return 0.32 + 0.040 * sin(time + pairIndex * 1.17);
}

fn bonfireSymmetricEdgeBreakup(p: vec3<f32>, scaledDetailFrequency: f32, bonfireTongues: f32, time: f32) -> f32 {
  let radial = length(p.xz);
  let radialWave = sin(radial * 43.0 * scaledDetailFrequency + p.y * 13.0 - time * 1.9);
  let ringWave = cos(radial * 47.0 * scaledDetailFrequency - p.y * 9.0 + time * 1.4);
  let quadrupoleWave = sin((p.x * p.x - p.z * p.z) * 31.0 * scaledDetailFrequency + time * 1.1);
  return clamp(
    0.58
      + 0.18 * radialWave
      + 0.16 * ringWave
      + 0.10 * quadrupoleWave
      + 0.20 * bonfireTongues,
    0.18,
    1.34
  );
}

fn bonfireAzimuthalBreakup(p: vec3<f32>, scaledDetailFrequency: f32, time: f32, phaseOffset: f32) -> f32 {
  let radial = max(length(p.xz), 0.001);
  let dir = p.xz / radial;
  let rotA = vec2<f32>(cos(time * 0.37 + phaseOffset), sin(time * 0.37 + phaseOffset));
  let rotB = vec2<f32>(-rotA.y, rotA.x);
  let angularA = sin(dot(dir, rotA) * (8.0 + scaledDetailFrequency * 1.4) + radial * (17.0 + scaledDetailFrequency * 2.3) + p.y * 5.2 + time * 1.21);
  let angularB = cos(dot(dir, rotB) * (11.0 + scaledDetailFrequency * 1.1) - radial * (13.0 + scaledDetailFrequency * 1.9) + p.y * 3.7 - time * 0.94);
  let quadrupole = sin((dir.x * dir.x - dir.y * dir.y) * (13.0 + scaledDetailFrequency * 2.0) + p.x * p.z * 18.0 + time * 0.73 + phaseOffset);
  let cellular = hash31(floor(vec3<f32>(p.x * 17.0 + p.y * 5.0, p.z * 19.0 - p.y * 4.0, p.y * 11.0 + time * 1.6 + phaseOffset) * max(1.0, scaledDetailFrequency * 0.42)));
  return clamp(0.72 + angularA * 0.14 + angularB * 0.12 + quadrupole * 0.10 + (cellular - 0.5) * 0.12, 0.34, 1.18);
}

fn bonfireMirrorBalancedBreakup(p: vec3<f32>, scaledDetailFrequency: f32, time: f32, phaseOffset: f32) -> f32 {
  return (
    bonfireAzimuthalBreakup(p, scaledDetailFrequency, time, phaseOffset) +
    bonfireAzimuthalBreakup(vec3<f32>(-p.x, p.y, p.z), scaledDetailFrequency, time, phaseOffset) +
    bonfireAzimuthalBreakup(vec3<f32>(p.x, p.y, -p.z), scaledDetailFrequency, time, phaseOffset) +
    bonfireAzimuthalBreakup(vec3<f32>(-p.x, p.y, -p.z), scaledDetailFrequency, time, phaseOffset)
  ) * 0.25;
}

fn bonfireCombustionPacketOffset(packetIndex: f32, sourceRadius: f32, detailFrequency: f32, time: f32) -> vec3<f32> {
  let angle = packetIndex * 2.3999632 + sin(time * (0.27 + packetIndex * 0.037) + packetIndex * 1.31) * 0.18;
  let spoke = vec2<f32>(cos(angle), sin(angle));
  let tangent = vec2<f32>(-spoke.y, spoke.x);
  let radial = sourceRadius * (0.52 + 0.24 * sin(time * 0.41 + packetIndex * 1.17) + detailFrequency * 0.030);
  let orbital = spoke * radial + tangent * sourceRadius * 0.12 * cos(time * 0.52 - packetIndex * 0.91);
  let riseStagger = -sourceRadius * (0.18 + 0.11 * (packetIndex - floor(packetIndex * 0.25) * 4.0));
  let breathing = sin(time * 0.69 + packetIndex * 0.83) * sourceRadius * 0.055;
  return vec3<f32>(orbital.x, riseStagger + breathing, orbital.y);
}

fn bonfireCombustionPacketField(p: vec3<f32>, sourceY: f32, sourceRadius: f32, detailFrequency: f32, time: f32) -> vec4<f32> {
  var field = 0.0;
  var peak = 0.0;
  var combustionInterface = 0.0;
  var lift = 0.0;
  var activePackets = 0.0;
  for (var i = 0; i < 9; i = i + 1) {
    let fi = f32(i);
    let packetOffset = bonfireCombustionPacketOffset(fi, sourceRadius, detailFrequency, time);
    let packetRadius = sourceRadius * (0.30 + 0.055 * sin(time * 0.77 + fi * 1.43));
    let packetVerticalSpan = max(0.034, sourceRadius * (0.48 + 0.05 * cos(time * 0.62 - fi * 0.79)));
    let localY = (p.y - sourceY - packetOffset.y) / packetVerticalSpan;
    let localXZ = p.xz - packetOffset.xz;
    let lobe = exp(-dot(localXZ, localXZ) / max(0.0014, packetRadius * packetRadius) - localY * localY);
    let packetPulse = 0.64 + 0.22 * sin(time * (1.04 + fi * 0.031) + fi * 1.77) + 0.14 * cos(time * 0.83 - fi * 1.13);
    let weighted = lobe * packetPulse;
    field = field + weighted;
    peak = max(peak, weighted);
    combustionInterface = combustionInterface + smoothstep(0.10, 0.42, lobe) * (1.0 - smoothstep(0.62, 0.92, lobe));
    lift = lift + weighted * smoothstep(-0.12, 0.62, -localY);
    activePackets = activePackets + step(0.10, weighted);
  }
  let normalized = clamp(field * 0.98, 0.0, 1.70);
  let packetedness = clamp(peak / max(field, 0.001) * 3.10 + combustionInterface * 0.085 + activePackets * 0.025, 0.0, 1.75);
  return vec4<f32>(
    normalized,
    packetedness,
    clamp(combustionInterface * 0.23, 0.0, 1.55),
    clamp(lift * 0.34, 0.0, 1.45)
  );
}

fn bonfireCombustionCellField(p: vec3<f32>, sourceY: f32, sourceRadius: f32, detailFrequency: f32, time: f32) -> vec4<f32> {
  var field = 0.0;
  var peak = 0.0;
  var combustionInterface = 0.0;
  var lift = 0.0;
  let verticalSpan = max(0.058, sourceRadius * 1.05);
  for (var i = 0; i < 7; i = i + 1) {
    let fi = f32(i);
    let isCore = 1.0 - step(0.5, fi);
    let pairSlot = max(fi - 1.0, 0.0);
    let pairIndex = floor(pairSlot * 0.5);
    let pairSide = 1.0 - (pairSlot - pairIndex * 2.0) * 2.0;
    let offset = bonfireSymmetricCombustionPairOffset(pairIndex, pairSide, sourceRadius, detailFrequency, time) * (1.0 - isCore);
    let yOffset = bonfirePairYOffset(pairIndex, time) * (1.0 - isCore);
    let cellRadius = sourceRadius * mix(0.72, bonfirePairRadius(pairIndex, time), 1.0 - isCore);
    let vertical = (p.y - sourceY - yOffset) / verticalSpan;
    let delta = p.xz - offset;
    let lobe = exp(-dot(delta, delta) / max(0.0024, cellRadius * cellRadius) - vertical * vertical * mix(0.70, 1.28, 1.0 - isCore));
    let strength = mix(0.42, bonfirePairStrength(pairIndex, time), 1.0 - isCore);
    let weighted = lobe * strength;
    field = field + weighted;
    peak = max(peak, weighted);
    combustionInterface = combustionInterface + smoothstep(0.18, 0.64, lobe) * (1.0 - smoothstep(0.70, 0.96, lobe)) * mix(0.56, 1.0, 1.0 - isCore);
    lift = lift + weighted * smoothstep(-0.18, 0.42, -vertical) * mix(0.74, 1.0, 1.0 - isCore);
  }
  let normalized = clamp(field * 0.82, 0.0, 1.55);
  let clusteredness = clamp(peak / max(field, 0.001) * 2.80 + combustionInterface * 0.075, 0.0, 1.55);
  return vec4<f32>(
    normalized,
    clusteredness,
    clamp(combustionInterface * 0.28, 0.0, 1.40),
    clamp(lift * 0.36, 0.0, 1.30)
  );
}

fn bonfireFlameTongues(combustion: vec4<f32>, fireLickAmount: f32, detailFrequency: f32) -> f32 {
  let operatorGain = clamp(fireLickAmount * 0.13, 0.0, 1.0);
  return clamp(combustion.y * (0.46 + operatorGain * 0.78) + combustion.z * 0.16 + detailFrequency * 0.018, 0.0, 1.6);
}

fn bonfireInterfaceCombustion(combustion: vec4<f32>, smoke: f32, heat: f32, flame: f32) -> f32 {
  let hotBoundary = smoothstep(0.035, 0.82, heat + flame * 0.42 + combustion.x * 0.35);
  let smokeCarrier = 0.36 + smoothstep(0.025, 0.70, smoke + combustion.z * 0.46) * 0.64;
  return clamp(combustion.z * hotBoundary * smokeCarrier + combustion.y * combustion.x * 0.10, 0.0, 1.35);
}

fn bonfireZeroMeanLateralFlow(p: vec3<f32>, sourceY: f32, combustion: vec4<f32>, time: f32, strength: f32) -> vec3<f32> {
  let radial = max(length(p.xz), 0.025);
  let dir = p.xz / radial;
  let tangent = vec2<f32>(-dir.y, dir.x);
  let ring = smoothstep(0.045, 0.42, radial) * (1.0 - smoothstep(0.86, 1.16, radial));
  let sourceBand = smoothstep(sourceY - 0.44, sourceY - 0.08, p.y) * (1.0 - smoothstep(sourceY + 0.08, sourceY + 0.42, p.y));
  let quadrupole = sin((p.x * p.x - p.z * p.z) * 38.0 + time * 1.7) * cos(p.x * p.z * 44.0 - time * 1.1);
  let eddy = tangent * quadrupole * ring * sourceBand * combustion.y * clamp(strength, 0.0, 1.0) * 0.018;
  return vec3<f32>(eddy.x, 0.0, eddy.y);
}

fn bonfireSymmetricLateralForce(p: vec3<f32>, time: f32, carrier: f32, strength: f32, phaseOffset: f32) -> vec2<f32> {
  let radial = max(length(p.xz), 0.025);
  let dir = p.xz / radial;
  let tangent = vec2<f32>(-dir.y, dir.x);
  let ring = smoothstep(0.035, 0.26, radial) * (1.0 - smoothstep(0.68, 1.04, radial));
  let q = sin((p.x * p.x - p.z * p.z) * (26.0 + phaseOffset * 1.7) + p.y * (6.0 + phaseOffset) + time * (1.1 + phaseOffset * 0.13));
  let r = cos(radial * (21.0 + phaseOffset * 2.3) - p.y * (5.0 + phaseOffset * 0.7) - time * (0.9 + phaseOffset * 0.11));
  return (tangent * q * 0.72 + dir * r * 0.38) * ring * clamp(carrier, 0.0, 2.0) * strength;
}

fn bonfireZeroMeanPlumeRoll(p: vec3<f32>, sourceY: f32, smoke: f32, heat: f32, flame: f32, source: f32, time: f32, strength: f32) -> vec3<f32> {
  let radial = max(length(p.xz), 0.025);
  let dir = p.xz / radial;
  let tangent = vec2<f32>(-dir.y, dir.x);
  let visualAboveSource = sourceY - p.y;
  let riseBand = smoothstep(-0.04, 0.18, visualAboveSource) * (1.0 - smoothstep(1.30, 1.70, visualAboveSource));
  let ring = smoothstep(0.035, 0.30, radial) * (1.0 - smoothstep(0.64, 1.03, radial));
  let coreRoll = 1.0 - smoothstep(0.05, 0.38, radial);
  let carrier = clamp(smoke * 0.70 + heat * 0.22 + flame * 0.15 + source * 0.20, 0.0, 1.6);
  let rollPhase = visualAboveSource * 10.5 + radial * 15.0 + time * 1.35;
  let quadrupole = sin((p.x * p.x - p.z * p.z) * 29.0 + visualAboveSource * 5.0 + time * 0.95);
  let radialRoll = sin(rollPhase) * 0.66 + quadrupole * 0.22;
  let verticalRoll = cos(rollPhase) * (0.40 + coreRoll * 0.58);
  let horizontal = (dir * radialRoll + tangent * quadrupole * 0.34) * ring * riseBand * carrier * clamp(strength, 0.0, 1.0) * 0.058;
  let vertical = -verticalRoll * ring * riseBand * carrier * clamp(strength, 0.0, 1.0) * 0.024;
  return vec3<f32>(horizontal.x, vertical, horizontal.y);
}

fn bonfireConvectiveCellRoll(p: vec3<f32>, sourceY: f32, smoke: f32, heat: f32, flame: f32, source: f32, time: f32, strength: f32) -> vec3<f32> {
  let radial = max(length(p.xz), 0.025);
  let dir = p.xz / radial;
  let tangent = vec2<f32>(-dir.y, dir.x);
  let visualAboveSource = sourceY - p.y;
  let lowerPlume = smoothstep(0.16, 0.34, visualAboveSource) * (1.0 - smoothstep(1.04, 1.58, visualAboveSource));
  let ringBand = smoothstep(0.055, 0.22, radial) * (1.0 - smoothstep(0.56, 0.92, radial));
  let coreBand = 1.0 - smoothstep(0.02, 0.46, radial);
  let bodyBand = clamp(ringBand + coreBand * 0.58, 0.0, 1.0);
  let cellA = sin((p.x * p.x - p.z * p.z) * 37.0 + visualAboveSource * 7.0 + time * 1.18);
  let cellB = cos(p.x * p.z * 52.0 - visualAboveSource * 6.0 + time * 0.87);
  let overturn = sin(visualAboveSource * 16.0 + radial * 11.0 + time * 1.62);
  let carrier = clamp(smoke * 0.62 + heat * 0.28 + flame * 0.13 + source * 0.18, 0.0, 1.7);
  let lateral = (dir * (cellA * 0.58 + overturn * 0.34) + tangent * (cellB * 0.54)) * bodyBand * lowerPlume * carrier * clamp(strength, 0.0, 1.0) * 0.084;
  let vertical = (cellB * 0.38 - overturn * 0.34) * bodyBand * lowerPlume * carrier * clamp(strength, 0.0, 1.0) * 0.026;
  return vec3<f32>(lateral.x, vertical, lateral.y);
}

fn bonfireEntrainedLift(smoke: f32, heat: f32, flame: f32, source: f32, combustion: vec4<f32>, plumeRiseScale: f32, speed: f32) -> f32 {
  let carrier = clamp(source * 0.46 + smoke * 0.24 + heat * 0.28 + flame * 0.12 + combustion.w * 0.62, 0.0, 1.8);
  return carrier * plumeRiseScale * (0.021 + speed * 0.0062);
}

fn externalEmitterInfluence(p: vec3<f32>, time: f32) -> ExternalEmitterInfluence {
  var result: ExternalEmitterInfluence;
  result.material = vec4<f32>(0.0);
  result.fire = vec4<f32>(0.0);
  result.micro = vec4<f32>(0.0);
  result.velocity = vec4<f32>(0.0);
  let count = min(u32(max(0.0, floor(u.scale_controls.w + 0.5))), MAX_EXTERNAL_EMITTERS_WGSL);
  for (var i: u32 = 0u; i < count; i = i + 1u) {
    let emitter = externalEmitters[i];
    let start = emitter.start_radius.xyz;
    let end = emitter.end_strength.xyz;
    let segment = end - start;
    let denom = max(dot(segment, segment), 0.00001);
    let t = clamp(dot(p - start, segment) / denom, 0.0, 1.0);
    let closest = start + segment * t;
    let radius = max(0.006, emitter.start_radius.w);
    let dist2 = dot(p - closest, p - closest);
    let strength = max(0.0, emitter.end_strength.w);
    let age = max(0.0, emitter.velocity_age.w);
    let lifetime = max(0.016, emitter.detail_lifetime.y);
    let isActiveEmitter = step(0.5, emitter.detail_lifetime.w);
    let ageFade = 1.0 - smoothstep(lifetime * 0.68, lifetime, age);
    let falloff = exp(-dist2 / max(0.00001, radius * radius)) * strength * ageFade * isActiveEmitter;
    let flicker = 0.82 + 0.18 * hash31(vec3<f32>(f32(i) * 13.7, time * 4.1, t * 9.3));
    let w = falloff * flicker;
    result.material.x = max(result.material.x, emitter.material.x * w);
    result.material.y = max(result.material.y, emitter.material.y * w);
    result.material.z = max(result.material.z, emitter.material.z * w);
    result.material.w = max(result.material.w, emitter.detail_lifetime.x * w);
    result.fire.x = max(result.fire.x, emitter.material.w * w);
    result.fire.y = max(result.fire.y, emitter.material.w * w * 0.42);
    result.fire.z = max(result.fire.z, emitter.detail_lifetime.x * w * 0.82);
    result.micro.x = max(result.micro.x, emitter.detail_lifetime.x * w * 0.72);
    result.micro.y = max(result.micro.y, emitter.detail_lifetime.x * w * 0.42 + emitter.material.w * w * 0.12);
    result.micro.z = max(result.micro.z, emitter.material.w * w * 0.60);
    result.micro.w = max(result.micro.w, emitter.material.w * w * 0.22);
    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  return result;
}

fn applyExternalEmitterInjection(influence: ExternalEmitterInfluence) -> ExternalEmitterInfluence {
  return influence;
}

fn thermalAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, localHeat: f32, lateralSlipScale: f32, thermalAdvectionRiseDirection: f32) -> vec4<f32> {
  let thermalLift = vec3<f32>(0.0, clamp(localHeat, 0.0, 1.7) * (0.24 + speed * 0.055) * thermalAdvectionRiseDirection, 0.0);
  let rawThermalSlip = vec3<f32>(
    sin(cell.z * 0.41 + localHeat * 2.7),
    0.0,
    cos(cell.x * 0.37 - localHeat * 2.1)
  ) * localHeat * 0.032;
  let thermalSlip = vec3<f32>(rawThermalSlip.x * lateralSlipScale, rawThermalSlip.y, rawThermalSlip.z * lateralSlipScale);
  let backCell = cell - (velocity + thermalLift + thermalSlip) * (2.30 + speed * 0.46);
  return sampleFluidSlot(backCell, 1u);
}

fn thermalBuoyancyForce(heat: f32, smoke: f32, fuel: f32, speed: f32) -> vec3<f32> {
  let hotLift = smoothstep(0.04, 1.25, heat) * (0.034 + speed * 0.018);
  let smokeDrag = smoke * 0.014;
  let fuelKick = fuel * heat * 0.014;
  return vec3<f32>(0.0, hotLift + fuelKick - smokeDrag, 0.0);
}

fn heatGradientAtCell(c: vec3<i32>) -> vec3<f32> {
  let hx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).y;
  let hx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).y;
  let hy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).y;
  let hy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).y;
  let hz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).y;
  let hz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).y;
  return vec3<f32>(hx1 - hx0, hy1 - hy0, hz1 - hz0) * 0.5;
}

fn thermalExpansionForce(c: vec3<i32>, heat: f32, amount: f32) -> vec3<f32> {
  let grad = heatGradientAtCell(c);
  return -grad * smoothstep(0.08, 1.35, heat) * amount;
}

fn heatToSmokeConversion(heat: f32, fuel: f32, y: f32) -> f32 {
  let coolingBand = smoothstep(0.16, 1.05, heat) * (1.0 - smoothstep(1.18, 1.85, heat));
  let upperAir = smoothstep(-0.55, 0.72, y);
  let fuelSmoke = fuel * smoothstep(0.06, 0.86, heat) * 0.072;
  return coolingBand * upperAir * 0.064 + fuelSmoke;
}

fn fireLayerAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, heat: f32, lateralSlipScale: f32, fireLayerRiseDirection: f32) -> vec4<f32> {
  let fastLift = vec3<f32>(0.0, clamp(heat, 0.0, 1.9) * (0.40 + speed * 0.13) * fireLayerRiseDirection, 0.0);
  let rawLick = vec3<f32>(
    sin(cell.y * 0.44 + cell.z * 0.19 + heat * 3.8),
    0.0,
    cos(cell.y * 0.38 - cell.x * 0.21 - heat * 3.1)
  ) * heat * 0.070;
  let lick = vec3<f32>(rawLick.x * lateralSlipScale, rawLick.y, rawLick.z * lateralSlipScale);
  let backCell = cell - (velocity + fastLift + lick) * (1.82 + speed * 0.34);
  return sampleFluidSlot(backCell, 2u);
}

fn gridLine(p: vec3<f32>) -> f32 {
  let a = abs(p);
  var faceUv = vec2<f32>(0.0);
  if (a.x > a.y && a.x > a.z) {
    faceUv = p.yz * 0.5 + vec2<f32>(0.5);
  } else if (a.y > a.z) {
    faceUv = p.xz * 0.5 + vec2<f32>(0.5);
  } else {
    faceUv = p.xy * 0.5 + vec2<f32>(0.5);
  }
  let majorCells = max(4.0, f32(GRID) / 16.0);
  let f = fract(faceUv * majorCells);
  let nearest = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  let line = 1.0 - smoothstep(0.014, 0.042, nearest);
  let face = smoothstep(0.940, 0.995, max(max(a.x, a.y), a.z));
  return line * face;
}

fn slabAxis(origin: f32, dir: f32, halfSize: f32) -> vec2<f32> {
  if (abs(dir) < 0.00001) {
    if (abs(origin) > halfSize) {
      return vec2<f32>(1.0, -1.0);
    }
    return vec2<f32>(-1.0e6, 1.0e6);
  }
  let a = (-halfSize - origin) / dir;
  let b = ( halfSize - origin) / dir;
  return vec2<f32>(min(a, b), max(a, b));
}

fn boxHit(ro: vec3<f32>, rd: vec3<f32>, b: vec3<f32>) -> vec2<f32> {
  let sx = slabAxis(ro.x, rd.x, b.x);
  let sy = slabAxis(ro.y, rd.y, b.y);
  let sz = slabAxis(ro.z, rd.z, b.z);
  return vec2<f32>(max(max(sx.x, sy.x), sz.x), min(min(sx.y, sy.y), sz.y));
}

fn fireColor(temp: f32) -> vec3<f32> {
  let ember = vec3<f32>(0.70, 0.10, 0.018);
  let orange = vec3<f32>(1.0, 0.38, 0.055);
  let gold = vec3<f32>(1.0, 0.74, 0.20);
  let pale = vec3<f32>(1.0, 0.82, 0.34);
  let a = mix(ember, orange, smoothstep(0.08, 0.44, temp));
  let b = mix(gold, pale, smoothstep(0.86, 1.55, temp));
  return mix(a, b, smoothstep(0.34, 1.08, temp));
}

fn emissiveTemperature(fireLayer: vec4<f32>, material: vec4<f32>, microLayer: vec4<f32>, velMag: f32) -> f32 {
  return clamp(
    fireLayer.x * 1.22
      + fireLayer.y * 0.46
      + fireLayer.z * 0.40
      + microLayer.z * 1.18
      + microLayer.w * 0.48
      + material.y * 0.20
      + velMag * 0.30,
    0.0,
    2.4
  );
}

fn boundarySupportFromSlots(velocityDensity: vec4<f32>, material: vec4<f32>, fireLayer: vec4<f32>, microLayer: vec4<f32>, frontTopology: f32, supportWeights: vec4<f32>) -> f32 {
  let velMag = length(velocityDensity.xyz);
  let rawTemp = emissiveTemperature(fireLayer, material, microLayer, velMag);
  let heat = material.y;
  let fuel = material.z;
  let smoke = material.x;
  let flame = fireLayer.x;
  let ember = fireLayer.y;
  let flameDetail = fireLayer.z;
  let combustionFront = fireLayer.w;
  let microSmoke = microLayer.x;
  let interfaceShred = microLayer.y;
  let fireLick = microLayer.z;
  let materialDetail = microLayer.w;
  let thermalSupport = smoothstep(0.018, 0.62, rawTemp + flame * 0.16 + heat * 0.24 + ember * 0.12);
  let reactionSupport = smoothstep(0.004, 0.30, flameDetail * 0.72 + fireLick * 0.44 + combustionFront * 0.34 + fuel * heat * 0.28);
  let frontSupport = smoothstep(0.001, 0.088, frontTopology * 1.08 + combustionFront * 0.54 + fireLick * 0.12);
  let interfaceSupport = smoothstep(0.004, 0.24, interfaceShred * 0.58 + microSmoke * 0.18 + smoke * 0.08 + materialDetail * 0.06);
  let weightSum = max(0.001, dot(supportWeights, vec4<f32>(1.0)));
  return clamp(dot(vec4<f32>(thermalSupport, reactionSupport, frontSupport, interfaceSupport), supportWeights) / weightSum, 0.0, 1.35);
}

fn liveBoundarySupportAt(p: vec3<f32>, supportWeights: vec4<f32>) -> f32 {
  let velocityDensity = sampleWorldVelocity(p);
  let material = sampleWorldMaterial(p);
  let fireLayer = sampleWorldFireLayer(p);
  let microLayer = sampleWorldMicrodetail(p);
  let frontTopology = sampleWorldFrontField(p);
  return boundarySupportFromSlots(velocityDensity, material, fireLayer, microLayer, frontTopology, supportWeights);
}

fn fireRadianceEmission(temp: f32, flameDetail: f32, fireLick: f32, emberFleck: f32, radianceGain: f32, glowGain: f32) -> vec3<f32> {
  let core = smoothstep(0.16, 1.18, temp);
  let whiteCore = smoothstep(1.06, 2.10, temp);
  let lickSpark = smoothstep(0.025, 0.34, fireLick + emberFleck * 0.45);
  let filament = smoothstep(0.025, 0.62, flameDetail + fireLick * 0.56);
  let body = fireColor(temp) * (0.28 + core * 1.24 + filament * 0.34);
  let hot = mix(body, vec3<f32>(1.0, 0.92, 0.55), whiteCore * (0.34 + glowGain * 0.12));
  return hot * radianceGain * (0.55 + lickSpark * 0.20 + glowGain * 0.18);
}

fn smokeRadianceExtinction(smokeDensity: f32, microSmoke: f32, interfaceShred: f32, materialDetail: f32, absorptionGain: f32) -> f32 {
  let body = smokeDensity * 0.74 + microSmoke * 0.42 + interfaceShred * 0.34 + materialDetail * 0.12;
  return clamp(body * (0.34 + absorptionGain * 0.46), 0.0, 2.3);
}

fn raymarchInterest(
  density: f32,
  smoke: f32,
  heat: f32,
  temp: f32,
  flame: f32,
  flameDetail: f32,
  microTextureSignal: f32,
  velMag: f32,
  fireLick: f32,
  interfaceShred: f32
) -> f32 {
  let body = density * 0.22 + smoke * 0.16 + heat * 0.10;
  let fire = temp * 0.40 + flame * 0.36 + flameDetail * 0.22 + fireLick * 0.30;
  let edge = microTextureSignal * 0.22 + interfaceShred * 0.42 + velMag * 0.46;
  return clamp(body + fire + edge, 0.0, 1.6);
}

fn adaptiveRayStepScale(interest: f32, adaptiveRays: f32) -> f32 {
  let fine = smoothstep(0.035, 0.92, interest);
  let adaptiveScale = mix(2.65, 0.68, fine);
  return mix(1.0, adaptiveScale, clamp(adaptiveRays, 0.0, 1.0));
}

fn raymarchOccupancySignal(
  density: f32,
  smoke: f32,
  heat: f32,
  temp: f32,
  flame: f32,
  microTextureSignal: f32,
  velMag: f32,
  extinction: f32
) -> f32 {
  let body = density * 0.44 + smoke * 0.38 + extinction * 0.28;
  let fire = temp * 0.24 + flame * 0.28 + heat * 0.16;
  let detail = microTextureSignal * 0.20 + velMag * 0.32;
  return clamp(body + fire + detail, 0.0, 1.8);
}

fn occupancySkipStepScale(occupancy: f32, occupancySkipStrength: f32, adaptiveRays: f32) -> f32 {
  let emptySpan = 1.0 - smoothstep(0.012, 0.135, occupancy);
  let adaptiveAssist = mix(1.45, 3.20, clamp(adaptiveRays, 0.0, 1.0));
  return clamp(1.0 + emptySpan * clamp(occupancySkipStrength, 0.0, 1.0) * adaptiveAssist, 1.0, 4.60);
}

fn raymarchEarlyTermination(transmittance: f32) -> bool {
  return transmittance < 0.012;
}

fn microDetailDomainWarp(p: vec3<f32>, microLayer: vec4<f32>, fireLayer: vec4<f32>, material: vec4<f32>, velocity: vec3<f32>, time: f32, detailCoherenceGain: f32) -> vec3<f32> {
  let carrier = clamp(
    microLayer.x * 0.62
      + microLayer.y * 1.08
      + microLayer.z * 0.78
      + microLayer.w * 0.30
      + fireLayer.z * 0.28
      + material.w * 0.18,
    0.0,
    2.6
  );
  let detailPhaseAnchor = transportedDetailPhaseAnchor(material, fireLayer, microLayer, 0.0, velocity, p) * clamp(detailCoherenceGain, 0.0, 1.0);
  let coherentP = p + detailPhaseAnchor * 0.65;
  let coherentTime = mix(time, time * 0.72 + dot(detailPhaseAnchor, vec3<f32>(1.1, -0.7, 0.9)), clamp(detailCoherenceGain, 0.0, 1.0));
  let flow = normalize(velocity + turbulentDetailForce(coherentP * 1.31 + vec3<f32>(0.17, -0.11, 0.23), coherentTime * 0.47) * 0.16 + vec3<f32>(0.012, 0.019, -0.014));
  let foldA = turbulentDetailForce(coherentP * 2.17 + flow * (0.42 + carrier * 0.34), coherentTime * 0.83);
  let foldB = turbulentDetailForce(coherentP.yzx * 2.91 + vec3<f32>(carrier * 0.19, -carrier * 0.13, carrier * 0.17), coherentTime * 1.19);
  return (foldA * 0.70 + foldB * 0.36 + flow * 0.24) * carrier * 0.038;
}

fn microFilamentNoise(p: vec3<f32>, warp: vec3<f32>, carrier: f32, velocity: vec3<f32>, time: f32) -> f32 {
  let q = p + warp + velocity * 0.31;
  let phaseA = dot(q, vec3<f32>(29.0, 17.0, -23.0)) + sin(dot(q.yzx, vec3<f32>(11.0, -19.0, 31.0)) + carrier * 2.7 + time * 2.3);
  let phaseB = dot(q.zxy, vec3<f32>(-13.0, 37.0, 19.0)) + cos(dot(q, vec3<f32>(23.0, -7.0, 13.0)) - carrier * 1.9 - time * 3.1);
  let cellNoise = hash31(floor((q + vec3<f32>(1.0)) * 28.0) + vec3<f32>(floor(time * 2.0)));
  return clamp(0.50 + 0.25 * sin(phaseA) + 0.18 * sin(phaseB) + 0.14 * (cellNoise - 0.5), 0.12, 1.12);
}

fn boundarySupportAtCell(c: vec3<i32>, supportWeights: vec4<f32>) -> f32 {
  return boundarySupportFromSlots(readSlot(c, 0u), readSlot(c, 1u), readSlot(c, 2u), readSlot(c, 3u), readFrontField(c), supportWeights);
}

@compute @workgroup_size(4, 4, 4)
fn csBoundarySidecar(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let c = vec3<i32>(gid);
  let supportWeights = vec4<f32>(
    clamp(u.topology_shell_carriers.x, 0.0, 2.0),
    clamp(u.topology_shell_carriers.y, 0.0, 2.0),
    clamp(u.topology_shell_carriers.z, 0.0, 2.0),
    clamp(u.topology_shell_carriers.w, 0.0, 2.0)
  );
  let center = boundarySupportAtCell(c, supportWeights);
  let px = boundarySupportAtCell(c + vec3<i32>(1, 0, 0), supportWeights);
  let nx = boundarySupportAtCell(c + vec3<i32>(-1, 0, 0), supportWeights);
  let py = boundarySupportAtCell(c + vec3<i32>(0, 1, 0), supportWeights);
  let ny = boundarySupportAtCell(c + vec3<i32>(0, -1, 0), supportWeights);
  let pz = boundarySupportAtCell(c + vec3<i32>(0, 0, 1), supportWeights);
  let nz = boundarySupportAtCell(c + vec3<i32>(0, 0, -1), supportWeights);
  let blur = clamp(u.boundary_sidecar_controls.y, 0.0, 1.0);
  let neighborMean = (center * 2.0 + px + nx + py + ny + pz + nz) * 0.125;
  let neighborMax = max(max(max(px, nx), max(py, ny)), max(pz, nz));
  let boundarySidecarSupport = mix(center, neighborMean, blur * 0.45);
  let boundarySidecarGradient = clamp(length(vec3<f32>(px - nx, py - ny, pz - nz)) * 0.5, 0.0, 1.5);
  let laplacian = abs(px + nx + py + ny + pz + nz - 6.0 * center);
  let ridgeGain = clamp(u.boundary_fire_structure.x, 0.0, 2.0) * clamp(u.boundary_sidecar_controls.w, 0.0, 2.0);
  let ridgeCut = clamp(u.boundary_fire_structure.y, 0.0, 0.55);
  let boundarySidecarRidge = smoothstep(ridgeCut, ridgeCut + 0.14, laplacian * ridgeGain);
  let boundarySidecarCoverage = clamp(
    max(boundarySidecarSupport, neighborMax * (0.34 + blur * 0.28))
      + smoothstep(0.014, 0.30, boundarySidecarGradient) * 0.28
      + boundarySidecarRidge * 0.18,
    0.0,
    1.8
  );
  let boundarySidecarFootprintWidth = clamp(
    0.16
      + blur * 0.34
      + smoothstep(0.014, 0.34, boundarySidecarGradient) * 0.42
      + boundarySidecarRidge * 0.26
      + max(0.0, neighborMax - center) * 0.22,
    0.06,
    1.65
  );
  boundarySidecarDst[index3(gid)] = vec4<f32>(
    boundarySidecarSupport,
    boundarySidecarCoverage,
    boundarySidecarRidge,
    boundarySidecarFootprintWidth
  );
}

@compute @workgroup_size(4, 4, 4)
fn csMajorant(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(MAJORANT_GRID))) {
    return;
  }
  let brickStart = vec3<u32>(floor(vec3<f32>(gid) * f32(GRID) / f32(MAJORANT_GRID)));
  let brickEnd = max(brickStart + vec3<u32>(1), vec3<u32>(ceil(vec3<f32>(gid + vec3<u32>(1)) * f32(GRID) / f32(MAJORANT_GRID))));
  var majorant = vec4<f32>(0.0);
  for (var z = brickStart.z; z < min(brickEnd.z, GRID); z = z + 1u) {
    for (var y = brickStart.y; y < min(brickEnd.y, GRID); y = y + 1u) {
      for (var x = brickStart.x; x < min(brickEnd.x, GRID); x = x + 1u) {
        let c = vec3<i32>(vec3<u32>(x, y, z));
        let candidate = materialMajorantFromSlots(readSlot(c, 0u), readSlot(c, 1u), readSlot(c, 2u), readSlot(c, 3u), readFrontField(c));
        majorant = max(majorant, candidate);
      }
    }
  }
  majorantDst[majorantIndex(gid)] = majorant;
}

@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let idx = index3(gid);
  let base = idx * SLOTS_PER_CELL;
  let cell = vec3<f32>(gid) + vec3<f32>(0.5);
  let cellI = vec3<i32>(gid);
  let p = (cell / f32(GRID)) * 2.0 - vec3<f32>(1.0);
  let prev = fluidSrc[base];
  let speed = u.fire_smoke_curl_speed.w;
  let curl = u.fire_smoke_curl_speed.z;
  let inputRadius = max(0.04, u.source_controls.x);
  let inputFlow = max(0.0, u.source_controls.y);
  let projection = clamp(u.source_controls.z, 0.0, 1.5);
  let fireScale = clamp(u.scale_controls.x, 0.35, 1.30);
  let detailScale = clamp(u.scale_controls.y, 0.45, 3.20);
  let plumeHeight = clamp(u.scale_controls.z, 0.70, 2.20);
  let plumeHeight01 = smoothstep(0.70, 2.20, plumeHeight);
  let sceneMode = clamp(u.scene_controls.x, 0.0, 3.0);
  let tallPlumeScene = step(0.5, sceneMode) * (1.0 - step(1.5, sceneMode));
  let detailScaleArtifactQuarantine = tallPlumeScene;
  let physicalDetailScale = mix(detailScale, 1.0, detailScaleArtifactQuarantine);
  let scaledSourceRadius = max(0.035, inputRadius * fireScale);
  let scaledSmokeSourceRadius = max(0.055, inputRadius * mix(0.92, 1.08, plumeHeight01));
  let scaledDetailFrequency = clamp(physicalDetailScale / max(fireScale, 0.45), 0.55, 5.40);
  let tallPlumeTransportedDetailFrequency = mix(scaledDetailFrequency, 1.0, tallPlumeScene);
  let plumeRiseScale = mix(0.82, 1.58, plumeHeight01);
  let sourceScaleCompensation = mix(1.22, 0.94, smoothstep(0.35, 1.30, fireScale));
  let microAmount = clamp(u.grid_overlay_debug.y, 0.0, 2.5);
  let shredAmount = clamp(u.grid_overlay_debug.z, 0.0, 5.0);
  let fireLickAmount = clamp(u.grid_overlay_debug.w, 0.0, 5.0);
  let shredOperatorGain = shredAmount * (0.80 + shredAmount * 0.080);
  let fireLickOperatorGain = fireLickAmount * (0.82 + fireLickAmount * 0.110);
  let detailDomain = vec3<f32>(tallPlumeTransportedDetailFrequency, mix(1.0, 1.18, plumeHeight01), tallPlumeTransportedDetailFrequency);
  let time = u.cameraPos_time.w;
  let windStrength = clamp(u.scene_controls.y, 0.0, 1.5);
  let windAngle = u.scene_controls.z;
  let windHeight = clamp(u.scene_controls.w, -0.8, 0.8);
  let canonicalSpreadGain = clamp(u.canonical_controls.x, 0.0, 1.6);
  let canonicalCenterlineGain = clamp(u.canonical_controls.y, 0.0, 1.8);
  let canonicalBodyBalanceGain = clamp(u.canonical_controls.z, 0.0, 1.5);
  let canonicalSourceMode = clamp(u.canonical_controls.w, 0.0, 3.0);
  let canonicalSourceYControl = clamp(u.canonical_source_controls.x, -0.92, -0.20);
  let canonicalSourceInjection = clamp(u.canonical_source_controls.y, 0.0, 1.5);
  let canonicalBuoyancyLift = clamp(u.canonical_source_controls.z, 0.0, 1.5);
  let reactionFuelScale = clamp(u.canonical_source_controls.w, 0.0, 1.5);
  let canonicalRenderMode = clamp(u.canonical_render_motion_controls.x, 0.0, 1.0);
  let canonicalMotionMode = clamp(u.canonical_render_motion_controls.y, 0.0, 1.0);
  let canonicalContentMode = clamp(u.canonical_render_motion_controls.z, 0.0, 2.0);
  let windDirection = vec3<f32>(cos(windAngle), 0.0, sin(windAngle));
  let windHeightRamp = smoothstep(windHeight - 0.32, windHeight + 0.52, p.y);
  let explicitWindAuthority = smoothstep(0.05, 1.0, windStrength);
  let canonicalPlumeScene = step(2.5, sceneMode);
  let canonicalSmokeContent = 1.0 - canonicalPlumeScene * step(0.5, canonicalContentMode) * (1.0 - step(1.5, canonicalContentMode));
  let canonicalFireContent = canonicalPlumeScene * step(0.5, canonicalContentMode);
  let canonicalFrozenMotion = canonicalPlumeScene * step(0.5, canonicalMotionMode);
  let canonicalPhaseTime = mix(time, 0.0, canonicalFrozenMotion);
  let canonicalPassiveBottomProof = canonicalPlumeScene * step(0.5, canonicalSourceMode) * (1.0 - step(1.5, canonicalSourceMode));
  let canonicalBuoyantBottomProof = canonicalPlumeScene * step(2.5, canonicalSourceMode);
  let bonfireScene = step(1.5, sceneMode) * (1.0 - canonicalPlumeScene);
  let bonfireRecenterAblation = mix(1.0, clamp(u.bonfire_ablation_controls.x, 0.0, 1.5), bonfireScene);
  let bonfireLateralDampingAblation = mix(1.0, clamp(u.bonfire_ablation_controls.y, 0.0, 1.5), bonfireScene);
  let bonfireShearAblation = mix(1.0, clamp(u.bonfire_ablation_controls.z, 0.0, 1.5), bonfireScene);
  let bonfireDetailForcesAblation = mix(1.0, clamp(u.bonfire_ablation_controls.w, 0.0, 1.5), bonfireScene);
  let bonfireDepinchAblation = mix(1.0, clamp(u.bonfire_ablation_controls2.x, 0.0, 1.5), bonfireScene);
  let bonfireProjectionAblation = mix(1.0, clamp(u.bonfire_ablation_controls2.y, 0.0, 1.5), bonfireScene);
  let bonfireInstabilityProbe = clamp(u.bonfire_ablation_controls2.w, 0.0, 1.0) * bonfireScene;
  let effectiveProjection = projection * bonfireProjectionAblation;
  let bonfireThermalRiseDirection = 1.0 - bonfireScene * 2.0;
  let thermalAdvectionRiseDirection = bonfireThermalRiseDirection;
  let fireLayerRiseDirection = bonfireThermalRiseDirection;
  let microdetailRiseDirection = bonfireThermalRiseDirection;
  let bonfireLocalLateralTransportGain = mix(1.0, max(explicitWindAuthority, 0.78), bonfireScene);
  let bonfireAdvectionLateralDamping = bonfireLocalLateralTransportGain;
  let bonfireZeroMeanScalarSlipGain = bonfireScene * (1.0 - explicitWindAuthority) * 0.58;
  let bonfireLocalLateralSlipGain = mix(1.0, max(explicitWindAuthority, bonfireZeroMeanScalarSlipGain), bonfireScene);
  let advectVelocity = vec3<f32>(prev.x * bonfireAdvectionLateralDamping, prev.y, prev.z * bonfireAdvectionLateralDamping);
  let backCell = cell - advectVelocity * (2.55 + speed * 0.55);
  let advected = sampleFluidSlot(backCell, 0u);
  let localMaterial = readSlot(cellI, 1u);
  var material = thermalAdvection(cell, advectVelocity, speed, localMaterial.y, bonfireLocalLateralSlipGain, thermalAdvectionRiseDirection);
  var fireLayer = fireLayerAdvection(cell, advectVelocity, speed, localMaterial.y, bonfireLocalLateralSlipGain, fireLayerRiseDirection);
  var microLayer = transportedMicrodetailAdvection(cell, advectVelocity, speed, localMaterial.y, localMaterial.x, fireLayer.x, bonfireLocalLateralSlipGain, microdetailRiseDirection);
  var combustionFrontTopology = sampleFrontField(backCell) * 0.936;
  if (bonfireScene > 0.5) {
    let bonfireTurbulentDiffusionMix = bonfireScene * (1.0 - explicitWindAuthority) * clamp(0.044 + curl * 0.008 + microAmount * 0.006, 0.0, 0.115);
    let diffuseMaterial = (
      readSlot(cellI + vec3<i32>(-1, 0, 0), 1u) +
      readSlot(cellI + vec3<i32>( 1, 0, 0), 1u) +
      readSlot(cellI + vec3<i32>(0, -1, 0), 1u) +
      readSlot(cellI + vec3<i32>(0,  1, 0), 1u) +
      readSlot(cellI + vec3<i32>(0, 0, -1), 1u) +
      readSlot(cellI + vec3<i32>(0, 0,  1), 1u)
    ) * (1.0 / 6.0);
    let diffuseFireLayer = (
      readSlot(cellI + vec3<i32>(-1, 0, 0), 2u) +
      readSlot(cellI + vec3<i32>( 1, 0, 0), 2u) +
      readSlot(cellI + vec3<i32>(0, -1, 0), 2u) +
      readSlot(cellI + vec3<i32>(0,  1, 0), 2u) +
      readSlot(cellI + vec3<i32>(0, 0, -1), 2u) +
      readSlot(cellI + vec3<i32>(0, 0,  1), 2u)
    ) * (1.0 / 6.0);
    let diffuseMicroLayer = (
      readSlot(cellI + vec3<i32>(-1, 0, 0), 3u) +
      readSlot(cellI + vec3<i32>( 1, 0, 0), 3u) +
      readSlot(cellI + vec3<i32>(0, -1, 0), 3u) +
      readSlot(cellI + vec3<i32>(0,  1, 0), 3u) +
      readSlot(cellI + vec3<i32>(0, 0, -1), 3u) +
      readSlot(cellI + vec3<i32>(0, 0,  1), 3u)
    ) * (1.0 / 6.0);
    let diffuseFrontTopology = (
      readFrontField(cellI + vec3<i32>(-1, 0, 0)) +
      readFrontField(cellI + vec3<i32>( 1, 0, 0)) +
      readFrontField(cellI + vec3<i32>(0, -1, 0)) +
      readFrontField(cellI + vec3<i32>(0,  1, 0)) +
      readFrontField(cellI + vec3<i32>(0, 0, -1)) +
      readFrontField(cellI + vec3<i32>(0, 0,  1))
    ) * (1.0 / 6.0);
    material = mix(material, diffuseMaterial, bonfireTurbulentDiffusionMix);
    fireLayer = mix(fireLayer, diffuseFireLayer, bonfireTurbulentDiffusionMix * 0.55);
    microLayer = mix(microLayer, diffuseMicroLayer, bonfireTurbulentDiffusionMix * 0.90);
    combustionFrontTopology = mix(combustionFrontTopology, diffuseFrontTopology, bonfireTurbulentDiffusionMix * 0.42);
    let mirrorXCell = vec3<i32>(i32(GRID) - 1 - cellI.x, cellI.y, cellI.z);
    let mirrorZCell = vec3<i32>(cellI.x, cellI.y, i32(GRID) - 1 - cellI.z);
    let mirrorXZCell = vec3<i32>(i32(GRID) - 1 - cellI.x, cellI.y, i32(GRID) - 1 - cellI.z);
    let bonfireScalarSymmetryBlend = bonfireScene * (1.0 - explicitWindAuthority) * 0.020 * bonfireRecenterAblation;
    let symmetricMaterial = (material + readSlot(mirrorXCell, 1u) + readSlot(mirrorZCell, 1u) + readSlot(mirrorXZCell, 1u)) * 0.25;
    let symmetricFireLayer = (fireLayer + readSlot(mirrorXCell, 2u) + readSlot(mirrorZCell, 2u) + readSlot(mirrorXZCell, 2u)) * 0.25;
    let symmetricMicroLayer = (microLayer + readSlot(mirrorXCell, 3u) + readSlot(mirrorZCell, 3u) + readSlot(mirrorXZCell, 3u)) * 0.25;
    let symmetricFrontTopology = (combustionFrontTopology + readFrontField(mirrorXCell) + readFrontField(mirrorZCell) + readFrontField(mirrorXZCell)) * 0.25;
    material = mix(material, symmetricMaterial, bonfireScalarSymmetryBlend);
    fireLayer = mix(fireLayer, symmetricFireLayer, bonfireScalarSymmetryBlend * 0.70);
    microLayer = mix(microLayer, symmetricMicroLayer, bonfireScalarSymmetryBlend * 0.82);
    combustionFrontTopology = mix(combustionFrontTopology, symmetricFrontTopology, bonfireScalarSymmetryBlend * 0.38);
  }
  var vel = advected.xyz * 0.982;
  var smoke = material.x * 0.990;
  var heat = material.y * 0.982;
  var fuel = material.z * 0.990;
  var materialDetail = material.w * 0.970;
  var flame = fireLayer.x * 0.938;
  var ember = fireLayer.y * 0.952;
  var visibleFireCarrier = fireLayer.z * 0.922;
  var flameDetail = visibleFireCarrier;
  var combustionFront = fireLayer.w * 0.930;
  var microSmoke = microLayer.x * 0.972;
  var interfaceShred = microLayer.y * 0.948;
  var fireLick = microLayer.z * 0.902;
  var emberFleck = microLayer.w * 0.934;

  let sourceCenter = p - u.primitive_source.xyz;
  let radial = length(p.xz);
  let sourceRadial = length(sourceCenter.xz);
  let sourceBand = smoothstep(-0.25, -0.06, sourceCenter.y) * (1.0 - smoothstep(0.92, 1.32, sourceCenter.y));
  let canonicalSourceY = canonicalSourceYControl;
  let canonicalSourceBand = exp(-pow((p.y - canonicalSourceY) / 0.070, 2.0));
  let breakup = clamp(
    0.64
      + 0.24 * sin(p.x * 19.0 * tallPlumeTransportedDetailFrequency + p.z * 7.0 * tallPlumeTransportedDetailFrequency + time * 1.7)
      + 0.20 * cos(p.z * 23.0 * tallPlumeTransportedDetailFrequency - p.x * 5.0 * tallPlumeTransportedDetailFrequency - time * 1.3)
      + 0.16 * hash31(vec3<f32>(gid) * 0.061 * tallPlumeTransportedDetailFrequency + vec3<f32>(floor(time * 2.0))),
    0.16,
    1.22
  );
  var bonfireSourceBreakup = 0.0;
  var bonfireDetailBreakup = breakup;
  let smokeSourceFalloff = 1.0 / max(0.0048, scaledSmokeSourceRadius * scaledSmokeSourceRadius);
  let fireSourceFalloff = 1.0 / max(0.0036, scaledSourceRadius * scaledSourceRadius);
  let tallPlumeSmokeDebandAngle = atan2(sourceCenter.z, sourceCenter.x);
  let tallPlumeSmokeDebandWarp = sourceCenter.xz
    + vec2<f32>(
      sin(sourceCenter.z * 8.7 + sourceCenter.y * 4.9 + time * 0.23),
      cos(sourceCenter.x * 7.9 - sourceCenter.y * 4.3 - time * 0.19)
    ) * scaledSmokeSourceRadius * 0.28;
  let tallPlumeSmokeDebandBasis = clamp(
    0.78
      + 0.11 * sin(length(tallPlumeSmokeDebandWarp) * 22.0 - sourceCenter.y * 6.4 + time * 0.42)
      + 0.08 * cos(tallPlumeSmokeDebandAngle * 5.0 + sourceCenter.y * 7.2 - time * 0.31)
      + 0.07 * (hash31(floor(vec3<f32>(
        tallPlumeSmokeDebandWarp.x * 11.0,
        sourceCenter.y * 9.0,
        tallPlumeSmokeDebandWarp.y * 11.0
      ))) - 0.5),
    0.46,
    1.16
  );
  let tallPlumeSmokeSourceBreakup = tallPlumeSmokeDebandBasis;
  let columnSource = exp(-sourceRadial * sourceRadial * smokeSourceFalloff) * sourceBand * mix(breakup, tallPlumeSmokeSourceBreakup, tallPlumeScene) * inputFlow;
  let tallPlumeEmitterBand = smoothstep(-0.25, -0.10, sourceCenter.y) * (1.0 - smoothstep(0.12, 0.40, sourceCenter.y));
  let tallPlumeSourceWidthGate = tallPlumeScene * smoothstep(0.095, 0.180, scaledSourceRadius);
  let tallPlumeSourceRadial01 = clamp(sourceRadial / max(scaledSourceRadius, 0.001), 0.0, 3.0);
  let tallPlumeFrontPacketDensity = mix(1.0, 2.25, tallPlumeSourceWidthGate);
  let tallPlumeSourceAngle = tallPlumeSmokeDebandAngle;
  let tallPlumeAnnularFrontRadius = mix(0.70, 0.86, tallPlumeSourceWidthGate);
  let tallPlumeAnnularFrontWidth = 0.18 - tallPlumeSourceWidthGate * 0.035;
  let tallPlumeAnnularFrontBand = exp(
    -pow(abs(tallPlumeSourceRadial01 - tallPlumeAnnularFrontRadius), 2.0)
      / max(0.0025, tallPlumeAnnularFrontWidth * tallPlumeAnnularFrontWidth)
  );
  let tallPlumeFrontPacketBreakup = clamp(
    0.72
      + (breakup - 0.64) * 0.38
      + 0.16 * sin(tallPlumeSourceAngle * (4.0 + tallPlumeFrontPacketDensity * 2.0) + sourceRadial * (23.0 + tallPlumeFrontPacketDensity * 7.0) - time * 1.45)
      + 0.12 * cos(tallPlumeSourceAngle * (7.0 + tallPlumeFrontPacketDensity) - p.y * 13.0 + time * 1.10),
    0.36,
    1.34
  );
  let tallPlumeInteriorFireRelief = mix(
    1.0,
    mix(0.62, 1.08, smoothstep(0.34, 0.94, tallPlumeSourceRadial01)),
    tallPlumeSourceWidthGate
  );
  let tallPlumeEmitterBreakup = clamp(
    0.70
      + (breakup - 0.64) * 0.62
      + 0.14 * sin(p.y * 18.0 + sourceRadial * 21.0 - time * 1.55)
      + 0.10 * cos(p.x * 16.0 - p.z * 13.0 + time * 1.10),
    0.28,
    1.18
  );
  let tallPlumeAnnularFrontBirth = tallPlumeSourceWidthGate
    * tallPlumeEmitterBand
    * tallPlumeAnnularFrontBand
    * tallPlumeFrontPacketBreakup
    * inputFlow;
  let tallPlumeCombustionSource = exp(-sourceRadial * sourceRadial * smokeSourceFalloff * 1.22)
    * tallPlumeEmitterBand
    * tallPlumeEmitterBreakup
    * inputFlow
    * tallPlumeInteriorFireRelief
    + tallPlumeAnnularFrontBirth * 0.34;
  let canonicalSourceCell = vec2<f32>(
    sin(p.x * 8.1 + p.z * 2.7 + canonicalPhaseTime * 0.43),
    cos(p.z * 7.6 - p.x * 3.2 - canonicalPhaseTime * 0.39)
  );
  let canonicalSourceWarp = sourceCenter.xz + canonicalSourceCell * scaledSmokeSourceRadius * 0.16;
  let canonicalSourceBreakup = clamp(
    0.78
      + 0.16 * sin(atan2(p.z, p.x) * 3.0 + canonicalPhaseTime * 0.33)
      + 0.12 * cos(sourceRadial * 22.0 - canonicalPhaseTime * 0.46)
      + 0.08 * hash31(vec3<f32>(p.x * 5.0, p.y * 2.0, p.z * 5.0) + vec3<f32>(floor(canonicalPhaseTime * 0.75))),
    0.48,
    1.18
  );
  let canonicalSource = exp(-dot(canonicalSourceWarp, canonicalSourceWarp) / max(0.0048, scaledSmokeSourceRadius * scaledSmokeSourceRadius * 1.20))
    * canonicalSourceBand
    * canonicalSourceBreakup
    * inputFlow;
  let bonfireSourceY = 0.62;
  let bonfireVertical = (p.y - bonfireSourceY) / 0.23;
  let bonfireCoreRadius = max(0.090, scaledSourceRadius * 1.72);
  let bonfireSmokeRadius = max(0.125, scaledSmokeSourceRadius * 1.38);
  var bonfireSmoothCombustion = vec4<f32>(0.0);
  var bonfirePacketCombustion = vec4<f32>(0.0);
  if (bonfireScene > 0.5) {
    bonfireSmoothCombustion = bonfireCombustionCellField(p, bonfireSourceY, bonfireCoreRadius, scaledDetailFrequency, time);
    bonfirePacketCombustion = bonfireCombustionPacketField(p, bonfireSourceY, bonfireCoreRadius, scaledDetailFrequency, time);
  }
  let bonfireCombustion = mix(bonfireSmoothCombustion, bonfirePacketCombustion, bonfireScene);
  let bonfireTongues = bonfireFlameTongues(bonfireCombustion, fireLickOperatorGain, scaledDetailFrequency);
  let bonfireInterfaceBirth = bonfireInterfaceCombustion(bonfireCombustion, smoke, heat, flame);
  let interfaceEnergy = length(materialInterfaceGradient(cellI));
  let smoothBonfireFireball = exp(-(sourceRadial * sourceRadial) / max(0.0048, bonfireCoreRadius * bonfireCoreRadius) - bonfireVertical * bonfireVertical);
  let bonfireVisualAboveSource = bonfireSourceY - p.y;
  var bonfireEdgeBreakup = 1.0;
  var bonfireLayeredBreakup = 1.0;
  if (bonfireScene > 0.5) {
    bonfireSourceBreakup = bonfireMirrorBalancedBreakup(p, scaledDetailFrequency, time, 0.0);
    bonfireDetailBreakup = bonfireMirrorBalancedBreakup(p, scaledDetailFrequency, time * 1.07, 1.4);
    bonfireEdgeBreakup = bonfireSymmetricEdgeBreakup(p, scaledDetailFrequency, bonfireTongues, time);
    bonfireLayeredBreakup = clamp(
      0.68
        + (bonfireMirrorBalancedBreakup(vec3<f32>(
          p.x * 0.94 + sin(bonfireVisualAboveSource * 7.0 + time * 0.81) * 0.025,
          p.y * 1.31 + sourceRadial * 0.28,
          p.z * 1.08 + cos(bonfireVisualAboveSource * 6.0 - time * 0.67) * 0.025
        ), scaledDetailFrequency * 1.18, time * 1.19, 6.4) - 0.72) * 0.58
        + sin(bonfireVisualAboveSource * 18.0 + sourceRadial * 13.0 - time * 1.33) * 0.16
        + cos(bonfireVisualAboveSource * 11.0 - sourceRadial * 17.0 + time * 1.06) * 0.12,
      0.30,
      1.34
    );
  }
  let bonfireSourcePlugSuppressor = mix(0.14, 1.0, smoothstep(0.018, bonfireCoreRadius * 0.82, sourceRadial));
  let bonfireCentralFireRelief = bonfireSourcePlugSuppressor;
  let bonfireSupportHeat = smoothBonfireFireball * bonfireSourcePlugSuppressor * (0.42 + bonfireEdgeBreakup * 0.08);
  let bonfireFuelInjectionMask = smoothstep(bonfireSourceY - 0.34, bonfireSourceY - 0.04, p.y);
  let bonfireLiftedFireBand = smoothstep(0.04, 0.18, bonfireVisualAboveSource) * (1.0 - smoothstep(0.54, 0.88, bonfireVisualAboveSource));
  let bonfireLiftedFireRadius = mix(bonfireCoreRadius * 0.82, bonfireSmokeRadius * 1.12, smoothstep(0.10, 0.58, bonfireVisualAboveSource));
  let bonfirePacketRisingFireGate = mix(0.24, 1.0, smoothstep(0.055, 0.35, bonfireVisualAboveSource));
  let bonfireInjectedFuel = clamp(
    (
      smoothBonfireFireball * 0.32
        + bonfirePacketCombustion.x * 0.38
        + bonfirePacketCombustion.w * 0.16
    ) * bonfireFuelInjectionMask * inputFlow * sourceScaleCompensation,
    0.0,
    2.2
  );
  let bonfireLiftedFireLobes = exp(-sourceRadial * sourceRadial / max(0.0068, bonfireLiftedFireRadius * bonfireLiftedFireRadius))
    * bonfireLiftedFireBand
    * (0.20 + bonfireInterfaceBirth * 0.52 + bonfireCombustion.z * 0.20 + bonfireTongues * 0.16)
    * bonfireEdgeBreakup;
  let bonfireLayeredSmokeBand = smoothstep(0.08, 0.26, bonfireVisualAboveSource) * (1.0 - smoothstep(1.10, 1.58, bonfireVisualAboveSource));
  let bonfireLayeredSmokeBreakup = mix(1.0, bonfireLayeredBreakup, bonfireLayeredSmokeBand);
  let bonfireFrontLiftGate = smoothstep(0.075, 0.24, bonfireVisualAboveSource) * (1.0 - smoothstep(0.74, 1.14, bonfireVisualAboveSource));
  let bonfireOffAxisReactionRadius = mix(bonfireCoreRadius * 0.56, bonfireSmokeRadius * 1.16, smoothstep(0.08, 0.62, bonfireVisualAboveSource));
  let bonfireOffAxisReactionWidth = max(0.020, bonfireCoreRadius * mix(0.18, 0.34, smoothstep(0.06, 0.56, bonfireVisualAboveSource)));
  let bonfireOffAxisReactionRing = exp(-pow(abs(sourceRadial - bonfireOffAxisReactionRadius), 2.0) / max(0.0007, bonfireOffAxisReactionWidth * bonfireOffAxisReactionWidth))
    * bonfireFrontLiftGate
    * (0.46 + bonfireLayeredBreakup * 0.28 + bonfireTongues * 0.18 + bonfireEdgeBreakup * 0.16);
  let bonfireFuelHeatContact = clamp(
    bonfireInjectedFuel
      * (bonfireSupportHeat + heat * 0.30 + bonfirePacketCombustion.x * 0.18)
      * (
        bonfireInterfaceBirth * 0.55
          + bonfireCombustion.z * 0.38
          + bonfirePacketCombustion.y * 0.30
          + bonfireOffAxisReactionRing * 0.42
          + interfaceEnergy * 1.35
      ),
    0.0,
    2.6
  );
  let bonfireReactionProgress = clamp(
    bonfireFuelHeatContact * (1.10 + bonfireTongues * 0.16)
      + bonfireOffAxisReactionRing * (0.46 + bonfirePacketCombustion.z * 0.24)
      + bonfireLiftedFireLobes * (0.48 + bonfireInterfaceBirth * 0.20)
      + bonfirePacketCombustion.w * bonfireFrontLiftGate * 0.20,
    0.0,
    2.8
  );
  let bonfireSootFromReaction = clamp(
    bonfireReactionProgress * inputFlow * sourceScaleCompensation * 0.38
      + bonfireFuelHeatContact * 0.30
      + bonfireInterfaceBirth * inputFlow * 0.13
      + max(0.0, heat - bonfireSupportHeat * 0.34) * bonfireFrontLiftGate * 0.045,
    0.0,
    2.0
  );
  let bonfireReferenceSourceModel = vec4<f32>(bonfireSupportHeat, bonfireInjectedFuel, bonfireReactionProgress, bonfireSootFromReaction);
  let bonfireFireball = bonfireReactionProgress;
  let bonfireSourceCarrier = bonfireReactionProgress * 0.38 + bonfirePacketCombustion.x * 0.18 + bonfireLiftedFireLobes * 0.24 + bonfireOffAxisReactionRing * 0.18;
  let bonfireInterfaceSmokeBand = smoothstep(-0.04, 0.06, bonfireVisualAboveSource) * (1.0 - smoothstep(0.28, 0.52, bonfireVisualAboveSource));
  let bonfireInterfaceSmokeRadius = bonfireSmokeRadius * mix(1.18, 0.86, smoothstep(0.02, 0.42, bonfireVisualAboveSource));
  let bonfireNarrowInterfaceSmokeSource = (
    exp(-sourceRadial * sourceRadial / max(0.0064, bonfireInterfaceSmokeRadius * bonfireInterfaceSmokeRadius)) * bonfireInterfaceSmokeBand * (0.34 + 0.14 * bonfireSourceBreakup + 0.18 * bonfireLayeredBreakup)
      + bonfireInterfaceBirth * 0.24
      + bonfireCombustion.z * 0.07
  ) * inputFlow;
  let bonfireBroadSupportSmokeBand = smoothstep(0.30, 0.52, p.y) * (1.0 - smoothstep(0.82, 0.99, p.y));
  let bonfireBroadSupportSmokeSource = exp(-sourceRadial * sourceRadial / max(0.0082, bonfireSmokeRadius * bonfireSmokeRadius * 1.32)) * bonfireBroadSupportSmokeBand * (0.30 + 0.18 * bonfireSourceBreakup + 0.18 * bonfireLayeredBreakup) * inputFlow;
  let bonfireSmokeSource = max(bonfireNarrowInterfaceSmokeSource * bonfireLayeredSmokeBreakup, bonfireBroadSupportSmokeSource * (0.54 + bonfireLayeredBreakup * 0.20));
  let source = mix(mix(columnSource, canonicalSource, canonicalPlumeScene), max(bonfireSmokeSource, bonfireSourceCarrier * inputFlow * 0.72), bonfireScene);
  let emberRingRadius = scaledSourceRadius * 0.94;
  let emberRingWidth = max(0.026, scaledSourceRadius * 0.22);
  let columnEmberRing = exp(-pow(abs(sourceRadial - emberRingRadius), 2.0) / max(0.002, emberRingWidth * emberRingWidth)) * sourceBand * inputFlow * (0.22 + 0.18 * sin(time * 1.7 + p.x * 9.0));
  let bonfireEmberRing = (
    exp(-pow(abs(sourceRadial - bonfireCoreRadius * 0.78), 2.0) / max(0.002, emberRingWidth * emberRingWidth * 1.8)) * bonfireInterfaceSmokeBand * (0.24 + 0.18 * sin(time * 2.4 + sourceRadial * 19.0 * scaledDetailFrequency))
      + bonfireCombustion.z * 0.18
  ) * inputFlow;
  let emberRing = mix(columnEmberRing * (1.0 - canonicalPlumeScene), bonfireEmberRing, bonfireScene);
  let fireBirthBand = smoothstep(-0.99, -0.82, p.y) * (1.0 - smoothstep(-0.22, 0.16, p.y));
  let columnFireBirth = exp(-sourceRadial * sourceRadial * fireSourceFalloff * mix(2.45, 1.35, smoothstep(0.35, 1.30, fireScale))) * fireBirthBand * inputFlow * sourceScaleCompensation * (0.72 + 0.66 * breakup);
  let tallPlumeEmitterFireBirth = exp(-sourceRadial * sourceRadial * fireSourceFalloff * mix(3.10, 1.70, smoothstep(0.35, 1.30, fireScale)))
    * tallPlumeEmitterBand
    * inputFlow
    * sourceScaleCompensation
    * tallPlumeInteriorFireRelief
    * (0.52 + 0.48 * tallPlumeEmitterBreakup)
    + tallPlumeAnnularFrontBirth * sourceScaleCompensation * 0.22;
  let bonfireCoreHeat = clamp(
    bonfireReferenceSourceModel.x * 0.92
      + bonfireReactionProgress * 0.18
      + bonfirePacketCombustion.x * 0.28
      + bonfireEmberRing * 0.18,
    0.0,
    2.2
  ) * inputFlow * sourceScaleCompensation;
  let bonfireReactionCoreRelief = mix(0.14, 1.0, smoothstep(bonfireCoreRadius * 0.40, bonfireCoreRadius * 1.08, sourceRadial));
  let bonfireReactionRiseBias = mix(0.45, 1.32, smoothstep(0.06, 0.52, bonfireVisualAboveSource));
  let bonfireLiftedReactionFront = (
    bonfireOffAxisReactionRing * (0.54 + bonfirePacketCombustion.y * 0.34 + bonfirePacketCombustion.z * 0.26 + bonfireInterfaceBirth * 0.20)
      + bonfireLiftedFireLobes * bonfireFrontLiftGate * (0.74 + bonfireTongues * 0.18)
      + bonfirePacketCombustion.w * bonfireFrontLiftGate * 0.28
  ) * (0.76 + bonfireEdgeBreakup * 0.22);
  let bonfireReactionFront = clamp(
    bonfireReactionProgress * 0.72
      + bonfireFuelHeatContact * 0.46
      + bonfireInterfaceBirth * 0.38
      + bonfireCombustion.z * 0.24
      + bonfirePacketCombustion.y * 0.22
      + bonfirePacketCombustion.z * 0.18
      + bonfireLiftedFireLobes * 0.38
      + bonfireLiftedReactionFront * 1.18
      + bonfireEmberRing * 0.12,
    0.0,
    2.0
  ) * (0.72 + bonfireEdgeBreakup * 0.24 + bonfireTongues * 0.16) * bonfireReactionCoreRelief * bonfireReactionRiseBias;
  let bonfireSootBirth = clamp(
    bonfireSootFromReaction * 0.82
      + bonfireReactionFront * inputFlow * sourceScaleCompensation * 0.26
      + bonfireInterfaceBirth * inputFlow * 0.20
      + bonfireNarrowInterfaceSmokeSource * 0.38
      + bonfireBroadSupportSmokeSource * 0.055,
    0.0,
    2.0
  );
  let bonfirePacketFireBirth = bonfirePacketCombustion.x * bonfirePacketRisingFireGate * (0.56 + 0.48 * bonfireTongues + bonfireLayeredBreakup * 0.18)
    + bonfirePacketCombustion.w * (0.48 + 0.24 * bonfireTongues)
    + bonfireLiftedFireLobes * (2.28 + 0.92 * bonfireTongues + bonfireLayeredBreakup * 0.56);
  let bonfireFireBirth = (
    bonfireReactionProgress * (0.28 + 0.10 * bonfireSourceBreakup + 0.12 * bonfireTongues)
      + bonfireReactionFront * (1.32 + 0.44 * bonfireTongues)
      + bonfireLiftedReactionFront * (0.58 + 0.24 * bonfireTongues)
      + bonfirePacketFireBirth * 0.92
      + bonfireEmberRing * 0.26
  ) * inputFlow * sourceScaleCompensation * bonfireEdgeBreakup * (0.82 + bonfireLayeredBreakup * 0.26);
  let bonfireFireSourceBinRelief = mix(
    0.20,
    1.0,
    max(
      smoothstep(0.08, 0.34, bonfireVisualAboveSource),
      smoothstep(bonfireCoreRadius * 0.48, bonfireCoreRadius * 1.16, sourceRadial)
    )
  );
  let bonfireLiftedFlameBirth = clamp(
    bonfireFireBirth * bonfireFireSourceBinRelief * 0.52
      + bonfireReactionFront * bonfireFrontLiftGate * (0.92 + bonfireTongues * 0.24)
      + bonfireLiftedReactionFront * (1.16 + bonfireTongues * 0.30)
      + bonfirePacketFireBirth * bonfirePacketRisingFireGate * 0.34,
    0.0,
    3.0
  ) * (0.86 + bonfireLayeredBreakup * 0.18);
  let bonfireFlameOccupancy = clamp(
    bonfireLiftedFlameBirth * 0.72
      + bonfireReactionFront * bonfireFrontLiftGate * 0.42
      + bonfireLiftedReactionFront * 0.34
      + bonfirePacketFireBirth * bonfirePacketRisingFireGate * 0.22,
    0.0,
    3.0
  );
  let bonfireInteriorEmissionBridge = exp(-sourceRadial * sourceRadial / max(0.0058, bonfireLiftedFireRadius * bonfireLiftedFireRadius * 0.42))
    * bonfireFrontLiftGate
    * smoothstep(0.030, 0.92, bonfireReactionProgress)
    * (0.10 + bonfireFuelHeatContact * 0.20 + bonfireInterfaceBirth * 0.24 + bonfirePacketCombustion.y * 0.18 + bonfirePacketCombustion.z * 0.16)
    * (0.58 + bonfireLayeredBreakup * 0.26 + bonfireTongues * 0.18);
  let bonfireCombustionFrontLiftCarrier = (
    bonfireLiftedReactionFront * 0.72
      + bonfireOffAxisReactionRing * (0.40 + bonfirePacketCombustion.y * 0.20 + bonfirePacketCombustion.z * 0.18)
      + bonfirePacketCombustion.w * bonfireFrontLiftGate * 0.20
  ) * (0.82 + bonfireLayeredBreakup * 0.18);
  let bonfireFrontTopologyBirth = bonfireScene * clamp(
    bonfireCombustionFrontLiftCarrier * 1.24
      + bonfireLiftedReactionFront * 0.42
      + bonfireOffAxisReactionRing * (0.36 + bonfirePacketCombustion.z * 0.18)
      + bonfireLiftedFireLobes * bonfireFrontLiftGate * 0.24
      + bonfirePacketCombustion.w * bonfireFrontLiftGate * 0.22,
    0.0,
    2.4
  ) * (0.76 + bonfireLayeredBreakup * 0.20 + bonfireTongues * 0.12);
  combustionFrontTopology = max(combustionFrontTopology, bonfireFrontTopologyBirth);
  let bonfireRadianceBreakup = clamp(
    0.46
      + (bonfireEdgeBreakup - 0.70) * 0.58
      + (bonfireLayeredBreakup - 0.68) * 0.42
      + bonfireTongues * 0.20
      + bonfirePacketCombustion.z * 0.18,
    0.22,
    1.12
  );
  let bonfireRadianceSourceGate = clamp(
    0.18
      + bonfireFrontLiftGate * 0.42
      + smoothstep(bonfireCoreRadius * 0.42, bonfireCoreRadius * 1.12, sourceRadial) * 0.24
      + bonfireInterfaceBirth * 0.18
      + bonfireCombustionFrontLiftCarrier * 0.22,
    0.14,
    1.0
  );
  let bonfireFrontContactRadiance = clamp(
    bonfireReactionFront * 0.46
      + bonfireLiftedReactionFront * 0.60
      + bonfireCombustionFrontLiftCarrier * 0.46
      + combustionFrontTopology * 0.12
      + bonfireInteriorEmissionBridge * 0.78
      + bonfirePacketCombustion.z * bonfireFrontLiftGate * 0.24,
    0.0,
    2.6
  );
  let bonfireTopologyRadianceCarrier = clamp(
    combustionFrontTopology * (0.22 + bonfireRadianceBreakup * 0.08)
      + bonfireFrontTopologyBirth * 0.10
      + bonfireCombustionFrontLiftCarrier * 0.08,
    0.0,
    2.4
  );
  let bonfireTopologyPacketTransfer = clamp(
    combustionFrontTopology
      * bonfireFrontLiftGate
      * (
        0.22
          + bonfirePacketCombustion.y * 0.28
          + bonfirePacketCombustion.z * 0.42
          + bonfirePacketCombustion.w * 0.20
          + (bonfireLayeredBreakup - 0.68) * 0.34
          + bonfireTongues * 0.24
      )
      + bonfireFrontTopologyBirth * 0.24
      + bonfireCombustionFrontLiftCarrier * 0.18,
    0.0,
    2.2
  );
  let bonfireCombustionFrontBirth = bonfireScene * clamp(
    bonfireInterfaceBirth * 0.28
      + bonfireCombustion.z * 0.18
      + bonfireReactionFront * 0.28
      + combustionFrontTopology * 0.12
      + bonfirePacketCombustion.y * 0.16
      + bonfirePacketCombustion.z * 0.14
      + bonfireLiftedFireLobes * 0.24
      + bonfireCombustionFrontLiftCarrier * 1.16
      + interfaceEnergy * (bonfireSmokeSource + bonfireFireBirth) * 0.20,
    0.0,
    1.85
  );
  let bonfireVisibleFlamePacketGate = clamp(
    bonfireTopologyPacketTransfer * (0.74 + bonfireRadianceBreakup * 0.18)
      + bonfireFrontContactRadiance * bonfireFrontLiftGate * 0.18
      + bonfireCombustionFrontBirth * bonfirePacketRisingFireGate * 0.14,
    0.0,
    2.4
  );
  let bonfireVisibleSourcePlugRelief = clamp(
    max(
      smoothstep(0.11, 0.58, bonfireVisualAboveSource),
      smoothstep(bonfireCoreRadius * 0.56, bonfireCoreRadius * 1.22, sourceRadial)
    )
      + bonfireFrontLiftGate * 0.18
      + bonfireTopologyPacketTransfer * 0.08,
    0.10,
    1.0
  );
  let bonfireFlameStorageSourceRelief = clamp(
    max(
      smoothstep(0.18, 0.72, bonfireVisualAboveSource),
      smoothstep(bonfireCoreRadius * 0.72, bonfireCoreRadius * 1.34, sourceRadial)
    )
      + bonfireFrontLiftGate * 0.10
      + bonfireTopologyPacketTransfer * 0.04,
    0.08,
    1.0
  );
  let bonfirePrimaryVisibleFrontEmission = clamp(
    bonfireTopologyPacketTransfer * (1.34 + bonfireRadianceBreakup * 0.32)
      + bonfireTopologyRadianceCarrier * (0.64 + bonfireRadianceBreakup * 0.18)
      + bonfireVisibleFlamePacketGate * (0.42 + bonfireRadianceBreakup * 0.10)
      + bonfireCombustionFrontBirth * bonfirePacketRisingFireGate * 0.32
      + bonfireFrontContactRadiance * bonfireFrontLiftGate * 0.24,
    0.0,
    3.0
  );
  let bonfireRadianceBirth = clamp(
    bonfirePrimaryVisibleFrontEmission * (0.92 + bonfireRadianceBreakup * 0.22)
      + bonfireFrontContactRadiance * bonfireRadianceBreakup * bonfireFrontLiftGate * 0.24
      + bonfireTopologyRadianceCarrier * bonfireRadianceBreakup * 0.10
      + bonfireFireBirth * bonfireFireSourceBinRelief * bonfireRadianceSourceGate * 0.04
      + bonfireFuelHeatContact * bonfireRadianceSourceGate * bonfireFrontLiftGate * 0.06
      + bonfireLiftedReactionFront * bonfireRadianceBreakup * 0.18
      + bonfireInteriorEmissionBridge * bonfireVisibleSourcePlugRelief * 0.18
      + bonfirePacketFireBirth * bonfirePacketRisingFireGate * bonfireRadianceSourceGate * 0.12
      + bonfireEmberRing * bonfireRadianceSourceGate * 0.04,
    0.0,
    2.4
  ) * (0.72 + bonfireRadianceBreakup * 0.34);
  let bonfireEmissionDetailCurlFold = clamp(
    0.52
      + interfaceEnergy * 1.90
      + bonfireLayeredBreakup * 0.26
      + bonfireDetailBreakup * 0.22
      + bonfireTongues * 0.18
      + bonfirePacketCombustion.z * 0.22
      + fireLick * 0.08,
    0.36,
    1.55
  );
  let bonfireEmissionDetailBirth = clamp(
    bonfireRadianceBirth * (0.34 + bonfireRadianceBreakup * 0.24)
      + bonfireLiftedReactionFront * bonfireFrontLiftGate * bonfireRadianceBreakup * (0.14 + bonfireEmissionDetailCurlFold * 0.16)
      + bonfirePacketFireBirth * bonfirePacketRisingFireGate * (0.12 + bonfireTongues * 0.06 + bonfireEmissionDetailCurlFold * 0.08)
      + bonfireInteriorEmissionBridge * (0.14 + bonfireEmissionDetailCurlFold * 0.10)
      + fireLick * 0.12,
    0.0,
    2.4
  );
  let bonfireTransportedEmissionDetail = clamp(
    flameDetail * (0.66 + bonfireEmissionDetailCurlFold * 0.08)
      + bonfireEmissionDetailBirth * (0.56 + bonfireEmissionDetailCurlFold * 0.22)
      + fireLick * (0.12 + bonfireEmissionDetailCurlFold * 0.08)
      + emberFleck * 0.06,
    0.0,
    2.4
  );
  let fireBirth = mix(mix(columnFireBirth, tallPlumeEmitterFireBirth, tallPlumeScene), bonfireRadianceBirth, bonfireScene);
  let canonicalMinimalFireBirth = canonicalFireContent
    * source
    * (0.32 + canonicalSourceBreakup * 0.20)
    * (0.58 + canonicalBuoyancyLift * 0.24)
    * (1.0 - smoothstep(0.36, 0.90, p.y));
  let canonicalMinimalFireHeat = canonicalMinimalFireBirth * (0.80 + canonicalBuoyancyLift * 0.30);
  let swirl = vec3<f32>(-p.z, 0.0, p.x) / max(radial, 0.08);
  let phase = time * 4.8 + p.y * 12.0 + hash31(vec3<f32>(gid) * 0.071) * 3.2;
  let tallPlumeFireLickSource = mix(source, tallPlumeCombustionSource, tallPlumeScene);
  let fireLickBreakupEnabled = fireLickOperatorGain > 0.0005;
  var columnLickBirth = vec4<f32>(0.0, 0.0, 0.0, fireLickAshCarry(cellI, 0.0, 0.0));
  var bonfireLickBirth = vec4<f32>(0.0, 0.0, 0.0, fireLickAshCarry(cellI, 0.0, 1.0));
  if (fireLickBreakupEnabled) {
    columnLickBirth = fireLickBreakup(cellI, p * detailDomain, time, fireLickOperatorGain, heat, fuel, flame, flameDetail, tallPlumeFireLickSource);
    bonfireLickBirth = bonfireRadialFireLickBreakup(cellI, p * detailDomain, time, fireLickOperatorGain, heat, fuel, flame, flameDetail, source);
  }
  let lickBirth = mix(columnLickBirth, bonfireLickBirth, bonfireScene);
  let tallPlumeAnnularFrontContribution = tallPlumeAnnularFrontBirth * (0.34 + fireLickOperatorGain * 0.025);
  let columnCombustionFrontBirth = clamp(
    (lickBirth.y * 0.34 + interfaceEnergy * source * 0.62 + fireBirth * 0.12) * (0.36 + fireLickOperatorGain * 0.07)
      + tallPlumeAnnularFrontContribution,
    0.0,
    1.55
  );
  let combustionFrontBirth = mix(columnCombustionFrontBirth, bonfireCombustionFrontBirth, bonfireScene);
  let columnFrontTopologyBirth = max(columnCombustionFrontBirth * 0.32, tallPlumeAnnularFrontBirth * 0.42);
  combustionFrontTopology = max(combustionFrontTopology, mix(columnFrontTopologyBirth, bonfireFrontTopologyBirth + bonfireCombustionFrontBirth * 0.18, bonfireScene));
  let externalInjection = applyExternalEmitterInjection(externalEmitterInfluence(p, time));
  let oracleActivityCue = truthOracleActivityCueAtCell(cellI);
  let confinement = vorticityConfinement(cellI, 0.034 + curl * 0.044);
  let bonfireReferenceFrontContact = clamp(
    bonfireFrontContactRadiance * 0.42
      + bonfireCombustionFrontBirth * 0.44
      + bonfireLiftedReactionFront * 0.22
      + bonfireSootBirth * 0.14,
    0.0,
    2.4
  );
  let bonfireReferenceConfinement = bonfireReferenceConfinementForce(
    cellI,
    smoke,
    heat,
    flame,
    source,
    bonfireReferenceFrontContact,
    0.18 + curl * 0.38 + microAmount * 0.12 + shredAmount * 0.085 + fireLickAmount * 0.065
  );
  let bonfireNonWindAuthority = bonfireScene * (1.0 - explicitWindAuthority);
  let bonfireLocalLateralForceTarget = mix(1.0, max(explicitWindAuthority, 0.86), bonfireScene);
  let bonfireLocalLateralForceGain = mix(1.0, bonfireLocalLateralForceTarget, bonfireLateralDampingAblation);
  let bonfireDetailLateralDamping = bonfireLocalLateralForceGain;
  let rawDetailCarrier = source + smoke * 0.26 + heat * 0.18;
  let rawMicroCarrier = microAmount * (source * 0.74 + microSmoke * 0.38 + interfaceShred * 0.26 + fireLick * 0.22);
  let detailForceArtifactGain = 1.0 - detailScaleArtifactQuarantine;
  let tallPlumeDetailPhaseAnchor = transportedDetailPhaseAnchor(material, fireLayer, microLayer, combustionFrontTopology, prev.xyz, p) * tallPlumeScene;
  let tallPlumeDetailTime = mix(time, time * 0.72 + dot(tallPlumeDetailPhaseAnchor, vec3<f32>(1.7, -1.1, 1.3)), tallPlumeScene);
  let tallPlumeDetailP = p + tallPlumeDetailPhaseAnchor;
  let oracleActivityCurlNoise = oracleActivityCurlNoiseForce(cellI, tallPlumeDetailP, tallPlumeDetailTime, oracleActivityCue, clamp(u.oracle_activity_controls.y, 0.0, 3.0));
  let oracleActivityConfinement = oracleActivityVorticityConfinement(cellI, oracleActivityCue, clamp(u.oracle_activity_controls.z, 0.0, 3.0));
  let rawDetailForce = turbulentDetailForce(tallPlumeDetailP * (0.82 + physicalDetailScale * 0.30), tallPlumeDetailTime) * rawDetailCarrier * (0.018 + curl * 0.010) * detailForceArtifactGain;
  let rawMicroForce = turbulentDetailForce(tallPlumeDetailP * (2.85 * tallPlumeTransportedDetailFrequency) + vec3<f32>(0.13, -0.27, 0.31), tallPlumeDetailTime * 2.4) * rawMicroCarrier * 0.026;
  let rawShredForce = interfaceShreddingForce(cellI, (p + tallPlumeDetailPhaseAnchor * 0.35) * detailDomain, tallPlumeDetailTime, shredOperatorGain, heat, smoke, flame, interfaceShred);
  let rawFineBreakup = fineScaleBreakup(cellI, tallPlumeDetailP, tallPlumeDetailTime, curl, heat, smoke, source);
  var symmetricDetailForce = vec2<f32>(0.0);
  var symmetricMicroForce = vec2<f32>(0.0);
  var symmetricShredForce = vec2<f32>(0.0);
  var symmetricFineBreakup = vec2<f32>(0.0);
  if (bonfireScene > 0.5) {
    symmetricDetailForce = bonfireSymmetricLateralForce(p, time, rawDetailCarrier, 0.018 + curl * 0.010, 0.0);
    symmetricMicroForce = bonfireSymmetricLateralForce(p, time * 1.31, rawMicroCarrier, 0.026, 1.7);
    symmetricShredForce = bonfireSymmetricLateralForce(p, time * 1.13, length(rawShredForce.xz), 1.0, 3.2);
    symmetricFineBreakup = bonfireSymmetricLateralForce(p, time * 0.91, length(rawFineBreakup.xz), 1.0, 4.6);
  }
  let detailLateral = mix(vec2<f32>(rawDetailForce.x, rawDetailForce.z) * bonfireDetailLateralDamping, symmetricDetailForce, bonfireNonWindAuthority);
  let microLateral = mix(vec2<f32>(rawMicroForce.x, rawMicroForce.z) * bonfireDetailLateralDamping, symmetricMicroForce, bonfireNonWindAuthority);
  let shredLateral = mix(vec2<f32>(rawShredForce.x, rawShredForce.z) * bonfireDetailLateralDamping, symmetricShredForce, bonfireNonWindAuthority);
  let detailForce = vec3<f32>(detailLateral.x, rawDetailForce.y, detailLateral.y) * bonfireDetailForcesAblation;
  let microForce = vec3<f32>(microLateral.x, rawMicroForce.y, microLateral.y) * bonfireDetailForcesAblation;
  let shredForce = vec3<f32>(shredLateral.x, rawShredForce.y, shredLateral.y) * bonfireDetailForcesAblation;
  let heatExpansion = thermalExpansionForce(cellI, heat, 0.048 + curl * 0.019);
  let fineBreakupLateral = mix(vec2<f32>(rawFineBreakup.x, rawFineBreakup.z) * bonfireDetailLateralDamping, symmetricFineBreakup, bonfireNonWindAuthority);
  let fineBreakup = vec3<f32>(fineBreakupLateral.x, rawFineBreakup.y, fineBreakupLateral.y) * bonfireDetailForcesAblation;
  let projectionCorrection = vec3<f32>(0.0);
  let bonfireSwirlSymmetryGain = mix(1.0, max(explicitWindAuthority, 0.84), bonfireScene);
  vel = vel + (swirl * heat * (0.018 + 0.010 * curl) + swirl * source * 0.012) * bonfireSwirlSymmetryGain;
  vel = vel + confinement * (0.35 + smoke * 0.34 + heat * 0.52);
  vel = vel + oracleActivityCurlNoise;
  vel = vel + oracleActivityConfinement * (0.22 + smoke * 0.24 + heat * 0.32 + flame * 0.20);
  vel = vel + bonfireReferenceConfinement * bonfireScene * bonfireDetailForcesAblation;
  vel = vel + detailForce;
  vel = vel + microForce;
  vel = vel + shredForce;
  vel = vel + fineBreakup;
  vel = vel + heatExpansion;
  vel = vel + externalInjection.velocity.xyz * (0.18 + speed * 0.036);
  vel = vel + thermalBuoyancyForce(heat, smoke, fuel, speed) * plumeRiseScale * bonfireThermalRiseDirection * mix(1.0, canonicalBuoyancyLift, canonicalPlumeScene);
  let canonicalLiftGate = canonicalPlumeScene * (1.0 - smoothstep(0.52, 0.94, p.y));
  vel.y = vel.y + canonicalLiftGate * (source * (0.070 + speed * 0.012) * canonicalSourceInjection + smoke * (0.010 + speed * 0.002) * canonicalBuoyancyLift);
  let canonicalRadial = max(length(p.xz), 0.025);
  let canonicalEntrainmentCell = vec3<f32>(
    sin(p.y * 5.2 + p.z * 3.1 + canonicalPhaseTime * 0.37),
    sin(p.x * 4.7 - p.z * 2.9 - canonicalPhaseTime * 0.31) * 0.35,
    cos(p.y * 4.8 - p.x * 3.4 + canonicalPhaseTime * 0.41)
  );
  let canonicalEntrainmentBand = canonicalPlumeScene
    * smoothstep(-0.64, -0.28, p.y)
    * (1.0 - smoothstep(0.50, 0.86, p.y));
  let canonicalTangent = vec3<f32>(-p.z / canonicalRadial, 0.0, p.x / canonicalRadial);
  let canonicalInward = vec3<f32>(-p.x / canonicalRadial, 0.0, -p.z / canonicalRadial);
  let canonicalEntrainmentVelocity = (
    canonicalTangent * canonicalEntrainmentCell.x * 0.030
      + canonicalInward * max(canonicalEntrainmentCell.z, -0.25) * 0.018
      + vec3<f32>(0.0, canonicalEntrainmentCell.y * 0.009, 0.0)
  ) * smoke * canonicalEntrainmentBand * (0.75 + speed * 0.12);
  vel = vel + canonicalEntrainmentVelocity;
  let canonicalRadialSpreadBand = canonicalPlumeScene * smoothstep(-0.66, -0.20, p.y) * (1.0 - smoothstep(0.42, 0.82, p.y));
  let canonicalRadialSpread = vec3<f32>(p.x / canonicalRadial, 0.0, p.z / canonicalRadial)
    * smoke
    * canonicalRadialSpreadBand
    * (0.018 + speed * 0.004);
  vel = vel + canonicalRadialSpread;
  let bonfireLiftImpulse = bonfireEntrainedLift(smoke, heat, flame, source, bonfireCombustion, plumeRiseScale, speed);
  let bonfirePacketLiftImpulse = bonfirePacketCombustion.w * plumeRiseScale * (0.014 + speed * 0.0048 + fireLickAmount * 0.0012);
  let bonfireBroadSupportLiftImpulse = bonfireBroadSupportSmokeSource * plumeRiseScale * (0.012 + speed * 0.0028);
  let bonfireLiftedSootBuoyancy = (
    bonfireSootBirth * 0.38
      + bonfireCombustionFrontLiftCarrier * 0.42
      + bonfireLiftedReactionFront * 0.22
  ) * bonfireFrontLiftGate * plumeRiseScale * (0.011 + speed * 0.0026 + curl * 0.0012);
  let columnLiftImpulse = (source * (0.022 + speed * 0.006) + smoke * 0.003) * plumeRiseScale;
  vel.y = vel.y + mix(columnLiftImpulse, bonfireLiftImpulse + bonfirePacketLiftImpulse + bonfireBroadSupportLiftImpulse + bonfireLiftedSootBuoyancy, bonfireScene) * bonfireThermalRiseDirection;
  vel.x = vel.x + sin(phase) * (smoke + heat) * 0.0038 * curl;
  vel.z = vel.z + cos(phase * 0.93) * (smoke + heat) * 0.0038 * curl;
  let bonfireNonWindLateralDampingTarget = mix(1.0, max(explicitWindAuthority, 0.82), bonfireScene);
  let bonfireNonWindLateralDamping = mix(1.0, bonfireNonWindLateralDampingTarget, bonfireLateralDampingAblation);
  vel.x = vel.x * bonfireNonWindLateralDamping;
  vel.z = vel.z * bonfireNonWindLateralDamping;
  let bonfireCenteringCarrier = clamp(source * 0.58 + smoke * 0.62 + heat * 0.24, 0.0, 1.5);
  let bonfireUpperDepinchBand = smoothstep(0.28, 0.54, bonfireVisualAboveSource) * (1.0 - smoothstep(1.22, 1.62, bonfireVisualAboveSource));
  let bonfireTopDriftGuard = smoothstep(1.05, 1.42, bonfireVisualAboveSource) * 0.04;
  let bonfireAxisEntrainmentBand = 1.0
    + smoothstep(-0.06, 0.18, bonfireVisualAboveSource) * (1.0 - smoothstep(0.82, 1.18, bonfireVisualAboveSource)) * 0.34
    + bonfireTopDriftGuard;
  let bonfireDepinchRecenteringRelief = 1.0 - bonfireUpperDepinchBand * 0.84;
  let bonfireBreathingRecenteringGain = (0.068 + speed * 0.012) * bonfireAxisEntrainmentBand * bonfireDepinchRecenteringRelief;
  let bonfireNonWindRecenteringGain = bonfireBreathingRecenteringGain * bonfireRecenterAblation;
  let bonfireNonWindCenteringForce = vec3<f32>(-p.x, 0.0, -p.z) * bonfireNonWindAuthority * bonfireCenteringCarrier * bonfireNonWindRecenteringGain;
  let bonfireUpperDepinchRadial = max(length(p.xz), 0.025);
  let bonfireUpperDepinchDir = p.xz / bonfireUpperDepinchRadial;
  let bonfireUpperDepinchCore = (1.0 - smoothstep(0.06, 0.72, bonfireUpperDepinchRadial)) * smoothstep(0.010, 0.26, bonfireUpperDepinchRadial);
  let bonfireUpperDepinchOutflow = vec3<f32>(bonfireUpperDepinchDir.x, 0.0, bonfireUpperDepinchDir.y)
    * bonfireUpperDepinchBand
    * bonfireUpperDepinchCore
    * bonfireNonWindAuthority
    * bonfireCenteringCarrier
    * (0.076 + speed * 0.0120);
  var bonfireZeroMeanFlow = vec3<f32>(0.0);
  var bonfirePlumeRoll = vec3<f32>(0.0);
  var bonfireCellRoll = vec3<f32>(0.0);
  var bonfireLayeredPlumeShear = vec3<f32>(0.0);
  if (bonfireScene > 0.5) {
    bonfireZeroMeanFlow = bonfireZeroMeanLateralFlow(p, bonfireSourceY, bonfireCombustion, time, curl * 0.23 + microAmount * 0.15 + shredAmount * 0.070 + fireLickAmount * 0.060);
    bonfirePlumeRoll = bonfireZeroMeanPlumeRoll(p, bonfireSourceY, smoke, heat, flame, source, time, curl * 0.24 + microAmount * 0.13 + shredAmount * 0.080 + fireLickAmount * 0.060);
    bonfireCellRoll = bonfireConvectiveCellRoll(p, bonfireSourceY, smoke, heat, flame, source, time, curl * 0.22 + microAmount * 0.12 + shredAmount * 0.085 + fireLickAmount * 0.055);
    let bonfireLayerShearRadial = max(length(p.xz), 0.025);
    let bonfireLayerShearDir = p.xz / bonfireLayerShearRadial;
    let bonfireLayerShearTangent = vec2<f32>(-bonfireLayerShearDir.y, bonfireLayerShearDir.x);
    let bonfireLayerShearBand = smoothstep(0.12, 0.32, bonfireVisualAboveSource) * (1.0 - smoothstep(1.02, 1.52, bonfireVisualAboveSource));
    let bonfireLayerShearPhase = bonfireVisualAboveSource * 19.0 + bonfireLayerShearRadial * 12.0 + time * 1.18;
    let bonfireLayeredPlumeShear2 = (bonfireLayerShearDir * sin(bonfireLayerShearPhase) * 0.64 + bonfireLayerShearTangent * cos(bonfireLayerShearPhase * 0.73 + bonfireLayeredBreakup * 2.0) * 0.52)
      * bonfireLayerShearBand
      * bonfireCenteringCarrier
      * (0.026 + curl * 0.007 + microAmount * 0.004)
      * (0.62 + bonfireLayeredBreakup * 0.48);
    bonfireLayeredPlumeShear = vec3<f32>(
      bonfireLayeredPlumeShear2.x,
      -sin(bonfireLayerShearPhase * 0.81) * bonfireLayerShearBand * bonfireCenteringCarrier * 0.010,
      bonfireLayeredPlumeShear2.y
    );
  }
  vel = vel + bonfireZeroMeanFlow * bonfireNonWindAuthority;
  vel = vel + bonfirePlumeRoll * bonfireNonWindAuthority;
  vel = vel + bonfireCellRoll * bonfireNonWindAuthority;
  vel = vel + bonfireLayeredPlumeShear * bonfireNonWindAuthority * bonfireShearAblation;
  vel = vel + bonfireReferenceConfinement * bonfireScene * bonfireInstabilityProbe * 1.6;
  vel = vel + bonfirePlumeRoll * bonfireNonWindAuthority * bonfireInstabilityProbe * 1.4;
  vel = vel + bonfireCellRoll * bonfireNonWindAuthority * bonfireInstabilityProbe * 1.2;
  vel = vel + bonfireUpperDepinchOutflow * bonfireDepinchAblation;
  vel = vel + bonfireNonWindCenteringForce;
  let windMaterialCoupling = clamp(smoke * 0.54 + heat * 0.30 + source * 0.34 + flame * 0.18, 0.0, 1.6);
  let bonfireWindResponseGain = mix(1.0, 4.0, bonfireScene);
  vel = vel + windDirection * windStrength * windHeightRamp * windMaterialCoupling * bonfireWindResponseGain * (0.020 + speed * 0.004);
  vel = vel - projectionCorrection * (0.32 + smoke * 0.08 + heat * 0.06);
  let smokeFromHeat = heatToSmokeConversion(heat, fuel, p.y);
  let columnSmokeBirth = source * 0.46 + emberRing * 0.13;
  let tallPlumeDirectSmokeBirthGain = mix(1.0, 0.18, tallPlumeScene);
  let tallPlumeSourceCarrierFloor = source * 0.060 * tallPlumeScene;
  let tallPlumeSmokeBirth = columnSmokeBirth * tallPlumeDirectSmokeBirthGain + tallPlumeSourceCarrierFloor;
  let columnSmokeBirthForScene = mix(columnSmokeBirth, tallPlumeSmokeBirth, tallPlumeScene);
  let canonicalSmokeBirth = source * 1.28 + heat * 0.10;
  let bonfireAdvectedSmokeBirth = (bonfireSmokeSource * 0.060 + bonfireBroadSupportSmokeSource * 0.028) * bonfireLayeredSmokeBreakup + bonfireSootBirth * 0.20 + bonfireInterfaceBirth * 0.050 + bonfireCombustion.z * 0.010 + smokeFromHeat * bonfireInterfaceSmokeBand * 0.060;
  let canonicalScalarRadial = max(length(p.xz), 0.025);
  let canonicalScalarSpread = canonicalPlumeScene
    * smoothstep(-0.68, -0.20, p.y)
    * (1.0 - smoothstep(0.42, 0.82, p.y))
    * smoothstep(0.045, 0.25, canonicalScalarRadial)
    * (1.0 - smoothstep(0.28, 0.58, canonicalScalarRadial))
    * (
      readSlot(cellI + vec3<i32>(1, 0, 0), 1u).x
        + readSlot(cellI + vec3<i32>(-1, 0, 0), 1u).x
        + readSlot(cellI + vec3<i32>(0, 0, 1), 1u).x
        + readSlot(cellI + vec3<i32>(0, 0, -1), 1u).x
    ) * 0.25;
  let canonicalCenterlineRelief = canonicalPlumeScene
    * (1.0 - smoothstep(0.025, 0.13, canonicalScalarRadial))
    * smoothstep(-0.50, -0.08, p.y)
    * (1.0 - smoothstep(0.52, 0.86, p.y));
  let canonicalBroadBodyRelief = canonicalPlumeScene
    * smoothstep(-0.54, -0.12, p.y)
    * (1.0 - smoothstep(0.20, 0.62, p.y))
    * smoothstep(0.20, 0.44, canonicalScalarRadial);
  let canonicalUpperChimneyRelief = canonicalPlumeScene
    * smoothstep(0.30, 0.70, p.y)
    * (1.0 - smoothstep(0.035, 0.16, canonicalScalarRadial));
  let canonicalPlumeBodyBalance = clamp(canonicalBroadBodyRelief * 0.25 + canonicalUpperChimneyRelief * 0.22, 0.0, 0.34) * canonicalBodyBalanceGain;
  let canonicalSmokeCapacity = mix(2.2, 0.88 - canonicalPlumeBodyBalance, canonicalPlumeScene);
  let canonicalSmokeTransport = min(
    max(
      smoke * (0.968 - canonicalCenterlineRelief * 0.16 * canonicalCenterlineGain - canonicalPlumeBodyBalance * 0.10)
        + smokeFromHeat * 0.18
        + canonicalScalarSpread * canonicalSpreadGain * (0.12 - canonicalBroadBodyRelief * canonicalBodyBalanceGain * 0.035),
      canonicalSmokeBirth
    ),
    canonicalSmokeCapacity
  );
  let columnSmokeTransport = mix(max(smoke + smokeFromHeat, columnSmokeBirthForScene), canonicalSmokeTransport, canonicalPlumeScene);
  let bonfireSmokeTransport = min(1.65, smoke + bonfireAdvectedSmokeBirth);
  smoke = mix(columnSmokeTransport, bonfireSmokeTransport, bonfireScene);
  smoke = max(smoke, externalInjection.material.x * 0.76);
  let columnHeatBirth = source * 0.74 + emberRing * 0.18;
  let tallPlumeHeatBirth = tallPlumeCombustionSource * 0.74 + tallPlumeEmitterFireBirth * 0.10 + emberRing * 0.12;
  let canonicalHeatBirth = source * 1.16 * canonicalBuoyancyLift + canonicalMinimalFireHeat;
  let bonfireHeatBirth = bonfireCoreHeat * 0.78 + bonfireReactionFront * inputFlow * sourceScaleCompensation * 0.20 + bonfireEmberRing * 0.08;
  heat = max(heat, mix(mix(mix(columnHeatBirth, tallPlumeHeatBirth, tallPlumeScene), canonicalHeatBirth, canonicalPlumeScene), bonfireHeatBirth, bonfireScene));
  heat = max(heat, externalInjection.material.y * 0.92);
  let bonfireFuelMask = smoothstep(bonfireSourceY - 0.34, bonfireSourceY - 0.04, p.y);
  let sourceFuelMask = mix(1.0 - smoothstep(-0.74, -0.18, p.y), bonfireFuelMask, bonfireScene);
  let columnFuelInjection = source * 0.88 * sourceFuelMask;
  let tallPlumeFuelInjection = mix(columnFuelInjection, tallPlumeCombustionSource * 0.88 * reactionFuelScale, tallPlumeScene);
  fuel = max(fuel, mix(tallPlumeFuelInjection, bonfireInjectedFuel, bonfireScene));
  fuel = max(fuel, externalInjection.material.z * 0.72);
  let tallPlumeReactionMemory = tallPlumeScene * clamp(
    flame * 0.34
      + ember * 0.22
      + flameDetail * 0.22
      + fireLick * 0.14
      + combustionFront * 0.18,
    0.0,
    1.4
  );
  let tallPlumeFuelContact = smoothstep(0.006, 0.12, fuel);
  let tallPlumeHeatContact = smoothstep(0.030, 0.58, heat);
  let tallPlumeLiveReactionCarrier = 0.18
    + 0.26 * tallPlumeCombustionSource
    + 0.22 * tallPlumeEmitterFireBirth
    + 0.18 * flame
    + 0.10 * emberRing
    + 0.12 * tallPlumeReactionMemory;
  let tallPlumeLiveReaction = tallPlumeFuelContact
    * tallPlumeHeatContact
    * tallPlumeLiveReactionCarrier;
  let tallPlumePilotReaction = tallPlumeScene
    * tallPlumeReactionMemory
    * smoothstep(0.004, 0.055, fuel)
    * smoothstep(0.025, 0.42, heat)
    * (0.055 + inputFlow * 0.025 + fireLickAmount * 0.002);
  let tallPlumeFuelHeatReaction = tallPlumeScene * max(tallPlumeLiveReaction, tallPlumePilotReaction);
  let fuelConsumption = tallPlumeFuelHeatReaction * (0.012 + inputFlow * 0.010 + fireLickAmount * 0.002) + tallPlumePilotReaction * 0.006;
  let tallPlumeReactionSmokeBirth = tallPlumeScene * (fuelConsumption * 0.74 + smokeFromHeat * 0.10 + tallPlumePilotReaction * 0.045);
  smoke = smoke + tallPlumeReactionSmokeBirth;
  heat = heat + tallPlumeFuelHeatReaction * mix(0.0, 0.16, tallPlumeScene) + tallPlumePilotReaction * 0.030;
  fuel = max(fuel - heat * 0.018 - fuelConsumption, 0.0);
  let bonfireDetailBirthCarrier = bonfireAdvectedSmokeBirth * 0.48 + bonfireSootBirth * 0.30 + bonfireBroadSupportSmokeSource * 0.046 * bonfireLayeredSmokeBreakup + smokeFromHeat * bonfireInterfaceSmokeBand * 0.13 + bonfireInterfaceBirth * 0.18 + bonfireCombustion.z * 0.036 + smoke * 0.070;
  let bonfireSmokeDetailCurlFold = clamp(
    0.50
      + interfaceEnergy * 1.55
      + length(bonfireLayeredPlumeShear.xz) * 8.0
      + abs(bonfireLayeredPlumeShear.y) * 14.0
      + bonfireLayeredSmokeBreakup * 0.22
      + bonfireDetailBreakup * 0.18
      + bonfireTongues * 0.12,
    0.34,
    1.55
  );
  let columnMaterialDetailBirth = (source + emberRing + smokeFromHeat * 3.2) * (0.30 + 0.36 * bonfireDetailBreakup);
  let bonfireMaterialDetailBirth = (bonfireDetailBirthCarrier + emberRing * 0.04) * (0.10 + 0.10 * bonfireDetailBreakup + 0.06 * bonfireTongues + bonfireSmokeDetailCurlFold * 0.08);
  let oracleMaterialBirth = oracleActivityMaterialBirth(oracleActivityCue, clamp(u.oracle_activity_controls.w, 0.0, 3.0), heat, smoke, flame, source);
  materialDetail = mix(max(materialDetail, columnMaterialDetailBirth), min(2.6, materialDetail + bonfireMaterialDetailBirth), bonfireScene);
  materialDetail = max(materialDetail, oracleMaterialBirth * 0.34);
  materialDetail = max(materialDetail, externalInjection.material.w * 0.90);
  let columnMicroSmokeBirth = (source * 0.22 + smokeFromHeat * 0.64 + materialDetail * 0.18) * microAmount * (0.44 + 0.38 * bonfireDetailBreakup);
  let bonfireMicroSmokeBirth = (bonfireAdvectedSmokeBirth * 0.22 + smokeFromHeat * bonfireInterfaceSmokeBand * 0.08 + materialDetail * 0.054 + bonfireInterfaceBirth * 0.15 + smoke * 0.038) * microAmount * (0.10 + 0.08 * bonfireDetailBreakup + 0.06 * bonfireTongues + 0.05 * bonfireLayeredBreakup + bonfireSmokeDetailCurlFold * 0.09);
  microSmoke = mix(max(microSmoke, columnMicroSmokeBirth), min(2.4, microSmoke + bonfireMicroSmokeBirth), bonfireScene);
  microSmoke = max(microSmoke, oracleMaterialBirth * 0.18);
  microSmoke = max(microSmoke, externalInjection.micro.x);
  let interfaceSourceTerm = mix(source * 0.30, source * 0.08 + bonfireInterfaceBirth * 0.54 + smokeFromHeat * 0.32, bonfireScene);
  interfaceShred = max(interfaceShred, interfaceEnergy * shredOperatorGain * (smoke * 0.54 + heat * 0.38 + flame * 0.32 + materialDetail * 0.28 + microSmoke * 0.13 + interfaceSourceTerm) * 1.72);
  interfaceShred = max(interfaceShred, oracleMaterialBirth * 0.26);
  interfaceShred = max(interfaceShred, externalInjection.micro.y);
  let bonfirePacketLickBirth = bonfireScene * (
    bonfirePacketCombustion.y * (0.46 + fireLickOperatorGain * 0.22 + bonfireLayeredBreakup * 0.18)
      + bonfirePacketCombustion.z * (0.24 + bonfireTongues * 0.16)
      + bonfirePacketCombustion.w * 0.11
  );
  fireLick = fireLick * mix(1.0, max(0.18, bonfireVisibleSourcePlugRelief), bonfireScene);
  let bonfireFireLickSourceBirth = clamp((bonfireFrontContactRadiance * 0.42 + bonfireRadianceBirth * 0.34 + bonfireCombustionFrontBirth * 0.14 + bonfireTopologyPacketTransfer * 0.62) * bonfireVisibleSourcePlugRelief, 0.0, 2.6);
  let fireLickSourceBirth = mix(fireBirth, bonfireFireLickSourceBirth, bonfireScene);
  fireLick = max(fireLick, lickBirth.x + fireLickSourceBirth * fireLickOperatorGain * (0.30 + 0.22 * bonfireTongues * bonfireScene) + bonfireRadianceBirth * bonfireScene * 0.28 + bonfireLiftedFireLobes * bonfireScene * 0.10 + bonfireBroadSupportSmokeSource * bonfireScene * 0.008 + bonfirePacketLickBirth);
  fireLick = max(fireLick, oracleMaterialBirth * 0.16);
  let tallPlumeAboveSource = smoothstep(-0.72, 0.34, p.y);
  let tallPlumeRadialContour = smoothstep(scaledSourceRadius * 0.22, scaledSourceRadius * 1.10, sourceRadial)
    * (1.0 - smoothstep(scaledSmokeSourceRadius * 1.55, scaledSmokeSourceRadius * 3.00, sourceRadial));
  let tallPlumeFireContourBreakup = clamp(
    0.72
      + 0.20 * sin(p.y * 17.0 + sourceRadial * 29.0 - time * 2.4)
      + 0.16 * cos(p.x * 23.0 - p.z * 19.0 + p.y * 7.0 + time * 1.6)
      + 0.14 * (hash31(floor(vec3<f32>(p.x * 18.0, p.y * 24.0, p.z * 18.0) + vec3<f32>(floor(time * 3.0)))) - 0.5),
    0.30,
    1.20
  );
  let tallPlumeReactionContour = clamp(
    smoothstep(0.002, 0.095, tallPlumeFuelHeatReaction + tallPlumePilotReaction * 0.68 + fuel * heat * 0.20)
      * mix(1.0, mix(0.52, 1.0, tallPlumeRadialContour) * tallPlumeFireContourBreakup, tallPlumeScene * tallPlumeAboveSource),
    0.0,
    1.0
  );
  let tallPlumeFuelReactionGate = mix(
    1.0,
    max(
      tallPlumeReactionContour,
      smoothstep(0.001, 0.055, tallPlumeReactionMemory * fuel * 0.08 + fuel * heat * 0.14)
    ),
    tallPlumeScene
  );
  fireLick = fireLick * tallPlumeFuelReactionGate + tallPlumeFuelHeatReaction * fireLickOperatorGain * 0.16;
  fireLick = max(fireLick, externalInjection.micro.z);
  emberFleck = max(emberFleck, lickBirth.w + emberRing * 0.18 + interfaceShred * 0.10);
  emberFleck = max(emberFleck, externalInjection.micro.w);
  materialDetail = max(materialDetail, microSmoke * 0.25 + interfaceShred * 0.38);
  flame = flame * mix(1.0, max(0.08, bonfireFlameStorageSourceRelief), bonfireScene);
  let columnFlameStorageBirth = fireBirth * (1.18 + 0.18 * bonfireTongues * bonfireScene) + heat * fuel * 0.060 + fireLick * 0.48;
  let tallPlumeRawSourceFireRelief = mix(1.0, tallPlumeReactionContour * mix(1.0, 0.35, tallPlumeAboveSource), tallPlumeScene);
  let tallPlumeReactionBoundFlameStorageBirth = (
    fireBirth * 0.024 * tallPlumeRawSourceFireRelief
      + heat * fuel * 0.12
      + fireLick * 0.30
      + tallPlumeFuelHeatReaction * (1.22 + fireLickOperatorGain * 0.06)
  ) * tallPlumeFuelReactionGate;
  let columnReactionBoundFlameStorageBirth = mix(columnFlameStorageBirth, tallPlumeReactionBoundFlameStorageBirth, tallPlumeScene);
  let bonfireFrontStorageOccupancy = clamp(
    bonfireVisibleFlamePacketGate * 1.08
      + bonfireFlameOccupancy * bonfireRadianceSourceGate * bonfireFrontLiftGate * 0.12
      + bonfireFrontContactRadiance * bonfireFrontLiftGate * 0.22
      + bonfireCombustionFrontBirth * bonfirePacketRisingFireGate * 0.20
      + bonfireTransportedEmissionDetail * 0.18,
    0.0,
    3.0
  );
  let bonfireFlameStorageBirth = bonfireFrontStorageOccupancy * (0.42 + bonfireTongues * 0.08) * bonfireFlameStorageSourceRelief
    + bonfireVisibleFlamePacketGate * 0.28 * max(0.44, bonfireFlameStorageSourceRelief)
    + bonfireRadianceBirth * 0.06 * bonfireFlameStorageSourceRelief
    + bonfireFuelHeatContact * bonfireRadianceSourceGate * bonfireFrontLiftGate * 0.004
    + fireLick * 0.14 * bonfireFlameStorageSourceRelief;
  flame = max(flame, mix(columnReactionBoundFlameStorageBirth, bonfireFlameStorageBirth, bonfireScene));
  flame = max(flame, externalInjection.fire.x);
  let columnEmberBirth = mix(fireBirth * 0.78 + flame * 0.22, tallPlumeFuelHeatReaction * 0.62 + flame * 0.18 + fireLick * 0.08, tallPlumeScene);
  ember = max(ember, mix(columnEmberBirth, bonfireRadianceBirth * 0.54 + flame * 0.16, bonfireScene) + emberFleck * 0.18);
  ember = max(ember, externalInjection.fire.y);
  let bonfirePacketVisibleCarrierBirth = bonfireScene * (
    bonfirePacketCombustion.z * (0.72 + bonfireLayeredBreakup * 0.28)
      + bonfirePacketCombustion.y * 0.34
      + bonfirePacketCombustion.w * 0.18
  ) * (0.52 + bonfireTongues * 0.34 + fireLickOperatorGain * 0.12);
  let columnFlameDetailBirth = (fireBirth * 1.02 + heatExpansion.y * 4.0) * (0.42 + 0.42 * bonfireDetailBreakup) + lickBirth.z + fireLick * 0.34;
  let tallPlumeSourceSlabRelief = mix(1.0, tallPlumeRawSourceFireRelief * tallPlumeFireContourBreakup, tallPlumeScene);
  let tallPlumeReactionBoundFlameDetailBirth = (
    columnFlameDetailBirth * 0.018 * tallPlumeSourceSlabRelief
      + tallPlumeFuelHeatReaction * (0.92 + fireLickOperatorGain * 0.05)
      + fireLick * 0.20
      + flame * 0.16
      + combustionFront * 0.12
  ) * tallPlumeFuelReactionGate;
  let columnReactionBoundFlameDetailBirth = mix(columnFlameDetailBirth, tallPlumeReactionBoundFlameDetailBirth, tallPlumeScene);
  flameDetail = flameDetail * mix(1.0, max(0.12, bonfireVisibleSourcePlugRelief), bonfireScene);
  visibleFireCarrier = flameDetail;
  let bonfireVisibleFireFrontGate = clamp(
    max(
      bonfireFrontLiftGate,
      smoothstep(0.13, 0.42, bonfireVisualAboveSource) * (1.0 - smoothstep(0.96, 1.28, bonfireVisualAboveSource))
    )
      + bonfireTopologyPacketTransfer * 0.06,
    0.0,
    1.0
  );
  let bonfireFrontAuthoredVisibleFireBirth = clamp(
    bonfireVisibleFlamePacketGate * (0.72 + bonfireRadianceBreakup * 0.16)
      + bonfireTopologyPacketTransfer * (1.06 + bonfireRadianceBreakup * 0.26)
      + bonfireCombustionFrontBirth * bonfirePacketRisingFireGate * 0.36
      + bonfireFrontContactRadiance * bonfireVisibleFireFrontGate * 0.24
      + bonfirePacketVisibleCarrierBirth * 0.46,
    0.0,
    3.0
  );
  let bonfireVisibleFireCarrierBirth = bonfirePrimaryVisibleFrontEmission * (0.72 + bonfireRadianceBreakup * 0.18)
    + bonfireTransportedEmissionDetail * (0.34 + bonfireRadianceBreakup * 0.08) * max(0.30, bonfireVisibleFireFrontGate)
    + bonfireFrontAuthoredVisibleFireBirth
    + bonfireTopologyPacketTransfer * bonfireVisibleFireFrontGate * 0.10
    + bonfireRadianceBirth * 0.08 * bonfireVisibleSourcePlugRelief
    + bonfireInteriorEmissionBridge * bonfireVisibleFireFrontGate * 0.14
    + heatExpansion.y * 0.92 * bonfireVisibleFireFrontGate
    + bonfireCombustion.z * 0.08
    + lickBirth.z
    + fireLick * 0.18;
  flameDetail = max(flameDetail, mix(columnReactionBoundFlameDetailBirth, bonfireVisibleFireCarrierBirth, bonfireScene));
  visibleFireCarrier = flameDetail;
  flameDetail = max(flameDetail, externalInjection.fire.z);
  visibleFireCarrier = flameDetail;
  combustionFront = max(combustionFront, combustionFrontBirth);
  let tallPlumeBurnoutTail = tallPlumeScene
    * tallPlumeReactionMemory
    * smoothstep(0.018, 0.48, heat)
    * smoothstep(0.0005, 0.020, fuel + tallPlumeFuelHeatReaction * 0.75 + fuelConsumption * 2.0)
    * (0.018 + inputFlow * 0.018);
  flame = max(flame, tallPlumeBurnoutTail * 0.18);
  ember = max(ember, tallPlumeBurnoutTail * 0.16);
  flameDetail = max(flameDetail, tallPlumeBurnoutTail * 0.11);
  visibleFireCarrier = flameDetail;
  let tallPlumeFireSurvivalSignal = tallPlumeFuelHeatReaction
    + tallPlumePilotReaction * 0.90
    + tallPlumeBurnoutTail * 0.35
    + fuelConsumption * 1.6
    + fuel * heat * 0.14
    + fuel * 0.035;
  let tallPlumeNormalizedFlameHeight = clamp((p.y + 0.84) / 1.58, 0.0, 1.0);
  let tallPlumeHeightCurve = tallPlumeNormalizedFlameHeight * tallPlumeNormalizedFlameHeight * (0.65 + tallPlumeNormalizedFlameHeight * 0.55);
  let tallPlumeFlowHeightDemand = 1.0 + smoothstep(0.28, 0.62, inputFlow) * tallPlumeNormalizedFlameHeight * 1.35;
  let tallPlumeFlameHeightDemand = mix(0.012, 0.315, tallPlumeHeightCurve) * tallPlumeFlowHeightDemand;
  let tallPlumeFuelSurvival = smoothstep(
    0.001,
    0.092,
    fuel + tallPlumeFuelHeatReaction * 1.65 + fuelConsumption * 4.8 + tallPlumeBurnoutTail * 0.85
  );
  let tallPlumeReactionSurvival = smoothstep(
    tallPlumeFlameHeightDemand * 0.42,
    tallPlumeFlameHeightDemand,
    tallPlumeFireSurvivalSignal + tallPlumeReactionMemory * 0.018 + tallPlumeBurnoutTail * 0.55
  );
  let tallPlumeFlameContourSurvival = clamp(
    mix(
      1.0,
      mix(0.60, 1.0, tallPlumeRadialContour) * clamp(tallPlumeFireContourBreakup, 0.50, 1.0),
      tallPlumeScene * tallPlumeAboveSource
    ),
    0.32,
    1.0
  );
  let tallPlumeRadialRatio = sourceRadial / max(scaledSourceRadius, 0.001);
  let tallPlumeUpperFrontWidth = max(
    0.16,
    mix(1.72, 0.52, tallPlumeNormalizedFlameHeight)
      * mix(1.0, 0.58, smoothstep(0.32, 0.66, inputFlow))
  );
  let tallPlumeFrontWidthTaper = clamp(
    1.0 - smoothstep(tallPlumeUpperFrontWidth, tallPlumeUpperFrontWidth + 0.46, tallPlumeRadialRatio),
    0.10,
    1.0
  );
  let tallPlumeFlameTipTaper = clamp(
    1.0
      - smoothstep(0.42, 0.86, tallPlumeNormalizedFlameHeight)
        * smoothstep(0.34, 0.66, inputFlow)
        * (1.0 - tallPlumeReactionContour * 0.55),
    0.12,
    1.0
  );
  let tallPlumeTransitionBand = tallPlumeScene
    * tallPlumeAboveSource
    * smoothstep(0.22, 0.78, tallPlumeNormalizedFlameHeight)
    * smoothstep(0.22, 0.62, inputFlow);
  let tallPlumeTransitionRetirementBreakup = tallPlumeTransitionBandStagger(tallPlumeFireContourBreakup, materialDetail, microSmoke, interfaceShred, flameDetail, combustionFrontTopology);
  let tallPlumeTransitionExtinctionBreakup = mix(
    1.0,
    clamp(1.24 - tallPlumeTransitionRetirementBreakup * 0.48, 0.56, 1.12),
    tallPlumeTransitionBand
  );
  let tallPlumeTransitionSurvivalBreakup = mix(
    1.0,
    clamp(0.70 + tallPlumeTransitionRetirementBreakup * 0.36, 0.62, 1.18),
    tallPlumeTransitionBand
  );
  let tallPlumeHighFlowShelfExtinction = tallPlumeScene
    * tallPlumeAboveSource
    * smoothstep(0.30, 0.58, inputFlow)
    * (1.0 - smoothstep(0.016, 0.145, tallPlumeFuelHeatReaction + fuelConsumption * 3.2 + tallPlumePilotReaction * 2.0 + tallPlumeBurnoutTail * 3.2))
    * tallPlumeTransitionExtinctionBreakup;
  let tallPlumeUpperFlowExtinction = tallPlumeScene
    * tallPlumeAboveSource
    * smoothstep(0.30, 0.58, inputFlow)
    * smoothstep(0.16, 0.62, tallPlumeNormalizedFlameHeight)
    * (1.0 - smoothstep(0.030, 0.165, tallPlumeFuelHeatReaction + fuelConsumption * 3.9 + tallPlumePilotReaction * 2.2 + tallPlumeBurnoutTail * 0.65))
    * tallPlumeTransitionExtinctionBreakup;
  let tallPlumeUpperSlabExtinction = tallPlumeScene
    * tallPlumeAboveSource
    * smoothstep(0.32, 0.60, inputFlow)
    * smoothstep(0.20, 0.72, tallPlumeNormalizedFlameHeight)
    * smoothstep(0.22, 0.72, 1.0 - tallPlumeFrontWidthTaper)
    * (1.0 - smoothstep(0.024, 0.155, tallPlumeFuelHeatReaction + fuelConsumption * 3.4 + tallPlumePilotReaction * 2.0))
    * tallPlumeTransitionExtinctionBreakup;
  let tallPlumeHighFlowHeightGate = smoothstep(0.28, 0.58, inputFlow) * smoothstep(0.20, 0.72, tallPlumeNormalizedFlameHeight);
  let tallPlumeUntaperedLiveFlameSurvival = tallPlumeReactionSurvival * tallPlumeFuelSurvival * tallPlumeFlameContourSurvival;
  let tallPlumeLiveFlameTaperedSurvival = tallPlumeUntaperedLiveFlameSurvival
    * mix(
      1.0,
      tallPlumeFrontWidthTaper * tallPlumeFlameTipTaper,
      tallPlumeScene * tallPlumeAboveSource * smoothstep(0.28, 0.58, inputFlow)
    );
  let tallPlumeLiveFlameSurvival = tallPlumeLiveFlameTaperedSurvival * tallPlumeTransitionSurvivalBreakup * (1.0 - tallPlumeUpperSlabExtinction * 0.78);
  let tallPlumeMinimalFireBirthSurvival = mix(
    1.0,
    clamp(tallPlumeLiveFlameSurvival, 0.0, 1.0),
    tallPlumeScene
  );
  let tallPlumeTailOnlySurvival = tallPlumeBurnoutTail * 2.0 * (1.0 - tallPlumeHighFlowHeightGate * 0.88);
  let tallPlumeFlameHeightSurvival = clamp(
    max(tallPlumeLiveFlameSurvival, tallPlumeTailOnlySurvival)
      * (1.0 - tallPlumeHighFlowShelfExtinction * 0.90)
      * (1.0 - tallPlumeUpperFlowExtinction * 0.88),
    0.0,
    1.0
  );
  let tallPlumeFireSurvival = mix(1.0, tallPlumeFlameHeightSurvival, tallPlumeScene);
  flame = flame * tallPlumeFireSurvival;
  ember = ember * tallPlumeFireSurvival;
  flameDetail = flameDetail * tallPlumeFireSurvival;
  visibleFireCarrier = flameDetail;
  combustionFront = combustionFront * tallPlumeFireSurvival;
  fireLick = fireLick * tallPlumeFireSurvival;
  emberFleck = emberFleck * tallPlumeFireSurvival;
  let canonicalSurvivingMinimalFireBirth = canonicalMinimalFireBirth * tallPlumeMinimalFireBirthSurvival;
  flame = max(flame, canonicalSurvivingMinimalFireBirth * 1.04);
  ember = max(ember, canonicalSurvivingMinimalFireBirth * 0.36);
  flameDetail = max(flameDetail, canonicalSurvivingMinimalFireBirth * 0.42);

  let bonfireFireCeiling = mix(1.0, smoothstep(bonfireSourceY - 0.68, bonfireSourceY - 0.08, p.y), bonfireScene);
  flame = flame * bonfireFireCeiling;
  ember = ember * mix(1.0, max(0.24, bonfireFireCeiling), bonfireScene);
  flameDetail = flameDetail * bonfireFireCeiling;
  combustionFront = combustionFront * bonfireFireCeiling;
  fireLick = fireLick * mix(1.0, max(0.18, bonfireFireCeiling), bonfireScene);

  let wall = max(max(abs(p.x), abs(p.y)), abs(p.z));
  let wallFade = 1.0 - smoothstep(0.86, 1.0, wall);
  let smokeTopFade = 1.0 - smoothstep(mix(0.66, 0.84, plumeHeight01), 0.995, p.y);
  let legacyHeatTopFade = 1.0 - smoothstep(mix(0.42, 0.62, plumeHeight01), 0.960, p.y);
  let tallPlumeHeatTopFade = 1.0 - smoothstep(mix(0.62, 0.84, plumeHeight01), 0.990, p.y);
  let tallPlumeFireTopFade = 1.0 - smoothstep(mix(0.72, 0.90, plumeHeight01), 0.995, p.y);
  let heatTopFade = mix(legacyHeatTopFade, tallPlumeHeatTopFade, tallPlumeScene);
  let fireTopFade = mix(legacyHeatTopFade, tallPlumeFireTopFade, tallPlumeScene);
  smoke = smoke * mix(0.42, 1.0, wallFade) * mix(0.72, 1.0, smokeTopFade);
  heat = heat * mix(0.30, 1.0, wallFade) * mix(0.16, 1.0, heatTopFade);
  fuel = fuel * mix(0.20, 1.0, wallFade) * mix(0.58, 1.0, heatTopFade);
  materialDetail = materialDetail * mix(0.22, 1.0, wallFade);
  flame = flame * mix(0.12, 1.0, wallFade) * mix(0.08, 1.0, fireTopFade);
  ember = ember * mix(0.18, 1.0, wallFade) * mix(0.16, 1.0, smokeTopFade);
  flameDetail = flameDetail * mix(0.10, 1.0, wallFade);
  combustionFront = combustionFront * mix(0.10, 1.0, wallFade) * mix(0.08, 1.0, fireTopFade);
  combustionFrontTopology = combustionFrontTopology * mix(0.10, 1.0, wallFade) * mix(0.08, 1.0, fireTopFade);
  microSmoke = microSmoke * mix(0.20, 1.0, wallFade) * mix(0.50, 1.0, smokeTopFade);
  interfaceShred = interfaceShred * mix(0.18, 1.0, wallFade);
  fireLick = fireLick * mix(0.10, 1.0, wallFade) * mix(0.10, 1.0, fireTopFade);
  emberFleck = emberFleck * mix(0.15, 1.0, wallFade);
  let canonicalProofCarrierMask = 1.0 - canonicalPlumeScene;
  fuel = fuel * canonicalProofCarrierMask;
  materialDetail = materialDetail * canonicalProofCarrierMask;
  smoke = smoke * canonicalSmokeContent;
  flame = flame * (canonicalProofCarrierMask + canonicalFireContent);
  ember = ember * (canonicalProofCarrierMask + canonicalFireContent);
  flameDetail = flameDetail * (canonicalProofCarrierMask + canonicalFireContent);
  combustionFront = combustionFront * canonicalProofCarrierMask;
  combustionFrontTopology = combustionFrontTopology * canonicalProofCarrierMask;
  microSmoke = microSmoke * canonicalProofCarrierMask;
  interfaceShred = interfaceShred * canonicalProofCarrierMask;
  fireLick = fireLick * canonicalProofCarrierMask;
  emberFleck = emberFleck * canonicalProofCarrierMask;
  let density = clamp(max(smoke * 1.08 + microSmoke * 0.08, heat * 0.42 + materialDetail * 0.18 + interfaceShred * 0.20 + fireLick * 0.05 + fuel * 0.10), 0.0, 2.2);
  vel = vel * mix(0.55, 1.0, wallFade);
  vel.y = mix(max(vel.y, -0.015), vel.y, bonfireScene);
  fluidDst[base] = vec4<f32>(clamp(vel, vec3<f32>(-0.34), vec3<f32>(0.52)), density);
  fluidDst[base + 1u] = vec4<f32>(clamp(smoke, 0.0, 2.2), clamp(heat, 0.0, 2.4), clamp(fuel, 0.0, 1.8), clamp(materialDetail, 0.0, 1.8));
  fluidDst[base + 2u] = vec4<f32>(clamp(flame, 0.0, 2.4), clamp(ember, 0.0, 2.0), clamp(flameDetail, 0.0, 1.8), clamp(combustionFront, 0.0, 1.8));
  fluidDst[base + 3u] = vec4<f32>(clamp(microSmoke, 0.0, 1.8), clamp(interfaceShred, 0.0, 1.8), clamp(fireLick, 0.0, 1.8), clamp(emberFleck, 0.0, 1.4));
  frontDst[idx] = clamp(combustionFrontTopology, 0.0, 2.0);
}

struct RaymarchResult {
  color: vec4<f32>,
  residualFeature: vec4<f32>,
};

struct ResidualSourceOutput {
  @location(0) color: vec4<f32>,
  @location(1) residualFeature: vec4<f32>,
};

fn makeRaymarchResult(color: vec4<f32>, residualFeature: vec4<f32>) -> RaymarchResult {
  var result: RaymarchResult;
  result.color = color;
  result.residualFeature = residualFeature;
  return result;
}

fn raymarchVolume(in: VSOut) -> RaymarchResult {
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0);
  let nearClip = vec4<f32>(ndc, -1.0, 1.0);
  let farClip = vec4<f32>(ndc, 1.0, 1.0);
  let nearWorldRaw = u.invViewProj * nearClip;
  let farWorldRaw = u.invViewProj * farClip;
  let nearWorld = nearWorldRaw.xyz / nearWorldRaw.w;
  let farWorld = farWorldRaw.xyz / farWorldRaw.w;
  let ro = u.cameraPos_time.xyz;
  let rd = normalize(farWorld - nearWorld);
  let hit = boxHit(ro, rd, vec3<f32>(1.0, 1.0, 1.0));
  if (hit.y <= max(hit.x, 0.0)) {
    return makeRaymarchResult(vec4<f32>(0.004, 0.005, 0.006, 1.0), vec4<f32>(0.0));
  }

  let steps = clamp(u.viewport_steps_density.z, 24.0, 192.0);
  let fireScale = clamp(u.scale_controls.x, 0.35, 1.30);
  let detailScale = clamp(u.scale_controls.y, 0.45, 3.20);
  let plumeHeight = clamp(u.scale_controls.z, 0.70, 2.20);
  let renderSceneMode = clamp(u.scene_controls.x, 0.0, 3.0);
  let minimalPlumeRenderScene = step(2.5, renderSceneMode);
  let bonfireRenderScene = step(1.5, renderSceneMode) * (1.0 - minimalPlumeRenderScene);
  let tallPlumeRenderScene = step(0.5, renderSceneMode) * (1.0 - step(1.5, renderSceneMode));
  let detailScaleArtifactQuarantine = tallPlumeRenderScene;
  let visibleDetailOverlayGain = mix(1.0, 0.35, detailScaleArtifactQuarantine);
  let physicalDetailScale = mix(detailScale, 1.0, detailScaleArtifactQuarantine);
  let scaledDetailFrequency = clamp(physicalDetailScale / max(fireScale, 0.45), 0.55, 5.40);
  let tallPlumeRenderDetailFrequency = mix(scaledDetailFrequency, 1.0, tallPlumeRenderScene);
  let scaleDomain = vec3<f32>(tallPlumeRenderDetailFrequency, mix(1.0, 1.24, smoothstep(0.70, 2.20, plumeHeight)), tallPlumeRenderDetailFrequency);
  let canonicalRenderMode = clamp(u.canonical_render_motion_controls.x, 0.0, 1.0);
  let canonicalContentMode = clamp(u.canonical_render_motion_controls.z, 0.0, 2.0);
  let quenchVaporStrength = clamp(u.canonical_render_motion_controls.w, 0.0, 2.0);
  let pyroMaterialGain = clamp(u.pyro_detail_controls.x, 0.0, 1.5);
  let pyroMaterialEnergy = clamp(u.pyro_detail_controls.y, 0.0, 1.0);
  let pyroLiveAuthority = clamp(u.pyro_detail_controls.z, 0.0, 1.0);
  let pyroSmokeAuthority = clamp(u.pyro_detail_controls.w, 0.0, 1.0);
  let pyroInterfaceFocus = clamp(u.pyro_carrier_controls.x, 0.0, 1.0);
  let pyroEdgeBite = clamp(u.pyro_carrier_controls.y, 0.0, 1.0);
  let pyroSmokeFold = clamp(u.pyro_carrier_controls.z, 0.0, 1.0);
  let pyroDiagnosticPaint = clamp(u.pyro_carrier_controls.w, 0.0, 1.0);
  let pyroCarrierViewMode = clamp(u.pyro_diagnostic_controls.x, 0.0, 7.0);
  let pyroCarrierOverdrive = clamp(u.pyro_diagnostic_controls.y, 1.0, 8.0);
  let pyroBiteBorderFocus = clamp(u.pyro_diagnostic_controls.z, 0.0, 1.0);
  let pyroFoldBorderFocus = clamp(u.pyro_diagnostic_controls.w, 0.0, 1.0);
  let pyroBiteTeeth = clamp(u.pyro_shape_controls.x, 0.0, 1.0);
  let pyroBiteWake = clamp(u.pyro_shape_controls.y, 0.0, 1.0);
  let pyroFoldWake = clamp(u.pyro_shape_controls.z, 0.0, 1.0);
  let pyroFireMode = clamp(u.pyro_shape_controls.w, 0.0, 2.0);
  let pyroContrastRadiance = clamp(u.pyro_light_controls.x, 0.0, 10.0);
  let pyroRadianceGate = clamp(u.pyro_light_controls.y, 0.0, 1.0);
  let pyroRadianceSpill = clamp(u.pyro_light_controls.z, 0.0, 1.0);
  let pyroRadianceWarmth = clamp(u.pyro_light_controls.w, 0.0, 1.0);
  let pyroBiteHeat = clamp(u.pyro_color_controls.x, 0.0, 1.0);
  let pyroBiteChroma = clamp(u.pyro_color_controls.y, 0.0, 1.0);
  let pyroRadianceHue = clamp(u.pyro_color_controls.z, 0.0, 1.0);
  let pyroRadianceChroma = clamp(u.pyro_color_controls.w, 0.0, 1.0);
  let pyroBiteHeight = clamp(u.pyro_route_controls.x, 0.0, 1.0);
  let pyroBiteFireLock = clamp(u.pyro_route_controls.y, 0.0, 1.0);
  let pyroWakeLift = clamp(u.pyro_route_controls.z, 0.0, 1.0);
  let pyroWakeWarmth = clamp(u.pyro_route_controls.w, 0.0, 1.0);
  let pyroRadianceSource = clamp(u.pyro_radiance_route_controls.x, 0.0, 2.0);
  let pyroRadianceHeight = clamp(u.pyro_radiance_route_controls.y, 0.0, 1.0);
  let pyroRadianceBorder = clamp(u.pyro_radiance_route_controls.z, 0.0, 1.0);
  let pyroRadianceTeeth = clamp(u.pyro_radiance_route_controls.w, 0.0, 1.0);
  let pyroFlamePaint = clamp(u.pyro_luma_controls.x, 0.0, 3.0);
  let pyroFlameLuma = clamp(u.pyro_luma_controls.y, 0.0, 3.0);
  let pyroStockMix = clamp(u.pyro_luma_controls.z, 0.0, 1.0);
  let pyroBiteLuma = clamp(u.pyro_luma_controls.w, 0.0, 3.0);
  let pyroWakeLuma = clamp(u.pyro_luma_controls2.x, 0.0, 3.0);
  let pyroRadianceLuma = clamp(u.pyro_luma_controls2.y, 0.0, 3.0);
  let pyroRadianceRise = clamp(u.pyro_luma_controls2.z, 0.0, 1.0);
  let pyroRadianceFireLock = clamp(u.pyro_luma_controls2.w, 0.0, 1.0);
  let pyroBiteCore = clamp(u.pyro_bite_stack_controls.x, 0.0, 1.0);
  let pyroBiteCoreCut = clamp(u.pyro_bite_stack_controls.y, 0.0, 1.0);
  let pyroBiteRim = clamp(u.pyro_bite_stack_controls.z, 0.0, 1.0);
  let pyroBiteRimCut = clamp(u.pyro_bite_stack_controls.w, 0.0, 1.0);
  let pyroBiteAfter = clamp(u.pyro_bite_stack_controls2.x, 0.0, 1.0);
  let pyroBiteAfterCut = clamp(u.pyro_bite_stack_controls2.y, 0.0, 1.0);
  let pyroFlowBite = clamp(u.pyro_flow_controls.x, 0.0, 3.0);
  let pyroFlowBorder = clamp(u.pyro_flow_controls.y, 0.0, 1.0);
  let pyroFlowTeeth = clamp(u.pyro_flow_controls.z, 0.0, 1.0);
  let pyroFlowRise = clamp(u.pyro_flow_controls.w, 0.0, 1.0);
  let pyroFlowFireLock = clamp(u.pyro_flow_controls2.x, 0.0, 1.0);
  let pyroFlowLuma = clamp(u.pyro_flow_controls2.y, 0.0, 3.0);
  let pyroFlowRadiance = clamp(u.pyro_flow_controls2.z, 0.0, 4.0);
  let pyroFlowSpikes = clamp(u.pyro_flow_controls2.w, 0.0, 1.0);
  let pyroFlameCoreColor = u.pyro_palette_flame.rgb;
  let pyroFlameEdgeColor = u.pyro_palette_flame_edge.rgb;
  let pyroBiteEmberEndpoint = u.pyro_palette_bite.rgb;
  let pyroBiteHotEndpoint = u.pyro_palette_bite_hot.rgb;
  let pyroWakeShadowEndpoint = u.pyro_palette_wake.rgb;
  let pyroWakeEmberEndpoint = u.pyro_palette_wake_ember.rgb;
  let pyroRadianceCoolEndpoint = u.pyro_palette_radiance.rgb;
  let pyroRadianceWarmEndpoint = u.pyro_palette_radiance_warm.rgb;
  let pyroFlowCoolEndpoint = u.pyro_palette_flow.rgb;
  let pyroFlowHotEndpoint = u.pyro_palette_flow_hot.rgb;
  let fireRenderMode = clamp(u.topology_shell_controls.x, 0.0, 3.0);
  let shellInspectMode = clamp(u.topology_shell_controls.y, 0.0, 9.0);
  let shellAmount = clamp(u.topology_shell_controls.z, 0.0, 2.0);
  let shellWidth = clamp(u.topology_shell_controls.w, 0.05, 2.0);
  let shellThermalGain = clamp(u.topology_shell_carriers.x, 0.0, 2.0);
  let shellReactionGain = clamp(u.topology_shell_carriers.y, 0.0, 2.0);
  let shellFrontGain = clamp(u.topology_shell_carriers.z, 0.0, 2.0);
  let shellEdgeGain = clamp(u.topology_shell_carriers.w, 0.0, 2.0);
  let shellCoreSuppress = clamp(u.topology_shell_shape.x, 0.0, 1.0);
  let shellBiteGain = clamp(u.topology_shell_shape.y, 0.0, 2.0);
  let shellCurlGain = clamp(u.topology_shell_shape.z, 0.0, 2.0);
  let shellDivergenceGain = clamp(u.topology_shell_shape.w, 0.0, 1.0);
  let shellSmokeCoupling = clamp(u.topology_shell_transport.x, 0.0, 2.0);
  let boundaryGradientGain = clamp(u.topology_shell_transport.x, 0.0, 4.0);
  let boundaryCut = clamp(u.topology_shell_transport.y, 0.0, 0.55);
  let boundarySoftness = clamp(u.topology_shell_transport.z, 0.005, 0.45);
  let boundaryOpacity = clamp(u.topology_shell_transport.w, 0.0, 3.0);
  let shellLuma = clamp(u.topology_shell_light.x, 0.0, 5.0);
  let shellExposure = clamp(u.topology_shell_light.y, 0.0, 4.0);
  let shellSoftClip = clamp(u.topology_shell_light.z, 0.2, 4.0);
  let shellHeatGain = clamp(u.topology_shell_light.w, 0.0, 4.0);
  let boundaryContrast = clamp(u.topology_shell_light.x, 0.25, 5.0);
  let boundaryGamma = clamp(u.topology_shell_light.y, 0.35, 3.0);
  let boundaryFireRidgeGain = clamp(u.boundary_fire_structure.x, 0.0, 2.0);
  let boundaryFireRidgeCut = clamp(u.boundary_fire_structure.y, 0.0, 0.55);
  let boundaryFireTipBreakup = clamp(u.boundary_fire_structure.z, 0.0, 2.0);
  let boundaryFireTopologyErosion = clamp(u.boundary_fire_structure.w, 0.0, 1.0);
  let boundaryFireCleanBlue = clamp(u.boundary_fire_color.x, 0.0, 2.0);
  let boundaryFireSootYield = clamp(u.boundary_fire_color.y, 0.0, 2.0);
  let boundaryFireSootYellowing = clamp(u.boundary_fire_color.z, 0.0, 2.0);
  let boundaryFireThermalWarmth = clamp(u.boundary_fire_color.w, 0.0, 2.0);
  let boundaryFireLuma = clamp(u.boundary_fire_display.x, 0.0, 5.0);
  let selectiveRaymarchSmokeOnlyPartition = clamp(u.selective_live_render_controls.x, 0.0, 1.0);
  let selectiveRaymarchFireAuthority = 1.0 - selectiveRaymarchSmokeOnlyPartition;
  let canonicalSmokeContent = 1.0 - minimalPlumeRenderScene * step(0.5, canonicalContentMode) * (1.0 - step(1.5, canonicalContentMode));
  let canonicalFireContent = minimalPlumeRenderScene * step(0.5, canonicalContentMode);
  let canonicalFireRenderContent = mix(1.0, canonicalFireContent, minimalPlumeRenderScene);
  let canonicalSmokeOnlyRender = minimalPlumeRenderScene * step(0.5, canonicalRenderMode);
  let startT = max(hit.x, 0.0);
  let endT = hit.y;
  let dtBase = (endT - startT) / steps;
  let jitter = temporalJitterOffset(in.uv, dtBase);
  let bonfireSpatialRayDephase = (hash31(vec3<f32>(floor(in.uv * u.viewport_steps_density.xy), 37.0)) - 0.5) * dtBase * 0.90 * bonfireRenderScene;
  var t = startT + jitter + bonfireSpatialRayDephase;
  var trans = 1.0;
  var color = vec3<f32>(0.004, 0.005, 0.006);
  var residualRadianceAuthority = 0.0;
  var residualFireAuthority = 0.0;
  var residualInterfaceAuthority = 0.0;
  var residualSmokeAuthority = 0.0;
  let entryP = ro + rd * startT;
  let exitP = ro + rd * endT;
  var gridAccum = max(gridLine(entryP), gridLine(exitP));
  var temporalMaterialWeight = 0.0;
  var temporalWorldSum = vec3<f32>(0.0);
  var temporalVelocitySum = vec3<f32>(0.0);
  var temporalReactiveSignal = 0.0;
  var temporalMajorantEdge = 0.0;
  var temporalSmokeHistoryTrustSum = 0.0;
  var temporalFireHistoryProtectSum = 0.0;
  var temporalInterfaceHistoryProtectSum = 0.0;
  var temporalDetailHistoryProtectSum = 0.0;

  for (var i = 0; i < 192; i = i + 1) {
    if (f32(i) >= steps || raymarchEarlyTermination(trans) || t > endT) { break; }
    let p = ro + rd * t;
    let majorantNearest = sampleWorldMajorant(p);
    let majorantLinear = sampleWorldMajorantLinear(p);
    let majorantDilated = sampleWorldMajorantDilated(p);
    let majorantSkipStrength = clamp(u.occupancy_controls.y, 0.0, 1.0);
    let majorantSmooth = clamp(u.occupancy_controls.z, 0.0, 1.0);
    let majorantEdgeGuard = clamp(u.occupancy_controls.w, 0.0, 1.0);
    let majorant = mix(majorantNearest, mix(majorantLinear, majorantDilated, 0.28 + majorantEdgeGuard * 0.42), majorantSmooth);
    let majorantEdge = majorantGradientSignal(p);
    let guardedImportance = max(majorant.w, majorantDilated.w * majorantEdgeGuard * (0.55 + majorantSmooth * 0.25));
    let guardedThreshold = mix(0.050, 0.100, majorantEdgeGuard);
    let majorantEmpty = 1.0 - smoothstep(0.004, guardedThreshold, guardedImportance + majorantEdge * majorantEdgeGuard * 0.24);
    let edgeDamping = 1.0 - smoothstep(0.012, 0.16, majorantEdge * majorantEdgeGuard);
    let majorantSkipGate = majorantEmpty * majorantSkipStrength * edgeDamping;
    temporalMajorantEdge = max(temporalMajorantEdge, majorantEdge * (0.18 + majorantSkipGate));
    if (majorantSkipGate > 0.42) {
      let cellExit = majorantCellExitDistance(p, rd);
      let skipDt = min(cellExit + dtBase * 0.20, dtBase * (1.0 + majorantSkipGate * 6.0));
      t = t + min(skipDt, max(0.0001, endT - t));
      continue;
    }
    let state = sampleWorldVelocity(p);
    let material = sampleWorldMaterial(p);
    let fireLayer = sampleWorldFireLayer(p);
    let microLayer = sampleWorldMicrodetail(p);
    let combustionFrontTopology = sampleWorldFrontField(p);
    let velMag = length(state.xyz);
    let smokeDensity = material.x;
    let heat = material.y;
    let fuel = material.z;
    let materialDetail = material.w;
    let flame = fireLayer.x;
    let ember = fireLayer.y;
    let flameDetail = fireLayer.z;
    let combustionFront = fireLayer.w;
    let microSmoke = microLayer.x;
    let interfaceShred = microLayer.y;
    let fireLick = microLayer.z;
    let emberFleck = microLayer.w;
    let flowDebug = clamp(u.source_controls.w, 0.0, 1.0);
    let radianceGain = max(0.0, u.radiance_controls.x);
    let absorptionGain = max(0.0, u.radiance_controls.y);
    let glowGain = max(0.0, u.radiance_controls.z);
    let adaptiveRays = clamp(u.radiance_controls.w, 0.0, 1.0);
    let occupancySkipStrength = clamp(u.occupancy_controls.x, 0.0, 1.0);
    let sampleCell = vec3<i32>(floor(clamp((p * 0.5 + vec3<f32>(0.5)) * f32(GRID), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.0))));
    let curlDebug = curlMagnitudeAtCell(sampleCell);
    let divDebug = abs(divergenceAtCell(sampleCell));
    let microTextureSignal = clamp(microSmoke * 1.55 + interfaceShred * 2.45 + fireLick * 1.30 + emberFleck * 0.55, 0.0, 2.4);
    let microBodyContribution = microSmoke * 0.10 + interfaceShred * 0.18 + fireLick * 0.06;
    let canonicalDebugSmokeDensity = smokeDensity * canonicalSmokeContent * u.viewport_steps_density.w;
    let density = mix(
      (smokeDensity * 0.84 + heat * 0.28 + materialDetail * 0.14 + microBodyContribution) * u.viewport_steps_density.w,
      canonicalDebugSmokeDensity,
      canonicalSmokeOnlyRender
    );
    let y = clamp((p.y + 1.0) * 0.5, 0.0, 1.0);
    let fireGain = 0.42 + u.fire_smoke_curl_speed.x * 1.15;
    let rawTemp = emissiveTemperature(fireLayer, material, microLayer, velMag);
    let bonfireEmissionTemperature = clamp(
      flameDetail * 1.34
        + fireLick * 1.08
        + ember * 0.42
        + emberFleck * 0.40
        + combustionFront * 0.18
        + combustionFrontTopology * 0.06
        + heat * 0.14
        + velMag * 0.22,
      0.0,
      2.4
    );
    let temp = mix(mix(rawTemp, bonfireEmissionTemperature, bonfireRenderScene) * fireGain, 0.0, canonicalSmokeOnlyRender);
    let smoke = mix(
      (smokeDensity + microBodyContribution * 0.70) * smoothstep(0.03, 0.92, y) * u.fire_smoke_curl_speed.y,
      smokeDensity * canonicalSmokeContent * u.fire_smoke_curl_speed.y,
      canonicalSmokeOnlyRender
    );
    let rawExtinction = smokeRadianceExtinction(smokeDensity, microSmoke, interfaceShred, materialDetail, absorptionGain);
    let tallPlumeRenderTransitionContour = clamp(0.70 + microTextureSignal * 0.12 + velMag * 0.18 + materialDetail * 0.06, 0.44, 1.20);
    let tallPlumeRenderTransitionStagger = tallPlumeTransitionBandStagger(tallPlumeRenderTransitionContour, materialDetail, microSmoke, interfaceShred, flameDetail, combustionFrontTopology);
    let tallPlumeRenderTransitionBand = tallPlumeRenderScene
      * smoothstep(0.28, 0.82, y)
      * smoothstep(0.006, 0.18, flame + flameDetail + heat * 0.10)
      * smoothstep(0.004, 0.24, smoke + rawExtinction + microSmoke * 0.32);
    let tallPlumeTransitionWisps = tallPlumeRenderTransitionBand
      * smoothstep(0.54, 1.18, tallPlumeRenderTransitionStagger)
      * (0.020 + flameDetail * 0.035 + interfaceShred * 0.025 + microSmoke * 0.016);
    let extinction = rawExtinction + tallPlumeTransitionWisps * absorptionGain * 0.34;
    let occupancy = raymarchOccupancySignal(density, smoke, heat, temp, flame, microTextureSignal, velMag, extinction) + tallPlumeTransitionWisps;
    let emptySpanScale = occupancySkipStepScale(occupancy, occupancySkipStrength, adaptiveRays);
    if (emptySpanScale > 1.08) {
      t = t + min(dtBase * emptySpanScale, max(0.0001, endT - t));
      continue;
    }
    let detailP = p * scaleDomain;
    let microWarp = microDetailDomainWarp(detailP, microLayer, fireLayer, material, state.xyz, u.cameraPos_time.w, tallPlumeRenderScene);
    let detailCarrier = clamp(microTextureSignal + materialDetail * 0.22 + flameDetail * 0.18 + velMag * 0.36, 0.0, 2.8);
    let filamentNoise = microFilamentNoise(detailP, microWarp, detailCarrier, state.xyz, u.cameraPos_time.w);
    let shredNoise = microFilamentNoise(detailP.zxy + vec3<f32>(0.13, -0.21, 0.09), microWarp.yzx * 1.21, detailCarrier + interfaceShred * 1.7, state.zxy, u.cameraPos_time.w * 1.17 + 1.3);
    let fireNoise = microFilamentNoise(detailP.yzx + vec3<f32>(-0.18, 0.07, 0.24), microWarp.zxy * 1.38, detailCarrier + fireLick * 2.1, state.yzx, u.cameraPos_time.w * 1.31 + 2.1);
    let interest = raymarchInterest(density, smoke, heat, temp, max(flame, combustionFrontTopology * 0.10), flameDetail, microTextureSignal, velMag, fireLick, interfaceShred);
    let localDt = min(dtBase * adaptiveRayStepScale(interest, adaptiveRays), max(0.0001, endT - t));
    let rayStepOpacity = localDt * 3.65;
    let curtainNoise = microFilamentNoise(
      detailP.xzy + vec3<f32>(0.31, -0.17, 0.23),
      microWarp.zxy + state.yzx * 0.38,
      detailCarrier + smoke * 0.12,
      state.yzx,
      u.cameraPos_time.w * 0.73 + 2.9
    );
    let verticalPhaseBreak = sin(p.y * 43.0 + (p.x * p.x - p.z * p.z) * 19.0 + u.cameraPos_time.w * 1.4);
    let verticalPuffBreak = cos(p.y * 27.0 + length(p.xz) * 23.0 - p.x * p.z * 31.0 - u.cameraPos_time.w * 0.92);
    let bonfireCurtainBreakup = mix(
      1.0,
      clamp(0.91 + curtainNoise * 0.10 + verticalPhaseBreak * 0.15 + verticalPuffBreak * 0.17, 0.64, 1.18),
      bonfireRenderScene * smoothstep(0.05, 0.62, smoke)
    );
    let bonfireFireRenderBreakup = mix(
      1.0,
      clamp(0.78 + fireNoise * 0.22 + verticalPuffBreak * 0.14 + fireLick * 0.20 + flameDetail * 0.16 + interfaceShred * 0.10, 0.58, 1.32),
      bonfireRenderScene * smoothstep(0.035, 0.92, flame + flameDetail + fireLick)
    );
    let bonfireTransportedFireLumaShaper = mix(
      1.0,
      clamp(0.52 + bonfireFireRenderBreakup * 0.26 + flameDetail * 0.11 + fireLick * 0.09 + emberFleck * 0.06, 0.44, 1.04),
      bonfireRenderScene * smoothstep(0.030, 0.84, flame + flameDetail + fireLick)
    );
    var smokeAlpha = mix(
      clamp((density * 1.08 + smoke * 0.40 + heat * 0.13 + materialDetail * 0.28 + microBodyContribution * 0.54) * rayStepOpacity * (0.86 + absorptionGain * 0.12) * bonfireCurtainBreakup, 0.0, 0.16),
      clamp(canonicalDebugSmokeDensity * rayStepOpacity * (0.86 + absorptionGain * 0.12), 0.0, 0.16),
      canonicalSmokeOnlyRender
    );
    let fireAlphaMax = mix(0.20, 0.145, bonfireRenderScene);
    let bonfireRenderedFireEdgeCarrier = fireLick * 1.18
      + emberFleck * 0.50
      + combustionFront * 0.14
      + combustionFrontTopology * 0.08
      + interfaceShred * 0.08;
    let bonfireVisibleEmission = bonfireRenderedFireEdgeCarrier + flameDetail * 1.44 + ember * 0.48 + flame * 0.16;
    let visibleFlameAlphaCarrier = mix(
      flame * 2.15 + ember * 0.86 + flameDetail * 0.82 + fireLick * 2.60 + emberFleck * 0.76 + interfaceShred * 0.26,
      bonfireVisibleEmission + interfaceShred * 0.16,
      bonfireRenderScene
    );
    let tallPlumeTransitionAlphaStagger = mix(
      1.0,
      clamp(0.70 + tallPlumeRenderTransitionStagger * 0.36, 0.58, 1.18),
      tallPlumeRenderTransitionBand
    );
    let vaporCarrier = clamp(
      quenchVaporStrength
        * smoothstep(0.003, 0.24, flame + flameDetail * 0.74 + fireLick * 0.45 + heat * 0.55 + smokeDensity * 0.24 + microSmoke * 0.18)
        * smoothstep(0.02, 0.70, y)
        * (0.84 + curtainNoise * 0.22 + verticalPuffBreak * 0.16),
      0.0,
      1.85
    );
    let quenchCoreHeatSignal = clamp(
      temp * 0.82
        + flame * 0.64
        + flameDetail * 0.92
        + fireLick * 0.24
        + ember * 0.34
        + heat * 0.16,
      0.0,
      2.8
    );
    let quenchCoreCollapse = clamp(
      quenchVaporStrength
        * smoothstep(0.10, 1.08, quenchCoreHeatSignal)
        * smoothstep(0.0, 0.22, y)
        * clamp(0.88 + fireNoise * 0.10 + verticalPuffBreak * 0.08, 0.68, 1.18),
      0.0,
      1.0
    );
    let flameBodyAuthority = 1.0 - quenchCoreCollapse * 0.90;
    let renderTemp = temp * mix(1.0, 0.10 + 0.22 * smoothstep(0.0, 0.45, ember + emberFleck), quenchCoreCollapse);
    let quenchedFlameDetail = flameDetail * (1.0 - quenchCoreCollapse * 0.66);
    let quenchedFireLick = fireLick * (1.0 - quenchCoreCollapse * 0.54);
    let quenchedEmberFleck = emberFleck * (1.0 - quenchCoreCollapse * 0.32);
    let vaporAlpha = clamp((vaporCarrier + quenchCoreCollapse * 0.52) * rayStepOpacity * (0.22 + absorptionGain * 0.070), 0.0, 0.22);
    smokeAlpha = clamp(smokeAlpha + vaporAlpha, 0.0, 0.28);
    let fireSnuffDamping = 1.0 - clamp(max(vaporCarrier * 1.18, quenchCoreCollapse * 0.92), 0.0, 0.985);
    let stockFireAlpha = mix(
      clamp(visibleFlameAlphaCarrier * tallPlumeTransitionAlphaStagger * canonicalFireRenderContent * rayStepOpacity * fireGain * (0.58 + radianceGain * 0.18) * bonfireFireRenderBreakup * bonfireTransportedFireLumaShaper * fireSnuffDamping * flameBodyAuthority, 0.0, fireAlphaMax),
      0.0,
      canonicalSmokeOnlyRender
    );
    let stockRenderMode = 1.0 - step(0.5, abs(fireRenderMode - 3.0));
    let shellRenderMode = 1.0 - step(0.5, abs(fireRenderMode - 1.0));
    let inspectRenderMode = 1.0 - step(0.5, abs(fireRenderMode - 2.0));
    let fireVisualAuthority = shellAmount * canonicalFireRenderContent * flameBodyAuthority;
    let curlActivity = smoothstep(0.006, 0.16, curlDebug);
    let thermalSupport = smoothstep(0.018, 0.62, rawTemp + renderTemp * 0.20 + heat * 0.20 + ember * 0.12);
    let reactionSupport = smoothstep(0.004, 0.30, flameDetail * 0.72 + quenchedFireLick * 0.44 + combustionFront * 0.34 + fuel * heat * 0.28);
    let frontSupport = smoothstep(0.001, 0.088, combustionFrontTopology * 1.08 + combustionFront * 0.54 + quenchedFireLick * 0.12);
    let edgeSupport = smoothstep(0.004, 0.24, interfaceShred * 0.58 + microSmoke * 0.18 + rawExtinction * 0.08 + curlDebug * 0.42);
    let curlSupport = curlActivity * smoothstep(0.010, 0.52, rawTemp + heat * 0.16 + flameDetail * 0.28 + combustionFront * 0.16);
    let divSupport = smoothstep(0.010, 0.18, divDebug)
      * smoothstep(0.010, 0.46, rawTemp + heat * 0.18 + flameDetail * 0.32);
    let shellCarrierRaw = shellThermalGain * thermalSupport
      + shellReactionGain * reactionSupport
      + shellFrontGain * frontSupport
      + shellEdgeGain * edgeSupport
      + shellCurlGain * curlSupport
      + shellDivergenceGain * divSupport;
    let shellCarrier = clamp(1.0 - exp(-max(0.0, shellCarrierRaw) * (0.52 + shellWidth * 0.62)), 0.0, 1.65);
    let shellCoreBody = smoothstep(
      0.26,
      1.18,
      rawTemp * 0.36 + renderTemp * 0.18 + flameDetail * 0.44 + heat * 0.12 + ember * 0.12
    ) * (1.0 - clamp(frontSupport * 0.54 + edgeSupport * 0.30 + curlActivity * 0.12, 0.0, 0.86));
    let shellMask = clamp(shellCarrier * mix(1.0, 1.0 - shellCoreBody * 0.82, shellCoreSuppress), 0.0, 1.35);
    let shellWrinkle = clamp(1.0 + shellBiteGain * (frontSupport * 0.26 + edgeSupport * 0.24 + curlActivity * 0.20), 0.0, 2.4);
    let shellAlpha = clamp(
      shellMask
        * fireVisualAuthority
        * rayStepOpacity
        * (0.050 + shellWidth * 0.070)
        * shellWrinkle
        * fireSnuffDamping,
      0.0,
      fireAlphaMax
    );
    let inspectShellMask = 1.0 - step(0.5, abs(shellInspectMode - 0.0));
    let inspectThermalMask = 1.0 - step(0.5, abs(shellInspectMode - 1.0));
    let inspectReactionMask = 1.0 - step(0.5, abs(shellInspectMode - 2.0));
    let inspectFrontMask = 1.0 - step(0.5, abs(shellInspectMode - 3.0));
    let inspectEdgeMask = 1.0 - step(0.5, abs(shellInspectMode - 4.0));
    let inspectCoreMask = 1.0 - step(0.5, abs(shellInspectMode - 5.0));
    let inspectCurlMask = 1.0 - step(0.5, abs(shellInspectMode - 6.0));
    let inspectDivMask = 1.0 - step(0.5, abs(shellInspectMode - 7.0));
    let inspectBoundaryMask = 1.0 - step(0.5, abs(shellInspectMode - 8.0));
    let inspectBoundaryFireMask = 1.0 - step(0.5, abs(shellInspectMode - 9.0));
    let boundarySurfaceMode = clamp(inspectBoundaryMask + inspectBoundaryFireMask, 0.0, 1.0);
    var boundaryCandidate = 0.0;
    var boundaryFireColor = vec3<f32>(0.0);
    if (boundarySurfaceMode > 0.5) {
      let boundarySupportWeights = vec4<f32>(shellThermalGain, shellReactionGain, shellFrontGain, shellEdgeGain);
      let boundaryCellStep = 2.0 / f32(GRID);
      let boundaryDx = vec3<f32>(boundaryCellStep, 0.0, 0.0);
      let boundaryDy = vec3<f32>(0.0, boundaryCellStep, 0.0);
      let boundaryDz = vec3<f32>(0.0, 0.0, boundaryCellStep);
      let boundarySidecarSource = clamp(u.boundary_sidecar_controls.x, 0.0, 2.0);
      let boundarySidecarView = clamp(u.boundary_sidecar_display.x, 0.0, 5.0);
      var boundarySidecarDebugSample = vec4<f32>(0.0);
      if (boundarySidecarView > 0.5) {
        boundarySidecarDebugSample = sampleWorldBoundarySidecar(p);
      }
      var boundarySupportEffective = 0.0;
      var boundaryGradientEffective = 0.0;
      var boundaryFireRidgeEffective = 0.0;
      var boundarySidecarStepFootprintWidth = 0.0;
      if (boundarySidecarSource > 0.5 && boundarySidecarSource <= 1.5) {
        let boundarySidecarSample = sampleWorldBoundarySidecar(p);
        boundarySidecarDebugSample = boundarySidecarSample;
        let boundarySidecarCoverage = boundarySidecarSample.y;
        let boundarySidecarProximity = clamp(max(boundarySidecarSample.x, max(boundarySidecarCoverage * 0.74, boundarySidecarSample.z * 0.58)), 0.0, 1.8);
        let boundarySidecarFootprintWidth = boundarySidecarSample.w;
        boundarySupportEffective = max(boundarySidecarSample.x, boundarySidecarProximity * 0.36);
        boundaryGradientEffective = max(boundarySidecarCoverage, boundarySidecarSample.z * 0.55) * (1.0 + boundarySidecarFootprintWidth * 0.18);
        boundaryFireRidgeEffective = boundarySidecarSample.z;
        boundarySidecarStepFootprintWidth = clamp(u.boundary_sidecar_controls.z, 0.0, 2.0) * max(dtBase * f32(GRID) * 0.046, boundarySidecarFootprintWidth * 0.036);
      } else {
        let boundarySupport = liveBoundarySupportAt(p, boundarySupportWeights);
        let boundarySupportPx = liveBoundarySupportAt(p + boundaryDx, boundarySupportWeights);
        let boundarySupportNx = liveBoundarySupportAt(p - boundaryDx, boundarySupportWeights);
        let boundarySupportPy = liveBoundarySupportAt(p + boundaryDy, boundarySupportWeights);
        let boundarySupportNy = liveBoundarySupportAt(p - boundaryDy, boundarySupportWeights);
        let boundarySupportPz = liveBoundarySupportAt(p + boundaryDz, boundarySupportWeights);
        let boundarySupportNz = liveBoundarySupportAt(p - boundaryDz, boundarySupportWeights);
        let boundaryGradient = length(vec3<f32>(
          boundarySupportPx - boundarySupportNx,
          boundarySupportPy - boundarySupportNy,
          boundarySupportPz - boundarySupportNz
        )) * (0.5 / boundaryCellStep);
        let boundaryLaplacian = abs(boundarySupportPx + boundarySupportNx + boundarySupportPy + boundarySupportNy + boundarySupportPz + boundarySupportNz - 6.0 * boundarySupport);
        let boundaryFireRidge = smoothstep(boundaryFireRidgeCut, boundaryFireRidgeCut + 0.14, boundaryLaplacian * boundaryFireRidgeGain);
        boundarySupportEffective = boundarySupport;
        boundaryGradientEffective = boundaryGradient;
        boundaryFireRidgeEffective = boundaryFireRidge;
        if (boundarySidecarSource > 1.5) {
          let boundarySidecarSample = sampleWorldBoundarySidecar(p);
          boundarySidecarDebugSample = boundarySidecarSample;
          let boundarySidecarCoverage = boundarySidecarSample.y;
          let boundarySidecarProximity = clamp(max(boundarySidecarSample.x, max(boundarySidecarCoverage * 0.74, boundarySidecarSample.z * 0.58)), 0.0, 1.8);
          let boundarySidecarFootprintWidth = boundarySidecarSample.w;
          boundarySupportEffective = mix(boundarySupport, boundarySidecarSample.x, 0.5);
          boundaryGradientEffective = mix(boundaryGradient, max(boundarySidecarCoverage, boundarySidecarProximity * 0.50), 0.5);
          boundaryFireRidgeEffective = mix(boundaryFireRidge, boundarySidecarSample.z, 0.5);
          boundarySidecarStepFootprintWidth = 0.5 * clamp(u.boundary_sidecar_controls.z, 0.0, 2.0) * max(dtBase * f32(GRID) * 0.046, boundarySidecarFootprintWidth * 0.036);
        }
      }
      let boundaryGradientGate = smoothstep(boundaryCut, boundaryCut + boundarySoftness + boundarySidecarStepFootprintWidth, boundaryGradientEffective * boundaryGradientGain);
      let boundaryCoreGate = clamp(mix(1.0, 1.0 - shellCoreBody, shellCoreSuppress), 0.0, 1.0);
      let supportThinning = boundaryGradientGate * (1.0 - smoothstep(0.62, 1.12, boundarySupportEffective));
      let upwardTransport = smoothstep(0.006, 0.085, max(0.0, state.y) + velMag * 0.12);
      let sootSupport = smoothstep(0.012, 0.42, smoke + microSmoke * 0.50 + rawExtinction * 0.32 + materialDetail * 0.16);
      let fuelDepletionProxy = smoothstep(0.020, 0.52, heat + flameDetail * 0.46 + combustionFront * 0.28) * (1.0 - smoothstep(0.018, 0.18, fuel));
      let boundaryFireTipGate = clamp(supportThinning * (0.35 + boundaryFireRidgeEffective * 0.65) * (0.30 + upwardTransport * 0.70) * (0.45 + fuelDepletionProxy * 0.55), 0.0, 1.0);
      let boundaryTopology = clamp(
        1.0
          + shellBiteGain * (edgeSupport * 0.50 + frontSupport * 0.24)
          + shellCurlGain * curlActivity
          + shellDivergenceGain * divSupport,
        0.0,
        3.5
      );
      let boundaryFireErosion = clamp(boundaryFireTopologyErosion * (curlActivity * 0.36 + edgeSupport * 0.34 + divSupport * 0.18 + boundaryFireTipGate * 0.48), 0.0, 0.92);
      let boundaryRaw = clamp(boundarySupportEffective * boundaryGradientGate * boundaryCoreGate * boundaryTopology, 0.0, 2.0);
      let boundaryScalar = clamp(pow(clamp(boundaryRaw * boundaryContrast, 0.0, 1.8), boundaryGamma) * boundaryOpacity, 0.0, 1.65);
      boundaryCandidate = mix(boundaryScalar, boundaryScalar * mix(1.0, clamp(boundaryFireRidgeEffective + boundaryFireTipGate * boundaryFireTipBreakup, 0.0, 1.0), 0.62) * (1.0 - boundaryFireErosion), inspectBoundaryFireMask);
      let cleanBurnGate = smoothstep(0.006, 0.34, reactionSupport + frontSupport * 0.38) * (1.0 - smoothstep(0.20, 0.86, sootSupport * boundaryFireSootYield));
      let sootMaturity = clamp((sootSupport * 0.56 + fuelDepletionProxy * 0.30 + boundaryFireTipGate * 0.30) * boundaryFireSootYield, 0.0, 1.0);
      let cleanFuelColor = vec3<f32>(0.12, 0.42, 1.75) * boundaryFireCleanBlue * cleanBurnGate;
      let sootThermalBase = fireColor((rawTemp + heat * 0.28 + flameDetail * 0.42 + frontSupport * 0.28) * max(0.18, boundaryFireThermalWarmth));
      let sootThermalColor = mix(sootThermalBase, vec3<f32>(1.55, 0.86, 0.18), clamp(sootMaturity * boundaryFireSootYellowing, 0.0, 1.0));
      boundaryFireColor = mix(cleanFuelColor, sootThermalColor, sootMaturity) * boundaryFireLuma;
      if (boundarySidecarView > 0.5) {
        let boundarySidecarCoverage = boundarySidecarDebugSample.y;
        let boundarySidecarProximity = clamp(max(boundarySidecarDebugSample.x, max(boundarySidecarCoverage * 0.74, boundarySidecarDebugSample.z * 0.58)), 0.0, 1.8);
        let boundarySidecarFootprintWidth = boundarySidecarDebugSample.w;
        var boundarySidecarDebugSignal = boundarySidecarDebugSample.x;
        var boundarySidecarDebugColor = vec3<f32>(0.30, 0.62, 1.55);
        if (boundarySidecarView > 1.5 && boundarySidecarView <= 2.5) {
          boundarySidecarDebugSignal = boundarySidecarCoverage;
          boundarySidecarDebugColor = vec3<f32>(0.22, 1.20, 0.55);
        } else if (boundarySidecarView > 2.5 && boundarySidecarView <= 3.5) {
          boundarySidecarDebugSignal = boundarySidecarDebugSample.z;
          boundarySidecarDebugColor = vec3<f32>(1.65, 0.92, 0.22);
        } else if (boundarySidecarView > 3.5 && boundarySidecarView <= 4.5) {
          boundarySidecarDebugSignal = boundarySidecarProximity;
          boundarySidecarDebugColor = vec3<f32>(0.28, 1.10, 1.42);
        } else if (boundarySidecarView > 4.5) {
          boundarySidecarDebugSignal = boundarySidecarFootprintWidth;
          boundarySidecarDebugColor = vec3<f32>(1.36, 0.42, 1.44);
        }
        boundaryCandidate = clamp(pow(clamp(boundarySidecarDebugSignal * boundaryContrast, 0.0, 1.8), boundaryGamma) * boundaryOpacity, 0.0, 1.65);
        boundaryFireColor = boundarySidecarDebugColor * (0.18 + boundaryCandidate * 1.08);
      }
    }
    let inspectSignal =
      shellMask * inspectShellMask
      + thermalSupport * inspectThermalMask
      + reactionSupport * inspectReactionMask
      + frontSupport * inspectFrontMask
      + edgeSupport * inspectEdgeMask
      + shellCoreBody * inspectCoreMask
      + curlSupport * inspectCurlMask
      + divSupport * inspectDivMask
      + boundaryCandidate * inspectBoundaryMask
      + boundaryCandidate * inspectBoundaryFireMask;
    let inspectAlpha = clamp(inspectSignal * rayStepOpacity * 0.55, 0.0, 0.28);
    var fireAlpha = stockRenderMode * stockFireAlpha + shellRenderMode * shellAlpha + inspectRenderMode * inspectAlpha;
    fireAlpha = fireAlpha * selectiveRaymarchFireAuthority;
    var alpha = clamp(smokeAlpha + fireAlpha, 0.0, 0.18);
    let materialSignals = materialTemporalSignals(alpha, smokeAlpha, fireAlpha, temp, microTextureSignal, interfaceShred, fireLick, majorantEdge, interest, trans);
    let materialTemporal = materialTemporalClassificationFromSignals(materialSignals);
    let temporalSampleWeight = materialAwareImportanceWeightFromSignals(materialSignals);
    temporalMaterialWeight = temporalMaterialWeight + temporalSampleWeight;
    temporalWorldSum = temporalWorldSum + p * temporalSampleWeight;
    temporalVelocitySum = temporalVelocitySum + state.xyz * temporalSampleWeight;
    temporalSmokeHistoryTrustSum = temporalSmokeHistoryTrustSum + materialTemporal.x * temporalSampleWeight;
    temporalFireHistoryProtectSum = temporalFireHistoryProtectSum + materialTemporal.y * temporalSampleWeight;
    temporalInterfaceHistoryProtectSum = temporalInterfaceHistoryProtectSum + materialTemporal.z * temporalSampleWeight;
    temporalDetailHistoryProtectSum = temporalDetailHistoryProtectSum + materialTemporal.w * temporalSampleWeight;
    temporalReactiveSignal = max(temporalReactiveSignal, clamp(fireAlpha * 5.2 + renderTemp * 0.075 + quenchedFlameDetail * 0.45 + quenchedFireLick * 0.38 + interfaceShred * 0.16 + materialSignals.reactiveBoost, 0.0, 2.2));
    let filament = smoothstep(0.014, 0.34, max(materialDetail * 0.66, microTextureSignal)) * filamentNoise * visibleDetailOverlayGain;
    let shredFilament = smoothstep(0.004, 0.22, interfaceShred * 3.10 + fireLick * 0.50 + microSmoke * 0.12) * shredNoise * visibleDetailOverlayGain;
    let fireFilament = smoothstep(0.008, 0.34, max(flameDetail * 0.72, fireLick * 2.25 + emberFleck * 0.44)) * fireNoise * visibleDetailOverlayGain;
    let pyroMemoryCell = samplePyroMaterialMemoryCell(p);
    let pyroSpatialEnergy = clamp(pyroMemoryCell.x * pyroMemoryCell.y * pyroMemoryCell.z, 0.0, 1.0);
    let pyroBaseCarrier = pyroMaterialGain
      * pyroMaterialEnergy
      * pyroLiveAuthority
      * (0.22 + pyroSpatialEnergy * 0.78)
      * smoothstep(0.018, 0.36, temp + flameDetail * 0.75 + fireLick * 0.42 + heat * 0.16)
      * smoothstep(0.012, 0.34, density + smoke * 0.18 + microTextureSignal * 0.20);
    let pyroInterfaceSignal = clamp(
      smoothstep(0.025, 0.42, temp + flameDetail * 0.85 + fireLick * 0.55 + heat * 0.18)
        * smoothstep(0.016, 0.46, smoke + rawExtinction + microSmoke * 0.40)
        * (0.55 + interfaceShred * 0.24 + fireLick * 0.14),
      0.0,
      1.0
    );
    let pyroLiveCarrier = pyroBaseCarrier * mix(1.0, pyroInterfaceSignal, pyroInterfaceFocus);
    let pyroBiteCarrier = pyroBaseCarrier * mix(1.0, pyroInterfaceSignal, pyroBiteBorderFocus);
    let pyroFoldCarrier = pyroBaseCarrier * mix(1.0, pyroInterfaceSignal, pyroFoldBorderFocus);
    let pyroNormalView = 1.0 - step(0.5, pyroCarrierViewMode);
    let pyroBorderView = 1.0 - step(0.5, abs(pyroCarrierViewMode - 1.0));
    let pyroBiteView = 1.0 - step(0.5, abs(pyroCarrierViewMode - 2.0));
    let pyroFoldView = 1.0 - step(0.5, abs(pyroCarrierViewMode - 3.0));
    let pyroWakeView = 1.0 - step(0.5, abs(pyroCarrierViewMode - 4.0));
    let pyroRadianceView = 1.0 - step(0.5, abs(pyroCarrierViewMode - 5.0));
    let pyroFlowView = 1.0 - step(0.5, abs(pyroCarrierViewMode - 6.0));
    let pyroAllView = 1.0 - step(0.5, abs(pyroCarrierViewMode - 7.0));
    let pyroBorderMask = clamp(pyroNormalView + pyroBorderView + pyroAllView, 0.0, 1.0);
    let pyroBiteMask = clamp(pyroNormalView + pyroBiteView + pyroAllView, 0.0, 1.0);
    let pyroFoldMask = clamp(pyroNormalView + pyroFoldView + pyroAllView, 0.0, 1.0);
    let pyroWakeMask = clamp(pyroNormalView + pyroWakeView + pyroAllView, 0.0, 1.0);
    let pyroRadianceMask = clamp(pyroNormalView + pyroRadianceView + pyroAllView, 0.0, 1.0);
    let pyroFlowMask = clamp(pyroNormalView + pyroFlowView + pyroAllView, 0.0, 1.0);
    let pyroMemoryPattern = 0.5 + 0.5 * sin(
      p.y * 31.0
        + p.x * 17.0
        - p.z * 13.0
        + pyroMemoryCell.x * 1.4
        + pyroMemoryCell.w * 0.7
        + u.cameraPos_time.w * (0.38 + pyroSmokeAuthority * 0.18)
        + filamentNoise * 1.2
        + fireNoise * 0.8
    );
    let fineShadow = 0.48 + 0.64 * filament - 0.20 * shredFilament;
    let smokeCol = mix(
      vec3<f32>(0.28, 0.38, 0.42) * fineShadow * (0.88 + bonfireRenderScene * (bonfireCurtainBreakup - 1.0) * 0.58) * (0.42 + min(0.78, velMag * 6.0) + shredFilament * 0.26),
      vec3<f32>(0.28, 0.38, 0.42) * 0.62,
      canonicalSmokeOnlyRender
    );
    let flameCol = fireColor(renderTemp) * (0.22 + renderTemp * 0.82 + fireFilament * 0.82 * flameBodyAuthority + quenchedFireLick * 0.32 + shredFilament * 0.10) * bonfireTransportedFireLumaShaper;
    let baseRadianceEmission = fireRadianceEmission(renderTemp, quenchedFlameDetail, quenchedFireLick, quenchedEmberFleck, radianceGain, glowGain)
      * mix(1.0, bonfireFireRenderBreakup * bonfireTransportedFireLumaShaper, bonfireRenderScene)
      * flameBodyAuthority;
    let shellTemperature = clamp((rawTemp + thermalSupport * 0.42 + reactionSupport * 0.28 + frontSupport * 0.18 + shellBiteGain * edgeSupport * 0.10) * shellHeatGain, 0.0, 2.4);
    let shellWarmth = smoothstep(0.10, 1.85, shellTemperature);
    let shellHotCore = mix(vec3<f32>(1.75, 0.16, 0.018), vec3<f32>(2.80, 0.68, 0.055), shellWarmth);
    let shellRampColor = mix(shellHotCore, vec3<f32>(3.20, 0.92, 0.10), smoothstep(2.35, 3.80, shellHeatGain) * 0.18);
    let shellBaseColor = shellRampColor * (0.24 + shellMask * 0.92 + frontSupport * 0.22 + edgeSupport * 0.12);
    let shellLit = shellBaseColor * shellLuma * shellExposure;
    let shellColor = shellLit / (vec3<f32>(1.0) + shellLit / shellSoftClip);
    let inspectColor = (
      vec3<f32>(1.0, 0.62, 0.14) * inspectShellMask
      + vec3<f32>(1.0, 0.78, 0.20) * inspectThermalMask
      + vec3<f32>(0.95, 0.22, 0.08) * inspectReactionMask
      + vec3<f32>(1.0, 0.92, 0.22) * inspectFrontMask
      + vec3<f32>(0.16, 0.82, 1.0) * inspectEdgeMask
      + vec3<f32>(0.86, 0.28, 1.0) * inspectCoreMask
      + vec3<f32>(0.10, 0.78, 1.0) * inspectCurlMask
      + vec3<f32>(1.0, 0.18, 0.08) * inspectDivMask
      + vec3<f32>(0.95, 0.86, 0.52) * inspectBoundaryMask
      + boundaryFireColor * inspectBoundaryFireMask
    ) * (0.24 + inspectSignal * 1.85);
    let radianceEmission = baseRadianceEmission * stockRenderMode;
    let smokeBacklight = fireColor(renderTemp * 0.72) * smokeAlpha * glowGain * stockRenderMode * smoothstep(0.16, 1.25, renderTemp) * (0.13 + fireFilament * 0.10 * flameBodyAuthority);
    let shellSmokeBacklight = shellColor * shellRenderMode * smokeAlpha * shellSmokeCoupling * shellAlpha * 0.26;
    let fireMix = smoothstep(0.005, 0.052, fireAlpha) * smoothstep(0.08, 0.70, renderTemp);
    let pyroOwnedFireMode = step(1.5, pyroFireMode);
    let pyroHybridFireMode = step(0.5, pyroFireMode) * (1.0 - pyroOwnedFireMode);
    let pyroStockFireVisibility = 1.0 - pyroOwnedFireMode;
    let pyroRawCombustionSignal = smoothstep(
      0.026,
      0.62,
      rawTemp + heat * 0.18 + flameDetail * 0.50 + fireLick * 0.34 + combustionFront * 0.25 + combustionFrontTopology * 0.18 + ember * 0.12
    );
    let pyroRawBodySignal = smoothstep(
      0.010,
      0.38,
      visibleFlameAlphaCarrier * 0.16 + flameDetail * 0.34 + fireLick * 0.24 + combustionFront * 0.16 + rawTemp * 0.18 + heat * 0.08
    );
    let pyroRawFireMix = clamp(pyroRawCombustionSignal * max(pyroRawBodySignal, 0.22 + pyroHybridFireMode * 0.10 + pyroOwnedFireMode * 0.18), 0.0, 1.0);
    let pyroRawCurrentFire = clamp(max(pyroRawFireMix, smoothstep(0.012, 0.50, flameDetail + quenchedFireLick * 0.55 + combustionFront * 0.18)), 0.0, 1.0);
    let pyroFireEventCarrier = clamp(max(fireMix * pyroStockFireVisibility, pyroRawCurrentFire), 0.0, 1.0);
    let pyroCurrentFireLock = mix(
      1.0,
      max(
        pyroRawCurrentFire,
        smoothstep(0.008, 0.20, fireAlpha * pyroStockFireVisibility + pyroFireEventCarrier * 0.34 + flameDetail * 0.16 + quenchedFireLick * 0.10)
      ),
      pyroBiteFireLock
    );
    let pyroBiteHeightGate = 1.0 - smoothstep(
      mix(0.22, 0.76, pyroBiteHeight),
      mix(0.44, 1.05, pyroBiteHeight),
      y
    );
    let pyroBiteBodyEvent = smoothstep(0.03, 0.62, pyroFireEventCarrier + fireAlpha * pyroStockFireVisibility * 2.2 + pyroRawCombustionSignal * 0.20);
    let pyroBiteEdgeEvent = clamp(
      pyroInterfaceSignal
        * smoothstep(0.018, 0.48, pyroFireEventCarrier + flameDetail * 0.38 + fireLick * 0.25 + combustionFront * 0.16)
        * (1.0 - smoothstep(0.58, 1.05, pyroFireEventCarrier + fireAlpha * pyroStockFireVisibility * 1.1))
        * (0.72 + interfaceShred * 0.22 + fireLick * 0.18),
      0.0,
      1.0
    );
    let pyroBiteWakeSignal = clamp(
      pyroBiteWake
        * smoothstep(-0.84, -0.24, p.y)
        * (1.0 - smoothstep(0.22, 0.76, p.y))
        * smoothstep(0.018, 0.58, smoke + rawExtinction + microSmoke * 0.34)
        * smoothstep(0.014, 0.52, pyroFireEventCarrier + flameDetail * 0.42 + fireLick * 0.30),
      0.0,
      1.0
    );
    let pyroBiteEvent = clamp(mix(pyroBiteBodyEvent, pyroBiteEdgeEvent, pyroBiteTeeth) * pyroBiteHeightGate * pyroCurrentFireLock, 0.0, 1.20);
    let pyroBiteCoreGate = smoothstep(
      mix(0.018, 0.30, pyroBiteCoreCut),
      mix(0.18, 0.82, pyroBiteCoreCut),
      pyroFireEventCarrier + pyroRawCombustionSignal * 0.35 + flameDetail * 0.24
    );
    let pyroBiteCoreEvent = clamp(
      pyroBiteCore * pyroBiteBodyEvent * pyroBiteCoreGate * pyroBiteHeightGate * pyroCurrentFireLock,
      0.0,
      1.25
    );
    let pyroBiteRimGate = smoothstep(
      mix(0.010, 0.24, pyroBiteRimCut),
      mix(0.16, 0.72, pyroBiteRimCut),
      pyroInterfaceSignal + interfaceShred * 0.18 + fireLick * 0.12
    );
    let pyroBiteRimEvent = clamp(
      pyroBiteRim * pyroBiteEdgeEvent * pyroBiteRimGate * pyroBiteHeightGate * pyroCurrentFireLock,
      0.0,
      1.25
    );
    let pyroBiteAfterGate = smoothstep(
      mix(0.010, 0.22, pyroBiteAfterCut),
      mix(0.12, 0.68, pyroBiteAfterCut),
      pyroBiteWakeSignal + smoke * 0.08 + rawExtinction * 0.08
    );
    let pyroBiteAfterFireGate = mix(1.0, pyroRawCurrentFire, 0.35 + pyroBiteFireLock * 0.35);
    let pyroBiteAfterEvent = clamp(
      pyroBiteAfter * pyroBiteWakeSignal * pyroBiteAfterGate * pyroBiteHeightGate * pyroBiteAfterFireGate,
      0.0,
      1.25
    );
    let pyroStackedBiteEvent = clamp(
      pyroBiteEvent + pyroBiteCoreEvent * 0.36 + pyroBiteRimEvent * 0.54 + pyroBiteAfterEvent * 0.32,
      0.0,
      1.55
    );
    let pyroEdgeBreakup = pyroBiteCarrier
      * pyroEdgeBite
      * pyroBiteMask
      * pyroCarrierOverdrive
      * (0.40 + pyroMemoryPattern * 0.60)
      * pyroStackedBiteEvent;
    let pyroFlowTopology = smoothstep(
      mix(0.0006, 0.006, pyroFlowTeeth),
      mix(0.025, 0.16, pyroFlowTeeth),
      combustionFrontTopology * (0.68 + pyroFlowTeeth * 0.62)
        + fireLick * 0.34
        + combustionFront * 0.24
        + interfaceShred * 0.18
        + curlDebug * (0.28 + pyroFlowTeeth * 0.34)
        + divDebug * 0.18
    );
    let pyroFlowShear = smoothstep(
      0.015,
      0.17,
      curlDebug * (0.78 + pyroFlowTeeth * 0.62) + divDebug * 0.48 + velMag * 0.025
    );
    let pyroFlowFront = mix(pyroRawCurrentFire, max(pyroRawCurrentFire * 0.28, pyroInterfaceSignal), pyroFlowBorder);
    let pyroFlowLiveCarrier = pyroMaterialGain
      * pyroMaterialEnergy
      * pyroLiveAuthority
      * (0.18 + pyroSpatialEnergy * 0.58 + pyroSmokeAuthority * 0.24)
      * smoothstep(0.006, 0.22, density + smoke * 0.28 + rawExtinction * 0.24 + microSmoke * 0.28)
      * smoothstep(0.001, 0.045, combustionFrontTopology * 0.58 + fireLick * 0.34 + interfaceShred * 0.22 + curlDebug * 0.72 + divDebug * 0.28);
    let pyroFlowHeightGate = 1.0 - smoothstep(
      mix(0.24, 0.92, pyroFlowRise),
      mix(0.46, 1.16, pyroFlowRise),
      y
    );
    let pyroFlowFireGate = mix(1.0, max(pyroRawCurrentFire, pyroFireEventCarrier), pyroFlowFireLock);
    let pyroFlowCarrierShape = max(
      mix(pyroFlowFront, max(pyroFlowFront, pyroFlowShear), pyroFlowTeeth),
      pyroFlowLiveCarrier * pyroFlowShear * (0.22 + pyroFlowTeeth * 0.36)
    );
    let pyroFlowSignal = clamp(
      max(pyroBaseCarrier, pyroFlowLiveCarrier)
        * pyroFlowMask
        * pyroFlowBite
        * pyroCarrierOverdrive
        * pyroFlowFireGate
        * pyroFlowHeightGate
        * pyroFlowCarrierShape
        * max(pyroFlowTopology, pyroFlowShear * (0.18 + pyroFlowTeeth * 0.22))
        * (0.22 + pyroMemoryPattern * 0.16 + pyroFlowShear * 0.30 + combustionFrontTopology * 0.06 + fireLick * 0.05),
      0.0,
      4.0
    );
    let pyroFlowSpikeMask = smoothstep(
      mix(0.24, 0.10, pyroFlowSpikes),
      mix(0.92, 0.52, pyroFlowSpikes),
      pyroFlowTopology * (0.64 + pyroFlowSpikes * 0.52)
        + pyroFlowShear * (0.18 + pyroFlowSpikes * 0.36)
        + pyroMemoryPattern * (0.10 + pyroFlowSpikes * 0.28)
        + fireLick * (0.10 + pyroFlowSpikes * 0.20)
    );
    let pyroFlowSpikeSignal = clamp(
      pyroFlowSignal
        * pyroFlowSpikes
        * pyroFlowSpikeMask
        * (0.22 + combustionFrontTopology * 0.28 + fireLick * 0.18 + pyroFlowShear * 0.14),
      0.0,
      3.0
    );
    let pyroFlowRadianceBoost = clamp(
      pyroFlowSignal
        * pyroFlowRadiance
        * (0.055 + pyroFlowSpikeSignal * 0.13 + pyroFlowShear * 0.055 + combustionFrontTopology * 0.060 + fireLick * 0.035),
      0.0,
      3.5
    );
    let pyroFoldWakeSignal = clamp(
      smoothstep(0.02, 0.62, smoke + rawExtinction + microSmoke * 0.24)
        * mix(
          pyroInterfaceSignal,
          smoothstep(0.012, 0.52, smoke + rawExtinction + microSmoke * 0.42)
            * smoothstep(-0.70, 0.68, p.y)
            * (0.58 + pyroInterfaceSignal * 0.42 + flameDetail * 0.16 + fireLick * 0.10),
          pyroFoldWake
        ),
      0.0,
      1.25
    );
    let pyroSmokeFoldSignal = pyroFoldCarrier
      * pyroSmokeFold
      * pyroFoldMask
      * pyroCarrierOverdrive
      * (0.34 + pyroSpatialEnergy * 0.66)
      * pyroFoldWakeSignal;
    let pyroWakeHeightGate = 1.0 - smoothstep(
      mix(0.48, 0.92, pyroWakeLift),
      mix(0.72, 1.08, pyroWakeLift),
      y
    );
    let pyroWakeEvent = clamp(
      (pyroBiteWakeSignal * (0.48 + pyroBiteWake * 0.52) + pyroFoldWakeSignal * (0.34 + pyroFoldWake * 0.44))
        * pyroWakeHeightGate
        * smoothstep(0.025, 0.72, smoke + rawExtinction + microSmoke * 0.34),
      0.0,
      1.45
    );
    let pyroWakeSignal = pyroBaseCarrier
      * pyroWakeMask
      * pyroCarrierOverdrive
      * (0.20 + pyroSpatialEnergy * 0.62 + pyroSmokeAuthority * 0.18)
      * pyroWakeEvent;
    let pyroRadianceFreshFireGate = smoothstep(
      0.018,
      0.44,
      rawTemp + heat * 0.20 + visibleFlameAlphaCarrier * 0.34 + combustionFront * 0.22 + fireLick * 0.12
    );
    let pyroRadianceFireBodyEvent = smoothstep(
      0.025,
      0.68,
      mix(pyroRawCurrentFire, pyroRadianceFreshFireGate + pyroRawCurrentFire * 0.22, pyroRadianceFireLock)
        + rawTemp * 0.18
        + heat * 0.08
        + combustionFront * 0.16
    );
    let pyroRadianceFireEdgeEvent = clamp(
      pyroInterfaceSignal
        * smoothstep(0.014, 0.54, pyroFireEventCarrier + flameDetail * 0.40 + fireLick * 0.30 + combustionFront * 0.22)
        * (1.0 - smoothstep(0.64, 1.06, pyroFireEventCarrier + pyroRawCombustionSignal * 0.34))
        * (0.70 + pyroMemoryPattern * 0.22 + fireLick * 0.14),
      0.0,
      1.25
    );
    let pyroRadianceFreshLock = mix(
      1.0,
      clamp(max(pyroRadianceFreshFireGate, pyroRadianceFireEdgeEvent * 0.42), 0.0, 1.0),
      pyroRadianceFireLock
    );
    let pyroRadianceBorderEvent = mix(pyroRadianceFireBodyEvent, max(pyroRadianceFireEdgeEvent, pyroRadianceFireBodyEvent * 0.24), pyroRadianceBorder);
    let pyroRadianceToothedEvent = mix(
      pyroRadianceBorderEvent,
      pyroRadianceFireEdgeEvent * (0.72 + pyroMemoryPattern * 0.48 + fireLick * 0.20),
      pyroRadianceTeeth
    );
    let pyroFireRadianceEvent = clamp(
      pyroRadianceToothedEvent
        * pyroRadianceFreshLock
        * (0.28 + 0.42 * (1.0 - pyroRadianceSpill)),
      0.0,
      1.45
    );
    let pyroWakeRadianceEvent = max(pyroWakeEvent * (0.20 + pyroRadianceSpill * 0.80), pyroFoldWakeSignal * (0.16 + pyroRadianceSpill * 0.54));
    let pyroMixedRadianceEvent = max(pyroFireRadianceEvent, pyroWakeRadianceEvent);
    let pyroRadianceFireSource = 1.0 - step(0.5, pyroRadianceSource);
    let pyroRadianceMixedSource = 1.0 - step(0.5, abs(pyroRadianceSource - 1.0));
    let pyroRadianceWakeSource = 1.0 - step(0.5, abs(pyroRadianceSource - 2.0));
    let pyroRadianceEvent = max(
      max(pyroFireRadianceEvent * pyroRadianceFireSource, pyroMixedRadianceEvent * pyroRadianceMixedSource),
      pyroWakeRadianceEvent * pyroRadianceWakeSource
    );
    let pyroRadianceFireSourceWeight = clamp(pyroRadianceFireSource + pyroRadianceMixedSource * (1.0 - pyroRadianceSpill) * 0.42, 0.0, 1.0);
    let pyroRadianceHeightGate = 1.0 - smoothstep(
      mix(0.30, 0.88, max(pyroRadianceHeight, pyroRadianceRise)),
      mix(0.54, 1.12, max(pyroRadianceHeight, pyroRadianceRise)),
      y
    );
    let pyroRadianceBody = max(smoke + rawExtinction + microSmoke * 0.32, pyroRawCurrentFire * (0.26 + (1.0 - pyroRadianceSpill) * 0.42));
    let pyroRadianceFireCarrier = pyroMaterialGain
      * pyroMaterialEnergy
      * pyroLiveAuthority
      * (0.24 + pyroSpatialEnergy * 0.76)
      * smoothstep(0.012, 0.38, rawTemp + heat * 0.26 + flameDetail * 0.58 + fireLick * 0.40 + combustionFront * 0.26)
      * smoothstep(0.010, 0.48, pyroRadianceFreshFireGate + pyroFireRadianceEvent * 0.84 + pyroRawCurrentFire * 0.22);
    let pyroRadianceCarrier = mix(pyroBaseCarrier, max(pyroBaseCarrier * 0.36, pyroRadianceFireCarrier), pyroRadianceFireSourceWeight);
    let pyroRadianceGateFloor = mix(0.006, 0.13, pyroRadianceGate);
    let pyroRadianceGateCeil = mix(0.50, 0.82, pyroRadianceGate);
    let pyroRadianceSparsity = smoothstep(
      pyroRadianceGateFloor,
      pyroRadianceGateCeil,
      pyroRadianceEvent * (0.62 + flameDetail * 0.24 + quenchedFireLick * 0.16)
    );
    let pyroRadianceSpillSignal = mix(
      smoothstep(0.035, 0.55, pyroInterfaceSignal + pyroRadianceFireEdgeEvent * 0.72 + flameDetail * 0.12),
      smoothstep(0.012, 0.62, pyroRadianceBody),
      pyroRadianceSpill
    );
    let pyroRadianceContrastSignal = clamp(
      pyroRadianceCarrier
        * pyroContrastRadiance
        * pyroRadianceMask
        * pyroCarrierOverdrive
        * (0.36 + pyroSpatialEnergy * 0.64)
        * pyroRadianceSparsity
        * pyroRadianceSpillSignal
        * pyroRadianceHeightGate
        * (0.18 + pyroFireEventCarrier * 0.46 + flameDetail * 0.16 + quenchedFireLick * 0.14),
      0.0,
      12.0
    );
    let pyroRadianceBoost = clamp(
      pyroRadianceContrastSignal
        * mix(
          0.78 + pyroRadianceFreshFireGate * 0.62 + pyroRadianceFireEdgeEvent * 0.44 + pyroRawFireMix * 0.30,
          mix(
            0.16 + renderTemp * 0.12,
            0.18 + smoke * 0.42 + renderTemp * 0.14 + pyroMemoryPattern * 0.08,
            pyroRadianceSpill
          ),
          1.0 - pyroRadianceFireSourceWeight
        ),
      0.0,
      9.0
    );
    let pyroRadianceAlphaBoost = clamp(
      pyroRadianceFireSourceWeight
        * pyroRadianceContrastSignal
        * (0.22 + pyroRadianceFreshFireGate * 0.72 + pyroRadianceFireEdgeEvent * 0.36 + pyroRawFireMix * 0.18),
      0.0,
      4.0
    ) * selectiveRaymarchFireAuthority;
    let pyroFlowAlphaBoost = clamp(
      pyroFlowSignal * (0.18 + pyroFlowShear * 0.32 + pyroRawFireMix * 0.14 + fireMix * 0.08)
        + pyroFlowSpikeSignal * (0.10 + pyroFlowTeeth * 0.12),
      0.0,
      2.8
    ) * selectiveRaymarchFireAuthority;
    let pyroBiteAlphaBoost = clamp(pyroEdgeBreakup * (0.40 + fireMix * 0.80), 0.0, 2.4) * selectiveRaymarchFireAuthority;
    let pyroFoldExtinctionBoost = clamp(pyroSmokeFoldSignal * (0.34 + smoke * 0.85 + rawExtinction * 0.55), 0.0, 2.8);
    let pyroWakeAlphaBoost = clamp(pyroWakeSignal * (0.22 + smoke * 0.62 + rawExtinction * 0.36), 0.0, 2.1);
    let pyroOwnedFireAlphaBoost = clamp(
      pyroOwnedFireMode * pyroBaseCarrier * pyroLiveAuthority * pyroFlamePaint * pyroRawCurrentFire
        * (0.32 + pyroSpatialEnergy * 0.44 + flameDetail * 0.18 + fireLick * 0.14),
      0.0,
      2.4
    ) * selectiveRaymarchFireAuthority;
    alpha = clamp(
      alpha
        + pyroBiteAlphaBoost * rayStepOpacity * 0.080
        + pyroFoldExtinctionBoost * rayStepOpacity * 0.060
        + pyroWakeAlphaBoost * rayStepOpacity * 0.045
        + pyroOwnedFireAlphaBoost * rayStepOpacity * 0.070
        + pyroRadianceAlphaBoost * rayStepOpacity * 0.130
        + pyroFlowAlphaBoost * rayStepOpacity * 0.075
        + pyroFlowRadianceBoost * selectiveRaymarchFireAuthority * rayStepOpacity * 0.045,
      0.0,
      0.28
    );
    var local = smokeCol;
    local = mix(local, flameCol * 0.30 + radianceEmission * 0.70, stockRenderMode * fireMix * pyroStockFireVisibility);
    local = local + shellColor * shellRenderMode * smoothstep(0.002, 0.060, shellAlpha) * 0.92;
    local = mix(local, inspectColor, inspectRenderMode * smoothstep(0.002, 0.060, inspectAlpha));
    let pyroFlamePaintSignal = clamp(
      pyroBaseCarrier
        * pyroLiveAuthority
        * pyroFlamePaint
        * pyroRawFireMix
        * (0.34 + pyroSpatialEnergy * 0.46 + flameDetail * 0.16 + quenchedFireLick * 0.12),
      0.0,
      3.0
    );
    let pyroFlamePaintChroma = mix(
      pyroFlameEdgeColor * (0.54 + renderTemp * 0.20 + fireFilament * 0.10),
      pyroFlameCoreColor * (0.84 + rawTemp * 0.42 + fireFilament * 0.18),
      smoothstep(0.22, 0.92, pyroRawFireMix + rawTemp * 0.20 + flameDetail * 0.22)
    );
    let pyroLocalLuma = max(dot(local, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.001);
    let pyroRawPaintLuma = max(pyroLocalLuma, pyroRawCurrentFire * (0.32 + rawTemp * 0.72 + flameDetail * 0.32 + fireLick * 0.22 + combustionFront * 0.18));
    let pyroFlameChromaLuma = max(dot(pyroFlamePaintChroma, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.001);
    let pyroFlamePaintColor = pyroFlamePaintChroma * (pyroRawPaintLuma / pyroFlameChromaLuma) * pyroFlameLuma;
    local = mix(
      local,
      pyroFlamePaintColor,
      clamp(pyroFlamePaintSignal * selectiveRaymarchFireAuthority * mix(0.28, 0.92, 1.0 - pyroStockMix), 0.0, 0.95)
    );
    let pyroFlowHeat = clamp(pyroFlowTopology + pyroRawFireMix * 0.28 + pyroFlowShear * 0.22, 0.0, 1.0);
    let pyroFlowColor = mix(
      pyroFlowCoolEndpoint * (0.44 + smoke * 0.18 + pyroFlowShear * 0.10),
      pyroFlowHotEndpoint * (0.52 + pyroRawFireMix * 0.30 + fireLick * 0.14 + combustionFront * 0.10),
      smoothstep(0.18, 0.88, pyroFlowHeat)
    );
    let pyroFlowColorLuma = max(dot(pyroFlowColor, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.001);
    let pyroFlowTargetLuma = max(
      dot(local, vec3<f32>(0.2126, 0.7152, 0.0722)),
      max(
        pyroRawCurrentFire * (0.28 + rawTemp * 0.42 + fireLick * 0.18),
        pyroFlowSignal * (0.10 + pyroFlowShear * 0.10 + combustionFrontTopology * 0.06)
      )
    );
    let pyroFlowLumaColor = pyroFlowColor * (pyroFlowTargetLuma / pyroFlowColorLuma) * pyroFlowLuma;
    let pyroFlowSpikeColor = mix(
      pyroFlowLumaColor,
      pyroFlowHotEndpoint * (0.84 + pyroFlowHeat * 0.32),
      clamp(pyroFlowSpikes * 0.75 + pyroFlowSpikeSignal * 0.18, 0.0, 1.0)
    );
    local = mix(
      local,
      local
        + pyroFlowLumaColor * pyroFlowAlphaBoost * (0.18 + pyroFlowShear * 0.10)
        + pyroFlowSpikeColor * pyroFlowSpikeSignal * (0.13 + pyroFlowTeeth * 0.12)
        + pyroFlowHotEndpoint * pyroFlowRadianceBoost * (0.16 + pyroFlowHeat * 0.10),
      clamp(pyroFlowAlphaBoost * 0.22 + pyroFlowSpikeSignal * 0.11 + pyroFlowRadianceBoost * 0.12, 0.0, 0.74)
    );
    let pyroFoldColor = vec3<f32>(0.18, 0.28, 0.31);
    local = mix(
      local,
      local * (0.70 - pyroFoldExtinctionBoost * 0.24) + pyroFoldColor * pyroFoldExtinctionBoost * 0.54,
      clamp(pyroFoldExtinctionBoost, 0.0, 0.78)
    );
    let pyroWakeNeutralColor = pyroWakeShadowEndpoint * (0.70 + smoke * 0.16);
    let pyroWakeAmberColor = pyroWakeEmberEndpoint * (0.24 + smoke * 0.18 + pyroMemoryPattern * 0.10 + pyroRawFireMix * 0.08);
    let pyroWakeColor = mix(pyroWakeNeutralColor, pyroWakeAmberColor, pyroWakeWarmth);
    local = mix(
      local,
      local * (0.82 - pyroWakeAlphaBoost * 0.12) + pyroWakeColor * pyroWakeAlphaBoost * 0.48 * pyroWakeLuma,
      clamp(pyroWakeAlphaBoost, 0.0, 0.72)
    );
    let pyroBiteEmberColor = pyroBiteEmberEndpoint * (0.72 + renderTemp * 0.18 + pyroRawFireMix * 0.12);
    let pyroBiteHotColor = pyroBiteHotEndpoint * (0.82 + max(fireMix, pyroRawFireMix) * 0.36);
    let pyroBiteMutedColor = mix(local, pyroBiteEmberColor, 0.44);
    let pyroBiteSaturatedColor = mix(pyroBiteEmberColor, pyroBiteHotColor, pyroBiteHeat);
    let pyroBiteColor = mix(pyroBiteMutedColor, pyroBiteSaturatedColor, pyroBiteChroma);
    local = local * (1.0 - pyroBiteAlphaBoost * mix(0.24, 0.42, pyroBiteChroma))
      + pyroBiteColor * pyroBiteAlphaBoost * pyroBiteLuma * (0.28 + max(fireMix, pyroRawFireMix) * 0.62 + pyroBiteChroma * 0.18);
    let pyroRadianceSmokeBlue = pyroRadianceCoolEndpoint * (0.36 + smoke * 0.18);
    let pyroRadianceNeutral = mix(pyroRadianceCoolEndpoint, pyroRadianceWarmEndpoint, 0.45) * (0.35 + smoke * 0.16);
    let pyroRadianceAmber = pyroRadianceWarmEndpoint * (0.30 + smoke * 0.16 + pyroRawFireMix * 0.08)
      + pyroRadianceWarmEndpoint * pyroFoldWakeSignal * (0.06 + pyroRadianceSpill * 0.16);
    let pyroRadianceCoolColor = mix(pyroRadianceNeutral, pyroRadianceSmokeBlue, pyroRadianceChroma);
    let pyroRadianceWarmColor = mix(pyroRadianceNeutral, pyroRadianceAmber, pyroRadianceChroma);
    let pyroRadianceHueColor = mix(pyroRadianceCoolColor, pyroRadianceWarmColor, pyroRadianceHue);
    let pyroRadianceFireGold = mix(pyroRadianceWarmEndpoint, pyroBiteHotEndpoint, 0.36 + pyroRadianceChroma * 0.44)
      * (0.44 + pyroRawFireMix * 0.18 + pyroRadianceFireEdgeEvent * 0.22 + pyroRadianceFreshFireGate * 0.16);
    let pyroRadianceColor = mix(
      mix(pyroRadianceHueColor, pyroRadianceWarmColor, pyroRadianceWarmth * (0.36 + pyroRadianceChroma * 0.64)),
      pyroRadianceFireGold,
      pyroRadianceFireSourceWeight
    );
    let pyroRadianceLocalWeight = mix(mix(0.42, 0.20, pyroRadianceSpill), mix(0.07, 0.16, pyroRadianceSpill), 1.0 - pyroRadianceFireSourceWeight);
    local = local + pyroRadianceColor * pyroRadianceBoost * pyroRadianceLuma * pyroRadianceLocalWeight;
    let pyroBorderDiagnostic = pyroLiveCarrier * pyroInterfaceSignal * pyroBorderMask * pyroCarrierOverdrive;
    let pyroDiagnosticColor =
      vec3<f32>(0.10, 0.78, 1.0) * clamp(pyroBorderDiagnostic, 0.0, 1.0)
      + vec3<f32>(1.0, 0.12, 0.03) * clamp(pyroBiteAlphaBoost, 0.0, 1.0)
      + vec3<f32>(0.28, 0.72, 1.05) * clamp(pyroFoldExtinctionBoost, 0.0, 1.0)
      + vec3<f32>(1.0, 0.72, 0.18) * clamp(pyroRadianceBoost, 0.0, 1.0)
      + vec3<f32>(0.18, 0.95, 1.0) * clamp(max(max(pyroFlowAlphaBoost, pyroFlowRadianceBoost), pyroFlowSpikeSignal), 0.0, 1.0);
    let pyroDiagnosticSignal = clamp(max(max(max(pyroBorderDiagnostic, max(pyroRadianceBoost, pyroFlowRadianceBoost)), max(pyroBiteAlphaBoost, pyroFoldExtinctionBoost)), max(pyroFlowAlphaBoost, pyroFlowSpikeSignal)), 0.0, 1.0);
    let pyroDiagnosticPaintAlpha = clamp(pyroDiagnosticPaint * pyroDiagnosticSignal * (0.72 + pyroCarrierOverdrive * 0.055), 0.0, 1.0);
    alpha = clamp(alpha + pyroDiagnosticPaintAlpha * rayStepOpacity * 0.16, 0.0, 0.42);
    local = mix(local, pyroDiagnosticColor * (0.96 + pyroCarrierOverdrive * 0.045), clamp(pyroDiagnosticPaintAlpha * 1.28, 0.0, 1.0));
    let vaporCol = vec3<f32>(0.78, 0.88, 0.92) * (0.76 + filament * 0.18 + shredFilament * 0.12);
    local = mix(local, vaporCol, clamp(max(vaporCarrier * 0.92, quenchCoreCollapse * 0.62), 0.0, 0.96));
    let diagnosticColor = mix(vec3<f32>(0.08, 0.72, 0.95), vec3<f32>(1.0, 0.18, 0.08), smoothstep(0.010, 0.085, divDebug)) * (0.35 + smoothstep(0.012, 0.18, curlDebug));
    local = mix(local, diagnosticColor, flowDebug * smoothstep(0.015, 0.12, curlDebug + divDebug));
    let oracleDisplay = clamp(u.oracle_activity_controls2.x, 0.0, 1.0);
    let oracleDisplayCue = rawTruthOracleActivityCueAtCell(sampleCell);
    let oracleDisplayColor = mix(vec3<f32>(0.02, 0.08, 0.04), vec3<f32>(0.65, 1.0, 0.78), smoothstep(0.04, 0.72, oracleDisplayCue));
    local = mix(local, oracleDisplayColor, oracleDisplay * smoothstep(0.015, 0.72, oracleDisplayCue));
    let pressureTierOverlay = pressureTierDebugOverlayColor(y);
    local = mix(local, pressureTierOverlay.rgb, pressureTierOverlay.a);
    color = color + trans * (alpha * local + stockRenderMode * fireAlpha * pyroStockFireVisibility * radianceEmission * mix(0.82, 0.62, bonfireRenderScene) + smokeBacklight * pyroStockFireVisibility * selectiveRaymarchFireAuthority + shellSmokeBacklight * selectiveRaymarchFireAuthority + pyroRadianceColor * pyroRadianceBoost * pyroRadianceLuma * rayStepOpacity * selectiveRaymarchFireAuthority * mix(mix(0.080, 0.030, pyroRadianceSpill), mix(0.012, 0.030, pyroRadianceSpill), 1.0 - pyroRadianceFireSourceWeight));
    let residualFeatureWeight = trans * rayStepOpacity;
    let residualRadianceLuma = max(dot(radianceEmission + pyroRadianceColor * pyroRadianceBoost * pyroRadianceLuma, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0);
    residualRadianceAuthority = residualRadianceAuthority + residualFeatureWeight * clamp(residualRadianceLuma * 0.30 + pyroRadianceBoost * 0.75 + pyroFireRadianceEvent * 0.40, 0.0, 4.0);
    residualFireAuthority = residualFireAuthority + residualFeatureWeight * clamp(pyroRawCurrentFire * 1.05 + fireMix * 0.90 + pyroFireEventCarrier * 0.55, 0.0, 3.5);
    residualInterfaceAuthority = residualInterfaceAuthority + residualFeatureWeight * clamp(pyroInterfaceSignal * 0.85 + pyroBiteAlphaBoost * 0.36 + flameDetail * 0.18 + fireLick * 0.16, 0.0, 3.5);
    residualSmokeAuthority = residualSmokeAuthority + residualFeatureWeight * clamp(smoke * 0.55 + rawExtinction * 0.38 + microSmoke * 0.32 + pyroFoldExtinctionBoost * 0.18, 0.0, 3.0);
    let extinctionStep = clamp(alpha * (0.46 + extinction * 0.16) + fireAlpha * 0.08, 0.0, 0.34);
    trans = trans * exp(-extinctionStep);
    t = t + localDt;
  }

  let vignette = 1.0 - smoothstep(0.28, 1.48, length(ndc));
  let exposed = vec3<f32>(1.0) - exp(-color * 0.96);
  var grade = exposed * (0.80 + 0.18 * vignette);
  let overlay = clamp(gridAccum * u.grid_overlay_debug.x * 1.8, 0.0, 1.0);
  grade = mix(grade, vec3<f32>(0.04, 0.86, 0.98), overlay * 0.76);
  let current = pow(max(grade, vec3<f32>(0.0)), vec3<f32>(0.84));
  let temporalInvWeight = 1.0 / max(temporalMaterialWeight, 0.0001);
  let temporalWorld = temporalWorldSum * temporalInvWeight;
  let temporalVelocity = temporalVelocitySum * temporalInvWeight;
  let temporalConfidence = temporalReprojectionConfidence(temporalMaterialWeight, temporalMajorantEdge, temporalReactiveSignal);
  let temporalUv = temporalReprojectionUv(temporalWorld, temporalVelocity, temporalConfidence);
  let materialTemporalWeights = materialAwareTemporalWeights(temporalSmokeHistoryTrustSum, temporalFireHistoryProtectSum, temporalInterfaceHistoryProtectSum, temporalDetailHistoryProtectSum, temporalMaterialWeight);
  let resolvedColor = temporalResolveColor(current, in.uv, temporalUv.xy, temporalConfidence * temporalUv.z, temporalReactiveSignal, temporalMajorantEdge, temporalUv.z, materialTemporalWeights);
  let residualFeature = vec4<f32>(
    clamp(1.0 - exp(-residualRadianceAuthority * 0.72), 0.0, 1.0),
    clamp(1.0 - exp(-residualFireAuthority * 0.82), 0.0, 1.0),
    clamp(1.0 - exp(-residualInterfaceAuthority * 0.90), 0.0, 1.0),
    clamp(1.0 - exp(-residualSmokeAuthority * 0.56), 0.0, 1.0)
  );
  return makeRaymarchResult(vec4<f32>(resolvedColor, 1.0), residualFeature);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let result = raymarchVolume(in);
  return result.color;
}

@fragment
fn fsResidualSource(in: VSOut) -> ResidualSourceOutput {
  let result = raymarchVolume(in);
  var out: ResidualSourceOutput;
  out.color = result.color;
  out.residualFeature = result.residualFeature;
  return out;
}
`;

const BROWSER_RESIDUAL_WGSL = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let position = positions[vertexIndex];
  var out: VertexOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.uv = position * 0.5 + vec2<f32>(0.5, 0.5);
  return out;
}

@group(0) @binding(0) var sourceFrame: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<storage, read> residualData: array<f32>;
@group(0) @binding(3) var sourceFeature: texture_2d<f32>;

fn residualDataHeaderFloats() -> u32 {
  return 16u;
}

fn browserResidualInputChannels() -> u32 {
  return u32(clamp(residualData[0u], 3.0, 7.0));
}

fn residualWeight(outputChannel: u32, offsetY: u32, offsetX: u32, inputChannel: u32, inputChannels: u32) -> f32 {
  return residualData[residualDataHeaderFloats() + (((outputChannel * 3u + offsetY) * 3u + offsetX) * inputChannels + inputChannel)];
}

fn residualBias(outputChannel: u32, inputChannels: u32) -> f32 {
  return residualData[residualDataHeaderFloats() + 27u * inputChannels + outputChannel];
}

fn lumaMax(color: vec3<f32>) -> f32 {
  return max(color.r, max(color.g, color.b));
}

fn edgeSignal(uv: vec2<f32>, texel: vec2<f32>, center: vec3<f32>) -> f32 {
  let c = lumaMax(center);
  let left = lumaMax(textureSampleLevel(sourceFrame, sourceSampler, uv + vec2<f32>(-texel.x, 0.0), 0.0).rgb);
  let right = lumaMax(textureSampleLevel(sourceFrame, sourceSampler, uv + vec2<f32>(texel.x, 0.0), 0.0).rgb);
  let down = lumaMax(textureSampleLevel(sourceFrame, sourceSampler, uv + vec2<f32>(0.0, -texel.y), 0.0).rgb);
  let up = lumaMax(textureSampleLevel(sourceFrame, sourceSampler, uv + vec2<f32>(0.0, texel.y), 0.0).rgb);
  return max(max(abs(c - left), abs(c - right)), max(abs(c - down), abs(c - up)));
}

fn debugFeatureView(feature: vec4<f32>) -> vec3<f32> {
  let radiance = feature.r;
  let fire = feature.g;
  let interfaceAuthority = feature.b;
  let smoke = feature.a;
  let fireColor = vec3<f32>(1.0, 0.38, 0.02) * max(radiance, fire);
  let interfaceColor = vec3<f32>(0.05, 0.52, 1.0) * interfaceAuthority;
  let smokeColor = vec3<f32>(0.05, 0.20, 0.34) * smoke;
  return clamp(fireColor + interfaceColor + smokeColor, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let dims = vec2<f32>(textureDimensions(sourceFrame));
  let texel = 1.0 / max(dims, vec2<f32>(1.0));
  let sourceUv = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
  let uv = clamp(sourceUv, vec2<f32>(0.0), vec2<f32>(1.0));
  let center = textureSampleLevel(sourceFrame, sourceSampler, uv, 0.0).rgb;
  let feature = textureSampleLevel(sourceFeature, sourceSampler, uv, 0.0);
  let inputChannels = browserResidualInputChannels();
  var residual = vec3<f32>(residualBias(0u, inputChannels), residualBias(1u, inputChannels), residualBias(2u, inputChannels));
  for (var oy: u32 = 0u; oy < 3u; oy = oy + 1u) {
    for (var ox: u32 = 0u; ox < 3u; ox = ox + 1u) {
      let offset = vec2<f32>(f32(i32(ox) - 1), f32(i32(oy) - 1)) * texel;
      let sampleColor = textureSampleLevel(sourceFrame, sourceSampler, uv + offset, 0.0).rgb;
      let sampleFeature = textureSampleLevel(sourceFeature, sourceSampler, uv + offset, 0.0);
      let sampleInputs = array<f32, 7>(
        sampleColor.r,
        sampleColor.g,
        sampleColor.b,
        sampleFeature.r,
        sampleFeature.g,
        sampleFeature.b,
        sampleFeature.a
      );
      for (var inputChannel: u32 = 0u; inputChannel < inputChannels; inputChannel = inputChannel + 1u) {
        let value = sampleInputs[inputChannel];
        residual.x = residual.x + value * residualWeight(0u, oy, ox, inputChannel, inputChannels);
        residual.y = residual.y + value * residualWeight(1u, oy, ox, inputChannel, inputChannels);
        residual.z = residual.z + value * residualWeight(2u, oy, ox, inputChannel, inputChannels);
      }
    }
  }
  let residualParamsOffset = residualDataHeaderFloats() + 27u * inputChannels + 3u;
  let residualLimit = residualData[residualParamsOffset + 0u];
  let edgeThreshold = residualData[residualParamsOffset + 1u];
  let strength = residualData[residualParamsOffset + 2u];
  let residualApplyScale = residualData[residualParamsOffset + 3u];
  let signal = edgeSignal(uv, texel, center);
  let mask = smoothstep(edgeThreshold * 0.35, max(edgeThreshold * 1.85, edgeThreshold + 0.0001), signal);
  if (residualData[residualParamsOffset + 4u] > 0.5) {
    return vec4<f32>(debugFeatureView(feature), 1.0);
  }
  let fireAuthority = max(feature.r, max(feature.g * 0.88, feature.b * 0.72));
  let smokeCrunchGuard = 1.0 - smoothstep(0.30, 0.82, feature.a) * (1.0 - smoothstep(0.08, 0.34, fireAuthority));
  let shaderAuthorityMask = clamp(mix(0.18, 1.0, fireAuthority) * smokeCrunchGuard, 0.0, 1.0);
  let limitedResidual = clamp(residual, vec3<f32>(-residualLimit), vec3<f32>(residualLimit));
  return vec4<f32>(clamp(center + limitedResidual * residualApplyScale * mask * shaderAuthorityMask * strength, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

const BOUNDARY_SPLAT_WGSL = `
override GRID: u32 = 64u;
const SLOTS_PER_CELL: u32 = 4u;

struct BoundarySplat {
  positionSupport: vec4<f32>,
  colorOpacity: vec4<f32>,
  shape: vec4<f32>,
};

struct BoundarySplatDraw {
  vertexCount: u32,
  instanceCount: atomic<u32>,
  firstVertex: u32,
  firstInstance: u32,
  candidateCount: atomic<u32>,
  overflowCount: atomic<u32>,
  capacity: u32,
  _pad1: u32,
};

struct BoundarySplatCamera {
  viewProj: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  controls: vec4<f32>,
  calibration: vec4<f32>,
};

struct BoundarySplatVertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) colorOpacity: vec4<f32>,
  @location(1) local: vec2<f32>,
};

struct BoundarySplatAttributeHookOutput {
  colorOpacity: vec4<f32>,
  radiusScale: vec2<f32>,
};

struct BoundarySplatFeatureRow {
  sidecar: vec4<f32>,
  material: vec4<f32>,
  fire: vec4<f32>,
  micro: vec4<f32>,
};

${BOUNDARY_SPLAT_ATTRIBUTE_MODEL_WGSL}

@group(0) @binding(0) var<storage, read> boundarySidecar: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> fluid: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> boundarySplats: array<BoundarySplat>;
@group(0) @binding(3) var<storage, read_write> boundarySplatDraw: BoundarySplatDraw;
@group(0) @binding(4) var<uniform> boundarySplatCamera: BoundarySplatCamera;
@group(0) @binding(5) var<storage, read> boundarySplatsForRender: array<BoundarySplat>;
@group(0) @binding(6) var<storage, read_write> boundarySplatFeatureRows: array<BoundarySplatFeatureRow>;

fn boundarySplatCellIndex(cell: vec3<u32>) -> u32 {
  return cell.x + cell.y * GRID + cell.z * GRID * GRID;
}

fn boundarySplatAttributeFeatures(
  sidecar: vec4<f32>,
  material: vec4<f32>,
  fire: vec4<f32>,
  micro: vec4<f32>,
) -> array<f32, 16> {
  var features: array<f32, 16>;
  features[0] = sidecar.x;  // sidecar.support
  features[1] = sidecar.y;  // sidecar.coverage
  features[2] = sidecar.z;  // sidecar.ridge
  features[3] = sidecar.w;  // sidecar.footprint
  features[4] = material.x; // material.density
  features[5] = material.y; // material.heat
  features[6] = material.z; // material.fuel
  features[7] = material.w; // material.detail
  features[8] = fire.x;     // fire.energy
  features[9] = fire.y;     // fire.temperature
  features[10] = fire.z;    // fire.emission
  features[11] = fire.w;    // fire.detail
  features[12] = micro.x;   // micro.x
  features[13] = micro.y;   // micro.y
  features[14] = micro.z;   // micro.z
  features[15] = micro.w;   // micro.w
  return features;
}

fn applyBoundarySplatAttributeHook(
  analyticColorOpacity: vec4<f32>,
  analyticRadiusScale: vec2<f32>,
  features: array<f32, 16>,
) -> BoundarySplatAttributeHookOutput {
  var result: BoundarySplatAttributeHookOutput;
  if (boundarySplatCamera.controls.y > 0.5) {
    let learned = inferBoundarySplatAttributes(features);
    result.colorOpacity = learned.colorOpacity;
    result.radiusScale = learned.radiusScale;
    return result;
  }
  result.colorOpacity = analyticColorOpacity;
  result.radiusScale = analyticRadiusScale;
  return result;
}

@compute @workgroup_size(4, 4, 4)
fn compactBoundarySplats(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) { return; }
  let cellIndex = boundarySplatCellIndex(gid);
  let sidecar = boundarySidecar[cellIndex];
  let material = fluid[cellIndex * SLOTS_PER_CELL + 1u];
  let fire = fluid[cellIndex * SLOTS_PER_CELL + 2u];
  let micro = fluid[cellIndex * SLOTS_PER_CELL + 3u];
  let fireSignal = fire.x * 1.25 + fire.z * 0.52 + fire.w * 0.86 + micro.z * 0.72 + material.y * 0.24;
  let structuralSignal = sidecar.z * smoothstep(0.055, 0.32, sidecar.y) * smoothstep(0.018, 0.16, fireSignal);
  if (structuralSignal < 0.11) { return; }
  let candidateIndex = atomicAdd(&boundarySplatDraw.candidateCount, 1u);
  if (candidateIndex >= boundarySplatDraw.capacity) {
    atomicAdd(&boundarySplatDraw.overflowCount, 1u);
    return;
  }
  let world = ((vec3<f32>(gid) + vec3<f32>(0.5)) / f32(GRID)) * 2.0 - vec3<f32>(1.0);
  let thermal = smoothstep(0.025, 0.78, material.y + fire.x * 0.28);
  let whiteHot = smoothstep(0.42, 1.25, fireSignal);
  let cool = vec3<f32>(0.05, 0.16, 0.72);
  let warm = vec3<f32>(0.86, 0.38, 0.07);
  let color = mix(mix(cool, warm, thermal), vec3<f32>(0.82, 0.72, 0.48), whiteHot * 0.52);
  let opacity = clamp(structuralSignal * (0.008 + fireSignal * 0.055), 0.002, 0.038);
  let cellWidth = 2.0 / f32(GRID);
  let radius = cellWidth * (0.60 + sidecar.w * 2.65 + sidecar.z * 0.48);
  let attributeFeatures = boundarySplatAttributeFeatures(sidecar, material, fire, micro);
  let attributeOutput = applyBoundarySplatAttributeHook(
    vec4<f32>(color, opacity),
    vec2<f32>(0.72 + sidecar.z * 0.36, 1.0 + sidecar.w * 0.42),
    attributeFeatures,
  );
  if (boundarySplatCamera.controls.z > 0.5) {
    boundarySplatFeatureRows[candidateIndex].sidecar = sidecar;
    boundarySplatFeatureRows[candidateIndex].material = material;
    boundarySplatFeatureRows[candidateIndex].fire = fire;
    boundarySplatFeatureRows[candidateIndex].micro = micro;
  }
  boundarySplats[candidateIndex].positionSupport = vec4<f32>(world, structuralSignal);
  boundarySplats[candidateIndex].colorOpacity = attributeOutput.colorOpacity;
  boundarySplats[candidateIndex].shape = vec4<f32>(radius * attributeOutput.radiusScale.x, radius * attributeOutput.radiusScale.y, sidecar.z, fireSignal);
}

@compute @workgroup_size(1)
fn finalizeBoundarySplats() {
  atomicStore(&boundarySplatDraw.instanceCount, min(atomicLoad(&boundarySplatDraw.candidateCount), boundarySplatDraw.capacity));
}

fn boundarySplatQuadCorner(vertexIndex: u32) -> vec2<f32> {
  let corner = vertexIndex % 6u;
  if (corner == 0u) { return vec2<f32>(-1.0, -1.0); }
  if (corner == 1u) { return vec2<f32>(1.0, -1.0); }
  if (corner == 2u) { return vec2<f32>(-1.0, 1.0); }
  if (corner == 3u) { return vec2<f32>(-1.0, 1.0); }
  if (corner == 4u) { return vec2<f32>(1.0, -1.0); }
  return vec2<f32>(1.0, 1.0);
}

@vertex
fn boundarySplatVs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> BoundarySplatVertexOut {
  let splat = boundarySplatsForRender[instanceIndex];
  let corner = boundarySplatQuadCorner(vertexIndex);
  let offset = boundarySplatCamera.cameraRight.xyz * corner.x * splat.shape.x * boundarySplatCamera.controls.x
    + boundarySplatCamera.cameraUp.xyz * corner.y * splat.shape.y * boundarySplatCamera.controls.x;
  var out: BoundarySplatVertexOut;
  out.position = boundarySplatCamera.viewProj * vec4<f32>(splat.positionSupport.xyz + offset, 1.0);
  out.colorOpacity = splat.colorOpacity;
  out.local = corner;
  return out;
}

@fragment
fn boundarySplatFs(in: BoundarySplatVertexOut) -> @location(0) vec4<f32> {
  let radius2 = dot(in.local, in.local);
  if (radius2 > 1.0) { discard; }
  let footprintRadius = clamp(boundarySplatCamera.controls.x, 0.35, 1.5);
  let kernelSharpness = clamp(boundarySplatCamera.controls.w, 1.0, 12.0);
  let radianceGain = clamp(boundarySplatCamera.calibration.x, 0.0, 8.0);
  let opacityGain = clamp(boundarySplatCamera.calibration.y, 0.0, 8.0);
  let gaussian = exp(-radius2 * kernelSharpness);
  let energyRatio = (kernelSharpness / 3.4) / max(footprintRadius * footprintRadius, 0.1225);
  let energyCompensation = clamp(sqrt(energyRatio), 0.5, 2.5);
  let alpha = in.colorOpacity.a * gaussian * energyCompensation * opacityGain;
  return vec4<f32>(clamp(in.colorOpacity.rgb * radianceGain, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}
`;

export function createKaminosVolumePrototype({ THREE, viewport, camera, controls, getControls, onStatus }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'kaminos-volume-canvas';
  canvas.dataset.prototype = PROTOTYPE_IDENTITY;
  canvas.dataset.routeIdentity = ROUTE_IDENTITY;
  viewport.appendChild(canvas);

  const invViewProj = new THREE.Matrix4();
  const viewProj = new THREE.Matrix4();
  const previousViewProj = new THREE.Matrix4();
  const uniforms = new Float32Array(344);
  let controlsSnapshot = applyRuntimeQualityControls(getControls());
  let gridSize = normalizeGridSize(controlsSnapshot.resolution);
  let majorantGridSize = normalizeMajorantGridSize(controlsSnapshot.majorantGrid);
  let boundarySplatCapacity = Math.min(BOUNDARY_SPLAT_INITIAL_CAPACITY, gridCellCount(gridSize));
  let oracleActivityCueBuffer = null;
  let oracleActivityCueSourceValues = null;
  let oracleActivityCueSourceGrid = null;
  let oracleActivityCueUpload = {
    status: 'none',
    requestedCueAuthority: TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY,
    effectiveCueAuthority: PROCEDURAL_ACTIVITY_CUE_AUTHORITY,
    grid: null,
    externalCueCellCount: 0,
    frameId: null,
    uploadedAtMs: null,
  };
  const state = {
    prototypeIdentity: PROTOTYPE_IDENTITY,
    routeIdentity: ROUTE_IDENTITY,
    requestedRoute: 'kaminos_volume_smoke=1',
    effectiveRoute: ROUTE_IDENTITY,
    selectiveHeadLiveRole: normalizeSelectiveHeadLiveRole(controlsSnapshot.selectiveHeadLiveRole),
    selectiveHeadLiveEffectiveRole: 'off',
    selectiveHeadLiveRoleAuthority: SELECTIVE_HEAD_LIVE_ROLE_AUTHORITIES.off,
    selectiveHeadLiveCompositionRequestedRaw: controlsSnapshot.selectiveHeadLiveRenderComposition || SELECTIVE_HEAD_LIVE_DEFAULT_RENDER_COMPOSITION,
    selectiveHeadLiveCompositionRequested: SELECTIVE_HEAD_LIVE_DEFAULT_RENDER_COMPOSITION,
    selectiveHeadLiveCompositionEffective: 'off',
    selectiveHeadLiveCompositionAuthority: 'off',
    selectiveHeadLiveCompositionFallbackReason: null,
    selectiveHeadLivePassReceipt: makeSelectiveHeadLivePassReceipt({
      composition: SELECTIVE_HEAD_LIVE_DEFAULT_RENDER_COMPOSITION,
    }),
    selectiveHeadLiveRouteIdentity: SELECTIVE_HEAD_LIVE_ROUTE,
    selectiveHeadLiveModelIdentity: SELECTIVE_HEAD_LIVE_MODEL.identity,
    selectiveHeadLiveModelUrl: SELECTIVE_HEAD_LIVE_MODEL_URL,
    selectiveHeadLiveFeatureAuthority: SELECTIVE_HEAD_LIVE_FEATURE_AUTHORITY,
    selectiveHeadLivePairAuthority: SELECTIVE_HEAD_LIVE_PAIR_AUTHORITY,
    selectiveHeadLiveFallbackReason: null,
    selectiveHeadLiveReplayAnchor: null,
    selectiveHeadLiveCapturePaused: false,
    selectiveHeadLive: null,
    backend: 'inactive',
    active: false,
    width: 0,
    height: 0,
    cssWidth: 0,
    cssHeight: 0,
    displayWidth: 0,
    displayHeight: 0,
    nativeDevicePixelRatio: 1,
    canvasDevicePixelRatio: 1,
    viewportSizeFallback: false,
    renderWidth: 0,
    renderHeight: 0,
    renderScale: normalizeRenderScale(controlsSnapshot.renderScale),
    renderPixelRatio: 1,
    volumeReconstructionStyle: 'linear-css-upscale',
    volumeResidualMode: normalizeBrowserResidualMode(controlsSnapshot.volumeResidualMode),
    volumeResidualModelUrl: String(controlsSnapshot.volumeResidualModelUrl || ''),
    volumeResidualStatus: 'off',
    volumeResidualAuthority: 'off',
    volumeResidualFeatureAuthority: 'off',
    volumeResidualFeatureDebug: normalizeBrowserResidualFeatureDebug(controlsSnapshot.volumeResidualFeatureDebug),
    volumeResidualFeatureDebugMode: normalizeBrowserResidualFeatureDebug(controlsSnapshot.volumeResidualFeatureDebug) ? 'residual-feature-debug-false-color-v0' : 'off',
    volumeResidualModelSchema: null,
    volumeResidualModelError: null,
    volumeResidualStrength: normalizeBrowserResidualStrength(controlsSnapshot.volumeResidualStrength),
    volumeResidualCost: {
      identity: 'browser-direct-residual-cost-v0',
      applied: false,
      evidenceSource: 'cpu-encode-proxy-not-gpu-exclusive',
      disclaimer: 'CPU render-pass encode timing plus deterministic work counts; not isolated GPU execution time.',
      outputPixels: 0,
      renderWidth: 0,
      renderHeight: 0,
      sourcePassEncodeMs: null,
      residualPassEncodeMs: null,
      totalEncodeMs: null,
      sourcePassEncodeP95Ms: null,
      residualPassEncodeP95Ms: null,
      totalEncodeP95Ms: null,
      renderPassesAdded: 0,
      estimatedTextureSamplesPerPixel: 0,
      estimatedTextureSamplesPerFrame: 0,
      featureSamplesPerFrame: 0,
      estimatedKernelSamplesPerPixel: 0,
      estimatedKernelSamplesPerFrame: 0,
      estimatedMultiplyAddsPerPixel: 0,
      estimatedMultiplyAddsPerFrame: 0,
      modelArch: null,
      modelUrl: null,
      authority: 'off',
    },
    volumeScene: normalizeVolumeScene(controlsSnapshot.volumeScene),
    frameCount: 0,
    simStepCount: 0,
    lookFreeze: normalizeLookFreeze(controlsSnapshot.lookFreeze),
    lookFreezeFrame: null,
    lookFreezeTimeSeconds: null,
    lookFreezeRenderTimeMs: null,
    lookFreezeRenderFrame: null,
    lookFreezeSkippedFrames: 0,
    renderPhaseTimeMs: null,
    renderPhaseFrame: 0,
    renderPhaseAuthority: 'live-render-phase',
    pyroCompareMode: normalizePyroCompareMode(controlsSnapshot.pyroCompareMode),
    pyroCompareMuted: false,
    simGrid: gridSize,
    simGridLabel: `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer+${FRONT_FIELD_IDENTITY}`,
    gridOverlay: 0,
    adaptiveRaymarch: 0.65,
    occupancySkip: 0.35,
    majorantSkip: 0.70,
    majorantSmooth: 0.85,
    majorantGuard: 0.75,
    temporalAccum: 0.25,
    temporalJitter: 0.85,
    historyClamp: 0.70,
    fireScale: 0.86,
    detailScale: 1.75,
    detailScaleArtifactQuarantine: detailScaleArtifactQuarantine(controlsSnapshot.volumeScene),
    visibleDetailOverlayGain: detailScaleArtifactQuarantine(controlsSnapshot.volumeScene) ? 0.35 : 1,
    reactionFuelScale: normalizeReactionFuelScale(controlsSnapshot.reactionFuelScale),
    lifecycleEffect: normalizeLifecycleEffect(controlsSnapshot.lifecycleEffect),
    lifecycleT: normalizeLifecycleT(controlsSnapshot.lifecycleT),
    quenchVapor: normalizeQuenchVapor(controlsSnapshot.quenchVapor),
    quenchVaporStrength: snuffQuenchVaporStrength(controlsSnapshot),
    snuffVisualModel: snuffQuenchVaporStrength(controlsSnapshot) > 0 ? 'quench-vapor-v0' : 'inactive',
    flameQuenchModel: snuffQuenchVaporStrength(controlsSnapshot) > 0 ? 'quench-flame-body-v0' : 'inactive',
    runtimeQualityRequested: normalizeRuntimeQuality(controlsSnapshot.runtimeQualityRequested),
    runtimeQualityEffective: normalizeRuntimeQuality(controlsSnapshot.runtimeQualityEffective || controlsSnapshot.runtimeQualityRequested),
    gpuPressure: clampFinite(controlsSnapshot.gpuPressure, 0, 1, 0),
    runtimeQualityReason: String(controlsSnapshot.runtimeQualityReason || 'unspecified').slice(0, 96) || 'unspecified',
    runtimeQualityReceipt: runtimeQualityReceipt(controlsSnapshot),
    tallPlumeReactionCadenceDebug: normalizeVolumeScene(controlsSnapshot.volumeScene) === 'tall_plume' ? 'source-reaction-cadence-v0' : 'inactive',
    tallPlumeFlameCutoffContract: normalizeVolumeScene(controlsSnapshot.volumeScene) === 'tall_plume' ? 'tall-plume-speed-cutoff-decoupled-v0' : 'inactive',
    tallPlumeFlowShelfContract: normalizeVolumeScene(controlsSnapshot.volumeScene) === 'tall_plume' ? 'tall-plume-flow-shelf-mitigated-v0' : 'inactive',
    tallPlumeFlameHeightLawContract: normalizeVolumeScene(controlsSnapshot.volumeScene) === 'tall_plume' ? 'tall-plume-flame-height-law-v2' : 'inactive',
    plumeHeight: 1.45,
    windStrength: normalizeWindStrength(controlsSnapshot.windStrength),
    windAngle: normalizeWindAngle(controlsSnapshot.windAngle),
    windHeight: normalizeWindHeight(controlsSnapshot.windHeight),
    bonfireAblation: normalizeBonfireAblationControls(controlsSnapshot),
    bonfireReferenceConfinement: bonfireReferenceConfinementDebug(controlsSnapshot.volumeScene),
    minimalPlumeProof: minimalPlumeProofDebug(controlsSnapshot.volumeScene),
    pressureProjectionEnabled: false,
    pressureEffectiveLabel: controlsSnapshot.pressureEffectiveLabel || '',
    pressureProjectionIterations: 0,
    pressureIterationDefault: defaultPressureIterationsForScene(controlsSnapshot.volumeScene),
    pressureIterationRequested: defaultPressureIterationsForScene(controlsSnapshot.volumeScene),
    externalEmitterMode: 'off',
    externalEmitterCoordinateSpace: 'none',
    externalEmitterCount: 0,
    externalEmitterAgeMs: null,
    externalEmitterFrameId: null,
    scalarActivityReceiver: null,
    nativeLowSelectiveSharedDevice: null,
    nativeLowTreatmentSplatCalibration: null,
    temporalAccumEffective: 0,
    temporalReprojectionConfidence: 0,
    temporalHistoryWeight: 0,
    temporalRejectedHistory: 1,
    temporalSmokeHistoryTrust: 0,
    temporalFireHistoryProtect: 0,
    temporalInterfaceHistoryProtect: 0,
    temporalEvidenceSource: 'cpu-estimate-control-proxy',
    temporalHistoryFrames: 0,
    temporalHistoryResetCount: 0,
    temporalHistoryResetReason: 'initial',
    temporalHistoryValid: false,
    fluidStateResetCount: 0,
    fluidStateResetReason: 'initial',
    nativeLowSourceHistoryEpochCount: 0,
    nativeLowSourceHistoryEpochReason: 'initial',
    majorantGrid: majorantGridSize,
    majorantBuilt: false,
    majorantFrameCount: 0,
    majorantCadence: normalizeMajorantBuildCadence(controlsSnapshot.majorantCadence),
    majorantBuiltThisFrame: false,
    majorantLastBuiltFrame: -1,
    majorantSkippedFrameCount: 0,
    boundarySidecarIdentity: BOUNDARY_SIDECAR_IDENTITY,
    boundarySidecarAuthority: BOUNDARY_SIDECAR_BAKE_AUTHORITY,
    boundarySidecarBytes: boundarySidecarBufferBytes(gridSize),
    boundarySidecarSource: normalizeBoundarySidecarSource(controlsSnapshot.boundarySidecarSource),
    boundarySidecarBuilt: false,
    boundarySidecarBuiltThisFrame: false,
    boundarySidecarFrameCount: 0,
    boundarySidecarLastBuiltFrame: -1,
    boundaryStructureSource: normalizeBoundarySidecarSource(controlsSnapshot.boundarySidecarSource),
    boundarySidecarView: normalizeBoundarySidecarView(controlsSnapshot.boundarySidecarView ?? controlsSnapshot.boundarySidecarControls?.view),
    boundarySidecarDebug: null,
    boundarySidecarOverrideReceipt: null,
    boundarySplatMode: normalizeBoundarySplatMode(controlsSnapshot.boundarySplatMode),
    boundarySplatRadius: normalizeBoundarySplatRadius(controlsSnapshot.boundarySplatRadius),
    boundarySplatSharpness: normalizeBoundarySplatSharpness(controlsSnapshot.boundarySplatSharpness),
    boundarySplatRendererIdentity: boundarySplatEffectiveRendererIdentity(controlsSnapshot.boundarySplatMode),
    boundarySplatAttributeModelIdentity: boundarySplatEffectiveAttributeModelIdentity(controlsSnapshot.boundarySplatMode),
    boundarySplatFeatureCaptureRequested: normalizeBoundarySplatFeatureCapture(controlsSnapshot.boundarySplatFeatureCapture),
    boundarySplatFeatureCaptureEffective: false,
    boundarySplatFeatureCaptureIdentity: BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY,
    boundarySplatFeatureCapture: null,
    boundarySplatSourceAuthority: BOUNDARY_SPLAT_SOURCE_AUTHORITY,
    boundarySplatCapacity: boundarySplatCapacity,
    boundarySplatCapacityGrowthCount: 0,
    boundarySplatCapacityGrowth: null,
    boundarySplatCandidateCount: null,
    boundarySplatOverflowCount: null,
    boundarySplatCountAuthority: 'gpu-indirect-async-readback',
    boundarySplatInstanceCount: null,
    boundarySplatFallbackReason: null,
    boundarySplatFrameCount: 0,
    boundarySplatTimestampStatus: 'unsupported',
    boundarySplatGpuProfile: makeBoundarySplatGpuProfile({
      timestampStatus: 'unsupported',
      reason: 'timestamp-query-not-requested-yet',
      candidateCopyBytes: 0,
      rendererIdentity: boundarySplatEffectiveRendererIdentity(controlsSnapshot.boundarySplatMode),
    }),
    boundarySplatCopyBytesThisFrame: 0,
    boundarySplatCopyDisposition: makeBoundarySplatCopyDisposition(0, boundarySplatEffectiveRendererIdentity(controlsSnapshot.boundarySplatMode)),
    simProfile: normalizeSimProfileFlag(controlsSnapshot.simProfile),
    simCostLedger: null,
    pressureSourceStrategy: PRESSURE_SOURCE_STRATEGY_DISABLED,
    tallPlumePressureIterationStrategy: TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE,
    tallPlumePressureIterationTarget: 0,
    pressureStrategy: normalizePressureStrategy(controlsSnapshot.pressureStrategy, controlsSnapshot.volumeScene),
    tallPlumePressureTierStrategy: TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE,
    pressureProjectionReadStrategy: PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER,
    pressureJacobiFullGridPasses: 0,
    pressureJacobiPartialSlabPasses: 0,
    pressureJacobiFullGridEquivalentPasses: 0,
    pressureTierRequestedBounds: null,
    pressureTierEffectiveBounds: null,
    pressureTierOverlayOpacity: DEFAULT_PRESSURE_TIER_OVERLAY,
    pyroMaterialRendererCoupling: {
      identity: 'pyro-material-memory-spatial-coupling-v0',
      lineage: 'pyro-material-memory-render-coupling-v0',
      visualRole: 'opt-in-renderer-diagnostic-not-main-fire-authority',
      requestedGain: 0,
      effectiveGain: 0,
      materialShaderReadiness: 'blocked-reset',
      energy: 0,
      liveFireAuthority: 0,
      smokeAuthority: 0,
      spatialMemory: {
        identity: 'pyro-material-memory-spatial-coupling-v0',
        textureLayout: { ...PYRO_DYNAMIC_DETAIL_TEXTURE_LAYOUT },
        uploadedCells: 0,
      },
    },
    pressureTierDispatches: [],
    pressureTierBounds: null,
    pressureTierBufferOwnership: null,
    volumePrimitiveCount: 0,
    volumePrimitiveIds: [],
    volumePrimitives: [],
    mainFluidKernelStrategy: MAIN_FLUID_KERNEL_STRATEGY_ZERO_FIRE_LICK_BYPASS,
    mainFluidLocalProjectionStrategy: MAIN_FLUID_LOCAL_PROJECTION_STRATEGY_STAGED_PRESSURE_ONLY,
    mainFluidLocalProjectionDivergenceEvaluationsPerCell: 0,
    fireLickBreakupEnabled: false,
    fireLickBreakupEvaluationsPerCell: 0,
    fireLickOperatorGain: 0,
    pressureDivergencePasses: 0,
    pressureJacobiInlineDivergencePasses: 0,
    fullGridPassBreakdown: null,
    fullFieldExportSession: null,
    fullFieldImportReceipt: null,
    frontFieldIdentity: FRONT_FIELD_IDENTITY,
    frontFieldBytes: frontFieldBufferBytes(gridSize),
    frontFieldReadIndex: 0,
    frontFieldWriteIndex: 1,
    frontFieldProjectionPassthrough: false,
    pyroDynamicDetail: {
      identity: PYRO_DYNAMIC_DETAIL_ATLAS_IDENTITY,
      authoritySource: PYRO_DYNAMIC_DETAIL_AUTHORITY_SOURCE,
      resetPolicy: PYRO_DYNAMIC_DETAIL_RESET_POLICY,
      updateRule: 'pyro-cellular-detail-memory-deterministic-ca-v0',
      visualRole: 'debug-atlas-only-not-main-fire',
      enabled: normalizePyroDynamicDetailEnabled(controlsSnapshot.pyroDynamicDetail),
      confidence: 0,
      liveFireAuthority: 0,
      smokeAuthority: 0,
      stateEnergy: 0,
      statePhase: 0,
      resetGate: true,
      resetReasons: ['disabled'],
      lastUpdateFrame: 0,
      lastInputKind: 'initial',
      atlasCells: new Array(24).fill(0),
      materialMemory: {
        identity: PYRO_DYNAMIC_DETAIL_MATERIAL_CONTRACT,
        authoritySource: PYRO_DYNAMIC_DETAIL_AUTHORITY_SOURCE,
        resetPolicy: PYRO_DYNAMIC_DETAIL_RESET_POLICY,
        visualRole: 'renderer-adjacent-detail-memory-not-main-fire',
        textureLayout: { ...PYRO_DYNAMIC_DETAIL_TEXTURE_LAYOUT },
        shaderReadiness: 'blocked-reset',
        sampleVector4: new Array(24).fill(0).map(() => [0, 0, 0, 0]),
        energyMean: 0,
      },
    },
    lastFrameEnergy: 0,
    timing: {
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      rafFps: 0,
      frameDeltaMs: 0,
      frameP95Ms: 0,
      cpuFrameMs: 0,
      cpuFrameP95Ms: 0,
      queueDoneMs: null,
      queueDoneP95Ms: null,
      queueProbePending: false,
      queueSamples: 0,
      queueTimingAvailable: false,
    },
    error: null,
  };

  let pyroDynamicDetailEnergy = 0;
  let pyroDynamicDetailConfidence = 0;
  let pyroDynamicDetailPhase = 0;
  let pyroDynamicDetailAtlasCells = new Array(24).fill(0);
  let pyroDynamicDetailLastInputMs = -Infinity;
  let pyroDynamicDetailLastReadbackFrame = -1;
  let pyroDynamicDetailLastReadbackMs = -Infinity;

  function clonePyroDynamicDetail() {
    const detail = state.pyroDynamicDetail || {};
    return {
      ...detail,
      resetReasons: Array.isArray(detail.resetReasons) ? [...detail.resetReasons] : [],
      atlasCells: Array.isArray(detail.atlasCells) ? [...detail.atlasCells] : [],
      materialMemory: detail.materialMemory
        ? {
            ...detail.materialMemory,
            textureLayout: detail.materialMemory.textureLayout ? { ...detail.materialMemory.textureLayout } : null,
            sampleVector4: Array.isArray(detail.materialMemory.sampleVector4)
              ? detail.materialMemory.sampleVector4.map(sample => Array.isArray(sample) ? [...sample] : sample)
              : [],
          }
        : null,
    };
  }

  function buildPyroDynamicDetailMaterialMemory({
    atlasCells,
    resetGate,
    confidence,
    liveFireAuthority,
    smokeAuthority,
    stateEnergy,
  }) {
    const usable = !resetGate;
    const sampleVector4 = new Array(PYRO_DYNAMIC_DETAIL_TEXTURE_LAYOUT.width * PYRO_DYNAMIC_DETAIL_TEXTURE_LAYOUT.height)
      .fill(0)
      .map((_, index) => {
        const energy = usable ? clampFinite(atlasCells[index], 0, 1, 0) : 0;
        return [
          energy,
          usable ? clampFinite(confidence, 0, 1, 0) : 0,
          usable ? clampFinite(liveFireAuthority, 0, 1, 0) : 0,
          usable ? clampFinite(smokeAuthority, 0, 1, 0) : 0,
        ];
      });
    return {
      identity: PYRO_DYNAMIC_DETAIL_MATERIAL_CONTRACT,
      authoritySource: PYRO_DYNAMIC_DETAIL_AUTHORITY_SOURCE,
      resetPolicy: PYRO_DYNAMIC_DETAIL_RESET_POLICY,
      visualRole: 'renderer-adjacent-detail-memory-not-main-fire',
      textureLayout: { ...PYRO_DYNAMIC_DETAIL_TEXTURE_LAYOUT },
      shaderReadiness: resetGate ? 'blocked-reset' : 'sampleable-debug-only',
      sampleVector4,
      energyMean: usable ? clampFinite(stateEnergy, 0, 1, 0) : 0,
    };
  }

  function updatePyroDynamicDetailState({ simReadback = null, inputKind = 'control-proxy' } = {}) {
    const now = performance.now();
    if (simReadback) {
      pyroDynamicDetailLastReadbackFrame = state.frameCount;
      pyroDynamicDetailLastReadbackMs = now;
    }
    if (simReadback || (inputKind === 'control-proxy' && state.active)) {
      pyroDynamicDetailLastInputMs = now;
    }
    const enabled = normalizePyroDynamicDetailEnabled(controlsSnapshot.pyroDynamicDetail);
    const scene = normalizeVolumeScene(controlsSnapshot.volumeScene);
    const reactionFuel = normalizeReactionFuelScale(controlsSnapshot.reactionFuelScale);
    const quench = snuffQuenchVaporStrength(controlsSnapshot);
    const contentMode = normalizeCanonicalContentMode(controlsSnapshot.canonicalContentMode);
    const fireControl = Math.max(
      0,
      Number(controlsSnapshot.fire || 0),
      Number(controlsSnapshot.radiance || 0) * 0.55,
      Number(controlsSnapshot.glow || 0) * 0.35,
      contentMode === 'fire' || contentMode === 'fire_smoke' ? 0.7 : 0,
    );
    const smokeControl = Math.max(
      0,
      Number(controlsSnapshot.smoke || 0) * 0.28,
      Number(controlsSnapshot.density || 0) * 0.08,
    );
    const fieldFire = Math.max(
      0,
      Number(simReadback?.fireLayerMean || 0) * 8,
      Number(simReadback?.radianceMean || 0) * 5,
      Number(simReadback?.combustionFrontMean || 0) * 4,
      Number(simReadback?.frontTopologyMean || 0) * 2,
    );
    const fieldSmoke = Math.max(
      0,
      Number(simReadback?.smokeMean || 0) * 2,
      Number(simReadback?.densityMean || 0) * 2,
      Number(simReadback?.extinctionMean || 0) * 3,
      smokeControl,
    );
    const rawLiveFireAuthority = clampFinite(simReadback ? fieldFire : fireControl, 0, 1, 0);
    const smokeAuthority = clampFinite(fieldSmoke, 0, 1, 0);
    const resetReasons = [];
    if (!enabled) resetReasons.push('disabled');
    if (reactionFuel <= 0.0005) resetReasons.push('fuel-off');
    if (quench > 0.01 || normalizeLifecycleEffect(controlsSnapshot.lifecycleEffect) === 'snuff') resetReasons.push('snuff-quench');
    if (rawLiveFireAuthority <= 0.015) resetReasons.push('no-live-fire-authority');
    if (state.frameCount > 20 && now - pyroDynamicDetailLastInputMs > 3000) resetReasons.push('stale-input');
    const resetGate = resetReasons.includes('disabled')
      || resetReasons.includes('fuel-off')
      || resetReasons.includes('snuff-quench')
      || resetReasons.includes('no-live-fire-authority')
      || resetReasons.includes('stale-input');
    const liveFireAuthority = resetGate ? 0 : rawLiveFireAuthority;
    if (resetGate) {
      pyroDynamicDetailEnergy = 0;
      pyroDynamicDetailConfidence = 0;
      pyroDynamicDetailAtlasCells = pyroDynamicDetailAtlasCells.map(cell => cell * (1 - PYRO_DYNAMIC_DETAIL_CELL_BLEND));
    } else if (liveFireAuthority > 0.015) {
      pyroDynamicDetailEnergy = clampFinite(pyroDynamicDetailEnergy * 0.84 + liveFireAuthority * 0.22 + smokeAuthority * 0.04, 0, 1, 0);
      pyroDynamicDetailConfidence = clampFinite(pyroDynamicDetailConfidence * 0.78 + liveFireAuthority * 0.24, 0, 1, 0);
    } else {
      pyroDynamicDetailEnergy = clampFinite(pyroDynamicDetailEnergy * 0.68, 0, 1, 0);
      pyroDynamicDetailConfidence = clampFinite(pyroDynamicDetailConfidence * 0.62, 0, 1, 0);
    }
    pyroDynamicDetailPhase = (
      pyroDynamicDetailPhase
      + PYRO_DYNAMIC_DETAIL_PHASE_BASE_STEP
      + liveFireAuthority * PYRO_DYNAMIC_DETAIL_PHASE_FIRE_STEP
      + smokeAuthority * PYRO_DYNAMIC_DETAIL_PHASE_SMOKE_STEP
    ) % 1024;
    const targetAtlasCells = new Array(24).fill(0).map((_, index) => {
      const x = index % 8;
      const y = Math.floor(index / 8);
      const wave = 0.5 + 0.5 * Math.sin(pyroDynamicDetailPhase * 6.283 + x * 1.73 + y * 2.11);
      const neighbor = 0.5 + 0.5 * Math.sin(pyroDynamicDetailPhase * 3.71 + x * 0.79 - y * 1.39);
      return clampFinite(pyroDynamicDetailEnergy * (0.28 + wave * 0.54 + neighbor * 0.18), 0, 1, 0);
    });
    pyroDynamicDetailAtlasCells = targetAtlasCells.map((target, index) => {
      const previous = resetGate ? 0 : clampFinite(pyroDynamicDetailAtlasCells[index], 0, 1, 0);
      return clampFinite(previous * (1 - PYRO_DYNAMIC_DETAIL_CELL_BLEND) + target * PYRO_DYNAMIC_DETAIL_CELL_BLEND, 0, 1, 0);
    });
    const atlasCells = resetGate ? new Array(24).fill(0) : [...pyroDynamicDetailAtlasCells];
    state.pyroDynamicDetail = {
      identity: PYRO_DYNAMIC_DETAIL_ATLAS_IDENTITY,
      authoritySource: PYRO_DYNAMIC_DETAIL_AUTHORITY_SOURCE,
      resetPolicy: PYRO_DYNAMIC_DETAIL_RESET_POLICY,
      updateRule: 'pyro-cellular-detail-memory-deterministic-ca-v0',
      visualRole: 'debug-atlas-only-not-main-fire',
      enabled,
      confidence: pyroDynamicDetailConfidence,
      liveFireAuthority,
      smokeAuthority,
      stateEnergy: pyroDynamicDetailEnergy,
      statePhase: pyroDynamicDetailPhase,
      resetGate,
      resetReasons,
      lastUpdateFrame: state.frameCount,
      lastInputAgeMs: Number.isFinite(pyroDynamicDetailLastInputMs) ? Math.max(0, now - pyroDynamicDetailLastInputMs) : null,
      lastReadbackFrame: pyroDynamicDetailLastReadbackFrame,
      lastReadbackAgeMs: Number.isFinite(pyroDynamicDetailLastReadbackMs) ? Math.max(0, now - pyroDynamicDetailLastReadbackMs) : null,
      lastInputKind: inputKind,
      atlasCells,
      materialMemory: buildPyroDynamicDetailMaterialMemory({
        atlasCells,
        resetGate,
        confidence: pyroDynamicDetailConfidence,
        liveFireAuthority,
        smokeAuthority,
        stateEnergy: pyroDynamicDetailEnergy,
      }),
    };
    return state.pyroDynamicDetail;
  }

  let adapter = null;
  let device = null;
  let context = null;
  let pipeline = null;
  let readbackPipeline = null;
  let browserResidualPipeline = null;
  let browserResidualSourcePipeline = null;
  let browserResidualBindGroupLayout = null;
  let browserResidualPipelineLayout = null;
  let browserResidualShader = null;
  let browserResidualSampler = null;
  let browserResidualBuffer = null;
  let browserResidualBufferSize = 0;
  let browserResidualBindGroup = null;
  let browserResidualTextureKey = '';
  let browserResidualModel = null;
  let browserResidualModelUrl = '';
  let browserResidualLoadPromise = null;
  let computePipeline = null;
  let pressureDivergencePipeline = null;
  let pressureJacobiPipeline = null;
  let pressureJacobiTieredLowerPipeline = null;
  let pressureJacobiTieredHeroPipeline = null;
  let pressureProjectPipeline = null;
  let pressureProjectTieredPipeline = null;
  let majorantComputePipeline = null;
  let boundarySidecarBuildPipeline = null;
  let boundarySplatCompactPipeline = null;
  let boundarySplatFinalizePipeline = null;
  let boundarySplatRenderPipeline = null;
  let boundarySplatReadbackPipeline = null;
  let bindGroups = [];
  let majorantFrontBindGroups = [];
  let boundarySidecarReadBindGroups = [];
  let pressureWriteBindGroup = null;
  let pressureJacobiBindGroups = [];
  let pressureReadBindGroups = [];
  let majorantWriteBindGroup = null;
  let boundarySidecarWriteBindGroup = null;
  let boundarySplatComputeBindGroups = [];
  let boundarySplatRenderBindGroup = null;
  let selectiveHeadLiveRuntime = null;
  let selectiveHeadLiveBindGroups = null;
  const nativeLowSelectiveSharedRuntimes = new Map();
  let bindGroupLayout = null;
  let majorantFluidBindGroupLayout = null;
  let majorantWriteBindGroupLayout = null;
  let boundarySidecarReadBindGroupLayout = null;
  let boundarySidecarWriteBindGroupLayout = null;
  let boundarySplatComputeBindGroupLayout = null;
  let boundarySplatRenderBindGroupLayout = null;
  let pressureWriteBindGroupLayout = null;
  let pressureJacobiBindGroupLayout = null;
  let pressureReadBindGroupLayout = null;
  let emptyBindGroupLayout = null;
  let pipelineLayout = null;
  let majorantPipelineLayout = null;
  let boundarySidecarPipelineLayout = null;
  let boundarySplatComputePipelineLayout = null;
  let boundarySplatRenderPipelineLayout = null;
  let pressureWritePipelineLayout = null;
  let pressureJacobiPipelineLayout = null;
  let pressureJacobiTieredPipelineLayout = null;
  let pressureProjectPipelineLayout = null;
  let pressureProjectTieredPipelineLayout = null;
  let shader = null;
  let boundarySplatShader = null;
  let uniformBuffer = null;
  let externalEmitterBuffer = null;
  let externalEmitterState = normalizeExternalEmitters();
  let volumePrimitives = [];
  let majorantBuffer = null;
  let boundarySidecarBuffer = null;
  let boundarySidecarOverrideUpload = null;
  let debugFullFieldImportUpload = null;
  let boundarySplatBuffer = null;
  let boundarySplatDrawBuffer = null;
  let boundarySplatIndirectBuffer = null;
  let boundarySplatCameraBuffer = null;
  let boundarySplatReadbackBuffer = null;
  let boundarySplatFeatureBuffer = null;
  let boundarySplatFeatureBufferCapacity = 0;
  let boundarySplatTelemetryCopyPending = false;
  let boundarySplatTelemetryMapPending = false;
  let fluidBuffers = [];
  let frontBuffers = [];
  let pressureBuffers = [];
  let currentFluid = 0;
  let currentFront = 0;
  let frameTexture = null;
  let frameTextureSize = '';
  let browserResidualFeatureTexture = null;
  let browserResidualFeatureTextureSize = '';
  let historyTexture = null;
  let historyTextureSize = '';
  let historySampler = null;
  let historyValid = false;
  let previousViewProjReady = false;
  let lastTemporalCameraSignature = '';
  let lastTemporalControlSignature = '';
  let format = null;
  let raf = 0;
  let selectiveHeadLiveCapturePaused = false;
  const timingSamples = {
    rafDelta: [],
    cpuFrame: [],
    queueDone: [],
    residualSourceEncode: [],
    residualEncode: [],
    residualTotalEncode: [],
  };
  let lastRafNow = 0;
  let queueProbePending = false;

  function pushTimingSample(name, value, maxSamples = 120) {
    if (!Number.isFinite(value)) return;
    const samples = timingSamples[name];
    samples.push(value);
    if (samples.length > maxSamples) samples.shift();
  }

  function percentileTiming(samples, percentile) {
    if (!samples.length) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
    return sorted[index];
  }

  function recordVolumeFrameTiming(now, cpuFrameMs) {
    if (lastRafNow > 0) pushTimingSample('rafDelta', now - lastRafNow);
    lastRafNow = now;
    pushTimingSample('cpuFrame', cpuFrameMs);
    const rafP95 = percentileTiming(timingSamples.rafDelta, 0.95);
    const cpuP95 = percentileTiming(timingSamples.cpuFrame, 0.95);
    state.timing = {
      ...state.timing,
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      rafFps: rafP95 ? 1000 / rafP95 : 0,
      frameDeltaMs: timingSamples.rafDelta.at(-1) ?? 0,
      frameP95Ms: rafP95 ?? 0,
      cpuFrameMs,
      cpuFrameP95Ms: cpuP95 ?? 0,
      queueProbePending,
      queueSamples: timingSamples.queueDone.length,
    };
  }

  function recordVolumeQueueTiming(submittedAt) {
    const queueDoneMs = performance.now() - submittedAt;
    pushTimingSample('queueDone', queueDoneMs, 80);
    state.timing = {
      ...state.timing,
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      queueDoneMs,
      queueDoneP95Ms: percentileTiming(timingSamples.queueDone, 0.95),
      queueProbePending: queueProbePending,
      queueSamples: timingSamples.queueDone.length,
      queueTimingAvailable: true,
    };
  }

  function residualWorkEstimate(applied) {
    const outputPixels = applied ? Math.max(0, Math.floor(state.width || 0) * Math.floor(state.height || 0)) : 0;
    const inputChannels = applied ? Math.max(3, Math.min(7, Number(browserResidualModel?.inputChannels) || 3)) : 0;
    const featureInputChannels = Math.max(0, inputChannels - 3);
    const textureSamplesPerPixel = applied ? 9 * (1 + (featureInputChannels > 0 ? 1 : 0)) + 6 : 0;
    const kernelSamplesPerPixel = applied ? 9 : 0;
    const multiplyAddsPerPixel = applied ? 27 * inputChannels : 0;
    return {
      outputPixels,
      renderWidth: applied ? state.width : 0,
      renderHeight: applied ? state.height : 0,
      browserResidualInputChannels: inputChannels,
      featureInputChannels,
      renderPassesAdded: applied ? 2 : 0,
      estimatedTextureSamplesPerPixel: textureSamplesPerPixel,
      estimatedTextureSamplesPerFrame: outputPixels * textureSamplesPerPixel,
      featureSamplesPerFrame: applied ? outputPixels : 0,
      estimatedKernelSamplesPerPixel: kernelSamplesPerPixel,
      estimatedKernelSamplesPerFrame: outputPixels * kernelSamplesPerPixel,
      estimatedMultiplyAddsPerPixel: multiplyAddsPerPixel,
      estimatedMultiplyAddsPerFrame: outputPixels * multiplyAddsPerPixel,
    };
  }

  function recordBrowserResidualCost({ applied, sourcePassEncodeMs = null, residualPassEncodeMs = null } = {}) {
    const totalEncodeMs = applied ? (sourcePassEncodeMs || 0) + (residualPassEncodeMs || 0) : null;
    if (applied) {
      pushTimingSample('residualSourceEncode', sourcePassEncodeMs, 120);
      pushTimingSample('residualEncode', residualPassEncodeMs, 120);
      pushTimingSample('residualTotalEncode', totalEncodeMs, 120);
    }
    state.volumeResidualCost = {
      identity: 'browser-direct-residual-cost-v0',
      applied: Boolean(applied),
      evidenceSource: 'cpu-encode-proxy-not-gpu-exclusive',
      disclaimer: 'CPU render-pass encode timing plus deterministic work counts; not isolated GPU execution time.',
      ...residualWorkEstimate(Boolean(applied)),
      sourcePassEncodeMs: applied ? sourcePassEncodeMs : null,
      residualPassEncodeMs: applied ? residualPassEncodeMs : null,
      totalEncodeMs,
      sourcePassEncodeP95Ms: applied ? percentileTiming(timingSamples.residualSourceEncode, 0.95) : null,
      residualPassEncodeP95Ms: applied ? percentileTiming(timingSamples.residualEncode, 0.95) : null,
      totalEncodeP95Ms: applied ? percentileTiming(timingSamples.residualTotalEncode, 0.95) : null,
      modelArch: applied ? browserResidualModel?.modelArch || null : null,
      featureInputMode: applied ? browserResidualModel?.featureInputMode || 'rgb' : null,
      modelUrl: applied ? browserResidualModel?.url || state.volumeResidualModelUrl || null : null,
      authority: applied ? state.volumeResidualAuthority : 'off',
    };
  }

  function probeVolumeQueueTiming() {
    if (queueProbePending || !device?.queue?.onSubmittedWorkDone) return;
    queueProbePending = true;
    state.timing = {
      ...state.timing,
      timingEvidenceSource: 'raf-and-queue-proxy',
      timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
      queueProbePending: true,
      queueTimingAvailable: true,
    };
    const submittedAt = performance.now();
    device.queue.onSubmittedWorkDone()
      .then(() => recordVolumeQueueTiming(submittedAt))
      .catch(error => {
        state.timing = {
          ...state.timing,
          timingEvidenceSource: 'raf-and-queue-proxy',
          timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
          queueTimingAvailable: false,
          queueTimingError: error?.message || String(error),
        };
      })
      .finally(() => {
        queueProbePending = false;
        state.timing = {
          ...state.timing,
          timingEvidenceSource: 'raf-and-queue-proxy',
          timingDisclaimer: 'not-gpu-exclusive-or-present-latency',
          queueProbePending: false,
        };
      });
  }

  function emitStatus(extra = {}) {
    onStatus?.({ ...state, ...extra });
  }

  function updateExternalEmitterDebug(nowMs = externalEmitterNowMs()) {
    state.externalEmitterMode = externalEmitterState.mode;
    state.externalEmitterCoordinateSpace = externalEmitterState.coordinateSpace;
    state.externalEmitterCount = externalEmitterState.count;
    state.externalEmitterFrameId = externalEmitterState.frameId;
    state.externalEmitterAgeMs = externalEmitterState.count > 0 ? Math.max(0, nowMs - externalEmitterState.timestampMs) : null;
  }

  function resampleScalarActivityCue(values, sourceGrid, targetGrid) {
    const srcGrid = normalizeScalarActivityCueGridSize(sourceGrid);
    const dstGrid = normalizeGridSize(targetGrid);
    const source = values instanceof Float32Array ? values : new Float32Array(values || []);
    const sourceCells = srcGrid * srcGrid * srcGrid;
    if (source.length < sourceCells) {
      throw new Error(`truth oracle activity cue expected ${sourceCells} values for ${srcGrid}^3, got ${source.length}`);
    }
    const target = new Float32Array(dstGrid * dstGrid * dstGrid);
    if (srcGrid === dstGrid) {
      for (let index = 0; index < target.length; index += 1) {
        target[index] = clampFinite(source[index], 0, 1, 0);
      }
      return target;
    }
    const ratio = srcGrid / dstGrid;
    for (let z = 0; z < dstGrid; z += 1) {
      const sz = Math.max(0, Math.min(srcGrid - 1, Math.floor((z + 0.5) * ratio)));
      for (let y = 0; y < dstGrid; y += 1) {
        const sy = Math.max(0, Math.min(srcGrid - 1, Math.floor((y + 0.5) * ratio)));
        for (let x = 0; x < dstGrid; x += 1) {
          const sx = Math.max(0, Math.min(srcGrid - 1, Math.floor((x + 0.5) * ratio)));
          const srcIndex = sx + sy * srcGrid + sz * srcGrid * srcGrid;
          const dstIndex = x + y * dstGrid + z * dstGrid * dstGrid;
          target[dstIndex] = clampFinite(source[srcIndex], 0, 1, 0);
        }
      }
    }
    return target;
  }

  function scalarActivityReceiverDebug() {
    const controls = normalizeScalarActivityReceiverControls(controlsSnapshot);
    const externalCueActive = ['uploaded', 'gpu-projected'].includes(oracleActivityCueUpload.status)
      && oracleActivityCueUpload.externalCueCellCount > 0;
    return {
      identity: TRUTH_ORACLE_ACTIVITY_RECEIVER_IDENTITY,
      hookIdentity: SCALAR_ACTIVITY_RECEIVER_HOOK_IDENTITY,
      requestedCueAuthority: oracleActivityCueUpload.requestedCueAuthority || TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY,
      effectiveCueAuthority: externalCueActive
        ? oracleActivityCueUpload.effectiveCueAuthority || TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY
        : PROCEDURAL_ACTIVITY_CUE_AUTHORITY,
      enabled: controls.enabled,
      display: controls.display,
      curlNoiseGain: controls.curlNoiseGain,
      vorticityGain: controls.vorticityGain,
      materialGain: controls.materialGain,
      externalCueStatus: oracleActivityCueUpload.status,
      externalCueCellCount: oracleActivityCueUpload.externalCueCellCount,
      externalCueSourceGrid: oracleActivityCueUpload.grid,
      receiverGrid: gridSize,
      frameId: oracleActivityCueUpload.frameId,
      uploadedAtMs: oracleActivityCueUpload.uploadedAtMs,
    };
  }

  function boundarySidecarDebug(boundarySidecarSourceName = normalizeBoundarySidecarSource(controlsSnapshot.boundarySidecarSource)) {
    const controls = controlsSnapshot.boundarySidecarControls || {};
    const view = normalizeBoundarySidecarView(controls.view ?? controlsSnapshot.boundarySidecarView);
    const overrideReceipt = boundarySidecarSourceName === 'override' ? state.boundarySidecarOverrideReceipt : null;
    return {
      identity: BOUNDARY_SIDECAR_IDENTITY,
      authority: overrideReceipt?.status === 'applied' ? EXTERNAL_BOUNDARY_SIDECAR_AUTHORITY : BOUNDARY_SIDECAR_BAKE_AUTHORITY,
      source: boundarySidecarSourceName,
      view,
      channels: ['support', 'coverage', 'ridge', 'proximity', 'footprint'],
      boundaryStructureSource: boundarySidecarSourceName,
      activeInRaymarch: boundarySidecarSourceName !== 'live',
      activeAsDebugView: view !== 'off',
      blur: clampFinite(controls.blur ?? controlsSnapshot.boundarySidecarBlur, 0, 1, 0.45),
      stepWidth: clampFinite(controls.stepWidth ?? controlsSnapshot.boundarySidecarWidth, 0, 2, 0.75),
      ridgeGain: clampFinite(controls.ridgeGain ?? controlsSnapshot.boundarySidecarRidge, 0, 2, 1),
      grid: gridSize,
      bytes: boundarySidecarBufferBytes(gridSize),
      built: state.boundarySidecarBuilt,
      builtThisFrame: state.boundarySidecarBuiltThisFrame,
      frameCount: state.boundarySidecarFrameCount,
      lastBuiltFrame: state.boundarySidecarLastBuiltFrame,
      overrideReceipt,
    };
  }

  function ensureExternalEmitterBuffer() {
    if (externalEmitterBuffer) return;
    externalEmitterBuffer = device.createBuffer({
      label: `kaminos external segment emitters ${MAX_EXTERNAL_EMITTERS}`,
      size: externalEmitterBufferBytes(),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(externalEmitterBuffer, 0, externalEmitterState.data);
  }

  function writeExternalEmitterBuffer() {
    if (!device || !externalEmitterBuffer) return;
    device.queue.writeBuffer(externalEmitterBuffer, 0, externalEmitterState.data);
  }

  function ensureOracleActivityCueBuffer() {
    if (oracleActivityCueBuffer) return;
    oracleActivityCueBuffer = device.createBuffer({
      label: `kaminos truth-oracle scalar activity cue ${gridSize}^3`,
      size: scalarActivityCueBufferBytes(gridSize),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(oracleActivityCueBuffer, 0, new Float32Array(gridCellCount(gridSize)));
  }

  function writeOracleActivityCueBuffer(values) {
    if (!device) return;
    ensureOracleActivityCueBuffer();
    device.queue.writeBuffer(oracleActivityCueBuffer, 0, values);
  }

  function normalizePrimitiveRecord(primitive) {
    const source = primitive && typeof primitive === 'object' ? primitive : {};
    assertNoPlaceholderTopologyClaim(source);
    const transform = source.transform && typeof source.transform === 'object' ? source.transform : {};
    const simulation = source.simulation && typeof source.simulation === 'object' ? source.simulation : {};
    const scale = Array.isArray(transform.scale) ? transform.scale.map(Number) : [0.12, 0.12, 0.12];
    return {
      ...source,
      id: String(source.id || 'volume-primitive-0'),
      kind: String(source.kind || 'fire_smoke'),
      shape: String(source.shape || 'sphere'),
      transform: {
        position: Array.isArray(transform.position) ? transform.position.map(Number) : [0, -0.74, 0],
        rotation: Array.isArray(transform.rotation) ? transform.rotation.map(Number) : [0, 0, 0],
        scale,
      },
      simulation: {
        ...simulation,
        sourceRadius: Number.isFinite(Number(simulation.sourceRadius)) ? Number(simulation.sourceRadius) : Math.max(0.08, Number(scale[0]) || 0.12),
        flowRate: Number.isFinite(Number(simulation.flowRate)) ? Number(simulation.flowRate) : (controlsSnapshot.flowRate ?? 0.3),
      },
    };
  }

  function assertNoPlaceholderTopologyClaim(primitive) {
    const placeholderContract = primitive?.placeholderContract || primitive?.coupling?.placeholderContract || primitive?.lamellarHook?.placeholderContract;
    const claimsProduction =
      primitive?.topologyAuthority === 'production' ||
      primitive?.coupling?.topologyAuthority === 'production' ||
      primitive?.claims?.productionLamellarTopology === true;
    if (placeholderContract && claimsProduction) {
      throw new Error(`Volume primitive ${primitive?.id || '(unknown)'} carries placeholderContract=${placeholderContract} but claims production Lamellar topology`);
    }
  }

  function publishVolumePrimitiveState() {
    state.volumePrimitiveCount = volumePrimitives.length;
    state.volumePrimitiveIds = volumePrimitives.map(primitive => primitive.id);
    state.volumePrimitives = volumePrimitives.map(primitive => ({
      id: primitive.id,
      kind: primitive.kind,
      shape: primitive.shape,
      couplingSource: primitive.couplingSource,
      targetHookId: primitive.targetHookId,
      topologyAuthority: primitive.topologyAuthority,
      placeholderContract: primitive.placeholderContract,
      coupling: primitive.coupling ? { ...primitive.coupling } : undefined,
      lamellarHook: primitive.lamellarHook ? { ...primitive.lamellarHook } : undefined,
      transform: {
        position: [...primitive.transform.position],
        rotation: [...primitive.transform.rotation],
        scale: [...primitive.transform.scale],
      },
      simulation: { ...primitive.simulation },
    }));
  }

  function getPrimitiveSource() {
    const primitive = volumePrimitives[0];
    if (!primitive) {
      const scene = normalizeVolumeScene(controlsSnapshot.volumeScene);
      return {
        position: [0, scene === 'bonfire_plume' ? 0.62 : -0.74, 0],
        radius: Math.max(0.08, controlsSnapshot.inputRadius || 0.08),
        flowRate: Math.max(0, controlsSnapshot.flowRate ?? 0.3),
      };
    }
    return {
      position: primitive.transform.position,
      radius: Math.max(0.04, primitive.simulation.sourceRadius),
      flowRate: Math.max(0, primitive.simulation.flowRate),
    };
  }

  function makeInitialFluid(nextGridSize) {
    const data = new Float32Array(gridCellCount(nextGridSize) * FLUID_COMPONENTS);
    const initialScene = normalizeVolumeScene(controlsSnapshot.volumeScene);
    const isBonfireInitialScene = initialScene === 'bonfire_plume';
    const isCanonicalInitialScene = initialScene === 'canonical_plume';
    const isTallInitialScene = initialScene === 'tall_plume';
    const seedLateralVelocity = isBonfireInitialScene ? 0 : 0.11;
    const sourcePrimitive = getPrimitiveSource();
    for (let z = 0; z < nextGridSize; z += 1) {
      for (let y = 0; y < nextGridSize; y += 1) {
        for (let x = 0; x < nextGridSize; x += 1) {
          const fx = (x + 0.5) / nextGridSize * 2 - 1;
          const fy = (y + 0.5) / nextGridSize * 2 - 1;
          const fz = (z + 0.5) / nextGridSize * 2 - 1;
          const dx = fx - sourcePrimitive.position[0];
          const dy = fy - sourcePrimitive.position[1];
          const dz = fz - sourcePrimitive.position[2];
          const radial = Math.hypot(dx, dz);
          const fireScale = Math.max(0.35, Math.min(1.3, controlsSnapshot.fireScale ?? 0.86));
          const detailScale = Math.max(0.45, Math.min(3.2, controlsSnapshot.detailScale ?? 1.75));
          const plumeHeight = Math.max(0.7, Math.min(2.2, controlsSnapshot.plumeHeight ?? 1.45));
          const plumeHeight01 = Math.max(0, Math.min(1, (plumeHeight - 0.7) / 1.5));
          const scaledDetailFrequency = Math.max(0.55, Math.min(5.4, detailScale / Math.max(fireScale, 0.45)));
          const seedDetailFrequency = isTallInitialScene ? 1 : scaledDetailFrequency;
          const inputRadius = sourcePrimitive.radius * (0.92 + (1.08 - 0.92) * plumeHeight01);
          const inputFlow = sourcePrimitive.flowRate;
          const seedBonfireSourceY = isBonfireInitialScene ? 0.62 : -0.74;
          const seedSourceY = volumePrimitives.length > 0 ? sourcePrimitive.position[1] : seedBonfireSourceY;
          const seedSourceDistance = fy - seedSourceY;
          const source = Math.exp(-(radial * radial) / Math.max(0.0036, inputRadius * inputRadius)) * Math.max(0, 1 - Math.abs(seedSourceDistance) * 4.2) * inputFlow;
          const angle = Math.atan2(dz, dx);
          const azimuthalSeedA = 0.5 + 0.5 * Math.sin(angle * 5 + radial * 19 * seedDetailFrequency + fy * 6);
          const azimuthalSeedB = 0.5 + 0.5 * Math.cos(angle * 7 - radial * 13 * seedDetailFrequency + fy * 4);
          const azimuthalSeedC = 0.5 + 0.5 * Math.sin(angle * 3 + fx * fz * 31 * seedDetailFrequency - fy * 8);
          const radialSeedDetail = 0.34 + 0.66 * Math.sin((radial * 29 * seedDetailFrequency) + (fy * 5)) ** 2;
          const seedMaterialDetail = isCanonicalInitialScene
            ? 0
            : isBonfireInitialScene
              ? 0.26 + 0.36 * radialSeedDetail + 0.24 * azimuthalSeedA + 0.14 * azimuthalSeedB
              : isTallInitialScene
                ? 0
                : 0.35 + 0.65 * Math.sin((fx * 18 * seedDetailFrequency) + (fz * 11 * seedDetailFrequency)) ** 2;
          const seedVisibleAboveSource = isBonfireInitialScene ? seedBonfireSourceY - fy : fy + 0.74;
          const seedVisibleHeightRelief = Math.max(0, Math.min(1, (seedVisibleAboveSource - 0.012) / 0.25));
          const seedVisibleRadialRelief = Math.max(0, Math.min(1, (radial - inputRadius * 0.28) / Math.max(0.001, inputRadius * 0.86)));
          const seedVisibleFireCarrierRelief = isBonfireInitialScene
            ? Math.max(0.16, Math.max(seedVisibleHeightRelief, seedVisibleRadialRelief))
            : 1;
          const seedBonfireFlameSourceRelief = isBonfireInitialScene
            ? Math.max(0.18, Math.max(seedVisibleHeightRelief * 0.92, seedVisibleRadialRelief * 0.78))
            : 1;
          const seedBonfireFlame = isCanonicalInitialScene
            ? 0
            : isBonfireInitialScene
              ? (0.22 + 0.28 * radialSeedDetail + 0.22 * azimuthalSeedA + 0.18 * azimuthalSeedC) * seedBonfireFlameSourceRelief
              : 0.90;
          const seedVisibleFireCarrier = isCanonicalInitialScene
            ? 0
            : isBonfireInitialScene
              ? (0.28 + 0.32 * Math.cos((radial * 23 * seedDetailFrequency) - (fy * 3)) ** 2 + 0.26 * azimuthalSeedB + 0.14 * azimuthalSeedC) * seedVisibleFireCarrierRelief
              : 0.30 + 0.70 * Math.cos((fx * 13 * seedDetailFrequency) - (fz * 17 * seedDetailFrequency)) ** 2;
          const seedMicroSmoke = isCanonicalInitialScene
            ? 0
            : isBonfireInitialScene
              ? 0.20 + 0.30 * Math.sin((radial * 31 * seedDetailFrequency) + (fy * 4)) ** 2 + 0.30 * azimuthalSeedA + 0.20 * azimuthalSeedC
              : 0.22 + 0.78 * Math.sin((fx * 31 * seedDetailFrequency) - (fz * 19 * seedDetailFrequency)) ** 2;
          const seedInterfaceShred = isCanonicalInitialScene
            ? 0
            : isBonfireInitialScene
              ? 0.12 + 0.18 * Math.cos((radial * 27 * seedDetailFrequency) + (fy * 17)) ** 2 + 0.22 * azimuthalSeedB + 0.10 * azimuthalSeedC
              : 0.12 + 0.50 * Math.cos((fx * 23 * seedDetailFrequency) + (fy * 17) - (fz * 29 * seedDetailFrequency)) ** 2;
          const seedFireLick = isCanonicalInitialScene
            ? 0
            : isBonfireInitialScene
              ? 0.18 + 0.36 * Math.sin((fy * 27) + (radial * 21 * seedDetailFrequency)) ** 2 + 0.28 * azimuthalSeedA + 0.18 * azimuthalSeedB
              : 0.18 + 0.82 * Math.sin((fy * 27) + (fz * 21 * seedDetailFrequency)) ** 2;
          const i = ((x + y * nextGridSize + z * nextGridSize * nextGridSize) * FLUID_COMPONENTS);
          data[i] = -dz * source * seedLateralVelocity;
          data[i + 1] = source * 0.22;
          data[i + 2] = dx * source * seedLateralVelocity;
          data[i + 3] = source * 1.25;
          data[i + 4] = source * 0.74;
          data[i + 5] = source * (isCanonicalInitialScene ? 0.72 : 1.28);
          data[i + 6] = source * (isCanonicalInitialScene ? 0 : 1.0);
          data[i + 7] = source * seedMaterialDetail;
          data[i + 8] = source * seedBonfireFlame;
          data[i + 9] = source * (isCanonicalInitialScene ? 0 : 0.42);
          data[i + 10] = source * seedVisibleFireCarrier;
          data[i + 11] = 0;
          data[i + 12] = source * seedMicroSmoke;
          data[i + 13] = source * seedInterfaceShred;
          data[i + 14] = source * seedFireLick;
          data[i + 15] = source * (isCanonicalInitialScene ? 0 : 0.16);
        }
      }
    }
    return data;
  }

  function destroyFluidState() {
    selectiveHeadLiveRuntime?.destroy();
    selectiveHeadLiveRuntime = null;
    selectiveHeadLiveBindGroups = null;
    for (const buffer of fluidBuffers) buffer.destroy();
    for (const buffer of frontBuffers) buffer.destroy();
    for (const buffer of pressureBuffers) buffer.destroy();
    boundarySidecarBuffer?.destroy();
    boundarySplatBuffer?.destroy();
    boundarySplatDrawBuffer?.destroy();
    boundarySplatIndirectBuffer?.destroy();
    boundarySplatReadbackBuffer?.destroy();
    boundarySplatFeatureBuffer?.destroy();
    oracleActivityCueBuffer?.destroy();
    boundarySidecarBuffer = null;
    boundarySplatBuffer = null;
    boundarySplatDrawBuffer = null;
    boundarySplatIndirectBuffer = null;
    boundarySplatReadbackBuffer = null;
    boundarySplatFeatureBuffer = null;
    boundarySplatFeatureBufferCapacity = 0;
    boundarySplatTelemetryCopyPending = false;
    oracleActivityCueBuffer = null;
    fluidBuffers = [];
    frontBuffers = [];
    pressureBuffers = [];
    bindGroups = [];
    majorantFrontBindGroups = [];
    boundarySidecarReadBindGroups = [];
    boundarySidecarWriteBindGroup = null;
    boundarySplatComputeBindGroups = [];
    boundarySplatRenderBindGroup = null;
    pressureWriteBindGroup = null;
    pressureJacobiBindGroups = [];
    pressureReadBindGroups = [];
  }

  function destroyMajorantState() {
    majorantBuffer?.destroy();
    majorantBuffer = null;
    majorantWriteBindGroup = null;
  }

  function resetTemporalHistory(reason = 'reset') {
    historyValid = false;
    previousViewProjReady = false;
    state.temporalHistoryValid = false;
    state.temporalHistoryFrames = 0;
    state.temporalReprojectionConfidence = 0;
    state.temporalHistoryWeight = 0;
    state.temporalRejectedHistory = 1;
    state.temporalSmokeHistoryTrust = 0;
    state.temporalFireHistoryProtect = 0;
    state.temporalInterfaceHistoryProtect = 0;
    state.temporalEvidenceSource = 'cpu-estimate-control-proxy';
    state.temporalHistoryResetCount += 1;
    state.temporalHistoryResetReason = reason;
  }

  function commitPreviousViewProjection() {
    previousViewProj.copy(viewProj);
    previousViewProjReady = true;
  }

  function destroyTemporalHistory() {
    historyTexture?.destroy();
    historyTexture = null;
    historyTextureSize = '';
    resetTemporalHistory('history-destroyed');
  }

  function ensureTemporalHistoryTexture() {
    if (!device || !format) return;
    const width = Math.max(1, state.width || 1);
    const height = Math.max(1, state.height || 1);
    const key = `${width}x${height}:${format}`;
    if (historyTexture && historyTextureSize === key) return;
    historyTexture?.destroy();
    historyTexture = device.createTexture({
      label: `kaminos temporal history texture ${width}x${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    historyTextureSize = key;
    resetTemporalHistory('history-resized');
    rebuildFluidBindGroups();
    rebuildSelectiveHeadLiveBindGroups();
  }

  function temporalCameraSignature() {
    return [
      camera.position.x.toFixed(4),
      camera.position.y.toFixed(4),
      camera.position.z.toFixed(4),
      camera.quaternion.x.toFixed(4),
      camera.quaternion.y.toFixed(4),
      camera.quaternion.z.toFixed(4),
      camera.quaternion.w.toFixed(4),
      camera.projectionMatrix.elements.map(value => value.toFixed(4)).join(','),
    ].join('|');
  }

  function temporalControlSignature(snapshot = controlsSnapshot) {
    return [
      snapshot.density,
      snapshot.fire,
      snapshot.radiance,
      snapshot.absorption,
      snapshot.glow,
      snapshot.smoke,
      snapshot.curl,
      snapshot.microdetail,
      snapshot.interfaceShred,
      snapshot.fireLicks,
      snapshot.projection,
      snapshot.speed,
      snapshot.raySteps,
      snapshot.adaptiveRays,
      snapshot.occupancySkip,
      snapshot.majorantSkip,
      snapshot.majorantSmooth,
      snapshot.majorantGuard,
      snapshot.renderScale,
      snapshot.fireScale,
      snapshot.detailScale,
      snapshot.plumeHeight,
      snapshot.windStrength,
      snapshot.windAngle,
      snapshot.windHeight,
      snapshot.bonfireRecenter,
      snapshot.bonfireLateralDamping,
      snapshot.bonfireShear,
      snapshot.bonfireDetailForces,
      snapshot.bonfireDepinch,
      snapshot.bonfireProjection,
      snapshot.bonfireTemporal,
      snapshot.bonfireInstabilityProbe,
      normalizeLifecycleEffect(snapshot.lifecycleEffect),
      snapshot.lifecycleT,
      snapshot.quenchVapor,
      snapshot.inputRadius,
      snapshot.flowRate,
      snapshot.resolution,
      snapshot.majorantGrid,
      snapshot.gridOverlay,
      snapshot.flowDebug,
      snapshot.oracleActivityCue,
      snapshot.oracleActivityDisplay,
      snapshot.oracleActivityCurlNoise,
      snapshot.oracleActivityVorticity,
      snapshot.oracleActivityMaterial,
      normalizeLookFreeze(snapshot.lookFreeze),
      normalizePyroCompareMode(snapshot.pyroCompareMode),
      snapshot.pressureStrategy,
      snapshot.pressureTierLowerMax,
      snapshot.pressureTierHeroMin,
      snapshot.pressureTierHeroMax,
      normalizeVolumeScene(snapshot.volumeScene),
      snapshot.rayBudgetPreset || '',
    ].map(value => Number.isFinite(value) ? Number(value).toFixed(4) : String(value ?? '')).join('|');
  }

  function frozenRenderControlSignature(snapshot = controlsSnapshot) {
    return Object.keys(snapshot)
      .filter(key => key !== 'resolution')
      .sort()
      .map(key => `${key}=${JSON.stringify(snapshot[key])}`)
      .join('|');
  }

  function canonicalSourceControlSignature(snapshot = controlsSnapshot) {
    return [
      normalizeVolumeScene(snapshot.volumeScene),
      snapshot.inputRadius,
      snapshot.flowRate,
      normalizeCanonicalSourceMode(snapshot.canonicalSourceMode),
      normalizeCanonicalMotionMode(snapshot.canonicalMotionMode),
      normalizeCanonicalContentMode(snapshot.canonicalContentMode),
      snapshot.canonicalSourceY,
      snapshot.canonicalSourceInjection,
      snapshot.canonicalBuoyancy,
    ].map(value => Number.isFinite(value) ? Number(value).toFixed(4) : String(value ?? '')).join('|');
  }

  function maybeResetTemporalHistoryForCamera() {
    const signature = temporalCameraSignature();
    if (lastTemporalCameraSignature && lastTemporalCameraSignature !== signature) {
      resetTemporalHistory('camera-change');
    }
    lastTemporalCameraSignature = signature;
  }

  function rebuildFluidBindGroups() {
    if (!device || !bindGroupLayout || !uniformBuffer || !externalEmitterBuffer || !oracleActivityCueBuffer || fluidBuffers.length !== 2 || frontBuffers.length !== 2 || !majorantBuffer || !boundarySidecarBuffer || !historyTexture || !historySampler) return;
    bindGroups = [
      device.createBindGroup({
        label: `kaminos fluid bind group ${gridSize}^3 A to B`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
          { binding: 2, resource: { buffer: fluidBuffers[1] } },
          { binding: 3, resource: { buffer: majorantBuffer } },
          { binding: 4, resource: historyTexture.createView() },
          { binding: 5, resource: historySampler },
          { binding: 6, resource: { buffer: externalEmitterBuffer } },
          { binding: 7, resource: { buffer: frontBuffers[0] } },
          { binding: 8, resource: { buffer: frontBuffers[1] } },
          { binding: 9, resource: { buffer: oracleActivityCueBuffer } },
          { binding: 10, resource: { buffer: boundarySidecarBuffer } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos fluid bind group ${gridSize}^3 B to A`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
          { binding: 2, resource: { buffer: fluidBuffers[0] } },
          { binding: 3, resource: { buffer: majorantBuffer } },
          { binding: 4, resource: historyTexture.createView() },
          { binding: 5, resource: historySampler },
          { binding: 6, resource: { buffer: externalEmitterBuffer } },
          { binding: 7, resource: { buffer: frontBuffers[1] } },
          { binding: 8, resource: { buffer: frontBuffers[0] } },
          { binding: 9, resource: { buffer: oracleActivityCueBuffer } },
          { binding: 10, resource: { buffer: boundarySidecarBuffer } },
        ],
      }),
    ];
  }

  function rebuildSelectiveHeadLiveBindGroups() {
    if (
      !selectiveHeadLiveRuntime
      || !bindGroupLayout
      || !majorantFluidBindGroupLayout
      || !boundarySidecarReadBindGroupLayout
      || !boundarySplatComputeBindGroupLayout
      || !uniformBuffer
      || !majorantBuffer
      || !historyTexture
      || !historySampler
      || !externalEmitterBuffer
      || !oracleActivityCueBuffer
      || !boundarySidecarBuffer
      || !boundarySplatBuffer
      || !boundarySplatDrawBuffer
      || !boundarySplatCameraBuffer
      || !boundarySplatFeatureBuffer
    ) {
      selectiveHeadLiveBindGroups = null;
      return;
    }
    const makeRole = (role, fluid, front) => ({
      render: device.createBindGroup({
        label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} ${role} render`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluid } },
          { binding: 2, resource: { buffer: fluidBuffers[0] } },
          { binding: 3, resource: { buffer: majorantBuffer } },
          { binding: 4, resource: historyTexture.createView() },
          { binding: 5, resource: historySampler },
          { binding: 6, resource: { buffer: externalEmitterBuffer } },
          { binding: 7, resource: { buffer: front } },
          { binding: 8, resource: { buffer: frontBuffers[0] } },
          { binding: 9, resource: { buffer: oracleActivityCueBuffer } },
          { binding: 10, resource: { buffer: boundarySidecarBuffer } },
        ],
      }),
      majorant: device.createBindGroup({
        label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} ${role} majorant`,
        layout: majorantFluidBindGroupLayout,
        entries: [
          { binding: 1, resource: { buffer: fluid } },
          { binding: 7, resource: { buffer: front } },
        ],
      }),
      sidecar: device.createBindGroup({
        label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} ${role} sidecar`,
        layout: boundarySidecarReadBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluid } },
          { binding: 7, resource: { buffer: front } },
        ],
      }),
      splat: device.createBindGroup({
        label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} ${role} splat`,
        layout: boundarySplatComputeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: boundarySidecarBuffer } },
          { binding: 1, resource: { buffer: fluid } },
          { binding: 2, resource: { buffer: boundarySplatBuffer } },
          { binding: 3, resource: { buffer: boundarySplatDrawBuffer } },
          { binding: 4, resource: { buffer: boundarySplatCameraBuffer } },
          { binding: 6, resource: { buffer: boundarySplatFeatureBuffer } },
        ],
      }),
    });
    selectiveHeadLiveBindGroups = {
      lowPhaseAligned: makeRole(
        'lowPhaseAligned',
        selectiveHeadLiveRuntime.buffers.lowUpsampledFluid,
        selectiveHeadLiveRuntime.buffers.lowUpsampledFront,
      ),
      selectiveFullResidual: makeRole(
        'selectiveFullResidual',
        selectiveHeadLiveRuntime.buffers.predictedFluid,
        selectiveHeadLiveRuntime.buffers.predictedFront,
      ),
    };
  }

  function selectiveHeadLiveRequestedRole() {
    return normalizeSelectiveHeadLiveRole(controlsSnapshot.selectiveHeadLiveRole);
  }

  function selectiveHeadLiveRoleGroups(kind) {
    const role = state.selectiveHeadLiveEffectiveRole;
    return selectiveHeadLiveBindGroups?.[role]?.[kind] || null;
  }

  function encodeSelectiveHeadLiveFields(encoder) {
    const requestedRole = selectiveHeadLiveRequestedRole();
    state.selectiveHeadLiveRole = requestedRole;
    state.selectiveHeadLiveRoleAuthority = selectiveHeadLiveRoleAuthority(requestedRole);
    state.selectiveHeadLiveFallbackReason = null;
    if (requestedRole === 'off') {
      state.selectiveHeadLiveEffectiveRole = 'off';
      state.selectiveHeadLive = null;
      return false;
    }
    if (gridSize !== 160) {
      state.selectiveHeadLiveEffectiveRole = 'truthHigh';
      state.selectiveHeadLiveRoleAuthority = selectiveHeadLiveRoleAuthority('truthHigh');
      state.selectiveHeadLiveFallbackReason = `unsupported-grid-${gridSize}-requires-160`;
      return false;
    }
    if (requestedRole === 'truthHigh') {
      state.selectiveHeadLiveEffectiveRole = 'truthHigh';
      state.selectiveHeadLiveRoleAuthority = selectiveHeadLiveRoleAuthority('truthHigh');
      state.selectiveHeadLive = null;
      return false;
    }
    if (!selectiveHeadLiveRuntime || !selectiveHeadLiveBindGroups) {
      state.selectiveHeadLiveEffectiveRole = 'truthHigh';
      state.selectiveHeadLiveRoleAuthority = selectiveHeadLiveRoleAuthority('truthHigh');
      state.selectiveHeadLiveFallbackReason = 'frozen-model-runtime-unavailable';
      return false;
    }
    selectiveHeadLiveRuntime.encode(encoder, currentFluid);
    state.selectiveHeadLiveEffectiveRole = requestedRole;
    state.selectiveHeadLive = selectiveHeadLiveRuntime.debugState();
    return true;
  }

  async function loadSelectiveHeadLiveReplayAnchor(options = {}) {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    const fluidUrl = String(options.fluidUrl || '');
    const frontUrl = String(options.frontUrl || '');
    const fluidSha256 = String(options.fluidSha256 || '').toLowerCase();
    const frontSha256 = String(options.frontSha256 || '').toLowerCase();
    const completedSteps = Math.max(0, Math.floor(Number(options.completedSteps) || 0));
    if (!fluidUrl || !frontUrl || !/^[a-f0-9]{64}$/.test(fluidSha256) || !/^[a-f0-9]{64}$/.test(frontSha256)) {
      throw new Error('selective-head replay anchor requires URLs and SHA-256 identities for both fields');
    }
    if (gridSize !== 160 || completedSteps !== 96) {
      throw new Error(`selective-head replay anchor requires grid 160 at step 96, got grid ${gridSize} step ${completedSteps}`);
    }
    cancelAnimationFrame(raf);
    if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    const [fluidResponse, frontResponse] = await Promise.all([
      fetch(fluidUrl, { cache: 'no-store' }),
      fetch(frontUrl, { cache: 'no-store' }),
    ]);
    if (!fluidResponse.ok || !frontResponse.ok) {
      throw new Error(`selective-head replay anchor fetch failed: fluid=${fluidResponse.status} front=${frontResponse.status}`);
    }
    const [fluidBytes, frontBytes] = await Promise.all([fluidResponse.arrayBuffer(), frontResponse.arrayBuffer()]);
    const expectedFluidBytes = 160 ** 3 * FLUID_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
    const expectedFrontBytes = 160 ** 3 * Float32Array.BYTES_PER_ELEMENT;
    if (fluidBytes.byteLength !== expectedFluidBytes || frontBytes.byteLength !== expectedFrontBytes) {
      throw new Error(`selective-head replay anchor shape mismatch: fluid=${fluidBytes.byteLength}/${expectedFluidBytes} front=${frontBytes.byteLength}/${expectedFrontBytes}`);
    }
    const digestHex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    const [effectiveFluidSha256, effectiveFrontSha256] = await Promise.all([digestHex(fluidBytes), digestHex(frontBytes)]);
    if (effectiveFluidSha256 !== fluidSha256 || effectiveFrontSha256 !== frontSha256) {
      throw new Error(`selective-head replay anchor checksum mismatch: fluid=${effectiveFluidSha256} front=${effectiveFrontSha256}`);
    }
    rebuildFluidState(gridSize, majorantGridSize, 'selective-head-live-replay-anchor');
    const uploadInChunks = (buffer, bytes) => {
      const source = new Uint8Array(bytes);
      const chunkBytes = 8 * 1024 * 1024;
      for (let offset = 0; offset < source.byteLength; offset += chunkBytes) {
        const length = Math.min(chunkBytes, source.byteLength - offset);
        device.queue.writeBuffer(buffer, offset, source, offset, length);
      }
    };
    for (const buffer of fluidBuffers) uploadInChunks(buffer, fluidBytes);
    for (const buffer of frontBuffers) uploadInChunks(buffer, frontBytes);
    state.frameCount = completedSteps;
    state.simStepCount = completedSteps;
    selectiveHeadLiveRuntime = await createSelectiveHeadLiveRuntime({
      device,
      sourceFluidBuffers: fluidBuffers,
      sourceFrontBuffers: frontBuffers,
    });
    rebuildSelectiveHeadLiveBindGroups();
    state.selectiveHeadLive = selectiveHeadLiveRuntime.debugState();
    if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    state.selectiveHeadLiveReplayAnchor = {
      ok: true,
      authority: SELECTIVE_HEAD_LIVE_REPLAY_ANCHOR_AUTHORITY,
      completedSteps,
      grid: gridSize,
      fluidUrl,
      frontUrl,
      fluidSha256: effectiveFluidSha256,
      frontSha256: effectiveFrontSha256,
      fluidByteLength: fluidBytes.byteLength,
      frontByteLength: frontBytes.byteLength,
      modelIdentity: selectiveHeadLiveRuntime.modelIdentity,
    };
    return { ...state.selectiveHeadLiveReplayAnchor };
  }

  function ensureMajorantBuffer() {
    if (majorantBuffer) return;
    majorantBuffer = device.createBuffer({
      label: `kaminos coarse majorant field ${majorantGridSize}^3`,
      size: majorantBufferBytes(majorantGridSize),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(majorantBuffer, 0, new Float32Array(majorantGridSize * majorantGridSize * majorantGridSize * 4));
    majorantWriteBindGroup = device.createBindGroup({
      label: `kaminos coarse majorant write bind group ${majorantGridSize}^3`,
      layout: majorantWriteBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: majorantBuffer } },
      ],
    });
  }

  function ensureBoundarySidecarBuffer() {
    if (boundarySidecarBuffer) return;
    boundarySidecarBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} ${gridSize}^3`,
      size: boundarySidecarBufferBytes(gridSize),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(boundarySidecarBuffer, 0, new Float32Array(gridCellCount(gridSize) * 4));
    boundarySidecarWriteBindGroup = device.createBindGroup({
      label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} write bind group ${gridSize}^3`,
      layout: boundarySidecarWriteBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: boundarySidecarBuffer } },
      ],
    });
  }

  function ensureBoundarySplatBuffers() {
    if (boundarySplatBuffer && boundarySplatDrawBuffer && boundarySplatIndirectBuffer && boundarySplatCameraBuffer && boundarySplatReadbackBuffer && boundarySplatFeatureBuffer) return;
    boundarySplatBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} candidates`,
      size: boundarySplatCapacity * BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    boundarySplatDrawBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} indirect draw state`,
      size: 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    boundarySplatIndirectBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} indirect arguments`,
      size: 16,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    boundarySplatCameraBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} camera`,
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    boundarySplatReadbackBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} asynchronous count readback`,
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const featureCaptureRequested = normalizeBoundarySplatFeatureCapture(controlsSnapshot.boundarySplatFeatureCapture);
    boundarySplatFeatureBufferCapacity = featureCaptureRequested ? boundarySplatCapacity : 1;
    boundarySplatFeatureBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY} ${featureCaptureRequested ? 'full' : 'dummy'}`,
      size: boundarySplatFeatureBufferCapacity * BOUNDARY_SPLAT_FEATURE_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    state.boundarySplatFeatureCaptureRequested = featureCaptureRequested;
    state.boundarySplatFeatureCaptureEffective = featureCaptureRequested && boundarySplatFeatureBufferCapacity === boundarySplatCapacity;
    state.boundarySplatCapacity = boundarySplatCapacity;
  }

  function rebuildBoundarySplatBindGroups() {
    if (
      !boundarySplatComputeBindGroupLayout
      || !boundarySplatRenderBindGroupLayout
      || !boundarySidecarBuffer
      || !boundarySplatBuffer
      || !boundarySplatDrawBuffer
      || !boundarySplatCameraBuffer
      || !boundarySplatFeatureBuffer
      || fluidBuffers.length !== 2
    ) return;
    boundarySplatComputeBindGroups = fluidBuffers.map((fluidBuffer, index) => device.createBindGroup({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} compute bind group ${gridSize}^3 ${index}`,
      layout: boundarySplatComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: boundarySidecarBuffer } },
        { binding: 1, resource: { buffer: fluidBuffer } },
        { binding: 2, resource: { buffer: boundarySplatBuffer } },
        { binding: 3, resource: { buffer: boundarySplatDrawBuffer } },
        { binding: 4, resource: { buffer: boundarySplatCameraBuffer } },
        { binding: 6, resource: { buffer: boundarySplatFeatureBuffer } },
      ],
    }));
    boundarySplatRenderBindGroup = device.createBindGroup({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} render bind group ${gridSize}^3`,
      layout: boundarySplatRenderBindGroupLayout,
      entries: [
        { binding: 4, resource: { buffer: boundarySplatCameraBuffer } },
        { binding: 5, resource: { buffer: boundarySplatBuffer } },
      ],
    });
    rebuildSelectiveHeadLiveBindGroups();
  }

  function growBoundarySplatCapacity(candidateCount) {
    const nextCapacity = nextBoundarySplatCapacity(boundarySplatCapacity, candidateCount, gridSize);
    if (nextCapacity <= boundarySplatCapacity) return false;
    const previousCapacity = boundarySplatCapacity;
    const previousSplatBuffer = boundarySplatBuffer;
    const previousFeatureBuffer = boundarySplatFeatureBuffer;
    const featureCaptureRequested = boundarySplatFeatureCaptureRequested();
    boundarySplatCapacity = nextCapacity;
    boundarySplatBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} candidates capacity ${nextCapacity}`,
      size: nextCapacity * BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    boundarySplatFeatureBufferCapacity = featureCaptureRequested ? nextCapacity : 1;
    boundarySplatFeatureBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY} ${featureCaptureRequested ? `capacity ${nextCapacity}` : 'dummy'}`,
      size: boundarySplatFeatureBufferCapacity * BOUNDARY_SPLAT_FEATURE_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    rebuildBoundarySplatBindGroups();
    previousSplatBuffer?.destroy();
    previousFeatureBuffer?.destroy();
    state.boundarySplatCapacity = nextCapacity;
    state.boundarySplatCapacityGrowthCount += 1;
    state.boundarySplatCapacityGrowth = {
      identity: 'boundary-splat-capacity-growth-v0',
      from: previousCapacity,
      to: nextCapacity,
      observedCandidateCount: candidateCount,
      physicalGridCellLimit: gridCellCount(gridSize),
      reason: 'gpu-overflow-readback',
    };
    state.boundarySplatFeatureCaptureEffective = featureCaptureRequested
      && boundarySplatFeatureBufferCapacity === boundarySplatCapacity;
    return true;
  }

  function rebuildFluidState(nextGridSize = gridSize, nextMajorantGridSize = majorantGridSize, reason = 'grid-rebuilt', options = {}) {
    gridSize = normalizeGridSize(nextGridSize);
    majorantGridSize = normalizeMajorantGridSize(nextMajorantGridSize);
    const skipInitialFluid = options.skipInitialFluid === true;
    destroyFluidState();
    boundarySplatCapacity = Math.min(BOUNDARY_SPLAT_INITIAL_CAPACITY, gridCellCount(gridSize));
    state.boundarySplatCapacity = boundarySplatCapacity;
    state.boundarySplatCapacityGrowth = null;
    destroyMajorantState();
    ensureMajorantBuffer();
    ensureBoundarySidecarBuffer();
    const nextBufferBytes = fluidBufferBytes(gridSize);
    const nextFrontBufferBytes = frontFieldBufferBytes(gridSize);
    const nextBoundarySidecarBufferBytes = boundarySidecarBufferBytes(gridSize);
    const nextPressureBufferBytes = pressureBufferBytes(gridSize);
    const initialFluid = skipInitialFluid ? null : makeInitialFluid(gridSize);
    fluidBuffers = [0, 1].map(i => {
      const buffer = device.createBuffer({
        label: `kaminos fluid state ${gridSize}^3 ${i}`,
        size: nextBufferBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      if (!skipInitialFluid) device.queue.writeBuffer(buffer, 0, initialFluid);
      return buffer;
    });
    frontBuffers = [0, 1].map(i => {
      const buffer = device.createBuffer({
        label: `kaminos ${FRONT_FIELD_IDENTITY} ${gridSize}^3 ${i}`,
        size: nextFrontBufferBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      if (!skipInitialFluid) device.queue.writeBuffer(buffer, 0, new Float32Array(gridCellCount(gridSize)));
      return buffer;
    });
    pressureBuffers = [0, 1].map(i => {
      const buffer = device.createBuffer({
        label: `kaminos pressure/divergence field ${gridSize}^3 ${i}`,
        size: nextPressureBufferBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      if (!skipInitialFluid) device.queue.writeBuffer(buffer, 0, new Float32Array(gridCellCount(gridSize) * 4));
      return buffer;
    });
    ensureOracleActivityCueBuffer();
    if (oracleActivityCueSourceValues && oracleActivityCueSourceGrid) {
      const resampledCue = resampleScalarActivityCue(oracleActivityCueSourceValues, oracleActivityCueSourceGrid, gridSize);
      writeOracleActivityCueBuffer(resampledCue);
      oracleActivityCueUpload = {
        ...oracleActivityCueUpload,
        status: 'uploaded',
        effectiveCueAuthority: TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY,
        externalCueCellCount: resampledCue.length,
        receiverGrid: gridSize,
      };
    }
    const renderPipelineConstants = { GRID: gridSize, MAJORANT_GRID: majorantGridSize };
    const computePipelineConstants = { GRID: gridSize };
    const majorantPipelineConstants = { GRID: gridSize, MAJORANT_GRID: majorantGridSize };
    const makePipeline = (targetFormat, label) => device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', constants: renderPipelineConstants, targets: [{ format: targetFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    pipeline = makePipeline(format, `kaminos volume canvas native-3d-compute-fluid-raymarch-v0 ${gridSize}^3`);
    readbackPipeline = makePipeline('rgba8unorm', `kaminos volume readback native-3d-compute-fluid-raymarch-v0 ${gridSize}^3`);
    browserResidualSourcePipeline = device.createRenderPipeline({
      label: `kaminos volume browser residual shader-material-authority source ${gridSize}^3`,
      layout: pipelineLayout,
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: {
        module: shader,
        entryPoint: 'fsResidualSource',
        constants: renderPipelineConstants,
        targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });
    browserResidualPipeline = device.createRenderPipeline({
      label: `kaminos volume browser webgpu-direct-residual postprocess ${gridSize}^3`,
      layout: browserResidualPipelineLayout,
      vertex: { module: browserResidualShader, entryPoint: 'vs' },
      fragment: { module: browserResidualShader, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    computePipeline = device.createComputePipeline({
      label: `kaminos first fluid sim compute pipeline ${gridSize}^3`,
      layout: pipelineLayout,
      compute: { module: shader, entryPoint: 'cs', constants: computePipelineConstants },
    });
    pressureDivergencePipeline = device.createComputePipeline({
      label: `kaminos divergence pressure compute pipeline ${gridSize}^3`,
      layout: pressureWritePipelineLayout,
      compute: { module: shader, entryPoint: 'csDivergencePressure', constants: computePipelineConstants },
    });
    pressureJacobiPipeline = device.createComputePipeline({
      label: `kaminos pressure jacobi compute pipeline ${gridSize}^3`,
      layout: pressureJacobiPipelineLayout,
      compute: { module: shader, entryPoint: 'csPressureJacobi', constants: computePipelineConstants },
    });
    pressureJacobiTieredLowerPipeline = device.createComputePipeline({
      label: `kaminos pressure tiered lower-slab jacobi compute pipeline ${gridSize}^3`,
      layout: pressureJacobiTieredPipelineLayout,
      compute: { module: shader, entryPoint: 'csPressureJacobiTieredLower', constants: computePipelineConstants },
    });
    pressureJacobiTieredHeroPipeline = device.createComputePipeline({
      label: `kaminos pressure tiered hero-band jacobi compute pipeline ${gridSize}^3`,
      layout: pressureJacobiTieredPipelineLayout,
      compute: { module: shader, entryPoint: 'csPressureJacobiTieredHero', constants: computePipelineConstants },
    });
    pressureProjectPipeline = device.createComputePipeline({
      label: `kaminos velocity projection compute pipeline ${gridSize}^3`,
      layout: pressureProjectPipelineLayout,
      compute: { module: shader, entryPoint: 'csProjectPressure', constants: computePipelineConstants },
    });
    pressureProjectTieredPipeline = device.createComputePipeline({
      label: `kaminos velocity tiered pressure projection compute pipeline ${gridSize}^3`,
      layout: pressureProjectTieredPipelineLayout,
      compute: { module: shader, entryPoint: 'csProjectPressureTiered', constants: computePipelineConstants },
    });
    majorantComputePipeline = device.createComputePipeline({
      label: `kaminos coarse majorant compute pipeline ${gridSize}^3 to ${majorantGridSize}^3`,
      layout: majorantPipelineLayout,
      compute: { module: shader, entryPoint: 'csMajorant', constants: majorantPipelineConstants },
    });
    boundarySidecarBuildPipeline = device.createComputePipeline({
      label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} compute pipeline ${gridSize}^3`,
      layout: boundarySidecarPipelineLayout,
      compute: { module: shader, entryPoint: 'csBoundarySidecar', constants: computePipelineConstants },
    });
    boundarySplatCompactPipeline = device.createComputePipeline({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} compact ${gridSize}^3`,
      layout: boundarySplatComputePipelineLayout,
      compute: { module: boundarySplatShader, entryPoint: 'compactBoundarySplats', constants: computePipelineConstants },
    });
    boundarySplatFinalizePipeline = device.createComputePipeline({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} finalize ${gridSize}^3`,
      layout: boundarySplatComputePipelineLayout,
      compute: { module: boundarySplatShader, entryPoint: 'finalizeBoundarySplats', constants: computePipelineConstants },
    });
    const makeBoundarySplatRenderPipeline = (targetFormat, label) => device.createRenderPipeline({
      label,
      layout: boundarySplatRenderPipelineLayout,
      vertex: { module: boundarySplatShader, entryPoint: 'boundarySplatVs' },
      fragment: {
        module: boundarySplatShader,
        entryPoint: 'boundarySplatFs',
        targets: [{
          format: targetFormat,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    boundarySplatRenderPipeline = makeBoundarySplatRenderPipeline(format, `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} raster ${gridSize}^3`);
    boundarySplatReadbackPipeline = makeBoundarySplatRenderPipeline('rgba8unorm', `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} witness readback ${gridSize}^3`);
    ensureBoundarySplatBuffers();
    ensureTemporalHistoryTexture();
    rebuildFluidBindGroups();
    majorantFrontBindGroups = [
      device.createBindGroup({
        label: `kaminos majorant fluid-front read bind group ${gridSize}^3 A`,
        layout: majorantFluidBindGroupLayout,
        entries: [
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
          { binding: 7, resource: { buffer: frontBuffers[0] } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos majorant fluid-front read bind group ${gridSize}^3 B`,
        layout: majorantFluidBindGroupLayout,
        entries: [
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
          { binding: 7, resource: { buffer: frontBuffers[1] } },
        ],
      }),
    ];
    boundarySidecarReadBindGroups = [
      device.createBindGroup({
        label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} read bind group ${gridSize}^3 A`,
        layout: boundarySidecarReadBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
          { binding: 7, resource: { buffer: frontBuffers[0] } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} read bind group ${gridSize}^3 B`,
        layout: boundarySidecarReadBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
          { binding: 7, resource: { buffer: frontBuffers[1] } },
        ],
      }),
    ];
    rebuildBoundarySplatBindGroups();
    pressureWriteBindGroup = device.createBindGroup({
      label: `kaminos pressure divergence write bind group ${gridSize}^3`,
      layout: pressureWriteBindGroupLayout,
      entries: [
        { binding: 1, resource: { buffer: pressureBuffers[0] } },
      ],
    });
    pressureJacobiBindGroups = [
      device.createBindGroup({
        label: `kaminos pressure jacobi bind group ${gridSize}^3 A to B`,
        layout: pressureJacobiBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: pressureBuffers[0] } },
          { binding: 1, resource: { buffer: pressureBuffers[1] } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos pressure jacobi bind group ${gridSize}^3 B to A`,
        layout: pressureJacobiBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: pressureBuffers[1] } },
          { binding: 1, resource: { buffer: pressureBuffers[0] } },
        ],
      }),
    ];
    pressureReadBindGroups = [
      device.createBindGroup({
        label: `kaminos pressure read bind group ${gridSize}^3 A`,
        layout: pressureReadBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: pressureBuffers[0] } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos pressure read bind group ${gridSize}^3 B`,
        layout: pressureReadBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: pressureBuffers[1] } },
        ],
      }),
    ];
    currentFluid = 0;
    currentFront = 0;
    state.simStepCount = 0;
    state.simGrid = gridSize;
    state.simGridLabel = `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer+${FRONT_FIELD_IDENTITY}`;
    state.frontFieldIdentity = FRONT_FIELD_IDENTITY;
    state.frontFieldBytes = nextFrontBufferBytes;
    state.frontFieldReadIndex = currentFront;
    state.frontFieldWriteIndex = 1 - currentFront;
    state.frontFieldProjectionPassthrough = false;
    state.majorantGrid = majorantGridSize;
    state.majorantBuilt = false;
    state.majorantFrameCount = 0;
    state.majorantCadence = normalizeMajorantBuildCadence(controlsSnapshot.majorantCadence);
    state.majorantBuiltThisFrame = false;
    state.majorantLastBuiltFrame = -1;
    state.majorantSkippedFrameCount = 0;
    state.boundarySidecarIdentity = BOUNDARY_SIDECAR_IDENTITY;
    state.boundarySidecarAuthority = BOUNDARY_SIDECAR_BAKE_AUTHORITY;
    state.boundarySidecarBytes = nextBoundarySidecarBufferBytes;
    state.boundarySidecarSource = normalizeBoundarySidecarSource(controlsSnapshot.boundarySidecarSource);
    state.boundarySidecarBuilt = false;
    state.boundarySidecarBuiltThisFrame = false;
    state.boundarySidecarFrameCount = 0;
    state.boundarySidecarLastBuiltFrame = -1;
    state.boundarySidecarOverrideReceipt = null;
    boundarySidecarOverrideUpload = null;
    state.boundaryStructureSource = state.boundarySidecarSource;
    state.boundarySidecarView = normalizeBoundarySidecarView(controlsSnapshot.boundarySidecarView ?? controlsSnapshot.boundarySidecarControls?.view);
    state.boundarySidecarDebug = boundarySidecarDebug(state.boundarySidecarSource);
    state.pressureProjectionEnabled = false;
    state.pressureProjectionIterations = 0;
    state.pressureIterationDefault = defaultPressureIterationsForScene(controlsSnapshot.volumeScene);
    state.pressureIterationRequested = normalizePressureIterationCount(controlsSnapshot.pressureIterations, controlsSnapshot.volumeScene);
    state.fluidStateResetCount += 1;
    state.fluidStateResetReason = reason;
    if (!String(reason).startsWith('native-low-shared-device-')) {
      state.nativeLowSourceHistoryEpochCount = Number(state.nativeLowSourceHistoryEpochCount || 0) + 1;
      state.nativeLowSourceHistoryEpochReason = reason;
    }
    state.fluidStateInitialization = {
      identity: 'fluid-state-initialization-v0',
      skipInitialFluid,
      reason,
    };
    resetTemporalHistory(reason);
    updateSimCostLedger();
    emitStatus({ phase: reason });
  }

  async function ensureGpu() {
    if (device) return;
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const maxRequestedFluidBufferBytes = fluidBufferBytes(Math.max(...SUPPORTED_GRID_SIZES));
    const requiredLimits = {};
    if ((adapter.limits?.maxStorageBufferBindingSize ?? 0) >= maxRequestedFluidBufferBytes) {
      requiredLimits.maxStorageBufferBindingSize = maxRequestedFluidBufferBytes;
    }
    if ((adapter.limits?.maxStorageBuffersPerShaderStage ?? 0) >= 9) {
      requiredLimits.maxStorageBuffersPerShaderStage = 9;
    }
    const requiredFeatures = [];
    if (adapter.features?.has?.('timestamp-query')) {
      requiredFeatures.push('timestamp-query');
    }
    const deviceDescriptor = {};
    if (Object.keys(requiredLimits).length) deviceDescriptor.requiredLimits = requiredLimits;
    if (requiredFeatures.length) deviceDescriptor.requiredFeatures = requiredFeatures;
    device = await adapter.requestDevice(Object.keys(deviceDescriptor).length ? deviceDescriptor : undefined);
    setBoundarySplatGpuProfile(makeBoundarySplatGpuProfile({
      timestampStatus: device.features?.has?.('timestamp-query') ? 'available' : 'unsupported',
      reason: device.features?.has?.('timestamp-query') ? 'not-sampled-yet' : 'timestamp-query-not-supported',
      candidateCopyBytes: 0,
      rendererIdentity: state.boundarySplatRendererIdentity,
    }));
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    device.addEventListener('uncapturederror', event => {
      state.error = event.error?.message || String(event.error || 'WebGPU uncaptured error');
      emitStatus({ phase: 'gpu-error', error: state.error });
    });
    uniformBuffer = device.createBuffer({
      label: 'kaminos fluid uniforms',
      size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ensureExternalEmitterBuffer();
    ensureOracleActivityCueBuffer();
    historySampler = device.createSampler({
      label: 'kaminos temporal history sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    browserResidualSampler = device.createSampler({
      label: 'kaminos browser direct residual source sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    shader = device.createShaderModule({ label: 'kaminos compute fluid raymarch wgsl', code: WGSL });
    const compilationInfo = await shader.getCompilationInfo();
    const compilationErrors = compilationInfo.messages.filter(message => message.type === 'error');
    if (compilationErrors.length > 0) {
      const detail = compilationErrors
        .map(message => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n');
      throw new Error(`WGSL compilation failed:\n${detail}`);
    }
    browserResidualShader = device.createShaderModule({ label: 'kaminos browser direct residual wgsl', code: BROWSER_RESIDUAL_WGSL });
    const residualCompilationInfo = await browserResidualShader.getCompilationInfo();
    const residualCompilationErrors = residualCompilationInfo.messages.filter(message => message.type === 'error');
    if (residualCompilationErrors.length > 0) {
      const detail = residualCompilationErrors
        .map(message => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n');
      throw new Error(`Browser residual WGSL compilation failed:\n${detail}`);
    }
    boundarySplatShader = device.createShaderModule({ label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} wgsl`, code: BOUNDARY_SPLAT_WGSL });
    const boundarySplatCompilationInfo = await boundarySplatShader.getCompilationInfo();
    const boundarySplatCompilationErrors = boundarySplatCompilationInfo.messages.filter(message => message.type === 'error');
    if (boundarySplatCompilationErrors.length > 0) {
      const detail = boundarySplatCompilationErrors
        .map(message => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n');
      throw new Error(`Boundary splat WGSL compilation failed:\n${detail}`);
    }
    bindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos fluid bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 8,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 9,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 10,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    boundarySidecarReadBindGroupLayout = device.createBindGroupLayout({
      label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} fluid-front read bind group layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    majorantFluidBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos majorant fluid-front read bind group layout',
      entries: [
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    majorantWriteBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos majorant write bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });
    boundarySidecarWriteBindGroupLayout = device.createBindGroupLayout({
      label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} write bind group layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });
    boundarySplatComputeBindGroupLayout = device.createBindGroupLayout({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} compute bind group layout`,
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    boundarySplatRenderBindGroupLayout = device.createBindGroupLayout({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} render bind group layout`,
      entries: [
        { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    pressureWriteBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos pressure write bind group layout',
      entries: [
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });
    pressureJacobiBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos pressure jacobi bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });
    pressureReadBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos pressure read bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    emptyBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos empty bind group layout',
      entries: [],
    });
    browserResidualBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos browser direct residual bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
      ],
    });
    pipelineLayout = device.createPipelineLayout({
      label: 'kaminos fluid pipeline layout',
      bindGroupLayouts: [bindGroupLayout],
    });
    browserResidualPipelineLayout = device.createPipelineLayout({
      label: 'kaminos browser direct residual pipeline layout',
      bindGroupLayouts: [browserResidualBindGroupLayout],
    });
    majorantPipelineLayout = device.createPipelineLayout({
      label: 'kaminos coarse majorant pipeline layout',
      bindGroupLayouts: [majorantFluidBindGroupLayout, majorantWriteBindGroupLayout],
    });
    boundarySidecarPipelineLayout = device.createPipelineLayout({
      label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} pipeline layout`,
      bindGroupLayouts: [boundarySidecarReadBindGroupLayout, emptyBindGroupLayout, emptyBindGroupLayout, boundarySidecarWriteBindGroupLayout],
    });
    boundarySplatComputePipelineLayout = device.createPipelineLayout({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} compute pipeline layout`,
      bindGroupLayouts: [boundarySplatComputeBindGroupLayout],
    });
    boundarySplatRenderPipelineLayout = device.createPipelineLayout({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} render pipeline layout`,
      bindGroupLayouts: [boundarySplatRenderBindGroupLayout],
    });
    pressureWritePipelineLayout = device.createPipelineLayout({
      label: 'kaminos divergence pressure pipeline layout',
      bindGroupLayouts: [majorantFluidBindGroupLayout, emptyBindGroupLayout, pressureWriteBindGroupLayout],
    });
    pressureJacobiPipelineLayout = device.createPipelineLayout({
      label: 'kaminos pressure jacobi pipeline layout',
      bindGroupLayouts: [majorantFluidBindGroupLayout, emptyBindGroupLayout, pressureJacobiBindGroupLayout],
    });
    pressureJacobiTieredPipelineLayout = device.createPipelineLayout({
      label: 'kaminos pressure tiered jacobi pipeline layout',
      bindGroupLayouts: [bindGroupLayout, emptyBindGroupLayout, pressureJacobiBindGroupLayout],
    });
    pressureProjectPipelineLayout = device.createPipelineLayout({
      label: 'kaminos pressure projection pipeline layout',
      bindGroupLayouts: [bindGroupLayout, emptyBindGroupLayout, pressureReadBindGroupLayout],
    });
    pressureProjectTieredPipelineLayout = device.createPipelineLayout({
      label: 'kaminos tiered pressure projection pipeline layout',
      bindGroupLayouts: [bindGroupLayout, emptyBindGroupLayout, pressureJacobiBindGroupLayout],
    });
    device.pushErrorScope('validation');
    rebuildFluidState(controlsSnapshot.resolution, controlsSnapshot.majorantGrid);
    if (gridSize === 160) {
      selectiveHeadLiveRuntime = await createSelectiveHeadLiveRuntime({
        device,
        sourceFluidBuffers: fluidBuffers,
        sourceFrontBuffers: frontBuffers,
      });
      rebuildSelectiveHeadLiveBindGroups();
      state.selectiveHeadLive = selectiveHeadLiveRuntime.debugState();
    }
    const pipelineError = await device.popErrorScope();
    if (pipelineError) {
      throw new Error(`fluid pipeline validation: ${pipelineError.message || String(pipelineError)}`);
    }
    state.backend = `WebGPU:${adapter.info?.vendor || 'adapter'}`;
    emitStatus({ phase: 'gpu-ready' });
  }

  function resize() {
    const rect = viewport.getBoundingClientRect();
    const win = viewport.ownerDocument?.defaultView || globalThis;
    const fallbackWidth = Math.max(1, Math.floor((win?.innerWidth || 1280) - Math.max(0, rect.left || 0)));
    const fallbackHeight = Math.max(1, Math.floor(win?.innerHeight || 720));
    const useFallbackSize = !(rect.width > 0 && rect.height > 0);
    const cssWidth = useFallbackSize ? fallbackWidth : rect.width;
    const cssHeight = useFallbackSize ? fallbackHeight : rect.height;
    const nativeDevicePixelRatio = Math.max(1, Number(win?.devicePixelRatio) || 1);
    const canvasDevicePixelRatio = boundarySplatRequested() ? nativeDevicePixelRatio : 1;
    const dpr = canvasDevicePixelRatio;
    const displayWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const displayHeight = Math.max(1, Math.floor(cssHeight * dpr));
    const renderScale = normalizeRenderScale(controlsSnapshot.renderScale);
    const renderWidth = Math.max(1, Math.floor(displayWidth * renderScale));
    const renderHeight = Math.max(1, Math.floor(displayHeight * renderScale));
    if (state.renderScale !== renderScale) {
      resetTemporalHistory('render-scale-change');
    }
    if (canvas.width !== renderWidth || canvas.height !== renderHeight || state.displayWidth !== displayWidth || state.displayHeight !== displayHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      state.width = renderWidth;
      state.height = renderHeight;
      state.cssWidth = cssWidth;
      state.cssHeight = cssHeight;
      state.displayWidth = displayWidth;
      state.displayHeight = displayHeight;
      state.nativeDevicePixelRatio = nativeDevicePixelRatio;
      state.canvasDevicePixelRatio = canvasDevicePixelRatio;
      state.viewportSizeFallback = useFallbackSize;
      state.renderWidth = renderWidth;
      state.renderHeight = renderHeight;
      state.renderScale = renderScale;
      state.renderPixelRatio = renderWidth / Math.max(1, displayWidth);
      state.volumeReconstructionStyle = browserResidualCanApply()
        ? 'webgpu-direct-residual'
        : (renderScale < 0.999 ? 'linear-css-upscale' : 'native-resolution');
      canvas.style.imageRendering = 'auto';
      frameTextureSize = '';
      browserResidualFeatureTextureSize = '';
    }
  }

  function ensureFrameTexture() {
    const key = `${state.width}x${state.height}`;
    if (frameTexture && frameTextureSize === key) return;
    frameTexture?.destroy();
    frameTexture = device.createTexture({
      label: 'kaminos volume witness frame texture',
      size: { width: state.width, height: state.height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
    });
    frameTextureSize = key;
    browserResidualBindGroup = null;
    browserResidualTextureKey = '';
  }

  function ensureBrowserResidualFeatureTexture() {
    const key = `${state.width}x${state.height}`;
    if (browserResidualFeatureTexture && browserResidualFeatureTextureSize === key) return;
    browserResidualFeatureTexture?.destroy();
    browserResidualFeatureTexture = device.createTexture({
      label: 'kaminos browser residual shader-material-authority feature texture',
      size: { width: state.width, height: state.height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    browserResidualFeatureTextureSize = key;
    browserResidualBindGroup = null;
    browserResidualTextureKey = '';
  }

  function browserResidualRequested() {
    return normalizeBrowserResidualMode(controlsSnapshot.volumeResidualMode) === 'webgpu-direct-residual';
  }

  function validateBrowserResidualModel(model, url) {
    if (!model || typeof model !== 'object') throw new Error('browser residual model is not an object');
    if (model.schema !== 'kaminos.volume.browser-residual-model.v0') throw new Error(`unsupported browser residual model schema: ${model.schema || 'missing'}`);
    if (model.authority !== 'browser-webgpu-direct-residual-v0') throw new Error(`unsupported browser residual authority: ${model.authority || 'missing'}`);
    if (model.modelArch !== 'direct-residual') throw new Error(`browser residual one-pass route requires direct-residual, got ${model.modelArch || 'missing'}`);
    const kernel = model.weights?.['output.weight'];
    const bias = model.weights?.['output.bias'];
    const inputChannels = Math.max(3, Math.min(7, Math.floor(Number(model.inputChannels) || 3)));
    if (![3, 7].includes(inputChannels)) throw new Error(`browser residual inputChannels must be 3 or 7, got ${model.inputChannels || 'missing'}`);
    if (!Array.isArray(kernel?.data) || kernel.data.length !== 27 * inputChannels) throw new Error(`browser residual output.weight must contain ${27 * inputChannels} floats for ${inputChannels} input channels`);
    if (!Array.isArray(bias?.data) || bias.data.length !== 3) throw new Error('browser residual output.bias must contain 3 floats');
    const featureInputMode = model.featureInputMode || 'rgb';
    if (inputChannels === 7 && featureInputMode !== 'feature-rgba') throw new Error(`browser residual 7-channel model must declare feature-rgba, got ${featureInputMode}`);
    if (inputChannels === 3 && featureInputMode === 'feature-rgba') throw new Error('browser residual feature-rgba model must carry 7 input channels');
    const residualLimit = Number(model.residualOutputLimit);
    if (!(residualLimit > 0)) throw new Error('browser residual residualOutputLimit must be positive');
    const residualApplyScale = Number.isFinite(Number(model.residualApplyScale))
      ? Math.max(0, Number(model.residualApplyScale))
      : 1.0;
    return {
      ...model,
      url,
      inputChannels,
      featureInputMode,
      browserResidualInputChannels: inputChannels,
      residualOutputLimit: residualLimit,
      residualApplyScale,
      edgeBandThreshold: Math.max(0.0001, Number(model.edgeBandThreshold) || 0.015),
      residualWeights: [...kernel.data.map(Number), ...bias.data.map(Number)],
    };
  }

  async function ensureBrowserResidualModel() {
    state.volumeResidualMode = normalizeBrowserResidualMode(controlsSnapshot.volumeResidualMode);
    state.volumeResidualModelUrl = String(controlsSnapshot.volumeResidualModelUrl || '');
    state.volumeResidualStrength = normalizeBrowserResidualStrength(controlsSnapshot.volumeResidualStrength);
    if (!browserResidualRequested()) {
      state.volumeResidualStatus = 'off';
      state.volumeResidualAuthority = 'off';
      state.volumeResidualFeatureAuthority = 'off';
      state.volumeResidualModelSchema = null;
      state.volumeResidualModelError = null;
      return;
    }
    if (!state.volumeResidualModelUrl) {
      browserResidualModel = null;
      browserResidualModelUrl = '';
      state.volumeResidualStatus = 'missing-model-url';
      state.volumeResidualAuthority = 'off';
      state.volumeResidualFeatureAuthority = 'off';
      state.volumeResidualModelSchema = null;
      state.volumeResidualModelError = 'volume_residual_model_url is required for webgpu-direct-residual';
      return;
    }
    if (browserResidualModel && browserResidualModelUrl === state.volumeResidualModelUrl) {
      state.volumeResidualStatus = 'loaded';
      state.volumeResidualAuthority = browserResidualModel.authority;
      state.volumeResidualFeatureAuthority = BROWSER_RESIDUAL_FEATURE_AUTHORITY;
      state.volumeResidualModelSchema = browserResidualModel.schema;
      state.volumeResidualModelError = null;
      return;
    }
    if (!browserResidualLoadPromise || browserResidualModelUrl !== state.volumeResidualModelUrl) {
      const url = state.volumeResidualModelUrl;
      browserResidualModelUrl = url;
      state.volumeResidualStatus = 'loading';
      browserResidualLoadPromise = fetch(url, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`browser residual model fetch failed ${response.status} ${response.statusText}`);
          return response.json();
        })
        .then(json => validateBrowserResidualModel(json, url));
    }
    try {
      browserResidualModel = await browserResidualLoadPromise;
      state.volumeResidualStatus = 'loaded';
      state.volumeResidualAuthority = browserResidualModel.authority;
      state.volumeResidualFeatureAuthority = BROWSER_RESIDUAL_FEATURE_AUTHORITY;
      state.volumeResidualModelSchema = browserResidualModel.schema;
      state.volumeResidualModelError = null;
      writeBrowserResidualBuffer();
    } catch (err) {
      browserResidualModel = null;
      browserResidualBindGroup = null;
      state.volumeResidualStatus = 'error';
      state.volumeResidualAuthority = 'off';
      state.volumeResidualFeatureAuthority = 'off';
      state.volumeResidualModelSchema = null;
      state.volumeResidualModelError = err?.message || String(err);
      emitStatus({ phase: 'browser-residual-error', error: state.volumeResidualModelError });
    }
  }

  function writeBrowserResidualBuffer() {
    if (!device || !browserResidualModel) return;
    const residualDataHeaderFloats = 16;
    const inputChannels = browserResidualModel.inputChannels || 3;
    const weightCount = 27 * inputChannels;
    const biasCount = 3;
    const paramCount = 5;
    const data = new Float32Array(residualDataHeaderFloats + weightCount + biasCount + paramCount);
    data[0] = inputChannels;
    data.set(browserResidualModel.residualWeights.slice(0, weightCount + biasCount), residualDataHeaderFloats);
    const paramsOffset = residualDataHeaderFloats + weightCount + biasCount;
    data[paramsOffset + 0] = browserResidualModel.residualOutputLimit;
    data[paramsOffset + 1] = browserResidualModel.edgeBandThreshold;
    data[paramsOffset + 2] = normalizeBrowserResidualStrength(controlsSnapshot.volumeResidualStrength);
    data[paramsOffset + 3] = browserResidualModel.residualApplyScale;
    data[paramsOffset + 4] = normalizeBrowserResidualFeatureDebug(controlsSnapshot.volumeResidualFeatureDebug);
    if (!browserResidualBuffer || browserResidualBufferSize !== data.byteLength) {
      browserResidualBuffer?.destroy();
      browserResidualBuffer = device.createBuffer({
        label: 'kaminos browser direct residual weights',
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      browserResidualBufferSize = data.byteLength;
      browserResidualBindGroup = null;
      browserResidualTextureKey = '';
    }
    device.queue.writeBuffer(browserResidualBuffer, 0, data);
  }

  function browserResidualCanApply() {
    return browserResidualRequested()
      && browserResidualModel
      && browserResidualPipeline
      && browserResidualSourcePipeline
      && browserResidualSampler
      && browserResidualBuffer
      && state.volumeResidualStatus === 'loaded';
  }

  function ensureBrowserResidualBindGroup() {
    if (!browserResidualCanApply()) return null;
    const key = `${state.width}x${state.height}:${browserResidualModel.url}:${state.volumeResidualStrength}:${state.volumeResidualFeatureDebug}`;
    if (browserResidualBindGroup && browserResidualTextureKey === key) return browserResidualBindGroup;
    writeBrowserResidualBuffer();
    browserResidualBindGroup = device.createBindGroup({
      label: 'kaminos browser direct residual bind group',
      layout: browserResidualBindGroupLayout,
      entries: [
        { binding: 0, resource: frameTexture.createView() },
        { binding: 1, resource: browserResidualSampler },
        { binding: 2, resource: { buffer: browserResidualBuffer } },
        { binding: 3, resource: browserResidualFeatureTexture.createView() },
      ],
    });
    browserResidualTextureKey = key;
    return browserResidualBindGroup;
  }

  function updateUniforms(now) {
    resize();
    camera.updateMatrixWorld();
    maybeResetTemporalHistoryForCamera();
    ensureTemporalHistoryTexture();
    const lookFreeze = normalizeLookFreeze(controlsSnapshot.lookFreeze) && lookFreezeCanPin(state) ? 1 : 0;
    if (lookFreeze) {
      if (state.lookFreezeFrame === null) state.lookFreezeFrame = state.frameCount;
    } else {
      state.lookFreezeTimeSeconds = null;
    }
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    invViewProj.copy(viewProj).invert();
    if (!previousViewProjReady) {
      previousViewProj.copy(viewProj);
      previousViewProjReady = true;
    }
    if (boundarySplatCameraBuffer) {
      const cameraMatrix = camera.matrixWorld.elements;
      const splatCamera = new Float32Array(32);
      splatCamera.set(viewProj.elements, 0);
      splatCamera.set([cameraMatrix[0], cameraMatrix[1], cameraMatrix[2], 0], 16);
      splatCamera.set([cameraMatrix[4], cameraMatrix[5], cameraMatrix[6], 0], 20);
      splatCamera.set([normalizeBoundarySplatRadius(controlsSnapshot.boundarySplatRadius), boundarySplatLearnedAttributesRequested() ? 1 : 0, state.boundarySplatFeatureCaptureEffective ? 1 : 0, normalizeBoundarySplatSharpness(controlsSnapshot.boundarySplatSharpness)], 24);
      splatCamera.set([
        normalizeNativeLowTreatmentSplatRadianceGain(controlsSnapshot.nativeLowTreatmentSplatRadianceGain),
        normalizeNativeLowTreatmentSplatOpacityGain(controlsSnapshot.nativeLowTreatmentSplatOpacityGain),
        0,
        0,
      ], 28);
      device.queue.writeBuffer(boundarySplatCameraBuffer, 0, splatCamera);
    }
    const { renderPhaseTimeMs, renderPhaseFrame } = updateRenderPhaseState(now, state, lookFreeze);
    uniforms.set(invViewProj.elements, 0);
    uniforms[16] = camera.position.x;
    uniforms[17] = camera.position.y;
    uniforms[18] = camera.position.z;
    uniforms[19] = renderPhaseTimeMs * 0.001;
    uniforms[20] = state.width;
    uniforms[21] = state.height;
    uniforms[22] = controlsSnapshot.raySteps;
    uniforms[23] = controlsSnapshot.density;
    uniforms[24] = controlsSnapshot.fire;
    uniforms[25] = controlsSnapshot.smoke;
    uniforms[26] = controlsSnapshot.curl;
    uniforms[27] = controlsSnapshot.speed;
    uniforms[28] = controlsSnapshot.gridOverlay || 0;
    uniforms[29] = controlsSnapshot.microdetail ?? 1.55;
    uniforms[30] = controlsSnapshot.interfaceShred ?? 1.55;
    uniforms[31] = controlsSnapshot.fireLicks ?? 1.65;
    const sourcePrimitive = getPrimitiveSource();
    uniforms[32] = sourcePrimitive.radius;
    uniforms[33] = sourcePrimitive.flowRate;
    uniforms[34] = controlsSnapshot.projection ?? 0.65;
    uniforms[35] = controlsSnapshot.flowDebug || 0;
    uniforms[36] = controlsSnapshot.radiance ?? 1.65;
    uniforms[37] = controlsSnapshot.absorption ?? 0.85;
    uniforms[38] = controlsSnapshot.glow ?? 1.15;
    uniforms[39] = controlsSnapshot.adaptiveRays ?? 0.65;
    uniforms[40] = controlsSnapshot.occupancySkip ?? 0.35;
    uniforms[41] = controlsSnapshot.majorantSkip ?? 0.70;
    uniforms[42] = controlsSnapshot.majorantSmooth ?? 0.85;
    uniforms[43] = controlsSnapshot.majorantGuard ?? 0.75;
    const bonfireAblation = normalizeBonfireAblationControls(controlsSnapshot);
    const baseTemporalAccum = Math.max(0, Math.min(0.85, controlsSnapshot.temporalAccum ?? 0.25));
    const requestedTemporalAccum = Math.max(0, Math.min(0.85, baseTemporalAccum * bonfireAblation.temporal));
    uniforms[44] = lookFreeze ? 0 : (historyValid ? requestedTemporalAccum : 0);
    uniforms[45] = lookFreeze ? 0 : (controlsSnapshot.temporalJitter ?? 0.85);
    uniforms[46] = controlsSnapshot.historyClamp ?? 0.70;
    uniforms[47] = renderPhaseFrame % 4096;
    uniforms[48] = controlsSnapshot.fireScale ?? 0.86;
    uniforms[49] = controlsSnapshot.detailScale ?? 1.75;
    uniforms[50] = controlsSnapshot.plumeHeight ?? 1.45;
    updateExternalEmitterDebug(now);
    uniforms[51] = state.externalEmitterCount;
    uniforms[52] = volumeSceneMode(controlsSnapshot.volumeScene);
    uniforms[53] = normalizeWindStrength(controlsSnapshot.windStrength);
    uniforms[54] = normalizeWindAngle(controlsSnapshot.windAngle) * Math.PI / 180;
    uniforms[55] = normalizeWindHeight(controlsSnapshot.windHeight);
    uniforms[56] = bonfireAblation.recenter;
    uniforms[57] = bonfireAblation.lateralDamping;
    uniforms[58] = bonfireAblation.shear;
    uniforms[59] = bonfireAblation.detailForces;
    uniforms[60] = bonfireAblation.depinch;
    uniforms[61] = bonfireAblation.projection;
    uniforms[62] = bonfireAblation.temporal;
    uniforms[63] = bonfireAblation.instabilityProbe;
    uniforms[64] = Math.max(0, Math.min(1.6, controlsSnapshot.canonicalSpread ?? 1));
    uniforms[65] = Math.max(0, Math.min(1.8, controlsSnapshot.canonicalCenterline ?? 1));
    uniforms[66] = Math.max(0, Math.min(1.5, controlsSnapshot.canonicalBodyBalance ?? 0));
    uniforms[67] = canonicalSourceModeValue(controlsSnapshot.canonicalSourceMode);
    uniforms[68] = Math.max(-0.92, Math.min(-0.20, controlsSnapshot.canonicalSourceY ?? -0.74));
    uniforms[69] = Math.max(0, Math.min(1.5, controlsSnapshot.canonicalSourceInjection ?? 1));
    uniforms[70] = Math.max(0, Math.min(1.5, controlsSnapshot.canonicalBuoyancy ?? 1));
    uniforms[71] = normalizeReactionFuelScale(controlsSnapshot.reactionFuelScale);
    uniforms[72] = canonicalRenderModeValue(controlsSnapshot.canonicalRenderMode);
    uniforms[73] = canonicalMotionModeValue(controlsSnapshot.canonicalMotionMode);
    uniforms[74] = canonicalContentModeValue(controlsSnapshot.canonicalContentMode);
    const quenchVaporStrength = snuffQuenchVaporStrength(controlsSnapshot);
    uniforms[75] = quenchVaporStrength;
    const pressureTierControls = normalizePressureTierControls(controlsSnapshot);
    uniforms[76] = pressureTierControls.lowerMax;
    uniforms[77] = pressureTierControls.heroMin;
    uniforms[78] = pressureTierControls.heroMax;
    uniforms[79] = pressureTierControls.overlay;
    uniforms[80] = sourcePrimitive.position[0];
    uniforms[81] = sourcePrimitive.position[1];
    uniforms[82] = sourcePrimitive.position[2];
    uniforms[83] = volumePrimitives.length > 0 ? 1 : 0;
    const pyroCompareMode = normalizePyroCompareMode(controlsSnapshot.pyroCompareMode);
    const frozenPyroDetail = lookFreeze && state.pyroDynamicDetail?.materialMemory ? state.pyroDynamicDetail : null;
    const pyroDetailForRender = frozenPyroDetail || updatePyroDynamicDetailState({ inputKind: 'control-proxy' });
    if (frozenPyroDetail) {
      state.pyroDynamicDetail = {
        ...frozenPyroDetail,
        frozen: true,
        freezeFrame: state.lookFreezeFrame ?? state.frameCount,
        lastInputKind: 'look-lab-frozen',
      };
    }
    const materialMemory = pyroDetailForRender.materialMemory || {};
    const pyroMaterialRequestedGain = Math.max(0, Math.min(1.5, controlsSnapshot.pyroMaterialGain ?? 0));
    const pyroMaterialSampleable = pyroMaterialRequestedGain > 0 && materialMemory.shaderReadiness === 'sampleable-debug-only';
    const pyroCompareMuted = pyroCompareMode === 'base';
    const pyroMaterialGain = pyroMaterialSampleable && !pyroCompareMuted ? pyroMaterialRequestedGain : 0;
    const pyroMaterialEnergy = pyroMaterialSampleable && !pyroCompareMuted ? Math.max(0, Math.min(1, materialMemory.energyMean ?? pyroDetailForRender.stateEnergy ?? 0)) : 0;
    const pyroMaterialLiveAuthority = pyroMaterialSampleable && !pyroCompareMuted ? Math.max(0, Math.min(1, pyroDetailForRender.liveFireAuthority ?? 0)) : 0;
    const pyroMaterialSmokeAuthority = pyroMaterialSampleable && !pyroCompareMuted ? Math.max(0, Math.min(1, pyroDetailForRender.smokeAuthority ?? 0)) : 0;
    uniforms[84] = pyroMaterialGain;
    uniforms[85] = pyroMaterialEnergy;
    uniforms[86] = pyroMaterialLiveAuthority;
    uniforms[87] = pyroMaterialSmokeAuthority;
    const materialSamples = Array.isArray(materialMemory.sampleVector4) ? materialMemory.sampleVector4 : [];
    let uploadedPyroMaterialCells = 0;
    for (let memoryIndex = 0; memoryIndex < 24; memoryIndex += 1) {
      const sample = pyroMaterialSampleable && !pyroCompareMuted && Array.isArray(materialSamples[memoryIndex])
        ? materialSamples[memoryIndex]
        : [0, 0, 0, 0];
      uniforms[88 + memoryIndex * 4] = sample[0] ?? 0;
      uniforms[89 + memoryIndex * 4] = sample[1] ?? 0;
      uniforms[90 + memoryIndex * 4] = sample[2] ?? 0;
      uniforms[91 + memoryIndex * 4] = sample[3] ?? 0;
      if (pyroMaterialSampleable && !pyroCompareMuted) uploadedPyroMaterialCells += 1;
    }
    const pyroInterfaceFocus = Math.max(0, Math.min(1, controlsSnapshot.pyroInterfaceFocus ?? 0.75));
    const pyroEdgeBite = Math.max(0, Math.min(1, controlsSnapshot.pyroEdgeBite ?? 0.35));
    const pyroBiteBorderFocus = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteBorder ?? 0.45));
    const pyroBiteTeeth = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteTeeth ?? 0.55));
    const pyroBiteWake = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteWake ?? 0.25));
    const pyroBiteHeight = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteHeight ?? 0.35));
    const pyroBiteFireLock = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteFireLock ?? 0.75));
    const pyroBiteCore = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteCore ?? 0));
    const pyroBiteCoreCut = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteCoreCut ?? 0.45));
    const pyroBiteRim = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteRim ?? 0));
    const pyroBiteRimCut = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteRimCut ?? 0.55));
    const pyroBiteAfter = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteAfter ?? 0));
    const pyroBiteAfterCut = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteAfterCut ?? 0.50));
    const pyroSmokeFold = Math.max(0, Math.min(1, controlsSnapshot.pyroSmokeFold ?? 0.25));
    const pyroFoldBorderFocus = Math.max(0, Math.min(1, controlsSnapshot.pyroFoldBorder ?? 0.35));
    const pyroFoldWake = Math.max(0, Math.min(1, controlsSnapshot.pyroFoldWake ?? 0.35));
    const pyroWakeLift = Math.max(0, Math.min(1, controlsSnapshot.pyroWakeLift ?? 0.45));
    const pyroWakeWarmth = Math.max(0, Math.min(1, controlsSnapshot.pyroWakeWarmth ?? 0.35));
    const pyroContrastRadiance = pyroCompareMuted ? 0 : Math.max(0, Math.min(10, controlsSnapshot.pyroRadiance ?? 0));
    const pyroRadianceGate = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceGate ?? 0.62));
    const pyroRadianceSpill = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceSpill ?? 0.30));
    const pyroRadianceWarmth = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceWarmth ?? 0.45));
    const pyroBiteHeat = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteHeat ?? 0.65));
    const pyroBiteChroma = Math.max(0, Math.min(1, controlsSnapshot.pyroBiteChroma ?? 0.55));
    const pyroRadianceHue = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceHue ?? 0.50));
    const pyroRadianceChroma = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceChroma ?? 0.55));
    const pyroFireModeName = normalizePyroFireMode(controlsSnapshot.pyroFireMode);
    const pyroFireMode = pyroFireModeValue(pyroFireModeName);
    const pyroRadianceSource = pyroRadianceSourceValue(controlsSnapshot.pyroRadianceSource);
    const pyroRadianceHeight = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceHeight ?? 0.45));
    const pyroRadianceBorder = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceBorder ?? 0.55));
    const pyroRadianceTeeth = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceTeeth ?? 0.45));
    const pyroFlamePaint = pyroCompareMuted ? 0 : Math.max(0, Math.min(3, controlsSnapshot.pyroFlamePaint ?? 0));
    const pyroFlameLuma = Math.max(0, Math.min(3, controlsSnapshot.pyroFlameLuma ?? 1));
    const pyroStockMix = Math.max(0, Math.min(1, controlsSnapshot.pyroStockMix ?? 1));
    const pyroBiteLuma = Math.max(0, Math.min(3, controlsSnapshot.pyroBiteLuma ?? 1));
    const pyroWakeLuma = Math.max(0, Math.min(3, controlsSnapshot.pyroWakeLuma ?? 1));
    const pyroRadianceLuma = Math.max(0, Math.min(3, controlsSnapshot.pyroRadianceLuma ?? 1));
    const pyroRadianceRise = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceRise ?? 0.45));
    const pyroRadianceFireLock = Math.max(0, Math.min(1, controlsSnapshot.pyroRadianceFireLock ?? 0.65));
    const pyroFlowBite = pyroCompareMuted ? 0 : Math.max(0, Math.min(3, controlsSnapshot.pyroFlowBite ?? 0));
    const pyroFlowBorder = Math.max(0, Math.min(1, controlsSnapshot.pyroFlowBorder ?? 0.55));
    const pyroFlowTeeth = Math.max(0, Math.min(1, controlsSnapshot.pyroFlowTeeth ?? 0.55));
    const pyroFlowRise = Math.max(0, Math.min(1, controlsSnapshot.pyroFlowRise ?? 0.50));
    const pyroFlowFireLock = Math.max(0, Math.min(1, controlsSnapshot.pyroFlowFireLock ?? 0.55));
    const pyroFlowLuma = Math.max(0, Math.min(3, controlsSnapshot.pyroFlowLuma ?? 1));
    const pyroFlowRadiance = Math.max(0, Math.min(4, controlsSnapshot.pyroFlowRadiance ?? 0));
    const pyroFlowSpikes = Math.max(0, Math.min(1, controlsSnapshot.pyroFlowSpikes ?? 0.35));
    const pyroDiagnosticPaint = pyroCompareMuted ? 0 : Math.max(0, Math.min(1, controlsSnapshot.pyroDiagnosticPaint ?? 0));
    uniforms[184] = pyroInterfaceFocus;
    uniforms[185] = pyroEdgeBite;
    uniforms[186] = pyroSmokeFold;
    uniforms[187] = pyroDiagnosticPaint;
    const pyroCarrierViewMode = pyroCarrierViewModeValue(controlsSnapshot.pyroCarrierView);
    const pyroCarrierOverdrive = Math.max(1, Math.min(8, controlsSnapshot.pyroOverdrive ?? 1));
    uniforms[188] = pyroCarrierViewMode;
    uniforms[189] = pyroCarrierOverdrive;
    uniforms[190] = pyroBiteBorderFocus;
    uniforms[191] = pyroFoldBorderFocus;
    uniforms[192] = pyroBiteTeeth;
    uniforms[193] = pyroBiteWake;
    uniforms[194] = pyroFoldWake;
    uniforms[195] = pyroFireMode;
    uniforms[196] = pyroContrastRadiance;
    uniforms[197] = pyroRadianceGate;
    uniforms[198] = pyroRadianceSpill;
    uniforms[199] = pyroRadianceWarmth;
    uniforms[200] = pyroBiteHeat;
    uniforms[201] = pyroBiteChroma;
    uniforms[202] = pyroRadianceHue;
    uniforms[203] = pyroRadianceChroma;
    uniforms[204] = pyroBiteHeight;
    uniforms[205] = pyroBiteFireLock;
    uniforms[206] = pyroWakeLift;
    uniforms[207] = pyroWakeWarmth;
    uniforms[208] = pyroRadianceSource;
    uniforms[209] = pyroRadianceHeight;
    uniforms[210] = pyroRadianceBorder;
    uniforms[211] = pyroRadianceTeeth;
    uniforms[212] = pyroFlamePaint;
    uniforms[213] = pyroFlameLuma;
    uniforms[214] = pyroStockMix;
    uniforms[215] = pyroBiteLuma;
    uniforms[216] = pyroWakeLuma;
    uniforms[217] = pyroRadianceLuma;
    uniforms[218] = pyroRadianceRise;
    uniforms[219] = pyroRadianceFireLock;
    uniforms[220] = pyroBiteCore;
    uniforms[221] = pyroBiteCoreCut;
    uniforms[222] = pyroBiteRim;
    uniforms[223] = pyroBiteRimCut;
    uniforms[224] = pyroBiteAfter;
    uniforms[225] = pyroBiteAfterCut;
    uniforms[226] = 0;
    uniforms[227] = 0;
    uniforms[228] = pyroFlowBite;
    uniforms[229] = pyroFlowBorder;
    uniforms[230] = pyroFlowTeeth;
    uniforms[231] = pyroFlowRise;
    uniforms[232] = pyroFlowFireLock;
    uniforms[233] = pyroFlowLuma;
    uniforms[234] = pyroFlowRadiance;
    uniforms[235] = pyroFlowSpikes;
    writePyroPaletteUniform(uniforms, 236, controlsSnapshot.pyroFlameCoreColor, '#fff4b8');
    writePyroPaletteUniform(uniforms, 240, controlsSnapshot.pyroFlameEdgeColor, '#ff8a24');
    writePyroPaletteUniform(uniforms, 244, controlsSnapshot.pyroBiteEmberColor, '#e65a1a');
    writePyroPaletteUniform(uniforms, 248, controlsSnapshot.pyroBiteHotColor, '#fff4b8');
    writePyroPaletteUniform(uniforms, 252, controlsSnapshot.pyroWakeShadowColor, '#384c50');
    writePyroPaletteUniform(uniforms, 256, controlsSnapshot.pyroWakeEmberColor, '#b06a2a');
    writePyroPaletteUniform(uniforms, 260, controlsSnapshot.pyroRadianceCoolColor, '#7aa8b8');
    writePyroPaletteUniform(uniforms, 264, controlsSnapshot.pyroRadianceWarmColor, '#d18438');
    writePyroPaletteUniform(uniforms, 268, controlsSnapshot.pyroFlowCoolColor, '#2aa7b8');
    writePyroPaletteUniform(uniforms, 272, controlsSnapshot.pyroFlowHotColor, '#ff7a36');
    const fireRenderModeName = normalizeFireRenderMode(controlsSnapshot.fireRenderMode);
    const shellInspectModeName = normalizeShellInspectMode(controlsSnapshot.shellInspectMode);
    const boundarySidecarSourceName = normalizeBoundarySidecarSource(controlsSnapshot.boundarySidecarSource);
    const boundarySidecarViewName = normalizeBoundarySidecarView(controlsSnapshot.boundarySidecarView ?? controlsSnapshot.boundarySidecarControls?.view);
    const boundarySidecarControls = controlsSnapshot.boundarySidecarControls || {};
    const boundaryFireInspectActive = shellInspectModeName === 'boundary_fire';
    const boundaryInspectActive = shellInspectModeName === 'boundary' || boundaryFireInspectActive;
    const boundaryControls = controlsSnapshot.reactionBoundaryControls || {};
    const boundaryFireControls = controlsSnapshot.reactionBoundaryFireControls || {};
    const boundaryUniforms = {
      identity: boundaryControls.identity || 'reaction-boundary-live-controls-v0',
      gradientGain: Math.max(0, Math.min(4, boundaryControls.gradientGain ?? controlsSnapshot.reactionBoundaryGradient ?? 2.60)),
      supportThermal: Math.max(0, Math.min(2, boundaryControls.supportThermal ?? controlsSnapshot.reactionBoundarySupportThermal ?? 0.10)),
      supportReaction: Math.max(0, Math.min(2, boundaryControls.supportReaction ?? controlsSnapshot.reactionBoundarySupportReaction ?? 0.26)),
      supportFront: Math.max(0, Math.min(2, boundaryControls.supportFront ?? controlsSnapshot.reactionBoundarySupportFront ?? 1.60)),
      supportInterface: Math.max(0, Math.min(2, boundaryControls.supportInterface ?? controlsSnapshot.reactionBoundarySupportInterface ?? 1.46)),
      cut: Math.max(0, Math.min(0.55, boundaryControls.cut ?? controlsSnapshot.reactionBoundaryCut ?? 0.30)),
      softness: Math.max(0.005, Math.min(0.45, boundaryControls.softness ?? controlsSnapshot.reactionBoundarySoftness ?? 0.08)),
      coreReject: Math.max(0, Math.min(1, boundaryControls.coreReject ?? controlsSnapshot.reactionBoundaryCoreReject ?? 0.92)),
      topologyGain: Math.max(0, Math.min(2.5, boundaryControls.topologyGain ?? controlsSnapshot.reactionBoundaryTopology ?? 0.90)),
      curlGain: Math.max(0, Math.min(2, boundaryControls.curlGain ?? controlsSnapshot.reactionBoundaryCurl ?? 0.70)),
      divergenceGain: Math.max(0, Math.min(1, boundaryControls.divergenceGain ?? controlsSnapshot.reactionBoundaryDivergence ?? 0.05)),
      displayContrast: Math.max(0.25, Math.min(5, boundaryControls.displayContrast ?? controlsSnapshot.reactionBoundaryContrast ?? 1.35)),
      displayGamma: Math.max(0.35, Math.min(3, boundaryControls.displayGamma ?? controlsSnapshot.reactionBoundaryGamma ?? 1.05)),
      displayOpacity: Math.max(0, Math.min(3, boundaryControls.displayOpacity ?? controlsSnapshot.reactionBoundaryOpacity ?? 0.70)),
    };
    const boundaryFireUniforms = {
      identity: boundaryFireControls.identity || 'reaction-boundary-fire-controls-v0',
      ridgeGain: Math.max(0, Math.min(2, boundaryFireControls.ridgeGain ?? controlsSnapshot.reactionBoundaryFireRidge ?? 1.76)),
      ridgeCut: Math.max(0, Math.min(0.55, boundaryFireControls.ridgeCut ?? controlsSnapshot.reactionBoundaryFireRidgeCut ?? 0.040)),
      tipBreakup: Math.max(0, Math.min(2, boundaryFireControls.tipBreakup ?? controlsSnapshot.reactionBoundaryFireTip ?? 1.80)),
      topologyErosion: Math.max(0, Math.min(1, boundaryFireControls.topologyErosion ?? controlsSnapshot.reactionBoundaryFireErosion ?? 0.55)),
      cleanBlue: Math.max(0, Math.min(2, boundaryFireControls.cleanBlue ?? controlsSnapshot.reactionBoundaryFireCleanBlue ?? 0.90)),
      sootYield: Math.max(0, Math.min(2, boundaryFireControls.sootYield ?? controlsSnapshot.reactionBoundaryFireSoot ?? 0.72)),
      sootYellowing: Math.max(0, Math.min(2, boundaryFireControls.sootYellowing ?? controlsSnapshot.reactionBoundaryFireYellow ?? 0.86)),
      thermalWarmth: Math.max(0, Math.min(2, boundaryFireControls.thermalWarmth ?? controlsSnapshot.reactionBoundaryFireWarmth ?? 0.92)),
      fireLuma: Math.max(0, Math.min(5, boundaryFireControls.fireLuma ?? controlsSnapshot.reactionBoundaryFireLuma ?? 1.05)),
    };
    uniforms[276] = fireRenderModeValue(fireRenderModeName);
    uniforms[277] = shellInspectModeValue(shellInspectModeName);
    uniforms[278] = Math.max(0, Math.min(2, controlsSnapshot.shellAmount ?? 1.10));
    uniforms[279] = Math.max(0.05, Math.min(2, controlsSnapshot.shellWidth ?? 0.90));
    uniforms[280] = boundaryInspectActive ? boundaryUniforms.supportThermal : Math.max(0, Math.min(2, controlsSnapshot.shellThermal ?? 0.85));
    uniforms[281] = boundaryInspectActive ? boundaryUniforms.supportReaction : Math.max(0, Math.min(2, controlsSnapshot.shellReaction ?? 1.10));
    uniforms[282] = boundaryInspectActive ? boundaryUniforms.supportFront : Math.max(0, Math.min(2, controlsSnapshot.shellFront ?? 1.25));
    uniforms[283] = boundaryInspectActive ? boundaryUniforms.supportInterface : Math.max(0, Math.min(2, controlsSnapshot.shellEdge ?? 0.85));
    uniforms[284] = boundaryInspectActive ? boundaryUniforms.coreReject : Math.max(0, Math.min(1, controlsSnapshot.shellCoreSuppress ?? 0.55));
    uniforms[285] = boundaryInspectActive ? boundaryUniforms.topologyGain : Math.max(0, Math.min(2, controlsSnapshot.shellBite ?? 0.80));
    uniforms[286] = boundaryInspectActive ? boundaryUniforms.curlGain : Math.max(0, Math.min(2, controlsSnapshot.shellCurl ?? 0.25));
    uniforms[287] = boundaryInspectActive ? boundaryUniforms.divergenceGain : Math.max(0, Math.min(1, controlsSnapshot.shellDivergence ?? 0.00));
    uniforms[288] = boundaryInspectActive ? boundaryUniforms.gradientGain : Math.max(0, Math.min(2, controlsSnapshot.shellSmoke ?? 0.25));
    uniforms[289] = boundaryInspectActive ? boundaryUniforms.cut : 0;
    uniforms[290] = boundaryInspectActive ? boundaryUniforms.softness : 0;
    uniforms[291] = boundaryInspectActive ? boundaryUniforms.displayOpacity : 0;
    uniforms[292] = boundaryInspectActive ? boundaryUniforms.displayContrast : Math.max(0, Math.min(5, controlsSnapshot.shellLuma ?? 1.35));
    uniforms[293] = boundaryInspectActive ? boundaryUniforms.displayGamma : Math.max(0, Math.min(4, controlsSnapshot.shellExposure ?? 1.15));
    uniforms[294] = Math.max(0.2, Math.min(4, controlsSnapshot.shellSoftClip ?? 1.60));
    uniforms[295] = Math.max(0, Math.min(4, controlsSnapshot.shellHeat ?? 1.65));
    uniforms[296] = boundaryFireUniforms.ridgeGain;
    uniforms[297] = boundaryFireUniforms.ridgeCut;
    uniforms[298] = boundaryFireUniforms.tipBreakup;
    uniforms[299] = boundaryFireUniforms.topologyErosion;
    uniforms[300] = boundaryFireUniforms.cleanBlue;
    uniforms[301] = boundaryFireUniforms.sootYield;
    uniforms[302] = boundaryFireUniforms.sootYellowing;
    uniforms[303] = boundaryFireUniforms.thermalWarmth;
    uniforms[304] = boundaryFireUniforms.fireLuma;
    uniforms[305] = 0;
    uniforms[306] = 0;
    uniforms[307] = 0;
    uniforms[308] = boundarySidecarSourceValue(boundarySidecarSourceName);
    uniforms[309] = clampFinite(boundarySidecarControls.blur ?? controlsSnapshot.boundarySidecarBlur, 0, 1, 0.45);
    uniforms[310] = clampFinite(boundarySidecarControls.stepWidth ?? controlsSnapshot.boundarySidecarWidth, 0, 2, 0.75);
    uniforms[311] = clampFinite(boundarySidecarControls.ridgeGain ?? controlsSnapshot.boundarySidecarRidge, 0, 2, 1);
    uniforms[312] = boundarySidecarViewValue(boundarySidecarViewName);
    const selectiveCompositionRequest = selectiveHeadLiveRenderCompositionRequest(controlsSnapshot.selectiveHeadLiveRenderComposition);
    const selectiveCompositionDefinition = selectiveCompositionRequest.definition;
    uniforms[313] = 0;
    uniforms[314] = 0;
    uniforms[315] = 0;
    uniforms[316] = 1 - selectiveCompositionDefinition.raymarchFireAuthority;
    uniforms[317] = selectiveCompositionDefinition.raymarch ? 1 : 0;
    uniforms[318] = selectiveCompositionDefinition.splat ? 1 : 0;
    uniforms[319] = 0;
    const scalarActivityReceiver = normalizeScalarActivityReceiverControls(controlsSnapshot);
    const externalCueActive = ['uploaded', 'gpu-projected'].includes(oracleActivityCueUpload.status)
      && oracleActivityCueUpload.externalCueCellCount > 0;
    uniforms[320] = scalarActivityReceiver.enabled;
    uniforms[321] = scalarActivityReceiver.curlNoiseGain;
    uniforms[322] = scalarActivityReceiver.vorticityGain;
    uniforms[323] = scalarActivityReceiver.materialGain;
    uniforms[324] = scalarActivityReceiver.display;
    uniforms[325] = externalCueActive ? 1 : 0;
    uniforms[326] = oracleActivityCueUpload.grid || 0;
    uniforms[327] = oracleActivityCueUpload.externalCueCellCount || 0;
    uniforms.set(previousViewProj.elements, 328);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    state.gridOverlay = controlsSnapshot.gridOverlay || 0;
    state.lookFreeze = lookFreeze;
    state.pyroCompareMode = pyroCompareMode;
    state.pyroCompareMuted = pyroCompareMuted;
    state.legacyPyroBackedOff = controlsSnapshot.legacyPyroBackedOff === true;
    state.fireRenderMode = fireRenderModeName;
    state.shellInspectMode = shellInspectModeName;
    state.topologyShellControls = {
      amount: uniforms[278],
      width: uniforms[279],
      thermal: uniforms[280],
      reaction: uniforms[281],
      front: uniforms[282],
      edge: uniforms[283],
      coreSuppress: uniforms[284],
      bite: uniforms[285],
      curl: uniforms[286],
      divergence: uniforms[287],
      smoke: uniforms[288],
      luma: uniforms[292],
      exposure: uniforms[293],
      softClip: uniforms[294],
      heat: uniforms[295],
    };
    state.reactionBoundaryControls = {
      ...boundaryUniforms,
      active: boundaryInspectActive,
    };
    state.reactionBoundaryFireControls = {
      ...boundaryFireUniforms,
      active: boundaryFireInspectActive,
    };
    state.boundarySidecarSource = boundarySidecarSourceName;
    state.boundaryStructureSource = boundarySidecarSourceName;
    state.boundarySidecarView = boundarySidecarViewName;
    state.boundarySidecarDebug = boundarySidecarDebug(boundarySidecarSourceName);
    state.volumeScene = normalizeVolumeScene(controlsSnapshot.volumeScene);
    state.bonfireReferenceConfinement = bonfireReferenceConfinementDebug(controlsSnapshot.volumeScene);
    state.minimalPlumeProof = minimalPlumeProofDebug(controlsSnapshot.volumeScene);
    state.adaptiveRaymarch = uniforms[39];
    state.occupancySkip = uniforms[40];
    state.majorantSkip = uniforms[41];
    state.majorantSmooth = uniforms[42];
    state.majorantGuard = uniforms[43];
    state.temporalAccum = requestedTemporalAccum;
    state.temporalJitter = uniforms[45];
    state.historyClamp = uniforms[46];
    state.fireScale = Math.max(0.35, Math.min(1.3, uniforms[48]));
    state.detailScale = Math.max(0.45, Math.min(3.2, uniforms[49]));
    state.detailScaleArtifactQuarantine = detailScaleArtifactQuarantine(controlsSnapshot.volumeScene);
    state.tallPlumeDetailFrequencySource = state.volumeScene === 'tall_plume' ? 'fire-scale-decoupled-v0' : 'scale-controls';
    state.visibleDetailOverlayGain = state.detailScaleArtifactQuarantine ? 0.35 : 1;
    state.reactionFuelScale = uniforms[71];
    state.lifecycleEffect = normalizeLifecycleEffect(controlsSnapshot.lifecycleEffect);
    state.lifecycleT = normalizeLifecycleT(controlsSnapshot.lifecycleT);
    state.quenchVapor = normalizeQuenchVapor(controlsSnapshot.quenchVapor);
    state.quenchVaporStrength = quenchVaporStrength;
    state.snuffVisualModel = quenchVaporStrength > 0 ? 'quench-vapor-v0' : 'inactive';
    state.flameQuenchModel = quenchVaporStrength > 0 ? 'quench-flame-body-v0' : 'inactive';
    state.pyroMaterialRendererCoupling = {
      identity: 'pyro-material-memory-spatial-coupling-v0',
      lineage: 'pyro-material-memory-render-coupling-v0',
      visualRole: 'opt-in-renderer-diagnostic-not-main-fire-authority',
      compareMode: pyroCompareMode,
      compareMuted: pyroCompareMuted,
      requestedGain: pyroMaterialRequestedGain,
      effectiveGain: pyroMaterialGain,
      materialShaderReadiness: materialMemory.shaderReadiness || 'blocked-reset',
      energy: pyroMaterialEnergy,
      liveFireAuthority: pyroMaterialLiveAuthority,
      smokeAuthority: pyroMaterialSmokeAuthority,
      carrierControls: {
        interfaceFocus: pyroInterfaceFocus,
        edgeBite: pyroEdgeBite,
        biteBorderFocus: pyroBiteBorderFocus,
        biteTeeth: pyroBiteTeeth,
        biteWake: pyroBiteWake,
        biteHeight: pyroBiteHeight,
        biteFireLock: pyroBiteFireLock,
        biteCore: pyroBiteCore,
        biteCoreCut: pyroBiteCoreCut,
        biteRim: pyroBiteRim,
        biteRimCut: pyroBiteRimCut,
        biteAfter: pyroBiteAfter,
        biteAfterCut: pyroBiteAfterCut,
        smokeFold: pyroSmokeFold,
        foldBorderFocus: pyroFoldBorderFocus,
        foldWake: pyroFoldWake,
        wakeLift: pyroWakeLift,
        wakeWarmth: pyroWakeWarmth,
        radiance: pyroContrastRadiance,
        radianceGate: pyroRadianceGate,
        radianceSpill: pyroRadianceSpill,
        radianceWarmth: pyroRadianceWarmth,
        fireMode: pyroFireModeName,
        biteHeat: pyroBiteHeat,
        biteChroma: pyroBiteChroma,
        flamePaint: pyroFlamePaint,
        flameLuma: pyroFlameLuma,
        stockMix: pyroStockMix,
        biteLuma: pyroBiteLuma,
        wakeLuma: pyroWakeLuma,
        radianceLuma: pyroRadianceLuma,
        palette: {
          flameCore: controlsSnapshot.pyroFlameCoreColor || '#fff4b8',
          flameEdge: controlsSnapshot.pyroFlameEdgeColor || '#ff8a24',
          biteEmber: controlsSnapshot.pyroBiteEmberColor || '#e65a1a',
          biteHot: controlsSnapshot.pyroBiteHotColor || '#fff4b8',
          wakeShadow: controlsSnapshot.pyroWakeShadowColor || '#384c50',
          wakeEmber: controlsSnapshot.pyroWakeEmberColor || '#b06a2a',
          radianceCool: controlsSnapshot.pyroRadianceCoolColor || '#7aa8b8',
          radianceWarm: controlsSnapshot.pyroRadianceWarmColor || '#d18438',
          flowCool: controlsSnapshot.pyroFlowCoolColor || '#2aa7b8',
          flowHot: controlsSnapshot.pyroFlowHotColor || '#ff7a36',
        },
        radianceHue: pyroRadianceHue,
        radianceChroma: pyroRadianceChroma,
        radianceSource: controlsSnapshot.pyroRadianceSource || 'fire',
        radianceHeight: pyroRadianceHeight,
        radianceBorder: pyroRadianceBorder,
        radianceTeeth: pyroRadianceTeeth,
        radianceRise: pyroRadianceRise,
        radianceFireLock: pyroRadianceFireLock,
        flowBite: pyroFlowBite,
        flowBorder: pyroFlowBorder,
        flowTeeth: pyroFlowTeeth,
        flowRise: pyroFlowRise,
        flowFireLock: pyroFlowFireLock,
        flowLuma: pyroFlowLuma,
        flowRadiance: pyroFlowRadiance,
        flowSpikes: pyroFlowSpikes,
        diagnosticPaint: pyroDiagnosticPaint,
      },
      carrierDebug: {
        view: controlsSnapshot.pyroCarrierView || 'normal',
        viewMode: pyroCarrierViewMode,
        overdrive: pyroCarrierOverdrive,
        diagnosticPaint: pyroDiagnosticPaint,
        borderSignalMax: pyroMaterialGain * pyroMaterialLiveAuthority * pyroInterfaceFocus * pyroCarrierOverdrive,
        biteSignalMax: pyroMaterialGain * pyroMaterialLiveAuthority * pyroEdgeBite * pyroCarrierOverdrive * Math.max(1, pyroBiteCore + pyroBiteRim + pyroBiteAfter),
        foldSignalMax: pyroMaterialGain * pyroMaterialSmokeAuthority * pyroSmokeFold * pyroCarrierOverdrive,
        radianceSignalMax: pyroMaterialGain * pyroMaterialLiveAuthority * pyroMaterialSmokeAuthority * pyroContrastRadiance * pyroCarrierOverdrive,
        flowSignalMax: pyroMaterialGain * pyroMaterialLiveAuthority * pyroFlowBite * pyroCarrierOverdrive,
        flowRadianceMax: pyroMaterialGain * pyroMaterialLiveAuthority * pyroFlowBite * pyroFlowRadiance * pyroCarrierOverdrive,
        flowSpikeMax: pyroMaterialGain * pyroMaterialLiveAuthority * pyroFlowBite * pyroFlowSpikes * pyroCarrierOverdrive,
        topologyShellIdentity: 'topology-lab-thin-reaction-shell-v0',
        topologyShellMixIdentity: 'topology-lab-monotonic-carrier-mix-v0',
        topologyShellMode: fireRenderModeName,
        topologyShellInspectMode: shellInspectModeName,
        topologyShellAuthority: 'shell-controls-visible-fire-render-authority-stock-fire-bypassed-in-shell-mode',
        topologyShellInputs: ['thermalSupport', 'reactionSupport', 'frontSupport', 'edgeSupport', 'curlSupport', 'coreSuppression', 'divergenceStress'],
        topologyShellControls: state.topologyShellControls,
        legacyPyroBackedOff: controlsSnapshot.legacyPyroBackedOff === true,
        biteShape: `${pyroBiteTeeth.toFixed(2)}t/${pyroBiteWake.toFixed(2)}w/${pyroBiteHeight.toFixed(2)}h/${pyroBiteFireLock.toFixed(2)}f`,
        biteStack: `${pyroBiteCore.toFixed(2)}c/${pyroBiteRim.toFixed(2)}r/${pyroBiteAfter.toFixed(2)}a`,
        biteCuts: `${pyroBiteCoreCut.toFixed(2)}c/${pyroBiteRimCut.toFixed(2)}r/${pyroBiteAfterCut.toFixed(2)}a`,
        foldShape: `${pyroFoldWake.toFixed(2)}w/${pyroWakeLift.toFixed(2)}l/${pyroWakeWarmth.toFixed(2)}a`,
        radianceShape: `${pyroRadianceGate.toFixed(2)}g/${pyroRadianceSpill.toFixed(2)}s/${pyroRadianceBorder.toFixed(2)}b/${pyroRadianceTeeth.toFixed(2)}t/${pyroRadianceRise.toFixed(2)}r/${pyroRadianceFireLock.toFixed(2)}f/${controlsSnapshot.pyroRadianceSource || 'fire'}/${pyroRadianceHeight.toFixed(2)}h`,
        flowShape: `${pyroFlowBorder.toFixed(2)}b/${pyroFlowTeeth.toFixed(2)}t/${pyroFlowRise.toFixed(2)}r/${pyroFlowFireLock.toFixed(2)}f/${pyroFlowLuma.toFixed(2)}l/${pyroFlowRadiance.toFixed(2)}rad/${pyroFlowSpikes.toFixed(2)}sp`,
        colorShape: `${pyroBiteHeat.toFixed(2)}bh/${pyroBiteChroma.toFixed(2)}bc/${pyroRadianceHue.toFixed(2)}rh/${pyroRadianceChroma.toFixed(2)}rc`,
        lumaShape: `${pyroFlamePaint.toFixed(2)}fp/${pyroStockMix.toFixed(2)}sm/${pyroFlameLuma.toFixed(2)}fl/${pyroBiteLuma.toFixed(2)}bl/${pyroWakeLuma.toFixed(2)}wl/${pyroRadianceLuma.toFixed(2)}rl/${pyroFlowLuma.toFixed(2)}flw/${pyroFlowRadiance.toFixed(2)}fr`,
        paletteShape: `${controlsSnapshot.pyroFlameCoreColor || '#fff4b8'}/${controlsSnapshot.pyroFlameEdgeColor || '#ff8a24'}/${controlsSnapshot.pyroBiteEmberColor || '#e65a1a'}/${controlsSnapshot.pyroRadianceWarmColor || '#d18438'}/${controlsSnapshot.pyroFlowHotColor || '#ff7a36'}`,
      },
      spatialMemory: {
        identity: 'pyro-material-memory-spatial-coupling-v0',
        textureLayout: { ...(materialMemory.textureLayout || PYRO_DYNAMIC_DETAIL_TEXTURE_LAYOUT) },
        uploadedCells: uploadedPyroMaterialCells,
      },
    };
    state.runtimeQualityRequested = normalizeRuntimeQuality(controlsSnapshot.runtimeQualityRequested);
    state.runtimeQualityEffective = normalizeRuntimeQuality(controlsSnapshot.runtimeQualityEffective || controlsSnapshot.runtimeQualityRequested);
    state.gpuPressure = clampFinite(controlsSnapshot.gpuPressure, 0, 1, 0);
    state.runtimeQualityReason = String(controlsSnapshot.runtimeQualityReason || 'unspecified').slice(0, 96) || 'unspecified';
    state.runtimeQualityReceipt = runtimeQualityReceipt(controlsSnapshot);
    state.tallPlumeReactionCadenceDebug = state.volumeScene === 'tall_plume' ? 'source-reaction-cadence-v0' : 'inactive';
    state.tallPlumeFlameCutoffContract = state.volumeScene === 'tall_plume' ? 'tall-plume-speed-cutoff-decoupled-v0' : 'inactive';
    state.tallPlumeFlowShelfContract = state.volumeScene === 'tall_plume' ? 'tall-plume-flow-shelf-mitigated-v0' : 'inactive';
    state.tallPlumeFlameHeightLawContract = state.volumeScene === 'tall_plume' ? 'tall-plume-flame-height-law-v2' : 'inactive';
    state.plumeHeight = Math.max(0.7, Math.min(2.2, uniforms[50]));
    state.pressureEffectiveLabel = controlsSnapshot.pressureEffectiveLabel || '';
    state.windStrength = uniforms[53];
    state.windAngle = normalizeWindAngle(controlsSnapshot.windAngle);
    state.windHeight = uniforms[55];
    state.canonicalPlumeControls = {
      identity: 'canonical-plume-tuning-cockpit-v0',
      scalarSpread: uniforms[64],
      centerlineRelief: uniforms[65],
      bodyBalance: uniforms[66],
      macroPreset: controlsSnapshot.canonicalMacroPreset || '',
      sourceMode: normalizeCanonicalSourceMode(controlsSnapshot.canonicalSourceMode),
      sourceModeValue: uniforms[67],
      sourceY: uniforms[68],
      sourceInjection: uniforms[69],
      buoyancyLift: uniforms[70],
      renderMode: normalizeCanonicalRenderMode(controlsSnapshot.canonicalRenderMode),
      renderModeValue: uniforms[72],
      motionMode: normalizeCanonicalMotionMode(controlsSnapshot.canonicalMotionMode),
      motionModeValue: uniforms[73],
      contentMode: normalizeCanonicalContentMode(controlsSnapshot.canonicalContentMode),
      contentModeValue: uniforms[74],
    };
    state.pressureTierOverlayOpacity = pressureTierControls.overlay;
    state.pressureTierRequestedBounds = {
      pressure1: { minY: 0, maxY: 1, buffer: 'B' },
      pressure2: { minY: 0, maxY: pressureTierControls.lowerMax, buffer: 'A' },
      pressure3: { minY: pressureTierControls.heroMin, maxY: pressureTierControls.heroMax, buffer: 'B' },
    };
    state.bonfireAblation = { ...bonfireAblation };
    state.renderScale = normalizeRenderScale(controlsSnapshot.renderScale);
    state.renderPixelRatio = state.renderWidth / Math.max(1, state.displayWidth || state.renderWidth);
    state.temporalAccumEffective = uniforms[44];
    const temporalSettled = historyValid ? Math.min(1, Math.max(0, state.temporalHistoryFrames / 12)) : 0;
    const temporalMotionTrust = previousViewProjReady ? 1 : 0;
    const temporalReactiveEstimate = Math.min(0.82,
      0.18 * Math.max(0, Math.min(1, controlsSnapshot.majorantSkip ?? 0.70)) +
      0.12 * Math.max(0, Math.min(1, controlsSnapshot.adaptiveRays ?? 0.65)) +
      0.08 * Math.max(0, Math.min(1, (controlsSnapshot.fire ?? 1.4) / 2.2)) +
      0.06 * Math.max(0, Math.min(1, (controlsSnapshot.fireLicks ?? 1.65) / 5))
    );
    const smokeHistoryTrust = Math.max(0, Math.min(1,
      ((controlsSnapshot.smoke ?? 2.8) / 3.2) *
      (1 - Math.max(0, Math.min(1, (controlsSnapshot.fire ?? 1.4) / 2.4)) * 0.42) *
      (1 - Math.max(0, Math.min(1, (controlsSnapshot.interfaceShred ?? 2.5) / 5)) * 0.28)
    ));
    const fireHistoryProtect = Math.max(0, Math.min(1,
      (controlsSnapshot.fire ?? 1.4) / 2.2 * 0.48 +
      (controlsSnapshot.radiance ?? 1.65) / 3.0 * 0.26 +
      (controlsSnapshot.fireLicks ?? 1.65) / 5.0 * 0.26
    ));
    const interfaceHistoryProtect = Math.max(0, Math.min(1,
      (controlsSnapshot.interfaceShred ?? 2.5) / 5.0 * 0.52 +
      (controlsSnapshot.fireLicks ?? 1.65) / 5.0 * 0.24 +
      (controlsSnapshot.majorantGuard ?? 0.75) * 0.24
    ));
    const materialTemporalProtection = fireHistoryProtect * 0.46 + interfaceHistoryProtect * 0.34;
    state.temporalSmokeHistoryTrust = smokeHistoryTrust;
    state.temporalFireHistoryProtect = fireHistoryProtect;
    state.temporalInterfaceHistoryProtect = interfaceHistoryProtect;
    state.temporalEvidenceSource = 'cpu-estimate-control-proxy';
    state.temporalReprojectionConfidence = temporalSettled * temporalMotionTrust * Math.max(0, 1 - temporalReactiveEstimate - materialTemporalProtection * 0.18);
    state.temporalHistoryWeight = uniforms[44] * state.temporalReprojectionConfidence * (0.34 + smokeHistoryTrust * 0.66) * (1 - fireHistoryProtect * 0.55) * (1 - interfaceHistoryProtect * 0.36);
    state.temporalRejectedHistory = Math.max(0, Math.min(1, 1 - (state.temporalHistoryWeight / Math.max(0.0001, uniforms[44]))));
    state.temporalHistoryValid = historyValid;
  }

  function updateSimCostLedger(options = {}) {
    const scene = normalizeVolumeScene(controlsSnapshot.volumeScene);
    const majorantBuildCadence = normalizeMajorantBuildCadence(controlsSnapshot.majorantCadence);
    const pressureIterationRequested = normalizePressureIterationCount(controlsSnapshot.pressureIterations, scene);
    const pressureStrategy = normalizePressureStrategy(controlsSnapshot.pressureStrategy, scene);
    const pressureTierControls = normalizePressureTierControls(controlsSnapshot);
    const tierPlan = pressureTierDispatchPlan(gridSize, pressureStrategy, scene, pressureTierControls);
    const pressureEnabled = state.pressureProjectionEnabled && pressureIterationRequested > 0;
    const pressureIterations = pressureEnabled ? state.pressureProjectionIterations : 0;
    const spatialPressureEnabled = pressureEnabled && tierPlan.strategy === TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY;
    const tallPlumePressureStrategy = spatialPressureEnabled
      ? TALL_PLUME_PRESSURE_ITERATION_STRATEGY_INACTIVE
      : tallPlumePressureIterationStrategy(scene, pressureIterationRequested);
    const tallPlumePressureIterationTarget = scene === 'tall_plume' && !spatialPressureEnabled ? 2 : 0;
    const tallPlumePressureTierStrategyValue = spatialPressureEnabled ? tierPlan.strategy : TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY_INACTIVE;
    const pressureProjectionReadStrategy = spatialPressureEnabled ? PRESSURE_PROJECTION_READ_STRATEGY_COMPOSITE : PRESSURE_PROJECTION_READ_STRATEGY_SINGLE_BUFFER;
    const simPassesPerFrame = 1;
    const fireLickOperatorGain = fireLickOperatorGainFromAmount(controlsSnapshot.fireLicks);
    const fireLickBreakupEnabled = fireLickOperatorGain > FIRE_LICK_BREAKUP_BYPASS_THRESHOLD;
    const mainFluidKernelStrategy = fireLickBreakupEnabled
      ? MAIN_FLUID_KERNEL_STRATEGY_FIRE_LICK_BREAKUP
      : MAIN_FLUID_KERNEL_STRATEGY_ZERO_FIRE_LICK_BYPASS;
    const fireLickBreakupEvaluationsPerCell = fireLickBreakupEnabled ? 2 : 0;
    const mainFluidLocalProjectionStrategy = MAIN_FLUID_LOCAL_PROJECTION_STRATEGY_STAGED_PRESSURE_ONLY;
    const mainFluidLocalProjectionDivergenceEvaluationsPerCell = 0;
    const bonfireCombustionFieldActive = scene === 'bonfire_plume';
    const mainFluidBonfireCombustionFieldStrategy = bonfireCombustionFieldActive
      ? MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_ACTIVE
      : MAIN_FLUID_BONFIRE_COMBUSTION_FIELD_STRATEGY_NON_BONFIRE_BYPASS;
    const bonfireCombustionFieldEvaluationsPerCell = bonfireCombustionFieldActive ? 2 : 0;
    const mainFluidBonfireProceduralBreakupStrategy = bonfireCombustionFieldActive
      ? MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_ACTIVE
      : MAIN_FLUID_BONFIRE_PROCEDURAL_BREAKUP_STRATEGY_NON_BONFIRE_BYPASS;
    const bonfireProceduralBreakupEvaluationsPerCell = bonfireCombustionFieldActive ? 4 : 0;
    const mainFluidBonfireSymmetricForceStrategy = bonfireCombustionFieldActive
      ? MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_ACTIVE
      : MAIN_FLUID_BONFIRE_SYMMETRIC_FORCE_STRATEGY_NON_BONFIRE_BYPASS;
    const bonfireSymmetricForceEvaluationsPerCell = bonfireCombustionFieldActive ? 4 : 0;
    const mainFluidBonfireNonWindForceStrategy = bonfireCombustionFieldActive
      ? MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_ACTIVE
      : MAIN_FLUID_BONFIRE_NON_WIND_FORCE_STRATEGY_NON_BONFIRE_BYPASS;
    const bonfireNonWindForceEvaluationsPerCell = bonfireCombustionFieldActive ? 4 : 0;
    const mainFluidBonfireScalarNeighborhoodStrategy = bonfireCombustionFieldActive
      ? MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_ACTIVE
      : MAIN_FLUID_BONFIRE_SCALAR_NEIGHBORHOOD_STRATEGY_NON_BONFIRE_BYPASS;
    const bonfireScalarNeighborhoodReadsPerCell = bonfireCombustionFieldActive ? 36 : 0;
    const tallPlumeDetailCoherenceStrategy = scene === 'tall_plume'
      ? TALL_PLUME_DETAIL_COHERENCE_STRATEGY_TRANSPORTED_PHASE_ANCHOR
      : TALL_PLUME_DETAIL_COHERENCE_STRATEGY_INACTIVE;
    const tallPlumeDetailCoherenceExtraReadsPerCell = 0;
    const tallPlumeTransitionBandStrategy = scene === 'tall_plume'
      ? TALL_PLUME_TRANSITION_BAND_STRATEGY_STAGGERED_RETIREMENT
      : TALL_PLUME_TRANSITION_BAND_STRATEGY_INACTIVE;
    const tallPlumeTransitionBandExtraReadsPerCell = 0;
    const pressureSourceStrategy = pressureEnabled
      ? PRESSURE_SOURCE_STRATEGY_INLINE_DIVERGENCE
      : PRESSURE_SOURCE_STRATEGY_DISABLED;
    const pressureDivergencePasses = 0;
    const pressureJacobiPasses = pressureEnabled ? pressureIterations : 0;
    const pressureJacobiInlineDivergencePasses = pressureJacobiPasses;
    const pressureJacobiFullGridPasses = spatialPressureEnabled ? tierPlan.fullGridPasses : pressureJacobiPasses;
    const pressureJacobiPartialSlabPasses = spatialPressureEnabled ? tierPlan.partialSlabPasses : 0;
    const pressureJacobiFullGridEquivalentPasses = spatialPressureEnabled ? tierPlan.equivalentPasses : pressureJacobiPasses;
    const pressureProjectionPasses = pressureEnabled ? 1 : 0;
    const fullGridPassesPerFrame = simPassesPerFrame + pressureDivergencePasses + pressureJacobiFullGridEquivalentPasses + pressureProjectionPasses;
    const fullGridPassBreakdown = {
      fluidSim: simPassesPerFrame,
      pressureDivergence: pressureDivergencePasses,
      pressureJacobi: pressureJacobiPasses,
      pressureJacobiInlineDivergence: pressureJacobiInlineDivergencePasses,
      pressureJacobiFullGrid: pressureJacobiFullGridPasses,
      pressureJacobiPartialSlab: pressureJacobiPartialSlabPasses,
      pressureJacobiFullGridEquivalent: pressureJacobiFullGridEquivalentPasses,
      pressureProjection: pressureProjectionPasses,
      total: fullGridPassesPerFrame,
    };
    const fullGridWorkgroupsPerPass = Math.ceil(gridSize / 4) ** 3;
    const majorantWorkgroupsPerPass = Math.ceil(majorantGridSize / 4) ** 3;
    const majorantBuiltThisFrame = options.majorantBuiltThisFrame ?? state.majorantBuiltThisFrame;
    const boundarySidecarBuiltThisFrame = options.boundarySidecarBuiltThisFrame ?? state.boundarySidecarBuiltThisFrame;
    const fullGridCells = gridCellCount(gridSize);
    const majorantCells = majorantGridSize * majorantGridSize * majorantGridSize;
    const fluidBytes = fluidBufferBytes(gridSize);
    const frontBytes = frontFieldBufferBytes(gridSize);
    const pressureBytes = pressureBufferBytes(gridSize);
    const majorantBytes = majorantBufferBytes(majorantGridSize);
    const boundarySidecarBytes = boundarySidecarBufferBytes(gridSize);
    state.majorantCadence = majorantBuildCadence;
    state.pressureIterationDefault = defaultPressureIterationsForScene(scene);
    state.pressureIterationRequested = pressureIterationRequested;
    state.pressureSourceStrategy = pressureSourceStrategy;
    state.pressureStrategy = pressureStrategy;
    state.tallPlumePressureIterationStrategy = tallPlumePressureStrategy;
    state.tallPlumePressureIterationTarget = tallPlumePressureIterationTarget;
    state.tallPlumePressureTierStrategy = tallPlumePressureTierStrategyValue;
    state.pressureProjectionReadStrategy = pressureProjectionReadStrategy;
    state.pressureJacobiFullGridPasses = pressureJacobiFullGridPasses;
    state.pressureJacobiPartialSlabPasses = pressureJacobiPartialSlabPasses;
    state.pressureJacobiFullGridEquivalentPasses = pressureJacobiFullGridEquivalentPasses;
    state.pressureTierRequestedBounds = spatialPressureEnabled ? { ...tierPlan.requestedBounds } : null;
    state.pressureTierEffectiveBounds = spatialPressureEnabled ? { ...tierPlan.effectiveBounds } : null;
    state.pressureTierOverlayOpacity = pressureTierControls.overlay;
    state.pressureTierDispatches = spatialPressureEnabled ? tierPlan.dispatches.map(dispatch => ({ ...dispatch })) : [];
    state.pressureTierBounds = spatialPressureEnabled ? { ...tierPlan.bounds } : null;
    state.pressureTierBufferOwnership = spatialPressureEnabled ? { ...tierPlan.bufferOwnership } : null;
    state.mainFluidKernelStrategy = mainFluidKernelStrategy;
    state.mainFluidLocalProjectionStrategy = mainFluidLocalProjectionStrategy;
    state.mainFluidLocalProjectionDivergenceEvaluationsPerCell = mainFluidLocalProjectionDivergenceEvaluationsPerCell;
    state.mainFluidBonfireCombustionFieldStrategy = mainFluidBonfireCombustionFieldStrategy;
    state.bonfireCombustionFieldEvaluationsPerCell = bonfireCombustionFieldEvaluationsPerCell;
    state.mainFluidBonfireProceduralBreakupStrategy = mainFluidBonfireProceduralBreakupStrategy;
    state.bonfireProceduralBreakupEvaluationsPerCell = bonfireProceduralBreakupEvaluationsPerCell;
    state.mainFluidBonfireSymmetricForceStrategy = mainFluidBonfireSymmetricForceStrategy;
    state.bonfireSymmetricForceEvaluationsPerCell = bonfireSymmetricForceEvaluationsPerCell;
    state.mainFluidBonfireNonWindForceStrategy = mainFluidBonfireNonWindForceStrategy;
    state.bonfireNonWindForceEvaluationsPerCell = bonfireNonWindForceEvaluationsPerCell;
    state.mainFluidBonfireScalarNeighborhoodStrategy = mainFluidBonfireScalarNeighborhoodStrategy;
    state.bonfireScalarNeighborhoodReadsPerCell = bonfireScalarNeighborhoodReadsPerCell;
    state.tallPlumeDetailCoherenceStrategy = tallPlumeDetailCoherenceStrategy;
    state.tallPlumeDetailCoherenceExtraReadsPerCell = tallPlumeDetailCoherenceExtraReadsPerCell;
    state.tallPlumeTransitionBandStrategy = tallPlumeTransitionBandStrategy;
    state.tallPlumeTransitionBandExtraReadsPerCell = tallPlumeTransitionBandExtraReadsPerCell;
    state.fireLickBreakupEnabled = fireLickBreakupEnabled;
    state.fireLickBreakupEvaluationsPerCell = fireLickBreakupEvaluationsPerCell;
    state.fireLickOperatorGain = fireLickOperatorGain;
    state.pressureDivergencePasses = pressureDivergencePasses;
    state.pressureJacobiInlineDivergencePasses = pressureJacobiInlineDivergencePasses;
    state.fullGridPassBreakdown = fullGridPassBreakdown;
    state.simProfile = normalizeSimProfileFlag(controlsSnapshot.simProfile);
    state.simCostLedger = {
      identity: SIM_COST_LEDGER_IDENTITY,
      evidenceSource: SIM_COST_LEDGER_EVIDENCE_SOURCE,
      routeIdentity: ROUTE_IDENTITY,
      prototypeIdentity: PROTOTYPE_IDENTITY,
      effectiveRoute: state.effectiveRoute,
      volumeScene: scene,
      grid: gridSize,
      majorantGrid: majorantGridSize,
      workgroupSize: '4x4x4',
      fullGridWorkgroupsPerPass,
      majorantWorkgroupsPerPass,
      simPassesPerFrame,
      pressureSourceStrategy,
      tallPlumePressureIterationStrategy: tallPlumePressureStrategy,
      tallPlumePressureIterationTarget,
      pressureStrategy,
      tallPlumePressureTierStrategy: tallPlumePressureTierStrategyValue,
      pressureProjectionReadStrategy,
      pressureJacobiFullGridPasses,
      pressureJacobiPartialSlabPasses,
      pressureJacobiFullGridEquivalentPasses,
      pressureTierRequestedBounds: spatialPressureEnabled ? { ...tierPlan.requestedBounds } : null,
      pressureTierEffectiveBounds: spatialPressureEnabled ? { ...tierPlan.effectiveBounds } : null,
      pressureTierOverlayOpacity: pressureTierControls.overlay,
      pressureTierDispatches: spatialPressureEnabled ? tierPlan.dispatches.map(dispatch => ({ ...dispatch })) : [],
      pressureTierBounds: spatialPressureEnabled ? { ...tierPlan.bounds } : null,
      pressureTierBufferOwnership: spatialPressureEnabled ? { ...tierPlan.bufferOwnership } : null,
      mainFluidKernelStrategy,
      mainFluidLocalProjectionStrategy,
      mainFluidLocalProjectionDivergenceEvaluationsPerCell,
      mainFluidBonfireCombustionFieldStrategy,
      bonfireCombustionFieldEvaluationsPerCell,
      mainFluidBonfireProceduralBreakupStrategy,
      bonfireProceduralBreakupEvaluationsPerCell,
      mainFluidBonfireSymmetricForceStrategy,
      bonfireSymmetricForceEvaluationsPerCell,
      mainFluidBonfireNonWindForceStrategy,
      bonfireNonWindForceEvaluationsPerCell,
      mainFluidBonfireScalarNeighborhoodStrategy,
      bonfireScalarNeighborhoodReadsPerCell,
      tallPlumeDetailCoherenceStrategy,
      tallPlumeDetailCoherenceExtraReadsPerCell,
      tallPlumeTransitionBandStrategy,
      tallPlumeTransitionBandExtraReadsPerCell,
      fireLickBreakupEnabled,
      fireLickBreakupEvaluationsPerCell,
      fireLickOperatorGain,
      pressureDivergencePasses,
      pressureJacobiPasses,
      pressureJacobiInlineDivergencePasses,
      pressureProjectionPasses,
      fullGridPassesPerFrame,
      fullGridPassBreakdown,
      fullGridCellVisitsPerFrame: fullGridCells * fullGridPassesPerFrame,
      majorantBuildCadence,
      majorantBuiltThisFrame,
      majorantCellVisitsThisFrame: majorantBuiltThisFrame ? majorantCells : 0,
      majorantEstimatedCellVisitsPerFrame: majorantCells / majorantBuildCadence,
      majorantLastBuiltFrame: state.majorantLastBuiltFrame,
      majorantSkippedFrameCount: state.majorantSkippedFrameCount,
      boundarySidecarIdentity: BOUNDARY_SIDECAR_IDENTITY,
      boundarySidecarAuthority: BOUNDARY_SIDECAR_BAKE_AUTHORITY,
      boundarySidecarSource: state.boundarySidecarSource,
      boundarySidecarBuiltThisFrame,
      boundarySidecarCellVisitsThisFrame: boundarySidecarBuiltThisFrame ? fullGridCells : 0,
      boundarySidecarLastBuiltFrame: state.boundarySidecarLastBuiltFrame,
      pressureProjectionEnabled: pressureEnabled,
      pressureIterationDefault: state.pressureIterationDefault,
      pressureIterationRequested,
      simProfile: state.simProfile,
      fluidBufferBytes: fluidBytes,
      frontFieldBufferBytes: frontBytes,
      pressureBufferBytes: pressureBytes,
      majorantBufferBytes: majorantBytes,
      boundarySidecarBufferBytes: boundarySidecarBytes,
      externalEmitterBufferBytes: externalEmitterBufferBytes(),
      estimatedResidentBytes: fluidBytes * 2 + frontBytes * 2 + pressureBytes * 2 + majorantBytes + boundarySidecarBytes + externalEmitterBufferBytes(),
      timing: { ...state.timing },
    };
    return state.simCostLedger;
  }

  function encodeSim(encoder, options = {}) {
    const pass = encoder.beginComputePass({
      label: 'kaminos fluid sim pass',
      ...(options.timestampWrites ? { timestampWrites: options.timestampWrites } : {}),
    });
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, bindGroups[currentFluid]);
    const workgroups = Math.ceil(gridSize / 4);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    currentFluid = 1 - currentFluid;
    currentFront = 1 - currentFront;
    state.frontFieldReadIndex = currentFront;
    state.frontFieldWriteIndex = 1 - currentFront;
    state.frontFieldProjectionPassthrough = false;
    encodePressureProjection(encoder);
    state.simStepCount += 1;
    updateSimCostLedger();
  }

  function encodePressureProjection(encoder) {
    const pressureIterationCount = normalizePressureIterationCount(controlsSnapshot.pressureIterations, controlsSnapshot.volumeScene);
    const pressureStrategy = normalizePressureStrategy(controlsSnapshot.pressureStrategy, controlsSnapshot.volumeScene);
    const tierPlan = pressureTierDispatchPlan(gridSize, pressureStrategy, controlsSnapshot.volumeScene, normalizePressureTierControls(controlsSnapshot));
    if (
      !pressureJacobiPipeline ||
      !pressureProjectPipeline ||
      (tierPlan.strategy === TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY && (!pressureJacobiTieredLowerPipeline || !pressureJacobiTieredHeroPipeline || !pressureProjectTieredPipeline)) ||
      pressureJacobiBindGroups.length !== 2 ||
      pressureReadBindGroups.length !== 2 ||
      majorantFrontBindGroups.length !== 2
    ) {
      state.pressureProjectionEnabled = false;
      state.pressureProjectionIterations = 0;
      updateSimCostLedger();
      return;
    }
    const bonfireProjectionAblation = normalizeVolumeScene(controlsSnapshot.volumeScene) === 'bonfire_plume'
      ? normalizeBonfireAblationValue(controlsSnapshot.bonfireProjection)
      : 1;
    const projection = Math.max(0, Math.min(1.5, controlsSnapshot.projection ?? 0.65)) * bonfireProjectionAblation;
    if (projection <= 0.001 || pressureIterationCount <= 0) {
      state.pressureProjectionEnabled = false;
      state.pressureProjectionIterations = 0;
      updateSimCostLedger();
      return;
    }
    const workgroups = Math.ceil(gridSize / 4);
    const dispatchPressureTierPass = (pipeline, bindGroup, tierWorkgroupsY, label, readBindGroup = majorantFrontBindGroups[currentFluid]) => {
      const pass = encoder.beginComputePass({ label });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, readBindGroup);
      pass.setBindGroup(2, bindGroup);
      pass.dispatchWorkgroups(workgroups, tierWorkgroupsY, workgroups);
      pass.end();
    };
    if (tierPlan.strategy === TALL_PLUME_SPATIAL_PRESSURE_TIER_STRATEGY) {
      dispatchPressureTierPass(
        pressureJacobiPipeline,
        pressureJacobiBindGroups[0],
        workgroups,
        'kaminos pressure spatial tier pass 1 full-volume pressure1'
      );
      dispatchPressureTierPass(
        pressureJacobiTieredLowerPipeline,
        pressureJacobiBindGroups[1],
        tierPlan.dispatches[1].workgroupsY,
        'kaminos pressure spatial tier pass 2 lower-plume pressure2',
        bindGroups[currentFluid]
      );
      dispatchPressureTierPass(
        pressureJacobiTieredHeroPipeline,
        pressureJacobiBindGroups[0],
        tierPlan.dispatches[2].workgroupsY,
        'kaminos pressure spatial tier pass 3 hero-fire-band pressure3',
        bindGroups[currentFluid]
      );
      {
        const pass = encoder.beginComputePass({ label: 'kaminos tiered pressure projection pass' });
        pass.setPipeline(pressureProjectTieredPipeline);
        pass.setBindGroup(0, bindGroups[currentFluid]);
        pass.setBindGroup(2, pressureJacobiBindGroups[1]);
        pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
        pass.end();
        currentFluid = 1 - currentFluid;
        currentFront = 1 - currentFront;
      }
      state.pressureProjectionEnabled = true;
      state.pressureProjectionIterations = tierPlan.maxTierIterations;
      state.frontFieldReadIndex = currentFront;
      state.frontFieldWriteIndex = 1 - currentFront;
      state.frontFieldProjectionPassthrough = true;
      updateSimCostLedger();
      return;
    }
    let pressureReadIndex = 0;
    for (let i = 0; i < pressureIterationCount; i += 1) {
      const pass = encoder.beginComputePass({ label: `kaminos pressure jacobi inline-divergence pass ${i + 1}` });
      pass.setPipeline(pressureJacobiPipeline);
      pass.setBindGroup(0, majorantFrontBindGroups[currentFluid]);
      pass.setBindGroup(2, pressureJacobiBindGroups[pressureReadIndex]);
      pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
      pass.end();
      pressureReadIndex = 1 - pressureReadIndex;
    }
    {
      const pass = encoder.beginComputePass({ label: 'kaminos pressure projection pass' });
      pass.setPipeline(pressureProjectPipeline);
      pass.setBindGroup(0, bindGroups[currentFluid]);
      pass.setBindGroup(2, pressureReadBindGroups[pressureReadIndex]);
      pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
      pass.end();
      currentFluid = 1 - currentFluid;
      currentFront = 1 - currentFront;
    }
    state.pressureProjectionEnabled = true;
    state.pressureProjectionIterations = pressureIterationCount;
    state.frontFieldReadIndex = currentFront;
    state.frontFieldWriteIndex = 1 - currentFront;
    state.frontFieldProjectionPassthrough = true;
    updateSimCostLedger();
  }

  function encodeMajorant(encoder, options = {}) {
    const majorantBuildCadence = normalizeMajorantBuildCadence(controlsSnapshot.majorantCadence);
    state.majorantCadence = majorantBuildCadence;
    const force = options.force === true;
    const shouldBuild = force || !state.majorantBuilt || majorantBuildCadence <= 1 || state.frameCount % majorantBuildCadence === 0;
    if (!shouldBuild) {
      state.majorantBuiltThisFrame = false;
      state.majorantSkippedFrameCount += 1;
      updateSimCostLedger({ majorantBuiltThisFrame: false });
      return;
    }
    const pass = encoder.beginComputePass({ label: 'kaminos coarse majorant build pass' });
    pass.setPipeline(majorantComputePipeline);
    pass.setBindGroup(0, options.readBindGroup || majorantFrontBindGroups[currentFluid]);
    pass.setBindGroup(1, majorantWriteBindGroup);
    const workgroups = Math.ceil(majorantGridSize / 4);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    state.majorantBuilt = true;
    state.majorantBuiltThisFrame = true;
    state.majorantLastBuiltFrame = state.frameCount;
    state.majorantFrameCount += 1;
    updateSimCostLedger({ majorantBuiltThisFrame: true });
  }

  function encodeBoundarySidecar(encoder, options = {}) {
    const sourceName = normalizeBoundarySidecarSource(controlsSnapshot.boundarySidecarSource);
    const sidecarViewName = normalizeBoundarySidecarView(controlsSnapshot.boundarySidecarView ?? controlsSnapshot.boundarySidecarControls?.view);
    state.boundarySidecarSource = sourceName;
    state.boundarySidecarView = sidecarViewName;
    state.boundaryStructureSource = sourceName;
    if (sourceName === 'override') {
      const overrideApplied = state.boundarySidecarOverrideReceipt?.status === 'applied'
        && state.boundarySidecarOverrideReceipt.grid === gridSize
        && state.boundarySidecarOverrideReceipt.byteLength === boundarySidecarBufferBytes(gridSize);
      state.boundarySidecarBuilt = overrideApplied;
      state.boundarySidecarBuiltThisFrame = overrideApplied;
      state.boundarySidecarAuthority = overrideApplied ? EXTERNAL_BOUNDARY_SIDECAR_AUTHORITY : BOUNDARY_SIDECAR_BAKE_AUTHORITY;
      state.boundarySidecarDebug = boundarySidecarDebug(sourceName);
      updateSimCostLedger({ boundarySidecarBuiltThisFrame: false });
      return;
    }
    state.boundarySidecarAuthority = BOUNDARY_SIDECAR_BAKE_AUTHORITY;
    const shouldBakeBoundarySidecar = sourceName !== 'live' || sidecarViewName !== 'off' || boundarySplatRequested();
    if (
      !shouldBakeBoundarySidecar ||
      !boundarySidecarBuildPipeline ||
      !boundarySidecarWriteBindGroup ||
      boundarySidecarReadBindGroups.length !== 2
    ) {
      state.boundarySidecarBuiltThisFrame = false;
      state.boundarySidecarDebug = boundarySidecarDebug(sourceName);
      updateSimCostLedger({ boundarySidecarBuiltThisFrame: false });
      return;
    }
    const pass = encoder.beginComputePass({
      label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} bake pass`,
      ...(options.timestampWrites ? { timestampWrites: options.timestampWrites } : {}),
    });
    pass.setPipeline(boundarySidecarBuildPipeline);
    pass.setBindGroup(0, options.readBindGroup || boundarySidecarReadBindGroups[currentFluid]);
    pass.setBindGroup(3, boundarySidecarWriteBindGroup);
    const workgroups = Math.ceil(gridSize / 4);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    state.boundarySidecarBuilt = true;
    state.boundarySidecarBuiltThisFrame = true;
    state.boundarySidecarFrameCount += 1;
    state.boundarySidecarLastBuiltFrame = state.frameCount;
    state.boundarySidecarDebug = boundarySidecarDebug(sourceName);
    updateSimCostLedger({ boundarySidecarBuiltThisFrame: true });
  }

  function boundarySplatRequested() {
    return normalizeBoundarySplatMode(controlsSnapshot.boundarySplatMode) !== 'off';
  }

  function boundarySplatLearnedAttributesRequested() {
    return normalizeBoundarySplatMode(controlsSnapshot.boundarySplatMode) === 'learned';
  }

  function boundarySplatFeatureCaptureRequested() {
    return normalizeBoundarySplatFeatureCapture(controlsSnapshot.boundarySplatFeatureCapture);
  }

  function makeBoundarySplatCopyDisposition(candidateCopyBytes = 0, rendererIdentity = BOUNDARY_SPLAT_RENDERER_IDENTITY) {
    return {
      identity: 'boundary-splat-candidate-copy-disposition-v0',
      status: 'removed-full-capacity-copy',
      rendererIdentity,
      sourceAuthority: BOUNDARY_SPLAT_SOURCE_AUTHORITY,
      candidateStrideBytes: BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES,
      priorFullCapacityCopyBytes: boundarySplatCapacity * BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES,
      effectiveCandidateCopyBytes: candidateCopyBytes,
      renderStorageStrategy: 'single-candidate-storage-buffer-read-after-compute-pass',
    };
  }

  function makeBoundarySplatStage(status, ms = null, extra = {}) {
    return { status, ms, ...extra };
  }

  function makeBoundarySplatGpuProfile({
    timestampStatus = 'unsupported',
    reason = null,
    stages = null,
    candidateCopyBytes = 0,
    rendererIdentity = BOUNDARY_SPLAT_RENDERER_IDENTITY,
  } = {}) {
    const stageStatus = timestampStatus === 'available' ? 'not-sampled' : timestampStatus;
    const stageMap = stages ?? {
      simulation: makeBoundarySplatStage(stageStatus),
      sidecar: makeBoundarySplatStage(stageStatus),
      compaction: makeBoundarySplatStage(stageStatus),
      candidateCopy: makeBoundarySplatStage(stageStatus, null, {
        disposition: 'removed-full-capacity-copy',
        candidateCopyBytes,
      }),
      indirectSetup: makeBoundarySplatStage(stageStatus),
      splatRaster: makeBoundarySplatStage(stageStatus),
      matchedRaymarchRaster: makeBoundarySplatStage(stageStatus),
      total: makeBoundarySplatStage(stageStatus),
    };
    return {
      identity: BOUNDARY_SPLAT_GPU_PROFILE_IDENTITY,
      rendererIdentity,
      sourceAuthority: BOUNDARY_SPLAT_SOURCE_AUTHORITY,
      timestampFeature: 'timestamp-query',
      timestampStatus,
      reason,
      timeUnit: 'ms',
      candidateCopyBytes,
      boundarySplatCopyBytesThisFrame: candidateCopyBytes,
      stages: stageMap,
    };
  }

  function setBoundarySplatGpuProfile(profile) {
    state.boundarySplatTimestampStatus = profile.timestampStatus;
    state.boundarySplatGpuProfile = profile;
    state.boundarySplatCopyBytesThisFrame = profile.candidateCopyBytes ?? state.boundarySplatCopyBytesThisFrame ?? 0;
    state.boundarySplatCopyDisposition = makeBoundarySplatCopyDisposition(state.boundarySplatCopyBytesThisFrame, state.boundarySplatRendererIdentity);
    return profile;
  }

  function encodeBoundarySplats(encoder, hooks = {}) {
    state.boundarySplatMode = normalizeBoundarySplatMode(controlsSnapshot.boundarySplatMode);
    state.boundarySplatRendererIdentity = boundarySplatEffectiveRendererIdentity(state.boundarySplatMode);
    state.boundarySplatAttributeModelIdentity = boundarySplatEffectiveAttributeModelIdentity(state.boundarySplatMode);
    state.boundarySplatFeatureCaptureRequested = boundarySplatFeatureCaptureRequested();
    state.boundarySplatSourceAuthority = state.boundarySidecarSource === 'override'
      && state.boundarySidecarOverrideReceipt?.status === 'applied'
      ? EXTERNAL_BOUNDARY_SIDECAR_AUTHORITY
      : BOUNDARY_SPLAT_SOURCE_AUTHORITY;
    state.boundarySplatFeatureCaptureEffective = state.boundarySplatFeatureCaptureRequested
      && boundarySplatFeatureBufferCapacity === boundarySplatCapacity;
    if (!boundarySplatRequested()) {
      state.boundarySplatFallbackReason = null;
      return false;
    }
    if (
      !state.boundarySidecarBuiltThisFrame
      || !boundarySplatCompactPipeline
      || !boundarySplatFinalizePipeline
      || !boundarySplatRenderPipeline
      || !boundarySplatDrawBuffer
      || !boundarySplatIndirectBuffer
      || boundarySplatComputeBindGroups.length !== 2
      || !boundarySplatRenderBindGroup
    ) {
      state.boundarySplatFallbackReason = !state.boundarySidecarBuiltThisFrame
        ? 'sidecar-not-built-this-frame'
        : 'boundary-splat-gpu-route-unavailable';
      return false;
    }
    device.queue.writeBuffer(boundarySplatDrawBuffer, 0, new Uint32Array([6, 0, 0, 0, 0, 0, boundarySplatCapacity, 0]));
    const compactPass = encoder.beginComputePass({ label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} compact pass` });
    compactPass.setPipeline(boundarySplatCompactPipeline);
    const computeBindGroup = hooks.computeBindGroup || boundarySplatComputeBindGroups[currentFluid];
    compactPass.setBindGroup(0, computeBindGroup);
    const workgroups = Math.ceil(gridSize / 4);
    compactPass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    compactPass.end();
    const finalizePass = encoder.beginComputePass({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} finalize pass`,
      ...(hooks.finalizeTimestampWrites ? { timestampWrites: hooks.finalizeTimestampWrites } : {}),
    });
    finalizePass.setPipeline(boundarySplatFinalizePipeline);
    finalizePass.setBindGroup(0, computeBindGroup);
    finalizePass.dispatchWorkgroups(1);
    finalizePass.end();
    hooks.afterCompaction?.();
    state.boundarySplatCopyBytesThisFrame = 0;
    state.boundarySplatCopyDisposition = makeBoundarySplatCopyDisposition(0, state.boundarySplatRendererIdentity);
    hooks.afterCandidateCopy?.();
    encoder.copyBufferToBuffer(boundarySplatDrawBuffer, 0, boundarySplatIndirectBuffer, 0, 16);
    hooks.afterIndirectSetup?.();
    state.boundarySplatFallbackReason = null;
    return true;
  }

  function encodeBoundarySplatDraw(encoder, view, targetPipeline = boundarySplatRenderPipeline, options = {}) {
    if (!boundarySplatRequested() || state.boundarySplatFallbackReason || !targetPipeline) return false;
    const loadOp = options.loadOp === 'load' ? 'load' : 'clear';
    const pass = encoder.beginRenderPass({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} canvas pass`,
      ...(options.timestampWrites ? { timestampWrites: options.timestampWrites } : {}),
      colorAttachments: [{
        view,
        clearValue: { r: 0.004, g: 0.005, b: 0.006, a: 1 },
        loadOp,
        storeOp: 'store',
      }],
    });
    pass.setPipeline(targetPipeline);
    pass.setBindGroup(0, boundarySplatRenderBindGroup);
    pass.drawIndirect(boundarySplatIndirectBuffer, 0);
    pass.end();
    state.boundarySplatFrameCount += 1;
    state.volumeReconstructionStyle = state.boundarySplatRendererIdentity;
    return true;
  }

  function encodeBoundarySplatTelemetry(encoder, force = false) {
    if (
      !boundarySplatRequested()
      || state.boundarySplatFallbackReason
      || (!force && state.frameCount % 12 !== 0)
      || boundarySplatTelemetryCopyPending
      || boundarySplatTelemetryMapPending
      || !boundarySplatDrawBuffer
      || !boundarySplatReadbackBuffer
    ) return;
    encoder.copyBufferToBuffer(boundarySplatDrawBuffer, 0, boundarySplatReadbackBuffer, 0, 32);
    boundarySplatTelemetryCopyPending = true;
  }

  function timestampQueriesAvailable() {
    if (!device?.features?.has?.('timestamp-query')) return false;
    if (typeof device.createQuerySet !== 'function') return false;
    const probeEncoder = device.createCommandEncoder({ label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} timestamp availability probe` });
    return typeof probeEncoder.beginComputePass === 'function' && typeof probeEncoder.resolveQuerySet === 'function';
  }

  function encodeBoundarySplatTimestampMarker(encoder, querySet, index, label) {
    const pass = encoder.beginComputePass({
      label,
      timestampWrites: {
        querySet,
        endOfPassWriteIndex: index,
      },
    });
    pass.end();
  }

  async function sampleBoundarySplatGpuProfile() {
    if (!boundarySplatRequested()) {
      return setBoundarySplatGpuProfile(makeBoundarySplatGpuProfile({
        timestampStatus: 'unsupported',
        reason: 'boundary-splat-route-not-requested',
        candidateCopyBytes: 0,
        rendererIdentity: state.boundarySplatRendererIdentity,
      }));
    }
    if (!timestampQueriesAvailable()) {
      return setBoundarySplatGpuProfile(makeBoundarySplatGpuProfile({
        timestampStatus: 'unsupported',
        reason: device?.features?.has?.('timestamp-query') ? 'timestamp-query-write-api-unavailable' : 'timestamp-query-not-supported',
        candidateCopyBytes: state.boundarySplatCopyBytesThisFrame ?? 0,
        rendererIdentity: state.boundarySplatRendererIdentity,
      }));
    }

    const queryCount = 7;
    const querySet = device.createQuerySet({
      type: 'timestamp',
      count: queryCount,
    });
    const resolveBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} timestamp resolve`,
      size: queryCount * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    const readbackBuffer = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} timestamp readback`,
      size: queryCount * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    try {
      ensureFrameTexture();
      device.pushErrorScope('validation');
      const encoder = device.createCommandEncoder({ label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} timestamp profile encoder` });
      const writeTimestamp = (index, label) => encodeBoundarySplatTimestampMarker(encoder, querySet, index, label);
      encodeSim(encoder, {
        timestampWrites: {
          querySet,
          beginningOfPassWriteIndex: 0,
        },
      });
      writeTimestamp(1, 'kaminos boundary splat timestamp after simulation');
      encodeBoundarySidecar(encoder, {
        timestampWrites: {
          querySet,
          endOfPassWriteIndex: 2,
        },
      });
      const splatsEncoded = encodeBoundarySplats(encoder, {
        finalizeTimestampWrites: {
          querySet,
          endOfPassWriteIndex: 3,
        },
      });
      if (!splatsEncoded) {
        throw new Error(state.boundarySplatFallbackReason || 'boundary-splat-profile-route-unavailable');
      }
      const splatApplied = encodeBoundarySplatDraw(encoder, frameTexture.createView(), boundarySplatReadbackPipeline, {
        timestampWrites: {
          querySet,
          beginningOfPassWriteIndex: 4,
          endOfPassWriteIndex: 5,
        },
      });
      if (!splatApplied) {
        throw new Error(state.boundarySplatFallbackReason || 'boundary-splat-profile-raster-unavailable');
      }
      encodeDraw(encoder, frameTexture.createView(), 'kaminos boundary splat matched raymarch timestamp pass', readbackPipeline, {
        timestampWrites: {
          querySet,
          endOfPassWriteIndex: 6,
        },
      });
      encoder.resolveQuerySet(querySet, 0, queryCount, resolveBuffer, 0);
      encoder.copyBufferToBuffer(resolveBuffer, 0, readbackBuffer, 0, queryCount * 8);
      device.queue.submit([encoder.finish()]);
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const timestamps = new BigUint64Array(readbackBuffer.getMappedRange().slice(0));
      readbackBuffer.unmap();
      const validationError = await device.popErrorScope();
      if (validationError) {
        throw new Error(validationError.message || String(validationError));
      }
      if (timestamps.some(value => value === 0n)) {
        throw new Error(`timestamp-query-incomplete:${Array.from(timestamps, value => value.toString()).join(',')}`);
      }
      for (let index = 1; index < timestamps.length; index += 1) {
        if (timestamps[index] < timestamps[index - 1]) {
          throw new Error(`timestamp-query-nonmonotonic:${Array.from(timestamps, value => value.toString()).join(',')}`);
        }
      }
      const nsToMs = (endIndex, startIndex) => Number(timestamps[endIndex] - timestamps[startIndex]) / 1_000_000;
      const candidateCopyBytes = state.boundarySplatCopyBytesThisFrame ?? 0;
      return setBoundarySplatGpuProfile(makeBoundarySplatGpuProfile({
        timestampStatus: 'available',
        reason: 'timestamp-query-sampled',
        candidateCopyBytes,
        rendererIdentity: state.boundarySplatRendererIdentity,
        stages: {
          simulation: makeBoundarySplatStage('sampled', nsToMs(1, 0)),
          sidecar: makeBoundarySplatStage('sampled', nsToMs(2, 1)),
          compaction: makeBoundarySplatStage('sampled', nsToMs(3, 2)),
          candidateCopy: makeBoundarySplatStage('sampled', 0, {
            disposition: 'removed-full-capacity-copy',
            candidateCopyBytes,
          }),
          indirectSetup: makeBoundarySplatStage('sampled', nsToMs(4, 3)),
          splatRaster: makeBoundarySplatStage('sampled', nsToMs(5, 4)),
          matchedRaymarchRaster: makeBoundarySplatStage('sampled', nsToMs(6, 5)),
          total: makeBoundarySplatStage('sampled', nsToMs(6, 0)),
        },
      }));
    } catch (error) {
      try {
        const validationError = await device.popErrorScope();
        if (validationError && !String(error?.message || error).includes(validationError.message)) {
          error = new Error(`${error?.message || String(error)}; validation:${validationError.message || String(validationError)}`);
        }
      } catch {
        // The validation scope may already have been popped; the original failure stays reportable.
      }
      return setBoundarySplatGpuProfile(makeBoundarySplatGpuProfile({
        timestampStatus: 'unsupported',
        reason: `timestamp-query-profile-failed:${error?.message || String(error)}`,
        candidateCopyBytes: state.boundarySplatCopyBytesThisFrame ?? 0,
        rendererIdentity: state.boundarySplatRendererIdentity,
      }));
    } finally {
      resolveBuffer.destroy();
      readbackBuffer.destroy();
      querySet.destroy?.();
    }
  }

  async function resolveBoundarySplatTelemetry() {
    if (!boundarySplatTelemetryCopyPending || boundarySplatTelemetryMapPending || !boundarySplatReadbackBuffer) return;
    boundarySplatTelemetryCopyPending = false;
    boundarySplatTelemetryMapPending = true;
    try {
      await boundarySplatReadbackBuffer.mapAsync(GPUMapMode.READ);
      const drawState = new Uint32Array(boundarySplatReadbackBuffer.getMappedRange());
      state.boundarySplatInstanceCount = drawState[1];
      const candidateCount = drawState[4];
      const overflowCount = drawState[5];
      state.boundarySplatCandidateCount = candidateCount;
      state.boundarySplatOverflowCount = overflowCount;
      boundarySplatReadbackBuffer.unmap();
      if (overflowCount > 0) growBoundarySplatCapacity(candidateCount);
    } catch (error) {
      state.boundarySplatCandidateCount = null;
      state.boundarySplatOverflowCount = null;
      state.boundarySplatFallbackReason = `count-readback-failed:${error?.message || String(error)}`;
    } finally {
      boundarySplatTelemetryMapPending = false;
    }
  }

  async function sampleBoundarySplatDrawState() {
    if (!boundarySplatRequested() || !boundarySplatDrawBuffer) return null;
    if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    const readback = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} witness draw-state readback`,
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} witness draw-state encoder` });
    encoder.copyBufferToBuffer(boundarySplatDrawBuffer, 0, readback, 0, 32);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const drawState = new Uint32Array(readback.getMappedRange());
    const result = {
      instanceCount: drawState[1],
      candidateCount: drawState[4],
      overflowCount: drawState[5],
      authority: 'gpu-indirect-post-submit-witness-readback',
    };
    readback.unmap();
    readback.destroy();
    state.boundarySplatInstanceCount = result.instanceCount;
    state.boundarySplatCandidateCount = result.candidateCount;
    state.boundarySplatOverflowCount = result.overflowCount;
    return result;
  }

  async function sampleBoundarySplatFeatureCapture(instanceCount) {
    if (!state.boundarySplatFeatureCaptureRequested) return null;
    if (!state.boundarySplatFeatureCaptureEffective || !boundarySplatFeatureBuffer) {
      throw new Error('boundary-splat-feature-capture-requested-but-unavailable');
    }
    if (!Number.isInteger(instanceCount) || instanceCount <= 0) {
      throw new Error(`boundary-splat-feature-capture-blank-instance-count:${instanceCount}`);
    }
    if (instanceCount > boundarySplatCapacity) {
      throw new Error(`boundary-splat-feature-capture-instance-count-exceeds-capacity:${instanceCount}`);
    }
    const captureBytes = instanceCount * BOUNDARY_SPLAT_FEATURE_STRIDE_BYTES;
    const readback = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY} witness readback`,
      size: captureBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder({ label: `kaminos ${BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY} witness encoder` });
      encoder.copyBufferToBuffer(boundarySplatFeatureBuffer, 0, readback, 0, captureBytes);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(readback.getMappedRange()).slice();
      readback.unmap();
      return {
        ...packBoundarySplatFeatureCapture(values, instanceCount, boundarySplatCapacity),
        status: 'captured',
        requested: true,
        effective: true,
        rendererIdentity: state.boundarySplatRendererIdentity,
        modelIdentity: state.boundarySplatAttributeModelIdentity,
        countAuthority: 'gpu-indirect-post-submit-witness-readback',
      };
    } finally {
      readback.destroy();
    }
  }

  function encodeDraw(encoder, view, label, targetPipeline = pipeline, options = {}) {
    const pass = encoder.beginRenderPass({
      label,
      ...(options.timestampWrites ? { timestampWrites: options.timestampWrites } : {}),
      colorAttachments: [{
        view,
        clearValue: { r: 0.004, g: 0.005, b: 0.006, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(targetPipeline);
    pass.setBindGroup(0, options.bindGroup || bindGroups[currentFluid]);
    pass.draw(3);
    pass.end();
  }

  function encodeBrowserResidualSourcePass(encoder, colorView, featureView) {
    const pass = encoder.beginRenderPass({
      label: 'kaminos volume browser residual shader-material-authority source pass',
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.004, g: 0.005, b: 0.006, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
        {
          view: featureView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(browserResidualSourcePipeline);
    pass.setBindGroup(0, bindGroups[currentFluid]);
    pass.draw(3);
    pass.end();
  }

  function encodeBrowserResidualPass(encoder, view) {
    const bindGroup = ensureBrowserResidualBindGroup();
    if (!bindGroup) return false;
    const pass = encoder.beginRenderPass({
      label: 'kaminos browser webgpu-direct-residual pass',
      colorAttachments: [{
        view,
        clearValue: { r: 0.004, g: 0.005, b: 0.006, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(browserResidualPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    state.volumeReconstructionStyle = 'webgpu-direct-residual';
    return true;
  }

  function updateSelectiveHeadLiveCompositionState() {
    const request = selectiveHeadLiveRenderCompositionRequest(controlsSnapshot.selectiveHeadLiveRenderComposition);
    const effective = state.selectiveHeadLiveEffectiveRole === 'off' ? 'off' : request.requested;
    state.selectiveHeadLiveCompositionRequestedRaw = request.raw;
    state.selectiveHeadLiveCompositionRequested = request.requested;
    state.selectiveHeadLiveCompositionEffective = effective;
    state.selectiveHeadLiveCompositionAuthority = effective === 'off'
      ? 'off'
      : selectiveHeadLiveRenderCompositionAuthority(request.requested);
    state.selectiveHeadLiveCompositionFallbackReason = request.fallbackReason;
    return {
      ...request,
      effective,
      definition: effective === 'off'
        ? { raymarch: false, splat: false, raymarchFireAuthority: 0, compositionAuthority: 'off' }
        : request.definition,
    };
  }

  function recordSelectiveHeadLivePassReceipt(receipt) {
    state.selectiveHeadLivePassReceipt = makeSelectiveHeadLivePassReceipt(receipt);
    if (state.selectiveHeadLiveCompositionEffective !== 'off') {
      state.volumeReconstructionStyle = state.selectiveHeadLiveCompositionEffective;
    }
    return state.selectiveHeadLivePassReceipt;
  }

  function encodeHistoryCopy(encoder, sourceTexture) {
    if (!historyTexture || state.width < 1 || state.height < 1) return;
    encoder.copyTextureToTexture(
      { texture: sourceTexture },
      { texture: historyTexture },
      { width: state.width, height: state.height, depthOrArrayLayers: 1 }
    );
    historyValid = true;
    state.temporalHistoryValid = true;
    state.temporalHistoryFrames += 1;
  }

  function render(now) {
    if (!state.active) return;
    if (selectiveHeadLiveCapturePaused) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(render);
    try {
      const cpuStart = performance.now();
      controls?.update?.();
      updateUniforms(now);
      const encoder = device.createCommandEncoder({ label: 'kaminos compute fluid frame' });
      const lookFreeze = normalizeLookFreeze(controlsSnapshot.lookFreeze) && lookFreezeCanPin(state) ? 1 : 0;
      state.lookFreeze = lookFreeze;
      if (lookFreeze) {
        if (state.lookFreezeFrame === null) state.lookFreezeFrame = state.frameCount;
        state.lookFreezeSkippedFrames += 1;
        state.majorantBuiltThisFrame = false;
      } else {
        state.lookFreezeFrame = null;
        state.lookFreezeSkippedFrames = 0;
        encodeSim(encoder);
        encodeSelectiveHeadLiveFields(encoder);
        const selectiveMajorant = selectiveHeadLiveRoleGroups('majorant');
        encodeMajorant(encoder, {
          readBindGroup: selectiveMajorant,
          force: state.selectiveHeadLiveEffectiveRole !== 'off',
        });
      }
      const selectiveSidecar = selectiveHeadLiveRoleGroups('sidecar');
      const selectiveSplat = selectiveHeadLiveRoleGroups('splat');
      const selectiveRender = selectiveHeadLiveRoleGroups('render');
      encodeBoundarySidecar(encoder, { readBindGroup: selectiveSidecar });
      encodeBoundarySplats(encoder, { computeBindGroup: selectiveSplat });
      const currentTexture = context.getCurrentTexture();
      if (boundarySplatRequested()) {
        const composition = updateSelectiveHeadLiveCompositionState();
        let raymarchEncoded = false;
        let raymarchApplied = false;
        let splatEncoded = false;
        let splatApplied = false;
        if (composition.definition.raymarch) {
          encodeDraw(
            encoder,
            currentTexture.createView(),
            `kaminos selective-head live ${composition.effective} raymarch pass`,
            pipeline,
            { bindGroup: selectiveRender },
          );
          raymarchEncoded = true;
          raymarchApplied = true;
        }
        if (composition.definition.splat) {
          splatEncoded = encodeBoundarySplatDraw(
            encoder,
            currentTexture.createView(),
            boundarySplatRenderPipeline,
            { loadOp: raymarchApplied ? 'load' : 'clear' },
          );
          splatApplied = splatEncoded;
        }
        if (composition.definition.splat && !splatApplied) {
          encodeDraw(
            encoder,
            currentTexture.createView(),
            'kaminos selective-head live explicit fallback raymarch',
            pipeline,
            { bindGroup: selectiveRender },
          );
          raymarchEncoded = true;
          raymarchApplied = true;
          state.selectiveHeadLiveCompositionFallbackReason = state.boundarySplatFallbackReason || 'boundary-splat-route-unavailable';
          state.volumeReconstructionStyle = 'selective-head-live-fallback-raymarch';
          emitStatus({ phase: 'selective-head-live-composition-fallback', reason: state.selectiveHeadLiveCompositionFallbackReason });
        }
        recordSelectiveHeadLivePassReceipt({
          composition: composition.effective === 'off' ? composition.requested : composition.effective,
          raymarchEncoded,
          raymarchApplied,
          splatEncoded,
          splatApplied,
          fallbackReason: state.selectiveHeadLiveCompositionFallbackReason,
        });
        recordBrowserResidualCost({ applied: false });
      } else if (browserResidualCanApply()) {
        const sourceEncodeStart = performance.now();
        ensureFrameTexture();
        ensureBrowserResidualFeatureTexture();
        encodeBrowserResidualSourcePass(encoder, frameTexture.createView(), browserResidualFeatureTexture.createView());
        const sourcePassEncodeMs = performance.now() - sourceEncodeStart;
        const residualEncodeStart = performance.now();
        const residualApplied = encodeBrowserResidualPass(encoder, currentTexture.createView());
        const residualPassEncodeMs = performance.now() - residualEncodeStart;
        recordBrowserResidualCost({ applied: residualApplied, sourcePassEncodeMs, residualPassEncodeMs });
      } else {
        encodeDraw(encoder, currentTexture.createView(), 'kaminos volume canvas pass');
        state.volumeReconstructionStyle = state.renderScale < 0.999 ? 'linear-css-upscale' : 'native-resolution';
        recordBrowserResidualCost({ applied: false });
      }
      encodeHistoryCopy(encoder, currentTexture);
      encodeBoundarySplatTelemetry(encoder);
      device.queue.submit([encoder.finish()]);
      if (boundarySplatTelemetryCopyPending) void resolveBoundarySplatTelemetry();
      commitPreviousViewProjection();
      state.frameCount += 1;
      state.lastFrameEnergy = Math.min(9.999, state.simStepCount * 0.001 + 0.55 * controlsSnapshot.density + 0.35 * controlsSnapshot.fire + 0.18 * (controlsSnapshot.radiance ?? 1.65));
      recordVolumeFrameTiming(now, performance.now() - cpuStart);
      if (state.frameCount % 12 === 0) probeVolumeQueueTiming();
    } catch (err) {
      state.active = false;
      state.error = err?.message || String(err);
      canvas.classList.remove('active');
      cancelAnimationFrame(raf);
      emitStatus({ phase: 'render-error', error: state.error });
    }
  }

  function pumpLookLabFrozenFrame() {
    if (!state.active || !device) return;
    if (!(normalizeLookFreeze(controlsSnapshot.lookFreeze) && lookFreezeCanPin(state))) return;
    cancelAnimationFrame(raf);
    raf = 0;
    render(performance.now());
  }

  let debugFullFieldExportSession = null;

  async function materializeFullFieldDerivedBuffersForDebugExport(nowMs = performance.now()) {
    updateUniforms(nowMs);
    const encoder = device.createCommandEncoder({ label: 'kaminos full-field derived-buffer materialization' });
    encodeBoundarySidecar(encoder);
    const boundarySplatsEncoded = encodeBoundarySplats(encoder);
    device.queue.submit([encoder.finish()]);
    if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    return {
      identity: 'frozen-field-derived-buffer-materialization-v0',
      nowMs,
      boundarySidecarBuilt: state.boundarySidecarBuiltThisFrame,
      boundarySidecarAuthority: state.boundarySidecarAuthority,
      boundarySplatsEncoded,
      boundarySplatMode: state.boundarySplatMode,
      boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
      boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
      boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
      boundarySplatFallbackReason: state.boundarySplatFallbackReason,
    };
  }

  async function copyFullFieldBuffersForDebugExport(derivedBuffers) {
    const fluidBytes = fluidBufferBytes(gridSize);
    const frontBytes = frontFieldBufferBytes(gridSize);
    const boundaryBytes = boundarySidecarBufferBytes(gridSize);
    const fluidReadback = device.createBuffer({
      label: 'kaminos full-field fluid export readback',
      size: fluidBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const frontReadback = device.createBuffer({
      label: `kaminos ${FRONT_FIELD_IDENTITY} full-field export readback`,
      size: frontBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const boundaryReadback = device.createBuffer({
      label: `kaminos ${BOUNDARY_SIDECAR_IDENTITY} full-field export readback`,
      size: boundaryBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const boundarySplatDrawReadback = device.createBuffer({
      label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} full-field draw-state readback`,
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos full-field export readback encoder' });
    encoder.copyBufferToBuffer(fluidBuffers[currentFluid], 0, fluidReadback, 0, fluidBytes);
    encoder.copyBufferToBuffer(frontBuffers[currentFront], 0, frontReadback, 0, frontBytes);
    encoder.copyBufferToBuffer(boundarySidecarBuffer, 0, boundaryReadback, 0, boundaryBytes);
    encoder.copyBufferToBuffer(boundarySplatDrawBuffer, 0, boundarySplatDrawReadback, 0, 32);
    device.queue.submit([encoder.finish()]);
    await Promise.all([
      fluidReadback.mapAsync(GPUMapMode.READ),
      frontReadback.mapAsync(GPUMapMode.READ),
      boundaryReadback.mapAsync(GPUMapMode.READ),
      boundarySplatDrawReadback.mapAsync(GPUMapMode.READ),
    ]);
    const fluid = new Float32Array(fluidReadback.getMappedRange()).slice();
    const front = new Float32Array(frontReadback.getMappedRange()).slice();
    const boundary = new Float32Array(boundaryReadback.getMappedRange()).slice();
    const boundarySplatDraw = new Uint32Array(boundarySplatDrawReadback.getMappedRange()).slice();
    fluidReadback.unmap();
    fluidReadback.destroy();
    frontReadback.unmap();
    frontReadback.destroy();
    boundaryReadback.unmap();
    boundaryReadback.destroy();
    boundarySplatDrawReadback.unmap();
    boundarySplatDrawReadback.destroy();

    const instanceCount = derivedBuffers?.boundarySplatsEncoded === true ? boundarySplatDraw[1] : 0;
    const candidateCount = derivedBuffers?.boundarySplatsEncoded === true ? boundarySplatDraw[4] : 0;
    const overflowCount = derivedBuffers?.boundarySplatsEncoded === true ? boundarySplatDraw[5] : 0;
    const capacity = boundarySplatDraw[6] || boundarySplatCapacity;
    const boundarySplatBytes = instanceCount * BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES;
    let boundarySplats = new Float32Array(0);
    if (boundarySplatBytes > 0) {
      const boundarySplatReadback = device.createBuffer({
        label: `kaminos ${BOUNDARY_SPLAT_RENDERER_IDENTITY} effective-output readback`,
        size: boundarySplatBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const splatEncoder = device.createCommandEncoder({ label: 'kaminos effective boundary-splat export readback encoder' });
      splatEncoder.copyBufferToBuffer(boundarySplatBuffer, 0, boundarySplatReadback, 0, boundarySplatBytes);
      device.queue.submit([splatEncoder.finish()]);
      await boundarySplatReadback.mapAsync(GPUMapMode.READ);
      boundarySplats = new Float32Array(boundarySplatReadback.getMappedRange()).slice();
      boundarySplatReadback.unmap();
      boundarySplatReadback.destroy();
    }
    return {
      fluid,
      front,
      boundary,
      boundarySplats,
      fluidBytes,
      frontBytes,
      boundaryBytes,
      boundarySplatBytes,
      boundarySplatDraw: { instanceCount, candidateCount, overflowCount, capacity },
    };
  }

  function fullFieldExportDescriptorFor(values, kind, byteLength) {
    const isBoundary = kind === 'boundary';
    const isBoundarySplat = kind === 'boundarySplat';
    return {
      kind,
      dtype: 'float32',
      byteOrder: 'little-endian',
      floatCount: values.length,
      byteLength,
      shape: isBoundarySplat
        ? [values.length / BOUNDARY_SPLAT_CHANNELS.length, BOUNDARY_SPLAT_CHANNELS.length]
        : kind === 'fluid'
        ? [gridSize, gridSize, gridSize, FLUID_COMPONENTS]
        : isBoundary
          ? [gridSize, gridSize, gridSize, 4]
          : [gridSize, gridSize, gridSize, 1],
      channelOrder: isBoundarySplat
        ? BOUNDARY_SPLAT_CHANNELS
        : kind === 'fluid'
        ? FULL_FIELD_CHANNELS
        : isBoundary
          ? ['support', 'coverage', 'ridge', 'footprint']
          : ['frontTopology'],
    };
  }

  function fullFieldExportPublicSession(session) {
    if (!session) return null;
    return {
      schema: FULL_FIELD_EXPORT_IDENTITY,
      identity: 'full-grid-fluid-front-boundary-sidecars-v0',
      authority: 'debug-full-grid-webgpu-copy-buffer-readback',
      status: session.status,
      sessionId: session.sessionId,
      createdAtMs: session.createdAtMs,
      grid: session.grid,
      cellCount: session.cellCount,
      completeFieldCoverage: true,
      routeIdentity: ROUTE_IDENTITY,
      prototypeIdentity: PROTOTYPE_IDENTITY,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
      simGridLabel: state.simGridLabel,
      frontFieldIdentity: state.frontFieldIdentity,
      deterministicReplay: session.deterministicReplay,
      fluidComponents: FLUID_COMPONENTS,
      fluidChannelOrder: FULL_FIELD_CHANNELS,
      frontChannelOrder: ['frontTopology'],
      fluid: session.fluidDescriptor,
      front: session.frontDescriptor,
      boundarySidecar: {
        schema: 'kaminos.volume.boundary-sidecar-export.v0',
        identity: BOUNDARY_SIDECAR_IDENTITY,
        authority: BOUNDARY_SIDECAR_BAKE_AUTHORITY,
        routeIdentity: ROUTE_IDENTITY,
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: PROTOTYPE_IDENTITY,
        backend: state.backend,
        grid: session.grid,
        cellCount: session.cellCount,
        channelOrder: ['support', 'coverage', 'ridge', 'footprint'],
        boundarySidecarDebug: boundarySidecarDebug('baked'),
        sidecars: {
          boundary: session.boundaryDescriptor,
        },
      },
      boundarySplats: {
        schema: 'kaminos.volume.boundary-splat-effective-output.v0',
        identity: session.derivedBuffers.boundarySplatRendererIdentity,
        attributeModelIdentity: session.derivedBuffers.boundarySplatAttributeModelIdentity,
        sourceAuthority: session.derivedBuffers.boundarySplatSourceAuthority,
        materialization: session.derivedBuffers,
        draw: session.boundarySplatDraw,
        sidecars: {
          boundarySplats: session.boundarySplatDescriptor,
        },
      },
    };
  }

  function encodeFloat32ChunkBase64(values, startFloat, floatCount) {
    const byteStart = startFloat * Float32Array.BYTES_PER_ELEMENT;
    const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
    const bytes = new Uint8Array(values.buffer, values.byteOffset + byteStart, byteLength);
    let binary = '';
    const batch = 0x8000;
    for (let i = 0; i < bytes.length; i += batch) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + batch)));
    }
    return btoa(binary);
  }

  function decodeFullFieldImportChunk(base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function fullFieldImportFailure(failurePhase, reason, extra = {}) {
    const failed = {
      schema: FULL_FIELD_IMPORT_IDENTITY,
      identity: 'checksum-addressed-fluid-front-import-v0',
      status: 'failed',
      failurePhase,
      reason,
      initializationAuthority: COARSE_RECEIVER_INITIALIZATION_AUTHORITY,
      routeIdentity: ROUTE_IDENTITY,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: PROTOTYPE_IDENTITY,
      backend: state.backend,
      ...extra,
    };
    state.fullFieldImportReceipt = failed;
    return { ok: false, ...failed };
  }

  function beginDebugFullFieldImport(payload = {}) {
    if (!device) return fullFieldImportFailure('begin', 'inactive');
    const isCoarseReceiver = payload.initializationAuthority === COARSE_RECEIVER_INITIALIZATION_AUTHORITY
      && payload.filterIdentity === 'volume-overlap-box-filter-high-to-receiver-v0';
    const isSelectiveComposition = payload.initializationAuthority === SELECTIVE_COMPOSITION_AUTHORITY
      && payload.filterIdentity === SELECTIVE_COMPOSITION_APPLICATION_IDENTITY;
    const isPhaseAlignedHeld = (
      payload.initializationAuthority === PHASE_ALIGNED_TRUTH_HELD_AUTHORITY
      || payload.initializationAuthority === PHASE_ALIGNED_LOW_HELD_AUTHORITY
    ) && payload.filterIdentity === PHASE_ALIGNED_HELD_APPLICATION_IDENTITY;
    const isNativeLowHeld = payload.initializationAuthority === NATIVE_LOW_HELD_INITIALIZATION_AUTHORITY
      && payload.filterIdentity === NATIVE_LOW_HELD_APPLICATION_IDENTITY;
    const isNativeLowSelective = payload.initializationAuthority === NATIVE_LOW_SELECTIVE_INITIALIZATION_AUTHORITY
      && payload.filterIdentity === NATIVE_LOW_SELECTIVE_APPLICATION_IDENTITY;
    const isNativeLowCrossGridSelective = payload.initializationAuthority === NATIVE_LOW_CROSS_GRID_SELECTIVE_INITIALIZATION_AUTHORITY
      && payload.filterIdentity === NATIVE_LOW_SELECTIVE_APPLICATION_IDENTITY;
    const isLiveReplay = payload.initializationAuthority === CHECKSUM_ADDRESSED_LIVE_REPLAY_AUTHORITY
      && payload.filterIdentity === EXACT_FIELD_LIVE_REPLAY_APPLICATION_IDENTITY;
    if (!isCoarseReceiver && !isSelectiveComposition && !isPhaseAlignedHeld
      && !isNativeLowHeld && !isNativeLowSelective && !isNativeLowCrossGridSelective && !isLiveReplay) {
      return fullFieldImportFailure('begin', 'initialization-authority-mismatch', {
        requestedInitializationAuthority: payload.initializationAuthority || null,
        requestedFilterIdentity: payload.filterIdentity || null,
      });
    }
    const requestedGrid = Math.floor(Number(payload.grid));
    if (!SUPPORTED_GRID_SIZES.includes(requestedGrid)) {
      return fullFieldImportFailure('begin', 'unsupported-grid', { requestedGrid });
    }
    const expectedFluidBytes = fluidBufferBytes(requestedGrid);
    const expectedFrontBytes = frontFieldBufferBytes(requestedGrid);
    const fluid = payload.fluid || {};
    const front = payload.front || {};
    const validSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
    if (Number(fluid.byteLength) !== expectedFluidBytes || Number(front.byteLength) !== expectedFrontBytes) {
      return fullFieldImportFailure('begin', 'byte-length-mismatch', {
        expectedFluidBytes,
        requestedFluidBytes: Number(fluid.byteLength),
        expectedFrontBytes,
        requestedFrontBytes: Number(front.byteLength),
      });
    }
    if (!validSha256(fluid.sha256) || !validSha256(front.sha256)) {
      return fullFieldImportFailure('begin', 'sha256-missing');
    }
    if (JSON.stringify(fluid.channelOrder) !== JSON.stringify(FULL_FIELD_CHANNELS)
      || JSON.stringify(front.channelOrder) !== JSON.stringify(['frontTopology'])) {
      return fullFieldImportFailure('begin', 'channel-order-mismatch');
    }
    const wasActive = state.active;
    state.active = false;
    canvas.classList.remove('active');
    cancelAnimationFrame(raf);
    if (gridSize !== requestedGrid) rebuildFluidState(requestedGrid, majorantGridSize, 'full-field-import-grid-rebuild');
    debugFullFieldImportUpload = {
      sessionId: `full-field-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      status: 'receiving',
      wasActive,
      grid: requestedGrid,
      initializationAuthority: payload.initializationAuthority,
      filterIdentity: String(payload.filterIdentity || ''),
      layoutIdentity: String(payload.layoutIdentity || ''),
      source: payload.source || null,
      sourceManifestPath: payload.sourceManifestPath || null,
      sourceManifestSha256: payload.sourceManifestSha256 || null,
      receiverInitialSimStepCount: Math.max(0, Math.floor(Number(payload.receiverInitialSimStepCount) || 0)),
      fluid: {
        expectedSha256: fluid.sha256.toLowerCase(),
        byteLength: expectedFluidBytes,
        bytes: new Uint8Array(expectedFluidBytes),
        receivedBytes: 0,
        chunkCount: 0,
      },
      front: {
        expectedSha256: front.sha256.toLowerCase(),
        byteLength: expectedFrontBytes,
        bytes: new Uint8Array(expectedFrontBytes),
        receivedBytes: 0,
        chunkCount: 0,
      },
    };
    state.fullFieldImportReceipt = {
      schema: FULL_FIELD_IMPORT_IDENTITY,
      identity: 'checksum-addressed-fluid-front-import-v0',
      status: 'receiving',
      failurePhase: null,
      sessionId: debugFullFieldImportUpload.sessionId,
      initializationAuthority: payload.initializationAuthority,
      filterIdentity: debugFullFieldImportUpload.filterIdentity,
      layoutIdentity: debugFullFieldImportUpload.layoutIdentity,
      grid: requestedGrid,
      receiverInitialSimStepCount: debugFullFieldImportUpload.receiverInitialSimStepCount,
      expectedFluidSha256: debugFullFieldImportUpload.fluid.expectedSha256,
      expectedFrontSha256: debugFullFieldImportUpload.front.expectedSha256,
      expectedFluidBytes,
      expectedFrontBytes,
      renderLoopPaused: true,
    };
    return { ok: true, ...state.fullFieldImportReceipt };
  }

  function writeDebugFullFieldImportChunk(payload = {}) {
    const upload = debugFullFieldImportUpload;
    if (!upload || payload.sessionId !== upload.sessionId) {
      return fullFieldImportFailure('chunk-write', 'session-id-mismatch');
    }
    const kind = payload.kind === 'front' ? 'front' : payload.kind === 'fluid' ? 'fluid' : null;
    if (!kind) return fullFieldImportFailure('chunk-write', 'unsupported-kind');
    const target = upload[kind];
    const byteOffset = Math.floor(Number(payload.byteOffset));
    if (byteOffset !== target.receivedBytes) {
      return fullFieldImportFailure('chunk-write', 'non-sequential-byte-offset', {
        kind,
        expectedByteOffset: target.receivedBytes,
        requestedByteOffset: byteOffset,
      });
    }
    const chunk = decodeFullFieldImportChunk(payload.base64);
    if (byteOffset + chunk.byteLength > target.byteLength) {
      return fullFieldImportFailure('chunk-write', 'chunk-overflow', { kind, byteOffset, chunkByteLength: chunk.byteLength });
    }
    target.bytes.set(chunk, byteOffset);
    target.receivedBytes += chunk.byteLength;
    target.chunkCount += 1;
    return {
      ok: true,
      schema: FULL_FIELD_IMPORT_IDENTITY,
      sessionId: upload.sessionId,
      kind,
      byteOffset,
      byteLength: chunk.byteLength,
      receivedBytes: target.receivedBytes,
      expectedBytes: target.byteLength,
      chunkCount: target.chunkCount,
      isFinal: target.receivedBytes === target.byteLength,
    };
  }

  async function finishDebugFullFieldImport(payload = {}) {
    const upload = debugFullFieldImportUpload;
    if (!upload || payload.sessionId !== upload.sessionId) {
      return fullFieldImportFailure('finish', 'session-id-mismatch');
    }
    for (const kind of ['fluid', 'front']) {
      if (upload[kind].receivedBytes !== upload[kind].byteLength) {
        return fullFieldImportFailure('finish', 'incomplete-upload', {
          kind,
          receivedBytes: upload[kind].receivedBytes,
          expectedBytes: upload[kind].byteLength,
        });
      }
    }
    const digestHex = async bytes => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const actualFluidSha256 = await digestHex(upload.fluid.bytes);
    const actualFrontSha256 = await digestHex(upload.front.bytes);
    if (actualFluidSha256 !== upload.fluid.expectedSha256 || actualFrontSha256 !== upload.front.expectedSha256) {
      debugFullFieldImportUpload = null;
      return fullFieldImportFailure('sha256-validation', 'sha256-mismatch', {
        expectedFluidSha256: upload.fluid.expectedSha256,
        actualFluidSha256,
        expectedFrontSha256: upload.front.expectedSha256,
        actualFrontSha256,
      });
    }
    device.queue.writeBuffer(fluidBuffers[0], 0, upload.fluid.bytes);
    device.queue.writeBuffer(fluidBuffers[1], 0, upload.fluid.bytes);
    device.queue.writeBuffer(frontBuffers[0], 0, upload.front.bytes);
    device.queue.writeBuffer(frontBuffers[1], 0, upload.front.bytes);
    const zeroPressure = new Float32Array(gridCellCount(gridSize) * 4);
    device.queue.writeBuffer(pressureBuffers[0], 0, zeroPressure);
    device.queue.writeBuffer(pressureBuffers[1], 0, zeroPressure);
    if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    currentFluid = 0;
    currentFront = 0;
    state.frameCount = upload.receiverInitialSimStepCount;
    state.simStepCount = upload.receiverInitialSimStepCount;
    state.frontFieldReadIndex = currentFront;
    state.frontFieldWriteIndex = 1 - currentFront;
    state.majorantBuilt = false;
    state.majorantBuiltThisFrame = false;
    state.majorantLastBuiltFrame = -1;
    state.boundarySidecarBuilt = false;
    state.boundarySidecarBuiltThisFrame = false;
    state.boundarySidecarLastBuiltFrame = -1;
    state.boundarySidecarOverrideReceipt = null;
    boundarySidecarOverrideUpload = null;
    state.deterministicReplay = null;
    resetTemporalHistory('full-field-import');
    const receipt = {
      schema: FULL_FIELD_IMPORT_IDENTITY,
      identity: 'checksum-addressed-fluid-front-import-v0',
      status: 'applied',
      failurePhase: null,
      sessionId: upload.sessionId,
      initializationAuthority: upload.initializationAuthority,
      filterIdentity: upload.filterIdentity,
      layoutIdentity: upload.layoutIdentity,
      grid: upload.grid,
      source: upload.source,
      sourceManifestPath: upload.sourceManifestPath,
      sourceManifestSha256: upload.sourceManifestSha256,
      receiverInitialSimStepCount: upload.receiverInitialSimStepCount,
      fluidSha256: actualFluidSha256,
      frontSha256: actualFrontSha256,
      fluidByteLength: upload.fluid.byteLength,
      frontByteLength: upload.front.byteLength,
      fluidChunkCount: upload.fluid.chunkCount,
      frontChunkCount: upload.front.chunkCount,
      pressureState: 'zeroed-before-first-receiver-step',
      pingPongState: 'both-read-write-buffers-identical',
      temporalHistory: 'reset',
      renderLoopPaused: true,
      activeBeforeImport: upload.wasActive,
      routeIdentity: ROUTE_IDENTITY,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: PROTOTYPE_IDENTITY,
      backend: state.backend,
    };
    state.active = false;
    canvas.classList.remove('active');
    cancelAnimationFrame(raf);
    state.fullFieldImportReceipt = receipt;
    debugFullFieldImportUpload = null;
    emitStatus({ phase: 'full-field-import-applied' });
    return { ok: true, ...receipt };
  }

  function advanceDebugImportedFieldSteps(payload = {}) {
    const receipt = state.fullFieldImportReceipt;
    if (!receipt || receipt.status !== 'applied' || payload.sessionId !== receipt.sessionId) {
      return fullFieldImportFailure('imported-advance', 'session-id-mismatch');
    }
    if (receipt.importedAdvance) {
      return {
        ok: false,
        schema: FULL_FIELD_IMPORT_IDENTITY,
        identity: 'imported-receiver-advance-rejected-v0',
        status: 'rejected',
        failurePhase: 'imported-advance',
        reason: 'already-advanced',
        sessionId: receipt.sessionId,
        priorAdvance: receipt.importedAdvance,
        priorAppliedReceipt: receipt,
      };
    }
    const requestedSteps = Number(payload.steps);
    if (!Number.isInteger(requestedSteps) || requestedSteps < 0) {
      return fullFieldImportFailure('imported-advance', 'invalid-step-count', { requestedSteps });
    }
    if (receipt.initializationAuthority === CHECKSUM_ADDRESSED_LIVE_REPLAY_AUTHORITY) {
      return {
        ok: false,
        schema: FULL_FIELD_IMPORT_IDENTITY,
        identity: 'imported-receiver-advance-rejected-v0',
        status: 'rejected',
        failurePhase: 'imported-advance',
        reason: 'live-replay-requires-native-resume-api',
        sessionId: receipt.sessionId,
        requestedSteps,
        priorAppliedReceipt: receipt,
      };
    }
    const phaseAlignedHeld = receipt.initializationAuthority === PHASE_ALIGNED_TRUTH_HELD_AUTHORITY
      || receipt.initializationAuthority === PHASE_ALIGNED_LOW_HELD_AUTHORITY;
    if ((receipt.initializationAuthority === SELECTIVE_COMPOSITION_AUTHORITY || phaseAlignedHeld) && requestedSteps > 0) {
      return {
        ok: false,
        schema: FULL_FIELD_IMPORT_IDENTITY,
        identity: 'imported-receiver-advance-rejected-v0',
        status: 'rejected',
        failurePhase: 'imported-advance',
        reason: phaseAlignedHeld ? 'phase-aligned-held-render-only' : 'selective-composition-held-only',
        sessionId: receipt.sessionId,
        requestedSteps,
        priorAppliedReceipt: receipt,
      };
    }
    const timeStepMs = Number.isFinite(Number(payload.timeStepMs)) ? Number(payload.timeStepMs) : 1000 / 60;
    const startTimeMs = Number.isFinite(Number(payload.startTimeMs)) ? Number(payload.startTimeMs) : 1000;
    state.active = false;
    canvas.classList.remove('active');
    cancelAnimationFrame(raf);
    const before = { frameCount: state.frameCount, simStepCount: state.simStepCount };
    for (let step = 0; step < requestedSteps; step += 1) {
      updateUniforms(startTimeMs + step * timeStepMs);
      const encoder = device.createCommandEncoder({ label: `kaminos imported receiver step ${step + 1}/${requestedSteps}` });
      encodeSim(encoder);
      if (step === requestedSteps - 1) encodeMajorant(encoder, { force: true });
      device.queue.submit([encoder.finish()]);
      state.frameCount += 1;
    }
    const importedAdvance = {
      identity: requestedSteps === 0
        ? receipt.initializationAuthority === SELECTIVE_COMPOSITION_AUTHORITY
          ? 'learned-selective-composition-held-render-v0'
          : phaseAlignedHeld
            ? receipt.initializationAuthority === PHASE_ALIGNED_TRUTH_HELD_AUTHORITY
              ? 'offline-high-truth-held-render-v0'
              : 'downsampled-phase-aligned-held-control-v0'
          : 'imported-receiver-held-state-v0'
        : requestedSteps === 1
          ? 'ordinary-receiver-single-simulation-step-v0'
          : 'imported-receiver-multi-step-sequence-v0',
      authority: 'session-bound-imported-state-ordinary-sim-step',
      requestedSteps,
      completedSteps: state.simStepCount - before.simStepCount,
      timeStepMs,
      startTimeMs,
      before,
      after: { frameCount: state.frameCount, simStepCount: state.simStepCount },
      renderLoopPaused: true,
      routeIdentity: ROUTE_IDENTITY,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
    };
    state.fullFieldImportReceipt = { ...receipt, importedAdvance };
    return { ok: true, schema: FULL_FIELD_IMPORT_IDENTITY, sessionId: receipt.sessionId, ...importedAdvance };
  }

  function resumeDebugImportedFieldLive(payload = {}) {
    const receipt = state.fullFieldImportReceipt;
    if (!receipt || receipt.status !== 'applied' || payload.sessionId !== receipt.sessionId) {
      return {
        ok: false,
        schema: FULL_FIELD_IMPORT_IDENTITY,
        identity: 'checksum-addressed-live-replay-rejected-v0',
        status: 'rejected',
        failurePhase: 'live-replay-resume',
        reason: 'session-id-mismatch',
        requestedSessionId: payload.sessionId || null,
        effectiveSessionId: receipt?.sessionId || null,
      };
    }
    if (receipt.initializationAuthority !== CHECKSUM_ADDRESSED_LIVE_REPLAY_AUTHORITY) {
      return {
        ok: false,
        schema: FULL_FIELD_IMPORT_IDENTITY,
        identity: 'checksum-addressed-live-replay-rejected-v0',
        status: 'rejected',
        failurePhase: 'live-replay-resume',
        reason: 'live-replay-authority-required',
        requestedInitializationAuthority: receipt.initializationAuthority,
        requiredInitializationAuthority: CHECKSUM_ADDRESSED_LIVE_REPLAY_AUTHORITY,
        priorAppliedReceipt: receipt,
      };
    }
    if (receipt.importedAdvance) {
      return {
        ok: false,
        schema: FULL_FIELD_IMPORT_IDENTITY,
        identity: 'checksum-addressed-live-replay-rejected-v0',
        status: 'rejected',
        failurePhase: 'live-replay-resume',
        reason: 'live-replay-import-already-advanced',
        priorAppliedReceipt: receipt,
      };
    }
    if (receipt.liveReplay) {
      return {
        ok: false,
        schema: FULL_FIELD_IMPORT_IDENTITY,
        identity: 'checksum-addressed-live-replay-rejected-v0',
        status: 'rejected',
        failurePhase: 'live-replay-resume',
        reason: 'already-resumed',
        priorAppliedReceipt: receipt,
      };
    }
    const before = { frameCount: state.frameCount, simStepCount: state.simStepCount };
    selectiveHeadLiveCapturePaused = false;
    state.selectiveHeadLiveCapturePaused = false;
    state.active = true;
    state.error = null;
    canvas.classList.add('active');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
    const liveReplay = {
      identity: 'checksum-addressed-native-render-loop-replay-v0',
      status: 'running',
      failurePhase: null,
      sessionId: receipt.sessionId,
      playbackRequested: 'live',
      playbackEffective: 'live',
      initializationAuthority: receipt.initializationAuthority,
      filterIdentity: receipt.filterIdentity,
      sourceSimStepCount: receipt.receiverInitialSimStepCount,
      before,
      renderLoopPaused: false,
      routeIdentity: ROUTE_IDENTITY,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
      resumedAtMs: performance.now(),
    };
    state.fullFieldImportReceipt = { ...receipt, renderLoopPaused: false, liveReplay };
    emitStatus({ phase: 'full-field-live-replay-running' });
    return { ok: true, schema: FULL_FIELD_IMPORT_IDENTITY, ...liveReplay };
  }

  async function beginDebugFullFieldExport(options = {}) {
    if (!device) {
      const failed = {
        schema: FULL_FIELD_EXPORT_IDENTITY,
        identity: 'full-grid-fluid-front-boundary-sidecars-v0',
        status: 'failed',
        failurePhase: 'inactive',
        reason: 'inactive',
        routeIdentity: ROUTE_IDENTITY,
        prototypeIdentity: PROTOTYPE_IDENTITY,
        effectiveRoute: state.effectiveRoute,
        backend: state.backend,
      };
      state.fullFieldExportSession = failed;
      return { ok: false, ...failed };
    }
    const wasActiveBeforeExport = state.active;
    if (debugFullFieldExportSession) {
      debugFullFieldExportSession.status = 'released';
      debugFullFieldExportSession = null;
    }
    const deterministicOptions = options.deterministicReplay || (
      Number.isFinite(Number(options.steps)) || Number.isFinite(Number(options.replaySteps))
        ? options
        : null
    );
    let replaySample = null;
    const controlsBeforeReplay = controlsSnapshot;
    if (deterministicOptions) {
      replaySample = await sampleDeterministicReplayFrame({
        ...deterministicOptions,
        fieldTileExport: null,
      });
      controlsSnapshot = controlsBeforeReplay;
      if (replaySample?.ok !== true) {
        const failed = {
          schema: FULL_FIELD_EXPORT_IDENTITY,
          identity: 'full-grid-fluid-front-boundary-sidecars-v0',
          status: 'failed',
          failurePhase: 'deterministic-replay',
          reason: replaySample?.reason || 'sample-failed',
          deterministicReplay: replaySample?.deterministicReplay || null,
          routeIdentity: ROUTE_IDENTITY,
          prototypeIdentity: PROTOTYPE_IDENTITY,
          effectiveRoute: state.effectiveRoute,
          backend: state.backend,
        };
        state.fullFieldExportSession = failed;
        return { ok: false, ...failed };
      }
    }
    const deterministicReplay = replaySample ? {
      identity: replaySample.identity,
      authority: replaySample.authority,
      resetReason: replaySample.resetReason,
      requestedSteps: replaySample.requestedSteps,
      completedSteps: replaySample.completedSteps,
      timeStepMs: replaySample.timeStepMs,
      startTimeMs: replaySample.startTimeMs,
      finalTimeMs: replaySample.finalTimeMs,
      controlsSignature: replaySample.controlsSignature,
      frameCount: replaySample.frameCount,
      simStepCount: replaySample.simStepCount,
      grid: replaySample.grid,
      majorantGrid: replaySample.majorantGrid,
      effectiveRoute: replaySample.effectiveRoute,
      prototypeIdentity: replaySample.prototypeIdentity,
      backend: replaySample.backend,
    } : null;
    const derivedBuffers = await materializeFullFieldDerivedBuffersForDebugExport(
      deterministicReplay?.finalTimeMs ?? performance.now(),
    );
    if (state.active) {
      state.active = false;
      canvas.classList.remove('active');
      cancelAnimationFrame(raf);
    }
    let captured = null;
    try {
      captured = await copyFullFieldBuffersForDebugExport(derivedBuffers);
    } finally {
      if (wasActiveBeforeExport) {
        state.active = true;
        canvas.classList.add('active');
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(render);
      }
    }
    const session = {
      status: 'captured',
      sessionId: `full-field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      createdAtMs: performance.now(),
      grid: gridSize,
      cellCount: gridCellCount(gridSize),
      deterministicReplay: replaySample ? {
        identity: replaySample.identity,
        completedSteps: replaySample.completedSteps,
        ...deterministicReplay,
      } : (state.deterministicReplay ? { ...state.deterministicReplay } : null),
      derivedBuffers,
      fluid: captured.fluid,
      front: captured.front,
      boundary: captured.boundary,
      boundarySplats: captured.boundarySplats,
      boundarySplatDraw: captured.boundarySplatDraw,
      fluidDescriptor: fullFieldExportDescriptorFor(captured.fluid, 'fluid', captured.fluidBytes),
      frontDescriptor: fullFieldExportDescriptorFor(captured.front, 'front', captured.frontBytes),
      boundaryDescriptor: fullFieldExportDescriptorFor(captured.boundary, 'boundary', captured.boundaryBytes),
      boundarySplatDescriptor: fullFieldExportDescriptorFor(captured.boundarySplats, 'boundarySplat', captured.boundarySplatBytes),
    };
    debugFullFieldExportSession = session;
    state.fullFieldExportSession = fullFieldExportPublicSession(session);
    return { ok: true, ...state.fullFieldExportSession };
  }

  function readDebugFullFieldExportChunk(options = {}) {
    const session = debugFullFieldExportSession;
    if (!session || session.status !== 'captured') {
      return {
        ok: false,
        schema: FULL_FIELD_EXPORT_IDENTITY,
        status: 'failed',
        failurePhase: 'chunk-read',
        reason: 'no-active-full-field-export-session',
      };
    }
    const requestedSessionId = String(options.sessionId || '');
    if (requestedSessionId && requestedSessionId !== session.sessionId) {
      return {
        ok: false,
        schema: FULL_FIELD_EXPORT_IDENTITY,
        status: 'failed',
        failurePhase: 'chunk-read',
        reason: 'session-id-mismatch',
        sessionId: session.sessionId,
        requestedSessionId,
      };
    }
    const requestedKind = String(options.kind || 'fluid');
    const kind = requestedKind === 'front'
      ? 'front'
      : requestedKind === 'boundary'
        ? 'boundary'
        : requestedKind === 'boundarySplat'
          ? 'boundarySplat'
          : 'fluid';
    const values = kind === 'front'
      ? session.front
      : kind === 'boundary'
        ? session.boundary
        : kind === 'boundarySplat'
          ? session.boundarySplats
          : session.fluid;
    const startFloat = Math.max(0, Math.min(values.length, Math.floor(Number(options.startFloat) || 0)));
    const requestedFloatCount = Math.floor(Number(options.floatCount) || Math.min(262144, values.length - startFloat));
    const floatCount = Math.max(0, Math.min(values.length - startFloat, requestedFloatCount));
    return {
      ok: true,
      schema: FULL_FIELD_EXPORT_IDENTITY,
      identity: 'full-grid-fluid-front-boundary-sidecars-v0',
      sessionId: session.sessionId,
      kind,
      dtype: 'float32',
      startFloat,
      floatCount,
      byteOffset: startFloat * Float32Array.BYTES_PER_ELEMENT,
      byteLength: floatCount * Float32Array.BYTES_PER_ELEMENT,
      isFinal: startFloat + floatCount >= values.length,
      base64: encodeFloat32ChunkBase64(values, startFloat, floatCount),
    };
  }

  function releaseDebugFullFieldExport(options = {}) {
    const session = debugFullFieldExportSession;
    const requestedSessionId = String(options.sessionId || '');
    if (session && (!requestedSessionId || requestedSessionId === session.sessionId)) {
      session.status = 'released';
      state.fullFieldExportSession = {
        ...fullFieldExportPublicSession(session),
        status: 'released',
      };
      debugFullFieldExportSession = null;
      return {
        ok: true,
        schema: FULL_FIELD_EXPORT_IDENTITY,
        identity: 'full-grid-fluid-front-boundary-sidecars-v0',
        status: 'released',
        sessionId: requestedSessionId || session.sessionId,
      };
    }
    return {
      ok: true,
      schema: FULL_FIELD_EXPORT_IDENTITY,
      identity: 'full-grid-fluid-front-boundary-sidecars-v0',
      status: 'already-released',
      sessionId: requestedSessionId || null,
    };
  }

  async function sampleSimReadback() {
    const readback = device.createBuffer({
      label: 'kaminos fluid simReadback',
      size: fluidBufferBytes(gridSize),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const frontReadback = device.createBuffer({
      label: `kaminos ${FRONT_FIELD_IDENTITY} simReadback`,
      size: frontFieldBufferBytes(gridSize),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos fluid simReadback encoder' });
    encoder.copyBufferToBuffer(fluidBuffers[currentFluid], 0, readback, 0, fluidBufferBytes(gridSize));
    encoder.copyBufferToBuffer(frontBuffers[currentFront], 0, frontReadback, 0, frontFieldBufferBytes(gridSize));
    device.queue.submit([encoder.finish()]);
    await Promise.all([
      readback.mapAsync(GPUMapMode.READ),
      frontReadback.mapAsync(GPUMapMode.READ),
    ]);
    const data = new Float32Array(readback.getMappedRange());
    const frontData = new Float32Array(frontReadback.getMappedRange());
    let densitySum = 0;
    let densityMax = 0;
    let heatSum = 0;
    let fuelSum = 0;
    let reactionSum = 0;
    let fuelConsumptionSum = 0;
    let fireFuelOverlapSum = 0;
    let detailSum = 0;
    let fireLayerSum = 0;
    let emissionDetailSum = 0;
    let combustionFrontSum = 0;
    let radianceSum = 0;
    let extinctionSum = 0;
    let microdetailSum = 0;
    let interfaceShredSum = 0;
    let fireLickSum = 0;
    let velocitySum = 0;
    let curlSum = 0;
    let curlMax = 0;
    let divergenceSum = 0;
    let divergenceMax = 0;
    let liveVoxels = 0;
    let smokeWeightSum = 0;
    let smokeWeightedX = 0;
    let smokeWeightedY = 0;
    let smokeWeightedZ = 0;
    let smokeWeightedX2 = 0;
    let smokeWeightedZ2 = 0;
    let smokeWeightedVelocityY = 0;
    let smokeWeightedVelocityX = 0;
    let smokeWeightedVelocityZ = 0;
    let smokeWeightedLateralSpeed = 0;
    let smokeWeightedLateralEnergy = 0;
    let smokeWeightedRadialVelocityAbs = 0;
    let smokeWeightedRadialVelocity = 0;
    let smokeWeightedCurl = 0;
    let smokeWeightedCurlContact = 0;
    let smokeDetailWeightSum = 0;
    let smokeDetailWeightedX = 0;
    let smokeDetailWeightedZ = 0;
    let smokeDetailWeightedX2 = 0;
    let smokeDetailWeightedZ2 = 0;
    let fireWeightSum = 0;
    let fireWeightedX = 0;
    let fireWeightedY = 0;
    let fireWeightedZ = 0;
    let fireWeightedVelocityY = 0;
    let fireFlameWeightSum = 0;
    let fireEmberWeightSum = 0;
    let fireFlameDetailWeightSum = 0;
    let fireLickWeightSum = 0;
    let fireHeatWeightSum = 0;
    let emissionDetailWeightSum = 0;
    let emissionDetailWeightedX = 0;
    let emissionDetailWeightedZ = 0;
    let emissionDetailWeightedX2 = 0;
    let emissionDetailWeightedZ2 = 0;
    let emissionDetailWeightedCurlContact = 0;
    let combustionFrontWeightSum = 0;
    let frontTopologySum = 0;
    let frontTopologyWeightSum = 0;
    let frontTopologyRadianceCouplingSum = 0;
    let frontTopologyFlameDetailCouplingSum = 0;
    let frontTopologyFireLickCouplingSum = 0;
    const plumeHeightBinCount = 8;
    const plumeHeightBins = Array.from({ length: plumeHeightBinCount }, (_, bin) => ({
      bin,
      yMin: bin / plumeHeightBinCount * 2 - 1,
      yMax: (bin + 1) / plumeHeightBinCount * 2 - 1,
      smokeWeight: 0,
      smokeWeightedX: 0,
      smokeWeightedZ: 0,
      smokeWeightedX2: 0,
      smokeWeightedZ2: 0,
      smokeWeightedVelocityY: 0,
      smokeWeightedLateralSpeed: 0,
      smokeWeightedRadialVelocityAbs: 0,
      smokeWeightedCurl: 0,
      fireWeight: 0,
      fireWeightedX: 0,
      fireWeightedZ: 0,
      fireWeightedVelocityY: 0,
      fireInteriorWeight: 0,
      fireRingWeight: 0,
      fireFlameWeight: 0,
      fireEmberWeight: 0,
      fireFlameDetailWeight: 0,
      fireLickWeight: 0,
      fireHeatWeight: 0,
      emissionDetailWeight: 0,
      emissionDetailWeightedX: 0,
      emissionDetailWeightedZ: 0,
      emissionDetailWeightedX2: 0,
      emissionDetailWeightedZ2: 0,
      smokeDetailWeight: 0,
      smokeDetailWeightedX: 0,
      smokeDetailWeightedZ: 0,
      smokeDetailWeightedX2: 0,
      smokeDetailWeightedZ2: 0,
      combustionFrontWeight: 0,
      frontTopologyWeight: 0,
    }));
    const sampleCells = new Set();
    const addSampleCell = (x, y, z) => {
      const cx = Math.max(0, Math.min(gridSize - 1, x | 0));
      const cy = Math.max(0, Math.min(gridSize - 1, y | 0));
      const cz = Math.max(0, Math.min(gridSize - 1, z | 0));
      const cellIndex = cx + cy * gridSize + cz * gridSize * gridSize;
      sampleCells.add(cellIndex);
      return cellIndex;
    };
    const sampleGridCount = Math.min(17, gridSize);
    const sampleGridStep = (gridSize - 1) / Math.max(1, sampleGridCount - 1);
    const sampleGridAxis = axis => Math.round(axis * sampleGridStep);
    for (let zAxis = 0; zAxis < sampleGridCount; zAxis += 1) {
      for (let yAxis = 0; yAxis < sampleGridCount; yAxis += 1) {
        for (let xAxis = 0; xAxis < sampleGridCount; xAxis += 1) {
          addSampleCell(sampleGridAxis(xAxis), sampleGridAxis(yAxis), sampleGridAxis(zAxis));
        }
      }
    }
    const plumeDriftCells = new Set();
    const addPlumeDriftCell = (x, y, z) => {
      plumeDriftCells.add(addSampleCell(x, y, z));
    };
    const center = Math.floor(gridSize * 0.5);
    const normalizedReadbackScene = normalizeVolumeScene(controlsSnapshot.volumeScene);
    const isCanonicalReadbackScene = normalizedReadbackScene === 'canonical_plume';
    const isBonfireReadbackScene = normalizedReadbackScene === 'bonfire_plume';
    const canonicalReadbackSourceYNorm = clampFinite(controlsSnapshot.canonicalSourceY, -0.92, -0.20, -0.74);
    const sourceY01 = isBonfireReadbackScene
      ? 0.81
      : isCanonicalReadbackScene
        ? (canonicalReadbackSourceYNorm + 1) * 0.5
        : 0.13;
    const sourceY = Math.floor(gridSize * sourceY01);
    const sourceRadius = Math.max(2, Math.ceil(gridSize * Math.max(0.08, controlsSnapshot.inputRadius || 0.08) * 0.75));
    const localStep = Math.max(1, Math.floor(sourceRadius / 3));
    const plumeStartY = isBonfireReadbackScene ? 0 : sourceY - sourceRadius;
    const plumeTopY = isBonfireReadbackScene ? sourceY + sourceRadius : sourceY + sourceRadius * 6;
    for (let y = plumeStartY; y <= plumeTopY; y += localStep) {
      for (let z = center - sourceRadius; z <= center + sourceRadius; z += localStep) {
        for (let x = center - sourceRadius; x <= center + sourceRadius; x += localStep) {
          addPlumeDriftCell(x, y, z);
        }
      }
    }
    const clampIndex = value => Math.max(0, Math.min(gridSize - 1, value));
    const velocityAt = (x, y, z) => {
      const cx = clampIndex(x);
      const cy = clampIndex(y);
      const cz = clampIndex(z);
      const i = (cx + cy * gridSize + cz * gridSize * gridSize) * FLUID_COMPONENTS;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const smokeDensityAt = (x, y, z) => {
      const cx = clampIndex(x);
      const cy = clampIndex(y);
      const cz = clampIndex(z);
      const i = (cx + cy * gridSize + cz * gridSize * gridSize) * FLUID_COMPONENTS;
      return Math.max(0, data[i + 4]);
    };
    const buildCanonicalSmokeFieldSlice = () => {
      const panelWidth = 256;
      const height = 256;
      const width = panelWidth * 2;
      const rgba = new Uint8Array(width * height * 4);
      const zStep = Math.max(1, Math.floor(gridSize / 96));
      const xzY = clampIndex(sourceY + sourceRadius * 3);
      let xyMax = 0;
      let xzMax = 0;
      let xyActivePixels = 0;
      let xzActivePixels = 0;
      const fieldValueToColor = value => {
        const normalized = Math.max(0, Math.min(1, value * 7.5));
        const shaped = Math.sqrt(normalized);
        return [
          Math.round(18 + shaped * 64),
          Math.round(24 + shaped * 118),
          Math.round(28 + shaped * 134),
          255,
        ];
      };
      const setPixel = (x, y, value) => {
        const dst = (y * width + x) * 4;
        const color = fieldValueToColor(value);
        rgba[dst] = color[0];
        rgba[dst + 1] = color[1];
        rgba[dst + 2] = color[2];
        rgba[dst + 3] = color[3];
      };
      for (let py = 0; py < height; py += 1) {
        const gy = clampIndex(Math.round((1 - py / Math.max(1, height - 1)) * (gridSize - 1)));
        for (let px = 0; px < panelWidth; px += 1) {
          const gx = clampIndex(Math.round(px / Math.max(1, panelWidth - 1) * (gridSize - 1)));
          let maxSmoke = 0;
          for (let gz = 0; gz < gridSize; gz += zStep) {
            maxSmoke = Math.max(maxSmoke, smokeDensityAt(gx, gy, gz));
          }
          xyMax = Math.max(xyMax, maxSmoke);
          if (maxSmoke > 0.015) xyActivePixels += 1;
          setPixel(px, py, maxSmoke);
        }
      }
      for (let py = 0; py < height; py += 1) {
        const gz = clampIndex(Math.round((1 - py / Math.max(1, height - 1)) * (gridSize - 1)));
        for (let px = 0; px < panelWidth; px += 1) {
          const gx = clampIndex(Math.round(px / Math.max(1, panelWidth - 1) * (gridSize - 1)));
          const smoke = smokeDensityAt(gx, xzY, gz);
          xzMax = Math.max(xzMax, smoke);
          if (smoke > 0.015) xzActivePixels += 1;
          setPixel(panelWidth + px, py, smoke);
        }
      }
      const sourceLineY = Math.max(0, Math.min(height - 1, Math.round((1 - sourceY / Math.max(1, gridSize - 1)) * (height - 1))));
      const xzCenter = Math.max(0, Math.min(height - 1, Math.round((1 - center / Math.max(1, gridSize - 1)) * (height - 1))));
      for (let px = 0; px < panelWidth; px += 1) {
        const sourceDst = (sourceLineY * width + px) * 4;
        rgba[sourceDst] = Math.max(rgba[sourceDst], 120);
        rgba[sourceDst + 1] = Math.max(rgba[sourceDst + 1], 92);
        rgba[sourceDst + 2] = Math.max(rgba[sourceDst + 2], 42);
        const centerDst = (xzCenter * width + panelWidth + px) * 4;
        rgba[centerDst] = Math.max(rgba[centerDst], 78);
        rgba[centerDst + 1] = Math.max(rgba[centerDst + 1], 92);
        rgba[centerDst + 2] = Math.max(rgba[centerDst + 2], 130);
      }
      for (let py = 0; py < height; py += 1) {
        const seamDst = (py * width + panelWidth) * 4;
        rgba[seamDst] = 96;
        rgba[seamDst + 1] = 100;
        rgba[seamDst + 2] = 104;
        rgba[seamDst + 3] = 255;
      }
      return {
        identity: 'canonical-smoke-field-slice-v0',
        backend: 'cpu-fluid-buffer-readback',
        mode: 'smoke-density-max-z-projection',
        panels: ['xy-smoke-density-max-z-projection', 'xz-smoke-density-at-rising-body-y'],
        coordinateSpace: 'simulation-grid',
        width,
        height,
        panelWidth,
        sourceY,
        xzY,
        xyMax,
        xzMax,
        xyActivePixelRatio: xyActivePixels / (panelWidth * height),
        xzActivePixelRatio: xzActivePixels / (panelWidth * height),
        rgba: Array.from(rgba),
      };
    };
    const buildReactionFrontAtlas = () => {
      const cellCount = gridSize * gridSize * gridSize;
      const heatSupport = new Float32Array(cellCount);
      const fuelSupport = new Float32Array(cellCount);
      const flameSupport = new Float32Array(cellCount);
      const combustionFrontSupport = new Float32Array(cellCount);
      const reactionPotential = new Float32Array(cellCount);
      const gradientMagnitude = new Float32Array(cellCount);
      const narrowFrontCandidate = new Float32Array(cellCount);
      const coreReject = new Float32Array(cellCount);
      const topologyWrinkle = new Float32Array(cellCount);
      const shellCandidate = new Float32Array(cellCount);
      const reactionFrontAtlasControls = normalizeReactionFrontAtlasControls(controlsSnapshot);
      const colorMaps = {
        heatSupport: [255, 122, 34],
        fuelSupport: [84, 190, 108],
        flameSupport: [255, 184, 70],
        combustionFrontSupport: [255, 225, 96],
        reactionPotential: [255, 151, 58],
        gradientMagnitude: [78, 204, 220],
        narrowFrontCandidate: [246, 112, 188],
        coreReject: [104, 139, 230],
        topologyWrinkle: [178, 134, 245],
        shellCandidate: [255, 224, 158],
      };
      const indexAt = (x, y, z) => clampIndex(x) + clampIndex(y) * gridSize + clampIndex(z) * gridSize * gridSize;
      const flowTopologyAt = (x, y, z) => {
        const vx0 = velocityAt(x - 1, y, z);
        const vx1 = velocityAt(x + 1, y, z);
        const vy0 = velocityAt(x, y - 1, z);
        const vy1 = velocityAt(x, y + 1, z);
        const vz0 = velocityAt(x, y, z - 1);
        const vz1 = velocityAt(x, y, z + 1);
        const curlX = ((vy1[2] - vy0[2]) - (vz1[1] - vz0[1])) * 0.5;
        const curlY = ((vz1[0] - vz0[0]) - (vx1[2] - vx0[2])) * 0.5;
        const curlZ = ((vx1[1] - vx0[1]) - (vy1[0] - vy0[0])) * 0.5;
        const div = Math.abs(((vx1[0] - vx0[0]) + (vy1[1] - vy0[1]) + (vz1[2] - vz0[2])) * 0.5);
        return { curlX, curlY, curlZ, curlMag: Math.hypot(curlX, curlY, curlZ), div };
      };
      for (let cell = 0; cell < cellCount; cell += 1) {
        const i = cell * FLUID_COMPONENTS;
        const heat = Math.max(0, data[i + 5]);
        const fuel = Math.max(0, data[i + 6]);
        const flame = Math.max(0, data[i + 8]);
        const ember = Math.max(0, data[i + 9]);
        const visibleFireCarrier = Math.max(0, data[i + 10]);
        const combustionFront = Math.max(0, data[i + 11]);
        const interfaceShred = Math.max(0, data[i + 13]);
        const fireLick = Math.max(0, data[i + 14]);
        const frontTopology = Math.max(0, frontData[cell]);
        const heatSupportValue = smoothstep01(reactionFrontAtlasControls.heatMin, reactionFrontAtlasControls.heatMax, heat + flame * 0.20 + visibleFireCarrier * 0.12 + ember * 0.08);
        const fuelSupportValue = smoothstep01(reactionFrontAtlasControls.fuelMin, reactionFrontAtlasControls.fuelMax, fuel);
        const flameSupportValue = smoothstep01(reactionFrontAtlasControls.flameMin, reactionFrontAtlasControls.flameMax, flame + visibleFireCarrier * 0.72 + fireLick * 0.36 + ember * 0.20);
        const combustionFrontSupportValue = smoothstep01(reactionFrontAtlasControls.frontMin, reactionFrontAtlasControls.frontMax, combustionFront * 0.72 + frontTopology * 1.18);
        const reactionPotentialValue = heatSupportValue * Math.max(flameSupportValue, combustionFrontSupportValue) * (0.18 + fuelSupportValue * 0.82);
        const coreBody = smoothstep01(reactionFrontAtlasControls.coreMin, reactionFrontAtlasControls.coreMax, heat * 0.66 + visibleFireCarrier * 0.56 + flame * 0.44 + ember * 0.22);
        const coreRejectValue = 1 - coreBody * reactionFrontAtlasControls.coreReject;
        const topologyWrinkleValue = Math.max(0, Math.min(1, interfaceShred * 0.64 + fireLick * 0.58 + frontTopology * 0.86 + combustionFront * 0.22));
        heatSupport[cell] = heatSupportValue;
        fuelSupport[cell] = fuelSupportValue;
        flameSupport[cell] = flameSupportValue;
        combustionFrontSupport[cell] = combustionFrontSupportValue;
        reactionPotential[cell] = reactionPotentialValue;
        coreReject[cell] = coreRejectValue;
        topologyWrinkle[cell] = topologyWrinkleValue;
      }
      for (let z = 0; z < gridSize; z += 1) {
        for (let y = 0; y < gridSize; y += 1) {
          for (let x = 0; x < gridSize; x += 1) {
            const cell = indexAt(x, y, z);
            const flowTopology = flowTopologyAt(x, y, z);
            const curlWarpScale = reactionFrontAtlasControls.curlWarp * 24;
            const warpX = Math.max(-2, Math.min(2, Math.round(flowTopology.curlX * curlWarpScale)));
            const warpY = Math.max(-2, Math.min(2, Math.round(flowTopology.curlY * curlWarpScale)));
            const warpZ = Math.max(-2, Math.min(2, Math.round(flowTopology.curlZ * curlWarpScale)));
            const wx = x + warpX;
            const wy = y + warpY;
            const wz = z + warpZ;
            const dx = (reactionPotential[indexAt(wx + 1, wy, wz)] - reactionPotential[indexAt(wx - 1, wy, wz)]) * 0.5;
            const dy = (reactionPotential[indexAt(wx, wy + 1, wz)] - reactionPotential[indexAt(wx, wy - 1, wz)]) * 0.5;
            const dz = (reactionPotential[indexAt(wx, wy, wz + 1)] - reactionPotential[indexAt(wx, wy, wz - 1)]) * 0.5;
            const gradientMagnitudeValue = Math.max(0, Math.min(1, Math.hypot(dx, dy, dz) * 7.5));
            const gradientGate = smoothstep01(reactionFrontAtlasControls.gradientMin, reactionFrontAtlasControls.gradientMax, gradientMagnitudeValue);
            const stretchActivity = smoothstep01(0.006, 0.08, flowTopology.curlMag + flowTopology.div * 0.65);
            const stretchGate = 1 - reactionFrontAtlasControls.stretchErode * stretchActivity;
            const divergenceActivity = smoothstep01(reactionFrontAtlasControls.divergenceMin, reactionFrontAtlasControls.divergenceMax, flowTopology.div);
            const divergenceGate = 1 - reactionFrontAtlasControls.divergenceGain + divergenceActivity * reactionFrontAtlasControls.divergenceGain;
            const narrowFrontCandidateValue = reactionPotential[cell] * gradientGate * coreReject[cell] * stretchGate * divergenceGate;
            const shellRaw = Math.max(0, Math.min(1, narrowFrontCandidateValue * (0.68 + topologyWrinkle[cell] * reactionFrontAtlasControls.topologyGain) * reactionFrontAtlasControls.shellContrast));
            gradientMagnitude[cell] = gradientMagnitudeValue;
            narrowFrontCandidate[cell] = narrowFrontCandidateValue;
            shellCandidate[cell] = Math.pow(shellRaw, reactionFrontAtlasControls.shellGamma);
          }
        }
      }
      const stages = [
        { key: 'heatSupport', label: 'Heat support', atlasLabel: 'HEAT', values: heatSupport },
        { key: 'fuelSupport', label: 'Fuel support', atlasLabel: 'FUEL', values: fuelSupport },
        { key: 'flameSupport', label: 'Flame carrier', atlasLabel: 'FLAME', values: flameSupport },
        { key: 'combustionFrontSupport', label: 'Combustion front', atlasLabel: 'FRONT', values: combustionFrontSupport },
        { key: 'reactionPotential', label: 'Reaction potential', atlasLabel: 'POT', values: reactionPotential },
        { key: 'gradientMagnitude', label: 'Potential gradient', atlasLabel: 'GRAD', values: gradientMagnitude },
        { key: 'narrowFrontCandidate', label: 'Narrow front candidate', atlasLabel: 'NARROW', values: narrowFrontCandidate },
        { key: 'coreReject', label: 'Core/body reject', atlasLabel: 'CORE', values: coreReject },
        { key: 'topologyWrinkle', label: 'Topology wrinkle', atlasLabel: 'WRINKLE', values: topologyWrinkle },
        { key: 'shellCandidate', label: 'Shell candidate', atlasLabel: 'SHELL', values: shellCandidate },
      ];
      const panelSize = 128;
      const columns = 5;
      const rows = 2;
      const width = panelSize * columns;
      const height = panelSize * rows;
      const rgba = new Uint8Array(width * height * 4);
      const atlasFont = {
        A: ['111', '101', '111', '101', '101'],
        C: ['111', '100', '100', '100', '111'],
        D: ['110', '101', '101', '101', '110'],
        E: ['111', '100', '110', '100', '111'],
        F: ['111', '100', '110', '100', '100'],
        G: ['111', '100', '101', '101', '111'],
        H: ['101', '101', '111', '101', '101'],
        I: ['111', '010', '010', '010', '111'],
        K: ['101', '101', '110', '101', '101'],
        L: ['100', '100', '100', '100', '111'],
        M: ['101', '111', '111', '101', '101'],
        N: ['101', '111', '111', '111', '101'],
        O: ['111', '101', '101', '101', '111'],
        P: ['111', '101', '111', '100', '100'],
        R: ['111', '101', '111', '110', '101'],
        S: ['111', '100', '111', '001', '111'],
        T: ['111', '010', '010', '010', '010'],
        U: ['101', '101', '101', '101', '111'],
        W: ['101', '101', '111', '111', '101'],
      };
      const stageStats = {};
      const stageValueAt = (stage, x, y, z) => stage.values[indexAt(x, y, z)];
      const setAtlasPixel = (x, y, r, g, b) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const dst = (y * width + x) * 4;
        rgba[dst] = r;
        rgba[dst + 1] = g;
        rgba[dst + 2] = b;
        rgba[dst + 3] = 255;
      };
      const drawAtlasLabel = (panelX, panelY, text) => {
        const scale = 2;
        const bandHeight = 15;
        for (let y = 1; y < bandHeight; y += 1) {
          for (let x = 1; x < panelSize - 1; x += 1) {
            setAtlasPixel(panelX + x, panelY + y, 4, 5, 6);
          }
        }
        let cursorX = panelX + 5;
        const cursorY = panelY + 4;
        for (const char of text) {
          if (char === ' ') {
            cursorX += 4 * scale;
            continue;
          }
          const glyph = atlasFont[char];
          if (!glyph) continue;
          for (let gy = 0; gy < glyph.length; gy += 1) {
            for (let gx = 0; gx < glyph[gy].length; gx += 1) {
              if (glyph[gy][gx] !== '1') continue;
              for (let sy = 0; sy < scale; sy += 1) {
                for (let sx = 0; sx < scale; sx += 1) {
                  setAtlasPixel(cursorX + gx * scale + sx, cursorY + gy * scale + sy, 236, 240, 232);
                }
              }
            }
          }
          cursorX += 4 * scale;
        }
      };
      for (const stage of stages) {
        let sum = 0;
        let max = 0;
        let active = 0;
        for (let i = 0; i < stage.values.length; i += 1) {
          const value = stage.values[i];
          sum += value;
          max = Math.max(max, value);
          if (value > 0.08) active += 1;
        }
        stageStats[stage.key] = {
          mean: sum / Math.max(1, stage.values.length),
          max,
          activeVoxelRatio: active / Math.max(1, stage.values.length),
        };
      }
      for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
        const stage = stages[stageIndex];
        const panelX = (stageIndex % columns) * panelSize;
        const panelY = Math.floor(stageIndex / columns) * panelSize;
        const color = colorMaps[stage.key] || [255, 255, 255];
        for (let py = 0; py < panelSize; py += 1) {
          const gy = clampIndex(Math.round((1 - py / Math.max(1, panelSize - 1)) * (gridSize - 1)));
          for (let px = 0; px < panelSize; px += 1) {
            const gx = clampIndex(Math.round(px / Math.max(1, panelSize - 1) * (gridSize - 1)));
            let projected = 0;
            for (let gz = 0; gz < gridSize; gz += 1) {
              projected = Math.max(projected, stageValueAt(stage, gx, gy, gz));
            }
            const shaped = Math.sqrt(Math.max(0, Math.min(1, projected)));
            const dst = ((panelY + py) * width + panelX + px) * 4;
            rgba[dst] = Math.round(10 + color[0] * shaped);
            rgba[dst + 1] = Math.round(12 + color[1] * shaped);
            rgba[dst + 2] = Math.round(14 + color[2] * shaped);
            rgba[dst + 3] = 255;
          }
        }
        for (let borderX = 0; borderX < panelSize; borderX += 1) {
          const dst = (panelY * width + panelX + borderX) * 4;
          rgba[dst] = 54;
          rgba[dst + 1] = 54;
          rgba[dst + 2] = 54;
        }
        for (let borderY = 0; borderY < panelSize; borderY += 1) {
          const dst = ((panelY + borderY) * width + panelX) * 4;
          rgba[dst] = 54;
          rgba[dst + 1] = 54;
          rgba[dst + 2] = 54;
        }
        drawAtlasLabel(panelX, panelY, stage.atlasLabel);
      }
      return {
        schema: REACTION_FRONT_ATLAS_SCHEMA,
        identity: 'reaction-front-atlas-max-z-projection-v0',
        stageIdentity: REACTION_FRONT_STAGE_IDENTITY,
        frontFieldIdentity: state.frontFieldIdentity,
        backend: 'cpu-fluid-buffer-readback',
        mode: 'reaction-front-stage-max-z-projection',
        coordinateSpace: 'simulation-grid',
        width,
        height,
        panelSize,
        labelOverlay: true,
        columns,
        rows,
        controls: reactionFrontAtlasControls,
        panels: stages.map(stage => ({ key: stage.key, label: stage.label, atlasLabel: stage.atlasLabel })),
        stageStats,
        sourceY,
        rgba: Array.from(rgba),
      };
    };
    let samples = 0;
    for (const cell of sampleCells) {
      const i = cell * FLUID_COMPONENTS;
      const x = cell % gridSize;
      const y = Math.floor(cell / gridSize) % gridSize;
      const z = Math.floor(cell / (gridSize * gridSize));
      const vx = data[i];
      const vy = data[i + 1];
      const vz = data[i + 2];
      const d = Math.max(data[i + 3], data[i + 4] * 0.9, data[i + 5] * 0.72);
      const smokeDensity = data[i + 4];
      const heat = data[i + 5];
      const fuel = Math.max(0, data[i + 6]);
      const detail = data[i + 7];
      const flame = data[i + 8];
      const ember = data[i + 9];
      const visibleFireCarrier = data[i + 10];
      const flameDetail = visibleFireCarrier;
      const combustionFront = data[i + 11];
      const combustionFrontTopology = frontData[cell];
      const fireLayer = Math.max(flame, ember, flameDetail, combustionFront);
      const microdetail = data[i + 12];
      const interfaceShred = data[i + 13];
      const fireLick = data[i + 14];
      const emberFleck = data[i + 15];
      const radianceGain = controlsSnapshot.radiance ?? 1.65;
      const absorptionGain = controlsSnapshot.absorption ?? 0.85;
      const fireOnlyRadiance = Math.max(0, flame * 1.22 + ember * 0.46 + flameDetail * 0.40 + fireLick * 1.18 + emberFleck * 0.48);
      const bonfireRenderedFireEdgeCarrier = fireLick * 1.18 + emberFleck * 0.50 + combustionFront * 0.14 + combustionFrontTopology * 0.08 + interfaceShred * 0.08;
      const bonfireEmissionRadiance = Math.max(0, bonfireRenderedFireEdgeCarrier + visibleFireCarrier * 1.44 + ember * 0.48 + flame * 0.16 + heat * 0.14);
      const radiance = (isBonfireReadbackScene ? bonfireEmissionRadiance : fireOnlyRadiance) * radianceGain;
      const extinction = Math.max(0, smokeDensity * 0.74 + microdetail * 0.42 + interfaceShred * 0.34 + detail * 0.12) * (0.34 + absorptionGain * 0.46);
      const fuelContact = Math.max(0, Math.min(1, fuel / 0.055));
      const heatContact = Math.max(0, Math.min(1, heat / 0.18));
      const fireContact = Math.max(0, Math.min(1, (fireLayer + fireLick + visibleFireCarrier) / 0.075));
      const reaction = fuelContact * heatContact * Math.max(fireContact, Math.min(1, heat * 0.80));
      const fuelConsumption = reaction * (0.020 + Math.max(0, Math.min(2.5, controlsSnapshot.flowRate ?? 0.3)) * 0.016);
      if (plumeDriftCells.has(cell)) {
        const nx = x / Math.max(1, gridSize - 1) * 2 - 1;
        const ny = y / Math.max(1, gridSize - 1) * 2 - 1;
        const nz = z / Math.max(1, gridSize - 1) * 2 - 1;
        const smokeWeight = Math.max(0, extinction);
        const fireWeight = Math.max(0, radiance);
        const combustionFrontWeight = Math.max(0, combustionFront);
        const frontTopologyWeight = Math.max(0, combustionFrontTopology);
        const fireFlameWeight = Math.max(0, flame * 0.16);
        const fireEmberWeight = Math.max(0, ember * 0.48 + emberFleck * 0.50);
        const fireFlameDetailWeight = Math.max(0, visibleFireCarrier * 1.44);
        const fireLickWeight = Math.max(0, fireLick * 1.18);
        const fireHeatWeight = Math.max(0, heat * 0.14);
        const lateralSpeed = Math.hypot(vx, vz);
        const radialDistance = Math.hypot(nx, nz);
        const sourceRadiusNorm = sourceRadius / Math.max(1, gridSize - 1) * 2;
        const fireInteriorWeight = radialDistance < sourceRadiusNorm * 0.70 ? fireWeight : 0;
        const fireRingWeight = radialDistance > sourceRadiusNorm * 0.86 ? fireWeight : 0;
        const emissionDetailWeight = Math.max(0, visibleFireCarrier);
        const smokeDetailWeight = Math.max(0, microdetail * 0.70 + interfaceShred * 0.55 + detail * 0.32);
        const radialVelocity = radialDistance > 0.0001 ? (nx * vx + nz * vz) / radialDistance : 0;
        smokeWeightSum += smokeWeight;
        smokeWeightedX += smokeWeight * nx;
        smokeWeightedY += smokeWeight * ny;
        smokeWeightedZ += smokeWeight * nz;
        smokeWeightedX2 += smokeWeight * nx * nx;
        smokeWeightedZ2 += smokeWeight * nz * nz;
        smokeWeightedVelocityX += smokeWeight * vx;
        smokeWeightedVelocityY += smokeWeight * vy;
        smokeWeightedVelocityZ += smokeWeight * vz;
        smokeWeightedLateralSpeed += smokeWeight * lateralSpeed;
        smokeWeightedLateralEnergy += smokeWeight * (vx * vx + vz * vz);
        smokeWeightedRadialVelocityAbs += smokeWeight * Math.abs(radialVelocity);
        smokeWeightedRadialVelocity += smokeWeight * radialVelocity;
        smokeDetailWeightSum += smokeDetailWeight;
        smokeDetailWeightedX += smokeDetailWeight * nx;
        smokeDetailWeightedZ += smokeDetailWeight * nz;
        smokeDetailWeightedX2 += smokeDetailWeight * nx * nx;
        smokeDetailWeightedZ2 += smokeDetailWeight * nz * nz;
        fireWeightSum += fireWeight;
        fireFuelOverlapSum += fireWeight * fuelContact;
        fireWeightedX += fireWeight * nx;
        fireWeightedY += fireWeight * ny;
        fireWeightedZ += fireWeight * nz;
        fireWeightedVelocityY += fireWeight * vy;
        fireFlameWeightSum += fireFlameWeight;
        fireEmberWeightSum += fireEmberWeight;
        fireFlameDetailWeightSum += fireFlameDetailWeight;
        fireLickWeightSum += fireLickWeight;
        fireHeatWeightSum += fireHeatWeight;
        emissionDetailWeightSum += emissionDetailWeight;
        emissionDetailWeightedX += emissionDetailWeight * nx;
        emissionDetailWeightedZ += emissionDetailWeight * nz;
        emissionDetailWeightedX2 += emissionDetailWeight * nx * nx;
        emissionDetailWeightedZ2 += emissionDetailWeight * nz * nz;
        combustionFrontWeightSum += combustionFrontWeight;
        const bin = plumeHeightBins[Math.max(0, Math.min(plumeHeightBinCount - 1, Math.floor((ny + 1) * 0.5 * plumeHeightBinCount)))];
        bin.smokeWeight += smokeWeight;
        bin.smokeWeightedX += smokeWeight * nx;
        bin.smokeWeightedZ += smokeWeight * nz;
        bin.smokeWeightedX2 += smokeWeight * nx * nx;
        bin.smokeWeightedZ2 += smokeWeight * nz * nz;
        bin.smokeWeightedVelocityY += smokeWeight * vy;
        bin.smokeWeightedLateralSpeed += smokeWeight * lateralSpeed;
        bin.smokeWeightedRadialVelocityAbs += smokeWeight * Math.abs(radialVelocity);
        bin.fireWeight += fireWeight;
        bin.fireWeightedX += fireWeight * nx;
        bin.fireWeightedZ += fireWeight * nz;
        bin.fireWeightedVelocityY += fireWeight * vy;
        bin.fireInteriorWeight += fireInteriorWeight;
        bin.fireRingWeight += fireRingWeight;
        bin.fireFlameWeight += fireFlameWeight;
        bin.fireEmberWeight += fireEmberWeight;
        bin.fireFlameDetailWeight += fireFlameDetailWeight;
        bin.fireLickWeight += fireLickWeight;
        bin.fireHeatWeight += fireHeatWeight;
        bin.emissionDetailWeight += emissionDetailWeight;
        bin.emissionDetailWeightedX += emissionDetailWeight * nx;
        bin.emissionDetailWeightedZ += emissionDetailWeight * nz;
        bin.emissionDetailWeightedX2 += emissionDetailWeight * nx * nx;
        bin.emissionDetailWeightedZ2 += emissionDetailWeight * nz * nz;
        bin.smokeDetailWeight += smokeDetailWeight;
        bin.smokeDetailWeightedX += smokeDetailWeight * nx;
        bin.smokeDetailWeightedZ += smokeDetailWeight * nz;
        bin.smokeDetailWeightedX2 += smokeDetailWeight * nx * nx;
        bin.smokeDetailWeightedZ2 += smokeDetailWeight * nz * nz;
        bin.combustionFrontWeight += combustionFrontWeight;
        bin.frontTopologyWeight += frontTopologyWeight;
        frontTopologyWeightSum += frontTopologyWeight;
        frontTopologyRadianceCouplingSum += frontTopologyWeight * Math.min(1, fireWeight / Math.max(0.001, fireWeight + 0.05));
        frontTopologyFlameDetailCouplingSum += frontTopologyWeight * Math.min(1, emissionDetailWeight / Math.max(0.001, emissionDetailWeight + 0.05));
        frontTopologyFireLickCouplingSum += frontTopologyWeight * Math.min(1, Math.max(0, fireLick) / Math.max(0.001, Math.max(0, fireLick) + 0.05));
      }
      densitySum += d;
      densityMax = Math.max(densityMax, d);
      heatSum += heat;
      fuelSum += fuel;
      reactionSum += reaction;
      fuelConsumptionSum += fuelConsumption;
      detailSum += detail;
      fireLayerSum += fireLayer;
      emissionDetailSum += flameDetail;
      combustionFrontSum += combustionFront;
      frontTopologySum += combustionFrontTopology;
      radianceSum += radiance;
      extinctionSum += extinction;
      microdetailSum += microdetail;
      interfaceShredSum += interfaceShred;
      fireLickSum += fireLick;
      velocitySum += Math.hypot(vx, vy, vz);
      const vx0 = velocityAt(x - 1, y, z);
      const vx1 = velocityAt(x + 1, y, z);
      const vy0 = velocityAt(x, y - 1, z);
      const vy1 = velocityAt(x, y + 1, z);
      const vz0 = velocityAt(x, y, z - 1);
      const vz1 = velocityAt(x, y, z + 1);
      const curlX = ((vy1[2] - vy0[2]) - (vz1[1] - vz0[1])) * 0.5;
      const curlY = ((vz1[0] - vz0[0]) - (vx1[2] - vx0[2])) * 0.5;
      const curlZ = ((vx1[1] - vx0[1]) - (vy1[0] - vy0[0])) * 0.5;
      const curlMag = Math.hypot(curlX, curlY, curlZ);
      const div = Math.abs(((vx1[0] - vx0[0]) + (vy1[1] - vy0[1]) + (vz1[2] - vz0[2])) * 0.5);
      if (plumeDriftCells.has(cell)) {
        const smokeWeight = Math.max(0, extinction);
        const emissionDetailWeight = Math.max(0, flameDetail);
        const emissionCurlContact = Math.max(0, Math.min(1, (curlMag - 0.0005) / 0.035));
        smokeWeightedCurl += smokeWeight * curlMag;
        smokeWeightedCurlContact += smokeWeight * Math.max(0, Math.min(1, (curlMag - 0.0005) / 0.035));
        emissionDetailWeightedCurlContact += emissionDetailWeight * emissionCurlContact;
        const bin = plumeHeightBins[Math.max(0, Math.min(plumeHeightBinCount - 1, Math.floor(((y / Math.max(1, gridSize - 1) * 2 - 1) + 1) * 0.5 * plumeHeightBinCount)))];
        bin.smokeWeightedCurl += smokeWeight * curlMag;
      }
      curlSum += curlMag;
      curlMax = Math.max(curlMax, curlMag);
      divergenceSum += div;
      divergenceMax = Math.max(divergenceMax, div);
      if (d > 0.02) liveVoxels += 1;
      samples += 1;
    }
    const canonicalSmokeFieldSlice = isCanonicalReadbackScene ? buildCanonicalSmokeFieldSlice() : null;
    const reactionFrontAtlas = buildReactionFrontAtlas();
    readback.unmap();
    readback.destroy();
    frontReadback.unmap();
    frontReadback.destroy();
    const smokeVelocityY = smokeWeightSum > 0 ? smokeWeightedVelocityY / smokeWeightSum : 0;
    const fireVelocityY = fireWeightSum > 0 ? fireWeightedVelocityY / fireWeightSum : 0;
    const visualRiseDirectionY = isBonfireReadbackScene ? -1 : 1;
    const sourceYNorm = sourceY / Math.max(1, gridSize - 1) * 2 - 1;
    const smokeCenterX = smokeWeightSum > 0 ? smokeWeightedX / smokeWeightSum : 0;
    const smokeCenterY = smokeWeightSum > 0 ? smokeWeightedY / smokeWeightSum : 0;
    const smokeCenterZ = smokeWeightSum > 0 ? smokeWeightedZ / smokeWeightSum : 0;
    const plumeNetLateralVelocityX = smokeWeightSum > 0 ? smokeWeightedVelocityX / smokeWeightSum : 0;
    const plumeNetLateralVelocityZ = smokeWeightSum > 0 ? smokeWeightedVelocityZ / smokeWeightSum : 0;
    const plumeNetLateralVelocity = Math.hypot(plumeNetLateralVelocityX, plumeNetLateralVelocityZ);
    const plumeLocalLateralVelocityMean = smokeWeightSum > 0 ? smokeWeightedLateralSpeed / smokeWeightSum : 0;
    const plumeLateralVelocityRms = smokeWeightSum > 0 ? Math.sqrt(Math.max(0, smokeWeightedLateralEnergy / smokeWeightSum)) : 0;
    const plumeLateralVelocityBalance = plumeLocalLateralVelocityMean > 0.000001 ? plumeNetLateralVelocity / plumeLocalLateralVelocityMean : 0;
    const plumeRadialVelocityAbsMean = smokeWeightSum > 0 ? smokeWeightedRadialVelocityAbs / smokeWeightSum : 0;
    const plumeRadialVelocityMean = smokeWeightSum > 0 ? smokeWeightedRadialVelocity / smokeWeightSum : 0;
    const plumeSmokeWeightedCurlMean = smokeWeightSum > 0 ? smokeWeightedCurl / smokeWeightSum : 0;
    const plumeScalarCurlContact = smokeWeightSum > 0 ? smokeWeightedCurlContact / smokeWeightSum : 0;
    const fireCenterX = fireWeightSum > 0 ? fireWeightedX / fireWeightSum : 0;
    const fireCenterY = fireWeightSum > 0 ? fireWeightedY / fireWeightSum : 0;
    const fireCenterZ = fireWeightSum > 0 ? fireWeightedZ / fireWeightSum : 0;
    const smokeVisualRiseDisplacement = (smokeCenterY - sourceYNorm) * visualRiseDirectionY;
    const fireVisualRiseDisplacement = (fireCenterY - sourceYNorm) * visualRiseDirectionY;
    const sourceRelativeVisualHeightBins = plumeHeightBins.map(bin => {
      const visualCenter = (((bin.yMin + bin.yMax) * 0.5) - sourceYNorm) * visualRiseDirectionY;
      const smokeVelocity = bin.smokeWeight > 0 ? bin.smokeWeightedVelocityY / bin.smokeWeight : 0;
      const fireVelocity = bin.fireWeight > 0 ? bin.fireWeightedVelocityY / bin.fireWeight : 0;
      const smokeCenterXBin = bin.smokeWeight > 0 ? bin.smokeWeightedX / bin.smokeWeight : 0;
      const smokeCenterZBin = bin.smokeWeight > 0 ? bin.smokeWeightedZ / bin.smokeWeight : 0;
      const smokeVarianceXBin = bin.smokeWeight > 0 ? Math.max(0, bin.smokeWeightedX2 / bin.smokeWeight - smokeCenterXBin * smokeCenterXBin) : 0;
      const smokeVarianceZBin = bin.smokeWeight > 0 ? Math.max(0, bin.smokeWeightedZ2 / bin.smokeWeight - smokeCenterZBin * smokeCenterZBin) : 0;
      const emissionDetailCenterXBin = bin.emissionDetailWeight > 0 ? bin.emissionDetailWeightedX / bin.emissionDetailWeight : 0;
      const emissionDetailCenterZBin = bin.emissionDetailWeight > 0 ? bin.emissionDetailWeightedZ / bin.emissionDetailWeight : 0;
      const emissionDetailVarianceXBin = bin.emissionDetailWeight > 0 ? Math.max(0, bin.emissionDetailWeightedX2 / bin.emissionDetailWeight - emissionDetailCenterXBin * emissionDetailCenterXBin) : 0;
      const emissionDetailVarianceZBin = bin.emissionDetailWeight > 0 ? Math.max(0, bin.emissionDetailWeightedZ2 / bin.emissionDetailWeight - emissionDetailCenterZBin * emissionDetailCenterZBin) : 0;
      const smokeDetailCenterXBin = bin.smokeDetailWeight > 0 ? bin.smokeDetailWeightedX / bin.smokeDetailWeight : 0;
      const smokeDetailCenterZBin = bin.smokeDetailWeight > 0 ? bin.smokeDetailWeightedZ / bin.smokeDetailWeight : 0;
      const smokeDetailVarianceXBin = bin.smokeDetailWeight > 0 ? Math.max(0, bin.smokeDetailWeightedX2 / bin.smokeDetailWeight - smokeDetailCenterXBin * smokeDetailCenterXBin) : 0;
      const smokeDetailVarianceZBin = bin.smokeDetailWeight > 0 ? Math.max(0, bin.smokeDetailWeightedZ2 / bin.smokeDetailWeight - smokeDetailCenterZBin * smokeDetailCenterZBin) : 0;
      return {
        bin: bin.bin,
        visualCenter,
        smokeWeight: bin.smokeWeight,
        fireWeight: bin.fireWeight,
        fireInteriorWeight: bin.fireInteriorWeight,
        fireRingWeight: bin.fireRingWeight,
        fireFlameWeight: bin.fireFlameWeight,
        fireEmberWeight: bin.fireEmberWeight,
        fireFlameDetailWeight: bin.fireFlameDetailWeight,
        fireLickWeight: bin.fireLickWeight,
        fireHeatWeight: bin.fireHeatWeight,
        emissionDetailWeight: bin.emissionDetailWeight,
        emissionDetailCenterX: emissionDetailCenterXBin,
        emissionDetailCenterZ: emissionDetailCenterZBin,
        emissionDetailRadialBreadth: Math.sqrt(emissionDetailVarianceXBin + emissionDetailVarianceZBin),
        smokeDetailWeight: bin.smokeDetailWeight,
        smokeDetailCenterX: smokeDetailCenterXBin,
        smokeDetailCenterZ: smokeDetailCenterZBin,
        smokeDetailRadialBreadth: Math.sqrt(smokeDetailVarianceXBin + smokeDetailVarianceZBin),
        combustionFrontWeight: bin.combustionFrontWeight,
        frontTopologyWeight: bin.frontTopologyWeight,
        smokeCenterX: smokeCenterXBin,
        smokeCenterZ: smokeCenterZBin,
        smokeRadialBreadth: Math.sqrt(smokeVarianceXBin + smokeVarianceZBin),
        fireCenterX: bin.fireWeight > 0 ? bin.fireWeightedX / bin.fireWeight : 0,
        fireCenterZ: bin.fireWeight > 0 ? bin.fireWeightedZ / bin.fireWeight : 0,
        smokeVisualRiseVelocity: smokeVelocity * visualRiseDirectionY,
        smokeLateralVelocityMean: bin.smokeWeight > 0 ? bin.smokeWeightedLateralSpeed / bin.smokeWeight : 0,
        smokeRadialVelocityAbsMean: bin.smokeWeight > 0 ? bin.smokeWeightedRadialVelocityAbs / bin.smokeWeight : 0,
        smokeWeightedCurlMean: bin.smokeWeight > 0 ? bin.smokeWeightedCurl / bin.smokeWeight : 0,
        fireVisualRiseVelocity: fireVelocity * visualRiseDirectionY,
      };
    });
    const smokeVarianceX = smokeWeightSum > 0 ? Math.max(0, smokeWeightedX2 / smokeWeightSum - smokeCenterX * smokeCenterX) : 0;
    const smokeVarianceZ = smokeWeightSum > 0 ? Math.max(0, smokeWeightedZ2 / smokeWeightSum - smokeCenterZ * smokeCenterZ) : 0;
    const plumeSmokeBodyBreadth = Math.sqrt(smokeVarianceX + smokeVarianceZ);
    const coherentBins = sourceRelativeVisualHeightBins.filter(bin => bin.visualCenter > -0.08 && bin.smokeWeight > 1.0);
    const lowerRollingBodyBins = sourceRelativeVisualHeightBins.filter(bin =>
      bin.visualCenter > -0.06 &&
      bin.visualCenter < 0.55 &&
      bin.smokeWeight > 1.0 &&
      Number.isFinite(bin.smokeRadialBreadth)
    );
    const upperRollingBodyBins = sourceRelativeVisualHeightBins.filter(bin =>
      bin.visualCenter >= 0.45 &&
      bin.visualCenter < 1.55 &&
      bin.smokeWeight > 1.0 &&
      Number.isFinite(bin.smokeRadialBreadth)
    );
    const lowerRollingBodyWeight = lowerRollingBodyBins.reduce((sum, bin) => sum + bin.smokeWeight, 0);
    const upperRollingBodyWeight = upperRollingBodyBins.reduce((sum, bin) => sum + bin.smokeWeight, 0);
    const lowerRollingBodyBreadth = lowerRollingBodyWeight > 0
      ? lowerRollingBodyBins.reduce((sum, bin) => sum + bin.smokeWeight * bin.smokeRadialBreadth, 0) / lowerRollingBodyWeight
      : 0;
    const upperRollingBodyBreadth = upperRollingBodyWeight > 0
      ? upperRollingBodyBins.reduce((sum, bin) => sum + bin.smokeWeight * bin.smokeRadialBreadth, 0) / upperRollingBodyWeight
      : 0;
    const plumeTopPinchRatio = lowerRollingBodyBreadth > 0.000001
      ? upperRollingBodyBreadth / lowerRollingBodyBreadth
      : 1;
    const coherentBinWeight = coherentBins.reduce((sum, bin) => sum + bin.smokeWeight, 0);
    const coherentBinCenterSpread = coherentBinWeight > 0
      ? coherentBins.reduce((sum, bin) => sum + bin.smokeWeight * Math.hypot(bin.smokeCenterX - smokeCenterX, bin.smokeCenterZ - smokeCenterZ), 0) / coherentBinWeight
      : 0;
    const plumeFieldColumnCoherence = smokeWeightSum > 0
      ? Math.max(0, Math.min(1.5,
        (1 - Math.min(1, plumeSmokeBodyBreadth / 0.22)) * 0.62 +
        (1 - Math.min(1, coherentBinCenterSpread / 0.18)) * 0.38
      ))
      : 0;
    const emissionDetailCenterX = emissionDetailWeightSum > 0 ? emissionDetailWeightedX / emissionDetailWeightSum : 0;
    const emissionDetailCenterZ = emissionDetailWeightSum > 0 ? emissionDetailWeightedZ / emissionDetailWeightSum : 0;
    const emissionDetailVarianceX = emissionDetailWeightSum > 0 ? Math.max(0, emissionDetailWeightedX2 / emissionDetailWeightSum - emissionDetailCenterX * emissionDetailCenterX) : 0;
    const emissionDetailVarianceZ = emissionDetailWeightSum > 0 ? Math.max(0, emissionDetailWeightedZ2 / emissionDetailWeightSum - emissionDetailCenterZ * emissionDetailCenterZ) : 0;
    const emissionDetailBodyBreadth = Math.sqrt(emissionDetailVarianceX + emissionDetailVarianceZ);
    const emissionDetailBins = sourceRelativeVisualHeightBins.filter(bin => bin.visualCenter > -0.08 && bin.emissionDetailWeight > 0.01);
    const emissionDetailBinWeight = emissionDetailBins.reduce((sum, bin) => sum + bin.emissionDetailWeight, 0);
    const emissionDetailBinCenterSpread = emissionDetailBinWeight > 0
      ? emissionDetailBins.reduce((sum, bin) => sum + bin.emissionDetailWeight * Math.hypot(bin.emissionDetailCenterX - emissionDetailCenterX, bin.emissionDetailCenterZ - emissionDetailCenterZ), 0) / emissionDetailBinWeight
      : 0;
    const emissionDetailVerticalCoherence = emissionDetailWeightSum > 0
      ? Math.max(0, Math.min(1.5,
        (1 - Math.min(1, emissionDetailBodyBreadth / 0.18)) * 0.55 +
        (1 - Math.min(1, emissionDetailBinCenterSpread / 0.16)) * 0.45
      ))
      : 0;
    const smokeDetailCenterX = smokeDetailWeightSum > 0 ? smokeDetailWeightedX / smokeDetailWeightSum : 0;
    const smokeDetailCenterZ = smokeDetailWeightSum > 0 ? smokeDetailWeightedZ / smokeDetailWeightSum : 0;
    const smokeDetailVarianceX = smokeDetailWeightSum > 0 ? Math.max(0, smokeDetailWeightedX2 / smokeDetailWeightSum - smokeDetailCenterX * smokeDetailCenterX) : 0;
    const smokeDetailVarianceZ = smokeDetailWeightSum > 0 ? Math.max(0, smokeDetailWeightedZ2 / smokeDetailWeightSum - smokeDetailCenterZ * smokeDetailCenterZ) : 0;
    const smokeDetailBodyBreadth = Math.sqrt(smokeDetailVarianceX + smokeDetailVarianceZ);
    const smokeDetailBins = sourceRelativeVisualHeightBins.filter(bin => bin.visualCenter > -0.08 && bin.smokeDetailWeight > 0.01);
    const smokeDetailBinWeight = smokeDetailBins.reduce((sum, bin) => sum + bin.smokeDetailWeight, 0);
    const smokeDetailBinCenterSpread = smokeDetailBinWeight > 0
      ? smokeDetailBins.reduce((sum, bin) => sum + bin.smokeDetailWeight * Math.hypot(bin.smokeDetailCenterX - smokeDetailCenterX, bin.smokeDetailCenterZ - smokeDetailCenterZ), 0) / smokeDetailBinWeight
      : 0;
    const smokeDetailVerticalCoherence = smokeDetailWeightSum > 0
      ? Math.max(0, Math.min(1.5,
        (1 - Math.min(1, smokeDetailBodyBreadth / 0.22)) * 0.52 +
        (1 - Math.min(1, smokeDetailBinCenterSpread / 0.18)) * 0.48
      ))
      : 0;
    const emissionDetailCurlContact = emissionDetailWeightSum > 0 ? emissionDetailWeightedCurlContact / emissionDetailWeightSum : 0;
    const risingSmokeBins = sourceRelativeVisualHeightBins.filter(bin => bin.visualCenter > 0.08 && bin.smokeWeight > 0);
    const risingSmokeWeight = risingSmokeBins.reduce((sum, bin) => sum + bin.smokeWeight, 0);
    const risingSmokeVisualRiseDisplacement = risingSmokeWeight > 0
      ? risingSmokeBins.reduce((sum, bin) => sum + bin.smokeWeight * bin.visualCenter, 0) / risingSmokeWeight
      : 0;
    const activeFireBins = sourceRelativeVisualHeightBins.filter(bin => bin.fireWeight > 0);
    const maxFireBinWeight = activeFireBins.reduce((maxWeight, bin) => Math.max(maxWeight, bin.fireWeight), 0);
    const fireSourcePlugRatio = fireWeightSum > 0 ? maxFireBinWeight / fireWeightSum : 0;
    const sourcePlugRatioFor = (field, total) => {
      if (total <= 0) return 0;
      return sourceRelativeVisualHeightBins.reduce((maxWeight, bin) => Math.max(maxWeight, bin[field]), 0) / total;
    };
    const risingBodyRatioFor = (field, total) => {
      if (total <= 0) return 0;
      return sourceRelativeVisualHeightBins
        .filter(bin => bin.visualCenter > 0.08)
        .reduce((sum, bin) => sum + bin[field], 0) / total;
    };
    const fireFlameSourcePlugRatio = sourcePlugRatioFor('fireFlameWeight', fireFlameWeightSum);
    const fireEmberSourcePlugRatio = sourcePlugRatioFor('fireEmberWeight', fireEmberWeightSum);
    const fireFlameDetailSourcePlugRatio = sourcePlugRatioFor('fireFlameDetailWeight', fireFlameDetailWeightSum);
    const fireVisibleCarrierSourcePlugRatio = fireFlameDetailSourcePlugRatio;
    const fireLickSourcePlugRatio = sourcePlugRatioFor('fireLickWeight', fireLickWeightSum);
    const fireHeatSourcePlugRatio = sourcePlugRatioFor('fireHeatWeight', fireHeatWeightSum);
    const fireFlameRisingBodyRatio = risingBodyRatioFor('fireFlameWeight', fireFlameWeightSum);
    const fireEmberRisingBodyRatio = risingBodyRatioFor('fireEmberWeight', fireEmberWeightSum);
    const fireFlameDetailRisingBodyRatio = risingBodyRatioFor('fireFlameDetailWeight', fireFlameDetailWeightSum);
    const fireVisibleCarrierRisingBodyRatio = fireFlameDetailRisingBodyRatio;
    const fireLickRisingBodyRatio = risingBodyRatioFor('fireLickWeight', fireLickWeightSum);
    const fireHeatRisingBodyRatio = risingBodyRatioFor('fireHeatWeight', fireHeatWeightSum);
    const fireChannelSourcePlugDominant = [
      ['flame', fireFlameSourcePlugRatio, fireFlameWeightSum],
      ['ember', fireEmberSourcePlugRatio, fireEmberWeightSum],
      ['flameDetail', fireFlameDetailSourcePlugRatio, fireFlameDetailWeightSum],
      ['fireLick', fireLickSourcePlugRatio, fireLickWeightSum],
      ['heat', fireHeatSourcePlugRatio, fireHeatWeightSum],
    ]
      .filter(([, , weight]) => weight > 0.001)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';
    const risingFireWeight = sourceRelativeVisualHeightBins
      .filter(bin => bin.visualCenter > 0.08)
      .reduce((sum, bin) => sum + bin.fireWeight, 0);
    const fireRisingBodyRatio = fireWeightSum > 0 ? risingFireWeight / fireWeightSum : 0;
    const liftedFireShellBins = sourceRelativeVisualHeightBins.filter(bin =>
      bin.visualCenter > 0.05 &&
      bin.visualCenter < 0.86 &&
      bin.fireWeight > 0
    );
    const liftedFireWeight = liftedFireShellBins.reduce((sum, bin) => sum + bin.fireWeight, 0);
    const liftedFireInteriorWeight = liftedFireShellBins.reduce((sum, bin) => sum + bin.fireInteriorWeight, 0);
    const liftedFireRingWeight = liftedFireShellBins.reduce((sum, bin) => sum + bin.fireRingWeight, 0);
    const liftedFireShellRatio = liftedFireWeight > 0 ? liftedFireRingWeight / liftedFireWeight : 0;
    const liftedFireInteriorRatio = liftedFireWeight > 0 ? liftedFireInteriorWeight / liftedFireWeight : 0;
    const emissionDetailWeight = sourceRelativeVisualHeightBins.reduce((sum, bin) => sum + bin.emissionDetailWeight, 0);
    const liftedEmissionDetailWeight = sourceRelativeVisualHeightBins
      .filter(bin => bin.visualCenter > 0.05 && bin.visualCenter < 0.86)
      .reduce((sum, bin) => sum + bin.emissionDetailWeight, 0);
    const liftedEmissionDetailRatio = emissionDetailWeight > 0 ? liftedEmissionDetailWeight / emissionDetailWeight : 0;
    const activeCombustionFrontBins = sourceRelativeVisualHeightBins.filter(bin => bin.combustionFrontWeight > 0);
    const maxCombustionFrontBinWeight = activeCombustionFrontBins.reduce((maxWeight, bin) =>
      Math.max(maxWeight, bin.combustionFrontWeight),
      0
    );
    const combustionFrontSourcePlugRatio = combustionFrontWeightSum > 0 ? maxCombustionFrontBinWeight / combustionFrontWeightSum : 0;
    const risingCombustionFrontWeight = sourceRelativeVisualHeightBins
      .filter(bin => bin.visualCenter > 0.08)
      .reduce((sum, bin) => sum + bin.combustionFrontWeight, 0);
    const combustionFrontRisingBodyRatio = combustionFrontWeightSum > 0 ? risingCombustionFrontWeight / combustionFrontWeightSum : 0;
    const activeFrontTopologyBins = sourceRelativeVisualHeightBins.filter(bin => bin.frontTopologyWeight > 0);
    const maxFrontTopologyBinWeight = activeFrontTopologyBins.reduce((maxWeight, bin) =>
      Math.max(maxWeight, bin.frontTopologyWeight),
      0
    );
    const frontTopologySourcePlugRatio = frontTopologyWeightSum > 0 ? maxFrontTopologyBinWeight / frontTopologyWeightSum : 0;
    const risingFrontTopologyWeight = sourceRelativeVisualHeightBins
      .filter(bin => bin.visualCenter > 0.08)
      .reduce((sum, bin) => sum + bin.frontTopologyWeight, 0);
    const frontTopologyRisingBodyRatio = frontTopologyWeightSum > 0 ? risingFrontTopologyWeight / frontTopologyWeightSum : 0;
    const frontTopologyCenterHeight = frontTopologyWeightSum > 0
      ? sourceRelativeVisualHeightBins.reduce((sum, bin) => sum + bin.frontTopologyWeight * bin.visualCenter, 0) / frontTopologyWeightSum
      : 0;
    const frontTopologyHeightSpread = frontTopologyWeightSum > 0
      ? Math.sqrt(sourceRelativeVisualHeightBins.reduce((sum, bin) => sum + bin.frontTopologyWeight * Math.pow(bin.visualCenter - frontTopologyCenterHeight, 2), 0) / frontTopologyWeightSum)
      : 0;
    const frontTopologyRadianceCoupling = frontTopologyWeightSum > 0 ? frontTopologyRadianceCouplingSum / frontTopologyWeightSum : 0;
    const frontTopologyFlameDetailCoupling = frontTopologyWeightSum > 0 ? frontTopologyFlameDetailCouplingSum / frontTopologyWeightSum : 0;
    const frontTopologyFireLickCoupling = frontTopologyWeightSum > 0 ? frontTopologyFireLickCouplingSum / frontTopologyWeightSum : 0;
    const frontTopologyVisibleTransferLoss = Math.max(0, frontTopologyRisingBodyRatio - fireRisingBodyRatio) * (1 - Math.min(1, frontTopologyFlameDetailCoupling));
    return {
      grid: gridSize,
      gridLabel: state.simGridLabel,
      frontFieldIdentity: state.frontFieldIdentity,
      frontFieldBytes: state.frontFieldBytes,
      frontFieldReadIndex: state.frontFieldReadIndex,
      frontFieldWriteIndex: state.frontFieldWriteIndex,
      frontFieldProjectionPassthrough: state.frontFieldProjectionPassthrough,
      samples,
      densityMean: densitySum / samples,
      densityMax,
      heatMean: heatSum / samples,
      fuelMean: fuelSum / samples,
      reactionMean: reactionSum / samples,
      fuelConsumptionMean: fuelConsumptionSum / samples,
      fireFuelOverlapRatio: fireWeightSum > 0 ? fireFuelOverlapSum / fireWeightSum : 0,
      detailMean: detailSum / samples,
      fireLayerMean: fireLayerSum / samples,
      emissionDetailMean: emissionDetailSum / samples,
      combustionFrontMean: combustionFrontSum / samples,
      frontTopologyMean: frontTopologySum / samples,
      radianceMean: radianceSum / samples,
      extinctionMean: extinctionSum / samples,
      microdetailMean: microdetailSum / samples,
      interfaceShredMean: interfaceShredSum / samples,
      fireLickMean: fireLickSum / samples,
      velocityMean: velocitySum / samples,
      curlMean: curlSum / samples,
      curlMax,
      divergenceMean: divergenceSum / samples,
      divergenceMax,
      sourceY: sourceYNorm,
      visualRiseDirectionY,
      smokeWeight: smokeWeightSum,
      smokeCenterX,
      smokeCenterY,
      smokeCenterZ,
      plumeNetLateralVelocityX,
      plumeNetLateralVelocityZ,
      plumeNetLateralVelocity,
      plumeLocalLateralVelocityMean,
      plumeLateralVelocityRms,
      plumeLateralVelocityBalance,
      plumeRadialVelocityAbsMean,
      plumeRadialVelocityMean,
      plumeSmokeWeightedCurlMean,
      plumeScalarCurlContact,
      plumeSmokeBodyBreadth,
      plumeTopPinchRatio,
      plumeLowerRollingBodyBreadth: lowerRollingBodyBreadth,
      plumeUpperRollingBodyBreadth: upperRollingBodyBreadth,
      plumeFieldColumnCoherence,
      plumeFieldBinCenterSpread: coherentBinCenterSpread,
      canonicalSmokeFieldSlice,
      reactionFrontStageIdentity: REACTION_FRONT_STAGE_IDENTITY,
      reactionFrontAtlas,
      emissionDetailCurlContact,
      emissionDetailVerticalCoherence,
      emissionDetailBodyBreadth,
      emissionDetailBinCenterSpread,
      smokeDetailVerticalCoherence,
      smokeDetailBodyBreadth,
      smokeDetailBinCenterSpread,
      smokeVelocityY,
      smokeVisualRiseVelocity: smokeVelocityY * visualRiseDirectionY,
      smokeVisualRiseDisplacement,
      risingSmokeVisualRiseDisplacement,
      risingSmokeWeight,
      smokeRadialDrift: smokeWeightSum > 0 ? Math.hypot(smokeCenterX, smokeCenterZ) : 0,
      fireWeight: fireWeightSum,
      fireCenterX,
      fireCenterY,
      fireCenterZ,
      fireVelocityY,
      fireVisualRiseVelocity: fireVelocityY * visualRiseDirectionY,
      fireVisualRiseDisplacement,
      fireRadialDrift: fireWeightSum > 0 ? Math.hypot(fireCenterX, fireCenterZ) : 0,
      fireSourcePlugRatio,
      fireRisingBodyRatio,
      fireFlameSourcePlugRatio,
      fireEmberSourcePlugRatio,
      fireFlameDetailSourcePlugRatio,
      fireVisibleCarrierSourcePlugRatio,
      fireLickSourcePlugRatio,
      fireHeatSourcePlugRatio,
      fireFlameRisingBodyRatio,
      fireEmberRisingBodyRatio,
      fireFlameDetailRisingBodyRatio,
      fireVisibleCarrierRisingBodyRatio,
      fireLickRisingBodyRatio,
      fireHeatRisingBodyRatio,
      fireChannelSourcePlugDominant,
      liftedFireShellRatio,
      liftedFireInteriorRatio,
      liftedFireInteriorWeight,
      liftedFireRingWeight,
      liftedEmissionDetailRatio,
      liftedEmissionDetailWeight,
      emissionDetailWeight,
      maxFireBinWeight,
      combustionFrontWeight: combustionFrontWeightSum,
      combustionFrontSourcePlugRatio,
      combustionFrontRisingBodyRatio,
      maxCombustionFrontBinWeight,
      frontTopologyWeight: frontTopologyWeightSum,
      frontTopologySourcePlugRatio,
      frontTopologyRisingBodyRatio,
      frontTopologyHeightSpread,
      frontTopologyRadianceCoupling,
      frontTopologyFlameDetailCoupling,
      frontTopologyFireLickCoupling,
      frontTopologyVisibleTransferLoss,
      maxFrontTopologyBinWeight,
      plumeHeightBins: plumeHeightBins.map(bin => ({
        bin: bin.bin,
        yMin: bin.yMin,
        yMax: bin.yMax,
        smokeWeight: bin.smokeWeight,
        smokeCenterX: bin.smokeWeight > 0 ? bin.smokeWeightedX / bin.smokeWeight : 0,
        smokeCenterZ: bin.smokeWeight > 0 ? bin.smokeWeightedZ / bin.smokeWeight : 0,
        smokeRadialBreadth: bin.smokeWeight > 0
          ? Math.sqrt(
            Math.max(0, bin.smokeWeightedX2 / bin.smokeWeight - Math.pow(bin.smokeWeightedX / bin.smokeWeight, 2)) +
            Math.max(0, bin.smokeWeightedZ2 / bin.smokeWeight - Math.pow(bin.smokeWeightedZ / bin.smokeWeight, 2))
          )
          : 0,
        smokeVelocityY: bin.smokeWeight > 0 ? bin.smokeWeightedVelocityY / bin.smokeWeight : 0,
        smokeLateralVelocityMean: bin.smokeWeight > 0 ? bin.smokeWeightedLateralSpeed / bin.smokeWeight : 0,
        smokeRadialVelocityAbsMean: bin.smokeWeight > 0 ? bin.smokeWeightedRadialVelocityAbs / bin.smokeWeight : 0,
        smokeWeightedCurlMean: bin.smokeWeight > 0 ? bin.smokeWeightedCurl / bin.smokeWeight : 0,
        fireWeight: bin.fireWeight,
        fireInteriorWeight: bin.fireInteriorWeight,
        fireRingWeight: bin.fireRingWeight,
        emissionDetailWeight: bin.emissionDetailWeight,
        emissionDetailCenterX: bin.emissionDetailWeight > 0 ? bin.emissionDetailWeightedX / bin.emissionDetailWeight : 0,
        emissionDetailCenterZ: bin.emissionDetailWeight > 0 ? bin.emissionDetailWeightedZ / bin.emissionDetailWeight : 0,
        emissionDetailRadialBreadth: bin.emissionDetailWeight > 0
          ? Math.sqrt(
            Math.max(0, bin.emissionDetailWeightedX2 / bin.emissionDetailWeight - Math.pow(bin.emissionDetailWeightedX / bin.emissionDetailWeight, 2)) +
            Math.max(0, bin.emissionDetailWeightedZ2 / bin.emissionDetailWeight - Math.pow(bin.emissionDetailWeightedZ / bin.emissionDetailWeight, 2))
          )
          : 0,
        smokeDetailWeight: bin.smokeDetailWeight,
        smokeDetailCenterX: bin.smokeDetailWeight > 0 ? bin.smokeDetailWeightedX / bin.smokeDetailWeight : 0,
        smokeDetailCenterZ: bin.smokeDetailWeight > 0 ? bin.smokeDetailWeightedZ / bin.smokeDetailWeight : 0,
        smokeDetailRadialBreadth: bin.smokeDetailWeight > 0
          ? Math.sqrt(
            Math.max(0, bin.smokeDetailWeightedX2 / bin.smokeDetailWeight - Math.pow(bin.smokeDetailWeightedX / bin.smokeDetailWeight, 2)) +
            Math.max(0, bin.smokeDetailWeightedZ2 / bin.smokeDetailWeight - Math.pow(bin.smokeDetailWeightedZ / bin.smokeDetailWeight, 2))
          )
          : 0,
        fireCenterX: bin.fireWeight > 0 ? bin.fireWeightedX / bin.fireWeight : 0,
        fireCenterZ: bin.fireWeight > 0 ? bin.fireWeightedZ / bin.fireWeight : 0,
        fireVelocityY: bin.fireWeight > 0 ? bin.fireWeightedVelocityY / bin.fireWeight : 0,
        combustionFrontWeight: bin.combustionFrontWeight,
        frontTopologyWeight: bin.frontTopologyWeight,
      })),
      sourceRelativeVisualHeightBins,
      liveVoxels,
    };
  }

  async function sampleMajorantReadback() {
    const readback = device.createBuffer({
      label: 'kaminos coarse majorant readback',
      size: majorantBufferBytes(majorantGridSize),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos coarse majorant readback encoder' });
    encoder.copyBufferToBuffer(majorantBuffer, 0, readback, 0, majorantBufferBytes(majorantGridSize));
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readback.getMappedRange());
    let densitySum = 0;
    let radianceSum = 0;
    let extinctionSum = 0;
    let importanceSum = 0;
    let densityMax = 0;
    let radianceMax = 0;
    let extinctionMax = 0;
    let importanceMax = 0;
    let occupiedBricks = 0;
    const bricks = majorantGridSize * majorantGridSize * majorantGridSize;
    for (let i = 0; i < bricks; i += 1) {
      const offset = i * 4;
      const density = data[offset];
      const radiance = data[offset + 1];
      const extinction = data[offset + 2];
      const importance = data[offset + 3];
      densitySum += density;
      radianceSum += radiance;
      extinctionSum += extinction;
      importanceSum += importance;
      densityMax = Math.max(densityMax, density);
      radianceMax = Math.max(radianceMax, radiance);
      extinctionMax = Math.max(extinctionMax, extinction);
      importanceMax = Math.max(importanceMax, importance);
      if (importance > 0.015 || density > 0.01 || radiance > 0.01 || extinction > 0.01) occupiedBricks += 1;
    }
    readback.unmap();
    readback.destroy();
    const result = {
      grid: majorantGridSize,
      bricks,
      occupiedBricks,
      densityMean: densitySum / bricks,
      densityMax,
      radianceMean: radianceSum / bricks,
      radianceMax,
      extinctionMean: extinctionSum / bricks,
      extinctionMax,
      importanceMean: importanceSum / bricks,
      importanceMax,
    };
    state.majorantOccupiedBricks = occupiedBricks;
    state.majorantImportanceMax = importanceMax;
    return result;
  }

  async function readTextureRgba8(texture, width, height, label = 'kaminos rgba8 texture readback') {
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const buffer = device.createBuffer({
      label,
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: `${label} encoder` });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange());
    const rgba = new Uint8Array(width * height * bytesPerPixel);
    for (let y = 0; y < height; y += 1) {
      const src = y * bytesPerRow;
      const dst = y * width * bytesPerPixel;
      rgba.set(data.slice(src, src + width * bytesPerPixel), dst);
    }
    buffer.unmap();
    buffer.destroy();
    return {
      width,
      height,
      rgba: Array.from(rgba),
      bytesPerRow,
      unpaddedBytesPerRow,
    };
  }

  async function sampleFrame(options = {}) {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    const advanceSim = options.advanceSim !== false;
    const sampleNow = Number.isFinite(Number(options.now)) ? Number(options.now) : performance.now();
    const includeRgba = options.includeRgba === true;
    const sameStateCaptureId = options.sameStateCaptureId ? String(options.sameStateCaptureId) : null;
    const baseFrameCount = Number.isFinite(Number(options.baseFrameCount)) ? Number(options.baseFrameCount) : state.frameCount;
    const baseSimStepCount = Number.isFinite(Number(options.baseSimStepCount)) ? Number(options.baseSimStepCount) : state.simStepCount;
    updateUniforms(sampleNow);
    ensureFrameTexture();
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = state.width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const buffer = device.createBuffer({
      label: 'kaminos volume witness readback',
      size: bytesPerRow * state.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder({ label: 'kaminos volume witness readback encoder' });
    const sampleLookFreeze = normalizeLookFreeze(controlsSnapshot.lookFreeze) && lookFreezeCanPin(state) ? 1 : 0;
    let sampleSelectiveHeadLiveFields = null;
    if (advanceSim && !sampleLookFreeze) {
      encodeSim(encoder);
      encodeSelectiveHeadLiveFields(encoder);
      sampleSelectiveHeadLiveFields = {
        majorant: selectiveHeadLiveRoleGroups('majorant'),
        sidecar: selectiveHeadLiveRoleGroups('sidecar'),
        splat: selectiveHeadLiveRoleGroups('splat'),
        render: selectiveHeadLiveRoleGroups('render'),
      };
      encodeMajorant(encoder, { readBindGroup: sampleSelectiveHeadLiveFields.majorant, force: true });
    } else if (!sampleLookFreeze) {
      encodeSelectiveHeadLiveFields(encoder);
      sampleSelectiveHeadLiveFields = {
        majorant: selectiveHeadLiveRoleGroups('majorant'),
        sidecar: selectiveHeadLiveRoleGroups('sidecar'),
        splat: selectiveHeadLiveRoleGroups('splat'),
        render: selectiveHeadLiveRoleGroups('render'),
      };
      encodeMajorant(encoder, { readBindGroup: sampleSelectiveHeadLiveFields.majorant, force: true });
    } else {
      state.majorantBuiltThisFrame = false;
    }
    encodeBoundarySidecar(encoder, { readBindGroup: sampleSelectiveHeadLiveFields?.sidecar || null });
    encodeBoundarySplats(encoder, { computeBindGroup: sampleSelectiveHeadLiveFields?.splat || null });
    if (boundarySplatRequested()) {
      const composition = updateSelectiveHeadLiveCompositionState();
      let raymarchEncoded = false;
      let raymarchApplied = false;
      let splatEncoded = false;
      let splatApplied = false;
      if (composition.definition.raymarch) {
        encodeDraw(
          encoder,
          frameTexture.createView(),
          `kaminos selective-head controlled readback ${composition.effective} raymarch`,
          readbackPipeline,
          { bindGroup: sampleSelectiveHeadLiveFields?.render || null },
        );
        raymarchEncoded = true;
        raymarchApplied = true;
      }
      if (composition.definition.splat) {
        splatEncoded = encodeBoundarySplatDraw(
          encoder,
          frameTexture.createView(),
          boundarySplatReadbackPipeline,
          { loadOp: raymarchApplied ? 'load' : 'clear' },
        );
        splatApplied = splatEncoded;
      }
      if (composition.definition.splat && !splatApplied) {
        buffer.destroy();
        const validationError = await device.popErrorScope();
        return {
          ok: false,
          reason: 'boundary-splat-readback-route-unavailable',
          validationError: validationError?.message || null,
          selectiveHeadLiveCompositionRequestedRaw: state.selectiveHeadLiveCompositionRequestedRaw,
          selectiveHeadLiveCompositionRequested: state.selectiveHeadLiveCompositionRequested,
          selectiveHeadLiveCompositionEffective: 'unavailable',
          selectiveHeadLiveCompositionFallbackReason: state.boundarySplatFallbackReason || 'boundary-splat-readback-route-unavailable',
          selectiveHeadLivePassReceipt: makeSelectiveHeadLivePassReceipt({
            composition: composition.requested,
            raymarchEncoded,
            raymarchApplied,
            splatEncoded,
            splatApplied: false,
            fallbackReason: state.boundarySplatFallbackReason || 'boundary-splat-readback-route-unavailable',
          }),
          boundarySplatFallbackReason: state.boundarySplatFallbackReason,
          boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
          boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
          boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
          boundarySplatTimestampStatus: state.boundarySplatTimestampStatus,
          boundarySplatGpuProfile: state.boundarySplatGpuProfile,
          boundarySplatCopyBytesThisFrame: state.boundarySplatCopyBytesThisFrame,
          boundarySplatCopyDisposition: state.boundarySplatCopyDisposition,
        };
      }
      recordSelectiveHeadLivePassReceipt({
        composition: composition.effective === 'off' ? composition.requested : composition.effective,
        raymarchEncoded,
        raymarchApplied,
        splatEncoded,
        splatApplied,
        fallbackReason: state.selectiveHeadLiveCompositionFallbackReason,
      });
      encodeBoundarySplatTelemetry(encoder, true);
    } else {
      encodeDraw(encoder, frameTexture.createView(), 'kaminos volume one-off readback pass', readbackPipeline);
    }
    encoder.copyTextureToBuffer(
      { texture: frameTexture },
      { buffer, bytesPerRow, rowsPerImage: state.height },
      { width: state.width, height: state.height, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);
    if (boundarySplatTelemetryCopyPending) await resolveBoundarySplatTelemetry();
    const validationError = await device.popErrorScope();
    if (validationError) {
      buffer.destroy();
      return {
        ok: false,
        reason: 'readback-validation',
        validationError: validationError.message || String(validationError),
        width: state.width,
        height: state.height,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        simGrid: state.simGrid,
        simGridLabel: state.simGridLabel,
        frontFieldIdentity: state.frontFieldIdentity,
        frontFieldBytes: state.frontFieldBytes,
        frontFieldReadIndex: state.frontFieldReadIndex,
        frontFieldWriteIndex: state.frontFieldWriteIndex,
        frontFieldProjectionPassthrough: state.frontFieldProjectionPassthrough,
        volumeScene: state.volumeScene,
        gridOverlay: state.gridOverlay,
        adaptiveRaymarch: state.adaptiveRaymarch,
        occupancySkip: state.occupancySkip,
        majorantSkip: state.majorantSkip,
        majorantSmooth: state.majorantSmooth,
        majorantGuard: state.majorantGuard,
        temporalAccum: state.temporalAccum,
        temporalJitter: state.temporalJitter,
        historyClamp: state.historyClamp,
        fireScale: state.fireScale,
        detailScale: state.detailScale,
        detailScaleArtifactQuarantine: state.detailScaleArtifactQuarantine,
        tallPlumeDetailFrequencySource: state.tallPlumeDetailFrequencySource,
        visibleDetailOverlayGain: state.visibleDetailOverlayGain,
        reactionFuelScale: state.reactionFuelScale,
        lifecycleEffect: state.lifecycleEffect,
        lifecycleT: state.lifecycleT,
        quenchVapor: state.quenchVapor,
        quenchVaporStrength: state.quenchVaporStrength,
        snuffVisualModel: state.snuffVisualModel,
        flameQuenchModel: state.flameQuenchModel,
        pyroDynamicDetail: clonePyroDynamicDetail(),
        pyroMaterialRendererCoupling: state.pyroMaterialRendererCoupling ? { ...state.pyroMaterialRendererCoupling } : null,
        runtimeQualityRequested: state.runtimeQualityRequested,
        runtimeQualityEffective: state.runtimeQualityEffective,
        gpuPressure: state.gpuPressure,
        runtimeQualityReason: state.runtimeQualityReason,
        runtimeQualityReceipt: state.runtimeQualityReceipt ? { ...state.runtimeQualityReceipt } : null,
        tallPlumeReactionCadenceDebug: state.tallPlumeReactionCadenceDebug,
        tallPlumeFlameCutoffContract: state.tallPlumeFlameCutoffContract,
        tallPlumeFlowShelfContract: state.tallPlumeFlowShelfContract,
        tallPlumeFlameHeightLawContract: state.tallPlumeFlameHeightLawContract,
        plumeHeight: state.plumeHeight,
        bonfireAblation: { ...state.bonfireAblation },
        externalEmitterMode: state.externalEmitterMode,
        externalEmitterCoordinateSpace: state.externalEmitterCoordinateSpace,
        externalEmitterCount: state.externalEmitterCount,
        externalEmitterAgeMs: state.externalEmitterAgeMs,
        externalEmitterFrameId: state.externalEmitterFrameId,
        volumePrimitiveCount: state.volumePrimitiveCount,
        volumePrimitiveIds: state.volumePrimitiveIds,
        volumePrimitives: state.volumePrimitives,
        temporalAccumEffective: state.temporalAccumEffective,
        temporalReprojectionConfidence: state.temporalReprojectionConfidence,
        temporalHistoryWeight: state.temporalHistoryWeight,
        temporalRejectedHistory: state.temporalRejectedHistory,
        temporalSmokeHistoryTrust: state.temporalSmokeHistoryTrust,
        temporalFireHistoryProtect: state.temporalFireHistoryProtect,
        temporalInterfaceHistoryProtect: state.temporalInterfaceHistoryProtect,
        temporalEvidenceSource: state.temporalEvidenceSource,
        temporalHistoryFrames: state.temporalHistoryFrames,
        temporalHistoryResetCount: state.temporalHistoryResetCount,
        temporalHistoryResetReason: state.temporalHistoryResetReason,
        temporalHistoryValid: state.temporalHistoryValid,
        pressureProjectionEnabled: state.pressureProjectionEnabled,
        pressureEffectiveLabel: state.pressureEffectiveLabel,
        pressureProjectionIterations: state.pressureProjectionIterations,
        pressureIterationDefault: state.pressureIterationDefault,
        pressureIterationRequested: state.pressureIterationRequested,
        pressureSourceStrategy: state.pressureSourceStrategy,
        pressureStrategy: state.pressureStrategy,
        tallPlumePressureIterationStrategy: state.tallPlumePressureIterationStrategy,
        tallPlumePressureIterationTarget: state.tallPlumePressureIterationTarget,
        tallPlumePressureTierStrategy: state.tallPlumePressureTierStrategy,
        pressureProjectionReadStrategy: state.pressureProjectionReadStrategy,
        pressureJacobiFullGridPasses: state.pressureJacobiFullGridPasses,
        pressureJacobiPartialSlabPasses: state.pressureJacobiPartialSlabPasses,
        pressureJacobiFullGridEquivalentPasses: state.pressureJacobiFullGridEquivalentPasses,
        pressureTierRequestedBounds: state.pressureTierRequestedBounds ? { ...state.pressureTierRequestedBounds } : null,
        pressureTierEffectiveBounds: state.pressureTierEffectiveBounds ? { ...state.pressureTierEffectiveBounds } : null,
        pressureTierOverlayOpacity: state.pressureTierOverlayOpacity,
        pressureTierDispatches: state.pressureTierDispatches ? state.pressureTierDispatches.map(dispatch => ({ ...dispatch })) : [],
        pressureTierBounds: state.pressureTierBounds ? { ...state.pressureTierBounds } : null,
        pressureTierBufferOwnership: state.pressureTierBufferOwnership ? { ...state.pressureTierBufferOwnership } : null,
        mainFluidKernelStrategy: state.mainFluidKernelStrategy,
        mainFluidLocalProjectionStrategy: state.mainFluidLocalProjectionStrategy,
        mainFluidLocalProjectionDivergenceEvaluationsPerCell: state.mainFluidLocalProjectionDivergenceEvaluationsPerCell,
        mainFluidBonfireCombustionFieldStrategy: state.mainFluidBonfireCombustionFieldStrategy,
        bonfireCombustionFieldEvaluationsPerCell: state.bonfireCombustionFieldEvaluationsPerCell,
        mainFluidBonfireProceduralBreakupStrategy: state.mainFluidBonfireProceduralBreakupStrategy,
        bonfireProceduralBreakupEvaluationsPerCell: state.bonfireProceduralBreakupEvaluationsPerCell,
        mainFluidBonfireSymmetricForceStrategy: state.mainFluidBonfireSymmetricForceStrategy,
        bonfireSymmetricForceEvaluationsPerCell: state.bonfireSymmetricForceEvaluationsPerCell,
        mainFluidBonfireNonWindForceStrategy: state.mainFluidBonfireNonWindForceStrategy,
        bonfireNonWindForceEvaluationsPerCell: state.bonfireNonWindForceEvaluationsPerCell,
        mainFluidBonfireScalarNeighborhoodStrategy: state.mainFluidBonfireScalarNeighborhoodStrategy,
        bonfireScalarNeighborhoodReadsPerCell: state.bonfireScalarNeighborhoodReadsPerCell,
        tallPlumeDetailCoherenceStrategy: state.tallPlumeDetailCoherenceStrategy,
        tallPlumeDetailCoherenceExtraReadsPerCell: state.tallPlumeDetailCoherenceExtraReadsPerCell,
        tallPlumeTransitionBandStrategy: state.tallPlumeTransitionBandStrategy,
        tallPlumeTransitionBandExtraReadsPerCell: state.tallPlumeTransitionBandExtraReadsPerCell,
        fireLickBreakupEnabled: state.fireLickBreakupEnabled,
        fireLickBreakupEvaluationsPerCell: state.fireLickBreakupEvaluationsPerCell,
        fireLickOperatorGain: state.fireLickOperatorGain,
        pressureDivergencePasses: state.pressureDivergencePasses,
        pressureJacobiInlineDivergencePasses: state.pressureJacobiInlineDivergencePasses,
        fullGridPassBreakdown: state.fullGridPassBreakdown ? { ...state.fullGridPassBreakdown } : null,
        majorantGrid: state.majorantGrid,
        majorantBuilt: state.majorantBuilt,
        majorantCadence: state.majorantCadence,
        majorantBuiltThisFrame: state.majorantBuiltThisFrame,
        majorantLastBuiltFrame: state.majorantLastBuiltFrame,
        majorantSkippedFrameCount: state.majorantSkippedFrameCount,
        simProfile: state.simProfile,
        simCostLedger: state.simCostLedger ? { ...state.simCostLedger } : null,
        timing: { ...state.timing },
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: state.prototypeIdentity,
        backend: state.backend,
        boundarySidecarIdentity: state.boundarySidecarIdentity,
        boundarySidecarAuthority: state.boundarySidecarAuthority,
        boundarySidecarSource: state.boundarySidecarSource,
        boundarySplatMode: state.boundarySplatMode,
        boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
        boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
        boundarySplatFeatureCaptureRequested: state.boundarySplatFeatureCaptureRequested,
        boundarySplatFeatureCaptureEffective: state.boundarySplatFeatureCaptureEffective,
        boundarySplatFeatureCapture: state.boundarySplatFeatureCapture,
        boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
        boundarySplatCapacity: state.boundarySplatCapacity,
        boundarySplatInstanceCount: state.boundarySplatInstanceCount,
        boundarySplatCandidateCount: state.boundarySplatCandidateCount,
        boundarySplatOverflowCount: state.boundarySplatOverflowCount,
        boundarySplatCountAuthority: state.boundarySplatCountAuthority,
        boundarySplatFallbackReason: state.boundarySplatFallbackReason,
        boundarySplatFrameCount: state.boundarySplatFrameCount,
        boundarySplatTimestampStatus: state.boundarySplatTimestampStatus,
        boundarySplatGpuProfile: state.boundarySplatGpuProfile,
        boundarySplatCopyBytesThisFrame: state.boundarySplatCopyBytesThisFrame,
        boundarySplatCopyDisposition: state.boundarySplatCopyDisposition,
      };
    }
    const boundarySplatSample = boundarySplatRequested() ? await sampleBoundarySplatDrawState() : null;
    const boundarySplatFeatureCapture = state.boundarySplatFeatureCaptureRequested && boundarySplatSample
      ? await sampleBoundarySplatFeatureCapture(boundarySplatSample.instanceCount)
      : null;
    state.boundarySplatFeatureCapture = boundarySplatFeatureCapture;
    const boundarySplatGpuProfile = boundarySplatRequested() ? await sampleBoundarySplatGpuProfile() : state.boundarySplatGpuProfile;
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange());
    let litPixels = 0;
    let fireLikePixels = 0;
    let emissiveLikePixels = 0;
    let smokeLikePixels = 0;
    let totalLuma = 0;
    let fireLumaSum = 0;
    let fireLumaSqSum = 0;
    let fireEdgeSum = 0;
    let fireEdgeSamples = 0;
    let smokeHorizontalGradient = 0;
    let smokeVerticalGradient = 0;
    let smokeStripeSamples = 0;
    let samples = 0;
    const volumeBounds = {
      minX: state.width,
      minY: state.height,
      maxX: -1,
      maxY: -1,
      pixelCount: 0,
      width: 0,
      height: 0,
      horizontalFillRatio: 0,
      verticalFillRatio: 0,
      sumX: 0,
      sumY: 0,
      centerX: 0,
      centerY: 0,
      normalizedCenterX: 0,
      normalizedCenterY: 0,
      screenDriftX: 0,
      screenDriftY: 0,
    };
    const fireBounds = { ...volumeBounds };
    const smokeBounds = { ...volumeBounds };
    const includeBoundPixel = (bounds, x, y) => {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
      bounds.pixelCount += 1;
      bounds.sumX += x;
      bounds.sumY += y;
    };
    const finalizeBounds = bounds => {
      if (bounds.pixelCount > 0) {
        bounds.width = bounds.maxX - bounds.minX + 1;
        bounds.height = bounds.maxY - bounds.minY + 1;
        bounds.horizontalFillRatio = bounds.width / Math.max(1, state.width);
        bounds.verticalFillRatio = bounds.height / Math.max(1, state.height);
        bounds.centerX = bounds.sumX / bounds.pixelCount;
        bounds.centerY = bounds.sumY / bounds.pixelCount;
        bounds.normalizedCenterX = (bounds.centerX / Math.max(1, state.width - 1)) * 2 - 1;
        bounds.normalizedCenterY = (bounds.centerY / Math.max(1, state.height - 1)) * 2 - 1;
        bounds.screenDriftX = bounds.normalizedCenterX;
        bounds.screenDriftY = bounds.normalizedCenterY;
      } else {
        bounds.minX = 0;
        bounds.minY = 0;
        bounds.maxX = 0;
        bounds.maxY = 0;
        bounds.sumX = 0;
        bounds.sumY = 0;
        bounds.centerX = 0;
        bounds.centerY = 0;
        bounds.normalizedCenterX = 0;
        bounds.normalizedCenterY = 0;
        bounds.screenDriftX = 0;
        bounds.screenDriftY = 0;
      }
    };
    const lumaAt = (x, y) => {
      const i = y * bytesPerRow + x * bytesPerPixel;
      return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    };
    const isSmokeLikeAt = (x, y) => {
      const i = y * bytesPerRow + x * bytesPerPixel;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      return b > 28 && g > 28 && r < 105 && Math.abs(g - b) < 60;
    };
    const previewWidth = 256;
    const previewHeight = Math.max(1, Math.round(previewWidth * state.height / state.width));
    const preview = new Uint8Array(previewWidth * previewHeight * 4);
    const rgba = includeRgba ? new Uint8Array(state.width * state.height * 4) : null;
    if (rgba) {
      for (let y = 0; y < state.height; y += 1) {
        const src = y * bytesPerRow;
        const dst = y * state.width * bytesPerPixel;
        rgba.set(data.slice(src, src + state.width * bytesPerPixel), dst);
      }
    }
    for (let y = Math.floor(state.height * 0.08); y < Math.floor(state.height * 0.92); y += 2) {
      const row = y * bytesPerRow;
      for (let x = Math.floor(state.width * 0.08); x < Math.floor(state.width * 0.92); x += 2) {
        const i = row + x * bytesPerPixel;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const isFireLike = r > 120 && g > 70 && b < 90;
        const isEmissiveLike = r > 170 && g > 120 && b < 115 && luma > 130;
        totalLuma += luma;
        samples += 1;
        if (luma > 20) {
          litPixels += 1;
          includeBoundPixel(volumeBounds, x, y);
        }
        if (isFireLike) {
          fireLikePixels += 1;
          includeBoundPixel(fireBounds, x, y);
        }
        if (isEmissiveLike) {
          emissiveLikePixels += 1;
          includeBoundPixel(fireBounds, x, y);
        }
        if (isFireLike || isEmissiveLike) {
          const leftX = Math.max(Math.floor(state.width * 0.08), x - 2);
          const upY = Math.max(Math.floor(state.height * 0.08), y - 2);
          const leftI = row + leftX * bytesPerPixel;
          const upI = upY * bytesPerRow + x * bytesPerPixel;
          const leftLuma = 0.2126 * data[leftI] + 0.7152 * data[leftI + 1] + 0.0722 * data[leftI + 2];
          const upLuma = 0.2126 * data[upI] + 0.7152 * data[upI + 1] + 0.0722 * data[upI + 2];
          fireLumaSum += luma;
          fireLumaSqSum += luma * luma;
          fireEdgeSum += Math.abs(luma - leftLuma) + Math.abs(luma - upLuma);
          fireEdgeSamples += 1;
        }
        if (b > 28 && g > 28 && r < 105 && Math.abs(g - b) < 60) {
          smokeLikePixels += 1;
          includeBoundPixel(volumeBounds, x, y);
          includeBoundPixel(smokeBounds, x, y);
          const leftX = x - 2;
          const upY = y - 2;
          if (
            leftX >= Math.floor(state.width * 0.08) &&
            upY >= Math.floor(state.height * 0.08) &&
            isSmokeLikeAt(leftX, y) &&
            isSmokeLikeAt(x, upY)
          ) {
            smokeHorizontalGradient += Math.abs(luma - lumaAt(leftX, y));
            smokeVerticalGradient += Math.abs(luma - lumaAt(x, upY));
            smokeStripeSamples += 1;
          }
        }
      }
    }
    finalizeBounds(volumeBounds);
    finalizeBounds(fireBounds);
    finalizeBounds(smokeBounds);
    for (let py = 0; py < previewHeight; py += 1) {
      const srcY = Math.min(state.height - 1, Math.floor(py / previewHeight * state.height));
      const row = srcY * bytesPerRow;
      for (let px = 0; px < previewWidth; px += 1) {
        const srcX = Math.min(state.width - 1, Math.floor(px / previewWidth * state.width));
        const src = row + srcX * bytesPerPixel;
        const dst = (py * previewWidth + px) * 4;
        preview[dst] = data[src];
        preview[dst + 1] = data[src + 1];
        preview[dst + 2] = data[src + 2];
        preview[dst + 3] = 255;
      }
    }
    buffer.unmap();
    buffer.destroy();
    const simReadback = await sampleSimReadback();
    updatePyroDynamicDetailState({ simReadback, inputKind: 'sim-readback' });
    const majorantReadback = await sampleMajorantReadback();
    const fireLumaMean = fireLumaSum / Math.max(1, fireEdgeSamples);
    const fireRoughnessMean = Math.sqrt(Math.max(0, fireLumaSqSum / Math.max(1, fireEdgeSamples) - fireLumaMean * fireLumaMean)) / 255;
    const fireEdgeEnergy = fireEdgeSum / Math.max(1, fireEdgeSamples * 255);
    const smokeHorizontalEnergy = smokeHorizontalGradient / Math.max(1, smokeStripeSamples * 255);
    const smokeVerticalEnergy = smokeVerticalGradient / Math.max(1, smokeStripeSamples * 255);
    const smokeVerticalStripeRatio = smokeHorizontalEnergy / Math.max(0.0035, smokeVerticalEnergy);
    return {
      ok: true,
      width: state.width,
      height: state.height,
      cssWidth: state.cssWidth,
      cssHeight: state.cssHeight,
      displayWidth: state.displayWidth,
      displayHeight: state.displayHeight,
      nativeDevicePixelRatio: state.nativeDevicePixelRatio,
      canvasDevicePixelRatio: state.canvasDevicePixelRatio,
      renderWidth: state.renderWidth,
      renderHeight: state.renderHeight,
      renderScale: state.renderScale,
      renderPixelRatio: state.renderPixelRatio,
      volumeReconstructionStyle: state.volumeReconstructionStyle,
      volumeScene: state.volumeScene,
      meanLuma: totalLuma / Math.max(1, samples),
      litPixels,
      fireLikePixels,
      emissiveLikePixels,
      smokeLikePixels,
      fireRoughnessMean,
      fireEdgeEnergy,
      smokeHorizontalEnergy,
      smokeVerticalEnergy,
      smokeVerticalStripeRatio,
      volumeBounds,
      fireBounds,
      smokeBounds,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      renderPhaseTimeMs: state.renderPhaseTimeMs,
      renderPhaseFrame: state.renderPhaseFrame,
      renderPhaseAuthority: state.renderPhaseAuthority,
      lookFreezeRenderTimeMs: state.lookFreezeRenderTimeMs,
      lookFreezeRenderFrame: state.lookFreezeRenderFrame,
      simGrid: state.simGrid,
      simGridLabel: state.simGridLabel,
      frontFieldIdentity: state.frontFieldIdentity,
      frontFieldBytes: state.frontFieldBytes,
      frontFieldReadIndex: state.frontFieldReadIndex,
      frontFieldWriteIndex: state.frontFieldWriteIndex,
      frontFieldProjectionPassthrough: state.frontFieldProjectionPassthrough,
      gridOverlay: state.gridOverlay,
      adaptiveRaymarch: state.adaptiveRaymarch,
      occupancySkip: state.occupancySkip,
      majorantSkip: state.majorantSkip,
      majorantSmooth: state.majorantSmooth,
      majorantGuard: state.majorantGuard,
      temporalAccum: state.temporalAccum,
      temporalJitter: state.temporalJitter,
      historyClamp: state.historyClamp,
      fireScale: state.fireScale,
      detailScale: state.detailScale,
      detailScaleArtifactQuarantine: state.detailScaleArtifactQuarantine,
      tallPlumeDetailFrequencySource: state.tallPlumeDetailFrequencySource,
      visibleDetailOverlayGain: state.visibleDetailOverlayGain,
      reactionFuelScale: state.reactionFuelScale,
      lifecycleEffect: state.lifecycleEffect,
      lifecycleT: state.lifecycleT,
      quenchVapor: state.quenchVapor,
      quenchVaporStrength: state.quenchVaporStrength,
      snuffVisualModel: state.snuffVisualModel,
      flameQuenchModel: state.flameQuenchModel,
      pyroDynamicDetail: clonePyroDynamicDetail(),
      pyroMaterialRendererCoupling: state.pyroMaterialRendererCoupling ? { ...state.pyroMaterialRendererCoupling } : null,
      runtimeQualityRequested: state.runtimeQualityRequested,
      runtimeQualityEffective: state.runtimeQualityEffective,
      gpuPressure: state.gpuPressure,
      runtimeQualityReason: state.runtimeQualityReason,
      runtimeQualityReceipt: state.runtimeQualityReceipt ? { ...state.runtimeQualityReceipt } : null,
      tallPlumeReactionCadenceDebug: state.tallPlumeReactionCadenceDebug,
      tallPlumeFlameCutoffContract: state.tallPlumeFlameCutoffContract,
      tallPlumeFlowShelfContract: state.tallPlumeFlowShelfContract,
      tallPlumeFlameHeightLawContract: state.tallPlumeFlameHeightLawContract,
      plumeHeight: state.plumeHeight,
      windStrength: state.windStrength,
      windAngle: state.windAngle,
      windHeight: state.windHeight,
      bonfireAblation: { ...state.bonfireAblation },
      bonfireReferenceConfinement: { ...state.bonfireReferenceConfinement },
      minimalPlumeProof: { ...state.minimalPlumeProof },
      renderScale: state.renderScale,
      renderPixelRatio: state.renderPixelRatio,
      displayWidth: state.displayWidth,
      displayHeight: state.displayHeight,
      renderWidth: state.renderWidth,
      renderHeight: state.renderHeight,
      volumeReconstructionStyle: state.volumeReconstructionStyle,
      volumeScene: state.volumeScene,
      externalEmitterMode: state.externalEmitterMode,
      externalEmitterCoordinateSpace: state.externalEmitterCoordinateSpace,
      externalEmitterCount: state.externalEmitterCount,
      externalEmitterAgeMs: state.externalEmitterAgeMs,
      externalEmitterFrameId: state.externalEmitterFrameId,
      volumePrimitiveCount: state.volumePrimitiveCount,
      volumePrimitiveIds: state.volumePrimitiveIds,
      volumePrimitives: state.volumePrimitives,
      temporalAccumEffective: state.temporalAccumEffective,
      temporalReprojectionConfidence: state.temporalReprojectionConfidence,
      temporalHistoryWeight: state.temporalHistoryWeight,
      temporalRejectedHistory: state.temporalRejectedHistory,
      temporalSmokeHistoryTrust: state.temporalSmokeHistoryTrust,
      temporalFireHistoryProtect: state.temporalFireHistoryProtect,
      temporalInterfaceHistoryProtect: state.temporalInterfaceHistoryProtect,
      temporalEvidenceSource: state.temporalEvidenceSource,
      temporalHistoryFrames: state.temporalHistoryFrames,
      temporalHistoryResetCount: state.temporalHistoryResetCount,
      temporalHistoryResetReason: state.temporalHistoryResetReason,
      temporalHistoryValid: state.temporalHistoryValid,
      pressureProjectionEnabled: state.pressureProjectionEnabled,
      pressureEffectiveLabel: state.pressureEffectiveLabel,
      pressureProjectionIterations: state.pressureProjectionIterations,
      pressureIterationDefault: state.pressureIterationDefault,
      pressureIterationRequested: state.pressureIterationRequested,
      pressureSourceStrategy: state.pressureSourceStrategy,
      pressureStrategy: state.pressureStrategy,
      tallPlumePressureIterationStrategy: state.tallPlumePressureIterationStrategy,
      tallPlumePressureIterationTarget: state.tallPlumePressureIterationTarget,
      tallPlumePressureTierStrategy: state.tallPlumePressureTierStrategy,
      pressureProjectionReadStrategy: state.pressureProjectionReadStrategy,
      pressureJacobiFullGridPasses: state.pressureJacobiFullGridPasses,
      pressureJacobiPartialSlabPasses: state.pressureJacobiPartialSlabPasses,
      pressureJacobiFullGridEquivalentPasses: state.pressureJacobiFullGridEquivalentPasses,
      pressureTierRequestedBounds: state.pressureTierRequestedBounds ? { ...state.pressureTierRequestedBounds } : null,
      pressureTierEffectiveBounds: state.pressureTierEffectiveBounds ? { ...state.pressureTierEffectiveBounds } : null,
      pressureTierOverlayOpacity: state.pressureTierOverlayOpacity,
      pressureTierDispatches: state.pressureTierDispatches ? state.pressureTierDispatches.map(dispatch => ({ ...dispatch })) : [],
      pressureTierBounds: state.pressureTierBounds ? { ...state.pressureTierBounds } : null,
      pressureTierBufferOwnership: state.pressureTierBufferOwnership ? { ...state.pressureTierBufferOwnership } : null,
      mainFluidKernelStrategy: state.mainFluidKernelStrategy,
      mainFluidLocalProjectionStrategy: state.mainFluidLocalProjectionStrategy,
      mainFluidLocalProjectionDivergenceEvaluationsPerCell: state.mainFluidLocalProjectionDivergenceEvaluationsPerCell,
      mainFluidBonfireCombustionFieldStrategy: state.mainFluidBonfireCombustionFieldStrategy,
      bonfireCombustionFieldEvaluationsPerCell: state.bonfireCombustionFieldEvaluationsPerCell,
      mainFluidBonfireProceduralBreakupStrategy: state.mainFluidBonfireProceduralBreakupStrategy,
      bonfireProceduralBreakupEvaluationsPerCell: state.bonfireProceduralBreakupEvaluationsPerCell,
      mainFluidBonfireSymmetricForceStrategy: state.mainFluidBonfireSymmetricForceStrategy,
      bonfireSymmetricForceEvaluationsPerCell: state.bonfireSymmetricForceEvaluationsPerCell,
      mainFluidBonfireNonWindForceStrategy: state.mainFluidBonfireNonWindForceStrategy,
      bonfireNonWindForceEvaluationsPerCell: state.bonfireNonWindForceEvaluationsPerCell,
      mainFluidBonfireScalarNeighborhoodStrategy: state.mainFluidBonfireScalarNeighborhoodStrategy,
      bonfireScalarNeighborhoodReadsPerCell: state.bonfireScalarNeighborhoodReadsPerCell,
      tallPlumeDetailCoherenceStrategy: state.tallPlumeDetailCoherenceStrategy,
      tallPlumeDetailCoherenceExtraReadsPerCell: state.tallPlumeDetailCoherenceExtraReadsPerCell,
      tallPlumeTransitionBandStrategy: state.tallPlumeTransitionBandStrategy,
      tallPlumeTransitionBandExtraReadsPerCell: state.tallPlumeTransitionBandExtraReadsPerCell,
      fireLickBreakupEnabled: state.fireLickBreakupEnabled,
      fireLickBreakupEvaluationsPerCell: state.fireLickBreakupEvaluationsPerCell,
      fireLickOperatorGain: state.fireLickOperatorGain,
      pressureDivergencePasses: state.pressureDivergencePasses,
      pressureJacobiInlineDivergencePasses: state.pressureJacobiInlineDivergencePasses,
      fullGridPassBreakdown: state.fullGridPassBreakdown ? { ...state.fullGridPassBreakdown } : null,
      majorantGrid: state.majorantGrid,
      majorantBuilt: state.majorantBuilt,
      majorantCadence: state.majorantCadence,
      majorantBuiltThisFrame: state.majorantBuiltThisFrame,
      majorantLastBuiltFrame: state.majorantLastBuiltFrame,
      majorantSkippedFrameCount: state.majorantSkippedFrameCount,
      simProfile: state.simProfile,
      simCostLedger: state.simCostLedger ? { ...state.simCostLedger } : null,
      timing: { ...state.timing },
      boundarySplatMode: state.boundarySplatMode,
      boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
      boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
      boundarySplatFeatureCaptureRequested: state.boundarySplatFeatureCaptureRequested,
      boundarySplatFeatureCaptureEffective: state.boundarySplatFeatureCaptureEffective,
      boundarySplatFeatureCapture,
      boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
      boundarySidecarOverrideReceipt: state.boundarySidecarOverrideReceipt,
      boundarySplatCapacity: state.boundarySplatCapacity,
      boundarySplatInstanceCount: boundarySplatSample?.instanceCount ?? state.boundarySplatInstanceCount,
      boundarySplatCandidateCount: boundarySplatSample?.candidateCount ?? state.boundarySplatCandidateCount,
      boundarySplatOverflowCount: boundarySplatSample?.overflowCount ?? state.boundarySplatOverflowCount,
      boundarySplatCountAuthority: boundarySplatSample?.authority ?? state.boundarySplatCountAuthority,
      boundarySplatFallbackReason: state.boundarySplatFallbackReason,
      boundarySplatFrameCount: state.boundarySplatFrameCount,
      boundarySplatTimestampStatus: boundarySplatGpuProfile?.timestampStatus ?? state.boundarySplatTimestampStatus,
      boundarySplatGpuProfile,
      boundarySplatCopyBytesThisFrame: state.boundarySplatCopyBytesThisFrame,
      boundarySplatCopyDisposition: state.boundarySplatCopyDisposition,
      simReadback,
      majorantReadback,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
      sampleAuthority: advanceSim ? 'sim-advanced-frame-readback' : 'render-only-frozen-sim-state',
      simAdvanced: advanceSim,
      sameStateCaptureId,
      baseFrameCount,
      baseSimStepCount,
      sampleNowMs: sampleNow,
      renderPhaseTimeMs: state.renderPhaseTimeMs,
      renderPhaseFrame: state.renderPhaseFrame,
      renderPhaseAuthority: state.renderPhaseAuthority,
      lookFreezeRenderTimeMs: state.lookFreezeRenderTimeMs,
      lookFreezeRenderFrame: state.lookFreezeRenderFrame,
      preview: {
        width: previewWidth,
        height: previewHeight,
        rgba: Array.from(preview),
      },
      image: rgba ? {
        width: state.width,
        height: state.height,
        rgba: Array.from(rgba),
      } : null,
    };
  }

  function compactRenderScaleSample(sample) {
    if (!sample || typeof sample !== 'object') return sample;
    const simReadback = sample.simReadback ? { ...sample.simReadback } : null;
    if (simReadback?.reactionFrontAtlas) {
      simReadback.reactionFrontAtlas = {
        ...simReadback.reactionFrontAtlas,
        rgba: null,
      };
    }
    if (simReadback?.canonicalSmokeFieldSlice) {
      simReadback.canonicalSmokeFieldSlice = {
        ...simReadback.canonicalSmokeFieldSlice,
        rgba: null,
      };
    }
    return {
      ...sample,
      preview: sample.preview ? {
        width: sample.preview.width,
        height: sample.preview.height,
        rgba: null,
      } : null,
      image: null,
      simReadback,
    };
  }

  async function sampleRenderScaleSet(options = {}) {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    const requestedScales = Array.isArray(options.renderScales) ? options.renderScales : [];
    const renderScales = requestedScales
      .map(scale => normalizeRenderScale(scale))
      .filter(scale => Number.isFinite(scale));
    if (!renderScales.length) return { ok: false, reason: 'missing-render-scales', ...state };
    cancelAnimationFrame(raf);
    if (device.queue?.onSubmittedWorkDone) {
      await device.queue.onSubmittedWorkDone();
    }
    const controlsBefore = { ...controlsSnapshot };
    const baseFrameCount = state.frameCount;
    const baseSimStepCount = state.simStepCount;
    const fixedNow = Number.isFinite(Number(options.now)) ? Number(options.now) : performance.now();
    const sameStateCaptureId = options.sameStateCaptureId
      ? String(options.sameStateCaptureId)
      : `same-state-f${baseFrameCount}-s${baseSimStepCount}-${Math.round(fixedNow)}`;
    const samples = [];
    try {
      for (let index = 0; index < renderScales.length; index += 1) {
        const renderScale = renderScales[index];
        controlsSnapshot = applyRuntimeQualityControls({ ...controlsSnapshot, renderScale });
        resetTemporalHistory('same-state-render-scale-capture');
        const sample = await sampleFrame({
          advanceSim: false,
          includeRgba: options.includeRgba === true,
          now: fixedNow,
          sameStateCaptureId,
          baseFrameCount,
          baseSimStepCount,
          renderScaleSetIndex: index,
        });
        samples.push({
          role: index === renderScales.length - 1 ? 'high' : `low-${index + 1}`,
          requestedRenderScale: renderScale,
          ...sample,
        });
      }
    } finally {
      controlsSnapshot = controlsBefore;
      resetTemporalHistory('same-state-render-scale-restore');
      if (options.resumeRenderLoop !== false && state.active) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(render);
      }
    }
    const returnedSamples = options.compactSamples === true
      ? samples.map(sample => compactRenderScaleSample(sample))
      : samples;
    return {
      ok: samples.every(sample => sample.ok === true),
      sampleSetAuthority: 'frame-locked-render-scale-set-v0',
      sampleAuthority: 'render-only-frozen-sim-state',
      sameStateCaptureId,
      baseFrameCount,
      baseSimStepCount,
      fixedNowMs: fixedNow,
      renderScales,
      samples: returnedSamples,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
    };
  }

  async function controlledStepFrame(options = {}) {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    const requestedScales = Array.isArray(options.renderScales) ? options.renderScales : [];
    const renderScales = requestedScales
      .map(scale => normalizeRenderScale(scale))
      .filter(scale => Number.isFinite(scale));
    if (!renderScales.length) return { ok: false, reason: 'missing-render-scales', ...state };
    cancelAnimationFrame(raf);
    if (device.queue?.onSubmittedWorkDone) {
      await device.queue.onSubmittedWorkDone();
    }
    const controlledStepFrameIndex = Math.max(0, Math.floor(Number(options.controlledStepFrameIndex) || 0));
    const sequenceStartNowMs = options.startNow !== null && options.startNow !== undefined && Number.isFinite(Number(options.startNow))
      ? Number(options.startNow)
      : performance.now();
    const controlledStepDeltaMs = Math.max(0, Number.isFinite(Number(options.stepDeltaMs)) ? Number(options.stepDeltaMs) : 220);
    const controlledStepNowMs = sequenceStartNowMs + controlledStepFrameIndex * controlledStepDeltaMs;
    const sameBrowserSessionId = options.sameBrowserSessionId
      ? String(options.sameBrowserSessionId)
      : `same-browser-f${state.frameCount}-s${state.simStepCount}-${Math.round(sequenceStartNowMs)}`;
    let controlledStepCapture = null;
    if (options.advanceSim === true) {
      const beforeFrameCount = state.frameCount;
      const beforeSimStepCount = state.simStepCount;
      const stepSample = await sampleFrame({
        advanceSim: true,
        includeRgba: false,
        now: controlledStepNowMs,
        sameStateCaptureId: `${sameBrowserSessionId}-advance-${controlledStepFrameIndex}`,
        baseFrameCount: beforeFrameCount,
        baseSimStepCount: beforeSimStepCount,
      });
      controlledStepCapture = {
        ok: stepSample.ok,
        sampleAuthority: 'controlled-step-sim-advance',
        sourceSampleAuthority: stepSample.sampleAuthority,
        beforeFrameCount,
        beforeSimStepCount,
        afterFrameCount: state.frameCount,
        afterSimStepCount: state.simStepCount,
        controlledStepNowMs,
      };
    } else {
      controlledStepCapture = {
        ok: true,
        sampleAuthority: 'controlled-step-initial-state',
        beforeFrameCount: state.frameCount,
        beforeSimStepCount: state.simStepCount,
        afterFrameCount: state.frameCount,
        afterSimStepCount: state.simStepCount,
        controlledStepNowMs,
      };
    }
    const sameStateCaptureId = `${sameBrowserSessionId}-frame-${String(controlledStepFrameIndex + 1).padStart(3, '0')}-s${state.simStepCount}`;
    const scaleSet = await sampleRenderScaleSet({
      renderScales,
      includeRgba: options.includeRgba === true,
      includeFeatureRgba: options.includeFeatureRgba === true,
      compactSamples: options.compactSamples === true,
      now: controlledStepNowMs,
      sameStateCaptureId,
      resumeRenderLoop: false,
    });
    return {
      ok: scaleSet.ok === true && controlledStepCapture.ok !== false,
      sequenceAuthority: 'controlled-step-sequence-v0',
      controlledStepFrameIndex,
      controlledStepDeltaMs,
      controlledStepNowMs,
      sequenceStartNowMs,
      sameBrowserSessionId,
      controlledStepCapture,
      scaleSet,
    };
  }

  async function captureSelectiveHeadLiveFrame(options = {}) {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    cancelAnimationFrame(raf);
    const frameIndex = Math.max(0, Math.floor(Number(options.frameIndex) || 0));
    const advanceSim = options.advanceSim !== false;
    const presentToCanvas = options.presentToCanvas === true;
    const startNow = Number.isFinite(Number(options.startNow)) ? Number(options.startNow) : performance.now();
    const stepDeltaMs = Math.max(0, Number.isFinite(Number(options.stepDeltaMs)) ? Number(options.stepDeltaMs) : 1000 / 30);
    const sampleNow = startNow + frameIndex * stepDeltaMs;
    updateUniforms(sampleNow);
    if (!presentToCanvas) ensureFrameTexture();
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = state.width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const readback = presentToCanvas ? null : device.createBuffer({
      label: 'kaminos selective-head-live-lean-frame-readback-v0',
      size: bytesPerRow * state.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const targetView = presentToCanvas ? context.getCurrentTexture().createView() : frameTexture.createView();
    const targetRaymarchPipeline = presentToCanvas ? pipeline : readbackPipeline;
    const targetSplatPipeline = presentToCanvas ? boundarySplatRenderPipeline : boundarySplatReadbackPipeline;
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder({ label: `kaminos selective-head live frame ${frameIndex}` });
    const beforeSimStepCount = state.simStepCount;
    if (advanceSim) encodeSim(encoder);
    encodeSelectiveHeadLiveFields(encoder);
    const selectiveMajorant = selectiveHeadLiveRoleGroups('majorant');
    const selectiveSidecar = selectiveHeadLiveRoleGroups('sidecar');
    const selectiveSplat = selectiveHeadLiveRoleGroups('splat');
    const selectiveRender = selectiveHeadLiveRoleGroups('render');
    encodeMajorant(encoder, { readBindGroup: selectiveMajorant, force: true });
    encodeBoundarySidecar(encoder, { readBindGroup: selectiveSidecar });
    encodeBoundarySplats(encoder, { computeBindGroup: selectiveSplat });
    const composition = updateSelectiveHeadLiveCompositionState();
    let raymarchEncoded = false;
    let raymarchApplied = false;
    let splatEncoded = false;
    let splatApplied = false;
    if (composition.definition.raymarch) {
      encodeDraw(
        encoder,
        targetView,
        `kaminos selective-head controlled ${presentToCanvas ? 'canvas' : 'readback'} ${composition.effective} raymarch`,
        targetRaymarchPipeline,
        { bindGroup: selectiveRender },
      );
      raymarchEncoded = true;
      raymarchApplied = true;
    }
    if (composition.definition.splat) {
      splatEncoded = encodeBoundarySplatDraw(
        encoder,
        targetView,
        targetSplatPipeline,
        { loadOp: raymarchApplied ? 'load' : 'clear' },
      );
      splatApplied = splatEncoded;
    }
    if (composition.definition.splat && !splatApplied) {
      readback?.destroy();
      await device.popErrorScope();
      return {
        ok: false,
        reason: 'boundary-splat-readback-route-unavailable',
        selectiveHeadLiveCompositionRequestedRaw: state.selectiveHeadLiveCompositionRequestedRaw,
        selectiveHeadLiveCompositionRequested: state.selectiveHeadLiveCompositionRequested,
        selectiveHeadLiveCompositionEffective: 'unavailable',
        selectiveHeadLiveCompositionFallbackReason: state.boundarySplatFallbackReason || 'boundary-splat-readback-route-unavailable',
        selectiveHeadLivePassReceipt: makeSelectiveHeadLivePassReceipt({
          composition: composition.requested,
          raymarchEncoded,
          raymarchApplied,
          splatEncoded,
          splatApplied: false,
          fallbackReason: state.boundarySplatFallbackReason || 'boundary-splat-readback-route-unavailable',
        }),
      };
    }
    const selectiveHeadLivePassReceipt = recordSelectiveHeadLivePassReceipt({
      composition: composition.effective === 'off' ? composition.requested : composition.effective,
      raymarchEncoded,
      raymarchApplied,
      splatEncoded,
      splatApplied,
      fallbackReason: state.selectiveHeadLiveCompositionFallbackReason,
    });
    if (!presentToCanvas) {
      encoder.copyTextureToBuffer(
        { texture: frameTexture },
        { buffer: readback, bytesPerRow, rowsPerImage: state.height },
        { width: state.width, height: state.height, depthOrArrayLayers: 1 },
      );
    }
    device.queue.submit([encoder.finish()]);
    const validationError = await device.popErrorScope();
    if (validationError) {
      readback?.destroy();
      return { ok: false, reason: `lean-frame-readback-validation:${validationError.message || String(validationError)}` };
    }
    let rgba = null;
    if (!presentToCanvas) {
      await readback.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(readback.getMappedRange());
      rgba = new Uint8Array(unpaddedBytesPerRow * state.height);
      for (let row = 0; row < state.height; row += 1) {
        rgba.set(padded.subarray(row * bytesPerRow, row * bytesPerRow + unpaddedBytesPerRow), row * unpaddedBytesPerRow);
      }
      readback.unmap();
      readback.destroy();
    }
    state.frameCount += 1;
    return {
      ok: true,
      sequenceAuthority: advanceSim ? 'frame-locked-consecutive-simulation-steps-v0' : 'same-state-selective-render-composition-v0',
      imageAuthority: presentToCanvas ? 'selective-head-live-presented-canvas-composition-v0' : 'selective-head-live-lean-frame-readback-v0',
      advanceSim,
      presentToCanvas,
      frameIndex,
      width: state.width,
      height: state.height,
      rgba: rgba ? Array.from(rgba) : null,
      simStepCount: state.simStepCount,
      beforeSimStepCount,
      frameCount: state.frameCount,
      effectiveRole: state.selectiveHeadLiveEffectiveRole,
      requestedRole: state.selectiveHeadLiveRole,
      roleAuthority: state.selectiveHeadLiveRoleAuthority,
      selectiveHeadLiveCompositionRequestedRaw: state.selectiveHeadLiveCompositionRequestedRaw,
      selectiveHeadLiveCompositionRequested: state.selectiveHeadLiveCompositionRequested,
      selectiveHeadLiveCompositionEffective: state.selectiveHeadLiveCompositionEffective,
      selectiveHeadLiveCompositionAuthority: state.selectiveHeadLiveCompositionAuthority,
      selectiveHeadLiveCompositionFallbackReason: state.selectiveHeadLiveCompositionFallbackReason,
      selectiveHeadLivePassReceipt,
      modelIdentity: state.selectiveHeadLiveModelIdentity,
      routeIdentity: SELECTIVE_HEAD_LIVE_ROUTE,
      fallbackReason: state.selectiveHeadLiveFallbackReason,
      boundarySplatFallbackReason: state.boundarySplatFallbackReason,
      backend: state.backend,
      reason: null,
    };
  }

  async function controlledStepSequence(options = {}) {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    const requestedFrameCount = Math.max(1, Math.floor(Number(options.frameCount) || 1));
    const requestedScales = Array.isArray(options.renderScales) ? options.renderScales : [];
    const renderScales = requestedScales
      .map(scale => normalizeRenderScale(scale))
      .filter(scale => Number.isFinite(scale));
    if (!renderScales.length) return { ok: false, reason: 'missing-render-scales', ...state };
    const startNow = options.startNow !== null && options.startNow !== undefined && Number.isFinite(Number(options.startNow))
      ? Number(options.startNow)
      : performance.now();
    const controlledStepDeltaMs = Math.max(0, Number.isFinite(Number(options.stepDeltaMs)) ? Number(options.stepDeltaMs) : 220);
    const startFrameCount = state.frameCount;
    const startSimStepCount = state.simStepCount;
    const sameBrowserSessionId = options.sameBrowserSessionId
      ? String(options.sameBrowserSessionId)
      : `same-browser-f${startFrameCount}-s${startSimStepCount}-${Math.round(startNow)}`;
    const frames = [];
    const controlsBefore = { ...controlsSnapshot };
    try {
      for (let frameIndex = 0; frameIndex < requestedFrameCount; frameIndex += 1) {
        const frame = await controlledStepFrame({
          controlledStepFrameIndex: frameIndex,
          frameCount: requestedFrameCount,
          advanceSim: frameIndex > 0,
          sameBrowserSessionId,
          startNow,
          stepDeltaMs: controlledStepDeltaMs,
          renderScales,
          includeRgba: options.includeRgba === true,
          includeFeatureRgba: options.includeFeatureRgba === true,
          resumeRenderLoop: false,
        });
        frames.push(frame);
      }
    } finally {
      controlsSnapshot = controlsBefore;
      resetTemporalHistory('controlled-step-sequence-restore');
      if (options.resumeRenderLoop !== false && state.active) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(render);
      }
    }
    return {
      ok: frames.every(frame => frame.ok === true),
      sequenceAuthority: 'controlled-step-sequence-v0',
      sampleAuthority: 'controlled-step-sim-advance',
      sameBrowserSessionId,
      controlledStepDeltaMs,
      requestedFrameCount,
      startFrameCount,
      startSimStepCount,
      startNowMs: startNow,
      renderScales,
      frames,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
    };
  }

  async function renderFrozenScaleToCanvas(options = {}) {
    const fullFieldImportSessionId = String(options.fullFieldImportSessionId || '');
    const importedFieldCustody = Boolean(
      fullFieldImportSessionId
      && state.fullFieldImportReceipt?.status === 'applied'
      && state.fullFieldImportReceipt?.renderLoopPaused === true
      && fullFieldImportSessionId === state.fullFieldImportReceipt.sessionId
    );
    if ((!state.active && !importedFieldCustody) || !device) return { ok: false, reason: 'inactive', ...state };
    const compositionExplicit = options.boundarySplatComposition != null;
    const boundarySplatCompositionRequestedRaw = options.boundarySplatComposition ?? 'splat-only-v0';
    const compositionRequest = selectiveHeadLiveRenderCompositionRequest(boundarySplatCompositionRequestedRaw);
    if (compositionRequest.fallbackReason) {
      return {
        ok: false,
        reason: 'unsupported-boundary-splat-composition',
        boundarySplatCompositionRequestedRaw,
        boundarySplatCompositionRequested: null,
        boundarySplatCompositionEffective: 'unavailable',
        raymarchEncoded: false,
        splatEncoded: false,
        raymarchApplied: false,
        splatApplied: false,
      };
    }
    const compositionDefinition = compositionRequest.definition;
    cancelAnimationFrame(raf);
    if (device.queue?.onSubmittedWorkDone) {
      await device.queue.onSubmittedWorkDone();
    }
    const controlsBefore = { ...controlsSnapshot };
    const renderScale = normalizeRenderScale(options.renderScale ?? controlsSnapshot.renderScale);
    const controlOverrides = {
      ...(options.controlOverrides && typeof options.controlOverrides === 'object' ? options.controlOverrides : {}),
      selectiveHeadLiveRenderComposition: compositionRequest.requested,
    };
    const boundarySplatCompositionRequested = boundarySplatCompositionRequestedRaw === 'raymarch-under-splats-v0'
      ? boundarySplatCompositionRequestedRaw
      : compositionRequest.requested;
    const fixedNow = Number.isFinite(Number(options.now)) ? Number(options.now) : performance.now();
    const sameStateCaptureId = options.sameStateCaptureId ? String(options.sameStateCaptureId) : null;
    const baseFrameCount = Number.isFinite(Number(options.baseFrameCount)) ? Number(options.baseFrameCount) : state.frameCount;
    const baseSimStepCount = Number.isFinite(Number(options.baseSimStepCount)) ? Number(options.baseSimStepCount) : state.simStepCount;
    try {
      controlsSnapshot = applyRuntimeQualityControls({ ...controlsSnapshot, ...controlOverrides, renderScale });
      resetTemporalHistory('same-state-render-scale-canvas-capture');
      updateUniforms(fixedNow);
      const encoder = device.createCommandEncoder({ label: 'kaminos frozen render-scale canvas capture' });
      encodeMajorant(encoder, { force: true });
      encodeBoundarySidecar(encoder);
      encodeBoundarySplats(encoder);
      const currentTexture = context.getCurrentTexture();
      let residualApplied = false;
      let raymarchEncoded = false;
      let splatEncoded = false;
      let raymarchApplied = false;
      let splatApplied = false;
      const explicitCompositionRoute = compositionExplicit || boundarySplatRequested();
      let boundarySplatCompositionEffective = explicitCompositionRoute
        ? boundarySplatCompositionRequested
        : 'raymarch-only-v0';
      let compositionAuthority = explicitCompositionRoute
        ? compositionDefinition.compositionAuthority
        : 'diagnostic-raymarch-full-selected-field-authority-v0';
      let raymarchFireAuthority = explicitCompositionRoute ? compositionDefinition.raymarchFireAuthority : 1;
      let featureCaptureSourcePassApplied = false;
      let sourcePassEncodeMs = null;
      let residualPassEncodeMs = null;
      let boundarySplatInitialOverflowCount = 0;
      let boundarySplatCapacityRetryCount = 0;
      if (explicitCompositionRoute) {
        if (compositionDefinition.splat && !boundarySplatRequested()) {
          return {
            ok: false,
            reason: 'boundary-splat-frozen-canvas-route-unavailable',
            boundarySplatCompositionRequestedRaw,
            boundarySplatCompositionRequested,
            boundarySplatCompositionEffective: 'unavailable',
            compositionAuthority,
            raymarchFireAuthority,
            raymarchEncoded: false,
            splatEncoded: false,
            raymarchApplied: false,
            splatApplied: false,
            boundarySplatFallbackReason: state.boundarySplatFallbackReason || 'boundary-splat-mode-off',
            boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
            boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
            boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
          };
        }
        if (compositionDefinition.raymarch) {
          encodeDraw(
            encoder,
            currentTexture.createView(),
            `kaminos frozen ${boundarySplatCompositionRequested} raymarch pass`,
          );
          raymarchEncoded = true;
        }
        if (compositionDefinition.splat) {
          splatEncoded = encodeBoundarySplatDraw(
            encoder,
            currentTexture.createView(),
            boundarySplatRenderPipeline,
            { loadOp: raymarchEncoded ? 'load' : 'clear' },
          );
        }
        if (compositionDefinition.splat && !splatEncoded) {
          return {
            ok: false,
            reason: 'boundary-splat-frozen-canvas-route-unavailable',
            boundarySplatCompositionRequestedRaw,
            boundarySplatCompositionRequested,
            boundarySplatCompositionEffective: 'unavailable',
            raymarchEncoded,
            splatEncoded,
            raymarchApplied: false,
            splatApplied: false,
            boundarySplatFallbackReason: state.boundarySplatFallbackReason,
            boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
            boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
            boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
          };
        }
        state.volumeReconstructionStyle = boundarySplatCompositionEffective;
        if (compositionDefinition.splat) encodeBoundarySplatTelemetry(encoder, true);
        recordBrowserResidualCost({ applied: false });
      } else if (browserResidualCanApply()) {
        ensureFrameTexture();
        ensureBrowserResidualFeatureTexture();
        const sourcePassStart = performance.now();
        encodeBrowserResidualSourcePass(encoder, frameTexture.createView(), browserResidualFeatureTexture.createView());
        raymarchEncoded = true;
        sourcePassEncodeMs = performance.now() - sourcePassStart;
        featureCaptureSourcePassApplied = true;
        const residualPassStart = performance.now();
        residualApplied = encodeBrowserResidualPass(encoder, currentTexture.createView());
        residualPassEncodeMs = performance.now() - residualPassStart;
        recordBrowserResidualCost({ applied: residualApplied, sourcePassEncodeMs, residualPassEncodeMs });
      } else {
        encodeDraw(encoder, currentTexture.createView(), 'kaminos frozen render-scale canvas pass');
        raymarchEncoded = true;
        state.volumeReconstructionStyle = state.renderScale < 0.999 ? 'linear-css-upscale' : 'native-resolution';
        recordBrowserResidualCost({ applied: false });
      }
      if (options.includeFeatureRgba === true && !featureCaptureSourcePassApplied) {
        ensureFrameTexture();
        ensureBrowserResidualFeatureTexture();
        encodeBrowserResidualSourcePass(encoder, frameTexture.createView(), browserResidualFeatureTexture.createView());
        featureCaptureSourcePassApplied = true;
      }
      device.queue.submit([encoder.finish()]);
      raymarchApplied = raymarchEncoded;
      splatApplied = splatEncoded;
      if (boundarySplatTelemetryCopyPending) await resolveBoundarySplatTelemetry();
      if (device.queue?.onSubmittedWorkDone) {
        await device.queue.onSubmittedWorkDone();
      }
      if (compositionDefinition.splat && Number(state.boundarySplatOverflowCount) > 0) {
        boundarySplatInitialOverflowCount = Number(state.boundarySplatOverflowCount);
        const candidateCount = Number(state.boundarySplatCandidateCount);
        if (!Number.isFinite(candidateCount) || boundarySplatCapacity < candidateCount) {
          return {
            ok: false,
            reason: 'boundary-splat-frozen-capacity-growth-unavailable',
            boundarySplatCompositionRequestedRaw,
            boundarySplatCompositionRequested,
            boundarySplatCompositionEffective: 'unavailable',
            boundarySplatCandidateCount: state.boundarySplatCandidateCount,
            boundarySplatInstanceCount: state.boundarySplatInstanceCount,
            boundarySplatOverflowCount: state.boundarySplatOverflowCount,
            boundarySplatCapacity,
            boundarySplatInitialOverflowCount,
            boundarySplatCapacityRetryCount,
            raymarchEncoded,
            splatEncoded,
            raymarchApplied,
            splatApplied: false,
          };
        }
        updateUniforms(fixedNow);
        const retryEncoder = device.createCommandEncoder({ label: 'kaminos frozen-boundary-splat-capacity-retry' });
        encodeBoundarySplats(retryEncoder);
        const retryTexture = context.getCurrentTexture();
        let retryRaymarchEncoded = false;
        if (compositionDefinition.raymarch) {
          encodeDraw(
            retryEncoder,
            retryTexture.createView(),
            `kaminos frozen ${boundarySplatCompositionRequested} capacity-retry raymarch pass`,
          );
          retryRaymarchEncoded = true;
        }
        const retrySplatEncoded = encodeBoundarySplatDraw(
          retryEncoder,
          retryTexture.createView(),
          boundarySplatRenderPipeline,
          { loadOp: retryRaymarchEncoded ? 'load' : 'clear' },
        );
        if (!retrySplatEncoded) {
          return {
            ok: false,
            reason: 'boundary-splat-frozen-capacity-retry-unavailable',
            boundarySplatCompositionRequestedRaw,
            boundarySplatCompositionRequested,
            boundarySplatCompositionEffective: 'unavailable',
            boundarySplatCandidateCount: state.boundarySplatCandidateCount,
            boundarySplatInstanceCount: state.boundarySplatInstanceCount,
            boundarySplatOverflowCount: state.boundarySplatOverflowCount,
            boundarySplatCapacity,
            boundarySplatInitialOverflowCount,
            boundarySplatCapacityRetryCount,
            raymarchEncoded,
            splatEncoded: false,
            raymarchApplied,
            splatApplied: false,
          };
        }
        encodeBoundarySplatTelemetry(retryEncoder, true);
        device.queue.submit([retryEncoder.finish()]);
        boundarySplatCapacityRetryCount += 1;
        raymarchEncoded = raymarchEncoded || retryRaymarchEncoded;
        splatEncoded = retrySplatEncoded;
        raymarchApplied = raymarchEncoded;
        splatApplied = splatEncoded;
        if (boundarySplatTelemetryCopyPending) await resolveBoundarySplatTelemetry();
        if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
        if (Number(state.boundarySplatOverflowCount) > 0) {
          return {
            ok: false,
            reason: 'boundary-splat-frozen-capacity-retry-overflow',
            boundarySplatCompositionRequestedRaw,
            boundarySplatCompositionRequested,
            boundarySplatCompositionEffective: 'unavailable',
            boundarySplatCandidateCount: state.boundarySplatCandidateCount,
            boundarySplatInstanceCount: state.boundarySplatInstanceCount,
            boundarySplatOverflowCount: state.boundarySplatOverflowCount,
            boundarySplatCapacity,
            boundarySplatInitialOverflowCount,
            boundarySplatCapacityRetryCount,
            raymarchEncoded,
            splatEncoded,
            raymarchApplied,
            splatApplied: false,
          };
        }
      }
      const featureCapture = featureCaptureSourcePassApplied && browserResidualFeatureTexture
        ? await readTextureRgba8(
          browserResidualFeatureTexture,
          state.width,
          state.height,
          'kaminos residual shader-material-authority feature readback'
        )
        : null;
      const canvasRect = canvas.getBoundingClientRect();
      return {
        ok: true,
        sampleAuthority: 'render-only-frozen-sim-state',
        imageAuthority: 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state',
        controlOverrides,
        cameraSignature: temporalCameraSignature(),
        renderControlSignature: frozenRenderControlSignature(controlsSnapshot),
        boundarySplatCompositionRequestedRaw,
        boundarySplatCompositionRequested,
        boundarySplatCompositionEffective,
        compositionAuthority,
        raymarchFireAuthority,
        raymarchEncoded,
        splatEncoded,
        raymarchApplied,
        splatApplied,
        residualApplied,
        residualSourcePassEncodeMs: sourcePassEncodeMs,
        residualPassEncodeMs,
        featureCapture: featureCapture ? {
          ...featureCapture,
          featureAuthority: BROWSER_RESIDUAL_FEATURE_AUTHORITY,
          imageAuthority: 'gpu-feature-texture-rgba8-readback-frozen-sim-state-source-pass',
          inputChannels: 4,
          channelLayout: 'radiance-fire-interface-smoke',
          source: 'browserResidualFeatureTexture',
          sourcePassApplied: featureCaptureSourcePassApplied,
        } : null,
        featureCaptureSourcePassApplied,
        sameStateCaptureId,
        baseFrameCount,
        baseSimStepCount,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        sampleNowMs: fixedNow,
        requestedRenderScale: renderScale,
        renderScale: state.renderScale,
        renderPixelRatio: state.renderPixelRatio,
        displayWidth: state.displayWidth,
        displayHeight: state.displayHeight,
        renderWidth: state.renderWidth,
        renderHeight: state.renderHeight,
        volumeReconstructionStyle: state.volumeReconstructionStyle,
        canvasCssRect: {
          x: canvasRect.left,
          y: canvasRect.top,
          width: canvasRect.width,
          height: canvasRect.height,
        },
        devicePixelRatio: window.devicePixelRatio || 1,
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: state.prototypeIdentity,
        backend: state.backend,
        boundarySidecarIdentity: state.boundarySidecarIdentity,
        boundarySidecarAuthority: state.boundarySidecarAuthority,
        boundarySidecarSource: state.boundarySidecarSource,
        boundarySidecarOverrideReceipt: state.boundarySidecarOverrideReceipt,
        boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
        boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
        boundarySplatRadius: state.boundarySplatRadius,
        boundarySplatSharpness: state.boundarySplatSharpness,
        boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
        boundarySplatInstanceCount: state.boundarySplatInstanceCount,
        boundarySplatCandidateCount: state.boundarySplatCandidateCount,
        boundarySplatOverflowCount: state.boundarySplatOverflowCount,
        boundarySplatCapacity,
        boundarySplatInitialOverflowCount,
        boundarySplatCapacityRetryCount,
        boundarySplatFallbackReason: state.boundarySplatFallbackReason,
      };
    } finally {
      if (options.restoreControls !== false) {
        controlsSnapshot = controlsBefore;
        resetTemporalHistory('same-state-render-scale-canvas-restore');
      }
      if (options.resumeRenderLoop === true && state.active) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(render);
      }
    }
  }

  async function ensureNativeLowSelectiveSharedRuntime({ transferRouteId = NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE, sourceGrid = gridSize } = {}) {
    const key = `${transferRouteId}:source-${sourceGrid}`;
    if (!nativeLowSelectiveSharedRuntimes.has(key)) {
      nativeLowSelectiveSharedRuntimes.set(key, await createNativeLowSelectiveSharedDeviceRuntime({ device, transferRouteId, sourceGrid }));
    }
    const runtime = nativeLowSelectiveSharedRuntimes.get(key);
    state.nativeLowSelectiveSharedDevice = runtime.debugState();
    return runtime;
  }

  function setSharedDeviceCopiedState(step, frame) {
    currentFluid = 0;
    currentFront = 0;
    state.simStepCount = step;
    state.frameCount = frame;
    state.frontFieldReadIndex = currentFront;
    state.frontFieldWriteIndex = 1 - currentFront;
    state.frontFieldProjectionPassthrough = false;
    updateSimCostLedger();
  }

  function captureCanvasObjectUrl() {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== 'function') {
        resolve(null);
        return;
      }
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('canvas-blob-capture-failed'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, 'image/png');
    });
  }

  function nativeLowTreatmentSplatCalibrationDebug(requested = {}) {
    const requestedRadianceGain = normalizeNativeLowTreatmentSplatRadianceGain(requested.radianceGain);
    const requestedOpacityGain = normalizeNativeLowTreatmentSplatOpacityGain(requested.opacityGain);
    const effectiveRadianceGain = requestedRadianceGain;
    const effectiveOpacityGain = requestedOpacityGain;
    return {
      identity: NATIVE_LOW_LEARNED_SPLAT_CALIBRATION_IDENTITY,
      authority: 'truth-free-fragment-stage-learned-splat-radiance-opacity-v0',
      requestedCalibration: NATIVE_LOW_LEARNED_SPLAT_CALIBRATION_IDENTITY,
      effectiveCalibration: NATIVE_LOW_LEARNED_SPLAT_CALIBRATION_IDENTITY,
      requestedRadianceGain,
      effectiveRadianceGain,
      requestedOpacityGain,
      effectiveOpacityGain,
      calibrationGain: effectiveRadianceGain,
      treatmentSplatRadianceGain: effectiveRadianceGain,
      treatmentSplatOpacityGain: effectiveOpacityGain,
      modelOutputMutation: false,
      appliedStage: 'boundary-splat-fragment-raster-v0',
      truthAuthority: false,
      syntheticDownsampleAuthority: false,
    };
  }

  function native64PathToFetchUrl(path, manifestUrl) {
    const value = String(path || '');
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/private/tmp/')) return `${globalThis.location.origin}/${value.slice('/private/tmp/'.length)}`;
    if (value.startsWith('/tmp/')) return `${globalThis.location.origin}/${value.slice('/tmp/'.length)}`;
    return new URL(value, manifestUrl).href;
  }

  async function sha256ArrayBuffer(bytes) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  }

  async function fetchJsonWithSha256(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`manifest-fetch-failed:${response.status}:${url}`);
    const text = await response.text();
    const encoded = new TextEncoder().encode(text);
    return {
      json: JSON.parse(text),
      sha256: await sha256ArrayBuffer(encoded.buffer),
      byteLength: encoded.byteLength,
    };
  }

  async function fetchArrayBufferWithSha256(url, expectedSha256, expectedByteLength, label) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${label}-fetch-failed:${response.status}:${url}`);
    const bytes = await response.arrayBuffer();
    if (Number.isFinite(Number(expectedByteLength)) && bytes.byteLength !== Number(expectedByteLength)) {
      throw new Error(`${label}-byte-length-mismatch:${bytes.byteLength}:${expectedByteLength}`);
    }
    const sha256 = await sha256ArrayBuffer(bytes);
    if (expectedSha256 && sha256 !== String(expectedSha256).toLowerCase()) {
      throw new Error(`${label}-sha256-mismatch:${sha256}:${expectedSha256}`);
    }
    return { bytes, sha256, byteLength: bytes.byteLength };
  }

  function validateManifestField(field, grid, channels, label) {
    if (!field) throw new Error(`${label}-missing`);
    const shape = Array.isArray(field.shape) ? field.shape : [];
    if (shape[0] !== grid || shape[1] !== grid || shape[2] !== grid || shape[3] !== channels) {
      throw new Error(`${label}-shape-mismatch:${shape.join('x')}:${grid}x${grid}x${grid}x${channels}`);
    }
    if (!/float32/i.test(String(field.dtype || ''))) throw new Error(`${label}-dtype-mismatch:${field.dtype}`);
    return field;
  }

  function writeArrayBufferToTargets(targets, bytes, expectedBytes, label) {
    if (bytes.byteLength !== expectedBytes) throw new Error(`${label}-write-byte-length-mismatch:${bytes.byteLength}:${expectedBytes}`);
    const chunkBytes = 16 * 1024 * 1024;
    let writeCount = 0;
    for (const target of targets) {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
        const byteLength = Math.min(chunkBytes, bytes.byteLength - offset);
        device.queue.writeBuffer(target, offset, new Uint8Array(bytes, offset, byteLength));
        writeCount += 1;
      }
    }
    return {
      label,
      targetCount: targets.length,
      sourceByteLength: bytes.byteLength,
      totalWriteBytes: bytes.byteLength * targets.length,
      chunkWriteCount: writeCount,
    };
  }

  async function fetchNative64FieldPair(manifestUrl, manifestRole, grid, fieldRoot) {
    const manifestFetch = await fetchJsonWithSha256(manifestUrl);
    const manifest = manifestFetch.json;
    const root = fieldRoot(manifest);
    const fluid = validateManifestField(root.fluid, grid, 16, `${manifestRole}-fluid`);
    const front = validateManifestField(root.front, grid, 1, `${manifestRole}-front`);
    const fluidFetch = await fetchArrayBufferWithSha256(
      native64PathToFetchUrl(fluid.path, manifestUrl),
      fluid.sha256,
      fluid.byteLength,
      `${manifestRole}-fluid`,
    );
    const frontFetch = await fetchArrayBufferWithSha256(
      native64PathToFetchUrl(front.path, manifestUrl),
      front.sha256,
      front.byteLength,
      `${manifestRole}-front`,
    );
    return { manifest, manifestSha256: manifestFetch.sha256, fluid, front, fluidFetch, frontFetch };
  }

  async function captureNativeLowCrossGridManifestFrame(options = {}) {
    let failurePhase = 'native-64-cross-grid-preflight';
    let lastTrustworthyEvidence = {};
    const requestedComposition = options.boundarySplatComposition ?? 'splat-only-v0';
    const captureVisuals = options.captureVisuals === true;
    const fixedNow = Number.isFinite(Number(options.now)) ? Number(options.now) : performance.now();
    const sourceManifestUrl = String(options.sourceManifestUrl || '');
    const predictionManifestUrl = String(options.predictionManifestUrl || '');
    const calibration = nativeLowTreatmentSplatCalibrationDebug({
      radianceGain: options.treatmentSplatRadianceGain,
      opacityGain: options.treatmentSplatOpacityGain,
    });
    const startedAt = performance.now();
    try {
      if (!state.active || !device) throw new Error('inactive');
      if (!sourceManifestUrl || !predictionManifestUrl) throw new Error('native-64-manifest-url-missing');
      if (requestedComposition !== 'splat-only-v0') throw new Error(`unsupported-native-64-cross-grid-composition:${requestedComposition}`);
      cancelAnimationFrame(raf);
      raf = 0;
      if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();

      failurePhase = 'native-64-manifest-fetch';
      const sourceFetchStart = performance.now();
      const source = await fetchNative64FieldPair(sourceManifestUrl, 'native64-source', 64, manifest => manifest.sidecars || {});
      const prediction = await fetchNative64FieldPair(predictionManifestUrl, 'native64-prediction', 160, manifest => manifest.receiver || {});
      const manifestFetchMs = performance.now() - sourceFetchStart;
      const nativeStep = Number(prediction.manifest?.source?.nativeSimStepCount ?? source.manifest?.deterministicReplay?.simStepCount ?? 96);
      const sourceMajorantGrid = Number(source.manifest?.deterministicReplay?.majorantGrid || source.manifest?.lastDebugState?.majorantGrid || 24);
      const sourceIdentity = prediction.manifest?.sameNativeStateIdentity || `${source.manifestSha256}:${nativeStep}`;
      const sourceStepIdentity = `native-64-cross-grid-step-${nativeStep}:${sourceIdentity}`;
      lastTrustworthyEvidence = { sourceManifestUrl, predictionManifestUrl, sourceManifestSha256: source.manifestSha256, predictionManifestSha256: prediction.manifestSha256 };

      failurePhase = 'native-64-control-materialization';
      const controlMaterializeStart = performance.now();
      const controlRebuildStart = performance.now();
      rebuildFluidState(64, sourceMajorantGrid, 'native-64-cross-grid-control-materialize', { skipInitialFluid: true });
      const controlRebuildMs = performance.now() - controlRebuildStart;
      const controlWriteStart = performance.now();
      const controlFluidWrite = writeArrayBufferToTargets([fluidBuffers[currentFluid]], source.fluidFetch.bytes, fluidBufferBytes(64), 'native64-control-fluid-current-buffer');
      const controlFrontWrite = writeArrayBufferToTargets([frontBuffers[currentFront]], source.frontFetch.bytes, frontFieldBufferBytes(64), 'native64-control-front-current-buffer');
      if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      setSharedDeviceCopiedState(nativeStep, 0);
      const controlWriteMs = performance.now() - controlWriteStart;
      const controlMaterializeMs = performance.now() - controlMaterializeStart;

      failurePhase = 'native-64-control-splat-render';
      const controlRenderStart = performance.now();
      const controlRender = await renderFrozenScaleToCanvas({
        boundarySplatComposition: requestedComposition,
        now: fixedNow,
        sameStateCaptureId: `${sourceStepIdentity}:native64-control`,
        baseFrameCount: 0,
        baseSimStepCount: nativeStep,
        restoreControls: true,
      });
      if (!controlRender?.ok) throw new Error(`native-64-control-render:${controlRender?.reason || 'unknown'}`);
      const controlVisualUrl = captureVisuals ? await captureCanvasObjectUrl() : null;
      const controlRenderMs = performance.now() - controlRenderStart;

      failurePhase = 'native-64-treatment-materialization';
      const treatmentMaterializeStart = performance.now();
      const treatmentRebuildStart = performance.now();
      rebuildFluidState(160, sourceMajorantGrid, 'native-64-cross-grid-treatment-materialize', { skipInitialFluid: true });
      const treatmentRebuildMs = performance.now() - treatmentRebuildStart;
      const treatmentWriteStart = performance.now();
      const treatmentFluidWrite = writeArrayBufferToTargets([fluidBuffers[currentFluid]], prediction.fluidFetch.bytes, fluidBufferBytes(160), 'native64-treatment-fluid-current-buffer');
      const treatmentFrontWrite = writeArrayBufferToTargets([frontBuffers[currentFront]], prediction.frontFetch.bytes, frontFieldBufferBytes(160), 'native64-treatment-front-current-buffer');
      if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      setSharedDeviceCopiedState(nativeStep, 0);
      const treatmentWriteMs = performance.now() - treatmentWriteStart;
      const treatmentMaterializeMs = performance.now() - treatmentMaterializeStart;

      failurePhase = 'native-64-treatment-splat-render';
      const treatmentRenderStart = performance.now();
      const treatmentRender = await renderFrozenScaleToCanvas({
        boundarySplatComposition: requestedComposition,
        now: fixedNow,
        sameStateCaptureId: `${sourceStepIdentity}:native64-treatment`,
        baseFrameCount: 0,
        baseSimStepCount: nativeStep,
        controlOverrides: {
          nativeLowTreatmentSplatRadianceGain: calibration.effectiveRadianceGain,
          nativeLowTreatmentSplatOpacityGain: calibration.effectiveOpacityGain,
        },
        restoreControls: true,
      });
      if (!treatmentRender?.ok) throw new Error(`native-64-treatment-render:${treatmentRender?.reason || 'unknown'}`);
      const treatmentVisualUrl = captureVisuals ? await captureCanvasObjectUrl() : null;
      const treatmentRenderMs = performance.now() - treatmentRenderStart;

      const supportPositiveCount = Number(prediction.manifest?.support?.predictedPositiveCount || 0);
      const supportPrevalence = Number(prediction.manifest?.support?.predictedPrevalence || 0);
      const supportThreshold = Number(prediction.manifest?.support?.threshold || 0);
      const treatmentSplatInstanceCount = treatmentRender.boundarySplatInstanceCount ?? state.boundarySplatInstanceCount;
      const controlSplatInstanceCount = controlRender.boundarySplatInstanceCount ?? state.boundarySplatInstanceCount;
      const native64ManifestMaterializationProfile = {
        identity: 'native-low-cross-grid-64-manifest-materialization-profile-v0',
        authority: 'static-manifest-render-current-buffer-only-v0',
        writeCurrentBuffersOnly: true,
        hiddenReceiverCopy: false,
        droppedInputChannels: false,
        control: {
          grid: 64,
          fluid: controlFluidWrite,
          front: controlFrontWrite,
          totalWriteBytes: controlFluidWrite.totalWriteBytes + controlFrontWrite.totalWriteBytes,
        },
        treatment: {
          grid: 160,
          fluid: treatmentFluidWrite,
          front: treatmentFrontWrite,
          totalWriteBytes: treatmentFluidWrite.totalWriteBytes + treatmentFrontWrite.totalWriteBytes,
        },
      };
      const receipt = {
        ok: true,
        status: 'captured',
        identity: 'native-low-cross-grid-64-shared-device-manifest-v0',
        routeIdentity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        transportMode: 'shared-device-gpu-buffers-no-readback-import-v0',
        manifestTransport: 'same-origin-fetch-arraybuffer-to-shared-device-gpu-buffers-v0',
        inputAuthority: NATIVE_LOW_INPUT_AUTHORITY,
        compositionAuthority: prediction.manifest?.compositionAuthority || 'frozen-trained-grid-heads-applied-to-explicit-cross-grid-native-state-v0',
        runtimeTruthAvailable: false,
        syntheticDownsampleApplied: false,
        highTruthUse: 'unavailable-not-loaded-not-used',
        sourceManifestUrl,
        predictionManifestUrl,
        sourceManifestSha256: source.manifestSha256,
        predictionManifestSha256: prediction.manifestSha256,
        sourceStepIdentity,
        sameNativeStateIdentity: `${sourceIdentity}:native64-cross-grid:model-${prediction.manifest?.model?.modelSha256 || 'unknown'}:composition-${requestedComposition}:transport-${NATIVE_LOW_TRANSPORT_MODE}`,
        sourceStep: nativeStep,
        controlStep: nativeStep,
        treatmentStep: nativeStep,
        sourceStepDrift: null,
        controlTreatmentCausalDivergence: null,
        native64CrossGridDiscriminant: {
          identity: 'native-64-cross-grid-zero-shot-discriminant-v0',
          nativeGrid: 64,
          trainedLowGrid: Number(prediction.manifest?.model?.trainedLowGrid || 128),
          outputGrid: 160,
          crossGridApplication: true,
          native64NoModelControl: { grid: 64, manifestSha256: source.manifestSha256, fluidSha256: source.fluid.sha256, frontSha256: source.front.sha256 },
          native64SelectivePredicted: { grid: 160, manifestSha256: prediction.manifestSha256, fluidSha256: prediction.fluid.sha256, frontSha256: prediction.front.sha256 },
          macroStructureDecision: 'requires-visual-inspection-v0',
          coarseMacroStructurePreserved: null,
          templateReplacementRisk: 'unjudged',
        },
        native64NoModelControl: { grid: 64, step: nativeStep, backend: state.backend || 'WebGPU', splatInstanceCount: controlSplatInstanceCount },
        native64SelectivePredicted: { grid: 160, step: nativeStep, backend: state.backend || 'WebGPU', splatInstanceCount: treatmentSplatInstanceCount },
        macroStructureDecision: 'requires-visual-inspection-v0',
        coarseMacroStructurePreserved: null,
        templateReplacementRisk: 'unjudged',
        requestedComposition,
        effectiveComposition: treatmentRender.boundarySplatCompositionEffective,
        compositionMismatch: treatmentRender.boundarySplatCompositionEffective !== requestedComposition ? 'compositionMismatch' : null,
        requestedBackend: 'WebGPU',
        effectiveBackend: state.backend || 'WebGPU',
        fallbackBackend: null,
        modelIdentity: prediction.manifest?.model?.identity || 'exact-basin-selective-carrier-heads-160-to-128-v0',
        modelSha256: prediction.manifest?.model?.modelSha256 || 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9',
        modelOutputMutation: false,
        supportThreshold,
        predictedPositiveCount: supportPositiveCount,
        supportPositiveCount,
        supportPrevalence,
        treatmentSplatCandidateCount: treatmentRender.boundarySplatCandidateCount ?? state.boundarySplatCandidateCount,
        treatmentSplatInstanceCount,
        controlSplatCandidateCount: controlRender.boundarySplatCandidateCount ?? state.boundarySplatCandidateCount,
        controlSplatInstanceCount,
        calibrationGain: calibration.calibrationGain,
        calibrationAuthority: calibration.authority,
        requestedCalibration: calibration.requestedCalibration,
        effectiveCalibration: calibration.effectiveCalibration,
        treatmentSplatRadianceGain: calibration.treatmentSplatRadianceGain,
        treatmentSplatOpacityGain: calibration.treatmentSplatOpacityGain,
        nativeLowTreatmentSplatCalibration: calibration,
        manifestFetchMs,
        controlMaterializeMs,
        controlRebuildMs,
        controlWriteMs,
        controlRenderMs,
        treatmentMaterializeMs,
        treatmentRebuildMs,
        treatmentWriteMs,
        treatmentRenderMs,
        endToEndFrameMs: performance.now() - startedAt,
        native64ManifestMaterializationProfile,
        stageTiming: { manifestFetchMs, controlRebuildMs, controlWriteMs, controlMaterializeMs, controlRenderMs, treatmentRebuildMs, treatmentWriteMs, treatmentMaterializeMs, treatmentRenderMs },
        blankTreatmentAttribution: supportPositiveCount <= 0 ? 'model-support-zero' : treatmentSplatInstanceCount <= 0 ? 'splat-materialization-zero' : 'macro-structure-visual-discriminant',
        visuals: {
          controlObjectUrl: controlVisualUrl,
          treatmentObjectUrl: treatmentVisualUrl,
        },
        controlRender,
        treatmentRender,
        failurePhase: null,
        lastTrustworthyEvidence,
      };
      state.nativeLowSelectiveSharedDevice = receipt;
      state.nativeLowTreatmentSplatCalibration = calibration;
      return receipt;
    } catch (error) {
      const failed = {
        ok: false,
        status: 'failed',
        identity: 'native-low-cross-grid-64-shared-device-manifest-v0',
        routeIdentity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        transportMode: 'shared-device-gpu-buffers-no-readback-import-v0',
        failurePhase,
        error: error?.message || String(error),
        lastTrustworthyEvidence,
      };
      state.nativeLowSelectiveSharedDevice = failed;
      return failed;
    }
  }

  async function readTimestampPairMs(source, label) {
    await source.mapAsync(GPUMapMode.READ);
    const values = new BigUint64Array(source.getMappedRange().slice(0));
    source.unmap();
    source.destroy();
    if (values.length < 2 || values[0] === 0n || values[1] === 0n || values[1] < values[0]) {
      return { ms: null, authority: 'timestamp-query-invalid', values: Array.from(values, value => value.toString()), label };
    }
    return { ms: Number(values[1] - values[0]) / 1_000_000, authority: 'webgpu-timestamp-query', label };
  }

  async function readNativeLowHeadCostProfile(source, label, fallbackMs = null) {
    await source.mapAsync(GPUMapMode.READ);
    const values = new BigUint64Array(source.getMappedRange().slice(0));
    source.unmap();
    source.destroy();
    const invalid = values.length < 6
      || values[0] === 0n || values[1] === 0n || values[2] === 0n || values[3] === 0n || values[4] === 0n || values[5] === 0n
      || values[1] < values[0] || values[3] < values[2] || values[5] < values[4];
    if (invalid) {
      return {
        identity: 'native-low-head-cost-profile-v0',
        label,
        headCostTimingAuthority: 'timestamp-query-invalid',
        sourceDeltaAdmissionGpuMs: null,
        supportFrontGpuMs: null,
        supportPositiveResidualGpuMs: null,
        inferenceGpuMs: fallbackMs,
        values: Array.from(values, value => value.toString()),
      };
    }
    const sourceDeltaAdmissionGpuMs = Number(values[1] - values[0]) / 1_000_000;
    const supportFrontGpuMs = Number(values[3] - values[2]) / 1_000_000;
    const supportPositiveResidualGpuMs = Number(values[5] - values[4]) / 1_000_000;
    return {
      identity: 'native-low-head-cost-profile-v0',
      label,
      headCostTimingAuthority: 'webgpu-timestamp-query-stage-split-v0',
      sourceDeltaAdmissionGpuMs,
      sourceDeltaAdmissionStage: 'fixed-source-delta-admission-plus-finalize-v0',
      supportFrontStage: 'full-grid-support-classifier-plus-frontTopology-v0',
      supportPositiveResidualStage: 'support-positive-fuel-visibleFireCarrier-fireLick-v0',
      supportFrontGpuMs,
      supportPositiveResidualGpuMs,
      inferenceGpuMs: sourceDeltaAdmissionGpuMs + supportFrontGpuMs + supportPositiveResidualGpuMs,
      values: Array.from(values, value => value.toString()),
    };
  }

  async function readNativeLowCandidateHeadCostTimings(source) {
    await source.mapAsync(GPUMapMode.READ);
    const values = new BigUint64Array(source.getMappedRange().slice(0));
    source.unmap();
    source.destroy();
    const widths = [16, 24, 32];
    const timings = {};
    for (let index = 0; index < widths.length; index += 1) {
      const start = values[index * 2];
      const end = values[index * 2 + 1];
      timings[widths[index]] = start > 0n && end >= start ? Number(end - start) / 1_000_000 : null;
    }
    return {
      authority: 'webgpu-timestamp-query-width-split-v0',
      values: Array.from(values, value => value.toString()),
      timings,
    };
  }

  async function captureNativeLowSelectiveSharedDeviceFrame(options = {}) {
    let failurePhase = 'shared-device-preflight';
    let lastTrustworthyEvidence = {};
    const requestedComposition = options.boundarySplatComposition ?? 'splat-only-v0';
    const captureVisuals = options.captureVisuals === true;
    const captureDeterministicUpscale = options.captureDeterministicUpscale === true;
    const frontTopologyAblationEnabled = options.frontTopologyAblation === true;
    const requestedTransferRouteId = String(options.transferRouteId || NATIVE_LOW_TRANSFER_160_TO_128_ZERO_SHOT_ROUTE);
    const learnedCueFeedbackEnabled = options.learnedCueFeedbackEnabled === true;
    const advanceSourceStep = options.advanceSourceStep !== false;
    const deterministicNowMs = Number.isFinite(Number(options.deterministicNowMs)) ? Number(options.deterministicNowMs) : null;
    const fixedNow = deterministicNowMs ?? (Number.isFinite(Number(options.now)) ? Number(options.now) : performance.now());
    const calibration = nativeLowTreatmentSplatCalibrationDebug({
      radianceGain: options.treatmentSplatRadianceGain,
      opacityGain: options.treatmentSplatOpacityGain,
    });
    const startedAt = performance.now();
    const sourceMajorantGrid = majorantGridSize;
    const sourceGrid = gridSize;
    const sourceFrame = state.frameCount;
    const sourceSimStepBefore = state.simStepCount;
    const appliedCueBeforeStep = scalarActivityReceiverDebug();
    try {
      if (!state.active || !device) throw new Error('inactive');
      if (![48, 64, 96, 128].includes(sourceGrid)) throw new Error(`native-low-shared-device-grid-mismatch:${sourceGrid}`);
      if (!['splat-only-v0', 'raymarch-only-v0'].includes(requestedComposition)) {
        throw new Error(`unsupported-native-low-shared-device-composition:${requestedComposition}`);
      }
      cancelAnimationFrame(raf);
      raf = 0;
      if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      const runtime = await ensureNativeLowSelectiveSharedRuntime({ transferRouteId: requestedTransferRouteId, sourceGrid });
      const runtimeBeforeInference = runtime.debugState();

      failurePhase = 'native-low-source-step';
      const nativeStepStart = performance.now();
      if (advanceSourceStep) {
        updateUniforms(fixedNow);
        const nativeEncoder = device.createCommandEncoder({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native ${sourceGrid} source step` });
        encodeSim(nativeEncoder);
        device.queue.submit([nativeEncoder.finish()]);
        if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      }
      const nativeStepMs = performance.now() - nativeStepStart;
      const sourceStep = state.simStepCount;
      const simStepDelta = sourceStep - sourceSimStepBefore;
      const requiredSimStepDelta = advanceSourceStep ? 1 : 0;
      if (simStepDelta !== requiredSimStepDelta) throw new Error(`simulation-not-stepping:${simStepDelta}`);
      const sourceFluid = fluidBuffers[currentFluid];
      const sourceFront = frontBuffers[currentFront];
      const sourceFrameAfter = state.frameCount;
      const computedSourceStepIdentity = `native-low-shared-device-step-${sourceStep}-frame-${sourceFrameAfter}`;
      const expectedSourceStepIdentity = options.expectedSourceStepIdentity ?? null;
      failurePhase = 'native-low-source-step-identity-verification';
      lastTrustworthyEvidence = {
        expectedSourceStepIdentity,
        computedSourceStepIdentity,
        sourceStep,
        nativeStepMs,
      };
      const sourceStepIdentityVerification = verifyExpectedSourceStepIdentity({
        expectedSourceStepIdentity,
        computedSourceStepIdentity,
      });
      const sourceStepIdentity = sourceStepIdentityVerification.effectiveSourceStepIdentity;
      const simulationSteppingReceipt = {
        identity: 'native-low-simulation-stepping-receipt-v0',
        sourceFrameBefore: sourceFrame,
        sourceFrameAfter: state.frameCount,
        sourceSimStepBefore,
        sourceSimStepAfter: sourceStep,
        simStepDelta,
        requiredSimStepDelta,
        advanceSourceStep,
        deterministicNowMs,
        deterministicClockAuthority: deterministicNowMs === null ? null : 'causal-deterministic-step-clock-v0',
        authority: 'renderer-owned-native-source-step-before-model-consumption-v0',
      };
      lastTrustworthyEvidence = {
        sourceStepIdentity,
        expectedSourceStepIdentity,
        computedSourceStepIdentity,
        sourceStepIdentityVerification,
        sourceStep,
        nativeStepMs,
        simulationSteppingReceipt,
      };

      failurePhase = 'shared-device-model-inference';
      const timestampSupported = device.features?.has?.('timestamp-query') && typeof device.createQuerySet === 'function';
      let querySet = null;
      let timestampReadback = null;
      let timestampResolveBuffer = null;
      let timestampWrites = null;
      let stageTimestampWrites = null;
      const timestampQueryCount = 6;
      const candidateCueBufferLifecycleStressEnabled = options.candidateCueBufferLifecycleStressEnabled === true;
      const candidateHeadBenchmarkEnabled = options.candidateHeadBenchmarkEnabled === true || candidateCueBufferLifecycleStressEnabled;
      let candidateQuerySet = null;
      let candidateTimestampReadback = null;
      let candidateTimestampResolveBuffer = null;
      const candidateTimestampQueryCount = 6;
      if (timestampSupported) {
        querySet = device.createQuerySet({ type: 'timestamp', count: timestampQueryCount });
        timestampResolveBuffer = device.createBuffer({
          label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} timestamp resolve`,
          size: timestampQueryCount * BigUint64Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        timestampReadback = device.createBuffer({
          label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} timestamp readback`,
          size: timestampQueryCount * BigUint64Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        timestampWrites = { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
        stageTimestampWrites = {
          sourceDeltaAdmission: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
          supportFront: { querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
          supportPositiveResidual: { querySet, beginningOfPassWriteIndex: 4, endOfPassWriteIndex: 5 },
        };
        if (candidateHeadBenchmarkEnabled) {
          candidateQuerySet = device.createQuerySet({ type: 'timestamp', count: candidateTimestampQueryCount });
          candidateTimestampResolveBuffer = device.createBuffer({
            label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate-head benchmark timestamp resolve`,
            size: candidateTimestampQueryCount * BigUint64Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
          });
          candidateTimestampReadback = device.createBuffer({
            label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} candidate-head benchmark timestamp readback`,
            size: candidateTimestampQueryCount * BigUint64Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          stageTimestampWrites.candidateHeadBenchmark = {
            16: { querySet: candidateQuerySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
            24: { querySet: candidateQuerySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
            32: { querySet: candidateQuerySet, beginningOfPassWriteIndex: 4, endOfPassWriteIndex: 5 },
          };
        }
      }
      const inferenceStart = performance.now();
      device.pushErrorScope('validation');
      const inferenceEncoder = device.createCommandEncoder({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} inference encoder` });
      const historyEpochIdentity = [
        'native-low-source-history-epoch-v0',
        `grid-${sourceGrid}`,
        `majorant-${sourceMajorantGrid}`,
        `scene-${controlsSnapshot.volumeScene || 'unknown'}`,
        `source-reset-${state.nativeLowSourceHistoryEpochCount ?? state.fluidStateResetCount ?? 0}`,
      ].join(':');
      const historyResetReason = state.nativeLowSourceHistoryEpochReason || state.fluidStateResetReason || 'unknown';
      runtime.encodeFromNativeLow(inferenceEncoder, sourceFluid, sourceFront, {
        timestampWrites,
        stageTimestampWrites,
        historyEpochIdentity,
        historyResetReason,
        candidateHeadBenchmarkEnabled,
        candidateCueBufferLifecycleStressEnabled,
      });
      if (querySet && timestampReadback && timestampResolveBuffer) {
        inferenceEncoder.resolveQuerySet(querySet, 0, timestampQueryCount, timestampResolveBuffer, 0);
        inferenceEncoder.copyBufferToBuffer(timestampResolveBuffer, 0, timestampReadback, 0, timestampQueryCount * BigUint64Array.BYTES_PER_ELEMENT);
      }
      if (candidateQuerySet && candidateTimestampReadback && candidateTimestampResolveBuffer) {
        inferenceEncoder.resolveQuerySet(candidateQuerySet, 0, candidateTimestampQueryCount, candidateTimestampResolveBuffer, 0);
        inferenceEncoder.copyBufferToBuffer(
          candidateTimestampResolveBuffer,
          0,
          candidateTimestampReadback,
          0,
          candidateTimestampQueryCount * BigUint64Array.BYTES_PER_ELEMENT,
        );
      }
      device.queue.submit([inferenceEncoder.finish()]);
      if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      const inferenceWallMs = performance.now() - inferenceStart;
      const validationError = await device.popErrorScope();
      if (validationError) throw new Error(`native-low-shared-device-validation:${validationError.message || String(validationError)}`);
      let inferenceTiming = { ms: inferenceWallMs, authority: 'queue-onSubmittedWorkDone-wall-proxy' };
      let nativeLowHeadCostProfile = {
        identity: 'native-low-head-cost-profile-v0',
        headCostTimingAuthority: 'queue-onSubmittedWorkDone-wall-proxy-no-stage-split',
        supportFrontGpuMs: null,
        supportPositiveResidualGpuMs: null,
        sourceDeltaAdmissionGpuMs: null,
        inferenceGpuMs: inferenceWallMs,
      };
      if (timestampReadback) {
        nativeLowHeadCostProfile = await readNativeLowHeadCostProfile(timestampReadback, NATIVE_LOW_SHARED_DEVICE_ROUTE, inferenceWallMs);
        inferenceTiming = {
          ms: Number.isFinite(nativeLowHeadCostProfile.inferenceGpuMs) ? nativeLowHeadCostProfile.inferenceGpuMs : inferenceWallMs,
          authority: nativeLowHeadCostProfile.headCostTimingAuthority,
          label: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        };
        timestampResolveBuffer?.destroy();
        querySet.destroy?.();
        if (!Number.isFinite(inferenceTiming.ms)) inferenceTiming.ms = inferenceWallMs;
      }
      const supportStatsStart = performance.now();
      const supportStats = await runtime.sampleSupportStats();
      const supportStatsMs = performance.now() - supportStatsStart;
      const nativeLowCandidateCueBufferLifecycle = candidateCueBufferLifecycleStressEnabled
        ? await runtime.sampleCandidateCueBufferLifecycle()
        : (runtime.debugState().nativeLowCandidateCueBufferLifecycle || null);
      let nativeLowCandidateHeadCostMicrobenchmark = runtime.debugState().nativeLowCandidateHeadCostMicrobenchmark || null;
      if (candidateHeadBenchmarkEnabled) {
        let candidateTiming = null;
        if (candidateTimestampReadback) {
          candidateTiming = await readNativeLowCandidateHeadCostTimings(candidateTimestampReadback);
          candidateTimestampResolveBuffer?.destroy();
          candidateQuerySet?.destroy?.();
        }
        nativeLowCandidateHeadCostMicrobenchmark = runtime.makeCandidateHeadCostMicrobenchmarkReceipt(
          candidateTiming?.timings || null,
          candidateTiming?.values || [],
        );
        nativeLowCandidateHeadCostMicrobenchmark.sourceDeltaAdmissionGpuMs = nativeLowHeadCostProfile.sourceDeltaAdmissionGpuMs;
      }
      const nativeLowSupportTileProfile = await runtime.sampleSupportTileProfile();
      const nativeLowSourceTileCandidate = await runtime.sampleSourceProximalTileCandidate();
      const runtimeState = runtime.debugState();
      const nativeLowFixedSourceDeltaAdmission = runtimeState.nativeLowFixedSourceDeltaAdmission
        || supportStats.nativeLowFixedSourceDeltaAdmission
        || null;
      const encodedFrameDelta = Number(runtimeState.encodedFrameCount || 0) - Number(runtimeBeforeInference.encodedFrameCount || 0);
      if (encodedFrameDelta !== 1) throw new Error(`repeated-static-prediction:${encodedFrameDelta}`);
      const currentSourceFrameConsumption = {
        identity: 'native-low-current-source-frame-consumption-v0',
        sourceStepIdentity,
        sourceSimStep: sourceStep,
        runtimeEncodedFrameBefore: runtimeBeforeInference.encodedFrameCount || 0,
        runtimeEncodedFrameAfter: runtimeState.encodedFrameCount || 0,
        encodedFrameDelta,
        requiredEncodedFrameDelta: 1,
        currentSourceConsumed: true,
      };
      const stalePredictionRejection = {
        identity: 'native-low-stale-prediction-rejection-v0',
        repeatedStaticPrediction: false,
        stalePrediction: false,
        sourceStepIdentity,
        encodedFrameDelta,
        simulationStepDelta: simStepDelta,
      };
      const nativeLowInferenceWorkProfile = runtimeState.nativeLowInferenceWorkProfile || supportStats.nativeLowInferenceWorkProfile || null;
      nativeLowHeadCostProfile = {
        ...nativeLowHeadCostProfile,
        supportCompactionIdentity: nativeLowInferenceWorkProfile?.supportCompactionIdentity || null,
        residualDispatchMode: nativeLowInferenceWorkProfile?.residualDispatchMode || null,
        sourceDeltaAdmissionGpuMs: nativeLowHeadCostProfile.sourceDeltaAdmissionGpuMs ?? null,
        supportClassifierEvaluatedCount: nativeLowInferenceWorkProfile?.supportClassifierEvaluatedCount ?? null,
        frontTopologyEvaluatedCount: nativeLowInferenceWorkProfile?.frontTopologyEvaluatedCount ?? null,
        supportCompactedCount: nativeLowInferenceWorkProfile?.supportCompactedCount ?? null,
        residualHeadEvaluatedCount: nativeLowInferenceWorkProfile?.residualHeadEvaluatedCount ?? null,
      };
      lastTrustworthyEvidence = { ...lastTrustworthyEvidence, inferenceTiming, supportStats, supportStatsMs, nativeLowSupportTileProfile, nativeLowSourceTileCandidate, nativeLowFixedSourceDeltaAdmission, currentSourceFrameConsumption, stalePredictionRejection };

      let nativeLowPredictedActivityCueProjection = null;
      let learnedCueDiagnosticStats = null;
      let generatedCueFrameId = null;
      if (learnedCueFeedbackEnabled) {
        failurePhase = 'shared-device-learned-cue-feedback-projection';
        if (sourceGrid !== 64) throw new Error(`learnedCueFeedbackSourceGridMismatch:${sourceGrid}`);
        if (requestedTransferRouteId !== NATIVE_LOW_TRANSFER_160_TO_96_DEPLOYMENT_GRID_ROUTE) {
          throw new Error(`learnedCueFeedbackRouteMismatch:${requestedTransferRouteId}`);
        }
        ensureOracleActivityCueBuffer();
        generatedCueFrameId = `learned96:${sourceStepIdentity}:for-step-${sourceStep + 1}`;
        const cueEncoder = device.createCommandEncoder({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} learned activity cue projection` });
        nativeLowPredictedActivityCueProjection = runtime.encodeLearnedFlowActivityCue(
          cueEncoder,
          sourceFluid,
          sourceFront,
          oracleActivityCueBuffer,
          {
          sourceStepIdentity,
          },
        );
        device.queue.submit([cueEncoder.finish()]);
        if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
        if (options.learnedCueFeedbackDiagnosticsEnabled === true) {
          learnedCueDiagnosticStats = await runtime.samplePredictedActivityCueStats(oracleActivityCueBuffer);
        }
        oracleActivityCueSourceValues = null;
        oracleActivityCueSourceGrid = null;
        oracleActivityCueUpload = {
          status: 'gpu-projected',
          requestedCueAuthority: NATIVE64_LEARNED_CUE_AUTHORITY,
          effectiveCueAuthority: NATIVE64_LEARNED_CUE_AUTHORITY,
          projectionIdentity: NATIVE_LOW_LEARNED_FLOW_ACTIVITY_CUE_PROJECTION,
          learnedFlowActivityModelIdentity: NATIVE_LOW_LEARNED_FLOW_ACTIVITY_MODEL_IDENTITY,
          learnedFlowActivityModelSha256: NATIVE_LOW_LEARNED_FLOW_ACTIVITY_MODEL_SHA256,
          grid: sourceGrid,
          receiverGrid: sourceGrid,
          externalCueCellCount: gridCellCount(sourceGrid),
          frameId: generatedCueFrameId,
          generatedFromSourceStep: sourceStep,
          generatedForNextSimulationStep: sourceStep + 1,
          uploadedAtMs: performance.now(),
          runtimeTruthAvailable: false,
          syntheticDownsampleApplied: false,
        };
        state.scalarActivityReceiver = scalarActivityReceiverDebug();
        lastTrustworthyEvidence = {
          ...lastTrustworthyEvidence,
          nativeLowPredictedActivityCueProjection,
          generatedCueFrameId,
          generatedForNextSimulationStep: sourceStep + 1,
          learnedCueDiagnosticStats,
        };
      }

      failurePhase = 'shared-device-treatment-materialization';
      const treatmentMaterializeStart = performance.now();
      const treatmentRebuildStart = performance.now();
      rebuildFluidState(160, sourceMajorantGrid, 'native-low-shared-device-treatment-materialize', { skipInitialFluid: true });
      const treatmentRebuildMs = performance.now() - treatmentRebuildStart;
      const treatmentCopyStart = performance.now();
      const treatmentEncoder = device.createCommandEncoder({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} predicted 160 materialization` });
      for (const target of fluidBuffers) {
        treatmentEncoder.copyBufferToBuffer(runtime.buffers.predictedFluid, 0, target, 0, fluidBufferBytes(160));
      }
      for (const target of frontBuffers) {
        treatmentEncoder.copyBufferToBuffer(runtime.buffers.predictedFront, 0, target, 0, frontFieldBufferBytes(160));
      }
      device.queue.submit([treatmentEncoder.finish()]);
      if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      setSharedDeviceCopiedState(sourceStep, sourceFrameAfter);
      const treatmentCopyMs = performance.now() - treatmentCopyStart;
      const treatmentMaterializeMs = performance.now() - treatmentMaterializeStart;

      failurePhase = 'shared-device-treatment-splat-render';
      const treatmentRenderStart = performance.now();
      const treatmentRender = await renderFrozenScaleToCanvas({
        boundarySplatComposition: requestedComposition,
        now: fixedNow,
        sameStateCaptureId: `${sourceStepIdentity}:treatment`,
        baseFrameCount: sourceFrameAfter,
        baseSimStepCount: sourceStep,
        controlOverrides: {
          nativeLowTreatmentSplatRadianceGain: calibration.effectiveRadianceGain,
          nativeLowTreatmentSplatOpacityGain: calibration.effectiveOpacityGain,
        },
        restoreControls: true,
      });
      if (!treatmentRender?.ok) throw new Error(`native-low-shared-device-treatment-render:${treatmentRender?.reason || 'unknown'}`);
      const treatmentVisualUrl = captureVisuals ? await captureCanvasObjectUrl() : null;
      const treatmentRenderMs = performance.now() - treatmentRenderStart;
      const treatmentSplatCandidateCount = treatmentRender.boundarySplatCandidateCount ?? state.boundarySplatCandidateCount;
      const treatmentSplatInstanceCount = treatmentRender.boundarySplatInstanceCount ?? state.boundarySplatInstanceCount;
      const treatmentSplatOverflowCount = treatmentRender.boundarySplatOverflowCount ?? state.boundarySplatOverflowCount ?? 0;
      let frontTopologyAblatedVisualUrl = null;
      let frontTopologyAblatedRender = null;
      let frontTopologyAblatedMaterializeMs = null;
      let frontTopologyAblatedRebuildMs = null;
      let frontTopologyAblatedCopyMs = null;
      let frontTopologyAblatedRenderMs = null;
      let frontTopologyAblatedSplatCandidateCount = null;
      let frontTopologyAblatedSplatInstanceCount = null;
      let deterministicUpscaleVisualUrl = null;
      let deterministicUpscaleRender = null;
      let deterministicUpscaleMaterializeMs = null;
      let deterministicUpscaleRenderMs = null;
      if (captureDeterministicUpscale) {
        failurePhase = 'shared-device-deterministic-upscale-materialization';
        const deterministicMaterializeStart = performance.now();
        rebuildFluidState(160, sourceMajorantGrid, 'native-low-shared-device-deterministic-upscale-materialize', { skipInitialFluid: true });
        const deterministicEncoder = device.createCommandEncoder({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} deterministic native upsample materialization` });
        for (const target of fluidBuffers) {
          deterministicEncoder.copyBufferToBuffer(runtime.buffers.nativeUpsampleFluid, 0, target, 0, fluidBufferBytes(160));
        }
        for (const target of frontBuffers) {
          deterministicEncoder.copyBufferToBuffer(runtime.buffers.nativeUpsampleFront, 0, target, 0, frontFieldBufferBytes(160));
        }
        device.queue.submit([deterministicEncoder.finish()]);
        if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
        setSharedDeviceCopiedState(sourceStep, sourceFrameAfter);
        deterministicUpscaleMaterializeMs = performance.now() - deterministicMaterializeStart;

        failurePhase = 'shared-device-deterministic-upscale-render';
        const deterministicRenderStart = performance.now();
        deterministicUpscaleRender = await renderFrozenScaleToCanvas({
          boundarySplatComposition: requestedComposition,
          now: fixedNow,
          sameStateCaptureId: `${sourceStepIdentity}:deterministic-upscale`,
          baseFrameCount: sourceFrameAfter,
          baseSimStepCount: sourceStep,
          restoreControls: true,
        });
        if (!deterministicUpscaleRender?.ok) {
          throw new Error(`native-low-shared-device-deterministic-upscale-render:${deterministicUpscaleRender?.reason || 'unknown'}`);
        }
        deterministicUpscaleVisualUrl = captureVisuals ? await captureCanvasObjectUrl() : null;
        deterministicUpscaleRenderMs = performance.now() - deterministicRenderStart;
      }
      if (frontTopologyAblationEnabled) {
        failurePhase = 'shared-device-front-topology-ablation-materialization';
        const ablatedMaterializeStart = performance.now();
        const ablatedRebuildStart = performance.now();
        rebuildFluidState(160, sourceMajorantGrid, 'native-low-shared-device-front-topology-ablation-materialize', { skipInitialFluid: true });
        frontTopologyAblatedRebuildMs = performance.now() - ablatedRebuildStart;
        const ablatedCopyStart = performance.now();
        const ablatedEncoder = device.createCommandEncoder({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} frontTopology ablation materialization` });
        for (const target of fluidBuffers) {
          ablatedEncoder.copyBufferToBuffer(runtime.buffers.predictedFluid, 0, target, 0, fluidBufferBytes(160));
        }
        for (const target of frontBuffers) {
          ablatedEncoder.copyBufferToBuffer(runtime.buffers.nativeUpsampleFront, 0, target, 0, frontFieldBufferBytes(160));
        }
        device.queue.submit([ablatedEncoder.finish()]);
        if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
        setSharedDeviceCopiedState(sourceStep, sourceFrameAfter);
        frontTopologyAblatedCopyMs = performance.now() - ablatedCopyStart;
        frontTopologyAblatedMaterializeMs = performance.now() - ablatedMaterializeStart;

        failurePhase = 'shared-device-front-topology-ablation-render';
        const ablatedRenderStart = performance.now();
        frontTopologyAblatedRender = await renderFrozenScaleToCanvas({
          boundarySplatComposition: requestedComposition,
          now: fixedNow,
          sameStateCaptureId: `${sourceStepIdentity}:frontTopology-ablation`,
          baseFrameCount: sourceFrameAfter,
          baseSimStepCount: sourceStep,
          controlOverrides: {
            nativeLowTreatmentSplatRadianceGain: calibration.effectiveRadianceGain,
            nativeLowTreatmentSplatOpacityGain: calibration.effectiveOpacityGain,
          },
          restoreControls: true,
        });
        if (!frontTopologyAblatedRender?.ok) throw new Error(`native-low-shared-device-frontTopology-ablation-render:${frontTopologyAblatedRender?.reason || 'unknown'}`);
        frontTopologyAblatedVisualUrl = captureVisuals ? await captureCanvasObjectUrl() : null;
        frontTopologyAblatedRenderMs = performance.now() - ablatedRenderStart;
        frontTopologyAblatedSplatCandidateCount = frontTopologyAblatedRender.boundarySplatCandidateCount ?? state.boundarySplatCandidateCount;
        frontTopologyAblatedSplatInstanceCount = frontTopologyAblatedRender.boundarySplatInstanceCount ?? state.boundarySplatInstanceCount;
      }
      lastTrustworthyEvidence = {
        ...lastTrustworthyEvidence,
        treatmentMaterializeMs,
        treatmentRenderMs,
        treatmentSplatCandidateCount,
        treatmentSplatInstanceCount,
        frontTopologyAblatedMaterializeMs,
        frontTopologyAblatedRenderMs,
        frontTopologyAblatedSplatInstanceCount,
        deterministicUpscaleMaterializeMs,
        deterministicUpscaleRenderMs,
      };

      failurePhase = 'shared-device-source-restore';
      const restoreStart = performance.now();
      const restoreRebuildStart = performance.now();
      rebuildFluidState(sourceGrid, sourceMajorantGrid, 'native-low-shared-device-source-restore', { skipInitialFluid: true });
      const restoreRebuildMs = performance.now() - restoreRebuildStart;
      const restoreCopyStart = performance.now();
      const restoreEncoder = device.createCommandEncoder({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} restore ${sourceGrid} source materialization` });
      for (const target of fluidBuffers) {
        restoreEncoder.copyBufferToBuffer(runtime.buffers.lowSnapshotFluid, 0, target, 0, fluidBufferBytes(sourceGrid));
      }
      for (const target of frontBuffers) {
        restoreEncoder.copyBufferToBuffer(runtime.buffers.lowSnapshotFront, 0, target, 0, frontFieldBufferBytes(sourceGrid));
      }
      device.queue.submit([restoreEncoder.finish()]);
      if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      setSharedDeviceCopiedState(sourceStep, sourceFrameAfter);
      const restoreCopyMs = performance.now() - restoreCopyStart;
      const restoreMaterializeMs = performance.now() - restoreStart;

      failurePhase = 'shared-device-control-splat-render';
      const controlRenderStart = performance.now();
      const controlRender = await renderFrozenScaleToCanvas({
        boundarySplatComposition: requestedComposition,
        now: fixedNow,
        sameStateCaptureId: `${sourceStepIdentity}:control`,
        baseFrameCount: sourceFrameAfter,
        baseSimStepCount: sourceStep,
        restoreControls: true,
      });
      if (!controlRender?.ok) throw new Error(`native-low-shared-device-control-render:${controlRender?.reason || 'unknown'}`);
      const controlVisualUrl = captureVisuals ? await captureCanvasObjectUrl() : null;
      const controlRenderMs = performance.now() - controlRenderStart;
      const controlSplatCandidateCount = controlRender.boundarySplatCandidateCount ?? state.boundarySplatCandidateCount;
      const controlSplatInstanceCount = controlRender.boundarySplatInstanceCount ?? state.boundarySplatInstanceCount;
      const controlSplatOverflowCount = controlRender.boundarySplatOverflowCount ?? state.boundarySplatOverflowCount;
      const nativeLowMaterializationProfile = {
        identity: 'native-low-shared-device-materialization-profile-v0',
        transportMode: 'shared-device-gpu-buffers-no-readback-import-v0',
        skipInitialFluid: true,
        hiddenSupportCap: false,
        droppedInputChannels: false,
        treatmentRebuildMs,
        treatmentCopyMs,
        treatmentMaterializeMs,
        restoreRebuildMs,
        restoreCopyMs,
        restoreMaterializeMs,
        treatmentCopyBytes: fluidBufferBytes(160) * 2 + frontFieldBufferBytes(160) * 2,
        restoreCopyBytes: fluidBufferBytes(sourceGrid) * 2 + frontFieldBufferBytes(sourceGrid) * 2,
      };
      if (frontTopologyAblationEnabled) {
        nativeLowMaterializationProfile.frontTopologyAblation = {
          materializeMs: frontTopologyAblatedMaterializeMs,
          rebuildMs: frontTopologyAblatedRebuildMs,
          copyMs: frontTopologyAblatedCopyMs,
          renderMs: frontTopologyAblatedRenderMs,
          copyBytes: fluidBufferBytes(160) * 2 + frontFieldBufferBytes(160) * 2,
        };
      }

      const sameNativeStateIdentity = `${sourceStepIdentity}:model-${runtime.modelSha256}:composition-${requestedComposition}:transport-${NATIVE_LOW_TRANSPORT_MODE}`;
      const candidateInstanceEquality = {
        identity: 'uncapped-candidate-instance-equality-v0',
        candidateCount: treatmentSplatCandidateCount,
        instanceCount: treatmentSplatInstanceCount,
        overflowCount: treatmentSplatOverflowCount,
        equal: treatmentSplatCandidateCount === treatmentSplatInstanceCount,
        overflowZero: treatmentSplatOverflowCount === 0,
        hiddenCandidateCap: false,
      };
      const nativeLowTrainedPackageRoute = {
        ...(runtimeState.nativeLowTrainedPackageRoute || {}),
        identity: 'native-low-trained-package-route-v0',
        requestedTransferRouteId,
        effectiveTransferRouteId: runtimeState.effectiveTransferRouteId || requestedTransferRouteId,
        effectiveSourceGrid: sourceGrid,
        requestedBackend: runtimeState.requestedBackend,
        effectiveBackend: runtimeState.effectiveBackend,
        fallbackBackend: runtimeState.fallbackBackend,
        requestedComposition,
        effectiveComposition: treatmentRender.boundarySplatCompositionEffective,
        modelSpecificTiming: {
          inferenceGpuMs: inferenceTiming.ms,
          uploadDispatchMs: inferenceWallMs,
          endToEndFrameMs: null,
        },
        candidateInstanceEquality,
      };
      const supportPositiveCount = supportStats.supportPositiveCount ?? runtimeState.supportPositiveCount ?? 0;
      const supportPrevalence = supportStats.supportPrevalence ?? runtimeState.supportPrevalence ?? 0;
      const blankTreatmentAttribution = supportPositiveCount <= 0
        ? 'model-support-zero'
        : treatmentSplatInstanceCount <= 0
          ? 'splat-materialization-zero'
          : 'calibration-or-radiance';
      const denseReceiverWriteBytes = nativeLowMaterializationProfile.treatmentCopyBytes;
      const projectedSparseCandidateBytes = Math.max(0, treatmentSplatInstanceCount) * BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES;
      const renderPairMs = treatmentRenderMs + controlRenderMs;
      const endToEndFrameMs = performance.now() - startedAt;
      const projectedWithoutDenseReceiverCopyMs = Math.max(0, endToEndFrameMs - treatmentCopyMs);
      const learnedTransferIncrementalDenseMs = Math.max(0, inferenceTiming.ms + supportStatsMs + nativeLowSupportTileProfile.tileProfileReadbackMs + nativeLowSourceTileCandidate.candidateReadbackMs + treatmentMaterializeMs);
      const learnedTransferDenseMinusDiagnosticReadbackMs = Math.max(
        0,
        learnedTransferIncrementalDenseMs - nativeLowSupportTileProfile.tileProfileReadbackMs - nativeLowSourceTileCandidate.candidateReadbackMs,
      );
      const outerKillBoundaryMs = 24;
      const credibleBreakEvenTargetMs = 15;
      const profitableTargetMs = 10;
      const denseSupportFrontDependencyKilledByBudget = Number(nativeLowHeadCostProfile.supportFrontGpuMs ?? inferenceTiming.ms) > outerKillBoundaryMs;
      const nativeLowCoarseFrontSparseDetailBand = {
        identity: 'native-low-coarse-front-sparse-detail-band-v0',
        authority: 'interpolation-corrected-coarse-front-plus-sparse-temporal-detail-band-v0',
        implementationStatus: 'projection-contract-not-yet-production-route',
        coarseFrontScaffold: {
          identity: 'native-low-coarse-front-scaffold-40^3-trilinear-v0',
          grid: 40,
          reconstruction: 'trilinear-front-reconstruction-v0',
          spatialCorrelation: 0.9875,
          ridgeTop10Recall: 0.7563,
          role: 'broad-placement-scaffold-not-final-front',
          mayServeAsFinalFront: false,
        },
        sparseTemporalDetailBand: {
          identity: 'native-low-sparse-ridge-temporal-detail-band-v0',
          required: true,
          authority: 'concentrated-missing-temporal-detail-energy-v0',
          consecutiveDeltaEnergyRetained: 0.1205,
          top5CellEnergy: 0.9088,
          top10CellEnergy: 0.97,
          selection: 'ridge-or-high-temporal-detail-candidates-v0',
          hiddenDenseReceiverForbidden: true,
        },
        trueCompactCarrierDispatch: {
          required: true,
          currentDenseResidualStageMs: nativeLowHeadCostProfile.supportPositiveResidualGpuMs,
          currentResidualDispatchMode: nativeLowInferenceWorkProfile.residualDispatchMode,
          currentSupportCompactedCount: supportPositiveCount,
          profitableTargetMs,
          credibleBreakEvenTargetMs,
          outerKillBoundaryMs,
        },
        candidatePathScope: {
          includesCoarseScaffold: true,
          includesSparseRidgeTemporalDetailBand: true,
          includesFineSupportGate: true,
          includesTrueCompactCarrierDispatch: true,
          includesDirectRendererCueEmission: true,
          noJsVisibleDenseArrays: true,
          noCpuReadback: true,
          noFull160Materialization: true,
        },
        frozenDenseRouteControl: true,
        nativeNoModelControl: true,
        runtimeDecision: 'coarse-front-alone-rejected-sparse-temporal-detail-band-required',
      };
      const sourceHistoryTargetCoverage = Math.max(0.01, Math.min(0.5, Number(options.sourceHistoryDetailTargetCoverage ?? 0.10)));
      const sourceHistoryCandidateCount = nativeLowFixedSourceDeltaAdmission?.uncappedCandidateCount
        ?? Math.round((160 ** 3) * sourceHistoryTargetCoverage);
      const nativeLowSourceHistoryDetailCandidate = {
        identity: 'native-low-source-history-detail-candidate-v0',
        authority: 'source-visible-full-17-channel-consecutive-delta-envelope-v0',
        sourceVisibleSweepSchema: 'kaminos.pyro.source-visible-sparse-detail-candidate-sweep.v0',
        sourceVisibleSweepSha256: 'a122def1656b833b618669d61c1623ad672246329dd81cf3bfa8a2e363e52140',
        sourceChannelCount: 17,
        sourceHistoryAvailable: nativeLowFixedSourceDeltaAdmission?.sourceHistoryAvailable ?? true,
        candidateCompactionRouteMeasured: true,
        measurementAuthority: nativeLowFixedSourceDeltaAdmission
          ? 'live-fixed-source-delta-gpu-admission-pass-v0'
          : 'live-high-cell-count-and-report-backed-source-delta-envelope-v0',
        measurementStatus: nativeLowFixedSourceDeltaAdmission
          ? 'fixed-gate-gpu-admission-count-active-candidate-head-not-yet-active-treatment'
          : 'candidate-count-live-gpu-compaction-kernel-not-yet-active-treatment',
        targetCoverage: sourceHistoryTargetCoverage,
        candidateCoverage: nativeLowFixedSourceDeltaAdmission?.uncappedCandidateCoverage ?? sourceHistoryCandidateCount / (160 ** 3),
        candidateCount: sourceHistoryCandidateCount,
        highCellCount: 160 ** 3,
        sourceDeltaEnergyCapture: 0.8286,
        transition96To97Capture: 0.8302,
        transition97To98Capture: 0.8271,
        coarseDeltaGradientCapture: 0.716,
        coarseDeltaGradientTransition96To97Capture: 0.7171,
        coarseDeltaGradientTransition97To98Capture: 0.7146,
        supportProbabilityEnergyCapture: 0.205,
        supportProbabilityAdmission: false,
        detailAdmissionSwitches: {
          sourceHistoryDetailAdmissionEnabled: options.sourceHistoryDetailAdmissionEnabled !== false,
          supportCarrierDispatchIndependent: true,
          coarseFrontScaffoldIndependent: true,
          supportProbabilityDetailAdmissionEnabled: options.supportProbabilityDetailAdmissionEnabled === true,
          coarseFrontDetailAdmissionEnabled: options.coarseFrontDetailAdmissionEnabled !== false,
        },
        runtimeTruthUsed: false,
        targetErrorRankingUsed: false,
        activeTreatmentPath: false,
        selectedNextImplementation: 'gpu-source-history-envelope-compaction-kernel-plus-sparse-detail-head',
      };
      const nativeLowBreakEvenBudgetLedger = {
        identity: 'native-low-learned-transfer-break-even-ledger-v0',
        authority: 'operator-corrected-native160-minus-native128-economics-v0',
        comparison: 'native-128-step-plus-learned-transfer-vs-native-160-step',
        native160StepMsCommon: 24,
        native160StepMsObservedRange: [24, 40],
        native128StepMsCommon: 16.5,
        native128StepMsObservedRange: [16, 17],
        incrementalAdvantageWindowMs: {
          commonEstimate: 7.5,
          fuzzyRange: [7, 23],
        },
        outerKillBoundaryMs,
        credibleBreakEvenTargetMs,
        profitableTargetMs,
        dense278MbRouteDisposition: 'fidelity-control-only-not-production-candidate',
        gpuResidentDirectSparseRequirement: {
          required: true,
          reuseExistingSupportFrontAuthority: true,
          compactActiveOrSupportAdjacentCellsOrTiles: true,
          smallestViableF16HeadRequired: true,
          emitCompactSplatRendererCuesDirectly: true,
          noJsVisibleDenseArrays: true,
          noCpuReadback: true,
          noFull160Materialization: true,
        },
        currentDenseRouteMeasuredIncrementalMs: learnedTransferIncrementalDenseMs,
        currentDenseRouteMinusDiagnosticReadbackMs: learnedTransferDenseMinusDiagnosticReadbackMs,
        currentDenseRouteStagesMs: {
          sourceDeltaAdmissionGpuMs: nativeLowHeadCostProfile.sourceDeltaAdmissionGpuMs,
          supportSelectionCompactionAndFrontGpuMs: nativeLowHeadCostProfile.supportFrontGpuMs,
          supportPositiveResidualGpuMs: nativeLowHeadCostProfile.supportPositiveResidualGpuMs,
          inferenceGpuMs: inferenceTiming.ms,
          supportStatsReadbackMs: supportStatsMs,
          supportTileReadbackMs: nativeLowSupportTileProfile.tileProfileReadbackMs,
          sourceTileCandidateReadbackMs: nativeLowSourceTileCandidate.candidateReadbackMs,
          receiverDecodeWriteMs: treatmentMaterializeMs,
          receiverCopyMs: treatmentCopyMs,
        },
        candidatePathScope: {
          excludesOrdinaryLowGridSim: true,
          excludesCommonRendererOnlyIfIdentical: true,
          includesSupportSelectionCompaction: true,
          includesInference: true,
          includesReceiverDecodeWrite: true,
          includesSynchronizationAndReadback: true,
        },
        denseSupportFrontDependencyKilledByBudget,
        skeletonPlausibleUnder24ms: !denseSupportFrontDependencyKilledByBudget && learnedTransferDenseMinusDiagnosticReadbackMs <= outerKillBoundaryMs,
        skeletonPlausibleUnder15ms: !denseSupportFrontDependencyKilledByBudget && learnedTransferDenseMinusDiagnosticReadbackMs <= credibleBreakEvenTargetMs,
        skeletonPlausibleUnder10ms: !denseSupportFrontDependencyKilledByBudget && learnedTransferDenseMinusDiagnosticReadbackMs <= profitableTargetMs,
        decision: denseSupportFrontDependencyKilledByBudget
          ? 'architecture-anti-evidence-dense-support-front-alone-exceeds-24ms-kill-boundary'
          : learnedTransferDenseMinusDiagnosticReadbackMs > outerKillBoundaryMs
            ? 'architecture-anti-evidence-current-skeleton-exceeds-24ms-kill-boundary'
            : 'budget-plausible-requires-direct-sparse-implementation',
        selectedNextArchitecture: denseSupportFrontDependencyKilledByBudget
          ? 'smallest-viable-f16-sparse-head-or-native-low-adapter-required'
          : 'gpu-resident-direct-sparse-output-candidate',
      };
      const nativeLowProductionStageLedger = {
        identity: 'native-low-production-stage-ledger-v0',
        authority: 'measured-live-shared-device-stage-ledger-with-sparse-output-projection-v0',
        routeIdentity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        frozenDenseRouteControl: {
          retained: true,
          role: 'frozen-dense-route-control',
          modelIdentity: runtimeState.modelIdentity,
          modelSha256: runtimeState.modelSha256,
          denseReceiverMaterialized: true,
          denseReceiverWriteBytes,
        },
        debugManifestTransportExcluded: {
          excluded: true,
          manifestFetchMs: 0,
          authority: 'live-route-no-manifest-fetch-v0',
        },
        denseReceiverWriteBytes,
        measuredInteractiveBasinProjection: {
          identity: 'native-low-measured-interactive-basin-projection-v0',
          projectionAuthority: 'measured-current-frame-minus-projected-dense-receiver-copy-v0',
          currentMeasuredFrameMs: endToEndFrameMs,
          currentMeasuredFrameHz: endToEndFrameMs > 0 ? 1000 / endToEndFrameMs : null,
          productionWithoutDebugManifestFetchMs: endToEndFrameMs,
          denseInferenceRetainedMs: inferenceTiming.ms,
          sourceDeltaAdmissionRetainedMs: nativeLowHeadCostProfile.sourceDeltaAdmissionGpuMs,
          denseSupportFrontRetainedMs: nativeLowHeadCostProfile.supportFrontGpuMs,
          denseResidualRetainedMs: nativeLowHeadCostProfile.supportPositiveResidualGpuMs,
          denseReceiverMaterializationRetainedMs: treatmentMaterializeMs,
          denseReceiverCopyRetainedMs: treatmentCopyMs,
          restoreMaterializationRetainedMs: restoreMaterializeMs,
          renderPairMs,
          projectedWithoutDenseReceiverCopyMs,
          projectedWithoutDenseReceiverCopyHz: projectedWithoutDenseReceiverCopyMs > 0 ? 1000 / projectedWithoutDenseReceiverCopyMs : null,
          interactiveBasinMs60Hz: 16.67,
          interactiveBasinMs30Hz: 33.34,
          conclusion: projectedWithoutDenseReceiverCopyMs <= 33.34
            ? 'projection-near-interactive-only-after-dense-write-removal-still-unimplemented'
            : 'not-interactive-even-after-dense-write-removal-projection',
        },
        dense160ReceiverWriteAvoidanceCandidate: {
          identity: 'direct-sparse-learned-splat-substrate-candidate-v0',
          status: 'projection-not-implemented',
          supportPositiveCount,
          treatmentSplatInstanceCount,
          candidateStrideBytes: BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES,
          projectedSparseCandidateBytes,
          avoidedDenseReceiverWriteBytesLowerBound: Math.max(0, denseReceiverWriteBytes - projectedSparseCandidateBytes),
          projectionAuthority: 'measured-splat-count-times-current-candidate-stride-v0',
        },
        supportProximalTileProjection: {
          identity: nativeLowSupportTileProfile.identity,
          diagnosticFullSupportPassRequired: nativeLowSupportTileProfile.diagnosticFullSupportPassRequired,
          supportCentroid: nativeLowSupportTileProfile.supportCentroid,
          supportExtent: nativeLowSupportTileProfile.supportExtent,
          activeTileCount: nativeLowSupportTileProfile.activeTileCount,
          activeTileCoverage: nativeLowSupportTileProfile.activeTileCoverage,
          projectedSupportFrontCellCount: nativeLowSupportTileProfile.projectedSupportFrontCellCount,
          projectedCellReduction: nativeLowSupportTileProfile.projectedCellReduction,
          tileProfileReadbackMs: nativeLowSupportTileProfile.tileProfileReadbackMs,
        },
        sourceProximalTileCandidate: {
          identity: nativeLowSourceTileCandidate.identity,
          authority: nativeLowSourceTileCandidate.authority,
          candidateEvaluationMode: nativeLowSourceTileCandidate.candidateEvaluationMode,
          diagnosticFullDenseSupportPassRequired: nativeLowSourceTileCandidate.diagnosticFullDenseSupportPassRequired,
          sourceFrontThreshold: nativeLowSourceTileCandidate.sourceFrontThreshold,
          sourceTileDilation: nativeLowSourceTileCandidate.sourceTileDilation,
          candidateTileCount: nativeLowSourceTileCandidate.candidateTileCount,
          projectedCandidateCellCount: nativeLowSourceTileCandidate.projectedCandidateCellCount,
          supportMissedByCandidateCount: nativeLowSourceTileCandidate.supportMissedByCandidateCount,
          supportMissRate: nativeLowSourceTileCandidate.supportMissRate,
          candidateCapturesAllDenseSupport: nativeLowSourceTileCandidate.candidateCapturesAllDenseSupport,
          hiddenSupportCap: nativeLowSourceTileCandidate.hiddenSupportCap,
        },
        learnedTransferBreakEven: nativeLowBreakEvenBudgetLedger,
        coarseFrontSparseDetailBand: nativeLowCoarseFrontSparseDetailBand,
        sourceHistoryDetailCandidate: nativeLowSourceHistoryDetailCandidate,
        candidateHeadCostMicrobenchmark: nativeLowCandidateHeadCostMicrobenchmark,
        candidateCueBufferLifecycle: nativeLowCandidateCueBufferLifecycle,
        simulationSteppingReceipt,
        currentSourceFrameConsumption,
        stalePredictionRejection,
      };
      const nativeLowFrontTopologyAblation = frontTopologyAblationEnabled
        ? {
            identity: 'native-low-front-topology-ablation-v0',
            authority: 'shared-device-same-source-visual-ablation-v0',
            sameSourceStepIdentity: sourceStepIdentity,
            sameNativeStateIdentity,
            offlineImporterUsed: false,
            requestedComposition,
            effectiveComposition: frontTopologyAblatedRender?.boundarySplatCompositionEffective || null,
            nativeLowControl: {
              role: 'nativeLowControl',
              authority: 'untouched-native-low-128-control-v0',
              splatInstanceCount: controlSplatInstanceCount,
            },
            fullFrozenTreatmentReference: {
              role: 'fullFrozenTreatmentReference',
              authority: 'frozen-dense-support-front-plus-carrier-reference-v0',
              learnedSupportApplied: true,
              learnedFrontTopologyResidualApplied: true,
              learnedCarrierResidualsApplied: true,
              splatInstanceCount: treatmentSplatInstanceCount,
            },
            frontTopologyAblatedTreatment: {
              role: 'frontTopologyAblatedTreatment',
              authority: 'native-low-nearest-normalized-front-upsampling-no-learned-front-residual-v0',
              learnedSupportAndCarrierResidualsRetained: true,
              learnedSupportApplied: true,
              learnedFuelResidualApplied: true,
              learnedVisibleFireCarrierResidualApplied: true,
              learnedFireLickResidualApplied: true,
              learnedFrontTopologyResidualApplied: false,
              nativeUpsampleFrontApplied: true,
              splatInstanceCount: frontTopologyAblatedSplatInstanceCount,
            },
            frontTopologyVisualDecision: 'requires-visual-inspection-v0',
            frontTopologyLoadBearing: null,
            decisionAuthority: 'operator-or-agent-visual-inspection-required-v0',
          }
        : null;
      const receipt = {
        ok: true,
        status: 'captured',
        identity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        routeIdentity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        transportMode: 'shared-device-gpu-buffers-no-readback-import-v0',
        inputAuthority: NATIVE_LOW_INPUT_AUTHORITY,
        sourceStepIdentity,
        expectedSourceStepIdentity,
        computedSourceStepIdentity,
        sourceStepIdentityVerification,
        sameNativeStateIdentity,
        sourceStep,
        sourceSimStepBefore,
        controlStep: sourceStep,
        treatmentStep: sourceStep,
        simulationSteppingReceipt,
        currentSourceFrameConsumption,
        stalePredictionRejection,
        learnedCueFeedbackEnabled,
        learnedCueAuthority: learnedCueFeedbackEnabled ? NATIVE64_LEARNED_CUE_AUTHORITY : null,
        learnedCueProjectionIdentity: learnedCueFeedbackEnabled ? NATIVE_LOW_LEARNED_FLOW_ACTIVITY_CUE_PROJECTION : null,
        learnedFlowActivityModelIdentity: learnedCueFeedbackEnabled ? NATIVE_LOW_LEARNED_FLOW_ACTIVITY_MODEL_IDENTITY : null,
        learnedFlowActivityModelSha256: learnedCueFeedbackEnabled ? NATIVE_LOW_LEARNED_FLOW_ACTIVITY_MODEL_SHA256 : null,
        appliedCueFrameId: appliedCueBeforeStep.frameId || null,
        appliedCueAuthority: appliedCueBeforeStep.effectiveCueAuthority || null,
        appliedCueReceiver: appliedCueBeforeStep,
        generatedCueFrameId,
        generatedForNextSimulationStep: learnedCueFeedbackEnabled ? sourceStep + 1 : null,
        nativeLowPredictedActivityCueProjection,
        learnedCueDiagnosticStats,
        runtimeTruthAvailable: false,
        syntheticDownsampleApplied: false,
        sourceStepDrift: null,
        controlTreatmentCausalDivergence: null,
        requestedComposition,
        effectiveComposition: treatmentRender.boundarySplatCompositionEffective,
        compositionMismatch: treatmentRender.boundarySplatCompositionEffective !== requestedComposition ? 'compositionMismatch' : null,
        requestedTransferRouteId,
        effectiveTransferRouteId: runtimeState.effectiveTransferRouteId || requestedTransferRouteId,
        nativeLowTrainedPackageRoute: {
          ...nativeLowTrainedPackageRoute,
          modelSpecificTiming: {
            ...nativeLowTrainedPackageRoute.modelSpecificTiming,
            endToEndFrameMs,
          },
        },
        candidateInstanceEquality,
        requestedBackend: runtimeState.requestedBackend,
        effectiveBackend: runtimeState.effectiveBackend,
        fallbackBackend: runtimeState.fallbackBackend,
        modelIdentity: runtimeState.modelIdentity,
        modelSha256: runtimeState.modelSha256,
        featureAuthority: runtimeState.featureAuthority,
        effectiveFeatureCount: runtimeState.effectiveFeatureCount,
        noHiddenCaps: runtimeState.noHiddenCaps,
        nativeLowInferenceWorkProfile,
        nativeLowHeadCostProfile,
        nativeLowSupportTileProfile,
        nativeLowSourceTileCandidate,
        supportPositiveCount,
        supportPrevalence,
        treatmentSplatCandidateCount,
        treatmentSplatInstanceCount,
        controlSplatCandidateCount,
        controlSplatInstanceCount,
        controlSplatOverflowCount,
        calibrationGain: calibration.calibrationGain,
        calibrationAuthority: calibration.authority,
        requestedCalibration: calibration.requestedCalibration,
        effectiveCalibration: calibration.effectiveCalibration,
        requestedRadianceGain: calibration.requestedRadianceGain,
        effectiveRadianceGain: calibration.effectiveRadianceGain,
        requestedOpacityGain: calibration.requestedOpacityGain,
        effectiveOpacityGain: calibration.effectiveOpacityGain,
        treatmentSplatRadianceGain: calibration.treatmentSplatRadianceGain,
        treatmentSplatOpacityGain: calibration.treatmentSplatOpacityGain,
        modelOutputMutation: false,
        nativeLowTreatmentSplatCalibration: calibration,
        blankTreatmentAttribution,
        inferenceGpuMs: inferenceTiming.ms,
        inferenceTimingAuthority: inferenceTiming.authority,
        headCostTimingAuthority: nativeLowHeadCostProfile.headCostTimingAuthority,
        uploadDispatchMs: inferenceWallMs,
        nativeStepMs,
        supportStatsMs,
        treatmentMaterializeMs,
        treatmentRebuildMs,
        treatmentCopyMs,
        treatmentRenderMs,
        restoreMaterializeMs,
        restoreRebuildMs,
        restoreCopyMs,
        controlRenderMs,
        nativeLowMaterializationProfile,
        nativeLowProductionStageLedger,
        nativeLowBreakEvenBudgetLedger,
        nativeLowCoarseFrontSparseDetailBand,
        nativeLowSourceHistoryDetailCandidate,
        nativeLowCandidateHeadCostMicrobenchmark,
        nativeLowCandidateCueBufferLifecycle,
        nativeLowFixedSourceDeltaAdmission,
        nativeLowFrontTopologyAblation,
        frontTopologyAblationEnabled,
        frontTopologyAblatedSplatCandidateCount,
        frontTopologyAblatedSplatInstanceCount,
        frontTopologyAblatedMaterializeMs,
        frontTopologyAblatedRenderMs,
        deterministicUpscaleMaterializeMs,
        deterministicUpscaleRenderMs,
        endToEndFrameMs,
        stageTiming: {
          nativeStepMs,
          inferenceGpuMs: inferenceTiming.ms,
          inferenceTimingAuthority: inferenceTiming.authority,
          supportFrontGpuMs: nativeLowHeadCostProfile.supportFrontGpuMs,
          supportPositiveResidualGpuMs: nativeLowHeadCostProfile.supportPositiveResidualGpuMs,
          headCostTimingAuthority: nativeLowHeadCostProfile.headCostTimingAuthority,
          uploadDispatchMs: inferenceWallMs,
          supportStatsMs,
          treatmentRebuildMs,
          treatmentCopyMs,
          treatmentMaterializeMs,
          treatmentRenderMs,
          frontTopologyAblatedMaterializeMs,
          frontTopologyAblatedRenderMs,
          deterministicUpscaleMaterializeMs,
          deterministicUpscaleRenderMs,
          restoreRebuildMs,
          restoreCopyMs,
          restoreMaterializeMs,
          controlRenderMs,
        },
        visuals: {
          controlObjectUrl: controlVisualUrl,
          treatmentObjectUrl: treatmentVisualUrl,
          deterministicUpscaleObjectUrl: deterministicUpscaleVisualUrl,
          frontTopologyAblatedObjectUrl: frontTopologyAblatedVisualUrl,
        },
        nativeLowControl: { grid: sourceGrid, step: sourceStep, backend: runtimeState.effectiveBackend, splatInstanceCount: controlSplatInstanceCount },
        fullFrozenTreatmentReference: { grid: 160, step: sourceStep, backend: runtimeState.effectiveBackend, splatInstanceCount: treatmentSplatInstanceCount },
        frontTopologyAblatedTreatment: frontTopologyAblationEnabled
          ? { grid: 160, step: sourceStep, backend: runtimeState.effectiveBackend, splatInstanceCount: frontTopologyAblatedSplatInstanceCount }
          : null,
        treatmentRender,
        deterministicUpscaleRender,
        frontTopologyAblatedRender,
        controlRender,
        runtime: runtimeState,
        failurePhase: null,
        lastTrustworthyEvidence,
      };
      state.nativeLowSelectiveSharedDevice = receipt;
      state.nativeLowTreatmentSplatCalibration = calibration;
      return receipt;
    } catch (error) {
      const failed = {
        ok: false,
        status: 'failed',
        identity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        routeIdentity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        transportMode: 'shared-device-gpu-buffers-no-readback-import-v0',
        failurePhase,
        errorCode: error?.code || null,
        expectedSourceStepIdentity: error?.expectedSourceStepIdentity ?? lastTrustworthyEvidence.expectedSourceStepIdentity ?? null,
        computedSourceStepIdentity: error?.computedSourceStepIdentity ?? lastTrustworthyEvidence.computedSourceStepIdentity ?? null,
        error: error?.message || String(error),
        lastTrustworthyEvidence,
      };
      state.nativeLowSelectiveSharedDevice = failed;
      return failed;
    }
  }

  async function sampleDeterministicReplayFrame(options = {}) {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    const requestedSteps = Math.floor(Number(options.steps));
    const steps = Number.isFinite(requestedSteps) && requestedSteps > 0 ? requestedSteps : 1;
    const timeStepMs = Number.isFinite(Number(options.timeStepMs)) ? Number(options.timeStepMs) : 1000 / 60;
    const startTimeMs = Number.isFinite(Number(options.startTimeMs)) ? Number(options.startTimeMs) : 1000;
    cancelAnimationFrame(raf);
    if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();

    const controlsBefore = { ...controlsSnapshot };
    controlsSnapshot = applyRuntimeQualityControls({
      ...controlsSnapshot,
      boundarySidecarSource: 'live',
      boundarySplatMode: 'off',
      lookFreeze: 0,
      temporalAccum: 0,
      temporalJitter: 0,
    });
    rebuildFluidState(gridSize, majorantGridSize, 'deterministic-replay-reset');
    state.frameCount = 0;
    state.lookFreezeFrame = null;
    state.lookFreezeRenderTimeMs = null;
    state.lookFreezeRenderFrame = null;

    for (let step = 0; step < steps; step += 1) {
      const now = startTimeMs + step * timeStepMs;
      updateUniforms(now);
      const encoder = device.createCommandEncoder({ label: `kaminos deterministic replay step ${step + 1}/${steps}` });
      encodeSim(encoder);
      if (step === steps - 1) encodeMajorant(encoder, { force: true });
      device.queue.submit([encoder.finish()]);
      state.frameCount += 1;
    }
    if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    if (gridSize === 160) {
      selectiveHeadLiveRuntime = await createSelectiveHeadLiveRuntime({
        device,
        sourceFluidBuffers: fluidBuffers,
        sourceFrontBuffers: frontBuffers,
      });
      rebuildSelectiveHeadLiveBindGroups();
      state.selectiveHeadLive = selectiveHeadLiveRuntime.debugState();
    }
    if (options.restoreControls === true) {
      controlsSnapshot = applyRuntimeQualityControls(controlsBefore);
      updateUniforms(startTimeMs + steps * timeStepMs);
    }
    return {
      ok: true,
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      authority: 'same-route-controls-fixed-step-replay',
      resetReason: 'deterministic-replay-reset',
      requestedSteps: steps,
      completedSteps: state.simStepCount,
      timeStepMs,
      startTimeMs,
      finalTimeMs: startTimeMs + Math.max(0, steps - 1) * timeStepMs,
      controlsSignature: temporalControlSignature(controlsSnapshot),
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      grid: gridSize,
      majorantGrid: majorantGridSize,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
      selectiveHeadLiveModelIdentity: selectiveHeadLiveRuntime?.modelIdentity || null,
      controlsRestored: options.restoreControls === true,
    };
  }

  function decodeBoundarySidecarChunk(base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function beginDebugBoundarySidecarOverride(payload = {}) {
    const requestedGrid = Number(payload.grid);
    const expectedByteLength = boundarySidecarBufferBytes(gridSize);
    const byteLength = Number(payload.byteLength);
    if (requestedGrid !== gridSize) {
      return { ok: false, reason: 'grid-mismatch', requestedGrid, effectiveGrid: gridSize };
    }
    if (byteLength !== expectedByteLength) {
      return { ok: false, reason: 'byte-length-mismatch', requestedByteLength: byteLength, expectedByteLength };
    }
    if (!payload.boundarySidecarSha256 || !payload.sourceManifestSha256 || !payload.role) {
      return { ok: false, reason: 'missing-source-identity' };
    }
    const sessionId = globalThis.crypto?.randomUUID?.() || `boundary-sidecar-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    boundarySidecarOverrideUpload = {
      sessionId,
      role: String(payload.role),
      grid: requestedGrid,
      byteLength,
      boundarySidecarSha256: String(payload.boundarySidecarSha256),
      sourceManifestPath: String(payload.sourceManifestPath || ''),
      sourceManifestSha256: String(payload.sourceManifestSha256),
      sourceKind: String(payload.sourceKind || 'unknown'),
      packIdentity: payload.packIdentity == null ? null : String(payload.packIdentity),
      bytes: new Uint8Array(byteLength),
      receivedBytes: 0,
      chunkCount: 0,
    };
    state.boundarySidecarOverrideReceipt = {
      identity: EXTERNAL_BOUNDARY_SIDECAR_UPLOAD_IDENTITY,
      status: 'receiving',
      sessionId,
      role: boundarySidecarOverrideUpload.role,
      grid: requestedGrid,
      byteLength,
      receivedBytes: 0,
      sourceManifestPath: boundarySidecarOverrideUpload.sourceManifestPath,
      sourceManifestSha256: boundarySidecarOverrideUpload.sourceManifestSha256,
      sourceKind: boundarySidecarOverrideUpload.sourceKind,
      packIdentity: boundarySidecarOverrideUpload.packIdentity,
      boundarySidecarSha256: boundarySidecarOverrideUpload.boundarySidecarSha256,
    };
    return { ok: true, ...state.boundarySidecarOverrideReceipt };
  }

  function writeDebugBoundarySidecarOverrideChunk(payload = {}) {
    if (!boundarySidecarOverrideUpload || payload.sessionId !== boundarySidecarOverrideUpload.sessionId) {
      return { ok: false, reason: 'unknown-session' };
    }
    const byteOffset = Number(payload.byteOffset);
    if (byteOffset !== boundarySidecarOverrideUpload.receivedBytes) {
      return {
        ok: false,
        reason: 'non-sequential-chunk',
        requestedByteOffset: byteOffset,
        expectedByteOffset: boundarySidecarOverrideUpload.receivedBytes,
      };
    }
    const chunk = decodeBoundarySidecarChunk(payload.base64);
    if (byteOffset + chunk.byteLength > boundarySidecarOverrideUpload.byteLength) {
      return { ok: false, reason: 'chunk-overflow' };
    }
    boundarySidecarOverrideUpload.bytes.set(chunk, byteOffset);
    boundarySidecarOverrideUpload.receivedBytes += chunk.byteLength;
    boundarySidecarOverrideUpload.chunkCount += 1;
    state.boundarySidecarOverrideReceipt = {
      ...state.boundarySidecarOverrideReceipt,
      receivedBytes: boundarySidecarOverrideUpload.receivedBytes,
      chunkCount: boundarySidecarOverrideUpload.chunkCount,
    };
    return {
      ok: true,
      sessionId: boundarySidecarOverrideUpload.sessionId,
      receivedBytes: boundarySidecarOverrideUpload.receivedBytes,
      chunkCount: boundarySidecarOverrideUpload.chunkCount,
    };
  }

  async function finishDebugBoundarySidecarOverride(payload = {}) {
    if (!boundarySidecarOverrideUpload || payload.sessionId !== boundarySidecarOverrideUpload.sessionId) {
      return { ok: false, reason: 'unknown-session' };
    }
    const upload = boundarySidecarOverrideUpload;
    if (upload.receivedBytes !== upload.byteLength) {
      return { ok: false, reason: 'partial-upload', receivedBytes: upload.receivedBytes, expectedBytes: upload.byteLength };
    }
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', upload.bytes));
    const actualSha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (actualSha256 !== upload.boundarySidecarSha256) {
      state.boundarySidecarOverrideReceipt = {
        ...state.boundarySidecarOverrideReceipt,
        status: 'rejected',
        failureReason: 'sha256-mismatch',
        actualSha256,
      };
      boundarySidecarOverrideUpload = null;
      return { ok: false, reason: 'sha256-mismatch', actualSha256, expectedSha256: upload.boundarySidecarSha256 };
    }
    await ensureGpu();
    ensureBoundarySidecarBuffer();
    device.queue.writeBuffer(boundarySidecarBuffer, 0, upload.bytes);
    controlsSnapshot = applyRuntimeQualityControls({ ...controlsSnapshot, boundarySidecarSource: 'override' });
    state.boundarySidecarSource = 'override';
    state.boundaryStructureSource = 'override';
    state.boundarySidecarAuthority = EXTERNAL_BOUNDARY_SIDECAR_AUTHORITY;
    state.boundarySidecarBuilt = true;
    state.boundarySidecarBuiltThisFrame = true;
    state.boundarySidecarOverrideReceipt = {
      identity: EXTERNAL_BOUNDARY_SIDECAR_UPLOAD_IDENTITY,
      status: 'applied',
      sessionId: upload.sessionId,
      role: upload.role,
      grid: upload.grid,
      byteLength: upload.byteLength,
      receivedBytes: upload.receivedBytes,
      chunkCount: upload.chunkCount,
      sourceManifestPath: upload.sourceManifestPath,
      sourceManifestSha256: upload.sourceManifestSha256,
      sourceKind: upload.sourceKind,
      packIdentity: upload.packIdentity,
      boundarySidecarSha256: upload.boundarySidecarSha256,
      actualSha256,
      appliedAtFrameCount: state.frameCount,
      appliedAtSimStepCount: state.simStepCount,
      authority: EXTERNAL_BOUNDARY_SIDECAR_AUTHORITY,
    };
    boundarySidecarOverrideUpload = null;
    state.boundarySidecarDebug = boundarySidecarDebug('override');
    return { ok: true, ...state.boundarySidecarOverrideReceipt };
  }

  return {
    setControls(next) {
      const previousGrid = gridSize;
      const previousMajorantGrid = majorantGridSize;
      const previousControlSignature = lastTemporalControlSignature || temporalControlSignature(controlsSnapshot);
      const previousCanonicalSourceControlSignature = canonicalSourceControlSignature(controlsSnapshot);
      controlsSnapshot = applyRuntimeQualityControls({ ...controlsSnapshot, ...next });
      const nextControlSignature = temporalControlSignature(controlsSnapshot);
      const nextCanonicalSourceControlSignature = canonicalSourceControlSignature(controlsSnapshot);
      if (previousControlSignature !== nextControlSignature) {
        resetTemporalHistory('control-change');
      }
      lastTemporalControlSignature = nextControlSignature;
      const requestedGrid = normalizeGridSize(controlsSnapshot.resolution);
      const requestedMajorantGrid = normalizeMajorantGridSize(controlsSnapshot.majorantGrid);
      const sourceStateResetNeeded = device
        && requestedGrid === previousGrid
        && requestedMajorantGrid === previousMajorantGrid
        && normalizeVolumeScene(controlsSnapshot.volumeScene) === 'canonical_plume'
        && previousCanonicalSourceControlSignature !== nextCanonicalSourceControlSignature;
      if (device && (requestedGrid !== previousGrid || requestedMajorantGrid !== previousMajorantGrid)) {
        rebuildFluidState(requestedGrid, requestedMajorantGrid);
      } else if (sourceStateResetNeeded) {
        rebuildFluidState(requestedGrid, requestedMajorantGrid, 'canonical-source-control-change');
      } else {
        gridSize = requestedGrid;
        majorantGridSize = requestedMajorantGrid;
        state.simGrid = gridSize;
        state.simGridLabel = `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer+${FRONT_FIELD_IDENTITY}`;
        state.frontFieldIdentity = FRONT_FIELD_IDENTITY;
        state.frontFieldBytes = frontFieldBufferBytes(gridSize);
        state.frontFieldReadIndex = currentFront;
        state.frontFieldWriteIndex = 1 - currentFront;
        state.majorantGrid = majorantGridSize;
      }
      state.gridOverlay = controlsSnapshot.gridOverlay || 0;
      state.lookFreeze = normalizeLookFreeze(controlsSnapshot.lookFreeze);
      state.pyroCompareMode = normalizePyroCompareMode(controlsSnapshot.pyroCompareMode);
      state.volumeScene = normalizeVolumeScene(controlsSnapshot.volumeScene);
      state.bonfireReferenceConfinement = bonfireReferenceConfinementDebug(controlsSnapshot.volumeScene);
      state.minimalPlumeProof = minimalPlumeProofDebug(controlsSnapshot.volumeScene);
      state.adaptiveRaymarch = controlsSnapshot.adaptiveRays ?? 0.65;
      state.occupancySkip = controlsSnapshot.occupancySkip ?? 0.35;
      state.majorantSkip = controlsSnapshot.majorantSkip ?? 0.70;
      state.majorantSmooth = controlsSnapshot.majorantSmooth ?? 0.85;
      state.majorantGuard = controlsSnapshot.majorantGuard ?? 0.75;
      state.temporalAccum = Math.max(0, Math.min(0.85, controlsSnapshot.temporalAccum ?? 0.25));
      state.temporalJitter = controlsSnapshot.temporalJitter ?? 0.85;
      state.historyClamp = controlsSnapshot.historyClamp ?? 0.70;
      state.fireScale = Math.max(0.35, Math.min(1.3, controlsSnapshot.fireScale ?? 0.86));
      state.detailScale = Math.max(0.45, Math.min(3.2, controlsSnapshot.detailScale ?? 1.75));
      state.detailScaleArtifactQuarantine = detailScaleArtifactQuarantine(controlsSnapshot.volumeScene);
      state.visibleDetailOverlayGain = state.detailScaleArtifactQuarantine ? 0.35 : 1;
      state.reactionFuelScale = normalizeReactionFuelScale(controlsSnapshot.reactionFuelScale);
      state.lifecycleEffect = normalizeLifecycleEffect(controlsSnapshot.lifecycleEffect);
      state.lifecycleT = normalizeLifecycleT(controlsSnapshot.lifecycleT);
      state.quenchVapor = normalizeQuenchVapor(controlsSnapshot.quenchVapor);
      state.quenchVaporStrength = snuffQuenchVaporStrength(controlsSnapshot);
      state.snuffVisualModel = state.quenchVaporStrength > 0 ? 'quench-vapor-v0' : 'inactive';
      state.flameQuenchModel = state.quenchVaporStrength > 0 ? 'quench-flame-body-v0' : 'inactive';
      const controlsLookFreeze = normalizeLookFreeze(controlsSnapshot.lookFreeze) && lookFreezeCanPin(state) ? 1 : 0;
      if (!controlsLookFreeze) updatePyroDynamicDetailState({ inputKind: 'control-proxy' });
      else if (state.pyroDynamicDetail) {
        state.pyroDynamicDetail = {
          ...state.pyroDynamicDetail,
          frozen: true,
          freezeFrame: state.lookFreezeFrame ?? state.frameCount,
          lastInputKind: 'look-lab-frozen-control-change',
        };
      }
      state.runtimeQualityRequested = normalizeRuntimeQuality(controlsSnapshot.runtimeQualityRequested);
      state.runtimeQualityEffective = normalizeRuntimeQuality(controlsSnapshot.runtimeQualityEffective || controlsSnapshot.runtimeQualityRequested);
      state.gpuPressure = clampFinite(controlsSnapshot.gpuPressure, 0, 1, 0);
      state.runtimeQualityReason = String(controlsSnapshot.runtimeQualityReason || 'unspecified').slice(0, 96) || 'unspecified';
      state.runtimeQualityReceipt = runtimeQualityReceipt(controlsSnapshot);
      state.tallPlumeReactionCadenceDebug = state.volumeScene === 'tall_plume' ? 'source-reaction-cadence-v0' : 'inactive';
      state.tallPlumeFlameCutoffContract = state.volumeScene === 'tall_plume' ? 'tall-plume-speed-cutoff-decoupled-v0' : 'inactive';
      state.tallPlumeFlowShelfContract = state.volumeScene === 'tall_plume' ? 'tall-plume-flow-shelf-mitigated-v0' : 'inactive';
      state.tallPlumeFlameHeightLawContract = state.volumeScene === 'tall_plume' ? 'tall-plume-flame-height-law-v2' : 'inactive';
      state.plumeHeight = Math.max(0.7, Math.min(2.2, controlsSnapshot.plumeHeight ?? 1.45));
      state.pressureEffectiveLabel = controlsSnapshot.pressureEffectiveLabel || '';
      state.windStrength = normalizeWindStrength(controlsSnapshot.windStrength);
      state.windAngle = normalizeWindAngle(controlsSnapshot.windAngle);
      state.windHeight = normalizeWindHeight(controlsSnapshot.windHeight);
      state.bonfireAblation = normalizeBonfireAblationControls(controlsSnapshot);
      state.renderScale = normalizeRenderScale(controlsSnapshot.renderScale);
      state.renderPixelRatio = state.renderWidth / Math.max(1, state.displayWidth || state.renderWidth || 1);
      state.volumeResidualMode = normalizeBrowserResidualMode(controlsSnapshot.volumeResidualMode);
      state.volumeResidualModelUrl = String(controlsSnapshot.volumeResidualModelUrl || '');
      state.volumeResidualStrength = normalizeBrowserResidualStrength(controlsSnapshot.volumeResidualStrength);
      state.volumeResidualFeatureDebug = normalizeBrowserResidualFeatureDebug(controlsSnapshot.volumeResidualFeatureDebug);
      state.volumeResidualFeatureDebugMode = state.volumeResidualFeatureDebug ? 'residual-feature-debug-false-color-v0' : 'off';
      const selectiveCompositionRequest = selectiveHeadLiveRenderCompositionRequest(
        controlsSnapshot.selectiveHeadLiveRenderComposition ?? state.selectiveHeadLiveCompositionRequestedRaw,
      );
      state.selectiveHeadLiveRole = normalizeSelectiveHeadLiveRole(controlsSnapshot.selectiveHeadLiveRole);
      state.selectiveHeadLiveCompositionRequestedRaw = selectiveCompositionRequest.raw;
      state.selectiveHeadLiveCompositionRequested = selectiveCompositionRequest.requested;
      state.selectiveHeadLiveCompositionAuthority = selectiveHeadLiveRenderCompositionAuthority(selectiveCompositionRequest.requested);
      state.selectiveHeadLiveCompositionFallbackReason = selectiveCompositionRequest.fallbackReason;
      state.boundarySplatMode = normalizeBoundarySplatMode(controlsSnapshot.boundarySplatMode);
      state.boundarySplatRadius = normalizeBoundarySplatRadius(controlsSnapshot.boundarySplatRadius);
      state.boundarySplatSharpness = normalizeBoundarySplatSharpness(controlsSnapshot.boundarySplatSharpness);
      if (device) void ensureBrowserResidualModel();
      state.majorantGrid = majorantGridSize;
      state.majorantCadence = normalizeMajorantBuildCadence(controlsSnapshot.majorantCadence);
      state.pressureIterationDefault = defaultPressureIterationsForScene(controlsSnapshot.volumeScene);
      state.pressureIterationRequested = normalizePressureIterationCount(controlsSnapshot.pressureIterations, controlsSnapshot.volumeScene);
      state.pressureStrategy = normalizePressureStrategy(controlsSnapshot.pressureStrategy, controlsSnapshot.volumeScene);
      state.pressureTierOverlayOpacity = normalizePressureTierControls(controlsSnapshot).overlay;
      state.simProfile = normalizeSimProfileFlag(controlsSnapshot.simProfile);
      state.scalarActivityReceiver = scalarActivityReceiverDebug();
      updateSimCostLedger();
      pumpLookLabFrozenFrame();
    },
    setVolumePrimitives(next) {
      const incoming = Array.isArray(next) ? next : [];
      volumePrimitives = incoming.map(normalizePrimitiveRecord);
      publishVolumePrimitiveState();
      if (device) rebuildFluidState(gridSize, majorantGridSize, 'volume-primitive-change');
    },
    setExternalEmitters(payload = {}) {
      externalEmitterState = normalizeExternalEmitters(payload);
      updateExternalEmitterDebug();
      writeExternalEmitterBuffer();
      emitStatus({ phase: 'external-emitters' });
      return {
        mode: state.externalEmitterMode,
        coordinateSpace: state.externalEmitterCoordinateSpace,
        count: state.externalEmitterCount,
        ageMs: state.externalEmitterAgeMs,
        frameId: state.externalEmitterFrameId,
      };
    },
    setSelectiveHeadLiveRole(role) {
      const requestedRole = normalizeSelectiveHeadLiveRole(role);
      controlsSnapshot = { ...controlsSnapshot, selectiveHeadLiveRole: requestedRole };
      state.selectiveHeadLiveRole = requestedRole;
      resetTemporalHistory('selective-head-live-role-change');
      return {
        requestedRole,
        effectiveRole: state.selectiveHeadLiveEffectiveRole,
        routeIdentity: SELECTIVE_HEAD_LIVE_ROUTE,
        modelIdentity: SELECTIVE_HEAD_LIVE_MODEL.identity,
        fallbackReason: state.selectiveHeadLiveFallbackReason,
      };
    },
    setSelectiveHeadLiveRenderComposition(composition) {
      const request = selectiveHeadLiveRenderCompositionRequest(composition);
      controlsSnapshot = { ...controlsSnapshot, selectiveHeadLiveRenderComposition: request.requested };
      updateSelectiveHeadLiveCompositionState();
      resetTemporalHistory('selective-head-live-render-composition-change');
      return {
        requestedCompositionRaw: request.raw,
        requestedComposition: request.requested,
        effectiveComposition: state.selectiveHeadLiveCompositionEffective,
        compositionAuthority: state.selectiveHeadLiveCompositionAuthority,
        compositionFallbackReason: request.fallbackReason,
        routeIdentity: SELECTIVE_HEAD_LIVE_ROUTE,
      };
    },
    setSelectiveHeadLiveCapturePaused(paused) {
      selectiveHeadLiveCapturePaused = Boolean(paused);
      state.selectiveHeadLiveCapturePaused = selectiveHeadLiveCapturePaused;
      cancelAnimationFrame(raf);
      raf = 0;
      if (!selectiveHeadLiveCapturePaused && state.active) raf = requestAnimationFrame(render);
      return {
        paused: selectiveHeadLiveCapturePaused,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        authority: 'witness-owned-presented-frame-pause-release-v0',
      };
    },
    async stepSelectiveHeadLiveCaptureFrame() {
      if (!state.active || !device) return { ok: false, reason: 'inactive' };
      if (!selectiveHeadLiveCapturePaused) return { ok: false, reason: 'capture-not-paused' };
      const beforeFrameCount = state.frameCount;
      const beforeSimStepCount = state.simStepCount;
      selectiveHeadLiveCapturePaused = false;
      render(performance.now());
      selectiveHeadLiveCapturePaused = true;
      state.selectiveHeadLiveCapturePaused = true;
      cancelAnimationFrame(raf);
      raf = 0;
      if (device.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      const simStepDelta = state.simStepCount - beforeSimStepCount;
      const frameDelta = state.frameCount - beforeFrameCount;
      return {
        ok: state.active && simStepDelta === 1 && frameDelta === 1,
        reason: state.error || (simStepDelta !== 1 || frameDelta !== 1 ? `single-step-delta-mismatch:${frameDelta}/${simStepDelta}` : null),
        authority: 'renderer-internal-paused-single-step-gpu-complete-v0',
        beforeFrameCount,
        beforeSimStepCount,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        effectiveRole: state.selectiveHeadLiveEffectiveRole,
        requestedRole: state.selectiveHeadLiveRole,
        roleAuthority: state.selectiveHeadLiveRoleAuthority,
        fallbackReason: state.selectiveHeadLiveFallbackReason,
        boundarySplatFallbackReason: state.boundarySplatFallbackReason,
        selectiveHeadLiveCompositionRequested: state.selectiveHeadLiveCompositionRequested,
        selectiveHeadLiveCompositionEffective: state.selectiveHeadLiveCompositionEffective,
        selectiveHeadLiveCompositionAuthority: state.selectiveHeadLiveCompositionAuthority,
        selectiveHeadLiveCompositionFallbackReason: state.selectiveHeadLiveCompositionFallbackReason,
        selectiveHeadLivePassReceipt: state.selectiveHeadLivePassReceipt,
      };
    },
    loadSelectiveHeadLiveReplayAnchor,
    setTruthOracleActivityCue(payload = {}) {
      const source = payload && typeof payload === 'object' ? payload : {};
      const sourceGrid = normalizeScalarActivityCueGridSize(source.grid || source.sourceGrid || gridSize, gridSize);
      const values = source.values || source.data || source.activity || [];
      if (!values || Number(values.length) <= 0) {
        oracleActivityCueSourceValues = null;
        oracleActivityCueSourceGrid = null;
        oracleActivityCueUpload = {
          status: 'cleared',
          requestedCueAuthority: TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY,
          effectiveCueAuthority: PROCEDURAL_ACTIVITY_CUE_AUTHORITY,
          grid: null,
          receiverGrid: gridSize,
          externalCueCellCount: 0,
          frameId: source.frameId ?? null,
          uploadedAtMs: performance.now(),
        };
        if (device) {
          ensureOracleActivityCueBuffer();
          device.queue.writeBuffer(oracleActivityCueBuffer, 0, new Float32Array(gridCellCount(gridSize)));
        }
        state.scalarActivityReceiver = scalarActivityReceiverDebug();
        emitStatus({ phase: 'truth-oracle-activity-cue-cleared' });
        return { ...state.scalarActivityReceiver };
      }
      oracleActivityCueSourceValues = values instanceof Float32Array ? new Float32Array(values) : new Float32Array(values);
      oracleActivityCueSourceGrid = sourceGrid;
      const resampledCue = resampleScalarActivityCue(oracleActivityCueSourceValues, oracleActivityCueSourceGrid, gridSize);
      writeOracleActivityCueBuffer(resampledCue);
      oracleActivityCueUpload = {
        status: 'uploaded',
        requestedCueAuthority: TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY,
        effectiveCueAuthority: TRUTH_ORACLE_ACTIVITY_CUE_AUTHORITY,
        grid: sourceGrid,
        receiverGrid: gridSize,
        externalCueCellCount: resampledCue.length,
        frameId: source.frameId ?? null,
        uploadedAtMs: performance.now(),
      };
      state.scalarActivityReceiver = scalarActivityReceiverDebug();
      emitStatus({ phase: 'truth-oracle-activity-cue-uploaded' });
      return { ...state.scalarActivityReceiver };
    },
    beginDebugBoundarySidecarOverride,
    writeDebugBoundarySidecarOverrideChunk,
    finishDebugBoundarySidecarOverride,
    syntheticHandTrailEmitters,
    async setActive(active) {
      if (active) {
        if (state.fullFieldImportReceipt?.status === 'applied'
          && state.fullFieldImportReceipt?.renderLoopPaused === true) {
          throw new Error('full-field-import-live-resume-api-required');
        }
        try {
          await ensureGpu();
          await ensureBrowserResidualModel();
          state.active = true;
          state.error = null;
          canvas.classList.add('active');
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(render);
          emitStatus({ phase: 'active' });
        } catch (err) {
          state.active = false;
          state.error = err?.message || String(err);
          state.backend = 'unavailable';
          canvas.classList.remove('active');
          emitStatus({ phase: 'error', error: state.error });
          throw err;
        }
      } else {
        state.active = false;
        canvas.classList.remove('active');
        cancelAnimationFrame(raf);
        emitStatus({ phase: 'inactive' });
      }
    },
    debugState() {
      return {
        ...state,
        controls: { ...controlsSnapshot },
        scalarActivityReceiver: scalarActivityReceiverDebug(),
        pyroDynamicDetail: clonePyroDynamicDetail(),
        pyroMaterialRendererCoupling: state.pyroMaterialRendererCoupling ? { ...state.pyroMaterialRendererCoupling } : null,
      };
    },
    canvasElement() {
      return canvas;
    },
    sampleFrame,
    sampleDeterministicReplayFrame,
    captureNativeLowCrossGridManifestFrame,
    captureNativeLowSelectiveSharedDeviceFrame,
    beginDebugFullFieldImport,
    writeDebugFullFieldImportChunk,
    finishDebugFullFieldImport,
    advanceDebugImportedFieldSteps,
    resumeDebugImportedFieldLive,
    beginDebugFullFieldExport,
    readDebugFullFieldExportChunk,
    releaseDebugFullFieldExport,
    sampleRenderScaleSet,
    controlledStepFrame,
    controlledStepSequence,
    captureSelectiveHeadLiveFrame,
    renderFrozenScaleToCanvas,
    dispose() {
      this.setActive(false);
      for (const runtime of nativeLowSelectiveSharedRuntimes.values()) runtime?.destroy?.();
      nativeLowSelectiveSharedRuntimes.clear();
      frameTexture?.destroy();
      browserResidualFeatureTexture?.destroy();
      externalEmitterBuffer?.destroy();
      boundarySplatCameraBuffer?.destroy();
      boundarySplatCameraBuffer = null;
      destroyTemporalHistory();
      destroyFluidState();
      destroyMajorantState();
      canvas.remove();
    },
  };
}
