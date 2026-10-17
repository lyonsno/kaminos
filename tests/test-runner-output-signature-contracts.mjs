// kaminos-test: node
// tools/test-runner.mjs: signatures from test output and from assertion
// details, stable across checkouts and runs.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { PASS, fixture, manifestOf, run, readReport, OTHER, quarantined } from './test-runner-fixtures.mjs';

test('failure signatures keep the detail that distinguishes generic assertion messages', async () => {
  const { failureSignature } = await import('../tools/test-runner.mjs');
  const strict = 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n\n+ 8421504\n- 1118481\n    at file:///x.mjs:3:1\n';
  assert.equal(failureSignature(strict, { kind: 'node', exitCode: 1 }),
    'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: | + actual - expected | + 8421504 | - 1118481');
  const custom = 'PASS first\nFAIL burner visibility: selectedBedRecipe is not defined\nPASS later\n';
  assert.equal(failureSignature(custom, { kind: 'node', exitCode: 1 }), 'FAIL burner visibility: selectedBedRecipe is not defined');
});

test('plain scripts are signed from their output as before and are unaffected by the reporter flags', async t => {
  const f = await fixture(t, { files: { 'q.mjs': OTHER, 'p.mjs': PASS }, manifest: manifestOf({ 'tests/q.mjs': { kind: 'node' }, 'tests/p.mjs': { kind: 'node' } }) });
  await run(f);
  const report = await readReport(f);
  assert.equal(report.results.find(r => r.file === 'tests/q.mjs').signature, 'Error: something else broke');
  assert.equal(report.results.find(r => r.file === 'tests/p.mjs').outcome, 'pass');
});

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

test('a compared string holding a machine-local path is displayed normalized, not cut before normalization', async t => {
  const body = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('path', () => { assert.equal(process.cwd() + '/tests/fixtures/deep/er/still/deeper/file.json', 'elsewhere'); });\n";
  const f = await fixture(t, { files: { 'm.mjs': body }, manifest: manifestOf({ 'tests/m.mjs': { kind: 'node' } }) });
  await run(f);
  const s = (await readReport(f)).results[0].signature;
  assert.match(s, /actual='<root>\/tests\/fixtures\/deep\/er\/still\/deeper\/file\.json'/);
  assert.doesNotMatch(s, /\/private\/|\/var\/folders|\/tmp\/|\/Users\//);
});
