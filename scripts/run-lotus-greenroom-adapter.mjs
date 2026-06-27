#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const value = process.argv[i + 1];
  if (value && !value.startsWith('--')) {
    args.set(key, value);
    i++;
  } else {
    args.set(key, '1');
  }
}

const input = args.get('--input') ? resolve(args.get('--input')) : null;
const output = args.get('--output') ? resolve(args.get('--output')) : null;
const report = args.get('--report') ? resolve(args.get('--report')) : null;
const python = process.env.KAMINOS_LOTUS_PYTHON || '/Users/noahlyons/dev/Lotus/.venv/bin/python';
const runner = process.env.KAMINOS_LOTUS_RUNNER || '/Users/noahlyons/dev/Lotus/run_greenroom.py';
const cwd = process.env.KAMINOS_LOTUS_CWD || dirname(runner);
const resolution = process.env.KAMINOS_LOTUS_RESOLUTION || '1024';
const outputDir = process.env.KAMINOS_LOTUS_OUTPUT_DIR || (output ? join(dirname(output), 'lotus-greenroom-output') : null);

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function listFilesRecursive(root) {
  if (!root || !existsSync(root)) return [];
  const entries = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...listFilesRecursive(path));
    else entries.push(path);
  }
  return entries;
}

function writeFailure(phase, error, extra = {}) {
  if (report) {
    writeJson(report, {
      schema: 'kaminos.lotus-greenroom-adapter-report.v0',
      ok: false,
      phase,
      error: error?.message || String(error),
      input,
      output,
      backend: {
        modelFamily: 'Lotus-D',
        python,
        runner,
        cwd,
        resolution,
      },
      ...extra,
    });
  }
}

try {
  if (!input || !output || !report) throw new Error('expected --input, --output, and --report');
  if (!existsSync(input)) throw new Error(`input image does not exist: ${input}`);
  if (!existsSync(python)) throw new Error(`Lotus python not found: ${python}`);
  if (!existsSync(runner)) throw new Error(`Lotus runner not found: ${runner}`);
  mkdirSync(outputDir, { recursive: true });
  const commandArgs = ['-u', runner, '--image', input, '--output-dir', outputDir, '--resolution', resolution];
  const proc = spawnSync(python, commandArgs, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  if (proc.error || proc.status !== 0) {
    const message = proc.error?.message || `Lotus runner exited ${proc.status}`;
    writeFailure('running-lotus', new Error(message), {
      stdoutTail: (proc.stdout || '').slice(-4000),
      stderrTail: (proc.stderr || '').slice(-4000),
    });
    process.exit(proc.status || 1);
  }
  const normalCandidates = listFilesRecursive(outputDir)
    .filter(path => /\.(png|jpg|jpeg|webp)$/i.test(path))
    .sort((a, b) => {
      const aName = basename(a).toLowerCase();
      const bName = basename(b).toLowerCase();
      const aScore = (aName.includes('normal') ? 10 : 0) + statSync(a).size / 1e9;
      const bScore = (bName.includes('normal') ? 10 : 0) + statSync(b).size / 1e9;
      return bScore - aScore;
    });
  const normalPath = normalCandidates[0];
  if (!normalPath) {
    writeFailure('locating-normal-output', new Error(`Lotus runner produced no image outputs under ${outputDir}`), {
      stdoutTail: (proc.stdout || '').slice(-4000),
      stderrTail: (proc.stderr || '').slice(-4000),
    });
    process.exit(1);
  }
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(normalPath, output);
  const outputStat = statSync(output);
  writeJson(report, {
    schema: 'kaminos.lotus-greenroom-adapter-report.v0',
    ok: true,
    phase: 'complete',
    backend: {
      modelFamily: 'Lotus-D',
      python,
      runner,
      cwd,
      resolution,
    },
    command: [python, ...commandArgs],
    input: {
      path: input,
      sha256: sha256File(input),
    },
    output: {
      path: output,
      sourcePath: normalPath,
      bytes: outputStat.size,
      sha256: sha256File(output),
      role: 'normal-map',
    },
    stdoutTail: (proc.stdout || '').slice(-4000),
    stderrTail: (proc.stderr || '').slice(-4000),
    truthBoundary: 'Lotus-D normal-map adapter output; not renderer baking or material truth',
  });
} catch (error) {
  writeFailure('initializing', error);
  process.exit(1);
}
