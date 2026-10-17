// tools/test-runner.mjs: test outcomes, timeouts, logs and the quarantine of
// known failures. The other themes live in tests/test-runner-*-contracts.mjs,
// with shared fixtures in tests/test-runner-fixtures.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PASS, FAIL, HANG, fixture, manifestOf, run, readReport, OTHER, quarantined } from './test-runner-fixtures.mjs';

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

test('a hung test times out as its own outcome with the effective timeout recorded', async t => {
  const f = await fixture(t, { files: { 'h.mjs': HANG }, manifest: manifestOf({ 'tests/h.mjs': { kind: 'node' } }) });
  const result = await run(f, { timeoutMs: 400 });
  assert.equal(result.ok, false);
  const report = await readReport(f);
  assert.equal(report.results[0].outcome, 'timeout');
  assert.equal(report.effective.timeoutMs, 400);
});

test('each executed test keeps its complete output log', async t => {
  const f = await fixture(t, { files: { 'b.mjs': FAIL }, manifest: manifestOf({ 'tests/b.mjs': { kind: 'node' } }) });
  await run(f);
  const entry = (await readReport(f)).results[0];
  assert.match(await fs.readFile(entry.log, 'utf8'), /boom/);
});

const BOOM = "throw new Error('boom');\n";

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
