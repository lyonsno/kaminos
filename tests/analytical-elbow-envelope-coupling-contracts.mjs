import assert from 'node:assert/strict';

import * as packingCore from '../constructional-packing-core.mjs';

const requiredApi = [
  'prepareExactElbowEnvelopeCouplingSource',
  'coupleExactElbowEnvelopeFromMuscleEdit',
  'compareExactElbowEnvelopeCoupling',
  'sampleExactElbowEnvelopeSurface',
];

for (const name of requiredApi) {
  assert.equal(
    typeof packingCore[name],
    'function',
    `exact-elbow envelope coupling contract requires ${name}`,
  );
}

const {
  createExactElbowPackingSource,
  solveExactElbowPacking,
  applyExactElbowMuscleVolumeEdit,
  prepareExactElbowEnvelopeCouplingSource,
  coupleExactElbowEnvelopeFromMuscleEdit,
  compareExactElbowEnvelopeCoupling,
  sampleExactElbowEnvelopeSurface,
} = packingCore;

const rawSource = createExactElbowPackingSource();
const rawBaseline = solveExactElbowPacking(rawSource);
const source = prepareExactElbowEnvelopeCouplingSource({ source: rawSource });
const baseline = solveExactElbowPacking(source);

assert.equal(source.domain.kind, 'radial-ellipsoid');
assert.deepEqual(source.domain.surfaceLobes, []);
assert.deepEqual(source.grid.logicalIndexOffset, [6, 6, 5]);
assert.ok(source.grid.width > rawSource.grid.width);
assert.ok(source.grid.height > rawSource.grid.height);
assert.ok(source.grid.depth > rawSource.grid.depth);
assert.equal(baseline.metrics.activeCellCount, rawBaseline.metrics.activeCellCount);
assert.equal(baseline.metrics.excludedRigidCellCount, rawBaseline.metrics.excludedRigidCellCount);
assert.deepEqual(
  baseline.cells.map(cell => cell.sourceCellId),
  rawBaseline.cells.map(cell => cell.sourceCellId),
  'padding must preserve the established cell lattice and source identities',
);

const edit = {
  id: 'swell-brachialis-18-percent-with-envelope-coupling',
  muscleId: 'brachialis-like-flexor',
  scale: 1.18,
};
const fixedEnvelopeSource = applyExactElbowMuscleVolumeEdit({ source, edit });
const fixedEnvelopeEdited = solveExactElbowPacking(fixedEnvelopeSource);
const fixedComparison = packingCore.compareExactElbowPackings({
  baseline,
  edited: fixedEnvelopeEdited,
});
assert.equal(fixedComparison.brachialisCellDelta, 268);
assert.equal(fixedComparison.residualCellDelta, -268);
assert.equal(fixedComparison.addedSourceCellCount, 0);

const response = coupleExactElbowEnvelopeFromMuscleEdit({
  source,
  baseline,
  fixedEnvelopeSource,
  fixedEnvelopeEdited,
  muscleId: 'brachialis-like-flexor',
});
assert.equal(response.ledger.schema, 'kaminos.exact-elbow-envelope-pressure-ledger.v0');
assert.equal(response.ledger.muscleCellDeficit, 268);
assert.equal(response.ledger.residualPolicy, 'preserve-baseline-volume');
assert.equal(response.source.domain.surfaceLobes.length, 1);
assert.ok(response.ledger.pressureDirection.every(Number.isFinite));
assert.ok(response.ledger.pressureDirection[0] > 0.9);
assert.ok(response.ledger.surfaceAmplitude > 0);

const coupled = solveExactElbowPacking(response.source);
const comparison = compareExactElbowEnvelopeCoupling({
  baseline,
  fixedEnvelopeEdited,
  coupled,
  ledger: response.ledger,
});

assert.equal(coupled.metrics.unownedCellCount, 0);
assert.equal(coupled.metrics.multiOwnedCellCount, 0);
assert.equal(coupled.metrics.rigidOwnedCellCount, 0);
assert.equal(coupled.metrics.finiteRigidOverlapCellCount, 0);
assert.equal(coupled.metrics.anchorViolationCount, 0);
assert.equal(comparison.muscleCellDeficit, 268);
assert.equal(comparison.addedActiveCellCount, 268);
assert.equal(comparison.addedSourceCellCount, 268);
assert.equal(comparison.lostSourceCellCount, 0);
assert.equal(comparison.brachialisCellDelta, 268);
assert.equal(comparison.tricepsCellDelta, 0);
assert.equal(comparison.residualCellDelta, 0);
assert.equal(comparison.rigidIdentityViolationCount, 0);
assert.equal(comparison.attachmentIdentityViolationCount, 0);
assert.equal(comparison.gridIdentityViolationCount, 0);
assert.equal(comparison.sharedUnchangedMaterialIdentityViolationCount, 0);
assert.equal(comparison.unexpectedSharedOwnerTransitionCount, 0);
assert.ok(comparison.localAddedCellFraction >= 0.9);
assert.ok(comparison.localSurfaceDisplacement > 0.04);
assert.ok(
  comparison.remoteSurfaceDisplacement < comparison.localSurfaceDisplacement * 0.08,
);
assert.ok(comparison.displacedVolumeError <= baseline.grid.cellVolume + 1e-12);

const localSurface = sampleExactElbowEnvelopeSurface(
  response.source.domain,
  response.ledger.pressureDirection,
);
const baselineLocalSurface = sampleExactElbowEnvelopeSurface(
  source.domain,
  response.ledger.pressureDirection,
);
assert.ok(localSurface.distance > baselineLocalSurface.distance);

assert.deepEqual(
  coupleExactElbowEnvelopeFromMuscleEdit({
    source,
    baseline,
    fixedEnvelopeSource,
    fixedEnvelopeEdited,
    muscleId: 'brachialis-like-flexor',
  }),
  response,
  'coupled envelope response must be deterministic',
);

assert.throws(
  () => coupleExactElbowEnvelopeFromMuscleEdit({
    source,
    baseline: { ...baseline, sourceId: 'wrong-source' },
    fixedEnvelopeSource,
    fixedEnvelopeEdited,
    muscleId: 'brachialis-like-flexor',
  }),
  /same prepared source/,
);

console.log('analytical elbow envelope coupling contracts passed');
