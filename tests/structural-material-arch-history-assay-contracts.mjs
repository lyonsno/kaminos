import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as assay from '../structural-material-arch-depth-assay.mjs';
import { runArchHistoryAssayCli } from '../structural-material-arch-history-assay.mjs';

assert.equal(typeof assay.runArchHistoryAssay, 'function',
  'the arch witness must compare matched later loads after a located prior bond transition');

const report = assay.runArchHistoryAssay(
  'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb',
);

assert.equal(report.status, 'passed');
assert.equal(report.route.effective, 'local Node.js CPU / shear-regularized linear-spring PCG');
assert.equal(report.route.fallback, false);
assert.equal(report.source.sha256, 'c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5');
assert.equal(report.priorTransition.bondEvents.length, 40);
assert.ok(report.priorTransition.bondEvents.every(event => event.kind === 'crack' && event.bondId));
assert.equal(report.matchedLaterLoad.intact.requestedForce, report.matchedLaterLoad.requestedForce);
assert.equal(report.matchedLaterLoad.damaged.requestedForce, report.matchedLaterLoad.requestedForce);
assert.deepEqual(report.matchedLaterLoad.intact.contact, report.matchedLaterLoad.contact);
assert.deepEqual(report.matchedLaterLoad.damaged.contact, report.matchedLaterLoad.contact);
assert.equal(report.matchedLaterLoad.sameContactAndForce, true);
assert.ok(report.matchedLaterLoad.travelDelta > 0.002);
assert.ok(report.matchedLaterLoad.relativeTravelDelta > 0.5);
assert.equal(report.matchedLaterLoad.damaged.componentCount, 1);
assert.equal(report.unloaded.damaged.peakDisplacement, 0);
assert.ok(report.claimCeiling.some(claim => claim.includes('no residual deformation')));

const temporary = mkdtempSync(join(tmpdir(), 'arch-history-assay-'));
try {
  const failedPath = join(temporary, 'failed.json');
  const failure = spawnSync(process.execPath, [
    'structural-material-arch-history-assay.mjs',
    join(temporary, 'missing.glb'),
    failedPath,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(failure.status, 0);
  const failureReport = JSON.parse(readFileSync(failedPath, 'utf8'));
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.phase, 'read-source-and-run-matched-history');
  assert.equal(failureReport.route.effective, 'local Node.js CPU / shear-regularized linear-spring PCG');
  assert.equal(failureReport.route.fallback, false);
  assert.equal(failureReport.lastTrustworthyEvidence,
    `source path ${join(temporary, 'missing.glb')} and output path ${failedPath} accepted; source not yet read`);

  const callerPath = join(temporary, 'caller-output.json');
  assert.throws(() => runArchHistoryAssayCli(join(temporary, 'missing-again.glb'), callerPath), /ENOENT/);
  assert.equal(JSON.parse(readFileSync(callerPath, 'utf8')).status, 'failed');

  const nestedPath = join(temporary, 'created', 'by', 'caller', 'failed.json');
  const nestedFailure = spawnSync(process.execPath, [
    'structural-material-arch-history-assay.mjs',
    join(temporary, 'missing-nested.glb'),
    nestedPath,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(nestedFailure.status, 0);
  assert.equal(existsSync(nestedPath), true,
    'CLI must create a caller-selected output parent and retain its failure report');
  const nestedReport = JSON.parse(readFileSync(nestedPath, 'utf8'));
  assert.equal(nestedReport.status, 'failed');
  assert.equal(nestedReport.phase, 'read-source-and-run-matched-history');
  assert.equal(nestedReport.route.fallback, false);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log('structural arch matched-history assay contracts passed');
