import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNBodyPackingGeneralizationSuite,
  createNBodyLongitudinalFalsifierFixture,
} from '../nbody-packing-assay-core.mjs';
import {
  compileNBodyAdaptiveKktProblem,
  compileNBodyUnifiedKktProblem,
  createNBodyAdaptiveKktConfig,
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

test('opposed longitudinal crowding is feasible but exceeds the one-direction belly carrier', () => {
  const fixture = createNBodyLongitudinalFalsifierFixture();
  assert.equal(fixture.knownFeasible.muscles.length, 6);
  assert.ok(fixture.metrics.knownFeasible.pairwisePenetration <= 1e-9);
  assert.ok(fixture.metrics.knownFeasible.skeletalPenetration <= 1e-9);
  assert.ok(fixture.metrics.knownFeasible.compartmentEscape <= 1e-9);
  assert.ok(fixture.metrics.crowded.pairwisePenetration >= 0.05);
  assert.equal(fixture.metrics.crowded.endpointDrift, 0);
  assert.ok(fixture.metrics.crowded.maximumRelativeVolumeError <= 1e-9);

  const problem = compileNBodyUnifiedKktProblem(fixture);
  assert.equal(problem.carrier.degreesOfFreedomPerMember, 2);
  const requestedConfig = createNBodyUnifiedKktConfig();
  const result = solveNBodyUnifiedKktCandidate({ problem, requestedConfig });
  assert.equal(result.status, 'stalled-unified-kkt-candidate');
  assert.equal(result.route.effective, 'unified-active-set-pair-bone-compartment-kkt-v0');
  assert.equal(result.failure?.phase, 'unified-kkt-globalization-line-search');
  assert.ok(result.selected.maximumPhysicalResidual >= 0.1);
});

test('generic two-mode longitudinal carrier closes the opposed fixture without target input', () => {
  const fixture = createNBodyLongitudinalFalsifierFixture();
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  assert.equal(problem.carrier.degreesOfFreedomPerMember, 4);
  assert.equal(problem.carrier.longitudinalModes.length, 2);
  assert.equal('knownFeasible' in problem, false);
  assert.equal('contactGraph' in problem, false);

  const requestedConfig = createNBodyAdaptiveKktConfig();
  const result = solveNBodyUnifiedKktCandidate({ problem, requestedConfig });
  assert.equal(result.status, 'converged-unified-kkt-candidate');
  assert.equal(
    result.route.effective,
    'unified-active-set-pair-bone-compartment-kkt-adaptive-carrier-v0',
  );
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, false);
  assert.ok(result.selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance);
  assert.equal(result.selected.displacement.movedMemberCount, 6);
  assert.equal(result.invariance.candidateEnumeration, 'passed');
});
