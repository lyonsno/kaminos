import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finalizeCurrentK4LongitudinalVolumeVisualDisposition,
} from '../tools/finalize-current-k4-ring-cage-longitudinal-volume-visual.mjs';

const HASH = character => character.repeat(64);

function fixture() {
  const route = {
    requested: 'current-k4-ring-cage-longitudinal-volume-orbitable-v0',
    effective: 'current-k4-ring-cage-longitudinal-volume-orbitable-v0',
    fallbackUsed: false,
  };
  const bundleIdentity = {
    sha256: HASH('a'),
    residualLedgerSha256: HASH('b'),
  };
  const runReport = {
    schema: 'kaminos.current-k4-ring-cage-longitudinal-volume-assay-run-report.v0',
    status: 'completed',
    resultStatus: 'longitudinal-volume-nondominated-pending-visual-admission',
    outputs: { residualLedger: { path: 'residual-ledger.json', sha256: HASH('b') } },
    visual: { status: 'pending-agent-inspection', route, bundleIdentity },
    lastTrustworthyEvidence: { phase: 'primary-artifacts-written' },
  };
  const verification = {
    status: 'verified',
    bundleIdentity,
    residualLedger: runReport.outputs.residualLedger,
    witnessRoute: route,
    captures: ['c', 'd', 'e', 'f'].map(character => ({ sha256: HASH(character) })),
  };
  const inspection = {
    schema: 'kaminos.current-k4-longitudinal-volume-visual-inspection.v0',
    status: 'agent-inspected-nondominated-subtle-local-relief-no-material-silhouette-advance',
    visualDisposition: 'continue-bounded-pressure-directed-amplitude-frontier',
    bundleIdentitySha256: HASH('a'),
    residualLedgerSha256: HASH('b'),
    captureRouteVerificationSha256: HASH('1'),
    captures: structuredClone(verification.captures),
  };
  return { runReport, verification, inspection };
}

test('longitudinal visual finalization makes the inspected trade visible to report consumers', () => {
  const values = fixture();
  const finalized = finalizeCurrentK4LongitudinalVolumeVisualDisposition({
    ...values,
    verificationSha256: HASH('1'),
    inspectionSha256: HASH('2'),
  });
  assert.equal(finalized.visual.status, values.inspection.status);
  assert.equal(finalized.visualDisposition, values.inspection.visualDisposition);
  assert.equal(finalized.resultStatus,
    'longitudinal-volume-nondominated-visually-subtle-continue-frontier');
  assert.equal(finalized.outputs.visualInspection.sha256, HASH('2'));
  assert.equal(finalized.outputs.routeVerification.sha256, HASH('1'));
  assert.equal(finalized.lastTrustworthyEvidence.phase, 'visual-inspection-finalized');
});

test('longitudinal visual finalization rejects stale bundle and capture custody', () => {
  const values = fixture();
  const staleBundle = structuredClone(values);
  staleBundle.inspection.bundleIdentitySha256 = HASH('9');
  assert.throws(
    () => finalizeCurrentK4LongitudinalVolumeVisualDisposition({
      ...staleBundle,
      verificationSha256: HASH('1'),
      inspectionSha256: HASH('2'),
    }),
    /bundle identity mismatch/i,
  );
  const staleCapture = structuredClone(values);
  staleCapture.inspection.captures[0].sha256 = HASH('9');
  assert.throws(
    () => finalizeCurrentK4LongitudinalVolumeVisualDisposition({
      ...staleCapture,
      verificationSha256: HASH('1'),
      inspectionSha256: HASH('2'),
    }),
    /capture identity mismatch/i,
  );
});
