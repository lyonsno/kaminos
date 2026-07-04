#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createSharpImageToSplatRouteDefinition,
  createWebGpuRouteBackpressureProfile,
  createWebGpuRouteSchedulerProfile,
  validateWebGpuRouteBackpressureProfile,
  validateWebGpuRouteSchedulerProfile,
} from '@kaminos/webgpu-inference-kit';
import { createSchedulerVerificationReceipt } from '../lib/scheduler-verification-receipt.mjs';

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
const sharpRepo = resolve(process.env.KAMINOS_SHARP_WEBGPU_REPO || '/Users/noahlyons/dev/sharp-webgpu');
const chromePath = process.env.KAMINOS_SHARP_WEBGPU_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const requestedPort = Number(process.env.KAMINOS_SHARP_WEBGPU_PORT || 0);
const port = requestedPort || (54000 + Math.floor(Math.random() * 1000));
const timeoutMs = Number(process.env.KAMINOS_SHARP_WEBGPU_TIMEOUT_MS || 420000);
const requestedScheduler = parseRequestedScheduler();
const outputDir = output ? dirname(output) : null;
const depthPath = outputDir ? join(outputDir, 'sharp-webgpu-depth.png') : null;
const metadataPath = outputDir ? join(outputDir, 'sharp-webgpu-metadata.json') : null;
const artifactPaths = parseArtifactPaths(process.env.KAMINOS_PIPELINE_ARTIFACT_PATHS);
const autoCropEvidencePath = resolveArtifactPath(args.get('--autocrop-evidence') || process.env.KAMINOS_PIPELINE_AUTOCROP_EVIDENCE || artifactPaths.autoCropEvidence || (outputDir ? join(outputDir, 'sharp-output.splat-autocrop-evidence.json') : null));
const downloadDir = outputDir ? join(outputDir, '.sharp-webgpu-download') : null;
const url = `http://127.0.0.1:${port}/`;
const progressStreamEnabled = process.env.KAMINOS_PIPELINE_PROGRESS_STREAM === '1';

let phase = 'initializing';
let server = null;
const serverLogs = { stdout: '', stderr: '' };
const browserLogs = [];
const emittedBrowserProgressKeys = new Set();
const lastTrustworthyEvidence = {};

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseArtifactPaths(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function maybeNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function maybeBool(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function parseRequestedScheduler() {
  const scheduler = {
    ...parseJsonObject(process.env.KAMINOS_SHARP_WEBGPU_SCHEDULER),
  };
  const discrete = {
    spnPatchChunkSize: maybeNumber(process.env.KAMINOS_SHARP_WEBGPU_SPN_PATCH_CHUNK_SIZE),
    yieldMs: maybeNumber(process.env.KAMINOS_SHARP_WEBGPU_YIELD_MS),
    waitForSubmittedWorkDone: maybeBool(process.env.KAMINOS_SHARP_WEBGPU_WAIT_FOR_SUBMITTED_WORK_DONE),
    gaussianPhaseYieldMs: maybeNumber(process.env.KAMINOS_SHARP_WEBGPU_GAUSSIAN_PHASE_YIELD_MS),
    vitBlockChunkSize: maybeNumber(process.env.KAMINOS_SHARP_WEBGPU_VIT_BLOCK_CHUNK_SIZE),
  };
  for (const [key, value] of Object.entries(discrete)) {
    if (value !== undefined) scheduler[key] = value;
  }
  return {
    mode: scheduler.mode || (Object.keys(scheduler).length ? 'cooperative' : 'default'),
    ...scheduler,
  };
}

function schedulerEvidence(telemetry = null, statusOverride = null) {
  const effectiveScheduler = telemetry?.effectiveScheduler || null;
  const status = statusOverride || (effectiveScheduler ? (telemetry?.status || 'verified') : 'scheduler-unverified');
  return {
    schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
    status,
    requestedScheduler,
    effectiveScheduler,
    unsupportedFields: telemetry?.unsupportedFields || [],
    telemetry: telemetry || null,
  };
}

function uniqueTelemetryPhases(telemetry) {
  const phases = [];
  for (const event of telemetry?.events || []) {
    if (!event?.phase || phases.includes(event.phase)) continue;
    phases.push(event.phase);
  }
  return phases;
}

function phaseChunkSizeFromScheduler(scheduler = {}) {
  const phaseChunkSize = {};
  if (Number.isInteger(scheduler.spnPatchChunkSize) && scheduler.spnPatchChunkSize > 0) {
    phaseChunkSize.spnPatch = scheduler.spnPatchChunkSize;
  }
  if (Number.isInteger(scheduler.vitBlockChunkSize) && scheduler.vitBlockChunkSize > 0) {
    phaseChunkSize.vitBlock = scheduler.vitBlockChunkSize;
  }
  return phaseChunkSize;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sharpRouteDefinition() {
  return createSharpImageToSplatRouteDefinition();
}

function sharpRouteBreathability() {
  return cloneJson(sharpRouteDefinition().scheduler?.breathability);
}

function sharpRouteBackpressure() {
  return cloneJson(sharpRouteDefinition().backpressure);
}

function routeSchedulerInputFromBreathingRoom(breathingRoom = {}) {
  const requested = breathingRoom?.requestedScheduler || requestedScheduler;
  const effective = breathingRoom?.effectiveScheduler || {};
  const requestedMode = requested.mode === 'cooperative' ? 'cooperative' : 'throughput';
  const effectiveMode = effective.mode === 'cooperative' ? 'cooperative' : requestedMode;
  const hasEffectiveScheduler = Boolean(breathingRoom?.effectiveScheduler);
  const unsupportedFields = Array.isArray(breathingRoom?.unsupportedFields)
    ? breathingRoom.unsupportedFields
    : [];
  const verificationState = unsupportedFields.length
    ? 'unsupported'
    : (breathingRoom?.status || (breathingRoom?.effectiveScheduler ? 'verified' : 'scheduler-unverified'));
  return {
    requestedScheduler: {
      mode: requestedMode,
      yieldMs: requested.yieldMs ?? 0,
      waitForSubmittedWorkDone: Boolean(requested.waitForSubmittedWorkDone),
      phaseChunkSize: phaseChunkSizeFromScheduler(requested),
    },
    effectiveScheduler: {
      mode: effectiveMode,
      yieldMs: effective.yieldMs ?? requested.yieldMs ?? 0,
      waitForSubmittedWorkDone: Boolean(effective.waitForSubmittedWorkDone ?? requested.waitForSubmittedWorkDone),
      phaseChunkSize: phaseChunkSizeFromScheduler(effective),
      unsupportedFields: unsupportedFields.length
        ? ['phaseChunkSize', ...unsupportedFields.filter(field => field.startsWith('phaseChunkSize.'))]
        : (hasEffectiveScheduler ? [] : ['phaseChunkSize']),
    },
    verificationState,
    breathability: sharpRouteBreathability(),
  };
}

function createValidatedSchedulerProfile(breathingRoom = {}) {
  const profile = createWebGpuRouteSchedulerProfile(routeSchedulerInputFromBreathingRoom(breathingRoom));
  const validation = validateWebGpuRouteSchedulerProfile(profile);
  if (!validation.ok) throw new Error(`kit scheduler profile invalid: ${validation.errors.join('; ')}`);
  return profile;
}

function createValidatedBackpressureProfile() {
  const sharpProfile = sharpRouteBackpressure();
  const sharpValidation = validateWebGpuRouteBackpressureProfile(sharpProfile);
  if (sharpValidation.ok) return sharpProfile;
  const profile = createWebGpuRouteBackpressureProfile({
    requestedBudget: 'unknown',
    effectiveBudget: 'unknown',
    memoryExclusivity: 'unknown',
    warmCacheState: 'unknown',
    frameTail: {
      sampleWindowMs: 0,
      longFrameCount: 0,
      maxFrameGapMs: 0,
      p95FrameGapMs: null,
      p99FrameGapMs: null,
    },
  });
  const validation = validateWebGpuRouteBackpressureProfile(profile);
  if (!validation.ok) throw new Error(`kit backpressure profile invalid: ${validation.errors.join('; ')}`);
  return profile;
}

function adapterReportEvidenceForRoute() {
  if (!report) return null;
  return {
    path: report,
    bytes: null,
    sha256: null,
  };
}

function schedulerVerificationEventTrace(breathingRoom = null) {
  const telemetry = breathingRoom?.telemetry || null;
  if (telemetry?.eventTrace) return telemetry.eventTrace;
  return {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: telemetry?.clock || 'performance.now',
    timingAuthority: telemetry?.timingAuthority || (Array.isArray(telemetry?.events) && telemetry.events.length ? 'browser-wall-clock' : 'not-observed'),
    events: Array.isArray(telemetry?.events) ? telemetry.events : [],
  };
}

function schedulerVerificationFrameTail(breathingRoom = null) {
  const telemetry = breathingRoom?.telemetry || {};
  const frameTail = telemetry.frameTail || breathingRoom?.frameTail || {};
  return {
    evidenceSource: frameTail.evidenceSource || telemetry.timingAuthority || 'not-observed',
    disclaimer: frameTail.disclaimer || 'not-gpu-exclusive-or-present-latency',
    rafFps: frameTail.rafFps ?? telemetry.rafFps ?? null,
    frameP95Ms: frameTail.frameP95Ms ?? telemetry.frameP95Ms ?? null,
    queueDoneP95Ms: frameTail.queueDoneP95Ms ?? telemetry.queueDoneP95Ms ?? null,
  };
}

function schedulerVerificationReceipt(evidence, breathingRoom = null) {
  return createSchedulerVerificationReceipt({
    route: {
      pipelineId: process.env.KAMINOS_PIPELINE_ID || 'sharp-image-to-splat-live-v0',
      requestedRouteId: process.env.KAMINOS_PIPELINE_ROUTE_ID || 'adapter.sharp-image-to-splat-live.v0',
      effectiveRouteId: process.env.KAMINOS_PIPELINE_STAGE_ID || process.env.KAMINOS_PIPELINE_ROUTE_ID || 'adapter.sharp-image-to-splat-live.v0',
      backendClass: 'browser-webgpu',
      adapterReport: adapterReportEvidenceForRoute(),
    },
    scheduler: evidence.scheduler,
    backpressure: evidence.backpressure,
    eventTrace: schedulerVerificationEventTrace(breathingRoom),
    boundaryAssertions: breathingRoom?.boundaryAssertions || breathingRoom?.telemetry?.boundaryAssertions || [],
    frameTail: schedulerVerificationFrameTail(breathingRoom),
    unsupportedFields: evidence.unsupportedFields || breathingRoom?.unsupportedFields || [],
    downgrades: evidence.failureDowngrades || [],
  });
}

function pipelineSchedulerEvidence(breathingRoom) {
  const effectiveScheduler = breathingRoom?.effectiveScheduler || null;
  const unsupportedFields = Array.isArray(breathingRoom?.unsupportedFields)
    ? breathingRoom.unsupportedFields
    : [];
  const schedulerProfile = createValidatedSchedulerProfile(breathingRoom);
  const backpressureProfile = createValidatedBackpressureProfile();
  const verificationState = unsupportedFields.length
    ? 'unsupported'
    : (breathingRoom?.status || (effectiveScheduler ? 'verified' : 'scheduler-unverified'));
  const failureDowngrades = [];
  if (!effectiveScheduler) failureDowngrades.push('effective-scheduler-missing');
  if (unsupportedFields.length) failureDowngrades.push('unsupported-fields-present');
  const evidence = {
    schema: 'kaminos.pipeline-scheduler-composition.v0',
    source: 'pipeline-adapter-report',
    verificationState,
    requestedScheduler: breathingRoom?.requestedScheduler || requestedScheduler,
    effectiveScheduler,
    unsupportedFields,
    scheduler: schedulerProfile,
    backpressure: backpressureProfile,
    phaseBoundaries: uniqueTelemetryPhases(breathingRoom?.telemetry),
    backendIdentity: {
      modelFamily: 'SHARP-WebGPU',
      runtime: 'browser-webgpu',
      repo: sharpRepo,
      appUrl: url,
    },
    optimizationIdentity: {
      vitEncoderMode: effectiveScheduler
        ? (effectiveScheduler.vitBlockChunkSize ? 'split' : 'fused')
        : null,
      vitBlockChunkSize: effectiveScheduler?.vitBlockChunkSize ?? null,
      spnPatchChunkSize: effectiveScheduler?.spnPatchChunkSize ?? null,
      waitForSubmittedWorkDone: effectiveScheduler?.waitForSubmittedWorkDone ?? null,
      yieldMs: effectiveScheduler?.yieldMs ?? null,
      gaussianPhaseYieldMs: effectiveScheduler?.gaussianPhaseYieldMs ?? null,
    },
    raw: {
      breathingRoom,
    },
    failureDowngrades,
  };
  return {
    ...evidence,
    schedulerVerification: schedulerVerificationReceipt(evidence, breathingRoom),
  };
}

function resolveArtifactPath(value) {
  return value ? resolve(value) : null;
}

function fileEvidence(path) {
  const stat = statSync(path);
  return {
    path,
    bytes: stat.size,
    sha256: sha256File(path),
  };
}

function emitAdapterProgress(event = {}) {
  if (!progressStreamEnabled) return;
  const payload = {
    schema: 'kaminos.pipeline-progress.v0',
    kind: 'adapter-progress',
    source: 'sharp-webgpu-browser-console',
    status: 'running',
    at: new Date().toISOString(),
    adapterPhase: phase,
    ...event,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sharpBrowserProgressFromConsole(text) {
  const line = String(text || '').trim();
  if (!line) return null;
  const patchMatch = line.match(/\[SPN\]\s+Patch\s+(\d+)\/35 done/);
  if (patchMatch) {
    const patchDone = Number(patchMatch[1]);
    const ratio = Number.isFinite(patchDone) ? Math.max(0, Math.min(35, patchDone)) / 35 : 0;
    return {
      phase: 'sharp-webgpu:spn-patch-encoder',
      message: `[SPN] Patch ${patchDone}/35 done`,
      progress: 0.24 + ratio * 0.28,
      browserConsoleText: line,
    };
  }
  const milestones = [
    [/Loaded \d+ tensors from SHARP weight file/, 'sharp-webgpu:weights-loaded', 'SHARP weights loaded', 0.14],
    [/\[SPN\] Creating image pyramid/, 'sharp-webgpu:spn-image-pyramid', '[SPN] Creating image pyramid', 0.18],
    [/\[SPN\] Extracting patches/, 'sharp-webgpu:spn-extracting-patches', '[SPN] Extracting patches', 0.21],
    [/\[SPN\] Running patch encoder/, 'sharp-webgpu:spn-patch-encoder', '[SPN] Running patch encoder', 0.24],
    [/\[SPN\] Merging features/, 'sharp-webgpu:spn-merge-features', '[SPN] Merging features', 0.54],
    [/\[SPN\] Running image encoder/, 'sharp-webgpu:spn-image-encoder', '[SPN] Running image encoder', 0.58],
    [/\[SPN\] Running upsample fusion/, 'sharp-webgpu:spn-upsampling-fusion', '[SPN] Running upsample fusion', 0.64],
    [/\[Monodepth\] Running decoder/, 'sharp-webgpu:monodepth-decoder', '[Monodepth] Running decoder', 0.68],
    [/\[Monodepth\] Running disparity head/, 'sharp-webgpu:monodepth-disparity-head', '[Monodepth] Running disparity head', 0.72],
    [/\[Gaussian\] Running initializer/, 'sharp-webgpu:gaussian-initializer', '[Gaussian] Running initializer', 0.76],
    [/\[Gaussian\] Running decoder/, 'sharp-webgpu:gaussian-decoder', '[Gaussian] Running decoder', 0.80],
    [/\[Gaussian\] Running texture\/geometry heads/, 'sharp-webgpu:gaussian-heads', '[Gaussian] Running texture/geometry heads', 0.84],
    [/\[Gaussian\] Output:/, 'sharp-webgpu:gaussian-output', '[Gaussian] Gaussian output produced', 0.86],
    [/\[Compose\] Building base Gaussians/, 'sharp-webgpu:compose-base-gaussians', '[Compose] Building base Gaussians', 0.88],
    [/\[Compose\] Composing Gaussians/, 'sharp-webgpu:compose-gaussians', '[Compose] Composing Gaussians', 0.89],
    [/\[Compose\] Writing PLY/, 'sharp-webgpu:write-ply', '[Compose] Writing PLY', 0.90],
  ];
  for (const [pattern, phaseId, message, progress] of milestones) {
    if (!pattern.test(line)) continue;
    return {
      phase: phaseId,
      message,
      progress,
      browserConsoleText: line,
    };
  }
  return null;
}

function emitSharpBrowserProgress(text) {
  const event = sharpBrowserProgressFromConsole(text);
  if (!event) return null;
  const key = `${event.phase}:${event.message}`;
  if (emittedBrowserProgressKeys.has(key)) return null;
  emittedBrowserProgressKeys.add(key);
  emitAdapterProgress(event);
  return event;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function reportBase(extra = {}) {
  const breathingRoom = schedulerEvidence(extra.schedulerTelemetry || null, extra.schedulerStatus);
  const pipelineScheduler = pipelineSchedulerEvidence(breathingRoom);
  return {
    schema: 'kaminos.sharp-webgpu-adapter-report.v0',
    ok: extra.ok ?? false,
    phase,
    input: input ? {
      path: input,
      ...(existsSync(input) ? { sha256: sha256File(input), bytes: statSync(input).size } : {}),
    } : null,
    output: output ? {
      role: 'splat-candidate',
      path: output,
      ...(existsSync(output) ? fileEvidence(output) : {}),
    } : null,
    sideArtifacts: [],
    backend: {
      modelFamily: 'SHARP-WebGPU',
      runtime: 'browser-webgpu',
      repo: sharpRepo,
      appUrl: url,
      chromePath,
      weightsPath: join(sharpRepo, 'public', 'weights.bin'),
      requestedScheduler,
    },
    breathingRoom,
    schedulerVerification: pipelineScheduler.schedulerVerification,
    pipelineScheduler,
    lastTrustworthyEvidence,
    serverLogs: {
      stdoutTail: serverLogs.stdout.slice(-4000),
      stderrTail: serverLogs.stderr.slice(-4000),
    },
    browserLogs: browserLogs.slice(-80),
    ...extra,
  };
}

function writeReport(extra = {}) {
  if (report) writeJson(report, reportBase(extra));
}

function fail(error, extra = {}) {
  writeReport({
    ok: false,
    error: error?.message || String(error),
    ...extra,
  });
  console.error(error?.stack || error);
  process.exitCode = 1;
}

function validateInputs() {
  if (!input || !output || !report) throw new Error('expected --input, --output, and --report');
  if (!existsSync(input)) throw new Error(`input image does not exist: ${input}`);
  if (!existsSync(sharpRepo)) throw new Error(`SHARP-WebGPU repo does not exist: ${sharpRepo}`);
  if (!existsSync(join(sharpRepo, 'package.json'))) throw new Error(`SHARP-WebGPU package.json missing under ${sharpRepo}`);
  if (!existsSync(join(sharpRepo, 'public', 'weights.bin'))) throw new Error(`SHARP-WebGPU weights missing: ${join(sharpRepo, 'public', 'weights.bin')}`);
  if (!existsSync(chromePath)) throw new Error(`Chrome executable not found: ${chromePath}`);
  mkdirSync(outputDir, { recursive: true });
  rmSync(downloadDir, { recursive: true, force: true });
  mkdirSync(downloadDir, { recursive: true });
  lastTrustworthyEvidence.input = fileEvidence(input);
  lastTrustworthyEvidence.weights = fileEvidence(join(sharpRepo, 'public', 'weights.bin'));
}

function appendLog(kind, data) {
  const text = data.toString();
  serverLogs[kind] = `${serverLogs[kind]}${text}`.slice(-12000);
}

function startServer() {
  server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: sharpRepo,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => appendLog('stdout', chunk));
  server.stderr.on('data', chunk => appendLog('stderr', chunk));
  server.on('exit', (code, signal) => {
    if (code !== null) serverLogs.stderr = `${serverLogs.stderr}\n[Vite exited ${code}]`;
    if (signal) serverLogs.stderr = `${serverLogs.stderr}\n[Vite signaled ${signal}]`;
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error(`SHARP-WebGPU dev server exited before serving ${url}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until Vite binds the port.
    }
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250));
  }
  throw new Error(`timed out waiting for SHARP-WebGPU dev server at ${url}`);
}

async function loadPuppeteer() {
  const require = createRequire(import.meta.url);
  const puppeteerPath = require.resolve('puppeteer-core', { paths: [sharpRepo] });
  return import(pathToFileURL(puppeteerPath).href);
}

async function waitForDownload() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const names = readdirSync(downloadDir);
    const complete = names.find(name => name.endsWith('.ply'));
    const partial = names.find(name => name.endsWith('.crdownload'));
    if (complete && !partial) return join(downloadDir, complete);
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250));
  }
  throw new Error(`timed out waiting for SHARP-WebGPU PLY download under ${downloadDir}`);
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('depth canvas did not produce a PNG data URL');
  return Buffer.from(match[1], 'base64');
}

function pngDimensions(path) {
  const bytes = readFileSync(path);
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || bytes.length < 24) return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const plyTypeReaders = {
  char: { bytes: 1, read: (buffer, offset) => buffer.readInt8(offset) },
  int8: { bytes: 1, read: (buffer, offset) => buffer.readInt8(offset) },
  uchar: { bytes: 1, read: (buffer, offset) => buffer.readUInt8(offset) },
  uint8: { bytes: 1, read: (buffer, offset) => buffer.readUInt8(offset) },
  short: { bytes: 2, read: (buffer, offset) => buffer.readInt16LE(offset) },
  int16: { bytes: 2, read: (buffer, offset) => buffer.readInt16LE(offset) },
  ushort: { bytes: 2, read: (buffer, offset) => buffer.readUInt16LE(offset) },
  uint16: { bytes: 2, read: (buffer, offset) => buffer.readUInt16LE(offset) },
  int: { bytes: 4, read: (buffer, offset) => buffer.readInt32LE(offset) },
  int32: { bytes: 4, read: (buffer, offset) => buffer.readInt32LE(offset) },
  uint: { bytes: 4, read: (buffer, offset) => buffer.readUInt32LE(offset) },
  uint32: { bytes: 4, read: (buffer, offset) => buffer.readUInt32LE(offset) },
  float: { bytes: 4, read: (buffer, offset) => buffer.readFloatLE(offset) },
  float32: { bytes: 4, read: (buffer, offset) => buffer.readFloatLE(offset) },
  double: { bytes: 8, read: (buffer, offset) => buffer.readDoubleLE(offset) },
  float64: { bytes: 8, read: (buffer, offset) => buffer.readDoubleLE(offset) },
};

function parsePlyHeader(buffer) {
  const headerText = buffer.toString('utf8', 0, Math.min(buffer.length, 65536));
  const headerMatch = headerText.match(/[\s\S]*?end_header\r?\n/);
  if (!headerMatch) throw new Error('generated PLY is missing an end_header marker');
  const header = headerMatch[0];
  const lines = header.split(/\r?\n/).filter(Boolean);
  const formatLine = lines.find(line => line.startsWith('format '));
  const format = formatLine?.split(/\s+/)[1] || null;
  const vertexElementIndex = lines.findIndex(line => line.startsWith('element vertex '));
  if (vertexElementIndex < 0) throw new Error('generated PLY is missing element vertex');
  const vertexCount = Number(lines[vertexElementIndex].split(/\s+/)[2]);
  if (!Number.isFinite(vertexCount) || vertexCount <= 0) throw new Error(`generated PLY has invalid vertex count: ${vertexCount}`);
  const properties = [];
  for (let i = vertexElementIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('element ')) break;
    const parts = line.split(/\s+/);
    if (parts[0] !== 'property' || parts[1] === 'list') continue;
    properties.push({ type: parts[1], name: parts[2] });
  }
  for (const axis of ['x', 'y', 'z']) {
    if (!properties.some(property => property.name === axis)) throw new Error(`generated PLY is missing ${axis} vertex property`);
  }
  return {
    format,
    vertexCount,
    properties,
    headerBytes: Buffer.byteLength(header),
  };
}

function updateBounds(bounds, x, y, z) {
  bounds.min.x = Math.min(bounds.min.x, x);
  bounds.min.y = Math.min(bounds.min.y, y);
  bounds.min.z = Math.min(bounds.min.z, z);
  bounds.max.x = Math.max(bounds.max.x, x);
  bounds.max.y = Math.max(bounds.max.y, y);
  bounds.max.z = Math.max(bounds.max.z, z);
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function finalizePlyBounds(header, bounds, sums, observed) {
  if (observed <= 0) throw new Error('generated PLY had no readable vertices');
  return {
    format: header.format,
    vertexCount: header.vertexCount,
    observedVertexCount: observed,
    bounds: {
      min: {
        x: roundCoord(bounds.min.x),
        y: roundCoord(bounds.min.y),
        z: roundCoord(bounds.min.z),
      },
      max: {
        x: roundCoord(bounds.max.x),
        y: roundCoord(bounds.max.y),
        z: roundCoord(bounds.max.z),
      },
    },
    centroid: {
      x: roundCoord(sums.x / observed),
      y: roundCoord(sums.y / observed),
      z: roundCoord(sums.z / observed),
    },
  };
}

function computePlyBounds(path) {
  const buffer = readFileSync(path);
  const header = parsePlyHeader(buffer);
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  const sums = { x: 0, y: 0, z: 0 };
  let observed = 0;

  if (header.format === 'ascii') {
    const body = buffer.toString('utf8', header.headerBytes);
    const lines = body.split(/\r?\n/).filter(Boolean);
    for (let i = 0; i < header.vertexCount; i += 1) {
      const parts = lines[i]?.trim().split(/\s+/).map(Number);
      if (!parts || parts.some(value => !Number.isFinite(value))) continue;
      const row = Object.fromEntries(header.properties.map((property, index) => [property.name, parts[index]]));
      const { x, y, z } = row;
      if (![x, y, z].every(Number.isFinite)) continue;
      updateBounds(bounds, x, y, z);
      sums.x += x;
      sums.y += y;
      sums.z += z;
      observed += 1;
    }
    return finalizePlyBounds(header, bounds, sums, observed);
  }

  if (header.format !== 'binary_little_endian') throw new Error(`unsupported generated PLY format for autocrop evidence: ${header.format}`);
  const propertyReaders = header.properties.map(property => {
    const reader = plyTypeReaders[property.type];
    if (!reader) throw new Error(`unsupported PLY vertex property type: ${property.type}`);
    return { name: property.name, ...reader };
  });
  const stride = propertyReaders.reduce((total, property) => total + property.bytes, 0);
  const requiredBytes = header.headerBytes + stride * header.vertexCount;
  if (buffer.length < requiredBytes) throw new Error(`generated PLY is truncated: expected at least ${requiredBytes} bytes, saw ${buffer.length}`);
  const propertyOffsets = [];
  let cursor = 0;
  for (const property of propertyReaders) {
    propertyOffsets.push({ ...property, offset: cursor });
    cursor += property.bytes;
  }
  for (let i = 0; i < header.vertexCount; i += 1) {
    const base = header.headerBytes + i * stride;
    const row = Object.fromEntries(propertyOffsets.map(property => [property.name, property.read(buffer, base + property.offset)]));
    const { x, y, z } = row;
    if (![x, y, z].every(Number.isFinite)) continue;
    updateBounds(bounds, x, y, z);
    sums.x += x;
    sums.y += y;
    sums.z += z;
    observed += 1;
  }
  return finalizePlyBounds(header, bounds, sums, observed);
}

function writeAutoCropEvidence(outputPath, context) {
  if (!autoCropEvidencePath) throw new Error('missing autocrop evidence output path');
  const pointCloud = computePlyBounds(outputPath);
  const depthDimensions = pngDimensions(depthPath);
  const downgrades = [];
  if (!artifactPaths.sidecar && !process.env.KAMINOS_PIPELINE_SIDECAR) downgrades.push('sidecar-path-not-provided-at-adapter-phase');
  if (!depthDimensions) downgrades.push('depth-image-dimensions-unreadable');
  writeJson(autoCropEvidencePath, {
    schema: 'kaminos.splat-autocrop-evidence.v0',
    status: 'complete',
    authority: {
      producer: 'kaminos.pipeline.sharp-webgpu-adapter',
      freshness: 'fresh',
      evidenceMode: 'derived-from-generated-ply-and-sharp-depth',
      routeIdentity: {
        pipelineId: process.env.KAMINOS_PIPELINE_ID || null,
        routeId: process.env.KAMINOS_PIPELINE_ROUTE_ID || null,
        stageId: process.env.KAMINOS_PIPELINE_STAGE_ID || null,
      },
      downgrades,
    },
    sourceImage: fileEvidence(input),
    generated: {
      ply: fileEvidence(outputPath),
      sidecar: {
        path: process.env.KAMINOS_PIPELINE_SIDECAR || artifactPaths.sidecar || null,
        routeIdentity: process.env.KAMINOS_PIPELINE_ID || null,
        status: 'path-reserved-by-pipeline-witness',
      },
    },
    sharp: {
      depthMap: {
        ...fileEvidence(depthPath),
        dimensions: depthDimensions,
      },
      metadata: fileEvidence(metadataPath),
      inference: context.result || null,
      scheduler: schedulerEvidence(context.result?.schedulerTelemetry || null),
    },
    cropSignal: {
      provenance: 'generated PLY vertex bounds plus SHARP depth output captured in the same adapter run',
      pointCloud,
      bounds: pointCloud.bounds,
      suggestedPivot: pointCloud.centroid,
      candidateCrop: {
        min: { x: pointCloud.bounds.min.x, y: pointCloud.bounds.min.y },
        max: { x: pointCloud.bounds.max.x, y: pointCloud.bounds.max.y },
        units: 'splat-local-xy',
      },
      mask: {
        path: null,
        reason: 'mask surface not emitted by SHARP-WebGPU adapter v0',
      },
    },
    rejectedDebugSurfaces: [],
  });
}

async function runBrowserInference() {
  const { default: puppeteer } = await loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: process.env.KAMINOS_SHARP_WEBGPU_HEADED === '1' ? false : 'new',
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--disable-gpu-sandbox',
      '--no-sandbox',
      '--disable-gpu-shader-disk-cache',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      const text = msg.text();
      browserLogs.push({ type: msg.type(), text });
      emitSharpBrowserProgress(text);
    });
    page.on('pageerror', error => browserLogs.push({ type: 'pageerror', text: error?.message || String(error) }));

    const session = await page.target().createCDPSession();
    await session.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
    });

    phase = 'loading-sharp-webgpu-page';
    const browserUrl = new URL(url);
    browserUrl.searchParams.set('sharpScheduler', JSON.stringify(requestedScheduler));
    await page.goto(browserUrl.href, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.$eval('#use-spn', element => {
      element.checked = true;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });

    phase = 'uploading-input-image';
    const fileInput = await page.$('#file-input');
    if (!fileInput) throw new Error('SHARP-WebGPU file input not found');
    await fileInput.uploadFile(input);

    phase = 'running-sharp-webgpu-inference';
    const outcome = await page.waitForFunction(() => {
      const errorEl = document.getElementById('error');
      if (errorEl && errorEl.style.display !== 'none' && errorEl.textContent.trim()) {
        return JSON.stringify({ ok: false, error: errorEl.textContent.trim() });
      }
      const link = document.getElementById('download-ply');
      const validEl = document.getElementById('r-valid');
      if (link?.href?.startsWith('blob:') && validEl?.textContent === 'OK') {
        return JSON.stringify({
          ok: true,
          model: document.getElementById('r-model')?.textContent || null,
          weights: document.getElementById('r-weights')?.textContent || null,
          grid: document.getElementById('r-grid')?.textContent || null,
          features: document.getElementById('r-features')?.textContent || null,
          time: document.getElementById('r-time')?.textContent || null,
          valid: validEl.textContent,
          downloadText: link.textContent || null,
          schedulerTelemetry: window.__SHARP_LAST_RUN_TELEMETRY__ || null,
        });
      }
      return false;
    }, { timeout: timeoutMs });
    const result = JSON.parse(await outcome.jsonValue());
    if (!result.ok) throw new Error(result.error || 'SHARP-WebGPU page reported failure');

    phase = 'downloading-ply';
    await page.click('#download-ply');
    const downloadedPly = await waitForDownload();
    renameSync(downloadedPly, output);

    phase = 'capturing-depth-output';
    const depthDataUrl = await page.$eval('#depth-canvas', canvas => canvas.toDataURL('image/png'));
    writeFileSync(depthPath, dataUrlToBuffer(depthDataUrl));

    phase = 'writing-metadata';
    const metadata = {
      schema: 'kaminos.sharp-webgpu-metadata.v0',
      backend: {
        modelFamily: 'SHARP-WebGPU',
        runtime: 'browser-webgpu',
        repo: sharpRepo,
        appUrl: url,
      },
      scheduler: schedulerEvidence(result.schedulerTelemetry || null),
      result,
      input: fileEvidence(input),
      output: fileEvidence(output),
      depthMap: fileEvidence(depthPath),
    };
    writeJson(metadataPath, metadata);
    writeAutoCropEvidence(output, { result, metadata });
    return { result, metadata };
  } finally {
    await browser.close().catch(() => {});
  }
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  setTimeout(() => {
    if (server && server.exitCode === null) server.kill('SIGKILL');
  }, 1500).unref();
  server.stdout?.destroy();
  server.stderr?.destroy();
}

try {
  phase = 'validating-native-substrate';
  validateInputs();
  phase = 'starting-sharp-webgpu-server';
  startServer();
  await waitForServer();
  const browserResult = await runBrowserInference();
  phase = 'complete';
  const sideArtifacts = [
    { id: 'depthMap', role: 'depth-map', ...fileEvidence(depthPath) },
    { id: 'metadata', role: 'sharp-webgpu-metadata', ...fileEvidence(metadataPath) },
    { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', schema: 'kaminos.splat-autocrop-evidence.v0', ...fileEvidence(autoCropEvidencePath) },
  ];
  writeReport({
    ok: true,
    output: {
      role: 'splat-candidate',
      ...fileEvidence(output),
    },
    outputBytes: statSync(output).size,
    sideArtifacts,
    outputs: {
      splat: { id: 'splat', role: 'splat-candidate', ...fileEvidence(output) },
      depthMap: sideArtifacts[0],
      metadata: sideArtifacts[1],
      autoCropEvidence: sideArtifacts[2],
    },
    inference: browserResult.result,
    schedulerTelemetry: browserResult.result.schedulerTelemetry || null,
    schedulerStatus: browserResult.result.schedulerTelemetry ? null : 'scheduler-unverified',
    metadataPath,
    depthPath,
    autoCropEvidencePath,
  });
} catch (error) {
  fail(error);
} finally {
  stopServer();
  if (downloadDir) rmSync(downloadDir, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}
