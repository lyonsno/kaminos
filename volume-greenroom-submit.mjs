#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const SUBMIT_SCHEMA = 'kaminos.volume.greenroom-submit.v0';
const JOB_TYPE = 'kaminos_volume_benchmark';
const LOCAL_GREENROOM_CLI = '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom';

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

function readJson(path, fallback = {}) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

function gitValue(cwd, gitArgs, fallback = null) {
  try {
    return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function buildJobType(cwd) {
  return {
    cmd: [
      process.execPath,
      'volume-greenroom-benchmark.mjs',
      '--job-input', '{input_path}',
      '--base-url', '{base_url}',
      '--out-dir', '{output_dir}',
      '--aggregate', '{output_dir}/aggregate.json',
      '--settle-ms', '{settle_ms}',
      '--window-size', '{window_size}',
      '--debug-port', '{debug_port}',
      '--scenarios', '{scenarios}',
      '{benchmark_dry_run_flag}',
    ],
    cwd,
    env: {},
    defaults: {
      base_url: 'http://127.0.0.1:8097/?kaminos_volume_smoke=1',
      scenarios: 'all',
      settle_ms: '8000',
      window_size: '1280,960',
      debug_port: '9500',
      benchmark_dry_run_flag: '',
    },
    timeout: null,
  };
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const queueDir = resolve(
  args.get('--queue-dir')
    || process.env.GPU_GREENROOM_DIR
    || join(homedir(), '.local/state/gpu-greenroom'),
);
const jobTypesPath = join(queueDir, 'job_types.json');
const inputsDir = join(queueDir, 'inputs');
const greenroomCli = String(args.get('--greenroom-cli') || (existsSync(LOCAL_GREENROOM_CLI) ? LOCAL_GREENROOM_CLI : 'gpu-greenroom'));
const baseUrl = String(args.get('--base-url') || 'http://127.0.0.1:8097/?kaminos_volume_smoke=1');
const scenarios = String(args.get('--scenarios') || 'all');
const settleMs = String(args.get('--settle-ms') || '8000');
const windowSize = String(args.get('--window-size') || '1280,960');
const debugPort = String(args.get('--debug-port') || '9500');
const outputDir = args.get('--output-dir') ? resolve(args.get('--output-dir')) : '';
const benchmarkDryRunFlag = args.has('--benchmark-dry-run') ? '--dry-run' : '';
const registerOnly = args.has('--register-only');
const submitDryRun = args.has('--submit-dry-run');
const createdAt = new Date().toISOString();
const safeStamp = createdAt.replace(/[^0-9TZ]+/g, '-');
const inputPath = resolve(args.get('--input') || join(inputsDir, `kaminos-volume-benchmark-${safeStamp}.json`));

mkdirSync(queueDir, { recursive: true });
const jobTypes = readJson(jobTypesPath, {});
jobTypes[JOB_TYPE] = buildJobType(cwd);
writeJson(jobTypesPath, jobTypes);

const request = {
  schema: SUBMIT_SCHEMA,
  createdAt,
  jobType: JOB_TYPE,
  cwd,
  queueDir,
  jobTypesPath,
  gitCommit: gitValue(cwd, ['rev-parse', 'HEAD']),
  gitBranch: gitValue(cwd, ['branch', '--show-current']),
  gitStatusShort: gitValue(cwd, ['status', '--short'], ''),
  baseUrl,
  scenarios,
  settleMs,
  windowSize,
  debugPort,
  outputDir: outputDir || null,
  benchmarkDryRun: Boolean(benchmarkDryRunFlag),
};
writeJson(inputPath, request);

const submitArgs = [
  '--queue-dir', queueDir,
  'submit',
  JOB_TYPE,
  inputPath,
];
if (outputDir) submitArgs.push(outputDir);
submitArgs.push(
  '-p',
  `base_url=${baseUrl}`,
  `scenarios=${scenarios}`,
  `settle_ms=${settleMs}`,
  `window_size=${windowSize}`,
  `debug_port=${debugPort}`,
  `benchmark_dry_run_flag=${benchmarkDryRunFlag}`,
);

let submitOutput = '';
let submitError = null;
if (!registerOnly && !submitDryRun) {
  try {
    submitOutput = execFileSync(greenroomCli, submitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    submitError = {
      status: error.status,
      signal: error.signal,
      message: error.message,
      stdout: error.stdout?.toString(),
      stderr: error.stderr?.toString(),
    };
  }
}

const result = {
  schema: SUBMIT_SCHEMA,
  status: submitError ? 'failed' : (registerOnly ? 'registered' : (submitDryRun ? 'submit-dry-run' : 'submitted')),
  jobType: JOB_TYPE,
  queueDir,
  jobTypesPath,
  inputPath,
  outputDir: outputDir || null,
  greenroomCli,
  submitCommand: [greenroomCli, ...submitArgs],
  request,
  submitOutput,
  submitError,
};

console.log(JSON.stringify(result, null, 2));
if (submitError) process.exit(submitError.status || 1);
