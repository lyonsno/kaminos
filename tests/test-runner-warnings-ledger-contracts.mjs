// kaminos-test: node

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { RUN_LEDGER_SCHEMA } from '../tools/test-runner.mjs';
import { PASS, fixture, manifestOf, run, readReport, scopedEnv, CLI, cliEnv, stubPython } from './test-runner-fixtures.mjs';

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

test('the command line appends a start line before it runs and a finish line with what the run did, and names the interpreter on its summary line', async t => {
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
  assert.equal(lines.length, 3, lines.join('\n'));
  assert.equal(lines[0], '{"earlier":"run"}');
  const start = JSON.parse(lines[1]);
  const entry = JSON.parse(lines[2]);
  assert.equal(start.schema, RUN_LEDGER_SCHEMA);
  assert.equal(start.event, 'start');
  assert.equal(start.root, f.root);
  assert.equal(start.branch, 'ledger-branch');
  assert.ok(Number.isInteger(start.pid) && start.pid > 0, String(start.pid));
  assert.deepEqual(start.argv, ['--root', f.root, '--report', f.reportPath, '--only', 'tests/a.mjs']);
  assert.ok(!Number.isNaN(Date.parse(start.timestamp)), start.timestamp);
  assert.equal(entry.schema, RUN_LEDGER_SCHEMA);
  assert.equal(entry.event, 'finish');
  assert.equal(typeof start.runId, 'string');
  assert.equal(entry.runId, start.runId, 'the finish line names the run its start line opened');
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
  const [, entry] = await ledgerLines(defaultLedger);
  assert.equal(JSON.parse(entry).selection, 'full');
  assert.deepEqual(JSON.parse(entry).python, { executable: venvPython, source: 'venv' });
  const off = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { cwd: f.root, encoding: 'utf8', env: cliEnv(f, { KAMINOS_RUN_LEDGER: 'off' }) });
  assert.equal(off.status, 0, off.stdout + off.stderr);
  await assert.rejects(fs.lstat(path.join(f.root, 'off')), { code: 'ENOENT' });
  scopedEnv(t, 'HOME', home);
  scopedEnv(t, 'KAMINOS_RUN_LEDGER', undefined);
  scopedEnv(t, 'KAMINOS_PYTHON', undefined);
  assert.equal((await run(f)).ok, true);
  assert.equal((await ledgerLines(defaultLedger)).length, 2, 'only the first command-line run was recorded, as a start and a finish line');
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

test('a command line with bad arguments records its start and a finish in the arguments phase, and still exits 2', async t => {
  const f = await fixture(t, { files: { 'a.mjs': PASS }, manifest: manifestOf({ 'tests/a.mjs': { kind: 'node' } }) });
  const ledger = path.join(f.root, 'run-ledger.jsonl');
  const res = spawnSync(process.execPath, [CLI, '--root', f.root, '--no-such-flag'], { encoding: 'utf8', env: cliEnv(f) });
  assert.equal(res.status, 2, res.stdout + res.stderr);
  const [start, finish, ...rest] = (await ledgerLines(ledger)).map(line => JSON.parse(line));
  assert.deepEqual(rest, []);
  assert.equal(start.event, 'start');
  assert.equal(start.root, f.root);
  assert.equal(finish.event, 'finish');
  assert.equal(finish.runId, start.runId);
  assert.equal(finish.ok, false);
  assert.equal(finish.failurePhase, 'arguments');
  assert.match(finish.error, /unknown argument --no-such-flag/);
  assert.deepEqual(finish.argv, ['--root', f.root, '--no-such-flag']);
});

test('a run killed with SIGKILL leaves its start line and no finish, so the kill is visible rather than silent', async t => {
  const f = await fixture(t, { files: { 'slow.mjs': "setTimeout(() => {}, 60000);\n" }, manifest: manifestOf({ 'tests/slow.mjs': { kind: 'node' } }) });
  const ledger = path.join(f.root, 'run-ledger.jsonl');
  // Its own process group, so the kill takes the runner and its test together.
  const child = spawn(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { env: cliEnv(f), stdio: 'ignore', detached: true });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  const deadline = Date.now() + 20000;
  let lines = [];
  while (Date.now() < deadline) {
    lines = await ledgerLines(ledger).catch(() => []);
    if (lines.length) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(lines.length, 1, 'the start line is written before the run');
  process.kill(-child.pid, 'SIGKILL');
  assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
  const entries = (await ledgerLines(ledger)).map(line => JSON.parse(line));
  assert.deepEqual(entries.map(e => e.event), ['start']);
  assert.equal(entries[0].pid, child.pid);
  assert.equal(entries[0].root, f.root);
});
