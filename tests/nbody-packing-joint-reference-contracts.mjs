import assert from 'node:assert/strict';
import test from 'node:test';

import { createNBodyRosetteFixture } from '../nbody-packing-assay-core.mjs';
import {
  NBODY_PACKING_JOINT_REFERENCE_RESULT_SCHEMA,
  createNBodyRosetteJointReferenceConfig,
  solveNBodyRosetteJointReference,
} from '../nbody-packing-joint-reference.mjs';

const PHYSICAL_TOLERANCE = 1e-7;

function byId(muscles) {
  return new Map(muscles.map(muscle => [muscle.id, muscle]));
}

function maximumEndpointDrift(source, muscles) {
  const sourceById = byId(source.muscles);
  let maximum = 0;
  for (const muscle of muscles) {
    const sourceMuscle = sourceById.get(muscle.id);
    for (const [knot, attachment] of [
      [muscle.centerline[0], sourceMuscle.attachments.origin],
      [muscle.centerline.at(-1), sourceMuscle.attachments.insertion],
    ]) {
      maximum = Math.max(
        maximum,
        Math.hypot(...knot.position.map((value, axis) => value - attachment.position[axis])),
      );
    }
  }
  return maximum;
}

test('joint reference requires an exact explicit optimization contract', () => {
  const fixture = createNBodyRosetteFixture();
  assert.throws(
    () => solveNBodyRosetteJointReference({ fixture }),
    /requestedConfig.*exact explicit/i,
  );
  const config = createNBodyRosetteJointReferenceConfig();
  assert.deepEqual(Object.keys(config).sort(), [
    'algorithm',
    'candidateEnumeration',
    'hardTolerance',
    'penaltySchedule',
    'startFamily',
    'stepSchedule',
    'translationBasis',
    'translationBounds',
  ]);
});

test('joint reference independently rejects a mutually consistent forged fixture identity', () => {
  const fixture = createNBodyRosetteFixture();
  const forgedIdentity = '0'.repeat(64);
  fixture.identity.sha256 = forgedIdentity;
  fixture.input.requested.sha256 = forgedIdentity;
  fixture.input.effective.sha256 = forgedIdentity;

  assert.throws(
    () => solveNBodyRosetteJointReference({
      fixture,
      requestedConfig:createNBodyRosetteJointReferenceConfig(),
    }),
    /fixture identity mismatch/,
  );
});

test('bounded joint reference clears global debt while preserving hard carrier invariants', () => {
  const fixture = createNBodyRosetteFixture();
  const requestedConfig = createNBodyRosetteJointReferenceConfig();
  const result = solveNBodyRosetteJointReference({ fixture, requestedConfig });

  assert.equal(result.schema, NBODY_PACKING_JOINT_REFERENCE_RESULT_SCHEMA);
  assert.equal(
    result.status,
    'converged-joint-reference',
    JSON.stringify({
      status:result.status,
      stationarity:result.stationarity,
      selected:{
        startName:result.selected.startName,
        vector:result.selected.vector,
        maximumPhysicalResidual:result.selected.maximumPhysicalResidual,
        deformationEnergy:result.selected.deformationEnergy,
      },
      multistart:result.multistart.rows.map(row => ({
        startName:row.startName,
        evaluationCount:row.evaluationCount,
        maximumPhysicalResidual:row.maximumPhysicalResidual,
        deformationEnergy:row.deformationEnergy,
      })),
    }),
  );
  assert.deepEqual(result.config.requested, requestedConfig);
  assert.deepEqual(result.config.effective, requestedConfig);
  assert.equal(result.config.fallbackUsed, false);
  assert.equal(result.fixture.sha256, fixture.identity.sha256);
  assert.equal(result.reference.algorithm, requestedConfig.algorithm);
  assert.equal(result.reference.sharedIterationState, true);
  assert.equal(result.reference.physicalResidualSeparatedFromAugmentedObjective, true);
  assert.equal(result.multistart.rows.length, requestedConfig.startFamily.length);
  assert.equal(result.multistart.rows.every(row => row.completed === true), true);
  assert.equal(result.multistart.rows.every(row => row.fallbackUsed === false), true);

  for (const key of [
    'pairwisePenetration',
    'skeletalPenetration',
    'compartmentEscape',
    'endpointDrift',
    'maximumRelativeVolumeError',
  ]) {
    assert.ok(
      result.selected.metrics[key] <= PHYSICAL_TOLERANCE,
      `${key} remained ${result.selected.metrics[key]}`,
    );
  }
  assert.ok(result.selected.belt.totalPenetration <= PHYSICAL_TOLERANCE);
  assert.equal(result.selected.metrics.nonFiniteValueCount, 0);
  assert.equal(result.selected.metrics.nonPositiveRadiusCount, 0);
  assert.ok(maximumEndpointDrift(fixture.crowded, result.selected.muscles) <= 1e-12);
  assert.ok(result.stationarity.projectedGradientInfinityNorm <= 5e-5);
  assert.equal(result.stationarity.kind, 'finite-difference-active-constraint-kkt');
  assert.ok(result.stationarity.activeConstraintCount > 0);
  assert.ok(result.distantResponse.movedMemberCount >= 3);
  assert.ok(result.distantResponse.maximumNonDriverDisplacement > 1e-4);
  assert.match(result.identity.sha256, /^[0-9a-f]{64}$/);
});

test('synchronous candidate enumeration cannot change the selected physical state', () => {
  const fixture = createNBodyRosetteFixture();
  const canonicalConfig = createNBodyRosetteJointReferenceConfig();
  const canonical = solveNBodyRosetteJointReference({
    fixture,
    requestedConfig:canonicalConfig,
  });
  assert.equal(canonical.invariance.candidateEnumeration, 'passed');
  assert.equal(canonical.invariance.mechanism, 'paired-full-solve-artifact-comparison');
  assert.deepEqual(
    canonical.invariance.rows.map(row => row.effectiveConfig.candidateEnumeration),
    ['canonical', 'reverse'],
  );
  assert.equal(canonical.invariance.rows.length, 2);
  for (const row of canonical.invariance.rows) {
    assert.deepEqual(row.requestedConfig, row.effectiveConfig);
    assert.equal(row.fallbackUsed, false);
    assert.equal(row.selectedVector.length, 10);
    assert.match(row.selectedPhysicalStateSha256, /^[0-9a-f]{64}$/);
    assert.match(row.selectedMetricsSha256, /^[0-9a-f]{64}$/);
    assert.match(row.selectedBeltSha256, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(canonical.invariance.comparison, {
    selectedVectorEqual:true,
    selectedPhysicalStateEqual:true,
    selectedMetricsEqual:true,
    selectedBeltEqual:true,
  });
});

test('bounded joint reference carries asymmetric skeletal clearance through stationarity refinement', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' });
  const base = createNBodyRosetteJointReferenceConfig();
  const config = {
    ...base,
    penaltySchedule:[1e11],
    stepSchedule:[
      0.04,
      0.01,
      0.0025,
      0.000625,
      0.00015625,
      0.0000390625,
      0.000009765625,
      0.00000244140625,
      0.0000006103515625,
      0.000000152587890625,
      0.0000000762939453125,
    ],
  };
  const result = solveNBodyRosetteJointReference({ fixture, requestedConfig:config });

  assert.equal(result.status, 'converged-joint-reference');
  assert.ok(result.selected.maximumPhysicalResidual <= config.hardTolerance);
  assert.ok(result.selected.metrics.pairwisePenetration <= config.hardTolerance);
  assert.ok(result.selected.metrics.skeletalPenetration <= config.hardTolerance);
  assert.ok(result.selected.metrics.compartmentEscape <= config.hardTolerance);
  assert.ok(result.stationarity.projectedGradientInfinityNorm <= 5e-5);
  assert.ok(
    result.stationarity.activeConstraints.some(row => row.kind === 'skeletal-clearance'),
    'the constrained optimum must retain the asymmetric bone as an active KKT row',
  );
  assert.equal(result.invariance.candidateEnumeration, 'passed');
});
