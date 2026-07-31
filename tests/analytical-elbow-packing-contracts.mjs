import assert from 'node:assert/strict';

import * as packingCore from '../constructional-packing-core.mjs';

const requiredApi = [
  'createExactElbowPackingSource',
  'solveExactElbowPacking',
  'applyExactElbowMuscleVolumeEdit',
  'compareExactElbowPackings',
];

for (const name of requiredApi) {
  assert.equal(
    typeof packingCore[name],
    'function',
    `exact-elbow 3D packing contract requires ${name}`,
  );
}

const {
  createExactElbowPackingSource,
  solveExactElbowPacking,
  applyExactElbowMuscleVolumeEdit,
  compareExactElbowPackings,
} = packingCore;

const source = createExactElbowPackingSource();
assert.equal(source.schema, 'kaminos.exact-elbow-packing-source.v0');
assert.equal(source.dimension, 3);
assert.equal(source.flexionDegrees, 35);
assert.deepEqual(source.authority, {
  kind: 'synthetic-proxy',
  anatomicalAdmission: 'none',
});
assert.deepEqual(
  source.elbowDescriptor.attachments.map(attachment => attachment.id),
  [
    'brachialis-origin',
    'brachialis-insertion',
    'triceps-origin',
    'triceps-insertion',
  ],
);

const baseline = solveExactElbowPacking(source);
assert.equal(baseline.schema, 'kaminos.exact-elbow-packing-result.v0');
assert.equal(baseline.dimension, 3);
assert.equal(baseline.sourceId, source.id);
assert.equal(baseline.metrics.unownedCellCount, 0);
assert.equal(baseline.metrics.multiOwnedCellCount, 0);
assert.equal(baseline.metrics.rigidOwnedCellCount, 0);
assert.equal(baseline.metrics.finiteRigidOverlapCellCount, 0);
assert.equal(baseline.metrics.anchorViolationCount, 0);
assert.ok(baseline.metrics.activeCellCount > 5_000);
assert.ok(baseline.metrics.excludedRigidCellCount > 0);
assert.deepEqual(
  Object.keys(baseline.compartments).sort(),
  [
    'brachialis-like-flexor',
    'monoarticular-triceps-like-extensor',
    'residual-tissue',
  ],
);
for (const compartment of Object.values(baseline.compartments)) {
  assert.ok(compartment.cellCount > 0);
  assert.ok(compartment.targetVolumeError <= baseline.grid.cellVolume + 1e-12);
}
for (const cell of baseline.cells) {
  assert.equal(cell.sourceCellId, `${source.domain.id}:${cell.ix}:${cell.iy}:${cell.iz}`);
  assert.equal(cell.material.length, 3);
  assert.ok(cell.material.every(Number.isFinite));
}
assert.deepEqual(solveExactElbowPacking(source), baseline);

const editedSource = applyExactElbowMuscleVolumeEdit({
  source,
  edit: {
    id: 'swell-brachialis-18-percent',
    muscleId: 'brachialis-like-flexor',
    scale: 1.18,
  },
});
assert.notEqual(editedSource, source);
assert.equal(editedSource.id, source.id);
assert.equal(editedSource.parentSourceId, source.id);
assert.equal(
  source.elbowDescriptor.muscles.find(muscle => muscle.id === 'brachialis-like-flexor').targetVolume,
  0.105,
);
assert.equal(
  editedSource.elbowDescriptor.muscles.find(muscle => muscle.id === 'brachialis-like-flexor').targetVolume,
  0.1239,
);
assert.equal(
  editedSource.elbowDescriptor.muscles.find(muscle => muscle.id === 'monoarticular-triceps-like-extensor').targetVolume,
  0.09,
);
assert.deepEqual(editedSource.domain, source.domain);
assert.deepEqual(
  editedSource.elbowDescriptor.attachments,
  source.elbowDescriptor.attachments,
);

const edited = solveExactElbowPacking(editedSource);
assert.equal(edited.metrics.unownedCellCount, 0);
assert.equal(edited.metrics.rigidOwnedCellCount, 0);
assert.equal(edited.metrics.finiteRigidOverlapCellCount, 0);
assert.equal(edited.metrics.anchorViolationCount, 0);
const comparison = compareExactElbowPackings({ baseline, edited });
assert.ok(comparison.changedOwnerCellCount > 0);
assert.ok(comparison.changedOwnerCellCount < baseline.metrics.activeCellCount * 0.2);
assert.ok(comparison.localChangeFraction >= 0.72);
assert.equal(comparison.lostSourceCellCount, 0);
assert.equal(comparison.addedSourceCellCount, 0);
assert.equal(comparison.unchangedMaterialIdentityViolationCount, 0);
assert.equal(comparison.attachmentIdentityViolationCount, 0);
assert.equal(comparison.rigidIdentityViolationCount, 0);
assert.equal(comparison.gridIdentityViolationCount, 0);
assert.equal(comparison.unexpectedOwnerTransitionCount, 0);
assert.deepEqual(comparison.ownerTransitionCounts, {
  'residual-tissue->brachialis-like-flexor': comparison.changedOwnerCellCount,
});
assert.ok(comparison.brachialisCellDelta > 0);
assert.equal(comparison.tricepsCellDelta, 0);
assert.equal(
  comparison.residualCellDelta,
  -comparison.brachialisCellDelta,
);

const rigidGeometryMutation = structuredClone(edited);
rigidGeometryMutation.elbow.rigidStructures[0].radius = 999;
rigidGeometryMutation.elbow.rigidStructures[1].start = [42, 42, 42];
assert.equal(
  compareExactElbowPackings({ baseline, edited: rigidGeometryMutation })
    .rigidIdentityViolationCount,
  1,
);

const unrelatedTransitionMutation = structuredClone(edited);
const editedTricepsCell = unrelatedTransitionMutation.cells.find(
  cell => cell.ownerId === 'monoarticular-triceps-like-extensor',
);
const editedResidualCell = unrelatedTransitionMutation.cells.find(
  cell => cell.ownerId === 'residual-tissue',
);
editedTricepsCell.ownerId = 'residual-tissue';
editedResidualCell.ownerId = 'monoarticular-triceps-like-extensor';
assert.equal(
  compareExactElbowPackings({ baseline, edited: unrelatedTransitionMutation })
    .unexpectedOwnerTransitionCount,
  2,
);

assert.throws(
  () => applyExactElbowMuscleVolumeEdit({
    source,
    edit: { id: 'unknown', muscleId: 'missing-muscle', scale: 1.1 },
  }),
  /unknown exact-elbow muscle/,
);
assert.throws(
  () => solveExactElbowPacking({
    ...structuredClone(source),
    grid: { ...source.grid, width: 0 },
  }),
  /grid dimensions/,
);
assert.throws(
  () => solveExactElbowPacking(applyExactElbowMuscleVolumeEdit({
    source,
    edit: { id: 'impossible', muscleId: 'brachialis-like-flexor', scale: 100 },
  })),
  /exceed available soft-tissue volume/,
);

console.log('analytical elbow 3D packing contracts passed');
