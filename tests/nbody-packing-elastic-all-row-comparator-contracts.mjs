import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const FROZEN_RADII = Object.freeze([
  0.001,
  0.0005,
  0.00025,
  0.000125,
  0.0000625,
  0.00003125,
  0.000015625,
  0.0000078125,
  0.00000390625,
  0.000001953125,
  0.0000009765625,
  0.00000048828125,
  0.000000244140625,
  0.0000001220703125,
  0.00000006103515625,
  0.000000030517578125,
  0.0000000152587890625,
  0.00000000762939453125,
  0.000000003814697265625,
  0.0000000019073486328125,
]);

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

function rehash(value) {
  delete value.identity;
  value.identity = { sha256:hashMusclePackingCanonicalJson(value) };
  return value;
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test('elastic all-row comparator exposes the frozen explicit-slack/evaluation contract', () => {
  assert.equal(
    typeof restoration.createNBodyElasticAllRowComparatorConfig,
    'function',
    'the frozen assay requires an explicit elastic all-row config constructor',
  );
  assert.equal(
    typeof restoration.solveNBodyElasticAllRowComparatorStep,
    'function',
    'the frozen assay requires an explicit elastic all-row step solver',
  );

  const config = restoration.createNBodyElasticAllRowComparatorConfig();
  assert.deepEqual(config, {
    algorithm:'elastic-all-row-linearized-least-squares-trust-region-v0',
    candidateEnumeration:'canonical',
    convergenceTolerance:1e-12,
    familyTradeoffAllowance:0.00004249551501,
    finiteDifferenceStep:1e-5,
    improvementTolerance:1e-12,
    internalIterationBudget:64,
    pivotTolerance:1e-14,
    slackPenalty:1,
    stepRegularization:1e-4,
    translationBounds:[-0.3, 0.3],
    trustRegionRadii:[...FROZEN_RADII],
  });

  const source = frozenCase();
  const result = restoration.solveNBodyElasticAllRowComparatorStep({
    ...source,
    requestedConfig:config,
  });

  assert.equal(result.schema, restoration.NBODY_PACKING_ELASTIC_ALL_ROW_RESULT_SCHEMA);
  assert.deepEqual(result.route, {
    requested:config.algorithm,
    effective:config.algorithm,
    fallbackUsed:false,
  });
  assert.equal(result.source.problemSha256, FROZEN_PROBLEM_SHA256);
  assert.equal(result.start.rowCount, 531);
  assert.equal(result.start.violatedRowCount, 12);
  assert.ok(
    Math.abs(
      result.start.allRowSquaredViolationEnergy - 0.00011082913108091879
    ) < 1e-18,
  );
  assert.equal(result.linearization.rows.length, 531);
  assert.equal(
    result.linearization.predictionBasis,
    'full-radius-linearized-subproblem-displacement',
  );
  assert.equal(new Set(result.linearization.rows.map(row => row.key)).size, 531);
  assert.equal(result.linearization.rows.every(row => row.gradient.length === 24), true);
  assert.equal(result.linearization.rows.every(row => row.predictedSlack >= 0), true);
  assert.equal(result.work.evaluationCount, 69);
  assert.equal(result.work.candidateReceipts.length, FROZEN_RADII.length);
  assert.deepEqual(
    result.work.candidateReceipts.map(row => row.radius),
    FROZEN_RADII,
  );
  const linearizationByKey = new Map(
    result.linearization.rows.map(row => [row.key, row]),
  );
  const selectedCandidate = result.work.candidateReceipts.find(row => row.selected);
  assert.equal(selectedCandidate.radius, 0.0000625);
  const selectedRows = new Map(selectedCandidate.rowLedger.map(row => [row.key, row]));
  assertClose(
    selectedRows.get('compartment-lower:density-06-02:1:0').predictedSignedGap,
    -0.00421231750142924,
    2e-12,
    'selected lower-wall prediction must use the selected candidate displacement',
  );
  for (const candidate of result.work.candidateReceipts) {
    assert.equal(
      candidate.predictionBasis,
      'candidate-actual-clamped-displacement',
    );
    const candidateDisplacement = candidate.vector.map(
      (value, axis) => value - result.start.vector[axis],
    );
    for (const row of candidate.rowLedger) {
      const linearization = linearizationByKey.get(row.key);
      assert.ok(linearization, `candidate row ${row.key} must bind a source linearization`);
      const expectedGap = row.beforeSignedGap + dot(
        linearization.gradient,
        candidateDisplacement,
      );
      const expectedSlack = Math.max(0, -expectedGap);
      assertClose(
        row.predictedSignedGap,
        expectedGap,
        2e-9,
        `candidate ${candidate.radius} row ${row.key} predicted gap mismatch`,
      );
      assertClose(
        row.predictedSlack,
        expectedSlack,
        2e-9,
        `candidate ${candidate.radius} row ${row.key} predicted slack mismatch`,
      );
    }
  }
  const expectedExchangeRows = Object.freeze({
    'compartment-lower:density-06-02:1:0':Object.freeze({
      predictedGap:-0.00421231750142924,
      predictedSlack:0.00421231750142924,
    }),
    'pair:density-06-01:2|density-06-02:2':Object.freeze({
      predictedGap:-0.0008409880250777699,
      predictedSlack:0.0008409880250777699,
    }),
    'bone:density-06-01:2|density-6-offset-bone':Object.freeze({
      predictedGap:-0.0009186551933137054,
      predictedSlack:0.0009186551933137054,
    }),
  });
  for (const [key, expected] of Object.entries(expectedExchangeRows)) {
    const row = selectedRows.get(key);
    assert.ok(row, `selected receipt must expose exchange row ${key}`);
    assertClose(row.predictedSignedGap, expected.predictedGap, 2e-12, `${key} predicted gap`);
    assertClose(row.predictedSlack, expected.predictedSlack, 2e-12, `${key} predicted slack`);
  }
  const largestRadiusRows = new Map(
    result.work.candidateReceipts[0].rowLedger.map(row => [row.key, row]),
  );
  assert.notEqual(
    largestRadiusRows.get('compartment-lower:density-06-02:1:0').predictedSignedGap,
    selectedRows.get('compartment-lower:density-06-02:1:0').predictedSignedGap,
    'distinct radii with nonzero projected gradient must not reuse one prediction',
  );
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.equal(result.selected.metrics.maximumRelativeVolumeError, 0);
  assert.equal(result.selected.metrics.nonFiniteValueCount, 0);
  assert.equal(result.selected.metrics.nonPositiveRadiusCount, 0);
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, true);
  assert.equal(result.identity.sha256.length, 64);
});

test('elastic all-row assay persists one source-bound equal-budget raw pair before admission', async t => {
  const assay = await import('../nbody-packing-restoration-assay.mjs');
  assert.equal(
    typeof assay.runNBodyPackingElasticAllRowComparatorAssay,
    'function',
    'the frozen assay requires a raw-first control/comparator pair runner',
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elastic-all-row-pair-'));
  t.after(() => fs.rmSync(outDir, { recursive:true, force:true }));
  const { rawPair, result, report } =
    await assay.runNBodyPackingElasticAllRowComparatorAssay({ outDir });
  assert.equal(fs.existsSync(path.join(outDir, 'raw-pair.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'run-report.json')), true);
  assert.equal(rawPair.source.trajectorySha256, FROZEN_TRAJECTORY_SHA256);
  assert.equal(rawPair.source.problemSha256, FROZEN_PROBLEM_SHA256);
  assert.deepEqual(rawPair.budget, {
    controlPhysicalEvaluations:69,
    comparatorPhysicalEvaluations:69,
    equal:true,
    admissionReconstructionEvaluationsPerArm:69,
    selectedVerificationEvaluationsPerArm:1,
  });
  assert.equal(rawPair.control.directionConstruction.activeRows.length, 10);
  assert.equal(rawPair.comparator.linearization.rows.length, 531);
  assert.equal(result.status, 'complete-equal-budget-pair-admitted');
  assert.equal(report.status, 'complete-equal-budget-pair-admitted');
  assert.equal(result.decision.lowerWallKey, 'compartment-lower:density-06-02:1:0');
  assert.equal(report.bindings.rawPairSha256, rawPair.identity.sha256);
  assert.equal(report.bindings.resultSha256, result.identity.sha256);
  assert.equal(report.bindings.reconstructionControlSha256, rawPair.control.identity.sha256);
  assert.equal(
    report.bindings.reconstructionComparatorSha256,
    rawPair.comparator.identity.sha256,
  );

  const source = frozenCase();
  const forgedSlack = structuredClone(rawPair);
  forgedSlack.comparator.linearization.rows[0].predictedSlack = -1;
  rehash(forgedSlack.comparator);
  rehash(forgedSlack);
  assert.throws(
    () => assay.validateNBodyPackingElasticAllRowRawPair({
      pair:forgedSlack,
      problem:source.problem,
      sourceVector:source.startVector,
    }),
    /forged comparator result or ledger/,
  );

  const forgedControl = structuredClone(rawPair);
  forgedControl.control.directionConstruction.activeRows[0].violation = -1;
  rehash(forgedControl.control);
  rehash(forgedControl);
  assert.throws(
    () => assay.validateNBodyPackingElasticAllRowRawPair({
      pair:forgedControl,
      problem:source.problem,
      sourceVector:source.startVector,
    }),
    /forged control result or ledger/,
  );

  const hiddenAsymmetry = structuredClone(rawPair);
  hiddenAsymmetry.budget.comparatorPhysicalEvaluations = 68;
  hiddenAsymmetry.budget.equal = true;
  rehash(hiddenAsymmetry);
  assert.throws(
    () => assay.validateNBodyPackingElasticAllRowRawPair({
      pair:hiddenAsymmetry,
      problem:source.problem,
      sourceVector:source.startVector,
    }),
    /config or evaluation budget mismatch/,
  );
});

test('elastic all-row assay removes a stale primary and reports its failure phase', async t => {
  const assay = await import('../nbody-packing-restoration-assay.mjs');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elastic-all-row-failure-'));
  t.after(() => fs.rmSync(outDir, { recursive:true, force:true }));
  fs.writeFileSync(path.join(outDir, 'result.json'), '{"status":"stale-success"}\n');
  await assert.rejects(
    assay.runNBodyPackingElasticAllRowComparatorAssay({
      outDir,
      sourceRawPath:'package.json',
    }),
    /stale elastic comparator step-sixteen source identity/,
  );
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
  assert.equal(fs.existsSync(path.join(outDir, 'raw-pair.json')), false);
  const failure = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'read-frozen-step-sixteen-source');
  assert.equal(failure.route.fallbackUsed, false);
});
