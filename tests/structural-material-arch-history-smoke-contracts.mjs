import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scratch = mkdtempSync(join(tmpdir(), 'kaminos-arch-history-smoke-contract-'));
const output = join(scratch, 'new', 'nested', 'failure.json');
try {
  const result = spawnSync(process.execPath, [
    'structural-material-arch-history-smoke.mjs',
    'http://example.invalid/structural-material-arch-geometry.html',
    output,
    '/missing/chrome',
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'wrong-route request must not launch a browser or claim a smoke');
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'preflight');
  assert.match(report.error.message, /route is the local arch geometry consumer/);
  assert.equal(report.requestedUrl, 'http://example.invalid/structural-material-arch-geometry.html');
  assert.equal(report.effectiveRoute, 'not yet observed');
  assert.equal(report.fallback, null);
  assert.match(result.stderr, /durable report:/);
  console.log('structural arch matched-history browser-smoke failure contracts passed');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
