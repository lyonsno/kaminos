#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, relative, resolve } from 'node:path';
import { inflateSync as zlibInflateSync } from 'node:zlib';
import {
  assessControlledHybridSmokeMotion,
  assessLiveCoupledSmokeMotion,
} from './smoke-splat-motion-source.mjs';
import { assessCoupledLiveSmokeFarEvidence } from './coupled-live-smoke-hierarchy.mjs';
import {
  deriveSpatialStrataHybridSmokeEffectiveRoute,
  parseSpatialStrataHybridSmokeWitnessRequest,
  requireHybridWitnessArtifactPath,
  requirePositiveHybridWitnessWallDelay,
  validateSpatialStrataHybridSmokeWitnessConfig,
} from './spatial-strata-hybrid-smoke-witness-contracts.mjs';
import {
  assertLiveControlRestored,
  assertLowerFrontRegionEvidence,
  assertSmokeResidualMotion,
  compactLiveControlState,
  selectFailureRendererIdentity,
} from './hybrid-raymarch-smoke-boundary-evidence.mjs';
import {
  buildSharedVolumeSettingsTarget,
  DEFAULT_SHARED_VOLUME_SETTINGS_STORE,
  resolveSharedVolumeSettingsPreset,
} from './volume-shared-settings-preset.mjs';

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
const HYBRID_SPATIAL_STRATA_RENDERER = 'hybrid-spatial-strata';
const HYBRID_SPATIAL_STRATA_DETERMINISM_REPEAT = 'hybrid-spatial-strata-determinism-repeat';
const LEARNED_FLAME_CONTROL_RENDERER = 'learned-splat-frozen-flame-control';
const HYBRID_RAYMARCH_BOUNDARY_ROUTE = 'hybrid-raymarch-smoke-boundary-v0';
const HYBRID_RAYMARCH_RENDERER = 'hybrid-raymarch-smoke';
const LEARNED_SPLAT_CONTROL_BEFORE = 'learned-splat-control-before';
const LEARNED_SPLAT_CONTROL_REPEAT_BEFORE = 'learned-splat-control-repeat-before';
const LEARNED_SPLAT_CONTROL_RESTORED = 'learned-splat-control-restored';
const HYBRID_RAYMARCH_EFFECTIVE_RENDERER = 'splat-depth-conditioned-front-back-smoke-compositor-v1';
const HYBRID_RAYMARCH_SMOKE_RENDERER = 'native-3d-compute-fluid-raymarch-smoke-only-v0';
const RESTORATION_PIXEL_TOLERANCE = Object.freeze({
  maxChannelDiff: 2,
  maxChangedPixelFraction: 0.00002,
  maxMeanAbsChannelDiff: 0.00001,
});
const SPATIAL_STRATA_EFFECTIVE_ROUTE = 'spatial-strata-hybrid-smoke-v0';
const HYBRID_SPATIAL_STRATA_EFFECTIVE_RENDERER = 'splat-depth-conditioned-front-back-smoke-compositor-v1+phase-matched-spatial-strata-front-back-raster-v0';
const INSTANCE_DESCRIPTOR_IDENTITY = 'boundary-splat-instance-descriptor-v0';
const SHARED_CURRENT_PHASE_SOURCE = 'shared-current-control';
const LIVE_HISTORY_PHASE_SOURCE = 'live-history-offset';
const SAME_HISTORY_SLOT_PHASE_SOURCE = 'same-history-slot-control';
const AGE_SWEEP_PHASE_SOURCE = 'age-sweep-history';
const MIXED_EFFECTIVE_PHASE_SOURCE = 'mixed-effective-phase-sources';
const PHASE_LAB_MODES = ['shared-current', 'same-history-slot', 'offset-history', 'age-sweep'];
const PHASE_SOURCE_IDENTITIES = new Set([
  SHARED_CURRENT_PHASE_SOURCE,
  LIVE_HISTORY_PHASE_SOURCE,
  SAME_HISTORY_SLOT_PHASE_SOURCE,
  AGE_SWEEP_PHASE_SOURCE,
  MIXED_EFFECTIVE_PHASE_SOURCE,
]);

const args = parseArgs(process.argv.slice(2));
const requestedRouteInput = String(args.get('--url') || '');
const settingsPresetRef = String(args.get('--settings-preset') || '');
const settingsStorePath = resolve(String(
  args.get('--settings-store') || DEFAULT_SHARED_VOLUME_SETTINGS_STORE,
));
let requestedRoute = requestedRouteInput;
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-motion-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/motion-witness-report.json`));
const evidenceRoot = resolve(String(args.get('--evidence-root') || process.cwd()));
const port = Math.max(1, Math.floor(Number(args.get('--chrome-port') || 19384)));
const chrome = String(args.get('--chrome') || process.env.CHROME || defaultChromePath());
const windowSize = String(args.get('--window-size') || '1280,960');
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2500));
const frameCount = Math.max(2, Math.floor(Number(args.get('--frames') || 6)));
const stepMs = Math.max(1, Number(args.get('--step-ms') || 2000));
const wallStepMs = Math.max(0, Number(args.get('--wall-step-ms') || 0));
const keepBrowserOpen = args.has('--keep-browser-open');
const hybridOnly = args.has('--hybrid-only');
const raymarchHybridBoundary = args.has('--raymarch-hybrid-boundary');
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
let requestedHybridSmokeConfig = null;
let settingsPresetReceipt = null;
let liveCoupledHybrid = false;
let failureReportPathValidated = !hybridOnly;
let liveWarmupStepIndex = 0;
const liveWarmupSessionId = `controlled-live-warmup-${runStartedAt}`;
const liveWarmupStartNowMs = Date.now();

try {
  if (hybridOnly && raymarchHybridBoundary) {
    throw new Error('--hybrid-only and --raymarch-hybrid-boundary are mutually exclusive');
  }
  if (hybridOnly) {
    requireHybridWitnessArtifactPath({ evidenceRoot, bundleRoot: outDir, artifact: reportPath });
    failureReportPathValidated = true;
  }
  if (!requestedRouteInput) throw new Error('missing --url');
  if (settingsPresetRef) {
    failurePhase = 'settings-preset-resolution';
    settingsPresetReceipt = resolveSharedVolumeSettingsPreset({
      storePath: settingsStorePath,
      presetRef: settingsPresetRef,
    });
    requestedRoute = buildSharedVolumeSettingsTarget(settingsPresetReceipt, requestedRouteInput).toString();
    lastTrustworthyEvidence.settingsPresetReceipt = compactSettingsPresetReceipt(settingsPresetReceipt);
  }
  if (hybridOnly) {
    requirePositiveHybridWitnessWallDelay(wallStepMs);
    requestedHybridSmokeConfig = parseSpatialStrataHybridSmokeWitnessRequest(requestedRoute);
    liveCoupledHybrid = requestedHybridSmokeConfig.sourceMode === 'live-coupled';
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
  await wsRequest('Page.bringToFront');
  if (liveCoupledHybrid) await waitForRequestedLiveRoute();
  const initialState = await debugState();
  validateRequestedEffectiveConfig(initialState);
  lastTrustworthyEvidence.initialState = compactState(initialState);
  const effectivePageUrl = await currentPageUrl();

  const requestedRouteIdentity = {
    requestedRoute,
    rendererIdentity: hybridOnly
      ? HYBRID_SPATIAL_STRATA_EFFECTIVE_RENDERER
      : (raymarchHybridBoundary ? HYBRID_RAYMARCH_EFFECTIVE_RENDERER : SPLAT_RENDERER),
    sourceAuthority: SOURCE_AUTHORITY,
    routeMode: raymarchHybridBoundary
      ? HYBRID_RAYMARCH_BOUNDARY_ROUTE
      : (hybridOnly
      ? (liveCoupledHybrid
          ? 'frame-locked-controlled-live-coupled-near-far-cdp-canvas-v1'
          : 'hybrid-spatial-strata-motion-falsification')
      : 'boundary-splat-motion-falsification'),
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

  failurePhase = 'live-far-warmup';
  const liveFarWarmup = liveCoupledHybrid ? await waitForLiveFarSmokeEvidence() : null;
  if (liveFarWarmup) lastTrustworthyEvidence.liveFarWarmup = liveFarWarmup;
  failurePhase = 'static-camera-capture';
  const staticSequence = await captureSequence(staticCamera);
  lastTrustworthyEvidence.staticSequence = compactSequenceEvidence(staticSequence);
  failurePhase = 'grazing-camera-capture';
  const grazingSequence = await captureSequence(grazingCamera);
  lastTrustworthyEvidence.grazingSequence = compactSequenceEvidence(grazingSequence);
  failurePhase = 'live-product-telemetry';
  const liveProductTelemetry = liveCoupledHybrid
    ? await inspectCoupledLiveSmokeProductTelemetry()
    : null;
  if (liveProductTelemetry) lastTrustworthyEvidence.liveProductTelemetry = liveProductTelemetry;
  const liveCoupledDomainTelemetry = liveCoupledHybrid
    ? summarizeLiveCoupledDomainTelemetry(await debugState())
    : null;
  if (liveCoupledDomainTelemetry) lastTrustworthyEvidence.liveCoupledDomainTelemetry = liveCoupledDomainTelemetry;
  const liveFarSmokeEvidence = liveCoupledHybrid
    ? assessCoupledLiveSmokeFarEvidence({
        products: liveProductTelemetry,
        domainTelemetry: liveCoupledDomainTelemetry,
      })
    : null;
  if (liveFarSmokeEvidence) lastTrustworthyEvidence.liveFarSmokeEvidence = liveFarSmokeEvidence;
  failurePhase = 'false-closure-validation';
  const report = {
    schema: SCHEMA,
    status: 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    requestedRouteInput,
    settingsPresetReceipt: compactSettingsPresetReceipt(settingsPresetReceipt),
    requestedRouteIdentity,
    effectiveRoute: raymarchHybridBoundary
      ? deriveRaymarchHybridBoundaryRoute([staticSequence, grazingSequence])
      : (hybridOnly
      ? deriveSpatialStrataHybridSmokeEffectiveRoute(
        [...staticSequence.frames, ...grazingSequence.frames]
          .map(frame => frame.captures.find(capture => capture.requestedRenderer === HYBRID_SPATIAL_STRATA_RENDERER)),
      )
      : staticSequence.effectiveRoute || grazingSequence.effectiveRoute || null),
    sourceAuthority: SOURCE_AUTHORITY,
    rendererIdentities: raymarchHybridBoundary
      ? [LEARNED_SPLAT_RENDERER, HYBRID_RAYMARCH_SMOKE_RENDERER, HYBRID_RAYMARCH_EFFECTIVE_RENDERER]
      : (hybridOnly
      ? [HYBRID_SPATIAL_STRATA_EFFECTIVE_RENDERER]
      : [SPLAT_RENDERER, LEARNED_SPLAT_RENDERER, RAYMARCH_RENDERER]),
    expectedLearnedModelIdentity: EXPECTED_LEARNED_MODEL,
    browser: {
      identity: browserSession.identity,
      mode: browserSession.mode,
      port,
      userDataDir,
      keepBrowserOpen,
      windowSize,
      pageUrl: effectivePageUrl,
      evidenceRoot,
    },
    captureConfig: {
      frameCount,
      stepMs,
      wallStepMs,
      requestedPhaseStride,
      requestedHistoryDepth,
      requestedHistoryFrameStride,
      hybridOnly,
      raymarchHybridBoundary,
      liveCoupledHybrid,
      staticCameraDurationMs: (frameCount - 1) * stepMs,
      grazingCameraDurationMs: (frameCount - 1) * stepMs,
    },
    frozenDeterminism: raymarchHybridBoundary
      ? computeRaymarchHybridRestoration(staticSequence.frames[0])
      : (hybridOnly
      ? computeHybridFrozenDeterminism(staticSequence.frames[0])
      : computeFrozenDeterminism(staticSequence.frames[0])),
    controlledSmokeMotion: hybridOnly
      ? (liveCoupledHybrid
          ? summarizePublishedLiveCoupledHybridSmokeMotion([staticSequence, grazingSequence])
          : summarizeControlledHybridSmokeMotion(staticSequence))
      : null,
    raymarchHybridBoundary: raymarchHybridBoundary
      ? summarizeRaymarchHybridBoundary([staticSequence, grazingSequence])
      : null,
    liveProductTelemetry,
    liveCoupledDomainTelemetry,
    liveFarSmokeEvidence,
    liveFarWarmup,
    analyticLearnedComparison: summarizeAnalyticLearnedComparison([...staticSequence.frames, ...grazingSequence.frames]),
    staticCamera: staticSequence,
    grazingCamera: grazingSequence,
    candidateChurn: summarizeCandidateChurn([...staticSequence.frames, ...grazingSequence.frames]),
    birthDeathTelemetry: summarizeBirthDeath([...staticSequence.frames, ...grazingSequence.frames]),
    duplicateMotionWitness: raymarchHybridBoundary
      ? null
      : summarizeDuplicateMotionWitness([...staticSequence.frames, ...grazingSequence.frames]),
    phaseLabWitness: raymarchHybridBoundary
      ? null
      : summarizePhaseLabWitness([...staticSequence.frames, ...grazingSequence.frames]),
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
      rejectsMissingSpatialStrataSource: hybridOnly,
    },
    claimBoundary: raymarchHybridBoundary
      ? 'Exact same-state learned-splat controls bracket smoke-only raymarch composition. This exposes lower-front visual behavior and motion, but does not yet prove a reduced-resolution or reduced-ray-count performance mode.'
      : (hybridOnly
      ? (liveCoupledHybrid
          ? 'Simulator-advancing learned-flame plus consecutive owned live-smoke products; this proves source coupling and one-step phase history, not final smoke quality or long-horizon recurrence.'
          : 'Moving learned-flame plus two-product spatial-strata smoke depth-composition witness; the two-product temporal horizon is explicit and does not prove recurrent smoke decode.')
      : undefined),
  };
  rejectFalseClosure(report);
  if (raymarchHybridBoundary) rejectRaymarchHybridBoundaryFalseClosure(report);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const failureReport = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedRoute,
    requestedRouteInput,
    settingsPresetRef: settingsPresetRef || null,
    settingsStorePath,
    settingsPresetReceipt: compactSettingsPresetReceipt(settingsPresetReceipt),
    rendererIdentity: selectFailureRendererIdentity({ hybridOnly, raymarchHybridBoundary }),
    requestedRouteIdentity: {
      requestedRoute,
      routeMode: raymarchHybridBoundary
        ? HYBRID_RAYMARCH_BOUNDARY_ROUTE
        : (hybridOnly ? SPATIAL_STRATA_EFFECTIVE_ROUTE : 'boundary-splat-motion-falsification'),
    },
    expectedLearnedModelIdentity: EXPECTED_LEARNED_MODEL,
    sourceAuthority: SOURCE_AUTHORITY,
    hybridOnly,
    raymarchHybridBoundary,
    evidenceRoot,
    browser: browserSession ? {
      identity: browserSession.identity,
      mode: browserSession.mode,
      port,
      userDataDir,
      keepBrowserOpen,
      windowSize,
    } : null,
    lastTrustworthyEvidence,
    reportWriteDisposition: failureReportPathValidated
      ? { status: 'written', path: reportPath }
      : { status: 'skipped-unvalidated-path', requestedPath: reportPath },
  };
  if (failureReportPathValidated) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(reportPath, JSON.stringify(failureReport, null, 2));
  }
  console.error(JSON.stringify(failureReport, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close?.(); } catch {}
  if (!keepBrowserOpen) browserSession?.process?.kill('SIGTERM');
}

function compactSettingsPresetReceipt(receipt) {
  if (!receipt) return null;
  return {
    requestedPresetRef: receipt.requestedPresetRef,
    alias: receipt.alias,
    label: receipt.label,
    presetId: receipt.presetId,
    contentHash: receipt.contentHash,
    schemaIdentity: receipt.schemaIdentity,
    controlCount: receipt.controlCount,
    writtenAt: receipt.writtenAt,
    source: { ...receipt.source },
    storePath: receipt.storePath,
    artifactPath: receipt.artifactPath,
    authority: receipt.authority,
  };
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
    hybridSmokeRepresentation: params.get('volume_hybrid_smoke_representation') || null,
    hybridSmokeSource: params.get('volume_hybrid_smoke_source') || 'offline-manifest',
    hybridSmokeManifestUrl: params.get('volume_hybrid_smoke_manifest') || null,
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
  if (hybridOnly) {
    if (expected.hybridSmokeRepresentation !== state?.hybridSmokeRepresentationRequested) {
      mismatches.push({
        key: 'hybridSmokeRepresentationRequested',
        requested: expected.hybridSmokeRepresentation,
        effective: state?.hybridSmokeRepresentationRequested ?? null,
      });
    }
    if (expected.hybridSmokeSource !== state?.hybridSmokeSourceRequested) {
      mismatches.push({
        key: 'hybridSmokeSourceRequested',
        requested: expected.hybridSmokeSource,
        effective: state?.hybridSmokeSourceRequested ?? null,
      });
    }
    const effectiveManifestUrl = state?.spatialStrataHybridSmokeManifestUrl || null;
    if (expected.hybridSmokeManifestUrl !== effectiveManifestUrl) {
      mismatches.push({
        key: 'spatialStrataHybridSmokeManifestUrl',
        requested: expected.hybridSmokeManifestUrl,
        effective: state?.spatialStrataHybridSmokeManifestUrl ?? null,
      });
    }
    if (state?.spatialStrataHybridSmokeSourceStatus !== 'loaded' || state?.hybridSmokeRepresentationEffective !== 'spatial-strata') {
      mismatches.push({
        key: 'spatialStrataHybridSmokeRoute',
        requested: 'loaded/spatial-strata',
        effective: `${state?.spatialStrataHybridSmokeSourceStatus ?? null}/${state?.hybridSmokeRepresentationEffective ?? null}`,
      });
    }
    try {
      validateSpatialStrataHybridSmokeWitnessConfig({
        requested: requestedHybridSmokeConfig,
        lifecycle: state?.spatialStrataHybridSmokeSourceLifecycle,
      });
    } catch (error) {
      mismatches.push({
        key: 'spatialStrataHybridSmokeConfigIdentity',
        requested: requestedHybridSmokeConfig,
        effective: state?.spatialStrataHybridSmokeSourceLifecycle ?? null,
        error: error?.message || String(error),
      });
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

async function advanceLiveCoupledWarmupStep() {
  const result = await wsRequest('Runtime.evaluate', {
    expression: `window.__kaminosVolumePrototype.controlledStepFrame(${JSON.stringify({
      controlledStepFrameIndex: liveWarmupStepIndex,
      advanceSim: true,
      sameBrowserSessionId: liveWarmupSessionId,
      startNow: liveWarmupStartNowMs,
      stepDeltaMs: 1000 / 60,
      renderScales: [1],
      includeRgba: false,
      compactSamples: true,
      resumeRenderLoop: false,
    })})`,
    awaitPromise: true,
    returnByValue: true,
  });
  const frame = result.result.value;
  if (frame?.ok !== true || frame.sequenceAuthority !== 'controlled-step-sequence-v0') {
    throw new Error(`controlled live warmup step failed: ${JSON.stringify(frame)}`);
  }
  liveWarmupStepIndex += 1;
  return frame;
}

async function waitForRequestedLiveRoute() {
  while (true) {
    const state = await debugState();
    if (state?.error) throw new Error(`live route failed during startup: ${state.error}`);
    if (
      state?.active === true
      && state?.spatialStrataHybridSmokeSourceStatus === 'loaded'
      && state?.hybridSmokeRepresentationEffective === 'spatial-strata'
      && state?.hybridSmokeSourceEffective === 'live-coupled'
      && state?.spatialStrataHybridSmokeDebug?.status === 'bound'
      && state?.spatialStrataHybridSmokeDebug?.temporalHorizonProducts === 2
    ) return state;
    await advanceLiveCoupledWarmupStep();
  }
}

async function inspectCoupledLiveSmokeProductTelemetry() {
  const result = await wsRequest('Runtime.evaluate', {
    expression: 'window.__kaminosVolumePrototype?.inspectCoupledLiveSmokeProductTelemetry?.()',
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`live smoke telemetry evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  const telemetry = result.result.value;
  if (!Array.isArray(telemetry) || telemetry.length !== 2) {
    throw new Error(`live smoke telemetry is missing or partial: ${JSON.stringify(telemetry)}`);
  }
  for (const product of telemetry) {
    if (
      product?.identity !== 'packed-live-smoke-product-telemetry-v0'
      || !(product?.nonzeroCounts?.total > 0)
      || !(product?.extinctionMass?.total > 0)
      || !Array.isArray(product?.occupiedBounds?.min)
      || !Array.isArray(product?.occupiedBounds?.max)
    ) {
      throw new Error(`live smoke product is empty or unauthoritative: ${JSON.stringify(product)}`);
    }
  }
  return telemetry;
}

async function waitForLiveFarSmokeEvidence() {
  const startedAtMs = Date.now();
  let pollCount = 0;
  let lastRejectedEvidence = null;
  while (true) {
    await advanceLiveCoupledWarmupStep();
    const state = await debugState();
    if (state?.active !== true || state?.error) {
      throw new Error(`live far-smoke warmup lost the active route: ${JSON.stringify(compactState(state))}`);
    }
    const domainTelemetry = summarizeLiveCoupledDomainTelemetry(state);
    try {
      const products = await inspectCoupledLiveSmokeProductTelemetry();
      const evidence = assessCoupledLiveSmokeFarEvidence({ products, domainTelemetry });
      return {
        status: 'passed',
        authority: 'state-driven-paused-exact-packed-far-warmup-v0',
        pollCount,
        elapsedMs: Date.now() - startedAtMs,
        evidence,
        productTokens: products.map(product => ({ ...product.phaseToken })),
        counterTelemetry: domainTelemetry,
        lastRejectedEvidence,
      };
    } catch (error) {
      lastRejectedEvidence = {
        message: error?.message || String(error),
        simulatorStepCount: state?.simStepCount ?? null,
        transferFrameCount: state?.smokeDomainTransferFrameCount ?? null,
        farActiveCells: domainTelemetry.smokeDomainFarActiveCells,
        farAdvectedActiveCells: domainTelemetry.smokeDomainFarAdvectedActiveCells,
        lastReadbackFrame: domainTelemetry.smokeDomainTransferLastReadbackFrame,
      };
    }
    pollCount += 1;
  }
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
        advanceSim: (!hybridOnly || liveCoupledHybrid) && frameIndex > 0,
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
    const learnedSplatControlBefore = raymarchHybridBoundary ? await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: LEARNED_SPLAT_CONTROL_BEFORE,
      boundarySplatMode: 'learned',
      boundarySplatComposition: 'splat-only',
    }) : null;
    const learnedSplatControlRepeatBefore = raymarchHybridBoundary ? await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: LEARNED_SPLAT_CONTROL_REPEAT_BEFORE,
      boundarySplatMode: 'learned',
      boundarySplatComposition: 'splat-only',
    }) : null;
    const hybridRaymarchSmoke = raymarchHybridBoundary ? await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: HYBRID_RAYMARCH_RENDERER,
      boundarySplatMode: 'learned',
      boundarySplatComposition: 'hybrid-smoke',
    }) : null;
    const learnedSplatControlRestored = raymarchHybridBoundary ? await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: LEARNED_SPLAT_CONTROL_RESTORED,
      boundarySplatMode: 'learned',
      boundarySplatComposition: 'splat-only',
    }) : null;
    const hybrid = hybridOnly ? await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: HYBRID_SPATIAL_STRATA_RENDERER,
      boundarySplatMode: 'learned',
    }) : null;
    const learnedFlameControl = hybridOnly ? await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: LEARNED_FLAME_CONTROL_RENDERER,
      boundarySplatMode: 'learned',
      boundarySplatComposition: 'splat-only',
    }) : null;
    const analytic = hybridOnly || raymarchHybridBoundary ? null : await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: 'analytic-splat',
      boundarySplatMode: 'analytic',
    });
    const learned = hybridOnly || raymarchHybridBoundary ? null : await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: 'learned-splat',
      boundarySplatMode: 'learned',
    });
    const raymarch = hybridOnly || raymarchHybridBoundary ? null : await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: RAYMARCH_RENDERER,
      boundarySplatMode: 'off',
    });
    const phaseLabCaptures = [];
    if (!hybridOnly && !raymarchHybridBoundary && config.label === 'staticCamera' && frameIndex === 0) {
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
    if (!raymarchHybridBoundary && config.label === 'staticCamera' && frameIndex === 0) {
      if (hybridOnly && wallStepMs > 0) await delay(wallStepMs);
      determinismRepeat = await captureRenderer({
        frameDir,
        frameIndex,
        scaleSet,
        camera,
        requestedRenderer: hybridOnly ? HYBRID_SPATIAL_STRATA_DETERMINISM_REPEAT : 'analytic-splat-determinism-repeat',
        boundarySplatMode: hybridOnly ? 'learned' : 'analytic',
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
      captures: [
        learnedSplatControlBefore,
        learnedSplatControlRepeatBefore,
        hybridRaymarchSmoke,
        learnedSplatControlRestored,
        hybrid,
        learnedFlameControl,
        analytic,
        learned,
        raymarch,
        ...phaseLabCaptures,
        determinismRepeat,
      ].filter(Boolean),
    });
  }
  const effectiveRoute = frames[0]?.captures[0]?.effectiveRoute || null;
  const sequence = {
    label: config.label,
    sequenceKind: config.sequenceKind,
    sameBrowserSessionId,
    sampleAuthority: raymarchHybridBoundary
      ? 'same-state-bracketed-raymarch-smoke-boundary-controlled-step-v0'
      : (hybridOnly && !liveCoupledHybrid
      ? 'frozen-simulator-controlled-smoke-time-v0'
      : (liveCoupledHybrid
          ? 'frame-locked-controlled-live-coupled-near-far-cdp-canvas-v1'
          : 'controlled-step-sim-advance')),
    frameCount,
    stepMs,
    sequenceDurationMs: (frameCount - 1) * stepMs,
    effectiveRoute,
    frames,
  };
  addMotionEnergy(sequence);
  if (raymarchHybridBoundary) {
    addRaymarchHybridSmokeDifferential(sequence);
    sequence.restorationDiagnostics = sequence.frames.map(frame => computeRaymarchHybridRestoration(frame));
  }
  if (liveCoupledHybrid) addLiveSmokeDifferential(sequence);
  return sequence;
}

async function captureRenderer({
  frameDir,
  frameIndex,
  scaleSet,
  camera,
  requestedRenderer,
  boundarySplatMode,
  boundarySplatComposition = null,
  boundarySplatPhaseMode = null,
  boundarySplatPhaseStride = null,
  boundarySplatHistoryDepth = null,
  boundarySplatHistoryFrameStride = null,
}) {
  const controlOverrides = { boundarySplatMode };
  if (boundarySplatComposition) controlOverrides.boundarySplatComposition = boundarySplatComposition;
  if (boundarySplatPhaseMode) controlOverrides.boundarySplatPhaseMode = boundarySplatPhaseMode;
  if (boundarySplatPhaseStride) controlOverrides.boundarySplatPhaseStride = boundarySplatPhaseStride;
  if (boundarySplatHistoryDepth) controlOverrides.boundarySplatHistoryDepth = boundarySplatHistoryDepth;
  if (boundarySplatHistoryFrameStride) controlOverrides.boundarySplatHistoryFrameStride = boundarySplatHistoryFrameStride;
  const preRenderLiveState = compactLiveControlState(await debugState());
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
    throw new Error(`renderer capture failed for ${requestedRenderer}: ${JSON.stringify({
      canvasCapture,
      result: canvasEval.result,
      exceptionDetails: canvasEval.exceptionDetails ?? null,
    })}`);
  }
  const postState = await debugState();
  const postRenderLiveState = compactLiveControlState(postState);
  const liveControlRestoration = assertLiveControlRestored({
    before: preRenderLiveState,
    after: postRenderLiveState,
  });
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
  const effectiveRenderer = canvasCapture.volumeReconstructionStyle;
  const fallbackReason = postState?.boundarySplatFallbackReason ?? canvasCapture.boundarySplatFallbackReason ?? null;
  const isSplat = boundarySplatMode !== 'off';
  const capture = {
    requestedRenderer,
    effectiveRenderer,
    fallbackReason,
    requestedRoute,
    effectiveRoute: canvasCapture.effectiveRoute,
    volumeEffectiveRoute: canvasCapture.effectiveRoute,
    rendererIdentity: canvasCapture.boundarySplatRendererIdentity || postState?.boundarySplatRendererIdentity || SPLAT_RENDERER,
    appliedModelIdentity: canvasCapture.boundarySplatAttributeModelIdentity ?? postState?.boundarySplatAttributeModelIdentity ?? null,
    sourceAuthority: postState?.boundarySplatSourceAuthority || SOURCE_AUTHORITY,
    boundarySplatInstanceDescriptorIdentity: isSplat ? canvasCapture.boundarySplatInstanceDescriptorIdentity ?? postState?.boundarySplatInstanceDescriptorIdentity ?? null : null,
    boundarySplatRequestedInstanceCount: isSplat ? canvasCapture.boundarySplatRequestedInstanceCount ?? postState?.boundarySplatRequestedInstanceCount ?? null : null,
    boundarySplatSourceCandidateCount: isSplat ? canvasCapture.boundarySplatSourceCandidateCount ?? postState?.boundarySplatSourceCandidateCount ?? null : null,
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
    boundarySplatCandidateCount: isSplat ? postState?.boundarySplatCandidateCount ?? null : null,
    boundarySplatInstanceCount: isSplat ? postState?.boundarySplatInstanceCount ?? null : null,
    boundarySplatOverflowCount: isSplat ? postState?.boundarySplatOverflowCount ?? null : null,
    boundarySplatCountAuthority: isSplat ? postState?.boundarySplatCountAuthority ?? null : null,
    boundarySplatCandidateCopyBytes: isSplat ? postState?.boundarySplatCopyBytesThisFrame ?? null : null,
    boundarySplatCandidateCopyDisposition: isSplat ? postState?.boundarySplatCopyDisposition ?? null : null,
    boundarySplatCompositionRequested: canvasCapture.boundarySplatCompositionRequested ?? postState?.boundarySplatCompositionRequested ?? null,
    boundarySplatCompositionEffective: canvasCapture.boundarySplatCompositionEffective ?? postState?.boundarySplatCompositionEffective ?? null,
    boundarySplatCompositionFallbackReason: canvasCapture.boundarySplatCompositionFallbackReason ?? postState?.boundarySplatCompositionFallbackReason ?? null,
    hybridSplatSmokeCompositorIdentity: canvasCapture.hybridSplatSmokeCompositorIdentity ?? postState?.hybridSplatSmokeCompositorIdentity ?? null,
    hybridSmokeLayer: canvasCapture.hybridSmokeLayer ?? postState?.hybridSmokeLayer ?? null,
    preRenderLiveState,
    postRenderLiveState,
    liveControlRestoration,
    frameStateIdentity: canvasCapture.frameStateIdentity ?? null,
    coupledPhaseStateToken: canvasCapture.coupledPhaseStateToken ?? null,
    hybridSmokeRepresentationRequested: canvasCapture.hybridSmokeRepresentationRequested ?? null,
    hybridSmokeRepresentationEffective: canvasCapture.hybridSmokeRepresentationEffective ?? null,
    hybridSmokeSourceRequested: canvasCapture.hybridSmokeSourceRequested ?? null,
    hybridSmokeSourceEffective: canvasCapture.hybridSmokeSourceEffective ?? null,
    spatialStrataHybridSmokeSourceStatus: canvasCapture.spatialStrataHybridSmokeSourceStatus ?? null,
    spatialStrataHybridSmokeFailureReason: canvasCapture.spatialStrataHybridSmokeFailureReason ?? null,
    spatialStrataHybridSmokeSourceLifecycle: canvasCapture.spatialStrataHybridSmokeSourceLifecycle ?? null,
    spatialStrataHybridSmokeConfigRequestedIdentity: canvasCapture.spatialStrataHybridSmokeConfigRequestedIdentity ?? null,
    spatialStrataHybridSmokeConfigEffectiveIdentity: canvasCapture.spatialStrataHybridSmokeConfigEffectiveIdentity ?? null,
    spatialStrataHybridSmokeRendererIdentity: canvasCapture.spatialStrataHybridSmokeRendererIdentity ?? null,
    spatialStrataHybridSmokeDebug: canvasCapture.spatialStrataHybridSmokeDebug ?? null,
    image: {
      path: artifactPath(imagePath),
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
      frameStateIdentity: canvasCapture.frameStateIdentity,
      coupledPhaseStateToken: canvasCapture.coupledPhaseStateToken,
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
      boundarySplatCompositionRequested: canvasCapture.boundarySplatCompositionRequested,
      boundarySplatCompositionEffective: canvasCapture.boundarySplatCompositionEffective,
      boundarySplatCompositionFallbackReason: canvasCapture.boundarySplatCompositionFallbackReason,
      hybridSplatSmokeCompositorIdentity: canvasCapture.hybridSplatSmokeCompositorIdentity,
      hybridSmokeLayer: canvasCapture.hybridSmokeLayer,
      preRenderLiveState,
      postRenderLiveState,
      liveControlRestoration,
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
  if (isHybridSpatialStrataCapture(capture)) {
    capture.effectiveRoute = deriveSpatialStrataHybridSmokeEffectiveRoute([capture]);
  }
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
  assertLiveControlRestored({
    before: capture.preRenderLiveState,
    after: capture.postRenderLiveState,
  });
  if (capture.image.metrics.litPixels <= 20 || capture.image.metrics.meanLuma <= 1) {
    throw new Error(`missing or blank capture: ${JSON.stringify({ requestedRenderer: capture.requestedRenderer, metrics: capture.image.metrics })}`);
  }
  if (isHybridSpatialStrataCapture(capture)) {
    if (capture.effectiveRenderer !== HYBRID_SPATIAL_STRATA_EFFECTIVE_RENDERER) {
      throw new Error(`renderer disagreement: requested hybrid spatial strata but effective renderer was ${capture.effectiveRenderer}`);
    }
    if (capture.rendererIdentity !== LEARNED_SPLAT_RENDERER) {
      throw new Error(`substituted learned flame rejected: got ${capture.rendererIdentity}`);
    }
    if (capture.appliedModelIdentity !== EXPECTED_LEARNED_MODEL) {
      throw new Error(`stale/default learned flame model rejected: ${capture.appliedModelIdentity}`);
    }
    if (capture.fallbackReason || capture.spatialStrataHybridSmokeFailureReason) {
      throw new Error(`fallback route rejected for hybrid spatial strata: ${capture.fallbackReason || capture.spatialStrataHybridSmokeFailureReason}`);
    }
    if (capture.hybridSmokeRepresentationEffective !== 'spatial-strata') {
      throw new Error(`effective hybrid smoke representation mismatch: ${capture.hybridSmokeRepresentationEffective}`);
    }
    if (capture.spatialStrataHybridSmokeSourceStatus !== 'loaded') {
      throw new Error(`missing or partial spatial strata source: ${capture.spatialStrataHybridSmokeSourceStatus}`);
    }
    const lifecycle = capture.spatialStrataHybridSmokeSourceLifecycle;
    if (
      lifecycle?.status !== 'loaded'
      || lifecycle?.hasRenderer !== true
      || !lifecycle?.requestedConfigIdentity
      || lifecycle.requestedConfigIdentity !== lifecycle.effectiveConfigIdentity
      || capture.spatialStrataHybridSmokeConfigRequestedIdentity !== capture.spatialStrataHybridSmokeConfigEffectiveIdentity
    ) {
      throw new Error(`stale or partial spatial strata source generation rejected: ${JSON.stringify(lifecycle)}`);
    }
    validateSpatialStrataHybridSmokeWitnessConfig({
      requested: requestedHybridSmokeConfig,
      lifecycle,
    });
    const smokeDebug = capture.spatialStrataHybridSmokeDebug;
    const hybridSmokeEffectiveRoute = deriveSpatialStrataHybridSmokeEffectiveRoute([capture]);
    if (capture.effectiveRoute !== hybridSmokeEffectiveRoute) {
      throw new Error(`hybrid smoke public route mismatch: ${capture.effectiveRoute} != ${hybridSmokeEffectiveRoute}`);
    }
    if (smokeDebug?.status !== 'bound' || smokeDebug?.temporalHorizonProducts !== 2) {
      throw new Error(`spatial strata phase plan is not bound to the explicit two-product horizon: ${JSON.stringify(smokeDebug)}`);
    }
    if (smokeDebug?.rejectedExtinctionMass !== 0 || !(smokeDebug?.drawInstanceCount > 0)) {
      throw new Error(`spatial strata accounting disagreement: ${JSON.stringify(smokeDebug)}`);
    }
    if (liveCoupledHybrid && (!capture.frameStateIdentity || !capture.coupledPhaseStateToken)) {
      throw new Error(`frame state identity missing for live coupled capture: ${JSON.stringify({
        frameStateIdentity: capture.frameStateIdentity,
        coupledPhaseStateToken: capture.coupledPhaseStateToken,
      })}`);
    }
  }
  if (capture.requestedRenderer === HYBRID_RAYMARCH_RENDERER) {
    if (capture.effectiveRenderer !== HYBRID_RAYMARCH_EFFECTIVE_RENDERER) {
      throw new Error(`renderer disagreement: requested hybrid raymarch smoke but effective renderer was ${capture.effectiveRenderer}`);
    }
    if (capture.rendererIdentity !== LEARNED_SPLAT_RENDERER || capture.appliedModelIdentity !== EXPECTED_LEARNED_MODEL) {
      throw new Error(`substituted learned flame rejected for hybrid raymarch smoke: ${capture.rendererIdentity}/${capture.appliedModelIdentity}`);
    }
    if (capture.fallbackReason || capture.boundarySplatCompositionFallbackReason) {
      throw new Error(`fallback route rejected for hybrid raymarch smoke: ${capture.fallbackReason || capture.boundarySplatCompositionFallbackReason}`);
    }
    if (capture.boundarySplatCompositionRequested !== 'hybrid-smoke'
        || capture.boundarySplatCompositionEffective !== 'hybrid-smoke') {
      throw new Error(`hybrid composition identity mismatch: ${capture.boundarySplatCompositionRequested}/${capture.boundarySplatCompositionEffective}`);
    }
    if (capture.hybridSmokeRepresentationEffective !== 'raymarch') {
      throw new Error(`effective hybrid smoke representation mismatch: ${capture.hybridSmokeRepresentationEffective}`);
    }
    if (capture.hybridSplatSmokeCompositorIdentity !== HYBRID_RAYMARCH_EFFECTIVE_RENDERER) {
      throw new Error(`hybrid compositor identity mismatch: ${capture.hybridSplatSmokeCompositorIdentity}`);
    }
    if (capture.hybridSmokeLayer?.rendererIdentity !== HYBRID_RAYMARCH_SMOKE_RENDERER
        || capture.hybridSmokeLayer?.excludedAuthority !== 'raymarched-flame-interface-emission') {
      throw new Error(`smoke-only layer authority mismatch: ${JSON.stringify(capture.hybridSmokeLayer)}`);
    }
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
  if (capture.requestedRenderer === 'learned-splat'
      || capture.requestedRenderer === LEARNED_FLAME_CONTROL_RENDERER
      || capture.requestedRenderer === LEARNED_SPLAT_CONTROL_BEFORE
      || capture.requestedRenderer === LEARNED_SPLAT_CONTROL_REPEAT_BEFORE
      || capture.requestedRenderer === LEARNED_SPLAT_CONTROL_RESTORED) {
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
    if ((capture.requestedRenderer === LEARNED_SPLAT_CONTROL_BEFORE
        || capture.requestedRenderer === LEARNED_SPLAT_CONTROL_REPEAT_BEFORE
        || capture.requestedRenderer === LEARNED_SPLAT_CONTROL_RESTORED)
        && (capture.boundarySplatCompositionRequested !== 'splat-only'
          || capture.boundarySplatCompositionEffective !== 'splat-only')) {
      throw new Error(`splat-only control identity mismatch: ${capture.boundarySplatCompositionRequested}/${capture.boundarySplatCompositionEffective}`);
    }
  }
  if (capture.requestedRenderer.includes('splat')
      || isHybridSpatialStrataCapture(capture)
      || capture.requestedRenderer === HYBRID_RAYMARCH_RENDERER) {
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
  if (raymarchHybridBoundary) return;
  if (hybridOnly) {
    const hashes = new Set();
    for (const sequence of [report.staticCamera, report.grazingCamera]) {
      if (sequence.sameBrowserSessionId !== sequence.frames[0]?.sameBrowserSessionId) {
        throw new Error(`same-browser identity missing for ${sequence.label}`);
      }
      for (const frame of sequence.frames) {
        const hybrid = frame.captures.find(capture => capture.requestedRenderer === HYBRID_SPATIAL_STRATA_RENDERER);
        const flameControl = frame.captures.find(capture => capture.requestedRenderer === LEARNED_FLAME_CONTROL_RENDERER);
        if (!hybrid) throw new Error(`partial hybrid report for ${sequence.label} frame ${frame.controlledStepFrameIndex}`);
        validateCapture(hybrid);
        if (!flameControl) throw new Error(`missing same-state flame control for ${sequence.label} frame ${frame.controlledStepFrameIndex}`);
        validateCapture(flameControl);
        if (liveCoupledHybrid && hybrid.frameStateIdentity !== flameControl.frameStateIdentity) {
          throw new Error(`hybrid/control frame state mismatch for ${sequence.label} frame ${frame.controlledStepFrameIndex}`);
        }
        hashes.add(hybrid.image.sha256);
      }
    }
    if (report.frozenDeterminism.ok !== true) {
      throw new Error(`frozen determinism failed: ${JSON.stringify(report.frozenDeterminism)}`);
    }
    if (liveCoupledHybrid && (!Array.isArray(report.liveProductTelemetry) || report.liveProductTelemetry.length !== 2)) {
      throw new Error(`missing live product telemetry: ${JSON.stringify(report.liveProductTelemetry)}`);
    }
    if (liveCoupledHybrid) {
      const domain = report.liveCoupledDomainTelemetry;
      if (domain?.smokeDomainTransferEncoded !== true) {
        throw new Error(`coupled smoke transfer is not encoded: ${JSON.stringify(domain)}`);
      }
      if (report.liveFarSmokeEvidence?.status !== 'passed') {
        throw new Error(`current packed far-smoke evidence is missing: ${JSON.stringify(report.liveFarSmokeEvidence)}`);
      }
    }
    try {
      if (liveCoupledHybrid) {
        summarizePublishedLiveCoupledHybridSmokeMotion([report.staticCamera, report.grazingCamera]);
      }
      else summarizeControlledHybridSmokeMotion(report.staticCamera);
    } catch (error) {
      throw new Error(`cached or static hybrid output rejected: ${error?.message || String(error)}`);
    }
    return;
  }
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

function rejectRaymarchHybridBoundaryFalseClosure(report) {
  const summary = report.raymarchHybridBoundary;
  if (summary?.status !== 'completed-pending-visual-disposition' || !Array.isArray(summary.frames) || summary.frames.length < 4) {
    throw new Error(`missing or partial raymarch hybrid boundary report: ${JSON.stringify(summary)}`);
  }
  for (const sequence of [report.staticCamera, report.grazingCamera]) {
    if (sequence.sameBrowserSessionId !== sequence.frames[0]?.sameBrowserSessionId) {
      throw new Error(`same-browser identity missing for ${sequence.label}`);
    }
    for (const [frameIndex, frame] of sequence.frames.entries()) {
      const before = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_BEFORE);
      const repeatBefore = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_REPEAT_BEFORE);
      const hybrid = frame.captures.find(capture => capture.requestedRenderer === HYBRID_RAYMARCH_RENDERER);
      const restored = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_RESTORED);
      if (!before || !repeatBefore || !hybrid || !restored) {
        throw new Error(`missing or partial bracketed captures for ${sequence.label}/${frame.controlledStepFrameIndex}`);
      }
      validateCapture(before);
      validateCapture(repeatBefore);
      validateCapture(hybrid);
      validateCapture(restored);
      const identities = [before, repeatBefore, hybrid, restored].map(capture => capture.frameStateIdentity);
      if (new Set(identities).size !== 1 || identities[0] !== frame.sameStateCaptureId) {
        throw new Error(`stale/default same-state identity mismatch for ${sequence.label}/${frame.controlledStepFrameIndex}: ${identities.join(',')}`);
      }
      const restoration = computeRaymarchHybridRestoration(frame);
      if (!restoration.ok || restoration.restorationPixelStable !== true) {
        throw new Error(`splat-only restoration failed for ${sequence.label}/${frame.controlledStepFrameIndex}: ${JSON.stringify(restoration)}`);
      }
      const lowerFrontRegion = sequence.smokeDifferential?.lowerFrontRegionDiffs?.[frameIndex];
      assertLowerFrontRegionEvidence(lowerFrontRegion);
    }
    assertSmokeResidualMotion(sequence.smokeDifferential);
  }
  if (summary.allRestorationsPixelStable !== true
      || summary.allLiveControlsRestored !== true
      || report.frozenDeterminism?.restorationPixelStable !== true) {
    throw new Error(`restoration authority incomplete: ${JSON.stringify(report.frozenDeterminism)}`);
  }
  assertSmokeResidualMotion(report.staticCamera.smokeDifferential);
}

function summarizeLiveCoupledDomainTelemetry(state) {
  const frameCount = Number(state?.frameCount ?? 0);
  const lastReadbackFrame = Number(state?.smokeDomainTransferLastReadbackFrame);
  const counterAgeFrames = Number.isFinite(lastReadbackFrame)
    ? Math.max(0, frameCount - lastReadbackFrame)
    : null;
  return {
    identity: 'live-coupled-domain-transfer-telemetry-v0',
    smokeDomainMode: state?.smokeDomainMode ?? null,
    smokeDomainHandoffStatus: state?.smokeDomainHandoffStatus ?? null,
    smokeDomainTransferEncoded: state?.smokeDomainTransferEncoded ?? null,
    smokeDomainTransferFrameCount: state?.smokeDomainTransferFrameCount ?? null,
    smokeDomainTransferActiveCells: Number(state?.smokeDomainTransferActiveCells ?? 0),
    smokeDomainFarActiveCells: Number(state?.smokeDomainFarActiveCells ?? 0),
    smokeDomainFarAdvectedActiveCells: Number(state?.smokeDomainFarAdvectedActiveCells ?? 0),
    smokeDomainFarHighestActiveLayer: Number(state?.smokeDomainFarHighestActiveLayer ?? 0),
    smokeDomainFarTopActiveCells: Number(state?.smokeDomainFarTopActiveCells ?? 0),
    smokeDomainFarOutflowCells: Number(state?.smokeDomainFarOutflowCells ?? 0),
    smokeDomainFarSupportLifetimeFrames: Number(state?.smokeDomainFarSupportLifetimeFrames ?? 0),
    smokeDomainTransferLastReadbackFrame: state?.smokeDomainTransferLastReadbackFrame ?? null,
    frameCount: state?.frameCount ?? null,
    counterAgeFrames,
    counterTelemetryFreshness: counterAgeFrames === 0 ? 'current-supporting' : 'stale-supporting-only',
  };
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

function computeHybridFrozenDeterminism(frame) {
  const first = frame.captures.find(capture => capture.requestedRenderer === HYBRID_SPATIAL_STRATA_RENDERER);
  const repeat = frame.captures.find(capture => capture.requestedRenderer === HYBRID_SPATIAL_STRATA_DETERMINISM_REPEAT);
  if (!first || !repeat) return { ok: false, reason: 'missing-repeat' };
  const diff = imageDiff(first.image.path, repeat.image.path);
  return {
    ok: diff.meanAbsDiff <= 0.02,
    authority: 'same-frozen-state-same-explicit-smoke-time-wall-delay-repeat-v0',
    first: first.image.path,
    repeat: repeat.image.path,
    ...diff,
  };
}

function computeRaymarchHybridRestoration(frame) {
  const before = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_BEFORE);
  const repeatBefore = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_REPEAT_BEFORE);
  const restored = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_RESTORED);
  if (!before || !repeatBefore || !restored) return { ok: false, reason: 'missing-bracket-control-or-repeat' };
  const repeatBaseline = exactPixelDiff(before.image.path, repeatBefore.image.path);
  const diff = exactPixelDiff(before.image.path, restored.image.path);
  const postHybridAgainstRepeat = exactPixelDiff(repeatBefore.image.path, restored.image.path);
  const restorationHashExact = before.image.sha256 === restored.image.sha256;
  const restorationPixelStable = diff.maxChannelDiff <= RESTORATION_PIXEL_TOLERANCE.maxChannelDiff
    && diff.changedPixelFraction <= RESTORATION_PIXEL_TOLERANCE.maxChangedPixelFraction
    && diff.meanAbsChannelDiff <= RESTORATION_PIXEL_TOLERANCE.maxMeanAbsChannelDiff;
  return {
    ok: restorationPixelStable,
    authority: 'same-state-splat-only-before-after-hybrid-decoded-pixel-restoration-v1',
    repeatBaselineAuthority: 'same-state-adjacent-splat-only-decoded-pixel-nondeterminism-floor-v0',
    repeatBaseline,
    postHybridAgainstRepeat,
    restorationHashExact,
    restorationPixelStable,
    restorationTolerance: RESTORATION_PIXEL_TOLERANCE,
    before: before.image.path,
    restored: restored.image.path,
    ...diff,
  };
}

function deriveRaymarchHybridBoundaryRoute(sequences) {
  const captures = sequences.flatMap(sequence => sequence.frames.map(frame => (
    frame.captures.find(capture => capture.requestedRenderer === HYBRID_RAYMARCH_RENDERER)
  )));
  if (!captures.length || captures.some(capture => !capture)) {
    throw new Error('partial hybrid raymarch smoke route');
  }
  for (const capture of captures) validateCapture(capture);
  return HYBRID_RAYMARCH_BOUNDARY_ROUTE;
}

function summarizeRaymarchHybridBoundary(sequences) {
  const frames = sequences.flatMap(sequence => sequence.frames.map((frame, frameIndex) => {
    const before = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_BEFORE);
    const repeatBefore = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_REPEAT_BEFORE);
    const hybrid = frame.captures.find(capture => capture.requestedRenderer === HYBRID_RAYMARCH_RENDERER);
    const restored = frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_RESTORED);
    if (!before || !repeatBefore || !hybrid || !restored) throw new Error(`partial bracketed hybrid frame ${sequence.label}/${frame.controlledStepFrameIndex}`);
    const restoration = computeRaymarchHybridRestoration(frame);
    return {
      sequence: sequence.label,
      controlledStepFrameIndex: frame.controlledStepFrameIndex,
      sameStateCaptureId: frame.sameStateCaptureId,
      frameStateIdentity: hybrid.frameStateIdentity,
      baseFrameCount: frame.baseFrameCount,
      baseSimStepCount: frame.baseSimStepCount,
      controlBefore: before.image,
      controlRepeatBefore: repeatBefore.image,
      hybrid: hybrid.image,
      controlRestored: restored.image,
      restoration,
      fullFrameContribution: imageDiff(before.image.path, hybrid.image.path),
      lowerFrontRegion: sequence.smokeDifferential?.lowerFrontRegionDiffs?.[frameIndex] ?? null,
      composition: {
        requested: hybrid.boundarySplatCompositionRequested,
        effective: hybrid.boundarySplatCompositionEffective,
        compositor: hybrid.hybridSplatSmokeCompositorIdentity,
        smokeLayer: hybrid.hybridSmokeLayer,
        fallbackReason: hybrid.boundarySplatCompositionFallbackReason || hybrid.fallbackReason,
      },
    };
  }));
  return {
    status: 'completed-pending-visual-disposition',
    authority: 'same-state-bracketed-lower-front-raymarch-smoke-boundary-v0',
    routeIdentity: HYBRID_RAYMARCH_BOUNDARY_ROUTE,
    frameCount: frames.length,
    allRestorationsPixelStable: frames.every(frame => frame.restoration.ok),
    allLiveControlsRestored: sequences.every(sequence => sequence.frames.every(frame => (
      frame.captures.every(capture => capture.liveControlRestoration?.status === 'passed')
    ))),
    frames,
  };
}

function summarizeControlledHybridSmokeMotion(sequence) {
  const hybridCaptures = sequence.frames.map(frame => (
    frame.captures.find(capture => capture.requestedRenderer === HYBRID_SPATIAL_STRATA_RENDERER)
  ));
  const flameControls = sequence.frames.map(frame => (
    frame.captures.find(capture => capture.requestedRenderer === LEARNED_FLAME_CONTROL_RENDERER)
  ));
  const flameControlMeanAbsDiffs = [];
  for (let index = 1; index < flameControls.length; index += 1) {
    if (!flameControls[index - 1] || !flameControls[index]) throw new Error('missing frozen learned-flame control capture');
    flameControlMeanAbsDiffs.push(imageDiff(flameControls[index - 1].image.path, flameControls[index].image.path).meanAbsDiff);
  }
  return assessControlledHybridSmokeMotion({
    sameTimeRepeatMeanAbsDiff: computeHybridFrozenDeterminism(sequence.frames[0]).meanAbsDiff,
    simulatorStepCounts: sequence.frames.map(frame => frame.baseSimStepCount),
    controlledTimesMs: sequence.frames.map(frame => frame.controlledStepNowMs),
    rendererElapsedSeconds: hybridCaptures.map(capture => capture?.spatialStrataHybridSmokeDebug?.lastElapsedSeconds),
    frameHashes: hybridCaptures.map(capture => capture?.image.sha256),
    adjacentMeanAbsDiffs: sequence.motionEnergy.diffs.map(diff => diff.meanAbsDiff),
    flameControlMeanAbsDiffs,
  });
}

function summarizeLiveCoupledHybridSmokeMotion(sequence) {
  const captures = sequence.frames.map(frame => (
    frame.captures.find(capture => capture.requestedRenderer === HYBRID_SPATIAL_STRATA_RENDERER)
  ));
  if (captures.some(capture => !capture)) throw new Error('missing live coupled hybrid capture');
  const newestProductTicks = captures.map(capture => (
    capture.spatialStrataHybridSmokeDebug?.productWriteTicks?.at(-1)
  ));
  return assessLiveCoupledSmokeMotion({
    simulatorStepCounts: sequence.frames.map(frame => frame.baseSimStepCount),
    newestProductTicks,
    frameStateIdentities: captures.map(capture => capture.frameStateIdentity),
    smokeContributionMeanAbsDiffs: sequence.smokeDifferential.smokeContributionMeanAbsDiffs,
    smokeResidualMotionMeanAbsDiffs: sequence.smokeDifferential.smokeResidualMotionMeanAbsDiffs,
  });
}

function summarizePublishedLiveCoupledHybridSmokeMotion(sequences) {
  if (!Array.isArray(sequences) || sequences.length === 0) {
    throw new Error('published live coupled smoke motion requires at least one sequence');
  }
  const summaries = {};
  for (const sequence of sequences) {
    if (!sequence?.label || Object.hasOwn(summaries, sequence.label)) {
      throw new Error(`published live coupled smoke sequence label is invalid: ${sequence?.label}`);
    }
    summaries[sequence.label] = summarizeLiveCoupledHybridSmokeMotion(sequence);
  }
  return {
    status: 'passed',
    authority: 'all-published-camera-sequences-live-smoke-residual-motion-v0',
    sequenceLabels: Object.keys(summaries),
    ...summaries,
  };
}

function isHybridSpatialStrataCapture(capture) {
  return capture?.requestedRenderer === HYBRID_SPATIAL_STRATA_RENDERER
    || capture?.requestedRenderer === HYBRID_SPATIAL_STRATA_DETERMINISM_REPEAT;
}

function primaryMotionRenderer() {
  if (raymarchHybridBoundary) return HYBRID_RAYMARCH_RENDERER;
  return hybridOnly ? HYBRID_SPATIAL_STRATA_RENDERER : 'analytic-splat';
}

function summarizeCandidateChurn(frames) {
  const targetRenderer = primaryMotionRenderer();
  const counts = frames.map(frame => frame.captures.find(capture => capture.requestedRenderer === targetRenderer)?.boundarySplatCandidateCount)
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
  const targetRenderer = primaryMotionRenderer();
  const analyticCaptures = sequence.frames.map(frame => frame.captures.find(capture => capture.requestedRenderer === targetRenderer));
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

function addRaymarchHybridSmokeDifferential(sequence) {
  const pairs = sequence.frames.map(frame => ({
    hybrid: frame.captures.find(capture => capture.requestedRenderer === HYBRID_RAYMARCH_RENDERER),
    flame: frame.captures.find(capture => capture.requestedRenderer === LEARNED_SPLAT_CONTROL_REPEAT_BEFORE),
  }));
  if (pairs.some(pair => !pair.hybrid || !pair.flame)) {
    throw new Error('raymarch hybrid smoke differential requires hybrid and same-state splat-only captures');
  }
  const residualMotionDiffs = [];
  for (let index = 1; index < pairs.length; index += 1) {
    residualMotionDiffs.push(smokeResidualImageDiff(pairs[index - 1], pairs[index]));
  }
  sequence.smokeDifferential = {
    authority: 'same-state-raymarch-hybrid-minus-splat-control-residual-v1',
    contributionDiffs: pairs.map(pair => imageDiff(pair.flame.image.path, pair.hybrid.image.path)),
    lowerFrontRegionDiffs: pairs.map(pair => lowerFrontRegionDiff(pair.flame.image.path, pair.hybrid.image.path)),
    smokeResidualMotionDiffs: residualMotionDiffs,
    smokeResidualMotionMeanAbsDiffs: residualMotionDiffs.map(diff => diff.meanAbsDiff),
    smokeResidualMotionChangedFractions: residualMotionDiffs.map(diff => diff.changedFraction),
  };
}

function addLiveSmokeDifferential(sequence) {
  const pairs = sequence.frames.map(frame => ({
    hybrid: frame.captures.find(capture => capture.requestedRenderer === HYBRID_SPATIAL_STRATA_RENDERER),
    flame: frame.captures.find(capture => capture.requestedRenderer === LEARNED_FLAME_CONTROL_RENDERER),
  }));
  if (pairs.some(pair => !pair.hybrid || !pair.flame)) {
    throw new Error('live smoke differential requires hybrid and same-state flame-control captures');
  }
  for (const pair of pairs) {
    if (pair.hybrid.frameStateIdentity !== pair.flame.frameStateIdentity) {
      throw new Error(`live smoke differential frame state mismatch: ${pair.hybrid.frameStateIdentity} != ${pair.flame.frameStateIdentity}`);
    }
  }
  const contributionDiffs = pairs.map(pair => imageDiff(pair.hybrid.image.path, pair.flame.image.path));
  const residualMotionDiffs = [];
  for (let index = 1; index < pairs.length; index += 1) {
    residualMotionDiffs.push(smokeResidualImageDiff(pairs[index - 1], pairs[index]));
  }
  sequence.smokeDifferential = {
    authority: 'same-state-hybrid-minus-flame-control-residual-v1',
    frameStateIdentities: pairs.map(pair => pair.hybrid.frameStateIdentity),
    contributionDiffs,
    residualMotionDiffs,
    smokeContributionMeanAbsDiffs: contributionDiffs.map(diff => diff.meanAbsDiff),
    smokeResidualMotionMeanAbsDiffs: residualMotionDiffs.map(diff => diff.meanAbsDiff),
  };
}

function compactSequenceEvidence(sequence) {
  return {
    label: sequence.label,
    sampleAuthority: sequence.sampleAuthority,
    frameCount: sequence.frameCount,
    stepMs: sequence.stepMs,
    sequenceDurationMs: sequence.sequenceDurationMs,
    motionEnergy: sequence.motionEnergy,
    smokeDifferential: sequence.smokeDifferential ?? null,
    restorationDiagnostics: sequence.restorationDiagnostics ?? null,
    frames: sequence.frames.map(frame => {
      const capture = frame.captures.find(item => item.requestedRenderer === primaryMotionRenderer());
      return {
        controlledStepFrameIndex: frame.controlledStepFrameIndex,
        controlledStepNowMs: frame.controlledStepNowMs,
        baseFrameCount: frame.baseFrameCount,
        baseSimStepCount: frame.baseSimStepCount,
        image: capture?.image ?? null,
        frameStateIdentity: capture?.frameStateIdentity ?? null,
        smokeElapsedSeconds: capture?.spatialStrataHybridSmokeDebug?.lastElapsedSeconds ?? null,
      };
    }),
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

function exactPixelDiff(pathA, pathB) {
  const a = parsePngRgba(readBuffer(pathA));
  const b = parsePngRgba(readBuffer(pathB));
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  let changedPixels = 0;
  let changedChannels = 0;
  let totalChannelDiff = 0;
  let maxChannelDiff = 0;
  for (let y = 0; y < height; y += 1) {
    const rowA = a.rows[y];
    const rowB = b.rows[y];
    for (let x = 0; x < width; x += 1) {
      const indexA = x * a.channels;
      const indexB = x * b.channels;
      let pixelChanged = false;
      for (let channel = 0; channel < 3; channel += 1) {
        const diff = Math.abs(rowA[indexA + channel] - rowB[indexB + channel]);
        totalChannelDiff += diff;
        maxChannelDiff = Math.max(maxChannelDiff, diff);
        if (diff > 0) {
          pixelChanged = true;
          changedChannels += 1;
        }
      }
      if (pixelChanged) changedPixels += 1;
    }
  }
  const pixelCount = width * height;
  const channelCount = pixelCount * 3;
  return {
    width,
    height,
    pixelCount,
    changedPixels,
    changedPixelFraction: pixelCount ? changedPixels / pixelCount : 0,
    changedChannels,
    maxChannelDiff,
    meanAbsChannelDiff: channelCount ? totalChannelDiff / channelCount : 0,
  };
}

function lowerFrontRegionDiff(controlPath, hybridPath) {
  const control = parsePngRgba(readBuffer(controlPath));
  const hybrid = parsePngRgba(readBuffer(hybridPath));
  const width = Math.min(control.width, hybrid.width);
  const height = Math.min(control.height, hybrid.height);
  const component = largestConnectedLitComponent(control, width, height);
  if (!component || component.sampleCount <= 0) {
    throw new Error('lower-front region cannot be derived from blank splat control');
  }
  const { minX, minY, maxX, maxY } = component.bounds;
  const supportWidth = Math.max(1, maxX - minX + 1);
  const supportHeight = Math.max(1, maxY - minY + 1);
  const region = {
    x0: Math.max(0, Math.floor(minX - supportWidth * 0.1)),
    x1: Math.min(width, Math.ceil(maxX + supportWidth * 0.1 + 1)),
    y0: Math.max(0, Math.floor(minY + supportHeight * 0.5)),
    y1: Math.min(height, Math.ceil(maxY + supportHeight * 0.1 + 1)),
  };
  let total = 0;
  let changed = 0;
  let supportPixels = 0;
  let samples = 0;
  for (let y = region.y0; y < region.y1; y += 1) {
    const controlRow = control.rows[y];
    const hybridRow = hybrid.rows[y];
    for (let x = region.x0; x < region.x1; x += 1) {
      const controlIndex = x * control.channels;
      const hybridIndex = x * hybrid.channels;
      const controlLuma = 0.2126 * controlRow[controlIndex]
        + 0.7152 * controlRow[controlIndex + 1]
        + 0.0722 * controlRow[controlIndex + 2];
      if (controlLuma > 18) supportPixels += 1;
      const diff = (
        Math.abs(controlRow[controlIndex] - hybridRow[hybridIndex])
        + Math.abs(controlRow[controlIndex + 1] - hybridRow[hybridIndex + 1])
        + Math.abs(controlRow[controlIndex + 2] - hybridRow[hybridIndex + 2])
      ) / 3;
      total += diff;
      if (diff > 3) changed += 1;
      samples += 1;
    }
  }
  return {
    authority: 'largest-connected-splat-support-lower-front-smoke-residual-v1',
    region,
    supportBounds: { minX, minY, maxX, maxY },
    supportComponent: component,
    samples,
    supportPixels,
    supportDensity: samples ? supportPixels / samples : 0,
    componentFractionOfLitSupport: component.fractionOfLitSupport,
    regionFrameAreaFraction: width * height > 0 ? samples / (width * height) : 0,
    meanAbsDiff: samples ? total / samples : 0,
    changedFraction: samples ? changed / samples : 0,
    smokeResidualMeanAbsDiff: samples ? total / samples : 0,
    smokeResidualChangedPixels: changed,
    smokeResidualChangedFraction: samples ? changed / samples : 0,
  };
}

function largestConnectedLitComponent(png, width, height) {
  const stride = 2;
  const gridWidth = Math.ceil(width / stride);
  const gridHeight = Math.ceil(height / stride);
  const cellCount = gridWidth * gridHeight;
  const lit = new Uint8Array(cellCount);
  let litSampleCount = 0;
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    const y = Math.min(height - 1, gridY * stride);
    const row = png.rows[y];
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const x = Math.min(width - 1, gridX * stride);
      const index = x * png.channels;
      const luma = 0.2126 * row[index] + 0.7152 * row[index + 1] + 0.0722 * row[index + 2];
      if (luma <= 18) continue;
      lit[gridY * gridWidth + gridX] = 1;
      litSampleCount += 1;
    }
  }
  if (litSampleCount === 0) return null;

  const visited = new Uint8Array(cellCount);
  const queue = new Int32Array(cellCount);
  let largest = null;
  for (let seed = 0; seed < cellCount; seed += 1) {
    if (!lit[seed] || visited[seed]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    visited[seed] = 1;
    let sampleCount = 0;
    let minGridX = gridWidth;
    let minGridY = gridHeight;
    let maxGridX = -1;
    let maxGridY = -1;
    let sumX = 0;
    let sumY = 0;
    while (head < tail) {
      const cell = queue[head++];
      const gridY = Math.floor(cell / gridWidth);
      const gridX = cell - gridY * gridWidth;
      sampleCount += 1;
      minGridX = Math.min(minGridX, gridX);
      minGridY = Math.min(minGridY, gridY);
      maxGridX = Math.max(maxGridX, gridX);
      maxGridY = Math.max(maxGridY, gridY);
      sumX += gridX * stride;
      sumY += gridY * stride;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = gridX + dx;
          const nextY = gridY + dy;
          if (nextX < 0 || nextX >= gridWidth || nextY < 0 || nextY >= gridHeight) continue;
          const next = nextY * gridWidth + nextX;
          if (!lit[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (!largest || sampleCount > largest.sampleCount) {
      largest = {
        sampleCount,
        bounds: {
          minX: minGridX * stride,
          minY: minGridY * stride,
          maxX: Math.min(width - 1, maxGridX * stride),
          maxY: Math.min(height - 1, maxGridY * stride),
        },
        centroid: {
          x: sumX / sampleCount,
          y: sumY / sampleCount,
        },
      };
    }
  }
  return {
    ...largest,
    litSampleCount,
    fractionOfLitSupport: largest.sampleCount / litSampleCount,
    connectivity: 'eight-neighbor-on-two-pixel-luma-mask',
    lumaThreshold: 18,
  };
}

function smokeResidualImageDiff(previous, current) {
  const previousHybrid = parsePngRgba(readBuffer(previous.hybrid.image.path));
  const previousFlame = parsePngRgba(readBuffer(previous.flame.image.path));
  const currentHybrid = parsePngRgba(readBuffer(current.hybrid.image.path));
  const currentFlame = parsePngRgba(readBuffer(current.flame.image.path));
  const width = Math.min(previousHybrid.width, previousFlame.width, currentHybrid.width, currentFlame.width);
  const height = Math.min(previousHybrid.height, previousFlame.height, currentHybrid.height, currentFlame.height);
  let total = 0;
  let changed = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 2) {
    const ph = previousHybrid.rows[y];
    const pf = previousFlame.rows[y];
    const ch = currentHybrid.rows[y];
    const cf = currentFlame.rows[y];
    for (let x = 0; x < width; x += 2) {
      const phi = x * previousHybrid.channels;
      const pfi = x * previousFlame.channels;
      const chi = x * currentHybrid.channels;
      const cfi = x * currentFlame.channels;
      const diff = (
        Math.abs((ph[phi] - pf[pfi]) - (ch[chi] - cf[cfi]))
        + Math.abs((ph[phi + 1] - pf[pfi + 1]) - (ch[chi + 1] - cf[cfi + 1]))
        + Math.abs((ph[phi + 2] - pf[pfi + 2]) - (ch[chi + 2] - cf[cfi + 2]))
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

function artifactPath(path) {
  const contained = requireHybridWitnessArtifactPath({ evidenceRoot, bundleRoot: outDir, artifact: path });
  return relative(process.cwd(), contained).replaceAll('\\', '/');
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
    boundarySplatCompositionRequested: state.boundarySplatCompositionRequested,
    boundarySplatCompositionEffective: state.boundarySplatCompositionEffective,
    boundarySplatCompositionFallbackReason: state.boundarySplatCompositionFallbackReason,
    hybridSplatSmokeCompositorIdentity: state.hybridSplatSmokeCompositorIdentity,
    hybridSmokeLayer: state.hybridSmokeLayer,
    boundarySplatCopyBytesThisFrame: state.boundarySplatCopyBytesThisFrame,
    boundarySplatCopyDisposition: state.boundarySplatCopyDisposition,
    hybridSmokeRepresentationRequested: state.hybridSmokeRepresentationRequested,
    hybridSmokeRepresentationEffective: state.hybridSmokeRepresentationEffective,
    hybridSmokeSourceRequested: state.hybridSmokeSourceRequested,
    hybridSmokeSourceEffective: state.hybridSmokeSourceEffective,
    spatialStrataHybridSmokeManifestUrl: state.spatialStrataHybridSmokeManifestUrl,
    spatialStrataHybridSmokeSourceStatus: state.spatialStrataHybridSmokeSourceStatus,
    spatialStrataHybridSmokeFailureReason: state.spatialStrataHybridSmokeFailureReason,
    spatialStrataHybridSmokeSourceLifecycle: state.spatialStrataHybridSmokeSourceLifecycle,
    spatialStrataHybridSmokeConfigRequestedIdentity: state.spatialStrataHybridSmokeConfigRequestedIdentity,
    spatialStrataHybridSmokeConfigEffectiveIdentity: state.spatialStrataHybridSmokeConfigEffectiveIdentity,
    spatialStrataHybridSmokeRendererIdentity: state.spatialStrataHybridSmokeRendererIdentity,
    spatialStrataHybridSmokeDebug: state.spatialStrataHybridSmokeDebug,
    frameCount: state.frameCount,
    simStepCount: state.simStepCount,
  };
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
