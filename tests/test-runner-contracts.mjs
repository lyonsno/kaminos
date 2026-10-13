import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSuite, DEFAULT_NODE_FLAGS } from '../tools/test-runner.mjs';

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
  assert.equal(signature, 'node:test failing: known broken :: Error: known');
  await fs.writeFile(f.quarantinePath, JSON.stringify({ schema: 'kaminos.test-quarantine.v1', entries: { 'tests/m.mjs': quarantined(signature) } }));
  assert.equal((await run(f)).ok, true);
  await fs.writeFile(path.join(f.root, 'tests', 'm.mjs'), body('injected regression'));
  assert.equal((await run(f)).ok, false);
  assert.deepEqual((await readReport(f)).signatureChanged.map(e => e.actual), ['node:test failing: injected regression :: TypeError: new | known broken :: Error: known']);
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

// Revision 3: findings from the second confirmation review.

test('node:test signatures carry each failing subtest with its error, so a new reason in a known subtest is a new failure', async t => {
  const body = reason => `import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
describe('group a', () => { it('rejects invalid input', () => { ${reason}; }); });
describe('group b', () => { it('rejects invalid input', () => {}); });
test('still fine', () => {});
`;
  const f = await fixture(t, { files: { 'm.mjs': body("assert.equal(1, 2, 'known mismatch')") }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const signature = (await readReport(f)).results[0].signature;
  assert.equal(signature, 'node:test failing: group a › rejects invalid input :: AssertionError: known mismatch');
  await fs.writeFile(f.quarantinePath, JSON.stringify({ schema: 'kaminos.test-quarantine.v1', entries: { 'tests/m.mjs': quarantined(signature) } }));
  assert.equal((await run(f)).ok, true);
  await fs.writeFile(path.join(f.root, 'tests', 'm.mjs'), body("throw new TypeError('new reason')"));
  assert.equal((await run(f)).ok, false);
  assert.match((await readReport(f)).signatureChanged[0].actual, /group a › rejects invalid input :: TypeError: new reason/);
});

test('an error outside any subtest in a node:test file joins the signature', async t => {
  const body = `import test from 'node:test';
test('known broken', () => { throw new Error('known'); });
await new Promise(r => setTimeout(r, 20));
throw new Error('top-level after tests started');
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  assert.match((await readReport(f)).results[0].signature, /top-level after tests started/);
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
  const result = await run(f);
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.equal(report.results.find(r => r.file === 'tests/e.mjs').outcome, 'pass');
  assert.deepEqual(report.browserLaunchAttempts.map(a => a.file), ['tests/late.mjs']);
});

test('the dependency check covers the whole lockfile and says when integrity went unverified', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ dependencies: { foo: '1.0.0' } }));
  await fs.writeFile(path.join(f.root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {},
    'node_modules/foo': { version: '1.0.0', integrity: 'sha512-a' }, 'node_modules/bar': { version: '2.0.0', integrity: 'sha512-b' } } }));
  for (const [name, version] of [['foo', '1.0.0'], ['bar', '3.0.0']]) {
    await fs.mkdir(path.join(f.root, 'node_modules', name), { recursive: true });
    await fs.writeFile(path.join(f.root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
  }
  assert.equal((await run(f)).ok, false);
  let report = await readReport(f);
  assert.deepEqual(report.effective.dependencies.mismatched, [{ name: 'bar', locked: '2.0.0', installed: '3.0.0' }]);
  assert.equal(report.effective.dependencies.integrityVerified, false);
  await fs.writeFile(path.join(f.root, 'node_modules', 'bar', 'package.json'), JSON.stringify({ name: 'bar', version: '2.0.0' }));
  assert.equal((await run(f)).ok, true);
  report = await readReport(f);
  assert.equal(report.effective.dependencies.integrityVerified, false);
  assert.deepEqual(report.effective.dependencies.checked, 2);
});

test('a timeout beyond what a timer can hold is an argument error', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  assert.equal((await run(f, { timeoutMs: 3000000000 })).ok, false);
  assert.equal((await readReport(f)).failurePhase, 'arguments');
});

// Structured test events: node:test files are signed from the reporter's
// event stream, not from its human-readable output.

const NODE_TEST_FILE = `import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
describe('group a', () => {
  it('rejects invalid input', () => { assert.equal(1, 2, 'known mismatch'); });
  it('rejects invalid input', () => { throw new Error('dup name'); });
});
describe('vm', () => { it('vm subtest', () => { vm.runInNewContext(process.env.VM_THROW || 'throw new TypeError("bad in vm")'); }); });
describe('hooked', () => { before(() => { throw new Error('hook broke'); }); it('one', () => {}); it('two', () => {}); });
test('still fine', () => {});
`;

test('node:test signatures come from structured events: suite path, error name and message, hook failures, duplicates', async t => {
  const f = await fixture(t, { files: { 'm.mjs': NODE_TEST_FILE }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const r = (await readReport(f)).results[0];
  assert.equal(r.signature, [
    'node:test failing:',
    'group a › rejects invalid input :: AssertionError: known mismatch',
    '| group a › rejects invalid input :: Error: dup name',
    '| hooked :: before hook failed :: Error: hook broke',
    '| vm › vm subtest :: TypeError: bad in vm',
  ].join(' '));
  assert.ok(r.events && (await fs.stat(r.events)).size > 0, 'the events file is kept beside the log');
});

test('a different error at the same vm line changes the signature', async t => {
  const f = await fixture(t, { files: { 'm.mjs': NODE_TEST_FILE }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const before = (await readReport(f)).results[0].signature;
  await fs.writeFile(f.quarantinePath, JSON.stringify({ schema: 'kaminos.test-quarantine.v1', entries: { 'tests/m.mjs': quarantined(before) } }));
  assert.equal((await run(f)).ok, true);
  process.env.VM_THROW = 'throw new ReferenceError("bad in vm")';
  t.after(() => { delete process.env.VM_THROW; });
  assert.equal((await run(f)).ok, false);
  assert.match((await readReport(f)).signatureChanged[0].actual, /vm › vm subtest :: ReferenceError: bad in vm/);
});

test('an error outside any subtest still joins the signature from the events', async t => {
  const body = `import test from 'node:test';
test('known broken', () => { throw new Error('known'); });
await new Promise(r => setTimeout(r, 20));
throw new Error('top-level after tests started');
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const s = (await readReport(f)).results[0].signature;
  assert.match(s, /^node:test failing: known broken :: Error: known \| uncaught :: Error: .*top-level after tests started/);
});

test('a node:test file whose events are missing is a harness defect, never a known failure', async t => {
  const body = `import test from 'node:test';
test('known broken', () => { throw new Error('known'); });
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }),
    quarantine: { 'tests/m.mjs': quarantined('node:test failing: known broken :: Error: known') } });
  assert.equal((await run(f)).ok, true);
  assert.equal((await run(f, { executables: { node: `${process.execPath}` }, nodeFlags: [] })).ok, false);
  const report = await readReport(f);
  assert.notEqual(report.results[0].outcome, 'pass');
  assert.deepEqual(report.knownFailures, []);
  assert.deepEqual(report.newFailures, ['tests/m.mjs']);
});

test('plain scripts are signed from their output as before and are unaffected by the reporter flags', async t => {
  const f = await fixture(t, { files: { 'q.mjs': OTHER, 'p.mjs': PASS }, manifest: manifestOf({ 'tests/q.mjs': { kind: 'node' }, 'tests/p.mjs': { kind: 'node' } }) });
  await run(f);
  const report = await readReport(f);
  assert.equal(report.results.find(r => r.file === 'tests/q.mjs').signature, 'Error: something else broke');
  assert.equal(report.results.find(r => r.file === 'tests/p.mjs').outcome, 'pass');
});

test('the runner works when invoked through a symlinked path', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const link = path.join(f.root, 'tools-link');
  await fs.symlink(path.dirname(new URL('../tools/test-runner.mjs', import.meta.url).pathname), link);
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(process.execPath, [path.join(link, 'test-runner.mjs'), '--root', f.root, '--report', f.reportPath], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal((await readReport(f)).counts.executed, 1);
});

test('a logs path containing a dollar sign still records browser launch attempts', async t => {
  const probe = "import { spawnSync } from 'node:child_process'; process.exit(spawnSync(process.env.KAMINOS_CHROME, ['--headless']).status === 97 ? 0 : 1);\n";
  const f = await fixture(t, { files: { 'e.mjs': probe }, manifest: manifestOf({ 'tests/e.mjs': { kind: 'node' } }) });
  const logsDir = path.join(f.root, 'out', 'logs $HOME `x`');
  assert.equal((await run(f, { logsDir })).ok, false);
  assert.deepEqual((await readReport(f)).browserLaunchAttempts.map(a => a.file), ['tests/e.mjs']);
});

// Structured events, revision 1: findings from the slice's first review.

test('generic assertion messages are signed with the assertion itself, so a different assertion in the same test is a new failure', async t => {
  const body = `import test from 'node:test';
import assert from 'node:assert/strict';
test('counts frames', () => {
  if (process.env.EARLY) assert.equal(0, 99);
  assert.equal(2, 3);
});
test('checks source', () => {
  if (process.env.OTHER_OK) assert.ok(String('x').includes('y')); else assert.ok([].length);
});
test('matches', () => { assert.match('a'.repeat(5000), /never-there/); });
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const base = (await readReport(f)).results[0].signature;
  assert.match(base, /counts frames :: AssertionError: Expected values to be strictly equal: \[strictEqual actual=2 expected=3 #[0-9a-f]{8}\]/);
  assert.match(base, /checks source :: AssertionError: The expression evaluated to a falsy value: \[== assert\.ok\(\[\]\.length\)\]/);
  assert.match(base, /matches :: AssertionError: The input did not match the regular expression \/never-there\/\. Input: \[match expected=\/never-there\/ #[0-9a-f]{8}\]/);
  assert.ok(base.length < 600, 'match assertions must not embed their input');
  await fs.writeFile(f.quarantinePath, JSON.stringify({ schema: 'kaminos.test-quarantine.v1', entries: { 'tests/m.mjs': quarantined(base) } }));
  assert.equal((await run(f)).ok, true);
  for (const [key, value] of [['EARLY', '1'], ['OTHER_OK', '1']]) {
    process.env[key] = value;
    t.after(() => { delete process.env[key]; });
    assert.equal((await run(f)).ok, false, `${key} must change the signature`);
    const changed = (await readReport(f)).signatureChanged[0];
    assert.ok(changed.added.length === 1 && changed.removed.length === 1, 'the change is reported as one entry added and one removed');
    delete process.env[key];
  }
});

test('a forked or worker node:test run cannot stand in for the parent file, and the file is never known', async t => {
  const child = `import test from 'node:test';\ntest('child passes', () => {});\n`;
  const body = `import test, { describe } from 'node:test';
import { fork } from 'node:child_process';
describe('S', () => {
  test('candidate', () => { if (process.env.BREAK) throw new Error('NEW BREAKAGE'); });
  test('forks', async () => { await new Promise((res, rej) => fork('./tests/child.mjs').on('exit', c => (c === 0 ? res() : rej(new Error('child ' + c))))); });
});
test('parent known', () => { throw new Error('known'); });
`;
  const f = await fixture(t, { files: { 'm.mjs': body, 'child.mjs': child },
    manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' }, 'tests/child.mjs': { kind: 'helper', reason: 'forked by m.mjs' } }) });
  await run(f);
  const r = (await readReport(f)).results.find(x => x.file === 'tests/m.mjs');
  assert.equal(r.outcome, 'unsigned-failure', 'a second writer in the events file must not produce a signature');
  await fs.writeFile(f.quarantinePath, JSON.stringify({ schema: 'kaminos.test-quarantine.v1', entries: { 'tests/m.mjs': quarantined('node:test failing: parent known :: Error: known') } }));
  process.env.BREAK = '1'; t.after(() => { delete process.env.BREAK; });
  assert.equal((await run(f)).ok, false);
});

test('a thrown non-error does not break the reporter, and later failures survive', async t => {
  const body = `import test from 'node:test';
test('throws a null-prototype object', () => { throw Object.create(null); });
test('later failure', () => { throw new Error('later'); });
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const r = (await readReport(f)).results[0];
  assert.equal(r.outcome, 'fail');
  assert.match(r.signature, /later failure :: Error: later/);
  assert.match(r.signature, /throws a null-prototype object :: /);
});

test('a plain script that relays a node:test child is signed from its own output, not misclassified', async t => {
  const child = `import test from 'node:test';\ntest('child passes', () => {});\n`;
  const body = `import { spawnSync } from 'node:child_process';
spawnSync(process.execPath, ['./tests/child.mjs'], { stdio: 'inherit' });
console.error('Error: relay then fail');
process.exit(1);
`;
  const f = await fixture(t, { files: { 'p.mjs': body, 'child.mjs': child },
    manifest: manifestOf({ 'tests/p.mjs': { kind: 'node' }, 'tests/child.mjs': { kind: 'helper', reason: 'spawned by p.mjs' } }) });
  await run(f);
  const r = (await readReport(f)).results.find(x => x.file === 'tests/p.mjs');
  assert.equal(r.outcome, 'fail');
  assert.equal(r.signature, 'Error: relay then fail');
});

test('a node:test file whose tests all pass but exits nonzero gets an honest, quarantinable signature', async t => {
  const body = `import test from 'node:test';\ntest('passes', () => {});\nprocess.exitCode = 3;\n`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const r = (await readReport(f)).results[0];
  assert.equal(r.outcome, 'fail');
  assert.equal(r.signature, 'node:test passed; exit 3');
});

test('a node:test file that dies before its summary is unsigned, never known', async t => {
  const body = `import test from 'node:test';\ntest('known broken', () => { throw new Error('known'); });\ntest('exits', () => { process.exit(1); });\n`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }),
    quarantine: { 'tests/m.mjs': quarantined('node:test failing: known broken :: Error: known') } });
  assert.equal((await run(f)).ok, false);
  assert.equal((await readReport(f)).results[0].outcome, 'unsigned-failure');
});

test('a failing root-level after hook is signed with a root-relative path, and failing todo tests are excluded', async t => {
  const body = `import test, { after } from 'node:test';
after(() => { throw new Error('root after broke'); });
test('known broken', () => { throw new Error('known'); });
test('wip', { todo: true }, () => { throw new Error('todo failure'); });
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const s = (await readReport(f)).results[0].signature;
  assert.equal(s, 'node:test failing: <root>/tests/m.mjs :: hook failed :: Error: root after broke | known broken :: Error: known');
});

// Structured events, revision 2: findings from the first confirmation pass.

test('a node:test file that fails while loading is signed from its output and can be quarantined', async t => {
  const f = await fixture(t, { files: {
      'lib.mjs': 'export const present = 1;\n',
      'm.mjs': "import test from 'node:test';\nimport { renamedAway } from './lib.mjs';\ntest('x', () => {});\n",
      'mock-only.mjs': "import { mock } from 'node:test';\nconsole.error('Error: expected one call'); process.exit(1);\n" },
    manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' }, 'tests/mock-only.mjs': { kind: 'node' }, 'tests/lib.mjs': { kind: 'helper', reason: 'imported' } }) });
  await run(f);
  const report = await readReport(f);
  const m = report.results.find(r => r.file === 'tests/m.mjs');
  assert.equal(m.outcome, 'fail');
  assert.match(m.signature, /^SyntaxError: The requested module .* does not provide an export named 'renamedAway'/);
  const mock = report.results.find(r => r.file === 'tests/mock-only.mjs');
  assert.equal(mock.outcome, 'fail');
  assert.equal(mock.signature, 'Error: expected one call');
});

test('the exit marker is recognized after an unterminated output line, and never leaks into a plain signature', async t => {
  const framework = `import test from 'node:test';
test('first', () => { console.log('Error: cache miss logged by code under test'); throw new Error('first'); });
test('second', () => { if (process.env.NEW_BREAK) throw new Error('NEW BREAKAGE'); });
test('third', () => { process.stdout.write('\\rconverting 3/4'); process.exit(1); });
`;
  const plain = "process.stdout.write('FAILED: frame count mismatch'); process.exitCode = 1;\n";
  const f = await fixture(t, { files: { 'm.mjs': framework, 'p.mjs': plain },
    manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' }, 'tests/p.mjs': { kind: 'node' } }) });
  await run(f);
  const report = await readReport(f);
  assert.equal(report.results.find(r => r.file === 'tests/m.mjs').outcome, 'unsigned-failure');
  assert.equal(report.results.find(r => r.file === 'tests/p.mjs').signature, 'FAILED: frame count mismatch');
});

test('a node:test file that exits zero before its summary is not a pass', async t => {
  const body = "import test from 'node:test';\ntest('fails', () => { throw new Error('x'); });\ntest('exits', () => { process.exit(0); });\n";
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  assert.equal((await run(f)).ok, false);
  assert.equal((await readReport(f)).results[0].outcome, 'unsigned-failure');
});

test('assertion details distinguish multi-line assert.ok calls and values that differ past the display bound', async t => {
  const body = `import test from 'node:test';
import assert from 'node:assert/strict';
test('ok', () => {
  if (process.env.SECOND) assert.ok(
    [].length,
  ); else assert.ok(
    ''.length,
  );
});
test('deep', () => { assert.deepEqual([1, 2, 3, 4, 5, process.env.SECOND ? 7 : 6], [1, 2, 3, 4, 5, 0]); });
test('long', () => { assert.equal('x'.repeat(70) + (process.env.SECOND ? 'b' : 'a'), 'y'); });
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const first = (await readReport(f)).results[0].signature;
  process.env.SECOND = '1'; t.after(() => { delete process.env.SECOND; });
  await run(f);
  const second = (await readReport(f)).results[0].signature;
  const entries = s => s.replace('node:test failing: ', '').split(' | ');
  for (const name of ['ok', 'deep', 'long']) {
    assert.notEqual(entries(first).find(e => e.startsWith(`${name} ::`)), entries(second).find(e => e.startsWith(`${name} ::`)), `${name} must sign differently`);
  }
});

test('assertion details never carry absolute paths, stacks or newlines', async t => {
  const body = `import test from 'node:test';
import assert from 'node:assert/strict';
test('throws', () => { assert.throws(() => { throw new Error('a'); }, /b/); });
test('error value', () => { assert.deepEqual({ e: new Error('inner') }, { e: null }); });
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const s = (await readReport(f)).results[0].signature;
  assert.doesNotMatch(s, /\n/);
  assert.doesNotMatch(s, /file:\/\/|\/private\/|\/Users\/|\/tmp\//);
  assert.match(s, /throws :: AssertionError: .*\[throws /);
});

test('an events file holding a bare null record is unsigned, and a test name containing the entry separator keeps one entry', async t => {
  const body = "import test from 'node:test';\ntest('x | y', () => { throw new Error('p'); });\n";
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const r = (await readReport(f)).results[0];
  assert.equal(r.outcome, 'fail');
  const { signatureEntries } = await import('../tools/test-runner.mjs');
  assert.deepEqual(signatureEntries(r.signature), ['x ¦ y :: Error: p']);
  const { nodeTestSignature } = await import('../tools/test-runner.mjs');
  assert.ok(nodeTestSignature('null\n', { childPid: 1, exitCode: 1 }).unsigned);
});

test('compared values keep their identity whatever realm or shape they come from, and Errors inside collections carry no stacks', async t => {
  const body = `import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const v = process.env.SECOND ? 'zzz' : 'aaa';
test('vm map', () => { assert.deepEqual(vm.runInNewContext(\`new Map([['k', '\${v}']])\`), new Map()); });
test('vm date', () => { assert.deepEqual(vm.runInNewContext(process.env.SECOND ? 'new Date(0)' : 'new Date(86400000)'), null); });
test('vm error', () => { assert.deepEqual({ e: vm.runInNewContext(\`new Error('\${v}')\`) }, { e: null }); });
test('url', () => { assert.deepEqual(new URL('https://example.test/' + v), null); });
test('error in map', () => { assert.deepEqual(new Map([['k', new Error(v)]]), new Map()); });
test('getter', () => { assert.deepEqual({ get boom() { throw new Error('getter ' + v); }, v }, null); });
`;
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const first = (await readReport(f)).results[0].signature;
  process.env.SECOND = '1'; t.after(() => { delete process.env.SECOND; });
  await run(f);
  const second = (await readReport(f)).results[0].signature;
  const entries = s => s.replace('node:test failing: ', '').split(' | ');
  for (const name of ['vm map', 'vm date', 'vm error', 'url', 'error in map', 'getter']) {
    const a = entries(first).find(e => e.startsWith(`${name} ::`));
    const b = entries(second).find(e => e.startsWith(`${name} ::`));
    assert.ok(a && b, `${name} must be signed in both runs`);
    assert.notEqual(a, b, `${name} must sign differently`);
    assert.doesNotMatch(a, /actual=\{\}/, `${name} must not erase the actual value`);
    assert.doesNotMatch(a, /reporter-error/, `${name} must keep the assertion`);
  }
  assert.doesNotMatch(first, /\bat (?:\S+ \(|file:|node:|evalmachine|<anonymous>)|node:internal|\.mjs:\d+:\d+/, 'no stack frames anywhere in the signature');
  assert.match(entries(first).find(e => e.startsWith('error in map ::')), /Error: aaa/);
});

test('the started signal does not depend on the chosen reporter, and a script that only imports node:test reporters is a plain script', async t => {
  const script = "import { spec } from 'node:test/reporters';\nconsole.log('uses', typeof spec);\n";
  const framework = "import test from 'node:test';\ntest('fails', () => { throw new Error('x'); });\ntest('exits', () => { process.exit(0); });\n";
  const f = await fixture(t, { files: { 'script.mjs': script, 'm.mjs': framework },
    manifest: manifestOf({ 'tests/script.mjs': { kind: 'node' }, 'tests/m.mjs': { kind: 'node' } }) });
  const tapFlags = DEFAULT_NODE_FLAGS.map(flag => (flag === '--test-reporter=spec' ? '--test-reporter=tap' : flag));
  await run(f, { nodeFlags: tapFlags });
  const results = Object.fromEntries((await readReport(f)).results.map(r => [r.file, r]));
  assert.equal(results['tests/script.mjs'].outcome, 'pass');
  assert.equal(results['tests/m.mjs'].outcome, 'unsigned-failure');
});

test('trusted events that record a failing test outrank a zero exit code', async t => {
  const body = "import test from 'node:test';\nprocess.on('exit', () => { process.exitCode = 0; });\ntest('fails', () => { throw new Error('hidden'); });\n";
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  assert.equal((await run(f)).ok, false);
  const r = (await readReport(f)).results[0];
  assert.equal(r.outcome, 'fail');
  assert.match(r.signature, /^node:test failing: fails :: Error: hidden$/);
});

test('a passing file whose diagnostic begins with Error stays a pass; only failing tests outrank a zero exit', async t => {
  const body = "import test from 'node:test';\ntest('ok', t => { t.diagnostic('Error budget within limits'); });\n";
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  assert.equal((await run(f)).ok, true);
  assert.equal((await readReport(f)).results[0].outcome, 'pass');
});

test('a compared string holding a machine-local path is displayed normalized, not cut before normalization', async t => {
  const body = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('path', () => { assert.equal(process.cwd() + '/tests/fixtures/deep/er/still/deeper/file.json', 'elsewhere'); });\n";
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const s = (await readReport(f)).results[0].signature;
  assert.match(s, /actual='<root>\/tests\/fixtures\/deep\/er\/still\/deeper\/file\.json'/);
  assert.doesNotMatch(s, /\/private\/|\/var\/folders|\/tmp\/|\/Users\//);
});
