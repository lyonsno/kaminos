import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
  writeNBodyPackingElasticExchangeTrajectoryWitness,
} from '../nbody-packing-active-row-trajectory-witness.mjs';
import { admitNBodyPackingLocalizedVisualInspection } from
  '../nbody-packing-localized-witness.mjs';

const RESULT_ROOT = 'artifacts/nbody-packing-elastic-exchange-trajectory-v0';

test('elastic-exchange trajectory witness fails closed before primary output when source is absent', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elastic-exchange-trajectory-missing-'));
  const missingRoot = path.join(outDir, 'missing');
  await assert.rejects(
    writeNBodyPackingElasticExchangeTrajectoryWitness({
      outDir,
      canonicalRawPath:path.join(missingRoot, 'canonical-raw.json'),
      reverseRawPath:path.join(missingRoot, 'reverse-raw.json'),
      runReportPath:path.join(missingRoot, 'run-report.json'),
    }),
    /ENOENT/,
  );
  for (const name of ['fixtures.json', 'comparison.json', 'index.html']) {
    assert.equal(fs.existsSync(path.join(outDir, name)), false);
  }
  const failure = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.deepEqual(failure.route, {
    requested:NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
    effective:null,
    fallbackUsed:false,
  });
  assert.equal(failure.failurePhase, 'read-elastic-exchange-trajectory-source');
  assert.deepEqual(failure.lastTrustworthyEvidence, { phase:'none' });
});

test('elastic-exchange trajectory witness binds true reverse parity and projects every physical transition', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elastic-exchange-trajectory-'));
  const { report, states } = await writeNBodyPackingElasticExchangeTrajectoryWitness({ outDir });
  const canonical = JSON.parse(fs.readFileSync(`${RESULT_ROOT}/canonical-raw.json`, 'utf8'));
  const reverse = JSON.parse(fs.readFileSync(`${RESULT_ROOT}/reverse-raw.json`, 'utf8'));
  assert.deepEqual(report.route, {
    requested:NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
    effective:NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
    fallbackUsed:false,
  });
  assert.deepEqual(report.requiredStates, [
    'step-16-source',
    'elastic-exchange-step-1',
    'elastic-exchange-step-2',
    'elastic-exchange-step-3',
    'elastic-exchange-step-4',
  ]);
  assert.deepEqual(report.requiredModes, ['volume', 'slice']);
  assert.equal(report.classification.canonicalReversePhysicalParity, true);
  assert.equal(report.classification.solverReplayedForPresentation, false);
  assert.equal(report.classification.terminalClass, 'contact-cycle');
  assert.equal(report.classification.acceptedTransitions, 4);
  assert.equal(reverse.config.effective.strictStep.candidateEnumeration, 'reverse');
  assert.equal(reverse.config.effective.elasticStep.candidateEnumeration, 'reverse');
  assert.deepEqual(states['elastic-exchange-step-1'].metrics,
    canonical.work.rows[0].after.metrics);
  assert.deepEqual(states['elastic-exchange-step-4'].metrics,
    canonical.work.rows[3].after.metrics);
  assert.equal(states['elastic-exchange-step-1'].comparisonOverlay.baselineState,
    'step-16-source');
  assert.equal(states['elastic-exchange-step-4'].comparisonOverlay.displayGain, 60);
  assert.equal(states['elastic-exchange-step-4'].status, 'contact-cycle');
  assert.match(states['elastic-exchange-step-4'].truth, /contact graph repeats/);
  assert.equal(report.bindings.canonicalIdentitySha256, canonical.identity.sha256);
  assert.equal(report.bindings.reverseIdentitySha256, reverse.identity.sha256);
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.match(html, /Elastic exchange trajectory · borrowing, repayment, cycle/);
  assert.match(html, /step 1 · elastic escape/);
  assert.match(html, /step 4 · strict repayment/);
  assert.match(html, /final state is shown because the repeated contact graph/);
  assert.match(html, /id="debt-ledger"/);
  assert.match(html, /family debt/);
  assert.match(html, /changed row debt/);
  assert.match(report.claimCeiling.admittedClaim, /terminal contact-cycle state/);
});

test('localized visual admission selects the elastic-exchange trajectory verdict contract', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elastic-exchange-visual-route-'));
  await writeNBodyPackingElasticExchangeTrajectoryWitness({ outDir });
  await assert.rejects(
    admitNBodyPackingLocalizedVisualInspection({
      outDir,
      inspection:{
        observedAt:'2026-08-13T19:00:00Z',
        summary:'Exact source and four physical transitions inspected in both modes.',
        verdict:{
          nonblank:true,
          orbitable:true,
          sameCameraComparison:true,
          sharedSourceLegible:true,
          elasticEscapeLegible:true,
          strictRepaymentLegible:true,
          contactCycleLegible:true,
          truePositionAndAmplificationDistinct:true,
          endpointAndVolumePreservationLegible:true,
          rowAndFamilyDebtLegible:true,
          syntheticAuthorityCeilingLegible:true,
          packingSemanticsNotInverted:true,
        },
      },
    }),
    /ENOENT.*step-16-source-volume\.png/,
  );
});
