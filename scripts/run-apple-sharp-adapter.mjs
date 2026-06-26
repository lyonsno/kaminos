#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, '1');
  }
}

const inputPath = args.get('--input') ? resolve(args.get('--input')) : null;
const outputPath = args.get('--output') ? resolve(args.get('--output')) : null;
const reportPath = args.get('--report') ? resolve(args.get('--report')) : null;
const keepWork = args.get('--keep-work') === '1' || process.env.KAMINOS_APPLE_SHARP_KEEP_WORK === '1';
let phase = 'initializing';
let workRoot = null;
let outputDir = null;
let generatedPath = null;

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fileEvidence(path) {
  const stat = statSync(path);
  return {
    path,
    bytes: stat.size,
    sha256: sha256File(path),
  };
}

function writeJson(path, value) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function commandCandidates() {
  const envCommand = (process.env.KAMINOS_APPLE_SHARP_COMMAND || '').trim();
  if (envCommand) return [envCommand];
  return [
    '/Users/noahlyons/dev/ml-sharp/.venv/bin/sharp',
    'sharp',
  ];
}

function findCommand(command) {
  if (!command) return null;
  if (isAbsolute(command)) return existsSync(command) ? command : null;
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveBackend() {
  const candidates = commandCandidates();
  for (const configured of candidates) {
    const resolved = findCommand(configured);
    if (resolved) {
      return {
        command: resolved,
        configuredCommand: configured,
        commandEnv: process.env.KAMINOS_APPLE_SHARP_COMMAND ? 'KAMINOS_APPLE_SHARP_COMMAND' : 'default-candidate',
        candidates,
        device: (process.env.KAMINOS_APPLE_SHARP_DEVICE || 'mps').trim() || 'mps',
      };
    }
  }
  const hint = process.env.KAMINOS_APPLE_SHARP_COMMAND
    ? `KAMINOS_APPLE_SHARP_COMMAND=${process.env.KAMINOS_APPLE_SHARP_COMMAND}`
    : 'set KAMINOS_APPLE_SHARP_COMMAND or install /Users/noahlyons/dev/ml-sharp/.venv/bin/sharp';
  throw new Error(`Apple SHARP command unavailable (${hint})`);
}

function reportBase(extra = {}) {
  return {
    schema: 'kaminos.apple-sharp-adapter-report.v0',
    ok: extra.ok ?? false,
    phase,
    backend: extra.backend || null,
    input: inputPath && existsSync(inputPath) ? fileEvidence(inputPath) : { path: inputPath },
    output: {
      path: outputPath,
      sourceGeneratedPath: generatedPath,
      sourceGeneratedPathRetained: keepWork,
      ...(outputPath && existsSync(outputPath) ? fileEvidence(outputPath) : {}),
    },
    workRoot,
    keepWork,
    ...extra,
  };
}

function fail(error, extra = {}) {
  writeJson(reportPath, reportBase({
    ok: false,
    error: error?.message || String(error),
    ...extra,
  }));
  if (workRoot && !keepWork) rmSync(workRoot, { recursive: true, force: true });
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

try {
  phase = 'validate-args';
  if (!inputPath) throw new Error('missing --input');
  if (!outputPath) throw new Error('missing --output');
  if (!reportPath) throw new Error('missing --report');
  if (!existsSync(inputPath)) throw new Error(`input artifact does not exist: ${inputPath}`);

  phase = 'resolve-backend';
  const backend = resolveBackend();

  phase = 'prepare-workdir';
  workRoot = mkdtempSync(join(tmpdir(), 'kaminos-apple-sharp-'));
  outputDir = join(workRoot, 'gaussians');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });

  phase = 'execute-sharp';
  const argv = [
    'predict',
    '--device', backend.device,
    '--no-render',
    '-i', inputPath,
    '-o', outputDir,
  ];
  const proc = spawnSync(backend.command, argv, {
    cwd: dirname(inputPath),
    encoding: 'utf8',
    env: process.env,
  });
  const execution = {
    argv: [backend.command, ...argv],
    exitCode: proc.status,
    signal: proc.signal || null,
    stdoutTail: (proc.stdout || '').slice(-4000),
    stderrTail: (proc.stderr || '').slice(-4000),
  };
  if (proc.error || proc.status !== 0) {
    throw Object.assign(new Error(proc.error?.message || `Apple SHARP exited ${proc.status}`), { execution, backend });
  }

  phase = 'collect-output';
  const expectedName = `${basename(inputPath, extname(inputPath))}.ply`;
  const expectedPath = join(outputDir, expectedName);
  generatedPath = expectedPath;
  if (!existsSync(expectedPath)) {
    throw Object.assign(new Error(`Apple SHARP completed without expected PLY: ${expectedPath}`), { execution, backend });
  }
  copyFileSync(expectedPath, outputPath);

  phase = 'write-report';
  writeJson(reportPath, reportBase({
    ok: true,
    backend,
    execution,
    output: {
      ...fileEvidence(outputPath),
      sourceGeneratedPath: generatedPath,
      sourceGeneratedPathRetained: keepWork,
      sourceGeneratedBytes: statSync(generatedPath).size,
      sourceGeneratedSha256: sha256File(generatedPath),
    },
  }));

  if (!keepWork) {
    rmSync(workRoot, { recursive: true, force: true });
    workRoot = null;
  }
} catch (error) {
  fail(error, {
    backend: error.backend || null,
    execution: error.execution || null,
  });
}
