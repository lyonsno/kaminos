import { passesSam3LayerParityCheckpoint } from './sam-image-vit-block-stack-phase-program.js';

const DOWNSTREAM_CHECKPOINTS = Object.freeze([
  Object.freeze({ name: 'frame0-memory-features', summaryPath: ['frame0Memory', 'features'], tolerance: 'memory' }),
  Object.freeze({ name: 'frame0-memory-position', summaryPath: ['frame0Memory', 'position'], tolerance: 'position' }),
  Object.freeze({ name: 'temporal-memory-image', summaryPath: ['temporalBank', 'memoryImage'], tolerance: 'memory' }),
  Object.freeze({ name: 'temporal-memory', summaryPath: ['temporalBank', 'memory'], tolerance: 'memory' }),
  Object.freeze({ name: 'temporal-memory-image-position', summaryPath: ['temporalBank', 'memoryImagePosition'], tolerance: 'position' }),
  Object.freeze({ name: 'temporal-memory-position', summaryPath: ['temporalBank', 'memoryPosition'], tolerance: 'position' }),
  Object.freeze({ name: 'frame1-memory-attention', summaryPath: ['frame1Attention'], tolerance: 'attention' }),
  Object.freeze({ name: 'frame1-selected-masks', summaryPath: ['frame1Decoder', 'selectedMasks'], tolerance: 'selectedMasks' }),
  Object.freeze({ name: 'frame1-object-scores', summaryPath: ['frame1Decoder', 'objectScores'], tolerance: 'objectScores' }),
  Object.freeze({ name: 'frame1-object-pointers', summaryPath: ['frame1Decoder', 'objectPointers'], tolerance: 'objectPointers' }),
]);

const IMAGE_BACKBONE_CHECKPOINTS = Object.freeze([
  Object.freeze({ name: 'frame0-vit-prefix', summaryPath: ['frame0', 'vitPrefix'], tolerance: 'vitPrefix' }),
  Object.freeze({ name: 'frame0-vit-backbone', summaryPath: ['frame0', 'vitBackbone'], tolerance: 'vitBackbone' }),
  Object.freeze({ name: 'frame1-vit-prefix', summaryPath: ['frame1', 'vitPrefix'], tolerance: 'vitPrefix' }),
  Object.freeze({ name: 'frame1-vit-backbone', summaryPath: ['frame1', 'vitBackbone'], tolerance: 'vitBackbone' }),
]);

function readPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function allowedMaximum(summary, tolerance) {
  if (!summary || !tolerance) return null;
  const absolute = Number(tolerance.maxAbsDiff);
  const relative = Number(tolerance.relativeDiffAtMaxAbsDiff);
  const expected = Number(summary.expectedAtMaxAbsDiff);
  if (![absolute, relative, expected].every(Number.isFinite)) return null;
  return absolute + relative * Math.abs(expected);
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function imageBackboneTolerance(tolerances, profile) {
  const stem = profile === 'vitPrefix' ? 'vitPrefix' : 'vitBackbone';
  return {
    maxAbsDiff: tolerances?.[`${stem}MaxAbsDiff`],
    meanAbsDiff: tolerances?.[`${stem}MeanAbsDiff`],
    rootMeanSquareDiff: tolerances?.[`${stem}RootMeanSquareDiff`],
    relativeDiffAtMaxAbsDiff: tolerances?.[`${stem}RelativeDiffAtMaxAbsDiff`],
  };
}

export function evaluateSam31ImageBackboneParity({ diagnostics, tolerances } = {}) {
  const checkpoints = IMAGE_BACKBONE_CHECKPOINTS.map(spec => {
    const summary = readPath(diagnostics, spec.summaryPath);
    const tolerance = imageBackboneTolerance(tolerances, spec.tolerance);
    const passed = passesSam3LayerParityCheckpoint(summary, tolerance);
    return {
      name: spec.name,
      toleranceProfile: Object.fromEntries(Object.entries(tolerance).map(([key, value]) => [key, finiteOrNull(value)])),
      passed,
      elementCount: Number.isInteger(summary?.elementCount) ? summary.elementCount : null,
      maxAbsDiff: finiteOrNull(summary?.maxAbsDiff),
      maximumAllowed: allowedMaximum(summary, tolerance),
      meanAbsDiff: finiteOrNull(summary?.meanAbsDiff),
      meanAbsDiffAllowed: finiteOrNull(tolerance.meanAbsDiff),
      rootMeanSquareDiff: finiteOrNull(summary?.rootMeanSquareDiff),
      rootMeanSquareDiffAllowed: finiteOrNull(tolerance.rootMeanSquareDiff),
      maxAbsDiffIndex: Number.isInteger(summary?.maxAbsDiffIndex) ? summary.maxAbsDiffIndex : null,
      expectedAtMaxAbsDiff: finiteOrNull(summary?.expectedAtMaxAbsDiff),
      actualAtMaxAbsDiff: finiteOrNull(summary?.actualAtMaxAbsDiff),
      maxAbsExpected: finiteOrNull(summary?.maxAbsExpected),
      maxAbsActual: finiteOrNull(summary?.maxAbsActual),
    };
  });
  const failedCheckpoints = checkpoints.filter(checkpoint => !checkpoint.passed).map(checkpoint => checkpoint.name);
  return {
    schema: 'kaminos.sam31-image-backbone-compound-parity.v0',
    passed: checkpoints.length === IMAGE_BACKBONE_CHECKPOINTS.length && failedCheckpoints.length === 0,
    checkpointCount: checkpoints.length,
    failedCheckpoints,
    checkpoints,
  };
}

export function evaluateSam31TrackerDownstreamParity({ diagnostics, tolerances } = {}) {
  const checkpoints = DOWNSTREAM_CHECKPOINTS.map(spec => {
    const summary = readPath(diagnostics, spec.summaryPath);
    const tolerance = tolerances?.[spec.tolerance];
    const passed = passesSam3LayerParityCheckpoint(summary, tolerance);
    return {
      name: spec.name,
      toleranceProfile: spec.tolerance,
      passed,
      maxAbsDiff: Number.isFinite(summary?.maxAbsDiff) ? summary.maxAbsDiff : null,
      maximumAllowed: allowedMaximum(summary, tolerance),
      meanAbsDiff: Number.isFinite(summary?.meanAbsDiff) ? summary.meanAbsDiff : null,
      meanAbsDiffAllowed: Number.isFinite(tolerance?.meanAbsDiff) ? tolerance.meanAbsDiff : null,
      rootMeanSquareDiff: Number.isFinite(summary?.rootMeanSquareDiff) ? summary.rootMeanSquareDiff : null,
      rootMeanSquareDiffAllowed: Number.isFinite(tolerance?.rootMeanSquareDiff) ? tolerance.rootMeanSquareDiff : null,
    };
  });
  const failedCheckpoints = checkpoints.filter(checkpoint => !checkpoint.passed).map(checkpoint => checkpoint.name);
  return {
    schema: 'kaminos.sam31-tracker-downstream-compound-parity.v0',
    passed: checkpoints.length === DOWNSTREAM_CHECKPOINTS.length && failedCheckpoints.length === 0,
    checkpointCount: checkpoints.length,
    failedCheckpoints,
    checkpoints,
  };
}
