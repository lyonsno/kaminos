import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
  NBODY_PACKING_LOCALIZED_WITNESS_ROUTE,
  NBODY_PACKING_COMMON_DESCENT_WITNESS_ROUTE,
  NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE,
  admitNBodyPackingLocalizedVisualInspection,
  renderNBodyPackingLocalizedChallengeHtml,
  validateNBodyPackingLocalizedCaptureBinding,
} from '../nbody-packing-localized-witness.mjs';
import {
  captureNBodyPackingLocalizedState,
} from '../nbody-packing-localized-capture.mjs';
import {
  createPairDebtEmphasisMarkers,
  writeNBodyPackingLocalizedHardBoundaryWitness,
} from '../nbody-packing-localized-hard-witness.mjs';
import { hashMusclePackingCanonicalJson } from '../muscle-compartment-packing-core.mjs';

test('localized witness names the complete last-pass first-fail comparison without inversion', () => {
  const states = Object.fromEntries([
    ['pass-crowded', '0.20 crowded input'],
    ['last-pass', '0.20 last pass'],
    ['fail-crowded', '0.24 crowded input'],
    ['first-fail', '0.24 first fail'],
    ['same-basis-feasible', '0.24 same-basis feasible'],
    ['reference', 'Manufactured reference'],
  ].map(([key, label]) => [key, { label }]));
  const html = renderNBodyPackingLocalizedChallengeHtml({
    payload:{ states, environment:{ compartment:{ minimum:[-1,-1,-1], maximum:[1,1,1] }, obstacles:[] } },
    bindings:{ fixturesSha256:'a'.repeat(64), resultsSha256:'b'.repeat(64) },
  });
  assert.equal(NBODY_PACKING_LOCALIZED_WITNESS_ROUTE, 'nbody-packing-localized-boundary-v0');
  for (const label of [
    '0.20 crowded input',
    '0.20 last pass',
    '0.24 crowded input',
    '0.24 first fail',
    '0.24 same-basis feasible',
    'Manufactured reference',
  ]) assert.match(html, new RegExp(label.replace('.', '\\.')));
  assert.match(html, /globalization failure/i);
  assert.match(html, /not a representation failure/i);
  assert.match(html, /data-fixtures-sha256="a{64}"/);
  assert.match(html, /data-results-sha256="b{64}"/);
});

test('localized renderer can expose the gross hard boundary with truthful dynamic labels', () => {
  const states = Object.fromEntries([
    ['pass-crowded', '0.32 crowded input'],
    ['last-pass', '0.28 last pass'],
    ['fail-crowded', '0.32 cold failure'],
    ['first-fail', '0.32 warm-start stall'],
    ['same-basis-feasible', '0.32 coordinate-search floor'],
    ['reference', 'Manufactured feasibility witness'],
  ].map(([key, label]) => [key, { label }]));
  const html = renderNBodyPackingLocalizedChallengeHtml({
    payload:{
      states,
      environment:{ compartment:{ minimum:[-1,-1,-1], maximum:[1,1,1] }, obstacles:[] },
      display: {
        title:'Localized hard boundary · six bodies',
        authority:'Synthetic mechanism falsifier · no anatomical admission',
        explanation:'The cold failure is gross; continuation and coordinate search reduce debt but do not establish same-basis feasibility.',
        orderedStates:Object.keys(states),
        defaultState:'fail-crowded',
      },
    },
    bindings:{ fixturesSha256:'a'.repeat(64), resultsSha256:'b'.repeat(64) },
    route:NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
  });
  assert.equal(NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
    'nbody-packing-localized-hard-boundary-v0');
  for (const state of Object.values(states)) assert.match(html, new RegExp(state.label));
  assert.match(html, /cold failure is gross/i);
  assert.match(html, /data-witness-route="nbody-packing-localized-hard-boundary-v0"/);
  assert.match(html, /const debtTolerance=1e-7/);
  assert.match(html, /pen>debtTolerance/);
  assert.match(html, /distanceTo\(q\)<[^;]+-debtTolerance/);
  assert.doesNotMatch(html, /0\.24 same-basis feasible/);
});

test('superseded pre-repair witness cannot present itself as current inspected evidence', () => {
  const artifactRoot = new URL('../artifacts/nbody-packing-localized-challenge-v0/', import.meta.url);
  const report = JSON.parse(fs.readFileSync(
    new URL('report.json', artifactRoot),
    'utf8',
  ));
  const html = fs.readFileSync(new URL('index.html', artifactRoot), 'utf8');
  assert.equal(report.status, 'superseded-by-localized-hard-boundary-v0');
  assert.match(html, /superseded/i);
  assert.match(html, /nbody-packing-localized-hard-boundary-v0/);
  assert.doesNotMatch(html, /data-witness-loaded="true"/);
});

test('hard-boundary visual admission accepts its stricter route-specific verdict and binds receipts', async () => {
  const source = new URL('../artifacts/nbody-packing-localized-hard-boundary-v0/', import.meta.url);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-hard-admission-'));
  fs.cpSync(source, outDir, { recursive:true });
  const reportPath = path.join(outDir, 'report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  report.status = 'complete-pending-agent-visual-inspection';
  delete report.visualInspection;
  delete report.identity;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const inspection = {
    observedAt:'2026-08-11T00:00:00.000Z',
    summary:'All six causal states inspected in transparent volume and opaque slices.',
    verdict:{
      nonblank:true,
      orbitable:true,
      sameCameraComparison:true,
      crowdedDebtLegible:true,
      lastPassClearanceLegible:true,
      coldFailureGrosslyWrong:true,
      warmStartResidualLegible:true,
      coordinateFloorResidualLegible:true,
      manufacturedWitnessAuthorityCeilingLegible:true,
      stableIdentityLegible:true,
      fixedAttachmentsLegible:true,
      individualVolumeLegible:true,
      packingSemanticsNotInverted:true,
    },
  };
  const admitted = await admitNBodyPackingLocalizedVisualInspection({ outDir, inspection });
  assert.equal(admitted.report.status, 'complete-agent-visual-inspected');
  assert.equal(admitted.report.visualInspection.captureCount, 12);
  assert.equal(admitted.receipt.verdict.coldFailureGrosslyWrong, true);
  assert.equal(admitted.receipt.verdict.manufacturedWitnessAuthorityCeilingLegible, true);
});

test('localized capture refuses unknown state and viewport substitution before browser launch', async () => {
  await assert.rejects(
    captureNBodyPackingLocalizedState({
      baseUrl:'http://127.0.0.1:18765/example', state:'packed', mode:'volume',
      outputPath:'/tmp/should-not-exist.png', reportPath:'/tmp/should-not-exist.json',
    }),
    /localized capture state is unsupported/,
  );
  await assert.rejects(
    captureNBodyPackingLocalizedState({
      baseUrl:'http://127.0.0.1:18765/example', state:'first-fail', mode:'volume',
      outputPath:'/tmp/should-not-exist.png', reportPath:'/tmp/should-not-exist.json',
      viewport:{ width:800, height:600 },
    }),
    /localized evidence viewport must be exactly 1400x900/,
  );
});

test('localized capture binding rejects a stale primary behind a plausible route and state', () => {
  const report = { bindings:{ fixturesSha256:'fixtures', resultsSha256:'results', indexHtmlSha256:'index' } };
  const captureReport = {
    status:'complete',
    route:{ effective:'independent-headless-screenshot-v0', fallbackUsed:false },
    browser:{ effective:{ kind:'playwright-chromium-headless-shell', installedStableChrome:false } },
    process:{ cleanup:{ status:'complete-no-process-group-remains' }, profileCleanup:{ status:'complete-removed' } },
    domReceipt:{ dataset:{ witnessLoaded:'true', witnessState:'first-fail', witnessMode:'slice', witnessRoute:NBODY_PACKING_LOCALIZED_WITNESS_ROUTE, fixturesSha256:'fixtures', resultsSha256:'results' } },
    sourceDocument:{ status:'complete', sha256:'index' },
    primaryOutput:{ sha256:'png' },
  };
  assert.doesNotThrow(() => validateNBodyPackingLocalizedCaptureBinding({ captureReport, state:'first-fail', mode:'slice', report, pngSha256:'png' }));
  captureReport.sourceDocument.sha256 = 'stale-index';
  assert.throws(
    () => validateNBodyPackingLocalizedCaptureBinding({ captureReport, state:'first-fail', mode:'slice', report, pngSha256:'png' }),
    /localized capture binding rejects stale or substituted evidence/,
  );
});

test('localized capture binding follows the report effective hard-boundary route', () => {
  const report = {
    route:{ effective:NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE },
    bindings:{ fixturesSha256:'fixtures', resultsSha256:'results', indexHtmlSha256:'index' },
  };
  const captureReport = {
    status:'complete',
    route:{ effective:'independent-headless-screenshot-v0', fallbackUsed:false },
    browser:{ effective:{ kind:'playwright-chromium-headless-shell', installedStableChrome:false } },
    process:{ cleanup:{ status:'complete-no-process-group-remains' }, profileCleanup:{ status:'complete-removed' } },
    domReceipt:{ dataset:{ witnessLoaded:'true', witnessState:'fail-crowded', witnessMode:'volume', witnessRoute:NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE, fixturesSha256:'fixtures', resultsSha256:'results' } },
    sourceDocument:{ status:'complete', sha256:'index' },
    primaryOutput:{ sha256:'png' },
  };
  assert.doesNotThrow(() => validateNBodyPackingLocalizedCaptureBinding({
    captureReport, state:'fail-crowded', mode:'volume', report, pngSha256:'png',
  }));
});

test('hard-boundary writer preserves a durable failure report before primary output', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-hard-witness-'));
  await assert.rejects(
    writeNBodyPackingLocalizedHardBoundaryWitness({
      outDir,
      challengeResultPath:path.join(outDir, 'missing-challenge.json'),
      continuationResultPath:path.join(outDir, 'missing-continuation.json'),
      patternResultPath:path.join(outDir, 'missing-pattern.json'),
    }),
    /ENOENT/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.route.requested, NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE);
  assert.equal(report.route.effective, null);
  assert.equal(report.failurePhase, 'read-source-results');
  assert.equal(report.lastTrustworthyEvidence.phase, 'none');
});

test('hard-boundary writer rejects a pattern search from a substituted continuation seed', async () => {
  const artifactRoot = new URL('../artifacts/nbody-packing-localized-hard-boundary-v0/', import.meta.url);
  const comparison = JSON.parse(fs.readFileSync(new URL('comparison.json', artifactRoot), 'utf8'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-hard-seed-binding-'));
  const challengePath = path.join(outDir, 'challenge.json');
  const continuationPath = path.join(outDir, 'continuation.json');
  const patternPath = path.join(outDir, 'pattern.json');
  const substituted = structuredClone(comparison.pattern);
  substituted.seedRows[0].start.vector[0] += 0.001;
  substituted.starts[0].vectorSha256 = hashMusclePackingCanonicalJson(
    substituted.seedRows[0].start.vector,
  );
  delete substituted.identity;
  substituted.identity = { sha256:hashMusclePackingCanonicalJson(substituted) };
  fs.writeFileSync(challengePath, `${JSON.stringify(comparison.challenge, null, 2)}\n`);
  fs.writeFileSync(continuationPath, `${JSON.stringify(comparison.continuation, null, 2)}\n`);
  fs.writeFileSync(patternPath, `${JSON.stringify(substituted, null, 2)}\n`);

  await assert.rejects(
    writeNBodyPackingLocalizedHardBoundaryWitness({
      outDir:path.join(outDir, 'witness'),
      challengeResultPath:challengePath,
      continuationResultPath:continuationPath,
      patternResultPath:patternPath,
    }),
    /pattern-search seed does not bind the continuation result/,
  );
});

test('trajectory witness rejects canonically valid results from the old scalar config contract', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-stale-trajectory-'));
  const current = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-all-neighbor-restoration-trajectory-v0/result.json',
    'utf8',
  ));
  for (const config of [current.config.requested, current.config.effective]) {
    delete config.acceptancePolicy;
    delete config.familyRegressionTolerance;
  }
  delete current.mechanism.acceptancePolicy;
  for (const row of current.work.rows) for (const candidate of row.candidateReceipts) {
    delete candidate.constraintFamilies;
    delete candidate.regressedFamilies;
  }
  for (const row of current.invariance.rows) for (const work of row.work) {
    for (const candidate of work.candidateReceipts) {
      delete candidate.constraintFamilies;
      delete candidate.regressedFamilies;
    }
  }
  delete current.identity;
  current.identity = { sha256:hashMusclePackingCanonicalJson(current) };
  const stalePath = path.join(outDir, 'stale-trajectory.json');
  fs.writeFileSync(stalePath, `${JSON.stringify(current, null, 2)}\n`);
  await assert.rejects(
    writeNBodyPackingLocalizedHardBoundaryWitness({
      outDir,
      restorationResultPath:
        'artifacts/nbody-packing-all-neighbor-restoration-v0/result.json',
      trajectoryResultPath:
        stalePath,
    }),
    /current scalar configuration contract/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.route.requested, NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE);
  assert.equal(report.route.effective, null);
  assert.equal(report.failurePhase, 'bind-source-identities');
  assert.equal(fs.existsSync(path.join(outDir, 'index.html')), false);
});

test('trajectory writer binds final-config one-step and six-step results into eight states', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-current-trajectory-'));
  const { report, states } = await writeNBodyPackingLocalizedHardBoundaryWitness({
    outDir,
    restorationResultPath:
      'artifacts/nbody-packing-all-neighbor-restoration-v0/result.json',
    trajectoryResultPath:
      'artifacts/nbody-packing-all-neighbor-restoration-trajectory-v0/result.json',
  });
  assert.equal(report.route.effective, NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE);
  assert.deepEqual(report.requiredStates, [
    'pass-crowded',
    'last-pass',
    'fail-crowded',
    'first-fail',
    'same-basis-feasible',
    'all-neighbor-restoration',
    'repeated-all-neighbor-restoration',
    'reference',
  ]);
  assert.equal(Object.keys(states).length, 8);
  assert.equal(states['all-neighbor-restoration'].metrics.pairwisePenetration, 0);
  assert.equal(
    states['repeated-all-neighbor-restoration'].metrics.pairwisePenetration,
    0.000259103564,
  );
  assert.match(report.claimCeiling.admittedClaim, /reintroduce pairwise penetration/);
});

test('common-descent writer binds the source-bound result as a ninth comparison state', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-common-descent-'));
  const { report, states } = await writeNBodyPackingLocalizedHardBoundaryWitness({
    outDir,
    restorationResultPath:
      'artifacts/nbody-packing-all-neighbor-restoration-v0/result.json',
    trajectoryResultPath:
      'artifacts/nbody-packing-all-neighbor-restoration-trajectory-v0/result.json',
    commonDescentResultPath:
      'artifacts/nbody-packing-family-gradient-common-descent-v0/result.json',
  });
  assert.equal(report.route.effective,
    'nbody-packing-family-gradient-common-descent-v0');
  assert.equal(report.requiredStates.length, 9);
  assert.equal(Object.keys(states).length, 9);
  assert.equal(states['family-common-descent'].metrics.pairwisePenetration, 0);
  assert.equal(states['family-common-descent'].metrics.skeletalPenetration, 0.000125037313);
  assert.equal(states['family-common-descent'].metrics.compartmentEscape, 0);
  assert.match(report.claimCeiling.admittedClaim, /without trading tracked family debt/);
});

test('common-descent witness rejects a canonically rehashed incomplete route config', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-stale-common-'));
  const current = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-family-gradient-common-descent-v0/result.json',
    'utf8',
  ));
  delete current.config.requested.familyRegressionTolerance;
  delete current.config.effective.familyRegressionTolerance;
  delete current.identity;
  current.identity = { sha256:hashMusclePackingCanonicalJson(current) };
  const stalePath = path.join(outDir, 'stale-common-descent.json');
  fs.writeFileSync(stalePath, `${JSON.stringify(current, null, 2)}\n`);
  await assert.rejects(
    writeNBodyPackingLocalizedHardBoundaryWitness({
      outDir,
      restorationResultPath:
        'artifacts/nbody-packing-all-neighbor-restoration-v0/result.json',
      trajectoryResultPath:
        'artifacts/nbody-packing-all-neighbor-restoration-trajectory-v0/result.json',
      commonDescentResultPath:stalePath,
    }),
    /current common-descent contract/,
  );
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.route.requested, NBODY_PACKING_COMMON_DESCENT_WITNESS_ROUTE);
  assert.equal(report.route.effective, null);
  assert.equal(report.failurePhase, 'bind-source-identities');
  assert.equal(fs.existsSync(path.join(outDir, 'index.html')), false);
});

test('trajectory visual admission requires sixteen route-bound captures', async () => {
  const sourceDir = path.resolve(
    'artifacts/nbody-packing-all-neighbor-restoration-trajectory-v0',
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-trajectory-admission-'));
  const { report } = await writeNBodyPackingLocalizedHardBoundaryWitness({
    outDir,
    restorationResultPath:
      'artifacts/nbody-packing-all-neighbor-restoration-v0/result.json',
    trajectoryResultPath:
      'artifacts/nbody-packing-all-neighbor-restoration-trajectory-v0/result.json',
  });
  for (const state of report.requiredStates) for (const mode of report.requiredModes) {
    const stem = `${state}-${mode}`;
    fs.copyFileSync(path.join(sourceDir, `${stem}.png`), path.join(outDir, `${stem}.png`));
    fs.copyFileSync(
      path.join(sourceDir, `${stem}-capture-report.json`),
      path.join(outDir, `${stem}-capture-report.json`),
    );
  }
  const inspection = {
    observedAt:'2026-08-12T00:00:00.000Z',
    summary:'Eight current-config states inspected in transparent volume and opaque slices.',
    verdict:{
      nonblank:true,
      orbitable:true,
      sameCameraComparison:true,
      crowdedDebtLegible:true,
      lastPassClearanceLegible:true,
      coldFailureGrosslyWrong:true,
      warmStartResidualLegible:true,
      coordinateFloorResidualLegible:true,
      manufacturedWitnessAuthorityCeilingLegible:true,
      stableIdentityLegible:true,
      fixedAttachmentsLegible:true,
      individualVolumeLegible:true,
      packingSemanticsNotInverted:true,
      restorationDeltaLegible:true,
      restorationResidualMarkersLegible:true,
    },
  };
  const admitted = await admitNBodyPackingLocalizedVisualInspection({ outDir, inspection });
  assert.equal(admitted.report.status, 'complete-agent-visual-inspected');
  assert.equal(admitted.report.visualInspection.captureCount, 16);
  assert.equal(admitted.receipt.route.effective,
    NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE);
});

test('common-descent visual admission requires eighteen route-bound captures', async () => {
  const sourceDir = path.resolve(
    'artifacts/nbody-packing-family-gradient-common-descent-viewer-v0',
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-common-admission-'));
  const { report } = await writeNBodyPackingLocalizedHardBoundaryWitness({
    outDir,
    restorationResultPath:
      'artifacts/nbody-packing-all-neighbor-restoration-v0/result.json',
    trajectoryResultPath:
      'artifacts/nbody-packing-all-neighbor-restoration-trajectory-v0/result.json',
    commonDescentResultPath:
      'artifacts/nbody-packing-family-gradient-common-descent-v0/result.json',
  });
  for (const state of report.requiredStates) for (const mode of report.requiredModes) {
    const stem = `${state}-${mode}`;
    fs.copyFileSync(path.join(sourceDir, `${stem}.png`), path.join(outDir, `${stem}.png`));
    fs.copyFileSync(
      path.join(sourceDir, `${stem}-capture-report.json`),
      path.join(outDir, `${stem}-capture-report.json`),
    );
  }
  const inspection = {
    observedAt:'2026-08-12T00:00:00.000Z',
    summary:'Nine route-bound states inspected in transparent volume and opaque slices.',
    verdict:{
      nonblank:true,
      orbitable:true,
      sameCameraComparison:true,
      crowdedDebtLegible:true,
      lastPassClearanceLegible:true,
      coldFailureGrosslyWrong:true,
      warmStartResidualLegible:true,
      coordinateFloorResidualLegible:true,
      manufacturedWitnessAuthorityCeilingLegible:true,
      stableIdentityLegible:true,
      fixedAttachmentsLegible:true,
      individualVolumeLegible:true,
      packingSemanticsNotInverted:true,
      restorationDeltaLegible:true,
      restorationResidualMarkersLegible:true,
    },
  };
  const admitted = await admitNBodyPackingLocalizedVisualInspection({ outDir, inspection });
  assert.equal(admitted.report.status, 'complete-agent-visual-inspected');
  assert.equal(admitted.report.visualInspection.captureCount, 18);
  assert.equal(admitted.receipt.route.effective,
    NBODY_PACKING_COMMON_DESCENT_WITNESS_ROUTE);
});

test('hard-boundary pair markers bind exact violated segment identities', () => {
  const muscles = [
    { id:'left', centerline:[
      { position:[0, 0, 0] }, { position:[0, 1, 0] }, { position:[0, 2, 0] },
    ] },
    { id:'right', centerline:[
      { position:[2, 0, 0] }, { position:[2, 1, 0] }, { position:[2, 2, 0] },
    ] },
  ];
  const markers = createPairDebtEmphasisMarkers({
    muscles,
    rows:[
      { key:'pair:left:1|right:0', kind:'pairwise-clearance', signedGap:-0.2 },
      { key:'pair:left:0|right:1', kind:'pairwise-clearance', signedGap:0.1 },
    ],
  });
  assert.deepEqual(markers, [[1, 1, 0]]);
});
