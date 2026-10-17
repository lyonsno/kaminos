// kaminos-test: node
// tools/test-runner.mjs: child tests reach the runner's browser stub, never an
// installed browser, and every launch they attempt fails the run.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, manifestOf, run, readReport, PASS, CLI, cliEnv } from './test-runner-fixtures.mjs';

test('child tests cannot reach an installed GUI Chrome through the usual overrides', async t => {
  const probe = "const v=[process.env.KAMINOS_CHROME,process.env.CHROME_BIN];process.exit(v.every(x=>x&&x.endsWith('browser-launch-stub.sh'))?0:1);\n";
  const f = await fixture(t, { files: { 'e.mjs': probe }, manifest: manifestOf({ 'tests/e.mjs': { kind: 'node' } }) });
  assert.equal((await run(f)).ok, true);
});

test('a witness that falls through to an installed Chrome reaches the runner stub, and the attempt fails the run', async t => {
  const fakeGui = path.join(os.tmpdir(), `kaminos-fake-gui-chrome-${process.pid}`);
  await fs.writeFile(fakeGui, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  t.after(() => fs.rm(fakeGui, { force: true }));
  const witness = `import { existsSync } from 'node:fs'; import { spawnSync } from 'node:child_process';
const chrome = [process.env.KAMINOS_CHROME, ${JSON.stringify(fakeGui)}].filter(Boolean).find(existsSync);
const res = spawnSync(chrome, ['--headless'], { stdio: 'ignore' });
process.exit(res.status === 0 ? 0 : 3);
`;
  const f = await fixture(t, { files: { 'w.mjs': witness }, manifest: manifestOf({ 'tests/w.mjs': { kind: 'node' } }) });
  assert.equal((await run(f)).ok, false);
  const report = await readReport(f);
  assert.deepEqual(report.browserLaunchAttempts.map(a => a.file), ['tests/w.mjs']);
});

test('every browser override reaches the stub, and launches recorded after a test exits still fail the run', async t => {
  const probe = "const v=['KAMINOS_CHROME','CHROME_BIN','CHROME','KAMINOS_SHARP_WEBGPU_CHROME'].map(k=>process.env[k]);process.exit(v.every(x=>x&&x.endsWith('browser-launch-stub.sh'))?0:1);\n";
  const late = `import { spawn } from 'node:child_process';
const child = spawn('sh', ['-c', 'sleep 0.5; "$KAMINOS_CHROME" --headless'], { detached: true, stdio: 'ignore' });
child.unref();
process.exit(0);
`;
  const f = await fixture(t, { files: { 'e.mjs': probe, 'late.mjs': late },
    manifest: manifestOf({ 'tests/e.mjs': { kind: 'node' }, 'tests/late.mjs': { kind: 'node' } }) });
  // The runner's own default settle, which the other contracts turn off.
  const result = await run(f, { lateLaunchSettleMs: undefined });
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.equal(report.results.find(r => r.file === 'tests/e.mjs').outcome, 'pass');
  assert.deepEqual(report.browserLaunchAttempts.map(a => a.file), ['tests/late.mjs']);
});

test('a logs path containing a dollar sign still records browser launch attempts', async t => {
  const probe = "import { spawnSync } from 'node:child_process'; process.exit(spawnSync(process.env.KAMINOS_CHROME, ['--headless']).status === 97 ? 0 : 1);\n";
  const f = await fixture(t, { files: { 'e.mjs': probe }, manifest: manifestOf({ 'tests/e.mjs': { kind: 'node' } }) });
  const logsDir = path.join(f.root, 'out', 'logs $HOME `x`');
  assert.equal((await run(f, { logsDir })).ok, false);
  assert.deepEqual((await readReport(f)).browserLaunchAttempts.map(a => a.file), ['tests/e.mjs']);
});

test('the late-launch settle is the runner default unless a caller sets it, and the report records it', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await run(f, { lateLaunchSettleMs: undefined });
  assert.equal((await readReport(f)).effective.lateLaunchSettleMs, 2000);
  await run(f, { lateLaunchSettleMs: 0 });
  assert.equal((await readReport(f)).effective.lateLaunchSettleMs, 0);
});

test('the command line takes the settle from KAMINOS_LATE_LAUNCH_SETTLE_MS, and an unusable value keeps the default with a warning', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const zero = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { env: cliEnv(f, { KAMINOS_LATE_LAUNCH_SETTLE_MS: '0' }), encoding: 'utf8' });
  assert.equal((await readReport(f)).effective.lateLaunchSettleMs, 0);
  // A settle below the default is printed, so a shortened run never looks like a default one.
  assert.match(zero.stdout, /^late-launch settle: 0 ms \(KAMINOS_LATE_LAUNCH_SETTLE_MS; default 2000 ms\); browser launches a test hands to a detached process after it exits may not be caught$/m);
  const unset = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { env: cliEnv(f, { KAMINOS_LATE_LAUNCH_SETTLE_MS: undefined }), encoding: 'utf8' });
  assert.equal((await readReport(f)).effective.lateLaunchSettleMs, 2000);
  assert.doesNotMatch(unset.stdout, /late-launch settle/);
  spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { env: cliEnv(f, { KAMINOS_LATE_LAUNCH_SETTLE_MS: 'soon' }), encoding: 'utf8' });
  const report = await readReport(f);
  assert.equal(report.effective.lateLaunchSettleMs, 2000);
  assert.ok(report.warnings.some(w => /KAMINOS_LATE_LAUNCH_SETTLE_MS/.test(w.message)), JSON.stringify(report.warnings));
});
