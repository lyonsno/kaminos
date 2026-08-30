import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = mkdtempSync(join(tmpdir(), 'wake-fire-preset-witness-'));

function assertPreflightFailure(name, extraArgs, errorPattern) {
  const reportPath = join(temporary, `${name}.json`);
  const result = spawnSync(process.execPath, [
    'tests/wake-volume-settings-preset-browser-roundtrip.mjs',
    '--base-url', 'http://127.0.0.1:1/',
    '--preset', 'flamebowl-blockout-130r',
    '--repo-root', root,
    '--report', reportPath,
    '--screenshot', join(temporary, `${name}.png`),
    ...extraArgs,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, `${name} preflight must fail`);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'preflight');
  assert.match(report.error, errorPattern);
  assert.equal(report.requested.repoRoot, root);
}

try {
  assertPreflightFailure('invalid-browser', [
    '--chrome', '/definitely/missing/chrome',
    '--deadline-ms', '1000',
  ], /Browser path is not an executable file/);
  assertPreflightFailure('invalid-deadline', [
    '--deadline-ms', 'invalid',
  ], /--deadline-ms must name the caller-owned witness deadline/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
