import {
  CURRENT16_ORDER,
  SOURCE_BASIS_GPU_ROW_FLOATS,
  SOURCE_BASIS_ORDER,
} from './volume-nonridge-source-basis-capture.mjs';

export const ANALYTICAL_ADMISSION_AUTHORITY = 'analytical-not-learned-membership-v0';
export const ANALYTICAL_ADMISSION_IDENTITY = 'explicit-ridge-union-promoted-nonridge-source-selector-v0';
export const ANALYTICAL_ADMISSION_ORDER = Object.freeze(['admission.ridge', 'admission.nonRidge']);
export const POST_ADMISSION_FEATURE_ORDER = Object.freeze([...CURRENT16_ORDER, ...SOURCE_BASIS_ORDER]);
export const COEFFICIENT_ORDER = Object.freeze([
  'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
]);

const RIDGE_THRESHOLD = 0.11;
const NONRIDGE_LOW = 1 / 255;
const NONRIDGE_HIGH = 3 / 255;
const NONRIDGE_ADMISSION_THRESHOLD = 0.5;
const COEFFICIENT_EPSILON = 1e-7;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function smoothstep(low, high, value) {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

function coefficientMaximum(values, offset) {
  return Math.max(values[offset], values[offset + 1], values[offset + 2], values[offset + 3]);
}

export function selectAnalyticalLayerRows({
  fullGridRows,
  effectiveControls,
  nativeCellIndexOffset = 0,
} = {}) {
  if (!(fullGridRows instanceof Float32Array) || fullGridRows.length % SOURCE_BASIS_GPU_ROW_FLOATS !== 0) {
    throw new Error(`analytical admission requires whole ${SOURCE_BASIS_GPU_ROW_FLOATS}-float rows`);
  }
  const gradientGain = Number(effectiveControls?.['boundary.gradientGain']);
  if (!Number.isFinite(gradientGain) || gradientGain < 0) {
    throw new Error('analytical admission requires a nonnegative finite boundary.gradientGain');
  }
  if (!Number.isInteger(nativeCellIndexOffset) || nativeCellIndexOffset < 0) {
    throw new Error('analytical admission requires a nonnegative integer nativeCellIndexOffset');
  }
  for (const value of fullGridRows) {
    if (!Number.isFinite(value)) throw new Error('analytical admission rejects non-finite full-grid values');
  }

  const sourceRowCount = fullGridRows.length / SOURCE_BASIS_GPU_ROW_FLOATS;
  const selectedRows = [];
  for (let rowIndex = 0; rowIndex < sourceRowCount; rowIndex += 1) {
    const offset = rowIndex * SOURCE_BASIS_GPU_ROW_FLOATS;
    const fireSignal = (
      fullGridRows[offset + 8] * 1.25
      + fullGridRows[offset + 10] * 0.52
      + fullGridRows[offset + 11] * 0.86
      + fullGridRows[offset + 14] * 0.72
      + fullGridRows[offset + 5] * 0.24
    );
    const ridgeStructuralSignal = (
      fullGridRows[offset + 2]
      * smoothstep(0.055, 0.32, fullGridRows[offset + 1])
      * smoothstep(0.018, 0.16, fireSignal)
    );
    const ridgeAdmission = ridgeStructuralSignal >= RIDGE_THRESHOLD ? 1 : 0;
    const normalizedFireSignal = clamp(fireSignal / 1.5, 0, 1);
    const nonRidgeTerm = gradientGain >= 1e-6 ? normalizedFireSignal : 0;
    const nonRidgeScore = smoothstep(NONRIDGE_LOW, NONRIDGE_HIGH, nonRidgeTerm);
    const nonRidgeAdmission = nonRidgeScore >= NONRIDGE_ADMISSION_THRESHOLD ? 1 : 0;
    if (ridgeAdmission === 0 && nonRidgeAdmission === 0) continue;
    if (ridgeAdmission === 0 && coefficientMaximum(fullGridRows, offset + 29) > COEFFICIENT_EPSILON) {
      throw new Error(`retained row ${rowIndex} carries Ridge coefficients outside Ridge admission`);
    }
    if (nonRidgeAdmission === 0 && coefficientMaximum(fullGridRows, offset + 25) > COEFFICIENT_EPSILON) {
      throw new Error(`retained row ${rowIndex} carries Non-Ridge coefficients outside Non-Ridge admission`);
    }
    selectedRows.push({ rowIndex, offset, ridgeAdmission, nonRidgeAdmission });
  }

  const count = selectedRows.length;
  const features = new Float32Array(count * POST_ADMISSION_FEATURE_ORDER.length);
  const admission = new Float32Array(count * ANALYTICAL_ADMISSION_ORDER.length);
  const nativeCellIndices = new Uint32Array(count);
  const coefficients = new Float32Array(count * COEFFICIENT_ORDER.length);
  selectedRows.forEach((selected, retainedIndex) => {
    const featureOffset = retainedIndex * POST_ADMISSION_FEATURE_ORDER.length;
    features.set(
      fullGridRows.subarray(selected.offset, selected.offset + POST_ADMISSION_FEATURE_ORDER.length),
      featureOffset,
    );
    admission[retainedIndex * 2] = selected.ridgeAdmission;
    admission[retainedIndex * 2 + 1] = selected.nonRidgeAdmission;
    nativeCellIndices[retainedIndex] = nativeCellIndexOffset + selected.rowIndex;
    const coefficientOffset = retainedIndex * COEFFICIENT_ORDER.length;
    coefficients.set(fullGridRows.subarray(selected.offset + 29, selected.offset + 33), coefficientOffset);
    coefficients.set(fullGridRows.subarray(selected.offset + 25, selected.offset + 29), coefficientOffset + 4);
  });

  return {
    authority: ANALYTICAL_ADMISSION_AUTHORITY,
    identity: ANALYTICAL_ADMISSION_IDENTITY,
    sourceRowCount,
    count,
    sampleCap: null,
    droppedAdmittedRowCount: 0,
    features,
    admission,
    nativeCellIndices,
    coefficients,
    selector: {
      ridge: {
        identity: 'state-derived-direct-flame-candidate-support-allocation-v0',
        expression: 'sidecar.ridge*smoothstep(0.055,0.32,sidecar.coverage)*smoothstep(0.018,0.16,fireSignal)',
        threshold: RIDGE_THRESHOLD,
      },
      nonRidge: {
        authority: 'explicit-source-field-operator-v0',
        expression: 'step(1e-6,boundary.gradientGain)*fire.signal',
        fireSignalExpression: 'clamp((1.25*fire.energy+0.52*fire.emission+0.86*fire.detail+0.72*micro.z+0.24*material.heat)/1.5,0,1)',
        low: NONRIDGE_LOW,
        high: NONRIDGE_HIGH,
        admissionThreshold: NONRIDGE_ADMISSION_THRESHOLD,
      },
    },
  };
}
