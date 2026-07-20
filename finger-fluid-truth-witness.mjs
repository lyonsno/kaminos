#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  KAMINOS_FINGER_FLUID_DEFAULT_SUPPORT_FRICTION,
  evaluateFingerFluidTruthTrajectory,
  validateFingerFluidTruthRendererState,
} from './finger-fluid-webgpu-core.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const requestedUrl = args.get('--url') || 'http://127.0.0.1:8100/index.html?kaminos_finger_fluid_bench=1&finger_fluid_truth_scene=multi_regime_playground';
const requestedUrlObject = new URL(requestedUrl);
const requestedTruthScene = requestedUrlObject.searchParams.get('finger_fluid_truth_scene') || 'multi_regime_playground';
const requestedRendererMode = requestedUrlObject.searchParams.get('finger_fluid_renderer') || 'screen_space_surface';
const requestedSupportFriction = Number(requestedUrlObject.searchParams.get('finger_fluid_support_friction') ?? KAMINOS_FINGER_FLUID_DEFAULT_SUPPORT_FRICTION);
const checkpointOffsetsMs = String(args.get('--checkpoints-ms') || '500,2500,7000')
  .split(',')
  .map(value => Number(value.trim()));
const requestedCheckpointSteps = args.get('--checkpoint-steps');
const checkpointStepTargets = requestedCheckpointSteps === undefined
  ? checkpointOffsetsMs.map(offsetMs => Math.ceil(offsetMs * 0.03))
  : String(requestedCheckpointSteps).split(',').map(value => Number(value.trim()));
const checkpointStepTargetSource = requestedCheckpointSteps === undefined
  ? 'derived-minimum-30-solver-steps-per-second-v0'
  : 'explicit-cli-minimum-solver-steps-v0';
const outDir = resolve(args.get('--out-dir') || `/tmp/kaminos-fluid-truth-${requestedTruthScene}-${process.pid}`);
const reportPath = resolve(args.get('--report') || join(outDir, 'report.json'));
const debugPort = Number(args.get('--debug-port') || 9521);
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1120);
const deviceScaleFactor = Number(args.get('--device-scale-factor') || 1);
const hookWaitMs = Number(args.get('--hook-wait-ms') || 20000);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-fluid-truth-profile-${debugPort}-${process.pid}`;

let phase = 'validate_config';
let primary_output_written = false;
let effectiveUrl = null;
let effectiveTruthScene = null;
let effectiveRendererMode = null;
let initialRendererAuthority = null;
let lastRendererAuthority = null;
let lastDebugState = null;
let browserVersion = null;
let stderr = '';
const trajectory = [];
const consoleEvents = [];
const outputFiles = [];
let trajectoryAcceptance = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.finger-fluid-truth-witness.v0',
    requestedUrl,
    effectiveUrl,
    requestedTruthScene,
    effectiveTruthScene,
    requestedRendererMode,
    effectiveRendererMode,
    requestedSupportFriction,
    initialRendererAuthority,
    checkpointOffsetsMs,
    checkpointStepTargets,
    checkpointStepTargetSource,
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor },
    debugPort,
    chrome,
    userDataDir,
    failure_phase: phase,
    primary_output_written,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    consoleEvents,
    trajectory,
    trajectoryAcceptance,
    outputFiles,
    lastDebugState,
    ...extra,
  }, null, 2));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForPage() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.type === 'page' && candidate.url === 'about:blank')
      || pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(125);
  }
  throw new Error('Chrome page target did not open');
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(socket, method, params = {}) {
  const id = socket._nextId = (socket._nextId || 0) + 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, 20000);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    socket.addEventListener('message', onMessage);
  });
}

async function evaluate(socket, expression) {
  const result = await wsRequest(socket, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function collectRuntimeEvents(socket) {
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        type: message.params.type,
        text: (message.params.args || []).map(value => value.value || value.description || '').join(' '),
      });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        type: 'exception',
        text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception',
      });
    }
  });
}

function measureCapturedCanvas(path) {
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (decoded.status !== 0 || !decoded.stdout?.length) {
    throw new Error(`ffmpeg canvas decode failed: ${decoded.stderr?.toString() || decoded.status}`);
  }
  let nonBlackPixels = 0;
  let chromaticPixels = 0;
  for (let offset = 0; offset < decoded.stdout.length; offset += 3) {
    const red = decoded.stdout[offset];
    const green = decoded.stdout[offset + 1];
    const blue = decoded.stdout[offset + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    if (maximum > 24) nonBlackPixels += 1;
    if (maximum > 52 && maximum - minimum > 16) chromaticPixels += 1;
  }
  const pixelCount = Math.floor(decoded.stdout.length / 3);
  return {
    pixelCount,
    nonBlackPixels,
    chromaticPixels,
    nonBlackRatio: Number((nonBlackPixels / Math.max(1, pixelCount)).toFixed(6)),
    chromaticRatio: Number((chromaticPixels / Math.max(1, pixelCount)).toFixed(6)),
    measurement: 'captured_webgpu_canvas_ffmpeg_rgb24_v0',
  };
}

async function requestCheckpoint(socket, checkpointIndex, elapsedMs, targetStep) {
  const before = await evaluate(socket, `(() => {
    const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
    return typeof read === 'function' ? read() : null;
  })()`);
  const requestReceipt = await evaluate(socket, `(async () => {
    if (typeof window.kaminosFingerFluidBenchRequestDiagnostics !== 'function') throw new Error('missing explicit fluid diagnostics hook');
    return window.kaminosFingerFluidBenchRequestDiagnostics();
  })()`);
  const deadline = Date.now() + 8000;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate(socket, `(() => {
      const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
      return typeof read === 'function' ? read() : null;
    })()`);
    if (
      state?.runtime?.diagnosticsRequestCount === requestReceipt?.diagnosticsRequestCount
      && state?.runtime?.diagnosticsCompletionCount === requestReceipt?.diagnosticsCompletionCount
    ) break;
    await delay(50);
  }
  if (
    !state
    || state.runtime?.diagnosticsRequestCount !== requestReceipt?.diagnosticsRequestCount
    || state.runtime?.diagnosticsCompletionCount !== requestReceipt?.diagnosticsCompletionCount
  ) {
    throw new Error(`checkpoint diagnostics are missing or partial: ${JSON.stringify({ requestReceipt, runtime: state?.runtime })}`);
  }
  if (state.runtime.diagnosticsRequestCount !== (before?.runtime?.diagnosticsRequestCount || 0) + 1) {
    throw new Error(`checkpoint diagnostics request identity skipped or duplicated: ${JSON.stringify({ before: before?.runtime, after: state.runtime })}`);
  }
  if (state.runtime.diagnostics.stepCount < targetStep) {
    throw new Error(`checkpoint diagnostics were captured before the minimum solver-step horizon: ${JSON.stringify({
      targetStep,
      diagnosticsStepCount: state.runtime.diagnostics.stepCount,
      liveStepCount: state.runtime.stepCount,
    })}`);
  }
  const requestedTruthScene = state.runtime?.requestedTruthScene;
  const effectiveTruthScene = state.runtime?.effectiveTruthScene;
  if (requestedTruthScene !== effectiveTruthScene) {
    throw new Error(`truth scene silently fell back: ${JSON.stringify({ requestedTruthScene, effectiveTruthScene })}`);
  }
  if (effectiveTruthScene !== globalThis.effectiveTruthScene) {
    throw new Error(`truth scene changed during trajectory: ${JSON.stringify({ expected: globalThis.effectiveTruthScene, effectiveTruthScene })}`);
  }
  const effectiveSupportFriction = state.runtime?.effectiveSupportFriction;
  if (state.runtime?.requestedSupportFriction !== effectiveSupportFriction) {
    throw new Error(`support friction silently fell back: ${JSON.stringify({
      requestedSupportFriction: state.runtime?.requestedSupportFriction,
      effectiveSupportFriction,
    })}`);
  }
  if (effectiveSupportFriction !== requestedSupportFriction) {
    throw new Error(`support friction changed during trajectory: ${JSON.stringify({ requestedSupportFriction, effectiveSupportFriction })}`);
  }
  const rendererAuthority = validateFingerFluidTruthRendererState(requestedRendererMode, state.runtime);
  if (rendererAuthority.effectiveRendererMode !== effectiveRendererMode) {
    throw new Error(`truth renderer changed during trajectory: ${JSON.stringify({
      expected: effectiveRendererMode,
      effectiveRendererMode: rendererAuthority.effectiveRendererMode,
    })}`);
  }
  if (rendererAuthority.screenSpaceSurfaceEvidence && lastRendererAuthority?.screenSpaceSurfaceEvidence) {
    const previousEvidence = lastRendererAuthority.screenSpaceSurfaceEvidence;
    const currentEvidence = rendererAuthority.screenSpaceSurfaceEvidence;
    if (
      currentEvidence.accumulationPassCount <= previousEvidence.accumulationPassCount
      || currentEvidence.compositePassCount <= previousEvidence.compositePassCount
    ) {
      throw new Error(`truth screen-space renderer passes did not advance: ${JSON.stringify({ previousEvidence, currentEvidence })}`);
    }
  }
  lastRendererAuthority = rendererAuthority;
  const fluidTruthSnapshot = state.runtime?.fluidTruthSnapshot;
  if (fluidTruthSnapshot?.schema !== 'kaminos.finger-fluid-truth-snapshot.v0') {
    throw new Error(`fluid truth snapshot is missing: ${JSON.stringify(fluidTruthSnapshot)}`);
  }
  if (fluidTruthSnapshot.scene !== effectiveTruthScene || fluidTruthSnapshot.particleCount !== state.runtime.particleCount) {
    throw new Error(`fluid truth snapshot identity is partial: ${JSON.stringify({ fluidTruthSnapshot, effectiveTruthScene, particleCount: state.runtime.particleCount })}`);
  }
  if (fluidTruthSnapshot.finiteParticleCount !== state.runtime.particleCount || fluidTruthSnapshot.retainedParticleRatio < 0.999999) {
    throw new Error(`fluid particle population was lost or became non-finite: ${JSON.stringify(fluidTruthSnapshot)}`);
  }
  for (const field of [
    'relativeDensityErrorMean',
    'relativeDensityErrorP95',
    'boundaryRelativeDensityErrorMean',
    'boundaryRelativeDensityErrorP95',
    'bulkRelativeDensityErrorMean',
    'bulkRelativeDensityErrorP95',
    'maximumBoundaryPenetration',
    'totalKineticEnergy',
    'occupiedCellCount',
    'occupiedVolumeProxy',
  ]) {
    if (!Number.isFinite(fluidTruthSnapshot[field])) throw new Error(`fluid truth field is non-finite: ${field}=${fluidTruthSnapshot[field]}`);
  }
  if (
    fluidTruthSnapshot.boundaryParticleCount + fluidTruthSnapshot.bulkParticleCount !== fluidTruthSnapshot.finiteParticleCount
    || fluidTruthSnapshot.boundaryParticleCount <= 0
  ) {
    throw new Error(`fluid boundary population evidence is missing or partial: ${JSON.stringify(fluidTruthSnapshot)}`);
  }
  if (fluidTruthSnapshot.occupiedCellCount < 2 || fluidTruthSnapshot.occupiedVolumeProxy <= 0) {
    throw new Error(`fluid support-volume occupancy collapsed: ${JSON.stringify(fluidTruthSnapshot)}`);
  }
  if (effectiveTruthScene !== 'multi_regime_playground' && fluidTruthSnapshot.sourceRecirculationCount !== 0) {
    throw new Error(`closed-population scene leaked into source recirculation: ${JSON.stringify(fluidTruthSnapshot)}`);
  }
  const energyLedger = state.runtime?.energyLedger;
  const energyStages = ['projection', 'viscosity', 'vorticity', 'cohesion'];
  if (
    energyLedger?.contract !== 'wgsl-per-pass-kinetic-energy-ledger-v0'
    || energyLedger.stepCount !== state.runtime.diagnostics?.stepCount
    || energyLedger.particleCount !== state.runtime.particleCount
    || !energyStages.every(stage => Number.isFinite(energyLedger.averageKineticEnergy?.[stage]))
    || !energyStages.every(stage => Number.isFinite(energyLedger.totalKineticEnergy?.[stage]))
    || !['viscosity', 'vorticity', 'cohesion'].every(stage => Number.isFinite(energyLedger.stageDelta?.[stage]))
  ) {
    throw new Error(`energy ledger is missing, stale, or partial: ${JSON.stringify(energyLedger)}`);
  }
  const supportDiagnostics = {
    averageSupportedTangentialSpeed: state.runtime.diagnostics?.averageSupportedTangentialSpeed,
    supportedTransportParticleRatio: state.runtime.diagnostics?.supportedTransportParticleRatio,
    supportedRestingParticleRatio: state.runtime.diagnostics?.supportedRestingParticleRatio,
    movingLockedParticleRatio: state.runtime.diagnostics?.movingLockedParticleRatio,
  };
  if (
    !Object.values(supportDiagnostics).every(Number.isFinite)
    || supportDiagnostics.averageSupportedTangentialSpeed < 0
    || !['supportedTransportParticleRatio', 'supportedRestingParticleRatio', 'movingLockedParticleRatio']
      .every(field => supportDiagnostics[field] >= 0 && supportDiagnostics[field] <= 1)
  ) {
    throw new Error(`support-slip diagnostics are missing or invalid: ${JSON.stringify(supportDiagnostics)}`);
  }

  const canvasRect = await evaluate(socket, `(() => {
    const canvas = document.getElementById('finger-fluid-bench-canvas');
    if (!canvas || !canvas.width || !canvas.height) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  if (!canvasRect || canvasRect.width < 100 || canvasRect.height < 100) throw new Error(`fluid canvas is unavailable: ${JSON.stringify(canvasRect)}`);
  const screenshot = await wsRequest(socket, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { ...canvasRect, scale: 1 },
  });
  const outputPath = join(outDir, `${String(checkpointIndex + 1).padStart(2, '0')}-${effectiveTruthScene}-${Math.round(elapsedMs)}ms.png`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
  primary_output_written = true;
  outputFiles.push(outputPath);
  const visual = measureCapturedCanvas(outputPath);
  if (visual.nonBlackRatio < 0.12 || visual.chromaticRatio < 0.04) {
    throw new Error(`fluid truth checkpoint is blank or visually partial: ${JSON.stringify(visual)}`);
  }
  return {
    checkpointIndex,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    minimumStepCount: targetStep,
    diagnosticsRequestCount: state.runtime.diagnosticsRequestCount,
    diagnosticsCompletionCount: state.runtime.diagnosticsCompletionCount,
    stepCount: state.runtime.diagnostics.stepCount,
    liveStepCount: state.runtime.stepCount,
    rendererAuthority,
    supportFriction: effectiveSupportFriction,
    energyLedger,
    supportDiagnostics,
    fluidTruthSnapshot,
    visual,
    outputPath,
  };
}

async function waitForMinimumStep(socket, targetStep) {
  let lastProgressReportAt = 0;
  while (true) {
    const state = await evaluate(socket, `(() => {
      const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
      return typeof read === 'function' ? read() : null;
    })()`);
    lastDebugState = state;
    const runtime = state?.runtime;
    if (runtime?.stepCount >= targetStep) return state;
    if (state?.status && state.status !== 'running') {
      throw new Error(`fluid bench stopped before minimum solver-step horizon: ${JSON.stringify({ targetStep, status: state.status, runtime })}`);
    }
    const now = Date.now();
    if (now - lastProgressReportAt >= 1000) {
      lastProgressReportAt = now;
      writeReport({
        waitingForMinimumStep: {
          targetStep,
          observedStepCount: runtime?.stepCount ?? null,
        },
      });
    }
    await delay(50);
  }
}

async function main() {
  if (!checkpointOffsetsMs.length || checkpointOffsetsMs.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Truth checkpoints must be finite non-negative milliseconds: ${JSON.stringify(checkpointOffsetsMs)}`);
  }
  if (checkpointOffsetsMs.some((value, index) => index > 0 && value <= checkpointOffsetsMs[index - 1])) {
    throw new Error(`Truth checkpoints must be strictly increasing: ${JSON.stringify(checkpointOffsetsMs)}`);
  }
  if (checkpointStepTargets.length !== checkpointOffsetsMs.length) {
    throw new Error(`Truth checkpoint step targets must match checkpoint offsets: ${JSON.stringify({ checkpointOffsetsMs, checkpointStepTargets })}`);
  }
  if (checkpointStepTargets.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`Truth checkpoint step targets must be non-negative safe integers: ${JSON.stringify(checkpointStepTargets)}`);
  }
  if (checkpointStepTargets.some((value, index) => index > 0 && value <= checkpointStepTargets[index - 1])) {
    throw new Error(`Truth checkpoint step targets must be strictly increasing: ${JSON.stringify(checkpointStepTargets)}`);
  }
  phase = 'launch_browser';
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${viewportWidth},${viewportHeight}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    phase = 'connect_cdp';
    browserVersion = await waitForCdp();
    const page = await waitForPage();
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(socket);
    collectRuntimeEvents(socket);
    await wsRequest(socket, 'Runtime.enable');
    await wsRequest(socket, 'Page.enable');
    await wsRequest(socket, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor,
      mobile: false,
    });
    phase = 'navigate';
    await wsRequest(socket, 'Page.navigate', { url: requestedUrl });

    phase = 'wait_debug_state';
    const hookDeadline = Date.now() + hookWaitMs;
    while (Date.now() < hookDeadline) {
      lastDebugState = await evaluate(socket, `(() => {
        const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
        return typeof read === 'function' ? read() : null;
      })()`);
      if (lastDebugState?.schema === 'kaminos.finger-fluid-bench.state.v0' && lastDebugState.status !== 'loading') break;
      await delay(100);
    }
    if (lastDebugState?.schema !== 'kaminos.finger-fluid-bench.state.v0' || lastDebugState.status !== 'running') {
      throw new Error(`fluid bench never became authoritative: ${JSON.stringify(lastDebugState)}`);
    }
    effectiveUrl = await evaluate(socket, 'window.location.href');
    effectiveTruthScene = lastDebugState.runtime?.effectiveTruthScene;
    globalThis.effectiveTruthScene = effectiveTruthScene;
    if (requestedTruthScene !== effectiveTruthScene) {
      throw new Error(`truth scene silently fell back: ${JSON.stringify({ requestedTruthScene, effectiveTruthScene })}`);
    }
    const effectiveSupportFriction = lastDebugState.runtime?.effectiveSupportFriction;
    if (lastDebugState.runtime?.requestedSupportFriction !== effectiveSupportFriction || effectiveSupportFriction !== requestedSupportFriction) {
      throw new Error(`support friction request/effective disagreement: ${JSON.stringify({
        requestedSupportFriction,
        runtimeRequestedSupportFriction: lastDebugState.runtime?.requestedSupportFriction,
        effectiveSupportFriction,
      })}`);
    }
    if (lastDebugState.runtime?.solverRoute !== 'webgpu-pbf-linked-cell-fluid-v0' || lastDebugState.runtime?.solver_backend !== 'webgpu_compute') {
      throw new Error(`truth witness reached a fallback solver: ${JSON.stringify(lastDebugState.runtime)}`);
    }
    initialRendererAuthority = validateFingerFluidTruthRendererState(requestedRendererMode, lastDebugState.runtime);
    effectiveRendererMode = initialRendererAuthority.effectiveRendererMode;
    lastRendererAuthority = initialRendererAuthority;
    if (lastDebugState.runtime?.truthGauntletContract !== 'kaminos-fluid-truth-gauntlet-v0') {
      throw new Error(`truth gauntlet contract mismatch: ${lastDebugState.runtime?.truthGauntletContract}`);
    }
    if ((lastDebugState.runtime?.diagnosticsRequestCount || 0) !== 0) {
      throw new Error(`truth route scheduled hidden diagnostics before witness custody: ${lastDebugState.runtime?.diagnosticsRequestCount}`);
    }

    const startedAt = performance.now();
    for (let checkpointIndex = 0; checkpointIndex < checkpointOffsetsMs.length; checkpointIndex += 1) {
      const targetOffsetMs = checkpointOffsetsMs[checkpointIndex];
      const targetStep = checkpointStepTargets[checkpointIndex];
      const remainingMs = targetOffsetMs - (performance.now() - startedAt);
      if (remainingMs > 0) await delay(remainingMs);
      phase = `wait_for_checkpoint_${checkpointIndex + 1}_step_${targetStep}`;
      await waitForMinimumStep(socket, targetStep);
      phase = `checkpoint_${checkpointIndex + 1}`;
      trajectory.push(await requestCheckpoint(socket, checkpointIndex, performance.now() - startedAt, targetStep));
      lastDebugState = await evaluate(socket, `(() => {
        const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
        return typeof read === 'function' ? read() : null;
      })()`);
    }
    phase = 'evaluate_trajectory';
    trajectoryAcceptance = evaluateFingerFluidTruthTrajectory(effectiveTruthScene, trajectory);
    if (consoleEvents.some(event => event.type === 'exception' || event.type === 'error')) {
      throw new Error(`browser console contains runtime errors: ${JSON.stringify(consoleEvents)}`);
    }
    phase = null;
    writeReport({ ok: true, failure_phase: null });
    socket.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    writeReport({ ok: false, error: error.message || String(error) });
    console.error(error);
    process.exit(1);
  });
