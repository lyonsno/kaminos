export const NONRIDGE_RANDOMIZED_CAPTURE_IDENTITY = 'positive-nonridge-randomized-control-capture-v0';
export const NONRIDGE_RANDOMIZED_CAPTURE_SEED = 20260716;
export const NONRIDGE_OPTICAL_ROW_IDENTITY = 'ray-sample-current16-source-complete-positive-nonridge-v0';
export const NONRIDGE_OPTICAL_ROW_STRIDE_FLOATS = 40;

export const NONRIDGE_RANDOMIZED_CONTROL_FIELDS = Object.freeze([
  { key: 'reactionBoundarySupportThermal', min: 0, max: 2, step: 0.02, decimals: 2 },
  { key: 'reactionBoundarySupportReaction', min: 0, max: 2, step: 0.02, decimals: 2 },
  { key: 'reactionBoundarySupportFront', min: 0, max: 2, step: 0.02, decimals: 2 },
  { key: 'reactionBoundarySupportInterface', min: 0, max: 2, step: 0.02, decimals: 2 },
  { key: 'reactionBoundaryGradient', min: 0, max: 4, step: 0.05, decimals: 2 },
  { key: 'reactionBoundaryCut', min: 0, max: 0.55, step: 0.005, decimals: 3 },
  { key: 'reactionBoundarySoftness', min: 0.005, max: 0.45, step: 0.005, decimals: 3 },
  { key: 'reactionBoundaryCoreReject', min: 0, max: 1, step: 0.01, decimals: 2 },
  { key: 'reactionBoundaryTopology', min: 0, max: 2.5, step: 0.02, decimals: 2 },
  { key: 'reactionBoundaryCurl', min: 0, max: 2, step: 0.02, decimals: 2 },
  { key: 'reactionBoundaryDivergence', min: 0, max: 1, step: 0.01, decimals: 2 },
  { key: 'reactionBoundaryFireRidge', min: 0, max: 2, step: 0.02, decimals: 2 },
  { key: 'reactionBoundaryFireRidgeCut', min: 0, max: 0.55, step: 0.005, decimals: 3 },
  { key: 'reactionBoundaryFireTip', min: 0, max: 2, step: 0.02, decimals: 2 },
  { key: 'reactionBoundaryFireErosion', min: 0, max: 1, step: 0.01, decimals: 2 },
]);

export const NONRIDGE_OPTICAL_ROW_CHANNELS = Object.freeze([
  'world.x', 'world.y', 'world.z', 'candidate.support',
  'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
  'material.density', 'material.heat', 'material.fuel', 'material.detail',
  'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
  'micro.x', 'micro.y', 'micro.z', 'micro.w',
  'velocity.x', 'velocity.y', 'velocity.z', 'velocity.magnitude',
  'support.thermal', 'support.reaction', 'support.front', 'support.interface',
  'source.frontTopology', 'source.coreBody', 'source.curl', 'source.divergence',
  'target.nonRidgeEmission.r', 'target.nonRidgeEmission.g', 'target.nonRidgeEmission.b', 'target.nonRidgeExtinction',
  'adjudication.completeEmission.r', 'adjudication.completeEmission.g', 'adjudication.completeEmission.b', 'adjudication.completeExtinction',
]);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndexes(count, random) {
  const indexes = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swap]] = [indexes[swap], indexes[index]];
  }
  return indexes;
}

function roundedFieldValue(field, unit) {
  const scale = 10 ** field.decimals;
  const latticeIndex = Math.max(0, Math.min(
    Math.round((field.max - field.min) / field.step),
    Math.round((unit * (field.max - field.min)) / field.step),
  ));
  return Math.round((field.min + latticeIndex * field.step) * scale) / scale;
}

function matrixRank(matrix, epsilon = 1e-9) {
  const rows = matrix.map(row => [...row]);
  if (rows.length === 0) return 0;
  const columnCount = rows[0].length;
  let rank = 0;
  for (let column = 0; column < columnCount && rank < rows.length; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < rows.length; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) <= epsilon) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const divisor = rows[rank][column];
    for (let next = column; next < columnCount; next += 1) rows[rank][next] /= divisor;
    for (let row = 0; row < rows.length; row += 1) {
      if (row === rank) continue;
      const factor = rows[row][column];
      if (Math.abs(factor) <= epsilon) continue;
      for (let next = column; next < columnCount; next += 1) rows[row][next] -= factor * rows[rank][next];
    }
    rank += 1;
  }
  return rank;
}

function normalizedDesignRow(controls) {
  return [
    1,
    ...NONRIDGE_RANDOMIZED_CONTROL_FIELDS.map(field => (
      (controls[field.key] - field.min) / (field.max - field.min)
    )),
  ];
}

export function buildNonRidgeRandomizedControlTranche({
  seed = NONRIDGE_RANDOMIZED_CAPTURE_SEED,
  trancheIndex = 0,
  interiorCount = 30,
} = {}) {
  if (!Number.isInteger(seed)) throw new Error('randomized capture seed must be an integer');
  if (!Number.isInteger(trancheIndex) || trancheIndex < 0) throw new Error('tranche index must be a nonnegative integer');
  if (!Number.isInteger(interiorCount) || interiorCount < NONRIDGE_RANDOMIZED_CONTROL_FIELDS.length + 1) {
    throw new Error(`interior count must be at least ${NONRIDGE_RANDOMIZED_CONTROL_FIELDS.length + 1}`);
  }
  const random = seededRandom(seed ^ Math.imul(trancheIndex + 1, 0x9e3779b1));
  const permutations = NONRIDGE_RANDOMIZED_CONTROL_FIELDS.map(() => shuffledIndexes(interiorCount, random));
  const rows = [];
  if (trancheIndex === 0) {
    rows.push({
      settingId: `seed-${seed}-boundary-min`,
      role: 'boundary-min',
      requestedControls: Object.fromEntries(NONRIDGE_RANDOMIZED_CONTROL_FIELDS.map(field => [field.key, field.min])),
    });
    rows.push({
      settingId: `seed-${seed}-boundary-max`,
      role: 'boundary-max',
      requestedControls: Object.fromEntries(NONRIDGE_RANDOMIZED_CONTROL_FIELDS.map(field => [field.key, field.max])),
    });
  }
  for (let rowIndex = 0; rowIndex < interiorCount; rowIndex += 1) {
    const requestedControls = {};
    for (let fieldIndex = 0; fieldIndex < NONRIDGE_RANDOMIZED_CONTROL_FIELDS.length; fieldIndex += 1) {
      const field = NONRIDGE_RANDOMIZED_CONTROL_FIELDS[fieldIndex];
      const stratum = permutations[fieldIndex][rowIndex];
      const unit = (stratum + 0.1 + random() * 0.8) / interiorCount;
      requestedControls[field.key] = roundedFieldValue(field, unit);
    }
    rows.push({
      settingId: `seed-${seed}-tranche-${trancheIndex}-interior-${rowIndex}`,
      role: 'interior',
      requestedControls,
    });
  }
  const designMatrix = rows.map(row => normalizedDesignRow(row.requestedControls));
  const rank = matrixRank(designMatrix);
  const coverage = {
    matrixIdentity: 'normalized-controls-plus-intercept-v0',
    rows: designMatrix.length,
    columns: NONRIDGE_RANDOMIZED_CONTROL_FIELDS.length + 1,
    rank,
    fullRank: rank === NONRIDGE_RANDOMIZED_CONTROL_FIELDS.length + 1,
    fields: Object.fromEntries(NONRIDGE_RANDOMIZED_CONTROL_FIELDS.map(field => {
      const values = rows.map(row => row.requestedControls[field.key]);
      return [field.key, {
        minimumCovered: values.includes(field.min),
        maximumCovered: values.includes(field.max),
        interiorCovered: values.some(value => value > field.min && value < field.max),
      }];
    })),
  };
  return {
    identity: 'seeded-appendable-latin-hypercube-with-boundary-anchors-v0',
    seed,
    trancheIndex,
    interiorCount,
    uncapped: true,
    stoppingAuthority: 'full-rank-boundary-interior-coverage-plus-verdict-stabilization-v0',
    rows,
    coverage,
  };
}

function vec4(values, offset) {
  return Array.from(values.subarray(offset, offset + 4));
}

export function decodeNonRidgeOpticalRows(values, rowCount) {
  if (!(values instanceof Float32Array)) throw new Error('Non-Ridge optical rows must be a Float32Array');
  if (!Number.isInteger(rowCount) || rowCount < 0) throw new Error('Non-Ridge optical row count must be a nonnegative integer');
  const expectedLength = rowCount * NONRIDGE_OPTICAL_ROW_STRIDE_FLOATS;
  if (values.length !== expectedLength) {
    throw new Error(`Non-Ridge optical capture must contain exactly ${expectedLength} values, received ${values.length}`);
  }
  const rows = new Array(rowCount);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const offset = rowIndex * NONRIDGE_OPTICAL_ROW_STRIDE_FLOATS;
    const rowValues = values.subarray(offset, offset + NONRIDGE_OPTICAL_ROW_STRIDE_FLOATS);
    for (let channelIndex = 0; channelIndex < rowValues.length; channelIndex += 1) {
      if (!Number.isFinite(rowValues[channelIndex])) {
        throw new Error(`Non-Ridge optical capture contains non-finite value at row ${rowIndex}, channel ${channelIndex}`);
      }
    }
    rows[rowIndex] = {
      worldPositionSupport: vec4(rowValues, 0),
      currentSidecar: vec4(rowValues, 4),
      currentMaterial: vec4(rowValues, 8),
      currentFire: vec4(rowValues, 12),
      currentMicro: vec4(rowValues, 16),
      sourceVelocity: vec4(rowValues, 20),
      sourceSupports: vec4(rowValues, 24),
      sourceTopology: vec4(rowValues, 28),
      nonRidgeEmissionExtinction: vec4(rowValues, 32),
      completeEmissionExtinction: vec4(rowValues, 36),
    };
  }
  return {
    identity: NONRIDGE_OPTICAL_ROW_IDENTITY,
    channelOrder: [...NONRIDGE_OPTICAL_ROW_CHANNELS],
    strideFloats: NONRIDGE_OPTICAL_ROW_STRIDE_FLOATS,
    rowCount,
    status: rowCount === 0 ? 'captured-negative' : 'captured',
    rows,
  };
}
