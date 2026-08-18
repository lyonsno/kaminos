import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createNBodyLocalizedChallengeSuite } from '../nbody-packing-assay-core.mjs';
import { hashMusclePackingCanonicalJson } from '../muscle-compartment-packing-core.mjs';
import * as restoration from '../nbody-packing-restoration.mjs';
import { compileNBodyAdaptiveKktProblem } from '../nbody-packing-unified-kkt.mjs';

const FROZEN_TRAJECTORY_PATH =
  'artifacts/nbody-packing-active-row-trust-region-trajectory-continuation-v0/raw-trajectory.json';
const FROZEN_TRAJECTORY_SHA256 =
  '71070911e5bff2d8f51460ea77ef2116abcc335fb2c73da8fa64036eabc288f5';
const FROZEN_PROBLEM_SHA256 =
  'cca9f08a740141647f085ac280d9e4fae006274c5e8e98c60ea66ebd68a0ab9c';
const CONFIRMED_STEP_VECTOR_SHA256 =
  '3227e65a802ec56f82e2acc873e1c638853b2cfa959d8ecc50138347e8099b30';
const CONFIRMED_STEP_METRICS_SHA256 =
  '622706f96737b1821b21d4a63fb2a8ae250104fd120deaf580636f394e312572';

function frozenCase() {
  const trajectory = JSON.parse(fs.readFileSync(FROZEN_TRAJECTORY_PATH, 'utf8'));
  assert.equal(trajectory.identity.sha256, FROZEN_TRAJECTORY_SHA256);
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  assert.equal(problem.identity.sha256, FROZEN_PROBLEM_SHA256);
  assert.equal(trajectory.source.problemSha256, problem.identity.sha256);
  return { problem, startVector:trajectory.selected.vector };
}

function strictProgressCase() {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const adaptive = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/result.json',
    'utf8',
  ));
  return { problem, startVector:adaptive.selected.vector };
}

function assertDebtRecurrence(debt, message) {
  assert.equal(debt.borrowed, Math.max(0, debt.after - debt.before), `${message} borrowed`);
  assert.equal(
    debt.repaid,
    Math.min(debt.outstandingBefore, Math.max(0, debt.before - debt.after)),
    `${message} repaid`,
  );
  assert.equal(
    debt.outstandingAfter,
    debt.outstandingBefore + debt.borrowed - debt.repaid,
    `${message} outstanding`,
  );
}

test('trajectory terminal classifier names global-merit plus cumulative-debt floor', () => {
  assert.equal(
    typeof restoration.classifyNBodyElasticExchangeUnacceptedTerminal,
    'function',
    'trajectory terminal classification is still embedded in generic raw-solver labels',
  );
  const familyOutstanding = {
    pairwisePenetration:0.00003497129400000009,
    skeletalPenetration:0.00004249525000000001,
    compartmentEscape:0,
  };
  const classification = restoration.classifyNBodyElasticExchangeUnacceptedTerminal({
    iteration:12,
    strictResult:{
      status:'active-row-trust-region-step-accepted',
      certificate:null,
    },
    strictGlobalMerit:{
      status:'strict-global-merit-floor',
      familyAdmissibleCandidateCount:15,
      globalAdmissibleCandidateCount:0,
    },
    elasticResult:{
      status:'elastic-all-row-trust-region-step-accepted',
      work:{ terminalReason:null },
    },
    elasticDebtFilter:{
      status:'cumulative-family-debt-floor',
      rawAdmissibleCandidateCount:16,
      admissibleCandidateCount:0,
      allowance:0.00004249551501,
    },
    familyOutstanding,
  });

  assert.deepEqual(classification, {
    terminalClass:'strict-global-merit-floor-cumulative-family-debt-floor',
    terminalEvidence:{
      iteration:12,
      strictStatus:'active-row-trust-region-step-accepted',
      strictGlobalMeritStatus:'strict-global-merit-floor',
      strictFamilyAdmissibleCandidateCount:15,
      strictGlobalAdmissibleCandidateCount:0,
      elasticStatus:'elastic-all-row-trust-region-step-accepted',
      elasticTerminalReason:null,
      elasticDebtFilterStatus:'cumulative-family-debt-floor',
      elasticRawAdmissibleCandidateCount:16,
      elasticCumulativeAdmissibleCandidateCount:0,
      familyOutstanding,
      familyTradeoffAllowance:0.00004249551501,
    },
  });
});

test('elastic exchange trajectory exposes one frozen debt-aware two-regime contract', () => {
  assert.equal(
    typeof restoration.createNBodyElasticExchangeTrajectoryConfig,
    'function',
    'elastic exchange trajectory config is not implemented',
  );
  assert.equal(
    typeof restoration.solveNBodyElasticExchangeTrajectory,
    'function',
    'elastic exchange trajectory solver is not implemented',
  );
  assert.equal(
    restoration.NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_RESULT_SCHEMA,
    'kaminos.nbody-packing-elastic-exchange-debt-trajectory-result.v0',
  );

  const config = restoration.createNBodyElasticExchangeTrajectoryConfig();
  assert.deepEqual(config, {
    algorithm:'strict-active-row-then-elastic-all-row-debt-trajectory-v0',
    accumulationWindow:3,
    contactCycleEnergyTolerance:1e-12,
    convergenceTolerance:1e-7,
    debtTolerance:1e-12,
    iterationBudget:8,
    radiusFloorProgressTolerance:1e-12,
    stateIdentityPrecision:15,
    strictGlobalMeritTolerance:1e-12,
    strictStep:restoration.createNBodyActiveRowTrustRegionConfig({
      activeSetPolicy:'family-maximum-relative-band',
      relativeActivationBand:0.01,
    }),
    elasticStep:restoration.createNBodyElasticAllRowComparatorConfig(),
  });
});

test('elastic exchange step 1 exactly reproduces the confirmed cone escape and debt ledger', () => {
  const source = frozenCase();
  const config = restoration.createNBodyElasticExchangeTrajectoryConfig({ iterationBudget:1 });
  const result = restoration.solveNBodyElasticExchangeTrajectory({
    ...source,
    requestedConfig:config,
  });

  assert.equal(result.schema, restoration.NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_RESULT_SCHEMA);
  assert.deepEqual(result.route, {
    requested:config.algorithm,
    effective:config.algorithm,
    fallbackUsed:false,
  });
  assert.equal(result.source.problemSha256, FROZEN_PROBLEM_SHA256);
  assert.equal(result.work.attempts, 1);
  assert.equal(result.work.acceptedTransitions, 1);
  assert.equal(result.work.strictAccepted, 0);
  assert.equal(result.work.elasticAccepted, 1);
  assert.equal(result.work.terminalClass, 'budget-exhausted-progressing');
  assert.equal(result.work.rows.length, 1);

  const [step] = result.work.rows;
  assert.equal(step.regime, 'elastic-all-row');
  assert.equal(step.accepted, true);
  assert.equal(step.attempts.strict.status, 'local-active-row-cone-certificate');
  assert.equal(step.attempts.strict.certificate.kind, 'linearized-active-row-cone-floor');
  assert.equal(step.attempts.elastic.status, 'elastic-all-row-trust-region-step-accepted');
  assert.equal(step.attempts.elastic.selected.radius, 0.0000625);
  assert.equal(hashMusclePackingCanonicalJson(step.after.vector), CONFIRMED_STEP_VECTOR_SHA256);
  assert.equal(hashMusclePackingCanonicalJson(step.after.metrics), CONFIRMED_STEP_METRICS_SHA256);
  assert.equal(step.before.rows.length, 531);
  assert.equal(step.after.rows.length, 531);
  assert.equal(step.rowDebt.length, 531);
  assert.equal(new Set(step.rowDebt.map(row => row.key)).size, 531);
  assert.equal(step.hardInvariantFailures.length, 0);
  assert.equal(
    step.cumulativeWork.attemptPhysicalEvaluations,
    step.attempts.strict.work.evaluationCount + step.attempts.elastic.work.evaluationCount,
  );
  assert.equal(step.cumulativeWork.trajectoryPhysicalReevaluations, 2);
  assert.equal(
    step.cumulativeWork.totalPhysicalEvaluations,
    step.cumulativeWork.attemptPhysicalEvaluations + 2,
  );
  for (const [family, debt] of Object.entries(step.familyDebt)) {
    assertDebtRecurrence(debt, `family ${family}`);
    assert.equal(debt.firstBorrowingIteration, debt.borrowed > 0 ? 1 : null);
    assert.equal(debt.mostRecentRepaymentIteration, debt.repaid > 0 ? 1 : null);
  }
  assert.deepEqual(
    result.debt.familyFirstBorrowingIteration,
    Object.fromEntries(Object.entries(step.familyDebt).map(
      ([family, debt]) => [family, debt.firstBorrowingIteration],
    )),
  );
  assert.deepEqual(
    result.debt.familyMostRecentRepaymentIteration,
    Object.fromEntries(Object.entries(step.familyDebt).map(
      ([family, debt]) => [family, debt.mostRecentRepaymentIteration],
    )),
  );
  for (const debt of step.rowDebt) {
    assertDebtRecurrence(debt, `row ${debt.key}`);
    assert.equal(debt.firstBorrowingIteration, debt.borrowed > 0 ? 1 : null);
    assert.equal(debt.mostRecentRepaymentIteration, debt.repaid > 0 ? 1 : null);
  }
  assert.equal(
    result.mechanism.elasticActivation,
    'after-linearized-active-row-cone-floor-or-strict-global-merit-floor',
  );
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.physicalRowsReevaluated, true);
  assert.equal(result.identity.sha256.length, 64);
});

test('canonical and reverse candidate enumeration select the same first physical transition', () => {
  const source = frozenCase();
  const canonicalConfig = restoration.createNBodyElasticExchangeTrajectoryConfig({
    iterationBudget:1,
  });
  const reverseConfig = restoration.createNBodyElasticExchangeTrajectoryConfig({
    iterationBudget:1,
    strictStep:restoration.createNBodyActiveRowTrustRegionConfig({
      activeSetPolicy:'family-maximum-relative-band',
      candidateEnumeration:'reverse',
      relativeActivationBand:0.01,
    }),
    elasticStep:{
      ...restoration.createNBodyElasticAllRowComparatorConfig(),
      candidateEnumeration:'reverse',
    },
  });
  const canonical = restoration.solveNBodyElasticExchangeTrajectory({
    ...source,
    requestedConfig:canonicalConfig,
  });
  const reverse = restoration.solveNBodyElasticExchangeTrajectory({
    ...source,
    requestedConfig:reverseConfig,
  });

  assert.deepEqual(reverse.selected.vector, canonical.selected.vector);
  assert.deepEqual(reverse.selected.metrics, canonical.selected.metrics);
  assert.deepEqual(reverse.work.rows[0].after.rows, canonical.work.rows[0].after.rows);
  assert.deepEqual(reverse.debt, canonical.debt);
  assert.equal(reverse.work.rows[0].regime, 'elastic-all-row');
  assert.equal(reverse.work.rows[0].attempts.strict.certificate.kind,
    'linearized-active-row-cone-floor');
  assert.equal(reverse.work.rows[0].attempts.elastic.selected.radius, 0.0000625);
});

test('a strict nonlinear radius floor terminates without laundering it into elastic activation', () => {
  const source = strictProgressCase();
  const strictStep = {
    ...restoration.createNBodyActiveRowTrustRegionConfig({
      activeSetPolicy:'family-maximum-relative-band',
      relativeActivationBand:0.01,
    }),
    improvementTolerance:1,
  };
  const config = restoration.createNBodyElasticExchangeTrajectoryConfig({
    iterationBudget:1,
    strictStep,
  });
  const result = restoration.solveNBodyElasticExchangeTrajectory({
    ...source,
    requestedConfig:config,
  });

  assert.equal(result.work.attempts, 1);
  assert.equal(result.work.acceptedTransitions, 0);
  assert.equal(result.work.terminalClass, 'radius-floor');
  assert.equal(result.work.terminalEvidence.regime, 'strict-active-row');
  assert.equal(result.work.terminalEvidence.elasticAttempted, false);
  assert.equal(
    result.work.terminalEvidence.strictStatus,
    'nonlinear-active-row-trust-region-floor',
  );
  assert.equal(
    result.work.terminalEvidence.strictCertificate.kind,
    'nonlinear-active-row-radius-floor',
  );
  assert.equal(result.work.rows[0].regime, 'strict-active-row');
  assert.equal(result.work.rows[0].attempts.elastic, null);
  assert.equal(
    result.work.attemptPhysicalEvaluations,
    result.work.rows[0].attempts.strict.work.evaluationCount,
  );
});

test('the frozen step-3 strict radius ledger exposes the global uphill direction', () => {
  const trajectory = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-elastic-exchange-trajectory-v0/canonical-raw.json',
    'utf8',
  ));
  const stepThree = trajectory.work.rows.find(row => row.iteration === 3);
  assert.ok(stepThree, 'frozen elastic trajectory must preserve the third accepted transition');
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  assert.equal(trajectory.source.problemSha256, problem.identity.sha256);

  const strict = restoration.solveNBodyActiveRowTrustRegionStep({
    problem,
    startVector:stepThree.after.vector,
    requestedConfig:restoration.createNBodyActiveRowTrustRegionConfig({
      activeSetPolicy:'family-maximum-relative-band',
      relativeActivationBand:0.01,
    }),
  });
  const beforeEnergy = stepThree.after.allRowSquaredViolationEnergy;
  assert.equal(strict.status, 'active-row-trust-region-step-accepted');
  assert.equal(strict.work.candidateReceipts.length, 20);
  for (const candidate of strict.work.candidateReceipts) {
    assert.equal(
      Number.isFinite(candidate.allRowSquaredViolationEnergy),
      true,
      `radius ${candidate.radius} must disclose its all-row energy`,
    );
    assert.ok(
      candidate.allRowSquaredViolationEnergy > beforeEnergy,
      `radius ${candidate.radius} should preserve the frozen globally uphill witness`,
    );
  }
});

test('a strict global-merit floor re-enters through elastic from the unmodified source', () => {
  const source = frozenCase();
  const result = restoration.solveNBodyElasticExchangeTrajectory({
    ...source,
    requestedConfig:restoration.createNBodyElasticExchangeTrajectoryConfig({
      iterationBudget:4,
    }),
  });

  assert.equal(result.work.rows.length, 4);
  const step = result.work.rows[3];
  assert.equal(step.regime, 'elastic-all-row');
  assert.equal(step.accepted, true);
  assert.equal(step.attempts.strict.status, 'active-row-trust-region-step-accepted');
  assert.equal(step.strictGlobalMerit.status, 'strict-global-merit-floor');
  assert.equal(step.strictGlobalMerit.familyAdmissibleCandidateCount, 17);
  assert.equal(step.strictGlobalMerit.globalAdmissibleCandidateCount, 0);
  assert.equal(step.strictGlobalMerit.sourceEnergy, step.before.allRowSquaredViolationEnergy);
  assert.ok(step.strictGlobalMerit.candidates.every(candidate =>
    candidate.allRowSquaredViolationEnergy > step.strictGlobalMerit.sourceEnergy
  ));
  assert.equal(
    hashMusclePackingCanonicalJson(step.attempts.elastic.start.vector),
    hashMusclePackingCanonicalJson(step.before.vector),
    'elastic re-entry must start from the unmodified pre-strict state',
  );
  assert.equal(step.attempts.elastic.selected.radius, 0.0000625);
  assert.equal(step.after.allRowSquaredViolationEnergy, 0.00010793003680925461);
  assert.ok(
    step.after.allRowSquaredViolationEnergy < step.before.allRowSquaredViolationEnergy,
  );
  assert.equal(step.hardInvariantFailures.length, 0);
  assert.equal(result.work.terminalClass, 'budget-exhausted-progressing');
  assert.equal(result.work.strictAccepted, 2);
  assert.equal(result.work.elasticAccepted, 2);
  assert.equal(
    result.mechanism.elasticActivation,
    'after-linearized-active-row-cone-floor-or-strict-global-merit-floor',
  );
});

test('elastic re-entry spends one trajectory-wide family debt budget', () => {
  const source = frozenCase();
  const config = restoration.createNBodyElasticExchangeTrajectoryConfig({
    iterationBudget:4,
  });
  const result = restoration.solveNBodyElasticExchangeTrajectory({
    ...source,
    requestedConfig:config,
  });

  const step = result.work.rows[3];
  assert.equal(step.regime, 'elastic-all-row');
  assert.equal(step.attempts.elastic.selected.radius, 0.0000625,
    'the one-step elastic arm should preserve its unpriced local proposal');
  assert.ok(step.elasticDebtFilter,
    'trajectory must independently expose cumulative debt admission');
  assert.equal(step.elasticDebtFilter.status,
    'cumulative-family-debt-candidate-selected');
  assert.equal(step.elasticDebtFilter.allowance,
    config.elasticStep.familyTradeoffAllowance);
  assert.equal(step.elasticDebtFilter.tolerance, config.debtTolerance);
  assert.deepEqual(step.elasticDebtFilter.outstandingBefore, {
    pairwisePenetration:0.00001910049200000007,
    skeletalPenetration:0.000023511578000000007,
    compartmentEscape:0,
  });
  assert.equal(step.elasticDebtFilter.admissibleCandidateCount, 15);
  assert.equal(step.elasticDebtFilter.selectedRadius, 0.00003125);

  const unpriced = step.elasticDebtFilter.candidates.find(
    candidate => candidate.radius === 0.0000625,
  );
  assert.ok(unpriced);
  assert.equal(unpriced.cumulativeDebtAdmissible, false);
  assert.ok(unpriced.rejectionReasons.includes(
    'skeletalPenetration-cumulative-debt-budget-exceeded',
  ));
  assert.ok(
    unpriced.projectedFamilyDebt.skeletalPenetration.outstandingAfter >
      step.elasticDebtFilter.allowance,
  );

  const selected = step.elasticDebtFilter.candidates.find(candidate => candidate.selected);
  assert.equal(selected.radius, 0.00003125);
  assert.equal(selected.cumulativeDebtAdmissible, true);
  assert.ok(selected.allRowSquaredViolationEnergy < step.before.allRowSquaredViolationEnergy);
  for (const debt of Object.values(selected.projectedFamilyDebt)) {
    assert.ok(
      debt.outstandingAfter <=
        step.elasticDebtFilter.allowance + step.elasticDebtFilter.tolerance,
    );
  }
  assert.deepEqual(step.after.vector, selected.vector);
  assert.equal(step.after.allRowSquaredViolationEnergy,
    0.0001086385476283738);
  assert.equal(step.hardInvariantFailures.length, 0);
  assert.deepEqual(step.attempts.elastic.start.vector, step.before.vector,
    'cumulative filter must not inherit the rejected strict candidate');
});

test('bounded priced debt accumulation stays diagnostic while admissible descent exists', () => {
  const source = frozenCase();
  const config = restoration.createNBodyElasticExchangeTrajectoryConfig({
    iterationBudget:8,
  });
  const result = restoration.solveNBodyElasticExchangeTrajectory({
    ...source,
    requestedConfig:config,
  });

  assert.notEqual(
    result.work.terminalClass,
    'accumulating-family-debt',
    'bounded debt growth inside the trajectory-wide budget is evidence, not a terminal',
  );
  assert.ok(
    result.work.acceptedTransitions > 6,
    'the priced trajectory must continue past the stale iteration-6 accumulation stop',
  );
  const step6 = result.work.rows[5];
  assert.deepEqual(step6.debtAccumulation, {
    status:'bounded-cumulative-family-debt-accumulation',
    windowStart:4,
    families:['pairwisePenetration', 'skeletalPenetration'],
  });
  for (const family of step6.debtAccumulation.families) {
    assert.ok(
      step6.familyDebt[family].outstandingAfter <=
        config.elasticStep.familyTradeoffAllowance + config.debtTolerance,
      `${family} accumulation must remain inside the priced debt budget`,
    );
  }
});
