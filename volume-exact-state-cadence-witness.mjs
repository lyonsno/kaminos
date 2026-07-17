#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { measureBoundarySplatTemporalFrame } from './boundary-splat-temporal-collapse.mjs';

const SCHEMA = 'kaminos.volume.exact-state-cadence-witness.v0';
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXACT_STATE_CADENCE_GPU_IDENTITY = 'kaminos.volume.exact-state-cadence-gpu.v0';
const ONE_SIMULATOR_AUTHORITY = 'single-authoritative-simulator-completed-state-history-v0';
const PHASE_SOURCE = 'completed-exact-state-continuation-history';

const args = parseArgs(process.argv.slice(2));
const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-exact-state-cadence-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/exact-state-cadence-report.json`));
const port = Number(args.get('--chrome-port') || 19431);
const requestedBrowserProfilePath = resolve(String(args.get('--browser-profile') || `${outDir}/chrome-profile`));
const settleMs = Number(args.get('--settle-ms') ?? 3000);
const sampleCount = Number(args.get('--samples') ?? 24);
const sampleIntervalMs = Number(args.get('--sample-interval-ms') ?? 50);
const runStartedAt = new Date().toISOString();

let ws = null;
let browser = null;
let browserPageId = null;
let browserPageUrl = null;
let failurePhase = 'startup';
const lastTrustworthyEvidence = {};

mkdirSync(outDir, { recursive: true });
writeReport({
  schema: SCHEMA,
  status: 'running',
  failurePhase,
  runStartedAt,
  requestedRoute,
});

try {
  validateInputs();

  failurePhase = 'browser-seat';
  browser = await existingPersistentBrowserSeat();
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
  const visibilityState = await evaluate('document.visibilityState');
  if (visibilityState !== 'visible') throw new Error(`cadence-page-not-visible:${visibilityState}`);

  failurePhase = 'route-authority';
  const effectivePageUrl = await evaluate('location.href');
  if (!requestedRouteAgrees(requestedRoute, effectivePageUrl)) {
    throw new Error(`requested-effective-route-mismatch:${JSON.stringify({ requestedRoute, effectivePageUrl })}`);
  }
  browserPageUrl = effectivePageUrl;
  const initialState = await waitForActiveCadence();
  validateEffectiveState(initialState, effectivePageUrl);
  lastTrustworthyEvidence.initialState = compactState(initialState);
  lastTrustworthyEvidence.effectivePageUrl = effectivePageUrl;

  failurePhase = 'initial-canvas';
  const initialCanvas = await captureCanvas('initial');
  lastTrustworthyEvidence.initialCanvas = initialCanvas.receipt;

  failurePhase = 'cadence-sampling';
  const rows = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const state = await debugState();
    validateEffectiveState(state, effectivePageUrl);
    const row = compactState(state);
    validateCadenceRow(row, index);
    rows.push({ index, sampledAt: new Date().toISOString(), ...row });
    lastTrustworthyEvidence.sampleCount = rows.length;
    lastTrustworthyEvidence.lastSample = rows.at(-1);
    await delay(sampleIntervalMs);
  }

  failurePhase = 'sequence-validation';
  const sequence = validateSequence(rows);
  lastTrustworthyEvidence.sequence = sequence;

  failurePhase = 'final-canvas';
  const finalCanvas = await captureCanvas('final');
  const finalState = await debugState();
  validateEffectiveState(finalState, effectivePageUrl);
  const sameBrowserTargetPreserved = await targetIsReachable(browserPageId);
  if (!sameBrowserTargetPreserved) throw new Error('browser-target-unreachable-after-cadence-witness');

  failurePhase = 'complete';
  writeReport({
    schema: SCHEMA,
    status: 'passed',
    claimBoundary: 'one-live-simulator-bounded-completed-state-history-adjacent-interpolation-no-learned-prediction',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectivePageUrl,
    requestedEffectiveRouteAgreement: true,
    browser,
    browserPageId,
    browserPageUrl: effectivePageUrl,
    sameBrowserTargetPreserved,
    route: compactState(finalState),
    requestedConfig: requestedConfigFromUrl(effectivePageUrl),
    sequence,
    rows,
    canvasPixelEvidence: {
      initial: initialCanvas.receipt,
      final: finalCanvas.receipt,
      distinctImageHashes: new Set([initialCanvas.receipt.sha256, finalCanvas.receipt.sha256]).size,
    },
    lastTrustworthyEvidence,
  });
  console.log(`exact-state cadence witness passed: ${reportPath}`);
} catch (error) {
  const failure = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    failureClass: classifyFailure(error, failurePhase),
    error: error?.stack || error?.message || String(error),
    runStartedAt,
    failedAt: new Date().toISOString(),
    requestedRoute,
    browser,
    browserPageId,
    browserPageUrl,
    lastTrustworthyEvidence,
  };
  writeReport(failure);
  console.error(failure.error);
  process.exitCode = 1;
} finally {
  ws?.close();
}

function validateInputs() {
  if (!requestedRoute) throw new Error('missing --url');
  const params = new URL(requestedRoute).searchParams;
  if (!['1', 'true', 'yes', 'on'].includes(String(params.get('volume_exact_state_cadence')).toLowerCase())) {
    throw new Error('cadence-request-missing-from-route');
  }
  requirePositiveInteger(port, '--chrome-port');
  requireNonnegativeNumber(settleMs, '--settle-ms');
  requirePositiveInteger(sampleCount, '--samples');
  requirePositiveNumber(sampleIntervalMs, '--sample-interval-ms');
}

function requestedConfigFromUrl(url) {
  const params = new URL(url).searchParams;
  return {
    requested: true,
    depth: Number(params.get('volume_cadence_depth')),
    delaySteps: Number(params.get('volume_cadence_delay_steps')),
    producerIntervalMs: Number(params.get('volume_cadence_producer_ms')),
    presentationStepMs: Number(params.get('volume_cadence_presentation_ms')),
  };
}

function validateEffectiveState(state, pageUrl) {
  const expected = requestedConfigFromUrl(pageUrl);
  const cadence = state?.exactStateCadence;
  const mismatches = [];
  if (state?.active !== true) mismatches.push(['active', true, state?.active]);
  if (state?.effectiveRoute !== EFFECTIVE_ROUTE) mismatches.push(['effectiveRoute', EFFECTIVE_ROUTE, state?.effectiveRoute]);
  if (state?.exactStateCadenceRequested !== true) mismatches.push(['exactStateCadenceRequested', true, state?.exactStateCadenceRequested]);
  if (state?.exactStateCadenceEffective !== 'active') mismatches.push(['exactStateCadenceEffective', 'active', state?.exactStateCadenceEffective]);
  if (state?.exactStateCadenceFallbackReason != null) mismatches.push(['exactStateCadenceFallbackReason', null, state?.exactStateCadenceFallbackReason]);
  if (state?.exactStateCadenceIdentity !== EXACT_STATE_CADENCE_GPU_IDENTITY) mismatches.push(['cadenceIdentity', EXACT_STATE_CADENCE_GPU_IDENTITY, state?.exactStateCadenceIdentity]);
  if (Number(state?.exactStateCadenceAddedSimulationPasses) !== 0) mismatches.push(['exactStateCadenceAddedSimulationPasses', 0, state?.exactStateCadenceAddedSimulationPasses]);
  if (cadence?.authority !== ONE_SIMULATOR_AUTHORITY) mismatches.push(['authority', ONE_SIMULATOR_AUTHORITY, cadence?.authority]);
  if (cadence?.phaseSource !== PHASE_SOURCE) mismatches.push(['phaseSource', PHASE_SOURCE, cadence?.phaseSource]);
  if (cadence?.allocation?.requestedDepth !== expected.depth) mismatches.push(['depth', expected.depth, cadence?.allocation?.requestedDepth]);
  if (cadence?.allocation?.allocatedDepth !== expected.depth) mismatches.push(['allocatedDepth', expected.depth, cadence?.allocation?.allocatedDepth]);
  if (cadence?.allocation?.presentationDelaySteps !== expected.delaySteps) mismatches.push(['delaySteps', expected.delaySteps, cadence?.allocation?.presentationDelaySteps]);
  if (Number(state?.exactStateCadenceProducerIntervalMs) !== expected.producerIntervalMs) mismatches.push(['producerMs', expected.producerIntervalMs, state?.exactStateCadenceProducerIntervalMs]);
  if (Number(state?.exactStateCadencePresentationStepMs) !== expected.presentationStepMs) mismatches.push(['presentationMs', expected.presentationStepMs, state?.exactStateCadencePresentationStepMs]);
  if (Number(state?.boundarySplatOverflowCount || 0) !== 0) mismatches.push(['splatOverflow', 0, state?.boundarySplatOverflowCount]);
  if (Number(state?.boundarySplatCopyBytesThisFrame || 0) !== 0) mismatches.push(['candidateCopyBytes', 0, state?.boundarySplatCopyBytesThisFrame]);
  if (state?.boundarySplatFallbackReason != null) mismatches.push(['splatFallback', null, state?.boundarySplatFallbackReason]);
  if (mismatches.length) throw new Error(`stale-default-or-fallback-cadence-config:${JSON.stringify(mismatches)}`);
}

function compactState(state) {
  const producerReceipt = state?.exactStateCadenceProducerReceipt || null;
  const presentationReceipt = state?.exactStateCadencePresentationReceipt || null;
  return {
    effectiveRoute: state?.effectiveRoute,
    backend: state?.backend,
    exactStateCadenceRequested: state?.exactStateCadenceRequested,
    exactStateCadenceEffective: state?.exactStateCadenceEffective,
    exactStateCadenceFallbackReason: state?.exactStateCadenceFallbackReason,
    exactStateCadenceAddedSimulationPasses: state?.exactStateCadenceAddedSimulationPasses,
    frameCount: Number(state?.frameCount),
    simStepCount: Number(state?.simStepCount),
    lastFrameEnergy: Number(state?.lastFrameEnergy),
    volumeReconstructionStyle: state?.volumeReconstructionStyle || null,
    boundarySplatMode: state?.boundarySplatMode || null,
    boundarySplatRendererIdentity: state?.boundarySplatRendererIdentity || null,
    boundarySplatComposition: state?.boundarySplatComposition || null,
    boundarySplatCandidateCount: Number(state?.boundarySplatCandidateCount || 0),
    boundarySplatSourceCandidateCount: Number(state?.boundarySplatSourceCandidateCount || 0),
    boundarySplatSelectedCandidateCount: Number(state?.boundarySplatSelectedCandidateCount || 0),
    boundarySplatInstanceCount: Number(state?.boundarySplatInstanceCount || 0),
    timing: state?.timing ? { ...state.timing } : null,
    simCostLedger: state?.simCostLedger ? { ...state.simCostLedger } : null,
    controlGeneration: Number(state?.exactStateCadenceControlGeneration),
    producerReceipt,
    presentationReceipt,
    residentCount: Number(state?.exactStateCadence?.residentCount),
    oldestSourceStep: Number(state?.exactStateCadence?.oldestSourceStep),
    newestSourceStep: Number(state?.exactStateCadence?.newestSourceStep),
    refusedCompletionCount: Number(state?.exactStateCadence?.refusedCompletionCount),
    refusedPresentationCount: Number(state?.exactStateCadence?.refusedPresentationCount),
    lastRefusal: state?.exactStateCadence?.lastRefusal || null,
    authority: state?.exactStateCadence?.authority,
    phaseSource: state?.exactStateCadence?.phaseSource,
    allocation: state?.exactStateCadence?.allocation || null,
    overflowCount: Number(state?.boundarySplatOverflowCount || 0),
    candidateCopyBytes: Number(state?.boundarySplatCopyBytesThisFrame || 0),
    splatFallbackReason: state?.boundarySplatFallbackReason || null,
  };
}

function validateCadenceRow(row, index) {
  const producerReceipt = row.producerReceipt;
  const presentationReceipt = row.presentationReceipt;
  const fromSourceStep = Number(presentationReceipt?.fromSourceStep);
  const toSourceStep = Number(presentationReceipt?.toSourceStep);
  if (producerReceipt?.status !== 'completed') {
    throw new Error(`producer-receipt-not-completed:${index}:${JSON.stringify(producerReceipt)}`);
  }
  if (presentationReceipt?.status !== 'encoded-not-submitted') {
    throw new Error(`presentation-receipt-not-encoded:${index}:${JSON.stringify(presentationReceipt)}`);
  }
  if (toSourceStep - fromSourceStep !== 1) {
    throw new Error(`nonadjacent-presentation-bracket:${index}:${JSON.stringify(presentationReceipt)}`);
  }
  if (Number(presentationReceipt.controlGeneration) !== row.controlGeneration) {
    throw new Error(`cross-generation-presentation:${index}:${JSON.stringify(row)}`);
  }
  if (row.exactStateCadenceEffective !== 'active' || row.exactStateCadenceFallbackReason != null) {
    throw new Error(`cadence-row-not-effective:${index}:${JSON.stringify(row)}`);
  }
  if (row.authority !== ONE_SIMULATOR_AUTHORITY || row.phaseSource !== PHASE_SOURCE) {
    throw new Error(`cadence-row-authority-mismatch:${index}:${JSON.stringify(row)}`);
  }
  if (row.exactStateCadenceAddedSimulationPasses !== 0 || row.overflowCount !== 0 || row.candidateCopyBytes !== 0 || row.splatFallbackReason != null) {
    throw new Error(`cadence-row-hidden-work-or-fallback:${index}:${JSON.stringify(row)}`);
  }
}

function validateSequence(rows) {
  if (rows.length !== sampleCount) throw new Error(`cadence-sample-count-mismatch:${rows.length}`);
  const first = rows[0];
  const last = rows.at(-1);
  const frameDelta = last.frameCount - first.frameCount;
  const simStepDelta = last.simStepCount - first.simStepCount;
  const producerSourceDelta = Number(last.producerReceipt.sourceStep) - Number(first.producerReceipt.sourceStep);
  const presentationPositionDelta = Number(last.presentationReceipt.sourcePosition) - Number(first.presentationReceipt.sourcePosition);
  const distinctAlpha = new Set(rows.map(row => Number(row.presentationReceipt.alpha).toFixed(3))).size;
  const distinctBrackets = new Set(rows.map(row => `${row.presentationReceipt.fromSourceStep}:${row.presentationReceipt.toSourceStep}`)).size;
  const unequalAdjacentCadenceDeltas = rows.slice(1).filter((row, index) => {
    const previous = rows[index];
    return row.frameCount - previous.frameCount !== row.simStepCount - previous.simStepCount;
  }).length;
  if (frameDelta <= 0 || simStepDelta <= 0 || producerSourceDelta <= 0 || presentationPositionDelta <= 0) {
    throw new Error(`cadence-sequence-did-not-progress:${JSON.stringify({ frameDelta, simStepDelta, producerSourceDelta, presentationPositionDelta })}`);
  }
  if (distinctAlpha < 3 || distinctBrackets < 2) {
    throw new Error(`cadence-interpolation-not-observed:${JSON.stringify({ distinctAlpha, distinctBrackets })}`);
  }
  if (unequalAdjacentCadenceDeltas < 1 || frameDelta === simStepDelta) {
    throw new Error(`producer-remains-raf-locked:${JSON.stringify({ frameDelta, simStepDelta, unequalAdjacentCadenceDeltas })}`);
  }
  const sourcePositions = rows.map(row => Number(row.presentationReceipt.sourcePosition));
  for (let index = 1; index < sourcePositions.length; index += 1) {
    if (!(sourcePositions[index] >= sourcePositions[index - 1])) {
      throw new Error(`presentation-source-regressed:${index}:${sourcePositions[index - 1]}->${sourcePositions[index]}`);
    }
  }
  return {
    sampleCount: rows.length,
    durationMs: (rows.length - 1) * sampleIntervalMs,
    frameDelta,
    simStepDelta,
    producerSourceDelta,
    presentationPositionDelta,
    distinctAlpha,
    distinctBrackets,
    unequalAdjacentCadenceDeltas,
    producerRafLocked: false,
    adjacentCompletedStateInterpolation: true,
    oneSimulatorAuthority: true,
  };
}

async function captureCanvas(label) {
  const canvasRect = await evaluate(`(() => {
    const canvas = document.getElementById('kaminos-volume-canvas');
    if (!canvas?.classList.contains('active')) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  if (!canvasRect || canvasRect.width < 100 || canvasRect.height < 100) {
    throw new Error(`blank-or-partial-cadence-canvas:${JSON.stringify(canvasRect)}`);
  }
  const clip = {
    x: Math.max(0, Math.floor(canvasRect.x)),
    y: Math.max(0, Math.floor(canvasRect.y)),
    width: Math.max(1, Math.floor(canvasRect.width)),
    height: Math.max(1, Math.floor(canvasRect.height)),
    scale: 1,
  };
  const screenshot = await wsRequest('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  const bytes = Buffer.from(screenshot.data, 'base64');
  const metrics = measureBoundarySplatTemporalFrame(bytes);
  const path = resolve(outDir, `exact-state-cadence-${label}.png`);
  writeFileSync(path, bytes);
  const receipt = {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    clip,
    metrics,
    authority: 'cdp-live-exact-state-cadence-canvas-pixels-v0',
  };
  lastTrustworthyEvidence[`${label}CanvasAttempt`] = receipt;
  if (metrics.litPixels <= 200 || metrics.litWidthRatio <= 0 || metrics.litHeightRatio <= 0) {
    throw new Error(`blank-or-partial-cadence-canvas:${JSON.stringify(metrics)}`);
  }
  return {
    bytes,
    receipt,
  };
}

async function waitForPrototype() {
  let lastDiagnostic = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (state?.active === true && state?.backend) return state;
    if (state?.error) {
      lastDiagnostic = await collectPageDiagnostic(state);
      lastTrustworthyEvidence.inactiveRuntime = lastDiagnostic;
      throw new Error(`volume-runtime-initialization-error:${JSON.stringify(lastDiagnostic)}`);
    }
    if (attempt % 20 === 0) {
      lastDiagnostic = await collectPageDiagnostic(state);
      lastTrustworthyEvidence.inactiveRuntime = lastDiagnostic;
    }
    await delay(125);
  }
  lastDiagnostic = await collectPageDiagnostic(await debugState());
  lastTrustworthyEvidence.inactiveRuntime = lastDiagnostic;
  throw new Error(`volume-prototype-did-not-become-active:${JSON.stringify(lastDiagnostic)}`);
}

async function collectPageDiagnostic(state = null) {
  return evaluate(`(() => ({
    readyState: document.readyState,
    href: location.href,
    prototypePresent: Boolean(window.__kaminosVolumePrototype),
    bridgePresent: Boolean(window.__kaminosVolumeBridge),
    backendLabel: document.getElementById('volume-backend')?.textContent || null,
    infoText: document.getElementById('info')?.textContent || null,
    canvasPresent: Boolean(document.getElementById('kaminos-volume-canvas')),
    canvasActive: document.getElementById('kaminos-volume-canvas')?.classList.contains('active') || false,
  }))()`).then(page => ({
    page,
    state: state ? compactState(state) : null,
    stateError: state?.error || null,
    stateBackend: state?.backend || null,
  }));
}

async function waitForActiveCadence() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (
      state?.exactStateCadenceRequested === true
      && state?.exactStateCadenceEffective === 'active'
      && state?.exactStateCadenceFallbackReason == null
      && state?.exactStateCadenceProducerReceipt?.status === 'completed'
      && state?.exactStateCadencePresentationReceipt?.status === 'encoded-not-submitted'
    ) return state;
    if (state?.exactStateCadenceEffective === 'refused') {
      throw new Error(`cadence-runtime-refused:${state?.exactStateCadenceFallbackReason}`);
    }
    await delay(125);
  }
  throw new Error('exact-state-cadence-telemetry-did-not-settle');
}

async function existingPersistentBrowserSeat() {
  const processIdentity = discoverBrowserProcessIdentity(port);
  if (resolve(processIdentity.browserProfilePath) !== requestedBrowserProfilePath) {
    throw new Error(`browser-profile-mismatch:${JSON.stringify({
      requestedBrowserProfilePath,
      effectiveBrowserProfilePath: resolve(processIdentity.browserProfilePath),
    })}`);
  }
  const version = await cdpFetch('/json/version');
  return {
    ...processIdentity,
    requestedBrowserProfilePath,
    requestedProfileAgreement: true,
    browserVersion: version.Browser || null,
    protocolVersion: version['Protocol-Version'] || null,
    continuityBoundary: 'existing-persistent-browser-only-no-launch',
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
    browserProcessId: parent.pid,
    browserParentProcessId: parent.ppid,
    browserProfilePath,
    chromePort,
    authority: 'effective-os-process-command-line',
  };
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function findPage() {
  const pages = await cdpFetch('/json/list');
  const page = pages.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1'))
    || pages.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('existing Chrome has no targetable page');
  return page;
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

async function debugState() {
  return evaluate('window.__kaminosVolumePrototype?.debugState?.()');
}

async function hideHud() {
  return evaluate(`(() => {
    const fps = document.getElementById('fps-counter');
    if (fps) fps.style.visibility = 'hidden';
    return true;
  })()`);
}

function requestedRouteAgrees(requested, effective) {
  const requestedUrl = new URL(requested);
  const effectiveUrl = new URL(effective);
  if (requestedUrl.origin !== effectiveUrl.origin || requestedUrl.pathname !== effectiveUrl.pathname) return false;
  const requestedEntries = canonicalRouteEntries(requestedUrl);
  const effectiveEntries = canonicalRouteEntries(effectiveUrl);
  return requestedEntries.length === effectiveEntries.length
    && JSON.stringify(requestedEntries) === JSON.stringify(effectiveEntries);
}

function canonicalRouteEntries(url) {
  return [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => (
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
  ));
}

function classifyFailure(error, phase) {
  const message = error?.message || String(error);
  for (const name of [
    'browser-process-not-found',
    'browser-profile-mismatch',
    'requested-effective-route-mismatch',
    'stale-default-or-fallback-cadence-config',
    'cadence-runtime-refused',
    'volume-runtime-initialization-error',
    'producer-receipt-not-completed',
    'presentation-receipt-not-encoded',
    'nonadjacent-presentation-bracket',
    'cross-generation-presentation',
    'cadence-row-hidden-work-or-fallback',
    'cadence-interpolation-not-observed',
    'producer-remains-raf-locked',
    'presentation-source-regressed',
    'blank-or-partial-cadence-canvas',
    'browser-target-unreachable-after-cadence-witness',
  ]) {
    if (message.includes(name)) return name;
  }
  return phase;
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) parsed.set(argv[index], argv[index + 1]);
  return parsed;
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function requirePositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function requireNonnegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be nonnegative`);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
