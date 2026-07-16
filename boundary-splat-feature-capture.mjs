export const BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY = 'boundary-splat-selected-candidate-features-v0';
export const BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS = 16;
export const BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_IDENTITY = 'boundary-splat-fixed-candidate-supervision-v0';
export const BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS = 19;
const BOUNDARY_SPLAT_RENDER_CANDIDATE_STRIDE_FLOATS = 12;
export const BOUNDARY_SPLAT_FEATURE_ORDER = Object.freeze([
  'sidecar.support',
  'sidecar.coverage',
  'sidecar.ridge',
  'sidecar.footprint',
  'material.density',
  'material.heat',
  'material.fuel',
  'material.detail',
  'fire.energy',
  'fire.temperature',
  'fire.emission',
  'fire.detail',
  'micro.x',
  'micro.y',
  'micro.z',
  'micro.w',
]);
export const BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER = Object.freeze([
  'position.x',
  'position.y',
  'position.z',
  ...BOUNDARY_SPLAT_FEATURE_ORDER,
]);

function packFloat32Base64(values) {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = '';
  const chunkBytes = 32768;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes)));
  }
  return {
    packedEncoding: 'float32-le-base64',
    packedByteLength: bytes.byteLength,
    packedFloat32Base64: btoa(binary),
  };
}

export function decodeBoundarySplatFeatureCapture(values, rowCount, capacity, { includeRows = true } = {}) {
  if (!(values instanceof Float32Array)) throw new Error('feature capture values must be a Float32Array');
  if (!Number.isInteger(rowCount) || rowCount <= 0) throw new Error('feature capture row count must be a positive integer');
  if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('feature capture capacity must be a positive integer');
  if (rowCount > capacity) throw new Error(`feature capture row count ${rowCount} exceeds capacity ${capacity}`);
  const expectedLength = rowCount * BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS;
  if (values.length !== expectedLength) throw new Error(`feature capture must contain exactly ${expectedLength} values, received ${values.length}`);

  const minima = new Array(BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS).fill(Number.POSITIVE_INFINITY);
  const maxima = new Array(BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS).fill(Number.NEGATIVE_INFINITY);
  const sums = new Array(BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS).fill(0);
  const rows = includeRows ? new Array(rowCount) : null;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = new Array(BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS);
    const offset = rowIndex * BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS;
    for (let featureIndex = 0; featureIndex < BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS; featureIndex += 1) {
      const value = values[offset + featureIndex];
      if (!Number.isFinite(value)) throw new Error(`feature capture contains non-finite value at row ${rowIndex}, feature ${featureIndex}`);
      row[featureIndex] = value;
      minima[featureIndex] = Math.min(minima[featureIndex], value);
      maxima[featureIndex] = Math.max(maxima[featureIndex], value);
      sums[featureIndex] += value;
    }
    if (rows) rows[rowIndex] = row;
  }

  const capture = {
    identity: BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY,
    featureOrder: [...BOUNDARY_SPLAT_FEATURE_ORDER],
    strideFloats: BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS,
    rowCount,
    statistics: BOUNDARY_SPLAT_FEATURE_ORDER.map((feature, index) => ({
      feature,
      min: minima[index],
      max: maxima[index],
      mean: sums[index] / rowCount,
    })),
  };
  if (rows) capture.rows = rows;
  return capture;
}

export function packBoundarySplatFeatureCapture(values, rowCount, capacity) {
  const capture = decodeBoundarySplatFeatureCapture(values, rowCount, capacity, { includeRows: false });
  return {
    ...capture,
    ...packFloat32Base64(values),
  };
}

export function packBoundarySplatSupervisionCandidates(
  candidateValues,
  featureValues,
  rowCount,
  capacity,
  candidateStrideFloats = BOUNDARY_SPLAT_RENDER_CANDIDATE_STRIDE_FLOATS,
) {
  if (!(candidateValues instanceof Float32Array)) throw new Error('candidate values must be a Float32Array');
  if (!(featureValues instanceof Float32Array)) throw new Error('feature values must be a Float32Array');
  if (!Number.isInteger(rowCount) || rowCount <= 0) throw new Error('supervision row count must be a positive integer');
  if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('supervision capacity must be a positive integer');
  if (rowCount > capacity) throw new Error(`supervision row count ${rowCount} exceeds capacity ${capacity}`);
  if (!Number.isInteger(candidateStrideFloats) || candidateStrideFloats < 3) {
    throw new Error('candidate stride must be an integer of at least three floats');
  }
  const expectedCandidateValues = rowCount * candidateStrideFloats;
  const expectedFeatureValues = rowCount * BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS;
  if (candidateValues.length !== expectedCandidateValues) {
    throw new Error(`candidate values must contain exactly ${expectedCandidateValues} values (${rowCount} × ${candidateStrideFloats})`);
  }
  if (featureValues.length !== expectedFeatureValues) {
    throw new Error(`feature values must contain exactly ${expectedFeatureValues} values (${rowCount} × ${BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS})`);
  }

  const packed = new Float32Array(rowCount * BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const candidateOffset = rowIndex * candidateStrideFloats;
    const featureOffset = rowIndex * BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS;
    const packedOffset = rowIndex * BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS;
    packed[packedOffset] = candidateValues[candidateOffset];
    packed[packedOffset + 1] = candidateValues[candidateOffset + 1];
    packed[packedOffset + 2] = candidateValues[candidateOffset + 2];
    for (let featureIndex = 0; featureIndex < BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS; featureIndex += 1) {
      const value = featureValues[featureOffset + featureIndex];
      if (!Number.isFinite(value)) throw new Error(`feature values contain non-finite value at row ${rowIndex}, feature ${featureIndex}`);
      packed[packedOffset + 3 + featureIndex] = value;
    }
    for (let positionIndex = 0; positionIndex < 3; positionIndex += 1) {
      if (!Number.isFinite(packed[packedOffset + positionIndex])) {
        throw new Error(`candidate values contain non-finite position at row ${rowIndex}, component ${positionIndex}`);
      }
    }
  }

  return {
    identity: BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_IDENTITY,
    candidateOrder: [...BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER],
    strideFloats: BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS,
    rowCount,
    capacity,
    ...packFloat32Base64(packed),
  };
}
