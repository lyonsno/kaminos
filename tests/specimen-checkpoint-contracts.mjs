import assert from 'node:assert/strict';

import {
  SPECIMEN_CHECKPOINT_SCHEMA,
  SPECIMEN_VIEW_ARTIFACT_SCHEMA,
  createFixturePrimitiveSpecimenCheckpoint,
  exportSpecimenCheckpointViews,
  specimenCheckpointWitness,
} from '../specimen-checkpoint.mjs';

const checkpoint = createFixturePrimitiveSpecimenCheckpoint({
  specimenId: 'fixture-red-lerm-primitive-001',
  specimenKind: 'red_lerm',
  firstVerticalRole: 'carrier_actor',
  primitiveKind: 'red_lerm_blob',
});

assert.equal(SPECIMEN_CHECKPOINT_SCHEMA, 'kaminos.specimen-checkpoint.v0');
assert.equal(SPECIMEN_VIEW_ARTIFACT_SCHEMA, 'kaminos.specimen-view-artifact.v0');
assert.equal(checkpoint.schema, SPECIMEN_CHECKPOINT_SCHEMA);
assert.equal(checkpoint.specimenId, 'fixture-red-lerm-primitive-001');
assert.equal(checkpoint.specimenKind, 'red_lerm');
assert.equal(checkpoint.firstVerticalRole, 'carrier_actor');
assert.equal(checkpoint.checkpointKind, 'fixture_primitive');
assert.deepEqual(checkpoint.primitiveStack.map(primitive => primitive.kind), ['red_lerm_blob', 'sensing_nub', 'carry_groove']);
assert.equal(checkpoint.cameraRig.view, 'front_three_quarter');
assert.ok(checkpoint.regionMasks.some(mask => mask.role === 'sacred_no_face_cap'), 'checkpoint must carry a no-face region law');
assert.ok(checkpoint.negativeLaw.includes('no_visible_eyes'), 'checkpoint must carry negative law for the red-lerm no-eye contract');
assert.equal(checkpoint.routeReceipt.requestedRoute, 'primitive_specimen_export');
assert.equal(checkpoint.routeReceipt.effectiveRoute, 'fixture_primitive_export');
assert.ok(checkpoint.sourceTruthWarnings.includes('fixture_primitive_not_live_sculpt_truth'));
assert.ok(checkpoint.routeReceipt.sourceTruthWarnings.includes('route_receipt_requested_effective_mismatch'));

const viewArtifacts = exportSpecimenCheckpointViews(checkpoint);
assert.deepEqual(viewArtifacts.map(artifact => artifact.viewKind), ['beauty', 'depth', 'normal', 'silhouette', 'mask']);

for (const artifact of viewArtifacts) {
  assert.equal(artifact.schema, SPECIMEN_VIEW_ARTIFACT_SCHEMA);
  assert.equal(artifact.specimenCheckpointId, checkpoint.specimenId);
  assert.equal(artifact.specimenKind, checkpoint.specimenKind);
  assert.equal(artifact.firstVerticalRole, checkpoint.firstVerticalRole);
  assert.equal(artifact.sourceKind, 'fixture');
  assert.ok(artifact.conditioningRoles.includes(`${artifact.viewKind}_source`), `${artifact.viewKind} artifact must advertise its conditioning role`);
  assert.equal(artifact.routeReceipt.requestedRoute, checkpoint.routeReceipt.requestedRoute);
  assert.equal(artifact.routeReceipt.effectiveRoute, checkpoint.routeReceipt.effectiveRoute);
  assert.ok(artifact.sourceTruthWarnings.includes('fixture_primitive_not_live_sculpt_truth'));
  assert.equal(artifact.imageArtifact.schema, 'kaminos.kiln.image-artifact.v0');
  assert.equal(artifact.imageArtifact.artifactId, artifact.artifactId);
  assert.equal(artifact.imageArtifact.viewKind, artifact.viewKind);
  assert.match(artifact.imageArtifact.source, /^data:image\/svg\+xml;base64,/);
}

const witness = specimenCheckpointWitness({ checkpoint, viewArtifacts });
assert.equal(witness.schema, 'kaminos.specimen-checkpoint-witness.v0');
assert.equal(witness.ok, true);
assert.equal(witness.checkpointSchema, SPECIMEN_CHECKPOINT_SCHEMA);
assert.equal(witness.viewArtifactSchema, SPECIMEN_VIEW_ARTIFACT_SCHEMA);
assert.deepEqual(witness.viewKinds, ['beauty', 'depth', 'normal', 'silhouette', 'mask']);
assert.ok(witness.sourceTruthWarnings.includes('fixture_primitive_not_live_sculpt_truth'));
