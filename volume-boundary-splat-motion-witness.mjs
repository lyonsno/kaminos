#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { inflateSync as zlibInflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.boundary-splat-motion-witness.v0';
const SPLAT_RENDERER = 'live-boundary-sidecar-analytic-splats-v0';
const LEARNED_SPLAT_RENDERER = 'live-boundary-sidecar-learned-attribute-splats-v0';
const EXPECTED_LEARNED_MODEL = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const REJECTED_LEARNED_MODELS = new Set([
  'sha256:54a41ba9d04132b8340884adef37a092c367c8cc8443e67907bd5f4f8573b911',
  'sha256:09aecca934991ba8321485b5ab7fa7c685c2c8544423286b843195a5e441c64d',
]);
const SPLAT_SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const SOURCE_AUTHORITY = SPLAT_SOURCE_AUTHORITY;
const RAYMARCH_RENDERER = 'matched-raymarch';
const INSTANCE_DESCRIPTOR_IDENTITY = 'boundary-splat-instance-descriptor-v0';
const SHARED_CURRENT_PHASE_SOURCE = 'shared-current-control';
const LIVE_HISTORY_PHASE_SOURCE = 'live-history-offset';
const SAME_HISTORY_SLOT_PHASE_SOURCE = 'same-history-slot-control';
const AGE_SWEEP_PHASE_SOURCE = 'age-sweep-history';
const PHASE_LAB_MODES = ['shared-current', 'same-history-slot', 'offset-history', 'age-sweep'];
const PHASE_SOURCE_IDENTITIES = new Set([
  SHARED_CURRENT_PHASE_SOURCE,
  LIVE_HISTORY_PHASE_SOURCE,
  SAME_HISTORY_SLOT_PHASE_SOURCE,
  AGE_SWEEP_PHASE_SOURCE,
]);

const args = parseArgs(process.argv.slice(2));
const forcedResponseAssay = args.has('--forced-response-assay');
const requestedForcedResponseRendererMode = String(args.get('--forced-response-renderer') || 'analytic');
const forcedResponseRendererMode = ['analytic', 'learned'].includes(requestedForcedResponseRendererMode)
  ? requestedForcedResponseRendererMode
  : null;
const forcedResponseRendererIdentity = forcedResponseRendererMode === 'analytic'
  ? SPLAT_RENDERER
  : LEARNED_SPLAT_RENDERER;
const forcedResponseExpectedModelIdentity = forcedResponseRendererMode === 'analytic'
  ? null
  : EXPECTED_LEARNED_MODEL;
const FORCED_RESPONSE_SCHEMA = 'kaminos.volume.boundary-splat-forced-response-witness.v0';
const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-motion-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/motion-witness-report.json`));
const port = Math.max(1, Math.floor(Number(args.get('--chrome-port') || 19384)));
const chrome = String(args.get('--chrome') || process.env.CHROME || defaultChromePath());
const windowSize = String(args.get('--window-size') || '1280,960');
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2500));
const frameCount = Math.max(2, Math.floor(Number(args.get('--frames') || 6)));
const stepMs = Math.max(1, Number(args.get('--step-ms') || 2000));
const wallStepMs = Math.max(0, Number(args.get('--wall-step-ms') || 0));
const keepBrowserOpen = args.has('--keep-browser-open');
const headless = args.has('--headless');
const userDataDir = resolve(String(args.get('--user-data-dir') || mkdtempSync(`${tmpdir()}/kaminos-splat-motion-chrome-`)));
const requestedPhaseStride = Math.max(1, Math.floor(Number(args.get('--phase-stride') || 1)));
const requestedHistoryDepth = Math.max(4, Math.floor(Number(args.get('--history-depth') || 4)));
const requestedHistoryFrameStride = Math.max(1, Math.floor(Number(args.get('--history-frame-stride') || 1)));
const operatorPrettySubstratePath = args.get('--operator-pretty-substrate')
  ? resolve(String(args.get('--operator-pretty-substrate')))
  : null;

const runStartedAt = new Date().toISOString();
const lastTrustworthyEvidence = {};
let browserSession = null;
let ws = null;
let failurePhase = 'startup';

try {
  if (!requestedRoute) throw new Error('missing --url');
  if (forcedResponseAssay && !forcedResponseRendererMode) {
    throw new Error(`unsupported --forced-response-renderer:${requestedForcedResponseRendererMode}`);
  }
  mkdirSync(outDir, { recursive: true });
  browserSession = await launchBrowser();
  failurePhase = 'cdp-connect';
  await waitForCdp();
  const page = await findPage();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest('Page.enable');
  await wsRequest('Runtime.enable');
  failurePhase = 'route-load';
  await navigateToRequestedRoute();
  await waitForPrototype();
  await delay(settleMs);
  await hideHud();
  const initialState = await debugState();
  validateRequestedEffectiveConfig(initialState);
  lastTrustworthyEvidence.initialState = compactState(initialState);
  const effectivePageUrl = await currentPageUrl();

  if (forcedResponseAssay) {
    failurePhase = 'forced-response-assay';
    const report = await captureForcedResponseAssay({ effectivePageUrl });
    lastTrustworthyEvidence.forcedResponseAssay = {
      effectiveRoute: report.effectiveRoute,
      inspectedArtifacts: report.inspectedArtifacts,
      timingAuthority: report.timing?.authority || null,
      timingRows: report.timing?.rows || null,
      visualDeltas: report.visualDeltas,
      routeEfficacyProbe: report.routeEfficacyProbe,
      stopCeilingExceeded: report.stopCeilingExceeded,
    };
    failurePhase = 'forced-response-false-closure-validation';
    rejectForcedResponseFalseClosure(report);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } else {
  const requestedRouteIdentity = {
    requestedRoute,
    rendererIdentity: SPLAT_RENDERER,
    sourceAuthority: SOURCE_AUTHORITY,
    routeMode: 'boundary-splat-motion-falsification',
  };
  const staticCamera = {
    label: 'staticCamera',
    sequenceKind: 'static-camera',
    pose: {
      position: [0.05, 1.85, 4.35],
      target: [0, -0.18, 0.16],
    },
  };
  const grazingCamera = {
    label: 'grazingCamera',
    sequenceKind: 'slow-camera-grazing-view',
    from: {
      position: [0.05, 1.85, 4.35],
      target: [0, -0.18, 0.16],
    },
    to: {
      position: [2.95, 0.48, 1.15],
      target: [0.04, 0.18, 0.04],
    },
  };

  failurePhase = 'static-camera-capture';
  const staticSequence = await captureSequence(staticCamera);
  failurePhase = 'grazing-camera-capture';
  const grazingSequence = await captureSequence(grazingCamera);
  failurePhase = 'false-closure-validation';
  const report = {
    schema: SCHEMA,
    status: 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    requestedRouteIdentity,
    effectiveRoute: staticSequence.effectiveRoute || grazingSequence.effectiveRoute || null,
    sourceAuthority: SOURCE_AUTHORITY,
    rendererIdentities: [SPLAT_RENDERER, LEARNED_SPLAT_RENDERER, RAYMARCH_RENDERER],
    expectedLearnedModelIdentity: EXPECTED_LEARNED_MODEL,
    browser: {
      identity: browserSession.identity,
      mode: browserSession.mode,
      port,
      userDataDir,
      keepBrowserOpen,
      windowSize,
      pageUrl: effectivePageUrl,
    },
    captureConfig: {
      frameCount,
      stepMs,
      wallStepMs,
      requestedPhaseStride,
      requestedHistoryDepth,
      requestedHistoryFrameStride,
      staticCameraDurationMs: (frameCount - 1) * stepMs,
      grazingCameraDurationMs: (frameCount - 1) * stepMs,
    },
    frozenDeterminism: computeFrozenDeterminism(staticSequence.frames[0]),
    analyticLearnedComparison: summarizeAnalyticLearnedComparison([...staticSequence.frames, ...grazingSequence.frames]),
    staticCamera: staticSequence,
    grazingCamera: grazingSequence,
    candidateChurn: summarizeCandidateChurn([...staticSequence.frames, ...grazingSequence.frames]),
    birthDeathTelemetry: summarizeBirthDeath([...staticSequence.frames, ...grazingSequence.frames]),
    duplicateMotionWitness: summarizeDuplicateMotionWitness([...staticSequence.frames, ...grazingSequence.frames]),
    phaseLabWitness: summarizePhaseLabWitness([...staticSequence.frames, ...grazingSequence.frames]),
    operatorPrettySubstrate: loadOperatorPrettySubstrate(operatorPrettySubstratePath),
    inspectedArtifacts: [
      staticSequence.contactSheet || null,
      grazingSequence.contactSheet || null,
      ...staticSequence.frames.flatMap(frame => frame.captures.map(capture => capture.image.path)),
      ...grazingSequence.frames.flatMap(frame => frame.captures.map(capture => capture.image.path)),
    ].filter(Boolean),
    falseClosureChecks: {
      rejectsFallbackRoutes: true,
      rejectsStaleDefaultConfig: true,
      rejectsMissingOrBlankCapture: true,
      rejectsSubstitutedRaymarch: true,
      rejectsCachedOrStaticOutput: true,
      rejectsRendererDisagreement: true,
    },
  };
  rejectFalseClosure(report);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  const failureReport = {
    schema: forcedResponseAssay ? FORCED_RESPONSE_SCHEMA : SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedRoute,
    rendererIdentity: SPLAT_RENDERER,
    expectedLearnedModelIdentity: EXPECTED_LEARNED_MODEL,
    sourceAuthority: SOURCE_AUTHORITY,
    browser: browserSession ? {
      identity: browserSession.identity,
      mode: browserSession.mode,
      headless,
      unsafeWebGpuEnabled: headless,
      port,
      userDataDir,
      keepBrowserOpen,
      windowSize,
    } : null,
    lastTrustworthyEvidence,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(failureReport, null, 2));
  console.error(JSON.stringify(failureReport, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close?.(); } catch {}
  if (!keepBrowserOpen) browserSession?.process?.kill('SIGTERM');
}

function parseArgs(argv) {
  const map = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      map.set(item, '1');
    } else {
      map.set(item, next);
      index += 1;
    }
  }
  return map;
}

function defaultChromePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
  ];
  return candidates.find(candidate => candidate.includes('/') ? existsSync(candidate) : true) || candidates[0];
}

async function launchBrowser() {
  try {
    await cdpFetch('/json/version');
    return {
      identity: 'boundary-splat-motion-single-cdp-browser-v0',
      mode: 'connected-existing',
      process: null,
    };
  } catch {}
  const proc = spawn(chrome, [
    ...(headless ? ['--headless=new', '--enable-unsafe-webgpu'] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    requestedRoute,
  ], { stdio: 'ignore', detached: keepBrowserOpen });
  if (keepBrowserOpen) proc.unref();
  return {
    identity: 'boundary-splat-motion-single-cdp-browser-v0',
    mode: keepBrowserOpen ? 'launched-kept-open' : 'launched-owned',
    process: proc,
  };
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(100);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function findPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1'))
      || pages.find(target => target.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await delay(125);
  }
  throw new Error('could not find CDP page target');
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      cleanup();
      if (message.error) rejectReq(new Error(`${method}: ${message.error.message}`));
      else resolveReq(message.result);
    };
    const onClose = () => {
      cleanup();
      rejectReq(new Error(`${method}: WebSocket closed before CDP response ${id}`));
    };
    const onError = () => {
      cleanup();
      rejectReq(new Error(`${method}: WebSocket error before CDP response ${id}`));
    };
    const cleanup = () => {
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose, { once: true });
    ws.addEventListener('error', onError, { once: true });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function currentPageUrl() {
  const result = await wsRequest('Runtime.evaluate', {
    expression: 'location.href',
    returnByValue: true,
  });
  return result.result.value || '';
}

async function navigateToRequestedRoute() {
  const current = await currentPageUrl().catch(() => '');
  if (current !== requestedRoute) {
    await wsRequest('Page.navigate', { url: requestedRoute });
  }
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const result = await wsRequest('Runtime.evaluate', {
      expression: `({ href: location.href, readyState: document.readyState })`,
      returnByValue: true,
    });
    const value = result.result.value || {};
    if (value.href === requestedRoute && value.readyState !== 'loading') return value;
    await delay(125);
  }
  throw new Error(`stale page route: requested ${requestedRoute}`);
}

function validateRequestedEffectiveConfig(state) {
  const params = new URL(requestedRoute).searchParams;
  const expected = {
    boundarySplatPhaseMode: params.get('volume_boundary_splat_phase_mode') || null,
    boundarySplatPhaseStride: Number(params.get('volume_boundary_splat_phase_stride') || requestedPhaseStride),
    boundarySplatHistoryDepth: Number(params.get('volume_boundary_splat_history_depth') || requestedHistoryDepth),
    boundarySplatHistoryFrameStride: Number(params.get('volume_boundary_splat_history_frame_stride') || requestedHistoryFrameStride),
  };
  const mismatches = [];
  if (expected.boundarySplatPhaseMode && state?.boundarySplatPhaseMode !== expected.boundarySplatPhaseMode) {
    mismatches.push({ key: 'boundarySplatPhaseMode', requested: expected.boundarySplatPhaseMode, effective: state?.boundarySplatPhaseMode ?? null });
  }
  for (const key of ['boundarySplatPhaseStride', 'boundarySplatHistoryDepth', 'boundarySplatHistoryFrameStride']) {
    if (Number.isFinite(expected[key]) && state?.[key] !== expected[key]) {
      mismatches.push({ key, requested: expected[key], effective: state?.[key] ?? null });
    }
  }
  if (mismatches.length) {
    lastTrustworthyEvidence.staleConfigMismatch = {
      requestedRoute,
      effectiveState: compactState(state || {}),
      mismatches,
    };
    throw new Error(`stale/default config mismatch: ${JSON.stringify(mismatches)}`);
  }
}

async function waitForPrototype() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await wsRequest('Runtime.evaluate', {
      expression: `(() => {
        const proto = window.__kaminosVolumePrototype;
        if (!proto?.debugState || !proto?.renderFrozenScaleToCanvas || !proto?.controlledStepFrame) return null;
        return proto.debugState();
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const state = result.result.value;
    if (state?.active && state?.backend) return state;
    await delay(150);
  }
  throw new Error('volume prototype did not become active');
}

async function debugState() {
  const result = await wsRequest('Runtime.evaluate', {
    expression: 'window.__kaminosVolumePrototype?.debugState?.()',
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.value || null;
}

async function hideHud() {
  await wsRequest('Runtime.evaluate', {
    expression: `(() => {
      const el = document.getElementById('fps-counter');
      if (el) el.style.visibility = 'hidden';
      return { ok: true, selector: '#fps-counter', found: !!el };
    })()`,
    returnByValue: true,
  });
}

async function setCameraPose(pose) {
  const result = await wsRequest('Runtime.evaluate', {
    expression: `window.kaminosSetCameraDebugPose(${JSON.stringify(pose)})`,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.value;
}

function forcedResponseRows(count = 100) {
  return Array.from({ length: count }, (_, index) => ({
    enabled: true,
    gravityLocal: [0, -9.81, 0],
    relativeWindLocal: [-2.5 + (index % 5) * 0.05, 0, 0.5],
    accelerationLagLocal: [0.6, 0, -0.1],
    sourceAttachment: 0.9,
    dtSeconds: 1 / 30,
    buoyancyGain: 0.9,
    windGain: 0.3,
    accelerationGain: 0.7,
    opacityDamping: 0.08,
  }));
}

function forcedResponseRouteProbeRows(count = 100) {
  return Array.from({ length: count }, () => ({
    enabled: true,
    gravityLocal: [0, -9.81, 0],
    relativeWindLocal: [0, 0, 0],
    accelerationLagLocal: [1.5, 0, 0],
    sourceAttachment: 0.9,
    dtSeconds: 1 / 30,
    buoyancyGain: 0,
    windGain: 0,
    accelerationGain: 2,
    opacityDamping: 0,
  }));
}

async function captureForcedResponseAssay({ effectivePageUrl }) {
  const responses = forcedResponseRows(100);
  const rendererLabel = `${forcedResponseRendererMode}-splat`;
  const staticPose = {
    position: [0.05, 1.85, 4.35],
    target: [0, -0.18, 0.16],
  };
  const grazingPose = {
    position: [2.95, 0.48, 1.15],
    target: [0.04, 0.18, 0.04],
  };
  const staticCamera = await setCameraPose(staticPose);
  const frameEval = await wsRequest('Runtime.evaluate', {
    expression: `window.__kaminosVolumePrototype.controlledStepFrame(${JSON.stringify({
      controlledStepFrameIndex: 0,
      advanceSim: false,
      startNow: 0,
      stepDeltaMs: stepMs,
      renderScales: [1],
      includeRgba: false,
      compactSamples: true,
      resumeRenderLoop: false,
    })})`,
    awaitPromise: true,
    returnByValue: true,
  });
  const frozenFrame = frameEval.result.value;
  if (frozenFrame?.ok !== true || frozenFrame.sequenceAuthority !== 'controlled-step-sequence-v0') {
    throw new Error(`forced-response-frozen-state-unavailable:${JSON.stringify(frozenFrame)}`);
  }
  const scaleSet = frozenFrame.scaleSet;
  const staticDir = resolve(outDir, 'forced-response-static');
  const grazingDir = resolve(outDir, 'forced-response-grazing');
  mkdirSync(staticDir, { recursive: true });
  mkdirSync(grazingDir, { recursive: true });
  const rigidControlStatic = await captureRenderer({
    frameDir: staticDir,
    frameIndex: 0,
    scaleSet,
    camera: staticCamera,
    requestedRenderer: `${rendererLabel}-forced-rigid-static`,
    boundarySplatMode: forcedResponseRendererMode,
    forcedResponses: [],
  });
  const routeEfficacyProbeCapture = await captureRenderer({
    frameDir: staticDir,
    frameIndex: 0,
    scaleSet,
    camera: staticCamera,
    requestedRenderer: `${rendererLabel}-forced-route-efficacy-probe`,
    boundarySplatMode: forcedResponseRendererMode,
    forcedResponses: forcedResponseRouteProbeRows(100),
  });
  const analyticalResponseStatic = await captureRenderer({
    frameDir: staticDir,
    frameIndex: 0,
    scaleSet,
    camera: staticCamera,
    requestedRenderer: `${rendererLabel}-forced-analytical-static`,
    boundarySplatMode: forcedResponseRendererMode,
    forcedResponses: responses,
  });
  const analyticalResponseStaticRepeat = await captureRenderer({
    frameDir: staticDir,
    frameIndex: 0,
    scaleSet,
    camera: staticCamera,
    requestedRenderer: `${rendererLabel}-forced-analytical-static-repeat`,
    boundarySplatMode: forcedResponseRendererMode,
    forcedResponses: responses,
  });
  const grazingCamera = await setCameraPose(grazingPose);
  const rigidControlGrazing = await captureRenderer({
    frameDir: grazingDir,
    frameIndex: 0,
    scaleSet,
    camera: grazingCamera,
    requestedRenderer: `${rendererLabel}-forced-rigid-grazing`,
    boundarySplatMode: forcedResponseRendererMode,
    forcedResponses: [],
  });
  const analyticalResponseGrazing = await captureRenderer({
    frameDir: grazingDir,
    frameIndex: 0,
    scaleSet,
    camera: grazingCamera,
    requestedRenderer: `${rendererLabel}-forced-analytical-grazing`,
    boundarySplatMode: forcedResponseRendererMode,
    forcedResponses: responses,
  });
  failurePhase = 'forced-response-gpu-timing';
  const timingEval = await wsRequest('Runtime.evaluate', {
    expression: `window.__kaminosVolumePrototype.sampleBoundarySplatForcedResponseCostLadder(${JSON.stringify({
      responses,
      warmupSamples: 1,
      steadySamples: 4,
    })})`,
    awaitPromise: true,
    returnByValue: true,
  });
  const timing = timingEval.result.value;
  const staticDelta = imageDiff(rigidControlStatic.image.path, analyticalResponseStatic.image.path);
  const grazingDelta = imageDiff(rigidControlGrazing.image.path, analyticalResponseGrazing.image.path);
  const staticRepeatDelta = imageDiff(analyticalResponseStatic.image.path, analyticalResponseStaticRepeat.image.path);
  const routeEfficacyDelta = imageDiff(rigidControlStatic.image.path, routeEfficacyProbeCapture.image.path);
  const captures = [
    rigidControlStatic,
    routeEfficacyProbeCapture,
    analyticalResponseStatic,
    analyticalResponseStaticRepeat,
    rigidControlGrazing,
    analyticalResponseGrazing,
  ];
  return {
    schema: FORCED_RESPONSE_SCHEMA,
    status: timing?.stopCeilingExceeded ? 'stop-ceiling-exceeded' : 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectivePageUrl,
    requestedResponseRoute: 'boundary-splat-analytical-age-height-forcing-warp-v0',
    effectiveRoute: analyticalResponseStatic.forcedResponseReceipt?.effectiveRoute || null,
    forcedResponseRendererMode,
    forcedResponseRendererIdentity,
    forcedResponseExpectedModelIdentity,
    descriptorIdentity: INSTANCE_DESCRIPTOR_IDENTITY,
    historyIdentity: 'boundary-splat-live-history-ring-v0',
    sourceAuthority: SOURCE_AUTHORITY,
    browser: {
      identity: browserSession.identity,
      mode: browserSession.mode,
      headless,
      unsafeWebGpuEnabled: headless,
      port,
      userDataDir,
      windowSize,
      pageUrl: effectivePageUrl,
    },
    frozenState: {
      sequenceAuthority: frozenFrame.sequenceAuthority,
      sameBrowserSessionId: frozenFrame.sameBrowserSessionId,
      sameStateCaptureId: scaleSet.sameStateCaptureId,
      baseFrameCount: scaleSet.baseFrameCount,
      baseSimStepCount: scaleSet.baseSimStepCount,
    },
    rigidControl: {
      staticCamera: rigidControlStatic,
      grazingCamera: rigidControlGrazing,
    },
    analyticalResponse: {
      staticCamera: analyticalResponseStatic,
      staticCameraRepeat: analyticalResponseStaticRepeat,
      grazingCamera: analyticalResponseGrazing,
    },
    routeEfficacyProbe: {
      capture: routeEfficacyProbeCapture,
      visualDelta: routeEfficacyDelta,
      excludedFromTeacherJudgment: true,
    },
    visualDeltas: {
      staticRigidVsAnalytical: staticDelta,
      grazingRigidVsAnalytical: grazingDelta,
      staticAnalyticalRepeat: staticRepeatDelta,
    },
    timing,
    stopCeilingExceeded: timing?.stopCeilingExceeded === true,
    inspectedArtifacts: captures.map(capture => capture.image.path),
    falseClosureChecks: {
      rejectsFallbackRoutes: true,
      rejectsMissingOrBlankCapture: true,
      rejectsInvisibleAnalyticalResponse: true,
      rejectsCameraInstability: true,
      rejectsMissingGpuTimestampAuthority: true,
      preservesStopCeiling: true,
    },
  };
}

function rejectForcedResponseFalseClosure(report) {
  const rigidCaptures = Object.values(report.rigidControl || {});
  const analyticalCaptures = Object.values(report.analyticalResponse || {});
  if (rigidCaptures.some(capture => capture?.forcedResponseReceipt?.effectiveRoute !== 'boundary-splat-rigid-transformed-history-control-v0')) {
    throw new Error('forced-response-route-disagreement:rigid-control');
  }
  if (analyticalCaptures.some(capture => capture?.forcedResponseReceipt?.effectiveRoute !== 'boundary-splat-analytical-age-height-forcing-warp-v0')) {
    throw new Error('forced-response-route-disagreement:analytical-response');
  }
  if ([...rigidCaptures, ...analyticalCaptures].some(capture => capture?.rendererIdentity !== forcedResponseRendererIdentity
    || capture?.appliedModelIdentity !== forcedResponseExpectedModelIdentity)) {
    throw new Error('forced-response-route-disagreement:canonical-history-renderer');
  }
  const routeProbe = report.routeEfficacyProbe;
  if (routeProbe?.capture?.forcedResponseReceipt?.effectiveRoute !== 'boundary-splat-analytical-age-height-forcing-warp-v0'
    || routeProbe.capture.rendererIdentity !== forcedResponseRendererIdentity
    || routeProbe.capture.appliedModelIdentity !== forcedResponseExpectedModelIdentity
    || routeProbe.excludedFromTeacherJudgment !== true
    || routeProbe.visualDelta?.changedFraction <= 0.0001) {
    throw new Error(`forced-response-route-efficacy-missing:${JSON.stringify(routeProbe)}`);
  }
  const timingRows = report.timing?.rows || [];
  const rasterProfiles = timingRows.flatMap(row => [row.rigidControl, row.analyticalResponse]);
  if (report.timing?.ok !== true
    || !String(report.timing?.authority || '').includes('timestamp-query')
    || timingRows.length !== 3
    || timingRows.some(row => !Number.isFinite(row.completeResponseMs))
    || rasterProfiles.some(profile => profile?.timestampStatus !== 'measured'
      || !profile.splatRaster?.samples?.length
      || profile.splatRaster.samples.some(sample => !Number.isFinite(sample)))) {
    throw new Error(`forced-response-timing-unavailable:${JSON.stringify(report.timing)}`);
  }
  if (timingRows.map(row => row.instanceCount).join(',') !== '1,16,100') {
    throw new Error(`forced-response-timing-count-disagreement:${JSON.stringify(timingRows)}`);
  }
  if (report.stopCeilingExceeded !== timingRows.some(row => row.completeResponseMs > row.stopCeilingMs)) {
    throw new Error(`forced-response-stop-ceiling-disagreement:${JSON.stringify(timingRows)}`);
  }
  if (report.stopCeilingExceeded) {
    throw new Error(`forced-response-stop-ceiling-exceeded:${JSON.stringify(timingRows)}`);
  }
  if (report.visualDeltas.staticRigidVsAnalytical.changedFraction <= 0.001
    || report.visualDeltas.grazingRigidVsAnalytical.changedFraction <= 0.001) {
    throw new Error(`forced-response-visual-delta-missing:${JSON.stringify(report.visualDeltas)}`);
  }
  if (report.visualDeltas.staticAnalyticalRepeat.meanAbsDiff > 1.5) {
    throw new Error(`forced-response-camera-instability:${JSON.stringify(report.visualDeltas.staticAnalyticalRepeat)}`);
  }
}

async function captureSequence(config) {
  const sequenceDir = resolve(outDir, config.label);
  mkdirSync(sequenceDir, { recursive: true });
  const frames = [];
  let sameBrowserSessionId = null;
  let sequenceStartNowMs = null;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const pose = config.sequenceKind === 'static-camera'
      ? config.pose
      : interpolatePose(config.from, config.to, frameIndex / Math.max(1, frameCount - 1));
    const camera = await setCameraPose(pose);
    if (wallStepMs > 0 && frameIndex > 0) await delay(wallStepMs);
    const frameEval = await wsRequest('Runtime.evaluate', {
      expression: `window.__kaminosVolumePrototype.controlledStepFrame(${JSON.stringify({
        controlledStepFrameIndex: frameIndex,
        advanceSim: frameIndex > 0,
        sameBrowserSessionId,
        startNow: sequenceStartNowMs,
        stepDeltaMs: stepMs,
        renderScales: [1],
        includeRgba: false,
        compactSamples: true,
        resumeRenderLoop: false,
      })})`,
      awaitPromise: true,
      returnByValue: true,
    });
    const frame = frameEval.result.value;
    if (frame?.ok !== true || frame.sequenceAuthority !== 'controlled-step-sequence-v0') {
      throw new Error(`controlled step failed for ${config.label} frame ${frameIndex}: ${JSON.stringify(frame)}`);
    }
    sameBrowserSessionId = frame.sameBrowserSessionId;
    sequenceStartNowMs = frame.sequenceStartNowMs;
    const scaleSet = frame.scaleSet;
    const frameDir = resolve(sequenceDir, `frame-${String(frameIndex + 1).padStart(3, '0')}`);
    mkdirSync(frameDir, { recursive: true });
    const analytic = await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: 'analytic-splat',
      boundarySplatMode: 'analytic',
    });
    const learned = await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: 'learned-splat',
      boundarySplatMode: 'learned',
    });
    const raymarch = await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: RAYMARCH_RENDERER,
      boundarySplatMode: 'off',
    });
    const phaseLabCaptures = [];
    if (config.label === 'staticCamera' && frameIndex === 0) {
      for (const phaseMode of PHASE_LAB_MODES) {
        phaseLabCaptures.push(await captureRenderer({
          frameDir,
          frameIndex,
          scaleSet,
          camera,
          requestedRenderer: `analytic-splat-phase-${phaseMode}`,
          boundarySplatMode: 'analytic',
          boundarySplatPhaseMode: phaseMode,
          boundarySplatPhaseStride: requestedPhaseStride,
          boundarySplatHistoryDepth: requestedHistoryDepth,
          boundarySplatHistoryFrameStride: requestedHistoryFrameStride,
        }));
        phaseLabCaptures.push(await captureRenderer({
          frameDir,
          frameIndex,
          scaleSet,
          camera,
          requestedRenderer: `learned-splat-phase-${phaseMode}`,
          boundarySplatMode: 'learned',
          boundarySplatPhaseMode: phaseMode,
          boundarySplatPhaseStride: requestedPhaseStride,
          boundarySplatHistoryDepth: requestedHistoryDepth,
          boundarySplatHistoryFrameStride: requestedHistoryFrameStride,
        }));
      }
    }
    let determinismRepeat = null;
    if (config.label === 'staticCamera' && frameIndex === 0) {
      determinismRepeat = await captureRenderer({
        frameDir,
        frameIndex,
        scaleSet,
        camera,
        requestedRenderer: 'analytic-splat-determinism-repeat',
        boundarySplatMode: 'analytic',
      });
    }
    frames.push({
      sequenceAuthority: frame.sequenceAuthority,
      sameBrowserSessionId: frame.sameBrowserSessionId,
      controlledStepFrameIndex: frameIndex,
      controlledStepDeltaMs: frame.controlledStepDeltaMs,
      controlledStepNowMs: frame.controlledStepNowMs,
      controlledStepCapture: frame.controlledStepCapture,
      sameStateCaptureId: scaleSet.sameStateCaptureId,
      baseFrameCount: scaleSet.baseFrameCount,
      baseSimStepCount: scaleSet.baseSimStepCount,
      camera,
      captures: [analytic, learned, raymarch, ...phaseLabCaptures, determinismRepeat].filter(Boolean),
    });
  }
  const effectiveRoute = frames[0]?.captures[0]?.effectiveRoute || null;
  const sequence = {
    label: config.label,
    sequenceKind: config.sequenceKind,
    sameBrowserSessionId,
    sampleAuthority: 'controlled-step-sim-advance',
    frameCount,
    stepMs,
    sequenceDurationMs: (frameCount - 1) * stepMs,
    effectiveRoute,
    frames,
  };
  addMotionEnergy(sequence);
  return sequence;
}

async function captureRenderer({
  frameDir,
  frameIndex,
  scaleSet,
  camera,
  requestedRenderer,
  boundarySplatMode,
  boundarySplatPhaseMode = null,
  boundarySplatPhaseStride = null,
  boundarySplatHistoryDepth = null,
  boundarySplatHistoryFrameStride = null,
  forcedResponses = null,
}) {
  let forcedResponseReceipt = null;
  if (Array.isArray(forcedResponses)) {
    const responseEval = await wsRequest('Runtime.evaluate', {
      expression: `window.__kaminosVolumePrototype.setBoundarySplatForcedResponses(${JSON.stringify(forcedResponses)}, ${JSON.stringify({
        requestedRoute: forcedResponses.length > 0
          ? 'boundary-splat-analytical-age-height-forcing-warp-v0'
          : 'boundary-splat-rigid-transformed-history-control-v0',
      })})`,
      awaitPromise: true,
      returnByValue: true,
    });
    forcedResponseReceipt = responseEval.result.value;
    if (forcedResponseReceipt?.ok !== true) {
      throw new Error(`forced-response-route-disagreement:${JSON.stringify(forcedResponseReceipt)}`);
    }
  }
  const controlOverrides = { boundarySplatMode };
  if (boundarySplatPhaseMode) controlOverrides.boundarySplatPhaseMode = boundarySplatPhaseMode;
  if (boundarySplatPhaseStride) controlOverrides.boundarySplatPhaseStride = boundarySplatPhaseStride;
  if (boundarySplatHistoryDepth) controlOverrides.boundarySplatHistoryDepth = boundarySplatHistoryDepth;
  if (boundarySplatHistoryFrameStride) controlOverrides.boundarySplatHistoryFrameStride = boundarySplatHistoryFrameStride;
  const canvasEval = await wsRequest('Runtime.evaluate', {
    expression: `window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
      renderScale: 1,
      now: scaleSet.fixedNowMs,
      sameStateCaptureId: scaleSet.sameStateCaptureId,
      baseFrameCount: scaleSet.baseFrameCount,
      baseSimStepCount: scaleSet.baseSimStepCount,
      controlOverrides,
      restoreControls: true,
      resumeRenderLoop: false,
    })})`,
    awaitPromise: true,
    returnByValue: true,
  });
  const canvasCapture = canvasEval.result.value;
  if (canvasCapture?.ok !== true || canvasCapture.sampleAuthority !== 'render-only-frozen-sim-state') {
    throw new Error(`renderer capture failed for ${requestedRenderer}: ${JSON.stringify(canvasCapture)}`);
  }
  const postState = await debugState();
  const clip = clipFromCanvas(canvasCapture.canvasCssRect);
  const shot = await wsRequest('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip,
  });
  const imageBuffer = Buffer.from(shot.data, 'base64');
  const imageHash = sha256(imageBuffer);
  const imagePath = resolve(frameDir, `${String(frameIndex + 1).padStart(3, '0')}-${slug(requestedRenderer)}.png`);
  writeFileSync(imagePath, imageBuffer);
  const metrics = measureScreenshot(imageBuffer);
  const isSplat = boundarySplatMode !== 'off';
  const effectiveRenderer = isSplat
    ? canvasCapture.boundarySplatRendererIdentity
    : canvasCapture.volumeReconstructionStyle;
  const fallbackReason = postState?.boundarySplatFallbackReason ?? canvasCapture.boundarySplatFallbackReason ?? null;
  const capture = {
    requestedRenderer,
    effectiveRenderer,
    fallbackReason,
    requestedRoute,
    effectiveRoute: canvasCapture.effectiveRoute,
    rendererIdentity: canvasCapture.boundarySplatRendererIdentity || postState?.boundarySplatRendererIdentity || SPLAT_RENDERER,
    appliedModelIdentity: canvasCapture.boundarySplatAttributeModelIdentity ?? postState?.boundarySplatAttributeModelIdentity ?? null,
    sourceAuthority: postState?.boundarySplatSourceAuthority || SOURCE_AUTHORITY,
    boundarySplatInstanceDescriptorIdentity: isSplat ? canvasCapture.boundarySplatInstanceDescriptorIdentity ?? postState?.boundarySplatInstanceDescriptorIdentity ?? null : null,
    boundarySplatRequestedInstanceCount: isSplat ? canvasCapture.boundarySplatRequestedInstanceCount ?? postState?.boundarySplatRequestedInstanceCount ?? null : null,
    boundarySplatSourceCandidateCount: isSplat ? canvasCapture.boundarySplatSourceCandidateCount ?? postState?.boundarySplatSourceCandidateCount ?? null : null,
    boundarySplatSelectorPolicyIdentity: isSplat ? canvasCapture.boundarySplatSelectorPolicyIdentity ?? postState?.boundarySplatSelectorPolicyIdentity ?? null : null,
    boundarySplatRequestedCandidateBudget: isSplat ? canvasCapture.boundarySplatRequestedCandidateBudget ?? postState?.boundarySplatRequestedCandidateBudget ?? null : null,
    boundarySplatEffectiveCandidateBudget: isSplat ? canvasCapture.boundarySplatEffectiveCandidateBudget ?? postState?.boundarySplatEffectiveCandidateBudget ?? null : null,
    boundarySplatSelectedCandidateCount: isSplat ? canvasCapture.boundarySplatSelectedCandidateCount ?? postState?.boundarySplatSelectedCandidateCount ?? null : null,
    boundarySplatSelectorCostProfile: isSplat ? canvasCapture.boundarySplatSelectorCostProfile ?? postState?.boundarySplatSelectorCostProfile ?? null : null,
    boundarySplatPhaseSourceCount: isSplat ? canvasCapture.boundarySplatPhaseSourceCount ?? postState?.boundarySplatPhaseSourceCount ?? null : null,
    phaseMode: isSplat ? canvasCapture.boundarySplatPhaseMode ?? postState?.boundarySplatPhaseMode ?? null : null,
    phaseModeIdentity: isSplat ? canvasCapture.boundarySplatPhaseModeIdentity ?? postState?.boundarySplatPhaseModeIdentity ?? null : null,
    boundarySplatPhaseStride: isSplat ? canvasCapture.boundarySplatPhaseStride ?? postState?.boundarySplatPhaseStride ?? null : null,
    boundarySplatHistoryDepth: isSplat ? canvasCapture.boundarySplatHistoryDepth ?? postState?.boundarySplatHistoryDepth ?? null : null,
    boundarySplatHistoryFrameStride: isSplat ? canvasCapture.boundarySplatHistoryFrameStride ?? postState?.boundarySplatHistoryFrameStride ?? null : null,
    boundarySplatEffectiveHistoryWindowFrames: isSplat ? canvasCapture.boundarySplatEffectiveHistoryWindowFrames ?? postState?.boundarySplatEffectiveHistoryWindowFrames ?? null : null,
    phaseSourceIdentity: isSplat ? canvasCapture.boundarySplatPhaseSourceIdentity ?? postState?.boundarySplatPhaseSourceIdentity ?? null : null,
    phaseSources: isSplat ? canvasCapture.boundarySplatPhaseSources ?? postState?.boundarySplatPhaseSources ?? null : null,
    instanceDescriptors: isSplat ? canvasCapture.boundarySplatInstanceDescriptors ?? postState?.boundarySplatInstanceDescriptors ?? null : null,
    incrementalInstanceCost: isSplat ? canvasCapture.boundarySplatIncrementalInstanceCost ?? postState?.boundarySplatIncrementalInstanceCost ?? null : null,
    forcedResponseReceipt: isSplat ? postState?.boundarySplatForcedResponseEffectiveRoute
      ? {
          ...(forcedResponseReceipt || {}),
          requestedRoute: postState.boundarySplatForcedResponseRequestedRoute,
          effectiveRoute: postState.boundarySplatForcedResponseEffectiveRoute,
          activeCount: postState.boundarySplatForcedResponseActiveCount,
          controlUploadCpuMs: postState.boundarySplatForcedResponseControlUploadCpuMs,
        }
      : forcedResponseReceipt : null,
    boundarySplatCandidateCount: isSplat ? postState?.boundarySplatCandidateCount ?? null : null,
    boundarySplatInstanceCount: isSplat ? postState?.boundarySplatInstanceCount ?? null : null,
    boundarySplatOverflowCount: isSplat ? postState?.boundarySplatOverflowCount ?? null : null,
    boundarySplatCountAuthority: isSplat ? postState?.boundarySplatCountAuthority ?? null : null,
    boundarySplatCandidateCopyBytes: isSplat ? postState?.boundarySplatCopyBytesThisFrame ?? null : null,
    boundarySplatCandidateCopyDisposition: isSplat ? postState?.boundarySplatCopyDisposition ?? null : null,
    image: {
      path: imagePath,
      basename: basename(imagePath),
      sha256: imageHash,
      authority: canvasCapture.imageAuthority,
      metrics,
      clip,
      canvasCssRect: canvasCapture.canvasCssRect,
    },
    camera,
    canvasCapture: {
      sampleAuthority: canvasCapture.sampleAuthority,
      imageAuthority: canvasCapture.imageAuthority,
      sameStateCaptureId: canvasCapture.sameStateCaptureId,
      baseFrameCount: canvasCapture.baseFrameCount,
      baseSimStepCount: canvasCapture.baseSimStepCount,
      frameCount: canvasCapture.frameCount,
      simStepCount: canvasCapture.simStepCount,
      renderScale: canvasCapture.renderScale,
      renderWidth: canvasCapture.renderWidth,
      renderHeight: canvasCapture.renderHeight,
      backend: canvasCapture.backend,
      boundarySidecarIdentity: canvasCapture.boundarySidecarIdentity,
      boundarySidecarAuthority: canvasCapture.boundarySidecarAuthority,
      boundarySidecarSource: canvasCapture.boundarySidecarSource,
      boundarySplatMode: canvasCapture.boundarySplatMode,
      boundarySplatRendererIdentity: canvasCapture.boundarySplatRendererIdentity,
      boundarySplatAttributeModelIdentity: canvasCapture.boundarySplatAttributeModelIdentity,
      boundarySplatInstanceDescriptorIdentity: canvasCapture.boundarySplatInstanceDescriptorIdentity,
      boundarySplatRequestedInstanceCount: canvasCapture.boundarySplatRequestedInstanceCount,
      boundarySplatSourceCandidateCount: canvasCapture.boundarySplatSourceCandidateCount,
      boundarySplatPhaseSourceCount: canvasCapture.boundarySplatPhaseSourceCount,
      phaseMode: canvasCapture.boundarySplatPhaseMode,
      phaseModeIdentity: canvasCapture.boundarySplatPhaseModeIdentity,
      boundarySplatPhaseStride: canvasCapture.boundarySplatPhaseStride,
      boundarySplatHistoryDepth: canvasCapture.boundarySplatHistoryDepth,
      boundarySplatHistoryFrameStride: canvasCapture.boundarySplatHistoryFrameStride,
      boundarySplatEffectiveHistoryWindowFrames: canvasCapture.boundarySplatEffectiveHistoryWindowFrames,
      phaseSourceIdentity: canvasCapture.boundarySplatPhaseSourceIdentity,
      incrementalInstanceCost: canvasCapture.boundarySplatIncrementalInstanceCost,
    },
  };
  validateCapture(capture);
  return capture;
}

function clipFromCanvas(rect = {}) {
  return {
    x: Math.max(0, Number(rect.x) || 0),
    y: Math.max(0, Number(rect.y) || 0),
    width: Math.max(2, Number(rect.width) || 0),
    height: Math.max(2, Number(rect.height) || 0),
    scale: 1,
  };
}

function validateCapture(capture) {
  if (capture.image.metrics.litPixels <= 20 || capture.image.metrics.meanLuma <= 1) {
    throw new Error(`missing or blank capture: ${JSON.stringify({ requestedRenderer: capture.requestedRenderer, metrics: capture.image.metrics })}`);
  }
  if (capture.requestedRenderer.includes('analytic-splat')) {
    if (capture.effectiveRenderer !== SPLAT_RENDERER) {
      throw new Error(`renderer disagreement: requested analytic splat but effective renderer was ${capture.effectiveRenderer}`);
    }
    if (capture.fallbackReason) {
      throw new Error(`fallback route rejected for analytic splat: ${capture.fallbackReason}`);
    }
    if (capture.rendererIdentity !== SPLAT_RENDERER) {
      throw new Error(`substituted raymarch rejected: analytic splat identity missing, got ${capture.rendererIdentity}`);
    }
    if (capture.appliedModelIdentity !== null) {
      throw new Error(`stale/default config rejected: analytic capture applied model ${capture.appliedModelIdentity}`);
    }
    if (!Number.isFinite(capture.boundarySplatCandidateCount) || capture.boundarySplatCandidateCount <= 0) {
      throw new Error(`candidate telemetry missing for analytic splat: ${JSON.stringify({
        candidateCount: capture.boundarySplatCandidateCount,
        authority: capture.boundarySplatCountAuthority,
      })}`);
    }
  }
  if (capture.requestedRenderer === 'learned-splat') {
    if (capture.effectiveRenderer !== LEARNED_SPLAT_RENDERER || capture.rendererIdentity !== LEARNED_SPLAT_RENDERER) {
      throw new Error(`renderer disagreement: requested learned splat but effective renderer was ${capture.effectiveRenderer}/${capture.rendererIdentity}`);
    }
    if (capture.fallbackReason) throw new Error(`fallback route rejected for learned splat: ${capture.fallbackReason}`);
    if (REJECTED_LEARNED_MODELS.has(capture.appliedModelIdentity)) {
      throw new Error(`stale/default config rejected: forbidden learned model ${capture.appliedModelIdentity}`);
    }
    if (capture.appliedModelIdentity !== EXPECTED_LEARNED_MODEL) {
      throw new Error(`renderer disagreement: expected learned model ${EXPECTED_LEARNED_MODEL}, got ${capture.appliedModelIdentity}`);
    }
    if (!Number.isFinite(capture.boundarySplatCandidateCount) || capture.boundarySplatCandidateCount <= 0) {
      throw new Error(`candidate telemetry missing for learned splat: ${JSON.stringify(capture)}`);
    }
  }
  if (capture.requestedRenderer.includes('splat')) {
    if (capture.boundarySplatInstanceDescriptorIdentity !== INSTANCE_DESCRIPTOR_IDENTITY) {
      throw new Error(`instance descriptor disagreement: expected ${INSTANCE_DESCRIPTOR_IDENTITY}, got ${capture.boundarySplatInstanceDescriptorIdentity}`);
    }
    if (!Number.isFinite(capture.boundarySplatRequestedInstanceCount) || capture.boundarySplatRequestedInstanceCount < 1) {
      throw new Error(`instance-count route missing for ${capture.requestedRenderer}: ${JSON.stringify(capture)}`);
    }
    if (!PHASE_SOURCE_IDENTITIES.has(capture.phaseSourceIdentity)) {
      throw new Error(`phase-source identity missing for ${capture.requestedRenderer}: ${capture.phaseSourceIdentity}`);
    }
    if (capture.boundarySplatCandidateCopyBytes !== 0) {
      throw new Error(`candidate-copy disagreement: expected zero bytes, got ${capture.boundarySplatCandidateCopyBytes}`);
    }
    if (!capture.boundarySplatCandidateCopyDisposition) {
      throw new Error('candidate-copy disagreement: missing copy disposition');
    }
  }
  if (capture.requestedRenderer === RAYMARCH_RENDERER && capture.effectiveRenderer === SPLAT_RENDERER) {
    throw new Error('renderer disagreement: matched raymarch capture resolved to analytic splat');
  }
}

function rejectFalseClosure(report) {
  const phrases = [
    'missing or blank capture',
    'substituted raymarch',
    'cached or static output',
    'renderer disagreement',
  ];
  assert.ok(phrases.length === 4, 'false closure phrases must remain explicit');
  for (const sequence of [report.staticCamera, report.grazingCamera]) {
    if (sequence.sameBrowserSessionId !== sequence.frames[0]?.sameBrowserSessionId) {
      throw new Error(`same-browser identity missing for ${sequence.label}`);
    }
    for (const frame of sequence.frames) {
      const analytic = frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat');
      const learned = frame.captures.find(capture => capture.requestedRenderer === 'learned-splat');
      const raymarch = frame.captures.find(capture => capture.requestedRenderer === RAYMARCH_RENDERER);
      if (!analytic || !learned || !raymarch) throw new Error(`partial A/B report for ${sequence.label} frame ${frame.controlledStepFrameIndex}`);
      validateCapture(analytic);
      validateCapture(learned);
      validateCapture(raymarch);
      if (analytic.canvasCapture.sameStateCaptureId !== learned.canvasCapture.sameStateCaptureId) {
        throw new Error(`same-state disagreement for ${sequence.label} frame ${frame.controlledStepFrameIndex}`);
      }
      if (analytic.boundarySplatCandidateCount !== learned.boundarySplatCandidateCount) {
        throw new Error(`candidate-count disagreement for ${sequence.label} frame ${frame.controlledStepFrameIndex}: analytic=${analytic.boundarySplatCandidateCount} learned=${learned.boundarySplatCandidateCount}`);
      }
    }
  }
  if (report.frozenDeterminism.meanAbsDiff > 1.5) {
    throw new Error(`frozen determinism failed: ${JSON.stringify(report.frozenDeterminism)}`);
  }
  if (report.candidateChurn.maxAbsDelta <= 0 && report.staticCamera.motionEnergy.maxMeanAbsDiff <= 0.1) {
    throw new Error('cached or static output rejected: sequence did not move in candidates or pixels');
  }
}

function summarizeAnalyticLearnedComparison(frames) {
  const comparisons = frames.map(frame => {
    const analytic = frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat');
    const learned = frame.captures.find(capture => capture.requestedRenderer === 'learned-splat');
    if (!analytic || !learned) return null;
    return {
      sameBrowserSessionId: frame.sameBrowserSessionId,
      sameStateCaptureId: frame.sameStateCaptureId,
      baseFrameCount: frame.baseFrameCount,
      baseSimStepCount: frame.baseSimStepCount,
      analyticRendererIdentity: analytic.rendererIdentity,
      learnedRendererIdentity: learned.rendererIdentity,
      learnedModelIdentity: learned.appliedModelIdentity,
      candidateCount: analytic.boundarySplatCandidateCount,
      sourceCandidateCount: analytic.boundarySplatSourceCandidateCount,
      requestedInstanceCount: analytic.boundarySplatRequestedInstanceCount,
      instanceCount: analytic.boundarySplatInstanceCount,
      phaseSourceIdentity: analytic.phaseSourceIdentity,
      phaseSources: analytic.phaseSources,
      instanceDescriptorIdentity: analytic.boundarySplatInstanceDescriptorIdentity,
      instanceDescriptors: analytic.instanceDescriptors,
      incrementalInstanceCost: analytic.incrementalInstanceCost,
      overflowCount: analytic.boundarySplatOverflowCount,
      analyticCopyDisposition: analytic.boundarySplatCandidateCopyDisposition,
      learnedCopyDisposition: learned.boundarySplatCandidateCopyDisposition,
      pixelDelta: imageDiff(analytic.image.path, learned.image.path),
      analyticImage: analytic.image.path,
      learnedImage: learned.image.path,
    };
  }).filter(Boolean);
  return {
    authority: 'same-browser-same-frozen-state-analytic-learned-native-png-v0',
    expectedLearnedModelIdentity: EXPECTED_LEARNED_MODEL,
    rejectedLearnedModelIdentities: [...REJECTED_LEARNED_MODELS],
    comparisonCount: comparisons.length,
    comparisons,
  };
}

function summarizeDuplicateMotionWitness(frames) {
  const captures = frames
    .map(frame => frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat'))
    .filter(Boolean);
  const requestedInstanceCounts = captures.map(capture => capture.boundarySplatRequestedInstanceCount).filter(Number.isFinite);
  const phaseSourceIdentities = [...new Set(captures.map(capture => capture.phaseSourceIdentity).filter(Boolean))];
  const descriptorIdentities = [...new Set(captures.map(capture => capture.boundarySplatInstanceDescriptorIdentity).filter(Boolean))];
  const requestedInstanceCount = requestedInstanceCounts.length
    ? Math.max(...requestedInstanceCounts)
    : null;
  const sharedCurrentControl = phaseSourceIdentities.includes(SHARED_CURRENT_PHASE_SOURCE);
  const liveHistoryOffset = phaseSourceIdentities.includes(LIVE_HISTORY_PHASE_SOURCE);
  const ageSweepHistory = phaseSourceIdentities.includes(AGE_SWEEP_PHASE_SOURCE);
  const sameHistorySlot = phaseSourceIdentities.includes(SAME_HISTORY_SLOT_PHASE_SOURCE);
  const temporalDiversityActive = liveHistoryOffset || ageSweepHistory;
  const motionCorrelation = sharedCurrentControl && !temporalDiversityActive ? 1 : null;
  const incrementalInstanceCost = captures.at(-1)?.incrementalInstanceCost ?? null;
  return {
    identity: 'duplicateMotionWitness',
    authority: 'renderer-phase-source-identity-and-draw-telemetry-v0',
    status: temporalDiversityActive ? 'offset-motion-source-active' : 'synchronized-control',
    requestedInstanceCount,
    descriptorIdentities,
    phaseSourceIdentities,
    sharedCurrentControl,
    liveHistoryOffset,
    ageSweepHistory,
    sameHistorySlot,
    motionCorrelation,
    incrementalInstanceCost,
    claimBoundary: temporalDiversityActive
      ? 'Motion diversity comes from the reported live-history phase source.'
      : 'Four transformed fires are spatially distinct but intentionally share current candidate phase; this is a synchronization control, not phase diversity.',
  };
}

function summarizePhaseLabWitness(frames) {
  const captures = frames
    .flatMap(frame => frame.captures.filter(capture => capture.requestedRenderer?.includes('splat')))
    .filter(Boolean);
  const phaseModeComparisons = PHASE_LAB_MODES.map(mode => {
    const modeCaptures = captures.filter(capture => capture.phaseMode === mode);
    const latest = modeCaptures.at(-1) || null;
    return {
      phaseMode: mode,
      observed: modeCaptures.length > 0,
      captureCount: modeCaptures.length,
      phaseModeIdentity: latest?.phaseModeIdentity ?? null,
      phaseSourceIdentity: latest?.phaseSourceIdentity ?? null,
      phaseStride: latest?.boundarySplatPhaseStride ?? null,
      historyDepth: latest?.boundarySplatHistoryDepth ?? null,
      historyFrameStride: latest?.boundarySplatHistoryFrameStride ?? null,
      effectiveHistoryWindowFrames: latest?.boundarySplatEffectiveHistoryWindowFrames ?? null,
      phaseSources: latest?.phaseSources ?? null,
      requestedInstanceCount: latest?.boundarySplatRequestedInstanceCount ?? null,
      sourceCandidateCount: latest?.boundarySplatSourceCandidateCount ?? null,
      instanceCount: latest?.boundarySplatInstanceCount ?? null,
      overflowCount: latest?.boundarySplatOverflowCount ?? null,
      incrementalInstanceCost: latest?.incrementalInstanceCost ?? null,
    };
  });
  return {
    identity: 'phaseLabWitness',
    authority: 'same-live-route-explicit-phase-mode-telemetry-v0',
    phaseModeComparisons,
    observedPhaseModes: [...new Set(captures.map(capture => capture.phaseMode).filter(Boolean))],
    claimBoundary: 'This summary proves routed phase-source identity and cost/candidate telemetry; visual convergence or manifold claims require inspecting the captured frames/contact sheets.',
  };
}

function loadOperatorPrettySubstrate(path) {
  if (!path) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      identity: parsed.identity || 'operator-pretty-four-flame-substrate-v0',
      path,
      sha256: sha256(Buffer.from(raw)),
      capturedAt: parsed.capturedAt || null,
      href: parsed.href || null,
      routeParams: parsed.routeParams || null,
      model: parsed.kaminosDebugState?.boundarySplatAttributeModelIdentity ?? null,
      phaseMode: parsed.kaminosDebugState?.boundarySplatPhaseMode ?? null,
      phaseStride: parsed.kaminosDebugState?.boundarySplatPhaseStride ?? null,
      historyDepth: parsed.kaminosDebugState?.boundarySplatHistoryDepth ?? null,
      historyFrameStride: parsed.kaminosDebugState?.boundarySplatHistoryFrameStride ?? null,
      effectiveHistoryWindowFrames: parsed.kaminosDebugState?.boundarySplatEffectiveHistoryWindowFrames ?? null,
      phaseSourceIdentity: parsed.kaminosDebugState?.boundarySplatPhaseSourceIdentity ?? null,
      requestedInstanceCount: parsed.kaminosDebugState?.boundarySplatRequestedInstanceCount ?? null,
      sourceCandidateCount: parsed.kaminosDebugState?.boundarySplatSourceCandidateCount ?? null,
      claimBoundary: 'Operator visual substrate pointer; paired screenshot carries the visual claim when canvas capture is hidden or 1x1.',
    };
  } catch (error) {
    return {
      identity: 'operatorPrettySubstrate',
      path,
      status: 'unreadable',
      error: error?.message || String(error),
    };
  }
}

function computeFrozenDeterminism(frame) {
  const a = frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat');
  const b = frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat-determinism-repeat');
  if (!a || !b) return { ok: false, reason: 'missing-repeat' };
  const diff = imageDiff(a.image.path, b.image.path);
  return {
    ok: diff.meanAbsDiff <= 1.5,
    authority: 'same-state-analytic-splat-repeat-cdp-canvas-capture-v0',
    first: a.image.path,
    repeat: b.image.path,
    ...diff,
  };
}

function summarizeCandidateChurn(frames) {
  const counts = frames.map(frame => frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat')?.boundarySplatCandidateCount)
    .filter(Number.isFinite);
  const deltas = [];
  for (let index = 1; index < counts.length; index += 1) deltas.push(counts[index] - counts[index - 1]);
  return {
    authority: 'post-submit-gpu-indirect-candidate-count-delta-v0',
    counts,
    deltas,
    maxAbsDelta: deltas.reduce((max, value) => Math.max(max, Math.abs(value)), 0),
    meanAbsDelta: deltas.length ? deltas.reduce((sum, value) => sum + Math.abs(value), 0) / deltas.length : 0,
  };
}

function summarizeBirthDeath(frames) {
  const churn = summarizeCandidateChurn(frames);
  let candidateBirthLowerBound = 0;
  let candidateDeathLowerBound = 0;
  for (const delta of churn.deltas) {
    if (delta > 0) candidateBirthLowerBound += delta;
    if (delta < 0) candidateDeathLowerBound += Math.abs(delta);
  }
  return {
    authority: 'candidate-count-lower-bound-birth-death-v0',
    note: 'Without stable candidate ids this is a count-delta lower bound, not exact particle lineage.',
    candidateBirthLowerBound,
    candidateDeathLowerBound,
    netDelta: churn.deltas.reduce((sum, value) => sum + value, 0),
  };
}

function addMotionEnergy(sequence) {
  const analyticCaptures = sequence.frames.map(frame => frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat'));
  const diffs = [];
  for (let index = 1; index < analyticCaptures.length; index += 1) {
    diffs.push(imageDiff(analyticCaptures[index - 1].image.path, analyticCaptures[index].image.path));
  }
  sequence.motionEnergy = {
    authority: 'adjacent-frame-cdp-png-diff-v0',
    diffs,
    maxMeanAbsDiff: diffs.reduce((max, diff) => Math.max(max, diff.meanAbsDiff), 0),
    meanMeanAbsDiff: diffs.length ? diffs.reduce((sum, diff) => sum + diff.meanAbsDiff, 0) / diffs.length : 0,
  };
}

function interpolatePose(from, to, t) {
  return {
    position: from.position.map((value, index) => value + (to.position[index] - value) * t),
    target: from.target.map((value, index) => value + (to.target[index] - value) * t),
  };
}

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8, 'only 8-bit PNG screenshots are supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = zlibInflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let p = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p++];
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    rows.push(row);
    prev = row;
  }
  return { width, height, channels, rows };
}

function measureScreenshot(buffer) {
  const png = parsePngRgba(buffer);
  let litPixels = 0;
  let totalLuma = 0;
  let samples = 0;
  for (let y = Math.floor(png.height * 0.05); y < Math.floor(png.height * 0.95); y += 2) {
    const row = png.rows[y];
    for (let x = Math.floor(png.width * 0.05); x < Math.floor(png.width * 0.95); x += 2) {
      const i = x * png.channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLuma += luma;
      samples += 1;
      if (luma > 18) litPixels += 1;
    }
  }
  return {
    width: png.width,
    height: png.height,
    samples,
    litPixels,
    meanLuma: samples ? totalLuma / samples : 0,
  };
}

function imageDiff(pathA, pathB) {
  const a = parsePngRgba(readBuffer(pathA));
  const b = parsePngRgba(readBuffer(pathB));
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  let total = 0;
  let changed = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 2) {
    const rowA = a.rows[y];
    const rowB = b.rows[y];
    for (let x = 0; x < width; x += 2) {
      const ia = x * a.channels;
      const ib = x * b.channels;
      const diff = (
        Math.abs(rowA[ia] - rowB[ib])
        + Math.abs(rowA[ia + 1] - rowB[ib + 1])
        + Math.abs(rowA[ia + 2] - rowB[ib + 2])
      ) / 3;
      total += diff;
      if (diff > 3) changed += 1;
      samples += 1;
    }
  }
  return {
    width,
    height,
    samples,
    meanAbsDiff: samples ? total / samples : 0,
    changedFraction: samples ? changed / samples : 0,
  };
}

function readBuffer(path) {
  return readFileSync(path);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function slug(value) {
  return String(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function compactState(state) {
  if (!state) return null;
  return {
    active: state.active,
    backend: state.backend,
    effectiveRoute: state.effectiveRoute,
    volumeReconstructionStyle: state.volumeReconstructionStyle,
    boundarySplatMode: state.boundarySplatMode,
    boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
    boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
    boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
    boundarySplatInstanceDescriptorIdentity: state.boundarySplatInstanceDescriptorIdentity,
    boundarySplatRequestedInstanceCount: state.boundarySplatRequestedInstanceCount,
    boundarySplatSourceCandidateCount: state.boundarySplatSourceCandidateCount,
    boundarySplatPhaseSourceCount: state.boundarySplatPhaseSourceCount,
    phaseMode: state.boundarySplatPhaseMode,
    phaseModeIdentity: state.boundarySplatPhaseModeIdentity,
    boundarySplatPhaseStride: state.boundarySplatPhaseStride,
    boundarySplatHistoryDepth: state.boundarySplatHistoryDepth,
    boundarySplatHistoryFrameStride: state.boundarySplatHistoryFrameStride,
    boundarySplatEffectiveHistoryWindowFrames: state.boundarySplatEffectiveHistoryWindowFrames,
    phaseSourceIdentity: state.boundarySplatPhaseSourceIdentity,
    phaseSources: state.boundarySplatPhaseSources,
    incrementalInstanceCost: state.boundarySplatIncrementalInstanceCost,
    boundarySplatCandidateCount: state.boundarySplatCandidateCount,
    boundarySplatOverflowCount: state.boundarySplatOverflowCount,
    boundarySplatFallbackReason: state.boundarySplatFallbackReason,
    boundarySplatCopyBytesThisFrame: state.boundarySplatCopyBytesThisFrame,
    boundarySplatCopyDisposition: state.boundarySplatCopyDisposition,
    frameCount: state.frameCount,
    simStepCount: state.simStepCount,
  };
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
