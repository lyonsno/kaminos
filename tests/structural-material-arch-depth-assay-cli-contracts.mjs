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
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log('structural arch depth assay CLI failure contracts passed');
