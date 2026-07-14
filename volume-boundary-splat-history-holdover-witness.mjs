#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { measureBoundarySplatTemporalFrame } from './boundary-splat-temporal-collapse.mjs';

const SCHEMA = 'kaminos.volume.boundary-splat-history-holdover-witness.v0';
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const RENDERER = 'live-boundary-sidecar-learned-attribute-splats-v0';
const MODEL = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const SOURCE = 'live-baked-sidecar-plus-fluid-material-v0';
const COMPOSITION = 'boundary-splat-composed-field-v0';
const PBR_SCENE = 'boundary-splat-pbr-fire-field-v0';
const BUFFER_INTEGRITY = 'boundary-splat-buffer-integrity-v0';
const PHYSICAL_COMMAND_AUTHORITY = 'gpu-indirect-command-buffer-post-submit-readback-v0';

const args = parseArgs(process.argv.slice(2));
const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-history-holdover-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/history-holdover-report.json`));
const port = Number(args.get('--chrome-port') || 19431);
const settleMs = Number(args.get('--settle-ms') ?? 3000);
const holdoverFrames = Number(args.get('--holdover-frames') ?? 4);
const minimumSourceAgeGenerations = Number(args.get('--minimum-source-age-generations') ?? 16);
const requestedBrowserProfilePath = resolve(String(
  args.get('--browser-profile') || `${outDir}/chrome-profile`,
));
const runStartedAt = new Date().toISOString();

let ws = null;
let browser = null;
let browserPageId = null;
let browserPageUrl = null;
let failurePhase = 'startup';
const lastTrustworthyEvidence = {};

mkdirSync(outDir, { recursive: true });

try {
  if (!requestedRoute) throw new Error('missing --url');
  requirePositiveInteger(port, '--chrome-port');
  requireNonnegativeNumber(settleMs, '--settle-ms');
  requirePositiveInteger(holdoverFrames, '--holdover-frames');
  requireNonnegativeInteger(minimumSourceAgeGenerations, '--minimum-source-age-generations');

  failurePhase = 'browser-seat';
  browser = await existingBrowserSeat();
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
  if (visibilityState !== 'visible') throw new Error(`holdover-page-not-visible:${visibilityState}`);

  failurePhase = 'route-authority';
  const initialState = await waitForTelemetry();
  const effectivePageUrl = await evaluate('location.href');
  validateEffectiveState(initialState, effectivePageUrl);
  const requestedEffectiveRouteAgreement = requestedRouteAgrees(requestedRoute, effectivePageUrl);
  if (!requestedEffectiveRouteAgreement) {
    throw new Error(`requested-effective-route-mismatch:${JSON.stringify({ requestedRoute, effectivePageUrl })}`);
  }
  browserPageUrl = effectivePageUrl;
  lastTrustworthyEvidence.initialState = compactState(initialState);
  lastTrustworthyEvidence.effectivePageUrl = effectivePageUrl;
  lastTrustworthyEvidence.requestedEffectiveRouteAgreement = true;

  failurePhase = 'history-prime';
  const historyDepth = Number(initialState.boundarySplatHistoryDepth);
  const historyWindowGenerations = (
    (historyDepth - 1)
    * Number(initialState.boundarySplatHistoryFrameStride)
  ) + 1;
  const historyPrime = await evaluate(`window.__kaminosVolumePrototype.primeBoundarySplatLiveHistory(${JSON.stringify({
    minimumHistoryFrames: Number(initialState.frameCount) + historyWindowGenerations + historyDepth,
  })})`, true);
  if (
    historyPrime?.ok !== true
    || historyPrime?.simulatorCount !== 1
    || Number(historyPrime?.simStepsAdvanced) < historyWindowGenerations
    || historyPrime?.fallbackReason != null
    || Number(historyPrime?.candidateCopyBytes) !== 0
  ) {
    throw new Error(`history-prime-authority-failed:${JSON.stringify(historyPrime)}`);
  }
  lastTrustworthyEvidence.historyPrime = historyPrime;

  failurePhase = 'freeze-before-selection';
  const freezeProbe = await evaluate(`window.__kaminosVolumePrototype.renderBoundarySplatHistorySlotToCanvas(${JSON.stringify({
    slotIndex: -1,
    resumeRenderLoop: false,
  })})`, true);
  if (
    freezeProbe?.ok !== false
    || freezeProbe?.reason !== 'history-slot-index-out-of-range'
    || sourceWorkDenied(freezeProbe) !== true
  ) {
    throw new Error(`history-freeze-probe-failed:${JSON.stringify(freezeProbe)}`);
  }

  failurePhase = 'slot-selection';
  const metadata = await evaluate('window.__kaminosVolumePrototype.sampleBoundarySplatHistorySlotMetadata()', true);
  const selectedSlot = selectCompletedHistorySlot(metadata, minimumSourceAgeGenerations);
  lastTrustworthyEvidence.metadata = metadata;
  lastTrustworthyEvidence.selectedSlot = selectedSlot;

  failurePhase = 'stale-selection-negative-control';
  const staleSelectionProbe = await evaluate(`window.__kaminosVolumePrototype.renderBoundarySplatHistorySlotToCanvas(${JSON.stringify({
    slotIndex: selectedSlot.slotIndex,
    historyAllocationGeneration: selectedSlot.historyAllocationGeneration,
    archiveWriteSequence: selectedSlot.archiveWriteSequence + 1,
    maxAgeGenerations: historyWindowGenerations,
    requestedDrawCount: selectedSlot.effectiveDrawCount,
    resumeRenderLoop: false,
  })})`, true);
  if (
    staleSelectionProbe?.ok !== false
    || staleSelectionProbe?.reason !== 'history-slot-not-ready'
    || !staleSelectionProbe?.plan?.reasons?.includes('slot-overwritten-after-selection')
    || sourceWorkDenied(staleSelectionProbe) !== true
  ) {
    throw new Error(`stale-selection-false-accept:${JSON.stringify(staleSelectionProbe)}`);
  }
  lastTrustworthyEvidence.staleSelectionProbe = staleSelectionProbe;

  failurePhase = 'draw-only-holdover';
  const holdoverRows = [];
  const fixedNow = Number(selectedSlot.sourceTimestampMs) + 1000;
  for (let index = 0; index < holdoverFrames; index += 1) {
    const row = await evaluate(`window.__kaminosVolumePrototype.renderBoundarySplatHistorySlotToCanvas(${JSON.stringify({
      slotIndex: selectedSlot.slotIndex,
      historyAllocationGeneration: selectedSlot.historyAllocationGeneration,
      archiveWriteSequence: selectedSlot.archiveWriteSequence,
      maxAgeGenerations: historyWindowGenerations,
      requestedDrawCount: selectedSlot.effectiveDrawCount,
      holdoverOrdinal: index,
      maximumHoldoverFrames: holdoverFrames,
      repeatedSlotCount: index + 1,
      now: fixedNow,
      resumeRenderLoop: false,
      controlOverrides: { boundarySplatInstances: 100 },
    })})`, true);
    validateHoldoverRow(row, selectedSlot, index, holdoverFrames);
    const image = await captureCanvas();
    const imagePath = resolve(outDir, `history-holdover-${String(index).padStart(4, '0')}-slot${selectedSlot.slotIndex}.png`);
    writeFileSync(imagePath, image.bytes);
    const retainedRow = {
      ...row,
      image: {
        path: imagePath,
        sha256: sha256(image.bytes),
        bytes: image.bytes.length,
        clip: image.clip,
        metrics: image.metrics,
        authority: 'cdp-draw-only-history-holdover-composed-canvas-v0',
      },
    };
    holdoverRows.push(retainedRow);
    lastTrustworthyEvidence.holdoverFrameCount = holdoverRows.length;
    lastTrustworthyEvidence.lastHoldoverRow = retainedRow;
  }
  validateFrozenSourceSequence(holdoverRows, selectedSlot);

  failurePhase = 'resume-live-source';
  const simStepCountBeforeResume = Number(holdoverRows.at(-1).simStepCount);
  const resumeDraw = await evaluate(`window.__kaminosVolumePrototype.renderBoundarySplatHistorySlotToCanvas(${JSON.stringify({
    slotIndex: selectedSlot.slotIndex,
    historyAllocationGeneration: selectedSlot.historyAllocationGeneration,
    archiveWriteSequence: selectedSlot.archiveWriteSequence,
    maxAgeGenerations: historyWindowGenerations,
    requestedDrawCount: selectedSlot.effectiveDrawCount,
    holdoverOrdinal: holdoverFrames,
    maximumHoldoverFrames: holdoverFrames,
    repeatedSlotCount: holdoverFrames + 1,
    now: fixedNow,
    resumeRenderLoop: true,
    controlOverrides: { boundarySplatInstances: 100 },
  })})`, true);
  validateHoldoverRow(resumeDraw, selectedSlot, holdoverFrames, holdoverFrames);
  const resumedState = await waitForSimulatorAdvance(simStepCountBeforeResume);
  const simStepCountAfterResume = Number(resumedState.simStepCount);
  const finalPageUrl = await evaluate('location.href');
  validateEffectiveState(resumedState, finalPageUrl);
  const sameBrowserTargetPreserved = await targetIsReachable(browserPageId);
  if (!sameBrowserTargetPreserved) throw new Error('browser-target-unreachable-after-holdover-witness');

  failurePhase = 'complete';
  const distinctImageHashes = new Set(holdoverRows.map(row => row.image.sha256)).size;
  writeReport({
    schema: SCHEMA,
    status: 'passed',
    claimBoundary: 'bounded-completed-live-history-replay-no-independent-simulation-no-learned-prediction',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectivePageUrl: finalPageUrl,
    requestedEffectiveRouteAgreement,
    browser,
    browserPageId,
    browserPageUrl: finalPageUrl,
    sameBrowserTargetPreserved,
    route: compactState(resumedState),
    historyPrime,
    metadata,
    selectedSlot,
    selectedSourceAgeGenerations: Number(metadata.currentSourceCandidateGeneration) - Number(selectedSlot.sourceCandidateGeneration),
    historyWindowGenerations,
    minimumSourceAgeGenerations,
    staleSelectionProbe,
    holdoverFramesRequested: holdoverFrames,
    holdoverRows,
    repeatedSourceIdentityAgreement: true,
    distinctImageHashes,
    resumeDraw,
    simStepCountBeforeResume,
    simStepCountAfterResume,
    simulatorAdvancedAfterResume: simStepCountAfterResume > simStepCountBeforeResume,
    sourceProgressionDuringHoldover: {
      simulationSubmitted: false,
      sidecarSubmitted: false,
      compactionSubmitted: false,
      archiveSubmitted: false,
    },
    lastTrustworthyEvidence,
  });
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

function validateHoldoverRow(row, selectedSlot, index, maximumHoldoverFrames) {
  if (row?.ok !== true) throw new Error(`holdover-row-failed:${JSON.stringify(row)}`);
  if (row?.authority !== 'bounded-live-history-replay-no-simulator-progress') {
    throw new Error(`holdover-authority-mismatch:${JSON.stringify(row)}`);
  }
  if (sourceWorkDenied(row) !== true) throw new Error(`holdover-source-work-not-denied:${JSON.stringify(row)}`);
  if (row?.physicalCommandAgreement !== true || row?.physicalCommandAuthority !== PHYSICAL_COMMAND_AUTHORITY) {
    throw new Error(`holdover-physical-command-authority-failed:${JSON.stringify(row)}`);
  }
  if (
    Number(row?.physicalCommand?.vertexCount) !== 6
    || Number(row?.physicalCommand?.instanceCount) !== Number(selectedSlot.effectiveDrawCount)
    || Number(row?.physicalCommand?.firstVertex) !== 0
    || Number(row?.physicalCommand?.firstInstance) !== 0
  ) {
    throw new Error(`holdover-physical-command-mismatch:${JSON.stringify(row)}`);
  }
  if (
    Number(row?.slot?.slotIndex) !== Number(selectedSlot.slotIndex)
    || Number(row?.slot?.historyAllocationGeneration) !== Number(selectedSlot.historyAllocationGeneration)
    || Number(row?.slot?.archiveWriteSequence) !== Number(selectedSlot.archiveWriteSequence)
    || Number(row?.slot?.sourceCandidateGeneration) !== Number(selectedSlot.sourceCandidateGeneration)
    || Number(row?.plan?.drawCount) > Number(selectedSlot.effectiveDrawCount)
  ) {
    throw new Error(`holdover-source-identity-mismatch:${JSON.stringify(row)}`);
  }
  if (Number(row?.holdoverOrdinal) !== index || Number(row?.maximumHoldoverFrames) !== maximumHoldoverFrames) {
    throw new Error(`holdover-ordinal-mismatch:${JSON.stringify(row)}`);
  }
}

function validateFrozenSourceSequence(rows, selectedSlot) {
  if (rows.length !== holdoverFrames) throw new Error(`holdover-row-count-mismatch:${rows.length}`);
  const simSteps = new Set(rows.map(row => Number(row.simStepCount)));
  const renderFrames = new Set(rows.map(row => Number(row.renderFrameCount)));
  const sourceGenerations = new Set(rows.map(row => Number(row.slot.sourceCandidateGeneration)));
  const archiveSequences = new Set(rows.map(row => Number(row.slot.archiveWriteSequence)));
  if (simSteps.size !== 1 || renderFrames.size !== 1 || sourceGenerations.size !== 1 || archiveSequences.size !== 1) {
    throw new Error(`holdover-source-progressed:${JSON.stringify({
      simSteps: [...simSteps],
      renderFrames: [...renderFrames],
      sourceGenerations: [...sourceGenerations],
      archiveSequences: [...archiveSequences],
    })}`);
  }
  if (sourceGenerations.values().next().value !== Number(selectedSlot.sourceCandidateGeneration)) {
    throw new Error('holdover-selected-source-generation-disagrees');
  }
}

function selectCompletedHistorySlot(metadata, minimumAge) {
  if (
    metadata?.ok !== true
    || metadata?.authority !== 'gpu-archive-slot-metadata-post-queue-completion-readback-v0'
    || !Array.isArray(metadata?.slots)
  ) {
    throw new Error(`history-metadata-authority-failed:${JSON.stringify(metadata)}`);
  }
  const currentGeneration = Number(metadata.currentSourceCandidateGeneration);
  const candidates = metadata.slots
    .filter(slot => slot?.initialized === true && slot?.writeSubmissionCompleted === true)
    .map(slot => ({ ...slot, sourceAgeGenerations: currentGeneration - Number(slot.sourceCandidateGeneration) }))
    .filter(slot => slot.sourceAgeGenerations >= minimumAge)
    .sort((left, right) => right.sourceAgeGenerations - left.sourceAgeGenerations);
  if (!candidates.length) {
    throw new Error(`completed-history-slot-with-minimum-age-unavailable:${JSON.stringify({ minimumAge, metadata })}`);
  }
  return candidates[0];
}

function sourceWorkDenied(row) {
  return row?.simulationSubmitted === false
    && row?.sidecarSubmitted === false
    && row?.compactionSubmitted === false
    && row?.archiveSubmitted === false;
}

async function captureCanvas() {
  const canvasRect = await evaluate(`(() => {
    const canvas = document.getElementById('kaminos-volume-canvas');
    if (!canvas?.classList.contains('active')) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  if (!canvasRect || canvasRect.width < 100 || canvasRect.height < 100) {
    throw new Error(`blank-or-partial-holdover-canvas:${JSON.stringify(canvasRect)}`);
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
  if (metrics.litPixels <= 200 || metrics.litWidthRatio <= 0 || metrics.litHeightRatio <= 0) {
    throw new Error(`blank-or-partial-holdover-canvas:${JSON.stringify(metrics)}`);
  }
  return { bytes, clip, metrics };
}

async function waitForSimulatorAdvance(before) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (Number(state?.simStepCount) > before && Number(state?.boundarySplatRequestedInstanceCount) === 100) return state;
    await delay(25);
  }
  throw new Error(`simulator-did-not-resume-after-holdover:${before}`);
}

async function waitForPrototype() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (state?.active === true && state?.backend && state?.boundarySplatCompositionIdentity) return state;
    await delay(125);
  }
  throw new Error('volume-prototype-did-not-become-active');
}

async function waitForTelemetry() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (
      Number(state?.boundarySplatSourceCandidateCount) > 0
      && Number(state?.boundarySplatOverflowCount || 0) === 0
      && Number(state?.boundarySplatCopyBytesThisFrame) === 0
      && state?.boundarySplatFallbackReason == null
      && state?.boundarySplatBufferIntegrity?.ok === true
      && Number(state?.boundarySplatHistoryDepth) > 1
      && Number(state?.boundarySplatHistoryFrameStride) > 0
    ) return state;
    await delay(125);
  }
  throw new Error('boundary-splat-holdover-telemetry-did-not-settle');
}

function validateEffectiveState(state, pageUrl) {
  const params = new URL(pageUrl).searchParams;
  const mismatches = [];
  if (state?.active !== true) mismatches.push(['active', true, state?.active]);
  if (state?.effectiveRoute !== EFFECTIVE_ROUTE) mismatches.push(['effectiveRoute', EFFECTIVE_ROUTE, state?.effectiveRoute]);
  if (state?.boundarySplatRendererIdentity !== RENDERER) mismatches.push(['renderer', RENDERER, state?.boundarySplatRendererIdentity]);
  if (state?.boundarySplatAttributeModelIdentity !== MODEL) mismatches.push(['model', MODEL, state?.boundarySplatAttributeModelIdentity]);
  if (state?.boundarySplatSourceAuthority !== SOURCE) mismatches.push(['source', SOURCE, state?.boundarySplatSourceAuthority]);
  if (state?.boundarySplatCompositionIdentity !== COMPOSITION) mismatches.push(['composition', COMPOSITION, state?.boundarySplatCompositionIdentity]);
  if (state?.boundarySplatPbrSceneIdentity !== PBR_SCENE) mismatches.push(['pbrScene', PBR_SCENE, state?.boundarySplatPbrSceneIdentity]);
  if (Number(state?.boundarySplatRequestedInstanceCount) !== 100) mismatches.push(['instances', 100, state?.boundarySplatRequestedInstanceCount]);
  if (state?.boundarySplatFallbackReason != null) mismatches.push(['fallback', null, state?.boundarySplatFallbackReason]);
  if (Number(state?.boundarySplatOverflowCount || 0) !== 0) mismatches.push(['overflow', 0, state?.boundarySplatOverflowCount]);
  if (Number(state?.boundarySplatCopyBytesThisFrame) !== 0) mismatches.push(['copyBytes', 0, state?.boundarySplatCopyBytesThisFrame]);
  if (state?.boundarySplatBufferIntegrity?.identity !== BUFFER_INTEGRITY || state?.boundarySplatBufferIntegrity?.ok !== true) {
    mismatches.push(['bufferIntegrity', BUFFER_INTEGRITY, state?.boundarySplatBufferIntegrity]);
  }
  if (params.get('volume_boundary_splat_instances') !== '100') mismatches.push(['routeInstances', '100', params.get('volume_boundary_splat_instances')]);
  if (params.get('volume_boundary_splat_history_depth') !== '16') mismatches.push(['routeHistoryDepth', '16', params.get('volume_boundary_splat_history_depth')]);
  if (params.get('volume_boundary_splat_pbr_scene') !== 'fire-field') mismatches.push(['routePbrScene', 'fire-field', params.get('volume_boundary_splat_pbr_scene')]);
  if (mismatches.length) throw new Error(`stale-or-default-config:${JSON.stringify(mismatches)}`);
}

function compactState(state) {
  return {
    active: state?.active,
    backend: state?.backend,
    requestedRoute: state?.requestedRoute,
    effectiveRoute: state?.effectiveRoute,
    rendererIdentity: state?.boundarySplatRendererIdentity,
    modelIdentity: state?.boundarySplatAttributeModelIdentity,
    sourceAuthority: state?.boundarySplatSourceAuthority,
    compositionIdentity: state?.boundarySplatCompositionIdentity,
    pbrSceneIdentity: state?.boundarySplatPbrSceneIdentity,
    phaseSourceIdentity: state?.boundarySplatPhaseSourceIdentity,
    frameCount: state?.frameCount,
    simStepCount: state?.simStepCount,
    sourceCandidateCount: state?.boundarySplatSourceCandidateCount,
    renderedInstanceCount: state?.boundarySplatInstanceCount,
    requestedInstanceCount: state?.boundarySplatRequestedInstanceCount,
    historyDepth: state?.boundarySplatHistoryDepth,
    historyFrameStride: state?.boundarySplatHistoryFrameStride,
    historyAllocationGeneration: state?.boundarySplatHistoryAllocationGeneration,
    overflowCount: state?.boundarySplatOverflowCount,
    candidateCopyBytes: state?.boundarySplatCopyBytesThisFrame,
    fallbackReason: state?.boundarySplatFallbackReason,
    bufferIntegrity: state?.boundarySplatBufferIntegrity,
  };
}

async function existingBrowserSeat() {
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
  for (const [key, value] of requestedUrl.searchParams.entries()) {
    if (effectiveUrl.searchParams.get(key) !== value) return false;
  }
  return true;
}

function classifyFailure(error, phase) {
  const message = error?.message || String(error);
  for (const name of [
    'browser-process-not-found',
    'browser-profile-mismatch',
    'requested-effective-route-mismatch',
    'stale-or-default-config',
    'history-prime-authority-failed',
    'history-metadata-authority-failed',
    'completed-history-slot-with-minimum-age-unavailable',
    'stale-selection-false-accept',
    'holdover-source-work-not-denied',
    'holdover-physical-command-authority-failed',
    'holdover-source-progressed',
    'blank-or-partial-holdover-canvas',
    'simulator-did-not-resume-after-holdover',
    'browser-target-unreachable-after-holdover-witness',
  ]) {
    if (message.includes(name)) return name;
  }
  return phase;
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) parsed.set(argv[index], argv[index + 1]);
  return parsed;
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function requireNonnegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be nonnegative`);
}

function requireNonnegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be nonnegative`);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
