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
