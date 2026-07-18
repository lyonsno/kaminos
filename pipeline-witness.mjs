#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  classifyWebGpuRouteReceiptEvidence,
  createSharpImageToSplatRouteDefinition,
  createWebGpuRouteBackpressureProfile,
  createWebGpuRouteSchedulerProfile,
  validateWebGpuRouteBackpressureProfile,
  validateWebGpuRouteSchedulerProfile,
} from '@kaminos/webgpu-inference-kit';
import { createSchedulerVerificationReceipt } from './lib/scheduler-verification-receipt.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i++;
  } else {
    args.set(key, '1');
  }
}

const defaultManifest = new URL('./pipelines/asset-pipelines.json', import.meta.url).pathname;
const manifestPath = resolve(args.get('--manifest') || defaultManifest);
const requestedPipelineId = args.get('--pipeline-id') || 'evil-orb-sharp-fixture-pbr-v0';
const inputPath = args.get('--input') ? resolve(args.get('--input')) : null;
const outDir = args.get('--out-dir') ? resolve(args.get('--out-dir')) : null;
const reportPath = args.get('--report') ? resolve(args.get('--report')) : (outDir ? join(outDir, 'pipeline-witness.json') : resolve('/tmp/kaminos-pipeline-witness.json'));
const bundleIndexPath = outDir ? join(outDir, 'pipeline-run.index.json') : null;

let phase = 'initializing';
let manifest = null;
let manifestSha256 = null;
let pipeline = null;
let lastTrustworthyEvidence = {};
const stages = [];
const artifacts = {};
const progressStreamEnabled = process.env.KAMINOS_PIPELINE_PROGRESS_STREAM === '1';
const sharpFixtureSplatCandidates = [
  '/Users/noahlyons/.local/state/kaminos-smoke/splats/inbox/evil_orb_trimmed_050.ply',
  '/Users/noahlyons/.local/state/kaminos-smoke/splats/inbox/evil_orb_full_pbr_2k.ply',
  '/Users/noahlyons/.local/state/kaminos-smoke/splats/inbox/evil_orb.ply',
].map(path => ({ path, mode: 'local-candidate' }));

function emitPipelineProgress(event = {}) {
  if (!progressStreamEnabled) return;
  const payload = {
    schema: 'kaminos.pipeline-progress.v0',
    kind: 'pipeline-progress',
    requestedPipelineId,
    effectivePipelineId: pipeline?.id || null,
    phase,
    at: new Date().toISOString(),
    ...event,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function forwardAdapterProgressLine(line, effectiveRoute = {}) {
  const text = String(line || '').trim();
  if (!text) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed?.schema !== 'kaminos.pipeline-progress.v0') return null;
  const forwarded = {
    ...parsed,
    schema: 'kaminos.pipeline-progress.v0',
    kind: parsed.kind || 'adapter-progress',
    source: parsed.source || 'adapter-stdout',
    adapterRouteId: effectiveRoute.id || null,
    adapterTool: effectiveRoute.tool || null,
    requestedPipelineId,
    effectivePipelineId: pipeline?.id || null,
    at: parsed.at || new Date().toISOString(),
  };
  emitPipelineProgress(forwarded);
  return forwarded;
}

function collectTail(chunks, maxChars = 4000) {
  return chunks.join('').slice(-maxChars);
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function artifactPathFor(artifactId) {
  const artifact = pipeline?.artifacts?.[artifactId];
  if (!artifact?.pathTemplate) return null;
  if (isAbsolute(artifact.pathTemplate)) {
    throw new Error(`artifact ${artifactId} uses an absolute pathTemplate; pipeline outputs must be caller-rooted`);
  }
  return resolve(outDir, artifact.pathTemplate);
}

function artifactPathMap() {
  return Object.fromEntries(Object.keys(pipeline?.artifacts || {})
    .map(artifactId => [artifactId, artifactPathFor(artifactId)])
    .filter(([, path]) => path));
}

function fileEvidence(path) {
  const stat = statSync(path);
  return {
    path,
    bytes: stat.size,
    sha256: sha256Bytes(readFileSync(path)),
  };
}

function candidatePathList(value) {
  return (value || '')
    .split(delimiter)
    .map(candidate => candidate.trim())
    .filter(Boolean);
}

function resolveSharpFixtureSplat() {
  const explicitPath = (process.env.KAMINOS_SHARP_FIXTURE_SPLAT || '').trim();
  const explicitCandidates = explicitPath ? [{ path: explicitPath, mode: 'env' }] : [];
  const listCandidates = candidatePathList(process.env.KAMINOS_SHARP_FIXTURE_SPLAT_CANDIDATES)
    .map(path => ({ path, mode: 'env-candidate-list' }));
  for (const candidate of [...explicitCandidates, ...listCandidates, ...sharpFixtureSplatCandidates]) {
    const resolvedPath = resolve(candidate.path);
    if (!existsSync(resolvedPath)) continue;
    const stat = statSync(resolvedPath);
    if (!stat.isFile()) continue;
    return {
      path: resolvedPath,
      mode: candidate.mode,
    };
  }
  return null;
}

function reportBase(extra = {}) {
  return {
    schema: 'kaminos.pipeline-witness.v0',
    ok: extra.ok ?? false,
    requestedPipelineId,
    effectivePipelineId: pipeline?.id || null,
    phase,
    effectiveRouteConfig: {
      routeId: pipeline?.routeId || null,
      manifestPath,
      manifestSha256,
      outputRoot: outDir,
      stageCount: Array.isArray(pipeline?.stages) ? pipeline.stages.length : 0,
    },
    artifacts,
    stages,
    lastTrustworthyEvidence,
    ...extra,
  };
}

function writeReport(extra = {}) {
  writeJson(reportPath, reportBase(extra));
}

function buildBundleIndex() {
  return {
    schema: 'kaminos.pipeline-run-bundle.v0',
    registryScope: 'run-local',
    pipeline: {
      id: pipeline.id,
      routeId: pipeline.routeId,
      manifestPath,
      manifestSha256,
    },
    outputRoot: outDir,
    report: {
      path: reportPath,
      status: 'written',
    },
    stageStatuses: stages.map(stage => ({
      id: stage.id,
      status: stage.status,
      routeId: stage.requestedRoute,
    })),
    artifacts: Object.entries(artifacts).map(([id, artifact]) => ({
      id,
      role: artifact.role,
      status: artifact.status,
      path: artifact.path,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      fixtureSource: artifact.fixtureSource || null,
    })),
  };
}

function writeBundleIndex() {
  if (!bundleIndexPath) throw new Error('missing --out-dir for bundle index');
  writeJson(bundleIndexPath, buildBundleIndex());
  return {
    path: bundleIndexPath,
    status: 'written',
    ...fileEvidence(bundleIndexPath),
  };
}

function requireInputs() {
  if (!inputPath) throw new Error('missing --input');
  if (!outDir) throw new Error('missing --out-dir');
  if (!existsSync(inputPath)) throw new Error(`input artifact does not exist: ${inputPath}`);
}

function makeFixturePly(outputPath) {
  const fixtureSource = resolveSharpFixtureSplat();
  mkdirSync(dirname(outputPath), { recursive: true });
  if (fixtureSource) {
    copyFileSync(fixtureSource.path, outputPath);
    return {
      stageMode: 'fixture',
      mode: fixtureSource.mode,
      truthBoundary: 'fixture-backed copied SHARP-derived splat; not live SHARP inference',
      ...fileEvidence(fixtureSource.path),
    };
  }

  const inputBytes = readFileSync(inputPath);
  const inputHash = sha256Bytes(inputBytes);
  writeFileSync(outputPath, [
    'ply',
    'format ascii 1.0',
    'comment kaminos fixture splat candidate',
    `comment source_path ${inputPath}`,
    `comment source_sha256 ${inputHash}`,
    'element vertex 1',
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
    '0 0 0 255 128 32',
    '',
  ].join('\n'));
  return {
    stageMode: 'fixture',
    mode: 'generated-placeholder',
    path: null,
    bytes: null,
    sha256: null,
    inputPath,
    inputSha256: inputHash,
    truthBoundary: 'generated one-vertex placeholder because no SHARP fixture splat source was configured or found',
  };
}

function makeSidecar(outputPath, options = {}) {
  const splatPath = artifactPathFor('splat');
  const inputEvidence = fileEvidence(inputPath);
  const splatEvidence = fileEvidence(splatPath);
  const stageMode = options.stageMode || artifacts.splat?.status || 'fixture';
  const truthBoundary = options.truthBoundary || 'fixture-backed pipeline witness; not real SHARP, MoGE, SuperMat, Trellis, or hybrid render proof';
  const sideArtifacts = Object.entries(artifacts)
    .filter(([id]) => !['input', 'splat', 'sidecar'].includes(id))
    .map(([id, artifact]) => ({
      id,
      role: artifact.role,
      status: artifact.status,
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    }));
  writeJson(outputPath, {
    schema: 'kaminos.pipeline-import-sidecar.v0',
    pipeline: {
      id: pipeline.id,
      routeId: pipeline.routeId,
      manifestPath,
      manifestSha256,
    },
    source: {
      inputPath,
      inputSha256: inputEvidence.sha256,
    },
    asset: {
      type: 'splat',
      path: splatPath,
      sha256: splatEvidence.sha256,
      bytes: splatEvidence.bytes,
      fixtureSource: artifacts.splat?.fixtureSource || null,
      renderCapabilities: {
        realHybridRender: false,
        meshDepthOcclusion: false,
        sharedCanvasComposite: false,
        sharedCommandEncoder: false,
      },
      sideArtifacts,
    },
    status: {
      stageMode,
      truthBoundary,
    },
  });
}

function classifyPreparedArtifact(path) {
  const extension = extname(path).toLowerCase();
  if (['.ply', '.spz'].includes(extension)) return { kind: 'splat', extension };
  if (['.glb', '.gltf', '.obj'].includes(extension)) return { kind: 'mesh', extension };
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return { kind: 'source-image', extension };
  return { kind: 'unknown', extension };
}

function makePreparedInspection(outputPath) {
  const evidence = fileEvidence(inputPath);
  const classification = classifyPreparedArtifact(inputPath);
  writeJson(outputPath, {
    schema: 'kaminos.prepared-artifact-inspection.v0',
    artifact: {
      ...evidence,
      kind: classification.kind,
      extension: classification.extension,
      preparedElsewhere: true,
    },
    route: {
      id: pipeline.routeId,
      manifestPath,
      manifestSha256,
    },
    truthBoundary: 'local prepared-artifact inspection only; no model execution and no renderer proof',
  });
}

function makePreparedSidecar(outputPath) {
  const inspectionPath = artifactPathFor('inspection');
  const inspection = readJson(inspectionPath);
  const inputEvidence = fileEvidence(inputPath);
  writeJson(outputPath, {
    schema: 'kaminos.pipeline-import-sidecar.v0',
    pipeline: {
      id: pipeline.id,
      routeId: pipeline.routeId,
      manifestPath,
      manifestSha256,
    },
    source: {
      inputPath,
      inputSha256: inputEvidence.sha256,
      preparedArtifactInspectionPath: inspectionPath,
      preparedArtifactKind: inspection.artifact.kind,
    },
    asset: {
      type: inspection.artifact.kind,
      path: inputPath,
      sha256: inputEvidence.sha256,
      bytes: inputEvidence.bytes,
      renderCapabilities: {
        realHybridRender: false,
        meshDepthOcclusion: false,
        sharedCanvasComposite: false,
        sharedCommandEncoder: false,
      },
    },
    status: {
      stageMode: 'prepared-artifact',
      truthBoundary: 'prepared artifact sidecar; points at an existing local artifact and does not claim model generation or hybrid render proof',
    },
  });
}

function findCommand(command) {
  if (!command) return null;
  if (isAbsolute(command)) return existsSync(command) ? command : null;
  const manifestRelative = resolve(dirname(manifestPath), command);
  if (existsSync(manifestRelative)) return manifestRelative;
  const cwdRelative = resolve(process.cwd(), command);
  if (existsSync(cwdRelative)) return cwdRelative;
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function adapterAvailability(stage) {
  const envVar = stage.route?.commandEnv || null;
  const envCommand = envVar ? (process.env[envVar] || '').trim() : '';
  const defaultCommand = (stage.route?.commandDefault || '').trim();
  const configuredCommand = envCommand || defaultCommand;
  if (!configuredCommand) {
    return {
      status: 'unconfigured',
      envVar,
      commandDefault: defaultCommand || null,
      source: 'missing',
      configuredCommand: null,
      resolvedCommand: null,
    };
  }
  const resolvedCommand = findCommand(configuredCommand);
  return {
    status: resolvedCommand ? 'available' : 'missing',
    envVar,
    commandDefault: defaultCommand || null,
    source: envCommand ? 'env' : 'default',
    configuredCommand,
    resolvedCommand,
  };
}

function makeAdapterAvailabilityReport(outputPath, stage, availability) {
  writeJson(outputPath, {
    schema: 'kaminos.route-adapter-availability.v0',
    route: {
      id: stage.route?.id || stage.id,
      tool: stage.route?.tool || null,
      modelFamily: stage.route?.modelFamily || null,
      executesModel: false,
    },
    availability,
    execution: {
      executed: false,
      reason: 'availability-check-only',
    },
    input: {
      path: inputPath,
      sha256: fileEvidence(inputPath).sha256,
    },
  });
}

function liveAdapterReportPath(outputPath, stage) {
  const safeStage = String(stage.id || 'adapter').replace(/[^A-Za-z0-9_.-]+/g, '-');
  return join(dirname(outputPath), `${safeStage}.adapter-report.json`);
}

function readJsonIfExists(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      schema: 'unparseable-json',
      error: error?.message || String(error),
    };
  }
}

function uniqueAdapterPhases(telemetry) {
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

function routeSchedulerInputFromEvidence({
  requestedScheduler = {},
  effectiveScheduler = null,
  unsupportedFields = [],
  verificationState = 'scheduler-unverified',
  breathability = null,
} = {}) {
  const requestedMode = requestedScheduler.mode === 'cooperative' ? 'cooperative' : 'throughput';
  const effectiveMode = effectiveScheduler?.mode === 'cooperative' ? 'cooperative' : requestedMode;
  const hasEffectiveScheduler = Boolean(effectiveScheduler);
  const profileVerificationState = unsupportedFields.length
    ? 'unsupported'
    : verificationState;
  return {
    requestedScheduler: {
      mode: requestedMode,
      yieldMs: requestedScheduler.yieldMs ?? 0,
      waitForSubmittedWorkDone: Boolean(requestedScheduler.waitForSubmittedWorkDone),
      phaseChunkSize: phaseChunkSizeFromScheduler(requestedScheduler),
    },
    effectiveScheduler: {
      mode: effectiveMode,
      yieldMs: effectiveScheduler?.yieldMs ?? requestedScheduler.yieldMs ?? 0,
      waitForSubmittedWorkDone: Boolean(effectiveScheduler?.waitForSubmittedWorkDone ?? requestedScheduler.waitForSubmittedWorkDone),
      phaseChunkSize: phaseChunkSizeFromScheduler(effectiveScheduler || {}),
      unsupportedFields: unsupportedFields.length
        ? ['phaseChunkSize', ...unsupportedFields.filter(field => field.startsWith('phaseChunkSize.'))]
        : (hasEffectiveScheduler ? [] : ['phaseChunkSize']),
    },
    verificationState: profileVerificationState,
    breathability: breathability || undefined,
  };
}

function createValidatedSchedulerProfile(input = {}) {
  const profile = createWebGpuRouteSchedulerProfile(routeSchedulerInputFromEvidence(input));
  const validation = validateWebGpuRouteSchedulerProfile(profile);
  if (!validation.ok) throw new Error(`kit scheduler profile invalid: ${validation.errors.join('; ')}`);
  return profile;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pipelineKitDefaultRouteDefinition(report = null, effectiveRoute = null) {
  const tokens = [
    report?.schema,
    report?.backend?.modelFamily,
    report?.backend?.runtime,
    effectiveRoute?.id,
    effectiveRoute?.tool,
    effectiveRoute?.modelFamily,
    effectiveRoute?.effectiveBackend,
    pipeline?.id,
    pipeline?.routeId,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!tokens.includes('sharp')) return null;
  return createSharpImageToSplatRouteDefinition();
}

function pipelineKitDefaultBreathability(report = null, effectiveRoute = null) {
  return cloneJson(pipelineKitDefaultRouteDefinition(report, effectiveRoute)?.scheduler?.breathability) || {
    spans: [],
    checkpoints: [],
    notes: 'No kit breathability metadata was available for this route.',
  };
}

function pipelineKitDefaultBackpressure(report = null, effectiveRoute = null) {
  const profile = cloneJson(pipelineKitDefaultRouteDefinition(report, effectiveRoute)?.backpressure);
  const validation = validateWebGpuRouteBackpressureProfile(profile);
  if (validation.ok) return profile;
  return null;
}

function adapterBackendIdentity(report, effectiveRoute = null) {
  const schema = String(report?.schema || '').toLowerCase();
  const backend = report?.backend || {};
  return {
    modelFamily: backend.modelFamily || effectiveRoute?.tool || (schema.includes('sharp') ? 'SHARP-WebGPU' : null),
    runtime: backend.runtime || (schema.includes('mock') ? 'mock-adapter' : effectiveRoute?.effectiveBackend || null),
    repo: backend.repo || null,
    appUrl: backend.appUrl || null,
    effectiveBackend: effectiveRoute?.effectiveBackend || null,
  };
}

function emptyOptimizationIdentity() {
  return {
    vitEncoderMode: null,
    vitBlockChunkSize: null,
    spnPatchChunkSize: null,
    waitForSubmittedWorkDone: null,
    yieldMs: null,
    gaussianPhaseYieldMs: null,
  };
}

function backpressurePlaceholder(report = null, effectiveRoute = null) {
  const routeProfile = pipelineKitDefaultBackpressure(report, effectiveRoute);
  if (routeProfile) return routeProfile;
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

function schedulerProfileHasBreathability(profile) {
  return Array.isArray(profile?.breathability?.spans)
    && profile.breathability.spans.length > 0
    && Array.isArray(profile?.breathability?.checkpoints)
    && profile.breathability.checkpoints.length > 0;
}

function validateOrNormalizePipelineSchedulerEvidence(evidence, report = null, effectiveRoute = null) {
  const schedulerValidation = validateWebGpuRouteSchedulerProfile(evidence?.scheduler);
  const backpressureValidation = validateWebGpuRouteBackpressureProfile(evidence?.backpressure);
  if (schedulerValidation.ok && backpressureValidation.ok && schedulerProfileHasBreathability(evidence?.scheduler)) {
    return {
      ...evidence,
      schedulerVerification: evidence.schedulerVerification || schedulerVerificationReceipt(evidence, report, effectiveRoute),
    };
  }
  const unsupportedFields = Array.isArray(evidence?.unsupportedFields) ? evidence.unsupportedFields : [];
  const normalized = {
    ...evidence,
    verificationState: unsupportedFields.length ? 'unsupported' : evidence?.verificationState,
    scheduler: createValidatedSchedulerProfile({
      requestedScheduler: evidence?.requestedScheduler || evidence?.scheduler?.requestedScheduler || {},
      effectiveScheduler: evidence?.effectiveScheduler || evidence?.scheduler?.effectiveScheduler || null,
      unsupportedFields,
      verificationState: evidence?.verificationState === 'verified' ? 'verified' : 'scheduler-unverified',
      breathability: evidence?.scheduler?.breathability || pipelineKitDefaultBreathability(report, effectiveRoute),
    }),
    backpressure: backpressureValidation.ok ? evidence.backpressure : backpressurePlaceholder(report, effectiveRoute),
    failureDowngrades: [
      ...(Array.isArray(evidence?.failureDowngrades) ? evidence.failureDowngrades : []),
      ...(schedulerValidation.ok ? [] : ['scheduler-profile-normalized-by-kit']),
      ...(backpressureValidation.ok ? [] : ['backpressure-profile-normalized-by-kit']),
      ...(schedulerProfileHasBreathability(evidence?.scheduler) ? [] : ['breathability-profile-added-from-kit-route']),
    ],
  };
  return {
    ...normalized,
    schedulerVerification: evidence?.schedulerVerification || schedulerVerificationReceipt(normalized, report, effectiveRoute),
  };
}

function adapterReportEvidence(report, effectiveRoute = null) {
  const path = effectiveRoute?.adapterReportPath || report?.path || null;
  if (!path) return null;
  if (!existsSync(path)) return { path, bytes: null, sha256: null };
  return fileEvidence(path);
}

function schedulerVerificationRoute(report = null, effectiveRoute = null) {
  return {
    pipelineId: pipeline?.id || requestedPipelineId,
    requestedRouteId: pipeline?.routeId || effectiveRoute?.id || null,
    effectiveRouteId: effectiveRoute?.id || pipeline?.routeId || null,
    backendClass: effectiveRoute?.effectiveBackend || report?.backend?.runtime || null,
    adapterReport: adapterReportEvidence(report, effectiveRoute),
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

function schedulerVerificationBoundaryAssertions(breathingRoom = null) {
  if (Array.isArray(breathingRoom?.boundaryAssertions)) return breathingRoom.boundaryAssertions;
  if (Array.isArray(breathingRoom?.telemetry?.boundaryAssertions)) return breathingRoom.telemetry.boundaryAssertions;
  return [];
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

function schedulerVerificationReceipt(evidence, report = null, effectiveRoute = null) {
  const breathingRoom = evidence?.raw?.breathingRoom || report?.breathingRoom || null;
  return createSchedulerVerificationReceipt({
    route: schedulerVerificationRoute(report, effectiveRoute),
    scheduler: evidence?.scheduler || {
      schema: 'kaminos.webgpu-route-scheduler.v0',
      requestedScheduler: evidence?.requestedScheduler || breathingRoom?.requestedScheduler || {},
      effectiveScheduler: evidence?.effectiveScheduler || breathingRoom?.effectiveScheduler || null,
      verificationState: evidence?.verificationState || breathingRoom?.status || 'scheduler-unverified',
      unsupportedFields: evidence?.unsupportedFields || breathingRoom?.unsupportedFields || [],
    },
    backpressure: evidence?.backpressure || backpressurePlaceholder(report, effectiveRoute),
    eventTrace: schedulerVerificationEventTrace(breathingRoom),
    boundaryAssertions: schedulerVerificationBoundaryAssertions(breathingRoom),
    frameTail: schedulerVerificationFrameTail(breathingRoom),
    unsupportedFields: evidence?.unsupportedFields || breathingRoom?.unsupportedFields || [],
    downgrades: evidence?.failureDowngrades || [],
  });
}

function routeReceiptRuntimeSchedulerEvidence(report, effectiveRoute = null) {
  const receipt = report?.receipt || report?.routeReceipt || null;
  const runtime = receipt?.runtime || null;
  if (!runtime?.scheduler && !runtime?.backpressure && !runtime?.schedulerVerification) return null;
  const routeReceiptClassification = classifyWebGpuRouteReceiptEvidence(receipt);
  const routeReceiptAuthoritative = routeReceiptClassification.classification === 'authoritative-live-webgpu';
  const schedulerVerification = routeReceiptClassification.schedulerVerification || null;
  const schedulerVerificationState = routeReceiptAuthoritative
    ? (routeReceiptClassification.schedulerVerificationStatus || routeReceiptClassification.schedulerVerificationState || 'scheduler-unverified')
    : 'scheduler-unverified';
  const unsupportedFields = [
    ...(Array.isArray(runtime.scheduler?.unsupportedFields) ? runtime.scheduler.unsupportedFields : []),
    ...(Array.isArray(runtime.scheduler?.effectiveScheduler?.unsupportedFields) ? runtime.scheduler.effectiveScheduler.unsupportedFields : []),
  ];
  const scheduler = routeReceiptAuthoritative && runtime.scheduler
    ? runtime.scheduler
    : createValidatedSchedulerProfile({
      requestedScheduler: runtime.scheduler?.requestedScheduler || {},
      effectiveScheduler: runtime.scheduler?.effectiveScheduler || null,
      unsupportedFields,
      verificationState: schedulerVerificationState,
      breathability: runtime.scheduler?.breathability || pipelineKitDefaultBreathability(report, effectiveRoute),
    });
  const backpressure = routeReceiptAuthoritative && runtime.backpressure
    ? runtime.backpressure
    : (runtime.backpressure || backpressurePlaceholder(report, effectiveRoute));
  const source = routeReceiptAuthoritative ? 'route-receipt' : 'route-receipt-non-authoritative';
  const routeReceiptDowngrade = routeReceiptAuthoritative ? [] : [`route-receipt-${routeReceiptClassification.classification}`];
  const nonAuthoritativeSchedulerVerification = schedulerVerification ? {
    ...schedulerVerification,
    status: schedulerVerificationState,
    classification: schedulerVerification.classification === 'observed-boundary'
      ? 'config-only'
      : schedulerVerification.classification,
    reportedStatus: schedulerVerification.reportedStatus || routeReceiptClassification.schedulerVerificationReportedStatus || schedulerVerification.status || null,
  } : null;
  const effectiveSchedulerVerification = routeReceiptAuthoritative
    ? schedulerVerification
    : nonAuthoritativeSchedulerVerification;
  const schedulerVerificationDowngrades = Array.isArray(routeReceiptClassification.schedulerVerificationDowngrades)
    ? routeReceiptClassification.schedulerVerificationDowngrades
    : [];
  const failureDowngrades = [
    ...routeReceiptDowngrade,
    ...schedulerVerificationDowngrades,
  ];
  const evidence = {
    schema: 'kaminos.pipeline-scheduler-composition.v0',
    source,
    verificationState: schedulerVerificationState,
    schedulerMode: report?.breathingRoom?.schedulerMode || report?.backend?.schedulerMode || null,
    requestedScheduler: scheduler?.requestedScheduler || null,
    effectiveScheduler: scheduler?.effectiveScheduler || null,
    unsupportedFields,
    scheduler,
    backpressure,
    phaseBoundaries: Array.isArray(effectiveSchedulerVerification?.boundaryAssertions)
      ? effectiveSchedulerVerification.boundaryAssertions.map(assertion => assertion?.observedBoundary).filter(Boolean)
      : [],
    backendIdentity: adapterBackendIdentity(report, effectiveRoute),
    optimizationIdentity: emptyOptimizationIdentity(),
    raw: {
      breathingRoom: report?.breathingRoom || null,
      routeReceipt: receipt,
      routeReceiptClassification,
    },
    routeReceiptClassification,
    failureDowngrades,
    schedulerVerification: effectiveSchedulerVerification,
  };
  return validateOrNormalizePipelineSchedulerEvidence(evidence, report, effectiveRoute);
}

function pipelineSchedulerEvidence(report, effectiveRoute = null) {
  if (!report) {
    const evidence = {
      schema: 'kaminos.pipeline-scheduler-composition.v0',
      source: 'missing',
      verificationState: 'scheduler-evidence-missing',
      requestedScheduler: null,
      effectiveScheduler: null,
      unsupportedFields: [],
      scheduler: createValidatedSchedulerProfile({
        requestedScheduler: {},
        effectiveScheduler: null,
        unsupportedFields: [],
        verificationState: 'scheduler-unverified',
      }),
      backpressure: backpressurePlaceholder(report, effectiveRoute),
      phaseBoundaries: [],
      backendIdentity: adapterBackendIdentity(null, effectiveRoute),
      optimizationIdentity: emptyOptimizationIdentity(),
      raw: {
        breathingRoom: null,
      },
      failureDowngrades: ['scheduler-evidence-missing'],
    };
    return {
      ...evidence,
      schedulerVerification: schedulerVerificationReceipt(evidence, report, effectiveRoute),
    };
  }
  if (report.pipelineScheduler?.schema === 'kaminos.pipeline-scheduler-composition.v0') {
    return validateOrNormalizePipelineSchedulerEvidence(report.pipelineScheduler, report, effectiveRoute);
  }
  const routeReceiptEvidence = routeReceiptRuntimeSchedulerEvidence(report, effectiveRoute);
  if (routeReceiptEvidence) return routeReceiptEvidence;
  const breathingRoom = report.breathingRoom || null;
  const effectiveScheduler = breathingRoom?.effectiveScheduler || null;
  const unsupportedFields = Array.isArray(breathingRoom?.unsupportedFields)
    ? breathingRoom.unsupportedFields
    : [];
  const verificationState = unsupportedFields.length
    ? 'unsupported'
    : (breathingRoom?.status || (effectiveScheduler ? 'verified' : 'scheduler-unverified'));
  const schedulerProfile = createValidatedSchedulerProfile({
    requestedScheduler: breathingRoom?.requestedScheduler || report.backend?.requestedScheduler || {},
    effectiveScheduler,
    unsupportedFields,
    verificationState,
    breathability: pipelineKitDefaultBreathability(report, effectiveRoute),
  });
  const failureDowngrades = [];
  if (report.schema === 'unparseable-json') failureDowngrades.push('unparseable-adapter-report');
  if (!breathingRoom) failureDowngrades.push('breathing-room-missing');
  if (!effectiveScheduler) failureDowngrades.push('effective-scheduler-missing');
  if (unsupportedFields.length) failureDowngrades.push('unsupported-fields-present');
  const evidence = {
    schema: 'kaminos.pipeline-scheduler-composition.v0',
    source: 'pipeline-adapter-report',
    verificationState,
    schedulerMode: breathingRoom?.schedulerMode || report.backend?.schedulerMode || null,
    requestedScheduler: breathingRoom?.requestedScheduler || report.backend?.requestedScheduler || null,
    effectiveScheduler,
    unsupportedFields,
    scheduler: schedulerProfile,
    backpressure: backpressurePlaceholder(report, effectiveRoute),
    phaseBoundaries: uniqueAdapterPhases(breathingRoom?.telemetry),
    backendIdentity: adapterBackendIdentity(report, effectiveRoute),
    optimizationIdentity: effectiveScheduler ? {
      vitEncoderMode: effectiveScheduler.vitBlockChunkSize ? 'split' : 'fused',
      vitBlockChunkSize: effectiveScheduler.vitBlockChunkSize ?? null,
      spnPatchChunkSize: effectiveScheduler.spnPatchChunkSize ?? null,
      waitForSubmittedWorkDone: effectiveScheduler.waitForSubmittedWorkDone ?? null,
      yieldMs: effectiveScheduler.yieldMs ?? null,
      gaussianPhaseYieldMs: effectiveScheduler.gaussianPhaseYieldMs ?? null,
    } : emptyOptimizationIdentity(),
    raw: {
      breathingRoom,
    },
    failureDowngrades,
  };
  return {
    ...evidence,
    schedulerVerification: schedulerVerificationReceipt(evidence, report, effectiveRoute),
  };
}

function adapterReportSummary(report, effectiveRoute = null) {
  if (!report) return null;
  const pipelineScheduler = pipelineSchedulerEvidence(report, effectiveRoute);
  return {
    schema: report.schema || null,
    ok: report.ok ?? null,
    phase: report.phase || null,
    backend: report.backend || null,
    revision: report?.backend?.revision || null,
    breathingRoom: report.breathingRoom || null,
    liveSchedulerRuntime: report.liveSchedulerRuntime || null,
    schedulerVerification: report.schedulerVerification || pipelineScheduler.schedulerVerification || null,
    backgroundHeartbeat: report?.backgroundHeartbeat || null,
    pipelineScheduler,
    inputSha256: report.inputSha256 || report.input?.sha256 || null,
    outputBytes: report.outputBytes || report.output?.bytes || null,
  };
}

function adapterSideArtifactEntries(report) {
  const entries = [];
  if (Array.isArray(report?.sideArtifacts)) entries.push(...report.sideArtifacts);
  for (const [key, value] of Object.entries(report?.outputs || {})) {
    if (!value || typeof value !== 'object') continue;
    entries.push({
      id: value.id || key,
      role: value.role,
      path: value.path,
      bytes: value.bytes,
      sha256: value.sha256,
    });
  }
  return entries;
}

function adapterSideArtifactMap(report) {
  return new Map(adapterSideArtifactEntries(report)
    .filter(entry => entry?.id || entry?.artifactId)
    .map(entry => [entry.id || entry.artifactId, entry]));
}

function recordAdapterSideArtifacts(effectiveRoute, stage) {
  const adapterReport = readJsonIfExists(effectiveRoute.adapterReportPath);
  for (const entry of adapterSideArtifactEntries(adapterReport)) {
    const artifactId = entry.id || entry.artifactId;
    if (!artifactId || artifactId === stage.outputArtifact) continue;
    const manifestArtifact = pipeline.artifacts?.[artifactId];
    if (!manifestArtifact) continue;
    const outputPath = entry.path || artifactPathFor(artifactId);
    if (!outputPath || !existsSync(outputPath)) continue;
    artifacts[artifactId] = {
      role: manifestArtifact.role || entry.role || artifactId,
      status: effectiveRoute.stageStatus || 'real',
      sourceStage: stage.id,
      adapterReportPath: effectiveRoute.adapterReportPath,
      ...fileEvidence(outputPath),
    };
  }
}

function validateRequiredAdapterSideArtifacts(effectiveRoute, stage, outputPath) {
  const required = Array.isArray(stage.requiredSideArtifacts) ? stage.requiredSideArtifacts : [];
  if (!required.length) return;
  const adapterReport = readJsonIfExists(effectiveRoute.adapterReportPath);
  const byId = adapterSideArtifactMap(adapterReport);
  const missing = [];
  for (const artifactId of required) {
    const manifestArtifact = pipeline.artifacts?.[artifactId];
    const entry = byId.get(artifactId);
    const artifactPath = entry?.path || artifactPathFor(artifactId);
    if (!manifestArtifact || !artifactPath || !existsSync(artifactPath)) {
      missing.push({
        id: artifactId,
        role: manifestArtifact?.role || entry?.role || null,
        path: artifactPath || null,
      });
    }
  }
  if (!missing.length) return;
  const error = new Error(`live model adapter omitted required side artifact(s): ${missing.map(item => item.id).join(', ')}`);
  effectiveRoute.truthBoundary = 'requested live SHARP adapter omitted required run evidence; no authoritative output was accepted';
  effectiveRoute.missingRequiredSideArtifacts = missing;
  recordFailedStage(stage, outputPath, effectiveRoute, error);
  throw error;
}

function classifyLiveAdapterOutput(effectiveRoute, stage, artifactId) {
  const adapterReport = readJsonIfExists(effectiveRoute.adapterReportPath);
  effectiveRoute.adapterReport = adapterReportSummary(adapterReport, effectiveRoute);
  effectiveRoute.pipelineScheduler = pipelineSchedulerEvidence(adapterReport, effectiveRoute);
  const schema = String(adapterReport?.schema || '').toLowerCase();
  const modelFamily = stage.route?.modelFamily || effectiveRoute.tool || 'model';
  const artifactRole = pipeline.artifacts?.[artifactId]?.role || artifactId || 'artifact';
  const commandText = [
    effectiveRoute.availability?.configuredCommand,
    effectiveRoute.availability?.resolvedCommand,
    ...(effectiveRoute.executedCommand || []),
  ].filter(Boolean).join(' ').toLowerCase();
  const isMockAdapter = schema.includes('mock') || commandText.includes('mock-sharp-command') || commandText.includes('mock-greenroom') || commandText.includes('mock-');
  if (!isMockAdapter) {
    effectiveRoute.truthBoundary = `live ${modelFamily} adapter output; external command produced the ${artifactRole} artifact`;
    return { status: 'real', fixtureSource: null };
  }
  const reportEvidence = existsSync(effectiveRoute.adapterReportPath)
    ? fileEvidence(effectiveRoute.adapterReportPath)
    : { path: effectiveRoute.adapterReportPath, bytes: null, sha256: null };
  const truthBoundary = `mock ${modelFamily} adapter fixture output; adapter command is a test fixture and not real model inference`;
  effectiveRoute.realModel = false;
  effectiveRoute.fixtureMode = 'mock-adapter';
  effectiveRoute.truthBoundary = truthBoundary;
  return {
    status: 'fixture',
    fixtureSource: {
      stageMode: 'fixture',
      mode: 'mock-adapter',
      adapterSchema: adapterReport?.schema || null,
      truthBoundary,
      ...reportEvidence,
    },
  };
}

function recordFailedStage(stage, outputPath, effectiveRoute, error) {
  stages.push({
    id: stage.id,
    label: stage.label || stage.id,
    status: 'failed',
    requestedRoute: stage.route?.id || stage.id,
    effectiveRoute,
    inputArtifact: stage.inputArtifact,
    outputArtifact: stage.outputArtifact,
    outputPath,
    error: error?.message || String(error),
  });
}

async function runLiveModelAdapter(outputPath, stage) {
  const availability = adapterAvailability(stage);
  const adapterReportPath = liveAdapterReportPath(outputPath, stage);
  const effectiveRoute = {
    id: stage.route?.id || stage.id,
    tool: stage.route?.tool || 'SHARP',
    effectiveBackend: stage.route?.effectiveBackend || 'external-command',
    realModel: true,
    requestedRealModel: stage.route?.realModel === true,
    executesModel: stage.route?.executesModel === true,
    commandEnv: stage.route?.commandEnv || null,
    availability,
    adapterReportPath,
  };
  if (availability.status !== 'available') {
    const error = new Error(`live model adapter unavailable: ${availability.envVar || 'command env'} is ${availability.status}`);
    effectiveRoute.truthBoundary = 'requested live SHARP adapter did not execute; no fixture fallback was used';
    recordFailedStage(stage, outputPath, effectiveRoute, error);
    throw error;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const command = availability.resolvedCommand || availability.configuredCommand;
  const commandArgs = [
    '--input', inputPath,
    '--output', outputPath,
    '--report', adapterReportPath,
  ];
  const paths = artifactPathMap();
  effectiveRoute.executedCommand = [command, ...commandArgs];
  emitPipelineProgress({
    kind: 'adapter-progress',
    phase: `stage:${stage.id}:starting-adapter`,
    message: `Starting ${effectiveRoute.tool} adapter`,
    status: 'running',
    stageId: stage.id,
    progress: 0,
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  const adapterProgressEvents = [];
  const proc = spawn(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_PIPELINE_INPUT: inputPath,
      KAMINOS_PIPELINE_OUTPUT: outputPath,
      KAMINOS_PIPELINE_ADAPTER_REPORT: adapterReportPath,
      KAMINOS_PIPELINE_OUTPUT_ROOT: outDir,
      KAMINOS_PIPELINE_ID: pipeline.id,
      KAMINOS_PIPELINE_ROUTE_ID: pipeline.routeId,
      KAMINOS_PIPELINE_STAGE_ID: stage.id,
      KAMINOS_PIPELINE_ARTIFACT_PATHS: JSON.stringify(paths),
      KAMINOS_PIPELINE_SIDECAR: paths.sidecar || '',
      KAMINOS_PIPELINE_AUTOCROP_EVIDENCE: paths.autoCropEvidence || '',
      KAMINOS_PIPELINE_PROGRESS_STREAM: progressStreamEnabled ? '1' : '',
    },
  });
  proc.stdout?.setEncoding('utf8');
  proc.stderr?.setEncoding('utf8');
  let stdoutCarry = '';
  let stderrCarry = '';
  const consumeLine = line => {
    const forwarded = forwardAdapterProgressLine(line, effectiveRoute);
    if (forwarded) adapterProgressEvents.push(forwarded);
  };
  proc.stdout?.on('data', chunk => {
    const text = String(chunk);
    stdoutChunks.push(text);
    const parts = `${stdoutCarry}${text}`.split(/\r?\n/);
    stdoutCarry = parts.pop() || '';
    parts.forEach(consumeLine);
  });
  proc.stderr?.on('data', chunk => {
    const text = String(chunk);
    stderrChunks.push(text);
    const parts = `${stderrCarry}${text}`.split(/\r?\n/);
    stderrCarry = parts.pop() || '';
    parts.forEach(consumeLine);
  });
  const procResult = await new Promise(resolve => {
    proc.on('error', error => resolve({ error, status: null, signal: null }));
    proc.on('close', (status, signal) => resolve({ error: null, status, signal }));
  });
  if (stdoutCarry) consumeLine(stdoutCarry);
  if (stderrCarry) consumeLine(stderrCarry);
  effectiveRoute.exitCode = procResult.status;
  effectiveRoute.signal = procResult.signal || null;
  effectiveRoute.stdoutTail = collectTail(stdoutChunks);
  effectiveRoute.stderrTail = collectTail(stderrChunks);
  effectiveRoute.progressEvents = adapterProgressEvents;
  const adapterReport = readJsonIfExists(adapterReportPath);
  effectiveRoute.adapterReport = adapterReportSummary(adapterReport, effectiveRoute);
  effectiveRoute.pipelineScheduler = pipelineSchedulerEvidence(adapterReport, effectiveRoute);
  if (procResult.error || procResult.status !== 0) {
    const message = procResult.error?.message || `live model adapter exited ${procResult.status}`;
    const error = new Error(message);
    effectiveRoute.truthBoundary = 'requested live SHARP adapter failed; no fixture fallback was used';
    recordFailedStage(stage, outputPath, effectiveRoute, error);
    throw error;
  }
  if (!existsSync(outputPath)) {
    const error = new Error(`live model adapter completed without writing output: ${outputPath}`);
    effectiveRoute.truthBoundary = 'requested live SHARP adapter produced no output; no fixture fallback was used';
    recordFailedStage(stage, outputPath, effectiveRoute, error);
    throw error;
  }
  const outputEvidence = fileEvidence(outputPath);
  emitPipelineProgress({
    kind: 'adapter-progress',
    phase: `stage:${stage.id}:output-written`,
    message: `${effectiveRoute.tool} adapter wrote ${stage.outputArtifact || 'output'}`,
    status: 'running',
    stageId: stage.id,
    progress: 0.92,
  });
  effectiveRoute.outputSha256 = outputEvidence.sha256;
  effectiveRoute.outputBytes = outputEvidence.bytes;
  const classification = classifyLiveAdapterOutput(effectiveRoute, stage, stage.outputArtifact);
  effectiveRoute.stageStatus = classification.status;
  if (classification.fixtureSource) effectiveRoute.fixtureSource = classification.fixtureSource;
  validateRequiredAdapterSideArtifacts(effectiveRoute, stage, outputPath);
  return effectiveRoute;
}

async function runStage(stage) {
  phase = `stage:${stage.id}`;
  const outputPath = artifactPathFor(stage.outputArtifact);
  if (!outputPath) throw new Error(`stage ${stage.id} has no caller-rooted output artifact`);
  const requestedRoute = stage.route?.id || stage.id;
  emitPipelineProgress({
    kind: 'stage-progress',
    phase,
    message: `Running stage ${stage.label || stage.id}`,
    status: 'running',
    stageId: stage.id,
    progress: null,
  });
  const effectiveRoute = {
    id: requestedRoute,
    tool: stage.route?.tool || 'pipeline-witness.mjs',
    effectiveBackend: stage.route?.effectiveBackend || stage.statusMode || 'fixture',
    realModel: stage.route?.realModel === true,
  };
  let status = stage.statusMode || 'fixture';
  let availability = null;
  let fixtureSource = null;
  if (stage.statusMode === 'adapter-check') {
    availability = adapterAvailability(stage);
    effectiveRoute.availability = availability;
    effectiveRoute.realModel = false;
    status = availability.status === 'available' ? 'real' : 'skipped';
    makeAdapterAvailabilityReport(outputPath, stage, availability);
  } else if (existsSync(outputPath)) {
    status = 'cached';
  } else if (stage.statusMode === 'model-adapter' && stage.route?.executesModel === true) {
    Object.assign(effectiveRoute, await runLiveModelAdapter(outputPath, stage));
    status = effectiveRoute.stageStatus || 'real';
    fixtureSource = effectiveRoute.fixtureSource || null;
  } else if (stage.statusMode === 'model-adapter' && stage.outputArtifact === 'sidecar') {
    status = artifacts.splat?.status === 'fixture' ? 'fixture' : 'real';
    makeSidecar(outputPath, {
      stageMode: status,
      truthBoundary: artifacts.splat?.fixtureSource?.truthBoundary || 'live SHARP adapter output sidecar; splat was produced by the configured external model command',
    });
  } else if (stage.statusMode === 'prepared-artifact' && stage.outputArtifact === 'inspection') {
    status = 'real';
    makePreparedInspection(outputPath);
  } else if (stage.statusMode === 'prepared-artifact' && stage.outputArtifact === 'sidecar') {
    status = 'real';
    makePreparedSidecar(outputPath);
  } else if (stage.outputArtifact === 'splat') {
    fixtureSource = makeFixturePly(outputPath);
    effectiveRoute.fixtureSource = fixtureSource.path;
    effectiveRoute.fixtureSourceMode = fixtureSource.mode;
    effectiveRoute.fixtureSourceSha256 = fixtureSource.sha256;
    effectiveRoute.fixtureSourceBytes = fixtureSource.bytes;
    effectiveRoute.truthBoundary = fixtureSource.truthBoundary;
  } else if (stage.outputArtifact === 'sidecar') {
    makeSidecar(outputPath);
  } else {
    throw new Error(`unsupported fixture stage output artifact: ${stage.outputArtifact}`);
  }

  const evidence = fileEvidence(outputPath);
  artifacts[stage.outputArtifact] = {
    role: pipeline.artifacts[stage.outputArtifact]?.role || stage.outputArtifact,
    status,
    ...(fixtureSource ? { fixtureSource } : {}),
    ...evidence,
  };
  if (stage.statusMode === 'model-adapter' && stage.route?.executesModel === true) {
    recordAdapterSideArtifacts(effectiveRoute, stage);
  }
  const record = {
    id: stage.id,
    label: stage.label || stage.id,
    status,
    requestedRoute,
    effectiveRoute,
    inputArtifact: stage.inputArtifact,
    outputArtifact: stage.outputArtifact,
    outputPath,
    outputSha256: evidence.sha256,
    outputBytes: evidence.bytes,
  };
  stages.push(record);
  emitPipelineProgress({
    kind: 'stage-progress',
    phase: `stage:${stage.id}:complete`,
    message: `Stage ${stage.label || stage.id} recorded ${status} ${stage.outputArtifact || 'output'}`,
    status,
    stageId: stage.id,
    progress: 1,
  });
}

try {
  phase = 'loading-manifest';
  emitPipelineProgress({ phase, message: 'Loading pipeline manifest', status: 'running', progress: 0 });
  if (!existsSync(manifestPath)) throw new Error(`manifest does not exist: ${manifestPath}`);
  const manifestBytes = readFileSync(manifestPath);
  manifestSha256 = sha256Bytes(manifestBytes);
  manifest = JSON.parse(manifestBytes.toString('utf8'));
  lastTrustworthyEvidence = {
    manifestPath,
    manifestSha256,
    manifestSchema: manifest.schema,
    pipelineCount: Array.isArray(manifest.pipelines) ? manifest.pipelines.length : 0,
  };
  if (manifest.schema !== 'kaminos.pipeline-manifest.v0') {
    throw new Error(`unsupported manifest schema: ${manifest.schema}`);
  }

  phase = 'selecting-pipeline';
  emitPipelineProgress({ phase, message: `Selecting pipeline ${requestedPipelineId}`, status: 'running', progress: 0.05 });
  pipeline = manifest.pipelines.find(candidate => candidate.id === requestedPipelineId);
  if (!pipeline) throw new Error(`pipeline id not found: ${requestedPipelineId}`);

  phase = 'validating-inputs';
  emitPipelineProgress({ phase, message: 'Validating pipeline inputs', status: 'running', progress: 0.1 });
  requireInputs();
  artifacts.input = {
    role: pipeline.artifacts?.input?.role || 'input',
    status: 'requested',
    ...fileEvidence(inputPath),
  };

  phase = 'running-stages';
  emitPipelineProgress({ phase, message: 'Running pipeline stages', status: 'running', progress: 0.15 });
  mkdirSync(outDir, { recursive: true });
  for (const stage of pipeline.stages || []) {
    await runStage(stage);
  }

  phase = 'complete';
  emitPipelineProgress({ phase, message: 'Writing pipeline bundle evidence', status: 'running', progress: 0.97 });
  const bundleIndex = writeBundleIndex();
  writeReport({ ok: true, bundleIndex });
  emitPipelineProgress({ phase, message: 'Pipeline witness complete', status: 'complete', progress: 1 });
} catch (error) {
  const failingStage = stages.at(-1);
  if (failingStage && failingStage.status !== 'failed') failingStage.status = 'failed';
  writeReport({
    ok: false,
    error: error?.message || String(error),
  });
  emitPipelineProgress({
    phase: 'failed',
    message: error?.message || String(error),
    status: 'failed',
    progress: null,
  });
  console.error(error?.stack || error);
  process.exitCode = 1;
}
