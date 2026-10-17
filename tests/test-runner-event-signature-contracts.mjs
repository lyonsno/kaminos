// kaminos-test: node
// tools/test-runner.mjs: what a node:test file is signed by, from the
// structured events its reporter writes.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, manifestOf, run, readReport, quarantined } from './test-runner-fixtures.mjs';

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
