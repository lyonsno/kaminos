const HYBRID_RAYMARCH_RENDERER = 'splat-depth-conditioned-front-back-smoke-compositor-v1';
const HYBRID_SPATIAL_STRATA_RENDERER = 'splat-depth-conditioned-front-back-smoke-compositor-v1+phase-matched-spatial-strata-front-back-raster-v0';
const ANALYTIC_SPLAT_RENDERER = 'live-boundary-sidecar-analytic-splats-v0';

export const SMOKE_RESIDUAL_MOTION_THRESHOLDS = Object.freeze({
  minMeanAbsDiff: 0.02,
  minChangedFraction: 0.0005,
});

export const LOWER_FRONT_REGION_THRESHOLDS = Object.freeze({
  minSamples: 128,
  minSupportPixels: 64,
  minSupportDensity: 0.01,
  maxSupportDensity: 0.85,
  minComponentFractionOfLitSupport: 0.25,
  maxRegionFrameAreaFraction: 0.35,
  minSmokeResidualChangedPixels: 8,
  minSmokeResidualChangedFraction: 0.001,
  minSmokeResidualMeanAbsDiff: 0.02,
});

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${label} must be finite and non-negative`);
  }
  return number;
}

export function assertSmokeResidualMotion({
  residualMotionDiffs,
  smokeResidualMotionDiffs,
  thresholds = SMOKE_RESIDUAL_MOTION_THRESHOLDS,
} = {}) {
  const requestedDiffs = residualMotionDiffs ?? smokeResidualMotionDiffs;
  if (!Array.isArray(requestedDiffs) || requestedDiffs.length === 0) {
    throw new TypeError('smoke residual motion requires at least one adjacent residual diff');
  }
  const diffs = requestedDiffs.map((diff, index) => ({
    meanAbsDiff: finiteNonNegative(diff?.meanAbsDiff, `residualMotionDiffs[${index}].meanAbsDiff`),
    changedFraction: finiteNonNegative(diff?.changedFraction, `residualMotionDiffs[${index}].changedFraction`),
  }));
  const maxMeanAbsDiff = Math.max(...diffs.map(diff => diff.meanAbsDiff));
  const maxChangedFraction = Math.max(...diffs.map(diff => diff.changedFraction));
  if (!(maxMeanAbsDiff > thresholds.minMeanAbsDiff)
      || !(maxChangedFraction > thresholds.minChangedFraction)) {
    throw new Error(
      `smoke-only residual did not move: mean ${maxMeanAbsDiff} / changed ${maxChangedFraction}`,
    );
  }
  return {
    status: 'passed',
    authority: 'adjacent-smoke-only-residual-motion-v1',
    thresholds,
    maxMeanAbsDiff,
    maxChangedFraction,
  };
}

export function compactLiveControlState(state = {}) {
  return {
    boundarySplatMode: state.boundarySplatMode ?? null,
    boundarySplatCompositionRequested: state.boundarySplatCompositionRequested ?? null,
    boundarySplatCompositionEffective: state.boundarySplatCompositionEffective ?? null,
  };
}

export function assertLiveControlRestored({ before, after } = {}) {
  const expected = compactLiveControlState(before);
  const actual = compactLiveControlState(after);
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      throw new Error(`live control restoration failed for ${key}: ${actual[key]} != ${expected[key]}`);
    }
  }
  return {
    status: 'passed',
    authority: 'post-frozen-render-live-control-restoration-v0',
    expected,
    actual,
  };
}

export function assertLowerFrontRegionEvidence(
  evidence = {},
  thresholds = LOWER_FRONT_REGION_THRESHOLDS,
) {
  const samples = finiteNonNegative(evidence.samples, 'lower-front samples');
  const supportPixels = finiteNonNegative(evidence.supportPixels, 'lower-front support pixels');
  const supportDensity = finiteNonNegative(evidence.supportDensity, 'lower-front support density');
  const componentFraction = finiteNonNegative(
    evidence.componentFractionOfLitSupport,
    'lower-front component fraction',
  );
  const regionFrameAreaFraction = finiteNonNegative(
    evidence.regionFrameAreaFraction,
    'lower-front frame area fraction',
  );
  if (samples < thresholds.minSamples
      || supportPixels < thresholds.minSupportPixels
      || supportDensity < thresholds.minSupportDensity
      || supportDensity > thresholds.maxSupportDensity
      || componentFraction < thresholds.minComponentFractionOfLitSupport
      || regionFrameAreaFraction > thresholds.maxRegionFrameAreaFraction) {
    throw new Error(`lower-front support density or component authority failed: ${JSON.stringify({
      samples,
      supportPixels,
      supportDensity,
      componentFraction,
      regionFrameAreaFraction,
    })}`);
  }
  const smokeResidualChangedPixels = finiteNonNegative(
    evidence.smokeResidualChangedPixels,
    'lower-front smoke residual changed pixels',
  );
  const smokeResidualChangedFraction = finiteNonNegative(
    evidence.smokeResidualChangedFraction,
    'lower-front smoke residual changed fraction',
  );
  const smokeResidualMeanAbsDiff = finiteNonNegative(
    evidence.smokeResidualMeanAbsDiff,
    'lower-front smoke residual mean absolute difference',
  );
  if (smokeResidualChangedPixels < thresholds.minSmokeResidualChangedPixels
      || smokeResidualChangedFraction < thresholds.minSmokeResidualChangedFraction
      || smokeResidualMeanAbsDiff < thresholds.minSmokeResidualMeanAbsDiff) {
    throw new Error(`lower-front smoke residual is missing or composited away: ${JSON.stringify({
      smokeResidualChangedPixels,
      smokeResidualChangedFraction,
      smokeResidualMeanAbsDiff,
    })}`);
  }
  return {
    status: 'passed',
    authority: 'largest-connected-splat-support-lower-front-smoke-residual-v1',
    thresholds,
  };
}

export function selectFailureRendererIdentity({ hybridOnly, raymarchHybridBoundary } = {}) {
  if (raymarchHybridBoundary) return HYBRID_RAYMARCH_RENDERER;
  if (hybridOnly) return HYBRID_SPATIAL_STRATA_RENDERER;
  return ANALYTIC_SPLAT_RENDERER;
}
