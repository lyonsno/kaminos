import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = mkdtempSync(join(tmpdir(), 'wake-fire-preset-witness-'));
const reportPath = join(temporary, 'report.json');

try {
  const result = spawnSync(process.execPath, [
    'tests/wake-volume-settings-preset-browser-roundtrip.mjs',
    '--base-url', 'http://127.0.0.1:1/',
    '--preset', 'flamebowl-blockout-130r',
    '--chrome', '/definitely/missing/chrome',
    '--deadline-ms', '1000',
    '--repo-root', root,
    '--report', reportPath,
    '--screenshot', join(temporary, 'screenshot.png'),
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'invalid browser preflight must fail');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'preflight');
  assert.match(report.error, /Browser path is not an executable file/);
  assert.equal(report.requested.repoRoot, root);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
