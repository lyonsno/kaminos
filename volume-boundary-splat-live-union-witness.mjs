#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = 'kaminos.boundary-splat.live-union-occupancy.v0';
const SUPPORT_IDENTITY = 'full-flame-ridge-nonridge-live-union-v0';
const WITNESS_IDENTITY = 'boundary-splat-live-union-occupancy-witness-v0';
const SAMPLE_API = 'sampleBoundarySplatLiveUnionOccupancy';
const EXPECTED_ROUTE = 'exact-basin-selective-head-live-v0';
const EXPECTED_INNER_RENDERER = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_COMPOSITION = 'splat-only-v0';
const EXPECTED_BACKEND = 'WebGPU:apple';
const BROWSER_CONTINUITY_MODES = new Set([
  'continuous-existing',
  'reseated-after-original-process-disappeared',
  'fresh-greenroom-browser',
  'measurement-owned-browser',
  'unverified-existing',
]);
const REQUIRED_LAYER_KEYS = ['ridgeOnly', 'nonRidgeOnly', 'overlap', 'union'];
const REQUIRED_TIMING_KEYS = ['selectorGpuMs', 'splatRasterGpuMs'];
const REQUIRED_WORK_KEYS = ['projectedFootprintPixels', 'meanDepthComplexity', 'peakDepthComplexity'];
const REQUIRED_MEMORY_KEYS = ['candidateBufferBytes', 'peakGpuBufferBytes'];
const REQUIRED_IDENTITY_KEYS = ['routeIdentity', 'supportIdentity', 'coefficientIdentity', 'covarianceIdentity'];

const args = parseArgs(process.argv.slice(2));
const requestedRoute = String(args.get('--url') || '');
const expectedIntegrationHead = String(args.get('--expected-integration-head') || '').trim();
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-live-union-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/live-union-occupancy-report.json`));
const chromePort = Math.max(1, Math.floor(Number(args.get('--chrome-port') || args.get('--debug-port') || 19457)));
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2000));
const browserContinuity = String(args.get('--browser-continuity') || 'unverified-existing');
const requestedBrowserProfilePath = String(args.get('--browser-profile') || args.get('--user-data-dir') || '');
const windowSize = String(args.get('--window-size') || '1600,1000');
const runStartedAt = new Date().toISOString();

let ws = null;
let browserPageId = null;
let browserPageUrl = null;
let browserVersion = null;
let browserProcessIdentity = null;
let failurePhase = 'startup';
const lastTrustworthyEvidence = {};

try {
  if (!requestedRoute) throw new Error('missing --url');
  if (!expectedIntegrationHead) throw new Error('missing-expected-integration-head');
  if (!/^[0-9a-f]{7,40}$/i.test(expectedIntegrationHead)) {
    throw new Error(`invalid-expected-integration-head:${JSON.stringify(expectedIntegrationHead)}`);
  }
  if (!BROWSER_CONTINUITY_MODES.has(browserContinuity)) {
    throw new Error(`invalid --browser-continuity ${JSON.stringify(browserContinuity)}`);
  }

  mkdirSync(outDir, { recursive: true });
  failurePhase = 'connect-existing-browser';
  browserProcessIdentity = discoverBrowserProcessIdentity(chromePort);
  if (
    requestedBrowserProfilePath
    && browserProcessIdentity.browserProfilePath
    && resolve(requestedBrowserProfilePath) !== resolve(browserProcessIdentity.browserProfilePath)
  ) {
    throw new Error(`browser-profile-disagreement:${JSON.stringify({
      requested: requestedBrowserProfilePath,
      effective: browserProcessIdentity.browserProfilePath,
    })}`);
  }
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
  const effectivePageUrl = await evaluate('location.href');
  browserPageUrl = effectivePageUrl;
  lastTrustworthyEvidence.effectivePageUrl = effectivePageUrl;

  failurePhase = 'runtime-identity';
  const initialState = await debugState();
  lastTrustworthyEvidence.initialState = compactState(initialState);
  validateInitialState(initialState);

  failurePhase = 'integration-consumer-head';
  const boundarySplatLiveUnionConsumerHead = String(
    initialState?.boundarySplatLiveUnionConsumerHead
    ?? await evaluate('window.__kaminosVolumePrototype?.boundarySplatLiveUnionConsumerHead ?? null'),
  );
  lastTrustworthyEvidence.boundarySplatLiveUnionConsumerHead = boundarySplatLiveUnionConsumerHead;
  if (boundarySplatLiveUnionConsumerHead !== expectedIntegrationHead) {
    throw new Error(`stale-integration-consumer-head:${JSON.stringify({
      expectedIntegrationHead,
      boundarySplatLiveUnionConsumerHead,
    })}`);
  }

  failurePhase = 'live-union-api-presence';
  const apiPresent = await evaluate(`typeof window.__kaminosVolumePrototype?.${SAMPLE_API} === 'function'`);
  if (apiPresent !== true) {
    throw new Error(`missing-live-union-occupancy-api:${SAMPLE_API}`);
  }

  failurePhase = 'live-union-occupancy-sample';
  const sample = await evaluate(`window.__kaminosVolumePrototype.${SAMPLE_API}(${JSON.stringify({
    expectedIntegrationHead,
    supportIdentity: SUPPORT_IDENTITY,
    requestedCandidateBudget: 'uncapped',
    requireUncapped: true,
    includeRidgeOnly: true,
    includeNonRidgeOnly: true,
    includeOverlap: true,
    includeUnion: true,
    includeGpuTiming: true,
    includeProjectedWork: true,
    includeMemory: true,
    includeRouteIdentity: true,
    windowSize,
  })})`, true);
  lastTrustworthyEvidence.sample = compactSample(sample);

  failurePhase = 'live-union-false-closure-validation';
  const validation = validateSample(sample, initialState);
  const finalState = await debugState();
  lastTrustworthyEvidence.finalState = compactState(finalState);

  const report = {
    schema: SCHEMA,
    witnessIdentity: WITNESS_IDENTITY,
    status: 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectivePageUrl,
    expectedIntegrationHead,
    boundarySplatLiveUnionConsumerHead,
    supportIdentity: SUPPORT_IDENTITY,
    browser: browserReport('preserved-open'),
    routeIdentity: sample.routeIdentity,
    support: sample.support ?? null,
    layerCounts: validation.layerCounts,
    budgets: validation.budgets,
    timings: validation.timings,
    projectedWork: validation.projectedWork,
    memory: validation.memory,
    overdraw: validation.overdraw,
    identities: validation.identities,
    diagnostics: validation.diagnostics,
    initialState: compactState(initialState),
    finalState: compactState(finalState),
    lastTrustworthyEvidence,
    falseClosureChecks: validation.falseClosureChecks,
    claimBoundary: 'Uncapped live Ridge/Non-Ridge/overlap/union occupancy and cost witness for the exact pushed Integration consumer head only. This does not choose a pruning, merge, learned allocator, coefficient, covariance, radiance, or support policy.',
  };
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const failure = {
    schema: SCHEMA,
    witnessIdentity: WITNESS_IDENTITY,
    status: 'failed-before-primary-output',
    failurePhase,
    runStartedAt,
    failedAt: new Date().toISOString(),
    requestedRoute,
    expectedIntegrationHead: expectedIntegrationHead || null,
    supportIdentity: SUPPORT_IDENTITY,
    browser: browserReport('target-unreachable-or-unobserved'),
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
    falseClosureChecks: {
      fallbackRoute: String(error?.message || error).includes('fallbackRoute'),
      overflowOrCopy: String(error?.message || error).includes('overflowOrCopy'),
      blankOrPartialReport: String(error?.message || error).includes('blankOrPartialReport'),
      staleIntegrationConsumerHead: String(error?.message || error).includes('stale-integration-consumer-head'),
      hiddenCapInstalled: String(error?.message || error).includes('hiddenCapInstalled'),
      unionCountMismatch: String(error?.message || error).includes('unionCountMismatch'),
    },
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

function browserReport(disposition) {
  return {
    identity: 'boundary-splat-live-union-single-cdp-browser-v0',
    mode: 'connected-existing',
    port: chromePort,
    version: browserVersion,
    pageId: browserPageId,
    pageUrl: browserPageUrl,
    browserContinuity,
    browserProcessId: browserProcessIdentity?.browserProcessId ?? null,
    browserProfilePath: browserProcessIdentity?.browserProfilePath ?? null,
    browserProfileAuthority: browserProcessIdentity?.authority ?? null,
    requestedBrowserProfilePath: requestedBrowserProfilePath || null,
    windowSize,
    disposition,
  };
}

function discoverBrowserProcessIdentity(port) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n');
  const marker = `--remote-debugging-port=${port}`;
  const parent = rows
    .map(row => row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map(match => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }))
    .find(process => process.command.includes(marker)
      && process.command.includes('Google Chrome')
      && !process.command.includes('--type='));
  if (!parent) throw new Error(`browser-process-not-found-for-cdp-port:${port}`);
  const profileMatch = parent.command.match(/--user-data-dir=(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return {
    browserProcessId: parent.pid,
    browserParentProcessId: parent.ppid,
    browserProfilePath: profileMatch?.[1] || profileMatch?.[2] || profileMatch?.[3] || null,
    chromePort: port,
    authority: 'effective-os-process-command-line',
  };
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${chromePort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function findPage() {
  const pages = await cdpFetch('/json/list');
  const page = pages.find(target => target.type === 'page' && target.url === requestedRoute)
    || pages.find(target => target.type === 'page' && target.url.includes('/volume-settings-preset.html'))
    || pages.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('existing Chrome has no targetable page');
  return page;
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
      rejectRequest(new Error(`${method}: WebSocket closed before CDP response ${id}`));
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
  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${result.exceptionDetails.text || 'unknown exception'}`);
  }
  return result.result.value;
}

async function waitForPrototype() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await evaluate('window.__kaminosVolumePrototype?.debugState?.()');
    if (state?.active && state?.backend) return state;
    await delay(125);
  }
  throw new Error('volume prototype did not become active');
}

async function debugState() {
  return evaluate('window.__kaminosVolumePrototype?.debugState?.()');
}

function validateInitialState(state) {
  const mismatches = [];
  if (state?.active !== true) mismatches.push(['active', true, state?.active]);
  if (state?.backend !== EXPECTED_BACKEND) mismatches.push(['backend', EXPECTED_BACKEND, state?.backend]);
  if (state?.effectiveRoute !== EXPECTED_ROUTE) mismatches.push(['effectiveRoute', EXPECTED_ROUTE, state?.effectiveRoute]);
  if (state?.requestedRoute && state.requestedRoute !== EXPECTED_ROUTE) mismatches.push(['requestedRoute', EXPECTED_ROUTE, state.requestedRoute]);
  if (state?.innerRendererIdentity && state.innerRendererIdentity !== EXPECTED_INNER_RENDERER) {
    mismatches.push(['innerRendererIdentity', EXPECTED_INNER_RENDERER, state.innerRendererIdentity]);
  }
  if (state?.boundarySplatCompositionIdentity && state.boundarySplatCompositionIdentity !== EXPECTED_COMPOSITION) {
    mismatches.push(['compositionIdentity', EXPECTED_COMPOSITION, state.boundarySplatCompositionIdentity]);
  }
  if (state?.boundarySplatFallbackReason != null || state?.fallbackReason != null) {
    mismatches.push(['fallbackRoute', null, state?.boundarySplatFallbackReason ?? state?.fallbackReason]);
  }
  if (mismatches.length) throw new Error(`stale-or-default-route-model:${JSON.stringify(mismatches)}`);
}

function validateSample(sample, initialState) {
  if (!sample || typeof sample !== 'object') throw new Error('blankOrPartialReport: sample missing');
  if (sample.ok !== true) throw new Error(`blankOrPartialReport: sample rejected ${JSON.stringify(sample)}`);
  if (sample.schema && sample.schema !== SCHEMA) throw new Error(`wrong-schema:${sample.schema}`);
  if (sample.supportIdentity !== SUPPORT_IDENTITY) {
    throw new Error(`support-identity-mismatch:${JSON.stringify({ expected: SUPPORT_IDENTITY, actual: sample.supportIdentity })}`);
  }
  if (sample.boundarySplatLiveUnionConsumerHead !== expectedIntegrationHead) {
    throw new Error(`stale-integration-consumer-head:${JSON.stringify({
      expectedIntegrationHead,
      boundarySplatLiveUnionConsumerHead: sample.boundarySplatLiveUnionConsumerHead,
    })}`);
  }

  const layerCounts = sample.layerCounts ?? sample.counts ?? {};
  for (const key of REQUIRED_LAYER_KEYS) requireFiniteInteger(layerCounts[key], `layerCounts.${key}`);
  if (layerCounts.union !== layerCounts.ridgeOnly + layerCounts.nonRidgeOnly - layerCounts.overlap) {
    throw new Error(`unionCountMismatch:${JSON.stringify(layerCounts)}`);
  }

  const requestedCandidateBudget = sample.requestedCandidateBudget ?? sample.budgets?.requestedCandidateBudget ?? 'uncapped';
  const effectiveCandidateBudget = sample.effectiveCandidateBudget ?? sample.budgets?.effectiveCandidateBudget ?? layerCounts.union;
  const hiddenCapInstalled = Boolean(sample.hiddenCapInstalled)
    || (requestedCandidateBudget !== 'uncapped' && requestedCandidateBudget !== 0 && requestedCandidateBudget !== null)
    || Number(effectiveCandidateBudget) !== Number(layerCounts.union);
  if (hiddenCapInstalled) {
    throw new Error(`hiddenCapInstalled:${JSON.stringify({ requestedCandidateBudget, effectiveCandidateBudget, union: layerCounts.union })}`);
  }

  const timings = sample.timings ?? sample.cost ?? {};
  for (const key of REQUIRED_TIMING_KEYS) requireFiniteNumber(timings[key], `timings.${key}`);
  const projectedWork = sample.projectedWork ?? sample.overdraw ?? {};
  for (const key of REQUIRED_WORK_KEYS) requireFiniteNumber(projectedWork[key], `projectedWork.${key}`);
  const memory = sample.memory ?? {};
  for (const key of REQUIRED_MEMORY_KEYS) requireFiniteNumber(memory[key], `memory.${key}`);

  const identities = {
    routeIdentity: sample.routeIdentity,
    supportIdentity: sample.supportIdentity,
    coefficientIdentity: sample.coefficientIdentity ?? sample.identities?.coefficientIdentity,
    covarianceIdentity: sample.covarianceIdentity ?? sample.identities?.covarianceIdentity,
    modelIdentity: sample.modelIdentity ?? sample.identities?.modelIdentity ?? initialState?.boundarySplatAttributeModelIdentity ?? null,
    boundarySplatLiveUnionConsumerHead: sample.boundarySplatLiveUnionConsumerHead,
  };
  for (const key of REQUIRED_IDENTITY_KEYS) {
    if (!identities[key]) throw new Error(`missing-identity:${key}`);
  }

  const fallbackRoute = Boolean(sample.fallbackRoute)
    || sample.fallbackReason != null
    || sample.boundarySplatFallbackReason != null
    || sample.routeIdentity?.fallback === true;
  const overflowOrCopy = Boolean(sample.overflowOrCopy)
    || Number(sample.overflowCount ?? sample.boundarySplatOverflowCount ?? 0) > 0
    || Number(sample.copyBytes ?? sample.boundarySplatCopyBytesThisFrame ?? 0) > 0
    || sample.copyDisposition?.copied === true;
  const blankOrPartialReport = !sample.timings || !sample.projectedWork || !sample.memory || !sample.routeIdentity;
  if (fallbackRoute) throw new Error(`fallbackRoute:${JSON.stringify(sample.fallbackReason ?? sample.boundarySplatFallbackReason ?? sample.routeIdentity)}`);
  if (overflowOrCopy) {
    throw new Error(`overflowOrCopy:${JSON.stringify({
      overflowCount: sample.overflowCount ?? sample.boundarySplatOverflowCount ?? null,
      copyBytes: sample.copyBytes ?? sample.boundarySplatCopyBytesThisFrame ?? null,
      copyDisposition: sample.copyDisposition ?? null,
    })}`);
  }
  if (blankOrPartialReport) throw new Error('blankOrPartialReport: missing timing/projected/memory/route evidence');

  return {
    layerCounts,
    budgets: {
      requestedCandidateBudget,
      effectiveCandidateBudget,
      hiddenCapInstalled: false,
    },
    timings,
    projectedWork,
    memory,
    overdraw: {
      projectedFootprintPixels: projectedWork.projectedFootprintPixels,
      meanDepthComplexity: projectedWork.meanDepthComplexity,
      peakDepthComplexity: projectedWork.peakDepthComplexity,
      totalSplatPixelWork: projectedWork.totalSplatPixelWork ?? sample.totalSplatPixelWork ?? null,
    },
    identities,
    diagnostics: {
      overflowCount: sample.overflowCount ?? sample.boundarySplatOverflowCount ?? 0,
      copyBytes: sample.copyBytes ?? sample.boundarySplatCopyBytesThisFrame ?? 0,
      fallbackReason: sample.fallbackReason ?? sample.boundarySplatFallbackReason ?? null,
      timestampAuthority: sample.timestampAuthority ?? null,
      countAuthority: sample.countAuthority ?? null,
    },
    falseClosureChecks: {
      fallbackRoute: false,
      overflowOrCopy: false,
      blankOrPartialReport: false,
      staleIntegrationConsumerHead: false,
      hiddenCapInstalled: false,
      unionCountMismatch: false,
    },
  };
}

function requireFiniteInteger(value, label) {
  assert.ok(Number.isInteger(Number(value)), `blankOrPartialReport: ${label} is not an integer`);
  assert.ok(Number(value) >= 0, `blankOrPartialReport: ${label} is negative`);
}

function requireFiniteNumber(value, label) {
  assert.ok(Number.isFinite(Number(value)), `blankOrPartialReport: ${label} is not finite`);
}

function compactState(state) {
  return {
    active: state?.active,
    backend: state?.backend,
    requestedRoute: state?.requestedRoute,
    effectiveRoute: state?.effectiveRoute,
    innerRendererIdentity: state?.innerRendererIdentity,
    frameCount: state?.frameCount,
    simStepCount: state?.simStepCount,
    boundarySplatLiveUnionConsumerHead: state?.boundarySplatLiveUnionConsumerHead,
    rendererIdentity: state?.boundarySplatRendererIdentity,
    modelIdentity: state?.boundarySplatAttributeModelIdentity,
    sourceAuthority: state?.boundarySplatSourceAuthority,
    compositionIdentity: state?.boundarySplatCompositionIdentity,
    requestedCandidateBudget: state?.boundarySplatRequestedCandidateBudget,
    effectiveCandidateBudget: state?.boundarySplatEffectiveCandidateBudget,
    sourceCandidateCount: state?.boundarySplatSourceCandidateCount,
    selectedCandidateCount: state?.boundarySplatSelectedCandidateCount,
    overflowCount: state?.boundarySplatOverflowCount,
    candidateCopyBytes: state?.boundarySplatCopyBytesThisFrame,
    fallbackReason: state?.boundarySplatFallbackReason,
  };
}

function compactSample(sample) {
  if (!sample || typeof sample !== 'object') return sample ?? null;
  return {
    ok: sample.ok,
    schema: sample.schema,
    boundarySplatLiveUnionConsumerHead: sample.boundarySplatLiveUnionConsumerHead,
    supportIdentity: sample.supportIdentity,
    layerCounts: sample.layerCounts ?? sample.counts ?? null,
    requestedCandidateBudget: sample.requestedCandidateBudget ?? sample.budgets?.requestedCandidateBudget ?? null,
    effectiveCandidateBudget: sample.effectiveCandidateBudget ?? sample.budgets?.effectiveCandidateBudget ?? null,
    hiddenCapInstalled: sample.hiddenCapInstalled ?? null,
    timings: sample.timings ?? sample.cost ?? null,
    projectedWork: sample.projectedWork ?? sample.overdraw ?? null,
    memory: sample.memory ?? null,
    routeIdentity: sample.routeIdentity ?? null,
    coefficientIdentity: sample.coefficientIdentity ?? sample.identities?.coefficientIdentity ?? null,
    covarianceIdentity: sample.covarianceIdentity ?? sample.identities?.covarianceIdentity ?? null,
    modelIdentity: sample.modelIdentity ?? sample.identities?.modelIdentity ?? null,
    fallbackReason: sample.fallbackReason ?? sample.boundarySplatFallbackReason ?? null,
    overflowCount: sample.overflowCount ?? sample.boundarySplatOverflowCount ?? null,
    copyBytes: sample.copyBytes ?? sample.boundarySplatCopyBytesThisFrame ?? null,
  };
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
