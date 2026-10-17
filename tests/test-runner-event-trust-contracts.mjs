// kaminos-test: node
// tools/test-runner.mjs: when a node:test file's events can be trusted, and
// what its outcome is when they cannot.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { DEFAULT_NODE_FLAGS } from '../tools/test-runner.mjs';
import { fixture, manifestOf, run, readReport, quarantined } from './test-runner-fixtures.mjs';

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

test('a node:test file that exits zero before its summary is not a pass', async t => {
  const body = "import test from 'node:test';\ntest('fails', () => { throw new Error('x'); });\ntest('exits', () => { process.exit(0); });\n";
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  assert.equal((await run(f)).ok, false);
  assert.equal((await readReport(f)).results[0].outcome, 'unsigned-failure');
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
