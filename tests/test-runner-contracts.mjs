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
    quarantine: { 'tests/b.mjs': { class: 'regression', reason: 'known', owner: 'operlocutor', since: '2026-10-12' } } });
  const result = await run(f);
  assert.equal(result.ok, true);
  const report = await readReport(f);
  assert.deepEqual(report.knownFailures, ['tests/b.mjs']);
  assert.deepEqual(report.newFailures, []);
});

test('a quarantined test that now passes fails the suite so the quarantine shrinks', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS },
    manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }),
    quarantine: { 'tests/a.mjs': { class: 'stale-pin', reason: 'was failing', owner: 'operlocutor', since: '2026-10-12' } } });
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
    quarantine: { 'tests/vanished.mjs': { class: 'regression', reason: 'x', owner: 'operlocutor', since: '2026-10-12' } } });
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
