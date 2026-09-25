import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runArchContactInteriorAssay } from '../structural-material-arch-contact-interior-assay.mjs';

const source = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const report = runArchContactInteriorAssay(source, { contactPatchRadius: 0.032, force: 1.25 });

assert.equal(report.status, 'passed');
assert.equal(report.schema, 'kaminos.structural-material.arch-contact-interior-sensitivity.v0');
assert.equal(report.route.requested, 'local Node.js CPU experiment');
assert.equal(report.route.effective, 'local Node.js CPU / shear-regularized linear-spring PCG');
assert.equal(report.route.fallback, false);
assert.equal(report.source.sha256, 'c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5');
assert.equal(report.source.sameSourceForIntactAndNotch, true);
assert.deepEqual(report.configuration.contactDepthModes, ['through-thickness', 'camera-facing-surface']);
assert.deepEqual(report.configuration.interiorModes, ['continuous', 'radial-voussoir-joints']);
assert.equal(report.configuration.force, 1.25);
assert.equal(report.cases.length, 8);
assert.equal(report.adjudication.notchLocalCrackContrastFlipsWithInterior, true);
assert.deepEqual(report.adjudication.contactModesWithFlippedNotchContrast,
  ['through-thickness', 'camera-facing-surface']);

for (const item of report.cases) {
  assert.equal(item.result.history[0].requestedForce, 1.25);
  assert.equal(item.result.history[0].contactDepthMode, item.contactDepthMode);
  assert.ok(item.result.history.length > 0);
  assert.ok(item.proxy.componentsAtRest === 1);
  assert.ok(item.result.history.every(epoch => epoch.solve.relativeResidual <= 1e-6));
  const expectedLoadedNodes = item.contactDepthMode === 'through-thickness' ? 27 : 9;
  assert.equal(item.result.history[0].loadedNodeCount, expectedLoadedNodes);
  assert.deepEqual(item.result.history[0].loadedNodeLayers,
    item.contactDepthMode === 'through-thickness' ? [0, 1, 2] : [2]);
  assert.ok(Math.abs(item.result.history[0].forcePerNode * expectedLoadedNodes - 1.25) < 1e-12);
  assert.equal(item.proxy.jointBonds > 0, item.interiorMode === 'radial-voussoir-joints');
}

const temporary = mkdtempSync(join(tmpdir(), 'kaminos-arch-contact-interior-'));
try {
  const failedReportPath = join(temporary, 'missing-source-report.json');
  const failed = spawnSync(process.execPath, [
    'structural-material-arch-contact-interior-assay.mjs',
    join(temporary, 'missing.glb'),
    failedReportPath,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /arch contact\/interior assay failed during load-source-and-run-contact-interior-assay/);
  const failureReport = JSON.parse(readFileSync(failedReportPath, 'utf8'));
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.phase, 'load-source-and-run-contact-interior-assay');
  assert.equal(failureReport.route.effective, 'local Node.js CPU / shear-regularized linear-spring PCG');
  assert.equal(failureReport.route.fallback, false);
  assert.equal(failureReport.lastTrustworthyEvidence,
    `source path ${join(temporary, 'missing.glb')} and output path ${failedReportPath} accepted; source not yet read`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log('structural arch contact/interior assay contracts passed');
