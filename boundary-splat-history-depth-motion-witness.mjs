#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.boundary-splat-history-depth-motion-witness.v0';
const REQUIRED_HISTORY_DEPTHS = [16, 32, 64];
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const RENDERER = 'live-boundary-sidecar-learned-attribute-splats-v0';
const MODEL = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const COMPOSITION = 'boundary-splat-composed-field-v0';
const PBR_SCENE = 'boundary-splat-pbr-fire-field-v0';
const PHASE_SOURCE = 'age-sweep-history';
const CAMERA = {
  identity: 'history-depth-motion-fixed-camera-v0',
  position: [0.05, 1.85, 4.35],
  target: [0, -0.18, 0.16],
};

const args = parseArgs(process.argv.slice(2));
const requestedRoute = String(args.get('--url') || '');
const contractFixture = String(args.get('--contract-fixture') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-history-depth-motion-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/history-depth-motion-report.json`));
const chrome = String(args.get('--chrome') || process.env.CHROME || defaultChromePath());
const ffmpeg = String(args.get('--ffmpeg') || 'ffmpeg');
const ffprobe = String(args.get('--ffprobe') || 'ffprobe');
const windowSize = String(args.get('--window-size') || '1280,960');
const keepBrowserOpen = args.has('--keep-browser-open');
const userDataDir = resolve(String(args.get('--user-data-dir') || mkdtempSync(`${tmpdir()}/kaminos-history-depth-chrome-`)));
const runStartedAt = new Date().toISOString();

let requestedHistoryDepths = [];
let frameCount = null;
let frameIntervalMs = null;
let settleMs = null;
let warmupSamples = null;
let steadySamples = null;
let port = null;

let browserSession = null;
let pageId = null;
let pageUrl = null;
let ws = null;
let failurePhase = 'startup';
const lastTrustworthyEvidence = {};

try {
  hydrateInputs();
  validateStartup();
  mkdirSync(outDir, { recursive: true });
  if (contractFixture) {
    failurePhase = 'contract-fixture';
    runContractFixture(contractFixture);
    throw new Error(`contract-fixture-did-not-reject:${contractFixture}`);
  }
  if (await isCdpEndpointOpen()) throw new Error(`CDP debug port already in use before launch: ${port}`);
  browserSession = await launchBrowser();
  failurePhase = 'connect-single-browser';
  await waitForCdp();
  const page = await findPage();
  pageId = page.id;
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest('Page.enable');
  await wsRequest('Runtime.enable');

  const historyDepthRows = [];
  let measuredUpperRung = null;
  let matchedSubstrateIdentity = null;
  for (const requestedDepth of requestedHistoryDepths) {
    const row = await captureHistoryDepth(requestedDepth, matchedSubstrateIdentity);
    if (!matchedSubstrateIdentity) matchedSubstrateIdentity = row.matchedSubstrateIdentity;
    historyDepthRows.push(row);
    if (requestedDepth === REQUIRED_HISTORY_DEPTHS[0]) {
      measuredUpperRung = measureHistoryUpperRung(row.initialState);
    }
  }

  if (measuredUpperRung.depth > REQUIRED_HISTORY_DEPTHS.at(-1)) {
    const upperRow = await captureHistoryDepth(measuredUpperRung.depth, matchedSubstrateIdentity);
    historyDepthRows.push(upperRow);
    measuredUpperRung = { ...measuredUpperRung, capturedAsDistinctRow: true };
  } else {
    measuredUpperRung = {
      ...measuredUpperRung,
      capturedAsDistinctRow: false,
      representedByDepth: REQUIRED_HISTORY_DEPTHS.at(-1),
    };
  }

  const finalTargetReachable = await targetIsReachable(pageId);
  if (!finalTargetReachable) throw new Error('single-browser-target-unreachable-after-sweep');
  const report = {
    schema: SCHEMA,
    status: 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    browser: {
      identity: 'boundary-splat-history-depth-single-cdp-browser-v0',
      mode: browserSession.mode,
      browserProcessId: browserSession.browserProcessId,
      pageId,
      pageUrl,
      port,
      userDataDir,
      windowSize,
      finalTargetReachable,
      disposition: keepBrowserOpen ? 'preserved-open' : 'closed-by-owner-after-report',
    },
    requestedHistoryDepths,
    measuredUpperRung,
    matchedSubstrateIdentity,
    captureConfig: {
      frameCount,
      frameIntervalMs,
      intendedDurationMs: (frameCount - 1) * frameIntervalMs,
      warmupSamples,
      steadySamples,
      nonLoopingEncoding: true,
      operatorMotionAcceptance: 'pending-direct-visual-smoke',
    },
    historyDepthRows,
    falseClosureChecks: {
      requiredDepthRowsPresent: REQUIRED_HISTORY_DEPTHS.every(depth => historyDepthRows.some(row => row.requestedDepth === depth)),
      requestedEffectiveDepthAgreement: historyDepthRows.every(row => row.requestedEffectiveDepthAgreement),
      requestedEffectiveRouteAgreement: historyDepthRows.every(row => row.requestedEffectiveRouteAgreement),
      matchedSubstrate: historyDepthRows.every(row => deepEqual(row.matchedSubstrateIdentity, matchedSubstrateIdentity)),
      sameBrowser: historyDepthRows.every(row => row.browserProcessId === browserSession.browserProcessId && row.pageId === pageId),
      noFallback: historyDepthRows.every(row => row.fallbackReason === null),
      noOverflow: historyDepthRows.every(row => row.maxOverflowCount === 0),
      noCandidateCopy: historyDepthRows.every(row => row.maxCandidateCopyBytes === 0),
      noBlankFrames: historyDepthRows.every(row => row.motion.distinctFrameHashCount > 1),
      noCachedMotion: historyDepthRows.every(row => row.motion.meanAdjacentPixelDelta > 0),
      noObservedExactPeriod: historyDepthRows.every(row => row.motion.observedExactPeriodFrames === null),
      liveRenderAndSimClocks: historyDepthRows.every(row => row.cadence.allFrameDeltasPositive && row.cadence.allSimStepDeltasPositive),
      completeVideos: historyDepthRows.every(row => row.video.nbFrames === frameCount),
    },
    claimBoundary: 'Serial same-browser truthful GPU-history depth and selection witness from one live simulator. Motion quality requires direct operator smoke. Still diversity, pixel deltas, timing, and memory are supporting evidence only. This is not learned prediction, independent per-instance simulation, prerecorded looping motion, or runtime uptake.',
  };
  rejectFalseClosure(report);
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const failure = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    runStartedAt,
    failedAt: new Date().toISOString(),
    requestedRoute,
    requestedHistoryDepths,
    browser: browserSession ? {
      identity: 'boundary-splat-history-depth-single-cdp-browser-v0',
      mode: browserSession.mode,
      browserProcessId: browserSession.browserProcessId,
      pageId,
      pageUrl,
      port,
      userDataDir,
      targetReachable: await targetIsReachable(pageId).catch(() => false),
    } : null,
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
  };
  writeReport(failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close?.(); } catch {}
  if (!keepBrowserOpen) browserSession?.process?.kill('SIGTERM');
}

function validateStartup() {
  if (!requestedRoute) throw new Error('missing --url');
  if (new Set(requestedHistoryDepths).size !== requestedHistoryDepths.length) {
    throw new Error('history depths must be unique');
  }
  for (const depth of REQUIRED_HISTORY_DEPTHS) {
    if (!requestedHistoryDepths.includes(depth)) throw new Error(`missing required history depth ${depth}`);
  }
  if (frameCount < 2) throw new Error('--frames must be at least 2');
}

function hydrateInputs() {
  requestedHistoryDepths = parseHistoryDepths(String(args.get('--history-depths') || REQUIRED_HISTORY_DEPTHS.join(',')));
  frameCount = positiveInteger(args.get('--frames') ?? 63, '--frames');
  frameIntervalMs = positiveNumber(args.get('--frame-ms') ?? 160, '--frame-ms');
  settleMs = nonnegativeNumber(args.get('--settle-ms') ?? 4000, '--settle-ms');
  warmupSamples = nonnegativeInteger(args.get('--warmup-samples') ?? 3, '--warmup-samples');
  steadySamples = positiveInteger(args.get('--steady-samples') ?? 12, '--steady-samples');
  port = positiveInteger(args.get('--chrome-port') ?? 19441, '--chrome-port');
}

async function captureHistoryDepth(requestedDepth, expectedSubstrate) {
  const label = `depth-${requestedDepth}`;
  const rowDir = resolve(outDir, label);
  const framesDir = resolve(rowDir, 'frames');
  mkdirSync(framesDir, { recursive: true });
  failurePhase = `${label}:route-load`;
  const rowRoute = routeForDepth(requestedRoute, requestedDepth);
  await wsRequest('Page.navigate', { url: rowRoute });
  await wsRequest('Page.bringToFront');
  await waitForPrototype();
  await delay(settleMs);
  await hideHud();
  const effectiveCamera = await setCameraPose(CAMERA);
  const initialState = await waitForDepthTelemetry(requestedDepth);
  pageUrl = await evaluate('location.href');
  const requestedEffectiveRouteAgreement = sameCanonicalRoute(rowRoute, pageUrl);
  const requestedEffectiveDepthAgreement = Number(initialState.boundarySplatHistoryDepth) === requestedDepth;
  if (!requestedEffectiveRouteAgreement) {
    throw new Error(`requested-effective-route-disagreement:${JSON.stringify({ requested: rowRoute, effective: pageUrl })}`);
  }
  if (!requestedEffectiveDepthAgreement) {
    throw new Error(`requested-effective-depth-disagreement:${JSON.stringify({ requestedDepth, effectiveDepth: initialState.boundarySplatHistoryDepth })}`);
  }
  validateRuntimeState(initialState, requestedDepth);
  const matchedSubstrateIdentity = substrateIdentity(initialState, effectiveCamera);
  if (expectedSubstrate && !deepEqual(matchedSubstrateIdentity, expectedSubstrate)) {
    throw new Error(`matched-substrate-disagreement:${JSON.stringify({ expected: expectedSubstrate, actual: matchedSubstrateIdentity })}`);
  }
  lastTrustworthyEvidence.currentRow = {
    requestedDepth,
    rowRoute,
    pageUrl,
    requestedEffectiveRouteAgreement,
    requestedEffectiveDepthAgreement,
    initialState: compactState(initialState),
    matchedSubstrateIdentity,
  };

  failurePhase = `${label}:history-prime`;
  const historyPrime = await evaluate(`window.__kaminosVolumePrototype.primeBoundarySplatLiveHistory(${JSON.stringify({
    minimumHistoryFrames: Number(initialState.boundarySplatEffectiveHistoryWindowFrames) + 1,
  })})`, true);
  validateHistoryPrime(historyPrime, requestedDepth);
  const slotMetadata = await evaluate('window.__kaminosVolumePrototype.sampleBoundarySplatHistorySlotMetadata()', true);
  validateSlotMetadata(slotMetadata, requestedDepth);
  lastTrustworthyEvidence.currentRow.historyPrime = historyPrime;
  lastTrustworthyEvidence.currentRow.slotMetadata = slotMetadata;

  failurePhase = `${label}:gpu-work`;
  const cost = await evaluate(`window.__kaminosVolumePrototype.sampleBoundarySplatPbrCostLadder(${JSON.stringify({
    counts: [100],
    warmupSamples,
    steadySamples,
  })})`, true);
  validateCost(cost);
  lastTrustworthyEvidence.currentRow.cost = cost;

  failurePhase = `${label}:capture-setup`;
  const captureSetup = await evaluate(`window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
    renderScale: 1,
    controlOverrides: {
      boundarySplatInstances: 100,
      boundarySplatComposition: 'field',
      boundarySplatMode: 'learned',
      boundarySplatPbrScene: 'fire-field',
      boundarySplatPhaseMode: 'age-sweep',
      boundarySplatHistoryDepth: requestedDepth,
    },
    restoreControls: true,
    resumeRenderLoop: true,
  })})`, true);
  if (captureSetup?.ok !== true || captureSetup.sampleAuthority !== 'render-only-frozen-sim-state') {
    throw new Error(`capture-setup-failed:${JSON.stringify(captureSetup)}`);
  }
  const clip = clipFromCanvas(captureSetup.canvasCssRect);
  const frames = [];
  const wallStartedAt = performance.now();
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    if (frameIndex > 0) await delay(frameIntervalMs);
    failurePhase = `${label}:frame-${frameIndex + 1}`;
    const state = await debugState();
    validateRuntimeState(state, requestedDepth);
    const screenshot = await wsRequest('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip,
    });
    const image = Buffer.from(screenshot.data, 'base64');
    const metrics = measureScreenshot(image);
    if (metrics.width < 100 || metrics.height < 100 || metrics.litPixels <= 200 || metrics.meanLuma <= 1) {
      throw new Error(`missing-or-blank-frame:${JSON.stringify({ requestedDepth, frameIndex, metrics })}`);
    }
    const framePath = resolve(framesDir, `frame-${String(frameIndex + 1).padStart(4, '0')}.png`);
    writeFileSync(framePath, image);
    const frame = {
      frameIndex,
      elapsedWallMs: performance.now() - wallStartedAt,
      path: framePath,
      sha256: sha256(image),
      metrics,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      historyWriteSlot: state.boundarySplatHistoryWriteSlot,
      phaseSourceCount: state.boundarySplatPhaseSourceCount,
      sourceCandidateCount: state.boundarySplatSourceCandidateCount,
      selectedCandidateCount: state.boundarySplatSelectedCandidateCount,
      overflowCount: state.boundarySplatOverflowCount,
      candidateCopyBytes: state.boundarySplatCopyBytesThisFrame,
      phaseSources: compactPhaseSources(state.boundarySplatPhaseSources),
    };
    frames.push(frame);
    lastTrustworthyEvidence.currentRow.pendingFrame = frame;
  }

  failurePhase = `${label}:motion-validation`;
  const motion = summarizeMotion(frames);
  if (motion.distinctFrameHashCount < 2 || motion.meanAdjacentPixelDelta <= 0) {
    throw new Error(`cached-or-static-motion:${JSON.stringify(motion)}`);
  }
  const perSourceReuse = summarizePerSourceReuse(frames, requestedDepth);
  const cadence = summarizeCadence(frames);
  validateLiveMotion(frames, motion, cadence);

  failurePhase = `${label}:video-encode`;
  const videoPath = resolve(rowDir, `${label}-motion.mp4`);
  encodeVideo(framesDir, videoPath);
  const video = probeVideo(videoPath);
  if (video.nbFrames !== frameCount) {
    throw new Error(`partial-video-output:${JSON.stringify({ expected: frameCount, actual: video.nbFrames, videoPath })}`);
  }
  const finalState = await debugState();
  validateRuntimeState(finalState, requestedDepth);
  const bufferIntegrity = finalState.boundarySplatBufferIntegrity;
  if (bufferIntegrity?.ok !== true) {
    throw new Error(`history-buffer-integrity-failed:${JSON.stringify(bufferIntegrity)}`);
  }
  const row = {
    requestedDepth,
    effectiveDepth: Number(finalState.boundarySplatHistoryDepth),
    requestedEffectiveDepthAgreement,
    requestedRoute: rowRoute,
    effectiveRoute: finalState.effectiveRoute,
    effectivePageUrl: pageUrl,
    requestedEffectiveRouteAgreement,
    browserProcessId: browserSession.browserProcessId,
    pageId,
    matchedSubstrateIdentity,
    initialState: compactState(initialState),
    finalState: compactState(finalState),
    boundarySplatHistoryAllocatedSlots: finalState.boundarySplatHistoryAllocatedSlots,
    boundarySplatBufferIntegrity: bufferIntegrity,
    historyPrime,
    slotMetadata,
    cost,
    cadence,
    perSourceReuse,
    frames,
    motion,
    video,
    fallbackReason: finalState.boundarySplatFallbackReason ?? null,
    maxOverflowCount: Math.max(...frames.map(frame => Number(frame.overflowCount) || 0), 0),
    maxCandidateCopyBytes: Math.max(...frames.map(frame => Number(frame.candidateCopyBytes) || 0), 0),
  };
  lastTrustworthyEvidence.completedRows = [...(lastTrustworthyEvidence.completedRows || []), row];
  delete lastTrustworthyEvidence.currentRow;
  return row;
}

function measureHistoryUpperRung(initialState) {
  const depth = Number(
    initialState?.boundarySplatHistoryMeasuredUpperDepth
    ?? initialState?.boundarySplatHistoryAllocation?.measuredUpperDepth,
  );
  const authority = initialState?.boundarySplatHistoryMeasuredUpperAuthority
    ?? initialState?.boundarySplatHistoryAllocation?.measuredUpperAuthority
    ?? null;
  if (!Number.isInteger(depth) || depth < REQUIRED_HISTORY_DEPTHS.at(-1)) {
    throw new Error(`measured-history-upper-rung-unavailable:${JSON.stringify({ depth, authority })}`);
  }
  if (!authority) throw new Error('measured-history-upper-rung-authority-missing');
  return { depth, authority };
}

function validateRuntimeState(state, requestedDepth) {
  if (!state?.active || state.backend !== 'WebGPU:apple' || state.effectiveRoute !== EFFECTIVE_ROUTE) {
    throw new Error(`fallback-route:${JSON.stringify(compactState(state))}`);
  }
  if (state.boundarySplatRendererIdentity !== RENDERER || state.boundarySplatAttributeModelIdentity !== MODEL) {
    throw new Error(`renderer-model-disagreement:${JSON.stringify(compactState(state))}`);
  }
  if (state.boundarySplatSourceAuthority !== SOURCE_AUTHORITY
    || state.boundarySplatCompositionIdentity !== COMPOSITION
    || state.boundarySplatPbrSceneIdentity !== PBR_SCENE
    || state.boundarySplatPhaseSourceIdentity !== PHASE_SOURCE) {
    throw new Error(`matched-substrate-disagreement:${JSON.stringify(compactState(state))}`);
  }
  if (Number(state.boundarySplatHistoryDepth) !== requestedDepth) {
    throw new Error(`requested-effective-depth-disagreement:${JSON.stringify({ requestedDepth, effectiveDepth: state.boundarySplatHistoryDepth })}`);
  }
  if (Number(state.boundarySplatHistoryAllocatedSlots) < requestedDepth) {
    throw new Error(`allocated-history-depth-below-request:${JSON.stringify({ requestedDepth, allocated: state.boundarySplatHistoryAllocatedSlots })}`);
  }
  if (state.boundarySplatFallbackReason) throw new Error(`fallback-route:${state.boundarySplatFallbackReason}`);
}

function validateHistoryPrime(prime, requestedDepth) {
  assert.equal(prime?.identity, 'boundary-splat-live-history-prime-v0', 'wrong history prime identity');
  assert.equal(prime?.ok, true, 'history prime failed');
  assert.equal(prime?.simulatorCount, 1, 'history prime duplicated the simulator');
  assert.equal(prime?.phaseSourceCount, requestedDepth, 'history prime did not expose every requested slot');
  assert.equal(prime?.fallbackReason, null, 'history prime entered fallback');
  assert.equal(prime?.candidateCopyBytes, 0, 'history prime copied candidate state');
}

function validateSlotMetadata(metadata, requestedDepth) {
  if (metadata?.ok !== true || metadata.authority !== 'gpu-archive-slot-metadata-post-queue-completion-readback-v0') {
    throw new Error(`history-slot-metadata-unavailable:${JSON.stringify(metadata)}`);
  }
  if (Number(metadata.historyDepth) !== requestedDepth || Number(metadata.allocatedHistoryDepth) < requestedDepth) {
    throw new Error(`history-slot-depth-disagreement:${JSON.stringify(metadata)}`);
  }
  if (metadata.slots?.length !== requestedDepth || metadata.slots.some(slot => !slot.initialized)) {
    throw new Error(`history-slot-prime-incomplete:${JSON.stringify(metadata)}`);
  }
}

function validateCost(cost) {
  if (cost?.identity !== 'boundary-splat-pbr-cost-ladder-v0' || cost?.simulatorCount !== 1) {
    throw new Error(`gpu-work-evidence-invalid:${JSON.stringify(cost)}`);
  }
  const row = cost.rows?.find(item => Number(item.requestedInstanceCount) === 100);
  if (!row || row.fallbackReason || Number(row.overflowCount) > 0) {
    throw new Error(`gpu-work-row-invalid:${JSON.stringify(row)}`);
  }
}

function routeForDepth(base, depth) {
  const route = new URL(base);
  const required = {
    kaminos_volume_smoke: '1',
    volume_boundary_splat_mode: 'learned',
    volume_boundary_splat_instances: '100',
    volume_boundary_splat_composition: 'field',
    volume_boundary_splat_pbr_scene: 'fire-field',
    volume_boundary_splat_phase_mode: 'age-sweep',
    volume_boundary_splat_history_depth: String(depth),
    history_ring_smoke: String(depth),
  };
  for (const [key, value] of Object.entries(required)) route.searchParams.set(key, value);
  return route.toString();
}

function substrateIdentity(state, camera) {
  return {
    effectiveRoute: state.effectiveRoute,
    backend: state.backend,
    rendererIdentity: state.boundarySplatRendererIdentity,
    modelIdentity: state.boundarySplatAttributeModelIdentity,
    sourceAuthority: state.boundarySplatSourceAuthority,
    compositionIdentity: state.boundarySplatCompositionIdentity,
    pbrSceneIdentity: state.boundarySplatPbrSceneIdentity,
    phaseModeIdentity: state.boundarySplatPhaseModeIdentity,
    phaseSourceIdentity: state.boundarySplatPhaseSourceIdentity,
    phaseStride: state.boundarySplatPhaseStride,
    historyFrameStride: state.boundarySplatHistoryFrameStride,
    requestedInstanceCount: state.boundarySplatRequestedInstanceCount,
    layoutBounds: state.boundarySplatLayoutBounds,
    camera: {
      identity: CAMERA.identity,
      position: camera?.position,
      target: camera?.target,
    },
  };
}

function compactState(state) {
  if (!state) return null;
  return {
    active: state.active,
    backend: state.backend,
    effectiveRoute: state.effectiveRoute,
    frameCount: state.frameCount,
    simStepCount: state.simStepCount,
    boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
    boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
    boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
    boundarySplatCompositionIdentity: state.boundarySplatCompositionIdentity,
    boundarySplatPbrSceneIdentity: state.boundarySplatPbrSceneIdentity,
    boundarySplatPhaseSourceIdentity: state.boundarySplatPhaseSourceIdentity,
    boundarySplatHistoryDepth: state.boundarySplatHistoryDepth,
    boundarySplatHistoryAllocatedSlots: state.boundarySplatHistoryAllocatedSlots,
    boundarySplatHistoryMeasuredUpperDepth: state.boundarySplatHistoryMeasuredUpperDepth,
    boundarySplatHistoryMeasuredUpperAuthority: state.boundarySplatHistoryMeasuredUpperAuthority,
    boundarySplatHistoryFrameStride: state.boundarySplatHistoryFrameStride,
    boundarySplatEffectiveHistoryWindowFrames: state.boundarySplatEffectiveHistoryWindowFrames,
    boundarySplatHistoryWriteSlot: state.boundarySplatHistoryWriteSlot,
    boundarySplatPhaseSourceCount: state.boundarySplatPhaseSourceCount,
    boundarySplatSourceCandidateCount: state.boundarySplatSourceCandidateCount,
    boundarySplatSelectedCandidateCount: state.boundarySplatSelectedCandidateCount,
    boundarySplatOverflowCount: state.boundarySplatOverflowCount,
    boundarySplatCopyBytesThisFrame: state.boundarySplatCopyBytesThisFrame,
    boundarySplatFallbackReason: state.boundarySplatFallbackReason,
  };
}

function compactPhaseSources(sources) {
  return (sources || []).map(source => ({
    index: source.index,
    historySlot: source.historySlot,
    physicalHistoryAgeFrames: source.physicalHistoryAgeFrames,
    sourceCandidateGeneration: source.sourceCandidateGeneration ?? null,
    archiveWriteSequence: source.archiveWriteSequence ?? null,
    authority: source.authority,
  }));
}

function summarizePerSourceReuse(frames, requestedDepth) {
  const counts = new Map(Array.from({ length: requestedDepth }, (_, slot) => [slot, 0]));
  for (const frame of frames) {
    for (const source of frame.phaseSources) counts.set(source.historySlot, (counts.get(source.historySlot) || 0) + 1);
  }
  const slots = [...counts.entries()].map(([historySlot, selections]) => ({ historySlot, selections }));
  if (slots.some(slot => slot.selections <= 0)) throw new Error(`unselected-history-source:${JSON.stringify(slots)}`);
  return {
    authority: 'instance-descriptor-history-slot-selection-count-v0',
    totalSelections: slots.reduce((sum, slot) => sum + slot.selections, 0),
    slots,
  };
}

function summarizeCadence(frames) {
  const wallDeltasMs = [];
  const frameDeltas = [];
  const simStepDeltas = [];
  for (let index = 1; index < frames.length; index += 1) {
    wallDeltasMs.push(frames[index].elapsedWallMs - frames[index - 1].elapsedWallMs);
    frameDeltas.push(Number(frames[index].frameCount) - Number(frames[index - 1].frameCount));
    simStepDeltas.push(Number(frames[index].simStepCount) - Number(frames[index - 1].simStepCount));
  }
  return {
    authority: 'browser-wall-plus-runtime-frame-and-sim-step-ledger-v0',
    requestedFrameIntervalMs: frameIntervalMs,
    actualDurationMs: frames.at(-1).elapsedWallMs - frames[0].elapsedWallMs,
    wallDeltasMs,
    frameDeltas,
    simStepDeltas,
    allFrameDeltasPositive: frameDeltas.every(delta => delta > 0),
    allSimStepDeltasPositive: simStepDeltas.every(delta => delta > 0),
  };
}

function summarizeMotion(frames) {
  const diffs = [];
  for (let index = 1; index < frames.length; index += 1) {
    diffs.push(imageDiff(frames[index - 1].path, frames[index].path));
  }
  return {
    authority: 'consecutive-live-canvas-png-delta-v0',
    distinctFrameHashCount: new Set(frames.map(frame => frame.sha256)).size,
    observedExactPeriodFrames: detectExactPeriod(frames.map(frame => frame.sha256)),
    meanAdjacentPixelDelta: mean(diffs.map(diff => diff.meanAbsDiff)),
    changedPixelFraction: mean(diffs.map(diff => diff.changedFraction)),
    diffs,
  };
}

function encodeVideo(framesDir, videoPath) {
  const result = spawnSync(ffmpeg, [
    '-y',
    '-loglevel', 'error',
    '-framerate', String(1000 / frameIntervalMs),
    '-i', resolve(framesDir, 'frame-%04d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    videoPath,
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0 || !existsSync(videoPath)) {
    throw new Error(`video-encode-failed:${result.error?.message || result.stderr || result.stdout}`);
  }
}

function probeVideo(videoPath) {
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_frames:format=duration',
    '-of', 'json',
    videoPath,
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`video-probe-failed:${result.error?.message || result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  const stream = parsed.streams?.[0] || {};
  return {
    path: videoPath,
    sha256: sha256(readFileSync(videoPath)),
    width: Number(stream.width),
    height: Number(stream.height),
    frameRate: stream.r_frame_rate,
    nbFrames: Number(stream.nb_frames),
    durationSeconds: Number(parsed.format?.duration),
    nonLoopingEncoding: true,
    periodicMotionAuthority: 'bounded-capture-exact-frame-hash-period-check-v0',
    operatorMotionAcceptance: 'pending-direct-visual-smoke',
  };
}

function validateLiveMotion(frames, motion, cadence) {
  if (motion.observedExactPeriodFrames !== null) {
    throw new Error(`cached-or-periodic-motion:${JSON.stringify({ periodFrames: motion.observedExactPeriodFrames })}`);
  }
  if (!cadence.allFrameDeltasPositive || !cadence.allSimStepDeltasPositive) {
    throw new Error(`stalled-live-clock:${JSON.stringify({ frameDeltas: cadence.frameDeltas, simStepDeltas: cadence.simStepDeltas })}`);
  }
  if (motion.distinctFrameHashCount < 2 || motion.meanAdjacentPixelDelta <= 0) {
    throw new Error(`cached-or-static-motion:${JSON.stringify(motion)}`);
  }
  if (frames.length !== frameCount) throw new Error(`partial-frame-sequence:${frames.length}/${frameCount}`);
}

function detectExactPeriod(hashes) {
  for (let period = 1; period <= Math.floor(hashes.length / 2); period += 1) {
    let periodic = true;
    for (let index = period; index < hashes.length; index += 1) {
      if (hashes[index] !== hashes[index % period]) {
        periodic = false;
        break;
      }
    }
    if (periodic) return period;
  }
  return null;
}

function rejectFalseClosure(report) {
  const checks = report.falseClosureChecks;
  for (const [name, passed] of Object.entries(checks)) {
    if (!passed) throw new Error(`false-closure-check-failed:${name}`);
  }
  if (!report.measuredUpperRung?.authority) throw new Error('measured-upper-rung-authority-missing');
}

async function launchBrowser() {
  const process = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    'about:blank',
  ], { stdio: 'ignore', detached: keepBrowserOpen });
  if (keepBrowserOpen) process.unref();
  return {
    identity: 'boundary-splat-history-depth-single-cdp-browser-v0',
    mode: keepBrowserOpen ? 'launched-kept-open' : 'launched-owned',
    process,
    browserProcessId: process.pid,
  };
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { return await cdpFetch('/json/version'); } catch { await delay(100); }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function findPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(target => target.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await delay(125);
  }
  throw new Error('could not find CDP page target');
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function isCdpEndpointOpen() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
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
    const onClose = () => { cleanup(); rejectRequest(new Error(`${method}: WebSocket closed before response ${id}`)); };
    const onError = () => { cleanup(); rejectRequest(new Error(`${method}: WebSocket error before response ${id}`)); };
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

async function evaluate(expression, awaitPromise = false) {
  const result = await wsRequest('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (result.exceptionDetails) throw new Error(`browser-evaluation-failed:${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

async function waitForPrototype() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await evaluate(`(() => {
      const proto = window.__kaminosVolumePrototype;
      if (!proto?.debugState || !proto?.primeBoundarySplatLiveHistory || !proto?.sampleBoundarySplatPbrCostLadder || !proto?.sampleBoundarySplatHistorySlotMetadata || !proto?.renderFrozenScaleToCanvas) return null;
      return proto.debugState();
    })()`).catch(() => null);
    if (state?.active && state?.backend) return state;
    await delay(150);
  }
  throw new Error('volume prototype did not become active with history-depth sockets');
}

async function waitForDepthTelemetry(requestedDepth) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const state = await debugState();
    if (Number(state?.boundarySplatHistoryDepth) === requestedDepth
      && Number(state?.boundarySplatHistoryAllocatedSlots) >= requestedDepth
      && Number(state?.boundarySplatRequestedInstanceCount) === 100
      && state?.boundarySplatPhaseSourceIdentity === PHASE_SOURCE
      && state?.boundarySplatBufferIntegrity?.ok === true) return state;
    await delay(125);
  }
  const state = await debugState();
  throw new Error(`effective-depth-telemetry-timeout:${JSON.stringify({ requestedDepth, state: compactState(state) })}`);
}

async function debugState() {
  return evaluate('window.__kaminosVolumePrototype?.debugState?.()');
}

async function hideHud() {
  return evaluate(`(() => {
    const element = document.getElementById('fps-counter');
    if (element) element.style.visibility = 'hidden';
    return { ok: true, found: !!element };
  })()`);
}

async function setCameraPose(pose) {
  return evaluate(`window.kaminosSetCameraDebugPose(${JSON.stringify(pose)})`, true);
}

async function targetIsReachable(targetPageId) {
  if (!targetPageId) return false;
  const pages = await cdpFetch('/json/list');
  return pages.some(page => page.id === targetPageId && page.type === 'page');
}

function sameCanonicalRoute(requested, effective) {
  return deepEqual(canonicalRouteIdentity(requested), canonicalRouteIdentity(effective));
}

function canonicalRouteIdentity(value) {
  const route = new URL(value);
  return {
    protocol: route.protocol,
    hostname: route.hostname,
    port: route.port || defaultPort(route.protocol),
    pathname: route.pathname,
    searchParams: canonicalRouteEntries(value),
    hash: route.hash,
  };
}

function canonicalRouteEntries(value) {
  const route = new URL(value);
  return [...route.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => (
    aKey.localeCompare(bKey) || aValue.localeCompare(bValue)
  ));
}

function defaultPort(protocol) {
  if (protocol === 'http:') return '80';
  if (protocol === 'https:') return '443';
  return '';
}

function runContractFixture(name) {
  if (name === 'route-substitution') {
    const requested = 'http://127.0.0.1:8139/fire/?a=1&b=2';
    const effective = 'http://127.0.0.1:8140/other/?b=2&a=1';
    if (sameCanonicalRoute(requested, effective)) throw new Error('route-substitution-was-accepted');
    throw new Error(`requested-effective-route-disagreement:${JSON.stringify({ requested, effective })}`);
  }
  if (name === 'periodic-motion') {
    const frames = fixtureFrames(['a', 'b', 'a', 'b'], [1, 2, 3, 4], [11, 12, 13, 14]);
    const cadence = summarizeCadence(frames);
    const motion = {
      distinctFrameHashCount: 2,
      observedExactPeriodFrames: detectExactPeriod(frames.map(frame => frame.sha256)),
      meanAdjacentPixelDelta: 1,
    };
    validateLiveMotion(frames, motion, cadence);
    return;
  }
  if (name === 'stalled-clocks') {
    const frames = fixtureFrames(['a', 'b', 'c', 'd'], [1, 1, 1, 1], [11, 11, 11, 11]);
    const cadence = summarizeCadence(frames);
    const motion = {
      distinctFrameHashCount: 4,
      observedExactPeriodFrames: null,
      meanAdjacentPixelDelta: 1,
    };
    validateLiveMotion(frames, motion, cadence);
    return;
  }
  throw new Error(`unknown-contract-fixture:${name}`);
}

function fixtureFrames(hashes, frameCounts, simStepCounts) {
  return hashes.map((sha, index) => ({
    sha256: sha,
    elapsedWallMs: index * 160,
    frameCount: frameCounts[index],
    simStepCount: simStepCounts[index],
  }));
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

function parsePng(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert.equal(data[8], 8, 'only 8-bit PNG screenshots are supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  assert.ok(channels, 'unsupported PNG color type');
  const raw = inflateSync(Buffer.concat(idat));
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
  const png = parsePng(buffer);
  let litPixels = 0;
  let luma = 0;
  let samples = 0;
  for (let y = Math.floor(png.height * 0.03); y < Math.floor(png.height * 0.97); y += 2) {
    for (let x = Math.floor(png.width * 0.03); x < Math.floor(png.width * 0.97); x += 2) {
      const index = x * png.channels;
      const value = 0.2126 * png.rows[y][index] + 0.7152 * png.rows[y][index + 1] + 0.0722 * png.rows[y][index + 2];
      luma += value;
      if (value > 18) litPixels += 1;
      samples += 1;
    }
  }
  return { width: png.width, height: png.height, samples, litPixels, meanLuma: samples ? luma / samples : 0 };
}

function imageDiff(pathA, pathB) {
  const a = parsePng(readFileSync(pathA));
  const b = parsePng(readFileSync(pathB));
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  let total = 0;
  let changed = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const ai = x * a.channels;
      const bi = x * b.channels;
      const delta = (
        Math.abs(a.rows[y][ai] - b.rows[y][bi])
        + Math.abs(a.rows[y][ai + 1] - b.rows[y][bi + 1])
        + Math.abs(a.rows[y][ai + 2] - b.rows[y][bi + 2])
      ) / 3;
      total += delta;
      if (delta > 3) changed += 1;
      samples += 1;
    }
  }
  return {
    meanAbsDiff: samples ? total / samples : 0,
    changedFraction: samples ? changed / samples : 0,
  };
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed.set(key, '1');
    else { parsed.set(key, next); index += 1; }
  }
  return parsed;
}

function parseHistoryDepths(value) {
  return String(value).split(',').map(item => positiveInteger(item.trim(), '--history-depths'));
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function nonnegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be a nonnegative integer`);
  return number;
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be positive`);
  return number;
}

function nonnegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be nonnegative`);
  return number;
}

function defaultChromePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
  ];
  return candidates.find(candidate => candidate.includes('/') ? existsSync(candidate) : true) || candidates[0];
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
