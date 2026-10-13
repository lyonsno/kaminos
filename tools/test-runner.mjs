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
// nothing, missing declared dependencies, and test roots elsewhere in the
// repository that are neither covered nor excluded with a reason. A report is
// written for every invocation, including interrupted ones.

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUITE_MANIFEST_SCHEMA = 'kaminos.test-suite-manifest.v1';
export const QUARANTINE_SCHEMA = 'kaminos.test-quarantine.v1';
export const REPORT_SCHEMA = 'kaminos.test-run-report.v1';
export const KNOWN_KINDS = new Set(['node', 'python', 'browser', 'helper', 'manual']);
export const EXECUTED_KINDS = new Set(['node', 'python']);
export const QUARANTINE_CLASSES = new Set(['untriaged', 'regression', 'stale-pin', 'environment', 'harness-defect']);
export const BROWSER_STUB_PATH = fileURLToPath(new URL('./browser-launch-stub.sh', import.meta.url));
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
  if (!existsSync(manifestPath)) return { declared: [], missing: [], mismatched: [], installed: {}, lockfileSha256: null };
  const pkg = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const declared = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).sort();
  const missing = declared.filter(name => !existsSync(path.join(root, 'node_modules', name, 'package.json')));
  const lockPath = path.join(root, 'package-lock.json');
  const lock = existsSync(lockPath) ? JSON.parse(await fs.readFile(lockPath, 'utf8')) : null;
  const hiddenPath = path.join(root, 'node_modules', '.package-lock.json');
  const hidden = existsSync(hiddenPath) ? JSON.parse(await fs.readFile(hiddenPath, 'utf8')) : null;
  const installed = {};
  const mismatched = [];
  for (const name of declared.filter(n => !missing.includes(n))) {
    const version = JSON.parse(await fs.readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    installed[name] = version;
    const locked = lock?.packages?.[`node_modules/${name}`];
    if (locked?.version && locked.version !== version) { mismatched.push({ name, locked: locked.version, installed: version }); continue; }
    const placed = hidden?.packages?.[`node_modules/${name}`];
    for (const field of ['resolved', 'integrity']) {
      if (locked?.[field] && placed?.[field] && locked[field] !== placed[field]) mismatched.push({ name, field, locked: locked[field], installed: placed[field] });
    }
  }
  return { declared, missing, mismatched, installed, lockfileSha256: existsSync(lockPath) ? sha256(await fs.readFile(lockPath)) : null };
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
  // node:test files keep running after a failure; sign the set of failing
  // subtests so a new failing subtest changes the signature.
  if (lines.some(l => /^ℹ fail [1-9]/.test(l))) {
    const names = new Set();
    for (const l of lines) {
      const m = l.match(/^✖ (.+?) \(\d+(?:\.\d+)?ms\)$/);
      if (m) names.add(m[1]);
    }
    if (names.size) return `node:test failing: ${[...names].sort().join(' | ')}`;
  }
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

function runOne({ root, file, kind, executable, timeoutMs, logsDir, env: baseEnv, track }) {
  const env = { ...baseEnv, KAMINOS_TEST_RUNNER_TEST: file };
  const started = Date.now();
  const logPath = path.join(logsDir, `${file.replace(/[\/]/g, '__')}.log`);
  return new Promise(resolve => {
    const chunks = [];
    let spawnError = null;
    let timedOut = false;
    const finish = async fields => {
      await fs.writeFile(logPath, Buffer.concat(chunks));
      const output = Buffer.concat(chunks).toString('utf8');
      const signature = fields.outcome === 'fail' ? failureSignature(output, { root, kind, exitCode: fields.exitCode }) : null;
      resolve({ file, kind, executable, durationMs: Date.now() - started, log: logPath, signature, ...fields });
    };
    let child;
    try {
      child = spawn(executable, [file], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env });
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
  abortSignal = null,
} = {}) {
  root = path.resolve(root);
  manifestPath ||= path.join(root, 'tests', 'suite.json');
  quarantinePath ||= path.join(root, 'tests', 'quarantine.json');
  if (!reportPath) throw new Error('reportPath is required');
  logsDir = logsDir || path.join(path.dirname(reportPath), 'logs');
  const resolvedExecutables = { node: process.execPath, python: 'python3', ...executables };
  const browserLog = path.join(logsDir, 'browser-launch-attempts.tsv');
  // NODE_TEST_CONTEXT would switch child node:test files to the binary
  // protocol used between a parent `node --test` and its children.
  const { NODE_TEST_CONTEXT: _parentTestContext, ...inheritedEnv } = process.env;
  const childEnv = { ...inheritedEnv, KAMINOS_CHROME: BROWSER_STUB_PATH, CHROME_BIN: BROWSER_STUB_PATH, KAMINOS_TEST_RUNNER_BROWSER_LOG: browserLog };
  const report = {
    schema: REPORT_SCHEMA, ok: false, failurePhase: null, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
    effective: { root, manifestPath, quarantinePath, parallel, timeoutMs, kinds, only,
      executables: resolvedExecutables, node: process.version, python: null,
      platform: `${process.platform}-${process.arch}`, git: gitIdentity(root),
      browserStub: { path: BROWSER_STUB_PATH, overrides: ['KAMINOS_CHROME', 'CHROME_BIN'], log: browserLog },
      manifestSha256: null, quarantineSha256: null, dependencies: null },
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
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Object.assign(new Error(`timeoutMs must be positive, got ${timeoutMs}`), { phase: 'arguments' });
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
    report.results = await pool(planned, parallel,
      item => runOne({ root, ...item, timeoutMs, logsDir, env: childEnv, track }), () => interrupted);
    if (interrupted) throw Object.assign(new Error('run interrupted'), { phase: 'interrupted' });

    report.counts.executed = report.results.length;
    if (report.results.length !== planned.length) throw Object.assign(new Error(`planned ${planned.length} tests but ran ${report.results.length}`), { phase: 'execute' });
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
          report.signatureChanged.push({ file: result.file, expected: entry.signature, actual: result.signature });
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
  if (report.failurePhase) lines.push(`failure phase: ${report.failurePhase}\n${report.error}`);
  const list = (label, items, hint) => { if (items.length) lines.push(`${label}${hint ? ` (${hint})` : ''}:\n  ${items.join('\n  ')}`); };
  list('new failures', report.newFailures, 'fix them, or quarantine with a class, reason, owner and signature');
  list('changed failure signatures', report.signatureChanged.map(e => `${e.file}\n    expected: ${e.expected}\n    actual:   ${e.actual}`));
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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
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
