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
  solveNBodyAllNeighborRestoration,
} from '../nbody-packing-restoration.mjs';
import {
  runNBodyPackingRestorationAssay,
} from '../nbody-packing-restoration-assay.mjs';

const COORDINATE_SEARCH_FLOOR = 0.001615326586;
const HOMOTOPY_FLOOR = 0.000945973079;
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

test('all-neighbor restoration beats the frozen severity-0.32 coordinate-search floor', () => {
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

  assert.equal(current.maximumPhysicalResidual, COORDINATE_SEARCH_FLOOR);
  assert.ok(
    result.selected.maximumPhysicalResidual < HOMOTOPY_FLOOR,
    `restoration route has not beaten the frozen homotopy floor: ${result.selected.maximumPhysicalResidual}`,
  );
  assert.equal(result.selected.maximumPhysicalResidual, 0.000867525141);
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
  assert.deepEqual(result.work.rows[0].violatedKinds, [
    'compartment-clearance',
    'pairwise-clearance',
    'skeletal-clearance',
  ]);
  assert.equal(result.selected.metrics.endpointDrift, 0);
  assert.ok(result.selected.metrics.maximumRelativeVolumeError <= 1e-9);
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
