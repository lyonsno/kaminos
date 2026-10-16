// kaminos-test: node

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PASS, fixture, manifestOf, run, readReport, scopedEnv, FAKE_DIST, stubPython } from './test-runner-fixtures.mjs';

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
