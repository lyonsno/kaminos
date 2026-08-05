import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createM31GeneratedRelationTransfer } from
  '../m31-generated-relation-transfer-core.mjs';

const PREDECESSOR_TRANSFER_HASH =
  '2dbda39c73f1026c04440fd1e3c83b6b22f6d5562d5e1a6172a86e492c47fbac';
const sourceFixture = JSON.parse(await readFile(new URL(
  '../artifacts/m31-generated-relation-positive-volume-transfer-v0/source-fixture.json',
  import.meta.url,
), 'utf8'));

const predecessor = createM31GeneratedRelationTransfer(sourceFixture);
assert.equal(predecessor.status, 'M31_TRANSFER_COMPLETE');
assert.equal(predecessor.producerEnvelope.transfer_hash, PREDECESSOR_TRANSFER_HASH,
  'the +35 assay must not change the accepted neutral/+24 producer');
assert.deepEqual(predecessor.poses.map(pose => pose.angleDegrees), [0, 24]);

const crossover = createM31GeneratedRelationTransfer(sourceFixture, {
  crossoverAngleDegrees: 35,
});

assert.equal(crossover.schema, 'kaminos.m31-generated-relation-crossover.v0');
assert.equal(crossover.requestedRoute, predecessor.requestedRoute);
assert.equal(crossover.effectiveRoute, predecessor.effectiveRoute);
assert.equal(crossover.fallbackUsed, false);
assert.equal(crossover.predecessorTransferHash, PREDECESSOR_TRANSFER_HASH);
assert.deepEqual(crossover.poses.map(pose => pose.angleDegrees), [0, 35],
  'the untuned crossover must change only the positive pose angle');
assert.deepEqual(crossover.identityMap, predecessor.identityMap);
assert.deepEqual(crossover.semanticMemberships, predecessor.semanticMemberships);
assert.deepEqual(crossover.coreIdentity, predecessor.coreIdentity);
assert.ok(crossover.poses.every(pose => pose.outputVertices.length === 300));
assert.ok(crossover.poses.every(pose => pose.outputTriangles.length === 596));

const posed = crossover.poses[1];
const allHardVetoesPass = Object.values(posed.hardVetoes)
  .every(veto => veto.pass === true);
const cP0Q95 = posed.matchedDistortion.q95AbsoluteLogEdgeStrain;
const scalarQ95 = posed.matchedDistortion.scalarControlQ95AbsoluteLogEdgeStrain;
const expectedClassification = !allHardVetoesPass
  ? 'EARLIEST_TRANSFER_RANGE_FAILURE'
  : cP0Q95 < scalarQ95
    ? 'ANGLE_DEPENDENT_CROSSOVER'
    : 'GEOMETRY_SPECIFIC_SYNTHETIC_ADVANTAGE';
assert.equal(crossover.numericalClassification, expectedClassification);
assert.equal(crossover.classificationPredicate.cP0Q95AbsoluteLogEdgeStrain, cP0Q95);
assert.equal(crossover.classificationPredicate.scalarControlQ95AbsoluteLogEdgeStrain,
  scalarQ95);
assert.equal(crossover.classificationPredicate.allHardVetoesPass, allHardVetoesPass);
assert.equal(crossover.classificationPredicate.visibleRetentionPass, null,
  'visual retention remains unclassified until the locked witness is inspected');

const replay = createM31GeneratedRelationTransfer(sourceFixture, {
  crossoverAngleDegrees: 35,
});
assert.equal(crossover.producerEnvelope.transfer_hash,
  replay.producerEnvelope.transfer_hash,
  'the +35 transfer identity must be content-addressed rather than clock-addressed');

assert.throws(() => createM31GeneratedRelationTransfer(sourceFixture, {
  crossoverAngleDegrees: 36,
}), /only the frozen \+35 crossover is admitted/);

console.log('m31 generated-relation +35 crossover contracts passed');
