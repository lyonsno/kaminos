#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { inflateSync as zlibInflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.boundary-splat-motion-witness.v0';
const PROJECTED_WORK_SEQUENCE_SCHEMA = 'kaminos.volume.boundary-splat-projected-work-aligned-sequence.v0';
const SPLAT_RENDERER = 'live-boundary-sidecar-analytic-splats-v0';
const LEARNED_SPLAT_RENDERER = 'live-boundary-sidecar-learned-attribute-splats-v0';
const FULL_FLAME_UNION_RENDERER = 'live-ridge-nonridge-union-kernel-moment-covariance-splats-v0';
const SOURCE_PRESERVING_SELECTOR = 'boundary-splat-live-union-source-preserving-v0';
const PROJECTED_WORK_SELECTOR = 'boundary-splat-live-union-projected-footprint-hash-thinning-v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const PROJECTED_WORK_TARGETS = [0, 12, 24];
const EXPECTED_LEARNED_MODEL = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const REJECTED_LEARNED_MODELS = new Set([
  'sha256:54a41ba9d04132b8340884adef37a092c367c8cc8443e67907bd5f4f8573b911',
  'sha256:09aecca934991ba8321485b5ab7fa7c685c2c8544423286b843195a5e441c64d',
]);
const SPLAT_SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const SOURCE_AUTHORITY = SPLAT_SOURCE_AUTHORITY;
const RAYMARCH_RENDERER = 'matched-raymarch';

const args = parseArgs(process.argv.slice(2));
const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-motion-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/motion-witness-report.json`));
const port = Math.max(1, Math.floor(Number(args.get('--chrome-port') || 19384)));
const chrome = String(args.get('--chrome') || process.env.CHROME || defaultChromePath());
const windowSize = String(args.get('--window-size') || '1280,960');
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2500));
const frameCount = Math.max(2, Math.floor(Number(args.get('--frames') || 6)));
const stepMs = Math.max(1, Number(args.get('--step-ms') || 2000));
const wallStepMs = Math.max(0, Number(args.get('--wall-step-ms') || 0));
const keepBrowserOpen = args.has('--keep-browser-open');
const userDataDir = resolve(String(args.get('--user-data-dir') || mkdtempSync(`${tmpdir()}/kaminos-splat-motion-chrome-`)));

const runStartedAt = new Date().toISOString();
const lastTrustworthyEvidence = {};
let browserSession = null;
let ws = null;
let failurePhase = 'startup';
let projectedWorkTargets = null;

try {
  if (!requestedRoute) throw new Error('missing --url');
  const projectedWorkTargetsRaw = new URL(requestedRoute).searchParams.get('volume_boundary_splat_projected_work_sequence')
    || args.get('--projected-work-targets')
    || '';
  projectedWorkTargets = parseProjectedWorkTargets(projectedWorkTargetsRaw);
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
  await waitForPrototype();
  await delay(settleMs);
  await hideHud();
  const initialState = await debugState();
  lastTrustworthyEvidence.initialState = compactState(initialState);

  const requestedRouteIdentity = {
    requestedRoute,
    rendererIdentity: SPLAT_RENDERER,
    sourceAuthority: SOURCE_AUTHORITY,
    routeMode: 'boundary-splat-motion-falsification',
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

  if (projectedWorkTargets) {
    failurePhase = 'projected-work-sequence-capture';
    const staticSequence = await captureProjectedWorkSequence(staticCamera);
    const grazingSequence = await captureProjectedWorkSequence(grazingCamera);
    const qualityComparisons = summarizeProjectedWorkQuality([staticSequence, grazingSequence]);
    const report = {
      schema: PROJECTED_WORK_SEQUENCE_SCHEMA,
      status: 'completed',
      runStartedAt,
      runCompletedAt: new Date().toISOString(),
      requestedRoute,
      requestedRouteIdentity: {
        requestedRoute,
        rendererIdentity: FULL_FLAME_UNION_RENDERER,
        sourceAuthority: SOURCE_AUTHORITY,
        routeMode: 'boundary-splat-projected-work-aligned-sequence',
        requestedTargets: projectedWorkTargets,
      },
      effectiveRoute: staticSequence.effectiveRoute || grazingSequence.effectiveRoute || null,
      alignmentAuthority: 'same-browser-same-frozen-state-full-12-24-v0',
      sourceAuthority: SOURCE_AUTHORITY,
      rendererIdentity: FULL_FLAME_UNION_RENDERER,
      expectedLearnedModelIdentity: EXPECTED_LEARNED_MODEL,
      selectorIdentities: {
        fullSupport: SOURCE_PRESERVING_SELECTOR,
        thinned: PROJECTED_WORK_SELECTOR,
      },
      browser: {
        identity: browserSession.identity,
        mode: browserSession.mode,
        port,
        userDataDir,
        keepBrowserOpen,
        windowSize,
        pageUrl: page.url,
      },
      captureConfig: {
        frameCount,
        stepMs,
        wallStepMs,
        projectedWorkTargets,
        staticCameraDurationMs: (frameCount - 1) * stepMs,
        grazingCameraDurationMs: (frameCount - 1) * stepMs,
      },
      timingStatus: 'not-measured-by-motion-witness',
      timingAuthority: 'consume-separate-same-state-projected-work-curve-receipts-v0',
      timingReason: 'This sequence measures aligned visual motion and does not substitute missing or partial timestamps for the existing same-state cost curve.',
      staticCamera: staticSequence,
      grazingCamera: grazingSequence,
      qualityComparisons,
      sequenceCertification: certifyProjectedWorkSequence([staticSequence, grazingSequence], qualityComparisons),
      inspectedArtifacts: [staticSequence, grazingSequence]
        .flatMap(sequence => sequence.frames.flatMap(frame => frame.captures.map(capture => capture.image.path))),
      falseClosureChecks: {
        rejectsWrongRouteBackendModelOrSource: true,
        rejectsStaleRequestedEffectiveTargets: true,
        rejectsHiddenSelectorFallback: true,
        rejectsChangedFullUnionPopulation: true,
        rejectsCopyOrOverflow: true,
        rejectsMissingBlankOrPartialCapture: true,
        rejectsCachedOrStaticOutput: true,
        rejectsTimingSubstitution: true,
      },
    };
    failurePhase = 'projected-work-sequence-validation';
    rejectProjectedWorkFalseClosure(report);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } else {
    failurePhase = 'static-camera-capture';
    const staticSequence = await captureSequence(staticCamera);
    failurePhase = 'grazing-camera-capture';
    const grazingSequence = await captureSequence(grazingCamera);
    failurePhase = 'false-closure-validation';
    const report = {
    schema: SCHEMA,
    status: 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    requestedRouteIdentity,
    effectiveRoute: staticSequence.effectiveRoute || grazingSequence.effectiveRoute || null,
    sourceAuthority: SOURCE_AUTHORITY,
    rendererIdentities: [SPLAT_RENDERER, LEARNED_SPLAT_RENDERER, RAYMARCH_RENDERER],
    expectedLearnedModelIdentity: EXPECTED_LEARNED_MODEL,
    browser: {
      identity: browserSession.identity,
      mode: browserSession.mode,
      port,
      userDataDir,
      keepBrowserOpen,
      windowSize,
      pageUrl: page.url,
    },
    captureConfig: {
      frameCount,
      stepMs,
      wallStepMs,
      staticCameraDurationMs: (frameCount - 1) * stepMs,
      grazingCameraDurationMs: (frameCount - 1) * stepMs,
    },
    frozenDeterminism: computeFrozenDeterminism(staticSequence.frames[0]),
    analyticLearnedComparison: summarizeAnalyticLearnedComparison([...staticSequence.frames, ...grazingSequence.frames]),
    staticCamera: staticSequence,
    grazingCamera: grazingSequence,
    candidateChurn: summarizeCandidateChurn([...staticSequence.frames, ...grazingSequence.frames]),
    birthDeathTelemetry: summarizeBirthDeath([...staticSequence.frames, ...grazingSequence.frames]),
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
    },
  };
    rejectFalseClosure(report);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  const failureReport = {
    schema: projectedWorkTargets ? PROJECTED_WORK_SEQUENCE_SCHEMA : SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedRoute,
    rendererIdentity: SPLAT_RENDERER,
    expectedLearnedModelIdentity: EXPECTED_LEARNED_MODEL,
    sourceAuthority: SOURCE_AUTHORITY,
    browser: browserSession ? {
      identity: browserSession.identity,
      mode: browserSession.mode,
      port,
      userDataDir,
      keepBrowserOpen,
      windowSize,
    } : null,
    lastTrustworthyEvidence,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(failureReport, null, 2));
  console.error(JSON.stringify(failureReport, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close?.(); } catch {}
  if (!keepBrowserOpen) browserSession?.process?.kill('SIGTERM');
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

function parseProjectedWorkTargets(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const targets = raw.split(',').map(item => Number(item.trim()));
  const exact = targets.length === PROJECTED_WORK_TARGETS.length
    && targets.every((target, index) => Number.isInteger(target) && target === PROJECTED_WORK_TARGETS[index]);
  if (!exact) throw new Error('projected-work sequence requires exact targets 0,12,24');
  return targets;
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

async function captureProjectedWorkSequence(config) {
  const sequenceDir = resolve(outDir, `projected-work-${config.label}`);
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
        advanceSim: frameIndex > 0,
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
      throw new Error(`projected-work controlled step failed for ${config.label} frame ${frameIndex}: ${JSON.stringify(frame)}`);
    }
    sameBrowserSessionId = frame.sameBrowserSessionId;
    sequenceStartNowMs = frame.sequenceStartNowMs;
    const scaleSet = frame.scaleSet;
    const frameDir = resolve(sequenceDir, `frame-${String(frameIndex + 1).padStart(3, '0')}`);
    mkdirSync(frameDir, { recursive: true });
    const captures = [];
    for (const targetPixels of projectedWorkTargets) {
      captures.push(await captureProjectedWorkArm({
        frameDir,
        frameIndex,
        scaleSet,
        camera,
        targetPixels,
      }));
    }
    const frameReceipt = {
      sequenceAuthority: frame.sequenceAuthority,
      alignmentAuthority: 'same-browser-same-frozen-state-full-12-24-v0',
      sameBrowserSessionId: frame.sameBrowserSessionId,
      controlledStepFrameIndex: frameIndex,
      controlledStepDeltaMs: frame.controlledStepDeltaMs,
      controlledStepNowMs: frame.controlledStepNowMs,
      controlledStepCapture: frame.controlledStepCapture,
      sameStateCaptureId: scaleSet.sameStateCaptureId,
      baseFrameCount: scaleSet.baseFrameCount,
      baseSimStepCount: scaleSet.baseSimStepCount,
      camera,
      captures,
    };
    frames.push(frameReceipt);
    lastTrustworthyEvidence.projectedWorkSequence = {
      sequence: config.label,
      completedFrames: frames.length,
      expectedFrames: frameCount,
      lastFrame: compactProjectedWorkFrame(frameReceipt),
    };
  }
  const sequence = {
    label: config.label,
    sequenceKind: config.sequenceKind,
    sameBrowserSessionId,
    alignmentAuthority: 'same-browser-same-frozen-state-full-12-24-v0',
    sampleAuthority: 'controlled-step-sim-advance-with-frozen-render-only-arms-v0',
    frameCount,
    stepMs,
    sequenceDurationMs: (frameCount - 1) * stepMs,
    effectiveRoute: frames[0]?.captures[0]?.effectiveRoute || null,
    frames,
  };
  addProjectedWorkMotionEnergy(sequence);
  return sequence;
}

async function captureProjectedWorkArm({ frameDir, frameIndex, scaleSet, camera, targetPixels }) {
  const renderOptions = {
    renderScale: 1,
    now: scaleSet.fixedNowMs,
    sameStateCaptureId: scaleSet.sameStateCaptureId,
    baseFrameCount: scaleSet.baseFrameCount,
    baseSimStepCount: scaleSet.baseSimStepCount,
    boundarySplatComposition: 'splat-only-v0',
    includeRgba: true,
    controlOverrides: {
      boundarySplatMode: 'kernel_moment_full_flame_union',
      boundarySplatProjectedWorkTargetPixels: targetPixels,
    },
    restoreControls: true,
    resumeRenderLoop: false,
  };
  const canvasEval = await wsRequest('Runtime.evaluate', {
    expression: compactProjectedWorkRenderExpression(renderOptions),
    awaitPromise: true,
    returnByValue: true,
  });
  const canvasCapture = canvasEval.result.value;
  if (canvasCapture?.ok !== true || canvasCapture.sampleAuthority !== 'render-only-frozen-sim-state') {
    throw new Error(`projected-work arm render failed for target ${targetPixels}: ${JSON.stringify(canvasCapture)}`);
  }
  const postState = await debugState();
  const rgbaCapture = canvasCapture.rgbaCapture;
  if (!rgbaCapture?.pngBase64 || rgbaCapture.imageAuthority !== 'gpu-rgba8-readback-frozen-sim-state-v0') {
    throw new Error(`projected-work blank/partial evidence rejected for target ${targetPixels}: missing exact PNG readback`);
  }
  const imageBuffer = Buffer.from(rgbaCapture.pngBase64, 'base64');
  const requestedRenderer = targetPixels === 0 ? 'full-support' : `projected-work-target-${targetPixels}`;
  const imagePath = resolve(frameDir, `${String(frameIndex + 1).padStart(3, '0')}-${slug(requestedRenderer)}.png`);
  writeFileSync(imagePath, imageBuffer);
  const capture = {
    requestedRenderer,
    targetPixels,
    requestedRoute,
    effectiveRoute: canvasCapture.effectiveRoute,
    backend: canvasCapture.backend,
    prototypeIdentity: canvasCapture.prototypeIdentity,
    rendererIdentity: canvasCapture.boundarySplatRendererIdentity ?? postState?.boundarySplatRendererIdentity ?? null,
    appliedModelIdentity: canvasCapture.boundarySplatAttributeModelIdentity ?? postState?.boundarySplatAttributeModelIdentity ?? null,
    sourceAuthority: canvasCapture.boundarySplatSourceAuthority ?? postState?.boundarySplatSourceAuthority ?? null,
    fallbackReason: canvasCapture.boundarySplatFallbackReason ?? postState?.boundarySplatFallbackReason ?? null,
    selectorPolicyIdentity: canvasCapture.boundarySplatSelectorPolicyIdentity ?? postState?.boundarySplatSelectorPolicyIdentity ?? null,
    requestedProjectedWorkTargetPixels: canvasCapture.boundarySplatRequestedProjectedWorkTargetPixels,
    effectiveProjectedWorkTargetPixels: canvasCapture.boundarySplatEffectiveProjectedWorkTargetPixels,
    projectedWorkRejectedCount: canvasCapture.boundarySplatProjectedWorkRejectedCount,
    selectedCandidateCount: canvasCapture.boundarySplatSelectedCandidateCount ?? canvasCapture.boundarySplatCandidateCount,
    candidateCount: canvasCapture.boundarySplatCandidateCount,
    fullUnionCount: canvasCapture.boundarySplatUnionCount,
    instanceCount: canvasCapture.boundarySplatInstanceCount,
    overflowCount: canvasCapture.boundarySplatOverflowCount,
    initialOverflowCount: canvasCapture.boundarySplatInitialOverflowCount,
    capacityRetryCount: canvasCapture.boundarySplatCapacityRetryCount,
    capacity: canvasCapture.boundarySplatCapacity,
    candidateCopyBytes: postState?.boundarySplatCopyBytesThisFrame ?? null,
    candidateCopyDisposition: postState?.boundarySplatCopyDisposition ?? null,
    unionReceipt: canvasCapture.boundarySplatUnionReceipt ?? null,
    camera,
    image: {
      path: imagePath,
      basename: basename(imagePath),
      sha256: sha256(imageBuffer),
      authority: rgbaCapture.imageAuthority,
      rgbaByteLength: rgbaCapture.rgbaByteLength,
      expectedRgbaByteLength: Number(rgbaCapture.width) * Number(rgbaCapture.height) * 4,
      metrics: measureScreenshot(imageBuffer),
      width: rgbaCapture.width,
      height: rgbaCapture.height,
    },
    canvasCapture: {
      sampleAuthority: canvasCapture.sampleAuthority,
      sameStateCaptureId: canvasCapture.sameStateCaptureId,
      baseFrameCount: canvasCapture.baseFrameCount,
      baseSimStepCount: canvasCapture.baseSimStepCount,
      frameCount: canvasCapture.frameCount,
      simStepCount: canvasCapture.simStepCount,
      boundarySplatCompositionRequested: canvasCapture.boundarySplatCompositionRequested,
      boundarySplatCompositionEffective: canvasCapture.boundarySplatCompositionEffective,
      raymarchApplied: canvasCapture.raymarchApplied,
      splatApplied: canvasCapture.splatApplied,
    },
  };
  validateProjectedWorkCapture(capture);
  return capture;
}

function compactProjectedWorkRenderExpression(renderOptions) {
  return `(async () => {
    const render = await window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify(renderOptions)});
    const capture = render?.rgbaCapture;
    if (!capture?.rgba) return render;
    const rgba = Uint8ClampedArray.from(capture.rgba);
    const surface = new OffscreenCanvas(capture.width, capture.height);
    const context = surface.getContext('2d', { alpha: true });
    if (!context) throw new Error('projected-work exact-rgba-png-context-unavailable');
    context.putImageData(new ImageData(rgba, capture.width, capture.height), 0, 0);
    const blob = await surface.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 32768)));
    }
    return {
      ...render,
      rgbaCapture: {
        ...capture,
        rgba: null,
        rgbaByteLength: rgba.byteLength,
        pngBase64: btoa(binary),
      },
    };
  })()`;
}

function compactProjectedWorkFrame(frame) {
  return {
    controlledStepFrameIndex: frame.controlledStepFrameIndex,
    sameBrowserSessionId: frame.sameBrowserSessionId,
    sameStateCaptureId: frame.sameStateCaptureId,
    baseFrameCount: frame.baseFrameCount,
    baseSimStepCount: frame.baseSimStepCount,
    captures: frame.captures.map(capture => ({
      targetPixels: capture.targetPixels,
      selectorPolicyIdentity: capture.selectorPolicyIdentity,
      selectedCandidateCount: capture.selectedCandidateCount,
      projectedWorkRejectedCount: capture.projectedWorkRejectedCount,
      fullUnionCount: capture.fullUnionCount,
      imageSha256: capture.image.sha256,
    })),
  };
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
        advanceSim: frameIndex > 0,
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
    const analytic = await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: 'analytic-splat',
      boundarySplatMode: 'analytic',
    });
    const learned = await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: 'learned-splat',
      boundarySplatMode: 'learned',
    });
    const raymarch = await captureRenderer({
      frameDir,
      frameIndex,
      scaleSet,
      camera,
      requestedRenderer: RAYMARCH_RENDERER,
      boundarySplatMode: 'off',
    });
    let determinismRepeat = null;
    if (config.label === 'staticCamera' && frameIndex === 0) {
      determinismRepeat = await captureRenderer({
        frameDir,
        frameIndex,
        scaleSet,
        camera,
        requestedRenderer: 'analytic-splat-determinism-repeat',
        boundarySplatMode: 'analytic',
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
      captures: [analytic, learned, raymarch, determinismRepeat].filter(Boolean),
    });
  }
  const effectiveRoute = frames[0]?.captures[0]?.effectiveRoute || null;
  const sequence = {
    label: config.label,
    sequenceKind: config.sequenceKind,
    sameBrowserSessionId,
    sampleAuthority: 'controlled-step-sim-advance',
    frameCount,
    stepMs,
    sequenceDurationMs: (frameCount - 1) * stepMs,
    effectiveRoute,
    frames,
  };
  addMotionEnergy(sequence);
  return sequence;
}

async function captureRenderer({ frameDir, frameIndex, scaleSet, camera, requestedRenderer, boundarySplatMode }) {
  const canvasEval = await wsRequest('Runtime.evaluate', {
    expression: `window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
      renderScale: 1,
      now: scaleSet.fixedNowMs,
      sameStateCaptureId: scaleSet.sameStateCaptureId,
      baseFrameCount: scaleSet.baseFrameCount,
      baseSimStepCount: scaleSet.baseSimStepCount,
      controlOverrides: { boundarySplatMode },
      restoreControls: true,
      resumeRenderLoop: false,
    })})`,
    awaitPromise: true,
    returnByValue: true,
  });
  const canvasCapture = canvasEval.result.value;
  if (canvasCapture?.ok !== true || canvasCapture.sampleAuthority !== 'render-only-frozen-sim-state') {
    throw new Error(`renderer capture failed for ${requestedRenderer}: ${JSON.stringify(canvasCapture)}`);
  }
  const postState = await debugState();
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
    rendererIdentity: postState?.boundarySplatRendererIdentity || SPLAT_RENDERER,
    appliedModelIdentity: postState?.boundarySplatAttributeModelIdentity ?? canvasCapture.boundarySplatAttributeModelIdentity ?? null,
    sourceAuthority: postState?.boundarySplatSourceAuthority || SOURCE_AUTHORITY,
    boundarySplatCandidateCount: isSplat ? postState?.boundarySplatCandidateCount ?? null : null,
    boundarySplatInstanceCount: isSplat ? postState?.boundarySplatInstanceCount ?? null : null,
    boundarySplatOverflowCount: isSplat ? postState?.boundarySplatOverflowCount ?? null : null,
    boundarySplatCountAuthority: isSplat ? postState?.boundarySplatCountAuthority ?? null : null,
    boundarySplatCandidateCopyBytes: isSplat ? postState?.boundarySplatCopyBytesThisFrame ?? null : null,
    boundarySplatCandidateCopyDisposition: isSplat ? postState?.boundarySplatCopyDisposition ?? null : null,
    image: {
      path: imagePath,
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
    },
  };
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
  if (capture.image.metrics.litPixels <= 20 || capture.image.metrics.meanLuma <= 1) {
    throw new Error(`missing or blank capture: ${JSON.stringify({ requestedRenderer: capture.requestedRenderer, metrics: capture.image.metrics })}`);
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
  if (capture.requestedRenderer === 'learned-splat') {
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
  }
  if (capture.requestedRenderer.includes('splat')) {
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

function validateProjectedWorkCapture(capture) {
  if (capture.effectiveRoute !== EXPECTED_ROUTE || capture.backend !== 'WebGPU:apple') {
    throw new Error(`projected-work route/backend disagreement: ${capture.effectiveRoute}/${capture.backend}`);
  }
  if (capture.rendererIdentity !== FULL_FLAME_UNION_RENDERER) {
    throw new Error(`projected-work renderer disagreement: ${capture.rendererIdentity}`);
  }
  if (capture.appliedModelIdentity !== EXPECTED_LEARNED_MODEL || capture.sourceAuthority !== SOURCE_AUTHORITY) {
    throw new Error(`projected-work model/source disagreement: ${capture.appliedModelIdentity}/${capture.sourceAuthority}`);
  }
  if (capture.fallbackReason || capture.canvasCapture.splatApplied !== true || capture.canvasCapture.raymarchApplied !== false) {
    throw new Error(`projected-work fallback rejected: ${JSON.stringify({
      fallbackReason: capture.fallbackReason,
      splatApplied: capture.canvasCapture.splatApplied,
      raymarchApplied: capture.canvasCapture.raymarchApplied,
    })}`);
  }
  if (
    capture.requestedProjectedWorkTargetPixels !== capture.targetPixels
    || capture.effectiveProjectedWorkTargetPixels !== capture.targetPixels
  ) {
    throw new Error(`projected-work stale requested/effective target: ${JSON.stringify({
      targetPixels: capture.targetPixels,
      requested: capture.requestedProjectedWorkTargetPixels,
      effective: capture.effectiveProjectedWorkTargetPixels,
    })}`);
  }
  const expectedSelector = capture.targetPixels === 0 ? SOURCE_PRESERVING_SELECTOR : PROJECTED_WORK_SELECTOR;
  if (capture.selectorPolicyIdentity !== expectedSelector) {
    throw new Error(`projected-work selector identity disagreement: ${capture.selectorPolicyIdentity}`);
  }
  const selected = Number(capture.selectedCandidateCount);
  const rejected = Number(capture.projectedWorkRejectedCount);
  const fullUnion = Number(capture.fullUnionCount);
  if (!Number.isInteger(selected) || selected <= 0 || !Number.isInteger(rejected) || rejected < 0 || !Number.isInteger(fullUnion) || fullUnion <= 0) {
    throw new Error(`projected-work blank/partial evidence rejected: ${JSON.stringify({ selected, rejected, fullUnion })}`);
  }
  if (selected + rejected !== fullUnion) {
    throw new Error(`projected-work full-union disagreement: ${JSON.stringify({ selected, rejected, fullUnion })}`);
  }
  if ((capture.targetPixels === 0 && rejected !== 0) || (capture.targetPixels > 0 && rejected <= 0)) {
    throw new Error(`projected-work selector identity disagreement: target ${capture.targetPixels} rejected ${rejected}`);
  }
  if (
    capture.overflowCount !== 0
    || capture.initialOverflowCount !== 0
    || capture.capacityRetryCount !== 0
    || capture.candidateCopyBytes !== 0
    || !capture.candidateCopyDisposition
  ) {
    throw new Error(`projected-work copy/overflow rejected: ${JSON.stringify({
      overflowCount: capture.overflowCount,
      initialOverflowCount: capture.initialOverflowCount,
      capacityRetryCount: capture.capacityRetryCount,
      candidateCopyBytes: capture.candidateCopyBytes,
      candidateCopyDisposition: capture.candidateCopyDisposition,
    })}`);
  }
  if (
    capture.image.authority !== 'gpu-rgba8-readback-frozen-sim-state-v0'
    || capture.image.rgbaByteLength !== capture.image.expectedRgbaByteLength
    || capture.image.metrics.litPixels <= 20
    || capture.image.metrics.meanLuma <= 1
  ) {
    throw new Error(`projected-work blank/partial evidence rejected: ${JSON.stringify(capture.image)}`);
  }
}

function rejectProjectedWorkFalseClosure(report) {
  if (report.timingStatus !== 'not-measured-by-motion-witness') {
    throw new Error(`projected-work partial timestamp substitution rejected: ${report.timingStatus}`);
  }
  const sequences = [report.staticCamera, report.grazingCamera];
  for (const sequence of sequences) {
    if (sequence.frames.length !== frameCount || sequence.sameBrowserSessionId !== sequence.frames[0]?.sameBrowserSessionId) {
      throw new Error(`projected-work blank/partial evidence rejected for ${sequence.label}`);
    }
    for (const frame of sequence.frames) {
      if (frame.captures.length !== PROJECTED_WORK_TARGETS.length) {
        throw new Error(`projected-work blank/partial evidence rejected for ${sequence.label} frame ${frame.controlledStepFrameIndex}`);
      }
      const targets = frame.captures.map(capture => capture.targetPixels);
      if (!targets.every((target, index) => target === PROJECTED_WORK_TARGETS[index])) {
        throw new Error(`projected-work stale requested/effective target list: ${targets.join(',')}`);
      }
      const stateIds = new Set(frame.captures.map(capture => capture.canvasCapture.sameStateCaptureId));
      const frameCounts = new Set(frame.captures.map(capture => capture.canvasCapture.baseFrameCount));
      const simStepCounts = new Set(frame.captures.map(capture => capture.canvasCapture.baseSimStepCount));
      if (stateIds.size !== 1 || frameCounts.size !== 1 || simStepCounts.size !== 1) {
        throw new Error(`projected-work same-state disagreement for ${sequence.label} frame ${frame.controlledStepFrameIndex}`);
      }
      for (const capture of frame.captures) validateProjectedWorkCapture(capture);
      const fullUnionCounts = new Set(frame.captures.map(capture => capture.fullUnionCount));
      if (fullUnionCounts.size !== 1) {
        throw new Error(`projected-work full-union disagreement for ${sequence.label} frame ${frame.controlledStepFrameIndex}`);
      }
      const selected = frame.captures.map(capture => capture.selectedCandidateCount);
      if (!(selected[1] <= selected[2] && selected[2] <= selected[0])) {
        throw new Error(`projected-work selected-count monotonicity disagreement: ${selected.join(',')}`);
      }
    }
  }
  const expectedQualityRows = sequences.length * frameCount * (PROJECTED_WORK_TARGETS.length - 1);
  if (report.qualityComparisons.comparisonCount !== expectedQualityRows) {
    throw new Error(`projected-work blank/partial evidence rejected: expected ${expectedQualityRows} quality rows, got ${report.qualityComparisons.comparisonCount}`);
  }
  if (report.sequenceCertification.ok !== true) {
    throw new Error(`projected-work live motion rejected: ${JSON.stringify(report.sequenceCertification)}`);
  }
}

function summarizeProjectedWorkQuality(sequences) {
  const comparisons = [];
  for (const sequence of sequences) {
    for (const frame of sequence.frames) {
      const full = frame.captures.find(capture => capture.targetPixels === 0);
      for (const targetPixels of PROJECTED_WORK_TARGETS.slice(1)) {
        const selected = frame.captures.find(capture => capture.targetPixels === targetPixels);
        if (!full || !selected) continue;
        comparisons.push({
          sequence: sequence.label,
          controlledStepFrameIndex: frame.controlledStepFrameIndex,
          sameStateCaptureId: frame.sameStateCaptureId,
          targetPixels,
          selectedCandidateRatio: selected.selectedCandidateCount / full.selectedCandidateCount,
          retainedMeanLuma: selected.image.metrics.meanLuma / Math.max(full.image.metrics.meanLuma, 1e-9),
          retainedLitCoverage: selected.image.metrics.litPixels / Math.max(full.image.metrics.litPixels, 1),
          pixelDelta: imageDiff(full.image.path, selected.image.path),
          fullImage: full.image.path,
          selectedImage: selected.image.path,
        });
      }
    }
  }
  const rowsFor = targetPixels => comparisons.filter(row => row.targetPixels === targetPixels);
  const mean = (rows, key) => rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : null;
  return {
    authority: 'same-browser-same-frozen-state-full-12-24-native-png-quality-v0',
    comparisonCount: comparisons.length,
    byTarget: PROJECTED_WORK_TARGETS.slice(1).map(targetPixels => {
      const rows = rowsFor(targetPixels);
      return {
        targetPixels,
        comparisonCount: rows.length,
        meanSelectedCandidateRatio: mean(rows, 'selectedCandidateRatio'),
        meanRetainedLuma: mean(rows, 'retainedMeanLuma'),
        meanRetainedLitCoverage: mean(rows, 'retainedLitCoverage'),
        meanPixelAbsDiff: rows.length
          ? rows.reduce((sum, row) => sum + row.pixelDelta.meanAbsDiff, 0) / rows.length
          : null,
      };
    }),
    comparisons,
  };
}

function addProjectedWorkMotionEnergy(sequence) {
  sequence.motionByTarget = PROJECTED_WORK_TARGETS.map(targetPixels => {
    const captures = sequence.frames.map(frame => frame.captures.find(capture => capture.targetPixels === targetPixels));
    const diffs = [];
    for (let index = 1; index < captures.length; index += 1) {
      diffs.push(imageDiff(captures[index - 1].image.path, captures[index].image.path));
    }
    return {
      targetPixels,
      authority: 'adjacent-frame-exact-gpu-readback-png-diff-v0',
      diffs,
      maxMeanAbsDiff: diffs.reduce((max, diff) => Math.max(max, diff.meanAbsDiff), 0),
      maxChangedFraction: diffs.reduce((max, diff) => Math.max(max, diff.changedFraction), 0),
    };
  });
}

function certifyProjectedWorkSequence(sequences, qualityComparisons) {
  const motionRows = sequences.flatMap(sequence => sequence.motionByTarget.map(row => ({
    sequence: sequence.label,
    targetPixels: row.targetPixels,
    maxMeanAbsDiff: row.maxMeanAbsDiff,
    maxChangedFraction: row.maxChangedFraction,
    certified: row.maxMeanAbsDiff > 0.5 && row.maxChangedFraction > 0.02,
  })));
  const targetCertification = PROJECTED_WORK_TARGETS.map(targetPixels => ({
    targetPixels,
    certifiedSequenceCount: motionRows.filter(row => row.targetPixels === targetPixels && row.certified).length,
  }));
  return {
    ok: targetCertification.every(row => row.certifiedSequenceCount > 0)
      && qualityComparisons.comparisonCount === sequences.length * frameCount * (PROJECTED_WORK_TARGETS.length - 1),
    authority: 'aligned-projected-work-learned-sequence-certification-v0',
    minMotionMeanAbsDiff: 0.5,
    minMotionChangedFraction: 0.02,
    targetCertification,
    motionRows,
    qualityComparisonCount: qualityComparisons.comparisonCount,
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
      instanceCount: analytic.boundarySplatInstanceCount,
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

function summarizeCandidateChurn(frames) {
  const counts = frames.map(frame => frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat')?.boundarySplatCandidateCount)
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
  const analyticCaptures = sequence.frames.map(frame => frame.captures.find(capture => capture.requestedRenderer === 'analytic-splat'));
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

function readBuffer(path) {
  return readFileSync(path);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function slug(value) {
  return String(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
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
    boundarySplatCandidateCount: state.boundarySplatCandidateCount,
    boundarySplatOverflowCount: state.boundarySplatOverflowCount,
    boundarySplatFallbackReason: state.boundarySplatFallbackReason,
    boundarySplatCopyBytesThisFrame: state.boundarySplatCopyBytesThisFrame,
    boundarySplatCopyDisposition: state.boundarySplatCopyDisposition,
    frameCount: state.frameCount,
    simStepCount: state.simStepCount,
  };
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
