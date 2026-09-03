import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'kaminos-layout-witness-early-failure-'));
try {
  const screenshotPath = join(scratch, 'layout.png');
  const reportPath = join(scratch, 'report.json');
  const layoutStore = join(scratch, 'layout-store');
  writeFileSync(screenshotPath, 'stale-prior-run');

  const result = spawnSync(process.execPath, [
    join(root, 'volume-cockpit-layout-witness.mjs'),
    '--expected-repo-root', root,
    '--expected-commit', 'a'.repeat(40),
    '--expected-layout-store', layoutStore,
    '--report', reportPath,
    '--screenshot', screenshotPath,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, 'a missing URL must fail the production witness entrypoint');
  assert.equal(existsSync(screenshotPath), false, 'argument validation preserved a stale advertised screenshot');
  assert.deepEqual(
    readdirSync(scratch).filter(name => name.startsWith('layout.png.') && name.endsWith('.partial')),
    [],
    'argument validation left generation-partial screenshot bytes behind',
  );

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.match(report.runId, /^[0-9a-f-]{36}$/, 'failure report lost the current run identity');
  assert.equal(report.failurePhase, 'argument-validation');
  assert.match(report.error, /missing --url/);
  assert.deepEqual(
    {
      produced: report.screenshotEvidence?.produced,
      published: report.screenshotEvidence?.published,
      admitted: report.screenshotEvidence?.admitted,
    },
    { produced: false, published: false, admitted: false },
    'early failure did not serialize explicit current-run screenshot rejection',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('volume cockpit layout witness early failure contracts passed');
