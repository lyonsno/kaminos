import assert from 'node:assert/strict';
import test from 'node:test';

import { createNBodyRosetteFixture } from '../nbody-packing-assay-core.mjs';
import {
  NBODY_PACKING_SPARSE_GRAPH_RESULT_SCHEMA,
  compileNBodySparseGraphProblem,
  createNBodySparseGraphConfig,
  solveNBodySparseGraphCandidate,
} from '../nbody-packing-sparse-graph.mjs';

test('sparse graph candidate requires a source-independent compiled problem', () => {
  const fixture = createNBodyRosetteFixture();
  const problem = compileNBodySparseGraphProblem(fixture);
  assert.equal(problem.schema, 'kaminos.nbody-packing-sparse-graph-problem.v0');
  assert.equal(problem.source.fixtureSha256, fixture.identity.sha256);
  assert.equal(Object.hasOwn(problem, 'knownFeasible'), false);
  assert.equal(Object.hasOwn(problem.source, 'knownFeasibleStateSha256'), false);
  assert.deepEqual(problem.members.map(member => member.id), [
    'rosette-west',
    'rosette-center',
    'rosette-east',
    'rosette-north',
    'rosette-south',
  ]);
  assert.equal(problem.graph.edgeCount, 8);
  assert.equal(problem.graph.maximumDegree, 4);
  assert.equal(problem.variables.length, 10);
  assert.ok(problem.graph.edges.every(edge => edge.members.length === 2));
});

test('sparse graph compiler independently rejects spoofed fixture identity', () => {
  const fixture = createNBodyRosetteFixture();
  const spoofedIdentity = '0'.repeat(64);
  fixture.identity.sha256 = spoofedIdentity;
  fixture.input.requested.sha256 = spoofedIdentity;
  fixture.input.effective.sha256 = spoofedIdentity;
  assert.throws(
    () => compileNBodySparseGraphProblem(fixture),
    /fixture identity mismatch/,
  );
});

test('unified sparse graph candidate clears assembled debt with one synchronous global loop', () => {
  const fixture = createNBodyRosetteFixture();
  const problem = compileNBodySparseGraphProblem(fixture);
  const result = solveNBodySparseGraphCandidate({
    problem,
    requestedConfig:createNBodySparseGraphConfig(),
  });
  assert.equal(result.schema, NBODY_PACKING_SPARSE_GRAPH_RESULT_SCHEMA);
  assert.equal(result.status, 'converged-sparse-global-candidate');
  assert.equal(result.route.requested, result.route.effective);
  assert.equal(result.route.fallbackUsed, false);
  assert.equal(result.source.problemSha256, problem.identity.sha256);
  assert.equal(result.mechanism.updateMode, 'one-global-snapshot-one-simultaneous-apply');
  assert.equal(result.mechanism.pairwiseClosureAuthority, false);
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.arbitraryDegreeGraph, true);
  assert.equal(result.invariance.mechanism, 'paired-full-solve-traversal-comparison');
  assert.equal(result.invariance.rows.length, 2);
  assert.ok(Object.values(result.invariance.comparison).every(Boolean));
  assert.equal(result.work.snapshots, result.work.iterations + 1);
  assert.ok(result.work.iterations > 0);
  assert.ok(result.work.constraintLinearizations >= result.work.iterations);
  assert.ok(result.selected.displacement.movedMemberCount >= 2);
  assert.ok(result.selected.maximumPhysicalResidual <= result.config.effective.convergenceTolerance);
  assert.ok(result.selected.metrics.pairwisePenetration <= result.config.effective.convergenceTolerance);
  assert.ok(result.selected.belt.maximumPenetration <= result.config.effective.convergenceTolerance);
  assert.ok(result.selected.metrics.skeletalPenetration <= result.config.effective.convergenceTolerance);
  assert.ok(result.selected.metrics.compartmentEscape <= result.config.effective.convergenceTolerance);
  assert.ok(result.selected.metrics.endpointDrift <= result.config.effective.convergenceTolerance);
  assert.ok(result.selected.metrics.maximumRelativeVolumeError <= result.config.effective.convergenceTolerance);
  assert.match(result.selected.physicalStateSha256, /^[0-9a-f]{64}$/);
  assert.match(result.identity.sha256, /^[0-9a-f]{64}$/);
});

test('synchronous sparse accumulation carries artifact-bound traversal invariance', () => {
  const problem = compileNBodySparseGraphProblem(createNBodyRosetteFixture());
  const result = solveNBodySparseGraphCandidate({
    problem,
    requestedConfig:createNBodySparseGraphConfig(),
  });
  assert.equal(result.status, 'converged-sparse-global-candidate');
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  assert.equal(result.invariance.mechanism, 'paired-full-solve-traversal-comparison');
  assert.deepEqual(
    result.invariance.rows.map(row => row.requestedEnumeration),
    ['canonical', 'reverse'],
  );
  assert.ok(result.invariance.rows.every(row => row.status === 'converged-sparse-global-candidate'));
  assert.deepEqual(result.invariance.rows[1].selectedVector, result.invariance.rows[0].selectedVector);
  assert.equal(
    result.invariance.rows[1].selectedPhysicalStateSha256,
    result.invariance.rows[0].selectedPhysicalStateSha256,
  );
  assert.equal(result.invariance.rows[1].selectedMetricsSha256, result.invariance.rows[0].selectedMetricsSha256);
  assert.equal(result.invariance.rows[1].selectedBeltSha256, result.invariance.rows[0].selectedBeltSha256);
});

test('iteration exhaustion is loud and preserves the last measured assembled state', () => {
  const problem = compileNBodySparseGraphProblem(createNBodyRosetteFixture());
  const config = { ...createNBodySparseGraphConfig(), iterationBudget:1 };
  const result = solveNBodySparseGraphCandidate({ problem, requestedConfig:config });
  assert.equal(result.status, 'iteration-budget-exhausted');
  assert.equal(result.work.iterations, 1);
  assert.ok(result.selected.maximumPhysicalResidual > config.convergenceTolerance);
  assert.match(result.selected.physicalStateSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.failure.phase, 'global-sparse-contact-projection');
  assert.equal(result.failure.lastTrustworthyEvidence, 'selected');
});
