#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createOrbInnerEngineProviderRegistry,
  runOrbInnerEngineProviderRoute,
} from './orb-inner-engine-provider-adapters.mjs';

export const ORB_INNER_ENGINE_GREENROOM_ROUTE_IDENTITY = 'orb-inner-engine-greenroom-route-v0';

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_QUEUE_DIR = process.env.GPU_GREENROOM_DIR || '/Users/noahlyons/.local/state/gpu-greenroom';
const JOB_TYPE = 'kaminos.orb-inner-engine.provider-route';

const LOCKED_RUNNER_PYTHON = String.raw`
import fcntl
import json
import os
import subprocess
import sys
import time

lock_path = sys.argv[1]
status_path = sys.argv[2]
command = json.loads(sys.argv[3])
cwd = sys.argv[4]
timeout_seconds = int(sys.argv[5])

os.makedirs(os.path.dirname(lock_path), exist_ok=True)
with open(lock_path, "a", encoding="utf-8") as lock_file:
    fcntl.flock(lock_file, fcntl.LOCK_EX)
    locked_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        with open(status_path, "r", encoding="utf-8") as handle:
            status = json.load(handle)
    except Exception:
        status = {}
    status.update({"status": "running", "lockedAt": locked_at, "lockPath": lock_path})
    with open(status_path, "w", encoding="utf-8") as handle:
        json.dump(status, handle, indent=2)
        handle.write("\n")
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=os.environ.copy(),
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        sys.stdout.write(error.stdout or "")
        sys.stderr.write(error.stderr or "")
        sys.stderr.write(f"greenroom locked child timed out after {timeout_seconds}s\n")
        sys.exit(124)
    sys.stdout.write(completed.stdout or "")
    sys.stderr.write(completed.stderr or "")
    sys.exit(completed.returncode)
`;

function nowTiming() {
  return {
    ms: Date.now(),
    iso: new Date().toISOString(),
  };
}

function jsonWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function jsonReadIfExists(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseArgs(argv) {
  const values = new Map();
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const hasValue = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--');
    const value = hasValue ? argv[++i] : 'true';
    values.set(key, value);
  }
  return {
    get(key, fallback = undefined) {
      return values.has(key) ? values.get(key) : fallback;
    },
    has(key) {
      return values.has(key);
    },
  };
}

function makeJobId({ jobId, providerId, bundleRoot }) {
  if (jobId) return jobId;
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const providerSlug = String(providerId || 'provider').replaceAll(/[^a-zA-Z0-9_-]/g, '-');
  const bundleSlug = String(bundleRoot || 'bundle').split('/').filter(Boolean).pop() || 'bundle';
  return `${stamp}-${providerSlug}-${bundleSlug}`;
}

function ensureQueueDirs(queueDir) {
  for (const child of ['pending', 'running', 'done', 'failed', 'cancelled', 'outputs']) {
    mkdirSync(join(queueDir, child), { recursive: true });
  }
}

function clearPriorJob(queueDir, jobId) {
  for (const child of ['pending', 'running', 'done', 'failed', 'cancelled']) {
    rmSync(join(queueDir, child, jobId), { recursive: true, force: true });
  }
}

function writeStatus(path, status) {
  jsonWrite(path, {
    updatedAt: new Date().toISOString(),
    ...status,
  });
}

function childCommand({
  bundleRoot,
  providerId,
  timeoutMs,
  jobDir,
  ideogramRoot,
  cosmosRoot,
  providerPython,
}) {
  const args = [
    process.execPath,
    MODULE_PATH,
    '--locked-child',
    '--job-dir',
    jobDir,
    '--bundle-root',
    bundleRoot,
    '--provider-id',
    providerId,
    '--timeout-ms',
    String(timeoutMs),
  ];
  if (ideogramRoot) args.push('--ideogram-root', ideogramRoot);
  if (cosmosRoot) args.push('--cosmos-root', cosmosRoot);
  if (providerPython) args.push('--provider-python', providerPython);
  return args;
}

function runLockedChild({ lockPath, statusPath, command, cwd, timeoutMs }) {
  const timeoutSeconds = Math.max(1, Math.ceil((Number(timeoutMs) + 60000) / 1000));
  return spawnSync('python3', [
    '-c',
    LOCKED_RUNNER_PYTHON,
    lockPath,
    statusPath,
    JSON.stringify(command),
    cwd,
    String(timeoutSeconds),
  ], {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: Number(timeoutMs) + 120000,
    maxBuffer: 1024 * 1024 * 32,
  });
}

export function runOrbInnerEngineGreenroomProviderRoute({
  queueDir = DEFAULT_QUEUE_DIR,
  jobId = null,
  bundleRoot,
  providerId = 'local-image.ideogram4',
  timeoutMs = 900000,
  ideogramRoot = process.env.KAMINOS_IDEOGRAM4_ROOT || null,
  cosmosRoot = process.env.KAMINOS_COSMOS3_MLX_ROOT || null,
  providerPython = null,
  cwd = process.cwd(),
} = {}) {
  if (!bundleRoot) {
    throw new Error('runOrbInnerEngineGreenroomProviderRoute requires bundleRoot');
  }
  const resolvedQueueDir = resolve(queueDir);
  const resolvedBundleRoot = resolve(bundleRoot);
  const resolvedCwd = resolve(cwd);
  const resolvedJobId = makeJobId({ jobId, providerId, bundleRoot: resolvedBundleRoot });
  ensureQueueDirs(resolvedQueueDir);
  clearPriorJob(resolvedQueueDir, resolvedJobId);

  const lockPath = join(resolvedQueueDir, 'gpu.lock');
  const pendingJobDir = join(resolvedQueueDir, 'pending', resolvedJobId);
  const runningJobDir = join(resolvedQueueDir, 'running', resolvedJobId);
  mkdirSync(pendingJobDir, { recursive: true });

  const started = nowTiming();
  const request = {
    identity: 'orb-inner-engine-greenroom-route-request-v0',
    jobType: JOB_TYPE,
    jobId: resolvedJobId,
    providerId,
    bundleRoot: resolvedBundleRoot,
    queueDir: resolvedQueueDir,
    lockPath,
    cwd: resolvedCwd,
    timeoutMs,
    greenroomCustody: 'gpu-greenroom-file-lock',
    directGpuRun: false,
    requestedAt: started.iso,
  };
  jsonWrite(join(pendingJobDir, 'request.json'), request);
  writeStatus(join(pendingJobDir, 'status.json'), {
    jobId: resolvedJobId,
    jobType: JOB_TYPE,
    status: 'waiting-for-lock',
    providerId,
    bundleRoot: resolvedBundleRoot,
    queueDir: resolvedQueueDir,
    lockPath,
  });

  renameSync(pendingJobDir, runningJobDir);
  const statusPath = join(runningJobDir, 'status.json');
  const command = childCommand({
    bundleRoot: resolvedBundleRoot,
    providerId,
    timeoutMs,
    jobDir: runningJobDir,
    ideogramRoot: ideogramRoot ? resolve(ideogramRoot) : null,
    cosmosRoot: cosmosRoot ? resolve(cosmosRoot) : null,
    providerPython,
  });
  jsonWrite(join(runningJobDir, 'effective-command.json'), {
    command,
    shell: false,
    lockRunner: 'python3-fcntl-flock',
  });

  const lockedRun = runLockedChild({
    lockPath,
    statusPath,
    command,
    cwd: resolvedCwd,
    timeoutMs,
  });
  writeFileSync(join(runningJobDir, 'stdout.log'), lockedRun.stdout || '');
  writeFileSync(join(runningJobDir, 'stderr.log'), lockedRun.stderr || lockedRun.error?.message || '');

  const routeResultPath = join(runningJobDir, 'route-result.json');
  const routeResult = jsonReadIfExists(routeResultPath, null);
  const ok = lockedRun.status === 0 && routeResult?.ok === true;
  const ended = nowTiming();
  const finalStatus = ok ? 'complete' : 'failed';
  const receipt = {
    ok,
    identity: ORB_INNER_ENGINE_GREENROOM_ROUTE_IDENTITY,
    jobType: JOB_TYPE,
    jobId: resolvedJobId,
    providerId,
    bundleRoot: resolvedBundleRoot,
    queueDir: resolvedQueueDir,
    lockPath,
    startedAt: started.iso,
    endedAt: ended.iso,
    durationMs: ended.ms - started.ms,
    status: finalStatus,
    exitCode: lockedRun.status ?? null,
    signal: lockedRun.signal ?? null,
    failurePhase: ok ? null : (routeResult ? 'provider-route' : 'greenroom-child-exit'),
    failureReason: ok ? null : (routeResult?.failureReason || lockedRun.error?.message || `greenroom child exited with status ${lockedRun.status}`),
    routeResult,
  };
  jsonWrite(join(runningJobDir, 'receipt.json'), receipt);
  const previousStatus = jsonReadIfExists(statusPath, {});
  writeStatus(statusPath, {
    ...previousStatus,
    jobId: resolvedJobId,
    jobType: JOB_TYPE,
    providerId,
    bundleRoot: resolvedBundleRoot,
    queueDir: resolvedQueueDir,
    lockPath,
    status: finalStatus,
    endedAt: ended.iso,
  });

  const finalJobDir = join(resolvedQueueDir, ok ? 'done' : 'failed', resolvedJobId);
  rmSync(finalJobDir, { recursive: true, force: true });
  renameSync(runningJobDir, finalJobDir);
  return {
    ok,
    identity: ORB_INNER_ENGINE_GREENROOM_ROUTE_IDENTITY,
    status: finalStatus,
    jobType: JOB_TYPE,
    jobId: resolvedJobId,
    queueDir: resolvedQueueDir,
    finalJobDir,
    receiptPath: join(finalJobDir, 'receipt.json'),
    stdoutPath: join(finalJobDir, 'stdout.log'),
    stderrPath: join(finalJobDir, 'stderr.log'),
    routeResult,
  };
}

function runLockedChildProviderRoute(args) {
  const bundleRoot = args.get('--bundle-root');
  const providerId = args.get('--provider-id', 'local-image.ideogram4');
  const timeoutMs = Number(args.get('--timeout-ms', '900000'));
  const jobDir = args.get('--job-dir');
  const providerPython = args.get('--provider-python');
  const registry = createOrbInnerEngineProviderRegistry({
    ideogramRoot: args.get('--ideogram-root') || undefined,
    cosmosRoot: args.get('--cosmos-root') || undefined,
    pythonCommand: providerPython || 'python',
  });
  const result = runOrbInnerEngineProviderRoute({
    bundleRoot,
    providerId,
    timeoutMs,
    registry,
  });
  if (jobDir) {
    jsonWrite(join(jobDir, 'route-result.json'), result);
  }
  let records = null;
  try {
    records = result.recordsPath ? jsonReadIfExists(result.recordsPath, null) : null;
  } catch {
    records = null;
  }
  process.stdout.write(JSON.stringify({
    ok: result.ok,
    providerId,
    routeResult: result,
    recordsStdout: records?.records?.map(record => record.stdout || '').join('\n') || '',
  }, null, 2) + '\n');
  return result.ok ? 0 : 1;
}

const invokedAsScript = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (invokedAsScript) {
  const args = parseArgs(process.argv);
  if (args.has('--locked-child')) {
    process.exit(runLockedChildProviderRoute(args));
  }
  const result = runOrbInnerEngineGreenroomProviderRoute({
    queueDir: args.get('--queue-dir', DEFAULT_QUEUE_DIR),
    jobId: args.get('--job-id'),
    bundleRoot: args.get('--bundle-root'),
    providerId: args.get('--provider-id', 'local-image.ideogram4'),
    timeoutMs: Number(args.get('--timeout-ms', '900000')),
    ideogramRoot: args.get('--ideogram-root') || undefined,
    cosmosRoot: args.get('--cosmos-root') || undefined,
    providerPython: args.get('--provider-python') || null,
    cwd: args.get('--cwd', process.cwd()),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
