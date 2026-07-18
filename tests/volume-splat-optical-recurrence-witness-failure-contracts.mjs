import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'kaminos-optical-wrapper-failure-'));
const reportPath = join(outDir, 'report.json');
const manifestPath = join(outDir, 'manifest.json');
writeFileSync(reportPath, JSON.stringify({
  schema: 'kaminos.volume.splat-optical-recurrence.v0',
  status: 'completed',
  stale: true,
}));
writeFileSync(manifestPath, JSON.stringify({
  schema: 'kaminos.pyro-cockpit-manifest.v0',
  status: 'complete',
  stale: true,
}));

const result = spawnSync(process.execPath, [
  join(root, 'volume-splat-optical-recurrence-witness.mjs'),
  '--url', 'http://127.0.0.1:1/volume-selective-head-live.html',
  '--out-dir', outDir,
  '--report', reportPath,
  '--manifest', manifestPath,
], { cwd: root, encoding: 'utf8' });
assert.notEqual(result.status, 0, 'unreachable route must fail the optical wrapper');

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(report.status, 'failed');
assert.equal(report.failurePhase, 'route-preflight');
assert.equal(report.lastTrustworthyEvidence.displacedPrimaryReport.status, 'completed');
assert.match(report.lastTrustworthyEvidence.displacedPrimaryReport.sha256, /^[0-9a-f]{64}$/);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.status, 'failed');
assert.equal(manifest.failurePhase, 'route-preflight');
assert.match(manifest.lastTrustworthyEvidence.displacedPrimaryManifest.sha256, /^[0-9a-f]{64}$/);

const delegateOutDir = mkdtempSync(join(tmpdir(), 'kaminos-optical-delegate-args-'));
const delegateOpticalPath = join(delegateOutDir, 'optical.json');
const delegate = spawnSync(process.execPath, [
  join(root, 'volume-raymarch-filament-orbit-witness.mjs'),
  '--url', 'http://127.0.0.1:1/not-the-selective-head.html',
  '--out-dir', delegateOutDir,
  '--optical-recurrence-report', delegateOpticalPath,
], { cwd: root, encoding: 'utf8' });
assert.notEqual(delegate.status, 0);
const delegateFailure = JSON.parse(readFileSync(delegateOpticalPath, 'utf8'));
assert.doesNotMatch(delegateFailure.error, /unknown argument: --optical-recurrence-report/);
assert.match(delegateFailure.error, /requested route must use the selective-head live wrapper/);

console.log('volume splat optical recurrence wrapper failure contracts passed');
