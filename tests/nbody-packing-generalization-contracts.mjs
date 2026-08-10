import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNBodyPackingGeneralizationSuite,
} from '../nbody-packing-assay-core.mjs';
import {
  compileNBodyUnifiedKktProblem,
  createNBodyUnifiedKktConfig,
  solveNBodyUnifiedKktCandidate,
} from '../nbody-packing-unified-kkt.mjs';

const COUNTS = [4, 6, 8];

test('generalization suite is a deterministic manufactured-feasible 4/6/8 ladder', () => {
  const suite = createNBodyPackingGeneralizationSuite();
  assert.deepEqual(suite.map(row => row.knownFeasible.muscles.length), COUNTS);
  assert.deepEqual(createNBodyPackingGeneralizationSuite(), suite);
  assert.equal(new Set(suite.map(row => row.identity.sha256)).size, COUNTS.length);

  for (const fixture of suite) {
    assert.equal(fixture.authority.kind, 'synthetic-known-feasible');
    assert.equal(fixture.authority.anatomicalAdmission, 'none');
    assert.equal(fixture.derivation.kind, 'known-feasible-witness-then-deterministic-crowding');
    assert.equal(fixture.derivation.fallbackUsed, false);
    assert.ok(fixture.metrics.knownFeasible.pairwisePenetration <= 1e-9);
    assert.ok(fixture.metrics.knownFeasible.skeletalPenetration <= 1e-9);
    assert.ok(fixture.metrics.knownFeasible.compartmentEscape <= 1e-9);
    assert.ok(fixture.metrics.crowded.pairwisePenetration >= 0.05);
    assert.equal(fixture.metrics.crowded.endpointDrift, 0);
    assert.ok(fixture.metrics.crowded.maximumRelativeVolumeError <= 1e-9);
    assert.equal(fixture.input.requested.sha256, fixture.identity.sha256);
    assert.deepEqual(fixture.input.requested, fixture.input.effective);
  }
});

test('unified formulation closes every generalization rung without oracle or graph input', () => {
  for (const fixture of createNBodyPackingGeneralizationSuite()) {
    const problem = compileNBodyUnifiedKktProblem(fixture);
    assert.equal('contactGraph' in problem, false);
    assert.equal('knownFeasible' in problem, false);
    const requestedConfig = createNBodyUnifiedKktConfig();
    const result = solveNBodyUnifiedKktCandidate({ problem, requestedConfig });
    assert.equal(
      result.status,
      'converged-unified-kkt-candidate',
      `${fixture.id} failed at ${result.failure?.phase || 'unknown phase'}: ` +
        JSON.stringify(result.selected.metrics),
    );
    assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
    assert.equal(result.mechanism.contactGraphRowsConsumed, false);
    assert.ok(result.selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance);
    assert.equal(
      result.selected.displacement.movedMemberCount,
      fixture.crowded.muscles.length,
    );
    assert.equal(result.invariance.candidateEnumeration, 'passed');
  }
});
