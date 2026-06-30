#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const GREENROOM_BENCHMARK_SCHEMA = 'kaminos.volume.greenroom-benchmark.v0';
const GREENROOM_BENCHMARK_JOB_ID = 'kaminos-volume-gpu-greenroom-benchmark-v0';

function parseArgs(argv) {
  const parsed = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      i += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const baseUrl = args.get('--base-url') || 'http://127.0.0.1:8097/?kaminos_volume_smoke=1';
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-volume-greenroom-benchmark');
const aggregatePath = resolve(args.get('--aggregate') || `${outDir}/aggregate.json`);
const jobPath = resolve(args.get('--job') || `${outDir}/greenroom-job.json`);
const runPath = resolve(args.get('--run') || `${outDir}/greenroom-run.json`);
const stdoutPath = resolve(args.get('--stdout') || `${outDir}/sweep-stdout.log`);
const stderrPath = resolve(args.get('--stderr') || `${outDir}/sweep-stderr.log`);
const settleMs = String(args.get('--settle-ms') || 8000);
const windowSize = String(args.get('--window-size') || '1280,960');
const debugPort = String(args.get('--debug-port') || 9500);
const scenarios = args.get('--scenarios');
const dryRun = args.has('--dry-run');

mkdirSync(outDir, { recursive: true });

const sweepArgs = [
  'volume-sweep.mjs',
  '--matrix', 'performance',
  '--base-url', baseUrl,
  '--out-dir', outDir,
  '--aggregate', aggregatePath,
  '--settle-ms', settleMs,
  '--window-size', windowSize,
  '--debug-port', debugPort,
];
if (scenarios) sweepArgs.push('--scenarios', String(scenarios));
if (dryRun) sweepArgs.push('--dry-run');

const requestedCommand = [process.execPath, ...sweepArgs];
const createdAt = new Date().toISOString();
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short'], '');

const job = {
  schema: GREENROOM_BENCHMARK_SCHEMA,
  jobId: GREENROOM_BENCHMARK_JOB_ID,
  createdAt,
  cwd,
  gitCommit,
  gitBranch,
  gitStatusShort,
  baseUrl,
  outDir,
  aggregatePath,
  jobPath,
  runPath,
  stdoutPath,
  stderrPath,
  dryRun,
  matrixMode: 'performance',
  performanceMatrixId: 'tall-plume-performance-matrix-v0',
  evidenceModeContract: 'performance matrix evidence mode is forwarded by volume-sweep.mjs to volume-witness.mjs as --evidence-mode performance',
  requestedGreenroomCondition: {
    cleanGpuWindow: true,
    noConcurrentInference: true,
    noOperatorWorkloadContention: true,
  },
  uncontendedEvidenceClaim: false,
  requestedCommand,
};

writeJson(jobPath, { job });

const startedAt = new Date().toISOString();
const startMs = Date.now();
const stdoutFd = openSync(stdoutPath, 'w');
const stderrFd = openSync(stderrPath, 'w');
let child;
try {
  child = spawnSync(process.execPath, sweepArgs, {
    cwd,
    stdio: ['ignore', stdoutFd, stderrFd],
  });
} finally {
  closeSync(stdoutFd);
  closeSync(stderrFd);
}
const finishedAt = new Date().toISOString();
const aggregate = readJson(aggregatePath);
const run = {
  schema: GREENROOM_BENCHMARK_SCHEMA,
  jobId: GREENROOM_BENCHMARK_JOB_ID,
  status: child.status === 0 ? (dryRun ? 'dry-run' : 'passed') : 'failed',
  startedAt,
  finishedAt,
  durationMs: Date.now() - startMs,
  cwd,
  gitCommit,
  gitBranch,
  baseUrl,
  outDir,
  aggregatePath,
  jobPath,
  stdoutPath,
  stderrPath,
  dryRun,
  matrixMode: 'performance',
  performanceMatrixId: 'tall-plume-performance-matrix-v0',
  uncontendedEvidenceClaim: false,
  effectiveCommand: [process.execPath, ...sweepArgs],
  requestedCommand,
  exitStatus: child.status,
  signal: child.signal,
  spawnError: child.error ? {
    name: child.error.name,
    message: child.error.message,
    code: child.error.code,
  } : null,
  aggregateSummary: aggregate?.aggregate ? {
    generatedAt: aggregate.aggregate.generatedAt,
    runs: aggregate.aggregate.runs?.length || 0,
    failures: aggregate.aggregate.failures?.length || 0,
    recommendations: aggregate.aggregate.recommendations || [],
  } : null,
};

writeJson(runPath, { job, run });
console.log(JSON.stringify({ job, run }, null, 2));
if (child.status !== 0) process.exit(child.status || 1);
