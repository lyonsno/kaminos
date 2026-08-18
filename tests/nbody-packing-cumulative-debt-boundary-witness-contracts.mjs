import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as trajectoryWitness from '../nbody-packing-active-row-trajectory-witness.mjs';

test('cumulative-debt boundary witness fails closed before primary output when source is absent', async () => {
  assert.equal(
    typeof trajectoryWitness.writeNBodyPackingCumulativeDebtBoundaryWitness,
    'function',
    'cumulative-debt boundary witness is not implemented',
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cumulative-debt-boundary-missing-'));
  await assert.rejects(
    trajectoryWitness.writeNBodyPackingCumulativeDebtBoundaryWitness({
      outDir,
      canonicalRawPath:path.join(outDir, 'missing', 'canonical-raw.json'),
    }),
    /ENOENT/,
  );
  for (const name of ['fixtures.json', 'comparison.json', 'index.html']) {
    assert.equal(fs.existsSync(path.join(outDir, name)), false);
  }
  const failure = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.deepEqual(failure.route, {
    requested:trajectoryWitness.NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE,
    effective:null,
    fallbackUsed:false,
  });
  assert.equal(failure.failurePhase, 'read-cumulative-debt-boundary-source');
  assert.deepEqual(failure.lastTrustworthyEvidence, { phase:'none' });
});

test('cumulative-debt boundary witness projects sparse decision-bearing physical states', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cumulative-debt-boundary-'));
  const { report, states } =
    await trajectoryWitness.writeNBodyPackingCumulativeDebtBoundaryWitness({ outDir });
  const canonical = JSON.parse(fs.readFileSync(
    'artifacts/nbody-packing-cumulative-debt-filter-classified-boundary-trajectory-v0/canonical-raw.json',
    'utf8',
  ));
  assert.deepEqual(report.route, {
    requested:trajectoryWitness.NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE,
    effective:trajectoryWitness.NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE,
    fallbackUsed:false,
  });
  assert.deepEqual(report.requiredStates, [
    'step-16-source',
    'priced-debt-step-1',
    'priced-debt-step-4',
    'priced-debt-step-11',
    'priced-debt-floor-12',
  ]);
  assert.deepEqual(report.requiredModes, ['volume', 'slice']);
  assert.equal(
    report.classification.terminalClass,
    'strict-global-merit-floor-cumulative-family-debt-floor',
  );
  assert.equal(report.classification.attemptedTransitions, 12);
  assert.equal(report.classification.acceptedTransitions, 11);
  assert.equal(report.classification.physicalProjectionCount, 5);
  assert.deepEqual(states['priced-debt-step-1'].metrics,
    canonical.work.rows[0].after.metrics);
  assert.deepEqual(states['priced-debt-step-11'].metrics,
    canonical.work.rows[10].after.metrics);
  assert.deepEqual(states['priced-debt-floor-12'].metrics,
    canonical.work.rows[11].after.metrics);
  assert.deepEqual(
    states['priced-debt-floor-12'].muscles,
    states['priced-debt-step-11'].muscles,
    'rejected floor must not invent geometry motion',
  );
  assert.match(states['priced-debt-floor-12'].truth, /Fifteen strict candidates/);
  assert.match(states['priced-debt-floor-12'].truth, /sixteen raw elastic candidates/);
  assert.equal(report.bindings.canonicalIdentitySha256, canonical.identity.sha256);
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.match(html, /Cumulative-priced packing · natural direction-set floor/);
  assert.match(html, /attempt 12 · joint direction-set floor/);
  assert.match(html, /same geometry as step 11/);
  assert.match(html, /id="debt-ledger"/);
  assert.match(report.claimCeiling.admittedClaim, /cumulative-priced synthetic trajectory/);
});
