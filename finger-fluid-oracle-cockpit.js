const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const FINGER_FLUID_ORACLE_COCKPIT_ADAPTER = deepFreeze({
  schema: 'kaminos.finger-fluid.oracle-cockpit.adapter.v0',
  route: 'kaminos/finger-fluid/waterfall-oracle-cockpit',
  routeGateKey: 'finger_fluid_waterfall_oracle_cockpit',
  requiredBenchKey: 'kaminos_finger_fluid_bench',
  requiredTruthSceneKey: 'finger_fluid_truth_scene',
  requiredTruthScene: 'waterfall_resolution_oracle',
  restartRequiredKey: 'finger_fluid_oracle_restart_required',
  queryKeys: {
    resolutionPreset: 'finger_fluid_oracle_resolution',
    particleSpacing: 'finger_fluid_oracle_particle_spacing',
    kernelScale: 'finger_fluid_oracle_kernel_scale',
    sourceFlux: 'finger_fluid_oracle_source_flux',
    pressureIterations: 'finger_fluid_oracle_pressure_iterations',
    viscosity: 'finger_fluid_oracle_viscosity',
    cohesion: 'finger_fluid_oracle_cohesion',
    unsupportedSheetStrength: 'finger_fluid_oracle_sheet_support',
    paused: 'finger_fluid_oracle_pause',
    fixedCamera: 'finger_fluid_oracle_fixed_camera',
    replayId: 'finger_fluid_oracle_replay',
  },
  legacyBridgeKeys: {
    particleCount: 'finger_fluid_particle_count',
    truthScene: 'finger_fluid_truth_scene',
    capillaryStrength: 'finger_fluid_capillary_strength',
    freeFlightViscosityBoost: 'finger_fluid_free_flight_viscosity_boost',
    unsupportedSheetStrength: 'finger_fluid_unsupported_sheet_strength',
  },
  effectiveDebugFields: {
    resolutionPreset: ['effectiveWaterfallOraclePreset'],
    particleCount: ['effectiveParticleCount', 'particleCount'],
    pressureIterations: ['densityIterationsPerStep', 'densityIterationCount'],
    viscosity: ['freeFlightViscosityBoost', 'effectiveFreeFlightViscosityBoost'],
    cohesion: ['capillaryStrength', 'effectiveCapillaryStrength'],
    unsupportedSheetStrength: ['unsupportedSheetStrength', 'effectiveUnsupportedSheetStrength'],
    particleSpacing: ['oracleParticleSpacingScale', 'effectiveParticleSpacingScale'],
    kernelScale: ['oracleKernelScale', 'effectiveKernelScale'],
    sourceFlux: ['oracleSourceFluxScale', 'effectiveSourceFluxScale'],
    solverRoute: ['solverRoute'],
    waterfallContinuityContract: ['waterfallContinuityContract'],
  },
  presets: {
    baseline: { particleCount: 12288, label: 'baseline', spacingScale: 1, kernelScale: 1, camera: { yaw: -0.46, pitch: 0.30, distance: 3.05, target: [0, -0.35, -0.92] } },
    production: { particleCount: 24576, label: 'production', spacingScale: 1 / Math.cbrt(2), kernelScale: 1 / Math.cbrt(2), camera: { yaw: -0.46, pitch: 0.30, distance: 3.05, target: [0, -0.35, -0.92] } },
    high: { particleCount: 98304, label: 'high', spacingScale: 0.5, kernelScale: 0.5, camera: { yaw: -0.46, pitch: 0.30, distance: 3.05, target: [0, -0.35, -0.92] } },
  },
  structuralControls: ['resolutionPreset', 'particleSpacing', 'kernelScale', 'sourceFlux', 'pressureIterations', 'viscosity', 'cohesion', 'unsupportedSheetStrength'],
  unsupportedUntilBigPapaFields: ['particleSpacing', 'kernelScale', 'sourceFlux'],
});

function paramsFrom(input) {
  if (input instanceof URLSearchParams) return input;
  if (input instanceof URL) return input.searchParams;
  if (typeof input === 'string') return new URL(input, 'http://127.0.0.1/').searchParams;
  return new URLSearchParams();
}

function urlFrom(input) {
  if (input instanceof URL) return new URL(input.href);
  return new URL(String(input || 'http://127.0.0.1/'), 'http://127.0.0.1/');
}

function finiteNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedNumber(value, fallback, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

function boundedInteger(value, fallback, min, max) {
  return Math.min(max, Math.max(min, Math.round(finiteNumber(value, fallback))));
}

function boolParam(value, fallback = false) {
  if (value == null) return fallback;
  return value === '1' || value === 'true' || value === true;
}

function normalizeResolutionPreset(value) {
  return Object.hasOwn(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.presets, value) ? value : 'baseline';
}

function readEffectiveField(runtime, names) {
  const source = runtime && typeof runtime === 'object' ? runtime : {};
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function formatValue(value) {
  return Number.isFinite(Number(value)) ? NUMBER_FORMAT.format(Number(value)) : String(value);
}

export function isFingerFluidOracleCockpitRoute(paramsInput = new URLSearchParams()) {
  const params = paramsFrom(paramsInput);
  return params.get(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredBenchKey) === '1'
    && params.get(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredTruthSceneKey) === FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredTruthScene
    && params.get(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.routeGateKey) === '1';
}

export function fingerFluidOracleRequestedConfigFromParams(paramsInput = new URLSearchParams()) {
  const params = paramsFrom(paramsInput);
  const keys = FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys;
  const resolutionPreset = normalizeResolutionPreset(params.get(keys.resolutionPreset));
  const preset = FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.presets[resolutionPreset];
  return {
    resolutionPreset,
    particleCount: preset.particleCount,
    particleSpacing: boundedNumber(params.get(keys.particleSpacing), preset.spacingScale, 0.25, 2.5),
    kernelScale: boundedNumber(params.get(keys.kernelScale), preset.kernelScale, 0.25, 2.5),
    sourceFlux: boundedNumber(params.get(keys.sourceFlux), 1, 0, 4),
    pressureIterations: boundedInteger(params.get(keys.pressureIterations), 3, 1, 12),
    viscosity: boundedNumber(params.get(keys.viscosity), 0.17, 0, 0.75),
    cohesion: boundedNumber(params.get(keys.cohesion), 0.72, 0, 1.5),
    unsupportedSheetStrength: boundedNumber(params.get(keys.unsupportedSheetStrength), 0, 0, 2),
    paused: boolParam(params.get(keys.paused), false),
    fixedCamera: boolParam(params.get(keys.fixedCamera), false),
    replayId: params.get(keys.replayId) || 'default',
    restartRequired: params.get(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.restartRequiredKey) === '1',
  };
}

export function createFingerFluidOracleCockpitState({ url, effective = {}, now = new Date().toISOString() } = {}) {
  const sourceUrl = urlFrom(url || 'http://127.0.0.1/');
  const requested = fingerFluidOracleRequestedConfigFromParams(sourceUrl.searchParams);
  const routeReady = isFingerFluidOracleCockpitRoute(sourceUrl.searchParams);
  const fields = FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.effectiveDebugFields;
  const effectiveResolutionPreset = readEffectiveField(effective, fields.resolutionPreset);
  const effectiveParticleCount = readEffectiveField(effective, fields.particleCount);
  const effectivePressureIterations = readEffectiveField(effective, fields.pressureIterations);
  const effectiveViscosity = readEffectiveField(effective, fields.viscosity);
  const effectiveCohesion = readEffectiveField(effective, fields.cohesion);
  const effectiveUnsupportedSheetStrength = readEffectiveField(effective, fields.unsupportedSheetStrength);
  const routeIdentity = {
    solverRoute: readEffectiveField(effective, fields.solverRoute) || 'unsupported',
    waterfallContinuityContract: readEffectiveField(effective, fields.waterfallContinuityContract) || 'unsupported',
  };
  const unsupported = [];
  for (const control of FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.unsupportedUntilBigPapaFields) {
    const observed = readEffectiveField(effective, fields[control]);
    if (observed === undefined) {
      unsupported.push({
        key: FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys[control],
        control,
        requested: requested[control],
        effective: 'unsupported',
        severity: 'unsupported_loud',
        reason: 'effective_debug_field_absent_preserving_requested_value',
      });
    }
  }

  return {
    schema: 'kaminos.finger-fluid.oracle-cockpit.state.v0',
    adapterSchema: FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.schema,
    route: FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.route,
    routeReady,
    observedAt: now,
    requested,
    effective: {
      resolutionPreset: normalizeResolutionPreset(effectiveResolutionPreset ?? requested.resolutionPreset),
      particleCount: Number.isFinite(Number(effectiveParticleCount)) ? Number(effectiveParticleCount) : requested.particleCount,
      pressureIterations: Number.isFinite(Number(effectivePressureIterations)) ? Number(effectivePressureIterations) : requested.pressureIterations,
      viscosity: Number.isFinite(Number(effectiveViscosity)) ? Number(effectiveViscosity) : requested.viscosity,
      cohesion: Number.isFinite(Number(effectiveCohesion)) ? Number(effectiveCohesion) : requested.cohesion,
      unsupportedSheetStrength: Number.isFinite(Number(effectiveUnsupportedSheetStrength))
        ? Number(effectiveUnsupportedSheetStrength)
        : requested.unsupportedSheetStrength,
      particleSpacing: readEffectiveField(effective, fields.particleSpacing) ?? 'unsupported',
      kernelScale: readEffectiveField(effective, fields.kernelScale) ?? 'unsupported',
      sourceFlux: readEffectiveField(effective, fields.sourceFlux) ?? 'unsupported',
      routeIdentity,
    },
    unsupported,
    controls: Object.entries(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys).map(([control, key]) => ({
      control,
      key,
      requested: requested[control],
      structural: FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.structuralControls.includes(control),
    })),
    downgrades: [
      'operator_cockpit_not_physical_acceptance_surface',
      'controls_are_requested_route_state_not_continuity_proof',
      ...unsupported.map(row => `${row.control}_unsupported_effective_debug_field_absent`),
    ],
    acceptanceClaimAllowed: false,
    operatorJudgment: 'operator observation owns continuity judgment; cockpit only exposes requested/effective route identity',
    display: {
      requestedSummary: `req ${requested.resolutionPreset} P${requested.pressureIterations} sheet ${formatValue(requested.unsupportedSheetStrength)}`,
      effectiveSummary: `eff ${routeIdentity.solverRoute} particles ${formatValue(effectiveParticleCount ?? requested.particleCount)} sheet ${formatValue(effectiveUnsupportedSheetStrength ?? requested.unsupportedSheetStrength)}`,
      unsupportedSummary: unsupported.length ? unsupported.map(row => row.control).join(', ') : 'none',
    },
  };
}

export function updateFingerFluidOracleCockpitUrl({ url, control, value } = {}) {
  const nextUrl = urlFrom(url || 'http://127.0.0.1/');
  const keys = FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys;
  if (!Object.hasOwn(keys, control)) throw new RangeError(`Unknown finger fluid oracle cockpit control: ${control}`);
  const key = keys[control];
  if (typeof value === 'boolean') nextUrl.searchParams.set(key, value ? '1' : '0');
  else nextUrl.searchParams.set(key, String(value));
  if (control === 'resolutionPreset') {
    const preset = FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.presets[normalizeResolutionPreset(String(value))];
    nextUrl.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.legacyBridgeKeys.particleCount, String(preset.particleCount));
  }
  if (control === 'unsupportedSheetStrength') {
    nextUrl.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.legacyBridgeKeys.unsupportedSheetStrength, String(value));
  }
  nextUrl.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredBenchKey, '1');
  nextUrl.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredTruthSceneKey, FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredTruthScene);
  nextUrl.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.routeGateKey, '1');
  const structural = FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.structuralControls.includes(control);
  if (structural) nextUrl.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.restartRequiredKey, '1');
  return {
    url: nextUrl.href,
    control,
    key,
    value,
    structural,
    restartRequired: structural,
    requestedValuePreserved: nextUrl.searchParams.get(key) === String(typeof value === 'boolean' ? (value ? '1' : '0') : value),
  };
}

export function clearFingerFluidOracleRestartRequired(url) {
  const nextUrl = urlFrom(url || 'http://127.0.0.1/');
  nextUrl.searchParams.delete(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.restartRequiredKey);
  return nextUrl.href;
}

export function createFingerFluidOracleABReplayUrls({ url, replayId = 'waterfall-oracle' } = {}) {
  const low = urlFrom(url || 'http://127.0.0.1/');
  const high = urlFrom(url || 'http://127.0.0.1/');
  for (const target of [low, high]) {
    target.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredBenchKey, '1');
    target.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredTruthSceneKey, FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredTruthScene);
    target.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.routeGateKey, '1');
  }
  low.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.resolutionPreset, 'baseline');
  low.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.legacyBridgeKeys.particleCount, String(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.presets.baseline.particleCount));
  low.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.replayId, `${replayId}-low`);
  high.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.resolutionPreset, 'high');
  high.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.legacyBridgeKeys.particleCount, String(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.presets.high.particleCount));
  high.searchParams.set(FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.replayId, `${replayId}-high`);
  return { low: low.href, high: high.href, replayId };
}
