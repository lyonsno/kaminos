#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
const python = process.env.KAMINOS_CHORD_PYTHON || '/Users/noahlyons/dev/ubisoft-laforge-chord/.venv/bin/python';
const runner = process.env.KAMINOS_CHORD_RUNNER || '/Users/noahlyons/dev/ubisoft-laforge-chord/run_greenroom.py';
const cwd = process.env.KAMINOS_CHORD_CWD || dirname(runner);
const outputDir = process.env.KAMINOS_CHORD_OUTPUT_DIR || (output ? join(dirname(output), 'chord-greenroom-output') : null);

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

function classifyOutput(path) {
  const name = basename(path).toLowerCase();
  if (name.includes('basecolor') || name.includes('base_color') || name.includes('albedo') || name.includes('diffuse')) return 'basecolor';
  if (name.includes('normal')) return 'normal';
  if (name.includes('rough')) return 'roughness';
  if (name.includes('metal')) return 'metalness';
  return null;
}

function writeFailure(phase, error, extra = {}) {
  if (report) {
    writeJson(report, {
      schema: 'kaminos.chord-greenroom-adapter-report.v0',
      ok: false,
      phase,
      error: error?.message || String(error),
      input,
      output,
      backend: {
        modelFamily: 'CHORD',
        python,
        runner,
        cwd,
      },
      ...extra,
    });
  }
}

try {
  if (!input || !output || !report) throw new Error('expected --input, --output, and --report');
  if (!existsSync(input)) throw new Error(`input image does not exist: ${input}`);
  if (!existsSync(python)) throw new Error(`CHORD python not found: ${python}`);
  if (!existsSync(runner)) throw new Error(`CHORD runner not found: ${runner}`);
  mkdirSync(outputDir, { recursive: true });
  const commandArgs = ['-u', runner, '--image', input, '--output-dir', outputDir];
  const proc = spawnSync(python, commandArgs, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  if (proc.error || proc.status !== 0) {
    const message = proc.error?.message || `CHORD runner exited ${proc.status}`;
    writeFailure('running-chord', new Error(message), {
      stdoutTail: (proc.stdout || '').slice(-4000),
      stderrTail: (proc.stderr || '').slice(-4000),
    });
    process.exit(proc.status || 1);
  }
  const imageOutputs = listFilesRecursive(outputDir).filter(path => /\.(png|jpg|jpeg|webp|exr)$/i.test(path));
  const outputs = {};
  for (const path of imageOutputs) {
    const role = classifyOutput(path);
    if (!role || outputs[role]) continue;
    outputs[role] = {
      path,
      bytes: statSync(path).size,
      sha256: sha256File(path),
    };
  }
  if (!Object.keys(outputs).length) {
    writeFailure('locating-material-outputs', new Error(`CHORD runner produced no recognizable material image outputs under ${outputDir}`), {
      discoveredOutputs: imageOutputs,
      stdoutTail: (proc.stdout || '').slice(-4000),
      stderrTail: (proc.stderr || '').slice(-4000),
    });
    process.exit(1);
  }
  const bundle = {
    schema: 'kaminos.pbr-material-bundle.v0',
    source: {
      inputPath: input,
      inputSha256: sha256File(input),
    },
    backend: {
      modelFamily: 'CHORD',
      python,
      runner,
      cwd,
    },
    outputs,
    truthBoundary: 'CHORD material decomposition adapter output; not final Kaminos material baking or renderer truth',
  };
  writeJson(output, bundle);
  const outputStat = statSync(output);
  writeJson(report, {
    schema: 'kaminos.chord-greenroom-adapter-report.v0',
    ok: true,
    phase: 'complete',
    backend: bundle.backend,
    command: [python, ...commandArgs],
    input: bundle.source,
    output: {
      path: output,
      bytes: outputStat.size,
      sha256: sha256File(output),
      role: 'pbr-material-bundle',
      materialRoles: Object.keys(outputs),
    },
    stdoutTail: (proc.stdout || '').slice(-4000),
    stderrTail: (proc.stderr || '').slice(-4000),
    truthBoundary: bundle.truthBoundary,
  });
} catch (error) {
  writeFailure('initializing', error);
  process.exit(1);
}
