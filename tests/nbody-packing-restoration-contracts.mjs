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
