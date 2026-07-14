#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  measureBoundarySplatTemporalFrame,
  summarizeBoundarySplatTemporalCollapse,
  validateBoundarySplatTemporalSequence,
} from './boundary-splat-temporal-collapse.mjs';

const args = parseArgs(process.argv.slice(2));
const SCHEMA = 'kaminos.volume.boundary-splat-temporal-collapse-witness.v0';
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const RENDERER = 'live-boundary-sidecar-learned-attribute-splats-v0';
const MODEL = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const SOURCE = 'live-baked-sidecar-plus-fluid-material-v0';
const COMPOSITION = 'boundary-splat-composed-field-v0';
const BUFFER_INTEGRITY = 'boundary-splat-buffer-integrity-v0';
const PHASE_SOURCE = 'age-sweep-history';
const INDIRECT_DRAW = 'boundary-splat-single-global-indirect-no-first-instance-v0';

const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-temporal-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/temporal-collapse-report.json`));
const port = Number(args.get('--chrome-port') || 19431);
const durationMs = Number(args.get('--duration-ms') ?? 30000);
const sampleMs = Number(args.get('--sample-ms') ?? 250);
const settleMs = Number(args.get('--settle-ms') ?? 3000);
const requestedBrowserProfilePath = resolve(String(
  args.get('--browser-profile') || `${outDir}/chrome-profile`,
));
const windowSize = String(args.get('--window-size') || '2048,1152');
const chrome = String(args.get('--chrome') || defaultChromePath());
const runStartedAt = new Date().toISOString();

let ws = null;
let browser = null;
let browserPageId = null;
let browserPageUrl = null;
let failurePhase = 'startup';
let temporalSequence = [];
const lastTrustworthyEvidence = {};

mkdirSync(outDir, { recursive: true });

try {
  if (!requestedRoute) throw new Error('missing --url');
  requirePositiveInteger(port, '--chrome-port');
  requirePositiveNumber(durationMs, '--duration-ms');
  requirePositiveNumber(sampleMs, '--sample-ms');
  requireNonnegativeNumber(settleMs, '--settle-ms');
  failurePhase = 'browser-seat';
  browser = await seatBrowser();
  lastTrustworthyEvidence.browser = browser;

  failurePhase = 'connect-browser';
  const page = await findPage();
  browserPageId = page.id;
  browserPageUrl = page.url;
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest('Page.enable');
  await wsRequest('Runtime.enable');

  failurePhase = 'route-load';
  await wsRequest('Page.navigate', { url: requestedRoute });
  await wsRequest('Page.bringToFront');
  await waitForPrototype();
  await delay(settleMs);
  await hideHud();
  const initialVisibilityState = await evaluate('document.visibilityState');
  if (initialVisibilityState !== 'visible') {
    throw new Error(`live-page-not-visible:${initialVisibilityState}`);
  }

  failurePhase = 'route-authority';
  const initialState = await waitForTelemetry();
  const effectivePageUrl = await evaluate('location.href');
  validateState(initialState, effectivePageUrl);
  browserPageUrl = effectivePageUrl;
  lastTrustworthyEvidence.initialState = compactState(initialState);
  lastTrustworthyEvidence.effectivePageUrl = effectivePageUrl;

  failurePhase = 'history-prime';
  const historyPrime = await evaluate(`window.__kaminosVolumePrototype.primeBoundarySplatLiveHistory(${JSON.stringify({
    minimumHistoryFrames: Number(initialState.boundarySplatEffectiveHistoryWindowFrames) + 1,
  })})`, true);
  if (
    historyPrime?.ok !== true
    || historyPrime?.simulatorCount !== 1
    || historyPrime?.phaseSourceCount !== Number(initialState.boundarySplatHistoryDepth)
    || historyPrime?.fallbackReason != null
    || Number(historyPrime?.candidateCopyBytes) !== 0
  ) {
    throw new Error(`history-prime-authority-failed:${JSON.stringify(historyPrime)}`);
  }
  lastTrustworthyEvidence.historyPrime = historyPrime;

  failurePhase = 'temporal-sequence';
  const sequenceStartedAt = Date.now();
  let sampleIndex = 0;
  while (Date.now() - sequenceStartedAt <= durationMs) {
    let pause = null;
    try {
      const visibilityState = await evaluate('document.visibilityState');
      if (visibilityState !== 'visible') throw new Error(`live-page-not-visible:${visibilityState}`);
      pause = await evaluate('window.__kaminosVolumePrototype.captureBoundarySplatWitnessFrame()', true);
      if (pause?.ok !== true) throw new Error(`exact-frame-witness-pause-failed:${JSON.stringify(pause)}`);
      const exactDrawState = pause.exactDrawState;
      if (
        !exactDrawState
        || exactDrawState.authority !== 'gpu-indirect-post-submit-witness-readback'
        || exactDrawState.indirectDrawIdentity !== INDIRECT_DRAW
        || exactDrawState.indirectCommandAuthority !== 'gpu-indirect-command-buffer-post-submit-readback-v0'
        || exactDrawState.indirectCommandAgreement !== true
      ) {
        throw new Error(`exact-frame-draw-state-unavailable:${JSON.stringify(exactDrawState)}`);
      }
      const state = await debugState();
      const pageUrl = await evaluate('location.href');
      validateState(state, pageUrl);
      if (
        Number(state.frameCount) !== Number(pause.frameCount)
        || Number(state.simStepCount) !== Number(pause.simStepCount)
        || Number(state.boundarySplatHistoryWriteSlot) !== Number(exactDrawState.historyWriteSlot)
        || Number(state.boundarySplatSourceCandidateCount) !== Number(exactDrawState.sourceCandidateCount)
        || Number(state.boundarySplatInstanceCount) !== Number(exactDrawState.instanceCount)
      ) {
        throw new Error(`exact-frame-telemetry-disagreement:${JSON.stringify({ pause, state: compactState(state) })}`);
      }
      const canvasRect = await evaluate(`(() => {
        const canvas = document.getElementById('kaminos-volume-canvas');
        if (!canvas?.classList.contains('active')) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()`);
      if (!canvasRect || canvasRect.width < 100 || canvasRect.height < 100) {
        throw new Error(`blank-or-partial-live-canvas:${JSON.stringify(canvasRect)}`);
      }
      const shot = await wsRequest('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        clip: clipFromCanvas(canvasRect),
      });
      const image = Buffer.from(shot.data, 'base64');
      const metrics = measureBoundarySplatTemporalFrame(image);
      if (metrics.litPixels <= 200 || metrics.litHeightRatio <= 0 || metrics.litWidthRatio <= 0) {
        throw new Error(`blank-or-partial-live-canvas:${JSON.stringify(metrics)}`);
      }
      let candidateGeometry = null;
      if (metrics.largestLitComponentFraction >= 0.5) {
        candidateGeometry = await evaluate(
          'window.__kaminosVolumePrototype.sampleBoundarySplatCandidateGeometry()',
          true,
        );
        if (candidateGeometry?.ok !== true) {
          throw new Error(`collapse-candidate-geometry-readback-failed:${JSON.stringify(candidateGeometry)}`);
        }
      }
      const frameCount = Number(pause.frameCount);
      const historyWriteSlot = Number(exactDrawState.historyWriteSlot);
      const imageName = `temporal-frame-${String(sampleIndex).padStart(4, '0')}-f${frameCount}-slot${historyWriteSlot}.png`;
      const imagePath = resolve(outDir, imageName);
      writeFileSync(imagePath, image);
      const sample = {
        index: sampleIndex,
        capturedAt: new Date().toISOString(),
        elapsedMs: Date.now() - sequenceStartedAt,
        frameCount,
        simStepCount: Number(state.simStepCount),
        historyWriteSlot,
        historyWriteTick: Number(state.boundarySplatHistoryWriteTick),
        historyDepth: Number(state.boundarySplatHistoryDepth),
        historyFrameStride: Number(state.boundarySplatHistoryFrameStride),
        physicalHistoryWindowFrames: Number(state.boundarySplatPhysicalHistoryWindowFrames),
        phaseSourceIdentity: state.boundarySplatPhaseSourceIdentity,
        phaseSourceCount: Number(exactDrawState.phaseSourceCount),
        boundarySplatPhaseSources: compactPhaseSources(state.boundarySplatPhaseSources),
        sourceCandidateCount: Number(exactDrawState.sourceCandidateCount),
        renderedInstanceCount: Number(exactDrawState.instanceCount),
        indirectDrawIdentity: exactDrawState.indirectDrawIdentity,
        indirectCommand: exactDrawState.indirectCommand,
        indirectCommandAgreement: exactDrawState.indirectCommandAgreement,
        indirectCommandAuthority: exactDrawState.indirectCommandAuthority,
        tierGroups: exactDrawState.tierGroups,
        bufferIntegrity: state.boundarySplatBufferIntegrity,
        overflowCount: Number(exactDrawState.overflowCount),
        candidateCopyBytes: Number(state.boundarySplatCopyBytesThisFrame),
        fallbackReason: state.boundarySplatFallbackReason,
        capturePause: pause,
        candidateGeometry,
        metrics,
        image: {
          path: imagePath,
          sha256: sha256(image),
          bytes: image.length,
          clip: clipFromCanvas(canvasRect),
          authority: 'cdp-exact-frozen-live-composed-canvas-sample-v0',
        },
      };
      temporalSequence.push(sample);
      lastTrustworthyEvidence.sampleCount = temporalSequence.length;
      lastTrustworthyEvidence.lastSample = sample;
    } finally {
      if (pause?.ok === true) {
        const resume = await evaluate('window.__kaminosVolumePrototype.resumeBoundarySplatWitnessFrame()');
        if (resume?.ok !== true) throw new Error(`exact-frame-witness-resume-failed:${JSON.stringify(resume)}`);
      }
    }
    sampleIndex += 1;
    const nextLiveSampleAt = Date.now() + sampleMs;
    const remaining = nextLiveSampleAt - Date.now();
    if (remaining > 0) await delay(remaining);
  }

  failurePhase = 'temporal-summary';
  const temporalSummary = summarizeBoundarySplatTemporalCollapse(temporalSequence);
  const temporalAdvancement = validateBoundarySplatTemporalSequence(temporalSequence, {
    requestedDurationMs: durationMs,
    sampleMs,
  });
  const finalState = await debugState();
  const finalPageUrl = await evaluate('location.href');
  validateState(finalState, finalPageUrl);
  const finalTargetReachable = await targetIsReachable(browserPageId);
  if (!finalTargetReachable) throw new Error('browser-target-unreachable-after-temporal-witness');

  writeReport({
    schema: SCHEMA,
    status: 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectivePageUrl: finalPageUrl,
    effectiveRoute: finalState.effectiveRoute,
    requestedEffectiveRouteAgreement: finalState.effectiveRoute === EFFECTIVE_ROUTE,
    requestedDurationMs: durationMs,
    requestedSampleMs: sampleMs,
    actualDurationMs: temporalSequence.at(-1).elapsedMs,
    browser: {
      ...browser,
      pageId: browserPageId,
      pageUrl: finalPageUrl,
      finalTargetReachable,
      disposition: 'preserved-open',
    },
    authority: {
      simulator: 'one-live-simulator-continuing-through-complete-sequence-v0',
      renderer: RENDERER,
      model: MODEL,
      source: SOURCE,
      composition: COMPOSITION,
      phaseSource: PHASE_SOURCE,
      indirectDraw: INDIRECT_DRAW,
      capture: 'cdp-exact-frozen-live-composed-canvas-sample-v0',
      sequenceRetention: 'all-samples-retained-v0',
    },
    initialState: compactState(initialState),
    historyPrime,
    temporalSummary,
    temporalAdvancement,
    temporalSequence,
    finalState: compactState(finalState),
    claimBoundary: 'diagnostic candidate ranking only; operator or explicit sequence inspection owns visual disposition',
  });
  ws.close();
} catch (error) {
  try { ws?.close(); } catch {}
  writeReport({
    schema: SCHEMA,
    status: 'failed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectivePageUrl: browserPageUrl,
    requestedDurationMs: durationMs,
    requestedSampleMs: sampleMs,
    failurePhase,
    error: error?.stack || String(error),
    browser,
    lastTrustworthyEvidence,
    temporalSequence,
    claimBoundary: 'failed witness; partial sequence is not visual closure',
  });
  throw error;
}

async function seatBrowser() {
  let endpointOpen = false;
  try {
    await cdpFetch('/json/version');
    endpointOpen = true;
  } catch {}
  if (endpointOpen) {
    const identity = discoverBrowserProcessIdentity(port);
    if (resolve(identity.browserProfilePath) !== requestedBrowserProfilePath) {
      throw new Error(`browser-profile-disagreement:${JSON.stringify({
        requested: requestedBrowserProfilePath,
        effective: identity.browserProfilePath,
      })}`);
    }
    return { ...identity, mode: 'connected-existing', continuity: 'continuous-existing' };
  }
  mkdirSync(requestedBrowserProfilePath, { recursive: true });
  const process = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${requestedBrowserProfilePath}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--enable-unsafe-webgpu',
    `--window-size=${windowSize}`,
    requestedRoute,
  ], { detached: true, stdio: 'ignore' });
  process.unref();
  await waitForCdp();
  const identity = discoverBrowserProcessIdentity(port);
  if (resolve(identity.browserProfilePath) !== requestedBrowserProfilePath) {
    throw new Error(`launched-browser-profile-disagreement:${JSON.stringify(identity)}`);
  }
  return {
    ...identity,
    mode: 'launched-kept-open',
    continuity: 'reseated-after-original-process-disappeared',
  };
}

function discoverBrowserProcessIdentity(chromePort) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n');
  const marker = `--remote-debugging-port=${chromePort}`;
  const parent = rows
    .map(row => row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map(match => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }))
    .find(process => process.command.includes(marker)
      && process.command.includes('Google Chrome')
      && !process.command.includes('--type='));
  if (!parent) throw new Error(`browser-process-not-found-for-cdp-port:${chromePort}`);
  const profileMatch = parent.command.match(/--user-data-dir=(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const browserProfilePath = profileMatch?.[1] || profileMatch?.[2] || profileMatch?.[3] || null;
  if (!browserProfilePath) throw new Error(`browser-profile-not-found-for-process:${parent.pid}`);
  return {
    identity: 'boundary-splat-temporal-single-cdp-browser-v0',
    browserProcessId: parent.pid,
    browserParentProcessId: parent.ppid,
    browserProfilePath,
    chromePort,
    authority: 'effective-os-process-command-line',
  };
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { return await cdpFetch('/json/version'); } catch {}
    await delay(100);
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function findPage() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1'))
      || pages.find(target => target.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await delay(100);
  }
  throw new Error('browser has no targetable page');
}

async function targetIsReachable(pageId) {
  const pages = await cdpFetch('/json/list');
  return pages.some(target => target.id === pageId && target.type === 'page' && target.webSocketDebuggerUrl);
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  return new Promise((resolveRequest, rejectRequest) => {
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      cleanup();
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    const onClose = () => {
      cleanup();
      rejectRequest(new Error(`${method}: WebSocket closed before response ${id}`));
    };
    const cleanup = () => {
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose, { once: true });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await wsRequest('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`Runtime.evaluate failed: ${result.exceptionDetails.text || 'unknown exception'}`);
  return result.result.value;
}

async function waitForPrototype() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (state?.active && state?.backend && state?.boundarySplatCompositionIdentity) return state;
    await delay(125);
  }
  throw new Error('volume prototype did not become active');
}

async function waitForTelemetry() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (
      Number(state?.boundarySplatSourceCandidateCount) > 0
      && Number(state?.boundarySplatRequestedInstanceCount) === 100
      && Number(state?.boundarySplatPhaseSourceCount) === Number(state?.boundarySplatHistoryDepth)
      && state?.boundarySplatBufferIntegrity?.ok === true
    ) return state;
    await delay(125);
  }
  throw new Error('boundary-splat-temporal-telemetry-did-not-settle');
}

async function debugState() {
  return evaluate('window.__kaminosVolumePrototype?.debugState?.()');
}

async function hideHud() {
  await evaluate(`(() => {
    const fps = document.getElementById('fps-counter');
    if (fps) fps.style.visibility = 'hidden';
    return true;
  })()`);
}

function validateState(state, pageUrl) {
  const params = new URL(pageUrl).searchParams;
  const mismatches = [];
  if (state?.active !== true) mismatches.push(['active', true, state?.active]);
  if (state?.effectiveRoute !== EFFECTIVE_ROUTE) mismatches.push(['route', EFFECTIVE_ROUTE, state?.effectiveRoute]);
  if (state?.boundarySplatRendererIdentity !== RENDERER) mismatches.push(['renderer', RENDERER, state?.boundarySplatRendererIdentity]);
  if (state?.boundarySplatAttributeModelIdentity !== MODEL) mismatches.push(['model', MODEL, state?.boundarySplatAttributeModelIdentity]);
  if (state?.boundarySplatSourceAuthority !== SOURCE) mismatches.push(['source', SOURCE, state?.boundarySplatSourceAuthority]);
  if (state?.boundarySplatCompositionIdentity !== COMPOSITION) mismatches.push(['composition', COMPOSITION, state?.boundarySplatCompositionIdentity]);
  if (state?.boundarySplatPhaseSourceIdentity !== PHASE_SOURCE) mismatches.push(['phaseSource', PHASE_SOURCE, state?.boundarySplatPhaseSourceIdentity]);
  if (state?.boundarySplatIndirectDrawIdentity !== INDIRECT_DRAW) mismatches.push(['indirectDraw', INDIRECT_DRAW, state?.boundarySplatIndirectDrawIdentity]);
  if (Number(state?.boundarySplatRequestedInstanceCount) !== 100) mismatches.push(['instances', 100, state?.boundarySplatRequestedInstanceCount]);
  if (Number(state?.boundarySplatPhaseSourceCount) !== Number(state?.boundarySplatHistoryDepth)) mismatches.push(['phaseSourceCount', state?.boundarySplatHistoryDepth, state?.boundarySplatPhaseSourceCount]);
  if (!Array.isArray(state?.boundarySplatPhaseSources) || state.boundarySplatPhaseSources.length !== 100) mismatches.push(['phaseDescriptors', 100, state?.boundarySplatPhaseSources?.length]);
  if (Number(state?.boundarySplatPbrAddedSimulationPasses) !== 0) mismatches.push(['addedSimulationPasses', 0, state?.boundarySplatPbrAddedSimulationPasses]);
  if (Number(state?.boundarySplatOverflowCount) !== 0) mismatches.push(['overflow', 0, state?.boundarySplatOverflowCount]);
  if (Number(state?.boundarySplatCopyBytesThisFrame) !== 0) mismatches.push(['copy', 0, state?.boundarySplatCopyBytesThisFrame]);
  if (state?.boundarySplatFallbackReason != null) mismatches.push(['fallback', null, state?.boundarySplatFallbackReason]);
  if (
    state?.boundarySplatBufferIntegrity?.identity !== BUFFER_INTEGRITY
    || state?.boundarySplatBufferIntegrity?.ok !== true
    || state?.boundarySplatBufferIntegrityFailureReason != null
  ) mismatches.push(['bufferIntegrity', true, state?.boundarySplatBufferIntegrity]);
  if (params.get('volume_boundary_splat_instances') !== '100') mismatches.push(['routeInstances', '100', params.get('volume_boundary_splat_instances')]);
  if (params.get('volume_boundary_splat_phase_mode') !== 'age-sweep') mismatches.push(['routePhaseMode', 'age-sweep', params.get('volume_boundary_splat_phase_mode')]);
  if (params.get('volume_boundary_splat_composition') !== 'field') mismatches.push(['routeComposition', 'field', params.get('volume_boundary_splat_composition')]);
  if (mismatches.length) throw new Error(`stale-or-default-config:${JSON.stringify(mismatches)}`);
}

function compactState(state) {
  return {
    active: state?.active,
    backend: state?.backend,
    effectiveRoute: state?.effectiveRoute,
    frameCount: state?.frameCount,
    simStepCount: state?.simStepCount,
    rendererIdentity: state?.boundarySplatRendererIdentity,
    modelIdentity: state?.boundarySplatAttributeModelIdentity,
    sourceAuthority: state?.boundarySplatSourceAuthority,
    compositionIdentity: state?.boundarySplatCompositionIdentity,
    requestedInstanceCount: state?.boundarySplatRequestedInstanceCount,
    sourceCandidateCount: state?.boundarySplatSourceCandidateCount,
    renderedInstanceCount: state?.boundarySplatInstanceCount,
    indirectDrawIdentity: state?.boundarySplatIndirectDrawIdentity,
    indirectCommand: state?.boundarySplatIndirectCommand,
    indirectCommandAgreement: state?.boundarySplatIndirectCommandAgreement,
    indirectCommandAuthority: state?.boundarySplatIndirectCommandAuthority,
    phaseSourceIdentity: state?.boundarySplatPhaseSourceIdentity,
    phaseSourceCount: state?.boundarySplatPhaseSourceCount,
    historyWriteSlot: state?.boundarySplatHistoryWriteSlot,
    historyDepth: state?.boundarySplatHistoryDepth,
    historyFrameStride: state?.boundarySplatHistoryFrameStride,
    physicalHistoryWindowFrames: state?.boundarySplatPhysicalHistoryWindowFrames,
    bufferIntegrity: state?.boundarySplatBufferIntegrity,
    overflowCount: state?.boundarySplatOverflowCount,
    candidateCopyBytes: state?.boundarySplatCopyBytesThisFrame,
    fallbackReason: state?.boundarySplatFallbackReason,
  };
}

function compactPhaseSources(sources) {
  if (!Array.isArray(sources)) return null;
  return sources.map(source => ({
    index: source.index,
    phaseSourceIdentity: source.phaseSourceIdentity,
    historyOffsetSlots: source.historyOffsetSlots,
    physicalHistoryAgeFrames: source.physicalHistoryAgeFrames,
    historySlot: source.historySlot,
    authority: source.authority,
  }));
}

function clipFromCanvas(rect) {
  return {
    x: Math.max(0, Number(rect.x) || 0),
    y: Math.max(0, Number(rect.y) || 0),
    width: Math.max(2, Number(rect.width) || 0),
    height: Math.max(2, Number(rect.height) || 0),
    scale: 1,
  };
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed.set(item, '1');
    else {
      parsed.set(item, next);
      index += 1;
    }
  }
  return parsed;
}

function requirePositiveInteger(number, name) {
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
}

function requirePositiveNumber(number, name) {
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
}

function requireNonnegativeNumber(number, name) {
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be nonnegative`);
}

function defaultChromePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
  ];
  return candidates.find(candidate => candidate.includes('/') ? existsSync(candidate) : true) || candidates[0];
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
