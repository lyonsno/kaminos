#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync as zlibInflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.boundary-splat-scale-witness.v0';
const COUNTS = [1, 4, 16, 25, 64, 100];
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const RENDERER = 'live-boundary-sidecar-learned-attribute-splats-v0';
const MODEL = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const COMPOSITION = 'boundary-splat-composed-field-v0';
const CAMERA = 'boundary-splat-composed-field-camera-v0';
const BROWSER_CONTINUITY_MODES = new Set([
  'continuous-existing',
  'reseated-after-original-process-disappeared',
]);

const args = parseArgs(process.argv.slice(2));
const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-scale-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/scale-witness-report.json`));
const imagePath = resolve(String(args.get('--image') || `${outDir}/composed-100-live-flames.png`));
const port = Math.max(1, Math.floor(Number(args.get('--chrome-port') || 19431)));
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2500));
const warmupSamples = Math.max(0, Math.floor(Number(args.get('--warmup-samples') || 3)));
const steadySamples = Math.max(1, Math.floor(Number(args.get('--steady-samples') || 12)));
const browserContinuity = String(args.get('--browser-continuity') || 'unverified-existing');
const requestedBrowserProfilePath = String(args.get('--browser-profile') || '');
const runStartedAt = new Date().toISOString();

let ws = null;
let browserPageId = null;
let browserPageUrl = null;
let browserVersion = null;
let browserProcessIdentity = null;
let finalTargetReachable = false;
let failurePhase = 'startup';
const lastTrustworthyEvidence = {};

try {
  if (!requestedRoute) throw new Error('missing --url');
  if (!BROWSER_CONTINUITY_MODES.has(browserContinuity)) {
    throw new Error(`invalid --browser-continuity ${JSON.stringify(browserContinuity)}`);
  }
  browserProcessIdentity = discoverBrowserProcessIdentity(port);
  if (
    requestedBrowserProfilePath
    && resolve(requestedBrowserProfilePath) !== resolve(browserProcessIdentity.browserProfilePath)
  ) {
    throw new Error(`browser-profile-disagreement:${JSON.stringify({
      requested: requestedBrowserProfilePath,
      effective: browserProcessIdentity.browserProfilePath,
    })}`);
  }
  mkdirSync(outDir, { recursive: true });
  failurePhase = 'connect-existing-browser';
  const version = await cdpFetch('/json/version');
  browserVersion = version.Browser;
  lastTrustworthyEvidence.browserVersion = browserVersion;
  const page = await findPage();
  browserPageId = page.id;
  browserPageUrl = page.url;
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest('Page.enable');
  await wsRequest('Runtime.enable');

  failurePhase = 'route-load';
  await wsRequest('Page.navigate', { url: requestedRoute });
  await waitForPrototype();
  await delay(settleMs);
  await hideHud();

  failurePhase = 'stale-or-default-config';
  const initialState = await debugState();
  const cameraState = await evaluate('window.kaminosBoundarySplatCompositionDebugState?.()');
  const effectivePageUrl = await evaluate('location.href');
  browserPageUrl = effectivePageUrl;
  validateEffectiveState(initialState, cameraState, effectivePageUrl);
  lastTrustworthyEvidence.initialState = compactState(initialState);
  lastTrustworthyEvidence.cameraState = cameraState;

  failurePhase = 'live-history-prime';
  const historyPrime = await evaluate(`window.__kaminosVolumePrototype.primeBoundarySplatLiveHistory(${JSON.stringify({
    minimumHistoryFrames: Number(initialState.boundarySplatEffectiveHistoryWindowFrames) + 1,
  })})`, true);
  validateHistoryPrime(historyPrime, initialState);
  lastTrustworthyEvidence.historyPrime = historyPrime;

  failurePhase = 'gpu-cost-ladder';
  const ladder = await evaluate(`window.__kaminosVolumePrototype.sampleBoundarySplatInstanceCostLadder(${JSON.stringify({
    counts: COUNTS,
    warmupSamples,
    steadySamples,
  })})`, true);
  validateLadder(ladder);
  lastTrustworthyEvidence.ladder = ladder;

  failurePhase = 'native-100-flame-capture';
  const capture = await evaluate(`window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
    renderScale: 1,
    controlOverrides: {
      boundarySplatInstances: 100,
      boundarySplatComposition: 'field',
      boundarySplatMode: 'learned',
    },
    restoreControls: true,
    resumeRenderLoop: true,
  })})`, true);
  if (capture?.ok !== true || capture.sampleAuthority !== 'render-only-frozen-sim-state') {
    throw new Error(`blank-or-partial-native-capture: renderer capture failed ${JSON.stringify(capture)}`);
  }
  const shot = await wsRequest('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: clipFromCanvas(capture.canvasCssRect),
  });
  const imageBuffer = Buffer.from(shot.data, 'base64');
  const imageMetrics = measureScreenshot(imageBuffer);
  if (imageMetrics.width < 100 || imageMetrics.height < 100 || imageMetrics.litPixels <= 200 || imageMetrics.meanLuma <= 1) {
    throw new Error(`blank-or-partial-native-capture: ${JSON.stringify(imageMetrics)}`);
  }
  mkdirSync(dirname(imagePath), { recursive: true });
  writeFileSync(imagePath, imageBuffer);
  const finalState = await debugState();
  const finalPageUrl = await evaluate('location.href');
  browserPageUrl = finalPageUrl;
  validateEffectiveState(finalState, await evaluate('window.kaminosBoundarySplatCompositionDebugState?.()'), finalPageUrl);
  const composedCaptureEvidence = {
    path: imagePath,
    sha256: sha256(imageBuffer),
    metrics: imageMetrics,
    sampleAuthority: capture.sampleAuthority,
    imageAuthority: capture.imageAuthority,
    frameCount: capture.frameCount,
    simStepCount: capture.simStepCount,
    requestedInstanceCount: capture.boundarySplatRequestedInstanceCount,
    sourceCandidateCount: capture.boundarySplatSourceCandidateCount,
    phaseSourceCount: capture.boundarySplatPhaseSourceCount,
  };
  lastTrustworthyEvidence.composedCapture = composedCaptureEvidence;
  lastTrustworthyEvidence.finalState = compactState(finalState);
  lastTrustworthyEvidence.finalPageUrl = finalPageUrl;
  finalTargetReachable = await targetIsReachable(browserPageId);
  if (!finalTargetReachable) throw new Error('browser-target-unreachable-after-witness');

  const report = {
    schema: SCHEMA,
    status: 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectiveRoute: finalState.effectiveRoute,
    requestedEffectiveRouteAgreement: finalState.effectiveRoute === EFFECTIVE_ROUTE,
    browser: {
      identity: 'boundary-splat-scale-single-cdp-browser-v0',
      mode: 'connected-existing',
      port,
      version: browserVersion,
      pageId: page.id,
      pageUrl: effectivePageUrl,
      browserContinuity,
      browserProcessId: browserProcessIdentity.browserProcessId,
      browserProfilePath: browserProcessIdentity.browserProfilePath,
      browserProfileAuthority: browserProcessIdentity.authority,
      requestedBrowserProfilePath: requestedBrowserProfilePath || null,
      requestedEffectiveProfileAgreement: requestedBrowserProfilePath
        ? resolve(requestedBrowserProfilePath) === resolve(browserProcessIdentity.browserProfilePath)
        : null,
      sameBrowserAuthority: 'measurement-run-only',
      finalTargetReachable,
      disposition: finalTargetReachable ? 'preserved-open' : 'target-unreachable',
    },
    authority: {
      simulator: 'one-live-simulator-frozen-during-serial-instance-ladder-v0',
      candidateSource: SOURCE_AUTHORITY,
      phaseSource: finalState.boundarySplatPhaseSourceIdentity,
      history: 'bounded-live-gpu-candidate-history-ring',
      renderer: RENDERER,
      model: MODEL,
      composition: COMPOSITION,
      camera: CAMERA,
      capture: capture.imageAuthority,
    },
    historyPrime,
    ladder,
    composedCapture: {
      ...composedCaptureEvidence,
      clip: clipFromCanvas(capture.canvasCssRect),
      rendererIdentity: capture.boundarySplatRendererIdentity,
      modelIdentity: capture.boundarySplatAttributeModelIdentity,
      compositionIdentity: capture.boundarySplatCompositionIdentity || finalState.boundarySplatCompositionIdentity,
      phaseModeIdentity: capture.boundarySplatPhaseModeIdentity,
      phaseSourceCount: capture.boundarySplatPhaseSourceCount,
      overflowCount: finalState.boundarySplatOverflowCount,
      candidateCopyBytes: finalState.boundarySplatCopyBytesThisFrame,
      fallbackReason: finalState.boundarySplatFallbackReason,
    },
    finalState: compactState(finalState),
    falseClosureChecks: {
      fallbackRoute: false,
      staleOrDefaultConfig: false,
      missingTimestampSupport: false,
      simulatorAdvancedDuringLadder: false,
      hiddenInstanceCap: false,
      overflow: false,
      candidateCopy: false,
      blankOrPartialNativeCapture: false,
      browserClosedDuringWitness: !finalTargetReachable,
    },
    claimBoundary: 'GPU-exclusive serial scaling and one native composed frame from one live simulator. This does not claim independent per-instance simulation, learned prediction, PBR integration, or 1000-instance feasibility.',
  };
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  finalTargetReachable = await targetIsReachable(browserPageId).catch(() => false);
  const failure = {
    schema: SCHEMA,
    status: 'failed-before-primary-output',
    failurePhase,
    runStartedAt,
    failedAt: new Date().toISOString(),
    requestedRoute,
    browser: {
      identity: 'boundary-splat-scale-single-cdp-browser-v0',
      mode: 'connected-existing',
      port,
      version: browserVersion,
      pageId: browserPageId,
      pageUrl: browserPageUrl,
      browserContinuity,
      browserProcessId: browserProcessIdentity?.browserProcessId ?? null,
      browserProfilePath: browserProcessIdentity?.browserProfilePath ?? null,
      browserProfileAuthority: browserProcessIdentity?.authority ?? null,
      requestedBrowserProfilePath: requestedBrowserProfilePath || null,
      sameBrowserAuthority: 'measurement-run-only',
      finalTargetReachable,
      disposition: finalTargetReachable ? 'preserved-open' : 'target-unreachable-or-unobserved',
    },
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
    falseClosureClass: failurePhase === 'stale-or-default-config'
      ? 'stale-or-default-config'
      : failurePhase === 'native-100-flame-capture'
        ? 'blank-or-partial-native-capture'
        : failurePhase,
  };
  writeReport(failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close?.(); } catch {}
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed.set(key, '1');
    else {
      parsed.set(key, next);
      index += 1;
    }
  }
  return parsed;
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
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
  if (!pageId) return false;
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
    const state = await evaluate('window.__kaminosVolumePrototype?.debugState?.()');
    if (state?.active && state?.backend && typeof state.boundarySplatCompositionIdentity === 'string') return state;
    await delay(125);
  }
  throw new Error('volume prototype did not become active with composed-field runtime');
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

function validateEffectiveState(state, cameraState, pageUrl) {
  const params = new URL(pageUrl).searchParams;
  const mismatches = [];
  if (state?.active !== true) mismatches.push(['active', true, state?.active]);
  if (state?.effectiveRoute !== EFFECTIVE_ROUTE) mismatches.push(['effectiveRoute', EFFECTIVE_ROUTE, state?.effectiveRoute]);
  if (state?.boundarySplatRendererIdentity !== RENDERER) mismatches.push(['renderer', RENDERER, state?.boundarySplatRendererIdentity]);
  if (state?.boundarySplatAttributeModelIdentity !== MODEL) mismatches.push(['model', MODEL, state?.boundarySplatAttributeModelIdentity]);
  if (state?.boundarySplatCompositionIdentity !== COMPOSITION) mismatches.push(['composition', COMPOSITION, state?.boundarySplatCompositionIdentity]);
  if (Number(state?.boundarySplatRequestedInstanceCount) !== 100) mismatches.push(['instances', 100, state?.boundarySplatRequestedInstanceCount]);
  if (state?.boundarySplatFallbackReason != null) mismatches.push(['fallback', null, state?.boundarySplatFallbackReason]);
  if (Number(state?.boundarySplatOverflowCount || 0) !== 0) mismatches.push(['overflow', 0, state?.boundarySplatOverflowCount]);
  if (Number(state?.boundarySplatCopyBytesThisFrame) !== 0) mismatches.push(['copyBytes', 0, state?.boundarySplatCopyBytesThisFrame]);
  if (cameraState?.identity !== CAMERA) mismatches.push(['camera', CAMERA, cameraState?.identity]);
  if (params.get('volume_boundary_splat_composition') !== 'field') mismatches.push(['routeComposition', 'field', params.get('volume_boundary_splat_composition')]);
  if (params.get('volume_boundary_splat_instances') !== '100') mismatches.push(['routeInstances', '100', params.get('volume_boundary_splat_instances')]);
  if (mismatches.length) throw new Error(`stale-or-default-config: ${JSON.stringify(mismatches)}`);
}

function validateLadder(ladder) {
  assert.equal(ladder?.identity, 'boundary-splat-instance-cost-ladder-v0', 'wrong ladder identity');
  assert.deepEqual(ladder?.counts, COUNTS, 'wrong cost ladder counts');
  assert.equal(ladder?.advanceSimulation, false, 'cost ladder advanced the simulator');
  assert.equal(ladder?.simulatorPreserved, true, 'cost ladder changed simulator state');
  assert.equal(ladder?.simStepCountBefore, ladder?.simStepCountAfter, 'sim step count changed during ladder');
  assert.equal(ladder?.rows?.length, COUNTS.length, 'partial cost ladder');
  for (const [index, row] of ladder.rows.entries()) {
    assert.equal(row.requestedInstanceCount, COUNTS[index], 'cost ladder order changed');
    assert.equal(row.effectiveInstanceCount, COUNTS[index], 'hidden instance cap or stale count');
    assert.equal(row.timestampStatus, 'available', 'missing GPU timestamp support');
    assert.ok(row.sourceCandidateCount > 0, 'missing source candidate count');
    assert.equal(row.renderedInstanceCount, row.sourceCandidateCount * COUNTS[index], 'rendered instance accounting mismatch');
    assert.equal(row.overflowCount, 0, 'candidate overflow in cost ladder');
    assert.equal(row.candidateCopyBytes, 0, 'candidate copy returned in cost ladder');
    assert.equal(row.fallbackReason, null, 'fallback route in cost ladder');
    assert.equal(row.rendererIdentity, RENDERER, 'renderer identity changed in cost ladder');
    assert.equal(row.modelIdentity, MODEL, 'model identity changed in cost ladder');
    assert.equal(row.compositionIdentity, COMPOSITION, 'composition identity changed in cost ladder');
    assert.ok(Number.isFinite(row.splatRaster?.medianMs), 'missing splat raster median');
  }
  assert.equal(ladder.ok, true, 'runtime rejected cost ladder evidence');
}

function validateHistoryPrime(historyPrime, initialState) {
  assert.equal(historyPrime?.identity, 'boundary-splat-live-history-prime-v0', 'wrong history prime identity');
  assert.equal(historyPrime?.ok, true, 'live history prime rejected its result');
  assert.equal(historyPrime?.simulatorCount, 1, 'history prime duplicated the simulator');
  assert.equal(historyPrime?.authority, 'bounded-continuation-from-one-live-simulator-v0', 'wrong history prime authority');
  assert.equal(
    historyPrime?.minimumHistoryFrames,
    Number(initialState?.boundarySplatEffectiveHistoryWindowFrames) + 1,
    'history prime did not cover the configured ring window',
  );
  assert.equal(historyPrime?.framesAdvanced, historyPrime?.simStepsAdvanced, 'history prime frame/sim accounting diverged');
  assert.ok(historyPrime?.sourceCandidateCount > 0, 'history prime produced no live candidates');
  assert.equal(historyPrime?.requestedInstanceCount, 100, 'history prime did not restore the requested instance count');
  assert.equal(historyPrime?.phaseSourceCount, Number(initialState?.boundarySplatHistoryDepth), 'history prime did not expose every configured history slot');
  assert.equal(historyPrime?.fallbackReason, null, 'history prime entered fallback');
  assert.equal(historyPrime?.candidateCopyBytes, 0, 'history prime copied candidate buffers');
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

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8, 'only 8-bit PNG screenshots are supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = zlibInflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let pointer = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pointer++];
    const row = Buffer.from(raw.subarray(pointer, pointer + stride));
    pointer += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= channels ? previous[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    }
    rows.push(row);
    previous = row;
  }
  return { width, height, channels, rows };
}

function measureScreenshot(buffer) {
  const png = parsePngRgba(buffer);
  let litPixels = 0;
  let totalLuma = 0;
  let samples = 0;
  for (let y = Math.floor(png.height * 0.03); y < Math.floor(png.height * 0.97); y += 2) {
    const row = png.rows[y];
    for (let x = Math.floor(png.width * 0.03); x < Math.floor(png.width * 0.97); x += 2) {
      const index = x * png.channels;
      const luma = 0.2126 * row[index] + 0.7152 * row[index + 1] + 0.0722 * row[index + 2];
      totalLuma += luma;
      samples += 1;
      if (luma > 18) litPixels += 1;
    }
  }
  return { width: png.width, height: png.height, samples, litPixels, meanLuma: samples ? totalLuma / samples : 0 };
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
    layoutBounds: state?.boundarySplatLayoutBounds,
    requestedInstanceCount: state?.boundarySplatRequestedInstanceCount,
    sourceCandidateCount: state?.boundarySplatSourceCandidateCount,
    renderedInstanceCount: state?.boundarySplatInstanceCount,
    phaseModeIdentity: state?.boundarySplatPhaseModeIdentity,
    phaseSourceCount: state?.boundarySplatPhaseSourceCount,
    historyDepth: state?.boundarySplatHistoryDepth,
    historyFrameStride: state?.boundarySplatHistoryFrameStride,
    effectiveHistoryWindowFrames: state?.boundarySplatEffectiveHistoryWindowFrames,
    overflowCount: state?.boundarySplatOverflowCount,
    candidateCopyBytes: state?.boundarySplatCopyBytesThisFrame,
    fallbackReason: state?.boundarySplatFallbackReason,
  };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
