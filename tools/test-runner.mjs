#!/usr/bin/env node
// Kaminos test runner.
//
// Every file under tests/ (top level, .mjs and .py) must be classified in the
// suite manifest. Kinds `node` and `python` execute by default; `browser`,
// `helper` and `manual` are counted with their reason and never run here.
// Failures listed in the quarantine are known; any other failure, timeout,
// unclassified file, orphan entry, or quarantined test that now passes fails
// the run. A report is written for every invocation, including one that dies
// before running anything.

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUITE_MANIFEST_SCHEMA = 'kaminos.test-suite-manifest.v1';
export const QUARANTINE_SCHEMA = 'kaminos.test-quarantine.v1';
export const REPORT_SCHEMA = 'kaminos.test-run-report.v1';
export const EXECUTABLE_KINDS = Object.freeze({ node: process.execPath, python: 'python3' });
export const KNOWN_KINDS = new Set(['node', 'python', 'browser', 'helper', 'manual']);
const DEFAULT_TIMEOUT_MS = 600000;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

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

function gitIdentity(root) {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
    return { head, dirty };
  } catch { return { head: null, dirty: null }; }
}

function pythonVersion() {
  try { return execFileSync('python3', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

function runOne({ root, file, kind, timeoutMs, logsDir }) {
  const started = Date.now();
  const logPath = path.join(logsDir, `${file.replace(/[\/]/g, '__')}.log`);
  return new Promise(resolve => {
    let child;
    const chunks = [];
    const finish = async fields => {
      await fs.writeFile(logPath, Buffer.concat(chunks));
      resolve({ file, kind, durationMs: Date.now() - started, log: logPath, ...fields });
    };
    try {
      child = spawn(EXECUTABLE_KINDS[kind], [file], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      chunks.push(Buffer.from(String(error?.stack || error)));
      return finish({ outcome: 'spawn-error', exitCode: null, signal: null });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs);
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => chunks.push(d));
    child.on('error', error => { chunks.push(Buffer.from(String(error?.stack || error))); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      const outcome = timedOut ? 'timeout' : exitCode === 0 ? 'pass' : exitCode === null ? 'spawn-error' : 'fail';
      finish({ outcome, exitCode, signal });
    });
  });
}

async function pool(items, parallel, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, items.length)) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await worker(items[index]); }
  }));
  return results;
}

export async function runSuite({
  root = process.cwd(),
  manifestPath = path.join(root, 'tests', 'suite.json'),
  quarantinePath = path.join(root, 'tests', 'quarantine.json'),
  reportPath,
  logsDir,
  parallel = Math.max(1, Math.floor(os.availableParallelism() / 2)),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  kinds = ['node', 'python'],
  only = null,
} = {}) {
  root = path.resolve(root);
  if (!reportPath) throw new Error('reportPath is required');
  logsDir = logsDir || path.join(path.dirname(reportPath), 'logs');
  const report = {
    schema: REPORT_SCHEMA, ok: false, failurePhase: null, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
    effective: { root, manifestPath, quarantinePath, parallel, timeoutMs, kinds, only,
      node: process.version, python: null, platform: `${process.platform}-${process.arch}`, git: gitIdentity(root),
      manifestSha256: null, quarantineSha256: null },
    counts: { discovered: 0, executed: 0, passed: 0, knownFailures: 0, newFailures: 0, notRun: 0 },
    newFailures: [], knownFailures: [], staleQuarantine: [], unclassified: [], invalid: [],
    orphans: { manifest: [], quarantine: [] }, notRun: [], results: [],
  };
  const write = async () => {
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { ok: report.ok, report, reportPath };
  };
  try {
    report.failurePhase = 'load-manifest';
    const manifest = await readJson(manifestPath, SUITE_MANIFEST_SCHEMA, 'load-manifest');
    report.effective.manifestSha256 = manifest.sha256;
    report.failurePhase = 'load-quarantine';
    const quarantine = await readJson(quarantinePath, QUARANTINE_SCHEMA, 'load-quarantine');
    report.effective.quarantineSha256 = quarantine.sha256;
    report.failurePhase = 'discover';
    if (kinds.includes('python')) report.effective.python = pythonVersion();
    const files = await discover(root);
    const fileSet = new Set(files);
    const tests = manifest.document.tests || {};
    const quarantined = quarantine.document.entries || {};
    report.counts.discovered = files.length;
    report.unclassified = files.filter(f => !tests[f]);
    report.orphans.manifest = Object.keys(tests).filter(f => !fileSet.has(f)).sort();
    report.orphans.quarantine = Object.keys(quarantined).filter(f => !fileSet.has(f)).sort();
    report.invalid = Object.entries(tests)
      .filter(([, entry]) => !KNOWN_KINDS.has(entry?.kind) || (!EXECUTABLE_KINDS[entry.kind] && !entry.reason))
      .map(([file]) => file).sort();

    const planned = [];
    for (const file of files) {
      const entry = tests[file];
      if (!entry || report.invalid.includes(file)) continue;
      if (only && !only.includes(file)) continue;
      if (EXECUTABLE_KINDS[entry.kind] && kinds.includes(entry.kind)) planned.push({ file, kind: entry.kind });
      else report.notRun.push({ file, kind: entry.kind, reason: entry.reason || `kind ${entry.kind} not selected` });
    }
    report.counts.notRun = report.notRun.length;

    report.failurePhase = 'execute';
    await fs.mkdir(logsDir, { recursive: true });
    report.results = await pool(planned, parallel, item => runOne({ root, ...item, timeoutMs, logsDir }));
    report.counts.executed = report.results.length;
    for (const result of report.results) {
      const known = Boolean(quarantined[result.file]);
      if (result.outcome === 'pass') {
        report.counts.passed += 1;
        if (known) report.staleQuarantine.push(result.file);
      } else if (known) {
        report.knownFailures.push(result.file);
      } else {
        report.newFailures.push(result.file);
      }
    }
    report.counts.knownFailures = report.knownFailures.length;
    report.counts.newFailures = report.newFailures.length;
    report.failurePhase = null;
    report.ok = report.newFailures.length === 0 && report.staleQuarantine.length === 0
      && report.unclassified.length === 0 && report.invalid.length === 0
      && report.orphans.manifest.length === 0 && (only ? true : report.orphans.quarantine.length === 0);
  } catch (error) {
    report.ok = false;
    report.failurePhase = error.phase || report.failurePhase || 'unknown';
    report.error = String(error?.stack || error);
  }
  return write();
}

function parseArgs(argv) {
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
  list('new failures', report.newFailures, 'fix them, or quarantine with a reason and owner');
  list('quarantined tests that now pass', report.staleQuarantine, 'remove them from tests/quarantine.json');
  list('unclassified test files', report.unclassified, 'add them to tests/suite.json');
  list('invalid manifest entries', report.invalid, 'unknown kind, or non-executed kind without a reason');
  list('manifest entries for missing files', report.orphans.manifest);
  list('quarantine entries for missing files', report.orphans.quarantine);
  lines.push(`report: ${reportPath}`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  args.reportPath ||= path.resolve(os.tmpdir(), `kaminos-test-run-${Date.now()}`, 'report.json');
  const result = await runSuite(args);
  console.log(summarize(result));
  process.exit(result.ok ? 0 : 1);
}
