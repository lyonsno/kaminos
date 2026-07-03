#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const GREENROOM_JOB_TYPE = 'chord_materials';

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
const greenroomBin = process.env.KAMINOS_GPU_GREENROOM_BIN || '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom';
const queueDir = process.env.KAMINOS_GREENROOM_QUEUE_DIR || process.env.GPU_GREENROOM_DIR || '/Users/noahlyons/.local/state/gpu-greenroom';
const outputDir = process.env.KAMINOS_CHORD_OUTPUT_DIR || (output ? join(dirname(output), 'chord-greenroom-output') : null);
const waitMs = Number(process.env.KAMINOS_GREENROOM_WAIT_MS || process.env.KAMINOS_CHORD_WAIT_MS || 300000);
const pollMs = Number(process.env.KAMINOS_GREENROOM_POLL_MS || 2000);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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

function readJsonIfExists(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { schema: 'unparseable-json', error: error?.message || String(error), path };
  }
}

function greenroomArgs(commandArgs) {
  return ['--queue-dir', queueDir, ...commandArgs];
}

function runGreenroom(commandArgs) {
  return spawnSync(greenroomBin, greenroomArgs(commandArgs), {
    encoding: 'utf8',
    env: { ...process.env, GPU_GREENROOM_DIR: queueDir },
  });
}

function receiptPathFor(jobId, status) {
  return join(queueDir, status, jobId, 'receipt.json');
}

function readGreenroomReceipt(jobId, status) {
  const preferred = receiptPathFor(jobId, status);
  const found = readJsonIfExists(preferred);
  if (found) return found;
  for (const candidate of ['done', 'failed', 'cancelled', 'running', 'pending']) {
    const receipt = readJsonIfExists(receiptPathFor(jobId, candidate));
    if (receipt) return receipt;
  }
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
        greenroom: {
          bin: greenroomBin,
          queueDir,
          jobType: GREENROOM_JOB_TYPE,
          outputDir,
        },
      },
      ...extra,
    });
  }
}

function submitAndWait() {
  const submitArgs = ['submit', GREENROOM_JOB_TYPE, input, outputDir];
  const submit = runGreenroom(submitArgs);
  if (submit.error || submit.status !== 0) {
    throw Object.assign(new Error(submit.error?.message || `gpu-greenroom submit exited ${submit.status}`), {
      greenroomPhase: 'submitting-greenroom',
      submit,
    });
  }
  const jobId = (submit.stdout || '').match(/Submitted job\s+(\S+)/)?.[1];
  if (!jobId) {
    throw Object.assign(new Error('gpu-greenroom submit did not print a job id'), {
      greenroomPhase: 'parsing-greenroom-submit',
      submit,
    });
  }

  const deadline = Date.now() + waitMs;
  let lastStatus = null;
  while (Date.now() <= deadline) {
    const statusProc = runGreenroom(['status', jobId]);
    if (statusProc.error || statusProc.status !== 0) {
      throw Object.assign(new Error(statusProc.error?.message || `gpu-greenroom status exited ${statusProc.status}`), {
        greenroomPhase: 'polling-greenroom-status',
        submit,
        statusProc,
        jobId,
      });
    }
    lastStatus = JSON.parse(statusProc.stdout);
    if (['done', 'failed', 'cancelled'].includes(lastStatus.status)) {
      const receipt = readGreenroomReceipt(jobId, lastStatus.status);
      return {
        jobId,
        status: lastStatus,
        receipt,
        submitStdoutTail: (submit.stdout || '').slice(-4000),
        submitStderrTail: (submit.stderr || '').slice(-4000),
      };
    }
    sleep(Math.max(1, pollMs));
  }
  throw Object.assign(new Error(`gpu-greenroom job ${jobId} did not finish within ${waitMs}ms`), {
    greenroomPhase: 'waiting-greenroom',
    submit,
    jobId,
    lastStatus,
  });
}

try {
  if (!input || !output || !report) throw new Error('expected --input, --output, and --report');
  if (!existsSync(input)) throw new Error(`input image does not exist: ${input}`);
  if (!existsSync(greenroomBin)) throw new Error(`gpu-greenroom executable not found: ${greenroomBin}`);
  mkdirSync(outputDir, { recursive: true });

  const greenroom = submitAndWait();
  if (greenroom.status.status !== 'done') {
    throw Object.assign(new Error(`gpu-greenroom job ${greenroom.jobId} finished ${greenroom.status.status}`), {
      greenroomPhase: 'greenroom-failed',
      greenroom,
    });
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
    throw Object.assign(new Error(`gpu-greenroom ${GREENROOM_JOB_TYPE} produced no recognizable material image outputs under ${outputDir}`), {
      greenroomPhase: 'locating-material-outputs',
      greenroom,
      discoveredOutputs: imageOutputs,
    });
  }

  const bundle = {
    schema: 'kaminos.pbr-material-bundle.v0',
    source: {
      inputPath: input,
      inputSha256: sha256File(input),
    },
    backend: {
      modelFamily: 'CHORD',
      greenroom: {
        bin: greenroomBin,
        queueDir,
        jobType: GREENROOM_JOB_TYPE,
        jobId: greenroom.jobId,
        status: greenroom.status,
        receipt: greenroom.receipt,
        outputDir,
      },
    },
    outputs,
    truthBoundary: 'CHORD material decomposition adapter output via gpu-greenroom; not final Kaminos material baking or renderer truth',
  };
  writeJson(output, bundle);
  const outputStat = statSync(output);
  writeJson(report, {
    schema: 'kaminos.chord-greenroom-adapter-report.v0',
    ok: true,
    phase: 'complete',
    backend: bundle.backend,
    command: [greenroomBin, ...greenroomArgs(['submit', GREENROOM_JOB_TYPE, input, outputDir])],
    input: bundle.source,
    output: {
      path: output,
      bytes: outputStat.size,
      sha256: sha256File(output),
      role: 'pbr-material-bundle',
      materialRoles: Object.keys(outputs),
    },
    submitStdoutTail: greenroom.submitStdoutTail,
    submitStderrTail: greenroom.submitStderrTail,
    truthBoundary: bundle.truthBoundary,
  });
} catch (error) {
  writeFailure(error.greenroomPhase || 'initializing', error, {
    greenroom: error.greenroom || null,
    submitStdoutTail: (error.submit?.stdout || '').slice(-4000),
    submitStderrTail: (error.submit?.stderr || '').slice(-4000),
    statusStdoutTail: (error.statusProc?.stdout || '').slice(-4000),
    statusStderrTail: (error.statusProc?.stderr || '').slice(-4000),
    lastStatus: error.lastStatus || null,
    discoveredOutputs: error.discoveredOutputs || null,
  });
  process.exit(1);
}
