#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, relative, resolve } from 'node:path';
import { inflateSync as zlibInflateSync } from 'node:zlib';

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
const RAYMARCH_RECONSTRUCTION = 'native-resolution';

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
const projectedAreaSweepRequested = args.has('--projected-area-sweep');
const projectedAreaFactors = parsePositiveNumberList(args.get('--projected-area-factors') || '0.9,1.15,1.5,2,2.7');
const keepBrowserOpen = args.has('--keep-browser-open');
const userDataDir = resolve(String(args.get('--user-data-dir') || mkdtempSync(`${tmpdir()}/kaminos-splat-motion-chrome-`)));

const runStartedAt = new Date().toISOString();
const lastTrustworthyEvidence = {};
let browserSession = null;
let ws = null;
let failurePhase = 'startup';

try {
  if (!requestedRoute) throw new Error('missing --url');
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

  failurePhase = 'static-camera-capture';
  const staticSequence = await captureSequence(staticCamera);
  failurePhase = 'grazing-camera-capture';
  const grazingSequence = await captureSequence(grazingCamera);
  failurePhase = 'projected-area-sweep';
  const projectedAreaSweep = projectedAreaSweepRequested
    ? await captureProjectedAreaSweep(staticCamera.pose)
    : null;
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
      projectedAreaSweepRequested,
      projectedAreaFactors,
    },
    frozenDeterminism: computeFrozenDeterminism(staticSequence.frames[0]),
    analyticLearnedComparison: summarizeAnalyticLearnedComparison([...staticSequence.frames, ...grazingSequence.frames]),
    staticCamera: staticSequence,
    grazingCamera: grazingSequence,
    projectedAreaSweep,
    candidateChurn: summarizeCandidateChurn([...staticSequence.frames, ...grazingSequence.frames]),
    birthDeathTelemetry: summarizeBirthDeath([...staticSequence.frames, ...grazingSequence.frames]),
    inspectedArtifacts: [
      staticSequence.contactSheet || null,
      grazingSequence.contactSheet || null,
      projectedAreaSweep?.comparisonHtml || null,
      ...staticSequence.frames.flatMap(frame => frame.captures.map(capture => capture.image.path)),
      ...grazingSequence.frames.flatMap(frame => frame.captures.map(capture => capture.image.path)),
      ...(projectedAreaSweep?.rungs || []).flatMap(rung => rung.captures.map(capture => capture.image.path)),
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
} catch (error) {
  const failureReport = {
    schema: SCHEMA,
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

function parsePositiveNumberList(value) {
  const numbers = String(value).split(',').map(Number).filter(number => Number.isFinite(number) && number > 0);
  if (numbers.length < 3) throw new Error('--projected-area-factors requires at least three positive comma-separated values');
  return numbers;
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

async function captureProjectedAreaSweep(basePose) {
  const sweepDir = resolve(outDir, 'projectedAreaSweep');
  mkdirSync(sweepDir, { recursive: true });
  const frameEval = await wsRequest('Runtime.evaluate', {
    expression: `window.__kaminosVolumePrototype.controlledStepFrame(${JSON.stringify({
      controlledStepFrameIndex: 0,
      advanceSim: false,
      sameBrowserSessionId: null,
      startNow: null,
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
    throw new Error(`projected-area frozen-state capture failed: ${JSON.stringify(frame)}`);
  }
  const scaleSet = frame.scaleSet;
  const rungs = [];
  for (let rungIndex = 0; rungIndex < projectedAreaFactors.length; rungIndex += 1) {
    const cameraDistanceFactor = projectedAreaFactors[rungIndex];
    const pose = scaleCameraDistance(basePose, cameraDistanceFactor);
    const camera = await setCameraPose(pose);
    const rungDir = resolve(sweepDir, `rung-${String(rungIndex + 1).padStart(2, '0')}`);
    mkdirSync(rungDir, { recursive: true });
    const analytic = await captureRenderer({
      frameDir: rungDir,
      frameIndex: rungIndex,
      scaleSet,
      camera,
      requestedRenderer: 'analytic-splat',
      boundarySplatMode: 'analytic',
    });
    const learned = await captureRenderer({
      frameDir: rungDir,
      frameIndex: rungIndex,
      scaleSet,
      camera,
      requestedRenderer: 'learned-splat',
      boundarySplatMode: 'learned',
    });
    const raymarch = await captureRenderer({
      frameDir: rungDir,
      frameIndex: rungIndex,
      scaleSet,
      camera,
      requestedRenderer: RAYMARCH_RENDERER,
      boundarySplatMode: 'off',
    });
    const analyticBandwidth = compareStructuralBandwidth(raymarch.image.path, analytic.image.path);
    const learnedBandwidth = compareStructuralBandwidth(raymarch.image.path, learned.image.path);
    rungs.push({
      rungIndex,
      cameraDistanceFactor,
      authority: 'same-state-camera-distance-sweep-v0',
      sameBrowserSessionId: frame.sameBrowserSessionId,
      sameStateCaptureId: scaleSet.sameStateCaptureId,
      baseFrameCount: scaleSet.baseFrameCount,
      baseSimStepCount: scaleSet.baseSimStepCount,
      camera,
      projectedSupport: learnedBandwidth.projectedSupport,
      gradientRetention: {
        analytic: analyticBandwidth.gradientRetention,
        learned: learnedBandwidth.gradientRetention,
      },
      laplacianRetention: {
        analytic: analyticBandwidth.laplacianRetention,
        learned: learnedBandwidth.laplacianRetention,
      },
      structuralComparisons: {
        analytic: analyticBandwidth,
        learned: learnedBandwidth,
      },
      captures: [analytic, learned, raymarch],
    });
  }
  await setCameraPose(basePose);
  const sweep = {
    identity: 'boundary-splat-projected-area-structural-bandwidth-v0',
    authority: 'same-state-camera-distance-sweep-v0',
    sameBrowserSessionId: frame.sameBrowserSessionId,
    sameStateCaptureId: scaleSet.sameStateCaptureId,
    baseFrameCount: scaleSet.baseFrameCount,
    baseSimStepCount: scaleSet.baseSimStepCount,
    factors: projectedAreaFactors,
    rungs,
  };
  sweep.comparisonHtml = writeProjectedAreaComparisonHtml(sweep);
  return sweep;
}

function scaleCameraDistance(pose, factor) {
  return {
    position: pose.position.map((value, index) => pose.target[index] + (value - pose.target[index]) * factor),
    target: [...pose.target],
  };
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
  if (capture.requestedRenderer === RAYMARCH_RENDERER) {
    if (capture.effectiveRenderer !== RAYMARCH_RECONSTRUCTION) {
      throw new Error(`renderer disagreement: requested matched raymarch but effective renderer was ${capture.effectiveRenderer}`);
    }
    if (capture.canvasCapture.boundarySplatMode !== 'off') {
      throw new Error(`renderer disagreement: matched raymarch retained boundary splat mode ${capture.canvasCapture.boundarySplatMode}`);
    }
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
  if (report.projectedAreaSweep) validateProjectedAreaSweep(report.projectedAreaSweep);
}

function validateProjectedAreaSweep(sweep) {
  if (sweep.rungs.length < 3) throw new Error('projected-area renderer set incomplete: fewer than three size rungs');
  const stateIds = new Set();
  const diameters = [];
  for (const rung of sweep.rungs) {
    const analytic = rung.captures.find(capture => capture.requestedRenderer === 'analytic-splat');
    const learned = rung.captures.find(capture => capture.requestedRenderer === 'learned-splat');
    const raymarch = rung.captures.find(capture => capture.requestedRenderer === RAYMARCH_RENDERER);
    if (!analytic || !learned || !raymarch) {
      throw new Error(`projected-area renderer set incomplete at rung ${rung.rungIndex}`);
    }
    for (const capture of rung.captures) {
      validateCapture(capture);
      stateIds.add(capture.canvasCapture.sameStateCaptureId);
      if (
        capture.canvasCapture.sameStateCaptureId !== sweep.sameStateCaptureId
        || capture.canvasCapture.sameStateCaptureId !== rung.sameStateCaptureId
        || capture.canvasCapture.baseFrameCount !== sweep.baseFrameCount
        || capture.canvasCapture.baseFrameCount !== rung.baseFrameCount
        || capture.canvasCapture.baseSimStepCount !== sweep.baseSimStepCount
        || capture.canvasCapture.baseSimStepCount !== rung.baseSimStepCount
      ) {
        throw new Error(`projected-area state disagreement at rung ${rung.rungIndex}: ${JSON.stringify({
          capture: capture.requestedRenderer,
          captureState: capture.canvasCapture.sameStateCaptureId,
          sweepState: sweep.sameStateCaptureId,
          captureFrame: capture.canvasCapture.baseFrameCount,
          sweepFrame: sweep.baseFrameCount,
          captureSimStep: capture.canvasCapture.baseSimStepCount,
          sweepSimStep: sweep.baseSimStepCount,
        })}`);
      }
    }
    if (stateIds.size > 1 || rung.sameStateCaptureId !== sweep.sameStateCaptureId) {
      throw new Error(`projected-area state disagreement at rung ${rung.rungIndex}`);
    }
    if (!Number.isFinite(rung.projectedSupport?.diameterPx) || rung.projectedSupport.diameterPx <= 0) {
      throw new Error(`projected-area support missing at rung ${rung.rungIndex}`);
    }
    if (!Number.isFinite(rung.gradientRetention.learned) || !Number.isFinite(rung.laplacianRetention.learned)) {
      throw new Error(`projected-area structural metrics missing at rung ${rung.rungIndex}`);
    }
    diameters.push(rung.projectedSupport.diameterPx);
  }
  const minimum = Math.min(...diameters);
  const maximum = Math.max(...diameters);
  if (minimum <= 0 || maximum / minimum < 1.5) {
    throw new Error(`projected-area support did not vary materially: ${JSON.stringify(diameters)}`);
  }
}

function writeProjectedAreaComparisonHtml(sweep) {
  const path = resolve(outDir, 'projected-area-support-bandwidth.html');
  const cards = sweep.rungs.map(rung => {
    const captures = Object.fromEntries(rung.captures.map(capture => [capture.requestedRenderer, capture]));
    const variants = ['matched-raymarch', 'learned-splat', 'analytic-splat'];
    const first = captures[variants[0]];
    const buttons = variants.map((variant, index) => (
      `<button type="button" data-variant="${variant}"${index === 0 ? ' class="active"' : ''}>${variant}</button>`
    )).join('');
    const sources = Object.fromEntries(variants.map(variant => [
      variant,
      relative(outDir, captures[variant].image.path),
    ]));
    return `<section class="rung" data-sources='${escapeHtml(JSON.stringify(sources))}'>
      <header>
        <h2>Rung ${rung.rungIndex + 1} · camera ×${rung.cameraDistanceFactor}</h2>
        <p>${Math.round(rung.projectedSupport.diameterPx)} px support diameter · learned gradient ${formatRatio(rung.gradientRetention.learned)} · learned Laplacian ${formatRatio(rung.laplacianRetention.learned)}</p>
        <nav class="variants">${buttons}</nav>
        <nav class="inspection">
          <button type="button" data-inspection-mode="fit" class="active">Fit</button>
          <button type="button" data-inspection-mode="native">1:1 pixels</button>
          <a class="source-link" href="${escapeHtml(relative(outDir, first.image.path))}" target="_blank" rel="noreferrer">Open source PNG</a>
        </nav>
      </header>
      <div class="viewport fit"><img src="${escapeHtml(relative(outDir, first.image.path))}" alt="Projected-area rung ${rung.rungIndex + 1}"></div>
    </section>`;
  }).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kaminos projected-area structural bandwidth</title>
<style>
  :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #08090b; color: #f4f5f7; }
  body { margin: 0; padding: 20px; }
  main { display: grid; gap: 28px; }
  .rung { border: 1px solid #30343c; background: #111318; padding: 16px; border-radius: 12px; }
  h1, h2, p { margin: 0 0 10px; }
  header { margin-bottom: 14px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  button { border: 1px solid #4a5260; background: #1c2028; color: inherit; padding: 8px 12px; border-radius: 8px; cursor: pointer; }
  button.active { background: #ff6a2a; border-color: #ff9b70; color: #090909; }
  .source-link { color: #ffb08c; padding: 8px 4px; }
  .viewport { height: 82vh; overflow: auto; background: #000; display: flex; align-items: center; justify-content: center; }
  .viewport.fit img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
  .viewport.native { align-items: flex-start; justify-content: flex-start; }
  .viewport.native img { width: auto; height: auto; max-width: none; max-height: none; object-fit: none; image-rendering: auto; }
</style>
</head>
<body>
<h1>Same-state projected-area structural bandwidth</h1>
<p>One frozen simulator state; only camera distance changes. Toggle full-resolution matched raymarch, learned splat, and analytic splat captures.</p>
<main>${cards}</main>
<script>
for (const rung of document.querySelectorAll('.rung')) {
  const sources = JSON.parse(rung.dataset.sources);
  const image = rung.querySelector('img');
  const sourceLink = rung.querySelector('.source-link');
  for (const button of rung.querySelectorAll('[data-variant]')) {
    button.addEventListener('click', () => {
      for (const peer of rung.querySelectorAll('[data-variant]')) peer.classList.toggle('active', peer === button);
      image.src = sources[button.dataset.variant];
      image.alt = button.dataset.variant;
      sourceLink.href = sources[button.dataset.variant];
    });
  }
  const viewport = rung.querySelector('.viewport');
  for (const button of rung.querySelectorAll('[data-inspection-mode]')) {
    button.addEventListener('click', () => {
      for (const peer of rung.querySelectorAll('[data-inspection-mode]')) peer.classList.toggle('active', peer === button);
      viewport.classList.toggle('fit', button.dataset.inspectionMode === 'fit');
      viewport.classList.toggle('native', button.dataset.inspectionMode === 'native');
    });
  }
}
</script>
</body>
</html>`;
  writeFileSync(path, html);
  return path;
}

function formatRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)}×` : 'n/a';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
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
    projectedSupport: measureProjectedFireSupport(png),
  };
}

function compareStructuralBandwidth(referencePath, candidatePath) {
  const reference = parsePngRgba(readBuffer(referencePath));
  const candidate = parsePngRgba(readBuffer(candidatePath));
  const width = Math.min(reference.width, candidate.width);
  const height = Math.min(reference.height, candidate.height);
  const referenceLuma = pngLumaPlane(reference, width, height);
  const candidateLuma = pngLumaPlane(candidate, width, height);
  const mask = fireSupportMask(reference, width, height);
  const projectedSupport = summarizeSupportMask(mask, width, height);
  const referenceMean = maskedMean(referenceLuma, mask);
  const candidateMean = maskedMean(candidateLuma, mask);
  let referenceGradient = 0;
  let candidateGradient = 0;
  let referenceLaplacian = 0;
  let candidateLaplacian = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      referenceGradient += sobelMagnitude(referenceLuma, width, x, y) / Math.max(1, referenceMean);
      candidateGradient += sobelMagnitude(candidateLuma, width, x, y) / Math.max(1, candidateMean);
      referenceLaplacian += Math.abs(laplacian(referenceLuma, width, x, y)) / Math.max(1, referenceMean);
      candidateLaplacian += Math.abs(laplacian(candidateLuma, width, x, y)) / Math.max(1, candidateMean);
      samples += 1;
    }
  }
  const referenceGradientMean = samples ? referenceGradient / samples : 0;
  const candidateGradientMean = samples ? candidateGradient / samples : 0;
  const referenceLaplacianMean = samples ? referenceLaplacian / samples : 0;
  const candidateLaplacianMean = samples ? candidateLaplacian / samples : 0;
  return {
    authority: 'matched-raymarch-support-normalized-structural-bandwidth-v0',
    projectedSupport,
    samples,
    referenceMeanLuma: referenceMean,
    candidateMeanLuma: candidateMean,
    referenceGradientMean,
    candidateGradientMean,
    gradientRetention: referenceGradientMean > 0 ? candidateGradientMean / referenceGradientMean : null,
    referenceLaplacianMean,
    candidateLaplacianMean,
    laplacianRetention: referenceLaplacianMean > 0 ? candidateLaplacianMean / referenceLaplacianMean : null,
  };
}

function pngLumaPlane(png, width = png.width, height = png.height) {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = png.rows[y];
    for (let x = 0; x < width; x += 1) {
      const index = x * png.channels;
      values[y * width + x] = 0.2126 * row[index] + 0.7152 * row[index + 1] + 0.0722 * row[index + 2];
    }
  }
  return values;
}

function fireSupportMask(png, width = png.width, height = png.height) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = png.rows[y];
    for (let x = 0; x < width; x += 1) {
      const index = x * png.channels;
      const red = row[index];
      const green = row[index + 1];
      const blue = row[index + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (luma > 16 && (maximum - minimum > 7 || luma > 55)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function measureProjectedFireSupport(png) {
  return summarizeSupportMask(fireSupportMask(png), png.width, png.height);
}

function summarizeSupportMask(mask, width, height) {
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const supportWidth = count ? maxX - minX + 1 : 0;
  const supportHeight = count ? maxY - minY + 1 : 0;
  return {
    authority: 'colored-fire-screen-support-mask-v0',
    pixelCount: count,
    pixelFraction: width * height ? count / (width * height) : 0,
    bounds: count ? { minX, minY, maxX, maxY, width: supportWidth, height: supportHeight } : null,
    diameterPx: Math.hypot(supportWidth, supportHeight),
    boundingAreaPx: supportWidth * supportHeight,
  };
}

function maskedMean(values, mask) {
  let total = 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    total += values[index];
    count += 1;
  }
  return count ? total / count : 0;
}

function sobelMagnitude(values, width, x, y) {
  const top = (y - 1) * width;
  const middle = y * width;
  const bottom = (y + 1) * width;
  const gx = (
    -values[top + x - 1] + values[top + x + 1]
    - 2 * values[middle + x - 1] + 2 * values[middle + x + 1]
    - values[bottom + x - 1] + values[bottom + x + 1]
  );
  const gy = (
    -values[top + x - 1] - 2 * values[top + x] - values[top + x + 1]
    + values[bottom + x - 1] + 2 * values[bottom + x] + values[bottom + x + 1]
  );
  return Math.hypot(gx, gy) * 0.125;
}

function laplacian(values, width, x, y) {
  const index = y * width + x;
  return values[index - 1] + values[index + 1] + values[index - width] + values[index + width] - 4 * values[index];
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
