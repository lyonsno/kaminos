#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { measureBoundarySplatTemporalFrame } from './boundary-splat-temporal-collapse.mjs';
import { BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY } from './models/boundary-splat-attribute/live-support-h64-v0/boundary-splat-attribute-model.generated.js';

const SCHEMA = 'kaminos.volume.exact-state-cadence-witness.v0';
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXACT_STATE_CADENCE_GPU_IDENTITY = 'kaminos.volume.exact-state-cadence-gpu.v0';
const ONE_SIMULATOR_AUTHORITY = 'single-authoritative-simulator-completed-state-history-v0';
const PHASE_SOURCE = 'completed-exact-state-continuation-history';
const BOUNDARY_SPLAT_ANALYTIC_RENDERER_IDENTITY = 'live-boundary-sidecar-analytic-splats-v0';
const BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY = 'live-boundary-sidecar-learned-attribute-splats-v0';
const BOUNDARY_SPLAT_LEARNED_ATTRIBUTE_MODEL_IDENTITY = BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY;
const OWNED_SERVER_IDENTITY = 'exact-state-cadence-owned-http-server-v0';
const OWNED_BROWSER_IDENTITY = 'exact-state-cadence-owned-headless-browser-v0';
const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FORCED_UNDERFLOW_RAF_TIMESTAMP_SLACK_MS = 100;
const FORCED_UNDERFLOW_RESUME_ENVELOPE_MS = 30000;

const args = parseArgs(process.argv.slice(2));
const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-exact-state-cadence-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/exact-state-cadence-report.json`));
const port = Number(args.get('--chrome-port') || 19431);
const serverPort = Number(args.get('--server-port') || 18971);
const serverRoot = resolve(String(args.get('--server-root') || process.cwd()));
const chromeExecutable = resolve(String(args.get('--chrome') || DEFAULT_CHROME_PATH));
const requestedBrowserProfilePath = resolve(String(args.get('--browser-profile') || `${outDir}/chrome-profile`));
const settleMs = Number(args.get('--settle-ms') ?? 3000);
const sampleCount = Number(args.get('--samples') ?? 24);
const sampleIntervalMs = Number(args.get('--sample-interval-ms') ?? 50);
const requireHeldPresentation = ['1', 'true', 'yes', 'on'].includes(
  String(args.get('--require-held-presentation') || '').toLowerCase(),
);
const exerciseSplatToggle = ['1', 'true', 'yes', 'on'].includes(
  String(args.get('--exercise-splat-toggle') || '').toLowerCase(),
);
const forceUnderflowMs = Number(args.get('--force-underflow-ms') ?? 0);
const requestedWitnessConfig = {
  requireHeldPresentation,
  exerciseSplatToggle,
  forceUnderflowMs,
  sampleCount,
  sampleIntervalMs,
  settleMs,
};
const runStartedAt = new Date().toISOString();

let ws = null;
let browser = null;
let browserProcess = null;
let browserProfileOwned = false;
let server = null;
let serverProcess = null;
let browserPageId = null;
let browserPageUrl = null;
let failurePhase = 'startup';
let finalReport = null;
const lastTrustworthyEvidence = {};

mkdirSync(outDir, { recursive: true });
writeReport({
  schema: SCHEMA,
  status: 'running',
  failurePhase,
  runStartedAt,
  requestedRoute,
  requestedWitnessConfig,
});

try {
  validateInputs();

  failurePhase = 'server-seat';
  if (await portIsOpen(serverPort)) throw new Error(`server-port-already-in-use:${serverPort}`);

  failurePhase = 'server-launch';
  server = await launchOwnedServer();
  lastTrustworthyEvidence.server = server;

  failurePhase = 'browser-seat';
  if (await portIsOpen(port)) throw new Error(`browser-debug-port-already-in-use:${port}`);

  failurePhase = 'browser-launch';
  browser = await launchOwnedBrowser();
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
  await waitForPrototype();
  await delay(settleMs);
  await hideHud();
  const visibilityState = await evaluate('document.visibilityState');
  if (visibilityState !== 'visible') throw new Error(`owned-headless-page-not-visible:${visibilityState}`);

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

  if (exerciseSplatToggle) {
    failurePhase = 'splat-mode-transition';
    lastTrustworthyEvidence.splatModeTransition = await exerciseBoundarySplatModeTransition(effectivePageUrl);
  }

  failurePhase = 'cadence-sampling';
  const rows = [];
  if (forceUnderflowMs > 0) {
    const forcedHold = await forcePresentationUnderflow(effectivePageUrl);
    lastTrustworthyEvidence.forcedUnderflow = forcedHold.evidence;
    if (forcedHold.row) rows.push({ index: 0, sampledAt: new Date().toISOString(), ...forcedHold.row });
  }
  for (let index = rows.length; index < sampleCount; index += 1) {
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

  const finalState = await debugState();
  validateEffectiveState(finalState, effectivePageUrl);
  const sameBrowserTargetPreserved = await targetIsReachable(browserPageId);
  if (!sameBrowserTargetPreserved) throw new Error('browser-target-unreachable-after-cadence-witness');

  failurePhase = 'final-canvas';
  const finalCanvas = await captureCanvas('final');

  failurePhase = 'complete';
  finalReport = {
    schema: SCHEMA,
    status: 'passed',
    claimBoundary: 'one-live-simulator-bounded-completed-state-history-adjacent-interpolation-no-learned-prediction',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectivePageUrl,
    requestedEffectiveRouteAgreement: true,
    requestedWitnessConfig,
    server,
    browser,
    browserPageId,
    browserPageUrl: effectivePageUrl,
    sameBrowserTargetPreserved,
    route: compactState(finalState),
    requestedConfig: {
      ...requestedConfigFromUrl(effectivePageUrl),
      witness: requestedWitnessConfig,
    },
    sequence,
    rows,
    canvasPixelEvidence: {
      final: finalCanvas.receipt,
      captureCount: 1,
      temporalAuthority: 'cadence-sequence-telemetry-precedes-invasive-final-gpu-readback',
    },
    lastTrustworthyEvidence,
  };
} catch (error) {
  finalReport = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    failureClass: classifyFailure(error, failurePhase),
    error: error?.stack || error?.message || String(error),
    runStartedAt,
    failedAt: new Date().toISOString(),
    requestedRoute,
    requestedWitnessConfig,
    server,
    browser,
    browserPageId,
    browserPageUrl,
    lastTrustworthyEvidence,
  };
  console.error(finalReport.error);
  process.exitCode = 1;
} finally {
  const websocketCleanup = await captureCleanupOutcome('browser-websocket', async () => {
    if (!ws) return { closed: false, reason: 'not-opened' };
    ws.close();
    return { closed: true };
  });
  const browserCleanup = await captureCleanupOutcome('browser', () =>
    terminateOwnedProcess(browserProcess, 'browser'),
  );
  const serverCleanup = await captureCleanupOutcome('server', () =>
    terminateOwnedProcess(serverProcess, 'server'),
  );
  const browserProfileCleanup = await captureCleanupOutcome('browser-profile', async () => {
    if (!browserProfileOwned) {
      return { removed: false, reason: 'not-owned', path: requestedBrowserProfilePath };
    }
    if (!existsSync(requestedBrowserProfilePath)) {
      return { removed: false, reason: 'already-absent', path: requestedBrowserProfilePath };
    }
    rmSync(requestedBrowserProfilePath, { recursive: true, force: true });
    return { removed: true, path: requestedBrowserProfilePath };
  });
  finalReport ||= {
    schema: SCHEMA,
    status: 'failed',
    failurePhase: 'report-finalization',
    failureClass: 'report-finalization',
    error: 'witness completed without a final report',
    runStartedAt,
    requestedRoute,
    lastTrustworthyEvidence,
  };
  finalReport.processCleanup = {
    websocket: websocketCleanup,
    browser: browserCleanup,
    server: serverCleanup,
    browserProfile: browserProfileCleanup,
  };
  const cleanupFailures = Object.values(finalReport.processCleanup).filter(
    outcome => outcome.ok === false,
  );
  if (cleanupFailures.length > 0) {
    finalReport.status = 'failed';
    finalReport.failurePhase = 'cleanup';
    finalReport.failureClass = 'cleanup-failed';
    finalReport.error = cleanupFailures
      .map(outcome => `${outcome.label}: ${outcome.error}`)
      .join('\n');
    process.exitCode = 1;
  }
  finalReport.reportWrittenAt = new Date().toISOString();
  writeReport(finalReport);
  if (finalReport.status === 'passed') console.log(`exact-state cadence witness passed: ${reportPath}`);
}

function validateInputs() {
  if (!requestedRoute) throw new Error('missing --url');
  const route = new URL(requestedRoute);
  const params = route.searchParams;
  const expectedServerOrigin = `http://127.0.0.1:${serverPort}`;
  if (route.origin !== expectedServerOrigin) {
    throw new Error(`requested-server-origin-mismatch:${JSON.stringify({ requested: route.origin, expected: expectedServerOrigin })}`);
  }
  if (!['1', 'true', 'yes', 'on'].includes(String(params.get('volume_exact_state_cadence')).toLowerCase())) {
    throw new Error('cadence-request-missing-from-route');
  }
  requirePositiveInteger(port, '--chrome-port');
  requirePositiveInteger(serverPort, '--server-port');
  if (port === serverPort) throw new Error('browser-and-server-ports-must-differ');
  if (!existsSync(serverRoot) || !statSync(serverRoot).isDirectory()) throw new Error(`server-root-not-found:${serverRoot}`);
  if (!existsSync(chromeExecutable)) throw new Error(`chrome-executable-not-found:${chromeExecutable}`);
  requireNonnegativeNumber(settleMs, '--settle-ms');
  requirePositiveInteger(sampleCount, '--samples');
  requirePositiveNumber(sampleIntervalMs, '--sample-interval-ms');
  requireNonnegativeNumber(forceUnderflowMs, '--force-underflow-ms');
}

function requestedConfigFromUrl(url) {
  const params = new URL(url).searchParams;
  const requestedSplatMode = params.has('volume_boundary_splat_mode')
    ? String(params.get('volume_boundary_splat_mode') || 'off').toLowerCase().replace(/-/g, '_')
    : null;
  const requestedComposition = params.has('volume_boundary_splat_composition')
    ? String(params.get('volume_boundary_splat_composition') || 'proof').toLowerCase().replace(/_/g, '-')
    : null;
  const requestedPbrScene = params.has('volume_boundary_splat_pbr_scene')
    ? String(params.get('volume_boundary_splat_pbr_scene') || 'off').toLowerCase().replace(/_/g, '-')
    : null;
  const boundarySplatInstances = params.has('volume_boundary_splat_instances')
    ? Number(params.get('volume_boundary_splat_instances'))
    : null;
  const boundarySplatHistoryDepth = params.has('volume_boundary_splat_history_depth')
    ? Number(params.get('volume_boundary_splat_history_depth'))
    : null;
  return {
    requested: true,
    depth: Number(params.get('volume_cadence_depth')),
    delaySteps: Number(params.get('volume_cadence_delay_steps')),
    producerIntervalMs: Number(params.get('volume_cadence_producer_ms')),
    presentationStepMs: Number(params.get('volume_cadence_presentation_ms')),
    boundarySplatMode: ['analytic', 'learned'].includes(requestedSplatMode) ? requestedSplatMode : requestedSplatMode === null ? null : 'off',
    boundarySplatComposition: requestedComposition === null
      ? null
      : ['field', 'composed-field', 'field-100'].includes(requestedComposition) ? 'field' : 'proof',
    boundarySplatPbrScene: requestedPbrScene === null
      ? null
      : ['fire-field', 'pbr-fire-field', 'court'].includes(requestedPbrScene) ? 'fire-field' : 'off',
    boundarySplatInstances,
    boundarySplatHistoryDepth,
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
  if (expected.boundarySplatMode !== null && state?.boundarySplatMode !== expected.boundarySplatMode) mismatches.push(['boundarySplatMode', expected.boundarySplatMode, state?.boundarySplatMode]);
  if (expected.boundarySplatComposition !== null && state?.boundarySplatComposition !== expected.boundarySplatComposition) mismatches.push(['boundarySplatComposition', expected.boundarySplatComposition, state?.boundarySplatComposition]);
  if (expected.boundarySplatPbrScene !== null && state?.boundarySplatPbrScene !== expected.boundarySplatPbrScene) mismatches.push(['boundarySplatPbrScene', expected.boundarySplatPbrScene, state?.boundarySplatPbrScene]);
  if (expected.boundarySplatInstances !== null && Number(state?.boundarySplatRequestedInstanceCount) !== expected.boundarySplatInstances) {
    mismatches.push(['boundarySplatRequestedInstanceCount', expected.boundarySplatInstances, state?.boundarySplatRequestedInstanceCount]);
  }
  if (expected.boundarySplatHistoryDepth !== null && Number(state?.boundarySplatHistoryDepth) !== expected.boundarySplatHistoryDepth) {
    mismatches.push(['boundarySplatHistoryDepth', expected.boundarySplatHistoryDepth, state?.boundarySplatHistoryDepth]);
  }
  if (expected.boundarySplatHistoryDepth !== null && Number(state?.boundarySplatHistorySlots) !== expected.boundarySplatHistoryDepth) {
    mismatches.push(['boundarySplatHistorySlots', expected.boundarySplatHistoryDepth, state?.boundarySplatHistorySlots]);
  }
  if (expected.boundarySplatMode === 'learned') {
    if (state?.boundarySplatRendererIdentity !== BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY) mismatches.push(['boundarySplatRendererIdentity', BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY, state?.boundarySplatRendererIdentity]);
    if (state?.boundarySplatAttributeModelIdentity !== BOUNDARY_SPLAT_LEARNED_ATTRIBUTE_MODEL_IDENTITY) mismatches.push(['boundarySplatAttributeModelIdentity', BOUNDARY_SPLAT_LEARNED_ATTRIBUTE_MODEL_IDENTITY, state?.boundarySplatAttributeModelIdentity]);
    if (!(Number(state?.boundarySplatSourceCandidateCount) > 0)) mismatches.push(['boundarySplatSourceCandidateCount', '>0', state?.boundarySplatSourceCandidateCount]);
    if (!(Number(state?.boundarySplatSelectedCandidateCount) > 0)) mismatches.push(['boundarySplatSelectedCandidateCount', '>0', state?.boundarySplatSelectedCandidateCount]);
    if (!(Number(state?.boundarySplatInstanceCount) > 0)) mismatches.push(['boundarySplatInstanceCount', '>0', state?.boundarySplatInstanceCount]);
  }
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
    boundarySplatAttributeModelIdentity: state?.boundarySplatAttributeModelIdentity || null,
    boundarySplatComposition: state?.boundarySplatComposition || null,
    boundarySplatPbrScene: state?.boundarySplatPbrScene || null,
    boundarySplatRequestedInstanceCount: Number(state?.boundarySplatRequestedInstanceCount || 0),
    boundarySplatHistoryDepth: Number(state?.boundarySplatHistoryDepth || 0),
    boundarySplatHistorySlots: Number(state?.boundarySplatHistorySlots || 0),
    boundarySplatCandidateCount: Number(state?.boundarySplatCandidateCount || 0),
    boundarySplatSourceCandidateCount: Number(state?.boundarySplatSourceCandidateCount || 0),
    boundarySplatSelectedCandidateCount: Number(state?.boundarySplatSelectedCandidateCount || 0),
    boundarySplatInstanceCount: Number(state?.boundarySplatInstanceCount || 0),
    boundarySplatOverflowCount: Number(state?.boundarySplatOverflowCount || 0),
    boundarySplatCopyBytesThisFrame: Number(state?.boundarySplatCopyBytesThisFrame || 0),
    boundarySplatFallbackReason: state?.boundarySplatFallbackReason || null,
    timing: state?.timing ? { ...state.timing } : null,
    simCostLedger: state?.simCostLedger ? { ...state.simCostLedger } : null,
    controlGeneration: Number(state?.exactStateCadenceControlGeneration),
    producerReceipt,
    producerBackpressureCount: Number(state?.exactStateCadenceProducerBackpressureCount || 0),
    producerBackpressureReceipt: state?.exactStateCadenceProducerBackpressureReceipt || null,
    presentationReceipt,
    submittedPresentationReceipt: state?.exactStateCadenceSubmittedPresentationReceipt || null,
    presentationDisposition: state?.exactStateCadencePresentationDisposition || null,
    presentationHoldCount: Number(state?.exactStateCadencePresentationHoldCount || 0),
    presentationHoldReceipt: state?.exactStateCadencePresentationHoldReceipt || null,
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
  const submittedPresentationReceipt = row.submittedPresentationReceipt;
  const fromSourceStep = Number(presentationReceipt?.fromSourceStep);
  const toSourceStep = Number(presentationReceipt?.toSourceStep);
  const submittedReceiptFields = [
    'identity',
    'controlGeneration',
    'fromSourceStep',
    'toSourceStep',
    'fromSlot',
    'toSlot',
    'sourcePosition',
    'submittedAtMs',
  ];
  const matchesSubmittedPresentation = candidate => (
    candidate?.status === 'submitted-visible'
    && candidate?.encodedStatus === 'encoded-not-submitted'
    && Number.isFinite(Number(candidate?.submittedAtMs))
    && submittedReceiptFields.every(field => candidate[field] === presentationReceipt?.[field])
  );
  if (producerReceipt?.status !== 'completed') {
    throw new Error(`producer-receipt-not-completed:${index}:${JSON.stringify(producerReceipt)}`);
  }
  if (presentationReceipt?.status !== 'submitted-visible') {
    throw new Error(`presentation-receipt-not-submitted-visible:${index}:${JSON.stringify(presentationReceipt)}`);
  }
  if (!matchesSubmittedPresentation(submittedPresentationReceipt)) {
    throw new Error(`submitted-presentation-authority-mismatch:${index}:${JSON.stringify(row)}`);
  }
  if (toSourceStep - fromSourceStep !== 1) {
    throw new Error(`nonadjacent-presentation-bracket:${index}:${JSON.stringify(presentationReceipt)}`);
  }
  if (Number(presentationReceipt.controlGeneration) !== row.controlGeneration) {
    throw new Error(`cross-generation-presentation:${index}:${JSON.stringify(row)}`);
  }
  if (row.presentationDisposition === 'held-lead-underflow') {
    const hold = row.presentationHoldReceipt;
    if (
      hold?.status !== 'held-last-valid-presentation'
      || Number(hold.visibleSourcePosition) !== Number(presentationReceipt.sourcePosition)
      || Number(hold.visibleFromSourceStep) !== fromSourceStep
      || Number(hold.visibleToSourceStep) !== toSourceStep
      || Number(hold.attemptedSourcePosition) < Number(hold.visibleSourcePosition)
      || Number(hold.producerHeadSourceStep) < toSourceStep
      || !matchesSubmittedPresentation(hold.heldPresentationReceipt)
    ) {
      throw new Error(`cadence-held-presentation-mismatch:${index}:${JSON.stringify(row)}`);
    }
  } else if (row.presentationDisposition !== 'interpolated') {
    throw new Error(`cadence-presentation-disposition-unknown:${index}:${JSON.stringify(row)}`);
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
  const heldPresentationCount = rows.filter(
    row => row.presentationDisposition === 'held-lead-underflow',
  ).length;
  if (requireHeldPresentation && heldPresentationCount < 1) {
    throw new Error('required-held-presentation-not-observed');
  }
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
    heldPresentationCount,
    producerRafLocked: false,
    adjacentCompletedStateInterpolation: true,
    oneSimulatorAuthority: true,
  };
}

async function captureCanvas(label) {
  const sample = await evaluate(
    "window.__kaminosVolumePrototype.sampleFrame({ advanceSim: false, includeRgba: true, boundarySplatComposition: 'splat-only-v0' })",
    true,
  );
  const image = sample?.image;
  if (
    sample?.ok !== true
    || !Number.isInteger(image?.width)
    || !Number.isInteger(image?.height)
    || image.width < 16
    || image.height < 16
    || !Array.isArray(image?.rgba)
    || image.rgba.length !== image.width * image.height * 4
  ) {
    throw new Error(`gpu-texture-readback-unavailable:${JSON.stringify(compactReadbackSample(sample))}`);
  }
  validateReadbackSample(sample);
  const bytes = encodeRgbaPng(image.width, image.height, image.rgba);
  const metrics = measureBoundarySplatTemporalFrame(bytes);
  const path = resolve(outDir, `exact-state-cadence-${label}.png`);
  writeFileSync(path, bytes);
  const receipt = {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    readback: compactReadbackSample(sample),
    metrics,
    authority: 'gpu-texture-readback-no-simulator-advance-v0',
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

function validateReadbackSample(sample) {
  const mismatches = [];
  const expected = requestedConfigFromUrl(browserPageUrl || requestedRoute);
  if (sample?.simAdvanced !== false) mismatches.push(['simAdvanced', false, sample?.simAdvanced]);
  if (sample?.sampleAuthority !== 'render-only-exact-state-cadence-presentation-readback') {
    mismatches.push(['sampleAuthority', 'render-only-exact-state-cadence-presentation-readback', sample?.sampleAuthority]);
  }
  if (sample?.exactStateCadenceReadbackApplied !== true) {
    mismatches.push(['exactStateCadenceReadbackApplied', true, sample?.exactStateCadenceReadbackApplied]);
  }
  const exactStateCadenceReadbackDisposition = sample?.exactStateCadenceReadbackDisposition;
  if (!['interpolated', 'held-lead-underflow'].includes(exactStateCadenceReadbackDisposition)) {
    mismatches.push(['exactStateCadenceReadbackDisposition', 'interpolated|held-lead-underflow', exactStateCadenceReadbackDisposition]);
  }
  const exactStateCadenceReadbackReceipt = sample?.exactStateCadenceReadbackReceipt;
  if (exactStateCadenceReadbackReceipt?.status !== 'submitted-visible') {
    mismatches.push(['exactStateCadenceReadbackReceipt.status', 'submitted-visible', exactStateCadenceReadbackReceipt?.status]);
  }
  if (exactStateCadenceReadbackReceipt?.oneSimulatorAuthority !== ONE_SIMULATOR_AUTHORITY) {
    mismatches.push(['exactStateCadenceReadbackReceipt.oneSimulatorAuthority', ONE_SIMULATOR_AUTHORITY, exactStateCadenceReadbackReceipt?.oneSimulatorAuthority]);
  }
  if (exactStateCadenceReadbackReceipt?.phaseSource !== PHASE_SOURCE) {
    mismatches.push(['exactStateCadenceReadbackReceipt.phaseSource', PHASE_SOURCE, exactStateCadenceReadbackReceipt?.phaseSource]);
  }
  if (
    !Number.isFinite(exactStateCadenceReadbackReceipt?.fromSourceStep)
    || !Number.isFinite(exactStateCadenceReadbackReceipt?.toSourceStep)
    || exactStateCadenceReadbackReceipt.toSourceStep - exactStateCadenceReadbackReceipt.fromSourceStep !== 1
  ) {
    mismatches.push(['exactStateCadenceReadbackReceipt.sourceSteps', 'adjacent', exactStateCadenceReadbackReceipt]);
  }
  if (exactStateCadenceReadbackDisposition === 'held-lead-underflow') {
    const hold = sample?.exactStateCadenceReadbackHoldReceipt;
    if (
      hold?.status !== 'held-last-valid-presentation'
      || hold.heldPresentationReceipt?.status !== 'submitted-visible'
      || Number(hold.visibleSourcePosition) !== Number(exactStateCadenceReadbackReceipt?.sourcePosition)
    ) {
      mismatches.push(['exactStateCadenceReadbackHoldReceipt', 'submitted-visible held source matches readback', hold]);
    }
  }
  if (sample?.boundarySplatMode !== 'learned') mismatches.push(['boundarySplatMode', 'learned', sample?.boundarySplatMode]);
  if (sample?.boundarySplatRendererIdentity !== BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY) {
    mismatches.push(['boundarySplatRendererIdentity', BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY, sample?.boundarySplatRendererIdentity]);
  }
  if (sample?.boundarySplatAttributeModelIdentity !== BOUNDARY_SPLAT_LEARNED_ATTRIBUTE_MODEL_IDENTITY) {
    mismatches.push(['boundarySplatAttributeModelIdentity', BOUNDARY_SPLAT_LEARNED_ATTRIBUTE_MODEL_IDENTITY, sample?.boundarySplatAttributeModelIdentity]);
  }
  if (!(Number(sample?.boundarySplatCandidateCount) > 0)) mismatches.push(['boundarySplatCandidateCount', '>0', sample?.boundarySplatCandidateCount]);
  if (!(Number(sample?.boundarySplatInstanceCount) > 0)) mismatches.push(['boundarySplatInstanceCount', '>0', sample?.boundarySplatInstanceCount]);
  if (expected.boundarySplatInstances !== null && Number(sample?.boundarySplatRequestedInstanceCount) !== expected.boundarySplatInstances) {
    mismatches.push(['boundarySplatRequestedInstanceCount', expected.boundarySplatInstances, sample?.boundarySplatRequestedInstanceCount]);
  }
  if (expected.boundarySplatHistoryDepth !== null && Number(sample?.boundarySplatHistoryDepth) !== expected.boundarySplatHistoryDepth) {
    mismatches.push(['boundarySplatHistoryDepth', expected.boundarySplatHistoryDepth, sample?.boundarySplatHistoryDepth]);
  }
  if (expected.boundarySplatHistoryDepth !== null && Number(sample?.boundarySplatHistorySlots) !== expected.boundarySplatHistoryDepth) {
    mismatches.push(['boundarySplatHistorySlots', expected.boundarySplatHistoryDepth, sample?.boundarySplatHistorySlots]);
  }
  if (Number(sample?.boundarySplatOverflowCount || 0) !== 0) mismatches.push(['boundarySplatOverflowCount', 0, sample?.boundarySplatOverflowCount]);
  if (Number(sample?.boundarySplatCopyBytesThisFrame || 0) !== 0) mismatches.push(['boundarySplatCopyBytesThisFrame', 0, sample?.boundarySplatCopyBytesThisFrame]);
  if (sample?.boundarySplatFallbackReason != null) mismatches.push(['boundarySplatFallbackReason', null, sample?.boundarySplatFallbackReason]);
  if (sample?.boundarySplatReadbackCompositionEffective !== 'splat-only-v0') {
    mismatches.push(['boundarySplatReadbackCompositionEffective', 'splat-only-v0', sample?.boundarySplatReadbackCompositionEffective]);
  }
  if (sample?.boundarySplatReadbackPassReceipt?.splatApplied !== true || sample?.boundarySplatReadbackPassReceipt?.raymarchApplied !== false) {
    mismatches.push(['boundarySplatReadbackPassReceipt', 'splatApplied=true,raymarchApplied=false', sample?.boundarySplatReadbackPassReceipt]);
  }
  if (mismatches.length) throw new Error(`gpu-texture-readback-authority-mismatch:${JSON.stringify(mismatches)}`);
}

function compactReadbackSample(sample) {
  return {
    ok: sample?.ok === true,
    reason: sample?.reason || null,
    sampleAuthority: sample?.sampleAuthority || null,
    simAdvanced: sample?.simAdvanced ?? null,
    baseFrameCount: Number(sample?.baseFrameCount),
    baseSimStepCount: Number(sample?.baseSimStepCount),
    exactStateCadenceReadbackRequested: sample?.exactStateCadenceReadbackRequested ?? null,
    exactStateCadenceReadbackApplied: sample?.exactStateCadenceReadbackApplied ?? null,
    exactStateCadenceReadbackReceipt: sample?.exactStateCadenceReadbackReceipt || null,
    exactStateCadenceReadbackDisposition: sample?.exactStateCadenceReadbackDisposition || null,
    exactStateCadenceReadbackHoldReceipt: sample?.exactStateCadenceReadbackHoldReceipt || null,
    width: Number(sample?.width || sample?.image?.width || 0),
    height: Number(sample?.height || sample?.image?.height || 0),
    renderScale: Number(sample?.renderScale),
    frameCount: Number(sample?.frameCount),
    simStepCount: Number(sample?.simStepCount),
    meanLuma: Number(sample?.meanLuma),
    litPixels: Number(sample?.litPixels),
    fireLikePixels: Number(sample?.fireLikePixels),
    emissiveLikePixels: Number(sample?.emissiveLikePixels),
    boundarySplatMode: sample?.boundarySplatMode || null,
    boundarySplatRendererIdentity: sample?.boundarySplatRendererIdentity || null,
    boundarySplatAttributeModelIdentity: sample?.boundarySplatAttributeModelIdentity || null,
    boundarySplatRequestedInstanceCount: Number(sample?.boundarySplatRequestedInstanceCount || 0),
    boundarySplatHistoryDepth: Number(sample?.boundarySplatHistoryDepth || 0),
    boundarySplatHistorySlots: Number(sample?.boundarySplatHistorySlots || 0),
    boundarySplatCandidateCount: Number(sample?.boundarySplatCandidateCount || 0),
    boundarySplatInstanceCount: Number(sample?.boundarySplatInstanceCount || 0),
    boundarySplatOverflowCount: Number(sample?.boundarySplatOverflowCount || 0),
    boundarySplatCopyBytesThisFrame: Number(sample?.boundarySplatCopyBytesThisFrame || 0),
    boundarySplatFallbackReason: sample?.boundarySplatFallbackReason || null,
    boundarySplatReadbackCompositionEffective: sample?.boundarySplatReadbackCompositionEffective || null,
    boundarySplatReadbackPassReceipt: sample?.boundarySplatReadbackPassReceipt || null,
    advanceSimRequested: false,
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

async function exerciseBoundarySplatModeTransition(effectivePageUrl) {
  const requestedMode = requestedConfigFromUrl(effectivePageUrl).boundarySplatMode;
  if (!['analytic', 'learned'].includes(requestedMode)) {
    throw new Error(`splat-mode-transition-route-not-splat:${requestedMode}`);
  }
  const evidence = {
    identity: 'operator-control-splat-mode-roundtrip-v0',
    requestedMode,
    before: compactState(await debugState()),
    raymarch: null,
    restored: null,
  };
  lastTrustworthyEvidence.splatModeTransition = evidence;
  evidence.manualCameraClaim = await claimCurrentCameraForSplatTransition();

  evidence.raymarchDispatch = await dispatchBoundarySplatModeControl('off');
  const raymarchState = await waitForBoundarySplatMode('off');
  evidence.raymarch = compactState(raymarchState);
  evidence.raymarchControl = await boundarySplatModeControlState();
  evidence.raymarchRender = await captureRaymarchTransitionReceipt();
  if (
    evidence.raymarchDispatch?.ok !== true
    || evidence.raymarchControl?.value !== 'off'
    || raymarchState?.boundarySplatMode !== 'off'
  ) {
    throw new Error(`splat-mode-transition-off-not-effective:${JSON.stringify(evidence)}`);
  }

  evidence.restoredDispatch = await dispatchBoundarySplatModeControl(requestedMode);
  const restoredState = await waitForBoundarySplatMode(requestedMode, requestedMode === 'learned');
  evidence.restored = compactState(restoredState);
  evidence.restoredControl = await boundarySplatModeControlState();
  evidence.restoredCamera = await cameraStateForSplatTransition();
  evidence.cameraPoseAgreement = cameraPoseAgreement(
    evidence.manualCameraClaim?.camera,
    evidence.restoredCamera,
  );
  lastTrustworthyEvidence.splatModeTransition = evidence;
  if (
    evidence.restoredDispatch?.ok !== true
    || evidence.restoredControl?.value !== requestedMode
    || restoredState?.boundarySplatMode !== requestedMode
    || evidence.manualCameraClaim?.ok !== true
    || evidence.cameraPoseAgreement !== true
  ) {
    throw new Error(`splat-mode-transition-restore-not-effective:${JSON.stringify(evidence)}`);
  }
  try {
    validateEffectiveState(restoredState, effectivePageUrl);
  } catch (error) {
    throw new Error(
      `splat-mode-transition-restore-not-effective:${JSON.stringify(evidence)}:${error?.message || String(error)}`,
      { cause: error },
    );
  }
  return evidence;
}

async function claimCurrentCameraForSplatTransition() {
  return evaluate(`(() => {
    const camera = window.kaminosCameraDebugState?.();
    if (!camera?.position || !camera?.target) return { ok: false, reason: 'camera-debug-state-missing' };
    window.kaminosSetCameraDebugPose?.({ position: camera.position, target: camera.target });
    return {
      ok: window.__kaminosBoundarySplatCameraAuthority === 'debug-manual-camera-pose',
      authority: window.__kaminosBoundarySplatCameraAuthority || null,
      camera: window.kaminosCameraDebugState?.() || null,
    };
  })()`);
}

async function cameraStateForSplatTransition() {
  return evaluate('window.kaminosCameraDebugState?.() || null');
}

function cameraPoseAgreement(left, right, epsilon = 1e-6) {
  return ['position', 'target'].every(key => (
    Array.isArray(left?.[key])
    && Array.isArray(right?.[key])
    && left[key].length === right[key].length
    && left[key].every((value, index) => Math.abs(value - right[key][index]) <= epsilon)
  ));
}

async function captureRaymarchTransitionReceipt() {
  const sample = await evaluate(
    "window.__kaminosVolumePrototype.sampleFrame({ advanceSim: false, includeRgba: false, boundarySplatComposition: 'raymarch-only-v0' })",
    true,
  );
  const receipt = {
    ok: sample?.ok === true,
    sampleAuthority: sample?.sampleAuthority || null,
    simAdvanced: sample?.simAdvanced ?? null,
    frameCount: Number(sample?.frameCount),
    simStepCount: Number(sample?.simStepCount),
    litPixels: Number(sample?.litPixels || 0),
    composition: sample?.boundarySplatReadbackCompositionEffective || null,
    passReceipt: sample?.boundarySplatReadbackPassReceipt || null,
  };
  if (
    receipt.ok !== true
    || receipt.sampleAuthority !== 'render-only-exact-state-cadence-presentation-readback'
    || receipt.simAdvanced !== false
    || !(receipt.litPixels > 0)
    || receipt.composition !== 'raymarch-only-v0'
    || receipt.passReceipt?.raymarchApplied !== true
    || receipt.passReceipt?.splatApplied !== false
  ) {
    throw new Error(`splat-mode-transition-raymarch-render-not-effective:${JSON.stringify(receipt)}`);
  }
  return receipt;
}

async function dispatchBoundarySplatModeControl(mode) {
  return evaluate(`(() => {
    const control = document.getElementById('volume-boundary-splat-mode');
    if (!control) return { ok: false, reason: 'splat-mode-control-missing' };
    const before = control.value;
    control.value = ${JSON.stringify(mode)};
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      ok: control.value === ${JSON.stringify(mode)},
      requested: ${JSON.stringify(mode)},
      before,
      after: control.value,
      label: document.getElementById('volume-boundary-splat-mode-val')?.textContent || null,
      eventAuthority: 'real-control-change-handler-v0',
    };
  })()`);
}

async function boundarySplatModeControlState() {
  return evaluate(`(() => {
    const control = document.getElementById('volume-boundary-splat-mode');
    const row = control?.closest('.slider-row');
    const rect = row?.getBoundingClientRect();
    return {
      present: Boolean(control),
      value: control?.value || null,
      disabled: Boolean(control?.disabled),
      label: document.getElementById('volume-boundary-splat-mode-val')?.textContent || null,
      rowGeometry: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    };
  })()`);
}

async function waitForBoundarySplatMode(expectedMode, requirePopulation = false) {
  let lastState = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    lastState = await debugState();
    const populationSettled = !requirePopulation || (
      Number(lastState?.boundarySplatSourceCandidateCount) > 0
      && Number(lastState?.boundarySplatSelectedCandidateCount) > 0
      && Number(lastState?.boundarySplatInstanceCount) > 0
    );
    const rendererAuthoritySettled = expectedMode === 'learned'
      ? lastState?.boundarySplatRendererIdentity === BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY
        && lastState?.boundarySplatAttributeModelIdentity === BOUNDARY_SPLAT_LEARNED_ATTRIBUTE_MODEL_IDENTITY
      : expectedMode === 'off'
        ? lastState?.boundarySplatRendererIdentity === BOUNDARY_SPLAT_ANALYTIC_RENDERER_IDENTITY
          && lastState?.boundarySplatAttributeModelIdentity == null
        : true;
    if (
      lastState?.boundarySplatMode === expectedMode
      && populationSettled
      && rendererAuthoritySettled
      && lastState?.boundarySplatFallbackReason == null
    ) return lastState;
    await delay(125);
  }
  const failureName = expectedMode === 'off'
    ? 'splat-mode-transition-off-not-effective'
    : 'splat-mode-transition-restore-not-effective';
  throw new Error(`${failureName}:${JSON.stringify(compactState(lastState))}`);
}

async function forcePresentationUnderflow(effectivePageUrl) {
  const before = compactState(await debugState());
  const resumeTimeoutMs = forceUnderflowMs + FORCED_UNDERFLOW_RESUME_ENVELOPE_MS;
  let pressure;
  try {
    pressure = await evaluate(`(async () => {
      const prototype = window.__kaminosVolumePrototype;
      if (!prototype?.debugState) return { error: 'volume-prototype-missing' };
      const startedAt = performance.now();
      const durationMs = ${forceUnderflowMs};
      const resumedFrame = new Promise(resolveFrame => {
        requestAnimationFrame(firstRafNow => {
          requestAnimationFrame(resumedRafNow => resolveFrame({
            firstRafNow,
            resumedRafNow,
            state: prototype.debugState(),
          }));
        });
      });
      while (performance.now() - startedAt < durationMs) {}
      const finishedAt = performance.now();
      const resumed = await resumedFrame;
      return {
        requestedDurationMs: durationMs,
        observedDurationMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
        ...resumed,
      };
    })()`, true, resumeTimeoutMs, 'forced-underflow-resume-timeout');
  } catch (error) {
    const resumeTimedOut = error?.message?.includes('forced-underflow-resume-timeout');
    lastTrustworthyEvidence.forcedUnderflow = {
      status: resumeTimedOut
        ? 'pressure-resume-timeout'
        : 'pressure-evaluation-failed',
      pressureMode: 'owned-page-main-thread-block-v0',
      requestedDurationMs: forceUnderflowMs,
      resumeTimeoutMs,
      before,
      error: error?.message || String(error),
    };
    if (resumeTimedOut) throw error;
    throw new Error(
      `forced-underflow-pressure-evaluation-failed:${error?.message || String(error)}`,
      { cause: error },
    );
  }
  const evidence = {
    status: 'pressure-applied',
    pressureMode: 'owned-page-main-thread-block-v0',
    requestedDurationMs: forceUnderflowMs,
    observedDurationMs: Number(pressure?.observedDurationMs),
    firstResumedRafNow: Number(pressure?.firstRafNow),
    resumedRafNow: Number(pressure?.resumedRafNow),
    resumedRafElapsedMs: Number(pressure?.resumedRafNow) - Number(pressure?.firstRafNow),
    requiredResumedRafElapsedMs: Math.max(0, forceUnderflowMs - FORCED_UNDERFLOW_RAF_TIMESTAMP_SLACK_MS),
    resumeTimeoutMs,
    before,
  };
  if (
    pressure?.error
    || Number(pressure?.requestedDurationMs) !== forceUnderflowMs
    || !Number.isFinite(evidence.observedDurationMs)
    || evidence.observedDurationMs < forceUnderflowMs
  ) {
    evidence.status = 'pressure-duration-mismatch';
    evidence.error = pressure?.error || null;
    lastTrustworthyEvidence.forcedUnderflow = evidence;
    throw new Error(`forced-underflow-pressure-duration-mismatch:${JSON.stringify(evidence)}`);
  }
  if (
    !Number.isFinite(evidence.firstResumedRafNow)
    || !Number.isFinite(evidence.resumedRafNow)
    || evidence.resumedRafNow <= evidence.firstResumedRafNow
    || evidence.resumedRafElapsedMs < evidence.requiredResumedRafElapsedMs
  ) {
    evidence.status = 'raf-timestamp-mismatch';
    lastTrustworthyEvidence.forcedUnderflow = evidence;
    throw new Error(`forced-underflow-raf-timestamp-mismatch:${JSON.stringify(evidence)}`);
  }
  validateEffectiveState(pressure.state, effectivePageUrl);
  const resumed = compactState(pressure.state);
  evidence.resumed = resumed;
  if (resumed.presentationDisposition === 'held-lead-underflow') {
    validateCadenceRow(resumed, 0);
    evidence.status = 'held-observed';
    evidence.held = resumed;
    return { row: resumed, evidence };
  }
  evidence.status = 'hold-not-observed';
  return {
    row: null,
    evidence,
  };
}

async function waitForActiveCadence() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = await debugState();
    if (
      state?.exactStateCadenceRequested === true
      && state?.exactStateCadenceEffective === 'active'
      && state?.exactStateCadenceFallbackReason == null
      && state?.exactStateCadenceProducerReceipt?.status === 'completed'
      && state?.exactStateCadencePresentationReceipt?.status === 'submitted-visible'
    ) return state;
    if (state?.exactStateCadenceEffective === 'refused') {
      throw new Error(`cadence-runtime-refused:${state?.exactStateCadenceFallbackReason}`);
    }
    await delay(125);
  }
  throw new Error('exact-state-cadence-telemetry-did-not-settle');
}

async function launchOwnedServer() {
  const stdoutPath = resolve(outDir, 'owned-server.stdout.log');
  const stderrPath = resolve(outDir, 'owned-server.stderr.log');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  const child = spawn('/usr/bin/python3', [
    '-m',
    'http.server',
    String(serverPort),
    '--bind',
    '127.0.0.1',
    '--directory',
    serverRoot,
  ], {
    cwd: serverRoot,
    stdio: ['ignore', stdoutFd, stderrFd],
  });
  child.__launchError = null;
  child.once('error', error => { child.__launchError = error; });
  serverProcess = child;
  closeSync(stdoutFd);
  closeSync(stderrFd);
  await waitForPort(child, serverPort, 'owned-server-did-not-bind');
  return {
    identity: OWNED_SERVER_IDENTITY,
    ownership: 'launched-and-terminated-by-witness',
    processId: child.pid,
    executable: '/usr/bin/python3',
    serverRoot,
    serverPort,
    effectiveOrigin: `http://127.0.0.1:${serverPort}`,
    stdoutPath,
    stderrPath,
  };
}

async function launchOwnedBrowser() {
  if (existsSync(requestedBrowserProfilePath)) {
    throw new Error(`browser-profile-already-exists:${requestedBrowserProfilePath}`);
  }
  mkdirSync(requestedBrowserProfilePath, { recursive: true });
  browserProfileOwned = true;
  const stdoutPath = resolve(outDir, 'owned-browser.stdout.log');
  const stderrPath = resolve(outDir, 'owned-browser.stderr.log');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  const launchArgs = [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-default-apps',
    '--disable-component-update',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${requestedBrowserProfilePath}`,
    'about:blank',
  ];
  const child = spawn(chromeExecutable, launchArgs, {
    stdio: ['ignore', stdoutFd, stderrFd],
  });
  child.__launchError = null;
  child.once('error', error => { child.__launchError = error; });
  browserProcess = child;
  closeSync(stdoutFd);
  closeSync(stderrFd);
  await waitForPort(child, port, 'owned-browser-did-not-open-cdp');
  const version = await waitForCdpVersion(child);
  return {
    identity: OWNED_BROWSER_IDENTITY,
    ownership: 'launched-and-terminated-by-witness',
    processId: child.pid,
    executable: chromeExecutable,
    chromePort: port,
    browserProfilePath: requestedBrowserProfilePath,
    browserVersion: version.Browser || null,
    protocolVersion: version['Protocol-Version'] || null,
    launchArgs,
    stdoutPath,
    stderrPath,
  };
}

async function waitForCdpVersion(child) {
  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.__launchError) throw new Error(`owned-browser-did-not-open-cdp:launch-error:${child.__launchError.message}`);
    if (child.exitCode !== null) throw new Error(`owned-browser-did-not-open-cdp:process-exited:${child.exitCode}`);
    try {
      return await cdpFetch('/json/version');
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(`owned-browser-did-not-open-cdp:${lastError?.message || 'timeout'}`);
}

async function waitForPort(child, expectedPort, failureName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.__launchError) throw new Error(`${failureName}:launch-error:${child.__launchError.message}`);
    if (child.exitCode !== null) throw new Error(`${failureName}:process-exited:${child.exitCode}`);
    if (await portIsOpen(expectedPort)) return;
    await delay(50);
  }
  throw new Error(`${failureName}:timeout:${expectedPort}`);
}

function portIsOpen(expectedPort) {
  return new Promise(resolveOpen => {
    const socket = createConnection({ host: '127.0.0.1', port: expectedPort });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveOpen(value);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function captureCleanupOutcome(label, operation) {
  try {
    const receipt = await operation();
    return { ok: true, ...(receipt || {}), label };
  } catch (error) {
    return {
      ok: false,
      label,
      error: error?.stack || error?.message || String(error),
    };
  }
}

async function terminateOwnedProcess(child, label) {
  if (!child) return { label, ownedProcessStarted: false, terminated: true, signal: null };
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      label,
      ownedProcessStarted: true,
      processId: child.pid,
      terminated: true,
      exitCode: child.exitCode,
      signal: child.signalCode,
    };
  }
  child.kill('SIGTERM');
  if (await waitForProcessExit(child, 3000)) {
    return {
      label,
      ownedProcessStarted: true,
      processId: child.pid,
      terminated: true,
      exitCode: child.exitCode,
      signal: child.signalCode || 'SIGTERM',
    };
  }
  child.kill('SIGKILL');
  const terminated = await waitForProcessExit(child, 3000);
  return {
    label,
    ownedProcessStarted: true,
    processId: child.pid,
    terminated,
    exitCode: child.exitCode,
    signal: child.signalCode || 'SIGKILL',
  };
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolveExit => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once('exit', onExit);
  });
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function findPage() {
  const pages = await cdpFetch('/json/list');
  const page = pages.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('owned Chrome has no targetable page');
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

async function evaluate(expression, awaitPromise = false, timeoutMs = null, timeoutClass = 'runtime-evaluate-timeout') {
  const request = wsRequest('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  let timeoutId = null;
  let result;
  try {
    result = timeoutMs == null
      ? await request
      : await Promise.race([
        request,
        new Promise((_, rejectTimeout) => {
          timeoutId = setTimeout(
            () => rejectTimeout(new Error(`${timeoutClass}:${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
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
    'server-port-already-in-use',
    'browser-debug-port-already-in-use',
    'requested-server-origin-mismatch',
    'server-root-not-found',
    'chrome-executable-not-found',
    'browser-profile-already-exists',
    'owned-server-did-not-bind',
    'owned-browser-did-not-open-cdp',
    'requested-effective-route-mismatch',
    'splat-mode-transition-route-not-splat',
    'splat-mode-transition-off-not-effective',
    'splat-mode-transition-raymarch-render-not-effective',
    'splat-mode-transition-restore-not-effective',
    'stale-default-or-fallback-cadence-config',
    'cadence-runtime-refused',
    'volume-runtime-initialization-error',
    'producer-receipt-not-completed',
    'presentation-receipt-not-submitted-visible',
    'submitted-presentation-authority-mismatch',
    'nonadjacent-presentation-bracket',
    'cross-generation-presentation',
    'cadence-row-hidden-work-or-fallback',
    'cadence-interpolation-not-observed',
    'producer-remains-raf-locked',
    'presentation-source-regressed',
    'required-held-presentation-not-observed',
    'forced-underflow-pressure-duration-mismatch',
    'forced-underflow-raf-timestamp-mismatch',
    'forced-underflow-resume-timeout',
    'forced-underflow-pressure-evaluation-failed',
    'blank-or-partial-cadence-canvas',
    'gpu-texture-readback-unavailable',
    'gpu-texture-readback-authority-mismatch',
    'browser-target-unreachable-after-cadence-witness',
  ]) {
    if (message.includes(name)) return name;
  }
  return phase;
}

function encodeRgbaPng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const rgbaBytes = Buffer.from(rgba);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    rgbaBytes.copy(raw, row + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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
