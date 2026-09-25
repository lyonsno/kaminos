import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'kaminos-arch-browser-startup-'));
const fakeChrome = join(scratch, 'fake-chrome');
const reportPath = join(scratch, 'startup-report.json');
const smokePath = join(root, 'structural-material-arch-browser-smoke.mjs');

writeFileSync(fakeChrome, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'Chrome fake startup-contract'
  exit 0
fi
trap 'exit 0' TERM INT
while :; do sleep 1; done
`);
chmodSync(fakeChrome, 0o755);

const harness = spawn(process.execPath, [
  smokePath,
  'http://127.0.0.1:8423/structural-material-arch.html',
  reportPath,
  fakeChrome,
  '250',
], { cwd: root, detached: process.platform !== 'win32', stdio: 'ignore' });

let timedOut = false;
const exit = new Promise(resolvePromise => harness.once('exit', (code, signal) => resolvePromise({ code, signal })));
const outcome = await Promise.race([
  exit,
  new Promise(resolvePromise => setTimeout(() => resolvePromise({ timedOut: true }), 1800)),
]);
if (outcome.timedOut) {
  timedOut = true;
  try {
    if (process.platform === 'win32') harness.kill('SIGTERM');
    else process.kill(-harness.pid, 'SIGTERM');
  } catch {}
  await Promise.race([exit, new Promise(resolvePromise => setTimeout(resolvePromise, 500))]);
}

try {
  assert.equal(timedOut, false, 'browser smoke must end a live no-port startup at its caller-provided deadline');
  assert.equal(outcome.code, 1, 'startup timeout is a reported smoke failure');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.error.phase, 'browser-launch');
  assert.match(report.error.message, /DevToolsActivePort.*250|250.*DevToolsActivePort/);
  assert.equal(report.browser.startupTimeoutMs, 250);
  assert.match(report.lastTrustworthyEvidence, /Chrome child spawned/);
  assert.match(report.requestedUrl, /^http:\/\/127\.0\.0\.1:8423\/structural-material-arch\.html/);
  assert.ok(report.browser.exit?.signal === 'SIGTERM' || report.browser.exit?.code === 0,
    'the browser child must be terminated by the timeout cleanup');
  console.log('arch browser startup failure-report contracts passed');
} finally {
  try {
    if (process.platform === 'win32') harness.kill('SIGKILL');
    else process.kill(-harness.pid, 'SIGKILL');
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
}
