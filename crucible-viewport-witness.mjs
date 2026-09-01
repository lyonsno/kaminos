#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readBrowserArrayInChunks } from './lib/chunked-browser-array-reader.mjs';
import {
  decoderKernelTileEventsFromSchedulerEvents,
  validateDecoderKernelTileEvidence,
} from './lib/decoder-kernel-tiling-evidence.mjs';
import {
  headlessBrowserRequest,
  resolveHeadlessBrowser,
} from './lib/headless-browser-resolver.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const part = process.argv[i];
  if (!part.startsWith('--')) continue;
  const key = part.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, '1');
  }
}

const usage = 'crucible-viewport-witness.mjs --url <kaminos-url> --out <screenshot.png> --report <report.json> [--chrome <executable>] [--viewport-width <pixels>] [--viewport-height <pixels>] [--fire-friendly] [--no-render-assay] [--replay-cast-report <completed-pipeline-witness.json>] [--scheduler-profile <cooperative-spn-gaussian|cooperative-fixed-16ms-donation|cooperative-spn-fusion-tiles-524288>] [--source-asset-id <indexed-asset-id>] [--fire-presentation <full-volume|hybrid-smoke-preview>] [--flame-continuity <live-every-frame|bounded-history-holdover>] [--capture-in-flight] [--diagnose-cadence-failures] [--require-frame-stage-ledger] [--in-flight-out <screenshot.png>] [--in-flight-settle-ms <milliseconds>] [--in-flight-max-observation-gap-ms <milliseconds>] [--expected-sharp-revision <sha>] [--expected-webgpu-kit-version <version>]';
if (args.has('help')) {
  console.log(usage);
  process.exit(0);
}

const url = args.get('url') || 'http://127.0.0.1:8095/';
const out = args.get('out') || '/tmp/kaminos-crucible-viewport-witness.png';
const reportPath = args.get('report') || '/tmp/kaminos-crucible-viewport-witness.json';
const browserRequest = headlessBrowserRequest({
  cliExecutable: args.get('chrome'),
  envExecutable: process.env.KAMINOS_CHROME,
});
const requestedCdpPort = args.has('cdp-port') ? Number(args.get('cdp-port')) : null;
const viewportWidth = Number(args.get('viewport-width') || 1600);
const viewportHeight = Number(args.get('viewport-height') || 1100);
const fireFriendly = args.has('fire-friendly');
const noRenderAssay = args.has('no-render-assay');
const replayCastReportPath = args.get('replay-cast-report') || null;
const schedulerProfileId = args.get('scheduler-profile') || 'cooperative-spn-gaussian';
const schedulerProfileLabel = schedulerProfileId === 'cooperative-fixed-16ms-donation'
  ? 'Fixed 16 ms donation test'
  : schedulerProfileId === 'cooperative-spn-fusion-tiles-524288'
    ? 'SPN fusion tile experiment'
    : 'Friendly';
const requestedSourceAssetId = args.get('source-asset-id') || null;
const requestedFirePresentation = args.get('fire-presentation') || 'full-volume';
const requestedFlameContinuity = args.get('flame-continuity') || 'live-every-frame';
const captureInFlight = args.has('capture-in-flight');
const diagnoseCadenceFailures = args.has('diagnose-cadence-failures');
const requireFrameStageLedger = args.has('require-frame-stage-ledger');
const outParts = path.parse(out);
const inFlightOut = args.get('in-flight-out')
  || path.join(outParts.dir, `${outParts.name}-in-flight${outParts.ext || '.png'}`);
const inFlightSettleMs = Number(args.get('in-flight-settle-ms') ?? 3000);
const inFlightMaxObservationGapMs = Number(args.get('in-flight-max-observation-gap-ms') ?? 50);
const fireTimeoutMs = args.has('fire-timeout-ms')
  ? Number(args.get('fire-timeout-ms'))
  : null;
const fireOperationTimeoutMs = fireTimeoutMs ?? 20000;
const expectedSharpRevision = args.get('expected-sharp-revision') || null;
const packageLock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8'));
const sourceLockedWebgpuKitVersion = packageLock.packages?.['node_modules/@kaminos/webgpu-inference-kit']?.version || null;
const expectedWebgpuKitVersion = args.get('expected-webgpu-kit-version') || sourceLockedWebgpuKitVersion;
let userDataDir = null;
const startedAt = new Date().toISOString();
const openGenerateTabExpression = 'document.querySelector(\'[data-tab="generate"]\').click()';

let phase = 'starting';
let browser = null;
let primaryOutputWritten = false;
let stderr = '';
let lastTrustworthyEvidence = null;
let replayCastEvidence = null;
let browserResolution = null;
let browserSession = null;
let browserSpawnError = null;
let browserExit = null;
let browserSocket = null;
let successfulReportPayload = null;
let terminalSummary = null;
let terminalFailure = null;
let browserCleanup = {
  profilePath: null,
  profileRemoved: false,
  processStopped: false,
  forced: false,
  errors: [],
};
let inFlightCapture = {
  requested: captureInFlight,
  status: captureInFlight ? 'awaiting-effective-hybrid' : 'not-requested',
  path: captureInFlight ? inFlightOut : null,
  settleMs: captureInFlight ? inFlightSettleMs : null,
  maxObservationGapMs: captureInFlight ? inFlightMaxObservationGapMs : null,
  observerEffect: captureInFlight
    ? 'CDP viewport capture may perturb foreground cadence; this visual run must not close performance acceptance.'
    : null,
};
const runtimeExceptions = [];
const requestedInvocation = {
  url,
  screenshot: out,
  reportPath,
  fireFriendly,
  noRenderAssay,
  replayCastReportPath,
  schedulerProfileId,
  sourceAssetId: requestedSourceAssetId,
  firePresentation: requestedFirePresentation,
  flameContinuity: requestedFlameContinuity,
  fireWaitPolicy: fireTimeoutMs === null
    ? { mode: 'uncapped', timeoutMs: null }
    : { mode: 'caller-deadline', timeoutMs: fireTimeoutMs },
  captureInFlight,
  requireFrameStageLedger,
  requestedCdpPort,
  browserRequest,
};

function bestKnownEffectiveIdentity() {
  const evidence = lastTrustworthyEvidence || {};
  const route = evidence.fullRoute || null;
  const replay = evidence.replayedCast || replayCastEvidence || null;
  const workroomSourceAssetId = evidence.sourceSelectionExercise?.effectiveAssetId
    ?? evidence.workroom?.effectiveState?.source?.assetId
    ?? null;
  const replaySource = replay?.sourceArtifact || null;
  const output = route?.output || replay?.artifact || null;
  return {
    browser: browserResolution ? {
      resolution: browserResolution,
      session: browserSession,
    } : null,
    sourceAssetId: replaySource ? null : workroomSourceAssetId,
    workroomSourceAssetId,
    source: replaySource ? {
      authority: 'pipeline-input-artifact',
      role: replaySource.role ?? null,
      status: replaySource.status ?? null,
      path: replaySource.path ?? null,
      bytes: replaySource.bytes ?? null,
      sha256: replaySource.sha256 ?? null,
    } : (workroomSourceAssetId ? {
      authority: 'workroom-source-selection',
      assetId: workroomSourceAssetId,
    } : null),
    requestedPipelineId: route?.requestedPipelineId ?? replay?.requestedPipelineId ?? null,
    effectiveRouteId: route?.effectiveRouteId
      ?? replay?.effectiveRouteId
      ?? evidence.workroom?.effectiveState?.effectiveRouteId
      ?? null,
    scheduler: route?.effectiveScheduler ?? null,
    fireBudget: route?.foregroundKilnHeartbeat?.effectiveFireBudget ?? null,
    output: output ? {
      status: output.status ?? null,
      sha256: output.sha256 ?? null,
      bytes: output.bytes ?? null,
    } : null,
  };
}

function expectedSchedulerForProfile(profileId) {
  const common = {
    mode: 'cooperative',
    spnPatchChunkSize: 1,
    waitForSubmittedWorkDone: true,
    vitBlockChunkSize: 1,
    vitMicroduty: true,
    vitMicrodutyMode: 'four-stage',
    cpuChunkItems: 16384,
    spnFusionChunkItems: 524288,
    decoderKernelChunkItems: 262144,
    decoderKernelMinChunkItems: 65536,
    decoderKernelMaxChunkItems: 8388608,
    decoderKernelTargetDurationMs: 12,
    decoderKernelAdjustmentGain: 0.375,
    plyAssemblyMode: 'worker',
    retirePostInferenceBuffers: true,
  };
  if (profileId === 'cooperative-spn-gaussian') {
    return { ...common, yieldMs: 4, gaussianPhaseYieldMs: 4, routeTailYieldMs: 3 };
  }
  if (profileId === 'cooperative-fixed-16ms-donation') {
    return { ...common, yieldMs: 16, gaussianPhaseYieldMs: 16, routeTailYieldMs: 16 };
  }
  if (profileId === 'cooperative-spn-fusion-tiles-524288') {
    return { ...common, yieldMs: 4, gaussianPhaseYieldMs: 4, routeTailYieldMs: 3 };
  }
  throw new Error(`Unsupported --scheduler-profile ${profileId}`);
}

function validateSpnFusionTileEvidence({ expectedChunkItems, fullRoute }) {
  if (!Number.isInteger(expectedChunkItems) || expectedChunkItems <= 0) return [];
  const failures = [];
  const assertion = (fullRoute?.schedulerBoundaryAssertions || []).find(candidate =>
    candidate?.field === 'phaseChunkSize.spnFusionOutputItems'
  );
  if (!assertion) {
    failures.push('boundary-assertion-missing');
  } else {
    if (assertion.status !== 'verified') failures.push('boundary-assertion-unverified');
    if (assertion.requested !== expectedChunkItems || assertion.effective !== expectedChunkItems) {
      failures.push('boundary-assertion-config-mismatch');
    }
    if (!Number.isInteger(assertion.observedCount) || assertion.observedCount < 2) {
      failures.push('boundary-assertion-multi-range-count-missing');
    }
  }

  const events = (fullRoute?.spnFusionTileEvents || []).filter(event =>
    Number.isInteger(event?.outputChunkIndex)
    && Number.isInteger(event?.outputChunkCount)
    && event.outputChunkCount > 1
    && Number.isInteger(event?.outputStart)
    && Number.isInteger(event?.outputEnd)
    && Number.isInteger(event?.outputCount)
    && Number.isInteger(event?.totalOutputItems)
  );
  if (events.length < 2) {
    failures.push('multi-range-events-missing');
    return [...new Set(failures)];
  }

  const groups = new Map();
  for (const event of events) {
    const block = String(event.block || '').replace(/\.output-chunk-\d+$/, '');
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block).push(event);
  }
  const completeGroup = [...groups.values()].some(group => {
    const ordered = [...group].sort((a, b) => a.outputChunkIndex - b.outputChunkIndex);
    const expectedCount = ordered[0]?.outputChunkCount;
    const totalOutputItems = ordered[0]?.totalOutputItems;
    if (ordered.length !== expectedCount || expectedCount < 2) return false;
    let cursor = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      const event = ordered[index];
      if (event.outputChunkIndex !== index
        || event.outputChunkCount !== expectedCount
        || event.totalOutputItems !== totalOutputItems
        || event.outputStart !== cursor
        || event.outputEnd - event.outputStart !== event.outputCount
        || event.outputCount > expectedChunkItems) return false;
      cursor = event.outputEnd;
    }
    return cursor === totalOutputItems;
  });
  if (!completeGroup) failures.push('range-coverage-invalid');
  return [...new Set(failures)];
}

function validatedReplayCastReport(document, reportPath) {
  if (document?.schema !== 'kaminos.pipeline-witness.v0') {
    throw new Error('Replay cast report must use kaminos.pipeline-witness.v0');
  }
  const outputRoot = document.effectiveRouteConfig?.outputRoot;
  const sourceArtifact = document.artifacts?.input;
  const artifact = document.artifacts?.splat;
  if (!outputRoot || !outputRoot.startsWith('/')) throw new Error('Replay cast report is missing an absolute output root');
  if (!artifact?.path || !artifact.path.startsWith('/')) throw new Error('Replay cast report is missing an absolute splat path');
  if (sourceArtifact?.role !== 'source-image' || !sourceArtifact?.path?.startsWith('/')) {
    throw new Error('Replay cast report is missing an absolute source image artifact');
  }
  if (!sourceArtifact.sha256) throw new Error('Replay cast source artifact is missing SHA-256 identity');
  if (!Number.isFinite(sourceArtifact.bytes) || sourceArtifact.bytes <= 0) {
    throw new Error('Replay cast source artifact must be nonempty');
  }
  if (artifact.status !== 'real') throw new Error('Replay cast artifact must carry status real');
  if (!artifact.sha256) throw new Error('Replay cast artifact is missing SHA-256 identity');
  if (!Number.isFinite(artifact.bytes) || artifact.bytes <= 0) throw new Error('Replay cast artifact must be nonempty');
  const normalize = value => {
    const segments = [];
    for (const segment of value.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') segments.pop();
      else segments.push(segment);
    }
    return `/${segments.join('/')}`;
  };
  const normalizedRoot = normalize(outputRoot);
  const normalizedArtifactPath = normalize(artifact.path);
  if (!normalizedArtifactPath.startsWith(`${normalizedRoot}/`)) {
    throw new Error('Replay cast artifact is outside recorded output root');
  }
  if (!document.requestedPipelineId || !document.effectiveRouteConfig?.routeId) {
    throw new Error('Replay cast report is missing requested/effective route identity');
  }
  return {
    authority: 'real-output-replay-not-inference',
    reportPath,
    requestedPipelineId: document.requestedPipelineId,
    effectiveRouteId: document.effectiveRouteConfig.routeId,
    outputRoot: normalizedRoot,
    sourceArtifact: { ...sourceArtifact, path: normalize(sourceArtifact.path) },
    artifact: { ...artifact, path: normalizedArtifactPath },
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureParent(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReport(payload) {
  ensureParent(reportPath);
  writeFileSync(reportPath, JSON.stringify({
    schema: 'crucible-viewport-witness.v0',
    url,
    screenshot: primaryOutputWritten ? out : null,
    reportPath,
    primaryOutputWritten,
    inFlightScreenshot: inFlightCapture.status === 'captured' ? inFlightCapture.path : null,
    inFlightCapture,
    phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedInvocation,
    effectiveIdentity: bestKnownEffectiveIdentity(),
    browserCleanup,
    ...payload,
  }, null, 2));
}

async function cdpAtPort(port, pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) throw new Error(`CDP ${pathname} failed ${response.status}`);
  return response.json();
}

async function cdp(pathname) {
  if (!browserSession?.cdpPort) throw new Error('spawned browser CDP identity is unavailable');
  return cdpAtPort(browserSession.cdpPort, pathname);
}

function browserExitedBeforeDevToolsMessage() {
  if (browserSpawnError) return `Browser spawn failed with ${browserSpawnError.code || browserSpawnError.name}: ${browserSpawnError.message}`;
  if (browserExit) {
    return `Browser exited before DevTools endpoint with code ${browserExit.code ?? 'null'} and signal ${browserExit.signal ?? 'null'}`;
  }
  return null;
}

async function waitForSpawnedBrowserCdp() {
  const activePortPath = path.join(userDataDir, 'DevToolsActivePort');
  let lastEndpointError = null;
  for (let index = 0; index < 600; index += 1) {
    const earlyFailure = browserExitedBeforeDevToolsMessage();
    if (earlyFailure) throw new Error(earlyFailure);
    let content;
    try {
      content = readFileSync(activePortPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await sleep(50);
      continue;
    }
    const [portLine, browserWebSocketPath] = content.trim().split(/\r?\n/);
    const cdpPort = Number(portLine);
    if (!Number.isInteger(cdpPort) || cdpPort <= 0 || cdpPort > 65535
      || !browserWebSocketPath?.startsWith('/devtools/browser/')) {
      throw new Error(`Spawned browser wrote invalid DevToolsActivePort: ${JSON.stringify(content)}`);
    }
    try {
      const version = await cdpAtPort(cdpPort, '/json/version');
      const attachedUrl = new URL(version.webSocketDebuggerUrl);
      if (Number(attachedUrl.port) !== cdpPort || attachedUrl.pathname !== browserWebSocketPath) {
        throw new Error(`CDP browser endpoint does not match DevToolsActivePort: ${JSON.stringify({
          cdpPort,
          browserWebSocketPath,
          webSocketDebuggerUrl: version.webSocketDebuggerUrl,
        })}`);
      }
      const earlyFailureAfterAttach = browserExitedBeforeDevToolsMessage();
      if (earlyFailureAfterAttach) throw new Error(earlyFailureAfterAttach);
      return {
        spawnedPid: browser.pid ?? null,
        profilePath: userDataDir,
        devToolsActivePortPath: activePortPath,
        cdpPort,
        browserWebSocketPath,
        browserWebSocketUrl: version.webSocketDebuggerUrl,
        attachedBrowserProduct: version.Browser ?? null,
        attachedProtocolVersion: version['Protocol-Version'] ?? null,
      };
    } catch (error) {
      lastEndpointError = error;
      await sleep(50);
    }
  }
  throw new Error(
    `Spawned browser DevTools endpoint did not become usable within 30000ms`
    + (lastEndpointError ? `: ${lastEndpointError.message}` : ''),
  );
}

function connectWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

function waitForBrowserExit(timeoutMs) {
  if (!browser || browserExit || browser.exitCode !== null || browser.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      browser.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    browser.once('exit', onExit);
  });
}

async function cleanupBrowserResources() {
  browserCleanup.profilePath = userDataDir;
  if (browserSocket) {
    try {
      browserSocket.close();
    } catch (error) {
      browserCleanup.errors.push(`websocket-close: ${error.message}`);
    }
    browserSocket = null;
  }
  if (browser) {
    try {
      if (!browserExit && browser.exitCode === null && browser.signalCode === null && browser.pid) {
        browser.kill('SIGTERM');
        if (!await waitForBrowserExit(5000)) {
          browserCleanup.forced = true;
          browser.kill('SIGKILL');
          if (!await waitForBrowserExit(5000)) {
            browserCleanup.errors.push('browser-process-did-not-exit');
          }
        }
      }
      browserCleanup.processStopped = Boolean(
        browserExit
        || browser.exitCode !== null
        || browser.signalCode !== null
        || !browser.pid,
      );
    } catch (error) {
      browserCleanup.errors.push(`browser-stop: ${error.message}`);
    }
  }
  if (userDataDir) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
      browserCleanup.profileRemoved = true;
    } catch (error) {
      browserCleanup.errors.push(`profile-remove: ${error.message}`);
    }
  }
  return browserCleanup;
}

let seq = 0;
function wsRequest(ws, method, params = {}, timeoutMs = 20000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result || {});
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression, timeoutMs = 20000) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(`evaluation failed during ${phase}: ${result.exceptionDetails.text || 'exception'}`);
  }
  return result.result?.value;
}

async function clickVisibleElementCenter(ws, elementId) {
  const target = await evaluate(ws, `(() => {
    const element = document.getElementById(${JSON.stringify(elementId)});
    if (!element) return { ok: false, reason: 'missing-element' };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      ok: rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && style.pointerEvents !== 'none'
        && Boolean(hit && (hit === element || element.contains(hit))),
      x,
      y,
      reason: hit?.id || hit?.tagName || 'no-hit-target',
    };
  })()`);
  if (!target?.ok) throw new Error(`Element ${elementId} is not a visible hit target: ${JSON.stringify(target)}`);
  await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  return target;
}

async function captureViewportPng(ws, outputPath) {
  const screenshot = await wsRequest(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const png = Buffer.from(screenshot.data, 'base64');
  if (png.length < 4096) throw new Error('screenshot is too small to be credible evidence');
  ensureParent(outputPath);
  writeFileSync(outputPath, png);
  return png;
}

function classifyCadenceAcceptance({ captureInFlight, diagnoseCadenceFailures = false, failures }) {
  const retainedFailures = Array.isArray(failures) ? failures : [];
  if (captureInFlight) {
    return {
      status: 'excluded-observer-effect',
      blocking: false,
      failures: retainedFailures,
      reason: 'CDP visual capture may perturb foreground cadence; use an uncaptured run for performance acceptance.',
    };
  }
  if (diagnoseCadenceFailures && retainedFailures.length) {
    return {
      status: 'diagnostic-failures-preserved',
      blocking: false,
      failures: retainedFailures,
      reason: 'Explicit diagnostic continuation preserves strict cadence failures and cannot satisfy cadence acceptance.',
    };
  }
  return {
    status: retainedFailures.length ? 'failed' : 'accepted',
    blocking: retainedFailures.length > 0,
    failures: retainedFailures,
    reason: retainedFailures.length ? 'Strict uncaptured cadence acceptance failed.' : null,
  };
}

function advanceInFlightCaptureReadiness({
  admissible,
  nowMs,
  eligibleSinceMs,
  settleMs,
  observationGapMs = 0,
  maxObservationGapMs = Number.POSITIVE_INFINITY,
}) {
  const observationGapExceeded = Number.isFinite(observationGapMs)
    && Number.isFinite(maxObservationGapMs)
    && observationGapMs > maxObservationGapMs;
  if (!admissible || observationGapExceeded) {
    return {
      status: 'awaiting-effective-hybrid',
      ready: false,
      eligibleSinceMs: null,
      settledForMs: 0,
      settleMs,
      observationGapMs,
      maxObservationGapMs,
      resetReason: observationGapExceeded ? 'observation-gap-exceeded' : 'presentation-inadmissible',
    };
  }
  const effectiveEligibleSinceMs = Number.isFinite(eligibleSinceMs) ? eligibleSinceMs : nowMs;
  const settledForMs = Math.max(0, nowMs - effectiveEligibleSinceMs);
  return {
    status: settledForMs >= settleMs ? 'capture-authorized' : 'settling-effective-hybrid',
    ready: settledForMs >= settleMs,
    eligibleSinceMs: effectiveEligibleSinceMs,
    settledForMs,
    settleMs,
    observationGapMs,
    maxObservationGapMs,
    resetReason: null,
  };
}

function buildInFlightHybridSettleMonitorExpression({ settleMs, maxObservationGapMs, requestedFlameContinuity }) {
  const validateSource = validateRequestedFirePresentation.toString();
  const advanceSource = advanceInFlightCaptureReadiness.toString();
  return `(() => {
    const validatePresentation = (${validateSource});
    const advanceReadiness = (${advanceSource});
    const monitor = {
      schema: 'kaminos.in-flight-hybrid-settle-monitor.v0',
      sampleRetention: 'uncapped',
      active: true,
      settleMs: ${JSON.stringify(settleMs)},
      maxObservationGapMs: ${JSON.stringify(maxObservationGapMs)},
      eligibleSinceMs: null,
      settledForMs: 0,
      ready: false,
      resetCount: 0,
      lastObservedAtMs: null,
      latest: null,
      samples: [],
    };
    monitor.snapshot = () => ({
      schema: monitor.schema,
      sampleRetention: monitor.sampleRetention,
      active: monitor.active,
      settleMs: monitor.settleMs,
      maxObservationGapMs: monitor.maxObservationGapMs,
      eligibleSinceMs: monitor.eligibleSinceMs,
      settledForMs: monitor.settledForMs,
      ready: monitor.ready,
      resetCount: monitor.resetCount,
      lastObservedAtMs: monitor.lastObservedAtMs,
      latest: monitor.latest,
      sampleCount: monitor.samples.length,
      samples: [...monitor.samples],
      mohelIndicator: {
        uncappedSettleSamples: true,
        sampleCount: monitor.samples.length,
        note: 'RAF settle samples are intentionally uncapped until visual capture finishes.',
      },
    });
    monitor.sampleNow = trigger => {
      const nowMs = performance.now();
      const fireState = window.__kaminosSharpBreathingRoomKilnFireState || {};
      const firingId = fireState.firingId || null;
      const expected = fireState.expectedFirePresentation || null;
      const liveVolumeDebugState = window.__kaminosVolumePrototype?.debugState?.() || null;
      const effective = liveVolumeDebugState?.firePresentation || null;
      const presentationSource = liveVolumeDebugState
        ? 'live-volume-prototype-debug-state'
        : 'missing-live-volume-prototype-debug-state';
      const presentationFailures = validatePresentation({
        requestedPresentation: 'hybrid-smoke-preview',
        requestedFlameContinuity: ${JSON.stringify(requestedFlameContinuity)},
        firingId,
        expected,
        effective,
      });
      const observationGapMs = Number.isFinite(monitor.lastObservedAtMs)
        ? Math.max(0, nowMs - monitor.lastObservedAtMs)
        : 0;
      const readiness = advanceReadiness({
        admissible: fireState.phase === 'burning' && presentationFailures.length === 0,
        nowMs,
        eligibleSinceMs: monitor.eligibleSinceMs,
        settleMs: monitor.settleMs,
        observationGapMs,
        maxObservationGapMs: monitor.maxObservationGapMs,
      });
      if (readiness.resetReason && monitor.eligibleSinceMs !== null) monitor.resetCount += 1;
      monitor.eligibleSinceMs = readiness.eligibleSinceMs;
      monitor.settledForMs = readiness.settledForMs;
      monitor.ready = readiness.ready;
      monitor.lastObservedAtMs = nowMs;
      monitor.latest = {
        trigger,
        atMs: nowMs,
        firingId,
        firePhase: fireState.phase || null,
        presentationSource,
        admissible: fireState.phase === 'burning' && presentationFailures.length === 0,
        status: readiness.status,
        observationGapMs,
        resetReason: readiness.resetReason,
        presentationFailures,
        candidateCount: effective?.candidateCount ?? null,
        candidateCapacity: effective?.candidateCapacity ?? null,
        candidateOverflow: effective?.candidateOverflow ?? null,
        candidateCopyBytes: effective?.candidateCopyBytes ?? null,
        fallbackReason: effective?.fallbackReason ?? null,
      };
      monitor.samples.push(monitor.latest);
      return monitor.latest;
    };
    window.__kaminosInFlightHybridSettleMonitor = monitor;
    const tick = () => {
      if (!monitor.active) return;
      monitor.sampleNow('raf');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return monitor.snapshot();
  })()`;
}

function buildNoRenderAssayInjectionExpression({ fallbackDelayMs = 250 } = {}) {
  return `(() => {
    const volume = globalThis.__kaminosVolumePrototype;
    if (!volume?.foregroundGpuContext || !volume?.debugState) {
      return { ok: false, reason: 'product-volume-unavailable' };
    }
    const state = {
      schema: 'kaminos.current-source-no-render-assay.v0',
      status: 'armed',
      presentationIsolation: 'foreground-opportunity-no-render-v0',
      fallbackDelayMs: ${JSON.stringify(fallbackDelayMs)},
      requestCount: 0,
      serviceCount: 0,
      observedRafCallbackCount: 0,
      nonPresentFallbackCount: 0,
      productHookAssignments: 0,
      serviceRetention: 'uncapped',
      services: [],
      lastService: null,
      authority: 'injected-evidence-hook-over-clean-product-source',
    };
    let assayHook = null;
    const waitForOpportunity = signal => new Promise((resolve, reject) => {
      let settled = false;
      let rafHandle = null;
      let fallbackHandle = null;
      const cleanup = () => {
        if (rafHandle !== null) cancelAnimationFrame(rafHandle);
        if (fallbackHandle !== null) clearTimeout(fallbackHandle);
        signal?.removeEventListener?.('abort', onAbort);
        rafHandle = null;
        fallbackHandle = null;
      };
      const finish = receipt => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(receipt);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(signal?.reason instanceof Error
          ? signal.reason
          : new Error(String(signal?.reason || 'no-render opportunity aborted')));
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      rafHandle = requestAnimationFrame(timestampMs => finish({
        serviceMode: 'observed-raf-callback',
        serviceAuthority: 'browser-request-animation-frame-callback-observed',
        rafCallbackObserved: true,
        renderedProductFrameObserved: false,
        presentedProductFrameObserved: false,
        rafTimestampMs: timestampMs,
        fallbackReason: null,
      }));
      fallbackHandle = setTimeout(() => finish({
        serviceMode: 'non-present-fallback',
        serviceAuthority: 'browser-task-fallback-no-presentation',
        rafCallbackObserved: false,
        renderedProductFrameObserved: false,
        presentedProductFrameObserved: false,
        rafTimestampMs: null,
        fallbackReason: 'raf-suspended-or-delayed',
      }), state.fallbackDelayMs);
    });
    Object.defineProperty(globalThis, '__kaminosSharpForegroundOpportunity', {
      configurable: true,
      enumerable: false,
      get() {
        return assayHook;
      },
      set(productHook) {
        state.productHookAssignments += 1;
        state.productHookType = typeof productHook;
        assayHook = context => {
          const product = volume.foregroundGpuContext();
          if (!product?.device || product.queue !== product.device.queue) {
            throw new Error('no-render assay requires the live product WebGPU device and queue');
          }
          if (context.device !== product.device || context.queue !== product.queue) {
            throw new Error('no-render assay shared-device or shared-queue identity mismatch');
          }
          state.requestCount += 1;
          const requestId = 'no-render:' + context.runId + ':' + state.requestCount;
          return {
            requestId,
            metadata: {
              workloadIdentity: 'foreground-opportunity-no-render-v0',
              presentationIsolation: 'no-render',
              serviceAuthorityPolicy: 'presented-raf-or-non-present-fallback',
              routeId: context.routeId || null,
              runId: context.runId || null,
              stage: context.stage || null,
              phase: context.phase || null,
              boundary: context.boundary || null,
              dutyId: context.dutyId || null,
              deviceIdentity: product.deviceIdentity || null,
              queueIdentity: product.queueIdentity || null,
            },
            async run(service = {}) {
              const effectiveProduct = volume.foregroundGpuContext();
              if (service.device !== effectiveProduct.device || service.queue !== effectiveProduct.queue) {
                throw new Error('no-render assay service left the product WebGPU device or queue');
              }
              const volumeState = volume.debugState();
              if (volumeState?.foregroundOpportunityMode !== 'lease-driven') {
                throw new Error('no-render assay requires quiesced lease-driven volume mode');
              }
              const opportunity = await waitForOpportunity(service.signal);
              const receipt = {
                schema: 'kaminos.volume-foreground-no-render-receipt.v0',
                status: 'opportunity-served',
                requestId,
                simulationQuiesced: true,
                raymarchSubmissionQuiesced: true,
                commandBufferCount: 0,
                sharedDeviceIdentityVerified: true,
                sharedQueueIdentityVerified: true,
                foregroundOpportunityMode: volumeState.foregroundOpportunityMode,
                fallbackDelayMs: state.fallbackDelayMs,
                volumeFrameCountAtService: volumeState.frameCount ?? null,
                ...opportunity,
              };
              state.serviceCount += 1;
              if (receipt.serviceMode === 'observed-raf-callback') state.observedRafCallbackCount += 1;
              if (receipt.serviceMode === 'non-present-fallback') state.nonPresentFallbackCount += 1;
              state.services.push(receipt);
              state.lastService = receipt;
              return receipt;
            },
          };
        };
      },
    });
    globalThis.__kaminosCurrentSourceNoRenderAssay = state;
    return { ok: true, ...state };
  })()`;
}

async function attemptInFlightHybridCapture({
  ws,
  outputPath,
  authorization,
  capturePng = captureViewportPng,
  persistEvidence,
}) {
  let receipt = {
    ...authorization,
    status: 'capture-attempting',
    path: outputPath,
    attemptedAt: new Date().toISOString(),
  };
  persistEvidence(receipt);
  try {
    const png = await capturePng(ws, outputPath);
    receipt = {
      ...receipt,
      status: 'captured',
      bytes: png.length,
      capturedAt: new Date().toISOString(),
    };
    persistEvidence(receipt);
    return receipt;
  } catch (error) {
    receipt = {
      ...receipt,
      status: 'capture-failed',
      failedAt: new Date().toISOString(),
      error: error.message || String(error),
    };
    persistEvidence(receipt);
    throw error;
  }
}

function compactWitnessSummary({ state, out, inFlightCapture, reportPath }) {
  const route = state?.fullRoute || null;
  const replay = state?.replayedCast || null;
  const foreground = route?.foregroundKilnHeartbeat || null;
  return {
    ok: true,
    out,
    report: reportPath,
    status: route?.status || replay?.status || 'non-firing-witness-complete',
    requestedFirePresentation: route?.requestedFirePresentation || null,
    selectedFirePresentation: route?.selectedFirePresentation || state?.selectedFirePresentation || null,
    requestedFlameContinuity: route?.requestedFlameContinuity || null,
    selectedFlameContinuity: route?.selectedFlameContinuity || state?.selectedFlameContinuity || null,
    effectiveFlameContinuity: route?.effectiveFlameContinuity || null,
    webgpuInferenceKit: state?.webgpuInferenceKit || null,
    output: (route?.output || replay?.artifact)
      ? {
          path: (route?.output || replay.artifact).path,
          bytes: (route?.output || replay.artifact).bytes,
          sha256: (route?.output || replay.artifact).sha256,
          status: (route?.output || replay.artifact).status,
        }
      : null,
    furnace: route
      ? {
          volumeReleased: route.volumeReleased,
          volumeReleaseConfirmed: route.volumeReleaseConfirmed,
          autoOpenedTab: route.autoOpenedTab,
        }
      : null,
    foreground: foreground
      ? {
          sampleCount: foreground.sampleCount,
          p95FrameGapMs: foreground.p95FrameGapMs,
          p99FrameGapMs: foreground.p99FrameGapMs,
          maxFrameGapMs: foreground.maxFrameGapMs,
        }
      : null,
    cadenceAcceptance: route?.cadenceAcceptance || null,
    inFlightCapture: inFlightCapture
      ? {
          requested: inFlightCapture.requested,
          status: inFlightCapture.status,
          path: inFlightCapture.path,
          firingId: inFlightCapture.firingId || null,
          settleMs: inFlightCapture.settleMs,
          settledForMs: inFlightCapture.settledForMs ?? null,
          settleSampleCount: inFlightCapture.settleEvidence?.sampleCount ?? null,
          settleResetCount: inFlightCapture.settleEvidence?.resetCount ?? null,
          postCaptureVerified: inFlightCapture.postCaptureSettleEvidence?.verified ?? null,
          bytes: inFlightCapture.bytes ?? null,
          observerEffect: inFlightCapture.observerEffect,
          error: inFlightCapture.error || null,
        }
      : null,
  };
}

function validateVolumeReleaseEvidence({ volumeReleased, volumeReleaseConfirmed }) {
  const failures = [];
  if (volumeReleased !== true) failures.push('furnace-release-not-attempted');
  if (volumeReleaseConfirmed !== true) failures.push('furnace-release-unconfirmed');
  return failures;
}

function validateRequestedFirePresentation({ requestedPresentation, requestedFlameContinuity, firingId, expected, effective }) {
  if (requestedPresentation !== 'hybrid-smoke-preview') return [];
  const failures = [];
  const hybridMode = 'learned-splat-flame-raymarched-smoke';
  const compositorIdentity = 'splat-depth-conditioned-front-back-smoke-compositor-v1';
  const compositorApproximation = 'splat-depth-conditioned-raymarched-front-back-smoke-intervals';
  const depthSplit = 'per-pixel-transformed-splat-depth-raymarch-split-v1';
  const phaseAuthority = 'shared-current-single-simulator-no-instance-smoke-history';
  const splatLayerIdentity = 'premultiplied-hdr-splat-radiance-alpha-linear-depth-moments-v0';
  const smokeLayerIdentity = 'raymarched-smoke-front-back-radiance-transmittance-linear-depth-intervals-v1';
  const smokeIntervals = ['front-of-splat-depth', 'back-of-splat-depth'];
  if (!expected) failures.push('expected-presentation-missing');
  if (expected && expected.effectiveMode !== hybridMode) failures.push('expected-presentation-mode-mismatch');
  if (expected?.firingId && expected.firingId !== firingId) failures.push('expected-presentation-firing-id-mismatch');
  if (!effective) return [...failures, 'effective-presentation-missing'];
  if (effective.firingId !== firingId) failures.push('effective-presentation-firing-id-mismatch');
  if (effective.requestedMode !== hybridMode) failures.push('requested-presentation-mode-mismatch');
  if (effective.effectiveMode !== hybridMode) failures.push('effective-presentation-mode-mismatch');
  if (effective.fallbackReason) failures.push('effective-presentation-fallback-present');
  if (effective.hybridSplatSmokeCompositorIdentity !== compositorIdentity) {
    failures.push('effective-presentation-compositor-identity-mismatch');
  }
  if (effective.hybridSplatSmokeApproximation !== compositorApproximation) {
    failures.push('effective-presentation-compositor-approximation-mismatch');
  }
  if (effective.splatDepthConditionedSmokeSplit !== depthSplit) {
    failures.push('effective-presentation-depth-split-mismatch');
  }
  if (effective.hybridSmokePhaseAuthority !== phaseAuthority) {
    failures.push('effective-presentation-phase-authority-mismatch');
  }
  if (effective.hybridSplatLayer?.identity !== splatLayerIdentity) {
    failures.push('effective-presentation-splat-layer-missing');
  }
  if (effective.hybridSmokeLayer?.identity !== smokeLayerIdentity) {
    failures.push('effective-presentation-smoke-layer-missing');
  }
  if (!Array.isArray(effective.hybridSmokeLayer?.intervals)
    || effective.hybridSmokeLayer.intervals.length !== smokeIntervals.length
    || effective.hybridSmokeLayer.intervals.some((interval, index) => interval !== smokeIntervals[index])) {
    failures.push('effective-presentation-smoke-intervals-mismatch');
  }
  if (effective.hybridSmokeLayer?.opticalComposition !== 'front-smoke>splat>back-smoke') {
    failures.push('effective-presentation-optical-composition-mismatch');
  }
  const candidateEvidencePresent = Number.isFinite(effective.candidateCount)
    && Number.isFinite(effective.candidateCapacity)
    && effective.candidateCount >= 0
    && effective.candidateCapacity >= effective.candidateCount;
  if (!candidateEvidencePresent) {
    failures.push('effective-presentation-candidate-evidence-missing');
  } else if (effective.candidateCount <= 0) {
    failures.push('effective-presentation-candidate-empty');
  }
  if (effective.candidateOverflow !== 0) failures.push('effective-presentation-candidate-overflow');
  if (effective.candidateCopyBytes !== 0) failures.push('effective-presentation-cpu-copy-present');
  const continuity = effective.flameContinuityEvidence;
  const counts = continuity?.counts;
  if (expected?.flameContinuityRequested !== requestedFlameContinuity) {
    failures.push('expected-flame-continuity-mismatch');
  }
  if (effective.flameContinuityRequested !== requestedFlameContinuity) {
    failures.push('requested-flame-continuity-mismatch');
  }
  if (effective.flameContinuityEffective !== requestedFlameContinuity) {
    failures.push('effective-flame-continuity-mismatch');
  }
  if (continuity?.schema !== 'kaminos.single-flame-continuity-runtime.v0'
    || continuity?.firingId !== firingId
    || continuity?.requested !== requestedFlameContinuity
    || continuity?.effective !== requestedFlameContinuity
    || !Number.isFinite(counts?.live)
    || !Number.isFinite(counts?.holdover)
    || !Number.isFinite(counts?.fallback)) {
    failures.push('flame-continuity-evidence-missing-or-mismatched');
  } else if (continuity.mode === 'holdover') {
    if (!Number.isFinite(continuity.selectedHistorySlot?.slotIndex)
      || continuity.renderFrameAdvanced !== true
      || continuity.sourceRenderFrameAdvanced !== false
      || continuity.simulatorStepAdvanced !== false) {
      failures.push('holdover-continuity-evidence-incomplete');
    }
  } else if (continuity.mode === 'live') {
    if (continuity.renderFrameAdvanced !== true
      || continuity.sourceRenderFrameAdvanced !== true
      || continuity.simulatorStepAdvanced !== true) {
      failures.push('live-continuity-evidence-incomplete');
    }
  } else {
    failures.push('flame-continuity-mode-invalid');
  }
  const hooks = effective.fireEpisodeHooks;
  if (hooks?.identity !== 'foreground-kiln-fire-episode-hooks-v0') {
    failures.push('effective-presentation-fire-episode-hooks-missing');
  } else {
    if (hooks.firingId !== firingId) failures.push('effective-presentation-hook-firing-id-mismatch');
    if (hooks.routeIdentity?.compositionRequested !== 'hybrid-smoke') {
      failures.push('effective-presentation-hook-request-mismatch');
    }
    if (hooks.routeIdentity?.compositionEffective !== 'hybrid-smoke') {
      failures.push('effective-presentation-hook-effective-mismatch');
    }
    if (hooks.routeIdentity?.compositionFallbackReason) {
      failures.push('effective-presentation-hook-fallback-present');
    }
  }
  return [...new Set(failures)];
}

function correlateForegroundGapsWithHostEvents({
  firingId,
  foregroundClock,
  hostTelemetry,
  foregroundGaps,
  hostEventRetention,
  hostEventCount,
  hostEvents,
} = {}) {
  const failures = [];
  const gaps = Array.isArray(foregroundGaps) ? foregroundGaps : [];
  const events = Array.isArray(hostEvents) ? hostEvents : [];
  if (hostEventRetention !== 'uncapped' || hostEventCount !== events.length) {
    failures.push('host-events-capped-or-partial');
  }

  const hostTelemetryAvailable = hostTelemetry?.schema === 'kaminos.foreground-host-telemetry.v0'
    && hostTelemetry.status === 'complete'
    && hostTelemetry.longTaskSource?.status === 'complete';
  if (!hostTelemetryAvailable) failures.push('host-telemetry-source-unavailable');
  if (!firingId || hostTelemetry?.firingId !== firingId || !hostTelemetry?.episodeId) {
    failures.push('host-telemetry-episode-mismatch');
  }
  const foregroundClockValid = foregroundClock?.schema === 'kaminos.browser-epoch-monotonic-clock.v0'
    && foregroundClock.timingAuthority === 'performance-time-origin-plus-now'
    && Number.isFinite(foregroundClock.timeOriginEpochMs);
  if (!foregroundClockValid
    || hostTelemetry?.clock?.schema !== foregroundClock?.schema
    || hostTelemetry?.clock?.timingAuthority !== foregroundClock?.timingAuthority
    || hostTelemetry?.clock?.timeOriginEpochMs !== foregroundClock?.timeOriginEpochMs) {
    failures.push('host-telemetry-clock-mismatch');
  }
  const acceptedEventSources = new Set();
  if (hostTelemetry?.longTaskSource?.status === 'complete'
    && typeof hostTelemetry.longTaskSource.identity === 'string') {
    acceptedEventSources.add(hostTelemetry.longTaskSource.identity);
  }
  if (hostTelemetry?.explicitEventSource?.status === 'available'
    && typeof hostTelemetry.explicitEventSource.identity === 'string') {
    acceptedEventSources.add(hostTelemetry.explicitEventSource.identity);
  }

  const validEvents = events.filter(event => {
    let valid = typeof event?.kind === 'string'
      && Boolean(event.kind)
      && typeof event?.phase === 'string'
      && Boolean(event.phase)
      && typeof event?.source === 'string'
      && Boolean(event.source)
      && Number.isFinite(event.startMs)
      && Number.isFinite(event.endMs)
      && event.endMs >= event.startMs
      && Number.isFinite(event.startEpochMs)
      && Number.isFinite(event.endEpochMs)
      && event.endEpochMs >= event.startEpochMs;
    if (!valid && !failures.includes('host-event-interval-invalid')) {
      failures.push('host-event-interval-invalid');
    }
    if (!acceptedEventSources.has(event?.source)) {
      if (!failures.includes('host-event-source-unrecognized')) failures.push('host-event-source-unrecognized');
      valid = false;
    }
    if (event?.firingId !== firingId) {
      if (!failures.includes('host-event-firing-mismatch')) failures.push('host-event-firing-mismatch');
      valid = false;
    }
    if (event?.episodeId !== hostTelemetry?.episodeId) {
      if (!failures.includes('host-event-episode-mismatch')) failures.push('host-event-episode-mismatch');
      valid = false;
    }
    const eventClockValid = foregroundClockValid
      && event?.clockSchema === foregroundClock.schema
      && event?.timingAuthority === foregroundClock.timingAuthority
      && event?.timeOriginEpochMs === foregroundClock.timeOriginEpochMs
      && Math.abs((foregroundClock.timeOriginEpochMs + event.startMs) - event.startEpochMs) <= 1
      && Math.abs((foregroundClock.timeOriginEpochMs + event.endMs) - event.endEpochMs) <= 1;
    if (!eventClockValid) {
      if (!failures.includes('host-event-clock-mismatch')) failures.push('host-event-clock-mismatch');
      valid = false;
    }
    if (!hostTelemetryAvailable) valid = false;
    return valid;
  });

  const mergedDuration = intervals => {
    const ordered = intervals
      .filter(interval => Number.isFinite(interval?.startEpochMs)
        && Number.isFinite(interval?.endEpochMs)
        && interval.endEpochMs > interval.startEpochMs)
      .map(interval => ({ startEpochMs: interval.startEpochMs, endEpochMs: interval.endEpochMs }))
      .sort((left, right) => left.startEpochMs - right.startEpochMs || left.endEpochMs - right.endEpochMs);
    if (!ordered.length) return 0;
    let total = 0;
    let start = ordered[0].startEpochMs;
    let end = ordered[0].endEpochMs;
    for (const interval of ordered.slice(1)) {
      if (interval.startEpochMs <= end) {
        end = Math.max(end, interval.endEpochMs);
      } else {
        total += end - start;
        start = interval.startEpochMs;
        end = interval.endEpochMs;
      }
    }
    return total + end - start;
  };
  const rounded = value => Number(value.toFixed(3));

  const correlatedGaps = gaps.map(gap => {
    const startEpochMs = Number(gap?.startEpochMs);
    const endEpochMs = Number(gap?.endEpochMs);
    if (!Number.isFinite(startEpochMs) || !Number.isFinite(endEpochMs) || endEpochMs <= startEpochMs) {
      if (!failures.includes('foreground-gap-interval-invalid')) {
        failures.push('foreground-gap-interval-invalid');
      }
    }
    const durationMs = Number.isFinite(gap?.durationMs)
      ? Number(gap.durationMs)
      : Math.max(0, endEpochMs - startEpochMs);
    const hostOverlaps = validEvents.map(event => {
      const overlapStartEpochMs = Math.max(startEpochMs, event.startEpochMs);
      const overlapEndEpochMs = Math.min(endEpochMs, event.endEpochMs);
      if (overlapEndEpochMs <= overlapStartEpochMs) return null;
      return {
        kind: event.kind,
        phase: event.phase,
        startEpochMs: rounded(overlapStartEpochMs),
        endEpochMs: rounded(overlapEndEpochMs),
        overlapDurationMs: rounded(overlapEndEpochMs - overlapStartEpochMs),
        detail: event.detail ?? null,
      };
    }).filter(Boolean);
    const schedulerOverlaps = Array.isArray(gap?.overlaps) ? gap.overlaps : [];
    const hostOverlapDurationMs = mergedDuration(hostOverlaps);
    const evidenceCoveredDurationMs = Math.min(
      Math.max(0, durationMs),
      mergedDuration([...schedulerOverlaps, ...hostOverlaps]),
    );
    return {
      ...gap,
      hostOverlapStatus: hostOverlaps.length ? 'observed' : 'none',
      hostOverlaps,
      hostOverlapDurationMs: rounded(hostOverlapDurationMs),
      evidenceCoveredDurationMs: rounded(evidenceCoveredDurationMs),
      remainingUnknownDurationMs: rounded(Math.max(0, durationMs - evidenceCoveredDurationMs)),
    };
  });
  const totals = correlatedGaps.reduce((result, gap) => ({
    foregroundGapDurationMs: result.foregroundGapDurationMs + (Number(gap.durationMs) || 0),
    hostOverlapDurationMs: result.hostOverlapDurationMs + gap.hostOverlapDurationMs,
    evidenceCoveredDurationMs: result.evidenceCoveredDurationMs + gap.evidenceCoveredDurationMs,
    remainingUnknownDurationMs: result.remainingUnknownDurationMs + gap.remainingUnknownDurationMs,
  }), {
    foregroundGapDurationMs: 0,
    hostOverlapDurationMs: 0,
    evidenceCoveredDurationMs: 0,
    remainingUnknownDurationMs: 0,
  });
  for (const key of Object.keys(totals)) totals[key] = rounded(totals[key]);

  return {
    schema: 'kaminos.foreground-host-gap-correlation.v0',
    status: failures.length ? 'invalid' : 'verified',
    evidenceSource: 'shared-epoch-interval-intersection',
    disclaimer: 'host-event-overlap-not-causal-attribution; uncovered durations remain unknown',
    hostEventRetention,
    hostEventCount,
    foregroundGapCount: gaps.length,
    uncoveredGapCount: correlatedGaps.filter(gap => gap.remainingUnknownDurationMs > 0).length,
    gaps: correlatedGaps,
    totals,
    failures,
  };
}

function validateNoRenderAssayEvidence(assay) {
  const failures = [];
  if (assay?.schema !== 'kaminos.current-source-no-render-assay.v0') failures.push('schema-invalid');
  if (assay?.presentationIsolation !== 'foreground-opportunity-no-render-v0') failures.push('isolation-invalid');
  if (!Number.isInteger(assay?.productHookAssignments) || assay.productHookAssignments < 1) failures.push('product-hook-unassigned');
  if (!Number.isInteger(assay?.requestCount) || assay.requestCount < 1) failures.push('request-count-empty');
  if (!Number.isInteger(assay?.serviceCount) || assay.serviceCount < 1) failures.push('service-count-empty');
  if (assay?.requestCount !== assay?.serviceCount) failures.push('request-service-count-mismatch');
  if (assay?.serviceRetention !== 'uncapped') failures.push('service-retention-capped-or-missing');
  if (!Array.isArray(assay?.services)) failures.push('services-missing');
  if (Array.isArray(assay?.services) && assay.services.length !== assay?.serviceCount) failures.push('service-array-count-mismatch');
  const requestIds = new Set();
  let observedRafCallbackCount = 0;
  let nonPresentFallbackCount = 0;
  for (const receipt of assay?.services || []) {
    if (receipt?.schema !== 'kaminos.volume-foreground-no-render-receipt.v0') failures.push('service-schema-invalid');
    if (receipt?.status !== 'opportunity-served') failures.push('service-status-invalid');
    if (typeof receipt?.requestId !== 'string' || receipt.requestId === '' || requestIds.has(receipt.requestId)) {
      failures.push('service-request-identity-invalid');
    } else {
      requestIds.add(receipt.requestId);
    }
    if (receipt?.simulationQuiesced !== true || receipt?.raymarchSubmissionQuiesced !== true) failures.push('volume-work-not-quiesced');
    if (receipt?.commandBufferCount !== 0) failures.push('volume-command-buffer-submitted');
    if (receipt?.sharedDeviceIdentityVerified !== true || receipt?.sharedQueueIdentityVerified !== true) failures.push('shared-gpu-identity-unverified');
    if (receipt?.foregroundOpportunityMode !== 'lease-driven') failures.push('lease-driven-mode-unverified');
    if (receipt?.renderedProductFrameObserved !== false || receipt?.presentedProductFrameObserved !== false) {
      failures.push('render-or-presentation-overclaim');
    }
    if (receipt?.serviceMode === 'observed-raf-callback') {
      observedRafCallbackCount += 1;
      if (receipt?.serviceAuthority !== 'browser-request-animation-frame-callback-observed'
        || receipt?.rafCallbackObserved !== true
        || !Number.isFinite(receipt?.rafTimestampMs)
        || receipt?.fallbackReason !== null) {
        failures.push('observed-raf-authority-invalid');
      }
    } else if (receipt?.serviceMode === 'non-present-fallback') {
      nonPresentFallbackCount += 1;
      if (receipt?.serviceAuthority !== 'browser-task-fallback-no-presentation'
        || receipt?.rafCallbackObserved !== false
        || receipt?.rafTimestampMs !== null
        || receipt?.fallbackReason !== 'raf-suspended-or-delayed') {
        failures.push('non-present-fallback-authority-invalid');
      }
    } else {
      failures.push('service-mode-invalid');
    }
  }
  if (assay?.observedRafCallbackCount !== observedRafCallbackCount) failures.push('observed-raf-count-mismatch');
  if (assay?.nonPresentFallbackCount !== nonPresentFallbackCount) failures.push('non-present-fallback-count-mismatch');
  if (observedRafCallbackCount + nonPresentFallbackCount !== assay?.serviceCount) failures.push('service-mode-count-incomplete');
  return [...new Set(failures)];
}

function projectFriendlyFiringEvidence({ browserFiringEvidence, pipelineReport }) {
  const report = pipelineReport || {};
  const stage = (report.stages || [])[0] || {};
  const adapter = stage.effectiveRoute?.adapterReport || {};
  const authoritativeTrace = report.authoritativeTrace || {};
  const authoritativeScheduler = authoritativeTrace.sharpRunDebug?.schedulerTelemetry || null;
  const backgroundHeartbeat = adapter.backgroundHeartbeat || authoritativeTrace.backgroundHeartbeat || null;
  const schedulerEvents = adapter.breathingRoom?.telemetry?.events
    || authoritativeScheduler?.eventTrace?.events
    || authoritativeScheduler?.events
    || [];
  const schedulerBoundaryAssertions = adapter.schedulerVerification?.boundaryAssertions
    || adapter.breathingRoom?.boundaryAssertions
    || adapter.breathingRoom?.telemetry?.boundaryAssertions
    || authoritativeScheduler?.boundaryAssertions
    || [];
  const spnFusionTileEvents = schedulerEvents
    .filter(event => event?.phase === 'spn-fusion'
      && event?.kind === 'chunk-start'
      && (event?.role === 'spn-fusion-output-chunk' || event?.chunkRole === 'spn-fusion-output-chunk')
      && Number(event?.outputChunkCount || 0) > 1)
    .map(event => ({
      phase: event.phase,
      boundary: event.boundary,
      block: event.block,
      parentBlock: event.parentBlock,
      role: event.role,
      chunkRole: event.chunkRole,
      outputChunkIndex: event.outputChunkIndex,
      outputChunkCount: event.outputChunkCount,
      outputStart: event.outputStart,
      outputEnd: event.outputEnd,
      outputCount: event.outputCount,
      totalOutputItems: event.totalOutputItems,
    }));
  const decoderKernelTileEvents = decoderKernelTileEventsFromSchedulerEvents(schedulerEvents);
  const routeTailEvents = schedulerEvents.filter(event => event?.phase === 'route-tail');
  const prepSteps = new Set(['depth-normalize', 'depth-min', 'depth-rescale', 'base-disparity', 'base-grid', 'base-color']);
  const prepEvents = routeTailEvents.filter(event => prepSteps.has(event?.step) && event?.role === 'cpu-materialization-chunk');
  const composePreparationIntervals = routeTailEvents
    .filter(event => prepSteps.has(event?.step) && event?.kind === 'duty-interval')
    .map(event => ({
      phase: event.phase,
      boundary: event.boundary,
      stage: event.stage,
      step: event.step,
      role: event.role,
      intervalStartMs: event.intervalStartMs,
      intervalEndMs: event.intervalEndMs,
      durationMs: event.durationMs,
    }));
  const gaussianEvents = routeTailEvents.filter(event => event?.step === 'gaussian-compose' && event?.role === 'cpu-materialization-chunk');
  const gaussianCpuDutyIntervals = routeTailEvents
    .filter(event => event?.step === 'gaussian-compose' && event?.kind === 'duty-interval' && event?.granularity === 'row-batched')
    .map(event => ({
      phase: event.phase,
      boundary: event.boundary,
      stage: event.stage,
      step: event.step,
      role: event.role,
      granularity: event.granularity,
      checkpointItems: event.checkpointItems,
      segmentStartProcessedItems: event.segmentStartProcessedItems,
      segmentEndProcessedItems: event.segmentEndProcessedItems,
      intervalStartMs: event.intervalStartMs,
      intervalEndMs: event.intervalEndMs,
      durationMs: event.durationMs,
    }));
  const maxGaussianDutyMs = Math.max(...gaussianCpuDutyIntervals.map(interval => interval.durationMs).filter(Number.isFinite), 0);
  const preGaussianSetupSteps = new Set(['ply-data-allocation', 'gaussian-activation-setup']);
  const preGaussianSetupIntervals = routeTailEvents
    .filter(event => preGaussianSetupSteps.has(event?.step) && event?.kind === 'duty-interval')
    .map(event => ({
      phase: event.phase,
      boundary: event.boundary,
      stage: event.stage,
      step: event.step,
      role: event.role,
      intervalStartMs: event.intervalStartMs,
      intervalEndMs: event.intervalEndMs,
      durationMs: event.durationMs,
      bytes: event.bytes,
    }));
  const lateTailSteps = new Set(['ply-blob-assembly', 'object-url-create', 'output-bind']);
  const lateTailBlockingIntervals = routeTailEvents
    .filter(event => lateTailSteps.has(event?.step) && event?.kind === 'duty-interval')
    .map(event => ({
      phase: event.phase,
      boundary: event.boundary,
      stage: event.stage,
      step: event.step,
      role: event.role,
      intervalStartMs: event.intervalStartMs,
      intervalEndMs: event.intervalEndMs,
      durationMs: event.durationMs,
      bytes: event.bytes,
    }));
  const inferenceWindowFinalizeInterval = routeTailEvents.find(event =>
    event?.step === 'inference-window-finalize' && event?.kind === 'duty-interval' && event?.role === 'localization-envelope'
  ) || null;
  const uninstrumentedGapsAtOrAbove50Ms = (backgroundHeartbeat?.worstFrameGaps || []).filter(gap =>
    gap?.overlapClassification === 'uninstrumented-gap' && gap?.durationMs >= 50
  );
  const splat = report.artifacts?.splat || null;
  return {
    status: browserFiringEvidence.status || null,
    message: browserFiringEvidence.message || null,
    reportPath: browserFiringEvidence.reportPath || null,
    noRenderAssay: browserFiringEvidence.noRenderAssay || null,
    requestedPipelineId: report.requestedPipelineId || null,
    effectiveRouteId: report.effectiveRouteConfig?.routeId || null,
    effectiveSharpRevision: adapter.revision || adapter.backend?.revision || null,
    requestedScheduler: adapter.breathingRoom?.requestedScheduler || null,
    effectiveScheduler: adapter.breathingRoom?.effectiveScheduler || null,
    schedulerBoundaryAssertions,
    spnFusionTileEvents,
    decoderKernelTileEvents,
    routeTailCheckpointEvents: {
      total: routeTailEvents.length,
      prep: prepEvents.length,
      gaussian: gaussianEvents.length,
      prepSteps: [...new Set(prepEvents.map(event => event.step))].sort(),
      gaussianProcessedItems: [...new Set(gaussianEvents.map(event => event.processedItems).filter(Number.isFinite))].sort((a, b) => a - b),
    },
    composePreparationIntervals,
    preGaussianSetupIntervals,
    gaussianCpuDutyIntervals,
    maxGaussianDutyMs,
    lateTailBlockingIntervals,
    inferenceWindowFinalizeInterval,
    uninstrumentedGapsAtOrAbove50Ms,
    output: splat ? { path: splat.path, bytes: splat.bytes, sha256: splat.sha256, status: splat.status } : null,
    backgroundHeartbeat: backgroundHeartbeat ? {
      schema: backgroundHeartbeat.schema,
      status: backgroundHeartbeat.status,
      evidenceSource: backgroundHeartbeat.evidenceSource,
      disclaimer: backgroundHeartbeat.disclaimer,
      requestedScheduler: backgroundHeartbeat.requestedScheduler,
      effectiveScheduler: backgroundHeartbeat.effectiveScheduler,
      inferenceWindow: backgroundHeartbeat.inferenceWindow,
      crossPageClock: backgroundHeartbeat.crossPageClock,
      gpuDutyIntervals: backgroundHeartbeat.gpuDutyIntervals,
      worstFrameGaps: backgroundHeartbeat.worstFrameGaps,
    } : null,
    foregroundKilnHeartbeat: browserFiringEvidence.foregroundKilnHeartbeat || null,
    sharpDutyCorrelation: browserFiringEvidence.sharpDutyCorrelation || null,
    kilnFrameStageLedger: browserFiringEvidence.kilnFrameStageLedger || null,
    requestedFirePresentation: browserFiringEvidence.requestedFirePresentation || null,
    selectedFirePresentation: browserFiringEvidence.selectedFirePresentation || null,
    requestedFlameContinuity: browserFiringEvidence.requestedFlameContinuity || null,
    selectedFlameContinuity: browserFiringEvidence.selectedFlameContinuity || null,
    effectiveFlameContinuity: browserFiringEvidence.foregroundKilnHeartbeat?.effectiveFirePresentation?.flameContinuityEffective || null,
    flameContinuityEvidence: browserFiringEvidence.foregroundKilnHeartbeat?.effectiveFirePresentation?.flameContinuityEvidence || null,
    firePresentationFailures: browserFiringEvidence.firePresentationFailures || [],
    volumeReleased: Boolean(browserFiringEvidence.volumeReleased),
    volumeReleaseConfirmed: Boolean(browserFiringEvidence.volumeReleaseConfirmed),
    autoOpenedTab: browserFiringEvidence.autoOpenedTab || null,
  };
}

try {
  phase = 'validating-arguments';
  if (args.has('cdp-port')) {
    throw new Error('--cdp-port is retired; omit it so the spawned browser owns a unique dynamic CDP endpoint');
  }
  if (!['full-volume', 'hybrid-smoke-preview'].includes(requestedFirePresentation)) {
    throw new Error(`Unsupported --fire-presentation ${requestedFirePresentation}`);
  }
  if (!['live-every-frame', 'bounded-history-holdover'].includes(requestedFlameContinuity)) {
    throw new Error(`Unsupported --flame-continuity ${requestedFlameContinuity}`);
  }
  if (!sourceLockedWebgpuKitVersion || !expectedWebgpuKitVersion) {
    throw new Error('WebGPU inference kit package identity is missing from package-lock.json');
  }
  if (args.has('expected-webgpu-kit-version') && expectedWebgpuKitVersion !== sourceLockedWebgpuKitVersion) {
    throw new Error(`Requested WebGPU inference kit ${expectedWebgpuKitVersion} does not match source lock ${sourceLockedWebgpuKitVersion}`);
  }
  if (captureInFlight && (!fireFriendly || requestedFirePresentation !== 'hybrid-smoke-preview')) {
    throw new Error('--capture-in-flight requires --fire-friendly with --fire-presentation hybrid-smoke-preview');
  }
  if (noRenderAssay && !fireFriendly) {
    throw new Error('--no-render-assay requires --fire-friendly');
  }
  if (noRenderAssay && (captureInFlight || replayCastReportPath)) {
    throw new Error('--no-render-assay cannot be combined with replay or in-flight visual capture');
  }
  if (args.has('scheduler-profile') && !fireFriendly) {
    throw new Error('--scheduler-profile requires --fire-friendly');
  }
  if (replayCastReportPath && fireFriendly) {
    throw new Error('--replay-cast-report cannot be combined with --fire-friendly');
  }
  if (!Number.isFinite(inFlightSettleMs) || inFlightSettleMs < 0) {
    throw new Error('--in-flight-settle-ms must be a finite nonnegative number');
  }
  if (!Number.isFinite(inFlightMaxObservationGapMs) || inFlightMaxObservationGapMs <= 0) {
    throw new Error('--in-flight-max-observation-gap-ms must be a finite positive number');
  }
  if (fireTimeoutMs !== null && (!Number.isFinite(fireTimeoutMs) || fireTimeoutMs <= 0)) {
    throw new Error('--fire-timeout-ms must be a finite positive caller-owned deadline when supplied');
  }
  phase = 'resolving-headless-browser';
  browserResolution = resolveHeadlessBrowser({
    cliExecutable: args.get('chrome'),
    envExecutable: process.env.KAMINOS_CHROME,
  });
  userDataDir = mkdtempSync(path.join(tmpdir(), 'kaminos-crucible-viewport-'));
  browserCleanup.profilePath = userDataDir;
  if (replayCastReportPath) {
    phase = 'validating-replay-cast-report';
    replayCastEvidence = validatedReplayCastReport(
      JSON.parse(readFileSync(replayCastReportPath, 'utf8')),
      replayCastReportPath,
    );
    lastTrustworthyEvidence = { replayCastSource: replayCastEvidence };
  }
  phase = 'launching-chrome';
  browser = spawn(browserResolution.effective.executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu-sandbox',
    '--no-first-run',
    `--window-size=${viewportWidth},${viewportHeight}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  browser.on('error', error => { browserSpawnError = error; });
  browser.on('exit', (code, signal) => { browserExit = { code, signal }; });
  browser.stderr.on('data', chunk => { stderr += chunk.toString(); });

  browserSession = await waitForSpawnedBrowserCdp();
  phase = 'opening-cdp';
  const targets = await cdp('/json/list');
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('no CDP page target found');
  browserSocket = await connectWebSocket(page.webSocketDebuggerUrl);
  const ws = browserSocket;

  phase = 'arming-runtime';
  await wsRequest(browserSocket, 'Runtime.enable');
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(message.params.exceptionDetails?.text || 'Runtime.exceptionThrown');
    }
  });
  await wsRequest(browserSocket, 'Page.enable');
  await wsRequest(browserSocket, 'Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });

  phase = 'loading-page';
  await wsRequest(ws, 'Page.navigate', { url }, 20000);
  await sleep(Number(args.get('settle-ms') || 2500));

  phase = 'opening-generate-tab';
  await evaluate(ws, openGenerateTabExpression);
  await sleep(900);

  phase = 'reading-workroom-state';
  const state = await evaluate(ws, `(() => {
    const workspace = document.getElementById('crucible-viewport-workspace');
    const stage = document.getElementById('crucible-worktable-stage');
    const sourceThumb = document.getElementById('crucible-viewport-source-thumb');
    const sourceSelect = document.getElementById('crucible-viewport-source-select');
    const fireButton = document.getElementById('crucible-viewport-fire-button');
    const castButton = document.getElementById('crucible-viewport-cast-button');
    const debug = window.kaminosCrucibleViewportDebugState?.() || null;
    const stageRect = stage?.getBoundingClientRect();
    return {
      requestedSelectors: {
        workspace: { id: 'crucible-viewport-workspace', data: 'data-crucible-workroom' },
        heat: { attribute: 'data-crucible-heat-state' },
        routeStatus: { attribute: 'data-crucible-route-status' },
        roomPosture: { attribute: 'data-crucible-room-posture' },
        stage: { id: 'crucible-worktable-stage' },
      },
      activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
      workspaceHidden: Boolean(workspace?.hidden),
      workroom: workspace?.dataset.crucibleWorkroom || null,
      heatState: workspace?.dataset.crucibleHeatState || null,
      routeStatus: workspace?.dataset.crucibleRouteStatus || null,
      roomPosture: workspace?.dataset.crucibleRoomPosture || null,
      consoleState: workspace?.dataset.crucibleConsoleState || null,
      pointerEvents: workspace ? getComputedStyle(workspace).pointerEvents : null,
      stageRect: stageRect ? { width: stageRect.width, height: stageRect.height } : null,
      sourceThumbHidden: Boolean(sourceThumb?.hidden),
      sourceOptionCount: sourceSelect?.options?.length || 0,
      selectedSourceId: sourceSelect?.value || null,
      selectedFirePresentation: document.getElementById('crucible-viewport-presentation-select')?.value || null,
      selectedFlameContinuity: document.getElementById('crucible-viewport-flame-continuity-select')?.value || null,
      fireButtonDisabled: Boolean(fireButton?.disabled),
      fireButtonLabel: fireButton?.textContent || null,
      castButtonDisabled: Boolean(castButton?.disabled),
      castButtonLabel: castButton?.textContent || null,
      effectiveState: debug,
      castHasTarget: Boolean(debug?.lastCast?.assetId && debug?.castTargetSceneObjectId),
      title: document.getElementById('crucible-viewport-title')?.textContent || null,
      source: document.getElementById('crucible-viewport-source')?.textContent || null,
      firing: document.getElementById('crucible-viewport-firing')?.textContent || null,
      cast: document.getElementById('crucible-viewport-cast')?.textContent || null,
      receipt: document.getElementById('crucible-viewport-receipt')?.textContent || null,
    };
  })()`);
  phase = 'reading-webgpu-kit-identity';
  const servedWebgpuKit = await evaluate(ws, `(async () => {
    const manifestUrl = new URL('/node_modules/@kaminos/webgpu-inference-kit/package.json', window.location.origin).href;
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) return { manifestUrl, effectiveVersion: null, fetchStatus: response.status };
    const manifest = await response.json();
    return { manifestUrl, effectiveVersion: manifest?.version || null, fetchStatus: response.status };
  })()`);
  state.webgpuInferenceKit = {
    sourceLockedVersion: sourceLockedWebgpuKitVersion,
    requestedVersion: expectedWebgpuKitVersion,
    ...servedWebgpuKit,
    status: servedWebgpuKit?.effectiveVersion === expectedWebgpuKitVersion ? 'matched' : 'mismatch',
  };
  lastTrustworthyEvidence = { workroom: state, webgpuInferenceKit: state.webgpuInferenceKit };
  if (state.webgpuInferenceKit.status !== 'matched') {
    throw new Error(`Effective WebGPU inference kit did not match source lock: ${JSON.stringify(state.webgpuInferenceKit)}`);
  }
  if (state.activeTab !== 'generate') throw new Error(`Generate tab did not activate: ${state.activeTab}`);
  if (state.workspaceHidden) throw new Error('Crucible viewport workspace is hidden');
  if (state.workroom !== 'active') throw new Error(`Crucible workroom identity missing: ${state.workroom}`);
  if (state.roomPosture !== 'bench') throw new Error(`Crucible did not begin in its full bench posture: ${state.roomPosture}`);
  if (state.pointerEvents === 'none') throw new Error('Crucible workroom controls are not hittable');
  if (!state.stageRect || state.stageRect.width < 300 || state.stageRect.height < 220) {
    throw new Error(`Crucible worktable stage is not visibly mounted: ${JSON.stringify(state.stageRect)}`);
  }
  if (state.sourceOptionCount < 1 || !state.selectedSourceId) {
    throw new Error(`Crucible source plate has no selectable indexed source: ${JSON.stringify(state)}`);
  }
  if (state.fireButtonDisabled) throw new Error('Crucible primary firing action is disabled despite a selected source');
  if (!state.castButtonDisabled && !state.castHasTarget) throw new Error('Crucible cast action is enabled without a scene target');
  phase = 'exercising-source-selection';
  state.sourceSelectionExercise = await evaluate(ws, `(async () => {
    const select = document.getElementById('crucible-viewport-source-select');
    const before = window.kaminosCrucibleViewportDebugState?.() || null;
    const requestedSourceAssetId = ${JSON.stringify(requestedSourceAssetId)};
    const target = requestedSourceAssetId
      ? Array.from(select?.options || []).find(option => option.value === requestedSourceAssetId)
      : Array.from(select?.options || []).find(option => option.value && option.value !== before?.source?.assetId);
    if (!target) return {
      attempted: false,
      requestedAssetId: requestedSourceAssetId,
      reason: requestedSourceAssetId ? 'requested indexed source missing' : 'no alternate indexed source',
    };
    select.value = target.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = window.kaminosCrucibleViewportDebugState?.() || null;
    return {
      attempted: true,
      requestedAssetId: target.value,
      beforeAssetId: before?.source?.assetId || null,
      effectiveAssetId: after?.source?.assetId || null,
      effectiveRouteId: after?.effectiveRouteId || null,
      effectivePipelineId: after?.effectivePipelineId || null,
    };
  })()`);
  if (requestedSourceAssetId && state.sourceSelectionExercise.effectiveAssetId !== requestedSourceAssetId) {
    throw new Error(`Requested Crucible source did not become effective: ${JSON.stringify(state.sourceSelectionExercise)}`);
  }
  if (state.sourceSelectionExercise.attempted && state.sourceSelectionExercise.effectiveAssetId !== state.sourceSelectionExercise.requestedAssetId) {
    throw new Error(`Crucible source selection did not become effective: ${JSON.stringify(state.sourceSelectionExercise)}`);
  }
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, sourceSelectionExercise: state.sourceSelectionExercise };
  if (runtimeExceptions.length) throw new Error(`browser runtime exceptions: ${runtimeExceptions.join('; ')}`);

  if (replayCastEvidence) {
    phase = 'replaying-completed-real-cast';
    state.replayedCast = await evaluate(ws, `(async () => {
      const replay = ${JSON.stringify(replayCastEvidence)};
      const run = {
        runId: 'visual-replay:' + replay.artifact.sha256,
        bundle: { document: { outputRoot: replay.outputRoot } },
      };
      const artifact = { id: 'splat', ...replay.artifact };
      const replayResult = await window.kaminosCrucibleViewportReplayRealCast({ replay, run, artifact });
      document.querySelector('[data-tab="generate"]').click();
      await new Promise(resolve => setTimeout(resolve, 240));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const workspace = document.getElementById('crucible-viewport-workspace');
      const stage = document.getElementById('crucible-worktable-stage');
      const sidebar = document.getElementById('sidebar');
      const transformBar = document.getElementById('transform-bar');
      const stageRect = stage?.getBoundingClientRect();
      const workspaceRect = workspace?.getBoundingClientRect();
      const transformBarRect = transformBar?.getBoundingClientRect();
      const debug = window.kaminosCrucibleViewportDebugState?.() || null;
      return {
        status: replay.authority,
        reportPath: replay.reportPath,
        requestedPipelineId: replay.requestedPipelineId,
        effectiveRouteId: replay.effectiveRouteId,
        sourceArtifact: replay.sourceArtifact,
        artifact: replay.artifact,
        castTargetSceneObjectId: replayResult.record?.id || null,
        receiptReportPath: replayResult.receipt?.reportPath || null,
        completedWorkroom: {
          heatState: workspace?.dataset.crucibleHeatState || null,
          routeStatus: workspace?.dataset.crucibleRouteStatus || null,
          roomPosture: workspace?.dataset.crucibleRoomPosture || null,
          consoleState: workspace?.dataset.crucibleConsoleState || null,
          stageTop: stageRect?.top ?? null,
          stageRight: stageRect?.right ?? null,
          viewportWidth: window.innerWidth,
          caddyOccupancy: stageRect && workspaceRect?.width ? stageRect.width / workspaceRect.width : null,
          transformBarBottom: transformBar?.classList.contains('visible') ? (transformBarRect?.bottom ?? null) : 0,
          castButtonDisabled: Boolean(document.getElementById('crucible-viewport-cast-button')?.disabled),
          consoleToggleLabel: document.getElementById('crucible-viewport-console-toggle')?.textContent || null,
          tuckedSidebarWidth: sidebar?.getBoundingClientRect().width ?? null,
          sceneViewportWidth: document.getElementById('viewport')?.getBoundingClientRect().width ?? null,
          sceneCanvasWidth: document.querySelector('#viewport > canvas')?.getBoundingClientRect().width ?? null,
          castScreenX: debug?.castScreenPoint?.screenX ?? null,
        },
      };
    })()`, fireOperationTimeoutMs);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, replayedCast: state.replayedCast };
    if (state.replayedCast.status !== 'real-output-replay-not-inference') throw new Error(`Replay authority changed: ${JSON.stringify(state.replayedCast)}`);
    if (state.replayedCast.receiptReportPath !== state.replayedCast.reportPath) throw new Error(`Replayed Crucible receipt lost source report identity: ${JSON.stringify(state.replayedCast)}`);
    if (!state.replayedCast.castTargetSceneObjectId || state.replayedCast.completedWorkroom.castButtonDisabled) throw new Error(`Replayed real cast is not actuatable: ${JSON.stringify(state.replayedCast)}`);
    if (state.replayedCast.completedWorkroom.roomPosture !== 'cast-held') throw new Error(`Replayed real cast did not open the room around the asset: ${JSON.stringify(state.replayedCast)}`);
    if (state.replayedCast.completedWorkroom.consoleState !== 'tucked') throw new Error(`Replayed real cast did not tuck the kiln caddy: ${JSON.stringify(state.replayedCast.completedWorkroom)}`);
    if (state.replayedCast.completedWorkroom.tuckedSidebarWidth > 1) throw new Error(`Replayed Crucible left the legacy sidebar in the cast workspace: ${JSON.stringify(state.replayedCast.completedWorkroom)}`);
    if (Math.abs(state.replayedCast.completedWorkroom.sceneCanvasWidth - state.replayedCast.completedWorkroom.sceneViewportWidth) > 2) throw new Error(`Replayed Crucible renderer retained stale viewport width: ${JSON.stringify(state.replayedCast.completedWorkroom)}`);
    if (!Number.isFinite(state.replayedCast.completedWorkroom.caddyOccupancy)
      || state.replayedCast.completedWorkroom.caddyOccupancy > 0.4) throw new Error(`Replayed Crucible caddy obscures the primary scene field: ${JSON.stringify(state.replayedCast.completedWorkroom)}`);
    if (!Number.isFinite(state.replayedCast.completedWorkroom.castScreenX)
      || state.replayedCast.completedWorkroom.castScreenX < state.replayedCast.completedWorkroom.stageRight + 24) throw new Error(`Replayed Crucible cast remains behind the caddy: ${JSON.stringify(state.replayedCast.completedWorkroom)}`);
    if (state.replayedCast.completedWorkroom.stageTop < state.replayedCast.completedWorkroom.transformBarBottom + 8) throw new Error(`Replayed Crucible console overlaps the scene toolbar: ${JSON.stringify(state.replayedCast.completedWorkroom)}`);
    phase = 'exercising-crucible-console-toggle';
    const toggleBefore = await evaluate(ws, `(() => {
      const sidebar = document.getElementById('sidebar');
      const before = window.kaminosCrucibleViewportDebugState?.() || null;
      return { before, tuckedSidebarWidth: sidebar?.getBoundingClientRect().width ?? null };
    })()`);
    const openHitTarget = await clickVisibleElementCenter(ws, 'crucible-viewport-console-toggle');
    await sleep(360);
    const toggleExpanded = await evaluate(ws, `(() => {
      const sidebar = document.getElementById('sidebar');
      const expandedState = document.getElementById('crucible-viewport-workspace')?.dataset.crucibleConsoleState || null;
      const expandedSidebarWidth = sidebar?.getBoundingClientRect().width ?? null;
      const expandedDebug = window.kaminosCrucibleViewportDebugState?.() || null;
      return { expandedState, expandedSidebarWidth, expandedDebug };
    })()`);
    const tuckHitTarget = await clickVisibleElementCenter(ws, 'crucible-viewport-console-toggle');
    await sleep(360);
    const toggleRetucked = await evaluate(ws, `(() => {
      const sidebar = document.getElementById('sidebar');
      const retuckedState = document.getElementById('crucible-viewport-workspace')?.dataset.crucibleConsoleState || null;
      const retuckedSidebarWidth = sidebar?.getBoundingClientRect().width ?? null;
      const retuckedDebug = window.kaminosCrucibleViewportDebugState?.() || null;
      return { retuckedState, retuckedSidebarWidth, retuckedDebug };
    })()`);
    state.replayedCast.consoleToggleExercise = {
      expandedState: toggleExpanded.expandedState,
      retuckedState: toggleRetucked.retuckedState,
      tuckedSidebarWidth: toggleBefore.tuckedSidebarWidth,
      expandedSidebarWidth: toggleExpanded.expandedSidebarWidth,
      retuckedSidebarWidth: toggleRetucked.retuckedSidebarWidth,
      openHitTarget,
      tuckHitTarget,
      castTargetPreserved: Boolean(
        toggleBefore.before?.castTargetSceneObjectId
        && toggleExpanded.expandedDebug?.castTargetSceneObjectId === toggleBefore.before.castTargetSceneObjectId
        && toggleRetucked.retuckedDebug?.castTargetSceneObjectId === toggleBefore.before.castTargetSceneObjectId
      ),
    };
    if (state.replayedCast.consoleToggleExercise.expandedState !== 'expanded'
      || state.replayedCast.consoleToggleExercise.retuckedState !== 'tucked'
      || state.replayedCast.consoleToggleExercise.tuckedSidebarWidth > 1
      || state.replayedCast.consoleToggleExercise.expandedSidebarWidth < 300
      || state.replayedCast.consoleToggleExercise.retuckedSidebarWidth > 1
      || !state.replayedCast.consoleToggleExercise.castTargetPreserved) {
      throw new Error(`Crucible console toggle lost presentation or cast custody: ${JSON.stringify(state.replayedCast.consoleToggleExercise)}`);
    }
  }

  if (fireFriendly) {
    const expectedScheduler = expectedSchedulerForProfile(schedulerProfileId);
    if (noRenderAssay) {
      phase = 'arming-no-render-assay';
      const noRenderArm = await evaluate(ws, buildNoRenderAssayInjectionExpression());
      if (noRenderArm?.ok !== true) {
        throw new Error(`Current-source no-render assay did not arm: ${JSON.stringify(noRenderArm)}`);
      }
      lastTrustworthyEvidence = { ...lastTrustworthyEvidence, noRenderAssay: noRenderArm };
      writeReport({
        ok: null,
        status: 'no-render-assay-armed-before-primary-output',
        lastTrustworthyEvidence,
        runtimeExceptions,
        stderrTail: stderr.slice(-1000),
      });
    }
    phase = 'starting-friendly-firing';
    await evaluate(ws, `(() => {
      const requestedFlameContinuity = ${JSON.stringify(requestedFlameContinuity)};
      const presentation = document.getElementById('crucible-viewport-presentation-select');
      const flameContinuity = document.getElementById('crucible-viewport-flame-continuity-select');
      presentation.value = '${requestedFirePresentation}';
      presentation.dispatchEvent(new Event('change', { bubbles: true }));
      flameContinuity.value = '${requestedFlameContinuity}';
      flameContinuity.dispatchEvent(new Event('change', { bubbles: true }));
      window.__kaminosWitnessFiringPromise = window.runKilnRouteBenchRoute(
        'sharp-image-to-splat-live-v0',
        ${JSON.stringify(schedulerProfileId)},
        {
          firePresentationMode: ${JSON.stringify(requestedFirePresentation)},
          flameContinuityMode: requestedFlameContinuity,
          profileLabel: ${JSON.stringify(schedulerProfileLabel)},
        },
      );
      return {
        schedulerProfileId: ${JSON.stringify(schedulerProfileId)},
        presentation: presentation.value,
        flameContinuity: flameContinuity.value,
      };
    })()`);
    if (captureInFlight) {
      phase = 'installing-in-flight-hybrid-settle-monitor';
      const installedMonitor = await evaluate(ws, buildInFlightHybridSettleMonitorExpression({
        settleMs: inFlightSettleMs,
        maxObservationGapMs: inFlightMaxObservationGapMs,
        requestedFlameContinuity,
      }));
      inFlightCapture = { ...inFlightCapture, settleMonitor: installedMonitor };
      lastTrustworthyEvidence = { ...lastTrustworthyEvidence, inFlightCapture };
    }
    const fireDeadlineAtMs = fireTimeoutMs === null ? null : Date.now() + fireTimeoutMs;
    let observedRunning = false;
    let routeState = null;
    while (fireDeadlineAtMs === null || Date.now() < fireDeadlineAtMs) {
      await sleep(1000);
      routeState = await evaluate(ws, `(() => {
        const liveVolume = window.__kaminosVolumePrototype?.debugState?.() || null;
        return ({
        status: window.__kaminosKilnRouteBenchState?.status || null,
        message: window.__kaminosKilnRouteBenchState?.message || null,
        runningProfileId: window.__kaminosKilnRouteBenchState?.runningProfileId || null,
        firePhase: window.__kaminosSharpBreathingRoomKilnFireState?.phase || null,
        firingId: window.__kaminosSharpBreathingRoomKilnFireState?.firingId || null,
        expectedFirePresentation: window.__kaminosSharpBreathingRoomKilnFireState?.expectedFirePresentation || null,
        effectiveFirePresentation: liveVolume?.firePresentation || null,
        effectiveFlameContinuity: liveVolume?.flameContinuityEffective || null,
        noRenderAssay: window.__kaminosCurrentSourceNoRenderAssay
          ? { ...window.__kaminosCurrentSourceNoRenderAssay }
          : null,
        roomPosture: document.getElementById('crucible-viewport-workspace')?.dataset.crucibleRoomPosture || null,
        settleMonitor: (() => {
          const monitor = window.__kaminosInFlightHybridSettleMonitor;
          return monitor ? {
            schema: monitor.schema,
            sampleRetention: monitor.sampleRetention,
            active: monitor.active,
            settleMs: monitor.settleMs,
            maxObservationGapMs: monitor.maxObservationGapMs,
            eligibleSinceMs: monitor.eligibleSinceMs,
            settledForMs: monitor.settledForMs,
            ready: monitor.ready,
            resetCount: monitor.resetCount,
            lastObservedAtMs: monitor.lastObservedAtMs,
            latest: monitor.latest,
            sampleCount: monitor.samples.length,
          } : null;
        })(),
        });
      })()`);
      if (noRenderAssay && routeState.noRenderAssay) {
        lastTrustworthyEvidence = {
          ...lastTrustworthyEvidence,
          noRenderAssay: routeState.noRenderAssay,
          noRenderRouteState: {
            status: routeState.status,
            message: routeState.message,
            firePhase: routeState.firePhase,
            firingId: routeState.firingId,
          },
        };
      }
      if (routeState.runningProfileId || routeState.status === 'running') observedRunning = true;
      if ((routeState.runningProfileId || routeState.status === 'running') && routeState.roomPosture !== 'firing') {
        throw new Error(`Live firing did not fold the Crucible into its furnace-visible posture: ${JSON.stringify(routeState)}`);
      }
      if (captureInFlight && !['captured', 'capture-attempting', 'capture-failed'].includes(inFlightCapture.status)) {
        inFlightCapture = {
          ...inFlightCapture,
          status: routeState.settleMonitor?.ready ? 'capture-authorized' : (routeState.settleMonitor?.latest?.status || 'awaiting-effective-hybrid'),
          settledForMs: routeState.settleMonitor?.settledForMs ?? 0,
          settleSampleCount: routeState.settleMonitor?.sampleCount ?? 0,
          settleResetCount: routeState.settleMonitor?.resetCount ?? 0,
          lastRouteState: routeState,
        };
        lastTrustworthyEvidence = { ...lastTrustworthyEvidence, inFlightCapture };
        if (routeState.settleMonitor?.ready) {
          const preCaptureSettleEvidence = await evaluate(ws, `(() => {
            const monitor = window.__kaminosInFlightHybridSettleMonitor;
            if (!monitor) return null;
            monitor.sampleNow('pre-capture');
            return monitor.snapshot();
          })()`);
          if (!preCaptureSettleEvidence?.ready
            || preCaptureSettleEvidence.latest?.admissible !== true
            || preCaptureSettleEvidence.latest?.firingId !== routeState.firingId) {
            inFlightCapture = {
              ...inFlightCapture,
              status: 'settle-invalidated-before-capture',
              settleEvidence: preCaptureSettleEvidence,
            };
            lastTrustworthyEvidence = { ...lastTrustworthyEvidence, inFlightCapture };
            continue;
          }
          phase = 'capturing-in-flight-hybrid';
          const presentationFailures = validateRequestedFirePresentation({
            requestedPresentation: requestedFirePresentation,
            requestedFlameContinuity,
            firingId: routeState.firingId,
            expected: routeState.expectedFirePresentation,
            effective: routeState.effectiveFirePresentation,
          });
          inFlightCapture = await attemptInFlightHybridCapture({
            ws,
            outputPath: inFlightOut,
            authorization: {
              ...inFlightCapture,
              firingId: routeState.firingId,
              firePhase: routeState.firePhase,
              requestedFirePresentation,
              requestedFlameContinuity,
              effectiveFlameContinuity: routeState.effectiveFlameContinuity,
              expectedFirePresentation: routeState.expectedFirePresentation,
              effectiveFirePresentation: routeState.effectiveFirePresentation,
              presentationFailures,
              settleEvidence: preCaptureSettleEvidence,
            },
            persistEvidence: receipt => {
              inFlightCapture = receipt;
              lastTrustworthyEvidence = { ...lastTrustworthyEvidence, inFlightCapture: receipt };
            },
          });
          const postCaptureSettleEvidence = await evaluate(ws, `(() => {
            const monitor = window.__kaminosInFlightHybridSettleMonitor;
            if (!monitor) return null;
            monitor.sampleNow('post-capture');
            monitor.active = false;
            return monitor.snapshot();
          })()`);
          const postCaptureVerified = Boolean(
            postCaptureSettleEvidence?.ready
            && postCaptureSettleEvidence.latest?.admissible === true
            && postCaptureSettleEvidence.latest?.firingId === routeState.firingId
            && postCaptureSettleEvidence.eligibleSinceMs === preCaptureSettleEvidence.eligibleSinceMs
            && postCaptureSettleEvidence.resetCount === preCaptureSettleEvidence.resetCount
          );
          inFlightCapture = {
            ...inFlightCapture,
            status: postCaptureVerified ? 'captured' : 'capture-invalidated',
            postCaptureSettleEvidence: postCaptureSettleEvidence
              ? {
                  ...postCaptureSettleEvidence,
                  samples: undefined,
                  verified: postCaptureVerified,
                }
              : { verified: false },
          };
          lastTrustworthyEvidence = { ...lastTrustworthyEvidence, inFlightCapture };
          if (!postCaptureVerified) {
            throw new Error(`Hybrid presentation lost its settled same-firing authority during visual capture: ${JSON.stringify(inFlightCapture.postCaptureSettleEvidence)}`);
          }
          phase = 'waiting-for-friendly-firing';
        }
      }
      if (!routeState.runningProfileId && ['complete', 'error', 'evidence-only'].includes(routeState.status)) break;
    }
    if (captureInFlight && inFlightCapture.status !== 'captured') {
      inFlightCapture = {
        ...inFlightCapture,
        status: 'not-captured',
        reason: 'effective-hybrid-presentation-not-observed-before-route-finished',
        lastRouteState: routeState,
      };
      lastTrustworthyEvidence = { ...lastTrustworthyEvidence, inFlightCapture };
    }
    if (!observedRunning) throw new Error(`Friendly firing never entered running state: ${JSON.stringify(routeState)}`);
    if (!routeState || routeState.runningProfileId || !['complete', 'error', 'evidence-only'].includes(routeState.status)) {
      const waitDescription = fireTimeoutMs === null ? 'the uncapped live-route wait' : `${fireTimeoutMs}ms`;
      throw new Error(`Friendly firing did not finish within ${waitDescription}: ${JSON.stringify(routeState)}`);
    }
    phase = 'reading-friendly-firing-evidence';
    const browserFiringEvidence = await evaluate(ws, `(() => {
      const routeState = window.__kaminosKilnRouteBenchState || {};
      const foregroundKilnHeartbeat = routeState.result?.foregroundKilnHeartbeat || null;
      const sharpDutyCorrelation = foregroundKilnHeartbeat?.sharpDutyCorrelation || null;
      const fire = window.kaminosSharpBreathingRoomKilnFireDebug?.state?.()?.fire || null;
      const kilnFrameStageLedger = routeState.result?.kilnFrameStageLedger || fire?.volumeDebugState?.kilnFrameStageLedger || null;
      const reportPath = routeState.result?.report?.path || null;
      const noRenderAssay = window.__kaminosCurrentSourceNoRenderAssay
        ? { ...window.__kaminosCurrentSourceNoRenderAssay }
        : null;
      const snapshotIdentity = {
        nonce: globalThis.crypto?.randomUUID?.() || ('witness-' + Date.now() + '-' + Math.random()),
        reportPath,
        firingId: foregroundKilnHeartbeat?.firingId || null,
        runId: sharpDutyCorrelation?.runId || null,
      };
      window.__kaminosCrucibleWitnessSnapshot = {
        identity: Object.freeze({ ...snapshotIdentity }),
        foregroundSamples: Object.freeze([...(foregroundKilnHeartbeat?.samples || [])]),
        hostEvents: Object.freeze([...(foregroundKilnHeartbeat?.hostEvents || [])]),
        foregroundGaps: Object.freeze([...(sharpDutyCorrelation?.foregroundGaps || [])]),
        kilnFrameStageFrames: Object.freeze([...(kilnFrameStageLedger?.frames || [])]),
        kilnFrameStageEvents: Object.freeze([...(kilnFrameStageLedger?.events || [])]),
      };
      const foregroundKilnHeartbeatWitness = foregroundKilnHeartbeat
        ? { ...foregroundKilnHeartbeat, samples: undefined, hostEvents: undefined, sharpHeartbeat: undefined, sharpDutyCorrelation: undefined }
        : null;
      const sharpDutyCorrelationWitness = sharpDutyCorrelation
        ? { ...sharpDutyCorrelation, foregroundGaps: undefined }
        : null;
      const kilnFrameStageLedgerWitness = kilnFrameStageLedger
        ? { ...kilnFrameStageLedger, frames: undefined, events: undefined }
        : null;
      return {
        noRenderAssay,
        status: routeState.status || null,
        message: routeState.message || null,
        requestedFirePresentation: '${requestedFirePresentation}',
        requestedFlameContinuity: '${requestedFlameContinuity}',
        selectedFirePresentation: document.getElementById('crucible-viewport-presentation-select')?.value || null,
        selectedFlameContinuity: document.getElementById('crucible-viewport-flame-continuity-select')?.value || null,
        reportPath,
        snapshotIdentity,
        foregroundKilnHeartbeat: foregroundKilnHeartbeatWitness,
        sharpDutyCorrelation: sharpDutyCorrelationWitness,
        kilnFrameStageLedger: kilnFrameStageLedgerWitness,
        volumeReleased: Boolean(fire?.volumeReleased),
        volumeReleaseConfirmed: Boolean(fire?.volumeReleaseConfirmed),
        autoOpenedTab: document.querySelector('.tab.active')?.dataset.tab || null,
      };
    })()`, fireOperationTimeoutMs);
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      noRenderAssay: browserFiringEvidence.noRenderAssay || lastTrustworthyEvidence?.noRenderAssay || null,
      postFiringSummary: {
        status: browserFiringEvidence.status,
        message: browserFiringEvidence.message,
        reportPath: browserFiringEvidence.reportPath,
        requestedFirePresentation: browserFiringEvidence.requestedFirePresentation,
        selectedFirePresentation: browserFiringEvidence.selectedFirePresentation,
        requestedFlameContinuity: browserFiringEvidence.requestedFlameContinuity,
        selectedFlameContinuity: browserFiringEvidence.selectedFlameContinuity,
        volumeReleased: browserFiringEvidence.volumeReleased,
        volumeReleaseConfirmed: browserFiringEvidence.volumeReleaseConfirmed,
        snapshotIdentity: browserFiringEvidence.snapshotIdentity,
        foregroundHeartbeat: browserFiringEvidence.foregroundKilnHeartbeat
          ? {
              schema: browserFiringEvidence.foregroundKilnHeartbeat.schema,
              status: browserFiringEvidence.foregroundKilnHeartbeat.status,
              firingId: browserFiringEvidence.foregroundKilnHeartbeat.firingId,
              sampleRetention: browserFiringEvidence.foregroundKilnHeartbeat.sampleRetention,
              sampleCount: browserFiringEvidence.foregroundKilnHeartbeat.sampleCount,
              hostEventRetention: browserFiringEvidence.foregroundKilnHeartbeat.hostEventRetention,
              hostEventCount: browserFiringEvidence.foregroundKilnHeartbeat.hostEventCount,
            }
          : null,
        sharpDutyCorrelation: browserFiringEvidence.sharpDutyCorrelation
          ? {
              schema: browserFiringEvidence.sharpDutyCorrelation.schema,
              status: browserFiringEvidence.sharpDutyCorrelation.status,
              firingId: browserFiringEvidence.sharpDutyCorrelation.firingId,
              runId: browserFiringEvidence.sharpDutyCorrelation.runId,
              foregroundGapCount: browserFiringEvidence.sharpDutyCorrelation.foregroundGapCount,
            }
          : null,
        kilnFrameStageLedger: browserFiringEvidence.kilnFrameStageLedger
          ? {
              schema: browserFiringEvidence.kilnFrameStageLedger.schema,
              status: browserFiringEvidence.kilnFrameStageLedger.status,
              evidenceStatus: browserFiringEvidence.kilnFrameStageLedger.evidenceStatus,
              firingId: browserFiringEvidence.kilnFrameStageLedger.firingId,
              sampleRetention: browserFiringEvidence.kilnFrameStageLedger.sampleRetention,
              frameCount: browserFiringEvidence.kilnFrameStageLedger.mohelIndicator?.frameCount ?? null,
              eventCount: browserFiringEvidence.kilnFrameStageLedger.mohelIndicator?.eventCount ?? null,
            }
          : null,
      },
    };
    if (noRenderAssay) {
      browserFiringEvidence.noRenderAssayFailures = validateNoRenderAssayEvidence(browserFiringEvidence.noRenderAssay);
      lastTrustworthyEvidence = {
        ...lastTrustworthyEvidence,
        noRenderAssay: browserFiringEvidence.noRenderAssay,
        noRenderAssayFailures: browserFiringEvidence.noRenderAssayFailures,
      };
      if (browserFiringEvidence.noRenderAssayFailures.length) {
        throw new Error(`No-render assay evidence is incomplete or invalid: ${browserFiringEvidence.noRenderAssayFailures.join(', ')}`);
      }
    }
    if (captureInFlight && inFlightCapture.status !== 'captured') {
      throw new Error(`Friendly firing did not expose an effective hybrid frame for visual capture: ${JSON.stringify(inFlightCapture)}`);
    }
    if (!browserFiringEvidence.reportPath) throw new Error('Friendly firing did not expose its durable pipeline report path');
    if (!browserFiringEvidence.foregroundKilnHeartbeat) throw new Error('Friendly firing did not expose its foreground heartbeat summary');
    if (!browserFiringEvidence.sharpDutyCorrelation) throw new Error('Friendly firing did not expose its SHARP duty correlation summary');
    if (browserFiringEvidence.selectedFirePresentation !== requestedFirePresentation) {
      throw new Error(`Friendly firing did not retain the requested fire presentation: ${JSON.stringify(browserFiringEvidence)}`);
    }
    if (browserFiringEvidence.selectedFlameContinuity !== requestedFlameContinuity) {
      throw new Error(`Friendly firing did not retain the requested flame continuity: ${JSON.stringify(browserFiringEvidence)}`);
    }
    browserFiringEvidence.firePresentationFailures = noRenderAssay
      ? []
      : validateRequestedFirePresentation({
          requestedPresentation: requestedFirePresentation,
          requestedFlameContinuity,
          firingId: browserFiringEvidence.foregroundKilnHeartbeat.firingId,
          expected: browserFiringEvidence.foregroundKilnHeartbeat.expectedFirePresentation,
          effective: browserFiringEvidence.foregroundKilnHeartbeat.effectiveFirePresentation,
        });
    if (browserFiringEvidence.firePresentationFailures.length) {
      throw new Error(`Friendly firing did not prove the requested fire presentation: ${browserFiringEvidence.firePresentationFailures.join(', ')}`);
    }
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      postFiringSummary: {
        ...lastTrustworthyEvidence.postFiringSummary,
        firePresentationFailures: browserFiringEvidence.firePresentationFailures,
      },
    };
    browserFiringEvidence.foregroundKilnHeartbeat.samples = await readBrowserArrayInChunks({
      evaluateExpression: (expression, timeoutMs) => evaluate(ws, expression, timeoutMs),
      snapshotExpression: 'window.__kaminosCrucibleWitnessSnapshot',
      arrayKey: 'foregroundSamples',
      expectedCount: browserFiringEvidence.foregroundKilnHeartbeat.sampleCount,
      expectedIdentity: browserFiringEvidence.snapshotIdentity,
      timeoutMs: fireOperationTimeoutMs,
      label: 'foreground heartbeat samples',
    });
    browserFiringEvidence.foregroundKilnHeartbeat.hostEvents = await readBrowserArrayInChunks({
      evaluateExpression: (expression, timeoutMs) => evaluate(ws, expression, timeoutMs),
      snapshotExpression: 'window.__kaminosCrucibleWitnessSnapshot',
      arrayKey: 'hostEvents',
      expectedCount: browserFiringEvidence.foregroundKilnHeartbeat.hostEventCount,
      expectedIdentity: browserFiringEvidence.snapshotIdentity,
      timeoutMs: fireOperationTimeoutMs,
      label: 'foreground host events',
    });
    browserFiringEvidence.sharpDutyCorrelation.foregroundGaps = await readBrowserArrayInChunks({
      evaluateExpression: (expression, timeoutMs) => evaluate(ws, expression, timeoutMs),
      snapshotExpression: 'window.__kaminosCrucibleWitnessSnapshot',
      arrayKey: 'foregroundGaps',
      expectedCount: browserFiringEvidence.sharpDutyCorrelation.foregroundGapCount,
      expectedIdentity: browserFiringEvidence.snapshotIdentity,
      timeoutMs: fireOperationTimeoutMs,
      label: 'foreground SHARP duty correlation gaps',
    });
    if (browserFiringEvidence.kilnFrameStageLedger) {
      browserFiringEvidence.kilnFrameStageLedger.frames = await readBrowserArrayInChunks({
        evaluateExpression: (expression, timeoutMs) => evaluate(ws, expression, timeoutMs),
        snapshotExpression: 'window.__kaminosCrucibleWitnessSnapshot',
        arrayKey: 'kilnFrameStageFrames',
        expectedCount: browserFiringEvidence.kilnFrameStageLedger.mohelIndicator?.frameCount,
        expectedIdentity: browserFiringEvidence.snapshotIdentity,
        timeoutMs: fireOperationTimeoutMs,
        label: 'kiln frame stage ledger frames',
      });
      browserFiringEvidence.kilnFrameStageLedger.events = await readBrowserArrayInChunks({
        evaluateExpression: (expression, timeoutMs) => evaluate(ws, expression, timeoutMs),
        snapshotExpression: 'window.__kaminosCrucibleWitnessSnapshot',
        arrayKey: 'kilnFrameStageEvents',
        expectedCount: browserFiringEvidence.kilnFrameStageLedger.mohelIndicator?.eventCount,
        expectedIdentity: browserFiringEvidence.snapshotIdentity,
        timeoutMs: fireOperationTimeoutMs,
        label: 'kiln frame stage ledger events',
      });
    }
    const pipelineReport = JSON.parse(readFileSync(browserFiringEvidence.reportPath, 'utf8'));
    state.fullRoute = projectFriendlyFiringEvidence({
      browserFiringEvidence,
      pipelineReport,
    });
    state.fullRoute.hostGapCorrelation = correlateForegroundGapsWithHostEvents({
      firingId: state.fullRoute.foregroundKilnHeartbeat?.firingId,
      foregroundClock: state.fullRoute.foregroundKilnHeartbeat?.clock,
      hostTelemetry: state.fullRoute.foregroundKilnHeartbeat?.hostTelemetry,
      foregroundGaps: state.fullRoute.sharpDutyCorrelation?.foregroundGaps,
      hostEventRetention: state.fullRoute.foregroundKilnHeartbeat?.hostEventRetention,
      hostEventCount: state.fullRoute.foregroundKilnHeartbeat?.hostEventCount,
      hostEvents: state.fullRoute.foregroundKilnHeartbeat?.hostEvents,
    });
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, fullRoute: state.fullRoute };
    if (state.fullRoute.status !== 'complete') throw new Error(`Friendly firing failed: ${state.fullRoute.message || state.fullRoute.status}`);
    if (requireFrameStageLedger) {
      const ledger = state.fullRoute.kilnFrameStageLedger;
      const frameCount = ledger?.mohelIndicator?.frameCount;
      const eventCount = ledger?.mohelIndicator?.eventCount;
      const frameStages = new Set((ledger?.frames || []).flatMap(frame => (frame.stages || []).map(stage => stage.stage)));
      const requiredSharedStages = ['volume-raf', 'hybrid-splat-encode', 'hybrid-smoke-encode', 'hybrid-resolve-encode', 'queue-submit'];
      const ledgerFailures = [];
      if (ledger?.schema !== 'kaminos.kiln-frame-stage-ledger.v0') ledgerFailures.push('schema-missing');
      if (ledger?.status !== 'complete' || ledger?.evidenceStatus !== 'verified') ledgerFailures.push('ledger-not-verified');
      if (ledger?.sampleRetention !== 'uncapped') ledgerFailures.push('sample-retention-not-uncapped');
      if (ledger?.firingId !== state.fullRoute.foregroundKilnHeartbeat?.firingId) ledgerFailures.push('firingId-mismatch');
      if (ledger?.clock?.schema !== 'kaminos.browser-epoch-monotonic-clock.v0') ledgerFailures.push('epoch-clock-missing');
      if (!Number.isInteger(frameCount) || frameCount <= 0 || frameCount !== ledger?.frames?.length) ledgerFailures.push('frames-missing-or-partial');
      if (!Number.isInteger(eventCount) || eventCount <= 0 || eventCount !== ledger?.events?.length) ledgerFailures.push('events-missing-or-partial');
      if (ledger?.failures?.length) ledgerFailures.push(`ledger-failures:${ledger.failures.join('|')}`);
      if ((ledger?.pathCounts?.live || 0) <= 0) ledgerFailures.push('live-path-missing');
      if (requestedFlameContinuity === 'bounded-history-holdover' && (ledger?.pathCounts?.holdover || 0) <= 0) {
        ledgerFailures.push('holdover-path-missing');
      }
      for (const stage of requiredSharedStages) {
        if (!frameStages.has(stage)) ledgerFailures.push(`required-stage-missing:${stage}`);
      }
      if (!(ledger?.events || []).some(event => event?.stage === 'main-page-raf')) {
        ledgerFailures.push('main-page-raf-events-missing');
      }
      if (ledgerFailures.length) {
        throw new Error(`Friendly firing is missing its uncapped exact-firing kiln frame-stage ledger: ${ledgerFailures.join(', ')}`);
      }
    }
    if (expectedSharpRevision && state.fullRoute.effectiveSharpRevision !== expectedSharpRevision) {
      throw new Error(`Friendly firing used unexpected SHARP revision: ${state.fullRoute.effectiveSharpRevision}`);
    }
    for (const [field, requestedValue] of Object.entries(expectedScheduler)) {
      if (state.fullRoute.requestedScheduler?.[field] !== requestedValue
        || state.fullRoute.effectiveScheduler?.[field] !== requestedValue) {
        throw new Error(`Friendly firing did not preserve requested/effective scheduler field ${field}=${JSON.stringify(requestedValue)}: ${JSON.stringify({
          schedulerProfileId,
          requestedScheduler: state.fullRoute.requestedScheduler,
          effectiveScheduler: state.fullRoute.effectiveScheduler,
        })}`);
      }
    }
    const spnFusionTileFailures = validateSpnFusionTileEvidence({
      profileId: schedulerProfileId,
      expectedChunkItems: expectedScheduler.spnFusionChunkItems,
      fullRoute: state.fullRoute,
    });
    state.fullRoute.spnFusionTileFailures = spnFusionTileFailures;
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, fullRoute: state.fullRoute };
    if (spnFusionTileFailures.length) {
      throw new Error(`Friendly firing did not prove SPN fusion output tiling: ${spnFusionTileFailures.join(', ')}`);
    }
    const decoderKernelTileFailures = validateDecoderKernelTileEvidence({
      expectedChunkItems: expectedScheduler.decoderKernelChunkItems,
      expectedAdaptivePolicy: {
        minChunkItems: expectedScheduler.decoderKernelMinChunkItems,
        maxChunkItems: expectedScheduler.decoderKernelMaxChunkItems,
        targetDurationMs: expectedScheduler.decoderKernelTargetDurationMs,
        adjustmentGain: expectedScheduler.decoderKernelAdjustmentGain,
      },
      boundaryAssertions: state.fullRoute.schedulerBoundaryAssertions,
      tileEvents: state.fullRoute.decoderKernelTileEvents,
    });
    state.fullRoute.decoderKernelTileFailures = decoderKernelTileFailures;
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, fullRoute: state.fullRoute };
    if (decoderKernelTileFailures.length) {
      throw new Error(`Friendly firing did not prove decoder kernel output tiling: ${decoderKernelTileFailures.join(', ')}`);
    }
    if (state.fullRoute.routeTailCheckpointEvents?.prep < 6 || state.fullRoute.routeTailCheckpointEvents?.gaussian < 1) {
      throw new Error(`Friendly firing is missing prep or Gaussian route-tail checkpoints: ${JSON.stringify(state.fullRoute.routeTailCheckpointEvents)}`);
    }
    const backgroundHeartbeat = state.fullRoute.backgroundHeartbeat;
    if (backgroundHeartbeat?.schema !== 'sharp-webgpu.background-heartbeat.v0') throw new Error('Friendly firing is missing the corrected backgroundHeartbeat schema');
    if (!backgroundHeartbeat.inferenceWindow || !Number.isFinite(backgroundHeartbeat.inferenceWindow.durationMs)) throw new Error('Friendly firing is missing its measured inferenceWindow');
    if (!Array.isArray(backgroundHeartbeat.worstFrameGaps) || !backgroundHeartbeat.worstFrameGaps.length) throw new Error('Friendly firing is missing scoped worstFrameGaps');
    if (backgroundHeartbeat.crossPageClock?.schema !== 'kaminos.browser-epoch-monotonic-clock.v0') throw new Error('Friendly firing is missing the shared epoch clock');
    if (backgroundHeartbeat.gpuDutyIntervals?.schema !== 'sharp-webgpu.submitted-work-drain-intervals.v0'
      || backgroundHeartbeat.gpuDutyIntervals.runId !== backgroundHeartbeat.crossPageClock.runId
      || backgroundHeartbeat.gpuDutyIntervals.count !== backgroundHeartbeat.gpuDutyIntervals.intervals?.length
      || !backgroundHeartbeat.gpuDutyIntervals.intervals?.length) {
      throw new Error('Friendly firing is missing complete run-bound submitted-work duty intervals');
    }
    const foregroundKilnHeartbeat = state.fullRoute.foregroundKilnHeartbeat;
    if (foregroundKilnHeartbeat?.schema !== 'kaminos.foreground-kiln-heartbeat.v0'
      || foregroundKilnHeartbeat.status !== 'verified'
      || foregroundKilnHeartbeat.sampleRetention !== 'uncapped'
      || foregroundKilnHeartbeat.sampleCount !== foregroundKilnHeartbeat.samples?.length
      || foregroundKilnHeartbeat.hostEventRetention !== 'uncapped'
      || foregroundKilnHeartbeat.hostEventCount !== foregroundKilnHeartbeat.hostEvents?.length
      || foregroundKilnHeartbeat.hostTelemetry?.schema !== 'kaminos.foreground-host-telemetry.v0'
      || foregroundKilnHeartbeat.hostTelemetry.status !== 'complete'
      || foregroundKilnHeartbeat.hostTelemetry.longTaskSource?.status !== 'complete') {
      throw new Error('Friendly firing is missing an uncapped verified foreground firing heartbeat');
    }
    const sharpDutyCorrelation = state.fullRoute.sharpDutyCorrelation;
    if (sharpDutyCorrelation?.schema !== 'kaminos.foreground-sharp-duty-correlation.v0'
      || sharpDutyCorrelation.status !== 'verified'
      || sharpDutyCorrelation.runId !== backgroundHeartbeat.crossPageClock.runId
      || sharpDutyCorrelation.foregroundGapCount !== sharpDutyCorrelation.foregroundGaps?.length
      || !Array.isArray(sharpDutyCorrelation.phaseRankings)
      || !Array.isArray(sharpDutyCorrelation.boundaryRankings)) {
      throw new Error('Friendly firing is missing its verified foreground-to-model duty correlation');
    }
    const correlationTotals = sharpDutyCorrelation.totals || {};
    if (![correlationTotals.foregroundGapDurationMs, correlationTotals.attributedDurationMs, correlationTotals.unattributedDurationMs].every(Number.isFinite)
      || Math.abs(correlationTotals.foregroundGapDurationMs
        - correlationTotals.attributedDurationMs
        - correlationTotals.unattributedDurationMs) > 1) {
      throw new Error('Friendly firing correlation does not preserve its unattributed foreground remainder');
    }
    if (state.fullRoute.hostGapCorrelation?.status !== 'verified'
      || state.fullRoute.hostGapCorrelation.foregroundGapCount !== sharpDutyCorrelation.foregroundGapCount) {
      throw new Error(`Friendly firing is missing complete foreground host-event correlation: ${JSON.stringify(state.fullRoute.hostGapCorrelation)}`);
    }
    const expectedLateTailSteps = ['ply-blob-assembly', 'object-url-create', 'output-bind'];
    for (const step of expectedLateTailSteps) {
      const interval = state.fullRoute.lateTailBlockingIntervals?.find(candidate => candidate.step === step);
      if (!interval || !Number.isFinite(interval.intervalStartMs) || !Number.isFinite(interval.intervalEndMs) || !Number.isFinite(interval.durationMs)) {
        throw new Error(`Friendly firing is missing ${step} blocking interval evidence: ${JSON.stringify(state.fullRoute.lateTailBlockingIntervals)}`);
      }
    }
    if (!state.fullRoute.gaussianCpuDutyIntervals?.length || state.fullRoute.gaussianCpuDutyIntervals.some(interval =>
      interval.granularity !== 'row-batched'
      || !Number.isFinite(interval.segmentStartProcessedItems)
      || !Number.isFinite(interval.segmentEndProcessedItems)
      || interval.segmentEndProcessedItems <= interval.segmentStartProcessedItems
      || !Number.isFinite(interval.intervalStartMs)
      || !Number.isFinite(interval.intervalEndMs)
    )) {
      throw new Error(`Friendly firing is missing truthful row-batched Gaussian CPU intervals: ${JSON.stringify(state.fullRoute.gaussianCpuDutyIntervals)}`);
    }
    const composePreparationSteps = new Set(state.fullRoute.composePreparationIntervals?.map(interval => interval.step) || []);
    if (composePreparationSteps.size !== 6 || [...['depth-normalize', 'depth-min', 'depth-rescale', 'base-disparity', 'base-grid', 'base-color']].some(step => !composePreparationSteps.has(step))) {
      throw new Error(`Friendly firing is missing bounded compose preparation intervals: ${JSON.stringify(state.fullRoute.composePreparationIntervals)}`);
    }
    const allocation = state.fullRoute.preGaussianSetupIntervals?.find(interval => interval.step === 'ply-data-allocation');
    const activationSetup = state.fullRoute.preGaussianSetupIntervals?.find(interval => interval.step === 'gaussian-activation-setup');
    if (!allocation || !Number.isFinite(allocation.intervalStartMs) || !Number.isFinite(allocation.intervalEndMs) || !(allocation.bytes > 0)) {
      throw new Error(`Friendly firing is missing measured PLY allocation bytes: ${JSON.stringify(allocation)}`);
    }
    if (!activationSetup || !Number.isFinite(activationSetup.intervalStartMs) || !Number.isFinite(activationSetup.intervalEndMs)) {
      throw new Error(`Friendly firing is missing Gaussian activation setup interval: ${JSON.stringify(activationSetup)}`);
    }
    const finalizeInterval = state.fullRoute.inferenceWindowFinalizeInterval;
    if (!finalizeInterval || finalizeInterval.role !== 'localization-envelope'
      || !Number.isFinite(finalizeInterval.intervalStartMs) || !Number.isFinite(finalizeInterval.intervalEndMs)) {
      throw new Error(`Friendly firing is missing its non-causal inference finalization envelope: ${JSON.stringify(finalizeInterval)}`);
    }
    const cadenceFailures = [];
    if (state.fullRoute.maxGaussianDutyMs >= 50) {
      cadenceFailures.push({
        kind: 'gaussian-cpu-duty-at-or-above-50ms',
        durationMs: state.fullRoute.maxGaussianDutyMs,
      });
    }
    for (const gap of state.fullRoute.uninstrumentedGapsAtOrAbove50Ms || []) {
      cadenceFailures.push({ kind: 'uninstrumented-frame-gap', ...gap });
    }
    state.fullRoute.cadenceAcceptance = classifyCadenceAcceptance({
      captureInFlight,
      diagnoseCadenceFailures,
      failures: cadenceFailures,
    });
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, fullRoute: state.fullRoute };
    if (state.fullRoute.cadenceAcceptance.blocking) {
      throw new Error(`Friendly firing failed strict cadence acceptance: ${JSON.stringify(state.fullRoute.cadenceAcceptance.failures)}`);
    }
    if (!state.fullRoute.output?.sha256 || state.fullRoute.output.status !== 'real') throw new Error('Friendly firing did not preserve a real hashed output');
    const volumeReleaseFailures = validateVolumeReleaseEvidence(state.fullRoute);
    if (volumeReleaseFailures.length) {
      throw new Error(`Friendly firing did not confirm furnace release: ${volumeReleaseFailures.join(', ')}`);
    }
    phase = 'returning-to-completed-crucible';
    await evaluate(ws, openGenerateTabExpression);
    await sleep(900);
    state.fullRoute.completedWorkroom = await evaluate(ws, `(() => {
      const workspace = document.getElementById('crucible-viewport-workspace');
      const stage = document.getElementById('crucible-worktable-stage');
      const sidebar = document.getElementById('sidebar');
      const transformBar = document.getElementById('transform-bar');
      const stageRect = stage?.getBoundingClientRect();
      const workspaceRect = workspace?.getBoundingClientRect();
      const transformBarRect = transformBar?.getBoundingClientRect();
      const debug = window.kaminosCrucibleViewportDebugState?.() || null;
      return {
        heatState: workspace?.dataset.crucibleHeatState || null,
        routeStatus: workspace?.dataset.crucibleRouteStatus || null,
        roomPosture: workspace?.dataset.crucibleRoomPosture || null,
        consoleState: workspace?.dataset.crucibleConsoleState || null,
        stageTop: stageRect?.top ?? null,
        stageRight: stageRect?.right ?? null,
        viewportWidth: window.innerWidth,
        caddyOccupancy: stageRect && workspaceRect?.width ? stageRect.width / workspaceRect.width : null,
        transformBarBottom: transformBar?.classList.contains('visible') ? (transformBarRect?.bottom ?? null) : 0,
        castButtonDisabled: Boolean(document.getElementById('crucible-viewport-cast-button')?.disabled),
        cast: document.getElementById('crucible-viewport-cast')?.textContent || null,
        receipt: document.getElementById('crucible-viewport-receipt')?.textContent || null,
        tuckedSidebarWidth: sidebar?.getBoundingClientRect().width ?? null,
        sceneViewportWidth: document.getElementById('viewport')?.getBoundingClientRect().width ?? null,
        sceneCanvasWidth: document.querySelector('#viewport > canvas')?.getBoundingClientRect().width ?? null,
        castScreenX: debug?.castScreenPoint?.screenX ?? null,
      };
    })()`);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, completedWorkroom: state.fullRoute.completedWorkroom };
    if (state.fullRoute.completedWorkroom.castButtonDisabled) throw new Error('Completed real cast is not actuatable from the Crucible tray');
    if (state.fullRoute.completedWorkroom.roomPosture !== 'cast-held') throw new Error(`Completed real cast did not open the room around the asset: ${JSON.stringify(state.fullRoute.completedWorkroom)}`);
    if (state.fullRoute.completedWorkroom.consoleState !== 'tucked') throw new Error(`Completed real cast did not tuck the kiln caddy: ${JSON.stringify(state.fullRoute.completedWorkroom)}`);
    if (state.fullRoute.completedWorkroom.tuckedSidebarWidth > 1) throw new Error(`Completed Crucible left the legacy sidebar in the cast workspace: ${JSON.stringify(state.fullRoute.completedWorkroom)}`);
    if (Math.abs(state.fullRoute.completedWorkroom.sceneCanvasWidth - state.fullRoute.completedWorkroom.sceneViewportWidth) > 2) throw new Error(`Completed Crucible renderer retained stale viewport width: ${JSON.stringify(state.fullRoute.completedWorkroom)}`);
    if (!Number.isFinite(state.fullRoute.completedWorkroom.caddyOccupancy)
      || state.fullRoute.completedWorkroom.caddyOccupancy > 0.4) throw new Error(`Completed Crucible caddy obscures the primary scene field: ${JSON.stringify(state.fullRoute.completedWorkroom)}`);
    if (!Number.isFinite(state.fullRoute.completedWorkroom.castScreenX)
      || state.fullRoute.completedWorkroom.castScreenX < state.fullRoute.completedWorkroom.stageRight + 24) throw new Error(`Completed Crucible cast remains behind the caddy: ${JSON.stringify(state.fullRoute.completedWorkroom)}`);
    if (state.fullRoute.completedWorkroom.stageTop < state.fullRoute.completedWorkroom.transformBarBottom + 8) throw new Error(`Completed Crucible console overlaps the scene toolbar: ${JSON.stringify(state.fullRoute.completedWorkroom)}`);
  }

  phase = 'capturing-screenshot';
  const png = await captureViewportPng(ws, out);
  primaryOutputWritten = true;

  successfulReportPayload = {
    ok: true,
    state,
    bytes: png.length,
    runtimeExceptions,
    stderrTail: stderr.slice(-1000),
  };
  terminalSummary = compactWitnessSummary({ state, out, inFlightCapture, reportPath });
} catch (error) {
  terminalFailure = { error, phase };
}

await cleanupBrowserResources();
if (browserCleanup.errors.length && !terminalFailure) {
  terminalFailure = {
    error: new Error(`Browser cleanup failed: ${browserCleanup.errors.join('; ')}`),
    phase: 'cleaning-up-browser',
  };
}

if (terminalFailure) {
  phase = terminalFailure.phase;
  writeReport({
    ok: false,
    error: terminalFailure.error.message || String(terminalFailure.error),
    lastTrustworthyEvidence,
    runtimeExceptions,
    stderrTail: stderr.slice(-1000),
  });
  console.error(
    terminalFailure.error.stack
    || terminalFailure.error.message
    || String(terminalFailure.error),
  );
  process.exitCode = 1;
} else {
  phase = 'writing-report';
  writeReport(successfulReportPayload);
  console.log(JSON.stringify(terminalSummary, null, 2));
}
