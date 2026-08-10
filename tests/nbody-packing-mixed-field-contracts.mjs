import assert from 'node:assert/strict';
import test from 'node:test';

import { createNBodyRosetteFixture } from '../nbody-packing-assay-core.mjs';
import {
  NBODY_PACKING_MIXED_FIELD_PROBLEM_SCHEMA,
  NBODY_PACKING_MIXED_FIELD_RESULT_SCHEMA,
  compileNBodyMixedFieldProblem,
  createNBodyMixedFieldConfig,
  solveNBodyMixedFieldCandidate,
} from '../nbody-packing-mixed-field.mjs';

function solveWith(configEdit = {}) {
  const key = JSON.stringify(configEdit);
  if (solveWith.cache.has(key)) return solveWith.cache.get(key);
  const fixture = createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' });
  const problem = compileNBodyMixedFieldProblem(fixture);
  const requestedConfig = { ...createNBodyMixedFieldConfig(), ...configEdit };
  const solved = { fixture, problem, requestedConfig, result:solveNBodyMixedFieldCandidate({
    problem,
    requestedConfig,
  }) };
  solveWith.cache.set(key, solved);
  return solved;
}
solveWith.cache = new Map();

function assertBoundedFieldFailure({ fixture, problem, requestedConfig, result }) {
  assert.equal(problem.schema, NBODY_PACKING_MIXED_FIELD_PROBLEM_SCHEMA);
  assert.equal(result.schema, NBODY_PACKING_MIXED_FIELD_RESULT_SCHEMA);
  assert.equal(result.status, 'stalled-mixed-field-candidate');
  assert.equal(result.source.fixtureSha256, fixture.identity.sha256);
  assert.equal(result.source.problemSha256, problem.identity.sha256);
  assert.equal(result.route.requested, result.route.effective);
  assert.equal(result.route.fallbackUsed, false);
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, false);
  assert.equal(result.mechanism.updateMode, 'one-field-snapshot-one-simultaneous-gather-apply');
  assert.deepEqual(result.mechanism.channels, [
    'identity-bearing-muscle-occupancy',
    'aggregate-overcapacity-pressure',
    'skeletal-exclusion-pressure',
    'compartment-boundary-pressure',
    'sharp-interface-traction',
  ]);
  assert.equal(result.selected.displacement.movedMemberCount >= 4, true);
  assert.ok(result.selected.maximumPhysicalResidual > requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.pairwisePenetration > requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.skeletalPenetration <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.compartmentEscape <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.endpointDrift <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.maximumRelativeVolumeError <= requestedConfig.convergenceTolerance);
  assert.equal(result.selected.identityLeakCount, 0);
  assert.equal(
    result.selected.pairwisePenetrationReceipt.kind,
    'continuous-all-pair-tapered-segment-minima',
  );
  assert.ok(result.selected.pairwisePenetrationReceipt.pairs.length > 0);
  assert.ok(Math.abs(
    result.selected.pairwisePenetrationReceipt.totalPenetration -
    result.selected.metrics.pairwisePenetration
  ) <= 1e-12);
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  assert.equal(result.failure.phase, 'mixed-field-admissibility-line-search');
  assert.equal(result.failure.lastTrustworthyEvidence, 'selected');
  assert.ok(result.work.rows.length > 0);
  assert.ok(result.work.lastField.occupancy.mixedSampleCount > 0);
  assert.ok(result.work.lastField.occupancy.pressureIntegral > 0);
  assert.ok(result.work.lastField.fieldContinuationScale >= 0);
  assert.ok(result.work.lastField.fieldContinuationScale <= 1);
  assert.equal(
    result.work.lastField.fieldContinuationScale,
    result.work.lastField.restoringContinuationScale,
  );
  for (const row of result.work.rows) {
    assert.ok(row.pairwisePenetrationAfter < row.pairwisePenetrationBefore);
    assert.ok(row.skeletalPenetrationAfter <= row.skeletalPenetrationBefore + 1e-12);
    assert.ok(row.compartmentEscapeAfter <= row.compartmentEscapeBefore + 1e-12);
  }
}

test('mixed field compiler independently rejects a mutually consistent forged fixture identity', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' });
  const forged = '0'.repeat(64);
  fixture.identity.sha256 = forged;
  fixture.input.requested.sha256 = forged;
  fixture.input.effective.sha256 = forged;
  assert.throws(() => compileNBodyMixedFieldProblem(fixture), /fixture identity mismatch/);
});

test('mixed field requires the complete explicit requested configuration', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' });
  const problem = compileNBodyMixedFieldProblem(fixture);
  const requestedConfig = createNBodyMixedFieldConfig();
  delete requestedConfig.fieldContinuationResidual;
  assert.throws(
    () => solveNBodyMixedFieldCandidate({ problem, requestedConfig }),
    /requires exact keys/,
  );
});

test('mixed muscle/bone/compartment field refuses false closure on the frustrated fixture', () => {
  assertBoundedFieldFailure(solveWith());
});

test('half-cell lattice translation preserves the same loud field failure class', () => {
  assertBoundedFieldFailure(solveWith({ latticeTranslation:[0.5, 0.5] }));
});

test('lattice refinement preserves the same loud field failure class', () => {
  assertBoundedFieldFailure(solveWith({ latticeResolution:[37, 43] }));
});

test('translated and refined lattices remain in one bounded failed physical class', () => {
  const rows = [
    solveWith(),
    solveWith({ latticeTranslation:[0.5, 0.5] }),
    solveWith({ latticeResolution:[37, 43] }),
  ];
  const vectors = rows.map(row => row.result.selected.vector);
  let maximumStateGap = 0;
  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      maximumStateGap = Math.max(
        maximumStateGap,
        ...vectors[left].map((value, axis) => Math.abs(value - vectors[right][axis])),
      );
    }
  }
  assert.ok(maximumStateGap <= 0.2, `cross-lattice state gap is ${maximumStateGap}`);
  assert.equal(new Set(rows.map(row => row.result.source.problemSha256)).size, 1);
  assert.ok(rows.every(row => row.result.selected.maximumPhysicalResidual > 1e-7));
  assert.ok(rows.every(row => row.result.selected.metrics.skeletalPenetration <= 1e-7));
  assert.ok(rows.every(row => row.result.selected.metrics.compartmentEscape <= 1e-7));
});
