import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashMusclePackingCanonicalJson } from '../muscle-compartment-packing-core.mjs';
import {
  writeNBodyPackingActiveRowTrajectoryWitness,
} from '../nbody-packing-active-row-trajectory-witness.mjs';
import { captureNBodyPackingLocalizedState } from '../nbody-packing-localized-capture.mjs';
import {
  admitNBodyPackingLocalizedVisualInspection,
  renderNBodyPackingLocalizedChallengeHtml,
} from '../nbody-packing-localized-witness.mjs';

const ACTIVE_ROOT = 'artifacts/nbody-packing-active-row-trust-region-trajectory-v0';

test('localized capture admits every active-row trajectory projection state', async () => {
  for (const state of [
    'authenticated-adaptive-start',
    'active-row-step-1',
    'active-row-step-3',
    'active-row-step-7',
    'active-row-step-8',
    'manufactured-reference',
  ]) {
    await assert.rejects(
      captureNBodyPackingLocalizedState({ state }),
      /localized capture requires explicit baseUrl, outputPath, and reportPath/,
    );
  }
});

test('localized visual admission recognizes the active-row witness route before capture binding', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-row-visual-route-'));
  await writeNBodyPackingActiveRowTrajectoryWitness({ outDir });
  await assert.rejects(
    admitNBodyPackingLocalizedVisualInspection({
      outDir,
      inspection:{
        observedAt:'2026-08-13T00:00:00Z',
        summary:'Synthetic trajectory frames inspected.',
        verdict:{
          nonblank:true,
          orbitable:true,
          sameCameraComparison:true,
          authenticatedAdaptiveBaselineLegible:true,
          activeTrajectoryMotionLegible:true,
          largeRadiusStepsLegible:true,
          endpointAndVolumePreservationLegible:true,
          residualDebtLegible:true,
          manufacturedWitnessAuthorityCeilingLegible:true,
          packingSemanticsNotInverted:true,
        },
      },
    }),
    /ENOENT.*authenticated-adaptive-start-volume\.png/,
  );
});

test('active-row witness projects admitted start and four informative states without solver replay', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-row-trajectory-witness-'));
  const { report, states } = await writeNBodyPackingActiveRowTrajectoryWitness({ outDir });
  const active = JSON.parse(fs.readFileSync(`${ACTIVE_ROOT}/result.json`, 'utf8'));
  assert.equal(report.route.requested, 'nbody-packing-active-row-trust-region-trajectory-v0');
  assert.equal(report.route.effective, report.route.requested);
  assert.equal(report.route.fallbackUsed, false);
  assert.deepEqual(report.requiredStates, [
    'authenticated-adaptive-start',
    'active-row-step-1',
    'active-row-step-3',
    'active-row-step-7',
    'active-row-step-8',
    'manufactured-reference',
  ]);
  assert.deepEqual(states['active-row-step-1'].metrics, active.work.rows[0].after.metrics);
  assert.deepEqual(states['active-row-step-3'].metrics, active.work.rows[2].after.metrics);
  assert.deepEqual(states['active-row-step-7'].metrics, active.work.rows[6].after.metrics);
  assert.deepEqual(states['active-row-step-8'].metrics, active.selected.metrics);
  assert.equal(states['active-row-step-8'].comparisonOverlay.baselineState,
    'authenticated-adaptive-start');
  assert.equal(states['active-row-step-8'].comparisonOverlay.displayGain, 35);
  assert.equal(report.classification.acceptedIterations, 8);
  assert.equal(report.classification.terminalReason, null);
  assert.equal(report.classification.solverReplayedForPresentation, false);
  assert.equal(report.bindings.activeRowResultIdentitySha256, active.identity.sha256);
  assert.match(report.claimCeiling.admittedClaim, /family-maximum active rows/);
  assert.match(report.claimCeiling.admittedClaim, /budget exhausted without a terminal certificate/);
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.match(html, /Active-row trust-region trajectory · six-body hard boundary/);
  assert.match(html, /step 3 · first full-radius jump/);
  assert.match(html, /step 7 · late full-radius move/);
  assert.match(html, /solver inputs · oracle \/ contact graph/);
  assert.match(html, />no \/ yes<\/span>/);
  assert.doesNotMatch(html, /oracle \/ graph in candidate/);
  assert.doesNotMatch(html, />no \/ no<\/span>/);
});

test('evidence-bearing localized renderer fails closed without mechanism authority flags', () => {
  assert.throws(
    () => renderNBodyPackingLocalizedChallengeHtml({
      payload:{ states:{}, environment:{} },
      bindings:{ fixturesSha256:'a'.repeat(64), resultsSha256:'b'.repeat(64) },
    }),
    /requires authenticated oracle and contact-graph mechanism flags/,
  );
});

test('localized renderer preserves no/no only for authenticated false mechanism flags', () => {
  const html = renderNBodyPackingLocalizedChallengeHtml({
    payload:{
      states:{ only:{ label:'only' } },
      mechanism:{
        oracleTargetCoordinatesConsumed:false,
        contactGraphRowsConsumed:false,
      },
      display:{ orderedStates:['only'], defaultState:'only' },
      environment:{},
    },
    bindings:{ fixturesSha256:'a'.repeat(64), resultsSha256:'b'.repeat(64) },
  });
  assert.match(html, /solver inputs · oracle \/ contact graph/);
  assert.match(html, />no \/ no<\/span>/);
});

test('active-row witness rejects a rehashed source substitution and removes stale primaries', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-row-trajectory-forgery-'));
  const forged = JSON.parse(fs.readFileSync(`${ACTIVE_ROOT}/result.json`, 'utf8'));
  forged.selected.metrics.compartmentEscape += 0.0001;
  delete forged.identity;
  forged.identity = { sha256:hashMusclePackingCanonicalJson(forged) };
  const forgedPath = path.join(outDir, 'forged-result.json');
  fs.writeFileSync(forgedPath, `${JSON.stringify(forged, null, 2)}\n`);
  for (const name of ['fixtures.json', 'comparison.json', 'index.html']) {
    fs.writeFileSync(path.join(outDir, name), 'stale');
  }
  await assert.rejects(
    writeNBodyPackingActiveRowTrajectoryWitness({
      outDir,
      activeRowResultPath:forgedPath,
    }),
    /substituted active-row trajectory source/,
  );
  for (const name of ['fixtures.json', 'comparison.json', 'index.html']) {
    assert.equal(fs.existsSync(path.join(outDir, name)), false);
  }
  const failure = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.route.effective, null);
  assert.equal(failure.failurePhase, 'bind-active-row-source');
  assert.equal(failure.lastTrustworthyEvidence.phase, 'active-row-source-read');
});
