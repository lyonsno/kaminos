#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync as zlibInflateSync } from 'node:zlib';

const args = parseArgs(process.argv.slice(2));
const SCHEMA = 'kaminos.volume.boundary-splat-pbr-witness.v0';
const COUNTS = [0, 1, 4, 16, 100];
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const RENDERER = 'live-boundary-sidecar-learned-attribute-splats-v0';
const MODEL = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const COMPOSITION = 'boundary-splat-composed-field-v0';
const CAMERA = 'boundary-splat-pbr-fire-field-camera-v0';
const PBR_SCENE = 'boundary-splat-pbr-fire-field-v0';
const DEPTH_AUTHORITY = 'same-device-depth24plus-less-equal-v0';
const FIXED_SUBSTRATE = 'operator-pretty-four-flame-substrate-v0';
const ADAPTIVE_LOD = 'boundary-splat-projected-area-nested-tiers-v0';
const ADAPTIVE_TIER_BUDGETS = new Set([0, 800, 1600, 3200, 6400, 12800]);
const CAMERA_SWEEP_POSES = [
  { identity: 'left-arc', position: [-5.15, 1.85, 7.65], target: [0.12, -0.48, 0.05] },
  { identity: 'right-grazing', position: [7.10, 0.95, 3.25], target: [0.15, -0.50, 0.02] },
];
const BROWSER_CONTINUITY_MODES = new Set([
  'continuous-existing',
  'reseated-after-original-process-disappeared',
]);

const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-pbr-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/pbr-witness-report.json`));
const imagePath = resolve(String(args.get('--image') || `${outDir}/pbr-100-live-flames.png`));
const port = Math.max(1, Math.floor(Number(args.get('--chrome-port') || 19431)));
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2500));
const warmupSamples = Math.max(0, Math.floor(Number(args.get('--warmup-samples') || 3)));
const steadySamples = Math.max(1, Math.floor(Number(args.get('--steady-samples') || 12)));
const cadenceMs = Math.max(1, Math.floor(Number(args.get('--cadence-ms') || 12000)));
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
  await wsRequest('Page.bringToFront');
  await waitForPrototype();
  await delay(settleMs);
  await hideHud();

  failurePhase = 'stale-or-default-config';
  const initialState = await waitForBoundarySplatTelemetry();
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
  const ladder = await evaluate(`window.__kaminosVolumePrototype.sampleBoundarySplatPbrCostLadder(${JSON.stringify({
    counts: COUNTS,
    warmupSamples,
    steadySamples,
  })})`, true);
  lastTrustworthyEvidence.ladder = ladder;
  validateLadder(ladder);

  failurePhase = 'live-cadence';
  await wsRequest('Page.bringToFront');
  const cadenceVisibilityState = await evaluate('document.visibilityState');
  if (cadenceVisibilityState !== 'visible') {
    throw new Error(`background-cadence-page:${JSON.stringify(cadenceVisibilityState)}`);
  }
  const liveCadence = await evaluate(`window.__kaminosVolumePrototype.sampleBoundarySplatLiveCadence(${JSON.stringify({
    durationMs: cadenceMs,
    sampleEveryFrames: 6,
  })})`, true);
  validateCadence(liveCadence, initialState, cadenceMs);
  lastTrustworthyEvidence.liveCadence = liveCadence;

  failurePhase = 'native-100-flame-capture';
  const capture = await evaluate(`window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
    renderScale: 1,
    controlOverrides: {
      boundarySplatInstances: 100,
      boundarySplatComposition: 'field',
      boundarySplatMode: 'learned',
      boundarySplatPbrScene: 'fire-field',
    },
    restoreControls: true,
    resumeRenderLoop: false,
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
  failurePhase = 'camera-parallax-sweep';
  const cameraSweep = [{
    identity: 'canonical',
    requestedPose: { position: cameraState.position, target: cameraState.target },
    effectivePose: cameraState,
    path: imagePath,
    sha256: sha256(imageBuffer),
    metrics: imageMetrics,
    simStepCount: capture.simStepCount,
    sampleAuthority: capture.sampleAuthority,
  }];
  try {
    for (const pose of CAMERA_SWEEP_POSES) {
      const effectivePose = await evaluate(`window.kaminosSetCameraDebugPose(${JSON.stringify(pose)})`);
      const poseCapture = await evaluate(`window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
        renderScale: 1,
        controlOverrides: {
          boundarySplatInstances: 100,
          boundarySplatComposition: 'field',
          boundarySplatMode: 'learned',
          boundarySplatPbrScene: 'fire-field',
        },
        restoreControls: true,
        resumeRenderLoop: false,
      })})`, true);
      if (poseCapture?.ok !== true || poseCapture.sampleAuthority !== 'render-only-frozen-sim-state') {
        throw new Error(`blank-or-partial-native-capture: camera ${pose.identity} ${JSON.stringify(poseCapture)}`);
      }
      if (Number(poseCapture.simStepCount) !== Number(capture.simStepCount)) {
        throw new Error(`camera-sweep-simulator-advanced: ${JSON.stringify({
          identity: pose.identity,
          expected: capture.simStepCount,
          actual: poseCapture.simStepCount,
        })}`);
      }
      const poseShot = await wsRequest('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        clip: clipFromCanvas(poseCapture.canvasCssRect),
      });
      const poseBuffer = Buffer.from(poseShot.data, 'base64');
      const poseMetrics = measureScreenshot(poseBuffer);
      if (poseMetrics.width < 100 || poseMetrics.height < 100 || poseMetrics.litPixels <= 200 || poseMetrics.meanLuma <= 1) {
        throw new Error(`blank-or-partial-native-capture: camera ${pose.identity} ${JSON.stringify(poseMetrics)}`);
      }
      const posePath = resolve(outDir, `pbr-camera-${pose.identity}.png`);
      writeFileSync(posePath, poseBuffer);
      cameraSweep.push({
        identity: pose.identity,
        requestedPose: pose,
        effectivePose,
        path: posePath,
        sha256: sha256(poseBuffer),
        metrics: poseMetrics,
        simStepCount: poseCapture.simStepCount,
        sampleAuthority: poseCapture.sampleAuthority,
      });
    }
  } finally {
    await evaluate(`window.kaminosSetCameraDebugPose(${JSON.stringify({
      position: cameraState.position,
      target: cameraState.target,
    })})`);
    await evaluate(`window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
      renderScale: 1,
      controlOverrides: {
        boundarySplatInstances: 100,
        boundarySplatComposition: 'field',
        boundarySplatMode: 'learned',
        boundarySplatPbrScene: 'fire-field',
      },
      restoreControls: true,
      resumeRenderLoop: true,
    })})`, true);
  }
  if (cameraSweep.length !== 3) {
    throw new Error(`blank-or-partial-native-capture: incomplete camera sweep ${cameraSweep.length}/3`);
  }
  lastTrustworthyEvidence.cameraSweep = cameraSweep;
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
    requestedCandidateBudget: capture.boundarySplatRequestedCandidateBudget,
    effectiveCandidateBudget: capture.boundarySplatEffectiveCandidateBudget,
    selectedCandidateCount: capture.boundarySplatSelectedCandidateCount,
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
      identity: 'boundary-splat-pbr-single-cdp-browser-v0',
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
      pbrScene: PBR_SCENE,
      depth: DEPTH_AUTHORITY,
      fixedSubstrate: FIXED_SUBSTRATE,
      capture: capture.imageAuthority,
      cameraSweep: 'same-frozen-simulator-state-real-camera-matrices-v0',
    },
    historyPrime,
    ladder,
    liveCadence,
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
    cameraSweep,
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
      depthOcclusionAuthorityMissing: false,
      staleOrDefaultPbrScene: false,
      duplicatedSimulationAuthority: false,
      cameraSweepSimulatorAdvanced: false,
      cameraSweepIncomplete: cameraSweep.length !== 3,
      browserClosedDuringWitness: !finalTargetReachable,
      incompleteCadenceDuration: false,
      staleOrDefaultCadenceBudget: false,
      cadenceSelectedCountMismatch: false,
      cadenceFallbackOrOverflow: false,
    },
    claimBoundary: 'Same-device PBR color/depth plus learned splats, a frozen 0/1/4/16/100 cost ladder, and a bounded live-cadence sequence from one live simulator. RAF gaps and queue completion are browser cadence proxies, not GPU-exclusive present latency. This does not claim independent per-instance simulation, learned prediction, per-flame proxy lighting, or final product beauty.',
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
      identity: 'boundary-splat-pbr-single-cdp-browser-v0',
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
    falseClosureClass: classifyFalseClosure(failurePhase, error),
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

function classifyFalseClosure(phase, error) {
  const message = error?.stack || error?.message || String(error);
  for (const className of [
    'fallback-route',
    'stale-or-default-config',
    'depth-occlusion-authority-missing',
    'stale-or-default-pbr-scene',
    'duplicated-simulation-authority',
    'camera-sweep-simulator-advanced',
    'blank-or-partial-native-capture',
    'incomplete-cadence-duration',
    'stale-or-default-cadence-budget',
    'stale-or-default-adaptive-lod',
    'adaptive-lod-allocation-mismatch',
    'cadence-selected-count-mismatch',
    'cadence-fallback-or-overflow',
    'background-cadence-page',
  ]) {
    if (message.includes(className)) return className;
  }
  return phase;
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

async function waitForBoundarySplatTelemetry() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (
      Number(state?.boundarySplatSourceCandidateCount) > 0
      && Number.isFinite(Number(state?.boundarySplatEffectiveCandidateBudget))
      && state?.boundarySplatEffectiveCandidateBudget != null
      && Number.isFinite(Number(state?.boundarySplatSelectedCandidateCount))
      && state?.boundarySplatSelectedCandidateCount != null
      && Number.isFinite(Number(state?.boundarySplatInstanceCount))
      && state?.boundarySplatInstanceCount != null
      && typeof state?.boundarySplatLodMode === 'string'
      && Array.isArray(state?.boundarySplatTierGroups)
      && Number.isFinite(Number(state?.boundarySplatGlobalRenderedInstanceCount))
      && Number(state?.boundarySplatTelemetryRequestedCandidateBudget) === Number(state?.boundarySplatRequestedCandidateBudget)
    ) return state;
    await delay(125);
  }
  throw new Error('boundary-splat-selector-telemetry-did-not-settle');
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
  const requestedCandidateBudget = Number(params.get('volume_boundary_splat_candidate_budget') || 0);
  const requestedLodMode = normalizeRequestedLodMode(params.get('volume_boundary_splat_lod_mode'));
  const mismatches = [];
  if (state?.boundarySplatFallbackReason != null) {
    throw new Error(`fallback-route: ${JSON.stringify(state.boundarySplatFallbackReason)}`);
  }
  if (state?.active !== true) mismatches.push(['active', true, state?.active]);
  if (state?.effectiveRoute !== EFFECTIVE_ROUTE) mismatches.push(['effectiveRoute', EFFECTIVE_ROUTE, state?.effectiveRoute]);
  if (state?.boundarySplatRendererIdentity !== RENDERER) mismatches.push(['renderer', RENDERER, state?.boundarySplatRendererIdentity]);
  if (state?.boundarySplatAttributeModelIdentity !== MODEL) mismatches.push(['model', MODEL, state?.boundarySplatAttributeModelIdentity]);
  if (state?.boundarySplatCompositionIdentity !== COMPOSITION) mismatches.push(['composition', COMPOSITION, state?.boundarySplatCompositionIdentity]);
  if (state?.boundarySplatPbrSceneIdentity !== PBR_SCENE) mismatches.push(['pbrScene', PBR_SCENE, state?.boundarySplatPbrSceneIdentity]);
  if (state?.boundarySplatPbrFixedSubstrateIdentity !== FIXED_SUBSTRATE) mismatches.push(['fixedSubstrate', FIXED_SUBSTRATE, state?.boundarySplatPbrFixedSubstrateIdentity]);
  if (Number(state?.boundarySplatRequestedInstanceCount) !== 100) mismatches.push(['instances', 100, state?.boundarySplatRequestedInstanceCount]);
  if (state?.boundarySplatFallbackReason != null) mismatches.push(['fallback', null, state?.boundarySplatFallbackReason]);
  if (Number(state?.boundarySplatOverflowCount || 0) !== 0) mismatches.push(['overflow', 0, state?.boundarySplatOverflowCount]);
  if (Number(state?.boundarySplatCopyBytesThisFrame) !== 0) mismatches.push(['copyBytes', 0, state?.boundarySplatCopyBytesThisFrame]);
  if (Number(state?.boundarySplatRequestedCandidateBudget) !== requestedCandidateBudget) mismatches.push(['requestedCandidateBudget', requestedCandidateBudget, state?.boundarySplatRequestedCandidateBudget]);
  if (cameraState?.identity !== CAMERA) mismatches.push(['camera', CAMERA, cameraState?.identity]);
  if (cameraState?.authority !== 'url-owned-effective-camera-pose') mismatches.push(['cameraAuthority', 'url-owned-effective-camera-pose', cameraState?.authority]);
  if (cameraState?.requestedEffectiveAgreement !== true) mismatches.push(['cameraAgreement', true, cameraState?.requestedEffectiveAgreement]);
  if (params.get('volume_boundary_splat_composition') !== 'field') mismatches.push(['routeComposition', 'field', params.get('volume_boundary_splat_composition')]);
  if (params.get('volume_boundary_splat_pbr_scene') !== 'fire-field') mismatches.push(['routePbrScene', 'fire-field', params.get('volume_boundary_splat_pbr_scene')]);
  if (params.get('volume_boundary_splat_instances') !== '100') mismatches.push(['routeInstances', '100', params.get('volume_boundary_splat_instances')]);
  if (mismatches.length) throw new Error(`stale-or-default-config: ${JSON.stringify(mismatches)}`);
  validateAllocationEvidence(state, requestedLodMode, 'initial-state');
  if (state?.boundarySplatPbrDepthAuthority !== DEPTH_AUTHORITY) {
    throw new Error(`depth-occlusion-authority-missing: ${JSON.stringify(state?.boundarySplatPbrDepthAuthority)}`);
  }
  if (state?.boundarySplatPbrScene !== 'fire-field') {
    throw new Error(`stale-or-default-pbr-scene: ${JSON.stringify(state?.boundarySplatPbrScene)}`);
  }
  if (Number(state?.boundarySplatPbrAddedSimulationPasses) !== 0) {
    throw new Error(`duplicated-simulation-authority: ${JSON.stringify(state?.boundarySplatPbrAddedSimulationPasses)}`);
  }
}

function validateCadence(cadence, initialState, requestedDurationMs) {
  if (
    cadence?.identity !== 'boundary-splat-live-cadence-v0'
    || cadence?.ok !== true
    || !Array.isArray(cadence?.frameGapsMs)
    || !Array.isArray(cadence?.samples)
    || cadence.frameGapsMs.length < 2
    || cadence.samples.length < 2
    || Number(cadence?.durationMs) < requestedDurationMs
  ) {
    throw new Error(`incomplete-cadence-duration:${JSON.stringify({
      requestedDurationMs,
      durationMs: cadence?.durationMs,
      frameGaps: cadence?.frameGapsMs?.length,
      samples: cadence?.samples?.length,
      ok: cadence?.ok,
    })}`);
  }
  const requestedCandidateBudget = Number(initialState?.boundarySplatRequestedCandidateBudget);
  const requestedLodMode = String(initialState?.boundarySplatLodMode || 'fixed');
  if (
    cadence?.effectiveRoute !== EFFECTIVE_ROUTE
    || cadence?.rendererIdentity !== RENDERER
    || cadence?.modelIdentity !== MODEL
    || cadence?.sourceAuthority !== SOURCE_AUTHORITY
    || cadence?.compositionIdentity !== COMPOSITION
    || Number(cadence?.requestedCandidateBudget) !== requestedCandidateBudget
    || cadence?.lodMode !== requestedLodMode
    || cadence.samples.some(sample => Number(sample?.requestedCandidateBudget) !== requestedCandidateBudget)
  ) {
    throw new Error(`stale-or-default-cadence-budget:${JSON.stringify({
      effectiveRoute: cadence?.effectiveRoute,
      rendererIdentity: cadence?.rendererIdentity,
      modelIdentity: cadence?.modelIdentity,
      sourceAuthority: cadence?.sourceAuthority,
      compositionIdentity: cadence?.compositionIdentity,
      requestedCandidateBudget,
      effectiveRequestedCandidateBudget: cadence?.requestedCandidateBudget,
    })}`);
  }
  for (const sample of cadence.samples) {
    try {
      validateAllocationEvidence(sample, requestedLodMode, 'cadence-sample');
    } catch (error) {
      throw new Error(`cadence-selected-count-mismatch:${error.message}:${JSON.stringify(sample)}`);
    }
  }
  if (cadence.samples.some(sample => sample?.fallbackReason != null || Number(sample?.overflowCount || 0) !== 0)) {
    throw new Error('cadence-fallback-or-overflow');
  }
}

function validateLadder(ladder) {
  assert.equal(ladder?.identity, 'boundary-splat-pbr-cost-ladder-v0', 'wrong ladder identity');
  assert.deepEqual(ladder?.counts, COUNTS, 'wrong cost ladder counts');
  assert.equal(ladder?.addedSimulationPasses, 0, 'cost ladder added simulation work');
  assert.equal(ladder?.simulatorPreserved, true, 'cost ladder changed simulator state');
  assert.equal(ladder?.simStepCountBefore, ladder?.simStepCountAfter, 'sim step count changed during ladder');
  assert.equal(ladder?.rows?.length, COUNTS.length, 'partial cost ladder');
  assert.ok([0, 12800, 6400, 3200, 1600, 800].includes(ladder?.requestedCandidateBudget), 'unsupported or missing ladder budget');
  assert.ok(['fixed', 'projected-area'].includes(ladder?.lodMode), 'missing cost ladder LOD mode');
  for (const [index, row] of ladder.rows.entries()) {
    assert.equal(row.requestedInstanceCount, COUNTS[index], 'cost ladder order changed');
    assert.equal(row.effectiveInstanceCount, COUNTS[index], 'hidden instance cap or stale count');
    assert.equal(row.timestampStatus, 'available', 'missing GPU timestamp support');
    assert.ok(Number.isFinite(row.pbrSceneRaster?.medianMs), 'missing PBR scene raster median');
    if (COUNTS[index] === 0) {
      assert.equal(row.renderedInstanceCount, 0, 'scene-only row rendered splats');
      continue;
    }
    assert.ok(row.sourceCandidateCount > 0, 'missing source candidate count');
    assert.equal(row.selectorPolicyIdentity, 'boundary-splat-nested-permutation-prefix-v0', 'selector identity changed');
    validateAllocationEvidence(row, ladder.lodMode, `cost-ladder-${COUNTS[index]}`);
    assert.equal(row.overflowCount, 0, 'candidate overflow in cost ladder');
    assert.equal(row.candidateCopyBytes, 0, 'candidate copy returned in cost ladder');
    assert.equal(row.fallbackReason, null, 'fallback route in cost ladder');
    assert.ok(Number.isFinite(row.splatRaster?.medianMs), 'missing splat raster median');
  }
  assert.equal(ladder?.rendererIdentity, RENDERER, 'renderer identity changed in cost ladder');
  assert.equal(ladder?.modelIdentity, MODEL, 'model identity changed in cost ladder');
  assert.equal(ladder?.pbrSceneIdentity, PBR_SCENE, 'PBR scene identity changed in cost ladder');
  assert.equal(ladder?.depthAuthority, DEPTH_AUTHORITY, 'depth authority changed in cost ladder');
  assert.equal(ladder?.fixedSubstrateIdentity, FIXED_SUBSTRATE, 'fixed substrate changed in cost ladder');
  assert.equal(ladder.ok, true, 'runtime rejected cost ladder evidence');
}

function normalizeRequestedLodMode(value) {
  return String(value || 'fixed').trim().toLowerCase().replaceAll('_', '-') === 'projected-area'
    ? 'projected-area'
    : 'fixed';
}

function validateAllocationEvidence(evidence, requestedLodMode, context) {
  const lodMode = evidence?.boundarySplatLodMode ?? evidence?.lodMode;
  const adaptiveLodIdentity = evidence?.boundarySplatAdaptiveLodIdentity ?? evidence?.adaptiveLodIdentity;
  const groups = evidence?.boundarySplatTierGroups ?? evidence?.tierGroups;
  const sourceCandidateCount = Number(evidence?.boundarySplatSourceCandidateCount ?? evidence?.sourceCandidateCount);
  const requestedInstanceCount = Number(evidence?.boundarySplatRequestedInstanceCount ?? evidence?.requestedInstanceCount);
  const effectiveCandidateBudget = Number(evidence?.boundarySplatEffectiveCandidateBudget ?? evidence?.effectiveCandidateBudget);
  const selectedCandidateCount = Number(evidence?.boundarySplatSelectedCandidateCount ?? evidence?.selectedCandidateCount);
  const renderedInstanceCount = Number(evidence?.boundarySplatInstanceCount ?? evidence?.renderedInstanceCount);
  const globalRenderedInstanceCount = Number(
    evidence?.boundarySplatGlobalRenderedInstanceCount ?? evidence?.globalRenderedInstanceCount,
  );
  if (lodMode !== requestedLodMode) {
    throw new Error(`stale-or-default-adaptive-lod:${context}:${JSON.stringify({ requestedLodMode, lodMode })}`);
  }
  if (!Number.isFinite(sourceCandidateCount) || sourceCandidateCount <= 0) {
    throw new Error(`adaptive-lod-allocation-mismatch:${context}:missing-source-count`);
  }
  if (requestedLodMode === 'fixed') {
    const requestedBudget = Number(evidence?.boundarySplatRequestedCandidateBudget ?? evidence?.requestedCandidateBudget);
    const expectedSelected = requestedBudget > 0 ? Math.min(sourceCandidateCount, requestedBudget) : sourceCandidateCount;
    if (
      effectiveCandidateBudget !== expectedSelected
      || selectedCandidateCount !== expectedSelected
      || renderedInstanceCount !== expectedSelected * requestedInstanceCount
      || globalRenderedInstanceCount !== renderedInstanceCount
    ) {
      throw new Error(`adaptive-lod-allocation-mismatch:${context}:${JSON.stringify({
        expectedSelected,
        effectiveCandidateBudget,
        selectedCandidateCount,
        renderedInstanceCount,
        globalRenderedInstanceCount,
        requestedInstanceCount,
      })}`);
    }
    return;
  }
  if (adaptiveLodIdentity !== ADAPTIVE_LOD || !Array.isArray(groups) || groups.length === 0) {
    throw new Error(`stale-or-default-adaptive-lod:${context}:${JSON.stringify({ adaptiveLodIdentity, groups })}`);
  }
  let descriptorCount = 0;
  let accountedRenderedInstanceCount = 0;
  let maxEffectiveCandidateBudget = 0;
  let expectedDescriptorStart = 0;
  for (const group of groups) {
    const requestedBudget = Number(group?.requestedBudget);
    const groupDescriptorCount = Number(group?.descriptorCount);
    const groupEffectiveBudget = Number(group?.effectiveCandidateBudget);
    const groupRenderedInstanceCount = Number(group?.renderedInstanceCount);
    const expectedEffectiveBudget = requestedBudget > 0
      ? Math.min(sourceCandidateCount, requestedBudget)
      : sourceCandidateCount;
    if (
      !ADAPTIVE_TIER_BUDGETS.has(requestedBudget)
      || groupDescriptorCount <= 0
      || Number(group?.descriptorStart) !== expectedDescriptorStart
      || groupEffectiveBudget !== expectedEffectiveBudget
      || groupRenderedInstanceCount !== groupEffectiveBudget * groupDescriptorCount
    ) {
      throw new Error(`adaptive-lod-allocation-mismatch:${context}:${JSON.stringify(group)}`);
    }
    descriptorCount += groupDescriptorCount;
    expectedDescriptorStart += groupDescriptorCount;
    accountedRenderedInstanceCount += groupRenderedInstanceCount;
    maxEffectiveCandidateBudget = Math.max(maxEffectiveCandidateBudget, groupEffectiveBudget);
  }
  if (
    descriptorCount !== requestedInstanceCount
    || accountedRenderedInstanceCount !== globalRenderedInstanceCount
    || renderedInstanceCount !== globalRenderedInstanceCount
    || effectiveCandidateBudget !== maxEffectiveCandidateBudget
    || selectedCandidateCount !== maxEffectiveCandidateBudget
  ) {
    throw new Error(`adaptive-lod-allocation-mismatch:${context}:${JSON.stringify({
      descriptorCount,
      requestedInstanceCount,
      accountedRenderedInstanceCount,
      globalRenderedInstanceCount,
      renderedInstanceCount,
      maxEffectiveCandidateBudget,
      effectiveCandidateBudget,
      selectedCandidateCount,
    })}`);
  }
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
    pbrScene: state?.boundarySplatPbrScene,
    pbrSceneIdentity: state?.boundarySplatPbrSceneIdentity,
    pbrDepthAuthority: state?.boundarySplatPbrDepthAuthority,
    pbrCameraAuthority: state?.boundarySplatPbrCameraAuthority,
    fixedSubstrateIdentity: state?.boundarySplatPbrFixedSubstrateIdentity,
    addedSimulationPasses: state?.boundarySplatPbrAddedSimulationPasses,
    layoutBounds: state?.boundarySplatLayoutBounds,
    requestedInstanceCount: state?.boundarySplatRequestedInstanceCount,
    selectorPolicyIdentity: state?.boundarySplatSelectorPolicyIdentity,
    requestedCandidateBudget: state?.boundarySplatRequestedCandidateBudget,
    telemetryRequestedCandidateBudget: state?.boundarySplatTelemetryRequestedCandidateBudget,
    selectorTelemetryFrameCount: state?.boundarySplatSelectorTelemetryFrameCount,
    effectiveCandidateBudget: state?.boundarySplatEffectiveCandidateBudget,
    selectedCandidateCount: state?.boundarySplatSelectedCandidateCount,
    sourceCandidateCount: state?.boundarySplatSourceCandidateCount,
    renderedInstanceCount: state?.boundarySplatInstanceCount,
    lodMode: state?.boundarySplatLodMode,
    adaptiveLodIdentity: state?.boundarySplatAdaptiveLodIdentity,
    tierGroups: state?.boundarySplatTierGroups,
    globalRenderedInstanceCount: state?.boundarySplatGlobalRenderedInstanceCount,
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
