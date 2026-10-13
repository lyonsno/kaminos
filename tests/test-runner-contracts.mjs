import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSuite } from '../tools/test-runner.mjs';

const PASS = 'process.exit(0);\n';
const FAIL = "console.error('boom'); process.exit(1);\n";
const HANG = 'setTimeout(() => {}, 60000);\n';

async function fixture(t, { files, manifest, quarantine }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(root, 'tests', name), body);
  const manifestPath = path.join(root, 'tests', 'suite.json');
  const quarantinePath = path.join(root, 'tests', 'quarantine.json');
  if (manifest !== undefined) await fs.writeFile(manifestPath, typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  await fs.writeFile(quarantinePath, JSON.stringify({ schema: 'kaminos.test-quarantine.v1', entries: quarantine || {} }));
  const reportPath = path.join(root, 'out', 'report.json');
  return { root, manifestPath, quarantinePath, reportPath };
}

const manifestOf = tests => ({ schema: 'kaminos.test-suite-manifest.v1', tests });
const run = (f, extra = {}) => runSuite({ root: f.root, manifestPath: f.manifestPath, quarantinePath: f.quarantinePath,
  reportPath: f.reportPath, logsDir: path.join(f.root, 'out', 'logs'), parallel: 2, timeoutMs: 20000, ...extra });
const readReport = async f => JSON.parse(await fs.readFile(f.reportPath, 'utf8'));

test('an unquarantined failure fails the suite and is named as new', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS, 'b.mjs': FAIL },
    manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' }, 'tests/b.mjs': { kind: 'node' } }) });
  const result = await run(f);
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.deepEqual(report.newFailures, ['tests/b.mjs']);
  assert.equal(report.counts.passed, 1);
  assert.equal(report.results.find(r => r.file === 'tests/b.mjs').exitCode, 1);
});

test('a quarantined failure is reported as known and does not fail the suite', async t => {
  const f = await fixture(t, { files: { 'b.mjs': FAIL },
    manifest: manifestOf({ 'tests/b.mjs': { kind: 'node' } }),
    quarantine: { 'tests/b.mjs': { class: 'regression', reason: 'known', owner: 'operlocutor', since: '2026-10-12', signature: 'boom' } } });
  const result = await run(f);
  assert.equal(result.ok, true);
  const report = await readReport(f);
  assert.deepEqual(report.knownFailures, ['tests/b.mjs']);
  assert.deepEqual(report.newFailures, []);
});

test('a quarantined test that now passes fails the suite so the quarantine shrinks', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS },
    manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }),
    quarantine: { 'tests/a.mjs': { class: 'stale-pin', reason: 'was failing', owner: 'operlocutor', since: '2026-10-12', signature: 'boom' } } });
  const result = await run(f);
  assert.equal(result.ok, false);
  assert.deepEqual((await readReport(f)).staleQuarantine, ['tests/a.mjs']);
});

test('an unclassified test file fails the suite instead of being skipped', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS, 'new.mjs': PASS },
    manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const result = await run(f);
  assert.equal(result.ok, false);
  assert.deepEqual((await readReport(f)).unclassified, ['tests/new.mjs']);
});

test('manifest and quarantine entries for missing files fail the suite', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS },
    manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' }, 'tests/gone.mjs': { kind: 'node' } }),
    quarantine: { 'tests/vanished.mjs': { class: 'regression', reason: 'x', owner: 'operlocutor', since: '2026-10-12', signature: 'x' } } });
  const result = await run(f);
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.deepEqual(report.orphans.manifest, ['tests/gone.mjs']);
  assert.deepEqual(report.orphans.quarantine, ['tests/vanished.mjs']);
});

test('non-executed kinds are counted with reasons and never run', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS, 'browser.mjs': FAIL, 'helper.mjs': FAIL },
    manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' },
      'tests/browser.mjs': { kind: 'browser', reason: 'launches Chrome' },
      'tests/helper.mjs': { kind: 'helper', reason: 'imported by tests' } }) });
  const result = await run(f);
  assert.equal(result.ok, true);
  const report = await readReport(f);
  assert.deepEqual(report.notRun.map(r => [r.file, r.kind]), [['tests/browser.mjs', 'browser'], ['tests/helper.mjs', 'helper']]);
  assert.equal(report.counts.executed, 1);
});

test('a hung test times out as its own outcome with the effective timeout recorded', async t => {
  const f = await fixture(t, { files: { 'h.mjs': HANG }, manifest: manifestOf({ 'tests/h.mjs': { kind: 'node' } }) });
  const result = await run(f, { timeoutMs: 400 });
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.equal(report.results[0].outcome, 'timeout');
  assert.equal(report.effective.timeoutMs, 400);
});

test('an unreadable manifest still writes a report naming the failure phase', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: '{not json' });
  const result = await run(f);
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.equal(report.ok, false);
  assert.equal(report.failurePhase, 'load-manifest');
});

test('each executed test keeps its complete output log', async t => {
  const f = await fixture(t, { files: { 'b.mjs': FAIL }, manifest: manifestOf({ 'tests/b.mjs': { kind: 'node' } }) });
  await run(f);
  const entry = (await readReport(f)).results[0];
  assert.match(await fs.readFile(entry.log, 'utf8'), /boom/);
});

// Revision 1: findings from the first independent review and wrong-object assessment.

const OTHER = "console.error('Error: something else broke'); process.exit(1);\n";
const BOOM = "throw new Error('boom');\n";
const quarantined = (signature, extra = {}) => ({ class: 'regression', reason: 'known', owner: 'operlocutor', since: '2026-10-12', signature, ...extra });

test('a quarantined test failing with a different signature is a new failure', async t => {
  const f = await fixture(t, { files: { 'q.mjs': OTHER },
    manifest: manifestOf({ 'tests/q.mjs': { kind: 'node' } }),
    quarantine: { 'tests/q.mjs': quarantined('Error: boom') } });
  const result = await run(f);
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.deepEqual(report.newFailures, ['tests/q.mjs']);
  assert.deepEqual(report.signatureChanged.map(e => [e.file, e.expected, e.actual]), [['tests/q.mjs', 'Error: boom', 'Error: something else broke']]);
});

test('a quarantined test failing with its recorded signature stays known', async t => {
  const f = await fixture(t, { files: { 'q.mjs': BOOM },
    manifest: manifestOf({ 'tests/q.mjs': { kind: 'node' } }),
    quarantine: { 'tests/q.mjs': quarantined('Error: boom') } });
  assert.equal((await run(f)).ok, true);
  assert.deepEqual((await readReport(f)).knownFailures, ['tests/q.mjs']);
});

test('quarantine entries without a signature, class, owner or reason are invalid', async t => {
  const f = await fixture(t, { files: { 'q.mjs': BOOM },
    manifest: manifestOf({ 'tests/q.mjs': { kind: 'node' } }),
    quarantine: { 'tests/q.mjs': { class: 'regression', reason: 'known', owner: 'operlocutor' } } });
  assert.equal((await run(f)).ok, false);
  assert.deepEqual((await readReport(f)).invalidQuarantine, ['tests/q.mjs']);
});

test('a quarantined test that times out or cannot start is never a known failure', async t => {
  const f = await fixture(t, { files: { 'h.mjs': HANG, 'p.py': 'import sys\nsys.exit(1)\n' },
    manifest: manifestOf({ 'tests/h.mjs': { kind: 'node' }, 'tests/p.py': { kind: 'python' } }),
    quarantine: { 'tests/h.mjs': quarantined('Error: boom'), 'tests/p.py': quarantined('exit 1') } });
  const result = await run(f, { timeoutMs: 400, executables: { python: '/nonexistent/python3' } });
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.deepEqual(report.newFailures.sort(), ['tests/h.mjs', 'tests/p.py']);
  assert.equal(report.results.find(r => r.file === 'tests/p.py').outcome, 'spawn-error');
});

test('an in-file kind declaration classifies a test without touching the shared manifest', async t => {
  const f = await fixture(t, { files: {
      'a.mjs': '// kaminos-test: node\nprocess.exit(0);\n',
      'b.mjs': '// kaminos-test: browser — drives Playwright against a served page\nprocess.exit(1);\n',
      'c.py': '# kaminos-test: manual — needs a live page URL\nimport sys\nsys.exit(1)\n' },
    manifest: manifestOf({}) });
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.equal(report.counts.executed, 1);
  assert.deepEqual(report.notRun.map(r => [r.file, r.kind, r.reason]), [
    ['tests/b.mjs', 'browser', 'drives Playwright against a served page'],
    ['tests/c.py', 'manual', 'needs a live page URL']]);
});

test('an in-file declaration that disagrees with the manifest is invalid', async t => {
  const f = await fixture(t, { files: { 'a.mjs': '// kaminos-test: node\nprocess.exit(0);\n' },
    manifest: manifestOf({ 'tests/a.mjs': { kind: 'browser', reason: 'x' } }) });
  assert.equal((await run(f)).ok, false);
  assert.deepEqual((await readReport(f)).invalid, ['tests/a.mjs']);
});

test('selectors that match nothing fail instead of reporting an empty pass', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  assert.equal((await run(f, { only: ['tests/missing.mjs'] })).ok, false);
  assert.deepEqual((await readReport(f)).unmatchedSelectors, ['tests/missing.mjs']);
  assert.equal((await run(f, { kinds: ['nod'] })).ok, false);
  assert.deepEqual((await readReport(f)).unmatchedSelectors, ['kind:nod']);
  const prefixed = await run(f, { only: ['./tests/a.mjs'] });
  assert.equal(prefixed.ok, true);
  assert.equal((await readReport(f)).counts.executed, 1);
});

test('test roots outside tests/ are reported, and fail unless excluded with a reason', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await fs.mkdir(path.join(f.root, 'pkg', 'tests'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'pkg', 'tests', 'x.mjs'), PASS);
  await fs.mkdir(path.join(f.root, 'demo'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'demo', 'y.test.mjs'), PASS);
  assert.equal((await run(f)).ok, false);
  assert.deepEqual((await readReport(f)).uncoveredTestRoots, ['demo/y.test.mjs', 'pkg/tests']);
  await fs.writeFile(f.manifestPath, JSON.stringify({ ...manifestOf({ 'tests/a.mjs': { kind: 'node' } }),
    excludedRoots: { 'pkg/tests': 'runs under the package\'s own npm test', 'demo/y.test.mjs': 'demo-local check' } }));
  assert.equal((await run(f)).ok, true);
  assert.deepEqual((await readReport(f)).excludedRoots.map(e => e.path), ['demo/y.test.mjs', 'pkg/tests']);
});

test('missing declared dependencies fail before any test runs', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ dependencies: { 'not-installed-pkg': '1.0.0' } }));
  assert.equal((await run(f)).ok, false);
  const report = await readReport(f);
  assert.equal(report.failurePhase, 'dependencies');
  assert.deepEqual(report.effective.dependencies.missing, ['not-installed-pkg']);
  assert.equal(report.counts.executed, 0);
});

test('an interrupted run kills running tests and still writes a report', async t => {
  const f = await fixture(t, { files: { 'h.mjs': "require('fs').writeFileSync(process.argv[1] + '.pid', String(process.pid)); setTimeout(() => {}, 60000);\n".replace("require('fs')", "(await import('node:fs'))") },
    manifest: manifestOf({ 'tests/h.mjs': { kind: 'node' } }) });
  const controller = new AbortController();
  const pidPath = path.join(f.root, 'tests', 'h.mjs.pid');
  const started = (async () => {
    for (let i = 0; i < 400; i += 1) {
      try { await fs.access(pidPath); controller.abort(); return; } catch { await new Promise(r => setTimeout(r, 25)); }
    }
    controller.abort();
  })();
  const result = await run(f, { abortSignal: controller.signal });
  await started;
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.equal(report.failurePhase, 'interrupted');
  const pid = Number(await fs.readFile(path.join(f.root, 'tests', 'h.mjs.pid'), 'utf8'));
  await new Promise(r => setTimeout(r, 200));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test('child tests cannot reach an installed GUI Chrome through the usual overrides', async t => {
  const probe = "const v=[process.env.KAMINOS_CHROME,process.env.CHROME_BIN];process.exit(v.every(x=>x&&x.endsWith('browser-launch-stub.sh'))?0:1);\n";
  const f = await fixture(t, { files: { 'e.mjs': probe }, manifest: manifestOf({ 'tests/e.mjs': { kind: 'node' } }) });
  assert.equal((await run(f)).ok, true);
});

test('a command-line argument error still writes a report naming the phase', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const { spawnSync } = await import('node:child_process');
  const cli = new URL('../tools/test-runner.mjs', import.meta.url).pathname;
  const res = spawnSync(process.execPath, [cli, '--root', f.root, '--report', f.reportPath, '--paralel', '2'], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  const report = await readReport(f);
  assert.equal(report.failurePhase, 'arguments');
});

test('an excluded directory covers every test file beneath it', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: {
    ...manifestOf({ 'tests/a.mjs': { kind: 'node' } }), excludedRoots: { demo: 'demo-local suite' } } });
  await fs.mkdir(path.join(f.root, 'demo'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'demo', 'y.test.mjs'), PASS);
  await fs.writeFile(path.join(f.root, 'demo', 'z.test.mjs'), PASS);
  assert.equal((await run(f)).ok, true);
  assert.deepEqual((await readReport(f)).excludedRoots, [{ path: 'demo', reason: 'demo-local suite' }]);
});

test('failure signatures keep the detail that distinguishes generic assertion messages', async () => {
  const { failureSignature } = await import('../tools/test-runner.mjs');
  const strict = 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n\n+ 8421504\n- 1118481\n    at file:///x.mjs:3:1\n';
  assert.equal(failureSignature(strict, { kind: 'node', exitCode: 1 }),
    'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: | + actual - expected | + 8421504 | - 1118481');
  const custom = 'PASS first\nFAIL burner visibility: selectedBedRecipe is not defined\nPASS later\n';
  assert.equal(failureSignature(custom, { kind: 'node', exitCode: 1 }), 'FAIL burner visibility: selectedBedRecipe is not defined');
});

// Revision 2: findings from the confirmation review.

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

test('a non-numeric or non-positive parallel or timeout is an argument error', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  for (const extra of [{ parallel: Number('abc') }, { parallel: 0 }, { timeoutMs: -1 }]) {
    assert.equal((await run(f, extra)).ok, false);
    assert.equal((await readReport(f)).failurePhase, 'arguments');
  }
});

test('a new failing subtest in a quarantined node:test file is a new failure', async t => {
  const body = name => `import test from 'node:test';
test('known broken', () => { throw new Error('known'); });
test('still fine', () => {});
${name ? `test(${JSON.stringify(name)}, () => { throw new TypeError('new'); });` : ''}
`;
  const f = await fixture(t, { files: { 'm.mjs': body(null) }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const signature = (await readReport(f)).results[0].signature;
  assert.equal(signature, 'node:test failing: known broken');
  await fs.writeFile(f.quarantinePath, JSON.stringify({ schema: 'kaminos.test-quarantine.v1', entries: { 'tests/m.mjs': quarantined(signature) } }));
  assert.equal((await run(f)).ok, true);
  await fs.writeFile(path.join(f.root, 'tests', 'm.mjs'), body('injected regression'));
  assert.equal((await run(f)).ok, false);
  assert.deepEqual((await readReport(f)).signatureChanged.map(e => e.actual), ['node:test failing: injected regression | known broken']);
});

test('installed dependency versions must match the lockfile', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ dependencies: { foo: '1.0.0' } }));
  await fs.writeFile(path.join(f.root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3,
    packages: { '': {}, 'node_modules/foo': { version: '1.0.0', integrity: 'sha512-a' } } }));
  await fs.mkdir(path.join(f.root, 'node_modules', 'foo'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'node_modules', 'foo', 'package.json'), JSON.stringify({ name: 'foo', version: '9.9.9' }));
  assert.equal((await run(f)).ok, false);
  const report = await readReport(f);
  assert.equal(report.failurePhase, 'dependencies');
  assert.deepEqual(report.effective.dependencies.mismatched, [{ name: 'foo', locked: '1.0.0', installed: '9.9.9' }]);
  await fs.writeFile(path.join(f.root, 'node_modules', 'foo', 'package.json'), JSON.stringify({ name: 'foo', version: '1.0.0' }));
  assert.equal((await run(f)).ok, true);
});
