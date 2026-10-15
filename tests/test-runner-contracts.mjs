import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
// Sets (or, with undefined, clears) an environment variable for one test and
// restores whatever the caller exported, so the contracts hold under any env.
const scopedEnv = (t, name, value) => {
  const had = Object.hasOwn(process.env, name), saved = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  t.after(() => { if (had) process.env[name] = saved; else delete process.env[name]; });
};
// The runner's command line, run with HOME and the run ledger inside the
// fixture so no contract ever writes the real ledger, and without an exported
// KAMINOS_PYTHON unless a contract passes one.
const CLI = fileURLToPath(new URL('../tools/test-runner.mjs', import.meta.url));
const cliEnv = (f, extra = {}) => ({ ...process.env, HOME: path.join(f.root, 'home'), KAMINOS_RUN_LEDGER: path.join(f.root, 'run-ledger.jsonl'), KAMINOS_PYTHON: undefined, ...extra });

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
  const res = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath, '--paralel', '2'], { encoding: 'utf8', env: cliEnv(f) });
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
  const res = spawnSync(process.execPath, [path.join(link, 'test-runner.mjs'), '--root', f.root, '--report', f.reportPath], { encoding: 'utf8', env: cliEnv(f) });
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

// Python dependencies: requirements.txt at the root is checked in the
// interpreter the runner uses, before any test runs and whatever tests are
// selected, because Node tests spawn python3 too. What the check finds is a
// warning naming the command that fixes it, written out for the checkout; it
// never fails a run, and the tests run either way.

const PY_PASS = 'import sys\nsys.exit(0)\n';
const ABSENT = 'kaminos-no-such-distribution-xyz';
const pythonWarnings = report => report.warnings.filter(w => w.source === 'python-dependencies');
const venvRemedyFor = root => `uv venv --allow-existing ${path.join(root, '.venv')} && uv pip install --python ${path.join(root, '.venv', 'bin', 'python3')} -r ${path.join(root, 'requirements.txt')}`;

test('a requirements.txt distribution missing from the interpreter is a warning naming it, the executable and the remedy, and the tests still run', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const f = await fixture(t, { files: { 'p.py': PY_PASS, 'a.mjs': PASS },
    manifest: manifestOf({ 'tests/p.py': { kind: 'python' }, 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `# what the suite needs\n${ABSENT}\n`);
  const result = await run(f);
  const report = await readReport(f);
  assert.equal(result.ok, true, report.error);
  assert.equal(report.failurePhase, null);
  assert.equal(report.counts.executed, 2);
  assert.equal(report.counts.passed, 2);
  assert.deepEqual(report.effective.pythonDependencies.missing, [ABSENT]);
  const [warning, ...others] = pythonWarnings(report);
  assert.deepEqual(others, []);
  assert.equal(warning.test, null);
  assert.match(warning.message, new RegExp(ABSENT));
  assert.match(warning.message, /python3/);
  assert.ok(warning.message.includes(venvRemedyFor(f.root)), warning.message);
});

test('the python dependency check runs even when no python test is selected, and only warns', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const f = await fixture(t, { files: { 'p.py': PY_PASS, 'a.mjs': PASS },
    manifest: manifestOf({ 'tests/p.py': { kind: 'python' }, 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `${ABSENT}\n`);
  for (const extra of [{ kinds: ['node'] }, { only: ['tests/a.mjs'] }]) {
    assert.equal((await run(f, extra)).ok, true, JSON.stringify(extra));
    const report = await readReport(f);
    assert.equal(report.failurePhase, null, JSON.stringify(extra));
    assert.equal(report.counts.executed, 1);
    assert.equal(report.effective.pythonDependencies.checked, true);
    assert.deepEqual(report.effective.pythonDependencies.missing, [ABSENT]);
    assert.equal(pythonWarnings(report).length, 1);
  }
});

test('a node test that spawns python3 against a missing distribution runs after the warning and fails as an ordinary test failure', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const spawner = "import { spawnSync } from 'node:child_process';\nprocess.exit(spawnSync('python3', ['-c', 'import kaminos_no_such_distribution_xyz'], { stdio: 'ignore' }).status === 0 ? 0 : 1);\n";
  const f = await fixture(t, { files: { 's.mjs': spawner }, manifest: manifestOf({ 'tests/s.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `${ABSENT}\n`);
  assert.equal((await run(f, { kinds: ['node'] })).ok, false);
  const report = await readReport(f);
  assert.equal(report.failurePhase, null);
  assert.equal(report.counts.executed, 1);
  assert.deepEqual(report.newFailures, ['tests/s.mjs']);
  assert.match(pythonWarnings(report)[0].message, new RegExp(ABSENT));
});

test('a requirements.txt line that is not a bare distribution name is a warning naming the line, and the other lines are still checked', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `numpy>=99\n${ABSENT}\n`);
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.equal(report.failurePhase, null);
  assert.equal(report.counts.executed, 1);
  const deps = report.effective.pythonDependencies;
  assert.deepEqual(deps.invalidLines, [{ line: 1, text: 'numpy>=99' }]);
  assert.deepEqual(deps.declared, [ABSENT]);
  assert.deepEqual(deps.missing, [ABSENT]);
  const messages = pythonWarnings(report).map(w => w.message);
  assert.equal(messages.length, 2, messages.join('\n'));
  assert.ok(messages.some(m => /line 1/.test(m) && m.includes('numpy>=99')), messages.join('\n'));
  assert.ok(messages.some(m => m.includes(ABSENT) && m.includes(venvRemedyFor(f.root))), messages.join('\n'));
});

test('an interpreter that cannot run is a warning naming it and the error, and the run proceeds with the requirements identity recorded', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), 'numpy\n');
  assert.equal((await run(f, { executables: { python: '/nonexistent/python3' } })).ok, true);
  const report = await readReport(f);
  assert.equal(report.failurePhase, null);
  assert.equal(report.counts.executed, 1);
  const [warning] = pythonWarnings(report);
  assert.match(warning.message, /ENOENT/);
  assert.match(warning.message, /\/nonexistent\/python3/);
  const deps = report.effective.pythonDependencies;
  assert.equal(deps.checked, false);
  assert.match(deps.requirementsSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(deps.declared, ['numpy']);
});

test('a requirements.txt whose distributions are installed lets the python test run, with the python version recorded and no warning', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const f = await fixture(t, { files: { 'p.py': PY_PASS }, manifest: manifestOf({ 'tests/p.py': { kind: 'python' } }) });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), 'numpy\n');
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.equal(report.counts.executed, 1);
  assert.equal(report.results[0].outcome, 'pass');
  assert.deepEqual(report.warnings, []);
  const deps = report.effective.pythonDependencies;
  assert.equal(deps.checked, true);
  assert.deepEqual(deps.missing, []);
  assert.match(deps.installed.numpy, /^\d+\./);
  assert.match(deps.python, /^\d+\.\d+/);
  assert.equal(deps.executable, 'python3', 'without a venv or KAMINOS_PYTHON the python3 on the path is used');
  assert.equal(deps.source, 'PATH');
  assert.equal(report.effective.pythonExecutable.pathPrefixed, false);
});

// The declared packages live in a repo-local venv: when <root>/.venv/bin/python3
// resolves to an executable file the runner probes with it and puts its bin
// first on the PATH of every child test, so a node test that spawns a bare
// python3 gets the same one. KAMINOS_PYTHON names an interpreter that wins over
// the venv and reaches child tests through a run-private wrapper.

const FAKE_DIST = 'kaminos-fake-dist';
// A stand-in interpreter. It answers the dependency probe, and answers the
// sys.executable query with a fixed path or, like Python, with the path it was
// run by ($0): a venv interpreter run through a link elsewhere loses its venv.
const stubPython = async (file, { executable = file, installed = { [FAKE_DIST]: '1.0' }, missing = [], selfPath = false } = {}) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const probeAnswer = JSON.stringify({ python: '9.9.9', executable, installed, missing });
  const answer = selfPath ? 'echo "$0"' : `echo ${JSON.stringify(executable)}`;
  await fs.writeFile(file, `#!/bin/sh\ncase "$2" in *print\\(sys.executable\\)*) ${answer};; *) printf '%s\\n' ${JSON.stringify(probeAnswer)};; esac\n`, { mode: 0o755 });
  return file;
};
const PRINTS_EXECUTABLE = `import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const out = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
const expected = join(process.env.KAMINOS_TEST_RUNNER_ROOT, '.venv', 'bin', 'python3');
if (out.stdout.trim() !== expected) { console.error(\`python3 resolved to \${JSON.stringify(out.stdout)} not \${expected}\`); process.exit(1); }
`;
// Spawns a bare python3 and requires it to run as exactly the interpreter
// KAMINOS_EXPECTED_PYTHON names, by that path, without resolving links.
const RUNS_EXPECTED_PYTHON = `import { spawnSync } from 'node:child_process';
const out = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
const got = (out.stdout || '').trim(), want = process.env.KAMINOS_EXPECTED_PYTHON;
if (got !== want) { console.error(\`python3 ran as \${JSON.stringify(got)}, not \${want}\`); process.exit(1); }
`;

test('a repo-local .venv is used for the probe and reaches node tests that spawn python3', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const f = await fixture(t, { files: { 's.mjs': PRINTS_EXECUTABLE }, manifest: manifestOf({ 'tests/s.mjs': { kind: 'node' } }) });
  const venvPython = await stubPython(path.join(f.root, '.venv', 'bin', 'python3'));
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `${FAKE_DIST}\n`);
  const result = await run(f);
  const report = await readReport(f);
  assert.equal(result.ok, true, report.error || JSON.stringify(report.newFailures));
  assert.equal(report.counts.executed, 1);
  assert.equal(report.results[0].outcome, 'pass');
  assert.deepEqual(report.warnings, []);
  const deps = report.effective.pythonDependencies;
  assert.equal(deps.executable, venvPython);
  assert.equal(deps.resolvedExecutable, venvPython);
  assert.equal(deps.source, 'venv');
  assert.deepEqual(deps.installed, { [FAKE_DIST]: '1.0' });
  assert.equal(report.effective.pythonExecutable.resolved, venvPython);
  assert.equal(report.effective.pythonExecutable.pathPrefixed, true);
  assert.equal(report.effective.executables.python, venvPython);
});

test('KAMINOS_PYTHON wins over the repo-local .venv and is recorded', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await stubPython(path.join(f.root, '.venv', 'bin', 'python3'));
  const other = await stubPython(path.join(f.root, 'other', 'python3'));
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `${FAKE_DIST}\n`);
  scopedEnv(t, 'KAMINOS_PYTHON', other);
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.deepEqual(report.warnings, []);
  const deps = report.effective.pythonDependencies;
  assert.equal(deps.executable, other);
  assert.equal(deps.resolvedExecutable, other);
  assert.equal(deps.source, 'KAMINOS_PYTHON');
  assert.equal(report.effective.pythonExecutable.pathPrefixed, true);
});

test('under KAMINOS_PYTHON, node tests that spawn a bare python3 run that interpreter by its own path, through a run-private wrapper', async t => {
  const f = await fixture(t, { files: { 's.mjs': RUNS_EXPECTED_PYTHON }, manifest: manifestOf({ 'tests/s.mjs': { kind: 'node' } }) });
  const chosen = await stubPython(path.join(f.root, 'chosen', 'python-of-choice'), { selfPath: true });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `${FAKE_DIST}\n`);
  scopedEnv(t, 'KAMINOS_PYTHON', chosen);
  scopedEnv(t, 'KAMINOS_EXPECTED_PYTHON', chosen);
  const result = await run(f);
  const report = await readReport(f);
  assert.equal(result.ok, true, report.error || JSON.stringify(report.newFailures));
  assert.equal(report.results[0].outcome, 'pass');
  const chosenPython = report.effective.pythonExecutable;
  assert.equal(chosenPython.source, 'KAMINOS_PYTHON');
  assert.equal(chosenPython.pathPrefixed, true);
  assert.ok(chosenPython.pathPrefix.startsWith(path.join(f.root, 'out', 'logs')), chosenPython.pathPrefix);
  const wrapper = path.join(chosenPython.pathPrefix, 'python3');
  assert.ok((await fs.lstat(wrapper)).isFile(), 'the wrapper is a file, not a link');
  assert.equal(await fs.readFile(wrapper, 'utf8'), `#!/bin/sh\nexec '${chosen}' "$@"\n`);
});

test('a python3 directory left where the run-private wrapper goes is replaced', async t => {
  const f = await fixture(t, { files: { 's.mjs': RUNS_EXPECTED_PYTHON }, manifest: manifestOf({ 'tests/s.mjs': { kind: 'node' } }) });
  const chosen = await stubPython(path.join(f.root, 'chosen', 'python-of-choice'), { selfPath: true });
  await fs.mkdir(path.join(f.root, 'out', 'logs', 'python-bin', 'python3', 'stale'), { recursive: true });
  scopedEnv(t, 'KAMINOS_PYTHON', chosen);
  scopedEnv(t, 'KAMINOS_EXPECTED_PYTHON', chosen);
  const result = await run(f);
  const report = await readReport(f);
  assert.equal(result.ok, true, report.error || JSON.stringify(report.newFailures));
  assert.equal(report.results[0].outcome, 'pass');
  assert.ok((await fs.lstat(path.join(f.root, 'out', 'logs', 'python-bin', 'python3'))).isFile());
});

test('a bare KAMINOS_PYTHON that is not on the path is a warning, and no wrapper or PATH entry is made', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), '# nothing declared yet\n');
  scopedEnv(t, 'KAMINOS_PYTHON', 'kaminos-no-such-python-xyz');
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.equal(report.failurePhase, null);
  const chosenPython = report.effective.pythonExecutable;
  assert.equal(chosenPython.source, 'KAMINOS_PYTHON');
  assert.equal(chosenPython.pathPrefixed, false);
  assert.equal(chosenPython.pathPrefix, null);
  await assert.rejects(fs.lstat(path.join(f.root, 'out', 'logs', 'python-bin', 'python3')), { code: 'ENOENT' });
  const [warning] = pythonWarnings(report);
  assert.match(warning.message, /KAMINOS_PYTHON/);
  assert.match(warning.message, /kaminos-no-such-python-xyz/);
  assert.match(warning.message, /not on PATH/);
});

test('a missing distribution in the repo-local .venv is a warning with a remedy that works over an existing venv, naming the real root', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await stubPython(path.join(f.root, '.venv', 'bin', 'python3'), { installed: {}, missing: [FAKE_DIST] });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `${FAKE_DIST}\n`);
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.equal(report.failurePhase, null);
  const [warning] = pythonWarnings(report);
  assert.match(warning.message, new RegExp(FAKE_DIST));
  assert.ok(warning.message.includes(venvRemedyFor(f.root)), warning.message);
  assert.doesNotMatch(warning.message, /<root>/);
});

test('under KAMINOS_PYTHON a missing distribution is a warning to install into that interpreter, not the repo venv', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const chosen = await stubPython(path.join(f.root, 'other', 'python3'), { installed: {}, missing: [FAKE_DIST] });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), `${FAKE_DIST}\n`);
  scopedEnv(t, 'KAMINOS_PYTHON', chosen);
  assert.equal((await run(f)).ok, true);
  const [warning] = pythonWarnings(await readReport(f));
  assert.match(warning.message, new RegExp(FAKE_DIST));
  assert.ok(warning.message.includes(`uv pip install --python ${chosen} -r ${path.join(f.root, 'requirements.txt')}`), warning.message);
  assert.doesNotMatch(warning.message, /uv venv|--allow-existing/);
});

test('a dangling .venv/bin/python3 is a warning naming the venv, and the run falls back to the python3 on the path', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const venvPython = path.join(f.root, '.venv', 'bin', 'python3');
  await fs.mkdir(path.dirname(venvPython), { recursive: true });
  await fs.symlink(path.join(f.root, 'gone', 'python3.12'), venvPython);
  await fs.writeFile(path.join(f.root, 'requirements.txt'), '# nothing declared yet\n');
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.equal(report.failurePhase, null);
  assert.equal(report.counts.executed, 1);
  const chosenPython = report.effective.pythonExecutable;
  assert.equal(chosenPython.source, 'PATH');
  assert.equal(chosenPython.resolved, 'python3');
  assert.equal(chosenPython.pathPrefixed, false);
  const [warning] = pythonWarnings(report);
  assert.ok(warning.message.includes(venvPython), warning.message);
  assert.match(warning.message, /link to nothing/);
  assert.ok(warning.message.includes(venvRemedyFor(f.root)), warning.message);
});

test('a .venv/bin/python3 that links to itself is named as a symlink loop', async t => {
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const venvPython = path.join(f.root, '.venv', 'bin', 'python3');
  await fs.mkdir(path.dirname(venvPython), { recursive: true });
  await fs.symlink('python3', venvPython);
  assert.equal((await run(f)).ok, true);
  const report = await readReport(f);
  assert.equal(report.effective.pythonExecutable.source, 'PATH');
  const [warning] = pythonWarnings(report);
  assert.ok(warning.message.includes(venvPython), warning.message);
  assert.match(warning.message, /symlink loop/);
});

test('a probe that raises is reported by its exception line in a warning, with the stderr tail kept', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const raising = path.join(f.root, 'raising-python3');
  await fs.writeFile(raising, "#!/bin/sh\nprintf 'Traceback (most recent call last):\\n  File \"<string>\", line 1, in <module>\\nModuleNotFoundError: No module named importlib.metadata\\n' >&2\nexit 1\n", { mode: 0o755 });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), 'numpy\n');
  assert.equal((await run(f, { executables: { python: raising } })).ok, true);
  const report = await readReport(f);
  assert.equal(report.failurePhase, null);
  assert.match(pythonWarnings(report)[0].message, /ModuleNotFoundError: No module named importlib\.metadata/);
  assert.match(report.effective.pythonDependencies.stderrTail, /^Traceback \(most recent call last\):/);
});

test('an interpreter that dies while starting is reported by its error line, not the trailing frame marker, with the remedy', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const fatal = path.join(f.root, 'fatal-python3');
  await fs.writeFile(fatal, "#!/bin/sh\nprintf 'Fatal Python error: init_fs_encoding: failed to get the Python codec of the filesystem encoding\\nPython runtime state: core initialized\\nModuleNotFoundError: No module named encodings\\n\\nCurrent thread 0x00000001 (most recent call first):\\n  <no Python frame>\\n' >&2\nexit 1\n", { mode: 0o755 });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), 'numpy\n');
  assert.equal((await run(f, { executables: { python: fatal } })).ok, true);
  const [warning] = pythonWarnings(await readReport(f));
  assert.match(warning.message, /ModuleNotFoundError: No module named encodings/);
  assert.doesNotMatch(warning.message, /<no Python frame>/);
  assert.match(warning.message, /--allow-existing/);
});

test('a requirements.txt that declares nothing skips the probe instead of spawning python', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  await fs.writeFile(path.join(f.root, 'requirements.txt'), '# nothing yet\n\n');
  assert.equal((await run(f, { executables: { python: '/nonexistent/python3' } })).ok, true);
  const report = await readReport(f);
  const deps = report.effective.pythonDependencies;
  assert.equal(deps.checked, false);
  assert.match(deps.skipped, /declares nothing/);
  assert.deepEqual(deps.declared, []);
  assert.deepEqual(report.warnings, []);
});

// Warnings: a test reports something worth fixing that should not fail the
// run by writing a line that begins `kaminos-test-warning: ` to stdout or
// stderr. The runner collects it with the test's file, prints it once in the
// summary after the counts, and keeps it out of failure signatures.

test('a passing test that prints a warning line passes, and the warning reaches the report and, once, the summary', async t => {
  const plain = "console.log('kaminos-test-warning: plain script warns');\nconsole.log('kaminos-test-warning: plain script warns');\n";
  const framework = "import test from 'node:test';\ntest('warns', () => { console.error('kaminos-test-warning: node:test file warns'); });\n";
  const f = await fixture(t, { files: { 'w.mjs': plain, 'n.mjs': framework },
    manifest: manifestOf({ 'tests/w.mjs': { kind: 'node' }, 'tests/n.mjs': { kind: 'node' } }) });
  const res = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { encoding: 'utf8', env: cliEnv(f) });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const report = await readReport(f);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings, [
    { source: 'test', test: 'tests/n.mjs', message: 'node:test file warns' },
    { source: 'test', test: 'tests/w.mjs', message: 'plain script warns' },
  ]);
  const lines = res.stdout.split('\n');
  assert.match(lines[0], /^OK {2}executed 2/);
  assert.equal(lines[1], 'warnings:', res.stdout);
  const section = lines.slice(2, lines.findIndex((line, i) => i > 1 && !line.startsWith('  ')));
  assert.deepEqual(section, ['  tests/n.mjs: node:test file warns', '  tests/w.mjs: plain script warns']);
});

test("a failing test's warning lines stay out of its failure signature, for a plain script and a node:test file", async t => {
  const plain = "process.stdout.write('frame count mismatch\\nkaminos-test-warning: cache was cold\\n');\nprocess.exitCode = 1;\n";
  const loading = "import 'node:test';\nprocess.stdout.write('fixture missing\\nkaminos-test-warning: cache was cold\\n');\nprocess.exitCode = 1;\n";
  const framework = "import test from 'node:test';\ntest('breaks', () => { console.log('kaminos-test-warning: cache was cold'); throw new Error('boom'); });\n";
  const f = await fixture(t, { files: { 'p.mjs': plain, 'l.mjs': loading, 'm.mjs': framework },
    manifest: manifestOf({ 'tests/p.mjs': { kind: 'node' }, 'tests/l.mjs': { kind: 'node' }, 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const report = await readReport(f);
  const signature = file => report.results.find(r => r.file === file).signature;
  assert.equal(signature('tests/p.mjs'), 'frame count mismatch');
  assert.equal(signature('tests/l.mjs'), 'fixture missing');
  assert.equal(signature('tests/m.mjs'), 'node:test failing: breaks :: Error: boom');
  assert.deepEqual(report.warnings.map(w => [w.test, w.message]),
    [['tests/l.mjs', 'cache was cold'], ['tests/m.mjs', 'cache was cold'], ['tests/p.mjs', 'cache was cold']]);
});

// The run ledger: the command line, never runSuite, appends one JSON line per
// run, so how the suite behaves in real work is recorded rather than inferred.
// Every command-line run in these contracts points HOME and KAMINOS_RUN_LEDGER
// at the fixture, so none writes the real ledger.

const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
const ledgerLines = async file => (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean);

test('the command line appends one line per run to the run ledger with what the run did, and names the interpreter on its summary line', async t => {
  const f = await fixture(t, { files: { 'a.mjs': "console.log('kaminos-test-warning: first line of a warning');\n", 'b.mjs': PASS },
    manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' }, 'tests/b.mjs': { kind: 'node' } }) });
  assert.equal(git(f.root, 'init', '-q', '-b', 'ledger-branch').status, 0);
  assert.equal(git(f.root, 'commit', '-q', '--allow-empty', '-m', 'fixture').status, 0);
  const head = git(f.root, 'rev-parse', 'HEAD').stdout.trim();
  const ledger = path.join(f.root, 'run-ledger.jsonl');
  await fs.writeFile(ledger, '{"earlier":"run"}\n');
  const res = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath, '--only', 'tests/a.mjs'], { encoding: 'utf8', env: cliEnv(f) });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const lines = await ledgerLines(ledger);
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.equal(lines[0], '{"earlier":"run"}');
  const entry = JSON.parse(lines[1]);
  assert.ok(!Number.isNaN(Date.parse(entry.timestamp)), entry.timestamp);
  assert.equal(entry.root, f.root);
  assert.equal(entry.branch, 'ledger-branch');
  assert.equal(entry.head, head);
  assert.deepEqual(entry.selection, ['tests/a.mjs']);
  assert.equal(entry.ok, true);
  assert.deepEqual(entry.counts, (await readReport(f)).counts);
  assert.deepEqual(entry.warnings, [{ source: 'test', test: 'tests/a.mjs', firstLine: 'first line of a warning' }]);
  assert.equal(entry.python.source, 'PATH');
  assert.match(entry.python.executable, /python3$/);
  assert.ok(Number.isInteger(entry.durationMs) && entry.durationMs >= 0, String(entry.durationMs));
  assert.ok(res.stdout.split('\n')[0].endsWith(`; python ${entry.python.executable} (PATH)`), res.stdout);
});

test('without KAMINOS_RUN_LEDGER the ledger goes under HOME with its directory created; off writes nothing; runSuite never writes one', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const venvPython = await stubPython(path.join(f.root, '.venv', 'bin', 'python3'));
  const home = path.join(f.root, 'home');
  const defaultLedger = path.join(home, '.local', 'state', 'kaminos', 'test-runs.jsonl');
  const first = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { cwd: f.root, encoding: 'utf8', env: cliEnv(f, { KAMINOS_RUN_LEDGER: undefined }) });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.ok(first.stdout.split('\n')[0].endsWith(`; python ${venvPython} (venv)`), first.stdout);
  const [entry] = await ledgerLines(defaultLedger);
  assert.equal(JSON.parse(entry).selection, 'full');
  assert.deepEqual(JSON.parse(entry).python, { executable: venvPython, source: 'venv' });
  const off = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { cwd: f.root, encoding: 'utf8', env: cliEnv(f, { KAMINOS_RUN_LEDGER: 'off' }) });
  assert.equal(off.status, 0, off.stdout + off.stderr);
  await assert.rejects(fs.lstat(path.join(f.root, 'off')), { code: 'ENOENT' });
  scopedEnv(t, 'HOME', home);
  scopedEnv(t, 'KAMINOS_RUN_LEDGER', undefined);
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  assert.equal((await run(f)).ok, true);
  assert.equal((await ledgerLines(defaultLedger)).length, 1, 'only the first command-line run was recorded');
});

test('a run ledger that cannot be written is a warning, never a failure', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const chosen = await stubPython(path.join(f.root, 'chosen', 'python3'));
  const blocker = path.join(f.root, 'not-a-directory');
  await fs.writeFile(blocker, '');
  const res = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath],
    { encoding: 'utf8', env: cliEnv(f, { KAMINOS_RUN_LEDGER: path.join(blocker, 'ledger.jsonl'), KAMINOS_PYTHON: chosen }) });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const lines = res.stdout.split('\n');
  assert.ok(lines[0].endsWith(`; python ${chosen} (KAMINOS_PYTHON)`), res.stdout);
  assert.equal(lines[1], 'warnings:', res.stdout);
  assert.match(lines[2], /^ {2}run-ledger: could not append this run to .*not-a-directory/);
  const report = await readReport(f);
  assert.equal(report.ok, true);
  assert.equal(report.warnings.filter(w => w.source === 'run-ledger').length, 1);
});
