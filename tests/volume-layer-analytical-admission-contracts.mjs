import assert from 'node:assert/strict';

import {
  ANALYTICAL_ADMISSION_AUTHORITY,
  ANALYTICAL_ADMISSION_IDENTITY,
  ANALYTICAL_ADMISSION_ORDER,
  COEFFICIENT_ORDER,
  POST_ADMISSION_FEATURE_ORDER,
  selectAnalyticalLayerRows,
} from '../volume-layer-analytical-admission.mjs';
import {
  CURRENT16_ORDER,
  SOURCE_BASIS_GPU_ROW_FLOATS,
  SOURCE_BASIS_ORDER,
} from '../volume-nonridge-source-basis-capture.mjs';

assert.equal(ANALYTICAL_ADMISSION_AUTHORITY, 'analytical-not-learned-membership-v0');
assert.equal(ANALYTICAL_ADMISSION_IDENTITY, 'explicit-ridge-union-promoted-nonridge-source-selector-v0');
assert.deepEqual(ANALYTICAL_ADMISSION_ORDER, ['admission.ridge', 'admission.nonRidge']);
assert.deepEqual(POST_ADMISSION_FEATURE_ORDER, [...CURRENT16_ORDER, ...SOURCE_BASIS_ORDER]);
assert.deepEqual(COEFFICIENT_ORDER, [
  'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
]);

function row({
  ridge = 0,
  coverage = 0,
  heat = 0,
  fireEnergy = 0,
  fireEmission = 0,
  fireDetail = 0,
  microZ = 0,
  sourceBasis = [],
  nonRidge = [0, 0, 0, 0],
  ridgeCoefficients = [0, 0, 0, 0],
} = {}) {
  const values = new Float32Array(SOURCE_BASIS_GPU_ROW_FLOATS);
  values[1] = coverage;
  values[2] = ridge;
  values[5] = heat;
  values[8] = fireEnergy;
  values[10] = fireEmission;
  values[11] = fireDetail;
  values[14] = microZ;
  sourceBasis.forEach((value, index) => { values[CURRENT16_ORDER.length + index] = value; });
  values[24] = nonRidge.some(value => value > 0) ? 1 : 0;
  values.set(nonRidge.slice(0, 3), 25);
  values[28] = nonRidge[3];
  values.set(ridgeCoefficients, 29);
  return values;
}

const fullGridRows = new Float32Array([
  ...row({
    ridge: 1,
    coverage: 1,
    fireEnergy: 0.5,
    fireEmission: 0.3,
    fireDetail: 0.2,
    microZ: 0.1,
    sourceBasis: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    nonRidge: [0.2, 0.15, 0.1, 0.05],
    ridgeCoefficients: [0.8, 0.6, 0.4, 0.2],
  }),
  ...row({
    fireEnergy: 0.03,
    nonRidge: [0.3, 0.2, 0.1, 0.08],
  }),
  ...row(),
]);

const selected = selectAnalyticalLayerRows({
  fullGridRows,
  effectiveControls: { 'boundary.gradientGain': 1.8 },
  nativeCellIndexOffset: 4096,
});

assert.equal(selected.sourceRowCount, 3);
assert.equal(selected.count, 2);
assert.equal(selected.sampleCap, null);
assert.equal(selected.droppedAdmittedRowCount, 0);
assert.deepEqual(Array.from(selected.nativeCellIndices), [4096, 4097]);
assert.deepEqual(Array.from(selected.admission), [1, 1, 0, 1]);
assert.equal(selected.features.length, 2 * POST_ADMISSION_FEATURE_ORDER.length);
assert.deepEqual(
  Array.from(selected.features.slice(POST_ADMISSION_FEATURE_ORDER.length, POST_ADMISSION_FEATURE_ORDER.length + CURRENT16_ORDER.length)),
  Array.from(fullGridRows.slice(SOURCE_BASIS_GPU_ROW_FLOATS, SOURCE_BASIS_GPU_ROW_FLOATS + CURRENT16_ORDER.length)),
);
assert.deepEqual(Array.from(selected.coefficients.slice(0, 8)), [
  Math.fround(0.8), Math.fround(0.6), Math.fround(0.4), Math.fround(0.2),
  Math.fround(0.2), Math.fround(0.15), Math.fround(0.1), Math.fround(0.05),
]);
assert.deepEqual(Array.from(selected.coefficients.slice(8, 16)), [
  0, 0, 0, 0,
  Math.fround(0.3), Math.fround(0.2), Math.fround(0.1), Math.fround(0.08),
]);
assert.equal(selected.selector.ridge.threshold, 0.11);
assert.equal(selected.selector.nonRidge.low, 1 / 255);
assert.equal(selected.selector.nonRidge.high, 3 / 255);
assert.equal(selected.selector.nonRidge.admissionThreshold, 0.5);
assert.equal(selected.selector.nonRidge.expression, 'step(1e-6,boundary.gradientGain)*fire.signal');

const gradientDisabled = selectAnalyticalLayerRows({
  fullGridRows: fullGridRows.slice(SOURCE_BASIS_GPU_ROW_FLOATS, SOURCE_BASIS_GPU_ROW_FLOATS * 2),
  effectiveControls: { 'boundary.gradientGain': 0 },
});
assert.equal(gradientDisabled.count, 0, 'the black authored control must admit no Non-Ridge-only rows');

assert.throws(() => selectAnalyticalLayerRows({
  fullGridRows: new Float32Array(SOURCE_BASIS_GPU_ROW_FLOATS - 1),
  effectiveControls: { 'boundary.gradientGain': 1 },
}), /whole 33-float rows/);
assert.throws(() => selectAnalyticalLayerRows({
  fullGridRows,
  effectiveControls: {},
}), /boundary\.gradientGain/);
assert.throws(() => selectAnalyticalLayerRows({
  fullGridRows,
  effectiveControls: { 'boundary.gradientGain': 1 },
  nativeCellIndexOffset: 0.5,
}), /nativeCellIndexOffset/);

console.log('volume layer analytical admission contracts passed');
