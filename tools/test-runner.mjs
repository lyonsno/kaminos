#!/usr/bin/env node
// Kaminos test runner.
//
// Every top-level .mjs and .py file under tests/ must be classified, either by
// a first-line declaration in the file itself
//   // kaminos-test: node
//   // kaminos-test: browser — reason
//   # kaminos-test: manual — reason
// or by an entry in tests/suite.json. Kinds `node` and `python` execute;
// `browser`, `helper` and `manual` are counted with their reason and never run.
//
// A failure is known only when the file is quarantined and fails with exactly
// its recorded signature. Everything else fails the run: new failures, changed
// signatures, timeouts, tests that cannot start, unclassified files, invalid or
// orphaned entries, quarantined tests that now pass, selectors that match
// nothing, missing declared dependencies (npm or Python), and test roots elsewhere in the
// repository that are neither covered nor excluded with a reason. A report is
// written for every invocation, including interrupted ones.

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SUITE_MANIFEST_SCHEMA = 'kaminos.test-suite-manifest.v1';
export const QUARANTINE_SCHEMA = 'kaminos.test-quarantine.v1';
export const REPORT_SCHEMA = 'kaminos.test-run-report.v1';
export const KNOWN_KINDS = new Set(['node', 'python', 'browser', 'helper', 'manual']);
export const EXECUTED_KINDS = new Set(['node', 'python']);
export const QUARANTINE_CLASSES = new Set(['untriaged', 'regression', 'stale-pin', 'environment', 'harness-defect']);
export const BROWSER_OVERRIDES = ['KAMINOS_CHROME', 'CHROME_BIN', 'CHROME', 'KAMINOS_SHARP_WEBGPU_CHROME'];
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const LATE_LAUNCH_SETTLE_MS = 2000;
const EXIT_MARKER = /\n?kaminos-test-exit pid=(\d+) tid=(\d+) framework=(yes|no) tests=(started|not-started) code=(-?\d+)\n?/g;
const ENTRY_SEPARATOR = ' | ';
// node:test files run with the spec reporter on stdout for the log and this
// module's reporter writing structured events beside it. Signatures for such
// files come from the events, never from the human-readable output.
export const EVENTS_REPORTER_PATH = fileURLToPath(new URL('./test-events-reporter.mjs', import.meta.url));
export const EXIT_MARKER_PATH = fileURLToPath(new URL('./test-exit-marker.mjs', import.meta.url));
export const DEFAULT_NODE_FLAGS = Object.freeze([`--import=${pathToFileURL(EXIT_MARKER_PATH).href}`, '--test-reporter=spec', '--test-reporter-destination=stdout', `--test-reporter=${pathToFileURL(EVENTS_REPORTER_PATH).href}`]);
const DEFAULT_TIMEOUT_MS = 600000;
const DECLARATION = /^\s*(?:\/\/|#)\s*kaminos-test:\s*([a-z]+)\s*(?:[—–-]+\s*(.+?))?\s*$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'artifacts', 'lib', 'scratch', 'scenes', 'fixtures']);

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const posix = p => p.split(path.sep).join('/');

async function readJson(file, schema, phase) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (error) { throw Object.assign(error, { phase }); }
  let document;
  try { document = JSON.parse(text); } catch (error) { throw Object.assign(new Error(`${file}: ${error.message}`), { phase }); }
  if (document?.schema !== schema) throw Object.assign(new Error(`${file}: schema must be ${schema}, got ${document?.schema}`), { phase });
  return { document, sha256: sha256(text) };
}

async function discover(root) {
  const entries = await fs.readdir(path.join(root, 'tests'), { withFileTypes: true });
  return entries.filter(e => e.isFile() && /\.(mjs|py)$/.test(e.name)).map(e => `tests/${e.name}`).sort();
}

// Test roots elsewhere in the repository: directories named tests or test, and
// *.test.{mjs,js} files outside such directories.
export async function discoverOtherTestRoots(root) {
  const found = [];
  async function walk(rel) {
    let entries;
    try { entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        if (entry.name === 'tests' || entry.name === 'test') { if (child !== 'tests') found.push(child); continue; }
        await walk(child);
      } else if (/\.test\.(mjs|js)$/.test(entry.name)) {
        found.push(child);
      }
    }
  }
  await walk('');
  return found.sort();
}

async function readDeclaration(root, file) {
  const handle = await fs.open(path.join(root, file), 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(512), 0, 512, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
    const match = firstLine.match(DECLARATION);
    return match ? { kind: match[1], reason: match[2] || null, source: 'declaration' } : null;
  } finally { await handle.close(); }
}

function gitIdentity(root) {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
    return { head, dirty };
  } catch { return { head: null, dirty: null }; }
}

function executableVersion(executable, args) {
  try { return execFileSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

async function checkDependencies(root) {
  const manifestPath = path.join(root, 'package.json');
  if (!existsSync(manifestPath)) return { declared: [], missing: [], mismatched: [], installed: {}, checked: 0, integrityVerified: false, lockfileSha256: null };
  const pkg = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const declared = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).sort();
  const missing = declared.filter(name => !existsSync(path.join(root, 'node_modules', name, 'package.json')));
  const lockPath = path.join(root, 'package-lock.json');
  const lock = existsSync(lockPath) ? JSON.parse(await fs.readFile(lockPath, 'utf8')) : null;
  const hiddenPath = path.join(root, 'node_modules', '.package-lock.json');
  const hidden = existsSync(hiddenPath) ? JSON.parse(await fs.readFile(hiddenPath, 'utf8')) : null;
  const installed = {};
  const mismatched = [];
  let checked = 0;
  const entries = Object.entries(lock?.packages || {}).filter(([key]) => key.startsWith('node_modules/'));
  for (const [key, locked] of entries) {
    const name = key.replace(/^node_modules\//, '');
    const manifest = path.join(root, key, 'package.json');
    if (!existsSync(manifest)) { if (!missing.includes(name) && !locked.optional && !locked.dev) missing.push(name); continue; }
    checked += 1;
    const version = JSON.parse(await fs.readFile(manifest, 'utf8')).version;
    installed[name] = version;
    if (locked?.version && locked.version !== version) { mismatched.push({ name, locked: locked.version, installed: version }); continue; }
    const placed = hidden?.packages?.[key];
    for (const field of ['resolved', 'integrity']) {
      if (locked?.[field] && placed?.[field] && locked[field] !== placed[field]) mismatched.push({ name, field, locked: locked[field], installed: placed[field] });
    }
  }
  return { declared, missing: missing.sort(), mismatched, installed, checked, integrityVerified: Boolean(hidden),
    lockfileSha256: existsSync(lockPath) ? sha256(await fs.readFile(lockPath)) : null };
}

// Which python the runner uses, in order: an explicit executables.python
// from a programmatic caller, KAMINOS_PYTHON, <root>/.venv/bin/python3 (the
// declared packages live in a repo-local venv), then the python3 on PATH.
// With the venv, its bin goes first on the PATH of every child test, so Node
// tests that spawn a bare python3 get the interpreter the probe checked.
function resolvePython(root, explicit, env) {
  if (explicit) return { requested: explicit, resolved: explicit, source: 'executables', pathPrefixed: false, pathPrefix: null };
  if (env.KAMINOS_PYTHON) return { requested: 'KAMINOS_PYTHON', resolved: env.KAMINOS_PYTHON, source: 'KAMINOS_PYTHON', pathPrefixed: false, pathPrefix: null };
  const venvBin = path.join(root, '.venv', 'bin');
  const venvPython = path.join(venvBin, 'python3');
  if (existsSync(venvPython)) return { requested: 'python3', resolved: venvPython, source: 'venv', pathPrefixed: true, pathPrefix: venvBin };
  return { requested: 'python3', resolved: 'python3', source: 'path', pathPrefixed: false, pathPrefix: null };
}

const PYTHON_REMEDY = 'uv venv .venv && uv pip install -r requirements.txt (or python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt); the runner prefers <root>/.venv when present';

// Python distributions the suite needs, from requirements.txt at the root:
// one bare distribution name per line, comments and blank lines allowed,
// nothing else. Whenever the file declares anything they are checked before
// anything runs, whatever tests are selected, in the runner's python with
// one importlib.metadata call by distribution name (pillow, not PIL): Node
// tests spawn python3 too, so a narrowed run must refuse as well. Installed
// means the package metadata is recorded, not that the package imports.
const DISTRIBUTION_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const PYTHON_DEPENDENCY_PROBE = [
  'import importlib.metadata as m, json, sys',
  'out = {"python": sys.version.split()[0], "executable": sys.executable, "installed": {}, "missing": []}',
  'for name in sys.argv[1:]:',
  '    try: out["installed"][name] = m.version(name)',
  '    except m.PackageNotFoundError: out["missing"].append(name)',
  'print(json.dumps(out))',
].join('\n');
const PYTHON_PROBE_TIMEOUT_MS = 60000;

async function readRequirements(root, python) {
  const result = { checked: false, skipped: null, requirementsPath: null, requirementsSha256: null, executable: python.resolved, source: python.source, pathPrefixed: python.pathPrefixed, resolvedExecutable: null, python: null, declared: [], invalidLines: [], installed: {}, missing: [], stderrTail: null };
  const requirementsPath = path.join(root, 'requirements.txt');
  if (!existsSync(requirementsPath)) { result.skipped = 'no requirements.txt'; return result; }
  const text = await fs.readFile(requirementsPath, 'utf8');
  Object.assign(result, { requirementsPath, requirementsSha256: sha256(text) });
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    if (DISTRIBUTION_NAME.test(line)) result.declared.push(line);
    else result.invalidLines.push({ line: index + 1, text: raw.trim() });
  });
  return result;
}

// Fills in the probe's answer, or throws in the python-dependencies phase
// when the executable cannot run it; the requirements identity read above
// is already in the report either way.
function probePythonDependencies(result) {
  let probe;
  try {
    probe = JSON.parse(execFileSync(result.executable, ['-c', PYTHON_DEPENDENCY_PROBE, ...result.declared], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: PYTHON_PROBE_TIMEOUT_MS }));
  } catch (error) {
    // The last stderr line is the raised exception; the first is only
    // "Traceback (most recent call last):".
    const stderrLines = String(error?.stderr || '').split('\n').map(line => line.trimEnd()).filter(line => line.trim());
    result.stderrTail = stderrLines.length ? stderrLines.slice(-20).join('\n') : null;
    const detail = [error?.code, stderrLines.at(-1) || firstLine(error?.message || error)].filter(Boolean).join(': ');
    throw Object.assign(new Error(`could not check requirements.txt with ${result.executable} (${detail})`), { phase: 'python-dependencies' });
  }
  Object.assign(result, { checked: true, resolvedExecutable: probe.executable, python: probe.python, installed: probe.installed, missing: probe.missing });
}

// The failure signature: the first error-shaped line for Node, the last for
// Python (the raised exception), otherwise the last output line, otherwise
// the exit status. Machine-local paths are normalized so signatures compare
// across checkouts.
export function failureSignature(output, { root, kind, exitCode }) {
  let text = output;
  if (root) text = text.split(root).join('<root>');
  text = text.split(os.homedir()).join('~');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const isError = l => /^(?:[A-Za-z_.]*(?:Error|Exception))(?:\s*\[[A-Z_]+\])?:/.test(l) || /^FAIL\b/.test(l);
  const indexes = lines.map((l, i) => (isError(l) ? i : -1)).filter(i => i >= 0);
  if (!indexes.length) return lines.length ? lines.at(-1) : `exit ${exitCode}`;
  const at = kind === 'python' ? indexes.at(-1) : indexes[0];
  // A generic message ending in a colon carries its distinguishing detail on
  // the following lines; keep up to four of them, stopping at the stack.
  if (!lines[at].endsWith(':')) return lines[at];
  const detail = [];
  for (let i = at + 1; i < lines.length && detail.length < 4; i += 1) {
    if (/^at\s/.test(lines[i]) || isError(lines[i])) break;
    detail.push(lines[i]);
  }
  return [lines[at], ...detail].join(' | ');
}

function normalizeText(text, root) {
  let out = String(text);
  if (root) {
    let real = null;
    try { real = realpathSync(root); } catch { real = null; }
    if (real && real !== root) out = out.split(real).join('<root>');
    out = out.split(root).join('<root>');
  }
  return out.split(os.homedir()).join('~');
}

// Build a node:test file's signature from the structured events its reporter
// wrote, after checking that the file is whole: one header from the process
// the runner spawned, every line from that process and parsable, and the
// summary present. Anything else means the events cannot be trusted, and the
// file is unsigned rather than signed by whatever survived. Each failing test
// contributes its suite path and the thrown error's name and first message
// line, plus the assertion itself when Node generated the message; a failed
// hook contributes the hook and its error; errors the test runner caught
// outside any test contribute as uncaught. Suites that only failed because
// their children did, children cancelled because a hook failed, and todo or
// skipped tests add nothing. A file whose tests all passed but which exited
// nonzero is signed by that exit.
export function nodeTestSignature(eventsText, { root, childPid, exitCode } = {}) {
  const records = [];
  for (const line of String(eventsText).split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { return { signature: null, unsigned: 'the events file holds unparsable lines; another process may have written into it' }; }
    if (!record || typeof record !== 'object') return { signature: null, unsigned: 'the events file holds a record that is not an object' };
    records.push(record);
  }
  const headers = records.filter(r => r.kind === 'header');
  if (headers.length !== 1) return { signature: null, unsigned: `expected one header record, found ${headers.length}` };
  if (childPid && headers[0].pid !== childPid) return { signature: null, unsigned: `events were written by process ${headers[0].pid}, not the spawned test ${childPid}` };
  if (headers[0].tid !== 0) return { signature: null, unsigned: 'events were written from a worker thread' };
  if (records.some(r => r.pid !== headers[0].pid || r.tid !== headers[0].tid)) return { signature: null, unsigned: 'events from more than one process or thread' };
  if (!records.some(r => r.kind === 'summary' && /^tests \d+$/.test(r.message || ''))) return { signature: null, unsigned: 'no summary record; the file ended before its tests finished' };
  const entries = [];
  for (const event of records) {
    if (event.kind === 'uncaught') { entries.push(`uncaught :: ${firstLine(normalizeText(event.message, root))}`); continue; }
    if (event.kind !== 'fail') continue;
    if (event.todo || event.skip) continue;
    if (event.failureType === 'subtestsFailed' || event.failureType === 'cancelledByParent') continue;
    const path = normalizeText(event.path, root).split(ENTRY_SEPARATOR).join(' ¦ ');
    const error = describeEventError(event.error, root);
    if (event.failureType === 'hookFailed') {
      const hook = String(event.wrapper || '').match(/failed running (\w+) hook/);
      entries.push(`${path} :: ${hook ? `${hook[1]} hook failed` : 'hook failed'} :: ${error}`);
      continue;
    }
    entries.push(`${path} :: ${error}`);
  }
  if (!entries.length) return { signature: `node:test passed; exit ${exitCode}`, unsigned: null };
  return { signature: `node:test failing: ${entries.sort().join(ENTRY_SEPARATOR)}`, unsigned: null };
}

function describeEventError(error, root) {
  if (!error) return 'no error';
  const head = `${error.name || 'Error'}: ${firstLine(normalizeText(error.message, root))}`;
  return error.detail ? `${head} [${firstLine(normalizeText(error.detail, root))}]` : head;
}

// Entries of a node:test signature, for reporting what changed.
export function signatureEntries(signature) {
  if (typeof signature !== 'string' || !signature.startsWith('node:test failing: ')) return null;
  return signature.slice('node:test failing: '.length).split(ENTRY_SEPARATOR);
}

function firstLine(text) {
  return String(text).split('\n').map(l => l.trim()).find(Boolean) || '';
}

function runOne({ root, file, kind, executable, timeoutMs, logsDir, env: baseEnv, track, nodeFlags }) {
  const env = { ...baseEnv, KAMINOS_TEST_RUNNER_TEST: file, KAMINOS_TEST_RUNNER_ROOT: root };
  const eventsPath = path.join(logsDir, `${file.replace(/[\/]/g, '__')}.events.jsonl`);
  const flags = kind === 'node' ? [...nodeFlags] : [];
  const withReporter = flags.some(f => f.startsWith('--test-reporter=') && f.includes('test-events-reporter'));
  if (withReporter) flags.push(`--test-reporter-destination=${eventsPath}`);
  const started = Date.now();
  const logPath = path.join(logsDir, `${file.replace(/[\/]/g, '__')}.log`);
  return new Promise(async resolve => {
    // A stale events file from an earlier run must never stand in for this one.
    try { await fs.rm(eventsPath, { force: true }); } catch (error) {
      return resolve({ file, kind, executable, durationMs: 0, log: null, events: null, signature: null, outcome: 'spawn-error', exitCode: null, signal: null, spawnError: String(error?.message || error) });
    }
    const chunks = [];
    let spawnError = null;
    let timedOut = false;
    const finish = async fields => {
      await fs.writeFile(logPath, Buffer.concat(chunks));
      const output = Buffer.concat(chunks).toString('utf8');
      let events = null;
      try { events = await fs.readFile(eventsPath, 'utf8'); } catch { events = null; }
      let signature = null;
      let unsigned = null;
      let outcome = fields.outcome;
      // The preload's exit line, from the spawned process itself, says
      // whether the test harness started running tests here; a relayed
      // child's line carries that child's pid and is ignored. A file that
      // only imported the framework, or failed while loading, is a plain
      // script for signing purposes.
      const markers = [...output.matchAll(EXIT_MARKER)];
      const testsStarted = Boolean(child?.pid) && markers.some(m => Number(m[1]) === child.pid && Number(m[2]) === 0 && m[4] === 'started');
      if (outcome === 'fail') {
        if (testsStarted) {
          ({ signature, unsigned } = nodeTestSignature(events ?? '', { root, childPid: child?.pid, exitCode: fields.exitCode }));
          if (events === null) unsigned = 'tests started but no events were written; the process ended before they were flushed';
          if (unsigned) { outcome = 'unsigned-failure'; signature = null; }
        } else {
          signature = failureSignature(output.replace(EXIT_MARKER, '\n'), { root, kind, exitCode: fields.exitCode });
        }
      } else if (outcome === 'pass' && testsStarted) {
        // Exiting zero before the summary is not a pass; nothing says the
        // tests finished. Trusted events that record a failing test outrank
        // the exit code too: an exit handler can reset it. Diagnostics the
        // reporter took for uncaught errors do not, on their own: a test may
        // emit a diagnostic that begins with Error and still pass.
        const check = nodeTestSignature(events ?? '', { root, childPid: child?.pid, exitCode: fields.exitCode });
        if (events === null || check.unsigned) { outcome = 'unsigned-failure'; unsigned = events === null ? 'tests started, the process exited zero, and no events were written' : check.unsigned; }
        else if (signatureEntries(check.signature)?.some(e => !e.startsWith('uncaught :: '))) { outcome = 'fail'; signature = check.signature; }
      }
      resolve({ file, kind, executable, durationMs: Date.now() - started, log: logPath, events: events !== null ? eventsPath : null, signature, ...fields, outcome,
        ...(unsigned ? { unsigned } : {}) });
    };
    let child;
    try {
      child = spawn(executable, [...flags, file], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env });
    } catch (error) {
      chunks.push(Buffer.from(String(error?.stack || error)));
      return finish({ outcome: 'spawn-error', exitCode: null, signal: null });
    }
    const untrack = track(child);
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs);
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => chunks.push(d));
    child.on('error', error => { spawnError = error; chunks.push(Buffer.from(String(error?.stack || error))); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      untrack();
      const outcome = spawnError ? 'spawn-error'
        : timedOut ? 'timeout'
        : exitCode === 0 ? 'pass'
        : exitCode === null ? 'killed'
        : 'fail';
      finish({ outcome, exitCode, signal });
    });
  });
}

async function pool(items, parallel, worker, aborted) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, items.length)) }, async () => {
    while (next < items.length && !aborted()) { const index = next++; results[index] = await worker(items[index]); }
  }));
  return results.filter(Boolean);
}

function normalizeSelector(file) {
  return posix(path.normalize(file)).replace(/^\.\//, '');
}

export async function runSuite({
  root = process.cwd(),
  manifestPath,
  quarantinePath,
  reportPath,
  logsDir,
  parallel = Math.max(1, Math.floor(os.availableParallelism() / 2)),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  kinds = ['node', 'python'],
  only = null,
  executables = {},
  nodeFlags = DEFAULT_NODE_FLAGS,
  abortSignal = null,
} = {}) {
  root = path.resolve(root);
  manifestPath ||= path.join(root, 'tests', 'suite.json');
  quarantinePath ||= path.join(root, 'tests', 'quarantine.json');
  if (!reportPath) throw new Error('reportPath is required');
  logsDir = logsDir || path.join(path.dirname(reportPath), 'logs');
  // NODE_TEST_CONTEXT would switch child node:test files to the binary
  // protocol used between a parent `node --test` and its children.
  const { NODE_TEST_CONTEXT: _parentTestContext, ...inheritedEnv } = process.env;
  const pythonExecutable = resolvePython(root, executables.python, inheritedEnv);
  const resolvedExecutables = { node: process.execPath, ...executables, python: pythonExecutable.resolved };
  const browserLog = path.join(logsDir, 'browser-launch-attempts.tsv');
  // A per-run stub with the log path baked in, so a child that scrubs its
  // environment still records the attempt when it reaches the stub.
  const browserStub = path.join(logsDir, 'browser-launch-stub.sh');
  const childPath = pythonExecutable.pathPrefixed ? [pythonExecutable.pathPrefix, inheritedEnv.PATH].filter(Boolean).join(path.delimiter) : inheritedEnv.PATH;
  const childEnv = { ...inheritedEnv, ...(childPath === undefined ? {} : { PATH: childPath }), ...Object.fromEntries(BROWSER_OVERRIDES.map(k => [k, browserStub])), KAMINOS_TEST_RUNNER_BROWSER_LOG: browserLog };
  const report = {
    schema: REPORT_SCHEMA, ok: false, failurePhase: null, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
    effective: { root, manifestPath, quarantinePath, parallel, timeoutMs, kinds, only,
      executables: resolvedExecutables, nodeFlags: [...nodeFlags], node: process.version, python: null,
      pythonExecutable: { requested: pythonExecutable.requested, resolved: pythonExecutable.resolved, source: pythonExecutable.source, pathPrefixed: pythonExecutable.pathPrefixed, pathPrefix: pythonExecutable.pathPrefix },
      platform: `${process.platform}-${process.arch}`, git: gitIdentity(root),
      browserStub: { path: browserStub, overrides: BROWSER_OVERRIDES, log: browserLog },
      manifestSha256: null, quarantineSha256: null, dependencies: null, pythonDependencies: null },
    counts: { discovered: 0, executed: 0, passed: 0, knownFailures: 0, newFailures: 0, notRun: 0 },
    newFailures: [], knownFailures: [], signatureChanged: [], staleQuarantine: [],
    unclassified: [], invalid: [], invalidQuarantine: [], unmatchedSelectors: [],
    uncoveredTestRoots: [], excludedRoots: [], browserLaunchAttempts: [],
    orphans: { manifest: [], quarantine: [] }, notRun: [], results: [],
  };
  const running = new Set();
  const track = child => { running.add(child); return () => running.delete(child); };
  const killAll = () => { for (const child of running) { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } } };
  let interrupted = false;
  const onAbort = () => { interrupted = true; killAll(); };
  if (abortSignal) { if (abortSignal.aborted) onAbort(); else abortSignal.addEventListener('abort', onAbort, { once: true }); }
  const write = async () => {
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { ok: report.ok, report, reportPath };
  };
  try {
    report.failurePhase = 'arguments';
    if (!Number.isInteger(parallel) || parallel < 1) throw Object.assign(new Error(`parallel must be a positive integer, got ${parallel}`), { phase: 'arguments' });
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) throw Object.assign(new Error(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}, got ${timeoutMs}`), { phase: 'arguments' });
    report.failurePhase = 'load-manifest';
    const manifest = await readJson(manifestPath, SUITE_MANIFEST_SCHEMA, 'load-manifest');
    report.effective.manifestSha256 = manifest.sha256;
    report.failurePhase = 'load-quarantine';
    const quarantine = await readJson(quarantinePath, QUARANTINE_SCHEMA, 'load-quarantine');
    report.effective.quarantineSha256 = quarantine.sha256;

    report.failurePhase = 'dependencies';
    report.effective.dependencies = await checkDependencies(root);
    const { missing, mismatched } = report.effective.dependencies;
    if (missing.length || mismatched.length) {
      throw Object.assign(new Error(`installed dependencies do not match package-lock.json (missing: ${missing.join(', ') || 'none'}; mismatched: ${mismatched.map(m => m.name).join(', ') || 'none'}). Run npm ci.`), { phase: 'dependencies' });
    }

    report.failurePhase = 'python-dependencies';
    const pythonDependencies = await readRequirements(root, pythonExecutable);
    report.effective.pythonDependencies = pythonDependencies;
    if (pythonDependencies.requirementsPath) {
      if (pythonDependencies.invalidLines.length) {
        const lines = pythonDependencies.invalidLines.map(l => `line ${l.line}: ${l.text}`).join('; ');
        throw Object.assign(new Error(`requirements.txt must hold bare distribution names, one per line, with comments and blank lines, and nothing else; not ${lines}`), { phase: 'python-dependencies' });
      }
      if (!pythonDependencies.declared.length) pythonDependencies.skipped = 'requirements.txt declares nothing';
      else {
        probePythonDependencies(pythonDependencies);
        if (pythonDependencies.missing.length) {
          throw Object.assign(new Error(`python distributions listed in requirements.txt are not installed in ${resolvedExecutables.python}${pythonDependencies.resolvedExecutable && pythonDependencies.resolvedExecutable !== resolvedExecutables.python ? ` (${pythonDependencies.resolvedExecutable})` : ''}: ${pythonDependencies.missing.join(', ')}. Install them in a repo-local venv: ${PYTHON_REMEDY}.`), { phase: 'python-dependencies' });
        }
      }
    }

    report.failurePhase = 'discover';
    if (kinds.includes('python')) report.effective.python = executableVersion(resolvedExecutables.python, ['--version']);
    const files = await discover(root);
    const fileSet = new Set(files);
    const tests = manifest.document.tests || {};
    const quarantined = quarantine.document.entries || {};
    report.counts.discovered = files.length;

    const excluded = Object.entries(manifest.document.excludedRoots || {})
      .filter(([, reason]) => typeof reason === 'string' && reason.trim());
    const covering = found => excluded.find(([key]) => found === key || found.startsWith(`${key}/`));
    const usedExclusions = new Set();
    for (const found of await discoverOtherTestRoots(root)) {
      const match = covering(found);
      if (match) usedExclusions.add(match[0]);
      else report.uncoveredTestRoots.push(found);
    }
    report.excludedRoots = excluded.filter(([key]) => usedExclusions.has(key)).map(([key, reason]) => ({ path: key, reason }))
      .sort((a, b) => a.path.localeCompare(b.path));

    const classification = new Map();
    for (const file of files) {
      const declared = await readDeclaration(root, file);
      const listed = tests[file] ? { ...tests[file], source: 'manifest' } : null;
      const entry = declared || listed;
      if (!entry) { report.unclassified.push(file); continue; }
      const conflict = declared && listed && listed.kind !== declared.kind;
      const badKind = !KNOWN_KINDS.has(entry.kind);
      const missingReason = !EXECUTED_KINDS.has(entry.kind) && !entry.reason;
      if (conflict || badKind || missingReason) { report.invalid.push(file); continue; }
      classification.set(file, entry);
    }
    report.orphans.manifest = Object.keys(tests).filter(f => !fileSet.has(f)).sort();
    report.orphans.quarantine = Object.keys(quarantined).filter(f => !fileSet.has(f)).sort();
    report.invalidQuarantine = Object.entries(quarantined).filter(([, e]) =>
      !e || !QUARANTINE_CLASSES.has(e.class) || !e.owner || !e.reason || typeof e.signature !== 'string' || !e.signature.trim(),
    ).map(([file]) => file).sort();

    for (const kind of kinds) if (!KNOWN_KINDS.has(kind)) report.unmatchedSelectors.push(`kind:${kind}`);
    const onlySet = only ? new Set(only.map(normalizeSelector)) : null;
    if (onlySet) for (const selector of onlySet) if (!classification.has(selector)) report.unmatchedSelectors.push(selector);

    const planned = [];
    for (const [file, entry] of classification) {
      if (onlySet && !onlySet.has(file)) continue;
      if (EXECUTED_KINDS.has(entry.kind) && kinds.includes(entry.kind)) planned.push({ file, kind: entry.kind, executable: resolvedExecutables[entry.kind] });
      else report.notRun.push({ file, kind: entry.kind, reason: entry.reason || `kind ${entry.kind} not selected`, source: entry.source });
    }
    report.counts.notRun = report.notRun.length;
    if (!planned.length && !report.unmatchedSelectors.length) report.unmatchedSelectors.push('empty-plan');

    report.failurePhase = 'execute';
    await fs.mkdir(logsDir, { recursive: true });
    await fs.rm(browserLog, { force: true });
    const quotedLog = `'${browserLog.replace(/'/g, `'\\''`)}'`;
    await fs.writeFile(browserStub, `#!/bin/sh\n# Stands in for a browser while tools/test-runner.mjs runs tests. Any test\n# that reaches a browser launch lands here: record it and fail.\nprintf '%s\\t%s\\t%s\\n' "\${KAMINOS_TEST_RUNNER_TEST:-unknown}" "$$" "$*" >> ${quotedLog}\necho "browser launch blocked by tools/test-runner.mjs" >&2\nexit 97\n`);
    await fs.chmod(browserStub, 0o755);
    report.results = await pool(planned, parallel,
      item => runOne({ root, ...item, timeoutMs, logsDir, env: childEnv, track, nodeFlags }), () => interrupted);
    if (interrupted) throw Object.assign(new Error('run interrupted'), { phase: 'interrupted' });

    report.counts.executed = report.results.length;
    if (report.results.length !== planned.length) throw Object.assign(new Error(`planned ${planned.length} tests but ran ${report.results.length}`), { phase: 'execute' });
    // A test can hand off a browser launch to a detached process that fires
    // after the test exits; give such launches a moment to reach the stub.
    await new Promise(r => setTimeout(r, LATE_LAUNCH_SETTLE_MS));
    if (existsSync(browserLog)) {
      report.browserLaunchAttempts = (await fs.readFile(browserLog, 'utf8')).trim().split('\n').filter(Boolean)
        .map(line => { const [file, pid, args] = line.split('\t'); return { file, pid: Number(pid), args }; });
    }
    const invalidQuarantine = new Set(report.invalidQuarantine);
    for (const result of report.results) {
      const entry = quarantined[result.file];
      if (result.outcome === 'pass') {
        report.counts.passed += 1;
        if (entry) report.staleQuarantine.push(result.file);
      } else if (entry && !invalidQuarantine.has(result.file) && result.outcome === 'fail' && result.signature === entry.signature) {
        report.knownFailures.push(result.file);
      } else {
        report.newFailures.push(result.file);
        if (entry && result.outcome === 'fail' && result.signature !== entry.signature) {
          const was = signatureEntries(entry.signature); const now = signatureEntries(result.signature);
          const diff = was && now ? { added: now.filter(e => !was.includes(e)), removed: was.filter(e => !now.includes(e)) } : {};
          report.signatureChanged.push({ file: result.file, expected: entry.signature, actual: result.signature, ...diff });
        }
      }
    }
    report.counts.knownFailures = report.knownFailures.length;
    report.counts.newFailures = report.newFailures.length;
    report.failurePhase = null;
    report.ok = report.newFailures.length === 0 && report.staleQuarantine.length === 0
      && report.unclassified.length === 0 && report.invalid.length === 0 && report.invalidQuarantine.length === 0
      && report.unmatchedSelectors.length === 0 && report.uncoveredTestRoots.length === 0
      && report.browserLaunchAttempts.length === 0
      && report.orphans.manifest.length === 0 && (onlySet ? true : report.orphans.quarantine.length === 0);
  } catch (error) {
    report.ok = false;
    report.failurePhase = interrupted ? 'interrupted' : (error.phase || report.failurePhase || 'unknown');
    report.error = String(error?.stack || error);
    killAll();
  } finally {
    abortSignal?.removeEventListener?.('abort', onAbort);
  }
  return write();
}

export function parseArgs(argv) {
  const args = { kinds: ['node', 'python'] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`);
      return argv[++i];
    };
    if (flag === '--report') args.reportPath = path.resolve(value());
    else if (flag === '--logs') args.logsDir = path.resolve(value());
    else if (flag === '--root') args.root = value();
    else if (flag === '--parallel') args.parallel = Number(value());
    else if (flag === '--timeout-ms') args.timeoutMs = Number(value());
    else if (flag === '--kinds') args.kinds = value().split(',');
    else if (flag === '--only') args.only = value().split(',');
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

function summarize({ report, reportPath }) {
  const lines = [
    `${report.ok ? 'OK' : 'FAILED'}  executed ${report.counts.executed}, passed ${report.counts.passed}, known failures ${report.counts.knownFailures}, new failures ${report.counts.newFailures}, not run ${report.counts.notRun}`,
  ];
  if (report.failurePhase) lines.push(`failure phase: ${report.failurePhase}\n${String(report.error).split('\n').filter(line => !/^\s+at\s/.test(line)).join('\n')}`);
  const list = (label, items, hint) => { if (items.length) lines.push(`${label}${hint ? ` (${hint})` : ''}:\n  ${items.join('\n  ')}`); };
  list('new failures', report.newFailures, 'fix them, or quarantine with a class, reason, owner and signature');
  list('unsigned failures', report.results.filter(r => r.outcome === 'unsigned-failure').map(r => `${r.file}: ${r.unsigned}`), 'the file failed but its events cannot be trusted, so it can never be known');
  list('changed failure signatures', report.signatureChanged.map(e => e.added ? `${e.file}\n    added:   ${e.added.join('\n             ') || '(none)'}\n    removed: ${e.removed.join('\n             ') || '(none)'}` : `${e.file}\n    expected: ${e.expected}\n    actual:   ${e.actual}`));
  list('quarantined tests that now pass', report.staleQuarantine, 'remove them from tests/quarantine.json');
  list('unclassified test files', report.unclassified, 'add a first-line "// kaminos-test: node" declaration, or a tests/suite.json entry');
  list('invalid classifications', report.invalid, 'unknown kind, a non-executed kind without a reason, or a declaration that disagrees with tests/suite.json');
  list('invalid quarantine entries', report.invalidQuarantine, 'each needs class, owner, reason and signature');
  list('selectors that matched nothing', report.unmatchedSelectors);
  list('browser launches reached by tests', report.browserLaunchAttempts.map(a => `${a.file}: ${a.args}`), 'classify these tests as browser');
  list('test roots that are neither run nor excluded', report.uncoveredTestRoots, 'add them to excludedRoots in tests/suite.json with a reason');
  list('manifest entries for missing files', report.orphans.manifest);
  list('quarantine entries for missing files', report.orphans.quarantine);
  if (report.excludedRoots.length) lines.push(`excluded test roots: ${report.excludedRoots.map(e => e.path).join(', ')}`);
  lines.push(`report: ${reportPath}`);
  return lines.join('\n');
}

async function writeArgumentFailure(argv, error) {
  const index = argv.indexOf('--report');
  const reportPath = index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : null;
  if (!reportPath) return;
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify({ schema: REPORT_SCHEMA, ok: false, failurePhase: 'arguments', error: error.message, argv }, null, 2)}\n`);
}

const invokedAsMain = (() => { try { return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1])); } catch { return false; } })();
if (invokedAsMain) {
  const argv = process.argv.slice(2);
  let args;
  try { args = parseArgs(argv); } catch (error) {
    console.error(error.message);
    await writeArgumentFailure(argv, error);
    process.exit(2);
  }
  args.reportPath ||= path.resolve(os.tmpdir(), `kaminos-test-run-${Date.now()}`, 'report.json');
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  const result = await runSuite({ ...args, abortSignal: controller.signal });
  console.log(summarize(result));
  process.exit(result.report.failurePhase === 'interrupted' ? 130 : result.ok ? 0 : 1);
}
