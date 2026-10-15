// kaminos-test: node
// tools/test-runner.mjs: the KAMINOS_BROWSER route, which runs the browser-kind
// tests that opt in to it with the browser it names.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, manifestOf, run, readReport, CLI, cliEnv } from './test-runner-fixtures.mjs';

// Browser-kind tests: run only when KAMINOS_BROWSER names an executable, and
// only those that opt in to that route.

async function browserStub(t, body = '#!/bin/sh\nenv\n', mode = 0o755) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-browser-stub-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'chrome-for-testing');
  await fs.writeFile(file, body, { mode });
  await fs.chmod(file, mode);
  return file;
}

const browserTest = (file, declaration = '// kaminos-test: browser route — launches the browser the runner hands it') => `${declaration}
import { spawnSync } from 'node:child_process';
const res = spawnSync(process.env.KAMINOS_CHROME, [], { encoding: 'utf8' });
const env = res.stdout || '';
const ok = res.status === 0 && env.includes('KAMINOS_TEST_RUNNER_TEST=tests/${file}')
  && process.env.CHROME_BIN.endsWith('browser-launch-stub.sh') && !('KAMINOS_BROWSER' in process.env);
console.log(env);
process.exit(ok ? 0 : 1);
`;
const BROWSER_TEST = browserTest('b.mjs');
const NODE_SEES_STUB = "// kaminos-test: node\nprocess.exit(process.env.KAMINOS_CHROME.endsWith('browser-launch-stub.sh') ? 0 : 1);\n";

test('with KAMINOS_BROWSER set, an opted-in browser-kind test runs and receives its real path as KAMINOS_CHROME; node tests keep the stub', async t => {
  const stub = await browserStub(t);
  const link = path.join(path.dirname(stub), 'linked-browser');
  await fs.symlink(stub, link);
  const real = await fs.realpath(stub);
  const f = await fixture(t, { files: { 'b.mjs': BROWSER_TEST, 'n.mjs': NODE_SEES_STUB }, manifest: manifestOf({}) });
  const result = await run(f, { browser: link });
  const report = await readReport(f);
  assert.equal(result.ok, true, JSON.stringify(report.results.map(r => [r.file, r.outcome])));
  assert.deepEqual(report.results.map(r => [r.file, r.kind, r.outcome]).sort(), [['tests/b.mjs', 'browser', 'pass'], ['tests/n.mjs', 'node', 'pass']]);
  assert.deepEqual(report.notRun, []);
  assert.equal(report.effective.browser.executable, link);
  assert.equal(report.effective.browser.realpath, real);
  assert.deepEqual(report.browserLaunchAttempts, []);
  const env = (await fs.readFile(report.results.find(r => r.file === 'tests/b.mjs').log, 'utf8')).split('\n');
  assert.ok(env.includes(`KAMINOS_CHROME=${real}`), `the test receives the real path ${real}, not the link`);
});

test('under KAMINOS_BROWSER only browser-kind tests that opt in run; the others are not run, with the reason', async t => {
  const stub = await browserStub(t);
  const FAILS = "process.exit(1);\n";
  const f = await fixture(t, { files: {
      'in.mjs': browserTest('in.mjs'),
      'out.mjs': '// kaminos-test: browser — needs its own environment\n' + FAILS,
      'listed-in.mjs': browserTest('listed-in.mjs', '// opted in through the manifest'),
      'listed-out.mjs': FAILS },
    manifest: manifestOf({ 'tests/listed-in.mjs': { kind: 'browser', reason: 'listed browser test', route: true },
      'tests/listed-out.mjs': { kind: 'browser', reason: 'listed, needs its own environment' } }) });
  const result = await run(f, { browser: stub });
  const report = await readReport(f);
  assert.equal(result.ok, true, JSON.stringify(report.results.map(r => [r.file, r.outcome])));
  assert.deepEqual(report.results.map(r => [r.file, r.outcome]).sort(), [['tests/in.mjs', 'pass'], ['tests/listed-in.mjs', 'pass']]);
  assert.deepEqual(report.notRun.map(r => [r.file, r.kind, r.reason]).sort(), [
    ['tests/listed-out.mjs', 'browser', 'not opted in to the KAMINOS_BROWSER route: listed, needs its own environment'],
    ['tests/out.mjs', 'browser', 'not opted in to the KAMINOS_BROWSER route: needs its own environment']]);
});

test('without KAMINOS_BROWSER, browser-kind tests are not run and the report records no browser', async t => {
  const f = await fixture(t, { files: { 'b.mjs': BROWSER_TEST, 'n.mjs': NODE_SEES_STUB }, manifest: manifestOf({}) });
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.deepEqual(report.notRun.map(r => [r.file, r.kind, r.reason]), [['tests/b.mjs', 'browser', 'launches the browser the runner hands it']]);
  assert.equal(report.counts.executed, 1);
  assert.equal(report.effective.browser, null);
});

test('the command line reads KAMINOS_BROWSER from the environment', async t => {
  const stub = await browserStub(t);
  const f = await fixture(t, { files: { 'b.mjs': BROWSER_TEST }, manifest: manifestOf({}) });
  const env = cliEnv(f, { KAMINOS_BROWSER: stub });
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { encoding: 'utf8', env });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const report = await readReport(f);
  assert.equal(report.counts.executed, 1);
  assert.equal(report.effective.browser.executable, stub);
});

test('a KAMINOS_BROWSER that is not an executable file is an environment error before any test runs, with the report written', async t => {
  const notExecutable = await browserStub(t, '#!/bin/sh\nexit 0\n', 0o644);
  const f = await fixture(t, { files: { 'b.mjs': BROWSER_TEST, 'n.mjs': NODE_SEES_STUB }, manifest: manifestOf({}) });
  for (const browser of [notExecutable, path.join(f.root, 'no-such-browser'), path.dirname(notExecutable)]) {
    assert.equal((await run(f, { browser })).ok, false, browser);
    const report = await readReport(f);
    assert.equal(report.failurePhase, 'browser', browser);
    assert.match(report.error, /KAMINOS_BROWSER/);
    assert.equal(report.counts.executed, 0);
    assert.deepEqual(report.results, []);
    assert.equal(report.effective.browser.executable, browser);
  }
});

test('a KAMINOS_BROWSER whose --version never answers is recorded without a version instead of stalling the run', async t => {
  const stub = await browserStub(t, '#!/bin/sh\nif [ "$1" = "--version" ]; then exec sleep 600; fi\nenv\n');
  const f = await fixture(t, { files: { 'b.mjs': BROWSER_TEST }, manifest: manifestOf({}) });
  const started = Date.now();
  const result = await run(f, { browser: stub, browserVersionTimeoutMs: 300 });
  const report = await readReport(f);
  assert.ok(Date.now() - started < 60000, 'the run did not wait for the version probe');
  assert.equal(result.ok, true, JSON.stringify(report.results.map(r => [r.file, r.outcome])));
  assert.equal(report.effective.browser.version, null);
  assert.match(report.effective.browser.versionError, /timed out|ETIMEDOUT/);
});
