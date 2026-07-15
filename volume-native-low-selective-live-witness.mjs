#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.native-low-selective-live-witness.v0';
const IDENTITY = 'native-low-live-witness-v0';
const ROUTE = 'native-low-live-browser-webgpu-inference-v0';
const MODEL = 'exact-basin-selective-carrier-heads-160-to-128-v0';
const MODEL_SHA256 = 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9';
const TRANSPORT_MODE = 'shared-device-gpu-buffers-no-readback-import-v0';
const WITNESS_CONTRACT_MARKERS = Object.freeze({
  transportMode: 'shared-device-gpu-buffers-no-readback-import-v0',
  requestedCalibration: 'native-low-learned-splat-calibration-v0',
  effectiveCalibration: 'native-low-learned-splat-calibration-v0',
  modelOutputMutation: false,
});
const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const out = resolve(String(args.get('--out') || '/tmp/kaminos-native-low-selective-live.png'));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-native-low-selective-live.json'));
const minimumContinuousSeconds = Number(args.get('--minimum-seconds') || 5);
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
let failurePhase = 'argument-validation';
let browser = null;
let socket = null;
let lastTrustworthyEvidence = {};

class CdpSocket {
  constructor(socketUrl) {
    this.socketUrl = socketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.socketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

try {
  assert.ok(minimumContinuousSeconds >= 5 && minimumContinuousSeconds <= 30, '--minimum-seconds must be within 5-30');
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    '--window-size=1500,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(port, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Page.navigate', { url });

  failurePhase = 'route-settle';
  const settleStarted = performance.now();
  let state = null;
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive?.debugState?.()');
    lastTrustworthyEvidence = { routeSettle: state };
    if (state?.status === 'failed') throw new Error(state?.lastTrustworthyEvidence?.error || state?.failurePhase || 'native-low live route failed');
    if (
      state?.routeIdentity === ROUTE
      && state?.status === 'running'
      && state?.frameIndex >= 1
      && state?.modelIdentity === MODEL
      && state?.modelSha256 === MODEL_SHA256
      && state?.requestedComposition === 'splat-only-v0'
      && state?.effectiveComposition === 'splat-only-v0'
      && state?.requestedCalibration === 'native-low-learned-splat-calibration-v0'
      && state?.effectiveCalibration === 'native-low-learned-splat-calibration-v0'
      && state?.modelOutputMutation === false
      && state?.requestedBackend === 'WebGPU'
      && isWebGpuBackend(state?.effectiveBackend)
      && state?.fallbackBackend === null
      && state?.transportMode === TRANSPORT_MODE
      && state?.runtimeTruthAvailable === false
      && state?.syntheticDownsampleApplied === false
      && state?.sameNativeStateIdentity
      && !state?.sourceStepDrift
      && !state?.controlTreatmentCausalDivergence
      && Number(state?.supportPositiveCount) >= 0
      && Number(state?.treatmentSplatInstanceCount) >= 0
      && Number(state?.calibrationGain) >= 0
      && Number(state?.treatmentSplatRadianceGain) >= 0
      && Number(state?.treatmentSplatOpacityGain) >= 0
      && state?.nativeLowMaterializationProfile?.hiddenSupportCap === false
      && Number(state?.nativeLowMaterializationProfile?.treatmentRebuildMs) >= 0
      && Number(state?.nativeLowMaterializationProfile?.restoreCopyMs) >= 0
      && state?.nativeLowInferenceWorkProfile?.supportClassifierCoverage === 'full-grid-160^3'
      && state?.nativeLowInferenceWorkProfile?.supportCompactionIdentity === 'native-low-support-positive-residual-dispatch-v0'
      && state?.nativeLowInferenceWorkProfile?.supportCompactionActive === true
      && state?.nativeLowInferenceWorkProfile?.residualDispatchMode === 'support-positive-direct-covered-dispatch-v0'
      && state?.nativeLowInferenceWorkProfile?.hiddenSupportCap === false
      && Number(state?.nativeLowInferenceWorkProfile?.modelEvaluatedCellCount) >= 0
      && Number(state?.nativeLowInferenceWorkProfile?.residualHeadEvaluatedCount) >= 0
      && Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount) >= 0
      && Number(state?.nativeLowInferenceWorkProfile?.residualDispatchWorkgroups) >= 1
      && Number(state?.nativeLowInferenceWorkProfile?.residualDispatchThreadCount) >= Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount)
      && state?.nativeLowHeadCostProfile?.identity === 'native-low-head-cost-profile-v0'
      && state?.headCostTimingAuthority === 'webgpu-timestamp-query-stage-split-v0'
      && Number(state?.nativeLowHeadCostProfile?.supportFrontGpuMs) >= 0
      && Number(state?.nativeLowHeadCostProfile?.supportPositiveResidualGpuMs) >= 0
      && state?.nativeLowSupportTileProfile?.identity === 'native-low-support-proximal-tile-profile-v0'
      && Number(state?.nativeLowSupportTileProfile?.activeTileCount) >= 0
      && Number(state?.nativeLowSupportTileProfile?.projectedSupportFrontCellCount) >= 0
      && Number(state?.nativeLowSupportTileProfile?.tileProfileReadbackMs) >= 0
      && state?.nativeLowProductionStageLedger?.identity === 'native-low-production-stage-ledger-v0'
      && state?.nativeLowProductionStageLedger?.frozenDenseRouteControl?.retained === true
      && Number(state?.nativeLowProductionStageLedger?.denseReceiverWriteBytes) > 0
      && state?.nativeLowProductionStageLedger?.debugManifestTransportExcluded?.excluded === true
      && state?.nativeLowProductionStageLedger?.dense160ReceiverWriteAvoidanceCandidate?.status === 'projection-not-implemented'
      && state?.simulationSteppingReceipt?.simStepDelta === 1
      && state?.currentSourceFrameConsumption?.encodedFrameDelta === 1
      && state?.stalePredictionRejection?.repeatedStaticPrediction === false
      && Number(state?.inferenceGpuMs) >= 0
      && Number(state?.uploadDispatchMs) >= 0
      && Number(state?.endToEndFrameMs) >= 0
    ) break;
    await delay(250);
  }
  assert.equal(state?.routeIdentity, ROUTE, 'wrong effective route');
  assert.equal(state?.status, 'running', 'live route did not reach running state');
  assert.equal(state?.modelIdentity, MODEL, 'wrong model identity');
  assert.equal(state?.modelSha256, MODEL_SHA256, 'wrong model checksum');
  assert.equal(state?.requestedComposition, 'splat-only-v0', 'wrong requested composition');
  assert.equal(state?.effectiveComposition, 'splat-only-v0', 'requested/effective composition drift');
  assert.equal(state?.requestedCalibration, 'native-low-learned-splat-calibration-v0', 'wrong requested calibration');
  assert.equal(state?.effectiveCalibration, 'native-low-learned-splat-calibration-v0', 'wrong effective calibration');
  assert.equal(state?.modelOutputMutation, false, 'calibration mutated model outputs');
  assert.equal(state?.requestedBackend, 'WebGPU', 'wrong requested backend');
  assert.ok(isWebGpuBackend(state?.effectiveBackend), `fallback backend used: ${state?.effectiveBackend}`);
  assert.equal(state?.fallbackBackend, null, 'fallback backend evidence is not admissible');
  assert.equal(state?.transportMode, TRANSPORT_MODE, 'wrong shared-device transport mode');
  assert.equal(state?.runtimeTruthAvailable, false, 'truth authority leaked into runtime');
  assert.equal(state?.syntheticDownsampleApplied, false, 'synthetic downsample leaked into runtime');
  assert.equal(state?.sourceStepDrift, null, 'source-step drift detected');
  assert.equal(state?.controlTreatmentCausalDivergence, null, 'control/treatment causal divergence detected');
  assert.ok(Number(state?.supportPositiveCount) >= 0, 'supportPositiveCount missing');
  assert.ok(Number(state?.treatmentSplatInstanceCount) >= 0, 'treatmentSplatInstanceCount missing');
  assert.ok(Number(state?.calibrationGain) >= 0, 'calibrationGain missing');
  assert.ok(Number(state?.treatmentSplatRadianceGain) >= 0, 'treatmentSplatRadianceGain missing');
  assert.ok(Number(state?.treatmentSplatOpacityGain) >= 0, 'treatmentSplatOpacityGain missing');
  assert.equal(state?.nativeLowMaterializationProfile?.hiddenSupportCap, false, 'hidden support cap used in materialization profile');
  assert.ok(Number(state?.nativeLowMaterializationProfile?.treatmentRebuildMs) >= 0, 'treatmentRebuildMs missing');
  assert.ok(Number(state?.nativeLowMaterializationProfile?.restoreCopyMs) >= 0, 'restoreCopyMs missing');
  assert.equal(state?.nativeLowInferenceWorkProfile?.supportClassifierCoverage, 'full-grid-160^3', 'support classifier coverage is not full grid');
  assert.equal(state?.nativeLowInferenceWorkProfile?.supportCompactionIdentity, 'native-low-support-positive-residual-dispatch-v0', 'wrong support compaction identity');
  assert.equal(state?.nativeLowInferenceWorkProfile?.supportCompactionActive, true, 'support compaction was not active');
  assert.equal(state?.nativeLowInferenceWorkProfile?.residualDispatchMode, 'support-positive-direct-covered-dispatch-v0', 'wrong residual dispatch mode');
  assert.equal(state?.nativeLowInferenceWorkProfile?.hiddenSupportCap, false, 'hidden support cap used in inference profile');
  assert.ok(Number(state?.nativeLowInferenceWorkProfile?.modelEvaluatedCellCount) >= 0, 'modelEvaluatedCellCount missing');
  assert.ok(Number(state?.nativeLowInferenceWorkProfile?.residualHeadEvaluatedCount) >= 0, 'residualHeadEvaluatedCount missing');
  assert.ok(Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount) >= 0, 'supportCompactedCount missing');
  assert.ok(Number(state?.nativeLowInferenceWorkProfile?.residualDispatchWorkgroups) >= 1, 'residualDispatchWorkgroups missing');
  assert.ok(
    Number(state?.nativeLowInferenceWorkProfile?.residualDispatchThreadCount) >= Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount),
    'residual dispatch thread count does not cover compacted support',
  );
  assert.equal(state?.nativeLowHeadCostProfile?.identity, 'native-low-head-cost-profile-v0', 'head cost profile missing');
  assert.equal(state?.headCostTimingAuthority, 'webgpu-timestamp-query-stage-split-v0', 'wrong head cost timing authority');
  assert.ok(Number(state?.nativeLowHeadCostProfile?.supportFrontGpuMs) >= 0, 'supportFrontGpuMs missing');
  assert.ok(Number(state?.nativeLowHeadCostProfile?.supportPositiveResidualGpuMs) >= 0, 'supportPositiveResidualGpuMs missing');
  assert.equal(state?.nativeLowSupportTileProfile?.identity, 'native-low-support-proximal-tile-profile-v0', 'support-proximal tile profile missing');
  assert.ok(Number(state?.nativeLowSupportTileProfile?.activeTileCount) >= 0, 'activeTileCount missing');
  assert.ok(Number(state?.nativeLowSupportTileProfile?.projectedSupportFrontCellCount) >= 0, 'projectedSupportFrontCellCount missing');
  assert.ok(Number(state?.nativeLowSupportTileProfile?.tileProfileReadbackMs) >= 0, 'tileProfileReadbackMs missing');
  assert.equal(state?.nativeLowProductionStageLedger?.identity, 'native-low-production-stage-ledger-v0', 'production stage ledger missing');
  assert.equal(state?.nativeLowProductionStageLedger?.frozenDenseRouteControl?.retained, true, 'frozen dense route control missing');
  assert.ok(Number(state?.nativeLowProductionStageLedger?.denseReceiverWriteBytes) > 0, 'dense receiver write bytes missing');
  assert.equal(state?.nativeLowProductionStageLedger?.debugManifestTransportExcluded?.excluded, true, 'debug manifest transport was not excluded from live ledger');
  assert.equal(state?.nativeLowProductionStageLedger?.dense160ReceiverWriteAvoidanceCandidate?.status, 'projection-not-implemented', 'sparse receiver candidate projection status missing');
  assert.equal(state?.simulationSteppingReceipt?.simStepDelta, 1, 'simulator did not step exactly once for this model frame');
  assert.equal(state?.currentSourceFrameConsumption?.encodedFrameDelta, 1, 'model did not consume exactly one current source frame');
  assert.equal(state?.stalePredictionRejection?.repeatedStaticPrediction, false, 'stale prediction was not rejected');

  const startState = state;
  const observationStartMs = performance.now();
  failurePhase = 'continuous-observation';
  await delay(minimumContinuousSeconds * 1000);
  const endState = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive.debugState()');
  const observedSeconds = (performance.now() - observationStartMs) / 1000;
  const frameDelta = Number(endState?.frameIndex || 0) - Number(startState?.frameIndex || 0);
  lastTrustworthyEvidence = { startState, endState, observedSeconds, frameDelta };
  assert.ok(observedSeconds >= minimumContinuousSeconds * 0.98, 'observation window was truncated');
  assert.ok(frameDelta >= 1, 'native-low treatment frames did not advance continuously');
  assert.equal(endState?.effectiveComposition, startState?.effectiveComposition, 'composition drift during observation');
  assert.equal(endState?.effectiveCalibration, startState?.effectiveCalibration, 'calibration drift during observation');
  assert.equal(endState?.modelOutputMutation, false, 'model-output mutation during observation');
  assert.ok(isWebGpuBackend(endState?.effectiveBackend), `backend drift during observation: ${endState?.effectiveBackend}`);
  assert.equal(endState?.fallbackBackend, null, 'fallback backend during observation');
  assert.equal(endState?.transportMode, TRANSPORT_MODE, 'transport mode drift during observation');
  assert.equal(endState?.sourceStepDrift, null, 'source-step drift during observation');
  assert.equal(endState?.simulationSteppingReceipt?.simStepDelta, 1, 'simulator stopped stepping during observation');
  assert.equal(endState?.currentSourceFrameConsumption?.encodedFrameDelta, 1, 'model stopped consuming current source frames during observation');
  assert.equal(endState?.stalePredictionRejection?.repeatedStaticPrediction, false, 'repeated static prediction during observation');

  failurePhase = 'blankFrameRejection';
  const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = Buffer.from(capture.data || '', 'base64');
  assert.ok(screenshot.byteLength > 1000, 'blankFrameRejection: screenshot missing or blank');
  failurePhase = 'cachedFrameRejection';
  assert.notEqual(startState?.frameCacheKey, null, 'cachedFrameRejection: route omitted frame cache key');
  assert.notEqual(endState?.sameNativeStateIdentity, startState?.sameNativeStateIdentity, 'cachedFrameRejection: native state identity did not advance');
  writeFileSync(out, screenshot);

  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    effectiveRoute: endState.routeIdentity,
    requestedComposition: endState.requestedComposition,
    effectiveComposition: endState.effectiveComposition,
    requestedCalibration: endState.requestedCalibration,
    effectiveCalibration: endState.effectiveCalibration,
    nativeLowControl: endState.nativeLowControl,
    nativeLowSelectivePredicted: endState.nativeLowSelectivePredicted,
    modelOutputMutation: endState.modelOutputMutation,
    treatmentSplatRadianceGain: endState.treatmentSplatRadianceGain,
    treatmentSplatOpacityGain: endState.treatmentSplatOpacityGain,
    nativeLowMaterializationProfile: endState.nativeLowMaterializationProfile,
    nativeLowProductionStageLedger: endState.nativeLowProductionStageLedger,
    nativeLowSupportTileProfile: endState.nativeLowSupportTileProfile,
    supportTileProjection: {
      activeTileCoverage: endState.nativeLowSupportTileProfile?.activeTileCoverage,
      projectedCellReduction: endState.nativeLowSupportTileProfile?.projectedCellReduction,
      projectedSupportFrontCellCount: endState.nativeLowSupportTileProfile?.projectedSupportFrontCellCount,
    },
    simulationSteppingReceipt: endState.simulationSteppingReceipt,
    currentSourceFrameConsumption: endState.currentSourceFrameConsumption,
    stalePredictionRejection: endState.stalePredictionRejection,
    nativeLowInferenceWorkProfile: endState.nativeLowInferenceWorkProfile,
    supportCompactionIdentity: endState.nativeLowInferenceWorkProfile?.supportCompactionIdentity,
    supportCompactedCount: endState.nativeLowInferenceWorkProfile?.supportCompactedCount,
    residualDispatchMode: endState.nativeLowInferenceWorkProfile?.residualDispatchMode,
    residualDispatchWorkgroups: endState.nativeLowInferenceWorkProfile?.residualDispatchWorkgroups,
    residualDispatchThreadCount: endState.nativeLowInferenceWorkProfile?.residualDispatchThreadCount,
    nativeLowHeadCostProfile: endState.nativeLowHeadCostProfile,
    headCostTimingAuthority: endState.headCostTimingAuthority,
    requestedBackend: endState.requestedBackend,
    effectiveBackend: endState.effectiveBackend,
    transportMode: endState.transportMode,
    modelIdentity: endState.modelIdentity,
    modelSha256: endState.modelSha256,
    supportPositiveCount: endState.supportPositiveCount,
    supportPrevalence: endState.supportPrevalence,
    treatmentSplatCandidateCount: endState.treatmentSplatCandidateCount,
    treatmentSplatInstanceCount: endState.treatmentSplatInstanceCount,
    calibrationGain: endState.calibrationGain,
    blankTreatmentAttribution: endState.blankTreatmentAttribution,
    minimumContinuousSeconds,
    observedSeconds,
    frameDelta,
    inferenceGpuMs: endState.inferenceGpuMs,
    uploadDispatchMs: endState.uploadDispatchMs,
    treatmentRebuildMs: endState.treatmentRebuildMs,
    treatmentCopyMs: endState.treatmentCopyMs,
    restoreRebuildMs: endState.restoreRebuildMs,
    restoreCopyMs: endState.restoreCopyMs,
    endToEndFrameMs: endState.endToEndFrameMs,
    blankFrameRejection: 'passed',
    cachedFrameRejection: 'passed',
    startState,
    endState,
    screenshot: out,
  });
  console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: out, frameDelta }, null, 2));
} catch (error) {
  let failureScreenshot = null;
  try {
    if (socket) {
      const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(capture.data || '', 'base64');
      if (bytes.byteLength > 1000) {
        const failurePath = out.replace(/\.png$/i, '-failure.png');
        writeFileSync(failurePath, bytes);
        failureScreenshot = failurePath;
      }
    }
  } catch {}
  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    minimumContinuousSeconds,
    lastTrustworthyEvidence,
    failureScreenshot,
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  browser?.kill('SIGTERM');
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

async function waitForTarget(debugPort, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(isInspectablePageTarget);
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

function isInspectablePageTarget(target) {
  const targetUrl = String(target?.url || '');
  return target?.type === 'page' && !targetUrl.startsWith('chrome-extension://');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeReport(value) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}

function isWebGpuBackend(value) {
  return String(value || '').startsWith('WebGPU');
}
