import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

function assertClose(actual, expected, tolerance = 1e-14) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected)),
    `expected ${actual} to be within ${tolerance} relative tolerance of ${expected}`,
  );
}

assert.equal(typeof kit.compareWebGpuParityArrays, 'function');
assert.equal(typeof kit.createWebGpuParityCaptureRegistry, 'function');

const {
  compareWebGpuParityArrays,
  createWebGpuParityCaptureRegistry,
} = kit;

assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1, 2]),
    new Float32Array([1]),
  ),
  /same length/,
);

assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1, Number.NaN]),
    new Float32Array([1, 2]),
  ),
  /non-finite/,
);

assert.throws(
  () => compareWebGpuParityArrays(new Float32Array(), new Float32Array()),
  /must not be empty/,
);
assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1]),
    new Float32Array([1]),
    { sampling: { mode: 'stride', stride: 0 } },
  ),
  /positive safe integer/,
);
assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1]),
    new Float32Array([1]),
    { sampling: { mode: 'all', stride: 0, offset: 99 } },
  ),
  /mode all.*stride 1.*offset 0/,
);

assert.throws(
  () => compareWebGpuParityArrays(
    new Float64Array([1]),
    new Float64Array([1]),
  ),
  /Float64Array.*unsupported.*Float32Array/,
);

const float32MinimumSubnormal = 2 ** -149;
const float32MinimumNormal = 2 ** -126;
const float32Maximum = 3.4028234663852886e38;

const subnormalEqualComparison = compareWebGpuParityArrays(
  new Float32Array([float32MinimumSubnormal, float32MinimumSubnormal]),
  new Float32Array([float32MinimumSubnormal, float32MinimumSubnormal]),
);
assert.equal(subnormalEqualComparison.actual.mean, float32MinimumSubnormal);
assert.equal(subnormalEqualComparison.actual.standardDeviation, 0);
assert.equal(subnormalEqualComparison.metrics.exactMatch, true);
assert.equal(subnormalEqualComparison.metrics.mismatchCount, 0);

const subnormalErrorComparison = compareWebGpuParityArrays(
  new Float32Array([float32MinimumSubnormal, float32MinimumSubnormal]),
  new Float32Array([0, 0]),
);
assert.equal(subnormalErrorComparison.metrics.meanAbsoluteError, float32MinimumSubnormal);
assertClose(subnormalErrorComparison.metrics.l2Error, Math.SQRT2 * float32MinimumSubnormal);
assert.equal(subnormalErrorComparison.metrics.relativeL2Error, null);
assert.equal(subnormalErrorComparison.metrics.relativeL2Status, 'infinite-zero-reference-norm');

const overflowingReferenceNorm = compareWebGpuParityArrays(
  new Float32Array([float32Maximum / 2, float32Maximum / 2]),
  new Float32Array([float32Maximum, float32Maximum]),
);
assertClose(overflowingReferenceNorm.metrics.relativeL2Error, 0.5, 1e-12);
assert.equal(overflowingReferenceNorm.metrics.relativeL2Status, 'defined');

const float32BoundaryComparison = compareWebGpuParityArrays(
  new Float32Array([0, float32MinimumSubnormal, float32MinimumNormal, 1, float32Maximum]),
  new Float32Array([0, float32MinimumSubnormal, float32MinimumNormal, 1, float32Maximum]),
);
assert.equal(float32BoundaryComparison.metrics.exactMatch, true);
assert.equal(float32BoundaryComparison.metrics.relativeL2Error, 0);
assert.ok(Number.isFinite(float32BoundaryComparison.actual.mean));
assert.ok(Number.isFinite(float32BoundaryComparison.actual.standardDeviation));

const cancellationComparison = compareWebGpuParityArrays(
  new Float32Array([float32Maximum, 1, -float32Maximum]),
  new Float32Array([float32Maximum, 1, -float32Maximum]),
);
assertClose(cancellationComparison.actual.mean, 1 / 3);
assertClose(cancellationComparison.reference.mean, 1 / 3);

const tinyRelativeComparison = compareWebGpuParityArrays(
  new Float32Array([0, float32Maximum]),
  new Float32Array([float32MinimumSubnormal, float32Maximum]),
);
assert.ok(tinyRelativeComparison.metrics.relativeL2Error > 0);
assert.equal(tinyRelativeComparison.metrics.relativeL2Status, 'defined');

const signedZeroComparison = compareWebGpuParityArrays(
  new Float32Array([-0]),
  new Float32Array([0]),
);
assert.equal(signedZeroComparison.metrics.exactMatch, true);
assert.equal(signedZeroComparison.metrics.mismatchCount, 0);

for (const value of [
  -float32Maximum,
  -1,
  -float32MinimumNormal,
  -float32MinimumSubnormal,
  0,
  float32MinimumSubnormal,
  float32MinimumNormal,
  1,
  float32Maximum,
]) {
  const constant = new Float32Array([value, value]);
  const boundaryComparison = compareWebGpuParityArrays(constant, constant);
  assert.equal(boundaryComparison.metrics.exactMatch, true);
  assert.equal(boundaryComparison.metrics.mismatchCount, 0);
  assert.equal(boundaryComparison.actual.mean, value);
  assert.equal(boundaryComparison.actual.standardDeviation, 0);
  assert.equal(boundaryComparison.metrics.relativeL2Error, 0);
}

assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1]),
    new Uint32Array([1]),
  ),
  /same typed array constructor/,
);

const integerComparison = compareWebGpuParityArrays(
  new Uint32Array([0, 4_294_967_295]),
  new Uint32Array([0, 4_294_967_294]),
);
assert.deepEqual(integerComparison.comparisonDomain, {
  mode: 'integer-exact',
  effectiveType: 'Uint32Array',
  normalization: 'none',
});
assert.equal(integerComparison.metrics.exactMatch, false);
assert.equal(integerComparison.metrics.mismatchCount, 1);
assert.equal(integerComparison.metrics.maxAbsoluteError, 1);

for (const Constructor of [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
]) {
  const integerBoundary = compareWebGpuParityArrays(
    new Constructor([0, 1]),
    new Constructor([0, 1]),
  );
  assert.equal(integerBoundary.comparisonDomain.mode, 'integer-exact');
  assert.equal(integerBoundary.comparisonDomain.effectiveType, Constructor.name);
  assert.equal(integerBoundary.metrics.exactMatch, true);
  assert.equal(integerBoundary.metrics.mismatchCount, 0);
}

assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1, 2]),
    new Float32Array([1, Number.POSITIVE_INFINITY]),
  ),
  /non-finite/,
);

const comparison = compareWebGpuParityArrays(
  new Float32Array([1, 2, 4, 8]),
  new Float32Array([1, 3, 4, 10]),
  {
    stageId: 'decoder.fusion',
    sampling: { mode: 'stride', stride: 2, offset: 1 },
  },
);

assert.equal(comparison.schema, 'kaminos.webgpu-parity-comparison.v0');
assert.equal(comparison.stageId, 'decoder.fusion');
assert.equal(comparison.sourceElementCount, 4);
assert.equal(comparison.comparedElementCount, 2);
assert.equal(comparison.actualType, 'Float32Array');
assert.equal(comparison.referenceType, 'Float32Array');
assert.deepEqual(comparison.comparisonDomain, {
  mode: 'float32-metrics',
  effectiveType: 'Float32Array',
  normalization: 'none',
});
assert.deepEqual(comparison.sampling, {
  mode: 'stride',
  stride: 2,
  offset: 1,
  firstSourceIndex: 1,
  lastSourceIndex: 3,
});
assert.equal(comparison.metrics.maxAbsoluteError, 2);
assert.equal(comparison.metrics.exactMatch, false);
assert.equal(comparison.metrics.mismatchCount, 2);
assert.equal(comparison.metrics.worstSourceIndex, 3);
assert.equal(comparison.metrics.meanAbsoluteError, 1.5);
assertClose(comparison.metrics.rootMeanSquareError, Math.sqrt(2.5));
assertClose(comparison.metrics.l2Error, Math.sqrt(5));
assertClose(comparison.metrics.relativeL2Error, Math.sqrt(5 / 109));
assertClose(comparison.metrics.cosineSimilarity, 86 / Math.sqrt(68 * 109));
assert.equal(comparison.nonFinite.actual.count, 0);
assert.equal(comparison.nonFinite.reference.count, 0);
assert.deepEqual(comparison.actual, {
  min: 2,
  max: 8,
  mean: 5,
  standardDeviation: 3,
});
assert.deepEqual(comparison.reference, {
  min: 3,
  max: 10,
  mean: 6.5,
  standardDeviation: 3.5,
});

const zeroComparison = compareWebGpuParityArrays(
  new Float32Array([0, 0]),
  new Float32Array([0, 0]),
);
assert.equal(zeroComparison.metrics.relativeL2Error, 0);
assert.equal(zeroComparison.metrics.cosineSimilarity, null);
assert.deepEqual(JSON.parse(JSON.stringify(zeroComparison)).metrics, zeroComparison.metrics);

console.log('parity comparator contracts passed');
