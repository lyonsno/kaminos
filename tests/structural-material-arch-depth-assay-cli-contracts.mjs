import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), 'arch-depth-assay-contract-'));
try {
  const input = join(temp, 'missing-source.glb');
  const output = join(temp, 'receipts', 'nested', 'failure-report.json');
  const result = spawnSync(process.execPath, [
    'structural-material-arch-depth-assay.mjs', input, output,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'load-source-and-run-depth-assay');
  assert.equal(report.requestedSourcePath, input);
  assert.equal(report.outputPath, output);
  assert.equal(report.route.requested, 'local Node.js CPU experiment');
  assert.equal(report.route.effective, 'local Node.js CPU / shear-regularized linear-spring PCG');
  assert.equal(report.route.fallback, false);
  assert.equal(report.configuration.resolution.columns, 48);
  assert.match(report.lastTrustworthyEvidence, /source path .*missing-source\.glb/);

  const invalidOutput = join(temp, 'receipts', 'invalid-patch-report.json');
  const invalid = spawnSync(process.execPath, [
    'structural-material-arch-depth-assay.mjs', input, invalidOutput, '-0.001',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  const invalidReport = JSON.parse(readFileSync(invalidOutput, 'utf8'));
  assert.equal(invalidReport.status, 'failed');
  assert.equal(invalidReport.configuration.contactPatchRadius, -0.001);
  assert.match(invalidReport.error.message, /contact patch radius must be finite and nonnegative/);

  const source = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
  const validOutput = join(temp, 'receipts', 'patch-success-report.json');
  const valid = spawnSync(process.execPath, [
    'structural-material-arch-depth-assay.mjs', source, validOutput, '0.032',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  const validReport = JSON.parse(readFileSync(validOutput, 'utf8'));
  assert.equal(validReport.status, 'passed');
  assert.equal(validReport.phase, 'complete');
  assert.equal(validReport.configuration.contactPatchRadius, 0.032);
  assert.equal(validReport.route.effective, 'local Node.js CPU / shear-regularized linear-spring PCG');
  assert.equal(validReport.route.fallback, false);
  assert.equal(validReport.source.sha256, 'c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5');
  assert.equal(validReport.proxy.cases.intact['surface-envelope'].runs[3].history[0].contactCells.length, 9);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log('structural arch depth assay CLI failure contracts passed');
