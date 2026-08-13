import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createNBodyLocalizedChallengeSuite } from '../nbody-packing-assay-core.mjs';
import {
  compileNBodyAdaptiveKktProblem,
  evaluateNBodyUnifiedKktState,
} from '../nbody-packing-unified-kkt.mjs';
import { hashMusclePackingCanonicalJson } from '../muscle-compartment-packing-core.mjs';
import {
  createNBodyAllNeighborRestorationConfig,
  createNBodyFamilyGradientCommonDescentConfig,
  solveNBodyAllNeighborRestoration,
  solveNBodyFamilyGradientCommonDescent,
} from '../nbody-packing-restoration.mjs';
import {
  runNBodyPackingCommonDescentAssay,
  runNBodyPackingRestorationAssay,
} from '../nbody-packing-restoration-assay.mjs';
import {
  admitNBodyAdaptiveTrajectoryRaw,
  validateNBodyAdaptiveTrajectoryRaw,
} from '../nbody-packing-adaptive-trajectory-admission.mjs';

const COMPILED_ROW_COORDINATE_SEARCH_FLOOR = 0.004815758612;
const COORDINATE_SEARCH_VECTOR = Object.freeze([
  0.079358289678991,
  -0.164657554847671,
  0.043351880061529,
  -0.049452116108372,
  -0.291825791820884,
  0.06807388248236801,
  0.173822771757841,
  -0.042193231690992004,
  -0.235598279527396,
  0.09549477903056,
  -0.077213256619871,
  -0.160764148178279,
  -0.059002114134815,
  -0.12153735986254198,
  0.038702352820143,
  0.076349170832406,
  -0.021966291592986,
  -0.030781325831866,
  0.000969318067879,
  -0.014674962791597,
  0.012093608910812,
  -0.055243825084133,
  -0.005857190076657,
  -0.013337308333688,
]);

function compiledConstraintFamilyMaxima(rows) {
  const byKind = {
    'pairwise-clearance':'pairwisePenetration',
    'skeletal-clearance':'skeletalPenetration',
    'compartment-clearance':'compartmentEscape',
  };
  const maxima = {
    pairwisePenetration:0,
    skeletalPenetration:0,
    compartmentEscape:0,
  };
  for (const row of rows) {
    const family = byKind[row.kind];
    if (family) maxima[family] = Math.max(maxima[family], Math.max(0, -row.signedGap));
  }
  return Object.fromEntries(Object.entries(maxima).map(
    ([family, value]) => [family, Number(value.toFixed(12))],
  ));
}

test('unified KKT publishes compiled constraint-row family maxima as its physical ledger', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const state = evaluateNBodyUnifiedKktState({
    problem,
    vector:COORDINATE_SEARCH_VECTOR,
  });
  const compiled = compiledConstraintFamilyMaxima(state.rows);

  assert.deepEqual(
    {
      pairwisePenetration:state.metrics.pairwisePenetration,
      skeletalPenetration:state.metrics.skeletalPenetration,
      compartmentEscape:state.metrics.compartmentEscape,
    },
    compiled,
  );
  assert.equal(compiled.compartmentEscape, 0.004815758612);
  assert.equal(state.maximumPhysicalResidual, compiled.compartmentEscape);
});

test('all-neighbor restoration improves the compiled-row severity-0.32 baseline', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const current = evaluateNBodyUnifiedKktState({
    problem,
    vector:COORDINATE_SEARCH_VECTOR,
  });
  const requestedConfig = createNBodyAllNeighborRestorationConfig();
  const result = solveNBodyAllNeighborRestoration({
    problem,
    startVector:COORDINATE_SEARCH_VECTOR,
    requestedConfig,
  });

  assert.equal(current.maximumPhysicalResidual, COMPILED_ROW_COORDINATE_SEARCH_FLOOR);
  assert.ok(
    result.selected.maximumPhysicalResidual < current.maximumPhysicalResidual,
    `restoration route has not improved compiled-row debt: ${result.selected.maximumPhysicalResidual}`,
  );
  assert.equal(result.selected.maximumPhysicalResidual, 0.00447138638);
  assert.equal(result.status, 'restoration-floor-improved');
  assert.equal(result.route.effective,
    'all-neighbor-p8-merit-trust-region-restoration-v0');
  assert.equal(result.route.fallbackUsed, false);
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, false);
  assert.equal(result.mechanism.carrierDegreesOfFreedomPerMember, 4);
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  assert.equal(result.invariance.maximumVectorDifference, 0);
  assert.equal(result.invariance.maximumMetricsDifference, 0);
  assert.equal(result.work.iterations, 1);
  assert.ok(result.work.rows[0].directionNonzeroCoordinateCount > 1);
  assert.equal(result.work.rows[0].acceptedTrustRegionRadius, 0.001);
  assert.deepEqual(result.work.rows[0].violatedKinds, [
    'compartment-clearance',
    'pairwise-clearance',
    'skeletal-clearance',
  ]);
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.ok(result.selected.metrics.maximumRelativeVolumeError <= 1e-9);
});

test('repeated all-neighbor restoration preserves a complete deterministic decision ledger', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const requestedConfig = createNBodyAllNeighborRestorationConfig();
  requestedConfig.iterationBudget = 6;
  const result = solveNBodyAllNeighborRestoration({
    problem,
    startVector:COORDINATE_SEARCH_VECTOR,
    requestedConfig,
  });

  assert.equal(result.work.iterations, 5);
  assert.equal(result.work.attempts, 6);
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  assert.equal(result.invariance.maximumVectorDifference, 0);
  assert.equal(result.invariance.maximumMetricsDifference, 0);
  assert.equal(result.work.rows.length, 6);
  assert.equal(result.selected.maximumPhysicalResidual, 0.00311519149);
  assert.deepEqual(
    {
      pairwisePenetration:result.start.metrics.pairwisePenetration,
      skeletalPenetration:result.start.metrics.skeletalPenetration,
      compartmentEscape:result.start.metrics.compartmentEscape,
    },
    {
      pairwisePenetration:0.001615321454,
      skeletalPenetration:0.001615326586,
      compartmentEscape:0.004815758612,
    },
  );
  assert.equal(result.invariance.rows[0].metrics.pairwisePenetration, 0.002472001529);
  assert.equal(result.selected.metrics.pairwisePenetration, 0.002472001529);
  assert.ok(result.selected.metrics.pairwisePenetration > result.start.metrics.pairwisePenetration);
  for (const row of result.work.rows.slice(0, -1)) {
    assert.equal(row.accepted, true);
    assert.ok(row.after.maximumPhysicalResidual < row.before.maximumPhysicalResidual);
    assert.ok(row.after.merit < row.before.merit);
    assert.equal(row.candidateReceipts.length, requestedConfig.trustRegionRadii.length);
    assert.equal(row.candidateReceipts.filter(candidate => candidate.selected).length, 1);
    for (const candidate of row.candidateReceipts) {
      if (candidate.selected) {
        assert.equal(candidate.rejectionReason, null);
      } else {
        assert.match(candidate.rejectionReason, /^(higher-ranked-admissible-candidate|non-improving-physical-residual|non-improving-merit)$/);
      }
    }
  }
  const terminal = result.work.rows.at(-1);
  assert.equal(terminal.accepted, false);
  assert.equal(terminal.terminalReason, 'no-admissible-trust-region-candidate');
  assert.equal(terminal.after.maximumPhysicalResidual, terminal.before.maximumPhysicalResidual);
  assert.equal(terminal.candidateReceipts.filter(candidate => candidate.selected).length, 0);
  assert.deepEqual(
    result.invariance.rows[0].work,
    result.invariance.rows[1].work,
  );
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.equal(result.selected.metrics.maximumRelativeVolumeError, 0);
});

test('all-neighbor restoration retains every trust-radius disposition', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const requestedConfig = createNBodyAllNeighborRestorationConfig();
  const result = solveNBodyAllNeighborRestoration({
    problem,
    startVector:COORDINATE_SEARCH_VECTOR,
    requestedConfig,
  });
  const row = result.work.rows[0];

  assert.equal(row.candidateReceipts.length, requestedConfig.trustRegionRadii.length);
  assert.equal(row.candidateReceipts.filter(candidate => candidate.selected).length, 1);
  assert.deepEqual(
    row.candidateReceipts.map(candidate => candidate.radius).sort((left, right) => right - left),
    requestedConfig.trustRegionRadii,
  );
  assert.ok(row.candidateReceipts.every(candidate =>
    candidate.selected ? candidate.rejectionReason === null : candidate.rejectionReason,
  ));
});

test('family-filter configuration is a distinct no-resurrection route', () => {
  const config = createNBodyAllNeighborRestorationConfig({
    acceptancePolicy:'family-pareto-no-resurrection',
  });
  assert.equal(
    config.algorithm,
    'all-neighbor-p8-family-filter-restoration-v0',
  );
  assert.equal(config.acceptancePolicy, 'family-pareto-no-resurrection');
  assert.equal(config.familyRegressionTolerance, 1e-12);
});

test('family-gradient common descent clears debt without trading constraint families', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const requestedConfig = createNBodyFamilyGradientCommonDescentConfig();
  const canonical = solveNBodyFamilyGradientCommonDescent({
    problem,
    startVector:COORDINATE_SEARCH_VECTOR,
    requestedConfig,
  });
  const reverseConfig = {
    ...createNBodyFamilyGradientCommonDescentConfig(),
    candidateEnumeration:'reverse',
  };
  const reverse = solveNBodyFamilyGradientCommonDescent({
    problem,
    startVector:COORDINATE_SEARCH_VECTOR,
    requestedConfig:reverseConfig,
  });

  assert.equal(canonical.status, 'common-descent-step-accepted');
  assert.equal(
    canonical.route.effective,
    'family-gradient-minimum-norm-common-descent-v0',
  );
  assert.equal(canonical.route.fallbackUsed, false);
  assert.deepEqual(canonical.directionConstruction.convexWeights, [
    0.2525995924815,
    0.42240697146204,
    0.32499343605646,
  ]);
  assert.equal(canonical.directionConstruction.minimumNorm, 0.24913205776668);
  assert.deepEqual(canonical.directionConstruction.predictedDirectionalDerivatives, {
    pairwisePenetration:-0.24913205776668,
    skeletalPenetration:-0.24913205776668,
    compartmentEscape:-0.24913205776668,
  });
  assert.equal(canonical.directionConstruction.predictedCommonDescent, true);
  assert.equal(canonical.work.iterations, 1);
  assert.equal(canonical.work.attempts, 1);
  assert.equal(canonical.work.terminalReason, null);
  assert.equal(canonical.work.candidateReceipts.length, 7);
  assert.deepEqual(
    canonical.work.candidateReceipts.map(candidate => candidate.radius),
    requestedConfig.trustRegionRadii,
  );
  assert.equal(
    canonical.work.candidateReceipts.filter(candidate => candidate.selected).length,
    1,
  );
  assert.equal(
    canonical.work.candidateReceipts.find(candidate => candidate.selected).radius,
    0.00025,
  );
  assert.equal(canonical.work.candidateReceipts.filter(
    candidate => candidate.regressedFamilies.includes('compartmentEscape'),
  ).length, 4);
  assert.equal(
    canonical.work.candidateReceipts.find(candidate => candidate.selected)
      .regressedFamilies.length,
    0,
  );
  assert.deepEqual(
    {
      pairwisePenetration:canonical.selected.metrics.pairwisePenetration,
      skeletalPenetration:canonical.selected.metrics.skeletalPenetration,
      compartmentEscape:canonical.selected.metrics.compartmentEscape,
    },
    {
      pairwisePenetration:0.001531913516,
      skeletalPenetration:0.001545080434,
      compartmentEscape:0.004745541883,
    },
  );
  assert.equal(canonical.start.maximumPhysicalResidual, 0.004815758612);
  assert.equal(canonical.selected.maximumPhysicalResidual, 0.004745541883);
  assert.ok(canonical.selected.maximumPhysicalResidual < canonical.start.maximumPhysicalResidual);
  assert.equal(canonical.selected.metrics.endpointDrift, 0);
  assert.equal(canonical.selected.metrics.maximumRelativeVolumeError, 0);
  assert.equal(canonical.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(canonical.mechanism.contactGraphRowsConsumed, false);
  assert.equal(canonical.mechanism.carrierDegreesOfFreedomPerMember, 4);
  assert.deepEqual(canonical.directionConstruction, reverse.directionConstruction);
  assert.deepEqual(canonical.selected, reverse.selected);
  assert.deepEqual(canonical.work, reverse.work);
  const core = structuredClone(canonical);
  delete core.identity;
  assert.equal(canonical.identity.sha256, hashMusclePackingCanonicalJson(core));
});

test('family-filter restoration exposes the first no-debt-trading plateau', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const requestedConfig = createNBodyAllNeighborRestorationConfig({
    acceptancePolicy:'family-pareto-no-resurrection',
  });
  requestedConfig.iterationBudget = 6;
  const result = solveNBodyAllNeighborRestoration({
    problem,
    startVector:COORDINATE_SEARCH_VECTOR,
    requestedConfig,
  });

  assert.equal(result.route.effective, 'all-neighbor-p8-family-filter-restoration-v0');
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  assert.equal(result.status, 'stalled-family-filter-restoration');
  assert.equal(result.work.iterations, 0);
  assert.equal(result.work.attempts, 1);
  assert.equal(result.work.rows[0].accepted, false);
  assert.equal(result.work.rows[0].terminalReason, 'no-admissible-trust-region-candidate');
  assert.equal(
    result.selected.maximumPhysicalResidual,
    COMPILED_ROW_COORDINATE_SEARCH_FLOOR,
  );
  assert.equal(result.selected.metrics.pairwisePenetration, 0.001615321454);
  assert.equal(result.selected.metrics.compartmentEscape, 0.004815758612);
  assert.equal(
    result.work.rows[0].candidateReceipts.length,
    requestedConfig.trustRegionRadii.length,
  );
  assert.deepEqual(
    result.work.rows[0].candidateReceipts.map(candidate => candidate.radius),
    requestedConfig.trustRegionRadii,
  );
  assert.equal(
    result.work.rows[0].candidateReceipts.filter(candidate => candidate.selected).length,
    0,
  );
  assert.ok(result.work.rows[0].candidateReceipts.every(candidate =>
    candidate.rejectionReason === 'constraint-family-regression' ||
      candidate.rejectionReason === 'non-improving-physical-residual' ||
      candidate.rejectionReason === 'non-improving-merit',
  ));
  assert.equal(
    result.work.rows[0].candidateReceipts.some(
      candidate => candidate.rejectionReason === 'higher-ranked-admissible-candidate',
    ),
    false,
  );
  for (const candidate of result.work.rows[0].candidateReceipts) {
    assert.deepEqual(Object.keys(candidate.constraintFamilies).sort(), [
      'compartmentEscape',
      'pairwisePenetration',
      'skeletalPenetration',
    ]);
    assert.ok(Object.values(candidate.constraintFamilies).every(Number.isFinite));
    if (candidate.rejectionReason === 'constraint-family-regression') {
      assert.ok(candidate.regressedFamilies.length > 0);
      assert.ok(candidate.regressedFamilies.every(key =>
        candidate.constraintFamilies[key] >
          result.start.metrics[key] + requestedConfig.familyRegressionTolerance,
      ));
    }
  }
  assert.ok(result.work.rows[0].candidateReceipts.some(candidate =>
    candidate.regressedFamilies.includes('skeletalPenetration'),
  ));
  assert.deepEqual(result.selected.vector, result.start.vector);
  assert.deepEqual(result.invariance.rows[0].work, result.invariance.rows[1].work);
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.equal(result.selected.metrics.maximumRelativeVolumeError, 0);
});

test('restoration fails loud on an incomplete route config before evaluation', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const requestedConfig = createNBodyAllNeighborRestorationConfig();
  delete requestedConfig.violationWeight;
  assert.throws(
    () => solveNBodyAllNeighborRestoration({
      problem,
      startVector:COORDINATE_SEARCH_VECTOR,
      requestedConfig,
    }),
    /requires exact keys/,
  );
});

test('restoration rejects a seed outside the effective carrier bounds', () => {
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const invalidSeed = [...COORDINATE_SEARCH_VECTOR];
  invalidSeed[0] = 0.300001;
  assert.throws(
    () => solveNBodyAllNeighborRestoration({
      problem,
      startVector:invalidSeed,
      requestedConfig:createNBodyAllNeighborRestorationConfig(),
    }),
    /exceeds translationBounds/,
  );
});

test('restoration assay writes a durable terminal failure before primary output', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-restoration-failure-'));
  await assert.rejects(
    runNBodyPackingRestorationAssay({
      outDir,
      patternResultPath:path.join(outDir, 'missing-pattern.json'),
      homotopyResultPath:path.join(outDir, 'missing-homotopy.json'),
    }),
    /ENOENT/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'read-frozen-inputs');
  assert.equal(report.route.effective, null);
  assert.equal(report.lastTrustworthyEvidence.phase, 'none');
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
});

test('source-bound common-descent assay preserves exact mechanism and source custody', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-common-descent-assay-'));
  const { result, report } = await runNBodyPackingCommonDescentAssay({ outDir });
  assert.equal(report.status, 'complete-common-descent-step-admitted');
  assert.equal(
    report.route.effective,
    'family-gradient-minimum-norm-common-descent-v0',
  );
  assert.equal(report.route.fallbackUsed, false);
  assert.equal(report.source.fixtureSha256,
    '9498cc0ead3a390ee7854456f3afbe427f75453537dc10e0471c42553677f6dd');
  assert.equal(report.source.problemSha256,
    'cca9f08a740141647f085ac280d9e4fae006274c5e8e98c60ea66ebd68a0ab9c');
  assert.equal(result.status, 'common-descent-step-accepted');
  assert.equal(result.start.maximumPhysicalResidual, 0.004815758612);
  assert.equal(result.selected.maximumPhysicalResidual, 0.004745541883);
  assert.equal(result.selected.metrics.pairwisePenetration, 0.001531913516);
  assert.equal(result.selected.metrics.compartmentEscape, 0.004745541883);
  assert.equal(result.work.candidateReceipts.length, 7);
  assert.equal(result.work.candidateReceipts.filter(
    candidate => candidate.regressedFamilies.includes('compartmentEscape'),
  ).length, 4);
  assert.equal(
    result.work.candidateReceipts.find(candidate => candidate.selected).radius,
    0.00025,
  );
  assert.equal(report.comparison.sourceReported.authority,
    'historical-sampled-metrics-not-used-for-admission');
  assert.equal(report.comparison.effectiveCompiledRows.coordinateSearchFloor,
    result.start.maximumPhysicalResidual);
  assert.equal(report.comparison.effectiveCompiledRows.homotopyFloor, 0.037521132052);
  assert.equal(report.bindings.resultSha256, result.identity.sha256);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'run-report.json')), true);
});

test('common-descent assay rejects a canonically rehashed foreign homotopy source', async () => {
  const sourceRoot = path.resolve('artifacts/nbody-packing-localized-challenge-v0');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-common-descent-substitute-'));
  const homotopy = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, 'homotopy-032-fine-0875-to-1.json'),
    'utf8',
  ));
  homotopy.source.problemSha256 = 'f'.repeat(64);
  homotopy.source.fixtureSha256 = 'e'.repeat(64);
  delete homotopy.identity;
  homotopy.identity = { sha256:hashMusclePackingCanonicalJson(homotopy) };
  const substitutedPath = path.join(outDir, 'substituted-homotopy.json');
  fs.writeFileSync(substitutedPath, `${JSON.stringify(homotopy, null, 2)}\n`);
  await assert.rejects(
    runNBodyPackingCommonDescentAssay({
      outDir,
      patternResultPath:path.join(sourceRoot, 'oracle-pattern-search-032.json'),
      homotopyResultPath:substitutedPath,
    }),
    /substituted homotopy floor/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.route.requested,
    'family-gradient-minimum-norm-common-descent-v0');
  assert.equal(report.route.effective, null);
  assert.equal(report.failurePhase, 'bind-problem-and-baselines');
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
});

test('common-descent assay rejects a canonically rehashed same-problem pattern substitution', async () => {
  const sourceRoot = path.resolve('artifacts/nbody-packing-localized-challenge-v0');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-common-descent-pattern-pin-'));
  const pattern = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, 'oracle-pattern-search-032.json'),
    'utf8',
  ));
  pattern.mechanism.movePolicy = 'counterfeit-same-problem-move-policy';
  delete pattern.identity;
  pattern.identity = { sha256:hashMusclePackingCanonicalJson(pattern) };
  const substitutedPath = path.join(outDir, 'substituted-pattern.json');
  fs.writeFileSync(substitutedPath, `${JSON.stringify(pattern, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'result.json'), '{"status":"stale-success"}\n');

  await assert.rejects(
    runNBodyPackingCommonDescentAssay({
      outDir,
      patternResultPath:substitutedPath,
      homotopyResultPath:path.join(sourceRoot, 'homotopy-032-fine-0875-to-1.json'),
    }),
    /substituted coordinate-search floor/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.failurePhase, 'bind-problem-and-baselines');
  assert.equal(report.route.effective, null);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);

  const rerun = await runNBodyPackingCommonDescentAssay({ outDir });
  assert.equal(rerun.result.status, 'common-descent-step-accepted');
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), true);
});

test('common-descent assay rejects a canonically rehashed same-problem homotopy substitution', async () => {
  const sourceRoot = path.resolve('artifacts/nbody-packing-localized-challenge-v0');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-common-descent-homotopy-pin-'));
  const homotopy = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, 'homotopy-032-fine-0875-to-1.json'),
    'utf8',
  ));
  homotopy.stages[0].clearanceScale += 0.000001;
  delete homotopy.identity;
  homotopy.identity = { sha256:hashMusclePackingCanonicalJson(homotopy) };
  const substitutedPath = path.join(outDir, 'substituted-homotopy.json');
  fs.writeFileSync(substitutedPath, `${JSON.stringify(homotopy, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'result.json'), '{"status":"stale-success"}\n');

  await assert.rejects(
    runNBodyPackingCommonDescentAssay({
      outDir,
      patternResultPath:path.join(sourceRoot, 'oracle-pattern-search-032.json'),
      homotopyResultPath:substitutedPath,
    }),
    /substituted homotopy floor/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.failurePhase, 'bind-problem-and-baselines');
  assert.equal(report.route.effective, null);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
});

test('repeated row-authoritative common descent preserves every family or returns a local floor', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  assert.equal(
    typeof restoration.createNBodyFamilyGradientCommonDescentTrajectoryConfig,
    'function',
    'common-descent trajectory config is not implemented',
  );
  assert.equal(
    typeof restoration.solveNBodyFamilyGradientCommonDescentTrajectory,
    'function',
    'common-descent trajectory solver is not implemented',
  );

  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const requestedConfig = restoration
    .createNBodyFamilyGradientCommonDescentTrajectoryConfig({ iterationBudget:8 });
  const canonical = restoration.solveNBodyFamilyGradientCommonDescentTrajectory({
    problem,
    startVector:COORDINATE_SEARCH_VECTOR,
    requestedConfig,
  });
  const reverse = restoration.solveNBodyFamilyGradientCommonDescentTrajectory({
    problem,
    startVector:COORDINATE_SEARCH_VECTOR,
    requestedConfig:{ ...requestedConfig, candidateEnumeration:'reverse' },
  });

  assert.equal(canonical.route.fallbackUsed, false);
  assert.equal(canonical.status, 'common-descent-trajectory-local-floor');
  assert.equal(canonical.work.iterations, 2);
  assert.equal(canonical.work.attempts, 3);
  assert.equal(canonical.work.terminalReason, 'no-family-admissible-trust-region-candidate');
  assert.equal(canonical.selected.maximumPhysicalResidual, 0.004727985458);
  assert.deepEqual(
    {
      pairwisePenetration:canonical.selected.metrics.pairwisePenetration,
      skeletalPenetration:canonical.selected.metrics.skeletalPenetration,
      compartmentEscape:canonical.selected.metrics.compartmentEscape,
    },
    {
      pairwisePenetration:0.001511058501,
      skeletalPenetration:0.001527518628,
      compartmentEscape:0.004727985458,
    },
  );
  assert.deepEqual(
    canonical.work.rows.map(row =>
      row.candidateReceipts.find(candidate => candidate.selected)?.radius || null
    ),
    [0.00025, 0.0000625, null],
  );
  assert.equal(canonical.work.rows.at(-1).directionConstruction.predictedCommonDescent, true);
  assert.equal(canonical.work.rows.length, canonical.work.attempts);
  assert.ok(canonical.work.attempts >= 1);
  assert.ok(canonical.work.iterations <= requestedConfig.iterationBudget);
  assert.deepEqual(canonical.selected, reverse.selected);
  const withoutStepResultHashes = work => ({
    ...work,
    rows:work.rows.map(({ stepResultSha256, ...row }) => row),
  });
  assert.deepEqual(
    withoutStepResultHashes(canonical.work),
    withoutStepResultHashes(reverse.work),
  );
  for (const row of [...canonical.work.rows, ...reverse.work.rows]) {
    assert.match(row.stepResultSha256, /^[a-f0-9]{64}$/);
  }
  assert.notEqual(
    canonical.work.rows[0].stepResultSha256,
    reverse.work.rows[0].stepResultSha256,
    'step receipts must retain the requested enumeration identity',
  );
  assert.equal(canonical.selected.metrics.endpointDrift, 0);
  assert.equal(canonical.selected.metrics.maximumRelativeVolumeError, 0);
  for (const row of canonical.work.rows) {
    assert.equal(
      row.candidateReceipts.length,
      requestedConfig.trustRegionRadii.length,
    );
    if (!row.accepted) {
      assert.equal(row.after.maximumPhysicalResidual, row.before.maximumPhysicalResidual);
      assert.equal(row.candidateReceipts.filter(candidate => candidate.selected).length, 0);
      continue;
    }
    assert.ok(row.after.maximumPhysicalResidual < row.before.maximumPhysicalResidual);
    for (const family of [
      'pairwisePenetration',
      'skeletalPenetration',
      'compartmentEscape',
    ]) {
      assert.ok(
        row.after.metrics[family] <=
          row.before.metrics[family] + requestedConfig.familyRegressionTolerance,
        `${family} regressed at trajectory iteration ${row.iteration}`,
      );
    }
  }
  assert.ok([
    'common-descent-trajectory-budget-exhausted',
    'common-descent-trajectory-feasible',
    'common-descent-trajectory-local-floor',
  ].includes(canonical.status));
  assert.equal(canonical.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(canonical.mechanism.contactGraphRowsConsumed, false);
});

test('common-descent trajectory accepts an explicit refined trust-radius ladder', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  const trustRegionRadii = [
    0.004,
    0.002,
    0.001,
    0.0005,
    0.00025,
    0.000125,
    0.0000625,
    0.00003125,
    0.000015625,
    0.0000078125,
  ];
  const config = restoration.createNBodyFamilyGradientCommonDescentTrajectoryConfig({
    iterationBudget:8,
    trustRegionRadii,
  });

  assert.deepEqual(config.trustRegionRadii, trustRegionRadii);
  assert.equal(config.iterationBudget, 8);
});

test('adaptive common-descent config separates continuation seed from global radius ceiling', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  const step = restoration.createNBodyFamilyGradientAdaptiveStepConfig({
    initialRadius:0.0000625,
    maximumRadius:0.004,
  });
  const trajectory = restoration.createNBodyFamilyGradientAdaptiveTrajectoryConfig({
    iterationBudget:8,
  });

  assert.equal(step.initialRadius, 0.0000625);
  assert.equal(step.maximumRadius, 0.004);
  assert.ok(step.maximumRadius > step.initialRadius);
  assert.equal(trajectory.initialRadius, 0.004);
  assert.equal(trajectory.maximumRadius, 0.004);
  assert.ok(trajectory.radiusContinuationExpansion > 1);
  assert.throws(
    () => restoration.solveNBodyFamilyGradientAdaptiveStep({
      problem:null,
      startVector:[],
      requestedConfig:{ ...step, maximumRadius:step.initialRadius / 2 },
    }),
    /minimumRadius <= initialRadius <= maximumRadius/,
  );
  assert.throws(
    () => restoration.solveNBodyFamilyGradientAdaptiveStep({
      problem:null,
      startVector:[],
      requestedConfig:{ ...step, expansionFactor:1 },
    }),
    /expansionFactor must exceed one/,
  );
});

test('adaptive boundary admission distinguishes a constrained acceptance cliff from an open search edge', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  assert.equal(
    typeof restoration.adjudicateNBodyAdaptiveStepBoundary,
    'function',
    'adaptive boundary receipt adjudicator is not implemented',
  );
  const receipt = ({
    radius,
    residual,
    admissible,
    selected = false,
    rejectionReason = null,
    regressedFamilies = [],
  }) => ({
    radius,
    vector:[radius],
    maximumPhysicalResidual:residual,
    admissible,
    selected,
    rejectionReason,
    regressedFamilies,
  });
  const constrained = {
    bracket:{
      boundary:'admissibility-boundary',
      lowerTrialRadius:0.125,
      selectedRadius:0.25,
      upperTrialRadius:0.5,
      maximumRadius:4,
      minimumRadius:1e-10,
    },
    trialReceipts:[
      receipt({ radius:0.125, residual:0.48, admissible:true,
        rejectionReason:'higher-ranked-admissible-candidate' }),
      receipt({ radius:0.25, residual:0.45, admissible:true, selected:true }),
      receipt({ radius:0.5, residual:0.44, admissible:false,
        rejectionReason:'constraint-family-regression',
        regressedFamilies:['pairwisePenetration'] }),
    ],
  };

  assert.deepEqual(
    restoration.adjudicateNBodyAdaptiveStepBoundary(constrained),
    { admitted:true, classification:'constrained-admissibility-boundary', reason:null },
  );
  assert.deepEqual(
    restoration.adjudicateNBodyAdaptiveStepBoundary({
      ...constrained,
      bracket:{ ...constrained.bracket, boundary:'unclosed-upper-boundary',
        upperTrialRadius:null },
      trialReceipts:constrained.trialReceipts.slice(0, 2),
    }),
    { admitted:false, classification:'unclosed-upper-boundary',
      reason:'accepted step has no evaluated larger boundary trial' },
  );
  assert.equal(
    restoration.adjudicateNBodyAdaptiveStepBoundary({
      ...constrained,
      trialReceipts:constrained.trialReceipts.map(row => row.radius === 0.5
        ? { ...row, admissible:true, rejectionReason:'higher-ranked-admissible-candidate',
          regressedFamilies:[] }
        : row),
    }).admitted,
    false,
    'an admissible upper neighbor cannot masquerade as a constrained boundary',
  );
  assert.equal(
    restoration.adjudicateNBodyAdaptiveStepBoundary({
      ...constrained,
      trialReceipts:constrained.trialReceipts.map(row => row.radius === 0.5
        ? { ...row, rejectionReason:'constraint-family-regression', regressedFamilies:[] }
        : row),
    }).admitted,
    false,
    'family-regression rejection requires a named regressed family',
  );
  assert.deepEqual(
    restoration.adjudicateNBodyAdaptiveStepBoundary({
      bracket:{
        boundary:'minimum-radius', lowerTrialRadius:null, selectedRadius:0.125,
        upperTrialRadius:0.25, minimumRadius:0.125, maximumRadius:4,
      },
      trialReceipts:[
        receipt({ radius:0.125, residual:0.45, admissible:true, selected:true }),
        receipt({ radius:0.25, residual:0.48, admissible:false,
          rejectionReason:'insufficient-decrease' }),
      ],
    }),
    { admitted:true, classification:'minimum-radius', reason:null },
  );
});

test('adaptive raw-first trajectory admission binds route and writes failure before primary output', async () => {
  const raw = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/raw-trajectory.json',
    'utf8',
  ));
  const validation = validateNBodyAdaptiveTrajectoryRaw({ raw });
  assert.equal(validation.boundaryClassifications.length, 8);
  assert.equal(validation.boundaryClassifications.filter(
    row => row.classification === 'constrained-admissibility-boundary',
  ).length, 7);
  assert.equal(validation.boundaryClassifications.filter(
    row => row.classification === 'interior-bracket',
  ).length, 1);

  const substituted = structuredClone(raw);
  substituted.result.route.effective = 'substituted-fallback-route';
  const core = structuredClone(substituted.result);
  delete core.identity;
  substituted.result.identity.sha256 = hashMusclePackingCanonicalJson(core);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-admission-'));
  const rawPath = path.join(temporaryRoot, 'substituted.json');
  const outDir = path.join(temporaryRoot, 'out');
  fs.writeFileSync(rawPath, `${JSON.stringify(substituted, null, 2)}\n`);
  await assert.rejects(
    admitNBodyAdaptiveTrajectoryRaw({ rawPath, outDir }),
    /substituted route, source, or config/,
  );
  const failure = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'validate-raw');
  assert.match(failure.lastTrustworthyEvidence.rawFileSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
});

test('adaptive admission rejects canonically rehashed forged direction and trial physics', () => {
  const raw = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/raw-trajectory.json',
    'utf8',
  ));
  const forged = structuredClone(raw);
  const row = forged.result.work.rows.find(candidate =>
    candidate.bracket.boundary === 'admissibility-boundary');
  const rejected = row.trialReceipts.find(trial =>
    trial.radius === row.bracket.upperTrialRadius);
  row.directionConstruction.direction[0] = 0.123;
  row.directionConstruction.predictedDirectionalDerivatives.pairwisePenetration = -0.456;
  rejected.vector = rejected.vector.map(() => 0);
  const core = structuredClone(forged.result);
  delete core.identity;
  forged.result.identity.sha256 = hashMusclePackingCanonicalJson(core);

  assert.throws(
    () => validateNBodyAdaptiveTrajectoryRaw({ raw:forged }),
    /reconstructed adaptive trajectory authority|recomputed adaptive step|direction|trial physics|step identity/,
  );
});

test('adaptive admission rejects a step-locally valid alternate continuation schedule and authority substitution', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  const raw = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/raw-trajectory.json',
    'utf8',
  ));
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const canonicalConfig = restoration.createNBodyFamilyGradientAdaptiveTrajectoryConfig({
    iterationBudget:8,
  });
  const alternateConfig = {
    ...canonicalConfig,
    initialRadius:canonicalConfig.initialRadius / 2,
  };
  const alternate = restoration.solveNBodyFamilyGradientAdaptiveTrajectory({
    problem,
    startVector:raw.result.start.vector,
    requestedConfig:alternateConfig,
  });
  assert.equal(alternate.work.rows.length, 8);
  assert.notEqual(
    alternate.work.rows[0].requestedInitialRadius,
    canonicalConfig.initialRadius,
  );

  const forged = structuredClone(raw);
  forged.result = structuredClone(alternate);
  forged.result.config.requested = structuredClone(canonicalConfig);
  forged.result.config.effective = structuredClone(canonicalConfig);
  forged.result.mechanism.directionBasis = 'forged-trajectory-authority-basis';
  forged.result.claimCeiling = 'forged-anatomical-production-closure';
  const core = structuredClone(forged.result);
  delete core.identity;
  forged.result.identity.sha256 = hashMusclePackingCanonicalJson(core);

  assert.throws(
    () => validateNBodyAdaptiveTrajectoryRaw({ raw:forged }),
    /continuation schedule|trajectory authority|reconstructed adaptive trajectory/,
  );
});

test('adaptive admission rejects canonically rehashed mechanism and claim-ceiling substitutions independently', () => {
  const raw = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/raw-trajectory.json',
    'utf8',
  ));
  const rehash = forged => {
    const core = structuredClone(forged.result);
    delete core.identity;
    forged.result.identity.sha256 = hashMusclePackingCanonicalJson(core);
    return forged;
  };

  const mechanismForgery = structuredClone(raw);
  mechanismForgery.result.mechanism = {
    ...mechanismForgery.result.mechanism,
    directionBasis:'forged-but-canonically-rehashed-direction-basis',
    stepControl:'forged-but-canonically-rehashed-step-control',
    nonlinearAcceptance:'forged-but-canonically-rehashed-nonlinear-acceptance',
    carrierDegreesOfFreedomPerMember:999,
  };
  assert.throws(
    () => validateNBodyAdaptiveTrajectoryRaw({ raw:rehash(mechanismForgery) }),
    /reconstructed adaptive trajectory authority/,
  );

  const claimForgery = structuredClone(raw);
  claimForgery.result.claimCeiling = 'forged-anatomical-production-and-final-admission-proof';
  assert.throws(
    () => validateNBodyAdaptiveTrajectoryRaw({ raw:rehash(claimForgery) }),
    /reconstructed adaptive trajectory authority/,
  );
});

test('adaptive admission invalidates stale success primaries before a failed rerun', async () => {
  const raw = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/raw-trajectory.json',
    'utf8',
  ));
  const invalid = structuredClone(raw);
  invalid.result.route.effective = 'forged-rerun-route';
  const core = structuredClone(invalid.result);
  delete core.identity;
  invalid.result.identity.sha256 = hashMusclePackingCanonicalJson(core);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-stale-rerun-'));
  const rawPath = path.join(temporaryRoot, 'invalid.json');
  const outDir = path.join(temporaryRoot, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(rawPath, `${JSON.stringify(invalid, null, 2)}\n`);
  for (const name of ['raw-trajectory.json', 'result.json']) {
    fs.writeFileSync(path.join(outDir, name), '{"status":"stale-success"}\n');
  }
  await assert.rejects(
    admitNBodyAdaptiveTrajectoryRaw({ rawPath, outDir }),
    /substituted route, source, or config/,
  );
  assert.equal(fs.existsSync(path.join(outDir, 'raw-trajectory.json')), false);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8')).status,
    'failed',
  );
});

test('adaptive admission removes a partially published generation after injected rename failure', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-partial-publish-'));
  const rawPath =
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/raw-trajectory.json';
  const outDir = path.join(temporaryRoot, 'out');
  const io = {
    writeFile:fs.promises.writeFile,
    rename:async (from, to) => {
      if (to === path.join(outDir, 'result.json')) {
        throw new Error('injected adaptive result promotion failure');
      }
      return fs.promises.rename(from, to);
    },
  };
  await assert.rejects(
    admitNBodyAdaptiveTrajectoryRaw({ rawPath, outDir, io }),
    /injected adaptive result promotion failure/,
  );
  assert.equal(fs.existsSync(path.join(outDir, 'raw-trajectory.json')), false);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
  const failure = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'write-primary');
});

test('adaptive common-descent step brackets below the fixed-radius saturation without family regression', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  assert.equal(
    typeof restoration.createNBodyFamilyGradientAdaptiveStepConfig,
    'function',
    'adaptive common-descent step config is not implemented',
  );
  assert.equal(
    typeof restoration.solveNBodyFamilyGradientAdaptiveStep,
    'function',
    'adaptive common-descent step solver is not implemented',
  );
  const trajectory = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-common-descent-trajectory-v0/result.json',
    'utf8',
  ));
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const start = trajectory.work.rows[2].before;
  const fixedSelected = trajectory.work.rows[2].after;
  const requestedConfig = restoration.createNBodyFamilyGradientAdaptiveStepConfig({
    initialRadius:0.0000625,
    minimumRadius:1e-10,
    maximumTrials:24,
  });
  const canonical = restoration.solveNBodyFamilyGradientAdaptiveStep({
    problem,
    startVector:start.vector,
    requestedConfig,
  });

  assert.equal(canonical.status, 'adaptive-common-descent-step-accepted');
  assert.equal(canonical.route.fallbackUsed, false);
  assert.ok(canonical.work.trialReceipts.length > 0);
  assert.ok(canonical.work.trialReceipts.length <= requestedConfig.maximumTrials);
  assert.equal(canonical.work.trialReceipts.filter(row => row.selected).length, 1);
  assert.ok(canonical.selected.maximumPhysicalResidual < fixedSelected.maximumPhysicalResidual);
  assert.ok(canonical.work.bracket.upperTrialRadius > canonical.work.bracket.selectedRadius);
  assert.ok(canonical.work.bracket.lowerTrialRadius < canonical.work.bracket.selectedRadius);
  assert.equal(canonical.work.bracket.boundary, 'interior-bracket');
  assert.equal(canonical.work.bracket.maximumRadius, requestedConfig.maximumRadius);
  assert.ok(canonical.work.bracket.refinementIterations > 0);
  assert.ok(canonical.work.bracket.selectedRadius >= requestedConfig.minimumRadius);
  assert.equal(
    canonical.config.effective.candidateEnumeration,
    'canonical',
    'candidateEnumeration is receipt ordering, not an execution-order invariance witness',
  );
  assert.equal(canonical.selected.metrics.endpointDrift, 0);
  assert.equal(canonical.selected.metrics.maximumRelativeVolumeError, 0);
  for (const family of [
    'pairwisePenetration',
    'skeletalPenetration',
    'compartmentEscape',
  ]) {
    assert.ok(
      canonical.selected.metrics[family] <=
        start.metrics[family] + requestedConfig.familyRegressionTolerance,
      `${family} regressed under adaptive step control`,
    );
  }
  assert.ok(canonical.work.trialReceipts.every(row =>
    typeof row.actualDecrease === 'number' &&
    typeof row.requiredDecrease === 'number' &&
    Array.isArray(row.regressedFamilies) &&
    (typeof row.rejectionReason === 'string' || row.selected)
  ));
  assert.equal(canonical.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(canonical.mechanism.contactGraphRowsConsumed, false);
});

test('adaptive common-descent trajectory beats the fixed-grid trajectory with radius continuation receipts', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  assert.equal(
    typeof restoration.createNBodyFamilyGradientAdaptiveTrajectoryConfig,
    'function',
    'adaptive common-descent trajectory config is not implemented',
  );
  assert.equal(
    typeof restoration.solveNBodyFamilyGradientAdaptiveTrajectory,
    'function',
    'adaptive common-descent trajectory solver is not implemented',
  );
  const fixed = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-common-descent-trajectory-v0/result.json',
    'utf8',
  ));
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const requestedConfig = restoration.createNBodyFamilyGradientAdaptiveTrajectoryConfig({
    iterationBudget:8,
  });
  const result = restoration.solveNBodyFamilyGradientAdaptiveTrajectory({
    problem,
    startVector:fixed.start.vector,
    requestedConfig,
  });

  assert.equal(result.route.fallbackUsed, false);
  assert.equal(result.status, 'adaptive-common-descent-trajectory-budget-exhausted');
  assert.equal(result.work.iterations, 8);
  assert.equal(result.work.rows.length, 8);
  assert.ok(result.work.rows.every(row => row.accepted));
  assert.ok(result.selected.maximumPhysicalResidual < fixed.selected.maximumPhysicalResidual);
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.equal(result.selected.metrics.maximumRelativeVolumeError, 0);
  assert.equal(result.work.rows[0].requestedInitialRadius, requestedConfig.initialRadius);
  for (const [index, row] of result.work.rows.entries()) {
    assert.match(row.stepResultSha256, /^[a-f0-9]{64}$/);
    assert.ok(row.bracket.selectedRadius > 0);
    assert.ok(row.bracket.lowerTrialRadius < row.bracket.selectedRadius);
    assert.equal(row.bracket.maximumRadius, requestedConfig.maximumRadius);
    assert.ok(row.trialReceipts.length > 0);
    assert.equal(row.trialReceipts.filter(trial => trial.selected).length, 1);
    assert.deepEqual(
      restoration.adjudicateNBodyAdaptiveStepBoundary(row),
      {
        admitted:true,
        classification:row.bracket.boundary === 'admissibility-boundary'
          ? 'constrained-admissibility-boundary'
          : row.bracket.boundary,
        reason:null,
      },
    );
    assert.ok(row.after.maximumPhysicalResidual < row.before.maximumPhysicalResidual);
    for (const family of [
      'pairwisePenetration',
      'skeletalPenetration',
      'compartmentEscape',
    ]) assert.ok(
      row.after.metrics[family] <=
        row.before.metrics[family] + requestedConfig.familyRegressionTolerance,
      `${family} regressed at adaptive trajectory iteration ${index + 1}`,
    );
    if (index > 0) {
      assert.equal(
        row.requestedInitialRadius,
        Math.min(
          requestedConfig.maximumRadius,
          result.work.rows[index - 1].bracket.selectedRadius *
            requestedConfig.radiusContinuationExpansion,
        ),
      );
    }
  }
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, false);
});

test('refined common-descent trajectory artifact preserves the disproved floor receipt', () => {
  const result = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-common-descent-trajectory-v0/result.json',
    'utf8',
  ));
  const report = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-common-descent-trajectory-v0/run-report.json',
    'utf8',
  ));
  const core = structuredClone(result);
  delete core.identity;

  assert.equal(result.identity.sha256, hashMusclePackingCanonicalJson(core));
  assert.equal(result.status, 'common-descent-trajectory-budget-exhausted');
  assert.equal(result.work.iterations, 8);
  assert.equal(result.work.attempts, 8);
  assert.deepEqual(
    result.work.rows.map(row =>
      row.candidateReceipts.find(candidate => candidate.selected)?.radius || null
    ),
    [0.00025, 0.0000625, ...Array(6).fill(0.0000078125)],
  );
  assert.ok(result.work.rows.every(row => row.accepted));
  assert.ok(result.work.rows.every(row =>
    row.candidateReceipts.find(candidate => candidate.selected)?.regressedFamilies.length === 0
  ));
  assert.equal(result.selected.maximumPhysicalResidual, 0.004722809214);
  assert.equal(result.selected.metrics.pairwisePenetration, 0.001499698406);
  assert.equal(result.selected.metrics.skeletalPenetration, 0.001517952708);
  assert.equal(result.selected.metrics.compartmentEscape, 0.004722809214);
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.equal(result.selected.metrics.maximumRelativeVolumeError, 0);
  assert.equal(report.status, 'complete-refined-trajectory-budget-exhausted');
  assert.equal(report.bindings.resultSha256, result.identity.sha256);
  assert.equal(report.probe.acceptedIterations, 8);
  assert.equal(report.probe.terminalReason, null);
});

test('common-descent trajectory assay rejects a rehashed admitted-step substitution', async () => {
  const assay = await import('../nbody-packing-restoration-assay.mjs');
  assert.equal(
    typeof assay.runNBodyPackingCommonDescentTrajectoryAssay,
    'function',
    'source-bound common-descent trajectory assay is not implemented',
  );
  const sourceRoot = path.resolve(
    'artifacts/nbody-packing-family-gradient-common-descent-v0',
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-common-trajectory-pin-'));
  const source = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'result.json'), 'utf8'));
  source.start.vector[0] += 0.000001;
  delete source.identity;
  source.identity = { sha256:hashMusclePackingCanonicalJson(source) };
  const substitutedPath = path.join(outDir, 'substituted-common-step.json');
  fs.writeFileSync(substitutedPath, `${JSON.stringify(source, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'result.json'), '{"status":"stale-success"}\n');

  await assert.rejects(
    assay.runNBodyPackingCommonDescentTrajectoryAssay({
      outDir,
      commonDescentResultPath:substitutedPath,
      commonDescentReportPath:path.join(sourceRoot, 'run-report.json'),
    }),
    /substituted admitted common-descent step/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.failurePhase, 'bind-admitted-common-descent-source');
  assert.equal(report.route.effective, null);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
});

test('restoration assay preserves an invalid requested acceptance policy in failure evidence', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-restoration-policy-failure-'));
  await assert.rejects(
    runNBodyPackingRestorationAssay({
      outDir,
      acceptancePolicy:'family-pareto-no-resurrection-typo',
    }),
    /acceptancePolicy is unsupported/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(
    report.route.requested,
    'unsupported-acceptance-policy:family-pareto-no-resurrection-typo',
  );
  assert.equal(report.route.effective, null);
  assert.equal(report.failurePhase, 'solve-all-neighbor-restoration');
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
});

test('restoration assay rejects a canonical homotopy result from another problem', async () => {
  const sourceRoot = path.resolve('artifacts/nbody-packing-localized-challenge-v0');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-restoration-substitute-'));
  const homotopy = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, 'homotopy-032-fine-0875-to-1.json'),
    'utf8',
  ));
  homotopy.source.problemSha256 = 'f'.repeat(64);
  homotopy.source.fixtureSha256 = 'e'.repeat(64);
  delete homotopy.identity;
  homotopy.identity = { sha256:hashMusclePackingCanonicalJson(homotopy) };
  const substitutedPath = path.join(outDir, 'substituted-homotopy.json');
  fs.writeFileSync(substitutedPath, `${JSON.stringify(homotopy, null, 2)}\n`);

  await assert.rejects(
    runNBodyPackingRestorationAssay({
      outDir,
      patternResultPath:path.join(sourceRoot, 'oracle-pattern-search-032.json'),
      homotopyResultPath:substitutedPath,
    }),
    /substituted homotopy floor/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'bind-problem-and-baselines');
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
});

test('source-bound family-filter assay preserves the exact zero-step plateau', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-family-filter-assay-'));
  const { result, report } = await runNBodyPackingRestorationAssay({
    outDir,
    iterationBudget:6,
    acceptancePolicy:'family-pareto-no-resurrection',
  });
  assert.equal(report.status, 'complete-family-filter-floor-exposed');
  assert.equal(report.route.requested, 'all-neighbor-p8-family-filter-restoration-v0');
  assert.equal(report.route.effective, 'all-neighbor-p8-family-filter-restoration-v0');
  assert.equal(report.route.fallbackUsed, false);
  assert.equal(result.status, 'stalled-family-filter-restoration');
  assert.equal(result.work.iterations, 0);
  assert.equal(result.work.attempts, 1);
  assert.equal(result.work.rows[0].candidateReceipts.length, 7);
  assert.deepEqual(result.selected.vector, result.start.vector);
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  assert.deepEqual(result.invariance.rows[0].work, result.invariance.rows[1].work);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'run-report.json')), true);
});

test('active-row trust-region either advances all binding families or certifies the exact local floor', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  assert.equal(
    typeof restoration.createNBodyActiveRowTrustRegionConfig,
    'function',
    'active-row trust-region config is not implemented',
  );
  assert.equal(
    typeof restoration.solveNBodyActiveRowTrustRegionStep,
    'function',
    'active-row trust-region step is not implemented',
  );

  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const adaptive = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/result.json',
    'utf8',
  ));
  const requestedConfig = restoration.createNBodyActiveRowTrustRegionConfig();
  const result = restoration.solveNBodyActiveRowTrustRegionStep({
    problem,
    startVector:adaptive.selected.vector,
    requestedConfig,
  });

  assert.equal(result.route.fallbackUsed, false);
  assert.equal(result.status, 'local-active-row-cone-certificate');
  assert.equal(result.directionConstruction.predictedCommonDescent, false);
  assert.equal(result.directionConstruction.activeRows.length, 12);
  assert.equal(result.source.problemSha256, problem.identity.sha256);
  assert.deepEqual(result.config.requested, requestedConfig);
  assert.deepEqual(result.config.effective, requestedConfig);
  assert.match(result.identity.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    result.identity.sha256,
    hashMusclePackingCanonicalJson(Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== 'identity'),
    )),
  );

  const activeRows = result.directionConstruction.activeRows;
  assert.ok(activeRows.length > 0);
  assert.ok(activeRows.every(row => row.signedGap <= requestedConfig.activationMargin));
  assert.deepEqual(
    [...new Set(activeRows.map(row => row.kind))].sort(),
    ['compartment-clearance', 'pairwise-clearance', 'skeletal-clearance'],
  );
  assert.ok(activeRows.every(row => row.gradient.length === problem.variables.length));
  assert.equal(
    result.directionConstruction.convexWeights.length,
    activeRows.length,
  );
  assert.ok(
    Math.abs(result.directionConstruction.convexWeights.reduce(
      (sum, value) => sum + value,
      0,
    ) - 1) <= 1e-10,
  );
  assert.ok(result.directionConstruction.convexWeights.every(value => value >= 0));
  assert.ok(
    result.directionConstruction.optimizer.dualityGap <=
      requestedConfig.convexSolverTolerance,
  );

  if (result.status === 'active-row-trust-region-step-accepted') {
    assert.ok(
      result.selected.maximumActiveRowViolation <
        result.start.maximumActiveRowViolation - requestedConfig.improvementTolerance,
    );
    for (const family of [
      'pairwisePenetration',
      'skeletalPenetration',
      'compartmentEscape',
    ]) {
      assert.ok(
        result.selected.metrics[family] <=
          result.start.metrics[family] + requestedConfig.familyRegressionTolerance,
        `${family} regressed under the active-row step`,
      );
    }
    assert.equal(result.certificate, null);
    assert.equal(result.work.iterations, 1);
  } else {
    assert.ok([
      'local-active-row-cone-certificate',
      'nonlinear-active-row-trust-region-floor',
    ].includes(result.status));
    assert.deepEqual(result.selected.vector, result.start.vector);
    assert.equal(result.work.iterations, 0);
    assert.ok(result.certificate);
    assert.deepEqual(
      result.certificate.activeConstraintKeys,
      activeRows.map(row => row.key),
    );
    assert.equal(
      result.certificate.carrierDegreesOfFreedomPerMember,
      problem.carrier.degreesOfFreedomPerMember,
    );
    if (result.status === 'local-active-row-cone-certificate') {
      assert.equal(result.directionConstruction.predictedCommonDescent, false);
      assert.equal(result.certificate.kind, 'linearized-active-row-cone-floor');
    } else {
      assert.equal(result.directionConstruction.predictedCommonDescent, true);
      assert.equal(result.certificate.kind, 'nonlinear-active-row-radius-floor');
      assert.equal(
        result.work.candidateReceipts.length,
        requestedConfig.trustRegionRadii.length,
      );
    }
  }
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.equal(result.selected.metrics.maximumRelativeVolumeError, 0);
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, true);
  assert.equal(
    result.claimCeiling,
    'bounded-severity-0.32-active-row-step-or-local-floor-certificate-not-global-feasibility-or-carrier-impossibility',
  );
});

test('family-maximum active bands do not let shallow satisfied-neighbor pressure manufacture a cone floor', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const adaptive = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/result.json',
    'utf8',
  ));
  const requestedConfig = restoration.createNBodyActiveRowTrustRegionConfig({
    activeSetPolicy:'family-maximum-relative-band',
    relativeActivationBand:0.01,
  });
  assert.equal(requestedConfig.activeSetPolicy, 'family-maximum-relative-band');
  assert.equal(requestedConfig.relativeActivationBand, 0.01);

  const result = restoration.solveNBodyActiveRowTrustRegionStep({
    problem,
    startVector:adaptive.selected.vector,
    requestedConfig,
  });
  const reverse = restoration.solveNBodyActiveRowTrustRegionStep({
    problem,
    startVector:adaptive.selected.vector,
    requestedConfig:{ ...requestedConfig, candidateEnumeration:'reverse' },
  });
  assert.equal(result.status, 'active-row-trust-region-step-accepted');
  assert.equal(result.directionConstruction.predictedCommonDescent, true);
  assert.equal(result.directionConstruction.activeSetPolicy, 'family-maximum-relative-band');
  assert.ok(result.directionConstruction.activeRows.length < 12);
  assert.deepEqual(
    [...new Set(result.directionConstruction.activeRows.map(row => row.kind))].sort(),
    ['compartment-clearance', 'pairwise-clearance', 'skeletal-clearance'],
  );
  for (const row of result.directionConstruction.activeRows) {
    const familyMaximum = result.start.rowFamilyMaxima[row.kind];
    assert.ok(
      row.violation >= familyMaximum * (1 - requestedConfig.relativeActivationBand) - 1e-12,
      `${row.key} is outside its requested family-maximum band`,
    );
  }
  assert.ok(
    result.selected.maximumActiveRowViolation < result.start.maximumActiveRowViolation,
  );
  for (const family of [
    'pairwisePenetration',
    'skeletalPenetration',
    'compartmentEscape',
  ]) {
    assert.ok(
      result.selected.metrics[family] <=
        result.start.metrics[family] + requestedConfig.familyRegressionTolerance,
    );
  }
  assert.equal(result.certificate, null);
  assert.deepEqual(reverse.selected, result.selected);
  assert.deepEqual(reverse.directionConstruction.activeRows, result.directionConstruction.activeRows);
  assert.deepEqual(
    reverse.directionConstruction.predictedDirectionalDerivatives,
    result.directionConstruction.predictedDirectionalDerivatives,
  );
  assert.deepEqual(reverse.work.candidateReceipts, result.work.candidateReceipts);
});

test('repeated family-maximum active-set steps preserve global family custody until progress or certificate', async () => {
  const restoration = await import('../nbody-packing-restoration.mjs');
  assert.equal(
    typeof restoration.createNBodyActiveRowTrustRegionTrajectoryConfig,
    'function',
    'active-row trust-region trajectory config is not implemented',
  );
  assert.equal(
    typeof restoration.solveNBodyActiveRowTrustRegionTrajectory,
    'function',
    'active-row trust-region trajectory is not implemented',
  );
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  const adaptive = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/result.json',
    'utf8',
  ));
  const requestedConfig = restoration.createNBodyActiveRowTrustRegionTrajectoryConfig({
    iterationBudget:8,
  });
  const result = restoration.solveNBodyActiveRowTrustRegionTrajectory({
    problem,
    startVector:adaptive.selected.vector,
    requestedConfig,
  });

  assert.ok([
    'active-row-trust-region-trajectory-budget-exhausted',
    'active-row-trust-region-trajectory-feasible',
    'active-row-trust-region-trajectory-local-floor',
  ].includes(result.status));
  assert.equal(result.route.fallbackUsed, false);
  assert.equal(result.work.rows.length, result.work.attempts);
  assert.ok(result.work.iterations >= 2);
  assert.ok(result.work.iterations <= requestedConfig.iterationBudget);
  assert.ok(result.work.attempts <= requestedConfig.iterationBudget);
  assert.equal(
    result.selected.maximumPhysicalResidual,
    result.work.rows.filter(row => row.accepted).at(-1).after.maximumPhysicalResidual,
  );
  for (const row of result.work.rows) {
    assert.match(row.stepResultSha256, /^[a-f0-9]{64}$/);
    assert.equal(row.directionConstruction.activeSetPolicy, 'family-maximum-relative-band');
    if (!row.accepted) {
      assert.ok(row.certificate);
      assert.deepEqual(row.after, row.before);
      continue;
    }
    assert.equal(row.certificate, null);
    assert.ok(row.after.maximumPhysicalResidual < row.before.maximumPhysicalResidual);
    assert.ok(row.after.maximumActiveRowViolation < row.before.maximumActiveRowViolation);
    for (const family of [
      'pairwisePenetration',
      'skeletalPenetration',
      'compartmentEscape',
    ]) {
      assert.ok(
        row.after.metrics[family] <=
          row.before.metrics[family] + requestedConfig.step.familyRegressionTolerance,
        `${family} regressed at active-set iteration ${row.iteration}`,
      );
    }
  }
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.equal(result.selected.metrics.maximumRelativeVolumeError, 0);
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, true);
  assert.equal(
    result.claimCeiling,
    'bounded-severity-0.32-repeated-family-maximum-active-row-progress-or-local-floor-not-global-feasibility-or-carrier-impossibility',
  );
  assert.equal(
    result.identity.sha256,
    hashMusclePackingCanonicalJson(Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== 'identity'),
    )),
  );
});

test('active-row trajectory assay invalidates stale success before rejecting a substituted adaptive source', async () => {
  const assay = await import('../nbody-packing-restoration-assay.mjs');
  assert.equal(
    typeof assay.runNBodyPackingActiveRowTrajectoryAssay,
    'function',
    'active-row trajectory assay is not implemented',
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbody-active-row-assay-source-'));
  const sourceRoot = path.resolve(
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0',
  );
  const sourceResult = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'result.json'), 'utf8'));
  sourceResult.selected.vector[0] += 0.000001;
  delete sourceResult.identity;
  sourceResult.identity = { sha256:hashMusclePackingCanonicalJson(sourceResult) };
  const substitutedPath = path.join(outDir, 'substituted-adaptive-result.json');
  fs.writeFileSync(substitutedPath, `${JSON.stringify(sourceResult, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'result.json'), '{"status":"stale-success"}\n');
  fs.writeFileSync(path.join(outDir, 'raw-trajectory.json'), '{"status":"stale-raw"}\n');

  await assert.rejects(
    assay.runNBodyPackingActiveRowTrajectoryAssay({
      outDir,
      adaptiveResultPath:substitutedPath,
      adaptiveReportPath:path.join(sourceRoot, 'run-report.json'),
    }),
    /substituted authenticated adaptive trajectory/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'bind-authenticated-adaptive-source');
  assert.equal(report.route.effective, null);
  assert.equal(fs.existsSync(path.join(outDir, 'result.json')), false);
  assert.equal(fs.existsSync(path.join(outDir, 'raw-trajectory.json')), false);
});
