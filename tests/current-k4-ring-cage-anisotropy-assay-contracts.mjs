import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  finalizeCurrentK4RingCageAnisotropyVisualDisposition,
} from '../tools/finalize-current-k4-ring-cage-anisotropy-visual.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ARTIFACT_ROOT = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-anisotropy-assay-v0',
);

async function json(relative) {
  return JSON.parse(await readFile(path.join(ARTIFACT_ROOT, relative), 'utf8'));
}

test('coupled current-K4 anisotropy receipt preserves the carrier predicates and the scalar trade', async () => {
  const [report, comparison, selection, receipt] = await Promise.all([
    json('run-report.json'),
    json('comparison.json'),
    json('anisotropy-selection.json'),
    json('anisotropy-receipt.json'),
  ]);

  assert.equal(report.schema,
    'kaminos.current-k4-ring-cage-anisotropy-assay-run-report.v0');
  assert.equal(report.status, 'completed');
  assert.equal(report.failurePhase, null);
  assert.equal(report.config.fallbackUsed, false);
  assert.deepEqual(report.config.requested, report.config.effective);
  assert.equal(comparison.status, 'completed');
  assert.equal(comparison.checkpoint.iterations, 72);
  assert.equal(comparison.selected.pairwiseMovableTotalPenetration,
    10.164116328174828);
  assert.equal(comparison.coupled.pairwiseMovableTotalPenetration,
    10.031586497873061);
  assert.equal(comparison.decision.improvedMovable, true);
  assert.equal(comparison.decision.didNotWorsenMovableMaximum, false);
  assert.equal(comparison.decision.didNotWorsenFixed, true);
  assert.equal(comparison.decision.didNotWorsenSkeletal, true);
  assert.equal(comparison.decision.classification,
    'coupled-anisotropy-nondominated-pending-visual-admission');
  assert.equal(comparison.coupled.nonPositiveCellCount, 0);
  assert.equal(comparison.coupled.compartmentMaximumEscape, 0);
  assert.equal(comparison.coupled.fixedNodeMaximumDrift, 0);
  assert.equal(comparison.coupled.centerlineMaximumDrift, 0);
  assert.ok(comparison.coupled.maximumRelativeVolumeError <= 0.015);
  assert.ok(comparison.coupled.maximumSectionAreaRelativeError <= 1e-12);
  assert.equal(selection.contactCount, 113);
  assert.equal(selection.adjustments.length, 11);
  assert.equal(receipt.sectionReceipts.length, 11);
  assert.equal(receipt.outputCarrier, undefined,
    'the compact receipt must not duplicate the full carrier payload');
  assert.equal(report.lastTrustworthyEvidence.decision.classification,
    comparison.decision.classification);
});

test('four-view inspection rejects the numerically nondominated point without identity substitution', async () => {
  const [report, verification, inspection] = await Promise.all([
    json('run-report.json'),
    json('capture-route-verification.json'),
    json('visual-inspection.json'),
  ]);
  assert.equal(verification.status, 'verified');
  assert.equal(verification.bundleIdentity.sha256,
    report.visual.bundleIdentity.sha256);
  assert.equal(verification.residualLedger.sha256,
    report.outputs.residualLedger.sha256);
  assert.equal(verification.witnessRoute.fallbackUsed, false);
  assert.equal(verification.captures.length, 4);
  assert.equal(new Set(verification.captures.map(capture => capture.sha256)).size, 4);
  assert.ok(verification.captures.every(capture =>
    capture.installedStableChrome === false &&
    capture.cleanupStatus === 'complete-no-process-group-remains'));
  assert.equal(inspection.bundleIdentitySha256, report.visual.bundleIdentity.sha256);
  assert.equal(inspection.residualLedgerSha256, report.outputs.residualLedger.sha256);
  assert.equal(inspection.status,
    'agent-inspected-rejected-no-material-visible-advance');
  assert.equal(report.visual.status, inspection.status,
    'run-report-only consumers must see the post-capture rejection');
  assert.deepEqual(report.visual.inspection, {
    path: 'visual-inspection.json',
    sha256: report.visual.inspection.sha256,
    disposition: inspection.visualDisposition,
  });
  assert.equal(report.visual.routeVerification.path,
    'capture-route-verification.json');
  assert.equal(inspection.visualDisposition,
    'reject-first-coupled-point-continue-bounded-amplitude-budget-sweep');
  assert.match(inspection.visibleDeltaAgainstAcceptedDirection,
    /No material visible advance/i);
});

test('anisotropy assay writes a durable parse-phase failure receipt and removes stale primaries', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-anisotropy-failure-'));
  const stalePrimary = path.join(output, 'comparison.json');
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(stalePrimary, '{"status":"stale-success"}\n'));
  const result = spawnSync(process.execPath, [
    path.join(REPO_ROOT, 'tools/run-current-k4-ring-cage-anisotropy-assay.mjs'),
    '--output', output,
    '--unsupported', 'value',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported argument/i);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.equal(report.outputs, null);
  await assert.rejects(readFile(stalePrimary), /ENOENT/);
});

test('visual finalization rejects stale or substituted inspection custody', async () => {
  const [runReport, assayResult, verification, inspection] = await Promise.all([
    json('run-report.json'),
    json('assay-result.json'),
    json('capture-route-verification.json'),
    json('visual-inspection.json'),
  ]);
  const input = {
    runReport,
    assayResult,
    verification,
    inspection,
    verificationSha256: inspection.captureRouteVerificationSha256,
    inspectionSha256: 'a'.repeat(64),
  };
  const tamperedBundle = structuredClone(input);
  tamperedBundle.inspection.bundleIdentitySha256 = '0'.repeat(64);
  assert.throws(
    () => finalizeCurrentK4RingCageAnisotropyVisualDisposition(tamperedBundle),
    /bundle identity mismatch/i,
  );
  const staleVerification = structuredClone(input);
  staleVerification.verificationSha256 = '0'.repeat(64);
  assert.throws(
    () => finalizeCurrentK4RingCageAnisotropyVisualDisposition(staleVerification),
    /route verification identity mismatch/i,
  );
});
