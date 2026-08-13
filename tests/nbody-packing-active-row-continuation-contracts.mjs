import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashMusclePackingCanonicalJson } from '../muscle-compartment-packing-core.mjs';
import { createNBodyLocalizedChallengeSuite } from '../nbody-packing-assay-core.mjs';
import {
  createNBodyActiveRowTrustRegionConfig,
  createNBodyActiveRowTrustRegionTrajectoryConfig,
  solveNBodyActiveRowTrustRegionTrajectory,
} from '../nbody-packing-restoration.mjs';
import { compileNBodyAdaptiveKktProblem } from '../nbody-packing-unified-kkt.mjs';

const SOURCE_ROOT = 'artifacts/nbody-packing-active-row-trust-region-trajectory-v0';
const CONTINUATION_ROOT =
  'artifacts/nbody-packing-active-row-trust-region-trajectory-continuation-v0';

function continuationProblem() {
  return compileNBodyAdaptiveKktProblem(
    createNBodyLocalizedChallengeSuite().find(
      row => row.assayProfile.severity === 0.32,
    ),
  );
}

function clonedContinuation() {
  return structuredClone(JSON.parse(fs.readFileSync(
    `${CONTINUATION_ROOT}/result.json`,
    'utf8',
  )));
}

function rehashTrajectory(trajectory) {
  delete trajectory.identity;
  trajectory.identity = { sha256:hashMusclePackingCanonicalJson(trajectory) };
  return trajectory;
}

function relabeledNonlinearFloor(budget) {
  const floor = structuredClone(budget);
  const rejected = floor.work.rows.at(-1);
  rejected.accepted = false;
  rejected.after = structuredClone(rejected.before);
  rejected.certificate = {
    kind:'nonlinear-active-row-radius-floor',
    activeConstraintKeys:rejected.directionConstruction.activeRows.map(row => row.key),
  };
  rejected.candidateReceipts = rejected.candidateReceipts.map(candidate => ({
    ...candidate,
    selected:false,
    rejectionReason:candidate.regressedFamilies.length > 0
      ? 'constraint-family-regression'
      : 'non-improving-active-row-violation',
  }));
  floor.status = 'active-row-trust-region-trajectory-local-floor';
  floor.work.iterations -= 1;
  floor.work.terminalReason = 'nonlinear-active-row-trust-region-floor';
  floor.selected = {
    ...structuredClone(floor.work.rows.at(-2).after),
    muscles:structuredClone(floor.selected.muscles),
  };
  return rehashTrajectory(floor);
}

test('continuation admission reconstructs the frozen result and rejects rehashed forgeries', async () => {
  const assay = await import('../nbody-packing-restoration-assay.mjs');
  const problem = continuationProblem();
  const budget = clonedContinuation();
  const validate = trajectory => assay.validateNBodyPackingActiveRowContinuationResult({
    trajectory,
    problem,
    sourceVector:budget.start.vector,
    requestedConfig:trajectory.config.requested,
  });
  assert.equal(
    validate(budget).terminalClass,
    'budget-exhausted',
    'the exact frozen eight-step continuation must survive deterministic reconstruction',
  );

  const forgedActiveResidual = structuredClone(budget);
  forgedActiveResidual.work.rows[0].after.maximumActiveRowViolation = -999;
  forgedActiveResidual.work.rows[0].candidateReceipts.find(
    candidate => candidate.selected,
  ).maximumActiveRowViolation = -999;
  rehashTrajectory(forgedActiveResidual);

  const lateFeasible = structuredClone(budget);
  lateFeasible.status = 'active-row-trust-region-trajectory-feasible';
  lateFeasible.work.terminalReason = 'convergence-tolerance-satisfied';
  lateFeasible.config.requested.convergenceTolerance = 0.01;
  lateFeasible.config.effective.convergenceTolerance = 0.01;
  rehashTrajectory(lateFeasible);

  const staleAcceptedStepHash = relabeledNonlinearFloor(budget);

  const substitutedRadius = relabeledNonlinearFloor(budget);
  substitutedRadius.work.rows.at(-1).candidateReceipts[0].radius = 0.123;
  rehashTrajectory(substitutedRadius);

  const forgedCandidatePhysics = relabeledNonlinearFloor(budget);
  const forgedCandidate = forgedCandidatePhysics.work.rows.at(-1).candidateReceipts[0];
  forgedCandidate.vector[0] += 100;
  forgedCandidate.maximumPhysicalResidual = -999;
  forgedCandidate.maximumActiveRowViolation = -999;
  forgedCandidate.constraintFamilies = {
    pairwisePenetration:-1,
    skeletalPenetration:-1,
    compartmentEscape:-1,
  };
  rehashTrajectory(forgedCandidatePhysics);

  const arbitraryRejection = relabeledNonlinearFloor(budget);
  arbitraryRejection.work.rows.at(-1).candidateReceipts[0].rejectionReason =
    'forged-rejection';
  rehashTrajectory(arbitraryRejection);

  const forgedActiveRows = structuredClone(budget);
  forgedActiveRows.work.rows[0].directionConstruction.activeRows[0].violation = -999;
  rehashTrajectory(forgedActiveRows);
  const forgeries = [
    ['physically unchanged accepted-row active residual', forgedActiveResidual],
    ['accepted rows after the first physical tolerance crossing', lateFeasible],
    ['accepted-step hash reused for a rejected floor', staleAcceptedStepHash],
    ['substituted nonlinear-floor radius', substitutedRadius],
    ['forged nonlinear-floor candidate physics', forgedCandidatePhysics],
    ['arbitrary nonlinear-floor rejection reason', arbitraryRejection],
    ['forged active-row violation and activation evidence', forgedActiveRows],
  ];
  const admittedForgeries = [];
  for (const [label, forged] of forgeries) {
    try {
      validate(forged);
      admittedForgeries.push(label);
    } catch {
      // Expected: admission must reject every independently forged authority field.
    }
  }
  assert.deepEqual(
    admittedForgeries,
    [],
    `continuation admission accepted stored-field forgeries: ${admittedForgeries.join(', ')}`,
  );
});

test('continuation result admission binds budget, feasible, and floor terminal semantics', async () => {
  const assay = await import('../nbody-packing-restoration-assay.mjs');
  assert.equal(
    typeof assay.validateNBodyPackingActiveRowContinuationResult,
    'function',
    'active-row continuation result admission validator is not implemented',
  );
  const problem = continuationProblem();
  const budget = clonedContinuation();
  const requestedConfig = createNBodyActiveRowTrustRegionTrajectoryConfig({
    iterationBudget:8,
  });
  const validate = trajectory => assay.validateNBodyPackingActiveRowContinuationResult({
    trajectory,
    problem,
    sourceVector:budget.start.vector,
    requestedConfig:trajectory.config.requested,
  });

  const oneStepBudgetConfig = createNBodyActiveRowTrustRegionTrajectoryConfig({
    iterationBudget:1,
  });
  const lawfulBudget = solveNBodyActiveRowTrustRegionTrajectory({
    problem,
    startVector:budget.start.vector,
    requestedConfig:oneStepBudgetConfig,
  });
  assert.equal(validate(lawfulBudget).terminalClass, 'budget-exhausted');

  const falseBudget = structuredClone(lawfulBudget);
  falseBudget.work.terminalReason = 'nonlinear-active-row-trust-region-floor';
  rehashTrajectory(falseBudget);
  assert.throws(() => validate(falseBudget), /deterministic step reconstruction/);

  const feasibleConfig = createNBodyActiveRowTrustRegionTrajectoryConfig({
    iterationBudget:1,
    convergenceTolerance:0.004275,
  });
  const lawfulFeasible = solveNBodyActiveRowTrustRegionTrajectory({
    problem,
    startVector:budget.start.vector,
    requestedConfig:feasibleConfig,
  });
  assert.equal(validate(lawfulFeasible).terminalClass, 'feasible');

  const nonlinearFloorConfig = createNBodyActiveRowTrustRegionTrajectoryConfig({
    iterationBudget:1,
    step:{
      ...oneStepBudgetConfig.step,
      trustRegionRadii:[0.001, 0.0005],
    },
  });
  const lawfulNonlinearFloor = solveNBodyActiveRowTrustRegionTrajectory({
    problem,
    startVector:budget.start.vector,
    requestedConfig:nonlinearFloorConfig,
  });
  assert.equal(validate(lawfulNonlinearFloor).terminalClass, 'local-floor');
  assert.equal(
    lawfulNonlinearFloor.work.terminalReason,
    'nonlinear-active-row-trust-region-floor',
  );

  const linearizedFloorConfig = createNBodyActiveRowTrustRegionTrajectoryConfig({
    iterationBudget:1,
    step:createNBodyActiveRowTrustRegionConfig({
      activeSetPolicy:'family-maximum-relative-band',
      relativeActivationBand:0.999999,
    }),
  });
  const lawfulLinearizedFloor = solveNBodyActiveRowTrustRegionTrajectory({
    problem,
    startVector:budget.start.vector,
    requestedConfig:linearizedFloorConfig,
  });
  assert.equal(validate(lawfulLinearizedFloor).terminalClass, 'local-floor');
  assert.equal(
    lawfulLinearizedFloor.work.terminalReason,
    'local-active-row-cone-certificate',
  );

  const falseFloor = structuredClone(lawfulNonlinearFloor);
  falseFloor.work.rows.at(-1).certificate.kind = 'linearized-active-row-cone-floor';
  rehashTrajectory(falseFloor);
  assert.throws(() => validate(falseFloor), /deterministic step reconstruction/);

  const falseAcceptedRow = structuredClone(lawfulBudget);
  falseAcceptedRow.work.rows[0].candidateReceipts[0].selected = true;
  rehashTrajectory(falseAcceptedRow);
  assert.throws(() => validate(falseAcceptedRow), /deterministic step reconstruction/);

  const falsePhysicalRow = structuredClone(lawfulBudget);
  falsePhysicalRow.work.rows.at(-1).after.maximumPhysicalResidual += 0.0000000001;
  falsePhysicalRow.work.rows.at(-1).candidateReceipts.find(
    candidate => candidate.selected,
  ).maximumPhysicalResidual += 0.0000000001;
  rehashTrajectory(falsePhysicalRow);
  assert.throws(() => validate(falsePhysicalRow), /deterministic step reconstruction/);

  assert.deepEqual(budget.config.requested, requestedConfig);
});

test('active-row continuation rejects a rehashed prior-result substitution before solve', async () => {
  const assay = await import('../nbody-packing-restoration-assay.mjs');
  assert.equal(
    typeof assay.runNBodyPackingActiveRowTrajectoryContinuationAssay,
    'function',
    'active-row continuation assay is not implemented',
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-active-row-continuation-source-'));
  const sourceResult = JSON.parse(fs.readFileSync(`${SOURCE_ROOT}/result.json`, 'utf8'));
  sourceResult.selected.vector[0] += 0.000001;
  delete sourceResult.identity;
  sourceResult.identity = { sha256:hashMusclePackingCanonicalJson(sourceResult) };
  const substitutedPath = path.join(outDir, 'substituted-active-row-result.json');
  fs.writeFileSync(substitutedPath, `${JSON.stringify(sourceResult, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'raw-trajectory.json'), '{"status":"stale-raw"}\n');
  fs.writeFileSync(path.join(outDir, 'result.json'), '{"status":"stale-success"}\n');

  await assert.rejects(
    assay.runNBodyPackingActiveRowTrajectoryContinuationAssay({
      outDir,
      activeRowRawPath:`${SOURCE_ROOT}/raw-trajectory.json`,
      activeRowResultPath:substitutedPath,
      activeRowReportPath:`${SOURCE_ROOT}/run-report.json`,
    }),
    /substituted admitted active-row trajectory/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'bind-admitted-active-row-source');
  assert.equal(report.route.effective, null);
  assert.equal(fs.existsSync(path.join(outDir, 'raw-trajectory.json')), false);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
});

test('continuation witness projects step-eight and row-admission states without solver replay', async () => {
  const witness = await import('../nbody-packing-active-row-trajectory-witness.mjs');
  assert.equal(
    typeof witness.writeNBodyPackingActiveRowContinuationWitness,
    'function',
    'active-row continuation witness is not implemented',
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-active-row-continuation-viewer-'));
  const { report, states } = await witness.writeNBodyPackingActiveRowContinuationWitness({
    outDir,
  });
  const continuation = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-active-row-trust-region-trajectory-continuation-v0/result.json',
    'utf8',
  ));
  assert.deepEqual(report.requiredStates, [
    'active-row-step-8',
    'active-row-step-9',
    'active-row-step-11',
    'active-row-step-12',
    'active-row-step-16',
    'manufactured-reference',
  ]);
  assert.deepEqual(states['active-row-step-9'].metrics, continuation.work.rows[0].after.metrics);
  assert.deepEqual(states['active-row-step-11'].metrics, continuation.work.rows[2].after.metrics);
  assert.deepEqual(states['active-row-step-12'].metrics, continuation.work.rows[3].after.metrics);
  assert.deepEqual(states['active-row-step-16'].metrics, continuation.selected.metrics);
  assert.equal(report.classification.solverReplayedForPresentation, false);
  assert.deepEqual(report.classification.activeRowCounts, [6, 7, 8, 9, 9]);
  assert.equal(report.classification.lastStepActiveRowCount, 9);
  assert.equal(report.classification.postStepEligibleActiveRowCount, 10);
  assert.equal('nearBindingInactiveRow' in report.classification, false);
  assert.deepEqual(
    report.classification.postStepNewlyEligibleRows.map(row => row.key),
    ['compartment-lower:density-06-02:1:0'],
  );
  const newlyEligible = report.classification.postStepNewlyEligibleRows[0];
  assert.equal(newlyEligible.violation, 0.004243507635228738);
  assert.equal(newlyEligible.familyMaximum, 0.004249551501073201);
  assert.equal(newlyEligible.activationThreshold, 0.004207055986062469);
  assert.equal(newlyEligible.relativeToFamilyMaximum, 0.9985777638315628);
  assert.equal(
    report.bindings.continuationResultIdentitySha256,
    continuation.identity.sha256,
  );
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.match(html, /Step-eight continuation · active-set accretion/);
  assert.match(html, /step 11 · eighth row admitted/);
  assert.match(html, /step 12 · ninth row admitted/);
  assert.match(html, /solver inputs · oracle \/ contact graph/);
  assert.match(html, />no \/ yes<\/span>/);
});

test('visual inspection admission requires a real RFC3339 observation time', async () => {
  const witness = await import('../nbody-packing-localized-witness.mjs');
  assert.equal(
    typeof witness.isValidNBodyPackingRfc3339Timestamp,
    'function',
    'RFC3339 visual-inspection timestamp validator is not implemented',
  );
  assert.equal(witness.isValidNBodyPackingRfc3339Timestamp(
    '2026-08-13T07:36:15.300Z'), true);
  assert.equal(witness.isValidNBodyPackingRfc3339Timestamp(
    '2026-08-13T03:36:15.300-04:00'), true);
  assert.equal(witness.isValidNBodyPackingRfc3339Timestamp(
    '2026-08-13T07:36:15.3NZ'), false);
  assert.equal(witness.isValidNBodyPackingRfc3339Timestamp(
    '2026-02-30T07:36:15Z'), false);
  assert.equal(witness.isValidNBodyPackingRfc3339Timestamp('not-a-time'), false);
});

test('continuation witness rejects a canonically rehashed continuation substitution', async () => {
  const witness = await import('../nbody-packing-active-row-trajectory-witness.mjs');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-active-row-viewer-source-'));
  const sourceResult = JSON.parse(fs.readFileSync(`${CONTINUATION_ROOT}/result.json`, 'utf8'));
  sourceResult.selected.vector[0] += 0.000001;
  delete sourceResult.identity;
  sourceResult.identity = { sha256:hashMusclePackingCanonicalJson(sourceResult) };
  const substitutedPath = path.join(outDir, 'substituted-continuation.json');
  fs.writeFileSync(substitutedPath, `${JSON.stringify(sourceResult, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'index.html'), '<p>stale success</p>\n');
  fs.writeFileSync(path.join(outDir, 'comparison.json'), '{"status":"stale"}\n');

  await assert.rejects(
    witness.writeNBodyPackingActiveRowContinuationWitness({
      outDir,
      continuationRawPath:substitutedPath,
      continuationResultPath:substitutedPath,
    }),
    /substituted continuation source/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'bind-active-row-continuation-source');
  assert.equal(report.route.effective, null);
  assert.equal(fs.existsSync(path.join(outDir, 'index.html')), false);
  assert.equal(fs.existsSync(path.join(outDir, 'comparison.json')), false);
});
