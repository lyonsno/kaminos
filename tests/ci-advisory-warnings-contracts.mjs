// kaminos-test: node
// Contracts for tools/ci-advisory-warnings.mjs, which turns the suite report of
// the advisory tests workflow into warning annotations. A run that stays green
// must never be silent about a problem the runner itself would call a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { advisoryWarnings, advisoryVerdict, parseSetup } from '../tools/ci-advisory-warnings.mjs';

const clean = () => ({
  ok: true, counts: { executed: 2, passed: 2, knownFailures: 0, newFailures: 0, notRun: 0 },
  results: [], newFailures: [], signatureChanged: [], staleQuarantine: [], unclassified: [], invalid: [],
  invalidQuarantine: [], unmatchedSelectors: [], browserLaunchAttempts: [], uncoveredTestRoots: [],
  orphans: { manifest: [], quarantine: [] },
});
const ran = { serve: 'success', suite: 'success' };

test('a clean report and successful steps give no warnings', () => {
  assert.deepEqual(advisoryWarnings({ report: clean(), ...ran }), []);
});

test('a crash in a runner phase is a warning naming the phase and the first error line', () => {
  const report = { ...clean(), ok: false, failurePhase: 'discover', error: 'Error: boom\n    at x' };
  const w = advisoryWarnings({ report, serve: 'success', suite: 'failure' });
  assert.ok(w.some(l => l.includes('discover') && l.includes('Error: boom') && !l.includes('at x')), w.join('\n'));
});

test('every category the runner fails on is warned about', () => {
  const report = { ...clean(), ok: false,
    newFailures: ['tests/a.mjs'], staleQuarantine: ['tests/b.mjs'], unclassified: ['tests/c.mjs'],
    invalid: ['tests/d.mjs'], invalidQuarantine: ['tests/e.mjs'], unmatchedSelectors: ['nope'],
    browserLaunchAttempts: [{ file: 'tests/f.mjs', args: '--x' }], uncoveredTestRoots: ['scripts/tests'],
    orphans: { manifest: ['tests/g.mjs'], quarantine: ['tests/h.mjs'] } };
  const text = advisoryWarnings({ report, serve: 'success', suite: 'failure' }).join('\n');
  for (const item of ['tests/a.mjs', 'tests/b.mjs', 'tests/c.mjs', 'tests/d.mjs', 'tests/e.mjs', 'nope', 'tests/f.mjs', 'scripts/tests', 'tests/g.mjs', 'tests/h.mjs']) {
    assert.ok(text.includes(item), `missing ${item}:\n${text}`);
  }
});

test('a failed suite step with nothing else to say still warns', () => {
  const w = advisoryWarnings({ report: clean(), serve: 'success', suite: 'failure' });
  assert.equal(w.length, 1);
  assert.match(w[0], /suite step failure/);
});

test('no report, and steps that never ran, say so instead of blaming the step', () => {
  assert.deepEqual(advisoryWarnings({ report: null, serve: 'skipped', suite: 'skipped' }),
    ['serve.py check did not run (an earlier step failed)', 'suite did not run (an earlier step failed)']);
  const w = advisoryWarnings({ report: null, serve: 'failure', suite: 'failure' });
  assert.deepEqual(w, ['serve.py did not answer within 10 s', 'no suite report (suite step failure)']);
});

test('runner warnings are passed on when the report carries them, one line each', () => {
  const report = { ...clean(), warnings: [{ message: 'pillow missing\nsecond line' }, 'plain'] };
  assert.deepEqual(advisoryWarnings({ report, ...ran }), ['warning: pillow missing second line', 'warning: plain']);
});

test('a field of the wrong shape is a warning, not a crash', () => {
  const report = { ...clean(), ok: false, newFailures: { a: 1 } };
  const w = advisoryWarnings({ report, serve: 'success', suite: 'failure' });
  assert.ok(w.some(l => l.includes('newFailures') && l.includes('not a list')), w.join('\n'));
});

test('a report that is not ok still warns when the suite step succeeded', () => {
  const w = advisoryWarnings({ report: { ...clean(), ok: false }, ...ran });
  assert.equal(w.length, 1);
  assert.match(w[0], /not ok/);
});

test('a carriage return never survives into a warning line', () => {
  const report = { ...clean(), ok: false, failurePhase: 'execute', error: 'bad\rinjected' };
  for (const line of advisoryWarnings({ report, serve: 'success', suite: 'failure' })) assert.ok(!/[\r\n]/.test(line), JSON.stringify(line));
});

test('a cancelled step is named as cancelled', () => {
  assert.deepEqual(advisoryWarnings({ report: null, serve: 'cancelled', suite: 'cancelled' }),
    ['serve.py check was cancelled', 'suite was cancelled']);
});

test('a failure counted as new is warned once, not again as unsigned or changed', () => {
  const report = { ...clean(), ok: false, newFailures: ['tests/a.mjs'],
    results: [{ file: 'tests/a.mjs', outcome: 'unsigned-failure' }], signatureChanged: [{ file: 'tests/a.mjs' }] };
  assert.deepEqual(advisoryWarnings({ report, serve: 'success', suite: 'failure' }), ['new failure: tests/a.mjs']);
});

test('a failed setup step is a warning naming it, and says nothing after it was checked', () => {
  const w = advisoryWarnings({ report: null, serve: 'skipped', suite: 'skipped', setup: { checkout: 'success', node: 'success', python: 'success', pip: 'failure', npm: 'success' } });
  assert.equal(w[0], 'setup step pip failed, so the suite was not run and nothing was checked');
  assert.ok(w.includes('suite did not run (an earlier step failed)'), w.join('\n'));
});

test('setup outcomes parse from the workflow argument, and all-success adds nothing', () => {
  assert.deepEqual(parseSetup('checkout=success node=success pip=failure'), { checkout: 'success', node: 'success', pip: 'failure' });
  assert.deepEqual(advisoryWarnings({ report: clean(), ...ran, setup: parseSetup('checkout=success npm=success') }), []);
});

test('entries that are not objects do not crash the warnings', () => {
  const report = { ...clean(), ok: false, browserLaunchAttempts: [null], signatureChanged: [null], results: [null] };
  const w = advisoryWarnings({ report, serve: 'success', suite: 'failure' });
  assert.ok(w.some(l => l.startsWith('browser launch reached by a test:')), w.join('\n'));
});

// A pass must be visible as such: one verdict notice per run, so a lane reads
// "clean" rather than inferring it from the absence of warnings.
test('the verdict is clean for a complete ok report with nothing to warn about', () => {
  assert.equal(advisoryVerdict({ report: clean(), ...ran }), 'tests clean: executed 2, passed 2, known failures 0, new failures 0');
});

test('a runner failure, a report that is not ok, or a failed suite step makes the verdict not clean', () => {
  assert.match(advisoryVerdict({ report: { ...clean(), unclassified: ['tests/c.mjs'], ok: false }, serve: 'success', suite: 'failure' }), /^tests not clean: 1 problem/);
  assert.match(advisoryVerdict({ report: { ...clean(), ok: false }, ...ran }), /^tests not clean/);
});

test('no report, a skipped or cancelled suite, or a superseded commit is no result, never clean', () => {
  assert.match(advisoryVerdict({ report: null, serve: 'failure', suite: 'failure' }), /^tests no result: /);
  assert.match(advisoryVerdict({ report: null, serve: 'skipped', suite: 'skipped', setup: { npm: 'failure' } }), /^tests no result: /);
  assert.match(advisoryVerdict({ report: null, serve: 'skipped', suite: 'skipped', superseded: 'abc1234' }), /^tests no result: superseded by abc1234/);
  assert.deepEqual(advisoryWarnings({ report: null, serve: 'skipped', suite: 'skipped', superseded: 'abc1234' }), []);
});

// Warnings never refuse: an ok report whose only findings are warnings (the
// runner's own, or a serve.py startup miss) passes, and says how many warnings
// to read. Only what the runner itself counts as a failure is not clean.
test('an ok report with only warnings passes with warnings, which is landable', () => {
  const report = { ...clean(), warnings: [{ source: 'test', message: 'index.html unresolved name x' }] };
  assert.equal(advisoryVerdict({ report, ...ran }), 'tests passed with warnings: 1 warning to read; executed 2, passed 2, known failures 0, new failures 0');
  assert.match(advisoryVerdict({ report: clean(), serve: 'failure', suite: 'success' }), /^tests passed with warnings: 1 warning/);
});

test('a report claiming ok without whole counts, or with nothing executed, is no result', () => {
  assert.match(advisoryVerdict({ report: { ...clean(), counts: undefined }, ...ran }), /^tests no result: /);
  assert.match(advisoryVerdict({ report: { ...clean(), counts: { executed: 0, passed: 0, knownFailures: 0, newFailures: 0, notRun: 0 } }, ...ran }), /^tests no result: /);
});

test('a malformed report never reads clean: warnings that are not a list, or counts that do not add up', () => {
  assert.doesNotMatch(advisoryVerdict({ report: { ...clean(), warnings: 'x' }, ...ran }), /^tests clean/);
  assert.match(advisoryVerdict({ report: { ...clean(), counts: { executed: 576, passed: 10, knownFailures: 0, newFailures: 0, notRun: 0 } }, ...ran }), /^tests no result: /);
  assert.match(advisoryVerdict({ report: { ...clean(), counts: { executed: -1, passed: -1, knownFailures: 0, newFailures: 0, notRun: 0 } }, ...ran }), /^tests no result: /);
});
