// kaminos-test: node
// tools/test-runner.mjs: classification, selection, coverage of test roots,
// arguments, npm dependencies and the command line.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PASS, FAIL, fixture, manifestOf, run, readReport, CLI, cliEnv } from './test-runner-fixtures.mjs';

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
    quarantine: { 'tests/vanished.mjs': { class: 'regression', reason: 'x', owner: 'runner', since: '2026-10-12', signature: 'x' } } });
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

test('an unreadable manifest still writes a report naming the failure phase', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: '{not json' });
  const result = await run(f);
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.equal(report.ok, false);
  assert.equal(report.failurePhase, 'load-manifest');
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

test('a non-numeric or non-positive parallel or timeout is an argument error', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  for (const extra of [{ parallel: Number('abc') }, { parallel: 0 }, { timeoutMs: -1 }]) {
    assert.equal((await run(f, extra)).ok, false);
    assert.equal((await readReport(f)).failurePhase, 'arguments');
  }
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

test('the runner works when invoked through a symlinked path', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const link = path.join(f.root, 'tools-link');
  await fs.symlink(path.dirname(new URL('../tools/test-runner.mjs', import.meta.url).pathname), link);
  const res = spawnSync(process.execPath, [path.join(link, 'test-runner.mjs'), '--root', f.root, '--report', f.reportPath], { encoding: 'utf8', env: cliEnv(f) });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal((await readReport(f)).counts.executed, 1);
});
