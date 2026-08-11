import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createNBodyLocalizedChallengeSuite,
  createNBodyPackingGeneralizationSuite,
  createNBodyLongitudinalFalsifierFixture,
} from '../nbody-packing-assay-core.mjs';
import {
  NBODY_PACKING_UNIFIED_KKT_RESULT_SCHEMA,
  compileNBodyAdaptiveKktProblem,
  compileNBodyUnifiedKktProblem,
  classifyNBodyUnifiedKktTraversalEquivalence,
  createNBodyAdaptiveKktConfig,
  createNBodyUnifiedKktConfig,
  evaluateNBodyUnifiedKktState,
  scaleNBodyUnifiedKktProblemClearance,
  solveNBodyUnifiedKktCandidate,
} from '../nbody-packing-unified-kkt.mjs';
import { hashMusclePackingCanonicalJson } from '../muscle-compartment-packing-core.mjs';
import {
  classifyNBodyLocalizedSameBasisOracle,
  classifyNBodyLocalizedSameBasisPatternSearch,
  isNBodyLocalizedChallengePass,
  isNBodyLocalizedHomotopyStageAdmissible,
  runNBodyLocalizedContinuation,
  runNBodyLocalizedConstraintHomotopy,
} from '../nbody-packing-localized-challenge.mjs';

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

test('overdetermined four-body projection converges under both constraint traversals', () => {
  const fixture = createNBodyPackingGeneralizationSuite()[0];
  const problem = compileNBodyUnifiedKktProblem(fixture);
  const requestedConfig = createNBodyUnifiedKktConfig();
  const result = solveNBodyUnifiedKktCandidate({ problem, requestedConfig });

  assert.deepEqual(
    result.invariance.rows.map(row => ({
      enumeration:row.enumeration,
      status:row.status,
    })),
    [
      { enumeration:'canonical', status:'converged-unified-kkt-candidate' },
      { enumeration:'reverse', status:'converged-unified-kkt-candidate' },
    ],
  );
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  assert.equal(result.mechanism.projectionOrdering, 'constraint-key-canonical');
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

test('same-basis oracle can independently evaluate a bounded adaptive carrier vector', () => {
  const fixture = createNBodyLongitudinalFalsifierFixture();
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const state = evaluateNBodyUnifiedKktState({
    problem,
    vector:Array(problem.variables.length).fill(0),
  });
  assert.equal(state.vector.length, 24);
  assert.deepEqual(state.muscles, problem.members);
  assert.ok(state.maximumPhysicalResidual >= 0.1);
  assert.equal(Object.hasOwn(state, 'knownFeasible'), false);
});

test('constraint homotopy scales only compiled crowded geometry and preserves identity custody', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const scaled = scaleNBodyUnifiedKktProblemClearance({ problem, clearanceScale:0.5 });
  assert.deepEqual(scaleNBodyUnifiedKktProblemClearance({ problem, clearanceScale:0.5 }), scaled);
  assert.deepEqual(scaleNBodyUnifiedKktProblemClearance({ problem, clearanceScale:1 }), problem);
  assert.notEqual(scaled.identity.sha256, problem.identity.sha256);
  assert.equal(scaled.source.parentProblemSha256, problem.identity.sha256);
  assert.equal(scaled.source.clearanceScale, 0.5);
  assert.equal(scaled.source.effectiveProblemKind, 'scaled-clearance-homotopy-stage');
  assert.equal('knownFeasible' in scaled, false);
  assert.equal('contactGraph' in scaled, false);
  assert.deepEqual(
    scaled.members[0].centerline.map(knot => knot.position),
    problem.members[0].centerline.map(knot => knot.position),
  );
  assert.equal(scaled.members[0].centerline[2].radius,
    problem.members[0].centerline[2].radius * 0.5);
  assert.equal(scaled.members[0].targetVolume,
    problem.members[0].targetVolume * 0.25);
  assert.equal(scaled.crowdedSource.obstacles[0].radius,
    problem.crowdedSource.obstacles[0].radius * 0.5);
  assert.equal(scaled.crowdedSource.obstacles[0].clearance,
    problem.crowdedSource.obstacles[0].clearance * 0.5);
  assert.equal(scaled.crowdedSource.compartment.clearance,
    problem.crowdedSource.compartment.clearance * 0.5);
  assert.equal(scaled.crowdedSource.input.requested.sha256,
    scaled.crowdedSource.input.effective.sha256);
  assert.equal(scaled.crowdedSource.input.effective.id, scaled.crowdedSource.id);
  assert.equal(scaled.crowdedSource.derivation.parentInput.sha256,
    problem.crowdedSource.input.effective.sha256);
  assert.doesNotThrow(() => evaluateNBodyUnifiedKktState({
    problem:scaled,
    vector:Array(scaled.variables.length).fill(0),
  }));
  assert.throws(
    () => scaleNBodyUnifiedKktProblemClearance({ problem, clearanceScale:0 }),
    /clearanceScale must be in/,
  );
});

test('same-basis bounded oracle exposes the first localized failure as globalization', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.24,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const stalledVector = [
    0.070841339617486, -0.13413233053358, 0.041789436398172, -0.043096052837874,
    -0.103462010755158, 0.056334134432027, 0.209866701162612, -0.037709354017105,
    -0.07564837657191, 0.038739811432486, -0.018650552309115, 0.022065340114462,
    -0.049151990544221, -0.018584117730744, 0.03382309791373, 0.01125424536793,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const classification = classifyNBodyLocalizedSameBasisOracle({
    problem,
    startVector:stalledVector,
    convergenceTolerance:1e-7,
    stepSchedule:[0.01],
    translationBounds:[-0.3, 0.3],
  });
  assert.equal(classification.status, 'same-basis-feasible-globalization-failure');
  assert.equal(classification.selected.maximumPhysicalResidual, 0);
  assert.equal(classification.selected.coordinateIndex, 20);
  assert.equal(classification.selected.delta, -0.01);
  assert.equal(classification.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(classification.mechanism.contactGraphRowsConsumed, false);
});

test('unified solver consumes an explicit same-basis initial vector with exact provenance', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.24,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const stalledVector = [
    0.070841339617486, -0.13413233053358, 0.041789436398172, -0.043096052837874,
    -0.103462010755158, 0.056334134432027, 0.209866701162612, -0.037709354017105,
    -0.07564837657191, 0.038739811432486, -0.018650552309115, 0.022065340114462,
    -0.049151990544221, -0.018584117730744, 0.03382309791373, 0.01125424536793,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const initialVector = [...stalledVector];
  initialVector[20] = -0.01;
  const requestedConfig = {
    ...createNBodyAdaptiveKktConfig(),
    iterationBudget:1,
  };
  const result = solveNBodyUnifiedKktCandidate({
    problem,
    requestedConfig,
    initialVector,
  });
  assert.equal(result.status, 'converged-unified-kkt-candidate');
  assert.equal(result.work.iterations, 0);
  assert.deepEqual(result.selected.vector, initialVector);
  assert.equal(result.mechanism.initialization.kind, 'explicit-same-basis-vector');
  assert.equal(result.mechanism.initialization.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.initialization.contactGraphRowsConsumed, false);
  assert.equal(result.mechanism.initialization.vectorSha256.length, 64);
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  const canonicalResult = structuredClone(result);
  delete canonicalResult.identity;
  assert.equal(result.identity.sha256, hashMusclePackingCanonicalJson(canonicalResult));
});

test('localized continuation records requested and effective seed identity on success', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.24,
  );
  const stalledVector = [
    0.070841339617486, -0.13413233053358, 0.041789436398172, -0.043096052837874,
    -0.103462010755158, 0.056334134432027, 0.209866701162612, -0.037709354017105,
    -0.07564837657191, 0.038739811432486, -0.018650552309115, 0.022065340114462,
    -0.049151990544221, -0.018584117730744, 0.03382309791373, 0.01125424536793,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const initialVector = [...stalledVector];
  initialVector[20] = -0.01;
  const seedResultCore = {
    schema:NBODY_PACKING_UNIFIED_KKT_RESULT_SCHEMA,
    status:'converged-unified-kkt-candidate',
    source:{ fixtureSha256:'a'.repeat(64) },
    selected:{ vector:initialVector },
    invariance:{ candidateEnumeration:'passed' },
  };
  const seedResult = {
    ...seedResultCore,
    identity:{ sha256:hashMusclePackingCanonicalJson(seedResultCore) },
  };
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-continuation-'));
  const outputPath = path.join(outputDirectory, 'result.json');
  const result = runNBodyLocalizedContinuation({
    fixture,
    initialVector,
    seedResult,
    requestedConfig:{ ...createNBodyAdaptiveKktConfig(), iterationBudget:1 },
    outputPath,
  });
  const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.deepEqual(written, result);
  assert.equal(result.status, 'complete-converged');
  assert.equal(result.route.effective, 'same-basis-prior-rung-continuation');
  assert.equal(result.seed.requested.vectorSha256, result.seed.effective.vectorSha256);
  assert.equal(result.seed.effective.fixtureSha256, 'a'.repeat(64));
  assert.equal(result.seed.effective.resultSha256, seedResult.identity.sha256);
  assert.equal(result.solverResult.mechanism.initialization.vectorSha256,
    result.seed.effective.vectorSha256);
  assert.equal(result.terminal.failurePhase, null);
});

test('localized continuation refuses caller-asserted or vector-mismatched seed lineage', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.24,
  );
  const selectedVector = Array(24).fill(0);
  const seedResultCore = {
    schema:NBODY_PACKING_UNIFIED_KKT_RESULT_SCHEMA,
    status:'converged-unified-kkt-candidate',
    source:{ fixtureSha256:'a'.repeat(64) },
    selected:{ vector:selectedVector },
    invariance:{ candidateEnumeration:'passed' },
  };
  const seedResult = {
    ...seedResultCore,
    identity:{ sha256:hashMusclePackingCanonicalJson(seedResultCore) },
  };
  const initialVector = [...selectedVector];
  initialVector[0] += 0.001;
  assert.throws(() => runNBodyLocalizedContinuation({
    fixture,
    initialVector,
    seedResult,
    requestedConfig:{ ...createNBodyAdaptiveKktConfig(), iterationBudget:1 },
  }), /seed result selected vector does not match initialVector/);
});

test('constraint homotopy records every effective stage and reaches the exact full problem', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.24,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const startVector = [
    0.070841339617486, -0.13413233053358, 0.041789436398172, -0.043096052837874,
    -0.103462010755158, 0.056334134432027, 0.209866701162612, -0.037709354017105,
    -0.07564837657191, 0.038739811432486, -0.018650552309115, 0.022065340114462,
    -0.049151990544221, -0.018584117730744, 0.03382309791373, 0.01125424536793,
    0, 0, 0, 0, -0.01, 0, 0, 0,
  ];
  const result = runNBodyLocalizedConstraintHomotopy({
    problem,
    stageScales:[1],
    initialVector:startVector,
    requestedConfig:{ ...createNBodyAdaptiveKktConfig(), iterationBudget:1 },
  });
  assert.equal(result.status, 'complete-converged-full-clearance');
  assert.equal(result.route.effective, 'compiled-problem-clearance-homotopy');
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].clearanceScale, 1);
  assert.equal(result.stages[0].problemSha256, problem.identity.sha256);
  assert.equal(result.stages[0].solverResult.status, 'converged-unified-kkt-candidate');
  assert.deepEqual(result.stages[0].solverResult.selected.vector, startVector);
  assert.equal(result.final.problemSha256, problem.identity.sha256);
  assert.equal(result.final.maximumPhysicalResidual, 0);
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, false);
});

test('constraint homotopy refuses a traversal-sensitive zero-residual stage', () => {
  assert.equal(isNBodyLocalizedHomotopyStageAdmissible({
    status:'converged-unified-kkt-candidate',
    selected:{ maximumPhysicalResidual:0 },
    invariance:{ candidateEnumeration:'failed' },
  }, 1e-7), false);
  assert.equal(isNBodyLocalizedHomotopyStageAdmissible({
    status:'converged-unified-kkt-candidate',
    selected:{ maximumPhysicalResidual:0 },
    invariance:{ candidateEnumeration:'passed' },
  }, 1e-7), true);
  assert.equal(isNBodyLocalizedHomotopyStageAdmissible({
    status:'stalled-unified-kkt-candidate',
    selected:{ maximumPhysicalResidual:0.01 },
    invariance:{ candidateEnumeration:'passed' },
  }, 1e-7), false);
  assert.equal(isNBodyLocalizedHomotopyStageAdmissible({
    status:'converged-unified-kkt-candidate',
    selected:{ maximumPhysicalResidual:0.01 },
    invariance:{ candidateEnumeration:'passed' },
  }, 1e-7), false);
});

test('challenge pass admission requires traversal-stable convergence', () => {
  assert.equal(isNBodyLocalizedChallengePass({
    status:'converged-unified-kkt-candidate',
    invariance:{ candidateEnumeration:'failed' },
    config:{ effective:{ convergenceTolerance:1e-7 } },
    selected:{ maximumPhysicalResidual:0 },
  }), false);
  assert.equal(isNBodyLocalizedChallengePass({
    status:'converged-unified-kkt-candidate',
    invariance:{ candidateEnumeration:'passed' },
    config:{ effective:{ convergenceTolerance:1e-7 } },
    selected:{ maximumPhysicalResidual:0 },
  }), true);
});

test('single-coordinate oracle cannot leave the declared carrier bounds', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.24,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const stalledVector = [
    0.070841339617486, -0.13413233053358, 0.041789436398172, -0.043096052837874,
    -0.103462010755158, 0.056334134432027, 0.209866701162612, -0.037709354017105,
    -0.07564837657191, 0.038739811432486, -0.018650552309115, 0.022065340114462,
    -0.049151990544221, -0.018584117730744, 0.03382309791373, 0.01125424536793,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  stalledVector[0] = 0.3;
  const classification = classifyNBodyLocalizedSameBasisOracle({
    problem,
    startVector:stalledVector,
    convergenceTolerance:1e-7,
    stepSchedule:[0.01],
    translationBounds:[-0.3, 0.3],
  });
  assert.ok(classification.evaluations.some(
    row => row.coordinateIndex === 0 && row.delta === 0.01 &&
      row.status === 'skipped-translation-bound',
  ));
});

test('traversal equivalence admits sub-convergence noise and rejects material divergence', () => {
  const base = {
    statusEqual:true,
    workDecisionStructureEqual:true,
    convergenceTolerance:1e-7,
  };
  assert.deepEqual(classifyNBodyUnifiedKktTraversalEquivalence({
    ...base,
    maximumVectorDifference:1.4535659897951803e-9,
    maximumMetricsDifference:3.5800000741659233e-9,
  }), {
    passed:true,
    equivalenceTolerance:1e-7,
    comparison:{
      statusEqual:true,
      selectedCarrierEquivalent:true,
      physicalMetricsEquivalent:true,
      workDecisionStructureEqual:true,
    },
  });
  assert.equal(classifyNBodyUnifiedKktTraversalEquivalence({
    ...base,
    maximumVectorDifference:1.287087798e-6,
    maximumMetricsDifference:2.897456e-6,
  }).passed, false);
});

test('coupled same-basis pattern search composes coordinate moves with exact route custody', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.24,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const startVector = [
    0.070841339617486, -0.13413233053358, 0.041789436398172, -0.043096052837874,
    -0.103462010755158, 0.056334134432027, 0.209866701162612, -0.037709354017105,
    -0.07564837657191, 0.038739811432486, -0.018650552309115, 0.022065340114462,
    -0.049151990544221, -0.018584117730744, 0.03382309791373, 0.01125424536793,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const result = classifyNBodyLocalizedSameBasisPatternSearch({
    problem,
    startVectors:[startVector],
    convergenceTolerance:1e-7,
    stepSchedule:[0.01],
    sweepsPerStep:1,
    translationBounds:[-0.3, 0.3],
  });
  assert.equal(result.status, 'same-basis-feasible-globalization-failure');
  assert.equal(result.route.effective, 'deterministic-coupled-coordinate-pattern-search');
  assert.equal(result.selected.maximumPhysicalResidual, 0);
  assert.equal(result.selected.seedIndex, 0);
  assert.ok(result.selected.acceptedMoves.some(
    row => row.coordinateIndex === 20 && row.delta === -0.01,
  ));
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, false);
  assert.equal(result.claimCeiling,
    'feasible-same-basis-witness-proves-representation-sufficiency-not-optimality');
});

test('coupled pattern search prioritizes measured physical descent over sum-squared dither', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const startVector = [
    0.079358289678991, -0.164657554847671, 0.043351880061529, -0.049452116108372,
    -0.291825791820884, 0.067453882482368, 0.173822771757841, -0.040908231690992,
    -0.234331279527396, 0.09549477903056, -0.077213256619871, -0.160666148178279,
    -0.059002114134815, -0.121540959862542, 0.038702352820143, 0.076349170832406,
    -0.021966291592986, -0.030781325831866, 0.000969318067879, -0.014674962791597,
    0.012093608910812, -0.055243825084133, -0.005357190076657, -0.013337308333688,
  ];
  const result = classifyNBodyLocalizedSameBasisPatternSearch({
    problem,
    startVectors:[startVector],
    convergenceTolerance:1e-7,
    stepSchedule:[0.0002],
    sweepsPerStep:1,
    translationBounds:[-0.3, 0.3],
  });
  assert.equal(result.status, 'same-basis-feasibility-unresolved');
  assert.equal(result.seedRows[0].acceptedMoves.length, 1);
  const move = result.seedRows[0].acceptedMoves[0];
  assert.equal(move.coordinateIndex, 5);
  assert.equal(move.delta, 0.0002);
  assert.ok(move.after.maximumPhysicalResidual < move.before.maximumPhysicalResidual);
  assert.equal(result.mechanism.objective,
    'maximum-physical-residual-then-sum-squared-negative-constraint-gaps');
});

test('globalization keeps violated constraints in the projection and closes severity 0.24', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.24,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const result = solveNBodyUnifiedKktCandidate({
    problem,
    requestedConfig:createNBodyAdaptiveKktConfig(),
  });
  assert.equal(
    result.status,
    'converged-unified-kkt-candidate',
    JSON.stringify(result.failure),
  );
  assert.ok(result.selected.maximumPhysicalResidual <= 1e-7);
  assert.equal(result.invariance.candidateEnumeration, 'passed');
});

test('localized multi-obstacle ladder exposes a frozen adaptive pass/fail boundary', () => {
  const suite = createNBodyLocalizedChallengeSuite();
  assert.deepEqual(createNBodyLocalizedChallengeSuite(), suite);
  assert.ok(suite.length >= 4);
  assert.deepEqual(
    suite.map(row => row.assayProfile.severity),
    [...suite.map(row => row.assayProfile.severity)].sort((left, right) => left - right),
  );

  const outcomes = suite.map(fixture => {
    assert.equal(fixture.knownFeasible.muscles.length, 6);
    assert.equal(fixture.knownFeasible.obstacles.length, 2);
    assert.equal(fixture.authority.claimCeiling, 'localized-multi-obstacle-falsifier-only');
    assert.equal(fixture.derivation.kind, 'known-feasible-witness-then-localized-crowding');
    assert.equal(fixture.derivation.fallbackUsed, false);
    assert.equal(fixture.assayProfile.carrierPolicy, 'frozen-first-second-sine');
    assert.ok(fixture.assayProfile.withheldBasis.minimumRelativeProjectionResidual >= 0.2);
    assert.ok(fixture.metrics.knownFeasible.pairwisePenetration <= 1e-9);
    assert.ok(fixture.metrics.knownFeasible.skeletalPenetration <= 1e-9);
    assert.ok(fixture.metrics.knownFeasible.compartmentEscape <= 1e-9);
    assert.equal(fixture.metrics.crowded.endpointDrift, 0);
    assert.ok(fixture.metrics.crowded.maximumRelativeVolumeError <= 1e-9);

    const problem = compileNBodyAdaptiveKktProblem(fixture);
    assert.equal('knownFeasible' in problem, false);
    assert.equal('contactGraph' in problem, false);
    const requestedConfig = createNBodyAdaptiveKktConfig();
    const result = solveNBodyUnifiedKktCandidate({ problem, requestedConfig });
    return {
      severity:fixture.assayProfile.severity,
      status:result.status,
      maximumPhysicalResidual:result.selected.maximumPhysicalResidual,
      invariance:result.invariance.candidateEnumeration,
    };
  });

  const firstFailureIndex = outcomes.findIndex(row =>
    row.status !== 'converged-unified-kkt-candidate');
  assert.ok(firstFailureIndex > 0, JSON.stringify(outcomes));
  assert.equal(outcomes[firstFailureIndex - 1].status, 'converged-unified-kkt-candidate');
  assert.equal(outcomes[firstFailureIndex - 1].invariance, 'passed');
  assert.ok(outcomes[firstFailureIndex].maximumPhysicalResidual > 1e-7);
});
